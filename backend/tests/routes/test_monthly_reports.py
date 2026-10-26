"""Real SQL/HTTP monthly-grant tests; no external mail, Drive or live database."""
from datetime import datetime, timezone, timedelta
from decimal import Decimal
import csv
from io import StringIO
import hashlib

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import event, select

from app.models import Transaction, User
from app.models.report_subscription import ReportSubscription
from app.models.transaction_details import TransactionDetails
from app.routers.monthly_reports import router
from app.services import monthly_report as service
from app.toolkit import crud, db
from app.toolkit.config import settings
from tests.routes.conftest import categories, family_of, guard, ledger_of, login, spend, user


NOW = datetime(2026, 10, 26, 4, tzinfo=timezone.utc)
ROOT = "/api/monthly-reports"


@pytest.fixture
def client(monkeypatch):
    original = str(db.engine.url)
    db.use_database("sqlite://")
    db.create_all()
    monkeypatch.setattr(service, "_now", lambda: NOW)
    monkeypatch.setattr(settings, "app_base_url", "http://localhost:5174")
    monkeypatch.setattr(settings, "app_env", "development")
    monkeypatch.setattr(settings, "require_email_verification", False)
    service._failures.clear()
    app = FastAPI()
    app.include_router(router, prefix="/api")
    try:
        yield TestClient(app)
    finally:
        service._failures.clear()
        db.drop_all()
        db.use_database(original)


def verified(email="owner@example.test", name="月報使用者", **extra):
    return user(email, name, email_verified_at=NOW, **extra)


def authorize(client, owner, **extra):
    response = client.post(ROOT + "/authorize", headers=login(owner), json={"termsAccepted": True, **extra})
    assert response.status_code == 200, response.text
    return response.json()


def grant_headers(token):
    return {"Authorization": "Bearer " + token}


def test_settings_default_is_verified_personal_email_without_creating_subscription(client):
    owner = verified()
    response = client.get(ROOT + "/settings", headers=login(owner))
    assert response.status_code == 200
    body = response.json()
    assert body == {"enabled": False, "delivery": "email", "folderId": None,
                    "recipientEmail": owner.email, "recipientVerified": True, "authorizationActive": False,
                    "tokenExpiresAt": None, "scope": "only-me", "timezone": "Asia/Taipei", "scheduleDay": 1}
    with db.session_scope() as session:
        assert session.get(ReportSubscription, owner.id) is None
    assert client.get(ROOT + "/settings").status_code == 401


def test_enabling_requires_opt_in_and_actual_verified_email(client):
    owner, unverified = verified(), user("pending@example.test", "尚未驗證")
    for path in ("/settings", "/authorize"):
        method = client.put if path == "/settings" else client.post
        assert method(ROOT + path, headers=login(owner), json={"enabled": True}).status_code == 422
        assert method(ROOT + path, headers=login(unverified), json={"enabled": True, "termsAccepted": True}).status_code == 403
    assert client.post(ROOT + "/authorize", headers=login(owner), json={"termsAccepted": True, "enabled": False}).status_code == 422
    assert client.put(ROOT + "/settings", headers=login(unverified), json={"enabled": False}).status_code == 200


def test_unverified_or_changed_recipient_cannot_be_supplied(client):
    owner = verified()
    assert client.post(ROOT + "/authorize", headers=login(owner), json={
        "termsAccepted": True, "recipientEmail": "another@example.test"}).status_code == 422
    body = authorize(client, owner, recipientEmail="  ")
    assert body["settings"]["recipientEmail"] == owner.email
    assert body["settings"]["delivery"] == "email"
    assert body["settings"]["authorizationActive"] is True
    assert "token_hash" not in str(body["settings"])


def test_delivery_validation_folder_id_and_owner_only_settings(client):
    owner, another = verified(), verified("another@example.test")
    folder = "private_folder_1234567890"
    response = client.put(ROOT + "/settings", headers=login(owner), json={
        "enabled": True, "termsAccepted": True, "delivery": "both", "folderId": folder})
    assert response.status_code == 200
    assert response.json()["folderId"] == folder
    assert response.json()["authorizationActive"] is False, "saved opt-in is distinct from an active grant"
    assert client.get(ROOT + "/settings", headers=login(another)).json()["enabled"] is False
    for change in ({"delivery": "elsewhere"}, {"folderId": "https://example.test/x"}, {"userId": str(another.id)},
                   {"enabled": 1}, {"termsAccepted": "true"}):
        assert client.put(ROOT + "/settings", headers=login(owner), json=change).status_code == 422
    # Omitted delivery/recipient is explicitly the verified email default.
    result = client.put(ROOT + "/settings", headers=login(owner), json={"enabled": True, "termsAccepted": True}).json()
    assert result["delivery"] == "email" and result["folderId"] is None


