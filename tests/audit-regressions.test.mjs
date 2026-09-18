import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// app.js is a browser script. Give its top-level bootstrap the same minimal
// browser/storage surface used by the main app tests, while keeping this suite
// deterministic and free of persistent state.
globalThis.document ??= {
  addEventListener() {},
  getElementById: () => null,
  querySelectorAll: () => [],
  querySelector: () => null,
};
globalThis.window ??= { addEventListener() {} };
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };

const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;
globalThis.setTimeout = (fn, ms, ...args) => {
  const timer = realSetTimeout(fn, ms, ...args);
  timer.unref?.();
  return timer;
};
globalThis.setInterval = (fn, ms, ...args) => {
  const timer = realSetInterval(fn, ms, ...args);
  timer.unref?.();
  return timer;
};

const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
vm.runInThisContext(src);
const A = globalThis;

test('savingsBalanceDrops keeps exact account drops but nets a pure savings transfer to zero overall', () => {
  const accounts = [
    { id: 'savings_a', group: 'savings' },
    { id: 'savings_b', group: 'savings' },
  ];
  const prior = { accounts: { savings_a: 1000, savings_b: 0 } };
  const current = { accounts: { savings_a: 500, savings_b: 500 } };

  assert.deepEqual(A.savingsBalanceDrops(prior, current, accounts), {
    total: 500,
    byAccount: { savings_a: 500 },
    netTotal: 0,
    increasesByAccount: { savings_b: 500 },
  });
});

test('savingsBalanceDrops reports group net while preserving the requested per-account difference', () => {
  const accounts = [
    { id: 'savings_a', group: 'savings' },
    { id: 'savings_b', group: 'savings' },
  ];
  const prior = { accounts: { savings_a: 1000, savings_b: 100 } };
  const current = { accounts: { savings_a: 500, savings_b: 500 } };

  assert.deepEqual(A.savingsBalanceDrops(prior, current, accounts), {
    total: 500,
    byAccount: { savings_a: 500 },
    netTotal: 100,
    increasesByAccount: { savings_b: 400 },
  });
});

test('loansOutAtDate applies partial payments and paid/forgiven closure dates', () => {
  const loans = [
    {
      date: '2026-01-01',
      amount: 1000,
      status: 'paid',
      paidDate: '2026-03-01',
      payments: [
        { date: '2026-01-10', amount: 200 },
        { date: '2026-02-10', amount: 300 },
        { date: '2026-03-01', amount: 500 },
      ],
    },
    {
      date: '2026-01-05',
      amount: 500,
      status: 'forgiven',
      forgivenDate: '2026-02-15',
      payments: [{ date: '2026-01-20', amount: 100 }],
    },
    {
      date: '2026-04-01',
      amount: 900,
      status: 'outstanding',
      payments: [],
    },
  ];

  assert.equal(A.loansOutAtDate(loans, '2026-01-31'), 1200); // 800 + 400
  assert.equal(A.loansOutAtDate(loans, '2026-02-14'), 900);  // 500 + 400
  assert.equal(A.loansOutAtDate(loans, '2026-02-15'), 500);  // forgiven loan closes that day
  assert.equal(A.loansOutAtDate(loans, '2026-03-01'), 0);    // paid loan closes that day
  assert.equal(A.loansOutAtDate(loans, '2026-04-01'), 900);
});

test('cardOwedNow ignores self-transfers and transactions after its as-of date', () => {
  const account = { id: 'discover', group: 'debt' };
  const snap = { date: '2026-09-01', accounts: { discover: 1000 } };
  const txns = [
    { date: '2026-09-02', type: 'transfer', account: 'discover', toAccount: 'discover', amount: 100 },
    { date: '2026-09-03', type: 'expense', account: 'discover', category: 'Groceries', amount: 50 },
    { date: '2026-09-04', type: 'transfer', account: 'chase_checking', toAccount: 'discover', amount: 200 },
    { date: '2026-09-20', type: 'expense', account: 'discover', category: 'Travel', amount: 500 },
    { date: '2026-09-21', type: 'transfer', account: 'chase_checking', toAccount: 'discover', amount: 75 },
  ];

  assert.deepEqual(A.cardOwedNow(account, snap, txns, 1, '2026-09-10'), {
    owed: 850,
    base: 1000,
    charges: 50,
    payments: 200,
    credits: 0,
    since: '2026-09-01',
  });
});

