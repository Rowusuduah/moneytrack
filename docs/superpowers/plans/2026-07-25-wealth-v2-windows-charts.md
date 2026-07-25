# Wealth Tab v2 — Window Toggle + Analyst Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Day/Week/Month/Year window toggle to the Wealth tab and three analyst charts (spending pace, plan-vs-actual variance, 6-month savings trend), all dependency-free SVG.

**Architecture:** Extend `js/wealth.js` (currently ~424 lines, v1 shipped at commit 12c3ba0): new pure window/series functions (Node-tested), the existing month aggregation generalized to a date range with the v1 signature preserved as a wrapper, window-aware renderers, and three new SVG chart renderers whose colors come from CSS classes bound to design tokens.

**Tech Stack:** Vanilla JS classic script, existing CSS tokens, `node:test` + `vm.runInThisContext` harness (established in v1).

**Spec:** `docs/superpowers/specs/2026-07-25-wealth-v2-windows-charts-design.md` (approved).

## Global Constraints

- Suite command: `node --test` from the repo root (the `tests/` dir-arg form is broken on this host). All 11 existing tests must pass UNCHANGED after every task.
- `js/wealth.js` top level stays DOM-free and app.js-free (the whole file is evaluated in Node).
- No new dependencies; no new localStorage keys; escapeHTML() on every dynamic string reaching innerHTML; money via fmt()/wlRound.
- Chart/bar colors in NEW code come from CSS classes using design tokens (`var(--green)`, `var(--red)`, `var(--gold)`) or `currentColor` — no hex in new JS or CSS.
- Window factors (spec decision 4): day = 12/365.25, week = 12/52, month = 1, year = 12. Weeks run Sunday–Saturday. Paid chips and the paycheck-pending savings note render ONLY in Month view.
- Toggle state is in-memory (`let wlView = 'month'`), resets on reload; buttons carry `aria-pressed`.
- Browser verification is the controller's consolidated pass — implementers run node tests only.
- Commit after every task. Do NOT push.

---

### Task 1: Window bounds, range aggregation, and series math (pure functions + tests)

**Files:**
- Modify: `js/wealth.js` (insert new constants/functions; replace `wlAggregate`)
- Test: `tests/wealth.test.mjs` (append)

**Interfaces:**
- Consumes: existing `wlRound`, `wlIsoLocal`, `wlFixedMo`, `wlDailyLivingMo`, `WEALTH_SAVINGS_CATS`, `WEALTH_EXCLUDED_CATS`, `WEALTH_CATEGORY_MAP`, `PLAN`, `WL_MONTHS` (referenced only inside function bodies — it is declared later in the file, which is safe for call-time lookup).
- Produces (used by Tasks 2–3):
  - `WL_FACTORS` = `{ day: 12/365.25, week: 12/52, month: 1, year: 12 }`
  - `WL_MON3` = 3-letter month names array
  - `wlWindowBounds(mode, todayIso)` → `{ mode, startIso, endIso, factor, label, daysTotal, daysElapsed }`
  - `wlAggregateRange(txns, startIso, endIso)` → same shape as v1 `wlAggregate` minus `month`
  - `wlAggregate(txns, todayIso)` → unchanged v1 signature/shape (wrapper adding `month`)
  - `wlSpendBudget(mode)` → `(wlFixedMo() + wlDailyLivingMo()) × factor`, rounded
  - `wlPaceSeries(txns, bounds)` → `{ days: [{iso,total}], cumulative: [number] }` (bounds needs only startIso/endIso)
  - `wlSavingsByMonth(txns, todayIso, n)` → `[{ ym, label, total }]` oldest→newest, zero-filled

- [ ] **Step 1: Append the failing tests to `tests/wealth.test.mjs`**

