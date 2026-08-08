"""Planning Center People sync - the login allowlist for the Reimbursement
portal, plus the optional PCO List-based gate on top of it. Business logic
stays defined in routers/reimbursements.py (intertwined with that module's
OTP/assignment logic - is_allowed_reimbursement_submitter, the gate-list
AppSetting key, etc.); this module only registers that same logic at the
app's standardized /api/pco/people/... path. See routers/pco/__init__.py.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ...deps import require_permission
from ...models import PcoPerson
from ...schemas import (
    PcoLastSyncedOut,
    PcoListOption,
    PcoPeopleImportSummary,
    PcoPersonOut,
    ReimbursementGateListOut,
    ReimbursementGateListUpdate,
)
from .. import reimbursements

router = APIRouter(prefix="/api/pco/people", tags=["pco-people"])

_perm = Depends(require_permission("reimbursements"))

router.post(
    "/import", response_model=PcoPeopleImportSummary, dependencies=[_perm]
)(reimbursements.import_pco_people)

router.post(
    "/sync", response_model=PcoPeopleImportSummary, dependencies=[_perm]
)(reimbursements.sync_pco_people_now)

router.post(
    "/scheduled-sync",
    response_model=PcoPeopleImportSummary,
    dependencies=[Depends(reimbursements._verify_pco_people_sync_secret)],
)(reimbursements.scheduled_pco_people_sync)

router.get(
    "/last-synced", response_model=PcoLastSyncedOut, dependencies=[_perm]
)(reimbursements.get_pco_people_last_synced)

router.get(
    "", response_model=list[PcoPersonOut], dependencies=[_perm]
)(reimbursements.list_pco_people)

router.get(
    "/lists", response_model=list[PcoListOption], dependencies=[_perm]
)(reimbursements.list_pco_lists)

router.get(
    "/reimbursement-gate-list", response_model=ReimbursementGateListOut, dependencies=[_perm]
)(reimbursements.get_reimbursement_gate_list)

router.put(
    "/reimbursement-gate-list", response_model=ReimbursementGateListOut, dependencies=[_perm]
)(reimbursements.set_reimbursement_gate_list)
