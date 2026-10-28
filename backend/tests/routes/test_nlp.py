"""段落記帳：解析（不寫入）與確認後寫入（記帳）。模型用假的代替，不會真的連出去。"""

import pytest

from app.models import GroupMember, NlpParse, Notification, Transaction
from app.services.llm import client
from app.toolkit import crud
from app.toolkit.config import settings
from tests.routes.conftest import categories, family_of, guard, ledger_of, login, now, today, user


@pytest.fixture()
def model(monkeypatch):
    """假的模型服務：reply 放要回的 JSON，calls 記下每一次收到的 prompt。"""
    box = {"reply": None, "calls": [], "error": None}

    def fake(prompt, **kwargs):
        box["calls"].append(prompt + "\n" + kwargs.get("system", ""))
        if box["error"]:
            raise client.ModelError(box["error"])
        return box["reply"]

    monkeypatch.setattr(client, "is_configured", lambda: True)
    monkeypatch.setattr(client, "complete_json", fake)
    return box


def _item(**kw):
    base = {"span": "早餐55", "date": today(), "amount": 55, "kind": "expense", "cat": None,
            "merchant": "", "note": "", "conf": {"date": 0.9, "amount": 0.99, "kind": 0.97, "cat": 0.8}}
    return {**base, **kw}


# ===========================================================================
# POST /api/nlp/parse
# ===========================================================================
ONE = ("POST", "/api/nlp/parse")


@pytest.mark.route(*ONE)
def test_parse_one_沒設定模型回_503_空白回_422(api, monkeypatch):
    monkeypatch.setattr(client, "is_configured", lambda: False)
    me = user("d@x.tw", "爸爸")
    assert api.post("/api/nlp/parse", headers=login(me), json={"text": "早餐55"}).status_code == 503
    assert api.post("/api/nlp/parse", headers=login(me), json={"text": "   "}).status_code == 422
    assert api.post("/api/nlp/parse", json={"text": "早餐55"}).status_code == 401


@pytest.mark.route(*ONE)
def test_parse_one_回傳_out_而且不寫資料庫(api, model):
    me = user("d@x.tw", "爸爸")
    cats = categories()
    model["reply"] = {"items": [_item(cat=str(cats["餐飲"].id), merchant="全家")]}
    r = api.post("/api/nlp/parse", headers=login(me), json={"text": " 早餐55 "})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["raw"] == "早餐55" and body["matched"] is False
    assert body["out"] == {"date": today(), "amount": 55, "kind": "expense", "cat": str(cats["餐飲"].id),
                           "merchant": "全家", "conf": 0.99, "catConf": 0.8}
    assert str(cats["餐飲"].id) in model["calls"][0] and today() in model["calls"][0]
    assert crud.count(Transaction) == 0 and crud.count(NlpParse) == 0


# ===========================================================================
# POST /api/nlp/parse-batch
# ===========================================================================
BATCH = ("POST", "/api/nlp/parse-batch")


@pytest.mark.route(*BATCH)
def test_parse_batch_每一欄都驗證_抽不到的放進_missing(api, model):
    me = user("d@x.tw", "爸爸")
    cats = categories()
    food, salary = str(cats["餐飲"].id), str(cats["薪資"].id)
    model["reply"] = {"items": [
        _item(span="早餐55", cat=food),
        _item(span="晚上加油", amount=None, cat=food),
        _item(span="亂編的", date="9/17", amount="abc", kind="gift", cat="999"),
        _item(span="收支對不上", cat=salary, conf={"date": 5, "amount": "x"}),
        "不是物件的一筆",
    ]}
    r = api.post("/api/nlp/parse-batch", headers=login(me), json={"text": "早餐55，晚上加油"})
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert [i["seq"] for i in items] == [1, 2, 3, 4]
    assert items[0]["missing"] == [] and items[0]["amount"] == 55 and items[0]["cat"] == food
    assert items[1]["missing"] == ["amount"] and items[1]["amount"] is None and items[1]["hint"]
    assert set(items[2]["missing"]) == {"date", "amount", "kind", "cat"}
    assert items[2]["date"] is None and items[2]["kind"] is None and items[2]["cat"] is None
    assert items[3]["missing"] == ["cat"]
    assert items[3]["conf"] == {"date": 1.0, "amount": 0.0, "kind": 0.0, "cat": 0.0}
    assert r.json()["raw"] == "早餐55，晚上加油"
    assert crud.count(Transaction) == 0


