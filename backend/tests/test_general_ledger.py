"""General Ledger tests: the union of Accrual + Budget rows (Reconciliation
rows go through the exact same `_entry_to_line` helper, so aren't
re-exercised here - see test_accrual.py / test_reconciler.py for that side)."""

from test_auth import auth_header, client


def _bank_account_id() -> int:
    h = auth_header()
    r = client.get("/api/bank-accounts", headers=h)
    return r.json()[0]["id"]


def test_union_includes_accrual_and_budget_rows():
    h = auth_header()
    accrual = client.post(
        "/api/accrual",
        headers=h,
        json={
            "transaction_date": "2027-03-01",
            "date_posted": "2027-03-01",
            "account_no": "I101210",
            "description": "GL union test entry",
            "bank_account_id": _bank_account_id(),
            "method": "Check",
            "amount": 42.0,
        },
    )
    assert accrual.status_code == 201, accrual.text

    budget = client.post(
        "/api/budget",
        headers=h,
        json={
            "transaction_date": "2027-01-01",
            "account_no": "B101310",
            "description": "GL union test budget",
            "amount": 5000.0,
        },
    )
    assert budget.status_code == 201, budget.text

    r = client.get("/api/general-ledger", headers=h, params={"year": 2027})
    assert r.status_code == 200, r.text
    lines = r.json()

    accrual_lines = [l for l in lines if l["source"] == "accrual" and l["description"] == "GL union test entry"]
    assert len(accrual_lines) == 1
    assert accrual_lines[0]["amount"] == 42.0
    assert accrual_lines[0]["statement_item"] == "Sunday Offertory"

    budget_lines = [l for l in lines if l["source"] == "budget" and l["description"] == "GL union test budget"]
    assert len(budget_lines) == 1
    assert budget_lines[0]["amount"] == 5000.0
    assert budget_lines[0]["transaction_date"] == "2027-01-01"


def test_year_filter_excludes_other_years():
    h = auth_header()
    client.post(
        "/api/accrual",
        headers=h,
        json={
            "transaction_date": "2019-05-01",
            "date_posted": "2019-05-01",
            "account_no": "I101210",
            "description": "Old year entry",
            "bank_account_id": _bank_account_id(),
            "amount": 7.0,
        },
    )
    r = client.get("/api/general-ledger", headers=h, params={"year": 2027})
    descriptions = [l["description"] for l in r.json()]
    assert "Old year entry" not in descriptions

    r_all = client.get("/api/general-ledger", headers=h, params={"year": 2019})
    descriptions_2019 = [l["description"] for l in r_all.json()]
    assert "Old year entry" in descriptions_2019


def test_zero_amount_budget_rows_are_excluded():
    h = auth_header()
    r = client.get("/api/general-ledger", headers=h, params={"year": 2026})
    budget_lines = [l for l in r.json() if l["source"] == "budget"]
    # Only accounts with a non-zero amount entered should show up as lines.
    assert all(l["amount"] != 0 for l in budget_lines)
