"""Reimbursements module: PCO People import/upsert, assignment validation,
the OTP login flow (submitter auth is deliberately separate from the app's
normal login), the submission wizard's Accrual-entry linkage, and the
Pending-only edit/reject/approve lifecycle rules."""

from unittest.mock import patch

from test_auth import auth_header, client  # reuse the shared TestClient/app setup

PCO_CSV = """Person ID,Name,Primary Email,Primary Phone Number
1001,Jane Doe,jane@example.com,(214) 555-1111
1002,John Smith,john@example.com,(214) 555-2222
"""


def _import_pco_people(csv_text: str = PCO_CSV) -> dict:
    h = auth_header()
    files = {"people_file": ("people.csv", csv_text.encode(), "text/csv")}
    r = client.post("/api/reimbursements/pco-people/import", headers=h, files=files)
    assert r.status_code == 200, r.text
    return r.json()


def _assign(email: str, account_nos: list[str]) -> dict:
    h = auth_header()
    r = client.put(
        f"/api/reimbursements/assignments?email={email}",
        headers=h,
        json={"account_nos": account_nos},
    )
    assert r.status_code == 200, r.text
    return r.json()


def _login(email: str) -> str:
    """Requests + verifies an OTP for `email`, returning the submitter
    bearer token - mirrors the real flow but reads the raw code back out of
    the DB via the email-sending mock instead of an actual inbox."""
    with patch("app.routers.reimbursements.send_email") as mock_send:
        r = client.post("/api/reimbursements/request-otp", json={"email": email})
        assert r.status_code == 200, r.text
        assert mock_send.called
        body = mock_send.call_args.args[2]
    code = "".join(ch for ch in body.split("code is:")[1].split("\n")[0] if ch.isdigit())
    r = client.post("/api/reimbursements/verify-otp", json={"email": email, "code": code})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _submitter_header(email: str) -> dict:
    return {"Authorization": f"Bearer {_login(email)}"}


def test_pco_people_import_is_upserted_by_person_id():
    result = _import_pco_people()
    assert result["people_imported"] == 2

    h = auth_header()
    people = {p["person_id"]: p for p in client.get("/api/reimbursements/pco-people", headers=h).json()}
    assert people["1001"]["email"] == "jane@example.com"

    # Re-importing with an updated name upserts, not duplicates.
    updated_csv = PCO_CSV.replace("Jane Doe", "Jane D. Doe")
    _import_pco_people(updated_csv)
    h = auth_header()
    people_after = {p["person_id"]: p for p in client.get("/api/reimbursements/pco-people", headers=h).json()}
    assert people_after["1001"]["name"] == "Jane D. Doe"
    assert len(people_after) == len(people)


def test_assignment_rejects_email_not_in_pco_people():
    h = auth_header()
    r = client.put(
        "/api/reimbursements/assignments?email=typo@example.com",
        headers=h,
        json={"account_nos": ["I101210"]},
    )
    assert r.status_code == 400


def test_assignment_save_is_replace_all_for_email():
    _import_pco_people()
    _assign("jane@example.com", ["I101210", "E151910"])
    h = auth_header()
    rows = client.get("/api/reimbursements/assignments?email=jane@example.com", headers=h).json()
    assert {r["account_no"] for r in rows} == {"I101210", "E151910"}

    # Replacing with a smaller list drops the one no longer desired.
    _assign("jane@example.com", ["I101210"])
    rows_after = client.get("/api/reimbursements/assignments?email=jane@example.com", headers=h).json()
    assert {r["account_no"] for r in rows_after} == {"I101210"}


def test_otp_login_rejects_email_not_in_pco_people():
    r = client.post("/api/reimbursements/request-otp", json={"email": "nobody@example.com"})
    assert r.status_code == 200  # deliberately generic - doesn't leak membership
    assert "message" in r.json()

    r2 = client.post("/api/reimbursements/verify-otp", json={"email": "nobody@example.com", "code": "000000"})
    assert r2.status_code == 401


