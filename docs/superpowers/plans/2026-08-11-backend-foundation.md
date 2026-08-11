# Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Fastify + Postgres API foundation for the ToDo app — schema, migrations, token auth, and CRUD for tasks and capture batches — so every later subsystem (AI parsing, scheduler/push, PWA) has a working, tested backend to build on.

**Architecture:** A single Fastify (TypeScript, ESM) service talking to Postgres through the `pg` driver. SQL lives in thin repository modules (`src/repositories/*`) that own row↔object mapping; routes (`src/routes/*`) own HTTP concerns only — validation via TypeBox JSON Schema, auth via a single bearer-token `preHandler` plugin. Schema changes ship as numbered `.sql` files applied by a small idempotent migration runner. `buildApp()` returns a configured Fastify instance so tests can drive it with `fastify.inject()` without binding a port.

**Tech Stack:** Node 22 LTS, TypeScript 5.x (ESM, `NodeNext`), Fastify 5, `@fastify/type-provider-typebox` + `@sinclair/typebox`, `pg` 8, Vitest 3, Docker Compose (Postgres 16 for local dev + tests).

## Global Constraints

- **Single-user only.** No user accounts, no registration, no per-user scoping. Auth is one long-lived bearer token from `API_TOKEN`. Never add a `user_id` column.
- **Postgres is canonical.** No offline support, no client-side source of truth. Every read/write goes through this API.
- **Claude API key never reaches the client.** No AI calls in this plan at all — AI belongs to the "AI Capture & Breakdown" plan. This plan stores raw capture text only.
- **Node version floor:** Node 22 LTS. ESM only (`"type": "module"`); relative imports carry the `.js` extension.
- **Enum values are exactly as specified, lowercase:** `status` ∈ {`open`, `done`}; `priority` ∈ {`low`, `medium`, `high`}; `source` ∈ {`manual`, `ai_parsed`, `ai_breakdown`}.
- **API field naming:** JSON is camelCase (`dueAt`, `estimatedMinutes`); database columns are snake_case (`due_at`, `estimated_minutes`). Repositories are the only place that translates between the two.
- **Timestamps** are `timestamptz` in Postgres and ISO-8601 UTC strings in JSON.
- **Fastify 5's default validator bundles `ajv-formats`**, so `format: 'uuid'` and `format: 'date-time'` validate without extra configuration, and `fast-json-stringify` serializes `Date` objects to ISO strings for `date-time` string fields. Task 5 Step 4 verifies both behaviours — if that test fails, install `ajv-formats` and pass it via `Fastify({ ajv: { plugins: [addFormats] } })`.
- **Tests run against a real Postgres**, never a mock or SQLite. Vitest runs single-threaded so tests share one database safely.
- **All work happens in `backend/`** at the repo root. Do not create files outside it (except this plan's own commits).

---

## File Structure

```
backend/
  package.json                     — deps, scripts (dev/build/test/migrate)
  tsconfig.json                    — ESM, NodeNext, strict
  vitest.config.ts                 — single-threaded, setupFiles
  .env.example                     — documented env contract
  .gitignore
  docker-compose.dev.yml           — Postgres 16 for local dev + tests
  src/
    config.ts                      — parse + validate env into a typed Config
    server.ts                      — entrypoint: buildApp() then listen()
    app.ts                         — buildApp(): composition root, registers plugins + routes
    db/
      pool.ts                      — pg Pool singleton built from config
      migrate.ts                   — migration runner + CLI entrypoint
      migrations/
        001_init.sql               — tasks + capture_batches schema
    plugins/
      auth.ts                      — bearer-token preHandler (fastify-plugin)
    schemas/
      task.ts                      — TypeBox schemas + static types for tasks
      captureBatch.ts              — TypeBox schemas + static types for batches
    repositories/
      tasks.ts                     — all SQL for tasks, row↔object mapping
      captureBatches.ts            — all SQL for capture_batches
    routes/
      health.ts                    — GET /health (unauthenticated)
      tasks.ts                     — /tasks CRUD
      captureBatches.ts            — /capture-batches create + read
  tests/
    setup.ts                       — sets test env vars before modules load
    helpers/db.ts                  — migrate once, truncate between tests
    helpers/app.ts                 — buildTestApp()
    config.test.ts
    health.test.ts
    migrate.test.ts
    auth.test.ts
    repositories/tasks.test.ts
    routes/tasks.test.ts
    routes/captureBatches.test.ts
```

Responsibility split: `repositories/` is the only layer that writes SQL or knows about snake_case. `routes/` is the only layer that knows about HTTP status codes and request shapes. `schemas/` is shared between them and is the single definition of the wire contract.

---

## Task 1: Project Scaffolding, Config, and Health Endpoint

Sets up the whole `backend/` workspace, a typed+validated config module, a running Fastify app, and the Vitest harness. Deliverable: `npm test` passes and `GET /health` returns 200.

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/vitest.config.ts`
- Create: `backend/.gitignore`
- Create: `backend/.env.example`
- Create: `backend/docker-compose.dev.yml`
- Create: `backend/src/config.ts`
- Create: `backend/src/app.ts`
- Create: `backend/src/server.ts`
- Create: `backend/src/routes/health.ts`
- Create: `backend/tests/setup.ts`
- Test: `backend/tests/config.test.ts`
- Test: `backend/tests/health.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `loadConfig(env?: NodeJS.ProcessEnv): Config` where `Config = { databaseUrl: string; apiToken: string; port: number; host: string; logLevel: string }`
  - `config: Config` — the module-level default export used by the rest of the app
  - `buildApp(opts?: { logger?: boolean }): Promise<FastifyInstance>` — every later task registers into this
  - Fastify instance uses `TypeBoxTypeProvider`; routes are written with `.withTypeProvider<TypeBoxTypeProvider>()`

- [ ] **Step 1: Create the workspace, install dependencies, and write the config files**

```bash
mkdir -p backend/src/{db/migrations,plugins,schemas,repositories,routes} \
         backend/tests/{helpers,repositories,routes}
cd backend
npm init -y
npm pkg set type="module"
npm install fastify@^5 @fastify/type-provider-typebox@^5 @sinclair/typebox@^0.34 pg@^8
npm install -D typescript@^5 @types/node@^22 @types/pg@^8 vitest@^3 tsx@^4
```

`backend/package.json` — replace the `scripts` block with:

```json
{
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "migrate": "tsx src/db/migrate.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

`backend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
```

`backend/vitest.config.ts` — single-threaded so the shared test database is never written by two files at once:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
})
```

`backend/.gitignore`:

```gitignore
node_modules/
dist/
.env
```

`backend/.env.example`:

```bash
# Postgres connection string for the app
DATABASE_URL=postgres://todo:todo@localhost:5433/todo

# Postgres connection string used by the test suite (wiped between tests)
TEST_DATABASE_URL=postgres://todo:todo@localhost:5433/todo_test

# Single long-lived bearer token the client sends. Minimum 32 characters.
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
API_TOKEN=replace-me-with-a-32-plus-character-random-string

PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info
```

`backend/docker-compose.dev.yml` — port 5433 avoids colliding with any Postgres already on 5432:

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: todo
      POSTGRES_PASSWORD: todo
      POSTGRES_DB: todo
    ports:
      - "5433:5432"
    volumes:
      - todo_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U todo"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  todo_pgdata:
```

Start the database and create the test database (leave it running for the rest of the plan):

```bash
docker compose -f docker-compose.dev.yml up -d
sleep 5
docker compose -f docker-compose.dev.yml exec -T db psql -U todo -d todo -c "CREATE DATABASE todo_test;"
```

`backend/tests/setup.ts` — runs before any test file imports `config.ts`, so the app always points at the test database:

```ts
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://todo:todo@localhost:5433/todo_test'
process.env.API_TOKEN = 'test-token-0123456789abcdef0123456789abcdef'
process.env.LOG_LEVEL = 'silent'
```

- [ ] **Step 2: Write the failing config test**

`backend/tests/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'

const validEnv = {
  DATABASE_URL: 'postgres://todo:todo@localhost:5433/todo',
  API_TOKEN: 'a'.repeat(32),
}

describe('loadConfig', () => {
  it('returns a typed config from a valid environment', () => {
    const config = loadConfig({ ...validEnv, PORT: '4000', HOST: '127.0.0.1' })
    expect(config).toEqual({
      databaseUrl: 'postgres://todo:todo@localhost:5433/todo',
      apiToken: 'a'.repeat(32),
      port: 4000,
      host: '127.0.0.1',
      logLevel: 'info',
    })
  })

  it('applies defaults for optional values', () => {
    const config = loadConfig(validEnv)
    expect(config.port).toBe(3000)
    expect(config.host).toBe('0.0.0.0')
    expect(config.logLevel).toBe('info')
  })

  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadConfig({ API_TOKEN: 'a'.repeat(32) })).toThrow(/DATABASE_URL/)
  })

  it('throws when API_TOKEN is missing', () => {
    expect(() => loadConfig({ DATABASE_URL: validEnv.DATABASE_URL })).toThrow(/API_TOKEN/)
  })

  it('rejects a short API_TOKEN so a guessable token cannot ship', () => {
    expect(() => loadConfig({ ...validEnv, API_TOKEN: 'short' })).toThrow(/at least 32/)
  })

  it('rejects a non-numeric PORT', () => {
    expect(() => loadConfig({ ...validEnv, PORT: 'abc' })).toThrow(/PORT/)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/config.test.ts`
Expected: FAIL — `Failed to resolve import "../src/config.js"`.

- [ ] **Step 4: Implement `src/config.ts`**

```ts
export interface Config {
  databaseUrl: string
  apiToken: string
  port: number
  host: string
  logLevel: string
}

const MIN_TOKEN_LENGTH = 32

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = required(env, 'DATABASE_URL')
  const apiToken = required(env, 'API_TOKEN')

  if (apiToken.length < MIN_TOKEN_LENGTH) {
    throw new Error(`API_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`)
  }

  const rawPort = env.PORT ?? '3000'
  const port = Number(rawPort)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got: ${rawPort}`)
  }

  return {
    databaseUrl,
    apiToken,
    port,
    host: env.HOST ?? '0.0.0.0',
    logLevel: env.LOG_LEVEL ?? 'info',
  }
}

export const config = loadConfig()
```

- [ ] **Step 5: Run the config test to verify it passes**

Run: `cd backend && npx vitest run tests/config.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 6: Write the failing health test**

`backend/tests/health.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'

describe('GET /health', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({ logger: false })
  })

  afterAll(async () => {
    await app.close()
  })

  it('returns ok without any authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })

  it('returns 404 for an unknown route', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope' })
    expect(response.statusCode).toBe(404)
  })
})
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/health.test.ts`
Expected: FAIL — `Failed to resolve import "../src/app.js"`.

- [ ] **Step 8: Implement the health route, `app.ts`, and `server.ts`**

`backend/src/routes/health.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.withTypeProvider<TypeBoxTypeProvider>().get(
    '/health',
    {
      schema: {
        response: {
          200: Type.Object({ status: Type.Literal('ok') }),
        },
      },
    },
    async () => ({ status: 'ok' as const }),
  )
}
```

`backend/src/app.ts` — the composition root. Later tasks register their plugins and routes here:

```ts
import Fastify, { type FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { config } from './config.js'
import { healthRoutes } from './routes/health.js'

export interface BuildAppOptions {
  logger?: boolean
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.logLevel },
    // Fastify's default ajv config sets removeAdditional: true, which silently
    // STRIPS unknown properties. Our schemas declare additionalProperties: false
    // because they want a 400, not a quiet edit of the caller's payload.
    ajv: { customOptions: { removeAdditional: false } },
  }).withTypeProvider<TypeBoxTypeProvider>()

  await app.register(healthRoutes)

  return app
}
```

`backend/src/server.ts`:

```ts
import { buildApp } from './app.js'
import { config } from './config.js'

