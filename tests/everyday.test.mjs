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

const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
vm.runInThisContext(src);
const A = globalThis;

const tx = (date, description, category, account, type = 'expense', amount = 10, extra = {}) =>
  ({ id: `${date}-${description}-${Math.random()}`, date, type, amount, account, toAccount: '', category, description, recurring: '', ...extra });

// ── 1. Add in 5 seconds: suggestions from history ────────────────────

test('typing a store you have used fills in its usual category and card', () => {
  const txns = [
    tx('2026-09-05', 'Publix', 'Groceries', 'discover'),
    tx('2026-09-12', 'publix ', 'Groceries', 'discover'),
    tx('2026-09-19', 'PUBLIX', 'Household Essentials', 'chase_checking'),
    tx('2026-09-20', 'Shell', 'Gas', 'discover'),
  ];
  assert.deepEqual(A.txnSuggestion('  Publix', txns, 'expense'), { category: 'Groceries', account: 'discover', toAccount: '', count: 3 });
});

test('suggestions ignore other transaction types, blanks and unknown stores', () => {
  const txns = [tx('2026-09-05', 'Payroll', 'Paycheck', 'chase_checking', 'income')];
  assert.equal(A.txnSuggestion('Payroll', txns, 'expense'), null);
  assert.equal(A.txnSuggestion('', txns, 'income'), null);
  assert.equal(A.txnSuggestion('Target', txns, 'income'), null);
  assert.equal(A.txnSuggestion('payroll', txns, 'income').category, 'Paycheck');
});

test('when two habits are equally common, the most recent one wins', () => {
  const txns = [
    tx('2026-08-01', 'Amazon', 'Electronics', 'discover'),
    tx('2026-09-01', 'Amazon', 'Household Essentials', 'chase_checking'),
  ];
  const s = A.txnSuggestion('amazon', txns, 'expense');
  assert.equal(s.category, 'Household Essentials');
  assert.equal(s.account, 'chase_checking');
});

test('a transfer suggestion carries its destination account', () => {
  const txns = [tx('2026-09-22', 'Discover payment', 'Credit Card Payment', 'chase_checking', 'transfer', 600, { toAccount: 'discover' })];
  assert.equal(A.txnSuggestion('Discover payment', txns, 'transfer').toAccount, 'discover');
});

test('one-tap categories are your most used for that type, topped up with sensible defaults', () => {
  const txns = [
    tx('2026-09-01', 'a', 'Coffee', 'discover'), tx('2026-09-02', 'b', 'Coffee', 'discover'), tx('2026-09-03', 'c', 'Coffee', 'discover'),
    tx('2026-09-04', 'd', 'Rent', 'chase_checking'), tx('2026-09-05', 'e', 'Rent', 'chase_checking'),
    tx('2026-01-05', 'old', 'Flights', 'discover'), // older than 90 days: not "recent"
    tx('2026-09-06', 'pay', 'Paycheck', 'chase_checking', 'income'),
  ];
  const cats = A.recentCategories(txns, 'expense', '2026-09-27', 5);
  assert.deepEqual(cats.slice(0, 2), ['Coffee', 'Rent']);
  assert.equal(cats.length, 5);
  assert.ok(!cats.includes('Flights'));
  assert.ok(!cats.includes('Paycheck'));
  assert.equal(new Set(cats).size, 5);
  assert.ok(A.recentCategories([], 'income', '2026-09-27', 3).every(c => ['Paycheck', 'Freelance', 'Refund', 'Other Income', 'Bonus'].includes(c)));
});

test('one-tap accounts are your most used for that type, only accounts that still exist', () => {
  const txns = [
    tx('2026-09-01', 'a', 'Coffee', 'discover'), tx('2026-09-02', 'b', 'Coffee', 'discover'),
    tx('2026-09-03', 'c', 'Rent', 'chase_checking'),
    tx('2026-09-04', 'd', 'Rent', 'closed_acct'), tx('2026-09-05', 'e', 'Rent', 'closed_acct'), tx('2026-09-06', 'f', 'Rent', 'closed_acct'),
  ];
  assert.deepEqual(A.recentAccounts(txns, 'expense', '2026-09-27', ['chase_checking', 'discover', 'usf_checking'], 2), ['discover', 'chase_checking']);
  assert.deepEqual(A.recentAccounts([], 'expense', '2026-09-27', ['chase_checking', 'discover'], 2), ['chase_checking', 'discover']);
});

