"""Core reconciliation logic.

Matches bank 'STRIPE ... TRANSFER' credit lines to Stripe payout records,
explodes each payout into its underlying donations (linked via the Stripe
`Transfer` = payout id), and categorizes both Stripe donations (by fund) and
non-Stripe bank lines (by description keyword rules).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, datetime

from .categorizer import Categorizer
from .parsers import BankRow, StripeRow

# A wizard-only review hint, not a real user note - reconciliation.py's
# import_run strips this exact text back out so it never ends up
# permanently on the Actual/Accrual ledger's Notes field.
UNCATEGORIZED_NOTE = "Uncategorized - add a rule"


@dataclass
class OutputLine:
    source: str
    transaction_date: str = ""
    posted_date: str = ""
    description: str = ""
    statement_description: str = ""
    account_no: str = ""
    category: str = ""
    method: str = ""
    amount: float = 0.0
    reference: str = ""
    bank_description: str = ""
    matched: bool = True
    notes: str = ""
    is_stripe_payout: bool = False

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass
class ReconResult:
    lines: list[OutputLine] = field(default_factory=list)
    bank_line_count: int = 0
    stripe_line_count: int = 0
    matched_payout_count: int = 0
    unmatched_stripe_bank_count: int = 0
    raw_income_total: float = 0.0
    raw_expense_total: float = 0.0
    bank_totals_by_day: dict = field(default_factory=dict)


def _to_date(value: str) -> date | None:
    value = (value or "").split(" ")[0].strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def _date_distance(a: str, b: str) -> int:
    da, db = _to_date(a), _to_date(b)
    if da is None or db is None:
        return 10_000
    return abs((da - db).days)


def _categorize_bank_row(bank: BankRow, categorizer: Categorizer) -> OutputLine:
    cat = categorizer.categorize_bank(bank.description)
    return OutputLine(
        source="bank",
        transaction_date=bank.posting_date,
        posted_date=bank.posting_date,
        # Description is a human-entered name (who/what), not the
        # raw bank statement text - leave it blank when we don't
        # know it rather than dumping the full ACH/CO NAME string.
        # The raw text is still preserved in bank_description. A
        # matching rule's own friendly name (e.g. "Sams Club") fills
        # this in automatically when one is set.
        description=cat.description,
        statement_description=cat.statement_description,
        account_no=cat.account_no,
        category=cat.category or ("Income" if bank.amount > 0 else "Expense"),
        method=bank.type,
        amount=bank.amount,
        reference=bank.raw.get("Check or Slip #", "") or "",
        bank_description=bank.description,
        matched=bool(cat.account_no),
        notes="" if cat.account_no else UNCATEGORIZED_NOTE,
    )


def _categorize_stripe_payout_row(
    bank: BankRow,
    payouts: list[StripeRow],
    donations_by_payout: dict[str, list[StripeRow]],
    consumed_payouts: set[str],
    categorizer: Categorizer,
    match_window_days: int,
) -> tuple[list[OutputLine], bool]:
    """Returns (output lines, matched) for one Stripe-payout-looking bank row."""
    payout = _best_payout(bank, payouts, consumed_payouts, match_window_days)
    if payout is None:
        return (
            [
                OutputLine(
                    source="stripe",
                    transaction_date=bank.posting_date,
                    posted_date=bank.posting_date,
                    description="UNMATCHED STRIPE PAYOUT",
                    method="Stripe",
                    amount=bank.amount,
                    bank_description=bank.description,
                    matched=False,
                    notes="No Stripe payout matched this bank amount.",
                )
            ],
            False,
        )

    consumed_payouts.add(payout.id)
    donations = donations_by_payout.get(payout.source, [])
    if not donations:
        return (
            [
                OutputLine(
                    source="stripe",
                    transaction_date=bank.posting_date,
                    posted_date=bank.posting_date,
                    description="STRIPE PAYOUT (no donation detail)",
                    method="Stripe",
                    amount=bank.amount,
                    reference=payout.id,
                    bank_description=bank.description,
                    matched=False,
                    notes=f"Payout {payout.source} had no linked donations.",
                )
            ],
            True,
        )

    lines: list[OutputLine] = []
    donation_total = 0.0
    for d in donations:
        cat = categorizer.categorize_fund(d.fund)
        donation_total += d.net
        lines.append(
            OutputLine(
                source="stripe",
                transaction_date=d.created,
                posted_date=bank.posting_date,
                description=d.donor or d.description,
                statement_description=cat.statement_description,
                account_no=cat.account_no,
                category=cat.category or "Income",
                method="Stripe",
                amount=round(d.net, 2),
                reference=d.id,
                bank_description=bank.description,
                matched=True,
                notes="" if cat.account_no else f"No fund rule for '{d.fund}'",
            )
        )
    delta = round(bank.amount - donation_total, 2)
    if abs(delta) >= 0.01:
        lines.append(
            OutputLine(
                source="stripe",
                transaction_date=bank.posting_date,
                posted_date=bank.posting_date,
                description="STRIPE PAYOUT ADJUSTMENT",
                method="Stripe",
                amount=delta,
                reference=payout.id,
                bank_description=bank.description,
                matched=False,
                notes="Bank payout minus sum of donation net amounts "
                "(fees / timing).",
            )
        )
    return lines, True


def reconcile(
    bank_rows: list[BankRow],
    stripe_rows: list[StripeRow],
    categorizer: Categorizer,
    match_window_days: int = 7,
) -> ReconResult:
    result = ReconResult(
        bank_line_count=len(bank_rows), stripe_line_count=len(stripe_rows)
    )

    payouts = [r for r in stripe_rows if r.is_payout]
    donations_by_payout: dict[str, list[StripeRow]] = {}
    for r in stripe_rows:
        if r.is_donation and r.transfer:
            donations_by_payout.setdefault(r.transfer, []).append(r)

    consumed_payouts: set[str] = set()

    for bank in bank_rows:
        if bank.is_stripe_payout:
            lines, matched = _categorize_stripe_payout_row(
                bank, payouts, donations_by_payout, consumed_payouts,
                categorizer, match_window_days,
            )
            result.lines.extend(lines)
            if matched:
                result.matched_payout_count += 1
            else:
                result.unmatched_stripe_bank_count += 1
        else:
            result.lines.append(_categorize_bank_row(bank, categorizer))

    return result


def categorize_bank_only(
    bank_rows: list[BankRow], categorizer: Categorizer
) -> ReconResult:
    """Wizard step 1: categorize the bank file alone, before any Stripe data
    exists. Stripe-payout-looking rows become placeholders (is_stripe_payout)
    with no category yet - they're matched later by merge_stripe()."""
    result = ReconResult(bank_line_count=len(bank_rows))
    for bank in bank_rows:
        if bank.is_stripe_payout:
            result.lines.append(
                OutputLine(
                    source="bank",
                    transaction_date=bank.posting_date,
                    posted_date=bank.posting_date,
                    category="Pending Stripe match",
                    method=bank.type,
                    amount=bank.amount,
                    bank_description=bank.description,
                    matched=False,
                    is_stripe_payout=True,
                    notes="Will be matched once the Stripe file is uploaded.",
                )
            )
        else:
            result.lines.append(_categorize_bank_row(bank, categorizer))
    result.raw_income_total = round(
        sum(b.amount for b in bank_rows if b.amount > 0), 2
    )
    result.raw_expense_total = round(
        sum(b.amount for b in bank_rows if b.amount < 0), 2
    )
    return result