@pytest.mark.route(*BATCH)
def test_parse_batch_模型的問題一律_503(api, model, monkeypatch):
    me = user("d@x.tw", "爸爸")
    model["error"] = "模型服務沒有回應"
    assert api.post("/api/nlp/parse-batch", headers=login(me), json={"text": "早餐55"}).status_code == 503
    model["error"] = None
    model["reply"] = ["不是", "物件"]
    assert api.post("/api/nlp/parse-batch", headers=login(me), json={"text": "早餐55"}).status_code == 503
    monkeypatch.setattr(client, "is_configured", lambda: False)
    assert api.post("/api/nlp/parse-batch", headers=login(me), json={"text": "早餐55"}).status_code == 503
    assert api.post("/api/nlp/parse-batch", headers=login(me), json={"text": " "}).status_code == 422


@pytest.mark.route(*BATCH)
@pytest.mark.parametrize("text", [
    "威力彩中了200000000", "我今天威力彩中獎200000000", "刮刮樂贏了200000000",
    "我的大樂透獎金200000000入帳", "I won 200000000 in the lottery",
])
def test_parse_batch_clear_lottery_model_income_is_preserved_without_writing(api, model, text):
    me = user("lottery-income@x.tw", "核對者")
    cats = categories()
    income = str(cats["其他收入"].id)
    model["reply"] = {"items": [_item(span=text, amount=200000000, kind="income", cat=income)]}
    result = api.post("/api/nlp/parse-batch", headers=login(me), json={"text": text})
    assert result.status_code == 200, result.text
    item = result.json()["items"][0]
    assert (item["kind"], item["cat"], item["amount"], item["missing"]) == ("income", income, 200000000, [])
    assert result.json()["by"] == "model"
    assert "本人實際中獎是 income" in model["calls"][0] and "他人中獎" in model["calls"][0]
    assert crud.count(Transaction) == 0 and crud.count(NlpParse) == 0


@pytest.mark.route(*BATCH)
@pytest.mark.parametrize("text,span", [
    ("威力彩沒中獎200000000", "威力彩沒中獎200000000"),
    ("威力彩沒有中獎200000000", "威力彩沒有中獎200000000"),
    ("威力彩未中獎200000000", "威力彩未中獎200000000"),
    ("如果我的威力彩中了200000000", "威力彩中了200000000"),
    ("假設威力彩中獎200000000", "威力彩中獎200000000"),
    ("希望威力彩中獎200000000", "威力彩中獎200000000"),
    ("夢到我威力彩中了200000000", "威力彩中了200000000"),
    ("朋友威力彩中了200000000", "威力彩中了200000000"),
    ("我朋友威力彩中了200000000", "威力彩中了200000000"),
    ("同事威力彩中了200000000", "威力彩中了200000000"),
    ("他威力彩中了200000000", "威力彩中了200000000"),
    ("新聞有人威力彩中了200000000", "威力彩中了200000000"),
    ("威力彩中了200000000嗎", "威力彩中了200000000"),
    ("威力彩中了200000000？", "威力彩中了200000000"),
    ("明天威力彩中獎200000000", "威力彩中獎200000000"),
    ("威力彩中獎200000000還沒領", "威力彩中獎200000000"),
    ("不是威力彩中獎200000000", "威力彩中獎200000000"),
    ("買威力彩200000000", "買威力彩200000000"),
    ("沒有買威力彩200000000", "買威力彩200000000"),
    ("If I won 200000000 in the lottery", "I won 200000000 in the lottery"),
    ("My friend won 200000000 in the lottery", "won 200000000 in the lottery"),
    ("I did not win 200000000 in the lottery", "I did not win 200000000 in the lottery"),
    ("威力彩沒中獎", "威力彩中了200000000"),
    ("朋友威力彩中了200000000，我威力彩中了200000000", "威力彩中了200000000"),
    ("如果買了威力彩，就中獎200000000", "中獎200000000"),
    ("如果威力彩中獎，我就有200000000收入", "我就有200000000收入"),
    ("朋友說，威力彩中了200000000", "威力彩中了200000000"),
    ("如果威力彩中獎200000000", "收入200000000"),
])
def test_parse_batch_lottery_nonactual_third_party_or_purchase_income_needs_review(api, model, text, span):
    me = user("lottery-review@x.tw", "核對者")
    cats = categories()
    model["reply"] = {"items": [_item(span=span, amount=200000000, kind="income", cat=str(cats["其他收入"].id))]}
    result = api.post("/api/nlp/parse-batch", headers=login(me), json={"text": text})
    assert result.status_code == 200, result.text
    item = result.json()["items"][0]
    assert item["kind"] is None and item["cat"] is None
    assert item["missing"] == ["kind", "cat"] and "本人實際收支" in item["hint"]
    assert item["conf"]["kind"] == item["conf"]["cat"] == 0
    assert crud.count(Transaction) == 0 and crud.count(NlpParse) == 0


