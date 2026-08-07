"""widen ledger_stripe.type

Revision ID: d4f8b2a91c3e
Revises: b8f31d0a5c72
Create Date: 2026-08-07 02:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4f8b2a91c3e'
down_revision: Union[str, None] = 'b8f31d0a5c72'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # StringDataRightTruncation hit in production during a 750-day backfill -
    # real Stripe balance-transaction type values (e.g.
    # "connect_collection_transfer", "issuing_authorization_hold") exceed 20
    # chars over a wide enough date range. See issue #107.
    op.alter_column(
        "ledger_stripe",
        "type",
        existing_type=sa.String(length=20),
        type_=sa.String(length=60),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "ledger_stripe",
        "type",
        existing_type=sa.String(length=60),
        type_=sa.String(length=20),
        existing_nullable=False,
    )
