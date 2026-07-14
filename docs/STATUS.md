# Status / Handoff

_Where we left off — read this first when resuming in a new session._

**Repo:** https://github.com/treasurer-cwmtc/Tracker
**Local path (Windows):** `C:\Users\nmathew\source\repos\bank-stripe-recon`
**Last updated:** 2026-07-14 (Accrual tab)

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

**Tests:** 24 passing (`cd backend; .\.venv\Scripts\python.exe -m pytest`).
**Frontend build:** clean (`cd frontend; npm run build`).

---

## Next steps (GitHub issues)

Tracked as issues on the repo. Suggested order:

- **#7 CI/CD auto-deploy to VPS** — the "check in → build → deploy automatically"
  goal. Publish images to GHCR on push to `main`, then SSH + `docker compose pull
  && up` on the VPS (secrets as GitHub Actions secrets). _Recommended next._
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
  Upload, not retroactively against the ledger); a searchable/autocomplete
  Statement Description picker instead of a plain `<select>` (376+ accounts);
  possibly surface `IsReimbursement` more meaningfully once there's a real
  reimbursement workflow to hang it off of.
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
