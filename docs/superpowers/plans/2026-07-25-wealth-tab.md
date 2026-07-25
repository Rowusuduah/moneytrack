# Wealth Tab Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fifth "Wealth" tab to MoneyTrack that turns the static Wealth Corridor plan into a live dashboard: allocations show paid/spent/left from real transactions, savings progress tracks the monthly target, and the milestone ladder fills from account snapshots.

**Architecture:** New `js/wealth.js` module following MoneyTrack's one-render-function-per-tab pattern. A `PLAN` config object holds every plan number; pure compute functions (Node-testable, no DOM/app.js references) aggregate the current calendar month's transactions via an explicit category map; renderers fill static containers in `index.html`. app.js is touched in exactly two places.

**Tech Stack:** Vanilla JS (classic script, `'use strict'`), existing CSS design tokens, `node:test` + `node:vm` for unit-testing the pure functions (zero dependencies, Node v24 available on this machine).

**Spec:** `docs/superpowers/specs/2026-07-25-wealth-tab-integration-design.md` (approved). User decisions: calendar-month window; milestones from snapshot balances; config-in-code; repo stays public (user explicitly accepted that real numbers are in the public repo); `payAnchor = 2026-07-24`.

## Global Constraints

- No new dependencies, no package.json, no build tooling (CLAUDE.md).
- All user-controlled strings rendered into HTML go through `escapeHTML()`.
- Inline-style colors only from config objects (`PLAN`, `CATEGORY_COLORS`, `ACCOUNTS`); everything else uses CSS classes with existing tokens (`var(--green)` etc.). No new hardcoded hex in CSS.
- Money through `roundMoney()` before storing / `fmt()` for display; dates ISO `YYYY-MM-DD`, parse with `new Date(iso + 'T00:00:00')`.
- No new localStorage keys.
- Icon-only buttons need `aria-label`; live-updating regions `aria-live="polite"`; decorative chart `aria-hidden="true"`.
- `js/wealth.js` top-level code must not reference the DOM or any app.js function (Node tests evaluate the whole file). App.js globals (`loadTxns`, `getLatestSnapshot`, `ACCOUNTS`, `escapeHTML`, `fmt`, `roundMoney`, `safeAmt`, `todayISO`) may be used **inside** render/glue functions only.
- Local test server: `python -m http.server 8000` from repo root → http://localhost:8000. Bypass the login gate in DevTools console: `sessionStorage.setItem('moneytrack_auth','1')` then reload.
- Commit after every task. Do not push (user will decide when).

---

### Task 1: PLAN config, category map, and core aggregation (pure functions + tests)

**Files:**
- Create: `js/wealth.js`
- Test: `tests/wealth.test.mjs`

**Interfaces:**
- Consumes: nothing (pure).
- Produces (used by Tasks 3–6):
  - `wlPlan()` → the `PLAN` object described below
  - `wlCatToGroup()` → `{ [categoryName]: groupIdOr'living' }`
  - `wlIsoLocal(d: Date)` → `'YYYY-MM-DD'` local-time string
  - `wlPaydays(anchorIso, todayIso)` → `{ expected: number, dueByToday: number, dates: string[] }` for the month containing `todayIso`
  - `wlAggregate(txns, todayIso)` → `{ month: 'YYYY-MM', groups: {id: number}, bills: {billId: {total, lastDate}}, savingsThisMonth: number, netLanded: number, paychecksLanded: number, unmapped: [{category, total}] }`
  - `wlFixedMo()` → sum of the nine group monthly allocations (2449.88)
  - `wlAvailMo()` → `2*netPerCheck − wlFixedMo()` (3108.02)
  - `wlDailyLivingMo()` → `wlAvailMo() − savingsTargetMo` (108.02)

- [ ] **Step 1: Write the failing tests**

