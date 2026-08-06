"""add plaid bank sync tables

Revision ID: b8f31d0a5c72
Revises: a7e2c9f14d68
Create Date: 2026-08-06 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8f31d0a5c72'
down_revision: Union[str, None] = 'a7e2c9f14d68'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'ledger_plaid_items',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('item_id', sa.String(length=60), nullable=False),
        sa.Column('access_token', sa.String(length=120), nullable=False),
        sa.Column('institution_name', sa.String(length=120), nullable=False, server_default=''),
        sa.Column('cursor', sa.String(length=300), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('item_id', name='uq_ledger_plaid_items_item_id'),
    )
    op.create_index('ix_ledger_plaid_items_item_id', 'ledger_plaid_items', ['item_id'])

    op.create_table(
        'ledger_plaid',
        sa.Column('plaid_transaction_id', sa.String(length=60), nullable=False),
        sa.Column('item_id', sa.String(length=60), nullable=False),
        sa.Column('account_id', sa.String(length=60), nullable=False, server_default=''),
        sa.Column('details', sa.String(length=20), nullable=False, server_default=''),
        sa.Column('posting_date', sa.String(length=20), nullable=False, server_default=''),
        sa.Column('description', sa.String(length=300), nullable=False, server_default=''),
        sa.Column('amount', sa.Float(), nullable=False, server_default='0'),
        sa.Column('type', sa.String(length=60), nullable=False, server_default=''),
        sa.Column('pending', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('removed', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('synced_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['item_id'], ['ledger_plaid_items.item_id']),
        sa.PrimaryKeyConstraint('plaid_transaction_id'),
    )
    op.create_index('ix_ledger_plaid_item_id', 'ledger_plaid', ['item_id'])
    op.create_index('ix_ledger_plaid_posting_date', 'ledger_plaid', ['posting_date'])


def downgrade() -> None:
    op.drop_index('ix_ledger_plaid_posting_date', table_name='ledger_plaid')
    op.drop_index('ix_ledger_plaid_item_id', table_name='ledger_plaid')
    op.drop_table('ledger_plaid')
    op.drop_index('ix_ledger_plaid_items_item_id', table_name='ledger_plaid_items')
    op.drop_table('ledger_plaid_items')
