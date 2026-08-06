"""add ledger_stripe

Revision ID: a7e2c9f14d68
Revises: d4e9a1b2c3f7
Create Date: 2026-08-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7e2c9f14d68'
down_revision: Union[str, None] = 'd4e9a1b2c3f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'ledger_stripe',
        sa.Column('stripe_id', sa.String(length=60), nullable=False),
        sa.Column('type', sa.String(length=20), nullable=False, server_default=''),
        sa.Column('source', sa.String(length=60), nullable=False, server_default=''),
        sa.Column('amount', sa.Float(), nullable=False, server_default='0'),
        sa.Column('fee', sa.Float(), nullable=False, server_default='0'),
        sa.Column('net', sa.Float(), nullable=False, server_default='0'),
        sa.Column('created', sa.String(length=20), nullable=False, server_default=''),
        sa.Column('description', sa.String(length=300), nullable=False, server_default=''),
        sa.Column('transfer', sa.String(length=60), nullable=False, server_default=''),
        sa.Column('transfer_date', sa.String(length=20), nullable=False, server_default=''),
        sa.Column('fund', sa.String(length=120), nullable=False, server_default=''),
        sa.Column('donor', sa.String(length=160), nullable=False, server_default=''),
        sa.Column('synced_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('stripe_id'),
    )
    op.create_index('ix_ledger_stripe_created', 'ledger_stripe', ['created'])


def downgrade() -> None:
    op.drop_index('ix_ledger_stripe_created', table_name='ledger_stripe')
    op.drop_table('ledger_stripe')
