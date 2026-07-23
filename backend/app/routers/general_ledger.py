from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_permission
from ..models import (
    AccrualEntry,
    BankAccount,
    BudgetEntry,
    CategoryRule,
    ChartOfAccount,
    ReconciliationEntry,
    RestrictedTransferEntry,
)
from ..schemas import GeneralLedgerLineOut
from ..services.categorizer import Categorizer

router = APIRouter(
    prefix="/api/general-ledger",
    tags=["general-ledger"],
    dependencies=[Depends(require_permission("general-ledger"))],
)


def _entry_to_line(
    entry: ReconciliationEntry | AccrualEntry,
    source: str,
    coa_by_no: dict[str, ChartOfAccount],
    bank_accounts_by_id: dict[int, BankAccount],
    categorizer: Categorizer,
) -> GeneralLedgerLineOut:
    coa = coa_by_no.get(entry.account_no)
    bank_account = bank_accounts_by_id.get(entry.bank_account_id) if entry.bank_account_id else None
    # General Ledger is a pure union of Actual/Accrual/Budget - it must show
    # exactly what each entry's own tab shows, not a re-derived view. The
    # Actual tab resolves a blank Description via a live join to the
    # matching bank-keyword rule (see reconciliation.py's _to_out); mirror
    # that here for reconciliation-sourced rows only, since Accrual's own
    # tab never applies this fallback (hand-entered, no rule-driven import).
    description = entry.description
    if source == "reconciliation" and not description:
        description = categorizer.categorize_bank(entry.bank_description).description
    return GeneralLedgerLineOut(
        source=source,
        id=entry.id,
        transaction_date=entry.transaction_date,
        posted_date=entry.posted_date,
        reconciled=entry.reconciled,
        description=description,
        account_no=entry.account_no or "",
        statement_description=coa.statement_description if coa else "",
        category=coa.category if coa else "",
        statement_category=coa.statement_category if coa else "",
        statement_item=coa.statement_item if coa else "",
        statement_detail=coa.statement_detail if coa else "",
        grouping=coa.grouping if coa else "",
        is_youth_chaplain_share=coa.is_youth_chaplain_share if coa else "",
        is_missions=coa.is_missions if coa else "",
        bank_account_name=bank_account.name if bank_account else "",
        bank_description=entry.bank_description,
        method=entry.method,
        amount=entry.amount,
        check_invoice_name=entry.check_invoice_name,
        notes=entry.notes,
        is_reimbursement=entry.is_reimbursement,
        # Accrual entries never have these (hand-entered, no Upload run to
        # trace back to) - getattr rather than adding always-blank columns
        # to AccrualEntry just for schema parity.
        source_file_name=getattr(entry, "source_file_name", ""),
        source_file_link=getattr(entry, "source_file_link", ""),
    )


def _budget_to_line(entry: BudgetEntry, coa_by_no: dict[str, ChartOfAccount]) -> GeneralLedgerLineOut:
    coa = coa_by_no.get(entry.account_no)
    return GeneralLedgerLineOut(
        source="budget",
        id=entry.id,
        transaction_date=entry.transaction_date,
        posted_date=entry.transaction_date,
        reconciled=False,
        description=entry.description or "Budget",
        account_no=entry.account_no or "",
        statement_description=coa.statement_description if coa else "",
        category=coa.category if coa else "",
        statement_category=coa.statement_category if coa else "",
        statement_item=coa.statement_item if coa else "",
        statement_detail=coa.statement_detail if coa else "",
        grouping=coa.grouping if coa else "",
        is_youth_chaplain_share=coa.is_youth_chaplain_share if coa else "",
        is_missions=coa.is_missions if coa else "",
        bank_account_name="",
        bank_description="",
        method="",
        amount=entry.amount,
        check_invoice_name="",
        notes=entry.notes,
        is_reimbursement=False,
        source_file_name="",
        source_file_link="",
    )


def _transfer_to_lines(
    entry: RestrictedTransferEntry, coa_by_no: dict[str, ChartOfAccount]
) -> list[GeneralLedgerLineOut]:
    """A restricted-fund transfer is one permanent event with two legs - a
    decrease on the from-account, an increase on the to-account - so it
    synthesizes two General Ledger lines from the single stored row. The
    "from" leg carries a negated id (-entry.id) purely to give the two
    synthesized lines distinct React keys / table identities; clicking
    either always opens the same underlying transfer (see
    RestrictedNetAssets' onRowClick, which takes abs(id))."""
    lines = []
    for leg_id, account_no, signed_amount in (
        (-entry.id, entry.from_account_no, -entry.amount),
        (entry.id, entry.to_account_no, entry.amount),
    ):
        coa = coa_by_no.get(account_no)
        lines.append(
            GeneralLedgerLineOut(
                source="restricted_transfer",
                id=leg_id,
                transaction_date=entry.transaction_date,
                posted_date=entry.transaction_date,
                reconciled=False,
                description=entry.description,
                account_no=account_no or "",
                statement_description=coa.statement_description if coa else "",
                category=coa.category if coa else "",
                statement_category=coa.statement_category if coa else "",
                statement_item=coa.statement_item if coa else "",
                statement_detail=coa.statement_detail if coa else "",
                grouping=coa.grouping if coa else "",
                is_youth_chaplain_share=coa.is_youth_chaplain_share if coa else "",
                is_missions=coa.is_missions if coa else "",
                bank_account_name="",
                bank_description="",
                method="",
                amount=signed_amount,
                check_invoice_name="",
                notes=entry.notes,
                is_reimbursement=False,
                source_file_name="",
                source_file_link="",
            )
        )
    return lines


@router.get("", response_model=list[GeneralLedgerLineOut])
def list_general_ledger(
    year: int | None = None, db: Session = Depends(get_db)
) -> list[GeneralLedgerLineOut]:
    """The union of Reconciliation + Accrual + Budget - the single source
    every financial report should read from, rather than each report
    re-deriving its own view of "all the transactions". Read-only: edit the
    underlying entry on its own tab (Reconciliation/Accrual/Budget)."""
    accounts = list(db.scalars(select(ChartOfAccount)))
    coa_by_no = {a.account_no: a for a in accounts}
    bank_accounts_by_id = {b.id: b for b in db.scalars(select(BankAccount))}
    categorizer = Categorizer(list(db.scalars(select(CategoryRule))), accounts)

    lines: list[GeneralLedgerLineOut] = []
    for e in db.scalars(
        select(ReconciliationEntry).where(ReconciliationEntry.is_split == False)  # noqa: E712
    ):
        if year is not None and (e.posted_date is None or e.posted_date.year != year):
            continue
        lines.append(_entry_to_line(e, "reconciliation", coa_by_no, bank_accounts_by_id, categorizer))

    for e in db.scalars(select(AccrualEntry).where(AccrualEntry.is_split == False)):  # noqa: E712
        if year is not None and (e.posted_date is None or e.posted_date.year != year):
            continue
        lines.append(_entry_to_line(e, "accrual", coa_by_no, bank_accounts_by_id, categorizer))

    for e in db.scalars(select(BudgetEntry).where(BudgetEntry.amount != 0)):
        if year is not None and (e.transaction_date is None or e.transaction_date.year != year):
            continue
        lines.append(_budget_to_line(e, coa_by_no))

    for e in db.scalars(select(RestrictedTransferEntry)):
        if year is not None and (e.transaction_date is None or e.transaction_date.year != year):
            continue
        lines.extend(_transfer_to_lines(e, coa_by_no))

    lines.sort(key=lambda line: line.posted_date or date.min, reverse=True)
    return lines
