from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class StatementCategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    category: str
    no: str
    name: str


class StatementCategoryCreate(BaseModel):
    category: str  # Budget | Expense | Income
    name: str


class StatementItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    statement_category_id: int
    no: str
    name: str


class StatementItemCreate(BaseModel):
    statement_category_id: int
    name: str


class ChartOfAccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    account_no: str
    statement_item_id: int
    category: str
    statement_category: str
    statement_category_no: str
    statement_item: str
    statement_item_no: str
    statement_detail: str
    statement_detail_no: str
    statement_description: str
    is_tax_deductible: str
    is_mandatory: str
    grouping: str
    is_youth_chaplain_share: str
    is_missions: str


class ChartOfAccountCreate(BaseModel):
    statement_item_id: int
    statement_detail: str = ""
    statement_description: str = ""  # blank -> auto-generated
    is_tax_deductible: str = ""
    is_mandatory: str = ""
    grouping: str = ""
    is_youth_chaplain_share: str = ""
    is_missions: str = ""


class ChartOfAccountUpdate(BaseModel):
    """Only descriptive fields are editable. The hierarchy names/numbers and
    account_no are immutable after creation, since rules and past
    reconciliation runs reference account_no by value."""

    statement_description: str | None = None
    is_tax_deductible: str | None = None
    is_mandatory: str | None = None
    grouping: str | None = None
    is_youth_chaplain_share: str | None = None
    is_missions: str | None = None


class AccountNoPreview(BaseModel):
    account_no: str
    statement_category_no: str
    statement_item_no: str
    statement_detail_no: str


class CategoryRuleBase(BaseModel):
    rule_type: str  # 'bank_keyword' | 'stripe_fund'
    pattern: str
    account_no: str
    description: str = ""
    priority: int = 100
    active: bool = True


class CategoryRuleCreate(CategoryRuleBase):
    pass


class CategoryRuleUpdate(BaseModel):
    rule_type: str | None = None
    pattern: str | None = None
    account_no: str | None = None
    description: str | None = None
    priority: int | None = None
    active: bool | None = None


