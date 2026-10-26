# 領域：數字
"""Personal monthly report settings and a separately authorized read-only export."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

report_bearer = HTTPBearer(auto_error=False, scheme_name="MonthlyReportGrant", description="本人月報唯讀授權，不接受登入 JWT")
from sqlalchemy.orm import Session

from app.guards import guard
from app.models import User
from app.schemas.report_subscription import ReportAuthorizeIn, ReportSettingsIn
from app.services import monthly_report
from app.toolkit import errors
from app.toolkit.db import get_db

router = APIRouter(prefix="/monthly-reports", tags=["個人免費月報"])
OWNER = "數字"


@router.get("/settings", summary="取得本人每月報表設定")
def get_report_settings(me: User = Depends(guard(platform_admin=False)), db: Session = Depends(get_db)):
    """取得本人每月報表設定

    需登入本人帳號；不接受指定其他使用者。
    輸入依已定義模型驗證；結果不含其他帳號私人資料。
    """
    return monthly_report.get_settings(db, me)


@router.put("/settings", summary="經確認後儲存本人月報寄送方式")
def save_report_settings(body: ReportSettingsIn, me: User = Depends(guard(platform_admin=False)), db: Session = Depends(get_db)):
    """經確認後儲存本人月報寄送方式

    需登入本人帳號；不接受指定其他使用者。
    輸入依已定義模型驗證；結果不含其他帳號私人資料。
    """
    return monthly_report.save_settings(db, me, body)


@router.post("/authorize", summary="建立可撤銷的本人月報唯讀授權")
def authorize_report(body: ReportAuthorizeIn, me: User = Depends(guard(platform_admin=False)), db: Session = Depends(get_db)):
    """建立可撤銷的本人月報唯讀授權

    需登入本人帳號；不接受指定其他使用者。
    輸入依已定義模型驗證；結果不含其他帳號私人資料。
    """
    return monthly_report.authorize(db, me, body)


@router.delete("/authorization", summary="停用每月報表並撤銷讀取授權")
def revoke_report(me: User = Depends(guard(platform_admin=False)), db: Session = Depends(get_db)):
    """停用每月報表並撤銷讀取授權

    需登入本人帳號；不接受指定其他使用者。
    輸入依已定義模型驗證；結果不含其他帳號私人資料。
    """
    return monthly_report.revoke(db, me)


@router.get("/export", summary="使用專用授權唯讀取得本人已結束月份報表")
def export_report(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(report_bearer), period: str = Query(pattern=r"^\d{4}-(?:0[1-9]|1[0-2])$"), db: Session = Depends(get_db)):
    # Login JWTs intentionally do not authenticate this endpoint. The grant
    # cannot read another user's rows or call a normal authenticated write API.
    """使用專用授權唯讀取得本人已結束月份報表

    專用唯讀 Bearer 授權，只能讀取授權本人已結束月份，不接受登入 JWT。
    輸入依已定義模型驗證；結果不含其他帳號私人資料。
    """
    user, subscription = monthly_report.export_owner(db, request)
    if set(request.query_params) - {"period"}:
        raise errors.unprocessable("月報匯出只接受 period 月份參數")
    result = monthly_report.build_export(db, user, subscription, period)
    return JSONResponse(result, headers={"Cache-Control": "private, no-store", "Pragma": "no-cache",
                                        "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff"})
