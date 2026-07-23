"""Tests for the upload wizard's incremental endpoints: bank-only preview,
line editing, merge-stripe, recategorize, stripe-fund-check, duplicate-check.

Run from the backend/ directory:  python -m pytest
"""

import io
from pathlib import Path

from test_auth import auth_header, client  # reuse the shared TestClient/app setup

FIXTURES = Path(__file__).parent


def _bank_account_id() -> int:
    h = auth_header()
    r = client.get("/api/bank-accounts", headers=h)
    assert r.status_code == 200
    accounts = r.json()
    assert accounts, "expected the seeded 'Chase Operating' bank account"
    return accounts[0]["id"]


def _bank_only_run() -> dict:
    h = auth_header()
    with open(FIXTURES / "sample_bank.csv", "rb") as bank:
        r = client.post(
            "/api/reconcile",
            headers=h,
            files={"bank_file": ("bank.csv", bank, "text/csv")},
        )
    assert r.status_code == 200, r.text
    return r.json()


def test_bank_only_run_has_placeholder_for_stripe_line_and_raw_totals():
    run = _bank_only_run()
    assert run["stripe_filename"] == ""
    assert run["stripe_line_count"] == 0
    lines = run["lines"]
    placeholders = [l for l in lines if l["is_stripe_payout"]]
    assert len(placeholders) == 1
    assert placeholders[0]["account_no"] == ""
    assert placeholders[0]["matched"] is False

    non_stripe = [l for l in lines if not l["is_stripe_payout"]]
    assert run["raw_bank_income_total"] == round(
        sum(l["amount"] for l in lines if l["amount"] > 0), 2
    )
    assert run["raw_bank_expense_total"] == round(
        sum(l["amount"] for l in non_stripe if l["amount"] < 0), 2
    )


def test_update_line_edit_survives_merge_stripe():
    h = auth_header()
    run = _bank_only_run()
    run_id = run["id"]

    # Manually categorize the uncategorized "TAQUERIA" line before Stripe is
    # even uploaded.
    taqueria = next(l for l in run["lines"] if "TAQUERIA" in l["bank_description"])
    r = client.put(
        f"/api/reconcile/lines/{taqueria['id']}",
        headers=h,
        json={"account_no": "E151910", "notes": "manually categorized"},
    )
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["account_no"] == "E151910"
    # category/statement_description must be re-derived from the new
    # account, not left stale from before the edit.
    assert updated["statement_description"] != ""
    assert updated["category"] == "Expense"
    assert updated["matched"] is True

    with open(FIXTURES / "sample_stripe.csv", "rb") as stripe:
        r = client.post(
            f"/api/reconcile/{run_id}/merge-stripe",
            headers=h,
            files={"stripe_file": ("stripe.csv", stripe, "text/csv")},
        )
    assert r.status_code == 200, r.text
    merged = r.json()

    # The manual edit from before merge-stripe must survive untouched.
    still_there = next(
        l for l in merged["lines"] if l["id"] == taqueria["id"]
    )
    assert still_there["account_no"] == "E151910"
    assert still_there["notes"] == "manually categorized"

    # The placeholder is gone, replaced by exploded Stripe donation lines.
    assert not any(l["is_stripe_payout"] for l in merged["lines"])
    assert merged["matched_payout_count"] == 1
    assert merged["unmatched_stripe_bank_count"] == 0
    stripe_lines = [l for l in merged["lines"] if l["source"] == "stripe"]
    assert len(stripe_lines) == 5

    # bank_totals_by_day captures the original bank amount per day,
    # independent of the exploded lines - both should agree here since
    # nothing's been edited post-merge.
    stripe_total_by_day = sum(l["amount"] for l in stripe_lines)
    day = stripe_lines[0]["posted_date"]
    assert merged["bank_totals_by_day"][day] == round(stripe_total_by_day, 2)


