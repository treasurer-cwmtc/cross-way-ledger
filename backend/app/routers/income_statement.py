from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_permission
from ..schemas import IncomeStatementOut
from ..services.reporting import compute_income_statement

router = APIRouter(
    prefix="/api/income-statement",
    tags=["income-statement"],
    dependencies=[Depends(require_permission("income-statement"))],
)


@router.get("", response_model=IncomeStatementOut)
def income_statement(db: Session = Depends(get_db)) -> IncomeStatementOut:
    return compute_income_statement(db)
