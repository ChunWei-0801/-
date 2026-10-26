# 領域：數字
"""Owner-only monthly report consent and revocable read-only export grant."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models._types import utcnow
from app.toolkit.db import Base


class ReportSubscription(Base):
    __tablename__ = "report_subscriptions"
    __table_args__ = (
        CheckConstraint("delivery IN ('email', 'drive', 'both')", name="ck_report_subscription_delivery"),
    )

    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    delivery: Mapped[str] = mapped_column(Text, nullable=False, default="email")
    folder_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_hash: Mapped[str | None] = mapped_column(Text, nullable=True, unique=True)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    authorized_email: Mapped[str | None] = mapped_column(Text, nullable=True)
    consented_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
