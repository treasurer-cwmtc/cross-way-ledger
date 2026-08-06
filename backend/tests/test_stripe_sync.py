"""Tests for the automated Stripe sync: the on-demand/scheduled endpoints
that pull ledger_stripe from the Stripe API (mocked here) instead of a CSV
upload, and the fund-check/merge-stripe endpoints that now read from it.
"""

from unittest.mock import patch

from app.services.parsers import StripeRow
from test_auth import auth_header, client  # reuse the shared TestClient/app setup


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
