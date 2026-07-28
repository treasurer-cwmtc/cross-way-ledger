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

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..deps import get_current_submitter, require_permission
from ..models import (
    ChartOfAccount,
    PcoPerson,
    Reimbursement,
    ReimbursementAssignment,
    ReimbursementLine,
)
from ..schemas import (
    PcoPeopleImportSummary,
    PcoPersonOut,
    ReceiptUploadOut,
    ReimbursementAssignmentOut,
    ReimbursementAssignmentsUpdate,
    ReimbursementCreate,
    ReimbursementLineOut,
    ReimbursementOtpRequest,
    ReimbursementOtpVerify,
    ReimbursementOut,
    ReimbursementStatusUpdate,
    ReimbursementTokenOut,
)
from ..security import create_submitter_token
from ..services import reimbursements as svc
from ..services.email import send_email, send_email_best_effort
from ..services.google_drive import upload_receipt

router = APIRouter(prefix="/api/reimbursements", tags=["reimbursements"])
settings = get_settings()
logger = logging.getLogger("app.reimbursements")

_OPEN_STATUSES = {"pending", "approved"}
_VALID_STATUSES = {"pending", "approved", "paid", "rejected"}


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
    for existing_line in list(reimbursement.lines):
        db.delete(existing_line)
    db.flush()
    reimbursement.lines = [
        ReimbursementLine(
            account_no=line.account_no,
            amount=line.amount,
            description=line.description,
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
    why email is deliberately not the key."""
    rows = svc.parse_pco_people_csv(await _read_csv(people_file))
    existing = {p.person_id: p for p in db.scalars(select(PcoPerson))}
    imported = 0
    for row in rows:
        person = existing.get(row.person_id)
        if person is None:
            person = PcoPerson(person_id=row.person_id)
            db.add(person)
            existing[row.person_id] = person
        person.name = row.name
        person.email = row.email
        person.phone_number = row.phone_number
        imported += 1
    db.commit()
    return PcoPeopleImportSummary(people_imported=imported)


@router.get(
    "/pco-people",
    response_model=list[PcoPersonOut],
    dependencies=[Depends(require_permission("reimbursements"))],
)
def list_pco_people(db: Session = Depends(get_db)) -> list[PcoPerson]:
    return list(db.scalars(select(PcoPerson).order_by(PcoPerson.name)))


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
    "/{reimbursement_id}",
    response_model=ReimbursementOut,
    dependencies=[Depends(require_permission("reimbursements"))],
)
def get_reimbursement(reimbursement_id: int, db: Session = Depends(get_db)) -> ReimbursementOut:
    r = db.get(Reimbursement, reimbursement_id)
    if r is None:
        raise HTTPException(404, "Reimbursement not found.")
    return _reimbursement_out(r, _coa_lookup(db))


@router.put(
    "/{reimbursement_id}/status",
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
    elif payload.status == "approved":
        r.decided_at = now
    elif payload.status == "paid":
        r.paid_at = now

    r.status = payload.status
    if payload.notes is not None:
        r.notes = payload.notes
    db.commit()
    db.refresh(r)

    send_email_best_effort(
        r.submitter_email,
        f"Your reimbursement {r.name} is now {r.status}",
        f"Your reimbursement request {r.name} for ${r.total_amount:.2f} is now marked "
        f"'{r.status}'.\n\nNotes: {r.notes or '(none)'}",
    )
    return _reimbursement_out(r, _coa_lookup(db))


# --------------------------------------------------------------------------- #
# Submitter-side: OTP login (no auth), then get_current_submitter-gated
# --------------------------------------------------------------------------- #


_GENERIC_OTP_RESPONSE = {"message": "If that email is registered, a code has been sent."}


@router.post("/request-otp")
def request_otp(payload: ReimbursementOtpRequest, db: Session = Depends(get_db)) -> dict:
    """Deliberately returns the same generic response whether or not the
    email is recognized - avoids turning this into an email-enumeration
    oracle against the church's own membership list (see the module plan)."""
    email = payload.email.strip().lower()
    known = db.scalar(select(PcoPerson.person_id).where(PcoPerson.email == email).limit(1))
    if known is None:
        return _GENERIC_OTP_RESPONSE

    try:
        code = svc.request_otp(db, email)
    except svc.TooManyOtpRequestsError:
        return _GENERIC_OTP_RESPONSE

    try:
        send_email(
            email,
            "Your Cross Way Ledger reimbursement login code",
            f"Your one-time login code is: {code}\n\nThis code expires in "
            f"{svc.OTP_TTL_MINUTES} minutes and can only be used once.",
        )
    except Exception:
        logger.exception("Failed to send OTP email to %s", email)
        raise HTTPException(502, "Couldn't send the login code. Please try again shortly.")
    return _GENERIC_OTP_RESPONSE


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
    r = Reimbursement(
        name=f"{email}-{stamp}",
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
    send_email_best_effort(
        settings.reimbursement_notify_email,
        f"New reimbursement request: {r.name} (${r.total_amount:.2f})",
        f"{r.submitter_name} <{r.submitter_email}> submitted a reimbursement request "
        f"for ${r.total_amount:.2f}:\n\n{lines_desc}",
    )
    return _reimbursement_out(r, _coa_lookup(db))


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


@router.get("/my/{reimbursement_id}", response_model=ReimbursementOut)
def get_my_reimbursement(
    reimbursement_id: int,
    email: str = Depends(get_current_submitter),
    db: Session = Depends(get_db),
) -> ReimbursementOut:
    r = _my_reimbursement_or_404(db, reimbursement_id, email)
    return _reimbursement_out(r, _coa_lookup(db))


@router.put("/my/{reimbursement_id}", response_model=ReimbursementOut)
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
    )
    return _reimbursement_out(r, _coa_lookup(db))
