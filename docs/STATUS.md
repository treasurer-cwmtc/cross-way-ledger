# Status / Handoff

_Where we left off — read this first when resuming in a new session._

**Repo:** https://github.com/treasurer-cwmtc/Tracker
**Local path (Windows):** `C:\Users\nmathew\source\repos\bank-stripe-recon`
**Last updated:** 2026-07-13

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

**Tests:** 12 passing (`cd backend; .\.venv\Scripts\python.exe -m pytest`).
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
- **#8 Google Drive receipt linking** — attach a Drive file to a transaction via
  the Google Picker API. Blocked on the transaction entry screen (not yet built;
  comes after Chart of Accounts work).
- **#9 Google Sign-In** — login via `crosswaymtc.org` Google Workspace (nonprofit),
  domain-restricted. Can share an OAuth client with #8. **Decided: replaces** the
  existing username/password auth (not an add-on).

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
