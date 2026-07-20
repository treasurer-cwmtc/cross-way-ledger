#!/usr/bin/env bash
# Nightly Postgres backup - run via cron on the staging/prod droplets, from
# the repo root (e.g. ~/cross-way-ledger). See docs/DEPLOYMENT.md § Backups.
#
# Usage: ./scripts/backup.sh
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
TIMESTAMP=$(date +%F_%H%M%S)
OUT_FILE="$BACKUP_DIR/cross-way-ledger_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "==> Backing up to $OUT_FILE"
if ! $COMPOSE exec -T db pg_dump -U recon ledger_db | gzip > "$OUT_FILE.tmp"; then
  echo "BACKUP FAILED: pg_dump did not complete successfully" >&2
  rm -f "$OUT_FILE.tmp"
  exit 1
fi

# A real backup of a real church database should never be near-empty - if it
# is, something's wrong (wrong DB name, empty volume, etc.) and we should
# fail loudly rather than silently keep a useless file.
SIZE=$(stat -c%s "$OUT_FILE.tmp" 2>/dev/null || stat -f%z "$OUT_FILE.tmp")
if [ "$SIZE" -lt 1024 ]; then
  echo "BACKUP FAILED: output is suspiciously small (${SIZE} bytes) - not trusting it" >&2
  rm -f "$OUT_FILE.tmp"
  exit 1
fi

mv "$OUT_FILE.tmp" "$OUT_FILE"
echo "==> Backup OK: $OUT_FILE ($SIZE bytes)"

echo "==> Pruning backups older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -name 'cross-way-ledger_*.sql.gz' -mtime "+$RETENTION_DAYS" -delete
