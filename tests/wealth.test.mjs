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

test('savings transfers use account direction and internal moves net to zero', () => {
  const accounts = [
    { id: 'checking', group: 'checking' },
    { id: 'savings1', group: 'savings' },
    { id: 'savings2', group: 'savings' },
    { id: 'brokerage', group: 'investment' },
  ];
  const txns = [
    { date: '2025-04-02', type: 'transfer', amount: 500, category: 'Savings Transfer', account: 'checking', toAccount: 'savings1' },
    { date: '2025-04-03', type: 'transfer', amount: 300, category: 'Savings Transfer', account: 'savings1', toAccount: 'savings2' },
    { date: '2025-04-04', type: 'transfer', amount: 200, category: 'Investment', account: 'savings2', toAccount: 'brokerage' },
    { date: '2025-04-05', type: 'transfer', amount: 125, category: 'Savings Transfer', account: 'savings1', toAccount: 'checking' },
  ];
  const a = W.wlAggregateRange(txns, '2025-04-01', '2025-04-30', accounts);
  assert.equal(a.savingsThisMonth, 375); // +500 inbound, two internal moves, -125 outbound
  assert.equal(W.wlSavingsByMonth(txns, '2025-04-20', 1, accounts)[0].total, 375);

  const withoutInternal = W.wlAggregateRange([txns[0]], '2025-04-01', '2025-04-30', accounts);
  const withInternal = W.wlAggregateRange(txns.slice(0, 3), '2025-04-01', '2025-04-30', accounts);
  assert.equal(withInternal.savingsThisMonth, withoutInternal.savingsThisMonth);
});

test('current Wealth totals and savings trend ignore future-dated transactions', () => {
  const accounts = [
    { id: 'checking', group: 'checking' },
    { id: 'savings', group: 'savings' },
  ];
  const txns = [
    { date: '2025-04-10', type: 'expense', amount: 100, category: 'Groceries', account: 'checking' },
    { date: '2025-04-30', type: 'expense', amount: 900, category: 'Groceries', account: 'checking' },
    { date: '2025-04-11', type: 'transfer', amount: 200, category: 'Savings Transfer', account: 'checking', toAccount: 'savings' },
    { date: '2025-04-29', type: 'transfer', amount: 800, category: 'Savings Transfer', account: 'checking', toAccount: 'savings' },
  ];
  const a = W.wlAggregate(txns, '2025-04-15', accounts);
  assert.equal(a.groups.living, 100);
  assert.equal(a.savingsThisMonth, 200);
  assert.equal(W.wlSavingsByMonth(txns, '2025-04-15', 1, accounts)[0].total, 200);
});

test('savings trend renders a withdrawal as a visible negative bar', () => {
  const markup = W.wlSavingsTrendMarkup([
    { label: 'Mar', total: 400 },
    { label: 'Apr', total: -500 },
  ], 400);
  assert.match(markup, /class="wl-ch-col negative"/);
  assert.match(markup, />-\$500<\/text>/);
  assert.match(markup, /class="wl-ch-zero"/);
});

test('loan payments and bank fees are surfaced as unmapped spending', () => {
  const txns = [
    { date: '2025-04-02', type: 'expense', amount: 100, category: 'Loan Payment' },
    { date: '2025-04-03', type: 'expense', amount: 25, category: 'Bank Fee' },
  ];
  const a = W.wlAggregateRange(txns, '2025-04-01', '2025-04-30');
  assert.deepEqual(a.unmapped, [
    { category: 'Loan Payment', total: 100 },
    { category: 'Bank Fee', total: 25 },
  ]);
  const pace = W.wlPaceSeries(txns, { startIso: '2025-04-01', endIso: '2025-04-03' });
  assert.equal(pace.cumulative.at(-1), 125);
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
  assert.equal(p.fundM, 16); // reserve interest helps reach $6,500 during month 16
  assert.equal(p.funded, true);
  assert.equal(p.contrib, 120000);
  assert.ok(p.total > p.contrib);
  const zero = W.wlProject(0, 5, 20);
  assert.equal(zero.funded, false);
  assert.equal(zero.fundM, null);
  assert.equal(zero.reserveMonths, 240);
});

test('projection identifies a reserve target unreachable within the horizon', () => {
  const p = examplePlan();
  p.savingsTargetMo = 100;
  p.years = 10;
  p.kMo = 0;
  p.milestones.forEach((m, i) => { m.amount = i === 0 ? 100000 : 0; });
  W.wlApplyPlan(p);
  const projected = W.wlProject(100, 5, 10);
  assert.equal(projected.reserve, 100000);
  assert.equal(projected.funded, false);
  assert.equal(projected.fundM, null);
  assert.equal(projected.reserveMonths, 120);
  assert.ok(projected.total < projected.reserve);
});

test('every expense option is mapped, movement-only, or intentionally surfaced', () => {
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
  const movementOnly = ['Savings Transfer', 'Investment', 'Bill Reserve',
    'Credit Card Payment', 'Loan Given'];
  const surfacedUnmapped = ['Loan Payment', 'Bank Fee'];
  const known = c => c in W.wlCatToGroup() || movementOnly.includes(c) || surfacedUnmapped.includes(c);
  assert.deepEqual(categories.filter(c => !known(c)), []);
});
