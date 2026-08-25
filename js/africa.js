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

// One rate point per day: a same-date save replaces that day's point.
// Returns a new date-sorted array; never mutates the input.
function afRateHistoryAppend(history, date, rate) {
  const out = (history || []).filter(p => p.date !== date);
  out.push({ date, rate });
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// Movement between the last two saved rates. Positive pct = more GH₵ per
// USD = cedi weakened.
function afRateChange(history) {
  const h = history || [];
  if (h.length < 2) return null;
  const prev = h[h.length - 2], latest = h[h.length - 1];
  return { prev, latest, pct: afRound((latest.rate - prev.rate) / prev.rate * 100) };
}

// One value point per day per investment: a same-date save replaces that
// day's point (so editing twice in a day doesn't stack). Returns a new
// date-sorted array; never mutates the input.
function afValHistoryAppend(history, date, current) {
  const out = (history || []).filter(p => p.date !== date);
  out.push({ date, current: afRound(current) });
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// Change between the first tracked value and the latest.
function afValChange(history) {
  const h = history || [];
  if (h.length < 2) return null;
  const first = h[0], latest = h[h.length - 1];
  const abs = afRound(latest.current - first.current);
  return { first, latest, abs, pct: first.current > 0 ? afRound(abs / first.current * 100) : null, points: h.length };
}

// Every tracked value with its step-by-step change from the previous point —
// what the per-investment history list renders. First point has no previous.
function afValSeries(history) {
  const h = history || [];
  return h.map((p, i) => {
    if (i === 0) return { date: p.date, current: p.current, delta: null, pct: null };
    const prev = h[i - 1];
    const delta = afRound(p.current - prev.current);
    return { date: p.date, current: p.current, delta,
             pct: prev.current > 0 ? afRound(delta / prev.current * 100) : null };
  });
}

// Summary analysis of a value history: overall change plus the best and
// worst single update. `changes` counts only steps where the value actually
// moved — re-saving the same value is a check-in, not a price change.
// null until there are 2+ points.
function afValStats(history) {
  const change = afValChange(history);
  if (!change) return null;
  const steps = afValSeries(history).filter(p => p.delta !== null);
  let best = steps[0], worst = steps[0];
  steps.forEach(p => {
    if (p.delta > best.delta) best = p;
    if (p.delta < worst.delta) worst = p;
  });
  return { change, best, worst, steps: steps.length,
           changes: steps.filter(p => p.delta !== 0).length };
}

// Normalise one stored investment: guarantee a valid value history, seeding it
// from the current value on first upgrade so older data isn't lost.
function afSanitizeInv(inv) {
  const i = inv && typeof inv === 'object' ? inv : {};
  let hist = Array.isArray(i.history)
    ? i.history.filter(p => p && typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date)
        && typeof p.current === 'number' && isFinite(p.current))
    : [];
  hist.sort((a, b) => a.date.localeCompare(b.date));
  const seedDate = (typeof i.updated === 'string' && i.updated) ? i.updated
                 : (typeof i.date === 'string' && i.date) ? i.date : '';
  if (!hist.length && seedDate && typeof i.current === 'number' && isFinite(i.current)) {
    hist = [{ date: seedDate, current: afRound(i.current) }];
  }
  return Object.assign({}, i, { history: hist });
}

function afFmtMoney(n, currency) {
  const v = isFinite(n) ? n : 0;
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? '-' : '') + (currency === 'GHS' ? 'GH₵ ' + abs : '$' + abs);
}

/* ── Data layer + renderers (browser only — app.js globals allowed) ── */

const AF_KEY = 'moneytrack_africa';   // must equal KEY_AFRICA in app.js

function afLoad() {
  let d = null;
  try { d = _safeParseJSON(localStorage.getItem(AF_KEY), null); }
  catch (e) { console.error('[storage] Parse failed: africa', e); }
  if (!d || typeof d !== 'object') d = {};
  return {
    rate: (typeof d.rate === 'number' && isFinite(d.rate) && d.rate > 0) ? d.rate : null,
    rateUpdated: typeof d.rateUpdated === 'string' ? d.rateUpdated : '',
    rateHistory: Array.isArray(d.rateHistory)
      ? d.rateHistory.filter(p => p && typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date)
          && typeof p.rate === 'number' && isFinite(p.rate) && p.rate > 0)
      : [],
    investments: (Array.isArray(d.investments) ? d.investments : []).map(afSanitizeInv),
  };
}

