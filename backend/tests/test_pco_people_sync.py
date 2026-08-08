"""Tests for the automated PCO People sync: the on-demand/scheduled
endpoints that pull pco_people_people from the Planning Center People API
(mocked here) instead of a CSV upload - mirrors test_stripe_sync.py's shape.
"""

from unittest.mock import patch

from app.services.reimbursements import PcoPersonRow
from test_auth import auth_header, client  # reuse shared TestClient/app setup


def _fake_rows() -> list[PcoPersonRow]:
    return [
        PcoPersonRow(person_id="9001", name="Priya Thomas", email="priya@example.com", phone_number="(214) 555-9001"),
        PcoPersonRow(person_id="9002", name="Sam George", email="sam@example.com", phone_number="(214) 555-9002"),
    ]


def test_sync_now_requires_auth():
    assert client.post("/api/reimbursements/pco-people/sync").status_code == 401


def test_scheduled_sync_rejects_missing_or_wrong_secret():
    assert client.post("/api/reimbursements/pco-people/scheduled-sync").status_code == 403
    assert (
        client.post(
            "/api/reimbursements/pco-people/scheduled-sync", headers={"X-Sync-Secret": "wrong"}
        ).status_code
        == 403
    )


def test_sync_now_upserts_and_updates_last_synced():
    h = auth_header()
    with patch("app.routers.reimbursements.pco_people_sync.fetch_active_people", return_value=_fake_rows()):
        r = client.post("/api/reimbursements/pco-people/sync", headers=h)
    assert r.status_code == 200, r.text
    result = r.json()
    assert result["people_imported"] == 2
    assert result["last_synced_at"]

    r = client.get("/api/reimbursements/pco-people/last-synced", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["last_synced_at"] == result["last_synced_at"]

    r = client.get("/api/reimbursements/pco-people", headers=h)
    assert r.status_code == 200, r.text
    emails = {p["email"] for p in r.json()}
    assert {"priya@example.com", "sam@example.com"} <= emails

    # A repeat sync with the same rows upserts (updates) rather than
    # duplicating - same person_id key, whether the row came from the API
    # or a CSV upload (see test_api_and_csv_paths_share_the_same_upsert).
    with patch("app.routers.reimbursements.pco_people_sync.fetch_active_people", return_value=_fake_rows()):
        r = client.post("/api/reimbursements/pco-people/sync", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["people_imported"] == 2
    r = client.get("/api/reimbursements/pco-people", headers=h)
    assert len(r.json()) == 2


def test_sync_now_surfaces_missing_credentials_as_400():
    h = auth_header()
    from app.services.pco_client import PcoNotConfiguredError

    with patch(
        "app.routers.reimbursements.pco_people_sync.fetch_active_people",
        side_effect=PcoNotConfiguredError("Planning Center API credentials are not configured."),
    ):
        r = client.post("/api/reimbursements/pco-people/sync", headers=h)
    assert r.status_code == 400, r.text


def test_api_and_csv_paths_share_the_same_upsert():
    """The live sync and the manual CSV import must be interchangeable -
    syncing a person via the API, then re-importing the same person_id via
    CSV with updated details, must update the same row rather than creating
    a duplicate (and vice versa)."""
    h = auth_header()
    with patch("app.routers.reimbursements.pco_people_sync.fetch_active_people", return_value=_fake_rows()):
        client.post("/api/reimbursements/pco-people/sync", headers=h)

    csv_text = "Person ID,Name,Primary Email,Primary Phone Number\n9001,Priya T. Thomas,priya@example.com,(214) 555-0000\n"
    files = {"people_file": ("people.csv", csv_text.encode(), "text/csv")}
    r = client.post("/api/reimbursements/pco-people/import", headers=h, files=files)
    assert r.status_code == 200, r.text

    r = client.get("/api/reimbursements/pco-people", headers=h)
    by_id = {p["person_id"]: p for p in r.json()}
    assert len(by_id) == 2  # still 2, not 3 - the CSV row updated 9001 in place
    assert by_id["9001"]["name"] == "Priya T. Thomas"
    assert by_id["9001"]["phone_number"] == "(214) 555-0000"