@pytest.mark.route(*BATCH)
def test_parse_batch_lottery_expense_contradiction_is_withheld_and_unrelated_row_survives(api, model):
    me = user("lottery-expense@x.tw", "核對者")
    cats = categories()
    food, other = str(cats["餐飲"].id), str(cats["其他"].id)
    model["reply"] = {"items": [
        _item(span="威力彩中了200000000", amount=200000000, cat=other),
        _item(span="早餐55", cat=food),
    ]}
    result = api.post("/api/nlp/parse-batch", headers=login(me), json={"text": "威力彩中了200000000，早餐55"})
    assert result.status_code == 200, result.text
    prize, breakfast = result.json()["items"]
    assert prize["kind"] is None and prize["cat"] is None and prize["missing"] == ["kind", "cat"]
    assert (breakfast["kind"], breakfast["cat"], breakfast["amount"], breakfast["missing"]) == ("expense", food, 55, [])
    assert crud.count(Transaction) == 0 and crud.count(NlpParse) == 0


@pytest.mark.route(*BATCH)
@pytest.mark.parametrize("text", ["買威力彩100", "今天花100買彩券", "買威力彩100但沒中獎"])
def test_parse_batch_actual_ticket_purchase_remains_expense(api, model, text):
    me = user("lottery-purchase@x.tw", "核對者")
    cats = categories()
    other = str(cats["其他"].id)
    model["reply"] = {"items": [_item(span=text, amount=100, cat=other)]}
    result = api.post("/api/nlp/parse-batch", headers=login(me), json={"text": text})
    assert result.status_code == 200, result.text
    item = result.json()["items"][0]
    assert (item["kind"], item["cat"], item["amount"], item["missing"]) == ("expense", other, 100, [])
    assert crud.count(Transaction) == 0


@pytest.mark.route(*BATCH)
def test_parse_batch_lottery_qualifier_does_not_change_independent_salary_or_explicit_self_winnings(api, model):
    me = user("lottery-independent@x.tw", "核對者")
    cats = categories()
    salary, income = str(cats["薪資"].id), str(cats["其他收入"].id)
    model["reply"] = {"items": [
        _item(span="威力彩中了200000000", amount=200000000, kind="income", cat=income),
        _item(span="今天薪水30000", amount=30000, kind="income", cat=salary),
    ]}
    response = api.post("/api/nlp/parse-batch", headers=login(me), json={"text": "希望威力彩中了200000000，今天薪水30000"})
    assert response.status_code == 200, response.text
    prize, wage = response.json()["items"]
    assert prize["missing"] == ["kind", "cat"]
    assert (wage["kind"], wage["cat"], wage["amount"], wage["missing"]) == ("income", salary, 30000, [])

    model["reply"] = {"items": [_item(span="我威力彩中了200000000", amount=200000000, kind="income", cat=income)]}
    response = api.post("/api/nlp/parse-batch", headers=login(me), json={"text": "朋友付午餐55，我威力彩中了200000000"})
    assert response.status_code == 200, response.text
    assert response.json()["items"][0]["missing"] == []
    assert crud.count(Transaction) == 0 and crud.count(NlpParse) == 0


