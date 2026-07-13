"""CSV parsing for the Chase bank export and the Stripe transaction export."""

from __future__ import annotations

import csv
import io
import json
import re
from dataclasses import dataclass, field


def parse_amount(value: str | None) -> float:
    """Parse '$1,234.56', '-$47.74', '(50.00)' etc. into a float."""
    if value is None:
        return 0.0
    s = str(value).strip()
    if not s:
        return 0.0
    negative = s.startswith("(") and s.endswith(")")
    s = s.replace("(", "").replace(")", "")
    s = s.replace("$", "").replace(",", "").strip()
    if s in {"", "-"}:
        return 0.0
    try:
        amount = float(s)
    except ValueError:
        return 0.0
    return -amount if negative else amount


def normalize_date(value: str | None) -> str:
    """Return the date portion (YYYY-MM-DD not required; keep source M/D/YYYY)."""
    if not value:
        return ""
    return str(value).split(" ")[0].strip()


def _lower_map(fieldnames: list[str]) -> dict[str, str]:
    return {name.lower().strip(): name for name in fieldnames}


def _get(row: dict, lowmap: dict[str, str], *candidates: str) -> str:
    for cand in candidates:
        key = lowmap.get(cand.lower())
        if key is not None and row.get(key) not in (None, ""):
            return str(row[key]).strip()
    return ""


# --------------------------------------------------------------------------- #
# Bank (Chase) export
# --------------------------------------------------------------------------- #
@dataclass
class BankRow:
    details: str
    posting_date: str
    description: str
    amount: float
    type: str
    raw: dict = field(default_factory=dict)

    @property
    def is_stripe_payout(self) -> bool:
        d = self.description.upper()
        return "STRIPE" in d and self.amount > 0


def parse_bank_csv(text: str) -> list[BankRow]:
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return []
    lowmap = _lower_map(reader.fieldnames)
    rows: list[BankRow] = []
    for raw in reader:
        description = _get(raw, lowmap, "Description")
        posting_date = normalize_date(
            _get(raw, lowmap, "Posting Date", "Date Posted", "Date")
        )
        amount = parse_amount(_get(raw, lowmap, "Amount"))
        if not description and amount == 0.0:
            continue
        rows.append(
            BankRow(
                details=_get(raw, lowmap, "Details"),
                posting_date=posting_date,
                description=description,
                amount=amount,
                type=_get(raw, lowmap, "Type"),
                raw=dict(raw),
            )
        )
    return rows


# --------------------------------------------------------------------------- #
# Stripe export
# --------------------------------------------------------------------------- #
_DESC_RE = re.compile(
    r"^(?:Donation|Registration|Payment)\s+#\d+\s*-\s*(?P<donor>.+?)\s*-\s*"
    r"(?P<fund>.+?)\s*(?:\(\$?[\d,]+\.\d{2}\))?\s*$"
)


@dataclass
class StripeRow:
    id: str
    type: str  # payout | payment | charge | refund | ...
    source: str  # py_/ch_/po_ id
    amount: float
    fee: float
    net: float
    created: str
    description: str
    transfer: str  # po_ id linking a donation to its payout
    transfer_date: str
    fund: str
    donor: str
    raw: dict = field(default_factory=dict)

    @property
    def is_payout(self) -> bool:
        return self.type.lower() == "payout"

    @property
    def is_donation(self) -> bool:
        return self.type.lower() in {"payment", "charge"}


def _extract_fund_donor(description: str, context_json: str, person_name: str):
    fund = ""
    donor = ""
    m = _DESC_RE.match(description or "")
    if m:
        donor = m.group("donor").strip()
        fund = m.group("fund").strip()
    if not fund and context_json:
        try:
            items = json.loads(context_json)
            if isinstance(items, list) and items and isinstance(items[0], dict):
                fund = str(items[0].get("name", "")).strip()
        except (ValueError, TypeError):
            pass
    if person_name:
        donor = person_name.strip()
    return fund, donor


def parse_stripe_csv(text: str) -> list[StripeRow]:
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return []
    lowmap = _lower_map(reader.fieldnames)
    rows: list[StripeRow] = []
    for raw in reader:
        row_id = _get(raw, lowmap, "id")
        rtype = _get(raw, lowmap, "Type")
        if not row_id and not rtype:
            continue
        description = _get(raw, lowmap, "Description")
        context = _get(
            raw,
            lowmap,
            "planning_center_context (metadata)",
            "planning_center_context",
        )
        person = _get(
            raw,
            lowmap,
            "planning_center_person_name (metadata)",
            "planning_center_person_name",
        )
        fund, donor = _extract_fund_donor(description, context, person)
        rows.append(
            StripeRow(
                id=row_id,
                type=rtype,
                source=_get(raw, lowmap, "Source"),
                amount=parse_amount(_get(raw, lowmap, "Amount")),
                fee=parse_amount(_get(raw, lowmap, "Fee")),
                net=parse_amount(_get(raw, lowmap, "Net")),
                created=normalize_date(_get(raw, lowmap, "Created (UTC)", "Created")),
                description=description,
                transfer=_get(raw, lowmap, "Transfer"),
                transfer_date=normalize_date(
                    _get(raw, lowmap, "Transfer Date (UTC)", "Transfer Date")
                ),
                fund=fund,
                donor=donor,
                raw=dict(raw),
            )
        )
    return rows
