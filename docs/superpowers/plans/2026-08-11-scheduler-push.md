# Scheduler & Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nudge the user without them having to open the app — a deadline alert before a task is due, and randomized check-ins during their waking hours that open straight to the capture box.

**Architecture:** An in-process `node-cron` tick inside the backend service fires every 15 minutes. Each tick runs two independent sweeps: deadline alerts (query tasks approaching `due_at`, send, stamp `alerted_at` so they never fire twice) and check-ins (a pure probability function decides whether *this* tick is one of the day's randomized moments). Web Push delivery goes through one sender that prunes subscriptions the push service reports as gone. Every scheduling decision is a pure function taking `now`, settings, and an injected RNG — so the logic is unit-testable without mocking time or the clock.

**Tech Stack:** Everything from the Backend Foundation and AI Capture plans (Node 22, TypeScript ESM, Fastify 5, TypeBox, `pg`, Vitest against real Postgres) plus `node-cron` and `web-push`.

## Global Constraints

- **This plan builds on `2026-08-11-backend-foundation.md` and `2026-08-11-ai-capture-breakdown.md`.** Both are complete on this branch. Their layering rules bind here: `repositories/` owns all SQL and is the only snake_case↔camelCase translation point; `routes/` owns HTTP concerns only; `schemas/` owns the wire contract; `routes/serialize.ts` owns repository→wire `Date`→ISO conversion; `src/ai/` owns Claude and is the only importer of `@anthropic-ai/sdk`.
- **Single-user only.** No accounts, no `user_id`, no per-user scoping. There is one settings row and one set of push subscriptions — one per device the single user installs the PWA on.
- **Auth is one long-lived bearer token.** Every route carries `onRequest: app.requireAuth`. Note this is `onRequest`, not `preHandler` — plan 2's final review moved it so auth runs before schema validation. Match that.
- **The scheduler must never run during tests.** It is started from `server.ts`, not from `buildApp()`. A cron tick firing inside the test suite would make tests non-deterministic and could send real pushes.
- **Scheduler failures are logged, never thrown.** A tick that throws would kill the cron job for the life of the process. This is a personal tool, not an SLA'd service — log it and let the next tick try again.
- **Push failures are silent by design.** The spec is explicit: if a subscription goes stale (iOS clearing PWA data is the common case), sends fail quietly and there is no resubscribe-nagging system in v1. Pruning a subscription the push service reports as `404`/`410` is cleanup, not nagging — do that.
- **Plain notifications only.** Title, body, and a URL to open on tap. No action buttons, no images, no rich layouts in v1.
- Node 22 LTS, ESM only (`"type": "module"`); relative imports carry the `.js` extension.
- API JSON is camelCase; database columns are snake_case. Timestamps are `timestamptz` in Postgres, ISO-8601 UTC strings in JSON.
- Tests run against real Postgres — never a mock, never SQLite. **`web-push` is always mocked**; the suite must never send a real notification.
- No `as any`, `as never`, `as unknown as`, `@ts-ignore`, or `@ts-expect-error` anywhere. `src/` currently has zero casts; keep it that way.
- All work happens under `backend/`.

---

## Two gaps in the design spec, and how this plan resolves them

Both are flagged here rather than buried, because they change the data model.

**1. The spec's active-hours window has no timezone.** It says "active hours window (e.g. 9am–6pm)" but never says whose 9am. The server runs UTC on a VPS; the user does not. Without a timezone the check-in window is meaningless — a 9-to-6 window would fire overnight for anyone not in UTC.

Resolution: `check_in_settings` carries an IANA `timezone` column (default `UTC`). All window arithmetic is done in that zone using `Intl.DateTimeFormat`, which Node 22 supports fully with no extra dependency.

**2. The spec says the deadline lead time is "configurable" but not where.** It is not a per-task property and it is not a check-in concern.

Resolution: an environment variable `DEADLINE_LEAD_MINUTES` (default 60), validated at startup alongside the other scheduler config. A personal tool redeploys cheaply; a settings row for one number that changes approximately never is not worth the surface.

---

## How check-in randomization works

The spec asks for "randomized time(s) per day" within the active window. The obvious implementation — pick N random times at midnight and store them — needs a schedule table, breaks if the process restarts, and is awkward to test.

Instead, each tick asks: *given how many check-ins I still owe today and how many ticks remain in the window, what is the probability that this tick should be one of them?*

```
remaining = checkInsPerDay - sentToday
ticksLeft = ceil((windowEndMinutes - nowMinutes) / tickMinutes)
p         = remaining / ticksLeft
fire if random() < p
```

This distributes N check-ins uniformly at random across the window, needs no schedule table, self-corrects after a restart or a missed tick, and converges: when `ticksLeft` falls to `remaining`, `p` reaches 1 and the remaining check-ins fire in the last ticks rather than being lost. The whole decision is a pure function of `(now, settings, sentToday, tickMinutes, random)` — no clock mocking, no database, fully unit-testable.

---

## File Structure

```
backend/
  src/
    logger.ts                      — the one structural Logger type the sweeps take
    db/migrations/
      003_scheduler_push.sql       — push_subscriptions, check_in_settings, check_in_events
    push/
      config.ts                    — VAPID + scheduler config, separate module (see below)
      webPush.ts                   — the web-push client wrapper
      send.ts                      — sendToAllSubscriptions, prunes dead endpoints
    scheduler/
      deadlines.ts                 — due-task sweep
      checkIns.ts                  — shouldSendCheckIn (pure) + the sweep
      index.ts                     — startScheduler / stopScheduler (node-cron)
      time.ts                      — zoned time helpers
    repositories/
      pushSubscriptions.ts         — NEW
      checkInSettings.ts           — NEW
      tasks.ts                     — MODIFY: listTasksDueForAlert + the undefined-coercion fix
    schemas/
      push.ts                      — NEW: wire schemas for push + settings
    routes/
      push.ts                      — NEW: VAPID key, subscribe, unsubscribe, test send
      checkInSettings.ts           — NEW: get/patch settings
    app.ts                         — MODIFY: register the two new route modules
    server.ts                      — MODIFY: start/stop the scheduler
  scripts/
    generate-vapid-keys.ts         — one-off key generation
  tests/
    scheduler/time.test.ts
    scheduler/checkIns.test.ts     — the pure decision function, exhaustively
    scheduler/deadlines.test.ts    — real Postgres, mocked push
    push/send.test.ts              — mocked web-push, pruning behavior
    repositories/pushSubscriptions.test.ts
    repositories/checkInSettings.test.ts
    routes/push.test.ts
    routes/checkInSettings.test.ts
```

`src/push/config.ts` is its own module for the same reason `src/db/config.ts` and `src/ai/config.ts` are: ES modules execute the whole module body on import, so a module-scope `loadX()` makes every importer demand those env vars. Keeping VAPID config separate means migrations and the AI layer never require VAPID keys.

---

## Task 1: Schema and repositories

Adds the three tables, their repositories, the due-task query the deadline sweep needs, and fixes a latent bug in `updateTask` that this plan is the first caller able to trigger.

**Files:**
- Create: `backend/src/db/migrations/003_scheduler_push.sql`
- Create: `backend/src/repositories/pushSubscriptions.ts`
- Create: `backend/src/repositories/checkInSettings.ts`
- Modify: `backend/src/repositories/tasks.ts`
- Modify: `backend/tests/helpers/db.ts`
- Test: `backend/tests/repositories/pushSubscriptions.test.ts`
- Test: `backend/tests/repositories/checkInSettings.test.ts`
- Test: `backend/tests/repositories/dueForAlert.test.ts`

**Interfaces:**
- Consumes: `pool`, `Task`, `mapRow`, `COLUMNS` from the earlier plans.
- Produces:
  - Tables `push_subscriptions`, `check_in_settings` (single row), `check_in_events`
  - `interface PushSubscriptionRecord { id, endpoint, p256dh, auth, createdAt }`
  - `savePushSubscription(input): Promise<PushSubscriptionRecord>` (upsert on endpoint)
  - `listPushSubscriptions(): Promise<PushSubscriptionRecord[]>`
  - `deletePushSubscriptionByEndpoint(endpoint): Promise<boolean>`
  - `interface CheckInSettings { enabled, activeFrom, activeTo, checkInsPerDay, timezone, updatedAt }`
  - `getCheckInSettings(): Promise<CheckInSettings>`
  - `updateCheckInSettings(patch): Promise<CheckInSettings>`
  - `recordCheckIn(): Promise<void>` and `countCheckInsOnLocalDate(localDate, timezone): Promise<number>`
  - `listTasksDueForAlert(leadMinutes, limit): Promise<Task[]>`

- [ ] **Step 1: Write the failing tests**

`backend/tests/repositories/pushSubscriptions.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closePool } from '../../src/db/pool.js'
import { setupTestDatabase, truncateAll } from '../helpers/db.js'
import {
  deletePushSubscriptionByEndpoint,
  listPushSubscriptions,
  savePushSubscription,
} from '../../src/repositories/pushSubscriptions.js'

const SUB = {
  endpoint: 'https://push.example.com/abc123',
  p256dh: 'p256dh-key',
  auth: 'auth-secret',
}

describe('push subscriptions repository', () => {
  beforeAll(async () => {
    await setupTestDatabase()
  })

  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await closePool()
  })

  it('saves a subscription and lists it back', async () => {
    const saved = await savePushSubscription(SUB)

    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(saved.endpoint).toBe(SUB.endpoint)
    expect(saved.p256dh).toBe(SUB.p256dh)
    expect(saved.auth).toBe(SUB.auth)
    expect(saved.createdAt).toBeInstanceOf(Date)
    expect(await listPushSubscriptions()).toHaveLength(1)
  })

  it('upserts on endpoint rather than creating a duplicate', async () => {
    const first = await savePushSubscription(SUB)
    const second = await savePushSubscription({ ...SUB, p256dh: 'rotated-key' })

    expect(await listPushSubscriptions()).toHaveLength(1)
    expect(second.id).toBe(first.id)
    expect(second.p256dh).toBe('rotated-key')
  })

  it('keeps subscriptions for different endpoints separate', async () => {
    await savePushSubscription(SUB)
    await savePushSubscription({ ...SUB, endpoint: 'https://push.example.com/other' })

    expect(await listPushSubscriptions()).toHaveLength(2)
  })

  it('deletes by endpoint and reports whether anything was removed', async () => {
    await savePushSubscription(SUB)

    expect(await deletePushSubscriptionByEndpoint(SUB.endpoint)).toBe(true)
    expect(await deletePushSubscriptionByEndpoint(SUB.endpoint)).toBe(false)
    expect(await listPushSubscriptions()).toEqual([])
  })
})
```

`backend/tests/repositories/checkInSettings.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { pool, closePool } from '../../src/db/pool.js'
import { setupTestDatabase, truncateAll } from '../helpers/db.js'
import {
  countCheckInsOnLocalDate,
  getCheckInSettings,
  recordCheckIn,
  updateCheckInSettings,
} from '../../src/repositories/checkInSettings.js'

describe('check-in settings repository', () => {
  beforeAll(async () => {
    await setupTestDatabase()
  })

  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await closePool()
  })

  it('returns the seeded defaults', async () => {
    const settings = await getCheckInSettings()

    expect(settings.enabled).toBe(true)
    expect(settings.activeFrom).toBe('09:00')
    expect(settings.activeTo).toBe('18:00')
    expect(settings.checkInsPerDay).toBe(3)
    expect(settings.timezone).toBe('UTC')
  })

  it('always has exactly one row after truncation', async () => {
    const { rows } = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM check_in_settings',
    )
    expect(rows[0]!.count).toBe(1)
  })

  it('updates only the fields present in the patch', async () => {
    const updated = await updateCheckInSettings({ checkInsPerDay: 5 })

    expect(updated.checkInsPerDay).toBe(5)
    expect(updated.activeFrom).toBe('09:00')
    expect(updated.enabled).toBe(true)
  })

  it('round-trips a timezone and a window', async () => {
    const updated = await updateCheckInSettings({
      timezone: 'Europe/London',
      activeFrom: '08:30',
      activeTo: '20:00',
      enabled: false,
    })

    expect(updated.timezone).toBe('Europe/London')
    expect(updated.activeFrom).toBe('08:30')
    expect(updated.activeTo).toBe('20:00')
    expect(updated.enabled).toBe(false)
  })

  it('returns current settings unchanged for an empty patch', async () => {
    const before = await getCheckInSettings()
    const after = await updateCheckInSettings({})

    expect(after.checkInsPerDay).toBe(before.checkInsPerDay)
  })

  it('counts check-ins recorded on a given local date', async () => {
    await recordCheckIn()
    await recordCheckIn()

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date())
    expect(await countCheckInsOnLocalDate(today, 'UTC')).toBe(2)
    expect(await countCheckInsOnLocalDate('1999-01-01', 'UTC')).toBe(0)
  })
})
```

`backend/tests/repositories/dueForAlert.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closePool } from '../../src/db/pool.js'
import { setupTestDatabase, truncateAll } from '../helpers/db.js'
import { createTask, listTasksDueForAlert, updateTask } from '../../src/repositories/tasks.js'

const minutesFromNow = (minutes: number): Date => new Date(Date.now() + minutes * 60_000)

describe('listTasksDueForAlert', () => {
  beforeAll(async () => {
    await setupTestDatabase()
  })

  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await closePool()
  })

  it('returns an open task due inside the lead window', async () => {
    await createTask({ title: 'Due soon', dueAt: minutesFromNow(30) })

    const due = await listTasksDueForAlert(60, 50)

    expect(due.map((task) => task.title)).toEqual(['Due soon'])
  })

  it('excludes a task due beyond the lead window', async () => {
    await createTask({ title: 'Due later', dueAt: minutesFromNow(120) })

    expect(await listTasksDueForAlert(60, 50)).toEqual([])
  })

  it('includes an overdue task that was never alerted', async () => {
    await createTask({ title: 'Overdue', dueAt: minutesFromNow(-120) })

    expect((await listTasksDueForAlert(60, 50)).map((t) => t.title)).toEqual(['Overdue'])
  })

  it('excludes a task that was already alerted', async () => {
    const task = await createTask({ title: 'Already alerted', dueAt: minutesFromNow(30) })
    await updateTask(task.id, { alertedAt: new Date() })

    expect(await listTasksDueForAlert(60, 50)).toEqual([])
  })

  it('excludes a completed task', async () => {
    const task = await createTask({ title: 'Done already', dueAt: minutesFromNow(30) })
    await updateTask(task.id, { status: 'done' })

    expect(await listTasksDueForAlert(60, 50)).toEqual([])
  })

  it('excludes a task with no due date', async () => {
    await createTask({ title: 'No deadline' })

    expect(await listTasksDueForAlert(60, 50)).toEqual([])
  })

  it('returns the soonest-due first and respects the limit', async () => {
    await createTask({ title: 'Later', dueAt: minutesFromNow(50) })
    await createTask({ title: 'Sooner', dueAt: minutesFromNow(10) })

    const due = await listTasksDueForAlert(60, 1)

    expect(due.map((task) => task.title)).toEqual(['Sooner'])
  })

  it('does not write NULL when a patch field is explicitly undefined', async () => {
    // The scheduler is the first non-HTTP caller of updateTask, and it can
    // plausibly pass `{ alertedAt: maybeUndefined }`. Before this fix that
    // wrote NULL over the existing value instead of leaving it alone.
    const task = await createTask({ title: 'Keeps its title' })
    await updateTask(task.id, { alertedAt: new Date() })

    const updated = await updateTask(task.id, { title: undefined, alertedAt: undefined })

    expect(updated?.title).toBe('Keeps its title')
    expect(updated?.alertedAt).toBeInstanceOf(Date)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run tests/repositories/pushSubscriptions.test.ts tests/repositories/checkInSettings.test.ts tests/repositories/dueForAlert.test.ts`
Expected: FAIL — the two new repository modules cannot be resolved, and `listTasksDueForAlert` is not exported.

- [ ] **Step 3: Write the migration**

`backend/src/db/migrations/003_scheduler_push.sql`:

```sql
-- One row per device the single user has installed the PWA on. `endpoint` is
-- the push service's URL for that device and is the natural key: resubscribing
-- the same device yields the same endpoint with possibly rotated keys.
CREATE TABLE push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint    text NOT NULL UNIQUE,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Single-row settings table. The boolean primary key with a CHECK is the
-- standard trick for "there can be only one": the PK admits one `true` row and
-- the CHECK forbids a `false` one.
CREATE TABLE check_in_settings (
  id                boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled           boolean NOT NULL DEFAULT true,
  active_from       time NOT NULL DEFAULT '09:00',
  active_to         time NOT NULL DEFAULT '18:00',
  check_ins_per_day integer NOT NULL DEFAULT 3
                      CHECK (check_ins_per_day >= 0 AND check_ins_per_day <= 12),
  -- IANA zone. The design spec's "9am-6pm" is meaningless without one: the
  -- server runs UTC on a VPS and the user does not.
  timezone          text NOT NULL DEFAULT 'UTC',
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (active_from < active_to)
);

INSERT INTO check_in_settings (id) VALUES (true);

-- One row per check-in actually sent. The scheduler counts today's rows to
-- decide how many it still owes, which is what makes the randomization
-- survive a process restart.
CREATE TABLE check_in_events (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sent_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX check_in_events_sent_at_idx ON check_in_events (sent_at);
```

Note the `active_from < active_to` CHECK: a window that wraps midnight is not supported in v1, and the constraint makes that explicit rather than letting the arithmetic silently misbehave.

- [ ] **Step 4: Extend the test helper**

`tests/helpers/db.ts`'s `truncateAll()` hard-codes its table list, so it must learn the new tables. **`check_in_settings` must be re-seeded after truncation**, since the whole system assumes the row exists:

```ts
export async function truncateAll(): Promise<void> {
  await pool.query(
    'TRUNCATE tasks, capture_batches, push_subscriptions, check_in_events RESTART IDENTITY CASCADE',
  )
  // check_in_settings is a seeded single-row table; reset it to defaults rather
  // than truncating it away, because every read assumes the row is there.
  await pool.query(`
    UPDATE check_in_settings
    SET enabled = true, active_from = '09:00', active_to = '18:00',
        check_ins_per_day = 3, timezone = 'UTC', updated_at = now()
  `)
}
```

- [ ] **Step 5: Write the push subscriptions repository**

`backend/src/repositories/pushSubscriptions.ts`:

```ts
import { pool } from '../db/pool.js'

export interface PushSubscriptionRecord {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  createdAt: Date
}

interface PushSubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  created_at: Date
}

const COLUMNS = 'id, endpoint, p256dh, auth, created_at'

function mapRow(row: PushSubscriptionRow): PushSubscriptionRecord {
  return {
    id: row.id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    createdAt: row.created_at,
  }
}

export interface SavePushSubscriptionInput {
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * Upserts on endpoint. A browser that resubscribes the same device reports the
 * same endpoint with possibly rotated keys, so inserting blindly would
 * accumulate duplicates and send the same notification several times.
 */
export async function savePushSubscription(
  input: SavePushSubscriptionInput,
): Promise<PushSubscriptionRecord> {
  const { rows } = await pool.query<PushSubscriptionRow>(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth)
     VALUES ($1, $2, $3)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
     RETURNING ${COLUMNS}`,
    [input.endpoint, input.p256dh, input.auth],
  )
  return mapRow(rows[0]!)
}

