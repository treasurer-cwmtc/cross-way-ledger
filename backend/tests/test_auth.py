"""Auth + protected-endpoint tests using FastAPI TestClient."""

import os

os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("ADMIN_USERNAME", "admin")
os.environ.setdefault("ADMIN_PASSWORD", "admin-password")

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app import database  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402

# Tests run against a real Postgres instance - same database engine as every
# real environment (dev/staging/prod) - not SQLite. Point this at a throwaway
# Postgres, e.g. `docker compose up -d db` then
# DATABASE_URL=postgresql+psycopg://recon:recon@localhost:5432/ledger_db pytest
database_url = os.environ.get("DATABASE_URL")
if not database_url:
    raise RuntimeError(
        "DATABASE_URL must be set to a real Postgres instance to run tests "
        "(see docs/DEPLOYMENT.md) - there is no SQLite fallback."
    )

# Use a single shared Postgres DB for the app under test, reset fresh below.
engine = create_engine(database_url, future=True)
TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base.metadata.drop_all(engine)
Base.metadata.create_all(engine)


def override_get_db():
    db = TestingSession()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db

# Seed into the test DB (mirrors startup lifespan, which TestClient also runs).
from app.seed import seed  # noqa: E402

with TestingSession() as _db:
    seed(_db)

client = TestClient(app)


def auth_header(username="admin", password="admin-password"):
    r = client.post(
        "/api/auth/login", data={"username": username, "password": password}
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_health_is_public():
    assert client.get("/api/health").status_code == 200


def test_protected_endpoint_requires_auth():
    assert client.get("/api/rules").status_code == 401
    assert client.get("/api/accounts").status_code == 401


def test_login_and_access():
    h = auth_header()
    r = client.get("/api/rules", headers=h)
    assert r.status_code == 200


def test_bad_login_rejected():
    r = client.post(
        "/api/auth/login", data={"username": "admin", "password": "wrong"}
    )
    assert r.status_code == 401


def test_me_returns_admin():
    r = client.get("/api/auth/me", headers=auth_header())
    assert r.status_code == 200
    body = r.json()
    assert body["username"] == "admin"
    assert body["is_admin"] is True


def test_admin_can_create_user_and_new_user_logs_in():
    h = auth_header()
    r = client.post(
        "/api/auth/users",
        headers=h,
        json={"username": "treasurer", "password": "supersecret1", "is_admin": False},
    )
    assert r.status_code == 201, r.text

    # New user can log in and reach protected data.
    h2 = auth_header("treasurer", "supersecret1")
    assert client.get("/api/accounts", headers=h2).status_code == 200

    # Non-admin cannot manage users.
    assert client.get("/api/auth/users", headers=h2).status_code == 403
    assert (
        client.post(
            "/api/auth/users",
            headers=h2,
            json={"username": "x", "password": "supersecret1"},
        ).status_code
        == 403
    )


def test_duplicate_username_rejected():
    h = auth_header()
    client.post(
        "/api/auth/users",
        headers=h,
        json={"username": "dupe", "password": "supersecret1"},
    )
    r = client.post(
        "/api/auth/users",
        headers=h,
        json={"username": "dupe", "password": "supersecret1"},
    )
    assert r.status_code == 409
