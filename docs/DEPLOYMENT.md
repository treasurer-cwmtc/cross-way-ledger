# Deployment Guide (VPS, headless)

This app is designed to run **on a VPS as a headless service — no desktop/GUI
required**. Everything runs in containers via Docker Compose, so the VPS setup is
identical to local development. A local POC (SQLite + Vite) is fine for now; this
guide covers the production/VPS target (PostgreSQL + nginx).

---

## 1. Prerequisites on the VPS

A small Linux VPS (1 vCPU / 1 GB RAM is plenty for 1–4 users) running Ubuntu
22.04+ or Debian 12+.

Install Docker Engine + the Compose plugin:

```bash
# Docker's official convenience script
curl -fsSL https://get.docker.com | sh

# Allow your user to run docker without sudo (log out/in afterwards)
sudo usermod -aG docker "$USER"

# Verify
docker --version
docker compose version
```

---

## 2. Get the code

```bash
git clone https://github.com/treasurer-cwmtc/Tracker.git
cd Tracker
```

---

## 3. Configure environment

```bash
cp .env.example .env
nano .env
```

Set a strong database password (and keep the rest as-is unless you know you need
to change it):

```dotenv
POSTGRES_USER=recon
POSTGRES_PASSWORD=<generate-a-long-random-value>
POSTGRES_DB=recon
CORS_ORIGINS=http://<your-server-ip-or-domain>:8080
```

> `.env` is git-ignored — never commit it.

---

## 4. Launch

```bash
docker compose up -d --build
```

This starts three containers:

| Service | Purpose | Port |
| --- | --- | --- |
| `db` | PostgreSQL (data persisted in the `pgdata` volume) | 5432 |
| `backend` | FastAPI API | 8000 |
| `frontend` | nginx serving the SPA + proxying `/api` → backend | 8080 |

Open `http://<your-server-ip>:8080`. The Chart of Accounts and starter rules seed
themselves on first boot.

Check health:

```bash
docker compose ps
curl http://localhost:8000/api/health      # {"status":"ok"}
docker compose logs -f backend             # follow logs
```

Common operations:

```bash
docker compose pull && docker compose up -d --build   # update after git pull
docker compose down                                   # stop (keeps data)
docker compose down -v                                # stop AND delete the DB volume
```

---

## 5. Start on boot

Docker Compose services use `restart` behaviour from Docker. Add a restart policy
so containers come back after a reboot — either add `restart: unless-stopped` to
each service in `docker-compose.yml`, **or** use a systemd unit that runs compose:

`/etc/systemd/system/tracker.service`:

```ini
[Unit]
Description=Bank/Stripe Reconciliation (Tracker)
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/YOURUSER/Tracker
ExecStart=/usr/bin/docker compose up -d --build
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tracker.service
```

---

## 6. HTTPS / custom domain (recommended)

Put a TLS-terminating reverse proxy in front so the app is served over HTTPS on a
domain. Easiest is **Caddy** (automatic Let's Encrypt certificates).

Install Caddy, then `/etc/caddy/Caddyfile`:

```caddyfile
tracker.example.org {
    reverse_proxy localhost:8080
}
```

```bash
sudo systemctl reload caddy
```

Then update `.env` `CORS_ORIGINS=https://tracker.example.org` and
`docker compose up -d`.

> Once behind HTTPS, consider firewalling ports 8000/8080/5432 so only 80/443 are
> public (`ufw allow 80,443/tcp`, `ufw deny 8000`, etc.).

---

## 7. Backups

All persistent data lives in the Postgres `pgdata` volume. Back it up regularly:

```bash
# Dump to a timestamped file
docker compose exec -T db pg_dump -U recon recon > backup_$(date +%F).sql

# Restore
cat backup_2026-07-13.sql | docker compose exec -T db psql -U recon -d recon
```

Automate with a cron entry, e.g. nightly:

```cron
0 2 * * * cd /home/YOURUSER/Tracker && docker compose exec -T db pg_dump -U recon recon > /home/YOURUSER/backups/tracker_$(date +\%F).sql
```

---

## 8. Security notes

- The POC has **no authentication**. Before exposing it publicly, add auth (e.g.
  put Basic Auth on the Caddy site, or add app-level login) — donor data is
  sensitive.
- Keep the VPS patched (`unattended-upgrades`).
- Rotate the `POSTGRES_PASSWORD` if it is ever exposed.

---

## 9. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Frontend loads but API calls fail | Check `docker compose logs backend`; confirm `CORS_ORIGINS` includes the URL you're visiting |
| DB connection errors on first boot | `db` may still be starting; backend retries via compose `depends_on: service_healthy` |
| Changes not showing after `git pull` | `docker compose up -d --build` to rebuild images |
| Need a clean slate | `docker compose down -v` (deletes the database) then `up` |
