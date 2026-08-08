"""Shared test helper: seeds a PlaidItem + transactions_bank rows directly into
the test DB from a fixture bank CSV, standing in for a real Plaid sync -
mirrors _stripe_seed.py's shape and the real sync endpoint's own
upsert-by-id semantics, so it's safe to call more than once across test
functions that share one un-reset DB."""

from pathlib import Path

from app.models import PlaidItem, PlaidTransaction
from app.services.parsers import parse_bank_csv

FIXTURES = Path(__file__).parent

TEST_ITEM_ID = "item-test-fixture"


def _ensure_item(db) -> None:
    if db.query(PlaidItem).filter_by(item_id=TEST_ITEM_ID).first() is None:
        db.add(PlaidItem(item_id=TEST_ITEM_ID, access_token="test-token", institution_name="Test Bank"))
        db.commit()


def seed_plaid_transactions(db, filename: str = "sample_bank.csv") -> None:
    seed_plaid_transactions_from_text(db, (FIXTURES / filename).read_text())


def seed_plaid_transactions_from_text(db, csv_text: str) -> None:
    _ensure_item(db)
    for i, row in enumerate(parse_bank_csv(csv_text)):
        txn_id = f"plaid-fixture-{i}-{row.posting_date}-{row.amount}"
        if db.get(PlaidTransaction, txn_id) is not None:
            continue
        db.add(
            PlaidTransaction(
                plaid_transaction_id=txn_id,
                item_id=TEST_ITEM_ID,
                account_id="acct-test-fixture",
                details=row.details,
                posting_date=row.posting_date,
                description=row.description,
                amount=row.amount,
                type=row.type,
            )
        )
    db.commit()
