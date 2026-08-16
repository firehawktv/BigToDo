---
version: 1
slug: "frontend-src-tasks"
primary_target: "frontend/src/tasks"
related_targets: []
---

## Scope & mode

Operate. Primary surface: the Tasks screen (capture strip + task rack), the app's home view and the one used most.

## Audience, job, action, proof, constraints

- Single user, reaching for the phone in short bursts throughout the day to dump a thought before it's lost, or to glance at what's open.
- Job: capture fast with zero friction; scan open tasks at a glance; check tasks off; optionally accept an AI subtask breakdown.
- Constraint: no gamification, no urgency theater — nudge, don't nag (PRODUCT.md).

## Chosen direction & memorable moment

"The Kneeboard" (see DESIGN.md). Memorable moment: checking a task off feels like a physical strip pulled off the rack — a small settle/slide, then it's gone, no celebration chrome.

## Unresolved decisions

- Exact desktop-specific layout (mobile-first composition is established; desktop currently inherits it with more breathing room only).
- Exact shadow/radius/ring values for the "cut paper" card treatment.
- Contrast-ratio tuning of the established palette against WCAG AA.
