import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

vm.runInThisContext(readFileSync(new URL('../js/wealth.js', import.meta.url), 'utf8'));
const W = globalThis;

// Made-up example values only; no personal plan in tests.
function examplePlan() {
  const p = JSON.parse(JSON.stringify(W.wlPlan()));
  p.netPerCheck = 1500;
  p.payAnchor = '2025-04-04';
  p.savingsTargetMo = 400;
  const allocations = { giving: 100, housing: 700, transport: 180, subs: 40,
    protect: 30, explore: 50, ghana: 60, annual: 20, profdev: 20 };
  p.groups.forEach(g => { g.monthly = allocations[g.id]; });
  [500, 1000, 3000, 2000].forEach((n, i) => { p.milestones[i].amount = n; });
  return p;
}

// ── Road to a target ─────────────────────────────────────────────────

test('months to target: already there, plain saving, growth, never', () => {
  assert.equal(W.wlMonthsToTarget(1000, 100, 0, 500), 0);
  assert.equal(W.wlMonthsToTarget(0, 100, 0, 1000), 10);
  // $1,000/month at 7%: 1000·((1+.07/12)^n − 1)/(.07/12) = 1M at n ≈ 330.4 → month 331.
  assert.equal(W.wlMonthsToTarget(0, 1000, 7, 1000000), 331);
  // Growth on the starting balance alone.
  assert.equal(W.wlMonthsToTarget(1000, 0, 0, 2000), null);
  assert.equal(W.wlMonthsToTarget(0, 0, 7, 1000), null);
});

// ── Payday split ─────────────────────────────────────────────────────

test('payday split: half of each monthly group, savings down the ladder, rest is living', () => {
  W.wlApplyPlan(examplePlan());
  const s = W.wlPaydaySplit(W.wlPlan(), 1500, 600);
  const housing = s.groups.find(g => g.id === 'housing');
  assert.equal(housing.amount, 350);
  assert.equal(s.savings.amount, 200);
  // 600 fills milestone 1 (500); milestone 2 (1,000) is the active one.
  assert.equal(s.savings.to, W.wlPlan().milestones[1].label);
  const groupsTotal = s.groups.reduce((t, g) => t + g.amount, 0);
  assert.equal(s.living, 1500 - groupsTotal - 200);
  assert.equal(s.living, 700); // 1500 − 600 (groups/2) − 200
});

test('payday split: every milestone full sends savings to long-term; never negative living', () => {
  W.wlApplyPlan(examplePlan());
  assert.equal(W.wlPaydaySplit(W.wlPlan(), 1500, 999999).savings.to, 'Long-term');
  const tight = W.wlPaydaySplit(W.wlPlan(), 400, 0);
  assert.equal(tight.living, 0);
  assert.equal(tight.short, true);
});

// ── Loop store ───────────────────────────────────────────────────────

test('loop store: bad input becomes empty; records keep only valid fields', () => {
  assert.deepEqual(W.wlLoopNormalize(null), { paydays: [], decisions: [] });
  assert.deepEqual(W.wlLoopNormalize({ paydays: 'x' }), { paydays: [], decisions: [] });
  const s = W.wlLoopNormalize({
    paydays: [{ id: 'p1', date: '2026-10-30', net: '1500', savings: 200, to: 'Emergency fund', paceDate: '2056-01', junk: 1 },
              { id: 'bad', date: 'not-a-date', net: 1 }],
    decisions: [{ id: 'd1', date: '2026-10-25', what: 'Move cash', why: 'rate', expect: 'more interest',
                  reviewMonths: 3, decideBy: '2026-12-18', outcome: '', rating: '' },
                { id: 'd2', what: '' }],
  });
  assert.equal(s.paydays.length, 1);
  assert.equal(s.paydays[0].net, 1500);
  assert.equal(s.paydays[0].junk, undefined);
  assert.equal(s.decisions.length, 1);
  assert.equal(s.decisions[0].reviewOn, '2027-01-25');
});

test('loop agenda: decide-by soon or overdue, and reviews that are due', () => {
  const store = W.wlLoopNormalize({ paydays: [], decisions: [
    { id: 'a', date: '2026-07-01', what: 'Old choice', reviewMonths: 3 },                 // review due 2026-10-01
    { id: 'b', date: '2026-10-25', what: 'Certificate', reviewMonths: 6, decideBy: '2026-11-10' },
    { id: 'c', date: '2026-10-25', what: 'Far away', reviewMonths: 12, decideBy: '2027-06-01' },
    { id: 'd', date: '2026-01-01', what: 'Reviewed', reviewMonths: 3, outcome: 'fine', rating: 'as expected' },
  ] });
  const ag = W.wlLoopAgenda(store, '2026-10-25');
  assert.deepEqual(ag.decideSoon.map(d => d.id), ['b']);
  assert.deepEqual(ag.reviewsDue.map(d => d.id), ['a']);
});

test('payday around today: last payday on or before today and the next one (biweekly)', () => {
  assert.deepEqual(W.wlPaydayAround('2026-07-24', '2026-10-25'), { last: '2026-10-16', next: '2026-10-30' });
  assert.deepEqual(W.wlPaydayAround('2026-07-24', '2026-10-30'), { last: '2026-10-30', next: '2026-11-13' });
  // Anchor in the future still steps back correctly.
  assert.deepEqual(W.wlPaydayAround('2027-01-08', '2026-10-25'), { last: '2026-10-16', next: '2026-10-30' });
});
