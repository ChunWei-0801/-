"""Fixed-source public safety updates and referenced financial education.

領域：數字

Only the government CSV URL published by data.gov.tw/dataset/38262 is fetched.
There is no URL parameter, model, account data or paid service in this module.
"""
from __future__ import annotations

import copy
import csv
import io
import logging
import re
import threading
import time
from datetime import datetime, timezone
from html.parser import HTMLParser

import httpx

# Uvicorn configures this logger in production; the success audit therefore
# reaches deployment logs without changing application-wide logging settings.
log = logging.getLogger("uvicorn.error")
DATASET_URL = "https://data.gov.tw/dataset/38262"
FEED_URL = "https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/4F4DF9A5-DF4C-4EE8-A50D-869347D38D9E/resource/F1A9B8D5-F1F1-4129-A9E9-AA59EC20E044/download"
MAX_BYTES = 2 * 1024 * 1024
CACHE_TTL_SECONDS = 3600
MIN_REFRESH_SECONDS = 60
MAX_ITEMS = 20
_lock = threading.Lock()
_snapshot: dict | None = None
_last_attempt = float("-inf")
_last_attempt_at: str | None = None
_last_failed = False
_warming = False


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class _PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.hidden += 1
        elif tag in {"br", "p", "div", "li"}:
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in {"script", "style"}:
            self.hidden = max(0, self.hidden - 1)
        elif tag in {"p", "div", "li"}:
            self.parts.append(" ")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def _plain(value: str, maximum: int) -> str:
    parser = _PlainText()
    parser.feed(value)
    clean = re.sub(r"[\x00-\x1f\x7f]", " ", "".join(parser.parts))
    return re.sub(r"\s+", " ", clean).strip()[:maximum]


def _published(value: str) -> str:
    """Keep publication precision: a date is not a fabricated midnight timestamp."""
    raw = _plain(value, 50)
    match = re.match(r"^(\d{2,4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?(?:\s|$)", raw)
    if not match:
        return raw
    year, month, day = map(int, match.groups())
    if year < 1911:
        year += 1911
    try:
        return datetime(year, month, day).date().isoformat()
    except ValueError:
        return raw


def _parse_csv(payload: bytes) -> list[dict]:
    if not payload or len(payload) > MAX_BYTES:
        raise ValueError("Invalid resource size")
    try:
        text = payload.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = payload.decode("cp950")
    reader = csv.DictReader(io.StringIO(text, newline=""))
    required = {"編號", "標題", "發佈時間", "發佈內容"}
    if not reader.fieldnames or len(reader.fieldnames) != len(set(reader.fieldnames)) or not required.issubset(reader.fieldnames):
        raise ValueError("Unrecognized government CSV schema")
    items: dict[str, dict] = {}
    for index, row in enumerate(reader):
        if index >= 10000:
            raise ValueError("Too many resource rows")
        if None in row or any(row.get(key) is None for key in required):
            raise ValueError("Malformed resource row")
        identifier = _plain(row["編號"], 80)
        title = _plain(row["標題"], 180)
        if not identifier or not title:
            continue
        items[identifier] = {
            "id": identifier,
            "title": title,
            "summary": _plain(row["發佈內容"], 600),
            "publishedAt": _published(row["發佈時間"]),
            # Do not guess a SPA article URL or expose links embedded in source HTML.
            "url": DATASET_URL,
        }
    if not items:
        raise ValueError("No usable government notices")
    return sorted(items.values(), key=lambda item: (item["publishedAt"], item["id"]), reverse=True)[:MAX_ITEMS]


def _download() -> bytes:
    """The sole outbound destination is a fixed government download; redirects fail."""
    deadline = time.monotonic() + 12.0
    with httpx.Client(timeout=httpx.Timeout(8.0, connect=4.0), follow_redirects=False) as client:
        with client.stream("GET", FEED_URL, headers={"Accept": "text/csv, application/octet-stream"}) as response:
            response.raise_for_status()
            if response.status_code != 200:
                raise ValueError("Unexpected resource response")
            content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
            if content_type not in {"text/csv", "application/csv", "application/octet-stream", "text/plain", "application/vnd.ms-excel"}:
                raise ValueError("Unexpected resource type")
            data = bytearray()
            for chunk in response.iter_bytes():
                if time.monotonic() > deadline:
                    raise ValueError("Resource download exceeded time budget")
                data.extend(chunk)
                if len(data) > MAX_BYTES:
                    raise ValueError("Resource too large")
            return bytes(data)


