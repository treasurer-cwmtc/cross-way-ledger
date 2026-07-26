"""rename tables to standardized names, move reporting views to schema

Renames all 16 non-system tables to the standardized names approved for
production (see the table-rename proposal). Chart of Accounts, Rules, and
Campaigns went through a second round of naming after initial review:
`chartofaccounts` / `chartofaccounts_statement_categories` /
`chartofaccounts_statement_items` (was `chart_of_accounts` /
`statement_categories` / `statement_items`), `upload_rules` (was
`category_rules` - it's the Upload wizard's auto-categorization rules),
and `campaign` singular (was `pledge_campaigns`).

Of the 9 reporting views added in `2538ec950b08`, only
`vw_ledger_generalledger` earns its keep as an actual view - it's a genuine
UNION across 4 ledger tables with no single-table equivalent. The other 8
were pure single-table joins that added no value once their *underlying
tables* already carry clean, standardized names (querying `ledger_actual`
directly is identical to querying the old `ledger_actual` *view* used to
be) - so this migration drops them outright rather than carrying them
forward.

Renaming 5 of the tables to names that collided with those 8 doomed views
(`ledger_actual`, `ledger_accrual`, `ledger_budget`,
`ledger_restrictednetassets`, and the since-abandoned `ledger_chartofaccounts`)
would fail outright if the views weren't dropped first - Postgres won't let
a table and a view share one name. `vw_ledger_generalledger` has no such
collision, but is still moved into a dedicated `reporting` schema so a
future BI-facing view *can* reuse a table's name without this problem
recurring.

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

# Views created by 2538ec950b08 that add nothing over their now-cleanly-named
# underlying table, so they're dropped rather than carried forward.
VIEWS_TO_DROP = [
    "ledger_actual", "ledger_accrual", "ledger_budget",
    "ledger_restrictednetassets", "ledger_chartofaccounts",
    "campaign_pledges", "campaign_actual", "campaign_detail",
]

# The one view worth keeping - a genuine multi-table UNION, moved into its
# own schema so it can't collide with a same-named base table.
GENERAL_LEDGER_VIEW = "vw_ledger_generalledger"

# (old table name, new table name) - matches app/models.py exactly.
RENAMES = [
    ("statement_categories", "chartofaccounts_statement_categories"),
    ("statement_items", "chartofaccounts_statement_items"),
    ("chart_of_accounts", "chartofaccounts"),
    ("category_rules", "upload_rules"),
    ("bank_accounts", "ledger_bank_accounts"),
    ("reconciliation_entries", "ledger_actual"),
    ("accrual_entries", "ledger_accrual"),
    ("budget_entries", "ledger_budget"),
    ("restricted_transfer_entries", "ledger_restrictednetassets"),
    ("recon_runs", "upload_runs"),
    ("recon_lines", "upload_lines"),
    ("pledge_campaigns", "campaign"),
    ("donors", "campaign_donors"),
    ("pledges", "campaign_pledge_submissions"),
    ("pledge_donor_matches", "campaign_pledge_matches"),
    ("donations", "campaign_donations"),
]

REPORTING_ROLE = "ledger_reporting"


def upgrade() -> None:
    conn = op.get_bind()

    for view in VIEWS_TO_DROP:
        op.execute(f'DROP VIEW IF EXISTS "{view}"')

    op.execute("CREATE SCHEMA IF NOT EXISTS reporting")
    op.execute(f'ALTER VIEW "{GENERAL_LEDGER_VIEW}" SET SCHEMA reporting')

    for old_name, new_name in RENAMES:
        op.rename_table(old_name, new_name)

    role_exists = conn.execute(
        sa.text("SELECT 1 FROM pg_roles WHERE rolname = :role"), {"role": REPORTING_ROLE}
    ).fetchone()
    if role_exists:
        op.execute(f'GRANT USAGE ON SCHEMA reporting TO {REPORTING_ROLE}')
        op.execute(f'GRANT SELECT ON reporting."{GENERAL_LEDGER_VIEW}" TO {REPORTING_ROLE}')
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

    op.execute(f'ALTER VIEW reporting."{GENERAL_LEDGER_VIEW}" SET SCHEMA public')
    op.execute("DROP SCHEMA IF EXISTS reporting")

    # Recreate the 8 dropped views exactly as 2538ec950b08 originally defined
    # them, against the now-restored old table names.
    op.execute("""
        CREATE VIEW ledger_actual AS
        SELECT
          r.id, r.transaction_date, r.posted_date, r.reconciled,
          r.is_reimbursement, r.description, r.account_no,
          c.statement_description, c.category, sc.name AS statement_category,
          si.name AS statement_item, c.statement_detail, c.grouping,
          c.is_youth_chaplain_share, c.is_missions,
          b.name AS bank_account_name, r.bank_description, r.method,
          r.amount, r.check_invoice_name, r.notes,
          r.source_file_name, r.source_file_link
        FROM reconciliation_entries r
        LEFT JOIN chart_of_accounts c ON c.account_no = r.account_no
        LEFT JOIN statement_items si ON si.id = c.statement_item_id
        LEFT JOIN statement_categories sc ON sc.id = si.statement_category_id
        LEFT JOIN bank_accounts b ON b.id = r.bank_account_id
        WHERE r.is_split = false
    """)

    op.execute("""
        CREATE VIEW ledger_accrual AS
        SELECT
          a.id, a.transaction_date, a.posted_date, a.reconciled,
          a.is_reimbursement, a.description, a.account_no,
          c.statement_description, c.category, sc.name AS statement_category,
          si.name AS statement_item, c.statement_detail, c.grouping,
          c.is_youth_chaplain_share, c.is_missions,
          b.name AS bank_account_name, a.bank_description, a.method,
          a.amount, a.check_invoice_name, a.notes
        FROM accrual_entries a
        LEFT JOIN chart_of_accounts c ON c.account_no = a.account_no
        LEFT JOIN statement_items si ON si.id = c.statement_item_id
        LEFT JOIN statement_categories sc ON sc.id = si.statement_category_id
        LEFT JOIN bank_accounts b ON b.id = a.bank_account_id
        WHERE a.is_split = false
    """)

    op.execute("""
        CREATE VIEW ledger_budget AS
        SELECT
          bg.id, bg.transaction_date, bg.account_no,
          c.statement_description, c.category, sc.name AS statement_category,
          si.name AS statement_item, c.statement_detail, c.grouping,
          c.is_youth_chaplain_share, c.is_missions,
          bg.description, bg.amount, bg.notes
        FROM budget_entries bg
        LEFT JOIN chart_of_accounts c ON c.account_no = bg.account_no
        LEFT JOIN statement_items si ON si.id = c.statement_item_id
        LEFT JOIN statement_categories sc ON sc.id = si.statement_category_id
        ORDER BY bg.transaction_date, bg.id
    """)

    op.execute("""
        CREATE VIEW ledger_restrictednetassets AS
        SELECT
          t.id, t.transaction_date, t.description, t.amount, t.notes,
          t.from_account_no,
          cf.statement_description AS from_statement_description,
          scf.name AS from_statement_category,
          sif.name AS from_statement_item,
          t.to_account_no,
          ct.statement_description AS to_statement_description,
          sct.name AS to_statement_category,
          sit.name AS to_statement_item
        FROM restricted_transfer_entries t
        LEFT JOIN chart_of_accounts cf ON cf.account_no = t.from_account_no
        LEFT JOIN statement_items sif ON sif.id = cf.statement_item_id
        LEFT JOIN statement_categories scf ON scf.id = sif.statement_category_id
        LEFT JOIN chart_of_accounts ct ON ct.account_no = t.to_account_no
        LEFT JOIN statement_items sit ON sit.id = ct.statement_item_id
        LEFT JOIN statement_categories sct ON sct.id = sit.statement_category_id
    """)

    op.execute("CREATE VIEW ledger_chartofaccounts AS SELECT * FROM chart_of_accounts")

    op.execute("""
        CREATE VIEW campaign_pledges AS
        SELECT
          p.id, p.campaign_id, pc.name AS campaign_name, p.submission_id,
          p.first_name, p.last_name, p.email, p.date_submitted,
          p.initial_amount, p.due_date, p.monthly_amount, p.contact_method,
          m.donor_id, m.match_source,
          d.first_name AS matched_donor_first_name,
          d.last_name AS matched_donor_last_name,
          d.joint_giver_id, d.joint_giver_first_name, d.joint_giver_last_name,
          p.source_file_name, p.source_file_link
        FROM pledges p
        JOIN pledge_campaigns pc ON pc.id = p.campaign_id
        LEFT JOIN pledge_donor_matches m ON m.pledge_id = p.id
        LEFT JOIN donors d ON d.donor_id = m.donor_id
    """)

    op.execute("""
        CREATE VIEW campaign_actual AS
        SELECT
          don.id, pc.id AS campaign_id, pc.name AS campaign_name,
          don.donor_id, d.first_name AS donor_first_name,
          d.last_name AS donor_last_name, d.email AS donor_email,
          don.fund, don.received_date, don.amount, don.net_amount,
          don.method, don.source_file_name, don.source_file_link
        FROM donations don
        JOIN pledge_campaigns pc ON pc.fund_name = don.fund
        LEFT JOIN donors d ON d.donor_id = don.donor_id
    """)

    op.execute("""
        CREATE VIEW campaign_detail AS
        WITH pledge_donor AS (
          SELECT p.id AS pledge_id, p.campaign_id, m.donor_id
          FROM pledges p
          LEFT JOIN pledge_donor_matches m ON m.pledge_id = p.id
        ),
        matched_donor_ids AS (
          SELECT DISTINCT campaign_id, donor_id
          FROM pledge_donor
          WHERE donor_id IS NOT NULL
        ),
        donation_totals AS (
          SELECT pc.id AS campaign_id, don.donor_id, SUM(don.net_amount) AS total
          FROM donations don
          JOIN pledge_campaigns pc ON pc.fund_name = don.fund
          GROUP BY pc.id, don.donor_id
        ),
        pledge_rows AS (
          SELECT
            'pledge:' || pd.pledge_id::text AS key,
            pd.campaign_id, pd.donor_id,
            p.first_name, p.last_name, p.email,
            p.initial_amount AS pledged_amount, p.due_date, true AS has_pledge,
            d.joint_giver_id, d.joint_giver_first_name, d.joint_giver_last_name,
            p.source_file_name, p.source_file_link,
            CASE
              WHEN COALESCE(d.joint_giver_id, '') <> '' AND NOT EXISTS (
                SELECT 1 FROM matched_donor_ids mdi
                WHERE mdi.campaign_id = pd.campaign_id AND mdi.donor_id = d.joint_giver_id
              ) THEN d.joint_giver_id
              ELSE NULL
            END AS folded_jg_id
          FROM pledge_donor pd
          JOIN pledges p ON p.id = pd.pledge_id
          LEFT JOIN donors d ON d.donor_id = pd.donor_id
        ),
        pledge_rows_with_actual AS (
          SELECT pr.*,
            ROUND((COALESCE(dt_own.total, 0) + COALESCE(dt_jg.total, 0))::numeric, 2) AS actual_amount
          FROM pledge_rows pr
          LEFT JOIN donation_totals dt_own
            ON dt_own.campaign_id = pr.campaign_id AND dt_own.donor_id = pr.donor_id
          LEFT JOIN donation_totals dt_jg
            ON dt_jg.campaign_id = pr.campaign_id AND dt_jg.donor_id = pr.folded_jg_id
        ),
        excluded_donor_ids AS (
          SELECT campaign_id, donor_id FROM matched_donor_ids
          UNION
          SELECT campaign_id, folded_jg_id AS donor_id
          FROM pledge_rows_with_actual WHERE folded_jg_id IS NOT NULL
        ),
        donor_only_rows AS (
          SELECT
            'donor:' || COALESCE(dt.donor_id, 'none') AS key,
            dt.campaign_id, dt.donor_id,
            d.first_name, d.last_name, d.email,
            0.0 AS pledged_amount, NULL::date AS due_date, false AS has_pledge,
            d.joint_giver_id, d.joint_giver_first_name, d.joint_giver_last_name,
            d.source_file_name, d.source_file_link,
            ROUND(dt.total::numeric, 2) AS actual_amount
          FROM donation_totals dt
          LEFT JOIN donors d ON d.donor_id = dt.donor_id
          WHERE dt.donor_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM excluded_donor_ids ex
            WHERE ex.campaign_id = dt.campaign_id AND ex.donor_id = dt.donor_id
          )
        )
        SELECT key, campaign_id, donor_id, first_name, last_name, email,
               pledged_amount, actual_amount, due_date, has_pledge,
               joint_giver_id, joint_giver_first_name, joint_giver_last_name,
               source_file_name, source_file_link
        FROM pledge_rows_with_actual
        UNION ALL
        SELECT key, campaign_id, donor_id, first_name, last_name, email,
               pledged_amount, actual_amount, due_date, has_pledge,
               joint_giver_id, joint_giver_first_name, joint_giver_last_name,
               source_file_name, source_file_link
        FROM donor_only_rows
    """)

    if role_exists:
        for view in VIEWS_TO_DROP:
            op.execute(f'GRANT SELECT ON "{view}" TO {REPORTING_ROLE}')
