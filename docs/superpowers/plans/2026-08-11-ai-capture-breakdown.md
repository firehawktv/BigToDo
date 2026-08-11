# AI Capture & Breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a freeform text dump into structured, prioritized tasks using Claude — parsing with Haiku, optional project breakdown with Sonnet — and answer "I have N minutes, what can I get done?" without an AI call at all.

**Architecture:** Three thin service modules under `src/ai/` own everything Claude-related: a lazily-configured SDK client, a Haiku parse call, and a Sonnet breakdown call. Both AI calls use structured outputs (`output_config.format`) with hand-written JSON Schemas, so responses arrive already shaped and are validated again server-side before touching Postgres. Routes stay thin: they call a service, map failures to graceful fallbacks, and persist through the existing repository layer. The "N minutes" query never reaches Claude — it is a conservative full-string regex plus an existing repository filter.

**Tech Stack:** Everything from the Backend Foundation plan (Node 22, TypeScript ESM, Fastify 5, TypeBox, `pg`, Vitest against real Postgres) plus `@anthropic-ai/sdk`.

## Global Constraints

- **This plan builds on `docs/superpowers/plans/2026-08-11-backend-foundation.md`.** That plan must be complete and merged. Its layering rules bind here: `repositories/` owns all SQL and is the only snake_case↔camelCase translation point; `routes/` owns HTTP concerns only; `schemas/` owns the wire contract; `routes/serialize.ts` owns repository→wire `Date`→ISO conversion.
- **Single-user only.** No accounts, no `user_id`, no per-user scoping. Auth remains one long-lived bearer token; every new route carries `preHandler: app.requireAuth`.
- **The Claude API key never reaches the client.** All Claude calls are server-side. `ANTHROPIC_API_KEY` is read only by `src/ai/config.ts`.
- **Model IDs are exactly these, and they are current — do not "correct" them to date-suffixed variants:**
  - Parsing: **`claude-haiku-4-5`**
  - Breakdown: **`claude-sonnet-5`**
  These come from the product spec, which chose the cheap model for the per-capture call and the stronger model for the opt-in call. Do not substitute a different model.
- **Node 22 LTS, ESM only** (`"type": "module"`); relative imports carry the `.js` extension.
- Enum values exactly, lowercase: status ∈ {`open`, `done`}; priority ∈ {`low`, `medium`, `high`}; source ∈ {`manual`, `ai_parsed`, `ai_breakdown`}.
- API JSON is camelCase; database columns are snake_case. Timestamps are `timestamptz` in Postgres, ISO-8601 UTC strings in JSON.
- **Tests run against real Postgres and a mocked Claude.** Never a database mock, never SQLite. Never a live Claude call in the test suite — the spec calls for mocking Claude's response shape, and a test suite that bills money or needs network is not one you can run in a loop.
- **Input is never silently lost.** If a Claude call fails for any reason, the raw capture text is already durably stored and the user gets a usable task plus a retry path.
- All work happens under `backend/`.

---

## Claude API facts this plan depends on

These are current as of writing and were checked against the API reference. They are load-bearing — several are easy to get wrong from memory.

- **Structured outputs** are set via `output_config: { format: { type: 'json_schema', schema: <JSON Schema> } }` on `client.messages.create()`. The older top-level `output_format` parameter is deprecated — do not use it.
- **Structured-output schemas support** basic types, `enum`, `const`, `anyOf`, `allOf`, `$ref`/`$def`, the listed string `format` values, and require `additionalProperties: false` on every object.
- **Structured-output schemas do NOT support** numeric constraints (`minimum`, `maximum`, `multipleOf`), string constraints (`minLength`, `maxLength`), or recursive schemas. **This is why the AI schemas in this plan are separate from `CreateTaskSchema`** — that schema carries `minLength`/`maximum` and would be rejected. Do not try to reuse it.
- Use `anyOf: [{ type: 'string' }, { type: 'null' }]` for nullable fields. A `type: ['string','null']` array is not in the supported list.
- **Haiku 4.5 supports structured outputs.** It does **not** support the `effort` parameter — passing `output_config.effort` to Haiku errors. Omit `thinking` entirely on Haiku; it then runs without thinking, which is what we want for a fast extraction call.
- **Sonnet 5 runs adaptive thinking by default** when `thinking` is omitted. It accepts the full `effort` ladder (`low`…`max`) inside `output_config`. Non-default `temperature`/`top_p`/`top_k` are **rejected with a 400** — do not set them. Assistant-turn prefills also 400 — do not use them.
- **TypeScript SDK `timeout` is in milliseconds** (Python's is seconds — do not copy a Python example's number).
- Always check `stop_reason` before reading `content`. Values that matter here: `refusal` (safety decline — content may be empty) and `max_tokens` (truncated, so the JSON will not parse).
- The response `content` is an array of blocks; the structured-output JSON arrives as the text of a `text` block. Find it by `block.type === 'text'` — do not index `content[0]` blindly.

---

## File Structure

```
backend/
  src/
    ai/
      config.ts                    — AI-only config (API key, model IDs, timeout)
      anthropic.ts                 — the SDK client singleton
      errors.ts                    — AiUnavailableError
      parseCapture.ts              — Haiku call: raw text -> parsed task drafts
      breakdown.ts                 — Sonnet call: a task -> proposed subtasks
      timeAvailable.ts             — regex query detection (no AI)
    db/migrations/
      002_ai_capture.sql           — suggest_breakdown, parse_status, parse_error
    schemas/
      captureBatch.ts              — MODIFY: parseStatus on the batch shape
      task.ts                      — MODIFY: suggestBreakdown on the task shape
      ai.ts                        — NEW: wire schemas for the AI routes
    repositories/
      tasks.ts                     — MODIFY: suggestBreakdown in row mapping + updates
      captureBatches.ts            — MODIFY: parse status transitions
    routes/
      capture.ts                   — NEW: POST /capture, POST /capture-batches/:id/parse
      breakdown.ts                 — NEW: POST /tasks/:id/breakdown, POST /tasks/:id/subtasks
      serialize.ts                 — MODIFY: carry the new fields
    app.ts                         — MODIFY: register the two new route modules
  tests/
    ai/parseCapture.test.ts        — mocked Claude responses
    ai/breakdown.test.ts           — mocked Claude responses
    ai/timeAvailable.test.ts       — pure unit, no DB, no AI
    routes/capture.test.ts         — real Postgres, mocked Claude
    routes/breakdown.test.ts       — real Postgres, mocked Claude
    helpers/mockAnthropic.ts       — shared response-shape builder
```

`src/ai/` is the only place that imports `@anthropic-ai/sdk`. Routes never construct a Claude request; services never write SQL.

---

## Task 1: Schema for AI-parsed state

Adds the three columns the AI flows need, and threads them through the repository and wire contract. Deliverable: `suggestBreakdown` round-trips on a task, `parseStatus` round-trips on a capture batch.

**Files:**
- Create: `backend/src/db/migrations/002_ai_capture.sql`
- Modify: `backend/src/repositories/tasks.ts`
- Modify: `backend/src/repositories/captureBatches.ts`
- Modify: `backend/src/schemas/task.ts`
- Modify: `backend/src/schemas/captureBatch.ts`
- Modify: `backend/src/routes/serialize.ts`
- Modify: `backend/tests/helpers/db.ts`
- Test: `backend/tests/repositories/aiFields.test.ts`

**Interfaces:**
- Consumes: everything from the Backend Foundation plan.
- Produces:
  - Column `tasks.suggest_breakdown boolean NOT NULL DEFAULT false`
  - Enum `capture_parse_status` with values `pending`, `parsed`, `failed`
  - Columns `capture_batches.parse_status` and `capture_batches.parse_error`
  - `Task.suggestBreakdown: boolean` on the repository interface and `TaskSchema`
  - `CaptureBatch.parseStatus: 'pending' | 'parsed' | 'failed'` and `CaptureBatch.parseError: string | null`
  - `createTask`/`createTasks` accept `suggestBreakdown?: boolean`
  - `updateTask` accepts `suggestBreakdown?: boolean`
  - `setCaptureBatchParseStatus(id, status, error?): Promise<CaptureBatch | null>`

- [ ] **Step 1: Write the failing test**

`backend/tests/repositories/aiFields.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closePool } from '../../src/db/pool.js'
import { setupTestDatabase, truncateAll } from '../helpers/db.js'
import { createTask, getTask, updateTask } from '../../src/repositories/tasks.js'
import {
  createCaptureBatch,
  getCaptureBatch,
  setCaptureBatchParseStatus,
} from '../../src/repositories/captureBatches.js'

describe('AI capture fields', () => {
  beforeAll(async () => {
    await setupTestDatabase()
  })

  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await closePool()
  })

  it('defaults suggestBreakdown to false', async () => {
    const task = await createTask({ title: 'Buy milk' })
    expect(task.suggestBreakdown).toBe(false)
  })

  it('round-trips suggestBreakdown on create', async () => {
    const task = await createTask({ title: 'Redesign the site', suggestBreakdown: true })
    expect(task.suggestBreakdown).toBe(true)
    expect((await getTask(task.id))?.suggestBreakdown).toBe(true)
  })

  it('clears suggestBreakdown via update', async () => {
    const task = await createTask({ title: 'Redesign the site', suggestBreakdown: true })

    const updated = await updateTask(task.id, { suggestBreakdown: false })

    expect(updated?.suggestBreakdown).toBe(false)
  })

  it('defaults a new capture batch to pending with no error', async () => {
    const batch = await createCaptureBatch('buy milk')
    expect(batch.parseStatus).toBe('pending')
    expect(batch.parseError).toBeNull()
  })

  it('marks a batch parsed and clears any previous error', async () => {
    const batch = await createCaptureBatch('buy milk')
    await setCaptureBatchParseStatus(batch.id, 'failed', 'timeout')

    const parsed = await setCaptureBatchParseStatus(batch.id, 'parsed')

    expect(parsed?.parseStatus).toBe('parsed')
    expect(parsed?.parseError).toBeNull()
  })

  it('records the error message when a batch fails to parse', async () => {
    const batch = await createCaptureBatch('buy milk')

    const failed = await setCaptureBatchParseStatus(batch.id, 'failed', 'Claude timed out')

    expect(failed?.parseStatus).toBe('failed')
    expect(failed?.parseError).toBe('Claude timed out')
  })

  it('returns null when setting status on a batch that does not exist', async () => {
    const result = await setCaptureBatchParseStatus(
      '00000000-0000-0000-0000-000000000000',
      'parsed',
    )
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/repositories/aiFields.test.ts`
Expected: FAIL — `setCaptureBatchParseStatus` is not exported.

