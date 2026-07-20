#!/usr/bin/env bash
# Restore a backup produced by backup.sh. DESTRUCTIVE - replaces every row
# in the current database. Requires typing a confirmation phrase; there is
# no --force/--yes flag on purpose (this must never run unattended).
#
# Usage: ./scripts/restore.sh path/to/cross-way-ledger_2026-07-19_020000.sql.gz
set -euo pipefail

FILE="${1:?Usage: ./scripts/restore.sh path/to/backup.sql.gz}"
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

if [ ! -f "$FILE" ]; then
  echo "No such file: $FILE" >&2
  exit 1
fi

echo "This will REPLACE ALL DATA in the current database with the contents of:"
echo "  $FILE"
echo "This cannot be undone unless you have another backup of the current state."
read -r -p "Type 'restore' (exactly) to continue: " CONFIRM
if [ "$CONFIRM" != "restore" ]; then
  echo "Aborted - nothing was changed."
  exit 1
fi

echo "==> Restoring..."
gunzip -c "$FILE" | $COMPOSE exec -T db psql -U recon -d ledger_db
echo "==> Restore complete. Open the app and confirm it looks right before trusting it."
