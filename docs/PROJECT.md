# Project Overview & Knowledge Base

_Bank ↔ Stripe Reconciliation app for Cross Way Mar Thoma Church (CWMTC)._

This document captures everything gathered during requirements discovery and the
initial build, so the context isn't lost between sessions.

---

## 1. Goal

Replace a manual Excel / VLOOKUP workflow with a simple web app that reconciles
church donations flowing **Planning Center → Stripe → Chase bank**, producing a
**per-donation breakout** instead of one lump-sum line, plus a **rules page** for
keyword-based auto-categorization.

### Deployment goal (important)

- The end goal is to run this **on a VPS as a headless service — it must run
  without a desktop / GUI** (no Excel, no Power BI Desktop, no interactive login).
- Everything is containerized so `docker compose up` produces the **identical**
  stack on a laptop and on the VPS.
- **A local POC is fine for now.** Local dev can run with zero external
  dependencies (SQLite + Vite dev server); the VPS/production target uses
  PostgreSQL. The database is intended to be a **proper, persistent database**.
- Expected usage: **1–4 people**, a **few times a month** (mostly one person).

---

## 2. The manual process being replaced

1. Download the **bank statement** Excel/CSV export (Chase) — contains Stripe
   transfer lines mixed with all other bank activity.
2. Download the **Stripe transaction** CSV export.
3. Copy both into one spreadsheet.
4. **VLOOKUP** to break each lump-sum Stripe bank deposit into the individual
   Stripe donations that composed it.
5. (New requirement) A **rules page**: if a transaction description contains a
   given word/phrase, auto-assign a category.

### Source of truth

The original workflow lives in a Google Sheet titled **"Upload Templates NEW"**
(spreadsheet id `1pQug5imrfvsAAmrxQmEfdAXSVQUUZE1VBDNXZTp9IuU`). Its tabs:

| Tab | Purpose |
| --- | --- |
| Steps | Human instructions |
| Upload - Chase Statement | Raw Chase bank CSV export |
| Upload_Stripe_1 | Raw Stripe transaction CSV export |
| Match_Stripe_2 | Stripe rows enriched with account code (`LKP_COA`), category, donor |
| Import-Roster | Donor roster |
| Validate - Chase Stripe and Stripe | Validation / tie-out |
| Chase Statement - Stripe Transactions | Stripe-only bank lines |
| Stripe - Final | Final Stripe breakout |
| Final - Chase Statement Without Stripe | Non-Stripe bank lines |
| FINAL RECONCILIATION UPLOAD | The exploded per-donation output |
| IMPORT - Chart of Accounts | Category master (account codes → descriptions) |

---

## 3. How reconciliation actually works (key insight)

The match is **NOT** a fuzzy amount/date lookup on individual donations. Instead:

1. Each bank credit line whose description contains `ORIG CO NAME:STRIPE … CO
   ENTRY DESCR:TRANSFER` is a **lump-sum Stripe payout** landing in the bank.
2. In the Stripe export, a row with `Type = payout` (negative `Amount`) represents
   that same payout. **Match bank line → payout by amount** (disambiguate by date
   when several payouts share an amount).
3. Individual donations (`Type = payment` or `charge`) link to their payout via the
   Stripe **`Transfer`** column, which equals the payout id (`po_…`). To
   **explode** a payout, gather all donations whose `Transfer` = that payout's
   `Source` (`po_…`).
4. Each exploded line uses the donation's **`Net`** amount (gross minus Stripe fee)
   so the exploded lines **sum back to the bank deposit**. Any residual
   (payout-level fees/timing) is emitted as a single `STRIPE PAYOUT ADJUSTMENT`
   line.

### Donor & fund extraction

- Stripe `Description` looks like
  `Donation #382021408 - Christy Philips - Sunday Offertory ($40.30)` or
  `Registration #82323486 - Evangeline Varughese - VBS 2026`.
- **Donor** and **fund** are parsed from that Description; for registrations the
  donor is taken from the `planning_center_person_name (metadata)` column, and the
  fund from the `planning_center_context (metadata)` JSON
  (`[{"name":"VBS 2026","cents":9300,...}]`).