def test_token_plaintext_is_never_stored_and_rotation_revokes_previous_grant(client):
    owner = verified()
    one = authorize(client, owner)
    assert one["exportUrl"] == "http://localhost:5174/api/monthly-reports/export"
    assert one["token"] not in one["exportUrl"]
    with db.session_scope() as session:
        row = session.get(ReportSubscription, owner.id)
        assert row.token_hash == hashlib.sha256(one["token"].encode()).hexdigest()
        assert row.token_hash != one["token"] and len(row.token_hash) == 64
        assert row.authorized_email == owner.email
    two = authorize(client, owner)
    assert one["token"] != two["token"]
    assert client.get(ROOT + "/export?period=2026-09", headers=grant_headers(one["token"])).status_code == 401
    assert client.get(ROOT + "/export?period=2026-09", headers=grant_headers(two["token"])).status_code == 200
    assert client.get(ROOT + "/settings", headers=grant_headers(two["token"])).status_code == 401
    assert client.put(ROOT + "/settings", headers=grant_headers(two["token"]), json={"enabled": False}).status_code == 401


def test_monthly_export_is_owner_only_even_with_shared_activities_and_guardianship(client):
    owner, child, friend = verified(), verified("child@example.test"), verified("friend@example.test")
    family_of((owner, "parent"), (child, "child"))
    guard(owner, child)
    shared = ledger_of(owner, child, friend, name="共同旅行")
    own = ledger_of(owner, name="自己的帳")
    cats = categories()
    tx = spend(owner, shared, cats["餐飲"], "12.30", day="2026-09-03", merchant="本人消費")
    spend(owner, own, cats["薪資"], "100.20", day="2026-09-01")
    spend(owner, own, cats["餐飲"], "80.00", day="2026-09-04", kind="transfer")
    spend(owner, own, cats["餐飲"], "999.00", day="2026-10-01")
    spend(child, shared, cats["餐飲"], "700.00", day="2026-09-03", merchant="孩子的消費")
    spend(friend, shared, cats["餐飲"], "800.00", day="2026-09-03", merchant="朋友的消費")
    crud.save(TransactionDetails, {"transaction_id": tx.id, "user_id": owner.id,
                                  "payment_method": "credit_card", "buyer_tax_id": "01234567"}, upsert=True)
    token = authorize(client, owner, delivery="both", folderId="private_folder_1234567890")["token"]
    response = client.get(ROOT + "/export?period=2026-09", headers=grant_headers(token))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["totals"] == {"income": "100.20", "expense": "12.30", "net": "87.90", "count": 3, "transferCount": 1}
    assert len(body["transactions"]) == 3
    assert "孩子的消費" not in response.text and "朋友的消費" not in response.text
    detail = next(row for row in body["transactions"] if row["merchant"] == "本人消費")
    assert detail["paymentMethod"] == "credit_card" and detail["buyerTaxId"] == "01234567"
    assert detail["activity"] == "共同旅行"
    assert {item["kind"] for item in body["categories"]} == {"income", "expense"}
    assert body["recipientEmail"] == owner.email and body["delivery"] == "both"
    assert response.headers["cache-control"] == "private, no-store"


def test_child_report_does_not_include_guardians_records(client):
    parent, child = verified(), verified("child@example.test")
    family_of((parent, "parent"), (child, "child"))
    guard(parent, child)
    shared = ledger_of(parent, child)
    cat = categories()["餐飲"]
    spend(parent, shared, cat, 500, day="2026-09-01")
    spend(child, shared, cat, 30, day="2026-09-01")
    result = client.get(ROOT + "/export?period=2026-09", headers=grant_headers(authorize(client, child)["token"]))
    assert result.status_code == 200 and result.json()["totals"]["expense"] == "30.00"


@pytest.mark.parametrize("change", ["expired", "disabled", "email_changed", "email_unverified", "suspended", "admin"])
def test_export_rechecks_grant_and_current_owner_eligibility(client, change):
    owner = verified()
    token = authorize(client, owner)["token"]
    with db.session_scope() as session:
        row, account = session.get(ReportSubscription, owner.id), session.get(User, owner.id)
        if change == "expired": row.token_expires_at = NOW - timedelta(seconds=1)
        if change == "disabled": row.enabled = False
        if change == "email_changed": account.email = "newly-verified@example.test"
        if change == "email_unverified": account.email_verified_at = None
        if change == "suspended": account.suspended_at = NOW
        if change == "admin": account.is_platform_admin = True
    assert client.get(ROOT + "/export?period=2026-09", headers=grant_headers(token)).status_code == 401


def test_revocation_is_account_scoped_and_prevents_export(client):
    owner, other = verified(), verified("other@example.test")
    token = authorize(client, owner)["token"]
    assert client.delete(ROOT + "/authorization", headers=login(other)).json()["enabled"] is False
    assert client.get(ROOT + "/export?period=2026-09", headers=grant_headers(token)).status_code == 200
    result = client.delete(ROOT + "/authorization", headers=login(owner)).json()
    assert result["enabled"] is False and result["authorizationActive"] is False and result["tokenExpiresAt"] is None
    assert client.get(ROOT + "/export?period=2026-09", headers=grant_headers(token)).status_code == 401


