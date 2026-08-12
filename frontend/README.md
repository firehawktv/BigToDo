# ToDo App Frontend

A React + TypeScript PWA for the single-user ToDo app. See
`docs/superpowers/specs/2026-08-10-todo-app-design.md` for the product
design and `backend/README.md` for the API this talks to.

## Setup and dev server

The backend must already be running — see `backend/README.md`'s Setup
section (Task 0) for `docker compose up`, migrations, `.env`, and
`npm run dev` on the API side. It listens on `http://localhost:3000` by
default, which is what this app's dev proxy targets.

```bash
npm install
npm run dev
```

Vite serves the app at `http://localhost:5173` (its default port). Requests
to `/api/...` are proxied to `http://localhost:3000` with the `/api` prefix
stripped, per `vite.config.ts`'s `server.proxy` config — so in dev, a
request to `/api/tasks` reaches the backend's `/tasks`.

On first load you'll be asked for an access token (`TokenGate`) — use the
`API_TOKEN` value from the backend's `.env`. A wrong token, or a token that
stops working, is caught by every API call (`src/api/client.ts` clears the
stored token and notifies subscribers on any `401`), which bounces the app
back to this same token-entry screen rather than showing a blank page.

## Tests

```bash
npm test          # runs once
npm run test:watch
```

Tests use Vitest, React Testing Library, and MSW. MSW's server is
configured with `onUnhandledRequest: 'error'` (`tests/mocks/server.ts`), so
any test that accidentally makes a real network call fails loudly instead
of hitting a live backend.

```bash
npx tsc --noEmit   # type-check without emitting
npm run lint       # eslint
```

## API proxy: dev vs. production

`src/api/client.ts` always calls relative `/api/...` paths — there is no
`API_BASE` environment variable to configure per environment. This works in
both places for different reasons:

- **Dev**: Vite's `server.proxy` (`vite.config.ts`) forwards `/api/*` to
  `http://localhost:3000/*`.
- **Production**: the frontend and backend are served same-origin. Plan 5's
  Caddy config is what makes `/api/*` resolve to the backend there — that
  reverse-proxy setup is out of scope for this plan. Because the split is
  same-origin, no CORS configuration is needed on the backend either; if a
  future deployment ever puts the frontend and backend on different origins,
  that decision needs to revisit this `API_BASE` assumption.

## Building for deployment

```bash
npm run build
```

Produces a static, deployable `dist/` directory:

- `dist/index.html`, `dist/assets/*` — the app itself.
- `dist/manifest.webmanifest` — the PWA manifest (`name`, `icons`, `display:
  standalone`, etc., configured in `vite.config.ts`'s `VitePWA` plugin
  options), linked from `index.html` automatically at build time.
- `dist/sw.js` — the built service worker (from `src/sw.ts`, using
  `vite-plugin-pwa`'s `injectManifest` strategy), which precaches the app
  shell for installability. This app does not cache API responses or work
  offline — the backend's one-way sync model rules that out — only static
  assets are cached.
- `dist/registerSW.js` — registers the service worker on load.
- `dist/icon-192.png`, `dist/icon-512.png` — copied from `public/`.

Deployment plan 5 should point Caddy's static file server at `dist/` and
reverse-proxy `/api/*` to the backend, per the section above. No build-time
environment variables are required for the frontend build itself.

## Push notifications and the iOS install constraint

Push subscription and a "Send test notification" action live in the
Settings screen (`src/push/usePushSubscription.ts`, wired into
`src/push/PushSettings.tsx`). Subscribing calls the backend's
`GET /push/vapid-public-key`, then `POST /push/subscriptions`; the test
button calls `POST /push/test`.

iOS Safari only exposes the Push API (`Notification`, `PushManager`) to a
PWA that has been **added to the home screen** — a page open in a regular
Safari tab has no push support at all, and `usePushSubscriptionStatus`
correctly reports this as `'unsupported'` rather than treating it as a bug.
See `backend/README.md`'s notes on `POST /push/test` for why that endpoint
exists: verifying push end-to-end, especially on iOS's install-and-permission
dance, is fiddly enough to warrant a dedicated just-try-it call instead of
waiting on a real deadline or check-in to find out it doesn't work.

## App icons

`public/icon-192.png` and `public/icon-512.png` are placeholders. Real app
icons and any broader visual design pass are explicitly out of scope for
this plan.

## Screens

There's no router — `src/App.tsx` toggles between two screens (`tasks`,
`settings`) with local `useState`, which is enough for two screens. This
should be revisited if the number of screens grows.

- **Tasks** (`src/tasks/TaskList.tsx`, `src/capture/CaptureBox.tsx`):
  capture a raw text dump, review the tasks the backend's LLM parsed out of
  it, view/edit/delete tasks (the "Edit" button on each task opens
  `src/tasks/TaskDetail.tsx` inline for notes, priority, due date, and
  estimate), and break a flagged task down into subtasks
  (`src/tasks/BreakdownModal.tsx`).
- **Settings** (`src/settings/SettingsScreen.tsx`): push notification
  subscribe/unsubscribe/test, and check-in schedule preferences
  (`src/settings/CheckInSettingsForm.tsx`).

## Error handling

`src/ErrorBoundary.tsx` wraps the entire app (outside `QueryClientProvider`,
in `src/main.tsx`) so a crash anywhere in the component tree renders a
"something went wrong, reload" fallback instead of leaving a blank screen —
which on an installed PWA is otherwise indistinguishable from the app
failing to launch at all.
