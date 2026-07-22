"""Tests for the core reconciliation pipeline (parsing, matching, categorizing).

Run from the backend/ directory:  python -m pytest
"""

import os
from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import CategoryRule, ChartOfAccount
from app.seed import seed
from app.services.categorizer import Categorizer
from app.services.parsers import parse_bank_csv, parse_stripe_csv
from app.services.reconciler import reconcile

FIXTURES = Path(__file__).parent


def make_session():
    # Real Postgres, same as every real environment - no SQLite fallback.
    # See docs/DEPLOYMENT.md for how to point this at a throwaway instance.
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL must be set to a real Postgres instance to run tests.")
    engine = create_engine(database_url)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    seed(db)
    return db


def run_pipeline():
    db = make_session()
    try:
        bank = parse_bank_csv((FIXTURES / "sample_bank.csv").read_text())
        stripe = parse_stripe_csv((FIXTURES / "sample_stripe.csv").read_text())
        categorizer = Categorizer(
            list(db.scalars(select(CategoryRule)).all()),
            list(db.scalars(select(ChartOfAccount)).all()),
        )
        return reconcile(bank, stripe, categorizer)
    finally:
        # Must close explicitly: against a real (shared) Postgres instance,
        # a session left open keeps a lock that blocks the next call's
        # drop_all() - unlike SQLite, where each call got its own throwaway
        # in-memory DB so a leaked session never mattered.
        db.close()


def test_seed_loads_chart_of_accounts():
    db = make_session()
    try:
        assert db.scalar(select(ChartOfAccount).where(ChartOfAccount.account_no == "I101010"))
        assert db.scalar(select(CategoryRule).where(CategoryRule.pattern == "Pledges"))
    finally:
        db.close()


def test_payout_matched_and_exploded():
    result = run_pipeline()
    assert result.matched_payout_count == 1
    assert result.unmatched_stripe_bank_count == 0
    stripe_lines = [l for l in result.lines if l.source == "stripe"]
    # 5 donations explode from the single payout, no adjustment line (sum matches).
    assert len(stripe_lines) == 5
    assert all(l.matched for l in stripe_lines)


def test_donation_amounts_use_net_and_sum_to_bank():
    result = run_pipeline()
    stripe_total = round(sum(l.amount for l in result.lines if l.source == "stripe"), 2)
    assert stripe_total == 771.50


def test_fund_categorization():
    result = run_pipeline()
    by_donor = {l.description: l for l in result.lines if l.source == "stripe"}
    assert by_donor["Christy Philips"].account_no == "I101210"  # Sunday Offertory
    assert by_donor["Alen Mathew"].account_no == "I101010"  # Pledges
    assert by_donor["Robin Koshy"].account_no == "I101725"  # General -> Restricted Gifts General
    # Registration donor comes from planning_center_person_name; fund 'VBS 2026'.
    assert by_donor["Kainey Varughese"].account_no == "I101416"  # VBS-Donation


def test_bank_keyword_categorization():
    result = run_pipeline()
    bank_lines = [l for l in result.lines if l.source == "bank"]
    by_desc = {}
    for l in bank_lines:
        for key in ("DIRECT ENERGY", "CitiTurf", "SAMS CLUB", "Diocese of North America", "TAQUERIA"):
            if key.lower() in l.bank_description.lower():
                by_desc[key] = l
    assert by_desc["DIRECT ENERGY"].account_no == "E141712"
    assert by_desc["CitiTurf"].account_no == "E221310"
    assert by_desc["SAMS CLUB"].account_no == "E151910"
    assert by_desc["Diocese of North America"].account_no == "E101710"
    # Unmatched line has no account and is flagged.
    assert by_desc["TAQUERIA"].account_no == ""
    assert by_desc["TAQUERIA"].matched is False
    # Description is left blank unless a matching rule sets its own friendly
    # name - never the raw ACH/CO NAME statement text (that lives in
    # bank_description). None of the seeded rules set one, so every line
    # here is blank; test_bank_keyword_rule_description_fills_description
    # covers the rule-provides-one case.
    assert all(l.description == "" for l in bank_lines)


def test_bank_keyword_rule_description_fills_description():
    # make_session() drop_all/create_all/reseeds fresh, but that only
    # happens on the NEXT call to it - this is the last test in this file,
    # so a rule left behind here would otherwise leak into whatever other
    # test file's shared (non-reset) DB runs next. Delete it again before
    # closing, so this test's DB footprint doesn't outlive the test.
    db = make_session()
    try:
        rule = CategoryRule(
            rule_type="bank_keyword",
            pattern="SAMS CLUB",
            account_no="E151910",
            description="Sams Club",
            priority=1,
        )
        db.add(rule)
        db.commit()
        bank = parse_bank_csv((FIXTURES / "sample_bank.csv").read_text())
        stripe = parse_stripe_csv((FIXTURES / "sample_stripe.csv").read_text())
        categorizer = Categorizer(
            list(db.scalars(select(CategoryRule)).all()),
            list(db.scalars(select(ChartOfAccount)).all()),
        )
        result = reconcile(bank, stripe, categorizer)
        sams_lines = [l for l in result.lines if "sams club" in l.bank_description.lower()]
        assert sams_lines
        assert all(l.description == "Sams Club" for l in sams_lines)
    finally:
        db.delete(rule)
        db.commit()
        db.close()
