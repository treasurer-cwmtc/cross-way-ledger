from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import (
    AccrualEntry,
    BankAccount,
    BudgetEntry,
    ChartOfAccount,
    ReconciliationEntry,
)
from ..schemas import GeneralLedgerLineOut

router = APIRouter(
    prefix="/api/general-ledger", tags=["general-ledger"], dependencies=[Depends(get_current_user)]
)


def _entry_to_line(
    entry: ReconciliationEntry | AccrualEntry,
    source: str,
    coa_by_no: dict[str, ChartOfAccount],
    bank_accounts_by_id: dict[int, BankAccount],
) -> GeneralLedgerLineOut:
    coa = coa_by_no.get(entry.account_no)
    bank_account = bank_accounts_by_id.get(entry.bank_account_id) if entry.bank_account_id else None
    return GeneralLedgerLineOut(
        source=source,
        id=entry.id,
        transaction_date=entry.transaction_date,
        date_posted=entry.date_posted,
        description=entry.description,
        account_no=entry.account_no,
        statement_description=coa.statement_description if coa else "",
        category=coa.category if coa else "",
        statement_category=coa.statement_category if coa else "",
        statement_item=coa.statement_item if coa else "",
        statement_detail=coa.statement_detail if coa else "",
        bank_account_name=bank_account.name if bank_account else "",
        method=entry.method,
        amount=entry.amount,
        check_invoice_name=entry.check_invoice_name,
        notes=entry.notes,
    )


def _budget_to_line(entry: BudgetEntry, coa_by_no: dict[str, ChartOfAccount]) -> GeneralLedgerLineOut:
    coa = coa_by_no.get(entry.account_no)
    return GeneralLedgerLineOut(
        source="budget",
        id=entry.id,
        transaction_date=entry.transaction_date,
        date_posted=entry.transaction_date,
        description=entry.description or "Budget",
        account_no=entry.account_no,
        statement_description=coa.statement_description if coa else "",
        category=coa.category if coa else "",
        statement_category=coa.statement_category if coa else "",
        statement_item=coa.statement_item if coa else "",
        statement_detail=coa.statement_detail if coa else "",
        bank_account_name="",
        method="",
        amount=entry.amount,
        check_invoice_name="",
        notes=entry.notes,
    )


@router.get("", response_model=list[GeneralLedgerLineOut])
def list_general_ledger(
    year: int | None = None, db: Session = Depends(get_db)
) -> list[GeneralLedgerLineOut]:
    """The union of Reconciliation + Accrual + Budget - the single source
    every financial report should read from, rather than each report
    re-deriving its own view of "all the transactions". Read-only: edit the
    underlying entry on its own tab (Reconciliation/Accrual/Budget)."""
    coa_by_no = {a.account_no: a for a in db.scalars(select(ChartOfAccount))}
    bank_accounts_by_id = {b.id: b for b in db.scalars(select(BankAccount))}

    lines: list[GeneralLedgerLineOut] = []
    for e in db.scalars(
        select(ReconciliationEntry).where(ReconciliationEntry.is_split == False)  # noqa: E712
    ):
        if year is not None and (e.transaction_date is None or e.transaction_date.year != year):
            continue
        lines.append(_entry_to_line(e, "reconciliation", coa_by_no, bank_accounts_by_id))

    for e in db.scalars(select(AccrualEntry).where(AccrualEntry.is_split == False)):  # noqa: E712
        if year is not None and (e.transaction_date is None or e.transaction_date.year != year):
            continue
        lines.append(_entry_to_line(e, "accrual", coa_by_no, bank_accounts_by_id))

    for e in db.scalars(select(BudgetEntry).where(BudgetEntry.amount != 0)):
        if year is not None and (e.transaction_date is None or e.transaction_date.year != year):
            continue
        lines.append(_budget_to_line(e, coa_by_no))

    lines.sort(key=lambda line: line.transaction_date or date.min, reverse=True)
    return lines
