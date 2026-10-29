"""Exact, authorized scenario planning; optional local LLM explanation is separate.

領域：數字

All arithmetic is Decimal and deterministic. A historical ledger surplus is an
explicit scenario assumption, never an assertion about a bank account balance.
The service never modifies budgets, jars, reminders, transactions or memberships.
"""
from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR, localcontext

from sqlalchemy.orm import Session

from app.models import User
from app.schemas.ai_local import ContextQuery
from app.schemas.exchange import ConversionIn
from app.schemas.financial_planning import PlanningIn
from app.services import ai_local, exchange, financial_knowledge

ZERO = Decimal(0)
MAX_CONVERTED_TWD = Decimal("1000000000000")


class PlanningError(ValueError):
    pass


def _today() -> date:
    return datetime.now(timezone(timedelta(hours=8))).date()


def _money(value: Decimal) -> str:
    return format(value, ".0f")


def _monthly_date(anchor: date, offset: int) -> date:
    months = anchor.year * 12 + anchor.month - 1 + offset
    year, month = divmod(months, 12)
    return date(year, month + 1, min(anchor.day, monthrange(year, month + 1)[1]))


def _contribution_dates(today: date, deadline: date) -> list[str]:
    # Monthly capacity is earned once per complete calendar month, never again
    # for a few remaining days. A short deadline is a display-only one-off need.
    dates = []
    for offset in range(1, 121):
        candidate = _monthly_date(today, offset)
        if candidate > deadline:
            break
        dates.append(candidate.isoformat())
    return dates or [deadline.isoformat()]


