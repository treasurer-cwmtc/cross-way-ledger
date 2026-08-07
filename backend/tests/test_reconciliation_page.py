"""Tests for the new Reconciliation page's backend: /api/reconcile/sync-status
(the Step 1 date-range helper) and /api/reconcile/from-bank-sync (the
staging-table replacement for the Upload Wizard's manual bank-file upload).
The rest of the flow (merge-stripe, line editing, recategorize) is already
covered by test_upload_wizard.py and is completely unchanged - this file
only covers the new entry point.
"""

from test_auth import TestingSession, auth_header, client  # reuse shared TestClient/app setup
from _plaid_seed import seed_plaid_transactions
from _stripe_seed import seed_stripe_transactions


def _seed_bank():
    with TestingSession() as db:
        seed_plaid_transactions(db)


def _seed_stripe():
    with TestingSession() as db:
        seed_stripe_transactions(db)


def test_sync_status_reports_latest_date_from_each_staging_table():
    _seed_bank()
    _seed_stripe()
    h = auth_header()
    r = client.get("/api/reconcile/sync-status", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    # sample_bank.csv's latest row is 6/22/2026; sample_stripe.csv's is
    # asserted loosely here since its exact fixture dates aren't this
    # test's concern - just confirm both come back non-empty and parseable.
    assert body["bank_last_posted"] == "6/22/2026"
    assert body["stripe_last_posted"]


def test_sync_status_reports_no_actual_last_posted_when_nothing_reconciled_yet():
    _seed_bank()
    h = auth_header()
    r = client.get("/api/reconcile/sync-status", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["actual_last_posted"] is None


def test_sync_status_reports_latest_actual_posted_date_distinct_from_staging_dates():
    # A prior reconciliation already pushed one entry through to ledger_actual
    # - actual_last_posted should reflect that (where a prior reconciliation
    # left off), independent of whatever the staging tables' own latest
    # dates happen to be.
    with TestingSession() as db:
        from datetime import date

        from app.models import ReconciliationEntry

        db.add(
            ReconciliationEntry(
                posted_date=date(2026, 6, 1),
                description="Prior reconciliation",
                dedup_key="test-actual-last-posted",
                amount=10.0,
            )
        )
        db.commit()
    h = auth_header()
    r = client.get("/api/reconcile/sync-status", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["actual_last_posted"] == "2026-06-01"


def test_from_bank_sync_requires_valid_dates():
    h = auth_header()
    r = client.post(
        "/api/reconcile/from-bank-sync",
        headers=h,
        params={"start_date": "not-a-date", "end_date": "2026-06-30"},
    )
    assert r.status_code == 400


def test_from_bank_sync_rejects_empty_range():
    _seed_bank()
    h = auth_header()
    r = client.post(
        "/api/reconcile/from-bank-sync",
        headers=h,
        params={"start_date": "2020-01-01", "end_date": "2020-01-02"},
    )
    assert r.status_code == 400


def test_from_bank_sync_builds_a_run_scoped_to_the_date_range_only():
    _seed_bank()
    h = auth_header()
    # Full fixture range (6/12-6/22) has 6 rows, one of which (6/22, the
    # Stripe payout) falls outside this narrower window - narrowing to
    # 6/16-6/18 should only pick up the 4 rows that actually fall in it,
    # and none of them are the Stripe-payout placeholder.
    r = client.post(
        "/api/reconcile/from-bank-sync",
        headers=h,
        params={"start_date": "2026-06-16", "end_date": "2026-06-18"},
    )
    assert r.status_code == 200, r.text
    run = r.json()
    assert "synced" in run["bank_filename"].lower()
    assert run["bank_line_count"] == 4  # 6/16, 6/17, 6/18 (x2) rows
    assert not any(l["is_stripe_payout"] for l in run["lines"])


def test_from_bank_sync_run_can_still_merge_stripe_afterward():
    """Confirms the new Step 1 hands off into the existing, unmodified
    merge-stripe endpoint exactly like the CSV-upload path always has -
    this is the whole point of the design (same downstream logic, only
    the source of the bank rows changed)."""
    _seed_bank()
    _seed_stripe()
    h = auth_header()
    r = client.post(
        "/api/reconcile/from-bank-sync",
        headers=h,
        params={"start_date": "2026-06-01", "end_date": "2026-06-30"},
    )
    assert r.status_code == 200, r.text
    run_id = r.json()["id"]

    r2 = client.post(f"/api/reconcile/{run_id}/merge-stripe", headers=h)
    assert r2.status_code == 200, r2.text
    merged = r2.json()
    assert merged["stripe_filename"] == "Stripe API sync"
    assert not any(l["is_stripe_payout"] and not l["matched"] for l in merged["lines"])
