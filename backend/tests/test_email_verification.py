"""信箱驗證的真實 API 流程與正式環境限制，不呼叫外部寄信服務。"""

import json
import os
from datetime import datetime, timedelta, timezone
from html import escape
from html.parser import HTMLParser

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("JWT_SECRET", "email-verification-tests-more-than-32-characters")

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import EmailVerification, User, UserSession
from app.services import email_verification
from app.services.mail_content import FALLBACK, VERIFICATION_HOURS, verification_message
from app.toolkit import crud, db, mailer, password_reset, tokens
from app.toolkit.config import Settings, settings

REQUEST = "/api/auth/email-verification/request"
CONFIRM = "/api/auth/email-verification/confirm"


@pytest.fixture()
def email_api(monkeypatch):
    original = str(db.engine.url)
    monkeypatch.setattr(settings, "app_env", "development")
    monkeypatch.setattr(settings, "require_email_verification", None)
    monkeypatch.setattr(settings, "brevo_api_key", "")
    monkeypatch.setattr(settings, "mail_from", "")
    monkeypatch.setattr(settings, "app_base_url", "http://localhost:5174")
    db.use_database("sqlite://")
    db.create_all()
    try:
        with TestClient(app) as api:
            yield api
    finally:
        db.drop_all()
        db.use_database(original)


def register(api, email="verify@example.com"):
    response = api.post("/api/auth/register", json={"name": "信箱測試", "email": email, "password": "test1234"})
    assert response.status_code == 201, response.text
    return response.json()


def demo_token(api, email="verify@example.com"):
    response = api.post(REQUEST, json={"email": email})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["delivery"] == "demo" and "沒有寄出郵件" in result["message"]
    return result["demoVerificationUrl"].rsplit("/", 1)[-1]


def auth(result):
    return {"Authorization": "Bearer " + result["accessToken"]}


def test_demo_verification_stores_only_hash_and_changes_account_status(email_api):
    login = register(email_api)
    assert login["user"]["emailVerified"] is False
    assert email_api.get("/api/auth/me", headers=auth(login)).json()["user"]["emailVerified"] is False
    token = demo_token(email_api)
    row = crud.get(EmailVerification, where={"user_id": int(login["user"]["id"])})
    assert row.token_hash == tokens.fingerprint(token) and row.token_hash != token
    assert email_api.post(CONFIRM, json={"token": token}).json() == {
        "ok": True, "emailVerified": True, "email": "verify@example.com",
    }
    assert email_api.get("/api/auth/me", headers=auth(login)).json()["user"]["emailVerified"] is True
    assert email_api.post(CONFIRM, json={"token": token}).status_code == 400


def test_reissue_has_cooldown_and_revokes_the_previous_link(email_api):
    register(email_api)
    original_token = demo_token(email_api)
    repeated = email_api.post(REQUEST, json={"email": "verify@example.com"})
    assert repeated.status_code == 200 and "demoVerificationUrl" not in repeated.json()
    assert crud.count(EmailVerification) == 1
    row = crud.get(EmailVerification, where={"token_hash": tokens.fingerprint(original_token)})
    crud.save(EmailVerification, {"id": row.id, "created_at": datetime.now(timezone.utc) - timedelta(seconds=61)})
    new_token = demo_token(email_api)
    assert new_token != original_token
    assert email_api.post(CONFIRM, json={"token": original_token}).status_code == 400
    assert email_api.post(CONFIRM, json={"token": new_token}).status_code == 200


def test_expired_unknown_and_used_links_have_the_same_error(email_api):
    register(email_api)
    token = demo_token(email_api)
    row = crud.get(EmailVerification, where={"token_hash": tokens.fingerprint(token)})
    crud.save(EmailVerification, {"id": row.id, "expires_at": datetime.now(timezone.utc) - timedelta(seconds=1)})
    expired = email_api.post(CONFIRM, json={"token": token})
    unknown = email_api.post(CONFIRM, json={"token": "z" * 43})
    malformed = email_api.post(CONFIRM, json={"token": "wrong"})
    assert expired.status_code == unknown.status_code == malformed.status_code == 400
    assert expired.json() == unknown.json() == malformed.json()
    assert token not in expired.text and "z" * 43 not in unknown.text
    assert crud.get(User, where={"email": "verify@example.com"}).email_verified_at is None


