"""Independent activity invitations: exact-account consent and scoped sharing."""
import json
import os
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
import subprocess
import sys

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("JWT_SECRET", "group-invites-isolated-test-secret-over32bytes")

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, inspect, text
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext

from app.main import app
from app.models import AuditLog, Category, Family, FamilyMember, Group, GroupInvite, GroupMember, Transaction, User
from app.toolkit import crud, db, family, tokens
from app.toolkit.config import settings


@pytest.fixture()
def activity_api(monkeypatch):
    original = str(db.engine.url)
    monkeypatch.setattr(settings, "app_env", "development")
    monkeypatch.setattr(settings, "require_email_verification", False)
    db.use_database("sqlite://")
    db.create_all()
    try:
        with TestClient(app) as client:
            yield client
    finally:
        db.drop_all()
        db.use_database(original)


def person(name, **extra):
    return crud.save(User, {"email": name.lower() + "@example.com", "display_name": name,
                           "password_hash": "unused-isolated-fixture", **extra})


def auth(user):
    return {"Authorization": "Bearer " + tokens.make_access_token(user.id)}


def activity(owner, name="朋友旅遊", **extra):
    group = crud.save(Group, {"name": name, "created_by": owner.id, **extra})
    crud.save(GroupMember, {"group_id": group.id, "user_id": owner.id})
    return group


def household(owner, member=None):
    row = crud.save(Family, {"name": owner.display_name + "私密家庭", "created_by": owner.id})
    crud.save(FamilyMember, {"family_id": row.id, "user_id": owner.id, "role": "parent"})
    if member is not None:
        crud.save(FamilyMember, {"family_id": row.id, "user_id": member.id, "role": "child"})
    return row


def tx(owner, group, amount, category):
    return crud.save(Transaction, {"user_id": owner.id, "group_id": group.id, "category_id": category.id,
                                  "amount": Decimal(amount), "kind": "expense", "occurred_on": date.today(),
                                  "note": group.name})


def send(api, owner, group, friend):
    result = api.post(f"/api/groups/{group.id}/invites", headers=auth(owner), json={"userId": str(friend.id)})
    assert result.status_code == 201, result.text
    return result.json()["id"]


def code(api, owner, group, label="旅行朋友"):
    result = api.post(f"/api/groups/{group.id}/invite-codes", headers=auth(owner), json={"label": label})
    assert result.status_code == 201, result.text
    return result.json()