const app = await buildApp()

try {
  await app.listen({ port: config.port, host: config.host })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.close().then(
      () => process.exit(0),
      (error) => {
        app.log.error(error)
        process.exit(1)
      },
    )
  })
}
```

- [ ] **Step 9: Run the full suite and the type checker**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: no type errors; PASS — 8 tests across 2 files.

- [ ] **Step 10: Commit**

```bash
cd backend && git add -A . && cd .. && git add docs/superpowers/plans
git commit -m "feat(backend): scaffold Fastify app with typed config and health endpoint"
```

---

## Task 2: Migration Runner and Initial Schema

A migration runner that applies numbered `.sql` files exactly once, plus the `tasks` and `capture_batches` schema from the spec. Deliverable: `npm run migrate` builds the schema from empty, and re-running it is a no-op.

**Files:**
- Create: `backend/src/db/pool.ts`
- Create: `backend/src/db/migrate.ts`
- Create: `backend/src/db/migrations/001_init.sql`
- Create: `backend/tests/helpers/db.ts`
- Test: `backend/tests/migrate.test.ts`

**Interfaces:**
- Consumes: `config` from `src/config.ts` (Task 1).
- Produces:
  - `pool: Pool` — the shared `pg` pool, imported by every repository
  - `closePool(): Promise<void>`
  - `runMigrations(client?: PoolClient): Promise<string[]>` — returns the filenames applied this run (empty array when already up to date)
  - Test helper `setupTestDatabase(): Promise<void>` (migrates once per run) and `truncateAll(): Promise<void>`
  - Database schema: tables `capture_batches`, `tasks`; enum types `task_status`, `task_priority`, `task_source`

- [ ] **Step 1: Write the failing migration test**

`backend/tests/migrate.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pool, closePool } from '../src/db/pool.js'
import { runMigrations } from '../src/db/migrate.js'

describe('runMigrations', () => {
  beforeAll(async () => {
    // Start from a genuinely empty database so the test proves migrations
    // build the schema from nothing, not just that they already ran.
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  })

  afterAll(async () => {
    await closePool()
  })

  it('applies every pending migration and reports which ones ran', async () => {
    const applied = await runMigrations()
    expect(applied).toContain('001_init.sql')
  })

  it('creates the tasks and capture_batches tables', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    )
    const names = rows.map((row) => row.table_name)
    expect(names).toContain('tasks')
    expect(names).toContain('capture_batches')
    expect(names).toContain('schema_migrations')
  })

  it('orders the priority enum low < medium < high so ORDER BY priority DESC ranks high first', async () => {
    const { rows } = await pool.query<{ priority: string }>(
      `SELECT unnest(enum_range(NULL::task_priority))::text AS priority`,
    )
    expect(rows.map((row) => row.priority)).toEqual(['low', 'medium', 'high'])
  })

  it('cascades deletes from a parent task to its subtasks', async () => {
    const { rows: parents } = await pool.query<{ id: string }>(
      `INSERT INTO tasks (title) VALUES ('parent') RETURNING id`,
    )
    const parentId = parents[0]!.id
    await pool.query(`INSERT INTO tasks (title, parent_task_id) VALUES ('child', $1)`, [parentId])

    await pool.query(`DELETE FROM tasks WHERE id = $1`, [parentId])

    const { rows: remaining } = await pool.query(`SELECT id FROM tasks`)
    expect(remaining).toHaveLength(0)
  })

  it('is a no-op when run a second time', async () => {
    const applied = await runMigrations()
    expect(applied).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/migrate.test.ts`
Expected: FAIL — `Failed to resolve import "../src/db/pool.js"`.

- [ ] **Step 3: Implement the pool**

`backend/src/db/pool.ts`:

```ts
import pg from 'pg'
import { config } from '../config.js'

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
})

export async function closePool(): Promise<void> {
  await pool.end()
}
```

- [ ] **Step 4: Write the initial schema**

`backend/src/db/migrations/001_init.sql` — note the enum declaration order: Postgres sorts enums by declaration order, so `ORDER BY priority DESC` naturally yields high → medium → low, which every task-listing query relies on.

```sql
CREATE TYPE task_status AS ENUM ('open', 'done');
CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high');
CREATE TYPE task_source AS ENUM ('manual', 'ai_parsed', 'ai_breakdown');

CREATE TABLE capture_batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_text    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title              text NOT NULL CHECK (length(btrim(title)) > 0),
  notes              text,
  status             task_status NOT NULL DEFAULT 'open',
  priority           task_priority NOT NULL DEFAULT 'medium',
  due_at             timestamptz,
  estimated_minutes  integer CHECK (estimated_minutes IS NULL OR estimated_minutes > 0),
  parent_task_id     uuid REFERENCES tasks (id) ON DELETE CASCADE,
  capture_batch_id   uuid REFERENCES capture_batches (id) ON DELETE SET NULL,
  source             task_source NOT NULL DEFAULT 'manual',
  alerted_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz
);

