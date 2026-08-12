# Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the backend (Fastify API + Postgres, Dockerized) and the frontend (static PWA build) to the user's existing VPS at `https://todo.cooney.fun`, behind the VPS's existing nginx reverse proxy, with a repeatable manual deploy process, database backups, and a post-deploy verification runbook.

**Architecture:** The backend and Postgres run as two Docker Compose services on the VPS, bound to `localhost` only (never exposed to the public interface — the VPS's existing nginx already owns ports 80/443 for other sites and is the only public entry point). The frontend is a static build (`frontend/dist/`) that nginx serves directly from disk — no container, no Node process, just files. A new site for `todo.cooney.fun`, created through the VPS's CloudPanel management layer (confirmed by this plan's Task 1 to be how every other site on this shared box is managed), serves the frontend's `index.html`/assets and reverse-proxies `/api/*` to the backend container's published `localhost` port, stripping the `/api` prefix exactly as the frontend's dev-time Vite proxy already does — so the frontend's `apiFetch`'s relative `/api/...` calls work identically in dev and production with zero frontend code changes. TLS is obtained via CloudPanel's own `clpctl site:install:certificate` (this box has no certbot installed — Task 1's live check confirmed CloudPanel handles Let's Encrypt itself). Deploys are manual: SSH in, `git pull`, rebuild/restart the backend container, run migrations, resync the frontend build. No CI/CD in this plan.

**Tech Stack:** Docker + Docker Compose (backend + Postgres only), a multi-stage Node 22 Dockerfile for the backend, the VPS's existing CloudPanel-managed nginx (via `clpctl`) for TLS and routing, `pg_dump` + cron for backups, plain shell scripts for the deploy/backup runbooks (no deploy-orchestration framework — this is a single-service personal app, not a fleet).

## Global Constraints

- **This plan builds on all four prior plans**, all merged to the `backend-foundation` branch and pushed: backend foundation, AI capture & breakdown, scheduler & push, frontend PWA. `backend/README.md` and `frontend/README.md` are the ground truth for what each app needs at runtime — Task 1 re-verifies the specific claims this plan depends on (required env vars, exact `npm run migrate`/`build`/`start` commands, the frontend's `/api` proxy assumption) against the real repo before writing infrastructure config around them.
- **Domain:** `todo.cooney.fun`. Every config file in this plan uses this literal value — no placeholder domains.
- **The VPS already runs other services behind an existing nginx instance** (confirmed by the user, not assumed) — this plan adds one new nginx server block and one new certbot certificate; it must not touch, restart in a way that drops connections for, or reconfigure any existing site's config. `nginx -t` (config syntax check) before every reload is mandatory, not optional, because a syntax error in this app's block would take down every other site nginx serves.
- **The backend container binds to `127.0.0.1` only** (`127.0.0.1:3001:3000` in Compose's `ports:` — see the confirmed-port note below), never `0.0.0.0` — nginx is the only process that should be able to reach it, and only nginx has a public-facing port. Postgres has no host port mapping at all (Docker-internal network only — see below). Directly exposing Postgres or the API to the public interface is a security defect this plan must not introduce.
- **Confirmed by Task 1's live verification (superseding this plan's original default assumption): the VPS is CloudPanel-managed, not raw Debian nginx.** `sites-available/` is unused; active sites are flat files CloudPanel generates/manages directly in `sites-enabled/`. **certbot is not installed** — TLS on this box goes through CloudPanel's own Let's Encrypt integration (`clpctl site:install:certificate`), with certs stored at `/etc/nginx/ssl-certificates/<domain>.{crt,key}`, not certbot's standard layout. Tasks 4 and 5 use `clpctl`, matching every other site on this box, not a hand-authored `sites-available` symlink or a `certbot --nginx` invocation — both would fail outright or fight CloudPanel's own management.
- **This app runs under its own dedicated CloudPanel site user, `todo`** (confirmed decision — matches the existing per-site convention on this box: `firehawk`, `cooney-gifts`, etc. each have their own user with `htdocs/` and `logs/` under their home directory).
- **Confirmed by Task 1: host port 3000 is already taken** by an unrelated app (`firehawk.tv`'s Node server) on this shared VPS. The backend container publishes to **host port 3001** instead (container-internal port stays 3000; only the host-side mapping changes) — **re-verified free immediately before Task 2 writes the Compose file**, since other stacks get added to this box over time and a port confirmed free at planning time is not guaranteed free at execution time.
- **Postgres is not published to the host at all**, matching the established convention of every other Postgres container already running on this box (`plausible_events_db`, `immich_postgres`, `postgres-postgres-1` — none publish 5432 to the host). The backend reaches it via the Docker-internal network only (service name `db`), which is strictly safer than even a `127.0.0.1`-bound host port.
- **Any command that changes the live VPS (creating the CloudPanel site, installing the cert, starting containers, editing nginx config) requires explicit human sign-off before execution** — this is a shared production box already serving other live sites, and the blast radius of a wrong move there extends beyond this app. Read-only verification (checking versions, existing config, `clpctl --help` output) does not require sign-off; anything that writes to the box does. Tasks 4, 5, and 6 are written to produce ready-to-run commands and stop for confirmation before applying them live, not to execute autonomously.
- **No CI/CD.** Deploys are manual, SSH-driven, and documented as a runbook (`docs/DEPLOY.md`) a human runs step by step. This is a deliberate choice for a single-user personal app — automating deploys is more infrastructure than the problem justifies.
- **No offline-first support, no multi-instance scheduler.** The scheduler (`node-cron`, built in plan 3) is explicitly single-instance — this plan's Compose file must run exactly one backend replica (`deploy.replicas: 1` is the default; do not add horizontal scaling of any kind, and the deploy runbook must never leave two backend containers running simultaneously during a deploy, even briefly — see Task 6's stop-before-start ordering).
- **Secrets never enter git.** `API_TOKEN`, `ANTHROPIC_API_KEY`, `VAPID_PRIVATE_KEY`, and the Postgres password live in a `.env` file on the VPS only, created once by hand from a committed `.env.production.example` template that contains no real values. This mirrors `backend/README.md`'s existing `.env`-based local-dev pattern — same mechanism, different environment.
- **Migrations run as an explicit deploy step**, never automatically on container start — this matches `backend/README.md`'s documented `npm run migrate` being a separate, deliberate command from `npm start`, and avoids a container restart loop silently re-running migrations.
- All new files in this plan live under `backend/` (Dockerfile, `docker-compose.prod.yml`, `.env.production.example`), a new top-level `deploy/` directory (nginx site config, backup script), and `docs/DEPLOY.md` at the repo root.
- Every command in every runbook in this plan must be the exact command a human would type — no `<placeholder>` bash syntax errors waiting to happen. Where a value is genuinely host-specific (an SSH hostname, a file path chosen at setup time), say so explicitly in prose immediately above the command block, not by inventing a fake-looking real value.

---

## Task 1: Verify VPS environment and deployment assumptions

Before writing any Dockerfile, Compose file, or nginx config, confirm the real VPS matches this plan's assumptions — nginx's config layout, certbot's presence, Docker's version, available disk/ports. A plan written against wrong assumptions about someone else's already-configured server is the single most expensive mistake this plan can make, since fixing it means redoing every later task's config.

**Files:** none created; this task is investigation only, producing a findings note that the rest of the plan is written to be robust against (see Task 4/5's explicit call-outs).

**Interfaces:**
- Consumes: SSH access to the VPS (the user runs the commands below themselves, or grants an agent SSH access if the execution environment allows it — either way, this task's output is a confirmed or corrected set of assumptions, not code).
- Produces: a written note (can live in the PR description or a scratch file, not necessarily committed) confirming or correcting: nginx config layout (`/etc/nginx/sites-available/` + `sites-enabled/` symlinks, vs. a single `nginx.conf`, vs. `conf.d/`), certbot's presence and ACME client (`certbot --version`), Docker + Compose versions, which local ports are already bound, and available disk space.

- [ ] **Step 1: Gather nginx's actual config layout**

Run on the VPS (over SSH, or paste output back if run by the user directly — either is fine, the goal is ground truth, not who types the command):

```bash
nginx -v
ls -la /etc/nginx/sites-available/ /etc/nginx/sites-enabled/ 2>/dev/null
ls -la /etc/nginx/conf.d/ 2>/dev/null
grep -l "server_name" /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf 2>/dev/null
nginx -T 2>/dev/null | grep -A2 "^server {" | head -60
```

This tells you whether the VPS uses the Debian/Ubuntu convention (`sites-available` + `sites-enabled` symlinks — the layout Task 4 assumes by default) or a flat `conf.d/` layout, and shows how existing sites are named so the new file follows the same convention.

- [ ] **Step 2: Confirm certbot and its ACME method**

```bash
certbot --version
certbot certificates
```

If `certbot certificates` lists existing certs obtained via the `nginx` plugin (`Type: nginx` or similar in its output), Task 5's `certbot --nginx -d todo.cooney.fun` command will work unmodified. If certbot isn't installed, or the existing certs were obtained via a DNS challenge (common with Cloudflare-proxied domains, since HTTP-01 validation can't reach the origin through the proxy), stop and note this — Task 5 needs a different command (`certbot certonly --manual --preferred-challenges dns` or a DNS-plugin-specific invocation) and this plan's Task 5 steps must be adjusted before execution, not silently forced.

- [ ] **Step 3: Confirm Docker, Compose, ports, and disk**

```bash
docker --version
docker compose version
ss -tlnp | grep -E ':80|:443|:3000|:5432'
df -h /
```

Confirm: Docker Compose v2 (the `docker compose` subcommand, not the standalone `docker-compose` binary — this plan's commands throughout use `docker compose`, matching what's already installed per the earlier clarification). Confirm ports 3000 and 5432 are free on `127.0.0.1` (a port already in use by another app's container would collide with Task 2's Compose file). Confirm at least a few GB free for Postgres data + Docker images.

- [ ] **Step 4: Record findings and adjust downstream tasks if needed**

If everything matches this plan's assumptions (Debian-style nginx layout, certbot with the nginx plugin, Docker Compose v2, free ports), proceed to Task 2 unmodified. If anything differs, note the actual values now — Task 4 (nginx config) and Task 5 (TLS) reference this task's findings explicitly and must be written against the real environment, not the default assumption.

---

## Task 2: Backend Dockerfile and production Compose file

A multi-stage Dockerfile that builds the backend's TypeScript once and ships a minimal runtime image, plus a Compose file that runs the backend and Postgres together, both bound to `localhost` only.

**Files:**
- Create: `backend/Dockerfile`
- Create: `backend/.dockerignore`
- Create: `backend/docker-compose.prod.yml`
- Create: `backend/.env.production.example`

**Interfaces:**
- Consumes: `backend/package.json`'s `build`/`start`/`migrate` scripts (confirmed in plan 4's Task 0 equivalent — this task re-confirms them fresh since `package.json` may have changed since); `backend/src/db/migrations/*.sql` (three files as of this plan: `001_init.sql`, `002_ai_capture.sql`, `003_scheduler_push.sql` — the image must include these since `npm run migrate` reads them at deploy time, run as a separate step, not baked into image startup).
- Produces: a `todo-backend:latest` image buildable via `docker build`, and a `docker compose -f docker-compose.prod.yml` stack with services `db` and `backend`.

- [ ] **Step 1: Confirm the backend's build output shape**

```bash
cd backend
cat package.json | grep -A1 '"build"\|"start"\|"migrate"'
npm run build
ls dist/
```

Confirm `npm run build` (via `tsc -p tsconfig.json`) produces `dist/server.js` as its entry point, and that `npm start` (`node --env-file-if-exists=.env dist/server.js`) is the correct way to run the built output — the Dockerfile's `CMD` must match this exactly, not assume a different entry file.

- [ ] **Step 2: Write the multi-stage Dockerfile**

`backend/Dockerfile`:

```dockerfile
# Stage 1: install dependencies and build TypeScript
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Stage 2: production runtime — only what's needed to run the built output
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY src/db/migrations ./src/db/migrations
COPY scripts ./scripts

# Runs as a non-root user — the base image's built-in 'node' user, not root,
# limits the blast radius if the Node process is ever compromised.
USER node

EXPOSE 3000
CMD ["node", "dist/server.js"]
```

This copies `src/db/migrations` (raw `.sql` files, not compiled) alongside the built `dist/` because `npm run migrate`'s underlying script (`src/db/migrate.ts`, compiled to `dist/db/migrate.js`) reads those files at runtime by path, not by import — the migration runner needs the `.sql` files present in the image, not just the compiled TypeScript. `scripts/` is included because `npm run vapid:generate` (used once, outside this container, to generate keys — see Task 3) lives there; if it turns out nothing in the running container needs `scripts/` at runtime, this is harmless to keep for operational parity but flag it in your task report as worth trimming later.

- [ ] **Step 3: Write `.dockerignore`**

`backend/.dockerignore`:

```
node_modules
dist
tests
*.test.ts
.env
.env.*
!.env.production.example
knowledge
memory
plans
SCRATCHPAD.md
TASK-QUEUE.md
WORKING.md
hipocampus.config.json
.git
```

Excludes test files, local dev artifacts, and — critically — `.env` (so a real secrets file sitting in the build context during `docker build` can never accidentally be baked into an image layer), while explicitly allowing `.env.production.example` back in via the `!` negation since that file is a template with no real secrets and is useful for reference.

- [ ] **Step 4: Write the production Compose file**

`backend/docker-compose.prod.yml`:

```yaml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: todo
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set in .env}
      POSTGRES_DB: todo
    # No `ports:` mapping at all — Postgres is reachable only via the
    # Docker-internal network (service name `db`), matching the confirmed
    # convention of every other Postgres container already running on this
    # shared VPS. Stricter than even a 127.0.0.1-bound host port: there is
    # no host-side socket for it whatsoever.
    volumes:
      - todo_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U todo"]
      interval: 5s
      timeout: 5s
      retries: 10

  backend:
    build: .
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "127.0.0.1:3001:3000"
    env_file:
      - .env
    environment:
      DATABASE_URL: postgres://todo:${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set in .env}@db:5432/todo

volumes:
  todo_pgdata:
```

The backend's `ports:` entry binds to `127.0.0.1` explicitly (per this plan's Global Constraints) — it is not reachable from outside the VPS itself; only nginx (running on the host, not in this Compose stack) can reach it. **Host port 3001, not 3000** — confirmed by Task 1's live check that 3000 is already bound by an unrelated app (`firehawk.tv`'s Node server) on this shared VPS; the container's own internal port stays `3000` (matching `PORT=3000` in `.env.production.example` below — that value is what Node binds to *inside* the container, unaffected by which host port maps to it), only the host-side mapping changes. **Re-verify 3001 is still free immediately before this step runs** (`ss -tlnp | grep 3001` on the VPS) since other stacks get added to this box over time. `DATABASE_URL` is composed here from `POSTGRES_PASSWORD` (read from `.env`) rather than requiring the user to duplicate the password inside a full connection string in two places — one source of truth for the password. `restart: unless-stopped` means a VPS reboot brings both services back automatically, but an explicit `docker compose stop` (used during deploys, see Task 6) stays stopped rather than being auto-restarted mid-deploy.

- [ ] **Step 5: Write the production env template**

`backend/.env.production.example`:

```bash
# Copy this file to `.env` on the VPS and fill in real values.
# NEVER commit the real .env file — it holds production secrets.

# A long random string — generate with: openssl rand -hex 32
API_TOKEN=

# Postgres password used by both the db and backend services in
# docker-compose.prod.yml — pick a strong random value, generate with:
# openssl rand -hex 24
POSTGRES_PASSWORD=

# Real Anthropic API key (sk-ant-...)
ANTHROPIC_API_KEY=

# Generate with: docker compose -f docker-compose.prod.yml run --rm backend npm run vapid:generate
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@example.com

# The public URL this app is served at — used in notification payload URLs
APP_URL=https://todo.cooney.fun

PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info
```

`HOST=0.0.0.0` here is correct and not a contradiction of the "bind to localhost only" constraint: `0.0.0.0` is the address the Node process binds to *inside its own container's network namespace* (where it must accept connections from Docker's internal bridge network, not just literal `localhost` inside the container) — Compose's `ports: "127.0.0.1:3001:3000"` mapping is the layer that actually restricts what the *host* can reach from outside. These are two different `localhost`s; conflating them is a common Docker networking mistake worth calling out explicitly in whichever report cites this step.

- [ ] **Step 6: Verify the image builds**

```bash
cd backend
docker build -t todo-backend:latest .
docker images todo-backend
```

Expected: build succeeds, image appears in `docker images` output. This doesn't require Postgres or real secrets to be present — it's purely confirming the Dockerfile itself is correct.

- [ ] **Step 7: Commit**

```bash
git add backend/Dockerfile backend/.dockerignore backend/docker-compose.prod.yml backend/.env.production.example
git commit -m "feat(deploy): add backend Dockerfile and production Compose stack"
```

---

## Task 3: Frontend production build verification and packaging

Confirm the frontend's production build genuinely works standalone (no dev server, no proxy) against a real backend origin, and produce the exact, repeatable command sequence Task 6's deploy runbook will use to build and sync `frontend/dist/` to the VPS.

**Files:**
- Modify: `frontend/vite.config.ts` (only if Step 1 finds a problem — see below; otherwise no change)
- Create: `deploy/rsync-exclude.txt` (used by Task 6's deploy script to sync `dist/` cleanly)

**Interfaces:**
- Consumes: `frontend/package.json`'s `build` script (`vite build`, per plan 4), `frontend/dist/` as the build output directory.
- Produces: confirmation that a plain static file server serving `frontend/dist/` correctly serves the SPA (including the service worker at `dist/sw.js` with correct MIME type and scope) — this is what Task 4's nginx config is written against.

- [ ] **Step 1: Build the frontend and inspect the output**

```bash
cd frontend
npm run build
ls -la dist/
cat dist/manifest.webmanifest 2>/dev/null || cat dist/manifest.json 2>/dev/null
```

Confirm `dist/index.html`, `dist/sw.js`, `dist/registerSW.js`, and a manifest file all exist (these were verified to exist by plan 4's Task 5/6 reviews — this step re-confirms against the current `frontend/dist/` rather than assuming plan 4's verification still holds after any later change). Note the manifest's exact filename (`manifest.webmanifest` is `vite-plugin-pwa`'s default) — Task 4's nginx config needs to know this if it sets any content-type overrides.

- [ ] **Step 2: Serve `dist/` with a plain static server and smoke-test it**

```bash
cd frontend
npx serve -s dist -l 8080
```

In a browser, visit `http://localhost:8080`. Confirm: the token-entry screen renders (proving `index.html`/JS/CSS all loaded correctly with no 404s in the browser console — check the Network tab), and `http://localhost:8080/sw.js` returns the service worker file with `Content-Type: application/javascript` or `text/javascript` (not `text/html`, which is what a misconfigured static server serving a SPA-fallback would incorrectly return for a `.js` request under some fallback configurations). The `-s` flag (SPA mode) is what `serve` needs to correctly fall back to `index.html` for client-side routes — confirm this matters here: this app has only two client-side "screens" toggled by `useState`, not URL-routed, so there is likely no deep-link path to test, but confirm this assumption by checking `frontend/src/App.tsx`'s navigation is genuinely state-based, not `history.pushState`-based, before concluding SPA-fallback routing is a non-issue for this app. If it turns out the app does use URL-based routing (unlikely per plan 4, but verify, don't assume), note this for Task 4's nginx config to add a `try_files ... /index.html` fallback.

- [ ] **Step 3: Confirm the service worker's scope works from the root**

While `npx serve` is running, in the browser devtools Application/Service Workers panel, confirm the registered service worker's scope is `/` (root), matching `vite-plugin-pwa`'s `injectManifest` default from plan 4. This matters for Task 4's nginx config: the service worker file must be served from the same origin and path depth vite built it for, with no path-prefix rewriting — nginx must serve `todo.cooney.fun/` as the site root, not e.g. `todo.cooney.fun/app/`.

- [ ] **Step 4: Write the rsync exclude file**

`deploy/rsync-exclude.txt`:

```
.DS_Store
*.map
```

Used by Task 6's deploy script as `rsync -a --delete --exclude-from=deploy/rsync-exclude.txt frontend/dist/ user@host:/path/`. Source maps (`*.map`) are excluded from the production sync deliberately — they're large, not needed for the app to function, and expose original source structure; if debugging a production issue ever requires them, they can be rsynced manually as a one-off, not shipped by default.

- [ ] **Step 5: Record findings; no commit needed unless Step 1/2 found a real problem**

If everything in Steps 1–3 checks out (it's expected to, since plan 4's own Task 6 already verified the build produces a working manifest/service worker), this task's only durable artifact is `deploy/rsync-exclude.txt`. Commit that:

```bash
git add deploy/rsync-exclude.txt
git commit -m "chore(deploy): add frontend build packaging config"
```

If Step 1 or 2 found a real problem (e.g., the service worker's MIME type genuinely came back wrong under `npx serve`, suggesting nginx will need an explicit `types` override), note the exact symptom in your task report — Task 4 must account for it explicitly in the nginx config, not silently hope it resolves itself.

---

## Task 4: CloudPanel site investigation and custom location blocks

**Confirmed by Task 1: this VPS is CloudPanel-managed, not raw Debian nginx.** Sites are created and their nginx config generated via `clpctl`, not by hand-authoring a file in `sites-available/` and symlinking it. This task investigates the exact `clpctl` invocation and the precedent site's structure, drafts the custom location blocks this app needs (static asset caching, service-worker no-cache, `/api/*` reverse proxy), and produces a ready-to-run command sequence — **it does not execute anything against the live VPS**. Applying it live is Task 5's job, and only after explicit human sign-off, per this plan's Global Constraints.

**Files:**
- Create: `deploy/nginx/todo.cooney.fun.locations.conf` (the custom location blocks only — not a full server block, since CloudPanel generates the surrounding `server {}` scaffold itself)
- Create: `deploy/vps-site-setup-commands.md` (the exact, human-reviewable command sequence Task 5 will ask sign-off to run)

**Interfaces:**
- Consumes: Task 1's confirmed findings (CloudPanel-managed, site user `todo`, backend on host port `3001`), `backend/README.md`'s endpoint table (no `/api` prefix on any backend route).
- Produces: a location-blocks file ready to be spliced into whatever CloudPanel generates, and a documented, reviewed command sequence for Task 5 to request sign-off on and run.

- [ ] **Step 1: Read-only investigation of the CloudPanel precedent and `clpctl` options**

Over SSH (read-only — no writes in this step):

```bash
cat /etc/nginx/sites-enabled/gifts.cooney.fun.conf
clpctl site:add:reverse-proxy --help
clpctl site:add:static --help
clpctl site:install:certificate --help
```

`gifts.cooney.fun.conf` was identified by Task 1 as an existing site with the same shape this app needs (static frontend + `/api/` reverse proxy to a backend port) — reading it shows the exact CloudPanel-generated boilerplate (server_name, root, the shared `include /etc/nginx/global_settings;`, ssl directive placement once a cert exists) this app's own generated file will have, and how that site's author added its own custom `/api/` location block on top of CloudPanel's scaffold (by hand-editing the generated file after `site:add:*`, since CloudPanel's `clpctl` subcommands don't take arbitrary location-block arguments — confirm this against the `--help` output rather than assuming).

- [ ] **Step 2: Draft the custom location blocks**

`deploy/nginx/todo.cooney.fun.locations.conf` — the blocks to be added into the CloudPanel-generated server block after site creation (not a complete, standalone nginx config — CloudPanel supplies `server_name`, `root`, `listen`, and TLS directives itself):

```nginx
# Static assets: long cache lifetime, since Vite fingerprints filenames
# (e.g. index-a1b2c3.js) — a changed file is a changed URL, so caching
# aggressively here is safe and correct, not stale-content risk.
location /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}

# The service worker and manifest must NEVER be cached aggressively —
# they're how the browser discovers a new deployed version. A cached
# sw.js means a user's installed PWA silently never updates.
location = /sw.js {
    add_header Cache-Control "no-cache";
}
location = /manifest.webmanifest {
    add_header Cache-Control "no-cache";
}

# API traffic: reverse-proxy to the backend container on host port 3001
# (confirmed by Task 1 — port 3000 is already taken by an unrelated app on
# this shared VPS), stripping /api — matches exactly what the frontend's
# dev-time Vite proxy does (see frontend/vite.config.ts's server.proxy
# rewrite), so apiFetch's relative /api/... calls need zero code change
# between environments.
location /api/ {
    proxy_pass http://127.0.0.1:3001/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# Everything else falls through to index.html — this app has no
# URL-based client-side routing as of plan 4 (confirmed in that plan's
# Task 3), so in practice this only ever serves the root page itself, but
# it's included as a safe default for any future client-side route.
location / {
    try_files $uri $uri/ /index.html;
}
```

The `proxy_pass http://127.0.0.1:3001/;` trailing slash is what makes nginx strip the `/api` prefix before forwarding — nginx's `proxy_pass` strips the matched `location` prefix (`/api/`) and replaces it with the trailing-slash target's path (empty), so a request to `/api/tasks` reaches the backend as `/tasks`, matching every route this plan's backend registers with no `/api` prefix of its own (confirmed against `backend/README.md`'s endpoint table).

- [ ] **Step 3: Validate the location blocks' syntax in isolation**

```bash
docker run --rm -v "$(pwd)/deploy/nginx/todo.cooney.fun.locations.conf:/tmp/locations.conf:ro" nginx:alpine sh -c '
  cat > /etc/nginx/conf.d/test.conf <<EOF
server {
    listen 8080;
    server_name test.local;
    root /tmp;
    include /tmp/locations.conf;
}
EOF
  nginx -t
'
```

Expected: `nginx: configuration file /etc/nginx/nginx.conf test is successful`. This wraps the location blocks in a throwaway server block purely to exercise nginx's syntax checker — it proves the blocks parse, not that they'll behave identically once spliced into CloudPanel's real generated file (Task 5's live `nginx -t` after splicing is what actually confirms that).