---

## 4. Categorization — two rule sets

Both are user-editable and stored in the database (Rules tab in the UI):

1. **Stripe fund → income account** (`rule_type = stripe_fund`)
   e.g. `Pledges → I101010`, `Sunday Offertory → I121010`,
   `Building Fund → I172810`, `VBS → I141310`, `General → I172510`.
2. **Bank keyword → expense account** (`rule_type = bank_keyword`) — the new "rules
   page". If a bank line description contains the phrase, assign the account.
   e.g. `DIRECT ENERGY → E141712` (electricity),
   `ATMOS ENERGY → E221213` (parsonage gas),
   `CITITURF → E221214` (parsonage landscaping),
   `SPECTRUM → E221212` (parsonage internet),
   `COMMUNITY WASTE → E141711` (trash),
   `NTTA → E101810` (toll),
   `Diocese of North America → E101710` (salaries & benefits).

Rules have a `priority` (lower wins). Seeded values are best-guesses and meant to
be edited.

### Chart of Accounts

A real 3-level hierarchy, each level its own table with a true auto-increment
code scoped to its parent (never reused, even after a delete):

1. **StatementCategory** — top level, scoped to a Type (`Budget`/`Expense`/
   `Income`). `no` auto-increments within that Type.
2. **StatementItem** — nests under a StatementCategory. `no` auto-increments
   within that parent category.