def test_production_registration_requires_verification_and_never_exposes_demo(email_api, monkeypatch):
    monkeypatch.setattr(settings, "app_env", "production")
    created = register(email_api)
    assert created["verificationRequired"] is True
    assert "accessToken" not in created and "refreshToken" not in created
    assert crud.count(UserSession) == 0
    result = email_api.post("/api/auth/login", json={"email": "verify@example.com", "password": "test1234"})
    assert result.status_code == 403 and "信箱驗證" in result.json()["detail"]
    missing_mail = email_api.post(REQUEST, json={"email": "verify@example.com"})
    assert missing_mail.status_code == 503 and "demoVerificationUrl" not in missing_mail.text
    assert crud.count(EmailVerification) == 0
    monkeypatch.setattr(settings, "require_email_verification", False)
    assert email_api.post(REQUEST, json={"email": "verify@example.com"}).status_code == 503
    assert email_api.post("/api/auth/login", json={"email": "verify@example.com", "password": "test1234"}).status_code == 403
    assert settings.email_verification_required is True


def test_production_requests_do_not_enumerate_and_confirmation_enables_login(email_api, monkeypatch):
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "brevo_api_key", "test-only-key")
    monkeypatch.setattr(settings, "mail_from", "sender@example.com")
    monkeypatch.setattr(settings, "app_base_url", "https://budget.example.com")
    sent = []
    monkeypatch.setattr(mailer, "send_mail", lambda to, subject, text, html, **kwargs: sent.append(text))
    register(email_api)
    existing = email_api.post(REQUEST, json={"email": "verify@example.com"})
    unknown = email_api.post(REQUEST, json={"email": "absent@example.com"})
    assert existing.status_code == unknown.status_code == 200
    assert existing.json() == unknown.json() and "demoVerificationUrl" not in existing.json()
    assert len(sent) == 1
    token = sent[0].split("/#/verify-email/", 1)[1].split()[0]
    assert email_api.post(CONFIRM, json={"token": token}).status_code == 200
    login = email_api.post("/api/auth/login", json={"email": "verify@example.com", "password": "test1234"})
    assert login.status_code == 200 and login.json()["user"]["emailVerified"] is True
    already = email_api.post(REQUEST, json={"email": "verify@example.com"})
    assert already.json() == unknown.json() and len(sent) == 1


def test_unrelated_members_verify_their_own_addresses_and_keep_private_ledgers(email_api, monkeypatch):
    """Local production-config API proof; Brevo HTTP acceptance is mocked, not live delivery."""
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "brevo_api_key", "test-only-key")
    monkeypatch.setattr(settings, "mail_from", "sender@example.com")
    monkeypatch.setattr(settings, "app_base_url", "https://budget.example.com")
    addresses = ("new.member+one@example.org", "another.member@example.net")
    messages = []

    def accept_message(request):
        assert str(request.url) == mailer.API_URL
        messages.append(json.loads(request.content))
        return httpx.Response(201, json={"messageId": "local-mocked-provider-acceptance"})

    send_mail = mailer.send_mail
    with httpx.Client(transport=httpx.MockTransport(accept_message)) as provider:
        monkeypatch.setattr(mailer, "send_mail", lambda *args, **kwargs: send_mail(
            *args, **kwargs, client=provider))
        accounts = [register(email_api, address.upper()) for address in addresses]
        assert len({account["user"]["id"] for account in accounts}) == 2
        for address, account in zip(addresses, accounts):
            assert account["verificationRequired"] is True
            assert account["user"]["email"] == address
            assert "accessToken" not in account and "refreshToken" not in account
            assert email_api.post("/api/auth/login", json={
                "email": address, "password": "test1234",
            }).status_code == 403
            requested = email_api.post(REQUEST, json={"email": address})
            assert requested.status_code == 200 and requested.json()["delivery"] == "email"
            assert "demoVerificationUrl" not in requested.json()

    assert [message["to"][0]["email"] for message in messages] == list(addresses)
    links = [message["textContent"].split("/#/verify-email/", 1)[1].split()[0]
             for message in messages]
    assert links[0] != links[1]
    assert crud.count(UserSession) == 0
    assert email_api.post(CONFIRM, json={"token": links[0]}).json()["email"] == addresses[0]
    assert crud.get(User, where={"email": addresses[1]}).email_verified_at is None
    assert email_api.post("/api/auth/login", json={
        "email": addresses[1], "password": "test1234",
    }).status_code == 403
    assert email_api.post(CONFIRM, json={"token": links[1]}).json()["email"] == addresses[1]

    headers = []
    ledgers = []
    for address, account in zip(addresses, accounts):
        logged_in = email_api.post("/api/auth/login", json={"email": address, "password": "test1234"})
        assert logged_in.status_code == 200
        headers.append(auth(logged_in.json()))
        me = email_api.get("/api/auth/me", headers=headers[-1]).json()["user"]
        assert me["id"] == account["user"]["id"] and me["email"] == address
        created = email_api.post("/api/groups", headers=headers[-1], json={"name": "My private ledger"})
        assert created.status_code == 201
        ledgers.append(created.json())

    for index, own_headers in enumerate(headers):
        listed = email_api.get("/api/groups", headers=own_headers)
        assert listed.status_code == 200
        assert [ledger["id"] for ledger in listed.json()["groups"]] == [ledgers[index]["id"]]
        other_id = ledgers[1 - index]["id"]
        assert email_api.get("/api/transactions", headers=own_headers,
                             params={"groupId": other_id}).status_code == 403


