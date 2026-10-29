"""領域：家庭。親子零用錢教學模擬，不產生銀行或正式帳務交易。"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.guards import guard
from app.models import User
from app.schemas.allowance_simulation import IssueAllowanceSimulation
from app.services import allowance_simulation
from app.toolkit.db import get_db

router = APIRouter(prefix="/allowance-simulation", tags=["親子零用錢模擬"])


@router.get("", summary="讀取本人參與的模擬零用錢紀錄")
def list_simulations(
    beforeId: int | None = Query(default=None, ge=1, le=9_223_372_036_854_775_807),
    me: User = Depends(guard(platform_admin=False)), db: Session = Depends(get_db),
):
    """讀取本人參與的模擬零用錢紀錄

    需要登入；只讀發放者／收款者本人的紀錄，每頁50筆。
    同家庭成員、其他監管者與平台管理員都不能讀取這裡的私人紀錄。
    不提供正式收支或銀行餘額。
    """
    return allowance_simulation.listing(db, me, beforeId)


@router.post("", status_code=201, summary="確認發放一筆模擬零用錢")
def issue_simulation(
    body: IssueAllowanceSimulation, me: User = Depends(guard(platform_admin=False)),
    db: Session = Depends(get_db),
):
    """確認發放一筆模擬零用錢

    需要登入；僅目前有效的監管者可發放給自己照看的成員。
    同一操作編號重送只回原紀錄，不影響正式收支、銀行或每月零用金設定。
    平台管理員不得代發；監管關係結束後不能建立新紀錄。
    """
    return allowance_simulation.issue(db, me, body)
