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
    investments: Array.isArray(d.investments) ? d.investments : [],
  };
}

function afSave(data) { _safeSave(AF_KEY, data); }

let afEditId = null;   // investment id currently open in the form

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
    const val = t.closest('[data-af-valsave]');
    if (val) afQuickUpdate(val.dataset.afValsave);
  });
}

function renderAfricaTab() {
  bindAfricaTab();
  const data = afLoad();
  renderAfSummary(data);
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
      fmtDate(data.rateUpdated) + '</span>' : '') +
    '</div>';
  el.innerHTML = html;
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
        '<button class="txn-btn" data-af-edit="' + escapeHTML(inv.id) +
          '" aria-label="Edit ' + escapeHTML(inv.name) + '">✎</button>' +
        '<button class="txn-btn del" data-af-del="' + escapeHTML(inv.id) +
          '" aria-label="Delete ' + escapeHTML(inv.name) + '">✕</button>' +
        '</span>' +
        '<span class="af-meta">since ' + fmtDate(inv.date) +
          (inv.updated ? ' · updated ' + fmtDate(inv.updated) : '') +
          (inv.note ? ' · ' + escapeHTML(inv.note) : '') + '</span>' +
        '</div>';
    });
  });
  el.innerHTML = html;
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
      if (roundMoney(current) !== inv.current) inv.updated = todayISO();
      inv.name = name; inv.country = country; inv.currency = currency;
      inv.invested = roundMoney(invested); inv.current = roundMoney(current);
      inv.date = date; inv.note = note;
    }
  } else {
    data.investments.push({
      id: crypto.randomUUID(), name, country, currency,
      invested: roundMoney(invested), current: roundMoney(current),
      date, updated: todayISO(), note,
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
  data.rate = roundMoney(v);
  data.rateUpdated = todayISO();
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
  inv.current = roundMoney(v);
  inv.updated = todayISO();
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
