"""Additional savings jars without rewriting the existing jar or its photo."""
from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "additional_savings_jars",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("target_amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("saved_amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("shape", sa.Text(), nullable=False),
        sa.Column("photo_bytes", sa.LargeBinary(), nullable=True),
        sa.Column("photo_mime", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("target_amount >= 1 AND target_amount <= 1000000000000", name="ck_extra_jar_target"),
        sa.CheckConstraint("saved_amount >= 0 AND saved_amount <= 1000000000000", name="ck_extra_jar_saved"),
        sa.CheckConstraint("shape IN ('pig', 'dinosaur', 'heart', 'photo')", name="ck_extra_jar_shape"),
    )
    op.create_index("ix_additional_savings_jars_user_id", "additional_savings_jars", ["user_id"])


def downgrade():
    op.drop_index("ix_additional_savings_jars_user_id", table_name="additional_savings_jars")
    op.drop_table("additional_savings_jars")