def test_daily_send_limit_and_confirmation_attempt_limit(email_api):
    login = register(email_api)
    uid = int(login["user"]["id"])
    now = datetime.now(timezone.utc)
    for number in range(email_verification.DAILY_SEND_LIMIT):
        crud.save(EmailVerification, {"user_id": uid, "token_hash": tokens.fingerprint(str(number) * 43),
                                     "created_at": now - timedelta(minutes=number + 2),
                                     "expires_at": now + timedelta(minutes=30)})
    response = email_api.post(REQUEST, json={"email": "verify@example.com"})
    assert response.status_code == 200 and "demoVerificationUrl" not in response.json()
    assert crud.count(EmailVerification) == email_verification.DAILY_SEND_LIMIT
    for _ in range(20):
        assert email_api.post(CONFIRM, json={"token": "z" * 43}).status_code == 400
    assert email_api.post(CONFIRM, json={"token": "z" * 43}).status_code == 429


def test_old_development_sessions_cannot_bypass_production_requirement(email_api, monkeypatch):
    login = register(email_api)
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "require_email_verification", False)
    assert email_api.get("/api/auth/me", headers=auth(login)).status_code == 403
    assert email_api.post("/api/auth/refresh", json={"refreshToken": login["refreshToken"]}).status_code == 403


def test_client_cannot_mark_its_email_verified_via_profile_or_registration(email_api):
    response = email_api.post("/api/auth/register", json={
        "name": "信箱測試", "email": "verify@example.com", "password": "test1234",
        "emailVerified": True, "email_verified_at": "2026-10-14T00:00:00Z",
    })
    assert response.status_code == 201 and response.json()["user"]["emailVerified"] is False
    for payload in ({"emailVerified": True}, {"email_verified_at": "2026-10-14T00:00:00Z"}):
        assert email_api.patch("/api/auth/me", headers=auth(response.json()), json=payload).status_code == 422
    assert crud.get(User, where={"email": "verify@example.com"}).email_verified_at is None


def test_mail_failure_is_generic_and_logs_neither_recipient_nor_token(email_api, monkeypatch, caplog):
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "brevo_api_key", "test-only-key")
    monkeypatch.setattr(settings, "mail_from", "sender@example.com")
    monkeypatch.setattr(settings, "app_base_url", "https://budget.example.com")
    register(email_api)
    def fail(*args, **kwargs):
        raise mailer.MailError("verify@example.com secret-token test-only-key")
    monkeypatch.setattr(mailer, "send_mail", fail)
    result = email_api.post(REQUEST, json={"email": "verify@example.com"})
    assert result.status_code == 503 and "暫時無法寄出" in result.json()["detail"]
    assert crud.count(EmailVerification) == 0
    monkeypatch.setattr(mailer, "send_mail", lambda *args, **kwargs: "provider-accepted")
    assert email_api.post(REQUEST, json={"email": "verify@example.com"}).status_code == 200
    assert crud.count(EmailVerification) == 1
    assert "verify@example.com" not in caplog.text and "secret-token" not in caplog.text and "test-only-key" not in caplog.text


def test_blank_verification_setting_preserves_production_requirement(tmp_path, monkeypatch):
    monkeypatch.delenv("REQUIRE_EMAIL_VERIFICATION", raising=False)
    example = tmp_path / ".env"
    example.write_text("REQUIRE_EMAIL_VERIFICATION=\n", encoding="utf-8")
    config = {"_env_file": example, "database_url": "sqlite://", "jwt_secret": "test-only-secret-longer-than-32-bytes"}
    production = Settings(**config, app_env="production")
    development = Settings(**config, app_env="development")
    assert production.require_email_verification is None and production.email_verification_required is True
    assert development.require_email_verification is None and development.email_verification_required is False
    assert Settings(**config, app_env="production", require_email_verification="  ").email_verification_required is True
    assert Settings(**config, app_env="production", require_email_verification=False).email_verification_required is True


