# 領域：數字
"""Monthly report opt-in; a verified owner email is the only recipient."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ReportSettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = Field(default=False, strict=True)
    delivery: Literal["email", "drive", "both"] = "email"
    folderId: str | None = Field(default=None, max_length=200, pattern=r"^[A-Za-z0-9_-]{10,200}$")
    recipientEmail: str = Field(default="", max_length=254)
    termsAccepted: bool = Field(default=False, strict=True)

    @field_validator("folderId", mode="before")
    @classmethod
    def empty_folder(cls, value):
        return None if value == "" else value

    @field_validator("recipientEmail")
    @classmethod
    def clean_recipient(cls, value):
        return value.strip()


class ReportAuthorizeIn(ReportSettingsIn):
    enabled: bool = Field(default=True, strict=True)