export async function listPushSubscriptions(): Promise<PushSubscriptionRecord[]> {
  const { rows } = await pool.query<PushSubscriptionRow>(
    `SELECT ${COLUMNS} FROM push_subscriptions ORDER BY created_at ASC`,
  )
  return rows.map(mapRow)
}

export async function deletePushSubscriptionByEndpoint(endpoint: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint])
  return (result.rowCount ?? 0) > 0
}
```

- [ ] **Step 6: Write the check-in settings repository**

`backend/src/repositories/checkInSettings.ts`:

```ts
import { pool } from '../db/pool.js'

export interface CheckInSettings {
  enabled: boolean
  /** Local wall-clock time in `timezone`, `HH:MM`. */
  activeFrom: string
  activeTo: string
  checkInsPerDay: number
  /** IANA zone name, e.g. `Europe/London`. */
  timezone: string
  updatedAt: Date
}

interface CheckInSettingsRow {
  enabled: boolean
  active_from: string
  active_to: string
  check_ins_per_day: number
  timezone: string
  updated_at: Date
}

// Postgres renders `time` as HH:MM:SS; the wire contract and the scheduler both
// want HH:MM, and trimming here keeps that conversion in the repository layer.
const COLUMNS = `
  enabled,
  to_char(active_from, 'HH24:MI') AS active_from,
  to_char(active_to, 'HH24:MI') AS active_to,
  check_ins_per_day, timezone, updated_at
`

function mapRow(row: CheckInSettingsRow): CheckInSettings {
  return {
    enabled: row.enabled,
    activeFrom: row.active_from,
    activeTo: row.active_to,
    checkInsPerDay: row.check_ins_per_day,
    timezone: row.timezone,
    updatedAt: row.updated_at,
  }
}

export async function getCheckInSettings(): Promise<CheckInSettings> {
  const { rows } = await pool.query<CheckInSettingsRow>(
    `SELECT ${COLUMNS} FROM check_in_settings WHERE id = true`,
  )
  if (rows[0] === undefined) {
    // Seeded by migration 003 and re-seeded by the test helper; a missing row
    // means someone deleted it, which no code path should ever do.
    throw new Error('check_in_settings row is missing')
  }
  return mapRow(rows[0])
}

