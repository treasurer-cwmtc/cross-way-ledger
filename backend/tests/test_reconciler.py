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
from app.services.parsers import (
    BankRow,
    StripeRow,
    extract_fund_donor,
    parse_bank_csv,
    parse_fund_breakdown,
    parse_stripe_csv,
)
from app.services.reconciler import is_review_hint_note, merge_stripe, reconcile

from _db_safety import assert_safe_test_database

FIXTURES = Path(__file__).parent


def make_session():
    # Real Postgres, same as every real environment - no SQLite fallback.
    # See docs/DEPLOYMENT.md for how to point this at a throwaway instance.
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL must be set to a real Postgres instance to run tests.")
    assert_safe_test_database(database_url)
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


def test_parse_fund_breakdown_returns_every_designated_fund():
    # Real shape of Planning Center's `planning_center_context` metadata for
    # a gift split across three funds (see issue #124).
    context = (
        '[{"name":"Building Fund","cents":400000},'
        '{"name":"General Missions","cents":50000},'
        '{"name":"Sunday School","cents":50000}]'
    )
    assert parse_fund_breakdown(context) == [
        ("Building Fund", 4000.0),
        ("General Missions", 500.0),
        ("Sunday School", 500.0),
    ]


def test_parse_fund_breakdown_handles_missing_or_malformed_json():
    assert parse_fund_breakdown("") == []
    assert parse_fund_breakdown("not json") == []
    assert parse_fund_breakdown('{"not": "a list"}') == []


def test_extract_fund_donor_split_gift_uses_clean_joined_name_not_garbled_regex_match():
    # Before issue #124's fix, the regex swallowed this whole tail into one
    # garbled "fund" string ("Building Fund ($4,000.00) General Missions
    # ($500.00) Sunday School") since it only expects a single fund/amount.
    description = (
        "Donation #382021408 - Jane Doe - Building Fund ($4,000.00) "
        "General Missions ($500.00) Sunday School"
    )
    context = (
        '[{"name":"Building Fund","cents":400000},'
        '{"name":"General Missions","cents":50000},'
        '{"name":"Sunday School","cents":50000}]'
    )
    fund, donor = extract_fund_donor(description, context, "")
    assert fund == "Building Fund, General Missions, Sunday School"
    assert donor == "Jane Doe"


def test_extract_fund_donor_single_fund_unaffected_by_breakdown_change():
    # A single-fund donation must categorize identically to before - the
    # breakdown override in extract_fund_donor only kicks in for len > 1.
    fund, donor = extract_fund_donor(
        "Donation #382021408 - Christy Philips - Sunday Offertory ($40.30)",
        '[{"name":"Sunday Offertory","cents":4030}]',
        "",
    )
    assert fund == "Sunday Offertory"
    assert donor == "Christy Philips"


def test_split_fund_donation_posts_to_each_funds_own_account():
    # Confirms the actual accounting fix, not just the display fix: a gift
    # split across two funds must produce two separate reconciled lines,
    # each posted to its own fund's account with its own proportional
    # share of the net amount - not the entire amount landing on whichever
    # fund happened to match first (the real mis-posting risk in #124).
    db = make_session()
    try:
        categorizer = Categorizer(
            list(db.scalars(select(CategoryRule)).all()),
            list(db.scalars(select(ChartOfAccount)).all()),
        )
        payout = StripeRow(
            id="txn_payout_split",
            type="payout",
            source="po_split1",
            amount=-49.50,
            fee=0.0,
            net=-49.50,
            created="6/1/2026",
            description="STRIPE PAYOUT",
            transfer="po_split1",
            transfer_date="6/1/2026",
            fund="",
            donor="",
        )
        donation = StripeRow(
            id="txn_donation_split",
            type="payment",
            source="py_split1",
            amount=50.0,
            fee=0.5,
            net=49.5,
            created="5/30/2026",
            description=(
                "Donation #1 - Jane Doe - Pledges ($30.00) Sunday Offertory ($20.00)"
            ),
            transfer="po_split1",
            transfer_date="6/1/2026",
            fund="Pledges, Sunday Offertory",
            donor="Jane Doe",
            fund_breakdown=[("Pledges", 30.0), ("Sunday Offertory", 20.0)],
        )
        bank_row = BankRow(
            details="",
            posting_date="6/1/2026",
            description="STRIPE TRANSFER",
            amount=49.50,
            type="ACH_CREDIT",
        )
        result = merge_stripe([bank_row], [payout, donation], categorizer)
        stripe_lines = [l for l in result.lines if l.source == "stripe"]
        assert len(stripe_lines) == 2  # no adjustment line - the split sums exactly
        by_account = {l.account_no: l for l in stripe_lines}
        assert by_account["I101010"].amount == 29.7  # Pledges - 60% share of net
        assert by_account["I101210"].amount == 19.8  # Sunday Offertory - remainder
        assert round(sum(l.amount for l in stripe_lines), 2) == 49.5
        assert "Split gift" in by_account["I101010"].notes
        assert "Split gift" in by_account["I101210"].notes
    finally:
        db.close()


def test_is_review_hint_note_recognizes_every_generated_wizard_hint():
    # Every "go fix this" note reconciler.py actually generates must be
    # recognized, or it'll leak into the permanent ledger on import - see
    # the "Uncategorized - add a rule" note that used to survive import.
    assert is_review_hint_note("No Stripe payout matched this bank amount.")
    assert is_review_hint_note("No fund rule for 'Building Fund'")
    assert is_review_hint_note(
        "No fund rule for 'Building Fund' (split gift 1 of 2)"
    )
    assert is_review_hint_note("Payout po_abc123 had no linked donations.")
    assert not is_review_hint_note("")
    # Purely descriptive notes (not "go fix this") are kept, not stripped.
    assert not is_review_hint_note(
        "Bank payout minus sum of donation net amounts (fees / timing)."
    )
    assert not is_review_hint_note("Split gift (1 of 2): 'Building Fund'")
    assert not is_review_hint_note("A real note the treasurer typed.")


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