-- Deadline-alert sweep: open tasks with a due date, ordered by due_at.
CREATE INDEX tasks_open_due_at_idx ON tasks (due_at) WHERE status = 'open';

-- Subtask lookups when rendering a broken-down project.
CREATE INDEX tasks_parent_task_id_idx ON tasks (parent_task_id);

-- Review list for a freshly parsed capture batch.
CREATE INDEX tasks_capture_batch_id_idx ON tasks (capture_batch_id);
```

- [ ] **Step 5: Implement the migration runner**

`backend/src/db/migrate.ts`:

```ts
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool, closePool } from './pool.js'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

/**
 * Applies every .sql file in migrations/ that has not been applied yet, in
 * filename order. Each file runs inside its own transaction together with the
 * bookkeeping insert, so a failure leaves no half-applied migration behind.
 * Returns the filenames applied during this run.
 */
export async function runMigrations(): Promise<string[]> {
  const client = await pool.connect()
  const applied: string[] = []

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      );
    `)

    const { rows } = await client.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations',
    )
    const alreadyApplied = new Set(rows.map((row) => row.filename))

    const filenames = (await readdir(MIGRATIONS_DIR))
      .filter((name) => name.endsWith('.sql'))
      .sort()

    for (const filename of filenames) {
      if (alreadyApplied.has(filename)) continue

      const sql = await readFile(join(MIGRATIONS_DIR, filename), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename])
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw new Error(`Migration ${filename} failed: ${(error as Error).message}`, {
          cause: error,
        })
      }
      applied.push(filename)
    }

    return applied
  } finally {
    client.release()
  }
}

// CLI entrypoint: `npm run migrate`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const applied = await runMigrations()
    console.log(
      applied.length > 0
        ? `Applied ${applied.length} migration(s): ${applied.join(', ')}`
        : 'Database already up to date.',
    )
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    await closePool()
  }
}
```

- [ ] **Step 6: Run the migration test to verify it passes**

Run: `cd backend && npx vitest run tests/migrate.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 7: Write the shared test database helper**

Later test files use this instead of migrating themselves.

`backend/tests/helpers/db.ts`:

```ts
import { pool } from '../../src/db/pool.js'
import { runMigrations } from '../../src/db/migrate.js'

let migrated: Promise<unknown> | undefined

/** Migrates the test database once per process; safe to await in every beforeAll. */
export async function setupTestDatabase(): Promise<void> {
  migrated ??= runMigrations()
  await migrated
}

/** Wipes all data (but keeps the schema) so each test starts from a clean slate. */
export async function truncateAll(): Promise<void> {
  await pool.query('TRUNCATE tasks, capture_batches RESTART IDENTITY CASCADE')
}
```

- [ ] **Step 8: Apply migrations to the dev database and verify the CLI**

Run:
```bash
cd backend && DATABASE_URL=postgres://todo:todo@localhost:5433/todo npm run migrate
DATABASE_URL=postgres://todo:todo@localhost:5433/todo npm run migrate
```
Expected: first run prints `Applied 1 migration(s): 001_init.sql`; second prints `Database already up to date.`

- [ ] **Step 9: Commit**

```bash
git add backend/src/db backend/tests
git commit -m "feat(backend): add migration runner and initial tasks schema"
```

---

## Task 3: Bearer Token Authentication

One shared token guards every route except `/health`. Deliverable: protected routes reject missing, malformed, and wrong tokens with 401, and accept the correct one.

**Files:**
- Create: `backend/src/plugins/auth.ts`
- Modify: `backend/src/app.ts` (register the plugin)
- Create: `backend/tests/helpers/app.ts`
- Test: `backend/tests/auth.test.ts`

**Interfaces:**
- Consumes: `config.apiToken` (Task 1), `buildApp()` (Task 1).
- Produces:
  - Fastify decorator `app.requireAuth: preHandlerHookHandler` — attach via `{ preHandler: app.requireAuth }` on any route that needs protection. Every route in Tasks 5 and 6 uses it.
  - Test helper `buildTestApp(): Promise<FastifyInstance>` and `authHeaders(): { authorization: string }`

- [ ] **Step 1: Write the failing auth test**

`backend/tests/auth.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildTestApp, authHeaders } from './helpers/app.js'
import { config } from '../src/config.js'

describe('bearer token auth', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildTestApp()
    // A throwaway protected route: this test is about the guard, not about tasks.
    app.get('/protected', { preHandler: app.requireAuth }, async () => ({ ok: true }))
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('rejects a request with no Authorization header', async () => {
    const response = await app.inject({ method: 'GET', url: '/protected' })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ error: 'Unauthorized' })
  })

  it('rejects a non-Bearer scheme', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    })
    expect(response.statusCode).toBe(401)
  })

  it('rejects a wrong token of the same length', async () => {
    // Derive the length from the real token: a hardcoded length that happens
    // not to match sends this test down the length-mismatch branch instead of
    // the constant-time comparison it exists to cover.
    const forged = 'b'.repeat(config.apiToken.length)
    expect(forged.length).toBe(config.apiToken.length)

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${forged}` },
    })
    expect(response.statusCode).toBe(401)
  })

  it('rejects a token that is a prefix of the real one', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer test-token' },
    })
    expect(response.statusCode).toBe(401)
  })

  it('accepts the configured token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: authHeaders(),
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true })
  })

  it('leaves /health reachable without a token', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
  })
})
```

- [ ] **Step 2: Write the test app helper**

`backend/tests/helpers/app.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { config } from '../../src/config.js'
import { setupTestDatabase } from './db.js'

export async function buildTestApp(): Promise<FastifyInstance> {
  await setupTestDatabase()
  return buildApp({ logger: false })
}

export function authHeaders(): { authorization: string } {
  return { authorization: `Bearer ${config.apiToken}` }
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/auth.test.ts`
Expected: FAIL — `app.requireAuth is not a function`.

- [ ] **Step 4: Implement the auth plugin**

Install the plugin wrapper first so the decorator escapes the plugin's encapsulation context:

```bash
cd backend && npm install fastify-plugin@^5
```

`backend/src/plugins/auth.ts`:

```ts
import { timingSafeEqual } from 'node:crypto'
import type { FastifyPluginAsync, preHandlerHookHandler } from 'fastify'
import fp from 'fastify-plugin'
import { config } from '../config.js'

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: preHandlerHookHandler
  }
}

const BEARER_PREFIX = 'Bearer '

/** Constant-time compare that does not leak length through early return timing. */
function tokensMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided, 'utf8')
  const expectedBuffer = Buffer.from(expected, 'utf8')
  if (providedBuffer.length !== expectedBuffer.length) {
    // Still burn a comparison so a length mismatch is not measurably faster.
    timingSafeEqual(expectedBuffer, expectedBuffer)
    return false
  }
  return timingSafeEqual(providedBuffer, expectedBuffer)
}

const authPlugin: FastifyPluginAsync = async (app) => {
  const requireAuth: preHandlerHookHandler = async (request, reply) => {
    const header = request.headers.authorization
    if (header === undefined || !header.startsWith(BEARER_PREFIX)) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }
    if (!tokensMatch(header.slice(BEARER_PREFIX.length), config.apiToken)) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }
  }

  app.decorate('requireAuth', requireAuth)
}

export default fp(authPlugin, { name: 'auth' })
```

- [ ] **Step 5: Register the plugin in `app.ts`**

In `backend/src/app.ts`, add the import and register it before the routes:

```ts
import authPlugin from './plugins/auth.js'
```

```ts
  await app.register(authPlugin)
  await app.register(healthRoutes)
```

- [ ] **Step 6: Run the auth test to verify it passes**

Run: `cd backend && npx vitest run tests/auth.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 7: Commit**

```bash
git add backend/src backend/tests backend/package.json backend/package-lock.json
git commit -m "feat(backend): guard routes with a constant-time bearer token check"
```

---

## Task 4: Tasks Repository

All task SQL and row↔object mapping in one module, tested directly against Postgres. Deliverable: create/list/get/update/delete work, including the ordering rule and the `completed_at` transition.

**Files:**
- Create: `backend/src/schemas/task.ts`
- Create: `backend/src/repositories/tasks.ts`
- Test: `backend/tests/repositories/tasks.test.ts`

**Interfaces:**
- Consumes: `pool` (Task 2), `setupTestDatabase` / `truncateAll` (Task 2).
- Produces — Task 5's routes call exactly these:
  - Types `TaskStatusValue = 'open' | 'done'`, `TaskPriorityValue = 'low' | 'medium' | 'high'`, `TaskSourceValue = 'manual' | 'ai_parsed' | 'ai_breakdown'`
  - `interface Task { id, title, notes, status, priority, dueAt, estimatedMinutes, parentTaskId, captureBatchId, source, alertedAt, createdAt, completedAt }` — timestamps are `Date | null`, `createdAt` is `Date`
  - `createTask(input: CreateTaskInput): Promise<Task>`
  - `createTasks(inputs: CreateTaskInput[]): Promise<Task[]>` — all-or-nothing insert in one transaction; the AI parsing plan uses this to land a parsed batch
  - `listTasks(filter?: ListTasksFilter): Promise<Task[]>` where `ListTasksFilter = { status?: TaskStatusValue; parentTaskId?: string | null; captureBatchId?: string; maxEstimatedMinutes?: number; limit?: number }` — `parentTaskId: null` means top-level only
  - `getTask(id: string): Promise<Task | null>`
  - `updateTask(id: string, patch: UpdateTaskInput): Promise<Task | null>`
  - `deleteTask(id: string): Promise<boolean>`

- [ ] **Step 1: Write the failing repository test**

`backend/tests/repositories/tasks.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closePool } from '../../src/db/pool.js'
import { setupTestDatabase, truncateAll } from '../helpers/db.js'
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  updateTask,
} from '../../src/repositories/tasks.js'

