import csv
import io
import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_permission
from ..models import (
    CategoryRule,
    ChartOfAccount,
    PlaidTransaction,
    ReconciliationEntry,
    ReconLine,
    ReconRun,
    StripeTransaction,
)
from ..schemas import (
    DuplicateCheckOut,
    ReconLineOut,
    ReconLineUpdate,
    ReconRunDetail,
    ReconRunOut,
    StripeFundCheckItem,
    StripeFundCheckOut,
    SyncStatusOut,
)
from ..services.categorizer import Categorizer
from ..services.ledger import build_dedup_key, parse_date
from ..services.parsers import BankRow, parse_bank_csv, parse_fund_breakdown_from_description
from ..services.plaid_client import to_bank_row
from ..services.reconciler import categorize_bank_only, merge_stripe
from ..services.stripe_sync import to_stripe_row

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


@router.get("/reconcile/sync-status", response_model=SyncStatusOut)
def sync_status(db: Session = Depends(get_db)) -> SyncStatusOut:
    """The most recent transaction date already sitting in each staging
    table (not when a sync last *ran* - see /api/plaid/transactions and
    /api/stripe/transactions for that) - powers the new Reconciliation
    page's date-range picker. Dates are plain M/D/YYYY strings (matching
    the manual-CSV convention everywhere else in this schema), so max() at
    the SQL level would sort them wrong - fetched and compared with
    parse_date() in Python instead. Cheap: only the date column, not full
    rows."""
    bank_dates = [
        d for (d,) in db.execute(
            select(PlaidTransaction.posting_date).where(PlaidTransaction.removed.is_(False))
        ).all()
    ]
    stripe_dates = [d for (d,) in db.execute(select(StripeTransaction.created)).all()]

    def _latest(raw_dates: list[str]) -> str | None:
        parsed = [(parse_date(d), d) for d in raw_dates if parse_date(d)]
        if not parsed:
            return None
        return max(parsed, key=lambda pair: pair[0])[1]

    # ledger_actual.posted_date is a real Date column (unlike the two above,
    # which are still raw M/D/YYYY strings) - a plain MAX() works directly,
    # same pattern as dashboard.py's last_posted_date.
    actual_last_posted = db.scalar(
        select(ReconciliationEntry.posted_date)
        .where(ReconciliationEntry.posted_date.is_not(None))
        .order_by(ReconciliationEntry.posted_date.desc())
        .limit(1)
    )

    return SyncStatusOut(
        bank_last_posted=_latest(bank_dates),
        stripe_last_posted=_latest(stripe_dates),
        actual_last_posted=actual_last_posted.isoformat() if actual_last_posted else None,
    )


@router.post("/reconcile/from-bank-sync", response_model=ReconRunDetail)
def start_from_bank_sync(
    start_date: str, end_date: str, db: Session = Depends(get_db)
) -> ReconRun:
    """The Reconciliation page's Step 1, replacing a manual bank-file
    upload with the already-synced ledger_plaid staging table - same
    downstream shape as run_reconciliation() below (categorize_bank_only(),
    a fresh ReconRun), just a different source for the BankRow list.
    start_date/end_date are plain YYYY-MM-DD strings from the frontend's
    date picker."""
    start = parse_date(start_date)
    end = parse_date(end_date)
    if start is None or end is None:
        raise HTTPException(400, "start_date/end_date must be valid dates.")

    staged = list(
        db.scalars(
            select(PlaidTransaction).where(PlaidTransaction.removed.is_(False))
        ).all()
    )
    bank_rows: list[BankRow] = []
    for t in staged:
        d = parse_date(t.posting_date)
        if d is not None and start <= d <= end:
            bank_rows.append(to_bank_row(t))

    if not bank_rows:
        raise HTTPException(
            400,
            "No synced bank transactions in that date range - use Sync now "
            "on the Bank Transactions page first, or widen the range.",
        )

    rules = list(db.scalars(select(CategoryRule)).all())
    accounts = list(db.scalars(select(ChartOfAccount)).all())
    categorizer = Categorizer(rules, accounts)

    raw_income = round(sum(b.amount for b in bank_rows if b.amount > 0), 2)
    raw_expense = round(sum(b.amount for b in bank_rows if b.amount < 0), 2)
    result = categorize_bank_only(bank_rows, categorizer)

    run = ReconRun(
        bank_filename=f"Bank Transactions (synced, {start_date} to {end_date})",
        bank_line_count=result.bank_line_count,
        raw_bank_income_total=raw_income,
        raw_bank_expense_total=raw_expense,
    )
    run.lines = [ReconLine(**line.as_dict()) for line in result.lines]
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


