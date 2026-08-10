# ToDo App — Design Spec

**Date:** 2026-08-10
**Status:** Approved for planning

## Summary

A personal, AI-assisted to-do app for a single user (self) with ADHD-friendly capture and reminders. You dump tasks in freeform (one or many at once); Claude parses them into structured, prioritized tasks with time estimates; large/vague tasks can be broken into subtasks on request; the app nudges you with deadline alerts and randomized check-ins; and you can ask "I have N minutes, what can I get done?" for a short, low-friction shortlist. No native app, no accounts beyond a single access token, no gamification in v1.

## Architecture

- **Backend**: Fastify (Node/TypeScript) API, containerized (Docker), running on the user's own VPS behind Caddy (reverse proxy + automatic TLS).
- **Scheduler**: an in-process cron job (e.g. `node-cron`) inside the backend service, responsible for deadline alerts and randomized check-ins.
- **Database**: Postgres, Dockerized on the same VPS.
- **AI**: Claude API called server-side only (API key never reaches the client).
  - **Haiku** — parsing dumped text into structured tasks (title, due date, priority signal, estimated duration) and flagging tasks that look like large/vague projects.
  - **Sonnet** — generating a subtask breakdown when the user opts in on a flagged project task.
- **Frontend**: React + Vite single-page app, installable as a PWA (Add to Home Screen on iOS). This is the only client — no native iOS app in v1.
- **Notifications**: Web Push (VAPID keys generated and stored on the server). The scheduler decides *when* to send; the browser/OS handles delivery once the user has subscribed. Chosen specifically because it requires no Apple Developer account (free or paid) — unlike a native app, which would need one for code-signing.
- **Auth**: a single long-lived API token configured once and sent as a bearer token by the client. No user registration/accounts — this is single-user only.
- **Sync model**: one-way source of truth. The client always reads/writes through the backend API; Postgres is canonical. No offline-first support — if the VPS is unreachable, the app can't sync. Acceptable for a personal tool on infrastructure the user controls.

### Why not other options considered

- **Supabase-backed** (Postgres+Auth+Edge Functions managed service) was the original recommendation for minimal ops, but the user wants to self-host on an existing VPS instead.
- **Native iOS app** (SwiftUI) was considered and designed in detail, including running on a free Apple Developer account (viable, since local notifications need no special entitlement). It was ultimately dropped in favor of PWA-only once the user weighed the recurring 7-day resign chore (free account) or $99/yr cost (paid account) against a web-only approach that needs neither.

## Data Model (Postgres)

**`tasks`**
- `id`
- `title`
- `notes` (nullable — raw original text snippet, if useful)
- `status` (`open` / `done`)
- `priority` (`low` / `medium` / `high` — Claude-suggested, user-editable)
- `due_at` (nullable timestamp)
- `estimated_minutes` (nullable int — Claude-suggested)
- `parent_task_id` (nullable, self-referencing FK — set when this task is a subtask from a breakdown)
- `source` (`manual` / `ai_parsed` / `ai_breakdown`)
- `alerted_at` (nullable timestamp — prevents duplicate deadline pushes)
- `created_at`
- `completed_at` (nullable)

**`capture_batches`**
- `id`
- `raw_text` — the original freeform dump, preserved for traceability/debugging of parsing quality
- `created_at`

**`push_subscriptions`**
- `id`
- `endpoint`
- `keys` (p256dh / auth)
- `created_at`

**`check_in_settings`** (single row)
- active hours window (e.g. 9am–6pm)
- rough frequency (e.g. a few times a day)
- enabled/disabled toggle

Subtasks from a project breakdown are just `tasks` rows with `parent_task_id` set. No separate `projects` table — a parent task *is* the project once it has children.

## Core Flows

### 1. Capture & Parsing

1. User dumps freeform text (one or many tasks at once) into a single input.
2. Backend stores it as a `capture_batches` row, then sends it to Haiku with instructions to split it into discrete tasks, extracting per task: a clean title, any explicit deadline mentioned, a priority signal from urgency language (e.g. "ASAP", "urgent", punctuation), and an estimated duration.
3. Response comes back as structured JSON and is inserted as `tasks` rows (`source = ai_parsed`), linked to the batch.
4. The UI shows the newly parsed batch as an editable review list — tasks are live immediately (no hidden draft state); the user can tweak or delete before moving on.
5. Corrections are just normal field edits. No pattern-learning system in v1 — priority stays a simple, user-correctable field.

### 2. Project Breakdown

1. During the same Haiku parsing pass, each task also gets a heuristic "does this look like a big/vague project?" flag (broad scope, no clear single action, phrasing like "redesign," "plan," "organize"), returned as part of Haiku's structured output — no extra AI call needed for detection.
2. Flagged tasks show a "Break this down?" affordance in the UI. Breakdown is opt-in, not automatic-and-silent — the user decides when to spend a Sonnet call.
3. On acceptance, backend calls Sonnet with the task title/notes to generate a proposed subtask list.
4. Subtasks are shown as an editable list before saving, then inserted as `tasks` rows with `parent_task_id` set and `source = ai_breakdown`.

### 3. "I have N minutes, what can I get done?"

1. User types (or later, speaks) a phrase like "I have 20 minutes" into the capture input or a dedicated quick-action.
2. Backend detects this is a query via simple pattern matching (no AI call needed — keeps it instant).
3. Queries open tasks where `estimated_minutes <= N`, ordered by priority then due date, returning a short shortlist (top 3-5) rather than every match, to reduce decision paralysis.
4. Picking a task from the shortlist just opens/highlights it. No focus-mode timer in v1.

### 4. Notifications & Check-ins

- **Deadline alerts**: scheduler runs periodically (e.g. every 15 min), checks for tasks with `due_at` approaching within a configurable lead time, sends a Web Push, and stamps `alerted_at` to avoid duplicates.
- **Random check-ins**: within the configured active window (`check_in_settings`), the scheduler picks randomized time(s) per day and sends a Web Push (e.g. "How's it going? Anything on your mind?") that opens the app to the capture input on tap — lowering friction to *use* the list, not just reminding it exists.
- Plain Web Push only (title + body + tap-to-open); no rich notification actions in v1.
- If a push subscription goes stale (e.g. iOS clears PWA data), sends fail silently; no resubscribe-nagging system in v1 — the user will notice next time they open the app.

## Error Handling

- **Claude call failures** (timeout, rate limit, malformed response): the capture batch is still saved with raw text; if parsing fails, the UI falls back to showing the raw dump as a single task with a retry-parse action. Input is never silently lost.
- **Scheduler failures**: logged server-side. No elaborate retry/alerting on top — this is a personal tool, not an SLA'd service.

## Testing Approach

- Unit tests around parsing-response handling (mocking Claude's response shape) and the scheduler's due-date/check-in logic — the parts least safe to eyeball.
- Manual testing for UI flows, given the small surface area and single user.

## Non-Goals for v1

- Native iOS app
- Voice input (capture is text-only for now)
- Pattern-learned prioritization (priority correction is manual only)
- Gamification (no points/streaks/summaries)
- Multi-user support or full auth system (single API token only)
- Offline support
- Rich/actionable push notifications
- Focus-mode timer
- App Store distribution