describe('tasks repository', () => {
  beforeAll(async () => {
    await setupTestDatabase()
  })

  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await closePool()
  })

  it('creates a task with spec defaults when only a title is given', async () => {
    const task = await createTask({ title: 'Buy milk' })

    expect(task.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(task.title).toBe('Buy milk')
    expect(task.status).toBe('open')
    expect(task.priority).toBe('medium')
    expect(task.source).toBe('manual')
    expect(task.notes).toBeNull()
    expect(task.dueAt).toBeNull()
    expect(task.estimatedMinutes).toBeNull()
    expect(task.parentTaskId).toBeNull()
    expect(task.completedAt).toBeNull()
    expect(task.createdAt).toBeInstanceOf(Date)
  })

  it('round-trips every optional field', async () => {
    const dueAt = new Date('2026-09-01T10:00:00.000Z')
    const task = await createTask({
      title: 'File taxes',
      notes: 'from the raw dump',
      priority: 'high',
      dueAt,
      estimatedMinutes: 90,
      source: 'ai_parsed',
    })

    expect(task.notes).toBe('from the raw dump')
    expect(task.priority).toBe('high')
    expect(task.dueAt?.toISOString()).toBe('2026-09-01T10:00:00.000Z')
    expect(task.estimatedMinutes).toBe(90)
    expect(task.source).toBe('ai_parsed')
  })

  it('returns null from getTask for an id that does not exist', async () => {
    expect(await getTask('00000000-0000-0000-0000-000000000000')).toBeNull()
  })

  it('orders lists by priority (high first), then soonest due date, then oldest', async () => {
    await createTask({ title: 'low', priority: 'low' })
    await createTask({ title: 'high-later', priority: 'high', dueAt: new Date('2026-09-05T00:00:00Z') })
    await createTask({ title: 'high-sooner', priority: 'high', dueAt: new Date('2026-09-01T00:00:00Z') })
    await createTask({ title: 'medium', priority: 'medium' })

    const tasks = await listTasks()

    expect(tasks.map((task) => task.title)).toEqual(['high-sooner', 'high-later', 'medium', 'low'])
  })

  it('sorts tasks without a due date after tasks with one at the same priority', async () => {
    await createTask({ title: 'no-due', priority: 'high' })
    await createTask({ title: 'has-due', priority: 'high', dueAt: new Date('2026-12-31T00:00:00Z') })

    const tasks = await listTasks()

    expect(tasks.map((task) => task.title)).toEqual(['has-due', 'no-due'])
  })

  it('filters by status', async () => {
    const open = await createTask({ title: 'still open' })
    const done = await createTask({ title: 'finished' })
    await updateTask(done.id, { status: 'done' })

    const openTasks = await listTasks({ status: 'open' })
    const doneTasks = await listTasks({ status: 'done' })

    expect(openTasks.map((task) => task.id)).toEqual([open.id])
    expect(doneTasks.map((task) => task.id)).toEqual([done.id])
  })

  it('filters to top-level tasks with parentTaskId null, and to children by id', async () => {
    const parent = await createTask({ title: 'Redesign site' })
    const child = await createTask({ title: 'Sketch layout', parentTaskId: parent.id })

    const topLevel = await listTasks({ parentTaskId: null })
    const children = await listTasks({ parentTaskId: parent.id })

    expect(topLevel.map((task) => task.id)).toEqual([parent.id])
    expect(children.map((task) => task.id)).toEqual([child.id])
  })

  it('filters by maxEstimatedMinutes and excludes tasks with no estimate', async () => {
    await createTask({ title: 'quick', estimatedMinutes: 10 })
    await createTask({ title: 'exactly at limit', estimatedMinutes: 20 })
    await createTask({ title: 'too long', estimatedMinutes: 45 })
    await createTask({ title: 'unestimated' })

    const tasks = await listTasks({ maxEstimatedMinutes: 20 })

    expect(tasks.map((task) => task.title).sort()).toEqual(['exactly at limit', 'quick'])
  })

  it('respects limit', async () => {
    await createTask({ title: 'a' })
    await createTask({ title: 'b' })
    await createTask({ title: 'c' })

    expect(await listTasks({ limit: 2 })).toHaveLength(2)
  })

  it('updates only the fields present in the patch', async () => {
    const task = await createTask({ title: 'Original', notes: 'keep me', priority: 'low' })

    const updated = await updateTask(task.id, { title: 'Renamed' })

    expect(updated?.title).toBe('Renamed')
    expect(updated?.notes).toBe('keep me')
    expect(updated?.priority).toBe('low')
  })

  it('clears a nullable field when the patch sets it to null', async () => {
    const task = await createTask({ title: 'Has a due date', dueAt: new Date('2026-09-01T00:00:00Z') })

    const updated = await updateTask(task.id, { dueAt: null })

    expect(updated?.dueAt).toBeNull()
  })

  it('stamps completed_at when a task becomes done and clears it when reopened', async () => {
    const task = await createTask({ title: 'Finish plan' })

    const done = await updateTask(task.id, { status: 'done' })
    expect(done?.status).toBe('done')
    expect(done?.completedAt).toBeInstanceOf(Date)

    const reopened = await updateTask(task.id, { status: 'open' })
    expect(reopened?.status).toBe('open')
    expect(reopened?.completedAt).toBeNull()
  })

  it('does not move completed_at when a task is marked done twice', async () => {
    const task = await createTask({ title: 'Finish plan' })
    const first = await updateTask(task.id, { status: 'done' })
    const second = await updateTask(task.id, { status: 'done', title: 'Finish plan!' })

    expect(second?.completedAt?.toISOString()).toBe(first?.completedAt?.toISOString())
  })

  it('returns null when updating a task that does not exist', async () => {
    const result = await updateTask('00000000-0000-0000-0000-000000000000', { title: 'ghost' })
    expect(result).toBeNull()
  })

  it('deletes a task and reports whether anything was deleted', async () => {
    const task = await createTask({ title: 'Delete me' })

    expect(await deleteTask(task.id)).toBe(true)
    expect(await getTask(task.id)).toBeNull()
    expect(await deleteTask(task.id)).toBe(false)
  })

  it('deletes subtasks along with their parent', async () => {
    const parent = await createTask({ title: 'Project' })
    const child = await createTask({ title: 'Step one', parentTaskId: parent.id })

    await deleteTask(parent.id)

    expect(await getTask(child.id)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/repositories/tasks.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/repositories/tasks.js"`.

- [ ] **Step 3: Define the shared task schemas and types**

`backend/src/schemas/task.ts` — the single definition of the wire contract, reused by Task 5's routes:

```ts
import { Type, type Static } from '@sinclair/typebox'

export const TaskStatusSchema = Type.Union([Type.Literal('open'), Type.Literal('done')])
export const TaskPrioritySchema = Type.Union([
  Type.Literal('low'),
  Type.Literal('medium'),
  Type.Literal('high'),
])
export const TaskSourceSchema = Type.Union([
  Type.Literal('manual'),
  Type.Literal('ai_parsed'),
  Type.Literal('ai_breakdown'),
])

export type TaskStatusValue = Static<typeof TaskStatusSchema>
export type TaskPriorityValue = Static<typeof TaskPrioritySchema>
export type TaskSourceValue = Static<typeof TaskSourceSchema>

const Nullable = <T extends ReturnType<typeof Type.String>>(schema: T) =>
  Type.Union([schema, Type.Null()])

const UuidSchema = Type.String({ format: 'uuid' })
const DateTimeSchema = Type.String({ format: 'date-time' })

/** The task as it appears in every API response. */
export const TaskSchema = Type.Object({
  id: UuidSchema,
  title: Type.String(),
  notes: Nullable(Type.String()),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  dueAt: Nullable(DateTimeSchema),
  estimatedMinutes: Type.Union([Type.Integer(), Type.Null()]),
  parentTaskId: Nullable(UuidSchema),
  captureBatchId: Nullable(UuidSchema),
  source: TaskSourceSchema,
  alertedAt: Nullable(DateTimeSchema),
  createdAt: DateTimeSchema,
  completedAt: Nullable(DateTimeSchema),
})

export const CreateTaskSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 500 }),
    notes: Type.Optional(Nullable(Type.String({ maxLength: 10_000 }))),
    priority: Type.Optional(TaskPrioritySchema),
    dueAt: Type.Optional(Nullable(DateTimeSchema)),
    estimatedMinutes: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
    parentTaskId: Type.Optional(Nullable(UuidSchema)),
    captureBatchId: Type.Optional(Nullable(UuidSchema)),
    source: Type.Optional(TaskSourceSchema),
  },
  { additionalProperties: false },
)

export const UpdateTaskSchema = Type.Object(
  {
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    notes: Type.Optional(Nullable(Type.String({ maxLength: 10_000 }))),
    status: Type.Optional(TaskStatusSchema),
    priority: Type.Optional(TaskPrioritySchema),
    dueAt: Type.Optional(Nullable(DateTimeSchema)),
    estimatedMinutes: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
    parentTaskId: Type.Optional(Nullable(UuidSchema)),
  },
  { additionalProperties: false, minProperties: 1 },
)

export const ListTasksQuerySchema = Type.Object(
  {
    status: Type.Optional(TaskStatusSchema),
    parentTaskId: Type.Optional(Type.Union([UuidSchema, Type.Literal('none')])),
    captureBatchId: Type.Optional(UuidSchema),
    maxEstimatedMinutes: Type.Optional(Type.Integer({ minimum: 1 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  },
  { additionalProperties: false },
)

export const TaskIdParamsSchema = Type.Object({ id: UuidSchema })
export const ErrorSchema = Type.Object({ error: Type.String() })
```

- [ ] **Step 4: Implement the repository**

`backend/src/repositories/tasks.ts`:

```ts
import { pool } from '../db/pool.js'
import type { TaskPriorityValue, TaskSourceValue, TaskStatusValue } from '../schemas/task.js'

export interface Task {
  id: string
  title: string
  notes: string | null
  status: TaskStatusValue
  priority: TaskPriorityValue
  dueAt: Date | null
  estimatedMinutes: number | null
  parentTaskId: string | null
  captureBatchId: string | null
  source: TaskSourceValue
  alertedAt: Date | null
  createdAt: Date
  completedAt: Date | null
}

interface TaskRow {
  id: string
  title: string
  notes: string | null
  status: TaskStatusValue
  priority: TaskPriorityValue
  due_at: Date | null
  estimated_minutes: number | null
  parent_task_id: string | null
  capture_batch_id: string | null
  source: TaskSourceValue
  alerted_at: Date | null
  created_at: Date
  completed_at: Date | null
}

const COLUMNS = `
  id, title, notes, status, priority, due_at, estimated_minutes,
  parent_task_id, capture_batch_id, source, alerted_at, created_at, completed_at
`

function mapRow(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    status: row.status,
    priority: row.priority,
    dueAt: row.due_at,
    estimatedMinutes: row.estimated_minutes,
    parentTaskId: row.parent_task_id,
    captureBatchId: row.capture_batch_id,
    source: row.source,
    alertedAt: row.alerted_at,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }
}

export interface CreateTaskInput {
  title: string
  notes?: string | null
  priority?: TaskPriorityValue
  dueAt?: Date | string | null
  estimatedMinutes?: number | null
  parentTaskId?: string | null
  captureBatchId?: string | null
  source?: TaskSourceValue
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const { rows } = await pool.query<TaskRow>(
    `INSERT INTO tasks
       (title, notes, priority, due_at, estimated_minutes,
        parent_task_id, capture_batch_id, source)
     VALUES
       ($1, $2, COALESCE($3::task_priority, 'medium'), $4, $5,
        $6, $7, COALESCE($8::task_source, 'manual'))
     RETURNING ${COLUMNS}`,
    [
      input.title,
      input.notes ?? null,
      input.priority ?? null,
      input.dueAt ?? null,
      input.estimatedMinutes ?? null,
      input.parentTaskId ?? null,
      input.captureBatchId ?? null,
      input.source ?? null,
    ],
  )
  return mapRow(rows[0]!)
}

/**
 * Creates several tasks in one transaction — used by the AI parsing flow, where
 * a batch of parsed tasks should land all-or-nothing.
 */
export async function createTasks(inputs: CreateTaskInput[]): Promise<Task[]> {
  if (inputs.length === 0) return []

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const created: Task[] = []
    for (const input of inputs) {
      const { rows } = await client.query<TaskRow>(
        `INSERT INTO tasks
           (title, notes, priority, due_at, estimated_minutes,
            parent_task_id, capture_batch_id, source)
         VALUES
           ($1, $2, COALESCE($3::task_priority, 'medium'), $4, $5,
            $6, $7, COALESCE($8::task_source, 'manual'))
         RETURNING ${COLUMNS}`,
        [
          input.title,
          input.notes ?? null,
          input.priority ?? null,
          input.dueAt ?? null,
          input.estimatedMinutes ?? null,
          input.parentTaskId ?? null,
          input.captureBatchId ?? null,
          input.source ?? null,
        ],
      )
      created.push(mapRow(rows[0]!))
    }
    await client.query('COMMIT')
    return created
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export interface ListTasksFilter {
  status?: TaskStatusValue
  /** `null` means top-level tasks only; a uuid means children of that task. */
  parentTaskId?: string | null
  captureBatchId?: string
  /** Only tasks with an estimate at or under this many minutes. */
  maxEstimatedMinutes?: number
  limit?: number
}

export async function listTasks(filter: ListTasksFilter = {}): Promise<Task[]> {
  const conditions: string[] = []
  const values: unknown[] = []

  if (filter.status !== undefined) {
    values.push(filter.status)
    conditions.push(`status = $${values.length}::task_status`)
  }
  if ('parentTaskId' in filter) {
    if (filter.parentTaskId === null) {
      conditions.push('parent_task_id IS NULL')
    } else if (filter.parentTaskId !== undefined) {
      values.push(filter.parentTaskId)
      conditions.push(`parent_task_id = $${values.length}`)
    }
  }
  if (filter.captureBatchId !== undefined) {
    values.push(filter.captureBatchId)
    conditions.push(`capture_batch_id = $${values.length}`)
  }
  if (filter.maxEstimatedMinutes !== undefined) {
    values.push(filter.maxEstimatedMinutes)
    conditions.push(`estimated_minutes IS NOT NULL AND estimated_minutes <= $${values.length}`)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  let limitClause = ''
  if (filter.limit !== undefined) {
    values.push(filter.limit)
    limitClause = `LIMIT $${values.length}`
  }

  // priority is an enum declared low < medium < high, so DESC puts high first.
  const { rows } = await pool.query<TaskRow>(
    `SELECT ${COLUMNS} FROM tasks
     ${where}
     ORDER BY priority DESC, due_at ASC NULLS LAST, created_at ASC
     ${limitClause}`,
    values,
  )
  return rows.map(mapRow)
}

export async function getTask(id: string): Promise<Task | null> {
  const { rows } = await pool.query<TaskRow>(`SELECT ${COLUMNS} FROM tasks WHERE id = $1`, [id])
  return rows[0] ? mapRow(rows[0]) : null
}

export interface UpdateTaskInput {
  title?: string
  notes?: string | null
  status?: TaskStatusValue
  priority?: TaskPriorityValue
  dueAt?: Date | string | null
  estimatedMinutes?: number | null
  parentTaskId?: string | null
  alertedAt?: Date | null
}

const UPDATABLE_COLUMNS: Record<keyof UpdateTaskInput, string> = {
  title: 'title',
  notes: 'notes',
  status: 'status',
  priority: 'priority',
  dueAt: 'due_at',
  estimatedMinutes: 'estimated_minutes',
  parentTaskId: 'parent_task_id',
  alertedAt: 'alerted_at',
}

export async function updateTask(id: string, patch: UpdateTaskInput): Promise<Task | null> {
  const assignments: string[] = []
  const values: unknown[] = []

  for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
    if (!(key in patch)) continue
    values.push(patch[key as keyof UpdateTaskInput] ?? null)
    assignments.push(`${column} = $${values.length}`)
  }

  // completed_at is derived from status, never set directly by a client.
  // COALESCE keeps the original completion time if a done task is patched again.
  if (patch.status !== undefined) {
    assignments.push(
      patch.status === 'done' ? 'completed_at = COALESCE(completed_at, now())' : 'completed_at = NULL',
    )
  }

  if (assignments.length === 0) return getTask(id)

  values.push(id)
  const { rows } = await pool.query<TaskRow>(
    `UPDATE tasks SET ${assignments.join(', ')}
     WHERE id = $${values.length}
     RETURNING ${COLUMNS}`,
    values,
  )
  return rows[0] ? mapRow(rows[0]) : null
}

export async function deleteTask(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM tasks WHERE id = $1', [id])
  return (result.rowCount ?? 0) > 0
}
```

Note on the enum casts: `$3::task_priority` is needed because `pg` sends parameters as untyped text and Postgres cannot infer an enum type inside `COALESCE`.

- [ ] **Step 5: Run the repository test to verify it passes**

Run: `cd backend && npx vitest run tests/repositories/tasks.test.ts`
Expected: PASS — 16 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/src/schemas backend/src/repositories backend/tests/repositories
git commit -m "feat(backend): add tasks repository with priority ordering and completion tracking"
```

---

## Task 5: Tasks CRUD Routes

The HTTP surface for tasks: validation, status codes, and serialization. Deliverable: a fully exercisable `/tasks` API behind the auth token.

**Files:**
- Create: `backend/src/routes/tasks.ts`
- Modify: `backend/src/app.ts` (register the routes)
- Test: `backend/tests/routes/tasks.test.ts`

**Interfaces:**
- Consumes: repository functions and schemas (Task 4), `app.requireAuth` (Task 3), `buildTestApp` / `authHeaders` (Task 3).
- Produces the HTTP contract every frontend call depends on:
  - `POST /tasks` → 201 `Task`
  - `GET /tasks?status=&parentTaskId=&captureBatchId=&maxEstimatedMinutes=&limit=` → 200 `{ tasks: Task[] }`
  - `GET /tasks/:id` → 200 `Task` | 404
  - `PATCH /tasks/:id` → 200 `Task` | 404
  - `DELETE /tasks/:id` → 204 | 404
  - All return 401 without a valid bearer token; invalid bodies return 400.

- [ ] **Step 1: Write the failing routes test**

`backend/tests/routes/tasks.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { closePool } from '../../src/db/pool.js'
import { truncateAll } from '../helpers/db.js'
import { authHeaders, buildTestApp } from '../helpers/app.js'

describe('/tasks routes', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildTestApp()
    await app.ready()
  })

  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await app.close()
    await closePool()
  })

  async function createTaskViaApi(payload: Record<string, unknown>) {
    const response = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: authHeaders(),
      payload,
    })
    expect(response.statusCode).toBe(201)
    return response.json()
  }

  it('requires auth on every task route', async () => {
    for (const [method, url] of [
      ['POST', '/tasks'],
      ['GET', '/tasks'],
      ['GET', '/tasks/00000000-0000-0000-0000-000000000000'],
      ['PATCH', '/tasks/00000000-0000-0000-0000-000000000000'],
      ['DELETE', '/tasks/00000000-0000-0000-0000-000000000000'],
    ] as const) {
      const response = await app.inject({ method, url, payload: { title: 'x' } })
      expect(response.statusCode, `${method} ${url}`).toBe(401)
    }
  })

  it('creates a task and returns 201 with ISO timestamps', async () => {
    const body = await createTaskViaApi({
      title: 'Call the dentist',
      priority: 'high',
      dueAt: '2026-09-01T10:00:00.000Z',
      estimatedMinutes: 15,
    })

    expect(body).toMatchObject({
      title: 'Call the dentist',
      status: 'open',
      priority: 'high',
      estimatedMinutes: 15,
      source: 'manual',
      completedAt: null,
    })
    expect(body.dueAt).toBe('2026-09-01T10:00:00.000Z')
    expect(typeof body.createdAt).toBe('string')
    expect(new Date(body.createdAt).toString()).not.toBe('Invalid Date')
  })

  it('rejects an empty title with 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: authHeaders(),
      payload: { title: '' },
    })
    expect(response.statusCode).toBe(400)
  })

  it('rejects unknown body properties with 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: authHeaders(),
      payload: { title: 'Fine', completedAt: '2026-01-01T00:00:00.000Z' },
    })
    expect(response.statusCode).toBe(400)
  })

  it('rejects a malformed uuid path param with 400', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/tasks/not-a-uuid',
      headers: authHeaders(),
    })
    expect(response.statusCode).toBe(400)
  })

  it('rejects an invalid priority with 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: authHeaders(),
      payload: { title: 'Fine', priority: 'urgent' },
    })
    expect(response.statusCode).toBe(400)
  })

  it('lists tasks in priority order', async () => {
    await createTaskViaApi({ title: 'low one', priority: 'low' })
    await createTaskViaApi({ title: 'high one', priority: 'high' })

    const response = await app.inject({ method: 'GET', url: '/tasks', headers: authHeaders() })

    expect(response.statusCode).toBe(200)
    expect(response.json().tasks.map((task: { title: string }) => task.title)).toEqual([
      'high one',
      'low one',
    ])
  })

  it('filters the list by status and by maxEstimatedMinutes', async () => {
    const quick = await createTaskViaApi({ title: 'quick', estimatedMinutes: 10 })
    await createTaskViaApi({ title: 'slow', estimatedMinutes: 120 })

    const byMinutes = await app.inject({
      method: 'GET',
      url: '/tasks?maxEstimatedMinutes=20',
      headers: authHeaders(),
    })
    expect(byMinutes.json().tasks.map((task: { id: string }) => task.id)).toEqual([quick.id])

    const byStatus = await app.inject({
      method: 'GET',
      url: '/tasks?status=done',
      headers: authHeaders(),
    })
    expect(byStatus.json().tasks).toEqual([])
  })

  it('returns only top-level tasks for parentTaskId=none', async () => {
    const parent = await createTaskViaApi({ title: 'Project' })
    await createTaskViaApi({ title: 'Subtask', parentTaskId: parent.id })

    const response = await app.inject({
      method: 'GET',
      url: '/tasks?parentTaskId=none',
      headers: authHeaders(),
    })

    expect(response.json().tasks.map((task: { id: string }) => task.id)).toEqual([parent.id])
  })

  it('gets a single task, and 404s for an unknown id', async () => {
    const task = await createTaskViaApi({ title: 'Find me' })

    const found = await app.inject({
      method: 'GET',
      url: `/tasks/${task.id}`,
      headers: authHeaders(),
    })
    expect(found.statusCode).toBe(200)
    expect(found.json().title).toBe('Find me')

    const missing = await app.inject({
      method: 'GET',
      url: '/tasks/00000000-0000-0000-0000-000000000000',
      headers: authHeaders(),
    })
    expect(missing.statusCode).toBe(404)
    expect(missing.json()).toMatchObject({ error: 'Task not found' })
  })

  it('patches a task and stamps completedAt when marked done', async () => {
    const task = await createTaskViaApi({ title: 'Do the thing' })

    const response = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      headers: authHeaders(),
      payload: { status: 'done' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().status).toBe('done')
    expect(response.json().completedAt).not.toBeNull()
  })

  it('rejects an empty patch body with 400', async () => {
    const task = await createTaskViaApi({ title: 'Do the thing' })

    const response = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      headers: authHeaders(),
      payload: {},
    })

    expect(response.statusCode).toBe(400)
  })

  it('returns 404 when patching a task that does not exist', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/tasks/00000000-0000-0000-0000-000000000000',
      headers: authHeaders(),
      payload: { title: 'ghost' },
    })
    expect(response.statusCode).toBe(404)
  })

  it('deletes a task with 204, then 404s on a second delete', async () => {
    const task = await createTaskViaApi({ title: 'Delete me' })

    const first = await app.inject({
      method: 'DELETE',
      url: `/tasks/${task.id}`,
      headers: authHeaders(),
    })
    expect(first.statusCode).toBe(204)

    const second = await app.inject({
      method: 'DELETE',
      url: `/tasks/${task.id}`,
      headers: authHeaders(),
    })
    expect(second.statusCode).toBe(404)
  })

  it('returns 400 when parentTaskId points at a task that does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: authHeaders(),
      payload: { title: 'Orphan', parentTaskId: '00000000-0000-0000-0000-000000000000' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'parentTaskId does not exist' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/routes/tasks.test.ts`
Expected: FAIL — every request returns 404 because `/tasks` is not registered.

- [ ] **Step 3: Implement the routes**

`backend/src/routes/tasks.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type, type Static } from '@sinclair/typebox'
import {
  CreateTaskSchema,
  ErrorSchema,
  ListTasksQuerySchema,
  TaskIdParamsSchema,
  TaskSchema,
  UpdateTaskSchema,
} from '../schemas/task.js'
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  updateTask,
  type ListTasksFilter,
  type Task,
} from '../repositories/tasks.js'

