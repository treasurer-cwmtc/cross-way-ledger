from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user, require_permission
from ..models import Donor, Pledge, PledgeCampaign, PledgeCampaignDonation, PledgeDonorMatch, User
from ..schemas import (
    PledgeCampaignCreate,
    PledgeCampaignDonationOut,
    PledgeCampaignOut,
    PledgeCampaignUpdate,
    PledgeDashboardOut,
    PledgeDashboardPoint,
    PledgeImportSummary,
    PledgeMatchUpdate,
    PledgeOut,
)
from ..services.pledge_import import (
    match_pledge_to_donor,
    parse_donation_csv,
    parse_donor_csv,
    parse_pledge_csv,
)

router = APIRouter(
    prefix="/api/pledge-campaigns", tags=["pledge-campaigns"], dependencies=[Depends(get_current_user)]
)


async def _read_csv(file: UploadFile) -> str:
    raw = await file.read()
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("latin-1")


def _get_campaign(db: Session, campaign_id: int) -> PledgeCampaign:
    campaign = db.get(PledgeCampaign, campaign_id)
    if campaign is None:
        raise HTTPException(404, "Campaign not found.")
    return campaign


@router.get("", response_model=list[PledgeCampaignOut])
def list_campaigns(db: Session = Depends(get_db)) -> list[PledgeCampaign]:
    return list(db.scalars(select(PledgeCampaign).order_by(PledgeCampaign.created_at.desc())))


@router.post(
    "", response_model=PledgeCampaignOut, status_code=201,
    dependencies=[Depends(require_permission("pledge-campaign-status"))],
)
def create_campaign(payload: PledgeCampaignCreate, db: Session = Depends(get_db)) -> PledgeCampaign:
    if db.scalar(select(PledgeCampaign).where(PledgeCampaign.name == payload.name)):
        raise HTTPException(409, "A campaign with this name already exists.")
    campaign = PledgeCampaign(**payload.model_dump())
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    return campaign


