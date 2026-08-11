# ToDo App Backend

Fastify + Postgres API for the single-user ToDo app. See
`docs/superpowers/specs/2026-08-10-todo-app-design.md` for the product design.

## Setup

```bash
cp .env.example .env          # then set a real API_TOKEN and ANTHROPIC_API_KEY
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml exec -T db psql -U todo -d todo -c "CREATE DATABASE todo_test;"
npm install
npm run migrate
npm run dev
```

Generate a token: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

`ANTHROPIC_API_KEY` is required to start the server (`npm run dev`/`npm start`)
and is used server-side only — it never reaches the client. Optional
`PARSE_MODEL`, `BREAKDOWN_MODEL`, and `AI_TIMEOUT_MS` overrides are documented
in `.env.example`. `npm run migrate` and `npm test` do not require it.

### Web Push setup

Generate a VAPID keypair once per deployment:

```bash
npm run vapid:generate
```

This prints `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` to put in `.env`.
**Regenerating the keypair invalidates every existing push subscription** —
every device would need to re-subscribe, since the browser ties a
subscription to the public key it was created with.

Required, alongside the keypair:

- `VAPID_SUBJECT` — a `mailto:` or `https:` URL identifying the sender, per
  the VAPID spec.
- `APP_URL` — the PWA's public URL; where a tapped notification opens.