type TaskResponse = Static<typeof TaskSchema>

/** Postgres foreign-key violation — raised when parentTaskId points nowhere. */
const FOREIGN_KEY_VIOLATION = '23503'

function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: string }).code === FOREIGN_KEY_VIOLATION
}

/**
 * The repository returns Date objects; TaskSchema declares ISO strings. Convert
 * explicitly rather than casting — fast-json-stringify would serialize the Dates
 * for us, but a cast would switch off type checking at exactly the boundary that
 * catches field-shape drift, and would break the moment this is called outside
 * the response pipeline. createdAt is non-nullable: no `?.` here, so a null
 * surfaces as a bug instead of being quietly tolerated.
 */
function toResponse(task: Task): TaskResponse {
  return {
    ...task,
    dueAt: task.dueAt?.toISOString() ?? null,
    alertedAt: task.alertedAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
  }
}

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  const typedApp = app.withTypeProvider<TypeBoxTypeProvider>()

  typedApp.post(
    '/tasks',
    {
      preHandler: app.requireAuth,
      schema: {
        body: CreateTaskSchema,
        response: { 201: TaskSchema, 400: ErrorSchema, 401: ErrorSchema },
      },
    },
    async (request, reply) => {
      try {
        const task = await createTask(request.body)
        return reply.code(201).send(toResponse(task))
      } catch (error) {
        if (isForeignKeyViolation(error)) {
          return reply.code(400).send({ error: 'parentTaskId does not exist' })
        }
        throw error
      }
    },
  )

  typedApp.get(
    '/tasks',
    {
      preHandler: app.requireAuth,
      schema: {
        querystring: ListTasksQuerySchema,
        response: {
          200: Type.Object({ tasks: Type.Array(TaskSchema) }),
          401: ErrorSchema,
        },
      },
    },
    async (request) => {
      const query = request.query
      const filter: ListTasksFilter = {}

      if (query.status !== undefined) filter.status = query.status
      // 'none' is the querystring spelling of "top-level only" — a bare
      // parentTaskId= would be indistinguishable from an omitted filter.
      if (query.parentTaskId !== undefined) {
        filter.parentTaskId = query.parentTaskId === 'none' ? null : query.parentTaskId
      }
      if (query.captureBatchId !== undefined) filter.captureBatchId = query.captureBatchId
      if (query.maxEstimatedMinutes !== undefined) {
        filter.maxEstimatedMinutes = query.maxEstimatedMinutes
      }
      if (query.limit !== undefined) filter.limit = query.limit

      return { tasks: (await listTasks(filter)).map(toResponse) }
    },
  )

  typedApp.get(
    '/tasks/:id',
    {
      preHandler: app.requireAuth,
      schema: {
        params: TaskIdParamsSchema,
        response: { 200: TaskSchema, 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const task = await getTask(request.params.id)
      if (task === null) return reply.code(404).send({ error: 'Task not found' })
      return toResponse(task)
    },
  )

  typedApp.patch(
    '/tasks/:id',
    {
      preHandler: app.requireAuth,
      schema: {
        params: TaskIdParamsSchema,
        body: UpdateTaskSchema,
        response: { 200: TaskSchema, 400: ErrorSchema, 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      try {
        const task = await updateTask(request.params.id, request.body)
        if (task === null) return reply.code(404).send({ error: 'Task not found' })
        return toResponse(task)
      } catch (error) {
        if (isForeignKeyViolation(error)) {
          return reply.code(400).send({ error: 'parentTaskId does not exist' })
        }
        throw error
      }
    },
  )

  typedApp.delete(
    '/tasks/:id',
    {
      preHandler: app.requireAuth,
      schema: {
        params: TaskIdParamsSchema,
        response: { 204: Type.Null(), 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const deleted = await deleteTask(request.params.id)
      if (!deleted) return reply.code(404).send({ error: 'Task not found' })
      return reply.code(204).send()
    },
  )
}
```

- [ ] **Step 4: Register the routes and run the test**

In `backend/src/app.ts`, add the import and register after `healthRoutes`:

```ts
import { taskRoutes } from './routes/tasks.js'
```

```ts
  await app.register(taskRoutes)
```

Run: `cd backend && npx vitest run tests/routes/tasks.test.ts`
Expected: PASS — 15 tests. This run also confirms the two format behaviours from Global Constraints: the malformed-uuid test proves `format: 'uuid'` validation is active, and the `dueAt`/`createdAt` assertions prove `Date` values serialize to ISO strings.

- [ ] **Step 5: Commit**

```bash
git add backend/src backend/tests
git commit -m "feat(backend): add authenticated CRUD routes for tasks"
```

---

## Task 6: Capture Batches

Stores the raw freeform dump before any parsing happens, so input is never lost even when the AI step later fails. Deliverable: batches can be created and read back with their linked tasks.

**Files:**
- Create: `backend/src/schemas/captureBatch.ts`
- Create: `backend/src/repositories/captureBatches.ts`
- Create: `backend/src/routes/captureBatches.ts`
- Modify: `backend/src/app.ts` (register the routes)
- Modify: `backend/README.md` (create it — API reference for the next plans)
- Test: `backend/tests/routes/captureBatches.test.ts`

**Interfaces:**
- Consumes: `pool` (Task 2), `app.requireAuth` (Task 3), `listTasks` and `TaskSchema` (Tasks 4–5).
- Produces — the AI Capture & Breakdown plan builds directly on these:
  - `interface CaptureBatch { id: string; rawText: string; createdAt: Date }`
  - `createCaptureBatch(rawText: string): Promise<CaptureBatch>`
  - `getCaptureBatch(id: string): Promise<CaptureBatch | null>`
  - `POST /capture-batches` body `{ rawText: string }` → 201 `CaptureBatch`
  - `GET /capture-batches/:id` → 200 `CaptureBatch & { tasks: Task[] }` | 404

- [ ] **Step 1: Write the failing capture batches test**

`backend/tests/routes/captureBatches.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { closePool } from '../../src/db/pool.js'
import { truncateAll } from '../helpers/db.js'
import { authHeaders, buildTestApp } from '../helpers/app.js'
import { createTask } from '../../src/repositories/tasks.js'

describe('/capture-batches routes', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildTestApp()
    await app.ready()
  })

  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await app.close()
    await closePool()
  })

  it('requires auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/capture-batches',
      payload: { rawText: 'buy milk' },
    })
    expect(response.statusCode).toBe(401)
  })

  it('stores the raw dump verbatim, including newlines', async () => {
    const rawText = 'buy milk\ncall dentist ASAP\nplan the trip'

    const response = await app.inject({
      method: 'POST',
      url: '/capture-batches',
      headers: authHeaders(),
      payload: { rawText },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().rawText).toBe(rawText)
    expect(response.json().id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('rejects an empty or whitespace-only dump with 400', async () => {
    for (const rawText of ['', '   \n  ']) {
      const response = await app.inject({
        method: 'POST',
        url: '/capture-batches',
        headers: authHeaders(),
        payload: { rawText },
      })
      expect(response.statusCode, JSON.stringify(rawText)).toBe(400)
    }
  })

  it('returns a batch with the tasks linked to it, in priority order', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/capture-batches',
      headers: authHeaders(),
      payload: { rawText: 'two things' },
    })
    const batchId = created.json().id

    await createTask({ title: 'later', priority: 'low', captureBatchId: batchId })
    await createTask({ title: 'first', priority: 'high', captureBatchId: batchId })
    await createTask({ title: 'unrelated', priority: 'high' })

    const response = await app.inject({
      method: 'GET',
      url: `/capture-batches/${batchId}`,
      headers: authHeaders(),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().rawText).toBe('two things')
    expect(response.json().tasks.map((task: { title: string }) => task.title)).toEqual([
      'first',
      'later',
    ])
  })

  it('404s for a batch that does not exist', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/capture-batches/00000000-0000-0000-0000-000000000000',
      headers: authHeaders(),
    })
    expect(response.statusCode).toBe(404)
  })

  it('keeps the batch when a linked task is deleted', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/capture-batches',
      headers: authHeaders(),
      payload: { rawText: 'keep me' },
    })
    const batchId = created.json().id
    const task = await createTask({ title: 'temporary', captureBatchId: batchId })

    await app.inject({ method: 'DELETE', url: `/tasks/${task.id}`, headers: authHeaders() })

    const response = await app.inject({
      method: 'GET',
      url: `/capture-batches/${batchId}`,
      headers: authHeaders(),
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().tasks).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/routes/captureBatches.test.ts`
Expected: FAIL — requests return 404; `/capture-batches` is not registered.

- [ ] **Step 3: Write the schema and repository**

`backend/src/schemas/captureBatch.ts`:

```ts
import { Type } from '@sinclair/typebox'
import { TaskSchema } from './task.js'

export const CaptureBatchSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  rawText: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
})