@router.put(
    "/{campaign_id}", response_model=PledgeCampaignOut,
    dependencies=[Depends(require_permission("pledge-campaign-status"))],
)
def update_campaign(
    campaign_id: int, payload: PledgeCampaignUpdate, db: Session = Depends(get_db)
) -> PledgeCampaign:
    campaign = _get_campaign(db, campaign_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(campaign, field, value)
    db.commit()
    db.refresh(campaign)
    return campaign


@router.post(
    "/{campaign_id}/import", response_model=PledgeImportSummary,
    dependencies=[Depends(require_permission("pledge-campaign-status"))],
)
async def import_campaign_data(
    campaign_id: int,
    pledge_file: UploadFile = File(...),
    donation_file: UploadFile = File(...),
    donor_file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> PledgeImportSummary:
    """Upload the three Giving App exports and import/re-import them:
    upserts donors, upserts pledges (deduped on submission_id per campaign),
    imports new donations (deduped on their own id), then runs auto-matching
    for every pledge that doesn't already have a manual match. Safe to
    re-run as often as fresh exports come in - see services/pledge_import.py
    for the matching algorithm (verified against the treasurer's own
    spreadsheet formulas)."""
    campaign = _get_campaign(db, campaign_id)

    donor_rows = parse_donor_csv(await _read_csv(donor_file))
    pledge_rows = parse_pledge_csv(await _read_csv(pledge_file))
    donation_rows = parse_donation_csv(await _read_csv(donation_file))

    # 1. Upsert donors.
    existing_donors = {d.donor_id: d for d in db.scalars(select(Donor))}
    donors_imported = 0
    for row in donor_rows:
        donor = existing_donors.get(row.donor_id)
        if donor is None:
            donor = Donor(donor_id=row.donor_id)
            db.add(donor)
            existing_donors[row.donor_id] = donor
        donor.donor_number = row.donor_number
        donor.first_name = row.first_name
        donor.last_name = row.last_name
        donor.email = row.email
        donor.phone_number = row.phone_number
        donor.city = row.city
        donor.state = row.state
        donor.zip_code = row.zip_code
        donor.joint_giver_id = row.joint_giver_id
        donor.joint_giver_first_name = row.joint_giver_first_name
        donor.joint_giver_last_name = row.joint_giver_last_name
        donor.first_donated = row.first_donated
        donor.donation_count = row.donation_count
        donor.total_given = row.total_given
        donors_imported += 1
    db.flush()

    # 2. Upsert pledges for this campaign.
    existing_pledges = {
        p.submission_id: p
        for p in db.scalars(select(Pledge).where(Pledge.campaign_id == campaign_id))
    }
    pledges_imported = 0
    for row in pledge_rows:
        pledge = existing_pledges.get(row.submission_id)
        if pledge is None:
            pledge = Pledge(campaign_id=campaign_id, submission_id=row.submission_id)
            db.add(pledge)
            existing_pledges[row.submission_id] = pledge
        pledge.first_name = row.first_name
        pledge.last_name = row.last_name
        pledge.email = row.email
        pledge.date_submitted = row.date_submitted
        pledge.initial_amount = row.initial_amount
        pledge.due_date = row.due_date
        pledge.monthly_amount = row.monthly_amount
        pledge.contact_method = row.contact_method
        pledges_imported += 1
    db.flush()

    # 3. Import new donations (dedup by the Giving App's own transaction id),
    #    filtered to this campaign's fund.
    existing_dedup_keys = set(
        db.scalars(
            select(PledgeCampaignDonation.dedup_key).where(
                PledgeCampaignDonation.campaign_id == campaign_id
            )
        )
    )
    donations_imported = 0
    for row in donation_rows:
        if row.fund != campaign.fund_name or row.dedup_key in existing_dedup_keys:
            continue
        db.add(
            PledgeCampaignDonation(
                campaign_id=campaign_id,
                dedup_key=row.dedup_key,
                donor_id=row.donor_id or None,
                received_date=row.received_date,
                amount=row.amount,
                net_amount=row.net_amount,
                method=row.method,
            )
        )
        existing_dedup_keys.add(row.dedup_key)
        donations_imported += 1
    db.flush()

    # 4. Auto-match every pledge that doesn't already have a match, or whose
    #    existing match was itself auto (never touch a manual match).
    donor_email_map = {d.email: d.donor_id for d in existing_donors.values() if d.email}
    existing_matches = {
        m.pledge_id: m
        for m in db.scalars(
            select(PledgeDonorMatch).join(Pledge).where(Pledge.campaign_id == campaign_id)
        )
    }
    matched = 0
    unmatched = 0
    for pledge in existing_pledges.values():
        match = existing_matches.get(pledge.id)
        if match is not None and match.match_source == "manual":
            if match.donor_id:
                matched += 1
            else:
                unmatched += 1
            continue
        donor_id = match_pledge_to_donor(pledge.email, donor_email_map)
        if match is None:
            match = PledgeDonorMatch(pledge_id=pledge.id)
            db.add(match)
        match.donor_id = donor_id
        match.match_source = "auto"
        if donor_id:
            matched += 1
        else:
            unmatched += 1

    db.commit()
    return PledgeImportSummary(
        donors_imported=donors_imported,
        pledges_imported=pledges_imported,
        donations_imported=donations_imported,
        pledges_matched=matched,
        pledges_unmatched=unmatched,
    )


def _donation_totals_by_donor(db: Session, campaign_id: int) -> dict[str, float]:
    totals: dict[str, float] = {}
    for donation in db.scalars(
        select(PledgeCampaignDonation).where(PledgeCampaignDonation.campaign_id == campaign_id)
    ):
        if donation.donor_id:
            totals[donation.donor_id] = totals.get(donation.donor_id, 0.0) + donation.net_amount
    return totals


@router.get(
    "/{campaign_id}/pledges", response_model=list[PledgeOut],
    dependencies=[Depends(require_permission("pledge-campaign-pledges"))],
)
def list_pledges(campaign_id: int, db: Session = Depends(get_db)) -> list[PledgeOut]:
    _get_campaign(db, campaign_id)
    totals_by_donor = _donation_totals_by_donor(db, campaign_id)
    pledges = db.scalars(
        select(Pledge)
        .where(Pledge.campaign_id == campaign_id)
        .order_by(Pledge.due_date.asc().nulls_last())
    )
    out = []
    for p in pledges:
        match = p.match
        donor_id = match.donor_id if match else None
        out.append(
            PledgeOut(
                id=p.id,
                campaign_id=p.campaign_id,
                submission_id=p.submission_id,
                first_name=p.first_name,
                last_name=p.last_name,
                email=p.email,
                date_submitted=p.date_submitted,
                initial_amount=p.initial_amount,
                due_date=p.due_date,
                monthly_amount=p.monthly_amount,
                contact_method=p.contact_method,
                donor_id=donor_id,
                match_source=match.match_source if match else None,
                actual_amount=totals_by_donor.get(donor_id, 0.0) if donor_id else 0.0,
            )
        )
    return out


@router.put(
    "/{campaign_id}/pledges/{pledge_id}/match", response_model=PledgeOut,
    dependencies=[Depends(require_permission("pledge-campaign-pledges"))],
)
def set_pledge_match(
    campaign_id: int, pledge_id: int, payload: PledgeMatchUpdate, db: Session = Depends(get_db)
) -> PledgeOut:
    pledge = db.get(Pledge, pledge_id)
    if pledge is None or pledge.campaign_id != campaign_id:
        raise HTTPException(404, "Pledge not found.")
    if payload.donor_id and db.get(Donor, payload.donor_id) is None:
        raise HTTPException(400, "Unknown donor_id.")

    match = pledge.match
    if match is None:
        match = PledgeDonorMatch(pledge_id=pledge.id)
        db.add(match)
    match.donor_id = payload.donor_id
    match.match_source = "manual"
    db.commit()

    totals_by_donor = _donation_totals_by_donor(db, campaign_id)
    return PledgeOut(
        id=pledge.id,
        campaign_id=pledge.campaign_id,
        submission_id=pledge.submission_id,
        first_name=pledge.first_name,
        last_name=pledge.last_name,
        email=pledge.email,
        date_submitted=pledge.date_submitted,
        initial_amount=pledge.initial_amount,
        due_date=pledge.due_date,
        monthly_amount=pledge.monthly_amount,
        contact_method=pledge.contact_method,
        donor_id=match.donor_id,
        match_source=match.match_source,
        actual_amount=totals_by_donor.get(match.donor_id, 0.0) if match.donor_id else 0.0,
    )


@router.get(
    "/{campaign_id}/donations", response_model=list[PledgeCampaignDonationOut],
    dependencies=[Depends(require_permission("pledge-campaign-actuals"))],
)
def list_donations(campaign_id: int, db: Session = Depends(get_db)) -> list[PledgeCampaignDonation]:
    _get_campaign(db, campaign_id)
    return list(
        db.scalars(
            select(PledgeCampaignDonation)
            .where(PledgeCampaignDonation.campaign_id == campaign_id)
            .order_by(PledgeCampaignDonation.received_date.asc().nulls_last())
        )
    )


@router.get(
    "/{campaign_id}/dashboard", response_model=PledgeDashboardOut,
    dependencies=[Depends(require_permission("pledge-campaign-status"))],
)
def get_dashboard(campaign_id: int, db: Session = Depends(get_db)) -> PledgeDashboardOut:
    campaign = _get_campaign(db, campaign_id)
    pledges = list(db.scalars(select(Pledge).where(Pledge.campaign_id == campaign_id)))
    donations = list(
        db.scalars(
            select(PledgeCampaignDonation)
            .where(PledgeCampaignDonation.campaign_id == campaign_id)
            .order_by(PledgeCampaignDonation.received_date.asc().nulls_last())
        )
    )

    total_pledged = round(sum(p.initial_amount for p in pledges), 2)
    total_actual = round(sum(d.net_amount for d in donations), 2)
    total_raised = round(campaign.starting_balance + total_actual, 2)
    goal = campaign.goal_amount

    # Timeline: cumulative amount raised over time, starting from the
    # campaign's pre-tracking starting balance. Simpler and more directly
    # meaningful for a "are we tracking to goal" chart than reproducing the
    # spreadsheet's per-row MAX(pledge, actual) running total.
    running = campaign.starting_balance
    timeline: list[PledgeDashboardPoint] = []
    for d in donations:
        if d.received_date is None:
            continue
        running += d.net_amount
        timeline.append(PledgeDashboardPoint(date=d.received_date, running_total=round(running, 2)))

    return PledgeDashboardOut(
        campaign=campaign,
        total_pledged=total_pledged,
        total_actual=total_actual,
        total_raised=total_raised,
        pledge_count=len(pledges),
        goal_amount=goal,
        percent_of_goal=round((total_raised / goal) * 100, 1) if goal else 0.0,
        timeline=timeline,
    )