Create `tests/wealth.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../js/wealth.js', import.meta.url), 'utf8');
const ctx = vm.createContext({ console });
vm.runInContext(src, ctx);
const W = ctx; // top-level function declarations are vm globals

test('PLAN totals are internally consistent', () => {
  const p = W.wlPlan();
  assert.equal(p.netPerCheck, 2778.95);
  assert.equal(p.payAnchor, '2026-07-24');
  assert.equal(p.savingsTargetMo, 3000);
  assert.equal(p.groups.length, 9);
  assert.equal(W.wlFixedMo(), 2449.88);
  assert.equal(W.wlAvailMo(), 3108.02);
  assert.equal(W.wlDailyLivingMo(), 108.02);
  assert.equal(p.milestones.reduce((s, m) => s + m.amount, 0), 28500);
});

test('every mapped category points at a real group id or living', () => {
  const p = W.wlPlan();
  const ids = new Set(p.groups.map(g => g.id).concat(['living']));
  for (const [cat, gid] of Object.entries(W.wlCatToGroup())) {
    assert.ok(ids.has(gid), `${cat} -> ${gid} is not a known group`);
  }
});

test('wlPaydays: July 2026 has 2 paydays from the 2026-07-24 anchor', () => {
  const r = W.wlPaydays('2026-07-24', '2026-07-25');
  assert.deepEqual(r.dates, ['2026-07-10', '2026-07-24']);
  assert.equal(r.expected, 2);
  assert.equal(r.dueByToday, 2);
});

test('wlPaydays: October 2026 is a third-check month', () => {
  const r = W.wlPaydays('2026-07-24', '2026-10-05');
  assert.deepEqual(r.dates, ['2026-10-02', '2026-10-16', '2026-10-30']);
  assert.equal(r.expected, 3);
  assert.equal(r.dueByToday, 1);
});

test('wlPaydays works for months before the anchor', () => {
  const r = W.wlPaydays('2026-07-24', '2026-06-15');
  assert.deepEqual(r.dates, ['2026-06-12', '2026-06-26']);
  assert.equal(r.dueByToday, 1);
});

const T = [
  { id: '1', date: '2026-07-03', type: 'expense',  amount: 745,     account: 'chase_checking', toAccount: '', category: 'Rent',                   description: 'July rent',   recurring: '' },
  { id: '2', date: '2026-07-05', type: 'expense',  amount: 82.35,   account: 'chase_checking', toAccount: '', category: 'Groceries',              description: 'Publix',      recurring: '' },
  { id: '3', date: '2026-07-10', type: 'income',   amount: 2778.95, account: 'chase_checking', toAccount: '', category: 'Paycheck',               description: 'Stantec',     recurring: '' },
  { id: '4', date: '2026-07-11', type: 'transfer', amount: 1500,    account: 'chase_checking', toAccount: 'usf_savings_1', category: 'Savings Transfer', description: 'sweep', recurring: '' },
  { id: '5', date: '2026-07-12', type: 'expense',  amount: 200,     account: 'chase_checking', toAccount: '', category: 'Family Support (Ghana)', description: 'Lemfi',       recurring: '' },
  { id: '6', date: '2026-07-15', type: 'expense',  amount: 35,      account: 'chase_checking', toAccount: '', category: 'Bank Fee',               description: 'wire fee',    recurring: '' },
  { id: '7', date: '2026-06-28', type: 'expense',  amount: 999,     account: 'chase_checking', toAccount: '', category: 'Rent',                   description: 'June rent',   recurring: '' },
  { id: '8', date: '2026-07-18', type: 'expense',  amount: 60,      account: 'chase_checking', toAccount: '', category: 'Mystery Custom',         description: 'unmapped',    recurring: '' },
  { id: '9', date: '2026-07-20', type: 'transfer', amount: 400,     account: 'chase_checking', toAccount: 'usf_checking', category: 'Transfer',   description: 'move',        recurring: '' },
];

test('wlAggregate: groups, bills, savings, paychecks, exclusions, unmapped', () => {
  const a = W.wlAggregate(T, '2026-07-25');
  assert.equal(a.month, '2026-07');
  assert.equal(a.groups.housing, 745);          // June rent (id 7) excluded
  assert.equal(a.groups.living, 82.35);
  assert.equal(a.groups.ghana, 200);
  assert.equal(a.savingsThisMonth, 1500);
  assert.equal(a.paychecksLanded, 1);
  assert.equal(a.netLanded, 2778.95);
  assert.equal(a.bills.rent.total, 745);
  assert.equal(a.bills.rent.lastDate, '2026-07-03');
  assert.equal(a.bills.remit.total, 200);
  assert.equal(a.bills.utilities, undefined);   // nothing paid → key absent
  assert.deepEqual(a.unmapped, [{ category: 'Mystery Custom', total: 60 }]);
  // Bank Fee excluded everywhere; plain transfer (id 9) ignored
  const allGroupSpend = Object.values(a.groups).reduce((s, v) => s + v, 0);
  assert.equal(allGroupSpend, 745 + 82.35 + 200);
});

test('wlAggregate: empty month is all zeros, no crash', () => {
  const a = W.wlAggregate([], '2026-08-01');
  assert.equal(a.paychecksLanded, 0);
  assert.equal(a.savingsThisMonth, 0);
  assert.deepEqual(a.unmapped, []);
  assert.equal(Object.values(a.groups).every(v => v === 0), true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (PowerShell, from repo root): `node --test tests/`
Expected: FAIL — cannot read `js/wealth.js` (file does not exist).

- [ ] **Step 3: Create `js/wealth.js` with PLAN + map + pure functions**

```js
'use strict';
/* ═══════════════════════════════════════════════════════════════
   MoneyTrack — Wealth tab (live view of the Wealth Corridor plan)

   PLAN below is the ONLY place plan numbers live (see CLAUDE.md).
   Amounts are monthly; biweekly plan lines were ×2 from plan.html.
   Top-level code here must stay DOM-free and app.js-free: the pure
   functions are unit-tested in Node (tests/wealth.test.mjs).
   ═══════════════════════════════════════════════════════════════ */

const PLAN = {
  netPerCheck: 2778.95,          // net per biweekly paycheck
  payAnchor: '2026-07-24',       // any real payday; biweekly from here
  savingsTargetMo: 3000,         // chosen target (plan.html: "$3,000 budgeted")
  kMo: 652.56,                   // 401k you+match monthly = (167.32+133.86)*26/12
  returnPct: 6.7,                // studio default real return
  years: 30,                     // studio default horizon
  // Nine fixed groups. monthly = plan.html biweekly sub × 2.
  // bills = lines that get a paid/due chip, matched by txn category.
  groups: [
    { id: 'giving',    label: 'Giving',                   monthly: 595.80, color: '#a78bfa',
      bills: [ { id: 'tithe',     label: 'Tithe',         monthly: 555.80, categories: ['Tithe'] },
               { id: 'offering',  label: 'Offering',      monthly: 40.00,  categories: ['Offering'] } ] },
    { id: 'housing',   label: 'Housing',                  monthly: 845.00, color: '#60a5fa',
      bills: [ { id: 'rent',      label: 'Rent',          monthly: 745.00, categories: ['Rent'] },
               { id: 'utilities', label: 'Utilities',     monthly: 100.00, categories: ['Utilities'] } ] },
    { id: 'transport', label: 'Transport',                monthly: 458.00, color: '#2dd4bf',
      bills: [ { id: 'carins',    label: 'Car insurance', monthly: 163.00, categories: ['Car Insurance'] } ] },
    { id: 'subs',      label: 'Subscriptions',            monthly: 129.00, color: '#f472b6', bills: [] },
    { id: 'protect',   label: 'Protection & obligations', monthly: 70.00,  color: '#fbbf24', bills: [] },
    { id: 'explore',   label: 'Exploration',              monthly: 75.00,  color: '#fb923c', bills: [] },
    { id: 'ghana',     label: 'Ghana family',             monthly: 200.00, color: '#f87171',
      bills: [ { id: 'remit',     label: 'Remittance',    monthly: 200.00, categories: ['Family Support (Ghana)'] } ] },
    { id: 'annual',    label: 'Annual irregular',         monthly: 27.08,  color: '#8a8aa6', bills: [] },
    { id: 'profdev',   label: 'Professional dev',         monthly: 50.00,  color: '#e879f9', bills: [] },
  ],
  livingColor: '#fbbf24',
  savingsColor: '#4ade80',
  // Daily-living split, display only (plan.html LIVING)
  livingSplit: [
    ['Groceries', 0.42], ['Solo dining out', 0.11], ['Personal care', 0.10],
    ['Clothing fund', 0.09], ['Medical & pharmacy', 0.09], ['Household supplies', 0.06],
    ['Buffer / unplanned', 0.09], ['Gym & fitness', 0.04],
  ],
  milestones: [
    { id: 'starter', label: 'Starter buffer', amount: 2000 },
    { id: 'taxres',  label: 'Tax reserve',    amount: 3500 },
    { id: 'ef',      label: 'Emergency fund', amount: 13000 },
    { id: 'niw',     label: 'NIW reserve',    amount: 10000 },
  ],
};

