# Africa Investments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A sixth "Africa" tab tracking Ghana/Nigeria investments in their own currency (GH₵ or $) with invested-vs-current gain/loss, a manual GH₵-per-$ rate powering estimate lines, and "Africa (est.)" + "Global Total" KPIs on the Accounts tab — without touching Net Worth math, snapshots, or exports.

**Architecture:** Standalone module `js/africa.js` mirroring the wealth.js contract: pure DOM-free math at the top (unit-tested via `node --test`), data layer + renderers below (browser only, app.js globals allowed). Own localStorage key, added to app.js `BACKUP_KEYS`. Spec: `docs/superpowers/specs/2026-07-25-africa-investments-design.md`.

**Tech Stack:** Vanilla JS (no build tooling, no dependencies), localStorage, node:test + vm.runInThisContext harness.

## Global Constraints

- Run tests as `node --test` from the repo root — the `node --test tests/` dir-arg form is broken on this host (Windows/Node v24).
- Top-level code in `js/africa.js` must stay DOM-free and app.js-free (functions may reference browser/app.js globals inside their bodies only).
- All user-controlled strings rendered into HTML go through `escapeHTML()`.
- No new hex colors in JS — use existing CSS tokens (`var(--green)`, `var(--red)`, `var(--gold)`, `var(--muted)`).
- Money values pass through `roundMoney()` (app.js) or `afRound()` (africa.js) before saving.
- Dates are ISO `YYYY-MM-DD`; use `todayISO()`; format with `fmtDate()`.
- Amounts are stored in their own currency (`GHS` or `USD`) and never converted at rest; the manual rate (GH₵ per 1 USD) is used only for estimate lines.
- IDs use `crypto.randomUUID()`.
- Never start implementation on master — work on branch `feature/africa-investments`.

---

### Task 1: Pure math in js/africa.js + unit tests (TDD)

**Files:**
- Create: `js/africa.js` (pure section only)
- Create: `tests/africa.test.mjs`

**Interfaces:**
- Produces: `afRound(n)`, `afTotals(investments) → {byCurrency:{GHS:{invested,current,gain},USD:{…}}, byCountry:{[country]:{GHS:{…},USD:{…}}}}`, `afUsdEstimate(byCurrency, rate) → number|null`, `afGainPct(invested, gain) → number|null`, `afFmtMoney(n, 'GHS'|'USD') → string`, `const AF_COUNTRIES = ['Ghana','Nigeria','Other']`. Tasks 3–4 call these exact names.

- [ ] **Step 1: Write the failing tests** — create `tests/africa.test.mjs`:

```js
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
```

- [ ] **Step 2: Run tests, watch them fail** — `node --test` from repo root. Expected: the 6 new tests FAIL with `Cannot read properties of undefined` / `ENOENT` for `js/africa.js` (file missing). The existing 17 wealth/app tests still pass.

- [ ] **Step 3: Create `js/africa.js` with the pure section:**

```js
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
```

- [ ] **Step 4: Run tests, watch them pass** — `node --test` from repo root. Expected: 23 pass, 0 fail. Also `node --check js/africa.js`.

- [ ] **Step 5: Commit**

```bash
git add js/africa.js tests/africa.test.mjs
git commit -m "feat(africa): pure totals, USD estimate, gain and money formatting"
```

---

### Task 2: Tab markup, script include, app.js plumbing, CSS

**Files:**
- Modify: `index.html:65-68` (tab button), `index.html:689-695` (section + script tag)
- Modify: `js/app.js:492` (KEY_AFRICA), `js/app.js:3001-3006` (BACKUP_KEYS), `js/app.js:3520-3543` (TABS + switchTab)
- Modify: `css/styles.css` (append Africa block at end)

**Interfaces:**
- Consumes: nothing from Task 1 (markup/plumbing only).
- Produces: DOM ids `sec-africa`, `tab-africa`, `af-summary`, `af-form`, `af-list`, `af-add`; global `KEY_AFRICA = 'moneytrack_africa'`; switchTab calls `renderAfricaTab()` (defined in Task 3 — until then, clicking the tab throws in console; acceptable mid-branch, fixed by Task 3).

- [ ] **Step 1: index.html — add the tab button** after the Wealth button (line 65-68 block), inside the tablist:

```html
      <button role="tab" id="tab-africa" aria-selected="false"
              aria-controls="sec-africa" tabindex="-1">
        Africa
      </button>
```

- [ ] **Step 2: index.html — add the section** after `</section>` of `sec-wealth` (line 690), before `</main>`:

```html
    <!-- ══ AFRICA TAB ═══════════════════════════════════════════ -->
    <section id="sec-africa" role="tabpanel"
             aria-labelledby="tab-africa" class="sec">
      <h2>Africa Investments</h2>
      <p class="section-sub">Ghana &amp; Nigeria holdings — tracked in their own
        currency, never mixed into US Net Worth.</p>

      <div class="card" id="af-summary" aria-live="polite"><!-- Rendered by JS --></div>

      <div class="card">
        <div class="flex gap-8" style="justify-content:space-between;align-items:center">
          <h3 style="margin:0">Investments</h3>
          <button class="btn btn-green btn-sm" id="af-add">+ Add investment</button>
        </div>
        <div id="af-form" style="display:none"></div>
        <div id="af-list" aria-live="polite"><!-- Rendered by JS --></div>
      </div>
    </section>
```

