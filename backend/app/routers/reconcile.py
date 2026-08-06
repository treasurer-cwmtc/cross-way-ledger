import csv
import io

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_permission
from ..models import CategoryRule, ChartOfAccount, ReconciliationEntry, ReconLine, ReconRun
from ..schemas import (
    DuplicateCheckOut,
    ReconLineOut,
    ReconLineUpdate,
    ReconRunDetail,
    ReconRunOut,
    StripeFundCheckItem,
    StripeFundCheckOut,
)
from ..services.categorizer import Categorizer
from ..services.ledger import build_dedup_key, parse_date
from ..services.parsers import BankRow, parse_bank_csv, parse_stripe_csv
from ..services.reconciler import categorize_bank_only, merge_stripe, reconcile

router = APIRouter(
    prefix="/api", tags=["reconcile"], dependencies=[Depends(require_permission("upload"))]
)

EXPORT_COLUMNS = [
    ("transaction_date", "Transaction Date"),
    ("posted_date", "Posted Date"),
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
    stripe_file: UploadFile | None = File(None),
    bank_file_link: str = Form(""),
    stripe_file_link: str = Form(""),
    db: Session = Depends(get_db),
) -> ReconRun:
    bank_rows = parse_bank_csv(await _read_csv(bank_file))
    if not bank_rows:
        raise HTTPException(400, "Bank CSV had no usable rows.")

    rules = list(db.scalars(select(CategoryRule)).all())
    accounts = list(db.scalars(select(ChartOfAccount)).all())
    categorizer = Categorizer(rules, accounts)

    raw_income = round(sum(b.amount for b in bank_rows if b.amount > 0), 2)
    raw_expense = round(sum(b.amount for b in bank_rows if b.amount < 0), 2)

    if stripe_file is None:
        # Wizard step 1: bank file only - Stripe payout lines become
        # placeholders awaiting merge-stripe once that file is uploaded.
        result = categorize_bank_only(bank_rows, categorizer)
        stripe_filename = ""
        stripe_line_count = 0
        matched_payout_count = 0
        unmatched_stripe_bank_count = 0
    else:
        stripe_rows = parse_stripe_csv(await _read_csv(stripe_file))
        if not stripe_rows:
            raise HTTPException(400, "Stripe CSV had no usable rows.")
        result = reconcile(bank_rows, stripe_rows, categorizer)
        stripe_filename = stripe_file.filename or ""
        stripe_line_count = result.stripe_line_count
        matched_payout_count = result.matched_payout_count
        unmatched_stripe_bank_count = result.unmatched_stripe_bank_count

    run = ReconRun(
        bank_filename=bank_file.filename or "",
        stripe_filename=stripe_filename,
        bank_file_link=bank_file_link,
        stripe_file_link=stripe_file_link if stripe_file is not None else "",
        bank_line_count=result.bank_line_count,
        stripe_line_count=stripe_line_count,
        matched_payout_count=matched_payout_count,
        unmatched_stripe_bank_count=unmatched_stripe_bank_count,
        raw_bank_income_total=raw_income,
        raw_bank_expense_total=raw_expense,
    )
    run.lines = [ReconLine(**line.as_dict()) for line in result.lines]
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


@router.put("/reconcile/lines/{line_id}", response_model=ReconLineOut)
def update_line(
    line_id: int, payload: ReconLineUpdate, db: Session = Depends(get_db)
) -> ReconLine:
    line = db.get(ReconLine, line_id)
    if line is None:
        raise HTTPException(404, "Line not found.")
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(line, field, value.strip() if isinstance(value, str) else value)
    if "account_no" in data:
        # category/statement_description are baked-in columns on ReconLine
        # (unlike ReconciliationEntry, which derives them live from the COA
        # join at read time) - re-derive them here so they don't go stale
        # when the treasurer picks a different account in the wizard.
        account = db.scalars(
            select(ChartOfAccount).where(ChartOfAccount.account_no == data["account_no"])
        ).first()
        line.statement_description = account.statement_description if account else ""
        line.category = account.category if account else ""
        line.matched = bool(data["account_no"])
        if data["account_no"] and "notes" not in data:
            line.notes = ""
    db.commit()
    db.refresh(line)
    return line


