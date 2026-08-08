from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_permission
from ..models import Asset
from ..schemas import AssetCreate, AssetImportResult, AssetOut, AssetUpdate
from ..services.ledger import parse_date
from ..services.parsers import parse_asset_csv

router = APIRouter(
    prefix="/api/assets",
    tags=["assets"],
    dependencies=[Depends(require_permission("assets"))],
)


def _to_out(a: Asset) -> AssetOut:
    return AssetOut(
        id=a.id,
        purchase_date=a.purchase_date,
        category=a.category,
        item=a.item,
        count=a.count,
        cost=a.cost,
        total=round(a.count * a.cost, 2),
        notes=a.notes,
        receipt_file_id=a.receipt_file_id,
        receipt_file_name=a.receipt_file_name,
        receipt_web_view_link=a.receipt_web_view_link,
    )


@router.get("", response_model=list[AssetOut])
def list_assets(db: Session = Depends(get_db)) -> list[AssetOut]:
    assets = db.scalars(
        select(Asset).order_by(Asset.purchase_date.desc().nulls_last(), Asset.id.desc())
    )
    return [_to_out(a) for a in assets]


@router.get("/categories", response_model=list[str])
def list_categories(db: Session = Depends(get_db)) -> list[str]:
    """Distinct categories already in use - powers the frontend's typeahead
    (free text, per the treasurer's own call, not a fixed dropdown)."""
    rows = db.scalars(
        select(Asset.category).where(Asset.category != "").distinct().order_by(Asset.category)
    )
    return list(rows)


@router.post("", response_model=AssetOut, status_code=201)
def create_asset(payload: AssetCreate, db: Session = Depends(get_db)) -> AssetOut:
    asset = Asset(**payload.model_dump())
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return _to_out(asset)


@router.put("/{asset_id}", response_model=AssetOut)
def update_asset(
    asset_id: int, payload: AssetUpdate, db: Session = Depends(get_db)
) -> AssetOut:
    asset = db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found.")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(asset, field, value.strip() if isinstance(value, str) else value)
    db.commit()
    db.refresh(asset)
    return _to_out(asset)


@router.delete("/{asset_id}", status_code=204)
def delete_asset(asset_id: int, db: Session = Depends(get_db)) -> None:
    asset = db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found.")
    db.delete(asset)
    db.commit()


@router.post("/import", response_model=AssetImportResult)
async def import_assets(
    file: UploadFile = File(...), db: Session = Depends(get_db)
) -> AssetImportResult:
    """Bulk-imports an exported copy of the Equipment List sheet (Purchase
    Date, Category, Item, Count, Cost columns - Total is derived, not
    imported). No dedup - unlike the transaction ledgers, there's no
    natural unique key for an equipment line, so re-importing the same
    export creates a second copy of everything. Skips a row entirely
    rather than guessing when it has neither a category nor an item -
    that's exactly the shape of the sheet's own running-grand-total row."""
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")

    rows = parse_asset_csv(text)
    imported = 0
    skipped = 0
    for row in rows:
        purchase_date = parse_date(row.purchase_date)
        if not row.item and not row.category:
            skipped += 1
            continue
        db.add(
            Asset(
                purchase_date=purchase_date,
                category=row.category,
                item=row.item,
                count=row.count,
                cost=row.cost,
            )
        )
        imported += 1
    db.commit()
    return AssetImportResult(imported=imported, skipped=skipped)
