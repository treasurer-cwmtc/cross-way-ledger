from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_permission
from ..models import BankAccount, CategoryRule, ChartOfAccount, ReconciliationEntry, ReconRun
from ..schemas import (
    ReconciliationEntryOut,
    ReconciliationEntryUpdate,
    ReconciliationImportRequest,
    ReconciliationImportResult,
    SplitGroupOut,
    SplitRequest,
)
from ..services.categorizer import Categorizer
from ..services.ledger import build_dedup_key, friendly_method, parse_date
from ..services.reconciler import UNCATEGORIZED_NOTE

router = APIRouter(
    prefix="/api/reconciliation",
    tags=["reconciliation"],
    dependencies=[Depends(require_permission("reconciliation"))],
)


def _to_out(
    entry: ReconciliationEntry,
    coa_by_no: dict[str, ChartOfAccount],
    bank_accounts_by_id: dict[int, BankAccount],
    categorizer: Categorizer,
) -> ReconciliationEntryOut:
    coa = coa_by_no.get(entry.account_no)
    bank_account = bank_accounts_by_id.get(entry.bank_account_id) if entry.bank_account_id else None
    # Description is a live join to the current bank-keyword rules, same as
    # Statement Description is a live join to the Chart of Accounts - a rule's
    # Description is picked up immediately by every entry it matches,
    # including ones imported before the rule had (or even was) one. Only
    # kicks in when nothing's been typed directly on the entry, so a real
    # manual description (a donor name, a note) is never overwritten.
    description = entry.description or categorizer.categorize_bank(entry.bank_description).description
    return ReconciliationEntryOut(
        id=entry.id,
        transaction_date=entry.transaction_date,
        posted_date=entry.posted_date,
        reconciled=entry.reconciled,
        is_reimbursement=entry.is_reimbursement,
        account_no=entry.account_no or "",
        description=description,
        bank_account_id=entry.bank_account_id,
        bank_account_name=bank_account.name if bank_account else "",
        method=entry.method,
        amount=entry.amount,
        check_invoice_name=entry.check_invoice_name,
        bank_description=entry.bank_description,
        notes=entry.notes,
        source_run_id=entry.source_run_id,
        split_parent_id=entry.split_parent_id,
        receipt_file_id=entry.receipt_file_id,
        receipt_file_name=entry.receipt_file_name,
        receipt_web_view_link=entry.receipt_web_view_link,
        source_file_name=entry.source_file_name,
        source_file_link=entry.source_file_link,
        statement_description=coa.statement_description if coa else "",
        category=coa.category if coa else "",
        statement_category=coa.statement_category if coa else "",
        statement_item=coa.statement_item if coa else "",
        statement_detail=coa.statement_detail if coa else "",
        grouping=coa.grouping if coa else "",
        is_youth_chaplain_share=coa.is_youth_chaplain_share if coa else "",
        is_missions=coa.is_missions if coa else "",
    )


def _lookups(
    db: Session,
) -> tuple[dict[str, ChartOfAccount], dict[int, BankAccount], Categorizer]:
    accounts = list(db.scalars(select(ChartOfAccount)))
    coa_by_no = {a.account_no: a for a in accounts}
    bank_accounts_by_id = {b.id: b for b in db.scalars(select(BankAccount))}
    rules = list(db.scalars(select(CategoryRule)))
    categorizer = Categorizer(rules, accounts)
    return coa_by_no, bank_accounts_by_id, categorizer


@router.get("", response_model=list[ReconciliationEntryOut])
def list_entries(
    year: int | None = None, db: Session = Depends(get_db)
) -> list[ReconciliationEntryOut]:
    coa_by_no, bank_accounts_by_id, categorizer = _lookups(db)
    entries = db.scalars(
        select(ReconciliationEntry)
        .where(ReconciliationEntry.is_split == False)  # noqa: E712 - hidden once split
        .order_by(ReconciliationEntry.transaction_date.desc())
    )
    return [
        _to_out(e, coa_by_no, bank_accounts_by_id, categorizer)
        for e in entries
        if year is None or (e.posted_date is not None and e.posted_date.year == year)
    ]


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
    coa_by_no, bank_accounts_by_id, categorizer = _lookups(db)
    return _to_out(entry, coa_by_no, bank_accounts_by_id, categorizer)


