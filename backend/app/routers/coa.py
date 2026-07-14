from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import CategoryRule, ChartOfAccount, StatementCategory, StatementItem
from ..schemas import (
    AccountNoPreview,
    ChartOfAccountCreate,
    ChartOfAccountOut,
    ChartOfAccountUpdate,
    StatementCategoryCreate,
    StatementCategoryOut,
    StatementItemCreate,
    StatementItemOut,
)
from ..services.coa_numbering import (
    compute_account_no,
    create_statement_category,
    create_statement_item,
    default_description,
)

router = APIRouter(
    prefix="/api/accounts", tags=["accounts"], dependencies=[Depends(get_current_user)]
)


# --- Statement Categories (level 1) -----------------------------------------


@router.get("/statement-categories", response_model=list[StatementCategoryOut])
def list_statement_categories(
    category: str | None = None, db: Session = Depends(get_db)
) -> list[StatementCategory]:
    stmt = select(StatementCategory).order_by(StatementCategory.category, StatementCategory.no)
    if category:
        stmt = stmt.where(StatementCategory.category == category)
    return list(db.scalars(stmt).all())


@router.post("/statement-categories", response_model=StatementCategoryOut, status_code=201)
def add_statement_category(
    payload: StatementCategoryCreate, db: Session = Depends(get_db)
) -> StatementCategory:
    try:
        row = create_statement_category(db, payload.category, payload.name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    db.commit()
    db.refresh(row)
    return row


@router.delete("/statement-categories/{statement_category_id}", status_code=204)
def delete_statement_category(statement_category_id: int, db: Session = Depends(get_db)) -> None:
    row = db.get(StatementCategory, statement_category_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Statement Category not found.")
    if row.items:
        raise HTTPException(
            status_code=400,
            detail="This Statement Category has Statement Items under it; delete those first.",
        )
    db.delete(row)
    db.commit()


# --- Statement Items (level 2) ----------------------------------------------


@router.get("/statement-items", response_model=list[StatementItemOut])
def list_statement_items(
    statement_category_id: int | None = None, db: Session = Depends(get_db)
) -> list[StatementItem]:
    stmt = select(StatementItem).order_by(StatementItem.statement_category_id, StatementItem.no)
    if statement_category_id is not None:
        stmt = stmt.where(StatementItem.statement_category_id == statement_category_id)
    return list(db.scalars(stmt).all())


@router.post("/statement-items", response_model=StatementItemOut, status_code=201)
def add_statement_item(payload: StatementItemCreate, db: Session = Depends(get_db)) -> StatementItem:
    try:
        row = create_statement_item(db, payload.statement_category_id, payload.name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    db.commit()
    db.refresh(row)
    return row


@router.delete("/statement-items/{statement_item_id}", status_code=204)
def delete_statement_item(statement_item_id: int, db: Session = Depends(get_db)) -> None:
    row = db.get(StatementItem, statement_item_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Statement Item not found.")
    if row.accounts:
        raise HTTPException(
            status_code=400,
            detail="This Statement Item has accounts under it; delete those first.",
        )
    db.delete(row)
    db.commit()


# --- Accounts (level 3 / Detail, the leaf) ----------------------------------


@router.get("", response_model=list[ChartOfAccountOut])
def list_accounts(
    category: str | None = None, db: Session = Depends(get_db)
) -> list[ChartOfAccount]:
    stmt = select(ChartOfAccount).order_by(ChartOfAccount.account_no)
    if category:
        stmt = stmt.where(ChartOfAccount.category == category)
    return list(db.scalars(stmt).all())


@router.post("/preview-number", response_model=AccountNoPreview)
def preview_account_no(
    payload: ChartOfAccountCreate, db: Session = Depends(get_db)
) -> AccountNoPreview:
    try:
        account_no, item, detail_no = compute_account_no(
            db, payload.statement_item_id, payload.statement_detail
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return AccountNoPreview(
        account_no=account_no,
        statement_category_no=item.statement_category.no,
        statement_item_no=item.no,
        statement_detail_no=detail_no,
    )


@router.post("", response_model=ChartOfAccountOut, status_code=201)
def create_account(
    payload: ChartOfAccountCreate, db: Session = Depends(get_db)
) -> ChartOfAccount:
    try:
        account_no, item, detail_no = compute_account_no(
            db, payload.statement_item_id, payload.statement_detail
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    category_row = item.statement_category
    detail = payload.statement_detail.strip()
    description = payload.statement_description.strip() or default_description(
        category_row.category, category_row.name, item.name, detail
    )
    account = ChartOfAccount(
        account_no=account_no,
        statement_item_id=item.id,
        category=category_row.category,
        statement_category=category_row.name,
        statement_category_no=category_row.no,
        statement_item=item.name,
        statement_item_no=item.no,
        statement_detail=detail,
        statement_detail_no=detail_no,
        statement_description=description,
        is_tax_deductible=payload.is_tax_deductible.strip(),
        is_mandatory=payload.is_mandatory.strip(),
        grouping=payload.grouping.strip(),
        is_youth_chaplain_share=payload.is_youth_chaplain_share.strip(),
        is_missions=payload.is_missions.strip(),
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


@router.put("/{account_no}", response_model=ChartOfAccountOut)
def update_account(
    account_no: str, payload: ChartOfAccountUpdate, db: Session = Depends(get_db)
) -> ChartOfAccount:
    account = db.get(ChartOfAccount, account_no)
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found.")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(account, field, value.strip() if isinstance(value, str) else value)
    db.commit()
    db.refresh(account)
    return account


@router.delete("/{account_no}", status_code=204)
def delete_account(account_no: str, db: Session = Depends(get_db)) -> None:
    account = db.get(ChartOfAccount, account_no)
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found.")
    in_use = db.scalar(
        select(CategoryRule).where(CategoryRule.account_no == account_no).limit(1)
    )
    if in_use is not None:
        raise HTTPException(
            status_code=400,
            detail="This account is used by one or more categorization rules; remove those rules first.",
        )
    db.delete(account)
    db.commit()