test('a refund posted to a credit card reduces live debt', () => {
  const account = { id: 'discover', group: 'debt' };
  const snap = { date: '2026-09-01', accounts: { discover: 500 } };
  const txns = [
    { date: '2026-09-03', type: 'income', account: 'discover', category: 'Refund', amount: 100 },
  ];
  const result = A.cardOwedNow(account, snap, txns, 1, '2026-09-10');
  assert.equal(result.credits, 100);
  assert.equal(result.owed, 400);
});

test('card debt payoff uses live owed balance rather than the stale snapshot balance', () => {
  const account = { id: 'discover', group: 'debt' };
  const snap = { date: '2026-09-01', accounts: { discover: 1000 } };
  const txns = [
    { date: '2026-09-03', type: 'expense', account: 'discover', category: 'Travel', amount: 500 },
  ];
  const result = A.cardDebtProjection(account, snap, txns, 1, { apr: 24, minPayment: 100 }, '2026-09-10');
  assert.equal(result.activity.owed, 1500);
  assert.equal(result.balance, 1500);
  assert.equal(result.payoff.monthlyInterest, 30);
  assert.equal(result.payoff.months, 19);
});

test('openingCarryover uses only the range opening month, not every rolled-forward copy', () => {
  const txns = [
    { date: '2026-08-01', type: 'income', category: 'Money from Last Month', amount: 100 },
    { date: '2026-09-01', type: 'income', category: 'Money from Last Month', amount: 75 },
    { date: '2026-09-02', type: 'income', category: 'Paycheck', amount: 1000 },
  ];
  assert.equal(A.openingCarryover(txns), 100);
  assert.equal(A.openingCarryover(txns, '2026-08-15'), 100);
  assert.equal(A.openingCarryover(txns, '2026-07-15'), 0);
  assert.equal(A.openingCarryover(txns.filter(t => t.date >= '2026-08-15'), '2026-08-15'), 0);
});

test('future ISO dates are excluded and current partial periods compare equal elapsed days', () => {
  assert.equal(A.isISODateOnOrBefore('2026-09-17', '2026-09-17'), true);
  assert.equal(A.isISODateOnOrBefore('2026-09-30', '2026-09-17'), false);
  assert.equal(A.isISODateOnOrBefore('not-a-date', '2026-09-17'), false);

  const cur = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30) };
  const prev = { start: new Date(2026, 7, 1), end: new Date(2026, 7, 31) };
  const ends = A.analysisComparableEnds(cur, prev, 0, new Date(2026, 8, 17));
  assert.equal(A.anISO(ends.curEnd), '2026-09-17');
  assert.equal(A.anISO(ends.prevEnd), '2026-08-17');
});

test('the default Expense form cannot remain paired with the Paycheck category', () => {
  const originalGet = document.getElementById;
  const category = {
    value: 'Paycheck',
    selectedOptions: [{ parentElement: { label: 'Income' } }],
  };
  const elements = {
    'txn-type': { value: 'expense' },
    'to-account-group': { style: {} },
    'txn-category': category,
  };
  document.getElementById = id => elements[id] || null;
  try {
    A.updateToAccountVisibility();
    assert.equal(category.value, 'Miscellaneous');
  } finally {
    document.getElementById = originalGet;
  }
});

test('saveTransaction rejects a same-account transfer before it can alter card debt', () => {
  const originalGet = document.getElementById;
  const originalAlert = globalThis.alert;
  let message = '';
  const values = {
    'txn-date': A.todayISO(),
    'txn-type': 'transfer',
    'txn-amount': '100',
    'txn-account': 'discover',
    'txn-to-account': 'discover',
    'txn-category': 'Transfer In',
    'txn-desc': 'No-op payment',
    'txn-recurring': '',
  };
  document.getElementById = id => id === 'txn-category'
    ? { value: values[id], selectedOptions: [{ parentElement: { label: 'Income' } }] }
    : (id in values ? { value: values[id] } : null);
  globalThis.alert = text => { message = text; };
  try {
    A.saveTransaction();
    assert.match(message, /different accounts/i);
  } finally {
    document.getElementById = originalGet;
    globalThis.alert = originalAlert;
  }
});

