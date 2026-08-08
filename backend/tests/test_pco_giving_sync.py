"""Tests for the automated PCO Giving sync: the on-demand/scheduled
endpoints that pull pco_giving_people (donors) and campaign_donations
(donations) from the Giving API (mocked here) instead of a CSV upload -
mirrors test_stripe_sync.py's shape.
"""

from datetime import date
from unittest.mock import patch

from app.services.pledge_import import DonationRow, DonorRow
from test_auth import auth_header, client


def _fake_donor_rows() -> list[DonorRow]:
    return [
        DonorRow(
            donor_id="8001",
            donor_number="2001",
            first_name="Priya",
            last_name="Thomas",
            email="priya@example.com",
            phone_number="(214) 555-8001",
            city="Plano",
            state="TX",
            zip_code="75023",
            joint_giver_id="",
            joint_giver_first_name="",
            joint_giver_last_name="",
            first_donated=date(2024, 1, 1),
            donation_count=0,
            total_given=0.0,
        )
    ]


def _fake_donation_rows(donor_id="8001", dedup_key="d-sync-1") -> list[DonationRow]:
    # "PCO Sync Test Fund" (not "Building Fund"/"Other Fund") so this never
    # collides with test_pledge_campaigns.py's DONATIONS_CSV fixture -
    # Donation is a shared, unscoped table across the whole test session
    # (see Donation's docstring), so a generic fund name here would silently
    # inflate that other file's fund-count/dashboard assertions.
    return [
        DonationRow(
            dedup_key=dedup_key,
            donor_id=donor_id,
            received_date=date(2026, 6, 1),
            fund="PCO Sync Test Fund",
            amount=100.0,
            net_amount=98.0,
            method="card",
        )
    ]


def _create_campaign(name="Sync Test Campaign") -> dict:
    h = auth_header()
    r = client.post(
        "/api/pledge-campaigns",
        headers=h,
        json={"name": name, "goal_amount": 1000.0, "starting_balance": 0.0},
    )
    assert r.status_code == 201, r.text
    return r.json()


# --------------------------------------------------------------------------- #
# Donor sync
# --------------------------------------------------------------------------- #


def test_donors_sync_now_requires_auth():
    assert client.post("/api/pledge-campaigns/donors/sync").status_code == 401


def test_donors_scheduled_sync_rejects_missing_or_wrong_secret():
    assert client.post("/api/pledge-campaigns/donors/scheduled-sync").status_code == 403
    assert (
        client.post(
            "/api/pledge-campaigns/donors/scheduled-sync", headers={"X-Sync-Secret": "wrong"}
        ).status_code
        == 403
    )


