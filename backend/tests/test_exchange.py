"""Reference FX quotes: precision, cache lifetime and honest provider failures."""

from dataclasses import replace
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.analytics import exchange as exchange_routes
from app.services import exchange


@pytest.fixture()
def fx(monkeypatch):
    now = datetime(2026, 10, 14, 12, tzinfo=timezone.utc)
    clock = {"now": now, "tick": 10_000.0}
    quote = exchange.Snapshot(
        rates={"USD": Decimal("1"), "TWD": Decimal("32.125"), "JPY": Decimal("150"),
               "EUR": Decimal("0.9"), "KWD": Decimal("0.3065")},
        provider="Test fixture; never live data", source_url="https://example.test/quotes",
        updated_at="2026-10-14T12:00:00Z", as_of=now, precision="second",
        next_update_at=None, fetched_at=now,
    )
    monkeypatch.setattr(exchange, "_snapshot", quote)
    monkeypatch.setattr(exchange, "_last_attempt", float("-inf"))
    monkeypatch.setattr(exchange, "_last_refresh_failed", False)
    monkeypatch.setattr(exchange, "_now", lambda: clock["now"])
    monkeypatch.setattr(exchange.time, "monotonic", lambda: clock["tick"])
    app = FastAPI()
    app.include_router(exchange_routes.router, prefix="/api")
    yield TestClient(app), clock, quote


def request_conversion(api, amount="100", source="USD", target="TWD"):
    return api.post("/api/exchange/convert", json={
        "amount": amount, "fromCurrency": source, "toCurrency": target,
    })


def test_decimal_conversion_and_response_preserve_precision(fx):
    api, _, _ = fx
    body = request_conversion(api, "0.1").json()
    assert body["amount"] == "0.1"
    assert body["rate"] == "32.125"
    assert body["convertedAmount"] == "3.21"
    assert body["decimalPlaces"] == 2
    assert body["provider"] == "Test fixture; never live data"
    assert body["updatedAt"] == "2026-10-14T12:00:00Z"
    assert body["stale"] is False


def test_cross_rates_reverse_rates_and_same_currency(fx):
    api, _, _ = fx
    assert request_conversion(api, "3212.5", "twd", "usd").json()["convertedAmount"] == "100.00"
    assert request_conversion(api, "0.9", "EUR", "JPY").json()["convertedAmount"] == "150"
    assert request_conversion(api, "2.125", "TWD", "TWD").json()["convertedAmount"] == "2.13"
    rates = api.get("/api/exchange/rates", params={"base": "TWD"}).json()
    assert rates["base"] == "TWD"
    assert rates["rates"]["TWD"] == "1"
    assert Decimal(rates["rates"]["USD"]) * Decimal("32.125") == Decimal("1")


@pytest.mark.parametrize("target, amount, expected, places", [
    ("JPY", "0.003", "0", 0), ("JPY", "0.01", "2", 0),
    ("KWD", "1", "0.307", 3), ("TWD", "0", "0.00", 2),
])
def test_target_currency_rounding_and_zero(fx, target, amount, expected, places):
    response = request_conversion(fx[0], amount, target=target)
    assert response.status_code == 200
    assert response.json()["convertedAmount"] == expected
    assert response.json()["decimalPlaces"] == places


@pytest.mark.parametrize("amount", ["-1", "NaN", "Infinity", "-Infinity", True, "", "text", "1e16", "0.12345678901"])
def test_invalid_amount_is_rejected(fx, amount):
    assert request_conversion(fx[0], amount).status_code == 422


@pytest.mark.parametrize("currency", ["XYZ", "BTC", "XAU", "US", "TWDx", "£££"])
def test_unknown_crypto_and_metal_currency_codes_are_rejected(fx, currency):
    api, _, _ = fx
    assert request_conversion(api, source=currency).status_code == 422
    assert api.get("/api/exchange/rates", params={"base": currency}).status_code == 422


def test_legal_currency_with_missing_provider_quote_is_rejected(fx):
    assert request_conversion(fx[0], source="HKD").status_code == 422


def test_hourly_cache_and_manual_refresh_throttle(fx, monkeypatch):
    api, clock, quote = fx
    calls = []
    monkeypatch.setattr(exchange, "_load_primary", lambda now: calls.append(now) or replace(quote, fetched_at=now))
    api.get("/api/exchange/rates")
    assert calls == []
    api.get("/api/exchange/rates", params={"refresh": True})
    api.get("/api/exchange/rates", params={"refresh": True})
    assert len(calls) == 1
    clock["tick"] += 61
    api.get("/api/exchange/rates", params={"refresh": True})
    assert len(calls) == 2
    clock["now"] += timedelta(hours=2)
    clock["tick"] += 7200
    api.get("/api/exchange/rates")
    assert len(calls) == 3


def unavailable(now):
    raise httpx.ConnectError("test fixture source offline")