export const CaptureBatchWithTasksSchema = Type.Intersect([
  CaptureBatchSchema,
  Type.Object({ tasks: Type.Array(TaskSchema) }),
])

export const CreateCaptureBatchSchema = Type.Object(
  {
    // minLength alone would let "   " through; the route trims before storing.
    rawText: Type.String({ minLength: 1, maxLength: 20_000 }),
  },
  { additionalProperties: false },
)

export const CaptureBatchIdParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
})
```

`backend/src/repositories/captureBatches.ts`:

```ts
import { pool } from '../db/pool.js'

export interface CaptureBatch {
  id: string
  rawText: string
  createdAt: Date
}

interface CaptureBatchRow {
  id: string
  raw_text: string
  created_at: Date
}

function mapRow(row: CaptureBatchRow): CaptureBatch {
  return { id: row.id, rawText: row.raw_text, createdAt: row.created_at }
}

export async function createCaptureBatch(rawText: string): Promise<CaptureBatch> {
  const { rows } = await pool.query<CaptureBatchRow>(
    `INSERT INTO capture_batches (raw_text)
     VALUES ($1)
     RETURNING id, raw_text, created_at`,
    [rawText],
  )
  return mapRow(rows[0]!)
}

export async function getCaptureBatch(id: string): Promise<CaptureBatch | null> {
  const { rows } = await pool.query<CaptureBatchRow>(
    `SELECT id, raw_text, created_at FROM capture_batches WHERE id = $1`,
    [id],
  )
  return rows[0] ? mapRow(rows[0]) : null
}
```

- [ ] **Step 4: Write the routes and register them**

`backend/src/routes/captureBatches.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  CaptureBatchIdParamsSchema,
  CaptureBatchSchema,
  CaptureBatchWithTasksSchema,
  CreateCaptureBatchSchema,
} from '../schemas/captureBatch.js'
import { ErrorSchema } from '../schemas/task.js'
import { createCaptureBatch, getCaptureBatch } from '../repositories/captureBatches.js'
import { listTasks } from '../repositories/tasks.js'

