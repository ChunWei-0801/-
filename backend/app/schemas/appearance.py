"""Validated account appearance preferences; images and arbitrary CSS never enter JSON.

領域：認證
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Language = Literal["zh-TW", "zh-CN", "en", "ja", "ko", "es"]


class AppearancePreferences(BaseModel):
    model_config = ConfigDict(extra="forbid")
    preset: Literal["dawn", "forest", "night", "custom"] = "dawn"
    fit: Literal["cover", "contain", "tile", "actual"] = "cover"
    x: float = Field(default=50, ge=0, le=100, allow_inf_nan=False)
    y: float = Field(default=50, ge=0, le=100, allow_inf_nan=False)
    brightness: float = Field(default=100, ge=30, le=150, allow_inf_nan=False)
    blur: float = Field(default=0, ge=0, le=16, allow_inf_nan=False)
    overlay: float = Field(default=25, ge=0, le=70, allow_inf_nan=False)


class AppearanceImageIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dataUrl: str = Field(min_length=1, max_length=8_000_000)
