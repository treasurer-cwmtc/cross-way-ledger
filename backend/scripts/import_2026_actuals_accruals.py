"""One-time import of real 2026 data from the legacy Google Sheet export
(20260723-Cross Way Ledger-DataExport.xlsx, sheets "Reconciliation" and
"Copy of Accrual"), replacing the earlier placeholder 2026 Reconciliation
rows that had accumulated in the dev database.

Per the treasurer's explicit instruction, existing 2026-posted Reconciliation
rows are deleted (backed up to a local JSON file first) before the real data
is imported, rather than deduped-and-kept - so the sheet becomes the sole
source of truth for 2026 Actual data.

account_no was resolved by exact match on Statement Description against the
current Chart of Accounts, with three manual overrides for rows the sheet
itself left generically categorized as bare "Income"/"Expense" (confirmed
with the treasurer):
  - 5 "Sams Club" debit-card charges -> E121210 (Expense - Programs - VBS - Food)
  - 1 "PROGRESSIVE INS" charge -> E141210 (Expense - Property - Car-Insurance - Fees)
  - 1 "REMOTE ONLINE DEPOSIT" credit -> left uncategorized (blank account_no),
    matching the sheet's own lack of detail

7 pairs of rows in the source sheet were exact duplicates of the same real
Stripe transaction (identical txn id/date/amount, one copy with a truncated
Bank Description) - only one copy of each was kept.

Run once against a target backend + its Postgres directly:
    DATABASE_URL=postgresql+psycopg://ledger_user:...@10.10.10.108:5432/ledger_db \
    BASE_URL=https://dev.ledger.crosswaymtc.org ADMIN_PASSWORD=dev-changeme-2026 \
      ../.venv/Scripts/python.exe import_2026_actuals_accruals.py
"""

import json
import os
import ssl
import urllib.parse
import urllib.request
from datetime import date

import psycopg

# The dev stack's Caddy cert is signed by its own local CA, which this
# machine's Python trust store doesn't carry - same reason `curl -k` is
# needed against it. Safe here since BASE_URL is only ever our own dev host.
_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE

DATABASE_URL_RAW = os.environ["DATABASE_URL"]  # postgresql+psycopg://...
BASE = os.environ.get("BASE_URL", "http://localhost:8000")
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "changeme")

SCRATCH = os.environ["IMPORT_SCRATCH_DIR"]

# psycopg (v3) connection string doesn't use the SQLAlchemy "+psycopg" driver marker
PG_DSN = DATABASE_URL_RAW.replace("postgresql+psycopg://", "postgresql://")


def request(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, context=_SSL_CTX) as resp:
        return json.loads(resp.read())


def login():
    data = urllib.parse.urlencode({"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD}).encode()
    req = urllib.request.Request(BASE + "/api/auth/login", data=data, method="POST")
    with urllib.request.urlopen(req, context=_SSL_CTX) as resp:
        return json.loads(resp.read())["access_token"]


def load_json(name):
    with open(os.path.join(SCRATCH, name)) as f:
        return json.load(f)


def step1_backup_and_delete_existing_2026(conn):
    cur = conn.cursor()
    cur.execute(
        "select id, transaction_date, posted_date, reconciled, is_reimbursement, account_no, "
        "description, bank_account_id, method, amount, check_invoice_name, bank_description, "
        "notes, dedup_key, source_run_id, source_file_name, source_file_link "
        "from ledger_actual where extract(year from posted_date) = 2026"
    )
    cols = [d.name for d in cur.description]
    rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    backup_path = os.path.join(SCRATCH, "backup_2026_reconciliation_entries.json")
    with open(backup_path, "w") as f:
        json.dump(rows, f, default=str)
    print(f"Backed up {len(rows)} existing 2026 Reconciliation rows to {backup_path}")

    cur.execute("delete from ledger_actual where extract(year from posted_date) = 2026")
    conn.commit()
    print(f"Deleted {cur.rowcount} existing 2026 Reconciliation rows")


def step2_insert_reconciliation(conn):
    rows = load_json("import_actual.json")
    cur = conn.cursor()
    bank_id = 1  # Chase Operating
    inserted = 0
    for r in rows:
        cur.execute(
            """
            insert into ledger_actual
              (transaction_date, posted_date, reconciled, is_reimbursement, account_no,
               description, bank_account_id, method, amount, check_invoice_name,
               bank_description, notes, dedup_key, is_split, receipt_file_id,
               receipt_file_name, receipt_web_view_link, source_file_name, source_file_link)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, false, '', '', '', '', '')
            """,
            (
                r["transaction_date"],
                r["posted_date"],
                r["reconciled"],
                r["is_reimbursement"],
                r["account_no"],
                r["description"],
                bank_id,
                r["method"],
                r["amount"],
                r["check_invoice_name"],
                r["bank_description"],
                r["notes"],
                r["dedup_key"],
            ),
        )
        inserted += 1
    conn.commit()
    print(f"Inserted {inserted} new Reconciliation entries")


def step3_insert_accrual(token):
    rows = load_json("import_accrual.json")
    bank_id = 1  # Chase Operating
    total = 0.0
    for r in rows:
        payload = {
            "transaction_date": r["transaction_date"],
            "posted_date": r["posted_date"],
            "reconciled": r["reconciled"],
            "is_reimbursement": r["is_reimbursement"],
            "account_no": r["account_no"] or "",
            "description": r["description"],
            "bank_account_id": bank_id,
            "method": r["method"],
            "amount": r["amount"],
            "check_invoice_name": r["check_invoice_name"],
            "bank_description": r["bank_description"],
            "notes": r["notes"],
        }
        out = request("POST", "/api/accrual", payload, token)
        assert out["amount"] == r["amount"], out
        total += r["amount"]
    print(f"Created {len(rows)} Accrual entries, total ${total:,.2f}")


def step4_insert_budget(token):
    rows = load_json("import_budget.json")
    total = 0.0
    for r in rows:
        payload = {
            "transaction_date": r["transaction_date"],
            "account_no": r["account_no"],
            "description": r["description"],
            "amount": r["amount"],
            "notes": r["notes"],
        }
        out = request("POST", "/api/budget", payload, token)
        assert out["amount"] == r["amount"], out
        total += r["amount"]
    print(f"Created {len(rows)} Budget entries, total ${total:,.2f}")


if __name__ == "__main__":
    conn = psycopg.connect(PG_DSN)
    step1_backup_and_delete_existing_2026(conn)
    step2_insert_reconciliation(conn)
    conn.close()

    token = login()
    step3_insert_accrual(token)
    step4_insert_budget(token)
    print("Done.")
