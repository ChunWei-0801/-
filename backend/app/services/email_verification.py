"""信箱驗證：單次連結、寄發冷卻及透明的本機展示模式。

領域：認證
"""

import logging
from datetime import datetime, timedelta, timezone
from threading import Lock
from urllib.parse import urlsplit

from fastapi import HTTPException

from app.toolkit import crud, errors, mailer, password_reset, tokens
from app.toolkit.config import settings
from app.services.mail_content import VERIFICATION_HOURS, verification_message

GENERIC_MESSAGE = "若此信箱已註冊且尚未驗證，驗證信將送至此信箱。請查看收件匣與垃圾信件匣。"
DEMO_MESSAGE = "目前為開發展示模式，沒有寄出郵件。請使用下方展示連結完成信箱驗證。"
INVALID_MESSAGE = "這個信箱驗證連結已失效，請重新申請"
TOKEN_MINUTES = VERIFICATION_HOURS * 60
COOLDOWN_SECONDS = 60
DAILY_SEND_LIMIT = 5
_rate_lock = Lock()


def verification_link(token: str) -> str:
    # 共用既有 URL/token 驗證，token 放在 fragment 中，不進伺服器 access log。
    base = urlsplit(settings.app_base_url.strip())
    if settings.is_production and (base.scheme != "https" or not base.hostname
                                  or base.username or base.password or base.fragment or base.query):
        raise ValueError("正式環境的 APP_BASE_URL 必須是完整 HTTPS 網址")
    return password_reset.reset_link(settings.app_base_url, token).replace("/#/reset/", "/#/verify-email/")


def _limit(db, request, action: str, limit: int, window_seconds: int) -> None:
    """只保存來源 IP 的雜湊，以持久稽核資料限制匿名申請與 token 猜測。"""
    from app.models import AuditLog
    source = request.client.host if request.client else "unknown"
    fingerprint = tokens.fingerprint(source)
    now = datetime.now(timezone.utc)
    with _rate_lock:
        attempts = crud.count(AuditLog, {"action": action, "target_type": fingerprint,
                                        "created_at__gte": now - timedelta(seconds=window_seconds)}, db=db)
        if attempts >= limit:
            raise HTTPException(429, "操作太頻繁，請稍後再試")
        crud.save(AuditLog, {"action": action, "target_type": fingerprint}, db=db)
        db.commit()


def request_verification(db, request, background, raw_email: str, language: str | None = None) -> dict:
    from app.models import EmailVerification, User
    try:
        email = password_reset.normalize_email(raw_email)
    except ValueError as exc:
        raise errors.bad_request(str(exc)) from None
    _limit(db, request, "email_verification_request", 10, 600)
    mode = settings.email_delivery_mode
    if mode == "unavailable":
        raise errors.service_unavailable("信箱驗證寄信服務尚未設定，請管理者設定寄件服務")
    try:
        # Validate configuration before account lookup, so a bad deployment does
        # not expose whether a requested email is registered.
        verification_link("x" * 43)
    except ValueError:
        raise errors.service_unavailable("信箱驗證網址設定有誤，請管理者設定正式網站的 HTTPS 網址") from None
    answer = {"ok": True, "message": GENERIC_MESSAGE, "delivery": "email"}
    if mode == "demo":
        answer.update(message=DEMO_MESSAGE, delivery="demo")
    user = crud.get(User, where={"email": email}, for_update=True, db=db)
    if user is None or user.email_verified_at is not None:
        return answer
    now = datetime.now(timezone.utc)
    rows = crud.find(EmailVerification, {"user_id": user.id}, order_by="-created_at", db=db)
    last = rows[0].created_at if rows else None
    if not password_reset.should_send(last, now, COOLDOWN_SECONDS):
        return answer
    daily = crud.count(EmailVerification, {"user_id": user.id, "created_at__gte": now - timedelta(days=1)}, db=db)
    if daily >= DAILY_SEND_LIMIT:
        return answer
    token = password_reset.new_token()
    link = verification_link(token)
    if mode == "email":
        subject, text, html = verification_message(user.display_name, link, language or user.language or "zh-TW")
        try:
            # Confirm provider acceptance before reporting success or starting a resend cooldown.
            mailer.send_mail(user.email, subject, text, html, to_name=user.display_name)
        except (mailer.MailNotConfigured, mailer.MailError, ValueError) as exc:
            db.rollback()
            logging.getLogger("fambudget").warning("信箱驗證寄送失敗：%s", exc.__class__.__name__)
            raise errors.service_unavailable("驗證信暫時無法寄出，請稍後再試或聯絡管理者檢查寄信服務") from None
    # 重新寄發會撤銷舊連結；使用與過期採同一個通用錯誤訊息。
    crud.save(EmailVerification, {"used_at": now}, where={"user_id": user.id, "used_at__isnull": True}, db=db)
    crud.save(EmailVerification, {"user_id": user.id, "token_hash": password_reset.hash_token(token),
                                 "expires_at": now + timedelta(minutes=TOKEN_MINUTES)}, db=db)
    db.commit()
    if mode == "demo":
        # 即使 REQUIRE_EMAIL_VERIFICATION 被手動關閉，正式環境仍不提供任何 token。
        if settings.is_production:
            raise errors.service_unavailable("正式環境未設定寄信服務")
        answer["demoVerificationUrl"] = link
        return answer
    return answer


def confirm_verification(db, request, token: str) -> dict:
    from app.models import EmailVerification, User
    _limit(db, request, "email_verification_confirm", 20, 600)
    try:
        fingerprint = password_reset.hash_token(token)
    except ValueError:
        raise errors.bad_request(INVALID_MESSAGE) from None
    row = crud.get(EmailVerification, where={"token_hash": fingerprint}, db=db)
    if row is None:
        raise errors.bad_request(INVALID_MESSAGE)
    # 與重新寄發同樣先鎖 User 再鎖 token，避免交錯造成重複使用或死鎖。
    user = crud.get(User, row.user_id, for_update=True, db=db)
    row = crud.get(EmailVerification, row.id, for_update=True, db=db)
    db.refresh(row)
    try:
        password_reset.require_usable(row.expires_at, row.used_at)
    except ValueError:
        raise errors.bad_request(INVALID_MESSAGE) from None
    if user is None:
        raise errors.bad_request(INVALID_MESSAGE)
    now = datetime.now(timezone.utc)
    crud.save(User, {"id": user.id, "email_verified_at": now}, db=db)
    crud.save(EmailVerification, {"used_at": now}, where={"user_id": user.id, "used_at__isnull": True}, db=db)
    db.commit()
    return {"ok": True, "emailVerified": True, "email": user.email}