def preview(db: Session, me: User, body: PlanningIn) -> dict:
    today = _today()
    remaining_days = (body.deadline - today).days
    if remaining_days < 0 or body.deadline > _monthly_date(today, 120):
        raise PlanningError("截止日須為今天起十年內的日期")
    dates = _contribution_dates(today, body.deadline)
    months = len(dates)
    full_monthly_installments = months if _monthly_date(today, 1) <= body.deadline else 0
    short_deadline_requires_funds = full_monthly_installments == 0
    grounded = ai_local.context(db, me, ContextQuery(period=body.period, scope=body.scope, limit=1))
    current = grounded["current"]
    warnings = ["試算只使用已記錄的收支及你填寫的假設，不代表銀行可用餘額，也不保證未來收入；請先保留必要生活支出與緊急預備金。"]
    if short_deadline_requires_funds:
        warnings.append("距截止日不足一個完整月；截止日所列為一次性需備妥金額，不能把每月結餘或每月投入假設當作期限前已有的即時資金。請另行確認已備妥資金，否則原期限可行性仍待確認。")
    quote = None
    with localcontext() as decimal_context:
        decimal_context.prec = 50
        if body.targetCurrency == "TWD":
            target_twd = body.targetAmount
        else:
            conversion = exchange.convert(ConversionIn(amount=body.targetAmount, fromCurrency=body.targetCurrency, toCurrency="TWD"))
            quote = conversion.model_dump(mode="json")
            target_twd = (body.targetAmount * conversion.rate).to_integral_value(rounding=ROUND_CEILING)
            warnings.append("外幣目標依國際參考匯率估算並向上取台幣整元；非銀行成交價，未包含手續費及匯差，出發前需重新估算。")
            if conversion.warning:
                warnings.append(conversion.warning)
            elif conversion.stale:
                warnings.append("匯率資料較舊，請核對更新時間後再使用。")
        if target_twd <= 0 or target_twd > MAX_CONVERTED_TWD:
            raise PlanningError("換算後目標金額超過支援範圍，請調整金額")
        gap = max(ZERO, target_twd - body.savedTwd)
        required = (gap / months).to_integral_value(rounding=ROUND_CEILING)
        allowance_count = remaining_days // 7
        allowance_total = body.weeklyAllowanceTwd * allowance_count
        allowance_reserve = (allowance_total / months).to_integral_value(rounding=ROUND_CEILING)
        net = Decimal(current["net"])
        if body.monthlyContributionTwd is not None:
            capacity_source = "user-assumption"
            gross_capacity = body.monthlyContributionTwd
            warnings.append("每月可投入金額由你自行填寫，是情境假設；系統未查詢或驗證銀行餘額。")
        elif current["transactionCount"]:
            capacity_source = "ledger"
            gross_capacity = net
            warnings.append(f"每月投入能力暫以 {current['period']} 已記錄結餘估算；當月尚未結束或漏記固定支出，可能高估能力。")
        else:
            capacity_source = "unknown"
            gross_capacity = None
            warnings.append("所選月份沒有記帳資料，尚無法判斷每月負擔能力；可填寫自行確認的每月可投入金額。")
        available = None if gross_capacity is None else max(ZERO, gross_capacity - allowance_reserve).to_integral_value(rounding=ROUND_FLOOR)
        if gross_capacity is not None and gross_capacity < allowance_reserve:
            warnings.append("目前假設的每月投入金額不足以預留本次零用錢，請先調整零用錢或投入假設。")
        target_feasible = None if available is None else required <= available and gross_capacity >= allowance_reserve
        if gap == 0 and allowance_reserve == 0:
            target_feasible = True
        if short_deadline_requires_funds and gap > 0 and target_feasible is True:
            target_feasible = None
        comfortable_amount = None if available is None else min(required, available)
        comfortable_months = None if comfortable_amount is None or comfortable_amount <= 0 else max(1, int((gap / comfortable_amount).to_integral_value(rounding=ROUND_CEILING)))
        if gap == 0:
            comfortable_amount, comfortable_months = ZERO, 0
        # Do not manufacture a far-future calendar promise from an implausibly
        # small contribution. Unknown extension remains visible to the user.
        extended_date = None
        if comfortable_months is not None and 0 < comfortable_months <= 120:
            extended_date = dates[comfortable_months - 1] if full_monthly_installments and comfortable_months <= months else _monthly_date(today, comfortable_months).isoformat()
        comfortable_feasible = None if available is None else (gap == 0 or comfortable_amount > 0) and gross_capacity >= allowance_reserve
        if comfortable_months is not None and (comfortable_months > months or short_deadline_requires_funds and comfortable_months > 0):
            comfortable_feasible = None
        if comfortable_months is not None and comfortable_months > 120:
            warnings.append("保留現金流方案推估超過十年，不提供完成日期；請調整目標或投入金額後重新試算。")
            comfortable_feasible = None
        facts = {
            "targetTwd": _money(target_twd), "savedTwd": _money(body.savedTwd), "gapTwd": _money(gap),
            "remainingDays": remaining_days, "contributionMonths": months,
            "fullMonthlyInstallments": full_monthly_installments,
            "shortDeadlineRequiresFunds": short_deadline_requires_funds,
            "contributionDates": dates, "requiredMonthlyTwd": _money(required),
            "weeklyAllowanceReserveTwd": _money(allowance_reserve),
            "allowanceMonthlyReserveTwd": _money(allowance_reserve),
            "allowancePaymentCount": allowance_count, "allowanceTotalTwd": _money(allowance_total),
            "ledgerIncomeTwd": current["income"], "ledgerExpenseTwd": current["expense"],
            "recordedMonthlyNetTwd": current["net"],
            "grossMonthlyCapacityTwd": None if gross_capacity is None else format(gross_capacity, ".2f"),
            "availableMonthlyTwd": None if available is None else _money(available),
            "capacitySource": capacity_source, "transactionCount": current["transactionCount"],
            "period": current["period"], "scope": body.scope,
        }
        if gap == 0:
            deadline_description = "依自行填寫的已存金額，目標金額已足夠；請另外確認實際資金及零用錢預留。"
        elif target_feasible is True:
            deadline_description = f"共 {months} 期，每期至少存 {_money(required)} 元；依本次投入假設可達成，最後一期可依剩餘缺口調低。"
        elif target_feasible is False:
            deadline_description = "依目前已記錄結餘或自行填寫的投入假設，無法在期限內達成；請調整金額、期限或確認額外可投入資金。"
        else:
            deadline_description = "已算出截止日一次性需備妥金額，但每月投入不代表已有即時資金；請確認期限前實際可用資金。" if short_deadline_requires_funds else "已算出期限內每月應存金額，但沒有足夠資料判斷負擔能力；請先確認固定支出及每月可投入金額。"
        plans = [
            {"id": "deadline", "title": "依原期限達標", "monthlyTwd": _money(required), "months": months,
             "deadline": body.deadline.isoformat(), "feasible": target_feasible, "description": deadline_description,
             "evidenceIds": ["planning:facts"] + (["quote:exchange"] if quote else [])},
            {"id": "comfortable", "title": "保留現金流再安排期限", "monthlyTwd": None if comfortable_amount is None else _money(comfortable_amount),
             "months": comfortable_months, "deadline": extended_date,
             "feasible": comfortable_feasible,
             "description": "以本次每月可投入金額作固定情境估算；若需延長期限，零用錢次數、匯率與生活支出必須重新試算。" if comfortable_months is not None else "每月可投入金額尚未確認或目前為零，無法估算達成日期；先確認現金流，再調整目標。",
             "evidenceIds": ["planning:facts"]},
        ]
    retrieval_query = (body.question.strip() + " " + ("家庭旅行 外幣 匯率 " if quote else "") + "儲蓄目標 預算 現金流 必要支出 緊急預備金" + (" 親子零用錢" if body.weeklyAllowanceTwd else ""))[:500]
    knowledge = financial_knowledge.search(retrieval_query, limit=4)
    for plan in plans:
        plan["evidenceIds"].extend(item["id"] for item in knowledge["items"])
    sources = [
        {"id": "planning:facts", "title": f"{current['period']} 授權收支與本次規劃假設", "link": f"/api/ai-local/context?period={current['period']}&scope={body.scope}"},
        *[{"id": "planning:plan:" + plan["id"], "title": plan["title"], "link": "#/financial-planning"} for plan in plans],
        *[{"id": item["id"], "title": item["title"], "link": item["sourceLink"]} for item in knowledge["items"]],
    ]
    if quote:
        sources.append({"id": "quote:exchange", "title": quote["provider"] + " 國際參考匯率", "link": quote["sourceUrl"]})
    return {
        "version": 1, "currency": "TWD", "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "input": {**body.model_dump(mode="json"), "period": current["period"]},
        "facts": facts, "quote": quote, "plans": plans, "knowledge": knowledge, "sources": sources,
        "warnings": warnings,
        "dataPolicy": {
            "readOnly": True, "totalsComplete": True, "calculation": "decimal-program-scenario",
            "inferencePerformed": False, "bankBalanceAccessed": False,
            "feasibilityMeaning": "是否依本次投入假設支應目標及額外零用錢；需延長期限的方案僅估算期數，須重新試算才能確認。",
            "scopeDefinition": grounded["scopeInfo"]["definition"],
            "installmentRule": "只計入今天起每滿一個月且不晚於截止日的投入日期；最後不足一個月不另增加整月投入能力。完全沒有完整月時，截止日僅展示一次性需備妥金額，不推定已有即時資金。金額向上取台幣整元。",
            "allowanceRule": "從今天七天後起，每七天一次，直到截止日（含）；總額按存款期數均攤並向上取整元。延長方案需重新計算。",
            "statement": "程式試算與知識檢索已執行，尚未執行模型推論；規劃是假設，不是投資建議、轉帳或保證。建立目標需另外由使用者確認。",
        },
    }
