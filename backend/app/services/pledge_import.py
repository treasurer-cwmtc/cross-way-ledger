"""CSV parsing + donor matching for the Pledge Campaigns module (pledge form,
donations, and donor exports from the Giving App).

Matching logic verified against the treasurer's own working spreadsheet
formulas (Google Sheets XLOOKUP): a pledge is matched to a donor by email.
Unlike the spreadsheet - which fakes a "no match" result with a
submission-id-plus-asterisk string, since a sheet has no concept of NULL -
this returns a real `None` for an unmatched pledge, which is the correct
representation once there's an actual nullable foreign key to use.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field
from datetime import date, datetime

from .parsers import _get, _lower_map, parse_amount


# --------------------------------------------------------------------------- #
# Pledge form export
# --------------------------------------------------------------------------- #
@dataclass
class PledgeRow:
    submission_id: str
    first_name: str
    last_name: str
    email: str
    date_submitted: datetime | None
    initial_amount: float
    due_date: date | None
    monthly_amount: float
    contact_method: str
    raw: dict = field(default_factory=dict)


def _parse_datetime(value: str) -> datetime | None:
    value = (value or "").strip()
    if not value:
        return None
    for fmt in ("%Y-%m-%d %I:%M:%S %p", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def _parse_date(value: str) -> date | None:
    dt = _parse_datetime(value)
    return dt.date() if dt else None


def parse_pledge_csv(text: str) -> list[PledgeRow]:
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return []
    lowmap = _lower_map(reader.fieldnames)
    rows: list[PledgeRow] = []
    for raw in reader:
        submission_id = _get(raw, lowmap, "Submission ID")
        if not submission_id:
            continue
        rows.append(
            PledgeRow(
                submission_id=submission_id,
                first_name=_get(raw, lowmap, "First Name"),
                last_name=_get(raw, lowmap, "Last Name"),
                email=_get(raw, lowmap, "Email").strip().lower(),
                date_submitted=_parse_datetime(_get(raw, lowmap, "Date Submitted")),
                initial_amount=parse_amount(
                    _get(
                        raw,
                        lowmap,
                        "I pledge to contribute the following amount for the "
                        "initial funds needed for the Building Project:",
                        "Initial Pledge",
                        "Pledge",
                    )
                ),
                due_date=_parse_date(
                    _get(raw, lowmap, "To be paid by:", "To be paid by", "Due Date")
                ),
                monthly_amount=parse_amount(
                    _get(
                        raw,
                        lowmap,
                        "I pledge to contribute the following monthly amount for "
                        "the ongoing expenses of the Church (total monthly giving):",
                        "Monthly Pledge",
                    )
                ),
                contact_method=_get(raw, lowmap, "Method of Contact"),
                raw=dict(raw),
            )
        )
    return rows


# --------------------------------------------------------------------------- #
# Donor export
# --------------------------------------------------------------------------- #
@dataclass
class DonorRow:
    donor_id: str
    donor_number: str
    first_name: str
    last_name: str
    email: str
    phone_number: str
    city: str
    state: str
    zip_code: str
    joint_giver_id: str
    joint_giver_first_name: str
    joint_giver_last_name: str
    first_donated: date | None
    donation_count: int
    total_given: float
    raw: dict = field(default_factory=dict)


def parse_donor_csv(text: str) -> list[DonorRow]:
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return []
    lowmap = _lower_map(reader.fieldnames)
    rows: list[DonorRow] = []
    for raw in reader:
        donor_id = _get(raw, lowmap, "donor_id")
        if not donor_id:
            continue
        count_str = _get(raw, lowmap, "donation_count")
        rows.append(
            DonorRow(
                donor_id=donor_id,
                donor_number=_get(raw, lowmap, "donor_number"),
                first_name=_get(raw, lowmap, "donor_first_name"),
                last_name=_get(raw, lowmap, "donor_last_name"),
                email=_get(raw, lowmap, "donor_email").strip().lower(),
                phone_number=_get(raw, lowmap, "donor_phone_number"),
                city=_get(raw, lowmap, "donor_city"),
                state=_get(raw, lowmap, "donor_state"),
                zip_code=_get(raw, lowmap, "donor_zip"),
                joint_giver_id=_get(raw, lowmap, "joint_giver_id"),
                joint_giver_first_name=_get(raw, lowmap, "joint_giver_first_name"),
                joint_giver_last_name=_get(raw, lowmap, "joint_giver_last_name"),
                first_donated=_parse_date(_get(raw, lowmap, "first_donated")),
                donation_count=int(count_str) if count_str.isdigit() else 0,
                total_given=parse_amount(_get(raw, lowmap, "total")),
                raw=dict(raw),
            )
        )
    return rows


# --------------------------------------------------------------------------- #
# Donations export
# --------------------------------------------------------------------------- #
@dataclass
class DonationRow:
    dedup_key: str
    donor_id: str
    received_date: date | None
    fund: str
    amount: float
    net_amount: float
    method: str
    raw: dict = field(default_factory=dict)


def parse_donation_csv(text: str) -> list[DonationRow]:
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return []
    lowmap = _lower_map(reader.fieldnames)
    rows: list[DonationRow] = []
    for raw in reader:
        row_id = _get(raw, lowmap, "id")
        if not row_id:
            continue
        net = parse_amount(_get(raw, lowmap, "net_amount"))
        amount = parse_amount(_get(raw, lowmap, "amount"))
        rows.append(
            DonationRow(
                dedup_key=row_id,
                donor_id=_get(raw, lowmap, "donor_id"),
                received_date=_parse_date(_get(raw, lowmap, "received_date")),
                fund=_get(raw, lowmap, "fund"),
                amount=amount,
                net_amount=net or amount,
                method=_get(raw, lowmap, "payment_method", "payment_source"),
                raw=dict(raw),
            )
        )
    return rows


# --------------------------------------------------------------------------- #
# Donor matching
# --------------------------------------------------------------------------- #
def match_pledge_to_donor(
    email: str, donor_email_map: dict[str, str]
) -> str | None:
    """Match a pledge's email against known donor emails. Returns the
    matched donor_id, or None if no donor has given under that email yet -
    a normal, expected state (see PledgeDonorMatch), not an error.
    """
    key = (email or "").strip().lower()
    if not key:
        return None
    return donor_email_map.get(key)
