"""Accrual ledger tests: manual create, editing, split/unsplit."""

from test_auth import auth_header, client  # reuse the shared TestClient/app setup


def _bank_account_id() -> int:
    h = auth_header()
    r = client.get("/api/bank-accounts", headers=h)
    assert r.status_code == 200
    accounts = r.json()
    assert accounts, "expected the seeded 'Chase Operating' bank account"
    return accounts[0]["id"]


def _create_entry(**overrides) -> dict:
    h = auth_header()
    payload = {
        "transaction_date": "2026-01-15",
        "date_posted": "2026-01-15",
        "account_no": "I101010",
        "description": "Test reimbursement",
        "bank_account_id": _bank_account_id(),
        "method": "Zelle",
        "amount": 100.0,
        "is_reimbursement": True,
    }
    payload.update(overrides)
    r = client.post("/api/accrual", headers=h, json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def test_create_and_list_entry():
    entry = _create_entry(description="Golf Tournament reimbursement")
    assert entry["description"] == "Golf Tournament reimbursement"
    assert entry["is_reimbursement"] is True
    # statement_description is derived live from the Chart of Accounts, like
    # the Reconciliation ledger - not independently settable.
    assert entry["statement_description"] == "Income - Income - Pledges"

    h = auth_header()
    ids = [e["id"] for e in client.get("/api/accrual", headers=h).json()]
    assert entry["id"] in ids


def test_update_entry():
    entry = _create_entry()
    h = auth_header()
    upd = client.put(
        f"/api/accrual/{entry['id']}",
        headers=h,
        json={"notes": "confirmed", "reconciled": True},
    )
    assert upd.status_code == 200, upd.text
    assert upd.json()["notes"] == "confirmed"
    assert upd.json()["reconciled"] is True


def test_delete_entry():
    entry = _create_entry()
    h = auth_header()
    assert client.delete(f"/api/accrual/{entry['id']}", headers=h).status_code == 204
    ids = [e["id"] for e in client.get("/api/accrual", headers=h).json()]
    assert entry["id"] not in ids


def test_split_and_unsplit_entry():
    entry = _create_entry(amount=90.0, description="VBS supplies (multiple people)")
    h = auth_header()

    split = client.post(
        f"/api/accrual/{entry['id']}/split",
        headers=h,
        json={
            "lines": [
                {"description": "Christina", "amount": 30.0},
                {"description": "Sheelu", "amount": 30.0},
                {"description": "Christy", "amount": 30.0},
            ]
        },
    )
    assert split.status_code == 200, split.text
    children = split.json()
    assert len(children) == 3
    assert {c["split_parent_id"] for c in children} == {entry["id"]}

    ids_after_split = {e["id"] for e in client.get("/api/accrual", headers=h).json()}
    assert entry["id"] not in ids_after_split
    assert all(c["id"] in ids_after_split for c in children)

    undo = client.post(f"/api/accrual/{entry['id']}/unsplit", headers=h)
    assert undo.status_code == 200, undo.text
    assert undo.json()["amount"] == 90.0

    ids_after_undo = {e["id"] for e in client.get("/api/accrual", headers=h).json()}
    assert entry["id"] in ids_after_undo
    assert all(c["id"] not in ids_after_undo for c in children)


def test_split_rejects_mismatched_total():
    entry = _create_entry(amount=50.0)
    h = auth_header()
    bad = client.post(
        f"/api/accrual/{entry['id']}/split",
        headers=h,
        json={"lines": [{"description": "Only part", "amount": 10.0}]},
    )
    assert bad.status_code == 400
