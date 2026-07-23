"""Home dashboard tests: bank account balances, Income/Expense YTD (which
delegates to the same aggregation as Income Statement - see
test_income_statement.py for the Plan/Actuals/sign-convention math itself),
and the last-entry timestamp. Uses before/after deltas rather than absolute
values, since other test files share this in-memory DB and already
contribute Reconciliation/Accrual/Budget data."""

from test_auth import auth_header, client


def _bank_account_id() -> int:
    h = auth_header()
    return client.get("/api/bank-accounts", headers=h).json()[0]["id"]


def _add_accrual(description: str, amount: float, txn_date: str) -> None:
    h = auth_header()
    r = client.post(
        "/api/accrual",
        headers=h,
        json={
            "transaction_date": txn_date,
            "posted_date": txn_date,
            "account_no": "I101010",
            "description": description,
            "bank_account_id": _bank_account_id(),
            "amount": amount,
        },
    )
    assert r.status_code == 201, r.text


def test_dashboard_shape_and_bank_accounts():
    h = auth_header()
    r = client.get("/api/dashboard", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "year" in body
    names = [b["name"] for b in body["bank_accounts"]]
    assert "Chase Operating" in names


def test_income_ytd_increases_by_new_cy_accrual_amount():
    h = auth_header()
    before = client.get("/api/dashboard", headers=h).json()["income_ytd"]
    _add_accrual("Dashboard YTD test", 123.45, "2026-02-01")
    after = client.get("/api/dashboard", headers=h).json()["income_ytd"]
    assert round(after - before, 2) == 123.45


def test_py_dated_entry_does_not_affect_income_ytd():
    h = auth_header()
    before = client.get("/api/dashboard", headers=h).json()["income_ytd"]
    _add_accrual("Dashboard PY test", 999.0, "2020-01-01")
    after = client.get("/api/dashboard", headers=h).json()["income_ytd"]
    assert after == before


def test_last_entry_at_updates_after_new_entry():
    h = auth_header()
    before = client.get("/api/dashboard", headers=h).json()["last_entry_at"]
    _add_accrual("Dashboard timestamp test", 1.0, "2026-02-02")
    after = client.get("/api/dashboard", headers=h).json()["last_entry_at"]
    assert after is not None
    if before is not None:
        assert after >= before
