#!/usr/bin/env bash
# Nightly Postgres backup for the todo app. Intended to run via cron on the
# VPS, not inside any container — it shells out to `docker compose exec` to
# reach the db container from the host.
set -euo pipefail

APP_DIR="/srv/todo-app/backend"
BACKUP_DIR="/srv/todo-backups"
KEEP_DAYS=14
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"

OUT="$BACKUP_DIR/todo-$TIMESTAMP.sql.gz"
TMP="$OUT.tmp"
trap 'rm -f "$TMP"' EXIT

cd "$APP_DIR"
# Write to a temp path first and rename into place only on success. A plain
# `pg_dump | gzip > "$OUT"` would have the shell open/truncate "$OUT" before
# the pipeline runs, so a mid-stream pg_dump failure still leaves a
# structurally-valid-looking (but truncated) gzip file at the final path —
# `pipefail`'s non-zero exit happens only after that corrupt file is already
# on disk. Renaming only on success means "$OUT" only ever exists if the
# dump genuinely succeeded.
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U todo todo | gzip > "$TMP"
mv "$TMP" "$OUT"

# Prune backups older than KEEP_DAYS — a personal single-user app doesn't
# need indefinite retention, and unpruned backups will eventually fill the
# VPS's disk silently.
find "$BACKUP_DIR" -name 'todo-*.sql.gz' -mtime "+$KEEP_DAYS" -delete

echo "Backup complete: $OUT"
