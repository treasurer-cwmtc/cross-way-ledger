from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import BankAccount, ChartOfAccount, ReconciliationEntry, ReconRun
from ..schemas import (
    ReconciliationEntryOut,
    ReconciliationEntryUpdate,
    ReconciliationImportRequest,
    ReconciliationImportResult,
)
from ..services.ledger import build_dedup_key, friendly_method, parse_date

router = APIRouter(
    prefix="/api/reconciliation", tags=["reconciliation"], dependencies=[Depends(get_current_user)]
)


def _to_out(
    entry: ReconciliationEntry,
    coa_by_no: dict[str, ChartOfAccount],
    bank_accounts_by_id: dict[int, BankAccount],
) -> ReconciliationEntryOut:
    coa = coa_by_no.get(entry.account_no)
    bank_account = bank_accounts_by_id.get(entry.bank_account_id) if entry.bank_account_id else None
    return ReconciliationEntryOut(
        id=entry.id,
        transaction_date=entry.transaction_date,
        date_posted=entry.date_posted,
        reconciled=entry.reconciled,
        is_reimbursement=entry.is_reimbursement,
        account_no=entry.account_no,
        description=entry.description,
        bank_account_id=entry.bank_account_id,
        bank_account_name=bank_account.name if bank_account else "",
        method=entry.method,
        amount=entry.amount,
        check_invoice_name=entry.check_invoice_name,
        bank_description=entry.bank_description,
        notes=entry.notes,
        source_run_id=entry.source_run_id,
        statement_description=coa.statement_description if coa else "",
        category=coa.category if coa else "",
        statement_category=coa.statement_category if coa else "",
        statement_item=coa.statement_item if coa else "",
        statement_detail=coa.statement_detail if coa else "",
        grouping=coa.grouping if coa else "",
        is_youth_chaplain_share=coa.is_youth_chaplain_share if coa else "",
        is_missions=coa.is_missions if coa else "",
    )


def _lookups(db: Session) -> tuple[dict[str, ChartOfAccount], dict[int, BankAccount]]:
    coa_by_no = {a.account_no: a for a in db.scalars(select(ChartOfAccount))}
    bank_accounts_by_id = {b.id: b for b in db.scalars(select(BankAccount))}
    return coa_by_no, bank_accounts_by_id


@router.get("", response_model=list[ReconciliationEntryOut])
def list_entries(db: Session = Depends(get_db)) -> list[ReconciliationEntryOut]:
    coa_by_no, bank_accounts_by_id = _lookups(db)
    entries = db.scalars(
        select(ReconciliationEntry).order_by(ReconciliationEntry.transaction_date.desc())
    )
    return [_to_out(e, coa_by_no, bank_accounts_by_id) for e in entries]


@router.put("/{entry_id}", response_model=ReconciliationEntryOut)
def update_entry(
    entry_id: int, payload: ReconciliationEntryUpdate, db: Session = Depends(get_db)
) -> ReconciliationEntryOut:
    entry = db.get(ReconciliationEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found.")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(entry, field, value.strip() if isinstance(value, str) else value)
    db.commit()
    db.refresh(entry)
    coa_by_no, bank_accounts_by_id = _lookups(db)
    return _to_out(entry, coa_by_no, bank_accounts_by_id)


@router.delete("/{entry_id}", status_code=204)
def delete_entry(entry_id: int, db: Session = Depends(get_db)) -> None:
    entry = db.get(ReconciliationEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found.")
    db.delete(entry)
    db.commit()


@router.post("/import-run/{run_id}", response_model=ReconciliationImportResult)
def import_run(
    run_id: int, payload: ReconciliationImportRequest, db: Session = Depends(get_db)
) -> ReconciliationImportResult:
    """Push a completed Upload run's lines into the persistent Reconciliation
    ledger. Rows whose dedup_key already exists are skipped, so re-importing
    the same statement (or an overlapping date range) never creates
    duplicates."""
    run = db.get(ReconRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found.")
    bank_account = db.get(BankAccount, payload.bank_account_id)
    if bank_account is None:
        raise HTTPException(status_code=404, detail="Bank account not found.")

    existing_keys = set(db.scalars(select(ReconciliationEntry.dedup_key)))

    imported = 0
    skipped = 0
    for line in run.lines:
        txn_date = parse_date(line.transaction_date)
        key = build_dedup_key(txn_date, line.amount, line.reference, line.bank_description)
        if key in existing_keys:
            skipped += 1
            continue
        existing_keys.add(key)
        db.add(
            ReconciliationEntry(
                transaction_date=txn_date,
                date_posted=parse_date(line.date_posted),
                account_no=line.account_no,
                description=line.description,
                bank_account_id=bank_account.id,
                method=friendly_method(line.method),
                amount=line.amount,
                check_invoice_name=line.reference,
                bank_description=line.bank_description,
                notes=line.notes,
                dedup_key=key,
                source_run_id=run.id,
            )
        )
        imported += 1
    db.commit()
    return ReconciliationImportResult(imported=imported, skipped_duplicates=skipped)