```js
test('wlWindowBounds: all four modes with correct boundaries and factors', () => {
  const d = W.wlWindowBounds('day', '2026-07-25');
  assert.equal(d.startIso, '2026-07-25'); assert.equal(d.endIso, '2026-07-25');
  assert.equal(d.daysTotal, 1); assert.equal(d.daysElapsed, 1);
  const w = W.wlWindowBounds('week', '2026-07-25');   // Saturday → Sun Jul 19 .. Sat Jul 25
  assert.equal(w.startIso, '2026-07-19'); assert.equal(w.endIso, '2026-07-25');
  assert.equal(w.daysTotal, 7); assert.equal(w.daysElapsed, 7);
  const w2 = W.wlWindowBounds('week', '2026-08-01');  // week spans the month boundary
  assert.equal(w2.startIso, '2026-07-26'); assert.equal(w2.endIso, '2026-08-01');
  const m = W.wlWindowBounds('month', '2026-07-25');
  assert.equal(m.startIso, '2026-07-01'); assert.equal(m.endIso, '2026-07-31');
  assert.equal(m.daysTotal, 31); assert.equal(m.daysElapsed, 25);
  assert.equal(m.label, 'July 2026');
  const y = W.wlWindowBounds('year', '2026-07-25');
  assert.equal(y.startIso, '2026-01-01'); assert.equal(y.endIso, '2026-12-31');
  assert.equal(y.daysTotal, 365); assert.equal(y.label, '2026');
  assert.equal(m.factor, 1); assert.equal(y.factor, 12);
  assert.ok(Math.abs(w.factor - 12 / 52) < 1e-9);
  assert.ok(Math.abs(d.factor - 12 / 365.25) < 1e-9);
});

test('wlAggregateRange windows txns; wlAggregate wrapper keeps v1 behavior', () => {
  const txns = [
    { id: 'a', date: '2026-07-19', type: 'expense', amount: 50, category: 'Groceries' },
    { id: 'b', date: '2026-07-25', type: 'expense', amount: 30, category: 'Groceries' },
    { id: 'c', date: '2026-07-01', type: 'expense', amount: 20, category: 'Groceries' },
    { id: 'd', date: '2026-06-30', type: 'expense', amount: 99, category: 'Groceries' },
  ];
  const wk = W.wlAggregateRange(txns, '2026-07-19', '2026-07-25');
  assert.equal(wk.groups.living, 80);
  const mo = W.wlAggregateRange(txns, '2026-07-01', '2026-07-31');
  assert.equal(mo.groups.living, 100);
  const wrapped = W.wlAggregate(txns, '2026-07-25');
  assert.equal(wrapped.groups.living, 100);
  assert.equal(wrapped.month, '2026-07');
});

test('wlSpendBudget scales the non-savings budget by window factor', () => {
  assert.equal(W.wlSpendBudget('month'), 2557.90);
  assert.equal(W.wlSpendBudget('year'), 30694.80);
  assert.equal(W.wlSpendBudget('week'), 590.28);
  assert.equal(W.wlSpendBudget('day'), 84.03);
});

test('wlPaceSeries: daily totals, running cumulative, spending-only inclusion', () => {
  const txns = [
    { date: '2026-07-19', type: 'expense',  amount: 50,  category: 'Groceries' },
    { date: '2026-07-20', type: 'expense',  amount: 25,  category: 'Gas' },
    { date: '2026-07-20', type: 'expense',  amount: 500, category: 'Savings Transfer' },
    { date: '2026-07-21', type: 'transfer', amount: 40,  category: 'Transfer' },
    { date: '2026-07-21', type: 'expense',  amount: 10,  category: 'Bank Fee' },
    { date: '2026-07-21', type: 'expense',  amount: 7,   category: 'Mystery Custom' },
  ];
  const s = W.wlPaceSeries(txns, { startIso: '2026-07-19', endIso: '2026-07-22' });
  assert.deepEqual(s.days.map(x => x.total), [50, 25, 7, 0]);   // unmapped counts as spending
  assert.deepEqual(s.cumulative, [50, 75, 82, 82]);
});

test('wlSavingsByMonth zero-fills and orders oldest first', () => {
  const txns = [
    { date: '2026-07-11', type: 'transfer', amount: 1500, category: 'Savings Transfer' },
    { date: '2026-05-02', type: 'expense',  amount: 200,  category: 'Investment' },
    { date: '2025-12-31', type: 'transfer', amount: 999,  category: 'Savings Transfer' },
  ];
  const m = W.wlSavingsByMonth(txns, '2026-07-25', 6);
  assert.equal(m.length, 6);
  assert.deepEqual(m.map(x => x.ym), ['2026-02','2026-03','2026-04','2026-05','2026-06','2026-07']);
  assert.equal(m[3].total, 200);
  assert.equal(m[5].total, 1500);
  assert.equal(m[0].total, 0);
  assert.equal(m[0].label, 'Feb');
});
```

- [ ] **Step 2: Run `node --test` — the 5 new tests FAIL ("is not a function"), the 11 existing PASS.**

- [ ] **Step 3: Implement in `js/wealth.js`**

3a. Directly AFTER the `wlDailyLivingMo` function line (`function wlDailyLivingMo() { ... }`), insert:

