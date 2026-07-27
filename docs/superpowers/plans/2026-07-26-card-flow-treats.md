# Card Flow, Treating Friends & Live Card Balance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop credit-card statement payments from double-counting as spending, add a "Treating Friends" category, and show a live "Owed now" figure per debt account (snapshot + charges since − payments since).

**Architecture:** Three surgical changes to the existing vanilla-JS app: one Set constant gains a member, one category threads through four config points, and one new pure function `cardOwedNow()` (unit-tested via the tests/app.test.mjs vm harness) renders one extra line in `renderDebtDetails()`. Spec: `docs/superpowers/specs/2026-07-26-card-flow-treats-design.md`.

**Tech Stack:** Vanilla JS, localStorage, node:test + vm.runInThisContext.

## Global Constraints

- Run tests as `node --test` from repo root (dir-arg form broken on Windows/Node v24).
- `tests/app.test.mjs` already stubs document/window/storage and unrefs timers — new tests go in that file.
- Money through `roundMoney()`/`safeAmt()`; dates ISO; user strings through `escapeHTML()`; colors from existing config values only.
- KPIs, Net Worth, NW trend, exports stay snapshot-based — do not touch `calcNetWorth`.
- Work on branch `feature/card-flow`; never implement on master.

---

### Task 1: Double-count fix + cardOwedNow() (TDD)

**Files:**
- Modify: `js/app.js:73` (NON_EXPENSE_CATS), plus new function after `getNextDueDate` (~line 680)
- Test: `tests/app.test.mjs` (append)

**Interfaces:**
- Produces: `cardOwedNow(account, snap, txns, debtAccountCount) → { owed, base, charges, payments, since }` — Task 3 renders this. `account` is an ACCOUNTS entry; `snap` is a snapshot object or null; `since` is the snapshot date or `''`.

- [ ] **Step 1: Append failing tests to `tests/app.test.mjs`:**

```js
// ── NON_EXPENSE_CATS: payment categories are not spending ──

test('NON_EXPENSE_CATS excludes Credit Card Payment (regression: double-count)', () => {
  assert.match(src, /NON_EXPENSE_CATS = new Set\(\[[^\]]*'Credit Card Payment'/);
  assert.match(src, /NON_EXPENSE_CATS = new Set\(\[[^\]]*'Loan Payment'/);
  assert.match(src, /NON_EXPENSE_CATS = new Set\(\[[^\]]*'Bill Reserve'/);
});

// ── cardOwedNow: live card balance = snapshot + charges since − payments since ──

const CARD = { id: 'discover', label: 'Discover (Owed)', group: 'debt' };
const SNAP = { date: '2026-07-20', accounts: { discover: 210 } };
const CARD_TXNS = [
  { date: '2026-07-20', type: 'expense',  account: 'discover',       category: 'Groceries',           amount: 999 },     // snapshot day: already in base
  { date: '2026-07-22', type: 'expense',  account: 'discover',       category: 'Gas',                 amount: 50 },
  { date: '2026-07-24', type: 'expense',  account: 'discover',       category: 'Dining Out',          amount: 36.40 },
  { date: '2026-07-23', type: 'expense',  account: 'chase_checking', category: 'Groceries',           amount: 80 },      // not on the card
  { date: '2026-07-25', type: 'transfer', account: 'chase_checking', toAccount: 'discover',           amount: 100 },     // payment
  { date: '2026-07-25', type: 'transfer', account: 'chase_checking', toAccount: 'usf_savings_1',      amount: 500 },     // unrelated transfer
];

test('cardOwedNow: base + charges since snapshot − transfer payments', () => {
  const r = A.cardOwedNow(CARD, SNAP, CARD_TXNS, 1);
  assert.equal(r.base, 210);
  assert.equal(r.charges, 86.40);
  assert.equal(r.payments, 100);
  assert.equal(r.owed, 196.40);
  assert.equal(r.since, '2026-07-20');
});

test('cardOwedNow: legacy Credit Card Payment expense counts as payment only with a single debt account', () => {
  const txns = [{ date: '2026-07-25', type: 'expense', account: 'chase_checking', category: 'Credit Card Payment', amount: 75 }];
  assert.equal(A.cardOwedNow(CARD, SNAP, txns, 1).payments, 75);
  assert.equal(A.cardOwedNow(CARD, SNAP, txns, 2).payments, 0);
});

test('cardOwedNow: Credit Card Payment on the card itself is never a charge', () => {
  const txns = [{ date: '2026-07-25', type: 'expense', account: 'discover', category: 'Credit Card Payment', amount: 60 }];
  assert.equal(A.cardOwedNow(CARD, SNAP, txns, 2).charges, 0);
});

test('cardOwedNow without a snapshot counts every dated txn from zero', () => {
  const r = A.cardOwedNow(CARD, null, CARD_TXNS, 1);
  assert.equal(r.base, 0);
  assert.equal(r.since, '');
  assert.equal(r.charges, 1085.40);   // 999 + 50 + 36.40
  assert.equal(r.owed, 985.40);
});
```

