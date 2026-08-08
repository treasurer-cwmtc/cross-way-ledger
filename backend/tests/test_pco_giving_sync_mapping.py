"""Unit tests for services/pco_giving_sync.py's mapping from raw PCO Giving
API JSON:API payloads to DonorRow/DonationRow - shapes below mirror real
/giving/v2/people and /giving/v2/donations responses (verified live against
the real account during implementation, not guessed). No network/DB
involved, mirrors test_stripe_sync.py's _balance_txn_to_row unit tests."""

from unittest.mock import patch

from app.services.pco_giving_sync import fetch_donations, fetch_donors


def _giving_person(person_id: str, **overrides) -> dict:
    attrs = {
        "addresses": [
            {"city": "Wylie", "state": "TX", "zip": "75098", "primary": True}
        ],
        "donor_number": None,
        "email_addresses": [{"address": "jane@example.com", "primary": True}],
        "first_donated_at": "2024-01-01T06:00:00Z",
        "first_name": "Jane",
        "last_name": "Doe",
        "phone_numbers": [{"number": "(214) 555-0001", "primary": True}],
    }
    attrs.update(overrides)
    return {"type": "Person", "id": person_id, "attributes": attrs, "relationships": {}}


def test_fetch_donors_maps_confirmed_live_shape():
    with patch("app.services.pco_giving_sync.paginate", return_value=[_giving_person("1")]):
        rows = fetch_donors()
    assert len(rows) == 1
    row = rows[0]
    assert row.donor_id == "1"
    assert row.first_name == "Jane"
    assert row.last_name == "Doe"
    assert row.email == "jane@example.com"
    assert row.phone_number == "(214) 555-0001"
    assert row.city == "Wylie"
    assert row.state == "TX"
    assert row.zip_code == "75098"
    assert row.first_donated.isoformat() == "2024-01-01"
    # Not on this endpoint - always overwritten by _recompute_donor_totals.
    assert row.donation_count == 0
    assert row.total_given == 0.0


def test_fetch_donors_falls_back_to_first_entry_when_none_flagged_primary():
    person = _giving_person(
        "2",
        email_addresses=[{"address": "only@example.com", "primary": False}],
        phone_numbers=[],
        addresses=[],
    )
    with patch("app.services.pco_giving_sync.paginate", return_value=[person]):
        rows = fetch_donors()
    assert rows[0].email == "only@example.com"
    assert rows[0].phone_number == ""
    assert rows[0].city == ""


def _donation_page(donation_attrs: dict, designations: list[dict], funds: list[dict], next_url=None) -> dict:
    return {
        "data": [
            {
                "type": "Donation",
                "id": "d1",
                "attributes": donation_attrs,
                "relationships": {
                    "person": {"data": {"type": "Person", "id": "1"}},
                    "designations": {
                        "data": [{"type": "Designation", "id": d["id"]} for d in designations]
                    },
                },
            }
        ],
        "included": designations + funds,
        "links": ({"next": next_url} if next_url else {}),
    }


def test_fetch_donations_single_fund_uses_confirmed_fee_sign_convention():
    # Real confirmed shape: fee_cents is already negative (a deduction) -
    # net = amount + fee_cents/100, NOT amount - fee_cents/100.
    donation_attrs = {
        "amount_cents": 5000,
        "fee_cents": -138,
        "received_at": "2024-03-10T17:47:20Z",
        "payment_method": "card",
    }
    designation = {
        "type": "Designation",
        "id": "des1",
        "attributes": {"amount_cents": 5000, "fee_cents": -138},
        "relationships": {"fund": {"data": {"type": "Fund", "id": "f1"}}},
    }
    fund = {"type": "Fund", "id": "f1", "attributes": {"name": "General Funds"}}
    page = _donation_page(donation_attrs, [designation], [fund])
    with patch("app.services.pco_giving_sync.pco_get", return_value=page):
        rows = fetch_donations(since_days=30)
    assert len(rows) == 1
    row = rows[0]
    assert row.dedup_key == "d1"
    assert row.donor_id == "1"
    assert row.fund == "General Funds"
    assert row.amount == 50.0
    assert row.net_amount == 48.62
    assert row.received_date.isoformat() == "2024-03-10"
    assert row.method == "card"


def test_fetch_donations_explodes_multi_fund_donation_and_sums_back_to_net():
    donation_attrs = {"amount_cents": 6000, "fee_cents": -100, "payment_method": "ach"}
    des1 = {
        "type": "Designation",
        "id": "des1",
        "attributes": {"amount_cents": 4000},
        "relationships": {"fund": {"data": {"type": "Fund", "id": "f1"}}},
    }
    des2 = {
        "type": "Designation",
        "id": "des2",
        "attributes": {"amount_cents": 2000},
        "relationships": {"fund": {"data": {"type": "Fund", "id": "f2"}}},
    }
    fund1 = {"type": "Fund", "id": "f1", "attributes": {"name": "Building Fund"}}
    fund2 = {"type": "Fund", "id": "f2", "attributes": {"name": "General Missions"}}
    page = _donation_page(donation_attrs, [des1, des2], [fund1, fund2])
    with patch("app.services.pco_giving_sync.pco_get", return_value=page):
        rows = fetch_donations(since_days=30)
    assert len(rows) == 2
    assert {r.dedup_key for r in rows} == {"d1-des1", "d1-des2"}
    by_fund = {r.fund: r for r in rows}
    assert by_fund["Building Fund"].amount == 40.0
    assert by_fund["General Missions"].amount == 20.0
    assert round(sum(r.net_amount for r in rows), 2) == 59.0  # 60.00 - 1.00 fee


def test_fetch_donations_paginates_via_links_next():
    page1 = _donation_page(
        {"amount_cents": 100, "fee_cents": 0, "payment_method": "cash"}, [], [], next_url="https://x/page2"
    )
    page2 = _donation_page({"amount_cents": 200, "fee_cents": 0, "payment_method": "cash"}, [], [])
    with patch("app.services.pco_giving_sync.pco_get", side_effect=[page1, page2]) as mock_get:
        rows = fetch_donations(since_days=30)
    assert len(rows) == 2
    assert mock_get.call_count == 2
    assert mock_get.call_args_list[1].args[0] == "https://x/page2"
