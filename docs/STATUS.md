# Status / Handoff

_Where we left off — read this first when resuming in a new session._

**Repo:** https://github.com/treasurer-cwmtc/Tracker
**Local path (Windows):** `C:\Users\nmathew\source\repos\bank-stripe-recon`
**Last updated:** 2026-07-14 (Finance UI visual redesign)

> Start every session by reading **[PROJECT.md](PROJECT.md)** (full knowledge base:
> goal, reconciliation logic, data model, stack) and this file.

---

## Done so far

- ✅ **Initial POC** — FastAPI + PostgreSQL (SQLite fallback) + React/Vite,
  Docker Compose. Reconciles Chase ↔ Stripe: matches bank `STRIPE…TRANSFER`
  payouts, explodes each into per-donation lines (via Stripe `Transfer`=payout id,
  using Net amounts), categorizes via two editable rule sets (Stripe fund→income,
  bank keyword→expense). CSV export.
- ✅ **Repo setup** — README, `.gitignore`, `pytest.ini`, seeded Chart of Accounts.
- ✅ **CI** — `.github/workflows/ci.yml` runs backend tests, frontend build, and
  Docker image builds on push/PR.
- ✅ **Docs** — `docs/PROJECT.md` (knowledge base) and `docs/DEPLOYMENT.md`
  (headless VPS guide: Docker, systemd boot, Caddy HTTPS, backups).
- ✅ **Branch protection** on `main` — blocks force-push and deletion only.
- ✅ **#1 Authentication** — per-user accounts, PBKDF2 hashing, JWT, admin
  user-management (Users tab), all API routes protected, env-seeded admin.
  Frontend login + logout + 401 handling.
- ✅ **Chart of Accounts CRUD with a real 3-level hierarchy** —
  StatementCategory → StatementItem → Account(Detail), each its own table
  with a true auto-increment code scoped to its parent (never reused, even
  after delete). `AccountNo` and `StatementDescription` are always derived by
  concatenating the chain, never hand-typed. Add/edit/delete in the Chart of
  Accounts tab (3 top-down creation forms + accounts table). CSV import was
  removed (flagged as a future request); seed data replaced with the full
  376-account church chart (was a partial 68-row guess before).
- ✅ **Reconciliation ledger** — the old "Reconcile" tab is now **Upload**
  (unchanged mechanically); a new **Reconciliation** tab is a persistent,
  fully hand-editable ledger matching the target Google Sheet's shape. Push
  a completed Upload run into it via "Add to Reconciliation" (pick a Bank
  Account first); re-pushing an overlapping statement is deduped
  automatically (date + amount + Check/Invoice Name or Bank Description).
  Statement Description and the Chart-of-Accounts-derived reporting columns
  (Category/Statement/Item/Item Detail/Grouping/etc.) are always looked up
  live from the linked account, never independently editable. Every column
  header shows a green/red completeness bar; click one to filter to just
  the rows missing that column. Verified end-to-end against real
  April-September 2025 Chase + Stripe exports (639 output lines, 611
  imported / 28 genuine in-statement duplicates correctly deduped).
