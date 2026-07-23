"""add restricted transfer entries

Revision ID: ab1cf6360162
Revises: 608a05551c8b
Create Date: 2026-07-22 19:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ab1cf6360162'
down_revision: Union[str, None] = '608a05551c8b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'restricted_transfer_entries',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('transaction_date', sa.Date(), nullable=True),
        sa.Column('from_account_no', sa.String(length=20), nullable=True),
        sa.Column('to_account_no', sa.String(length=20), nullable=True),
        sa.Column('amount', sa.Float(), nullable=False, server_default='0'),
        sa.Column('description', sa.String(length=300), nullable=False, server_default=''),
        sa.Column('notes', sa.String(length=300), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['from_account_no'], ['chart_of_accounts.account_no']),
        sa.ForeignKeyConstraint(['to_account_no'], ['chart_of_accounts.account_no']),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('restricted_transfer_entries')
