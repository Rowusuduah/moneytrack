import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

vm.runInThisContext(readFileSync(new URL('../js/wealth.js', import.meta.url), 'utf8'));
const W = globalThis;

function examplePlan() {
  const p = JSON.parse(JSON.stringify(W.wlPlan()));
  p.netPerCheck = 1500;
  p.payAnchor = '2025-04-04';
  p.savingsTargetMo = 400;
  p.kMo = 100;
  p.returnPct = 5;
  p.years = 20;
  const allocations = { giving: 100, housing: 700, transport: 180, subs: 40,
    protect: 30, explore: 50, ghana: 60, annual: 20, profdev: 20 };
  p.groups.forEach(g => { g.monthly = allocations[g.id]; });
  const bills = { tithe: 80, offering: 20, rent: 650, utilities: 50, carins: 90, remit: 60 };
  p.groups.forEach(g => g.bills.forEach(b => { b.monthly = bills[b.id]; }));
  [500, 1000, 3000, 2000].forEach((n, i) => { p.milestones[i].amount = n; });
  return p;
}

test('public defaults contain no personal plan; importing validates and restores calculations', () => {
  assert.equal(W.wlPlan().netPerCheck, 0);
  assert.equal(W.wlPlan().payAnchor, '');
  assert.equal(W.wlPlanConfigured(), false);
  W.wlApplyPlan(examplePlan());
  assert.equal(W.wlPlanConfigured(), true);
  assert.equal(W.wlFixedMo(), 1200);
  assert.equal(W.wlAvailMo(), 1800);
  assert.equal(W.wlDailyLivingMo(), 1400);
  assert.equal(W.wlSpendBudget('month'), 2600);
  assert.deepEqual(W.wlPlanBudgets(), {
    Tithe: 80, Offering: 20, Rent: 650, Utilities: 50,
    'Car Insurance': 90, 'Family Support (Ghana)': 60,
  });
});

test('private plan import rejects malformed values and keeps trusted colors/categories', () => {
  const bad = examplePlan(); bad.netPerCheck = -1;
  assert.throws(() => W.wlApplyPlan(bad));
  const badDate = examplePlan(); badDate.payAnchor = '2025-02-31';
  assert.throws(() => W.wlApplyPlan(badDate));
  const p = examplePlan();
  p.groups[0].color = 'red; background:url(https://example.com)';
  p.groups[0].bills[0].categories = ['Unknown'];
  W.wlApplyPlan(p);
  assert.notEqual(W.wlPlan().groups[0].color, p.groups[0].color);
  assert.deepEqual(W.wlPlan().groups[0].bills[0].categories, ['Tithe']);
});

test('every mapped expense category points at a known group', () => {
  const ids = new Set(W.wlPlan().groups.map(g => g.id).concat(['living']));
  for (const [cat, group] of Object.entries(W.wlCatToGroup())) {
    assert.ok(ids.has(group), `${cat} maps to an unknown group`);
  }
});

test('paydays handle ordinary and third-check months', () => {
  assert.deepEqual(W.wlPaydays('2025-04-04', '2025-04-20').dates,
    ['2025-04-04', '2025-04-18']);
  assert.deepEqual(W.wlPaydays('2025-04-04', '2025-05-03').dates,
    ['2025-05-02', '2025-05-16', '2025-05-30']);
});

test('aggregation classifies income, bills, savings and unmapped expenses', () => {
  const txns = [
    { date: '2025-04-05', type: 'expense', amount: 650, category: 'Rent' },
    { date: '2025-04-06', type: 'expense', amount: 30, category: 'Groceries' },
    { date: '2025-04-07', type: 'income', amount: 1500, category: 'Paycheck' },
    { date: '2025-04-08', type: 'transfer', amount: 200, category: 'Savings Transfer' },
    { date: '2025-04-09', type: 'expense', amount: 15, category: 'Unmapped' },
    { date: '2025-03-30', type: 'expense', amount: 99, category: 'Rent' },
  ];
  const a = W.wlAggregate(txns, '2025-04-20');
  assert.equal(a.groups.housing, 650);
  assert.equal(a.groups.living, 30);
  assert.equal(a.savingsThisMonth, 200);
  assert.equal(a.netLanded, 1500);
  assert.equal(a.paychecksLanded, 1);
  assert.equal(a.bills.rent.total, 650);
  assert.deepEqual(a.unmapped, [{ category: 'Unmapped', total: 15 }]);
});

test('windows and pace use the selected calendar range', () => {
  const week = W.wlWindowBounds('week', '2025-04-12');
  assert.equal(week.startIso, '2025-04-06');
  assert.equal(week.endIso, '2025-04-12');
  const s = W.wlPaceSeries([
    { date: '2025-04-06', type: 'expense', amount: 20, category: 'Groceries' },
    { date: '2025-04-07', type: 'transfer', amount: 100, category: 'Transfer' },
    { date: '2025-04-08', type: 'expense', amount: 30, category: 'Gas' },
  ], week);
  assert.deepEqual(s.days.map(x => x.total), [20, 0, 30, 0, 0, 0, 0]);
  assert.equal(s.cumulative.at(-1), 50);
});

test('milestones and projection use the imported amounts', () => {
  const stages = W.wlMilestones(900);
  assert.equal(stages[0].filled, 500);
  assert.equal(stages[1].filled, 400);
  assert.equal(stages[1].active, true);
  const p = W.wlProject(400, 5, 20);
  assert.equal(p.fundM, 17);
  assert.equal(p.contrib, 120000);
  assert.ok(p.total > p.contrib);
  assert.equal(W.wlProject(0, 5, 20).fundM, 240);
});

test('every expense option in the transaction form is mapped or excluded', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const select = html.match(/<select id="txn-category"[\s\S]*?<\/select>/);
  assert.ok(select);
  const income = new Set(['Paycheck', 'Freelance', 'Transfer In', 'Other Income',
    'Money from Last Month', 'Bonus', 'Refund', 'Reimbursement', 'Cash Back',
    'Interest Earned', 'Selling / Resale', 'Loan Repaid to Me']);
  const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const categories = [...select[0].matchAll(/<option[^>]*>([^<]+)<\/option>/g)]
    .map(m => decode(m[1].trim())).filter(c => !income.has(c));
  const known = c => c in W.wlCatToGroup() ||
    ['Savings Transfer', 'Investment', 'Bill Reserve', 'Loan Payment',
      'Credit Card Payment', 'Bank Fee', 'Loan Given'].includes(c);
  assert.deepEqual(categories.filter(c => !known(c)), []);
});
