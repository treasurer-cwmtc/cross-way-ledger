"""Income Statement tests: Plan (Budget) vs Actuals (Accrual, CY only),
grouped by Statement Category -> Statement Item, with the sign convention
that Income favors actual > plan and Expenditures favors actual < plan.

Uses account numbers ("Interest & Dividend Income" / "Educational
Allowance") not touched by any other test file, since all tests share one
in-memory DB - picking untouched accounts avoids cross-test pollution
skewing the aggregated totals."""

from test_auth import auth_header, client


def _bank_account_id() -> int:
    h = auth_header()
    return client.get("/api/bank-accounts", headers=h).json()[0]["id"]


def _set_cy_cutoff(cutoff: str = "2025-12-31") -> None:
    h = auth_header()
    r = client.put("/api/settings/prior_year_end_date", headers=h, json={"value": cutoff})
    assert r.status_code == 200, r.text


def _add_accrual(account_no: str, amount: float, txn_date: str) -> None:
    h = auth_header()
    r = client.post(
        "/api/accrual",
        headers=h,
        json={
            "transaction_date": txn_date,
            "date_posted": txn_date,
            "account_no": account_no,
            "description": "Income statement test entry",
            "bank_account_id": _bank_account_id(),
            "amount": amount,
        },
    )
    assert r.status_code == 201, r.text


def _find_row(groups, statement_category, label):
    group = next(g for g in groups if g["statement_category"] == statement_category)
    return next(r for r in group["rows"] if r["label"] == label)


def test_income_section_favors_actual_above_plan():
    _set_cy_cutoff("2025-12-31")
    h = auth_header()
    client.post(
        "/api/budget",
        headers=h,
        json={"transaction_date": "2026-01-01", "account_no": "B101110", "amount": 1000.0},
    )
    _add_accrual("I101610", 300.0, "2026-02-01")  # CY: after 2025-12-31
    _add_accrual("I101610", 50.0, "2025-06-01")  # PY: before cutoff, excluded

    r = client.get("/api/income-statement", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["year"] == 2026

    row = _find_row(body["income_groups"], "Income", "Interest & Dividend Income")
    assert row["plan"] == 1000.0
    assert row["actuals"] == 300.0  # PY row excluded
    assert row["variance"] == 300.0 - 1000.0  # actual - plan: unfavorable, shown negative


def test_expense_section_favors_actual_below_plan():
    _set_cy_cutoff("2025-12-31")
    h = auth_header()
    client.post(
        "/api/budget",
        headers=h,
        json={"transaction_date": "2026-01-01", "account_no": "B111110", "amount": 500.0},
    )
    # Expense amounts are stored as debits (negative).
    _add_accrual("E101110", -200.0, "2026-02-01")

    r = client.get("/api/income-statement", headers=h)
    body = r.json()

    row = _find_row(body["expense_groups"], "Vicar Related", "Educational Allowance")
    assert row["plan"] == 500.0
    assert row["actuals"] == 200.0  # abs() of the stored debit amount
    assert row["variance"] == 500.0 - 200.0  # plan - actual: favorable (under budget), positive

    group = next(g for g in body["expense_groups"] if g["statement_category"] == "Vicar Related")
    assert group["subtotal"]["plan"] >= 500.0
    assert group["subtotal"]["actuals"] >= 200.0