export interface UpdateCheckInSettingsInput {
  enabled?: boolean
  activeFrom?: string
  activeTo?: string
  checkInsPerDay?: number
  timezone?: string
}

const UPDATABLE_COLUMNS: Record<keyof UpdateCheckInSettingsInput, string> = {
  enabled: 'enabled',
  activeFrom: 'active_from',
  activeTo: 'active_to',
  checkInsPerDay: 'check_ins_per_day',
  timezone: 'timezone',
}

export async function updateCheckInSettings(
  patch: UpdateCheckInSettingsInput,
): Promise<CheckInSettings> {
  const assignments: string[] = []
  const values: unknown[] = []

  for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
    const value = patch[key as keyof UpdateCheckInSettingsInput]
    if (value === undefined) continue
    values.push(value)
    assignments.push(`${column} = $${values.length}`)
  }

  if (assignments.length === 0) return getCheckInSettings()

  assignments.push('updated_at = now()')
  const { rows } = await pool.query<CheckInSettingsRow>(
    `UPDATE check_in_settings SET ${assignments.join(', ')}
     WHERE id = true
     RETURNING ${COLUMNS.replace(/\s+/g, ' ')}`,
    values,
  )
  return mapRow(rows[0]!)
}

export async function recordCheckIn(): Promise<void> {
  await pool.query('INSERT INTO check_in_events DEFAULT VALUES')
}

/**
 * Counts check-ins sent on a given local calendar date. The comparison happens
 * in Postgres so the zone conversion is done once, by the database, rather than
 * by pulling every row into Node.
 */
export async function countCheckInsOnLocalDate(
  localDate: string,
  timezone: string,
): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM check_in_events
     WHERE (sent_at AT TIME ZONE $2)::date = $1::date`,
    [localDate, timezone],
  )
  return rows[0]?.count ?? 0
}
```

- [ ] **Step 7: Extend the tasks repository**

Two changes in `backend/src/repositories/tasks.ts`.

First, add the due-task query (place it after `listTasks`):

```ts
/**
 * Open tasks whose deadline falls inside the lead window and that have not been
 * alerted yet. Overdue tasks are included: a deadline that passed while the
 * service was down still deserves exactly one alert. `alerted_at` is what makes
 * this idempotent, so the sweep can run as often as it likes.
 */
export async function listTasksDueForAlert(
  leadMinutes: number,
  limit: number,
): Promise<Task[]> {
  const { rows } = await pool.query<TaskRow>(
    `SELECT ${COLUMNS} FROM tasks
     WHERE status = 'open'
       AND due_at IS NOT NULL
       AND alerted_at IS NULL
       AND due_at <= now() + make_interval(mins => $1)
     ORDER BY due_at ASC
     LIMIT $2`,
    [leadMinutes, limit],
  )
  return rows.map(mapRow)
}
```

Second, fix the undefined-coercion bug in `updateTask`. The current loop is:

```ts
  for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
    if (!(key in patch)) continue
    values.push(patch[key as keyof UpdateTaskInput] ?? null)
    assignments.push(`${column} = $${values.length}`)
  }
```

`{ alertedAt: undefined }` has the key present, so `?? null` writes NULL over the existing value. Reaching this required a non-HTTP caller (JSON bodies cannot carry `undefined`), and the scheduler is the first one. Replace with:

```ts
  for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
    // An explicit `null` clears the column; an explicit `undefined` means
    // "leave it alone". Testing the value rather than key presence is what
    // keeps those apart — `key in patch` is true for both.
    const value = patch[key as keyof UpdateTaskInput]
    if (value === undefined) continue
    values.push(value)
    assignments.push(`${column} = $${values.length}`)
  }
```

The existing "clears a nullable field when the patch sets it to null" test must still pass — that is the behavior this must not break.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd backend && npx vitest run tests/repositories/`
Expected: PASS — the three new files plus the existing repository suites.

- [ ] **Step 9: Full suite, type check, and commit**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: no type errors; all green. The baseline was 170 tests; expect 189.

```bash
git add backend
git commit -m "feat(backend): add push subscription and check-in settings schema"
```

---

## Task 2: VAPID configuration and the web-push client

Configuration, the client wrapper, and a script to generate keys. Deliverable: a configured push client whose construction is proven not to drag VAPID keys into unrelated code paths.

**Files:**
- Create: `backend/src/push/config.ts`
- Create: `backend/src/push/webPush.ts`
- Create: `backend/scripts/generate-vapid-keys.ts`
- Modify: `backend/package.json` (dependency + script)
- Modify: `backend/.env.example`
- Modify: `backend/tests/setup.ts`
- Test: `backend/tests/push/config.test.ts`

**Interfaces:**
- Consumes: `required()` from `src/env.ts`.
- Produces:
  - `interface PushConfig { publicKey, privateKey, subject, deadlineLeadMinutes, tickMinutes, appUrl }`
  - `loadPushConfig(env?): PushConfig` and `pushConfig: PushConfig`
  - `webPush` — the configured `web-push` module
  - `npm run vapid:generate`

- [ ] **Step 1: Install the dependencies**

```bash
cd /Users/cooney/Projects/ToDoApp/.claude/worktrees/backend-foundation/backend && npm install web-push node-cron && npm install -D @types/web-push
```

`node-cron` ships its own types; `web-push` does not.

- [ ] **Step 2: Write the failing config test**

`backend/tests/push/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { loadPushConfig } from '../../src/push/config.js'

const validEnv = {
  VAPID_PUBLIC_KEY: 'test-public-key',
  VAPID_PRIVATE_KEY: 'test-private-key',
  VAPID_SUBJECT: 'mailto:someone@example.com',
  APP_URL: 'https://todo.example.com',
}

