"""
自然語言記帳：一句話 → 一筆、一段話 → 好幾筆。**只解析，不寫入。**

領域：記帳

已實作的解析流程：
  1. 組 prompt：分類清單（GET /api/categories 那一份）、今天日期（「昨天」要換算）、few-shot 範例
  2. 呼叫 services/llm/client.complete_json()
  3. 驗證：金額 > 0、日期 YYYY-MM-DD、cat 在清單裡；缺的欄位放進 missing、信心度放進 conf
  4. 模型沒設定（client 回 None）或叫不動（ModelError）→ 路由回 503，前端會用規則頂著

回傳形狀跟前端的 mock 一樣（docs/02-前後端串接契約.md 的 POST /api/nlp/parse-batch）：
    {"raw": 原文, "items": [{"seq", "span", "date", "amount", "kind", "cat", "merchant", "note",
                            "conf": {"date", "amount", "kind", "cat"}, "missing": [...], "hint": ""}], "note": ""}

⚠️ 切分比抽欄位難，而且切錯比抽錯更難發現——每一筆都要帶 span（對應原句的哪一段）。
"""

from __future__ import annotations

import re
from typing import Any

from app.services.llm import client

MODEL_UNAVAILABLE = "模型服務還沒接上，先用前端的規則解析"

# These checks only withhold a lottery draft that needs review. They never
# create a transaction, choose a category or turn a model's expense into income.
_LOTTERY = re.compile(r"威力彩|大樂透|大乐透|樂透|乐透|今彩|彩券|彩票|刮刮樂|刮刮乐|運動彩券|運彩|运彩|\b(?:lottery|powerball|scratch[- ]?(?:card|off))\b", re.I)
_WINNING = re.compile(r"中(?:獎|奖|頭獎|头奖|了|到)|兌(?:獎|奖)|領(?:獎|奖)|(?:獎|奖)金|贏了|赢了|\b(?:won|winnings|winning)\b", re.I)
_PURCHASE = re.compile(r"買|买|購|购|投注|下注|花|\b(?:bought|buy|spent|paid)\b", re.I)
_NEGATED_WIN = re.compile(r"(?:沒|没|未|沒有|没有|不曾|並未|并未|不會|不会|還沒|还没)\s*(?:有|能|曾|會|会)?\s*(?:中|領獎|领奖|兌獎|兑奖)|\b(?:didn't|did not|never|not|no)\s+(?:win|won|winnings|prize)\b", re.I)
_NONACTUAL = re.compile(
    r"如果|假如|假設|假设|要是|萬一|万一|希望|願望|愿望|夢到|梦到|夢見|梦见|幻想|假想|假裝|假装|"
    r"可能|也許|也许|打算|準備|准备|明天|後天|后天|尚未|還沒領|还没领|未領|未领|"
    r"(?:中獎|中奖|中了).{0,8}(?:的話|的话|就會|就会)|"
    r"不是真的|不是.*(?:中獎|中奖)|假(?:中獎|中奖|消息)|詐騙|诈骗|聽說|听说|新聞|新闻|報導|报道|"
    r"朋友|同事|同學|同学|爸爸|媽媽|妈妈|哥哥|姐姐|弟弟|妹妹|別人|别人|其他人|有人|人家|鄰居|邻居|網友|网友|得主|"
    r"(?<!其)[他她](?:們|们)?|[?？]|嗎|吗|如何|怎麼|怎么|能否|會不會|会不会|是不是|"
    r"\b(?:if|would|could|hope|wish|dream|friend|colleague|coworker|he|she|they|someone|tomorrow|might)\b",
    re.I,
)
_NEGATED_PURCHASE = re.compile(r"(?:沒|没|沒有|没有|未|不曾)\s*(?:購買|购买|買|买|投注|下注)|\b(?:didn't|did not|never)\s+(?:buy|purchase)\b", re.I)
_CLAUSE = re.compile(r"[，,。；;！!？?\n]")
_SENTENCE = re.compile(r"[。；;！!？?\n]")
_CONDITIONAL = re.compile(r"如果|假如|假設|假设|要是|萬一|万一|希望|願望|愿望|夢到|梦到|幻想|\b(?:if|hope|wish|dream)\b", re.I)
_SELF = re.compile(r"我|本人|自己|\b(?:I|my)\b", re.I)
_CONSEQUENCE = re.compile(r"\s*(?:我|本人|自己|I)?\s*(?:就|會|会|能|可以|有|收入|拿|領|领|would|could)", re.I)
_LOTTERY_HINT = "彩券買入與中獎需分開核對，請確認這筆是否為本人實際收支，再選擇收支類型與分類。"