function afSave(data) { _safeSave(AF_KEY, data); queueDriveSync(); }

let afEditId = null;               // investment id currently open in the form
const afHistOpen = new Set();      // investment ids with the price history expanded

function bindAfricaTab() {
  const sec = document.getElementById('sec-africa');
  if (!sec || sec._afBound) return;
  sec._afBound = true;
  sec.addEventListener('click', e => {
    const t = e.target;
    if (t.id === 'af-add')         { afEditId = null; afShowForm(); return; }
    if (t.id === 'af-form-cancel') { afHideForm(); return; }
    if (t.id === 'af-form-save')   { afSubmitForm(); return; }
    if (t.id === 'af-rate-save')   { afSaveRate(); return; }
    const edit = t.closest('[data-af-edit]');
    if (edit) { afEditId = edit.dataset.afEdit; afShowForm(); return; }
    const del = t.closest('[data-af-del]');
    if (del) { afDelete(del.dataset.afDel); return; }
    const hist = t.closest('[data-af-hist]');
    if (hist) {
      const id = hist.dataset.afHist;
      afHistOpen.has(id) ? afHistOpen.delete(id) : afHistOpen.add(id);
      renderAfricaTab();
      return;
    }
    const val = t.closest('[data-af-valsave]');
    if (val) afQuickUpdate(val.dataset.afValsave);
  });
  // Keyboard toggle for the role=button history note (Enter / Space)
  sec.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const hist = e.target.closest?.('[data-af-hist][role="button"]');
    if (!hist) return;
    e.preventDefault();
    const id = hist.dataset.afHist;
    afHistOpen.has(id) ? afHistOpen.delete(id) : afHistOpen.add(id);
    renderAfricaTab();
  });
}

function renderAfricaTab() {
  bindAfricaTab();
  const data = afLoad();
  renderAfSummary(data);
  renderAfRateTrend(data);
  renderAfList(data);
}

function afGainHTML(gain, pct, currency) {
  const cls = gain >= 0 ? 'af-gain' : 'af-loss';
  const arrow = gain >= 0 ? '▲' : '▼';
  const pctTxt = pct === null ? '' : ' (' + Math.abs(pct).toFixed(1) + '%)';
  return '<span class="' + cls + '">' + arrow + ' ' +
    afFmtMoney(Math.abs(gain), currency) + pctTxt + '</span>';
}

function renderAfSummary(data) {
  const el = document.getElementById('af-summary');
  if (!el) return;
  const t = afTotals(data.investments);
  let html = '';
  ['GHS', 'USD'].forEach(cur => {
    const tot = t.byCurrency[cur];
    if (tot.invested === 0 && tot.current === 0) return;
    html += '<div class="af-sumline"><b>' + afFmtMoney(tot.invested, cur) +
      '</b> invested → <b>' + afFmtMoney(tot.current, cur) + '</b> now · ' +
      afGainHTML(tot.gain, afGainPct(tot.invested, tot.gain), cur) + '</div>';
  });
  if (!html) html = '<p class="wl-sub">No investments yet — add your first below.</p>';
  if (data.investments.length) {
    const est = afUsdEstimate(t.byCurrency, data.rate);
    html += est === null
      ? '<p class="wl-sub">Set a rate below to see the USD estimate.</p>'
      : '<div class="af-est">≈ <b>' + fmt(est) + '</b> total at GH₵' + data.rate + '/$</div>';
  }
  html += '<div class="flex gap-8 mt-12" style="align-items:center;flex-wrap:wrap">' +
    '<label class="acct-label" for="af-rate" style="margin:0">1 USD =</label>' +
    '<input type="number" id="af-rate" class="acct-input af-val-input" min="0" step="0.01" ' +
    'value="' + (data.rate ?? '') + '" placeholder="15.50"> GHS ' +
    '<button class="btn btn-ghost btn-sm" id="af-rate-save">Save rate</button>' +
    (data.rateUpdated ? '<span class="af-meta" style="flex-basis:auto">rate saved ' +
      fmtDate(data.rateUpdated) + afRateNote(data.rateHistory) + '</span>' : '') +
    '</div>' +
    '<svg id="af-rate-trend" viewBox="0 0 620 150" ' +
    'style="width:100%;height:auto;display:block;margin-top:10px" aria-hidden="true"></svg>';
  el.innerHTML = html;
}

