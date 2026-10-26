# 領域：記帳
"""Account-owned payment/import provenance and optional buyer billing identity."""
from __future__ import annotations
from datetime import datetime
from typing import Any
from sqlalchemy import BigInteger, DateTime, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.models._types import BigID, JSONType, utcnow
from app.toolkit.db import Base


class TransactionDetails(Base):
    __tablename__ = 'transaction_details'
    __table_args__ = (UniqueConstraint('user_id', 'fingerprint', name='uq_transaction_import_fingerprint'),)
    transaction_id: Mapped[int] = mapped_column(BigInteger, ForeignKey('transactions.id', ondelete='CASCADE'), primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    payment_method: Mapped[str | None] = mapped_column(Text, nullable=True)
    buyer_tax_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    provider: Mapped[str | None] = mapped_column(Text, nullable=True)
    external_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    fingerprint: Mapped[str | None] = mapped_column(Text, nullable=True)


class BillingProfile(Base):
    __tablename__ = 'billing_profiles'
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    buyer_tax_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    company_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class StatementImportBatch(Base):
    __tablename__ = 'statement_import_batches'
    __table_args__ = (UniqueConstraint('user_id', 'idempotency_key', name='uq_statement_import_batch'),)
    id: Mapped[int] = mapped_column(BigID, primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    idempotency_key: Mapped[str] = mapped_column(Text, nullable=False)
    payload_sha256: Mapped[str] = mapped_column(Text, nullable=False)
    result_json: Mapped[Any] = mapped_column(JSONType, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
