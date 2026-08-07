"""widen ledger_plaid.description to text

Revision ID: e91a6c3f8b52
Revises: d4f8b2a91c3e
Create Date: 2026-08-07 03:55:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e91a6c3f8b52'
down_revision: Union[str, None] = 'd4f8b2a91c3e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # StringDataRightTruncation hit in production during the scheduled
    # Plaid sync - a real merchant description exceeded 300 chars. Widened
    # to Text, matching the precedent set by ledger_actual.bank_description
    # for other potentially-long free-text bank fields. See issue #114.
    op.alter_column(
        "ledger_plaid",
        "description",
        existing_type=sa.String(length=300),
        type_=sa.Text(),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "ledger_plaid",
        "description",
        existing_type=sa.Text(),
        type_=sa.String(length=300),
        existing_nullable=False,
    )
