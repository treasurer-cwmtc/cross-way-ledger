from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ChartOfAccount
from ..schemas import ChartOfAccountOut
from ..seed import load_chart_of_accounts_from_csv

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


@router.get("", response_model=list[ChartOfAccountOut])
def list_accounts(
    category: str | None = None, db: Session = Depends(get_db)
) -> list[ChartOfAccount]:
    stmt = select(ChartOfAccount).order_by(ChartOfAccount.account_no)
    if category:
        stmt = stmt.where(ChartOfAccount.category == category)
    return list(db.scalars(stmt).all())


@router.post("/upload")
async def upload_accounts(
    file: UploadFile = File(...), db: Session = Depends(get_db)
) -> dict:
    """Replace the Chart of Accounts with an uploaded CSV export of the
    'IMPORT - Chart of Accounts' tab."""
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    count = load_chart_of_accounts_from_csv(db, text)
    if count == 0:
        raise HTTPException(
            status_code=400,
            detail="No rows found. Expected an 'AccountNo' column.",
        )
    return {"loaded": count}
