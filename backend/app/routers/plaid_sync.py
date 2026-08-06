from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_permission, User
from ..models import AppSetting, PlaidItem, PlaidTransaction
from ..schemas import (
    PlaidExchangeIn,
    PlaidItemOut,
    PlaidLinkTokenOut,
    PlaidSyncResult,
    PlaidTransactionsOut,
)
from ..services import plaid_client

LAST_SYNCED_KEY = "plaid_last_synced_at"

router = APIRouter(
    prefix="/api/plaid", tags=["plaid"], dependencies=[Depends(require_permission("plaid"))]
)


def _plaid_error_response(e: Exception) -> HTTPException:
    if isinstance(e, RuntimeError):
        return HTTPException(400, str(e))
    return HTTPException(502, f"Plaid API error: {e}")


@router.post("/link-token", response_model=PlaidLinkTokenOut)
def link_token(user: User = Depends(require_permission("plaid"))) -> PlaidLinkTokenOut:
    try:
        token = plaid_client.create_link_token(user_id=f"user-{user.id}")
    except Exception as e:
        raise _plaid_error_response(e)
    return PlaidLinkTokenOut(link_token=token)


@router.post("/exchange", response_model=PlaidItemOut)
def exchange(payload: PlaidExchangeIn, db: Session = Depends(get_db)) -> PlaidItem:
    try:
        access_token, item_id = plaid_client.exchange_public_token(payload.public_token)
    except Exception as e:
        raise _plaid_error_response(e)

    existing = db.scalars(select(PlaidItem).where(PlaidItem.item_id == item_id)).first()
    if existing is not None:
        # Re-linking the same account (e.g. after a re-auth prompt) - refresh
        # the token in place rather than creating a duplicate connection.
        existing.access_token = access_token
        existing.institution_name = payload.institution_name or existing.institution_name
        db.commit()
        db.refresh(existing)
        return existing

    item = PlaidItem(
        item_id=item_id, access_token=access_token, institution_name=payload.institution_name
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/items/{item_db_id}", status_code=204)
def disconnect_item(item_db_id: int, db: Session = Depends(get_db)) -> None:
    item = db.get(PlaidItem, item_db_id)
    if item is None:
        raise HTTPException(404, "Connection not found.")
    try:
        plaid_client.remove_item(item.access_token)
    except Exception as e:
        raise _plaid_error_response(e)
    db.execute(
        PlaidTransaction.__table__.delete().where(PlaidTransaction.item_id == item.item_id)
    )
    db.delete(item)
    db.commit()


@router.get("/transactions", response_model=PlaidTransactionsOut)
def list_transactions(db: Session = Depends(get_db)) -> PlaidTransactionsOut:
    items = list(db.scalars(select(PlaidItem).order_by(PlaidItem.created_at.desc())).all())
    transactions = list(
        db.scalars(
            select(PlaidTransaction)
            .where(PlaidTransaction.removed.is_(False))
            .order_by(PlaidTransaction.posting_date.desc())
        ).all()
    )
    setting = db.get(AppSetting, LAST_SYNCED_KEY)
    return PlaidTransactionsOut(
        items=items, transactions=transactions, last_synced_at=setting.value if setting else None
    )


def _sync_one_item(db: Session, item: PlaidItem) -> tuple[int, int, int]:
    added = modified = removed = 0
    cursor = item.cursor
    has_more = True
    while has_more:
        response = plaid_client.sync_transactions(item.access_token, cursor)
        for t in response.added:
            db.add(
                PlaidTransaction(
                    plaid_transaction_id=t.transaction_id,
                    item_id=item.item_id,
                    **plaid_client.plaid_txn_to_fields(t),
                )
            )
            added += 1
        for t in response.modified:
            existing = db.get(PlaidTransaction, t.transaction_id)
            if existing is None:
                continue
            for field, value in plaid_client.plaid_txn_to_fields(t).items():
                setattr(existing, field, value)
            modified += 1
        for t in response.removed:
            existing = db.get(PlaidTransaction, t.transaction_id)
            if existing is not None:
                existing.removed = True
                removed += 1
        cursor = response.next_cursor
        has_more = response.has_more

    item.cursor = cursor
    return added, modified, removed


@router.post("/sync", response_model=PlaidSyncResult)
def sync_now(db: Session = Depends(get_db)) -> PlaidSyncResult:
    items = list(db.scalars(select(PlaidItem)).all())
    if not items:
        raise HTTPException(400, "No connected bank account yet - connect one first.")

    total_added = total_modified = total_removed = 0
    for item in items:
        try:
            added, modified, removed = _sync_one_item(db, item)
        except Exception as e:
            db.rollback()
            raise _plaid_error_response(e)
        total_added += added
        total_modified += modified
        total_removed += removed

    now_iso = datetime.now(tz=timezone.utc).isoformat()
    setting = db.get(AppSetting, LAST_SYNCED_KEY)
    if setting is None:
        db.add(AppSetting(key=LAST_SYNCED_KEY, value=now_iso))
    else:
        setting.value = now_iso
    db.commit()

    return PlaidSyncResult(
        fetched=total_added + total_modified + total_removed,
        added=total_added,
        modified=total_modified,
        removed=total_removed,
        last_synced_at=now_iso,
    )
