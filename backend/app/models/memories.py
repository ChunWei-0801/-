"""Private transaction photos and durable, transaction-backed puzzle memories.

領域：照片與小天地
"""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, LargeBinary, Text, UniqueConstraint, event
from sqlalchemy.orm import Mapped, mapped_column

from app.models._types import BigID, utcnow
from app.models.transaction import Transaction
from app.toolkit.db import Base


class TransactionPhoto(Base):
    __tablename__ = "transaction_photos"

    id: Mapped[int] = mapped_column(BigID, primary_key=True)
    transaction_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("transactions.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False, index=True)
    image_data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    image_mime: Mapped[str] = mapped_column(Text, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class PuzzleSettings(Base):
    __tablename__ = "puzzle_settings"

    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), primary_key=True)
    wall_name: Mapped[str] = mapped_column(Text, nullable=False, default="我的記帳回憶")
    period: Mapped[str] = mapped_column(Text, nullable=False, default="month")
    timezone: Mapped[str] = mapped_column(Text, nullable=False, default="UTC")
    piece_count: Mapped[int] = mapped_column(Integer, nullable=False, default=16)
    changes_per_period: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    wall_background_data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    wall_background_mime: Mapped[str | None] = mapped_column(Text, nullable=True)
    activated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class PuzzleGame(Base):
    __tablename__ = "puzzle_games"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False, index=True)
    piece_count: Mapped[int] = mapped_column(Integer, nullable=False)
    earned_pieces: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    image_data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    image_mime: Mapped[str] = mapped_column(Text, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    period: Mapped[str] = mapped_column(Text, nullable=False)
    period_key: Mapped[str] = mapped_column(Text, nullable=False)
    timezone: Mapped[str] = mapped_column(Text, nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PuzzleEarning(Base):
    __tablename__ = "puzzle_earnings"
    __table_args__ = (UniqueConstraint("transaction_id", name="uq_puzzle_earning_transaction"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False, index=True)
    transaction_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("transactions.id", ondelete="SET NULL"), nullable=True)
    fingerprint: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    game_id: Mapped[str | None] = mapped_column(Text, ForeignKey("puzzle_games.id"), nullable=True, index=True)
    earned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


@event.listens_for(Transaction, "after_insert")
def _award_confirmed_transaction(_mapper, connection, transaction):
    # Connection-level SQL joins the ledger's own database transaction. A failed
    # ledger save rolls back its reward too, including NLP multi-row confirms.
    from app.services.memories import award_transaction_piece
    award_transaction_piece(connection, transaction)


@event.listens_for(Transaction, "after_update")
def _keep_reward_fingerprint_current(_mapper, connection, transaction):
    from app.services.memories import update_transaction_fingerprint
    update_transaction_fingerprint(connection, transaction)
