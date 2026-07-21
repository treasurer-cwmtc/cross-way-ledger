"""Pledge Campaigns module: campaign CRUD, the 3-step CSV import (donations,
pledges, donors), donor matching, the dashboard timeline, donor-name
redaction (hide_donor_names), and the delete-fund action. No tests existed
for this module before - it shipped with the Phase 2 merge but zero backend
coverage."""

import io

from test_auth import auth_header, client


DONATIONS_CSV = """id,donor_id,received_date,fund,amount,net_amount,payment_method
d1,DON1,2026-01-05,Building Fund,100.00,99.50,ach
d2,DON1,2026-02-10,Building Fund,200.00,199.00,ach
d3,DON2,2026-01-20,Building Fund,50.00,50.00,check
d4,DON3,2026-01-15,Other Fund,25.00,25.00,check
"""

PLEDGES_CSV = """Submission ID,First Name,Last Name,Email,Date Submitted,Initial Pledge,To be paid by:,Monthly Pledge,Method of Contact
sub1,Jane,Doe,jane@example.com,2026-01-01,1000.00,2026-12-31,50.00,Email
sub2,John,Smith,john@example.com,2026-01-02,500.00,2026-12-31,0.00,Phone
"""

DONORS_CSV = (
    "donor_id,donor_number,donor_first_name,donor_last_name,donor_email,"
    "donor_phone_number,donor_city,donor_state,donor_zip,joint_giver_id,"
    "joint_giver_first_name,joint_giver_last_name,first_donated,donation_count,total\n"
    "DON1,1001,Jane,Doe,jane@example.com,555-1111,Plano,TX,75023,,,,2026-01-05,2,298.50\n"
    "DON2,1002,John,Smith,john@example.com,555-2222,Frisco,TX,75034,,,,2026-01-20,1,50.00\n"
)


def _upload(path: str, filename: str, content: str, field: str, extra: dict | None = None):
    h = auth_header()
    files = {field: (filename, io.BytesIO(content.encode()), "text/csv")}
    return client.post(path, headers=h, files=files, data=extra or {})


def _create_campaign(name="Test Campaign", goal=1000.0, starting=0.0) -> dict:
    h = auth_header()
    r = client.post(
        "/api/pledge-campaigns",
        headers=h,
        json={"name": name, "goal_amount": goal, "starting_balance": starting},
    )
    assert r.status_code == 201, r.text
    return r.json()


def _import_donations():
    r = _upload("/api/donations/import", "donations.csv", DONATIONS_CSV, "donation_file")
    assert r.status_code == 200, r.text
    return r.json()


def _import_pledges(campaign_id: int, fund_name: str = "Building Fund"):
    r = _upload(
        f"/api/pledge-campaigns/{campaign_id}/import/pledges",
        "pledges.csv",
        PLEDGES_CSV,
        "pledge_file",
        {"fund_name": fund_name},
    )
    assert r.status_code == 200, r.text
    return r.json()


