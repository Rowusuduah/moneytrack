# MoneyTrack — CLAUDE.md

## Project Overview

MoneyTrack is a personal finance tracker built as a pure vanilla HTML/CSS/JavaScript SPA with no framework, no build tooling, and no backend. All data is persisted via `localStorage`.

## File Structure

```
Finance Tracker/
├── index.html        # Full app markup — semantic HTML, ARIA roles, tab structure
├── css/
│   └── styles.css    # Design tokens (CSS variables), layout, components, responsive
├── js/
│   ├── app.js        # Core app logic — config, data layer, rendering, events
│   ├── wealth.js     # Wealth tab — PLAN config, category map, live plan renderers
│   └── africa.js     # Africa tab — GHS/USD investments, manual FX rate, renderers
└── tests/
    ├── wealth.test.mjs   # Node unit tests for wealth.js pure functions (node --test)
    └── africa.test.mjs   # Node unit tests for africa.js pure functions (node --test)
```

## Architecture

### Single source of truth for accounts
The `ACCOUNTS` array in `js/app.js` (line 10) is the **only** place account definitions should live. Account IDs, labels, groups (`checking` / `savings` / `debt`), and colors all come from here.

- Do NOT hardcode account IDs (`chase_checking`, `usf_checking`, etc.) elsewhere in the codebase
- Account `<select>` dropdowns (`#txn-account`, `#filter-account`) must be populated dynamically from `ACCOUNTS`
- KPI calculations, NW trend, and export must derive group totals using `.filter(a => a.group === '...')` on `ACCOUNTS`

### Single source of truth for plan numbers
The `PLAN` object at the top of `js/wealth.js` is the **only** place Wealth-plan
numbers live (net per check, payAnchor, group allocations, milestones, savings
target). Pay or rent changes are one-line edits there. `WEALTH_CATEGORY_MAP`
in the same file maps transaction categories to plan groups; a category missing
from the map shows up in the Wealth tab's "not counted" footer — add it to the
map rather than special-casing renderers. Top-level code in wealth.js must stay
DOM-free and app.js-free so `node --test` (run from the repo root) keeps working.
The Wealth tab's Day/Week/Month/Year toggle scales allocations by annualized
factors (12/365.25, 12/52, 1, 12); weeks run Sunday–Saturday; paid chips are
Month-view only. The Tracker Budget card's "Fill from Wealth plan" button
merges `wlPlanBudgets()` (bill-level amounts, first category per bill) into
the saved budgets — it never clears categories the plan doesn't price.

### Africa investments
The Africa tab (`js/africa.js`, storage key `moneytrack_africa`) tracks
Ghana/Nigeria investments in their own currency (GHS or USD) — amounts are
never converted at rest. One manual rate (GH₵ per 1 USD) powers the
estimate lines and the Accounts-tab "Africa (est.)" / "Global Total" KPIs;
Africa money never enters `calcNetWorth`, snapshots, the NW trend, or
CSV/PDF exports. Top-level africa.js code stays DOM-free so `node --test`
keeps working.

### Credit-card flow
Card purchases are logged at buy time as expenses on the card account with
their real category — that is when they count as spending. The statement
payment is a transfer checking → card (a legacy 'Credit Card Payment'
expense is tolerated: NON_EXPENSE_CATS keeps it out of spending, and with a
single debt account it counts as a card payment). `cardOwedNow()` renders
the live per-card balance on Debt Details; KPIs and Net Worth stay
snapshot-based.

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
- All entity IDs (transactions, loans, bills, goals, things) use `crypto.randomUUID()`

## Coding Conventions

- `'use strict'` is enabled globally
- Money values: always pass through `roundMoney()` before saving; use `fmt()` for display
- Dates: stored as ISO `YYYY-MM-DD` strings; use `todayISO()` for the current date; parse with `new Date(iso + 'T00:00:00')` to avoid UTC offset issues
- CSS: use existing design tokens (`var(--green)`, `var(--surf2)`, etc.) — do not hardcode color hex values in new code
- Inline styles in HTML: avoid adding new ones; prefer CSS classes

## Accessibility Requirements

- All interactive icon-only buttons must have `aria-label`
- Dynamic regions that update in place must have `aria-live="polite"`
- Decorative charts must have `aria-hidden="true"`
- Tab keyboard navigation: Arrow Left/Right to move between tabs (already implemented)
- Maintain the skip link (`<a class="skip-link" href="#main">`)

## No Build Tooling

This project has no `package.json`, no bundler, no transpiler. Files are served as-is. Do not introduce dependencies without explicit discussion.
