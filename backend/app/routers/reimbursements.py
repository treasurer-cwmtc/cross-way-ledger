"""Reimbursements module: a treasurer-side queue/assignment/CSV-import API
(gated by the "reimbursements" permission, same as every other internal
page) plus a public submitter-facing API authenticated by emailed one-time
code rather than the app's normal login - see deps.get_current_submitter and
models.PcoPerson for why these are deliberately separate auth paths sharing
one router, the same way sheets_export.py uses a per-route Depends() instead
of a router-level one.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import requests
from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..deps import get_current_submitter, require_permission
from ..models import (
    AppSetting,
    ChartOfAccount,
    PcoListMember,
    PcoPerson,
    Reimbursement,
    ReimbursementAssignment,
    ReimbursementLine,
)
from ..schemas import (
    PcoLastSyncedOut,
    PcoListOption,
    PcoPeopleImportSummary,
    PcoPersonOut,
    ReceiptUploadOut,
    ReimbursementAccessSummaryOut,
    ReimbursementAssignmentOut,
    ReimbursementAssignmentsUpdate,
    ReimbursementCreate,
    ReimbursementGateListOut,
    ReimbursementGateListUpdate,
    ReimbursementLineOut,
    ReimbursementOtpRequest,
    ReimbursementOtpVerify,
    ReimbursementOut,
    ReimbursementStatusUpdate,
    ReimbursementTokenOut,
)
from ..security import create_submitter_token
from ..services import pco_people_sync, reimbursements as svc
from ..services.email import render_email_html, send_email, send_email_best_effort
from ..services.google_drive import upload_receipt
from ..services.pco_client import PcoNotConfiguredError

router = APIRouter(prefix="/api/reimbursements", tags=["reimbursements"])
settings = get_settings()
logger = logging.getLogger("app.reimbursements")

# No separate "approved" step - Paid *is* the approval; a treasurer who
# finds a problem just Rejects instead of paying.
_VALID_STATUSES = {"pending", "paid", "rejected"}


async def _read_csv(file: UploadFile) -> str:
    raw = await file.read()
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("latin-1")


def _coa_lookup(db: Session) -> dict[str, ChartOfAccount]:
    return {a.account_no: a for a in db.scalars(select(ChartOfAccount))}


def _line_out(line: ReimbursementLine, coa_by_no: dict[str, ChartOfAccount]) -> ReimbursementLineOut:
    coa = coa_by_no.get(line.account_no)
    return ReimbursementLineOut(
        id=line.id,
        account_no=line.account_no or "",
        statement_description=coa.statement_description if coa else "",
        amount=line.amount,
        description=line.description,
        transaction_date=line.transaction_date,
        receipt_file_id=line.receipt_file_id,
        receipt_file_name=line.receipt_file_name,
        receipt_web_view_link=line.receipt_web_view_link,
    )


def _reimbursement_out(r: Reimbursement, coa_by_no: dict[str, ChartOfAccount]) -> ReimbursementOut:
    return ReimbursementOut(
        id=r.id,
        name=r.name,
        submitter_email=r.submitter_email,
        submitter_name=r.submitter_name,
        status=r.status,
        notes=r.notes,
        total_amount=r.total_amount,
        submitted_at=r.submitted_at,
        decided_at=r.decided_at,
        paid_at=r.paid_at,
        lines=[_line_out(line, coa_by_no) for line in r.lines],
    )


def _apply_lines(db: Session, reimbursement: Reimbursement, payload: ReimbursementCreate) -> None:
    if not payload.lines:
        raise HTTPException(400, "Provide at least one line.")
    for line in payload.lines:
        if not line.receipt_file_id:
            raise HTTPException(400, "Every line needs a receipt attached.")
    for existing_line in list(reimbursement.lines):
        db.delete(existing_line)
    db.flush()
    reimbursement.lines = [
        ReimbursementLine(
            account_no=line.account_no,
            amount=line.amount,
            description=line.description,
            transaction_date=line.transaction_date,
            receipt_file_id=line.receipt_file_id,
            receipt_file_name=line.receipt_file_name,
            receipt_web_view_link=line.receipt_web_view_link,
        )
        for line in payload.lines
    ]
    reimbursement.total_amount = round(sum(line.amount for line in payload.lines), 2)


# --------------------------------------------------------------------------- #
# Treasurer-side: PCO People import + assignments + queue
# --------------------------------------------------------------------------- #


@router.post(
    "/pco-people/import",
    response_model=PcoPeopleImportSummary,
    dependencies=[Depends(require_permission("reimbursements"))],
)
async def import_pco_people(
    people_file: UploadFile = File(...), db: Session = Depends(get_db)
) -> PcoPeopleImportSummary:
    """Upserts by person_id (PCO's own ID) - see PcoPerson's docstring for
    why email is deliberately not the key. Manual fallback path, kept intact
    alongside the live sync below (POST /pco-people/sync) in case API access
    is ever lost."""
    rows = svc.parse_pco_people_csv(await _read_csv(people_file))
    imported = svc.upsert_pco_people(db, rows)
    db.commit()
    return PcoPeopleImportSummary(people_imported=imported)


PCO_PEOPLE_LAST_SYNCED_KEY = "pco_people_last_synced_at"


def _sync_gate_list_membership(db: Session) -> None:
    """If a Reimbursement Access gate list is configured, re-pulls its
    current membership from PCO and replaces pco_list_members for that
    list_id - runs as part of every People sync (see _run_pco_people_sync)
    so one "Sync now" click keeps both People and the gate list's membership
    current together. No-op if no gate list is configured."""
    setting = db.get(AppSetting, svc.REIMBURSEMENT_GATE_LIST_ID_KEY)
    if not setting or not setting.value:
        return
    list_id = setting.value
    try:
        member_ids = pco_people_sync.fetch_list_member_ids(list_id)
    except (PcoNotConfiguredError, requests.RequestException):
        # A gate-list sync failure shouldn't fail the whole People sync -
        # the gate simply keeps its last-known membership until the next
        # successful sync.
        logger.exception("Failed to sync PCO List %s membership", list_id)
        return
    db.execute(delete(PcoListMember).where(PcoListMember.list_id == list_id))
    known_people = set(db.scalars(select(PcoPerson.person_id)))
    for person_id in member_ids & known_people:
        db.add(PcoListMember(list_id=list_id, person_id=person_id))


def _run_pco_people_sync(db: Session) -> PcoPeopleImportSummary:
    try:
        rows = pco_people_sync.fetch_active_people()
    except PcoNotConfiguredError as e:
        raise HTTPException(400, str(e))
    except requests.RequestException as e:  # network / non-2xx after retries
        raise HTTPException(502, f"Planning Center API error: {e}")

    imported = svc.upsert_pco_people(db, rows)
    # SessionLocal is autoflush=False (see database.py) - a brand-new
    # PcoPerson row just added above via db.add() is otherwise invisible to
    # _sync_gate_list_membership's select(PcoPerson.person_id) in this same
    # request, which would silently drop a newly-synced gate-list member.
    db.flush()
    _sync_gate_list_membership(db)

    now_iso = datetime.now(tz=timezone.utc).isoformat()
    setting = db.get(AppSetting, PCO_PEOPLE_LAST_SYNCED_KEY)
    if setting is None:
        db.add(AppSetting(key=PCO_PEOPLE_LAST_SYNCED_KEY, value=now_iso))
    else:
        setting.value = now_iso
    db.commit()
    return PcoPeopleImportSummary(people_imported=imported, last_synced_at=now_iso)


@router.post(
    "/pco-people/sync",
    response_model=PcoPeopleImportSummary,
    dependencies=[Depends(require_permission("reimbursements"))],
)
def sync_pco_people_now(db: Session = Depends(get_db)) -> PcoPeopleImportSummary:
    return _run_pco_people_sync(db)


def _verify_pco_people_sync_secret(x_sync_secret: str = Header(default="")) -> None:
    """Guards the scheduled endpoint in place of a user login - same
    pattern as stripe_sync.py's _verify_sync_secret. Configuring
    pco_people_sync_secret is required before this endpoint does anything;
    it's otherwise always rejected, never open-by-default."""
    settings = get_settings()
    if not settings.pco_people_sync_secret or x_sync_secret != settings.pco_people_sync_secret:
        raise HTTPException(403, "Invalid or missing sync secret.")


@router.post(
    "/pco-people/scheduled-sync",
    response_model=PcoPeopleImportSummary,
    dependencies=[Depends(_verify_pco_people_sync_secret)],
)
def scheduled_pco_people_sync(db: Session = Depends(get_db)) -> PcoPeopleImportSummary:
    return _run_pco_people_sync(db)


@router.get(
    "/pco-people/last-synced",
    response_model=PcoLastSyncedOut,
    dependencies=[Depends(require_permission("reimbursements"))],
)
def get_pco_people_last_synced(db: Session = Depends(get_db)) -> PcoLastSyncedOut:
    setting = db.get(AppSetting, PCO_PEOPLE_LAST_SYNCED_KEY)
    return PcoLastSyncedOut(last_synced_at=setting.value if setting else None)


@router.get(
    "/pco-people",
    response_model=list[PcoPersonOut],
    dependencies=[Depends(require_permission("reimbursements"))],
)
def list_pco_people(db: Session = Depends(get_db)) -> list[PcoPerson]:
    return list(db.scalars(select(PcoPerson).order_by(PcoPerson.name)))


@router.get(
    "/pco-lists",
    response_model=list[PcoListOption],
    dependencies=[Depends(require_permission("reimbursements"))],
)
def list_pco_lists() -> list[PcoListOption]:
    """Live-fetched (not synced locally) - Lists change rarely and this is an
    on-demand admin picker, not something evaluated per login (see
    pco_people_sync.fetch_list_options)."""
    try:
        options = pco_people_sync.fetch_list_options()
    except PcoNotConfiguredError as e:
        raise HTTPException(400, str(e))
    except requests.RequestException as e:
        raise HTTPException(502, f"Planning Center API error: {e}")
    return [PcoListOption(**o) for o in options]


@router.get(
    "/reimbursement-gate-list",
    response_model=ReimbursementGateListOut,
    dependencies=[Depends(require_permission("reimbursements"))],
)
def get_reimbursement_gate_list(db: Session = Depends(get_db)) -> ReimbursementGateListOut:
    setting = db.get(AppSetting, svc.REIMBURSEMENT_GATE_LIST_ID_KEY)
    if not setting or not setting.value:
        return ReimbursementGateListOut()
    list_id = setting.value
    member_count = db.scalar(
        select(func.count()).select_from(PcoListMember).where(PcoListMember.list_id == list_id)
    )
    list_name = None
    try:
        list_name = next(
            (o["name"] for o in pco_people_sync.fetch_list_options() if o["id"] == list_id), None
        )
    except (PcoNotConfiguredError, requests.RequestException):
        pass  # name lookup is cosmetic only - the id/count still return fine
    return ReimbursementGateListOut(list_id=list_id, list_name=list_name, member_count=member_count or 0)


@router.put(
    "/reimbursement-gate-list",
    response_model=ReimbursementGateListOut,
    dependencies=[Depends(require_permission("reimbursements"))],
)
def set_reimbursement_gate_list(
    payload: ReimbursementGateListUpdate, db: Session = Depends(get_db)
) -> ReimbursementGateListOut:
    """Sets (or clears, if list_id is null/blank) which PCO List gates
    Reimbursement portal login - see
    services.reimbursements.is_allowed_reimbursement_submitter. Clearing
    doesn't delete previously-synced pco_list_members rows (harmless, just
    unused until a list is configured again) - simpler than also having to
    reason about a partial-delete-on-clear edge case."""
    setting = db.get(AppSetting, svc.REIMBURSEMENT_GATE_LIST_ID_KEY)
    new_value = (payload.list_id or "").strip()
    if setting is None:
        db.add(AppSetting(key=svc.REIMBURSEMENT_GATE_LIST_ID_KEY, value=new_value))
    else:
        setting.value = new_value
    db.commit()
    if new_value:
        _sync_gate_list_membership(db)
        db.commit()
    return get_reimbursement_gate_list(db)


@router.get(
    "/assignments",
    response_model=list[ReimbursementAssignmentOut],
    dependencies=[Depends(require_permission("reimbursements"))],
)
def get_assignments(email: str, db: Session = Depends(get_db)) -> list[ReimbursementAssignmentOut]:
    email = email.strip().lower()
    coa_by_no = _coa_lookup(db)
    rows = db.scalars(
        select(ReimbursementAssignment).where(ReimbursementAssignment.email == email)
    )
    return [
        ReimbursementAssignmentOut(
            account_no=a.account_no,
            statement_description=(coa_by_no.get(a.account_no).statement_description
                                    if coa_by_no.get(a.account_no) else ""),
        )
        for a in rows
    ]


@router.get(
    "/assignments-summary",
    response_model=list[ReimbursementAccessSummaryOut],
    dependencies=[Depends(require_permission("reimbursements"))],
)
def list_assignment_summaries(db: Session = Depends(get_db)) -> list[ReimbursementAccessSummaryOut]:
    """One row per email that currently has at least one assignment - the
    "who has portal access" list on the Reimbursements page."""
    by_email: dict[str, list[str]] = {}
    for a in db.scalars(select(ReimbursementAssignment)):
        by_email.setdefault(a.email, []).append(a.account_no)

    name_by_email: dict[str, str] = {}
    for p in db.scalars(select(PcoPerson)):
        if p.email and p.email not in name_by_email:
            name_by_email[p.email] = p.name

    return [
        ReimbursementAccessSummaryOut(
            email=email, name=name_by_email.get(email, ""), account_nos=sorted(nos)
        )
        for email, nos in sorted(by_email.items())
    ]


@router.put(
    "/assignments",
    response_model=list[ReimbursementAssignmentOut],
    dependencies=[Depends(require_permission("reimbursements"))],
)
def set_assignments(
    email: str, payload: ReimbursementAssignmentsUpdate, db: Session = Depends(get_db)
) -> list[ReimbursementAssignmentOut]:
    """Replace-all-for-email: send the full desired account_no list."""
    email = email.strip().lower()
    known = db.scalar(select(PcoPerson.person_id).where(PcoPerson.email == email).limit(1))
    if known is None:
        raise HTTPException(
            400,
            f"{email} doesn't match anyone in the imported PCO People list. "
            "Import/refresh that list first, or check for a typo.",
        )

    existing = {
        a.account_no: a
        for a in db.scalars(select(ReimbursementAssignment).where(ReimbursementAssignment.email == email))
    }
    desired = set(payload.account_nos)
    for account_no, assignment in existing.items():
        if account_no not in desired:
            db.delete(assignment)
    for account_no in desired:
        if account_no not in existing:
            db.add(ReimbursementAssignment(email=email, account_no=account_no))
    db.commit()
    return get_assignments(email, db)


@router.get(
    "",
    response_model=list[ReimbursementOut],
    dependencies=[Depends(require_permission("reimbursements"))],
)
def list_reimbursements(
    status: str | None = None, db: Session = Depends(get_db)
) -> list[ReimbursementOut]:
    coa_by_no = _coa_lookup(db)
    query = select(Reimbursement).order_by(Reimbursement.submitted_at.desc())
    if status:
        query = query.where(Reimbursement.status == status)
    return [_reimbursement_out(r, coa_by_no) for r in db.scalars(query)]


@router.get(
    "/{reimbursement_id:int}",
    response_model=ReimbursementOut,
    dependencies=[Depends(require_permission("reimbursements"))],
)
def get_reimbursement(reimbursement_id: int, db: Session = Depends(get_db)) -> ReimbursementOut:
    r = db.get(Reimbursement, reimbursement_id)
    if r is None:
        raise HTTPException(404, "Reimbursement not found.")
    return _reimbursement_out(r, _coa_lookup(db))


@router.put(
    "/{reimbursement_id:int}/status",
    response_model=ReimbursementOut,
    dependencies=[Depends(require_permission("reimbursements"))],
)
def update_status(
    reimbursement_id: int, payload: ReimbursementStatusUpdate, db: Session = Depends(get_db)
) -> ReimbursementOut:
    r = db.get(Reimbursement, reimbursement_id)
    if r is None:
        raise HTTPException(404, "Reimbursement not found.")
    if payload.status not in _VALID_STATUSES:
        raise HTTPException(400, f"Status must be one of {sorted(_VALID_STATUSES)}.")

    now = datetime.now(timezone.utc)
    if payload.status == "rejected":
        svc.delete_accrual_entries(db, r)
        r.decided_at = now
    elif payload.status == "paid":
        r.decided_at = now
        r.paid_at = now
        svc.mark_accrual_entries_posted(db, r, now.date())

    r.status = payload.status
    if payload.notes is not None:
        r.notes = payload.notes
    db.commit()
    db.refresh(r)

    status_label = r.status.capitalize()
    send_email_best_effort(
        r.submitter_email,
        f"Your reimbursement {r.name} is now {r.status}",
        f"Your reimbursement request {r.name} for ${r.total_amount:.2f} is now marked "
        f"'{r.status}'.\n\nNotes: {r.notes or '(none)'}",
        render_email_html(
            f"Your request is now {status_label}",
            f"""
            <p style="margin:0 0 12px;">Your reimbursement request <b>{r.name}</b> for
            <b>${r.total_amount:.2f}</b> is now marked <b>{status_label}</b>.</p>
            <p style="margin:0;color:{'#64707d'};">
              <b>Notes:</b> {r.notes or "(none)"}
            </p>
            """,
        ),
    )
    return _reimbursement_out(r, _coa_lookup(db))


# --------------------------------------------------------------------------- #
# Submitter-side: OTP login (no auth), then get_current_submitter-gated
# --------------------------------------------------------------------------- #


def _otp_response(email: str) -> dict:
    """Always shows the entered address back (so a typo is obvious) while
    staying deliberately non-committal about whether it's actually
    registered - avoids turning this into an email-enumeration oracle
    against the church's own membership list (see the module plan). Whether
    a real email goes out isn't observable from this response alone."""
    return {"message": f"If {email} is registered, a code has been sent to it."}


@router.post("/request-otp")
def request_otp(payload: ReimbursementOtpRequest, db: Session = Depends(get_db)) -> dict:
    email = payload.email.strip().lower()
    if not svc.is_allowed_reimbursement_submitter(db, email):
        return _otp_response(email)

    try:
        code = svc.request_otp(db, email)
    except svc.TooManyOtpRequestsError:
        # Safe to be specific here, unlike the unknown-email case above:
        # rate-limiting only ever triggers for an email that already
        # matched (we return early above before ever touching the OTP
        # table for an unmatched one), so this can't be used to test
        # whether an email is on the PCO People list.
        return {
            "message": "You've requested several codes recently. Please wait a bit "
            "before requesting another."
        }

    try:
        send_email(
            email,
            "Your Cross Way Ledger reimbursement login code",
            f"Your one-time login code is: {code}\n\nThis code expires in "
            f"{svc.OTP_TTL_MINUTES} minutes and can only be used once.",
            render_email_html(
                "Your login code",
                f"""
                <p style="margin:0 0 18px;">Enter this code on the Reimbursement Requests
                sign-in page to continue:</p>
                <p style="margin:0 0 18px;text-align:center;">
                  <span style="display:inline-block;font-size:30px;font-weight:700;
                               letter-spacing:0.12em;color:#1a94a8;
                               background:#e5f8fb;border-radius:8px;padding:10px 20px;">
                    {code}
                  </span>
                </p>
                <p style="margin:0;color:#64707d;font-size:13px;">
                  This code expires in {svc.OTP_TTL_MINUTES} minutes and can only be used once.
                  If you didn't request this, you can safely ignore this email.
                </p>
                """,
            ),
        )
    except Exception:
        logger.exception("Failed to send OTP email to %s", email)
        raise HTTPException(502, "Couldn't send the login code. Please try again shortly.")
    return _otp_response(email)


@router.post("/verify-otp", response_model=ReimbursementTokenOut)
def verify_otp(payload: ReimbursementOtpVerify, db: Session = Depends(get_db)) -> ReimbursementTokenOut:
    email = payload.email.strip().lower()
    if not svc.verify_otp(db, email, payload.code.strip()):
        raise HTTPException(401, "That code is invalid or has expired.")

    person = db.scalar(select(PcoPerson).where(PcoPerson.email == email).limit(1))
    name = person.name if person else email

    if svc.is_first_successful_login(db, email):
        has_assignment = db.scalar(
            select(ReimbursementAssignment.id).where(ReimbursementAssignment.email == email).limit(1)
        )
        if has_assignment is None:
            send_email_best_effort(
                settings.reimbursement_notify_email,
                "New reimbursement portal submitter needs Chart-of-Accounts access",
                f"{name} <{email}> just logged into the Reimbursements portal for the "
                "first time, but has no Chart-of-Accounts assigned yet, so they can't "
                "submit a request. Assign them access from the Reimbursements page.",
                render_email_html(
                    "New submitter needs access",
                    f"""
                    <p style="margin:0;"><b>{name}</b> ({email}) just logged into the
                    Reimbursements portal for the first time, but has no Chart-of-Accounts
                    assigned yet - they can't submit a request until you do.</p>
                    """,
                ),
            )

    return ReimbursementTokenOut(token=create_submitter_token(email), name=name)


@router.get("/my/coas", response_model=list[ReimbursementAssignmentOut])
def my_coas(
    email: str = Depends(get_current_submitter), db: Session = Depends(get_db)
) -> list[ReimbursementAssignmentOut]:
    return get_assignments(email, db)


@router.post("/receipts/upload", response_model=ReceiptUploadOut)
async def upload_receipt_endpoint(
    file: UploadFile = File(...), email: str = Depends(get_current_submitter)
) -> ReceiptUploadOut:
    content = await file.read()
    try:
        result = upload_receipt(email, file.filename or "receipt", content, file.content_type or "")
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    return ReceiptUploadOut(**result)


def _my_reimbursement_or_404(db: Session, reimbursement_id: int, email: str) -> Reimbursement:
    r = db.get(Reimbursement, reimbursement_id)
    if r is None or r.submitter_email != email:
        raise HTTPException(404, "Reimbursement not found.")
    return r


@router.post("/my", response_model=ReimbursementOut, status_code=201)
def submit_reimbursement(
    payload: ReimbursementCreate,
    email: str = Depends(get_current_submitter),
    db: Session = Depends(get_db),
) -> ReimbursementOut:
    allowed = {
        a.account_no
        for a in db.scalars(select(ReimbursementAssignment).where(ReimbursementAssignment.email == email))
    }
    for line in payload.lines:
        if line.account_no not in allowed:
            raise HTTPException(403, f"You aren't authorized to submit against {line.account_no}.")

    person = db.scalar(select(PcoPerson).where(PcoPerson.email == email).limit(1))
    # Microsecond precision, not just seconds - two submissions from the same
    # person can otherwise land in the same wall-clock second and collide on
    # the unique `name` column (confirmed by a real CI failure).
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    name = (payload.name or "").strip() or f"{email}-{stamp}"
    if db.scalar(select(Reimbursement.id).where(Reimbursement.name == name).limit(1)):
        raise HTTPException(400, f'"{name}" is already used by another request - please choose a different name.')
    r = Reimbursement(
        name=name,
        submitter_email=email,
        submitter_name=person.name if person else email,
    )
    db.add(r)
    db.flush()
    _apply_lines(db, r, payload)
    svc.create_accrual_entries(db, r)
    db.commit()
    db.refresh(r)

    lines_desc = "\n".join(f"  - {line.account_no}: ${line.amount:.2f}" for line in payload.lines)
    lines_desc += f"\n  Total: ${r.total_amount:.2f}"
    coa_by_no = _coa_lookup(db)
    lines_html = "".join(
        f"""<tr>
              <td style="padding:4px 0;border-bottom:1px solid #e1e6ea;">
                {line.account_no} &middot;
                {coa_by_no.get(line.account_no).statement_description if coa_by_no.get(line.account_no) else ""}
              </td>
              <td style="padding:4px 0;border-bottom:1px solid #e1e6ea;text-align:right;">
                ${line.amount:.2f}
              </td>
            </tr>"""
        for line in payload.lines
    )
    lines_html += f"""<tr>
              <td style="padding:6px 0 0;font-weight:700;">Total</td>
              <td style="padding:6px 0 0;font-weight:700;text-align:right;">
                ${r.total_amount:.2f}
              </td>
            </tr>"""
    send_email_best_effort(
        settings.reimbursement_notify_email,
        f"New reimbursement request: {r.name} (${r.total_amount:.2f})",
        f"{r.submitter_name} <{r.submitter_email}> submitted a reimbursement request "
        f"for ${r.total_amount:.2f}:\n\n{lines_desc}",
        render_email_html(
            f"New reimbursement request - ${r.total_amount:.2f}",
            f"""
            <p style="margin:0 0 14px;">
              <b>{r.submitter_name}</b> ({r.submitter_email}) submitted a new reimbursement
              request, <b>{r.name}</b>.
            </p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
              {lines_html}
            </table>
            """,
        ),
    )
    # A copy to the submitter too, so they have a record of exactly what
    # they submitted without having to check the portal again.
    send_email_best_effort(
        r.submitter_email,
        f"Your reimbursement request {r.name} was submitted (${r.total_amount:.2f})",
        f"Your reimbursement request {r.name} for ${r.total_amount:.2f} was submitted "
        f"and is now pending review:\n\n{lines_desc}",
        render_email_html(
            f"Request submitted - ${r.total_amount:.2f}",
            f"""
            <p style="margin:0 0 14px;">
              Your reimbursement request <b>{r.name}</b> was submitted and is now
              pending review.
            </p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
              {lines_html}
            </table>
            """,
        ),
    )
    return _reimbursement_out(r, coa_by_no)


@router.get("/my", response_model=list[ReimbursementOut])
def list_my_reimbursements(
    email: str = Depends(get_current_submitter), db: Session = Depends(get_db)
) -> list[ReimbursementOut]:
    coa_by_no = _coa_lookup(db)
    rows = db.scalars(
        select(Reimbursement)
        .where(Reimbursement.submitter_email == email)
        .order_by(Reimbursement.submitted_at.desc())
    )
    return [_reimbursement_out(r, coa_by_no) for r in rows]


@router.get("/my/{reimbursement_id:int}", response_model=ReimbursementOut)
def get_my_reimbursement(
    reimbursement_id: int,
    email: str = Depends(get_current_submitter),
    db: Session = Depends(get_db),
) -> ReimbursementOut:
    r = _my_reimbursement_or_404(db, reimbursement_id, email)
    return _reimbursement_out(r, _coa_lookup(db))


@router.put("/my/{reimbursement_id:int}", response_model=ReimbursementOut)
def update_my_reimbursement(
    reimbursement_id: int,
    payload: ReimbursementCreate,
    email: str = Depends(get_current_submitter),
    db: Session = Depends(get_db),
) -> ReimbursementOut:
    r = _my_reimbursement_or_404(db, reimbursement_id, email)
    if r.status != "pending":
        raise HTTPException(409, "This request is no longer open for edits.")
    if svc.has_reconciled_accrual_entries(db, r):
        raise HTTPException(
            409,
            "One or more lines on this request have already been reconciled against "
            "the bank - contact the treasurer instead of editing it here.",
        )

    allowed = {
        a.account_no
        for a in db.scalars(select(ReimbursementAssignment).where(ReimbursementAssignment.email == email))
    }
    for line in payload.lines:
        if line.account_no not in allowed:
            raise HTTPException(403, f"You aren't authorized to submit against {line.account_no}.")

    new_name = (payload.name or "").strip()
    if new_name and new_name != r.name:
        if db.scalar(select(Reimbursement.id).where(Reimbursement.name == new_name).limit(1)):
            raise HTTPException(
                400, f'"{new_name}" is already used by another request - please choose a different name.'
            )
        r.name = new_name

    svc.delete_accrual_entries(db, r)
    _apply_lines(db, r, payload)
    db.flush()
    svc.create_accrual_entries(db, r)
    db.commit()
    db.refresh(r)

    send_email_best_effort(
        settings.reimbursement_notify_email,
        f"Reimbursement request updated: {r.name}",
        f"{r.submitter_name} <{r.submitter_email}> updated their pending reimbursement "
        f"request {r.name} - new total ${r.total_amount:.2f}.",
        render_email_html(
            "Reimbursement request updated",
            f"""
            <p style="margin:0;">
              <b>{r.submitter_name}</b> ({r.submitter_email}) updated their pending
              reimbursement request <b>{r.name}</b> - new total <b>${r.total_amount:.2f}</b>.
            </p>
            """,
        ),
    )
    return _reimbursement_out(r, _coa_lookup(db))