```js
const WL_FACTORS = { day: 12 / 365.25, week: 12 / 52, month: 1, year: 12 };
const WL_MON3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function wlSpendBudget(mode) {
  return wlRound((wlFixedMo() + wlDailyLivingMo()) * WL_FACTORS[mode]);
}

// Calendar window containing todayIso. Weeks run Sunday–Saturday.
function wlWindowBounds(mode, todayIso) {
  const t = new Date(todayIso + 'T00:00:00');
  let start, end, label;
  if (mode === 'day') {
    start = new Date(t); end = new Date(t);
    label = 'Today · ' + WL_MON3[t.getMonth()] + ' ' + t.getDate();
  } else if (mode === 'week') {
    start = new Date(t); start.setDate(t.getDate() - t.getDay());
    end = new Date(start); end.setDate(start.getDate() + 6);
    label = 'Week of ' + WL_MON3[start.getMonth()] + ' ' + start.getDate() + '–' +
      (start.getMonth() === end.getMonth() ? '' : WL_MON3[end.getMonth()] + ' ') + end.getDate();
  } else if (mode === 'year') {
    start = new Date(t.getFullYear(), 0, 1); end = new Date(t.getFullYear(), 11, 31);
    label = String(t.getFullYear());
  } else {
    start = new Date(t.getFullYear(), t.getMonth(), 1);
    end   = new Date(t.getFullYear(), t.getMonth() + 1, 0);
    label = WL_MONTHS[t.getMonth()] + ' ' + t.getFullYear();
  }
  const DAY = 86400000;
  return {
    mode, startIso: wlIsoLocal(start), endIso: wlIsoLocal(end),
    factor: WL_FACTORS[mode], label,
    daysTotal: Math.round((end - start) / DAY) + 1,
    daysElapsed: Math.round((t - start) / DAY) + 1,
  };
}
```

3b. REPLACE the entire v1 `wlAggregate` function (the block starting `// One pass over the txn log → everything the live blocks need.` through its closing brace) with:

```js
// One pass over the txn log → everything the live blocks need.
// Inclusive ISO date range; string comparison is safe for YYYY-MM-DD.
function wlAggregateRange(txns, startIso, endIso) {
  const groups = {};
  PLAN.groups.forEach(g => { groups[g.id] = 0; });
  groups.living = 0;
  const billIndex = {};   // category → bill def
  PLAN.groups.forEach(g => g.bills.forEach(b => b.categories.forEach(c => { billIndex[c] = b; })));

  const bills = {};
  const unmappedByCat = {};
  let savingsThisMonth = 0, netLanded = 0, paychecksLanded = 0;

  for (const t of txns) {
    if (!t.date || t.date < startIso || t.date > endIso) continue;
    const amt = Number(t.amount) || 0;

    if (t.type === 'income') {
      if (t.category === 'Paycheck') { paychecksLanded++; netLanded = wlRound(netLanded + amt); }
      continue;                                    // other income is outside the plan
    }
    if (WEALTH_SAVINGS_CATS.includes(t.category)) { // counts whether logged as transfer or expense
      savingsThisMonth = wlRound(savingsThisMonth + amt);
      continue;
    }
    if (t.type === 'transfer') continue;            // account moves are not spending
    if (t.type !== 'expense') continue;
    if (WEALTH_EXCLUDED_CATS.includes(t.category)) continue;

    const gid = WEALTH_CATEGORY_MAP[t.category];
    if (!gid) {
      unmappedByCat[t.category] = wlRound((unmappedByCat[t.category] || 0) + amt);
      continue;
    }
    groups[gid] = wlRound(groups[gid] + amt);
    const bill = billIndex[t.category];
    if (bill) {
      const cur = bills[bill.id] || { total: 0, lastDate: '' };
      cur.total = wlRound(cur.total + amt);
      if (t.date > cur.lastDate) cur.lastDate = t.date;
      bills[bill.id] = cur;
    }
  }

  return {
    groups, bills, savingsThisMonth, netLanded, paychecksLanded,
    unmapped: Object.entries(unmappedByCat).map(([category, total]) => ({ category, total })),
  };
}

// v1 signature preserved: calendar month of todayIso.
function wlAggregate(txns, todayIso) {
  const b = wlWindowBounds('month', todayIso);
  const agg = wlAggregateRange(txns, b.startIso, b.endIso);
  agg.month = todayIso.slice(0, 7);
  return agg;
}
```

3c. Directly AFTER the new `wlAggregate` wrapper, insert:

