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
    details = client.get(f"/api/pledge-campaigns/{campaign['id']}/details", headers=h).json()
    jane = next(r for r in details if r["email"] == "jane@example.com")
    assert jane["donor_id"] == "DON1"
    assert jane["has_pledge"] is True
    assert round(jane["actual_amount"], 2) == 298.50  # d1 + d2, this fund only

    dashboard = client.get(f"/api/pledge-campaigns/{campaign['id']}/dashboard", headers=h).json()
    assert dashboard["pledge_count"] == 2
    assert dashboard["donation_count"] == 3  # only Building Fund donations
    assert round(dashboard["total_pledged"], 2) == 1500.00
    assert round(dashboard["total_actual"], 2) == 348.50
    # Every Building Fund donor here (DON1, DON2) has a matching pledge, so
    # there's no unpledged giving to add on top of total_pledged.
    assert round(dashboard["unpledged_actual"], 2) == 0.00
    # total_raised includes starting_balance, but the timeline must not.
    assert round(dashboard["total_raised"], 2) == 448.50
    final_point = dashboard["timeline"][-1]
    assert round(final_point["running_actual_total"], 2) == 348.50
    assert round(final_point["running_pledged_total"], 2) == 1500.00
    # Progress toward goal is judged against money actually raised, not
    # money raised + starting balance.
    assert dashboard["percent_of_goal"] == round(348.50 / 2000 * 100, 1)


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
    # No point's running totals should ever include the 500 starting balance.
    assert all(p["running_actual_total"] <= 348.50 + 0.01 for p in timeline)
    assert all(p["running_pledged_total"] <= 1500.00 + 0.01 for p in timeline)


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
    details = client.get(f"/api/pledge-campaigns/{campaign['id']}/details", headers=h).json()
    unmatched = next(r for r in details if r["email"] == "no-match-yet@example.com")
    assert unmatched["donor_id"] is None
    assert unmatched["has_pledge"] is True
    pledge_id = int(unmatched["key"].removeprefix("pledge:"))

    r = client.put(
        f"/api/pledge-campaigns/{campaign['id']}/pledges/{pledge_id}/match",
        headers=h,
        json={"donor_id": "DON1"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["match_source"] == "manual"
    assert round(r.json()["actual_amount"], 2) == 298.50

    detail = client.get(
        f"/api/pledge-campaigns/{campaign['id']}/details/{unmatched['key']}", headers=h
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

    details = client.get(f"/api/pledge-campaigns/{campaign['id']}/details", headers=h).json()
    jane = next(r for r in details if r["donor_id"] == "DON1")
    assert jane["first_name"] == ""
    assert jane["last_name"] == ""
    assert jane["email"] == ""
    assert jane["donor_id"] == "DON1"  # not redacted - it's an identifier, not PII display

    # Turn it back off so it doesn't leak into other tests sharing this admin account.
    client.put(
        f"/api/auth/users/{me['id']}/permissions",
        headers=h,
        json={"permissions": [], "is_admin": True, "hide_donor_names": False},
    )


def test_details_resolves_pledge_donor_and_includes_giver_without_pledge():
    """The combined Details tab must show both: a pledge matched to its
    donor, and someone who gave to this fund but never submitted a pledge
    form at all - their giving still has to show up somewhere. Uses its
    own fund/donor/campaign so it doesn't depend on the shared fixture
    donors, all of whom happen to have a matching pledge."""
    donations_csv = (
        "id,donor_id,received_date,fund,amount,net_amount,payment_method\n"
        "giveonly1,DON-NOPLEDGE,2026-04-05,No Pledge Fund,50.00,50.00,check\n"
    )
    r = _upload("/api/donations/import", "d.csv", donations_csv, "donation_file")
    assert r.status_code == 200, r.text

    donors_csv = (
        "donor_id,donor_number,donor_first_name,donor_last_name,donor_email,"
        "donor_phone_number,donor_city,donor_state,donor_zip,joint_giver_id,"
        "joint_giver_first_name,joint_giver_last_name,first_donated,donation_count,total\n"
        "DON-NOPLEDGE,2001,Priya,Varkey,priya.varkey@example.com,555-3333,Plano,TX,75023,,,,2026-04-05,1,50.00\n"
    )
    campaign = _create_campaign(name="No Pledge Fund Campaign")
    r = client.put(
        f"/api/pledge-campaigns/{campaign['id']}", headers=auth_header(),
        json={"fund_name": "No Pledge Fund"},
    )
    assert r.status_code == 200, r.text
    r = _upload(
        f"/api/pledge-campaigns/{campaign['id']}/import/donors", "donors.csv", donors_csv, "donor_file"
    )
    assert r.status_code == 200, r.text

    h = auth_header()
    details = client.get(f"/api/pledge-campaigns/{campaign['id']}/details", headers=h).json()
    assert len(details) == 1
    giver_only = details[0]
    assert giver_only["has_pledge"] is False
    assert giver_only["pledged_amount"] == 0.0
    assert giver_only["due_date"] is None
    assert giver_only["donor_id"] == "DON-NOPLEDGE"
    assert giver_only["first_name"] == "Priya"
    assert giver_only["last_name"] == "Varkey"
    assert round(giver_only["actual_amount"], 2) == 50.00

    detail = client.get(
        f"/api/pledge-campaigns/{campaign['id']}/details/{giver_only['key']}", headers=h
    ).json()
    assert detail["pledge"] is None
    assert detail["donor_id"] == "DON-NOPLEDGE"
    assert len(detail["gifts"]) == 1


def test_details_groups_unmatched_donation_into_none_donor_row():
    """A donation with no donor_id at all (the Giving App export can leave
    this blank) must still show up on the Details tab, grouped under one
    donor_id=None row, instead of being silently dropped from the total."""
    csv_text = (
        "id,donor_id,received_date,fund,amount,net_amount,payment_method\n"
        "unmatched1,,2026-04-01,Unmatched Fund,75.00,75.00,check\n"
    )
    r = _upload("/api/donations/import", "u.csv", csv_text, "donation_file")
    assert r.status_code == 200, r.text

    campaign = _create_campaign(name="Unmatched Fund Campaign")
    r = client.put(
        f"/api/pledge-campaigns/{campaign['id']}", headers=auth_header(), json={"fund_name": "Unmatched Fund"}
    )
    assert r.status_code == 200, r.text

    h = auth_header()
    details = client.get(f"/api/pledge-campaigns/{campaign['id']}/details", headers=h).json()
    assert len(details) == 1
    row = details[0]
    assert row["donor_id"] is None
    assert row["has_pledge"] is False
    assert round(row["actual_amount"], 2) == 75.00

    detail = client.get(f"/api/pledge-campaigns/{campaign['id']}/details/{row['key']}", headers=h).json()
    assert detail["pledge"] is None
    assert len(detail["gifts"]) == 1
    assert round(detail["gifts"][0]["net_amount"], 2) == 75.00


def test_joint_giver_donations_fold_into_spouses_pledge():
    """A household where one spouse pledges and the other gives under her
    own donor record (e.g. Sajan pledges, Sindi gives) - the pledge's
    Received Amount and gift history should include the spouse's giving,
    since otherwise the pledge would show as unreceived even though the
    household gave. Sindi must NOT also appear as her own separate
    "gave without pledge" row - her giving is already reflected above."""
    donors_csv = (
        "donor_id,donor_number,donor_first_name,donor_last_name,donor_email,"
        "donor_phone_number,donor_city,donor_state,donor_zip,joint_giver_id,"
        "joint_giver_first_name,joint_giver_last_name,first_donated,donation_count,total\n"
        "SAJ1,3001,Sajan,Thomas,sajan.jointtest@example.com,555-1,Frisco,TX,75034,"
        "SIN1,Sindi,Thomas,2026-01-01,0,0.00\n"
        "SIN1,3002,Sindi,Thomas,sindi.jointtest@example.com,555-2,Frisco,TX,75034,"
        "SAJ1,Sajan,Thomas,2026-01-01,1,400.00\n"
    )
    donations_csv = (
        "id,donor_id,received_date,fund,amount,net_amount,payment_method\n"
        "jointgift1,SIN1,2026-02-01,Joint Fold Fund,400.00,400.00,ach\n"
    )
    campaign = _create_campaign(name="Joint Fold Campaign")
    r = client.put(
        f"/api/pledge-campaigns/{campaign['id']}", headers=auth_header(), json={"fund_name": "Joint Fold Fund"}
    )
    assert r.status_code == 200, r.text
    r = _upload(
        f"/api/pledge-campaigns/{campaign['id']}/import/donors", "donors.csv", donors_csv, "donor_file"
    )
    assert r.status_code == 200, r.text
    r = _upload("/api/donations/import", "d.csv", donations_csv, "donation_file")
    assert r.status_code == 200, r.text

    sajan_pledge_csv = (
        "Submission ID,First Name,Last Name,Email,Date Submitted,Initial Pledge,"
        "To be paid by:,Monthly Pledge,Method of Contact\n"
        "joint-sub,Sajan,Thomas,sajan.jointtest@example.com,2026-01-01,1000.00,2026-12-31,0.00,Email\n"
    )
    r = _upload(
        f"/api/pledge-campaigns/{campaign['id']}/import/pledges",
        "pledges.csv",
        sajan_pledge_csv,
        "pledge_file",
        {"fund_name": "Joint Fold Fund"},
    )
    assert r.status_code == 200, r.text

    h = auth_header()
    details = client.get(f"/api/pledge-campaigns/{campaign['id']}/details", headers=h).json()
    assert len(details) == 1  # Sindi does NOT also show up as her own row
    row = details[0]
    assert row["donor_id"] == "SAJ1"
    assert row["has_pledge"] is True
    assert round(row["actual_amount"], 2) == 400.00  # Sindi's gift, folded in
    assert row["joint_giver_id"] == "SIN1"
    assert row["joint_giver_first_name"] == "Sindi"

    detail = client.get(f"/api/pledge-campaigns/{campaign['id']}/details/{row['key']}", headers=h).json()
    assert detail["joint_giver_id"] == "SIN1"
    assert len(detail["gifts"]) == 1
    assert detail["gifts"][0]["donor_id"] == "SIN1"
    assert round(detail["gifts"][0]["net_amount"], 2) == 400.00


def test_joint_giver_not_folded_when_spouse_has_own_pledge():
    """If BOTH spouses submit their own pledge, folding one's gift into the
    other's pledge would be ambiguous - each pledge must keep its own
    actual_amount independently, with no folding either direction."""
    donors_csv = (
        "donor_id,donor_number,donor_first_name,donor_last_name,donor_email,"
        "donor_phone_number,donor_city,donor_state,donor_zip,joint_giver_id,"
        "joint_giver_first_name,joint_giver_last_name,first_donated,donation_count,total\n"
        "SAJ2,3003,Sajan,Two,sajan.bothpledge@example.com,555-3,Frisco,TX,75034,"
        "SIN2,Sindi,Two,2026-01-01,0,0.00\n"
        "SIN2,3004,Sindi,Two,sindi.bothpledge@example.com,555-4,Frisco,TX,75034,"
        "SAJ2,Sajan,Two,2026-01-01,1,400.00\n"
    )
    donations_csv = (
        "id,donor_id,received_date,fund,amount,net_amount,payment_method\n"
        "bothgift1,SIN2,2026-02-01,Both Pledge Fund,400.00,400.00,ach\n"
    )
    campaign = _create_campaign(name="Both Pledge Campaign")
    r = client.put(
        f"/api/pledge-campaigns/{campaign['id']}", headers=auth_header(), json={"fund_name": "Both Pledge Fund"}
    )
    assert r.status_code == 200, r.text
    r = _upload(
        f"/api/pledge-campaigns/{campaign['id']}/import/donors", "donors.csv", donors_csv, "donor_file"
    )
    assert r.status_code == 200, r.text
    r = _upload("/api/donations/import", "d.csv", donations_csv, "donation_file")
    assert r.status_code == 200, r.text

    both_pledges_csv = (
        "Submission ID,First Name,Last Name,Email,Date Submitted,Initial Pledge,"
        "To be paid by:,Monthly Pledge,Method of Contact\n"
        "both-sub1,Sajan,Two,sajan.bothpledge@example.com,2026-01-01,1000.00,2026-12-31,0.00,Email\n"
        "both-sub2,Sindi,Two,sindi.bothpledge@example.com,2026-01-02,500.00,2026-12-31,0.00,Email\n"
    )
    r = _upload(
        f"/api/pledge-campaigns/{campaign['id']}/import/pledges",
        "pledges.csv",
        both_pledges_csv,
        "pledge_file",
        {"fund_name": "Both Pledge Fund"},
    )
    assert r.status_code == 200, r.text

    h = auth_header()
    details = client.get(f"/api/pledge-campaigns/{campaign['id']}/details", headers=h).json()
    assert len(details) == 2  # both pledges, no folding, no extra donor row
    by_donor = {r["donor_id"]: r for r in details}
    assert round(by_donor["SAJ2"]["actual_amount"], 2) == 0.00
    assert round(by_donor["SIN2"]["actual_amount"], 2) == 400.00


def test_dashboard_counts_unpledged_giving_toward_goal():
    """Someone who gave without ever submitting a pledge (e.g. Lijoy gives
    $22,000 with no pledge on file) still counts toward the goal - money
    already in hand is at least as strong a commitment as a pledge, so
    unpledged_actual should reflect their gift on top of total_pledged."""
    donors_csv = (
        "donor_id,donor_number,donor_first_name,donor_last_name,donor_email,"
        "donor_phone_number,donor_city,donor_state,donor_zip,joint_giver_id,"
        "joint_giver_first_name,joint_giver_last_name,first_donated,donation_count,total\n"
        "GIVERONLY,4001,Lijoy,Test,lijoy.test@example.com,555-9,Murphy,TX,75094,,,,2026-01-01,1,22000.00\n"
    )
    donations_csv = (
        "id,donor_id,received_date,fund,amount,net_amount,payment_method\n"
        "unpledgedgift1,GIVERONLY,2026-03-01,Unpledged Goal Fund,22000.00,22000.00,ach\n"
    )
    campaign = _create_campaign(name="Unpledged Goal Campaign", goal=100000.0)
    r = client.put(
        f"/api/pledge-campaigns/{campaign['id']}", headers=auth_header(),
        json={"fund_name": "Unpledged Goal Fund"},
    )
    assert r.status_code == 200, r.text
    r = _upload(
        f"/api/pledge-campaigns/{campaign['id']}/import/donors", "donors.csv", donors_csv, "donor_file"
    )
    assert r.status_code == 200, r.text
    r = _upload("/api/donations/import", "d.csv", donations_csv, "donation_file")
    assert r.status_code == 200, r.text

    # A separate person DOES pledge, so total_pledged isn't zero either.
    pledge_csv = (
        "Submission ID,First Name,Last Name,Email,Date Submitted,Initial Pledge,"
        "To be paid by:,Monthly Pledge,Method of Contact\n"
        "unpledged-goal-sub,Someone,Else,someone.else@example.com,2026-01-01,5000.00,2026-12-31,0.00,Email\n"
    )
    r = _upload(
        f"/api/pledge-campaigns/{campaign['id']}/import/pledges",
        "pledges.csv",
        pledge_csv,
        "pledge_file",
        {"fund_name": "Unpledged Goal Fund"},
    )
    assert r.status_code == 200, r.text

    h = auth_header()
    dashboard = client.get(f"/api/pledge-campaigns/{campaign['id']}/dashboard", headers=h).json()
    assert round(dashboard["total_pledged"], 2) == 5000.00
    assert round(dashboard["unpledged_actual"], 2) == 22000.00


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


def test_source_file_reference_stored_on_import():
    """The frontend archives each uploaded CSV to Google Drive before
    calling the import endpoint, then passes the resulting file name/link
    along so every row can be traced back to the file it came from."""
    h = auth_header()
    donation_csv = (
        "id,donor_id,received_date,fund,amount,net_amount,payment_method\n"
        "srcfile1,DONX,2026-05-01,Source File Fund,10.00,10.00,check\n"
    )
    r = _upload(
        "/api/donations/import",
        "donations.csv",
        donation_csv,
        "donation_file",
        {"source_file_name": "2026-05-01_donations.csv", "source_file_link": "https://drive.google.com/file/d/abc"},
    )
    assert r.status_code == 200, r.text

    campaign = _create_campaign(name="Source File Campaign")
    r = _upload(
        f"/api/pledge-campaigns/{campaign['id']}/import/pledges",
        "pledges.csv",
        PLEDGES_CSV,
        "pledge_file",
        {
            "fund_name": "Source File Fund",
            "source_file_name": "2026-05-01_pledges.csv",
            "source_file_link": "https://drive.google.com/file/d/def",
        },
    )
    assert r.status_code == 200, r.text
    pledge = r.json()["new_pledges"][0]
    assert pledge["source_file_name"] == "2026-05-01_pledges.csv"
    assert pledge["source_file_link"] == "https://drive.google.com/file/d/def"

    r = _upload(
        f"/api/pledge-campaigns/{campaign['id']}/import/donors",
        "donors.csv",
        DONORS_CSV,
        "donor_file",
        {"source_file_name": "2026-05-01_donors.csv", "source_file_link": "https://drive.google.com/file/d/ghi"},
    )
    assert r.status_code == 200, r.text

    # DONX never matches a pledge or a donor record, so it surfaces as its
    # own row - the donation itself (not the row, which has no single file
    # once multiple donations could roll up into it) carries the source file.
    details = client.get(f"/api/pledge-campaigns/{campaign['id']}/details", headers=h).json()
    donx_row = next(r for r in details if r["donor_id"] == "DONX")
    detail = client.get(f"/api/pledge-campaigns/{campaign['id']}/details/{donx_row['key']}", headers=h).json()
    assert detail["gifts"][0]["source_file_name"] == "2026-05-01_donations.csv"