describe('loadPushConfig', () => {
  it('returns a typed config from a valid environment', () => {
    const config = loadPushConfig(validEnv)

    expect(config.publicKey).toBe('test-public-key')
    expect(config.privateKey).toBe('test-private-key')
    expect(config.subject).toBe('mailto:someone@example.com')
    expect(config.appUrl).toBe('https://todo.example.com')
  })

  it('defaults the deadline lead time to one hour', () => {
    expect(loadPushConfig(validEnv).deadlineLeadMinutes).toBe(60)
  })

  it('defaults the tick to 15 minutes', () => {
    expect(loadPushConfig(validEnv).tickMinutes).toBe(15)
  })

  it('allows overriding the lead time and tick', () => {
    const config = loadPushConfig({
      ...validEnv,
      DEADLINE_LEAD_MINUTES: '120',
      SCHEDULER_TICK_MINUTES: '5',
    })
    expect(config.deadlineLeadMinutes).toBe(120)
    expect(config.tickMinutes).toBe(5)
  })

  it.each(['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'APP_URL'])(
    'throws when %s is missing',
    (key) => {
      const env: Record<string, string> = { ...validEnv }
      delete env[key]
      expect(() => loadPushConfig(env)).toThrow(new RegExp(key))
    },
  )

  it('rejects a VAPID subject that is not a mailto: or https: URL', () => {
    expect(() => loadPushConfig({ ...validEnv, VAPID_SUBJECT: 'someone@example.com' })).toThrow(
      /VAPID_SUBJECT/,
    )
  })

  it('rejects a non-numeric or non-positive lead time', () => {
    for (const value of ['soon', '0', '-5']) {
      expect(() => loadPushConfig({ ...validEnv, DEADLINE_LEAD_MINUTES: value })).toThrow(
        /DEADLINE_LEAD_MINUTES/,
      )
    }
  })

  it('rejects a tick that does not divide an hour evenly', () => {
    // The cron expression is `*/N * * * *`, which only behaves as "every N
    // minutes" when N divides 60 — otherwise it restarts at the top of the hour.
    for (const value of ['7', '45', '0']) {
      expect(() => loadPushConfig({ ...validEnv, SCHEDULER_TICK_MINUTES: value })).toThrow(
        /SCHEDULER_TICK_MINUTES/,
      )
    }
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/push/config.test.ts`
Expected: FAIL — cannot resolve `../../src/push/config.js`.

- [ ] **Step 4: Implement the config**

`backend/src/push/config.ts`:

```ts
import { required } from '../env.js'

export interface PushConfig {
  publicKey: string
  privateKey: string
  /** `mailto:` or `https:` URL identifying the sender, per the VAPID spec. */
  subject: string
  /** How far ahead of `due_at` a deadline alert fires. */
  deadlineLeadMinutes: number
  /** How often the scheduler ticks. Must divide 60. */
  tickMinutes: number
  /** Where a tapped notification opens. */
  appUrl: string
}

const DEFAULT_LEAD_MINUTES = 60
const DEFAULT_TICK_MINUTES = 15

/** `*/N * * * *` only means "every N minutes" when N divides an hour. */
const VALID_TICKS = new Set([1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30])

function positiveInteger(raw: string, name: string): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got: ${raw}`)
  }
  return value
}

export function loadPushConfig(env: NodeJS.ProcessEnv = process.env): PushConfig {
  const subject = required(env, 'VAPID_SUBJECT')
  if (!subject.startsWith('mailto:') && !subject.startsWith('https://')) {
    throw new Error(`VAPID_SUBJECT must be a mailto: or https: URL, got: ${subject}`)
  }

  const deadlineLeadMinutes = positiveInteger(
    env.DEADLINE_LEAD_MINUTES ?? String(DEFAULT_LEAD_MINUTES),
    'DEADLINE_LEAD_MINUTES',
  )

  const rawTick = env.SCHEDULER_TICK_MINUTES ?? String(DEFAULT_TICK_MINUTES)
  const tickMinutes = Number(rawTick)
  if (!VALID_TICKS.has(tickMinutes)) {
    throw new Error(
      `SCHEDULER_TICK_MINUTES must divide 60 evenly (one of ${[...VALID_TICKS].join(', ')}), got: ${rawTick}`,
    )
  }

  return {
    publicKey: required(env, 'VAPID_PUBLIC_KEY'),
    privateKey: required(env, 'VAPID_PRIVATE_KEY'),
    subject,
    deadlineLeadMinutes,
    tickMinutes,
    appUrl: required(env, 'APP_URL'),
  }
}

export const pushConfig = loadPushConfig()
```

This is a separate module from `src/config.ts`, `src/db/config.ts`, and `src/ai/config.ts` for the reason established in the earlier plans: ES modules execute the whole module body on import, so co-locating would make every importer demand VAPID keys.

- [ ] **Step 5: Implement the client wrapper**

`backend/src/push/webPush.ts`:

```ts
import webpush from 'web-push'
import { pushConfig } from './config.js'

webpush.setVapidDetails(pushConfig.subject, pushConfig.publicKey, pushConfig.privateKey)

export { webpush }
```

- [ ] **Step 6: Write the key generation script**

`backend/scripts/generate-vapid-keys.ts`:

```ts
/**
 * One-off VAPID keypair generation. Run once per deployment and put the output
 * in .env — regenerating invalidates every existing push subscription, so the
 * user would have to re-subscribe on every device.
 *
 *   npm run vapid:generate
 */
import webpush from 'web-push'

const keys = webpush.generateVAPIDKeys()

console.log('Add these to your .env file:\n')
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`)
console.log('\nThe public key is safe to serve to the client; the private key is not.')
```

Add to `backend/package.json`'s scripts:

```json
    "vapid:generate": "node --import tsx/esm scripts/generate-vapid-keys.ts",
```

- [ ] **Step 7: Add the environment variables**

Append to `backend/.env.example`:

```bash

# Web Push (VAPID). Generate a pair once with: npm run vapid:generate
# Regenerating invalidates every existing subscription — devices must re-subscribe.
VAPID_PUBLIC_KEY=replace-me
VAPID_PRIVATE_KEY=replace-me
# Identifies the sender to the push service. mailto: or https: URL.
VAPID_SUBJECT=mailto:you@example.com

# Where a tapped notification opens — the PWA's public URL.
APP_URL=https://todo.example.com

# How far ahead of a deadline the alert fires (minutes, optional, default 60).
# DEADLINE_LEAD_MINUTES=60

# How often the scheduler ticks (minutes, optional, default 15).
# Must divide 60 evenly: 1,2,3,4,5,6,10,12,15,20,30.
# SCHEDULER_TICK_MINUTES=15
```

Add to `backend/tests/setup.ts`:

```ts
process.env.VAPID_PUBLIC_KEY = 'test-vapid-public-key'
process.env.VAPID_PRIVATE_KEY = 'test-vapid-private-key'
process.env.VAPID_SUBJECT = 'mailto:test@example.com'
process.env.APP_URL = 'https://todo.test'
```

- [ ] **Step 8: Verify migrations still run without VAPID keys**

This is the regression guard for the module-separation property, matching the equivalent step in the two earlier plans. From the `backend` directory with no `.env` present and no VAPID variables exported:

Run: `DATABASE_URL=postgres://todo:todo@localhost:5433/todo npm run migrate`
Expected: applies `003_scheduler_push.sql` (or reports already up to date) with **no** error about `VAPID_PUBLIC_KEY`. Paste the output into your report.

- [ ] **Step 9: Run the tests, type check, and commit**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: no type errors; all green.

```bash
git add backend
git commit -m "feat(backend): add VAPID configuration and web-push client"
```

---

## Task 3: The push sender

One function that sends a notification to every subscription and prunes the ones the push service says are gone. Deliverable: sending is proven not to throw, and dead endpoints are proven to be removed.

**Files:**
- Create: `backend/src/push/send.ts`
- Test: `backend/tests/push/send.test.ts`

**Interfaces:**
- Consumes: `webpush` (Task 2), `listPushSubscriptions`, `deletePushSubscriptionByEndpoint` (Task 1).
- Produces:
  - `src/logger.ts` exporting `interface Logger { info(obj: unknown, message: string): void; warn(obj: unknown, message: string): void }`
  - `interface PushPayload { title: string; body: string; url?: string }`
  - `interface PushResult { sent: number; pruned: number; failed: number }`
  - `sendToAllSubscriptions(payload, logger?): Promise<PushResult>`

**Create `backend/src/logger.ts` first**, because the sweeps in Tasks 4 and 5 and the cron wiring in Task 6 all take the same thing:

```ts
/**
 * The slice of a logger the scheduler and push layers actually use.
 *
 * Structural, so Fastify's `app.log` and `request.log` satisfy it without those
 * modules importing Fastify — a push sender has no business knowing what web
 * framework is in front of it.
 */
export interface Logger {
  info: (obj: unknown, message: string) => void
  warn: (obj: unknown, message: string) => void
}
```

Every module below imports `Logger` from `../logger.js` rather than declaring its own copy.

- [ ] **Step 1: Write the failing test**

`backend/tests/push/send.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const sendNotification = vi.hoisted(() => vi.fn())

vi.mock('../../src/push/webPush.js', () => ({
  webpush: { sendNotification },
}))

const { closePool } = await import('../../src/db/pool.js')
const { setupTestDatabase, truncateAll } = await import('../helpers/db.js')
const {
  listPushSubscriptions,
  savePushSubscription,
} = await import('../../src/repositories/pushSubscriptions.js')
const { sendToAllSubscriptions } = await import('../../src/push/send.js')

/** web-push rejects with an error carrying the push service's status code. */
function pushError(statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(`push failed with ${statusCode}`), { statusCode })
}

describe('sendToAllSubscriptions', () => {
  beforeAll(async () => {
    await setupTestDatabase()
  })

  beforeEach(async () => {
    await truncateAll()
    sendNotification.mockReset()
    sendNotification.mockResolvedValue(undefined)
  })

  afterAll(async () => {
    await closePool()
  })

  async function seed(...endpoints: string[]) {
    for (const endpoint of endpoints) {
      await savePushSubscription({ endpoint, p256dh: 'key', auth: 'secret' })
    }
  }

  it('sends to every subscription', async () => {
    await seed('https://push.example.com/a', 'https://push.example.com/b')

    const result = await sendToAllSubscriptions({ title: 'Hi', body: 'There' })

    expect(result).toEqual({ sent: 2, pruned: 0, failed: 0 })
    expect(sendNotification).toHaveBeenCalledTimes(2)
  })

  it('sends the payload as JSON with the title, body and url', async () => {
    await seed('https://push.example.com/a')

    await sendToAllSubscriptions({ title: 'Due soon', body: 'Call the dentist', url: '/tasks/1' })

    const payload = JSON.parse(sendNotification.mock.calls[0]![1])
    expect(payload).toEqual({ title: 'Due soon', body: 'Call the dentist', url: '/tasks/1' })
  })

  it('passes the subscription in the shape web-push expects', async () => {
    await seed('https://push.example.com/a')

    await sendToAllSubscriptions({ title: 'Hi', body: 'There' })

    expect(sendNotification.mock.calls[0]![0]).toEqual({
      endpoint: 'https://push.example.com/a',
      keys: { p256dh: 'key', auth: 'secret' },
    })
  })

  it('prunes a subscription the push service reports as gone (410)', async () => {
    await seed('https://push.example.com/dead')
    sendNotification.mockRejectedValue(pushError(410))

    const result = await sendToAllSubscriptions({ title: 'Hi', body: 'There' })

    expect(result).toEqual({ sent: 0, pruned: 1, failed: 0 })
    expect(await listPushSubscriptions()).toEqual([])
  })

  it('prunes on 404 as well', async () => {
    await seed('https://push.example.com/missing')
    sendNotification.mockRejectedValue(pushError(404))

    await sendToAllSubscriptions({ title: 'Hi', body: 'There' })

    expect(await listPushSubscriptions()).toEqual([])
  })

  it('keeps a subscription when the failure is transient (500)', async () => {
    await seed('https://push.example.com/flaky')
    sendNotification.mockRejectedValue(pushError(500))

    const result = await sendToAllSubscriptions({ title: 'Hi', body: 'There' })

    expect(result).toEqual({ sent: 0, pruned: 0, failed: 1 })
    expect(await listPushSubscriptions()).toHaveLength(1)
  })

  it('keeps going after one subscription fails', async () => {
    await seed('https://push.example.com/dead', 'https://push.example.com/live')
    sendNotification
      .mockRejectedValueOnce(pushError(410))
      .mockResolvedValueOnce(undefined)

    const result = await sendToAllSubscriptions({ title: 'Hi', body: 'There' })

    expect(result).toEqual({ sent: 1, pruned: 1, failed: 0 })
    expect(await listPushSubscriptions()).toHaveLength(1)
  })

  it('never throws, even when every send rejects', async () => {
    await seed('https://push.example.com/a')
    sendNotification.mockRejectedValue(new Error('network down'))

    await expect(sendToAllSubscriptions({ title: 'Hi', body: 'There' })).resolves.toEqual({
      sent: 0,
      pruned: 0,
      failed: 1,
    })
  })

  it('is a no-op when there are no subscriptions', async () => {
    const result = await sendToAllSubscriptions({ title: 'Hi', body: 'There' })

    expect(result).toEqual({ sent: 0, pruned: 0, failed: 0 })
    expect(sendNotification).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/push/send.test.ts`
Expected: FAIL — cannot resolve `../../src/push/send.js`.

- [ ] **Step 3: Implement the sender**

`backend/src/push/send.ts`:

```ts
import { webpush } from './webPush.js'
import type { Logger } from '../logger.js'
import {
  deletePushSubscriptionByEndpoint,
  listPushSubscriptions,
} from '../repositories/pushSubscriptions.js'

export interface PushPayload {
  title: string
  body: string
  /** Path or URL the service worker opens when the notification is tapped. */
  url?: string
}

export interface PushResult {
  sent: number
  /** Subscriptions removed because the push service said they no longer exist. */
  pruned: number
  /** Sends that failed for a reason worth retrying next time. */
  failed: number
}

/** Status codes meaning "this endpoint is gone" — the subscription is dead. */
const GONE_STATUS_CODES = new Set([404, 410])

function statusCodeOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const code = (error as { statusCode?: unknown }).statusCode
    if (typeof code === 'number') return code
  }
  return undefined
}

/**
 * Sends one notification to every registered device.
 *
 * Never throws: it is called from cron ticks, and an exception escaping here
 * would take down the scheduler for the life of the process. Failures are
 * counted and logged; the next tick tries again.
 *
 * Subscriptions the push service reports as gone are deleted. That is cleanup,
 * not the resubscribe-nagging the spec rules out for v1 — the user simply
 * re-subscribes next time they open the app.
 */
export async function sendToAllSubscriptions(
  payload: PushPayload,
  logger?: Logger,
): Promise<PushResult> {
  const subscriptions = await listPushSubscriptions()
  const result: PushResult = { sent: 0, pruned: 0, failed: 0 }
  const body = JSON.stringify(payload)

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        body,
      )
      result.sent += 1
    } catch (error) {
      const statusCode = statusCodeOf(error)
      if (statusCode !== undefined && GONE_STATUS_CODES.has(statusCode)) {
        await deletePushSubscriptionByEndpoint(subscription.endpoint)
        result.pruned += 1
        logger?.warn(
          { endpoint: subscription.endpoint, statusCode },
          'pruned a push subscription the service reported as gone',
        )
      } else {
        result.failed += 1
        logger?.warn({ err: error, endpoint: subscription.endpoint }, 'push send failed')
      }
    }
  }

  return result
}
```

- [ ] **Step 4: Run the test, type check, and commit**

Run: `cd backend && npx vitest run tests/push/send.test.ts && npx tsc --noEmit && npm test`
Expected: PASS — 9 tests in the focused file; all green overall.

```bash
git add backend
git commit -m "feat(backend): send web push notifications and prune dead subscriptions"
```

---

## Task 4: Zoned time helpers and the deadline sweep

The first of the two sweeps, plus the timezone helpers both sweeps need.

**Files:**
- Create: `backend/src/scheduler/time.ts`
- Create: `backend/src/scheduler/deadlines.ts`
- Test: `backend/tests/scheduler/time.test.ts`
- Test: `backend/tests/scheduler/deadlines.test.ts`

**Interfaces:**
- Consumes: `listTasksDueForAlert`, `updateTask` (Task 1), `sendToAllSubscriptions` (Task 3), `pushConfig` (Task 2).
- Produces:
  - `interface ZonedNow { date: string; minutesOfDay: number }`
  - `zonedNow(instant: Date, timezone: string): ZonedNow`
  - `parseHhMm(value: string): number`
  - `runDeadlineSweep(options?): Promise<{ alerted: number }>`

- [ ] **Step 1: Write the failing time test**

`backend/tests/scheduler/time.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseHhMm, zonedNow } from '../../src/scheduler/time.js'

describe('parseHhMm', () => {
  it.each([
    ['00:00', 0],
    ['09:00', 540],
    ['09:30', 570],
    ['18:00', 1080],
    ['23:59', 1439],
  ])('parses %s as %i minutes', (value, expected) => {
    expect(parseHhMm(value)).toBe(expected)
  })

  it('throws on a malformed value rather than returning NaN', () => {
    for (const value of ['9:00', 'noon', '25:00', '12:60', '']) {
      expect(() => parseHhMm(value), value).toThrow(/HH:MM/)
    }
  })
})

describe('zonedNow', () => {
  it('reports UTC unchanged', () => {
    const result = zonedNow(new Date('2026-08-11T14:30:00.000Z'), 'UTC')

    expect(result.date).toBe('2026-08-11')
    expect(result.minutesOfDay).toBe(14 * 60 + 30)
  })

  it('shifts into a zone ahead of UTC', () => {
    // 22:30 UTC is 07:30 the NEXT day in Tokyo (UTC+9).
    const result = zonedNow(new Date('2026-08-11T22:30:00.000Z'), 'Asia/Tokyo')

    expect(result.date).toBe('2026-08-12')
    expect(result.minutesOfDay).toBe(7 * 60 + 30)
  })

  it('shifts into a zone behind UTC', () => {
    // 02:30 UTC is 22:30 the PREVIOUS day in New York (UTC-4 in August).
    const result = zonedNow(new Date('2026-08-11T02:30:00.000Z'), 'America/New_York')

    expect(result.date).toBe('2026-08-10')
    expect(result.minutesOfDay).toBe(22 * 60 + 30)
  })

  it('honours daylight saving', () => {
    // London is UTC+1 in August, UTC+0 in January.
    expect(zonedNow(new Date('2026-08-11T12:00:00.000Z'), 'Europe/London').minutesOfDay).toBe(13 * 60)
    expect(zonedNow(new Date('2026-01-11T12:00:00.000Z'), 'Europe/London').minutesOfDay).toBe(12 * 60)
  })

  it('reports midnight as 0, not 1440', () => {
    // A naive hour12:false formatter renders midnight as "24" in some locales.
    expect(zonedNow(new Date('2026-08-11T00:00:00.000Z'), 'UTC').minutesOfDay).toBe(0)
  })

  it('throws on an unknown timezone rather than silently using UTC', () => {
    expect(() => zonedNow(new Date(), 'Mars/Olympus_Mons')).toThrow()
  })
})
```

- [ ] **Step 2: Write the failing deadline test**

`backend/tests/scheduler/deadlines.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const sendToAllSubscriptions = vi.hoisted(() => vi.fn())

vi.mock('../../src/push/send.js', () => ({ sendToAllSubscriptions }))

const { closePool } = await import('../../src/db/pool.js')
const { setupTestDatabase, truncateAll } = await import('../helpers/db.js')
const { createTask, getTask, listTasks } = await import('../../src/repositories/tasks.js')
const { runDeadlineSweep } = await import('../../src/scheduler/deadlines.js')

const minutesFromNow = (minutes: number): Date => new Date(Date.now() + minutes * 60_000)

describe('runDeadlineSweep', () => {
  beforeAll(async () => {
    await setupTestDatabase()
  })

  beforeEach(async () => {
    await truncateAll()
    sendToAllSubscriptions.mockReset()
    sendToAllSubscriptions.mockResolvedValue({ sent: 1, pruned: 0, failed: 0 })
  })

  afterAll(async () => {
    await closePool()
  })

  it('sends one notification per due task and stamps alertedAt', async () => {
    const task = await createTask({ title: 'Call the dentist', dueAt: minutesFromNow(30) })

    const result = await runDeadlineSweep()

    expect(result.alerted).toBe(1)
    expect(sendToAllSubscriptions).toHaveBeenCalledTimes(1)
    expect((await getTask(task.id))?.alertedAt).toBeInstanceOf(Date)
  })

  it('puts the task title in the notification body', async () => {
    await createTask({ title: 'Call the dentist', dueAt: minutesFromNow(30) })

    await runDeadlineSweep()

    const payload = sendToAllSubscriptions.mock.calls[0]![0]
    expect(payload.body).toContain('Call the dentist')
    expect(typeof payload.title).toBe('string')
  })

  it('does not alert the same task twice across sweeps', async () => {
    await createTask({ title: 'Call the dentist', dueAt: minutesFromNow(30) })

    await runDeadlineSweep()
    const second = await runDeadlineSweep()

    expect(second.alerted).toBe(0)
    expect(sendToAllSubscriptions).toHaveBeenCalledTimes(1)
  })

  it('does nothing when no task is due', async () => {
    await createTask({ title: 'Not due yet', dueAt: minutesFromNow(600) })

    const result = await runDeadlineSweep()

    expect(result.alerted).toBe(0)
    expect(sendToAllSubscriptions).not.toHaveBeenCalled()
  })

  it('does not stamp alertedAt when the send fails outright', async () => {
    // If nothing was delivered, the alert should be retried next tick rather
    // than being silently swallowed.
    const task = await createTask({ title: 'Call the dentist', dueAt: minutesFromNow(30) })
    sendToAllSubscriptions.mockResolvedValue({ sent: 0, pruned: 0, failed: 1 })

    const result = await runDeadlineSweep()

    expect(result.alerted).toBe(0)
    expect((await getTask(task.id))?.alertedAt).toBeNull()
  })

  it('stamps alertedAt when there are no subscriptions at all', async () => {
    // Nobody to notify is not a failure — otherwise every task would be
    // re-checked forever on a device-less install.
    const task = await createTask({ title: 'Call the dentist', dueAt: minutesFromNow(30) })
    sendToAllSubscriptions.mockResolvedValue({ sent: 0, pruned: 0, failed: 0 })

    await runDeadlineSweep()

    expect((await getTask(task.id))?.alertedAt).toBeInstanceOf(Date)
  })

  it('keeps going when one task send rejects', async () => {
    await createTask({ title: 'First', dueAt: minutesFromNow(10) })
    await createTask({ title: 'Second', dueAt: minutesFromNow(20) })
    sendToAllSubscriptions
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ sent: 1, pruned: 0, failed: 0 })

    const result = await runDeadlineSweep()

    expect(result.alerted).toBe(1)
    const alerted = (await listTasks()).filter((task) => task.alertedAt !== null)
    expect(alerted.map((task) => task.title)).toEqual(['Second'])
  })

  it('never throws', async () => {
    await createTask({ title: 'Boom', dueAt: minutesFromNow(10) })
    sendToAllSubscriptions.mockRejectedValue(new Error('everything is broken'))

    await expect(runDeadlineSweep()).resolves.toEqual({ alerted: 0 })
  })
})
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `cd backend && npx vitest run tests/scheduler/`
Expected: FAIL — neither `time.js` nor `deadlines.js` can be resolved.

- [ ] **Step 4: Implement the time helpers**

`backend/src/scheduler/time.ts`:

```ts
export interface ZonedNow {
  /** Local calendar date as `YYYY-MM-DD`. */
  date: string
  /** Minutes since local midnight, 0-1439. */
  minutesOfDay: number
}

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/

/** Parses `HH:MM` into minutes since midnight. Throws rather than returning NaN. */
export function parseHhMm(value: string): number {
  const match = HH_MM.exec(value)
  if (match === null) {
    throw new Error(`Expected a time in HH:MM form, got: ${JSON.stringify(value)}`)
  }
  return Number(match[1]) * 60 + Number(match[2])
}

/**
 * Converts an instant into a wall-clock date and minute-of-day in the given
 * IANA zone. Node 22 ships full ICU, so no timezone library is needed.
 *
 * `hourCycle: 'h23'` matters: with `hour12: false` some locales render midnight
 * as "24", which would make midnight sort after every other time of day.
 */
export function zonedNow(instant: Date, timezone: string): ZonedNow {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(instant)) {
    parts[part.type] = part.value
  }

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutesOfDay: Number(parts.hour) * 60 + Number(parts.minute),
  }
}
```

An invalid timezone makes the `Intl.DateTimeFormat` constructor throw a `RangeError`, which is the behavior the test asserts — no explicit validation needed.

- [ ] **Step 5: Implement the deadline sweep**

`backend/src/scheduler/deadlines.ts`:

```ts
import { listTasksDueForAlert, updateTask, type Task } from '../repositories/tasks.js'
import { sendToAllSubscriptions } from '../push/send.js'
import { pushConfig } from '../push/config.js'
import type { Logger } from '../logger.js'