Optional (documented in `.env.example`, with the server's defaults):

- `DEADLINE_LEAD_MINUTES` (default 60) — how far ahead of a task's `dueAt`
  the deadline alert fires.
- `SCHEDULER_TICK_MINUTES` (default 15) — how often the in-process scheduler
  runs; must divide 60 evenly (1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30).

Like `ANTHROPIC_API_KEY`, all of the above are required to start the server
(`npm run dev`/`npm start`) but not for `npm run migrate` or `npm test`.
`npm run migrate` applies `003_scheduler_push.sql` without needing any VAPID
variables set — the config that requires them is only read once the server
actually starts.

`npm run dev`, `npm start`, `npm run migrate`, and `npm test` all load `.env`
via Node's `--env-file-if-exists=.env` — that file is what supplies
`DATABASE_URL`, `API_TOKEN`, and (for tests) `TEST_DATABASE_URL`. There is no
other config loading step. (Vitest itself does not read `.env` — only
`VITE_`-prefixed vars reach `import.meta.env` — so the `test`/`test:watch`
scripts pass `--env-file-if-exists=.env` to the `node` process running Vitest
rather than relying on Vitest to do it.)

## Tests

`npm test` — runs against Postgres, single-threaded, truncating between tests.
Requires the Docker Postgres above to be running. The database URL comes from
`TEST_DATABASE_URL` (via `tests/setup.ts`, sourced from `.env`), falling back
to `postgres://todo:todo@localhost:5433/todo_test` if that variable is unset.

## Auth

Every route except `GET /health` requires `Authorization: Bearer $API_TOKEN`.
Missing or wrong tokens return `401 {"error":"Unauthorized"}`.

## Endpoints

| Method | Path | Body | Success |
| --- | --- | --- | --- |
| GET | `/health` | — | 200 `{status:"ok"}` (no auth) |
| POST | `/tasks` | `CreateTask` | 201 `Task` |
| GET | `/tasks` | — | 200 `{tasks: Task[]}` |
| GET | `/tasks/:id` | — | 200 `Task` / 404 |
| PATCH | `/tasks/:id` | `UpdateTask` | 200 `Task` / 404 |
| DELETE | `/tasks/:id` | — | 204 / 404 |
| POST | `/capture-batches` | `{rawText}` | 201 `CaptureBatch` |
| GET | `/capture-batches/:id` | — | 200 `CaptureBatch & {tasks}` / 404 |
| POST | `/capture` | `{rawText}` | 200 shortlist / 201 batch |
| POST | `/capture-batches/:id/parse` | — | 200 / 404 / 409 |
| POST | `/tasks/:id/breakdown` | — | 200 `{subtasks}` / 404 / 503 |
| POST | `/tasks/:id/subtasks` | `{subtasks}` | 201 `{tasks}` / 404 |
| GET | `/tasks/available?minutes=N` | — | 200 `{minutes, tasks}` |
| GET | `/push/vapid-public-key` | — | 200 `{publicKey}` |
| POST | `/push/subscriptions` | browser `PushSubscription` JSON | 201 `{id, endpoint, createdAt}` |
| DELETE | `/push/subscriptions` | `{endpoint}` | 204 / 404 |
| POST | `/push/test` | — | 200 `{sent, pruned, failed}` |
| GET | `/check-in-settings` | — | 200 `CheckInSettings` |
| PATCH | `/check-in-settings` | partial `CheckInSettings` | 200 `CheckInSettings` / 400 |

`GET /tasks` query parameters: `status` (`open`/`done`), `parentTaskId` (a uuid,
or `none` for top-level only), `captureBatchId`, `maxEstimatedMinutes`,
`limit` (1–200).

Tasks always come back ordered: priority high → low, then soonest `dueAt`
(nulls last), then oldest `createdAt`.

### Task shape

```json
{
  "id": "uuid",
  "title": "string",
  "notes": "string | null",
  "status": "open | done",
  "priority": "low | medium | high",
  "dueAt": "ISO-8601 | null",
  "estimatedMinutes": "integer | null",
  "parentTaskId": "uuid | null",
  "captureBatchId": "uuid | null",
  "source": "manual | ai_parsed | ai_breakdown",
  "suggestBreakdown": "boolean",
  "alertedAt": "ISO-8601 | null",
  "createdAt": "ISO-8601",
  "completedAt": "ISO-8601 | null"
}
```

`completedAt` is derived from `status` — set it by patching `status`, not directly.

### Capture batch shape

```json
{
  "id": "uuid",
  "rawText": "string",
  "parseStatus": "pending | parsed | failed",
  "parseError": "string | null",
  "createdAt": "ISO-8601"
}
```

`POST /capture-batches` stores the freeform text dump verbatim (newlines
included) before any AI parsing runs, so input survives even if parsing later
fails. The body is trimmed before storing; an empty or whitespace-only
`rawText` returns `400 {"error":"rawText must not be blank"}`. `rawText` is
capped at 20,000 characters (client should enforce and surface this before
submitting). This route only stores the batch — it stays `pending` until
`POST /capture-batches/:id/parse` is called on it; see "AI behaviour" below.

`GET /capture-batches/:id` returns the batch plus its linked tasks (`tasks`,
in the same priority order as `GET /tasks`). Deleting a task does not delete
its batch — `tasks.capture_batch_id` is `ON DELETE SET NULL`, so the batch
survives with an empty or shorter `tasks` list.

## AI behaviour

`POST /capture` takes a freeform text dump — capped at 20,000 characters,
same as `POST /capture-batches` (client should enforce and surface this) —
and routes it one of two ways:

- If the whole input reads as a "how much can I do?" question (e.g. "I have 20
  minutes", "half an hour free") it is answered as a **query**, not a capture:
  it returns `200 {type: 'shortlist', minutes, tasks}` — the top 5 open tasks
  whose `estimatedMinutes` fits, ordered the same way as `GET /tasks` — and
  saves nothing. No capture batch or task is created, so asking twice leaves
  no trace.
- Otherwise it is parsed into tasks. The raw text is saved as a `CaptureBatch`
  **before** parsing runs, so it survives even if parsing fails. On success it
  returns `201 {type: 'batch', batch, tasks}` with the batch marked `parsed`
  and each task's `source` set to `ai_parsed`. If Claude is unavailable for
  any reason, the batch is marked `failed` with `parseError` set, and exactly
  one ordinary (`source: manual`) task is created carrying the full dump in
  its `notes` — the user's input is never lost, just left for them to edit or
  retry.

`POST /capture-batches/:id/parse` is how a batch actually gets parsed — this
covers both a batch left `pending` by `POST /capture-batches` (which never
parses on its own) and a `failed` batch from a previous attempt. It 409s only
when the batch has already parsed successfully (`parseStatus: 'parsed'`); a
`pending` or `failed` batch can always be (re)parsed. Retrying deletes only
the fallback task from a previous failed attempt (`source: manual`, no
parent, no subtasks of its own) so a retry doesn't leave a duplicate behind —
it never deletes a task the parse itself produced (`ai_parsed`) or one the
user has since broken down into subtasks, since either may be work the user
doesn't want to lose.

Model choice: `claude-haiku-4-5` (cheap, fast) parses every capture; the
stronger `claude-sonnet-5` only runs when the user explicitly asks for a
breakdown, via `POST /tasks/:id/breakdown`. That route proposes 3–7 concrete
subtasks for a task and **persists nothing** — the user reviews and edits the
proposal, then `POST /tasks/:id/subtasks` (at most 20 subtasks per call)
saves the edited list as real tasks (`source: ai_breakdown`) under the parent
and clears the parent's `suggestBreakdown` flag, since the "Break this down?"
affordance no longer applies once the task actually has children.

A `503` from `POST /tasks/:id/breakdown` means Claude was unavailable for
this call (timeout, refusal, malformed response, etc.) — it is expected and
retryable, not a bug. The client should let the user try again rather than
treat it as a hard failure.

`suggestBreakdown` on a task is set by the Haiku parser when a captured item
reads as a vague project rather than a single action (e.g. "redesign the
website"), and is cleared automatically once subtasks are saved for that
task. It is otherwise a plain field the client can also set directly via
`PATCH /tasks/:id`.

## Push notifications

`POST /push/subscriptions` accepts the browser's `PushSubscription.toJSON()`
shape verbatim:

```json
{
  "endpoint": "https://...",
  "keys": { "p256dh": "...", "auth": "..." }
}
```

It upserts on `endpoint`, so a device that resubscribes (e.g. after rotating
keys) does not create a duplicate row. The response deliberately omits
`p256dh` and `auth`:

```json
{ "id": "uuid", "endpoint": "string", "createdAt": "ISO-8601" }
```

They are the device's own encryption material — the client already has them,
and there is no reason to echo them back over the wire.

`DELETE /push/subscriptions` takes `{endpoint}` and 404s if that endpoint
isn't registered.

`POST /push/test` sends a real notification to every registered subscription
and returns `{sent, pruned, failed}`. It exists because verifying push works
end to end — especially on iOS, where PWA push has extra install and
permission requirements — is fiddly enough to be worth a dedicated
just-try-it endpoint rather than only finding out via a deadline or check-in.

### Notification payload

Every push sent by the server — deadline alerts, check-ins, and `POST
/push/test` — uses the same payload shape, delivered as the `data` string on
the `push` event:

```json
{ "title": "string", "body": "string", "url": "string | undefined" }
```

The service worker should `JSON.parse` the event data to get this object.
`url` is the path or URL to open when the notification is tapped; it is
optional on the wire, but both scheduler sweeps and `POST /push/test`
currently always send `APP_URL`.

### Check-in settings

`GET /check-in-settings` returns, and `PATCH /check-in-settings` partially
updates:

```json
{
  "enabled": true,
  "activeFrom": "09:00",
  "activeTo": "18:00",
  "checkInsPerDay": 3,
  "timezone": "UTC",
  "updatedAt": "ISO-8601"
}
```

`activeFrom`/`activeTo` are local wall-clock `HH:MM` in `timezone` (an IANA
zone name, e.g. `Europe/London`). `checkInsPerDay` is 0–12. `PATCH` accepts
any non-empty subset of `enabled`, `activeFrom`, `activeTo`, `checkInsPerDay`,
`timezone`; an empty body, an unknown timezone, or a window where
`activeFrom` is not before `activeTo` all return 400. Since either end of the
window can be patched alone, the check is against the *merged* result — a
request that only sends `activeTo` is still validated against the currently
stored `activeFrom`.

## Scheduler

The server runs an in-process `node-cron` job on a `*/SCHEDULER_TICK_MINUTES`
schedule. It is started from `server.ts` after the HTTP server is listening,
**not** from `buildApp()` — the test suite builds the app via
`buildTestApp()` and never starts the cron, so tests stay deterministic and
never send a real push. Because the scheduler is in-process state, the
service must not be scaled beyond one instance, or every alert would fire
once per instance.

Each tick runs two sweeps:

- **Deadline alerts.** Open tasks whose `dueAt` falls within
  `DEADLINE_LEAD_MINUTES` (including tasks already overdue, e.g. ones that
  were due while the service was down) get one push each. `alerted_at` is
  stamped only once the push was actually delivered to at least one device —
  a task with no registered subscriptions yet is left un-alerted and is
  re-examined on the next tick, so installing the app and granting
  permission later still gets the alert. Once stamped, the same task never
  alerts twice — idempotent even across restarts, since the stamp is in the
  database rather than in memory. Rescheduling a task (`PATCH /tasks/:id`
  with a new `dueAt`) clears any existing `alerted_at`, so a task that was
  already alerted and then pushed to a new date gets a fresh alert for the
  new date.
- **Check-ins.** Randomized across the configured active window, rather than
  scheduled at fixed times: each tick computes the probability that *this*
  tick should be one of the day's remaining check-ins from how many are still
  owed and how many ticks remain in the window, so the arrival times are
  unpredictable but the count still converges on the target by the end of the
  window. `checkInsPerDay` is therefore a target, not a guarantee — a
  short-lived active window or infrequent ticks can under-deliver it. The
  window is interpreted in `timezone` and does not support wrapping past
  midnight (a migration-level `CHECK` enforces `activeFrom < activeTo`); a
  night-shift schedule isn't supported in v1.

Both sweeps send through the same delivery path: a subscription that the push
service reports as gone (HTTP 404/410) is pruned from the database
automatically; any other failure is just logged and retried on the next tick
without consuming that day's check-in quota or marking a task alerted.

## Migrations

Add a numbered file to `src/db/migrations/` (e.g. `004_your_change.sql`) and
run `npm run migrate`. Applied files are recorded in `schema_migrations` and
never re-run.
