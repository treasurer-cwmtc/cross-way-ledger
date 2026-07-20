from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user, require_permission
from ..models import Donation, Donor, Pledge, PledgeCampaign, PledgeDonorMatch, User
from ..schemas import (
    DonationOut,
    DonorImportSummary,
    PledgeCampaignCreate,
    PledgeCampaignOut,
    PledgeCampaignUpdate,
    PledgeDashboardOut,
    PledgeDashboardPoint,
    PledgeImportSummary,
    PledgeMatchUpdate,
    PledgeOut,
)
from ..services.pledge_import import match_pledge_to_donor, parse_donor_csv, parse_pledge_csv

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


def _rematch_campaign_pledges(db: Session, campaign_id: int) -> tuple[int, int]:
    """(Re-)run auto-matching for every pledge in this campaign that doesn't
    already have a manual match. Never touches a manual match. Returns
    (matched_count, unmatched_count)."""
    donor_email_map = {d.email: d.donor_id for d in db.scalars(select(Donor)) if d.email}
    pledges = list(db.scalars(select(Pledge).where(Pledge.campaign_id == campaign_id)))
    existing_matches = {
        m.pledge_id: m
        for m in db.scalars(
            select(PledgeDonorMatch).join(Pledge).where(Pledge.campaign_id == campaign_id)
        )
    }
    matched = 0
    unmatched = 0
    for pledge in pledges:
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
    return matched, unmatched


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
    "/{campaign_id}/import/pledges", response_model=PledgeImportSummary,
    dependencies=[Depends(require_permission("pledge-campaign-status"))],
)
async def import_pledges(
    campaign_id: int,
    fund_name: str = Form(...),
    pledge_file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> PledgeImportSummary:
    """Step 2 of the wizard: which fund (chosen from GET /api/donations/funds
    - the donations already on file, step 1) this campaign tracks, plus the
    pledge form export. Upserts pledges (deduped on submission_id) and
    attempts matching against whatever donors currently exist - if donors
    haven't been imported yet, step 3 re-runs this once they have."""
    campaign = _get_campaign(db, campaign_id)
    campaign.fund_name = fund_name

    rows = parse_pledge_csv(await _read_csv(pledge_file))
    existing = {
        p.submission_id: p
        for p in db.scalars(select(Pledge).where(Pledge.campaign_id == campaign_id))
    }
    imported = 0
    for row in rows:
        pledge = existing.get(row.submission_id)
        if pledge is None:
            pledge = Pledge(campaign_id=campaign_id, submission_id=row.submission_id)
            db.add(pledge)
            existing[row.submission_id] = pledge
        pledge.first_name = row.first_name
        pledge.last_name = row.last_name
        pledge.email = row.email
        pledge.date_submitted = row.date_submitted
        pledge.initial_amount = row.initial_amount
        pledge.due_date = row.due_date
        pledge.monthly_amount = row.monthly_amount
        pledge.contact_method = row.contact_method
        imported += 1
    db.commit()

    matched, unmatched = _rematch_campaign_pledges(db, campaign_id)
    return PledgeImportSummary(
        pledges_imported=imported, pledges_matched=matched, pledges_unmatched=unmatched
    )


@router.post(
    "/{campaign_id}/import/donors", response_model=DonorImportSummary,
    dependencies=[Depends(require_permission("pledge-campaign-status"))],
)
async def import_donors_for_campaign(
    campaign_id: int, donor_file: UploadFile = File(...), db: Session = Depends(get_db)
) -> DonorImportSummary:
    """Step 3 of the wizard: the donor list (general, not campaign-scoped -
    shared with every campaign and the Config > Giving App - Donors page).
    Upserts by donor_id, then re-runs matching for this campaign's pledges
    now that fresh donor data has arrived - a pledge left unmatched in step
    2 can resolve here without re-uploading anything."""
    _get_campaign(db, campaign_id)

    rows = parse_donor_csv(await _read_csv(donor_file))
    existing = {d.donor_id: d for d in db.scalars(select(Donor))}
    imported = 0
    for row in rows:
        donor = existing.get(row.donor_id)
        if donor is None:
            donor = Donor(donor_id=row.donor_id)
            db.add(donor)
            existing[row.donor_id] = donor
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
        imported += 1
    db.commit()

    matched, unmatched = _rematch_campaign_pledges(db, campaign_id)
    return DonorImportSummary(
        donors_imported=imported, pledges_matched=matched, pledges_unmatched=unmatched
    )


def _donation_totals_by_donor(db: Session, fund_name: str) -> dict[str, float]:
    totals: dict[str, float] = {}
    for donation in db.scalars(select(Donation).where(Donation.fund == fund_name)):
        if donation.donor_id:
            totals[donation.donor_id] = totals.get(donation.donor_id, 0.0) + donation.net_amount
    return totals


@router.get(
    "/{campaign_id}/pledges", response_model=list[PledgeOut],
    dependencies=[Depends(require_permission("pledge-campaign-pledges"))],
)
def list_pledges(campaign_id: int, db: Session = Depends(get_db)) -> list[PledgeOut]:
    campaign = _get_campaign(db, campaign_id)
    totals_by_donor = _donation_totals_by_donor(db, campaign.fund_name)
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
    campaign = _get_campaign(db, campaign_id)
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

    totals_by_donor = _donation_totals_by_donor(db, campaign.fund_name)
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
    "/{campaign_id}/donations", response_model=list[DonationOut],
    dependencies=[Depends(require_permission("pledge-campaign-actuals"))],
)
def list_donations(campaign_id: int, db: Session = Depends(get_db)) -> list[Donation]:
    campaign = _get_campaign(db, campaign_id)
    return list(
        db.scalars(
            select(Donation)
            .where(Donation.fund == campaign.fund_name)
            .order_by(Donation.received_date.asc().nulls_last())
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
            select(Donation)
            .where(Donation.fund == campaign.fund_name)
            .order_by(Donation.received_date.asc().nulls_last())
        )
    )

    total_pledged = round(sum(p.initial_amount for p in pledges), 2)
    total_actual = round(sum(d.net_amount for d in donations), 2)
    total_raised = round(campaign.starting_balance + total_actual, 2)
    goal = campaign.goal_amount

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
        donation_count=len(donations),
        goal_amount=goal,
        percent_of_goal=round((total_raised / goal) * 100, 1) if goal else 0.0,
        timeline=timeline,
    )