/** A sweep sends at most this many alerts per tick, so a backlog can't stampede. */
const MAX_ALERTS_PER_SWEEP = 20

export interface DeadlineSweepOptions {
  logger?: Logger
  now?: Date
}

function alertBody(task: Task, now: Date): string {
  if (task.dueAt === null) return task.title
  const overdue = task.dueAt.getTime() < now.getTime()
  return overdue ? `Overdue: ${task.title}` : `Due soon: ${task.title}`
}

/**
 * Finds open tasks approaching their deadline, sends one notification each, and
 * stamps `alerted_at` so they never fire again.
 *
 * `alerted_at` is only stamped when the send did not outright fail — a task
 * whose notification could not be delivered is left for the next tick. Having
 * no subscriptions at all is not a failure: otherwise a device-less install
 * would re-examine the same tasks forever.
 *
 * Never throws; the caller is a cron tick.
 */
export async function runDeadlineSweep(
  options: DeadlineSweepOptions = {},
): Promise<{ alerted: number }> {
  const now = options.now ?? new Date()
  let alerted = 0

  try {
    const due = await listTasksDueForAlert(pushConfig.deadlineLeadMinutes, MAX_ALERTS_PER_SWEEP)

    for (const task of due) {
      try {
        const result = await sendToAllSubscriptions(
          {
            title: 'ToDo',
            body: alertBody(task, now),
            url: pushConfig.appUrl,
          },
          options.logger,
        )

        if (result.failed > 0 && result.sent === 0) {
          options.logger?.warn({ taskId: task.id }, 'deadline alert not delivered; will retry')
          continue
        }

        await updateTask(task.id, { alertedAt: now })
        alerted += 1
      } catch (error) {
        options.logger?.warn({ err: error, taskId: task.id }, 'deadline alert failed')
      }
    }

    if (alerted > 0) {
      options.logger?.info({ alerted }, 'deadline alerts sent')
    }
  } catch (error) {
    options.logger?.warn({ err: error }, 'deadline sweep failed')
  }

  return { alerted }
}
```

- [ ] **Step 6: Run the tests, type check, and commit**

Run: `cd backend && npx vitest run tests/scheduler/ && npx tsc --noEmit && npm test`
Expected: PASS — 12 time tests and 8 deadline tests; all green overall.

```bash
git add backend
git commit -m "feat(backend): alert on approaching deadlines"
```

---

## Task 5: Check-in scheduling

The randomized check-in decision, as a pure function, plus the sweep that acts on it.

**Files:**
- Create: `backend/src/scheduler/checkIns.ts`
- Test: `backend/tests/scheduler/checkIns.test.ts`

**Interfaces:**
- Consumes: `zonedNow`, `parseHhMm` (Task 4), `getCheckInSettings`, `recordCheckIn`, `countCheckInsOnLocalDate` (Task 1), `sendToAllSubscriptions` (Task 3), `pushConfig` (Task 2).
- Produces:
  - `shouldSendCheckIn(input): boolean` — pure
  - `runCheckInSweep(options?): Promise<{ sent: boolean }>`

- [ ] **Step 1: Write the failing test**

`backend/tests/scheduler/checkIns.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const sendToAllSubscriptions = vi.hoisted(() => vi.fn())

