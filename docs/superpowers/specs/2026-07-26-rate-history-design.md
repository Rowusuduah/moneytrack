# GH₵/USD Rate History — Design Spec

**Date:** 2026-07-26
**Status:** Approved by Richmond (brainstorming session)

## Goal

The Africa tab stores only the latest manual GH₵-per-USD rate. Richmond wants
the rate **tracked**: every save recorded, cedi movement visible as a chart
and a plain-language change note.

## Decisions made

| Question | Decision |
|---|---|
| Display | Line chart (savings-trend style) + change note beside the rate field. |
| Granularity | One point per day — same-day re-saves replace that day's point. |
| Estimate math | Unchanged — always the latest rate. History is a view only. |
| Rate source | Still manual only. |

## Data

`moneytrack_africa` gains `rateHistory: [{ date: 'YYYY-MM-DD', rate: number }]`,
sorted by date ascending.

- `afLoad()` tolerates missing/invalid `rateHistory` (defaults `[]`, drops
  entries without a valid ISO date string or positive finite rate).
- `afSaveRate()` appends via `afRateHistoryAppend` — and first seeds the
  pre-upgrade point `{ date: rateUpdated, rate }` when history is empty but a
  rate already exists (no data loss on upgrade).
- Same storage key → Drive sync and JSON backup already carry it.

## Pure functions (js/africa.js top section, unit-tested)

- `afRateHistoryAppend(history, date, rate)` → new sorted array; an entry
  with the same date is replaced, otherwise the point is appended. Does not
  mutate the input.
- `afRateChange(history)` → `null` when fewer than 2 points, else
  `{ prev: {date, rate}, latest: {date, rate}, pct }` where
  `pct = afRound((latest.rate − prev.rate) / prev.rate * 100)`.
  Positive pct = more GH₵ per USD = **cedi weakened**.

## Display (renderers in js/africa.js)

1. **Change note** — in the rate row, after the "rate saved {date}" text,
   when `afRateChange` is non-null and `pct !== 0`:
   `was 15.20 on Jul 10 — cedi weakened 2.0%` (or `strengthened` for
   negative pct, using `Math.abs(pct).toFixed(1)`). When `pct === 0`:
   `unchanged since Jul 10`.
2. **Rate trend chart** — `<svg id="af-rate-trend" viewBox="0 0 620 150">`
   in `#af-summary` below the rate row, rendered by `renderAfRateTrend(data)`
   (called from `renderAfricaTab`): polyline through all history points,
   x spread evenly by index with first/last date labels, 3 y-gridlines with
   rate labels, latest point emphasized with a dot. Empty (`innerHTML = ''`)
   when fewer than 2 points. `aria-hidden="true"` like the other charts.

## Tests & plumbing

- `tests/africa.test.mjs`: afRateHistoryAppend (append, same-date replace,
  sort, no input mutation), afRateChange (null under 2 points, weakened +pct,
  strengthened −pct, zero change), afLoad rateHistory tolerance (missing,
  corrupt entries dropped).
- Africa render harness: save rate on two dates → note text and non-empty
  `#af-rate-trend`; history persisted and seeded from pre-upgrade rate.
- `sw.js` cache → `moneytrack-v19`; CLAUDE.md Africa section gains one
  sentence about rateHistory.

## Out of scope

Automatic rate fetching, NGN rates, using historical rates in estimates or
gain math, editing/deleting history points, per-investment purchase-date
rate capture.