function afRateNote(history) {
  const chg = afRateChange(history);
  if (!chg) return '';
  if (chg.pct === 0) return ' · unchanged since ' + fmtDate(chg.prev.date);
  return ' · was ' + chg.prev.rate + ' on ' + fmtDate(chg.prev.date) + ' — cedi ' +
    (chg.pct > 0 ? 'weakened ' : 'strengthened ') + Math.abs(chg.pct).toFixed(1) + '%';
}

// Rate trend: line through every saved point; hidden until 2+ points.
function renderAfRateTrend(data) {
  const svg = document.getElementById('af-rate-trend');
  if (!svg) return;
  const h = data.rateHistory;
  if (h.length < 2) { svg.innerHTML = ''; return; }
  const W = 620, H = 150, L = 46, R = 12, T = 12, B = 22;
  const rates = h.map(p => p.rate);
  const min = Math.min(...rates), max = Math.max(...rates);
  const pad = (max - min) * 0.15 || max * 0.05 || 1;
  const lo = min - pad, hi = max + pad;
  const X = i => L + (i / (h.length - 1)) * (W - L - R);
  const Y = v => H - B - ((v - lo) / (hi - lo)) * (H - T - B);
  let g = '';
  for (let i = 0; i <= 2; i++) {
    const v = lo + (hi - lo) * i / 2, y = Y(v);
    g += '<line x1="' + L + '" y1="' + y.toFixed(1) + '" x2="' + (W - R) + '" y2="' + y.toFixed(1) +
      '" stroke="currentColor" opacity="0.12"/>';
    g += '<text x="' + (L - 6) + '" y="' + (y + 3.5).toFixed(1) + '" fill="currentColor" opacity="0.55" ' +
      'font-size="9" text-anchor="end">' + v.toFixed(2) + '</text>';
  }
  let d = '';
  h.forEach((p, i) => { d += (i ? ' L' : 'M') + X(i).toFixed(1) + ',' + Y(p.rate).toFixed(1); });
  g += '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="2" opacity="0.8"/>';
  const li = h.length - 1;
  g += '<circle cx="' + X(li).toFixed(1) + '" cy="' + Y(h[li].rate).toFixed(1) + '" r="3.5" fill="currentColor"/>';
  g += '<text x="' + L + '" y="' + (H - 6) + '" fill="currentColor" opacity="0.55" font-size="9">' +
    fmtDate(h[0].date) + '</text>';
  g += '<text x="' + (W - R) + '" y="' + (H - 6) + '" fill="currentColor" opacity="0.55" font-size="9" ' +
    'text-anchor="end">' + fmtDate(h[li].date) + '</text>';
  svg.innerHTML = g;
}

function renderAfList(data) {
  const el = document.getElementById('af-list');
  if (!el) return;
  if (!data.investments.length) {
    el.innerHTML = '<p class="wl-sub">Track IPOs and investments held in Ghana or ' +
      'Nigeria — amounts stay in their own currency.</p>';
    return;
  }
  const t = afTotals(data.investments);
  let html = '';
  AF_COUNTRIES.forEach(country => {
    const invs = data.investments.filter(i => i.country === country);
    if (!invs.length) return;
    const ct = t.byCountry[country];
    const subs = ['GHS', 'USD']
      .filter(c => ct[c].invested !== 0 || ct[c].current !== 0)
      .map(c => afFmtMoney(ct[c].current, c)).join(' · ');
    html += '<div class="af-country">' + escapeHTML(country) + ' — ' + subs + '</div>';
    invs.forEach(inv => {
      const gain = afRound((Number(inv.current) || 0) - (Number(inv.invested) || 0));
      const pct = afGainPct(inv.invested, gain);
      html += '<div class="af-item">' +
        '<span class="af-name">' + escapeHTML(inv.name) + '</span>' +
        '<span>' + afFmtMoney(inv.invested, inv.currency) + ' → <b>' +
          afFmtMoney(inv.current, inv.currency) + '</b></span>' +
        afGainHTML(gain, pct, inv.currency) +
        '<span class="af-row-actions">' +
        '<input type="number" class="acct-input af-val-input" min="0" step="0.01" ' +
          'data-af-val="' + escapeHTML(inv.id) + '" placeholder="' + (Number(inv.current) || 0) + '" ' +
          'aria-label="New value for ' + escapeHTML(inv.name) + '">' +
        '<button class="txn-btn" data-af-valsave="' + escapeHTML(inv.id) +
          '" aria-label="Save new value for ' + escapeHTML(inv.name) + '">✓</button>' +
        ((inv.history || []).length >= 2
          ? '<button class="txn-btn" data-af-hist="' + escapeHTML(inv.id) +
            '" aria-label="Price history for ' + escapeHTML(inv.name) +
            '" aria-expanded="' + (afHistOpen.has(inv.id) ? 'true' : 'false') + '">📈</button>'
          : '') +
        '<button class="txn-btn" data-af-edit="' + escapeHTML(inv.id) +
          '" aria-label="Edit ' + escapeHTML(inv.name) + '">✎</button>' +
        '<button class="txn-btn del" data-af-del="' + escapeHTML(inv.id) +
          '" aria-label="Delete ' + escapeHTML(inv.name) + '">✕</button>' +
        '</span>' +
        '<span class="af-meta">since ' + fmtDate(inv.date) +
          (inv.updated ? ' · updated ' + fmtDate(inv.updated) : '') +
          afInvHistNote(inv) +
          (inv.note ? ' · ' + escapeHTML(inv.note) : '') + '</span>' +
        (afHistOpen.has(inv.id) ? afHistBlockHTML(inv) : '') +
        '</div>';
    });
  });
  el.innerHTML = html;
}

