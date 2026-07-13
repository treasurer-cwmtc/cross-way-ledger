# Bank ↔ Stripe Reconciliation

Replaces the manual Excel/VLOOKUP workflow for reconciling church donations that
flow **Planning Center → Stripe → Chase bank**. Upload the two CSV exports and the
app:

1. Matches each bank `STRIPE … TRANSFER` credit (a lump-sum payout) to the Stripe
   payout record (by amount, disambiguated by date).
2. **Explodes** each payout into the individual donations that made it up (linked
   via the Stripe `Transfer` = payout id), using each donation's **net** amount so
   the exploded lines reconcile back to the bank deposit.
3. **Categorizes** every line against your Chart of Accounts using two editable
   rule sets:
   - **Stripe fund → account** (e.g. `Pledges → I101010`)
   - **Bank keyword → account** (e.g. description contains `ATMOS ENERGY → E221213`)
4. Shows the per-line breakout on screen and lets you **download it as CSV**.

## Stack

- **Backend:** FastAPI + SQLAlchemy (Python 3.12)
- **Database:** PostgreSQL (SQLite fallback for zero-install local dev)
- **Frontend:** React + Vite + TypeScript
- **Packaging:** Docker Compose (identical locally and on a VPS)

## Run with Docker (recommended, matches VPS)

```bash
cp .env.example .env      # edit POSTGRES_PASSWORD
docker compose up -d --build
```

- Frontend: http://localhost:8080
- Backend API + docs: http://localhost:8000/api/health, http://localhost:8000/docs

The Chart of Accounts and a starter set of rules are seeded automatically on first
startup. See **[docs/STATUS.md](docs/STATUS.md)** for where development left off
(read this first when resuming). See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**
for the full VPS (headless) setup, HTTPS, boot-on-startup, and backups. See
**[docs/PROJECT.md](docs/PROJECT.md)** for the project knowledge base.

## Authentication

The app requires login. A seed admin is created on first startup from
`ADMIN_USERNAME` / `ADMIN_PASSWORD` (defaults `admin` / `changeme` — **change
these**, and set a strong `SECRET_KEY`, before exposing publicly). Admins add more
users in the **Users** tab. All API endpoints except `/api/health` and
`/api/auth/login` require a Bearer token.

## Run locally without Docker (POC)

**Backend** (uses a local SQLite file `recon.db`):

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

**Frontend** (proxies `/api` to the backend at :8000):

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

## Tests

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest
```

## Project layout

```
backend/
  app/
    main.py            FastAPI app + startup (create tables, seed)
    config.py          Settings (DATABASE_URL, CORS)
    database.py        SQLAlchemy engine/session
    models.py          ChartOfAccount, CategoryRule, ReconRun, ReconLine
    schemas.py         Pydantic request/response models
    seed.py            Seeds Chart of Accounts (CSV) + default rules
    routers/           reconcile.py, rules.py, coa.py
    services/          parsers.py, categorizer.py, reconciler.py  (core logic)
    data/chart_of_accounts.csv
  tests/               pytest + sample CSV fixtures
frontend/
  src/
    api.ts             Typed API client
    pages/             Reconcile, Rules, Accounts
docker-compose.yml
```

## How categorization works

Rules live in the database and are editable on the **Rules** tab. Each rule has a
`priority` (lower wins). The **Chart of Accounts** tab lets you search accounts and
replace the whole chart by uploading a fresh CSV export of the
`IMPORT - Chart of Accounts` sheet tab.

## Notes / assumptions

- Stripe donation **fund** and **donor** are read from the transaction Description
  (`Donation #… - <Donor> - <Fund> (...)`) and Planning Center metadata columns.
- Exploded donation amounts use the Stripe **Net** (post-fee) value so they sum to
  the bank deposit. Any residual (payout-level fees/timing) is written as a single
  `STRIPE PAYOUT ADJUSTMENT` line.
- Non-Stripe bank lines that no keyword rule matches are flagged
  “Uncategorized — add a rule”.
