from datetime import datetime

from sqlalchemy import (
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
    is_admin: Mapped[bool] = mapped_column(default=False)
    active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


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

    run: Mapped[ReconRun] = relationship(back_populates="lines")
