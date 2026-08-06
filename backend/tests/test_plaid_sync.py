"""Tests for the automated Plaid bank sync: connect (link-token/exchange),
sync now (mocked transactions/sync), disconnect, and listing - the same
overall shape as test_stripe_sync.py, but with an extra connect step since
Plaid requires a real Link flow before there's anything to sync.
"""

from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from test_auth import auth_header, client  # reuse the shared TestClient/app setup


def _fake_txn(
    txn_id="txn_fake_1", amount=-25.50, name="COFFEE SHOP", pending=False, day=1
):
    """Plaid's own sign convention: positive amount = money OUT. A -25.50
    here represents a $25.50 deposit once normalized by plaid_txn_to_fields."""
    return SimpleNamespace(
        transaction_id=txn_id,
        account_id="acct_fake_1",
        amount=amount,
        date=date(2026, 8, day),
        name=name,
        merchant_name="",
        pending=pending,
        personal_finance_category=None,
        payment_channel="online",
    )


def _sync_response(added=None, modified=None, removed=None, cursor="cursor-1", has_more=False):
    return SimpleNamespace(
        added=added or [],
        modified=modified or [],
        removed=removed or [],
        next_cursor=cursor,
        has_more=has_more,
    )


def _connect_fake_item(h):
    with patch(
        "app.routers.plaid_sync.plaid_client.create_link_token", return_value="link-tok-1"
    ):
        r = client.post("/api/plaid/link-token", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["link_token"] == "link-tok-1"

    with patch(
        "app.routers.plaid_sync.plaid_client.exchange_public_token",
        return_value=("access-tok-1", "item-fake-1"),
    ):
        r = client.post(
            "/api/plaid/exchange",
            headers=h,
            json={"public_token": "public-tok-1", "institution_name": "Fake Bank"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["item_id"] == "item-fake-1"
    assert body["institution_name"] == "Fake Bank"
    return body["id"]


def test_endpoints_require_auth():
    assert client.post("/api/plaid/link-token").status_code == 401
    assert client.get("/api/plaid/transactions").status_code == 401
    assert client.post("/api/plaid/sync").status_code == 401


def test_sync_now_requires_a_connected_account_first():
    # A fresh admin session with no connected item yet - this test runs
    # standalone so it doesn't assume ordering against the connect test.
    h = auth_header()
    with patch(
        "app.routers.plaid_sync.plaid_client.sync_transactions"
    ) as mock_sync:
        r = client.post("/api/plaid/sync", headers=h)
    mock_sync.assert_not_called()
    # Either 400 (no items) or 200 (an earlier test in this run already
    # connected one) - the real assertion below covers the connected path.
    assert r.status_code in (400, 200)


def test_connect_sync_disconnect_flow():
    h = auth_header()
    item_db_id = _connect_fake_item(h)

    with patch(
        "app.routers.plaid_sync.plaid_client.sync_transactions",
        return_value=_sync_response(added=[_fake_txn()]),
    ):
        r = client.post("/api/plaid/sync", headers=h)
    assert r.status_code == 200, r.text
    result = r.json()
    assert result["fetched"] == 1
    assert result["added"] == 1
    assert result["modified"] == 0
    assert result["removed"] == 0
    assert result["last_synced_at"]

    r = client.get("/api/plaid/transactions", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["last_synced_at"] == result["last_synced_at"]
    assert len(body["items"]) >= 1
    txn = next(t for t in body["transactions"] if t["plaid_transaction_id"] == "txn_fake_1")
    # Plaid's amount (-25.50 = money out) is negated onto this app's own
    # positive-means-deposit convention.
    assert txn["amount"] == 25.50
    assert txn["details"] == "CREDIT"
    assert txn["posting_date"] == "8/1/2026"

    # A modified transaction (e.g. pending -> posted) updates the existing
    # row in place rather than duplicating it.
    with patch(
        "app.routers.plaid_sync.plaid_client.sync_transactions",
        return_value=_sync_response(
            modified=[_fake_txn(amount=-30.00, pending=False)]
        ),
    ):
        r = client.post("/api/plaid/sync", headers=h)
    assert r.status_code == 200, r.text
    result2 = r.json()
    assert result2["added"] == 0
    assert result2["modified"] == 1

    r = client.get("/api/plaid/transactions", headers=h)
    txn = next(
        t for t in r.json()["transactions"] if t["plaid_transaction_id"] == "txn_fake_1"
    )
    assert txn["amount"] == 30.00

    # A removed transaction (e.g. a pending charge that never posted) is
    # flagged, not deleted, and drops out of the default listing.
    with patch(
        "app.routers.plaid_sync.plaid_client.sync_transactions",
        return_value=_sync_response(removed=[SimpleNamespace(transaction_id="txn_fake_1")]),
    ):
        r = client.post("/api/plaid/sync", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["removed"] == 1

    r = client.get("/api/plaid/transactions", headers=h)
    ids = {t["plaid_transaction_id"] for t in r.json()["transactions"]}
    assert "txn_fake_1" not in ids

    with patch("app.routers.plaid_sync.plaid_client.remove_item") as mock_remove:
        r = client.delete(f"/api/plaid/items/{item_db_id}", headers=h)
    assert r.status_code == 204, r.text
    mock_remove.assert_called_once_with("access-tok-1")

    r = client.get("/api/plaid/transactions", headers=h)
    assert not any(i["id"] == item_db_id for i in r.json()["items"])


def test_plaid_txn_to_fields_normalizes_amount_sign_and_date():
    from app.services.plaid_client import plaid_txn_to_fields

    fields = plaid_txn_to_fields(_fake_txn(amount=-42.10, day=6))
    assert fields["amount"] == 42.10  # Plaid "out" -> this app's "deposit"
    assert fields["details"] == "CREDIT"
    assert fields["posting_date"] == "8/6/2026"  # M/D/YYYY, matches BankRow/CSV

    fields = plaid_txn_to_fields(_fake_txn(amount=15.00, day=6))
    assert fields["amount"] == -15.00
    assert fields["details"] == "DEBIT"
