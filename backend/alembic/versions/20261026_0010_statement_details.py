"""Add optional payment metadata, remembered buyer identity and import idempotency."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
revision = '0010'
down_revision = '0009'
branch_labels = None
depends_on = None


def upgrade():
    identity = sa.BigInteger().with_variant(sa.Integer(), 'sqlite')
    op.create_table('transaction_details',
        sa.Column('transaction_id', sa.BigInteger(), sa.ForeignKey('transactions.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('user_id', sa.BigInteger(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('payment_method', sa.Text(), nullable=True), sa.Column('buyer_tax_id', sa.Text(), nullable=True),
        sa.Column('provider', sa.Text(), nullable=True), sa.Column('external_id', sa.Text(), nullable=True),
        sa.Column('fingerprint', sa.Text(), nullable=True),
        sa.UniqueConstraint('user_id', 'fingerprint', name='uq_transaction_import_fingerprint'))
    op.create_index('ix_transaction_details_user_id', 'transaction_details', ['user_id'])
    op.create_table('billing_profiles',
        sa.Column('user_id', sa.BigInteger(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('buyer_tax_id', sa.Text(), nullable=True), sa.Column('company_name', sa.Text(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False))
    op.create_table('statement_import_batches', sa.Column('id', identity, primary_key=True),
        sa.Column('user_id', sa.BigInteger(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('idempotency_key', sa.Text(), nullable=False), sa.Column('payload_sha256', sa.Text(), nullable=False),
        sa.Column('result_json', sa.JSON().with_variant(postgresql.JSONB(), 'postgresql'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('user_id', 'idempotency_key', name='uq_statement_import_batch'))
    op.create_index('ix_statement_import_batches_user_id', 'statement_import_batches', ['user_id'])


def downgrade():
    op.drop_index('ix_statement_import_batches_user_id', table_name='statement_import_batches')
    op.drop_table('statement_import_batches')
    op.drop_table('billing_profiles')
    op.drop_index('ix_transaction_details_user_id', table_name='transaction_details')
    op.drop_table('transaction_details')
