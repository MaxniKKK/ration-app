# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Rationapp is a collaborative meal planning, nutrition tracking, and shopping-list app for multiple people, built in Ukrainian. No build step — open `index.html` directly in a browser.

**Stack:** Vanilla HTML/CSS/JS (ES modules) + Firebase Realtime Database + Silpo product API + optional AI (Claude/OpenAI/Gemini) for menu generation. Recipes are scraped from klopotenko.com.

## Files

- `index.html` (~430 lines) — markup only: setup screen, nav, four screens (Menu / Diary / Search / Profile), and a stack of modals (food, person editor, day meals, cart, product card, custom confirm). Loads `app.js` as a module and inlines `window.FIREBASE_CONFIG`.
- `styles.css` (~535 lines) — dark theme with CSS custom variables. Each person has their own accent color (defaults: `#c8f54a` / `#ff6b35`).
- `app.js` (~4400 lines) — all logic: state, Firebase sync, rendering, Silpo API, recipe import, AI menu generation, local generator.
- `recipes.json` (~43k lines) — scraped klopotenko.com recipe DB. Each entry: `{ name, kcal, protein, fat, carbs, ingredients[], category, cuisine, servings, sourceUrl, sourceImage, mealTypes[] }`.
- `classify_recipes.py` — one-shot script that re-tags every recipe in `recipes.json` with `mealTypes` (`breakfast`/`lunch`/`dinner`/`snack`) using Ukrainian keyword regexes over name + klopotenko category. Run with `python classify_recipes.py` from the repo root; it overwrites `recipes.json` in place.

## Running

Open `index.html` in a browser. Firebase credentials are inlined in `index.html` `<head>` via `window.FIREBASE_CONFIG`; the setup screen only fires if `localStorage.fb_cfg` is missing AND no inline config is present.

## Architecture

### State (top of `app.js`, ~line 348)

```js
db                       // Firebase Realtime Database handle
MENU = { [pid]: { [day0..6]: { totals, meals?, breakfast, lunch, ... } } }
DIARY = { "YYYY-MM-DD": { [pid]: { breakfast, ... } } }
FOODS = { [foodKey]: { name, kcal, protein, fat, carbs, source, silpoSlug?, silpoPrice?, ... } }
PEOPLE = { [pid]: { id, name, color, targets{kcal,protein,fat,carbs}, forbidden[], meals[], waterTarget, order } }
curDay, person, editMode, calY/calM/calView, selDate
```

All four collections live under `racion/` in Firebase: `racion/menu`, `racion/diary`, `racion/foods`, `racion/people`. Each is bound with `onValue` in `initFirebase()` and written with `set()` / `update()`.

**Multi-person.** Person IDs are dynamic (not hardcoded `you`/`her`). Always go through accessors `getPerson(pid)`, `getPersonName/Color/Meals/Targets/Forbidden/Water(pid)`, `getPeopleIds()`. Person data is healed against `DEFAULT_PEOPLE` on load so missing fields don't crash. `you` and `her` are seeded as defaults but can be renamed/deleted/joined by others — never assume those IDs exist.

**Per-day meal override.** Each day in `MENU[pid][day]` can carry its own `meals[]` array that overrides the person-level meal slots. Use `getDayMeals(pid, day)` everywhere — never iterate `getPersonMeals(p)` for a specific day. The Day Meals editor (`#dmModal`, `openDayMealsEditor`) writes/clears these overrides.

**Meal items shape.** Each meal slot is `{ kcal, items: [{ n, g, kcal_per_100, protein_per_100, fat_per_100, carbs_per_100, silpoSlug?, silpoPrice?, silpoPriceRatio? }] }`. КБЖУ are stored *per 100g* on the item; totals are recomputed from `g` × `*_per_100` via `calcMealNutr` / `recalcMealKcal`.

### Screens

1. **Menu** (`screen-menu`) — weekly plan per person/day. Edit mode (`toggleEdit`/`saveEdit`/`cancelEdit`) lets you rewrite items; auto-fill (`confirmAutoFill` → `autoFillWeek`) regenerates the whole week. Per-day meal-slot editor accessed via 🍽️ button.
2. **Diary** (`screen-diary`) — month/week calendar. `logToday()` snapshots today's menu into `DIARY[dateKey]`.
3. **Search** (`screen-search`) — three sub-tabs:
   - **Продукти** — local FOODS directory: filter, add, bulk select/delete, refetch all from Silpo (`refetchAllFoods`).
   - **Рецепти** — recipes grouped by `mealTypes` bucket. Bulk import from klopotenko.com (`doBulkImportKlopotenko`), single-URL import (`importKlopotenkoRecipe` via `CORS_PROXY = api.allorigins.win`), coverage analysis (`runRecipeCoverageAnalysis` — checks ≥70% of ingredients exist in FOODS), whitelist filter.
   - **Сільпо** — live product search via `SILPO_API` → autosaves results to FOODS.
