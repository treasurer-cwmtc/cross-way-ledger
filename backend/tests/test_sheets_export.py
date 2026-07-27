"""Google-Sheets-facing General Ledger export: Google ID token
verification, permission gating, and that it returns the same data as the
regular /api/general-ledger route."""

from unittest.mock import patch

from test_auth import auth_header, client


def _fake_claims(email: str, hd: str = "crosswaymtc.org", email_verified: bool = True) -> dict:
    return {"email": email, "hd": hd, "email_verified": email_verified}


def _add_user(**overrides) -> dict:
    h = auth_header()
    payload = {"username": "sheetsuser", "email": "sheetsuser@crosswaymtc.org", "permissions": ["general-ledger"]}
    payload.update(overrides)
    r = client.post("/api/auth/users", headers=h, json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def test_sheets_export_requires_authorization_header():
    r = client.get("/api/sheets/general-ledger")
    assert r.status_code == 401


def test_sheets_export_rejects_invalid_token():
    with patch("app.routers.sheets_export.google_id_token.verify_oauth2_token") as mock_verify:
        mock_verify.side_effect = ValueError("bad token")
        r = client.get("/api/sheets/general-ledger", headers={"Authorization": "Bearer garbage"})
    assert r.status_code == 401


def test_sheets_export_rejects_wrong_domain():
    with patch("app.routers.sheets_export.google_id_token.verify_oauth2_token") as mock_verify:
        mock_verify.return_value = _fake_claims("someone@gmail.com", hd="gmail.com")
        r = client.get("/api/sheets/general-ledger", headers={"Authorization": "Bearer fake"})
    assert r.status_code == 403


def test_sheets_export_rejects_unknown_email():
    with patch("app.routers.sheets_export.google_id_token.verify_oauth2_token") as mock_verify:
        mock_verify.return_value = _fake_claims("nobody-added-this@crosswaymtc.org")
        r = client.get("/api/sheets/general-ledger", headers={"Authorization": "Bearer fake"})
    assert r.status_code == 403


def test_sheets_export_rejects_user_without_general_ledger_permission():
    _add_user(username="nopermsheets", email="nopermsheets@crosswaymtc.org", permissions=[])
    with patch("app.routers.sheets_export.google_id_token.verify_oauth2_token") as mock_verify:
        mock_verify.return_value = _fake_claims("nopermsheets@crosswaymtc.org")
        r = client.get("/api/sheets/general-ledger", headers={"Authorization": "Bearer fake"})
    assert r.status_code == 403


def test_sheets_export_succeeds_and_matches_regular_endpoint():
    _add_user(username="glsheetsuser", email="glsheetsuser@crosswaymtc.org", permissions=["general-ledger"])
    h = auth_header()
    regular = client.get("/api/general-ledger", headers=h)
    assert regular.status_code == 200

    with patch("app.routers.sheets_export.google_id_token.verify_oauth2_token") as mock_verify:
        mock_verify.return_value = _fake_claims("glsheetsuser@crosswaymtc.org")
        via_sheets = client.get(
            "/api/sheets/general-ledger", headers={"Authorization": "Bearer fake"}
        )
    assert via_sheets.status_code == 200, via_sheets.text
    assert via_sheets.json() == regular.json()


def test_sheets_export_admin_bypasses_permission_check():
    created = _add_user(username="adminviasheets", email="adminviasheets@crosswaymtc.org", permissions=[])
    h = auth_header()
    client.put(
        f"/api/auth/users/{created['id']}/permissions",
        headers=h,
        json={"permissions": [], "is_admin": True},
    )
    with patch("app.routers.sheets_export.google_id_token.verify_oauth2_token") as mock_verify:
        mock_verify.return_value = _fake_claims("adminviasheets@crosswaymtc.org")
        r = client.get("/api/sheets/general-ledger", headers={"Authorization": "Bearer fake"})
    assert r.status_code == 200, r.text
