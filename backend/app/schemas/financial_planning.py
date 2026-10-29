"""Bounded, read-only family planning inputs; no model-authored writes.

領域：數字
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class PlanningIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    targetAmount: Decimal = Field(gt=0, le=Decimal("100000000"), max_digits=11, decimal_places=2)
    targetCurrency: Literal["TWD", "JPY", "USD", "EUR"] = "TWD"
    savedTwd: Decimal = Field(default=Decimal(0), ge=0, le=Decimal("100000000"), max_digits=9, decimal_places=0)
    deadline: date
    period: str | None = Field(default=None, pattern=r"^[0-9]{4}-[0-9]{2}$")
    scope: Literal["me", "family"] = "me"
    weeklyAllowanceTwd: Decimal = Field(default=Decimal(0), ge=0, le=Decimal("1000000"), max_digits=7, decimal_places=0)
    monthlyContributionTwd: Decimal | None = Field(default=None, ge=0, le=Decimal("100000000"), max_digits=9, decimal_places=0)
    question: str = Field(default="", max_length=500)

    @field_validator("targetAmount", "savedTwd", "weeklyAllowanceTwd", "monthlyContributionTwd", mode="before")
    @classmethod
    def bounded_decimal_input(cls, value):
        if isinstance(value, bool):
            raise ValueError("金額必須是有效數字，不能是布林值")
        if value is not None and len(str(value)) > 64:
            raise ValueError("金額輸入過長")
        return value

    @field_validator("deadline", mode="before")
    @classmethod
    def calendar_date_only(cls, value):
        if isinstance(value, str):
            if len(value) != 10:
                raise ValueError("截止日請使用 YYYY-MM-DD")
        elif not isinstance(value, date) or hasattr(value, "hour"):
            raise ValueError("截止日請使用 YYYY-MM-DD")
        return value

    @field_validator("period")
    @classmethod
    def real_month(cls, value):
        if value is not None and not (1900 <= int(value[:4]) <= 9998 and 1 <= int(value[5:]) <= 12):
            raise ValueError("月份請使用 YYYY-MM")
        return value

    @model_validator(mode="after")
    def currency_minor_units(self):
        if self.targetCurrency in ("TWD", "JPY") and self.targetAmount != self.targetAmount.to_integral_value():
            raise ValueError("台幣及日圓目標請輸入整元")
        return self


class FinancialKnowledgeQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    q: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=4, ge=1, le=8)

    @field_validator("q")
    @classmethod
    def nonblank(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("請輸入理財問題")
        return value
