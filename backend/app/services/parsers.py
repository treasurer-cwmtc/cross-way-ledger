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
    # The full itemized fund/amount breakdown when a single donation is
    # split across multiple funds in one checkout (e.g. Planning Center
    # Giving's multi-fund gifts) - (fund name, dollar amount) pairs, in
    # order, summing to this row's net amount. Empty for an ordinary
    # single-fund donation (use `fund`/`net` as-is then). See issue #124:
    # posting a split gift's full amount to whichever single fund matched
    # first was a real mis-posting risk, not just a cosmetic label issue.
    fund_breakdown: list[tuple[str, float]] = field(default_factory=list)
    raw: dict = field(default_factory=dict)

    @property
    def is_payout(self) -> bool:
        return self.type.lower() == "payout"

    @property
    def is_donation(self) -> bool:
        return self.type.lower() in {"payment", "charge"}


def parse_fund_breakdown(context_json: str) -> list[tuple[str, float]]:
    """Parses the *full* itemized fund/amount breakdown out of Planning
    Center's `planning_center_context` metadata (a JSON list of
    {"name": ..., "cents": ...} objects) - one entry per fund a donor
    designated in a single gift. Unlike extract_fund_donor's single-fund
    fallback (which only ever looked at the first item), this returns every
    designated fund so a split gift can be posted to each of its actual
    accounts instead of all-or-nothing. See issue #124."""
    if not context_json:
        return []
    try:
        items = json.loads(context_json)
    except (ValueError, TypeError):
        return []
    if not isinstance(items, list):
        return []
    out: list[tuple[str, float]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "")).strip()
        cents = item.get("cents")
        if not name or not isinstance(cents, (int, float)) or isinstance(cents, bool):
            continue
        out.append((name, round(cents / 100, 2)))
    return out


def extract_fund_donor(description: str, context_json: str, person_name: str):
    fund = ""
    donor = ""
    m = _DESC_RE.match(description or "")
    if m:
        donor = m.group("donor").strip()
        fund = m.group("fund").strip()
    breakdown = parse_fund_breakdown(context_json)
    if len(breakdown) > 1:
        # A split gift across multiple funds - the regex above can't tell
        # separate "Fund Name ($amount)" segments apart from one another and
        # garbles the whole tail into one string (see issue #124), so
        # override with a clean, readable list from PCO's own structured
        # metadata instead. This `fund` string is display-only from here on;
        # the real per-fund split for categorization/posting is driven by
        # parse_fund_breakdown() at the row-building call site, not this.
        fund = ", ".join(name for name, _ in breakdown)
    elif not fund and breakdown:
        fund = breakdown[0][0]
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
        fund, donor = extract_fund_donor(description, context, person)
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
                fund_breakdown=parse_fund_breakdown(context),
                raw=dict(raw),
            )
        )
    return rows
