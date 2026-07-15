"""Income Statement aggregation - shared by the Income Statement tab and the
Home dashboard (which reuses the section totals for its Income/Expense YTD
vs Budget tiles), so both always agree on the same numbers."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import AccrualEntry, BudgetEntry, ChartOfAccount, ReconciliationEntry
from ..schemas import IncomeStatementGroupOut, IncomeStatementOut, IncomeStatementRowOut
from .fiscal import get_current_year, get_prior_year_end_date, is_cy


def _row(label: str, plan: float, actuals: float, favorable_when_actual_higher: bool) -> IncomeStatementRowOut:
    plan = round(plan, 2)
    actuals = round(abs(actuals), 2)
    variance = round((actuals - plan) if favorable_when_actual_higher else (plan - actuals), 2)
    return IncomeStatementRowOut(label=label, plan=plan, actuals=actuals, variance=variance)


def _section_groups(
    category: str,
    coa_by_no: dict[str, ChartOfAccount],
    plan_by_key: dict[tuple[str, str], float],
    actuals_by_key: dict[tuple[str, str], float],
    favorable_when_actual_higher: bool,
) -> list[IncomeStatementGroupOut]:
    # (statement_category -> ordered list of statement_item names), in Chart
    # of Accounts order, deduped - so grouping/row order matches how the
    # accounts were entered rather than an arbitrary alphabetical sort.
    items_by_cat: dict[str, list[str]] = {}
    for coa in coa_by_no.values():
        if coa.category != category or not coa.statement_category or not coa.statement_item:
            continue
        items = items_by_cat.setdefault(coa.statement_category, [])
        if coa.statement_item not in items:
            items.append(coa.statement_item)

    groups = []
    for stmt_cat in sorted(items_by_cat):
        rows = []
        for item in items_by_cat[stmt_cat]:
            key = (stmt_cat, item)
            rows.append(
                _row(item, plan_by_key.get(key, 0.0), actuals_by_key.get(key, 0.0), favorable_when_actual_higher)
            )
        subtotal = _row(
            stmt_cat,
            sum(r.plan for r in rows),
            sum(r.actuals for r in rows),
            favorable_when_actual_higher,
        )
        groups.append(IncomeStatementGroupOut(statement_category=stmt_cat, rows=rows, subtotal=subtotal))
    return groups


def _section_total(groups: list[IncomeStatementGroupOut], favorable_when_actual_higher: bool) -> IncomeStatementRowOut:
    return _row(
        "Total",
        sum(g.subtotal.plan for g in groups),
        sum(g.subtotal.actuals for g in groups),
        favorable_when_actual_higher,
    )


def compute_income_statement(db: Session) -> IncomeStatementOut:
    """Plan (Budget) vs Actuals (Reconciliation + Accrual, CY only), grouped
    by Statement Category -> Statement Item, split into Income and
    Expenditures sections - same shape as the legacy sheet's Income
    Statement tab. Budget and Income/Expense accounts are joined by
    (Statement Category, Statement Item) name, not account number - the two
    account trees are numbered independently but share item/category names.
    Variance is "favorable direction" per section: for Income, actual > plan
    is favorable (positive); for Expenditures, actual < plan is favorable
    (positive) - matches the sheet's sign convention.
    """
    year = get_current_year(db)
    cutoff = get_prior_year_end_date(db)
    coa_by_no = {a.account_no: a for a in db.scalars(select(ChartOfAccount))}

    plan_by_key: dict[tuple[str, str], float] = {}
    for e in db.scalars(select(BudgetEntry)):
        if e.transaction_date is None or e.transaction_date.year != year:
            continue
        coa = coa_by_no.get(e.account_no)
        if coa is None or not coa.statement_category or not coa.statement_item:
            continue
        key = (coa.statement_category, coa.statement_item)
        plan_by_key[key] = plan_by_key.get(key, 0.0) + e.amount

    actuals_by_key: dict[tuple[str, str], float] = {}
    for model in (ReconciliationEntry, AccrualEntry):
        for e in db.scalars(select(model).where(model.is_split == False)):  # noqa: E712
            if not is_cy(e.transaction_date, cutoff):
                continue
            coa = coa_by_no.get(e.account_no)
            if (
                coa is None
                or coa.category not in ("Income", "Expense")
                or not coa.statement_category
                or not coa.statement_item
            ):
                continue
            key = (coa.statement_category, coa.statement_item)
            actuals_by_key[key] = actuals_by_key.get(key, 0.0) + e.amount

    income_groups = _section_groups(
        "Income", coa_by_no, plan_by_key, actuals_by_key, favorable_when_actual_higher=True
    )
    expense_groups = _section_groups(
        "Expense", coa_by_no, plan_by_key, actuals_by_key, favorable_when_actual_higher=False
    )

    return IncomeStatementOut(
        year=year,
        income_groups=income_groups,
        income_total=_section_total(income_groups, favorable_when_actual_higher=True),
        expense_groups=expense_groups,
        expense_total=_section_total(expense_groups, favorable_when_actual_higher=False),
    )
