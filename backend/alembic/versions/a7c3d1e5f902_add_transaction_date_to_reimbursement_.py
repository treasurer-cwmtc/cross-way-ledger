"""add transaction_date to reimbursement_lines

Revision ID: a7c3d1e5f902
Revises: c1d4e8f2a9b3
Create Date: 2026-07-29 03:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7c3d1e5f902'
down_revision: Union[str, None] = 'c1d4e8f2a9b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('reimbursement_lines', sa.Column('transaction_date', sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column('reimbursement_lines', 'transaction_date')
