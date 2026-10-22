"""Whitelisted, read-only report filters for the local operation assistant.

領域：數字
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ReportFilters(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=False)
    year: int = Field(ge=1900, le=9998)
    month: int | None = Field(default=None, ge=1, le=12)
    q: str = Field(default="", max_length=100)
    kind: Literal["expense", "income", "all"] = "expense"
    scope: Literal["me", "family"] = "me"

    @field_validator("q")
    @classmethod
    def clean_keyword(cls, value: str) -> str:
        value = value.strip()
        if any(ord(character) < 32 for character in value):
            raise ValueError("查詢文字不可包含控制字元")
        return value


class ReportQuery(ReportFilters):
    limit: int = Field(default=100, ge=1, le=200)
    offset: int = Field(default=0, ge=0, le=1000000)


class ReportExportQuery(ReportFilters):
    format: Literal["xlsx", "docx"]
