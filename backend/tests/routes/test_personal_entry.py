"""Missing activity means personal details, never an implicit shared destination."""
import pytest

from app.models import Group, GroupMember, NlpParse, Notification, Transaction
from app.toolkit import crud
from tests.routes.conftest import categories, ledger_of, login, now, user

pytestmark = pytest.mark.route("POST", "/api/transactions")
PATHS = ("/api/transactions", "/api/nlp/confirm", "/api/nlp/confirm-batch")


def payload(category, **extra):
    return {"date": "2026-10-28", "amount": 65, "kind": "expense", "cat": str(category.id), **extra}


def post(api, path, me, item):
    body = {"items": [{**item, "span": "早餐65元"}]} if path.endswith("-batch") else item
    return api.post(path, headers=login(me), json=body)


@pytest.mark.parametrize("path", PATHS)
def test_first_personal_entry_without_any_activity_and_reuse(api, path):
    me = user("personal@example.test", "自己")
    category = categories()["餐飲"]
    assert crud.count(Group) == 0
    for extra in ({}, {"groupId": None}):
        response = post(api, path, me, payload(category, **extra))
        assert response.status_code == 201, response.text
    groups = crud.find(Group)
    assert len(groups) == 1
    private = groups[0]
    assert (private.name, private.created_by, private.family_id, private.kind) == ("收支明細", me.id, None, "standing")
    assert [(m.group_id, m.user_id) for m in crud.find(GroupMember)] == [(private.id, me.id)]
    assert {t.group_id for t in crud.find(Transaction)} == {private.id}
    assert crud.count(Transaction) == 2
    listed = api.get("/api/transactions", headers=login(me))
    assert listed.status_code == 200 and listed.json()["total"] == 2


@pytest.mark.parametrize("path", PATHS)
def test_no_destination_never_uses_shared_or_other_owners_personal_named_group(api, path):
    me, friend = user("owner@example.test", "自己"), user("friend@example.test", "朋友")
    shared = ledger_of(me, friend, name="個人帳本")
    friends = ledger_of(friend, me, name="收支明細")
    response = post(api, path, me, payload(categories()["餐飲"]))
    assert response.status_code == 201, response.text
    record = crud.find(Transaction)[0]
    assert record.group_id not in (shared.id, friends.id)
    private = crud.get(Group, record.group_id)
    assert private.created_by == me.id and private.family_id is None
    assert [m.user_id for m in crud.find(GroupMember, {"group_id": private.id})] == [me.id]
    visible = api.get("/api/transactions", headers=login(friend))
    assert visible.status_code == 200 and visible.json()["total"] == 0
    assert crud.count(Notification) == 0


@pytest.mark.parametrize("path", PATHS)
@pytest.mark.parametrize("name", ["個人帳本", "收支明細"])
def test_reuses_only_existing_owner_only_personal_group(api, path, name):
    me = user("legacy@example.test", "既有帳號")
    ledger_of(me, name="較早建立的活動")
    private = ledger_of(me, name=name)
    response = post(api, path, me, payload(categories()["餐飲"]))
    assert response.status_code == 201, response.text
    assert crud.find(Transaction)[0].group_id == private.id
    assert crud.count(Group) == 2


@pytest.mark.parametrize("path", PATHS)
@pytest.mark.parametrize("state", ["archived_at", "settled_at", "removed_at", "temporary"])
def test_unusable_personal_named_group_stays_unchanged_and_new_private_is_created(api, path, state):
    me = user("closed@example.test", "自己")
    extra = {"kind": "temp"} if state == "temporary" else {state: now()}
    old = ledger_of(me, name="收支明細", **extra)
    response = post(api, path, me, payload(categories()["餐飲"]))
    assert response.status_code == 201, response.text
    assert crud.find(Transaction)[0].group_id != old.id
    preserved = crud.get(Group, old.id)
    assert preserved.kind == "temp" if state == "temporary" else getattr(preserved, state) is not None


@pytest.mark.parametrize("path", PATHS)
@pytest.mark.parametrize("state", ["foreign", "archived_at", "settled_at", "removed_at"])
def test_explicit_unusable_activity_is_rejected_without_personal_fallback(api, path, state):
    me, friend = user("chosen@example.test", "自己"), user("other@example.test", "別人")
    extra = {} if state == "foreign" else {state: now()}
    group = ledger_of(friend if state == "foreign" else me, name="指定活動", **extra)
    response = post(api, path, me, payload(categories()["餐飲"], groupId=str(group.id)))
    assert response.status_code == (404 if state in ("foreign", "removed_at") else 409), response.text
    assert crud.count(Group) == 1
    assert crud.count(Transaction) == crud.count(NlpParse) == crud.count(Notification) == 0


@pytest.mark.parametrize("path", PATHS)
def test_explicit_open_activity_still_shares_only_selected_activity(api, path):
    me, friend = user("shared@example.test", "自己"), user("member@example.test", "朋友")
    group = ledger_of(me, friend, name="旅行")
    response = post(api, path, me, payload(categories()["餐飲"], groupId=str(group.id)))
    assert response.status_code == 201, response.text
    assert crud.find(Transaction)[0].group_id == group.id
    assert crud.count(Group) == 1
    assert api.get("/api/transactions", headers=login(friend)).json()["total"] == 1


def test_failed_personal_batch_rolls_back_new_group_and_all_records(api):
    me = user("atomic@example.test", "自己")
    cats = categories()
    ok = payload(cats["餐飲"])
    response = api.post("/api/nlp/confirm-batch", headers=login(me), json={
        "items": [ok, {**ok, "cat": str(cats["薪資"].id)}],
    })
    assert response.status_code == 400, response.text
    assert crud.count(Group) == crud.count(GroupMember) == 0
    assert crud.count(Transaction) == crud.count(NlpParse) == crud.count(Notification) == 0


def test_all_entry_paths_share_one_private_destination(api):
    me = user("paths@example.test", "自己")
    item = payload(categories()["餐飲"])
    for path in PATHS:
        response = post(api, path, me, item)
        assert response.status_code == 201, response.text
    assert crud.count(Group) == 1 and crud.count(GroupMember) == 1
    assert len({t.group_id for t in crud.find(Transaction)}) == 1
