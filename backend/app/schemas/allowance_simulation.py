"""Bounded, owner-authorized inputs for an educational allowance simulation.

領域：家庭
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class IssueAllowanceSimulation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    wardId: str = Field(min_length=1, max_length=19, pattern=r"^[1-9][0-9]*$")
    amount: int = Field(ge=1, le=1_000_000)
    note: str = Field(default="", max_length=120)
    idempotencyKey: UUID

    @field_validator("wardId")
    @classmethod
    def bounded_id(cls, value: str) -> str:
        if int(value) > 9_223_372_036_854_775_807:
            raise ValueError("收款對象格式不正確")
        return value

    @field_validator("amount", mode="before")
    @classmethod
    def whole_amount(cls, value: Any) -> int:
        if isinstance(value, bool) or not isinstance(value, (int, float, str, Decimal)):
            raise ValueError("模擬零用錢請填入整元金額")
        if isinstance(value, str) and len(value) > 30:
            raise ValueError("金額超出範圍")
        try:
            amount = Decimal(str(value))
        except InvalidOperation:
            raise ValueError("金額格式不正確") from None
        if not amount.is_finite() or not 1 <= amount <= 1_000_000 or amount != amount.to_integral_value():
            raise ValueError("模擬零用錢限1至1,000,000元，請填整元")
        return int(amount)

    @field_validator("note")
    @classmethod
    def clean_note(cls, value: str) -> str:
        if any(ord(char) < 32 and char not in "\n\t" for char in value):
            raise ValueError("備註包含無法顯示的字元")
        return value.strip()
