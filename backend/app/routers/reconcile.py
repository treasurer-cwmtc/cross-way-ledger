import csv
import io

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import CategoryRule, ChartOfAccount, ReconLine, ReconRun
from ..schemas import ReconRunDetail, ReconRunOut
from ..services.categorizer import Categorizer
from ..services.parsers import parse_bank_csv, parse_stripe_csv
from ..services.reconciler import reconcile

router = APIRouter(prefix="/api", tags=["reconcile"])

EXPORT_COLUMNS = [
    ("transaction_date", "Transaction Date"),
    ("date_posted", "Date Posted"),
    ("description", "Description"),
    ("statement_description", "Statement Description"),
    ("account_no", "Account No"),
    ("category", "Category"),
    ("method", "Method"),
    ("amount", "Amount"),
    ("reference", "Check/Invoice Name"),
    ("bank_description", "Bank Description"),
    ("notes", "Notes"),
]


async def _read_csv(file: UploadFile) -> str:
    raw = await file.read()
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("latin-1")


@router.post("/reconcile", response_model=ReconRunDetail)
async def run_reconciliation(
    bank_file: UploadFile = File(...),
    stripe_file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> ReconRun:
    bank_rows = parse_bank_csv(await _read_csv(bank_file))
    stripe_rows = parse_stripe_csv(await _read_csv(stripe_file))
    if not bank_rows:
        raise HTTPException(400, "Bank CSV had no usable rows.")
    if not stripe_rows:
        raise HTTPException(400, "Stripe CSV had no usable rows.")

    rules = list(db.scalars(select(CategoryRule)).all())
    accounts = list(db.scalars(select(ChartOfAccount)).all())
    categorizer = Categorizer(rules, accounts)

    result = reconcile(bank_rows, stripe_rows, categorizer)

    run = ReconRun(
        bank_filename=bank_file.filename or "",
        stripe_filename=stripe_file.filename or "",
        bank_line_count=result.bank_line_count,
        stripe_line_count=result.stripe_line_count,
        matched_payout_count=result.matched_payout_count,
        unmatched_stripe_bank_count=result.unmatched_stripe_bank_count,
    )
    run.lines = [ReconLine(**line.as_dict()) for line in result.lines]
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


@router.get("/runs", response_model=list[ReconRunOut])
def list_runs(db: Session = Depends(get_db)) -> list[ReconRun]:
    return list(
        db.scalars(select(ReconRun).order_by(ReconRun.created_at.desc())).all()
    )


@router.get("/runs/{run_id}", response_model=ReconRunDetail)
def get_run(run_id: int, db: Session = Depends(get_db)) -> ReconRun:
    run = db.get(ReconRun, run_id)
    if run is None:
        raise HTTPException(404, "Run not found")
    return run


@router.get("/runs/{run_id}/export.csv")
def export_run(run_id: int, db: Session = Depends(get_db)) -> StreamingResponse:
    run = db.get(ReconRun, run_id)
    if run is None:
        raise HTTPException(404, "Run not found")

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([label for _, label in EXPORT_COLUMNS])
    for line in run.lines:
        writer.writerow([getattr(line, attr) for attr, _ in EXPORT_COLUMNS])
    buffer.seek(0)

    filename = f"reconciliation_run_{run_id}.csv"
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