- [ ] **Step 3: Write the migration**

`backend/src/db/migrations/002_ai_capture.sql`:

```sql
-- Haiku flags tasks that look like big/vague projects during the same parsing
-- pass, so the UI can offer a "Break this down?" affordance without a second
-- AI call. Cleared once the task actually has subtasks.
ALTER TABLE tasks
  ADD COLUMN suggest_breakdown boolean NOT NULL DEFAULT false;

CREATE TYPE capture_parse_status AS ENUM ('pending', 'parsed', 'failed');

-- A batch is stored before parsing is attempted, so the raw text survives an
-- AI failure. parse_error carries the reason so the UI can explain the retry.
ALTER TABLE capture_batches
  ADD COLUMN parse_status capture_parse_status NOT NULL DEFAULT 'pending',
  ADD COLUMN parse_error text;
```

- [ ] **Step 4: Extend the tasks repository**

In `backend/src/repositories/tasks.ts`:

Add `suggest_breakdown` to the `COLUMNS` constant (append it after `source`, before `alerted_at`):

```ts
const COLUMNS = `
  id, title, notes, status, priority, due_at, estimated_minutes,
  parent_task_id, capture_batch_id, source, suggest_breakdown, alerted_at,
  created_at, completed_at
`
```

Add the field to the `Task` interface (after `source`):

```ts
  suggestBreakdown: boolean
```

Add it to the `TaskRow` interface (after `source`):

```ts
  suggest_breakdown: boolean
```

Add it to `mapRow` (after the `source` line):

```ts
    suggestBreakdown: row.suggest_breakdown,
```

Add it to `CreateTaskInput` (after `source`):

```ts
  suggestBreakdown?: boolean
```

In `insertOne`, add the column, the placeholder, and the parameter. The INSERT becomes:

```ts
    `INSERT INTO tasks
       (title, notes, priority, due_at, estimated_minutes,
        parent_task_id, capture_batch_id, source, suggest_breakdown)
     VALUES
       ($1, $2, COALESCE($3::task_priority, 'medium'), $4, $5,
        $6, $7, COALESCE($8::task_source, 'manual'), COALESCE($9, false))
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
      input.suggestBreakdown ?? null,
    ],
```

Add to `UpdateTaskInput` (after `parentTaskId`):

```ts
  suggestBreakdown?: boolean
```

Add to `UPDATABLE_COLUMNS` (after `parentTaskId`):

```ts
  suggestBreakdown: 'suggest_breakdown',
```

- [ ] **Step 5: Extend the capture batches repository**

In `backend/src/repositories/captureBatches.ts`, replace the whole file body with:

```ts
import { pool } from '../db/pool.js'

export type CaptureParseStatus = 'pending' | 'parsed' | 'failed'

export interface CaptureBatch {
  id: string
  rawText: string
  parseStatus: CaptureParseStatus
  parseError: string | null
  createdAt: Date
}

interface CaptureBatchRow {
  id: string
  raw_text: string
  parse_status: CaptureParseStatus
  parse_error: string | null
  created_at: Date
}

const COLUMNS = 'id, raw_text, parse_status, parse_error, created_at'

function mapRow(row: CaptureBatchRow): CaptureBatch {
  return {
    id: row.id,
    rawText: row.raw_text,
    parseStatus: row.parse_status,
    parseError: row.parse_error,
    createdAt: row.created_at,
  }
}

export async function createCaptureBatch(rawText: string): Promise<CaptureBatch> {
  const { rows } = await pool.query<CaptureBatchRow>(
    `INSERT INTO capture_batches (raw_text)
     VALUES ($1)
     RETURNING ${COLUMNS}`,
    [rawText],
  )
  return mapRow(rows[0]!)
}

export async function getCaptureBatch(id: string): Promise<CaptureBatch | null> {
  const { rows } = await pool.query<CaptureBatchRow>(
    `SELECT ${COLUMNS} FROM capture_batches WHERE id = $1`,
    [id],
  )
  return rows[0] ? mapRow(rows[0]) : null
}

/**
 * Records the outcome of a parse attempt. Moving to any status other than
 * `failed` clears the stored error, so a successful retry doesn't leave a
 * stale explanation behind for the UI to show.
 */
export async function setCaptureBatchParseStatus(
  id: string,
  status: CaptureParseStatus,
  parseError?: string,
): Promise<CaptureBatch | null> {
  const { rows } = await pool.query<CaptureBatchRow>(
    `UPDATE capture_batches
     SET parse_status = $1::capture_parse_status,
         parse_error = CASE WHEN $1::capture_parse_status = 'failed' THEN $2 ELSE NULL END
     WHERE id = $3
     RETURNING ${COLUMNS}`,
    [status, parseError ?? null, id],
  )
  return rows[0] ? mapRow(rows[0]) : null
}
```

- [ ] **Step 6: Extend the wire schemas and serializer**

In `backend/src/schemas/task.ts`, add to `TaskSchema`'s properties (after `source`):

```ts
  suggestBreakdown: Type.Boolean(),
```

Add to `UpdateTaskSchema`'s properties (after `parentTaskId`):

```ts
    suggestBreakdown: Type.Optional(Type.Boolean()),
```

Do **not** add it to `CreateTaskSchema` — a client has no business asserting that a task looks like a project; only the parser sets it.

In `backend/src/schemas/captureBatch.ts`, add to `CaptureBatchSchema`'s properties:

```ts
  parseStatus: Type.Union([
    Type.Literal('pending'),
    Type.Literal('parsed'),
    Type.Literal('failed'),
  ]),
  parseError: Type.Union([Type.String(), Type.Null()]),
```

`backend/src/routes/serialize.ts` needs **no change**. Both `toTaskResponse` and `toCaptureBatchResponse` build their result with `{ ...task, <Date fields overridden> }`, so a new scalar field is carried through automatically — only `Date`-typed fields need explicit handling there, and neither of these is one. Confirm the spread is still what you find; if a later change replaced it with an explicit field list, add the new fields and say so in your report.

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd backend && npx vitest run tests/repositories/aiFields.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 8: Run the full suite and type check**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: no type errors; all previously-passing tests still green plus the 6 new ones. The Backend Foundation suite had 71 tests, so expect 77.

- [ ] **Step 9: Commit**

```bash
git add backend
git commit -m "feat(backend): add AI parse state to tasks and capture batches"
```

---

## Task 2: Claude client and AI configuration

The SDK client, its configuration, and the error type the routes branch on. Deliverable: a configured client whose construction is proven not to drag `ANTHROPIC_API_KEY` into unrelated code paths.

**Files:**
- Create: `backend/src/ai/config.ts`
- Create: `backend/src/ai/anthropic.ts`
- Create: `backend/src/ai/errors.ts`
- Modify: `backend/.env.example`
- Modify: `backend/tests/setup.ts`
- Test: `backend/tests/ai/config.test.ts`

**Interfaces:**
- Consumes: `required()` from `src/env.ts` (Backend Foundation).
- Produces:
  - `interface AiConfig { apiKey: string; parseModel: string; breakdownModel: string; requestTimeoutMs: number }`
  - `loadAiConfig(env?): AiConfig` and `aiConfig: AiConfig`
  - `anthropic: Anthropic` — the shared SDK client
  - `class AiUnavailableError extends Error` with `readonly reason: string`

- [ ] **Step 1: Install the SDK**

```bash
cd /Users/cooney/Projects/ToDoApp/backend && npm install @anthropic-ai/sdk
```

- [ ] **Step 2: Write the failing config test**

`backend/tests/ai/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { loadAiConfig } from '../../src/ai/config.js'
import { AiUnavailableError } from '../../src/ai/errors.js'

const validEnv = { ANTHROPIC_API_KEY: 'sk-ant-test-key' }

describe('loadAiConfig', () => {
  it('defaults to the models the product spec chose', () => {
    const config = loadAiConfig(validEnv)
    expect(config.parseModel).toBe('claude-haiku-4-5')
    expect(config.breakdownModel).toBe('claude-sonnet-5')
  })

  it('defaults the request timeout to 30 seconds', () => {
    expect(loadAiConfig(validEnv).requestTimeoutMs).toBe(30_000)
  })

  it('allows overriding the models and timeout', () => {
    const config = loadAiConfig({
      ...validEnv,
      PARSE_MODEL: 'claude-sonnet-5',
      BREAKDOWN_MODEL: 'claude-opus-5',
      AI_TIMEOUT_MS: '5000',
    })
    expect(config.parseModel).toBe('claude-sonnet-5')
    expect(config.breakdownModel).toBe('claude-opus-5')
    expect(config.requestTimeoutMs).toBe(5000)
  })

  it('throws when ANTHROPIC_API_KEY is missing', () => {
    expect(() => loadAiConfig({})).toThrow(/ANTHROPIC_API_KEY/)
  })

  it('rejects a non-numeric timeout', () => {
    expect(() => loadAiConfig({ ...validEnv, AI_TIMEOUT_MS: 'soon' })).toThrow(/AI_TIMEOUT_MS/)
  })

  it('rejects a zero or negative timeout', () => {
    expect(() => loadAiConfig({ ...validEnv, AI_TIMEOUT_MS: '0' })).toThrow(/AI_TIMEOUT_MS/)
  })
})