```js
// Daily spending totals + running cumulative for a window (spending only:
// expenses that are neither savings-categorized nor excluded).
function wlPaceSeries(txns, bounds) {
  const idx = {};
  for (const t of txns) {
    if (!t.date || t.date < bounds.startIso || t.date > bounds.endIso) continue;
    if (t.type !== 'expense') continue;
    if (WEALTH_SAVINGS_CATS.includes(t.category)) continue;
    if (WEALTH_EXCLUDED_CATS.includes(t.category)) continue;
    idx[t.date] = wlRound((idx[t.date] || 0) + (Number(t.amount) || 0));
  }
  const days = [], cumulative = [];
  const d = new Date(bounds.startIso + 'T00:00:00');
  const end = new Date(bounds.endIso + 'T00:00:00');
  let run = 0;
  while (d <= end) {
    const iso = wlIsoLocal(d);
    const total = idx[iso] || 0;
    run = wlRound(run + total);
    days.push({ iso, total });
    cumulative.push(run);
    d.setDate(d.getDate() + 1);
  }
  return { days, cumulative };
}

// Savings Transfer + Investment totals for the last n calendar months
// (including the current one), zero-filled, oldest first.
function wlSavingsByMonth(txns, todayIso, n) {
  const count = n || 6;
  const t = new Date(todayIso + 'T00:00:00');
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(t.getFullYear(), t.getMonth() - i, 1);
    const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    out.push({ ym, label: WL_MON3[d.getMonth()], total: 0 });
  }
  const byYm = {};
  out.forEach(o => { byYm[o.ym] = o; });
  for (const t2 of txns) {
    if (!t2.date || !WEALTH_SAVINGS_CATS.includes(t2.category)) continue;
    const o = byYm[t2.date.slice(0, 7)];
    if (o) o.total = wlRound(o.total + (Number(t2.amount) || 0));
  }
  return out;
}
```

- [ ] **Step 4: Run `node --test` — all 16 pass (11 existing untouched + 5 new).**

- [ ] **Step 5: Commit**

```bash
git add js/wealth.js tests/wealth.test.mjs
git commit -m "feat(wealth): window bounds, range aggregation, pace and savings-history math"
```

---

### Task 2: Toggle UI + window-aware header, board, and savings

**Files:**
- Modify: `index.html` (toggle + two chart-container cards + trend svg)
- Modify: `css/styles.css` (append `.wl-mode`, `.wl-var*`, `.wl-ch-*` classes)
- Modify: `js/wealth.js` (toggle state/renderers; replace `renderWealthTab`, `renderWlHeader`, `renderWlBoard`, `renderWlSavings`; add empty chart stubs)

**Interfaces:**
- Consumes: Task 1's `wlWindowBounds`, `wlAggregateRange`, `WL_FACTORS`; existing `wlPaydays`, `wlRowHTML`, `wlDailyLivingMo`, app.js `fmt`/`fmtDate`/`escapeHTML`/`loadTxns`/`todayISO`.
- Produces: `wlView` (module `let`, 'day'|'week'|'month'|'year'), `bindWlToggle()`, `renderWlToggle()`; container ids `wl-toggle`, `wl-pace`, `wl-pace-cap`, `wl-variance`, `wl-sav-trend`; stubs `renderWlPace(txns, bounds)`, `renderWlVariance(agg, bounds)`, `renderWlSavingsTrend(txns, today)` (empty, filled in Task 3); new signatures `renderWlBoard(agg, bounds)`, `renderWlSavings(agg, pay, bounds)`, `renderWlHeader(agg, pay, today, bounds)`.

- [ ] **Step 1: index.html — insert the toggle and pace card**

Directly AFTER the closing `</div>` of the `<div class="card" id="wl-header" aria-live="polite">` card, insert:

```html
      <div class="wl-mode" id="wl-toggle" role="group" aria-label="Time window">
        <button type="button" data-wlv="day"   aria-pressed="false">Day</button>
        <button type="button" data-wlv="week"  aria-pressed="false">Week</button>
        <button type="button" data-wlv="month" aria-pressed="true" class="on">Month</button>
        <button type="button" data-wlv="year"  aria-pressed="false">Year</button>
      </div>

      <div class="card">
        <div class="card-title">Spending pace</div>
        <svg id="wl-pace" viewBox="0 0 620 180" style="width:100%;height:auto;display:block" aria-hidden="true"></svg>
        <p class="wl-sub" id="wl-pace-cap" aria-live="polite"></p>
      </div>
```

- [ ] **Step 2: index.html — insert the variance card**

Directly AFTER the closing `</div>` of the Allocation-status card (the card containing `<div id="wl-board" ...>`), insert:

```html
      <div class="card">
        <div class="card-title">Plan vs. actual
          <span style="font-weight:400;font-size:11px;color:var(--muted)">sorted worst first</span>
        </div>
        <div id="wl-variance" aria-live="polite"></div>
      </div>
```

- [ ] **Step 3: index.html — insert the savings trend svg**

Inside the "Savings this month" card, directly AFTER `<div id="wl-savings" aria-live="polite"><!-- Rendered by JS --></div>`, insert:

```html
        <svg id="wl-sav-trend" viewBox="0 0 620 150" style="width:100%;height:auto;display:block;margin-top:14px" aria-hidden="true"></svg>
```

Also change that card's title text from `Savings this month` to `Savings` (the window label now varies and the trend chart is always 6-month).

- [ ] **Step 4: css/styles.css — append after the existing Wealth block**

