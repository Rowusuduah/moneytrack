import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Force the DST transition used by the calendar-day regression tests.
process.env.TZ = 'America/New_York';

// app.js is a browser script. Give its top-level bootstrap the same minimal
// browser globals used by app.test.mjs so its pure helpers can load in Node.
globalThis.document ??= {
  addEventListener() {},
  getElementById: () => null,
  querySelectorAll: () => [],
  querySelector: () => null,
};
globalThis.window ??= { addEventListener() {} };
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };

const _setTimeout = globalThis.setTimeout;
const _setInterval = globalThis.setInterval;
globalThis.setTimeout = (fn, ms, ...args) => {
  const timer = _setTimeout(fn, ms, ...args);
  timer.unref?.();
  return timer;
};
globalThis.setInterval = (fn, ms, ...args) => {
  const timer = _setInterval(fn, ms, ...args);
  timer.unref?.();
  return timer;
};

const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
vm.runInThisContext(src);
const A = globalThis;

test('orderedSnapshots sorts ascending without mutating the source', () => {
  const snapshots = [
    { date: '2026-09-30', accounts: { checking: 300 } },
    { date: '2026-09-01', accounts: { checking: 100 } },
    { date: '2026-09-17', accounts: { checking: 200 } },
  ];

  const ordered = A.orderedSnapshots(snapshots);

  assert.deepEqual(ordered.map(s => s.date), [
    '2026-09-01',
    '2026-09-17',
    '2026-09-30',
  ]);
  assert.deepEqual(snapshots.map(s => s.date), [
    '2026-09-30',
    '2026-09-01',
    '2026-09-17',
  ]);
});

test('orderedSnapshots throughDate excludes future snapshots', () => {
  const snapshots = [
    { date: '2026-09-30', accounts: { checking: 300 } },
    { date: '2026-09-01', accounts: { checking: 100 } },
    { date: '2026-09-17', accounts: { checking: 200 } },
  ];

  assert.deepEqual(
    A.orderedSnapshots(snapshots, '2026-09-17').map(s => s.date),
    ['2026-09-01', '2026-09-17'],
  );
});

test('buildSnapshotBalances omits deleted accounts from a new snapshot and carries blank active balances', () => {
  const accounts = [
    { id: 'checking', group: 'checking' },
    { id: 'savings', group: 'savings' },
    { id: 'closed_savings', group: 'savings', deleted: true },
  ];
  const existing = { checking: 100, savings: 500, closed_savings: 1000 };
  const rawById = { checking: '150.129', savings: '', closed_savings: '' };

  assert.deepEqual(
    A.buildSnapshotBalances(accounts, existing, rawById, false),
    { checking: 150.13, savings: 500 },
  );
});

test('buildSnapshotBalances preserves deleted historical values when overwriting an existing snapshot', () => {
  const accounts = [
    { id: 'checking', group: 'checking' },
    { id: 'savings', group: 'savings' },
    { id: 'closed_savings', group: 'savings', deleted: true },
  ];
  const existing = { checking: 100, savings: 500, closed_savings: 1000 };
  const rawById = { checking: '150.129', savings: '', closed_savings: '' };

  assert.deepEqual(
    A.buildSnapshotBalances(accounts, existing, rawById, true),
    { checking: 150.13, savings: 500, closed_savings: 1000 },
  );
});

test('calendarDayCount is inclusive across the spring DST transition', () => {
  const march1 = new Date(2026, 2, 1);
  const march10 = new Date(2026, 2, 10);
  const march31 = new Date(2026, 2, 31);

  assert.equal(A.calendarDayCount(march1, march10), 10);
  assert.equal(A.calendarDayCount(march1, march31), 31);
});

test('dated net worth ignores loans created after the snapshot', () => {
  A.refreshAccountConfig();
  const snapshot = {
    date: '2026-09-01',
    accounts: { chase_checking: 1000 },
  };
  const loans = [{
    date: '2026-09-10',
    status: 'outstanding',
    amount: 500,
    payments: [],
  }];

  assert.equal(A.calcNetWorth(snapshot, loans, snapshot.date), 1000);
});

test('dated net worth retains a loan before its later paid date', () => {
  A.refreshAccountConfig();
  const snapshot = {
    date: '2026-09-01',
    accounts: { chase_checking: 1000 },
  };
  const loans = [{
    date: '2026-08-01',
    status: 'paid',
    amount: 500,
    paidDate: '2026-09-10',
    payments: [{ date: '2026-09-10', amount: 500 }],
  }];

  assert.equal(A.calcNetWorth(snapshot, loans, snapshot.date), 1500);
  assert.equal(A.calcNetWorth(snapshot, loans, '2026-09-10'), 1000);
});
