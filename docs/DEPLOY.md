# Deployment Runbook — todo.cooney.fun

**This VPS is shared with other live production sites (CloudPanel-managed).
Every step below marked "⚠️ LIVE VPS CHANGE" modifies the real server — read
the whole step, confirm you understand what it does, before running it.**

## First-time VPS setup

Run these once, in order. Requires SSH access and sudo/root.

**Execution model — read this before starting:** Steps 1-3 below are run
**while SSH'd into the VPS itself** (open an SSH session and stay in it for
those three steps — the backend's repo checkout at `/srv/todo-app` lives on
the VPS). Step 4 onward switch to **your local workstation** — the machine
with your own separate local clone of this repo, used to build the frontend
and to drive the VPS via `ssh`/`scp`/`rsync` from the outside. You do not
need to stay logged into the VPS for Step 4 onward; log out of the Step 1-3
SSH session (or just open a new local terminal) before continuing. This
matters because every command in `deploy/vps-site-setup-commands.md` is
itself written to run from a local workstation, not while already SSH'd
into the box — see that file's own header note.

### 1. Clone the repo and choose directories

```bash
sudo mkdir -p /srv/todo-app
sudo chown $USER:$USER /srv/todo-app
git clone https://github.com/firehawktv/BigToDo.git /srv/todo-app
cd /srv/todo-app
git checkout main   # or whichever branch is being deployed — confirm before running
```

`/srv/todo-app` holds the full repo checkout (the backend runs from here via Docker Compose — this directory is independent of CloudPanel's per-site-user `htdocs/` convention, since the backend isn't served directly by CloudPanel, only reverse-proxied to). The frontend's built static files go under the CloudPanel site user `todo`'s own `htdocs/` directory instead (Step 5 below), once that user and site exist.

### 2. Create the backend's production `.env`

```bash
cd /srv/todo-app/backend
cp .env.production.example .env
```

Edit `.env` and fill in every value — `API_TOKEN` and `POSTGRES_PASSWORD` via `openssl rand -hex 32` / `openssl rand -hex 24`, `ANTHROPIC_API_KEY` from your Anthropic console, `APP_URL=https://todo.cooney.fun` (already correct in the template). Leave `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` blank for now — the next step generates them.

### 3. Build and start the backend stack, generate VAPID keys, run migrations

**⚠️ LIVE VPS CHANGE** — starts new containers on the shared box; confirm host port 3002 is still free first (`ss -tlnp | grep 3002`), since earlier planning confirmed it free at planning time, not necessarily now.

```bash
cd /srv/todo-app/backend
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d db
docker compose -f docker-compose.prod.yml ps
```

