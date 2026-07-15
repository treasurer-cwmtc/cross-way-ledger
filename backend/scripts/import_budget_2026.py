"""One-time import of 2026 Budget entries, extracted by hand from the legacy
Google Sheet's Reconciliation tab (every row whose Statement Description
starts with "Budget" - 86 rows, 74 with a non-zero amount). Each row's
Statement Description was resolved to our seeded Chart of Accounts
account_no by matching Statement Category/Item/Detail names (the sheet's own
account numbers are cosmetic - ours are derived independently, see
docs/PROJECT.md's Chart of Accounts numbering notes). Cross-validated
against the sheet's own computed Income Statement Plan figures (Pledges
$215,850, Sunday Offertory $10,000, Salaries and Benefits $40,715 - all
matched) before running this.

Run once against a target backend, e.g.:
    BASE_URL=http://localhost:8000 ADMIN_PASSWORD=changeme \
      ../.venv/Scripts/python.exe import_budget_2026.py
"""

import json
import os
import urllib.parse
import urllib.request

BASE = os.environ.get("BASE_URL", "http://localhost:8000")
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "changeme")

# (account_no, description, amount, notes)
ENTRIES = [
    ("B101610", "Budget", 125000.00, ""),
    ("B141310", "Budget", 44400.00, ""),
    ("B161110", "Budget", 36000.00, ""),
    ("B111710", "Salary", 19096.20, "Assumed 3% increase"),
    ("B111710", "Health Insurance", 17640.00, "Assumed 5% increase"),
    ("B141410", "Budget", 13000.00, ""),
    ("B191310", "Budget", 7547.00, ""),
    ("B141710", "Budget", 10000.00, ""),
    ("B101710", "Budget", 8500.00, ""),
    ("B101810", "Budget", 8000.00, ""),
    ("B101912", "Budget", 7920.00, ""),
    ("B101910", "Budget", 7920.00, ""),
    ("B161210", "Budget", 6500.00, ""),
    ("B101911", "Budget", 7920.00, ""),
    ("B151210", "Budget", 6000.00, ""),
    ("B111810", "Budget", 5000.00, ""),
    ("B191610", "Budget", 5452.51, ""),
    ("B191010", "Budget", 5000.00, ""),
    ("B191411", "Navjeevan", 2621.91, ""),
    ("B131510", "Budget", 4000.00, ""),
    ("B131210", "Budget", 3600.00, ""),
    ("B191412", "Oklahoma Mission", 3156.67, ""),
    ("B151810", "Budget", 2600.00, ""),
    ("B121610", "Budget", 2500.00, ""),
    ("B161310", "Budget", 2500.00, ""),
    ("B141210", "Budget", 2500.00, ""),
    ("B111710", "Retirement Plan", 2546.16, "Assumed 3% increase"),
    ("B191110", "Budget", 44282.95, ""),
    ("B151410", "Budget", 2000.00, ""),
    ("B141010", "Budget", 2000.00, ""),
    ("B151710", "Budget", 1500.00, ""),
    ("B131611", "Budget", 1500.00, ""),
    ("B131410", "Budget", 1500.00, ""),
    ("B111010", "Budget", 1500.00, ""),
    ("B111710", "Social Security", 1432.22, "Assumed 3% increase"),
    ("B111910", "Budget", 1200.00, ""),
    ("B191210", "Budget", 267.73, ""),
    ("B151310", "Budget", 1000.00, ""),
    ("B151910", "Budget", 1000.00, ""),
    ("B121210", "Budget", 1000.00, ""),
    ("B121310", "Budget", 1500.00, "Taken to $1k from Youth Chaplain Expense Share"),
    ("B121410", "Budget", 1000.00, ""),
    ("B131310", "Budget", 1000.00, ""),
    ("B131610", "Budget", 1000.00, ""),
    ("B141610", "Budget", 1200.00, ""),
    ("B191710", "Budget", 2590.94, ""),
    ("B151110", "Budget", 1260.00, ""),
    ("B121610", "Budget", 650.00, "First communion bibles"),
    ("B141110", "Budget", 600.00, ""),
    ("B151010", "Budget", 500.00, ""),
    ("B121010", "Budget", 500.00, ""),
    ("B121110", "Budget", 500.00, ""),
    ("B121510", "Budget", 500.00, ""),
    ("B121710", "Budget", 500.00, ""),
    ("B131210", "Budget", 400.00, "2024 add"),
    ("B161010", "Budget", 200.00, ""),
    ("B151510", "Budget", 100.00, ""),
    ("B151610", "Budget", 100.00, ""),
    ("B191810", "Budget", 30000.00, ""),
    ("B141510", "Omega", 6000.00, ""),
    ("B141510", "All Pest Solutions", 400.00, ""),
    ("B141510", "Sonia Serna Cleaning", 5200.00, ""),
    ("B141510", "Ring Security", 225.00, ""),
    ("B101710", "Budget", 1500.00, ""),
    ("B101310", "Budget", 215849.60, "Assuming 3% increase + cash to balance"),
    ("B191910", "Budget", 2000.00, ""),
    ("B192410", "Budget", 40886.00, ""),
    ("B192310", "Budget", 22171.00, ""),
    ("B192110", "Budget", 1000.00, ""),
    ("B192210", "Budget", 1000.00, ""),
    ("B191413", "Texas Flood Relief", 7102.17, ""),
    ("B191410", "Budget", 50780.35, ""),
    ("B191510", "Budget", 337029.62, ""),
    ("B192010", "Budget", 1000.00, ""),
]


def request(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def login():
    data = urllib.parse.urlencode({"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD}).encode()
    req = urllib.request.Request(BASE + "/api/auth/login", data=data, method="POST")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())["access_token"]


if __name__ == "__main__":
    token = login()
    print(f"Logged in to {BASE}. Importing {len(ENTRIES)} budget entries for 2026...")
    total = 0.0
    for account_no, description, amount, notes in ENTRIES:
        payload = {
            "transaction_date": "2026-01-01",
            "account_no": account_no,
            "description": description,
            "amount": amount,
            "notes": notes,
        }
        out = request("POST", "/api/budget", payload, token)
        assert out["amount"] == amount, out
        total += amount
    print(f"Created {len(ENTRIES)} entries, total ${total:,.2f}")