- [ ] **Step 2: Run `node --test` — expect the 5 new tests to FAIL** (`cardOwedNow is not a function`; the regex test fails on the missing set member). The existing 32 stay green.

- [ ] **Step 3: Implement.** In `js/app.js:73` change:

```js
const NON_EXPENSE_CATS = new Set(['Bill Reserve', 'Loan Payment', 'Credit Card Payment']);
```

After `getNextDueDate` (~line 680) add:

```js
// Live card balance: last snapshot's figure plus charges logged since,
// minus payments since (transfers to the card; with a single debt account,
// legacy 'Credit Card Payment' expenses too). The snapshot day itself is
// already inside the snapshot, so only strictly-later txns count.
function cardOwedNow(account, snap, txns, debtAccountCount) {
  const base  = snap ? safeAmt((snap.accounts || {})[account.id]) : 0;
  const since = snap ? snap.date : '';
  let charges = 0, payments = 0;
  for (const t of txns) {
    if (!t.date || t.date <= since) continue;
    if (t.type === 'expense' && t.account === account.id && t.category !== 'Credit Card Payment') {
      charges = roundMoney(charges + safeAmt(t.amount));
    } else if (t.type === 'transfer' && t.toAccount === account.id) {
      payments = roundMoney(payments + safeAmt(t.amount));
    } else if (debtAccountCount === 1 && t.type === 'expense' && t.category === 'Credit Card Payment') {
      payments = roundMoney(payments + safeAmt(t.amount));
    }
  }
  return { owed: roundMoney(base + charges - payments), base, charges, payments, since };
}
```

- [ ] **Step 4: Run `node --test` — 37/37 pass.** Also `node --check js/app.js`.

- [ ] **Step 5: Commit**

```bash
git add js/app.js tests/app.test.mjs
git commit -m "fix: card payments are not spending; add live cardOwedNow math"
```

---

### Task 2: Treating Friends category

**Files:**
- Modify: `index.html:372` (category option), `js/app.js` CATEGORY_COLORS (~line 59) and Budget-card `expenseCats` (~line 1905), `js/wealth.js` WEALTH_CATEGORY_MAP (~line 59)

**Interfaces:**
- Consumes: nothing. Produces: the `Treating Friends` category string used by user data from now on.

- [ ] **Step 1: index.html — after `<option value="Friends Support">Friends Support</option>` (line 372) add:**

```html
                <option value="Treating Friends">Treating Friends</option>
```

- [ ] **Step 2: app.js CATEGORY_COLORS — extend the support-family line:**

Change `'Family Support (Ghana)': '#e879f9', 'Family Support (US)': '#e879f9', 'Friends Support': '#e879f9',` to end with `'Treating Friends': '#e879f9',` appended on the same line.

- [ ] **Step 3: app.js Budget card `expenseCats` — in the line containing `'Tithe','Offering','Family Support (US)','Family Support (Ghana)','Donations',` insert `'Treating Friends',` after `'Family Support (Ghana)',`.**

- [ ] **Step 4: wealth.js WEALTH_CATEGORY_MAP — extend the protect line:**

