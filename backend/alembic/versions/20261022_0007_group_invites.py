"""Independent activity invitations: no change to historical ledger rows."""

from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade():
    identity = sa.BigInteger().with_variant(sa.Integer(), "sqlite")
    op.add_column("group_members", sa.Column("independent", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_table(
        "group_invites",
        sa.Column("id", identity, primary_key=True),
        sa.Column("group_id", sa.BigInteger(), sa.ForeignKey("groups.id"), nullable=False),
        sa.Column("inviter_id", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("invitee_id", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("code_hash", sa.Text(), nullable=True, unique=True),
        sa.Column("label", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('pending', 'accepted', 'declined', 'cancelled')", name="ck_group_invite_status"),
    )
    op.create_index("ix_group_invites_group_id", "group_invites", ["group_id"])
    op.create_index("ix_group_invites_invitee_id", "group_invites", ["invitee_id"])


def downgrade():
    op.drop_index("ix_group_invites_invitee_id", table_name="group_invites")
    op.drop_index("ix_group_invites_group_id", table_name="group_invites")
    op.drop_table("group_invites")
    op.drop_column("group_members", "independent")