def _lottery_needs_review(text: str, span: str, kind: str | None, item_count: int) -> bool:
    """Check the source clause, including a subject or condition omitted by a model span."""
    if not (_LOTTERY.search(text) or _LOTTERY.search(span)):
        return False
    prefix = ""
    if span:
        starts = [match.start() for match in re.finditer(re.escape(span), text)]
        if len(starts) != 1:
            # An invented or ambiguous lottery span cannot establish ownership.
            return bool(_LOTTERY.search(span) or _WINNING.search(span) or kind == "income")
        start, end = starts[0], starts[0] + len(span)
        before = list(_CLAUSE.finditer(text[:start]))
        after = _CLAUSE.search(text, end)
        stop = after.end() if after and after.group() in "?？" else after.start() if after else len(text)
        source = text[before[-1].end() if before else 0:stop]
        sentence_before = list(_SENTENCE.finditer(text[:start]))
        prefix = text[sentence_before[-1].end() if sentence_before else 0:start]
    elif item_count == 1:
        source = text
    else:
        # An ungrounded income row in a lottery batch needs confirmation; a
        # model's sourced salary or meal row is checked against its own clause.
        return kind == "income"
    if not (_LOTTERY.search(source) or _WINNING.search(source)):
        # A conditional lottery consequence may omit the word "中獎" from its
        # own span, while an unrelated salary or meal row must remain intact.
        return bool(kind == "income" and _CONDITIONAL.search(prefix)
                    and _LOTTERY.search(prefix) and _CONSEQUENCE.match(source))
    if _CONDITIONAL.search(prefix) or (_NONACTUAL.search(prefix) and not _SELF.search(source)):
        return True
    purchase = bool(_PURCHASE.search(source))
    winning = bool(_WINNING.search(source))
    negated_win = bool(_NEGATED_WIN.search(source))
    if _NONACTUAL.search(source) or _NEGATED_PURCHASE.search(source):
        return True
    if negated_win:
        # "買威力彩100但沒中獎" still documents a real purchase, never winnings.
        return not (purchase and kind == "expense")
    if winning:
        return kind != "income" and not (purchase and kind == "expense")
    if purchase:
        return kind != "expense"
    return True


