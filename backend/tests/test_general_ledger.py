"""General Ledger tests: the union of Reconciliation + Accrual + Budget rows -
General Ledger must show exactly what each entry's own tab (Actual/Accrual/
Budget) shows, never a separately-derived value."""

from datetime import date

# test_auth must import first - it sets SECRET_KEY/ADMIN_PASSWORD env
# defaults before anything touches app.database (get_settings() is
# lru_cache'd, so whichever import runs first locks in those settings for
# the whole test session). app.models transitively imports app.database,
# so it has to come after.
from test_auth import TestingSession, auth_header, client  # noqa: E402

from app.models import CategoryRule, ReconciliationEntry  # noqa: E402


def _bank_account_id() -> int:
    h = auth_header()
    r = client.get("/api/bank-accounts", headers=h)
    return r.json()[0]["id"]


def test_reconciliation_description_matches_actual_tabs_live_rule_join():
    # The Actual tab resolves a blank Description via a live join to the
    # matching bank-keyword rule's own Description (see
    # reconciliation.py::_to_out) - General Ledger must show the same
    # resolved value for that row, not the raw (blank) stored column.
    with TestingSession() as db:
        rule = CategoryRule(
            rule_type="bank_keyword",
            pattern="GL DESC TEST KEYWORD",
            account_no="E151910",
            description="GL Desc Test Payee",
            priority=1,
        )
        db.add(rule)
        entry = ReconciliationEntry(
            transaction_date=None,
            posted_date=date(2027, 6, 1),
            account_no="E151910",
            description="",
            bank_description="ACH GL DESC TEST KEYWORD 06/01",
            amount=-10.0,
            dedup_key="gl-desc-test-key",
        )
        db.add(entry)
        db.commit()

    h = auth_header()
    actual = client.get("/api/reconciliation", headers=h).json()
    actual_row = next(e for e in actual if e["bank_description"] == "ACH GL DESC TEST KEYWORD 06/01")
    assert actual_row["description"] == "GL Desc Test Payee"

    general_ledger = client.get("/api/general-ledger", headers=h, params={"year": 2027}).json()
    gl_row = next(
        l
        for l in general_ledger
        if l["source"] == "reconciliation" and l["bank_description"] == "ACH GL DESC TEST KEYWORD 06/01"
    )
    assert gl_row["description"] == actual_row["description"] == "GL Desc Test Payee"


def test_union_includes_accrual_and_budget_rows():
    h = auth_header()
    accrual = client.post(
        "/api/accrual",
        headers=h,
        json={
            "transaction_date": "2027-03-01",
            "posted_date": "2027-03-01",
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

    # Reconciled mirrors the entry's own tab - Accrual isn't reconciled by
    # default; Budget/Transfer rows have no such concept so always False.
    assert accrual_lines[0]["reconciled"] is False
    assert budget_lines[0]["reconciled"] is False


def test_year_filter_excludes_other_years():
    h = auth_header()
    client.post(
        "/api/accrual",
        headers=h,
        json={
            "transaction_date": "2019-05-01",
            "posted_date": "2019-05-01",
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
