"""領域：認證。Private calendar events and reusable shift markers."""
from datetime import date, datetime
from typing import Any
from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.models._types import BigID, JSONType, utcnow
from app.toolkit.db import Base


class CalendarMarker(Base):
    __tablename__ = 'calendar_markers'
    __table_args__ = (UniqueConstraint('user_id','preset_key',name='uq_calendar_marker_preset'),)
    preset_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    id: Mapped[int] = mapped_column(BigID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey('users.id', ondelete='CASCADE'), index=True)
    name: Mapped[str] = mapped_column(Text)
    icon: Mapped[str] = mapped_column(Text)
    color: Mapped[str] = mapped_column(Text)


class CalendarEvent(Base):
    __tablename__ = 'calendar_events'
    __table_args__ = (UniqueConstraint('user_id', 'day', 'shift_slot', name='uq_calendar_day_shift'),)
    id: Mapped[int] = mapped_column(BigID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey('users.id', ondelete='CASCADE'), index=True)
    day: Mapped[date] = mapped_column(Date, index=True)
    title: Mapped[str] = mapped_column(Text)
    memo: Mapped[str] = mapped_column(Text, default='')
    clock_time: Mapped[str | None] = mapped_column(Text, nullable=True)
    shift_slot: Mapped[int | None] = mapped_column(Integer, nullable=True)
    marker: Mapped[Any | None] = mapped_column(JSONType, nullable=True)
    timezone: Mapped[str] = mapped_column(Text, default='Asia/Taipei')
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    reminder_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    remind_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