- [ ] **Step 3: index.html — add the script tag** after the wealth.js include (line 695):

```html
  <script src="js/africa.js" defer></script>
```

- [ ] **Step 4: app.js — storage key.** After `const KEY_THINGS_CATS    = 'moneytrack_things_cats';` (line 492) add:

```js
const KEY_AFRICA         = 'moneytrack_africa';
```

- [ ] **Step 5: app.js — backups.** In `BACKUP_KEYS` (line 3001-3006) append `KEY_AFRICA`:

```js
const BACKUP_KEYS = [
  KEY_SNAPSHOTS, KEY_TXNS, KEY_BUDGETS,
  KEY_DEBT_META, KEY_LOANS, KEY_ACCOUNTS, KEY_THEME,
  KEY_BILLS, KEY_GOALS,
  KEY_THINGS_ITEMS, KEY_THINGS_ENTRIES, KEY_THINGS_CATS,
  KEY_AFRICA,
];
```

- [ ] **Step 6: app.js — tab wiring.** In `TABS` (line 3520) add the entry, and in `switchTab` add the render hook:

```js
const TABS = [
  { tabId: 'tab-accounts', secId: 'sec-accounts' },
  { tabId: 'tab-tracker',  secId: 'sec-tracker'  },
  { tabId: 'tab-analysis', secId: 'sec-analysis' },
  { tabId: 'tab-things',   secId: 'sec-things'   },
  { tabId: 'tab-wealth',   secId: 'sec-wealth'   },
  { tabId: 'tab-africa',   secId: 'sec-africa'   },
];
```

```js
  if (targetTabId === 'tab-wealth')   renderWealthTab();
  if (targetTabId === 'tab-africa')   renderAfricaTab();
```

- [ ] **Step 7: styles.css — append at end of file:**

```css
/* ── Africa tab ─────────────────────────────────────────────── */
.af-sumline { margin: 4px 0; }
.af-est { margin-top: 8px; font-size: 15px; }
.af-country { margin: 14px 0 4px; font-size: 12px; font-weight: 600;
  color: var(--muted); text-transform: uppercase; letter-spacing: .4px; }
.af-item { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center;
  padding: 10px 0; border-bottom: 1px solid var(--surf2); }
.af-item:last-child { border-bottom: none; }
.af-name { font-weight: 600; }
.af-meta { font-size: 12px; color: var(--muted); flex-basis: 100%; }
.af-gain { color: var(--green); }
.af-loss { color: var(--red); }
.af-val-input { width: 110px; }
.af-row-actions { margin-left: auto; display: flex; gap: 6px; align-items: center; }
```

- [ ] **Step 8: Verify** — `node --check js/app.js`; `node --test` still 23/23. Grep `id="af-` in index.html: exactly `af-summary`, `af-form`, `af-list`, `af-add` (plus `tab-africa`, `sec-africa`).

- [ ] **Step 9: Commit**

```bash
git add index.html js/app.js css/styles.css
git commit -m "feat(africa): tab shell, storage key in backups, tab wiring, styles"
```

---

### Task 3: Data layer + renderers in js/africa.js

**Files:**
- Modify: `js/africa.js` (append browser-only section)

**Interfaces:**
- Consumes: Task 1 pure functions; Task 2 DOM ids; app.js globals `_safeParseJSON`, `_safeSave`, `escapeHTML`, `roundMoney`, `todayISO`, `fmtDate`, `fmt`, `renderAccountKPIs`.
- Produces: `afLoad() → {rate: number|null, rateUpdated: string, investments: []}`, `afSave(data)`, `renderAfricaTab()` (called by switchTab and used by the harness). Task 4 calls `afLoad`, `afTotals`, `afUsdEstimate`.

- [ ] **Step 1: Append the browser section to js/africa.js:**

```js
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
          'data-af-val="' + escapeHTML(inv.id) + '" placeholder="' + inv.current + '" ' +
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
      'value="' + (inv ? inv.invested : '') + '"></div>' +
    '<div class="form-group"><label for="af-current">Current value</label>' +
    '<input type="number" id="af-current" class="acct-input" min="0" step="0.01" ' +
      'value="' + (inv ? inv.current : '') + '" placeholder="defaults to invested"></div>' +
    '<div class="form-group"><label for="af-date">Date invested</label>' +
    '<input type="date" id="af-date" class="acct-input" value="' +
      (inv ? inv.date : todayISO()) + '"></div>' +
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
```

- [ ] **Step 2: Verify** — `node --check js/africa.js`; `node --test` still 23/23 (browser section is function declarations only — nothing executes at top level).

- [ ] **Step 3: Commit**

