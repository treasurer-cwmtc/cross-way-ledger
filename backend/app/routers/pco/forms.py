"""Planning Center People Forms sync - lets a Pledge Campaign sync its
pledges from a live PCO Form instead of a manual CSV export. Business logic
stays defined in routers/pledge_campaigns.py (intertwined with Pledge/
PledgeDonorMatch/campaign matching); this module only registers that same
logic at the app's standardized /api/pco/forms/... path. See
routers/pco/__init__.py.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException

from ...config import get_settings
from ...deps import require_permission
from ...schemas import PcoFormFieldOption, PcoFormOption, PledgeFormSyncSummary
from .. import pledge_campaigns

router = APIRouter(prefix="/api/pco/forms", tags=["pco-forms"])

_perm = Depends(require_permission("pledge-campaign-status"))


def _verify_pledge_form_sync_secret(x_sync_secret: str = Header(default="")) -> None:
    settings = get_settings()
    if not settings.pco_pledge_form_sync_secret or x_sync_secret != settings.pco_pledge_form_sync_secret:
        raise HTTPException(403, "Invalid or missing sync secret.")


router.get(
    "", response_model=list[PcoFormOption], dependencies=[_perm]
)(pledge_campaigns.list_pco_forms)

router.get(
    "/{form_id}/fields", response_model=list[PcoFormFieldOption], dependencies=[_perm]
)(pledge_campaigns.list_pco_form_fields)

router.post(
    "/{campaign_id}/sync", response_model=PledgeFormSyncSummary, dependencies=[_perm]
)(pledge_campaigns.sync_campaign_pledges_now)

router.post(
    "/scheduled-sync",
    response_model=list[PledgeFormSyncSummary],
    dependencies=[Depends(_verify_pledge_form_sync_secret)],
)(pledge_campaigns.scheduled_pledges_sync)
