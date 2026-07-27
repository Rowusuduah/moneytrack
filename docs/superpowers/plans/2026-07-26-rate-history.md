# GH₵/USD Rate History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every manually saved GH₵-per-USD rate as history and show a trend chart plus a "cedi weakened/strengthened" note on the Africa tab.

**Architecture:** Two new pure functions in js/africa.js's DOM-free top section (`afRateHistoryAppend`, `afRateChange`), a `rateHistory` array in the existing `moneytrack_africa` store (afLoad tolerates absence/corruption; afSaveRate seeds the pre-upgrade point and appends), and one new renderer `renderAfRateTrend()` filling a dynamically rendered `#af-rate-trend` svg. Estimate math untouched. Spec: `docs/superpowers/specs/2026-07-26-rate-history-design.md`.

**Tech Stack:** Vanilla JS, localStorage, node:test + vm.runInThisContext.

## Global Constraints

- Run tests as `node --test` from repo root (dir-arg form broken on Windows/Node v24).
- Top-level js/africa.js code stays DOM-free and app.js-free.
- Money/percentages through `afRound`; dates ISO `YYYY-MM-DD`; display dates via `fmtDate`.
- Estimate math unchanged — history is a view only.
- Work on branch `feature/rate-history`; never implement on master.

---

### Task 1: Pure rate-history math (TDD)

**Files:**
- Modify: `js/africa.js` (top pure section, after `afGainPct`)
- Test: `tests/africa.test.mjs` (append)

**Interfaces:**
- Produces: `afRateHistoryAppend(history, date, rate) → new sorted array` (same-date replaces, no input mutation); `afRateChange(history) → null | { prev: {date,rate}, latest: {date,rate}, pct }` with `pct = afRound((latest.rate − prev.rate) / prev.rate * 100)`. Task 2 consumes both.

- [ ] **Step 1: Append failing tests to `tests/africa.test.mjs`:**

```js
test('afRateHistoryAppend appends, replaces same-date, sorts, does not mutate', () => {
  const h = [{ date: '2026-07-10', rate: 15.2 }];
  const h2 = A.afRateHistoryAppend(h, '2026-07-26', 15.5);
  assert.deepEqual(h2, [{ date: '2026-07-10', rate: 15.2 }, { date: '2026-07-26', rate: 15.5 }]);
  assert.equal(h.length, 1);                                   // input untouched
  const h3 = A.afRateHistoryAppend(h2, '2026-07-26', 15.6);    // same-day re-save
  assert.equal(h3.length, 2);
  assert.deepEqual(h3[1], { date: '2026-07-26', rate: 15.6 });
  const h4 = A.afRateHistoryAppend(h2, '2026-07-01', 15.0);    // older date sorts first
  assert.deepEqual(h4.map(p => p.date), ['2026-07-01', '2026-07-10', '2026-07-26']);
});

test('afRateChange: null under 2 points; signed pct for weakened/strengthened/flat', () => {
  assert.equal(A.afRateChange([]), null);
  assert.equal(A.afRateChange([{ date: '2026-07-10', rate: 15.2 }]), null);
  const up = A.afRateChange([{ date: '2026-07-10', rate: 15.2 }, { date: '2026-07-26', rate: 15.5 }]);
  assert.equal(up.pct, 1.97);                                  // (15.5−15.2)/15.2·100 = 1.9736…
  assert.equal(up.prev.date, '2026-07-10');
  assert.equal(up.latest.rate, 15.5);
  const down = A.afRateChange([{ date: '2026-07-10', rate: 15.5 }, { date: '2026-07-26', rate: 15.2 }]);
  assert.equal(down.pct, -1.94);                               // −1.9354…
  const flat = A.afRateChange([{ date: '2026-07-10', rate: 15.5 }, { date: '2026-07-26', rate: 15.5 }]);
  assert.equal(flat.pct, 0);
});
```

- [ ] **Step 2: Run `node --test` — the 2 new tests FAIL (`not a function`), existing 37 pass.**

- [ ] **Step 3: Implement in `js/africa.js` after `afGainPct`:**

```js
// One rate point per day: a same-date save replaces that day's point.
// Returns a new date-sorted array; never mutates the input.
function afRateHistoryAppend(history, date, rate) {
  const out = (history || []).filter(p => p.date !== date);
  out.push({ date, rate });
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// Movement between the last two saved rates. Positive pct = more GH₵ per
// USD = cedi weakened.
function afRateChange(history) {
  const h = history || [];
  if (h.length < 2) return null;
  const prev = h[h.length - 2], latest = h[h.length - 1];
  return { prev, latest, pct: afRound((latest.rate - prev.rate) / prev.rate * 100) };
}
```

