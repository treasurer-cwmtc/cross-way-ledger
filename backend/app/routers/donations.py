from datetime import datetime, timezone

import requests
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..deps import require_permission
from ..models import AppSetting, Donation
from ..schemas import DonationImportSummary, DonationSyncResult, FundSummary, PcoLastSyncedOut
from ..services import integration_status, pco_giving_sync
from ..services.pco_client import PcoNotConfiguredError
from ..services.pledge_import import parse_donation_csv
from .pledge_campaigns import _recompute_donor_totals

router = APIRouter(prefix="/api/donations", tags=["donations"])
# No router-level permission dependency (unlike before) - the scheduled-sync
# endpoint below must stay reachable without a user login (Cloud Scheduler
# has no JWT to present), so each route now declares its own dependency
# individually, same pattern as routers/stripe_sync.py.

PCO_GIVING_DONATIONS_LAST_SYNCED_KEY = "pco_giving_donations_last_synced_at"


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


@router.get(
    "/funds", response_model=list[FundSummary],
    dependencies=[Depends(require_permission("pledge-campaign-status"))],
)
def list_funds(db: Session = Depends(get_db)) -> list[FundSummary]:
    """Distinct funds actually present in the imported donations, with
    counts - this is what a campaign's fund is chosen from (step 2 of the
    wizard), never hand-typed."""
    return _fund_summary(db)


def _upsert_donations(
    db: Session, rows, source_file_name: str = "", source_file_link: str = ""
) -> int:
    """Upserts by dedup_key (skip-if-exists, never updates an existing row -
    Donations are treated as immutable once landed, see Donation's
    docstring) - shared by the CSV import path (import_donations below) and
    the live Giving API sync (POST /sync), same reasoning as
    pledge_campaigns._upsert_donors. source_file_name/link are left blank
    for API-sourced rows (there's no CSV to archive a copy of). Caller is
    responsible for db.commit()."""
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
                source_file_name=source_file_name,
                source_file_link=source_file_link,
            )
        )
        existing_keys.add(row.dedup_key)
        imported += 1
    return imported


@router.post(
    "/import", response_model=DonationImportSummary,
    dependencies=[Depends(require_permission("pledge-campaign-status"))],
)
async def import_donations(
    donation_file: UploadFile = File(...),
    source_file_name: str = Form(""),
    source_file_link: str = Form(""),
    db: Session = Depends(get_db),
) -> DonationImportSummary:
    """Step 1 of the pledge campaign wizard (now step 2, after choosing a
    campaign - see ImportWizard.tsx): the Giving App's donation export is
    the source of truth, imported in full and independent of any one
    campaign - a campaign just picks a fund from what shows up here. Safe
    to re-run; donations already on file (by the Giving App's own
    transaction id) are skipped. source_file_name/link identify the Drive-
    archived copy of this CSV - see import_pledges. Manual fallback path,
    kept intact alongside the live sync below (POST /sync) in case API
    access is ever lost."""
    rows = parse_donation_csv(await _read_csv(donation_file))
    imported = _upsert_donations(db, rows, source_file_name, source_file_link)
    db.commit()

    return DonationImportSummary(donations_imported=imported, funds=_fund_summary(db))


def _run_pco_donations_sync(db: Session) -> DonationSyncResult:
    settings = get_settings()
    try:
        rows = pco_giving_sync.fetch_donations(settings.pco_giving_sync_lookback_days)
    except PcoNotConfiguredError as e:
        integration_status.record_failure(db, PCO_GIVING_DONATIONS_LAST_SYNCED_KEY, str(e))
        db.commit()
        raise HTTPException(400, str(e))
    except requests.RequestException as e:
        integration_status.record_failure(
            db, PCO_GIVING_DONATIONS_LAST_SYNCED_KEY, f"Planning Center API error: {e}"
        )
        db.commit()
        raise HTTPException(502, f"Planning Center API error: {e}")

    imported = _upsert_donations(db, rows)

    now_iso = datetime.now(tz=timezone.utc).isoformat()
    setting = db.get(AppSetting, PCO_GIVING_DONATIONS_LAST_SYNCED_KEY)
    if setting is None:
        db.add(AppSetting(key=PCO_GIVING_DONATIONS_LAST_SYNCED_KEY, value=now_iso))
    else:
        setting.value = now_iso
    integration_status.clear_failure(db, PCO_GIVING_DONATIONS_LAST_SYNCED_KEY)
    db.commit()

    # A fresh batch of donations changes every affected donor's totals -
    # recompute here too (not just after a Donor sync) so Sync Donations
    # alone (without also running Sync Donors) still leaves totals correct.
    _recompute_donor_totals(db)
    db.commit()

    return DonationSyncResult(
        fetched=len(rows), imported=imported, funds=_fund_summary(db), last_synced_at=now_iso
    )


@router.post(
    "/sync", response_model=DonationSyncResult,
    dependencies=[Depends(require_permission("pledge-campaign-status"))],
)
def sync_donations_now(db: Session = Depends(get_db)) -> DonationSyncResult:
    return _run_pco_donations_sync(db)


def _verify_pco_giving_sync_secret(x_sync_secret: str = Header(default="")) -> None:
    settings = get_settings()
    if not settings.pco_giving_sync_secret or x_sync_secret != settings.pco_giving_sync_secret:
        raise HTTPException(403, "Invalid or missing sync secret.")


@router.post(
    "/scheduled-sync", response_model=DonationSyncResult,
    dependencies=[Depends(_verify_pco_giving_sync_secret)],
)
def scheduled_donations_sync(db: Session = Depends(get_db)) -> DonationSyncResult:
    return _run_pco_donations_sync(db)


@router.get(
    "/last-synced", response_model=PcoLastSyncedOut,
    dependencies=[Depends(require_permission("pledge-campaign-status"))],
)
def get_donations_last_synced(db: Session = Depends(get_db)) -> PcoLastSyncedOut:
    setting = db.get(AppSetting, PCO_GIVING_DONATIONS_LAST_SYNCED_KEY)
    return PcoLastSyncedOut(last_synced_at=setting.value if setting else None)


@router.delete(
    "/funds/{fund_name}", response_model=list[FundSummary],
    dependencies=[Depends(require_permission("pledge-campaign-status"))],
)
def delete_fund(fund_name: str, db: Session = Depends(get_db)) -> list[FundSummary]:
    """Bulk-deletes every Donation row with this fund name - a fund isn't
    its own record, just a grouping of donations, so "delete a fund" means
    deleting all of its donations. Real, permanent data; there is no
    per-fund undo short of restoring a backup."""
    db.execute(delete(Donation).where(Donation.fund == fund_name))
    db.commit()
    return _fund_summary(db)
