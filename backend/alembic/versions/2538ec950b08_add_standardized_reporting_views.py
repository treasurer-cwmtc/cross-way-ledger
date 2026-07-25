"""add standardized reporting views

Read-only SQL views, one per app screen, named for external BI tools
(Looker Studio, Sheets) rather than the internal table names - so a
reporting user never needs to know reconciliation_entries is "Actual" or
that Budget excludes nothing while General Ledger excludes zero-amount
rows. Each mirrors exactly what its screen/router shows (same is_split
filtering, same joins, same Budget/GL semantics).

ledger_actual / ledger_accrual: Reconciliation/Accrual entries joined to
  Chart of Accounts + Bank Accounts, split-parent rows hidden (matches
  routers/reconciliation.py, routers/accrual.py).
ledger_budget: all Budget entries (no amount filter - that's GL-only),
  joined to Chart of Accounts (matches routers/budget.py).
ledger_restrictednetassets: one row per transfer, both legs' accounts
  joined for readability (matches routers/restricted_transfers.py).
ledger_chartofaccounts: plain alias for naming consistency.
vw_ledger_generalledger: the Reconciliation+Accrual+Budget+Transfer union
  (matches routers/general_ledger.py) - the one exception to "no amount
  filter" since GL itself excludes zero-amount Budget rows.
campaign_pledges: one row per pledge, joined to its matched donor.
campaign_actual: donations joined to the campaign whose fund_name they
  match, and to donor identity.
campaign_detail: reconstructs routers/pledge_campaigns.py's list_details -
  one row per pledge (actual_amount folding in a joint giver's donations
  when that spouse has no separate pledge of their own), plus a row for
  every donor who gave without pledging. This is genuinely intricate
  conditional logic translated from Python - spot-check a few rows against
  the app's own Details tab before trusting it for real reporting.

Revision ID: 2538ec950b08
Revises: f6f097478ba9
Create Date: 2026-07-25 12:21:31.433571

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2538ec950b08'
down_revision: Union[str, None] = 'f6f097478ba9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

VIEWS = ["ledger_actual", "ledger_accrual", "ledger_budget",
         "ledger_restrictednetassets", "ledger_chartofaccounts",
         "vw_ledger_generalledger", "campaign_pledges", "campaign_actual",
         "campaign_detail"]

# GRANT SELECT is a no-op (not an error) when ledger_reporting doesn't
# exist yet in this environment (e.g. a fresh local/CI database) - Postgres
# only errors granting on an unknown *table*, not an unknown *role*... but
# it does error on an unknown role, so this is guarded at apply time below.
GRANT_TO = "ledger_reporting"


def upgrade() -> None:
    conn = op.get_bind()

    # statement_category/statement_item are derived properties, not real
    # columns on chart_of_accounts (see ChartOfAccount in models.py) - every
    # view below joins through statement_items -> statement_categories to
    # reconstruct them, exactly like the ORM property does at read time.

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
        CREATE VIEW vw_ledger_generalledger AS
        SELECT
          'reconciliation' AS source, r.id, r.transaction_date, r.posted_date,
          r.reconciled, r.is_reimbursement, r.description, r.account_no,
          c.statement_description, c.category, sc.name AS statement_category,
          si.name AS statement_item, c.statement_detail, c.grouping,
          c.is_youth_chaplain_share, c.is_missions,
          b.name AS bank_account_name, r.bank_description, r.method, r.amount,
          r.check_invoice_name, r.notes, r.source_file_name, r.source_file_link
        FROM reconciliation_entries r
        LEFT JOIN chart_of_accounts c ON c.account_no = r.account_no
        LEFT JOIN statement_items si ON si.id = c.statement_item_id
        LEFT JOIN statement_categories sc ON sc.id = si.statement_category_id
        LEFT JOIN bank_accounts b ON b.id = r.bank_account_id
        WHERE r.is_split = false

        UNION ALL

        SELECT
          'accrual', a.id, a.transaction_date, a.posted_date,
          a.reconciled, a.is_reimbursement, a.description, a.account_no,
          c.statement_description, c.category, sc.name,
          si.name, c.statement_detail, c.grouping,
          c.is_youth_chaplain_share, c.is_missions,
          b.name, a.bank_description, a.method, a.amount,
          a.check_invoice_name, a.notes, '', ''
        FROM accrual_entries a
        LEFT JOIN chart_of_accounts c ON c.account_no = a.account_no
        LEFT JOIN statement_items si ON si.id = c.statement_item_id
        LEFT JOIN statement_categories sc ON sc.id = si.statement_category_id
        LEFT JOIN bank_accounts b ON b.id = a.bank_account_id
        WHERE a.is_split = false

        UNION ALL

        SELECT
          'budget', bg.id, bg.transaction_date, bg.transaction_date,
          false, false, COALESCE(NULLIF(bg.description, ''), 'Budget'), bg.account_no,
          c.statement_description, c.category, sc.name,
          si.name, c.statement_detail, c.grouping,
          c.is_youth_chaplain_share, c.is_missions,
          '', '', '', bg.amount, '', bg.notes, '', ''
        FROM budget_entries bg
        LEFT JOIN chart_of_accounts c ON c.account_no = bg.account_no
        LEFT JOIN statement_items si ON si.id = c.statement_item_id
        LEFT JOIN statement_categories sc ON sc.id = si.statement_category_id
        WHERE bg.amount != 0

        UNION ALL

        SELECT
          'restricted_transfer', -t.id, t.transaction_date, t.transaction_date,
          false, false, t.description, t.from_account_no,
          cf.statement_description, cf.category, scf.name,
          sif.name, cf.statement_detail, cf.grouping,
          cf.is_youth_chaplain_share, cf.is_missions,
          '', '', '', -t.amount, '', t.notes, '', ''
        FROM restricted_transfer_entries t
        LEFT JOIN chart_of_accounts cf ON cf.account_no = t.from_account_no
        LEFT JOIN statement_items sif ON sif.id = cf.statement_item_id
        LEFT JOIN statement_categories scf ON scf.id = sif.statement_category_id

        UNION ALL

        SELECT
          'restricted_transfer', t.id, t.transaction_date, t.transaction_date,
          false, false, t.description, t.to_account_no,
          ct.statement_description, ct.category, sct.name,
          sit.name, ct.statement_detail, ct.grouping,
          ct.is_youth_chaplain_share, ct.is_missions,
          '', '', '', t.amount, '', t.notes, '', ''
        FROM restricted_transfer_entries t
        LEFT JOIN chart_of_accounts ct ON ct.account_no = t.to_account_no
        LEFT JOIN statement_items sit ON sit.id = ct.statement_item_id
        LEFT JOIN statement_categories sct ON sct.id = sit.statement_category_id
    """)

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

    # Faithful (but intricate) reconstruction of pledge_campaigns.py's
    # list_details - see module docstring above for the reference and
    # the recommendation to spot-check against the live Details tab.
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

    # Grant SELECT to the read-only reporting role if it exists in this
    # environment (it won't in a fresh local/CI database) - role lookups
    # aren't schema-qualifiable, so check pg_roles rather than let GRANT
    # to an unknown role raise.
    role_exists = conn.execute(
        sa.text("SELECT 1 FROM pg_roles WHERE rolname = :role"), {"role": GRANT_TO}
    ).fetchone()
    if role_exists:
        for view in VIEWS:
            op.execute(f'GRANT SELECT ON "{view}" TO {GRANT_TO}')


def downgrade() -> None:
    for view in reversed(VIEWS):
        op.execute(f'DROP VIEW IF EXISTS "{view}"')
