"""Confirms the PCO endpoint reorganization landed cleanly: every endpoint
lives under the standardized /api/pco/{people,giving,forms}/... prefix, and
none of the old scattered paths (routers/reimbursements.py's /pco-people/*,
pledge_campaigns.py's /pco-forms and /donors/*, donations.py's /sync etc.)
still resolve - a clean cutover, not a redirect/back-compat shim (per the
treasurer's explicit call not to leave old paths pointing at new code)."""

from app.main import app
from test_auth import client


def _registered_paths() -> set[str]:
    return {getattr(r, "path", "") for r in app.routes}


def test_new_pco_paths_are_registered():
    paths = _registered_paths()
    for expected in [
        "/api/pco/people/import",
        "/api/pco/people/sync",
        "/api/pco/people/scheduled-sync",
        "/api/pco/people/last-synced",
        "/api/pco/people",
        "/api/pco/people/lists",
        "/api/pco/people/reimbursement-gate-list",
        "/api/pco/giving/donors/sync",
        "/api/pco/giving/donors/scheduled-sync",
        "/api/pco/giving/donors/last-synced",
        "/api/pco/giving/people-links",
        "/api/pco/giving/people-links/{donor_id}",
        "/api/pco/giving/donations/sync",
        "/api/pco/giving/donations/scheduled-sync",
        "/api/pco/giving/donations/last-synced",
        "/api/pco/forms",
        "/api/pco/forms/{form_id}/fields",
        "/api/pco/forms/{campaign_id}/sync",
        "/api/pco/forms/scheduled-sync",
    ]:
        assert expected in paths, f"missing new path: {expected}"


def test_old_scattered_paths_no_longer_exist():
    paths = _registered_paths()
    for old in [
        "/api/reimbursements/pco-people/import",
        "/api/reimbursements/pco-people/sync",
        "/api/reimbursements/pco-people/scheduled-sync",
        "/api/reimbursements/pco-people/last-synced",
        "/api/reimbursements/pco-people",
        "/api/reimbursements/pco-lists",
        "/api/reimbursements/reimbursement-gate-list",
        "/api/pledge-campaigns/donors/sync",
        "/api/pledge-campaigns/donors/scheduled-sync",
        "/api/pledge-campaigns/donors/last-synced",
        "/api/pledge-campaigns/giving-people-links",
        "/api/pledge-campaigns/giving-people-links/{donor_id}",
        "/api/pledge-campaigns/pco-forms",
        "/api/pledge-campaigns/pco-forms/{form_id}/fields",
        "/api/pledge-campaigns/{campaign_id}/pledges/sync",
        "/api/pledge-campaigns/pledges/scheduled-sync",
        "/api/donations/sync",
        "/api/donations/scheduled-sync",
        "/api/donations/last-synced",
    ]:
        assert old not in paths, f"old path should be gone, still registered: {old}"


def test_old_paths_actually_404_not_redirect():
    """Belt-and-suspenders on top of the route-table check above: hitting an
    old URL over HTTP never returns a 3xx - there is no redirect shim
    anywhere in this reorganization. Usually a plain 404; a couple of these
    old paths (e.g. "pco-forms") happen to collide with the still-live
    generic /{campaign_id} route on the same router (FastAPI matches the
    path shape first, method second), so those come back 405 Method Not
    Allowed instead - still definitive proof no working endpoint sits at
    the old path, just a different status code."""
    for old in [
        "/api/reimbursements/pco-people",
        "/api/reimbursements/pco-lists",
        "/api/pledge-campaigns/pco-forms",
        "/api/pledge-campaigns/donors/last-synced",
    ]:
        r = client.get(old, follow_redirects=False)
        assert r.status_code in (404, 405), f"{old} should 404/405, got {r.status_code}"
        assert not (300 <= r.status_code < 400), f"{old} must never redirect, got {r.status_code}"
