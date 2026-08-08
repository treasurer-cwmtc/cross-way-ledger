"""Pulls Donor profiles and Donations from the live PCO Giving API - the
automated counterpart to services/pledge_import.py's manual-upload path
(parse_donor_csv/parse_donation_csv). Produces the same DonorRow/DonationRow
shapes so routers/pledge_campaigns.py and routers/donations.py's upsert
logic treats API-sourced and CSV-sourced rows identically.

Field names below were verified against a real /giving/v2/people and
/giving/v2/donations response (not guessed) - see the "confirmed live"
notes inline. Two things the API does NOT expose directly, unlike the CSV
export: donation_count/total_given (no lifetime-total field on the Person
record) - filled in by routers/pledge_campaigns.py's _recompute_donor_totals
from the full local campaign_donations table after every sync, which
already holds the complete history (nothing is ever deleted from it, CSV or
API sourced) - and joint-giver household linkage, which lives on PCO's
Household resource, not exposed on this endpoint - left blank rather than
guessed; a treasurer can still set it manually if needed (see DonorRow's
joint_giver_* fields).

https://developer.planning.center/docs/#/apps/giving
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from .pco_client import get as pco_get
from .pco_client import paginate
from .pledge_import import DonationRow, DonorRow


def _parse_iso_date(value: str):
    """PCO's API timestamps are ISO 8601 ("2026-08-01T14:03:00Z"), unlike
    the CSV export's "M/D/YYYY" - services.pledge_import._parse_date only
    handles the CSV formats, so this is a separate small parser rather than
    stretching that one to cover both."""
    value = (value or "").strip()
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def _primary(items: list[dict] | None, key: str) -> str:
    """items is one of a Giving Person's attributes.email_addresses /
    .phone_numbers / .addresses arrays (confirmed live shape - each entry
    has its own "primary" bool, no separate include/relationship needed
    unlike the People API's Email/PhoneNumber include). Prefers the one
    flagged primary, falls back to the first entry rather than dropping the
    value entirely."""
    items = items or []
    for item in items:
        if item.get("primary"):
            return item.get(key) or ""
    return (items[0].get(key) or "") if items else ""


def fetch_donors() -> list[DonorRow]:
    """Giving's own /giving/v2/people - a donor-scoped view of a Person
    (only people who've actually given show up here), sharing the same
    person id space as the People API. attributes confirmed live: donor_
    number, first_name, last_name, first_donated_at, and the email_
    addresses/phone_numbers/addresses arrays below (each entry carrying its
    own "primary" flag inline - unlike the People API, no `include=` or
    `included` lookup needed here)."""
    rows: list[DonorRow] = []
    for person in paginate("/giving/v2/people", params={}):
        attrs = person.get("attributes", {})
        primary_address = next(
            (a for a in attrs.get("addresses") or [] if a.get("primary")),
            (attrs.get("addresses") or [None])[0],
        ) or {}
        rows.append(
            DonorRow(
                donor_id=person["id"],
                donor_number=str(attrs.get("donor_number") or ""),
                first_name=attrs.get("first_name") or "",
                last_name=attrs.get("last_name") or "",
                email=_primary(attrs.get("email_addresses"), "address").strip().lower(),
                phone_number=_primary(attrs.get("phone_numbers"), "number"),
                city=primary_address.get("city") or "",
                state=primary_address.get("state") or "",
                zip_code=primary_address.get("zip") or "",
                # Household/joint-giver linkage isn't on this endpoint - see
                # module docstring. Left blank, not guessed.
                joint_giver_id="",
                joint_giver_first_name="",
                joint_giver_last_name="",
                first_donated=_parse_iso_date(attrs.get("first_donated_at") or ""),
                # donation_count/total_given: not exposed here - always
                # overwritten by _recompute_donor_totals right after this
                # runs, never trust these zeros as a real answer on their own.
                donation_count=0,
                total_given=0.0,
                raw=attrs,
            )
        )
    return rows


def _designation_fund_name(designation: dict, included_by_id: dict) -> str:
    fund_ref = designation.get("relationships", {}).get("fund", {}).get("data")
    if not fund_ref:
        return ""
    fund = included_by_id.get(f"{fund_ref['type']}:{fund_ref['id']}")
    return fund.get("attributes", {}).get("name", "") if fund else ""


def fetch_donations(since_days: int) -> list[DonationRow]:
    """Pulls donations created within the trailing `since_days` window,
    exploding a multi-fund donation (>1 designation) into one DonationRow
    per fund - each gets its own dedup_key suffix and its own proportional
    share of net_amount, so re-syncing never duplicates and the exploded
    rows still sum back to the original donation (same approach as the
    Stripe split-fund fix, see services/reconciler.py).

    attrs confirmed live: amount_cents, fee_cents (already negative - a
    -138 fee_cents means "$1.38 was deducted", so net = amount + fee, NOT
    amount - fee), received_at, payment_method. `include=designations.fund`
    (dot-notation nested include, confirmed to work) embeds both the
    Designation and its Fund in one response, no second request per
    donation needed."""
    since = datetime.now(tz=timezone.utc) - timedelta(days=since_days)
    since_iso = since.strftime("%Y-%m-%dT%H:%M:%SZ")

    rows: list[DonationRow] = []
    params = {
        "where[created_at][gt]": since_iso,
        "include": "designations.fund",
        "per_page": 100,
    }
    # paginate() doesn't surface `included` (see pco_client's docstring) -
    # walk pages directly here so each donation's designations/funds can be
    # resolved from that same page's included array.
    next_url: str | None = "/giving/v2/donations"
    first = True
    while next_url:
        page = pco_get(next_url, params=params if first else None)
        first = False
        included_by_id = {f"{i['type']}:{i['id']}": i for i in page.get("included", [])}
        for donation in page.get("data", []):
            attrs = donation.get("attributes", {})
            donation_id = donation["id"]
            received_date = _parse_iso_date(attrs.get("received_at") or attrs.get("completed_at") or "")
            method = attrs.get("payment_method") or ""
            donor_ref = donation.get("relationships", {}).get("person", {}).get("data")
            donor_id = donor_ref["id"] if donor_ref else ""

            total_amount = (attrs.get("amount_cents") or 0) / 100
            # fee_cents is already signed negative (a deduction) - net is
            # amount PLUS fee, not amount minus fee. See docstring above.
            total_fee_signed = (attrs.get("fee_cents") or 0) / 100
            total_net = total_amount + total_fee_signed

            designation_refs = donation.get("relationships", {}).get("designations", {}).get("data", [])
            designations = [
                included_by_id.get(f"{ref['type']}:{ref['id']}")
                for ref in designation_refs
                if included_by_id.get(f"{ref['type']}:{ref['id']}")
            ]

            if len(designations) <= 1:
                fund = _designation_fund_name(designations[0], included_by_id) if designations else ""
                rows.append(
                    DonationRow(
                        dedup_key=donation_id,
                        donor_id=donor_id,
                        received_date=received_date,
                        fund=fund,
                        amount=round(total_amount, 2),
                        net_amount=round(total_net, 2),
                        method=method,
                        raw=attrs,
                    )
                )
                continue

            # Split across multiple funds - explode into one row per fund,
            # each fund's share of net_amount proportional to its share of
            # the total (mirrors reconciler.py's split-gift proration), with
            # the last row absorbing any rounding remainder so the exploded
            # rows always sum back to total_net exactly.
            running_net = 0.0
            for i, designation in enumerate(designations):
                d_amount = (designation.get("attributes", {}).get("amount_cents") or 0) / 100
                share = d_amount / total_amount if total_amount else 0.0
                if i == len(designations) - 1:
                    d_net = round(total_net - running_net, 2)
                else:
                    d_net = round(total_net * share, 2)
                    running_net += d_net
                rows.append(
                    DonationRow(
                        dedup_key=f"{donation_id}-{designation['id']}",
                        donor_id=donor_id,
                        received_date=received_date,
                        fund=_designation_fund_name(designation, included_by_id),
                        amount=round(d_amount, 2),
                        net_amount=d_net,
                        method=method,
                        raw=attrs,
                    )
                )
        next_url = page.get("links", {}).get("next")
    return rows