- [ ] **Step 4: `node --test` — 39/39. `node --check js/africa.js`.**

- [ ] **Step 5: Commit**

```bash
git add js/africa.js tests/africa.test.mjs
git commit -m "feat(africa): rate-history append and change math"
```

---

### Task 2: Store, seeding, change note, trend chart

**Files:**
- Modify: `js/africa.js` (`afLoad`, `afSaveRate`, `renderAfSummary`, `renderAfricaTab`, new `renderAfRateTrend`)
- Modify: scratchpad `af-render-harness.mjs` (IDS list + new assertions)

**Interfaces:**
- Consumes: `afRateHistoryAppend`, `afRateChange` (Task 1).
- Produces: `data.rateHistory` on every `afLoad()` result; `renderAfRateTrend(data)`; dynamic `<svg id="af-rate-trend">` inside `#af-summary`.

- [ ] **Step 1: afLoad — add the tolerant field.** In the returned object, after `rateUpdated`, add:

```js
    rateHistory: Array.isArray(d.rateHistory)
      ? d.rateHistory.filter(p => p && typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date)
          && typeof p.rate === 'number' && isFinite(p.rate) && p.rate > 0)
      : [],
```

- [ ] **Step 2: afSaveRate — seed once, then append.** Replace the body between the validation alert and `afSave(data)` with:

```js
  const data = afLoad();
  // Seed the pre-history rate once so the upgrade loses nothing
  if (!data.rateHistory.length && data.rate !== null && data.rateUpdated) {
    data.rateHistory = afRateHistoryAppend(data.rateHistory, data.rateUpdated, data.rate);
  }
  data.rate = roundMoney(v);
  data.rateUpdated = todayISO();
  data.rateHistory = afRateHistoryAppend(data.rateHistory, data.rateUpdated, data.rate);
```

- [ ] **Step 3: renderAfSummary — change note + svg.** Replace the rate-row block's trailing span expression

```js
    (data.rateUpdated ? '<span class="af-meta" style="flex-basis:auto">rate saved ' +
      fmtDate(data.rateUpdated) + '</span>' : '') +
    '</div>';
```

with:

```js
    (data.rateUpdated ? '<span class="af-meta" style="flex-basis:auto">rate saved ' +
      fmtDate(data.rateUpdated) + afRateNote(data.rateHistory) + '</span>' : '') +
    '</div>' +
    '<svg id="af-rate-trend" viewBox="0 0 620 150" ' +
    'style="width:100%;height:auto;display:block;margin-top:10px" aria-hidden="true"></svg>';
```

and add the helper next to `renderAfSummary`:

```js
function afRateNote(history) {
  const chg = afRateChange(history);
  if (!chg) return '';
  if (chg.pct === 0) return ' · unchanged since ' + fmtDate(chg.prev.date);
  return ' · was ' + chg.prev.rate + ' on ' + fmtDate(chg.prev.date) + ' — cedi ' +
    (chg.pct > 0 ? 'weakened ' : 'strengthened ') + Math.abs(chg.pct).toFixed(1) + '%';
}
```

- [ ] **Step 4: new renderer + hook.** Add after `renderAfSummary`, and in `renderAfricaTab()` call `renderAfRateTrend(data);` directly after `renderAfSummary(data);`:

