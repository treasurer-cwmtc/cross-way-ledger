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
- `chart_of_accounts` — the category master.
- `category_rules` — editable rules (`stripe_fund` | `bank_keyword`).
- `recon_runs` — one row per reconciliation run (counts, filenames).
- `recon_lines` — the output lines (exploded donations + categorized bank lines).

### API surface

- `POST /api/auth/login` (form) → JWT; `GET /api/auth/me`;
  `POST /api/auth/change-password`; admin-only `GET/POST/DELETE /api/auth/users`
- `POST /api/reconcile` (multipart: `bank_file`, `stripe_file`) → run + lines
- `GET  /api/runs`, `GET /api/runs/{id}`, `GET /api/runs/{id}/export.csv`
- `GET/POST/PUT/DELETE /api/rules`
- `GET  /api/accounts`, `POST /api/accounts/upload`
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
