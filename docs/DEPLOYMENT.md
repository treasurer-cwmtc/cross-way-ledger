# Deployment Guide (DigitalOcean, staging + prod)

Two always-on DigitalOcean droplets - **staging** and **prod** - each running the
same `docker compose` stack (PostgreSQL + FastAPI + nginx/SPA) fronted by Caddy
for automatic HTTPS. GitHub Actions builds each push to `main` once, deploys
that image to staging automatically, then promotes the *same* image to prod
after a manual approval click.

```
Dev (home Portainer)  →  CI tests (GitHub Actions, every push)  →  Staging (auto)  →  Prod (manual approval)
```

---

## 0. System requirements

**Accounts you need before starting:**

| Account | Used for |
| --- | --- |
| DigitalOcean, with a payment method on file | Hosts the staging and prod droplets |
| GitHub, with admin access to `treasurer-cwmtc/cross-way-ledger` | CI/CD, Actions secrets, the manual prod-approval gate |
| Google Cloud Console, access to the existing OAuth client | Google Sign-In - adding origins, the Client ID |
| Ownership/DNS access for `crosswaymtc.org` | Pointing `ledger.` and `staging.ledger.` subdomains at the droplets |

**Software you need on whatever machine drives the deployment** (your laptop,
or an assistant with terminal access): `ssh`, `scp`, `git`, `curl`. Nothing
needs to be installed on the droplets themselves beyond what
`scripts/provision-vps.sh` installs automatically (Docker Engine + Compose
plugin, `ufw`, `fail2ban`, `unattended-upgrades`).

**What each droplet needs to run this app**, at minimum: 1 vCPU, 1-2 GB RAM,
25 GB SSD, Ubuntu 22.04 LTS, a public IPv4 address. That's it - this is a
1-4 user internal tool, not a high-traffic public service, so the smallest
DigitalOcean droplet sizes are genuinely enough (see the sizing table below).

---

## 1. Create the two droplets

In the DigitalOcean console (or `doctl`), create two droplets:

| | Image | Size | Suggested name | Purpose |
| --- | --- | --- | --- | --- |
| Staging | Ubuntu 22.04 LTS | `s-1vcpu-1gb` (~$6/mo) | `cross-way-ledger-staging` | Verify a real build (real Postgres, real HTTPS, real domain) before it can reach church data. Auto-deployed by CI on every push to `main` - nothing here is ever hand-edited. |
| Prod | Ubuntu 22.04 LTS | `s-1vcpu-2gb` (~$12/mo) | `cross-way-ledger-prod` | The real app the church uses. Only ever updated by CI, and only after a human clicks Approve on a build that already passed staging. Slightly larger size as headroom, not because it's currently needed. |

