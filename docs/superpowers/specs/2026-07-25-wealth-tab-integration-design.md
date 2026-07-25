# Wealth Tab Integration — Design

**Date:** 2026-07-25
**Repo:** Rowusuduah/moneytrack
**Source material:** `wealth_os (1).html` (Wealth Corridor — Capacity Analysis dashboard, provided by user; copied into repo as `plan.html`)

## Goal

Add a fifth first-class tab, **Wealth**, to the MoneyTrack PWA. The tab turns the static Wealth Corridor plan into a live dashboard driven by MoneyTrack's own data: transactions logged in the Tracker automatically show each plan allocation as paid / partially spent / over, savings progress fills against the monthly target, and the milestone ladder fills from real account balances.

## Decisions made (with user)

1. **Scope:** Live parts + key plan pages. The tab contains the live status board, savings progress, milestone ladder, and the interactive Savings Studio (slider + projection). The static deep-reading content (How to invest, Nonresident tax, Ghana, Scenarios, etc.) ships unmodified as `plan.html`, linked from the tab footer.
2. **Time window:** Calendar month. Status resets on the 1st. Each group shows its monthly allocation (biweekly × 2) vs. actual spend this month.
3. **Milestone source of truth:** Latest account-balance snapshot (savings-group total) fills the ladder. "Saved this month" comes from Savings Transfer + Investment transactions.
4. **Plan config:** All plan numbers live in a single commented `PLAN` object at the top of `js/wealth.js`. No settings UI. Changing rent or pay = edit one line.
5. **Approach:** New `js/wealth.js` module + new tab section (approach A). Native MoneyTrack styling via existing design tokens; app.js touched minimally.

## Files

| File | Change |
|---|---|
| `js/wealth.js` | **New.** `PLAN` config, `WEALTH_CATEGORY_MAP`, pure compute functions, `renderWealthTab()` + child renderers. |
| `index.html` | Fifth tab button (`tab-wealth`, after Things), `sec-wealth` section skeleton (empty containers), `<script src="js/wealth.js">` after app.js. |
| `js/app.js` | Add `{ tabId: 'tab-wealth', secId: 'sec-wealth' }` to `TABS`; add `if (targetTabId === 'tab-wealth') renderWealthTab();` to `switchTab()`. Nothing else. |
| `css/styles.css` | New `.wl-*` component classes, built only from existing design tokens. |
| `plan.html` | **New.** Verbatim copy of the wealth_os dashboard for deep reading. Opens in a new browser tab from the Wealth tab footer link. |
| `sw.js` | Bump `CACHE_NAME` to `moneytrack-v13`; add `./js/wealth.js` and `./plan.html` to `APP_SHELL`. |
| `CLAUDE.md` | Document `js/wealth.js`, the `PLAN`-is-the-only-source-of-plan-numbers rule, and the category-map maintenance note. |

No new dependencies. No build tooling. No new localStorage keys (Drive backup/restore is unaffected).

## `PLAN` config (js/wealth.js)

A single object holding, at minimum:

- `netPerCheck: 2778.95`, `payAnchor: '2026-07-24'` (a real payday, confirmed by user; biweekly anchor used to compute expected paydays in the current month)
- `savingsTargetMo: 3000` (the live monthly savings target)
- `groups`: the nine fixed allocation groups from the plan — id, label, monthly amount (biweekly sub × 2), and for bill-like lines a `bills` list (`{ label, monthlyAmount, categories }`) used for paid-chips:
  Giving, Housing, Transport, Subscriptions, Protection & obligations, Exploration, Ghana family, Annual irregular, Professional dev
- `dailyLivingMo`: derived = (net×2 − fixed monthly total − savingsTargetMo); the living split labels/ratios for display
- `milestones`: `[ { label: 'Starter buffer', amount: 2000 }, { label: 'Tax reserve', amount: 3500 }, { label: 'Emergency fund', amount: 13000 }, { label: 'NIW reserve', amount: 10000 } ]`
- Studio defaults: `returnPct: 6.7`, `years: 30`, the level-of-service grade thresholds, 401k monthly equivalent (`kMo`) for the projection

Exact dollar values are transcribed from `wealth_os (1).html` lines 423–479 during implementation.

## Category mapping (`WEALTH_CATEGORY_MAP`)

Maps MoneyTrack transaction categories → plan groups. Explicit table in code:

| Plan group | MoneyTrack categories |
|---|---|
| Giving | Tithe, Offering |
| Housing | Rent, Utilities |
| Transport | Gas, Car Insurance, Parking, Rideshare |
| Subscriptions | Subscriptions, Streaming |
| Protection & obligations | Insurance, Gifts, Family Support (US), Friends Support |
| Exploration | Travel, Events |
| Ghana family | Family Support (Ghana) |
| Professional dev | Education |
| Savings | Savings Transfer, Investment |
| Daily living | Groceries, Dining Out, Fast Food, Food Delivery, Snacks & Drinks, Coffee, Personal Care, Beauty & Grooming, Clothing, Shoes & Accessories, Medical, Pharmacy, Gym, Household Essentials, Home & Furniture, Amazon, Online Shopping, Electronics, School Supplies, Laundry, Hobbies, Miscellaneous |

