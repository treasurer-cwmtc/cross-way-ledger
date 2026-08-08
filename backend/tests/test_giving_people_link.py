"""Tests for the Giving<->People auto-link (run on every Donor sync) and its
manual-override endpoints: GET/PUT /api/pledge-campaigns/giving-people-links.
"""

from datetime import date
from unittest.mock import patch

from app.services.pledge_import import DonorRow
from app.services.reimbursements import PcoPersonRow
from test_auth import auth_header, client


def _donor_row(donor_id: str, first="Jane", last="Doe") -> DonorRow:
    return DonorRow(
        donor_id=donor_id,
        donor_number="",
        first_name=first,
        last_name=last,
        email=f"{first.lower()}@example.com",
        phone_number="",
        city="",
        state="",
        zip_code="",
        joint_giver_id="",
        joint_giver_first_name="",
        joint_giver_last_name="",
        first_donated=date(2024, 1, 1),
        donation_count=0,
        total_given=0.0,
    )


def _sync_people(person_ids: list[str]):
    h = auth_header()
    rows = [PcoPersonRow(person_id=pid, name=f"Person {pid}", email=f"p{pid}@example.com", phone_number="") for pid in person_ids]
    with patch("app.routers.reimbursements.pco_people_sync.fetch_people", return_value=rows):
        r = client.post("/api/reimbursements/pco-people/sync", headers=h)
    assert r.status_code == 200, r.text


def _sync_donors(rows: list[DonorRow]):
    h = auth_header()
    with patch("app.routers.pledge_campaigns.pco_giving_sync.fetch_donors", return_value=rows):
        r = client.post("/api/pledge-campaigns/donors/sync", headers=h)
    assert r.status_code == 200, r.text


def test_giving_people_links_requires_auth():
    assert client.get("/api/pledge-campaigns/giving-people-links").status_code == 401


def test_donor_id_matching_a_synced_person_id_auto_links():
    # Shared ID space (confirmed live - see pco_giving_sync.fetch_donors'
    # docstring): a donor whose donor_id equals a synced Person's person_id
    # should auto-link on sync.
    _sync_people(["7701"])
    _sync_donors([_donor_row("7701", "Priya", "Thomas")])

    h = auth_header()
    r = client.get("/api/pledge-campaigns/giving-people-links", headers=h)
    assert r.status_code == 200, r.text
    by_id = {row["donor_id"]: row for row in r.json()}
    assert by_id["7701"]["match_source"] == "auto"
    assert by_id["7701"]["person_id"] == "7701"


def test_donor_with_no_matching_person_is_unmatched():
    _sync_donors([_donor_row("7702", "Sam", "George")])
    h = auth_header()
    r = client.get("/api/pledge-campaigns/giving-people-links", headers=h)
    row = next(r2 for r2 in r.json() if r2["donor_id"] == "7702")
    assert row["match_source"] is None
    assert row["person_id"] is None


def test_manual_link_overrides_and_survives_resync():
    _sync_people(["7703", "7704"])
    _sync_donors([_donor_row("7702", "Sam", "George")])  # still unmatched by ID

    h = auth_header()
    r = client.put(
        "/api/pledge-campaigns/giving-people-links/7702", headers=h, json={"person_id": "7703"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["match_source"] == "manual"
    assert r.json()["person_id"] == "7703"

    # Re-syncing donors must not clobber the manual pick, even though 7702
    # still doesn't equal any person_id by coincidence.
    _sync_donors([_donor_row("7702", "Sam", "George")])
    r = client.get("/api/pledge-campaigns/giving-people-links", headers=h)
    row = next(r2 for r2 in r.json() if r2["donor_id"] == "7702")
    assert row["match_source"] == "manual"
    assert row["person_id"] == "7703"


def test_clearing_manual_link_returns_to_unmatched():
    h = auth_header()
    r = client.put(
        "/api/pledge-campaigns/giving-people-links/7702", headers=h, json={"person_id": None}
    )
    assert r.status_code == 200, r.text
    assert r.json()["match_source"] is None
    assert r.json()["person_id"] is None


def test_manual_link_rejects_unknown_person():
    h = auth_header()
    r = client.put(
        "/api/pledge-campaigns/giving-people-links/7702", headers=h, json={"person_id": "nope"}
    )
    assert r.status_code == 400, r.text


def test_manual_link_rejects_unknown_donor():
    h = auth_header()
    r = client.put(
        "/api/pledge-campaigns/giving-people-links/no-such-donor",
        headers=h,
        json={"person_id": "7703"},
    )
    assert r.status_code == 404, r.text