def test_otp_login_succeeds_for_pco_person_and_rejects_wrong_code():
    _import_pco_people()
    with patch("app.routers.reimbursements.send_email") as mock_send:
        r = client.post("/api/reimbursements/request-otp", json={"email": "john@example.com"})
        assert r.status_code == 200
        body = mock_send.call_args.args[2]
    real_code = "".join(ch for ch in body.split("code is:")[1].split("\n")[0] if ch.isdigit())

    wrong = "0" * 6 if real_code != "0" * 6 else "1" * 6
    r_wrong = client.post("/api/reimbursements/verify-otp", json={"email": "john@example.com", "code": wrong})
    assert r_wrong.status_code == 401

    r_right = client.post("/api/reimbursements/verify-otp", json={"email": "john@example.com", "code": real_code})
    assert r_right.status_code == 200, r_right.text
    assert r_right.json()["name"] == "John Smith"

    # Codes are single-use - the same code can't be replayed.
    r_replay = client.post("/api/reimbursements/verify-otp", json={"email": "john@example.com", "code": real_code})
    assert r_replay.status_code == 401


def test_submitter_endpoints_reject_missing_or_invalid_token():
    assert client.get("/api/reimbursements/my/coas").status_code == 401
    assert client.get(
        "/api/reimbursements/my/coas", headers={"Authorization": "Bearer garbage"}
    ).status_code == 401


def test_submission_creates_accrual_entries_and_dashboard_kpi_reflects_it():
    _import_pco_people()
    _assign("jane@example.com", ["I101210", "E151910"])
    h_submitter = _submitter_header("jane@example.com")

    with patch("app.routers.reimbursements.send_email_best_effort"):
        r = client.post(
            "/api/reimbursements/my",
            headers=h_submitter,
            json={
                "lines": [
                    {"account_no": "I101210", "amount": 42.50, "description": "Supplies"},
                    {"account_no": "E151910", "amount": 10.00, "description": "Gas"},
                ]
            },
        )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "pending"
    assert round(body["total_amount"], 2) == 52.50
    assert len(body["lines"]) == 2

    h = auth_header()
    accrual_entries = client.get("/api/accrual", headers=h).json()
    reimbursement_descs = {e["description"] for e in accrual_entries if e["is_reimbursement"]}
    assert "Supplies" in reimbursement_descs
    assert "Gas" in reimbursement_descs

    dashboard = client.get("/api/dashboard", headers=h).json()
    assert dashboard["outstanding_reimbursements_count"] >= 1
    assert dashboard["outstanding_reimbursements_total"] >= 52.50


def test_submission_line_transaction_date_flows_to_accrual_entry():
    """Regression test: a submitter-supplied transaction_date should land
    on the linked AccrualEntry instead of always defaulting to today - see
    services/reimbursements.create_accrual_entries."""
    _import_pco_people()
    _assign("jane@example.com", ["I101210"])
    h_submitter = _submitter_header("jane@example.com")

    with patch("app.routers.reimbursements.send_email_best_effort"):
        r = client.post(
            "/api/reimbursements/my",
            headers=h_submitter,
            json={
                "lines": [
                    {
                        "account_no": "I101210",
                        "amount": 15.0,
                        "description": "Backdated expense",
                        "transaction_date": "2026-01-15",
                    }
                ]
            },
        )
    assert r.status_code == 201, r.text
    assert r.json()["lines"][0]["transaction_date"] == "2026-01-15"

    h = auth_header()
    entries = client.get("/api/accrual", headers=h).json()
    matching = [e for e in entries if e["description"] == "Backdated expense"]
    assert len(matching) == 1
    assert matching[0]["transaction_date"] == "2026-01-15"


def test_submission_rejects_unauthorized_account():
    _import_pco_people()
    _assign("jane@example.com", ["I101210"])
    h_submitter = _submitter_header("jane@example.com")

    r = client.post(
        "/api/reimbursements/my",
        headers=h_submitter,
        json={"lines": [{"account_no": "E151910", "amount": 5.0}]},
    )
    assert r.status_code == 403


