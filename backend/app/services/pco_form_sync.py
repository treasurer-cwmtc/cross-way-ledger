"""Pulls Pledge Form submissions from the live PCO People Forms API - the
automated counterpart to services/pledge_import.py's manual CSV export path
(parse_pledge_csv). A campaign opts in by picking a Form and mapping its
*value* fields (see models.PledgeFormMapping) via routers/pledge_campaigns.py;
identity (first/last name, email) is deliberately never mapped here - a
FormSubmission is already linked to a real PCO Person (relationships.person),
resolvable via the already-synced pco_people_people table, so this module
only ever returns that Person's id, leaving name/email resolution to the
caller (see routers/pledge_campaigns.py's _person_lookup).

Field shapes below were verified live against the treasurer's own "Building
Project Voluntary Pledge Form" (form id 1109730):
- GET /people/v2/forms -> {id, attributes.name, attributes.active}
- GET /people/v2/forms/{id}/fields -> {id, attributes.label,
  attributes.field_type} - field_type includes "heading" (a non-data
  section label, never a real answer - excluded from fetch_form_fields so
  it never shows up in the mapping picker).
- GET /people/v2/forms/{id}/form_submissions?include=form_submission_values
  -> each FormSubmission has attributes.created_at,
  relationships.person.data.id, and relationships.form_submission_values.
  Each included FormSubmissionValue has attributes.display_value (a
  ready-to-parse string, e.g. "Dec 1, 2027" for a date field, "600" for a
  number) and relationships.form_field.data.id. A multi-select field (e.g.
  "Method of Contact" checkboxes) produces multiple FormSubmissionValue
  rows for the same submission+field - _group_values below joins them
  (comma-separated) rather than keeping only the last one seen.

https://developer.planning.center/docs/#/apps/people
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime

from .parsers import parse_amount
from .pco_client import get as pco_get
from .pco_client import paginate


@dataclass
class FormSubmissionRow:
    submission_id: str
    person_id: str  # resolves to a real PcoPerson - see module docstring
    date_submitted: datetime | None
    initial_amount: float
    due_date: date | None
    monthly_amount: float
    contact_method: str
    raw: dict = field(default_factory=dict)


def fetch_available_forms() -> list[dict]:
    """Every PCO Form in the account, active or not - the campaign wizard's
    form picker shows both (an inactive form may still be the one a past
    campaign already synced from) but flags active via the `active` key."""
    return [
        {
            "id": item["id"],
            "name": item.get("attributes", {}).get("name", ""),
            "active": bool(item.get("attributes", {}).get("active")),
        }
        for item in paginate("/people/v2/forms")
    ]


def fetch_form_fields(form_id: str) -> list[dict]:
    """A form's own fields, for the mapping picker - "heading" fields are
    section labels, not real answers, and are excluded so they never show
    up as a mappable option (see module docstring)."""
    return [
        {
            "id": item["id"],
            "label": item.get("attributes", {}).get("label", ""),
            "field_type": item.get("attributes", {}).get("field_type", ""),
        }
        for item in paginate(f"/people/v2/forms/{form_id}/fields")
        if item.get("attributes", {}).get("field_type") != "heading"
    ]


def _parse_submission_datetime(value: str) -> datetime | None:
    """PCO's FormSubmission.created_at is ISO 8601 ("2027-11-15T18:22:01Z"),
    same convention as pco_giving_sync's donation timestamps."""
    value = (value or "").strip()
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _parse_field_date(value: str) -> date | None:
    """A date-type field's display_value reads like "Dec 1, 2027" - PCO's
    own human-readable rendering, distinct from both the CSV export's
    M/D/YYYY (services.pledge_import._parse_date) and the API's ISO
    timestamps (_parse_submission_datetime above), so this is its own small
    parser rather than stretching either of those to also cover it."""
    value = (value or "").strip()
    if not value:
        return None
    try:
        return datetime.strptime(value, "%b %d, %Y").date()
    except ValueError:
        return None


def _group_values(included_by_id: dict, value_refs: list[dict]) -> dict[str, str]:
    """Groups a submission's FormSubmissionValues by their form_field id,
    joining a multi-select field's several values (e.g. "Method of
    Contact" checkboxes) into one comma-separated string rather than
    keeping only the last one encountered."""
    by_field: dict[str, list[str]] = {}
    for ref in value_refs:
        item = included_by_id.get(f"{ref['type']}:{ref['id']}")
        if not item:
            continue
        field_ref = item.get("relationships", {}).get("form_field", {}).get("data")
        if not field_ref:
            continue
        display_value = (item.get("attributes", {}).get("display_value") or "").strip()
        if not display_value:
            continue
        by_field.setdefault(field_ref["id"], []).append(display_value)
    return {field_id: ", ".join(values) for field_id, values in by_field.items()}


def fetch_form_submissions(
    form_id: str,
    initial_amount_field_id: str,
    due_date_field_id: str,
    monthly_amount_field_id: str,
    contact_method_field_id: str,
) -> list[FormSubmissionRow]:
    """Every submission to `form_id`, parsed per the campaign's saved field
    mapping (see models.PledgeFormMapping). A blank mapping field id (not
    yet configured) simply yields "" / 0.0 / None for that value rather than
    raising - mirrors parse_pledge_csv's tolerance for a missing CSV column.
    """
    rows: list[FormSubmissionRow] = []
    params = {"include": "form_submission_values", "per_page": 100}
    next_url: str | None = f"/people/v2/forms/{form_id}/form_submissions"
    first = True
    while next_url:
        page = pco_get(next_url, params=params if first else None)
        first = False
        included_by_id = {f"{i['type']}:{i['id']}": i for i in page.get("included", [])}
        for submission in page.get("data", []):
            attrs = submission.get("attributes", {})
            rels = submission.get("relationships", {})
            person_ref = rels.get("person", {}).get("data")
            person_id = person_ref["id"] if person_ref else ""
            value_refs = rels.get("form_submission_values", {}).get("data", [])
            values_by_field = _group_values(included_by_id, value_refs)

            rows.append(
                FormSubmissionRow(
                    submission_id=submission["id"],
                    person_id=person_id,
                    date_submitted=_parse_submission_datetime(attrs.get("created_at") or ""),
                    initial_amount=parse_amount(values_by_field.get(initial_amount_field_id, "")),
                    due_date=_parse_field_date(values_by_field.get(due_date_field_id, "")),
                    monthly_amount=parse_amount(values_by_field.get(monthly_amount_field_id, "")),
                    contact_method=values_by_field.get(contact_method_field_id, ""),
                    raw=attrs,
                )
            )
        next_url = page.get("links", {}).get("next")
    return rows