- ✅ **Verified Reconciliation ledger logic against the live legacy sheet's
  actual cell formulas** (not just values - used View > Show formulas /
  Ctrl+` in both source spreadsheets):
  - `Import-ChartOfAccounts` tab confirmed the exact column layout our
    `ChartOfAccount` model already uses (AccountNo, Category, StatementCategory,
    StatementItem, StatementDetail, StatementDescription, IsTaxDeductible,
    IsMandatory, Grouping, IsYouthChaplainShare, IsMissions, **Type**).
  - The Reconciliation sheet's Category/Statement/Item/ItemDetail columns are
    `INDEX/MATCH` lookups keyed on Statement Description against that tab -
    same shape as our live join on `account_no`, but ours is more robust
    (joins on a guaranteed-unique code instead of matching by text).
  - **Fixed**: `Type` isn't just an alias of Category - the source data has
    every `Budget`-category row hardcoded to `Type=Income` regardless of what
    it represents (a quirk, not a real distinction). Reproduced exactly in
    `frontend/src/pages/Reconciliation/columns.ts`.
  - **Fixed**: CY/PY isn't derived from today's real-world date - the sheet
    compares each transaction date against a `Configurations` tab cell the
    treasurer updates by hand once a year at rollover. Added an
    `AppSetting` (`prior_year_end_date`, seeded to Dec 31 of last year) with
    a small editable control at the top of the Reconciliation page, matching
    that manual-rollover workflow.
  - `TransactionLookup` column confirmed genuinely blank/unused in the source
    (no formula) - correctly not modeled.
  - Stripe fund → account matching (Match_Stripe_2!AB, `LKP_COA`) confirmed to
    be a big hardcoded `REGEXMATCH`-per-fund-name `IFS()` chain - architecturally
    the same idea as our `CategoryRule` (`stripe_fund`) table, just editable
    instead of hardcoded. Spotted additional fund names in that formula not
    yet covered by our seeded default rules - see Next steps.
- ✅ **Reconciliation performance + UX redesign** — the full 28-column table
  took several seconds to render with 600+ real rows because the Statement
  Description column mounted a ~370-option `<select>` in every row. Redesigned
  as a compact register (cheap, memoized rows) + click-to-open detail popup
  (every field, including the account picker, mounted once at a time) - a
  Quicken-style layout. Column completeness moved from table headers to a
  chip strip above the register (still click-to-filter-to-bad-rows). Measured
  ~243ms to render 611 real rows, down from several seconds.
- ✅ **Split / undo-split** — a single aggregated bank line (e.g. one lump
  "REMOTE ONLINE DEPOSIT" that's actually several checks bundled together)
  can be split into multiple entries from the detail popup. The original row
  isn't deleted - it's hidden (`is_split=True`), so its `dedup_key` keeps
  blocking a future re-import of the same statement from resurrecting it as
  a duplicate; the visible, editable rows are its children
  (`split_parent_id`). Split lines must balance to the original amount
  (enforced both client- and server-side). "Undo split" on any child removes
  all siblings and restores the original line. Verified end-to-end: split a
  real $30 deposit line into $18 + $12, confirmed re-import still skips it
  (0 imported), then undid the split and confirmed the register returned to
  its exact original state.
- ✅ **Accrual tab** — a second, manually-entered ledger for recording an
  expense/reimbursement as incurred, before the actual payment clears the
  bank and shows up in Reconciliation. Same shape, same Chart-of-Accounts
  lookup, same split/undo-split as Reconciliation, but with no Upload run to
  push from and no dedup (every row is deliberately hand-entered, so there's
  no import-collision risk). The Reconciliation and Accrual pages now share
  one UI module (`frontend/src/pages/ledger/` - columns, cells, register
  row, detail popup, split popup) behind a structural `LedgerEntry`
  interface, with each page injecting its own API calls as props; this also
  makes future ledger-shaped tabs cheap to add. Accrual adds a **Quick add**
  popup: sticky fields (Date, Statement Description, Bank Account, Method,
  Is Reimbursement) persist across saves since a batch of accrual entries
  usually shares them (e.g. five people reimbursed for the same purchase on
  the same day), while per-entry fields (Description, Amount, Check/Invoice
  Name, Notes) clear after each save and focus returns to Description -
  fill in who/how much and hit Enter to keep adding rows without retyping
  the shared data. Verified live: Quick Add (submit via button and via
  native Enter-in-form submission), Split (a lump entry into two balanced
  lines), and Undo split (children removed, original amount/line restored).
- ✅ **Type-to-filter Chart of Accounts picker** — the account list is 362
  rows; scanning a plain `<select>` for one by name was slow. Added
  `AccountPicker` (`frontend/src/pages/ledger/AccountPicker.tsx`), a
  from-scratch combobox (no new dependency) that filters by account number
  or statement description as you type, with arrow-key/Enter navigation and
  click-to-select. Replaces the old `AccountCell` `<select>` everywhere it
  was used: the register detail popup, the split popup, and Accrual's Quick
  Add.
- ✅ **Config tab** — a new page mirroring the legacy sheet's Configurations
  tab exactly, replacing the "Prior year ends" editor that used to live
  inline on the Reconciliation page:
  - **Fiscal year (CY/PY)**: editable **Current Year Date** (matches the
    sheet's B1), with read-only derived Prior Year Date / Current Year /
    Prior Year shown below it (matches B2/B3/B4). Saving still writes to
    the same `prior_year_end_date` AppSetting Reconciliation/Accrual's
    CY/PY columns already read - no backend/schema change, just a friendlier
    editing surface (edit "start of the year" instead of "end of last
    year").
  - **Frequency**: editable Monthly/Yearly/Quarterly periods-per-year
    (defaults 12/1/4, matching the sheet's Frequency lookup). Not
    consumed by anything yet - added because the legacy sheet has it and
    it'll be needed once budget-period math is built.
  - **Audit validation**: editable From/To date range for spot-checking a
    stretch of transactions (matches the sheet's Audit Validation cells).
    Also not consumed yet - same reasoning.
  - All five values are just rows in the existing generic `AppSetting`
    key/value table (`frequency_monthly`, `frequency_yearly`,
    `frequency_quarterly`, `audit_validation_from_date`,
    `audit_validation_to_date`, plus the pre-existing
    `prior_year_end_date`) - seeded with sensible defaults in
    `backend/app/seed.py`, no new tables or endpoints needed.
  - Verified live: all three cards load, edit, and save correctly; CY/PY
    columns on Reconciliation still populate correctly after removing the
    inline editor.
- ✅ **Budget / General Ledger / Income Statement** - phase 1 of a broader
  push toward a nicer, more Quicken-like finance UI (see Next steps for the
  rest: a Home dashboard, a visual redesign pass, and eventual
  Auditor-specific screens). Discovered by inspecting the legacy sheet's
  Statement Details + Income Statement tabs (View > Show formulas): a
  budget figure is a pseudo-transaction dated Jan 1, posted to a **parallel
  "Budget" account** that shares its Statement Category/Item *names* (not
  numbers - the two account trees are numbered independently) with the real
  Income/Expense account it plans for. Our Chart of Accounts already seeds
  these B-prefixed accounts (`category="Budget"`), so no COA changes were
  needed.
  - **Budget tab** (`backend/app/models.py` `BudgetEntry`,
    `backend/app/routers/budget.py`, `frontend/src/pages/Budget/`) - one
    row per Budget-category account per year (always shows every account,
    $0 if unset, so it doubles as a "what's left to budget" checklist).
    Plain positive amounts (no debit/credit sign - Actuals apply `abs()` to
    match at report time). `GET /api/budget?year=`, upsert via
    `PUT /api/budget/{account_no}?year=`.
  - **General Ledger tab** (`backend/app/routers/general_ledger.py`,
    `frontend/src/pages/GeneralLedger/`) - the union of Reconciliation +
    Accrual + Budget (Budget rendered as a virtual line dated Jan 1),
    read-only, with a Source badge column and year/source filters. This is
    meant to be *the* single view every other financial report reads from
    - see `backend/app/services/fiscal.py` for the shared CY/PY-cutoff
    helpers used here and by Income Statement.
  - **Income Statement tab** (`backend/app/routers/income_statement.py`,
    `frontend/src/pages/IncomeStatement/`) - Plan (Budget, current year)
    vs Actuals (Reconciliation + Accrual, CY only) vs Variance, grouped
    Statement Category -> Statement Item, split into Income and
    Expenditures sections - reproduces the legacy sheet's layout, including
    its sign convention (Income: actual > plan is favorable/positive;
    Expenditures: actual < plan is favorable/positive) confirmed from the
    sheet's actual cell values, not guessed.
  - Verified live end-to-end: entered a Budget amount, confirmed it showed
    up correctly on both the General Ledger (as a virtual Jan-1 line) and
    the Income Statement (correct Plan/Actuals/Variance row, correct
    section - Expenditures > Administration > Diocese Fees).
- ✅ **Home dashboard** (phase 2 of the finance-UI push) - now the default
  landing tab after login (was Upload). `GET /api/dashboard`
  (`backend/app/routers/dashboard.py`, `frontend/src/pages/Home/`):
  - **Account balances** - all-time sum of Reconciliation amounts per bank
    account (Accrual is excluded - it's planned/incurred, not yet real bank
    money).
  - **Income/Expense YTD vs Budget** - reuses the exact same aggregation as
    the Income Statement tab (refactored the section-total math out into
    `backend/app/services/reporting.py::compute_income_statement`, called
    by both routers) so the two pages can never disagree.
  - **Last data entry** - the most recent `created_at` across Reconciliation
    + Accrual, shown relative ("3 days ago") plus an absolute timestamp - a
    quick staleness check.
  - Verified live: balances/YTD figures matched real data (including the
    Diocese Fees budget entry from the Income Statement work above showing
    up correctly in the Expenses vs Budget tile).
- ✅ **Budget redesigned to a real multi-entry ledger + real 2026 data
  imported.** Turned out the original "one row per account per year" model
  was wrong: inspecting the legacy sheet's Reconciliation tab (rows tagged
  `Statement Description` starting with "Budget") showed a single account
  can carry *multiple* budget lines in one year - e.g. "Salaries and
  Benefits" has four separate lines (Salary $19,096.20, Health Insurance
  $17,640.00, Retirement Plan $2,546.16, Social Security $1,432.22 - sum
  $40,714.58, which matches the sheet's own computed "Salaries and
  Benefits" Plan total exactly). `BudgetEntry` was reshaped to match
  (`transaction_date` instead of a separate `year` column, added
  `description`, dropped the `year`+`account_no` uniqueness constraint) -
  same fields as `AccrualEntry` minus bank account/method/reconciled/split,
  which don't apply to a planning figure.
  - **UI rebuilt to match Accrual's pattern** (`frontend/src/pages/Budget/`):
    a plain register (no column-health chip strip - Budget only has fields
    it always populates, so there was nothing to show a "some rows missing
    this" pill for), click-to-open detail popup, and a Quick Add popup with
    a sticky Account field (batches of budget lines are usually entered
    against the same account, like the four Salaries and Benefits lines
    above).
  - **Copy-year**: `POST /api/budget/copy-year` copies every line from one
    year into another (dates shifted) as a starting point for next year's
    budget - refuses to clobber a year that already has entries unless
    `overwrite: true`. Exposed on the Budget page as "Copy budget from year
    ___ → Copy as starting point for {year}".
  - **Real 2026 data imported**: read every "Budget"-tagged row in the
    legacy sheet's Reconciliation tab (86 rows, 74 with a non-zero amount)
    via the browser - amounts, descriptions ("Salary", "Health Insurance",
    fund names like "Navjeevan"/"Oklahoma Mission"/"Texas Flood Relief"),
    and notes ("Assumed 3% increase", "First communion bibles" etc.) - and
    resolved each to the correct seeded `account_no` by matching Statement
    Category/Item/Detail names (account numbers in the sheet are cosmetic;
    ours are derived independently - see Chart of Accounts numbering notes
    below). Cross-validated against the sheet's own computed Income
    Statement Plan figures (Pledges $215,850, Sunday Offertory $10,000,
    Salaries and Benefits $40,715 - all matched) before importing via a
    one-time script against the local API. Total: 74 lines, $1,163,348.03.
  - **Note on "Restricted Net Assets" appearing to double-count**: the
    Income Statement's Plan aggregation joins Budget lines to real
    Income/Expense accounts by `(Statement Category, Statement Item)` name
    only, not by which section (Income vs Expenditures) is asking - and
    "Restricted Net Assets" genuinely has matching item names on *both*
    sides of the Chart of Accounts (e.g. `I111110`/`E261110` "Building
    Improvement" - money raised for a restricted purpose vs. money spent
    from it). A Restricted Net Assets budget line therefore contributes to
    both the Income and Expenditures Plan totals. Confirmed this matches
    the legacy sheet's own formula (`Reconciliation!O:O=A4` with no
    Income/Expense-side filter on the Plan side) - not a bug, faithful
    reproduction of the source.
- ✅ **Renamed "Reconciliation" to "Actual"** throughout the UI - nav tab
  label, Home/GeneralLedger/IncomeStatement/Config/Accrual/Upload subtitle
  and message copy, the "Add to Actual" button, the delete-entry confirm
  prompt, and the General Ledger source badge/filter. Deliberately a
  UI-only rename: the underlying `ReconciliationEntry` model, API routes
  (`/api/reconciliation/...`), the `frontend/src/pages/Reconciliation/`
  folder/component name, and the `ledgerApi` module are all unchanged -
  renaming those would be a much larger, riskier refactor for no user-
  visible benefit. The app's own title ("Bank / Stripe Reconciliation")
  and the Chart-of-Accounts numbering docs weren't touched either - they
  describe the app's overall purpose, not the tab.
- ✅ **Finance UI visual redesign** (phase 3 of the finance-UI push) - moved
  from a generic top-tab admin-panel look toward a Quicken/YNAB-style
  layout:
  - **Left sidebar navigation** (`.sidebar` in `styles.css`, restructured
    `frontend/src/App.tsx`) replaces the horizontal top tab bar - dark
    teal-black background, tabs grouped into Overview / Ledgers / Reporting
    / Setup sections, active tab marked with a left accent bar. The
    app-wide title/description moved into the sidebar header; each page now
    has its own `.page-title` heading in the content area (previously only
    the app had a heading, individual pages jumped straight into a
    subtitle).
  - **Refined palette**: swapped the generic indigo SaaS accent for a deep
    teal (`--primary: #0f766e`) that reads more "accounting software" than
    "startup dashboard," plus a proper shadow/spacing system
    (`--shadow-sm`, `--shadow-md`).
  - **Polish**: stat tiles (Home dashboard) now sit in their own tinted
    boxes instead of bare text; table headers are uppercase/letter-spaced;
    register-row hover uses the new primary-tint color instead of plain
    gray; inputs get a visible teal focus ring; all hardcoded indigo
    accents (chip/pill/autocomplete highlight backgrounds) replaced with
    the `--primary-light` token.
  - No component logic changed - this was CSS + layout structure only, so
    behavior (forms, modals, filters, editable cells) is identical to
    before. Verified live across Home, Actual, Budget, Config, and Income
    Statement - all render correctly, detail popups/modals still layer
    correctly over the new shell.

**Tests:** 39 passing (`cd backend; .\.venv\Scripts\python.exe -m pytest`).
**Frontend build:** clean (`cd frontend; npm run build`).

---

## Next steps (GitHub issues)

Tracked as issues on the repo. Suggested order:

- **Auditor-specific screens** (phase 4 of the finance-UI push,
  later/separate ask) — a read-only, audit-focused view; likely wants the
  Config tab's Audit Validation date range once it exists. _Recommended
  next, whenever it comes up._
- **#7 CI/CD auto-deploy to VPS** — the "check in → build → deploy automatically"
  goal. Publish images to GHCR on push to `main`, then SSH + `docker compose pull
  && up` on the VPS (secrets as GitHub Actions secrets).
- **#2 Saved run history UI** — backend already persists runs/lines; add list/view/
  re-download. (Good small next feature.)
- **#3 Roster-based donor normalization** (uses the Import-Roster tab).
- **#4 Direct export to the accounting system.**
- **#5 Automated Stripe & Chase pulls** (replace manual CSV upload).
- **#6 Confirm Net vs gross+fee** handling for exploded donations (bookkeeping
  decision — affects reconciler logic).
