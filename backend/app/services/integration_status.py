"""Shared last-error tracking for every external API integration (Planning
Center People/Giving/Pledge Form, Stripe, Plaid), backing the Setup >
Integrations Status page (see routers/integrations.py). Reuses the
AppSetting key/value table rather than a new table - each integration
already has its own "<x>_last_synced_at" key (one per router, e.g.
stripe_sync.py's LAST_SYNCED_KEY); this only adds a sibling
"<x>_last_error"/"<x>_last_error_at" pair, written from each router's
existing try/except around its live API call. Kept as its own tiny module
(not folded into any one router) since every sync router calls into it,
and routers should never import each other.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ..models import AppSetting

_ERROR_SUFFIX = "_last_error"
_ERROR_AT_SUFFIX = "_last_error_at"


def _base_key(last_synced_key: str) -> str:
    return last_synced_key.removesuffix("_last_synced_at")


def _upsert(db: Session, key: str, value: str) -> None:
    setting = db.get(AppSetting, key)
    if setting is None:
        db.add(AppSetting(key=key, value=value))
    else:
        setting.value = value


def record_failure(db: Session, last_synced_key: str, message: str) -> None:
    """last_synced_key is the integration's existing "<x>_last_synced_at"
    AppSetting key - the error pair is derived from it (swap the suffix) so
    every router only has to know its own one existing key, not a second
    error-tracking scheme to keep straight. Truncated to fit AppSetting.
    value's String(300) column. Caller is responsible for db.commit()."""
    base = _base_key(last_synced_key)
    now_iso = datetime.now(tz=timezone.utc).isoformat()
    _upsert(db, base + _ERROR_SUFFIX, message[:290])
    _upsert(db, base + _ERROR_AT_SUFFIX, now_iso)


def clear_failure(db: Session, last_synced_key: str) -> None:
    """Called right alongside a successful sync's own last_synced_at write -
    a fresh success supersedes any previously recorded error. Caller is
    responsible for db.commit()."""
    base = _base_key(last_synced_key)
    for key in (base + _ERROR_SUFFIX, base + _ERROR_AT_SUFFIX):
        existing = db.get(AppSetting, key)
        if existing is not None:
            db.delete(existing)


def read_status(db: Session, last_synced_key: str) -> tuple[str | None, str | None, str | None]:
    """Returns (last_synced_at, last_error, last_error_at) for one
    integration - all three None if it's never been synced or failed."""
    base = _base_key(last_synced_key)
    synced = db.get(AppSetting, last_synced_key)
    error = db.get(AppSetting, base + _ERROR_SUFFIX)
    error_at = db.get(AppSetting, base + _ERROR_AT_SUFFIX)
    return (
        synced.value if synced else None,
        error.value if error else None,
        error_at.value if error_at else None,
    )
