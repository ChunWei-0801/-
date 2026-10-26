# 領域：數字
"""Consented monthly exports are read-only, owner-scoped and never send mail.

The random export grant is separate from login JWTs. Only its SHA256 is kept;
mail and Drive delivery are performed by the user's explicitly installed job.
"""
from __future__ import annotations

from collections import OrderedDict, deque
from datetime import date, datetime, timezone
from decimal import Decimal, localcontext
import csv
import hashlib
import hmac
from html import escape
from io import StringIO
import logging
import re
import secrets
import threading
import time
import unicodedata
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.models import Category, Group, Transaction, User
from app.models.report_subscription import ReportSubscription
from app.schemas.report_subscription import ReportSettingsIn
from app.toolkit import errors
from app.toolkit.config import settings

MAX_ROWS = 20_000
MAX_TEXT_BYTES = 4_000_000
MAX_DOCUMENT_BYTES = 16_000_000
_TOKEN = re.compile(r"^[A-Za-z0-9_-]{43}$")
_PERIOD = re.compile(r"^\d{4}-(?:0[1-9]|1[0-2])$")
_DUMMY_DIGEST = hashlib.sha256(b"invalid-monthly-report-grant").hexdigest()
_AUTH_WINDOW = 600
_AUTH_MAX_FAILURES = 20
_AUTH_MAX_CLIENTS = 2048
_failures: OrderedDict[str, deque] = OrderedDict()
_failure_lock = threading.Lock()
log = logging.getLogger(__name__)


def _now():
    return datetime.now(timezone.utc)