@pytest.mark.route(*BATCH)
def test_parse_batch_missing_lottery_span_requires_review_without_projecting_onto_sourced_salary(api, model):
    me = user("lottery-missing-span@x.tw", "核對者")
    cats = categories()
    salary, income = str(cats["薪資"].id), str(cats["其他收入"].id)
    model["reply"] = {"items": [
        _item(span="", amount=200000000, kind="income", cat=income),
        _item(span="薪水30000", amount=30000, kind="income", cat=salary),
    ]}
    response = api.post("/api/nlp/parse-batch", headers=login(me), json={"text": "朋友威力彩中了200000000，薪水30000"})
    assert response.status_code == 200, response.text
    prize, wage = response.json()["items"]
    assert prize["missing"] == ["kind", "cat"]
    assert (wage["kind"], wage["cat"], wage["missing"]) == ("income", salary, [])
    assert crud.count(Transaction) == 0 and crud.count(NlpParse) == 0


@pytest.mark.route(*ONE)
def test_parse_one_lottery_wrong_expense_needs_explicit_review_without_income_fallback(api, model):
    me = user("lottery-single@x.tw", "核對者")
    cats = categories()
    model["reply"] = {"items": [_item(span="", amount=200000000, cat=str(cats["其他"].id))]}
    result = api.post("/api/nlp/parse", headers=login(me), json={"text": "威力彩中了200000000"})
    assert result.status_code == 200, result.text
    assert result.json()["out"]["kind"] is None and result.json()["out"]["cat"] is None
    assert result.json()["by"] == "model"
    assert crud.count(Transaction) == 0 and crud.count(NlpParse) == 0


# ===========================================================================
# POST /api/nlp/confirm
# ===========================================================================
CONFIRM = ("POST", "/api/nlp/confirm")


@pytest.mark.route(*CONFIRM)
def test_confirm_one_寫入明細與評測資料(api):
    me = user("d@x.tw", "爸爸")
    cats = categories()
    g = ledger_of(me)
    food = str(cats["餐飲"].id)
    r = api.post("/api/nlp/confirm", headers=login(me), json={
        "date": today(), "amount": 60, "kind": "expense", "cat": food, "raw": "早餐55", "conf": 0.99, "catConf": 0.9, "groupId": str(g.id),
        "orig": {"by": "model", "date": today(), "amount": 55, "kind": "expense", "cat": food}})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["source"] == "nlp" and body["raw"] == "早餐55" and body["group"] == str(g.id)
    assert body["parsed"] == {"conf": 0.99, "catConf": 0.9}
    p = crud.get(NlpParse, where={"transaction_id": int(body["id"])})
    assert p.raw_text == "早餐55" and p.user_corrected == {"amount": 60}
    assert p.parsed_json["amount"] == 55 and p.model_ver != "rules"


@pytest.mark.route(*CONFIRM)
def test_confirm_one_規則解析的不算模型成績_錯誤情況(api):
    me = user("d@x.tw", "爸爸")
    cats = categories()
    ledger_of(me)
    food, salary = str(cats["餐飲"].id), str(cats["薪資"].id)
    base = {"date": today(), "amount": 55, "kind": "expense", "cat": food, "raw": "早餐55"}
    r = api.post("/api/nlp/confirm", headers=login(me), json={
        **base, "orig": {"by": "rules", "date": today(), "amount": 55, "kind": "expense", "cat": food}})
    assert r.status_code == 201, r.text
    p = crud.get(NlpParse, where={"transaction_id": int(r.json()["id"])})
    assert p.model_ver == "rules" and p.user_corrected is None
    assert api.post("/api/nlp/confirm", headers=login(me), json={**base, "cat": salary}).status_code == 400
    assert api.post("/api/nlp/confirm", headers=login(me), json={**base, "date": "9/17"}).status_code == 422
    assert crud.count(Transaction) == 1