describe('AiUnavailableError', () => {
  it('carries a machine-readable reason and preserves the cause', () => {
    const cause = new Error('socket hang up')
    const error = new AiUnavailableError('parse failed', 'network', { cause })

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('AiUnavailableError')
    expect(error.reason).toBe('network')
    expect(error.cause).toBe(cause)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/ai/config.test.ts`
Expected: FAIL — cannot resolve `../../src/ai/config.js`.

- [ ] **Step 4: Implement the error type**

`backend/src/ai/errors.ts`:

```ts
/**
 * Raised when a Claude call cannot produce a usable result — network failure,
 * timeout, rate limit, refusal, truncation, or a response that doesn't match
 * the schema we asked for. Routes catch this and fall back gracefully rather
 * than 500ing, because the user's raw input is already saved by that point.
 */
export class AiUnavailableError extends Error {
  readonly reason: string

  constructor(message: string, reason: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'AiUnavailableError'
    this.reason = reason
  }
}
```

- [ ] **Step 5: Implement the config**

`backend/src/ai/config.ts`:

```ts
import { required } from '../env.js'

export interface AiConfig {
  apiKey: string
  parseModel: string
  breakdownModel: string
  requestTimeoutMs: number
}

/**
 * Model choices come from the product spec: the cheap model runs on every
 * capture, the stronger one only when the user opts into a breakdown.
 */
const DEFAULT_PARSE_MODEL = 'claude-haiku-4-5'
const DEFAULT_BREAKDOWN_MODEL = 'claude-sonnet-5'
const DEFAULT_TIMEOUT_MS = 30_000

export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const rawTimeout = env.AI_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS)
  const requestTimeoutMs = Number(rawTimeout)
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error(`AI_TIMEOUT_MS must be a positive integer, got: ${rawTimeout}`)
  }

  return {
    apiKey: required(env, 'ANTHROPIC_API_KEY'),
    parseModel: env.PARSE_MODEL ?? DEFAULT_PARSE_MODEL,
    breakdownModel: env.BREAKDOWN_MODEL ?? DEFAULT_BREAKDOWN_MODEL,
    requestTimeoutMs,
  }
}

export const aiConfig = loadAiConfig()
```

Note this file follows the same rule Task 2 of the Backend Foundation plan established: it is a **separate module** from `src/config.ts` and `src/db/config.ts`, because ES modules execute the whole module body on import. Keeping AI config here means importing the database pool never demands an Anthropic key, and running migrations never demands one either.

- [ ] **Step 6: Implement the client**

`backend/src/ai/anthropic.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk'
import { aiConfig } from './config.js'

/**
 * Shared SDK client. `timeout` is in MILLISECONDS in the TypeScript SDK
 * (the Python SDK uses seconds — don't copy a number across from a Python
 * example). maxRetries covers 429s and 5xx with the SDK's own backoff.
 */
export const anthropic = new Anthropic({
  apiKey: aiConfig.apiKey,
  timeout: aiConfig.requestTimeoutMs,
  maxRetries: 2,
})
```

- [ ] **Step 7: Add the environment variables**

Append to `backend/.env.example`:

```bash

# Claude API key — server-side only, never sent to the client.
# Get one at https://console.anthropic.com/settings/keys
ANTHROPIC_API_KEY=sk-ant-replace-me

# Model overrides (optional). Defaults are the ones the design spec chose:
# a cheap model for every capture, a stronger one for opt-in breakdowns.
# PARSE_MODEL=claude-haiku-4-5
# BREAKDOWN_MODEL=claude-sonnet-5

# Per-request timeout in milliseconds (optional, default 30000).
# AI_TIMEOUT_MS=30000
```

Add to `backend/tests/setup.ts`, alongside the existing assignments:

```ts
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-not-real'
```

The test suite never makes a real Claude call — this key exists only so module construction succeeds.

- [ ] **Step 8: Run the test and type check**

Run: `cd backend && npx vitest run tests/ai/config.test.ts && npx tsc --noEmit`
Expected: PASS — 7 tests; no type errors.

- [ ] **Step 9: Verify migrations still run without an Anthropic key**

This is the regression guard for the module-coupling problem the Backend Foundation plan hit. From the `backend` directory, with no `.env` present and `ANTHROPIC_API_KEY` unset in the shell:

Run: `DATABASE_URL=postgres://todo:todo@localhost:5433/todo npm run migrate`
Expected: applies `002_ai_capture.sql` (or reports already up to date) with **no** error about `ANTHROPIC_API_KEY`. Paste the output into your report.

- [ ] **Step 10: Commit**

```bash
git add backend
git commit -m "feat(backend): add Claude client and AI configuration"
```

---

## Task 3: Haiku capture parsing

The parse call: raw dump in, structured task drafts out, with the big/vague-project flag produced in the same pass. Deliverable: a `parseCapture()` that turns a realistic Claude response into validated drafts, and turns every failure mode into `AiUnavailableError`.

**Files:**
- Create: `backend/src/ai/parseCapture.ts`
- Create: `backend/tests/helpers/mockAnthropic.ts`
- Test: `backend/tests/ai/parseCapture.test.ts`

**Interfaces:**
- Consumes: `anthropic` (Task 2), `aiConfig` (Task 2), `AiUnavailableError` (Task 2).
- Produces:
  - `interface ParsedTaskDraft { title: string; notes: string | null; priority: 'low'|'medium'|'high'; dueAt: Date | null; estimatedMinutes: number | null; suggestBreakdown: boolean }`
  - `parseCapture(rawText: string, now?: Date): Promise<ParsedTaskDraft[]>`
  - Test helper `mockAnthropicResponse(json: unknown, overrides?): Anthropic.Message`-shaped object

- [ ] **Step 1: Write the mock helper**

`backend/tests/helpers/mockAnthropic.ts`:

```ts
/**
 * Builds a response object shaped like the Messages API returns, so tests can
 * exercise real parsing logic against a realistic payload without a network
 * call. Only the fields our code reads are populated.
 */
export function mockAnthropicResponse(
  payload: unknown,
  overrides: { stopReason?: string; blocks?: unknown[] } = {},
): Record<string, unknown> {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5',
    stop_reason: overrides.stopReason ?? 'end_turn',
    stop_details: null,
    content: overrides.blocks ?? [
      { type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) },
    ],
    usage: { input_tokens: 100, output_tokens: 50 },
  }
}
```

- [ ] **Step 2: Write the failing parse test**

`backend/tests/ai/parseCapture.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockAnthropicResponse } from '../helpers/mockAnthropic.js'

// vi.mock is hoisted above every const in the file, so the spy has to be
// created with vi.hoisted or the factory closes over a variable in its
// temporal dead zone.
const { create } = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('../../src/ai/anthropic.js', () => ({
  anthropic: { messages: { create } },
}))

const { parseCapture } = await import('../../src/ai/parseCapture.js')
const { AiUnavailableError } = await import('../../src/ai/errors.js')

describe('parseCapture', () => {
  beforeEach(() => {
    create.mockReset()
  })

  it('maps a well-formed response into task drafts', async () => {
    create.mockResolvedValue(
      mockAnthropicResponse({
        tasks: [
          {
            title: 'Call the dentist',
            notes: null,
            priority: 'high',
            dueAt: '2026-09-01T10:00:00.000Z',
            estimatedMinutes: 10,
            suggestBreakdown: false,
          },
          {
            title: 'Redesign the website',
            notes: 'from the dump',
            priority: 'medium',
            dueAt: null,
            estimatedMinutes: null,
            suggestBreakdown: true,
          },
        ],
      }),
    )

    const drafts = await parseCapture('call dentist ASAP\nredesign the website')

    expect(drafts).toHaveLength(2)
    expect(drafts[0]).toEqual({
      title: 'Call the dentist',
      notes: null,
      priority: 'high',
      dueAt: new Date('2026-09-01T10:00:00.000Z'),
      estimatedMinutes: 10,
      suggestBreakdown: false,
    })
    expect(drafts[1]?.suggestBreakdown).toBe(true)
    expect(drafts[1]?.dueAt).toBeNull()
  })

  it('sends the configured parse model and the raw text', async () => {
    create.mockResolvedValue(mockAnthropicResponse({ tasks: [] }))

    await parseCapture('buy milk')

    const request = create.mock.calls[0]![0]
    expect(request.model).toBe('claude-haiku-4-5')
    expect(JSON.stringify(request.messages)).toContain('buy milk')
  })

  it('asks for structured output and does not send unsupported parameters', async () => {
    create.mockResolvedValue(mockAnthropicResponse({ tasks: [] }))

    await parseCapture('buy milk')

    const request = create.mock.calls[0]![0]
    expect(request.output_config.format.type).toBe('json_schema')
    // Haiku 4.5 rejects `effort`, and thinking is unnecessary for extraction.
    expect(request.output_config.effort).toBeUndefined()
    expect(request.thinking).toBeUndefined()
    expect(request.temperature).toBeUndefined()
  })

  it('tells the model the current date so relative deadlines resolve', async () => {
    create.mockResolvedValue(mockAnthropicResponse({ tasks: [] }))

    await parseCapture('call mum tomorrow', new Date('2026-08-11T09:00:00.000Z'))

    expect(JSON.stringify(create.mock.calls[0]![0].messages)).toContain('2026-08-11')
  })

  it('drops a task whose title is blank rather than persisting junk', async () => {
    create.mockResolvedValue(
      mockAnthropicResponse({
        tasks: [
          { title: '   ', notes: null, priority: 'low', dueAt: null, estimatedMinutes: null, suggestBreakdown: false },
          { title: 'Real task', notes: null, priority: 'low', dueAt: null, estimatedMinutes: null, suggestBreakdown: false },
        ],
      }),
    )

    const drafts = await parseCapture('...')

    expect(drafts.map((d) => d.title)).toEqual(['Real task'])
  })

  it('trims titles and drops an unparseable due date instead of failing the batch', async () => {
    create.mockResolvedValue(
      mockAnthropicResponse({
        tasks: [
          {
            title: '  Buy milk  ',
            notes: null,
            priority: 'low',
            dueAt: 'next Tuesdayish',
            estimatedMinutes: null,
            suggestBreakdown: false,
          },
        ],
      }),
    )

    const drafts = await parseCapture('...')

    expect(drafts[0]?.title).toBe('Buy milk')
    expect(drafts[0]?.dueAt).toBeNull()
  })

  it('coerces a non-positive estimate to null', async () => {
    create.mockResolvedValue(
      mockAnthropicResponse({
        tasks: [
          { title: 'Task', notes: null, priority: 'low', dueAt: null, estimatedMinutes: 0, suggestBreakdown: false },
        ],
      }),
    )

    expect((await parseCapture('...'))[0]?.estimatedMinutes).toBeNull()
  })

  it('falls back to medium when the priority is not a known value', async () => {
    create.mockResolvedValue(
      mockAnthropicResponse({
        tasks: [
          { title: 'Task', notes: null, priority: 'urgent', dueAt: null, estimatedMinutes: null, suggestBreakdown: false },
        ],
      }),
    )

    expect((await parseCapture('...'))[0]?.priority).toBe('medium')
  })

  it('throws AiUnavailableError when the model refuses', async () => {
    create.mockResolvedValue(mockAnthropicResponse({ tasks: [] }, { stopReason: 'refusal', blocks: [] }))

    await expect(parseCapture('...')).rejects.toThrow(AiUnavailableError)
    await expect(parseCapture('...')).rejects.toMatchObject({ reason: 'refusal' })
  })

  it('throws AiUnavailableError when the response was truncated', async () => {
    create.mockResolvedValue(mockAnthropicResponse('{"tasks":[{"tit', { stopReason: 'max_tokens' }))

    await expect(parseCapture('...')).rejects.toMatchObject({ reason: 'max_tokens' })
  })

  it('throws AiUnavailableError when the response carries no text block', async () => {
    create.mockResolvedValue(mockAnthropicResponse(null, { blocks: [{ type: 'thinking', thinking: '' }] }))

    await expect(parseCapture('...')).rejects.toMatchObject({ reason: 'no_text_block' })
  })

  it('throws AiUnavailableError when the text is not valid JSON', async () => {
    create.mockResolvedValue(mockAnthropicResponse('sorry, I could not do that'))

    await expect(parseCapture('...')).rejects.toMatchObject({ reason: 'invalid_json' })
  })

  it('throws AiUnavailableError when the JSON has no tasks array', async () => {
    create.mockResolvedValue(mockAnthropicResponse({ result: 'ok' }))

    await expect(parseCapture('...')).rejects.toMatchObject({ reason: 'invalid_shape' })
  })

  it('wraps a transport failure rather than leaking the SDK error', async () => {
    create.mockRejectedValue(new Error('socket hang up'))

    await expect(parseCapture('...')).rejects.toMatchObject({ reason: 'request_failed' })
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/ai/parseCapture.test.ts`
Expected: FAIL — cannot resolve `../../src/ai/parseCapture.js`.

- [ ] **Step 4: Implement the parse service**

`backend/src/ai/parseCapture.ts`:

```ts
import { anthropic } from './anthropic.js'
import { aiConfig } from './config.js'
import { AiUnavailableError } from './errors.js'

export interface ParsedTaskDraft {
  title: string
  notes: string | null
  priority: 'low' | 'medium' | 'high'
  dueAt: Date | null
  estimatedMinutes: number | null
  suggestBreakdown: boolean
}

/**
 * Structured-output schema for the parse call.
 *
 * Deliberately NOT derived from CreateTaskSchema: structured outputs reject
 * `minLength`, `maximum`, and the other constraints that schema carries. Every
 * property is listed in `required` and made explicitly nullable instead, so the
 * model always emits a complete object and we do the range checking ourselves.
 */
const PARSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tasks'],
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'notes', 'priority', 'dueAt', 'estimatedMinutes', 'suggestBreakdown'],
        properties: {
          title: { type: 'string' },
          notes: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          priority: { type: 'string', enum: ['low', 'medium', 'high'] },
          dueAt: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          estimatedMinutes: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
          suggestBreakdown: { type: 'boolean' },
        },
      },
    },
  },
}

const SYSTEM_PROMPT = `You turn a person's freeform brain-dump into discrete, actionable tasks.

Split the input into separate tasks. One line usually means one task, but a single line can hold several, and several lines can describe one. Use judgement.

For each task:
- title: a short, clear, actionable phrase. Start with a verb where natural. Strip filler.
- notes: the original snippet if it carries detail the title loses, otherwise null.
- priority: infer from urgency language. "ASAP", "urgent", "!!", "today" mean high. A plain statement means medium. "sometime", "eventually", "someday" mean low.
- dueAt: an ISO-8601 UTC timestamp only when the text states or clearly implies a deadline. Resolve relative dates against the current date given below. Use null when no deadline is mentioned — do not invent one.
- estimatedMinutes: a realistic whole-minute estimate for one focused sitting, or null when you genuinely cannot tell.
- suggestBreakdown: true when the task is broad or vague enough that it is really a project — no single clear action, or phrasing like "redesign", "plan", "organize", "sort out", "look into". False for anything a person could sit down and just do.

Return every task you find. If the input contains no actionable task, return an empty list.`

const KNOWN_PRIORITIES = new Set(['low', 'medium', 'high'])

interface RawDraft {
  title?: unknown
  notes?: unknown
  priority?: unknown
  dueAt?: unknown
  estimatedMinutes?: unknown
  suggestBreakdown?: unknown
}

function toDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const date = new Date(value)
  // The model occasionally returns something human-readable rather than ISO.
  // A bad date is not worth failing the whole batch over — drop it and let the
  // user set one, which they can already do by editing the task.
  return Number.isNaN(date.getTime()) ? null : date
}

function toEstimate(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null
  // The tasks table stores this as a plain integer; keep it inside that range.
  return Math.min(value, 100_000)
}

function toDraft(raw: RawDraft): ParsedTaskDraft | null {
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (title === '') return null

  return {
    title,
    notes: typeof raw.notes === 'string' && raw.notes.trim() !== '' ? raw.notes : null,
    priority: KNOWN_PRIORITIES.has(raw.priority as string)
      ? (raw.priority as ParsedTaskDraft['priority'])
      : 'medium',
    dueAt: toDate(raw.dueAt),
    estimatedMinutes: toEstimate(raw.estimatedMinutes),
    suggestBreakdown: raw.suggestBreakdown === true,
  }
}

export async function parseCapture(rawText: string, now: Date = new Date()): Promise<ParsedTaskDraft[]> {
  let response: { stop_reason?: string; content?: unknown[] }

  try {
    response = (await anthropic.messages.create({
      model: aiConfig.parseModel,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: PARSE_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: `Current date and time: ${now.toISOString()}\n\nBrain-dump:\n${rawText}`,
        },
      ],
    } as never)) as never
  } catch (error) {
    throw new AiUnavailableError('Claude request failed', 'request_failed', { cause: error })
  }

  if (response.stop_reason === 'refusal') {
    throw new AiUnavailableError('Claude declined to parse this input', 'refusal')
  }
  if (response.stop_reason === 'max_tokens') {
    throw new AiUnavailableError('Claude response was truncated', 'max_tokens')
  }

  const blocks = Array.isArray(response.content) ? response.content : []
  const textBlock = blocks.find(
    (block): block is { type: 'text'; text: string } =>
      typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'text',
  )
  if (textBlock === undefined) {
    throw new AiUnavailableError('Claude response contained no text block', 'no_text_block')
  }

  let payload: unknown
  try {
    payload = JSON.parse(textBlock.text)
  } catch (error) {
    throw new AiUnavailableError('Claude response was not valid JSON', 'invalid_json', {
      cause: error,
    })
  }

  const tasks = (payload as { tasks?: unknown } | null)?.tasks
  if (!Array.isArray(tasks)) {
    throw new AiUnavailableError('Claude response had no tasks array', 'invalid_shape')
  }

  return tasks
    .map((raw) => toDraft((raw ?? {}) as RawDraft))
    .filter((draft): draft is ParsedTaskDraft => draft !== null)
}
```

A note on the `as never` casts around the SDK call: `output_config` may not be present in the installed SDK's published types yet. If `npx tsc --noEmit` passes **without** the casts, remove them — a cast that isn't needed is a cast that hides the next real type error. Report which case you found. Do not use `as any` or `@ts-expect-error` either way.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx vitest run tests/ai/parseCapture.test.ts`
Expected: PASS — 14 tests.

- [ ] **Step 6: Run the full suite and type check, then commit**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: no type errors; all green.

```bash
git add backend
git commit -m "feat(backend): parse captured text into tasks with Haiku"
```

---

## Task 4: Sonnet project breakdown

The opt-in second AI call: a flagged task in, a proposed subtask list out. Nothing is persisted here — the spec requires the user reviews and edits before saving.

**Files:**
- Create: `backend/src/ai/breakdown.ts`
- Test: `backend/tests/ai/breakdown.test.ts`

**Interfaces:**
- Consumes: `anthropic`, `aiConfig`, `AiUnavailableError` (Task 2); `Task` from `src/repositories/tasks.ts`.
- Produces:
  - `interface ProposedSubtask { title: string; estimatedMinutes: number | null }`
  - `proposeBreakdown(task: Pick<Task, 'title' | 'notes'>): Promise<ProposedSubtask[]>`

- [ ] **Step 1: Write the failing test**

`backend/tests/ai/breakdown.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockAnthropicResponse } from '../helpers/mockAnthropic.js'