```css
/* ── Wealth v2: window toggle + charts ─────────────────── */
.wl-mode { display: flex; gap: 6px; margin: 14px 0; }
.wl-mode button { background: var(--surf); border: 1px solid var(--border); color: var(--muted);
  border-radius: var(--radius-sm); padding: 6px 14px; font-size: 12px; cursor: pointer; }
.wl-mode button:hover { color: var(--text); }
.wl-mode button.on { background: var(--surf3); color: var(--text); border-color: var(--brig); font-weight: 600; }
.wl-varrow { display: flex; align-items: center; gap: 10px; padding: 6px 0; font-size: 12px; }
.wl-var-label { flex: 0 0 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wl-var-track { flex: 1; position: relative; height: 12px; background: var(--surf3);
  border-radius: 3px; overflow: hidden; }
.wl-var-fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--green); opacity: .85; }
.wl-var-fill.over { background: var(--red); }
.wl-var-ref { position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; background: var(--brig); }
.wl-var-clip { position: absolute; right: 2px; top: -1px; color: var(--red); font-size: 10px; }
.wl-var-delta { flex: 0 0 110px; text-align: right; font-variant-numeric: tabular-nums; color: var(--muted); }
.wl-var-delta.over { color: var(--red); font-weight: 600; }
.wl-ch-under, .wl-ch-over { fill: none; stroke-width: 2; }
.wl-ch-under { stroke: var(--green); }
.wl-ch-over  { stroke: var(--red); }
.wl-ch-pace  { stroke: var(--gold); stroke-dasharray: 4 3; stroke-width: 1.5; fill: none; }
.wl-ch-col   { fill: var(--green); opacity: .8; }
.wl-ch-col.short { fill: var(--gold); }
.wl-ch-col.over  { fill: var(--red); }
.wl-ch-target { stroke: var(--gold); stroke-dasharray: 4 3; stroke-width: 1.5; }
@media (max-width: 560px) { .wl-var-label { flex-basis: 90px; } .wl-var-delta { flex-basis: 88px; } }
```

- [ ] **Step 5: js/wealth.js — toggle state and orchestration**

Directly BEFORE the `function renderWealthTab()` line, insert:

```js
let wlView = 'month';   // 'day' | 'week' | 'month' | 'year' — resets each load

function bindWlToggle() {
  const el = document.getElementById('wl-toggle');
  if (!el || el._wlToggleBound) return;
  el._wlToggleBound = true;
  el.addEventListener('click', e => {
    const btn = e.target.closest('button[data-wlv]');
    if (!btn) return;
    wlView = btn.dataset.wlv;
    renderWealthTab();
  });
}

function renderWlToggle() {
  document.querySelectorAll('#wl-toggle button[data-wlv]').forEach(b => {
    const on = b.dataset.wlv === wlView;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.classList.toggle('on', on);
  });
}
```

REPLACE the entire `renderWealthTab` function with:

```js
function renderWealthTab() {
  const txns   = loadTxns();
  const today  = todayISO();
  const bounds = wlWindowBounds(wlView, today);
  const agg    = wlAggregateRange(txns, bounds.startIso, bounds.endIso);
  const pay    = wlPaydays(PLAN.payAnchor, today);
  bindWlToggle();
  renderWlToggle();
  renderWlHeader(agg, pay, today, bounds);
  renderWlPace(txns, bounds);
  renderWlBoard(agg, bounds);
  renderWlVariance(agg, bounds);
  renderWlSavings(agg, pay, bounds);
  renderWlSavingsTrend(txns, today);
  renderWlLadder();
  bindWlStudio();
  renderWlStudio();
  renderWlFooter(agg);
}
```

- [ ] **Step 6: js/wealth.js — replace `renderWlHeader` with the mode-aware version**

```js
function renderWlHeader(agg, pay, today, bounds) {
  const sub = document.getElementById('wl-month-sub');
  if (sub) sub.textContent = bounds.label +
    ' · plan target ' + fmt(PLAN.savingsTargetMo) + '/mo saved';
  const el = document.getElementById('wl-header');
  if (!el) return;
  let html;
  if (bounds.mode === 'month') {
    html = '<div class="wl-head-line"><b>' + agg.paychecksLanded + ' of ' + pay.expected +
      '</b> paychecks landed · <b>' + fmt(agg.netLanded) + '</b> net so far</div>';
    if (pay.expected === 3) {
      html += '<div class="wl-callout">Third-paycheck month — an extra ' +
        fmt(PLAN.netPerCheck) + ' lands on top of the plan. The plan says sweep it to savings.</div>';
    }
    if (agg.paychecksLanded < pay.dueByToday) {
      html += '<div class="wl-callout">Heads up: ' + pay.dueByToday +
        ' payday(s) have passed this month but only ' + agg.paychecksLanded +
        ' Paycheck transaction(s) are logged.</div>';
    }
  } else if (bounds.mode === 'year') {
    html = '<div class="wl-head-line"><b>' + agg.paychecksLanded +
      '</b> paychecks landed · <b>' + fmt(agg.netLanded) + '</b> net so far this year</div>';
  } else {
    html = '<div class="wl-head-line"><b>' + fmt(agg.netLanded) + '</b> net landed</div>';
  }
  el.innerHTML = html;
}
```

