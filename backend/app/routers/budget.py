from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import BudgetEntry, ChartOfAccount
from ..schemas import (
    BudgetCopyYearRequest,
    BudgetCopyYearResult,
    BudgetEntryCreate,
    BudgetEntryOut,
    BudgetEntryUpdate,
)

router = APIRouter(prefix="/api/budget", tags=["budget"], dependencies=[Depends(get_current_user)])


def _to_out(entry: BudgetEntry, coa_by_no: dict[str, ChartOfAccount]) -> BudgetEntryOut:
    coa = coa_by_no.get(entry.account_no)
    return BudgetEntryOut(
        id=entry.id,
        transaction_date=entry.transaction_date,
        account_no=entry.account_no,
        description=entry.description,
        amount=entry.amount,
        notes=entry.notes,
        statement_description=coa.statement_description if coa else "",
        category=coa.category if coa else "",
        statement_category=coa.statement_category if coa else "",
        statement_item=coa.statement_item if coa else "",
        statement_detail=coa.statement_detail if coa else "",
    )


@router.get("", response_model=list[BudgetEntryOut])
def list_budget(year: int | None = None, db: Session = Depends(get_db)) -> list[BudgetEntryOut]:
    coa_by_no = {a.account_no: a for a in db.scalars(select(ChartOfAccount))}
    entries = db.scalars(select(BudgetEntry).order_by(BudgetEntry.transaction_date, BudgetEntry.id))
    return [
        _to_out(e, coa_by_no)
        for e in entries
        if year is None or (e.transaction_date is not None and e.transaction_date.year == year)
    ]


@router.post("", response_model=BudgetEntryOut, status_code=201)
def create_budget(payload: BudgetEntryCreate, db: Session = Depends(get_db)) -> BudgetEntryOut:
    entry = BudgetEntry(**payload.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    coa_by_no = {a.account_no: a for a in db.scalars(select(ChartOfAccount))}
    return _to_out(entry, coa_by_no)


@router.put("/{entry_id}", response_model=BudgetEntryOut)
def update_budget(entry_id: int, payload: BudgetEntryUpdate, db: Session = Depends(get_db)) -> BudgetEntryOut:
    entry = db.get(BudgetEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Budget entry not found.")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(entry, field, value.strip() if isinstance(value, str) else value)
    db.commit()
    db.refresh(entry)
    coa_by_no = {a.account_no: a for a in db.scalars(select(ChartOfAccount))}
    return _to_out(entry, coa_by_no)


@router.delete("/{entry_id}", status_code=204)
def delete_budget(entry_id: int, db: Session = Depends(get_db)) -> None:
    entry = db.get(BudgetEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Budget entry not found.")
    db.delete(entry)
    db.commit()


@router.post("/copy-year", response_model=BudgetCopyYearResult)
def copy_year(payload: BudgetCopyYearRequest, db: Session = Depends(get_db)) -> BudgetCopyYearResult:
    """Copy every budget line from `from_year` into `to_year` (dates shifted
    to the same month/day in the new year) as a starting point for the new
    year's budget. Refuses to run into a year that already has entries
    unless `overwrite` is set, which clears that year first."""
    source = list(
        db.scalars(select(BudgetEntry).where(BudgetEntry.transaction_date.isnot(None)))
    )
    source = [e for e in source if e.transaction_date.year == payload.from_year]
    if not source:
        raise HTTPException(status_code=404, detail=f"No budget entries found for {payload.from_year}.")

    existing_target = list(
        db.scalars(select(BudgetEntry).where(BudgetEntry.transaction_date.isnot(None)))
    )
    existing_target = [e for e in existing_target if e.transaction_date.year == payload.to_year]
    if existing_target and not payload.overwrite:
        raise HTTPException(
            status_code=400,
            detail=f"{payload.to_year} already has {len(existing_target)} budget entries. "
            "Pass overwrite=true to replace them.",
        )
    for e in existing_target:
        db.delete(e)

    copied = 0
    for e in source:
        new_date = e.transaction_date.replace(year=payload.to_year)
        db.add(
            BudgetEntry(
                transaction_date=new_date,
                account_no=e.account_no,
                description=e.description,
                amount=e.amount,
                notes=e.notes,
            )
        )
        copied += 1
    db.commit()
    return BudgetCopyYearResult(copied=copied)
