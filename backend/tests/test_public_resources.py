"""Public resource contracts; CSV fixtures do not claim a live government sync."""
from datetime import datetime, timedelta, timezone
import csv
import io
import logging

from fastapi import FastAPI
from fastapi.testclient import TestClient
import httpx
import pytest

from app.routers import resources as routes
from app.services import public_resources as service


def csv_bytes(rows=None, encoding="utf-8-sig"):
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["編號", "標題", "發佈時間", "發佈內容"])
    writer.writerows(rows if rows is not None else [
        ["older", "[FIXTURE] 舊消息", "114/8/9", "<p>此為測試資料，不是真實政府新聞。</p>"],
        ["new", "<b>[FIXTURE] 防詐提醒</b>", "2026-10-20 12:35:00", '<script>secret_code()</script><p>勿交付密碼，\n核對來源。</p><a href="https://evil.test">不應成為連結</a>'],
    ])
    return output.getvalue().encode(encoding)


@pytest.fixture()
def public_api(monkeypatch):
    clock = {"now": datetime(2026, 10, 21, 3, tzinfo=timezone.utc), "tick": 1000.0}
    monkeypatch.setattr(service, "_snapshot", None)
    monkeypatch.setattr(service, "_last_attempt", float("-inf"))
    monkeypatch.setattr(service, "_last_attempt_at", None)
    monkeypatch.setattr(service, "_last_failed", False)
    monkeypatch.setattr(service, "_warming", False)
    monkeypatch.setattr(service, "_now", lambda: clock["now"])
    monkeypatch.setattr(service.time, "monotonic", lambda: clock["tick"])
    monkeypatch.setattr(service, "_download", csv_bytes)
    app = FastAPI()
    app.include_router(routes.router, prefix="/api")
    return TestClient(app), clock


def test_public_sync_reports_actual_success_time_source_license_and_plain_text(public_api):
    api, _ = public_api
    result = api.get("/api/resources/anti-fraud").json()
    assert result["status"] == "ready" and result["stale"] is False
    assert result["lastSyncedAt"] == result["lastAttemptAt"] == "2026-10-21T03:00:00Z"
    assert result["source"]["url"] == "https://data.gov.tw/dataset/38262"
    assert result["source"]["downloadUrl"] == service.FEED_URL
    assert "政府資料開放授權" in result["source"]["license"]
    assert result["items"][0]["id"] == "new" and result["items"][1]["publishedAt"] == "2025-08-09"
    row = result["items"][0]
    assert row["title"] == "[FIXTURE] 防詐提醒" and row["publishedAt"] == "2026-10-20"
    assert "secret_code" not in row["summary"] and "<script>" not in row["summary"]
    assert "href" not in row["summary"] and "evil.test" not in row["summary"]
    assert row["url"] == service.DATASET_URL
    assert {entry["url"] for entry in result["officialLinks"]} == {"https://165.npa.gov.tw/", "https://165dashboard.tw/", service.DATASET_URL}


def test_cache_manual_refresh_throttle_and_response_copy(public_api, monkeypatch):
    api, clock = public_api
    calls = []
    monkeypatch.setattr(service, "_download", lambda: calls.append(1) or csv_bytes())
    first = api.get("/api/resources/anti-fraud").json()
    first["items"][0]["title"] = "mutated client"
    assert api.get("/api/resources/anti-fraud").json()["items"][0]["title"] != "mutated client"
    api.get("/api/resources/anti-fraud?refresh=true")
    assert len(calls) == 1
    clock["tick"] += 61
    api.get("/api/resources/anti-fraud?refresh=true")
    assert len(calls) == 2
    clock["tick"] += 3601
    clock["now"] += timedelta(hours=2)
    assert api.get("/api/resources/anti-fraud").json()["lastSyncedAt"] == "2026-10-21T05:00:00Z"
    assert len(calls) == 3


def test_provider_failure_retains_last_success_and_never_fabricates_freshness(public_api, monkeypatch, caplog):
    api, clock = public_api
    first = api.get("/api/resources/anti-fraud").json()
    clock["tick"] += 61
    clock["now"] += timedelta(hours=2)

    def broken():
        raise httpx.ConnectError("DO_NOT_LOG_THIS_SECRET_OR_BODY")

    monkeypatch.setattr(service, "_download", broken)
    # Application/uvicorn tests may configure this existing logger. Capture its
    # records in isolation without altering production logging behavior.
    monkeypatch.setattr(service.log, "disabled", False)
    monkeypatch.setattr(service.log, "propagate", True)
    with caplog.at_level(logging.WARNING, logger=service.log.name):
        response = api.get("/api/resources/anti-fraud?refresh=true").json()
    assert response["status"] == "stale" and response["stale"] is True
    assert response["items"] == first["items"] and response["lastSyncedAt"] == first["lastSyncedAt"]
    assert response["lastAttemptAt"] == "2026-10-21T05:00:00Z" and response["warning"]
    assert "DO_NOT_LOG" not in caplog.text and "ConnectError" in caplog.text