// MoneyTrack txn category → plan group id ('living' = Daily living card)
const WEALTH_CATEGORY_MAP = {
  'Tithe': 'giving', 'Offering': 'giving',
  'Rent': 'housing', 'Utilities': 'housing',
  'Gas': 'transport', 'Car Insurance': 'transport', 'Parking': 'transport', 'Rideshare': 'transport',
  'Subscriptions': 'subs', 'Streaming': 'subs',
  'Insurance': 'protect', 'Gifts': 'protect', 'Family Support (US)': 'protect', 'Friends Support': 'protect',
  'Travel': 'explore', 'Events': 'explore',
  'Family Support (Ghana)': 'ghana',
  'Education': 'profdev',
  'Groceries': 'living', 'Dining Out': 'living', 'Fast Food': 'living', 'Food Delivery': 'living',
  'Snacks & Drinks': 'living', 'Coffee': 'living', 'Personal Care': 'living', 'Beauty & Grooming': 'living',
  'Clothing': 'living', 'Shoes & Accessories': 'living', 'Medical': 'living', 'Pharmacy': 'living',
  'Gym': 'living', 'Household Essentials': 'living', 'Home & Furniture': 'living', 'Amazon': 'living',
  'Online Shopping': 'living', 'Electronics': 'living', 'School Supplies': 'living', 'Laundry': 'living',
  'Hobbies': 'living', 'Miscellaneous': 'living',
};
const WEALTH_SAVINGS_CATS  = ['Savings Transfer', 'Investment'];
const WEALTH_EXCLUDED_CATS = ['Bill Reserve', 'Loan Payment', 'Credit Card Payment', 'Bank Fee'];

function wlRound(n) { return Math.round(n * 100) / 100; }   // local: no app.js at top level
function wlPlan() { return PLAN; }
function wlCatToGroup() { return WEALTH_CATEGORY_MAP; }
function wlFixedMo() { return wlRound(PLAN.groups.reduce((s, g) => s + g.monthly, 0)); }
function wlAvailMo() { return wlRound(2 * PLAN.netPerCheck - wlFixedMo()); }
function wlDailyLivingMo() { return wlRound(wlAvailMo() - PLAN.savingsTargetMo); }

