"""Budget ledger tests: plain CRUD (a Budget-category account can have more
than one line in the same year - e.g. separate "Salary" and "Health
Insurance" lines both posted to the same "Salaries and Benefits" account),
plus copy-year."""

from test_auth import auth_header, client


def _create_entry(**overrides) -> dict:
    h = auth_header()
    payload = {
        "transaction_date": "2026-01-01",
        "account_no": "B101310",
        "description": "Budget",
        "amount": 1000.0,
        "notes": "",
    }
    payload.update(overrides)
    r = client.post("/api/budget", headers=h, json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def test_create_and_list_entry():
    entry = _create_entry(amount=215850.0, notes="Pledge campaign target")
    assert entry["amount"] == 215850.0
    assert entry["statement_category"] == "Income"
    assert entry["statement_item"] == "Pledges"

    h = auth_header()
    ids = [e["id"] for e in client.get("/api/budget", headers=h, params={"year": 2026}).json()]
    assert entry["id"] in ids


def test_multiple_entries_same_account_same_year():
    a = _create_entry(account_no="B111000", description="Base", amount=500.0)
    b = _create_entry(account_no="B111000", description="Increase", amount=100.0)
    h = auth_header()
    rows = [
        e
        for e in client.get("/api/budget", headers=h, params={"year": 2026}).json()
        if e["account_no"] == "B111000"
    ]
    ids = {e["id"] for e in rows}
    assert a["id"] in ids and b["id"] in ids
    assert round(sum(e["amount"] for e in rows), 2) >= 600.0


def test_update_entry():
    entry = _create_entry()
    h = auth_header()
    upd = client.put(f"/api/budget/{entry['id']}", headers=h, json={"amount": 42.0, "notes": "revised"})
    assert upd.status_code == 200, upd.text
    assert upd.json()["amount"] == 42.0
    assert upd.json()["notes"] == "revised"


def test_delete_entry():
    entry = _create_entry()
    h = auth_header()
    assert client.delete(f"/api/budget/{entry['id']}", headers=h).status_code == 204
    ids = [e["id"] for e in client.get("/api/budget", headers=h, params={"year": 2026}).json()]
    assert entry["id"] not in ids


def test_year_filter():
    entry_2026 = _create_entry(transaction_date="2026-01-01")
    entry_2027 = _create_entry(transaction_date="2027-01-01")
    h = auth_header()
    ids_2026 = {e["id"] for e in client.get("/api/budget", headers=h, params={"year": 2026}).json()}
    ids_2027 = {e["id"] for e in client.get("/api/budget", headers=h, params={"year": 2027}).json()}
    assert entry_2026["id"] in ids_2026 and entry_2026["id"] not in ids_2027
    assert entry_2027["id"] in ids_2027 and entry_2027["id"] not in ids_2026


def test_copy_year():
    h = auth_header()
    # Isolate this test in its own untouched source year.
    _create_entry(account_no="B101310", description="Copy source A", amount=111.0, transaction_date="2030-01-01")
    _create_entry(account_no="B111000", description="Copy source B", amount=222.0, transaction_date="2030-01-01")

    copy = client.post(
        "/api/budget/copy-year", headers=h, json={"from_year": 2030, "to_year": 2031}
    )
    assert copy.status_code == 200, copy.text
    assert copy.json()["copied"] == 2

    rows_2031 = client.get("/api/budget", headers=h, params={"year": 2031}).json()
    descriptions = {e["description"] for e in rows_2031}
    assert {"Copy source A", "Copy source B"} <= descriptions
    for e in rows_2031:
        if e["description"] in ("Copy source A", "Copy source B"):
            assert e["transaction_date"] == "2031-01-01"

    # Re-running without overwrite is refused.
    again = client.post("/api/budget/copy-year", headers=h, json={"from_year": 2030, "to_year": 2031})
    assert again.status_code == 400

    # With overwrite, it replaces the target year's entries.
    overwritten = client.post(
        "/api/budget/copy-year",
        headers=h,
        json={"from_year": 2030, "to_year": 2031, "overwrite": True},
    )
    assert overwritten.status_code == 200, overwritten.text
    assert overwritten.json()["copied"] == 2
