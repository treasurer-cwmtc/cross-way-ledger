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
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from .database import Base


def _normalize_account_no(instance, key, value):
    """Shared by every `account_no` FK column below: "" (the frontend's
    "uncategorized" sentinel - see AccountPicker.tsx) can never be a real
    foreign key value, so treat it the same as not set. Fires on every
    assignment path (constructor kwargs, direct attribute set, bulk
    setattr loops), so nothing has to remember to do this at each call
    site - only the handful of read sites that surface account_no back to
    the API need to coerce None -> "" again, keeping the wire format
    unchanged."""
    return value or None


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
    # A restriction, not a grant - unlike `permissions`, this applies even to
    # admins. Redacts donor name/email on the Pledge Campaign pages (real
    # donor PII) for this user, while leaving every other page/action
    # (matching, importing, totals) untouched.
    hide_donor_names: Mapped[bool] = mapped_column(default=False)
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

    __tablename__ = "chartofaccounts_statement_categories"
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

    __tablename__ = "chartofaccounts_statement_items"
    __table_args__ = (
        UniqueConstraint("statement_category_id", "no", name="uq_statement_item_no"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    statement_category_id: Mapped[int] = mapped_column(
        ForeignKey("chartofaccounts_statement_categories.id")
    )
    no: Mapped[str] = mapped_column(String(2))
    name: Mapped[str] = mapped_column(String(120))

    # selectin: StatementItem -> StatementCategory is read on essentially
    # every ChartOfAccount access (see ChartOfAccount's derived properties
    # below) - eager-loading it here means every call site that already
    # queries ChartOfAccount gets it for free, with no per-query
    # selectinload(...) to remember.
    statement_category: Mapped[StatementCategory] = relationship(
        back_populates="items", lazy="selectin"
    )
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

    statement_category/statement_category_no/statement_item/statement_item_no
    are *not* stored here - they're derived live from `parent_item` below,
    the same live-lookup pattern every ledger table in this schema uses for
    its own Chart-of-Accounts-derived fields (see ReconciliationEntry) - so
    they can never drift out of sync with the Chart of Accounts. Cheap to
    do: StatementItem.statement_category is eager-loaded (lazy="selectin"),
    so reading these properties never triggers a query on top of whatever
    already loaded this row.
    """

    __tablename__ = "chartofaccounts"
    account_no: Mapped[str] = mapped_column(String(20), primary_key=True)
    statement_item_id: Mapped[int] = mapped_column(
        ForeignKey("chartofaccounts_statement_items.id")
    )
    category: Mapped[str] = mapped_column(String(50))  # Budget | Expense | Income
    statement_detail: Mapped[str] = mapped_column(String(120), default="")
    statement_detail_no: Mapped[str] = mapped_column(String(2), default="")
    statement_description: Mapped[str] = mapped_column(String(300))
    is_tax_deductible: Mapped[str] = mapped_column(String(10), default="")
    is_mandatory: Mapped[str] = mapped_column(String(10), default="")
    grouping: Mapped[str] = mapped_column(String(120), default="")
    is_youth_chaplain_share: Mapped[str] = mapped_column(String(10), default="")
    is_missions: Mapped[str] = mapped_column(String(10), default="")

    parent_item: Mapped[StatementItem] = relationship(
        back_populates="accounts", lazy="selectin"
    )

    @property
    def statement_item(self) -> str:
        return self.parent_item.name

    @property
    def statement_item_no(self) -> str:
        return self.parent_item.no

    @property
    def statement_category(self) -> str:
        return self.parent_item.statement_category.name

    @property
    def statement_category_no(self) -> str:
        return self.parent_item.statement_category.no


class CategoryRule(Base):
    """A user-editable categorization rule.

    rule_type:
      - 'bank_keyword': if a bank line Description contains `pattern`,
        assign `account_no` (the new "rules page" requirement).
      - 'stripe_fund': if a Stripe donation's fund name matches `pattern`,
        assign `account_no`.
    priority: lower number wins when multiple rules match.
    """

    __tablename__ = "upload_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rule_type: Mapped[str] = mapped_column(String(20), index=True)
    pattern: Mapped[str] = mapped_column(String(200))
    account_no: Mapped[str] = mapped_column(ForeignKey("chartofaccounts.account_no"))
    # Optional friendly "who/what" name to also stamp onto a matched bank
    # line's Description field (e.g. "Sams Club", "Direct Energy") - mirrors
    # the payee-name column on the treasurer's own upload-template
    # spreadsheet. Only applied for bank_keyword rules; harmless/unused on
    # stripe_fund rules, which already get a real donor name.
    description: Mapped[str] = mapped_column(String(200), default="")
    priority: Mapped[int] = mapped_column(Integer, default=100)
    active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class ReconRun(Base):
    __tablename__ = "upload_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    bank_filename: Mapped[str] = mapped_column(String(260), default="")
    stripe_filename: Mapped[str] = mapped_column(String(260), default="")
    # Google Drive webViewLink for the archived copy of each raw upload -
    # blank if the archive-to-Drive step failed or was skipped, which never
    # blocks the import itself (see uploadBankOrStripeFile/googleDrive.ts).
    bank_file_link: Mapped[str] = mapped_column(String(1000), default="")
    stripe_file_link: Mapped[str] = mapped_column(String(1000), default="")
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
    # Sum of the ORIGINAL bank-payout-placeholder amounts per posted_date,
    # captured once at merge-stripe time (keyed by posted_date string) - an
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

    __tablename__ = "upload_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("upload_runs.id"), index=True)

    source: Mapped[str] = mapped_column(String(20))  # 'stripe' | 'bank'
    transaction_date: Mapped[str] = mapped_column(String(20), default="")
    posted_date: Mapped[str] = mapped_column(String(20), default="")
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

    __tablename__ = "ledger_bank_accounts"

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

    __tablename__ = "ledger_actual"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    transaction_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    posted_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    reconciled: Mapped[bool] = mapped_column(Boolean, default=False)
    is_reimbursement: Mapped[bool] = mapped_column(Boolean, default=False)
    account_no: Mapped[str | None] = mapped_column(
        ForeignKey("chartofaccounts.account_no"), nullable=True, default=None
    )
    description: Mapped[str] = mapped_column(String(300), default="")
    bank_account_id: Mapped[int | None] = mapped_column(
        ForeignKey("ledger_bank_accounts.id"), nullable=True
    )
    method: Mapped[str] = mapped_column(String(40), default="")
    amount: Mapped[float] = mapped_column(Float, default=0.0)
    check_invoice_name: Mapped[str] = mapped_column(String(200), default="")
    bank_description: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[str] = mapped_column(String(300), default="")
    # 1500, not 300 - falls back to the full (unbounded Text) bank_description
    # when there's no check/invoice name, and some Chase ACH descriptor lines
    # run past 300 characters on their own (see build_dedup_key).
    dedup_key: Mapped[str] = mapped_column(String(1500), unique=True, index=True)
    source_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("upload_runs.id"), nullable=True
    )
    # The raw bank/Stripe upload file this line came from - carried down from
    # the ReconRun's own bank_filename/bank_file_link (or stripe_ equivalent,
    # per this line's own `source`) at import time, so any row can be traced
    # back to the exact Google Drive file it originated from for an audit.
    source_file_name: Mapped[str] = mapped_column(String(300), default="")
    source_file_link: Mapped[str] = mapped_column(String(1000), default="")
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
        ForeignKey("ledger_actual.id"), nullable=True
    )
    is_split: Mapped[bool] = mapped_column(Boolean, default=False)

    # A receipt attached via the Google Drive Picker. Only the file's
    # identity/link is stored - the actual file stays in the user's Drive
    # (picked with the drive.file scope, never copied into our own storage).
    receipt_file_id: Mapped[str] = mapped_column(String(200), default="")
    receipt_file_name: Mapped[str] = mapped_column(String(300), default="")
    receipt_web_view_link: Mapped[str] = mapped_column(Text, default="")

    bank_account: Mapped[BankAccount | None] = relationship()

    @validates("account_no")
    def _validate_account_no(self, key, value):
        return _normalize_account_no(self, key, value)


class AccrualEntry(Base):
    """One row of the Accrual ledger (the "Accrual" tab) - same shape as
    ReconciliationEntry (same Chart-of-Accounts-driven derived fields, same
    split/undo-split mechanics) but entirely hand-entered: there's no Upload
    run to import from, so no dedup_key/source_run_id. Typical use: recording
    an expense/reimbursement as incurred, before the actual payment clears
    the bank and shows up in Reconciliation.
    """

    __tablename__ = "ledger_accrual"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    transaction_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    posted_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    reconciled: Mapped[bool] = mapped_column(Boolean, default=False)
    is_reimbursement: Mapped[bool] = mapped_column(Boolean, default=False)
    account_no: Mapped[str | None] = mapped_column(
        ForeignKey("chartofaccounts.account_no"), nullable=True, default=None
    )
    description: Mapped[str] = mapped_column(String(300), default="")
    bank_account_id: Mapped[int | None] = mapped_column(
        ForeignKey("ledger_bank_accounts.id"), nullable=True
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
        ForeignKey("ledger_accrual.id"), nullable=True
    )
    is_split: Mapped[bool] = mapped_column(Boolean, default=False)

    # Same Google Drive receipt attachment as ReconciliationEntry.
    receipt_file_id: Mapped[str] = mapped_column(String(200), default="")
    receipt_file_name: Mapped[str] = mapped_column(String(300), default="")
    receipt_web_view_link: Mapped[str] = mapped_column(Text, default="")

    # Set when this accrual entry has been reconciled against a real bank
    # transaction (see routers/reconciliation.py's reconcile_with_accruals) -
    # an accrual is only ever meant to exist until the actual payment clears
    # the bank, so once that happens this row is hidden from the normal
    # Accrual list (same is_split==False filtering pattern, just gated on
    # this instead) rather than deleted outright - deleting it would lose
    # the audit trail of which real bank line it became, and would violate
    # reimbursement_lines.accrual_entry_id's FK for any entry still linked
    # to a Reimbursement (see delete_accrual_entries's docstring for that
    # exact failure mode).
    reconciled_to_actual_id: Mapped[int | None] = mapped_column(
        ForeignKey("ledger_actual.id"), nullable=True
    )

    bank_account: Mapped[BankAccount | None] = relationship()

    @validates("account_no")
    def _validate_account_no(self, key, value):
        return _normalize_account_no(self, key, value)


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

    __tablename__ = "ledger_budget"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    transaction_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    account_no: Mapped[str | None] = mapped_column(
        ForeignKey("chartofaccounts.account_no"), nullable=True, default=None
    )
    description: Mapped[str] = mapped_column(String(300), default="")
    amount: Mapped[float] = mapped_column(Float, default=0.0)
    notes: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    @validates("account_no")
    def _validate_account_no(self, key, value):
        return _normalize_account_no(self, key, value)


class RestrictedTransferEntry(Base):
    """One permanent reclassification between two Chart-of-Accounts lines -
    "Restricted Net Assets" tab. Unlike Accrual (a placeholder meant to
    eventually be cleared by a real bank transaction), a transfer *is* the
    permanent economic event: money already earmarked in a restricted fund
    is released into the account being funded (or vice versa, setting more
    money aside), with no bank transaction to ever match against. Stored as
    a single row with both legs (from_account_no, to_account_no) rather than
    two rows that only net out by convention - General Ledger synthesizes
    the two per-account lines from this one row at read time."""

    __tablename__ = "ledger_restrictednetassets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    transaction_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    from_account_no: Mapped[str | None] = mapped_column(
        ForeignKey("chartofaccounts.account_no"), nullable=True, default=None
    )
    to_account_no: Mapped[str | None] = mapped_column(
        ForeignKey("chartofaccounts.account_no"), nullable=True, default=None
    )
    amount: Mapped[float] = mapped_column(Float, default=0.0)
    description: Mapped[str] = mapped_column(String(300), default="")
    notes: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    @validates("from_account_no", "to_account_no")
    def _validate_account_no(self, key, value):
        return _normalize_account_no(self, key, value)


class PledgeCampaign(Base):
    """A fundraising pledge campaign (e.g. "Phase 2 Building Project").
    Reusable for future campaigns - nothing here is hardcoded to Phase 2.
    """

    __tablename__ = "campaign"

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

    __tablename__ = "campaign_donors"

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
    # The Drive copy of the donor-export CSV this row was last
    # imported/updated from - lets a treasurer trace any row back to the
    # actual file for audit, rather than just trusting the import happened.
    source_file_name: Mapped[str] = mapped_column(String(300), default="")
    source_file_link: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Pledge(Base):
    """One pledge form submission against a campaign. (campaign_id,
    submission_id) is unique so re-importing the same export doesn't
    duplicate rows. Matching to a Donor happens separately via
    PledgeDonorMatch, since a submission may not resolve to any donor yet.
    """

    __tablename__ = "campaign_pledge_submissions"
    __table_args__ = (
        UniqueConstraint("campaign_id", "submission_id", name="uq_pledge_submission"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("campaign.id"), index=True)
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
    # The Drive copy of the pledge-form export CSV this row was last
    # imported/updated from - see Donor.source_file_name.
    source_file_name: Mapped[str] = mapped_column(String(300), default="")
    source_file_link: Mapped[str] = mapped_column(Text, default="")

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

    __tablename__ = "campaign_pledge_matches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pledge_id: Mapped[int] = mapped_column(
        ForeignKey("campaign_pledge_submissions.id"), unique=True, index=True
    )
    donor_id: Mapped[str | None] = mapped_column(
        ForeignKey("campaign_donors.donor_id"), nullable=True
    )
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

    __tablename__ = "campaign_donations"

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
    # The Drive copy of the donations export CSV this row was imported
    # from - see Donor.source_file_name. Donations are never updated after
    # creation (only inserted, deduped by dedup_key), so this is set once.
    source_file_name: Mapped[str] = mapped_column(String(300), default="")
    source_file_link: Mapped[str] = mapped_column(Text, default="")


class PcoPerson(Base):
    """The Planning Center (PCO) People export, upserted by person_id (PCO's
    own stable ID) - mirrors Donor/import_donors_for_campaign's exact upsert
    shape. This is the login allowlist for the Reimbursements portal: a
    submitter's email must match a row here before they can even request a
    one-time login code. email is deliberately NOT unique - real households
    share a single email across multiple person rows (confirmed from a real
    export), so it's an index, not a key.
    """

    __tablename__ = "pco_people"

    person_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    email: Mapped[str] = mapped_column(String(255), default="", index=True)
    phone_number: Mapped[str] = mapped_column(String(40), default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ReimbursementAssignment(Base):
    """Which Chart-of-Accounts a given email is pre-authorized by the
    treasurer to submit reimbursements against - one row per (email,
    account_no). email is plain string, not a foreign key: PcoPerson.email
    isn't unique, so there's no single PcoPerson row to point at. Validated
    at write time instead (the assignment endpoint rejects an email with no
    matching PcoPerson row) rather than enforced by the schema.
    """

    __tablename__ = "reimbursement_user_relationship"
    __table_args__ = (
        UniqueConstraint("email", "account_no", name="uq_reimbursement_assignment"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), index=True)
    account_no: Mapped[str] = mapped_column(ForeignKey("chartofaccounts.account_no"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class ReimbursementOtpCode(Base):
    """A one-time login code emailed to a reimbursement submitter.
    code_hash reuses security.py's hash_password/verify_password (a login
    code is treated the same as a short-lived password). Single-use
    (consumed_at) and short-lived (expires_at, 10 minutes) - see
    routers/reimbursements.py for the request-otp/verify-otp flow and its
    rate limiting (max 5 requests per email per hour)."""

    __tablename__ = "reimbursement_otp_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), index=True)
    code_hash: Mapped[str] = mapped_column(String(255))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Reimbursement(Base):
    """One reimbursement request (the wizard's "submit" step creates exactly
    one of these, plus its ReimbursementLine children). `name` defaults to
    an auto-generated identifier (submitter email + the submission
    timestamp) but the submitter can overwrite it with anything they like
    while the request is Pending - still enforced unique.

    status is a plain string (pending | paid | rejected), matching the rest
    of this schema's convention of not using a DB enum type (see
    PledgeDonorMatch.match_source). There's no separate "approved" step -
    Paid *is* the approval (a treasurer who finds a problem just doesn't pay
    it, and Rejects instead). Pending is the only editable state for the
    submitter; both Paid and Rejected are terminal. See
    routers/reimbursements.py for the exact Accrual-linkage rules tied to
    each transition.
    """

    __tablename__ = "reimbursement"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    submitter_email: Mapped[str] = mapped_column(String(255), index=True)
    # Snapshotted at submission time from PcoPerson, so the request still
    # reads sensibly even if that person's PCO record later changes/is removed.
    submitter_name: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    total_amount: Mapped[float] = mapped_column(Float, default=0.0)
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    lines: Mapped[list["ReimbursementLine"]] = relationship(
        back_populates="reimbursement", cascade="all, delete-orphan"
    )


class ReimbursementLine(Base):
    """One line item of a Reimbursement request - a Chart-of-Accounts
    account, a dollar amount, and (usually) a receipt. accrual_entry_id
    points at the AccrualEntry created for this line at submission time
    (is_reimbursement=True) - see routers/reimbursements.py for the
    create/edit/reject rules around that link.
    """

    __tablename__ = "reimbursement_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    reimbursement_id: Mapped[int] = mapped_column(
        ForeignKey("reimbursement.id"), index=True
    )
    account_no: Mapped[str | None] = mapped_column(
        ForeignKey("chartofaccounts.account_no"), nullable=True, default=None
    )
    amount: Mapped[float] = mapped_column(Float, default=0.0)
    description: Mapped[str] = mapped_column(String(300), default="")
    # The date the expense was actually incurred (set by the submitter),
    # not the submission date - flows into the linked AccrualEntry's own
    # transaction_date instead of defaulting to "today" at submission time.
    transaction_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Same Google Drive receipt attachment shape as AccrualEntry/
    # ReconciliationEntry - see services/google_drive.py for how these get
    # populated (a Shared Drive upload, not the browser-side Picker those
    # two use, since the submitter has no Google session to consent with).
    receipt_file_id: Mapped[str] = mapped_column(String(200), default="")
    receipt_file_name: Mapped[str] = mapped_column(String(300), default="")
    receipt_web_view_link: Mapped[str] = mapped_column(Text, default="")
    accrual_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("ledger_accrual.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    reimbursement: Mapped[Reimbursement] = relationship(back_populates="lines")

    @validates("account_no")
    def _validate_account_no(self, key, value):
        return _normalize_account_no(self, key, value)
