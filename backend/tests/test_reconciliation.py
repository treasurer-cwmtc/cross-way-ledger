"""Reconciliation ledger tests: import-from-run dedup, editing, listing."""

from datetime import date
from pathlib import Path

from app.services.ledger import build_dedup_key
from test_auth import auth_header, client  # reuse the shared TestClient/app setup

FIXTURES = Path(__file__).parent


def test_build_dedup_key_fits_column_even_for_long_bank_descriptions():
    # dedup_key is a String(1500) column, but bank_description (the fallback
    # when there's no check/invoice name) is unbounded Text - a long Chase
    # ACH descriptor line (as seen with Stripe payout lines) must not blow
    # past the column limit and fail the batch insert. 1500 comfortably
    # covers any real bank description; the truncation below is only a
    # defense-in-depth backstop against a pathologically long one.
    long_description = "ORIG CO NAME:STRIPE" + " X" * 1000 + " TRN: 0064758960TC"
    assert len(long_description) > 1500
    key = build_dedup_key(date(2026, 3, 30), -40.0, "", long_description)
    assert len(key) <= 1500


BANK_FILE_LINK = "https://drive.google.com/file/d/bank-test-id/view"
STRIPE_FILE_LINK = "https://drive.google.com/file/d/stripe-test-id/view"


def _run_upload() -> int:
    h = auth_header()
    with (
        open(FIXTURES / "sample_bank.csv", "rb") as bank,
        open(FIXTURES / "sample_stripe.csv", "rb") as stripe,
    ):
        r = client.post(
            "/api/reconcile",
            headers=h,
            files={
                "bank_file": ("bank.csv", bank, "text/csv"),
                "stripe_file": ("stripe.csv", stripe, "text/csv"),
            },
            data={"bank_file_link": BANK_FILE_LINK, "stripe_file_link": STRIPE_FILE_LINK},
        )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _bank_account_id() -> int:
    h = auth_header()
    r = client.get("/api/bank-accounts", headers=h)
    assert r.status_code == 200
    accounts = r.json()
    assert accounts, "expected the seeded 'Chase Operating' bank account"
    return accounts[0]["id"]


def test_import_run_dedups_on_reimport():
    h = auth_header()
    run_id = _run_upload()
    bank_account_id = _bank_account_id()

    r1 = client.post(
        f"/api/reconciliation/import-run/{run_id}",
        headers=h,
        json={"bank_account_id": bank_account_id},
    )
    assert r1.status_code == 200, r1.text
    first = r1.json()
    assert first["imported"] > 0
    assert first["skipped_duplicates"] == 0

    # sample_bank.csv's "TST*TAQUERIA NUEVO LEON" line has no matching
    # keyword rule, so it stays uncategorized through the wizard - its
    # ReconLine.notes is the auto-generated "Uncategorized - add a rule"
    # review hint. That's useful in the wizard's own UI (Step 3's "What's
    # wrong" column) but must not leak into the permanent ledger's Notes
    # field once pushed to Actual. Checked here (rather than its own test)
    # since this file shares one un-reset DB across tests - only the first
    # import of this fixture is guaranteed not to be skipped as a duplicate.
    entries = client.get("/api/reconciliation", headers=h).json()
    imported_entries = [e for e in entries if e["source_run_id"] == run_id]
    assert imported_entries
    assert any(not e["account_no"] for e in imported_entries), "expected an uncategorized line in the fixture"
    assert all(e["notes"] != "Uncategorized - add a rule" for e in imported_entries)

    # Every imported line traces back to the Drive-archived copy of whichever
    # raw file it actually came from - the bank CSV for plain bank lines, the
    # Stripe CSV for exploded donation lines - not just whichever file was
    # uploaded last.
    bank_sourced = [e for e in imported_entries if e["bank_description"] and "stripe" not in e["bank_description"].lower()]
    stripe_sourced = [e for e in imported_entries if "orig co name:stripe" in e["bank_description"].lower()]
    assert bank_sourced and stripe_sourced
    assert all(e["source_file_name"] == "bank.csv" and e["source_file_link"] == BANK_FILE_LINK for e in bank_sourced)
    assert all(
        e["source_file_name"] == "stripe.csv" and e["source_file_link"] == STRIPE_FILE_LINK
        for e in stripe_sourced
    )

    # Description is a live join to the matching bank-keyword rule's own
    # Description, not a value stamped in at import time - setting one on
    # the SAMS CLUB rule after the fact must show up immediately on every
    # already-imported line it matches, with no reimport needed.
    sams_lines = [e for e in imported_entries if "sams club" in e["bank_description"].lower()]
    assert sams_lines
    assert all(e["description"] == "" for e in sams_lines)
    sams_rule = next(
        r
        for r in client.get("/api/rules", headers=h).json()
        if r["rule_type"] == "bank_keyword" and r["pattern"] == "SAMS CLUB"
    )
    upd = client.put(
        f"/api/rules/{sams_rule['id']}", headers=h, json={"description": "Sams Club"}
    )
    assert upd.status_code == 200, upd.text
    entries_after = client.get("/api/reconciliation", headers=h).json()
    sams_lines_after = [e for e in entries_after if e["source_run_id"] == run_id and e["id"] in {s["id"] for s in sams_lines}]
    assert sams_lines_after
    assert all(e["description"] == "Sams Club" for e in sams_lines_after)

    # A manually-typed description is never overwritten by a rule's.
    manual = sams_lines_after[0]
    client.put(
        f"/api/reconciliation/{manual['id']}", headers=h, json={"description": "Manually typed"}
    )
    entries_manual = client.get("/api/reconciliation", headers=h).json()
    manual_after = next(e for e in entries_manual if e["id"] == manual["id"])
    assert manual_after["description"] == "Manually typed"

    # Re-importing the exact same run must skip everything - no duplicates.
    r2 = client.post(
        f"/api/reconciliation/import-run/{run_id}",
        headers=h,
        json={"bank_account_id": bank_account_id},
    )
    assert r2.status_code == 200, r2.text
    second = r2.json()
    assert second["imported"] == 0
    assert second["skipped_duplicates"] == first["imported"]