@router.post("/reconcile/{run_id}/merge-stripe", response_model=ReconRunDetail)
async def merge_stripe_endpoint(
    run_id: int,
    stripe_file: UploadFile = File(...),
    stripe_file_link: str = Form(""),
    db: Session = Depends(get_db),
) -> ReconRun:
    """Wizard step 3: match the Stripe file against this run's bank-payout
    placeholders (from step 1), leaving every other line - including
    anything the user has edited - untouched."""
    run = db.get(ReconRun, run_id)
    if run is None:
        raise HTTPException(404, "Run not found.")

    stripe_rows = parse_stripe_csv(await _read_csv(stripe_file))
    if not stripe_rows:
        raise HTTPException(400, "Stripe CSV had no usable rows.")

    placeholders = [line for line in run.lines if line.is_stripe_payout]
    placeholder_bank_rows = [
        BankRow(
            details="",
            posting_date=line.posted_date,
            description=line.bank_description,
            amount=line.amount,
            type=line.method,
        )
        for line in placeholders
    ]

    rules = list(db.scalars(select(CategoryRule)).all())
    accounts = list(db.scalars(select(ChartOfAccount)).all())
    categorizer = Categorizer(rules, accounts)

    result = merge_stripe(placeholder_bank_rows, stripe_rows, categorizer)

    for line in placeholders:
        db.delete(line)
    for out_line in result.lines:
        db.add(ReconLine(run_id=run.id, **out_line.as_dict()))

    run.stripe_filename = stripe_file.filename or ""
    run.stripe_file_link = stripe_file_link
    run.stripe_line_count = result.stripe_line_count
    run.matched_payout_count = result.matched_payout_count
    run.unmatched_stripe_bank_count = result.unmatched_stripe_bank_count
    merged_totals = dict(run.bank_totals_by_day or {})
    merged_totals.update(result.bank_totals_by_day)
    run.bank_totals_by_day = merged_totals
    db.commit()
    db.refresh(run)
    return run


@router.post("/reconcile/{run_id}/recategorize", response_model=ReconRunDetail)
def recategorize_endpoint(run_id: int, db: Session = Depends(get_db)) -> ReconRun:
    """Re-applies bank-keyword rules to any still-uncategorized bank line,
    picking up rules added mid-wizard. Lines the user already set an account
    on (manually or previously) are untouched since they're no longer blank."""
    run = db.get(ReconRun, run_id)
    if run is None:
        raise HTTPException(404, "Run not found.")

    rules = list(db.scalars(select(CategoryRule)).all())
    accounts = list(db.scalars(select(ChartOfAccount)).all())
    categorizer = Categorizer(rules, accounts)

    for line in run.lines:
        if line.source == "bank" and not line.is_stripe_payout and not line.account_no:
            cat = categorizer.categorize_bank(line.bank_description)
            if cat.account_no:
                line.account_no = cat.account_no
                line.statement_description = cat.statement_description
                line.category = cat.category
                if cat.description:
                    line.description = cat.description
                line.matched = True
                line.notes = ""
    db.commit()
    db.refresh(run)
    return run


@router.post("/reconcile/stripe-fund-check", response_model=StripeFundCheckOut)
async def stripe_fund_check(
    stripe_file: UploadFile = File(...), db: Session = Depends(get_db)
) -> StripeFundCheckOut:
    """Stateless preview for wizard step 2: which donation funds in this
    Stripe file don't yet have a stripe_fund rule."""
    stripe_rows = parse_stripe_csv(await _read_csv(stripe_file))
    if not stripe_rows:
        raise HTTPException(400, "Stripe CSV had no usable rows.")

    rules = list(db.scalars(select(CategoryRule)).all())
    accounts = list(db.scalars(select(ChartOfAccount)).all())
    categorizer = Categorizer(rules, accounts)

    funds = sorted({r.fund for r in stripe_rows if r.is_donation and r.fund})
    items = []
    for fund in funds:
        cat = categorizer.categorize_fund(fund)
        items.append(
            StripeFundCheckItem(
                fund=fund, has_rule=bool(cat.account_no), account_no=cat.account_no
            )
        )
    return StripeFundCheckOut(
        funds=items, all_covered=all(item.has_rule for item in items)
    )


@router.get("/reconcile/{run_id}/duplicate-check", response_model=DuplicateCheckOut)
def duplicate_check(run_id: int, db: Session = Depends(get_db)) -> DuplicateCheckOut:
    """Wizard step 4: which of this run's current lines would be skipped as
    already-imported if pushed to Actual right now. Read-only - reuses the
    same dedup key the actual import endpoint checks against."""
    run = db.get(ReconRun, run_id)
    if run is None:
        raise HTTPException(404, "Run not found.")

    existing_keys = set(db.scalars(select(ReconciliationEntry.dedup_key)))
    duplicate_ids = []
    for line in run.lines:
        txn_date = parse_date(line.transaction_date)
        key = build_dedup_key(txn_date, line.amount, line.reference, line.bank_description)
        if key in existing_keys:
            duplicate_ids.append(line.id)
    return DuplicateCheckOut(duplicate_line_ids=duplicate_ids, count=len(duplicate_ids))


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
