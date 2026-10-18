"""Private daily lifestyle data, without changing existing account or ledger rows."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    identity = sa.BigInteger().with_variant(sa.Integer(), "sqlite")
    json_type = sa.JSON().with_variant(JSONB(), "postgresql")
    op.create_table(
        "lifestyle_preferences",
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("birth_date", sa.Date(), nullable=True),
        sa.Column("timezone", sa.Text(), nullable=False),
        sa.Column("smoking_enabled", sa.Boolean(), nullable=False),
        sa.Column("calculator_enabled", sa.Boolean(), nullable=False),
        sa.Column("shortcuts", json_type, nullable=False),
        sa.Column("custom_habits", json_type, nullable=False),
        sa.Column("hidden_habit_ids", json_type, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "health_entries",
        sa.Column("id", identity, primary_key=True),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entry_date", sa.Date(), nullable=False),
        sa.Column("height_cm", sa.Numeric(5, 2), nullable=False),
        sa.Column("weight_kg", sa.Numeric(6, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "entry_date", name="uq_health_entry_user_date"),
        sa.CheckConstraint("height_cm > 0 AND height_cm <= 300", name="ck_health_entry_height"),
        sa.CheckConstraint("weight_kg > 0 AND weight_kg <= 1000", name="ck_health_entry_weight"),
    )
    op.create_index("ix_health_entries_user_id", "health_entries", ["user_id"])
    op.create_table(
        "smoking_settings",
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("monthly_limit", sa.Integer(), nullable=False),
        sa.CheckConstraint("monthly_limit >= 0 AND monthly_limit <= 1000000", name="ck_smoking_settings_limit"),
    )
    op.create_table(
        "smoking_entries",
        sa.Column("id", identity, primary_key=True),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entry_date", sa.Date(), nullable=False),
        sa.Column("bought_packs", sa.Integer(), nullable=False),
        sa.Column("smoked_packs", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "entry_date", name="uq_smoking_entry_user_date"),
        sa.CheckConstraint("bought_packs >= 0 AND bought_packs <= 10000", name="ck_smoking_entry_bought"),
        sa.CheckConstraint("smoked_packs >= 0 AND smoked_packs <= 10000", name="ck_smoking_entry_smoked"),
    )
    op.create_index("ix_smoking_entries_user_id", "smoking_entries", ["user_id"])
    op.create_table(
        "savings_jars",
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("target_amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("saved_amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("shape", sa.Text(), nullable=False),
        sa.Column("photo_bytes", sa.LargeBinary(), nullable=True),
        sa.Column("photo_mime", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("target_amount >= 0 AND target_amount <= 1000000000000", name="ck_savings_jar_target"),
        sa.CheckConstraint("saved_amount >= 0 AND saved_amount <= 1000000000000", name="ck_savings_jar_saved"),
        sa.CheckConstraint("shape IN ('pig', 'dinosaur', 'heart', 'photo')", name="ck_savings_jar_shape"),
    )


def downgrade():
    op.drop_table("savings_jars")
    op.drop_table("smoking_entries")
    op.drop_table("smoking_settings")
    op.drop_table("health_entries")
    op.drop_table("lifestyle_preferences")