test('parseDiscoverCSV maps purchases to expenses and payments to excluded card-payment transfers', () => {
  const parsed = A.parseDiscoverCSV([
    'Trans. Date,Post Date,Description,Amount,Category',
    '09/03/2026,09/04/2026,GROCERY STORE,42.75,Merchandise',
    '09/05/2026,09/06/2026,ONLINE PAYMENT,-500.00,Payments and Credits',
    '09/07/2026,09/08/2026,GROCERY STORE REFUND,-20.00,Merchandise',
  ]);

  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].type, 'expense');
  assert.equal(parsed[0].amount, 42.75);
  assert.equal(parsed[1].type, 'transfer');
  assert.equal(parsed[1].amount, 500);
  assert.equal(parsed[1].category, 'Credit Card Payment');
  assert.equal(parsed[2].type, 'income');
  assert.equal(parsed[2].amount, 20);
  assert.equal(parsed[2].category, 'Refund');
});

test('Chase card CSV uses card-statement signs and separates payments from refunds', () => {
  const parsed = A.parseChaseCSV([
    'Transaction Date,Post Date,Description,Category,Type,Amount',
    '09/03/2026,09/04/2026,GROCERY STORE,Shopping,Sale,-42.75,',
    '09/05/2026,09/06/2026,AUTOMATIC PAYMENT,Payment,Payment,500.00,',
    '09/07/2026,09/08/2026,GROCERY STORE REFUND,Shopping,Return,20.00,',
    '09/09/2026,09/10/2026,DEBIT ADJUSTMENT,Fees,Adjustment,-15.00,',
  ]);
  assert.deepEqual(parsed.map(t => [t.type, t.amount, t.category || '']), [
    ['expense', 42.75, ''],
    ['transfer', 500, 'Credit Card Payment'],
    ['income', 20, 'Refund'],
    ['expense', 15, ''],
  ]);
  assert.equal(A.detectCSVFormat(A.parseCSVLine('Transaction Date,Post Date,Description,Category,Type,Amount')), 'chase_card');
});

test('Chase checking CSV parses its actual schema and excludes matched card payments', () => {
  const lines = [
    'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #',
    'CREDIT,09/01/2026,PAYROLL,1000.00,ACH_CREDIT,1200.00,',
    'DEBIT,09/02/2026,WHOLE FOODS,-50.00,DEBIT_CARD,1150.00,',
    'DEBIT,09/05/2026,DISCOVER E-PAYMENT,-500.00,ACH_DEBIT,650.00,',
  ];
  assert.equal(A.detectCSVFormat(A.parseCSVLine(lines[0])), 'chase_checking');
  const parsed = A.parseChaseCheckingCSV(lines);
  assert.deepEqual(parsed.map(t => [t.type, t.amount, t.category || '']), [
    ['income', 1000, ''],
    ['expense', 50, ''],
    ['transfer', 500, 'Credit Card Payment'],
  ]);
  assert.equal(A.detectCSVFormat(A.parseCSVLine('Transaction Date,Post Date,Description,Category,Type,Amount,Memo')), 'chase_card');
});

