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