- **Chart of Accounts CSV bulk import** — removed when CRUD was added; add back
  (as an upsert, not the old destructive replace) if bulk onboarding of many
  accounts at once turns out to be needed.
- **Reconciliation ledger follow-ups** — bulk-categorize/auto-fill uncategorized
  rows from existing rules (right now the Rules engine only runs during
  Upload, not retroactively against the ledger); possibly surface
  `IsReimbursement` more meaningfully once there's a real reimbursement
  workflow to hang it off of.
- **Wire up Frequency / Audit Validation** — both are now editable on the
  Config tab (`frequency_monthly/yearly/quarterly`,
  `audit_validation_from_date/to_date` AppSettings) but nothing reads them
  yet. Frequency exists in the legacy sheet to annualize/de-annualize budget
  amounts - relevant once a Budget page is built. Audit Validation is a
  spot-check date range - relevant once there's an audit/reporting view to
  filter by it.
- **Add missing Stripe fund rules** — the legacy sheet's `LKP_COA` formula
  (Match_Stripe_2!AB) matches on more fund names than our seeded
  `DEFAULT_FUND_RULES` covers. Confirmed present in the formula but not yet
  added as Rules (add via the Rules tab once you confirm the target account
  for each): `NavJeevan`, `Golf Tournament`, `Retreat`, `Sunday School`,
  `Cross Way Couples Date Night`, `Valentines Day Dinner`, `Achen Farewell`,
  `Piano`. (Didn't guess account numbers for these - the formula was
  truncated on-screen and guessing wrong codes would silently miscategorize
  real donations.)

---

## How to resume quickly

```powershell
# Backend (local POC, SQLite)
cd C:\Users\nmathew\source\repos\bank-stripe-recon\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
# Frontend (separate terminal)
cd C:\Users\nmathew\source\repos\bank-stripe-recon\frontend
npm run dev        # http://localhost:5173
```

Default login for local dev: `admin` / `changeme` (or whatever `ADMIN_USERNAME` /
`ADMIN_PASSWORD` you set). Delete `backend\recon.db` to reset local data.

---

## Workflow notes / gotchas

- **Pushing to GitHub:** the CLI account `db-nmathew` has only pull access to
  `treasurer-cwmtc/Tracker`. Pushes are done with a classic PAT (repo scope):
  save it to `C:\Users\nmathew\gh_token.txt`, push via
  `https://x-access-token:<token>@github.com/...`, then delete the file. Never
  commit the token. (Better long-term: add `db-nmathew` as a collaborator.)
- **Branch protection** allows direct pushes to `main` (only force-push/delete are
  blocked), so no PR is required for solo work.
- Commit trailer: `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.
