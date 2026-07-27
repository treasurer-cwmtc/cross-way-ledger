"""Read-only General Ledger access for Google Sheets, authenticated with the
signed-in Google user's own identity token (via Apps Script's
ScriptApp.getIdentityToken()) instead of this app's own username/password
JWT - so a Sheet can pull live data without anyone typing or storing a
database credential.

Deliberately a separate router from general_ledger.py, not an alternate
auth path bolted onto it: general_ledger.py's router applies
require_permission("general-ledger") to every route via router-level
dependencies, which assumes our own JWT (see deps.get_current_user). This
router authenticates per-request against a raw Google ID token instead.

Unlike /api/auth/google (used by this app's own sign-in button), the
audience claim is NOT pinned to a single known OAuth client id: Apps
Script auto-provisions its own client when a script project is linked to
this GCP project, and that client id isn't known ahead of time. Security
still rests on: the token's signature is verified against Google's own
keys, it must be Google-issued and unexpired, email_verified must be true,
the hd claim must match the Workspace domain, and the resolved user must
already exist in our own Users table with the "general-ledger" permission
(or be an admin) - an attacker would need a valid crosswaymtc.org Google
session AND an account we've already provisioned, same bar as every other
page in the app.
"""
import logging
from datetime import date

from fastapi import APIRouter, Depends, Header, HTTPException
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models import AppSetting, User
from .general_ledger import build_general_ledger_lines

_MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def _date_parts(d: date | None, prior_year_end: date) -> dict[str, str]:
    """Mirrors frontend/src/pages/ledger/columns.ts's dateParts() exactly -
    same MonthName/MonthYear/Year/CYPY breakdown used by the General
    Ledger's own "Export to Excel" button, so the Sheets export and the
    Excel export are never allowed to drift apart."""
    if d is None:
        return {"month_name": "", "month_year": "", "year": "", "cy_py": ""}
    return {
        "month_name": _MONTH_NAMES[d.month - 1],
        "month_year": f"{d.month:02d}-{d.year}",
        "year": str(d.year),
        "cy_py": "CY" if d > prior_year_end else "PY",
    }

router = APIRouter(prefix="/api/sheets", tags=["sheets"])
settings = get_settings()
logger = logging.getLogger("app.sheets_export")


def get_sheets_user(
    authorization: str | None = Header(default=None), db: Session = Depends(get_db)
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Google identity token.")
    token = authorization.removeprefix("Bearer ").strip()

    try:
        claims = google_id_token.verify_oauth2_token(
            token, google_requests.Request(), clock_skew_in_seconds=10
        )
    except ValueError as e:
        logger.warning("Sheets Google ID token verification failed: %s", e)
        raise HTTPException(status_code=401, detail="Invalid Google identity token.") from e

    if not claims.get("email_verified") or claims.get("hd") != settings.google_workspace_domain:
        raise HTTPException(
            status_code=403,
            detail=f"Only {settings.google_workspace_domain} Google accounts can use this.",
        )

    email = claims.get("email", "")
    user = db.scalar(select(User).where(User.email == email))
    if user is None or not user.active:
        raise HTTPException(
            status_code=403,
            detail="No account has been set up for this email. Contact your administrator.",
        )
    if not user.is_admin and "general-ledger" not in (user.permissions or []):
        raise HTTPException(status_code=403, detail="You don't have access to the General Ledger.")
    return user


@router.get("/general-ledger")
def sheets_general_ledger(
    year: int | None = None,
    user: User = Depends(get_sheets_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Every column the General Ledger's own "Export to Excel" button
    produces - not just the raw GeneralLedgerLineOut fields - so a Sheet
    pulling from here never has less to work with than the spreadsheet
    export already does. Column names intentionally match that export
    exactly (see GeneralLedger/index.tsx's exportToExcel)."""
    lines = build_general_ledger_lines(db, year)

    setting = db.get(AppSetting, "prior_year_end_date")
    prior_year_end = date.fromisoformat(setting.value) if setting else date(date.today().year - 1, 12, 31)

    rows = []
    for line in lines:
        txn = _date_parts(line.transaction_date, prior_year_end)
        posted = _date_parts(line.posted_date, prior_year_end)
        rows.append(
            {
                "Transaction Date": line.transaction_date.isoformat() if line.transaction_date else "",
                "Date Posted": line.posted_date.isoformat() if line.posted_date else "",
                "Reconciled": "Yes" if line.reconciled else "No",
                "Statement Description": line.statement_description,
                "Description": line.description,
                "Bank Account": line.bank_account_name,
                "Method": line.method,
                "Amount": line.amount,
                "Check/Invoice Name": line.check_invoice_name,
                "Bank Description": line.bank_description,
                "Notes": line.notes,
                "IsReimbursement": "Yes" if line.is_reimbursement else "No",
                "Category": line.category,
                "Statement": line.statement_category,
                "Item": line.statement_item,
                "ItemDetail": line.statement_detail,
                # Always blank - a legacy-sheet helper column carried
                # forward for structural parity, never actually populated.
                "TransactionLookup": "",
                "TransactionDateMonthName": txn["month_name"],
                "TransactionDateMonthYear": txn["month_year"],
                "TransactionDateYear": txn["year"],
                "TransactionDateCYPY": txn["cy_py"],
                "PostedDateMonthName": posted["month_name"],
                "PostedDateMonthYear": posted["month_year"],
                "PostedDateYear": posted["year"],
                "PostedDateCYPY": posted["cy_py"],
                "Grouping": line.grouping,
                "IsYouthChaplainShare": line.is_youth_chaplain_share,
                "IsMissions": line.is_missions,
                "Type": "Income" if line.category == "Budget" else line.category,
            }
        )
    return rows