function wlIsoLocal(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

// Biweekly paydays landing in the month containing todayIso.
// setDate(±14) (not ms math) so DST never shifts the calendar day.
function wlPaydays(anchorIso, todayIso) {
  const d     = new Date(anchorIso + 'T00:00:00');
  const today = new Date(todayIso + 'T00:00:00');
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const last  = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  while (d > first) d.setDate(d.getDate() - 14);
  while (d < first) d.setDate(d.getDate() + 14);
  const dates = [];
  while (d <= last) { dates.push(wlIsoLocal(d)); d.setDate(d.getDate() + 14); }
  return {
    expected: dates.length,
    dueByToday: dates.filter(x => x <= todayIso).length,
    dates,
  };
}

// One pass over the txn log → everything the live blocks need.
function wlAggregate(txns, todayIso) {
  const month = todayIso.slice(0, 7);
  const groups = {};
  PLAN.groups.forEach(g => { groups[g.id] = 0; });
  groups.living = 0;
  const billIndex = {};   // category → bill def
  PLAN.groups.forEach(g => g.bills.forEach(b => b.categories.forEach(c => { billIndex[c] = b; })));

  const bills = {};
  const unmappedByCat = {};
  let savingsThisMonth = 0, netLanded = 0, paychecksLanded = 0;

  for (const t of txns) {
    if (!t.date || t.date.slice(0, 7) !== month) continue;
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
    month, groups, bills, savingsThisMonth, netLanded, paychecksLanded,
    unmapped: Object.entries(unmappedByCat).map(([category, total]) => ({ category, total })),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/`
Expected: all tests PASS. If `wlFixedMo()` ≠ 2449.88, a group `monthly` was mistyped — fix the constant, not the test.

- [ ] **Step 5: Commit**

```bash
git add js/wealth.js tests/wealth.test.mjs
git commit -m "feat(wealth): PLAN config, category map, and month aggregation with node tests"
```

---

### Task 2: Milestones, grade, and projection math (pure functions + tests)

**Files:**
- Modify: `js/wealth.js` (append after `wlAggregate`)
- Test: `tests/wealth.test.mjs` (append)

**Interfaces:**
- Produces (used by Tasks 5–6):
  - `wlMilestones(savingsTotal: number)` → `[{ id, label, amount, filled, done, active }]` (sequential fill; `active` true on the first unfinished stage)
  - `wlGrade(livMo: number)` → `{ g: 'A'..'F', t: title, cls: 'a'..'f' }` (cls maps to `.wl-grade.X` CSS classes — no colors in JS)
  - `wlFV(p, r, n)` → future value of monthly payment `p` at annual rate `r` over `n` months
  - `wlProject(savMo, retPct, years)` → `{ total, contrib, growth, fundM }` (reserve phase at 4% until milestones total 28500 is funded, then brokerage at `retPct`; 401k `PLAN.kMo` at `retPct` throughout)

- [ ] **Step 1: Append failing tests to `tests/wealth.test.mjs`**

```js
test('wlMilestones fills sequentially', () => {
  const zero = W.wlMilestones(0);
  assert.equal(zero[0].filled, 0);
  assert.equal(zero[0].active, true);
  assert.equal(zero.filter(s => s.active).length, 1);

  const mid = W.wlMilestones(4200);
  assert.equal(mid[0].filled, 2000); assert.equal(mid[0].done, true);
  assert.equal(mid[1].filled, 2200); assert.equal(mid[1].active, true);
  assert.equal(mid[2].filled, 0);

  const done = W.wlMilestones(28500);
  assert.equal(done.every(s => s.done), true);
  assert.equal(done.some(s => s.active), false);
});

test('wlGrade thresholds match the plan', () => {
  assert.equal(W.wlGrade(1300).g, 'A');
  assert.equal(W.wlGrade(1050).g, 'B');
  assert.equal(W.wlGrade(850).g,  'C');
  assert.equal(W.wlGrade(650).g,  'D');
  assert.equal(W.wlGrade(500).g,  'E');
  assert.equal(W.wlGrade(499).g,  'F');
  assert.equal(W.wlGrade(108).g,  'F');
});

test('wlProject math is coherent', () => {
  const p = W.wlProject(3000, 6.7, 30);
  assert.equal(p.fundM, 10);                                   // ceil(28500/3000)
  assert.equal(p.contrib, 3000 * 360 + 652.56 * 360);
  assert.ok(Math.abs(p.growth - (p.total - p.contrib)) < 0.01);
  assert.ok(p.total > p.contrib);
  assert.ok(W.wlProject(3000, 7, 30).total > W.wlProject(3000, 5, 30).total);
  assert.ok(W.wlFV(100, 0, 12) === 1200);                      // zero-rate edge
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test tests/`
Expected: Task 1 tests PASS; new tests FAIL with "wlMilestones is not a function".

- [ ] **Step 3: Append implementations to `js/wealth.js`**

```js
// Sequential fill of the four reserve milestones from total savings balance.
function wlMilestones(savingsTotal) {
  let remaining = Math.max(0, savingsTotal || 0);
  let activeSeen = false;
  return PLAN.milestones.map(ms => {
    const filled = wlRound(Math.min(ms.amount, remaining));
    remaining = wlRound(Math.max(0, remaining - ms.amount));
    const done = filled >= ms.amount - 0.005;
    const active = !done && !activeSeen && (activeSeen = true);
    return { id: ms.id, label: ms.label, amount: ms.amount, filled, done, active };
  });
}

// Level of service for a given monthly daily-living amount (plan.html grade()).
function wlGrade(livMo) {
  if (livMo >= 1300) return { g: 'A', t: 'Comfortable',     cls: 'a' };
  if (livMo >= 1050) return { g: 'B', t: 'Sustainable',     cls: 'b' };
  if (livMo >= 850)  return { g: 'C', t: 'Disciplined',     cls: 'c' };
  if (livMo >= 650)  return { g: 'D', t: 'Tight',           cls: 'd' };
  if (livMo >= 500)  return { g: 'E', t: 'Very tight',      cls: 'e' };
  return               { g: 'F', t: 'Not sustainable', cls: 'f' };
}

function wlFV(p, r, n) { const i = r / 12; return i === 0 ? p * n : p * ((Math.pow(1 + i, n) - 1) / i); }

// Reserve phase (cash at 4%) until the 28,500 ladder is funded, then invest.
function wlProject(savMo, retPct, years) {
  const n = years * 12, r = retPct / 100;
  const reserve = PLAN.milestones.reduce((s, m) => s + m.amount, 0);
  const fundM = Math.min(Math.ceil(reserve / savMo), n);
  const res   = wlFV(savMo, 0.04, fundM) * Math.pow(1 + 0.04 / 12, Math.max(0, n - fundM));
  const brok  = wlFV(savMo, r, Math.max(0, n - fundM));
  const k     = wlFV(PLAN.kMo, r, n);
  const total = res + brok + k;
  const contrib = savMo * n + PLAN.kMo * n;
  return { total, contrib, growth: total - contrib, fundM };
}
```

Note the `active` one-liner uses assignment-in-expression; if that reads too clever during implementation, use an explicit index check instead — behavior over style.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add js/wealth.js tests/wealth.test.mjs
git commit -m "feat(wealth): milestone ladder, level-of-service grade, projection math"
```

---

### Task 3: Wire the tab — markup, TABS entry, and the render skeleton

**Files:**
- Modify: `index.html` (tab button after line 64 `Things` button; section before `</main>`; script tag after app.js)
- Modify: `js/app.js:3519-3524` (`TABS`) and `js/app.js:3526-3541` (`switchTab`)
- Modify: `js/wealth.js` (append render skeleton)

**Interfaces:**
- Consumes: `wlAggregate`, `wlPaydays`, `wlPlan` (Task 1); app.js `loadTxns`, `todayISO`, `fmt`, `escapeHTML`.
- Produces: `renderWealthTab()` (called by `switchTab`); container ids `wl-month-sub`, `wl-header`, `wl-board`, `wl-savings`, `wl-ladder`, `wl-studio-*`, `wl-footer` (filled by Tasks 4–6).

- [ ] **Step 1: Add the tab button in `index.html`**

After the `tab-things` button (line 61–64), inside the same `role="tablist"` div:

```html
      <button role="tab" id="tab-wealth" aria-selected="false"
              aria-controls="sec-wealth" tabindex="-1">
        Wealth
      </button>
```

- [ ] **Step 2: Add the section skeleton in `index.html`**

Immediately before `</main>` (after the Things section), the complete static markup — containers for Tasks 4–5, full studio controls for Task 6:

```html
    <!-- ══ WEALTH TAB ═══════════════════════════════════════ -->
    <section id="sec-wealth" role="tabpanel"
             aria-labelledby="tab-wealth" class="sec">

      <h1 class="section-title">Wealth</h1>
      <p class="section-sub" id="wl-month-sub"></p>

      <div class="card" id="wl-header" aria-live="polite"><!-- Rendered by JS --></div>

      <div class="card">
        <div class="card-title">Allocation status
          <span style="font-weight:400;font-size:11px;color:var(--muted)">this month, from your transactions</span>
        </div>
        <div id="wl-board" aria-live="polite"><!-- Rendered by JS --></div>
      </div>

      <div class="card">
        <div class="card-title">Savings this month</div>
        <div id="wl-savings" aria-live="polite"><!-- Rendered by JS --></div>
      </div>

      <div class="card">
        <div class="card-title">Milestones
          <span style="font-weight:400;font-size:11px;color:var(--muted)">from your latest snapshot</span>
        </div>
        <div id="wl-ladder"><!-- Rendered by JS --></div>
      </div>

      <div class="card">
        <div class="card-title">Savings studio
          <span style="font-weight:400;font-size:11px;color:var(--muted)">what-if only — the live target stays in the plan</span>
        </div>
        <div class="wl-studio-read">
          <span id="wl-st-grade" class="wl-grade" aria-live="polite"></span>
          <div>
            <div id="wl-st-title" style="font-weight:600"></div>
            <p id="wl-st-verdict" class="wl-sub"></p>
          </div>
        </div>
        <label class="wl-sl-lab" for="wl-sl-save">Monthly savings <span id="wl-st-save"></span></label>
        <input type="range" id="wl-sl-save" min="600" max="3200" step="25" value="3000">
        <div class="wl-corr" id="wl-corr" aria-hidden="true"></div>
        <div class="wl-corr-key" id="wl-corr-key"></div>
        <div class="wl-proj-head">
          <div><div class="wl-proj-val" id="wl-proj-total"></div><div class="wl-sub" id="wl-proj-cap"></div></div>
          <div class="wl-sub" style="text-align:right">You contribute<br><b id="wl-proj-contrib"></b></div>
        </div>
        <svg id="wl-chart" viewBox="0 0 620 210" style="width:100%;height:auto;display:block" aria-hidden="true"></svg>
        <div class="wl-ctrl-grid">
          <label class="wl-sl-lab" for="wl-sl-ret">Real return <span id="wl-st-ret"></span></label>
          <label class="wl-sl-lab" for="wl-sl-yrs">Years <span id="wl-st-yrs"></span></label>
          <input type="range" id="wl-sl-ret" min="3" max="10" step="0.5" value="6.7">
          <input type="range" id="wl-sl-yrs" min="5" max="35" step="1" value="30">
        </div>
      </div>

      <div class="card" id="wl-footer"><!-- Rendered by JS --></div>
    </section>
```

- [ ] **Step 3: Add the script tag in `index.html`**

Directly after the existing `<script src="js/app.js"></script>` line:

```html
  <script src="js/wealth.js"></script>
```

- [ ] **Step 4: Register the tab in `js/app.js`**

In `TABS` (line 3519), add the fifth entry:

```js
const TABS = [
  { tabId: 'tab-accounts', secId: 'sec-accounts' },
  { tabId: 'tab-tracker',  secId: 'sec-tracker'  },
  { tabId: 'tab-analysis', secId: 'sec-analysis' },
  { tabId: 'tab-things',   secId: 'sec-things'   },
  { tabId: 'tab-wealth',   secId: 'sec-wealth'   },
];
```

In `switchTab()` after the `tab-things` line:

```js
  if (targetTabId === 'tab-wealth')   renderWealthTab();
```

(Click and arrow-key handling need no changes — `bindEvents()` delegates on `[role="tab"]`.)

- [ ] **Step 5: Append the render skeleton to `js/wealth.js`**

```js
/* ── Renderers (browser only — app.js globals allowed from here down) ── */

const WL_MONTHS = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];

function renderWealthTab() {
  const txns  = loadTxns();
  const today = todayISO();
  const agg   = wlAggregate(txns, today);
  const pay   = wlPaydays(PLAN.payAnchor, today);
  renderWlHeader(agg, pay, today);
  renderWlBoard(agg);
  renderWlSavings(agg, pay);
  renderWlLadder();
  bindWlStudio();
  renderWlStudio();
  renderWlFooter(agg);
}

function renderWlHeader(agg, pay, today) {
  const d = new Date(today + 'T00:00:00');
  const sub = document.getElementById('wl-month-sub');
  if (sub) sub.textContent = WL_MONTHS[d.getMonth()] + ' ' + d.getFullYear() +
    ' · plan target ' + fmt(PLAN.savingsTargetMo) + '/mo saved';
  const el = document.getElementById('wl-header');
  if (!el) return;
  let html =
    '<div class="wl-head-line"><b>' + agg.paychecksLanded + ' of ' + pay.expected +
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
  el.innerHTML = html;
}

// Filled in Task 4
function renderWlBoard(agg) {}
function renderWlSavings(agg, pay) {}
// Filled in Task 5
function renderWlLadder() {}
function renderWlFooter(agg) {}
// Filled in Task 6
function bindWlStudio() {}
function renderWlStudio() {}
```

- [ ] **Step 6: Run the unit tests (must still pass — renderers reference app.js globals only inside function bodies)**

Run: `node --test tests/`
Expected: all PASS. If Node throws `loadTxns is not defined` at load time, a renderer referenced an app.js global at top level — move it inside a function.

- [ ] **Step 7: Manual verify in the browser**

1. From repo root: `python -m http.server 8000`
2. Open http://localhost:8000 → DevTools console: `sessionStorage.setItem('moneytrack_auth','1')` → reload.
3. A fifth tab **Wealth** appears; click it → header shows "0 of 2 paychecks landed · $0.00 net so far" (or real values if transactions exist this month). Arrow keys cycle through all five tabs. No console errors.

- [ ] **Step 8: Commit**

```bash
git add index.html js/app.js js/wealth.js
git commit -m "feat(wealth): fifth tab wired with section skeleton and month header"
```

---

### Task 4: Allocation board + savings bar (CSS + renderers)

**Files:**
- Modify: `css/styles.css` (append at end)
- Modify: `js/wealth.js` (replace the `renderWlBoard` / `renderWlSavings` stubs)

**Interfaces:**
- Consumes: `agg.groups`, `agg.bills`, `agg.savingsThisMonth`, `pay.expected`, `agg.paychecksLanded`; app.js `fmt`, `escapeHTML`.
- Produces: filled `#wl-board`, `#wl-savings`. CSS classes `.wl-row`, `.wl-bar`, `.wl-bar-fill(.warn|.over)`, `.wl-chip(.paid)`, `.wl-left(.over)`, `.wl-callout`, `.wl-sub` used by later tasks too.

- [ ] **Step 1: Append the Wealth CSS block to `css/styles.css`**

```css
/* ── Wealth tab ─────────────────────────────────────────── */
.wl-sub { color: var(--muted); font-size: 12px; line-height: 1.5; }
.wl-head-line { font-size: 14px; }
.wl-callout { background: var(--surf2); border: 1px solid var(--border);
  border-radius: var(--radius-sm); padding: 10px 12px; font-size: 12.5px; margin-top: 10px; }
.wl-row { padding: 12px 0; border-bottom: 1px solid var(--border); }
.wl-row:last-child { border-bottom: none; padding-bottom: 2px; }
.wl-row-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 13px; }
.wl-row-head .amt { font-variant-numeric: tabular-nums; color: var(--muted); font-size: 12px; }
.wl-left { font-weight: 600; font-variant-numeric: tabular-nums; }
.wl-left.over { color: var(--red); }
.wl-bar { height: 6px; background: var(--surf3); border-radius: 3px; overflow: hidden; margin-top: 6px; }
.wl-bar-fill { height: 100%; border-radius: 3px; background: var(--green); }
.wl-bar-fill.warn { background: var(--gold); }
.wl-bar-fill.over { background: var(--red); }
.wl-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.wl-chip { font-size: 11px; padding: 2px 9px; border-radius: 999px;
  border: 1px solid var(--border); color: var(--muted); }
.wl-chip.paid { color: var(--green); border-color: var(--green); }
.wl-stage { display: flex; align-items: center; gap: 10px; padding: 9px 0; }
.wl-stage-n { width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center; font-size: 11px; color: var(--muted); flex: none; }
.wl-stage.done .wl-stage-n { background: var(--green); color: var(--bg); border-color: var(--green); }
.wl-stage.active .wl-stage-n { border-color: var(--gold); color: var(--gold); }
.wl-stage-body { flex: 1; min-width: 0; }
.wl-grade { font-size: 30px; font-weight: 700; width: 52px; text-align: center; flex: none; }
.wl-grade.a, .wl-grade.b { color: var(--green); }
.wl-grade.c { color: var(--teal); }
.wl-grade.d { color: var(--gold); }
.wl-grade.e { color: var(--orange); }
.wl-grade.f { color: var(--red); }
.wl-studio-read { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.wl-sl-lab { display: flex; justify-content: space-between; font-size: 12px;
  color: var(--muted); margin: 12px 0 4px; }
.wl-corr { display: flex; height: 24px; border-radius: var(--radius-sm);
  overflow: hidden; margin-top: 14px; }
.wl-corr-key { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 11px;
  color: var(--muted); margin-top: 8px; }
.wl-corr-key i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; }
.wl-proj-head { display: flex; justify-content: space-between; align-items: flex-end; margin: 16px 0 8px; }
.wl-proj-val { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
.wl-ctrl-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
```

- [ ] **Step 2: Replace the `renderWlBoard` stub in `js/wealth.js`**

```js
function wlBarClass(spent, alloc) {
  if (alloc <= 0) return spent > 0 ? 'over' : '';
  const r = spent / alloc;
  return r > 1 ? 'over' : r >= 0.8 ? 'warn' : '';
}

function wlRowHTML(label, alloc, spent, chipsHTML) {
  const left = wlRound(alloc - spent);
  const pct  = alloc > 0 ? Math.min(100, spent / alloc * 100) : (spent > 0 ? 100 : 0);
  const cls  = wlBarClass(spent, alloc);
  const leftTxt = left >= 0
    ? '<span class="wl-left">' + fmt(left) + ' left</span>'
    : '<span class="wl-left over">over by ' + fmt(-left) + '</span>';
  return '<div class="wl-row">' +
    '<div class="wl-row-head"><span>' + escapeHTML(label) + '</span>' +
    '<span><span class="amt">' + fmt(spent) + ' of ' + fmt(alloc) + ' · </span>' + leftTxt + '</span></div>' +
    '<div class="wl-bar"><div class="wl-bar-fill ' + cls + '" style="width:' + pct + '%"></div></div>' +
    (chipsHTML ? '<div class="wl-chips">' + chipsHTML + '</div>' : '') +
    '</div>';
}

function renderWlBoard(agg) {
  const el = document.getElementById('wl-board');
  if (!el) return;
  let html = '';
  PLAN.groups.forEach(g => {
    const chips = g.bills.map(b => {
      const paid = agg.bills[b.id];
      return paid
        ? '<span class="wl-chip paid">' + escapeHTML(b.label) + ' ✓ paid ' + fmtDate(paid.lastDate) + '</span>'
        : '<span class="wl-chip">' + escapeHTML(b.label) + ' — due</span>';
    }).join('');
    html += wlRowHTML(g.label, g.monthly, agg.groups[g.id] || 0, chips);
  });
  html += wlRowHTML('Daily living', wlDailyLivingMo(), agg.groups.living || 0, '');
  el.innerHTML = html;
}
```

- [ ] **Step 3: Replace the `renderWlSavings` stub**

```js
function renderWlSavings(agg, pay) {
  const el = document.getElementById('wl-savings');
  if (!el) return;
  const target = PLAN.savingsTargetMo;
  const saved  = agg.savingsThisMonth;
  const toGo   = wlRound(Math.max(0, target - saved));
  const pending = pay.expected - agg.paychecksLanded;
  let note;
  if (saved >= target) note = 'Target hit. Anything more is ahead of plan.';
  else note = fmt(toGo) + ' to go' + (pending > 0
    ? ' · ' + pending + ' paycheck' + (pending > 1 ? 's' : '') + ' still to land'
    : ' · all paychecks landed — this month will close short unless you top up');
  el.innerHTML = wlRowHTML('Saved (Savings Transfer + Investment)', target, saved, '') +
    '<p class="wl-sub" style="margin-top:8px">' + escapeHTML(note) + '</p>';
}
```

Note: `renderWlSavings` reuses `wlRowHTML`, so an over-target month shows "over by $X" in red — for savings that's a good thing; the note line explains it ("ahead of plan").

- [ ] **Step 4: Run unit tests (regression)**

Run: `node --test tests/`
Expected: all PASS.

- [ ] **Step 5: Manual verify**

With the local server + auth bypass from Task 3:
1. Tracker tab → add expense: today, $745, category **Rent**, any account, description "July rent". Add expense $82.35 **Groceries**. Add transfer $1,500 **Savings Transfer** to a savings account. Add income $2,778.95 **Paycheck**.
2. Wealth tab →
   - Housing row: "$745.00 of $845.00 · $100.00 left", bar amber (88%), chip "Rent ✓ paid <today>", chip "Utilities — due".
   - Daily living row: "over by $..." red text and red bar IF $82.35 > $108.02 minus prior spend — with only $82.35 logged it shows "$25.67 left" and an amber-free bar at 76%.
   - Savings card: "$1,500.00 of $3,000.00 · $1,500.00 left", note "…to go · 1 paycheck still to land" (July has 2 paydays; 1 Paycheck logged).
   - Header: "1 of 2 paychecks landed · $2,778.95 net so far".
3. Add a second Rent expense $50 → Housing spent becomes $795, Rent chip date updates to the later date.
4. Delete the test transactions afterwards (Tracker tab) unless you want them kept.

- [ ] **Step 6: Commit**

```bash
git add css/styles.css js/wealth.js
git commit -m "feat(wealth): live allocation board with paid chips and savings progress"
```

---

### Task 5: Milestone ladder + footer (unmapped spend, plan link)

**Files:**
- Modify: `js/wealth.js` (replace `renderWlLadder` / `renderWlFooter` stubs)

**Interfaces:**
- Consumes: app.js `getLatestSnapshot`, `ACCOUNTS`, `safeAmt`, `roundMoney`, `fmt`, `fmtDate`, `escapeHTML`; `wlMilestones` (Task 2); CSS `.wl-stage*` (Task 4).
- Produces: filled `#wl-ladder`, `#wl-footer`.

- [ ] **Step 1: Replace the `renderWlLadder` stub**

```js
function wlSavingsTotal(snap) {
  const b = (snap && snap.accounts) || {};
  return roundMoney(ACCOUNTS.filter(a => a.group === 'savings')
    .reduce((s, a) => s + safeAmt(b[a.id]), 0));
}

function renderWlLadder() {
  const el = document.getElementById('wl-ladder');
  if (!el) return;
  const snap = getLatestSnapshot();
  if (!snap) {
    el.innerHTML = '<p class="wl-sub">No snapshot yet — record your balances in the ' +
      'Accounts tab and the ladder fills from your savings accounts.</p>';
    return;
  }
  const total  = wlSavingsTotal(snap);
  const stages = wlMilestones(total);
  let html = '';
  stages.forEach((s, i) => {
    const pct = Math.min(100, s.amount > 0 ? s.filled / s.amount * 100 : 0);
    html += '<div class="wl-stage ' + (s.done ? 'done' : s.active ? 'active' : '') + '">' +
      '<div class="wl-stage-n">' + (s.done ? '✓' : i + 1) + '</div>' +
      '<div class="wl-stage-body">' +
      '<div class="wl-row-head"><span>' + escapeHTML(s.label) + '</span>' +
      '<span class="amt">' + fmt(s.filled) + ' of ' + fmt(s.amount) + '</span></div>' +
      '<div class="wl-bar"><div class="wl-bar-fill' + (s.done ? '' : ' warn') + '" style="width:' + pct + '%"></div></div>' +
      '</div></div>';
  });
  html += '<p class="wl-sub" style="margin-top:8px">' + fmt(total) +
    ' in savings accounts · as of ' + fmtDate(snap.date) + ' snapshot</p>';
  el.innerHTML = html;
}
```

- [ ] **Step 2: Replace the `renderWlFooter` stub**

```js
function renderWlFooter(agg) {
  const el = document.getElementById('wl-footer');
  if (!el) return;
  let html = '';
  if (agg.unmapped.length) {
    html += '<div class="wl-callout"><b>Not counted on the board:</b> ' +
      agg.unmapped.map(u => escapeHTML(u.category) + ' ' + fmt(u.total)).join(' · ') +
      ' — add these categories to WEALTH_CATEGORY_MAP in js/wealth.js if they belong to a group.</div>';
  }
  html += '<p class="wl-sub" style="margin-top:' + (agg.unmapped.length ? '10px' : '0') + '">' +
    'The full plan — investing mechanics, nonresident tax, Ghana, 97-year scenarios — ' +
    '<a href="plan.html" target="_blank" rel="noopener">read it here</a>.</p>';
  el.innerHTML = html;
}
```

- [ ] **Step 3: Run unit tests (regression)**

Run: `node --test tests/`
Expected: all PASS.

- [ ] **Step 4: Manual verify**

1. Fresh browser profile (or clear site data): Wealth tab ladder shows the "No snapshot yet" note. Footer shows only the plan link; the link opens the full Wealth Corridor dashboard in a new tab.
2. Accounts tab → save a snapshot with USF Savings 1 = 4200 (others 0) → Wealth tab: Starter buffer ✓ done (2,000 of 2,000), Tax reserve active with 2,200 of 3,500 (63% amber bar), stages 3–4 empty, caption "$4,200.00 in savings accounts · as of <today> snapshot".
3. Tracker → add expense with a category not in the map (e.g. create/use "Bank Fee" is excluded, so instead temporarily add a custom-labeled category via CSV import or pick "Freelance" as income — simplest: add an expense with category **Bill Reserve** and confirm it does NOT appear anywhere, then verify the unmapped callout using a category outside the map if one exists in the dropdowns; if every dropdown category is mapped/excluded, verify the unmapped branch with the Task 1 unit test only and note that).
4. Delete test data.

- [ ] **Step 5: Commit**

```bash
git add js/wealth.js
git commit -m "feat(wealth): milestone ladder from snapshots and unmapped-spend footer"
```

---

### Task 6: Savings studio (slider, grade, corridor, projection chart)

**Files:**
- Modify: `js/wealth.js` (replace `bindWlStudio` / `renderWlStudio` stubs)

**Interfaces:**
- Consumes: `wlGrade`, `wlProject`, `wlAvailMo`, `wlFixedMo` (Tasks 1–2); studio DOM ids from Task 3 (`wl-sl-save`, `wl-sl-ret`, `wl-sl-yrs`, `wl-st-*`, `wl-corr`, `wl-corr-key`, `wl-proj-*`, `wl-chart`).
- Produces: fully interactive studio. No state outside the DOM (slider values are the state).

- [ ] **Step 1: Replace the two stubs**

```js
function bindWlStudio() {
  const sec = document.getElementById('sec-wealth');
  if (!sec || sec._wlStudioBound) return;
  sec._wlStudioBound = true;
  ['wl-sl-save', 'wl-sl-ret', 'wl-sl-yrs'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', renderWlStudio);
  });
}

function wlM0(n) { return '$' + Math.round(n).toLocaleString('en-US'); }

function renderWlStudio() {
  const savMo = +(document.getElementById('wl-sl-save')?.value || PLAN.savingsTargetMo);
  const ret   = +(document.getElementById('wl-sl-ret')?.value  || PLAN.returnPct);
  const yrs   = +(document.getElementById('wl-sl-yrs')?.value  || PLAN.years);
  const livMo = wlRound(wlAvailMo() - savMo);
  const grade = wlGrade(livMo);

  const gEl = document.getElementById('wl-st-grade');
  if (gEl) { gEl.textContent = grade.g; gEl.className = 'wl-grade ' + grade.cls; }
  const tEl = document.getElementById('wl-st-title');
  if (tEl) tEl.textContent = grade.t;
  const vEl = document.getElementById('wl-st-verdict');
  if (vEl) vEl.textContent = 'Saving ' + wlM0(savMo) + '/mo leaves ' + wlM0(livMo) +
    ' a month for groceries, medical, clothing and everything unplanned. ' +
    'Third-paycheck months add ' + wlM0(2 * PLAN.netPerCheck) + ' a year on top.';
  const sEl = document.getElementById('wl-st-save');
  if (sEl) sEl.textContent = wlM0(savMo) + '/mo · ' + wlM0(savMo / 2) + ' per check';

  // Corridor: fixed groups + daily living (dim) + savings, % of the 2-check month
  const moNet = 2 * PLAN.netPerCheck;
  const corr = document.getElementById('wl-corr'), key = document.getElementById('wl-corr-key');
  if (corr && key) {
    const segs = PLAN.groups.map(g => ({ label: g.label, v: g.monthly, color: g.color }));
    segs.push({ label: 'Daily living', v: Math.max(0, livMo), color: PLAN.livingColor, dim: true });
    segs.push({ label: 'Savings', v: savMo, color: PLAN.savingsColor });
    corr.innerHTML = segs.map(s =>
      '<div style="width:' + (s.v / moNet * 100) + '%;background:' + s.color +
      (s.dim ? ';opacity:.45' : '') + '" title="' + escapeHTML(s.label + ' — ' + fmt(s.v)) + '"></div>'
    ).join('');
    key.innerHTML = segs.map(s =>
      '<span><i style="background:' + s.color + '"></i>' + escapeHTML(s.label) +
      ' <b>' + wlM0(s.v) + '</b></span>').join('');
  }

  // Projection
  const p = wlProject(savMo, ret, yrs);
  const set = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
  set('wl-proj-total', wlM0(p.total));
  set('wl-proj-cap', 'at age ' + (29 + yrs) + " · today's dollars · reserves full in " + p.fundM + ' mo');
  set('wl-proj-contrib', wlM0(p.contrib));
  set('wl-st-ret', ret.toFixed(1) + '% real');
  set('wl-st-yrs', yrs + ' yrs');

  // Chart: yearly balance curve (same math as wlProject, evaluated per year)
  const svg = document.getElementById('wl-chart');
  if (!svg) return;
  const W = 620, H = 210, L = 54, R = 12, T = 12, B = 24;
  const pts = [];
  for (let y = 0; y <= yrs; y++) {
    const n = y * 12, fm = Math.min(p.fundM, n), r = ret / 100;
    pts.push([y,
      wlFV(savMo, 0.04, fm) * Math.pow(1 + 0.04 / 12, Math.max(0, n - fm)) +
      wlFV(savMo, r, Math.max(0, n - fm)) + wlFV(PLAN.kMo, r, n)]);
  }
  const max = pts[pts.length - 1][1] || 1;
  const X = y => L + (y / yrs) * (W - L - R), Y = v => H - B - (v / max) * (H - T - B);
  const kFmt = n => n >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : '$' + Math.round(n / 1000) + 'k';
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = max * i / 4, y = Y(v);
    g += '<line x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y +
      '" stroke="currentColor" opacity="0.12"/>';
    g += '<text x="' + (L - 7) + '" y="' + (y + 3.5) + '" fill="currentColor" opacity="0.55" ' +
      'font-size="9" text-anchor="end">' + kFmt(v) + '</text>';
  }
  const step = yrs <= 10 ? 2 : 5;
  for (let y = 0; y <= yrs; y += step) {
    g += '<text x="' + X(y) + '" y="' + (H - 7) + '" fill="currentColor" opacity="0.55" ' +
      'font-size="9" text-anchor="middle">' + (29 + y) + '</text>';
  }
  let d = 'M' + X(0) + ',' + Y(0);
  pts.forEach(pt => { d += ' L' + X(pt[0]).toFixed(1) + ',' + Y(pt[1]).toFixed(1); });
  g += '<path d="' + d + ' L' + X(yrs) + ',' + (H - B) + ' L' + L + ',' + (H - B) +
    ' Z" fill="' + PLAN.savingsColor + '" opacity="0.15"/>';
  g += '<path d="' + d + '" fill="none" stroke="' + PLAN.savingsColor + '" stroke-width="2"/>';
  svg.innerHTML = g;
}
```

(`currentColor` in the SVG follows the theme's text color, so the chart works in light and dark themes without new hex values; the two brand-color strokes come from `PLAN` config, which CLAUDE.md permits.)

- [ ] **Step 2: Run unit tests (regression)**

Run: `node --test tests/`
Expected: all PASS.

- [ ] **Step 3: Manual verify**

1. Wealth tab → studio shows grade **F — Not sustainable** at the default $3,000 slider (daily living $108 — this is faithful to the plan; plan.html says the same, plainly).
2. Drag savings to 2,250 → grade C "Disciplined", living ≈ $858; corridor's Daily-living segment widens; key updates.
3. Return slider to 10%, years to 35 → projection total grows, axis labels rescale, "at age 64".
4. Toggle light theme → chart axes/labels legible in both themes.
5. Leave the tab, log a Groceries expense in Tracker, return to Wealth → board updates; studio sliders keep their positions (DOM state survives within the session).

- [ ] **Step 4: Commit**

```bash
git add js/wealth.js
git commit -m "feat(wealth): interactive savings studio with corridor and projection chart"
```

---

### Task 7: Service worker, CLAUDE.md, and the full acceptance checklist

**Files:**
- Modify: `sw.js:3-10`
- Modify: `CLAUDE.md` (File Structure + new Wealth section)

**Interfaces:**
- Consumes: everything prior.
- Produces: offline support for the new files; documented conventions.

- [ ] **Step 1: Update `sw.js`**

```js
const CACHE_NAME = 'moneytrack-v13';
const APP_SHELL  = [
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/wealth.js',
  './plan.html',
  './icons/icon.svg',
  './manifest.json',
];
```

- [ ] **Step 2: Update `CLAUDE.md`**

In the File Structure block, change the `js/` entry to:

```
└── js/
    ├── app.js        # Core app logic — config, data layer, rendering, events
    └── wealth.js     # Wealth tab — PLAN config, category map, live plan renderers
```

Add after the "Single source of truth for accounts" section:

```markdown
### Single source of truth for plan numbers
The `PLAN` object at the top of `js/wealth.js` is the **only** place Wealth-plan
numbers live (net per check, payAnchor, group allocations, milestones, savings
target). Pay or rent changes are one-line edits there. `WEALTH_CATEGORY_MAP`
in the same file maps transaction categories to plan groups; a category missing
from the map shows up in the Wealth tab's "not counted" footer — add it to the
map rather than special-casing renderers. Top-level code in wealth.js must stay
DOM-free and app.js-free so `node --test tests/` keeps working.
```

- [ ] **Step 3: Run the full acceptance checklist**

1. `node --test tests/` → all pass.
2. Serve locally, hard-reload twice (SW update), DevTools → Application → Cache Storage shows `moneytrack-v13` containing `wealth.js` and `plan.html`.
3. DevTools → Network → Offline → reload → app loads, Wealth tab renders, plan.html link opens from cache.
4. Seed one expense per mapped category (spot-check five) → each lands in its group; totals match by hand.
5. Rent txn → chip ✓ with date; delete txn → chip back to "due".
6. Savings Transfer + Investment both count toward the savings bar.
7. Overspend a group → red "over by $X", bar capped at 100%.
8. Fresh profile → all empty states, no console errors.
9. Snapshot with savings balances → ladder fills sequentially, partial stage math correct.
10. Keyboard: arrow keys reach Wealth from Things and wrap around; focus visible.
11. Export backup → wipe site data → import backup → Wealth tab identical (no new storage keys).
12. Both themes: board bars, chips, grade colors, chart all legible.

- [ ] **Step 4: Commit**

```bash
git add sw.js CLAUDE.md
git commit -m "feat(wealth): cache wealth assets offline and document plan conventions"
```

---

## Out of scope (per spec)

- Editing plan numbers in the UI; restyling plan.html; auto-creating transactions from the plan ("mark rent paid" button); per-paycheck status window.
- Pushing to GitHub — user decides when (repo is public by their explicit choice).