def test_bad_or_login_tokens_are_rejected_and_failure_rate_is_bounded(client, monkeypatch, caplog):
    owner = verified()
    monkeypatch.setattr(service, "_AUTH_MAX_FAILURES", 3)
    assert client.get(ROOT + "/export?period=2026-09").status_code == 401
    assert client.get(ROOT + "/export?period=2026-09", headers=login(owner)).status_code == 401
    bad = "A" * 43
    assert client.get(ROOT + "/export?period=2026-09", headers=grant_headers(bad)).status_code == 401
    assert client.get(ROOT + "/export?period=2026-09", headers=grant_headers(bad)).status_code == 429
    assert bad not in caplog.text and owner.email not in caplog.text


def test_completed_month_window_is_exact_and_does_not_accept_other_selectors(client):
    owner = verified()
    headers = grant_headers(authorize(client, owner)["token"])
    for month in ("2024-10", "2026-09"):
        assert client.get(ROOT + "/export?period=" + month, headers=headers).status_code == 200
    for month in ("2024-09", "2026-10", "2027-01", "2026-00", "2026-13", "2026-9"):
        assert client.get(ROOT + "/export?period=" + month, headers=headers).status_code == 422
    assert client.get(ROOT + "/export?period=2026-09&userId=2", headers=headers).status_code == 422
    assert client.get(ROOT + "/export?period=2026-09&token=unused", headers=headers).status_code == 422


def test_csv_formulas_and_html_markup_are_data_not_executable_content(client):
    owner = verified(name='<script>alert("name")</script>')
    cat = categories()["餐飲"]
    activity = ledger_of(owner, name="@SUM(A1:A5)")
    spend(owner, activity, cat, "0.10", day="2026-09-01", merchant="=HYPERLINK(\"https://bad.test\")",
          note="\t+SUM(1,2)\n<script>alert('note')</script>")
    spend(owner, activity, cat, "0.20", day="2026-09-02", merchant="普通商家")
    body = client.get(ROOT + "/export?period=2026-09", headers=grant_headers(authorize(client, owner)["token"])).json()
    assert body["totals"]["expense"] == "0.30"
    rows = list(csv.reader(StringIO(body["csv"].lstrip("\ufeff"))))
    assert rows[1][4].startswith("'=HYPERLINK") and rows[1][5].startswith("'\t+SUM")
    assert rows[1][6].startswith("'@SUM")
    assert "<script>" not in body["html"] and "&lt;script&gt;" in body["html"]
    assert body["transactions"][0]["merchant"].startswith("=HYPERLINK"), "source data is retained, escaping happens only in document formats"


def test_export_limits_reject_instead_of_silently_truncating(client, monkeypatch):
    owner = verified()
    cat, activity = categories()["餐飲"], ledger_of(owner)
    spend(owner, activity, cat, 1, day="2026-09-01")
    spend(owner, activity, cat, 2, day="2026-09-02")
    headers = grant_headers(authorize(client, owner)["token"])
    monkeypatch.setattr(service, "MAX_ROWS", 1)
    assert client.get(ROOT + "/export?period=2026-09", headers=headers).status_code == 422
    monkeypatch.setattr(service, "MAX_ROWS", 20_000)
    monkeypatch.setattr(service, "MAX_TEXT_BYTES", 1)
    assert client.get(ROOT + "/export?period=2026-09", headers=headers).status_code == 422


def test_successful_export_issues_only_reads_and_preserves_source_rows(client):
    owner = verified()
    cat, activity = categories()["餐飲"], ledger_of(owner)
    spend(owner, activity, cat, "25.55", day="2026-09-03")
    headers = grant_headers(authorize(client, owner)["token"])
    statements = []
    def observed(_connection, _cursor, statement, _parameters, _context, _many):
        statements.append(statement.lstrip().upper())
    event.listen(db.engine, "before_cursor_execute", observed)
    try:
        response = client.get(ROOT + "/export?period=2026-09", headers=headers)
    finally:
        event.remove(db.engine, "before_cursor_execute", observed)
    assert response.status_code == 200
    assert statements and all(query.startswith("SELECT") for query in statements), statements
    with db.session_scope() as session:
        rows = list(session.scalars(select(Transaction)))
        assert len(rows) == 1 and rows[0].amount == Decimal("25.55")


def test_export_url_uses_canonical_configuration_never_request_host(client, monkeypatch):
    owner = verified()
    monkeypatch.setattr(settings, "app_base_url", "https://fambudget.example.test")
    response = client.post(ROOT + "/authorize", headers={**login(owner), "Host": "untrusted.example.test"}, json={"termsAccepted": True})
    assert response.status_code == 200
    assert response.json()["exportUrl"] == "https://fambudget.example.test/api/monthly-reports/export"
    monkeypatch.setattr(settings, "app_base_url", "https://user:password@example.test")
    assert client.post(ROOT + "/authorize", headers=login(owner), json={"termsAccepted": True}).status_code == 503