**Excluded from the board entirely:** income categories, Bill Reserve, Loan Payment, Credit Card Payment, Bank Fee, and `type === 'transfer'` transactions *except* those categorized Savings Transfer / Investment (which count toward Savings).

**Unmapped:** any spend this month in a category not in the map (including future custom categories) is summed and listed in the footer — visible, never silently dropped.

**Note:** Annual irregular has no mapped MoneyTrack categories (nothing matches Sprintax filing / FL registration today). Its card always shows $0 spent; when such a spend happens it appears in the unmapped footer, and a category can be added to the map then.

## Wealth tab layout (top to bottom)

1. **Month header.** Month name, paydays landed vs. expected this month (expected computed from `payAnchor`; landed = count of Paycheck income transactions), net landed so far. Third-check months get a callout: "3rd check month — plan says sweep the extra to savings."
2. **Allocation status board.** One card per group (9 fixed + Daily living). Card shows: monthly allocation → spent this month → money left; progress bar (token green → amber ≥80% → red over 100%, capped at 100% width with "over by $X" text). Bill lines inside a card render paid-chips: "Rent ✓ paid Jul 3" (≥1 matching expense txn this month, latest date shown, multiple txns summed) or "Rent — due".
3. **Savings this month.** Sum of Savings Transfer + Investment txns this month vs. `savingsTargetMo`, as a progress bar with "$X to go" and "Nth paycheck pending" context from the header's payday math.
4. **Milestone ladder.** Latest snapshot's savings-group total poured sequentially into the four milestones. Shows each stage filled/partial/empty, the active stage, and "as of <snapshot date>". No snapshot → friendly empty state: "No snapshot yet — take one in Accounts."
5. **Savings studio (what-if).** Ported from wealth_os: savings/mo slider, level-of-service grade (A–F) with verdict text, paycheck corridor bar, 30-year projection SVG chart with real-return and years sliders. Explicitly labeled what-if; it does not change the live target (that's `PLAN.savingsTargetMo`).
6. **Footer.** Unmapped-spend list (if any) + "Read the full plan →" link to `plan.html` (`target="_blank"`, `rel="noopener"`).

## Data flow

- `switchTab('tab-wealth')` → `renderWealthTab()` → `loadTxns()` once, filter to current calendar month, aggregate by map → render all blocks. `getLatestSnapshot()` → ladder. Re-render on every tab entry = always current; no caching, no listeners, no new state.
- Compute functions are pure (txns + PLAN in → numbers out) and separated from renderers, matching app.js's existing "child renderers take pre-fetched data" convention.

## Conventions & security (per CLAUDE.md)

- All user-controlled strings through `escapeHTML()`; colors only from `PLAN`/`CATEGORY_COLORS`; no `eval`, no raw-string `innerHTML`.
- Money through `roundMoney()`/`fmt()`; dates via `todayISO()` and `new Date(iso + 'T00:00:00')`.
- CSS uses existing tokens only; no hardcoded hex.
- Tab is keyboard-navigable via the existing arrow-key handler (it iterates `TABS`); section gets proper `role="tabpanel"`/aria wiring identical to the other four; dynamic regions `aria-live="polite"`; decorative chart `aria-hidden="true"`.

## Edge cases

- Fresh month / no txns → full allocations, $0 spent, chips "due", no errors.
- No snapshots → ladder empty state (above).
- Overspend → "over by $X", red, bar capped.
- 3 paychecks logged but anchor says 2 (or vice versa) → trust logged count for "landed", anchor for "expected"; show both honestly.
- localStorage unavailable → existing load functions already return safe defaults; tab renders zeros without crashing.

## Testing (manual — repo has no test framework)

Run locally (e.g. `python -m http.server`), then:

1. Seed one expense txn per mapped category → verify each lands in the right group and sums match by hand.
2. Rent txn → Housing chip flips to ✓ with date; delete it → back to "due".
3. Savings Transfer + Investment txns → savings bar sums both.
4. Overspend a group → red "over by $X".
5. Fresh profile (no data) → all empty states render.
6. Snapshot with savings balances → ladder fills sequentially; partial stage math correct.
7. Third-paycheck month simulation (3 Paycheck txns) → callout appears.
8. Keyboard arrow navigation reaches the Wealth tab; screen-reader labels present.
9. Export backup → restore → Wealth tab unchanged (no new keys).
10. Lighthouse/devtools offline check: app shell including wealth.js and plan.html loads offline after first visit.

## Out of scope

- Editing plan numbers in the UI (config-in-code by decision #4).
- Rewriting or restyling `plan.html` content.
- Auto-creating transactions from the plan (e.g. "mark rent paid" button that logs a txn) — could be a future enhancement.
- Per-paycheck (biweekly) status window.
