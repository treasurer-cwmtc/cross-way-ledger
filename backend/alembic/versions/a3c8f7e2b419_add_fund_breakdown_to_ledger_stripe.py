"""add fund_breakdown_json to ledger_stripe

Revision ID: a3c8f7e2b419
Revises: e91a6c3f8b52
Create Date: 2026-08-07 18:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3c8f7e2b419'
down_revision: Union[str, None] = 'e91a6c3f8b52'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Stores the full itemized fund/amount breakdown (JSON list of [name,
    # dollars] pairs) for a donation split across multiple funds in one
    # checkout - empty for an ordinary single-fund donation. See issue #124:
    # a split gift's full amount was previously posted entirely to whichever
    # single fund happened to substring-match first, a real mis-posting risk.
    op.add_column(
        "ledger_stripe",
        sa.Column("fund_breakdown_json", sa.Text(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("ledger_stripe", "fund_breakdown_json")
