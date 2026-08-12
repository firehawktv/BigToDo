# Deployment Runbook — todo.cooney.fun

**This VPS is shared with other live production sites (CloudPanel-managed).
Every step below marked "⚠️ LIVE VPS CHANGE" modifies the real server — read
the whole step, confirm you understand what it does, before running it.**

## First-time VPS setup

Run these once, on the VPS, in order. Requires SSH access and sudo/root.

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

### 4. Create the CloudPanel site and site user, sync the frontend, splice in the nginx locations, and issue the TLS certificate

**⚠️ LIVE VPS CHANGE** — creates a new system user and a new CloudPanel-managed nginx site on the shared box, edits that site's live nginx config, and requests a real Let's Encrypt certificate.

Do not improvise these steps here. Open **`deploy/vps-site-setup-commands.md`** — the command sequence Task 4 produced from live, read-only investigation of this exact box (which existing site's config it mirrors, why the backend moved to port `3002`, and why `clpctl lets-encrypt:install:certificate` is the right subcommand rather than `certbot` or `site:install:certificate`) — and run its numbered steps 1 through 9 in order, stopping to review output after each one as that file instructs. In summary, that sequence:

- Re-confirms host port `3002` is free immediately before creating anything.
- Runs `clpctl site:add:static --domainName=todo.cooney.fun --siteUser=todo --siteUserPassword=...`, which creates the `todo` site user and the frontend's document root at `/home/todo/htdocs/todo.cooney.fun/`, plus a generated `/etc/nginx/sites-enabled/todo.cooney.fun.conf`.
- Syncs the frontend build (see Step 5 below) into that document root.
- Hand-splices `deploy/nginx/todo.cooney.fun.locations.conf`'s `/assets/`, `/sw.js`, `/manifest.webmanifest`, `/api/`, and `/` location blocks into the generated config, replacing CloudPanel's default `location /` — `clpctl` has no subcommand that accepts location-block arguments, so this step is a manual edit (pull the file down, edit locally, push it back).
- Runs `nginx -t` before ever reloading — **stop and fix the config if this fails**; do not reload nginx with a failing config, since that risks nginx refusing to reload at all and taking down every other site it serves.
- Reloads nginx, then runs `clpctl lets-encrypt:install:certificate --domainName=todo.cooney.fun` to obtain the certificate (CloudPanel's own Let's Encrypt integration — certbot is not installed on this box). This requires `todo.cooney.fun`'s DNS A record to already point at the VPS's IP (confirm with `dig +short todo.cooney.fun`), or the ACME HTTP-01 challenge will fail.
- Re-verifies `nginx -t` and curls the live HTTPS endpoints, including `/api/health`, once the certificate step has rewritten the config's `ssl_certificate*` directives.

Before running any command from that file, also confirm its exact `clpctl` invocations still match current `clpctl --help` output — CloudPanel updates itself nightly via its own `clp-update` cron, so a flag name could have changed since that file's investigation was done.

### 5. Build the frontend

```bash
cd /srv/todo-app/frontend
npm ci
npm run build
```

The resulting `dist/` is what gets synced into `/home/todo/htdocs/todo.cooney.fun/` as part of Step 4 above (see `deploy/vps-site-setup-commands.md` step 4 for the exact `rsync` invocation and ownership follow-up).

### 6. Verify end to end

Visit `https://todo.cooney.fun` in a real browser. Enter the `API_TOKEN` from `.env`. Confirm the task list loads (empty is fine — this is a fresh database). This confirms the full path: browser → nginx (TLS) → `/api/*` proxy → backend container → Postgres container.