3. **ChartOfAccount** (the Detail / leaf, i.e. the actual account) — nests
   under a StatementItem. `statement_detail_no` auto-increments within that
   parent item, or is `"00"` if the detail name is left blank ("no
   subdivision" account).

`AccountNo = TypePrefix + StatementCategoryNo + StatementItemNo + StatementDetailNo`
(TypePrefix: `B`/`E`/`I`). `StatementDescription` is auto-generated by
concatenating the chain's names (e.g. `Income - Income - Restricted Gifts -
Building fund`) but is editable after creation. See
`backend/app/services/coa_numbering.py` and `backend/app/models.py`
(`StatementCategory`, `StatementItem`, `ChartOfAccount`).

The Chart of Accounts tab has three creation forms (Category → Item →
Account, top-down) plus an accounts table with edit/delete. Editing an
account is limited to description/flags — renumbering isn't supported, since
rules and past runs reference `account_no` by value. Deleting a Category/Item
is blocked while children exist under it; deleting an Account is blocked
while a rule references it. Note: the legacy source spreadsheet has some
StatementCategory names reused across different codes under the same Type
(e.g. two distinct "Restricted Net Assets" groups) - that's tolerated as
historical data, but the app blocks creating a *new* category with a name
that already exists under the same Type going forward.

**CSV import was removed** (candidate for a future "bulk import" feature,
which would need to be an upsert against this hierarchy rather than the old
destructive replace) — the seed data
(`backend/app/data/chart_of_accounts.csv`, 376 source rows -> 362 accounts)
comes from the full church chart-of-accounts spreadsheet, but the seed
loader (`backend/app/seed.py`) **derives** category/item/detail numbers from
each row's *names* rather than trusting the spreadsheet's own numbering
columns, which were inconsistent (e.g. it forked a new category number for
what was really just an item variation, like one "Restricted Gifts -
Missions" mission per category number instead of per detail number; and
reused one category number for two differently-named groups, like two
distinct "Restricted Net Assets" groups both filed under Expense code 26/27).
Deriving by name collapses same-named groups and gives Category, Item, and
Detail each their own clean sequential code - e.g. Income now has exactly
one "Income" category (no. 10) and one "Restricted Net Assets" category
(no. 11), instead of ~14 near-duplicate "Income" category rows. The
spreadsheet's blank rollup/header rows (`I000000` etc.) and a handful of
true duplicate (item, detail-name) pairs are skipped during seeding (376
source rows -> 362 accounts). Further changes happen through the app.

### The Reconciliation ledger (persistent, editable)

The **Upload** tab (formerly "Reconcile") is unchanged mechanically - upload a
Chase + Stripe CSV pair, get back an ephemeral `ReconRun`/`ReconLine` preview,
same as before. What's new is a **Reconciliation** tab: a persistent, hand-
editable ledger that Upload results get pushed into, matching the target
Google Sheet's shape (`Transaction Date, Date Posted, Reconciled, Statement
Description, Description, Bank Account, Method, Amount, Check/Invoice Name,
Bank Description, Notes`, plus Chart-of-Accounts-derived reporting columns).

- **Bank Account** (`bank_accounts` table) - a simple named lookup (seeded
  with "Chase Operating" to match the church's real data). Picked once on the
  Upload tab before running Reconcile; every resulting row gets tagged with
  it when pushed to Reconciliation via the "Add to Reconciliation" button.
- **ReconciliationEntry** (`reconciliation_entries` table) is the ledger row.
  Every field is directly editable in the grid except the Chart-of-Accounts-
  derived columns (Category, Statement, Item, Item Detail, Grouping,
  IsYouthChaplainShare, IsMissions, Type) and the date-part breakdown columns
  (month name/month-year/year/CY-PY for both dates) - those are always
  computed live from `account_no` / the date fields, never stored, so
  Statement Description etc. can never drift out of sync with the Chart of
  Accounts. See `backend/app/routers/reconciliation.py` and
  `frontend/src/pages/Reconciliation/` (page-specific) /
  `frontend/src/pages/ledger/` (shared register/popup/split UI - see
  Accrual tab below).
- **Dedup on import**: pushing an Upload run to Reconciliation computes a
  `dedup_key` per line (`transaction_date + amount + Check/Invoice Name (or
  Bank Description as fallback)`) and skips any row whose key already exists
  in the ledger - re-uploading an overlapping statement never creates
  duplicate rows. See `backend/app/services/ledger.py`.
- **Method auto-mapping**: Chase's raw `Type` codes (`CHECK_DEPOSIT`,
  `DEBIT_CARD`, `QUICKPAY_DEBIT`, `WIRE_INCOMING`, ...) are mapped to the
  small set of values the ledger actually uses (`Stripe`/`Check`/`Debit`/
  `Zelle`/`Wire`/`Deposit`/`Other`) at import time - the Method cell stays a
  fully editable dropdown for correcting any mismatch (`METHOD_MAP` in
  `services/ledger.py`).
- **Column health indicators**: each column header shows a green bar if
  every row has a value, red if any are missing; clicking a header filters
  the grid down to just the rows missing that column. This applies literally
  to every column, including ones that are commonly blank by nature (Notes,
  Grouping, etc.) - a permanently-red header there is expected, not a bug.
- **`Type` quirk (verified against the live source formulas)**: `Type` is
  not simply `= Category`. The legacy sheet hardcodes every `Budget`-category
  row to `Type=Income` regardless of what it actually represents - confirmed
  by inspecting `Import-ChartOfAccounts!L` directly (View > Show Formulas).
  Reproduced exactly rather than "cleaned up", since the goal is fidelity to
  the existing reporting.
- **CY/PY is a manual annual toggle, not derived from today's date**: the
  source sheet compares each transaction date to a `Configurations` tab cell
  the treasurer updates once a year at rollover (`IF(date > Configurations!B2,
  "CY", "PY")`), not the server's real-world date. Modeled as an `AppSetting`
  row (`prior_year_end_date`), editable via a small control at the top of the
  Reconciliation page - see `backend/app/routers/settings.py` and
  `frontend/src/pages/ledger/columns.ts` (`setPriorYearEndDate`) - the
  setting is shared with the Accrual tab (below), which reads it but only
  Reconciliation exposes the editor.
- **Stripe fund matching parity**: the legacy `Match_Stripe_2!AB` ("LKP_COA")
  column is a hardcoded `IFS()`/`REGEXMATCH()` chain, one clause per fund
  name, each mapping to a literal account code - architecturally the same
  idea as our `CategoryRule` (`stripe_fund`) table, just editable instead of
  hardcoded in a formula. Some fund names visible in that formula
  (NavJeevan, Golf Tournament, Retreat, Sunday School, Cross Way Couples Date
  Night, Valentines Day Dinner, Achen Farewell, Piano) aren't yet in our
  seeded `DEFAULT_FUND_RULES` - add them via the Rules tab once the target
  account for each is confirmed (see STATUS.md).
- **UI is a compact register + detail popup, not a wide table**: rendering
  all 28 columns inline was the actual performance bottleneck (a ~370-option
  Chart of Accounts `<select>` per row, times 600+ rows). `RegisterRow.tsx`
  renders a handful of cheap, memoized columns; clicking a row opens
  `TransactionModal.tsx` with every field, mounting the account picker once.
  Column completeness lives in `ColumnHealthStrip.tsx` (a chip strip above
  the register) rather than table headers.
- **Splitting an aggregated line**: `SplitModal.tsx` (opened from
  `TransactionModal`) turns one entry into several - e.g. a lump bank deposit
  that's actually multiple checks. The split lines must balance to the
  original amount (enforced client-side for immediate feedback and again
  server-side). The original row is kept but hidden (`is_split=True`) rather
  than deleted, specifically so its `dedup_key` keeps blocking a future
  re-import of the same statement - the visible rows are its children
  (`split_parent_id`). "Undo split" removes the children and restores the
  original. See `backend/app/routers/reconciliation.py`
  (`/{id}/split`, `/{id}/unsplit`, `/split-group/{id}`).

### The Accrual tab (manually-entered, same shape as Reconciliation)

A second persistent ledger for recording an expense/reimbursement as
**incurred**, before the actual payment clears the bank and shows up in
Reconciliation - e.g. a reimbursement approved today that won't hit the
Chase statement for another week. Structurally identical to
`ReconciliationEntry` (same fields, same Chart-of-Accounts-derived reporting
columns, same split/undo-split), but entirely hand-entered: there's no
Upload run to push from, so no `dedup_key`/`source_run_id` and no import
step - `AccrualEntry` (`accrual_entries` table), `backend/app/routers/accrual.py`.

- **Shared UI, separate data**: Reconciliation and Accrual are two different
  tables/endpoints presenting through the *same* register/detail-popup/split
  components (`frontend/src/pages/ledger/` - `types.ts` defines a structural
  `LedgerEntry` interface both entities satisfy). The shared components never
  import an API module directly; each page passes its own `ledgerApi`/
  `accrualApi` calls down as props (`onUpdate`, `onSplit`, `onUnsplit`, etc.),
  so adding a third ledger-shaped tab later means writing a new
  page + API module, not touching the shared UI.
- **Quick add popup** (`frontend/src/pages/Accrual/QuickAddModal.tsx`): the
  fast entry path the tab exists for. Fields split into two groups - sticky
  (Transaction Date, Date Posted, Statement Description, Bank Account,
  Method, Is Reimbursement) persist across saves since a batch of accrual
  entries usually shares them (e.g. five people reimbursed for the same VBS
  purchase on the same day); per-entry (Description, Amount, Check/Invoice
  Name, Notes) clear after each save and focus returns to Description. A
  native form submit (button click or Enter while focused in the form) posts
  the entry, prepends it to the register, and resets for the next row.
- **No dedup**: unlike Reconciliation, every Accrual row is a deliberate
  manual entry, so there's no import-collision scenario to guard against -
  no `dedup_key` on the model at all.

---

## 5. Architecture / tech stack

| Layer | Choice |
| --- | --- |
| Backend | FastAPI + SQLAlchemy (Python 3.12) |
| Database | PostgreSQL (production/VPS); SQLite fallback for local POC |
| Frontend | React + Vite + TypeScript |
| Packaging | Docker Compose (db + backend + frontend behind nginx) |

- `DATABASE_URL` selects the DB. Unset → SQLite file `recon.db` (local POC). In
  Docker it is set to the Postgres service.
- Frontend nginx serves the built SPA and proxies `/api` → backend, so the whole
  app is reachable on one port on the VPS (`:8080`).

### Data model (tables)

- `users` — login accounts (username, PBKDF2 password hash, is_admin, active).
- `statement_categories` / `statement_items` / `chart_of_accounts` — the
  3-level Chart of Accounts hierarchy (see above).
- `category_rules` — editable rules (`stripe_fund` | `bank_keyword`).
- `recon_runs` / `recon_lines` — one Upload run and its ephemeral output
  lines (preview only, not persisted long-term as the source of truth).
- `bank_accounts` — named bank account lookup (e.g. "Chase Operating").
- `reconciliation_entries` — the persistent, editable Reconciliation ledger;
  `dedup_key` prevents re-importing the same transaction twice.
- `accrual_entries` — the persistent, editable Accrual ledger; same shape as
  `reconciliation_entries` minus `dedup_key`/`source_run_id` (always
  hand-entered, never imported).

### API surface

- `POST /api/auth/login` (form) → JWT; `GET /api/auth/me`;
  `POST /api/auth/change-password`; admin-only `GET/POST/DELETE /api/auth/users`
- `POST /api/reconcile` (multipart: `bank_file`, `stripe_file`) → run + lines
  (the Upload tab)
- `GET  /api/runs`, `GET /api/runs/{id}`, `GET /api/runs/{id}/export.csv`
- `GET/POST/PUT/DELETE /api/rules`
- `GET/POST/PUT/DELETE /api/accounts` (Chart of Accounts leaf/Detail level)
- `GET/POST/DELETE /api/accounts/statement-categories`,
  `GET/POST/DELETE /api/accounts/statement-items`,
  `POST /api/accounts/preview-number`
- `GET/POST/DELETE /api/bank-accounts`
- `GET/PUT/DELETE /api/reconciliation`, `POST /api/reconciliation/import-run/{run_id}`,
  `POST /api/reconciliation/{id}/split`, `POST /api/reconciliation/{id}/unsplit`,
  `GET /api/reconciliation/split-group/{id}` (the Reconciliation tab)
- `GET/POST/PUT/DELETE /api/accrual`, `POST /api/accrual/{id}/split`,
  `POST /api/accrual/{id}/unsplit`, `GET /api/accrual/split-group/{id}`
  (the Accrual tab)
- `GET  /api/health` (public)

All endpoints except `/api/health` and `/api/auth/login` require a Bearer token.

---

## 6. Output

- On-screen table (filter: all / Stripe donations / bank / needs-attention).
- Downloadable **CSV** matching the FINAL RECONCILIATION UPLOAD layout
  (Transaction Date, Date Posted, Description, Statement Description, Account No,
  Category, Method, Amount, Check/Invoice Name, Bank Description, Notes).

---

## 7. Assumptions & open items

- Exploded amounts use Stripe **Net**; confirm whether the bookkeeping wants gross
  + a separate Stripe-fee expense line instead.
- Seed keyword/fund rules are guesses — review on the Rules tab.
- Not yet built (candidate next steps): saved run history UI, roster-based donor
  normalization, direct export to the accounting system, automated Stripe/Chase
  pulls instead of manual CSV upload, CI/CD auto-deploy to the VPS.

### Authentication (built)

- Per-user accounts with PBKDF2-hashed passwords; JWT bearer tokens
  (`SECRET_KEY`-signed, 12h expiry). Seed admin from `ADMIN_USERNAME` /
  `ADMIN_PASSWORD` on first startup; admins manage users in the **Users** tab.
  Frontend stores the token in `localStorage` and redirects to a login screen on
  401.

---

## 8. Verification done in the initial build

- Backend unit tests (parsing, payout matching, explosion, both categorizers): 5/5
  passing (`pytest`).
- Frontend production build (tsc + vite) clean.
- Full stack live-tested through the Vite proxy: 1 payout matched, 5 donations
  exploded and correctly categorized, CSV export correct.