// Expanded per-investment block: value trend chart + analysis line +
// newest-first list of every saved value with its change from the previous.
function afHistBlockHTML(inv) {
  const series = afValSeries(inv.history);
  const stats = afValStats(inv.history);
  let analysis = '';
  if (stats) {
    const c = stats.change;
    analysis = '<div class="af-hist-analysis">Since start: ' +
      afGainHTML(c.abs, c.pct, inv.currency) +
      ' · ' + stats.changes + ' price change' + (stats.changes === 1 ? '' : 's') +
      ' in ' + stats.steps + ' update' + (stats.steps === 1 ? '' : 's');
    if (stats.steps >= 2) {
      analysis += ' · best update: ' + afGainHTML(stats.best.delta, stats.best.pct, inv.currency) +
        ' <span class="af-meta" style="flex-basis:auto">' + fmtDate(stats.best.date) + '</span>' +
        ' · worst: ' + afGainHTML(stats.worst.delta, stats.worst.pct, inv.currency) +
        ' <span class="af-meta" style="flex-basis:auto">' + fmtDate(stats.worst.date) + '</span>';
    }
    analysis += '</div>';
  }
  let rows = '';
  for (let i = series.length - 1; i >= 0; i--) {
    const p = series[i];
    let chg;
    if (p.delta === null) chg = '<span class="af-meta" style="flex-basis:auto">start</span>';
    else {
      const cls = p.delta >= 0 ? 'af-gain' : 'af-loss';
      const arrow = p.delta > 0 ? '▲' : p.delta < 0 ? '▼' : '·';
      const pctTxt = p.pct === null ? '' : ' (' + (p.pct >= 0 ? '+' : '') + p.pct.toFixed(1) + '%)';
      chg = '<span class="' + cls + '">' + arrow + ' ' + afFmtMoney(Math.abs(p.delta), inv.currency) + pctTxt + '</span>';
    }
    rows += '<div class="af-hist-row"><span>' + fmtDate(p.date) + '</span><b>' +
      afFmtMoney(p.current, inv.currency) + '</b>' + chg + '</div>';
  }
  return '<div class="af-hist">' + afValTrendSVG(inv.history) + analysis + rows + '</div>';
}