- [ ] **Step 4: Draft the command sequence for Task 5, without running it**

`deploy/vps-site-setup-commands.md` — write out the exact commands Step 1's investigation determined are needed to: create the CloudPanel site under user `todo` for `todo.cooney.fun` (the specific `clpctl site:add:*` invocation, chosen based on what Step 1's `--help` output showed — likely `site:add:reverse-proxy` given this app is proxying to a backend port, or `site:add:static` if that turns out to be the closer match to how `gifts.cooney.fun` was actually set up per Step 1's `cat`), splice `todo.cooney.fun.locations.conf`'s contents into the generated config at the right point, and run `nginx -t`. Format this file as a numbered, copy-pasteable command list with a comment above each command explaining what it does and why — this is the artifact Task 5 presents to the human for sign-off, so it must be complete and correct enough to run as-is, not a sketch requiring further judgment calls at execution time.

- [ ] **Step 5: Commit**

```bash
git add deploy/nginx/todo.cooney.fun.locations.conf deploy/vps-site-setup-commands.md
git commit -m "feat(deploy): add nginx location blocks and CloudPanel site setup commands"
```

---

## Task 5: TLS certificate and VPS-side activation runbook

The steps a human runs once, on the VPS, to create the CloudPanel site (using Task 4's investigated command sequence), splice in the custom location blocks, and obtain a certificate via CloudPanel's own Let's Encrypt integration — **every command in this task that writes to the live VPS requires explicit human sign-off before it runs**, per this plan's Global Constraints. This task's job is to produce the complete, reviewed runbook; a human (not a subagent) is the one who actually executes the live-VPS steps, copy-pasting from this runbook after confirming each stage's result.

**Files:**
- Create: `docs/DEPLOY.md` (this task writes the "First-time VPS setup" section; Task 6 adds the "Routine deploy" section to the same file)

**Interfaces:**
- Consumes: `deploy/vps-site-setup-commands.md` and `deploy/nginx/todo.cooney.fun.locations.conf` (Task 4), Task 1's confirmed CloudPanel/`clpctl` findings, site user `todo`, backend host port `3001`.
- Produces: a runbook section a human can follow start to finish for first-time setup, explicit about which steps are safe to run solo and which are live-VPS writes needing a deliberate go/no-go check before proceeding to the next.

- [ ] **Step 1: Write the "First-time VPS setup" section of `docs/DEPLOY.md`**

Create `docs/DEPLOY.md` with this content:

```markdown
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

**⚠️ LIVE VPS CHANGE** — starts new containers on the shared box; confirm host port 3001 is still free first (`ss -tlnp | grep 3001`), since Task 1/2 confirmed it free at planning time, not necessarily now.

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
curl http://127.0.0.1:3001/health
```

Expected: `{"status":"ok"}` (confirm the exact shape against `backend/README.md`'s documented `/health` response before treating a mismatch as a failure — if it differs, that's real information, not this runbook being wrong). Note the port here is `3001` (the host-side mapping), not `3000` — see this plan's Global Constraints for why.

### 4. Create the CloudPanel site and site user

**⚠️ LIVE VPS CHANGE** — creates a new system user and a new CloudPanel-managed nginx site on the shared box. Before running anything here, open `deploy/vps-site-setup-commands.md` (produced by Task 4's investigation) and confirm its exact `clpctl` invocation still matches current `clpctl --help` output (CloudPanel updates itself nightly via its own `clp-update` cron — a flag name could have changed since Task 4 investigated it). Run the commands from that file now, in order, stopping to review output after each one.

### 5. Build and sync the frontend

```bash
cd /srv/todo-app/frontend
npm ci
npm run build
```

**⚠️ LIVE VPS CHANGE** — the destination path depends on what Step 4's `clpctl site:add:*` actually created as the site user's document root; confirm the real path (e.g. `sudo -u todo ls /home/todo/htdocs/`) before running the sync, rather than assuming a path this runbook guessed in advance:

```bash
rsync -a --delete --exclude-from=/srv/todo-app/deploy/rsync-exclude.txt dist/ /home/todo/htdocs/todo.cooney.fun/
sudo chown -R todo:todo /home/todo/htdocs/todo.cooney.fun/
```

### 6. Splice in the custom location blocks and validate

**⚠️ LIVE VPS CHANGE** — edits the live nginx config for this site (only this site's file; other sites' configs are untouched).

Open the nginx config CloudPanel generated for this site in Step 4 (its exact path was shown in that step's output — typically `/etc/nginx/sites-enabled/todo.cooney.fun.conf`, following the flat-file convention Task 1 confirmed) and insert the contents of `/srv/todo-app/deploy/nginx/todo.cooney.fun.locations.conf` inside the `server {}` block, replacing whatever default `location /` CloudPanel generated (its custom `/api/` and asset-caching rules supersede the generic default).

```bash
sudo nginx -t
```

**Stop here if `nginx -t` reports any error** — fix the config before proceeding; do not reload nginx with a failing config, since that risks nginx refusing to reload at all and taking down every other site it serves.

```bash
sudo systemctl reload nginx
curl -H "Host: todo.cooney.fun" http://127.0.0.1/
```

Expected: the frontend's `index.html` content (confirms nginx is routing the new server block correctly over plain HTTP, before TLS is added).

### 7. Obtain the TLS certificate via CloudPanel

**⚠️ LIVE VPS CHANGE** — requests a real Let's Encrypt certificate; `todo.cooney.fun`'s DNS A record must already point at this VPS's IP before running this (confirm with `dig +short todo.cooney.fun` matches the VPS's public IP), or the ACME HTTP-01 challenge will fail.

```bash
sudo clpctl site:install:certificate --domainName=todo.cooney.fun
```

(Confirm this exact flag name against `clpctl site:install:certificate --help`'s real output at execution time — Task 4 investigated this ahead of time, but CloudPanel's own nightly self-update means the exact flag syntax should be re-confirmed live, not assumed frozen since Task 4 ran.)

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -I https://todo.cooney.fun/
```

Expected: `HTTP/2 200`, confirming TLS is live.

### 8. Verify end to end

Visit `https://todo.cooney.fun` in a real browser. Enter the `API_TOKEN` from `.env`. Confirm the task list loads (empty is fine — this is a fresh database). This confirms the full path: browser → nginx (TLS) → `/api/*` proxy → backend container → Postgres container.
```

- [ ] **Step 2: Commit**

```bash
git add docs/DEPLOY.md
git commit -m "docs(deploy): add first-time VPS setup runbook"
```

---

## Task 6: Routine deploy runbook, database backups, and post-deploy verification

The steps for every deploy *after* the first one — pull, rebuild, migrate, resync, reload — plus a cron-driven Postgres backup and a verification checklist so "deployed" and "working" aren't assumed to be the same thing.

**Files:**
- Create: `deploy/backup-db.sh`
- Modify: `docs/DEPLOY.md` (append "Routine deploy" and "Backups" sections)

**Interfaces:**
- Consumes: everything from Tasks 1–5 — the VPS directory layout (`/srv/todo-app` for the repo checkout, `/home/todo/htdocs/todo.cooney.fun` for the frontend build), the Compose file, the CloudPanel site config, the `.env` file's `POSTGRES_PASSWORD`.
- Produces: a repeatable deploy command sequence and an automated nightly backup.

- [ ] **Step 1: Write the backup script**

`deploy/backup-db.sh`:

```bash
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
```

`set -euo pipefail` means the script exits non-zero on any failure in the pipeline (including a failed `pg_dump`, not just a failed `gzip`) — a silent partial/empty backup file is worse than a script that visibly fails and alerts via cron's mail-on-error default.

- [ ] **Step 2: Make it executable and test it manually once**

```bash
chmod +x deploy/backup-db.sh
```

On the VPS, after Task 5's first-time setup is complete:

```bash
/srv/todo-app/deploy/backup-db.sh
ls -la /srv/todo-backups/
gunzip -c /srv/todo-backups/todo-*.sql.gz | head -20
```

Expected: a `.sql.gz` file exists, and decompressing it shows real SQL (`CREATE TABLE`, `COPY`, etc.) — confirms the dump isn't empty or corrupted before trusting it as a cron job.

- [ ] **Step 3: Install the cron job**

```bash
crontab -e
```

Add:

```cron
0 3 * * * /srv/todo-app/deploy/backup-db.sh >> /srv/todo-backups/backup.log 2>&1
```

Runs nightly at 03:00 server time, logging output (including any failure) to `backup.log` rather than relying on cron's mail delivery, which is often unconfigured on a fresh VPS.

- [ ] **Step 4: Append the "Routine deploy" section to `docs/DEPLOY.md`**

```markdown

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
curl http://127.0.0.1:3001/health

# Frontend: rebuild and resync
cd ../frontend
npm ci
npm run build
rsync -a --delete --exclude-from=/srv/todo-app/deploy/rsync-exclude.txt dist/ /home/todo/htdocs/todo.cooney.fun/
sudo chown -R todo:todo /home/todo/htdocs/todo.cooney.fun/
```

No nginx reload is needed for a routine deploy — nginx serves `/home/todo/htdocs/todo.cooney.fun/`'s files directly from disk on every request; syncing new files into that directory is immediately live with no nginx restart, and `/api/*` continues proxying to the same backend port whether or not the backend container behind it was just replaced.

### Post-deploy verification checklist

Run through this after every deploy — "the commands succeeded" is not the same as "the app works":

1. `/health` isn't proxied publicly in this plan's nginx config (only `/api/*` is) — use `curl -H "Authorization: Bearer $API_TOKEN" https://todo.cooney.fun/api/tasks` as the reachability check instead, and confirm a `200` with a JSON task array (even if empty).
2. Open `https://todo.cooney.fun` in a real browser — confirm the app loads, the token gate works, and (if you already have a token stored from before) the existing task list still shows your real tasks, not an empty/broken state.
3. Submit a real capture ("test deploy check") and confirm it appears in the list — exercises the full backend + AI path, not just static serving.
4. If this deploy touched anything push- or scheduler-related, use the settings screen's "Send test notification" button and confirm a real notification arrives — this is the one path that silently breaks without any error surfaced elsewhere, per `backend/README.md`'s own note that `POST /push/test` exists specifically because push delivery is fiddly to verify.
5. Check `docker compose -f docker-compose.prod.yml logs backend --tail 50` for any startup errors or unexpected warnings.

## Backups

A nightly `pg_dump` runs via cron (`deploy/backup-db.sh`), writing gzipped SQL dumps to `/srv/todo-backups/`, retained for 14 days. To restore from a backup:

```bash
cd /srv/todo-app/backend
docker compose -f docker-compose.prod.yml stop backend
gunzip -c /srv/todo-backups/todo-YYYYMMDD-HHMMSS.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T db psql -U todo todo
docker compose -f docker-compose.prod.yml up -d backend
```

**This overwrites the current database with the backup's contents** — confirm you're restoring the intended backup file before running this, and stop the backend first (Task 6's own step above) so nothing writes to the database mid-restore.
```

- [ ] **Step 5: Commit**

```bash
git add deploy/backup-db.sh docs/DEPLOY.md
git commit -m "docs(deploy): add routine deploy runbook, backups, and verification checklist"
```

---

## Definition of Done

- [ ] `backend/Dockerfile` builds successfully (`docker build -t todo-backend:latest backend/`) and produces a working image (verified in Task 2).
- [ ] `docker-compose.prod.yml` binds both services to `127.0.0.1` only — no public port exposure for Postgres or the backend.
- [ ] `frontend/dist/` served standalone (no dev server) renders correctly and its service worker/manifest have correct MIME types and no aggressive caching (verified in Task 3).
- [ ] nginx config passes `nginx -t` and correctly proxies `/api/*` to the backend while serving the frontend's static build for everything else (verified in Task 4).
- [ ] `docs/DEPLOY.md` covers first-time setup, routine deploys, backups, and post-deploy verification — followed start to finish by a human on the real VPS at least once before considering this plan done, since no part of this plan can be exercised against the real production nginx/CloudPanel/VPS from inside a development sandbox.
- [ ] A real TLS certificate is live at `https://todo.cooney.fun` and the app is reachable and functional end to end, including a real push notification delivered via the settings screen's test button.
- [ ] A real backup file exists in `/srv/todo-backups/` and was confirmed (by decompressing and inspecting it) to contain real data, not an empty or corrupted dump.

## What This Plan Deliberately Leaves Out

- **CI/CD** — deploys are manual by explicit choice (see Global Constraints). Revisit if the deploy cadence increases enough to justify the automation cost.
- **Horizontal scaling / multi-instance backend** — explicitly ruled out by the scheduler's single-instance constraint; this is a personal single-user app, not a system designed to scale.
- **Automated TLS renewal verification** — CloudPanel manages its own certificate renewal (confirmed by Task 1: no separate certbot/ACME client exists on this box to duplicate); this plan doesn't add a second renewal mechanism or a renewal-failure alert on top of CloudPanel's own, since duplicating it would create a second, conflicting cert-management system on a shared production host.
- **Monitoring/alerting beyond cron's own failure logging** — no external uptime monitor, no log aggregation service. If this app becomes important enough to need paged alerts, that's a deliberate future decision, not an oversight here.
- **A staging environment** — one VPS, one environment, matching the personal-tool scope this whole project has had since the original design spec.
