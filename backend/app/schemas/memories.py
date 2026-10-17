"""Validated, partial puzzle preferences. No client-supplied reward counters.

領域：照片與小天地
"""

from __future__ import annotations

from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator


class PuzzleSettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    wallName: str | None = Field(None, min_length=1, max_length=60)
    period: Literal["week", "month"] | None = None
    timezone: str | None = Field(None, max_length=80)
    pieceCount: Literal[9, 16, 25, 36, 64, 100] | None = None
    changesPerPeriod: int | None = Field(None, ge=1, le=31, strict=True)

    @field_validator("wallName")
    @classmethod
    def clean_name(cls, value):
        if value is not None:
            value = value.strip()
            if not value:
                raise ValueError("成就牆名稱不能留白")
        return value

    @field_validator("timezone")
    @classmethod
    def known_timezone(cls, value):
        if value is not None:
            try:
                ZoneInfo(value)
            except (ValueError, ZoneInfoNotFoundError):
                raise ValueError("請選擇有效的時區") from None
        return value