def test_marking_paid_sets_accrual_posted_date():
    """Regression test: the linked AccrualEntry only gets a transaction_date
    at submission, not a posted_date - the Accrual page's year filter treats
    a null posted_date as "not in any year" and has no "all years" option,
    so every reimbursement entry was invisible there until marked Paid.
    Fixed by setting posted_date when the status transitions to paid."""
    # Uses john@example.com, not jane@example.com - the latter already logs
    # in via _login several times elsewhere in this file, and each login
    # consumes one of OTP_RATE_LIMIT_PER_HOUR's 5 slots against the same
    # shared test DB; adding a 6th call here made a later, unrelated test's
    # OTP request get rate-limited instead of actually sending.
    _import_pco_people()
    _assign("john@example.com", ["I101210"])
    h_submitter = _submitter_header("john@example.com")

    with patch("app.routers.reimbursements.send_email_best_effort"):
        created = client.post(
            "/api/reimbursements/my",
            headers=h_submitter,
            json={"lines": [{"account_no": "I101210", "amount": 17.0}]},
        ).json()

    h = auth_header()
    accrual_id = next(
        e["id"] for e in client.get("/api/accrual", headers=h).json()
        if e["is_reimbursement"] and e["amount"] == 17.0
    )
    assert client.get("/api/accrual", headers=h).json()
    before = next(e for e in client.get("/api/accrual", headers=h).json() if e["id"] == accrual_id)
    assert before["posted_date"] is None

    with patch("app.routers.reimbursements.send_email_best_effort"):
        paid = client.put(
            f"/api/reimbursements/{created['id']}/status",
            headers=h,
            json={"status": "paid"},
        )
    assert paid.status_code == 200, paid.text

    after = next(e for e in client.get("/api/accrual", headers=h).json() if e["id"] == accrual_id)
    assert after["posted_date"] is not None


def test_reject_deletes_accrual_entries_and_approve_locks_edits():
    _import_pco_people()
    _assign("jane@example.com", ["I101210"])
    h_submitter = _submitter_header("jane@example.com")

    with patch("app.routers.reimbursements.send_email_best_effort"):
        created = client.post(
            "/api/reimbursements/my",
            headers=h_submitter,
            json={"lines": [{"account_no": "I101210", "amount": 20.0}]},
        ).json()

    h = auth_header()
    detail = client.get(f"/api/reimbursements/{created['id']}", headers=h).json()
    accrual_id = None
    for e in client.get("/api/accrual", headers=h).json():
        if e["is_reimbursement"] and e["amount"] == 20.0:
            accrual_id = e["id"]
    assert accrual_id is not None

    # Approve locks the submitter out of further edits.
    with patch("app.routers.reimbursements.send_email_best_effort"):
        approved = client.put(
            f"/api/reimbursements/{created['id']}/status",
            headers=h,
            json={"status": "approved"},
        )
    assert approved.status_code == 200, approved.text

    edit_attempt = client.put(
        f"/api/reimbursements/my/{created['id']}",
        headers=h_submitter,
        json={"lines": [{"account_no": "I101210", "amount": 999.0}]},
    )
    assert edit_attempt.status_code == 409

    # A separate, still-Pending request: rejecting it deletes its Accrual entry.
    with patch("app.routers.reimbursements.send_email_best_effort"):
        second = client.post(
            "/api/reimbursements/my",
            headers=h_submitter,
            json={"lines": [{"account_no": "I101210", "amount": 33.0}]},
        ).json()
        rejected = client.put(
            f"/api/reimbursements/{second['id']}/status",
            headers=h,
            json={"status": "rejected"},
        )
    assert rejected.status_code == 200, rejected.text
    accrual_amounts = [e["amount"] for e in client.get("/api/accrual", headers=h).json() if e["is_reimbursement"]]
    assert 33.0 not in accrual_amounts
    assert detail["status"] == "pending"  # captured before the transitions above


def test_submitter_my_list_does_not_collide_with_treasurer_route():
    """Regression test: GET /api/reimbursements/my (submitter's own list)
    was silently matching the earlier-declared, untyped
    GET /api/reimbursements/{reimbursement_id} (treasurer) route - Starlette
    matches path *shape* in declaration order and treated "my" as a valid
    value for an untyped path param. That route requires the internal
    require_permission("reimbursements") dependency, which always rejects a
    submitter token (no "sub" claim) - so every real submitter, after
    logging in successfully, immediately got a 401 "Could not validate
    credentials" the moment the portal tried to load their request list,
    which the frontend's error handler treated as a dead session and wiped
    the (perfectly valid) submitter token. Fixed by typing the treasurer
    route as {reimbursement_id:int}."""
    _import_pco_people()
    _assign("jane@example.com", ["I101210"])
    h_submitter = _submitter_header("jane@example.com")

    r = client.get("/api/reimbursements/my", headers=h_submitter)
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)

    # The treasurer's numeric-id route must still work normally.
    h = auth_header()
    with patch("app.routers.reimbursements.send_email_best_effort"):
        created = client.post(
            "/api/reimbursements/my",
            headers=h_submitter,
            json={"lines": [{"account_no": "I101210", "amount": 12.0}]},
        ).json()
    assert client.get(f"/api/reimbursements/{created['id']}", headers=h).status_code == 200