```bash
git add js/africa.js
git commit -m "feat(africa): data layer, summary/rate/list renderers, add/edit/delete flows"
```

---

### Task 4: Accounts tab KPIs — Africa (est.) + Global Total

**Files:**
- Modify: `js/app.js:771-785` (`renderAccountKPIs` kpis array + template)

**Interfaces:**
- Consumes: `afLoad`, `afTotals`, `afUsdEstimate` from africa.js (script-load order guarantees availability; `typeof` guard for safety).
- Produces: two conditional KPI cards; `k.text` override in the KPI template.

- [ ] **Step 1: app.js — after the `const kpis = [...]` array (ends line 778), insert:**

```js
  if (typeof afLoad === 'function') {
    const af = afLoad();
    if (af.investments.length) {
      const est = afUsdEstimate(afTotals(af.investments).byCurrency, af.rate);
      kpis.push(est === null
        ? { label: 'Africa (est.)', value: 0, text: '—', color: 'var(--gold)',
            sub: 'set rate on Africa tab' }
        : { label: 'Africa (est.)', value: est, color: 'var(--gold)',
            sub: `at GH₵${af.rate}/$ · not in Net Worth` });
      if (est !== null) {
        kpis.push({ label: 'Global Total', value: roundMoney(net + est),
          color: net + est >= 0 ? 'var(--green)' : 'var(--red)',
          sub: 'US Net Worth + Africa est.' });
      }
    }
  }
```

- [ ] **Step 2: app.js — allow the text override in the template.** Change line 783 from

```js
      <div class="kpi-value" style="color:${k.color}">${fmt(k.value)}</div>
```

to

```js
      <div class="kpi-value" style="color:${k.color}">${k.text ?? fmt(k.value)}</div>
```

- [ ] **Step 3: Verify** — `node --check js/app.js`; `node --test` 23/23.

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat(africa): Africa (est.) and Global Total KPIs beside US Net Worth"
```

---

### Task 5: Cache bump + docs

**Files:**
- Modify: `sw.js:3-12` (CACHE_NAME + APP_SHELL)
- Modify: `CLAUDE.md` (file structure + conventions)

- [ ] **Step 1: sw.js** — change `const CACHE_NAME = 'moneytrack-v15';` to `'moneytrack-v16'` and add `'./js/africa.js',` to `APP_SHELL` after the wealth.js line.

- [ ] **Step 2: CLAUDE.md — file structure:** under `js/`, after the wealth.js line, add:

```
│   └── africa.js     # Africa tab — GHS/USD investments, manual FX rate, renderers
```

(adjust the tree characters so wealth.js becomes `├──`), and under `tests/` add `africa.test.mjs` beside `wealth.test.mjs`.

- [ ] **Step 3: CLAUDE.md — conventions.** After the "Single source of truth for plan numbers" section, add:

```
### Africa investments
The Africa tab (`js/africa.js`, storage key `moneytrack_africa`) tracks
Ghana/Nigeria investments in their own currency (GHS or USD) — amounts are
never converted at rest. One manual rate (GH₵ per 1 USD) powers the
estimate lines and the Accounts-tab "Africa (est.)" / "Global Total" KPIs;
Africa money never enters `calcNetWorth`, snapshots, the NW trend, or
CSV/PDF exports. Top-level africa.js code stays DOM-free so `node --test`
keeps working.
```

- [ ] **Step 4: Verify** — `node --check sw.js`; `node --test` 23/23.

- [ ] **Step 5: Commit**

```bash
git add sw.js CLAUDE.md
git commit -m "feat(africa): bump cache to v16 and document Africa conventions"
```

---

## Controller acceptance (after Task 5, not an implementer task)

1. `node --test` 23/23; `node --check` on app.js, wealth.js, africa.js, sw.js.
2. Headless render harness (scratchpad, fake DOM + `vm.runInThisContext`, load africa.js; stub `_safeParseJSON`/`_safeSave` over an in-memory store, `escapeHTML`/`roundMoney`/`todayISO`/`fmtDate`/`fmt` copied from app.js, `renderAccountKPIs` as spy, `confirm` stubbed true, `CSS.escape` identity, `crypto.randomUUID` counter): with fixture data verify summary lines incl. estimate at rate 15.5; "set a rate" line when rate null; country grouping + subtotals; add via form (store gains the investment, `updated` stamped); quick-update mutates `current` + `updated`; edit prefills and saves; delete removes; `sec-africa` click handler bound exactly once across repeated `renderAfricaTab()` calls; XSS probe (`name: '<img src=x>'`) renders escaped; id cross-check africa.js ↔ index.html; no duplicate ids in index.html.
3. Accounts KPI check in the same harness: with investments + rate → "Africa (est.)" and "Global Total" pushed; investments without rate → text `—` card only; no investments → neither.
4. Ship: present the finishing-a-development-branch menu (merge to master + push needs Richmond's choice).

## Out of scope

NGN, auto-FX fetch, folding Africa into Net Worth/trend/exports, linking Tracker transactions to investments, historical investment charts.
