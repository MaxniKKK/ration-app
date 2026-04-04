# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Rationapp is a single-file collaborative meal planning and nutrition tracking web app for two people ("You"/"Her"), built in Ukrainian. It requires no build step — the entire application is `meal-planner.html` (~1,735 lines).

**Stack:** Vanilla HTML/CSS/JS + Firebase Realtime Database + Open Food Facts API

## Running the App

Open `meal-planner.html` directly in a browser. No server, build tool, npm, or install step required.

On first load, a setup screen prompts for Firebase credentials (stored in `localStorage`). Default credentials are hardcoded in the HTML `<head>` (lines 19–30).

## Architecture

The entire app lives in one file with three logical sections:

- **CSS** (lines ~32–271): Dark theme with CSS custom variables. Two accent colors: `#c8f54a` (You) and `#ff6b35` (Her).
- **HTML** (lines ~273–495): Three screens rendered as tab panels — `screen-menu`, `screen-diary`, `screen-search`.
- **JavaScript** (lines ~495–1733): All logic, Firebase integration, and rendering.

### Data Model

Two global objects synced to Firebase Realtime Database:

```js
MENU = {
  you: { 1: { totals, breakfast, snack1, lunch, snack2, dinner }, ... 6 },
  her: { 1: { ... }, ... 6 }
}

DIARY = {
  "YYYY-MM-DD": { you: { breakfast, snack1, lunch, snack2, dinner }, her: { ... } }
}
```

Each meal slot is an array of food items with `{ name, kcal, protein, fat, carbs }`. `totals` stores daily macro targets.

### Key Globals

| Variable | Purpose |
|----------|---------|
| `db` | Firebase Realtime Database reference |
| `MENU` | Weekly meal plan (days 1–6) |
| `DIARY` | Daily logs keyed by ISO date string |
| `curDay` | Selected day index (1–6) |
| `person` | Active person (`"you"` or `"her"`) |
| `editMode` | Boolean, true when meal editing is active |
| `selDate` | Currently viewed diary date |

### Screens

1. **Menu** (`screen-menu`): Browse/edit weekly plan by day and person. `toggleEdit()` enables inline editing; `saveEdit()` writes to Firebase.
2. **Diary** (`screen-diary`): Month/week calendar views. `logToday()` snapshots today's menu into DIARY.
3. **Search** (`screen-search`): Queries Open Food Facts API (`world.openfoodfacts.org`) and displays macro cards.

### Firebase Sync

- `initFirebase()` connects using config from `localStorage` or hardcoded defaults.
- `db.ref('menu').on('value', ...)` and `db.ref('diary').on('value', ...)` keep local state in sync.
- Writes use `db.ref(...).set(...)`. Sync status is shown in the header indicator.

## Locale

All UI text is Ukrainian (`uk-UA`). Day names, meal names, and labels follow Ukrainian conventions. Keep any new UI text in Ukrainian.
