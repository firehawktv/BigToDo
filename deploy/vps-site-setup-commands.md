# `todo.cooney.fun` VPS site setup — command sequence for Task 5 sign-off

**Not run by Task 4.** This is the artifact Task 5 presents to the human
for sign-off before executing anything against the live, shared production
VPS. Every command below was derived from Task 4's read-only investigation
of that same box (see "Investigation basis"), not guessed.

**Execution model:** every command in this file is written to run **from a
local workstation** — the machine with your git checkout and the
`frontend/dist/` build output (built in `docs/DEPLOY.md`'s Step 4, which
must run *before* this file's numbered sequence) — SSHing/SCPing into the
VPS as needed. Do **not** run these while already SSH'd into the box; the
`rsync`/`scp` sources here are locally-relative paths and several commands
open their own SSH connections.

Commands below reference an SSH alias, `todo-vps`, rather than a hardcoded
hostname/IP/key path. Define it once in your own local `~/.ssh/config`
(not committed anywhere):

```
Host todo-vps
    HostName <the VPS's real IP or hostname>
    User root
    IdentityFile ~/.ssh/<your real private key file>
```

## Investigation basis (read-only, already run — see `task-4-report.md`)

- `cat /etc/nginx/sites-enabled/gifts.cooney.fun.conf` — the closest
  existing precedent (static frontend + hand-added `/api/` reverse-proxy
  location on top of CloudPanel's generated scaffold). Its `root` points
  at a `dist/` directory, and its `location /` is a plain
  `try_files $uri $uri/ /index.html;` with no proxy — both are the
  signature of a site created with `clpctl site:add:static`, then hand
  -edited afterward to splice in the `/api/` block. `clpctl` has no
  subcommand that accepts arbitrary location-block arguments (confirmed
  against the full `clpctl` command listing below), so the same
  create-then-hand-edit approach is what this app needs too.
- `clpctl` (bare, since `--help` is not a valid flag on this CloudPanel
  version — `clpctl site:add:reverse-proxy --help` etc. errors with
  `"help" does not exist`) — prints full usage for every subcommand,
  including:
  ```
  clpctl site:add:static --domainName=www.domain.com --siteUser=john --siteUserPassword='!secretPassword!'
  clpctl site:add:reverse-proxy --domainName=www.domain.com --reverseProxyUrl='http://127.0.0.1:8000' --siteUser=john --siteUserPassword='!secretPassword!'
  clpctl site:install:certificate --domainName=www.domain.com --privateKey=/path/to/private.key --certificate=/path/to/certificate.crt --certificateChain=/path/to/chain.crt
  clpctl lets-encrypt:install:certificate --domainName=www.domain.com --subjectAlternativeName=domain1.com,www.domain1.com
  ```
  `site:install:certificate` is for uploading an already-issued certificate
  (private key + cert + chain files on disk) — not what we want here,
  since we have no existing cert for `todo.cooney.fun`. The command that
  actually issues a free cert is `lets-encrypt:install:certificate`, which
  is almost certainly how every existing site's cert (including
  `gifts.cooney.fun`'s, at `/etc/nginx/ssl-certificates/`) was obtained,
  per Task 1's finding that certbot isn't installed on this box at all.
- `ss -ltnp` on the live box (read-only) — the originally-planned port
  `3001` was found to still be referenced by `gifts.cooney.fun.conf`'s own
  `/api/` location, for a different (currently-stopped, not confirmed
  decommissioned) backend, so this app moved to **`3002`** instead — not
  bound by anything, and not referenced in any other site's nginx config
  on this box. **Step 1 below re-checks this immediately before creating
  anything**, not relying on this task's earlier read.
- `ls /home/` — no `todo` (or similarly named) site user or home
  directory exists yet, confirming the site has not been created.

## Command sequence

Run in order. Each command is idempotent to inspect before running (dry
-run notes included where relevant) and every write step includes how to
verify it before moving on.

1. **Re-confirm port 3002 is still free, immediately before creating anything that will bind it** (see "Investigation basis" above for why this needs a fresh check, not just Task 1/4's earlier reads):
   ```bash
   ssh todo-vps "ss -ltnp | grep ':3002\b' || echo '3002 is free'"
   ```
   If this prints anything other than "3002 is free", **stop** — do not proceed until the human has decided on a different host port (and Task 2's `docker-compose.prod.yml` / this file's proxy target are updated to match).

2. **Create the CloudPanel site as a static site** under a dedicated `todo`
   site user (mirrors `gifts.cooney.fun`'s and every other existing
   site's one-user-per-site convention; do not reuse another site's
   user). Generate a strong random password first rather than typing one
   inline:
   ```bash
   ssh todo-vps \
     "TODO_SITE_PW=\$(openssl rand -base64 24) && \
      clpctl site:add:static --domainName=todo.cooney.fun --siteUser=todo --siteUserPassword=\"\$TODO_SITE_PW\" && \
      echo \"todo site user password: \$TODO_SITE_PW\""
   ```
   **Save the printed password somewhere safe (e.g. a password manager)
   before closing the terminal** — this is the only time it's displayed.
   This creates `/home/todo/htdocs/todo.cooney.fun/` (the frontend build's
   deploy target), a matching Linux user, and generates
   `/etc/nginx/sites-enabled/todo.cooney.fun.conf` with CloudPanel's
   standard scaffold (server_name, an HTTP root before a cert exists, the
   shared `include /etc/nginx/global_settings;`, and a default
   `location /` this step's splice will replace).

3. **Verify the generated file exists and looks like the `gifts.cooney.fun` precedent** before editing it:
   ```bash
   ssh todo-vps "cat /etc/nginx/sites-enabled/todo.cooney.fun.conf"
   ```

4. **Copy this app's frontend build to the new site's htdocs root** (adjust the local build path if the frontend's `dist/` output has moved by Task 5's time):
   ```bash
   rsync -avz --delete \
     frontend/dist/ todo-vps:/home/todo/htdocs/todo.cooney.fun/
   ```
   (CloudPanel's static-site root is the domain's htdocs directory itself,
   per `gifts.cooney.fun.conf`'s `root /home/cooney-gifts/htdocs/gifts.cooney.fun/giftghost/dist;`
   — that site nests an extra `giftghost/dist` subdirectory because its
   build output was copied into a subfolder; this app can instead copy
   straight into the domain's htdocs root to keep the `root` directive
   CloudPanel already generated in step 2 unchanged.)

   **Fix ownership immediately after the rsync.** The command above runs
   as `root` over SSH, so the synced files land root-owned — that breaks
   CloudPanel's site-user ownership model (the `todo` site user, created
   in step 2, is expected to own everything under its own htdocs
   directory). Fix it before moving on:
   ```bash
   ssh todo-vps \
     "chown -R todo:todo /home/todo/htdocs/todo.cooney.fun/"
   ```

5. **Splice `deploy/nginx/todo.cooney.fun.locations.conf`'s contents into
   the generated file**, replacing the default `location /` block
   `site:add:static` created with the custom location blocks (the
   `/assets/`, `/sw.js`, `/manifest.webmanifest`, `/api/`, and `/` blocks
   in that file — see its own header comment for exactly what to
   replace). This has to be a manual edit — `clpctl` has no
   subcommand that accepts location-block arguments (confirmed in step 1
   of the investigation) — so do it by hand over SSH (e.g. `ssh` in
   interactively and use the editor of choice, or `scp` a locally-edited
   copy of the full file back up):
   ```bash
   # Pull the generated file down locally first, to edit against the real
   # CloudPanel scaffold rather than guessing at it:
   scp todo-vps:/etc/nginx/sites-enabled/todo.cooney.fun.conf /tmp/todo.cooney.fun.conf

   # Manually edit /tmp/todo.cooney.fun.conf: remove its default
   # `location / { try_files $uri $uri/ /index.html; }` block, then paste
   # in the full contents of deploy/nginx/todo.cooney.fun.locations.conf
   # in its place, before the server block's closing `}`.

   # Push the edited file back up:
   scp /tmp/todo.cooney.fun.conf todo-vps:/etc/nginx/sites-enabled/todo.cooney.fun.conf
   ```

6. **Syntax-check the spliced file on the live box** (this is the real
   check — Task 4's `docker run ... nginx -t` only proved the location
   blocks parse in isolation, not that they're valid once merged into
   CloudPanel's actual generated file):
   ```bash
   ssh todo-vps "nginx -t"
   ```
   If this fails, fix `/tmp/todo.cooney.fun.conf` locally, re-run step 5's
   `scp` push, and re-run this check — do not reload nginx with a config
   that fails `nginx -t`.

7. **Reload nginx** to pick up the new site (only after step 6 passes):
   ```bash
   ssh todo-vps "systemctl reload nginx"
   ```

8. **Issue the Let's Encrypt certificate** via CloudPanel's own
   integration (per Task 1's finding that certbot isn't installed on this
   box — do not attempt `certbot --nginx`):
   ```bash
   ssh todo-vps \
     "clpctl lets-encrypt:install:certificate --domainName=todo.cooney.fun"
   ```
   This both obtains the cert and updates
   `/etc/nginx/sites-enabled/todo.cooney.fun.conf`'s `ssl_certificate*`
   directives and HTTPS `listen` blocks itself (per the pattern in every
   existing `*.conf` file, e.g. `gifts.cooney.fun.conf`'s
   `ssl_certificate_key /etc/nginx/ssl-certificates/gifts.cooney.fun.key;`),
   which will re-run its own `nginx -t`/reload internally — re-verify
   with step 6's `nginx -t` afterward regardless, since this step
   rewrites the file this task hand-edited in step 5.

   **Prerequisite this step assumes but does not create:** `todo.cooney.fun`
   must already resolve (via DNS A/AAAA record at whatever registrar/DNS
   host manages `cooney.fun`) to the VPS's IP before Let's Encrypt's
   HTTP-01 challenge can succeed — Task 1 confirmed the subdomain does
   not resolve yet. That DNS record is outside this plan's automatable
   steps; confirm it's been created (and has propagated —
   `dig +short todo.cooney.fun` should return the VPS's IP) before
   running this step, or it will fail.

9. **Re-verify the spliced config's syntax and the live site end-to-end.**
   The backend container is already running by this point — it was started
   in `docs/DEPLOY.md`'s Step 3, from `/srv/todo-app/backend`, *before*
   this numbered sequence began (there is no separate backend-startup step
   in this file; starting the backend is `docs/DEPLOY.md` Step 3's job,
   not this file's) — so the `/api/health` check below exercises the full
   proxy path immediately, with nothing left to start first:
   ```bash
   ssh todo-vps "nginx -t"
   curl -sI https://todo.cooney.fun/                       # expect 200, index.html
   curl -sI https://todo.cooney.fun/assets/                # expect Cache-Control: public, immutable (on an actual asset file, once deployed)
   curl -sI https://todo.cooney.fun/sw.js                  # expect Cache-Control: no-cache
   curl -sI https://todo.cooney.fun/manifest.webmanifest   # expect Cache-Control: no-cache and Content-Type: application/manifest+json
   curl -si https://todo.cooney.fun/api/health              # expect 200 {"status":"ok"} proxied from the backend on 127.0.0.1:3002
   ```

## What this sequence deliberately does not cover

- Provisioning `todo.cooney.fun`'s DNS record — assumed done externally
  before step 8.
- Starting the backend container — that's `docs/DEPLOY.md`'s Step 3's job,
  already done by the time this sequence runs (this file only covers the
  nginx/CloudPanel site side; the backend's real repo checkout and `.env`
  live at `/srv/todo-app/backend` on the VPS, not under `/home/todo` —
  `/home/todo` is the frontend's static document root only).
- Any rollback/cutover plan if `nginx -t` in step 6 or step 9 fails after
  step 7's reload — if that happens, stop and get human input rather than
  improvising further live changes, per the plan's Global Constraints for
  a shared production box.
