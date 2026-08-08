"""Tests for the optional PCO List-based Reimbursement portal login gate:
GET/PUT /api/reimbursements/reimbursement-gate-list, GET /pco-lists, and the
additive gate check in services.reimbursements.is_allowed_reimbursement_submitter
(used by both request_otp and deps.get_current_submitter)."""

from unittest.mock import patch

from app.services.reimbursements import PcoPersonRow
from test_auth import auth_header, client

PERSON_A = PcoPersonRow(person_id="9101", name="Ada A", email="ada@example.com", phone_number="")
PERSON_B = PcoPersonRow(person_id="9102", name="Bea B", email="bea@example.com", phone_number="")


def _sync_people():
    h = auth_header()
    with patch(
        "app.routers.reimbursements.pco_people_sync.fetch_people",
        return_value=[PERSON_A, PERSON_B],
    ):
        r = client.post("/api/reimbursements/pco-people/sync", headers=h)
    assert r.status_code == 200, r.text


def _login(email: str) -> str:
    with patch("app.routers.reimbursements.send_email") as mock_send:
        r = client.post("/api/reimbursements/request-otp", json={"email": email})
        assert r.status_code == 200, r.text
        assert mock_send.called, "expected a code to be emailed for an allowed person"
        body = mock_send.call_args.args[2]
    code = "".join(ch for ch in body.split("code is:")[1].split("\n")[0] if ch.isdigit())
    r = client.post("/api/reimbursements/verify-otp", json={"email": email, "code": code})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def test_pco_lists_requires_auth():
    assert client.get("/api/reimbursements/pco-lists").status_code == 401


def test_gate_list_defaults_to_unset():
    h = auth_header()
    r = client.get("/api/reimbursements/reimbursement-gate-list", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["list_id"] is None
    assert body["member_count"] == 0


def test_no_gate_list_configured_any_active_person_can_request_otp():
    _sync_people()
    h = auth_header()
    with patch("app.routers.reimbursements.send_email") as mock_send:
        r = client.post("/api/reimbursements/request-otp", json={"email": "ada@example.com"})
        assert r.status_code == 200, r.text
        assert mock_send.called
    # Clean up so later tests in this file start from "no gate configured".
    client.put(
        "/api/reimbursements/reimbursement-gate-list", headers=h, json={"list_id": None}
    )


def test_set_gate_list_syncs_membership():
    h = auth_header()
    with patch(
        "app.routers.reimbursements.pco_people_sync.fetch_list_options",
        return_value=[{"id": "list1", "name": "Approved Submitters"}],
    ), patch(
        "app.routers.reimbursements.pco_people_sync.fetch_list_member_ids",
        return_value={"9101"},
    ):
        r = client.put(
            "/api/reimbursements/reimbursement-gate-list", headers=h, json={"list_id": "list1"}
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["list_id"] == "list1"
    assert body["list_name"] == "Approved Submitters"
    assert body["member_count"] == 1  # only person 9101 (ada), not 9102 (bea)


def test_otp_request_blocked_for_person_not_in_gate_list():
    # Gate list still set to list1={"9101"} from the previous test - bea
    # (9102) is a real active PcoPerson but not on the gate list.
    with patch("app.routers.reimbursements.send_email") as mock_send:
        r = client.post("/api/reimbursements/request-otp", json={"email": "bea@example.com"})
        assert r.status_code == 200, r.text  # always 200 - no enumeration oracle
        assert not mock_send.called, "bea is not on the gate list - no code should be emailed"


def test_otp_request_allowed_for_person_in_gate_list():
    with patch("app.routers.reimbursements.send_email") as mock_send:
        r = client.post("/api/reimbursements/request-otp", json={"email": "ada@example.com"})
        assert r.status_code == 200, r.text
        assert mock_send.called


def test_get_current_submitter_revoked_immediately_when_removed_from_gate_list():
    """A submitter who already has a valid JWT loses portal access the
    moment they're synced out of the configured gate list - deps.
    get_current_submitter re-checks on every request, never trusts the
    token alone (mirrors the equivalent PcoPerson-removal behavior)."""
    token = _login("ada@example.com")
    h = {"Authorization": f"Bearer {token}"}
    r = client.get("/api/reimbursements/my/coas", headers=h)
    assert r.status_code == 200, r.text

    admin_h = auth_header()
    with patch(
        "app.routers.reimbursements.pco_people_sync.fetch_people",
        return_value=[PERSON_A, PERSON_B],
    ), patch(
        "app.routers.reimbursements.pco_people_sync.fetch_list_member_ids",
        return_value=set(),  # ada no longer on the list
    ):
        r = client.post("/api/reimbursements/pco-people/sync", headers=admin_h)
    assert r.status_code == 200, r.text

    r = client.get("/api/reimbursements/my/coas", headers=h)
    assert r.status_code == 401, r.text

    # Clear the gate so later test files (which assume "any active person
    # can log in") aren't affected by state left over from this file.
    client.put(
        "/api/reimbursements/reimbursement-gate-list", headers=admin_h, json={"list_id": None}
    )
