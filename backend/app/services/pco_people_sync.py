"""Pulls People from the live PCO People API - the automated counterpart to
`services.reimbursements.parse_pco_people_csv`'s manual-upload path.
Produces the same `PcoPersonRow` shape so the router's upsert logic (see
routers/reimbursements.py) treats API-sourced and CSV-sourced rows
identically.

Every person is pulled regardless of status (active, inactive, etc.) - the
Planning Center > People page shows real status per person, so a treasurer
can browse everyone, not just who's currently active. This table is still
the Reimbursements portal's login allowlist, but that gate now checks
status="active" explicitly (see services.reimbursements.
is_allowed_reimbursement_submitter) rather than relying on this sync to
only ever import active people - someone who's left the church still can't
log in just because their PCO row hasn't been deleted. See
https://developer.planning.center/docs/#/apps/people/2024-08-08/vertices/person
"""

from __future__ import annotations

from .pco_client import paginate, paginate_with_included
from .reimbursements import PcoPersonRow


def fetch_list_options() -> list[dict]:
    """Every PCO List in the account, for the Reimbursement Access admin
    picker (see routers/reimbursements.py's GET /pco-lists) - an on-demand
    admin call, not something evaluated per login, so a live fetch (no local
    sync) is fine here, unlike fetch_list_member_ids below."""
    return [
        {"id": item["id"], "name": item.get("attributes", {}).get("name", "")}
        for item in paginate("/people/v2/lists")
    ]


def fetch_list_member_ids(list_id: str) -> set[str]:
    """Every current member's person_id for one PCO List - synced into
    pco_list_members (see models.PcoListMember) whenever the configured
    Reimbursement-access gate list is re-synced, so the login gate itself
    stays a local DB read rather than a live API call per OTP request."""
    return {item["id"] for item in paginate(f"/people/v2/lists/{list_id}/people")}


def _primary_email(included_by_id: dict, relationships: dict) -> str:
    for ref in relationships.get("emails", {}).get("data", []):
        item = included_by_id.get(f"{ref['type']}:{ref['id']}")
        if item and item.get("attributes", {}).get("primary"):
            return (item["attributes"].get("address") or "").strip().lower()
    # No email flagged primary - fall back to the first one on file rather
    # than dropping the person entirely (matches the CSV path's tolerance
    # for a blank/secondary email; still allowlist-able by person_id, an
    # allowlist match just also happens by email at login time).
    for ref in relationships.get("emails", {}).get("data", []):
        item = included_by_id.get(f"{ref['type']}:{ref['id']}")
        if item:
            return (item["attributes"].get("address") or "").strip().lower()
    return ""


def _primary_phone(included_by_id: dict, relationships: dict) -> str:
    for ref in relationships.get("phone_numbers", {}).get("data", []):
        item = included_by_id.get(f"{ref['type']}:{ref['id']}")
        if item:
            return item.get("attributes", {}).get("number") or ""
    return ""


def fetch_people() -> list[PcoPersonRow]:
    """Every Person in the account, any status - no `where[status]` filter
    (see module docstring for why)."""
    rows: list[PcoPersonRow] = []
    for person, included_by_id in paginate_with_included(
        "/people/v2/people",
        params={"include": "emails,phone_numbers"},
    ):
        attrs = person.get("attributes", {})
        rels = person.get("relationships", {})
        rows.append(
            PcoPersonRow(
                person_id=person["id"],
                name=attrs.get("name") or "",
                email=_primary_email(included_by_id, rels),
                phone_number=_primary_phone(included_by_id, rels),
                status=attrs.get("status") or "",
            )
        )
    return rows
