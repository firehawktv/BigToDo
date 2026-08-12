# Frontend PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-page React app, installable to an iPhone home screen, that is the only client of the backend built in plans 1–3: capture text, review parsed tasks, ask "what can I get done in N minutes," opt into an AI breakdown, and receive Web Push notifications — all from one bearer token entered once and stored on the device.

**Architecture:** Vite + React 18 + TypeScript, no server-side rendering — this is a pure static bundle served by Caddy in the deployment plan. A single `apiClient.ts` wraps every backend call, attaches the bearer token, and is the only module that knows the wire shapes from `backend/README.md`. Local state lives in React Query, which owns caching, refetch-on-focus, and optimistic updates for task mutations — there is no separate global store. A service worker (built with `vite-plugin-pwa`) handles installability and the `push`/`notificationclick` events; it does not do offline caching of API data, matching the backend's one-way-source-of-truth design. Routing is a handful of screens, not a router library — `useState` on an enum is enough for this app's size.

**Tech Stack:** Vite 5, React 18, TypeScript 5 (strict), `@tanstack/react-query` 5, `vite-plugin-pwa` (Workbox under the hood), Vitest + `@testing-library/react` for component tests, `msw` (Mock Service Worker) for API mocking in tests — chosen because it intercepts at the network layer, so components use the real `fetch`-based `apiClient` in tests exactly as in production, rather than a hand-mocked client.

## Global Constraints

