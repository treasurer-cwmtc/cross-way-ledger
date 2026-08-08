"""Planning Center Giving sync - Donors and Donations, plus the Giving<->
People auto-link. Business logic stays defined in routers/pledge_campaigns.py
(donor sync/matching, since it's intertwined with campaign/pledge matching)
and routers/donations.py (donation sync/fund totals); this module only
registers that same logic at the app's standardized /api/pco/giving/...
path. See routers/pco/__init__.py.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException

from ...config import get_settings
from ...deps import require_permission
from ...schemas import (
    DonationSyncResult,
    DonorImportSummary,
    GivingPersonLinkOut,
    GivingPersonLinkUpdate,
    PcoLastSyncedOut,
)
from .. import donations, pledge_campaigns

router = APIRouter(prefix="/api/pco/giving", tags=["pco-giving"])

_perm = Depends(require_permission("pledge-campaign-status"))


def _verify_giving_sync_secret(x_sync_secret: str = Header(default="")) -> None:
    """Guards both donors/scheduled-sync and donations/scheduled-sync - one
    Cloud Scheduler secret covers all of Giving, same as before this
    endpoint reorganization (the two products share one PCO Giving App
    credential anyway)."""
    settings = get_settings()
    if not settings.pco_giving_sync_secret or x_sync_secret != settings.pco_giving_sync_secret:
        raise HTTPException(403, "Invalid or missing sync secret.")


# --- Donors --- #

router.post(
    "/donors/sync", response_model=DonorImportSummary, dependencies=[_perm]
)(pledge_campaigns.sync_donors_now)

router.post(
    "/donors/scheduled-sync",
    response_model=DonorImportSummary,
    dependencies=[Depends(_verify_giving_sync_secret)],
)(pledge_campaigns.scheduled_donors_sync)

router.get(
    "/donors/last-synced", response_model=PcoLastSyncedOut, dependencies=[_perm]
)(pledge_campaigns.get_donors_last_synced)

# --- Giving <-> People link --- #

router.get(
    "/people-links", response_model=list[GivingPersonLinkOut], dependencies=[_perm]
)(pledge_campaigns.list_giving_people_links)

router.put(
    "/people-links/{donor_id}", response_model=GivingPersonLinkOut, dependencies=[_perm]
)(pledge_campaigns.set_giving_people_link)

# --- Donations --- #

router.post(
    "/donations/sync", response_model=DonationSyncResult, dependencies=[_perm]
)(donations.sync_donations_now)

router.post(
    "/donations/scheduled-sync",
    response_model=DonationSyncResult,
    dependencies=[Depends(_verify_giving_sync_secret)],
)(donations.scheduled_donations_sync)

router.get(
    "/donations/last-synced", response_model=PcoLastSyncedOut, dependencies=[_perm]
)(donations.get_donations_last_synced)