class CategoryRuleOut(CategoryRuleBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime


class ReconLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source: str
    transaction_date: str
    posted_date: str
    description: str
    statement_description: str
    account_no: str
    category: str
    method: str
    amount: float
    reference: str
    bank_description: str
    matched: bool
    notes: str
    is_stripe_payout: bool


class ReconLineUpdate(BaseModel):
    # category/statement_description are NOT user-editable directly - they're
    # re-derived from the Chart of Accounts whenever account_no changes (see
    # routers/reconcile.py::update_line).
    account_no: str | None = None
    description: str | None = None
    method: str | None = None
    amount: float | None = None
    notes: str | None = None


class ReconRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    bank_filename: str
    stripe_filename: str
    bank_file_link: str
    stripe_file_link: str
    bank_line_count: int
    stripe_line_count: int
    matched_payout_count: int
    unmatched_stripe_bank_count: int
    notes: str
    raw_bank_income_total: float
    raw_bank_expense_total: float
    bank_totals_by_day: dict[str, float] = {}


class ReconRunDetail(ReconRunOut):
    lines: list[ReconLineOut] = []


class StripeFundCheckItem(BaseModel):
    fund: str
    has_rule: bool
    account_no: str


class StripeFundCheckOut(BaseModel):
    funds: list[StripeFundCheckItem]
    all_covered: bool


class DuplicateCheckOut(BaseModel):
    duplicate_line_ids: list[int]
    count: int


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    email: str | None
    is_admin: bool
    active: bool
    permissions: list[str]
    hide_donor_names: bool
    created_at: datetime


class UserCreate(BaseModel):
    username: str
    # At least one of password/email must be given - password for the
    # existing username/password flow, email for a Google-only account.
    # Both can be set on the same account. Admin status isn't set here - it's
    # granted afterward via the permissions endpoint, same as page access.
    password: str | None = None
    email: str | None = None
    permissions: list[str] = []


class UserPermissionsUpdate(BaseModel):
    permissions: list[str]
    is_admin: bool
    hide_donor_names: bool = False


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


class GoogleLoginRequest(BaseModel):
    id_token: str


class AppSettingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    key: str
    value: str


class AppSettingUpdate(BaseModel):
    value: str


class BankAccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    active: bool


class BankAccountCreate(BaseModel):
    name: str


class ReconciliationEntryOut(BaseModel):
    """Built by the router as a plain dict, not straight from the ORM row -
    the Chart-of-Accounts-derived fields (statement_description through
    is_missions) come from a live join on account_no, never stored."""

    id: int
    transaction_date: date | None
    posted_date: date | None
    reconciled: bool
    is_reimbursement: bool
    account_no: str
    description: str
    bank_account_id: int | None
    bank_account_name: str
    method: str
    amount: float
    check_invoice_name: str
    bank_description: str
    notes: str
    source_run_id: int | None
    split_parent_id: int | None
    receipt_file_id: str
    receipt_file_name: str
    receipt_web_view_link: str
    source_file_name: str
    source_file_link: str
    # Derived live from the linked Chart of Accounts row (blank if account_no
    # doesn't match any account, e.g. not yet categorized).
    statement_description: str
    category: str
    statement_category: str
    statement_item: str
    statement_detail: str
    grouping: str
    is_youth_chaplain_share: str
    is_missions: str


class ReconciliationEntryUpdate(BaseModel):
    transaction_date: date | None = None
    posted_date: date | None = None
    reconciled: bool | None = None
    is_reimbursement: bool | None = None
    account_no: str | None = None
    description: str | None = None
    bank_account_id: int | None = None
    method: str | None = None
    amount: float | None = None
    check_invoice_name: str | None = None
    bank_description: str | None = None
    notes: str | None = None
    receipt_file_id: str | None = None
    receipt_file_name: str | None = None
    receipt_web_view_link: str | None = None


class SplitLineIn(BaseModel):
    description: str = ""
    account_no: str = ""
    amount: float
    notes: str = ""
    check_invoice_name: str = ""


class SplitRequest(BaseModel):
    lines: list[SplitLineIn]


class SplitGroupOut(BaseModel):
    parent: ReconciliationEntryOut
    children: list[ReconciliationEntryOut]


class ReconciliationImportRequest(BaseModel):
    bank_account_id: int


class ReconciliationImportResult(BaseModel):
    imported: int
    skipped_duplicates: int


class AccrualEntryOut(BaseModel):
    """Same shape as ReconciliationEntryOut minus source_run_id (Accrual
    entries are always hand-entered, never imported)."""

    id: int
    transaction_date: date | None
    posted_date: date | None
    reconciled: bool
    is_reimbursement: bool
    account_no: str
    description: str
    bank_account_id: int | None
    bank_account_name: str
    method: str
    amount: float
    check_invoice_name: str
    bank_description: str
    notes: str
    split_parent_id: int | None
    receipt_file_id: str
    receipt_file_name: str
    receipt_web_view_link: str
    statement_description: str
    category: str
    statement_category: str
    statement_item: str
    statement_detail: str
    grouping: str
    is_youth_chaplain_share: str
    is_missions: str


class AccrualEntryCreate(BaseModel):
    transaction_date: date | None = None
    posted_date: date | None = None
    reconciled: bool = False
    is_reimbursement: bool = False
    account_no: str = ""
    description: str = ""
    bank_account_id: int | None = None
    method: str = ""
    amount: float = 0.0
    check_invoice_name: str = ""
    bank_description: str = ""
    notes: str = ""


class AccrualEntryUpdate(BaseModel):
    transaction_date: date | None = None
    posted_date: date | None = None
    reconciled: bool | None = None
    is_reimbursement: bool | None = None
    account_no: str | None = None
    description: str | None = None
    bank_account_id: int | None = None
    method: str | None = None
    amount: float | None = None
    check_invoice_name: str | None = None
    bank_description: str | None = None
    notes: str | None = None
    receipt_file_id: str | None = None
    receipt_file_name: str | None = None
    receipt_web_view_link: str | None = None


class AccrualSplitGroupOut(BaseModel):
    parent: AccrualEntryOut
    children: list[AccrualEntryOut]


class BudgetEntryOut(BaseModel):
    id: int
    transaction_date: date | None
    account_no: str
    description: str
    amount: float
    notes: str
    statement_description: str
    category: str
    statement_category: str
    statement_item: str
    statement_detail: str


class BudgetEntryCreate(BaseModel):
    transaction_date: date | None = None
    account_no: str = ""
    description: str = ""
    amount: float = 0.0
    notes: str = ""


class BudgetEntryUpdate(BaseModel):
    transaction_date: date | None = None
    account_no: str | None = None
    description: str | None = None
    amount: float | None = None
    notes: str | None = None


class BudgetCopyYearRequest(BaseModel):
    from_year: int
    to_year: int
    overwrite: bool = False


class RestrictedTransferEntryOut(BaseModel):
    id: int
    transaction_date: date | None
    from_account_no: str
    from_statement_description: str
    to_account_no: str
    to_statement_description: str
    amount: float
    description: str
    notes: str


class RestrictedTransferEntryCreate(BaseModel):
    transaction_date: date | None = None
    from_account_no: str = ""
    to_account_no: str = ""
    amount: float = 0.0
    description: str = ""
    notes: str = ""


class RestrictedTransferEntryUpdate(BaseModel):
    transaction_date: date | None = None
    from_account_no: str | None = None
    to_account_no: str | None = None
    amount: float | None = None
    description: str | None = None
    notes: str | None = None


class BudgetCopyYearResult(BaseModel):
    copied: int


class GeneralLedgerLineOut(BaseModel):
    """One row of the unioned General Ledger view - Reconciliation and
    Accrual entries plus Budget entries (rendered as a virtual line dated
    Jan 1 of their year) plus Restricted Net Assets transfers (each one
    synthesizing two lines, one per leg), all in the shape reports are
    built from."""

    source: str  # "reconciliation" | "accrual" | "budget" | "restricted_transfer"
    id: int
    transaction_date: date | None
    posted_date: date | None
    reconciled: bool
    description: str
    account_no: str
    statement_description: str
    category: str
    statement_category: str
    statement_item: str
    statement_detail: str
    grouping: str
    is_youth_chaplain_share: str
    is_missions: str
    bank_account_name: str
    bank_description: str
    method: str
    amount: float
    check_invoice_name: str
    notes: str
    is_reimbursement: bool
    source_file_name: str
    source_file_link: str


class IncomeStatementRowOut(BaseModel):
    """One line: either a Statement Item's Plan/Actuals/Variance, or a
    Statement Category subtotal / section total (label is then the category
    name or "Total")."""

    label: str
    plan: float
    actuals: float
    variance: float


class IncomeStatementGroupOut(BaseModel):
    """All Statement Items under one Statement Category, plus that
    category's subtotal row (e.g. "Vicar Related" with its Diocese
    Conferences / Salaries and Benefits / ... rows)."""

    statement_category: str
    rows: list[IncomeStatementRowOut]
    subtotal: IncomeStatementRowOut


class IncomeStatementOut(BaseModel):
    year: int
    income_groups: list[IncomeStatementGroupOut]
    income_total: IncomeStatementRowOut
    expense_groups: list[IncomeStatementGroupOut]
    expense_total: IncomeStatementRowOut


class BankAccountBalanceOut(BaseModel):
    bank_account_id: int
    name: str
    balance: float


class DashboardOut(BaseModel):
    year: int
    bank_accounts: list[BankAccountBalanceOut]
    income_ytd: float
    income_plan_ytd: float
    expense_ytd: float
    expense_plan_ytd: float
    last_entry_at: datetime | None


# --------------------------------------------------------------------------- #
# Pledge Campaigns
# --------------------------------------------------------------------------- #
class PledgeCampaignOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    fund_name: str
    goal_amount: float
    starting_balance: float
    is_active: bool


class PledgeCampaignCreate(BaseModel):
    name: str
    goal_amount: float = 0.0
    starting_balance: float = 0.0


class PledgeCampaignUpdate(BaseModel):
    name: str | None = None
    fund_name: str | None = None
    goal_amount: float | None = None
    starting_balance: float | None = None
    is_active: bool | None = None


class DonorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    donor_id: str
    donor_number: str
    first_name: str
    last_name: str
    email: str
    phone_number: str
    city: str
    state: str
    zip_code: str
    joint_giver_id: str
    joint_giver_first_name: str
    joint_giver_last_name: str
    first_donated: date | None
    donation_count: int
    total_given: float
    source_file_name: str
    source_file_link: str


class DonorGiftOut(BaseModel):
    """One gift for the Donors page's click-to-expand detail popup - every
    fund, not scoped to one campaign like CampaignDonation/DonationOut are,
    since this is the general donor list, not a campaign view."""

    id: int
    fund: str
    received_date: date | None
    amount: float
    net_amount: float
    method: str
    source_file_name: str
    source_file_link: str


class PledgeOut(BaseModel):
    id: int
    campaign_id: int
    submission_id: str
    first_name: str
    last_name: str
    email: str
    date_submitted: datetime | None
    initial_amount: float
    due_date: date | None
    monthly_amount: float
    contact_method: str
    donor_id: str | None
    match_source: str | None
    actual_amount: float
    source_file_name: str
    source_file_link: str


class PledgeMatchUpdate(BaseModel):
    donor_id: str | None = None  # explicit null clears the match


class FundSummary(BaseModel):
    name: str
    count: int
    total: float


class DonationImportSummary(BaseModel):
    donations_imported: int
    funds: list[FundSummary]


class PledgeImportSummary(BaseModel):
    pledges_imported: int
    pledges_matched: int
    pledges_unmatched: int
    new_pledges: list[PledgeOut]
    updated_pledges: list[PledgeOut]


class DonorImportSummary(BaseModel):
    donors_imported: int
    pledges_matched: int
    pledges_unmatched: int


class DonationOut(BaseModel):
    id: int
    donor_id: str | None
    # Resolved from the donor list (blank if unmatched, or redacted to ""
    # for a user with hide_donor_names set - same rule as PledgeOut).
    donor_first_name: str
    donor_last_name: str
    donor_email: str
    fund: str
    received_date: date | None
    amount: float
    net_amount: float
    method: str
    source_file_name: str
    source_file_link: str


class CampaignDetailRow(BaseModel):
    """One row of the combined Details tab: either a pledge (has_pledge
    True, with its due_date) or - for someone who gave to this fund but
    never submitted a pledge form - a synthesized row with pledged_amount
    0 and no due_date, so their giving still shows up somewhere. donor_id
    is None only for donations that never matched any donor record at all
    (grouped into one row so the numbers still reconcile to the dashboard
    total, even though there's no single person to attribute them to).

    When the matched donor has a joint_giver_id and that spouse has no
    pledge of their own in this campaign, actual_amount and the gift-history
    popup fold in the joint giver's donations too - a household where one
    spouse pledges and the other gives shouldn't show the pledge as
    "unreceived" just because the money came in under the spouse's own
    donor record."""

    key: str  # "pledge:<id>" or "donor:<donor_id-or-'none'>" - opaque, passed back to get_detail
    donor_id: str | None
    first_name: str
    last_name: str
    email: str
    pledged_amount: float
    actual_amount: float
    due_date: date | None
    has_pledge: bool
    joint_giver_id: str
    joint_giver_first_name: str
    joint_giver_last_name: str
    source_file_name: str
    source_file_link: str


class CampaignDetailOut(BaseModel):
    """Full detail for the Details tab's click-to-expand popup: the pledge
    (if this row has one) plus every individual gift (this fund only) from
    the matched donor - not just the aggregate totals already on
    CampaignDetailRow, since the popup shows a real date-by-date history.
    Gifts include the joint giver's donations too, under the same fold rule
    as CampaignDetailRow.actual_amount."""

    pledge: PledgeOut | None
    donor_id: str | None
    joint_giver_id: str
    joint_giver_first_name: str
    joint_giver_last_name: str
    first_name: str
    last_name: str
    email: str
    gifts: list[DonationOut]


class PledgeDashboardPoint(BaseModel):
    date: date
    # Cumulative totals as of this date - both exclude the campaign's
    # starting_balance on purpose (shown as its own KPI instead), so the
    # chart always reads as "since tracking began," not "since forever."
    running_pledged_total: float
    running_actual_total: float
    # This date's own contribution, not cumulative - a day can have either,
    # both, or (for a hover target with no gift) neither.
    pledged_amount: float
    actual_amount: float


class PledgeDashboardOut(BaseModel):
    campaign: PledgeCampaignOut
    total_pledged: float
    total_actual: float
    total_raised: float
    # Money already given by someone with no pledge on file (e.g. a $22,000
    # gift with no matching pledge) - counted toward the goal alongside
    # total_pledged, since money already in hand is at least as strong a
    # commitment as a pledge.
    unpledged_actual: float
    pledge_count: int
    donation_count: int
    goal_amount: float
    percent_of_goal: float
    timeline: list[PledgeDashboardPoint]
