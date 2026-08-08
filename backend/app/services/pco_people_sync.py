"""Pulls active People from the live PCO People API - the automated
counterpart to `services.reimbursements.parse_pco_people_csv`'s manual-
upload path. Produces the same `PcoPersonRow` shape so the router's upsert
logic (see routers/reimbursements.py) treats API-sourced and CSV-sourced
rows identically.

Only status=active people are pulled - this table is the Reimbursements
portal's login allowlist, and someone who's left the church shouldn't be
able to log in just because they were never removed from PCO. See
https://developer.planning.center/docs/#/apps/people/2024-08-08/vertices/person
"""

from __future__ import annotations

from .pco_client import paginate_with_included
from .reimbursements import PcoPersonRow


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


def fetch_active_people() -> list[PcoPersonRow]:
    rows: list[PcoPersonRow] = []
    for person, included_by_id in paginate_with_included(
        "/people/v2/people",
        params={"where[status]": "active", "include": "emails,phone_numbers"},
    ):
        attrs = person.get("attributes", {})
        rels = person.get("relationships", {})
        rows.append(
            PcoPersonRow(
                person_id=person["id"],
                name=attrs.get("name") or "",
                email=_primary_email(included_by_id, rels),
                phone_number=_primary_phone(included_by_id, rels),
            )
        )
    return rows
