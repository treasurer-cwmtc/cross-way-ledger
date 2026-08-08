"""Tests for the PcoPerson.status column: the People sync now pulls every
status (not just active - see services/pco_people_sync.py), and the
Reimbursement portal's login gate enforces status="active" explicitly (see
services.reimbursements.is_allowed_reimbursement_submitter) rather than
relying on the sync to only ever import active people."""

from unittest.mock import patch

from app.services.reimbursements import PcoPersonRow
from test_auth import auth_header, client

ACTIVE_PERSON = PcoPersonRow(
    person_id="9201", name="Active Ann", email="ann@example.com", phone_number="", status="active"
)
INACTIVE_PERSON = PcoPersonRow(
    person_id="9202", name="Inactive Ian", email="ian@example.com", phone_number="", status="inactive"
)


def _sync_people():
    h = auth_header()
    with patch(
        "app.routers.reimbursements.pco_people_sync.fetch_people",
        return_value=[ACTIVE_PERSON, INACTIVE_PERSON],
    ):
        r = client.post("/api/pco/people/sync", headers=h)
    assert r.status_code == 200, r.text


def test_sync_pulls_every_status_and_exposes_it():
    _sync_people()
    h = auth_header()
    r = client.get("/api/pco/people", headers=h)
    assert r.status_code == 200, r.text
    by_id = {p["person_id"]: p for p in r.json()}
    assert by_id["9201"]["status"] == "active"
    assert by_id["9202"]["status"] == "inactive"


def test_otp_request_blocked_for_inactive_person():
    _sync_people()
    with patch("app.routers.reimbursements.send_email") as mock_send:
        r = client.post("/api/reimbursements/request-otp", json={"email": "ian@example.com"})
        assert r.status_code == 200, r.text  # always 200 - no enumeration oracle
        assert not mock_send.called, "an inactive person's row existing shouldn't grant portal access"


def test_otp_request_allowed_for_active_person():
    _sync_people()
    with patch("app.routers.reimbursements.send_email") as mock_send:
        r = client.post("/api/reimbursements/request-otp", json={"email": "ann@example.com"})
        assert r.status_code == 200, r.text
        assert mock_send.called
