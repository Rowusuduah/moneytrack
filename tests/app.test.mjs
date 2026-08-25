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

test('NON_EXPENSE_CATS excludes Credit Card Payment + Bill Reserve, but NOT Loan Payment', () => {
  assert.match(src, /NON_EXPENSE_CATS = new Set\(\[[^\]]*'Credit Card Payment'/);
  assert.match(src, /NON_EXPENSE_CATS = new Set\(\[[^\]]*'Bill Reserve'/);
  // Loan Payment now counts as a real expense (money out) — user preference.
  const line = (src.match(/NON_EXPENSE_CATS = new Set\(\[[^\]]*\]/) || [''])[0];
  assert.ok(!/'Loan Payment'/.test(line), 'Loan Payment must NOT be in NON_EXPENSE_CATS');
});

// ── income/expense gateways: carryover is not income; savings spends are not monthly spending ──

test('isRealIncome excludes the Money from Last Month carryover and loan repayments', () => {
  assert.equal(A.isRealIncome({ type: 'income', category: 'Paycheck', amount: 500 }), true);
  assert.equal(A.isRealIncome({ type: 'income', category: 'Money from Last Month', amount: 200 }), false);
  assert.equal(A.isRealIncome({ type: 'income', category: 'Loan Repaid to Me', amount: 500 }), false);
  assert.equal(A.isRealIncome({ type: 'expense', category: 'Paycheck' }), false);
});

test('isSavingsSpend: true only for an expense whose account group is savings', () => {
  A.refreshAccountConfig();   // ACCOUNTS is built during init in the browser
  assert.equal(A.isSavingsSpend({ type: 'expense', account: 'usf_savings_1', category: 'Groceries' }), true);
  assert.equal(A.isSavingsSpend({ type: 'expense', account: 'chase_checking', category: 'Groceries' }), false);
  assert.equal(A.isSavingsSpend({ type: 'transfer', account: 'usf_savings_1' }), false);
  assert.equal(A.isSavingsSpend({ type: 'expense', account: 'no_such_account' }), false);
});

test('isRealExpense excludes card payments, reserves, loans given, and savings-funded spends', () => {
  A.refreshAccountConfig();
  assert.equal(A.isRealExpense({ type: 'expense', account: 'chase_checking', category: 'Groceries' }), true);
  assert.equal(A.isRealExpense({ type: 'expense', account: 'chase_checking', category: 'Credit Card Payment' }), false);
  assert.equal(A.isRealExpense({ type: 'expense', account: 'chase_checking', category: 'Loan Given' }), false);
  assert.equal(A.isRealExpense({ type: 'expense', account: 'usf_savings_2', category: 'Groceries' }), false);
  assert.equal(A.isRealExpense({ type: 'income', account: 'chase_checking', category: 'Paycheck' }), false);
});

test('anPeriodTotals separates savings withdrawals from income and spending', () => {
  A.refreshAccountConfig();
  const t = A.anPeriodTotals([
    { type: 'income',  category: 'Paycheck',              account: 'chase_checking', amount: 1000 },
    { type: 'income',  category: 'Money from Last Month', account: 'chase_checking', amount: 50 },
    { type: 'expense', category: 'Groceries',             account: 'chase_checking', amount: 100 },
    { type: 'expense', category: 'Groceries',             account: 'usf_savings_1',  amount: 250 },
    { type: 'transfer', category: 'Savings Transfer',     account: 'chase_checking', toAccount: 'usf_savings_1', amount: 400 },
  ]);
  assert.equal(t.income, 1000);        // carryover not income
  assert.equal(t.expense, 100);        // savings withdrawal not spending
  assert.equal(t.savingsSpend, 250);
  assert.equal(t.net, 900);
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

// ── loans: partial payments reduce the remainder automatically ──

test('loanRemaining: partial payments reduce the remainder; atDate honors payment dates', () => {
  const loan = { amount: 500, status: 'outstanding', payments: [
    { date: '2026-08-10', amount: 200 }, { date: '2026-08-20', amount: 100 }] };
  assert.equal(A.loanPaidTotal(loan), 300);
  assert.equal(A.loanRemaining(loan), 200);
  assert.equal(A.loanRemaining(loan, '2026-08-15'), 300);          // only the first payment counted
  assert.equal(A.loanRemaining({ amount: 500 }), 500);             // legacy loan without payments array
  assert.equal(A.loanRemaining({ amount: 100, payments: [{ date: '2026-08-01', amount: 150 }] }), 0); // clamps at 0
});

test('calcNetWorth counts outstanding loans at their remaining value', () => {
  A.refreshAccountConfig();
  const snap = { accounts: { chase_checking: 100 } };
  const loans = [{ date: '2026-08-01', status: 'outstanding', amount: 500,
    payments: [{ date: '2026-08-10', amount: 200 }] }];
  assert.equal(A.calcNetWorth(snap, loans), 400);                  // 100 assets + 300 still owed to me
});

// ── debtPayoff: interest must not be overstated by the final overpayment ──

test('debtPayoff caps the final payment (correct total interest, not the min-payment sum)', () => {
  const p = A.debtPayoff(1000, 24, 100);
  assert.equal(p.months, 12);
  assert.ok(p.totalInterest > 126 && p.totalInterest < 128, 'interest ~127, got ' + p.totalInterest);
  assert.ok(p.totalInterest < 200, 'must not overstate to the sum of full minimum payments');
  assert.equal(p.monthlyInterest, 20);
  assert.equal(A.debtPayoff(1000, 0, 100).months, null);   // no APR
  assert.equal(A.debtPayoff(1000, 24, 10).months, null);   // min payment below monthly interest (never pays off)
  assert.equal(A.debtPayoff(0, 24, 100).months, null);     // no balance
});

// ── lastKnownBalances: carry blank snapshot fields forward instead of zeroing ──

test('lastKnownBalances returns the latest value per account before the date', () => {
  const snaps = [
    { date: '2026-05-01', accounts: { chk: 100, sav: 500 } },
    { date: '2026-06-01', accounts: { chk: 150 } },            // only chk updated that day
    { date: '2026-07-01', accounts: { chk: 200, sav: 600 } },  // == query date -> excluded (strictly before)
  ];
  const lk = A.lastKnownBalances(snaps, '2026-07-01');
  assert.equal(lk.chk, 150);   // most recent chk before 07-01
  assert.equal(lk.sav, 500);   // sav last seen on 05-01
  assert.deepEqual(A.lastKnownBalances([], '2026-07-01'), {});
});
