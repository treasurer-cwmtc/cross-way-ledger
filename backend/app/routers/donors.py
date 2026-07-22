from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_any_permission
from ..models import Donation, Donor
from ..schemas import DonorGiftOut, DonorOut

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


@router.get("/{donor_id}/gifts", response_model=list[DonorGiftOut])
def donor_gifts(donor_id: str, db: Session = Depends(get_db)) -> list[Donation]:
    """Every gift this donor has given, across every fund - not scoped to
    one campaign, for the Donors page's click-to-expand detail popup."""
    if db.get(Donor, donor_id) is None:
        raise HTTPException(404, "Donor not found.")
    return list(
        db.scalars(
            select(Donation)
            .where(Donation.donor_id == donor_id)
            .order_by(Donation.received_date.desc().nulls_last())
        )
    )