def anti_fraud(*, refresh: bool = False) -> dict:
    """Refresh at most hourly automatically, or once a minute on explicit demand."""
    global _snapshot, _last_attempt, _last_attempt_at, _last_failed
    now = _now()
    with _lock:
        tick = time.monotonic()
        age = (now - _snapshot["fetched"]).total_seconds() if _snapshot else None
        should_refresh = refresh or _snapshot is None or age >= CACHE_TTL_SECONDS
        if should_refresh and tick - _last_attempt >= MIN_REFRESH_SECONDS:
            _last_attempt = tick
            _last_attempt_at = _iso(now)
            try:
                items = _parse_csv(_download())
                _snapshot = {"items": items, "fetched": now}
                _last_failed = False
                log.info("antifraud_sync status=ready count=%d source=opdadm.moi.gov.tw lastSyncedAt=%s", len(items), _iso(now))
            except (httpx.HTTPError, ValueError, UnicodeError, csv.Error) as exc:
                _last_failed = True
                log.warning("antifraud_sync status=unavailable source=opdadm.moi.gov.tw errorCategory=%s", type(exc).__name__)
        stale = bool(_snapshot and (_last_failed or (now - _snapshot["fetched"]).total_seconds() >= CACHE_TTL_SECONDS))
        return {
            "status": "stale" if stale else "ready" if _snapshot else "unavailable",
            "items": copy.deepcopy(_snapshot["items"]) if _snapshot else [],
            "source": {"name": "警政署 165 詐騙闢謠專區", "url": DATASET_URL, "downloadUrl": FEED_URL,
                       "license": "政府資料開放授權條款－第1版", "licenseUrl": "https://data.gov.tw/licenses", "updateFrequency": "不定期更新"},
            "contentLanguage": "zh-TW",
            "lastSyncedAt": _iso(_snapshot["fetched"]) if _snapshot else None,
            "lastAttemptAt": _last_attempt_at,
            "stale": stale,
            "warning": "同步暫時失敗，目前顯示上次成功資料，請確認發布日期。" if stale else "政府資料尚未同步成功，請先開啟官方網站查看。" if _snapshot is None else None,
            "refreshAfterSeconds": max(0, int(MIN_REFRESH_SECONDS - (tick - _last_attempt))) if _last_attempt != float("-inf") else 0,
            "officialLinks": [
                {"title": "165 全民防騙網", "url": "https://165.npa.gov.tw/"},
                {"title": "165 打詐儀錶板", "url": "https://165dashboard.tw/"},
                {"title": "政府開放資料原始來源", "url": DATASET_URL},
            ],
            "hotline": "165",
        }


def start_warmup() -> None:
    """Production startup warms public data without delaying readiness or requiring cron."""
    global _warming
    from app.toolkit.config import settings

    if not settings.is_production or _warming:
        return
    _warming = True
    threading.Thread(target=anti_fraud, name="antifraud-public-warmup", daemon=True).start()


_REFERENCES = [
    {
        "id": "money-behavior", "title": "The Psychology of Money", "author": "Morgan Housel",
        "publisher": "Harriman House", "year": 2020, "isbn": "9780857197689", "type": "book",
        "url": "https://www.harriman-house.com/authors/morgan-housel/the-psychology-of-money/9780857197689",
        "topics": ["habits", "spending"],
        "principle": "觀察日常消費的情緒與習慣，建立自己能持續的財務做法。",
        "principleEn": "Notice how emotions and habits affect spending, and choose financial routines you can sustain.",
        "application": "每週看一次記帳，挑出一項自己願意調整的習慣。",
        "applicationEn": "Review your ledger weekly and choose one habit you are willing to change.",
    },
    {
        "id": "investing-costs", "title": "The Little Book of Common Sense Investing", "author": "John C. Bogle",
        "publisher": "John Wiley & Sons", "year": 2017, "isbn": "9781119404507", "type": "book",
        "url": "https://www.wiley-vch.de/en?isbn=9781119404507&option=com_eshop&view=product",
        "topics": ["diversification", "fees", "long-term"],
        "principle": "評估分散程度、投資費用與持有期限，避免把頻繁交易當成穩定獲利的方法。",
        "principleEn": "Consider diversification, investment costs and your time horizon rather than relying on frequent trading for dependable returns.",
        "application": "投入資金前先列出費用、風險與資金用途；本頁不推薦特定商品或保證報酬。",
        "applicationEn": "Before investing, list fees, risks and the purpose of your money. This page does not select products or promise returns.",
    },
    {
        "id": "emergency-fund", "title": "An essential guide to building an emergency fund",
        "author": "Consumer Financial Protection Bureau", "publisher": "Consumer Financial Protection Bureau",
        "year": None, "isbn": None, "type": "government-education",
        "url": "https://www.consumerfinance.gov/an-essential-guide-to-building-an-emergency-fund/",
        "topics": ["saving", "cash-flow", "emergencies"],
        "principle": "備用金目標取決於自己的風險與現金流；小額而持續的存款也有幫助。",
        "principleEn": "Set an emergency savings goal around your circumstances and cash flow; small, consistent contributions can help.",
        "application": "在存錢計畫建立自己的備用金目標，定期查看進度，再依收入變化調整。",
        "applicationEn": "Create your own emergency savings goal, review progress and adjust it when your income changes.",
    },
]


