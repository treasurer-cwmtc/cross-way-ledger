"""Seed the Chart of Accounts (from CSV) and a set of default categorization
rules on first startup. Safe to call repeatedly - it only inserts when the
relevant table is empty."""

from __future__ import annotations

import csv
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .models import CategoryRule, ChartOfAccount, StatementCategory, StatementItem, User
from .security import hash_password
from .services.coa_numbering import (
    compute_account_no,
    default_description,
    get_or_create_statement_category,
    get_or_create_statement_item,
)

COA_CSV = Path(__file__).parent / "data" / "chart_of_accounts.csv"

DEFAULT_FUND_RULES: list[tuple[str, str]] = [
    ("Pledges", "I101010"),
    ("Sunday Offertory", "I101210"),
    ("Thanksgiving Offertory", "I101310"),
    ("Building Fund", "I101728"),
    ("Building fund", "I101728"),
    ("General Funds", "I101725"),
    ("General", "I101725"),
    ("VBS", "I101416"),
    ("VBS 2026", "I101416"),
    ("Missions", "I101110"),
]

DEFAULT_KEYWORD_RULES: list[tuple[str, str]] = [
    ("DIRECT ENERGY", "E141712"),
    ("COMMUNITY WASTE", "E141711"),
    ("CITITURF", "E221310"),
    ("ATMOS ENERGY", "E221213"),
    ("SPECTRUM", "E221212"),
    ("NTTA", "E101810"),
    ("Diocese of North America", "E101710"),
    ("SAMS CLUB", "E151910"),
]


def load_chart_of_accounts_from_csv(db: Session, text: str) -> int:
    """Seed the Chart of Accounts hierarchy from `text` (used on first startup
    only - there is no in-app bulk import; accounts are added one at a time
    via the API afterward).

    Category/Item/Detail numbers are DERIVED from each row's names, not
    copied from the source spreadsheet's own numbering columns - the source
    numbering is inconsistent (e.g. it forks a new "category" number for
    what is really just an item variation, and reuses one category number
    for two differently-named groups). Deriving by name collapses same-named
    groups together and gives every level - including the Statement Detail -
    its own clean sequential code. Rows with no Statement Category/Item name
    (the spreadsheet's blank "x00000" rollup rows) are skipped, and a
    duplicate (item, detail-name) pair in the source is skipped rather than
    erroring. Returns row count."""
    db.query(ChartOfAccount).delete()
    db.query(StatementItem).delete()
    db.query(StatementCategory).delete()

    reader = csv.DictReader(text.splitlines())
    count = 0
    for row in reader:
        category = (row.get("Category") or "").strip()
        statement_category_name = (row.get("StatementCategory") or "").strip()
        statement_item_name = (row.get("StatementItem") or "").strip()
        statement_detail_name = (row.get("StatementDetail") or "").strip()
        if not category or not statement_category_name or not statement_item_name:
            continue

        cat_row = get_or_create_statement_category(db, category, statement_category_name)
        item_row = get_or_create_statement_item(db, cat_row.id, statement_item_name)

        try:
            account_no, _item, detail_no = compute_account_no(
                db, item_row.id, statement_detail_name
            )
        except ValueError:
            continue

        description = default_description(
            category, cat_row.name, item_row.name, statement_detail_name
        )
        db.add(
            ChartOfAccount(
                account_no=account_no,
                statement_item_id=item_row.id,
                category=category,
                statement_category=cat_row.name,
                statement_category_no=cat_row.no,
                statement_item=item_row.name,
                statement_item_no=item_row.no,
                statement_detail=statement_detail_name,
                statement_detail_no=detail_no,
                statement_description=description,
                is_tax_deductible=(row.get("IsTaxDeductible") or "").strip(),
                is_mandatory=(row.get("IsMandatory") or "").strip(),
                grouping=(row.get("Grouping") or "").strip(),
                is_youth_chaplain_share=(row.get("IsYouthChaplainShare") or "").strip(),
                is_missions=(row.get("IsMissions") or "").strip(),
            )
        )
        db.flush()  # so the next row's duplicate-detail check sees this one
        count += 1
    db.commit()
    return count


def seed(db: Session) -> None:
    settings = get_settings()

    if db.scalar(select(User).limit(1)) is None:
        db.add(
            User(
                username=settings.admin_username,
                password_hash=hash_password(settings.admin_password),
                is_admin=True,
            )
        )
        db.commit()

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
