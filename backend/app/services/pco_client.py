"""Thin shared client for the Planning Center Online (PCO) REST API - used
by both services/pco_people_sync.py (People product) and
services/pco_giving_sync.py (Giving product). Mirrors services/
stripe_sync.py's "plain function per operation, config read fresh from
get_settings()" shape, but PCO's auth/pagination/rate-limit conventions are
different enough from Stripe's SDK-wrapped ones to warrant their own small
client rather than reusing that module's pattern directly.

Auth: a Personal Access Token (App ID + Secret) presented as HTTP Basic Auth
- see https://developer.planning.center/docs/#/overview/authentication.

Pagination: PCO's API follows the JSON:API convention - a collection
response's `links.next` is the full next-page URL (already carrying the
right offset/per_page), so paginate() just keeps following it instead of
computing offsets itself.

Rate limiting: PCO returns 429 with a `Retry-After` header (seconds) when a
client exceeds its request budget. get()/paginate() back off and retry
rather than surfacing the 429 to the caller - a sync job should ride out a
transient rate limit, not fail outright.
"""

from __future__ import annotations

import time
from typing import Any, Iterator

import requests

from ..config import get_settings

BASE_URL = "https://api.planningcenteronline.com"
_MAX_RETRIES = 5
_DEFAULT_RETRY_AFTER = 20  # seconds, if PCO omits the header


class PcoNotConfiguredError(RuntimeError):
    pass


def _auth() -> tuple[str, str]:
    settings = get_settings()
    if not settings.pco_app_id or not settings.pco_secret:
        raise PcoNotConfiguredError("Planning Center API credentials are not configured.")
    return (settings.pco_app_id, settings.pco_secret)


def get(path_or_url: str, params: dict[str, Any] | None = None) -> dict:
    """One GET, following PCO's 429 Retry-After backoff. `path_or_url` may be
    a path relative to BASE_URL (e.g. "/people/v2/people") or a full URL
    (as returned in a previous response's links.next) - either works."""
    url = path_or_url if path_or_url.startswith("http") else f"{BASE_URL}{path_or_url}"
    auth = _auth()
    for attempt in range(_MAX_RETRIES):
        response = requests.get(url, params=params, auth=auth, timeout=30)
        if response.status_code == 429:
            wait = int(response.headers.get("Retry-After", _DEFAULT_RETRY_AFTER))
            time.sleep(wait)
            continue
        response.raise_for_status()
        return response.json()
    raise RuntimeError(f"Planning Center API rate limit not cleared after {_MAX_RETRIES} retries.")


def paginate(path: str, params: dict[str, Any] | None = None) -> Iterator[dict]:
    """Yields every `data` item across every page of a PCO collection
    endpoint, following `links.next` until exhausted. `included` resources
    (from an `include=` param) are attached per-page onto each yielded
    item's own `_included` key isn't done here - callers that need
    `included` should read it off the raw page via included_pages()
    instead, since JSON:API's `included` array is page-scoped, not
    per-item."""
    query = dict(params or {})
    query.setdefault("per_page", 100)
    url: str | None = path
    first = True
    while url:
        page = get(url, params=query if first else None)
        first = False
        yield from page.get("data", [])
        url = page.get("links", {}).get("next")  # already a full URL, offset baked in


def paginate_with_included(
    path: str, params: dict[str, Any] | None = None
) -> Iterator[tuple[dict, dict[str, dict]]]:
    """Like paginate(), but also yields an `included_by_id` lookup
    (keyed by "{type}:{id}") built from that page's `included` array, so a
    caller using `include=emails,phone_numbers` etc. can resolve a person's
    related resources without a second request per person."""
    query = dict(params or {})
    query.setdefault("per_page", 100)
    url: str | None = path
    first = True
    while url:
        page = get(url, params=query if first else None)
        first = False
        included_by_id = {
            f"{item['type']}:{item['id']}": item for item in page.get("included", [])
        }
        for item in page.get("data", []):
            yield item, included_by_id
        url = page.get("links", {}).get("next")
