# MoneyTrack — CLAUDE.md

## Project Overview

MoneyTrack is a personal finance tracker built as a pure vanilla HTML/CSS/JavaScript SPA with no framework, no build tooling, and no backend. All data is persisted via `localStorage`.

## File Structure

```
Finance Tracker/
├── index.html        # Full app markup — semantic HTML, ARIA roles, tab structure
├── css/
│   └── styles.css    # Design tokens (CSS variables), layout, components, responsive
└── js/
    └── app.js        # All application logic — config, data layer, rendering, events
```

## Architecture

### Single source of truth for accounts
The `ACCOUNTS` array in `js/app.js` (line 10) is the **only** place account definitions should live. Account IDs, labels, groups (`checking` / `savings` / `debt`), and colors all come from here.

- Do NOT hardcode account IDs (`chase_checking`, `usf_checking`, etc.) elsewhere in the codebase
- Account `<select>` dropdowns (`#txn-account`, `#filter-account`) must be populated dynamically from `ACCOUNTS`
- KPI calculations, NW trend, and export must derive group totals using `.filter(a => a.group === '...')` on `ACCOUNTS`

### Data layer
- `loadSnapshots()` / `saveSnapshots()` — account balance snapshots
- `loadTxns()` / `saveTxns()` — transactions
- Both wrap localStorage in try/catch to handle incognito/quota errors gracefully

### Rendering model
- Each tab has a top-level render function: `renderAccountsTab()` and `renderTracker()`
- These orchestrate child render functions; all child functions accept pre-fetched data as arguments
- `getFilteredTxns()` is the single filter gateway — call it once per render cycle, pass the result down
- `renderTracker()` must be called in `init()` so the tracker section is pre-populated

### Security
- All user-controlled strings rendered into HTML must go through `escapeHTML()`
- Colors injected into inline styles must come from the `ACCOUNTS` config or `CATEGORY_COLORS` map — never directly from user input
- No `eval()`, no `innerHTML` with raw user strings

### IDs
- Transaction IDs are generated with `Date.now()` — use `crypto.randomUUID()` if collision safety is needed

## Coding Conventions

- `'use strict'` is enabled globally
- Money values: always pass through `roundMoney()` before saving; use `fmt()` for display
- Dates: stored as ISO `YYYY-MM-DD` strings; use `todayISO()` for the current date; parse with `new Date(iso + 'T00:00:00')` to avoid UTC offset issues
- CSS: use existing design tokens (`var(--green)`, `var(--surf2)`, etc.) — do not hardcode color hex values in new code
- Inline styles in HTML: avoid adding new ones; prefer CSS classes

## Known Issues (Pending Fixes)

1. `#txn-account` and `#filter-account` options are hardcoded in HTML instead of being generated from `ACCOUNTS`
2. `renderAccountKPIs`, `renderNWTrend`, and `exportSnapshots` hardcode account IDs instead of using `ACCOUNTS`
3. `renderDailyChart` always shows 30-day buckets regardless of the active filter period
4. `analysis-grid` uses hardcoded inline `grid-template-columns:1fr 1fr` — not responsive on mobile
5. `resetTxnForm` hardcodes `'chase_checking'` as default — should use `ACCOUNTS[0].id`
6. `editTransaction` uses `childNodes[0].textContent` which is fragile — needs a dedicated `<span>` for the title text
7. No duplicate-date guard in `saveSnapshot`

## Accessibility Requirements

- All interactive icon-only buttons must have `aria-label`
- Dynamic regions that update in place must have `aria-live="polite"`
- Decorative charts must have `aria-hidden="true"`
- Tab keyboard navigation: Arrow Left/Right to move between tabs (already implemented)
- Maintain the skip link (`<a class="skip-link" href="#main">`)

## No Build Tooling

This project has no `package.json`, no bundler, no transpiler. Files are served as-is. Do not introduce dependencies without explicit discussion.
