"""發表前的端到端邊界：真實登入、資料寫入與登出後權限。"""

import os
from datetime import datetime, timedelta, timezone

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("JWT_SECRET", "release-test-secret-with-more-than-32-bytes")

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import Category, GroupMember, NlpParse, Transaction, UserSession
from app.services.llm import client as model_client
from app.toolkit import crud, db, tokens
from app.toolkit.config import settings


@pytest.fixture()
def release_api():
    original = str(db.engine.url)
    db.use_database("sqlite://")
    db.create_all()
    try:
        with TestClient(app) as api:
            yield api
    finally:
        db.drop_all()
        db.use_database(original)


def account(api, email="release@example.com"):
    response = api.post("/api/auth/register", json={
        "name": "展示使用者", "email": email, "password": "demo1234",
    })
    assert response.status_code == 201, response.text
    result = response.json()
    group = api.post("/api/groups", headers=headers(result), json={"name": "個人帳本"})
    assert group.status_code == 201, group.text
    return result


def headers(result):
    return {"Authorization": "Bearer " + result["accessToken"]}


def transaction_payload():
    category = crud.save(Category, {"name": "餐飲", "kind": "expense"})
    return {"date": "2026-10-14", "amount": 55, "kind": "expense", "cat": str(category.id)}


def test_logout_revokes_the_access_token_but_keeps_other_device(release_api):
    first = account(release_api)
    second = release_api.post("/api/auth/login", json={
        "email": "release@example.com", "password": "demo1234",
    }).json()
    assert release_api.get("/api/auth/me", headers=headers(first)).status_code == 200
    assert release_api.post("/api/auth/logout", headers=headers(first), json={}).status_code == 200
    assert release_api.get("/api/auth/me", headers=headers(first)).status_code == 401
    assert release_api.get("/api/auth/me", headers=headers(second)).status_code == 200


def test_logout_all_preserves_current_device_and_revokes_other_access_and_refresh(release_api):
    first = account(release_api)
    second = release_api.post("/api/auth/login", json={
        "email": "release@example.com", "password": "demo1234",
    }).json()
    response = release_api.post("/api/auth/logout-all", headers=headers(first))
    assert response.status_code == 200 and response.json() == {"revoked": 1}
    assert release_api.get("/api/auth/me", headers=headers(first)).status_code == 200
    assert release_api.get("/api/auth/me", headers=headers(second)).status_code == 401
    assert release_api.post("/api/auth/refresh", json={"refreshToken": second["refreshToken"]}).status_code == 401
    renewed = release_api.post("/api/auth/refresh", json={"refreshToken": first["refreshToken"]})
    assert renewed.status_code == 200
    assert release_api.get("/api/auth/me", headers=headers(renewed.json())).status_code == 200


def test_changing_password_revokes_other_device_access(release_api):
    first = account(release_api)
    second = release_api.post("/api/auth/login", json={
        "email": "release@example.com", "password": "demo1234",
    }).json()
    response = release_api.patch("/api/auth/password", headers=headers(first), json={
        "oldPassword": "demo1234", "newPassword": "updated5678",
    })
    assert response.status_code == 200, response.text
    assert release_api.get("/api/auth/me", headers=headers(first)).status_code == 200
    assert release_api.get("/api/auth/me", headers=headers(second)).status_code == 401


def test_session_cannot_be_used_for_another_user_and_expiry_is_checked(release_api):
    first = account(release_api)
    second = account(release_api, "other@example.com")
    first_payload = tokens.read_access_token(first["accessToken"])
    second_payload = tokens.read_access_token(second["accessToken"])
    mismatched = tokens.make_access_token(first_payload["sub"], extra={"sid": second_payload["sid"]})
    assert release_api.get("/api/auth/me", headers={"Authorization": "Bearer " + mismatched}).status_code == 401
    session = crud.get(UserSession, where={"user_id": int(first_payload["sub"])})
    crud.save(UserSession, {"id": session.id, "expires_at": datetime.now(timezone.utc) - timedelta(seconds=1)})
    assert release_api.get("/api/auth/me", headers=headers(first)).status_code == 401


