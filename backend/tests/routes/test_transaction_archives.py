"""Year/month packaging is a read-only view over complete authorized records."""
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.models import Group, Transaction
from app.routers.ledger.transactions import _archive_payload
from app.toolkit import crud, db
from tests.routes.conftest import categories, family_of, guard, ledger_of, login, spend, user

ARCHIVES = ("GET", "/api/transactions/archives")


def fetch(api, who, **params):
    response = api.get("/api/transactions/archives", headers=login(who), params=params)
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.route(*ARCHIVES)
def test_archives_include_only_recorded_years_and_months_with_real_month_bounds(api):
    me = user("archive@x.tw", "整理人")
    group = ledger_of(me, name="旅行活動")
    cat = categories()["餐飲"]
    for day, amount in [("2024-02-29", 10), ("2024-02-01", 20), ("2024-12-31", 30), ("2025-01-01", 40)]:
        spend(me, group, cat, amount, day=day)
    result = fetch(api, me, userId=str(me.id))
    assert result["timezone"] == "Asia/Taipei"
    assert result["currentPeriod"] == datetime.fromisoformat(result["asOf"]).strftime("%Y-%m")
    assert result["asOf"].endswith("+08:00") and result["total"] == 4
    assert [(y["year"], y["count"]) for y in result["years"]] == [(2025, 1), (2024, 3)]
    months = result["years"][1]["months"]
    assert [(m["period"], m["count"]) for m in months] == [("2024-12", 1), ("2024-02", 2)]
    assert months[1] == {"period": "2024-02", "year": 2024, "month": 2, "count": 2,
                         "closed": True, "from": "2024-02-01", "to": "2024-02-29"}
    assert crud.count(Transaction) == 4


@pytest.mark.route(*ARCHIVES)
def test_archive_scope_is_guardianship_union_activity_not_all_member_records(api):
    dad, kid, friend, stranger = [user("%s@x.tw" % key, key) for key in ("dad", "kid", "friend", "outsider")]
    family_of((dad, "parent"), (kid, "child"))
    guard(dad, kid)
    cat = categories()["餐飲"]
    shared = ledger_of(dad, friend, name="共同活動")
    child_private = ledger_of(kid, name="小孩活動")
    friend_private = ledger_of(friend, name="朋友私人活動")
    hidden = ledger_of(stranger, name="不可見活動")
    own = spend(dad, shared, cat, 10, day="2024-01-02")
    friend_shared = spend(friend, shared, cat, 20, day="2024-02-02")
    guarded = spend(kid, child_private, cat, 30, day="2024-03-02")
    spend(friend, friend_private, cat, 400, day="2023-06-01")
    spend(stranger, hidden, cat, 900, day="2022-06-01")
    result = fetch(api, dad)
    assert result["total"] == 3
    assert [m["period"] for m in result["years"][0]["months"]] == ["2024-03", "2024-02", "2024-01"]
    assert fetch(api, dad, userId=str(friend.id))["total"] == 1
    assert fetch(api, dad, groupId=str(shared.id))["total"] == 2
    detail = api.get("/api/transactions", headers=login(dad)).json()
    assert {r["id"] for r in detail["transactions"]} == {str(own.id), str(friend_shared.id), str(guarded.id)}
    assert {r["groupName"] for r in detail["transactions"]} == {"共同活動", "小孩活動"}
    for params in ({"groupId": str(friend_private.id)}, {"userId": str(stranger.id)}):
        assert api.get("/api/transactions/archives", headers=login(dad), params=params).status_code == 403
    assert fetch(api, dad, q="朋友私人活動")["total"] == 0
    assert fetch(api, dad, q="不可見活動")["years"] == []


