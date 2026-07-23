"""rename date_posted to posted_date

Revision ID: f6f097478ba9
Revises: ab1cf6360162
Create Date: 2026-07-23 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'f6f097478ba9'
down_revision: Union[str, None] = 'ab1cf6360162'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('recon_lines', 'date_posted', new_column_name='posted_date')
    op.alter_column('reconciliation_entries', 'date_posted', new_column_name='posted_date')
    op.alter_column('accrual_entries', 'date_posted', new_column_name='posted_date')


def downgrade() -> None:
    op.alter_column('recon_lines', 'posted_date', new_column_name='date_posted')
    op.alter_column('reconciliation_entries', 'posted_date', new_column_name='date_posted')
    op.alter_column('accrual_entries', 'posted_date', new_column_name='date_posted')
