---
name: ToDo App
description: A pilot's kneeboard checklist, rebuilt as a personal AI-assisted task list.
---

<!-- SEED: established with the user before implementation; re-run /impeccable document once there's code to capture the actual tokens and components. -->

# Design System: ToDo App

## Overview

**Creative North Star: "The Kneeboard"**

The app reads as a pilot's spiral-bound kneeboard: a matte board strapped down for quick glances mid-motion, not a desk tool you sit down to manage. A capture strip is clipped at the top for freeform dumps; task cards rack below it, most-urgent card up top; a binder tab along the bottom edge flips between Tasks and Settings the way a thumb flips a divider. The system is instrument-panel utilitarian on purpose — this is the direct visual answer to a single-user, ADHD-friendly capture tool where the job is "get it down fast, trust it'll be there," never "enjoy managing a list."

The one rejected instinct: this is not a soft, rounded, gamified productivity-app world (no streaks, confetti, mascot chrome, pastel console blocks). Warmth comes from tactile paper-and-clip materiality, not from decoration.

**Key Characteristics:**
- Dark matte board as the ground; cream/paper card stock carries content, never the reverse.
- One reserved amber accent for urgency/priority — its rarity is the point.
- Checklist-instrument type: tabular mono for numbers/times, quiet workhorse sans for prose.
- Depth read through overlapping/clipped paper, never soft glow or blur-glass.
- Motion is physical: a paper-like settle on check-off, a slide-out when a card is pulled.

## Colors

Restrained strategy: a near-black neutral ground, cream paper as the working surface, and a single amber accent reserved for urgency — no secondary or tertiary color family.

### Primary
- **Caution Amber** (`#f0a202`): the system's only saturated color. Marks high-priority/urgent flags and the check-off confirmation. Used sparingly — flag chips and the active capture affordance only, never backgrounds or large fills.

### Neutral
- **Board Black** (`#1a1a18`): the app's ground — nav chrome, the space between cards, the binder-tab bar.
- **Card Stock Cream** (`#f2ecd9`): every task card and the capture strip sit on this — the "paper" the user actually reads.
- **Grease-Pencil Ink** (`#2b2b28`): body text and line work on cream card stock.
- **Gunmetal Chrome** (`#54585c`): structural details — clip rings, dividers, disabled/secondary controls.

Exact contrast ratios and any tonal ramp (hover/pressed states) are directional starting points, to be confirmed against WCAG AA during implementation.

### Named Rules
**The One Flag Rule.** Amber never fills a surface or decorates a heading — it exists only as a priority flag, a check-off flash, and the active capture affordance. If more than one thing on screen is amber at rest, the rule has already broken.

## Typography

**Body Font:** system-ui stack (`-apple-system, 'Segoe UI', sans-serif`) — a workhorse face, no webfont load for prose.
**Label/Mono Font:** IBM Plex Mono — checklist labels, due dates/times, estimated-duration figures; chosen for real tabular figures and an engineered, instrument-panel character that a generic system mono doesn't carry.

**Character:** No display face. Hierarchy comes from weight, case, and tabular alignment — like a checklist, not a magazine — never from a large decorative headline.

### Hierarchy
- **Title** (600 weight, 1.25rem): screen/section titles ("Tasks", "Settings") in the binder-tab bar.
- **Body** (400 weight, 1rem, sans): task titles, notes, capture textarea.
- **Label** (500 weight, 0.875rem, IBM Plex Mono, uppercase, 0.03em tracking): due dates, time estimates, priority flags, status chips.

### Named Rules
**The No-Display Rule.** This system has no headline face and no oversized hero type — checklist legibility outranks expression everywhere on this surface.

## Layout

Mobile-first, single continuous board (the primary use case is quick phone captures throughout the day): a capture strip pinned at the top of the viewport, the task rack filling the remaining scrollable space, and a binder-tab bar pinned to the bottom edge within thumb reach. Desktop composition inherits the same board — more breathing room around a centered, board-width column rather than a distinct desktop layout; a true desktop-specific pass is undecided and left to implementation.

## Elevation & Depth

Flat and tactile, not glassy: depth reads through overlapping and clipped paper, never soft ambient shadow or blur. The one exception is the AI-parsed review card (see Components note below), which casts a small, hard paper-edge shadow to read as "loose, not yet filed." Exact shadow values are undetermined; resolve during implementation within this flat/tactile constraint.

### Named Rules
**The Flat-Board Rule.** Nothing on the board glows or floats on ambient shadow. If something needs to look unsettled, it's because it's a loose card sitting slightly askew — not because of a drop shadow.

## Shapes

Cards are cut-paper rectangles with a small corner radius (evokes trimmed card stock, not a rounded plastic tile). A recurring clip-ring motif — small circles along one card edge — marks something as a card rather than a generic list row; exact radius and ring treatment to be resolved during implementation.

## Do's and Don'ts

### Do:
- **Do** reserve Caution Amber (`#f0a202`) for priority flags and check-off confirmation only (The One Flag Rule).
- **Do** render the AI-parsed review batch as a visibly loose, slightly askew card — provisional until the user confirms it — a raise donated from the "Exposure Record" catalog challenger's overlay discipline.
- **Do** size checkboxes and primary controls for one-handed thumb use, since the dominant use case is a quick capture mid-motion on a phone.
- **Do** use IBM Plex Mono for every numeric/time/label value; keep body prose in the system sans stack.

### Don't:
- **Don't** add streaks, points, confetti, or any celebratory chrome beyond the physical check-off/pull motion — the product's explicit anti-reference is gamified productivity apps.
- **Don't** introduce a second display or decorative typeface; the system is workhorse mono + sans only, with no headline face.
- **Don't** soften Board Black into a plain white card list — the dark matte ground with cream card inserts is the system's identity, not a dark-mode variant of something else.
- **Don't** use soft ambient shadows or glassmorphism for depth; depth comes from overlapping paper only (The Flat-Board Rule).
