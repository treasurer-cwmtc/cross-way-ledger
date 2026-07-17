"""Reconciliation ledger tests: import-from-run dedup, editing, listing."""

from pathlib import Path

from test_auth import auth_header, client  # reuse the shared TestClient/app setup

FIXTURES = Path(__file__).parent


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
