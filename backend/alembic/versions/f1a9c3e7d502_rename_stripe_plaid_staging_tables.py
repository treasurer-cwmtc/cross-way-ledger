"""rename ledger_stripe/ledger_plaid* staging tables to transactions_*

Follow-up to da928a58891d's table-rename pass: with the sidebar split into
a "Ledgers" group (the tables that actually hold the books) and a "Sync"
group (the automated Stripe/Plaid feeds + the reconciliation workflow that
turns them into ledger entries), the underlying table names should say the
same thing - these were never really "ledgers," they're staged transaction
data, so `ledger_` was misleading. Renamed to match the new `transactions_`
prefix, same op.rename_table pattern as the earlier full rename.

Revision ID: f1a9c3e7d502
Revises: c7e9a4f0d61b
Create Date: 2026-08-08 05:10:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'f1a9c3e7d502'
down_revision: Union[str, None] = 'c7e9a4f0d61b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (old table name, new table name) - matches app/models.py exactly.
RENAMES = [
    ("ledger_stripe", "transactions_stripe"),
    ("ledger_plaid_items", "transactions_bank_items"),
    ("ledger_plaid", "transactions_bank"),
]


def upgrade() -> None:
    for old_name, new_name in RENAMES:
        op.rename_table(old_name, new_name)


def downgrade() -> None:
    for old_name, new_name in reversed(RENAMES):
        op.rename_table(new_name, old_name)
