'use strict';
/* ═══════════════════════════════════════════════════════════════
   MoneyTrack — Africa investments (Ghana / Nigeria, GH₵ / $)

   Amounts are stored in their own currency and never converted at
   rest; the manual rate (GH₵ per 1 USD) only powers estimate lines.
   Top-level code here must stay DOM-free and app.js-free: the pure
   functions are unit-tested in Node (tests/africa.test.mjs).
   Spec: docs/superpowers/specs/2026-07-25-africa-investments-design.md
   ═══════════════════════════════════════════════════════════════ */

const AF_COUNTRIES = ['Ghana', 'Nigeria', 'Other'];

function afRound(n) { return Math.round(n * 100) / 100; }   // local: no app.js at top level

function afTotals(investments) {
  const zero = () => ({ invested: 0, current: 0, gain: 0 });
  const byCurrency = { GHS: zero(), USD: zero() };
  const byCountry = {};
  (investments || []).forEach(inv => {
    const cur  = inv.currency === 'USD' ? 'USD' : 'GHS';
    const invd = Number(inv.invested) || 0;
    const curr = Number(inv.current)  || 0;
    if (!byCountry[inv.country]) byCountry[inv.country] = { GHS: zero(), USD: zero() };
    [byCurrency[cur], byCountry[inv.country][cur]].forEach(t => {
      t.invested = afRound(t.invested + invd);
      t.current  = afRound(t.current + curr);
      t.gain     = afRound(t.current - t.invested);
    });
  });
  return { byCurrency, byCountry };
}

// USD estimate at the saved rate; null until a usable rate exists.
function afUsdEstimate(byCurrency, rate) {
  if (typeof rate !== 'number' || !isFinite(rate) || rate <= 0) return null;
  return afRound(byCurrency.GHS.current / rate + byCurrency.USD.current);
}

function afGainPct(invested, gain) {
  if (!(invested > 0)) return null;
  return afRound(gain / invested * 100);
}

function afFmtMoney(n, currency) {
  const v = isFinite(n) ? n : 0;
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? '-' : '') + (currency === 'GHS' ? 'GH₵ ' + abs : '$' + abs);
}
