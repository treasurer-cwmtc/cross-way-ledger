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


@dataclass
class OutputLine:
    source: str
    transaction_date: str = ""
    date_posted: str = ""
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

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass
class ReconResult:
    lines: list[OutputLine] = field(default_factory=list)
    bank_line_count: int = 0
    stripe_line_count: int = 0
    matched_payout_count: int = 0
    unmatched_stripe_bank_count: int = 0


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
            payout = _best_payout(
                bank, payouts, consumed_payouts, match_window_days
            )
            if payout is None:
                result.unmatched_stripe_bank_count += 1
                result.lines.append(
                    OutputLine(
                        source="stripe",
                        transaction_date=bank.posting_date,
                        date_posted=bank.posting_date,
                        description="UNMATCHED STRIPE PAYOUT",
                        method="Stripe",
                        amount=bank.amount,
                        bank_description=bank.description,
                        matched=False,
                        notes="No Stripe payout matched this bank amount.",
                    )
                )
                continue

            consumed_payouts.add(payout.id)
            result.matched_payout_count += 1
            donations = donations_by_payout.get(payout.source, [])
            if not donations:
                result.lines.append(
                    OutputLine(
                        source="stripe",
                        transaction_date=bank.posting_date,
                        date_posted=bank.posting_date,
                        description="STRIPE PAYOUT (no donation detail)",
                        method="Stripe",
                        amount=bank.amount,
                        reference=payout.id,
                        bank_description=bank.description,
                        matched=False,
                        notes=f"Payout {payout.source} had no linked donations.",
                    )
                )
                continue

            donation_total = 0.0
            for d in donations:
                cat = categorizer.categorize_fund(d.fund)
                donation_total += d.net
                result.lines.append(
                    OutputLine(
                        source="stripe",
                        transaction_date=d.created,
                        date_posted=bank.posting_date,
                        description=d.donor or d.description,
                        statement_description=cat.statement_description,
                        account_no=cat.account_no,
                        category=cat.category or "Income",
                        method="Stripe",
                        amount=round(d.net, 2),
                        reference=d.id,
                        bank_description=bank.description,
                        matched=True,
                        notes=""
                        if cat.account_no
                        else f"No fund rule for '{d.fund}'",
                    )
                )
            delta = round(bank.amount - donation_total, 2)
            if abs(delta) >= 0.01:
                result.lines.append(
                    OutputLine(
                        source="stripe",
                        transaction_date=bank.posting_date,
                        date_posted=bank.posting_date,
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
        else:
            cat = categorizer.categorize_bank(bank.description)
            result.lines.append(
                OutputLine(
                    source="bank",
                    transaction_date=bank.posting_date,
                    date_posted=bank.posting_date,
                    # Description is a human-entered name (who/what), not the
                    # raw bank statement text - leave it blank when we don't
                    # know it rather than dumping the full ACH/CO NAME string.
                    # The raw text is still preserved in bank_description.
                    description="",
                    statement_description=cat.statement_description,
                    account_no=cat.account_no,
                    category=cat.category
                    or ("Income" if bank.amount > 0 else "Expense"),
                    method=bank.type,
                    amount=bank.amount,
                    reference=bank.raw.get("Check or Slip #", "") or "",
                    bank_description=bank.description,
                    matched=bool(cat.account_no),
                    notes="" if cat.account_no else "Uncategorized - add a rule",
                )
            )

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