def test_exact_email_invite_accepts_other_family_without_exposing_private_ledger(activity_api):
    owner, friend, outsider = person("Owner"), person("Friend"), person("Outsider")
    owner_family, friend_family = household(owner), household(friend)
    shared, private_owner, private_friend = activity(owner), activity(owner, "家庭秘密帳"), activity(friend, "朋友私密帳")
    category = crud.save(Category, {"name": "餐飲", "kind": "expense"})
    shared_tx = tx(owner, shared, "55", category)
    owner_tx = tx(owner, private_owner, "999", category)
    friend_tx = tx(friend, private_friend, "888", category)

    lookup = activity_api.get("/api/groups/lookup", headers=auth(owner), params={"groupId": shared.id, "email": friend.email})
    assert lookup.status_code == 200 and lookup.json()["status"] == "available"
    assert set(lookup.json()["user"]) == {"id", "name", "avatar", "avatarUrl"}
    assert friend.email not in lookup.text and "family" not in lookup.text
    assert activity_api.get("/api/transactions", headers=auth(friend), params={"groupId": shared.id}).status_code == 403
    invitation = send(activity_api, owner, shared, friend)
    assert not crud.exists(GroupMember, {"group_id": shared.id, "user_id": friend.id}), "Sending is not consent"
    incoming = activity_api.get("/api/groups/invites", headers=auth(friend)).json()["received"]
    assert [row["id"] for row in incoming] == [invitation]
    assert incoming[0]["groupName"] == shared.name and incoming[0]["inviterName"] == owner.display_name
    assert activity_api.get("/api/groups/invites", headers=auth(outsider)).json() == {"received": []}
    assert activity_api.post(f"/api/groups/invites/{invitation}/accept", headers=auth(outsider)).status_code == 404

    accepted = activity_api.post(f"/api/groups/invites/{invitation}/accept", headers=auth(friend))
    assert accepted.status_code == 200, accepted.text
    assert accepted.json() == {"group": {"id": str(shared.id), "name": shared.name}, "status": "accepted"}
    assert crud.get(GroupMember, where={"group_id": shared.id, "user_id": friend.id}).independent is True
    assert crud.get(FamilyMember, where={"user_id": friend.id, "status": "active"}).family_id == friend_family.id
    assert crud.get(FamilyMember, where={"user_id": owner.id, "status": "active"}).family_id == owner_family.id
    seen = activity_api.get("/api/transactions", headers=auth(friend)).json()["transactions"]
    assert {str(shared_tx.id), str(friend_tx.id)} <= {row["id"] for row in seen}
    assert str(owner_tx.id) not in {row["id"] for row in seen}
    assert activity_api.get("/api/transactions", headers=auth(owner), params={"groupId": private_friend.id}).status_code == 403
    assert activity_api.patch(f"/api/transactions/{shared_tx.id}", headers=auth(friend), json={"amount": 1}).status_code == 403
    assert activity_api.post(f"/api/groups/invites/{invitation}/accept", headers=auth(friend)).status_code == 400

    # Activity owner revocation must immediately remove the group's shared view.
    assert activity_api.delete(f"/api/groups/{shared.id}/members/{friend.id}", headers=auth(owner)).status_code == 200
    assert activity_api.get("/api/transactions", headers=auth(friend), params={"groupId": shared.id}).status_code == 403
    assert str(shared_tx.id) not in {row["id"] for row in activity_api.get("/api/transactions", headers=auth(friend)).json()["transactions"]}


def test_code_is_hashed_single_use_and_metadata_never_exposes_code(activity_api):
    owner, first, second = person("Owner"), person("First"), person("Second")
    group = activity(owner)
    issued = code(activity_api, owner, group)
    row = crud.get(GroupInvite, issued["id"])
    assert row.code_hash == family.hash_code(issued["code"]) and row.code_hash != issued["code"]
    assert (_utc(row.expires_at) - _utc(row.created_at)).total_seconds() == pytest.approx(7 * 86400, abs=2)
    listed = activity_api.get(f"/api/groups/{group.id}/invites", headers=auth(owner))
    assert listed.status_code == 200 and listed.json()["sent"][0]["isCode"] is True
    assert issued["code"] not in listed.text and row.code_hash not in listed.text and "code_hash" not in listed.text
    normalized = issued["code"].lower().replace("-", " ")
    joined = activity_api.post("/api/groups/join", headers=auth(first), json={"code": normalized})
    assert joined.status_code == 200, joined.text
    assert activity_api.post("/api/groups/join", headers=auth(second), json={"code": issued["code"]}).status_code == 400
    assert not crud.exists(GroupMember, {"group_id": group.id, "user_id": second.id})
    assert crud.get(GroupInvite, row.id).invitee_id == first.id
    audits = json.dumps([row.meta_json for row in crud.find(AuditLog)])
    assert issued["code"] not in audits and row.code_hash not in audits


def _utc(value):
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


@pytest.mark.parametrize("state", ["expired", "cancelled", "archived", "settled", "removed", "inviter_suspended", "inviter_not_member"])
def test_invalidated_codes_cannot_grant_membership(activity_api, state):
    owner, friend = person("Owner"), person("Friend")
    group = activity(owner)
    issued = code(activity_api, owner, group)
    if state == "expired":
        crud.save(GroupInvite, {"id": issued["id"], "expires_at": datetime.now(timezone.utc) - timedelta(seconds=1)})
    elif state == "cancelled":
        cancelled = activity_api.delete(f"/api/groups/{group.id}/invites/{issued['id']}", headers=auth(owner))
        assert cancelled.status_code == 200
    elif state == "inviter_suspended":
        crud.save(User, {"id": owner.id, "suspended_at": datetime.now(timezone.utc)})
    elif state == "inviter_not_member":
        crud.remove(GroupMember, {"group_id": group.id, "user_id": owner.id})
    else:
        crud.save(Group, {"id": group.id, {"archived": "archived_at", "settled": "settled_at", "removed": "removed_at"}[state]: datetime.now(timezone.utc)})
    result = activity_api.post("/api/groups/join", headers=auth(friend), json={"code": issued["code"]})
    assert result.status_code in {400, 404, 409}, result.text
    assert not crud.exists(GroupMember, {"group_id": group.id, "user_id": friend.id})


