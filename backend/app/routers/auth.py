import logging
import secrets

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..deps import GRANTABLE_PERMISSIONS, get_current_user, require_admin
from ..models import User
from ..schemas import (
    GoogleLoginRequest,
    PasswordChange,
    Token,
    UserCreate,
    UserOut,
    UserPermissionsUpdate,
)
from ..security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])
settings = get_settings()
logger = logging.getLogger("app.auth")


@router.post("/login", response_model=Token)
def login(
    form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)
) -> Token:
    user = db.scalar(select(User).where(User.username == form.username))
    if user is None or not user.active or not verify_password(
        form.password, user.password_hash
    ):
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    token = create_access_token(user.username, user.is_admin)
    return Token(access_token=token)


@router.post("/google", response_model=Token)
def google_login(payload: GoogleLoginRequest, db: Session = Depends(get_db)) -> Token:
    """Sign in with a Google ID token (crosswaymtc.org only). The account
    must already exist - matched by email, added ahead of time on the Users
    page - unrecognized emails are rejected rather than auto-created."""
    try:
        # A few seconds of clock_skew tolerance - the library defaults to
        # zero, which is stricter than normal clock drift between this
        # machine and Google's servers actually allows for.
        claims = google_id_token.verify_oauth2_token(
            payload.id_token,
            google_requests.Request(),
            settings.google_client_id,
            clock_skew_in_seconds=10,
        )
    except ValueError as e:
        logger.warning("Google ID token verification failed: %s", e)
        raise HTTPException(status_code=401, detail="Invalid Google sign-in token.") from e

    email = claims.get("email", "")
    # Belt-and-suspenders: the OAuth consent screen is already restricted to
    # the Workspace domain, but verify the hd claim ourselves too rather than
    # relying solely on that console setting.
    if not claims.get("email_verified") or claims.get("hd") != settings.google_workspace_domain:
        raise HTTPException(
            status_code=403,
            detail=f"Only {settings.google_workspace_domain} Google accounts can sign in.",
        )

    user = db.scalar(select(User).where(User.email == email))
    if user is None or not user.active:
        raise HTTPException(
            status_code=403,
            detail="No account has been set up for this email. Contact your administrator.",
        )
    token = create_access_token(user.username, user.is_admin)
    return Token(access_token=token)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user


@router.post("/change-password", status_code=204)
def change_password(
    payload: PasswordChange,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(payload.new_password) < 8:
        raise HTTPException(
            status_code=400, detail="New password must be at least 8 characters"
        )
    user.password_hash = hash_password(payload.new_password)
    db.commit()


# --- Admin-only user management ---
@router.get("/users", response_model=list[UserOut])
def list_users(
    _: User = Depends(require_admin), db: Session = Depends(get_db)
) -> list[User]:
    return list(db.scalars(select(User).order_by(User.username)).all())


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(
    payload: UserCreate,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> User:
    if not payload.username.strip():
        raise HTTPException(status_code=400, detail="username is required")
    email = (payload.email or "").strip().lower() or None
    if payload.password is None and email is None:
        raise HTTPException(
            status_code=400, detail="Provide a password, an email, or both"
        )
    if payload.password is not None and len(payload.password) < 8:
        raise HTTPException(
            status_code=400, detail="password must be at least 8 characters"
        )
    if db.scalar(select(User).where(User.username == payload.username)):
        raise HTTPException(status_code=409, detail="username already exists")
    if email and db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="email already in use")
    unknown = set(payload.permissions) - GRANTABLE_PERMISSIONS
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown permission(s): {', '.join(unknown)}")

    # A Google-only account (no password given) still needs *some* stored
    # hash to satisfy the column - a random one nobody knows, so password
    # login is effectively disabled for it without a schema change.
    password_hash = hash_password(payload.password or secrets.token_hex(32))
    user = User(
        username=payload.username.strip(),
        email=email,
        password_hash=password_hash,
        permissions=list(payload.permissions),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.put("/users/{user_id}/permissions", response_model=UserOut)
def update_permissions(
    user_id: int,
    payload: UserPermissionsUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == admin.id and not payload.is_admin:
        raise HTTPException(status_code=400, detail="You cannot remove your own admin access")
    unknown = set(payload.permissions) - GRANTABLE_PERMISSIONS
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown permission(s): {', '.join(unknown)}")
    user.is_admin = payload.is_admin
    user.permissions = list(dict.fromkeys(payload.permissions))  # de-dup, keep order
    user.hide_donor_names = payload.hide_donor_names
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=204)
def deactivate_user(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> None:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="You cannot deactivate yourself")
    user.active = False
    db.commit()
