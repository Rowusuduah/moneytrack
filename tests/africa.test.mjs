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

test('afRateHistoryAppend appends, replaces same-date, sorts, does not mutate', () => {
  const h = [{ date: '2026-07-10', rate: 15.2 }];
  const h2 = A.afRateHistoryAppend(h, '2026-07-26', 15.5);
  assert.deepEqual(h2, [{ date: '2026-07-10', rate: 15.2 }, { date: '2026-07-26', rate: 15.5 }]);
  assert.equal(h.length, 1);                                   // input untouched
  const h3 = A.afRateHistoryAppend(h2, '2026-07-26', 15.6);    // same-day re-save
  assert.equal(h3.length, 2);
  assert.deepEqual(h3[1], { date: '2026-07-26', rate: 15.6 });
  const h4 = A.afRateHistoryAppend(h2, '2026-07-01', 15.0);    // older date sorts first
  assert.deepEqual(h4.map(p => p.date), ['2026-07-01', '2026-07-10', '2026-07-26']);
});

test('afRateChange: null under 2 points; signed pct for weakened/strengthened/flat', () => {
  assert.equal(A.afRateChange([]), null);
  assert.equal(A.afRateChange([{ date: '2026-07-10', rate: 15.2 }]), null);
  const up = A.afRateChange([{ date: '2026-07-10', rate: 15.2 }, { date: '2026-07-26', rate: 15.5 }]);
  assert.equal(up.pct, 1.97);                                  // (15.5−15.2)/15.2·100 = 1.9736…
  assert.equal(up.prev.date, '2026-07-10');
  assert.equal(up.latest.rate, 15.5);
  const down = A.afRateChange([{ date: '2026-07-10', rate: 15.5 }, { date: '2026-07-26', rate: 15.2 }]);
  assert.equal(down.pct, -1.94);                               // −1.9354…
  const flat = A.afRateChange([{ date: '2026-07-10', rate: 15.5 }, { date: '2026-07-26', rate: 15.5 }]);
  assert.equal(flat.pct, 0);
});

// ── investment value history (daily tracking, not override) ──

test('afValHistoryAppend adds a point; same-day save replaces; stays sorted', () => {
  let h = A.afValHistoryAppend([], '2026-07-01', 100);
  assert.deepEqual(h, [{ date: '2026-07-01', current: 100 }]);
  h = A.afValHistoryAppend(h, '2026-07-05', 120);
  h = A.afValHistoryAppend(h, '2026-07-03', 110);           // out of order
  assert.deepEqual(h.map(p => p.date), ['2026-07-01', '2026-07-03', '2026-07-05']);
  h = A.afValHistoryAppend(h, '2026-07-05', 130);            // same day -> replace
  assert.equal(h.length, 3);
  assert.equal(h[h.length - 1].current, 130);
  assert.equal(A.afValHistoryAppend([], '2026-07-01', 100.006)[0].current, 100.01); // rounded
});

test('afValChange: abs, pct, points; null when fewer than 2 points', () => {
  const c = A.afValChange([{ date: '2026-07-01', current: 100 }, { date: '2026-07-10', current: 130 }]);
  assert.equal(c.abs, 30);
  assert.equal(c.pct, 30);
  assert.equal(c.points, 2);
  assert.equal(A.afValChange([{ date: '2026-07-01', current: 100 }]), null);
  assert.equal(A.afValChange([]), null);
});

test('afSanitizeInv seeds history from current/updated, keeps + filters valid points', () => {
  const seeded = A.afSanitizeInv({ id: 'x', current: 500, updated: '2026-07-20', date: '2026-07-01' });
  assert.deepEqual(seeded.history, [{ date: '2026-07-20', current: 500 }]); // prefers `updated`
  const kept = A.afSanitizeInv({ id: 'y', current: 9, date: '2026-07-01',
    history: [{ date: '2026-07-02', current: 10 }, { date: 'bad', current: 1 }, { date: '2026-07-01', current: 8 }] });
  assert.deepEqual(kept.history, [{ date: '2026-07-01', current: 8 }, { date: '2026-07-02', current: 10 }]);
});

test('afValSeries: per-step delta and pct, first point null', () => {
  const s = A.afValSeries([
    { date: '2026-07-01', current: 1000 },
    { date: '2026-07-15', current: 1100 },
    { date: '2026-08-01', current: 990 },
  ]);
  assert.deepEqual(s, [
    { date: '2026-07-01', current: 1000, delta: null, pct: null },
    { date: '2026-07-15', current: 1100, delta: 100,  pct: 10 },
    { date: '2026-08-01', current: 990,  delta: -110, pct: -10 },
  ]);
});

test('afValSeries: empty/null history gives empty array; zero prev gives null pct', () => {
  assert.deepEqual(A.afValSeries([]), []);
  assert.deepEqual(A.afValSeries(null), []);
  const s = A.afValSeries([{ date: '2026-07-01', current: 0 }, { date: '2026-07-02', current: 50 }]);
  assert.equal(s[1].delta, 50);
  assert.equal(s[1].pct, null);
});

test('afValStats: overall change plus best and worst single update', () => {
  const h = [
    { date: '2026-07-01', current: 1000 },
    { date: '2026-07-15', current: 1100 },
    { date: '2026-08-01', current: 990 },
    { date: '2026-08-10', current: 1200 },
  ];
  const s = A.afValStats(h);
  assert.equal(s.change.abs, 200);
  assert.equal(s.change.pct, 20);
  assert.equal(s.best.date, '2026-08-10');
  assert.equal(s.best.delta, 210);
  assert.equal(s.worst.date, '2026-08-01');
  assert.equal(s.worst.delta, -110);
  assert.equal(s.steps, 3);
  assert.equal(A.afValStats([{ date: '2026-07-01', current: 5 }]), null);
  assert.equal(A.afValStats([]), null);
});
