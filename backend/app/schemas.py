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
    priority: int = 100
    active: bool = True


class CategoryRuleCreate(CategoryRuleBase):
    pass


class CategoryRuleUpdate(BaseModel):
    rule_type: str | None = None
    pattern: str | None = None
    account_no: str | None = None
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
    date_posted: str
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


class ReconRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    bank_filename: str
    stripe_filename: str
    bank_line_count: int
    stripe_line_count: int
    matched_payout_count: int
    unmatched_stripe_bank_count: int
    notes: str


class ReconRunDetail(ReconRunOut):
    lines: list[ReconLineOut] = []


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    is_admin: bool
    active: bool
    created_at: datetime


class UserCreate(BaseModel):
    username: str
    password: str
    is_admin: bool = False


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


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
    date_posted: date | None
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
    date_posted: date | None = None
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
    date_posted: date | None
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
    date_posted: date | None = None
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
    date_posted: date | None = None
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


class AccrualSplitGroupOut(BaseModel):
    parent: AccrualEntryOut
    children: list[AccrualEntryOut]
