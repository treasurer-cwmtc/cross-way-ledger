# Status / Handoff

_Where we left off — read this first when resuming in a new session._

**Repo:** https://github.com/treasurer-cwmtc/cross-way-ledger
**Last updated:** 2026-07-20 (database normalization, issue #23, redone and committed)

> Start every session by reading **[PROJECT.md](PROJECT.md)** (full knowledge base:
> goal, reconciliation logic, data model, stack), **[ARCHITECTURE.md](ARCHITECTURE.md)**
> (how it's put together, including the environment topology), and this file.

---

## Done so far

- ✅ **Initial POC** — FastAPI + PostgreSQL (SQLite fallback at the time) +
  React/Vite, Docker Compose. Reconciles Chase ↔ Stripe: matches bank
  `STRIPE…TRANSFER` payouts, explodes each into per-donation lines, categorizes
  via two editable rule sets. CSV export.
- ✅ **Repo setup, CI, docs, branch protection.**
- ✅ **Authentication** — per-user accounts, PBKDF2 hashing, JWT, admin
  user-management, all API routes protected.
- ✅ **Chart of Accounts CRUD** with a real 3-level hierarchy (Category → Item →
  Account), true auto-increment codes scoped to parent, never reused.
- ✅ **Reconciliation ledger** ("Actual" tab) — persistent, hand-editable,
  dedup on import, split/undo-split, column-health indicators, verified
  against the live legacy spreadsheet's actual formulas.
- ✅ **Accrual tab** — same shape as Actual, manually entered, no dedup.
- ✅ **Type-to-filter Chart of Accounts picker.**
- ✅ **Config tab** — fiscal year rollover, frequency, audit validation
  date range, all as generic `AppSetting` rows.
- ✅ **Budget / General Ledger / Income Statement** — Budget as a real
  multi-entry ledger (not one row per account), General Ledger as the union
  read-only view, Income Statement as Plan vs Actuals vs Variance.
- ✅ **Home dashboard**, **Upload Wizard** UX polish, **Accrual Bank
  Description column**.
- ✅ **Renamed the app to "Cross Way Ledger"** — title, package.json, docs,
  the GitHub repo itself.
- ✅ **Google Drive receipt attachment** (Picker, `drive.file` scope) +
  **Link Receipts** bulk-attach tool.
- ✅ **Google Sign-In (additive) + per-page permissions**, with a clock-skew
  fix for token verification.

_(See git history for the full detail behind each of the above — this
session's work, below, is entirely about **how the app is built, tested,
and deployed**, not new app features.)_

### This session: dev/test/staging/prod environment build-out

Started from a single open question — *"stand up a container in Portainer"*
— and ended with a full four-environment architecture. The path there
matters as much as the destination; summarized here so it isn't re-litigated
next session.

- ✅ **Landed on: dev (home Portainer) → CI tests (GitHub Actions) → staging
  (DigitalOcean) → prod (DigitalOcean, manual approval)** — see
  [ARCHITECTURE.md](ARCHITECTURE.md) § 5 for the diagram and the reasoning.
  Considered and rejected along the way: Portainer-only (single point of
  failure, needs a VPN to reach), GCP Cloud Run + Cloud SQL (more secure
  ceiling but too much setup complexity for a 2-person team), a dedicated
  cloud dev environment / GitHub Codespaces (Google Sign-In's origin
  restrictions and per-dev cost made it not worth it once "dev" turned out
  to mean "other future developers, not just me").
- ✅ **No SQLite anywhere, on purpose.** Every environment — dev, CI tests,
  staging, prod — runs the identical Postgres/FastAPI/nginx/Caddy stack.
  `backend/app/config.py`'s `database_url` is now a **required** setting (no
  default) and `backend/app/database.py`'s SQLite-specific `connect_args`
  branch was removed as dead code. `backend/tests/test_auth.py` and
  `test_reconciler.py` were converted from an in-memory SQLite engine to a
  required real Postgres connection.
  - **Real bug found and fixed by this change**: `test_reconciler.py`'s
    `make_session()` never closed the session it returned. Harmless against
    SQLite (every call got its own throwaway in-memory DB), but against one
    shared Postgres instance, the next call's `drop_all()` hung indefinitely
    waiting on a lock held by the previous, still-open session. Fixed by
    explicitly `db.close()`-ing in a `finally` block. Verified: full 58-test
    suite passes in ~9s against real Postgres, no hang.
  - `ci.yml`'s backend job now runs a `postgres:16-alpine` service
    container and passes `DATABASE_URL` to pytest.
- ✅ **Dev environment**: stack `cross-way-ledger-dev` on the treasurer's
  home Portainer instance (`10.10.10.100:9000`, endpoint id `2`) — a
  general-purpose home server also running Jellyfin/Plex/Sonarr/etc., not a
  dedicated box, which is exactly why prod/staging live elsewhere. Four
  containers, one compose project, static IPs on the `nvncloud` macvlan
  network (`10.10.10.0/24`, gateway `.1`):
  | Service | IP |
  | --- | --- |
  | `db` (Postgres 16) | `10.10.10.108` |
  | `backend` | `10.10.10.109` |
  | `frontend` | `10.10.10.110` |
  | `caddy` (front door) | `10.10.10.111` |
  Images (`cross-way-ledger-{backend,frontend,caddy}:dev`) are built
  directly against the Portainer host's Docker Engine API from whatever's
  currently checked out locally (not from GHCR/CI) — this is deliberate:
  dev's whole purpose is running code that hasn't reached `main` yet, so it
  can never be "the same build" as staging/prod, only "the same stack".
  Access: `https://dev.ledger.crosswaymtc.org/` (hosts-file entry required,
  see below), `admin` / `dev-changeme-2026`, self-signed cert (Caddy `tls
  internal`) — click through the browser warning once.
  - **Google Sign-In in dev required two non-obvious fixes**: (1) Google
    rejects raw IP addresses as an Authorized JavaScript origin entirely
    (only `https://` + a real public-TLD hostname, or `localhost`) — solved
    with a hosts-file entry (`10.10.10.111 dev.ledger.crosswaymtc.org`)
    pointing a real subdomain of `crosswaymtc.org` at the LAN IP; no public
    DNS record needed, Google only validates the string format. (2)
    `VITE_GOOGLE_CLIENT_ID` is a Vite **build-time** value, not runtime —
    nothing in this repo's Dockerfile or CI ever passed it, so **Google
    Sign-In would have been silently broken in staging/prod too**, not just
    dev. Fixed at the source: `frontend/Dockerfile` now accepts a
    `VITE_GOOGLE_CLIENT_ID` build arg, `.github/workflows/deploy.yml` passes
    it from a `vars.VITE_GOOGLE_CLIENT_ID` repository Variable (not a
    Secret — a Client ID is meant to be public).
  - **Lesson learned the hard way**: a prior session's DB-normalization/
    Alembic work (issue #23) existed only as applied schema state on this
    Portainer host's Postgres volume — never committed to git. It had to be
    wiped (blocking a fresh deploy) and is now **gone**, not just paused.
    That work needs to be redone from scratch, deliberately, with real
    migration files committed to git this time — see Next steps. This is
    also why `docs/DEPLOYMENT.md` now opens its Backups section with "a
    backup is only half the story."
- ✅ **Staging + prod pipeline built, not yet deployed** (no DigitalOcean
  droplets exist yet — needs a DO API token to actually create them):
  - `scripts/provision-vps.sh` — one-time droplet bootstrap: Docker, a
    non-root `deploy` user (SSH-key-only, no root login), `ufw` locked to
    SSH/80/443, fail2ban, unattended-upgrades.
  - `docker-compose.prod.yml` — overlay adding Caddy and unpublishing
    `db`/`backend`/`frontend` ports (`!reset []`, requires Compose v2.24+);
    only Caddy is ever reachable from outside a droplet.
  - `.github/workflows/deploy.yml` — build once (git-SHA-tagged images to
    GHCR) → auto-deploy to staging → **(next: smoke test, not yet added —
    see Next steps)** → manual-approval-gated (`production` GitHub
    Environment) → promote the *same* image to prod.
  - `docs/DEPLOYMENT.md` fully rewritten: system requirements, droplet
    specs/purpose, provisioning, DNS, GHCR auth, GitHub Actions secrets,
    backups (below), troubleshooting.
- ✅ **Real, tested backup/restore/verify scripts** — the previous "lost
  work" incident made this non-negotiable:
  - `scripts/backup.sh` — nightly `pg_dump` → gzip, fails loudly (non-zero
    exit) if the dump is missing or suspiciously small, prunes backups
    older than 14 days.
  - `scripts/verify-backup.sh` — **actually restores** the latest backup
    into a throwaway database and confirms real row counts, then drops it.
    An untested backup is not a backup; intended to run weekly via cron.
  - `scripts/restore.sh` — destructive restore, requires typing a
    confirmation phrase, no unattended `--force` flag on purpose.
  - **Verified end-to-end against real dev data**: `pg_dump` → gzip →
    restore into a fresh `backup_verify_test` database → confirmed exactly
    362 `chart_of_accounts` rows survived (matches the documented seed
    count) → cleaned up. The mechanics work, not just the scripts' syntax.
  - Off-box copy to the treasurer's Synology NAS via a nightly `rsync`
    *pull* (Synology connects outward over SSH; nothing is exposed inbound
    on the home network, no VPN needed).
- ✅ **GitHub CLI authenticated via the browser device-code flow**
  (`gh auth login --web`), not a pasted PAT — the token never touched this
  chat, `gh` stores it in its own credential store. Scopes: `repo`,
  `read:org`, `gist`. `doctl` (DigitalOcean CLI) — see Next steps, awaiting
  the DO API token.
- ✅ **Naming fixed**: "Cross Way" is two words. All dev Portainer
  resources (previously `crossway-ledger-*`) renamed to `cross-way-ledger-*`
  to match the actual repo/product name.

### Database normalization (issue #23) — redone, this time committed

The work described in "Lesson learned the hard way" above was rebuilt from
scratch on `feature/db-normalization-alembic`, then rebased twice more: once
onto this session's new no-SQLite/`ledger_db`/`ledger_user` reality, and
again onto the Phase 2 pledge-tracking merge (PR #24) once that landed on
`main` mid-session - the migration was regenerated after that second rebase
so it captures every table, not just the ones that existed when this work
started:

- ✅ **Real foreign keys** on every `account_no` column
  (`reconciliation_entries`, `accrual_entries`, `budget_entries`,
  `category_rules` → `chart_of_accounts`), nullable on the three ledgers
  since "uncategorized" is a valid state. A shared `@validates` normalizer
  converts the frontend's `""` sentinel to `NULL` on write; reads coerce
  back to `""` so the API contract is unchanged.
- ✅ **`ChartOfAccount`'s denormalized Statement Category/Item columns**
  replaced with live-derived `@property`s off the existing `parent_item`
  relationship.
- ✅ **`delete_account` ledger-usage guard** — blocks deleting an account in
  use by any ledger (previously only checked Category Rules), plus a global
  `IntegrityError` handler so any other constraint violation (e.g. a bad
  `account_no`) returns a clean 400, not a raw 500.
- ✅ **One clean Alembic migration** (`8a8d8425fdc6_initial_schema`) -
  covers every table including Phase 2 pledge tracking (previously created
  only via `create_all`, with no migration of its own). Verified to
  bootstrap correctly from a truly empty Postgres database, and applied
  cleanly against a throwaway database on the same server as the shared dev
  Postgres (never against `ledger_db` itself, which is live). **This time
  the migration file is committed to git** - not just applied database
  state.
- ✅ **63 tests passing** against real Postgres (5 new integrity tests for
  the FK rejection and delete guard).

---

## Next steps (GitHub issues)

- **Actually create the DigitalOcean droplets and deploy** — everything above
  is built and tested but nothing is live yet. Needs a DO API token (see
  `docs/DEPLOYMENT.md` § 1-5). Once created: run `provision-vps.sh` on both,
  set DNS, wire up GitHub Actions secrets + the `production` environment
  approval gate, push to `main`, watch it deploy.
- **Add a smoke-test job to `deploy.yml`** between `deploy-staging` and the
  prod approval gate — hit staging's `/api/health` (and ideally a real
  login) before a human is even asked to approve promoting to prod. Would
  have caught the dev crash-loop bug automatically instead of needing a
  manual log check.
- **#7 CI/CD auto-deploy to VPS** — done, see this session's work above.
  Close this issue once staging/prod are actually live.
- **Auditor-specific screens** (phase 4 of the finance-UI push) — a
  read-only, audit-focused view.
- **#2 Saved run history UI**, **#3 Roster-based donor normalization**,
  **#4 Direct export to the accounting system**, **#5 Automated Stripe &
  Chase pulls**, **#6 Confirm Net vs gross+fee handling** — unchanged from
  before, still open.
- **Chart of Accounts CSV bulk import**, **Reconciliation follow-ups**,
  **Wire up Frequency / Audit Validation**, **Add missing Stripe fund
  rules** — unchanged from before, still open (see prior revisions of this
  file in git history for the full detail on each).

---

## How to resume quickly

**Local dev** (your own machine, non-Docker, fastest loop):

```powershell
docker compose up -d db      # real Postgres - no SQLite fallback exists anymore
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
# separate terminal
cd frontend
npm run dev        # http://localhost:5173
```

**Or the full stack via Docker Compose** (matches every real environment):

```bash
cp .env.example .env
docker compose up -d --build
# http://localhost:8080
```

**Dev on the home Portainer instance** (stack `cross-way-ledger-dev`,
already running): `https://dev.ledger.crosswaymtc.org/` (needs the
hosts-file entry, see above), `admin` / `dev-changeme-2026`. To rebuild it
after code changes, see `docs/DEPLOYMENT.md` — or ask a future Claude
session, which can drive the Portainer API directly given the access token
(rotate it periodically; it's a long-lived credential).

Default local-dev login: `admin` / `changeme` (or whatever `ADMIN_USERNAME`/
`ADMIN_PASSWORD` you set in `.env`).

**Tests** (real Postgres required, no default):

```bash
docker compose up -d db
DATABASE_URL=postgresql+psycopg://ledger_user:recon@localhost:5432/ledger_db pytest
```

---

## Workflow notes / gotchas

- **Pushing to GitHub**: `gh` CLI is installed and authenticated via the
  browser device-code flow (not a stored PAT) — `git push` and `gh issue`
  commands should just work. If a future session finds `gh auth status`
  logged out, re-run `gh auth login --web` rather than falling back to a
  manually-pasted token.
- **Branch protection** allows direct pushes to `main` (only force-push/
  delete are blocked), so no PR is required for solo work.
- **Commit trailer**: `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.
- **Google OAuth origins**: no raw IPs, ever — must be `https://` + a real
  public-TLD hostname, or `localhost`. Costs real time if you forget this
  and try to register a droplet's bare IP or a `.local`/`.internal` name.
- **DigitalOcean billing**: powering off a droplet does **not** stop
  billing — compute/disk/IP stay reserved either way. Only *destroying* it
  (optionally after a snapshot) stops the charge. Don't design any
  cost-saving plan around "just turn it off."
- **The home Portainer instance is shared** with unrelated personal
  services (Jellyfin, Plex, Sonarr, etc.) on a `10.10.10.0/24` macvlan
  network (`nvncloud`, gateway `.1`) — `.108`-`.111` are reserved for
  `cross-way-ledger-dev`. Treat this box as dev-only, never as a substitute
  for staging/prod.
- **Backups are not optional** — see `docs/DEPLOYMENT.md` § 6. If you ever
  find yourself about to run something destructive (`DROP SCHEMA`,
  `docker compose down -v`, a stack redeploy that wipes a volume) against
  anything other than the dev environment, stop and confirm a recent,
  *verified* (not just present) backup exists first.
