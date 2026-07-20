from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_any_permission
from ..models import Donor
from ..schemas import DonorOut

router = APIRouter(
    prefix="/api/donors",
    tags=["donors"],
    dependencies=[Depends(require_any_permission("donors", "pledge-campaign-pledges"))],
)


@router.get("", response_model=list[DonorOut])
def list_donors(db: Session = Depends(get_db)) -> list[Donor]:
    """The persistent Giving App donor list - lives under Config as "Giving
    App - Donors" and doubles as the lookup for the Pledges page's donor
    picker."""
    return list(db.scalars(select(Donor).order_by(Donor.last_name, Donor.first_name)))