vi.mock('../../src/push/send.js', () => ({ sendToAllSubscriptions }))

const { closePool } = await import('../../src/db/pool.js')
const { setupTestDatabase, truncateAll } = await import('../helpers/db.js')
const {
  countCheckInsOnLocalDate,
  updateCheckInSettings,
} = await import('../../src/repositories/checkInSettings.js')
const { runCheckInSweep, shouldSendCheckIn } = await import('../../src/scheduler/checkIns.js')

const SETTINGS = {
  enabled: true,
  activeFrom: '09:00',
  activeTo: '18:00',
  checkInsPerDay: 3,
  timezone: 'UTC',
  updatedAt: new Date(),
}

/** 2026-08-11 is a Tuesday; the exact date does not matter, only the clock. */
const at = (hhmm: string): Date => new Date(`2026-08-11T${hhmm}:00.000Z`)

describe('shouldSendCheckIn', () => {
  const base = { settings: SETTINGS, sentToday: 0, tickMinutes: 15, random: () => 0 }

  it('never fires when check-ins are disabled', () => {
    expect(
      shouldSendCheckIn({ ...base, now: at('12:00'), settings: { ...SETTINGS, enabled: false } }),
    ).toBe(false)
  })

  it('never fires before the window opens', () => {
    expect(shouldSendCheckIn({ ...base, now: at('08:59') })).toBe(false)
  })

  it('fires at the moment the window opens', () => {
    expect(shouldSendCheckIn({ ...base, now: at('09:00') })).toBe(true)
  })

  it('never fires at or after the window closes', () => {
    expect(shouldSendCheckIn({ ...base, now: at('18:00') })).toBe(false)
    expect(shouldSendCheckIn({ ...base, now: at('19:00') })).toBe(false)
  })

  it('never fires once the daily quota is met', () => {
    expect(shouldSendCheckIn({ ...base, now: at('12:00'), sentToday: 3 })).toBe(false)
    expect(shouldSendCheckIn({ ...base, now: at('12:00'), sentToday: 4 })).toBe(false)
  })

  it('never fires when the quota is zero', () => {
    expect(
      shouldSendCheckIn({ ...base, now: at('12:00'), settings: { ...SETTINGS, checkInsPerDay: 0 } }),
    ).toBe(false)
  })

  it('is certain to fire when remaining check-ins equal remaining ticks', () => {
    // 17:45 with a 15-minute tick leaves exactly one tick before 18:00.
    expect(
      shouldSendCheckIn({ ...base, now: at('17:45'), sentToday: 2, random: () => 0.999 }),
    ).toBe(true)
  })

  it('respects the RNG in the middle of the window', () => {
    // 09:00-18:00 is 36 ticks; 3 owed => p = 3/36 ≈ 0.083.
    const now = at('09:00')
    expect(shouldSendCheckIn({ ...base, now, random: () => 0.01 })).toBe(true)
    expect(shouldSendCheckIn({ ...base, now, random: () => 0.5 })).toBe(false)
  })

  it('raises the probability as the window runs out', () => {
    const early = at('09:00')
    const late = at('17:00')
    // Same debt, fewer ticks left => a middling RNG draw fires late but not early.
    expect(shouldSendCheckIn({ ...base, now: early, random: () => 0.4 })).toBe(false)
    expect(shouldSendCheckIn({ ...base, now: late, random: () => 0.4 })).toBe(true)
  })

  it('interprets the window in the configured timezone', () => {
    // 12:00 UTC is 08:00 in New York — before a 09:00 local window opens.
    const settings = { ...SETTINGS, timezone: 'America/New_York' }
    expect(shouldSendCheckIn({ ...base, now: at('12:00'), settings })).toBe(false)
    // 14:00 UTC is 10:00 in New York — inside the window.
    expect(shouldSendCheckIn({ ...base, now: at('14:00'), settings, random: () => 0 })).toBe(true)
  })

  it('distributes roughly the requested number of check-ins over a day', () => {
    // A statistical sanity check on the whole schedule, not a single decision.
    let sent = 0
    let random = 12345
    const nextRandom = (): number => {
      // Deterministic LCG so the test never flakes.
      random = (random * 1103515245 + 12345) % 2147483648
      return random / 2147483648
    }

    for (let minutes = 540; minutes < 1080; minutes += 15) {
      const hh = String(Math.floor(minutes / 60)).padStart(2, '0')
      const mm = String(minutes % 60).padStart(2, '0')
      if (shouldSendCheckIn({ ...base, now: at(`${hh}:${mm}`), sentToday: sent, random: nextRandom })) {
        sent += 1
      }
    }

    expect(sent).toBe(3)
  })
})

