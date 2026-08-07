"""Pulls transactions from the live Stripe API - the automated counterpart to
`parse_stripe_csv`'s manual-upload path. Produces the same `StripeRow` shape
so the rest of the reconciliation pipeline (services/reconciler.py) treats
API-sourced and CSV-sourced rows identically.

Fetches by payout rather than by a raw balance-transaction date filter: each
Payout is a discrete, dated event, and `BalanceTransaction.list(payout=...)`
returns exactly the charges/refunds/fees that were swept into it - the same
grouping the CSV export's "Transfer" column encodes, which merge_stripe()
depends on to match a bank deposit to its underlying donations.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import stripe

from ..config import get_settings
from ..models import StripeTransaction
from .parsers import StripeRow, extract_fund_donor, parse_fund_breakdown


def to_stripe_row(t: StripeTransaction) -> StripeRow:
    """Adapts a staged (already-synced) row back into the StripeRow shape
    the reconciler's merge_stripe()/reconcile() functions expect, so the
    wizard treats API-sourced and CSV-sourced data identically."""
    try:
        fund_breakdown = [tuple(pair) for pair in json.loads(t.fund_breakdown_json or "[]")]
    except (ValueError, TypeError):
        fund_breakdown = []
    return StripeRow(
        id=t.stripe_id,
        type=t.type,
        source=t.source,
        amount=t.amount,
        fee=t.fee,
        net=t.net,
        created=t.created,
        description=t.description,
        transfer=t.transfer,
        transfer_date=t.transfer_date,
        fund=t.fund,
        donor=t.donor,
        fund_breakdown=fund_breakdown,
    )


def _iso_date(unix_ts: int | None) -> str:
    """M/D/YYYY (no leading zeros), matching normalize_date()'s output for the
    CSV path exactly - Stripe's own CSV export uses that format, and several
    downstream consumers (the wizard's raw ReconLine display, in particular)
    show this string as-is rather than through a date-parsing function, so
    API-sourced and CSV-sourced rows need to render identically."""
    if not unix_ts:
        return ""
    dt = datetime.fromtimestamp(unix_ts, tz=timezone.utc)
    return f"{dt.month}/{dt.day}/{dt.year}"


def _balance_txn_to_row(txn, transfer: str) -> StripeRow:
    description = txn.description or ""
    source = txn.source
    source_id = getattr(source, "id", source) or ""
    # `source` is only a full Charge/Refund object (with `.metadata`) when
    # fetch_recent_transactions() asked for it via expand=["data.source"] -
    # a plain balance-transaction listing only gives back the id string.
    # Planning Center's own Stripe integration stamps the same two metadata
    # keys the CSV export's "planning_center_context (metadata)" and
    # "planning_center_person_name (metadata)" columns come from, so this
    # gives the live sync path the same structured multi-fund breakdown the
    # CSV path always had access to (see issue #124 - previously this path
    # never even tried, and was 100% reliant on the fragile description
    # regex, which garbles a split-fund gift into one string).
    metadata = getattr(source, "metadata", None) or {}
    context_json = metadata.get("planning_center_context", "")
    person_name = metadata.get("planning_center_person_name", "")
    fund, donor = extract_fund_donor(description, context_json, person_name)
    return StripeRow(
        id=txn.id,
        type=txn.type,
        source=str(source_id),
        amount=round(txn.amount / 100, 2),
        fee=round(txn.fee / 100, 2),
        net=round(txn.net / 100, 2),
        created=_iso_date(txn.created),
        description=description,
        transfer=transfer,
        transfer_date=_iso_date(txn.available_on),
        fund=fund,
        donor=donor,
        fund_breakdown=parse_fund_breakdown(context_json),
    )


def fetch_recent_transactions(lookback_days: int | None = None) -> list[StripeRow]:
    """Fetches every payout created in the lookback window, plus every
    balance transaction swept into each one, as StripeRow objects ready for
    the same merge_stripe()/reconcile() pipeline the CSV upload feeds."""
    settings = get_settings()
    if not settings.stripe_secret_key:
        raise RuntimeError("Stripe API key is not configured.")

    stripe.api_key = settings.stripe_secret_key
    days = lookback_days if lookback_days is not None else settings.stripe_sync_lookback_days
    since = datetime.now(tz=timezone.utc) - timedelta(days=days)
    since_ts = int(since.timestamp())

    rows: list[StripeRow] = []
    payouts = stripe.Payout.list(created={"gte": since_ts}, limit=100)
    for payout in payouts.auto_paging_iter():
        payout_txn = stripe.BalanceTransaction.retrieve(payout.balance_transaction)
        rows.append(_balance_txn_to_row(payout_txn, transfer=payout.id))

        # expand=["data.source"] embeds the underlying Charge/Refund object
        # (with its .metadata) instead of just an id string - required for
        # _balance_txn_to_row() to read the Planning Center fund breakdown.
        swept = stripe.BalanceTransaction.list(
            payout=payout.id, limit=100, expand=["data.source"]
        )
        for txn in swept.auto_paging_iter():
            if txn.id == payout_txn.id:
                continue  # the payout's own transaction, already added above
            rows.append(_balance_txn_to_row(txn, transfer=payout.id))
    return rows
