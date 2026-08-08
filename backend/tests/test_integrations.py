"""Tests for GET /api/integrations/status (Setup > Integrations Status
page): every integration is listed, last_synced_at/last_error round-trip
through a real sync failure then success, and the endpoint is admin-only."""

from unittest.mock import patch

from test_auth import auth_header, client


def test_requires_auth():
    assert client.get("/api/integrations/status").status_code == 401


def test_lists_every_integration():
    h = auth_header()
    r = client.get("/api/integrations/status", headers=h)
    assert r.status_code == 200, r.text
    keys = {row["key"] for row in r.json()}
    assert keys == {
        "pco_people",
        "pco_giving_donors",
        "pco_giving_donations",
        "pco_pledge_form",
        "stripe",
        "plaid",
    }


def _stripe_row(h):
    r = client.get("/api/integrations/status", headers=h)
    return next(row for row in r.json() if row["key"] == "stripe")


def test_failed_sync_is_recorded_and_a_later_success_clears_it():
    h = auth_header()

    with patch(
        "app.routers.stripe_sync.fetch_recent_transactions",
        side_effect=RuntimeError("Stripe API key not configured."),
    ):
        r = client.post("/api/stripe/sync", headers=h)
    assert r.status_code == 400, r.text

    row = _stripe_row(h)
    assert row["last_error"] == "Stripe API key not configured."
    assert row["last_error_at"]

    with patch("app.routers.stripe_sync.fetch_recent_transactions", return_value=[]):
        r = client.post("/api/stripe/sync", headers=h)
    assert r.status_code == 200, r.text

    row = _stripe_row(h)
    assert row["last_error"] is None
    assert row["last_error_at"] is None
    assert row["last_synced_at"] == r.json()["last_synced_at"]


def test_non_admin_cannot_view_integrations_status():
    h = auth_header()
    # A freshly created user is never admin by default (admin status is
    # granted separately via the permissions endpoint - see UserCreate's
    # docstring), so this needs no extra setup to be a non-admin account.
    r = client.post(
        "/api/auth/users",
        headers=h,
        json={"username": "nonadmin-integrations", "password": "not-an-admin-pw"},
    )
    assert r.status_code == 201, r.text
    non_admin_h = auth_header(username="nonadmin-integrations", password="not-an-admin-pw")
    assert client.get("/api/integrations/status", headers=non_admin_h).status_code == 403
