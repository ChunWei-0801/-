"""記帳寫入的金額與信心度驗證；所有路由共用資料庫的精度界線。"""

from decimal import Decimal, InvalidOperation
from math import isfinite
from typing import Any

from app.toolkit import errors, money

MAX_AMOUNT = Decimal("999999999999.99")


def transaction_amount(value: Any) -> Decimal:
    """以分為單位四捨五入，拒絕零、非有限值及 NUMERIC(14, 2) 溢位。"""
    try:
        amount = money.to_decimal(value, allow_negative=False)
        if amount > MAX_AMOUNT:
            raise money.InvalidAmount("金額超過可儲存的上限")
        amount = money.quantize(amount)
        if amount <= 0:
            raise money.InvalidAmount("金額四捨五入到小數兩位後必須大於 0")
        return amount
    except (money.InvalidAmount, InvalidOperation) as exc:
        raise errors.unprocessable(str(exc) or "金額不是有效的數字") from None


def confidence(value: Any) -> float:
    """使用者提交的解析信心度必須是有限的 0～1 數字。"""
    try:
        score = float(value)
    except (TypeError, ValueError, OverflowError):
        raise errors.unprocessable("信心度必須是 0～1 的數字") from None
    if not isfinite(score) or not 0 <= score <= 1:
        raise errors.unprocessable("信心度必須是 0～1 的數字")
    return score
