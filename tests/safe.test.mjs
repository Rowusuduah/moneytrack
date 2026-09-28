import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Same loading approach as app.test.mjs: app.js needs just enough globals to load.
globalThis.document ??= { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
globalThis.window ??= { addEventListener() {} };
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
const _setTimeout = globalThis.setTimeout, _setInterval = globalThis.setInterval;
globalThis.setTimeout  = (fn, ms, ...a) => { const t = _setTimeout(fn, ms, ...a);  t.unref?.(); return t; };
globalThis.setInterval = (fn, ms, ...a) => { const t = _setInterval(fn, ms, ...a); t.unref?.(); return t; };

vm.runInThisContext(readFileSync(new URL('../js/app.js', import.meta.url), 'utf8'));
const A = globalThis;

const ACCTS = [
  { id: 'chase_checking', label: 'Chase Checking', group: 'checking' },
  { id: 'usf_checking', label: 'USF Checking', group: 'checking' },
  { id: 'usf_savings_1', label: 'USF Savings 1', group: 'savings' },
  { id: 'discover', label: 'Discover (Owed)', group: 'debt' },
  { id: 'roth_ira', label: 'Roth IRA', group: 'investment' },
];
let n = 0;
const tx = (date, type, amount, account, category, description, toAccount = '') =>
  ({ id: `t${++n}`, date, type, amount, account, toAccount, category, description, recurring: '' });
const day = iso => new Date(iso + 'T00:00:00');

// ── Checking now ─────────────────────────────────────────────────────

test('checking now is the last snapshot plus what was logged in checking since', () => {
  const snaps = [
    { date: '2026-09-07', accounts: { chase_checking: 1, usf_checking: 1 } },
    { date: '2026-09-21', accounts: { chase_checking: 2000, usf_checking: 300, usf_savings_1: 5000, discover: 640 } },
  ];
  const txns = [
    tx('2026-09-21', 'expense', 999, 'chase_checking', 'Groceries', 'on the snapshot day: already inside it'),
    tx('2026-09-25', 'income', 1850, 'chase_checking', 'Paycheck', 'Payroll'),
    tx('2026-09-25', 'expense', 185, 'chase_checking', 'Tithe', 'Tithe'),
    tx('2026-09-25', 'expense', 118, 'chase_checking', 'Car Insurance', 'GEICO'),
    tx('2026-09-22', 'transfer', 663.14, 'chase_checking', 'Credit Card Payment', 'Discover payment', 'discover'),
    tx('2026-09-23', 'transfer', 100, 'usf_savings_1', 'Savings Transfer', 'From savings', 'chase_checking'),
    tx('2026-09-26', 'income', 500, 'chase_checking', 'Money from Last Month', 'carryover is not new money'),
    tx('2026-09-26', 'expense', 117.92, 'discover', 'Groceries', 'card purchase: not checking'),
    tx('2026-09-27', 'expense', 350, 'usf_savings_1', 'Car Repair', 'paid from savings'),
    tx('2026-09-29', 'expense', 50, 'chase_checking', 'Coffee', 'future-dated'),
  ];
  assert.deepEqual(A.checkingNow(snaps, txns, ACCTS, '2026-09-28'), { amount: 3283.86, since: '2026-09-21' });
});

test('without a balance snapshot there is no checking figure', () => {
  assert.equal(A.checkingNow([], [], ACCTS, '2026-09-28'), null);
  assert.equal(A.checkingNow([{ date: '2026-10-01', accounts: { chase_checking: 5 } }], [], ACCTS, '2026-09-28'), null);
});

// ── Next payday ──────────────────────────────────────────────────────

test('payday comes from the Wealth plan: the next biweekly date after today', () => {
  const plan = { payAnchor: '2026-09-11' };
  assert.deepEqual(A.nextPayday(plan, [], '2026-09-28'), { date: '2026-10-09', periodDays: 14, source: 'plan' });
  assert.equal(A.nextPayday(plan, [], '2026-10-09').date, '2026-10-23');   // on payday, count to the next one
  assert.equal(A.nextPayday({ payAnchor: '2026-10-02' }, [], '2026-09-28').date, '2026-10-02');
});

test('without a plan, payday is read from past paychecks', () => {
  const biweekly = ['2026-08-14', '2026-08-28', '2026-09-11', '2026-09-25'].map(d => tx(d, 'income', 1850, 'chase_checking', 'Paycheck', 'Payroll'));
  assert.deepEqual(A.nextPayday({ payAnchor: '' }, biweekly, '2026-09-28'), { date: '2026-10-09', periodDays: 14, source: 'history' });
  const monthly = ['2026-07-01', '2026-08-01', '2026-09-01'].map(d => tx(d, 'income', 4000, 'chase_checking', 'Paycheck', 'Salary'));
  const m = A.nextPayday(null, monthly, '2026-09-28');
  assert.equal(m.date, '2026-10-01');
  assert.equal(m.source, 'history');
  assert.equal(A.nextPayday(null, biweekly.slice(0, 1), '2026-09-28'), null);
  assert.equal(A.nextPayday(null, [], '2026-09-28'), null);
});

// ── Bills and cards before payday ────────────────────────────────────

test('bills before payday include overdue ones and skip bills that are card payments', () => {
  const bills = [
    { id: 'b1', name: 'Rent', amount: 1150, frequency: 'monthly', dayOfMonth: 1 },
    { id: 'b2', name: 'Spotify', amount: 11.99, account: 'discover', frequency: 'monthly', dayOfMonth: 5 },
    { id: 'b3', name: 'Mint Mobile', amount: 45, frequency: 'monthly', dayOfMonth: 15, paidThrough: '2026-08-15' },
    { id: 'b4', name: 'Discover payment', amount: 600, frequency: 'monthly', dayOfMonth: 2 },
    { id: 'b5', name: 'Payday bill', amount: 20, frequency: 'monthly', dayOfMonth: 9 },   // due ON payday: paid from the new check
  ];
  const r = A.billsDueBefore(bills, day('2026-09-28'), '2026-10-09', new Set(['b4']));
  assert.equal(r.total, 1206.99);   // Rent + Spotify + Mint's overdue Sep 15
  assert.deepEqual(r.names, ['Mint Mobile', 'Rent', 'Spotify']);
});

test('a bill logged before as a transfer to a card is a card payment', () => {
  const bills = [
    { id: 'b-card', name: 'Discover payment', amount: 600, frequency: 'monthly', dayOfMonth: 22 },
    { id: 'b-spot', name: 'Spotify', amount: 11.99, account: 'discover', frequency: 'monthly', dayOfMonth: 5 },
  ];
  const txns = [tx('2026-09-22', 'transfer', 663.14, 'chase_checking', 'Credit Card Payment', 'Discover payment', 'discover')];
  assert.deepEqual([...A.cardPaymentBillIds(bills, txns, ACCTS)], ['b-card']);
});

test('card balances owed now come from the last snapshot plus charges minus payments since', () => {
  const snaps = [{ date: '2026-09-21', accounts: { discover: 640 } }];
  const txns = [
    tx('2026-09-22', 'transfer', 663.14, 'chase_checking', 'Credit Card Payment', 'Discover payment', 'discover'),
    tx('2026-09-23', 'expense', 50, 'discover', 'Coffee', 'Starbucks'),
    tx('2026-09-26', 'expense', 117.92, 'discover', 'Groceries', 'Walmart'),
  ];
  assert.deepEqual(A.cardsOwedNow(snaps, txns, ACCTS, '2026-09-28'), { total: 144.78, labels: ['Discover (Owed)'] });
  const overpaid = [tx('2026-09-22', 'transfer', 900, 'chase_checking', 'Credit Card Payment', 'Discover payment', 'discover')];
  assert.deepEqual(A.cardsOwedNow(snaps, overpaid, ACCTS, '2026-09-28'), { total: 0, labels: [] });
});

// ── Savings plan for this pay period ─────────────────────────────────

test('the savings plan for this pay period is the monthly target spread over paydays, minus what already moved', () => {
  const payday = { date: '2026-10-09', periodDays: 14 };
  const plan = { savingsTargetMo: 800 };
  // 800 a month = 9,600 a year; 14 of 365.25 days = 367.97 this period.
  assert.equal(A.savingsPlanDue(plan, payday, [], ACCTS, '2026-09-28'), 367.97);
  const moved = [
    tx('2026-09-25', 'transfer', 100, 'chase_checking', 'Savings Transfer', 'On payday: counts', 'usf_savings_1'),
    tx('2026-09-20', 'transfer', 999, 'chase_checking', 'Savings Transfer', 'Last period', 'usf_savings_1'),
    tx('2026-09-26', 'transfer', 300, 'chase_checking', 'Investment', 'Roth: not the savings plan', 'roth_ira'),
  ];
  assert.equal(A.savingsPlanDue(plan, payday, moved, ACCTS, '2026-09-28'), 267.97);
  assert.equal(A.savingsPlanDue({ savingsTargetMo: 100 }, payday, moved, ACCTS, '2026-09-28'), 0);
  assert.equal(A.savingsPlanDue(null, payday, [], ACCTS, '2026-09-28'), 0);
});

// ── The number ───────────────────────────────────────────────────────

test('safe to spend is checking minus bills, cards and savings before payday, with a daily figure', () => {
  const s = A.safeToSpend({ checking: 2644.76, bills: 1161.99, cards: 759.90, savings: 400, todayIso: '2026-09-28', paydayIso: '2026-10-09' });
  assert.deepEqual(s, { amount: 322.87, days: 11, perDay: 29.35, short: false });
});

test('when commitments are bigger than checking, you are short and there is no daily figure', () => {
  const s = A.safeToSpend({ checking: 1801.49, bills: 1161.99, cards: 357.90, savings: 400, todayIso: '2026-09-28', paydayIso: '2026-10-09' });
  assert.deepEqual(s, { amount: -118.40, days: 11, perDay: 0, short: true });
  assert.equal(A.safeToSpend({ checking: 100, bills: 0, cards: 0, savings: 0, todayIso: '2026-09-28', paydayIso: '2026-09-29' }).days, 1);
});
