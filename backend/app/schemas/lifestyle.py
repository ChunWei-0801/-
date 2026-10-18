"""Account-owned lifestyle inputs; no arbitrary routes, identifiers or null resets.

領域：個人生活設定
"""

from __future__ import annotations

import re
from datetime import date as DateValue
from decimal import Decimal
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, field_validator, model_validator


ShortcutId = Literal[
    "quick-entry", "entry", "manual-entry", "exchange", "groups", "stats", "advice",
    "members", "profile", "memories", "settings", "appearance", "logout",
    "savings-game", "health", "smoking", "calculator",
]
JarShape = Literal["pig", "dinosaur", "heart", "photo"]
HabitId = Annotated[str, Field(min_length=1, max_length=80, pattern=r"^[a-z][a-z0-9-]*$")]
Money = Annotated[Decimal, Field(ge=0, le=Decimal("1000000000000"), max_digits=15, decimal_places=2, allow_inf_nan=False)]


def _calendar_date(value):
    """Accept a calendar date, never a timestamp or a partially parsed date."""
    if type(value) is DateValue:
        return value
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("請使用 YYYY-MM-DD 日期格式")
    try:
        return DateValue.fromisoformat(value)
    except ValueError:
        raise ValueError("請輸入有效日期") from None


CalendarDate = Annotated[DateValue, BeforeValidator(_calendar_date)]


class LifestyleSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ShortcutPreference(LifestyleSchema):
    id: ShortcutId
    visible: bool = Field(strict=True)


class CustomHabit(LifestyleSchema):
    id: str = Field(min_length=8, max_length=71, pattern=r"^custom-[a-z0-9][a-z0-9-]{0,63}$")
    name: str = Field(min_length=1, max_length=40)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("習慣名稱不能留白")
        return value


class PreferencesPatch(LifestyleSchema):
    birthDate: CalendarDate | None = None
    timezone: str | None = Field(None, min_length=1, max_length=80)
    smokingEnabled: bool | None = Field(None, strict=True)
    calculatorEnabled: bool | None = Field(None, strict=True)
    shortcuts: list[ShortcutPreference] | None = Field(None, max_length=17)
    customHabits: list[CustomHabit] | None = Field(None, max_length=100)
    hiddenHabitIds: list[HabitId] | None = Field(None, max_length=200)

    @model_validator(mode="before")
    @classmethod
    def only_birthday_can_be_null(cls, values):
        if isinstance(values, dict) and any(value is None and key != "birthDate" for key, value in values.items()):
            raise ValueError("只有生日可設為空值")
        return values

    @field_validator("timezone")
    @classmethod
    def known_timezone(cls, value):
        if value is not None:
            try:
                ZoneInfo(value)
            except (ValueError, ZoneInfoNotFoundError):
                raise ValueError("請選擇有效的時區") from None
        return value

    @field_validator("birthDate")
    @classmethod
    def reasonable_birthday(cls, value):
        if value is not None and value < DateValue(1900, 1, 1):
            raise ValueError("生日不得早於 1900-01-01")
        return value

    @field_validator("shortcuts", "customHabits")
    @classmethod
    def unique_ids(cls, values):
        if values is not None and len({item.id for item in values}) != len(values):
            raise ValueError("項目 ID 不可重複")
        return values

    @field_validator("hiddenHabitIds")
    @classmethod
    def unique_habits(cls, values):
        if values is not None and len(set(values)) != len(values):
            raise ValueError("習慣 ID 不可重複")
        return values


class PreferencesOut(LifestyleSchema):
    birthDate: CalendarDate | None = None
    timezone: str = "Asia/Taipei"
    smokingEnabled: bool = False
    calculatorEnabled: bool = False
    shortcuts: list[ShortcutPreference] = Field(default_factory=list)
    customHabits: list[CustomHabit] = Field(default_factory=list)
    hiddenHabitIds: list[HabitId] = Field(default_factory=list)


class HealthEntryIn(LifestyleSchema):
    date: CalendarDate | None = None
    heightCm: Decimal = Field(gt=0, le=300, max_digits=5, decimal_places=2, allow_inf_nan=False)
    weightKg: Decimal = Field(gt=0, le=1000, max_digits=6, decimal_places=2, allow_inf_nan=False)


class HealthEntryOut(LifestyleSchema):
    date: CalendarDate
    heightCm: float
    weightKg: float
    bmi: float


class SmokingSettingsIn(LifestyleSchema):
    monthlyLimit: int = Field(ge=0, le=1_000_000, strict=True)


class SmokingSettingsOut(SmokingSettingsIn):
    pass


class SmokingEntryIn(LifestyleSchema):
    date: CalendarDate | None = None
    boughtPacks: int = Field(ge=0, le=10_000, strict=True)
    smokedPacks: int = Field(ge=0, le=10_000, strict=True)


class SmokingEntryOut(LifestyleSchema):
    date: CalendarDate
    boughtPacks: int
    smokedPacks: int


class SavingsJarIn(LifestyleSchema):
    name: str = Field(default="我的存錢筒", min_length=1, max_length=60)
    targetAmount: Money = Decimal("0")
    savedAmount: Money = Decimal("0")
    shape: JarShape = "pig"

    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("存錢筒名稱不能留白")
        return value


class SavingsJarPatch(LifestyleSchema):
    name: str | None = Field(None, min_length=1, max_length=60)
    targetAmount: Money | None = None
    savedAmount: Money | None = None
    shape: JarShape | None = None

    @model_validator(mode="before")
    @classmethod
    def reject_null(cls, values):
        if isinstance(values, dict) and any(value is None for value in values.values()):
            raise ValueError("存錢筒欄位不可設為空值")
        return values

    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        if value is not None:
            value = value.strip()
            if not value:
                raise ValueError("存錢筒名稱不能留白")
        return value


class SavingsJarOut(SavingsJarIn):
    targetAmount: float = 0
    savedAmount: float = 0
    imageUrl: str | None = None
    progressPercent: float = 0


class JarImageIn(LifestyleSchema):
    image: str = Field(min_length=1, max_length=8_000_000)
