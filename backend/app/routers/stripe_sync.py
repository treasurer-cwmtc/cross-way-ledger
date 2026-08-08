import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..deps import require_permission
from ..models import AppSetting, StripeTransaction
from ..schemas import StripeSyncResult, StripeTransactionsOut
from ..services import integration_status
from ..services.stripe_sync import fetch_recent_transactions

LAST_SYNCED_KEY = "stripe_last_synced_at"

router = APIRouter(prefix="/api/stripe", tags=["stripe"])


def _run_sync(db: Session, days: int | None = None) -> StripeSyncResult:
    try:
        rows = fetch_recent_transactions(lookback_days=days)
    except RuntimeError as e:
        integration_status.record_failure(db, LAST_SYNCED_KEY, str(e))
        db.commit()
        raise HTTPException(400, str(e))
    except Exception as e:  # Stripe SDK errors (bad key, network, rate limit)
        integration_status.record_failure(db, LAST_SYNCED_KEY, f"Stripe API error: {e}")
        db.commit()
        raise HTTPException(502, f"Stripe API error: {e}")

    added = 0
    updated = 0
    for row in rows:
        fund_breakdown_json = json.dumps(row.fund_breakdown) if row.fund_breakdown else ""
        existing = db.get(StripeTransaction, row.id)
        if existing is None:
            db.add(
                StripeTransaction(
                    stripe_id=row.id,
                    type=row.type,
                    source=row.source,
                    amount=row.amount,
                    fee=row.fee,
                    net=row.net,
                    created=row.created,
                    description=row.description,
                    transfer=row.transfer,
                    transfer_date=row.transfer_date,
                    fund=row.fund,
                    donor=row.donor,
                    fund_breakdown_json=fund_breakdown_json,
                )
            )
            added += 1
        else:
            existing.type = row.type
            existing.source = row.source
            existing.amount = row.amount
            existing.fee = row.fee
            existing.net = row.net
            existing.created = row.created
            existing.description = row.description
            existing.transfer = row.transfer
            existing.transfer_date = row.transfer_date
            existing.fund = row.fund
            existing.donor = row.donor
            existing.fund_breakdown_json = fund_breakdown_json
            updated += 1

    now_iso = datetime.now(tz=timezone.utc).isoformat()
    setting = db.get(AppSetting, LAST_SYNCED_KEY)
    if setting is None:
        db.add(AppSetting(key=LAST_SYNCED_KEY, value=now_iso))
    else:
        setting.value = now_iso
    integration_status.clear_failure(db, LAST_SYNCED_KEY)
    db.commit()

    return StripeSyncResult(
        fetched=len(rows), added=added, updated=updated, last_synced_at=now_iso
    )


@router.get(
    "/transactions",
    response_model=StripeTransactionsOut,
    dependencies=[Depends(require_permission("stripe"))],
)
def list_transactions(db: Session = Depends(get_db)) -> StripeTransactionsOut:
    rows = list(
        db.scalars(select(StripeTransaction).order_by(StripeTransaction.created.desc())).all()
    )
    setting = db.get(AppSetting, LAST_SYNCED_KEY)
    return StripeTransactionsOut(
        transactions=rows,
        last_synced_at=setting.value if setting else None,
        default_lookback_days=get_settings().stripe_sync_lookback_days,
    )


@router.post(
    "/sync",
    response_model=StripeSyncResult,
    dependencies=[Depends(require_permission("stripe"))],
)
def sync_now(days: int | None = None, db: Session = Depends(get_db)) -> StripeSyncResult:
    return _run_sync(db, days=days)


def _verify_sync_secret(x_sync_secret: str = Header(default="")) -> None:
    """Guards the scheduled endpoint in place of a user login - the nightly
    Cloud Scheduler job has no JWT to present. Configuring
    stripe_sync_secret is required before this endpoint does anything; it's
    otherwise always rejected, never open-by-default."""
    settings = get_settings()
    if not settings.stripe_sync_secret or x_sync_secret != settings.stripe_sync_secret:
        raise HTTPException(403, "Invalid or missing sync secret.")


@router.post(
    "/scheduled-sync",
    response_model=StripeSyncResult,
    dependencies=[Depends(_verify_sync_secret)],
)
def scheduled_sync(db: Session = Depends(get_db)) -> StripeSyncResult:
    return _run_sync(db)
