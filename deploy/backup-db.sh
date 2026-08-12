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

cd "$APP_DIR"
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U todo todo | gzip > "$BACKUP_DIR/todo-$TIMESTAMP.sql.gz"

# Prune backups older than KEEP_DAYS — a personal single-user app doesn't
# need indefinite retention, and unpruned backups will eventually fill the
# VPS's disk silently.
find "$BACKUP_DIR" -name 'todo-*.sql.gz' -mtime "+$KEEP_DAYS" -delete

echo "Backup complete: $BACKUP_DIR/todo-$TIMESTAMP.sql.gz"