// Value trend chart for one investment — same shape as the rate trend.
function afValTrendSVG(history) {
  const h = history || [];
  if (h.length < 2) return '';
  const W = 620, H = 150, L = 56, R = 12, T = 12, B = 22;
  const vals = h.map(p => p.current);
  const min = Math.min(...vals), max = Math.max(...vals);
  const pad = (max - min) * 0.15 || max * 0.05 || 1;
  const lo = min - pad, hi = max + pad;
  const X = i => L + (i / (h.length - 1)) * (W - L - R);
  const Y = v => H - B - ((v - lo) / (hi - lo)) * (H - T - B);
  let g = '';
  for (let i = 0; i <= 2; i++) {
    const v = lo + (hi - lo) * i / 2, y = Y(v);
    g += '<line x1="' + L + '" y1="' + y.toFixed(1) + '" x2="' + (W - R) + '" y2="' + y.toFixed(1) +
      '" stroke="currentColor" opacity="0.12"/>';
    g += '<text x="' + (L - 6) + '" y="' + (y + 3.5).toFixed(1) + '" fill="currentColor" opacity="0.55" ' +
      'font-size="9" text-anchor="end">' + v.toFixed(2) + '</text>';
  }
  let d = '';
  h.forEach((p, i) => { d += (i ? ' L' : 'M') + X(i).toFixed(1) + ',' + Y(p.current).toFixed(1); });
  g += '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="2" opacity="0.8"/>';
  const li = h.length - 1;
  g += '<circle cx="' + X(li).toFixed(1) + '" cy="' + Y(h[li].current).toFixed(1) + '" r="3.5" fill="currentColor"/>';
  g += '<text x="' + L + '" y="' + (H - 6) + '" fill="currentColor" opacity="0.55" font-size="9">' +
    fmtDate(h[0].date) + '</text>';
  g += '<text x="' + (W - R) + '" y="' + (H - 6) + '" fill="currentColor" opacity="0.55" font-size="9" ' +
    'text-anchor="end">' + fmtDate(h[li].date) + '</text>';
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="af-hist-chart" aria-hidden="true">' + g + '</svg>';
}

// compact "N updates ▲GH₵X (+Y%) since start" note from the tracked history —
// clickable: opens the same chart + analysis block as the 📈 button.
function afInvHistNote(inv) {
  const chg = afValChange(inv && inv.history);
  if (!chg) return '';
  const arrow = chg.abs > 0 ? '▲' : chg.abs < 0 ? '▼' : '·';
  const pct = chg.pct === null ? '' : ' (' + (chg.pct >= 0 ? '+' : '') + chg.pct + '%)';
  return ' · <span class="af-hist-link" role="button" tabindex="0" data-af-hist="' + escapeHTML(inv.id) +
    '" aria-expanded="' + (afHistOpen.has(inv.id) ? 'true' : 'false') +
    '" aria-label="Show price history chart for ' + escapeHTML(inv.name) + '">' +
    chg.points + ' update' + (chg.points === 1 ? '' : 's') + ' ' +
    arrow + ' ' + afFmtMoney(Math.abs(chg.abs), inv.currency) + pct + ' since start</span>';
}

function afShowForm() {
  const el = document.getElementById('af-form');
  if (!el) return;
  const inv = afEditId ? afLoad().investments.find(i => i.id === afEditId) : null;
  el.innerHTML = '<div class="add-acct-form"><div class="form-grid">' +
    '<div class="form-group"><label for="af-name">Name</label>' +
    '<input type="text" id="af-name" class="acct-input" maxlength="60" ' +
      'placeholder="e.g. MTN Ghana IPO" value="' + (inv ? escapeHTML(inv.name) : '') + '"></div>' +
    '<div class="form-group"><label for="af-country">Country</label>' +
    '<select id="af-country" class="acct-input">' +
      AF_COUNTRIES.map(c => '<option' + (inv && inv.country === c ? ' selected' : '') +
        '>' + c + '</option>').join('') + '</select></div>' +
    '<div class="form-group"><label for="af-currency">Currency</label>' +
    '<select id="af-currency" class="acct-input">' +
      '<option value="GHS"' + (inv && inv.currency === 'GHS' ? ' selected' : '') + '>GH₵ (cedis)</option>' +
      '<option value="USD"' + (inv && inv.currency === 'USD' ? ' selected' : '') + '>$ (dollars)</option>' +
    '</select></div>' +
    '<div class="form-group"><label for="af-invested">Amount invested</label>' +
    '<input type="number" id="af-invested" class="acct-input" min="0" step="0.01" ' +
      'value="' + (inv ? Number(inv.invested) || 0 : '') + '"></div>' +
    '<div class="form-group"><label for="af-current">Current value</label>' +
    '<input type="number" id="af-current" class="acct-input" min="0" step="0.01" ' +
      'value="' + (inv ? Number(inv.current) || 0 : '') + '" placeholder="defaults to invested"></div>' +
    '<div class="form-group"><label for="af-date">Date invested</label>' +
    '<input type="date" id="af-date" class="acct-input" value="' +
      (inv ? escapeHTML(inv.date) : todayISO()) + '"></div>' +
    '<div class="form-group"><label for="af-note">Note (optional)</label>' +
    '<input type="text" id="af-note" class="acct-input" maxlength="120" value="' +
      (inv && inv.note ? escapeHTML(inv.note) : '') + '"></div>' +
    '</div><div class="flex gap-8 mt-12">' +
    '<button class="btn btn-green" id="af-form-save">' +
      (inv ? 'Save changes' : 'Add investment') + '</button>' +
    '<button class="btn btn-ghost btn-sm" id="af-form-cancel">Cancel</button>' +
    '</div></div>';
  el.style.display = '';
  document.getElementById('af-name')?.focus();
}

