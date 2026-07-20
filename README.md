# Cross Way Ledger

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
- **Database:** PostgreSQL everywhere - dev, CI tests, staging, and prod all run
  the same database engine (SQLite is not used anywhere anymore; see
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for why). Schema is managed
  with Alembic migrations, not hand-written `ALTER TABLE`.
- **Frontend:** React + Vite + TypeScript
- **Packaging:** Docker Compose, identical stack in every environment
- **Reverse proxy / TLS:** Caddy (automatic HTTPS in staging/prod, self-signed
  `tls internal` in dev)

## Run with Docker (recommended)

```bash
cp .env.example .env      # edit POSTGRES_PASSWORD
docker compose up -d --build
```

- Frontend: http://localhost:8080
- Backend API + docs: http://localhost:8000/api/health, http://localhost:8000/docs

The Chart of Accounts and a starter set of rules are seeded automatically on first
startup.

**Where to go next:**
- **[docs/STATUS.md](docs/STATUS.md)** - where development left off (read this
  first when resuming a session).
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** - how the app is put
  together, and how dev/test/staging/prod fit together as environments.
- **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** - the full dev/staging/prod
  setup: DigitalOcean droplets, system requirements, CI/CD, and backups.
- **[docs/PROJECT.md](docs/PROJECT.md)** - the project knowledge base
  (business logic, data model, feature history).
- **[docs/DATA_DICTIONARY.md](docs/DATA_DICTIONARY.md)** - every table and
  column, in plain language.

## Authentication

The app requires login. A seed admin is created on first startup from
`ADMIN_USERNAME` / `ADMIN_PASSWORD` (defaults `admin` / `changeme` — **change
these**, and set a strong `SECRET_KEY`, before exposing publicly). Admins add more
users in the **Users** tab. All API endpoints except `/api/health` and
`/api/auth/login` require a Bearer token.

## Run locally without Docker (fastest loop)

**Backend** (needs a real Postgres - `docker compose up -d db` starts just the
`db` service, or point `DATABASE_URL` at any reachable Postgres):

```powershell
docker compose up -d db
cd backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m alembic upgrade head   # creates/updates the schema
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

Run `alembic upgrade head` again any time you pull a change that touches
`app/models.py` - the app no longer creates or alters tables on startup itself.

**Frontend** (proxies `/api` to the backend at :8000):

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

## Tests

Tests run against a real Postgres instance - same engine as every real
environment, no SQLite fallback. Start one (the `db` service already in
`docker-compose.yml` works), then:

```powershell
docker compose up -d db
cd backend
.\.venv\Scripts\python.exe -m pip install -r requirements.txt pytest httpx
$env:DATABASE_URL = "postgresql+psycopg://ledger_user:recon@localhost:5432/ledger_db"
cd ..
.\backend\.venv\Scripts\python.exe -m pytest
```

## Project layout

```
backend/
  alembic/             Migrations (schema history) - `alembic upgrade head` applies them
  app/
    main.py            FastAPI app + startup (runs the seed; schema itself is Alembic's job)
    config.py          Settings (DATABASE_URL, CORS, auth, Google Sign-In)
    database.py        SQLAlchemy engine/session
    models.py          User, ChartOfAccount, CategoryRule, ReconRun/ReconLine,
                        ReconciliationEntry, AccrualEntry, BudgetEntry, ...
    schemas.py         Pydantic request/response models
    seed.py            Seeds Chart of Accounts (CSV), default rules, seed admin
    routers/           auth, reconcile, rules, coa, bank_accounts, reconciliation,
                        accrual, budget, general_ledger, income_statement,
                        dashboard, settings
    services/          parsers, categorizer, reconciler, coa_numbering, reporting,
                        fiscal, ledger  (core logic)
    data/chart_of_accounts.csv
  tests/               pytest + sample CSV fixtures (require Postgres - see Tests)
frontend/
  src/
    api/               Typed API client, one module per router
    pages/             Home, Upload, Reconciliation, Accrual, Budget, GeneralLedger,
                        IncomeStatement, Accounts, Rules, Users, Config, LinkReceipts
docker-compose.yml        base stack (local dev)
docker-compose.prod.yml   overlay: adds Caddy, locks down direct port access
docker/dev-caddy/         dev-only Caddy image (self-signed tls internal)
scripts/provision-vps.sh  one-time droplet bootstrap (staging/prod)
```

## How categorization works

`priority` (lower wins). The **Chart of Accounts** tab has three top-down creation
forms (Category → Item → Account) - see
[docs/DATA_DICTIONARY.md](docs/DATA_DICTIONARY.md) for the full numbering scheme -
plus edit/delete on individual accounts (deleting one in use by a rule or ledger
entry is blocked with a friendly error).

## Notes / assumptions

- Stripe donation **fund** and **donor** are read from the transaction Description
  (`Donation #… - <Donor> - <Fund> (...)`) and Planning Center metadata columns.
- Exploded donation amounts use the Stripe **Net** (post-fee) value so they sum to
  the bank deposit. Any residual (payout-level fees/timing) is written as a single
  `STRIPE PAYOUT ADJUSTMENT` line.
- Non-Stripe bank lines that no keyword rule matches are flagged
  “Uncategorized — add a rule”.