test('chooseBankImportAccount selects an account appropriate to the detected format', () => {
  const accounts = [
    { id: 'savings_first', group: 'savings' },
    { id: 'discover', group: 'debt' },
    { id: 'chase_checking', group: 'checking' },
    { id: 'amex', group: 'debt' },
    { id: 'usf_checking', group: 'checking' },
  ];

  assert.equal(A.chooseBankImportAccount('discover', accounts), 'discover');
  assert.equal(A.chooseBankImportAccount('chase_card', accounts), '');
  assert.equal(A.chooseBankImportAccount('chase_checking', accounts), 'chase_checking');
  assert.equal(A.chooseBankImportAccount('generic', accounts), 'chase_checking');
  assert.equal(A.chooseCardPaymentSource(accounts), '');
  assert.equal(A.chooseCardPaymentSource([accounts[2]]), 'chase_checking');
  assert.equal(A.chooseCardPaymentDestination('DISCOVER E-PAYMENT', accounts), 'discover');
  assert.equal(A.chooseCardPaymentDestination('AMEX AUTOPAY', accounts), 'amex');
  assert.equal(A.chooseCardPaymentDestination('CAPITAL ONE PAYMENT', accounts), '');
  const ambiguous = accounts.concat({ id: 'discover_it', label: 'Discover It', group: 'debt' });
  assert.equal(A.chooseBankImportAccount('discover', ambiguous), '');
  assert.equal(A.chooseCardPaymentDestination('DISCOVER E-PAYMENT', ambiguous), '');
});

test('renderDebtDetails renders a live debt projection without template reference errors', () => {
  const originalGet = document.getElementById;
  const originalStorage = globalThis.localStorage;
  const today = A.todayISO();
  const debtDetails = { innerHTML: '' };
  const values = new Map([
    ['moneytrack_snapshots', JSON.stringify([{ date: today, accounts: { discover: 1000 } }])],
    ['moneytrack_txns', JSON.stringify([])],
    ['moneytrack_debt_meta', JSON.stringify({ discover: { apr: 24, minPayment: 100 } })],
  ]);
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  document.getElementById = id => id === 'debt-details' ? debtDetails : null;
  try {
    A.refreshAccountConfig();
    assert.doesNotThrow(() => A.renderDebtDetails());
    assert.match(debtDetails.innerHTML, /Discover \(Owed\)/);
    assert.match(debtDetails.innerHTML, /Owed now:/);
    assert.match(debtDetails.innerHTML, /-\$1,000\.00/);
  } finally {
    document.getElementById = originalGet;
    globalThis.localStorage = originalStorage;
    A.refreshAccountConfig();
  }
});

test('bank import reconciliation preserves identical legitimate rows and fixes legacy Discover rows', () => {
  const purchase = {
    id: 'new-1', date: '2026-09-03', type: 'expense', amount: 42.75,
    account: 'discover', toAccount: '', description: 'GROCERY STORE', category: 'Groceries', recurring: '',
  };
  const repeated = { ...purchase, id: 'new-2' };
  const fresh = A.reconcileBankImports([], [purchase, repeated], 'discover', 'chase_checking');
  assert.equal(fresh.newTxns.length, 2);

  const oneAlreadyStored = A.reconcileBankImports([{ ...purchase, id: 'existing-1' }], [purchase, repeated], 'discover', 'chase_checking');
  assert.equal(oneAlreadyStored.duplicates, 1);
  assert.equal(oneAlreadyStored.newTxns.length, 1);

  const legacy = [
    { id: 'old-purchase', date: purchase.date, type: 'expense', amount: purchase.amount,
      account: 'chase_checking', description: purchase.description, category: 'Groceries', recurring: '' },
    { id: 'old-payment', date: '2026-09-05', type: 'income', amount: 500,
      account: 'chase_checking', description: 'ONLINE PAYMENT', category: 'Miscellaneous', recurring: '' },
  ];
  const payment = {
    id: 'new-payment', date: '2026-09-05', type: 'transfer', amount: 500,
    account: 'chase_checking', toAccount: 'discover', description: 'ONLINE PAYMENT',
    category: 'Credit Card Payment', recurring: '',
  };
  const repaired = A.reconcileBankImports(legacy, [purchase, payment], 'discover', 'chase_checking');
  assert.equal(repaired.migrated, 2);
  assert.equal(repaired.newTxns.length, 0);
  assert.equal(repaired.existing[0].id, 'old-purchase');
  assert.equal(repaired.existing[0].account, 'discover');
  assert.equal(repaired.existing[1].id, 'old-payment');
  assert.equal(repaired.existing[1].type, 'transfer');
  assert.equal(repaired.existing[1].toAccount, 'discover');
});