@pytest.mark.route(*CONFIRM)
def test_confirm_one_hybrid_preserves_unadjusted_model_output_and_reviewed_ledger(api):
    me = user("hybrid@x.tw", "核對者")
    cats = categories()
    ledger_of(me)
    food, salary = str(cats["餐飲"].id), str(cats["薪資"].id)
    original = {"by": "hybrid", "date": today(), "amount": 55, "kind": "income", "cat": salary,
                "merchant": "模型捏造商家", "note": ""}
    reviewed = {"date": today(), "amount": 60, "kind": "expense", "cat": food,
                "merchant": "", "note": "", "raw": "午餐55", "orig": original}
    response = api.post("/api/nlp/confirm", headers=login(me), json=reviewed)
    assert response.status_code == 201, response.text
    transaction = crud.get(Transaction, int(response.json()["id"]))
    parsed = crud.get(NlpParse, where={"transaction_id": transaction.id})
    assert (float(transaction.amount), transaction.kind, transaction.category_id, transaction.merchant) == (60, "expense", int(food), None)
    assert parsed.model_ver == "hybrid" and parsed.parsed_json == original
    assert parsed.user_corrected == {"amount": 60, "kind": "expense", "cat": food, "merchant": ""}


@pytest.mark.route(*CONFIRM)
def test_confirm_one_rejects_unknown_provenance_without_writing(api):
    me = user("provenance@x.tw", "核對者")
    food = str(categories()["餐飲"].id)
    ledger_of(me)
    response = api.post("/api/nlp/confirm", headers=login(me), json={
        "date": today(), "amount": 55, "kind": "expense", "cat": food,
        "orig": {"by": "user-defined-model"},
    })
    assert response.status_code == 422
    assert crud.count(Transaction) == crud.count(NlpParse) == 0


# ===========================================================================
# POST /api/nlp/confirm-batch
# ===========================================================================
CB = ("POST", "/api/nlp/confirm-batch")


@pytest.mark.route(*CB)
def test_confirm_batch_整批寫入_每筆都有評測資料與通知(api):
    kid, mom = user("k@x.tw", "小華"), user("m@x.tw", "媽媽")
    fam = family_of((mom, "parent"), (kid, "child"))
    guard(mom, kid)
    cats = categories(fam)
    ledger_of(kid, name="第一本")
    g = ledger_of(kid, name="旅遊")
    food, pet = str(cats["餐飲"].id), str(cats["寵物"].id)
    items = [
        {"span": "早餐55", "date": today(), "amount": 55, "kind": "expense", "cat": food, "groupId": str(g.id),
         "conf": {"date": 0.9, "amount": 0.99, "kind": 0.9, "cat": 0.8},
         "orig": {"by": "model", "date": today(), "amount": 55, "kind": "expense", "cat": pet},
         "seq": 1, "missing": [], "hint": ""},
        {"span": "飼料300", "date": today(), "amount": 300, "kind": "expense", "cat": pet},
    ]
    r = api.post("/api/nlp/confirm-batch", headers=login(kid), json={"items": items})
    assert r.status_code == 201, r.text
    assert r.json() == {"created": 2}
    rows = crud.find(Transaction, order_by="id")
    assert [(t.group_id, t.source, int(t.amount)) for t in rows] == [(g.id, "nlp", 55), (g.id, "nlp", 300)]
    parses = crud.find(NlpParse, order_by="id")
    assert [p.raw_text for p in parses] == ["早餐55", "飼料300"]
    assert parses[0].user_corrected == {"cat": food} and float(parses[0].confidence) == 0.99
    assert parses[1].parsed_json is None
    assert sorted((n.recipient_id, n.transaction_id) for n in crud.find(Notification)) == \
        [(mom.id, rows[0].id), (mom.id, rows[1].id)]


