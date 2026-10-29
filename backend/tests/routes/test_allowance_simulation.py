"""Real HTTP/SQLite fixtures; simulation never mutates real financial tables."""
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.models import Allowance, AuditLog, Guardianship, Transaction
from app.routers.allowance_simulation import router
from app.toolkit import crud, db
from tests.routes.conftest import family_of, guard, login, now, user


@pytest.fixture
def client():
    original = str(db.engine.url)
    db.use_database("sqlite://")
    db.create_all()
    app = FastAPI()
    app.include_router(router, prefix="/api")
    try:
        yield TestClient(app)
    finally:
        db.drop_all()
        db.use_database(original)


def people():
    parent, child = user("parent@simulation.test", "家長"), user("child@simulation.test", "小朋友")
    guard(parent, child)
    return parent, child


def body(child, **extra):
    return {"wardId": str(child.id), "amount": "200", "note": "本週零用錢，先存50元", "idempotencyKey": str(uuid4()), **extra}


def issue(client, parent, payload):
    return client.post("/api/allowance-simulation", headers=login(parent), json=payload)


def listed(client, me, **query):
    result = client.get("/api/allowance-simulation", headers=login(me), params=query)
    assert result.status_code == 200, result.text
    return result.json()


def test_both_participants_share_one_simulation_but_no_real_money_changes(client):
    parent, child = people()
    crud.save(Allowance, {"payer_id": parent.id, "ward_id": child.id, "amount": 500})
    response = issue(client, parent, body(child))
    assert response.status_code == 201, response.text
    result = response.json()
    assert result["simulation"] is True and result["replayed"] is False
    assert result["item"]["amount"] == "200"
    assert result["item"]["guardianName"] == "家長" and result["item"]["wardName"] == "小朋友"
    assert listed(client, parent)["items"] == listed(client, child)["items"] == [result["item"]]
    assert listed(client, parent)["recipients"] == [{"id": str(child.id), "name": "小朋友"}]
    assert listed(client, child)["recipients"] == []
    assert crud.count(Transaction) == 0
    assert crud.count(Allowance) == 1 and str(crud.find(Allowance)[0].amount) == "500.00"


def test_neither_family_members_nor_other_guardians_can_read_someone_elses_simulation(client):
    parent, child = people()
    other = user("other@simulation.test", "另一位家長")
    stranger = user("stranger@simulation.test", "陌生人")
    family_of((parent, "parent"), (other, "parent"), (child, "child"))
    guard(other, child)
    assert issue(client, parent, body(child)).status_code == 201
    for me in (other, stranger):
        assert listed(client, me)["items"] == []
    assert listed(client, stranger)["recipients"] == []
    assert issue(client, stranger, body(child)).status_code == 403
    assert issue(client, child, body(parent)).status_code == 403
    assert crud.count(AuditLog) == 1


def test_identical_retries_replay_once_different_payload_conflicts(client):
    parent, child = people()
    payload = body(child)
    first = issue(client, parent, payload)
    assert first.status_code == 201
    replay = issue(client, parent, payload)
    assert replay.status_code == 201 and replay.json()["replayed"] is True
    assert replay.json()["item"] == first.json()["item"]
    for patch in ({"amount": 201}, {"note": "另一筆"}, {"wardId": str(parent.id)}):
        assert issue(client, parent, {**payload, **patch}).status_code == 409
    assert crud.count(AuditLog) == 1


def test_operation_keys_are_scoped_to_the_issuer(client):
    parent, child = people()
    other = user("another@simulation.test", "另一位家長")
    guard(other, child)
    payload = body(child)
    assert issue(client, parent, payload).status_code == 201
    result = issue(client, other, payload)
    assert result.status_code == 201 and result.json()["replayed"] is False
    assert crud.count(AuditLog) == 2


def test_revocation_preserves_history_and_replay_but_prevents_new_issuance(client):
    parent, child = people()
    payload = body(child)
    assert issue(client, parent, payload).status_code == 201
    crud.save(Guardianship, {"ended_at": now()}, where={"guardian_id": parent.id})
    assert listed(client, parent)["recipients"] == []
    assert len(listed(client, child)["items"]) == 1
    assert issue(client, parent, body(child)).status_code == 403
    assert issue(client, parent, payload).json()["replayed"] is True
    assert crud.count(AuditLog) == 1


@pytest.mark.parametrize("amount", [0, -1, "1.01", 1.5, True, None, "NaN", "Infinity", "1e999999", "-0", "1000001", "9" * 100])
def test_invalid_money_is_rejected_without_records(client, amount):
    parent, child = people()
    assert issue(client, parent, body(child, amount=amount)).status_code == 422
    assert crud.count(AuditLog) == crud.count(Transaction) == 0


@pytest.mark.parametrize("patch", [{"note": "字" * 121}, {"note": "\x00"}, {"wardId": "9223372036854775808"}, {"wardId": "-1"}, {"wardId": "1 or 1=1"}, {"idempotencyKey": "not-a-uuid"}, {"extra": "ignored?"}])
def test_bounded_schema_rejects_unsafe_inputs(client, patch):
    parent, child = people()
    assert issue(client, parent, body(child, **patch)).status_code == 422
    assert crud.count(AuditLog) == 0


def test_pagination_is_bounded_and_only_lists_participant_records(client):
    parent, child = people()
    for index in range(57):
        crud.save(AuditLog, {"actor_id": parent.id, "action": "allowance_simulation_issue", "target_type": "user", "target_id": child.id,
                            "meta_json": {"simulation": {"key": str(uuid4()), "amount": str(index + 1), "note": ""}}})
    first = listed(client, child)
    assert len(first["items"]) == 50 and first["truncated"] is True
    second = listed(client, child, beforeId=first["nextBeforeId"])
    assert len(second["items"]) == 7 and second["nextBeforeId"] is None
    ids = [item["id"] for item in first["items"] + second["items"]]
    assert len(set(ids)) == 57
    assert client.get("/api/allowance-simulation?beforeId=0", headers=login(child)).status_code == 422


def test_suspended_recipient_is_not_selectable_or_issuable(client):
    parent, child = people()
    crud.save(type(child), {"suspended_at": now()}, where={"id": child.id})
    assert listed(client, parent)["recipients"] == []
    assert issue(client, parent, body(child)).status_code == 403


def test_authentication_and_platform_admin_are_blocked(client):
    parent, child = people()
    assert client.get("/api/allowance-simulation").status_code == 401
    assert client.post("/api/allowance-simulation", json=body(child)).status_code == 401
    admin = user("admin@simulation.test", "平台管理員", is_platform_admin=True)
    assert client.get("/api/allowance-simulation", headers=login(admin)).status_code == 403
    assert issue(client, admin, body(child)).status_code == 403


def test_legacy_admin_audit_does_not_project_private_simulation_money_or_note(client):
    parent, child = people()
    assert issue(client, parent, body(child, note="不可出現在管理員稽核的內容")).status_code == 201
    from app.routers.access.family import router as family_router
    client.app.include_router(family_router, prefix="/api")
    admin = user("audit-admin@simulation.test", "平台管理員", is_platform_admin=True)
    response = client.get("/api/audit", headers=login(admin))
    assert response.status_code == 200, response.text
    assert "不可出現在管理員稽核的內容" not in response.text
    assert "amount" not in response.text
    assert response.json()["logs"][0]["note"] == ""