def test_donors_sync_upserts_and_updates_last_synced():
    h = auth_header()
    with patch("app.routers.pledge_campaigns.pco_giving_sync.fetch_donors", return_value=_fake_donor_rows()):
        r = client.post("/api/pledge-campaigns/donors/sync", headers=h)
    assert r.status_code == 200, r.text
    result = r.json()
    assert result["donors_imported"] == 1

    r = client.get("/api/pledge-campaigns/donors/last-synced", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["last_synced_at"]


def test_donors_sync_recomputes_totals_from_local_donations():
    """donation_count/total_given aren't on the API's Person record (see
    pco_giving_sync.fetch_donors) - the sync must fill them in from whatever
    donations already exist locally, not leave them at the API's blank 0."""
    h = auth_header()
    with patch(
        "app.routers.donations.pco_giving_sync.fetch_donations",
        return_value=_fake_donation_rows("8001", "d-recompute-totals"),
    ):
        client.post("/api/donations/sync", headers=h)

    with patch("app.routers.pledge_campaigns.pco_giving_sync.fetch_donors", return_value=_fake_donor_rows()):
        client.post("/api/pledge-campaigns/donors/sync", headers=h)

    r = client.get("/api/donors", headers=h)
    assert r.status_code == 200, r.text
    donor = next(d for d in r.json() if d["donor_id"] == "8001")
    assert donor["donation_count"] == 1
    assert donor["total_given"] == 98.0
    # first_donated comes straight from the API's first_donated_at, not the
    # local recompute - preserved even though the only synced donation here
    # is dated much later (see fetch_donors' docstring).
    assert donor["first_donated"] == "2024-01-01"


def test_donors_sync_rematches_every_active_campaign_not_just_one():
    campaign_a = _create_campaign("Sync Campaign A")
    campaign_b = _create_campaign("Sync Campaign B")
    h = auth_header()

    for campaign in (campaign_a, campaign_b):
        r = client.post(
            f"/api/pledge-campaigns/{campaign['id']}/import/pledges",
            headers=h,
            files={"pledge_file": ("p.csv", b"Submission ID,First Name,Last Name,Email,Date Submitted,Initial Pledge,To be paid by:,Monthly Pledge,Method of Contact\nsubX,Priya,Thomas,priya@example.com,2026-01-01,500.00,2026-12-31,0.00,Email\n", "text/csv")},
            data={"fund_name": "Building Fund"},
        )
        assert r.status_code == 200, r.text

    with patch("app.routers.pledge_campaigns.pco_giving_sync.fetch_donors", return_value=_fake_donor_rows()):
        r = client.post("/api/pledge-campaigns/donors/sync", headers=h)
    assert r.status_code == 200, r.text
    # Both campaigns' pledges for priya@example.com resolve against the one
    # synced donor - not campaign-scoped (see Donor's docstring).
    assert r.json()["pledges_matched"] >= 2


def test_donors_sync_surfaces_missing_credentials_as_400():
    h = auth_header()
    from app.services.pco_client import PcoNotConfiguredError

    with patch(
        "app.routers.pledge_campaigns.pco_giving_sync.fetch_donors",
        side_effect=PcoNotConfiguredError("not configured"),
    ):
        r = client.post("/api/pledge-campaigns/donors/sync", headers=h)
    assert r.status_code == 400, r.text


# --------------------------------------------------------------------------- #
# Donation sync
# --------------------------------------------------------------------------- #


def test_donations_sync_now_requires_auth():
    assert client.post("/api/donations/sync").status_code == 401


def test_donations_scheduled_sync_rejects_missing_or_wrong_secret():
    assert client.post("/api/donations/scheduled-sync").status_code == 403
    assert (
        client.post(
            "/api/donations/scheduled-sync", headers={"X-Sync-Secret": "wrong"}
        ).status_code
        == 403
    )


def test_donations_sync_upserts_by_dedup_key_and_skips_repeats():
    h = auth_header()
    rows = _fake_donation_rows("8002", "d-upsert-dedup")
    with patch("app.routers.donations.pco_giving_sync.fetch_donations", return_value=rows):
        r = client.post("/api/donations/sync", headers=h)
    assert r.status_code == 200, r.text
    result = r.json()
    assert result["fetched"] == 1
    assert result["imported"] == 1
    assert result["last_synced_at"]

    r = client.get("/api/donations/last-synced", headers=h)
    assert r.json()["last_synced_at"] == result["last_synced_at"]

    # A repeat sync with the same dedup_key is skipped, not duplicated -
    # Donations are immutable once landed (see Donation's docstring).
    with patch("app.routers.donations.pco_giving_sync.fetch_donations", return_value=rows):
        r = client.post("/api/donations/sync", headers=h)
    assert r.json()["imported"] == 0


def test_donations_sync_passes_lookback_days_setting_through():
    h = auth_header()
    with patch(
        "app.routers.donations.pco_giving_sync.fetch_donations", return_value=[]
    ) as mock_fetch:
        r = client.post("/api/donations/sync", headers=h)
    assert r.status_code == 200, r.text
    mock_fetch.assert_called_once_with(30)  # default pco_giving_sync_lookback_days
