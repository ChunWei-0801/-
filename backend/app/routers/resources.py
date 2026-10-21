"""Public government safety updates and referenced financial education.

領域：數字
"""
from typing import Literal

from fastapi import APIRouter

from app.services import public_resources

router = APIRouter(prefix="/resources", tags=["公開防詐與理財參考"])
OWNER = "數字"


@router.get("/anti-fraud", summary="同步政府防詐資訊")
def anti_fraud(refresh: bool = False):
    """同步政府防詐資訊

    公開唯讀資料，不接受網址或帳號資料。來源固定為警政署政府開放 CSV。
    預設每小時重新同步；手動更新最短間隔 60 秒，並顯示最後成功同步時間。
    來源不可用時明示 stale／unavailable，不捏造已同步或最新文章。
    """
    return public_resources.anti_fraud(refresh=refresh)


@router.get("/financial", summary="取得附來源的理財學習參考")
def financial(language: Literal["zh-TW", "zh-CN", "en", "ja", "ko", "es"] = "zh-TW"):
    """取得附來源的理財學習參考

    公開唯讀參考，提供書名、作者、出版社、網址及本站改寫的教育原則。
    不呼叫模型、不推薦特定投資商品，也不把編輯整理宣稱為即時書籍資料。
    """
    return public_resources.financial(language)
