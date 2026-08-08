"""Setup > Integrations Status - one admin-only page listing every external
API integration the app syncs from (Planning Center People/Giving/Pledge
Form, Stripe, Plaid): what it does, when it last succeeded, what broke last
time (if anything), and whether its credentials/scheduled-sync secret are
even configured. Read-only - triggering a sync stays on each integration's
own page (Sync Now button), this is purely a status dashboard.

Deliberately admin-only (not a grantable permission like most pages, see
deps.GRANTABLE_PERMISSIONS) since it surfaces which credentials are/aren't
configured - the same sensitivity level as the Users page.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..deps import require_admin
from ..schemas import IntegrationStatusOut
from ..services import integration_status
from . import donations, pledge_campaigns, plaid_sync, reimbursements, stripe_sync

router = APIRouter(
    prefix="/api/integrations", tags=["integrations"], dependencies=[Depends(require_admin)]
)


def _build_status(db: Session) -> list[IntegrationStatusOut]:
    settings = get_settings()
    pco_configured = bool(settings.pco_app_id and settings.pco_secret)
    entries = [
        dict(
            key="pco_people",
            label="Planning Center - People",
            description="Syncs every PCO Person (any status) into the login allowlist for the "
            "Reimbursement portal.",
            sync_now_endpoint="POST /api/pco/people/sync",
            scheduled_sync_endpoint="POST /api/pco/people/scheduled-sync",
            last_synced_key=reimbursements.PCO_PEOPLE_LAST_SYNCED_KEY,
            configured=pco_configured,
            scheduled_sync_configured=bool(settings.pco_people_sync_secret),
        ),
        dict(
            key="pco_giving_donors",
            label="Planning Center - Giving Donors",
            description="Syncs the persistent Giving App donor list, shared across every pledge "
            "campaign.",
            sync_now_endpoint="POST /api/pco/giving/donors/sync",
            scheduled_sync_endpoint="POST /api/pco/giving/donors/scheduled-sync",
            last_synced_key=pledge_campaigns.PCO_GIVING_DONORS_LAST_SYNCED_KEY,
            configured=pco_configured,
            scheduled_sync_configured=bool(settings.pco_giving_sync_secret),
        ),
        dict(
            key="pco_giving_donations",
            label="Planning Center - Giving Donations",
            description="Syncs donations received in the trailing lookback window "
            f"({settings.pco_giving_sync_lookback_days} days).",
            sync_now_endpoint="POST /api/pco/giving/donations/sync",
            scheduled_sync_endpoint="POST /api/pco/giving/donations/scheduled-sync",
            last_synced_key=donations.PCO_GIVING_DONATIONS_LAST_SYNCED_KEY,
            configured=pco_configured,
            scheduled_sync_configured=bool(settings.pco_giving_sync_secret),
        ),
        dict(
            key="pco_pledge_form",
            label="Planning Center - Pledge Form Sync",
            description="Syncs pledge submissions for every campaign configured to sync from a "
            "PCO Form.",
            sync_now_endpoint="POST /api/pco/forms/{campaign_id}/sync",
            scheduled_sync_endpoint="POST /api/pco/forms/scheduled-sync",
            last_synced_key=pledge_campaigns.PCO_PLEDGE_FORM_LAST_SYNCED_KEY,
            configured=pco_configured,
            scheduled_sync_configured=bool(settings.pco_pledge_form_sync_secret),
        ),
        dict(
            key="stripe",
            label="Stripe",
            description="Syncs Stripe payouts/payments/charges/refunds for bank reconciliation.",
            sync_now_endpoint="POST /api/stripe/sync",
            scheduled_sync_endpoint="POST /api/stripe/scheduled-sync",
            last_synced_key=stripe_sync.LAST_SYNCED_KEY,
            configured=bool(settings.stripe_secret_key),
            scheduled_sync_configured=bool(settings.stripe_sync_secret),
        ),
        dict(
            key="plaid",
            label="Plaid",
            description="Syncs connected bank account transactions.",
            sync_now_endpoint="POST /api/plaid/sync",
            scheduled_sync_endpoint="POST /api/plaid/scheduled-sync",
            last_synced_key=plaid_sync.LAST_SYNCED_KEY,
            configured=bool(settings.plaid_client_id and settings.plaid_secret),
            scheduled_sync_configured=bool(settings.plaid_sync_secret),
        ),
    ]

    out = []
    for entry in entries:
        last_synced_at, last_error, last_error_at = integration_status.read_status(
            db, entry["last_synced_key"]
        )
        out.append(
            IntegrationStatusOut(
                key=entry["key"],
                label=entry["label"],
                description=entry["description"],
                sync_now_endpoint=entry["sync_now_endpoint"],
                scheduled_sync_endpoint=entry["scheduled_sync_endpoint"],
                last_synced_at=last_synced_at,
                last_error=last_error,
                last_error_at=last_error_at,
                configured=entry["configured"],
                scheduled_sync_configured=entry["scheduled_sync_configured"],
            )
        )
    return out


@router.get("/status", response_model=list[IntegrationStatusOut])
def get_integrations_status(db: Session = Depends(get_db)) -> list[IntegrationStatusOut]:
    return _build_status(db)
