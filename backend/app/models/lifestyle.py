"""Private account preferences and durable daily health, smoking and savings data.

領域：個人生活設定
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, Integer, LargeBinary, Numeric, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models._types import BigID, JSONType, utcnow
from app.toolkit.db import Base


class LifestylePreferences(Base):
    __tablename__ = "lifestyle_preferences"

    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    # An old birth_year is deliberately not converted into an invented birthday.
    birth_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    timezone: Mapped[str] = mapped_column(Text, nullable=False, default="Asia/Taipei")
    smoking_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    calculator_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    shortcuts: Mapped[Any] = mapped_column(JSONType, nullable=False, default=list)
    custom_habits: Mapped[Any] = mapped_column(JSONType, nullable=False, default=list)
    hidden_habit_ids: Mapped[Any] = mapped_column(JSONType, nullable=False, default=list)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


class HealthEntry(Base):
    __tablename__ = "health_entries"
    __table_args__ = (
        UniqueConstraint("user_id", "entry_date", name="uq_health_entry_user_date"),
        CheckConstraint("height_cm > 0 AND height_cm <= 300", name="ck_health_entry_height"),
        CheckConstraint("weight_kg > 0 AND weight_kg <= 1000", name="ck_health_entry_weight"),
    )

    id: Mapped[int] = mapped_column(BigID, primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    entry_date: Mapped[date] = mapped_column(Date, nullable=False)
    height_cm: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    weight_kg: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


class SmokingSettings(Base):
    __tablename__ = "smoking_settings"
    __table_args__ = (CheckConstraint("monthly_limit >= 0 AND monthly_limit <= 1000000", name="ck_smoking_settings_limit"),)

    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    monthly_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class SmokingEntry(Base):
    __tablename__ = "smoking_entries"
    __table_args__ = (
        UniqueConstraint("user_id", "entry_date", name="uq_smoking_entry_user_date"),
        CheckConstraint("bought_packs >= 0 AND bought_packs <= 10000", name="ck_smoking_entry_bought"),
        CheckConstraint("smoked_packs >= 0 AND smoked_packs <= 10000", name="ck_smoking_entry_smoked"),
    )

    id: Mapped[int] = mapped_column(BigID, primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    entry_date: Mapped[date] = mapped_column(Date, nullable=False)
    bought_packs: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    smoked_packs: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


class SavingsJar(Base):
    __tablename__ = "savings_jars"
    __table_args__ = (
        CheckConstraint("target_amount >= 0 AND target_amount <= 1000000000000", name="ck_savings_jar_target"),
        CheckConstraint("saved_amount >= 0 AND saved_amount <= 1000000000000", name="ck_savings_jar_saved"),
        CheckConstraint("shape IN ('pig', 'dinosaur', 'heart', 'photo')", name="ck_savings_jar_shape"),
    )

    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False, default="我的存錢筒")
    target_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=Decimal("0"))
    saved_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=Decimal("0"))
    shape: Mapped[str] = mapped_column(Text, nullable=False, default="pig")
    # Image bytes share the private database's backup and restore lifecycle.
    photo_bytes: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    photo_mime: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)