4. **Profile** (`screen-profile`) — manage people (add/edit/delete via `#peModal`), targets, meal slots, forbidden lists, AI provider/key settings.

### Local menu generator (`generateMenuForPerson`, ~line 243)

Pure JS generator that fills `MENU[pid]` for all 7 days using `INGREDIENT_POOL` (categories: `protein/dairy/carb/fruit/veggie`). Each meal slot is classified (`classifyMealSlot`) into `breakfast/lunch/dinner/snack`, gets a kcal share from `MEAL_KCAL_SHARE` (normalized across that day's slot count), and is filled from `MEAL_RECIPE[type]`. Only `SCALABLE_CATEGORIES = {protein, carb}` get scaled to hit kcal targets — sides stay near `def` portions clamped to `[min, max]` so you don't get 1.4 kg of tomatoes for dinner. Forbidden ingredients are skipped via substring match. `ensureFoodInDirectory` seeds FOODS from POOL so `enrichFoodsFromSilpo` can later overwrite with real Silpo nutrition.

### Silpo integration

- `SILPO_BRANCH = "1edb7346-..."` (Хмельницький, вул. Свободи 73). To switch branch: GET `https://sf-ecom-api.silpo.ua/v1/uk/branches` and pick a `branchId`.
- `searchFood(q)` — live search via `${SILPO_API}/${SILPO_BRANCH}/products?search=...`.
- `parseSilpoNutr(attributeGroups)` — extracts КБЖУ from product detail response.
- `FOOD_CATEGORIES` — maps ingredient names to `sectionSlug` substrings for category-locked matching during enrichment (so "куряче філе" doesn't return chicken-flavored chips).
- `silpoMatchScore` / `pickBestSilpo` — ranking when multiple results match.
- Auto-fill flow: `autoFillWeek` → `applyPlanTemplate` → `seedFoodsFromMenu` → `enrichFoodsFromSilpo(progress)` → `applyFoodsToMenuItems` → write to Firebase.

### Recipe import & coverage

`importKlopotenkoRecipe(url)` fetches via `CORS_PROXY` and scrapes name/ingredients/category/image. `doBulkImportKlopotenko` walks the klopotenko sitemap and bulk-imports. `inferMealTagsFromCategory` maps klopotenko categories → meal type buckets (`MEAL_TYPE_BUCKETS`, `CATEGORY_TO_MEAL_TYPES`); `SKIP_CATEGORIES` (Соуси/Заготовки/Варення/Маринади) are dropped.

`analyzeRecipeCoverage` checks how many recipe ingredients exist in FOODS:
- `parseIngredientName` → `stemUk` → `stemsOf` produce Ukrainian word stems.
- `TRUE_STAPLE_STEMS` (sіль, перець, олія, вода…) and `OPTIONAL_INGREDIENT_STEMS` are excluded from the denominator (they're assumed pantry staples).
- `ingredientMatchesProduct` uses stem-set matching with `STEM_ALIASES`.
- `RECIPE_WHITELIST_THRESHOLD = 0.7` — recipes ≥70% covered are "whitelisted".

`recomputeRecipeNutrition` re-derives recipe КБЖУ by summing linked FOODS entries × extracted gram weights (`gramsFromRaw`). This is what runs after editing recipe ingredients on the product card.

### AI menu generation

`AI_PROVIDERS = { claude, openai, gemini }` — each entry has the endpoint and request shape. Key is stored in `localStorage` (`ai_key_<provider>`), never sent to Firebase. `buildPlanPrompt(person, mode)` constructs a Ukrainian prompt with the person's targets/forbidden/meals; `callAIProvider` posts it; `parseAIPlanResponse` extracts a JSON menu; `generateMenuViaAI(pid, mode)` writes it to `MENU[pid]`. Triggered from the 🤖 button in the Menu header.

### Custom modals

Don't use `confirm()`/`prompt()`. Use the in-app `cfModal` system (`cfConfirm`, `cfPrompt`, `cfClose`) — rendered via `#cfModal` in `index.html`.

## Locale & conventions

- All UI text is Ukrainian (`uk-UA`); keep new strings in Ukrainian.
- Day numbering follows JS `Date.getDay()` (0 = Sunday … 6 = Saturday). `DAYS` / `DAYS_SH` arrays are indexed accordingly.
- Window globals: most user-facing handlers are exposed as `window.functionName = ...` because they're called from inline `onclick=` in `index.html`. When adding new handlers, follow the same pattern or they won't fire.
- The `INGREDIENT_POOL` `n` field must match a key in `FOOD_CATEGORIES` for Silpo enrichment to find the right product.