def test_recategorize_picks_up_new_rule_without_touching_edited_lines():
    h = auth_header()
    run = _bank_only_run()
    run_id = run["id"]

    taqueria = next(l for l in run["lines"] if "TAQUERIA" in l["bank_description"])
    assert taqueria["account_no"] == ""

    # Manually set a different, unrelated line so we can confirm
    # recategorize leaves it alone.
    other = next(
        l
        for l in run["lines"]
        if l["id"] != taqueria["id"]
        and not l["is_stripe_payout"]
        and l["account_no"]
    )
    client.put(
        f"/api/reconcile/lines/{other['id']}",
        headers=h,
        json={"account_no": "E101810", "notes": "manual override"},
    )

    r = client.post(
        "/api/rules",
        headers=h,
        json={
            "rule_type": "bank_keyword",
            "pattern": "TAQUERIA",
            "account_no": "E151910",
            "priority": 5,
        },
    )
    assert r.status_code == 201, r.text

    r = client.post(f"/api/reconcile/{run_id}/recategorize", headers=h)
    assert r.status_code == 200, r.text
    lines = r.json()["lines"]

    recategorized = next(l for l in lines if l["id"] == taqueria["id"])
    assert recategorized["account_no"] == "E151910"

    untouched = next(l for l in lines if l["id"] == other["id"])
    assert untouched["account_no"] == "E101810"
    assert untouched["notes"] == "manual override"


def test_stripe_fund_check_green_when_all_covered():
    h = auth_header()
    with open(FIXTURES / "sample_stripe.csv", "rb") as stripe:
        r = client.post(
            "/api/reconcile/stripe-fund-check",
            headers=h,
            files={"stripe_file": ("stripe.csv", stripe, "text/csv")},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["all_covered"] is True
    assert all(item["has_rule"] for item in body["funds"])


def test_stripe_fund_check_red_when_fund_missing_rule():
    h = auth_header()
    csv_text = (
        "id,Type,Source,Amount,Fee,Net,Currency,Created (UTC),Available On (UTC),"
        "Description,Transfer,Transfer Date (UTC),Transfer Group,"
        "planning_center_context (metadata),planning_center_person_name (metadata)\n"
        'txn_1,payment,py_1,50.00,0,50.00,usd,6/1/2026 0:00,6/1/2026 0:00,'
        'Donation #1 - Jane Doe - Made Up Fund ($50.00),,,,'
        '"[{""name"":""Made Up Fund"",""cents"":5000}]",\n'
    )
    r = client.post(
        "/api/reconcile/stripe-fund-check",
        headers=h,
        files={"stripe_file": ("stripe.csv", io.BytesIO(csv_text.encode()), "text/csv")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["all_covered"] is False
    made_up = next(item for item in body["funds"] if item["fund"] == "Made Up Fund")
    assert made_up["has_rule"] is False


def test_duplicate_check_matches_what_import_would_skip():
    h = auth_header()
    bank_account_id = _bank_account_id()

    # A fresh bank-only + merge-stripe run, imported once.
    run = _bank_only_run()
    run_id = run["id"]
    with open(FIXTURES / "sample_stripe.csv", "rb") as stripe:
        client.post(
            f"/api/reconcile/{run_id}/merge-stripe",
            headers=h,
            files={"stripe_file": ("stripe.csv", stripe, "text/csv")},
        )
    client.post(
        f"/api/reconciliation/import-run/{run_id}",
        headers=h,
        json={"bank_account_id": bank_account_id},
    )

    # Before this second run is imported, duplicate-check should already
    # flag every line as a would-be duplicate (same statement re-uploaded).
    run2 = _bank_only_run()
    run2_id = run2["id"]
    with open(FIXTURES / "sample_stripe.csv", "rb") as stripe:
        client.post(
            f"/api/reconcile/{run2_id}/merge-stripe",
            headers=h,
            files={"stripe_file": ("stripe.csv", stripe, "text/csv")},
        )

    r = client.get(f"/api/reconcile/{run2_id}/duplicate-check", headers=h)
    assert r.status_code == 200, r.text
    dup = r.json()
    assert dup["count"] > 0

    result = client.post(
        f"/api/reconciliation/import-run/{run2_id}",
        headers=h,
        json={"bank_account_id": bank_account_id},
    ).json()
    assert result["skipped_duplicates"] == dup["count"]