def parse_batch(text: str, categories: list[dict[str, Any]], today: str) -> dict[str, Any]:
    '''一段話 → 好幾筆。模型沒設定丟 client.ModelError（路由轉 503）。'''
    import json
    from datetime import date
    from math import isfinite

    from app.toolkit import money

    if not client.is_configured():
        raise client.ModelError(MODEL_UNAVAILABLE)

    # a. 組 prompt：規則、今天日期、分類清單（模型只能從這裡挑）、一組範例
    rules = [
        "你是記帳助理，把使用者的一段話切成一筆一筆的收支，只回 JSON，不要任何說明文字。",
        "每一筆要有 span（原句裡對應的那一段）、date（YYYY-MM-DD）、amount（正數）、",
        "kind（expense 或 income）、cat（下面分類清單裡的 id）、merchant（店家，沒有就空字串）、",
        "note（備註，沒有就空字串）、conf（date、amount、kind、cat 各一個 0 到 1 的信心度）。",
        "抽不到的欄位填 null，不要猜。「昨天」「前天」要換算成日期。",
        "彩券、威力彩等：本人實際中獎是 income，購買彩券是 expense，買入與中獎必須分開。",
        "沒中獎、假設、願望、疑問或他人中獎不能當成本人的收入；無法確認實際收支時 kind、cat 填 null，不能捏造交易。",
        "今天是 " + today + "。分類清單：",
    ]
    for c in categories:
        rules.append("  %s：%s（%s）" % (c["id"], c["name"], "收入" if c["kind"] == "income" else "支出"))
    ids = {c["name"]: c["id"] for c in categories}
    example = {"items": [
        {"span": "早上買早餐55", "date": today, "amount": 55, "kind": "expense", "cat": ids.get("餐飲", ""),
         "merchant": "", "note": "早餐", "conf": {"date": 0.9, "amount": 0.99, "kind": 0.97, "cat": 0.9}},
        {"span": "晚上加油", "date": today, "amount": None, "kind": "expense", "cat": ids.get("交通", ""),
         "merchant": "", "note": "加油", "conf": {"date": 0.9, "amount": 0, "kind": 0.95, "cat": 0.85}},
    ]}
    prompt = chr(10).join([
        "範例輸入：早上買早餐55，晚上加油",
        "範例輸出：" + json.dumps(example, ensure_ascii=False),
        "輸入：" + text,
        "輸出：",
    ])

    # b. 叫模型（逾時、重試、剝掉 JSON 外面的包裝，client 都做好了）
    data = client.complete_json(prompt, system=chr(10).join(rules), max_tokens=1024)
    raw_items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(raw_items, list):
        raise client.ModelError("模型回來的格式不對")

    # c. 一筆一筆驗證：抽不到、不合理的欄位設成 None，放進 missing
    def score(value):
        try:
            number = float(value)
            return min(1.0, max(0.0, number)) if isfinite(number) else 0.0
        except (TypeError, ValueError, OverflowError):
            return 0.0

    kinds = {c["id"]: c["kind"] for c in categories}
    items = []
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        missing = []
        span = str(raw.get("span") or "")
        lottery_review = _lottery_needs_review(text, span, raw.get("kind"), len(raw_items))
        try:
            day = date.fromisoformat(str(raw.get("date"))).isoformat()
        except ValueError:
            day = None
            missing.append("date")
        try:
            amount = money.to_decimal(raw.get("amount"), allow_negative=False)
        except money.InvalidAmount:
            amount = None
        if amount is None or amount <= 0:
            amount = None
            missing.append("amount")
        kind = raw.get("kind") if not lottery_review and raw.get("kind") in ("expense", "income") else None
        if kind is None:
            missing.append("kind")
        cat = str(raw.get("cat") or "") if not lottery_review else ""
        if cat not in kinds or (kind is not None and kinds[cat] != kind):
            cat = None
            missing.append("cat")
        conf = raw.get("conf") if isinstance(raw.get("conf"), dict) else {}
        items.append({
            "seq": len(items) + 1,
            "span": span[:100],
            "date": day,
            "amount": float(amount) if amount is not None else None,
            "kind": kind,
            "cat": cat,
            "merchant": str(raw.get("merchant") or "")[:50],
            "note": str(raw.get("note") or "")[:100],
            "conf": {k: 0.0 if lottery_review and k in {"kind", "cat"} else score(conf.get(k)) for k in ("date", "amount", "kind", "cat")},
            "missing": missing,
            "hint": _LOTTERY_HINT if lottery_review else "這一筆有欄位抽不到，補上才能存" if missing else "",
        })
    if not items:
        raise client.ModelError("模型沒有從這段話解析出任何一筆")
    return {"raw": text, "items": items,
            "note": "這段話被切成 %d 筆。切分本身也是模型的判斷，請對照原句檢查。" % len(items)}


def parse_one(text: str, categories: list[dict[str, Any]], today: str) -> dict[str, Any]:
    '''一句話 → 一筆。跟 parse_batch 用同一套 prompt，拿第一筆。'''
    result = parse_batch(text, categories, today)
    if not result["items"]:
        raise client.ModelError("模型沒有從這句話解析出任何一筆")
    return result["items"][0]
