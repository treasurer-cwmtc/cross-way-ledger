from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ChartOfAccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    account_no: str
    category: str
    statement_category: str
    statement_item: str
    statement_detail: str
    statement_description: str
    is_tax_deductible: str
    is_mandatory: str


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