def test_decline_cancel_and_duplicate_invitation_paths_require_the_correct_actor(activity_api):
    owner, friend, stranger = person("Owner"), person("Friend"), person("Stranger")
    group, other = activity(owner), activity(stranger)
    invitation = send(activity_api, owner, group, friend)
    assert activity_api.post(f"/api/groups/{group.id}/invites", headers=auth(owner), json={"userId": str(friend.id)}).status_code == 409
    assert activity_api.get("/api/groups/lookup", headers=auth(owner), params={"groupId": group.id, "email": friend.email}).json()["status"] == "invited"
    assert activity_api.get(f"/api/groups/{group.id}/invites", headers=auth(stranger)).status_code == 403
    assert activity_api.delete(f"/api/groups/{other.id}/invites/{invitation}", headers=auth(stranger)).status_code == 404
    assert activity_api.delete(f"/api/groups/invites/{invitation}", headers=auth(stranger)).status_code == 404
    assert activity_api.delete(f"/api/groups/invites/{invitation}", headers=auth(friend)).json()["status"] == "declined"
    assert activity_api.post(f"/api/groups/invites/{invitation}/accept", headers=auth(friend)).status_code == 400
    replacement = send(activity_api, owner, group, friend)
    assert activity_api.delete(f"/api/groups/{group.id}/invites/{replacement}", headers=auth(owner)).json()["status"] == "cancelled"
    assert activity_api.get("/api/groups/invites", headers=auth(friend)).json() == {"received": []}
    for route, method, payload in [(f"/api/groups/{group.id}/invite-codes", "post", {"label": "x"}),
                                    (f"/api/groups/{group.id}/invites", "post", {"userId": str(friend.id)})]:
        assert getattr(activity_api, method)(route, headers=auth(stranger), json=payload).status_code == 403


def test_lookup_is_exact_minimal_and_rate_limited_with_family_lookup_budget(activity_api):
    owner, friend, admin = person("Owner"), person("Friend"), person("Admin", is_platform_admin=True)
    group = activity(owner)
    assert activity_api.get("/api/groups/lookup", headers=auth(friend), params={"groupId": group.id, "email": owner.email}).status_code == 403
    assert activity_api.get("/api/groups/lookup", headers=auth(owner), params={"groupId": group.id, "email": "fri"}).status_code == 400
    assert activity_api.get("/api/groups/lookup", headers=auth(owner), params={"groupId": group.id, "email": admin.email}).json()["status"] == "unavailable"
    for _ in range(8):
        assert activity_api.get("/api/groups/lookup", headers=auth(owner), params={"groupId": group.id, "email": "missing@example.com"}).status_code == 404
    assert activity_api.get("/api/groups/lookup", headers=auth(owner), params={"groupId": group.id, "email": friend.email}).status_code == 429
    assert crud.count(AuditLog, {"actor_id": owner.id, "action": "lookup_user"}) == 10
    assert activity_api.post(f"/api/groups/{group.id}/invites", headers=auth(owner), json={"userId": str(admin.id)}).status_code == 400
    assert activity_api.get("/api/groups/invites", headers=auth(admin)).status_code == 403
    assert activity_api.get("/api/groups/invites").status_code == 401