def test_production_requires_a_session_and_suspended_users_are_blocked(release_api, monkeypatch):
    login = account(release_api)
    uid = int(tokens.read_access_token(login["accessToken"])["sub"])
    from app.models import User
    crud.save(User, {"id": uid, "email_verified_at": datetime.now(timezone.utc)})
    without_session = {"Authorization": "Bearer " + tokens.make_access_token(uid)}
    monkeypatch.setattr(settings, "app_env", "production")
    assert release_api.get("/api/auth/me", headers=without_session).status_code == 401
    assert release_api.get("/api/auth/me", headers=headers(login)).status_code == 200
    crud.save(User, {"id": uid, "suspended_at": datetime.now(timezone.utc), "suspended_reason": "測試停權"})
    assert release_api.get("/api/auth/me", headers=headers(login)).status_code == 403


@pytest.mark.parametrize("amount", [0.001, 1000000000000, "Infinity"])
def test_invalid_amount_never_creates_a_transaction(release_api, amount):
    login = account(release_api)
    payload = transaction_payload()
    response = release_api.post("/api/transactions", headers=headers(login), json={**payload, "amount": amount})
    assert response.status_code == 422, response.text
    assert crud.count(Transaction) == 0


def test_nlp_batch_validates_every_amount_before_writing(release_api):
    login = account(release_api)
    payload = transaction_payload()
    response = release_api.post("/api/nlp/confirm-batch", headers=headers(login), json={
        "items": [{**payload, "span": "早餐55"}, {**payload, "amount": 0.001}],
    })
    assert response.status_code == 422, response.text
    assert crud.count(Transaction) == 0
    assert crud.count(NlpParse) == 0


def test_rules_origin_is_preserved_and_amount_rounds_to_cents(release_api):
    login = account(release_api)
    payload = transaction_payload()
    response = release_api.post("/api/nlp/confirm", headers=headers(login), json={
        **payload, "amount": 55.125, "raw": "早餐55.125", "orig": {**payload, "by": "rules"},
    })
    assert response.status_code == 201, response.text
    assert response.json()["amount"] == 55.13
    record = crud.get(NlpParse, where={"transaction_id": int(response.json()["id"])})
    assert record.model_ver == "rules"


def test_settled_group_cannot_add_or_remove_members(release_api):
    parent = account(release_api)
    child = account(release_api, "child@example.com")
    created = release_api.post("/api/family", headers=headers(parent), json={"name": "展示家庭"})
    assert created.status_code == 201, created.text
    invitation = release_api.post("/api/family/invite", headers=headers(parent), json={"role": "child", "label": "子女"})
    assert invitation.status_code == 201, invitation.text
    joined = release_api.post("/api/family/join", headers=headers(child), json={"code": invitation.json()["code"]})
    assert joined.status_code == 200, joined.text
    child_id = tokens.read_access_token(child["accessToken"])["sub"]
    ledger = release_api.post("/api/groups", headers=headers(parent), json={
        "name": "畢業旅行", "kind": "temp", "endsOn": "2026-10-31",
    })
    assert ledger.status_code == 201, ledger.text
    gid = ledger.json()["id"]
    added = release_api.post(f"/api/groups/{gid}/members", headers=headers(parent), json={"userId": child_id})
    assert added.status_code == 201, added.text
    assert release_api.post(f"/api/groups/{gid}/settle", headers=headers(parent)).status_code == 200
    assert release_api.delete(f"/api/groups/{gid}/members/{child_id}", headers=headers(parent)).status_code == 409
    assert release_api.post(f"/api/groups/{gid}/members", headers=headers(parent), json={"userId": child_id}).status_code == 409
    assert crud.exists(GroupMember, {"group_id": int(gid), "user_id": int(child_id)})


@pytest.mark.parametrize("content", [None, {}, ""])
def test_malformed_model_content_is_a_service_error(monkeypatch, content):
    monkeypatch.setattr(model_client, "is_configured", lambda: True)
    response = {"choices": [{"message": {"content": content}}]}
    with httpx.Client(base_url="https://model.example.test", transport=httpx.MockTransport(
        lambda request: httpx.Response(200, json=response),
    )) as transport:
        with pytest.raises(model_client.ModelError):
            model_client.complete("早餐55", client=transport)
