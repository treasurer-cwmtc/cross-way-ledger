from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    # Set for accounts that can sign in with Google (crosswaymtc.org only,
    # verified server-side against the ID token's hd claim) - matched
    # against the token's email at login. None for password-only accounts.
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_admin: Mapped[bool] = mapped_column(default=False)
    active: Mapped[bool] = mapped_column(default=True)
    # Page keys the user is allowed to see/use (matches the frontend Tab
    # values, e.g. "accrual", "budget") - ignored entirely for admins, who
    # always have full access. "home" and "users" are never in this list:
    # Home is always visible, Users/Permissions management is admin-only.
    permissions: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class AppSetting(Base):
    """Tiny key/value store for app-wide settings the treasurer adjusts by
    hand (e.g. "prior_year_end_date", matching the legacy sheet's
    Configurations tab, which they update once a year at rollover rather
    than deriving from the server's real-world date)."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(String(300))


class StatementCategory(Base):
    """Top level of the Chart of Accounts hierarchy, scoped to a Type
    (Budget/Expense/Income). `no` auto-increments within that Type and is
    never reused, even if a category is later deleted."""

    __tablename__ = "statement_categories"
    __table_args__ = (UniqueConstraint("category", "no", name="uq_statement_category_no"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    category: Mapped[str] = mapped_column(String(20))  # Budget | Expense | Income
    no: Mapped[str] = mapped_column(String(2))
    name: Mapped[str] = mapped_column(String(120))

    items: Mapped[list["StatementItem"]] = relationship(
        back_populates="statement_category", cascade="all, delete-orphan"
    )


class StatementItem(Base):
    """Second level of the hierarchy. `no` auto-increments within its parent
    StatementCategory and is never reused."""

    __tablename__ = "statement_items"
    __table_args__ = (
        UniqueConstraint("statement_category_id", "no", name="uq_statement_item_no"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    statement_category_id: Mapped[int] = mapped_column(ForeignKey("statement_categories.id"))
    no: Mapped[str] = mapped_column(String(2))
    name: Mapped[str] = mapped_column(String(120))

    statement_category: Mapped[StatementCategory] = relationship(back_populates="items")
    accounts: Mapped[list["ChartOfAccount"]] = relationship(
        back_populates="parent_item", cascade="all, delete-orphan"
    )


class ChartOfAccount(Base):
    """The Detail level / leaf of the hierarchy - one row per account.
    account_no is derived, never hand-typed:
    <TypePrefix><StatementCategoryNo><StatementItemNo><StatementDetailNo>
    where TypePrefix is B/E/I for category Budget/Expense/Income.
    statement_detail_no auto-increments within its parent StatementItem (or
    is "00" when the detail name is left blank). See services/coa_numbering.py.

    category/statement_category/statement_item and their *_no codes are
    denormalized copies of the parent chain (kept in sync at creation time)
    so the reconciler/categorizer/rules UI can read a flat row without joins.
    """

    __tablename__ = "chart_of_accounts"
    account_no: Mapped[str] = mapped_column(String(20), primary_key=True)
    statement_item_id: Mapped[int] = mapped_column(ForeignKey("statement_items.id"))
    category: Mapped[str] = mapped_column(String(50))  # Budget | Expense | Income
    statement_category: Mapped[str] = mapped_column(String(120), default="")
    statement_category_no: Mapped[str] = mapped_column(String(2), default="")
    statement_item: Mapped[str] = mapped_column(String(120), default="")
    statement_item_no: Mapped[str] = mapped_column(String(2), default="")
    statement_detail: Mapped[str] = mapped_column(String(120), default="")
    statement_detail_no: Mapped[str] = mapped_column(String(2), default="")
    statement_description: Mapped[str] = mapped_column(String(300))
    is_tax_deductible: Mapped[str] = mapped_column(String(10), default="")
    is_mandatory: Mapped[str] = mapped_column(String(10), default="")
    grouping: Mapped[str] = mapped_column(String(120), default="")
    is_youth_chaplain_share: Mapped[str] = mapped_column(String(10), default="")
    is_missions: Mapped[str] = mapped_column(String(10), default="")

    parent_item: Mapped[StatementItem] = relationship(back_populates="accounts")


class CategoryRule(Base):
    """A user-editable categorization rule.

    rule_type:
      - 'bank_keyword': if a bank line Description contains `pattern`,
        assign `account_no` (the new "rules page" requirement).
      - 'stripe_fund': if a Stripe donation's fund name matches `pattern`,
        assign `account_no`.
    priority: lower number wins when multiple rules match.
    """

    __tablename__ = "category_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rule_type: Mapped[str] = mapped_column(String(20), index=True)
    pattern: Mapped[str] = mapped_column(String(200))
    account_no: Mapped[str] = mapped_column(String(20))
    priority: Mapped[int] = mapped_column(Integer, default=100)
    active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class ReconRun(Base):
    __tablename__ = "recon_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    bank_filename: Mapped[str] = mapped_column(String(260), default="")
    stripe_filename: Mapped[str] = mapped_column(String(260), default="")
    bank_line_count: Mapped[int] = mapped_column(Integer, default=0)
    stripe_line_count: Mapped[int] = mapped_column(Integer, default=0)
    matched_payout_count: Mapped[int] = mapped_column(Integer, default=0)
    unmatched_stripe_bank_count: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str] = mapped_column(Text, default="")
    # Sum of positive/negative amounts from the raw bank CSV at upload time -
    # a fixed reference point for the wizard's step-4 totals check, so it
    # doesn't need the original file re-uploaded or re-parsed later.
    raw_bank_income_total: Mapped[float] = mapped_column(Float, default=0.0)
    raw_bank_expense_total: Mapped[float] = mapped_column(Float, default=0.0)
    # Sum of the ORIGINAL bank-payout-placeholder amounts per date_posted,
    # captured once at merge-stripe time (keyed by date_posted string) - an
    # independent reference so the wizard's by-day check compares against
    # the bank's own number, not just re-summing the same lines it's
    # displaying. Diverges from the live Stripe total only if a line gets
    # edited afterward.
    bank_totals_by_day: Mapped[dict] = mapped_column(JSON, default=dict)

    lines: Mapped[list["ReconLine"]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )


class ReconLine(Base):
    """One output line of the reconciliation (a per-donation breakout line or a
    categorized non-Stripe bank line)."""

    __tablename__ = "recon_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("recon_runs.id"), index=True)

    source: Mapped[str] = mapped_column(String(20))  # 'stripe' | 'bank'
    transaction_date: Mapped[str] = mapped_column(String(20), default="")
    date_posted: Mapped[str] = mapped_column(String(20), default="")
    description: Mapped[str] = mapped_column(String(300), default="")  # donor / payee
    statement_description: Mapped[str] = mapped_column(String(300), default="")  # COA
    account_no: Mapped[str] = mapped_column(String(20), default="")
    category: Mapped[str] = mapped_column(String(50), default="")
    method: Mapped[str] = mapped_column(String(40), default="")
    amount: Mapped[float] = mapped_column(Float, default=0.0)
    reference: Mapped[str] = mapped_column(String(120), default="")  # txn id / check
    bank_description: Mapped[str] = mapped_column(Text, default="")  # original bank line
    matched: Mapped[bool] = mapped_column(default=True)
    notes: Mapped[str] = mapped_column(String(300), default="")
    # True for a bank-payout-looking line still awaiting the Stripe file
    # (wizard step 1, before merge-stripe runs) - a placeholder, not a real
    # categorized line yet.
    is_stripe_payout: Mapped[bool] = mapped_column(default=False)

    run: Mapped[ReconRun] = relationship(back_populates="lines")


class BankAccount(Base):
    """A named bank account (e.g. "Chase Operating"). Simple lookup list -
    picked once per Upload run and carried onto every ReconciliationEntry
    created from that run; editable per-row afterward."""

    __tablename__ = "bank_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class ReconciliationEntry(Base):
    """One row of the persistent Reconciliation ledger (the "Reconciliation"
    tab) - distinct from ReconLine, which is the ephemeral per-run output of
    the Upload tab. Entries are created by importing a completed Upload run
    (deduped via `dedup_key`) and are then freely hand-edited.

    account_no is the only source of truth for the account this entry is
    categorized to - Statement Description and the Chart-of-Accounts-derived
    columns (Category, Statement, Item, Item Detail, Grouping,
    IsYouthChaplainShare, IsMissions) are always looked up live from the
    linked ChartOfAccount row, never stored here, so they can't drift out of
    sync with the Chart of Accounts.
    """

    __tablename__ = "reconciliation_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    transaction_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    date_posted: Mapped[date | None] = mapped_column(Date, nullable=True)
    reconciled: Mapped[bool] = mapped_column(Boolean, default=False)
    is_reimbursement: Mapped[bool] = mapped_column(Boolean, default=False)
    account_no: Mapped[str] = mapped_column(String(20), default="")
    description: Mapped[str] = mapped_column(String(300), default="")
    bank_account_id: Mapped[int | None] = mapped_column(
        ForeignKey("bank_accounts.id"), nullable=True
    )
    method: Mapped[str] = mapped_column(String(40), default="")
    amount: Mapped[float] = mapped_column(Float, default=0.0)
    check_invoice_name: Mapped[str] = mapped_column(String(200), default="")
    bank_description: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[str] = mapped_column(String(300), default="")
    dedup_key: Mapped[str] = mapped_column(String(300), unique=True, index=True)
    source_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("recon_runs.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Splitting a single aggregated bank line (e.g. one lump "REMOTE ONLINE
    # DEPOSIT" covering several checks) into multiple entries: the original
    # row is kept (is_split=True) rather than deleted, so its dedup_key keeps
    # blocking a future re-import of the same statement from re-adding it as
    # a "new" duplicate. It's just hidden from the normal list; the visible,
    # editable rows are its children (split_parent_id -> this row's id).
    split_parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("reconciliation_entries.id"), nullable=True
    )
    is_split: Mapped[bool] = mapped_column(Boolean, default=False)

    # A receipt attached via the Google Drive Picker. Only the file's
    # identity/link is stored - the actual file stays in the user's Drive
    # (picked with the drive.file scope, never copied into our own storage).
    receipt_file_id: Mapped[str] = mapped_column(String(200), default="")
    receipt_file_name: Mapped[str] = mapped_column(String(300), default="")
    receipt_web_view_link: Mapped[str] = mapped_column(Text, default="")

    bank_account: Mapped[BankAccount | None] = relationship()


class AccrualEntry(Base):
    """One row of the Accrual ledger (the "Accrual" tab) - same shape as
    ReconciliationEntry (same Chart-of-Accounts-driven derived fields, same
    split/undo-split mechanics) but entirely hand-entered: there's no Upload
    run to import from, so no dedup_key/source_run_id. Typical use: recording
    an expense/reimbursement as incurred, before the actual payment clears
    the bank and shows up in Reconciliation.
    """

    __tablename__ = "accrual_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    transaction_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    date_posted: Mapped[date | None] = mapped_column(Date, nullable=True)
    reconciled: Mapped[bool] = mapped_column(Boolean, default=False)
    is_reimbursement: Mapped[bool] = mapped_column(Boolean, default=False)
    account_no: Mapped[str] = mapped_column(String(20), default="")
    description: Mapped[str] = mapped_column(String(300), default="")
    bank_account_id: Mapped[int | None] = mapped_column(
        ForeignKey("bank_accounts.id"), nullable=True
    )
    method: Mapped[str] = mapped_column(String(40), default="")
    amount: Mapped[float] = mapped_column(Float, default=0.0)
    check_invoice_name: Mapped[str] = mapped_column(String(200), default="")
    bank_description: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Same split/undo-split mechanics as ReconciliationEntry: splitting keeps
    # the original row (hidden via is_split) and creates children
    # (split_parent_id) rather than deleting anything.
    split_parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("accrual_entries.id"), nullable=True
    )
    is_split: Mapped[bool] = mapped_column(Boolean, default=False)

    # Same Google Drive receipt attachment as ReconciliationEntry.
    receipt_file_id: Mapped[str] = mapped_column(String(200), default="")
    receipt_file_name: Mapped[str] = mapped_column(String(300), default="")
    receipt_web_view_link: Mapped[str] = mapped_column(Text, default="")

    bank_account: Mapped[BankAccount | None] = relationship()


class BudgetEntry(Base):
    """One planned-amount line for a Budget-category (B-prefixed) account.
    The legacy sheet represents each of these as a pseudo-transaction dated
    Jan 1 of the year, posted to a parallel "Budget" account that shares its
    Statement Category/Item with the real Income/Expense account it plans
    for (see ChartOfAccount.category). A single account can have *more than
    one* budget line in the same year (e.g. "Salaries and Benefits" carries
    a separate "Salary" line and a "Health Insurance" line, both posted to
    the same account and summed together for reporting) - so this is a real
    ledger, shaped like AccrualEntry minus the fields that don't apply to a
    planning figure (bank account, method, reconciled, is_reimbursement,
    split). Always a plain positive amount (no debit/credit sign) - Income
    Statement reporting takes abs() of actual transaction amounts to match.
    `year` is filtered on `transaction_date`'s year, same as every other
    ledger in the app - no separate stored year column.
    """

    __tablename__ = "budget_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    transaction_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    account_no: Mapped[str] = mapped_column(String(20), default="")
    description: Mapped[str] = mapped_column(String(300), default="")
    amount: Mapped[float] = mapped_column(Float, default=0.0)
    notes: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class PledgeCampaign(Base):
    """A fundraising pledge campaign (e.g. "Phase 2 Building Project").
    Reusable for future campaigns - nothing here is hardcoded to Phase 2.
    """

    __tablename__ = "pledge_campaigns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    # Which Donation.fund value belongs to this campaign - chosen from the
    # funds actually present in the donations import (step 2 of the
    # wizard), never hand-typed. Blank until that step runs.
    fund_name: Mapped[str] = mapped_column(String(120), default="")
    goal_amount: Mapped[float] = mapped_column(Float, default=0.0)
    # What was already raised toward this fund before formal pledge
    # tracking began - entered once on the import wizard, not derived.
    starting_balance: Mapped[float] = mapped_column(Float, default=0.0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    pledges: Mapped[list["Pledge"]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan"
    )


class Donor(Base):
    """The persistent donor list from the Giving App (Planning Center),
    reusable for any reporting - not scoped to a single campaign. Imported/
    refreshed via the pledge campaign wizard, upserted by donor_id.
    """

    __tablename__ = "donors"

    donor_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    donor_number: Mapped[str] = mapped_column(String(40), default="")
    first_name: Mapped[str] = mapped_column(String(120), default="")
    last_name: Mapped[str] = mapped_column(String(120), default="")
    email: Mapped[str] = mapped_column(String(255), default="", index=True)
    phone_number: Mapped[str] = mapped_column(String(40), default="")
    city: Mapped[str] = mapped_column(String(120), default="")
    state: Mapped[str] = mapped_column(String(40), default="")
    zip_code: Mapped[str] = mapped_column(String(20), default="")
    joint_giver_id: Mapped[str] = mapped_column(String(40), default="")
    joint_giver_first_name: Mapped[str] = mapped_column(String(120), default="")
    joint_giver_last_name: Mapped[str] = mapped_column(String(120), default="")
    first_donated: Mapped[date | None] = mapped_column(Date, nullable=True)
    donation_count: Mapped[int] = mapped_column(Integer, default=0)
    total_given: Mapped[float] = mapped_column(Float, default=0.0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Pledge(Base):
    """One pledge form submission against a campaign. (campaign_id,
    submission_id) is unique so re-importing the same export doesn't
    duplicate rows. Matching to a Donor happens separately via
    PledgeDonorMatch, since a submission may not resolve to any donor yet.
    """

    __tablename__ = "pledges"
    __table_args__ = (
        UniqueConstraint("campaign_id", "submission_id", name="uq_pledge_submission"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("pledge_campaigns.id"), index=True)
    submission_id: Mapped[str] = mapped_column(String(60))
    first_name: Mapped[str] = mapped_column(String(120), default="")
    last_name: Mapped[str] = mapped_column(String(120), default="")
    email: Mapped[str] = mapped_column(String(255), default="")
    date_submitted: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    initial_amount: Mapped[float] = mapped_column(Float, default=0.0)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    monthly_amount: Mapped[float] = mapped_column(Float, default=0.0)
    contact_method: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    campaign: Mapped[PledgeCampaign] = relationship(back_populates="pledges")
    match: Mapped["PledgeDonorMatch | None"] = relationship(
        back_populates="pledge", uselist=False, cascade="all, delete-orphan"
    )


class PledgeDonorMatch(Base):
    """Links a Pledge to a Donor - the identity-resolution equivalent of
    CategoryRule, but one-to-one rather than pattern-to-many. Auto-matching
    (by email against Donor.email) runs on every import and fills this in
    when possible; once a match exists, re-running the matcher never
    overwrites it - only a treasurer's explicit manual re-link changes it.

    donor_id is nullable: most pledges start unmatched (no gift yet, so no
    Donor row exists for them), which is a normal, expected state, not an
    error - auto-matching picks it up automatically once that person does
    give and shows up in a future Donor import.
    """

    __tablename__ = "pledge_donor_matches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pledge_id: Mapped[int] = mapped_column(ForeignKey("pledges.id"), unique=True, index=True)
    donor_id: Mapped[str | None] = mapped_column(ForeignKey("donors.donor_id"), nullable=True)
    match_source: Mapped[str] = mapped_column(String(10), default="auto")  # auto | manual
    matched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    pledge: Mapped[Pledge] = relationship(back_populates="match")
    donor: Mapped[Donor | None] = relationship()


class Donation(Base):
    """The Giving App's donation export, imported in full - this is the
    source of truth, not scoped to any one campaign. A PledgeCampaign just
    declares which `fund` value it cares about (chosen from what's actually
    present here, via GET /api/donations/funds - never hand-typed) and
    reads/filters this table dynamically at request time, rather than
    donations being copied/filtered into a campaign at import time. This
    means uploading donations doesn't require picking a campaign first, and
    a fund's donations are immediately available to any campaign that later
    claims that fund.

    dedup_key (the Giving App's own transaction id) blocks re-importing the
    same donation twice, globally.
    """

    __tablename__ = "donations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    dedup_key: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    # Deliberately NOT a foreign key: this is the Giving App's own donor_id
    # for the row, and step 1 (donations) runs before step 3 (donors) in
    # the wizard - a real FK here would reject every donation on first-time
    # setup, since the referenced donor doesn't exist locally yet. Matched
    # up against the donors table by plain string equality at read time
    # instead (see routers/pledge_campaigns.py's _donation_totals_by_donor).
    donor_id: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    fund: Mapped[str] = mapped_column(String(120), default="", index=True)
    received_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    amount: Mapped[float] = mapped_column(Float, default=0.0)
    net_amount: Mapped[float] = mapped_column(Float, default=0.0)
    method: Mapped[str] = mapped_column(String(40), default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