- [ ] **Step 7: js/wealth.js — replace `renderWlBoard` and `renderWlSavings` with window-aware versions**

```js
function renderWlBoard(agg, bounds) {
  const el = document.getElementById('wl-board');
  if (!el) return;
  let html = '';
  PLAN.groups.forEach(g => {
    const chips = bounds.mode !== 'month' ? '' : g.bills.map(b => {
      const paid = agg.bills[b.id];
      return paid
        ? '<span class="wl-chip paid">' + escapeHTML(b.label) + ' ✓ paid ' + fmtDate(paid.lastDate) + '</span>'
        : '<span class="wl-chip">' + escapeHTML(b.label) + ' — due</span>';
    }).join('');
    html += wlRowHTML(g.label, wlRound(g.monthly * bounds.factor), agg.groups[g.id] || 0, chips);
  });
  html += wlRowHTML('Daily living', wlRound(wlDailyLivingMo() * bounds.factor), agg.groups.living || 0, '');
  el.innerHTML = html;
}

function renderWlSavings(agg, pay, bounds) {
  const el = document.getElementById('wl-savings');
  if (!el) return;
  const target = wlRound(PLAN.savingsTargetMo * bounds.factor);
  const saved  = agg.savingsThisMonth;
  const toGo   = wlRound(Math.max(0, target - saved));
  let note;
  if (saved >= target) note = 'Target hit. Anything more is ahead of plan.';
  else if (bounds.mode === 'month') {
    const pending = pay.expected - agg.paychecksLanded;
    note = fmt(toGo) + ' to go' + (pending > 0
      ? ' · ' + pending + ' paycheck' + (pending > 1 ? 's' : '') + ' still to land'
      : ' · all paychecks landed — this month will close short unless you top up');
  } else {
    note = fmt(toGo) + ' to go this ' + (bounds.mode === 'day' ? 'day' : bounds.mode);
  }
  el.innerHTML = wlRowHTML('Saved (Savings Transfer + Investment)', target, saved, '') +
    '<p class="wl-sub" style="margin-top:8px">' + escapeHTML(note) + '</p>';
}
```

- [ ] **Step 8: js/wealth.js — add the three chart stubs (filled in Task 3)**

Directly AFTER the new `renderWlSavings`, insert:

```js
// Filled in v2 Task 3
function renderWlPace(txns, bounds) {}
function renderWlVariance(agg, bounds) {}
function renderWlSavingsTrend(txns, today) {}
```

- [ ] **Step 9: Run `node --test` — all 16 still pass (renderers reference DOM only inside bodies). Static check: no duplicate ids in index.html (`grep -o 'id="[^"]*"' index.html | sort | uniq -d` → empty).**

- [ ] **Step 10: Commit**

```bash
git add index.html css/styles.css js/wealth.js
git commit -m "feat(wealth): day/week/month/year toggle re-scopes board, savings, header"
```

---

### Task 3: The three analyst charts

**Files:**
- Modify: `js/wealth.js` (replace the three stubs)

**Interfaces:**
- Consumes: Task 1's `wlPaceSeries`, `wlSpendBudget`, `wlSavingsByMonth`, `wlWindowBounds` output shape; Task 2's container ids and `.wl-ch-*`/`.wl-var*` CSS classes; existing `wlRound`, `wlM0`, `fmt`, `escapeHTML`, `wlIsoLocal`, `PLAN`, `wlDailyLivingMo`, `WL_MON3`.
- Produces: working `renderWlPace`, `renderWlVariance`, `renderWlSavingsTrend`.

- [ ] **Step 1: Replace the three stubs with the implementations**

