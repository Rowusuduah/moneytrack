import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// app.js is a browser script. Stub the globals its top-level bootstrap touches
// so it loads under node; function declarations hoist onto globalThis, so the
// pure helpers are available even though the DOM bootstrap tail no-ops/throws.
const g = globalThis;
g.document = { addEventListener() {}, getElementById() { return null; } };
g.window = g.window || { addEventListener() {} };
g.location = g.location || { reload() {} };
g.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
g.sessionStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
// app.js registers a 60s idle-check interval at load; stub it so the live
// timer does not keep the node --test process alive after the tests finish.
g.setInterval = () => 0;

const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
try { vm.runInThisContext(src); } catch { /* DOM bootstrap tail may throw; helpers already hoisted */ }

const A = globalThis;

test('savingsWithdrawalPct divides by the pre-withdrawal balance, not the depleted one', () => {
  // Taking $500 out of a $1000 account is 50% — the pre-fix bug reported 100%
  // (500 / the $500 left).
  assert.equal(A.savingsWithdrawalPct(500, 1000), 50);
  assert.equal(A.savingsWithdrawalPct(250, 1000), 25);
  assert.equal(A.savingsWithdrawalPct(1000, 1000), 100);
  assert.equal(A.savingsWithdrawalPct(500, 0), null);   // unknown / zero base
  assert.equal(A.savingsWithdrawalPct(500, -5), null);
});

test('Tracker base = current snapshot balance + amount withdrawn this period', () => {
  // Snapshot shows $500 now because $500 was withdrawn from a $1000 account.
  const parts = A.savingsWithdrawalParts({ usf_savings_1: 500 }, (_id, amt) => 500 + amt);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].amt, 500);
  assert.equal(parts[0].priorBal, 1000);
  assert.equal(parts[0].pct, 50);      // regression guard: must not be 100
  assert.notEqual(parts[0].pct, 100);
});

test('Analysis base = start-of-period snapshot balance', () => {
  // Start balance $2000, withdrew $500 during the period => 25%.
  const startB = { usf_savings_1: 2000 };
  const parts = A.savingsWithdrawalParts({ usf_savings_1: 500 }, (id) => startB[id]);
  assert.equal(parts[0].priorBal, 2000);
  assert.equal(parts[0].pct, 25);
});

test('each account gets its own pre-withdrawal base', () => {
  const cur = { usf_savings_1: 700, usf_savings_2: 100 };
  const parts = A.savingsWithdrawalParts(
    { usf_savings_1: 300, usf_savings_2: 100 },
    (id, amt) => cur[id] + amt,
  );
  const by = Object.fromEntries(parts.map(p => [p.id, p]));
  assert.equal(by.usf_savings_1.pct, 30);   // 300 / (700 + 300 = 1000)
  assert.equal(by.usf_savings_2.pct, 50);   // 100 / (100 + 100 = 200)
});

test('rounds the share to one decimal place', () => {
  // 333 / 1000 = 33.3%
  assert.equal(A.savingsWithdrawalPct(333, 1000), 33.3);
});

// ── 3-month savings rate: pooled, not average-of-ratios ──────────────────────

test('pooledSavingsRate weights by dollars, not by month', () => {
  // A $5,000 month saving 10% and a $200 month saving 50%:
  //   simple average of rates = 30%  (the old, distorted number)
  //   pooled = (5200 - 4600) / 5200 = 600/5200 = 0.1154
  const months = [
    { income: 5000, expense: 4500 },
    { income: 200, expense: 100 },
  ];
  const r = A.pooledSavingsRate(months);
  assert.ok(Math.abs(r - 0.11538) < 1e-4, `expected ~0.1154, got ${r}`);
  assert.ok(Math.abs(r - 0.30) > 0.1, 'must not be the old average-of-ratios 30%');
});

test('pooledSavingsRate edge cases', () => {
  assert.equal(A.pooledSavingsRate([]), null);                       // no data
  assert.equal(A.pooledSavingsRate([{ income: 0, expense: 0 }]), null); // no income
  assert.equal(A.pooledSavingsRate([{ income: 1000, expense: 0 }]), 1); // saved all
  assert.equal(A.pooledSavingsRate([{ income: 1000, expense: 1500 }]), -0.5); // overspent
});

test('monthlyRealTotals buckets the last 3 completed months and filters real in/out', () => {
  const refDate = new Date(2026, 5, 15); // Jun 15 2026 → window = May, Apr, Mar
  const txns = [
    { date: '2026-06-10', type: 'income',  amount: 9999, category: 'Salary' },              // current month, excluded
    { date: '2026-05-05', type: 'income',  amount: 2000, category: 'Salary' },              // May income
    { date: '2026-05-20', type: 'expense', amount: 500,  category: 'Groceries' },           // May expense
    { date: '2026-05-25', type: 'income',  amount: 300,  category: 'Money from Last Month' },// excluded income
    { date: '2026-04-10', type: 'expense', amount: 200,  category: 'Rent' },                // Apr expense
    { date: '2026-02-01', type: 'income',  amount: 5000, category: 'Salary' },              // outside window
  ];
  const months = A.monthlyRealTotals(txns, 3, refDate);
  assert.deepEqual(months.map(x => ({ income: x.income, expense: x.expense })), [
    { income: 2000, expense: 500 }, // May (most recent first)
    { income: 0,    expense: 200 }, // Apr
    { income: 0,    expense: 0 },   // Mar
  ]);
  assert.equal(A.pooledSavingsRate(months), (2000 - 700) / 2000); // 0.65
});