def test_imported_entry_has_derived_statement_description_and_is_editable():
    h = auth_header()
    run_id = _run_upload()
    bank_account_id = _bank_account_id()
    client.post(
        f"/api/reconciliation/import-run/{run_id}",
        headers=h,
        json={"bank_account_id": bank_account_id},
    )

    r = client.get("/api/reconciliation", headers=h)
    assert r.status_code == 200
    entries = r.json()
    assert entries

    categorized = [e for e in entries if e["account_no"]]
    assert categorized, "expected at least one categorized entry"
    entry = categorized[0]
    # statement_description must come from the linked Chart of Accounts row,
    # not be independently settable.
    coa = client.get("/api/accounts", headers=h).json()
    coa_desc = next(a["statement_description"] for a in coa if a["account_no"] == entry["account_no"])
    assert entry["statement_description"] == coa_desc
    assert entry["bank_account_name"] == "Chase Operating"

    upd = client.put(
        f"/api/reconciliation/{entry['id']}",
        headers=h,
        json={"notes": "reviewed", "reconciled": True},
    )
    assert upd.status_code == 200, upd.text
    assert upd.json()["notes"] == "reviewed"
    assert upd.json()["reconciled"] is True


def test_receipt_fields_round_trip_and_default_blank():
    h = auth_header()
    run_id = _run_upload()
    bank_account_id = _bank_account_id()
    client.post(
        f"/api/reconciliation/import-run/{run_id}",
        headers=h,
        json={"bank_account_id": bank_account_id},
    )
    entries = client.get("/api/reconciliation", headers=h).json()
    entry = entries[0]
    assert entry["receipt_file_id"] == ""
    assert entry["receipt_file_name"] == ""
    assert entry["receipt_web_view_link"] == ""

    upd = client.put(
        f"/api/reconciliation/{entry['id']}",
        headers=h,
        json={
            "receipt_file_id": "file123",
            "receipt_file_name": "receipt.pdf",
            "receipt_web_view_link": "https://drive.google.com/file/d/file123/view",
        },
    )
    assert upd.status_code == 200, upd.text
    body = upd.json()
    assert body["receipt_file_id"] == "file123"
    assert body["receipt_file_name"] == "receipt.pdf"
    assert body["receipt_web_view_link"] == "https://drive.google.com/file/d/file123/view"

    # Clearing it back out (removing the attached receipt) must also work.
    cleared = client.put(
        f"/api/reconciliation/{entry['id']}",
        headers=h,
        json={"receipt_file_id": "", "receipt_file_name": "", "receipt_web_view_link": ""},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["receipt_file_id"] == ""


def test_delete_entry():
    h = auth_header()
    run_id = _run_upload()
    bank_account_id = _bank_account_id()
    client.post(
        f"/api/reconciliation/import-run/{run_id}",
        headers=h,
        json={"bank_account_id": bank_account_id},
    )
    entries = client.get("/api/reconciliation", headers=h).json()
    entry_id = entries[0]["id"]
    assert client.delete(f"/api/reconciliation/{entry_id}", headers=h).status_code == 204
    remaining_ids = [e["id"] for e in client.get("/api/reconciliation", headers=h).json()]
    assert entry_id not in remaining_ids


def test_split_and_unsplit_entry():
    h = auth_header()
    run_id = _run_upload()
    bank_account_id = _bank_account_id()
    client.post(
        f"/api/reconciliation/import-run/{run_id}",
        headers=h,
        json={"bank_account_id": bank_account_id},
    )
    entries = client.get("/api/reconciliation", headers=h).json()
    target = next(e for e in entries if e["amount"] != 0)
    original_amount = target["amount"]
    original_id = target["id"]

    half = round(original_amount / 2, 2)
    remainder = round(original_amount - half, 2)
    split = client.post(
        f"/api/reconciliation/{original_id}/split",
        headers=h,
        json={
            "lines": [
                {"description": "Check A", "amount": half},
                {"description": "Check B", "amount": remainder},
            ]
        },
    )
    assert split.status_code == 200, split.text
    children = split.json()
    assert len(children) == 2
    assert {c["split_parent_id"] for c in children} == {original_id}
    assert round(sum(c["amount"] for c in children), 2) == round(original_amount, 2)

    # Parent is hidden from the list; children are visible instead.
    after_split = client.get("/api/reconciliation", headers=h).json()
    ids_after_split = {e["id"] for e in after_split}
    assert original_id not in ids_after_split
    assert children[0]["id"] in ids_after_split
    assert children[1]["id"] in ids_after_split

    # Undo: children removed, original reappears untouched.
    undo = client.post(f"/api/reconciliation/{original_id}/unsplit", headers=h)
    assert undo.status_code == 200, undo.text
    assert undo.json()["amount"] == original_amount

    after_undo = client.get("/api/reconciliation", headers=h).json()
    ids_after_undo = {e["id"] for e in after_undo}
    assert original_id in ids_after_undo
    assert children[0]["id"] not in ids_after_undo
    assert children[1]["id"] not in ids_after_undo


def test_split_rejects_mismatched_total():
    h = auth_header()
    run_id = _run_upload()
    bank_account_id = _bank_account_id()
    client.post(
        f"/api/reconciliation/import-run/{run_id}",
        headers=h,
        json={"bank_account_id": bank_account_id},
    )
    entries = client.get("/api/reconciliation", headers=h).json()
    target = next(e for e in entries if e["amount"] != 0 and e["split_parent_id"] is None)

    bad = client.post(
        f"/api/reconciliation/{target['id']}/split",
        headers=h,
        json={"lines": [{"description": "Only part", "amount": 0.01}]},
    )
    assert bad.status_code == 400


def test_split_preserves_dedup_on_reimport():
    h = auth_header()
    run_id = _run_upload()
    bank_account_id = _bank_account_id()
    client.post(
        f"/api/reconciliation/import-run/{run_id}",
        headers=h,
        json={"bank_account_id": bank_account_id},
    )
    entries = client.get("/api/reconciliation", headers=h).json()
    target = next(e for e in entries if e["amount"] != 0 and e["split_parent_id"] is None)
    original_id = target["id"]
    original_amount = target["amount"]

    half = round(original_amount / 2, 2)
    remainder = round(original_amount - half, 2)
    client.post(
        f"/api/reconciliation/{original_id}/split",
        headers=h,
        json={"lines": [{"amount": half}, {"amount": remainder}]},
    )

    # Re-importing the same run must still skip the now-split line (its
    # dedup_key lives on, so it must not resurrect as a new duplicate).
    reimport = client.post(
        f"/api/reconciliation/import-run/{run_id}",
        headers=h,
        json={"bank_account_id": bank_account_id},
    )
    assert reimport.status_code == 200, reimport.text
    assert reimport.json()["imported"] == 0


def test_reconcile_actual_with_accruals_replaces_and_hides_both_sides():
    h = auth_header()
    run_id = _run_upload()
    bank_account_id = _bank_account_id()
    client.post(
        f"/api/reconciliation/import-run/{run_id}",
        headers=h,
        json={"bank_account_id": bank_account_id},
    )
    entries = client.get("/api/reconciliation", headers=h).json()
    target = next(e for e in entries if e["amount"] != 0 and e["split_parent_id"] is None)
    actual_id = target["id"]
    actual_amount = target["amount"]

    half = round(actual_amount / 2, 2)
    remainder = round(actual_amount - half, 2)
    a1 = client.post(
        "/api/accrual", headers=h, json={"description": "Accrual A", "amount": half}
    ).json()
    a2 = client.post(
        "/api/accrual", headers=h, json={"description": "Accrual B", "amount": remainder}
    ).json()

    r = client.post(
        f"/api/reconciliation/{actual_id}/reconcile-with-accruals",
        headers=h,
        json={"accrual_entry_ids": [a1["id"], a2["id"]]},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["actual_lines"]) == 2
    assert {l["split_parent_id"] for l in body["actual_lines"]} == {actual_id}
    assert round(sum(l["amount"] for l in body["actual_lines"]), 2) == round(actual_amount, 2)
    assert set(body["reconciled_accrual_ids"]) == {a1["id"], a2["id"]}
    # Bank-level fields are retained from the actual, not the accrual.
    assert all(l["bank_description"] == target["bank_description"] for l in body["actual_lines"])
    assert all(l["reconciled"] for l in body["actual_lines"])

    # Original actual is hidden (same as a manual split); accrual entries
    # are hidden too, rather than deleted.
    after = client.get("/api/reconciliation", headers=h).json()
    assert actual_id not in {e["id"] for e in after}
    remaining_accruals = {e["id"] for e in client.get("/api/accrual", headers=h).json()}
    assert a1["id"] not in remaining_accruals
    assert a2["id"] not in remaining_accruals
    # Still exist in the DB, just hidden - and traceable back to the actual.
    a1_after = client.put(f"/api/accrual/{a1['id']}", headers=h, json={}).json()
    assert a1_after["reconciled_to_actual_id"] == actual_id
    assert a1_after["reconciled"] is True


def test_reconcile_with_accruals_rejects_mismatched_total():
    h = auth_header()
    run_id = _run_upload()
    bank_account_id = _bank_account_id()
    client.post(
        f"/api/reconciliation/import-run/{run_id}",
        headers=h,
        json={"bank_account_id": bank_account_id},
    )
    entries = client.get("/api/reconciliation", headers=h).json()
    target = next(e for e in entries if e["amount"] != 0 and e["split_parent_id"] is None)

    accrual = client.post(
        "/api/accrual", headers=h, json={"description": "Too small", "amount": 0.01}
    ).json()
    r = client.post(
        f"/api/reconciliation/{target['id']}/reconcile-with-accruals",
        headers=h,
        json={"accrual_entry_ids": [accrual["id"]]},
    )
    assert r.status_code == 400


def test_reconcile_with_accruals_rejects_reimbursement_linked_entries():
    """An AccrualEntry still linked from a reimbursement_lines row (a real
    FK) must be rejected, not silently deleted - that's the exact failure
    mode fixed in delete_accrual_entries (see its docstring)."""
    from app.models import AccrualEntry, Reimbursement, ReimbursementLine  # noqa: E402
    from test_auth import TestingSession  # noqa: E402

    h = auth_header()
    run_id = _run_upload()
    bank_account_id = _bank_account_id()
    client.post(
        f"/api/reconciliation/import-run/{run_id}",
        headers=h,
        json={"bank_account_id": bank_account_id},
    )
    entries = client.get("/api/reconciliation", headers=h).json()
    target = next(e for e in entries if e["amount"] != 0 and e["split_parent_id"] is None)

    with TestingSession() as db:
        entry = AccrualEntry(description="Linked to reimbursement", amount=-10.0)
        db.add(entry)
        db.flush()
        reimb = Reimbursement(
            submitter_email="reconcile-test@example.com",
            name="reconcile-test@example.com-linked",
            status="pending",
            total_amount=-10.0,
        )
        db.add(reimb)
        db.flush()
        line = ReimbursementLine(
            reimbursement_id=reimb.id, account_no=None, amount=-10.0, accrual_entry_id=entry.id
        )
        db.add(line)
        db.commit()
        linked_accrual_id = entry.id

    r = client.post(
        f"/api/reconciliation/{target['id']}/reconcile-with-accruals",
        headers=h,
        json={"accrual_entry_ids": [linked_accrual_id]},
    )
    assert r.status_code == 400
    assert "Reimbursement" in r.json()["detail"]


def test_prior_year_end_date_setting_is_seeded_and_editable():
    h = auth_header()
    r = client.get("/api/settings/prior_year_end_date", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["value"].endswith("-12-31")

    upd = client.put(
        "/api/settings/prior_year_end_date", headers=h, json={"value": "2025-12-31"}
    )
    assert upd.status_code == 200, upd.text
    assert upd.json()["value"] == "2025-12-31"
