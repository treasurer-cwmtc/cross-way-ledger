"""rename tables to standardized names, move reporting views to schema

Renames all 16 non-system tables to the standardized names approved for
production (see the table-rename proposal), matching what
`2538ec950b08_add_standardized_reporting_views.py` already used for view
names. Renaming five of the tables to those same exact identifiers
(`ledger_actual`, `ledger_accrual`, `ledger_budget`,
`ledger_restrictednetassets`, `ledger_chartofaccounts`) would collide with
the existing views of the same name in the `public` schema - Postgres
doesn't allow a table and a view to share one name - so this migration
first moves all 9 reporting views into a dedicated `reporting` schema
(`ALTER VIEW ... SET SCHEMA reporting`, which is purely a catalog move: the
view's compiled query still resolves to the same underlying table by OID,
so no view body needs rewriting), then renames the tables in `public`.

This also means BI tools (Looker Studio, Sheets) now query
`reporting.ledger_actual` etc. instead of `public.ledger_actual` - the
`ledger_reporting` role's `search_path` is set to prefer that schema so
unqualified queries still resolve there without a schema qualifier.

Revision ID: da928a58891d
Revises: 2538ec950b08
Create Date: 2026-07-26 09:40:52.939559

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'da928a58891d'
down_revision: Union[str, None] = '2538ec950b08'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

VIEWS = [
    "ledger_actual", "ledger_accrual", "ledger_budget",
    "ledger_restrictednetassets", "ledger_chartofaccounts",
    "vw_ledger_generalledger", "campaign_pledges", "campaign_actual",
    "campaign_detail",
]

# (old table name, new table name) - matches app/models.py exactly.
RENAMES = [
    ("statement_categories", "ledger_statement_categories"),
    ("statement_items", "ledger_statement_items"),
    ("chart_of_accounts", "ledger_chartofaccounts"),
    ("category_rules", "ledger_category_rules"),
    ("bank_accounts", "ledger_bank_accounts"),
    ("reconciliation_entries", "ledger_actual"),
    ("accrual_entries", "ledger_accrual"),
    ("budget_entries", "ledger_budget"),
    ("restricted_transfer_entries", "ledger_restrictednetassets"),
    ("recon_runs", "upload_runs"),
    ("recon_lines", "upload_lines"),
    ("pledge_campaigns", "campaigns"),
    ("donors", "campaign_donors"),
    ("pledges", "campaign_pledge_submissions"),
    ("pledge_donor_matches", "campaign_pledge_matches"),
    ("donations", "campaign_donations"),
]

REPORTING_ROLE = "ledger_reporting"


def upgrade() -> None:
    conn = op.get_bind()

    op.execute("CREATE SCHEMA IF NOT EXISTS reporting")

    for view in VIEWS:
        op.execute(f'ALTER VIEW "{view}" SET SCHEMA reporting')

    for old_name, new_name in RENAMES:
        op.rename_table(old_name, new_name)

    role_exists = conn.execute(
        sa.text("SELECT 1 FROM pg_roles WHERE rolname = :role"), {"role": REPORTING_ROLE}
    ).fetchone()
    if role_exists:
        op.execute(f'GRANT USAGE ON SCHEMA reporting TO {REPORTING_ROLE}')
        op.execute(f'ALTER ROLE {REPORTING_ROLE} SET search_path = reporting, public')


def downgrade() -> None:
    conn = op.get_bind()

    role_exists = conn.execute(
        sa.text("SELECT 1 FROM pg_roles WHERE rolname = :role"), {"role": REPORTING_ROLE}
    ).fetchone()
    if role_exists:
        op.execute(f'ALTER ROLE {REPORTING_ROLE} RESET search_path')
        op.execute(f'REVOKE USAGE ON SCHEMA reporting FROM {REPORTING_ROLE}')

    for old_name, new_name in RENAMES:
        op.rename_table(new_name, old_name)

    for view in VIEWS:
        op.execute(f'ALTER VIEW reporting."{view}" SET SCHEMA public')

    op.execute("DROP SCHEMA IF EXISTS reporting")