// vi.mock is hoisted above every const in the file, so the spy has to be
// created with vi.hoisted or the factory closes over a variable in its
// temporal dead zone.
const { create } = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('../../src/ai/anthropic.js', () => ({
  anthropic: { messages: { create } },
}))

const { proposeBreakdown } = await import('../../src/ai/breakdown.js')
const { AiUnavailableError } = await import('../../src/ai/errors.js')

describe('proposeBreakdown', () => {
  beforeEach(() => {
    create.mockReset()
  })

  it('maps a well-formed response into proposed subtasks', async () => {
    create.mockResolvedValue(
      mockAnthropicResponse({
        subtasks: [
          { title: 'Collect design references', estimatedMinutes: 30 },
          { title: 'Sketch the new layout', estimatedMinutes: 60 },
        ],
      }),
    )

    const subtasks = await proposeBreakdown({ title: 'Redesign the website', notes: null })

    expect(subtasks).toEqual([
      { title: 'Collect design references', estimatedMinutes: 30 },
      { title: 'Sketch the new layout', estimatedMinutes: 60 },
    ])
  })

  it('sends the configured breakdown model with the task title and notes', async () => {
    create.mockResolvedValue(mockAnthropicResponse({ subtasks: [] }))

    await proposeBreakdown({ title: 'Plan the trip', notes: 'two weeks in June' })

    const request = create.mock.calls[0]![0]
    expect(request.model).toBe('claude-sonnet-5')
    const sent = JSON.stringify(request.messages)
    expect(sent).toContain('Plan the trip')
    expect(sent).toContain('two weeks in June')
  })

  it('requests structured output and never sets rejected sampling parameters', async () => {
    create.mockResolvedValue(mockAnthropicResponse({ subtasks: [] }))

    await proposeBreakdown({ title: 'Plan the trip', notes: null })

    const request = create.mock.calls[0]![0]
    expect(request.output_config.format.type).toBe('json_schema')
    // Sonnet 5 returns 400 for any of these.
    expect(request.temperature).toBeUndefined()
    expect(request.top_p).toBeUndefined()
    expect(request.top_k).toBeUndefined()
  })

  it('drops blank titles and normalizes bad estimates', async () => {
    create.mockResolvedValue(
      mockAnthropicResponse({
        subtasks: [
          { title: '  ', estimatedMinutes: 10 },
          { title: '  Book flights  ', estimatedMinutes: -5 },
        ],
      }),
    )

    const subtasks = await proposeBreakdown({ title: 'Plan the trip', notes: null })

    expect(subtasks).toEqual([{ title: 'Book flights', estimatedMinutes: null }])
  })

  it('caps an unreasonably long proposal', async () => {
    create.mockResolvedValue(
      mockAnthropicResponse({
        subtasks: Array.from({ length: 40 }, (_, index) => ({
          title: `Step ${index + 1}`,
          estimatedMinutes: 15,
        })),
      }),
    )

    const subtasks = await proposeBreakdown({ title: 'Plan the trip', notes: null })

    expect(subtasks).toHaveLength(20)
    expect(subtasks[0]?.title).toBe('Step 1')
  })

  it('throws AiUnavailableError when the model refuses', async () => {
    create.mockResolvedValue(mockAnthropicResponse(null, { stopReason: 'refusal', blocks: [] }))

    await expect(proposeBreakdown({ title: 'x', notes: null })).rejects.toThrow(AiUnavailableError)
  })

  it('throws AiUnavailableError when the JSON has no subtasks array', async () => {
    create.mockResolvedValue(mockAnthropicResponse({ steps: [] }))

    await expect(proposeBreakdown({ title: 'x', notes: null })).rejects.toMatchObject({
      reason: 'invalid_shape',
    })
  })

  it('wraps a transport failure', async () => {
    create.mockRejectedValue(new Error('ETIMEDOUT'))

    await expect(proposeBreakdown({ title: 'x', notes: null })).rejects.toMatchObject({
      reason: 'request_failed',
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/ai/breakdown.test.ts`
Expected: FAIL — cannot resolve `../../src/ai/breakdown.js`.

- [ ] **Step 3: Implement the breakdown service**

`backend/src/ai/breakdown.ts`:

```ts
import { anthropic } from './anthropic.js'
import { aiConfig } from './config.js'
import { AiUnavailableError } from './errors.js'

export interface ProposedSubtask {
  title: string
  estimatedMinutes: number | null
}

/** More than this many steps stops being a plan and starts being a wall. */
const MAX_SUBTASKS = 20

const BREAKDOWN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subtasks'],
  properties: {
    subtasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'estimatedMinutes'],
        properties: {
          title: { type: 'string' },
          estimatedMinutes: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
        },
      },
    },
  },
}

const SYSTEM_PROMPT = `You break a vague or oversized task into concrete next actions for someone who struggles to start when a task feels large.

Rules:
- Every subtask is something the person could sit down and actually do. No "think about", no "research" without a target, no "plan the plan".
- Order them the way they should be done.
- Aim for three to seven subtasks. Fewer if the task is smaller than it looked; never more than ${MAX_SUBTASKS}.
- Give each one a realistic whole-minute estimate for a single focused sitting, or null if you genuinely cannot tell.
- The first subtask should be the smallest possible way to begin — the thing that gets the person unstuck.

Return only the subtasks.`

interface RawSubtask {
  title?: unknown
  estimatedMinutes?: unknown
}

function toSubtask(raw: RawSubtask): ProposedSubtask | null {
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (title === '') return null

  const estimate = raw.estimatedMinutes
  const estimatedMinutes =
    typeof estimate === 'number' && Number.isInteger(estimate) && estimate > 0
      ? Math.min(estimate, 100_000)
      : null

  return { title, estimatedMinutes }
}

export async function proposeBreakdown(
  task: { title: string; notes: string | null },
): Promise<ProposedSubtask[]> {
  let response: { stop_reason?: string; content?: unknown[] }

  const details = task.notes === null ? task.title : `${task.title}\n\nNotes: ${task.notes}`

  try {
    response = (await anthropic.messages.create({
      model: aiConfig.breakdownModel,
      max_tokens: 16_000,
      system: SYSTEM_PROMPT,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: BREAKDOWN_SCHEMA },
      },
      messages: [{ role: 'user', content: `Break down this task:\n\n${details}` }],
    } as never)) as never
  } catch (error) {
    throw new AiUnavailableError('Claude request failed', 'request_failed', { cause: error })
  }

  if (response.stop_reason === 'refusal') {
    throw new AiUnavailableError('Claude declined to break down this task', 'refusal')
  }
  if (response.stop_reason === 'max_tokens') {
    throw new AiUnavailableError('Claude response was truncated', 'max_tokens')
  }

  const blocks = Array.isArray(response.content) ? response.content : []
  const textBlock = blocks.find(
    (block): block is { type: 'text'; text: string } =>
      typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'text',
  )
  if (textBlock === undefined) {
    throw new AiUnavailableError('Claude response contained no text block', 'no_text_block')
  }

  let payload: unknown
  try {
    payload = JSON.parse(textBlock.text)
  } catch (error) {
    throw new AiUnavailableError('Claude response was not valid JSON', 'invalid_json', {
      cause: error,
    })
  }

  const subtasks = (payload as { subtasks?: unknown } | null)?.subtasks
  if (!Array.isArray(subtasks)) {
    throw new AiUnavailableError('Claude response had no subtasks array', 'invalid_shape')
  }

  return subtasks
    .map((raw) => toSubtask((raw ?? {}) as RawSubtask))
    .filter((subtask): subtask is ProposedSubtask => subtask !== null)
    .slice(0, MAX_SUBTASKS)
}
```

The response-reading logic here is deliberately parallel to `parseCapture.ts` rather than shared. If a reviewer flags the duplication, extracting a `readStructuredJson(response, { reason })` helper into `src/ai/response.ts` is a reasonable fix — but do not do it pre-emptively in this task; the two call sites are the whole population, and the second one is what proves the shape.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run tests/ai/breakdown.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Run the full suite and type check, then commit**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: no type errors; all green.

```bash
git add backend
git commit -m "feat(backend): propose subtask breakdowns with Sonnet"
```

---

## Task 5: "I have N minutes" detection

Pure pattern matching, no AI call — the spec is explicit that this must feel instant. The hard part is **not** firing on a normal capture that happens to mention a duration.

**Files:**
- Create: `backend/src/ai/timeAvailable.ts`
- Test: `backend/tests/ai/timeAvailable.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `detectTimeAvailable(rawText: string): number | null` — returns minutes, or `null` when the input is not a time-available query.