@router.delete("/{entry_id}", status_code=204)
def delete_entry(entry_id: int, db: Session = Depends(get_db)) -> None:
    entry = db.get(ReconciliationEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found.")
    db.delete(entry)
    db.commit()


@router.post("/{entry_id}/split", response_model=list[ReconciliationEntryOut])
def split_entry(
    entry_id: int, payload: SplitRequest, db: Session = Depends(get_db)
) -> list[ReconciliationEntryOut]:
    """Split one aggregated line (e.g. a lump bank deposit covering several
    checks) into multiple entries. The original row is kept but hidden
    (is_split=True) rather than deleted, so its dedup_key keeps blocking a
    future re-import of the same statement from re-adding it."""
    parent = db.get(ReconciliationEntry, entry_id)
    if parent is None:
        raise HTTPException(status_code=404, detail="Entry not found.")
    if parent.split_parent_id is not None:
        raise HTTPException(
            status_code=400,
            detail="This line is already part of a split; undo that split first.",
        )
    if parent.is_split:
        raise HTTPException(status_code=400, detail="This line has already been split.")
    if len(payload.lines) < 2:
        raise HTTPException(status_code=400, detail="Provide at least 2 lines to split into.")

    total = round(sum(line.amount for line in payload.lines), 2)
    if abs(total - round(parent.amount, 2)) >= 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"Split lines total ${total:.2f}, but the original amount is ${parent.amount:.2f}.",
        )

    children = []
    for i, line in enumerate(payload.lines):
        child = ReconciliationEntry(
            transaction_date=parent.transaction_date,
            posted_date=parent.posted_date,
            account_no=line.account_no,
            description=line.description,
            bank_account_id=parent.bank_account_id,
            method=parent.method,
            amount=line.amount,
            check_invoice_name=line.check_invoice_name,
            bank_description=parent.bank_description,
            notes=line.notes,
            dedup_key=f"{parent.dedup_key}#split{i}",
            source_run_id=parent.source_run_id,
            source_file_name=parent.source_file_name,
            source_file_link=parent.source_file_link,
            split_parent_id=parent.id,
        )
        db.add(child)
        children.append(child)
    parent.is_split = True
    db.commit()
    for c in children:
        db.refresh(c)
    coa_by_no, bank_accounts_by_id, categorizer = _lookups(db)
    return [_to_out(c, coa_by_no, bank_accounts_by_id, categorizer) for c in children]


@router.post("/{parent_id}/unsplit", response_model=ReconciliationEntryOut)
def unsplit_entry(parent_id: int, db: Session = Depends(get_db)) -> ReconciliationEntryOut:
    parent = db.get(ReconciliationEntry, parent_id)
    if parent is None or not parent.is_split:
        raise HTTPException(status_code=404, detail="Split not found.")
    children = list(
        db.scalars(
            select(ReconciliationEntry).where(ReconciliationEntry.split_parent_id == parent_id)
        )
    )
    for c in children:
        db.delete(c)
    parent.is_split = False
    db.commit()
    db.refresh(parent)
    coa_by_no, bank_accounts_by_id, categorizer = _lookups(db)
    return _to_out(parent, coa_by_no, bank_accounts_by_id, categorizer)


@router.get("/split-group/{parent_id}", response_model=SplitGroupOut)
def get_split_group(parent_id: int, db: Session = Depends(get_db)) -> SplitGroupOut:
    parent = db.get(ReconciliationEntry, parent_id)
    if parent is None:
        raise HTTPException(status_code=404, detail="Entry not found.")
    children = list(
        db.scalars(
            select(ReconciliationEntry).where(ReconciliationEntry.split_parent_id == parent_id)
        )
    )
    coa_by_no, bank_accounts_by_id, categorizer = _lookups(db)
    return SplitGroupOut(
        parent=_to_out(parent, coa_by_no, bank_accounts_by_id, categorizer),
        children=[_to_out(c, coa_by_no, bank_accounts_by_id, categorizer) for c in children],
    )


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
                posted_date=parse_date(line.posted_date),
                account_no=line.account_no,
                description=line.description,
                bank_account_id=bank_account.id,
                method=friendly_method(line.method),
                amount=line.amount,
                check_invoice_name=line.reference,
                bank_description=line.bank_description,
                # UNCATEGORIZED_NOTE is a wizard-only review hint (surfaced
                # in Step 3's "What's wrong" column) - not something that
                # belongs permanently on the ledger, which already shows
                # uncategorized rows via a red Statement Description
                # instead. Only strip that exact auto-generated text, so a
                # real note the user typed on the line is never lost.
                notes="" if line.notes == UNCATEGORIZED_NOTE else line.notes,
                dedup_key=key,
                source_run_id=run.id,
                source_file_name=run.stripe_filename if line.source == "stripe" else run.bank_filename,
                source_file_link=run.stripe_file_link if line.source == "stripe" else run.bank_file_link,
            )
        )
        imported += 1
    db.commit()
    return ReconciliationImportResult(imported=imported, skipped_duplicates=skipped)
