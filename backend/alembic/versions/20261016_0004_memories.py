"""Durable private receipt photos and transaction-backed puzzle achievements."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    identity = sa.BigInteger().with_variant(sa.Integer(), "sqlite")
    op.create_table(
        "transaction_photos",
        sa.Column("id", identity, primary_key=True),
        sa.Column("transaction_id", sa.BigInteger(), sa.ForeignKey("transactions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("image_data", sa.LargeBinary(), nullable=False), sa.Column("image_mime", sa.Text(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False), sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_transaction_photos_transaction_id", "transaction_photos", ["transaction_id"])
    op.create_index("ix_transaction_photos_user_id", "transaction_photos", ["user_id"])
    op.create_table(
        "puzzle_settings",
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("wall_name", sa.Text(), nullable=False), sa.Column("period", sa.Text(), nullable=False),
        sa.Column("timezone", sa.Text(), nullable=False), sa.Column("piece_count", sa.Integer(), nullable=False),
        sa.Column("changes_per_period", sa.Integer(), nullable=False),
        sa.Column("wall_background_data", sa.LargeBinary(), nullable=True),
        sa.Column("wall_background_mime", sa.Text(), nullable=True),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "puzzle_games",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("piece_count", sa.Integer(), nullable=False), sa.Column("earned_pieces", sa.Integer(), nullable=False),
        sa.Column("image_data", sa.LargeBinary(), nullable=False), sa.Column("image_mime", sa.Text(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False), sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("period", sa.Text(), nullable=False), sa.Column("period_key", sa.Text(), nullable=False),
        sa.Column("timezone", sa.Text(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False), sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_puzzle_games_user_id", "puzzle_games", ["user_id"])
    op.create_index("ix_puzzle_games_year", "puzzle_games", ["year"])
    op.create_table(
        "puzzle_earnings",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("transaction_id", sa.BigInteger(), sa.ForeignKey("transactions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("fingerprint", sa.Text(), nullable=False),
        sa.Column("game_id", sa.Text(), sa.ForeignKey("puzzle_games.id"), nullable=True),
        sa.Column("earned_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("transaction_id", name="uq_puzzle_earning_transaction"),
    )
    op.create_index("ix_puzzle_earnings_user_id", "puzzle_earnings", ["user_id"])
    op.create_index("ix_puzzle_earnings_fingerprint", "puzzle_earnings", ["fingerprint"])
    op.create_index("ix_puzzle_earnings_game_id", "puzzle_earnings", ["game_id"])


def downgrade():
    op.drop_table("puzzle_earnings")
    op.drop_table("puzzle_games")
    op.drop_table("puzzle_settings")
    op.drop_table("transaction_photos")