- [ ] **Step 1: Write the failing test**

`backend/tests/ai/timeAvailable.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { detectTimeAvailable } from '../../src/ai/timeAvailable.js'

describe('detectTimeAvailable', () => {
  it.each([
    ['I have 20 minutes', 20],
    ['i have 20 minutes', 20],
    ['I have 20 minutes.', 20],
    ['I have 5 mins', 5],
    ['I have 45 min', 45],
    ['20 minutes', 20],
    ['20m', 20],
    ["I've got 15 minutes", 15],
    ['I got 15 minutes', 15],
    ['I have 2 hours', 120],
    ['1 hour', 60],
    ['90 mins free', 90],
    ['I have 30 minutes left', 30],
    ['half an hour', 30],
    ['I have half an hour', 30],
    ['I have 20 minutes, what can I do?', 20],
    ['I have 20 minutes - what can I get done?', 20],
  ])('detects %j as %i minutes', (input, expected) => {
    expect(detectTimeAvailable(input)).toBe(expected)
  })

  it.each([
    // The critical class: real captures that merely mention a duration.
    ['call the dentist in 20 minutes'],
    ['buy milk\ncall dentist ASAP'],
    ['set a 20 minute timer for the pasta'],
    ['book the 2 hour slot at the studio'],
    ['I have 20 minutes of footage to edit'],
    ['spend 30 minutes on the report'],
    // Not durations at all.
    [''],
    ['   '],
    ['what should I do?'],
    ['I have time'],
  ])('does not treat %j as a query', (input) => {
    expect(detectTimeAvailable(input)).toBeNull()
  })

  it('rejects an implausible duration rather than returning a huge shortlist', () => {
    expect(detectTimeAvailable('I have 5000 minutes')).toBeNull()
    expect(detectTimeAvailable('I have 0 minutes')).toBeNull()
  })

  it('caps at a full day', () => {
    expect(detectTimeAvailable('24 hours')).toBe(1440)
    expect(detectTimeAvailable('25 hours')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/ai/timeAvailable.test.ts`
Expected: FAIL — cannot resolve `../../src/ai/timeAvailable.js`.

- [ ] **Step 3: Implement the detector**

`backend/src/ai/timeAvailable.ts`:

