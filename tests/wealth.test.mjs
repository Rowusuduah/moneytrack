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

test('every expense category in the txn form is mapped, excluded, or savings', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const sel = html.match(/<select id="txn-category"[\s\S]*?<\/select>/);
  assert.ok(sel, 'txn-category select not found');
  const income = new Set(['Paycheck', 'Freelance', 'Transfer In', 'Other Income']);
  const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const cats = [...sel[0].matchAll(/<option[^>]*>([^<]+)<\/option>/g)]
    .map(m => decode(m[1].trim())).filter(c => !income.has(c));
  const map = W.wlCatToGroup();
  const known = c => c in map ||
    ['Savings Transfer', 'Investment'].includes(c) ||
    ['Bill Reserve', 'Loan Payment', 'Credit Card Payment', 'Bank Fee'].includes(c);
  const unknown = cats.filter(c => !known(c));
  assert.deepEqual(unknown, [], 'unmapped dropdown categories: ' + unknown.join(', '));
});

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
  assert.equal(W.wlSpendBudget('day'), 84.04);
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
