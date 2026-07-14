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
