"""Business logic for the Reimbursements module - PCO People CSV parsing,
OTP issuing/verification, and the Accrual-entry linkage rules tied to a
Reimbursement's lifecycle. Kept separate from routers/reimbursements.py the
same way pledge_import.py is separate from routers/pledge_campaigns.py."""

from __future__ import annotations

import csv
import io
import secrets
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import AccrualEntry, AppSetting, PcoListMember, PcoPerson, Reimbursement, ReimbursementOtpCode
from ..security import hash_password, verify_password
from .parsers import _get, _lower_map

OTP_TTL_MINUTES = 10
OTP_RATE_LIMIT_PER_HOUR = 5
OTP_MAX_ATTEMPTS = 5

REIMBURSEMENT_GATE_LIST_ID_KEY = "pco_reimbursement_gate_list_id"


def is_allowed_reimbursement_submitter(db: Session, email: str) -> bool:
    """Shared by request_otp (login-code issuance) and
    deps.get_current_submitter (every authenticated request) - one PcoPerson
    row with this email AND status "active" is always required, exactly as
    before. The People sync now pulls every person regardless of status (so
    the People page can show a real Status column - see
    services/pco_people_sync.py), so this status check is what keeps an
    inactive person from gaining portal access just by existing in the
    table - previously that was implicit in the sync only ever importing
    active people. If a gate list is configured (AppSetting
    REIMBURSEMENT_GATE_LIST_ID_KEY), that person must ALSO be a synced
    member of it (pco_list_members) - additive, not a replacement, so an
    unconfigured gate list changes nothing for anyone (see
    routers/reimbursements.py's Reimbursement Access page)."""
    person_id = db.scalar(
        select(PcoPerson.person_id).where(PcoPerson.email == email, PcoPerson.status == "active").limit(1)
    )
    if person_id is None:
        return False

    gate_list_id = db.get(AppSetting, REIMBURSEMENT_GATE_LIST_ID_KEY)
    if not gate_list_id or not gate_list_id.value:
        return True

    return (
        db.scalar(
            select(PcoListMember.id).where(
                PcoListMember.list_id == gate_list_id.value,
                PcoListMember.person_id == person_id,
            ).limit(1)
        )
        is not None
    )


class TooManyOtpRequestsError(Exception):
    pass


@dataclass
class PcoPersonRow:
    person_id: str
    name: str
    email: str
    phone_number: str
    # "active"/"inactive"/etc, PCO's own Person.status - defaults to
    # "active" for the CSV path below, whose exports predate this field and
    # historically only ever contained active people.
    status: str = "active"


def parse_pco_people_csv(text: str) -> list[PcoPersonRow]:
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return []
    lowmap = _lower_map(reader.fieldnames)
    rows: list[PcoPersonRow] = []
    for raw in reader:
        person_id = _get(raw, lowmap, "Person ID", "person_id")
        if not person_id:
            continue
        rows.append(
            PcoPersonRow(
                person_id=person_id,
                name=_get(raw, lowmap, "Name"),
                email=_get(raw, lowmap, "Primary Email", "Email").strip().lower(),
                phone_number=_get(raw, lowmap, "Primary Phone Number", "Phone Number"),
                status=_get(raw, lowmap, "Status") or "active",
            )
        )
    return rows


def upsert_pco_people(db: Session, rows: list[PcoPersonRow]) -> int:
    """Upserts by person_id - shared by both the CSV import path
    (routers/reimbursements.py's import_pco_people) and the live People API
    sync (services/pco_people_sync.py + the /pco-people/sync endpoint), so
    the two ingestion paths can never drift out of sync with each other.
    Caller is responsible for db.commit()."""
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
        person.status = row.status
        imported += 1
    return imported


def generate_otp_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def request_otp(db: Session, email: str) -> str:
    """Rate-limited (max OTP_RATE_LIMIT_PER_HOUR per email per hour). Returns
    the raw code for the caller to email - only the hash is persisted."""
    since = datetime.now(timezone.utc) - timedelta(hours=1)
    recent_count = db.scalar(
        select(func.count())
        .select_from(ReimbursementOtpCode)
        .where(ReimbursementOtpCode.email == email, ReimbursementOtpCode.created_at >= since)
    )
    if recent_count and recent_count >= OTP_RATE_LIMIT_PER_HOUR:
        raise TooManyOtpRequestsError()

    code = generate_otp_code()
    db.add(
        ReimbursementOtpCode(
            email=email,
            code_hash=hash_password(code),
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=OTP_TTL_MINUTES),
        )
    )
    db.commit()
    return code


