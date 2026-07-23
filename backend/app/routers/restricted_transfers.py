from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_permission
from ..models import ChartOfAccount, RestrictedTransferEntry
from ..schemas import (
    RestrictedTransferEntryCreate,
    RestrictedTransferEntryOut,
    RestrictedTransferEntryUpdate,
)

router = APIRouter(
    prefix="/api/restricted-transfers",
    tags=["restricted-transfers"],
    dependencies=[Depends(require_permission("restricted-net-assets"))],
)


def _to_out(
    entry: RestrictedTransferEntry, coa_by_no: dict[str, ChartOfAccount]
) -> RestrictedTransferEntryOut:
    from_coa = coa_by_no.get(entry.from_account_no)
    to_coa = coa_by_no.get(entry.to_account_no)
    return RestrictedTransferEntryOut(
        id=entry.id,
        transaction_date=entry.transaction_date,
        from_account_no=entry.from_account_no or "",
        from_statement_description=from_coa.statement_description if from_coa else "",
        to_account_no=entry.to_account_no or "",
        to_statement_description=to_coa.statement_description if to_coa else "",
        amount=entry.amount,
        description=entry.description,
        notes=entry.notes,
    )


@router.get("", response_model=list[RestrictedTransferEntryOut])
def list_transfers(db: Session = Depends(get_db)) -> list[RestrictedTransferEntryOut]:
    coa_by_no = {a.account_no: a for a in db.scalars(select(ChartOfAccount))}
    entries = db.scalars(
        select(RestrictedTransferEntry).order_by(
            RestrictedTransferEntry.transaction_date.desc(), RestrictedTransferEntry.id.desc()
        )
    )
    return [_to_out(e, coa_by_no) for e in entries]


@router.post("", response_model=RestrictedTransferEntryOut, status_code=201)
def create_transfer(
    payload: RestrictedTransferEntryCreate, db: Session = Depends(get_db)
) -> RestrictedTransferEntryOut:
    entry = RestrictedTransferEntry(**payload.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    coa_by_no = {a.account_no: a for a in db.scalars(select(ChartOfAccount))}
    return _to_out(entry, coa_by_no)


@router.put("/{entry_id}", response_model=RestrictedTransferEntryOut)
def update_transfer(
    entry_id: int, payload: RestrictedTransferEntryUpdate, db: Session = Depends(get_db)
) -> RestrictedTransferEntryOut:
    entry = db.get(RestrictedTransferEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Transfer not found.")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(entry, field, value.strip() if isinstance(value, str) else value)
    db.commit()
    db.refresh(entry)
    coa_by_no = {a.account_no: a for a in db.scalars(select(ChartOfAccount))}
    return _to_out(entry, coa_by_no)


@router.delete("/{entry_id}", status_code=204)
def delete_transfer(entry_id: int, db: Session = Depends(get_db)) -> None:
    entry = db.get(RestrictedTransferEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Transfer not found.")
    db.delete(entry)
    db.commit()