describe('runCheckInSweep', () => {
  beforeAll(async () => {
    await setupTestDatabase()
  })

  beforeEach(async () => {
    await truncateAll()
    sendToAllSubscriptions.mockReset()
    sendToAllSubscriptions.mockResolvedValue({ sent: 1, pruned: 0, failed: 0 })
  })

  afterAll(async () => {
    await closePool()
  })

  it('sends and records a check-in when the decision says so', async () => {
    const result = await runCheckInSweep({ now: at('09:00'), random: () => 0 })

    expect(result.sent).toBe(true)
    expect(sendToAllSubscriptions).toHaveBeenCalledTimes(1)
    expect(await countCheckInsOnLocalDate('2026-08-11', 'UTC')).toBe(1)
  })

  it('records nothing when the decision says no', async () => {
    const result = await runCheckInSweep({ now: at('03:00'), random: () => 0 })

    expect(result.sent).toBe(false)
    expect(sendToAllSubscriptions).not.toHaveBeenCalled()
    expect(await countCheckInsOnLocalDate('2026-08-11', 'UTC')).toBe(0)
  })

  it('honours settings changed at runtime', async () => {
    await updateCheckInSettings({ enabled: false })

    const result = await runCheckInSweep({ now: at('09:00'), random: () => 0 })

    expect(result.sent).toBe(false)
  })

  it('does not record a check-in when delivery outright failed', async () => {
    sendToAllSubscriptions.mockResolvedValue({ sent: 0, pruned: 0, failed: 1 })

    const result = await runCheckInSweep({ now: at('09:00'), random: () => 0 })

    expect(result.sent).toBe(false)
    expect(await countCheckInsOnLocalDate('2026-08-11', 'UTC')).toBe(0)
  })

  it('never throws', async () => {
    sendToAllSubscriptions.mockRejectedValue(new Error('boom'))

    await expect(runCheckInSweep({ now: at('09:00'), random: () => 0 })).resolves.toEqual({
      sent: false,
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run tests/scheduler/checkIns.test.ts`
Expected: FAIL — cannot resolve `../../src/scheduler/checkIns.js`.

- [ ] **Step 3: Implement the check-in logic**

`backend/src/scheduler/checkIns.ts`:

```ts
import { parseHhMm, zonedNow } from './time.js'
import {
  countCheckInsOnLocalDate,
  getCheckInSettings,
  recordCheckIn,
  type CheckInSettings,
} from '../repositories/checkInSettings.js'
import { sendToAllSubscriptions } from '../push/send.js'
import { pushConfig } from '../push/config.js'
import type { Logger } from '../logger.js'

export interface ShouldSendCheckInInput {
  now: Date
  settings: CheckInSettings
  sentToday: number
  tickMinutes: number
  random: () => number
}

/**
 * Decides whether THIS tick should be one of today's randomized check-ins.
 *
 * Rather than picking times up front, each tick computes the probability that
 * it should fire: `owed / ticksRemaining`. That spreads the day's check-ins
 * uniformly at random across the window, needs no schedule table, survives a
 * restart, and converges — when ticks run out the probability reaches 1, so the
 * remaining check-ins fire rather than being lost.
 *
 * Pure: no clock, no database, no global RNG. That is what makes the whole
 * schedule testable.
 */
export function shouldSendCheckIn(input: ShouldSendCheckInInput): boolean {
  const { now, settings, sentToday, tickMinutes, random } = input

  if (!settings.enabled) return false

  const owed = settings.checkInsPerDay - sentToday
  if (owed <= 0) return false

  const { minutesOfDay } = zonedNow(now, settings.timezone)
  const from = parseHhMm(settings.activeFrom)
  const to = parseHhMm(settings.activeTo)

  if (minutesOfDay < from || minutesOfDay >= to) return false

  const ticksRemaining = Math.ceil((to - minutesOfDay) / tickMinutes)
  if (ticksRemaining <= 0) return false

  return random() < owed / ticksRemaining
}

export interface CheckInSweepOptions {
  logger?: Logger
  now?: Date
  random?: () => number
}

const CHECK_IN_BODY = "How's it going? Anything on your mind?"

/**
 * Runs one check-in decision and, if it fires, sends and records the check-in.
 *
 * The check-in is only recorded when delivery did not outright fail, so a
 * failed send does not consume the day's quota.
 *
 * Never throws; the caller is a cron tick.
 */
export async function runCheckInSweep(
  options: CheckInSweepOptions = {},
): Promise<{ sent: boolean }> {
  const now = options.now ?? new Date()
  const random = options.random ?? Math.random

  try {
    const settings = await getCheckInSettings()
    const { date } = zonedNow(now, settings.timezone)
    const sentToday = await countCheckInsOnLocalDate(date, settings.timezone)

    if (!shouldSendCheckIn({ now, settings, sentToday, tickMinutes: pushConfig.tickMinutes, random })) {
      return { sent: false }
    }

    const result = await sendToAllSubscriptions(
      { title: 'ToDo', body: CHECK_IN_BODY, url: pushConfig.appUrl },
      options.logger,
    )

    if (result.failed > 0 && result.sent === 0) {
      options.logger?.warn({}, 'check-in not delivered; quota not consumed')
      return { sent: false }
    }

    await recordCheckIn()
    options.logger?.info({ sentToday: sentToday + 1 }, 'check-in sent')
    return { sent: true }
  } catch (error) {
    options.logger?.warn({ err: error }, 'check-in sweep failed')
    return { sent: false }
  }
}
```

- [ ] **Step 4: Run the tests, type check, and commit**

Run: `cd backend && npx vitest run tests/scheduler/checkIns.test.ts && npx tsc --noEmit && npm test`
Expected: PASS — 16 tests in the focused file; all green overall.

```bash
git add backend
git commit -m "feat(backend): send randomized check-ins during active hours"
```

---

## Task 6: Cron wiring, routes, and documentation

Starts the scheduler from the server, exposes the endpoints the PWA needs, and documents everything.

**Files:**
- Create: `backend/src/scheduler/index.ts`
- Create: `backend/src/schemas/push.ts`
- Create: `backend/src/routes/push.ts`
- Create: `backend/src/routes/checkInSettings.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/server.ts`
- Modify: `backend/README.md`
- Test: `backend/tests/routes/push.test.ts`
- Test: `backend/tests/routes/checkInSettings.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `startScheduler(logger): void` and `stopScheduler(): void`
  - `GET /push/vapid-public-key` → 200 `{ publicKey }`
  - `POST /push/subscriptions` → 201 `PushSubscription`
  - `DELETE /push/subscriptions` → 204 | 404
  - `POST /push/test` → 200 `{ sent, pruned, failed }`
  - `GET /check-in-settings` → 200 `CheckInSettings`
  - `PATCH /check-in-settings` → 200 `CheckInSettings` | 400

- [ ] **Step 1: Write the failing route tests**

`backend/tests/routes/push.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

const sendToAllSubscriptions = vi.hoisted(() => vi.fn())

vi.mock('../../src/push/send.js', () => ({ sendToAllSubscriptions }))

const { closePool } = await import('../../src/db/pool.js')
const { truncateAll } = await import('../helpers/db.js')
const { authHeaders, buildTestApp } = await import('../helpers/app.js')
const { listPushSubscriptions } = await import('../../src/repositories/pushSubscriptions.js')

const SUBSCRIPTION = {
  endpoint: 'https://push.example.com/abc',
  keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
}

describe('push routes', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildTestApp()
    await app.ready()
  })

  beforeEach(async () => {
    await truncateAll()
    sendToAllSubscriptions.mockReset()
    sendToAllSubscriptions.mockResolvedValue({ sent: 1, pruned: 0, failed: 0 })
  })

  afterAll(async () => {
    await app.close()
    await closePool()
  })

  it('requires auth on every push route', async () => {
    for (const [method, url] of [
      ['GET', '/push/vapid-public-key'],
      ['POST', '/push/subscriptions'],
      ['DELETE', '/push/subscriptions'],
      ['POST', '/push/test'],
    ] as const) {
      const response = await app.inject({ method, url, payload: {} })
      expect(response.statusCode, `${method} ${url}`).toBe(401)
    }
  })

  it('serves the VAPID public key', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/push/vapid-public-key',
      headers: authHeaders(),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().publicKey).toBe('test-vapid-public-key')
  })

  it('stores a subscription in the browser PushSubscription shape', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/push/subscriptions',
      headers: authHeaders(),
      payload: SUBSCRIPTION,
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().endpoint).toBe(SUBSCRIPTION.endpoint)

    const stored = await listPushSubscriptions()
    expect(stored).toHaveLength(1)
    expect(stored[0]!.p256dh).toBe('p256dh-key')
    expect(stored[0]!.auth).toBe('auth-secret')
  })

  it('is idempotent when the same device resubscribes', async () => {
    await app.inject({
      method: 'POST',
      url: '/push/subscriptions',
      headers: authHeaders(),
      payload: SUBSCRIPTION,
    })
    await app.inject({
      method: 'POST',
      url: '/push/subscriptions',
      headers: authHeaders(),
      payload: SUBSCRIPTION,
    })

    expect(await listPushSubscriptions()).toHaveLength(1)
  })

  it('rejects a malformed subscription', async () => {
    for (const payload of [{}, { endpoint: 'https://x' }, { endpoint: 'https://x', keys: {} }]) {
      const response = await app.inject({
        method: 'POST',
        url: '/push/subscriptions',
        headers: authHeaders(),
        payload,
      })
      expect(response.statusCode, JSON.stringify(payload)).toBe(400)
    }
  })

  it('deletes a subscription by endpoint, and 404s when it is not there', async () => {
    await app.inject({
      method: 'POST',
      url: '/push/subscriptions',
      headers: authHeaders(),
      payload: SUBSCRIPTION,
    })

    const first = await app.inject({
      method: 'DELETE',
      url: '/push/subscriptions',
      headers: authHeaders(),
      payload: { endpoint: SUBSCRIPTION.endpoint },
    })
    expect(first.statusCode).toBe(204)

    const second = await app.inject({
      method: 'DELETE',
      url: '/push/subscriptions',
      headers: authHeaders(),
      payload: { endpoint: SUBSCRIPTION.endpoint },
    })
    expect(second.statusCode).toBe(404)
  })

  it('sends a test notification and reports the outcome', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/push/test',
      headers: authHeaders(),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ sent: 1, pruned: 0, failed: 0 })
    expect(sendToAllSubscriptions).toHaveBeenCalledTimes(1)
  })
})
```

`backend/tests/routes/checkInSettings.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { closePool } from '../../src/db/pool.js'
import { truncateAll } from '../helpers/db.js'
import { authHeaders, buildTestApp } from '../helpers/app.js'

describe('/check-in-settings routes', () => {
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
    for (const method of ['GET', 'PATCH'] as const) {
      const response = await app.inject({ method, url: '/check-in-settings', payload: {} })
      expect(response.statusCode, method).toBe(401)
    }
  })

  it('returns the current settings', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/check-in-settings',
      headers: authHeaders(),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      enabled: true,
      activeFrom: '09:00',
      activeTo: '18:00',
      checkInsPerDay: 3,
      timezone: 'UTC',
    })
  })

  it('patches a subset of fields', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/check-in-settings',
      headers: authHeaders(),
      payload: { checkInsPerDay: 5, timezone: 'Europe/London' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().checkInsPerDay).toBe(5)
    expect(response.json().timezone).toBe('Europe/London')
    expect(response.json().activeFrom).toBe('09:00')
  })

  it('rejects a malformed time', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/check-in-settings',
      headers: authHeaders(),
      payload: { activeFrom: '9am' },
    })

    expect(response.statusCode).toBe(400)
  })

  it('rejects an out-of-range check-in count', async () => {
    for (const checkInsPerDay of [-1, 13]) {
      const response = await app.inject({
        method: 'PATCH',
        url: '/check-in-settings',
        headers: authHeaders(),
        payload: { checkInsPerDay },
      })
      expect(response.statusCode, String(checkInsPerDay)).toBe(400)
    }
  })

  it('rejects an unknown timezone rather than storing it', async () => {
    // A bad zone would make every later check-in sweep throw.
    const response = await app.inject({
      method: 'PATCH',
      url: '/check-in-settings',
      headers: authHeaders(),
      payload: { timezone: 'Mars/Olympus_Mons' },
    })

    expect(response.statusCode).toBe(400)
  })

  it('rejects a window whose end is not after its start', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/check-in-settings',
      headers: authHeaders(),
      payload: { activeFrom: '18:00', activeTo: '09:00' },
    })

    expect(response.statusCode).toBe(400)
  })

  it('rejects an empty patch', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/check-in-settings',
      headers: authHeaders(),
      payload: {},
    })

    expect(response.statusCode).toBe(400)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run tests/routes/push.test.ts tests/routes/checkInSettings.test.ts`
Expected: FAIL — every request 404s because nothing is registered.

- [ ] **Step 3: Write the schemas**

`backend/src/schemas/push.ts`:

```ts
import { Type } from '@sinclair/typebox'

/** Matches the browser's PushSubscription.toJSON() shape. */
export const SaveSubscriptionBodySchema = Type.Object(
  {
    endpoint: Type.String({ minLength: 1, maxLength: 2000 }),
    keys: Type.Object(
      {
        p256dh: Type.String({ minLength: 1, maxLength: 500 }),
        auth: Type.String({ minLength: 1, maxLength: 500 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)

export const DeleteSubscriptionBodySchema = Type.Object(
  { endpoint: Type.String({ minLength: 1, maxLength: 2000 }) },
  { additionalProperties: false },
)

export const PushSubscriptionSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  endpoint: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
})

export const VapidKeySchema = Type.Object({ publicKey: Type.String() })

export const PushResultSchema = Type.Object({
  sent: Type.Integer(),
  pruned: Type.Integer(),
  failed: Type.Integer(),
})

const HH_MM_PATTERN = '^([01][0-9]|2[0-3]):[0-5][0-9]$'

export const CheckInSettingsSchema = Type.Object({
  enabled: Type.Boolean(),
  activeFrom: Type.String({ pattern: HH_MM_PATTERN }),
  activeTo: Type.String({ pattern: HH_MM_PATTERN }),
  checkInsPerDay: Type.Integer({ minimum: 0, maximum: 12 }),
  timezone: Type.String(),
  updatedAt: Type.String({ format: 'date-time' }),
})

export const UpdateCheckInSettingsBodySchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    activeFrom: Type.Optional(Type.String({ pattern: HH_MM_PATTERN })),
    activeTo: Type.Optional(Type.String({ pattern: HH_MM_PATTERN })),
    checkInsPerDay: Type.Optional(Type.Integer({ minimum: 0, maximum: 12 })),
    timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  },
  { additionalProperties: false, minProperties: 1 },
)
```

Note the subscription response deliberately omits `p256dh` and `auth`: they are the device's encryption material and the client already has them. There is no reason to hand them back.

- [ ] **Step 4: Write the push routes**

`backend/src/routes/push.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'
import {
  DeleteSubscriptionBodySchema,
  PushResultSchema,
  PushSubscriptionSchema,
  SaveSubscriptionBodySchema,
  VapidKeySchema,
} from '../schemas/push.js'
import { ErrorSchema } from '../schemas/task.js'
import { pushConfig } from '../push/config.js'
import { sendToAllSubscriptions } from '../push/send.js'
import {
  deletePushSubscriptionByEndpoint,
  savePushSubscription,
  type PushSubscriptionRecord,
} from '../repositories/pushSubscriptions.js'

function toResponse(record: PushSubscriptionRecord) {
  // p256dh and auth are the device's own encryption material — the client
  // already has them, and there is no reason to echo them back.
  return {
    id: record.id,
    endpoint: record.endpoint,
    createdAt: record.createdAt.toISOString(),
  }
}

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  const typedApp = app.withTypeProvider<TypeBoxTypeProvider>()

  typedApp.get(
    '/push/vapid-public-key',
    {
      onRequest: app.requireAuth,
      schema: { response: { 200: VapidKeySchema, 401: ErrorSchema } },
    },
    async () => ({ publicKey: pushConfig.publicKey }),
  )

  typedApp.post(
    '/push/subscriptions',
    {
      onRequest: app.requireAuth,
      schema: {
        body: SaveSubscriptionBodySchema,
        response: { 201: PushSubscriptionSchema, 400: ErrorSchema, 401: ErrorSchema },
      },
    },
    async (request, reply) => {
      const saved = await savePushSubscription({
        endpoint: request.body.endpoint,
        p256dh: request.body.keys.p256dh,
        auth: request.body.keys.auth,
      })
      return reply.code(201).send(toResponse(saved))
    },
  )

  typedApp.delete(
    '/push/subscriptions',
    {
      onRequest: app.requireAuth,
      schema: {
        body: DeleteSubscriptionBodySchema,
        response: { 204: Type.Null(), 400: ErrorSchema, 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const deleted = await deletePushSubscriptionByEndpoint(request.body.endpoint)
      if (!deleted) return reply.code(404).send({ error: 'Subscription not found' })
      return reply.code(204).send(null)
    },
  )

  typedApp.post(
    '/push/test',
    {
      onRequest: app.requireAuth,
      schema: { response: { 200: PushResultSchema, 401: ErrorSchema } },
    },
    async (request) =>
      // Verifying push end to end on iOS is fiddly enough that a deliberate
      // test send is worth the endpoint.
      sendToAllSubscriptions(
        { title: 'ToDo', body: 'Test notification — push is working.', url: pushConfig.appUrl },
        request.log,
      ),
  )
}
```

- [ ] **Step 5: Write the settings routes**

`backend/src/routes/checkInSettings.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  CheckInSettingsSchema,
  UpdateCheckInSettingsBodySchema,
} from '../schemas/push.js'
import { ErrorSchema } from '../schemas/task.js'
import { parseHhMm } from '../scheduler/time.js'
import {
  getCheckInSettings,
  updateCheckInSettings,
  type CheckInSettings,
} from '../repositories/checkInSettings.js'

function toResponse(settings: CheckInSettings) {
  return { ...settings, updatedAt: settings.updatedAt.toISOString() }
}

/** A zone the runtime doesn't know would make every later sweep throw. */
function isKnownTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

export async function checkInSettingsRoutes(app: FastifyInstance): Promise<void> {
  const typedApp = app.withTypeProvider<TypeBoxTypeProvider>()

  typedApp.get(
    '/check-in-settings',
    {
      onRequest: app.requireAuth,
      schema: { response: { 200: CheckInSettingsSchema, 401: ErrorSchema } },
    },
    async () => toResponse(await getCheckInSettings()),
  )

  typedApp.patch(
    '/check-in-settings',
    {
      onRequest: app.requireAuth,
      schema: {
        body: UpdateCheckInSettingsBodySchema,
        response: { 200: CheckInSettingsSchema, 400: ErrorSchema, 401: ErrorSchema },
      },
    },
    async (request, reply) => {
      const patch = request.body

      if (patch.timezone !== undefined && !isKnownTimezone(patch.timezone)) {
        return reply.code(400).send({ error: 'timezone is not a known IANA zone' })
      }

      // The window's ends can be patched independently, so validate the merged
      // result rather than only what was sent.
      const current = await getCheckInSettings()
      const from = parseHhMm(patch.activeFrom ?? current.activeFrom)
      const to = parseHhMm(patch.activeTo ?? current.activeTo)
      if (from >= to) {
        return reply.code(400).send({ error: 'activeFrom must be earlier than activeTo' })
      }

      return toResponse(await updateCheckInSettings(patch))
    },
  )
}
```

- [ ] **Step 6: Write the cron wiring**

`node-cron`'s major versions have shifted their exports. If `import cron, { type ScheduledTask } from 'node-cron'` does not typecheck against the installed version, read the package's own `.d.ts` and use whatever it actually exports — do not reach for a cast. Report which form you used and what the type error was.

`backend/src/scheduler/index.ts`:

```ts
import cron, { type ScheduledTask } from 'node-cron'
import { pushConfig } from '../push/config.js'
import { runDeadlineSweep } from './deadlines.js'
import { runCheckInSweep } from './checkIns.js'
import type { Logger } from '../logger.js'

let task: ScheduledTask | undefined

/**
 * Starts the in-process scheduler.
 *
 * Called from server.ts, NOT from buildApp() — a cron tick firing inside the
 * test suite would make tests non-deterministic and could send real pushes.
 *
 * Each tick runs both sweeps. Neither throws by contract, but the whole tick is
 * wrapped anyway: an exception escaping here would kill the cron job for the
 * life of the process.
 */
export function startScheduler(logger: Logger): void {
  if (task !== undefined) return

  const expression = `*/${pushConfig.tickMinutes} * * * *`
  logger.info({ expression }, 'starting scheduler')

  task = cron.schedule(expression, () => {
    void (async () => {
      try {
        await runDeadlineSweep({ logger })
        await runCheckInSweep({ logger })
      } catch (error) {
        logger.warn({ err: error }, 'scheduler tick failed')
      }
    })()
  })
}

export function stopScheduler(): void {
  task?.stop()
  task = undefined
}
```

- [ ] **Step 7: Register the routes and start the scheduler**

In `backend/src/app.ts`, add the imports and register the new route modules after the existing ones:

```ts
import { pushRoutes } from './routes/push.js'
import { checkInSettingsRoutes } from './routes/checkInSettings.js'
```

```ts
  await app.register(pushRoutes)
  await app.register(checkInSettingsRoutes)
```

In `backend/src/server.ts`, start the scheduler after the server is listening and stop it on shutdown:

```ts
import { startScheduler, stopScheduler } from './scheduler/index.js'
```

After the successful `app.listen(...)`:

```ts
startScheduler(app.log)
```

And in the signal handler, before `app.close()`:

```ts
    stopScheduler()
```

- [ ] **Step 8: Run the route tests**

Run: `cd backend && npx vitest run tests/routes/push.test.ts tests/routes/checkInSettings.test.ts`
Expected: PASS — 7 push tests and 8 settings tests.

- [ ] **Step 9: Update the README**

Add to the setup section: generating VAPID keys with `npm run vapid:generate`, the four new required environment variables (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `APP_URL`), and the two optional ones (`DEADLINE_LEAD_MINUTES`, `SCHEDULER_TICK_MINUTES`). State plainly that regenerating VAPID keys invalidates every existing subscription.

Extend the endpoint table:

| Method | Path | Body | Success |
| --- | --- | --- | --- |
| GET | `/push/vapid-public-key` | — | 200 `{publicKey}` |
| POST | `/push/subscriptions` | browser `PushSubscription` JSON | 201 |
| DELETE | `/push/subscriptions` | `{endpoint}` | 204 / 404 |
| POST | `/push/test` | — | 200 `{sent, pruned, failed}` |
| GET | `/check-in-settings` | — | 200 |
| PATCH | `/check-in-settings` | partial settings | 200 / 400 |

Add a "Scheduler" section covering: that it runs in-process on a `node-cron` tick every `SCHEDULER_TICK_MINUTES`; that it is started from `server.ts` and therefore never runs during tests; that deadline alerts fire once per task and are made idempotent by `alerted_at`, including for tasks already overdue when the service starts; that check-ins are randomized across the active window using the probability approach, so the count per day is the target rather than a guarantee; that the window is interpreted in the configured IANA timezone and does not support wrapping past midnight; and that subscriptions returning 404/410 are pruned automatically while other failures are logged and retried next tick.

Document the CheckInSettings shape, and note that `POST /push/test` exists precisely because verifying push on iOS is fiddly.

Verify every claim against the shipped code before committing.

- [ ] **Step 10: Full verification and commit**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: no type errors; all green.

```bash
git add backend
git commit -m "feat(backend): wire the scheduler and expose push and check-in routes"
```

---

## Definition of Done

- [ ] `cd backend && npm test` passes, with no test sending a real push and no cron tick firing during the suite.
- [ ] `cd backend && npx tsc --noEmit` reports no errors, with no `as any`, `as never`, `@ts-ignore`, or `@ts-expect-error` in `src/`.
- [ ] `npm run migrate` applies `003_scheduler_push.sql` and is a no-op on re-run — **with no VAPID variables set**.
- [ ] `npm run vapid:generate` prints a usable keypair.
- [ ] With a real `.env` and the server running: `GET /push/vapid-public-key` returns the configured key; `PATCH /check-in-settings` round-trips; `POST /push/test` returns `{sent: 0, pruned: 0, failed: 0}` with no subscriptions registered.
- [ ] Setting `SCHEDULER_TICK_MINUTES=1` and creating a task due within the lead window results in exactly one `alerted_at` stamp, and no second stamp on later ticks.

## What This Plan Deliberately Leaves Out

- **Frontend PWA** — the service worker that receives these notifications, the subscribe/unsubscribe UI, the settings screen, and CORS. This plan produces the API those need.
- **Deployment** — production Docker, Caddy, VPS, and keeping the process alive so the in-process cron actually runs. Note for that plan: an in-process scheduler means the service must not be scaled to more than one instance, or every alert fires N times.
- **Rich notification actions** — the spec rules them out for v1; payloads carry title, body, and URL only.
- **Resubscribe nagging** — ruled out for v1. Dead subscriptions are pruned silently; the user re-subscribes next time they open the app.
- **Windows that wrap past midnight** — the `active_from < active_to` CHECK makes this explicit rather than silently misbehaving. A night-shift user would need a follow-up.
- **Per-task alert lead times** — one global `DEADLINE_LEAD_MINUTES`.
