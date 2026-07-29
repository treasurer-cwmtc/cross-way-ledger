# Deployment Guide

*How Cross Way Ledger's infrastructure is set up and operated on Google Cloud — for whoever needs to stand up a new environment, rotate a credential, restore a backup, or just understand what's actually running in production.*

---

## Contents

1. [Infrastructure overview](#1-infrastructure-overview)
2. [One-time project setup](#2-one-time-project-setup)
3. [Cloud SQL (the database)](#3-cloud-sql-the-database)
4. [Cloud Run (the application)](#4-cloud-run-the-application)
5. [Custom domains](#5-custom-domains)
6. [CI/CD pipeline](#6-cicd-pipeline)
7. [Secrets](#7-secrets)
8. [Backups & disaster recovery](#8-backups--disaster-recovery)
9. [Database access for people, not just the app](#9-database-access-for-people-not-just-the-app)
10. [External BI tools (Looker Studio, Google Sheets)](#10-external-bi-tools-looker-studio-google-sheets)
11. [Reimbursements module: outbound email (SMTP)](#11-reimbursements-module-outbound-email-smtp)
12. [Reimbursements module: Google Drive receipt uploads](#12-reimbursements-module-google-drive-receipt-uploads)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Infrastructure overview

Everything runs in a single Google Cloud project, **`cross-way-ledger`**, with two fully independent environments:

| | Dev | Prod |
| --- | --- | --- |
| Backend | `ledger-backend-dev` (Cloud Run, `us-south1`) | `ledger-backend-prod` (Cloud Run, `us-south1`) |
| Frontend | `ledger-frontend-dev` (Cloud Run, `us-central1`) | `ledger-frontend-prod` (Cloud Run, `us-central1`) |
| Database | `ledger-db-dev` (Cloud SQL for PostgreSQL) | `ledger-db-prod` (Cloud SQL for PostgreSQL) |
| Domain | `ledger-dev.crosswaymtc.org` | `ledger.crosswaymtc.org` |

> **Why frontend runs in a different region than backend:** Cloud Run custom domain mappings are not supported in `us-south1` at the time this was set up. The frontend was moved to `us-central1` specifically to support domain mapping; the backend stayed in `us-south1`. Cross-region Cloud Run-to-Cloud Run communication over HTTPS works fine — there's no requirement that they share a region.

Container images for both services are built once per commit and stored in **Artifact Registry** (`cross-way-ledger` Docker repository), then deployed unchanged to dev, and — after approval — to prod. See [§6](#6-cicd-pipeline) for the full pipeline.

## 2. One-time project setup

This section only matters if you're standing up a **new** GCP project from scratch (e.g. disaster recovery, or forking this into a new deployment). If you're operating the existing `cross-way-ledger` project, skip to [§3](#3-cloud-sql-the-database).

1. Create the project and link a billing account in the [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the required APIs:
   ```bash
   gcloud services enable \
     run.googleapis.com \
     sqladmin.googleapis.com \
     artifactregistry.googleapis.com \
     cloudbuild.googleapis.com \
     secretmanager.googleapis.com \
     iam.googleapis.com
   ```
3. Install and authenticate the `gcloud` CLI (`gcloud auth login`, `gcloud config set project cross-way-ledger`).

## 3. Cloud SQL (the database)

Both instances run **PostgreSQL 16**. Create one like this:

```bash
gcloud sql instances create ledger-db-dev \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --edition=ENTERPRISE \
  --region=us-south1
```

> **`--edition=ENTERPRISE` is required** for the smaller legacy tiers like `db-f1-micro` — newer projects default to `ENTERPRISE_PLUS`, which rejects them.

Once created:

```bash
gcloud sql databases create ledger_db --instance=ledger-db-dev
gcloud sql users create ledger_user --instance=ledger-db-dev --password=<generate a strong password>
```

### Connecting from Cloud Run

Cloud Run connects to Cloud SQL over a Unix socket, not a public IP — no network exposure is needed for the app itself:

```
postgresql+psycopg://ledger_user:<password>@/ledger_db?host=/cloudsql/cross-way-ledger:us-south1:ledger-db-dev
```

This full connection string is what's stored in Secret Manager (see [§7](#7-secrets)) and injected into the Cloud Run service as `DATABASE_URL`.

### Migrations run automatically

The backend's container `CMD` runs `alembic upgrade head` before starting `uvicorn`, every time a new revision deploys — in both dev and prod. There is no separate manual migration step; deploying a new image *is* the migration step.

### Auto-stopping dev when idle (cost optimization)

Cloud SQL instances bill 24/7 regardless of usage — unlike Cloud Run, they don't scale to zero on their own. Since `ledger-db-dev` is only needed during active development, a small Cloud Function (`infra/dev-db-idle-stopper/`) checks its CPU utilization over the trailing 12 hours, on an hourly Cloud Scheduler trigger, and stops it (`activation-policy=NEVER`) if nothing happened in that window. `ledger-db-prod` is never touched by this - it's hardcoded to `ledger-db-dev` only.

**There is no automatic wake-up.** Cloud SQL has no way to detect "someone is about to connect" and start itself back up the way a serverless database can. If you find `ledger-db-dev` stopped, start it manually:

```bash
gcloud sql instances patch ledger-db-dev --activation-policy=ALWAYS
```

> **Before pushing to `main`**, make sure dev is running - the CI/CD pipeline auto-deploys to dev on every push and will fail if it's stopped mid-deploy.

The pieces, if you need to rebuild or adjust this:

- **Service account**: `dev-db-idle-stopper@cross-way-ledger.iam.gserviceaccount.com`, with `roles/cloudsql.editor` (to stop the instance) and `roles/monitoring.viewer` (to read its CPU metric), plus `roles/run.invoker` on the function's own underlying Cloud Run service (required for Scheduler to call it).
- **Cloud Function** (`dev-db-idle-stopper`, gen2, `us-south1`, HTTP-triggered, no unauthenticated access): source in `infra/dev-db-idle-stopper/`.
- **Cloud Scheduler job** (`dev-db-idle-check`, `us-south1` is not a supported Scheduler region - this runs from `us-central1` instead, calling the function's URL cross-region): fires hourly (`0 * * * *`), authenticated via an OIDC token minted for the service account above.
- To change the idle threshold, edit `IDLE_HOURS` in `infra/dev-db-idle-stopper/main.py` and redeploy:
  ```bash
  cd infra/dev-db-idle-stopper
  gcloud functions deploy dev-db-idle-stopper --gen2 --region=us-south1 --source=.
  ```

## 4. Cloud Run (the application)

Both backend and frontend are deployed via the CI/CD pipeline (see [§6](#6-cicd-pipeline)), not manually — but for reference, a manual deploy looks like:

```bash
gcloud run deploy ledger-backend-dev \
  --image=us-south1-docker.pkg.dev/cross-way-ledger/cross-way-ledger/backend:<tag> \
  --region=us-south1 \
  --add-cloudsql-instances=cross-way-ledger:us-south1:ledger-db-dev \
  --set-secrets=DATABASE_URL=ledger-db-url-dev:latest,SECRET_KEY=ledger-secret-key-dev:latest \
  --allow-unauthenticated
```

### "Build once, promote to prod"

The same container image is deployed to dev first, then to prod after approval, completely unchanged. This only works because the frontend doesn't bake its backend URL in at build time. Instead:

1. A container-startup script (`frontend/docker/40-env-config.sh`) runs when the frontend container boots, reading an `API_BASE` environment variable set on the Cloud Run service.
2. It generates a small `window.__ENV__ = { API_BASE: "..." }` file, served as `/env-config.js` and loaded before the app's own JavaScript bundle.
3. The frontend's API client reads `window.__ENV__.API_BASE` at runtime, falling back to a build-time default only if it's missing (e.g. local `npm run dev`).

Each environment's Cloud Run service sets its own `API_BASE` (dev points at the dev backend URL, prod at the prod backend URL) — the image itself never needs to know which environment it's running in.

## 5. Custom domains

Domain mappings are configured directly on the frontend Cloud Run services:

```bash
gcloud beta run domain-mappings create \
  --service=ledger-frontend-prod \
  --domain=ledger.crosswaymtc.org \
  --region=us-central1
```

Follow the DNS instructions `gcloud` prints (a CNAME or set of A/AAAA records at your DNS provider) and wait for the managed TLS certificate to provision — this can take anywhere from a few minutes to a few hours.

## 6. CI/CD pipeline

Defined in `.github/workflows/deploy.yml`, this pipeline runs on every push to `main`:

```
build  →  deploy-dev (automatic)  →  deploy-prod (requires manual approval)
```

- **`build`** — authenticates to GCP via **Workload Identity Federation** (no long-lived service account key ever leaves GCP), runs the backend test suite against a real Postgres container, then builds and pushes both the backend and frontend images to Artifact Registry, tagged with the commit SHA (and `:latest`).
- **`deploy-dev`** — deploys both images to the `-dev` Cloud Run services immediately. No human involved.
- **`deploy-prod`** — deploys both images to the `-prod` Cloud Run services, but **only after a human approves it**. This is a real GitHub Environment protection rule (`production`), not a soft convention — the workflow run genuinely pauses and waits.

### Approving a production deploy

Whoever has been added as a required reviewer on the `production` GitHub Environment can approve a pending deployment from the **Actions** tab on the pending workflow run, or via:

```bash
gh api repos/treasurer-cwmtc/cross-way-ledger/actions/runs/<run-id>/pending_deployments \
  -f 'environment_ids[]=<env-id>' -f 'state=approved'
```

> Always confirm the pending run is actually the one you intend to promote — if multiple commits landed on `main` in quick succession, older pending prod deploys should be rejected (not approved) once a newer one supersedes them, to avoid deploying out of commit order.

### Workload Identity Federation setup (reference)

The GitHub Actions workflow authenticates as the `github-actions-deployer` service account via a Workload Identity Pool, scoped so **only this repository** can assume it:

```bash
gcloud iam workload-identity-pools create github-actions-pool --location=global
gcloud iam workload-identity-pools providers create-oidc github-actions-provider \
  --location=global --workload-identity-pool=github-actions-pool \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='treasurer-cwmtc/cross-way-ledger'"
```

The deployer service account needs `roles/storage.objectViewer`, `roles/artifactregistry.writer`, `roles/logging.logWriter`, `roles/cloudsql.client`, and `roles/secretmanager.secretAccessor` granted on the project — none of these are granted by default on a fresh GCP project.

## 7. Secrets

All sensitive configuration lives in **Secret Manager**, never in the repository or a workflow file:

| Secret | Used by |
| --- | --- |
| `ledger-db-url-dev` / `-prod` | The full `DATABASE_URL` connection string for the backend |
| `ledger-secret-key-dev` / `-prod` | JWT signing key |
| `ledger-admin-password-dev` / `-prod` | Seed admin account password |
| `ledger-smtp-password` | App Password for the `noreply@crosswaymtc.org` mailbox that sends Reimbursements emails (OTP codes, notifications) - **one shared secret**, not per-environment, since dev and prod send through the same real mailbox |

To read a secret:

```bash
gcloud secrets versions access latest --secret=ledger-db-url-prod
```

> **PowerShell pipe warning**: piping a value directly into `gcloud secrets create --data-file=-` from PowerShell (`$value | gcloud secrets create ...`) silently prepends a UTF-8 BOM byte, corrupting the secret. Write the value to a file first with an explicit no-BOM encoding, then pass `--data-file=<path>`:
> ```powershell
> [System.IO.File]::WriteAllText($path, $value, (New-Object System.Text.UTF8Encoding $false))
> gcloud secrets create my-secret --data-file=$path
> ```

## 8. Backups & disaster recovery

Both Cloud SQL instances have **automated daily backups and point-in-time recovery enabled**, with 7-day retention:

```bash
gcloud sql instances patch ledger-db-prod \
  --backup-start-time=02:00 \
  --enable-point-in-time-recovery \
  --retained-backups-count=7 \
  --retained-transaction-log-days=7
```

Point-in-time recovery means you can restore to *any moment* within the retention window, not just the nightly snapshot — useful if a bad import or an accidental delete is discovered hours after it happened.

To restore, clone the instance to a point in time rather than restoring in place, so you can verify the data before cutting over:

```bash
gcloud sql instances clone ledger-db-prod ledger-db-prod-restore \
  --point-in-time="2026-07-26T14:00:00Z"
```

Cost is billed per GB-month of actual backup storage (list price roughly $0.08/GB/month); both instances are small, so this typically adds well under $2/month combined.

## 9. Database access for people, not just the app

Cloud SQL supports **IAM database authentication** — signing in with a Google identity instead of a database password. This is enabled on both instances for the accounts that need direct query access.

To grant a new person this kind of access:

```bash
# 1. Create them as an IAM database user (their Postgres role name is their email)
gcloud sql users create someone@crosswaymtc.org --instance=ledger-db-prod --type=cloud_iam_user

# 2. Grant them the IAM role that lets them actually authenticate
gcloud projects add-iam-policy-binding cross-way-ledger \
  --member="user:someone@crosswaymtc.org" --role="roles/cloudsql.instanceUser"

# 3. Grant them database-level privileges (connect first via a temporarily-authorized IP)
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "someone@crosswaymtc.org";
```

They can then open **Cloud SQL Studio** in the Console and sign in with their Google account directly — no password to distribute or remember.

## 10. External BI tools (Looker Studio, Google Sheets)

### Looker Studio

A dedicated read-only Postgres role, **`ledger_reporting`**, exists specifically for BI tools that connect directly to Postgres (Looker Studio's PostgreSQL connector). It has `SELECT`-only access to the `reporting` schema, which currently exposes a single view, `vw_ledger_generalledger` — the General Ledger, unioned across all four ledgers (see [Data Dictionary](DATA_DICTIONARY.md#reporting-views-reporting-schema)).

> **Google Sheets has no native Postgres/Cloud SQL connector** — its "Connected Sheets" feature only supports BigQuery, Google Analytics, and a few other Google products. Don't try to point Sheets' data connector at `ledger_reporting` directly; use the Apps Script approach below instead.

To let an external tool connect:

1. The instance's public IP must be reachable — connections require SSL (`--ssl-mode=ENCRYPTED_ONLY`; **not** `--require-ssl`, which demands a client certificate most BI tools don't support).
2. Download the instance's server CA certificate for the tool's SSL configuration:
   ```bash
   gcloud sql instances describe ledger-db-prod --format="value(serverCaCert.cert)"
   ```
3. Connect using the `ledger_reporting` username/password, with SSL enabled and the CA certificate uploaded, but **client authentication left unchecked** (Looker Studio's toggle for this specifically breaks the connection if enabled with only a server cert available).

> **⚠️ Superseded as of 2026-07-29 — `ledger-db-prod` is no longer reachable from the internet.**
>
> This section previously instructed leaving the prod public IP open to `0.0.0.0/0` so Looker Studio could reach it. **That guidance is withdrawn.** The Looker Studio effort was dropped, and `authorizedNetworks` on `ledger-db-prod` has been cleared:
> ```bash
> gcloud sql instances patch ledger-db-prod --clear-authorized-networks
> ```
> The application is unaffected — Cloud Run reaches the database over the Cloud SQL unix socket (`?host=/cloudsql/<connection-name>` in `DATABASE_URL`), never the public IP. Verified after the change: `/api/health` 200, frontend 200, and a direct public-IP connection attempt times out.
>
> **Do not re-add `0.0.0.0/0`.** If you need direct database access for an ad-hoc query, use the Cloud SQL Auth Proxy with the IAM database users from [§9](#9-database-access-for-people-not-just-the-app) — that authenticates through Google's APIs and needs no authorized-network entry at all:
> ```bash
> cloud-sql-proxy cross-way-ledger:us-south1:ledger-db-prod --auto-iam-authn
> ```
> Note `ledger-db-dev` is still open to `0.0.0.0/0` deliberately, for development convenience against non-production data.

### Google Sheets General Ledger export

Since Sheets can't connect to Postgres directly, the backend exposes a dedicated read-only endpoint, `GET /api/sheets/general-ledger`, authenticated with the **signed-in user's own Google identity** rather than a stored password. The code you'll paste in lives in `infra/sheets-general-ledger/` in the repo (two files: `Code.gs` and `appsscript.json`).

> ⚠️ **Before you start**: this only works once the code has actually been deployed to **prod** (the endpoint doesn't exist there until a pending deployment is approved on GitHub — see [§6](#6-cicd-pipeline)). If step 5 below fails with an error, this is the first thing to check.

**One-time setup, per Sheet — follow every step in order, don't skip ahead:**

1. Go to **sheets.google.com** and create a **Blank** spreadsheet.
2. In the menu bar at the top, click **Extensions**, then **Apps Script**. This opens a new tab/window — a separate code editor, not part of the Sheet itself.
3. You'll see a file called `Code.gs` with some placeholder text already in the editor (`function myFunction() {}`). **Select all of that placeholder text and delete it.** Open `infra/sheets-general-ledger/Code.gs` from the repo, copy its entire contents, and paste it into the now-empty editor.
4. On the **left-hand sidebar** of the Apps Script editor, click the **gear icon** ⚙️ — this is labeled **Project Settings** if you hover over it.
5. On the Project Settings page, find the checkbox labeled **"Show `appsscript.json` manifest file in editor"** and check it.
6. Go back to the left-hand sidebar — you'll now see a second file listed, `appsscript.json`, above `Code.gs`. Click it to open it. **Delete everything in it**, then open `infra/sheets-general-ledger/appsscript.json` from the repo, copy its entire contents, and paste them in.
7. Click the **save icon** (a floppy disk icon near the top, or press **Ctrl+S** / **Cmd+S**) to save both files.
8. Go back to the **gear icon / Project Settings** page one more time. Scroll down to the section titled **"Google Cloud Platform (GCP) Project"**. Click the button labeled **Change project**.
9. A box appears asking for a **"Project Number"** (not project name/ID — specifically the *number*). Paste in exactly this:
   ```
   633510572581
   ```
   Click **Set project**.
10. Go back to your actual **Google Sheet tab** (not the Apps Script editor) and **reload the page** (F5, or close and reopen it).
11. After it reloads, wait a few seconds, then look at the menu bar at the top. A new menu called **Cross Way Ledger** should appear (to the right of Help). If you don't see it, wait a bit longer and reload again — the first load after saving a script can take a moment.
12. Click **Cross Way Ledger → Refresh General Ledger**.
13. The **first time only**, this triggers a permission popup ("This app isn't verified" or "Authorization required"). This is expected and safe — it's Google's standard prompt the first time any script asks for your identity. Click through it: **Continue** (or **Advanced → Go to [project name] (unsafe)** if you see that phrasing — this warning is generic and shows for any internal script, not a sign of an actual problem), then **Allow** on the permissions list.
14. If everything's set up correctly (and prod has been deployed — see the warning above), a new tab named **"General Ledger"** appears at the bottom of your spreadsheet, filled with data, and a popup confirms how many rows were loaded.
15. Click anywhere inside that data, then use the menu **Insert → Pivot table** to build your pivot table.

**If step 12 or 13 gives an error instead**: note the *exact* error text and which step number it happened at — that's the fastest way to diagnose it. The most common causes: prod hasn't been deployed yet (see the warning above), or step 9's project number was mistyped.

**Why no explicit database credential is needed**: the backend verifies the Google ID token's signature, checks it's a `crosswaymtc.org` account, and looks up that email against the app's own Users table — the same account (and same `general-ledger` permission) already used to sign into the app itself.

**Refreshing later**: click **Cross Way Ledger → Refresh General Ledger** again any time, or — from the **Apps Script editor** (not the Sheet) — select `setupDailyRefreshTrigger` from the function dropdown near the top and click **Run** once, to refresh automatically every morning instead of doing it by hand.

## 11. Reimbursements module: outbound email (SMTP)

The Reimbursements portal (login codes, submission/status-change notifications) sends real email via plain SMTP against a Gmail/Workspace mailbox with an **App Password** - not a third-party transactional email API, and no domain-wide delegation or service account involved (that's a separate, unrelated piece - see the note at the end of this section on Google Drive receipt uploads, which is **not yet set up**).

### One-time setup (already done for dev/prod as of this writing - here for reference/rebuilds)

1. **Create the sending mailbox.** This project uses a dedicated `noreply@crosswaymtc.org` user (not the treasurer's own account) - free under this org's Google Workspace for Nonprofits plan, and keeps automated mail fully isolated from any real person's inbox. Create it in the [Google Admin Console](https://admin.google.com) → Users → Add a new user (username `noreply`).
2. Sign into that new account at gmail.com once (you'll likely be prompted to set a real password on first login).
3. While signed in as `noreply@`, go to **myaccount.google.com/security** and turn on **2-Step Verification** - required before App Passwords are available.
4. Go to **myaccount.google.com/apppasswords**, name it something like `Cross Way Ledger`, click **Create**, and copy the 16-character password (shown as 4 groups of 4 for readability - the actual password is just those 16 characters with no spaces).
5. Store it in Secret Manager:
   ```bash
   printf '%s' 'the16charapppassword' | gcloud secrets create ledger-smtp-password --data-file=-
   ```
   (One secret, not per-environment - dev and prod both send through this same real mailbox.)
6. Grant the Cloud Run runtime service account read access:
   ```bash
   gcloud secrets add-iam-policy-binding ledger-smtp-password \
     --member="serviceAccount:633510572581-compute@developer.gserviceaccount.com" \
     --role="roles/secretmanager.secretAccessor"
   ```
7. Add the SMTP env vars/secret to **both** `ledger-backend-dev` and `ledger-backend-prod` (see the warning immediately below before running this):
   ```bash
   gcloud run services update ledger-backend-dev --region=us-south1 \
     --update-env-vars="SMTP_USERNAME=noreply@crosswaymtc.org,SMTP_FROM_ADDRESS=noreply@crosswaymtc.org" \
     --update-secrets="SMTP_PASSWORD=ledger-smtp-password:latest"
   ```
   `smtp_host`/`smtp_port`/`smtp_use_tls` all have working defaults in `config.py` (`smtp.gmail.com:587`, TLS on) and don't need to be set explicitly.

> **⚠️ `--update-env-vars`/`--update-secrets` merge against the *most recently created* revision, not the one currently serving traffic.** If an earlier deploy attempt failed and Cloud Run rolled back to serving the last good revision (which it does automatically), that failed revision is still the "latest" one from `gcloud`'s point of view - so the next `--update-*` call merges on top of *that broken config*, not the good one that's actually live. This bit us for real: a first attempt used `--set-env-vars` (which fully **replaces** the env list, wiping `DATABASE_URL`/`SECRET_KEY`/etc. - same class of bug as the `--authorized-networks` gotcha below) and failed health checks; Cloud Run kept the old revision serving traffic, but a follow-up `--update-env-vars` call then merged onto the broken failed revision and failed again for the same reason. **Fix**: before using `--update-*` after any failed deploy, pull the full env var list from the last-known-good revision (`gcloud run revisions describe <good-revision> --format=json`, inspect `spec.containers[0].env`) and pass the *complete* set explicitly via `--set-env-vars`/`--set-secrets` at least once to get back to a known-good state.
>
> Also: if a value you're passing to `--set-env-vars`/`--update-env-vars` contains a comma (e.g. `CORS_ORIGINS` with multiple origins), gcloud's own comma-separated `KEY=VALUE,KEY2=VALUE2` parsing will split *inside* your value too. Use the `^DELIM^` custom-delimiter syntax to avoid this:
> ```bash
> --update-env-vars="^|^CORS_ORIGINS=https://a.example.com,https://b.example.com"
> ```

### Verifying it's working

```bash
curl -s -X POST https://<backend-url>/api/reimbursements/request-otp \
  -H "Content-Type: application/json" -d '{"email":"someone-in-pco-people@example.com"}'
```
Always returns the same generic `{"message": "..."}` regardless of whether the email matched anything (deliberate - see `routers/reimbursements.py`), so a 200 here doesn't by itself prove the email sent. Check the Cloud Run logs for the request's revision for any exception, or just have the recipient confirm they received the code.

### Google Drive receipt uploads

The submission wizard's receipt upload (`services/google_drive.py`) is a separate, unrelated piece of setup from the SMTP config above - don't confuse the two. See §12 below for the full setup.

## 12. Reimbursements module: Google Drive receipt uploads

Receipts attached to a reimbursement submission upload into the **same existing Drive folder** the treasurer already uses for campaign-import CSVs and bank/Stripe uploads (`ROOT_FOLDER_ID` in `frontend/src/lib/googleDrive.ts`, a folder literally named "Cross Way Ledger" in the treasurer's personal My Drive) - not a separate Shared Drive. That was the original plan (a dedicated Shared Drive with the service account as a Content Manager member), but it was changed once it became clear receipts need to land alongside every other treasurer document, not in a separate silo.

Submitters authenticate with an emailed one-time code, not a Google session, so there's no browser-side OAuth token to upload with - the backend uploads server-side using a dedicated service account.

**A plain service-account-as-folder-Editor approach was tried first and doesn't work.** Even added as an Editor on the folder, a bare service account has no Drive storage quota of its own, so Google rejects any file creation there with `storageQuotaExceeded` ("Service Accounts do not have storage quota. Leverage shared drives, or use OAuth delegation instead."). The fix is **domain-wide delegation**: the service account impersonates the treasurer's real Workspace account, so every file it creates is owned by (and counts against the quota of) an actual person - exactly as if they'd uploaded it themselves.

### One-time setup (already done for dev as of this writing - here for reference/rebuilds)

1. **Create the service account** (already done):
   ```bash
   gcloud iam service-accounts create svc-cross-way-ledger-drive \
     --display-name="Cross Way Ledger - Drive uploader" \
     --project=cross-way-ledger
   ```
   Note: "Cross Way" is two words - the service account ID uses a hyphen (`svc-cross-way-ledger-drive`) to represent that, since GCP service account IDs can't contain spaces. Its full email is `svc-cross-way-ledger-drive@cross-way-ledger.iam.gserviceaccount.com`.

2. **Authorize domain-wide delegation in the Google Workspace Admin Console** - this step can only be done by a Workspace Super Admin, in the browser, and is the piece that actually grants the service account permission to impersonate a real user:
   - Go to [admin.google.com](https://admin.google.com) → **Security** → **API Controls** → **Domain-wide Delegation**
   - Click **Add new**
   - **Client ID**: the service account's numeric unique ID, not its email - get it with:
     ```bash
     gcloud iam service-accounts describe svc-cross-way-ledger-drive@cross-way-ledger.iam.gserviceaccount.com \
       --project=cross-way-ledger --format="value(uniqueId)"
     ```
   - **OAuth Scopes**: `https://www.googleapis.com/auth/drive` - the *full* Drive scope, not the narrower `drive.file`. `drive.file` only grants access to files an app itself created or that were explicitly opened through it; the year/`Reimbursements` subfolders already exist, created earlier by a completely different OAuth client (the frontend's Picker flow), so a narrower scope can't see or write into them.
   - Click **Authorize**

3. **No JSON key is generated or stored, even for this domain-wide-delegation flow.** This project's GCP org has `constraints/iam.disableServiceAccountKeyCreation` enabled, so `gcloud iam service-accounts keys create` fails with `FAILED_PRECONDITION: Key creation is not allowed on this service account` - and a static key would be worse practice anyway (a long-lived secret that can leak and doesn't rotate). Domain-wide delegation normally requires a service account's own private key to self-sign the JWT assertion it exchanges for a delegated token, but `google.auth.iam.Signer` does that signing via the IAM Credentials API's `signBlob` method instead, keylessly - it just needs the caller to already have `roles/iam.serviceAccountTokenCreator` on the target service account (that permission includes `signBlob`):
   ```bash
   gcloud iam service-accounts add-iam-policy-binding \
     svc-cross-way-ledger-drive@cross-way-ledger.iam.gserviceaccount.com \
     --member="serviceAccount:633510572581-compute@developer.gserviceaccount.com" \
     --role="roles/iam.serviceAccountTokenCreator"
   ```
   `services/google_drive.py` builds a `google.oauth2.service_account.Credentials` with `subject=<the treasurer's email>` for the domain-wide-delegation impersonation, but backs it with an `iam.Signer` (using Cloud Run's own ambient credentials to call `signBlob`) instead of a local private key.

4. **Add the plain (non-secret) env vars** to `ledger-backend-dev` (see the ⚠️ warning in §11 above before running any `--update-*` command against a service that might not be on its latest-ready revision):
   ```bash
   gcloud run services update ledger-backend-dev --region=us-south1 \
     --update-env-vars="GOOGLE_DRIVE_ROOT_FOLDER_ID=1xc26-KngtfILik8Y2_8GA--6pJRYkK7P,GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL=svc-cross-way-ledger-drive@cross-way-ledger.iam.gserviceaccount.com,GOOGLE_DRIVE_IMPERSONATE_USER=treasurer@crosswaymtc.org"
   ```
   `google_drive_impersonate_user` already defaults to `treasurer@crosswaymtc.org` in `config.py`, so this last var is optional in practice - included here for explicitness.

   **Not yet applied to `ledger-backend-prod`** as of this writing - the whole Reimbursements module (including its SMTP config in §11) hasn't shipped to prod yet. Add these alongside the rest of that module's config when it does.

### Folder layout

Uploads land at `<root>/<year>/Reimbursements/<submitter_email>/<timestamp>_<filename>` - year first, then category, matching the convention `uploadCampaignImportFile`/`uploadBankOrStripeFile` already use elsewhere in the same root folder. Year/category/email subfolders are created on first use via a find-or-create-by-name query.

### Receipt visibility for submitters

The treasurer and anyone else already sharing the root Drive folder (auditor, other treasurer) can open any receipt normally - new files inherit the parent folder's sharing automatically. But **reimbursement submitters can't be assumed to have a Google account tied to their PCO email at all** (they log in via an emailed one-time code, not Google Sign-In), so folder-level sharing doesn't reach them. Each uploaded file is therefore individually set to "anyone with the link can view" (`drive.permissions().create(..., body={"type": "anyone", "role": "reader"})`) right after upload, so the submitter's own copy of the link (shown back to them in the wizard) works regardless of whether they have a Google account. The file ID itself isn't guessable, but be aware this means the link isn't identity-gated - anyone who obtains it can view that one file.

### Verifying it's working

Have a submitter attach a receipt in the portal wizard, then confirm the file actually appears under the correct `<year>/Reimbursements/<email>/` subfolder in the "Cross Way Ledger" Drive folder, and that clicking the link in the wizard actually opens it. A `RuntimeError` with the message "Google Drive receipt uploads aren't configured yet" means the env vars above haven't been set on the service actually receiving the request. A `storageQuotaExceeded` error means domain-wide delegation isn't authorized yet (or the wrong scope was granted) - see step 2 above.

## 13. Troubleshooting

**"Invalid Tier for Edition" on `gcloud sql instances create`** — add `--edition=ENTERPRISE`; smaller legacy tiers aren't available under the default `ENTERPRISE_PLUS` edition on newer projects.

**Cloud Build fails with a permission error partway through** — the default compute service account needs its IAM roles granted manually on a fresh project; see [§6](#6-cicd-pipeline)'s role list.

**nginx won't start in the frontend container** (`host not found in upstream`) — a static `proxy_pass` hostname fails to resolve at container boot if there's no static network alias (Cloud Run has none, unlike local Docker Compose). Use a lazy DNS resolver instead of a static upstream:
```nginx
resolver 127.0.0.11 valid=30s ipv6=off;
set $backend_upstream http://backend:8000;
proxy_pass $backend_upstream;
```

**Domain mapping fails with `UNIMPLEMENTED`** — the target region doesn't support Cloud Run domain mappings. Deploy that service to a supported region instead (this project uses `us-central1` for exactly this reason).

**A secret's value looks corrupted / the app fails to parse `DATABASE_URL`** — check for a leading BOM byte from a PowerShell pipe (see [§7](#7-secrets)).

**Looker Studio's "Authenticate" button stays greyed out** — this almost always means SSL is enabled without a server certificate uploaded. Download and upload the CA cert (see [§10](#10-external-bi-tools-looker-studio-google-sheets)).

**`gcloud` commands suddenly fail with a reauthentication error** — Google's OAuth session for the CLI expires periodically; run `gcloud auth login` again.

**Can't reach `ledger-db-prod` directly from a SQL client / script** — expected. As of 2026-07-29 its `authorizedNetworks` list is empty, so the public IP is closed to everything (see the note in [§10](#10-external-bi-tools-looker-studio-google-sheets)). This does not affect the application, which connects over the Cloud SQL socket. For ad-hoc access use the Cloud SQL Auth Proxy with `--auto-iam-authn` and the IAM users from [§9](#9-database-access-for-people-not-just-the-app). Do **not** "fix" this by re-adding `0.0.0.0/0`.

**Still worth knowing: `--authorized-networks` replaces the entire list rather than appending to it.** This is the same class of footgun as `--set-env-vars` on Cloud Run. It bit us once when a one-off patch to authorize a single IP silently revoked the rule an external tool depended on. If you ever do manage authorized networks on an instance (e.g. `ledger-db-dev`), always pass the complete intended list, or use `--clear-authorized-networks` when you mean to empty it.

**A Cloud Run backend deploy fails health checks after adding/changing env vars, with a `pydantic_core.ValidationError` / missing required field in the logs** — this is the same class of bug as the authorized-networks one above, applied to `gcloud run services update`. `--set-env-vars`/`--set-secrets` **replace** the entire env var list; `--update-env-vars`/`--update-secrets` merge, but only against the *most recently created* revision, which may not be the one actually serving traffic if an earlier deploy attempt already failed. See [§11](#11-reimbursements-module-outbound-email-smtp)'s warning box for the full incident and the fix (pull the last-known-good revision's complete env list and re-apply it explicitly via `--set-*`). Also watch for comma-containing values (e.g. `CORS_ORIGINS`) getting split apart by gcloud's own comma-delimited flag parsing - use the `^DELIM^` custom-delimiter syntax shown there.

**`bq` or other Cloud SDK tools fail with `Error retrieving auth credentials from gcloud: [WinError 2]`** (Windows) — the tool shells out to a bare `gcloud` command and needs it on `PATH`; the Cloud SDK installer doesn't always add it. Add the SDK's `bin` directory to `PATH` for the session (`$env:PATH = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin;$env:PATH"` in PowerShell) rather than only invoking `gcloud.cmd`/`bq.cmd` by full path.

**A `gcloud`/`bq` command with a flag value containing spaces fails with `'C:\...\Cloud' is not recognized as an internal or external command`** (Windows) — this is a quoting collision between the Cloud SDK's install path (which itself contains a space, `Google\Cloud SDK`) and a spaced argument value (e.g. `--display-name="My Function"`, `--schedule="0 * * * *"`). Avoid spaces in flag values where possible (use camelCase instead of a spaced display name), or in PowerShell use the `--%` stop-parsing token; as a last resort, write the argument to a file and pass a file path instead.

**`gcloud iam service-accounts keys create` fails with `FAILED_PRECONDITION: Key creation is not allowed on this service account`** — this project's org has `constraints/iam.disableServiceAccountKeyCreation` enabled, blocking static JSON keys entirely. Don't disable the policy to work around it. For plain "call this API as this service account" needs, grant the caller `roles/iam.serviceAccountTokenCreator` and use `google.auth.impersonated_credentials`. For Workspace domain-wide delegation specifically (impersonating a *real user*, not another service account), that role also unlocks `google.auth.iam.Signer` for keyless JWT signing via the IAM Credentials API's `signBlob` method - see [§12](#12-reimbursements-module-google-drive-receipt-uploads) for a working example of both.

**Drive API upload fails with `storageQuotaExceeded` ("Service Accounts do not have storage quota...")** — a bare service account, even added as an Editor on a folder, can't own files outside a Shared Drive - it has no storage quota of its own. Either move the target folder to a real Shared Drive, or use domain-wide delegation so the service account impersonates a real user and files are created (and quota-counted) as that person. See [§12](#12-reimbursements-module-google-drive-receipt-uploads).

---

*Part of the [Cross Way Ledger documentation](README.md). See also: [Architecture](ARCHITECTURE.md), [Data Dictionary](DATA_DICTIONARY.md).*
