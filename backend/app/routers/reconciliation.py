from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_permission
from ..models import (
    AccrualEntry,
    BankAccount,
    CategoryRule,
    ChartOfAccount,
    ReconciliationEntry,
    ReconRun,
    Reimbursement,
    ReimbursementLine,
)
from ..schemas import (
    ReconcileWithAccrualsRequest,
    ReconcileWithAccrualsResult,
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


@router.post("/{actual_id}/reconcile-with-accruals", response_model=ReconcileWithAccrualsResult)
def reconcile_with_accruals(
    actual_id: int, payload: ReconcileWithAccrualsRequest, db: Session = Depends(get_db)
) -> ReconcileWithAccrualsResult:
    """One bank line often represents several accrual entries at once (e.g.
    one Zelle payment to a person that was accrued as 5 separate expense
    lines) - the mirror image of Stripe reconciliation, where one bank
    payout line explodes into several Stripe donation lines. This replaces
    the actual with one child per selected accrual entry (same split
    mechanics as split_entry - the original is hidden via is_split, not
    deleted, so its dedup_key keeps blocking re-import) and hides the
    accrual entries via reconciled_to_actual_id rather than deleting them -
    an accrual is never meant to be a long-lived record once the real
    payment clears, but deleting it outright would both lose the audit
    trail of which actual line it became and risk violating
    reimbursement_lines.accrual_entry_id's FK for any entry still linked to
    a *pending* Reimbursement (see delete_accrual_entries's docstring in
    services/reimbursements.py for that exact failure mode) - those are
    rejected here rather than silently skipped. A *paid* reimbursement's
    accrual entries are exactly what this feature exists to reconcile, so
    those are allowed through.

    Everything below the initial validation happens in one flush/commit: if
    creating the replacement actual lines fails partway, nothing (not the
    accrual hides, not the original actual's is_split flag) is left
    committed - the whole request either fully succeeds or fully rolls back.
    """
    actual = db.get(ReconciliationEntry, actual_id)
    if actual is None:
        raise HTTPException(status_code=404, detail="Actual entry not found.")
    if actual.is_split:
        raise HTTPException(status_code=400, detail="This line has already been split.")
    if actual.split_parent_id is not None:
        raise HTTPException(
            status_code=400,
            detail="This line is already part of a split; undo that split first.",
        )

    if not payload.accrual_entry_ids:
        raise HTTPException(status_code=400, detail="Select at least one accrual line.")
    ids = list(dict.fromkeys(payload.accrual_entry_ids))  # de-dup, keep order
    accruals = list(db.scalars(select(AccrualEntry).where(AccrualEntry.id.in_(ids))))
    if len(accruals) != len(ids):
        found = {a.id for a in accruals}
        missing = [i for i in ids if i not in found]
        raise HTTPException(status_code=404, detail=f"Accrual entry(ies) not found: {missing}")

    already_hidden = [a.id for a in accruals if a.is_split or a.reconciled_to_actual_id is not None]
    if already_hidden:
        raise HTTPException(
            status_code=400,
            detail=f"Accrual entry(ies) already split or reconciled: {already_hidden}",
        )

    # A pending reimbursement can still be edited or rejected, either of
    # which would touch this same accrual entry out from under us - block
    # those. A paid one is terminal (see the Reimbursement model docstring:
    # both Paid and Rejected are terminal) and mark_accrual_entries_posted
    # never deletes the entry, only stamps posted_date - so its accrual
    # entries are exactly what this feature exists to reconcile, not
    # something to reject.
    still_pending = list(
        db.scalars(
            select(ReimbursementLine.accrual_entry_id)
            .join(Reimbursement, Reimbursement.id == ReimbursementLine.reimbursement_id)
            .where(
                ReimbursementLine.accrual_entry_id.in_(ids),
                Reimbursement.status == "pending",
            )
        )
    )
    if still_pending:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Accrual entry(ies) {still_pending} are linked to a still-pending "
                "Reimbursement request and can't be reconciled until it's paid or rejected."
            ),
        )

    total = round(sum(a.amount for a in accruals), 2)
    if abs(total - round(actual.amount, 2)) >= 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"Selected accrual lines total ${total:.2f}, but the actual amount is ${actual.amount:.2f}.",
        )

    children = []
    for i, accrual in enumerate(accruals):
        child = ReconciliationEntry(
            transaction_date=accrual.transaction_date,
            posted_date=actual.posted_date,
            account_no=accrual.account_no,
            description=accrual.description,
            bank_account_id=actual.bank_account_id,
            method=actual.method,
            amount=accrual.amount,
            check_invoice_name=accrual.check_invoice_name,
            bank_description=actual.bank_description,
            notes=accrual.notes,
            is_reimbursement=accrual.is_reimbursement,
            reconciled=True,
            dedup_key=f"{actual.dedup_key}#accrual{i}",
            source_run_id=actual.source_run_id,
            source_file_name=actual.source_file_name,
            source_file_link=actual.source_file_link,
            split_parent_id=actual.id,
            receipt_file_id=accrual.receipt_file_id,
            receipt_file_name=accrual.receipt_file_name,
            receipt_web_view_link=accrual.receipt_web_view_link,
        )
        db.add(child)
        children.append(child)
    actual.is_split = True
    for accrual in accruals:
        accrual.reconciled_to_actual_id = actual.id
        accrual.reconciled = True
    db.commit()
    for c in children:
        db.refresh(c)
    coa_by_no, bank_accounts_by_id, categorizer = _lookups(db)
    return ReconcileWithAccrualsResult(
        actual_lines=[_to_out(c, coa_by_no, bank_accounts_by_id, categorizer) for c in children],
        reconciled_accrual_ids=[a.id for a in accruals],
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