```js
// Spending pace. Week/Month/Year: cumulative actual (green under pace, red
// over) vs a dashed straight budget-pace line. Day: last 14 days as daily
// columns vs the daily budget line (txns carry no time of day).
function renderWlPace(txns, bounds) {
  const svg = document.getElementById('wl-pace');
  const cap = document.getElementById('wl-pace-cap');
  if (!svg) return;
  const W = 620, H = 180, L = 46, R = 12, T = 12, B = 22;
  const kFmt = n => n >= 1000 ? '$' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : '$' + Math.round(n);
  let g = '';

  if (bounds.mode === 'day') {
    const endD = new Date(bounds.endIso + 'T00:00:00');
    const startD = new Date(endD); startD.setDate(endD.getDate() - 13);
    const series = wlPaceSeries(txns, { startIso: wlIsoLocal(startD), endIso: bounds.endIso });
    const budget = wlSpendBudget('day');
    const max = Math.max(budget * 1.5, ...series.days.map(d => d.total)) || 1;
    const n = series.days.length;
    const bw = (W - L - R) / n;
    const Y = v => H - B - (v / max) * (H - T - B);
    series.days.forEach((d2, i) => {
      const x = L + i * bw;
      const over = d2.total > budget;
      if (d2.total > 0) {
        g += '<rect x="' + (x + 2).toFixed(1) + '" y="' + Y(d2.total).toFixed(1) +
          '" width="' + (bw - 4).toFixed(1) + '" height="' + (H - B - Y(d2.total)).toFixed(1) +
          '" class="wl-ch-col' + (over ? ' over' : '') + '"/>';
      }
      if (i % 2 === 1) {
        const dd = new Date(d2.iso + 'T00:00:00');
        g += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 6) +
          '" fill="currentColor" opacity="0.55" font-size="9" text-anchor="middle">' +
          WL_MON3[dd.getMonth()] + ' ' + dd.getDate() + '</text>';
      }
    });
    g += '<line x1="' + L + '" y1="' + Y(budget).toFixed(1) + '" x2="' + (W - R) +
      '" y2="' + Y(budget).toFixed(1) + '" class="wl-ch-target"/>';
    const spentToday = series.days[n - 1].total;
    if (cap) cap.textContent = 'Last 14 days · today ' + fmt(spentToday) + ' vs ' +
      fmt(budget) + '/day budget' + (spentToday > budget ? ' — over' : '');
  } else {
    const series = wlPaceSeries(txns, bounds);
    const budget = wlSpendBudget(bounds.mode);
    const n = series.cumulative.length;
    const upto = Math.min(Math.max(1, bounds.daysElapsed), n);
    const actual = series.cumulative[upto - 1] || 0;
    const max = (Math.max(budget, actual) * 1.05) || 1;
    const X = i => L + (i / Math.max(1, n - 1)) * (W - L - R);
    const Y = v => H - B - (v / max) * (H - T - B);
    for (let i = 0; i <= 3; i++) {
      const v = max * i / 3, y = Y(v);
      g += '<line x1="' + L + '" y1="' + y.toFixed(1) + '" x2="' + (W - R) + '" y2="' + y.toFixed(1) +
        '" stroke="currentColor" opacity="0.12"/>';
      g += '<text x="' + (L - 6) + '" y="' + (y + 3.5).toFixed(1) + '" fill="currentColor" opacity="0.55" ' +
        'font-size="9" text-anchor="end">' + kFmt(v) + '</text>';
    }
    g += '<line x1="' + X(0).toFixed(1) + '" y1="' + Y(0).toFixed(1) + '" x2="' + X(n - 1).toFixed(1) +
      '" y2="' + Y(budget).toFixed(1) + '" class="wl-ch-pace"/>';
    for (let i = 1; i < upto; i++) {
      const paceHere = budget * i / Math.max(1, n - 1);
      const cls = series.cumulative[i] > paceHere ? 'wl-ch-over' : 'wl-ch-under';
      g += '<line x1="' + X(i - 1).toFixed(1) + '" y1="' + Y(series.cumulative[i - 1]).toFixed(1) +
        '" x2="' + X(i).toFixed(1) + '" y2="' + Y(series.cumulative[i]).toFixed(1) +
        '" class="' + cls + '"/>';
    }
    const paceToDate = wlRound(budget * bounds.daysElapsed / bounds.daysTotal);
    const delta = wlRound(actual - paceToDate);
    if (cap) cap.textContent = fmt(actual) + ' spent · pace says ' + fmt(paceToDate) +
      ' by day ' + bounds.daysElapsed + ' of ' + bounds.daysTotal + ' — ' +
      (delta > 0 ? 'over pace by ' + fmt(delta) : 'under pace by ' + fmt(-delta));
  }
  svg.innerHTML = g;
}

// Plan vs. actual: one bar per group, worst overspend first. Bar scale is
// 0–200% of allocation (the 100% reference sits mid-track); ▸ marks >200%.
function renderWlVariance(agg, bounds) {
  const el = document.getElementById('wl-variance');
  if (!el) return;
  const rows = PLAN.groups.map(g => ({
    label: g.label,
    alloc: wlRound(g.monthly * bounds.factor),
    spent: agg.groups[g.id] || 0,
  }));
  rows.push({ label: 'Daily living', alloc: wlRound(wlDailyLivingMo() * bounds.factor),
    spent: agg.groups.living || 0 });
  rows.forEach(r => { r.delta = wlRound(r.spent - r.alloc); });
  rows.sort((a, b) => b.delta - a.delta);
  el.innerHTML = rows.map(r => {
    const ratio = r.alloc > 0 ? r.spent / r.alloc : (r.spent > 0 ? 2.01 : 0);
    const over = r.delta > 0.005;
    const width = Math.min(100, ratio * 50);
    return '<div class="wl-varrow">' +
      '<span class="wl-var-label">' + escapeHTML(r.label) + '</span>' +
      '<span class="wl-var-track"><i class="wl-var-fill' + (over ? ' over' : '') +
      '" style="width:' + width.toFixed(1) + '%"></i><i class="wl-var-ref"></i>' +
      (ratio > 2 ? '<b class="wl-var-clip">▸</b>' : '') + '</span>' +
      '<span class="wl-var-delta' + (over ? ' over' : '') + '">' +
      (over ? '+' + fmt(r.delta) + ' over' : fmt(-r.delta) + ' under') + '</span>' +
      '</div>';
  }).join('');
}

// Last 6 months of savings vs the monthly target line. Always monthly.
function renderWlSavingsTrend(txns, today) {
  const svg = document.getElementById('wl-sav-trend');
  if (!svg) return;
  const months = wlSavingsByMonth(txns, today, 6);
  const target = PLAN.savingsTargetMo;
  const max = Math.max(target * 1.25, ...months.map(m => m.total)) || 1;
  const W = 620, H = 150, L = 46, R = 12, T = 10, B = 22;
  const bw = (W - L - R) / months.length;
  const Y = v => H - B - (v / max) * (H - T - B);
  let g = '';
  months.forEach((m, i) => {
    const x = L + i * bw;
    const met = m.total >= target;
    if (m.total > 0) {
      g += '<rect x="' + (x + bw * 0.18).toFixed(1) + '" y="' + Y(m.total).toFixed(1) +
        '" width="' + (bw * 0.64).toFixed(1) + '" height="' + Math.max(0, H - B - Y(m.total)).toFixed(1) +
        '" class="wl-ch-col' + (met ? '' : ' short') + '"/>';
      g += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (Y(m.total) - 4).toFixed(1) +
        '" fill="currentColor" opacity="0.7" font-size="9" text-anchor="middle">' + wlM0(m.total) + '</text>';
    }
    g += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 6) +
      '" fill="currentColor" opacity="0.55" font-size="9" text-anchor="middle">' + m.label + '</text>';
  });
  g += '<line x1="' + L + '" y1="' + Y(target).toFixed(1) + '" x2="' + (W - R) +
    '" y2="' + Y(target).toFixed(1) + '" class="wl-ch-target"/>';
  g += '<text x="' + (W - R) + '" y="' + (Y(target) - 4).toFixed(1) +
    '" fill="currentColor" opacity="0.7" font-size="9" text-anchor="end">target ' + wlM0(target) + '</text>';
  svg.innerHTML = g;
}
```

