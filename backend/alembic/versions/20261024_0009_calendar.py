"""Add private calendar records and shift markers without altering existing data."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
revision='0009'
down_revision='0008'
branch_labels=None
depends_on=None


def upgrade():
    identity=sa.BigInteger().with_variant(sa.Integer(),'sqlite')
    op.create_table('calendar_markers',sa.Column('id',identity,primary_key=True),sa.Column('user_id',sa.BigInteger(),sa.ForeignKey('users.id',ondelete='CASCADE'),nullable=False),sa.Column('preset_key',sa.Text(),nullable=True),sa.Column('name',sa.Text(),nullable=False),sa.Column('icon',sa.Text(),nullable=False),sa.Column('color',sa.Text(),nullable=False),sa.UniqueConstraint('user_id','preset_key',name='uq_calendar_marker_preset'))
    op.create_index('ix_calendar_markers_user_id','calendar_markers',['user_id'])
    op.create_table('calendar_events',sa.Column('id',identity,primary_key=True),sa.Column('user_id',sa.BigInteger(),sa.ForeignKey('users.id',ondelete='CASCADE'),nullable=False),sa.Column('day',sa.Date(),nullable=False),sa.Column('title',sa.Text(),nullable=False),sa.Column('memo',sa.Text(),nullable=False),sa.Column('clock_time',sa.Text(),nullable=True),sa.Column('shift_slot',sa.Integer(),nullable=True),sa.Column('marker',sa.JSON().with_variant(postgresql.JSONB(),'postgresql'),nullable=True),sa.Column('timezone',sa.Text(),nullable=False),sa.Column('starts_at',sa.DateTime(timezone=True),nullable=False),sa.Column('reminder_minutes',sa.Integer(),nullable=True),sa.Column('remind_at',sa.DateTime(timezone=True),nullable=True),sa.Column('acknowledged_at',sa.DateTime(timezone=True),nullable=True),sa.Column('updated_at',sa.DateTime(timezone=True),nullable=False),sa.UniqueConstraint('user_id','day','shift_slot',name='uq_calendar_day_shift'))
    op.create_index('ix_calendar_events_user_id','calendar_events',['user_id'])
    op.create_index('ix_calendar_events_day','calendar_events',['day'])


def downgrade():
    op.drop_index('ix_calendar_events_day',table_name='calendar_events')
    op.drop_index('ix_calendar_events_user_id',table_name='calendar_events')
    op.drop_table('calendar_events')
    op.drop_index('ix_calendar_markers_user_id',table_name='calendar_markers')
    op.drop_table('calendar_markers')
