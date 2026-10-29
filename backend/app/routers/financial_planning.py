"""Authorized planning previews and cited financial-education retrieval.

領域：數字
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.guards import guard
from app.models import User
from app.schemas.financial_planning import FinancialKnowledgeQuery, PlanningIn
from app.services import exchange, financial_knowledge, financial_planning
from app.toolkit.db import get_db

router = APIRouter(prefix="/financial-planning", tags=["家庭理財規劃與來源檢索"])
OWNER = "數字"


@router.post("/preview", summary="以授權帳務、參考匯率與知識來源試算儲蓄方案")
def preview_plan(body: PlanningIn, me: User = Depends(guard(platform_admin=False)), db: Session = Depends(get_db)):
    """以授權帳務、參考匯率與知識來源試算儲蓄方案

    僅限已登入且未停權的一般帳號；家庭範圍沿用現有監管及同家庭家長權限，
    加入共用活動不會取得其他成員完整財務資料。金額由程式唯讀試算，
    本路由不執行模型推論、不建立目標、不修改帳務，也不發送銀行轉帳。
    """
    try:
        return financial_planning.preview(db, me, body)
    except financial_planning.PlanningError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except exchange.RatesUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except exchange.UnsupportedCurrency as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/knowledge", summary="檢索有來源與日期的理財教育摘要")
def get_knowledge(query: Annotated[FinancialKnowledgeQuery, Query()], me: User = Depends(guard(platform_admin=False))):
    """檢索有來源與日期的理財教育摘要

    僅限已登入且未停權的一般帳號，以 BM25 唯讀搜尋版本化公開教育摘要。
    不查詢其他帳號的私人資料、不執行網頁即時搜尋或模型推論，
    也不接受或執行任何建立目標、修改帳務或轉帳的指令。
    """
    return financial_knowledge.search(query.q, query.limit)
