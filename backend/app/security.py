"""Password hashing (stdlib PBKDF2) and JWT creation/verification."""

from __future__ import annotations

import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone

import jwt

from .config import get_settings

settings = get_settings()

_ALGO = "HS256"
_PBKDF2_ROUNDS = 200_000


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${_PBKDF2_ROUNDS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, rounds, salt_hex, hash_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt_hex), int(rounds)
        )
        return hmac.compare_digest(dk.hex(), hash_hex)
    except (ValueError, TypeError):
        return False


def create_access_token(subject: str, is_admin: bool) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "admin": is_admin,
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=_ALGO)


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.secret_key, algorithms=[_ALGO])


# --- Reimbursement submitter tokens ---
# A parallel, deliberately separate token kind for the Reimbursements portal:
# submitters are never rows in the `users` table (see PcoPerson in models.py),
# so reusing create_access_token/decode_access_token - which assume `sub`
# resolves to a real user - would mean either faking a User row or threading
# submitter-specific branches into the auth path every other route depends
# on. Same signing key/algorithm, but a distinct `typ` claim keeps the two
# token kinds from being accepted interchangeably (see deps.get_current_user
# vs deps.get_current_submitter).
_SUBMITTER_TOKEN_TYPE = "submitter"
SUBMITTER_TOKEN_EXPIRE_MINUTES = 60 * 24


def create_submitter_token(email: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "typ": _SUBMITTER_TOKEN_TYPE,
        "email": email,
        "iat": now,
        "exp": now + timedelta(minutes=SUBMITTER_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=_ALGO)


def decode_submitter_token(token: str) -> str:
    """Returns the submitter's email, or raises jwt.PyJWTError if the token
    is invalid/expired/not actually a submitter token."""
    payload = jwt.decode(token, settings.secret_key, algorithms=[_ALGO])
    if payload.get("typ") != _SUBMITTER_TOKEN_TYPE:
        raise jwt.InvalidTokenError("Not a reimbursement submitter token.")
    return payload["email"]