function afHideForm() {
  const el = document.getElementById('af-form');
  if (el) { el.innerHTML = ''; el.style.display = 'none'; }
  afEditId = null;
}

function afSubmitForm() {
  const name = (document.getElementById('af-name')?.value || '').trim();
  const country = document.getElementById('af-country')?.value || 'Ghana';
  const currency = document.getElementById('af-currency')?.value === 'USD' ? 'USD' : 'GHS';
  const invested = parseFloat(document.getElementById('af-invested')?.value);
  const currentRaw = document.getElementById('af-current')?.value ?? '';
  const current = currentRaw === '' ? invested : parseFloat(currentRaw);
  const date = document.getElementById('af-date')?.value || todayISO();
  const note = (document.getElementById('af-note')?.value || '').trim();
  if (!name) { alert('Please enter a name.'); return; }
  if (!(invested > 0)) { alert('Amount invested must be greater than 0.'); return; }
  if (!(current >= 0)) { alert('Current value must be 0 or more.'); return; }
  const data = afLoad();
  if (afEditId) {
    const inv = data.investments.find(i => i.id === afEditId);
    if (inv) {
      if (roundMoney(current) !== inv.current) {
        inv.updated = todayISO();
        inv.history = afValHistoryAppend(inv.history, todayISO(), roundMoney(current));
      }
      inv.name = name; inv.country = country; inv.currency = currency;
      inv.invested = roundMoney(invested); inv.current = roundMoney(current);
      inv.date = date; inv.note = note;
    }
  } else {
    data.investments.push({
      id: crypto.randomUUID(), name, country, currency,
      invested: roundMoney(invested), current: roundMoney(current),
      date, updated: todayISO(), note,
      history: afValHistoryAppend([], todayISO(), roundMoney(current)),
    });
  }
  afSave(data);
  afHideForm();
  renderAfricaTab();
  renderAccountKPIs();
}

function afSaveRate() {
  const v = parseFloat(document.getElementById('af-rate')?.value);
  if (!(v > 0)) { alert('Rate must be a positive number (GH₵ per 1 USD).'); return; }
  const data = afLoad();
  // Seed the pre-history rate once so the upgrade loses nothing
  if (!data.rateHistory.length && data.rate !== null && data.rateUpdated) {
    data.rateHistory = afRateHistoryAppend(data.rateHistory, data.rateUpdated, data.rate);
  }
  data.rate = roundMoney(v);
  data.rateUpdated = todayISO();
  data.rateHistory = afRateHistoryAppend(data.rateHistory, data.rateUpdated, data.rate);
  afSave(data);
  renderAfricaTab();
  renderAccountKPIs();
}

function afQuickUpdate(id) {
  const inp = document.querySelector('[data-af-val="' + CSS.escape(id) + '"]');
  const v = parseFloat(inp?.value);
  if (!(v >= 0)) { alert('Enter the new current value first.'); return; }
  const data = afLoad();
  const inv = data.investments.find(i => i.id === id);
  if (!inv) return;
  const v2 = roundMoney(v);
  // Same value as current: nothing changed — don't record a fake update
  // (same guard as the edit form).
  if (v2 === inv.current) { renderAfricaTab(); return; }
  inv.current = v2;
  inv.updated = todayISO();
  inv.history = afValHistoryAppend(inv.history, todayISO(), v2);
  afSave(data);
  renderAfricaTab();
  renderAccountKPIs();
}

function afDelete(id) {
  const data = afLoad();
  const inv = data.investments.find(i => i.id === id);
  if (!inv) return;
  if (!confirm('Delete "' + inv.name + '"? This cannot be undone.')) return;
  data.investments = data.investments.filter(i => i.id !== id);
  afSave(data);
  renderAfricaTab();
  renderAccountKPIs();
}
