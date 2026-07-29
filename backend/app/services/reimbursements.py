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

from ..models import AccrualEntry, Reimbursement, ReimbursementOtpCode
from ..security import hash_password, verify_password
from .parsers import _get, _lower_map

OTP_TTL_MINUTES = 10
OTP_RATE_LIMIT_PER_HOUR = 5
OTP_MAX_ATTEMPTS = 5


class TooManyOtpRequestsError(Exception):
    pass


@dataclass
class PcoPersonRow:
    person_id: str
    name: str
    email: str
    phone_number: str


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
            )
        )
    return rows


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
    not approval."""
    for line in reimbursement.lines:
        entry = AccrualEntry(
            transaction_date=line.transaction_date or date.today(),
            account_no=line.account_no,
            description=line.description or f"Reimbursement {reimbursement.name}",
            amount=line.amount,
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
    for line in reimbursement.lines:
        if line.accrual_entry_id:
            entry = db.get(AccrualEntry, line.accrual_entry_id)
            if entry is not None:
                db.delete(entry)
            line.accrual_entry_id = None