```js
// Rate trend: line through every saved point; hidden until 2+ points.
function renderAfRateTrend(data) {
  const svg = document.getElementById('af-rate-trend');
  if (!svg) return;
  const h = data.rateHistory;
  if (h.length < 2) { svg.innerHTML = ''; return; }
  const W = 620, H = 150, L = 46, R = 12, T = 12, B = 22;
  const rates = h.map(p => p.rate);
  const min = Math.min(...rates), max = Math.max(...rates);
  const pad = (max - min) * 0.15 || max * 0.05 || 1;
  const lo = min - pad, hi = max + pad;
  const X = i => L + (i / (h.length - 1)) * (W - L - R);
  const Y = v => H - B - ((v - lo) / (hi - lo)) * (H - T - B);
  let g = '';
  for (let i = 0; i <= 2; i++) {
    const v = lo + (hi - lo) * i / 2, y = Y(v);
    g += '<line x1="' + L + '" y1="' + y.toFixed(1) + '" x2="' + (W - R) + '" y2="' + y.toFixed(1) +
      '" stroke="currentColor" opacity="0.12"/>';
    g += '<text x="' + (L - 6) + '" y="' + (y + 3.5).toFixed(1) + '" fill="currentColor" opacity="0.55" ' +
      'font-size="9" text-anchor="end">' + v.toFixed(2) + '</text>';
  }
  let d = '';
  h.forEach((p, i) => { d += (i ? ' L' : 'M') + X(i).toFixed(1) + ',' + Y(p.rate).toFixed(1); });
  g += '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="2" opacity="0.8"/>';
  const li = h.length - 1;
  g += '<circle cx="' + X(li).toFixed(1) + '" cy="' + Y(h[li].rate).toFixed(1) + '" r="3.5" fill="currentColor"/>';
  g += '<text x="' + L + '" y="' + (H - 6) + '" fill="currentColor" opacity="0.55" font-size="9">' +
    fmtDate(h[0].date) + '</text>';
  g += '<text x="' + (W - R) + '" y="' + (H - 6) + '" fill="currentColor" opacity="0.55" font-size="9" ' +
    'text-anchor="end">' + fmtDate(h[li].date) + '</text>';
  svg.innerHTML = g;
}
```

- [ ] **Step 5: harness.** In `af-render-harness.mjs`: add `'af-rate-trend'` to the `IDS` array, then append before the report section:

```js
/* ── rate history: seeding, note, chart, corrupt tolerance ── */
store.moneytrack_africa = JSON.stringify({ rate: 15.2, rateUpdated: '2026-07-10',
  rateHistory: [null, { date: 'bad', rate: 15 }, { date: '2026-07-01', rate: -2 }],
  investments: persisted().investments });
ok(g.afLoad().rateHistory.length === 0, 'rate: corrupt history entries dropped by afLoad');
g.renderAfricaTab();
els['af-rate'].value = '15.5';
g.afSaveRate();
const rh = persisted().rateHistory;
ok(rh.length === 2 && rh[0].date === '2026-07-10' && rh[0].rate === 15.2, 'rate: pre-upgrade rate seeded as first point');
ok(rh[1].date === '2026-07-25' && rh[1].rate === 15.5, 'rate: new save appended');
ok(els['af-summary'].innerHTML.includes('cedi weakened 2.0%'), 'rate: change note says weakened 2.0%');
ok(els['af-rate-trend'].innerHTML.includes('<path'), 'rate: trend chart rendered with 2 points');
els['af-rate'].value = '15.5';
g.afSaveRate();
ok(persisted().rateHistory.length === 2, 'rate: same-day re-save replaces, no duplicate point');
```

(0.3/15.2 = 1.97% → note shows `weakened 2.0%`.)

- [ ] **Step 6: Run `node --test` (39/39), `node --check js/africa.js`, and the Africa harness — expect 52 + 7 = 59 passed, 0 failed.**

- [ ] **Step 7: Commit**

```bash
git add js/africa.js
git commit -m "feat(africa): rate history with seeding, change note and trend chart"
```

---

### Task 3: Cache bump + docs

**Files:**
- Modify: `sw.js:3` (v18 → v19), `CLAUDE.md` (Africa section)

- [ ] **Step 1: sw.js — `const CACHE_NAME = 'moneytrack-v19';`**

- [ ] **Step 2: CLAUDE.md — append to the "Africa investments" paragraph:**

```
Every saved rate is also recorded in `rateHistory` (one point per day,
same-day saves replace); the Africa tab charts it and notes cedi
movement — estimates always use the latest rate only.
```

- [ ] **Step 3: `node --test` (39/39), `node --check sw.js`.**

- [ ] **Step 4: Commit**

```bash
git add sw.js CLAUDE.md
git commit -m "feat(africa): bump cache to v19 and document rate history"
```

---

## Controller acceptance (after Task 3, not an implementer task)

1. `node --test` 39/39; `node --check` on africa.js and sw.js.
2. Africa harness 59/59 (includes seeding, note, chart, same-day replace, corrupt tolerance).
3. Ship: merge to master + push per Richmond's in-session approval.

## Out of scope

Automatic rate fetching, NGN rates, historical rates in estimates/gains, editing history points.