```ts
/**
 * Detects "I have N minutes" style queries typed into the capture box.
 *
 * The whole input must look like the query — matching a duration ANYWHERE in
 * the text would swallow real captures like "call the dentist in 20 minutes",
 * turning a task the user meant to save into a search that saves nothing. When
 * in doubt this returns null and the text is captured as tasks, which is the
 * recoverable direction to be wrong in.
 */

/** Longer than a day is not a "what can I get done right now" question. */
const MAX_MINUTES = 1440

const LEAD_IN = String.raw`(?:i\s*(?:'ve|\s+have|\s+got|'ve\s+got|\s+have\s+got)\s+)?`
const TRAILER = String.raw`(?:\s+(?:free|left|spare|available|to\s+spare|to\s+kill))?`
const QUESTION = String.raw`(?:\s*[,\-–—]?\s*what\s+(?:can|should)\s+i\s+(?:do|get\s+done|work\s+on)\s*)?`

const NUMERIC = new RegExp(
  `^${LEAD_IN}(\\d{1,4})\\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)${TRAILER}${QUESTION}[.!?]*$`,
)

const HALF_HOUR = new RegExp(`^${LEAD_IN}half\\s+an\\s+hour${TRAILER}${QUESTION}[.!?]*$`)

export function detectTimeAvailable(rawText: string): number | null {
  const normalized = rawText.trim().toLowerCase().replace(/\s+/g, ' ')
  if (normalized === '') return null

  if (HALF_HOUR.test(normalized)) return 30

  const match = NUMERIC.exec(normalized)
  if (match === null) return null

  const amount = Number(match[1])
  const unit = match[2]!
  if (!Number.isInteger(amount) || amount <= 0) return null

  const minutes = unit.startsWith('h') ? amount * 60 : amount
  return minutes > 0 && minutes <= MAX_MINUTES ? minutes : null
}
```

Note `\s+` is collapsed to single spaces before matching, so a multi-line capture can never match — a newline becomes a space and the surrounding words break the anchored pattern. That is intentional: a multi-line dump is always a capture, never a query.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run tests/ai/timeAvailable.test.ts`
Expected: PASS — all cases.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): detect time-available queries without an AI call"
```

---

## Task 6: Routes and documentation

Wires all three flows into HTTP and updates the README. Deliverable: a complete AI capture API behind the bearer token, with the failure path proven to preserve input.

**Files:**
- Create: `backend/src/schemas/ai.ts`
- Create: `backend/src/routes/capture.ts`
- Create: `backend/src/routes/breakdown.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/README.md`
- Test: `backend/tests/routes/capture.test.ts`
- Test: `backend/tests/routes/breakdown.test.ts`

**Interfaces:**
- Consumes: `parseCapture` (Task 3), `proposeBreakdown` (Task 4), `detectTimeAvailable` (Task 5), the repositories and serializers from Task 1, `app.requireAuth`.
- Produces the HTTP contract the frontend plan is written against:
  - `POST /capture` → 200 `{ type: 'shortlist', minutes, tasks }` | 201 `{ type: 'batch', batch, tasks }`
  - `POST /capture-batches/:id/parse` → 200 `{ batch, tasks }` | 404 | 409
  - `POST /tasks/:id/breakdown` → 200 `{ subtasks }` | 404 | 503
  - `POST /tasks/:id/subtasks` → 201 `{ tasks }` | 404
  - `GET /tasks/available?minutes=N` → 200 `{ minutes, tasks }`

- [ ] **Step 1: Write the failing capture test**

`backend/tests/routes/capture.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

// vi.hoisted, because vi.mock is hoisted above every const in the file.
const { parseCapture } = vi.hoisted(() => ({ parseCapture: vi.fn() }))

vi.mock('../../src/ai/parseCapture.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/ai/parseCapture.js')>(
    '../../src/ai/parseCapture.js',
  )
  return { ...actual, parseCapture }
})

const { pool, closePool } = await import('../../src/db/pool.js')
const { truncateAll } = await import('../helpers/db.js')
const { authHeaders, buildTestApp } = await import('../helpers/app.js')
const { AiUnavailableError } = await import('../../src/ai/errors.js')
const { createTask } = await import('../../src/repositories/tasks.js')

describe('POST /capture', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildTestApp()
    await app.ready()
  })

  beforeEach(async () => {
    await truncateAll()
    parseCapture.mockReset()
  })

  afterAll(async () => {
    await app.close()
    await closePool()
  })

  function capture(rawText: string) {
    return app.inject({
      method: 'POST',
      url: '/capture',
      headers: authHeaders(),
      payload: { rawText },
    })
  }

  it('requires auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/capture',
      payload: { rawText: 'buy milk' },
    })
    expect(response.statusCode).toBe(401)
  })

  it('parses a dump into tasks linked to a saved batch', async () => {
    parseCapture.mockResolvedValue([
      {
        title: 'Call the dentist',
        notes: null,
        priority: 'high',
        dueAt: null,
        estimatedMinutes: 10,
        suggestBreakdown: false,
      },
      {
        title: 'Redesign the website',
        notes: null,
        priority: 'medium',
        dueAt: null,
        estimatedMinutes: null,
        suggestBreakdown: true,
      },
    ])

    const response = await capture('call dentist ASAP\nredesign the website')

    expect(response.statusCode).toBe(201)
    const body = response.json()
    expect(body.type).toBe('batch')
    expect(body.batch.parseStatus).toBe('parsed')
    expect(body.batch.rawText).toBe('call dentist ASAP\nredesign the website')
    expect(body.tasks).toHaveLength(2)
    expect(body.tasks.every((task: { source: string }) => task.source === 'ai_parsed')).toBe(true)
    expect(body.tasks.every((task: { captureBatchId: string }) => task.captureBatchId === body.batch.id)).toBe(true)
    const project = body.tasks.find((task: { title: string }) => task.title === 'Redesign the website')
    expect(project.suggestBreakdown).toBe(true)
  })

  it('saves the raw text and one fallback task when Claude is unavailable', async () => {
    parseCapture.mockRejectedValue(new AiUnavailableError('down', 'request_failed'))

    const response = await capture('buy milk\ncall dentist')

    expect(response.statusCode).toBe(201)
    const body = response.json()
    expect(body.batch.parseStatus).toBe('failed')
    expect(body.batch.rawText).toBe('buy milk\ncall dentist')
    expect(body.batch.parseError).toBeTruthy()
    // Input is never lost: one task carrying the dump, editable by hand.
    expect(body.tasks).toHaveLength(1)
    expect(body.tasks[0].source).toBe('manual')
    expect(body.tasks[0].notes).toBe('buy milk\ncall dentist')
  })

  it('rejects a blank dump before calling Claude', async () => {
    const response = await capture('   ')

    expect(response.statusCode).toBe(400)
    expect(parseCapture).not.toHaveBeenCalled()
  })

  it('answers a time-available query without creating a batch or calling Claude', async () => {
    await createTask({ title: 'Quick win', estimatedMinutes: 10, priority: 'high' })
    await createTask({ title: 'Long haul', estimatedMinutes: 120 })

    const response = await capture('I have 20 minutes')

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.type).toBe('shortlist')
    expect(body.minutes).toBe(20)
    expect(body.tasks.map((task: { title: string }) => task.title)).toEqual(['Quick win'])
    expect(parseCapture).not.toHaveBeenCalled()

    // A query must not litter the capture history — asking twice should leave
    // no trace. Checked directly, because there is no list-batches endpoint.
    const { rows } = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM capture_batches',
    )
    expect(rows[0]!.count).toBe(0)
  })

  it('returns at most five shortlist items', async () => {
    for (let index = 0; index < 8; index += 1) {
      await createTask({ title: `Task ${index}`, estimatedMinutes: 5 })
    }

    const response = await capture('I have 20 minutes')

    expect(response.json().tasks).toHaveLength(5)
  })

  it('excludes completed tasks from the shortlist', async () => {
    const done = await createTask({ title: 'Already done', estimatedMinutes: 5 })
    await app.inject({
      method: 'PATCH',
      url: `/tasks/${done.id}`,
      headers: authHeaders(),
      payload: { status: 'done' },
    })

    const response = await capture('I have 20 minutes')

    expect(response.json().tasks).toEqual([])
  })
})

describe('POST /capture-batches/:id/parse', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildTestApp()
    await app.ready()
  })

  beforeEach(async () => {
    await truncateAll()
    parseCapture.mockReset()
  })

  afterAll(async () => {
    await app.close()
  })

  async function failedCapture(rawText: string) {
    parseCapture.mockRejectedValueOnce(new AiUnavailableError('down', 'request_failed'))
    const created = await app.inject({
      method: 'POST',
      url: '/capture',
      headers: authHeaders(),
      payload: { rawText },
    })
    return created.json().batch.id as string
  }

  it('retries a failed batch and replaces the fallback task', async () => {
    const batchId = await failedCapture('buy milk')

    parseCapture.mockResolvedValueOnce([
      {
        title: 'Buy milk',
        notes: null,
        priority: 'low',
        dueAt: null,
        estimatedMinutes: 5,
        suggestBreakdown: false,
      },
    ])

    const response = await app.inject({
      method: 'POST',
      url: `/capture-batches/${batchId}/parse`,
      headers: authHeaders(),
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.batch.parseStatus).toBe('parsed')
    expect(body.batch.parseError).toBeNull()
    expect(body.tasks).toHaveLength(1)
    expect(body.tasks[0].title).toBe('Buy milk')
    expect(body.tasks[0].source).toBe('ai_parsed')
  })

  it('leaves the batch failed when the retry also fails', async () => {
    const batchId = await failedCapture('buy milk')
    parseCapture.mockRejectedValueOnce(new AiUnavailableError('still down', 'request_failed'))

    const response = await app.inject({
      method: 'POST',
      url: `/capture-batches/${batchId}/parse`,
      headers: authHeaders(),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().batch.parseStatus).toBe('failed')
    expect(response.json().tasks).toHaveLength(1)
  })

  it('404s for a batch that does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/capture-batches/00000000-0000-0000-0000-000000000000/parse',
      headers: authHeaders(),
    })
    expect(response.statusCode).toBe(404)
  })

  it('409s when the batch already parsed successfully', async () => {
    parseCapture.mockResolvedValueOnce([])
    const created = await app.inject({
      method: 'POST',
      url: '/capture',
      headers: authHeaders(),
      payload: { rawText: 'buy milk' },
    })
    const batchId = created.json().batch.id

    const response = await app.inject({
      method: 'POST',
      url: `/capture-batches/${batchId}/parse`,
      headers: authHeaders(),
    })

    expect(response.statusCode).toBe(409)
  })
})

describe('GET /tasks/available', () => {
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
  })

  it('returns the shortlist for an explicit minutes value', async () => {
    await createTask({ title: 'Quick', estimatedMinutes: 10 })
    await createTask({ title: 'Slow', estimatedMinutes: 90 })

    const response = await app.inject({
      method: 'GET',
      url: '/tasks/available?minutes=20',
      headers: authHeaders(),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().minutes).toBe(20)
    expect(response.json().tasks.map((t: { title: string }) => t.title)).toEqual(['Quick'])
  })

  it('is routed ahead of GET /tasks/:id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/tasks/available?minutes=20',
      headers: authHeaders(),
    })
    expect(response.statusCode).toBe(200)
  })

  it('rejects a missing or out-of-range minutes value', async () => {
    for (const url of ['/tasks/available', '/tasks/available?minutes=0', '/tasks/available?minutes=5000']) {
      const response = await app.inject({ method: 'GET', url, headers: authHeaders() })
      expect(response.statusCode, url).toBe(400)
    }
  })
})
```

