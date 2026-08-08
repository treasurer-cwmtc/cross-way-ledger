"""Unit tests for services/pco_people_sync.py's mapping from raw PCO People
API JSON:API payloads to PcoPersonRow - no network/DB involved, mirrors
test_stripe_sync.py's _balance_txn_to_row unit tests."""

from unittest.mock import patch

from app.services.pco_people_sync import fetch_people


def _person(
    person_id: str, name: str, email_ids: list[str], phone_ids: list[str], status: str = "active"
) -> dict:
    return {
        "type": "Person",
        "id": person_id,
        "attributes": {"name": name, "status": status},
        "relationships": {
            "emails": {"data": [{"type": "Email", "id": e} for e in email_ids]},
            "phone_numbers": {"data": [{"type": "PhoneNumber", "id": p} for p in phone_ids]},
        },
    }


def test_fetch_people_picks_primary_email_and_first_phone():
    person = _person("1", "Jane Doe", ["e1", "e2"], ["p1"])
    included_by_id = {
        "Email:e1": {"attributes": {"address": "old@example.com", "primary": False}},
        "Email:e2": {"attributes": {"address": "jane@example.com", "primary": True}},
        "PhoneNumber:p1": {"attributes": {"number": "(214) 555-0001"}},
    }
    with patch(
        "app.services.pco_people_sync.paginate_with_included",
        return_value=[(person, included_by_id)],
    ):
        rows = fetch_people()
    assert len(rows) == 1
    assert rows[0].person_id == "1"
    assert rows[0].name == "Jane Doe"
    assert rows[0].email == "jane@example.com"
    assert rows[0].phone_number == "(214) 555-0001"
    assert rows[0].status == "active"


def test_fetch_people_falls_back_when_no_email_flagged_primary():
    person = _person("2", "No Primary Flag", ["e1"], [])
    included_by_id = {
        "Email:e1": {"attributes": {"address": "only@example.com", "primary": False}},
    }
    with patch(
        "app.services.pco_people_sync.paginate_with_included",
        return_value=[(person, included_by_id)],
    ):
        rows = fetch_people()
    assert rows[0].email == "only@example.com"
    assert rows[0].phone_number == ""


def test_fetch_people_handles_no_contact_info_at_all():
    person = _person("3", "No Contacts", [], [])
    with patch(
        "app.services.pco_people_sync.paginate_with_included", return_value=[(person, {})]
    ):
        rows = fetch_people()
    assert rows[0].email == ""
    assert rows[0].phone_number == ""


def test_fetch_people_requests_no_status_filter():
    """Pulls every person regardless of status - see module docstring; the
    Reimbursement portal's active-only gate is enforced separately (see
    services.reimbursements.is_allowed_reimbursement_submitter), not by
    filtering the sync itself."""
    with patch(
        "app.services.pco_people_sync.paginate_with_included", return_value=[]
    ) as mock_paginate:
        fetch_people()
    args, kwargs = mock_paginate.call_args
    assert args[0] == "/people/v2/people"
    assert "where[status]" not in kwargs["params"]
    assert "emails" in kwargs["params"]["include"]
    assert "phone_numbers" in kwargs["params"]["include"]


def test_fetch_people_maps_inactive_status():
    person = _person("4", "Former Member", [], [], status="inactive")
    with patch(
        "app.services.pco_people_sync.paginate_with_included", return_value=[(person, {})]
    ):
        rows = fetch_people()
    assert rows[0].status == "inactive"