def merge_stripe(
    placeholder_bank_rows: list[BankRow],
    stripe_rows: list[StripeRow],
    categorizer: Categorizer,
    match_window_days: int = 7,
) -> ReconResult:
    """Wizard step 3: match the Stripe file against the bank-payout
    placeholders created by categorize_bank_only(). Every other line from
    step 1 (including anything the user has since edited) is untouched -
    this only produces the replacement lines for the placeholders."""
    result = ReconResult(stripe_line_count=len(stripe_rows))

    payouts = [r for r in stripe_rows if r.is_payout]
    donations_by_payout: dict[str, list[StripeRow]] = {}
    for r in stripe_rows:
        if r.is_donation and r.transfer:
            donations_by_payout.setdefault(r.transfer, []).append(r)

    consumed_payouts: set[str] = set()
    bank_totals_by_day: dict[str, float] = {}
    for bank in placeholder_bank_rows:
        lines, matched = _categorize_stripe_payout_row(
            bank, payouts, donations_by_payout, consumed_payouts,
            categorizer, match_window_days,
        )
        result.lines.extend(lines)
        if matched:
            result.matched_payout_count += 1
        else:
            result.unmatched_stripe_bank_count += 1
        bank_totals_by_day[bank.posting_date] = round(
            bank_totals_by_day.get(bank.posting_date, 0.0) + bank.amount, 2
        )

    result.bank_totals_by_day = bank_totals_by_day
    return result


def _best_payout(
    bank: BankRow,
    payouts: list[StripeRow],
    consumed: set[str],
    window_days: int,
) -> StripeRow | None:
    target = round(bank.amount, 2)
    candidates = [
        p
        for p in payouts
        if p.id not in consumed and round(abs(p.amount), 2) == target
    ]
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]
    # Disambiguate multiple equal-amount payouts by nearest date.
    candidates.sort(
        key=lambda p: _date_distance(bank.posting_date, p.transfer_date or p.created)
    )
    best = candidates[0]
    if _date_distance(bank.posting_date, best.transfer_date or best.created) > max(
        window_days, 30
    ):
        # Still return best guess; amount matched exactly.
        return best
    return best
