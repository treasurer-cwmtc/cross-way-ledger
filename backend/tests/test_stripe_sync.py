"""Tests for the automated Stripe sync: the on-demand/scheduled endpoints
that pull transactions_stripe from the Stripe API (mocked here) instead of a CSV
upload, and the fund-check/merge-stripe endpoints that now read from it.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from app.services.parsers import StripeRow, parse_stripe_csv
from app.services.stripe_sync import _balance_txn_to_row, to_stripe_row
from app.models import StripeTransaction
from test_auth import TestingSession, auth_header, client  # reuse shared TestClient/app setup


def _fake_rows() -> list[StripeRow]:
    return [
        StripeRow(
            id="txn_fake_payout_1",
            type="payout",
            source="po_fake_1",
            amount=-100.0,
            fee=0.0,
            net=-100.0,
            created="2026-07-01",
            description="STRIPE PAYOUT",
            transfer="",
            transfer_date="",
            fund="",
            donor="",
        ),
        StripeRow(
            id="txn_fake_donation_1",
            type="payment",
            source="py_fake_1",
            amount=100.30,
            fee=0.30,
            net=100.0,
            created="2026-07-01",
            description="Donation #999 - Test Donor - Pledges ($100.30)",
            transfer="po_fake_1",
            transfer_date="2026-07-01",
            fund="Pledges",
            donor="Test Donor",
        ),
    ]


def test_sync_now_requires_auth():
    assert client.post("/api/stripe/sync").status_code == 401


def test_scheduled_sync_rejects_missing_or_wrong_secret():
    assert client.post("/api/stripe/scheduled-sync").status_code == 403
    assert (
        client.post(
            "/api/stripe/scheduled-sync", headers={"X-Sync-Secret": "wrong"}
        ).status_code
        == 403
    )


def test_sync_now_upserts_and_lists_transactions():
    h = auth_header()
    with patch(
        "app.routers.stripe_sync.fetch_recent_transactions", return_value=_fake_rows()
    ):
        r = client.post("/api/stripe/sync", headers=h)
    assert r.status_code == 200, r.text
    result = r.json()
    assert result["fetched"] == 2
    assert result["added"] == 2
    assert result["updated"] == 0
    assert result["last_synced_at"]

    r = client.get("/api/stripe/transactions", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["last_synced_at"] == result["last_synced_at"]
    assert body["default_lookback_days"] == 30
    ids = {t["stripe_id"] for t in body["transactions"]}
    assert {"txn_fake_payout_1", "txn_fake_donation_1"} <= ids

    # A repeat sync with the same rows upserts (updates) rather than
    # duplicating - the whole point of keying on stripe_id.
    with patch(
        "app.routers.stripe_sync.fetch_recent_transactions", return_value=_fake_rows()
    ):
        r = client.post("/api/stripe/sync", headers=h)
    assert r.status_code == 200, r.text
    result2 = r.json()
    assert result2["added"] == 0
    assert result2["updated"] == 2


def test_sync_now_passes_custom_days_through_to_fetch():
    h = auth_header()
    with patch(
        "app.routers.stripe_sync.fetch_recent_transactions", return_value=[]
    ) as mock_fetch:
        r = client.post("/api/stripe/sync?days=400", headers=h)
    assert r.status_code == 200, r.text
    mock_fetch.assert_called_once_with(lookback_days=400)


def test_api_path_matches_csv_path_for_the_same_donation():
    """The whole point of the automated sync is that it's a drop-in
    replacement for the manual CSV upload - the reconciler must not be able
    to tell which source a StripeRow came from. Builds both a CSV row and a
    mocked Stripe API balance transaction representing the SAME underlying
    donation (same amount/fee/donor/fund/payout), and asserts the two
    parsing paths agree on every field the reconciler actually reads."""
    csv_text = (
        "id,Type,Source,Amount,Fee,Net,Currency,Created (UTC),Available On (UTC),"
        "Description,Transfer,Transfer Date (UTC),Transfer Group,"
        "planning_center_context (metadata),planning_center_person_name (metadata)\n"
        "txn_parity_test,payment,py_parity_test,100.30,0.30,100.00,usd,"
        "8/6/2026 12:00,8/9/2026 0:00,"
        'Donation #555 - Parity Donor - Pledges ($100.30),po_parity_payout,'
        '8/9/2026 0:00,,"[{""name"":""Pledges"",""cents"":10030}]",\n'
    )
    csv_row = parse_stripe_csv(csv_text)[0]

    # A mocked Stripe BalanceTransaction for the identical donation - Stripe's
    # real amounts are integer cents, and `source` is just an id string
    # (matching the CSV's "Source" column) unless the caller expands it.
    api_txn = SimpleNamespace(
        id="txn_parity_test",
        type="payment",
        source="py_parity_test",
        amount=10030,
        fee=30,
        net=10000,
        created=int(datetime(2026, 8, 6, 12, 0, tzinfo=timezone.utc).timestamp()),
        available_on=int(datetime(2026, 8, 9, tzinfo=timezone.utc).timestamp()),
        description="Donation #555 - Parity Donor - Pledges ($100.30)",
    )
    api_row = _balance_txn_to_row(api_txn, transfer="po_parity_payout")

    assert api_row.id == csv_row.id
    assert api_row.type == csv_row.type
    assert api_row.source == csv_row.source
    assert api_row.amount == csv_row.amount
    assert api_row.fee == csv_row.fee
    assert api_row.net == csv_row.net
    assert api_row.created == csv_row.created
    assert api_row.transfer == csv_row.transfer
    assert api_row.transfer_date == csv_row.transfer_date
    assert api_row.fund == csv_row.fund
    assert api_row.donor == csv_row.donor
    assert api_row.is_donation == csv_row.is_donation


def test_balance_txn_to_row_reads_split_fund_breakdown_from_expanded_source_metadata():
    # A real expanded balance transaction (expand=["data.source"], see
    # fetch_recent_transactions) embeds the underlying Charge object, whose
    # .metadata carries the same "planning_center_context"/
    # "planning_center_person_name" keys the CSV export's columns come from
    # - this is what lets the live sync path (previously always passing
    # empty context, see issue #124) recognize a split-fund gift too.
    source = SimpleNamespace(
        id="py_split_api",
        metadata={
            "planning_center_context": (
                '[{"name":"Building Fund","cents":400000},'
                '{"name":"General Missions","cents":50000}]'
            ),
            "planning_center_person_name": "Jane Doe",
        },
    )
    api_txn = SimpleNamespace(
        id="txn_split_api",
        type="payment",
        source=source,
        amount=450000,
        fee=0,
        net=450000,
        created=int(datetime(2026, 8, 6, tzinfo=timezone.utc).timestamp()),
        available_on=int(datetime(2026, 8, 9, tzinfo=timezone.utc).timestamp()),
        description="Donation #1 - Jane Doe - Building Fund ($4,000.00) General Missions ($500.00)",
    )
    row = _balance_txn_to_row(api_txn, transfer="po_split_api")
    assert row.donor == "Jane Doe"
    assert row.fund == "Building Fund, General Missions"
    assert row.fund_breakdown == [("Building Fund", 4000.0), ("General Missions", 500.0)]


def test_sync_now_persists_and_round_trips_fund_breakdown():
    h = auth_header()
    split_row = StripeRow(
        id="txn_split_persist",
        type="payment",
        source="py_split_persist",
        amount=4500.0,
        fee=0.0,
        net=4500.0,
        created="2026-08-06",
        description="Donation #2 - Jane Doe - Building Fund ($4,000.00) General Missions ($500.00)",
        transfer="po_split_persist",
        transfer_date="2026-08-09",
        fund="Building Fund, General Missions",
        donor="Jane Doe",
        fund_breakdown=[("Building Fund", 4000.0), ("General Missions", 500.0)],
    )
    with patch(
        "app.routers.stripe_sync.fetch_recent_transactions", return_value=[split_row]
    ):
        r = client.post("/api/stripe/sync", headers=h)
    assert r.status_code == 200, r.text

    with TestingSession() as db:
        stored = db.get(StripeTransaction, "txn_split_persist")
        assert stored is not None
        assert stored.fund_breakdown_json
        row_back = to_stripe_row(stored)
        assert row_back.fund_breakdown == [("Building Fund", 4000.0), ("General Missions", 500.0)]

    # A repeat sync (upsert path, not create) must also persist it.
    with patch(
        "app.routers.stripe_sync.fetch_recent_transactions", return_value=[split_row]
    ):
        r = client.post("/api/stripe/sync", headers=h)
    assert r.status_code == 200, r.text
    with TestingSession() as db:
        stored = db.get(StripeTransaction, "txn_split_persist")
        assert to_stripe_row(stored).fund_breakdown == [
            ("Building Fund", 4000.0),
            ("General Missions", 500.0),
        ]
