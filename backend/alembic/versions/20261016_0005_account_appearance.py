"""Synchronised appearance, account language and private background photo."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("appearance", sa.JSON().with_variant(JSONB(), "postgresql"), nullable=True))
    op.add_column("users", sa.Column("language", sa.Text(), nullable=False, server_default="zh-TW"))
    op.add_column("users", sa.Column("appearance_photo_bytes", sa.LargeBinary(), nullable=True))
    op.add_column("users", sa.Column("appearance_photo_mime", sa.Text(), nullable=True))


def downgrade():
    for name in ("appearance_photo_mime", "appearance_photo_bytes", "language", "appearance"):
        op.drop_column("users", name)