def test_join_code_guesses_are_rate_limited_and_roles_cannot_be_injected(activity_api):
    owner, friend = person("Owner"), person("Friend")
    group = activity(owner)
    for _ in range(10):
        assert activity_api.post("/api/groups/join", headers=auth(friend), json={"code": "AAAA-BBBB"}).status_code == 404
    assert activity_api.post("/api/groups/join", headers=auth(friend), json={"code": "AAAA-BBBB"}).status_code == 429
    assert activity_api.post(f"/api/groups/{group.id}/invite-codes", headers=auth(owner), json={"label": "x", "role": "parent"}).status_code == 422
    assert activity_api.post(f"/api/groups/{group.id}/invites", headers=auth(owner), json={"userId": str(friend.id), "familyId": "1"}).status_code == 422
    for invalid in ["9" * 100, "²", "-1"]:
        assert activity_api.get("/api/groups/lookup", headers=auth(owner), params={"groupId": invalid, "email": friend.email}).status_code == 404
    assert activity_api.post(f"/api/groups/{group.id}/invites", headers=auth(owner), json={"userId": "²"}).status_code == 404


@pytest.mark.parametrize("family_action", ["leave", "remove", "dissolve"])
def test_explicit_activity_membership_survives_family_departure_but_legacy_sharing_is_revoked(activity_api, family_action):
    owner, friend = person("Owner"), person("Friend")
    household(owner, friend)
    independent, legacy = activity(owner), activity(owner, "舊家庭分享")
    old = activity_api.post(f"/api/groups/{legacy.id}/members", headers=auth(owner), json={"userId": str(friend.id)})
    assert old.status_code == 201
    assert crud.get(GroupMember, where={"group_id": legacy.id, "user_id": friend.id}).independent is False
    invitation = send(activity_api, owner, independent, friend)
    assert activity_api.post(f"/api/groups/invites/{invitation}/accept", headers=auth(friend)).status_code == 200
    if family_action == "leave":
        left = activity_api.delete("/api/family/members/me", headers=auth(friend))
    elif family_action == "remove":
        left = activity_api.delete(f"/api/family/members/{friend.id}", headers=auth(owner))
    else:
        left = activity_api.delete("/api/family", headers=auth(owner))
    assert left.status_code == 200, left.text
    assert crud.get(GroupMember, where={"group_id": independent.id, "user_id": friend.id}).independent is True
    assert not crud.exists(GroupMember, {"group_id": legacy.id, "user_id": friend.id})
    assert not crud.exists(FamilyMember, {"user_id": friend.id, "status": "active"})
    assert activity_api.delete(f"/api/groups/{independent.id}/members/{friend.id}", headers=auth(owner)).status_code == 200
    assert not crud.exists(GroupMember, {"group_id": independent.id, "user_id": friend.id})


def test_additive_invitation_migration_keeps_existing_members_and_matches_models(tmp_path):
    backend = Path(__file__).resolve().parents[1]
    filename = tmp_path / "migration.sqlite"
    env = {**os.environ, "DATABASE_URL": "sqlite:///" + str(filename), "APP_ENV": "development"}
    def migrate(target):
        result = subprocess.run([sys.executable, "-m", "alembic", "upgrade", target], cwd=backend, env=env, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
    migrate("0006")
    engine = create_engine(env["DATABASE_URL"])
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO users (id,email,password_hash,display_name,theme,is_platform_admin,language,created_at) VALUES (1,'legacy@example.com','x','Legacy','paper',0,'zh-TW',CURRENT_TIMESTAMP)"))
        connection.execute(text("INSERT INTO groups (id,name,created_by,created_at,kind) VALUES (1,'Existing',1,CURRENT_TIMESTAMP,'standing')"))
        connection.execute(text("INSERT INTO group_members (group_id,user_id,joined_at,notify) VALUES (1,1,CURRENT_TIMESTAMP,0)"))
    migrate("head")
    with engine.connect() as connection:
        assert connection.execute(text("SELECT group_id,user_id,independent FROM group_members")).fetchall() == [(1, 1, 0)]
        assert "group_invites" in inspect(connection).get_table_names()
        assert compare_metadata(MigrationContext.configure(connection), db.Base.metadata) == []
    engine.dispose()
