"""add reconciled_to_actual_id to ledger_accrual

Revision ID: d4e9a1b2c3f7
Revises: a7c3d1e5f902
Create Date: 2026-07-31 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd4e9a1b2c3f7'
down_revision: Union[str, None] = 'a7c3d1e5f902'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'ledger_accrual',
        sa.Column('reconciled_to_actual_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'ledger_accrual_reconciled_to_actual_id_fkey',
        'ledger_accrual',
        'ledger_actual',
        ['reconciled_to_actual_id'],
        ['id'],
    )


def downgrade() -> None:
    op.drop_constraint(
        'ledger_accrual_reconciled_to_actual_id_fkey', 'ledger_accrual', type_='foreignkey'
    )
    op.drop_column('ledger_accrual', 'reconciled_to_actual_id')
