"""Tests for the live Pledge Form sync: GET /pco-forms, GET /pco-forms/{id}
/fields, GET/PUT /{campaign_id}/pledge-form-mapping, POST /{campaign_id}
/pledges/sync, and the secret-gated POST /pledges/scheduled-sync - mirrors
test_pco_people_sync.py's shape (mocked PCO responses, no real network
calls)."""

from datetime import datetime, timezone
from unittest.mock import patch

from app.services.pco_form_sync import FormSubmissionRow
from app.services.reimbursements import PcoPersonRow
from test_auth import auth_header, client


def _create_campaign(name: str) -> dict:
    h = auth_header()
    r = client.post(
        "/api/pledge-campaigns", headers=h, json={"name": name, "goal_amount": 1000.0}
    )
    assert r.status_code == 201, r.text
    return r.json()


def _sync_people(rows: list[PcoPersonRow]):
    h = auth_header()
    with patch("app.routers.reimbursements.pco_people_sync.fetch_active_people", return_value=rows):
        r = client.post("/api/reimbursements/pco-people/sync", headers=h)
    assert r.status_code == 200, r.text


def _fake_forms() -> list[dict]:
    return [{"id": "1109730", "name": "Building Project Voluntary Pledge Form", "active": True}]


def _fake_fields() -> list[dict]:
    return [
        {"id": "f-heading", "label": "Pledge Details", "field_type": "heading"},
        {"id": "f-amount", "label": "Initial Pledge Amount", "field_type": "number"},
        {"id": "f-due", "label": "To be paid by", "field_type": "date"},
        {"id": "f-monthly", "label": "Monthly Pledge", "field_type": "number"},
        {"id": "f-contact", "label": "Method of Contact", "field_type": "checkboxes"},
    ]


def _fake_submission_rows() -> list[FormSubmissionRow]:
    return [
        FormSubmissionRow(
            submission_id="sub-1",
            person_id="8801",
            date_submitted=datetime(2027, 11, 15, 18, 22, 1, tzinfo=timezone.utc),
            initial_amount=600.0,
            due_date=None,
            monthly_amount=50.0,
            contact_method="Email, Phone",
        )
    ]


def test_pco_forms_endpoints_require_auth():
    assert client.get("/api/pledge-campaigns/pco-forms").status_code == 401
    assert client.get("/api/pledge-campaigns/pco-forms/1109730/fields").status_code == 401


def test_list_pco_forms_and_fields_excludes_headings():
    h = auth_header()
    with patch("app.routers.pledge_campaigns.pco_form_sync.fetch_available_forms", return_value=_fake_forms()):
        r = client.get("/api/pledge-campaigns/pco-forms", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()[0]["id"] == "1109730"

    with patch("app.routers.pledge_campaigns.pco_form_sync.fetch_form_fields", return_value=_fake_fields()[1:]):
        r = client.get("/api/pledge-campaigns/pco-forms/1109730/fields", headers=h)
    assert r.status_code == 200, r.text
    field_ids = {f["id"] for f in r.json()}
    assert "f-heading" not in field_ids
    assert {"f-amount", "f-due", "f-monthly", "f-contact"} <= field_ids


def test_save_mapping_sets_campaign_form_id():
    campaign = _create_campaign("Form Sync Campaign")
    h = auth_header()

    r = client.get(f"/api/pledge-campaigns/{campaign['id']}/pledge-form-mapping", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["campaign_id"] == campaign["id"]
    assert r.json()["initial_amount_field_id"] == ""

    r = client.put(
        f"/api/pledge-campaigns/{campaign['id']}/pledge-form-mapping",
        headers=h,
        json={
            "form_id": "1109730",
            "initial_amount_field_id": "f-amount",
            "due_date_field_id": "f-due",
            "monthly_amount_field_id": "f-monthly",
            "contact_method_field_id": "f-contact",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["initial_amount_field_id"] == "f-amount"

    campaigns = {c["id"]: c for c in client.get("/api/pledge-campaigns", headers=h).json()}
    assert campaigns[campaign["id"]]["pco_form_id"] == "1109730"


def test_sync_now_rejects_a_campaign_with_no_form_configured():
    campaign = _create_campaign("No Form Campaign")
    h = auth_header()
    r = client.post(f"/api/pledge-campaigns/{campaign['id']}/pledges/sync", headers=h)
    assert r.status_code == 400, r.text


def test_sync_now_resolves_identity_from_synced_person_and_upserts_pledge():
    _sync_people([PcoPersonRow(person_id="8801", name="Priya Thomas", email="priya@example.com", phone_number="")])
    campaign = _create_campaign("Synced Form Campaign")
    h = auth_header()
    client.put(
        f"/api/pledge-campaigns/{campaign['id']}/pledge-form-mapping",
        headers=h,
        json={
            "form_id": "1109730",
            "initial_amount_field_id": "f-amount",
            "due_date_field_id": "f-due",
            "monthly_amount_field_id": "f-monthly",
            "contact_method_field_id": "f-contact",
        },
    )

    with patch(
        "app.routers.pledge_campaigns.pco_form_sync.fetch_form_submissions",
        return_value=_fake_submission_rows(),
    ):
        r = client.post(f"/api/pledge-campaigns/{campaign['id']}/pledges/sync", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["pledges_imported"] == 1

    details = client.get(f"/api/pledge-campaigns/{campaign['id']}/details", headers=h).json()
    pledge_rows = [d for d in details if d["key"].startswith("pledge:")]
    assert len(pledge_rows) == 1
    assert pledge_rows[0]["first_name"] == "Priya"
    assert pledge_rows[0]["last_name"] == "Thomas"

    # Re-syncing the same submission_id upserts rather than duplicating.
    with patch(
        "app.routers.pledge_campaigns.pco_form_sync.fetch_form_submissions",
        return_value=_fake_submission_rows(),
    ):
        r = client.post(f"/api/pledge-campaigns/{campaign['id']}/pledges/sync", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["pledges_imported"] == 1
    details = client.get(f"/api/pledge-campaigns/{campaign['id']}/details", headers=h).json()
    assert len([d for d in details if d["key"].startswith("pledge:")]) == 1


def test_scheduled_sync_rejects_missing_or_wrong_secret():
    assert client.post("/api/pledge-campaigns/pledges/scheduled-sync").status_code == 403
    assert (
        client.post(
            "/api/pledge-campaigns/pledges/scheduled-sync", headers={"X-Sync-Secret": "wrong"}
        ).status_code
        == 403
    )
