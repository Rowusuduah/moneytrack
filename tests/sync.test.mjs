import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { mergeData } = require('../js/sync-merge.js');

const T = 'moneytrack_txns', S = 'moneytrack_snapshots';
const data = values => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, JSON.stringify(v)]));
const merge = (base, local, remote, keys = [T]) => mergeData(data(base), data(local), data(remote), keys);
const read = (result, key) => JSON.parse(result.data[key]);

test('transactions added on phone and laptop on the same day both survive', () => {
  const a = { id: 'a', date: '2026-09-29', amount: 4 };
  const b = { id: 'b', date: '2026-09-29', amount: 6 };
  const result = merge({ [T]: [] }, { [T]: [a] }, { [T]: [b] });
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(read(result, T), [a, b]);
});

test('edits to different transactions and snapshots merge by identity', () => {
  const first = { id: 'a', amount: 1 }, second = { id: 'b', amount: 2 };
  const base = { [T]: [first, second], [S]: [{ date: '2026-09-28', accounts: { x: 1 } }] };
  const result = merge(base,
    { [T]: [{ ...first, amount: 3 }, second], [S]: base[S] },
    { [T]: [first, { ...second, amount: 4 }], [S]: [{ date: '2026-09-28', accounts: { x: 2 } }] },
    [T, S]);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(read(result, T).map(t => t.amount), [3, 4]);
  assert.equal(read(result, S)[0].accounts.x, 2);
});

test('a deletion stays deleted when the other device has not changed that item', () => {
  const row = { id: 'a', amount: 1 };
  const result = merge({ [T]: [row] }, { [T]: [] }, { [T]: [row] });
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(read(result, T), []);
});

test('a deletion concurrent with an edit stops sync', () => {
  const row = { id: 'a', amount: 1 };
  const result = merge({ [T]: [row] }, { [T]: [] }, { [T]: [{ ...row, amount: 2 }] });
  assert.deepEqual(result.conflicts, [`${T}[a]`]);
});

test('same field edited on both devices stops sync, instead of overwriting either', () => {
  const row = { id: 'a', amount: 1 };
  const result = merge({ [T]: [row] }, { [T]: [{ ...row, amount: 2 }] }, { [T]: [{ ...row, amount: 3 }] });
  assert.deepEqual(result.conflicts, [`${T}[a].amount`]);
});

test('Africa investments and rate changes merge independently', () => {
  const key = 'moneytrack_africa';
  const inv = { id: 'a', current: 20, history: [{ date: '2026-09-28', current: 20 }] };
  const base = { [key]: { rate: 12, investments: [inv] } };
  const result = merge(base,
    { [key]: { rate: 13, investments: [inv] } },
    { [key]: { rate: 12, investments: [{ ...inv, current: 25 }] } }, [key]);
  assert.deepEqual(result.conflicts, []);
  assert.equal(read(result, key).rate, 13);
  assert.equal(read(result, key).investments[0].current, 25);
});

test('Things custom categories and a private Wealth plan are included', () => {
  const cats = 'moneytrack_things_cats', plan = 'moneytrack_wealth_plan_v1';
  const result = merge({ [cats]: ['Food'], [plan]: { target: 100, date: '2026-09-01' } },
    { [cats]: ['Food', 'Gym'], [plan]: { target: 200, date: '2026-09-01' } },
    { [cats]: ['Food', 'Books'], [plan]: { target: 100, date: '2026-09-02' } }, [cats, plan]);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(read(result, cats), ['Food', 'Gym', 'Books']);
  assert.deepEqual(read(result, plan), { target: 200, date: '2026-09-02' });
});
