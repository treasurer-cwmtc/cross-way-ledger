"""Chart of Accounts hierarchy: StatementCategory -> StatementItem -> Detail
(=ChartOfAccount, the leaf/account row).

Each level's `no` is a 2-digit code that **auto-increments within its parent
scope and is never reused** (even after a delete) - true identity-column
semantics, not gap-filling. account_no is always derived, never hand-typed:

    <TypePrefix><StatementCategoryNo><StatementItemNo><StatementDetailNo>

TypePrefix is B/E/I for category Budget/Expense/Income. Detail name is
optional (a "no subdivision" account for that item) but still takes the next
sequential code in its scope like any other detail - there is no separate
"00" special case.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import ChartOfAccount, StatementCategory, StatementItem

CATEGORY_PREFIX = {"Budget": "B", "Expense": "E", "Income": "I"}


def _next_no(existing: set[str], start: int = 10) -> str:
    """Next code strictly after the highest one in use (or `start` if none) -
    never reuses a freed number."""
    used = {int(c) for c in existing if c.isdigit()}
    n = max(used, default=start - 1) + 1
    if n > 99:
        raise ValueError("No numbering codes left in this scope (max 99).")
    return f"{n:02d}"


def default_description(
    category: str, statement_category: str, statement_item: str, statement_detail: str
) -> str:
    parts = [category, statement_category, statement_item]
    if statement_detail:
        parts.append(statement_detail)
    return " - ".join(p for p in parts if p)


def create_statement_category(db: Session, category: str, name: str) -> StatementCategory:
    """Strict create for the interactive API: errors if the name already
    exists under this Type, so a user doesn't accidentally fork a group."""
    if category not in CATEGORY_PREFIX:
        raise ValueError(f"Unknown category '{category}' (expected Budget/Expense/Income).")
    name = name.strip()
    if not name:
        raise ValueError("Name is required.")

    siblings = list(
        db.scalars(select(StatementCategory).where(StatementCategory.category == category))
    )
    if any(s.name.strip().lower() == name.lower() for s in siblings):
        raise ValueError(f"A Statement Category named '{name}' already exists under {category}.")

    no = _next_no({s.no for s in siblings})
    row = StatementCategory(category=category, no=no, name=name)
    db.add(row)
    db.flush()
    return row


def get_or_create_statement_category(db: Session, category: str, name: str) -> StatementCategory:
    """Bulk-seeding variant: reuses the existing row for this (Type, name)
    instead of erroring, so the same name appearing on multiple source rows
    collapses into one category instead of forking a new number each time."""
    name = name.strip()
    siblings = list(
        db.scalars(select(StatementCategory).where(StatementCategory.category == category))
    )
    match = next((s for s in siblings if s.name.strip().lower() == name.lower()), None)
    if match is not None:
        return match
    no = _next_no({s.no for s in siblings})
    row = StatementCategory(category=category, no=no, name=name)
    db.add(row)
    db.flush()
    return row


def create_statement_item(db: Session, statement_category_id: int, name: str) -> StatementItem:
    """Strict create for the interactive API: errors if the name already
    exists under this parent category."""
    parent = db.get(StatementCategory, statement_category_id)
    if parent is None:
        raise ValueError("Statement Category not found.")
    name = name.strip()
    if not name:
        raise ValueError("Name is required.")

    siblings = list(
        db.scalars(
            select(StatementItem).where(
                StatementItem.statement_category_id == statement_category_id
            )
        )
    )
    if any(s.name.strip().lower() == name.lower() for s in siblings):
        raise ValueError(f"A Statement Item named '{name}' already exists under {parent.name}.")

    no = _next_no({s.no for s in siblings})
    row = StatementItem(statement_category_id=statement_category_id, no=no, name=name)
    db.add(row)
    db.flush()
    return row


def get_or_create_statement_item(
    db: Session, statement_category_id: int, name: str
) -> StatementItem:
    """Bulk-seeding variant: reuses the existing row for this (parent, name)
    instead of erroring."""
    name = name.strip()
    siblings = list(
        db.scalars(
            select(StatementItem).where(
                StatementItem.statement_category_id == statement_category_id
            )
        )
    )
    match = next((s for s in siblings if s.name.strip().lower() == name.lower()), None)
    if match is not None:
        return match
    no = _next_no({s.no for s in siblings})
    row = StatementItem(statement_category_id=statement_category_id, no=no, name=name)
    db.add(row)
    db.flush()
    return row


def compute_account_no(
    db: Session, statement_item_id: int, statement_detail: str = ""
) -> tuple[str, StatementItem, str]:
    """Returns (account_no, parent_item, detail_no). Raises ValueError on bad
    input or an unavoidable collision."""
    item = db.get(StatementItem, statement_item_id)
    if item is None:
        raise ValueError("Statement Item not found.")
    category_row = item.statement_category
    prefix = CATEGORY_PREFIX[category_row.category]

    statement_detail = statement_detail.strip()
    siblings = list(
        db.scalars(select(ChartOfAccount).where(ChartOfAccount.statement_item_id == item.id))
    )
    if any(s.statement_detail.strip().lower() == statement_detail.lower() for s in siblings):
        existing = "(blank)" if not statement_detail else f"'{statement_detail}'"
        raise ValueError(
            f"A Statement Detail {existing} already exists under {item.name}."
        )
    detail_no = _next_no({s.statement_detail_no for s in siblings})

    account_no = f"{prefix}{category_row.no}{item.no}{detail_no}"
    if db.get(ChartOfAccount, account_no) is not None:
        raise ValueError(f"Account number {account_no} already exists.")
    return account_no, item, detail_no
