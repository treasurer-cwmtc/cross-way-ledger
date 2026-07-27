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

from fastapi import APIRouter, Depends, Header, HTTPException
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models import User
from ..schemas import GeneralLedgerLineOut
from .general_ledger import build_general_ledger_lines

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


@router.get("/general-ledger", response_model=list[GeneralLedgerLineOut])
def sheets_general_ledger(
    year: int | None = None,
    user: User = Depends(get_sheets_user),
    db: Session = Depends(get_db),
) -> list[GeneralLedgerLineOut]:
    return build_general_ledger_lines(db, year)
