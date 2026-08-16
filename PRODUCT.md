# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A single user (the product's owner/builder, self) managing their own personal task list. No accounts, no multi-tenant support — one long-lived API token gates the whole app. The user's situation is ADHD-friendly capture: they need to dump tasks in freeform, at any moment, with minimal friction, and trust the system to structure and remind them later rather than requiring upfront organization.

## Product Purpose

A personal, AI-assisted to-do app: the user dumps tasks in freeform text (one or many at once), Claude parses them into structured, prioritized tasks with time estimates, large/vague tasks can be broken into subtasks on request, and the app nudges the user with deadline alerts and randomized check-ins. Also answers "I have N minutes, what can I get done?" for a short, low-friction shortlist. Success means tasks actually get captured (low enough friction that they aren't lost to working memory) and surfaced back at useful moments, not a complete/polished project-management tool.

## Positioning

Not a general-purpose to-do app: the mechanism is AI-assisted structuring of freeform capture (Haiku parses dumps into structured tasks; Sonnet expands flagged vague/large tasks into subtasks on request) plus proactive, randomized nudges — versus tools that require the user to manually categorize/prioritize up front, or that only remind on fixed schedules the user has to set themselves.

## Operating Context

- Single-page React PWA (installable via Add to Home Screen, notably on iOS), talking to a Fastify/Postgres backend the user self-hosts on their own VPS behind Caddy.
- Primary interaction is a freeform capture input — the same field also doubles as a query surface (e.g. typing "I have 20 minutes").
- Flagged large/vague tasks show a "Break this down?" affordance; accepting it spends a Sonnet call and returns an editable subtask list before saving.
- Web Push notifications for two kinds of nudges: deadline alerts (approaching `due_at`) and randomized check-ins within a configured active-hours window — both need the PWA installed and push permission granted.
- One-way sync: the client always reads/writes through the backend API; Postgres is canonical; no offline support. Acceptable because the user controls the infrastructure the app depends on.
- Full architecture and data model are recorded in `docs/superpowers/specs/2026-08-10-todo-app-design.md` — treat that as the detailed technical reference behind this summary.

## Capabilities and Constraints

- No native app in v1 (PWA only) — chosen specifically to avoid Apple Developer account/code-signing overhead.
- No accounts/multi-user auth — a single bearer API token.
- No offline-first support; the app is unusable if the VPS is unreachable.
- No gamification (no points/streaks/summaries) in v1.
- No pattern-learned prioritization — priority is Claude-suggested once, then plain user-editable field, no learning loop.
- No voice input — capture is text-only for now.
- No focus-mode timer, no rich/actionable push notifications, no App Store distribution.
- Claude API calls are server-side only; the key never reaches the client.

## Brand Commitments

None decided yet. Working name is "ToDo App" (not a fixed product name); no logo, wordmark, or fixed voice/tone has been committed to. Open for future design work.

## Evidence on Hand

No real user data, testimonials, or case studies — this is a pre-launch personal tool with a single intended user. Future design work must not fabricate usage evidence, sample task content beyond clearly-labeled placeholders, or endorsements.

## Product Principles

- Capture friction is the enemy: anything that adds steps between "a task occurs to me" and "it's recorded" works against the product's purpose.
- Structure is the system's job, not the user's: freeform input first, AI-assisted organization after — never require the user to pre-categorize before they can capture.
- Nudge, don't nag: deadline alerts and check-ins should lower the friction to re-engage, not create pressure or guilt (no streaks, no shaming language, no urgency theater).
- Small, opt-in AI spend: heavier AI actions (like Sonnet subtask breakdown) are user-initiated, never automatic-and-silent.
- Built for infrastructure the user controls: self-hosted, single-token auth, and a one-way sync model are accepted trade-offs, not gaps to eventually "fix."

## Accessibility & Inclusion

ADHD-friendly by design intent: low visual clutter, minimal steps to capture, and no artificial time-pressure or urgency cues (aligns with "nudge, don't nag" above). No additional formal accessibility standard has been established yet; treat this as a working constraint to apply in interface design rather than a certified compliance target.