def test_refresh_failure_marks_existing_quotes_stale(fx, monkeypatch):
    api, _, _ = fx
    monkeypatch.setattr(exchange, "_load_primary", unavailable)
    monkeypatch.setattr(exchange, "_load_fallback", unavailable)
    body = api.get("/api/exchange/rates", params={"refresh": True}).json()
    assert body["stale"] is True
    assert "先前行情" in body["warning"]
    assert request_conversion(api).json()["stale"] is True


def test_expired_quote_cannot_be_reused(fx, monkeypatch):
    api, clock, _ = fx
    monkeypatch.setattr(exchange, "_load_primary", unavailable)
    monkeypatch.setattr(exchange, "_load_fallback", unavailable)
    clock["now"] += timedelta(hours=49)
    response = api.get("/api/exchange/rates")
    assert response.status_code == 503
    assert response.headers["retry-after"] == "60"
    assert request_conversion(api).status_code == 503


def test_first_load_failure_returns_503_and_does_not_invent_rates(fx, monkeypatch):
    api, _, _ = fx
    monkeypatch.setattr(exchange, "_snapshot", None)
    monkeypatch.setattr(exchange, "_load_primary", unavailable)
    monkeypatch.setattr(exchange, "_load_fallback", unavailable)
    response = request_conversion(api)
    assert response.status_code == 503
    assert "虛構行情" in response.json()["detail"]
    assert "rate" not in response.json()


def provider_rates():
    return {code.lower(): value for code, value in {
        "USD": "1", "TWD": "32.125", "EUR": "0.9", "JPY": "150", "GBP": "0.75",
        "CNY": "7", "KRW": "1400", "HKD": "7.8", "THB": "33", "VND": "25000",
        "BTC": "0.00001", "XAU": "0.0003", "ATS": "13.76",
    }.items()}


def test_daily_fallback_is_identified_and_non_fiat_codes_filtered(fx, monkeypatch):
    api, clock, _ = fx
    seen = []
    def read(url):
        seen.append(url)
        if url == exchange.PRIMARY_URL:
            raise httpx.ProxyError("fixture proxy refusal")
        return {"date": clock["now"].date().isoformat(), "usd": provider_rates()}
    monkeypatch.setattr(exchange, "_snapshot", None)
    monkeypatch.setattr(exchange, "_read_json", read)
    body = api.get("/api/exchange/rates").json()
    assert seen == [exchange.PRIMARY_URL, exchange.FALLBACK_URL]
    assert body["updatePrecision"] == "day"
    assert body["updatedAt"] == "2026-10-14"
    assert "每日彙整" in body["provider"]
    assert body["sourceUrl"] == "https://github.com/fawazahmed0/exchange-api"
    assert "非銀行即時成交價" in body["warning"]
    assert not {"BTC", "XAU", "ATS"} & set(body["rates"])


def test_primary_timestamp_and_next_update_are_preserved(fx, monkeypatch):
    api, clock, _ = fx
    monkeypatch.setattr(exchange, "_snapshot", None)
    monkeypatch.setattr(exchange, "_read_json", lambda url: {
        "result": "success", "base_code": "USD",
        "time_last_update_unix": int(clock["now"].timestamp()),
        "time_next_update_unix": int((clock["now"] + timedelta(days=1)).timestamp()),
        "rates": {code.upper(): value for code, value in provider_rates().items()},
    })
    body = api.get("/api/exchange/rates").json()
    assert body["provider"] == "ExchangeRate-API Open Access"
    assert body["updatePrecision"] == "second"
    assert body["updatedAt"] == "2026-10-14T12:00:00Z"
    assert body["nextUpdateAt"] == "2026-10-15T12:00:00Z"
    assert body["stale"] is False
    assert body["warning"] is None


@pytest.mark.parametrize("rate", ["NaN", "Infinity", "0", "-1", True, "1e30", "1e-30"])
def test_bad_provider_rate_rejected_not_cached(fx, monkeypatch, rate):
    api, _, _ = fx
    def read(url):
        rates = provider_rates()
        rates["twd"] = rate
        return {"date": "2026-10-14", "usd": rates}
    monkeypatch.setattr(exchange, "_snapshot", None)
    monkeypatch.setattr(exchange, "_load_primary", unavailable)
    monkeypatch.setattr(exchange, "_read_json", read)
    assert api.get("/api/exchange/rates").status_code == 503
    assert exchange._snapshot is None


@pytest.mark.parametrize("date", ["2026-10-10", "2026-10-16", "not-a-date"])
def test_bad_provider_date_rejected(fx, monkeypatch, date):
    api, _, _ = fx
    monkeypatch.setattr(exchange, "_snapshot", None)
    monkeypatch.setattr(exchange, "_load_primary", unavailable)
    monkeypatch.setattr(exchange, "_read_json", lambda url: {"date": date, "usd": provider_rates()})
    assert api.get("/api/exchange/rates").status_code == 503
