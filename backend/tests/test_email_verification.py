"""信箱驗證的真實 API 流程與正式環境限制，不呼叫外部寄信服務。"""

import os
from datetime import datetime, timedelta, timezone

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("JWT_SECRET", "email-verification-tests-more-than-32-characters")

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import EmailVerification, User, UserSession
from app.services import email_verification
from app.toolkit import crud, db, mailer, tokens
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
    assert result.status_code == 200 and result.json()["message"] == email_verification.GENERIC_MESSAGE
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
