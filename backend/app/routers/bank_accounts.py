from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import BankAccount, ReconciliationEntry
from ..schemas import BankAccountCreate, BankAccountOut

router = APIRouter(
    prefix="/api/bank-accounts", tags=["bank-accounts"], dependencies=[Depends(get_current_user)]
)


@router.get("", response_model=list[BankAccountOut])
def list_bank_accounts(db: Session = Depends(get_db)) -> list[BankAccount]:
    return list(db.scalars(select(BankAccount).order_by(BankAccount.name)).all())


@router.post("", response_model=BankAccountOut, status_code=201)
def create_bank_account(payload: BankAccountCreate, db: Session = Depends(get_db)) -> BankAccount:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required.")
    existing = db.scalar(select(BankAccount).where(BankAccount.name == name))
    if existing:
        raise HTTPException(status_code=400, detail=f"Bank account '{name}' already exists.")
    account = BankAccount(name=name)
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


@router.delete("/{account_id}", status_code=204)
def delete_bank_account(account_id: int, db: Session = Depends(get_db)) -> None:
    account = db.get(BankAccount, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="Bank account not found.")
    in_use = db.scalar(
        select(ReconciliationEntry)
        .where(ReconciliationEntry.bank_account_id == account_id)
        .limit(1)
    )
    if in_use is not None:
        raise HTTPException(
            status_code=400,
            detail="This bank account is used by reconciliation entries; reassign those first.",
        )
    db.delete(account)
    db.commit()
