#!/usr/bin/env bash
# Proves the most recent backup is actually restorable - not just present.
# An untested backup is not a backup. Restores into a throwaway database on
# the same Postgres instance, checks it has real data, then drops the
# throwaway database. Never touches the real "recon" database - safe to run
# anytime, including against prod, including from cron (see DEPLOYMENT.md).
#
# Usage: ./scripts/verify-backup.sh
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
TEST_DB="backup_verify_test"

LATEST=$(ls -t "$BACKUP_DIR"/cross-way-ledger_*.sql.gz 2>/dev/null | head -1)
if [ -z "$LATEST" ]; then
  echo "VERIFY FAILED: no backups found in $BACKUP_DIR" >&2
  exit 1
fi
echo "==> Verifying: $LATEST"

$COMPOSE exec -T db psql -U recon -d ledger_db -c "DROP DATABASE IF EXISTS $TEST_DB;" >/dev/null
$COMPOSE exec -T db psql -U recon -d ledger_db -c "CREATE DATABASE $TEST_DB OWNER recon;" >/dev/null

cleanup() {
  $COMPOSE exec -T db psql -U recon -d ledger_db -c "DROP DATABASE IF EXISTS $TEST_DB;" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! gunzip -c "$LATEST" | $COMPOSE exec -T db psql -U recon -d "$TEST_DB" >/dev/null; then
  echo "VERIFY FAILED: restore into the test database errored" >&2
  exit 1
fi

ROWS=$($COMPOSE exec -T db psql -U recon -d "$TEST_DB" -tAc \
  "SELECT count(*) FROM chart_of_accounts;" | tr -d '[:space:]')

if [ -z "$ROWS" ] || [ "$ROWS" -lt 1 ]; then
  echo "VERIFY FAILED: restored database has no chart_of_accounts rows" >&2
  exit 1
fi

echo "==> Verify OK: restored backup has $ROWS chart_of_accounts rows"
