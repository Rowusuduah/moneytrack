import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../js/africa.js', import.meta.url), 'utf8');
vm.runInThisContext(src);
const A = globalThis; // top-level function declarations land on the host global

const FIX = [
  { id: 'a', name: 'MTN Ghana IPO', country: 'Ghana',   currency: 'GHS', invested: 20000, current: 23500, date: '2026-03-10', updated: '2026-07-25', note: '' },
  { id: 'b', name: 'Accra REIT',    country: 'Ghana',   currency: 'GHS', invested: 5000,  current: 4200,  date: '2026-05-01', updated: '2026-07-01', note: '' },
  { id: 'c', name: 'Dangote notes', country: 'Nigeria', currency: 'USD', invested: 1000,  current: 1150,  date: '2026-06-15', updated: '2026-07-20', note: '' },
  { id: 'd', name: 'Lagos fund',    country: 'Nigeria', currency: 'GHS', invested: 3000,  current: 3000,  date: '2026-07-01', updated: '2026-07-01', note: '' },
];

test('afTotals sums per currency (zero-filled) and per country', () => {
  const t = A.afTotals(FIX);
  assert.deepEqual(t.byCurrency.GHS, { invested: 28000, current: 30700, gain: 2700 });
  assert.deepEqual(t.byCurrency.USD, { invested: 1000,  current: 1150,  gain: 150 });
  assert.deepEqual(Object.keys(t.byCountry).sort(), ['Ghana', 'Nigeria']);
  assert.deepEqual(t.byCountry.Ghana.GHS,   { invested: 25000, current: 27700, gain: 2700 });
  assert.deepEqual(t.byCountry.Ghana.USD,   { invested: 0,     current: 0,     gain: 0 });
  assert.deepEqual(t.byCountry.Nigeria.USD, { invested: 1000,  current: 1150,  gain: 150 });
  assert.deepEqual(t.byCountry.Nigeria.GHS, { invested: 3000,  current: 3000,  gain: 0 });
});

test('afTotals of empty list: zero-filled currencies, no countries', () => {
  const t = A.afTotals([]);
  assert.deepEqual(t.byCurrency, {
    GHS: { invested: 0, current: 0, gain: 0 },
    USD: { invested: 0, current: 0, gain: 0 },
  });
  assert.deepEqual(t.byCountry, {});
});

test('afUsdEstimate converts GHS at the rate and adds USD holdings', () => {
  const bc = A.afTotals(FIX).byCurrency;
  // 30700 / 15.5 + 1150 = 3130.645… → 3130.65
  assert.equal(A.afUsdEstimate(bc, 15.5), 3130.65);
});

test('afUsdEstimate returns null without a positive finite numeric rate', () => {
  const bc = A.afTotals(FIX).byCurrency;
  for (const bad of [null, undefined, 0, -3, NaN, Infinity, '15.5']) {
    assert.equal(A.afUsdEstimate(bc, bad), null, `rate ${String(bad)} must give null`);
  }
});

test('afGainPct returns percentage, null when nothing invested', () => {
  assert.equal(A.afGainPct(20000, 3500), 17.5);
  assert.equal(A.afGainPct(5000, -800), -16);
  assert.equal(A.afGainPct(0, 100), null);
});

test('afFmtMoney formats GHS and USD including negatives', () => {
  assert.equal(A.afFmtMoney(1234.5, 'GHS'), 'GH₵ 1,234.50');
  assert.equal(A.afFmtMoney(1234.5, 'USD'), '$1,234.50');
  assert.equal(A.afFmtMoney(-50, 'GHS'), '-GH₵ 50.00');
  assert.equal(A.afFmtMoney(0, 'USD'), '$0.00');
});