// ── 2. Transactions by day ───────────────────────────────────────────

test('transactions are grouped by day, newest first, with what was spent and received', () => {
  const txns = [
    tx('2026-09-25', 'Payroll', 'Paycheck', 'chase_checking', 'income', 1850),
    tx('2026-09-26', 'Walmart', 'Groceries', 'discover', 'expense', 117.92),
    tx('2026-09-25', 'GEICO', 'Car Insurance', 'chase_checking', 'expense', 118),
    tx('2026-09-25', 'Tithe', 'Tithe', 'chase_checking', 'expense', 185),
    tx('2026-09-22', 'Discover payment', 'Credit Card Payment', 'chase_checking', 'transfer', 663.14, { toAccount: 'discover' }),
  ];
  const days = A.groupTxnsByDay(txns);
  assert.deepEqual(days.map(d => d.date), ['2026-09-26', '2026-09-25', '2026-09-22']);
  assert.equal(days[1].txns.length, 3);
  assert.equal(days[1].spent, 303);
  assert.equal(days[1].received, 1850);
  assert.equal(days[2].spent, 0);     // a card payment is a transfer, not spending
  assert.equal(days[2].received, 0);
});

test('every transaction gets an icon from its kind of category', () => {
  assert.equal(A.categoryIconKey('Paycheck', 'income'), 'income');
  assert.equal(A.categoryIconKey('Anything', 'transfer'), 'transfer');
  assert.equal(A.categoryIconKey('Groceries', 'expense'), 'cart');
  assert.equal(A.categoryIconKey('Fast Food', 'expense'), 'food');
  assert.equal(A.categoryIconKey('Gas', 'expense'), 'car');
  assert.equal(A.categoryIconKey('Rent', 'expense'), 'home');
  assert.equal(A.categoryIconKey('Tithe', 'expense'), 'heart');
  assert.equal(A.categoryIconKey('Something new', 'expense'), 'other');
});

// ── 3. Bills you can mark paid ───────────────────────────────────────

const RENT = { id: 'b-rent', name: 'Rent', amount: 1150, account: 'chase_checking', frequency: 'monthly', dayOfMonth: 1, anchorDate: null };
const day = iso => new Date(iso + 'T00:00:00');
const iso = d => A.toLocalISO(d);

test('a bill never marked paid keeps today\'s behaviour: its next date on or after today', () => {
  assert.equal(iso(A.billDueDate(RENT, day('2026-09-27'))), '2026-10-01');
});

test('once a bill is marked paid, its next due date is the one after the paid date, even if that is overdue', () => {
  assert.equal(iso(A.billDueDate({ ...RENT, paidThrough: '2026-10-01' }, day('2026-09-27'))), '2026-11-01');
  assert.equal(iso(A.billDueDate({ ...RENT, paidThrough: '2026-08-01' }, day('2026-09-27'))), '2026-09-01');
  const once = { id: 'b1', name: 'Registration', amount: 80, frequency: 'once', anchorDate: '2026-10-10' };
  assert.equal(iso(A.billDueDate(once, day('2026-09-27'))), '2026-10-10');
  assert.equal(A.billDueDate({ ...once, paidThrough: '2026-10-10' }, day('2026-09-27')), null);
});

test('marking a bill paid copies how you logged it before, or guesses from its name', () => {
  const history = [tx('2026-08-25', 'geico', 'Insurance', 'usf_checking')];
  // The account set on the bill itself wins; history fills in what the bill does not say.
  assert.deepEqual(A.billTemplate({ name: 'GEICO', account: 'chase_checking' }, history),
    { type: 'expense', category: 'Insurance', account: 'chase_checking', toAccount: '' });
  assert.equal(A.billTemplate({ name: 'GEICO', account: null }, history).account, 'usf_checking');
  assert.deepEqual(A.billTemplate({ name: 'GEICO', account: 'chase_checking' }, []),
    { type: 'expense', category: 'Car Insurance', account: 'chase_checking', toAccount: '' });
  assert.equal(A.billTemplate({ name: 'Rent', account: null }, []).category, 'Rent');
  assert.equal(A.billTemplate({ name: 'Spotify', account: 'discover' }, []).category, 'Streaming');
  assert.equal(A.billTemplate({ name: 'Mystery club', account: 'discover' }, []), null);
});