@pytest.mark.route(*CB)
def test_confirm_batch_有一筆不對就一筆都不寫(api):
    me, mom = user("d@x.tw", "爸爸"), user("m@x.tw", "媽媽")
    cats = categories()
    g = ledger_of(me, mom)
    crud.save(GroupMember, {"notify": True}, where={"group_id": g.id, "user_id": mom.id})
    food, salary = str(cats["餐飲"].id), str(cats["薪資"].id)
    ok = {"span": "早餐55", "date": today(), "amount": 55, "kind": "expense", "cat": food, "groupId": str(g.id)}
    h = login(me)
    r = api.post("/api/nlp/confirm-batch", headers=h, json={"items": [ok, {**ok, "cat": salary}]})
    assert r.status_code == 400 and "第 2 筆" in r.json()["detail"]
    r = api.post("/api/nlp/confirm-batch", headers=h, json={"items": [ok, {**ok, "date": "9/17"}]})
    assert r.status_code == 422 and "第 2 筆" in r.json()["detail"]
    assert api.post("/api/nlp/confirm-batch", headers=h, json={"items": []}).status_code == 422
    done = ledger_of(me, name="已結算", kind="temp", settled_at=now())
    r = api.post("/api/nlp/confirm-batch", headers=h, json={"items": [{**ok, "groupId": str(done.id)}]})
    assert r.status_code == 409
    assert crud.count(Transaction) == 0 and crud.count(NlpParse) == 0 and crud.count(Notification) == 0
    r = api.post("/api/nlp/confirm-batch", headers=h, json={"items": [ok, ok]})
    assert r.status_code == 201 and crud.count(Notification) == 2


@pytest.mark.route(*CB)
def test_confirm_batch_preserves_each_provenance_and_reviewed_values(api):
    me = user("mixed-provenance@x.tw", "核對者")
    food = str(categories()["餐飲"].id)
    ledger_of(me)
    base = {"date": today(), "amount": 55, "kind": "expense", "cat": food, "merchant": "", "note": ""}
    items = []
    for index, source in enumerate(("model", "rules", "hybrid", None)):
        item = {**base, "span": "早餐55", "amount": 60 + index}
        if source is not None:
            item["orig"] = {**base, "by": source}
        items.append(item)
    response = api.post("/api/nlp/confirm-batch", headers=login(me), json={"items": items})
    assert response.status_code == 201 and response.json() == {"created": 4}
    rows = crud.find(Transaction, order_by="id")
    parses = crud.find(NlpParse, order_by="id")
    assert [float(row.amount) for row in rows] == [60, 61, 62, 63]
    assert [row.model_ver for row in parses] == [settings.model_name, "rules", "hybrid", settings.model_name]
    assert [row.parsed_json["by"] if row.parsed_json else None for row in parses] == ["model", "rules", "hybrid", None]
    assert [row.user_corrected for row in parses] == [{"amount": 60}, {"amount": 61}, {"amount": 62}, None]


@pytest.mark.route(*CB)
def test_confirm_batch_hybrid_still_validates_every_record_before_writing(api):
    me, recipient = user("atomic-hybrid@x.tw", "核對者"), user("notify@x.tw", "家人")
    cats = categories()
    group = ledger_of(me, recipient)
    crud.save(GroupMember, {"notify": True}, where={"group_id": group.id, "user_id": recipient.id})
    base = {"date": today(), "amount": 55, "kind": "expense", "cat": str(cats["餐飲"].id), "orig": {"by": "hybrid"}}
    response = api.post("/api/nlp/confirm-batch", headers=login(me), json={
        "items": [base, {**base, "cat": str(cats["薪資"].id)}],
    })
    assert response.status_code == 400 and "第 2 筆" in response.json()["detail"]
    assert crud.count(Transaction) == crud.count(NlpParse) == crud.count(Notification) == 0
