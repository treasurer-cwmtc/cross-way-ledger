from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_permission
from ..models import Donation
from ..schemas import DonationImportSummary, FundSummary
from ..services.pledge_import import parse_donation_csv

router = APIRouter(
    prefix="/api/donations",
    tags=["donations"],
    dependencies=[Depends(require_permission("pledge-campaign-status"))],
)


async def _read_csv(file: UploadFile) -> str:
    raw = await file.read()
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("latin-1")


def _fund_summary(db: Session) -> list[FundSummary]:
    rows = db.execute(
        select(Donation.fund, func.count(Donation.id), func.sum(Donation.net_amount))
        .group_by(Donation.fund)
        .order_by(Donation.fund)
    ).all()
    return [
        FundSummary(name=fund or "(blank)", count=count, total=round(total or 0.0, 2))
        for fund, count, total in rows
    ]


@router.get("/funds", response_model=list[FundSummary])
def list_funds(db: Session = Depends(get_db)) -> list[FundSummary]:
    """Distinct funds actually present in the imported donations, with
    counts - this is what a campaign's fund is chosen from (step 2 of the
    wizard), never hand-typed."""
    return _fund_summary(db)


@router.post("/import", response_model=DonationImportSummary)
async def import_donations(
    donation_file: UploadFile = File(...), db: Session = Depends(get_db)
) -> DonationImportSummary:
    """Step 1 of the pledge campaign wizard: the Giving App's donation
    export is the source of truth, imported in full and independent of any
    one campaign - a campaign just picks a fund from what shows up here.
    Safe to re-run; donations already on file (by the Giving App's own
    transaction id) are skipped."""
    rows = parse_donation_csv(await _read_csv(donation_file))
    existing_keys = set(db.scalars(select(Donation.dedup_key)))

    imported = 0
    for row in rows:
        if row.dedup_key in existing_keys:
            continue
        db.add(
            Donation(
                dedup_key=row.dedup_key,
                donor_id=row.donor_id or None,
                fund=row.fund,
                received_date=row.received_date,
                amount=row.amount,
                net_amount=row.net_amount,
                method=row.method,
            )
        )
        existing_keys.add(row.dedup_key)
        imported += 1
    db.commit()

    return DonationImportSummary(donations_imported=imported, funds=_fund_summary(db))
