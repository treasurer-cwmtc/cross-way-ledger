from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import AccrualEntry, BankAccount, ChartOfAccount
from ..schemas import (
    AccrualEntryCreate,
    AccrualEntryOut,
    AccrualEntryUpdate,
    AccrualSplitGroupOut,
    SplitRequest,
)

router = APIRouter(
    prefix="/api/accrual", tags=["accrual"], dependencies=[Depends(get_current_user)]
)


def _to_out(
    entry: AccrualEntry,
    coa_by_no: dict[str, ChartOfAccount],
    bank_accounts_by_id: dict[int, BankAccount],
) -> AccrualEntryOut:
    coa = coa_by_no.get(entry.account_no)
    bank_account = bank_accounts_by_id.get(entry.bank_account_id) if entry.bank_account_id else None
    return AccrualEntryOut(
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
        split_parent_id=entry.split_parent_id,
        receipt_file_id=entry.receipt_file_id,
        receipt_file_name=entry.receipt_file_name,
        receipt_web_view_link=entry.receipt_web_view_link,
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


@router.get("", response_model=list[AccrualEntryOut])
def list_entries(db: Session = Depends(get_db)) -> list[AccrualEntryOut]:
    coa_by_no, bank_accounts_by_id = _lookups(db)
    entries = db.scalars(
        select(AccrualEntry)
        .where(AccrualEntry.is_split == False)  # noqa: E712 - hidden once split
        .order_by(AccrualEntry.transaction_date.desc(), AccrualEntry.id.desc())
    )
    return [_to_out(e, coa_by_no, bank_accounts_by_id) for e in entries]


@router.post("", response_model=AccrualEntryOut, status_code=201)
def create_entry(payload: AccrualEntryCreate, db: Session = Depends(get_db)) -> AccrualEntryOut:
    entry = AccrualEntry(**payload.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    coa_by_no, bank_accounts_by_id = _lookups(db)
    return _to_out(entry, coa_by_no, bank_accounts_by_id)


@router.put("/{entry_id}", response_model=AccrualEntryOut)
def update_entry(
    entry_id: int, payload: AccrualEntryUpdate, db: Session = Depends(get_db)
) -> AccrualEntryOut:
    entry = db.get(AccrualEntry, entry_id)
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
    entry = db.get(AccrualEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found.")
    db.delete(entry)
    db.commit()


@router.post("/{entry_id}/split", response_model=list[AccrualEntryOut])
def split_entry(
    entry_id: int, payload: SplitRequest, db: Session = Depends(get_db)
) -> list[AccrualEntryOut]:
    """Split one entry into several, e.g. one lump reimbursement that
    actually covers several people/purchases. The original row is kept but
    hidden (is_split=True) rather than deleted, for the same undo-friendly
    reasoning as Reconciliation's split."""
    parent = db.get(AccrualEntry, entry_id)
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
    for line in payload.lines:
        child = AccrualEntry(
            transaction_date=parent.transaction_date,
            date_posted=parent.date_posted,
            account_no=line.account_no,
            description=line.description,
            bank_account_id=parent.bank_account_id,
            method=parent.method,
            amount=line.amount,
            check_invoice_name=line.check_invoice_name,
            bank_description=parent.bank_description,
            notes=line.notes,
            split_parent_id=parent.id,
        )
        db.add(child)
        children.append(child)
    parent.is_split = True
    db.commit()
    for c in children:
        db.refresh(c)
    coa_by_no, bank_accounts_by_id = _lookups(db)
    return [_to_out(c, coa_by_no, bank_accounts_by_id) for c in children]


@router.post("/{parent_id}/unsplit", response_model=AccrualEntryOut)
def unsplit_entry(parent_id: int, db: Session = Depends(get_db)) -> AccrualEntryOut:
    parent = db.get(AccrualEntry, parent_id)
    if parent is None or not parent.is_split:
        raise HTTPException(status_code=404, detail="Split not found.")
    children = list(
        db.scalars(select(AccrualEntry).where(AccrualEntry.split_parent_id == parent_id))
    )
    for c in children:
        db.delete(c)
    parent.is_split = False
    db.commit()
    db.refresh(parent)
    coa_by_no, bank_accounts_by_id = _lookups(db)
    return _to_out(parent, coa_by_no, bank_accounts_by_id)


@router.get("/split-group/{parent_id}", response_model=AccrualSplitGroupOut)
def get_split_group(parent_id: int, db: Session = Depends(get_db)) -> AccrualSplitGroupOut:
    parent = db.get(AccrualEntry, parent_id)
    if parent is None:
        raise HTTPException(status_code=404, detail="Entry not found.")
    children = list(
        db.scalars(select(AccrualEntry).where(AccrualEntry.split_parent_id == parent_id))
    )
    coa_by_no, bank_accounts_by_id = _lookups(db)
    return AccrualSplitGroupOut(
        parent=_to_out(parent, coa_by_no, bank_accounts_by_id),
        children=[_to_out(c, coa_by_no, bank_accounts_by_id) for c in children],
    )
