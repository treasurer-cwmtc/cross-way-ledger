from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class ChartOfAccount(Base):
    __tablename__ = "chart_of_accounts"

    account_no: Mapped[str] = mapped_column(String(20), primary_key=True)
    category: Mapped[str] = mapped_column(String(50))
    statement_category: Mapped[str] = mapped_column(String(120), default="")
    statement_item: Mapped[str] = mapped_column(String(120), default="")
    statement_detail: Mapped[str] = mapped_column(String(120), default="")
    statement_description: Mapped[str] = mapped_column(String(300))
    is_tax_deductible: Mapped[str] = mapped_column(String(10), default="")
    is_mandatory: Mapped[str] = mapped_column(String(10), default="")


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