@pytest.mark.parametrize("base_url", ["http://localhost:5174", "http://budget.example.com", "https://", "https://budget.example.com/#/login"])
def test_production_verification_never_sends_unusable_or_insecure_links(email_api, monkeypatch, base_url):
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "brevo_api_key", "test-only-key")
    monkeypatch.setattr(settings, "mail_from", "sender@example.com")
    monkeypatch.setattr(settings, "app_base_url", base_url)
    register(email_api)
    sent = []
    monkeypatch.setattr(mailer, "send_mail", lambda *args, **kwargs: sent.append(args))
    known = email_api.post(REQUEST, json={"email": "verify@example.com"})
    unknown = email_api.post(REQUEST, json={"email": "absent@example.com"})
    assert known.status_code == unknown.status_code == 503 and known.json() == unknown.json()
    assert sent == [] and crud.count(EmailVerification) == 0


@pytest.mark.parametrize("language,subject_part", [
    ("zh-TW", "驗證"), ("zh-CN", "验证"), ("en", "Verify"),
    ("ja", "確認"), ("ko", "인증"), ("es", "Verifica"),
])
def test_real_delivery_uses_selected_language_and_single_use_link(email_api, monkeypatch, language, subject_part):
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "brevo_api_key", "test-only-key")
    monkeypatch.setattr(settings, "mail_from", "sender@example.com")
    monkeypatch.setattr(settings, "app_base_url", "https://budget.example.com")
    messages = []
    monkeypatch.setattr(mailer, "send_mail", lambda to, subject, text, html, **kwargs: messages.append((subject, text)))
    register(email_api)
    response = email_api.post(REQUEST, json={"email": "verify@example.com", "language": language})
    assert response.status_code == 200 and response.json()["delivery"] == "email"
    assert "demoVerificationUrl" not in response.json()
    subject, text = messages[0]
    assert subject_part in subject
    token = text.split("/#/verify-email/", 1)[1].split()[0]
    assert email_api.post(CONFIRM, json={"token": token}).status_code == 200
    assert email_api.post(CONFIRM, json={"token": token}).status_code == 400


@pytest.mark.parametrize("language,expiry", [
    ("zh-TW", "24 小時"), ("zh-CN", "24 小时"), ("en", "24 hours"),
    ("ja", "24時間"), ("ko", "24시간"), ("es", "24 horas"),
])
def test_verification_email_has_styled_button_visible_fallback_and_escaped_names(language, expiry):
    class Links(HTMLParser):
        def __init__(self):
            super().__init__()
            self.anchors, self.visible = [], []
        def handle_starttag(self, tag, attrs):
            if tag == "a":
                self.anchors.append(dict(attrs))
        def handle_data(self, data):
            self.visible.append(data)

    name = '小明 <script>alert("x")</script> & "家人"'
    link = "https://budget.example.com/#/verify-email/" + "a" * 43
    _subject, text, markup = verification_message(name, link, language)
    parsed = Links()
    parsed.feed(markup)
    assert [anchor["href"] for anchor in parsed.anchors] == [link, link]
    assert "background:#176b5d" in parsed.anchors[0]["style"] and "padding:" in parsed.anchors[0]["style"]
    assert link in parsed.visible and FALLBACK[language] in parsed.visible
    assert name in text and escape(name) in markup and "<script>" not in markup
    assert link in text and FALLBACK[language] in text and expiry in text and expiry in markup


def test_verification_expiry_is_twenty_four_hours_and_password_reset_stays_thirty_minutes(email_api, monkeypatch):
    register(email_api)
    before = datetime.now(timezone.utc)
    token = demo_token(email_api)
    after = datetime.now(timezone.utc)
    row = crud.get(EmailVerification, where={"token_hash": tokens.fingerprint(token)})
    expiry = row.expires_at.replace(tzinfo=timezone.utc) if row.expires_at.tzinfo is None else row.expires_at
    assert VERIFICATION_HOURS == 24 and email_verification.TOKEN_MINUTES == 1440
    assert before + timedelta(hours=24) <= expiry <= after + timedelta(hours=24)
    assert password_reset.TOKEN_MINUTES == 30

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            value = after + timedelta(hours=23)
            return value.astimezone(tz) if tz else value.replace(tzinfo=None)

    monkeypatch.setattr(password_reset, "datetime", Clock)
    assert email_api.post(CONFIRM, json={"token": token}).status_code == 200
    assert email_api.post(CONFIRM, json={"token": token}).status_code == 400


def test_verification_link_older_than_twenty_four_hours_is_rejected(email_api, monkeypatch):
    register(email_api)
    token = demo_token(email_api)
    future = datetime.now(timezone.utc) + timedelta(hours=25)

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return future.astimezone(tz) if tz else future.replace(tzinfo=None)

    monkeypatch.setattr(password_reset, "datetime", Clock)
    assert email_api.post(CONFIRM, json={"token": token}).status_code == 400
    assert crud.get(User, where={"email": "verify@example.com"}).email_verified_at is None