- [ ] **Step 2: Write the failing breakdown test**

`backend/tests/routes/breakdown.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

// vi.hoisted, because vi.mock is hoisted above every const in the file.
const { proposeBreakdown } = vi.hoisted(() => ({ proposeBreakdown: vi.fn() }))

vi.mock('../../src/ai/breakdown.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/ai/breakdown.js')>(
    '../../src/ai/breakdown.js',
  )
  return { ...actual, proposeBreakdown }
})

const { closePool } = await import('../../src/db/pool.js')
const { truncateAll } = await import('../helpers/db.js')
const { authHeaders, buildTestApp } = await import('../helpers/app.js')
const { AiUnavailableError } = await import('../../src/ai/errors.js')
const { createTask, listTasks } = await import('../../src/repositories/tasks.js')

const MISSING_ID = '00000000-0000-0000-0000-000000000000'

describe('breakdown routes', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildTestApp()
    await app.ready()
  })

  beforeEach(async () => {
    await truncateAll()
    proposeBreakdown.mockReset()
  })

  afterAll(async () => {
    await app.close()
    await closePool()
  })

  it('requires auth on both routes', async () => {
    for (const url of [`/tasks/${MISSING_ID}/breakdown`, `/tasks/${MISSING_ID}/subtasks`]) {
      const response = await app.inject({ method: 'POST', url, payload: { subtasks: [] } })
      expect(response.statusCode, url).toBe(401)
    }
  })

  it('proposes subtasks without saving anything', async () => {
    const task = await createTask({ title: 'Redesign the site', suggestBreakdown: true })
    proposeBreakdown.mockResolvedValue([
      { title: 'Collect references', estimatedMinutes: 30 },
      { title: 'Sketch a layout', estimatedMinutes: 60 },
    ])

    const response = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/breakdown`,
      headers: authHeaders(),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().subtasks).toHaveLength(2)
    // Nothing persisted: still just the parent.
    expect(await listTasks()).toHaveLength(1)
  })

  it('404s when proposing a breakdown for a task that does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/tasks/${MISSING_ID}/breakdown`,
      headers: authHeaders(),
    })
    expect(response.statusCode).toBe(404)
    expect(proposeBreakdown).not.toHaveBeenCalled()
  })

  it('503s when Claude is unavailable', async () => {
    const task = await createTask({ title: 'Redesign the site' })
    proposeBreakdown.mockRejectedValue(new AiUnavailableError('down', 'request_failed'))

    const response = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/breakdown`,
      headers: authHeaders(),
    })

    expect(response.statusCode).toBe(503)
    expect(response.json().error).toMatch(/unavailable/i)
  })

  it('saves edited subtasks under the parent and clears the flag', async () => {
    const parent = await createTask({ title: 'Redesign the site', suggestBreakdown: true })

    const response = await app.inject({
      method: 'POST',
      url: `/tasks/${parent.id}/subtasks`,
      headers: authHeaders(),
      payload: {
        subtasks: [
          { title: 'Collect references', estimatedMinutes: 30 },
          { title: 'Sketch a layout', estimatedMinutes: null },
        ],
      },
    })

    expect(response.statusCode).toBe(201)
    const created = response.json().tasks
    expect(created).toHaveLength(2)
    expect(created.every((t: { parentTaskId: string }) => t.parentTaskId === parent.id)).toBe(true)
    expect(created.every((t: { source: string }) => t.source === 'ai_breakdown')).toBe(true)

    const children = await listTasks({ parentTaskId: parent.id })
    expect(children).toHaveLength(2)

    // The "Break this down?" affordance should be gone now.
    const refreshed = await listTasks({ parentTaskId: null })
    expect(refreshed[0]?.suggestBreakdown).toBe(false)
  })

  it('404s when saving subtasks under a task that does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/tasks/${MISSING_ID}/subtasks`,
      headers: authHeaders(),
      payload: { subtasks: [{ title: 'Step one', estimatedMinutes: null }] },
    })
    expect(response.statusCode).toBe(404)
  })

  it('rejects an empty subtask list', async () => {
    const parent = await createTask({ title: 'Redesign the site' })

    const response = await app.inject({
      method: 'POST',
      url: `/tasks/${parent.id}/subtasks`,
      headers: authHeaders(),
      payload: { subtasks: [] },
    })

    expect(response.statusCode).toBe(400)
  })

  it('rejects a blank subtask title', async () => {
    const parent = await createTask({ title: 'Redesign the site' })

    const response = await app.inject({
      method: 'POST',
      url: `/tasks/${parent.id}/subtasks`,
      headers: authHeaders(),
      payload: { subtasks: [{ title: '   ', estimatedMinutes: null }] },
    })

    expect(response.statusCode).toBe(400)
  })
})
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `cd backend && npx vitest run tests/routes/capture.test.ts tests/routes/breakdown.test.ts`
Expected: FAIL — the routes return 404 because nothing is registered.

- [ ] **Step 4: Write the AI wire schemas**

`backend/src/schemas/ai.ts`:

```ts
import { Type } from '@sinclair/typebox'
import { TaskSchema } from './task.js'
import { CaptureBatchSchema } from './captureBatch.js'

export const CaptureBodySchema = Type.Object(
  { rawText: Type.String({ minLength: 1, maxLength: 20_000 }) },
  { additionalProperties: false },
)

export const ShortlistResponseSchema = Type.Object({
  type: Type.Literal('shortlist'),
  minutes: Type.Integer(),
  tasks: Type.Array(TaskSchema),
})

export const CaptureBatchResponseSchema = Type.Object({
  type: Type.Literal('batch'),
  batch: CaptureBatchSchema,
  tasks: Type.Array(TaskSchema),
})

export const ReparseResponseSchema = Type.Object({
  batch: CaptureBatchSchema,
  tasks: Type.Array(TaskSchema),
})

export const ProposedSubtaskSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 500 }),
    estimatedMinutes: Type.Union([Type.Integer({ minimum: 1, maximum: 100_000 }), Type.Null()]),
  },
  { additionalProperties: false },
)

export const BreakdownResponseSchema = Type.Object({
  subtasks: Type.Array(ProposedSubtaskSchema),
})

export const SaveSubtasksBodySchema = Type.Object(
  { subtasks: Type.Array(ProposedSubtaskSchema, { minItems: 1, maxItems: 20 }) },
  { additionalProperties: false },
)

export const SaveSubtasksResponseSchema = Type.Object({ tasks: Type.Array(TaskSchema) })

export const AvailableQuerySchema = Type.Object(
  { minutes: Type.Integer({ minimum: 1, maximum: 1440 }) },
  { additionalProperties: false },
)

export const AvailableResponseSchema = Type.Object({
  minutes: Type.Integer(),
  tasks: Type.Array(TaskSchema),
})
```

- [ ] **Step 5: Write the capture routes**