Both run the *identical* stack (see [ARCHITECTURE.md](ARCHITECTURE.md) § 5
for why that's a hard requirement, not a preference) - the only differences
between them are their domain, secrets, and the approval gate in front of
prod. Total run-rate: **~$18/mo** for both droplets combined.

Add your SSH public key at creation time (DigitalOcean copies it to `root`'s
`authorized_keys` automatically - the provisioning script below carries it
over to the deploy user). Note each droplet's IP address.

---

## 2. Provision each droplet

From your machine, copy the provisioning script up and run it as root on
**both** droplets:

```bash
scp scripts/provision-vps.sh root@<droplet-ip>:/root/
ssh root@<droplet-ip> "chmod +x provision-vps.sh && ./provision-vps.sh"
```

This installs Docker, creates a non-root `deploy` user (SSH-key-only, no
password auth, no root login), locks the firewall to SSH/80/443 only, and
enables fail2ban + unattended security upgrades. See
[`scripts/provision-vps.sh`](../scripts/provision-vps.sh) for exactly what it
does.

Confirm you can log in as the new user before moving on:

```bash
ssh deploy@<droplet-ip>
```

---

## 3. DNS

Point A records at each droplet's IP:

| Hostname | → |
| --- | --- |
| `ledger.crosswaymtc.org` | prod droplet IP |
| `staging.ledger.crosswaymtc.org` | staging droplet IP |

---

## 4. First launch (manual, on each droplet)

As the `deploy` user on **each** droplet:

```bash
git clone https://github.com/treasurer-cwmtc/cross-way-ledger.git
cd cross-way-ledger
cp .env.example .env
nano .env
```

Set, at minimum:

```dotenv
POSTGRES_PASSWORD=<generate-a-long-random-value>   # different per droplet
SECRET_KEY=<a-long-random-string>                   # different per droplet
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<a-strong-password>
CORS_ORIGINS=https://ledger.crosswaymtc.org          # or https://staging.ledger.crosswaymtc.org
DOMAIN=ledger.crosswaymtc.org                        # or staging.ledger.crosswaymtc.org
GOOGLE_CLIENT_ID=<if using Google Sign-In>
```

> `.env` is git-ignored - never commit it. Staging and prod must use
> different `POSTGRES_PASSWORD`/`SECRET_KEY` values so a staging leak can't
> touch prod.

**Authenticate to GHCR once**, so this droplet can pull the images CI will
push later (this repo is private, so its GHCR packages are private too -
without this, `docker compose pull` in the deploy workflow will fail with an
auth error). Create a GitHub [classic PAT](https://github.com/settings/tokens)
scoped to `read:packages` only, then:

```bash
echo "<the-pat>" | docker login ghcr.io -u <your-github-username> --password-stdin
```

This caches the credential in the `deploy` user's Docker config on this box -
no token needs to touch GitHub Actions or be re-entered on future deploys.

Build and start (the first run builds images locally, since nothing's been
pushed to GHCR yet):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Check health:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
curl https://ledger.crosswaymtc.org/api/health      # {"status":"ok"} once Caddy issues its cert (~seconds)
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f backend
```

---

## 5. Wire up GitHub Actions deploys

**Generate a dedicated deploy keypair per droplet** (don't reuse your
personal SSH key):

```bash
ssh-keygen -t ed25519 -f staging_deploy_key -N ""
ssh-keygen -t ed25519 -f prod_deploy_key -N ""
```

Append each public key to the matching droplet's deploy-user
`authorized_keys`:

```bash
ssh-copy-id -i staging_deploy_key.pub deploy@<staging-ip>
ssh-copy-id -i prod_deploy_key.pub deploy@<prod-ip>
```

In the GitHub repo, add these **Actions secrets** (Settings → Secrets and
variables → Actions):

| Secret | Value |
| --- | --- |
| `STAGING_HOST` | staging droplet IP |
| `STAGING_SSH_USER` | `deploy` |
| `STAGING_SSH_KEY` | contents of `staging_deploy_key` (private key) |
| `PROD_HOST` | prod droplet IP |
| `PROD_SSH_USER` | `deploy` |
| `PROD_SSH_KEY` | contents of `prod_deploy_key` (private key) |

Delete the local private key files after adding them as secrets.

**Add the manual-approval gate**: Settings → Environments → New environment
named `production` → add yourself as a required reviewer. This is what
makes `deploy-prod` in [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)
pause for a click before touching real data.

From here, every push to `main` builds once, auto-deploys to staging, then
waits for your approval to promote that exact image to prod.

**Google Sign-In:** the frontend build needs the OAuth Client ID baked in at
*build* time (Vite inlines `VITE_*` vars then, not at runtime) - add it as a
repository **Variable** (Settings → Secrets and variables → Actions →
Variables tab, not Secrets - the Client ID is meant to be public), named
`VITE_GOOGLE_CLIENT_ID`. Also add `https://ledger.crosswaymtc.org` and
`https://staging.ledger.crosswaymtc.org` as Authorized JavaScript origins on
that OAuth client in Google Cloud Console.

---

## 6. Backups

**This is the single most important operational habit for this app** - it
holds real church financial data, and it must never depend on any one copy
surviving. Three layers, all automated:

1. **Nightly backup** (`scripts/backup.sh`) - dumps the database, gzips it,
   verifies the output isn't suspiciously small, and prunes anything older
   than 14 days. Fails loudly (non-zero exit, visible in cron's mail/log) if
   anything goes wrong, rather than silently leaving a broken or missing
   backup.
2. **Weekly restore verification** (`scripts/verify-backup.sh`) - actually
   restores the latest backup into a throwaway database on the same
   instance, confirms it has real data in it, then deletes the throwaway
   database. **An untested backup is not a backup** - this is what makes
   these ones trustworthy rather than just "a file that probably works."
3. **Off-box copy to your Synology** - so a backup never lives *only* on the
   same droplet as the data it's backing up.

**On the prod droplet** (and staging, if you want the same safety net
there), add both to cron:

```cron
0 2 * * *  cd ~/cross-way-ledger && ./scripts/backup.sh        >> ~/backups/backup.log 2>&1
0 3 * * 0  cd ~/cross-way-ledger && ./scripts/verify-backup.sh >> ~/backups/verify.log 2>&1
```

(2 AM nightly backup; 3 AM Sunday verification, after that night's backup
has landed.)

**On the Synology**, in Task Scheduler create a nightly "User-defined
script" task (running after the cron above, e.g. 2:30 AM) that pulls the
latest dumps over SSH - the Synology initiates the connection outward, so
nothing needs to be opened on your home network or VPN'd into:

```bash
rsync -az deploy@ledger.crosswaymtc.org:~/backups/ /volume1/backups/cross-way-ledger/
```

This needs the Synology's SSH key added to the prod droplet's `deploy` user
`authorized_keys` (same pattern as step 5).

**Restore, if ever needed** (destructive - overwrites current data, requires
typing a confirmation phrase):

```bash
./scripts/restore.sh ~/backups/cross-way-ledger_2026-07-19_020000.sql.gz
```

**A backup is only half the story** - the other half is making sure
anything that changes how the app is *built* (schema migrations, compose
files, CI/CD config) is committed to git, not left as untracked state on a
running container. A database backup can't restore code that was never
committed. See [STATUS.md](STATUS.md) for a case where exactly that
happened - real migration work existed only as applied database state on a
box, never in git, and was lost when that state had to be reset.

---

## 7. Common operations

```bash
# Manual redeploy (e.g. to pick up an .env change)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Roll back to a previous image
IMAGE_TAG=<previous-git-sha> docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Stop (keeps data)
docker compose -f docker-compose.yml -f docker-compose.prod.yml down

# Stop AND delete all data (careful)
docker compose -f docker-compose.yml -f docker-compose.prod.yml down -v
```

---

## 8. Security notes

- No SSH surface beyond key-only access as a non-root `deploy` user;
  `PermitRootLogin`/`PasswordAuthentication` are disabled by the
  provisioning script.
- `db`, `backend`, and the raw `frontend` port are **not** published to the
  host under `docker-compose.prod.yml` - only Caddy (80/443) is reachable
  from outside, and it only serves HTTPS.
- Staging and prod use separate `SECRET_KEY`/`POSTGRES_PASSWORD` values and
  separate deploy keys, so a compromise of one doesn't touch the other.
- `ufw` blocks everything except SSH/80/443; `unattended-upgrades` keeps the
  OS patched automatically; `fail2ban` blocks SSH brute-forcing.
- Rotate `POSTGRES_PASSWORD`, `SECRET_KEY`, and the deploy SSH keys if any
  of them are ever exposed.

---

## 9. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Frontend loads but API calls fail | `docker compose ... logs backend`; confirm `CORS_ORIGINS` matches the URL you're visiting |
| Caddy won't issue a cert | Confirm the DNS A record actually points at this droplet and ports 80/443 are reachable (`ufw status`) |
| DB connection errors on first boot | `db` may still be starting; backend retries via `depends_on: service_healthy` |
| `deploy-prod` never runs | Check the `production` environment has a required reviewer configured, and approve the pending deployment under the Actions run |
| Need a clean slate | `docker compose -f docker-compose.yml -f docker-compose.prod.yml down -v` (deletes the database) then `up -d` |