@pytest.mark.route(*ARCHIVES)
def test_activity_name_search_and_filters_match_complete_paginated_detail(api):
    me = user("many@x.tw", "多筆")
    cat = categories()
    activity = ledger_of(me, name="Summer 100%_Trip")
    other = ledger_of(me, name="Summer 100XTrip")
    with db.SessionLocal() as session:
        session.add_all([Transaction(user_id=me.id, group_id=activity.id, category_id=cat["餐飲"].id,
                                     kind="expense", amount=1, occurred_on=datetime(2024, 6, 15).date(),
                                     source="manual") for _ in range(205)])
        session.commit()
    spend(me, other, cat["餐飲"], 2, day="2024-06-15")
    spend(me, activity, cat["薪資"], 300, day="2024-07-02", source="import")
    params = {"q": "summer 100%_trip", "kind": "expense", "source": "manual",
              "from": "2024-06-01", "to": "2024-06-30", "categoryId": str(cat["餐飲"].id)}
    index = fetch(api, me, **params)
    first = api.get("/api/transactions", headers=login(me), params=params).json()
    second = api.get("/api/transactions", headers=login(me), params={**params, "page": 2}).json()
    assert index["total"] == first["total"] == second["total"] == 205
    assert len(first["transactions"]) == 200 and len(second["transactions"]) == 5
    assert {r["id"] for r in first["transactions"]}.isdisjoint(r["id"] for r in second["transactions"])
    assert {r["groupName"] for r in first["transactions"] + second["transactions"]} == {activity.name}
    assert [(m["period"], m["count"]) for m in index["years"][0]["months"]] == [("2024-06", 205)]
    assert fetch(api, me, q="summer")["total"] == 207


@pytest.mark.route(*ARCHIVES)
def test_month_end_packaging_uses_taipei_boundary_without_writes_or_edit_lock(api):
    me = user("boundary@x.tw", "月底")
    group = ledger_of(me)
    cat = categories()["餐飲"]
    record = spend(me, group, cat, 1, day="2026-10-31")
    request = SimpleNamespace(query_params={})
    with db.SessionLocal() as session:
        before = _archive_payload(SimpleNamespace(id=me.id, family_id=None), session, request, now=datetime(2026, 10, 31, 15, 59, 59, tzinfo=timezone.utc))
        after = _archive_payload(SimpleNamespace(id=me.id, family_id=None), session, request, now=datetime(2026, 10, 31, 16, 0, 0, tzinfo=timezone.utc))
    assert before["currentPeriod"] == "2026-10" and before["years"][0]["months"][0]["closed"] is False
    assert after["currentPeriod"] == "2026-11" and after["years"][0]["months"][0]["closed"] is True
    assert before["total"] == after["total"] == crud.count(Transaction) == 1
    assert crud.get(Transaction, record.id).updated_at is None
    patch = api.patch("/api/transactions/%d" % record.id, headers=login(me), json={"date": "2024-02-29"})
    assert patch.status_code == 200, patch.text
    created = api.post("/api/transactions", headers=login(me), json={
        "date": "2024-02-15", "amount": 2, "kind": "expense", "cat": str(cat.id), "groupId": str(group.id)})
    assert created.status_code == 201, created.text
    result = fetch(api, me)
    assert result["total"] == 2 and result["years"][0]["months"][0]["period"] == "2024-02"
    assert result["years"][0]["months"][0]["count"] == 2


@pytest.mark.route(*ARCHIVES)
def test_archive_year_boundary_and_history_keep_activity_name(api):
    me = user("year@x.tw", "跨年")
    group = ledger_of(me, name="已結束活動")
    cat = categories()["餐飲"]
    spend(me, group, cat, 1, day="2025-12-31")
    crud.save(Group, {"archived_at": datetime.now(timezone.utc)}, where={"id": group.id})
    with db.SessionLocal() as session:
        result = _archive_payload(SimpleNamespace(id=me.id, family_id=None), session, SimpleNamespace(query_params={}), now=datetime(2025, 12, 31, 16, tzinfo=timezone.utc))
    assert result["currentPeriod"] == "2026-01" and result["years"][0]["months"][0]["closed"] is True
    found = api.get("/api/transactions", headers=login(me), params={"q": "已結束活動"}).json()
    assert found["total"] == 1 and found["transactions"][0]["groupName"] == group.name


@pytest.mark.route(*ARCHIVES)
def test_archives_enforce_login_validation_and_empty_state(api):
    me = user("empty@x.tw", "沒有紀錄")
    admin = user("admin@x.tw", "平台", is_platform_admin=True)
    assert fetch(api, me)["years"] == [] and fetch(api, me)["total"] == 0
    assert api.get("/api/transactions/archives").status_code == 401
    assert api.get("/api/transactions/archives", headers=login(admin)).status_code == 403
    for params in ({"page": 1}, {"scope": "all"}, {"from": "not-a-date"}, {"kind": "gift"}, {"source": "other"}):
        response = api.get("/api/transactions/archives", headers=login(me), params=params)
        assert response.status_code == 422, (params, response.text)
