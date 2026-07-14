"""Helpers for turning a completed Upload run (ReconLine rows) into
persistent ReconciliationEntry rows: friendly Method mapping, date parsing,
and the dedup key that keeps a second import of the same statement from
creating duplicate rows."""

from __future__ import annotations

from datetime import date, datetime

# Chase's raw `Type` column -> the small set of Method values used on the
# Reconciliation ledger. Anything not listed here falls back to "Other" -
# the Method cell stays a free-editable dropdown either way.
METHOD_MAP: dict[str, str] = {
    "CHECK_DEPOSIT": "Check",
    "CHECK_PAID": "Check",
    "DEBIT_CARD": "Debit",
    "ACH_DEBIT": "Debit",
    "BILLPAY": "Debit",
    "ATM": "Debit",
    "QUICKPAY_DEBIT": "Zelle",
    "QUICKPAY_CREDIT": "Zelle",
    "PARTNERFI_TO_CHASE": "Zelle",
    "CHASE_TO_PARTNERFI": "Zelle",
    "WIRE_INCOMING": "Wire",
    "WIRE_OUTGOING": "Wire",
    "DEPOSIT": "Deposit",
    "MISC_CREDIT": "Deposit",
}


def friendly_method(raw_method: str) -> str:
    if raw_method == "Stripe":
        return "Stripe"
    return METHOD_MAP.get(raw_method.strip().upper(), "Other") if raw_method else ""


def parse_date(value: str) -> date | None:
    value = (value or "").split(" ")[0].strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def build_dedup_key(
    transaction_date: date | None,
    amount: float,
    check_invoice_name: str,
    bank_description: str,
) -> str:
    """A transaction's natural identity: date + amount + whichever of
    (Check/Invoice Name, Bank Description) is available to disambiguate same-
    amount-same-day transactions. Check/Invoice Name (the Stripe txn id or a
    check number) is preferred since it's closest to a true external id;
    Bank Description is the fallback for plain bank lines."""
    key_text = (check_invoice_name or bank_description or "").strip().lower()
    date_part = transaction_date.isoformat() if transaction_date else ""
    return f"{date_part}|{round(amount, 2)}|{key_text}"
