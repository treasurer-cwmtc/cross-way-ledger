"""Shared test helper: seeds ledger_stripe rows directly into the test DB
from a fixture CSV, standing in for a real Stripe API sync (get-or-create by
stripe_id, so it's safe to call more than once across test functions that
share one un-reset DB - mirrors the real sync endpoint's own upsert
semantics)."""

import json
from pathlib import Path

from app.models import StripeTransaction
from app.services.parsers import parse_stripe_csv

FIXTURES = Path(__file__).parent


def seed_stripe_transactions(db, filename: str = "sample_stripe.csv") -> None:
    seed_stripe_transactions_from_text(db, (FIXTURES / filename).read_text())


def seed_stripe_transactions_from_text(db, csv_text: str) -> None:
    for row in parse_stripe_csv(csv_text):
        if db.get(StripeTransaction, row.id) is not None:
            continue
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
                fund_breakdown_json=json.dumps(row.fund_breakdown) if row.fund_breakdown else "",
            )
        )
    db.commit()
