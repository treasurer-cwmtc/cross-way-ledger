"""The general Giving App - Donors list: joint-giver fields surfaced for
the click-to-expand detail popup, and the donor's gift history across
every fund (not scoped to a single campaign, unlike the Pledge Campaigns
Details endpoints)."""

import io

from test_auth import auth_header, client


DONORS_CSV = (
    "donor_id,donor_number,donor_first_name,donor_last_name,donor_email,"
    "donor_phone_number,donor_city,donor_state,donor_zip,joint_giver_id,"
    "joint_giver_first_name,joint_giver_last_name,first_donated,donation_count,total\n"
    "DGIVER1,2001,Sajan,Thomas,sajan.thomas@example.com,555-4444,Plano,TX,75023,"
    "DGIVER2,Sindi,Thomas,2026-01-05,1,500.00\n"
    "DGIVER2,2002,Sindi,Thomas,sindi.thomas@example.com,555-5555,Plano,TX,75023,"
    "DGIVER1,Sajan,Thomas,2026-01-10,1,250.00\n"
)

DONATIONS_CSV = """id,donor_id,received_date,fund,amount,net_amount,payment_method
dg1,DGIVER2,2026-01-10,Building Fund,250.00,250.00,check
dg2,DGIVER2,2026-02-01,General Fund,50.00,50.00,check
"""


def _upload(path: str, filename: str, content: str, field: str, extra: dict | None = None):
    h = auth_header()
    files = {field: (filename, io.BytesIO(content.encode()), "text/csv")}
    return client.post(path, headers=h, files=files, data=extra or {})


def test_donor_list_includes_joint_giver_fields():
    h = auth_header()
    campaign = client.post(
        "/api/pledge-campaigns", headers=h, json={"name": "Joint Giver Campaign", "goal_amount": 1.0}
    ).json()
    r = _upload(
        f"/api/pledge-campaigns/{campaign['id']}/import/donors", "donors.csv", DONORS_CSV, "donor_file"
    )
    assert r.status_code == 200, r.text

    donors = {d["donor_id"]: d for d in client.get("/api/donors", headers=h).json()}
    sajan = donors["DGIVER1"]
    assert sajan["joint_giver_id"] == "DGIVER2"
    assert sajan["joint_giver_first_name"] == "Sindi"
    assert sajan["joint_giver_last_name"] == "Thomas"
    assert sajan["zip_code"] == "75023"


def test_donor_gifts_endpoint_returns_every_fund():
    r = _upload("/api/donations/import", "d.csv", DONATIONS_CSV, "donation_file")
    assert r.status_code == 200, r.text

    h = auth_header()
    gifts = client.get("/api/donors/DGIVER2/gifts", headers=h).json()
    funds = {g["fund"] for g in gifts}
    assert funds == {"Building Fund", "General Fund"}
    assert round(sum(g["net_amount"] for g in gifts), 2) == 300.00


def test_donor_gifts_404_for_unknown_donor():
    h = auth_header()
    r = client.get("/api/donors/NO-SUCH-DONOR/gifts", headers=h)
    assert r.status_code == 404
