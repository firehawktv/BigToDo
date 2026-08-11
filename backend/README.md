# ToDo App Backend

Fastify + Postgres API for the single-user ToDo app. See
`docs/superpowers/specs/2026-08-10-todo-app-design.md` for the product design.

## Setup

```bash
cp .env.example .env          # then set a real API_TOKEN
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml exec -T db psql -U todo -d todo -c "CREATE DATABASE todo_test;"
npm install
npm run migrate
npm run dev
```

Generate a token: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

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
  "createdAt": "ISO-8601"
}
```

`POST /capture-batches` stores the freeform text dump verbatim (newlines
included) before any AI parsing runs, so input survives even if parsing later
fails. The body is trimmed before storing; an empty or whitespace-only
`rawText` returns `400 {"error":"rawText must not be blank"}`.

`GET /capture-batches/:id` returns the batch plus its linked tasks (`tasks`,
in the same priority order as `GET /tasks`). Deleting a task does not delete
its batch — `tasks.capture_batch_id` is `ON DELETE SET NULL`, so the batch
survives with an empty or shorter `tasks` list.

## Migrations

Add a numbered file to `src/db/migrations/` (e.g. `002_push.sql`) and run
`npm run migrate`. Applied files are recorded in `schema_migrations` and never
re-run.
