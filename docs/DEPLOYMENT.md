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
11. [Troubleshooting](#11-troubleshooting)

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

A dedicated read-only Postgres role, **`ledger_reporting`**, exists specifically for BI tools that can't use IAM authentication (Looker Studio's PostgreSQL connector, Google Sheets' Connected Sheets). It has `SELECT`-only access to the `reporting` schema, which currently exposes a single view, `vw_ledger_generalledger` — the General Ledger, unioned across all four ledgers (see [Data Dictionary](DATA_DICTIONARY.md#reporting-views-reporting-schema)).

To let an external tool connect:

1. The instance's public IP must be reachable — connections require SSL (`--ssl-mode=ENCRYPTED_ONLY`; **not** `--require-ssl`, which demands a client certificate most BI tools don't support).
2. Download the instance's server CA certificate for the tool's SSL configuration:
   ```bash
   gcloud sql instances describe ledger-db-prod --format="value(serverCaCert.cert)"
   ```
3. Connect using the `ledger_reporting` username/password, with SSL enabled and the CA certificate uploaded, but **client authentication left unchecked** (Looker Studio's toggle for this specifically breaks the connection if enabled with only a server cert available).

## 11. Troubleshooting

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

---

*Part of the [Cross Way Ledger documentation](README.md). See also: [Architecture](ARCHITECTURE.md), [Data Dictionary](DATA_DICTIONARY.md).*
