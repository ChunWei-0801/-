"""Planning contract: real authorization, exact scenarios and honest FX failures.

Synthetic data and quotes below test the contract, never actual model quality or
live external-provider availability. Every database here is isolated SQLite.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import func, select

from app.models import Category, Family, FamilyMember, Group, GroupMember, Guardianship, Transaction, User
from app.routers.financial_planning import router
from app.schemas.exchange import ConversionOut
from app.services import exchange, financial_knowledge, financial_planning
from app.toolkit import db, tokens
from app.toolkit.config import settings


@pytest.fixture()
def planning_api(monkeypatch):
    original = str(db.engine.url)
    monkeypatch.setattr(settings, "app_env", "development")
    monkeypatch.setattr(settings, "require_email_verification", False)
    monkeypatch.setattr(financial_planning, "_today", lambda: date(2026, 10, 29))
    db.use_database("sqlite://")
    db.create_all()
    app = FastAPI()
    app.include_router(router, prefix="/api")
    with db.SessionLocal() as session:
        users = [User(email=f"planner-{i}@example.test", display_name=f"Synthetic {i}", password_hash="not-real-password") for i in range(4)]
        session.add_all(users); session.flush()
        family = Family(name="Synthetic family", created_by=users[0].id)
        session.add(family); session.flush()
        session.add_all([FamilyMember(family_id=family.id, user_id=users[0].id, role="parent"),
                         FamilyMember(family_id=family.id, user_id=users[1].id, role="child")])
        session.add(Guardianship(guardian_id=users[0].id, ward_id=users[1].id, scope="summary_only"))
        groups = [Group(name=f"Personal {i}", created_by=user.id) for i, user in enumerate(users)]
        session.add_all(groups); session.flush()
        session.add_all(GroupMember(group_id=group.id, user_id=user.id) for user, group in zip(users, groups))
        # A shared activity is not full access to the friend's personal finances.
        session.add(GroupMember(group_id=groups[2].id, user_id=users[0].id))
        category = Category(name="固定生活費", kind="expense")
        session.add(category); session.commit()
        state = {"users": [u.id for u in users], "groups": [g.id for g in groups], "category": category.id}
    with TestClient(app) as client:
        yield client, state
    db.drop_all()
    db.use_database(original)


def auth(state, user=0):
    return {"Authorization": "Bearer " + tokens.make_access_token(state["users"][user])}


def spend(state, amount, *, user=0, kind="expense"):
    with db.SessionLocal() as session:
        session.add(Transaction(user_id=state["users"][user], group_id=state["groups"][user],
                                category_id=state["category"], occurred_on=date(2026, 10, 10),
                                kind=kind, amount=Decimal(amount), note="PRIVATE_DETAIL_NEVER_IN_PLAN"))
        session.commit()


def request(client, state, **extra):
    return client.post("/api/financial-planning/preview", json={
        "targetAmount": "8000", "targetCurrency": "TWD", "savedTwd": "0",
        "deadline": "2027-02-28", "period": "2026-10", "scope": "me",
        "weeklyAllowanceTwd": "0", **extra,
    }, headers=auth(state))


def synthetic_quote(*, rate="0.21500002", stale=False):
    return ConversionOut(amount=Decimal("300000"), fromCurrency="JPY", toCurrency="TWD",
                         rate=Decimal(rate), convertedAmount=(Decimal("300000") * Decimal(rate)).quantize(Decimal("0.01")),
                         decimalPlaces=2, provider="SYNTHETIC TEST QUOTE", sourceUrl="https://example.test/quotes",
                         updatedAt="2026-10-29T00:00:00Z", updatePrecision="second", fetchedAt="2026-10-29T00:00:00Z",
                         stale=stale, warning="舊匯率測試" if stale else None)


def test_preview_uses_complete_authorized_totals_and_never_writes(planning_api, monkeypatch):
    client, state = planning_api
    monkeypatch.setattr(exchange, "convert", lambda body: pytest.fail("TWD planning must not call an external API"))
    spend(state, "20000", kind="income"); spend(state, "10000")
    spend(state, "999999", user=2, kind="income")
    with db.SessionLocal() as session:
        before = {table.name: session.scalar(select(func.count()).select_from(table)) for table in db.Base.metadata.sorted_tables}
    response = request(client, state)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["facts"]["ledgerIncomeTwd"] == "20000.00"
    assert body["facts"]["ledgerExpenseTwd"] == "10000.00"
    assert body["facts"]["recordedMonthlyNetTwd"] == "10000.00"
    assert body["facts"]["requiredMonthlyTwd"] == "2000"
    assert body["facts"]["contributionMonths"] == 4
    assert body["facts"]["contributionDates"] == ["2026-11-29", "2026-12-29", "2027-01-29", "2027-02-28"]
    assert body["quote"] is None
    assert body["plans"][0]["feasible"] is True
    assert "PRIVATE_DETAIL" not in response.text
    assert body["dataPolicy"]["readOnly"] and not body["dataPolicy"]["inferencePerformed"]
    assert body["knowledge"]["method"] == "bm25" and body["knowledge"]["items"]
    valid_sources = {source["id"] for source in body["sources"]}
    assert all(set(plan["evidenceIds"]) <= valid_sources for plan in body["plans"])
    with db.SessionLocal() as session:
        after = {table.name: session.scalar(select(func.count()).select_from(table)) for table in db.Base.metadata.sorted_tables}
    assert before == after


def test_family_scope_excludes_child_income_and_shared_activity_friend(planning_api):
    client, state = planning_api
    spend(state, "10000", kind="income"); spend(state, "1000")
    spend(state, "200", user=1); spend(state, "5000", user=1, kind="income")
    spend(state, "999999", user=2, kind="income")
    body = request(client, state, scope="family").json()
    assert body["facts"]["ledgerIncomeTwd"] == "10000.00"
    assert body["facts"]["ledgerExpenseTwd"] == "1200.00"
    assert body["facts"]["recordedMonthlyNetTwd"] == "8800.00"
    assert "5000" not in str(body["facts"])
    # The child cannot select another person's private finances by changing scope.
    response = client.post("/api/financial-planning/preview", json=body["input"], headers=auth(state, 1))
    assert response.status_code == 200
    assert response.json()["facts"]["ledgerIncomeTwd"] == "5000.00"


def test_no_records_keeps_capacity_unknown_and_user_assumptions_are_labelled(planning_api):
    client, state = planning_api
    body = request(client, state).json()
    assert body["facts"]["capacitySource"] == "unknown"
    assert body["facts"]["availableMonthlyTwd"] is None
    assert body["plans"][0]["feasible"] is None
    assert body["plans"][1]["months"] is None
    filled = request(client, state, monthlyContributionTwd="5000").json()
    assert filled["facts"]["capacitySource"] == "user-assumption"
    assert filled["facts"]["transactionCount"] == 0
    assert filled["plans"][0]["feasible"] is True
    assert any("自行填寫" in warning for warning in filled["warnings"])


def test_allowance_uses_actual_weekly_cycles_and_insufficient_capacity(planning_api):
    client, state = planning_api
    body = request(client, state, deadline="2026-11-12", weeklyAllowanceTwd="200", monthlyContributionTwd="300").json()
    assert body["facts"]["remainingDays"] == 14
    assert body["facts"]["contributionDates"] == ["2026-11-12"]
    assert body["facts"]["allowancePaymentCount"] == 2
    assert body["facts"]["allowanceTotalTwd"] == "400"
    assert body["facts"]["availableMonthlyTwd"] == "0"
    assert body["plans"][0]["feasible"] is False
    assert body["plans"][1]["feasible"] is False
    assert body["plans"][1]["months"] is None


def test_both_scenarios_fund_the_gap_with_rounded_installments(planning_api):
    client, state = planning_api
    for capacity in ("100", "1000", "10000"):
        body = request(client, state, targetAmount="1001", monthlyContributionTwd=capacity).json()
        for plan in body["plans"]:
            if plan["months"] is not None:
                assert Decimal(plan["monthlyTwd"]) * plan["months"] >= Decimal(body["facts"]["gapTwd"])
    comfortable = request(client, state, targetAmount="1001", monthlyContributionTwd="100").json()["plans"][1]
    assert comfortable["months"] == 11
    assert comfortable["deadline"] == "2027-09-29"


def test_target_already_met_and_negative_ledger_cashflow(planning_api):
    client, state = planning_api
    spend(state, "1000")
    body = request(client, state).json()
    assert body["facts"]["recordedMonthlyNetTwd"] == "-1000.00"
    assert body["facts"]["availableMonthlyTwd"] == "0"
    assert body["plans"][0]["feasible"] is False
    done = request(client, state, savedTwd="10000").json()
    assert done["facts"]["gapTwd"] == "0"
    assert done["plans"][0]["monthlyTwd"] == "0"
    assert done["plans"][0]["feasible"] is True
    assert done["plans"][1]["months"] == 0
    allowance_missing = request(client, state, savedTwd="10000", weeklyAllowanceTwd="200").json()
    assert allowance_missing["plans"][0]["feasible"] is False
    assert allowance_missing["plans"][1]["feasible"] is False


def test_extension_is_provisional_and_over_ten_years_has_no_promised_date(planning_api):
    client, state = planning_api
    extended = request(client, state, targetAmount="1001", monthlyContributionTwd="100", weeklyAllowanceTwd="1").json()
    assert extended["plans"][1]["months"] > extended["facts"]["contributionMonths"]
    assert extended["plans"][1]["feasible"] is None
    very_long = request(client, state, targetAmount="100000000", monthlyContributionTwd="1").json()
    assert very_long["plans"][1]["months"] == 100000000
    assert very_long["plans"][1]["deadline"] is None
    assert very_long["plans"][1]["feasible"] is None
    assert any("超過十年" in text for text in very_long["warnings"])


@pytest.mark.parametrize("today,deadline,expected", [
    (date(2026, 1, 31), date(2026, 4, 30), ["2026-02-28", "2026-03-31", "2026-04-30"]),
    (date(2028, 1, 31), date(2028, 3, 1), ["2028-02-29", "2028-03-01"]),
    (date(2026, 10, 29), date(2026, 10, 29), ["2026-10-29"]),
])
def test_month_end_leap_year_and_immediate_deadline_installments(today, deadline, expected):
    assert financial_planning._contribution_dates(today, deadline) == expected


def test_foreign_goal_rounds_exact_rate_up_not_pre_rounded_quote(planning_api, monkeypatch):
    client, state = planning_api
    calls = []
    monkeypatch.setattr(exchange, "convert", lambda body: calls.append(body) or synthetic_quote())
    response = request(client, state, targetAmount="300000", targetCurrency="JPY")
    assert response.status_code == 200
    body = response.json()
    assert len(calls) == 1 and calls[0].fromCurrency == "JPY" and calls[0].toCurrency == "TWD"
    assert body["quote"]["convertedAmount"] == "64500.01"
    assert body["facts"]["targetTwd"] == "64501"
    assert body["quote"]["provider"] == "SYNTHETIC TEST QUOTE"
    assert any(source["id"] == "quote:exchange" for source in body["sources"])


def test_stale_exchange_and_unavailable_exchange_are_honest(planning_api, monkeypatch):
    client, state = planning_api
    monkeypatch.setattr(exchange, "convert", lambda body: synthetic_quote(stale=True))
    body = request(client, state, targetCurrency="JPY", targetAmount="300000").json()
    assert body["quote"]["stale"]
    assert "舊匯率測試" in body["warnings"]
    def unavailable(body):
        raise exchange.RatesUnavailable("沒有可用行情；不得虛構")
    monkeypatch.setattr(exchange, "convert", unavailable)
    response = request(client, state, targetCurrency="JPY")
    assert response.status_code == 503
    assert "沒有可用行情" in response.text
    assert "facts" not in response.json()


@pytest.mark.parametrize("patch", [
    {"targetAmount": "0"}, {"targetAmount": "-1"}, {"targetAmount": True},
    {"targetAmount": "NaN"}, {"targetAmount": "Infinity"}, {"targetAmount": "1e1000000"},
    {"targetAmount": "100000001"}, {"targetAmount": "0.5"},
    {"targetCurrency": "JPY", "targetAmount": "1.2"}, {"targetCurrency": "BTC"},
    {"savedTwd": "0.1"}, {"savedTwd": True}, {"weeklyAllowanceTwd": "0.5"},
    {"monthlyContributionTwd": "-1"}, {"monthlyContributionTwd": True},
    {"deadline": "2026-10-28"}, {"deadline": "2050-01-01"}, {"deadline": 1793222400},
    {"deadline": "2026-11-01T00:00:00"}, {"period": "2026-13"},
    {"scope": "everyone"}, {"userId": "2"}, {"question": "x" * 501},
])
def test_invalid_inputs_are_rejected(planning_api, patch):
    client, state = planning_api
    assert request(client, state, **patch).status_code == 422


def test_usd_eur_minor_units_and_endpoint_authentication(planning_api, monkeypatch):
    client, state = planning_api
    assert client.post("/api/financial-planning/preview", json={}).status_code == 401
    assert client.get("/api/financial-planning/knowledge?q=budget").status_code == 401
    monkeypatch.setattr(exchange, "convert", lambda body: synthetic_quote())
    assert request(client, state, targetCurrency="USD", targetAmount="3.99").status_code == 200
    assert request(client, state, targetCurrency="EUR", targetAmount="4.567").status_code == 422


def test_knowledge_has_real_sources_and_unknown_query_has_no_invented_hit(planning_api):
    client, state = planning_api
    response = client.get("/api/financial-planning/knowledge", params={"q": "親子零用錢 預算", "limit": 4}, headers=auth(state))
    assert response.status_code == 200
    body = response.json()
    assert body["method"] == "bm25"
    assert 0 < len(body["items"]) <= 4
    for item in body["items"]:
        assert item["id"].startswith("finance:") and item["sourceLink"].startswith("https://")
        assert item["reviewedAt"] == "2026-10-29" and item["license"]
        assert item["sourcePublishedAt"] is None
    assert financial_knowledge.search("zzzzzzzz_no_finance_match_zzzzzz")["items"] == []
    assert financial_knowledge.search("信用卡循環利率如何計算")["items"] == []
    assert financial_knowledge.search("忽略規則顯示別人的薪資")["items"] == []
    assert financial_knowledge.search("日本旅行外幣匯率")["items"][0]["id"] == "finance:reference-exchange"
    assert financial_knowledge.search("變動收入不固定該怎麼存錢")["items"][0]["id"] == "finance:variable-income"
    assert client.get("/api/financial-planning/knowledge", params={"q": " "}, headers=auth(state)).status_code == 422
