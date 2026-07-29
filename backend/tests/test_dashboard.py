"""Home dashboard tests: bank account balances, Income/Expense YTD (which
delegates to the same aggregation as Income Statement - see
test_income_statement.py for the Plan/Actuals/sign-convention math itself),
and the last-posted-date staleness check. Uses before/after deltas rather
than absolute values, since other test files share this in-memory DB and
already contribute Reconciliation/Accrual/Budget data."""

from datetime import date

from test_auth import TestingSession, auth_header, client  # noqa: E402

from app.models import ReconciliationEntry  # noqa: E402


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


def test_last_posted_date_reflects_actual_not_accrual():
    """Regression test: this used to be the max created_at across
    Reconciliation + Accrual (a row-creation timestamp), which meant a
    purely-planned Accrual entry could make the dashboard claim the books
    were current even with no real bank data posted. Now it's strictly the
    max posted_date on the Actual (Reconciliation) ledger."""
    h = auth_header()
    before = client.get("/api/dashboard", headers=h).json()["last_posted_date"]
    _add_accrual("Dashboard last-posted-date isolation test", 1.0, "2020-01-01")
    unchanged = client.get("/api/dashboard", headers=h).json()["last_posted_date"]
    assert unchanged == before

    with TestingSession() as db:
        db.add(
            ReconciliationEntry(
                transaction_date=date(2027, 5, 1),
                posted_date=date(2027, 5, 1),
                account_no="I101010",
                description="Dashboard last-posted-date test",
                amount=1.0,
                dedup_key="dashboard-last-posted-date-test",
            )
        )
        db.commit()

    after = client.get("/api/dashboard", headers=h).json()["last_posted_date"]
    assert after == "2027-05-01"
