"""Tests for the Asset Ledger (issue #113) - a standalone equipment/
inventory reference list, not linked to Chart of Accounts/General Ledger.

Run from the backend/ directory:  python -m pytest
"""

from test_auth import auth_header, client  # reuse shared TestClient/app setup


def test_create_list_update_delete_asset():
    h = auth_header()
    r = client.post(
        "/api/assets",
        headers=h,
        json={
            "purchase_date": "2026-06-01",
            "category": "Audio",
            "item": "Wireless mic set",
            "count": 2,
            "cost": 150.0,
            "notes": "For the sanctuary",
        },
    )
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["total"] == 300.0
    asset_id = created["id"]

    r = client.get("/api/assets", headers=h)
    assert r.status_code == 200, r.text
    ids = {a["id"] for a in r.json()}
    assert asset_id in ids

    r = client.put(
        f"/api/assets/{asset_id}",
        headers=h,
        json={"count": 3, "cost": 100.0},
    )
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["count"] == 3
    assert updated["cost"] == 100.0
    assert updated["total"] == 300.0  # 3 x 100

    r = client.delete(f"/api/assets/{asset_id}", headers=h)
    assert r.status_code == 204, r.text
    r = client.get("/api/assets", headers=h)
    assert asset_id not in {a["id"] for a in r.json()}


def test_update_missing_asset_404s():
    h = auth_header()
    r = client.put("/api/assets/999999", headers=h, json={"count": 5})
    assert r.status_code == 404


def test_categories_endpoint_lists_distinct_used_categories():
    h = auth_header()
    for category in ["Video", "Video", "Network"]:
        r = client.post(
            "/api/assets",
            headers=h,
            json={"category": category, "item": "Test item", "count": 1, "cost": 10.0},
        )
        assert r.status_code == 201, r.text

    r = client.get("/api/assets/categories", headers=h)
    assert r.status_code == 200, r.text
    categories = r.json()
    assert "Video" in categories
    assert "Network" in categories
    assert categories.count("Video") == 1  # distinct, not one per row


def test_assets_endpoints_require_auth():
    assert client.get("/api/assets").status_code == 401
    assert client.post("/api/assets", json={}).status_code == 401


def test_import_csv_creates_rows_and_skips_the_grand_total_row():
    h = auth_header()
    csv_text = (
        "Purchase Date,Category,Item,Count,Cost,Total\n"
        "1/15/2024,Kitchen,Commercial mixer,1,899.00,899.00\n"
        "3/2/2025,Computer,Laptop,2,650.00,1300.00\n"
        ",,,,,2199.00\n"  # the sheet's own running grand-total row
    )
    files = {"file": ("equipment.csv", csv_text, "text/csv")}
    r = client.post("/api/assets/import", headers=h, files=files)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["imported"] == 2
    assert body["skipped"] == 1

    r = client.get("/api/assets", headers=h)
    items = {a["item"] for a in r.json()}
    assert "Commercial mixer" in items
    assert "Laptop" in items
    laptop = next(a for a in r.json() if a["item"] == "Laptop")
    assert laptop["purchase_date"] == "2025-03-02"
    assert laptop["total"] == 1300.0