def verify_otp(db: Session, email: str, code: str) -> bool:
    now = datetime.now(timezone.utc)
    candidates = list(
        db.scalars(
            select(ReimbursementOtpCode)
            .where(
                ReimbursementOtpCode.email == email,
                ReimbursementOtpCode.consumed_at.is_(None),
            )
            .order_by(ReimbursementOtpCode.created_at.desc())
        )
    )
    verified = False
    for entry in candidates:
        if entry.expires_at < now or entry.attempts >= OTP_MAX_ATTEMPTS:
            continue
        if verify_password(code, entry.code_hash):
            entry.consumed_at = now
            verified = True
            break
        entry.attempts += 1
    db.commit()
    return verified


def is_first_successful_login(db: Session, email: str) -> bool:
    """True if the just-consumed code is the only ever-consumed code for
    this email - used to fire the "new submitter" notification exactly
    once, on first login, rather than needing separate dedup state."""
    consumed_count = db.scalar(
        select(func.count())
        .select_from(ReimbursementOtpCode)
        .where(
            ReimbursementOtpCode.email == email,
            ReimbursementOtpCode.consumed_at.is_not(None),
        )
    )
    return consumed_count == 1


def create_accrual_entries(db: Session, reimbursement: Reimbursement) -> None:
    """Creates one AccrualEntry (is_reimbursement=True, reconciled=False) per
    line and links it back via ReimbursementLine.accrual_entry_id - see
    models.py's Reimbursement docstring for why this happens at submission,
    not approval.

    ReimbursementLine.amount is always a plain positive figure - submitters
    enter "I spent $40", never a signed number - but every other Actual/
    Accrual entry in the app stores an outflow as negative (see the
    SplitModal sign-convention fix, PR #66). -abs() (not a plain negate)
    guards against a submitter somehow entering a negative number too."""
    for line in reimbursement.lines:
        entry = AccrualEntry(
            transaction_date=line.transaction_date or date.today(),
            account_no=line.account_no,
            description=line.description or f"Reimbursement {reimbursement.name}",
            amount=-abs(line.amount),
            is_reimbursement=True,
            check_invoice_name=reimbursement.submitter_name or reimbursement.submitter_email,
            receipt_file_id=line.receipt_file_id,
            receipt_file_name=line.receipt_file_name,
            receipt_web_view_link=line.receipt_web_view_link,
        )
        db.add(entry)
        db.flush()
        line.accrual_entry_id = entry.id


def has_reconciled_accrual_entries(db: Session, reimbursement: Reimbursement) -> bool:
    ids = [line.accrual_entry_id for line in reimbursement.lines if line.accrual_entry_id]
    if not ids:
        return False
    count = db.scalar(
        select(func.count())
        .select_from(AccrualEntry)
        .where(AccrualEntry.id.in_(ids), AccrualEntry.reconciled == True)  # noqa: E712
    )
    return bool(count)


def delete_accrual_entries(db: Session, reimbursement: Reimbursement) -> None:
    """Deletes each line's linked AccrualEntry.

    The two flushes are load-bearing, not defensive. reimbursement_lines has
    a real FK to ledger_accrual.id, so the reference has to be gone *in the
    database* before the AccrualEntry row can be deleted. Setting
    line.accrual_entry_id = None only changes it in Python - if that update
    and the DELETE land in the same flush, SQLAlchemy is free to order the
    DELETE first and Postgres rejects it:

        ForeignKeyViolation: update or delete on table "ledger_accrual"
        violates foreign key constraint
        "reimbursement_lines_accrual_entry_id_fkey"

    That's exactly what happened on the edit path, where these deletes
    shared a flush with the ReimbursementLine deletes from _apply_lines
    (see the regression test for a successful edit). Clearing the FK and
    flushing first makes the ordering explicit instead of relying on
    SQLAlchemy's dependency sort to guess correctly.
    """
    entries: list[AccrualEntry] = []
    for line in reimbursement.lines:
        if line.accrual_entry_id:
            entry = db.get(AccrualEntry, line.accrual_entry_id)
            if entry is not None:
                entries.append(entry)
            line.accrual_entry_id = None
    db.flush()
    for entry in entries:
        db.delete(entry)
    db.flush()


def mark_accrual_entries_posted(db: Session, reimbursement: Reimbursement, posted_date: date) -> None:
    """Sets posted_date on each line's linked AccrualEntry once a
    reimbursement is actually paid. Entries are created at submission with
    only transaction_date set (see create_accrual_entries) - posted_date is
    left null until now on purpose, matching every other AccrualEntry
    (it means "recorded/cleared", not "incurred"). Without this, a
    reimbursement's entries would never show up on the Accrual page's
    Posted Year filter, which has no "all years" option and treats a null
    posted_date as "doesn't match any year"."""
    for line in reimbursement.lines:
        if line.accrual_entry_id:
            entry = db.get(AccrualEntry, line.accrual_entry_id)
            if entry is not None:
                entry.posted_date = posted_date