`backend/src/routes/capture.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'
import {
  AvailableQuerySchema,
  AvailableResponseSchema,
  CaptureBatchResponseSchema,
  CaptureBodySchema,
  ReparseResponseSchema,
  ShortlistResponseSchema,
} from '../schemas/ai.js'
import { CaptureBatchIdParamsSchema } from '../schemas/captureBatch.js'
import { ErrorSchema } from '../schemas/task.js'
import { parseCapture, type ParsedTaskDraft } from '../ai/parseCapture.js'
import { detectTimeAvailable } from '../ai/timeAvailable.js'
import { AiUnavailableError } from '../ai/errors.js'
import {
  createCaptureBatch,
  getCaptureBatch,
  setCaptureBatchParseStatus,
  type CaptureBatch,
} from '../repositories/captureBatches.js'
import { createTasks, deleteTask, listTasks, type Task } from '../repositories/tasks.js'
import { toCaptureBatchResponse, toTaskResponse } from './serialize.js'

/** Short enough to stay glanceable, long enough to feel like a choice. */
const SHORTLIST_SIZE = 5

/** A fallback task's title is one line; the full dump lives in its notes. */
const FALLBACK_TITLE_LIMIT = 120

function draftsToTasks(drafts: ParsedTaskDraft[], batchId: string) {
  return drafts.map((draft) => ({
    title: draft.title,
    notes: draft.notes,
    priority: draft.priority,
    dueAt: draft.dueAt,
    estimatedMinutes: draft.estimatedMinutes,
    suggestBreakdown: draft.suggestBreakdown,
    captureBatchId: batchId,
    source: 'ai_parsed' as const,
  }))
}

/**
 * When parsing fails the raw dump is already saved, but a batch the user can't
 * see isn't much comfort — so we also create a single ordinary task carrying
 * the text. They can edit it by hand or hit retry.
 */
function fallbackTask(rawText: string, batchId: string) {
  const firstLine = rawText.split('\n')[0]!.trim()
  const title =
    firstLine.length > FALLBACK_TITLE_LIMIT
      ? `${firstLine.slice(0, FALLBACK_TITLE_LIMIT - 1)}…`
      : firstLine
  return {
    title: title === '' ? 'Unparsed capture' : title,
    notes: rawText,
    captureBatchId: batchId,
    source: 'manual' as const,
  }
}

async function shortlist(minutes: number): Promise<Task[]> {
  return listTasks({ status: 'open', maxEstimatedMinutes: minutes, limit: SHORTLIST_SIZE })
}

async function runParse(
  batch: CaptureBatch,
): Promise<{ batch: CaptureBatch; tasks: Task[] }> {
  try {
    const drafts = await parseCapture(batch.rawText)
    const tasks = await createTasks(draftsToTasks(drafts, batch.id))
    const updated = await setCaptureBatchParseStatus(batch.id, 'parsed')
    return { batch: updated ?? batch, tasks }
  } catch (error) {
    if (!(error instanceof AiUnavailableError)) throw error
    const tasks = await createTasks([fallbackTask(batch.rawText, batch.id)])
    const updated = await setCaptureBatchParseStatus(batch.id, 'failed', error.message)
    return { batch: updated ?? batch, tasks }
  }
}

export async function captureRoutes(app: FastifyInstance): Promise<void> {
  const typedApp = app.withTypeProvider<TypeBoxTypeProvider>()

  typedApp.post(
    '/capture',
    {
      preHandler: app.requireAuth,
      schema: {
        body: CaptureBodySchema,
        response: {
          200: ShortlistResponseSchema,
          201: CaptureBatchResponseSchema,
          400: ErrorSchema,
          401: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const rawText = request.body.rawText.trim()
      if (rawText === '') {
        return reply.code(400).send({ error: 'rawText must not be blank' })
      }

      // A time-available question is a query, not a capture — answer it and
      // save nothing, so asking twice doesn't litter the list.
      const minutes = detectTimeAvailable(rawText)
      if (minutes !== null) {
        return {
          type: 'shortlist' as const,
          minutes,
          tasks: (await shortlist(minutes)).map(toTaskResponse),
        }
      }

      const batch = await createCaptureBatch(rawText)
      const result = await runParse(batch)

      return reply.code(201).send({
        type: 'batch' as const,
        batch: toCaptureBatchResponse(result.batch),
        tasks: result.tasks.map(toTaskResponse),
      })
    },
  )

  typedApp.post(
    '/capture-batches/:id/parse',
    {
      preHandler: app.requireAuth,
      schema: {
        params: CaptureBatchIdParamsSchema,
        response: {
          200: ReparseResponseSchema,
          401: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const batch = await getCaptureBatch(request.params.id)
      if (batch === null) return reply.code(404).send({ error: 'Capture batch not found' })
      if (batch.parseStatus !== 'failed') {
        return reply.code(409).send({ error: 'Only a failed capture batch can be re-parsed' })
      }

      // Clear the fallback task from the previous attempt so a retry doesn't
      // leave a duplicate behind.
      for (const stale of await listTasks({ captureBatchId: batch.id })) {
        await deleteTask(stale.id)
      }

      const result = await runParse(batch)

      return {
        batch: toCaptureBatchResponse(result.batch),
        tasks: result.tasks.map(toTaskResponse),
      }
    },
  )

  typedApp.get(
    '/tasks/available',
    {
      preHandler: app.requireAuth,
      schema: {
        querystring: AvailableQuerySchema,
        response: { 200: AvailableResponseSchema, 400: ErrorSchema, 401: ErrorSchema },
      },
    },
    async (request) => ({
      minutes: request.query.minutes,
      tasks: (await shortlist(request.query.minutes)).map(toTaskResponse),
    }),
  )
}
```

- [ ] **Step 6: Write the breakdown routes**

`backend/src/routes/breakdown.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  BreakdownResponseSchema,
  SaveSubtasksBodySchema,
  SaveSubtasksResponseSchema,
} from '../schemas/ai.js'
import { ErrorSchema, TaskIdParamsSchema } from '../schemas/task.js'
import { proposeBreakdown } from '../ai/breakdown.js'
import { AiUnavailableError } from '../ai/errors.js'
import { createTasks, getTask, updateTask } from '../repositories/tasks.js'
import { toTaskResponse } from './serialize.js'

export async function breakdownRoutes(app: FastifyInstance): Promise<void> {
  const typedApp = app.withTypeProvider<TypeBoxTypeProvider>()

  typedApp.post(
    '/tasks/:id/breakdown',
    {
      preHandler: app.requireAuth,
      schema: {
        params: TaskIdParamsSchema,
        response: {
          200: BreakdownResponseSchema,
          401: ErrorSchema,
          404: ErrorSchema,
          503: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const task = await getTask(request.params.id)
      if (task === null) return reply.code(404).send({ error: 'Task not found' })

      try {
        // Nothing is saved here — the spec requires the user reviews and edits
        // the proposal before any subtask exists.
        return { subtasks: await proposeBreakdown({ title: task.title, notes: task.notes }) }
      } catch (error) {
        if (error instanceof AiUnavailableError) {
          request.log.warn({ err: error, reason: error.reason }, 'breakdown unavailable')
          return reply.code(503).send({ error: 'Breakdown is unavailable right now' })
        }
        throw error
      }
    },
  )

  typedApp.post(
    '/tasks/:id/subtasks',
    {
      preHandler: app.requireAuth,
      schema: {
        params: TaskIdParamsSchema,
        body: SaveSubtasksBodySchema,
        response: {
          201: SaveSubtasksResponseSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const parent = await getTask(request.params.id)
      if (parent === null) return reply.code(404).send({ error: 'Task not found' })

      const subtasks = request.body.subtasks.map((subtask) => ({
        ...subtask,
        title: subtask.title.trim(),
      }))
      if (subtasks.some((subtask) => subtask.title === '')) {
        return reply.code(400).send({ error: 'subtask titles must not be blank' })
      }

      const created = await createTasks(
        subtasks.map((subtask) => ({
          title: subtask.title,
          estimatedMinutes: subtask.estimatedMinutes,
          parentTaskId: parent.id,
          source: 'ai_breakdown' as const,
        })),
      )

      // The parent is a project now, so the "Break this down?" affordance has
      // done its job.
      await updateTask(parent.id, { suggestBreakdown: false })

      return reply.code(201).send({ tasks: created.map(toTaskResponse) })
    },
  )
}
```

- [ ] **Step 7: Register the routes**

In `backend/src/app.ts`, add the imports:

```ts
import { captureRoutes } from './routes/capture.js'
import { breakdownRoutes } from './routes/breakdown.js'
```

and register them after `captureBatchRoutes`:

```ts
  await app.register(captureRoutes)
  await app.register(breakdownRoutes)
```

- [ ] **Step 8: Run both route tests**

Run: `cd backend && npx vitest run tests/routes/capture.test.ts tests/routes/breakdown.test.ts`
Expected: PASS.

If `GET /tasks/available` returns 400 rather than 200, Fastify matched `GET /tasks/:id` first and rejected `available` as a non-uuid. Fix it by registering `captureRoutes` **before** `taskRoutes` in `app.ts`, and say so in your report — the ordering then matters and deserves the comment.

- [ ] **Step 9: Update the README**

In `backend/README.md`, add `ANTHROPIC_API_KEY` to the setup section (noting it is server-side only), and extend the endpoint table with:

| Method | Path | Body | Success |
| --- | --- | --- | --- |
| POST | `/capture` | `{rawText}` | 200 shortlist / 201 batch |
| POST | `/capture-batches/:id/parse` | — | 200 / 404 / 409 |
| POST | `/tasks/:id/breakdown` | — | 200 `{subtasks}` / 404 / 503 |
| POST | `/tasks/:id/subtasks` | `{subtasks}` | 201 `{tasks}` / 404 |
| GET | `/tasks/available?minutes=N` | — | 200 `{minutes, tasks}` |

Add a short "AI behaviour" section covering: which model runs where and why; that `POST /capture` answers a time-available question instead of capturing when the whole input looks like one; that a failed parse still stores the raw text, creates one fallback task, and can be retried; and that `suggestBreakdown` is set by the parser and cleared once subtasks are saved. Add `suggestBreakdown` to the documented Task shape and `parseStatus`/`parseError` to the CaptureBatch shape.

- [ ] **Step 10: Full verification and commit**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: no type errors; all green.

```bash
git add backend
git commit -m "feat(backend): add AI capture, breakdown, and time-available routes"
```

---

## Definition of Done

- [ ] `cd backend && npm test` passes, with no test making a real network call to Claude.
- [ ] `cd backend && npx tsc --noEmit` reports no errors, with no `as any`, `@ts-ignore`, or `@ts-expect-error` anywhere in `src/`.
- [ ] `npm run migrate` applies `002_ai_capture.sql` and is a no-op on re-run — **with `ANTHROPIC_API_KEY` unset**.
- [ ] With a real key in `.env` and the server running, `POST /capture` with a multi-line dump returns parsed tasks; at least one obviously-vague item comes back with `suggestBreakdown: true`.
- [ ] `POST /capture` with `"I have 20 minutes"` returns a shortlist and creates no batch.
- [ ] `POST /tasks/:id/breakdown` on a flagged task returns a plausible subtask list and persists nothing.
- [ ] Temporarily setting `ANTHROPIC_API_KEY` to an invalid value and posting a capture still returns 201, still stores the raw text, and marks the batch `failed`.

## What This Plan Deliberately Leaves Out

- **Scheduler & Push Notifications** — `node-cron`, `push_subscriptions`, `check_in_settings`, VAPID, deadline sweeps using `alerted_at`. Note for that plan: `updateTask`'s `patch[key] ?? null` coerces an explicitly-passed `undefined` into a NULL write, and the scheduler will be the first non-HTTP caller that can hit it.
- **Frontend PWA** — the review-list UI, the "Break this down?" affordance, the quick-action, and CORS.
- **Deployment** — production Docker, Caddy, VPS.
- **Pattern-learned prioritization** — the spec rules it out for v1. Priority stays a plain user-editable field.
- **Voice input** — capture is text-only.
- **Multi-hop parent cycle detection** — the foundation plan rejects only direct self-parenting. Subtasks created here are one level deep, so this plan does not make it worse, but the frontend's tree rendering still needs to handle it.