export async function captureBatchRoutes(app: FastifyInstance): Promise<void> {
  const typedApp = app.withTypeProvider<TypeBoxTypeProvider>()

  typedApp.post(
    '/capture-batches',
    {
      preHandler: app.requireAuth,
      schema: {
        body: CreateCaptureBatchSchema,
        response: { 201: CaptureBatchSchema, 400: ErrorSchema, 401: ErrorSchema },
      },
    },
    async (request, reply) => {
      const rawText = request.body.rawText.trim()
      if (rawText === '') {
        return reply.code(400).send({ error: 'rawText must not be blank' })
      }
      const batch = await createCaptureBatch(rawText)
      return reply.code(201).send(batch)
    },
  )

  typedApp.get(
    '/capture-batches/:id',
    {
      preHandler: app.requireAuth,
      schema: {
        params: CaptureBatchIdParamsSchema,
        response: { 200: CaptureBatchWithTasksSchema, 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const batch = await getCaptureBatch(request.params.id)
      if (batch === null) return reply.code(404).send({ error: 'Capture batch not found' })

      const tasks = await listTasks({ captureBatchId: batch.id })
      return { ...batch, tasks }
    },
  )
}
```

In `backend/src/app.ts`, add the import and register it:

```ts
import { captureBatchRoutes } from './routes/captureBatches.js'
```

```ts
  await app.register(captureBatchRoutes)
```

- [ ] **Step 5: Run the capture batches test to verify it passes**

Run: `cd backend && npx vitest run tests/routes/captureBatches.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 6: Write the backend README**

`backend/README.md` — the API reference the frontend and later plans read:

````markdown
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

## Tests

`npm test` — runs against the `todo_test` database, single-threaded, truncating
between tests. Requires the Docker Postgres above to be running.

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

## Migrations

Add a numbered file to `src/db/migrations/` (e.g. `002_push.sql`) and run
`npm run migrate`. Applied files are recorded in `schema_migrations` and never
re-run.
````

- [ ] **Step 7: Run the full suite and type check**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: no type errors; PASS — all 6 test files, 56 tests.

- [ ] **Step 8: Commit**

```bash
git add backend
git commit -m "feat(backend): add capture batches storage and document the API"
```

---

## Definition of Done

- [ ] `cd backend && npm test` passes with every test file green.
- [ ] `cd backend && npx tsc --noEmit` reports no errors.
- [ ] `npm run migrate` builds the schema from an empty database and is a no-op on re-run.
- [ ] `curl -H "Authorization: Bearer $API_TOKEN" localhost:3000/tasks` returns `{"tasks":[]}` against a running `npm run dev`.
- [ ] The same request without the header returns 401.
- [ ] `backend/README.md` documents every endpoint the next plans will call.

## What This Plan Deliberately Leaves Out

Each belongs to a later plan in the series:

- **AI Capture & Breakdown** — Haiku parsing of `rawText` into tasks, the big/vague project flag, Sonnet subtask generation, and the "I have N minutes" query endpoint. This plan provides `createTasks()`, `source`, `captureBatchId`, and `maxEstimatedMinutes` filtering as the foundation those need.
- **Scheduler & Push Notifications** — `node-cron`, the `push_subscriptions` and `check_in_settings` tables (migration `002`), VAPID keys, deadline sweeps using `alerted_at` and the `tasks_open_due_at_idx` index.
- **Frontend PWA** — React + Vite client, plus the CORS configuration it will require.
- **Deployment** — production Dockerfile, `docker-compose.yml`, Caddy reverse proxy, VPS deploy steps.
