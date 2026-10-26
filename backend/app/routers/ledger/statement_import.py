# 領域：記帳
"""Reviewed statement imports and private remembered billing details."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.guards import block_admin
from app.models import User
from app.models._types import utcnow
from app.models.transaction_details import BillingProfile
from app.schemas.statement_import import BillingProfileIn, StatementConfirmIn, StatementPreviewIn
from app.services.statement_import import billing_profile, confirm_import, preview_import
from app.toolkit.db import get_db

router = APIRouter(tags=['記帳'])
OWNER = '記帳'


@router.get('/billing/profile', summary='我的常用買方統編')
@block_admin
def get_billing_profile(me: User, db: Session = Depends(get_db)):
    """我的常用買方統編

    需登入本人帳號；不接受指定其他使用者。
    輸入依已定義模型驗證；結果不含其他帳號私人資料。
    """
    return billing_profile(db, me)


@router.put('/billing/profile', summary='儲存我的常用買方統編')
@block_admin
def put_billing_profile(body: BillingProfileIn, me: User, db: Session = Depends(get_db)):
    """儲存我的常用買方統編

    需登入本人帳號；不接受指定其他使用者。
    輸入依已定義模型驗證；結果不含其他帳號私人資料。
    """
    value = db.get(BillingProfile, me.id)
    if value is None:
        value = BillingProfile(user_id=me.id)
        db.add(value)
    value.buyer_tax_id = body.buyerTaxId
    value.company_name = body.companyName or None
    value.updated_at = utcnow()
    db.commit()
    return billing_profile(db, me)


@router.post('/statement-import/preview', summary='檢查匯入草稿及重複明細')
@block_admin
def preview_statement(body: StatementPreviewIn, me: User, db: Session = Depends(get_db)):
    """檢查匯入草稿及重複明細

    需登入本人帳號；不接受指定其他使用者。
    輸入依已定義模型驗證；結果不含其他帳號私人資料。
    """
    return preview_import(db, me, body)


@router.post('/statement-import/confirm', summary='確認匯入已核對明細')
@block_admin
def confirm_statement(body: StatementConfirmIn, me: User, db: Session = Depends(get_db)):
    """確認匯入已核對明細

    需登入本人帳號；不接受指定其他使用者。
    輸入依已定義模型驗證；結果不含其他帳號私人資料。
    """
    return confirm_import(db, me, body)
