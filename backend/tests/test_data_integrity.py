"""Data integrity tests for the account_no foreign key constraints (added on
top of the existing chart_of_accounts table) and the delete_account
ledger-usage guard - both new since the database normalization pass."""

from test_auth import auth_header, client


def _bank_account_id() -> int:
    h = auth_header()
    accounts = client.get("/api/bank-accounts", headers=h).json()
    assert accounts, "expected the seeded 'Chase Operating' bank account"
    return accounts[0]["id"]


def test_accrual_create_rejects_unknown_account_no():
    h = auth_header()
    payload = {
        "transaction_date": "2026-01-15",
        "posted_date": "2026-01-15",
        "account_no": "Z999999",  # not a real Chart of Accounts row
        "description": "Bad account",
        "bank_account_id": _bank_account_id(),
        "method": "Zelle",
        "amount": 100.0,
    }
    r = client.post("/api/accrual", headers=h, json=payload)
    assert r.status_code == 400, r.text


def test_budget_create_rejects_unknown_account_no():
    h = auth_header()
    payload = {
        "transaction_date": "2026-01-01",
        "account_no": "Z999999",
        "description": "Bad account",
        "amount": 500.0,
    }
    r = client.post("/api/budget", headers=h, json=payload)
    assert r.status_code == 400, r.text


def test_accrual_create_allows_blank_account_no():
    """"" (uncategorized) is still a valid value - it's normalized to NULL
    under the hood rather than rejected."""
    h = auth_header()
    payload = {
        "transaction_date": "2026-01-15",
        "posted_date": "2026-01-15",
        "account_no": "",
        "description": "Uncategorized",
        "bank_account_id": _bank_account_id(),
        "method": "Zelle",
        "amount": 50.0,
    }
    r = client.post("/api/accrual", headers=h, json=payload)
    assert r.status_code == 201, r.text
    assert r.json()["account_no"] == ""


def test_delete_account_blocked_by_budget_entry():
    h = auth_header()
    account_no = "B101310"  # seeded Pledges budget account, unused by any rule
    client.post(
        "/api/budget",
        headers=h,
        json={
            "transaction_date": "2026-01-01",
            "account_no": account_no,
            "description": "In-use budget line",
            "amount": 100.0,
        },
    )
    r = client.delete(f"/api/accounts/{account_no}", headers=h)
    assert r.status_code == 400, r.text
    assert "Budget" in r.json()["detail"]


def test_delete_account_blocked_by_accrual_entry():
    h = auth_header()
    account_no = "I101113"  # seeded Income account not referenced by any rule
    client.post(
        "/api/accrual",
        headers=h,
        json={
            "transaction_date": "2026-01-15",
            "posted_date": "2026-01-15",
            "account_no": account_no,
            "description": "In-use accrual entry",
            "bank_account_id": _bank_account_id(),
            "method": "Zelle",
            "amount": 25.0,
        },
    )
    r = client.delete(f"/api/accounts/{account_no}", headers=h)
    assert r.status_code == 400, r.text
    assert "Accrual" in r.json()["detail"]
