# Africa Investments — Design Spec

**Date:** 2026-07-25
**Status:** Approved by Richmond (brainstorming session)

## Goal

Richmond holds investments in Africa — Ghana IPOs and other major investments
denominated in Ghana cedis (GH₵), possibly future Nigerian purchases denominated
in USD or GH₵. These must be tracked **separately** from US money so he always
knows where his money is, without corrupting the app's all-USD account math.

## Decisions made

| Question | Decision |
|---|---|
| Per-investment record | Amount invested + current value; app shows gain/loss. No share counts. |
| Placement | New sixth tab: **Africa**. |
| Net worth treatment | Net Worth stays US-only. Accounts tab gains an "Africa (est.)" KPI and a "Global Total" (= Net Worth + estimate). Trend chart, snapshots, CSV/PDF exports untouched. |
| Exchange rate | Manual only (app stays offline-first). One saved rate, quoted Ghana-style: GH₵ per 1 USD. Used **only** for the estimate lines. |
| Currencies | GH₵ and USD per investment. NGN out of scope (small change later if needed). |
| Architecture | Standalone module `js/africa.js` + own localStorage store, mirroring the wealth.js pattern (pure DOM-free math on top, renderers below). ACCOUNTS/snapshots/calcNetWorth are not modified. |

## Data model

New localStorage key `moneytrack_africa` (constant `KEY_AFRICA` in app.js, added
to `BACKUP_KEYS` so JSON backup/restore carries it):

```json
{
  "rate": 15.5,
  "rateUpdated": "2026-07-25",
  "investments": [
    {
      "id": "<crypto.randomUUID()>",
      "name": "MTN Ghana IPO",
      "country": "Ghana",
      "currency": "GHS",
      "invested": 20000,
      "current": 23500,
      "date": "2026-03-10",
      "updated": "2026-07-25",
      "note": "via Ecobank broker"
    }
  ]
}
```

Semantics:
- `rate` — GH₵ per 1 USD; `null` until first saved. Must be a positive finite
  number to save. `rateUpdated` stamps the save date.
- `country` — `'Ghana' | 'Nigeria' | 'Other'`.
- `currency` — `'GHS' | 'USD'`. Amounts are stored **in that currency**, never
  converted at rest.
- `invested` — amount put in (> 0). `current` — latest known value (≥ 0),
  defaults to `invested` on creation. Both pass through money rounding.
- `date` — when invested (ISO). `updated` — set to today whenever `current`
  is edited.
- `note` — optional free text, escaped on render like all user strings.

## Module: js/africa.js

Follows the wealth.js contract: **top-level code stays DOM-free and
app.js-free** so `node --test` works from the repo root.

Pure functions (unit-tested):
- `afTotals(investments)` → `{ byCurrency: { GHS: {invested, current, gain},
  USD: {…} }, byCountry: { Ghana: { GHS: {…}, USD: {…} }, … } }`.
  `byCurrency` always contains both GHS and USD, zero-filled; `byCountry`
  contains only countries that have investments. `gain = current − invested`.
- `afUsdEstimate(byCurrency, rate)` → `GHS.current / rate + USD.current`
  rounded, or `null` when rate is not a positive finite number.
- `afGainPct(invested, gain)` → percentage, or `null` when `invested ≤ 0`.
- `afFmtMoney(n, currency)` → `'GH₵ 1,234.56'` / `'$1,234.56'` (en-US
  grouping, 2 decimals, minus sign before symbol for negatives).

Data layer + renderers (browser-only section, app.js globals allowed):
`afLoad()` / `afSave()` with the same try/catch localStorage hygiene as
app.js, and `renderAfricaTab()` orchestrating child renderers.

## Africa tab UI

New tab button `#tab-africa` + `<section id="sec-africa" role="tabpanel">`
following the existing tab markup and keyboard-nav pattern.

1. **Summary card** (`#af-summary`, `aria-live="polite"`):
   - GH₵ line: total invested → total current, gain/loss amount + % (green
     `▲` / red `▼`).
   - USD line: same, only shown when USD investments exist.
   - Estimate line: `≈ $X total at GH₵15.5/$`. When no rate is saved:
     "Set a rate below to see the USD estimate."
   - Rate row: number input `#af-rate` + Save button `#af-rate-save` +
     "rate saved {date}".
2. **Investments list** (`#af-list`): grouped by country with a per-country
   subtotal line per currency. Each row: name, currency-tagged invested and
   current values, gain/loss with %, invested date, note, "updated {date}".
   Row actions:
   - **Quick value update** — inline number input to revise `current`
     (the everyday action after checking prices), sets `updated`.
   - **Edit** (✎) — reopens the add form prefilled for full edits.
   - **Delete** (✕) — `confirm()` first, matching custom-account deletion.
3. **Add form** (`#af-form`, hidden until "+ Add investment"): name, country
   select, currency select, invested, current (placeholder = invested), date
   (default today), note. Validation: name required, invested > 0,
   current ≥ 0.
4. **Empty state**: short explainer ("Track IPOs and investments held in
   Ghana or Nigeria — amounts stay in their own currency.").

Accessibility: icon buttons get `aria-label`; summary and list are
`aria-live="polite"`; country badges use existing design tokens, no new hex
values in JS.

## Accounts tab integration

`renderAccountKPIs()` appends, after the existing KPIs:
- **Africa (est.)** — `afUsdEstimate` result; sub `at GH₵{rate}/$ · not in
  Net Worth`. When investments exist but no rate: value `—`, sub
  `set rate on Africa tab`.
- **Global Total** — `Net Worth + estimate`; only rendered when the estimate
  is available.

Neither card renders when there are no Africa investments. `calcNetWorth`,
snapshots, NW trend, CSV, PDF are untouched.

## Plumbing

- `sw.js`: add `./js/africa.js` to `APP_SHELL`; bump cache to `moneytrack-v16`.
- `index.html`: `<script src="js/africa.js">` beside the wealth.js include;
  tab button + section.
- `app.js`: `KEY_AFRICA` constant, `BACKUP_KEYS` entry, tab-switch hook to
  call `renderAfricaTab()`, KPI additions.
- `CLAUDE.md`: file-structure entry + a conventions paragraph (amounts stay
  in native currency; one manual GH₵/$ rate used only for estimates; Africa
  money never enters Net Worth or snapshots).

## Testing

- `tests/africa.test.mjs` (node --test, `vm.runInThisContext` per the
  established harness): totals across mixed currencies and countries,
  gain/loss math, estimate with/without a valid rate, gain-% edge cases,
  formatting incl. negatives, rounding.
- Headless render harness (scratchpad, acceptance): tab renders with fixture
  data — summary lines, country grouping and subtotals, add/quick-update/
  delete flows mutate the store correctly, handlers bound once across
  re-entries, KPI cards appear on the Accounts tab exactly when they should,
  id cross-check africa.js ↔ index.html, no duplicate ids.

## Out of scope

NGN denominations and rates, automatic FX fetching, folding Africa value
into Net Worth / trend / exports, linking Tracker transactions (e.g. wire
transfers) to investments, historical value charts for investments, editing
`rateUpdated` history.
