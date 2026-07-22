from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user, require_any_permission, require_permission
from ..models import Donation, Donor, Pledge, PledgeCampaign, PledgeDonorMatch, User
from ..schemas import (
    CampaignDetailOut,
    CampaignDetailRow,
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
    source_file_name: str = Form(""),
    source_file_link: str = Form(""),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PledgeImportSummary:
    """Step 2 of the wizard: which fund (chosen from GET /api/donations/funds
    - the donations already on file, step 1) this campaign tracks, plus the
    pledge form export. Upserts pledges (deduped on submission_id) and
    attempts matching against whatever donors currently exist - if donors
    haven't been imported yet, step 3 re-runs this once they have.

    source_file_name/source_file_link identify the Drive copy of the CSV
    the frontend archived before calling this endpoint (see
    lib/googleDrive.ts::uploadCampaignImportFile) - stored on every row
    touched by this import so a treasurer can trace any pledge back to the
    exact file it came from. Left blank if the Drive upload failed or
    wasn't configured; that never blocks the actual data import."""
    campaign = _get_campaign(db, campaign_id)
    campaign.fund_name = fund_name

    rows = parse_pledge_csv(await _read_csv(pledge_file))
    existing = {
        p.submission_id: p
        for p in db.scalars(select(Pledge).where(Pledge.campaign_id == campaign_id))
    }
    new_ids: list[str] = []
    updated_ids: list[str] = []
    for row in rows:
        pledge = existing.get(row.submission_id)
        if pledge is None:
            pledge = Pledge(campaign_id=campaign_id, submission_id=row.submission_id)
            db.add(pledge)
            existing[row.submission_id] = pledge
            new_ids.append(row.submission_id)
        else:
            updated_ids.append(row.submission_id)
        pledge.first_name = row.first_name
        pledge.last_name = row.last_name
        pledge.email = row.email
        pledge.date_submitted = row.date_submitted
        pledge.initial_amount = row.initial_amount
        pledge.due_date = row.due_date
        pledge.monthly_amount = row.monthly_amount
        pledge.contact_method = row.contact_method
        if source_file_name:
            pledge.source_file_name = source_file_name
            pledge.source_file_link = source_file_link
    db.commit()

    matched, unmatched = _rematch_campaign_pledges(db, campaign_id)

    totals_by_donor = _donation_totals_by_donor(db, campaign.fund_name)
    donors_by_id = {d.donor_id: d for d in db.scalars(select(Donor))}
    matched_donor_ids = _campaign_matched_donor_ids(db, campaign_id)

    def _out(submission_id: str) -> PledgeOut:
        pledge = existing[submission_id]
        match = pledge.match
        donor_id = match.donor_id if match else None
        actual = _household_actual_amount(totals_by_donor, donors_by_id, donor_id, matched_donor_ids)
        return _pledge_out(pledge, match, actual, user.hide_donor_names)

    return PledgeImportSummary(
        pledges_imported=len(new_ids) + len(updated_ids),
        pledges_matched=matched,
        pledges_unmatched=unmatched,
        new_pledges=[_out(sid) for sid in new_ids],
        updated_pledges=[_out(sid) for sid in updated_ids],
    )


@router.post(
    "/{campaign_id}/import/donors", response_model=DonorImportSummary,
    dependencies=[Depends(require_permission("pledge-campaign-status"))],
)
async def import_donors_for_campaign(
    campaign_id: int,
    donor_file: UploadFile = File(...),
    source_file_name: str = Form(""),
    source_file_link: str = Form(""),
    db: Session = Depends(get_db),
) -> DonorImportSummary:
    """Step 3 of the wizard: the donor list (general, not campaign-scoped -
    shared with every campaign and the Config > Giving App - Donors page).
    Upserts by donor_id, then re-runs matching for this campaign's pledges
    now that fresh donor data has arrived - a pledge left unmatched in step
    2 can resolve here without re-uploading anything. source_file_name/link
    identify the Drive-archived copy of this CSV - see import_pledges."""
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
        if source_file_name:
            donor.source_file_name = source_file_name
            donor.source_file_link = source_file_link
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


def _donation_totals_by_donor_or_none(db: Session, fund_name: str) -> dict[str | None, float]:
    """Same as _donation_totals_by_donor but keeps a None-keyed bucket for
    donations that never matched any donor record, so the Details tab can
    still surface that money instead of silently dropping it."""
    totals: dict[str | None, float] = {}
    for donation in db.scalars(select(Donation).where(Donation.fund == fund_name)):
        totals[donation.donor_id] = totals.get(donation.donor_id, 0.0) + donation.net_amount
    return totals


def _campaign_matched_donor_ids(db: Session, campaign_id: int) -> set[str]:
    """Every donor_id currently matched to some pledge in this campaign -
    used to decide whether a joint giver "belongs" to this pledge (folded
    in) or has their own separate pledge (left alone, since combining two
    pledges' actuals would be ambiguous)."""
    return {
        m.donor_id
        for m in db.scalars(
            select(PledgeDonorMatch).join(Pledge).where(Pledge.campaign_id == campaign_id)
        )
        if m.donor_id
    }


def _joint_giver_donor_id(donors_by_id: dict[str, Donor], donor_id: str | None, matched_donor_ids: set[str]) -> str | None:
    """The donor_id whose donations should be folded into donor_id's pledge
    - the joint giver, but only when that spouse doesn't have a separate
    pledge of their own in this campaign (otherwise it's ambiguous whose
    pledge their gift belongs under, so both stay independent)."""
    donor = donors_by_id.get(donor_id) if donor_id else None
    jg = donor.joint_giver_id if donor else ""
    if jg and jg not in matched_donor_ids:
        return jg
    return None


def _household_actual_amount(
    totals_by_donor: dict[str, float],
    donors_by_id: dict[str, Donor],
    donor_id: str | None,
    matched_donor_ids: set[str],
) -> float:
    """A pledge's Received Amount: the matched donor's own donations, plus
    - when eligible - their joint giver's, so a household where one spouse
    pledges and the other gives doesn't show the pledge as unreceived."""
    if not donor_id:
        return 0.0
    total = totals_by_donor.get(donor_id, 0.0)
    jg_id = _joint_giver_donor_id(donors_by_id, donor_id, matched_donor_ids)
    if jg_id:
        total += totals_by_donor.get(jg_id, 0.0)
    return round(total, 2)


def _pledge_out(p: Pledge, match: PledgeDonorMatch | None, actual_amount: float, redact: bool) -> PledgeOut:
    """Build a PledgeOut, redacting the donor's name/email (real PII) to ""
    for a user with hide_donor_names set. Everything else - donor_id,
    amounts, match status - stays visible, since redaction is about a
    specific person's identity, not the pledge's financial detail."""
    return PledgeOut(
        id=p.id,
        campaign_id=p.campaign_id,
        submission_id=p.submission_id,
        first_name="" if redact else p.first_name,
        last_name="" if redact else p.last_name,
        email="" if redact else p.email,
        date_submitted=p.date_submitted,
        initial_amount=p.initial_amount,
        due_date=p.due_date,
        monthly_amount=p.monthly_amount,
        contact_method=p.contact_method,
        donor_id=match.donor_id if match else None,
        match_source=match.match_source if match else None,
        actual_amount=actual_amount,
        source_file_name=p.source_file_name,
        source_file_link=p.source_file_link,
    )


def _donation_out(d: Donation, donor: Donor | None, redact: bool) -> DonationOut:
    return DonationOut(
        id=d.id,
        donor_id=d.donor_id,
        donor_first_name="" if redact or donor is None else donor.first_name,
        donor_last_name="" if redact or donor is None else donor.last_name,
        donor_email="" if redact or donor is None else donor.email,
        fund=d.fund,
        received_date=d.received_date,
        amount=d.amount,
        net_amount=d.net_amount,
        method=d.method,
        source_file_name=d.source_file_name,
        source_file_link=d.source_file_link,
    )


@router.put(
    "/{campaign_id}/pledges/{pledge_id}/match", response_model=PledgeOut,
    dependencies=[Depends(require_permission("pledge-campaign-pledges"))],
)
def set_pledge_match(
    campaign_id: int,
    pledge_id: int,
    payload: PledgeMatchUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
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
    donors_by_id = {d.donor_id: d for d in db.scalars(select(Donor))}
    matched_donor_ids = _campaign_matched_donor_ids(db, campaign_id)
    actual = _household_actual_amount(totals_by_donor, donors_by_id, match.donor_id, matched_donor_ids)
    return _pledge_out(pledge, match, actual, user.hide_donor_names)


@router.get(
    "/{campaign_id}/details", response_model=list[CampaignDetailRow],
    dependencies=[Depends(require_any_permission("pledge-campaign-pledges", "pledge-campaign-actuals"))],
)
def list_details(
    campaign_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> list[CampaignDetailRow]:
    """One row per pledge, PLUS a synthesized row for every donor who gave
    to this fund but never submitted a pledge - so giving from people who
    didn't pledge still shows up (pledged_amount 0, has_pledge False, no
    due_date). Donations that never matched any donor at all are grouped
    into one donor_id=None row so their total still reconciles against the
    dashboard's total_actual instead of silently disappearing.

    A pledge's actual_amount folds in its joint giver's donations when that
    spouse has no separate pledge of their own here - see
    _household_actual_amount - and that spouse's donor_id is then excluded
    from the "gave without pledge" rows below, since their giving is
    already reflected in the pledge row instead."""
    campaign = _get_campaign(db, campaign_id)
    redact = user.hide_donor_names
    totals_by_donor = _donation_totals_by_donor_or_none(db, campaign.fund_name)
    donors_by_id = {d.donor_id: d for d in db.scalars(select(Donor))}

    pledges = list(
        db.scalars(select(Pledge).where(Pledge.campaign_id == campaign_id))
    )
    matched_donor_ids: set[str] = set()
    pledge_donor: dict[int, str | None] = {}
    for p in pledges:
        match = p.match
        donor_id = match.donor_id if match and match.donor_id else None
        pledge_donor[p.id] = donor_id
        if donor_id:
            matched_donor_ids.add(donor_id)

    folded_donor_ids: set[str] = set()
    rows: list[CampaignDetailRow] = []
    for p in pledges:
        donor_id = pledge_donor[p.id]
        donor = donors_by_id.get(donor_id) if donor_id else None
        jg_id = _joint_giver_donor_id(donors_by_id, donor_id, matched_donor_ids)
        if jg_id:
            folded_donor_ids.add(jg_id)
        rows.append(
            CampaignDetailRow(
                key=f"pledge:{p.id}",
                donor_id=donor_id,
                first_name="" if redact else p.first_name,
                last_name="" if redact else p.last_name,
                email="" if redact else p.email,
                pledged_amount=p.initial_amount,
                actual_amount=_household_actual_amount(totals_by_donor, donors_by_id, donor_id, matched_donor_ids),
                due_date=p.due_date,
                has_pledge=True,
                joint_giver_id=donor.joint_giver_id if donor else "",
                joint_giver_first_name="" if redact or donor is None else donor.joint_giver_first_name,
                joint_giver_last_name="" if redact or donor is None else donor.joint_giver_last_name,
                source_file_name=p.source_file_name,
                source_file_link=p.source_file_link,
            )
        )

    excluded_donor_ids = matched_donor_ids | folded_donor_ids
    for donor_id, total in totals_by_donor.items():
        if donor_id is not None and donor_id in excluded_donor_ids:
            continue
        donor = donors_by_id.get(donor_id) if donor_id else None
        rows.append(
            CampaignDetailRow(
                key=f"donor:{donor_id or 'none'}",
                donor_id=donor_id,
                first_name="" if redact or donor is None else donor.first_name,
                last_name="" if redact or donor is None else donor.last_name,
                email="" if redact or donor is None else donor.email,
                pledged_amount=0.0,
                actual_amount=round(total, 2),
                due_date=None,
                has_pledge=False,
                joint_giver_id=donor.joint_giver_id if donor else "",
                joint_giver_first_name="" if redact or donor is None else donor.joint_giver_first_name,
                joint_giver_last_name="" if redact or donor is None else donor.joint_giver_last_name,
                source_file_name=donor.source_file_name if donor else "",
                source_file_link=donor.source_file_link if donor else "",
            )
        )

    rows.sort(key=lambda r: (r.due_date is None, r.due_date or date.max))
    return rows


@router.get(
    "/{campaign_id}/details/{key}", response_model=CampaignDetailOut,
    dependencies=[Depends(require_any_permission("pledge-campaign-pledges", "pledge-campaign-actuals"))],
)
def get_detail(
    campaign_id: int,
    key: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CampaignDetailOut:
    """Full detail for the Details tab's click-to-expand popup, for either
    kind of row: a pledge (key "pledge:<id>"), or a pledge-less giver (key
    "donor:<donor_id>" or "donor:none" for the unmatched-donation bucket).
    A pledge's gift history folds in its joint giver's gifts under the same
    rule as list_details' actual_amount (see _joint_giver_donor_id)."""
    campaign = _get_campaign(db, campaign_id)
    redact = user.hide_donor_names

    if key.startswith("pledge:"):
        pledge = db.get(Pledge, int(key.removeprefix("pledge:")))
        if pledge is None or pledge.campaign_id != campaign_id:
            raise HTTPException(404, "Pledge not found.")
        match = pledge.match
        donor_id = match.donor_id if match and match.donor_id else None
        donors_by_id = {d.donor_id: d for d in db.scalars(select(Donor))}
        matched_donor_ids = _campaign_matched_donor_ids(db, campaign_id)
        # An unmatched pledge (donor_id None) has no gift history at all -
        # NOT "every unmatched donation in this fund" (that's the separate
        # donor:none bucket, its own distinct row on the Details tab).
        if donor_id is None:
            gifts: list[Donation] = []
        else:
            jg_id = _joint_giver_donor_id(donors_by_id, donor_id, matched_donor_ids)
            gifts = _donation_history(db, campaign.fund_name, [donor_id, jg_id] if jg_id else [donor_id])
        total = round(sum(g.net_amount for g in gifts), 2)
        donor = donors_by_id.get(donor_id) if donor_id else None
        pledge_out = _pledge_out(pledge, match, total, redact)
        return CampaignDetailOut(
            pledge=pledge_out,
            donor_id=donor_id,
            joint_giver_id=donor.joint_giver_id if donor else "",
            joint_giver_first_name="" if redact or donor is None else donor.joint_giver_first_name,
            joint_giver_last_name="" if redact or donor is None else donor.joint_giver_last_name,
            first_name=pledge_out.first_name,
            last_name=pledge_out.last_name,
            email=pledge_out.email,
            gifts=[_donation_out(g, donors_by_id.get(g.donor_id) if g.donor_id else None, redact) for g in gifts],
        )

    if key.startswith("donor:"):
        raw = key.removeprefix("donor:")
        donor_id = None if raw == "none" else raw
        gifts = _donation_history(db, campaign.fund_name, [donor_id])
        donor = db.get(Donor, donor_id) if donor_id else None
        return CampaignDetailOut(
            pledge=None,
            donor_id=donor_id,
            joint_giver_id=donor.joint_giver_id if donor else "",
            joint_giver_first_name="" if redact or donor is None else donor.joint_giver_first_name,
            joint_giver_last_name="" if redact or donor is None else donor.joint_giver_last_name,
            first_name="" if redact or donor is None else donor.first_name,
            last_name="" if redact or donor is None else donor.last_name,
            email="" if redact or donor is None else donor.email,
            gifts=[_donation_out(g, donor, redact) for g in gifts],
        )

    raise HTTPException(404, "Unknown detail key.")


def _donation_history(db: Session, fund_name: str, donor_ids: list[str | None]) -> list[Donation]:
    filters = [Donation.donor_id.is_(None) if d is None else Donation.donor_id == d for d in donor_ids]
    return list(
        db.scalars(
            select(Donation)
            .where(Donation.fund == fund_name, or_(*filters))
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

    # Money already given by someone who never submitted a pledge (e.g.
    # Lijoy gave $22,000 but has no pledge on file) still counts toward the
    # goal - it's already in hand, which is a stronger commitment than a
    # pledge. Uses the same donor-matched/joint-giver-folded exclusion set
    # as the Details tab so this never double-counts a gift that's already
    # folded into someone else's pledge total.
    donors_by_id = {d.donor_id: d for d in db.scalars(select(Donor))}
    matched_donor_ids = _campaign_matched_donor_ids(db, campaign_id)
    folded_donor_ids = {
        jg_id
        for donor_id in matched_donor_ids
        if (jg_id := _joint_giver_donor_id(donors_by_id, donor_id, matched_donor_ids))
    }
    excluded_donor_ids = matched_donor_ids | folded_donor_ids
    totals_by_donor_or_none = _donation_totals_by_donor_or_none(db, campaign.fund_name)
    unpledged_actual = round(
        sum(v for k, v in totals_by_donor_or_none.items() if k not in excluded_donor_ids), 2
    )

    # One point per day that had EITHER a pledge submission or a donation -
    # not just donation dates, so there's more to see on the x-axis than a
    # sparse "only when money actually arrived" line. Both running totals
    # deliberately exclude starting_balance (it's shown as its own KPI card
    # instead), so the chart and the progress bar both always read as
    # "since tracking began," not "since forever."
    pledged_by_date: dict[date, float] = {}
    for p in pledges:
        if p.date_submitted is None:
            continue
        d = p.date_submitted.date()
        pledged_by_date[d] = pledged_by_date.get(d, 0.0) + p.initial_amount

    actual_by_date: dict[date, float] = {}
    for donation in donations:
        if donation.received_date is None:
            continue
        actual_by_date[donation.received_date] = (
            actual_by_date.get(donation.received_date, 0.0) + donation.net_amount
        )

    all_dates = sorted(set(pledged_by_date) | set(actual_by_date))
    running_pledged = 0.0
    running_actual = 0.0
    timeline: list[PledgeDashboardPoint] = []
    for d in all_dates:
        running_pledged += pledged_by_date.get(d, 0.0)
        running_actual += actual_by_date.get(d, 0.0)
        timeline.append(
            PledgeDashboardPoint(
                date=d,
                running_pledged_total=round(running_pledged, 2),
                running_actual_total=round(running_actual, 2),
                pledged_amount=round(pledged_by_date.get(d, 0.0), 2),
                actual_amount=round(actual_by_date.get(d, 0.0), 2),
            )
        )

    return PledgeDashboardOut(
        campaign=campaign,
        total_pledged=total_pledged,
        total_actual=total_actual,
        total_raised=total_raised,
        unpledged_actual=unpledged_actual,
        pledge_count=len(pledges),
        donation_count=len(donations),
        goal_amount=goal,
        # Progress toward goal is judged against money actually raised since
        # tracking began (total_actual), not total_raised - starting_balance
        # is real money but predates this campaign's own tracking, and
        # mixing it in here would make the progress bar disagree with the
        # chart directly below it.
        percent_of_goal=round((total_actual / goal) * 100, 1) if goal else 0.0,
        timeline=timeline,
    )