def _import_donors(campaign_id: int):
    r = _upload(
        f"/api/pledge-campaigns/{campaign_id}/import/donors", "donors.csv", DONORS_CSV, "donor_file"
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_create_campaign_and_list():
    campaign = _create_campaign(name="Campaign A")
    h = auth_header()
    campaigns = client.get("/api/pledge-campaigns", headers=h).json()
    assert any(c["id"] == campaign["id"] for c in campaigns)


def test_duplicate_campaign_name_rejected():
    _create_campaign(name="Dup Campaign")
    h = auth_header()
    r = client.post(
        "/api/pledge-campaigns", headers=h, json={"name": "Dup Campaign", "goal_amount": 1.0}
    )
    assert r.status_code == 409


def test_donations_import_and_fund_summary():
    result = _import_donations()
    funds = {f["name"]: f for f in result["funds"]}
    assert "Building Fund" in funds
    assert funds["Building Fund"]["count"] == 3
    assert round(funds["Building Fund"]["total"], 2) == 348.50

    # Re-running the same file is a no-op (deduped by the source id).
    result2 = _import_donations()
    assert result2["donations_imported"] == 0


def test_pledge_import_donor_match_and_dashboard():
    _import_donations()
    campaign = _create_campaign(name="Full Flow Campaign", goal=2000.0, starting=100.0)
    pledge_result = _import_pledges(campaign["id"])
    assert pledge_result["pledges_matched"] == 0  # no donors imported yet
    assert pledge_result["pledges_unmatched"] == 2
    assert len(pledge_result["new_pledges"]) == 2
    assert len(pledge_result["updated_pledges"]) == 0

    donor_result = _import_donors(campaign["id"])
    assert donor_result["pledges_matched"] == 2  # both emails now resolve

    h = auth_header()
    pledges = client.get(f"/api/pledge-campaigns/{campaign['id']}/pledges", headers=h).json()
    jane = next(p for p in pledges if p["email"] == "jane@example.com")
    assert jane["donor_id"] == "DON1"
    assert jane["match_source"] == "auto"
    assert round(jane["actual_amount"], 2) == 298.50  # d1 + d2, this fund only

    dashboard = client.get(f"/api/pledge-campaigns/{campaign['id']}/dashboard", headers=h).json()
    assert dashboard["pledge_count"] == 2
    assert dashboard["donation_count"] == 3  # only Building Fund donations
    assert round(dashboard["total_pledged"], 2) == 1500.00
    assert round(dashboard["total_actual"], 2) == 348.50
    # total_raised includes starting_balance, but the timeline must not.
    assert round(dashboard["total_raised"], 2) == 448.50
    final_point = dashboard["timeline"][-1]
    assert round(final_point["running_total"], 2) == 348.50


def test_dashboard_timeline_has_per_day_pledge_and_actual_amounts():
    _import_donations()
    campaign = _create_campaign(name="Timeline Campaign", goal=1000.0, starting=500.0)
    _import_pledges(campaign["id"])

    h = auth_header()
    dashboard = client.get(f"/api/pledge-campaigns/{campaign['id']}/dashboard", headers=h).json()
    timeline = dashboard["timeline"]
    # Pledge submission dates (2026-01-01, 2026-01-02) show up even though
    # they aren't donation dates - "more dates on the x axis."
    by_date = {p["date"]: p for p in timeline}
    assert "2026-01-01" in by_date
    assert round(by_date["2026-01-01"]["pledged_amount"], 2) == 1000.00
    assert by_date["2026-01-01"]["actual_amount"] == 0.0
    # No point's running_total should ever include the 500 starting balance.
    assert all(p["running_total"] <= 348.50 + 0.01 for p in timeline)


def test_manual_match_and_pledge_detail_popup():
    _import_donations()
    campaign = _create_campaign(name="Manual Match Campaign")
    # A unique email with no matching donor anywhere in the shared test DB,
    # so this pledge is guaranteed to start unmatched regardless of what
    # other tests have already imported into the shared Donor table.
    unique_csv = (
        "Submission ID,First Name,Last Name,Email,Date Submitted,Initial Pledge,"
        "To be paid by:,Monthly Pledge,Method of Contact\n"
        "manual-sub,No,Match,no-match-yet@example.com,2026-01-03,750.00,2026-12-31,0.00,Email\n"
    )
    r = _upload(
        f"/api/pledge-campaigns/{campaign['id']}/import/pledges",
        "pledges.csv",
        unique_csv,
        "pledge_file",
        {"fund_name": "Building Fund"},
    )
    assert r.status_code == 200, r.text

    h = auth_header()
    pledges = client.get(f"/api/pledge-campaigns/{campaign['id']}/pledges", headers=h).json()
    unmatched = next(p for p in pledges if p["email"] == "no-match-yet@example.com")
    assert unmatched["donor_id"] is None

    r = client.put(
        f"/api/pledge-campaigns/{campaign['id']}/pledges/{unmatched['id']}/match",
        headers=h,
        json={"donor_id": "DON1"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["match_source"] == "manual"
    assert round(r.json()["actual_amount"], 2) == 298.50

    detail = client.get(
        f"/api/pledge-campaigns/{campaign['id']}/pledges/{unmatched['id']}", headers=h
    ).json()
    assert detail["pledge"]["donor_id"] == "DON1"
    assert len(detail["gifts"]) == 2
    assert round(sum(g["net_amount"] for g in detail["gifts"]), 2) == 298.50


def test_donor_name_redacted_when_hide_donor_names_set():
    _import_donations()
    campaign = _create_campaign(name="Redaction Campaign")
    _import_pledges(campaign["id"])
    _import_donors(campaign["id"])

    h = auth_header()
    # Turn on hide_donor_names for the admin test account, then confirm
    # names/emails are blanked out but everything else (donor_id, amounts,
    # match status) still shows.
    me = client.get("/api/auth/me", headers=h).json()
    r = client.put(
        f"/api/auth/users/{me['id']}/permissions",
        headers=h,
        json={"permissions": [], "is_admin": True, "hide_donor_names": True},
    )
    assert r.status_code == 200, r.text
    assert r.json()["hide_donor_names"] is True

    pledges = client.get(f"/api/pledge-campaigns/{campaign['id']}/pledges", headers=h).json()
    jane = next(p for p in pledges if p["donor_id"] == "DON1")
    assert jane["first_name"] == ""
    assert jane["last_name"] == ""
    assert jane["email"] == ""
    assert jane["donor_id"] == "DON1"  # not redacted - it's an identifier, not PII display

    donations = client.get(f"/api/pledge-campaigns/{campaign['id']}/donations", headers=h).json()
    d1 = next(d for d in donations if d["donor_id"] == "DON1")
    assert d1["donor_first_name"] == ""
    assert d1["donor_last_name"] == ""

    # Turn it back off so it doesn't leak into other tests sharing this admin account.
    client.put(
        f"/api/auth/users/{me['id']}/permissions",
        headers=h,
        json={"permissions": [], "is_admin": True, "hide_donor_names": False},
    )


def test_donations_list_resolves_donor_identity():
    _import_donations()
    campaign = _create_campaign(name="Actuals Campaign")
    _import_pledges(campaign["id"])
    _import_donors(campaign["id"])

    h = auth_header()
    donations = client.get(f"/api/pledge-campaigns/{campaign['id']}/donations", headers=h).json()
    d1 = next(d for d in donations if d["donor_id"] == "DON1")
    assert d1["donor_first_name"] == "Jane"
    assert d1["donor_last_name"] == "Doe"


def test_delete_fund_removes_only_that_funds_donations():
    # Self-contained fund name so this doesn't depend on test ordering /
    # other tests' shared donations still being present.
    csv_text = (
        "id,donor_id,received_date,fund,amount,net_amount,payment_method\n"
        "delfund1,DON9,2026-03-01,Delete Me Fund,10.00,10.00,check\n"
    )
    r = _upload("/api/donations/import", "d.csv", csv_text, "donation_file")
    assert r.status_code == 200, r.text

    h = auth_header()
    before = {f["name"]: f for f in client.get("/api/donations/funds", headers=h).json()}
    assert "Delete Me Fund" in before

    r = client.delete("/api/donations/funds/Delete Me Fund", headers=h)
    assert r.status_code == 200, r.text
    after = {f["name"]: f for f in r.json()}
    assert "Delete Me Fund" not in after
