"""Add opt-in owner-only monthly report grants without changing ledger data."""
from alembic import op
import sqlalchemy as sa

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "report_subscriptions",
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("delivery", sa.Text(), nullable=False),
        sa.Column("folder_id", sa.Text(), nullable=True),
        sa.Column("token_hash", sa.Text(), nullable=True),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("authorized_email", sa.Text(), nullable=True),
        sa.Column("consented_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("delivery IN ('email', 'drive', 'both')", name="ck_report_subscription_delivery"),
        sa.UniqueConstraint("token_hash"),
    )


def downgrade():
    op.drop_table("report_subscriptions")
