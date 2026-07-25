# Wealth Tab v2 — Time-Window Toggle + Analyst Charts — Design

**Date:** 2026-07-25
**Repo:** Rowusuduah/moneytrack (base: master @ 12c3ba0, Wealth tab v1 shipped)
**Approved by user:** design approved in full; "core analyst set" chart package chosen.

## Goal

Let the Wealth tab be read at four time granularities — Day / Week / Month / Year — and add three analyst-grade charts (spending pace, plan-vs-actual variance, savings trend), all dependency-free SVG.

## Decisions

1. **Chart package:** core analyst set (pace + variance + savings trend). No sparklines, no heatmap.
2. **Toggle placement/effect:** segmented control above the allocation board. Re-scopes: header line, allocation board, savings block, pace chart, variance chart. Does NOT affect milestones (cumulative) or studio (what-if) or savings-trend chart (natively monthly).
3. **Window definitions** (all local time, from `todayISO()`):
   - Day: today only.
   - Week: Sunday through Saturday containing today.
   - Month: calendar month (v1 behavior).
   - Year: calendar year.
4. **Allocation scaling factors** (annualized-standard): day = 12/365.25, week = 12/52, month = 1, year = 12, applied to each group's `monthly` and to `savingsTargetMo` and `dailyLivingMo`. Round with `wlRound` at display time.
5. **Paid chips render only in Month view.** The paycheck-pending savings note renders only in Month view; other windows show the plain to-go text.
6. **Toggle state:** module-level `let wlView = 'month'`; resets on reload; no new localStorage keys. Buttons carry `aria-pressed`.
7. **Pace chart semantics:** budget = window allocation total EXCLUDING savings (fixed groups + daily living, scaled). Actual = cumulative mapped+unmapped expense spend in window (everything wlAggregateRange counts as spending; savings transfers excluded). Week/Month/Year: straight budget-pace line (0 → budget over the window's days) vs. stepped cumulative actual line; the portion of the actual curve above the pace line renders red, rest green-ish per tokens. Day: last 14 days as daily total columns vs. a horizontal daily-budget line (transactions carry no time of day, so intraday pace is impossible).
8. **Variance chart:** own card "Plan vs. actual" below the allocation board. One horizontal bar per group (9 fixed + Daily living; savings excluded), sorted by (actual − allocation) descending (worst overspend first). Bar shows actual as % of allocation, clipped at 200% with a "▸" overflow marker; a vertical 100% reference line; green fill when under, red when over; right-aligned label "+$X over" / "−$X under". Window-aware.
9. **Savings trend chart:** in the Savings card, below the existing bar. Last 6 calendar months (including current), column per month = that month's Savings Transfer + Investment total, dashed horizontal line at `PLAN.savingsTargetMo`, month initial + amount labels. Always monthly.

## New/changed code (all in js/wealth.js unless noted)

### Pure functions (Node-tested)

- `wlWindowBounds(mode, todayIso)` → `{ mode, startIso, endIso, factor, label, daysTotal, daysElapsed }`
  - mode ∈ 'day' | 'week' | 'month' | 'year'. `label` e.g. "Today · Jul 25", "Week of Jul 19–25", "July 2026", "2026".
  - `daysElapsed` counts start→today inclusive; `daysTotal` full window length.
- `wlAggregateRange(txns, startIso, endIso)` — the v1 `wlAggregate` body generalized to an inclusive ISO date range (string comparison). Returns the same shape as v1 `wlAggregate`.
- `wlAggregate(txns, todayIso)` — becomes a thin month wrapper over `wlAggregateRange` with the EXACT v1 signature and return shape; all existing tests must pass unchanged.
- `wlSpendBudget(mode)` → scaled spending budget excluding savings: `(wlFixedMo() + wlDailyLivingMo()) × factor`.
- `wlPaceSeries(txns, bounds)` → `{ days: [{ iso, total }...], cumulative: [n...] }` for the window (spending txns only, same inclusion rules as aggregation).
- `wlSavingsByMonth(txns, todayIso, n = 6)` → `[{ ym: 'YYYY-MM', label: 'Feb', total }...]` oldest→newest, zero-filled months included.

### Renderers

- `renderWlToggle()` + delegated click handler (bound once, `_wlToggleBound` guard) setting `wlView` and calling `renderWealthTab()`.
- `renderWealthTab()` computes `bounds = wlWindowBounds(wlView, todayISO())` and `agg = wlAggregateRange(txns, bounds.startIso, bounds.endIso)`, passes both down. Header line by mode — Month: v1 behavior exactly ("N of M paychecks landed · $X net so far" + third-check and missed-payday callouts). Day/Week: "$X net landed" (no expectation math, no callouts). Year: "N paychecks landed · $X net so far this year" (no expectation math, no callouts).
- `renderWlBoard(agg, bounds)` — allocations × factor; chips only when `bounds.mode === 'month'`.
- `renderWlSavings(agg, bounds, pay)` — target × factor; pending note Month-only.
- `renderWlPace(txns, bounds)` — SVG per decision 7, into new `#wl-pace` container. In day mode it internally builds a 14-day range ending today (via `wlPaceSeries` over those bounds) and draws daily columns against a horizontal line at `wlSpendBudget('day')`; other modes draw the cumulative-vs-pace lines over `bounds`.
- `renderWlVariance(agg, bounds)` — SVG/HTML bars per decision 8, into new `#wl-variance` container.
- `renderWlSavingsTrend(txns)` — SVG per decision 9, into new `#wl-sav-trend` container.

### index.html

- Toggle markup (4 buttons, `.wl-mode`, month pre-pressed) between the header card and a new pace-chart card; new cards/containers: `#wl-pace` (card "Spending pace"), `#wl-variance` (card "Plan vs. actual"), `#wl-sav-trend` (svg container inside the existing Savings card).

### css/styles.css

- `.wl-mode` segmented buttons (tokens only, mirrors the Analysis tab's mode-button look), `.wl-varrow` bar rows, minor chart caption classes.

### sw.js

- CACHE_NAME → 'moneytrack-v14' (file list unchanged).

### CLAUDE.md

- One line noting the window toggle convention (factors annualized: 12/365.25, 12/52, ×12) in the plan-numbers section.

## Constraints (inherited from v1, binding)

- No dependencies/build tooling; escapeHTML on all dynamic innerHTML strings; colors from PLAN config, tokens, or currentColor only; wealth.js top level stays DOM-free/app.js-free; `node --test` from repo root; no new localStorage keys; aria: toggle buttons `aria-pressed`, charts `aria-hidden="true"` with adjacent text stats.

## Testing

- Node: `wlWindowBounds` for all four modes incl. Sunday-week spanning a month boundary and year edges; `wlAggregateRange` windowing; v1 `wlAggregate` tests unchanged and passing; `wlPaceSeries` cumulative math; `wlSavingsByMonth` zero-fill and ordering; factor math (day/week/year totals).
- Controller render-harness update (scratchpad): toggle switching re-renders board with scaled allocations, chips vanish outside Month, pace/variance/trend SVGs populate, no listener double-binding.

## Out of scope

- Toggle persistence; sparklines; heatmap; intraday anything; Analysis-tab changes; editing plan numbers in UI.