def test_no_cached_data_means_unavailable_with_official_links_not_fake_articles(public_api, monkeypatch):
    api, _ = public_api
    monkeypatch.setattr(service, "_download", lambda: b"<html>maintenance</html>")
    result = api.get("/api/resources/anti-fraud").json()
    assert result["status"] == "unavailable" and result["items"] == []
    assert result["lastSyncedAt"] is None and result["lastAttemptAt"] is not None
    assert result["warning"] and len(result["officialLinks"]) == 3


@pytest.mark.parametrize("payload", [b"", b"x" * (service.MAX_BYTES + 1), b"title,body\na,b\n", b"\xff\xfe\xff", "編號,標題,發佈時間,發佈內容\n".encode(), "編號,標題,發佈時間,發佈內容\nx,onlytwo\n".encode()])
def test_malformed_changed_or_oversized_csv_is_rejected(payload):
    with pytest.raises((ValueError, UnicodeError, csv.Error)):
        service._parse_csv(payload)


def test_cp950_multiline_csv_and_item_limits():
    rows = [[str(i), f"測試標題{i}", "115年10月20日", "多行\n文字，含逗號"] for i in range(40)]
    result = service._parse_csv(csv_bytes(rows, "cp950"))
    assert len(result) == service.MAX_ITEMS
    assert all(row["publishedAt"] == "2026-10-20" and row["summary"] == "多行 文字，含逗號" for row in result)


def test_download_uses_only_fixed_destination_no_redirects_and_bounds_stream(monkeypatch):
    calls = []
    transport = httpx.MockTransport(lambda request: calls.append(request) or httpx.Response(200, headers={"content-type": "text/csv; charset=utf-8"}, content=csv_bytes()))
    real_client = httpx.Client

    def client(**kwargs):
        assert kwargs["follow_redirects"] is False
        assert kwargs["timeout"].connect <= 4 and kwargs["timeout"].read <= 8
        return real_client(transport=transport, **kwargs)

    monkeypatch.setattr(service.httpx, "Client", client)
    assert service._parse_csv(service._download())
    assert len(calls) == 1 and str(calls[0].url) == service.FEED_URL
    assert "authorization" not in calls[0].headers and "cookie" not in calls[0].headers
    for response in [httpx.Response(302, headers={"location": "http://169.254.169.254/private"}), httpx.Response(200, headers={"content-type": "text/html"}, text="login"), httpx.Response(200, headers={"content-type": "text/csv"}, content=b"x" * (service.MAX_BYTES + 1))]:
        transport.handler = lambda request, response=response: response
        with pytest.raises((httpx.HTTPError, ValueError)):
            service._download()
    assert len(calls) == 1, "no redirect destination was requested"


def test_financial_references_are_primary_sourced_short_editorial_summaries(public_api):
    api, _ = public_api
    zh = api.get("/api/resources/financial").json()
    en = api.get("/api/resources/financial?language=en").json()
    assert zh["liveBookFeed"] is False and zh["mode"] == "curated-referenced-education"
    assert {item["id"] for item in zh["items"]} == {"money-behavior", "investing-costs", "emergency-fund"}
    for item in zh["items"]:
        assert item["title"] and item["author"] and item["publisher"] and item["url"].startswith("https://")
        assert len(item["principle"]) < 100 and len(item["application"]) < 100
        assert item["sourceVerifiedOn"] == "2026-10-21"
        assert item["contentLanguage"] == "zh-TW"
    assert all(item["contentLanguage"] == "en" for item in en["items"])
    for language in ("zh-TW", "zh-CN", "en", "ja", "ko", "es"):
        localized = api.get("/api/resources/financial", params={"language": language}).json()
        assert all(item["contentLanguage"] == language for item in localized["items"])
        assert localized["notice"] and all(item["principle"] and item["application"] for item in localized["items"])
    assert api.get("/api/resources/financial?language=xx").status_code == 422
    assert api.post("/api/resources/anti-fraud", json={"url": "http://127.0.0.1"}).status_code == 405


def test_background_warmup_does_not_block_startup_or_run_in_development(monkeypatch):
    from app.toolkit.config import settings
    monkeypatch.setattr(service, "_warming", False)
    monkeypatch.setattr(settings, "app_env", "development")
    threads = []

    class ThreadFixture:
        def __init__(self, **kwargs):
            threads.append(kwargs)

        def start(self):
            pass  # Not invoking the network function models a nonblocking daemon.

    monkeypatch.setattr(service.threading, "Thread", ThreadFixture)
    service.start_warmup()
    assert threads == []
    monkeypatch.setattr(settings, "app_env", "production")
    service.start_warmup()
    service.start_warmup()
    assert len(threads) == 1 and threads[0]["daemon"] is True
    assert threads[0]["target"] is service.anti_fraud
