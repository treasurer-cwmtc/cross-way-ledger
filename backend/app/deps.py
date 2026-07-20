"""FastAPI dependencies for authentication / authorization."""

from __future__ import annotations

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import get_db
from .models import User
from .security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")

_CREDS_EXC = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    try:
        payload = decode_access_token(token)
        username = payload.get("sub")
        if not username:
            raise _CREDS_EXC
    except jwt.PyJWTError:
        raise _CREDS_EXC

    user = db.scalar(select(User).where(User.username == username))
    if user is None or not user.active:
        raise _CREDS_EXC
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user


# Every grantable page permission - matches the frontend Tab values exactly.
# "home" isn't here (always visible) and "users" isn't here (admin-only,
# never grantable - see require_admin).
GRANTABLE_PERMISSIONS = {
    "upload",
    "reconciliation",
    "accrual",
    "budget",
    "general-ledger",
    "income-statement",
    "rules",
    "accounts",
    "link-receipts",
    "config",
    "pledge-campaign-status",
    "pledge-campaign-pledges",
    "pledge-campaign-actuals",
    "donors",
}


def require_permission(key: str):
    """Gate a route behind a page-permission key (e.g. "accrual"). Admins
    bypass this entirely - the grantable permission list only applies to
    everyone else."""

    def _check(user: User = Depends(get_current_user)) -> User:
        if user.is_admin or key in (user.permissions or []):
            return user
        raise HTTPException(status_code=403, detail="You don't have access to this page.")

    return _check


def require_any_permission(*keys: str):
    """Like require_permission, but passes if the user holds any one of
    several keys - e.g. the donor lookup is used both by the Donors config
    page and by the Pledges page's donor picker, each gated separately."""

    def _check(user: User = Depends(get_current_user)) -> User:
        if user.is_admin or set(keys) & set(user.permissions or []):
            return user
        raise HTTPException(status_code=403, detail="You don't have access to this page.")

    return _check