Change `'Insurance': 'protect', 'Gifts': 'protect', 'Family Support (US)': 'protect', 'Friends Support': 'protect',` to also contain `'Treating Friends': 'protect',`.

- [ ] **Step 5: Run `node --test` — 37/37** (the existing "every mapped category points at a real group" test now covers the new entry). `node --check js/app.js && node --check js/wealth.js`.

- [ ] **Step 6: Commit**

```bash
git add index.html js/app.js js/wealth.js
git commit -m "feat: Treating Friends category (dropdown, color, wealth map, budgets)"
```

---

### Task 3: "Owed now" on the Debt Details card

**Files:**
- Modify: `js/app.js` `renderDebtDetails()` (~line 897-955), `css/styles.css` (append)

**Interfaces:**
- Consumes: `cardOwedNow(account, snap, txns, debtAccountCount)` from Task 1.

- [ ] **Step 1: In `renderDebtDetails()`, after `const b = snap.accounts || {};` add `const txns = loadTxns();`. Then inside the `debtAccounts.map(a => {` callback, after the `const balance = ...` line, add:**

```js
    const ow = cardOwedNow(a, snap, txns, debtAccounts.length);
    const owedHtml = (ow.charges > 0 || ow.payments > 0)
      ? `<div class="debt-owed-now">Owed now: <b class="text-red">${fmt(ow.owed)}</b>
           <div class="debt-owed-break">snapshot ${fmt(ow.base)} (${escapeHTML(fmtDate(snap.date))}) + ${fmt(ow.charges)} charges − ${fmt(ow.payments)} payments</div>
         </div>`
      : `<div class="debt-owed-now">Owed now: <b class="text-red">${fmt(ow.owed)}</b></div>`;
```

**and render `${owedHtml}` immediately after the `</div>` that closes `debt-card-header`.**

- [ ] **Step 2: styles.css — append:**

```css
/* ── Debt: live owed line ───────────────────────────────────── */
.debt-owed-now { margin: 6px 0 10px; font-size: 14px; }
.debt-owed-break { font-size: 12px; color: var(--muted); margin-top: 2px; }
```

- [ ] **Step 3: Run `node --test` (37/37) and `node --check js/app.js`.**

- [ ] **Step 4: Commit**

```bash
git add js/app.js css/styles.css
git commit -m "feat: live Owed now line per debt account on Debt Details"
```

---

### Task 4: Cache bump + docs

**Files:**
- Modify: `sw.js:3` (CACHE_NAME v17 → v18), `CLAUDE.md`

- [ ] **Step 1: sw.js — `const CACHE_NAME = 'moneytrack-v18';`**

- [ ] **Step 2: CLAUDE.md — after the "Africa investments" section add:**

```
### Credit-card flow
Card purchases are logged at buy time as expenses on the card account with
their real category — that is when they count as spending. The statement
payment is a transfer checking → card (a legacy 'Credit Card Payment'
expense is tolerated: NON_EXPENSE_CATS keeps it out of spending, and with a
single debt account it counts as a card payment). `cardOwedNow()` renders
the live per-card balance on Debt Details; KPIs and Net Worth stay
snapshot-based.
```

- [ ] **Step 3: `node --test` (37/37), `node --check sw.js`.**

- [ ] **Step 4: Commit**

```bash
git add sw.js CLAUDE.md
git commit -m "feat: bump cache to v18 and document credit-card conventions"
```

---

## Controller acceptance (after Task 4, not an implementer task)

1. `node --test` 37/37; `node --check` app.js / wealth.js / africa.js / sw.js.
2. Wealth harness re-run (wealth.js changed): 194/194 expected — plus confirm the new map entry appears in `wlCatToGroup()`.
3. Static: `Treating Friends` present in index.html option list, CATEGORY_COLORS, WEALTH_CATEGORY_MAP, expenseCats (grep ×4).
4. Ship: merge to master + push per Richmond's approval in-session.

## Out of scope

Split bills / owed-by-friends, card statement periods/due dates, interest in Owed now, multi-card legacy payment attribution.
