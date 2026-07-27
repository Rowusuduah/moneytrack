import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// app.js registers a few top-level listeners; give it just enough globals to load.
globalThis.document ??= { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
globalThis.window ??= { addEventListener() {} };
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
// app.js starts real timers (top-level setInterval at app.js:4007, Drive-sync debounce).
// unref them so the Node test process can exit instead of hanging until killed.
const _setTimeout = globalThis.setTimeout, _setInterval = globalThis.setInterval;
globalThis.setTimeout  = (fn, ms, ...a) => { const t = _setTimeout(fn, ms, ...a);  t.unref?.(); return t; };
globalThis.setInterval = (fn, ms, ...a) => { const t = _setInterval(fn, ms, ...a); t.unref?.(); return t; };

const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
vm.runInThisContext(src);
const A = globalThis; // top-level function declarations land on the host global

// ── getNextDueDate: monthly bills with dayOfMonth 29–31 must clamp, not roll over ──

test('monthly bill day 31 in February clamps to Feb 28, not Mar 3', () => {
  const d = A.getNextDueDate({ frequency: 'monthly', dayOfMonth: 31 }, new Date(2026, 1, 10));
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 1);   // February
  assert.equal(d.getDate(), 28);
});

test('monthly bill day 30 advancing from Jan 31 clamps to Feb 28', () => {
  const d = A.getNextDueDate({ frequency: 'monthly', dayOfMonth: 30 }, new Date(2026, 0, 31));
  assert.equal(d.getMonth(), 1);   // February
  assert.equal(d.getDate(), 28);
});

test('monthly bill due today is reported as today', () => {
  const d = A.getNextDueDate({ frequency: 'monthly', dayOfMonth: 15 }, new Date(2026, 6, 15));
  assert.equal(d.getMonth(), 6);
  assert.equal(d.getDate(), 15);
});

// ── getNextDueDate: weekly/biweekly bills due today must not skip a full interval ──

test('weekly bill exactly on an interval boundary is due today, not in 7 days', () => {
  // anchor Sat 2026-07-04; 2026-07-25 is exactly 3 weeks later
  const d = A.getNextDueDate({ frequency: 'weekly', anchorDate: '2026-07-04' }, new Date(2026, 6, 25));
  assert.equal(d.getMonth(), 6);
  assert.equal(d.getDate(), 25);
});

test('biweekly bill exactly on an interval boundary is due today, not in 14 days', () => {
  const d = A.getNextDueDate({ frequency: 'biweekly', anchorDate: '2026-07-24' }, new Date(2026, 7, 7));
  assert.equal(d.getMonth(), 7);   // August
  assert.equal(d.getDate(), 7);
});

test('weekly bill mid-interval still returns the next occurrence', () => {
  const d = A.getNextDueDate({ frequency: 'weekly', anchorDate: '2026-07-04' }, new Date(2026, 6, 23));
  assert.equal(d.getDate(), 25);
});

test('weekly bill with a future anchor returns the anchor itself', () => {
  const d = A.getNextDueDate({ frequency: 'weekly', anchorDate: '2026-08-01' }, new Date(2026, 6, 25));
  assert.equal(d.getMonth(), 7);
  assert.equal(d.getDate(), 1);
});

// ── csvField: neutralize spreadsheet formula injection, leave numbers alone ──

test('csvField neutralizes leading formula characters', () => {
  assert.equal(A.csvField('=HYPERLINK("http://evil","x")'), '"\'=HYPERLINK(""http://evil"",""x"")"');
  assert.equal(A.csvField('@SUM(A1:A9)'), '"\'@SUM(A1:A9)"');
});

test('csvField leaves plain text and negative numbers untouched', () => {
  assert.equal(A.csvField('July rent'), '"July rent"');
  assert.equal(A.csvField(-50), '"-50"');
  assert.equal(A.csvField(1234.5), '"1234.5"');
});

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
