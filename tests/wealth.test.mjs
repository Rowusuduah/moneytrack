import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../js/wealth.js', import.meta.url), 'utf8');
vm.runInThisContext(src);
const W = globalThis; // top-level function declarations land on the host global

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
