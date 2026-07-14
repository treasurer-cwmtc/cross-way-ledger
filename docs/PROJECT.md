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

Account codes are prefixed by type: `I…` = Income, `E…` = Expense, `B…` = Budget.
`StatementDescription` is the human-readable path
(e.g. `Income - Income - Restricted Gifts - Building fund`). The full chart is
seeded from `backend/app/data/chart_of_accounts.csv` and can be **replaced by
uploading a fresh CSV** export of the `IMPORT - Chart of Accounts` tab (Chart of
Accounts tab in the UI). The seed includes all Income accounts plus the Expense
accounts referenced by default keyword rules; upload the full chart to get every
account.

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
- **Planned: transaction entry screen** — a manual transaction ledger (post-
  reconciliation), to be built after the Chart of Accounts work. Each transaction
  will support **Google Drive receipt linking**: an "Attach receipt" button opens
  the Google Picker so a user can link an existing Drive file (stores `fileId` +
  `webViewLink`, not a copy). Needs a Google Cloud OAuth client registered to the
  church domain — no Google credentials exist in the repo yet. See issue #8.

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