Generate VAPID keys (one-time; the backend won't start without them once it validates config at boot, per `backend/src/validateConfig.ts`):

```bash
docker compose -f docker-compose.prod.yml run --rm backend npm run vapid:generate
```

Copy the printed public/private key pair into `.env`'s `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`. Then:

```bash
docker compose -f docker-compose.prod.yml run --rm backend npm run migrate
docker compose -f docker-compose.prod.yml up -d backend
docker compose -f docker-compose.prod.yml ps
curl http://127.0.0.1:3002/health
```

Expected: `200 {"status":"ok"}` (no auth required on this route, per `backend/README.md`'s endpoint table — if the response differs, that's real information, not this runbook being wrong). Note the port here is `3002` (the host-side mapping to the container's internal port 3000) — `docker-compose.prod.yml` maps `127.0.0.1:3002:3000`. The original plan used `3001`, but that was found to collide with a different, currently-stopped backend still referenced in `gifts.cooney.fun`'s nginx config on this box, so this app was moved to `3002` instead (see `deploy/vps-site-setup-commands.md`'s "Investigation basis" section for the full story).

### 4. Build the frontend (on your local workstation)

**You are now on your local workstation**, not the VPS — see the execution
model note above. Using your own local clone of this repo (not
`/srv/todo-app`, which only exists on the VPS):

```bash
cd frontend   # your local checkout's frontend/ directory
npm ci
npm run build
```

This must happen **before** Step 5 below — Step 5 rsyncs this `dist/`
directory up to the VPS, so it needs to exist and be current first. Run
this from wherever your local checkout lives; `deploy/vps-site-setup-commands.md`'s
rsync step reads `frontend/dist/` as a path relative to the directory you
run it from, so run both from the same local checkout root.

### 5. Create the CloudPanel site and site user, sync the frontend, splice in the nginx locations, and issue the TLS certificate

**⚠️ LIVE VPS CHANGE** — creates a new system user and a new CloudPanel-managed nginx site on the shared box, edits that site's live nginx config, and requests a real Let's Encrypt certificate.

Do not improvise these steps here. Open **`deploy/vps-site-setup-commands.md`** — the command sequence Task 4 produced from live, read-only investigation of this exact box (which existing site's config it mirrors, why the backend moved to port `3002`, and why `clpctl lets-encrypt:install:certificate` is the right subcommand rather than `certbot` or `site:install:certificate`) — and run its numbered steps 1 through 9 in order, from your local workstation, stopping to review output after each one as that file instructs. In summary, that sequence:

- Re-confirms host port `3002` is free immediately before creating anything.
- Runs `clpctl site:add:static --domainName=todo.cooney.fun --siteUser=todo --siteUserPassword=...`, which creates the `todo` site user and the frontend's document root at `/home/todo/htdocs/todo.cooney.fun/`, plus a generated `/etc/nginx/sites-enabled/todo.cooney.fun.conf`.
- Syncs the frontend build produced in Step 4 above into that document root.
- Hand-splices `deploy/nginx/todo.cooney.fun.locations.conf`'s `/assets/`, `/sw.js`, `/manifest.webmanifest`, `/api/`, and `/` location blocks into the generated config, replacing CloudPanel's default `location /` — `clpctl` has no subcommand that accepts location-block arguments, so this step is a manual edit (pull the file down, edit locally, push it back).
- Runs `nginx -t` before ever reloading — **stop and fix the config if this fails**; do not reload nginx with a failing config, since that risks nginx refusing to reload at all and taking down every other site it serves.
- Reloads nginx, then runs `clpctl lets-encrypt:install:certificate --domainName=todo.cooney.fun` to obtain the certificate (CloudPanel's own Let's Encrypt integration — certbot is not installed on this box). This requires `todo.cooney.fun`'s DNS A record to already point at the VPS's IP (confirm with `dig +short todo.cooney.fun`), or the ACME HTTP-01 challenge will fail.
- Re-verifies `nginx -t` and curls the live HTTPS endpoints, including `/api/health` — by this point the backend has already been running since Step 3 above, so this check exercises the full proxy path immediately, with nothing left to start afterward.

Before running any command from that file, also confirm its exact `clpctl` invocations still match current `clpctl --help` output — CloudPanel updates itself nightly via its own `clp-update` cron, so a flag name could have changed since that file's investigation was done.

### 6. Verify end to end

Visit `https://todo.cooney.fun` in a real browser. Enter the `API_TOKEN` from `.env`. Confirm the task list loads (empty is fine — this is a fresh database). This confirms the full path: browser → nginx (TLS) → `/api/*` proxy → backend container → Postgres container.

## Routine deploy (after the first-time setup above)

Run on the VPS for every subsequent deploy of a merged change:

```bash
cd /srv/todo-app
git pull

# Backend: rebuild the image, run any new migrations, restart with zero
# double-running of the scheduler — stop before start, never start-then-stop,
# since this app's scheduler (node-cron) must never run in two containers
# simultaneously even briefly (see the plan's Global Constraints).
cd backend
docker compose -f docker-compose.prod.yml build backend
docker compose -f docker-compose.prod.yml stop backend
docker compose -f docker-compose.prod.yml run --rm backend npm run migrate
docker compose -f docker-compose.prod.yml up -d backend
curl http://127.0.0.1:3002/health

# Frontend: rebuild and resync
cd ../frontend
npm ci
npm run build
sudo rsync -a --delete --exclude-from=/srv/todo-app/deploy/rsync-exclude.txt dist/ /home/todo/htdocs/todo.cooney.fun/
sudo chown -R todo:todo /home/todo/htdocs/todo.cooney.fun/
```

Both the rsync and the chown need `sudo` — CloudPanel site-user home
directories are owned by and restricted to their own site user (`todo`),
not the deploying sudo user, so an unprivileged rsync fails with a
permission error on the second and every subsequent deploy (the first
deploy "works" only because Step 5's rsync there ran as root over SSH). Use
consistent privilege escalation on both lines, as above.

No nginx reload is needed for a routine deploy — nginx serves `/home/todo/htdocs/todo.cooney.fun/`'s files directly from disk on every request; syncing new files into that directory is immediately live with no nginx restart, and `/api/*` continues proxying to the same backend port whether or not the backend container behind it was just replaced. The `chown` after the rsync matches the ownership fix `deploy/vps-site-setup-commands.md` step 4 applies after its own first-time rsync — an `rsync` run as `root` over SSH still lands root-owned files, which breaks the `todo` site user's expected ownership of its own htdocs directory, so every resync (not just the first) needs the same fix.

### Post-deploy verification checklist

Run through this after every deploy — "the commands succeeded" is not the same as "the app works":

1. `https://todo.cooney.fun/api/health` is reachable with **no credentials** — `location /api/`'s trailing-slash `proxy_pass` strips the `/api` prefix, so this request reaches the backend's unauthenticated `/health` route. Run `curl -si https://todo.cooney.fun/api/health` first — it's the fastest, zero-setup reachability check and needs no `$API_TOKEN`. Follow up with `curl -H "Authorization: Bearer $API_TOKEN" https://todo.cooney.fun/api/tasks`, confirming a `200` with a JSON task array (even if empty), to also exercise the authenticated path.
2. Open `https://todo.cooney.fun` in a real browser — confirm the app loads, the token gate works, and (if you already have a token stored from before) the existing task list still shows your real tasks, not an empty/broken state.
3. Submit a real capture ("test deploy check") and confirm it appears in the list — exercises the full backend + AI path, not just static serving.
4. If this deploy touched anything push- or scheduler-related, use the settings screen's "Send test notification" button and confirm a real notification arrives — this is the one path that silently breaks without any error surfaced elsewhere, per `backend/README.md`'s own note that `POST /push/test` exists specifically because push delivery is fiddly to verify.
5. Check `docker compose -f docker-compose.prod.yml logs backend --tail 50` for any startup errors or unexpected warnings.

## Backups

A nightly `pg_dump` runs via cron (`deploy/backup-db.sh`), writing gzipped SQL dumps to `/srv/todo-backups/`, retained for 14 days.

### Set up the nightly backup

1. The script is already executable in the repo (`deploy/backup-db.sh`, `chmod +x` applied at commit time) — no separate build step.

2. **⚠️ LIVE VPS CHANGE** — provisions `/srv/todo-backups` with the deploying user's ownership. `/srv` itself is root-owned, so the script's own `mkdir -p "$BACKUP_DIR"` cannot be relied on to bootstrap this directory in time — in particular, the crontab's `>> /srv/todo-backups/backup.log` redirect (Step 3 below) is opened by cron's shell *before* the script runs, so if the directory doesn't already exist when cron fires, the whole job fails silently with no error surfaced anywhere (no MTA is configured on this box, which is the stated reason for file-logging in the first place). Create it explicitly now, once, mirroring what Step 1 already did for `/srv/todo-app`:

   ```bash
   sudo mkdir -p /srv/todo-backups
   sudo chown $USER:$USER /srv/todo-backups
   ```

   The crontab installed in Step 4 below must belong to this same user (whoever owns `/srv/todo-backups`), or to root — a cron job running as a different user won't have permission to write into this directory. That user's crontab also needs `docker compose` to work non-interactively, which means being in the `docker` group (or being root) — confirm with `docker ps` under that user before relying on the cron job.

3. **⚠️ LIVE VPS CHANGE** — writes a real backup file to disk. Test it manually once, after the first-time setup above is complete, before trusting it as a cron job:

   ```bash
   /srv/todo-app/deploy/backup-db.sh
   ls -la /srv/todo-backups/
   gunzip -c /srv/todo-backups/todo-*.sql.gz | head -20
   ```

   Expected: a `.sql.gz` file exists, and decompressing it shows real SQL (`CREATE TABLE`, `COPY`, etc.) — confirms the dump isn't empty or corrupted before trusting it as a cron job.

4. **⚠️ LIVE VPS CHANGE** — installs a recurring, unattended job that will run every night indefinitely:

   ```bash
   crontab -e
   ```

   Add:

   ```cron
   0 3 * * * /srv/todo-app/deploy/backup-db.sh >> /srv/todo-backups/backup.log 2>&1
   ```

   Runs nightly at 03:00 server time, logging output (including any failure) to `backup.log` rather than relying on cron's mail delivery, which is often unconfigured on a fresh VPS.

### Restore from a backup

```bash
cd /srv/todo-app/backend
docker compose -f docker-compose.prod.yml stop backend
gunzip -c /srv/todo-backups/todo-YYYYMMDD-HHMMSS.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T db psql -U todo todo
docker compose -f docker-compose.prod.yml up -d backend
```

**This overwrites the current database with the backup's contents** — confirm you're restoring the intended backup file before running this, and stop the backend first (above) so nothing writes to the database mid-restore.