def _aware(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _eligible(user: User) -> bool:
    return bool(user.email_verified_at and not user.suspended_at and not user.is_platform_admin)


def _active(row, user, now=None) -> bool:
    return bool(row and row.enabled and _eligible(user) and row.token_hash and row.token_expires_at
                and _aware(row.token_expires_at) > (now or _now()) and row.authorized_email
                and hmac.compare_digest(row.authorized_email.casefold().encode(), user.email.casefold().encode()))


def settings_payload(user: User, row: ReportSubscription | None, *, now=None):
    return {
        "enabled": bool(row and row.enabled and _eligible(user)),
        "delivery": row.delivery if row else "email",
        "folderId": row.folder_id if row else None,
        "recipientEmail": user.email,
        "recipientVerified": user.email_verified_at is not None,
        "authorizationActive": _active(row, user, now),
        "tokenExpiresAt": _aware(row.token_expires_at).isoformat() if row and row.token_expires_at else None,
        "scope": "only-me", "timezone": "Asia/Taipei", "scheduleDay": 1,
    }


def get_settings(db: Session, user: User):
    # Opening settings must not silently enable delivery or create a row.
    return settings_payload(user, db.get(ReportSubscription, user.id))


def _locked_row(db: Session, user: User):
    # Serializes first settings creation and concurrent token rotations on PG.
    db.execute(select(User.id).where(User.id == user.id).with_for_update()).scalar_one()
    row = db.get(ReportSubscription, user.id)
    if row is None:
        row = ReportSubscription(user_id=user.id, enabled=False, delivery="email")
        db.add(row)
    return row


def _apply_settings(user, row, body: ReportSettingsIn, *, require_consent=False):
    if body.recipientEmail and body.recipientEmail.casefold() != user.email.casefold():
        raise errors.unprocessable("收件人只能使用目前帳號已驗證的個人信箱；留白會使用該信箱")
    if body.enabled or require_consent:
        if not _eligible(user):
            raise errors.forbidden("請先完成個人信箱驗證，才能啟用每月報表")
        if not body.termsAccepted:
            raise errors.unprocessable("請先確認報表保存範圍與寄送方式，再啟用每月報表")
    now = _now()
    row.enabled = body.enabled
    row.delivery = body.delivery
    row.folder_id = body.folderId if body.delivery in {"drive", "both"} else None
    row.updated_at = now
    if body.enabled:
        row.consented_at = now
    else:
        row.token_hash = row.token_expires_at = row.authorized_email = None


def save_settings(db: Session, user: User, body: ReportSettingsIn):
    row = _locked_row(db, user)
    _apply_settings(user, row, body)
    db.commit()
    return settings_payload(user, row)


def _export_url():
    value = settings.app_base_url.rstrip("/")
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        raise errors.service_unavailable("月報網站網址尚未正確設定，請稍後再試") from None
    local = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    if (parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in {"", "/"} or not parsed.hostname
            or any(ord(char) < 33 or ord(char) == 127 for char in value)
            or port is not None and port < 1
            or parsed.scheme != "https" and not (not settings.is_production and parsed.scheme == "http" and local)):
        raise errors.service_unavailable("月報網站網址尚未正確設定，請稍後再試")
    return value + "/api/monthly-reports/export"


def authorize(db: Session, user: User, body: ReportSettingsIn):
    if not body.enabled:
        raise errors.unprocessable("請確認啟用每月報表後，再建立讀取授權")
    export_url = _export_url()
    row = _locked_row(db, user)
    _apply_settings(user, row, body, require_consent=True)
    token = secrets.token_urlsafe(32)
    now = _now()
    try:
        expiry = now.replace(year=now.year + 1)
    except ValueError:  # Leap day remains a twelve-month grant.
        expiry = now.replace(year=now.year + 1, day=28)
    row.token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
    row.token_expires_at = expiry
    row.authorized_email = user.email
    db.commit()
    return {"token": token, "exportUrl": export_url, "settings": settings_payload(user, row)}


def revoke(db: Session, user: User):
    row = db.get(ReportSubscription, user.id)
    if row:
        row.enabled = False
        row.token_hash = row.token_expires_at = row.authorized_email = None
        row.updated_at = _now()
        db.commit()
    return settings_payload(user, row)


def _client_key(request):
    # Do not trust forwarding headers or log the caller IP or token.
    host = request.client.host if request.client else "unknown"
    return hashlib.sha256(host.encode()).hexdigest()


def _check_auth_rate(request):
    key, now = _client_key(request), time.monotonic()
    with _failure_lock:
        values = _failures.get(key)
        if values:
            while values and values[0] < now - _AUTH_WINDOW:
                values.popleft()
            if len(values) >= _AUTH_MAX_FAILURES:
                raise HTTPException(429, "讀取授權嘗試過於頻繁，請稍後再試", headers={"Retry-After": "600"})


def _auth_failed(request):
    key, now = _client_key(request), time.monotonic()
    with _failure_lock:
        values = _failures.setdefault(key, deque())
        while values and values[0] < now - _AUTH_WINDOW:
            values.popleft()
        values.append(now)
        _failures.move_to_end(key)
        while len(_failures) > _AUTH_MAX_CLIENTS:
            _failures.popitem(last=False)
    log.warning("monthly_report_export_authorization_failed")
    raise errors.unauthorized("月報讀取授權無效或已停用，請在設定重新建立授權")


def export_owner(db: Session, request) -> tuple[User, ReportSubscription]:
    """Authenticate only a read-only report grant; never accepts login JWTs."""
    _check_auth_rate(request)
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not _TOKEN.fullmatch(token):
        _auth_failed(request)
    digest = hashlib.sha256(token.encode("ascii")).hexdigest()
    row = db.execute(select(ReportSubscription).where(ReportSubscription.token_hash == digest)).scalar_one_or_none()
    found = row.token_hash if row and row.token_hash else _DUMMY_DIGEST
    matches = hmac.compare_digest(found, digest)
    user = db.get(User, row.user_id) if row and matches else None
    if user is None or not _active(row, user):
        _auth_failed(request)
    return user, row


def _period_range(period: str, *, now=None):
    if not _PERIOD.fullmatch(period or ""):
        raise errors.unprocessable("月份請使用 YYYY-MM")
    current = (now or _now()).astimezone(ZoneInfo("Asia/Taipei"))
    current_index = current.year * 12 + current.month - 1
    year, month = map(int, period.split("-"))
    index = year * 12 + month - 1
    if index < current_index - 24 or index >= current_index:
        raise errors.unprocessable("自動月報只提供最近二十四個已結束的月份")
    start = date(year, month, 1)
    end_year, end_month = divmod(index + 1, 12)
    return start, date(end_year, end_month + 1, 1)


def _csv_cell(value):
    value = str(value)
    probe = unicodedata.normalize("NFKC", value).lstrip(" \t\r\n\ufeff")
    if probe.startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def _documents(period, user, transactions, totals, categories):
    output = StringIO(newline="")
    output.write("\ufeff")
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(["日期", "收支", "金額（TWD）", "分類", "商家", "備註", "活動", "付款方式", "買方統一編號"])
    labels = {"expense": "支出", "income": "收入", "transfer": "轉帳（不計收支）"}
    table_rows = []
    for item in transactions:
        values = [item["date"], labels[item["kind"]], item["amount"], item["category"], item["merchant"],
                  item["note"], item["activity"], item["paymentMethod"], item["buyerTaxId"]]
        writer.writerow([_csv_cell(value) for value in values])
        table_rows.append("<tr>" + "".join("<td>" + escape(str(value), quote=True) + "</td>" for value in values) + "</tr>")
    html = ("<!doctype html><html lang=\"zh-Hant\"><head><meta charset=\"utf-8\"><title>" + period +
            " 家庭記帳月報</title><style>body{font-family:sans-serif;color:#172b26;font-size:11px}"
            "h1{font-size:20px}table{width:100%;border-collapse:collapse;table-layout:fixed}"
            "th,td{border:1px solid #bccbc4;padding:5px;text-align:left;overflow-wrap:anywhere;white-space:pre-wrap}"
            "thead{display:table-header-group}tr{break-inside:avoid}@page{size:A4 landscape;margin:12mm}</style></head><body>"
            "<h1>" + period + " 家庭記帳月報</h1><p>" + escape(user.display_name, quote=True) +
            " · 新臺幣 · 僅本人紀錄</p><p>收入：" + totals["income"] + "　支出：" + totals["expense"] +
            "　結餘：" + totals["net"] + "　筆數：" + str(totals["count"]) + "</p><p>轉帳不計入收入與支出。</p>"
            "<table><thead><tr>" + "".join("<th>" + name + "</th>" for name in
                ["日期", "收支", "金額", "分類", "商家", "備註", "活動", "付款方式", "統一編號"]) +
            "</tr></thead><tbody>" + "".join(table_rows) + "</tbody></table></body></html>")
    csv_content = output.getvalue()
    if len(html.encode()) + len(csv_content.encode()) > MAX_DOCUMENT_BYTES:
        raise errors.unprocessable("本月報表內容超過下載上限，請改用分段報表")
    return csv_content, html


def build_export(db: Session, user: User, subscription: ReportSubscription, period: str, *, now=None):
    """One read snapshot of the owner's rows. No lazy preference or audit writes."""
    from app.models.transaction_details import TransactionDetails

    start, end = _period_range(period, now=now)
    query = (select(Transaction, Category.name, Group.name, TransactionDetails.payment_method, TransactionDetails.buyer_tax_id)
             .outerjoin(Category, Category.id == Transaction.category_id)
             .outerjoin(Group, Group.id == Transaction.group_id)
             .outerjoin(TransactionDetails, and_(TransactionDetails.transaction_id == Transaction.id,
                                               TransactionDetails.user_id == user.id))
             .where(Transaction.user_id == user.id, Transaction.occurred_on >= start, Transaction.occurred_on < end)
             .order_by(Transaction.occurred_on, Transaction.id).limit(MAX_ROWS + 1)
             .execution_options(yield_per=500))
    transactions, grouped = [], {}
    totals = {"income": Decimal("0.00"), "expense": Decimal("0.00"), "count": 0, "transferCount": 0}
    size = 0
    with localcontext() as context:
        context.prec = 40
        for tx, category_name, activity_name, payment_method, tax_id in db.execute(query):
            if len(transactions) >= MAX_ROWS:
                raise errors.unprocessable("本月明細超過二萬筆，請改用分段報表；沒有截斷資料")
            if tx.kind not in {"expense", "income", "transfer"}:
                raise errors.unprocessable("帳務資料含無法辨識的收支類型，請先核對明細")
            amount = Decimal(tx.amount)
            if not amount.is_finite() or amount < 0:
                raise errors.unprocessable("帳務資料含無法核對的金額，請先核對明細")
            item = {"date": tx.occurred_on.isoformat(), "amount": format(amount, ".2f"), "kind": tx.kind,
                    "category": category_name or "", "merchant": tx.merchant or "", "note": tx.note or "",
                    "activity": activity_name or "", "paymentMethod": payment_method or "", "buyerTaxId": tax_id or ""}
            size += sum(len(value.encode("utf-8")) for value in item.values())
            if size > MAX_TEXT_BYTES:
                raise errors.unprocessable("本月報表內容超過下載上限，請改用分段報表")
            transactions.append(item)
            totals["count"] += 1
            if tx.kind == "transfer":
                totals["transferCount"] += 1
                continue
            totals[tx.kind] += amount
            key = (tx.category_id, tx.kind)
            bucket = grouped.setdefault(key, {"id": str(tx.category_id), "name": category_name or "",
                                              "kind": tx.kind, "amount": Decimal("0.00"), "count": 0})
            bucket["amount"] += amount
            bucket["count"] += 1
    result_totals = {"income": format(totals["income"], ".2f"), "expense": format(totals["expense"], ".2f"),
                     "net": format(totals["income"] - totals["expense"], ".2f"),
                     "count": totals["count"], "transferCount": totals["transferCount"]}
    categories = [{**item, "amount": format(item["amount"], ".2f")} for item in grouped.values()]
    csv_content, html = _documents(period, user, transactions, result_totals, categories)
    return {"version": 1, "period": period, "timezone": "Asia/Taipei", "recipientEmail": user.email,
            "delivery": subscription.delivery, "folderId": subscription.folder_id,
            "totals": result_totals, "categories": categories, "transactions": transactions,
            "csv": csv_content, "html": html}