test('every category a bill name can map to is a real choice in the Add form', () => {
  const options = new Set([...html.matchAll(/<option value="([^"]+)"/g)].map(m => m[1]));
  for (const cat of A.billKeywordCategories()) assert.ok(options.has(cat), `${cat} is not a category option`);
});

test('paying a bill logs today\'s transaction and moves the bill past that due date', () => {
  const template = { type: 'expense', category: 'Rent', account: 'chase_checking', toAccount: '' };
  const { txn, bill } = A.payBill(RENT, day('2026-10-01'), '2026-09-27', template, 'txn-1');
  assert.deepEqual(txn, { id: 'txn-1', date: '2026-09-27', type: 'expense', amount: 1150, account: 'chase_checking', toAccount: '', category: 'Rent', description: 'Rent', recurring: '' });
  assert.equal(bill.paidThrough, '2026-10-01');
  assert.equal(bill.lastPaidOn, '2026-09-27');
  assert.equal(bill.lastPaidTxn, 'txn-1');
  assert.equal(RENT.paidThrough, undefined, 'the stored bill object is not mutated');
  const card = A.payBill({ ...RENT, name: 'Discover payment', account: null }, day('2026-10-01'), '2026-09-27',
    { type: 'transfer', category: 'Credit Card Payment', account: 'chase_checking', toAccount: 'discover' }, 'txn-2');
  assert.equal(card.txn.type, 'transfer');
  assert.equal(card.txn.account, 'chase_checking');
  assert.equal(card.txn.toAccount, 'discover');
});

test('"still due" adds every unpaid bill date in the next 30 days, overdue ones included', () => {
  const bills = [
    { ...RENT, paidThrough: '2026-10-01' },                                        // next is Nov 1: outside 30 days
    { id: 'b2', name: 'Spotify', amount: 11.99, frequency: 'monthly', dayOfMonth: 5 },
    { id: 'b3', name: 'Phone', amount: 45, frequency: 'monthly', dayOfMonth: 15, paidThrough: '2026-08-15' }, // Sep 15 overdue + Oct 15
    { id: 'b4', name: 'No amount', amount: null, frequency: 'monthly', dayOfMonth: 10 },
    { id: 'b5', name: 'Laundry', amount: 5, frequency: 'weekly', anchorDate: '2026-09-28' },                 // Sep 28, Oct 5, 12, 19, 26
  ];
  assert.equal(A.billsDueTotal(bills, day('2026-09-27'), 30), 126.99); // 11.99 + 45 + 45 + 5×5
});

// ── 5. Backups you can trust ─────────────────────────────────────────

const H = 3600 * 1000, D = 24 * H;
const NOW = Date.parse('2026-09-27T12:00:00Z');

test('no banner when there is nothing to lose yet', () => {
  assert.equal(A.backupState({ hasData: false, lastBackup: null, lastChange: null, now: NOW }).show, false);
});

test('data with no backup on this device shows the banner', () => {
  const s = A.backupState({ hasData: true, lastBackup: null, lastChange: null, now: NOW });
  assert.equal(s.show, true);
  assert.equal(s.title, 'No backup on this device yet');
});

test('an old backup is fine when nothing changed since', () => {
  const s = A.backupState({ hasData: true, lastBackup: { at: NOW - 40 * D, via: 'drive' }, lastChange: NOW - 41 * D, now: NOW });
  assert.equal(s.show, false);
});

test('changes newer than a backup over 7 days old show how old it is', () => {
  const s = A.backupState({ hasData: true, lastBackup: { at: NOW - 12 * D, via: 'file' }, lastChange: NOW - 1 * H, now: NOW });
  assert.equal(s.show, true);
  assert.equal(s.title, 'Last backup: 12 days ago');
  assert.equal(A.backupState({ hasData: true, lastBackup: { at: NOW - 2 * D, via: 'drive' }, lastChange: NOW - H, now: NOW }).show, false);
});

test('the Backup card says when and where the last backup went', () => {
  assert.equal(A.backupStatusLine({ at: NOW - 5 * 60 * 1000, via: 'drive' }, NOW), 'Last backup: 5 minutes ago, to Google Drive');
  assert.equal(A.backupStatusLine({ at: NOW - 3 * D, via: 'file' }, NOW), 'Last backup: 3 days ago, as a downloaded file');
  assert.equal(A.backupStatusLine(null, NOW), 'No backup on this device yet');
});
