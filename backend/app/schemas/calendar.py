"""領域：認證。私人行事曆輸入契約。"""
from datetime import date
from typing import Literal, Annotated
from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.schemas.lifestyle import CalendarDate


class CalendarSchema(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class MarkerIn(CalendarSchema):
    name: str = Field(min_length=1, max_length=30)
    icon: str = Field(min_length=1, max_length=16)
    color: str = Field(pattern=r'^#[0-9a-fA-F]{6}$')

    @field_validator('name', 'icon')
    @classmethod
    def clean(cls, value):
        if any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError('標記不可含控制字元')
        return value


class EventFields(CalendarSchema):
    time: str | None = Field(None, pattern=r'^(?:[01][0-9]|2[0-3]):[0-5][0-9]$')
    reminderMinutes: Literal[0, 5, 10, 15, 30, 60, 1440] | None = None
    memo: str = Field('', max_length=2000)

    @field_validator('reminderMinutes', mode='before')
    @classmethod
    def exact_minutes(cls, value):
        if value is not None and type(value) is not int:
            raise ValueError('提醒時間須為整數')
        return value


class EventIn(EventFields):
    date: CalendarDate
    title: str = Field(min_length=1, max_length=120)

    @field_validator('date')
    @classmethod
    def date_range(cls, value):
        if not date(1901, 1, 1) <= value <= date(2099, 12, 31):
            raise ValueError('日期範圍為1901至2099年')
        return value


class EventPatch(EventFields):
    date: CalendarDate | None = None

    @field_validator('date')
    @classmethod
    def valid_day(cls,value):
        if value is None or not date(1901,1,1)<=value<=date(2099,12,31):
            raise ValueError('請輸入1901至2099年的有效日期')
        return value

    title: str | None = Field(None, min_length=1, max_length=120)

    @field_validator('title')
    @classmethod
    def title_not_null(cls, value):
        if value is None:
            raise ValueError('事項名稱不能為空')
        return value


class ShiftIn(EventFields):
    markerKey: str = Field(pattern=r'^(early|mid|late|custom:[1-9][0-9]{0,18})$')


class AcknowledgeIn(CalendarSchema):
    ids: list[Annotated[int, Field(strict=True, gt=0)]] = Field(min_length=1, max_length=50)

    @field_validator('ids')
    @classmethod
    def identifiers(cls, value):
        if any(type(x) is not int or x <= 0 for x in value):
            raise ValueError('不支援的提醒項目')
        return list(dict.fromkeys(value))
