"""Restricted Net Assets ledger tests: one row per transfer (from/to
account), and General Ledger synthesizing the two per-account lines."""

from test_auth import auth_header, client  # reuse the shared TestClient/app setup


def _create_transfer(**overrides) -> dict:
    h = auth_header()
    payload = {
        "transaction_date": "2027-12-31",
        "from_account_no": "E151910",
        "to_account_no": "I101210",
        "amount": 500.0,
        "description": "Release Golf Tournament funds to Missions",
        "notes": "",
    }
    payload.update(overrides)
    r = client.post("/api/restricted-transfers", headers=h, json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def test_create_and_list_transfer():
    entry = _create_transfer()
    assert entry["from_account_no"] == "E151910"
    assert entry["to_account_no"] == "I101210"
    assert entry["amount"] == 500.0
    # Statement descriptions resolved live from the Chart of Accounts, like
    # every other ledger in the app.
    assert entry["from_statement_description"]
    assert entry["to_statement_description"]

    h = auth_header()
    r = client.get("/api/restricted-transfers", headers=h)
    assert r.status_code == 200
    ids = [e["id"] for e in r.json()]
    assert entry["id"] in ids


def test_update_and_delete_transfer():
    entry = _create_transfer(amount=250.0)
    h = auth_header()
    r = client.put(
        f"/api/restricted-transfers/{entry['id']}", headers=h, json={"amount": 300.0}
    )
    assert r.status_code == 200, r.text
    assert r.json()["amount"] == 300.0

    r = client.delete(f"/api/restricted-transfers/{entry['id']}", headers=h)
    assert r.status_code == 204
    r = client.get("/api/restricted-transfers", headers=h)
    assert entry["id"] not in [e["id"] for e in r.json()]


def test_general_ledger_synthesizes_two_lines_per_transfer():
    entry = _create_transfer(
        transaction_date="2027-11-15", from_account_no="E151910", to_account_no="I101210", amount=750.0
    )
    h = auth_header()
    r = client.get("/api/general-ledger", headers=h, params={"year": 2027})
    assert r.status_code == 200
    lines = [l for l in r.json() if l["source"] == "restricted_transfer"]
    from_line = next(l for l in lines if l["account_no"] == "E151910" and abs(l["amount"] + 750.0) < 0.01)
    to_line = next(l for l in lines if l["account_no"] == "I101210" and abs(l["amount"] - 750.0) < 0.01)
    assert from_line["id"] == -entry["id"]
    assert to_line["id"] == entry["id"]
    assert from_line["transaction_date"] == "2027-11-15"
    assert to_line["transaction_date"] == "2027-11-15"