- [ ] **Step 2: Run `node --test` — all 16 pass (load-time DOM safety preserved).**

- [ ] **Step 3: Commit**

```bash
git add js/wealth.js
git commit -m "feat(wealth): spending pace, plan-vs-actual variance, savings trend charts"
```

---

### Task 4: Cache bump + docs

**Files:**
- Modify: `sw.js:3` (CACHE_NAME only)
- Modify: `CLAUDE.md` (one addition in the plan-numbers section)

- [ ] **Step 1: sw.js — change `const CACHE_NAME = 'moneytrack-v13';` to `const CACHE_NAME = 'moneytrack-v14';` (APP_SHELL unchanged).**

- [ ] **Step 2: CLAUDE.md — in the "Single source of truth for plan numbers" section, append this sentence to the end of the paragraph:**

```
The Wealth tab's Day/Week/Month/Year toggle scales allocations by annualized
factors (12/365.25, 12/52, 1, 12); weeks run Sunday–Saturday; paid chips are
Month-view only.
```

- [ ] **Step 3: Run `node --test` (16 pass) and `node --check sw.js`.**

- [ ] **Step 4: Commit**

```bash
git add sw.js CLAUDE.md
git commit -m "feat(wealth): bump cache to v14 and document window conventions"
```

---

## Controller acceptance (after Task 4, not an implementer task)

1. `node --test` 16/16; `node --check` on all three JS files.
2. Render-harness update (scratchpad): toggle to each mode → board allocations scale by factor, chips only in month, savings target scales, header text per mode; pace/variance/trend SVGs non-empty; toggle click handler bound once across re-entries; variance rows sorted worst-first.
3. Static: id cross-check wealth.js ↔ index.html; no duplicate ids.
4. Ship: merge + push per user's standing approval.

## Out of scope

Toggle persistence, sparklines, heatmap, Analysis-tab changes, plan-number editing UI.
