# Cross Way Ledger

**The financial management system for Cross Way Mar Thoma Church** — reconciliation, ledgers, budgeting, reporting, and pledge campaign tracking in one application.

Cross Way Ledger replaces a manual, spreadsheet-driven workflow for reconciling giving and expenses with a guided, auditable system: bank statements and Stripe donation exports are matched and categorized automatically, every dollar traces back to a real transaction, and role-based permissions control who can see and edit what.

📖 **[Full documentation](docs/README.md)** — user guides for every page and wizard, plus technical reference for engineers and administrators.

---

## What it does

| Capability | Summary |
| --- | --- |
| **Bank reconciliation** | A guided wizard matches every bank deposit to its underlying Stripe donations, categorizes each line automatically using editable rules, and validates the totals before anything is committed. |
| **Ledgers** | Actual, Accrual, Budget, and Restricted Net Assets — four ledgers, one shared Chart of Accounts. |
| **Reporting** | A live combined General Ledger view and a Plan-vs-Actual Income Statement, both exportable to Excel. |
| **Pledge campaigns** | Track a fundraising campaign's pledges against real giving, with automatic donor matching and joint-giver handling. |
| **Access control** | Google Workspace or username/password sign-in, with per-page permissions for every user. |

New to the app? Start with **[Getting Started](docs/guides/getting-started.md)**.

## How it's built

- **Backend** — FastAPI + SQLAlchemy (Python 3.12), schema managed entirely through Alembic migrations.
- **Frontend** — React + Vite + TypeScript.
- **Database** — PostgreSQL everywhere: local development, automated tests, and production all run the identical engine, so a bug can never hide behind an environment difference.
- **Infrastructure** — Google Cloud Run (containers) + Cloud SQL (PostgreSQL), with a GitHub Actions pipeline that builds once and promotes the same image from dev to production behind a manual approval gate.

See **[Architecture](docs/ARCHITECTURE.md)** for the full system diagram, authentication flow, and data model — and **[Deployment Guide](docs/DEPLOYMENT.md)** for standing up or operating the cloud infrastructure.

## Local development

```bash
cp .env.example .env      # edit POSTGRES_PASSWORD
docker compose up -d --build
```

- Frontend: http://localhost:8080
- Backend API + interactive docs: http://localhost:8000/api/health, http://localhost:8000/docs

The Chart of Accounts and a starter set of categorization rules are seeded automatically on first startup. A seed admin account is created from the `ADMIN_USERNAME` / `ADMIN_PASSWORD` environment variables (**change the defaults** before exposing this anywhere beyond your own machine).

### Running the backend and frontend separately

```powershell
# Backend - needs a reachable Postgres (docker compose up -d db starts just that service)
docker compose up -d db
cd backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

Re-run `alembic upgrade head` any time you pull a change that touches `app/models.py` — the app never creates or alters tables on startup itself; migrations are the only path.

```powershell
# Frontend - proxies /api to the backend at :8000
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

### Running the test suite

```powershell
docker compose up -d db
cd backend
.\.venv\Scripts\python.exe -m pip install -r requirements.txt pytest httpx
$env:DATABASE_URL = "postgresql+psycopg://ledger_user:recon@localhost:5432/ledger_db"
.\.venv\Scripts\python.exe -m pytest
```

Tests always run against a real Postgres instance — there is no SQLite fallback anywhere in this project, by design (see [Architecture](docs/ARCHITECTURE.md) for why environment parity is treated as a hard requirement).

## Project layout

```
backend/
  alembic/             Schema migrations - `alembic upgrade head` applies them
  app/
    main.py            FastAPI app + startup
    config.py          Settings (database URL, CORS, auth, Google Sign-In)
    database.py        SQLAlchemy engine/session
    models.py          The full data model - see docs/DATA_DICTIONARY.md
    schemas.py         Pydantic request/response models
    seed.py            Seeds the Chart of Accounts, default rules, and the seed admin
    routers/           One file per feature area (auth, reconciliation, accrual, budget,
                       restricted_transfers, general_ledger, income_statement, coa, rules,
                       bank_accounts, pledge_campaigns, donors, donations, dashboard, settings)
    services/          Core business logic (parsing, categorization, reconciliation,
                       account numbering, fiscal-year math, pledge import, reporting)
    data/              Seed data (Chart of Accounts CSV)
  tests/               pytest suite + sample CSV fixtures (requires Postgres)
frontend/
  src/
    api/               Typed API client, one module per backend router
    pages/             One folder/file per app page - see docs/README.md's user guides
                       for what each one does
docker-compose.yml     Local development stack
```

## Notes on the reconciliation logic

- Stripe donation **fund** and **donor** are read from the transaction description and Planning Center metadata.
- Exploded donation amounts use the Stripe **net** (post-fee) value, so they always sum exactly to the bank deposit. Any residual (payout-level fees or timing differences) is written as a single `STRIPE PAYOUT ADJUSTMENT` line.
- A non-Stripe bank line with no matching keyword rule is flagged for categorization rather than silently skipped or guessed at.

For the full walkthrough of this workflow, see **[Bank Reconciliation & Upload Wizard](docs/guides/bank-reconciliation-upload-wizard.md)**.