@router.post("/reconcile", response_model=ReconRunDetail)
async def run_reconciliation(
    bank_file: UploadFile = File(...),
    bank_file_link: str = Form(""),
    db: Session = Depends(get_db),
) -> ReconRun:
    """Wizard step 1: bank file only. Stripe payout-looking lines become
    placeholders awaiting merge-stripe (step 3), which now pulls its Stripe
    data from the synced ledger_stripe table (see pages/Stripe) rather than a
    second uploaded file."""
    bank_rows = parse_bank_csv(await _read_csv(bank_file))
    if not bank_rows:
        raise HTTPException(400, "Bank CSV had no usable rows.")

    rules = list(db.scalars(select(CategoryRule)).all())
    accounts = list(db.scalars(select(ChartOfAccount)).all())
    categorizer = Categorizer(rules, accounts)

    raw_income = round(sum(b.amount for b in bank_rows if b.amount > 0), 2)
    raw_expense = round(sum(b.amount for b in bank_rows if b.amount < 0), 2)
    result = categorize_bank_only(bank_rows, categorizer)

    run = ReconRun(
        bank_filename=bank_file.filename or "",
        bank_file_link=bank_file_link,
        bank_line_count=result.bank_line_count,
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
def merge_stripe_endpoint(run_id: int, db: Session = Depends(get_db)) -> ReconRun:
    """Wizard step 3: match this run's bank-payout placeholders (from step 1)
    against the Stripe data already pulled into ledger_stripe by a sync (see
    pages/Stripe) - leaving every other line, including anything the user has
    edited, untouched."""
    run = db.get(ReconRun, run_id)
    if run is None:
        raise HTTPException(404, "Run not found.")

    staged = list(db.scalars(select(StripeTransaction)).all())
    if not staged:
        raise HTTPException(
            400,
            "No synced Stripe transactions yet - use Sync Now on the Stripe "
            "page first.",
        )
    stripe_rows = [to_stripe_row(t) for t in staged]

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

    run.stripe_filename = "Stripe API sync"
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
def stripe_fund_check(db: Session = Depends(get_db)) -> StripeFundCheckOut:
    """Wizard step 2: which donation funds in the currently-synced Stripe
    data (ledger_stripe) don't yet have a stripe_fund rule."""
    staged = list(db.scalars(select(StripeTransaction)).all())

    # Self-heal rows synced before issue #124's fix: they never captured
    # PCO's context_json metadata, so a split gift is still sitting there
    # with the old garbled combined `fund` string and an empty
    # fund_breakdown_json - a fresh Stripe sync won't touch them either
    # (they're outside any lookback window). Every time the fund check
    # runs, reconstruct what can be recovered purely from the already-
    # stored description + amount and persist it, so the data actually
    # gets cleaned up instead of staying garbled forever.
    healed = False
    for t in staged:
        if t.fund_breakdown_json or t.type.lower() not in {"payment", "charge"}:
            continue
        breakdown = parse_fund_breakdown_from_description(t.description, t.amount)
        if len(breakdown) <= 1:
            continue
        t.fund = ", ".join(name for name, _ in breakdown)
        t.fund_breakdown_json = json.dumps(breakdown)
        healed = True
    if healed:
        db.commit()

    stripe_rows = [to_stripe_row(t) for t in staged]

    rules = list(db.scalars(select(CategoryRule)).all())
    accounts = list(db.scalars(select(ChartOfAccount)).all())
    categorizer = Categorizer(rules, accounts)

    # A donation split across multiple funds in one checkout lists each
    # designated fund here individually (via fund_breakdown), not the
    # single combined `fund` string - see issue #124, where a split gift's
    # funds got garbled into one unreadable (and, worse, mis-postable)
    # value instead of being recognized as separate funds.
    funds: set[str] = set()
    for r in stripe_rows:
        if not r.is_donation:
            continue
        if r.fund_breakdown:
            funds.update(name for name, _ in r.fund_breakdown)
        elif r.fund:
            funds.add(r.fund)

    items = []
    for fund in sorted(funds):
        cat = categorizer.categorize_fund(fund)
        items.append(
            StripeFundCheckItem(
                fund=fund,
                has_rule=bool(cat.account_no),
                account_no=cat.account_no,
                account_name=cat.statement_description,
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