_TRANSLATIONS = {
    "zh-CN": [
        ("观察日常消费的情绪与习惯，建立自己能持续的财务做法。", "每周看一次记账，挑出一项自己愿意调整的习惯。"),
        ("评估分散程度、投资费用与持有期限，避免把频繁交易当成稳定获利的方法。", "投入资金前先列出费用、风险与资金用途；本页不推荐特定商品或保证回报。"),
        ("备用金目标取决于自己的风险与现金流；小额而持续的存款也有帮助。", "在存钱计划建立自己的备用金目标，定期查看进度，再依收入变化调整。"),
    ],
    "ja": [
        ("感情や習慣が支出に与える影響を観察し、続けられる家計管理の方法を選びましょう。", "週に一度記帳を振り返り、変えたい習慣を一つ選びましょう。"),
        ("頻繁な売買で安定した利益を期待するより、分散、費用、保有期間を検討しましょう。", "投資前に費用、リスク、資金の目的を書き出しましょう。特定の商品や利益を保証するものではありません。"),
        ("緊急資金の目標は自分の事情と収支に合わせて決めます。少額でも継続することが役立ちます。", "貯金計画で緊急資金の目標を作り、進捗と収入の変化に合わせて見直しましょう。"),
    ],
    "ko": [
        ("감정과 습관이 소비에 미치는 영향을 살피고 지속할 수 있는 재무 습관을 선택하세요.", "매주 장부를 살펴보고 바꿔 보고 싶은 습관 하나를 고르세요."),
        ("잦은 거래로 안정적인 수익을 기대하기보다 분산, 투자 비용, 보유 기간을 검토하세요.", "투자 전에 비용, 위험, 자금의 목적을 정리하세요. 특정 상품을 추천하거나 수익을 보장하지 않습니다."),
        ("비상자금 목표는 자신의 상황과 현금흐름에 맞게 정하세요. 적은 금액도 꾸준히 모으면 도움이 됩니다.", "저축 계획에 비상자금 목표를 만들고 진행 상황과 소득 변화에 따라 조정하세요."),
    ],
    "es": [
        ("Observa cómo las emociones y los hábitos influyen en tus gastos y elige rutinas financieras sostenibles.", "Revisa tu registro cada semana y elige un hábito que quieras cambiar."),
        ("Considera la diversificación, los costes y el plazo de inversión en vez de esperar ingresos seguros del comercio frecuente.", "Antes de invertir, anota los costes, los riesgos y el propósito del dinero. No se recomiendan productos ni se prometen rendimientos."),
        ("Adapta el objetivo de ahorro para emergencias a tus circunstancias y flujo de caja; las aportaciones pequeñas y constantes también ayudan.", "Crea tu propio objetivo de emergencia, revisa el avance y ajústalo cuando cambien tus ingresos."),
    ],
}
_NOTICES = {
    "zh-TW": "以出版社與政府公開頁面為參考整理；應用做法是本站整理，不是書籍逐字引用或個人投資指示。",
    "zh-CN": "以出版社与政府公开页面为参考整理；应用做法是本站整理，不是书籍逐字引用或个人投资指示。",
    "en": "Educational summaries reference publisher and government pages. Applications are our own suggestions, not book quotations or personal investment instructions.",
    "ja": "出版社と政府の公開情報を参考にした学習用の要約です。活用例は本サイトの提案で、書籍の引用や個別の投資指示ではありません。",
    "ko": "출판사와 정부의 공개 자료를 참고한 교육용 요약입니다. 적용 예시는 이 사이트의 제안이며 책의 직접 인용이나 개인 투자 지시가 아닙니다.",
    "es": "Resúmenes educativos basados en editoriales y páginas oficiales. Las aplicaciones son propuestas propias, no citas de libros ni instrucciones personales de inversión.",
}


def financial(language: str = "zh-TW") -> dict:
    items = copy.deepcopy(_REFERENCES)
    for index, item in enumerate(items):
        if language in _TRANSLATIONS:
            item["principle"], item["application"] = _TRANSLATIONS[language][index]
        elif language == "en":
            item["principle"] = item["principleEn"]
            item["application"] = item["applicationEn"]
        item.pop("principleEn")
        item.pop("applicationEn")
        item["contentLanguage"] = language
        item["sourceVerifiedOn"] = "2026-10-21"
    return {"items": items, "mode": "curated-referenced-education", "liveBookFeed": False,
            "notice": _NOTICES.get(language, _NOTICES["en"])}