- **This plan builds on `2026-08-11-backend-foundation.md`, `2026-08-11-ai-capture-breakdown.md`, and `2026-08-11-scheduler-push.md`.** All three are complete on this branch. `backend/README.md` is the API reference this plan is written from — Task 1 re-verifies every claim in it against the live server before any UI code is written, because a frontend built against a stale doc wastes the whole plan.
- **Single-user only.** No login flow, no user switching, no multi-account UI. The token is entered once in a settings screen and stored in `localStorage`. There is no token refresh, no expiry handling beyond a 401 sending the user back to token entry.
- **No native app, no App Store.** Installability is via the web manifest + service worker (Add to Home Screen). This is the *only* client — no separate native codebase exists or will exist for v1.
- **No offline-first support.** The backend's sync model is one-way: Postgres is canonical, the client always reads/writes through the API. If the network is down, the app shows an error state, not stale cached data presented as current. React Query's cache is a performance optimization (avoid refetching on every tab focus), not an offline data store.
- **No CORS configuration in this plan.** The dev server proxies API requests same-origin during development (Vite's `server.proxy`), and production serves the frontend and backend behind the same Caddy origin — that reverse-proxy setup is deployment plan 5's job. This plan's `apiClient.ts` therefore always calls a relative `/api/...` path in production and a proxied path in dev; it never hardcodes a cross-origin URL.
- **iOS PWA push has real constraints this plan must respect**, because the product's whole notification feature depends on getting them right:
  - Web Push on iOS requires the app to be installed to the home screen first (Safari's in-tab PWA does not support the Push API at all, only the standalone installed version does).
  - Notification permission can only be requested from a user gesture (a button tap), never on page load.
  - `POST /push/test` exists in the backend specifically because this is fiddly to verify — the settings screen must surface it as a real, labeled "Send test notification" button, not bury it.
- Enum values from the backend are exactly, lowercase: task `status` ∈ {`open`, `done`}; `priority` ∈ {`low`, `medium`, `high`}; `source` ∈ {`manual`, `ai_parsed`, `ai_breakdown`}; capture batch `parseStatus` ∈ {`pending`, `parsed`, `failed`}. The frontend must not invent additional values or reorder the priority ladder — `high` > `medium` > `low` visually matches the backend's `ORDER BY priority DESC`.
- Timestamps from the API are ISO-8601 UTC strings; render them in the browser's local timezone. `check_in_settings.timezone` is a separate, explicit IANA zone the user sets for *when check-ins fire*, independent of the browser's own timezone — do not conflate the two.
- No `as any` in TypeScript application code (test files that need to reach into `msw` internals are the one exception, and even there prefer a real type). `strict: true` in `tsconfig.json`.
- All work happens under a new `frontend/` directory at the repo root, sibling to `backend/`.
- **Tests never hit the real backend.** Every component/hook test mocks the network via `msw`; there is no test that requires Postgres, Docker, or a running Fastify process. (Contrast with the backend plans, where tests ran against real Postgres — the frontend has no database of its own to be real about.)

---

## Task 0 (verification, not a build step): Confirm the API surface is what the README says

Before writing a line of UI code, this plan's biggest risk is that `backend/README.md` — accurate when plan 3 shipped — has drifted, or that a detail (exact error shape, exact field name) was summarized imprecisely in prose. This task is a single subagent dispatch that starts the real backend and exercises every endpoint this plan depends on, comparing the *actual* response against what's about to be assumed. It produces no application code; it produces a confirmed contract, or a list of discrepancies to resolve before Task 1 starts.

**Files:** none created; a scratch script is fine and not committed.

- [ ] **Step 1: Start the backend for real and hit every endpoint this plan uses**

From the repo root, with Docker running:

```bash
cd backend
docker compose -f docker-compose.dev.yml up -d
npm run migrate
API_TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
echo "API_TOKEN=$API_TOKEN"
# .env must also have a real or throwaway ANTHROPIC_API_KEY and VAPID_* set —
# see backend/README.md's Setup and Web Push setup sections for exact steps,
# including `npm run vapid:generate`.
npm run dev
```

In a second terminal, with `$API_TOKEN` exported, `curl` (or `httpie`) each of:

- `GET /health` (no auth)
- `POST /tasks`, `GET /tasks`, `GET /tasks/:id`, `PATCH /tasks/:id`, `DELETE /tasks/:id`
- `GET /tasks/available?minutes=20`
- `POST /capture` with a plain dump, and again with `"I have 20 minutes"`
- `POST /capture-batches/:id/parse` on a batch left `pending`
- `POST /tasks/:id/breakdown` and `POST /tasks/:id/subtasks`
- `GET /push/vapid-public-key`, `POST /push/subscriptions` (a fabricated but well-formed body — a real browser subscription isn't available from `curl`), `DELETE /push/subscriptions`, `POST /push/test`
- `GET /check-in-settings`, `PATCH /check-in-settings`

For each, record: exact request, exact response body, exact status code.

- [ ] **Step 2: Diff against `backend/README.md` and this plan's assumptions**

Specifically confirm:
- The `Task` shape's exact field list and types (Task 1's TypeScript types are generated from this).
- Whether `401` on every protected route is genuinely `{"error":"Unauthorized"}` with no other shape (confirms the frontend's single 401-handling code path is sufficient).
- Whether `POST /capture`'s two response shapes (`{type:'shortlist',...}` vs `{type:'batch',...}`) really are discriminated only by `type`, with no other field needed to tell them apart.
- The exact `CheckInSettings` shape and whether `PATCH` genuinely accepts a partial body.
- Whether a malformed request body really does return `400` with an `{error: string}` shape consistently across routes (confirms one generic validation-error handler suffices).

- [ ] **Step 3: Report and resolve**

If everything matches, proceed to Task 1 with no changes. If anything differs, **stop and fix the discrepancy at its source** — either the backend has a bug (fix it there, it's cheap since the backend plans are done and reviewed) or the README is stale (fix the README) — before writing any frontend code against the wrong assumption. Do not silently code around a documented-but-wrong behavior.

---

## Task 1: Project scaffolding, API client, and auth screen

Sets up the Vite/React/TypeScript workspace, the typed API client every later task depends on, and the token-entry screen that gates the whole app. Deliverable: a running dev server that shows a token entry screen, accepts a token, stores it, and can make one authenticated request.

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`, `frontend/tsconfig.node.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/vitest.config.ts`
- Create: `frontend/.gitignore`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/api/types.ts`
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/api/errors.ts`
- Create: `frontend/src/auth/useAuthToken.ts`
- Create: `frontend/src/auth/TokenGate.tsx`
- Create: `frontend/tests/setup.ts`
- Create: `frontend/tests/mocks/handlers.ts`
- Create: `frontend/tests/mocks/server.ts`
- Test: `frontend/tests/api/client.test.ts`
- Test: `frontend/tests/auth/TokenGate.test.tsx`

**Interfaces:**
- Consumes: the confirmed contract from Task 0.
- Produces:
  - `interface Task { id: string; title: string; notes: string | null; status: 'open' | 'done'; priority: 'low' | 'medium' | 'high'; dueAt: string | null; estimatedMinutes: number | null; parentTaskId: string | null; captureBatchId: string | null; source: 'manual' | 'ai_parsed' | 'ai_breakdown'; suggestBreakdown: boolean; alertedAt: string | null; createdAt: string; completedAt: string | null }`
  - `interface CaptureBatch { id: string; rawText: string; parseStatus: 'pending' | 'parsed' | 'failed'; parseError: string | null; createdAt: string }`
  - `interface CheckInSettings { enabled: boolean; activeFrom: string; activeTo: string; checkInsPerDay: number; timezone: string; updatedAt: string }`
  - `class ApiError extends Error { status: number; body: unknown }`
  - `getAuthToken(): string | null`, `setAuthToken(token: string): void`, `clearAuthToken(): void` (thin `localStorage` wrappers, key `'todo:apiToken'`)
  - `apiFetch<T>(path: string, init?: RequestInit): Promise<T>` — attaches `Authorization: Bearer <token>`, throws `ApiError` on non-2xx (parsing the `{error}` body when present), and — critically for Task 3 — **calls `clearAuthToken()` and triggers a re-render back to the token screen on a 401**, since a 401 anywhere means the stored token is wrong or was rotated.
  - `<TokenGate>` — renders children only when a token is present; otherwise renders the entry form. This is the root of `<App>`.

- [ ] **Step 1: Scaffold the workspace**

```bash
cd /Users/cooney/Projects/ToDoApp/.claude/worktrees/backend-foundation
mkdir -p frontend/src/{api,auth,components,tasks,capture,settings,push} frontend/tests/{api,auth,mocks}
cd frontend
npm create vite@latest . -- --template react-ts
```

Accept the scaffold, then install the extra dependencies:

```bash
npm install @tanstack/react-query
npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom msw vite-plugin-pwa
```

- [ ] **Step 2: Configure TypeScript strictly and wire Vitest**

`frontend/tsconfig.json` — Vite's template ships a reasonable baseline; ensure `"strict": true` and `"noUncheckedIndexedAccess": true` are set (add them if the scaffold omitted either).

`frontend/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: false,
  },
})
```

Add to `frontend/package.json`'s scripts:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Set up the MSW mock server (used by every later test in this plan)**

`frontend/tests/mocks/handlers.ts`:

```ts
import { http, HttpResponse } from 'msw'

/**
 * Default handlers for the happy path of every endpoint this app calls.
 * Individual tests override one handler at a time with `server.use(...)`
 * for the case they're actually testing — this file is the baseline, not
 * an attempt to model every response shape.
 */
export const handlers = [
  http.get('/api/health', () => HttpResponse.json({ status: 'ok' })),
]
```

`frontend/tests/mocks/server.ts`:

```ts
import { setupServer } from 'msw/node'
import { handlers } from './handlers.js'

export const server = setupServer(...handlers)
```

`frontend/tests/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './mocks/server.js'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// A predictable, non-empty token so tests don't have to set one up per file
// unless they're specifically testing the token-entry flow itself.
localStorage.setItem('todo:apiToken', 'test-token-0123456789abcdef0123456789')
```

`onUnhandledRequest: 'error'` is deliberate: a component test that fires a request nobody mocked should fail loudly, not silently pass with `undefined` data.

- [ ] **Step 4: Write the failing API client tests**

`frontend/tests/api/client.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { apiFetch } from '../../src/api/client.js'
import { ApiError } from '../../src/api/errors.js'
import { clearAuthToken, setAuthToken } from '../../src/auth/useAuthToken.js'

describe('apiFetch', () => {
  beforeEach(() => {
    setAuthToken('test-token-0123456789abcdef0123456789')
  })

  it('attaches the bearer token to every request', async () => {
    let receivedAuth: string | null = null
    server.use(
      http.get('/api/tasks', ({ request }) => {
        receivedAuth = request.headers.get('authorization')
        return HttpResponse.json({ tasks: [] })
      }),
    )

    await apiFetch('/tasks')

    expect(receivedAuth).toBe('Bearer test-token-0123456789abcdef0123456789')
  })

  it('returns the parsed JSON body on success', async () => {
    server.use(http.get('/api/tasks', () => HttpResponse.json({ tasks: [{ id: '1' }] })))

    const result = await apiFetch<{ tasks: unknown[] }>('/tasks')

    expect(result.tasks).toHaveLength(1)
  })

  it('throws ApiError with the status and parsed error body on a 4xx', async () => {
    server.use(
      http.post('/api/tasks', () =>
        HttpResponse.json({ error: 'title must not be blank' }, { status: 400 }),
      ),
    )

    await expect(apiFetch('/tasks', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      status: 400,
      body: { error: 'title must not be blank' },
    })
  })

  it('clears the stored token and rejects on a 401', async () => {
    server.use(http.get('/api/tasks', () => HttpResponse.json({ error: 'Unauthorized' }, { status: 401 })))

    await expect(apiFetch('/tasks')).rejects.toMatchObject({ status: 401 })

    expect(localStorage.getItem('todo:apiToken')).toBeNull()
  })

  it('throws ApiError on a network failure with no response, rather than an unhandled rejection type', async () => {
    server.use(http.get('/api/tasks', () => HttpResponse.error()))

    await expect(apiFetch('/tasks')).rejects.toBeInstanceOf(ApiError)
  })

  afterEach(() => {
    setAuthToken('test-token-0123456789abcdef0123456789') // restore for later tests
  })
})

describe('useAuthToken helpers', () => {
  afterEach(() => {
    setAuthToken('test-token-0123456789abcdef0123456789')
  })

  it('round-trips a token through localStorage', () => {
    setAuthToken('abc123')
    expect(localStorage.getItem('todo:apiToken')).toBe('abc123')
  })

  it('returns null when nothing is stored', () => {
    clearAuthToken()
    expect(localStorage.getItem('todo:apiToken')).toBeNull()
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/api/client.test.ts`
Expected: FAIL — `src/api/client.ts` does not exist.

- [ ] **Step 6: Implement the auth token store**

`frontend/src/auth/useAuthToken.ts`:

```ts
const STORAGE_KEY = 'todo:apiToken'

export function getAuthToken(): string | null {
  return localStorage.getItem(STORAGE_KEY)
}

export function setAuthToken(token: string): void {
  localStorage.setItem(STORAGE_KEY, token)
}

export function clearAuthToken(): void {
  localStorage.removeItem(STORAGE_KEY)
}
```

(A `useAuthToken()` React hook that makes `TokenGate` reactive to token changes is added in Step 8 — these three functions are the storage primitive underneath it.)

- [ ] **Step 7: Implement the error type and the client**

`frontend/src/api/errors.ts`:

```ts
export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `API request failed with status ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}
```

`frontend/src/api/client.ts`:

```ts
import { ApiError } from './errors.js'
import { clearAuthToken, getAuthToken } from '../auth/useAuthToken.js'

/**
 * All requests go through /api/... — same-origin in production (Caddy
 * proxies it to the backend) and proxied by Vite's dev server in
 * development (see vite.config.ts). Never hardcode a cross-origin URL here;
 * CORS configuration is deliberately out of scope for this plan.
 */
const API_BASE = '/api'

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAuthToken()
  const headers = new Headers(init.headers)
  if (token !== null) headers.set('Authorization', `Bearer ${token}`)
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers })
  } catch (cause) {
    // A network failure (offline, DNS, connection refused) never reaches the
    // backend at all — there is no status code, so this is not an ApiError
    // in the usual "the server said no" sense, but callers should still be
    // able to catch one error type rather than branch on TypeError vs ApiError.
    throw new ApiError(0, null, 'Network request failed')
  }

  if (response.status === 401) {
    // A 401 anywhere means the stored token is wrong (never valid, or
    // rotated server-side). Clearing it here — rather than in every caller —
    // is what sends the whole app back to the token-entry screen; see
    // TokenGate's useAuthToken() subscription in Step 8.
    clearAuthToken()
  }

  if (!response.ok) {
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      // Non-JSON error body (e.g. a proxy's own HTML error page) — body
      // stays null, status is still meaningful to the caller.
    }
    throw new ApiError(response.status, body)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}
```

- [ ] **Step 8: Run the client test, then write the TokenGate test**

Run: `cd frontend && npx vitest run tests/api/client.test.ts`
Expected: PASS — 7 tests.

`frontend/tests/auth/TokenGate.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TokenGate } from '../../src/auth/TokenGate.js'
import { clearAuthToken } from '../../src/auth/useAuthToken.js'

describe('TokenGate', () => {
  afterEach(() => {
    localStorage.setItem('todo:apiToken', 'test-token-0123456789abcdef0123456789')
  })

  it('renders children when a token is already stored', () => {
    render(
      <TokenGate>
        <div>Protected content</div>
      </TokenGate>,
    )

    expect(screen.getByText('Protected content')).toBeInTheDocument()
  })

  it('shows the token entry form when no token is stored', () => {
    clearAuthToken()

    render(
      <TokenGate>
        <div>Protected content</div>
      </TokenGate>,
    )

    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/access token/i)).toBeInTheDocument()
  })

  it('stores the token and reveals children after a valid submission', async () => {
    clearAuthToken()
    const user = userEvent.setup()

    render(
      <TokenGate>
        <div>Protected content</div>
      </TokenGate>,
    )

    await user.type(screen.getByLabelText(/access token/i), 'my-real-token')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(screen.getByText('Protected content')).toBeInTheDocument()
    expect(localStorage.getItem('todo:apiToken')).toBe('my-real-token')
  })

  it('does not submit a blank token', async () => {
    clearAuthToken()
    const user = userEvent.setup()

    render(
      <TokenGate>
        <div>Protected content</div>
      </TokenGate>,
    )

    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 9: Run the TokenGate test to verify it fails**

Run: `cd frontend && npx vitest run tests/auth/TokenGate.test.tsx`
Expected: FAIL — `src/auth/TokenGate.tsx` does not exist.

- [ ] **Step 10: Implement TokenGate**

`frontend/src/auth/TokenGate.tsx`:

```tsx
import { type FormEvent, type ReactNode, useState, useSyncExternalStore } from 'react'
import { getAuthToken, setAuthToken } from './useAuthToken.js'

const listeners = new Set<() => void>()

/**
 * Fires whenever the stored token changes — including apiFetch's own
 * clearAuthToken() on a 401, from anywhere in the app, not just this file.
 * useSyncExternalStore subscribing to this is what makes a 401 deep inside
 * a task mutation immediately bounce the whole app back to this screen.
 */
function notifyTokenChanged(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function useToken(): string | null {
  return useSyncExternalStore(subscribe, getAuthToken)
}

export function TokenGate({ children }: { children: ReactNode }): ReactNode {
  const token = useToken()
  const [draft, setDraft] = useState('')

  if (token !== null) return children

  function handleSubmit(event: FormEvent): void {
    event.preventDefault()
    const trimmed = draft.trim()
    if (trimmed === '') return
    setAuthToken(trimmed)
    notifyTokenChanged()
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="api-token">Access token</label>
      <input
        id="api-token"
        type="password"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        autoComplete="off"
      />
      <button type="submit">Continue</button>
    </form>
  )
}
```

`useAuthToken.ts` from Step 6 needs one addition — export `notifyTokenChanged` so `client.ts`'s 401 handler can call it (otherwise `clearAuthToken()` updates storage but the UI never re-renders):

```ts
export { notifyTokenChanged } from '../auth/TokenGate.js' // circular — see below
```

Actually avoid the circular import: move `notifyTokenChanged`, `subscribe`, and the `listeners` set into `useAuthToken.ts` itself (it's the module that owns the storage, so it should own the subscription too), and have `TokenGate.tsx` import `useSyncExternalStore`'s subscribe/getSnapshot pair from there instead of defining them locally. Update `client.ts`'s 401 branch to call the exported `notifyTokenChanged()` after `clearAuthToken()`. Restructure Steps 6 and 10's code accordingly before implementing — this is a correction to the plan's own sketch, not an optional cleanup.

- [ ] **Step 11: Run both tests, then wire `main.tsx`/`App.tsx`**

Run: `cd frontend && npx vitest run tests/api/client.test.ts tests/auth/TokenGate.test.tsx`
Expected: PASS — 11 tests total.

`frontend/src/App.tsx` (minimal for now — later tasks add screens):

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TokenGate } from './auth/TokenGate.js'

const queryClient = new QueryClient()

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TokenGate>
        <div>Signed in. Screens arrive in later tasks.</div>
      </TokenGate>
    </QueryClientProvider>
  )
}
```

`frontend/src/main.tsx` — the Vite scaffold already has something close to this; adjust to import `App` from `./App.js` and mount as usual.

- [ ] **Step 12: Configure the dev proxy**

`frontend/vite.config.ts` needs a proxy so `/api/*` in development reaches the real backend (started per Task 0) without a CORS request ever happening:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
```

- [ ] **Step 13: Run the full suite and type check, then commit**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: no type errors; all green.

```bash
cd /Users/cooney/Projects/ToDoApp/.claude/worktrees/backend-foundation
git add frontend
git commit -m "feat(frontend): scaffold Vite/React app with API client and token gate"
```

---

## Task 2: Task list, creation, and editing

The core CRUD screen: see open tasks, create one, edit one, mark done, delete. Deliverable: a usable single-user task list backed by React Query and the real API shapes.

**Files:**
- Create: `frontend/src/tasks/useTasks.ts`
- Create: `frontend/src/tasks/TaskList.tsx`
- Create: `frontend/src/tasks/TaskItem.tsx`
- Create: `frontend/src/tasks/TaskForm.tsx`
- Create: `frontend/src/tasks/TaskDetail.tsx`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/tests/tasks/useTasks.test.tsx`
- Test: `frontend/tests/tasks/TaskList.test.tsx`
- Test: `frontend/tests/tasks/TaskForm.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `Task` (Task 1).
- Produces:
  - `useTasksQuery(filter?: { status?: 'open' | 'done' }): UseQueryResult<Task[]>`
  - `useCreateTask(): UseMutationResult<Task, ApiError, CreateTaskInput>`
  - `useUpdateTask(): UseMutationResult<Task, ApiError, { id: string; patch: Partial<...> }>`
  - `useDeleteTask(): UseMutationResult<void, ApiError, string>`
  - `<TaskList>`, `<TaskItem>`, `<TaskForm>`, `<TaskDetail>` — presentational components consuming the above hooks.

- [ ] **Step 1: Write the failing hook tests**

`frontend/tests/tasks/useTasks.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { server } from '../mocks/server.js'
import { useCreateTask, useDeleteTask, useTasksQuery, useUpdateTask } from '../../src/tasks/useTasks.js'
import type { Task } from '../../src/api/types.js'

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const SAMPLE_TASK: Task = {
  id: '1',
  title: 'Buy milk',
  notes: null,
  status: 'open',
  priority: 'medium',
  dueAt: null,
  estimatedMinutes: null,
  parentTaskId: null,
  captureBatchId: null,
  source: 'manual',
  suggestBreakdown: false,
  alertedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
}

describe('useTasksQuery', () => {
  it('fetches and returns the task list', async () => {
    server.use(http.get('/api/tasks', () => HttpResponse.json({ tasks: [SAMPLE_TASK] })))

    const { result } = renderHook(() => useTasksQuery(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([SAMPLE_TASK])
  })

  it('passes a status filter through as a query parameter', async () => {
    let receivedUrl = ''
    server.use(
      http.get('/api/tasks', ({ request }) => {
        receivedUrl = request.url
        return HttpResponse.json({ tasks: [] })
      }),
    )

    const { result } = renderHook(() => useTasksQuery({ status: 'done' }), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(receivedUrl).toContain('status=done')
  })
})

describe('useCreateTask', () => {
  it('POSTs the input and returns the created task', async () => {
    server.use(
      http.post('/api/tasks', async ({ request }) => {
        const body = await request.json()
        return HttpResponse.json({ ...SAMPLE_TASK, title: (body as { title: string }).title }, { status: 201 })
      }),
    )

    const { result } = renderHook(() => useCreateTask(), { wrapper })
    result.current.mutate({ title: 'Call the dentist' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.title).toBe('Call the dentist')
  })
})

describe('useUpdateTask', () => {
  it('PATCHes only the given task', async () => {
    server.use(
      http.patch('/api/tasks/1', async ({ request }) => {
        const body = await request.json()
        return HttpResponse.json({ ...SAMPLE_TASK, ...(body as object) })
      }),
    )

    const { result } = renderHook(() => useUpdateTask(), { wrapper })
    result.current.mutate({ id: '1', patch: { status: 'done' } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.status).toBe('done')
  })
})

describe('useDeleteTask', () => {
  it('DELETEs the task by id', async () => {
    let deletedId = ''
    server.use(
      http.delete('/api/tasks/:id', ({ params }) => {
        deletedId = params.id as string
        return new HttpResponse(null, { status: 204 })
      }),
    )

    const { result } = renderHook(() => useDeleteTask(), { wrapper })
    result.current.mutate('1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(deletedId).toBe('1')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/tasks/useTasks.test.tsx`
Expected: FAIL — `src/tasks/useTasks.ts` does not exist.

- [ ] **Step 3: Add remaining wire types**

`frontend/src/api/types.ts` — add to the file created in Task 1:

```ts
export interface Task {
  id: string
  title: string
  notes: string | null
  status: 'open' | 'done'
  priority: 'low' | 'medium' | 'high'
  dueAt: string | null
  estimatedMinutes: number | null
  parentTaskId: string | null
  captureBatchId: string | null
  source: 'manual' | 'ai_parsed' | 'ai_breakdown'
  suggestBreakdown: boolean
  alertedAt: string | null
  createdAt: string
  completedAt: string | null
}

export interface CreateTaskInput {
  title: string
  notes?: string | null
  priority?: Task['priority']
  dueAt?: string | null
  estimatedMinutes?: number | null
  parentTaskId?: string | null
}

export interface UpdateTaskInput {
  title?: string
  notes?: string | null
  status?: Task['status']
  priority?: Task['priority']
  dueAt?: string | null
  estimatedMinutes?: number | null
  parentTaskId?: string | null
  suggestBreakdown?: boolean
}

export interface TaskListFilter {
  status?: Task['status']
  parentTaskId?: string | 'none'
  captureBatchId?: string
  maxEstimatedMinutes?: number
  limit?: number
}
```

- [ ] **Step 4: Implement the task hooks**

`frontend/src/tasks/useTasks.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../api/client.js'
import type { CreateTaskInput, Task, TaskListFilter, UpdateTaskInput } from '../api/types.js'

const TASKS_KEY = ['tasks'] as const

function toQueryString(filter: TaskListFilter): string {
  const params = new URLSearchParams()
  if (filter.status !== undefined) params.set('status', filter.status)
  if (filter.parentTaskId !== undefined) params.set('parentTaskId', filter.parentTaskId)
  if (filter.captureBatchId !== undefined) params.set('captureBatchId', filter.captureBatchId)
  if (filter.maxEstimatedMinutes !== undefined) {
    params.set('maxEstimatedMinutes', String(filter.maxEstimatedMinutes))
  }
  if (filter.limit !== undefined) params.set('limit', String(filter.limit))
  const query = params.toString()
  return query === '' ? '' : `?${query}`
}

export function useTasksQuery(filter: TaskListFilter = {}) {
  return useQuery({
    queryKey: [...TASKS_KEY, filter],
    queryFn: () => apiFetch<{ tasks: Task[] }>(`/tasks${toQueryString(filter)}`).then((r) => r.tasks),
  })
}

export function useCreateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTaskInput) =>
      apiFetch<Task>('/tasks', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
  })
}

export function useUpdateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateTaskInput }) =>
      apiFetch<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
  })
}

export function useDeleteTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/tasks/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
  })
}
```

Invalidation over optimistic updates is the deliberate choice here: this is a single-user app on infrastructure the user controls, latency is low, and the backend's `ORDER BY priority DESC, due_at ASC NULLS LAST, created_at ASC` is non-trivial to replicate client-side for an optimistic insert. Correctness over perceived speed.

- [ ] **Step 5: Run the hook test to verify it passes**

Run: `cd frontend && npx vitest run tests/tasks/useTasks.test.tsx`
Expected: PASS — 5 tests.

- [ ] **Step 6: Write the failing component tests**

`frontend/tests/tasks/TaskList.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '../mocks/server.js'
import { TaskList } from '../../src/tasks/TaskList.js'
import type { Task } from '../../src/api/types.js'

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const TASK: Task = {
  id: '1',
  title: 'Buy milk',
  notes: null,
  status: 'open',
  priority: 'high',
  dueAt: null,
  estimatedMinutes: 10,
  parentTaskId: null,
  captureBatchId: null,
  source: 'manual',
  suggestBreakdown: false,
  alertedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
}

describe('TaskList', () => {
  it('renders each task title', async () => {
    server.use(http.get('/api/tasks', () => HttpResponse.json({ tasks: [TASK] })))

    renderWithClient(<TaskList />)

    expect(await screen.findByText('Buy milk')).toBeInTheDocument()
  })

  it('shows an empty state with no open tasks', async () => {
    server.use(http.get('/api/tasks', () => HttpResponse.json({ tasks: [] })))

    renderWithClient(<TaskList />)

    expect(await screen.findByText(/nothing (open|to do)/i)).toBeInTheDocument()
  })

  it('marks a task done and it leaves the open list', async () => {
    let currentStatus = 'open'
    server.use(
      http.get('/api/tasks', () =>
        HttpResponse.json({ tasks: currentStatus === 'open' ? [TASK] : [] }),
      ),
      http.patch('/api/tasks/1', () => {
        currentStatus = 'done'
        return HttpResponse.json({ ...TASK, status: 'done' })
      }),
    )
    const user = userEvent.setup()

    renderWithClient(<TaskList />)
    await screen.findByText('Buy milk')
    await user.click(screen.getByRole('checkbox', { name: /buy milk/i }))

    await waitFor(() => expect(screen.queryByText('Buy milk')).not.toBeInTheDocument())
  })

  it('shows a "Break this down?" affordance only when suggestBreakdown is true', async () => {
    server.use(http.get('/api/tasks', () => HttpResponse.json({ tasks: [{ ...TASK, suggestBreakdown: true }] })))

    renderWithClient(<TaskList />)

    expect(await screen.findByRole('button', { name: /break.*down/i })).toBeInTheDocument()
  })

  it('surfaces an error state when the fetch fails', async () => {
    server.use(http.get('/api/tasks', () => HttpResponse.json({ error: 'boom' }, { status: 500 })))

    renderWithClient(<TaskList />)

    expect(await screen.findByText(/something went wrong|couldn't load/i)).toBeInTheDocument()
  })
})
```

`frontend/tests/tasks/TaskForm.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { TaskForm } from '../../src/tasks/TaskForm.js'

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('TaskForm', () => {
  it('submits a title and calls onCreated with the new task', async () => {
    server.use(
      http.post('/api/tasks', () =>
        HttpResponse.json(
          { id: '1', title: 'Call the dentist', status: 'open' /* ...rest omitted, real component reads full Task */ },
          { status: 201 },
        ),
      ),
    )
    const onCreated = vi.fn()
    const user = userEvent.setup()

    renderWithClient(<TaskForm onCreated={onCreated} />)
    await user.type(screen.getByLabelText(/title/i), 'Call the dentist')
    await user.click(screen.getByRole('button', { name: /add/i }))

    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledOnce())
  })

  it('does not submit a blank title', async () => {
    const onCreated = vi.fn()
    const user = userEvent.setup()

    renderWithClient(<TaskForm onCreated={onCreated} />)
    await user.click(screen.getByRole('button', { name: /add/i }))

    expect(onCreated).not.toHaveBeenCalled()
  })

  it('clears the input after a successful submission', async () => {
    server.use(http.post('/api/tasks', () => HttpResponse.json({ id: '1', title: 'x' }, { status: 201 })))
    const user = userEvent.setup()

    renderWithClient(<TaskForm onCreated={() => {}} />)
    const input = screen.getByLabelText(/title/i)
    await user.type(input, 'Buy milk')
    await user.click(screen.getByRole('button', { name: /add/i }))

    await vi.waitFor(() => expect(input).toHaveValue(''))
  })
})
```

- [ ] **Step 7: Run the component tests to verify they fail**

Run: `cd frontend && npx vitest run tests/tasks/TaskList.test.tsx tests/tasks/TaskForm.test.tsx`
Expected: FAIL — `TaskList.tsx` and `TaskForm.tsx` do not exist.

- [ ] **Step 8: Implement the components**

`frontend/src/tasks/TaskForm.tsx`:

```tsx
import { type FormEvent, useState } from 'react'
import { useCreateTask } from './useTasks.js'
import type { Task } from '../api/types.js'

export function TaskForm({ onCreated }: { onCreated: (task: Task) => void }) {
  const [title, setTitle] = useState('')
  const createTask = useCreateTask()

  function handleSubmit(event: FormEvent): void {
    event.preventDefault()
    const trimmed = title.trim()
    if (trimmed === '') return
    createTask.mutate(
      { title: trimmed },
      {
        onSuccess: (task) => {
          setTitle('')
          onCreated(task)
        },
      },
    )
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="task-title">Title</label>
      <input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <button type="submit" disabled={createTask.isPending}>
        Add
      </button>
    </form>
  )
}
```

`frontend/src/tasks/TaskItem.tsx`:

```tsx
import { useUpdateTask, useDeleteTask } from './useTasks.js'
import type { Task } from '../api/types.js'

export function TaskItem({
  task,
  onBreakdownRequested,
}: {
  task: Task
  onBreakdownRequested: (task: Task) => void
}) {
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()

  return (
    <li>
      <input
        type="checkbox"
        aria-label={task.title}
        checked={task.status === 'done'}
        onChange={(e) =>
          updateTask.mutate({ id: task.id, patch: { status: e.target.checked ? 'done' : 'open' } })
        }
      />
      <span>{task.title}</span>
      {task.suggestBreakdown && (
        <button type="button" onClick={() => onBreakdownRequested(task)}>
          Break this down?
        </button>
      )}
      <button type="button" onClick={() => deleteTask.mutate(task.id)}>
        Delete
      </button>
    </li>
  )
}
```

`frontend/src/tasks/TaskList.tsx`:

```tsx
import { useState } from 'react'
import { useTasksQuery } from './useTasks.js'
import { TaskItem } from './TaskItem.js'
import { TaskForm } from './TaskForm.js'
import type { Task } from '../api/types.js'

export function TaskList() {
  const { data: tasks, isLoading, isError } = useTasksQuery({ status: 'open' })
  const [breakdownTarget, setBreakdownTarget] = useState<Task | null>(null)

  if (isError) return <p>Something went wrong loading your tasks.</p>
  if (isLoading) return <p>Loading…</p>

  return (
    <div>
      <TaskForm onCreated={() => {}} />
      {tasks !== undefined && tasks.length === 0 ? (
        <p>Nothing open — you're all caught up.</p>
      ) : (
        <ul>
          {tasks?.map((task) => (
            <TaskItem key={task.id} task={task} onBreakdownRequested={setBreakdownTarget} />
          ))}
        </ul>
      )}
      {/* breakdownTarget wired to the breakdown modal in Task 4 */}
    </div>
  )
}
```

`frontend/src/tasks/TaskDetail.tsx` — a simple detail/edit view reusing `useUpdateTask`; implement it following the same pattern as `TaskItem` but exposing every editable field (`title`, `notes`, `priority`, `dueAt`, `estimatedMinutes`). No new interfaces beyond what Step 3 already defined — write the straightforward form.

- [ ] **Step 9: Run all task tests and wire into `App.tsx`**

Run: `cd frontend && npx vitest run tests/tasks/`
Expected: PASS — 12 tests total across the three files.

Update `App.tsx` to render `<TaskList />` inside `<TokenGate>`.

- [ ] **Step 10: Full verification and commit**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: no type errors; all green.

```bash
git add frontend
git commit -m "feat(frontend): add task list, creation, and status toggling"
```

---

## Task 3: Capture flow — the primary entry point

The freeform capture box: type a dump, get back parsed tasks or a shortlist, handle the failure-preserves-input path, and offer retry. This is flow 1 and flow 3 from the product spec, combined behind the one endpoint that already combines them server-side.

**Files:**
- Create: `frontend/src/capture/useCapture.ts`
- Create: `frontend/src/capture/CaptureBox.tsx`
- Create: `frontend/src/capture/CaptureResult.tsx`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/tests/capture/useCapture.test.tsx`
- Test: `frontend/tests/capture/CaptureBox.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `Task`, `CaptureBatch` (Task 1).
- Produces:
  - `type CaptureResponse = { type: 'shortlist'; minutes: number; tasks: Task[] } | { type: 'batch'; batch: CaptureBatch; tasks: Task[] }`
  - `useCapture(): UseMutationResult<CaptureResponse, ApiError, string>`
  - `useReparseCaptureBatch(): UseMutationResult<{ batch: CaptureBatch; tasks: Task[] }, ApiError, string>`
  - `<CaptureBox>` — the text input + submit; renders `<CaptureResult>` with whatever came back.
  - `<CaptureResult>` — branches on `type: 'shortlist' | 'batch'`, and within `'batch'`, on `batch.parseStatus`.

- [ ] **Step 1: Write the failing hook test**

`frontend/tests/capture/useCapture.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { server } from '../mocks/server.js'
import { useCapture, useReparseCaptureBatch } from '../../src/capture/useCapture.js'

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('useCapture', () => {
  it('returns a shortlist response for a time-available query', async () => {
    server.use(
      http.post('/api/capture', () =>
        HttpResponse.json({ type: 'shortlist', minutes: 20, tasks: [] }),
      ),
    )

    const { result } = renderHook(() => useCapture(), { wrapper })
    result.current.mutate('I have 20 minutes')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ type: 'shortlist', minutes: 20, tasks: [] })
  })

  it('returns a batch response for a normal capture', async () => {
    server.use(
      http.post('/api/capture', () =>
        HttpResponse.json(
          {
            type: 'batch',
            batch: { id: 'b1', rawText: 'buy milk', parseStatus: 'parsed', parseError: null, createdAt: '2026-01-01T00:00:00.000Z' },
            tasks: [],
          },
          { status: 201 },
        ),
      ),
    )

    const { result } = renderHook(() => useCapture(), { wrapper })
    result.current.mutate('buy milk')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.type).toBe('batch')
  })

  it('surfaces a failed parse in the batch response rather than throwing', async () => {
    server.use(
      http.post('/api/capture', () =>
        HttpResponse.json(
          {
            type: 'batch',
            batch: { id: 'b1', rawText: 'buy milk', parseStatus: 'failed', parseError: 'Claude request failed', createdAt: '2026-01-01T00:00:00.000Z' },
            tasks: [{ id: 't1', title: 'buy milk', source: 'manual' }],
          },
          { status: 201 },
        ),
      ),
    )

    const { result } = renderHook(() => useCapture(), { wrapper })
    result.current.mutate('buy milk')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // A failed parse is still a 201 success at the HTTP level — the
    // mutation must not treat parseStatus:'failed' as a rejected mutation.
    expect(result.current.data?.type === 'batch' && result.current.data.batch.parseStatus).toBe('failed')
  })
})

describe('useReparseCaptureBatch', () => {
  it('POSTs to the retry endpoint for the given batch id', async () => {
    let hitPath = ''
    server.use(
      http.post('/api/capture-batches/:id/parse', ({ params }) => {
        hitPath = params.id as string
        return HttpResponse.json({
          batch: { id: 'b1', rawText: 'x', parseStatus: 'parsed', parseError: null, createdAt: '2026-01-01T00:00:00.000Z' },
          tasks: [],
        })
      }),
    )

    const { result } = renderHook(() => useReparseCaptureBatch(), { wrapper })
    result.current.mutate('b1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(hitPath).toBe('b1')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/capture/useCapture.test.tsx`
Expected: FAIL — `src/capture/useCapture.ts` does not exist.

- [ ] **Step 3: Add the capture types**

Append to `frontend/src/api/types.ts`:

```ts
export interface CaptureBatch {
  id: string
  rawText: string
  parseStatus: 'pending' | 'parsed' | 'failed'
  parseError: string | null
  createdAt: string
}

export type CaptureResponse =
  | { type: 'shortlist'; minutes: number; tasks: Task[] }
  | { type: 'batch'; batch: CaptureBatch; tasks: Task[] }
```

- [ ] **Step 4: Implement the hooks**

`frontend/src/capture/useCapture.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../api/client.js'
import type { CaptureBatch, CaptureResponse, Task } from '../api/types.js'

export function useCapture() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (rawText: string) =>
      apiFetch<CaptureResponse>('/capture', { method: 'POST', body: JSON.stringify({ rawText }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

export function useReparseCaptureBatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (batchId: string) =>
      apiFetch<{ batch: CaptureBatch; tasks: Task[] }>(`/capture-batches/${batchId}/parse`, {
        method: 'POST',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  })
}
```

- [ ] **Step 5: Run the hook test to verify it passes**

Run: `cd frontend && npx vitest run tests/capture/useCapture.test.tsx`
Expected: PASS — 4 tests.

- [ ] **Step 6: Write the failing component test**

`frontend/tests/capture/CaptureBox.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '../mocks/server.js'
import { CaptureBox } from '../../src/capture/CaptureBox.js'

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('CaptureBox', () => {
  it('shows a shortlist result for a time-available query', async () => {
    server.use(
      http.post('/api/capture', () =>
        HttpResponse.json({
          type: 'shortlist',
          minutes: 20,
          tasks: [{ id: '1', title: 'Quick win', priority: 'high', status: 'open' }],
        }),
      ),
    )
    const user = userEvent.setup()

    renderWithClient(<CaptureBox />)
    await user.type(screen.getByRole('textbox'), 'I have 20 minutes')
    await user.click(screen.getByRole('button', { name: /go|submit|capture/i }))

    expect(await screen.findByText('Quick win')).toBeInTheDocument()
    expect(screen.getByText(/20 minutes/)).toBeInTheDocument()
  })

  it('shows parsed tasks for a normal capture', async () => {
    server.use(
      http.post('/api/capture', () =>
        HttpResponse.json(
          {
            type: 'batch',
            batch: { id: 'b1', rawText: 'buy milk', parseStatus: 'parsed', parseError: null, createdAt: '2026-01-01T00:00:00.000Z' },
            tasks: [{ id: 't1', title: 'Buy milk', priority: 'medium', status: 'open' }],
          },
          { status: 201 },
        ),
      ),
    )
    const user = userEvent.setup()

    renderWithClient(<CaptureBox />)
    await user.type(screen.getByRole('textbox'), 'buy milk')
    await user.click(screen.getByRole('button', { name: /go|submit|capture/i }))

    expect(await screen.findByText('Buy milk')).toBeInTheDocument()
  })

  it('shows a retry affordance and the preserved input when parsing fails', async () => {
    server.use(
      http.post('/api/capture', () =>
        HttpResponse.json(
          {
            type: 'batch',
            batch: {
              id: 'b1',
              rawText: 'buy milk\ncall dentist',
              parseStatus: 'failed',
              parseError: 'Claude request failed',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            tasks: [{ id: 't1', title: 'buy milk', priority: 'medium', status: 'open', notes: 'buy milk\ncall dentist' }],
          },
          { status: 201 },
        ),
      ),
    )
    const user = userEvent.setup()

    renderWithClient(<CaptureBox />)
    await user.type(screen.getByRole('textbox'), 'buy milk\ncall dentist')
    await user.click(screen.getByRole('button', { name: /go|submit|capture/i }))

    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument()
    // Input is never lost: the fallback task carrying the dump is visible.
    expect(screen.getByText('buy milk')).toBeInTheDocument()
  })

  it('clears the input after a successful submission', async () => {
    server.use(
      http.post('/api/capture', () =>
        HttpResponse.json({ type: 'shortlist', minutes: 5, tasks: [] }),
      ),
    )
    const user = userEvent.setup()

    renderWithClient(<CaptureBox />)
    const input = screen.getByRole('textbox')
    await user.type(input, 'I have 5 minutes')
    await user.click(screen.getByRole('button', { name: /go|submit|capture/i }))

    await screen.findByText(/5 minutes/)
    expect(input).toHaveValue('')
  })
})
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/capture/CaptureBox.test.tsx`
Expected: FAIL — `CaptureBox.tsx` and `CaptureResult.tsx` do not exist.

- [ ] **Step 8: Implement the components**

`frontend/src/capture/CaptureResult.tsx`:

```tsx
import { useReparseCaptureBatch } from './useCapture.js'
import type { CaptureResponse } from '../api/types.js'

export function CaptureResult({ result }: { result: CaptureResponse }) {
  const reparse = useReparseCaptureBatch()

  if (result.type === 'shortlist') {
    return (
      <div>
        <p>With {result.minutes} minutes, here's what fits:</p>
        {result.tasks.length === 0 ? (
          <p>Nothing short enough right now.</p>
        ) : (
          <ul>
            {result.tasks.map((task) => (
              <li key={task.id}>{task.title}</li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  const { batch, tasks } = result
  return (
    <div>
      {batch.parseStatus === 'failed' && (
        <div>
          <p>Couldn't parse that just now — your text is saved. {batch.parseError}</p>
          <button type="button" onClick={() => reparse.mutate(batch.id)} disabled={reparse.isPending}>
            Retry
          </button>
        </div>
      )}
      <ul>
        {tasks.map((task) => (
          <li key={task.id}>{task.title}</li>
        ))}
      </ul>
    </div>
  )
}
```

`frontend/src/capture/CaptureBox.tsx`:

```tsx
import { type FormEvent, useState } from 'react'
import { useCapture } from './useCapture.js'
import { CaptureResult } from './CaptureResult.js'

export function CaptureBox() {
  const [text, setText] = useState('')
  const capture = useCapture()

  function handleSubmit(event: FormEvent): void {
    event.preventDefault()
    const trimmed = text.trim()
    if (trimmed === '') return
    capture.mutate(trimmed, { onSuccess: () => setText('') })
  }

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Dump your tasks, or ask 'I have 20 minutes'…"
        />
        <button type="submit" disabled={capture.isPending}>
          Go
        </button>
      </form>
      {capture.data !== undefined && <CaptureResult result={capture.data} />}
    </div>
  )
}
```

- [ ] **Step 9: Run all capture tests and wire into `App.tsx`**

Run: `cd frontend && npx vitest run tests/capture/`
Expected: PASS — 8 tests.

Add `<CaptureBox />` above `<TaskList />` in `App.tsx` — capture is the primary entry point per the product spec, so it belongs at the top of the screen.

- [ ] **Step 10: Full verification and commit**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: no type errors; all green.

```bash
git add frontend
git commit -m "feat(frontend): add the capture box, shortlist, and retry-on-failure flow"
```

---

## Task 4: Breakdown flow — propose, edit, save

The "Break this down?" affordance wired end to end: propose subtasks via Sonnet, let the user edit the list before anything is saved, and handle the `503`-is-expected case from the backend.

**Files:**
- Create: `frontend/src/tasks/useBreakdown.ts`
- Create: `frontend/src/tasks/BreakdownModal.tsx`
- Modify: `frontend/src/tasks/TaskList.tsx`
- Test: `frontend/tests/tasks/useBreakdown.test.tsx`
- Test: `frontend/tests/tasks/BreakdownModal.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `Task` (Task 1).
- Produces:
  - `interface ProposedSubtask { title: string; estimatedMinutes: number | null }`
  - `useProposeBreakdown(): UseMutationResult<ProposedSubtask[], ApiError, string>` (input: task id)
  - `useSaveSubtasks(): UseMutationResult<Task[], ApiError, { taskId: string; subtasks: ProposedSubtask[] }>`
  - `<BreakdownModal task={Task} onClose={() => void}>` — proposes on open, lets the user edit titles/estimates/remove rows before saving.

- [ ] **Step 1: Write the failing hook test**

`frontend/tests/tasks/useBreakdown.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { server } from '../mocks/server.js'
import { useProposeBreakdown, useSaveSubtasks } from '../../src/tasks/useBreakdown.js'
import { ApiError } from '../../src/api/errors.js'

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('useProposeBreakdown', () => {
  it('returns the proposed subtasks', async () => {
    server.use(
      http.post('/api/tasks/t1/breakdown', () =>
        HttpResponse.json({ subtasks: [{ title: 'Collect references', estimatedMinutes: 30 }] }),
      ),
    )

    const { result } = renderHook(() => useProposeBreakdown(), { wrapper })
    result.current.mutate('t1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ title: 'Collect references', estimatedMinutes: 30 }])
  })

  it('surfaces a 503 as a rejected mutation with the ApiError status intact', async () => {
    server.use(
      http.post('/api/tasks/t1/breakdown', () =>
        HttpResponse.json({ error: 'Breakdown is unavailable right now' }, { status: 503 }),
      ),
    )

    const { result } = renderHook(() => useProposeBreakdown(), { wrapper })
    result.current.mutate('t1')

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(ApiError)
    expect((result.current.error as ApiError).status).toBe(503)
  })
})

describe('useSaveSubtasks', () => {
  it('POSTs the edited list and returns the created tasks', async () => {
    server.use(
      http.post('/api/tasks/t1/subtasks', async ({ request }) => {
        const body = (await request.json()) as { subtasks: unknown[] }
        return HttpResponse.json(
          { tasks: body.subtasks.map((_, i) => ({ id: `s${i}`, title: 'x' })) },
          { status: 201 },
        )
      }),
    )

    const { result } = renderHook(() => useSaveSubtasks(), { wrapper })
    result.current.mutate({
      taskId: 't1',
      subtasks: [{ title: 'Step one', estimatedMinutes: 15 }],
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/tasks/useBreakdown.test.tsx`
Expected: FAIL — `src/tasks/useBreakdown.ts` does not exist.

- [ ] **Step 3: Add the breakdown types**

Append to `frontend/src/api/types.ts`:

```ts
export interface ProposedSubtask {
  title: string
  estimatedMinutes: number | null
}
```

- [ ] **Step 4: Implement the hooks**

`frontend/src/tasks/useBreakdown.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../api/client.js'
import type { ProposedSubtask, Task } from '../api/types.js'

export function useProposeBreakdown() {
  return useMutation({
    mutationFn: (taskId: string) =>
      apiFetch<{ subtasks: ProposedSubtask[] }>(`/tasks/${taskId}/breakdown`, {
        method: 'POST',
      }).then((r) => r.subtasks),
  })
}

export function useSaveSubtasks() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, subtasks }: { taskId: string; subtasks: ProposedSubtask[] }) =>
      apiFetch<{ tasks: Task[] }>(`/tasks/${taskId}/subtasks`, {
        method: 'POST',
        body: JSON.stringify({ subtasks }),
      }).then((r) => r.tasks),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  })
}
```

- [ ] **Step 5: Run the hook test to verify it passes**

Run: `cd frontend && npx vitest run tests/tasks/useBreakdown.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 6: Write the failing component test**

`frontend/tests/tasks/BreakdownModal.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '../mocks/server.js'
import { BreakdownModal } from '../../src/tasks/BreakdownModal.js'
import type { Task } from '../../src/api/types.js'

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const TASK: Task = {
  id: 't1',
  title: 'Redesign the website',
  notes: null,
  status: 'open',
  priority: 'medium',
  dueAt: null,
  estimatedMinutes: null,
  parentTaskId: null,
  captureBatchId: null,
  source: 'manual',
  suggestBreakdown: true,
  alertedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
}

describe('BreakdownModal', () => {
  it('proposes subtasks on open and lets the user edit before saving', async () => {
    server.use(
      http.post('/api/tasks/t1/breakdown', () =>
        HttpResponse.json({
          subtasks: [
            { title: 'Collect references', estimatedMinutes: 30 },
            { title: 'Sketch a layout', estimatedMinutes: 60 },
          ],
        }),
      ),
      http.post('/api/tasks/t1/subtasks', async ({ request }) => {
        const body = (await request.json()) as { subtasks: { title: string }[] }
        return HttpResponse.json(
          { tasks: body.subtasks.map((s, i) => ({ id: `s${i}`, title: s.title })) },
          { status: 201 },
        )
      }),
    )
    const user = userEvent.setup()

    renderWithClient(<BreakdownModal task={TASK} onClose={() => {}} />)

    expect(await screen.findByDisplayValue('Collect references')).toBeInTheDocument()
    const firstTitle = screen.getByDisplayValue('Collect references')
    await user.clear(firstTitle)
    await user.type(firstTitle, 'Gather design references')

    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(screen.queryByDisplayValue('Gather design references')).not.toBeInTheDocument())
  })

  it('lets the user remove a proposed subtask before saving', async () => {
    server.use(
      http.post('/api/tasks/t1/breakdown', () =>
        HttpResponse.json({
          subtasks: [
            { title: 'Keep me', estimatedMinutes: 10 },
            { title: 'Remove me', estimatedMinutes: 10 },
          ],
        }),
      ),
      http.post('/api/tasks/t1/subtasks', async ({ request }) => {
        const body = (await request.json()) as { subtasks: unknown[] }
        expect(body.subtasks).toHaveLength(1)
        return HttpResponse.json({ tasks: [] }, { status: 201 })
      }),
    )
    const user = userEvent.setup()

    renderWithClient(<BreakdownModal task={TASK} onClose={() => {}} />)
    await screen.findByDisplayValue('Remove me')
    await user.click(screen.getByRole('button', { name: /remove me/i }))
    await user.click(screen.getByRole('button', { name: /^save/i }))
  })

  it('shows a retryable message on a 503 rather than a generic error', async () => {
    server.use(
      http.post('/api/tasks/t1/breakdown', () =>
        HttpResponse.json({ error: 'Breakdown is unavailable right now' }, { status: 503 }),
      ),
    )

    renderWithClient(<BreakdownModal task={TASK} onClose={() => {}} />)

    expect(await screen.findByText(/try again/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/tasks/BreakdownModal.test.tsx`
Expected: FAIL — `BreakdownModal.tsx` does not exist.

- [ ] **Step 8: Implement the component**

`frontend/src/tasks/BreakdownModal.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useProposeBreakdown, useSaveSubtasks } from './useBreakdown.js'
import type { ProposedSubtask, Task } from '../api/types.js'
import { ApiError } from '../api/errors.js'

export function BreakdownModal({ task, onClose }: { task: Task; onClose: () => void }) {
  const [subtasks, setSubtasks] = useState<ProposedSubtask[]>([])
  const propose = useProposeBreakdown()
  const save = useSaveSubtasks()

  useEffect(() => {
    propose.mutate(task.id, { onSuccess: setSubtasks })
    // Only run once per mount — proposing again on every render would spend
    // another Sonnet call for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function updateTitle(index: number, title: string): void {
    setSubtasks((prev) => prev.map((s, i) => (i === index ? { ...s, title } : s)))
  }

  function removeSubtask(index: number): void {
    setSubtasks((prev) => prev.filter((_, i) => i !== index))
  }

  function handleSave(): void {
    save.mutate({ taskId: task.id, subtasks }, { onSuccess: onClose })
  }

  if (propose.isError) {
    const isUnavailable = propose.error instanceof ApiError && propose.error.status === 503
    return (
      <div role="dialog">
        <p>
          {isUnavailable
            ? "Couldn't reach the breakdown service — try again in a moment."
            : 'Something went wrong proposing a breakdown.'}
        </p>
        <button type="button" onClick={() => propose.mutate(task.id, { onSuccess: setSubtasks })}>
          Try again
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    )
  }

  if (propose.isPending) return <div role="dialog">Thinking…</div>

  return (
    <div role="dialog">
      <h2>Break down: {task.title}</h2>
      <ul>
        {subtasks.map((subtask, index) => (
          <li key={index}>
            <input value={subtask.title} onChange={(e) => updateTitle(index, e.target.value)} />
            <button type="button" onClick={() => removeSubtask(index)}>
              {subtask.title}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={handleSave} disabled={save.isPending || subtasks.length === 0}>
        Save
      </button>
      <button type="button" onClick={onClose}>
        Cancel
      </button>
    </div>
  )
}
```

Note the "remove" button's accessible name is deliberately the subtask's own title (`{subtask.title}`) in this sketch so the test's `getByRole('button', { name: /remove me/i })` can find it — in the real component, give it a clearer visible label (e.g. an "×" icon with `aria-label={`Remove ${subtask.title}`}`) rather than shipping the placeholder text literally. Adjust the test's selector to match if the accessible name changes shape (e.g. `name: /remove.*remove me/i`).

- [ ] **Step 9: Wire the modal into `TaskList`**

In `frontend/src/tasks/TaskList.tsx`, render `<BreakdownModal task={breakdownTarget} onClose={() => setBreakdownTarget(null)} />` when `breakdownTarget` is non-null (the state already exists from Task 2).

- [ ] **Step 10: Run all breakdown tests and the full suite, then commit**

Run: `cd frontend && npx vitest run tests/tasks/useBreakdown.test.tsx tests/tasks/BreakdownModal.test.tsx && npx tsc --noEmit && npm test`
Expected: PASS — 6 new tests; all green overall.

```bash
git add frontend
git commit -m "feat(frontend): add the project breakdown modal"
```

---

## Task 5: Push notifications and check-in settings

Service worker registration, the subscribe/unsubscribe flow (respecting iOS's install-first constraint), and the check-in settings screen. This is the task where the PWA manifest and service worker actually get built, not just scaffolded.

**Files:**
- Create: `frontend/vite-plugin-pwa` config in `frontend/vite.config.ts` (modify)
- Create: `frontend/public/icon-192.png`, `frontend/public/icon-512.png` (placeholder app icons — any square PNG; note in the report that real icons are a design task, not this plan's job)
- Create: `frontend/src/sw.ts` (the service worker source `vite-plugin-pwa` builds from)
- Create: `frontend/src/push/usePushSubscription.ts`
- Create: `frontend/src/push/PushSettings.tsx`
- Create: `frontend/src/settings/useCheckInSettings.ts`
- Create: `frontend/src/settings/CheckInSettingsForm.tsx`
- Create: `frontend/src/settings/SettingsScreen.tsx`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/tests/push/usePushSubscription.test.tsx`
- Test: `frontend/tests/settings/useCheckInSettings.test.tsx`
- Test: `frontend/tests/settings/CheckInSettingsForm.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` (Task 1); `GET /push/vapid-public-key`, `POST`/`DELETE /push/subscriptions`, `POST /push/test`, `GET`/`PATCH /check-in-settings` (backend plan 3).
- Produces:
  - `usePushSubscriptionStatus(): { status: 'unsupported' | 'not-installed' | 'permission-denied' | 'unsubscribed' | 'subscribed'; subscribe: () => Promise<void>; unsubscribe: () => Promise<void>; sendTest: () => Promise<{sent:number;pruned:number;failed:number}> }`
  - `useCheckInSettingsQuery(): UseQueryResult<CheckInSettings>`
  - `useUpdateCheckInSettings(): UseMutationResult<CheckInSettings, ApiError, Partial<CheckInSettings>>`
  - `<PushSettings>`, `<CheckInSettingsForm>`, `<SettingsScreen>`

- [ ] **Step 1: Add `vite-plugin-pwa` to the Vite config**

`frontend/vite.config.ts` — add the plugin alongside `react()`:

```ts
import { VitePWA } from 'vite-plugin-pwa'

// inside plugins: [...]
VitePWA({
  registerType: 'autoUpdate',
  srcDir: 'src',
  filename: 'sw.ts',
  strategies: 'injectManifest',
  manifest: {
    name: 'ToDo',
    short_name: 'ToDo',
    description: 'A personal, AI-assisted to-do list.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  },
})
```

`strategies: 'injectManifest'` (rather than `generateSW`) is deliberate: this app needs custom `push` and `notificationclick` handlers, which `generateSW`'s auto-generated worker doesn't support writing by hand.

- [ ] **Step 2: Write the service worker**

`frontend/src/sw.ts`:

```ts
/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope

import { precacheAndRoute } from 'workbox-precaching'

// injectManifest requires this line — vite-plugin-pwa replaces
// self.__WB_MANIFEST with the list of built assets to precache.
precacheAndRoute(self.__WB_MANIFEST)

/**
 * Payload shape is documented in backend/README.md's "Notification payload"
 * section: {title, body, url?}, sent as a JSON string on the push event's
 * `data`. Every push the server sends — deadline alerts, check-ins, and
 * POST /push/test — uses this same shape.
 */
self.addEventListener('push', (event) => {
  if (event.data === null) return
  const payload = event.data.json() as { title: string; body: string; url?: string }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: { url: payload.url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientList) => {
      // Focus an already-open tab rather than opening a duplicate one.
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus()
      }
      return self.clients.openWindow(url)
    }),
  )
})
```

- [ ] **Step 3: Write the failing push subscription test**

`frontend/tests/push/usePushSubscription.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { server } from '../mocks/server.js'
import { usePushSubscriptionStatus } from '../../src/push/usePushSubscription.js'

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const FAKE_SUBSCRIPTION = {
  endpoint: 'https://push.example.com/abc',
  toJSON: () => ({
    endpoint: 'https://push.example.com/abc',
    keys: { p256dh: 'key', auth: 'secret' },
  }),
}

describe('usePushSubscriptionStatus', () => {
  let originalNotification: typeof Notification | undefined
  let originalServiceWorker: typeof navigator.serviceWorker | undefined

  beforeEach(() => {
    originalNotification = globalThis.Notification
    originalServiceWorker = navigator.serviceWorker
  })

  afterEach(() => {
    if (originalNotification !== undefined) globalThis.Notification = originalNotification
    Object.defineProperty(navigator, 'serviceWorker', {
      value: originalServiceWorker,
      configurable: true,
    })
    vi.restoreAllMocks()
  })

  it('reports "unsupported" when the Push API is unavailable', async () => {
    // @ts-expect-error deliberately removing browser support for the test
    delete globalThis.Notification
    Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true })

    const { result } = renderHook(() => usePushSubscriptionStatus(), { wrapper })

    await waitFor(() => expect(result.current.status).toBe('unsupported'))
  })

  it('reports "unsubscribed" when supported but no subscription exists yet', async () => {
    globalThis.Notification = { permission: 'default' } as unknown as typeof Notification
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve({
          pushManager: { getSubscription: () => Promise.resolve(null) },
        }),
      },
      configurable: true,
    })

    const { result } = renderHook(() => usePushSubscriptionStatus(), { wrapper })

    await waitFor(() => expect(result.current.status).toBe('unsubscribed'))
  })

  it('subscribe() posts the browser subscription JSON to the backend', async () => {
    globalThis.Notification = {
      permission: 'default',
      requestPermission: () => Promise.resolve('granted'),
    } as unknown as typeof Notification
    let receivedBody: unknown = null
    server.use(
      http.get('/api/push/vapid-public-key', () => HttpResponse.json({ publicKey: 'test-key' })),
      http.post('/api/push/subscriptions', async ({ request }) => {
        receivedBody = await request.json()
        return HttpResponse.json({ id: '1', endpoint: FAKE_SUBSCRIPTION.endpoint, createdAt: '2026-01-01T00:00:00.000Z' }, { status: 201 })
      }),
    )
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: () => Promise.resolve(null),
            subscribe: () => Promise.resolve(FAKE_SUBSCRIPTION),
          },
        }),
      },
      configurable: true,
    })

    const { result } = renderHook(() => usePushSubscriptionStatus(), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('unsubscribed'))
    await result.current.subscribe()

    await waitFor(() => expect(receivedBody).toEqual(FAKE_SUBSCRIPTION.toJSON()))
  })

  it('reports "permission-denied" without calling subscribe when the user declines', async () => {
    globalThis.Notification = {
      permission: 'default',
      requestPermission: () => Promise.resolve('denied'),
    } as unknown as typeof Notification
    const subscribeSpy = vi.fn()
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve({
          pushManager: { getSubscription: () => Promise.resolve(null), subscribe: subscribeSpy },
        }),
      },
      configurable: true,
    })

    const { result } = renderHook(() => usePushSubscriptionStatus(), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('unsubscribed'))
    await result.current.subscribe()

    expect(subscribeSpy).not.toHaveBeenCalled()
    await waitFor(() => expect(result.current.status).toBe('permission-denied'))
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/push/usePushSubscription.test.tsx`
Expected: FAIL — `src/push/usePushSubscription.ts` does not exist.

- [ ] **Step 5: Implement `usePushSubscriptionStatus`**

`frontend/src/push/usePushSubscription.ts`:

```ts
import { useEffect, useState } from 'react'
import { apiFetch } from '../api/client.js'

type PushStatus = 'unsupported' | 'not-installed' | 'permission-denied' | 'unsubscribed' | 'subscribed'

/**
 * iOS Safari only exposes the Push API to a PWA that has been added to the
 * home screen — an in-Safari-tab PWA has no Notification/PushManager at all.
 * This is what makes 'unsupported' a real, expected status on iOS until the
 * user installs the app, not just a defensive fallback for ancient browsers.
 */
function isPushSupported(): boolean {
  return 'Notification' in globalThis && 'serviceWorker' in navigator && 'PushManager' in globalThis
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64Safe)
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

export function usePushSubscriptionStatus() {
  const [status, setStatus] = useState<PushStatus>('unsubscribed')

  useEffect(() => {
    if (!isPushSupported()) {
      setStatus('unsupported')
      return
    }
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((sub) => setStatus(sub === null ? 'unsubscribed' : 'subscribed'))
  }, [])

  async function subscribe(): Promise<void> {
    if (!isPushSupported()) return
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      setStatus('permission-denied')
      return
    }
    const { publicKey } = await apiFetch<{ publicKey: string }>('/push/vapid-public-key')
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
    await apiFetch('/push/subscriptions', {
      method: 'POST',
      body: JSON.stringify(subscription.toJSON()),
    })
    setStatus('subscribed')
  }

  async function unsubscribe(): Promise<void> {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    if (subscription === null) return
    const endpoint = subscription.endpoint
    await subscription.unsubscribe()
    await apiFetch('/push/subscriptions', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
    })
    setStatus('unsubscribed')
  }

  async function sendTest(): Promise<{ sent: number; pruned: number; failed: number }> {
    return apiFetch('/push/test', { method: 'POST' })
  }

  return { status, subscribe, unsubscribe, sendTest }
}
```

- [ ] **Step 6: Run the push subscription test to verify it passes**

Run: `cd frontend && npx vitest run tests/push/usePushSubscription.test.tsx`
Expected: PASS — 4 tests.

- [ ] **Step 7: Write the failing check-in settings tests**

`frontend/tests/settings/useCheckInSettings.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { server } from '../mocks/server.js'
import { useCheckInSettingsQuery, useUpdateCheckInSettings } from '../../src/settings/useCheckInSettings.js'

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const SETTINGS = {
  enabled: true,
  activeFrom: '09:00',
  activeTo: '18:00',
  checkInsPerDay: 3,
  timezone: 'UTC',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('useCheckInSettingsQuery', () => {
  it('fetches the current settings', async () => {
    server.use(http.get('/api/check-in-settings', () => HttpResponse.json(SETTINGS)))

    const { result } = renderHook(() => useCheckInSettingsQuery(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(SETTINGS)
  })
})

describe('useUpdateCheckInSettings', () => {
  it('PATCHes only the changed fields', async () => {
    let receivedBody: unknown = null
    server.use(
      http.patch('/api/check-in-settings', async ({ request }) => {
        receivedBody = await request.json()
        return HttpResponse.json({ ...SETTINGS, checkInsPerDay: 5 })
      }),
    )

    const { result } = renderHook(() => useUpdateCheckInSettings(), { wrapper })
    result.current.mutate({ checkInsPerDay: 5 })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(receivedBody).toEqual({ checkInsPerDay: 5 })
  })
})
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/settings/useCheckInSettings.test.tsx`
Expected: FAIL — `src/settings/useCheckInSettings.ts` does not exist.

- [ ] **Step 9: Add the settings type and implement the hooks**

Append to `frontend/src/api/types.ts`:

```ts
export interface CheckInSettings {
  enabled: boolean
  activeFrom: string
  activeTo: string
  checkInsPerDay: number
  timezone: string
  updatedAt: string
}
```

`frontend/src/settings/useCheckInSettings.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../api/client.js'
import type { CheckInSettings } from '../api/types.js'

const SETTINGS_KEY = ['check-in-settings'] as const

export function useCheckInSettingsQuery() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => apiFetch<CheckInSettings>('/check-in-settings'),
  })
}

export function useUpdateCheckInSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<CheckInSettings>) =>
      apiFetch<CheckInSettings>('/check-in-settings', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SETTINGS_KEY }),
  })
}
```

- [ ] **Step 10: Run the settings hook test, then write and implement the form**

Run: `cd frontend && npx vitest run tests/settings/useCheckInSettings.test.tsx`
Expected: PASS — 2 tests.

`frontend/tests/settings/CheckInSettingsForm.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '../mocks/server.js'
import { CheckInSettingsForm } from '../../src/settings/CheckInSettingsForm.js'

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const SETTINGS = {
  enabled: true,
  activeFrom: '09:00',
  activeTo: '18:00',
  checkInsPerDay: 3,
  timezone: 'UTC',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('CheckInSettingsForm', () => {
  it('loads and displays the current settings', async () => {
    server.use(http.get('/api/check-in-settings', () => HttpResponse.json(SETTINGS)))

    renderWithClient(<CheckInSettingsForm />)

    expect(await screen.findByDisplayValue('09:00')).toBeInTheDocument()
    expect(screen.getByDisplayValue('3')).toBeInTheDocument()
  })

  it('rejects saving when the entered window is invalid client-side, before hitting the API', async () => {
    server.use(http.get('/api/check-in-settings', () => HttpResponse.json(SETTINGS)))
    let saveWasCalled = false
    server.use(
      http.patch('/api/check-in-settings', () => {
        saveWasCalled = true
        return HttpResponse.json(SETTINGS)
      }),
    )
    const user = userEvent.setup()

    renderWithClient(<CheckInSettingsForm />)
    const activeTo = await screen.findByLabelText(/until|to/i)
    await user.clear(activeTo)
    await user.type(activeTo, '08:00') // before activeFrom's 09:00
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(screen.getByText(/before|after|invalid/i)).toBeInTheDocument()
    expect(saveWasCalled).toBe(false)
  })

  it('saves a valid change', async () => {
    server.use(
      http.get('/api/check-in-settings', () => HttpResponse.json(SETTINGS)),
      http.patch('/api/check-in-settings', () => HttpResponse.json({ ...SETTINGS, checkInsPerDay: 5 })),
    )
    const user = userEvent.setup()

    renderWithClient(<CheckInSettingsForm />)
    const countInput = await screen.findByLabelText(/how many|times per day/i)
    await user.clear(countInput)
    await user.type(countInput, '5')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(screen.getByText(/saved/i)).toBeInTheDocument())
  })
})
```

- [ ] **Step 11: Run the test to verify it fails, then implement**

Run: `cd frontend && npx vitest run tests/settings/CheckInSettingsForm.test.tsx`
Expected: FAIL — component does not exist.

`frontend/src/settings/CheckInSettingsForm.tsx` — implement a straightforward controlled form over the four editable fields (`enabled`, `activeFrom`, `activeTo`, `checkInsPerDay`; `timezone` too if time allows) that:
- Loads via `useCheckInSettingsQuery()`, shows nothing until loaded.
- Client-side validates `activeFrom < activeTo` **before** calling the mutation (mirroring the backend's own check, so the user gets instant feedback rather than a round trip) — string comparison on `HH:MM` values works correctly for this since the format is fixed-width and zero-padded.
- Calls `useUpdateCheckInSettings()` on save, shows a brief "Saved" confirmation on success.

No new interfaces beyond what Steps 9 already defined — write the form following the same controlled-input pattern as `TaskDetail.tsx` from Task 2.

- [ ] **Step 12: Build `PushSettings` and `SettingsScreen`, wire into `App.tsx`**

`frontend/src/push/PushSettings.tsx` — renders `usePushSubscriptionStatus()`'s `status` as a message (including an explicit "Install this app to your home screen first" message for `'unsupported'`, since on iOS that's the single most common reason push doesn't work and a bare "unsupported" is not actionable), a Subscribe/Unsubscribe button depending on `status`, and a "Send test notification" button wired to `sendTest()` with visible request/response feedback — per the Global Constraints, this must be a real, labeled control, not buried.

`frontend/src/settings/SettingsScreen.tsx` — a simple screen composing `<PushSettings />` and `<CheckInSettingsForm />`.

Add minimal navigation in `App.tsx` (a two-state `useState<'tasks' | 'settings'>` and a toggle button is enough — no router library needed for two screens) so `<SettingsScreen>` is reachable.

- [ ] **Step 13: Full verification and commit**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: no type errors; all green.

```bash
git add frontend
git commit -m "feat(frontend): add push notification subscription and check-in settings"
```

---

## Task 6: PWA polish, error boundaries, and documentation

The parts that make this feel like an installed app rather than a demo: a real error boundary so one crashed component doesn't blank the screen, a build that actually produces an installable manifest, and a README so plan 5 (deployment) knows what it's serving.

**Files:**
- Create: `frontend/src/ErrorBoundary.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/index.html`
- Create: `frontend/README.md`
- Test: `frontend/tests/ErrorBoundary.test.tsx`

**Interfaces:**
- Consumes: everything above.
- Produces: `<ErrorBoundary>` wrapping `<App>`'s content; a production build at `frontend/dist/` that deployment plan 5 serves as static files.

- [ ] **Step 1: Write the failing error boundary test**

`frontend/tests/ErrorBoundary.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from '../src/ErrorBoundary.js'

function Bomb(): never {
  throw new Error('boom')
}

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <div>All good</div>
      </ErrorBoundary>,
    )

    expect(screen.getByText('All good')).toBeInTheDocument()
  })

  it('renders a fallback instead of a blank screen when a child throws', () => {
    // React logs the error to console.error during the render pass that
    // triggers the boundary — expected, and silenced here so it doesn't
    // clutter test output.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    consoleSpy.mockRestore()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/ErrorBoundary.test.tsx`
Expected: FAIL — `src/ErrorBoundary.tsx` does not exist.

- [ ] **Step 3: Implement the error boundary**

`frontend/src/ErrorBoundary.tsx`:

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/**
 * React error boundaries must be class components — there is no hook
 * equivalent as of React 18. A crash anywhere in the tree (a bad API
 * response shape, a null-pointer in a component) would otherwise unmount
 * the whole app and leave a blank white screen, which on an installed PWA
 * looks indistinguishable from the app simply failing to launch.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled error in the component tree', error, info.componentStack)
  }

  render() {
    if (this.state.error !== null) {
      return (
        <div>
          <p>Something went wrong. Reloading usually fixes it.</p>
          <button type="button" onClick={() => globalThis.location.reload()}>
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
```

- [ ] **Step 4: Run the test to verify it passes, then wrap `App.tsx`**

Run: `cd frontend && npx vitest run tests/ErrorBoundary.test.tsx`
Expected: PASS — 2 tests.

In `main.tsx`, wrap the rendered `<App />` in `<ErrorBoundary>` (outside `<App>`, not inside it — a crash in `QueryClientProvider` itself should still be caught).

- [ ] **Step 5: Verify the PWA manifest and installability**

Run: `cd frontend && npm run build`
Expected: a `dist/` directory containing `manifest.webmanifest` (or `.json`, depending on `vite-plugin-pwa`'s output naming — check what actually gets emitted) and a built `sw.js`. Open `dist/index.html`'s referenced manifest link and confirm the `name`, `icons`, and `display: standalone` fields are present and match Task 5's config.

This is a manual check, not a vitest test — Vite's production build behavior isn't something to re-implement inside a test.

- [ ] **Step 6: Write `frontend/README.md`**

Cover: how to run the dev server (`npm run dev`, requires the backend running per `backend/README.md` and Task 0's setup), how to run tests, how the API proxy works in dev vs. production (relative `/api/...` always — see `Global Constraints`), what `npm run build` produces and where deployment plan 5 should point Caddy, the iOS install-first constraint for push (link back to backend's `POST /push/test` explanation), and that app icons at `public/icon-*.png` are placeholders pending real design assets.

Verify every claim in it against what actually shipped before committing — the same discipline every backend plan's README got.

- [ ] **Step 7: Final full verification and commit**

Run: `cd frontend && npx tsc --noEmit && npm test && npm run build`
Expected: no type errors; all tests green; a successful production build.

```bash
git add frontend
git commit -m "feat(frontend): add error boundary, verify PWA build, document the app"
```

---

## Definition of Done

- [ ] `cd frontend && npm test` passes, with no test making a real network request (MSW's `onUnhandledRequest: 'error'` config is what enforces this).
- [ ] `cd frontend && npx tsc --noEmit` reports no errors.
- [ ] `cd frontend && npm run build` succeeds and produces an installable manifest + service worker.
- [ ] With the real backend running (Task 0's setup) and `npm run dev`: entering a token reaches the task list; capturing a dump shows parsed tasks; asking "I have 20 minutes" shows a shortlist and creates nothing; a flagged task can be broken down and saved; subscribing to push and hitting "Send test notification" from a real browser (not just the test suite) delivers a real notification.
- [ ] A deliberately wrong token results in a 401 that bounces back to the token-entry screen, not a blank error page.

## What This Plan Deliberately Leaves Out

- **Deployment** — production Docker, Caddy reverse-proxy config (which is what makes the `/api` relative-path assumption true in production), and the VPS. Plan 5's job.
- **CORS configuration** — deliberately unnecessary given the same-origin design above; if plan 5 ever splits frontend and backend across origins, that decision revisits this plan's `API_BASE` assumption.
- **Real app icons and visual design** — placeholders ship; a design pass is out of scope.
- **A router library** — two screens (`tasks`, `settings`) don't need one; revisit if the screen count grows.
- **Offline support** — explicitly ruled out by the backend's one-way sync model; this plan does not cache API data for offline use, only static assets for installability.
