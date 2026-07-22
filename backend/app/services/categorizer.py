"""Applies user-editable categorization rules and Chart-of-Accounts lookups."""

from __future__ import annotations

from dataclasses import dataclass

from ..models import CategoryRule, ChartOfAccount


@dataclass
class Category:
    account_no: str = ""
    statement_description: str = ""
    category: str = ""
    # The rule's own friendly "who/what" name (e.g. "Sams Club"), not to be
    # confused with statement_description (the Chart of Accounts category
    # name) - only bank_keyword rules populate this.
    description: str = ""


class Categorizer:
    def __init__(
        self, rules: list[CategoryRule], accounts: list[ChartOfAccount]
    ) -> None:
        self.coa: dict[str, ChartOfAccount] = {a.account_no: a for a in accounts}
        active = [r for r in rules if r.active]
        active.sort(key=lambda r: (r.priority, r.id))
        self.fund_rules = [r for r in active if r.rule_type == "stripe_fund"]
        self.keyword_rules = [r for r in active if r.rule_type == "bank_keyword"]

    def _resolve(self, account_no: str, description: str = "") -> Category:
        acct = self.coa.get(account_no)
        if acct is None:
            return Category(account_no=account_no, description=description)
        return Category(
            account_no=acct.account_no,
            statement_description=acct.statement_description,
            category=acct.category,
            description=description,
        )

    def categorize_fund(self, fund: str) -> Category:
        if not fund:
            return Category()
        f = fund.lower().strip()
        # Exact (normalized) match wins first.
        for rule in self.fund_rules:
            if rule.pattern.lower().strip() == f:
                return self._resolve(rule.account_no, rule.description)
        # Then substring match (e.g. rule 'VBS' matches fund 'VBS 2026').
        for rule in self.fund_rules:
            p = rule.pattern.lower().strip()
            if p and (p in f or f in p):
                return self._resolve(rule.account_no, rule.description)
        return Category()

    def categorize_bank(self, description: str) -> Category:
        if not description:
            return Category()
        d = description.lower()
        for rule in self.keyword_rules:
            p = rule.pattern.lower().strip()
            if p and p in d:
                return self._resolve(rule.account_no, rule.description)
        return Category()
