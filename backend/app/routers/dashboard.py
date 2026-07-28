from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import AccrualEntry, BankAccount, ReconciliationEntry, Reimbursement
from ..schemas import BankAccountBalanceOut, DashboardOut
from ..services.fiscal import get_current_year
from ..services.reporting import compute_income_statement

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"], dependencies=[Depends(get_current_user)])


@router.get("", response_model=DashboardOut)
def dashboard(db: Session = Depends(get_db)) -> DashboardOut:
    """Quick account overview for the Home tab: a running balance per bank
    account (all-time sum of Reconciliation amounts - Accrual entries are
    planned/incurred, not yet real bank money, so they're excluded from
    balances), Income/Expense YTD vs Budget (reusing the exact same
    aggregation as the Income Statement tab, so the two always agree), and
    the most recent entry timestamp across Reconciliation + Accrual as a
    simple staleness check ("when did anyone last enter something?")."""
    income_statement = compute_income_statement(db)

    balances: dict[int, float] = {}
    for e in db.scalars(select(ReconciliationEntry).where(ReconciliationEntry.is_split == False)):  # noqa: E712
        if e.bank_account_id is None:
            continue
        balances[e.bank_account_id] = balances.get(e.bank_account_id, 0.0) + e.amount
    bank_accounts = [
        BankAccountBalanceOut(bank_account_id=b.id, name=b.name, balance=round(balances.get(b.id, 0.0), 2))
        for b in db.scalars(select(BankAccount).where(BankAccount.active == True).order_by(BankAccount.name))  # noqa: E712
    ]

    last_entry_at = None
    for model in (ReconciliationEntry, AccrualEntry):
        latest = db.scalar(select(model.created_at).order_by(model.created_at.desc()).limit(1))
        if latest is not None and (last_entry_at is None or latest > last_entry_at):
            last_entry_at = latest

    outstanding = list(
        db.scalars(select(Reimbursement).where(Reimbursement.status.in_(["pending", "approved"])))
    )

    return DashboardOut(
        year=get_current_year(db),
        bank_accounts=bank_accounts,
        income_ytd=income_statement.income_total.actuals,
        income_plan_ytd=income_statement.income_total.plan,
        expense_ytd=income_statement.expense_total.actuals,
        expense_plan_ytd=income_statement.expense_total.plan,
        last_entry_at=last_entry_at,
        outstanding_reimbursements_count=len(outstanding),
        outstanding_reimbursements_total=round(sum(r.total_amount for r in outstanding), 2),
    )
