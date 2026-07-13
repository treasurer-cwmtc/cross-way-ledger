"""Seed the Chart of Accounts (from CSV) and a set of default categorization
rules on first startup. Safe to call repeatedly - it only inserts when the
relevant table is empty."""

from __future__ import annotations

import csv
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import CategoryRule, ChartOfAccount

COA_CSV = Path(__file__).parent / "data" / "chart_of_accounts.csv"

DEFAULT_FUND_RULES: list[tuple[str, str]] = [
    ("Pledges", "I101010"),
    ("Sunday Offertory", "I121010"),
    ("Thanksgiving Offertory", "I131010"),
    ("Building Fund", "I172810"),
    ("Building fund", "I172810"),
    ("General Funds", "I172510"),
    ("General", "I172510"),
    ("VBS", "I141310"),
    ("VBS 2026", "I141310"),
    ("Missions", "I111010"),
]

DEFAULT_KEYWORD_RULES: list[tuple[str, str]] = [
    ("DIRECT ENERGY", "E141712"),
    ("COMMUNITY WASTE", "E141711"),
    ("CITITURF", "E221214"),
    ("ATMOS ENERGY", "E221213"),
    ("SPECTRUM", "E221212"),
    ("NTTA", "E101810"),
    ("Diocese of North America", "E101710"),
    ("SAMS CLUB", "E151910"),
]


def load_chart_of_accounts_from_csv(db: Session, text: str) -> int:
    """Replace the Chart of Accounts with rows from `text`. Returns row count."""
    db.query(ChartOfAccount).delete()
    reader = csv.DictReader(text.splitlines())
    count = 0
    for row in reader:
        account_no = (row.get("AccountNo") or "").strip()
        if not account_no:
            continue
        db.merge(
            ChartOfAccount(
                account_no=account_no,
                category=(row.get("Category") or "").strip(),
                statement_category=(row.get("StatementCategory") or "").strip(),
                statement_item=(row.get("StatementItem") or "").strip(),
                statement_detail=(row.get("StatementDetail") or "").strip(),
                statement_description=(row.get("StatementDescription") or "").strip(),
                is_tax_deductible=(row.get("IsTaxDeductible") or "").strip(),
                is_mandatory=(row.get("IsMandatory") or "").strip(),
            )
        )
        count += 1
    db.commit()
    return count


def seed(db: Session) -> None:
    if db.scalar(select(ChartOfAccount).limit(1)) is None and COA_CSV.exists():
        load_chart_of_accounts_from_csv(db, COA_CSV.read_text(encoding="utf-8"))

    if db.scalar(select(CategoryRule).limit(1)) is None:
        for i, (pattern, account_no) in enumerate(DEFAULT_FUND_RULES):
            db.add(
                CategoryRule(
                    rule_type="stripe_fund",
                    pattern=pattern,
                    account_no=account_no,
                    priority=10 + i,
                )
            )
        for i, (pattern, account_no) in enumerate(DEFAULT_KEYWORD_RULES):
            db.add(
                CategoryRule(
                    rule_type="bank_keyword",
                    pattern=pattern,
                    account_no=account_no,
                    priority=10 + i,
                )
            )
        db.commit()
