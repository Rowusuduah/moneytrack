/**
 * things.test.mjs — Unit tests for Things Tracker calculations.
 *
 * Run:  node --test tests/things.test.mjs
 *
 * Tests cover the Gas fixture from the spec (20 records) plus
 * synthetic grocery and edge-case scenarios.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// ── Minimal DOM shim so app.js loads in Node ─────────────────────
globalThis.document  ??= { addEventListener() {}, getElementById: () => null,
  querySelectorAll: () => [], querySelector: () => null };
globalThis.window    ??= { addEventListener() {} };
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
const _setTimeout = globalThis.setTimeout, _setInterval = globalThis.setInterval;
globalThis.setTimeout  = (fn, ms, ...a) => { const t = _setTimeout(fn, ms, ...a);  t.unref?.(); return t; };
globalThis.setInterval = (fn, ms, ...a) => { const t = _setInterval(fn, ms, ...a); t.unref?.(); return t; };

vm.runInThisContext(readFileSync(new URL('../js/app.js', import.meta.url), 'utf8'));
const A = globalThis;

// ── Gas fixture (spec §16) ────────────────────────────────────────
// Reporting date frozen at 2026-09-18 per spec.
const GAS_FIXTURE = [
  { date:'2026-03-20', store:'RaceTrac', quantity:13.801, totalPrice:54.50, unit:'gal' },
  { date:'2026-03-30', store:'Chevron',  quantity:13.397, totalPrice:57.06, unit:'gal' },
  { date:'2026-04-12', store:'Chevron',  quantity:13.965, totalPrice:53.89, unit:'gal' },
  { date:'2026-04-22', store:'Chevron',  quantity: 8.690, totalPrice:32.67, unit:'gal' },
  { date:'2026-05-03', store:'',         quantity:12.589, totalPrice:54.11, unit:'gal' },
  { date:'2026-05-07', store:'RaceTrac', quantity:11.379, totalPrice:51.19, unit:'gal' },
  { date:'2026-05-11', store:'Wawa',     quantity:13.288, totalPrice:56.73, unit:'gal' },
  { date:'2026-05-17', store:'',         quantity:12.826, totalPrice:50.52, unit:'gal' },
  { date:'2026-05-25', store:'',         quantity:13.407, totalPrice:55.63, unit:'gal' },
  { date:'2026-06-05', store:'',         quantity:15.717, totalPrice:56.57, unit:'gal' },
  { date:'2026-06-20', store:'',         quantity:14.540, totalPrice:50.88, unit:'gal' },
  { date:'2026-06-28', store:'',         quantity:14.918, totalPrice:55.18, unit:'gal' },
  { date:'2026-07-05', store:'Wawa',     quantity:15.127, totalPrice:56.41, unit:'gal' },
  { date:'2026-07-18', store:'',         quantity:15.600, totalPrice:60.20, unit:'gal' },
  { date:'2026-07-28', store:'',         quantity:15.511, totalPrice:60.79, unit:'gal' },
  { date:'2026-08-06', store:'',         quantity:15.942, totalPrice:62.16, unit:'gal' },
  { date:'2026-08-16', store:'Wawa',     quantity:15.795, totalPrice:60.00, unit:'gal' },
  { date:'2026-08-25', store:'',         quantity:16.076, totalPrice:57.86, unit:'gal' },
  { date:'2026-09-04', store:'',         quantity:16.820, totalPrice:65.24, unit:'gal' },
  { date:'2026-09-17', store:'Wawa',     quantity:16.081, totalPrice:70.74, unit:'gal' },
].map((r, i) => ({ id: String(i), itemId: 'gas', ...r }));

const AS_OF = '2026-09-18';

// ── Gas fixture: all-history totals ──────────────────────────────
test('Gas fixture: 20 distinct records', () => {
  assert.equal(GAS_FIXTURE.length, 20);
});

test('Gas fixture: total spending $1122.33', () => {
  const total = GAS_FIXTURE.reduce((s, e) => s + e.totalPrice, 0);
  assert.equal(A.roundMoney(total), 1122.33);
});

test('Gas fixture: total gallons 285.469', () => {
  const totalGal = GAS_FIXTURE.reduce((s, e) => s + e.quantity, 0);
  assert.equal(+totalGal.toFixed(3), 285.469);
});

test('Gas fixture: weighted price ≈ $3.93/gal', () => {
  const wp = A.calcWeightedUnitPrice(GAS_FIXTURE);
  // 1122.33 / 285.469 = 3.93153...
  assert.ok(wp !== null);
  assert.equal(+wp.toFixed(2), 3.93);
  // Full precision check from spec: 3.9315302...
  assert.ok(Math.abs(wp - 3.9315302) < 0.0000005);
});

test('Gas fixture: avg purchase amount $56.12 (20 events)', () => {
  const avg = 1122.33 / 20;
  assert.equal(+avg.toFixed(2), 56.12);
});

// ── Gas fixture: timing ───────────────────────────────────────────
test('Gas fixture: timing — first March 20, latest Sep 17, elapsed 181 days', () => {
  const t = A.calcTiming(GAS_FIXTURE, AS_OF);
  assert.equal(t.firstDate, '2026-03-20');
  assert.equal(t.latestDate, '2026-09-17');
  assert.equal(t.elapsedDays, 181);
});

test('Gas fixture: 20 purchase events, 19 intervals', () => {
  const t = A.calcTiming(GAS_FIXTURE, AS_OF);
  assert.equal(t.purchaseCount, 20);
  assert.equal(t.intervalCount, 19);
});

test('Gas fixture: mean interval 181/19 ≈ 9.53 days', () => {
  const t = A.calcTiming(GAS_FIXTURE, AS_OF);
  assert.ok(t.meanInterval !== null);
  assert.ok(Math.abs(t.meanInterval - 181 / 19) < 0.001);
});

test('Gas fixture: median interval = 10 days', () => {
  const t = A.calcTiming(GAS_FIXTURE, AS_OF);
  assert.equal(t.medianInterval, 10);
});

test('Gas fixture: shortest interval = 4 days', () => {
  const t = A.calcTiming(GAS_FIXTURE, AS_OF);
  assert.equal(t.minInterval, 4);
});

test('Gas fixture: longest interval = 15 days', () => {
  const t = A.calcTiming(GAS_FIXTURE, AS_OF);
  assert.equal(t.maxInterval, 15);
});

test('Gas fixture: latest interval = 13 days (Sep 4 → Sep 17)', () => {
  const t = A.calcTiming(GAS_FIXTURE, AS_OF);
  assert.equal(t.latestInterval, 13);
});

test('Gas fixture: days since latest = 1 (Sep 17 → Sep 18)', () => {
  const t = A.calcTiming(GAS_FIXTURE, AS_OF);
  assert.equal(t.daysSinceLatest, 1);
});

// ── Gas fixture: monthly breakdown ───────────────────────────────
test('Gas fixture: monthly stats — correct number of months', () => {
  const ms = A.calcMonthlyStats(GAS_FIXTURE);
  assert.equal(ms.length, 7); // Mar–Sep
});

test('Gas fixture: Mar 2026 — 2 purchases, $111.56, 27.198 gal, wtd price $4.10', () => {
  const ms = A.calcMonthlyStats(GAS_FIXTURE);
  const mar = ms.find(m => m.month === '2026-03');
  assert.ok(mar);
  assert.equal(mar.count, 2);
  assert.equal(mar.totalSpent, 111.56);
  assert.equal(+mar.totalQty.toFixed(3), 27.198);
  assert.equal(+mar.weightedPrice.toFixed(2), 4.10);
});

test('Gas fixture: Apr 2026 — 2 purchases, $86.56, 22.655 gal, wtd price $3.82', () => {
  const ms = A.calcMonthlyStats(GAS_FIXTURE);
  const apr = ms.find(m => m.month === '2026-04');
  assert.ok(apr);
  assert.equal(apr.count, 2);
  assert.equal(apr.totalSpent, 86.56);
  assert.equal(+apr.totalQty.toFixed(3), 22.655);
  assert.equal(+apr.weightedPrice.toFixed(2), 3.82);
});

test('Gas fixture: May 2026 — 5 purchases, $268.18, 63.489 gal, wtd price $4.22', () => {
  const ms = A.calcMonthlyStats(GAS_FIXTURE);
  const may = ms.find(m => m.month === '2026-05');
  assert.ok(may);
  assert.equal(may.count, 5);
  assert.equal(may.totalSpent, 268.18);
  assert.equal(+may.totalQty.toFixed(3), 63.489);
  assert.equal(+may.weightedPrice.toFixed(2), 4.22);
});

test('Gas fixture: Jun 2026 — 3 purchases, $162.63, 45.175 gal, wtd price $3.60', () => {
  const ms = A.calcMonthlyStats(GAS_FIXTURE);
  const jun = ms.find(m => m.month === '2026-06');
  assert.ok(jun);
  assert.equal(jun.count, 3);
  assert.equal(jun.totalSpent, 162.63);
  assert.equal(+jun.totalQty.toFixed(3), 45.175);
  assert.equal(+jun.weightedPrice.toFixed(2), 3.60);
});

test('Gas fixture: Jul 2026 — 3 purchases, $177.40, 46.238 gal, wtd price $3.84', () => {
  const ms = A.calcMonthlyStats(GAS_FIXTURE);
  const jul = ms.find(m => m.month === '2026-07');
  assert.ok(jul);
  assert.equal(jul.count, 3);
  assert.equal(jul.totalSpent, 177.40);
  assert.equal(+jul.totalQty.toFixed(3), 46.238);
  assert.equal(+jul.weightedPrice.toFixed(2), 3.84);
});

test('Gas fixture: Aug 2026 — 3 purchases, $180.02, 47.813 gal, wtd price $3.77', () => {
  const ms = A.calcMonthlyStats(GAS_FIXTURE);
  const aug = ms.find(m => m.month === '2026-08');
  assert.ok(aug);
  assert.equal(aug.count, 3);
  assert.equal(aug.totalSpent, 180.02);
  assert.equal(+aug.totalQty.toFixed(3), 47.813);
  assert.equal(+aug.weightedPrice.toFixed(2), 3.77);
});

test('Gas fixture: Sep 2026 — 2 purchases, $135.98, 32.901 gal, wtd price $4.13', () => {
  const ms = A.calcMonthlyStats(GAS_FIXTURE);
  const sep = ms.find(m => m.month === '2026-09');
  assert.ok(sep);
  assert.equal(sep.count, 2);
  assert.equal(sep.totalSpent, 135.98);
  assert.equal(+sep.totalQty.toFixed(3), 32.901);
  assert.equal(+sep.weightedPrice.toFixed(2), 4.13);
});

test('Gas fixture: monthly totals reconcile to all-history totals', () => {
  const ms = A.calcMonthlyStats(GAS_FIXTURE);
  const totalSpent = A.roundMoney(ms.reduce((s, m) => s + m.totalSpent, 0));
  const totalQty   = ms.reduce((s, m) => s + (m.totalQty || 0), 0);
  assert.equal(totalSpent, 1122.33);
  assert.equal(+totalQty.toFixed(3), 285.469);
});

test('Gas fixture: May mean interval ≈ 6.6 days (3 intervals across 5 dates)', () => {
  const ms = A.calcMonthlyStats(GAS_FIXTURE);
  const may = ms.find(m => m.month === '2026-05');
  // Intervals: May 3→7=4, May 7→11=4, May 11→17=6, May 17→25=8 → 3 belong to May (7, 11, 17, 25)
  // Actually: dates in May are 05-03, 05-07, 05-11, 05-17, 05-25
  // Intervals ending in May: 04-22→05-03=11(Apr), 05-03→07=4, 07→11=4, 11→17=6, 17→25=8
  // Intervals assigned to May month: 4+4+6+8 = 22, count=4, mean=5.5
  // Spec says mean interval = 6.6 for May. Let me recalculate.
  // Wait, spec says "mean interval = 6.6" — let me check: 5 events in May
  // The 5 May events: 03, 07, 11, 17, 25
  // Intervals within-period: 4, 4, 6, 8 → mean = 5.5
  // But spec says 6.6. Let me re-examine: April 22 → May 3 = 11 days (this interval ends May 3, so in May)
  // + May 3→7 = 4, May 7→11 = 4, May 11→17 = 6, May 17→25 = 8
  // Sum = 11+4+4+6+8=33, count=5 → mean = 6.6 ✓
  assert.ok(may.meanInterval !== null);
  assert.equal(+may.meanInterval.toFixed(1), 6.6);
});

// ── Gas fixture: store totals ─────────────────────────────────────
test('Gas fixture: store totals — RaceTrac $105.69, Chevron $143.62, Wawa $243.88, Unknown $629.14', () => {
  const stats = A.calcStoreStats(GAS_FIXTURE, {});
  const find  = name => stats.find(s => s.name === name || s.isUnknown && name === 'Unknown');
  const rtrac = find('RaceTrac');
  const chev  = find('Chevron');
  const wawa  = find('Wawa');
  const unk   = stats.find(s => s.isUnknown);

  assert.ok(rtrac, 'RaceTrac missing');
  assert.equal(rtrac.totalSpent, 105.69);
  assert.equal(rtrac.purchaseCount, 2);

  assert.ok(chev, 'Chevron missing');
  assert.equal(chev.totalSpent, 143.62);
  assert.equal(chev.purchaseCount, 3);

  assert.ok(wawa, 'Wawa missing');
  assert.equal(wawa.totalSpent, 243.88);
  assert.equal(wawa.purchaseCount, 4);

  assert.ok(unk, 'Unknown store group missing');
  assert.equal(unk.totalSpent, 629.14);
  assert.equal(unk.purchaseCount, 11);
});

test('Gas fixture: store totals reconcile to overall total', () => {
  const stats = A.calcStoreStats(GAS_FIXTURE, {});
  const sum   = A.roundMoney(stats.reduce((s, g) => s + g.totalSpent, 0));
  assert.equal(sum, 1122.33);
});

test('Gas fixture: 11 purchases have no store', () => {
  const noStore = GAS_FIXTURE.filter(e => !e.store);
  assert.equal(noStore.length, 11);
  const total = A.roundMoney(noStore.reduce((s, e) => s + e.totalPrice, 0));
  assert.equal(total, 629.14);
});

// ── Gas fixture: rising price ─────────────────────────────────────
test('Gas fixture: isItemPriceRising — true (Aug 3.60 → Sep 4.40 ≈ +22%)', () => {
  // Last two: Aug 25 (3.60/gal) → Sep 4 (3.88/gal) → Sep 17 (4.40/gal)
  // Latest two comparable: Sep 4 and Sep 17
  // Sep 4: 65.24/16.820 = 3.879...; Sep 17: 70.74/16.081 = 4.399...
  // (4.399 - 3.879) / 3.879 ≈ 0.134 → rising
  assert.equal(A.isItemPriceRising(GAS_FIXTURE), true);
});

// ── Weighted price edge cases ─────────────────────────────────────
test('calcWeightedUnitPrice: no eligible entries → null', () => {
  const entries = [{ quantity: null, totalPrice: 20 }, { quantity: 0, totalPrice: 15 }];
  assert.equal(A.calcWeightedUnitPrice(entries), null);
});

test('calcWeightedUnitPrice: single eligible entry', () => {
  const entries = [{ quantity: 5, totalPrice: 20, unit: 'lbs' }];
  assert.equal(A.calcWeightedUnitPrice(entries), 4);
});

test('calcWeightedUnitPrice: mixed (amount-only excluded from numerator and denominator)', () => {
  const entries = [
    { quantity: 10, totalPrice: 40 },   // $4/unit
    { quantity: null, totalPrice: 25 }, // amount-only — excluded from weighted price
    { quantity: 5, totalPrice: 25 },    // $5/unit
  ];
  const wp = A.calcWeightedUnitPrice(entries);
  // (40 + 25) / (10 + 5) = 65 / 15 = 4.333...
  assert.equal(+wp.toFixed(4), 4.3333);
});

// ── Timing edge cases ─────────────────────────────────────────────
test('calcTiming: single entry → 0 intervals, no mean', () => {
  const entries = [{ date: '2026-01-01', quantity: 5, totalPrice: 20 }];
  const t = A.calcTiming(entries, '2026-01-15');
  assert.equal(t.purchaseCount, 1);
  assert.equal(t.intervalCount, 0);
  assert.equal(t.meanInterval, null);
  assert.equal(t.daysSinceLatest, 14);
});

test('calcTiming: empty entries → null', () => {
  assert.equal(A.calcTiming([], '2026-01-01'), null);
});

test('calcTiming: out-of-order input sorted correctly', () => {
  const entries = [
    { date: '2026-03-20', quantity: 1, totalPrice: 5 },
    { date: '2026-03-10', quantity: 1, totalPrice: 5 },
    { date: '2026-03-15', quantity: 1, totalPrice: 5 },
  ];
  const t = A.calcTiming(entries, '2026-03-25');
  assert.equal(t.firstDate, '2026-03-10');
  assert.equal(t.latestDate, '2026-03-20');
  assert.equal(t.minInterval, 5);
  assert.equal(t.maxInterval, 5);
  assert.equal(t.elapsedDays, 10);
});

test('calcTiming: same-day entries count as one purchase event', () => {
  const entries = [
    { date: '2026-01-10', quantity: 1, totalPrice: 5 },
    { date: '2026-01-10', quantity: 2, totalPrice: 8 }, // same date = one event
    { date: '2026-01-20', quantity: 1, totalPrice: 5 },
  ];
  const t = A.calcTiming(entries, '2026-01-20');
  assert.equal(t.purchaseCount, 2); // 2 unique dates
  assert.equal(t.intervalCount, 1);
  assert.equal(t.latestInterval, 10);
});

// ── Monthly stats edge cases ──────────────────────────────────────
test('calcMonthlyStats: empty input → empty array', () => {
  assert.deepEqual(A.calcMonthlyStats([]), []);
});

test('calcMonthlyStats: amount-only entries — spending included, qty excluded from weighted price', () => {
  const entries = [
    { date: '2026-01-05', quantity: 10,   totalPrice: 40, unit: 'lbs' },
    { date: '2026-01-15', quantity: null, totalPrice: 25, unit: 'lbs' }, // amount-only
  ];
  const ms = A.calcMonthlyStats(entries);
  assert.equal(ms.length, 1);
  assert.equal(ms[0].totalSpent, 65);       // 40+25 counts
  assert.equal(ms[0].eligibleCount, 1);     // only 1 has qty
  assert.equal(+ms[0].totalQty, 10);
  assert.equal(ms[0].weightedPrice, 4);     // 40/10
});

test('calcMonthlyStats: year boundary — intervals span across year correctly', () => {
  const entries = [
    { date: '2025-12-25', quantity: 5, totalPrice: 20 },
    { date: '2026-01-04', quantity: 5, totalPrice: 22 },
  ];
  const ms = A.calcMonthlyStats(entries);
  const jan = ms.find(m => m.month === '2026-01');
  // interval Dec 25 → Jan 4 = 10 days, assigned to January
  assert.equal(jan.meanInterval, 10);
});

// ── Store stats edge cases ────────────────────────────────────────
test('calcStoreStats: empty entries → empty array', () => {
  assert.deepEqual(A.calcStoreStats([], {}), []);
});

test('calcStoreStats: case-insensitive name grouping', () => {
  const entries = [
    { date: '2026-01-01', store: 'walmart',  totalPrice: 30 },
    { date: '2026-01-05', store: 'Walmart',  totalPrice: 25 },
    { date: '2026-01-10', store: 'WALMART',  totalPrice: 20 },
  ];
  const stats = A.calcStoreStats(entries, {});
  // All three go to the same text key ('txt:walmart')
  assert.equal(stats.length, 1);
  assert.equal(stats[0].totalSpent, 75);
  assert.equal(stats[0].purchaseCount, 3);
});

test('calcStoreStats: no-store entries grouped as Unknown', () => {
  const entries = [
    { date: '2026-01-01', store: '',  totalPrice: 10 },
    { date: '2026-01-05', store: null, totalPrice: 15 },
    { date: '2026-01-10',              totalPrice: 20 }, // no store field
  ];
  const stats = A.calcStoreStats(entries, {});
  assert.equal(stats.length, 1);
  assert.equal(stats[0].isUnknown, true);
  assert.equal(stats[0].totalSpent, 45);
});

test('calcStoreStats: store totals reconcile for mixed stores', () => {
  const entries = [
    { date: '2026-01-01', store: 'A', totalPrice: 10 },
    { date: '2026-01-02', store: 'B', totalPrice: 20 },
    { date: '2026-01-03', store: '',  totalPrice: 30 },
  ];
  const stats = A.calcStoreStats(entries, {});
  const sum = A.roundMoney(stats.reduce((s, g) => s + g.totalSpent, 0));
  assert.equal(sum, 60);
});

// ── isItemPriceRising edge cases ──────────────────────────────────
test('isItemPriceRising: fewer than 2 comparable entries → false', () => {
  assert.equal(A.isItemPriceRising([{ quantity: null, totalPrice: 10 }]), false);
  assert.equal(A.isItemPriceRising([{ quantity: 5, totalPrice: 10 }]), false);
  assert.equal(A.isItemPriceRising([]), false);
});

test('isItemPriceRising: exactly at threshold (2%) → true', () => {
  const entries = [
    { date: '2026-01-01', quantity: 1, totalPrice: 100 },
    { date: '2026-01-15', quantity: 1, totalPrice: 102 }, // +2.0%
  ];
  assert.equal(A.isItemPriceRising(entries), true);
});

test('isItemPriceRising: just below threshold (1.9%) → false', () => {
  const entries = [
    { date: '2026-01-01', quantity: 1, totalPrice: 100 },
    { date: '2026-01-15', quantity: 1, totalPrice: 101.9 }, // +1.9%
  ];
  assert.equal(A.isItemPriceRising(entries), false);
});

test('isItemPriceRising: amount-only entries skipped; compares the two most recent with qty', () => {
  const entries = [
    { date: '2026-01-01', quantity: 1,    totalPrice: 100 },
    { date: '2026-01-10', quantity: 1,    totalPrice: 104 }, // +4% — this is prev
    { date: '2026-01-15', quantity: null, totalPrice: 200 }, // amount-only — skipped
  ];
  // Should compare Jan 1 ($100) and Jan 10 ($104): rising
  assert.equal(A.isItemPriceRising(entries), true);
});

// ── calcPurchaseIntervals ─────────────────────────────────────────
test('calcPurchaseIntervals: deduplicates same-day dates', () => {
  const dates = ['2026-01-10', '2026-01-10', '2026-01-20'];
  const intervals = A.calcPurchaseIntervals(dates);
  assert.deepEqual(intervals, [10]);
});

test('calcPurchaseIntervals: empty → empty', () => {
  assert.deepEqual(A.calcPurchaseIntervals([]), []);
});

test('calcPurchaseIntervals: single date → no intervals', () => {
  assert.deepEqual(A.calcPurchaseIntervals(['2026-01-01']), []);
});

// ── April mean interval example from spec §11 ─────────────────────
test('Spec §11 April example: mean = 11.5 days', () => {
  // Mar 30 → Apr 12 = 13 days; Apr 12 → Apr 22 = 10 days → mean = 11.5
  const entries = [
    { date: '2026-03-30', quantity: 1, totalPrice: 10 },
    { date: '2026-04-12', quantity: 1, totalPrice: 10 },
    { date: '2026-04-22', quantity: 1, totalPrice: 10 },
  ];
  const ms = A.calcMonthlyStats(entries);
  const apr = ms.find(m => m.month === '2026-04');
  assert.ok(apr, 'April missing');
  // intervals assigned to April: Mar30→Apr12=13, Apr12→Apr22=10 → mean=11.5
  assert.equal(apr.meanInterval, 11.5);
});

// ── roundMoney / fmt sanity ───────────────────────────────────────
test('roundMoney handles floating-point precision', () => {
  assert.equal(A.roundMoney(0.1 + 0.2), 0.30);
  assert.equal(A.roundMoney(1122.33), 1122.33);
});
