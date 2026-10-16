"""國際參考匯率；Decimal 透過 JSON 字串保留計算精度。

領域：數字
"""

from __future__ import annotations

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ConversionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: Decimal = Field(ge=0, le=Decimal("1000000000000000"), max_digits=26, decimal_places=10)
    fromCurrency: str
    toCurrency: str

    @field_validator("amount", mode="before")
    @classmethod
    def reject_boolean(cls, value):
        if isinstance(value, bool):
            raise ValueError("金額必須是有效數字，不能是布林值")
        return value

    @field_validator("fromCurrency", "toCurrency")
    @classmethod
    def currency_code(cls, value: str) -> str:
        code = value.strip().upper()
        if len(code) != 3 or not code.isascii() or not code.isalpha():
            raise ValueError("幣別請使用 3 碼國際貨幣代碼，例如 USD、TWD")
        return code


class QuoteMetadata(BaseModel):
    provider: str
    sourceUrl: str
    updatedAt: str = Field(description="來源資料日期／時間；每日彙整來源僅提供 YYYY-MM-DD")
    updatePrecision: Literal["day", "second"]
    nextUpdateAt: str | None = None
    fetchedAt: str
    stale: bool
    warning: str | None = None


class RatesOut(QuoteMetadata):
    base: str
    rates: dict[str, Decimal]


class ConversionOut(QuoteMetadata):
    amount: Decimal
    fromCurrency: str
    toCurrency: str
    rate: Decimal = Field(description="1 單位來源幣別可換得多少目標幣別")
    convertedAmount: Decimal = Field(description="依目標貨幣小數位四捨五入；帳本仍以 TWD 記錄")
    decimalPlaces: int
