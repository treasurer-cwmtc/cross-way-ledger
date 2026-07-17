"""Google Sign-In: ID token verification, domain check, unknown-email
rejection - and the permission system it's paired with."""

from unittest.mock import patch

from test_auth import auth_header, client  # reuse the shared TestClient/app setup


def _fake_claims(email: str, hd: str = "crosswaymtc.org", email_verified: bool = True) -> dict:
    return {"email": email, "hd": hd, "email_verified": email_verified}


def _add_user(**overrides) -> dict:
    h = auth_header()
    payload = {"username": "googleuser", "email": "person@crosswaymtc.org"}
    payload.update(overrides)
    r = client.post("/api/auth/users", headers=h, json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def test_create_user_requires_password_or_email():
    h = auth_header()
    r = client.post("/api/auth/users", headers=h, json={"username": "nopass"})
    assert r.status_code == 400


def test_email_only_user_can_be_created_and_has_no_usable_password():
    user = _add_user(username="emailonly1", email="emailonly1@crosswaymtc.org")
    assert user["email"] == "emailonly1@crosswaymtc.org"
    assert user["permissions"] == []

    # Can't log in with a password - none was set, and the random one they
    # never received obviously won't match a blank/guessed attempt.
    r = client.post("/api/auth/login", data={"username": "emailonly1", "password": ""})
    assert r.status_code == 401


def test_google_login_succeeds_for_known_email():
    _add_user(username="knownemail", email="known@crosswaymtc.org")
    with patch("app.routers.auth.google_id_token.verify_oauth2_token") as mock_verify:
        mock_verify.return_value = _fake_claims("known@crosswaymtc.org")
        r = client.post("/api/auth/google", json={"id_token": "fake-token"})
    assert r.status_code == 200, r.text
    assert "access_token" in r.json()


def test_google_login_rejects_unknown_email():
    with patch("app.routers.auth.google_id_token.verify_oauth2_token") as mock_verify:
        mock_verify.return_value = _fake_claims("nobody-added-this@crosswaymtc.org")
        r = client.post("/api/auth/google", json={"id_token": "fake-token"})
    assert r.status_code == 403


def test_google_login_rejects_wrong_domain():
    _add_user(username="wrongdomain", email="wrongdomain@crosswaymtc.org")
    with patch("app.routers.auth.google_id_token.verify_oauth2_token") as mock_verify:
        mock_verify.return_value = _fake_claims("wrongdomain@gmail.com", hd="gmail.com")
        r = client.post("/api/auth/google", json={"id_token": "fake-token"})
    assert r.status_code == 403


def test_google_login_rejects_invalid_token():
    with patch("app.routers.auth.google_id_token.verify_oauth2_token") as mock_verify:
        mock_verify.side_effect = ValueError("bad token")
        r = client.post("/api/auth/google", json={"id_token": "garbage"})
    assert r.status_code == 401


def test_permission_gate_blocks_then_allows_after_grant():
    h = auth_header()
    created = client.post(
        "/api/auth/users",
        headers=h,
        json={"username": "limiteduser", "password": "supersecret1", "permissions": []},
    ).json()
    limited_header = auth_header("limiteduser", "supersecret1")

    # No "accrual" permission yet.
    assert client.get("/api/accrual", headers=limited_header).status_code == 403

    grant = client.put(
        f"/api/auth/users/{created['id']}/permissions",
        headers=h,
        json={"permissions": ["accrual"], "is_admin": False},
    )
    assert grant.status_code == 200, grant.text
    assert grant.json()["permissions"] == ["accrual"]

    # Now allowed.
    assert client.get("/api/accrual", headers=limited_header).status_code == 200
    # But still blocked from a different page's data.
    assert client.get("/api/budget", headers=limited_header).status_code == 403


def test_permissions_endpoint_rejects_unknown_key():
    h = auth_header()
    created = client.post(
        "/api/auth/users",
        headers=h,
        json={"username": "badpermuser", "password": "supersecret1"},
    ).json()
    r = client.put(
        f"/api/auth/users/{created['id']}/permissions",
        headers=h,
        json={"permissions": ["not-a-real-page"], "is_admin": False},
    )
    assert r.status_code == 400


def test_admin_cannot_remove_own_admin_status():
    h = auth_header()
    me = client.get("/api/auth/me", headers=h).json()
    r = client.put(
        f"/api/auth/users/{me['id']}/permissions",
        headers=h,
        json={"permissions": [], "is_admin": False},
    )
    assert r.status_code == 400


def test_admin_can_promote_another_user_to_admin():
    h = auth_header()
    created = client.post(
        "/api/auth/users",
        headers=h,
        json={"username": "futureadmin", "password": "supersecret1"},
    ).json()
    r = client.put(
        f"/api/auth/users/{created['id']}/permissions",
        headers=h,
        json={"permissions": [], "is_admin": True},
    )
    assert r.status_code == 200, r.text
    assert r.json()["is_admin"] is True


def test_shared_lookups_stay_open_regardless_of_page_permissions():
    """GET /api/accounts and /api/bank-accounts are used by every ledger
    page's pickers - they must stay reachable by any authenticated user,
    not just someone with the "accounts"/"config" permission."""
    h = auth_header()
    created = client.post(
        "/api/auth/users",
        headers=h,
        json={"username": "readonlylookups", "password": "supersecret1", "permissions": []},
    ).json()
    limited_header = auth_header("readonlylookups", "supersecret1")

    assert client.get("/api/accounts", headers=limited_header).status_code == 200
    assert client.get("/api/bank-accounts", headers=limited_header).status_code == 200

    # But mutating Chart of Accounts / bank accounts still requires the
    # "accounts"/"config" permission specifically.
    assert (
        client.post(
            "/api/accounts/statement-categories",
            headers=limited_header,
            json={"category": "Income", "name": "Test"},
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/bank-accounts", headers=limited_header, json={"name": "Test Bank"}
        ).status_code
        == 403
    )
    assert created["id"] > 0
