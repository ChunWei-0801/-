# 領域：記帳
"""Bounded, reviewed statement input; no bank credentials or arbitrary currencies."""
from __future__ import annotations
import re
from datetime import date
from typing import Annotated, Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

PaymentMethod = Literal['cash', 'credit_card', 'bank_transfer', 'jkopay', 'line_pay', 'easycard', 'other']
TaxId = Annotated[str, Field(pattern=r'^[0-9]{8}$', strict=True)]


class ImportSchema(BaseModel):
    model_config = ConfigDict(extra='forbid')


class BillingProfileIn(ImportSchema):
    buyerTaxId: TaxId | None = None
    companyName: str = Field(default='', max_length=80, strict=True)

    @field_validator('companyName')
    @classmethod
    def clean_name(cls, value):
        value = value.strip()
        if any(ord(ch) < 32 or ord(ch) == 127 for ch in value):
            raise ValueError('公司名稱不能包含控制字元')
        return value


class StatementItem(ImportSchema):
    rowIndex: int = Field(ge=0, le=100000, strict=True)
    date: str = Field(min_length=10, max_length=10, strict=True)
    amount: str = Field(min_length=1, max_length=15, pattern=r'^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$', strict=True)
    kind: Literal['expense', 'income']
    cat: str | None = Field(default=None, min_length=1, max_length=30, pattern=r'^[0-9]+$', strict=True)
    merchant: str = Field(default='', max_length=120, strict=True)
    note: str = Field(default='', max_length=500, strict=True)
    groupId: str | None = Field(default=None, min_length=1, max_length=30, pattern=r'^[0-9]+$', strict=True)
    externalId: str = Field(default='', max_length=160, strict=True)
    buyerTaxId: TaxId | None = None
    paymentMethod: PaymentMethod | None = None
    currency: Literal['TWD'] = 'TWD'
    allowPossibleDuplicate: bool = Field(default=False, strict=True)

    @field_validator('date')
    @classmethod
    def valid_date(cls, value):
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
            raise ValueError('日期要是 YYYY-MM-DD')
        try:
            parsed = date.fromisoformat(value)
        except ValueError:
            raise ValueError('日期不存在') from None
        if not 1900 <= parsed.year <= 9998:
            raise ValueError('日期超出可接受範圍')
        return value

    @field_validator('amount')
    @classmethod
    def positive_amount(cls, value):
        from decimal import Decimal
        if Decimal(value) <= 0:
            raise ValueError('金額必須大於零')
        return value

    @field_validator('cat', 'groupId')
    @classmethod
    def bounded_id(cls, value):
        if value is not None and not 1 <= int(value) <= 9223372036854775807:
            raise ValueError('識別碼超出可接受範圍')
        return value

    @field_validator('merchant', 'note', 'externalId')
    @classmethod
    def clean_text(cls, value):
        value = value.strip()
        if any(ord(ch) < 32 or ord(ch) == 127 for ch in value):
            raise ValueError('文字欄位不能包含控制字元')
        return value


class StatementPreviewIn(ImportSchema):
    provider: str = Field(min_length=1, max_length=60, strict=True)
    paymentMethod: PaymentMethod = 'other'
    statementId: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}$', strict=True)
    items: list[StatementItem] = Field(min_length=1, max_length=500)

    @field_validator('provider')
    @classmethod
    def clean_provider(cls, value):
        value = value.strip()
        if not value or any(ord(ch) < 32 or ord(ch) == 127 for ch in value):
            raise ValueError('請輸入付款來源名稱')
        return value

    @model_validator(mode='after')
    def distinct_rows(self):
        if len({row.rowIndex for row in self.items}) != len(self.items):
            raise ValueError('每筆來源列號必須不同')
        return self


class StatementConfirmIn(StatementPreviewIn):
    items: list[StatementItem] = Field(min_length=1, max_length=200)
    idempotencyKey: UUID
