'use strict';

/* ═══════════════════════════════════════════════════════════════
   MoneyTrack — app.js
   Personal account balance + transaction tracker
   Active from: today (no activation gate)
═══════════════════════════════════════════════════════════════ */

// ─── Config ─────────────────────────────────────────────────────
const DEFAULT_ACCOUNTS = [
  { id: 'chase_checking', label: 'Chase Checking',  group: 'checking', color: '#60a5fa' },
  { id: 'usf_checking',   label: 'USF Checking',    group: 'checking', color: '#2dd4bf' },
  { id: 'usf_savings_1',  label: 'USF Savings 1',   group: 'savings',  color: '#4ade80' },
  { id: 'usf_savings_2',  label: 'USF Savings 2',   group: 'savings',  color: '#86efac' },
  { id: 'usf_savings_3',  label: 'USF Savings 3',   group: 'savings',  color: '#a7f3d0' },
  { id: 'discover',       label: 'Discover (Owed)',  group: 'debt',       color: '#f87171' },
  { id: 'roth_ira',       label: 'Roth IRA',         group: 'investment', color: '#e879f9' },
  { id: 'k401',           label: '401(k)',            group: 'investment', color: '#f472b6' },
  { id: 'brokerage',      label: 'Brokerage',        group: 'investment', color: '#fb923c' },
  { id: 'coinbase',       label: 'Coinbase',         group: 'investment', color: '#f59e0b' },
  { id: 'webull',         label: 'Webull',           group: 'investment', color: '#3b82f6' },
  { id: 'robinhood',      label: 'Robinhood',        group: 'investment', color: '#22c55e' },
];

// Dynamic merged list — rebuilt by refreshAccountConfig() on init and after add/delete
let ACCOUNTS = [];
let ACCOUNT_LABELS = {};
let ACCOUNT_COLORS = {};

function refreshAccountConfig() {
  ACCOUNTS = [...DEFAULT_ACCOUNTS, ...loadCustomAccounts()];
  ACCOUNT_LABELS = Object.fromEntries(ACCOUNTS.map(a => [a.id, a.label]));
  ACCOUNT_COLORS = Object.fromEntries(ACCOUNTS.map(a => [a.id, a.color]));
}

const DEFAULT_THINGS_CATS = [
  'Groceries','Household','Personal Care','Fuel',
  'Subscriptions','Medicine','Electronics','Clothing','Food & Dining','Other'
];

const THINGS_UNIT_SUGGESTIONS = [
  'oz','fl oz','lbs','kg','g','ml','L','count','pack','roll','sheet',
  'tablet','capsule','gallon','bottle','can','box','bag','unit'
];

const CATEGORY_COLORS = {
  'Paycheck':        '#4ade80', 'Freelance':     '#4ade80', 'Transfer In': '#4ade80', 'Other Income': '#4ade80',
  'Rent':            '#f87171', 'Utilities':     '#fb923c', 'Insurance':   '#fb923c',
  'Groceries':       '#fbbf24', 'Dining Out':    '#fbbf24', 'Coffee':      '#fbbf24',
  'Gas':             '#60a5fa', 'Rideshare':     '#60a5fa', 'Car Insurance': '#60a5fa', 'Parking': '#60a5fa',
  'Medical':         '#f472b6', 'Pharmacy':      '#f472b6', 'Gym':         '#f472b6',
  'Clothing':        '#a78bfa', 'Electronics':   '#a78bfa', 'Amazon':      '#a78bfa',
  'Streaming':       '#2dd4bf', 'Events':        '#2dd4bf', 'Hobbies':     '#2dd4bf',
  'Tithe':           '#e879f9', 'Family Support':'#e879f9', 'Donations':   '#e879f9',
  'Savings Transfer':'#4ade80', 'Investment':    '#4ade80', 'Loan Payment':'#f87171',
  'Bank Fee':        '#f87171', 'Subscriptions': '#fb923c',
  'Education':       '#fbbf24', 'Personal Care': '#a78bfa', 'Miscellaneous':'#8a8aa6',
};

// ─── Google Drive Sync ───────────────────────────────────────────
const GDRIVE_CLIENT_ID    = '394124622094-3cj4ho2ipp3m6pm0un09tg9knelhfqtu.apps.googleusercontent.com';
const GDRIVE_SCOPE        = 'https://www.googleapis.com/auth/drive.file';
const GDRIVE_FILENAME     = 'MoneyTrack_Backup.json';
const KEY_GDRIVE_FILE     = 'moneytrack_gdrive_file_id';
const KEY_GDRIVE_CONNECTED = 'moneytrack_gdrive_ok';

let _gTokenClient  = null;
let _gAccessToken  = null;
let _gPendingOp    = null;
let _gIsAutoSync   = false;
let _driveSyncTimer = null;

function initGDrive() {
  if (!GDRIVE_CLIENT_ID || typeof google === 'undefined' || !google.accounts?.oauth2) return;
  if (_gTokenClient) return; // already initialised
  _gTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GDRIVE_CLIENT_ID,
    scope: GDRIVE_SCOPE,
    callback: resp => {
      if (resp.error) {
        if (!_gIsAutoSync) showToast('Google sign-in failed: ' + resp.error, 'error');
        _gIsAutoSync = false;
        _gPendingOp = null;
        return;
      }
      _gAccessToken = resp.access_token;
      _gIsAutoSync = false;
      if (_gPendingOp) { const op = _gPendingOp; _gPendingOp = null; op(); }
    },
  });
}

function gWithToken(op) {
  if (!GDRIVE_CLIENT_ID) {
    showToast('Google Drive is not configured.', 'error');
    return;
  }
  if (typeof google === 'undefined' || !google.accounts?.oauth2) {
    showToast('Google library not loaded — check your internet connection and reload the page.', 'error');
    return;
  }
  if (!_gTokenClient) initGDrive();
  if (_gAccessToken) { op(); }
  else { _gPendingOp = op; _gTokenClient.requestAccessToken({ prompt: '' }); }
}

async function _gFetch(url, options = {}) {
  const resp = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${_gAccessToken}`, ...(options.headers || {}) },
  });
  if (resp.status === 401) { _gAccessToken = null; throw { _gStatus: 401 }; }
  return resp;
}

async function _gFindFile() {
  const q = encodeURIComponent(`name='${GDRIVE_FILENAME}' and trashed=false`);
  const resp = await _gFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id)`);
  const data = await resp.json();
  return data.files?.[0]?.id || null;
}

async function _gCreateFile(content) {
  const meta = { name: GDRIVE_FILENAME, mimeType: 'application/json' };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  form.append('file',     new Blob([content],             { type: 'application/json' }));
  const resp = await _gFetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    { method: 'POST', body: form }
  );
  const data = await resp.json();
  if (!data.id) throw new Error('Drive create failed: ' + JSON.stringify(data));
  return data.id;
}

async function _gUpdateFile(fileId, content) {
  const resp = await _gFetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: content }
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Drive update failed (${resp.status}): ${text}`);
  }
}

function _gSetStatus(msg, isError) {
  const el = document.getElementById('gdrive-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? 'var(--red)' : 'var(--muted)';
}

function saveToDrive() {
  gWithToken(async () => {
    try {
      _gSetStatus('Saving…');
      const data = {};
      BACKUP_KEYS.forEach(k => { const v = localStorage.getItem(k); if (v !== null) data[k] = v; });
      const json = JSON.stringify({ _version: 1, _exported: todayISO(), data }, null, 2);

      let fileId = localStorage.getItem(KEY_GDRIVE_FILE);
      if (!fileId) {
        fileId = await _gFindFile();
        if (fileId) localStorage.setItem(KEY_GDRIVE_FILE, fileId);
      }

      if (fileId) {
        await _gUpdateFile(fileId, json);
      } else {
        fileId = await _gCreateFile(json);
        localStorage.setItem(KEY_GDRIVE_FILE, fileId);
      }
      localStorage.setItem(KEY_GDRIVE_CONNECTED, '1');
      _gSetStatus(`Saved ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      if (err._gStatus === 401) { saveToDrive(); return; }
      _gSetStatus('Save failed', true);
      console.error('[MoneyTrack Drive]', err);
      showToast('Save to Drive failed — check the console for details.', 'error');
    }
  });
}

function loadFromDrive() {
  gWithToken(async () => {
    try {
      _gSetStatus('Loading…');
      let fileId = localStorage.getItem(KEY_GDRIVE_FILE);
      if (!fileId) {
        fileId = await _gFindFile();
        if (!fileId) {
          _gSetStatus('');
          showToast('No MoneyTrack backup found in your Google Drive. Save from your PC first, then load on your phone.', 'info');
          return;
        }
        localStorage.setItem(KEY_GDRIVE_FILE, fileId);
      }

      const resp = await _gFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
      const parsed = await resp.json();

      if (!parsed.data || typeof parsed.data !== 'object') throw new Error('Invalid backup format');
      const valid = Object.keys(parsed.data).filter(k => BACKUP_KEYS.includes(k));
      if (!valid.length) throw new Error('No recognisable data found in file');
      _validateRestoreData(valid, parsed);

      if (!confirm(`Load backup from ${parsed._exported || 'Google Drive'}?\n\nThis will replace all current data on this device.`)) {
        _gSetStatus(''); return;
      }

      valid.forEach(k => localStorage.setItem(k, parsed.data[k]));
      localStorage.setItem(KEY_GDRIVE_CONNECTED, '1');
      initTheme();
      refreshAccountConfig();
      renderAccountFields();
      renderAccountsTab();
      populateAccountSelects();
      renderBudgetCard();
      renderTracker();
      _gSetStatus(`Loaded ${parsed._exported || ''}`);
    } catch (err) {
      if (err._gStatus === 401) { loadFromDrive(); return; }
      _gSetStatus('Load failed', true);
      console.error('[MoneyTrack Drive]', err);
      showToast('Load from Drive failed — check the console for details.', 'error');
    }
  });
}

// Silent auto-load on open — no confirm dialog, no alerts on failure
async function autoLoadFromDrive() {
  try {
    _gSetStatus('Syncing…');
    let fileId = localStorage.getItem(KEY_GDRIVE_FILE);
    if (!fileId) {
      fileId = await _gFindFile();
      if (!fileId) { _gSetStatus(''); return; }
      localStorage.setItem(KEY_GDRIVE_FILE, fileId);
    }

    const resp = await _gFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    const parsed = await resp.json();

    if (!parsed.data || typeof parsed.data !== 'object') { _gSetStatus(''); return; }
    const valid = Object.keys(parsed.data).filter(k => BACKUP_KEYS.includes(k));
    if (!valid.length) { _gSetStatus(''); return; }
    try { _validateRestoreData(valid, parsed); } catch { _gSetStatus(''); return; }

    valid.forEach(k => localStorage.setItem(k, parsed.data[k]));
    initTheme();
    refreshAccountConfig();
    renderAccountFields();
    renderAccountsTab();
    populateAccountSelects();
    renderBudgetCard();
    renderTracker();
    _gSetStatus(`Synced ${parsed._exported || ''}`);
  } catch (err) {
    if (err._gStatus === 401) { _gAccessToken = null; _gSetStatus(''); return; }
    _gSetStatus('');
    console.error('[MoneyTrack Drive auto-sync]', err);
  }
}

// Debounced auto-save — queued after every data write (fires 3 s after last change).
// Does NOT call saveToDrive/gWithToken — intentionally silent so a background save
// never triggers a Google auth popup.
function queueDriveSync() {
  if (!_gAccessToken) return;
  if (_driveSyncTimer) clearTimeout(_driveSyncTimer);
  _driveSyncTimer = setTimeout(async () => {
    _driveSyncTimer = null;
    if (!_gAccessToken) return;
    try {
      const data = {};
      BACKUP_KEYS.forEach(k => { const v = localStorage.getItem(k); if (v !== null) data[k] = v; });
      const json = JSON.stringify({ _version: 1, _exported: todayISO(), data }, null, 2);
      let fileId = localStorage.getItem(KEY_GDRIVE_FILE);
      if (!fileId) {
        fileId = await _gFindFile();
        if (fileId) localStorage.setItem(KEY_GDRIVE_FILE, fileId);
      }
      if (fileId) { await _gUpdateFile(fileId, json); }
      else { fileId = await _gCreateFile(json); localStorage.setItem(KEY_GDRIVE_FILE, fileId); }
      _gSetStatus(`Auto-saved ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      if (err._gStatus === 401) { _gAccessToken = null; } // clear stale token silently
      console.error('[MoneyTrack Drive auto-save]', err);
    }
  }, 3000);
}

// Called on init: if user has previously authorised Drive, silently refresh token and auto-load
function autoSyncDrive() {
  if (!localStorage.getItem(KEY_GDRIVE_CONNECTED)) return;
  function tryAuto() {
    if (typeof google === 'undefined' || !google.accounts?.oauth2) {
      setTimeout(tryAuto, 500); return;
    }
    if (!_gTokenClient) initGDrive();
    _gIsAutoSync = true;
    _gPendingOp = autoLoadFromDrive;
    _gTokenClient.requestAccessToken({ prompt: '' });
  }
  setTimeout(tryAuto, 800);
}

// ─── Auth ────────────────────────────────────────────────────────
// SHA-256 hash of the password — never store the plain password in source.
const AUTH_HASH   = '404c4a02b589a67a51a7ffde6e3937d2313a67d3a8e8da0b442289dfff782315';
const SESSION_KEY = 'moneytrack_auth';

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Rate-limiting (sessionStorage so it resets when the tab closes)
let _loginAttempts    = parseInt(sessionStorage.getItem('mt_login_attempts') || '0', 10);
let _loginLockoutUntil = parseInt(sessionStorage.getItem('mt_login_lockout') || '0', 10);
const LOGIN_MAX_ATTEMPTS  = 5;
const LOGIN_BASE_DELAY_MS = 1000;

// ─── Toast Notifications ─────────────────────────────────────────
function showToast(message, type = 'info') {
  let el = document.getElementById('toast-msg');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-msg';
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:10px 20px;border-radius:8px;font-size:.88rem;z-index:9999;transition:opacity .3s;pointer-events:none;';
    document.body.appendChild(el);
  }
  el.style.background = type === 'error' ? '#ef4444' : type === 'success' ? '#22c55e' : '#3b82f6';
  el.style.color = '#fff';
  el.textContent = message;
  el.style.opacity = '1';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.opacity = '0'; }, 3500);
}

// ─── Storage Keys ────────────────────────────────────────────────
const KEY_SNAPSHOTS = 'moneytrack_snapshots';
const KEY_TXNS      = 'moneytrack_txns';
const KEY_THEME     = 'moneytrack_theme';
const KEY_BUDGETS   = 'moneytrack_budgets';
const KEY_DEBT_META = 'moneytrack_debt_meta';
const KEY_LOANS     = 'moneytrack_loans';
const KEY_ACCOUNTS  = 'moneytrack_accounts';
const KEY_BILLS          = 'moneytrack_bills';
const KEY_GOALS          = 'moneytrack_goals';
const KEY_THINGS_ITEMS   = 'moneytrack_things_items';
const KEY_THINGS_ENTRIES = 'moneytrack_things_entries';
const KEY_THINGS_CATS    = 'moneytrack_things_cats';

// ─── Utilities ───────────────────────────────────────────────────
function escapeHTML(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function roundMoney(n) { return Math.round(n * 100) / 100; }

function isValidColor(c) {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
}
function safeColor(c, fallback) {
  return isValidColor(c) ? c : (fallback || '#888888');
}

function debounce(fn, ms) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

// Coerces a stored value to a safe, non-negative, finite dollar amount.
// Guards against corrupt localStorage data (strings, NaN, Infinity, negatives).
function safeAmt(v) {
  const n = Number(v);
  return (isFinite(n) && n >= 0) ? roundMoney(n) : 0;
}

function fmt(n) {
  if (!isFinite(n)) return '$0.00';
  const abs = Math.abs(n);
  return (n < 0 ? '-' : '') + '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso) {
  if (!iso) return 'Unknown date';
  const [y, m, d] = iso.split('-');
  return new Date(+y, +m - 1, +d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fmtShort(n) {
  if (!isFinite(n)) return '$0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return sign + '$' + (abs / 1e3).toFixed(1) + 'k';
  return sign + '$' + Math.round(abs);
}

function csvField(v) {
  const s = String(v == null ? '' : v).replace(/"/g, '""');
  return `"${s}"`;
}

// ─── Data Layer ──────────────────────────────────────────────────
function _safeParseJSON(raw, fallback) {
  if (raw === null) return fallback;
  return JSON.parse(raw, (k, v) => k === '__proto__' ? undefined : v);
}

function _safeSave(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error('[storage] Save failed:', key, e);
    if (e.name === 'QuotaExceededError') alert('Storage is full. Please export a backup and clear old data.');
  }
}

function loadSnapshots() {
  try { return _safeParseJSON(localStorage.getItem(KEY_SNAPSHOTS), []); }
  catch (e) { console.error('[storage] Parse failed: snapshots', e); return []; }
}

function saveSnapshots(arr) {
  _safeSave(KEY_SNAPSHOTS, arr);
  queueDriveSync();
}

function loadTxns() {
  try { return _safeParseJSON(localStorage.getItem(KEY_TXNS), []); }
  catch (e) { console.error('[storage] Parse failed: txns', e); return []; }
}

function saveTxns(arr) {
  _safeSave(KEY_TXNS, arr);
  queueDriveSync();
}

function loadBudgets() {
  try { return _safeParseJSON(localStorage.getItem(KEY_BUDGETS), {}); }
  catch (e) { console.error('[storage] Parse failed: budgets', e); return {}; }
}
function saveBudgets(obj) {
  _safeSave(KEY_BUDGETS, obj);
  queueDriveSync();
}

function loadDebtMeta() {
  try { return _safeParseJSON(localStorage.getItem(KEY_DEBT_META), {}); }
  catch (e) { console.error('[storage] Parse failed: debt_meta', e); return {}; }
}
function saveDebtMeta(obj) {
  _safeSave(KEY_DEBT_META, obj);
  queueDriveSync();
}

function loadLoans() {
  try { return _safeParseJSON(localStorage.getItem(KEY_LOANS), []); }
  catch (e) { console.error('[storage] Parse failed: loans', e); return []; }
}
function saveLoans(arr) {
  _safeSave(KEY_LOANS, arr);
  queueDriveSync();
}

function loadCustomAccounts() {
  try { return _safeParseJSON(localStorage.getItem(KEY_ACCOUNTS), []); }
  catch (e) { console.error('[storage] Parse failed: accounts', e); return []; }
}
function saveCustomAccounts(arr) {
  _safeSave(KEY_ACCOUNTS, arr);
  queueDriveSync();
}

function loadBills() {
  try { return _safeParseJSON(localStorage.getItem(KEY_BILLS), []); }
  catch (e) { console.error('[storage] Parse failed: bills', e); return []; }
}
function saveBills(arr) {
  _safeSave(KEY_BILLS, arr);
  queueDriveSync();
}

// Returns next due Date object for a bill, or null if undetermined
function getNextDueDate(bill) {
  const today = new Date(); today.setHours(0,0,0,0);
  if (bill.frequency === 'monthly' && bill.dayOfMonth) {
    const d = new Date(today.getFullYear(), today.getMonth(), bill.dayOfMonth);
    if (d < today) d.setMonth(d.getMonth() + 1);
    return d;
  }
  if ((bill.frequency === 'biweekly' || bill.frequency === 'weekly') && bill.anchorDate) {
    const interval = bill.frequency === 'biweekly' ? 14 : 7;
    const anchor = new Date(bill.anchorDate + 'T00:00:00');
    const diffDays = Math.floor((today - anchor) / (interval * 86400000));
    let next = new Date(anchor.getTime() + (diffDays + 1) * interval * 86400000);
    if (next < today) next = new Date(anchor.getTime() + (diffDays + 2) * interval * 86400000);
    return next;
  }
  if (bill.frequency === 'once' && bill.anchorDate) {
    return new Date(bill.anchorDate + 'T00:00:00');
  }
  return null;
}

function loadGoals() {
  try { return _safeParseJSON(localStorage.getItem(KEY_GOALS), []); }
  catch (e) { console.error('[storage] Parse failed: goals', e); return []; }
}
function saveGoals(arr) {
  _safeSave(KEY_GOALS, arr);
  queueDriveSync();
}

function loadThingsItems()   { try { return _safeParseJSON(localStorage.getItem(KEY_THINGS_ITEMS), []); }   catch (e) { console.error('[storage] Parse failed: things_items', e); return []; } }
function saveThingsItems(a)  { _safeSave(KEY_THINGS_ITEMS, a); queueDriveSync(); }
function loadThingsEntries() { try { return _safeParseJSON(localStorage.getItem(KEY_THINGS_ENTRIES), []); } catch (e) { console.error('[storage] Parse failed: things_entries', e); return []; } }
function saveThingsEntries(a){ _safeSave(KEY_THINGS_ENTRIES, a); queueDriveSync(); }
function loadThingsCustomCats()  { try { return _safeParseJSON(localStorage.getItem(KEY_THINGS_CATS), []); } catch (e) { console.error('[storage] Parse failed: things_cats', e); return []; } }
function saveThingsCustomCats(a) { _safeSave(KEY_THINGS_CATS, a); }
function getThingsCats()     { return [...new Set([...DEFAULT_THINGS_CATS, ...loadThingsCustomCats()])]; }
function getItemEntries(id)  { return loadThingsEntries().filter(e => e.itemId === id).sort((a,b) => a.date.localeCompare(b.date)); }

// ─── Account Select Population ───────────────────────────────────
function populateAccountSelects() {
  ['txn-account', 'filter-account'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const prefix = id === 'filter-account' ? '<option value="all">All Accounts</option>' : '';
    el.innerHTML = prefix + ACCOUNTS.map(a =>
      `<option value="${a.id}">${escapeHTML(a.label)}</option>`
    ).join('');
  });
  // Also populate the to-account select for transfers
  const toEl = document.getElementById('txn-to-account');
  if (toEl) {
    toEl.innerHTML = ACCOUNTS.map(a =>
      `<option value="${a.id}">${escapeHTML(a.label)}</option>`
    ).join('');
  }
}

// ─── Accounts Tab Rendering ──────────────────────────────────────
function renderAccountFields() {
  const groups = { checking: [], savings: [], debt: [], investment: [] };
  ACCOUNTS.forEach(a => { if (groups[a.group]) groups[a.group].push(a); });

  ['checking', 'savings', 'debt', 'investment'].forEach(g => {
    const el = document.getElementById(g + '-fields');
    if (!el) return;
    el.innerHTML = groups[g].map(a => `
      <div class="account-field-group">
        <label class="acct-label" for="bal-${a.id}">
          <span class="acct-badge" style="background:${safeColor(a.color)}"></span>
          ${escapeHTML(a.label)}
        </label>
        <input type="number" id="bal-${a.id}" class="acct-input ${a.group === 'debt' ? 'debt-input' : ''}"
               min="0" step="0.01" placeholder="0.00"
               aria-label="${escapeHTML(a.label)} balance">
      </div>`).join('');
  });
}

function prefillSnapshotForm(dateISO) {
  const existing = loadSnapshots().find(s => s.date === dateISO);
  const btn = document.getElementById('save-snapshot');
  if (existing) {
    const b = existing.accounts || {};
    ACCOUNTS.forEach(a => {
      const inp = document.getElementById('bal-' + a.id);
      if (inp) inp.value = b[a.id] != null ? b[a.id] : '';
    });
    const noteEl = document.getElementById('snapshot-note');
    if (noteEl) noteEl.value = existing.note || '';
    if (btn) btn.textContent = 'Update Snapshot';
  } else {
    if (btn) btn.textContent = 'Save Snapshot';
  }
}

function getLatestSnapshot() {
  const snaps = loadSnapshots();
  if (!snaps.length) return null;
  return snaps[snaps.length - 1];
}

function renderAccountKPIs() {
  const snap = getLatestSnapshot();
  const el = document.getElementById('account-kpis');
  if (!el) return;

  const b = snap ? (snap.accounts || {}) : {};
  const sum = g => roundMoney(ACCOUNTS.filter(a => a.group === g).reduce((s, a) => s + safeAmt(b[a.id]), 0));
  const lbl = g => ACCOUNTS.filter(a => a.group === g).map(a => a.label).join(', ') || 'None';

  const checking         = sum('checking');
  const savings          = sum('savings');
  const investment       = sum('investment');
  const debt             = sum('debt');
  const outstandingLoans = loadLoans().filter(l => l.status === 'outstanding');
  const loansOut         = roundMoney(outstandingLoans.reduce((s, l) => s + safeAmt(l.amount), 0));
  const net              = roundMoney(checking + savings + investment + loansOut - debt);

  const loansSub = outstandingLoans.length
    ? `${outstandingLoans.length} loan${outstandingLoans.length > 1 ? 's' : ''} outstanding`
    : 'No outstanding loans';

  const kpis = [
    { label: 'Checking',    value: checking,   color: 'var(--blue)',                                    sub: lbl('checking') },
    { label: 'Savings',     value: savings,    color: 'var(--green)',                                   sub: lbl('savings') },
    { label: 'Investments', value: investment, color: 'var(--purple)',                                  sub: lbl('investment') },
    { label: 'Loans Out',   value: loansOut,   color: 'var(--teal)',                                    sub: loansSub },
    { label: 'Debt Owed',   value: -debt,      color: 'var(--red)',                                     sub: lbl('debt') },
    { label: 'Net Worth',   value: net,        color: net >= 0 ? 'var(--green)' : 'var(--red)',         sub: 'All assets − debt' },
  ];

  el.innerHTML = kpis.map(k => `
    <div class="kpi">
      <div class="kpi-label">${escapeHTML(k.label)}</div>
      <div class="kpi-value" style="color:${k.color}">${fmt(k.value)}</div>
      <div class="kpi-sub">${escapeHTML(k.sub)}</div>
    </div>`).join('');

  const dateEl = document.getElementById('accounts-date');
  if (dateEl) {
    dateEl.textContent = snap
      ? `Last updated: ${fmtDate(snap.date)}${snap.note ? ' · ' + snap.note : ''}`
      : 'No snapshots yet — enter your balances below.';
  }
}

function renderNWTrend() {
  const snaps = loadSnapshots();
  const card = document.getElementById('nw-trend-card');
  const chart = document.getElementById('nw-trend-chart');
  const count = document.getElementById('nw-trend-count');
  if (!card || !chart) return;

  if (snaps.length < 2) { card.style.display = 'none'; return; }
  card.style.display = '';
  if (count) count.textContent = `${snaps.length} snapshots`;

  const last12 = snaps.slice(-12);
  const allLoans = loadLoans();
  const nwVals = last12.map(s => {
    const b = s.accounts || {};
    const assets = ACCOUNTS.filter(a => a.group !== 'debt').reduce((sum, a) => sum + safeAmt(b[a.id]), 0);
    const liab   = ACCOUNTS.filter(a => a.group === 'debt').reduce((sum, a) => sum + safeAmt(b[a.id]), 0);
    const loansAtDate = roundMoney(allLoans
      .filter(l => l.date <= s.date && (l.status === 'outstanding' || l.paidDate > s.date))
      .reduce((sum, l) => sum + safeAmt(l.amount), 0));
    return roundMoney(assets + loansAtDate - liab);
  });

  const maxV = Math.max(...nwVals.map(Math.abs), 1);

  chart.innerHTML = last12.map((s, i) => {
    const v = nwVals[i];
    const h = Math.max(2, Math.round(Math.abs(v) / maxV * 56));
    const color = v >= 0 ? 'var(--green)' : 'var(--red)';
    const shortDate = s.date.slice(5); // MM-DD
    return `<div class="nw-bar-col">
      <div class="nw-bar" style="height:${h}px;background:${color};opacity:.75" title="${fmt(v)} · ${fmtDate(s.date)}"></div>
      <div class="nw-lbl">${escapeHTML(shortDate)}</div>
    </div>`;
  }).join('');
}

function renderSnapshotHistory() {
  const snaps = loadSnapshots();
  const el = document.getElementById('snapshot-history');
  if (!el) return;

  if (!snaps.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">📊</div>No snapshots yet. Enter your balances above and save.</div>`;
    return;
  }

  // Build table — columns: date, each account, total savings, total checking, invest, net
  const cols = ACCOUNTS;
  const allLoansForHistory = loadLoans();
  let html = `<table class="history-table"><thead><tr>
    <th>Date</th>
    <th>Note</th>
    ${cols.map(a => `<th>${escapeHTML(a.label)}</th>`).join('')}
    <th>Savings</th>
    <th>Checking</th>
    <th>Invest</th>
    <th>Net Worth</th>
    <th></th>
  </tr></thead><tbody>`;

  [...snaps].reverse().forEach((s, ri) => {
    const b = s.accounts || {};
    const idx = snaps.length - 1 - ri;
    const savings    = roundMoney(ACCOUNTS.filter(a => a.group === 'savings').reduce((s, a) => s + safeAmt(b[a.id]), 0));
    const checking   = roundMoney(ACCOUNTS.filter(a => a.group === 'checking').reduce((s, a) => s + safeAmt(b[a.id]), 0));
    const investment = roundMoney(ACCOUNTS.filter(a => a.group === 'investment').reduce((s, a) => s + safeAmt(b[a.id]), 0));
    const debt       = roundMoney(ACCOUNTS.filter(a => a.group === 'debt').reduce((s, a) => s + safeAmt(b[a.id]), 0));
    const loansAtDate = roundMoney(allLoansForHistory
      .filter(l => l.date <= s.date && (l.status === 'outstanding' || l.paidDate > s.date))
      .reduce((sum, l) => sum + safeAmt(l.amount), 0));
    const net        = roundMoney(savings + checking + investment + loansAtDate - debt);

    html += `<tr>
      <td><strong>${escapeHTML(fmtDate(s.date))}</strong></td>
      <td style="color:var(--muted)">${escapeHTML(s.note || '—')}</td>
      ${cols.map(a => {
        const v = b[a.id] || 0;
        const isDebt = a.group === 'debt';
        return `<td style="color:${isDebt && v > 0 ? 'var(--red)' : 'var(--text)'}">${fmt(isDebt ? -v : v)}</td>`;
      }).join('')}
      <td style="color:var(--green);font-weight:700">${fmt(savings)}</td>
      <td style="color:var(--blue);font-weight:700">${fmt(checking)}</td>
      <td style="color:var(--purple);font-weight:700">${fmt(investment)}</td>
      <td style="color:${net >= 0 ? 'var(--green)' : 'var(--red)'};font-weight:700">${fmt(net)}</td>
      <td style="white-space:nowrap">
        <button class="txn-btn" data-edit-snap="${idx}" aria-label="Edit snapshot" style="margin-right:4px">✎</button>
        <button class="txn-btn del" data-del-snap="${idx}" aria-label="Delete snapshot">✕</button>
      </td>
    </tr>`;
  });

  html += '</tbody></table>';
  el.innerHTML = html;
}

function renderDebtDetails() {
  const el = document.getElementById('debt-details');
  if (!el) return;
  const snap = getLatestSnapshot();
  const debtAccounts = ACCOUNTS.filter(a => a.group === 'debt');
  if (!debtAccounts.length || !snap) {
    el.innerHTML = `<div class="empty-state" style="padding:16px 0"><div style="font-size:24px">💳</div><div>Save a balance snapshot first to see debt details.</div></div>`;
    return;
  }
  const meta = loadDebtMeta();
  const b = snap.accounts || {};

  el.innerHTML = debtAccounts.map(a => {
    const balance = b[a.id] || 0;
    const m = meta[a.id] || { apr: 0, minPayment: 0 };
    const monthlyRate    = m.apr > 0 ? m.apr / 100 / 12 : 0;
    const monthlyInterest = balance > 0 && monthlyRate > 0 ? roundMoney(balance * monthlyRate) : 0;

    let payoffMonths = null, totalInterest = null;
    if (balance > 0 && m.minPayment > 0 && monthlyRate > 0 && m.minPayment > monthlyInterest) {
      payoffMonths = Math.ceil(-Math.log(1 - (balance * monthlyRate) / m.minPayment) / Math.log(1 + monthlyRate));
      let bal = balance, paid = 0;
      for (let i = 0; i < Math.min(payoffMonths, 600); i++) { bal = roundMoney(bal * (1 + monthlyRate) - m.minPayment); paid += m.minPayment; }
      totalInterest = roundMoney(paid - balance);
    }

    const statsHtml = balance > 0 && m.apr > 0 ? `
      <div class="debt-stats">
        <div class="debt-stat"><div class="debt-stat-label">Monthly Interest</div><div class="debt-stat-value text-red">${fmt(monthlyInterest)}</div></div>
        ${payoffMonths !== null
          ? `<div class="debt-stat"><div class="debt-stat-label">Payoff Time</div><div class="debt-stat-value">${payoffMonths < 12 ? payoffMonths + ' mo' : (payoffMonths / 12).toFixed(1) + ' yrs'}</div></div>
             <div class="debt-stat"><div class="debt-stat-label">Total Interest</div><div class="debt-stat-value text-red">${fmt(totalInterest)}</div></div>`
          : `<div class="debt-stat"><div class="debt-stat-label">Payoff</div><div class="debt-stat-value text-muted">Enter min payment</div></div>`}
      </div>` : '';

    return `<div class="debt-card">
      <div class="debt-card-header">
        <span class="acct-badge" style="background:${safeColor(a.color)}"></span>
        <strong>${escapeHTML(a.label)}</strong>
        <span class="debt-balance text-red">${fmt(-balance)}</span>
      </div>
      <div class="debt-meta-grid">
        <div class="form-group">
          <label for="apr-${a.id}">APR %</label>
          <input type="number" id="apr-${a.id}" class="acct-input" min="0" max="100" step="0.01"
                 placeholder="e.g. 24.99" value="${m.apr > 0 ? m.apr : ''}"
                 data-debt-id="${a.id}" data-debt-field="apr">
        </div>
        <div class="form-group">
          <label for="minpay-${a.id}">Min Payment ($)</label>
          <input type="number" id="minpay-${a.id}" class="acct-input" min="0" step="1"
                 placeholder="e.g. 35" value="${m.minPayment > 0 ? m.minPayment : ''}"
                 data-debt-id="${a.id}" data-debt-field="minPayment">
        </div>
      </div>
      ${statsHtml}
    </div>`;
  }).join('') + `<button class="btn btn-green mt-12" id="save-debt-meta">Save Debt Details</button>`;
}

// ─── Loans Out ───────────────────────────────────────────────────
function renderLoansCard() {
  const el = document.getElementById('loans-content');
  if (!el) return;
  const loans = loadLoans();
  const outstanding = loans.filter(l => l.status === 'outstanding');
  const paid        = loans.filter(l => l.status === 'paid');

  const outstandingTotal = roundMoney(outstanding.reduce((s, l) => s + safeAmt(l.amount), 0));

  const outstandingHtml = outstanding.length
    ? outstanding.map(l => `
      <div class="loan-item" data-id="${l.id}">
        <div style="flex:1;min-width:0">
          <div class="loan-name">${escapeHTML(l.name)}</div>
          <div class="loan-meta">${escapeHTML(fmtDate(l.date))}${l.note ? ' · ' + escapeHTML(l.note) : ''}</div>
        </div>
        <div class="loan-amount">${fmt(l.amount)}</div>
        <button class="btn btn-green" style="padding:5px 10px;font-size:11px" data-loan-paid="${l.id}" aria-label="Mark as paid">✓ Paid</button>
        <button class="txn-btn del" data-loan-del="${l.id}" aria-label="Delete loan">✕</button>
      </div>`).join('')
    : `<div class="empty-state" style="padding:16px 0;font-size:12px">No outstanding loans — you're all clear!</div>`;

  const paidHtml = paid.length ? `
    <div class="loan-paid-section">
      <div class="loan-paid-label">Repaid (${paid.length})</div>
      ${paid.map(l => `
        <div class="loan-paid-item">
          <span style="flex:1">${escapeHTML(l.name)} — ${fmt(l.amount)}</span>
          <span>Paid ${escapeHTML(fmtDate(l.paidDate))}</span>
          <button class="txn-btn del" data-loan-del="${l.id}" aria-label="Delete loan record" style="margin-left:4px">✕</button>
        </div>`).join('')}
    </div>` : '';

  el.innerHTML = `
    <div class="debt-meta-grid" style="margin-bottom:12px">
      <div class="form-group">
        <label for="loan-name">Borrower Name</label>
        <input type="text" id="loan-name" class="acct-input" placeholder="e.g. John" maxlength="60" required>
      </div>
      <div class="form-group">
        <label for="loan-amount">Amount ($)</label>
        <input type="number" id="loan-amount" class="acct-input" min="0.01" step="0.01" placeholder="0.00" required>
      </div>
      <div class="form-group">
        <label for="loan-date">Date Loaned</label>
        <input type="date" id="loan-date" class="acct-input" value="${todayISO()}" max="${todayISO()}">
      </div>
      <div class="form-group">
        <label for="loan-note">What For (optional)</label>
        <input type="text" id="loan-note" class="acct-input" placeholder="e.g. rent help" maxlength="80">
      </div>
    </div>
    <button class="btn btn-green" id="add-loan">Add Loan</button>
    <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">
      ${outstanding.length ? `<div style="font-size:11px;color:var(--muted);margin-bottom:10px">Outstanding: <strong style="color:var(--teal)">${fmt(outstandingTotal)}</strong></div>` : ''}
      ${outstandingHtml}
    </div>
    ${paidHtml}`;
}

function addLoan() {
  const name   = document.getElementById('loan-name')?.value.trim();
  const amtRaw = parseFloat(document.getElementById('loan-amount')?.value);
  const date   = document.getElementById('loan-date')?.value || todayISO();
  const note   = document.getElementById('loan-note')?.value.trim() || '';

  if (!name || isNaN(amtRaw) || amtRaw <= 0 || !date) {
    alert('Please enter a borrower name, positive amount, and date.');
    return;
  }

  const loans = loadLoans();
  loans.push({ id: crypto.randomUUID(), name, amount: roundMoney(amtRaw), date, note, status: 'outstanding', paidDate: '' });
  saveLoans(loans);
  renderLoansCard();
  renderAccountKPIs(); // update Net Worth KPI
}

function markLoanPaid(id) {
  const loans = loadLoans();
  const idx   = loans.findIndex(l => String(l.id) === String(id));
  if (idx === -1) return;
  loans[idx].status   = 'paid';
  loans[idx].paidDate = todayISO();
  saveLoans(loans);
  renderLoansCard();
  renderAccountKPIs();
}

function deleteLoan(id) {
  const loans = loadLoans();
  const loan  = loans.find(l => String(l.id) === String(id));
  if (!loan) return;
  if (!confirm(`Delete loan record for "${loan.name}" (${fmt(loan.amount)})?`)) return;
  saveLoans(loans.filter(l => String(l.id) !== String(id)));
  renderLoansCard();
  renderAccountKPIs();
}

// ─── Manage Accounts ─────────────────────────────────────────────
function renderManageAccounts() {
  const listEl = document.getElementById('acct-mgmt-list');
  if (!listEl) return;

  const custom = loadCustomAccounts();
  const groupLabels = { checking: 'Checking', savings: 'Savings', debt: 'Debt', investment: 'Investment' };

  if (!custom.length) {
    listEl.innerHTML = `<div style="font-size:12px;color:var(--muted);padding:8px 0">No custom accounts yet. Click <strong>+ Add Account</strong> to get started.</div>`;
    return;
  }

  listEl.innerHTML = custom.map(a => `
    <div class="acct-mgmt-item">
      <span class="acct-color-swatch" style="background:${safeColor(a.color)}"></span>
      <span class="acct-mgmt-name">${escapeHTML(a.label)}</span>
      <span class="acct-mgmt-group">${escapeHTML(groupLabels[a.group] || a.group)}</span>
      <button class="txn-btn del" data-del-acct="${escapeHTML(a.id)}" aria-label="Remove ${escapeHTML(a.label)}">✕</button>
    </div>`).join('');
}

function showAddAccountForm() {
  const formEl = document.getElementById('acct-add-form');
  if (!formEl) return;
  formEl.innerHTML = `
    <div class="add-acct-form">
      <div class="form-grid">
        <div class="form-group">
          <label for="new-acct-name">Account Name</label>
          <input type="text" id="new-acct-name" class="acct-input" placeholder="e.g. Wells Fargo Checking" maxlength="50">
        </div>
        <div class="form-group">
          <label for="new-acct-group">Type</label>
          <select id="new-acct-group" class="acct-input">
            <option value="checking">Checking</option>
            <option value="savings">Savings</option>
            <option value="debt">Debt / Credit Card</option>
            <option value="investment">Investment</option>
          </select>
        </div>
        <div class="form-group">
          <label for="new-acct-color">Color</label>
          <input type="color" id="new-acct-color" value="#60a5fa" style="height:38px;padding:2px 4px;cursor:pointer">
        </div>
      </div>
      <div class="flex gap-8 mt-12">
        <button class="btn btn-green" id="confirm-add-account">Add Account</button>
        <button class="btn btn-ghost btn-sm" id="cancel-add-account">Cancel</button>
      </div>
    </div>`;
  formEl.style.display = '';
  document.getElementById('new-acct-name')?.focus();
}

function addAccount() {
  const name  = (document.getElementById('new-acct-name')?.value || '').trim();
  const group = document.getElementById('new-acct-group')?.value || 'checking';
  const color = document.getElementById('new-acct-color')?.value || '#60a5fa';

  if (!name) { alert('Please enter an account name.'); return; }

  // Generate a stable ID from the name + a short random suffix
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/, '');
  const id   = base + '_' + Math.random().toString(36).slice(2, 6);

  // Guard against accidental ID collision
  if (ACCOUNTS.some(a => a.id === id)) {
    alert('Could not generate a unique ID — please try a slightly different name.');
    return;
  }

  const custom = loadCustomAccounts();
  custom.push({ id, label: name, group, color });
  saveCustomAccounts(custom);
  refreshAccountConfig();

  // Re-render everything that depends on ACCOUNTS
  renderAccountFields();
  renderAccountsTab();
  populateAccountSelects();

  // Reset form
  const formEl = document.getElementById('acct-add-form');
  if (formEl) { formEl.innerHTML = ''; formEl.style.display = 'none'; }
}

function deleteCustomAccount(id) {
  const custom  = loadCustomAccounts();
  const account = custom.find(a => a.id === id);
  if (!account) return;
  if (!confirm(`Remove "${account.label}"? Historical snapshot data will be preserved, but this account won't appear in new entries.`)) return;

  saveCustomAccounts(custom.filter(a => a.id !== id));
  refreshAccountConfig();

  renderAccountFields();
  renderAccountsTab();
  populateAccountSelects();
}

// ─── Financial Ratios ────────────────────────────────────────────
function computeSavingsRate3Month() {
  const today = new Date();
  const months = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    months.push({ y: d.getFullYear(), m: d.getMonth() });
  }
  const txns = loadTxns();
  const rates = months.map(({ y, m }) => {
    const mt = txns.filter(t => {
      const td = new Date(t.date + 'T00:00:00');
      return td.getFullYear() === y && td.getMonth() === m;
    });
    const income   = mt.filter(t => t.type === 'income').reduce((s, t) => s + safeAmt(t.amount), 0);
    const expenses = mt.filter(t => t.type === 'expense').reduce((s, t) => s + safeAmt(t.amount), 0);
    return income > 0 ? (income - expenses) / income : null;
  });
  const valid = rates.filter(r => r !== null);
  return valid.length ? valid.reduce((s, r) => s + r, 0) / valid.length : null;
}

function renderFinancialRatios() {
  const el = document.getElementById('financial-ratios-content');
  if (!el) return;
  const snap = getLatestSnapshot();
  const b = snap ? (snap.accounts || {}) : {};
  const sum = g => roundMoney(ACCOUNTS.filter(a => a.group === g).reduce((s, a) => s + safeAmt(b[a.id]), 0));
  const savings = sum('savings');
  const debt    = sum('debt');

  const txns = loadTxns();
  const today = new Date();
  const last3 = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    last3.push({ y: d.getFullYear(), m: d.getMonth() });
  }
  const monthlyExpenses = last3.map(({ y, m }) =>
    txns.filter(t => {
      const td = new Date(t.date + 'T00:00:00');
      return td.getFullYear() === y && td.getMonth() === m && t.type === 'expense';
    }).reduce((s, t) => s + safeAmt(t.amount), 0)
  );
  const activeExpMonths = monthlyExpenses.filter(e => e > 0).length || 1;
  const avgMonthlyExpense = monthlyExpenses.reduce((s, e) => s + e, 0) / activeExpMonths;
  const emergencyMonths = avgMonthlyExpense > 0 ? roundMoney(savings / avgMonthlyExpense) : null;
  const savingsRate = computeSavingsRate3Month();

  const snaps = loadSnapshots();
  let nwChange = null;
  if (snaps.length >= 2) {
    const nw = s => {
      const sb = s.accounts || {};
      return roundMoney(
        ACCOUNTS.filter(a => a.group !== 'debt').reduce((acc, a) => acc + safeAmt(sb[a.id]), 0) -
        ACCOUNTS.filter(a => a.group === 'debt').reduce((acc, a) => acc + safeAmt(sb[a.id]), 0)
      );
    };
    nwChange = nw(snaps[snaps.length - 1]) - nw(snaps[snaps.length - 2]);
  }

  const ratios = [
    {
      label: 'Emergency Fund',
      value: emergencyMonths !== null ? emergencyMonths.toFixed(1) + ' mo' : '—',
      sub:   'Savings ÷ avg monthly expenses',
      color: emergencyMonths === null ? 'var(--muted)' : emergencyMonths >= 6 ? 'var(--green)' : emergencyMonths >= 3 ? 'var(--gold)' : 'var(--red)',
    },
    {
      label: '3-Month Savings Rate',
      value: savingsRate !== null ? Math.round(savingsRate * 100) + '%' : '—',
      sub:   'Avg (income − expenses) / income',
      color: savingsRate === null ? 'var(--muted)' : savingsRate >= 0.2 ? 'var(--green)' : savingsRate >= 0 ? 'var(--gold)' : 'var(--red)',
    },
    {
      label: 'Net Worth Change',
      value: nwChange !== null ? fmt(nwChange) : '—',
      sub:   'Latest vs previous snapshot',
      color: nwChange === null ? 'var(--muted)' : nwChange >= 0 ? 'var(--green)' : 'var(--red)',
    },
    {
      label: 'Total Debt',
      value: fmt(debt),
      sub:   'All credit card / debt accounts',
      color: debt === 0 ? 'var(--green)' : 'var(--red)',
    },
  ];
  el.innerHTML = `<div class="ratios-grid">${ratios.map(r =>
    `<div class="ratio-card">
      <div class="ratio-label">${escapeHTML(r.label)}</div>
      <div class="ratio-value" style="color:${r.color}">${escapeHTML(r.value)}</div>
      <div class="ratio-sub">${escapeHTML(r.sub)}</div>
    </div>`
  ).join('')}</div>`;
}

// ─── Bill Reminders ──────────────────────────────────────────────
function renderBillReminders() {
  const el = document.getElementById('bills-content');
  if (!el) return;
  const bills = loadBills();
  const today = new Date(); today.setHours(0,0,0,0);

  const withDue = bills.map(bill => {
    const due = getNextDueDate(bill);
    const daysUntil = due ? Math.round((due - today) / 86400000) : null;
    return { ...bill, due, daysUntil };
  }).sort((a, b) => {
    if (a.daysUntil === null) return 1;
    if (b.daysUntil === null) return -1;
    return a.daysUntil - b.daysUntil;
  });

  if (!withDue.length) {
    el.innerHTML = '<p style="color:var(--muted);font-size:13px">No bills added yet. Click + Add Bill to get started.</p>';
  } else {
    el.innerHTML = withDue.map(b => {
      const urgency  = b.daysUntil === null ? '' : b.daysUntil < 0 ? 'bill-overdue' : b.daysUntil <= 3 ? 'bill-urgent' : b.daysUntil <= 7 ? 'bill-soon' : '';
      const dueLabel = b.daysUntil === null ? 'Unknown' : b.daysUntil === 0 ? 'Due today' : b.daysUntil < 0 ? `${Math.abs(b.daysUntil)}d overdue` : `In ${b.daysUntil}d`;
      const amtLabel = b.amount ? fmt(b.amount) : '—';
      return `<div class="bill-item ${urgency}">
        <div class="bill-info">
          <div class="bill-name">${escapeHTML(b.name)}</div>
          <div class="bill-meta">${escapeHTML(b.frequency)}${b.account ? ' · ' + escapeHTML(ACCOUNT_LABELS[b.account] || b.account) : ''}</div>
        </div>
        <div class="bill-amount">${amtLabel}</div>
        <div class="bill-due">${escapeHTML(dueLabel)}</div>
        <button class="btn btn-ghost btn-sm" data-del-bill="${escapeHTML(b.id)}" aria-label="Delete bill">✕</button>
      </div>`;
    }).join('');
  }
}

function showAddBillForm() {
  const formEl = document.getElementById('bill-add-form');
  if (!formEl) return;
  formEl.style.display = '';
  formEl.innerHTML = `
    <div class="add-acct-form">
      <div class="form-grid">
        <div class="form-group">
          <label for="new-bill-name">Bill Name</label>
          <input type="text" id="new-bill-name" placeholder="e.g. Netflix" maxlength="60" required>
        </div>
        <div class="form-group">
          <label for="new-bill-amount">Amount ($)</label>
          <input type="number" id="new-bill-amount" min="0" step="0.01" placeholder="0.00">
        </div>
        <div class="form-group">
          <label for="new-bill-freq">Frequency</label>
          <select id="new-bill-freq">
            <option value="monthly">Monthly</option>
            <option value="biweekly">Biweekly</option>
            <option value="weekly">Weekly</option>
            <option value="once">One-time</option>
          </select>
        </div>
        <div class="form-group" id="bill-dom-group">
          <label for="new-bill-dom">Day of Month</label>
          <input type="number" id="new-bill-dom" min="1" max="31" placeholder="1–31">
        </div>
        <div class="form-group" id="bill-anchor-group" style="display:none">
          <label for="new-bill-anchor">Next Due Date</label>
          <input type="date" id="new-bill-anchor">
        </div>
        <div class="form-group">
          <label for="new-bill-account">Account</label>
          <select id="new-bill-account">
            <option value="">None</option>
            ${ACCOUNTS.map(a => `<option value="${a.id}">${escapeHTML(a.label)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="flex gap-8 mt-12">
        <button class="btn btn-green" id="confirm-add-bill">Add Bill</button>
        <button class="btn btn-ghost btn-sm" id="cancel-add-bill">Cancel</button>
      </div>
    </div>`;
  const freqSel     = document.getElementById('new-bill-freq');
  const domGroup    = document.getElementById('bill-dom-group');
  const anchorGroup = document.getElementById('bill-anchor-group');
  const toggleFields = () => {
    const f = freqSel.value;
    domGroup.style.display    = f === 'monthly' ? '' : 'none';
    anchorGroup.style.display = (f === 'biweekly' || f === 'weekly' || f === 'once') ? '' : 'none';
  };
  freqSel.addEventListener('change', toggleFields);
  toggleFields();
}

function addBill() {
  const name = (document.getElementById('new-bill-name')?.value || '').trim();
  if (!name) { alert('Please enter a bill name.'); return; }
  const amount  = parseFloat(document.getElementById('new-bill-amount')?.value) || null;
  const freq    = document.getElementById('new-bill-freq')?.value || 'monthly';
  const dom     = parseInt(document.getElementById('new-bill-dom')?.value, 10) || null;
  const anchor  = document.getElementById('new-bill-anchor')?.value || null;
  const account = document.getElementById('new-bill-account')?.value || null;
  const bill = {
    id:         crypto.randomUUID(),
    name,
    amount:     amount ? roundMoney(amount) : null,
    account:    account || null,
    frequency:  freq,
    dayOfMonth: freq === 'monthly' ? dom : null,
    anchorDate: freq !== 'monthly' ? anchor : null,
  };
  const bills = loadBills();
  bills.push(bill);
  saveBills(bills);
  const formEl = document.getElementById('bill-add-form');
  if (formEl) { formEl.innerHTML = ''; formEl.style.display = 'none'; }
  renderBillReminders();
}

function deleteBill(id) {
  const bills = loadBills();
  const bill  = bills.find(b => b.id === id);
  if (!bill) return;
  if (!confirm(`Remove "${bill.name}"?`)) return;
  saveBills(bills.filter(b => b.id !== id));
  renderBillReminders();
}

// ─── Savings Goals ────────────────────────────────────────────────
function renderSavingsGoals() {
  const el = document.getElementById('goals-content');
  if (!el) return;
  const goals = loadGoals();
  const snap = getLatestSnapshot();
  const b = snap ? (snap.accounts || {}) : {};

  if (!goals.length) {
    el.innerHTML = '<p style="color:var(--muted);font-size:13px">No goals yet. Click + Add Goal to create one.</p>';
  } else {
    const txns = loadTxns();
    const today = new Date();
    const last3 = [];
    for (let i = 1; i <= 3; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      last3.push({ y: d.getFullYear(), m: d.getMonth() });
    }
    const avgMonthlySavings = (() => {
      const rates = last3.map(({ y, m }) => {
        const mt = txns.filter(t => { const td = new Date(t.date + 'T00:00:00'); return td.getFullYear() === y && td.getMonth() === m; });
        const inc = mt.filter(t => t.type === 'income').reduce((s, t) => s + safeAmt(t.amount), 0);
        const exp = mt.filter(t => t.type === 'expense').reduce((s, t) => s + safeAmt(t.amount), 0);
        return inc > 0 ? inc - exp : null;
      }).filter(r => r !== null);
      return rates.length ? rates.reduce((s, r) => s + r, 0) / rates.length : 0;
    })();

    el.innerHTML = goals.map(g => {
      const trackIds = (g.accounts && g.accounts.length)
        ? g.accounts
        : ACCOUNTS.filter(a => a.group === 'savings').map(a => a.id);
      const current = roundMoney(trackIds.reduce((s, id) => s + safeAmt(b[id]), 0));
      const pct = g.target > 0 ? Math.min(100, Math.round(current / g.target * 100)) : 0;

      let projection = '';
      if (current >= g.target) {
        projection = 'Goal reached! 🎉';
      } else if (avgMonthlySavings > 0) {
        const monthsLeft = Math.ceil((g.target - current) / avgMonthlySavings);
        const projDate = new Date(today.getFullYear(), today.getMonth() + monthsLeft, 1);
        projection = `Est. ${projDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
      }

      return `<div class="goal-item">
        <div class="goal-header">
          <span class="goal-name">${escapeHTML(g.name)}</span>
          <span class="goal-pct" style="color:${pct >= 100 ? 'var(--green)' : 'var(--muted)'}">${pct}%</span>
          <button class="btn btn-ghost btn-sm" data-del-goal="${escapeHTML(g.id)}" aria-label="Delete goal">✕</button>
        </div>
        <div class="goal-progress-wrap" aria-label="${pct}% complete">
          <div class="goal-progress-bar" style="width:${pct}%"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-top:4px">
          <span>${fmt(current)} of ${fmt(g.target)}</span>
          <span>${escapeHTML(projection)}</span>
        </div>
      </div>`;
    }).join('');
  }
}

function showAddGoalForm() {
  const formEl = document.getElementById('goal-add-form');
  if (!formEl) return;
  formEl.style.display = '';
  formEl.innerHTML = `
    <div class="add-acct-form">
      <div class="form-grid">
        <div class="form-group">
          <label for="new-goal-name">Goal Name</label>
          <input type="text" id="new-goal-name" placeholder="e.g. Emergency Fund" maxlength="60" required>
        </div>
        <div class="form-group">
          <label for="new-goal-target">Target Amount ($)</label>
          <input type="number" id="new-goal-target" min="0" step="0.01" placeholder="20000.00" required>
        </div>
      </div>
      <p style="font-size:11px;color:var(--muted);margin:4px 0 8px">Progress is tracked from your total savings account balances in the latest snapshot.</p>
      <div class="flex gap-8 mt-12">
        <button class="btn btn-green" id="confirm-add-goal">Add Goal</button>
        <button class="btn btn-ghost btn-sm" id="cancel-add-goal">Cancel</button>
      </div>
    </div>`;
}

function addGoal() {
  const name   = (document.getElementById('new-goal-name')?.value || '').trim();
  const target = parseFloat(document.getElementById('new-goal-target')?.value) || 0;
  if (!name)        { alert('Please enter a goal name.'); return; }
  if (target <= 0)  { alert('Please enter a target amount greater than zero.'); return; }
  const goals = loadGoals();
  goals.push({ id: crypto.randomUUID(), name, target: roundMoney(target), accounts: [] });
  saveGoals(goals);
  const formEl = document.getElementById('goal-add-form');
  if (formEl) { formEl.innerHTML = ''; formEl.style.display = 'none'; }
  renderSavingsGoals();
}

function deleteGoal(id) {
  const goals = loadGoals();
  const goal  = goals.find(g => g.id === id);
  if (!goal) return;
  if (!confirm(`Remove goal "${goal.name}"?`)) return;
  saveGoals(goals.filter(g => g.id !== id));
  renderSavingsGoals();
}

function renderAccountsTab() {
  renderAccountKPIs();
  renderNWTrend();
  renderBalanceTrends();
  renderFinancialRatios();
  renderSnapshotHistory();
  renderDebtDetails();
  renderLoansCard();
  renderManageAccounts();
  renderBillReminders();
  renderSavingsGoals();
}

// ─── Snapshot Actions ────────────────────────────────────────────
function saveSnapshot() {
  const note = (document.getElementById('snapshot-note')?.value || '').trim();
  const selectedDate = document.getElementById('snapshot-date')?.value || todayISO();
  const snaps = loadSnapshots();
  const dupIdx = snaps.findIndex(s => s.date === selectedDate);
  if (dupIdx !== -1 && !confirm(`A snapshot for ${selectedDate} already exists. Overwrite it?`)) return;

  // If updating an existing snapshot, carry over any fields the user left blank
  // so that editing just one account doesn't wipe out all the others.
  const existingAccts = dupIdx !== -1 ? (snaps[dupIdx].accounts || {}) : {};

  const balances = {};
  let hasData = false;
  ACCOUNTS.forEach(a => {
    const inp = document.getElementById('bal-' + a.id);
    const raw = inp ? inp.value.trim() : '';
    let v;
    if (raw === '' && existingAccts[a.id] != null) {
      v = existingAccts[a.id];           // field left blank → keep existing value
    } else {
      v = roundMoney(parseFloat(raw) || 0);
    }
    balances[a.id] = v;
    if (v > 0) hasData = true;
  });
  if (!hasData) { alert('Please enter at least one account balance before saving.'); return; }

  if (dupIdx !== -1) snaps.splice(dupIdx, 1);
  snaps.push({ date: selectedDate, note, accounts: balances });
  // Keep array sorted by date ascending
  snaps.sort((a, b) => a.date.localeCompare(b.date));
  saveSnapshots(snaps);

  // Clear inputs, reset date to today
  ACCOUNTS.forEach(a => { const inp = document.getElementById('bal-' + a.id); if (inp) inp.value = ''; });
  const noteEl = document.getElementById('snapshot-note');
  if (noteEl) noteEl.value = '';
  const dateEl = document.getElementById('snapshot-date');
  if (dateEl) dateEl.value = todayISO();

  renderAccountsTab();
  // After re-render, check if today has a snapshot and reflect that in button/form
  prefillSnapshotForm(todayISO());
}

function deleteSnapshot(idx) {
  const snaps = loadSnapshots();
  snaps.splice(idx, 1);
  saveSnapshots(snaps);
  renderAccountsTab();
}

function clearBalanceForms() {
  ACCOUNTS.forEach(a => { const inp = document.getElementById('bal-' + a.id); if (inp) inp.value = ''; });
  const noteEl = document.getElementById('snapshot-note');
  if (noteEl) noteEl.value = '';
  const dateEl = document.getElementById('snapshot-date');
  if (dateEl) dateEl.value = todayISO();
  prefillSnapshotForm(todayISO());
}

function exportSnapshots() {
  const snaps = loadSnapshots();
  if (!snaps.length) { showToast('No snapshots to export.', 'info'); return; }

  const cols = ACCOUNTS;
  const allLoansForExport = loadLoans();
  const header = ['Date', 'Note', ...cols.map(a => a.label), 'Total Savings', 'Total Checking', 'Total Investments', 'Loans Out', 'Net Worth'];
  const rows = snaps.map(s => {
    const b = s.accounts || {};
    const savings    = roundMoney(ACCOUNTS.filter(a => a.group === 'savings').reduce((sum, a) => sum + safeAmt(b[a.id]), 0));
    const checking   = roundMoney(ACCOUNTS.filter(a => a.group === 'checking').reduce((sum, a) => sum + safeAmt(b[a.id]), 0));
    const investment = roundMoney(ACCOUNTS.filter(a => a.group === 'investment').reduce((sum, a) => sum + safeAmt(b[a.id]), 0));
    const debt       = roundMoney(ACCOUNTS.filter(a => a.group === 'debt').reduce((sum, a) => sum + safeAmt(b[a.id]), 0));
    const loansOut   = roundMoney(allLoansForExport
      .filter(l => l.date <= s.date && (l.status === 'outstanding' || l.paidDate > s.date))
      .reduce((sum, l) => sum + safeAmt(l.amount), 0));
    const net        = roundMoney(savings + checking + investment + loansOut - debt);
    return [
      s.date, s.note || '',
      ...cols.map(a => (a.group === 'debt' ? -(b[a.id]||0) : (b[a.id]||0))),
      savings, checking, investment, loansOut, net,
    ];
  });

  const csv = [header, ...rows].map(r => r.map(csvField).join(',')).join('\r\n');
  downloadCSV(csv, `MoneyTrack_Balances_${todayISO()}.csv`);
}

// ─── Tracker Tab ─────────────────────────────────────────────────

// Filter state
const filters = { period: 'month', account: 'all', type: 'all', from: '', to: '', search: '' };

function getFilteredTxns() {
  const all = loadTxns();
  const today = new Date(); today.setHours(0,0,0,0);

  return all.filter(t => {
    // Date filter
    const d = new Date(t.date + 'T00:00:00');
    if (isNaN(d.getTime())) return false;

    if (filters.period === 'today') {
      if (d.toDateString() !== today.toDateString()) return false;
    } else if (filters.period === 'week') {
      const dow = today.getDay(); // 0=Sun
      const weekStart = new Date(today); weekStart.setDate(today.getDate() - dow);
      if (d < weekStart) return false;
    } else if (filters.period === 'month') {
      if (d.getFullYear() !== today.getFullYear() || d.getMonth() !== today.getMonth()) return false;
    } else if (filters.period === 'last30') {
      const cutoff = new Date(today); cutoff.setDate(today.getDate() - 30);
      if (d < cutoff) return false;
    } else if (filters.period === 'last7') {
      const cutoff = new Date(today); cutoff.setDate(today.getDate() - 7);
      if (d < cutoff) return false;
    } else if (filters.period === 'custom') {
      if (filters.from) { const f = new Date(filters.from + 'T00:00:00'); if (d < f) return false; }
      if (filters.to)   { const t2 = new Date(filters.to + 'T00:00:00'); if (d > t2) return false; }
    }

    // Account filter
    if (filters.account !== 'all' && t.account !== filters.account) return false;

    // Type filter
    if (filters.type !== 'all' && t.type !== filters.type) return false;

    // Search filter
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!(t.description || '').toLowerCase().includes(q) && !(t.category || '').toLowerCase().includes(q)) return false;
    }

    return true;
  });
}

function renderTrackerSummary(txns) {
  let income = 0, expense = 0;
  txns.forEach(t => {
    // Transfers excluded — internal moves don't affect income or expense totals
    if (t.type === 'income')       income  += safeAmt(t.amount);
    else if (t.type === 'expense') expense += safeAmt(t.amount);
  });
  income  = roundMoney(income);
  expense = roundMoney(expense);
  const net  = roundMoney(income - expense);
  const rate = income > 0 ? Math.round(net / income * 100) : null;

  const inEl   = document.getElementById('stat-in');
  const outEl  = document.getElementById('stat-out');
  const netEl  = document.getElementById('stat-net');
  const rateEl = document.getElementById('stat-rate');

  if (inEl)  inEl.textContent  = fmt(income);
  if (outEl) outEl.textContent = fmt(expense);
  if (netEl) {
    netEl.textContent = fmt(net);
    netEl.style.color = net >= 0 ? 'var(--green)' : 'var(--red)';
  }
  if (rateEl) {
    rateEl.textContent = rate !== null ? `${rate}%` : '—';
    rateEl.style.color = rate === null ? 'var(--muted)'
      : rate >= 20 ? 'var(--green)'
      : rate >= 10 ? 'var(--gold)'
      : 'var(--red)';
  }
}

function renderCategoryBreakdown(txns) {
  const el = document.getElementById('cat-breakdown');
  if (!el) return;

  // Only expenses
  const expenses = txns.filter(t => t.type === 'expense');
  if (!expenses.length) {
    el.innerHTML = `<div class="empty-state" style="padding:20px 0"><div style="font-size:24px">📂</div><div>No expense data for this period.</div></div>`;
    return;
  }

  const totals = {};
  expenses.forEach(t => {
    totals[t.category] = (totals[t.category] || 0) + safeAmt(t.amount);
  });

  const total = expenses.reduce((s, t) => s + safeAmt(t.amount), 0);
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const max = sorted[0][1];
  if (max === 0) {
    el.innerHTML = `<div class="empty-state" style="padding:20px 0"><div style="font-size:24px">📂</div><div>No expense data for this period.</div></div>`;
    return;
  }

  const budgets = loadBudgets();

  el.innerHTML = sorted.map(([cat, amt]) => {
    const pct   = total > 0 ? Math.round(amt / total * 100) : 0;
    const barW  = Math.round(amt / max * 100);
    const color = safeColor(CATEGORY_COLORS[cat], '#8a8aa6');
    const budget = budgets[cat] || 0;

    let budgetRow = '';
    if (budget > 0) {
      const usedPct   = Math.min(Math.round(amt / budget * 100), 100);
      const overBudget = roundMoney(amt) > budget;
      const budgetColor = overBudget ? 'var(--red)' : usedPct >= 80 ? 'var(--gold)' : 'var(--green)';
      budgetRow = `<div class="budget-row">
        <div class="budget-bar-wrap"><div class="budget-bar" style="width:${usedPct}%;background:${budgetColor}"></div></div>
        <div class="budget-label" style="color:${budgetColor}">${fmt(amt)} / ${fmt(budget)}${overBudget ? ' ⚠' : ''}</div>
      </div>`;
    }

    return `<div class="cat-row">
      <div class="cat-label">${escapeHTML(cat)}</div>
      <div class="cat-bar-wrap"><div class="cat-bar" style="width:${barW}%;background:${color}"></div></div>
      <div class="cat-amount">${fmt(amt)}</div>
      <div class="cat-pct">${pct}%</div>
    </div>${budgetRow}`;
  }).join('');
}

function renderDailyChart(txns) {
  const el = document.getElementById('daily-chart');
  const labelEl = document.getElementById('daily-period-label');
  if (!el) return;

  const expenses = txns.filter(t => t.type === 'expense');

  // Build day buckets aligned to the active filter period
  const today = new Date(); today.setHours(0,0,0,0);
  let startDate, endDate = new Date(today), periodLabel = 'last 30 days';

  if (filters.period === 'week') {
    startDate = new Date(today); startDate.setDate(today.getDate() - today.getDay());
    periodLabel = 'this week';
  } else if (filters.period === 'month') {
    startDate = new Date(today.getFullYear(), today.getMonth(), 1);
    periodLabel = today.toLocaleDateString('en-US', { month: 'long' });
  } else if (filters.period === 'last7') {
    startDate = new Date(today); startDate.setDate(today.getDate() - 6);
    periodLabel = 'last 7 days';
  } else if (filters.period === 'custom' && filters.from) {
    startDate = new Date(filters.from + 'T00:00:00');
    if (filters.to) endDate = new Date(filters.to + 'T00:00:00');
    // Cap at 60 days to keep chart readable
    if ((endDate - startDate) / 86400000 > 59) {
      startDate = new Date(endDate); startDate.setDate(endDate.getDate() - 59);
    }
    periodLabel = 'custom range';
  } else {
    startDate = new Date(today); startDate.setDate(today.getDate() - 29);
  }

  const days = [];
  const cur = new Date(startDate);
  while (cur <= endDate) {
    const iso = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
    days.push({ iso, label: `${cur.getMonth()+1}/${cur.getDate()}`, total: 0 });
    cur.setDate(cur.getDate() + 1);
  }

  expenses.forEach(t => {
    const bucket = days.find(d => d.iso === t.date);
    if (bucket) bucket.total += safeAmt(t.amount);
  });

  const max = Math.max(...days.map(d => d.total), 1);
  if (labelEl) labelEl.textContent = periodLabel;

  el.innerHTML = days.map(d => {
    const h = Math.max(2, Math.round(d.total / max * 60));
    const hasData = d.total > 0;
    return `<div class="day-col" title="${d.label}: ${fmt(d.total)}">
      <div class="day-bar" style="height:${h}px;opacity:${hasData ? '.8' : '.2'}"></div>
      <div class="day-lbl">${d.total > 0 ? d.label.split('/')[1] : ''}</div>
    </div>`;
  }).join('');
}

function renderAccountBreakdown(txns) {
  const el = document.getElementById('account-breakdown');
  if (!el) return;

  const expenses = txns.filter(t => t.type === 'expense');
  if (!expenses.length) { el.innerHTML = ''; return; }

  const totals = {};
  expenses.forEach(t => {
    totals[t.account] = (totals[t.account] || 0) + safeAmt(t.amount);
  });

  const total = expenses.reduce((s, t) => s + safeAmt(t.amount), 0);
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const max = sorted[0][1];

  el.innerHTML = `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:8px">By Account</div>` +
    sorted.map(([acctId, amt]) => {
      const label = ACCOUNT_LABELS[acctId] || acctId;
      const color = safeColor(ACCOUNT_COLORS[acctId], '#8a8aa6');
      const pct   = total > 0 ? Math.round(amt / total * 100) : 0;
      const barW  = Math.round(amt / max * 100);
      return `<div class="cat-row" style="margin-bottom:7px">
        <div class="cat-label">${escapeHTML(label)}</div>
        <div class="cat-bar-wrap"><div class="cat-bar" style="width:${barW}%;background:${color}"></div></div>
        <div class="cat-amount">${fmt(amt)}</div>
        <div class="cat-pct">${pct}%</div>
      </div>`;
    }).join('');
}

function renderTransactionLog(txns) {
  const el = document.getElementById('txn-list');
  const countEl = document.getElementById('txn-count');
  if (!el) return;

  if (countEl) countEl.textContent = `${txns.length} transaction${txns.length !== 1 ? 's' : ''}`;

  if (!txns.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">💳</div>No transactions for this period.</div>`;
    return;
  }

  // Sort newest first
  const sorted = [...txns].sort((a, b) => b.date.localeCompare(a.date) || String(b.id).localeCompare(String(a.id)));

  el.innerHTML = sorted.map(t => {
    const color = t.type === 'income' ? 'var(--green)' : t.type === 'transfer' ? 'var(--blue)' : 'var(--red)';
    const sign  = t.type === 'income' ? '+' : t.type === 'transfer' ? '→' : '-';
    const acctLabel = ACCOUNT_LABELS[t.account] || t.account;
    const catColor = safeColor(CATEGORY_COLORS[t.category], '#8a8aa6');
    return `<div class="txn-item" role="listitem" data-id="${t.id}">
      <div class="txn-dot" style="background:${color}"></div>
      <div class="txn-info">
        <div class="txn-desc">${escapeHTML(t.description)}</div>
        <div class="txn-meta">
          ${escapeHTML(fmtDate(t.date))} &nbsp;·&nbsp;
          <span style="color:${catColor}">${escapeHTML(t.category)}</span>
          &nbsp;·&nbsp; ${escapeHTML(acctLabel)}
          ${t.recurring ? `&nbsp;·&nbsp;<span class="recurring-badge">${escapeHTML(t.recurring)}</span>` : ''}
        </div>
      </div>
      <div class="txn-amount" style="color:${color}">${sign}${fmt(t.amount)}</div>
      <div class="txn-actions">
        <button class="txn-btn edit" data-edit="${t.id}" aria-label="Edit transaction">✏️</button>
        <button class="txn-btn del"  data-del="${t.id}"  aria-label="Delete transaction">✕</button>
      </div>
    </div>`;
  }).join('');
}

function renderMonthlyTrends() {
  const el = document.getElementById('monthly-trends');
  if (!el) return;
  const all = loadTxns();
  if (!all.length) {
    el.innerHTML = `<div class="empty-state" style="padding:16px 0"><div style="font-size:20px">📅</div><div>No transactions yet.</div></div>`;
    return;
  }
  const today = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth(), label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }), income: 0, expense: 0 });
  }
  all.forEach(t => {
    if (t.type === 'transfer') return;
    const d = new Date(t.date + 'T00:00:00');
    const bucket = months.find(m => m.year === d.getFullYear() && m.month === d.getMonth());
    if (!bucket) return;
    if (t.type === 'income')       bucket.income  += safeAmt(t.amount);
    else if (t.type === 'expense') bucket.expense += safeAmt(t.amount);
  });

  el.innerHTML = `<div style="overflow-x:auto"><table class="history-table">
    <thead><tr>
      <th>Month</th>
      <th style="text-align:right">Income</th>
      <th style="text-align:right">Expenses</th>
      <th style="text-align:right">Net</th>
      <th style="text-align:right">Saved %</th>
    </tr></thead>
    <tbody>${months.map(m => {
      const inc  = roundMoney(m.income);
      const exp  = roundMoney(m.expense);
      const net  = roundMoney(inc - exp);
      const rate = inc > 0 ? Math.round(net / inc * 100) : null;
      const hasData = inc > 0 || exp > 0;
      const netC  = net >= 0 ? 'var(--green)' : 'var(--red)';
      const rateC = rate === null ? 'var(--muted)' : rate >= 20 ? 'var(--green)' : rate >= 10 ? 'var(--gold)' : 'var(--red)';
      return `<tr>
        <td><strong>${escapeHTML(m.label)}</strong></td>
        <td style="text-align:right;color:var(--green)">${inc > 0 ? fmt(inc) : '<span style="color:var(--muted)">—</span>'}</td>
        <td style="text-align:right;color:var(--red)">${exp > 0 ? fmt(exp) : '<span style="color:var(--muted)">—</span>'}</td>
        <td style="text-align:right;color:${netC};font-weight:700">${hasData ? fmt(net) : '<span style="color:var(--muted)">—</span>'}</td>
        <td style="text-align:right;color:${rateC};font-weight:700">${rate !== null ? rate + '%' : '—'}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function renderBudgetCard() {
  const el = document.getElementById('budget-setup');
  if (!el) return;
  const budgets = loadBudgets();
  const expenseCats = [
    'Rent','Utilities','Insurance','Groceries','Dining Out','Coffee',
    'Gas','Rideshare','Car Insurance','Parking','Medical','Pharmacy','Gym',
    'Clothing','Electronics','Amazon','Streaming','Events','Hobbies',
    'Tithe','Family Support','Donations','Loan Payment','Bank Fee','Subscriptions',
    'Education','Personal Care','Miscellaneous',
  ];
  el.innerHTML = `<div class="budget-grid">${expenseCats.map(cat => {
    const color = safeColor(CATEGORY_COLORS[cat], '#8a8aa6');
    const safeId = cat.replace(/\s+/g, '_');
    return `<div class="budget-field-group">
      <label class="acct-label" for="bgt-${safeId}">
        <span class="acct-badge" style="background:${color}"></span>${escapeHTML(cat)}
      </label>
      <input type="number" id="bgt-${safeId}" class="acct-input"
             min="0" step="1" placeholder="No limit"
             value="${budgets[cat] > 0 ? budgets[cat] : ''}"
             data-bgt-cat="${escapeHTML(cat)}">
    </div>`;
  }).join('')}</div>
  <div class="flex gap-8 mt-12">
    <button class="btn btn-green" id="save-budgets">Save Budgets</button>
    <button class="btn btn-ghost btn-sm" id="clear-budgets">Clear All</button>
  </div>`;
}

function saveBudgetsAction() {
  const budgets = {};
  document.querySelectorAll('[data-bgt-cat]').forEach(inp => {
    const cat = inp.dataset.bgtCat;
    const v = parseFloat(inp.value);
    if (!isNaN(v) && v > 0) budgets[cat] = roundMoney(v);
  });
  saveBudgets(budgets);
  renderCategoryBreakdown(getFilteredTxns());
}

function saveDebtMetaAction() {
  const meta = loadDebtMeta();
  document.querySelectorAll('[data-debt-id]').forEach(inp => {
    const id    = inp.dataset.debtId;
    const field = inp.dataset.debtField;
    const v     = parseFloat(inp.value);
    if (!meta[id]) meta[id] = { apr: 0, minPayment: 0 };
    meta[id][field] = (isNaN(v) || v < 0) ? 0 : roundMoney(v);
  });
  saveDebtMeta(meta);
  renderDebtDetails();
}

function renderRecurringCard() {
  const el = document.getElementById('recurring-summary');
  if (!el) return;
  const all = loadTxns();
  const recExpenses = all.filter(t => t.type === 'expense' && t.recurring === 'monthly' && safeAmt(t.amount) > 0);
  const card = document.getElementById('recurring-card');
  if (!recExpenses.length) {
    el.innerHTML = '';
    if (card) card.style.display = 'none';
    return;
  }
  if (card) card.style.display = '';

  // Sort newest-first so we keep the most recent entry per description
  recExpenses.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const seen = new Set();
  const unique = recExpenses.filter(t => {
    const key = (t.description || '').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const total = roundMoney(unique.reduce((s, t) => s + safeAmt(t.amount), 0));

  el.innerHTML = `<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:12px">
    <span style="font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em">Monthly Fixed Expenses</span>
    <span style="font-size:18px;font-weight:800;color:var(--red)">${fmt(total)}/mo</span>
  </div>${unique.map(t => {
    const color = safeColor(CATEGORY_COLORS[t.category], '#8a8aa6');
    return `<div class="cat-row" style="margin-bottom:6px">
      <div class="cat-label">${escapeHTML(t.description)}</div>
      <div style="flex:1"></div>
      <div class="cat-amount" style="color:var(--red)">${fmt(t.amount)}/mo</div>
      <div class="cat-pct" style="color:${color}">${escapeHTML(t.category)}</div>
    </div>`;
  }).join('')}`;
}

function renderTracker() {
  const txns = getFilteredTxns();
  renderTrackerSummary(txns);
  renderCategoryBreakdown(txns);
  renderDailyChart(txns);
  renderAccountBreakdown(txns);
  renderMonthlyTrends();
  renderRecurringCard();
  renderTransactionLog(txns);
}

// ─── Things Tracker State ────────────────────────────────────────
let thingsView     = 'list';  // 'list' | 'detail'
let thingsDetailId = null;
let thingsFilters  = { search: '', category: '', sort: 'name' };

// ─── Balance Trends Chart ────────────────────────────────────────
let balTrendGroup = 'net';

function buildTrendSVG(series, snapshots) {
  const W = 500, H = 150;
  const PAD = { top: 10, right: 14, bottom: 26, left: 50 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const n = snapshots.length;
  if (n === 0) return '';

  const allVals = series.flatMap(s => s.values).filter(Number.isFinite);
  if (!allVals.length) return '';

  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const rawRange = maxV - minV || 1;
  // Add 8% padding above and below so lines don't touch the edges
  const lo = minV - rawRange * 0.08;
  const hi = maxV + rawRange * 0.08;
  const range = hi - lo;

  const xPos = i => PAD.left + (n > 1 ? (i / (n - 1)) : 0.5) * innerW;
  const yPos = v => PAD.top + innerH - ((v - lo) / range) * innerH;

  // Grid lines (3 horizontal)
  const gridVals = [lo + range * 0.25, lo + range * 0.5, lo + range * 0.75];
  const gridHtml = gridVals.map(v => {
    const y = yPos(v).toFixed(1);
    return `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="var(--border)" stroke-width="1"/>
    <text x="${PAD.left - 5}" y="${(parseFloat(y) + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#8a8aa6">${escapeHTML(fmtShort(v))}</text>`;
  }).join('');

  // X-axis date labels
  const xLabels = snapshots.map((s, i) => {
    if (n > 8 && i % 2 !== 0 && i !== n - 1) return '';
    return `<text x="${xPos(i).toFixed(1)}" y="${H - 5}" text-anchor="middle" font-size="9" fill="#8a8aa6">${escapeHTML(s.date.slice(5))}</text>`;
  }).join('');

  // Series polylines + dots
  const seriesHtml = series.map(s => {
    if (!s.values.length) return '';
    const points = s.values.map((v, i) => `${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}`).join(' ');
    const dots = s.values.map((v, i) =>
      `<circle class="trend-dot" cx="${xPos(i).toFixed(1)}" cy="${yPos(v).toFixed(1)}" r="3.5" fill="${s.color}">` +
      `<title>${escapeHTML(s.label)}: ${fmt(v)} · ${fmtDate(snapshots[i].date)}</title></circle>`
    ).join('');
    return `<polyline points="${points}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>` + dots;
  }).join('');

  return `<div class="trend-chart-wrap"><svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" aria-hidden="true">
    ${gridHtml}${xLabels}${seriesHtml}
  </svg></div>`;
}

function renderBalanceTrends() {
  const snaps = loadSnapshots();
  const card  = document.getElementById('balance-trends-card');
  const el    = document.getElementById('balance-trends-content');
  const countEl = document.getElementById('trend-snap-count');
  if (!card || !el) return;

  if (snaps.length < 2) { card.style.display = 'none'; return; }
  card.style.display = '';
  if (countEl) countEl.textContent = `${snaps.length} snapshot${snaps.length !== 1 ? 's' : ''}`;

  const last12 = snaps.slice(-12);
  const allLoans = loadLoans();
  let series = [];

  if (balTrendGroup === 'net') {
    const groupDefs = [
      { id: 'checking',   label: 'Checking',     color: '#60a5fa' },
      { id: 'savings',    label: 'Savings',       color: '#4ade80' },
      { id: 'investment', label: 'Investments',   color: '#a78bfa' },
      { id: 'debt',       label: 'Debt',          color: '#f87171' },
    ];
    groupDefs.forEach(g => {
      series.push({
        label: g.label, color: g.color,
        values: last12.map(s => {
          const b = s.accounts || {};
          const total = roundMoney(ACCOUNTS.filter(a => a.group === g.id).reduce((sum, a) => sum + safeAmt(b[a.id]), 0));
          return g.id === 'debt' ? -total : total;
        }),
      });
    });
    // Net Worth line
    series.push({
      label: 'Net Worth', color: '#2dd4bf',
      values: last12.map(s => {
        const b = s.accounts || {};
        const assets = ACCOUNTS.filter(a => a.group !== 'debt').reduce((sum, a) => sum + safeAmt(b[a.id]), 0);
        const liab   = ACCOUNTS.filter(a => a.group === 'debt').reduce((sum, a) => sum + safeAmt(b[a.id]), 0);
        const loansAt = roundMoney(allLoans
          .filter(l => l.date <= s.date && (l.status === 'outstanding' || l.paidDate > s.date))
          .reduce((sum, l) => sum + safeAmt(l.amount), 0));
        return roundMoney(assets + loansAt - liab);
      }),
    });
  } else {
    ACCOUNTS.filter(a => a.group === balTrendGroup).forEach(a => {
      series.push({
        label: a.label, color: safeColor(a.color),
        values: last12.map(s => {
          const v = safeAmt((s.accounts || {})[a.id]);
          return a.group === 'debt' ? -v : v;
        }),
      });
    });
  }

  const tabs = [
    { id: 'net',        label: 'Overview'     },
    { id: 'checking',   label: 'Checking'     },
    { id: 'savings',    label: 'Savings'      },
    { id: 'investment', label: 'Investments'  },
    { id: 'debt',       label: 'Debt'         },
  ];
  const tabsHtml = `<div class="trend-tabs">${tabs.map(t =>
    `<button class="trend-tab${balTrendGroup === t.id ? ' active' : ''}" data-trend-group="${t.id}">${escapeHTML(t.label)}</button>`
  ).join('')}</div>`;

  const legendHtml = `<div class="trend-legend">${series.map(s =>
    `<div class="trend-legend-item"><span class="trend-legend-dot" style="background:${s.color}"></span>${escapeHTML(s.label)}</div>`
  ).join('')}</div>`;

  el.innerHTML = tabsHtml + buildTrendSVG(series, last12) + legendHtml;
}

// ─── Transaction CRUD ────────────────────────────────────────────
let editingId = null;

function saveTransaction() {
  const date      = document.getElementById('txn-date')?.value;
  const type      = document.getElementById('txn-type')?.value;
  const amtRaw    = parseFloat(document.getElementById('txn-amount')?.value);
  const acct      = document.getElementById('txn-account')?.value;
  const toAcct    = document.getElementById('txn-to-account')?.value || '';
  const cat       = document.getElementById('txn-category')?.value;
  const desc      = document.getElementById('txn-desc')?.value?.trim();
  const recurring = document.getElementById('txn-recurring')?.value || '';

  if (!date || isNaN(amtRaw) || amtRaw <= 0 || !desc) {
    alert('Please fill in date, description, and a positive amount.');
    return;
  }
  if (type === 'transfer' && !toAcct) {
    alert('Please select a destination account for the transfer.');
    return;
  }

  const txns = loadTxns();

  if (editingId !== null) {
    const idx = txns.findIndex(t => String(t.id) === String(editingId));
    if (idx !== -1) {
      txns[idx] = { ...txns[idx], date, type, amount: roundMoney(amtRaw), account: acct, toAccount: toAcct, category: cat, description: desc, recurring };
    }
    editingId = null;
    cancelEdit();
  } else {
    const id = crypto.randomUUID();
    txns.push({ id, date, type, amount: roundMoney(amtRaw), account: acct, toAccount: toAcct, category: cat, description: desc, recurring });
  }

  saveTxns(txns);
  resetTxnForm();
  renderTracker();
}

function editTransaction(id) {
  const txns = loadTxns();
  const t = txns.find(t => String(t.id) === String(id));
  if (!t) return;

  editingId = id;
  document.getElementById('txn-date').value     = t.date;
  document.getElementById('txn-type').value     = t.type;
  document.getElementById('txn-amount').value   = t.amount;
  document.getElementById('txn-account').value  = t.account;
  document.getElementById('txn-category').value = t.category;
  document.getElementById('txn-desc').value     = t.description;
  const recEl = document.getElementById('txn-recurring');
  if (recEl) recEl.value = t.recurring || '';
  const toAcctEl = document.getElementById('txn-to-account');
  if (toAcctEl) toAcctEl.value = t.toAccount || '';
  updateToAccountVisibility();

  const lbl = document.getElementById('txn-form-label');
  if (lbl) lbl.textContent = 'Edit Transaction';
  const savBtn = document.getElementById('save-txn');
  if (savBtn) savBtn.textContent = 'Save Changes';
  document.getElementById('cancel-edit')?.classList.remove('hidden');

  document.getElementById('txn-date')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function cancelEdit() {
  editingId = null;
  resetTxnForm();
  const lbl = document.getElementById('txn-form-label');
  if (lbl) lbl.textContent = 'Add Transaction';
  const savBtn = document.getElementById('save-txn');
  if (savBtn) savBtn.textContent = 'Add Transaction';
  document.getElementById('cancel-edit')?.classList.add('hidden');
}

function deleteTransaction(id) {
  const txns = loadTxns();
  const idx = txns.findIndex(t => String(t.id) === String(id));
  if (idx === -1) return;
  if (!confirm(`Delete "${txns[idx].description}"?`)) return;
  txns.splice(idx, 1);
  saveTxns(txns);
  if (String(editingId) === String(id)) cancelEdit();
  renderTracker();
}

function resetTxnForm() {
  document.getElementById('txn-amount').value   = '';
  document.getElementById('txn-desc').value     = '';
  document.getElementById('txn-date').value     = todayISO();
  document.getElementById('txn-type').value     = 'expense';
  const defaultAcct = (ACCOUNTS.find(a => a.group === 'checking') || ACCOUNTS[0])?.id || '';
  document.getElementById('txn-account').value  = defaultAcct;
  document.getElementById('txn-category').value = 'Miscellaneous';
  const recEl = document.getElementById('txn-recurring');
  if (recEl) recEl.value = '';
  const toAcctEl = document.getElementById('txn-to-account');
  if (toAcctEl) toAcctEl.value = defaultAcct;
  updateToAccountVisibility();
}

function updateToAccountVisibility() {
  const type  = document.getElementById('txn-type')?.value;
  const group = document.getElementById('to-account-group');
  if (group) group.style.display = type === 'transfer' ? '' : 'none';
}

function exportTransactions() {
  const txns = getFilteredTxns();
  if (!txns.length) { showToast('No transactions to export for this filter.', 'info'); return; }

  const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date));
  const header = ['Date', 'Description', 'Type', 'Amount', 'Account', 'To Account', 'Category', 'Recurring'];
  const rows = sorted.map(t => [
    t.date, t.description, t.type,
    t.type === 'expense' ? -t.amount : t.amount,
    ACCOUNT_LABELS[t.account] || t.account,
    t.toAccount ? (ACCOUNT_LABELS[t.toAccount] || t.toAccount) : '',
    t.category,
    t.recurring || '',
  ]);

  const csv = [header, ...rows].map(r => r.map(csvField).join(',')).join('\r\n');
  downloadCSV(csv, `MoneyTrack_Transactions_${todayISO()}.csv`);
}

// ─── PDF Export ──────────────────────────────────────────────────
const PDF_STYLES = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;font-size:12px;color:#111;padding:24px}
  h1{font-size:16px;font-weight:700;margin-bottom:4px}
  .sub{font-size:11px;color:#555;margin-bottom:16px}
  table{width:100%;border-collapse:collapse;font-size:11px;table-layout:auto}
  thead{display:table-header-group}
  th{background:#f0f0f0;text-align:left;padding:5px 8px;border:1px solid #ccc;font-weight:600}
  td{padding:5px 8px;border:1px solid #ddd;vertical-align:top;word-break:break-word;max-width:200px}
  tr{page-break-inside:avoid}
  tr:nth-child(even) td{background:#fafafa}
  .num{text-align:right}
  .green{color:#16a34a}
  .red{color:#dc2626}
  @media print{
    @page{margin:12mm}
    body{padding:0}
  }
`;
const PDF_STYLES_LANDSCAPE = PDF_STYLES + `@media print{@page{size:landscape;margin:12mm}}`;

function openPrintWindow(title, subtitle, html, styles) {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { showToast('Pop-up blocked. Please allow pop-ups for this page and try again.', 'error'); return; }
  const doc = w.document;
  doc.open();
  doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + escapeHTML(title) + '</title>' +
    '<style>' + (styles || PDF_STYLES) + '</style></head><body>' +
    '<h1>' + escapeHTML(title) + '</h1><div class="sub">' + escapeHTML(subtitle) + '</div></body></html>');
  doc.close();
  // Inject the pre-rendered HTML safely via DOM rather than document.write
  const container = doc.createElement('div');
  container.innerHTML = html;
  doc.body.appendChild(container);
  setTimeout(() => { w.focus(); w.print(); }, 300);
}

function exportSnapshotsPDF() {
  const snaps = loadSnapshots();
  if (!snaps.length) { showToast('No snapshots to export.', 'info'); return; }

  const cols = ACCOUNTS;
  const allLoansForPDF = loadLoans();
  const rows = snaps.map(s => {
    const b = s.accounts || {};
    const savings    = roundMoney(ACCOUNTS.filter(a => a.group === 'savings').reduce((sum, a) => sum + safeAmt(b[a.id]), 0));
    const checking   = roundMoney(ACCOUNTS.filter(a => a.group === 'checking').reduce((sum, a) => sum + safeAmt(b[a.id]), 0));
    const investment = roundMoney(ACCOUNTS.filter(a => a.group === 'investment').reduce((sum, a) => sum + safeAmt(b[a.id]), 0));
    const debt       = roundMoney(ACCOUNTS.filter(a => a.group === 'debt').reduce((sum, a) => sum + safeAmt(b[a.id]), 0));
    const loansOut   = roundMoney(allLoansForPDF
      .filter(l => l.date <= s.date && (l.status === 'outstanding' || l.paidDate > s.date))
      .reduce((sum, l) => sum + safeAmt(l.amount), 0));
    const net        = roundMoney(savings + checking + investment + loansOut - debt);
    return { date: s.date, note: s.note || '', savings, checking, investment, debt, net };
  });

  const thCols = cols.map(a => `<th class="num">${escapeHTML(a.label)}</th>`).join('');
  const header = `<tr><th>Date</th><th>Note</th><th class="num">Savings</th><th class="num">Checking</th><th class="num">Investment</th><th class="num">Debt</th><th class="num">Net Worth</th>${thCols}</tr>`;

  const bodyRows = snaps.map((s, i) => {
    const r = rows[i];
    const b = s.accounts || {};
    const netCls = r.net >= 0 ? 'green' : 'red';
    const acctCells = cols.map(a => `<td class="num">${fmt(a.group === 'debt' ? -(b[a.id]||0) : (b[a.id]||0))}</td>`).join('');
    return `<tr>
      <td>${escapeHTML(s.date)}</td>
      <td>${escapeHTML(r.note)}</td>
      <td class="num">${fmt(r.savings)}</td>
      <td class="num">${fmt(r.checking)}</td>
      <td class="num">${fmt(r.investment)}</td>
      <td class="num red">${fmt(-r.debt)}</td>
      <td class="num ${netCls}">${fmt(r.net)}</td>
      ${acctCells}
    </tr>`;
  }).join('');

  openPrintWindow(
    'MoneyTrack — Balance History',
    `Exported ${todayISO()} · ${snaps.length} snapshot${snaps.length !== 1 ? 's' : ''}`,
    `<table><thead>${header}</thead><tbody>${bodyRows}</tbody></table>`,
    PDF_STYLES_LANDSCAPE
  );
}

function exportTransactionsPDF() {
  const txns = getFilteredTxns();
  if (!txns.length) { showToast('No transactions to export for this filter.', 'info'); return; }

  const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date));

  const header = `<tr><th>Date</th><th>Description</th><th>Type</th><th>Category</th><th>Account</th><th class="num">Amount</th></tr>`;

  const bodyRows = sorted.map(t => {
    const amt = t.type === 'expense' ? -t.amount : t.amount;
    const amtCls = amt >= 0 ? 'green' : 'red';
    const sign = t.type === 'income' ? '+' : t.type === 'transfer' ? '' : '-';
    return `<tr>
      <td>${escapeHTML(t.date)}</td>
      <td>${escapeHTML(t.description || '')}${t.toAccount ? ` → ${escapeHTML(ACCOUNT_LABELS[t.toAccount] || t.toAccount)}` : ''}</td>
      <td>${escapeHTML(t.type)}</td>
      <td>${escapeHTML(t.category)}</td>
      <td>${escapeHTML(ACCOUNT_LABELS[t.account] || t.account)}</td>
      <td class="num ${amtCls}">${sign}${fmt(Math.abs(t.amount))}</td>
    </tr>`;
  }).join('');

  openPrintWindow(
    'MoneyTrack — Transactions',
    `Exported ${todayISO()} · ${sorted.length} transaction${sorted.length !== 1 ? 's' : ''}`,
    `<table><thead>${header}</thead><tbody>${bodyRows}</tbody></table>`
  );
}

// ─── CSV Download ────────────────────────────────────────────────
function downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Bank CSV Import ─────────────────────────────────────────────
// Keys are checked in order — longer/more-specific keys MUST come before
// shorter ones that would otherwise match first (e.g. 'uber eats' before 'uber').
const BANK_CATEGORY_MAP = [
  ['uber eats',     'Dining Out'],   ['doordash',      'Dining Out'],   ['grubhub',       'Dining Out'],
  ['mcdonald',      'Dining Out'],   ['chick-fil',     'Dining Out'],   ['chipotle',      'Dining Out'],
  ['whole foods',   'Groceries'],    ['trader joe',    'Groceries'],    ['walmart',       'Groceries'],
  ['publix',        'Groceries'],    ['kroger',        'Groceries'],    ['aldi',          'Groceries'],
  ['apple music',   'Streaming'],    ['netflix',       'Streaming'],    ['spotify',       'Streaming'],
  ['hulu',          'Streaming'],
  ['apple.com',     'Subscriptions'],['icloud',        'Subscriptions'],['chatgpt',       'Subscriptions'],
  ['openai',        'Subscriptions'],['google one',    'Subscriptions'],
  ['planet fitness','Gym'],          ['gym',           'Gym'],
  ['car insurance', 'Car Insurance'],['geico',         'Car Insurance'],['progressive',   'Car Insurance'],
  ['allstate',      'Insurance'],
  ['amazon',        'Amazon'],       ['amzn',          'Amazon'],
  ['starbucks',     'Coffee'],       ['dunkin',        'Coffee'],
  ['uber',          'Rideshare'],    ['lyft',          'Rideshare'],
  ['shell',         'Gas'],          ['chevron',       'Gas'],          ['exxon',         'Gas'],
  ['wawa',          'Gas'],          ['bp ',           'Gas'],          ['speedway',      'Gas'],
  ['direct dep',    'Paycheck'],     ['payroll',       'Paycheck'],
  ['zelle',         'Transfer In'],
  ['cvs',           'Pharmacy'],     ['walgreens',     'Pharmacy'],
  ['tithe',         'Tithe'],        ['church',        'Tithe'],
  ['rent',          'Rent'],
];

function mapBankCategory(description) {
  const d = description.toLowerCase();
  for (const [key, cat] of BANK_CATEGORY_MAP) {
    if (d.includes(key)) return cat;
  }
  return 'Miscellaneous';
}

function parseCSVLine(line) {
  const fields = [];
  let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) { fields.push(cur); cur = ''; }
    else cur += c;
  }
  fields.push(cur);
  return fields.map(f => f.trim());
}

function detectCSVFormat(headers) {
  const h = headers.map(x => x.toLowerCase().replace(/[^a-z.]/g, ' ').trim());
  if (h.some(x => x.includes('transaction date')) && h.some(x => x.includes('post date'))) return 'chase';
  if (h.some(x => x.includes('trans. date') || x.includes('trans date'))) return 'discover';
  return 'generic';
}

function parseChaseCSV(lines) {
  // Chase: Transaction Date, Post Date, Description, Category, Type, Amount, Memo
  const txns = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const f = parseCSVLine(lines[i]);
    const date = f[0]?.trim(); const desc = f[2]?.trim() || ''; const amount = parseFloat(f[5]);
    if (!date || isNaN(amount)) continue;
    const [m, d, y] = date.split('/');
    const iso = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    txns.push({ date: iso, description: desc, amount: Math.abs(amount), type: amount < 0 ? 'expense' : 'income' });
  }
  return txns;
}

function parseDiscoverCSV(lines) {
  // Discover: Trans. Date, Post Date, Description, Amount, Category
  const txns = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const f = parseCSVLine(lines[i]);
    const date = f[0]?.trim(); const desc = f[2]?.trim() || ''; const amount = parseFloat(f[3]);
    if (!date || isNaN(amount)) continue;
    const [m, d, y] = date.split('/');
    const iso = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    // Discover: positive = expense, negative = payment/credit
    txns.push({ date: iso, description: desc, amount: Math.abs(amount), type: amount > 0 ? 'expense' : 'income' });
  }
  return txns;
}

function parseGenericCSV(lines) {
  const txns = [];
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const f = parseCSVLine(lines[i]);
    const dateRaw = f[0]?.trim() || '';
    const desc    = f[1]?.trim() || '';
    const amtStr  = f[2] || f[3] || f[f.length - 1];
    const amount  = parseFloat((amtStr || '').replace(/[^0-9.\-]/g, ''));
    if (!dateRaw || isNaN(amount)) continue;
    let iso = '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
      iso = dateRaw;
    } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateRaw)) {
      const [m, d, y] = dateRaw.split('/');
      iso = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    } else { skipped++; continue; }
    txns.push({ date: iso, description: desc, amount: Math.abs(amount), type: amount < 0 ? 'expense' : 'income' });
  }
  return { txns, skipped };
}

function importBankCSV(file) {
  if (!file) return;
  const defaultAccount = ACCOUNTS[0]?.id || '';
  const reader = new FileReader();
  reader.onerror = () => showToast('Failed to read CSV file.', 'error');
  reader.onload = e => {
    try {
      const text   = e.target.result;
      const lines  = text.split(/\r?\n/);
      if (lines.length < 2) throw new Error('File appears empty');
      const headers = parseCSVLine(lines[0]);
      if (headers.length < 3) throw new Error('CSV must have at least 3 columns (date, description, amount)');
      const format  = detectCSVFormat(headers);
      let parsed; let skippedRows = 0;
      if (format === 'chase')         parsed = parseChaseCSV(lines);
      else if (format === 'discover') parsed = parseDiscoverCSV(lines);
      else {
        const result = parseGenericCSV(lines);
        parsed = result.txns; skippedRows = result.skipped;
      }
      if (!parsed.length) throw new Error('No valid transactions found in file');

      const existing = loadTxns();
      const seen = new Set(existing.map(t => `${t.date}|${t.description}|${t.amount}`));
      const newTxns = parsed
        .filter(t => !seen.has(`${t.date}|${t.description}|${t.amount}`))
        .map(t => ({
          id:          crypto.randomUUID(),
          date:        t.date,
          type:        t.type,
          amount:      roundMoney(t.amount),
          account:     defaultAccount,
          description: t.description,
          category:    mapBankCategory(t.description),
          recurring:   '',
        }));

      if (!newTxns.length) {
        showToast(`No new transactions to import (${parsed.length} already exist).`, 'info');
        return;
      }
      if (!confirm(`Import ${newTxns.length} new transaction(s) from "${file.name}"?\n\nFormat detected: ${format.toUpperCase()}\n\nNew transactions will be assigned to "${ACCOUNT_LABELS[defaultAccount] || defaultAccount}".`)) return;
      saveTxns([...existing, ...newTxns].sort((a, b) => b.date.localeCompare(a.date)));
      renderTracker();
      showToast(`Imported ${newTxns.length} transaction(s) successfully.`, 'success');
      if (skippedRows > 0) {
        setTimeout(() => showToast(`${skippedRows} row${skippedRows > 1 ? 's' : ''} skipped (unrecognized date format).`, 'info'), 3800);
      }
    } catch (err) {
      showToast('Failed to import CSV: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

// ─── Things Tracker — Calculations ───────────────────────────────
function calcUnitCost(entry) {
  if (!entry.quantity || entry.quantity <= 0) return null;
  return roundMoney(entry.totalPrice / entry.quantity);
}

function dateDiffDays(isoA, isoB) {
  const a = new Date(isoA + 'T00:00:00'), b = new Date(isoB + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

function calcEntryDiff(curr, prev) {
  const uc = calcUnitCost(curr), up = calcUnitCost(prev);
  const days = dateDiffDays(prev.date, curr.date);
  return {
    priceChange:    roundMoney(curr.totalPrice - prev.totalPrice),
    pricePct:       prev.totalPrice ? roundMoney(((curr.totalPrice - prev.totalPrice) / prev.totalPrice) * 100) : null,
    qtyChange:      roundMoney(curr.quantity - prev.quantity),
    qtyPct:         prev.quantity ? roundMoney(((curr.quantity - prev.quantity) / prev.quantity) * 100) : null,
    unitCostChange: (uc != null && up != null) ? roundMoney(uc - up) : null,
    unitCostPct:    (uc != null && up != null && up !== 0) ? roundMoney(((uc - up) / up) * 100) : null,
    daysSince:      days,
    usageRate:      (prev.quantity && days > 0) ? roundMoney(prev.quantity / days) : null,
  };
}

function calcItemStats(entries) {
  if (!entries.length) return null;
  const sorted = [...entries].sort((a,b) => a.date.localeCompare(b.date));
  const costs = sorted.map(calcUnitCost).filter(c => c != null);
  return {
    count:       sorted.length,
    totalSpent:  roundMoney(sorted.reduce((s,e) => s + e.totalPrice, 0)),
    avgUnitCost: costs.length ? roundMoney(costs.reduce((s,c) => s+c, 0) / costs.length) : null,
    minUnitCost: costs.length ? Math.min(...costs) : null,
    maxUnitCost: costs.length ? Math.max(...costs) : null,
    trend:       costs.length >= 4 ? thingsTrendDirection(costs) : 'flat',
    lastEntry:   sorted[sorted.length - 1],
    firstEntry:  sorted[0],
  };
}

function thingsTrendDirection(values) {
  const mid = Math.floor(values.length / 2);
  const first = values.slice(0, mid), second = values.slice(mid);
  const avgFirst  = first.reduce((s,v) => s+v, 0) / first.length;
  const avgSecond = second.reduce((s,v) => s+v, 0) / second.length;
  const pct = avgFirst !== 0 ? ((avgSecond - avgFirst) / avgFirst) * 100 : 0;
  if (pct > 2) return 'up';
  if (pct < -2) return 'down';
  return 'flat';
}

function generateInsight(item, entries) {
  if (entries.length < 2) return null;
  const sorted = [...entries].sort((a,b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];
  const diff = calcEntryDiff(last, prev);
  const parts = [];
  if (diff.unitCostPct != null) {
    if (diff.unitCostPct > 5)       parts.push(`Unit cost up ${diff.unitCostPct.toFixed(1)}% vs last purchase`);
    else if (diff.unitCostPct < -5) parts.push(`Unit cost down ${Math.abs(diff.unitCostPct).toFixed(1)}% — good deal`);
  }
  if (diff.daysSince != null && diff.daysSince > 0 && diff.usageRate != null) {
    parts.push(`Using ~${diff.usageRate.toFixed(2)} ${escapeHTML(last.unit)}/day`);
  }
  if (diff.daysSince != null && diff.daysSince >= 0) {
    parts.push(`${diff.daysSince} day${diff.daysSince === 1 ? '' : 's'} since last purchase`);
  }
  return parts.length ? parts.join(' · ') : null;
}

// ─── Things Tracker — Render ──────────────────────────────────────
function renderThingsTab() {
  if (thingsView === 'detail' && thingsDetailId) {
    renderThingsDetailView(thingsDetailId);
  } else {
    thingsView = 'list';
    const listView = document.getElementById('things-list-view');
    const detailView = document.getElementById('things-detail-view');
    if (listView)   listView.style.display   = '';
    if (detailView) detailView.style.display = 'none';
    renderThingsDashboard();
    renderThingsControls();
    renderThingsItemGrid();
  }
}

function renderThingsDashboard() {
  const el = document.getElementById('things-kpis');
  if (!el) return;
  const items   = loadThingsItems();
  const entries = loadThingsEntries();
  const totalSpent = roundMoney(entries.reduce((s,e) => s + (e.totalPrice || 0), 0));
  const risingCount = items.filter(item => {
    const ents = entries.filter(e => e.itemId === item.id).sort((a,b) => a.date.localeCompare(b.date));
    const costs = ents.map(calcUnitCost).filter(c => c != null);
    return costs.length >= 4 && thingsTrendDirection(costs) === 'up';
  }).length;

  el.innerHTML = `
    <div class="kpi"><div class="kpi-label">Items Tracked</div><div class="kpi-value">${items.length}</div></div>
    <div class="kpi"><div class="kpi-label">Entries Logged</div><div class="kpi-value">${entries.length}</div></div>
    <div class="kpi"><div class="kpi-label">Total Spent</div><div class="kpi-value">${fmt(totalSpent)}</div></div>
    <div class="kpi"><div class="kpi-label">Rising Prices</div><div class="kpi-value things-trend-up">${risingCount}</div></div>
  `;
}

function renderThingsControls() {
  const el = document.getElementById('things-controls');
  if (!el) return;
  const cats = getThingsCats();
  const catOptions = cats.map(c =>
    `<option value="${escapeHTML(c)}"${thingsFilters.category === c ? ' selected' : ''}>${escapeHTML(c)}</option>`
  ).join('');
  el.innerHTML = `
    <input type="text" id="things-search" placeholder="Search items…" value="${escapeHTML(thingsFilters.search)}"
           style="background:var(--surf2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);padding:7px 10px;font-size:12px;outline:none;flex:1;min-width:120px;">
    <select id="things-cat-filter" style="background:var(--surf2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);padding:7px 10px;font-size:12px;outline:none;flex:1;min-width:120px;">
      <option value="">All Categories</option>
      ${catOptions}
    </select>
    <select id="things-sort" style="background:var(--surf2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);padding:7px 10px;font-size:12px;outline:none;">
      <option value="name"${thingsFilters.sort==='name'?' selected':''}>Name A→Z</option>
      <option value="recent"${thingsFilters.sort==='recent'?' selected':''}>Most Recent</option>
      <option value="spent"${thingsFilters.sort==='spent'?' selected':''}>Most Spent</option>
    </select>
    <button class="btn btn-green btn-sm" id="things-show-add-item">+ Add Item</button>
  `;
}

function renderThingsItemGrid() {
  const el = document.getElementById('things-item-grid');
  if (!el) return;
  let items   = loadThingsItems();
  const allEntries = loadThingsEntries();

  // Filter
  const search = thingsFilters.search.toLowerCase();
  if (search)                  items = items.filter(i => i.name.toLowerCase().includes(search));
  if (thingsFilters.category)  items = items.filter(i => i.category === thingsFilters.category);

  // Sort
  items = [...items].sort((a,b) => {
    if (thingsFilters.sort === 'name')   return a.name.localeCompare(b.name);
    if (thingsFilters.sort === 'recent') {
      const la = allEntries.filter(e => e.itemId === a.id).sort((x,y) => y.date.localeCompare(x.date))[0];
      const lb = allEntries.filter(e => e.itemId === b.id).sort((x,y) => y.date.localeCompare(x.date))[0];
      return (lb?.date || '').localeCompare(la?.date || '');
    }
    if (thingsFilters.sort === 'spent') {
      const sa = allEntries.filter(e => e.itemId === a.id).reduce((s,e) => s + e.totalPrice, 0);
      const sb = allEntries.filter(e => e.itemId === b.id).reduce((s,e) => s + e.totalPrice, 0);
      return sb - sa;
    }
    return 0;
  });

  if (!items.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">📦</div><p>No items yet. Click + Add Item to start tracking.</p></div>`;
    return;
  }

  el.innerHTML = items.map(item => {
    const entries = allEntries.filter(e => e.itemId === item.id).sort((a,b) => a.date.localeCompare(b.date));
    const stats = calcItemStats(entries);
    const lastUC = stats?.lastEntry ? calcUnitCost(stats.lastEntry) : null;
    const trendIcon = !stats ? '→' : stats.trend === 'up' ? '↑' : stats.trend === 'down' ? '↓' : '→';
    const trendClass = !stats ? 'things-trend-flat' : `things-trend-${stats.trend}`;
    const lastDate = stats?.lastEntry ? fmtDate(stats.lastEntry.date) : '—';
    return `
      <div class="things-item-card">
        <div class="things-item-name">${escapeHTML(item.name)}</div>
        <span class="things-cat-badge">${escapeHTML(item.category)}</span>
        <div class="things-unit-cost">${lastUC != null ? fmt(lastUC) + '<small style="font-size:11px;font-weight:400;color:var(--muted)">/${escapeHTML(stats.lastEntry.unit)}</small>' : '<span style="color:var(--muted);font-size:13px">No entries yet</span>'}</div>
        <div style="font-size:11px;color:var(--muted);display:flex;gap:8px;align-items:center">
          <span class="${trendClass}">${trendIcon}</span>
          <span>${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}</span>
          <span>Last: ${lastDate}</span>
        </div>
        <div class="flex gap-8 mt-8">
          <button class="btn btn-ghost btn-sm" style="flex:1" data-things-detail="${escapeHTML(item.id)}">View →</button>
          <button class="txn-btn del" data-del-thing="${escapeHTML(item.id)}" aria-label="Delete ${escapeHTML(item.name)}">✕</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderThingsDetailView(itemId) {
  const items = loadThingsItems();
  const item  = items.find(i => i.id === itemId);
  if (!item) { showThingsList(); return; }

  const listView   = document.getElementById('things-list-view');
  const detailView = document.getElementById('things-detail-view');
  if (listView)   listView.style.display   = 'none';
  if (!detailView) return;
  detailView.style.display = '';

  const entries = getItemEntries(itemId);
  const stats   = calcItemStats(entries);
  const insight = generateInsight(item, entries);

  // Build entry rows
  const entryRows = entries.slice().reverse().map((entry, revIdx) => {
    const origIdx = entries.length - 1 - revIdx;
    const uc = calcUnitCost(entry);
    const prev = entries[origIdx - 1];
    const diff = prev ? calcEntryDiff(entry, prev) : null;
    const diffBadge = diff && diff.unitCostPct != null
      ? `<span class="things-diff-badge ${diff.unitCostPct > 0 ? 'up' : 'down'}">${diff.unitCostPct > 0 ? '+' : ''}${diff.unitCostPct.toFixed(1)}%</span>`
      : '';
    return `
      <tr>
        <td>${fmtDate(entry.date)}</td>
        <td>${escapeHTML(entry.store || '—')}</td>
        <td>${entry.quantity} ${escapeHTML(entry.unit)}</td>
        <td>${fmt(entry.totalPrice)}</td>
        <td>${uc != null ? fmt(uc) : '—'}${diffBadge}</td>
        <td><button class="txn-btn del" data-del-entry="${escapeHTML(entry.id)}" aria-label="Delete entry">✕</button></td>
      </tr>
    `;
  }).join('');

  detailView.innerHTML = `
    <div class="card">
      <div class="card-title">
        <button class="btn btn-ghost btn-sm" id="things-back">← Back</button>
        <span style="font-size:14px;font-weight:700;color:var(--text)">${escapeHTML(item.name)}</span>
        <span class="things-cat-badge">${escapeHTML(item.category)}</span>
      </div>
      ${item.notes ? `<p style="font-size:12px;color:var(--muted);margin-bottom:10px">${escapeHTML(item.notes)}</p>` : ''}
      ${insight ? `<div class="things-insight">${insight}</div>` : ''}

      ${stats ? `
      <div class="ratios-grid" style="margin-bottom:14px">
        <div class="ratio-card"><div class="ratio-label">Total Spent</div><div class="ratio-value">${fmt(stats.totalSpent)}</div><div class="ratio-sub">${stats.count} purchase${stats.count === 1 ? '' : 's'}</div></div>
        <div class="ratio-card"><div class="ratio-label">Avg Unit Cost</div><div class="ratio-value">${stats.avgUnitCost != null ? fmt(stats.avgUnitCost) : '—'}</div></div>
        <div class="ratio-card"><div class="ratio-label">Best Price</div><div class="ratio-value things-trend-down">${stats.minUnitCost != null ? fmt(stats.minUnitCost) : '—'}</div></div>
        <div class="ratio-card"><div class="ratio-label">Highest Price</div><div class="ratio-value things-trend-up">${stats.maxUnitCost != null ? fmt(stats.maxUnitCost) : '—'}</div></div>
      </div>
      ` : ''}

      ${entries.length >= 2 ? `
      <div style="margin-bottom:14px">
        <svg class="things-chart" viewBox="0 0 300 80" aria-hidden="true" id="things-svg-${escapeHTML(itemId)}"></svg>
      </div>
      ` : ''}

      <div style="margin-bottom:12px">
        <button class="btn btn-green btn-sm" id="things-show-add-entry">+ Log Purchase</button>
      </div>
      <div id="things-add-entry-form" style="display:none"></div>

      ${entries.length ? `
      <div style="overflow-x:auto">
        <table class="history-table">
          <thead><tr><th>Date</th><th>Store</th><th>Qty / Unit</th><th>Total</th><th>Unit Cost</th><th></th></tr></thead>
          <tbody>${entryRows}</tbody>
        </table>
      </div>
      ` : `<div class="empty-state"><div class="empty-icon">📝</div><p>No purchases logged yet.</p></div>`}
    </div>
  `;

  // Build SVG chart after DOM is ready
  if (entries.length >= 2) {
    const svg = document.getElementById(`things-svg-${itemId}`);
    if (svg) buildThingsChart(entries, svg);
  }
}

function buildThingsChart(entries, svgEl) {
  const costs = entries.map(calcUnitCost).filter(c => c != null);
  if (costs.length < 2) return;
  const minC = Math.min(...costs), maxC = Math.max(...costs);
  const range = maxC - minC || 1;
  const W = 300, H = 80, pad = 8;
  const pts = costs.map((c, i) => {
    const x = pad + (i / (costs.length - 1)) * (W - pad * 2);
    const y = H - pad - ((c - minC) / range) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  svgEl.innerHTML = `
    <polyline points="${pts.join(' ')}" fill="none" stroke="var(--green)" stroke-width="2" stroke-linejoin="round"/>
    ${costs.map((c, i) => {
      const x = pad + (i / (costs.length - 1)) * (W - pad * 2);
      const y = H - pad - ((c - minC) / range) * (H - pad * 2);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="var(--green)" class="trend-dot"/>`;
    }).join('')}
  `;
}

function renderThingsAddItemForm() {
  const formEl = document.getElementById('things-add-item-form');
  if (!formEl) return;
  const cats = getThingsCats();
  formEl.innerHTML = `
    <div class="card-title">Add New Item</div>
    <div class="form-grid">
      <div class="form-group">
        <label for="things-new-name">Item Name <span style="color:var(--red)">*</span></label>
        <input type="text" id="things-new-name" placeholder="e.g. Tide Detergent" maxlength="80" required>
      </div>
      <div class="form-group">
        <label for="things-new-cat">Category</label>
        <select id="things-new-cat">
          ${cats.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('')}
          <option value="__new__">＋ New Category</option>
        </select>
      </div>
      <div class="form-group">
        <label for="things-new-unit">Default Unit</label>
        <input type="text" id="things-new-unit" placeholder="e.g. oz" list="things-unit-list">
      </div>
      <div class="form-group" style="grid-column:1/-1">
        <label for="things-new-notes">Notes (optional)</label>
        <textarea id="things-new-notes" rows="2" placeholder="Brand preferences, where you buy it, etc." maxlength="200" style="resize:vertical"></textarea>
      </div>
    </div>
    <div class="flex gap-8 mt-12">
      <button class="btn btn-green btn-sm" id="things-save-item">Save Item</button>
      <button class="btn btn-ghost btn-sm" id="things-cancel-add-item">Cancel</button>
    </div>
  `;
  formEl.style.display = '';
  document.getElementById('things-new-name')?.focus();
}

function renderThingsAddEntryForm(itemId) {
  const items = loadThingsItems();
  const item  = items.find(i => i.id === itemId);
  const formEl = document.getElementById('things-add-entry-form');
  if (!formEl) return;
  formEl.innerHTML = `
    <div style="padding:14px 0 4px;border-top:1px solid var(--border);margin-top:4px">
      <div class="form-grid">
        <div class="form-group">
          <label for="things-entry-date">Date</label>
          <input type="date" id="things-entry-date" value="${todayISO()}" max="${todayISO()}">
        </div>
        <div class="form-group">
          <label for="things-entry-qty">Quantity <span style="color:var(--red)">*</span></label>
          <input type="number" id="things-entry-qty" min="0.01" step="any" placeholder="e.g. 50">
        </div>
        <div class="form-group">
          <label for="things-entry-unit">Unit</label>
          <input type="text" id="things-entry-unit" placeholder="oz" list="things-unit-list" value="${escapeHTML(item?.defaultUnit || '')}">
        </div>
        <div class="form-group">
          <label for="things-entry-price">Total Price ($) <span style="color:var(--red)">*</span></label>
          <input type="number" id="things-entry-price" min="0" step="0.01" placeholder="0.00">
        </div>
        <div class="form-group">
          <label for="things-entry-store">Store (optional)</label>
          <input type="text" id="things-entry-store" placeholder="e.g. Walmart" maxlength="60">
        </div>
        <div class="form-group">
          <label for="things-entry-notes">Notes (optional)</label>
          <input type="text" id="things-entry-notes" placeholder="Sale, coupon, etc." maxlength="120">
        </div>
      </div>
      <div class="flex gap-8 mt-12">
        <button class="btn btn-green btn-sm" id="things-save-entry">Log Entry</button>
        <button class="btn btn-ghost btn-sm" id="things-cancel-add-entry">Cancel</button>
      </div>
    </div>
  `;
  formEl.style.display = '';
  document.getElementById('things-entry-qty')?.focus();
}

// ─── Things Tracker — Actions ─────────────────────────────────────
function saveThingsItem() {
  const nameEl = document.getElementById('things-new-name');
  const catEl  = document.getElementById('things-new-cat');
  const unitEl = document.getElementById('things-new-unit');
  const notesEl= document.getElementById('things-new-notes');
  const name   = nameEl?.value.trim();
  if (!name) { alert('Item name is required.'); nameEl?.focus(); return; }

  let category = catEl?.value || 'Other';
  if (category === '__new__') {
    const newCat = prompt('Enter new category name:')?.trim();
    if (!newCat) return;
    const customs = loadThingsCustomCats();
    if (!customs.includes(newCat)) { customs.push(newCat); saveThingsCustomCats(customs); }
    category = newCat;
  }

  const item = {
    id: crypto.randomUUID(),
    name,
    category,
    defaultUnit: unitEl?.value.trim() || '',
    notes:       notesEl?.value.trim() || '',
    createdAt:   todayISO(),
  };
  const items = loadThingsItems();
  items.push(item);
  saveThingsItems(items);

  const formEl = document.getElementById('things-add-item-form');
  if (formEl) formEl.style.display = 'none';
  renderThingsTab();
}

function deleteThingsItem(id) {
  const items = loadThingsItems();
  const item  = items.find(i => i.id === id);
  if (!item) return;
  if (!confirm(`Delete "${item.name}" and all its entries? This cannot be undone.`)) return;
  saveThingsItems(items.filter(i => i.id !== id));
  saveThingsEntries(loadThingsEntries().filter(e => e.itemId !== id));
  if (thingsDetailId === id) { thingsView = 'list'; thingsDetailId = null; }
  renderThingsTab();
}

function saveThingsEntry(itemId) {
  const dateEl  = document.getElementById('things-entry-date');
  const qtyEl   = document.getElementById('things-entry-qty');
  const unitEl  = document.getElementById('things-entry-unit');
  const priceEl = document.getElementById('things-entry-price');
  const storeEl = document.getElementById('things-entry-store');
  const notesEl = document.getElementById('things-entry-notes');

  const qty   = parseFloat(qtyEl?.value);
  const price = parseFloat(priceEl?.value);
  if (!qty || qty <= 0)  { alert('Quantity must be greater than 0.'); qtyEl?.focus(); return; }
  if (isNaN(price) || price < 0) { alert('Total price must be 0 or more.'); priceEl?.focus(); return; }

  const entry = {
    id:         crypto.randomUUID(),
    itemId,
    date:       dateEl?.value || todayISO(),
    quantity:   qty,
    unit:       unitEl?.value.trim() || 'unit',
    totalPrice: roundMoney(price),
    store:      storeEl?.value.trim() || '',
    notes:      notesEl?.value.trim() || '',
  };
  const entries = loadThingsEntries();
  entries.push(entry);
  saveThingsEntries(entries);

  const formEl = document.getElementById('things-add-entry-form');
  if (formEl) formEl.style.display = 'none';
  renderThingsDetailView(itemId);
}

function deleteThingsEntry(entryId, itemId) {
  if (!confirm('Delete this entry?')) return;
  saveThingsEntries(loadThingsEntries().filter(e => e.id !== entryId));
  renderThingsDetailView(itemId);
}

function showThingsDetail(itemId) {
  thingsView = 'detail';
  thingsDetailId = itemId;
  renderThingsDetailView(itemId);
}

function showThingsList() {
  thingsView = 'list';
  thingsDetailId = null;
  renderThingsTab();
}

// ─── JSON Backup / Restore ───────────────────────────────────────
const BACKUP_KEYS = [
  KEY_SNAPSHOTS, KEY_TXNS, KEY_BUDGETS,
  KEY_DEBT_META, KEY_LOANS, KEY_ACCOUNTS, KEY_THEME,
  KEY_BILLS, KEY_GOALS,
  KEY_THINGS_ITEMS, KEY_THINGS_ENTRIES, KEY_THINGS_CATS,
];

function exportBackup() {
  const data = {};
  BACKUP_KEYS.forEach(k => {
    const v = localStorage.getItem(k);
    if (v !== null) data[k] = v;
  });
  const json = JSON.stringify({ _version: 1, _exported: todayISO(), data }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `MoneyTrack_Backup_${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function _validateRestoreData(valid, parsed) {
  const MAX_VALUE_SIZE = 1024 * 1024; // 1MB per key
  valid.forEach(k => {
    const v = parsed.data[k];
    if (typeof v !== 'string') throw new Error(`Invalid value for key "${k}" — expected string.`);
    if (v.length > MAX_VALUE_SIZE) throw new Error(`Value for "${k}" exceeds 1MB limit.`);
    if (k !== KEY_THEME) {
      JSON.parse(v, (key, val) => key === '__proto__' ? undefined : val); // validate JSON + sanitize
    }
  });
}

function importBackup(file) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { showToast('Backup file too large (max 10MB).', 'error'); return; }
  const reader = new FileReader();
  reader.onerror = () => showToast('Failed to read backup file.', 'error');
  reader.onload = e => {
    try {
      const parsed = JSON.parse(e.target.result, (k, v) => k === '__proto__' ? undefined : v);
      if (!parsed.data || typeof parsed.data !== 'object') throw new Error('Invalid backup format');
      const keys = Object.keys(parsed.data);
      const valid = keys.filter(k => BACKUP_KEYS.includes(k));
      if (!valid.length) throw new Error('No recognizable data found in file');
      _validateRestoreData(valid, parsed);
      if (!confirm(`Restore backup from ${parsed._exported || 'unknown date'}?\n\nThis will overwrite your current data. Make sure you have a backup of what you have now.`)) return;
      valid.forEach(k => localStorage.setItem(k, parsed.data[k]));
      initTheme();
      refreshAccountConfig();
      renderAccountFields();
      renderAccountsTab();
      populateAccountSelects();
      renderBudgetCard();
      renderTracker();
      showToast('Backup restored successfully.', 'success');
    } catch (err) {
      showToast('Failed to restore backup: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

// ─── Tab Switching ────────────────────────────────────────────────
const TABS = [
  { tabId: 'tab-accounts', secId: 'sec-accounts' },
  { tabId: 'tab-tracker',  secId: 'sec-tracker'  },
  { tabId: 'tab-things',   secId: 'sec-things'   },
];

function switchTab(targetTabId) {
  TABS.forEach(({ tabId, secId }) => {
    const tab = document.getElementById(tabId);
    const sec = document.getElementById(secId);
    if (!tab || !sec) return;
    const active = tabId === targetTabId;
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    tab.setAttribute('tabindex', active ? '0' : '-1');
    sec.classList.toggle('on', active);
  });

  if (targetTabId === 'tab-accounts') renderAccountsTab();
  if (targetTabId === 'tab-tracker')  renderTracker();
  if (targetTabId === 'tab-things')   renderThingsTab();
}

// ─── Theme Toggle ────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem(KEY_THEME);
  if (saved === 'light') document.body.classList.add('light');
  updateThemeBtn();
}

function updateThemeBtn() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const isLight = document.body.classList.contains('light');
  btn.textContent = isLight ? '🌙' : '☀️';
  btn.setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');
}

function toggleTheme() {
  document.body.classList.toggle('light');
  const isLight = document.body.classList.contains('light');
  try { localStorage.setItem(KEY_THEME, isLight ? 'light' : 'dark'); } catch {}
  updateThemeBtn();
}

// ─── Filter Controls Update ───────────────────────────────────────
function updateCustomRangeVisibility() {
  const show = filters.period === 'custom';
  ['custom-range-label','custom-range-to-label'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? '' : 'none';
  });
  ['filter-from', 'filter-to'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? '' : 'none';
  });
}

// ─── Event Delegation ────────────────────────────────────────────
function bindEvents() {
  // Nav tab clicks
  const tablist = document.querySelector('[role="tablist"]');
  if (tablist && !tablist._delegated) {
    tablist._delegated = true;
    tablist.addEventListener('click', e => {
      const tab = e.target.closest('[role="tab"]');
      if (tab) switchTab(tab.id);
    });
    tablist.addEventListener('keydown', e => {
      const tabs = [...tablist.querySelectorAll('[role="tab"]')];
      const idx  = tabs.indexOf(document.activeElement);
      if (idx === -1) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); tabs[(idx+1) % tabs.length].focus(); switchTab(tabs[(idx+1) % tabs.length].id); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); tabs[(idx-1+tabs.length) % tabs.length].focus(); switchTab(tabs[(idx-1+tabs.length) % tabs.length].id); }
    });
  }

  // Theme toggle
  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);

  // Accounts tab
  document.getElementById('save-snapshot')?.addEventListener('click', saveSnapshot);
  document.getElementById('clear-balances')?.addEventListener('click', clearBalanceForms);
  document.getElementById('export-snapshots')?.addEventListener('click', exportSnapshots);
  document.getElementById('export-snapshots-pdf')?.addEventListener('click', exportSnapshotsPDF);
  document.getElementById('export-backup')?.addEventListener('click', exportBackup);
  document.getElementById('gdrive-save')?.addEventListener('click', saveToDrive);
  document.getElementById('gdrive-load')?.addEventListener('click', loadFromDrive);
  document.getElementById('import-backup-input')?.addEventListener('change', e => {
    importBackup(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('import-csv-input')?.addEventListener('change', e => {
    importBankCSV(e.target.files[0]);
    e.target.value = '';
  });

  // Snapshot history delegation (delete button)
  const snapHist = document.getElementById('snapshot-history');
  if (snapHist && !snapHist._delegated) {
    snapHist._delegated = true;
    snapHist.addEventListener('click', e => {
      const editBtn = e.target.closest('[data-edit-snap]');
      if (editBtn) {
        const snaps = loadSnapshots();
        const idx = parseInt(editBtn.dataset.editSnap, 10);
        const snap = snaps[idx];
        if (!snap) return;
        const dateEl = document.getElementById('snapshot-date');
        if (dateEl) dateEl.value = snap.date;
        prefillSnapshotForm(snap.date);
        document.getElementById('snapshot-date')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      const delBtn = e.target.closest('[data-del-snap]');
      if (delBtn) {
        const idx = parseInt(delBtn.dataset.delSnap, 10);
        if (confirm('Delete this snapshot?')) deleteSnapshot(idx);
      }
    });
  }

  document.getElementById('snapshot-date')?.addEventListener('change', e => {
    prefillSnapshotForm(e.target.value);
  });

  // Tracker form
  document.getElementById('save-txn')?.addEventListener('click', saveTransaction);
  document.getElementById('cancel-edit')?.addEventListener('click', cancelEdit);
  document.getElementById('export-txns')?.addEventListener('click', exportTransactions);
  document.getElementById('export-txns-pdf')?.addEventListener('click', exportTransactionsPDF);

  // Show/hide to-account when type changes
  document.getElementById('txn-type')?.addEventListener('change', updateToAccountVisibility);

  // Budget card — delegated (rendered dynamically)
  document.addEventListener('click', e => {
    if (e.target.id === 'save-budgets')  saveBudgetsAction();
    if (e.target.id === 'clear-budgets') { saveBudgets({}); renderBudgetCard(); renderCategoryBreakdown(getFilteredTxns()); }
    if (e.target.id === 'save-debt-meta') saveDebtMetaAction();
    // Loans
    if (e.target.id === 'add-loan') addLoan();
    const loanPaidBtn = e.target.closest('[data-loan-paid]');
    if (loanPaidBtn) markLoanPaid(loanPaidBtn.dataset.loanPaid);
    const loanDelBtn  = e.target.closest('[data-loan-del]');
    if (loanDelBtn)  deleteLoan(loanDelBtn.dataset.loanDel);
  });

  // Bill Reminders card
  const billsCard = document.getElementById('bills-card');
  if (billsCard && !billsCard._delegated) {
    billsCard._delegated = true;
    billsCard.addEventListener('click', e => {
      if (e.target.id === 'show-add-bill')    { showAddBillForm(); return; }
      if (e.target.id === 'confirm-add-bill') { addBill(); return; }
      if (e.target.id === 'cancel-add-bill')  {
        const f = document.getElementById('bill-add-form');
        if (f) { f.innerHTML = ''; f.style.display = 'none'; }
        return;
      }
      const delBtn = e.target.closest('[data-del-bill]');
      if (delBtn) deleteBill(delBtn.dataset.delBill);
    });
  }

  // Savings Goals card
  const goalsCard = document.getElementById('goals-card');
  if (goalsCard && !goalsCard._delegated) {
    goalsCard._delegated = true;
    goalsCard.addEventListener('click', e => {
      if (e.target.id === 'show-add-goal')    { showAddGoalForm(); return; }
      if (e.target.id === 'confirm-add-goal') { addGoal(); return; }
      if (e.target.id === 'cancel-add-goal')  {
        const f = document.getElementById('goal-add-form');
        if (f) { f.innerHTML = ''; f.style.display = 'none'; }
        return;
      }
      const delBtn = e.target.closest('[data-del-goal]');
      if (delBtn) deleteGoal(delBtn.dataset.delGoal);
    });
  }

  // Manage Accounts card
  const mgmtCard = document.getElementById('manage-accounts-card');
  if (mgmtCard && !mgmtCard._delegated) {
    mgmtCard._delegated = true;
    mgmtCard.addEventListener('click', e => {
      if (e.target.id === 'show-add-account')    { showAddAccountForm(); return; }
      if (e.target.id === 'confirm-add-account') { addAccount(); return; }
      if (e.target.id === 'cancel-add-account')  {
        const f = document.getElementById('acct-add-form');
        if (f) { f.innerHTML = ''; f.style.display = 'none'; }
        return;
      }
      const delBtn = e.target.closest('[data-del-acct]');
      if (delBtn) deleteCustomAccount(delBtn.dataset.delAcct);
    });
  }

  // Things Tracker section
  const thingsSec = document.getElementById('sec-things');
  if (thingsSec && !thingsSec._delegated) {
    thingsSec._delegated = true;
    thingsSec.addEventListener('click', e => {
      if (e.target.id === 'things-show-add-item')    { renderThingsAddItemForm(); return; }
      if (e.target.id === 'things-cancel-add-item')  { const f = document.getElementById('things-add-item-form'); if (f) f.style.display='none'; return; }
      if (e.target.id === 'things-save-item')        { saveThingsItem(); return; }
      if (e.target.id === 'things-back')             { showThingsList(); return; }
      if (e.target.id === 'things-show-add-entry')   { renderThingsAddEntryForm(thingsDetailId); return; }
      if (e.target.id === 'things-cancel-add-entry') { const f = document.getElementById('things-add-entry-form'); if (f) f.style.display='none'; return; }
      if (e.target.id === 'things-save-entry')       { saveThingsEntry(thingsDetailId); return; }
      const detailBtn = e.target.closest('[data-things-detail]');
      if (detailBtn) { showThingsDetail(detailBtn.dataset.thingsDetail); return; }
      const delItem = e.target.closest('[data-del-thing]');
      if (delItem) { deleteThingsItem(delItem.dataset.delThing); return; }
      const delEntry = e.target.closest('[data-del-entry]');
      if (delEntry) { deleteThingsEntry(delEntry.dataset.delEntry, thingsDetailId); return; }
    });
    thingsSec.addEventListener('input', e => {
      if (e.target.id === 'things-search' || e.target.id === 'things-cat-filter' || e.target.id === 'things-sort') {
        thingsFilters.search   = document.getElementById('things-search')?.value || '';
        thingsFilters.category = document.getElementById('things-cat-filter')?.value || '';
        thingsFilters.sort     = document.getElementById('things-sort')?.value || 'name';
        renderThingsItemGrid();
      }
    });
  }

  // Balance trend group tabs
  const trendsContent = document.getElementById('balance-trends-content');
  if (trendsContent && !trendsContent._delegated) {
    trendsContent._delegated = true;
    trendsContent.addEventListener('click', e => {
      const btn = e.target.closest('[data-trend-group]');
      if (btn) { balTrendGroup = btn.dataset.trendGroup; renderBalanceTrends(); }
    });
  }

  // Tracker form — enter key on description
  document.getElementById('txn-desc')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); saveTransaction(); }
  });

  // Filter controls
  document.getElementById('filter-period')?.addEventListener('change', e => {
    filters.period = e.target.value;
    updateCustomRangeVisibility();
    renderTracker();
  });
  document.getElementById('filter-account')?.addEventListener('change', e => {
    filters.account = e.target.value;
    renderTracker();
  });
  document.getElementById('filter-type')?.addEventListener('change', e => {
    filters.type = e.target.value;
    renderTracker();
  });
  document.getElementById('filter-from')?.addEventListener('change', e => {
    filters.from = e.target.value;
    renderTracker();
  });
  document.getElementById('filter-to')?.addEventListener('change', e => {
    filters.to = e.target.value;
    renderTracker();
  });

  // Transaction search
  const search = document.getElementById('txn-search');
  if (search) {
    search.addEventListener('input', e => {
      filters.search = e.target.value;
      renderTransactionLog(getFilteredTxns());
    });
  }

  // Transaction log delegation (edit / delete)
  const txnList = document.getElementById('txn-list');
  if (txnList && !txnList._delegated) {
    txnList._delegated = true;
    txnList.addEventListener('click', e => {
      const editBtn = e.target.closest('[data-edit]');
      const delBtn  = e.target.closest('[data-del]');
      if (editBtn) editTransaction(editBtn.dataset.edit);
      if (delBtn)  deleteTransaction(delBtn.dataset.del);
    });
  }
}

// ─── Storage Integrity Check ──────────────────────────────────────
function checkStorageIntegrity() {
  const txnIssues = loadTxns().filter(t =>
    !isFinite(Number(t.amount)) || Number(t.amount) < 0 ||
    !t.date || !t.type || !t.description
  );
  const loanIssues = loadLoans().filter(l =>
    !isFinite(Number(l.amount)) || Number(l.amount) <= 0 ||
    !l.date || !l.status
  );
  if (txnIssues.length)
    console.warn(`[MoneyTrack] ${txnIssues.length} transaction(s) have invalid data:`, txnIssues.map(t => t.id));
  if (loanIssues.length)
    console.warn(`[MoneyTrack] ${loanIssues.length} loan(s) have invalid data:`, loanIssues.map(l => l.id));
}

// ─── Init ─────────────────────────────────────────────────────────
function init() {
  refreshAccountConfig();
  initTheme();
  checkStorageIntegrity();
  populateAccountSelects();
  renderAccountFields();
  renderAccountsTab();
  renderBudgetCard();

  // Pre-fill today's date and set max=today on date inputs
  const today = todayISO();
  const dateInput = document.getElementById('txn-date');
  if (dateInput) { dateInput.value = today; dateInput.max = today; }
  const snapDateInput = document.getElementById('snapshot-date');
  if (snapDateInput) { snapDateInput.value = today; snapDateInput.max = today; }
  prefillSnapshotForm(today);

  updateCustomRangeVisibility();
  updateToAccountVisibility();
  bindEvents();
  renderTracker();

  // Populate Things Tracker unit datalist
  const thingsUnitList = document.getElementById('things-unit-list');
  if (thingsUnitList) {
    thingsUnitList.innerHTML = THINGS_UNIT_SUGGESTIONS.map(u => `<option value="${escapeHTML(u)}">`).join('');
  }
  // Auto-sync with Drive if user has previously authorised
  autoSyncDrive();
}

// ─── Auth Gate ───────────────────────────────────────────────────
function isAuthenticated() {
  return sessionStorage.getItem(SESSION_KEY) === '1';
}

function showApp() {
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.classList.add('hidden');
  init();
}

function bindLoginForm() {
  const form    = document.getElementById('login-form');
  const input   = document.getElementById('login-pass');
  const errorEl = document.getElementById('login-error');
  if (!form) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();

    // Rate-limit check
    const now = Date.now();
    if (_loginLockoutUntil && now < _loginLockoutUntil) {
      const secs = Math.ceil((_loginLockoutUntil - now) / 1000);
      if (errorEl) errorEl.textContent = `Too many attempts. Try again in ${secs}s.`;
      return;
    }

    const hash = await sha256(input?.value || '');
    if (hash === AUTH_HASH) {
      _loginAttempts = 0;
      sessionStorage.removeItem('mt_login_attempts');
      sessionStorage.removeItem('mt_login_lockout');
      sessionStorage.setItem(SESSION_KEY, '1');
      showApp();
    } else {
      _loginAttempts++;
      sessionStorage.setItem('mt_login_attempts', String(_loginAttempts));
      if (_loginAttempts >= LOGIN_MAX_ATTEMPTS) {
        const delay = Math.min(LOGIN_BASE_DELAY_MS * Math.pow(2, _loginAttempts - LOGIN_MAX_ATTEMPTS), 60000);
        _loginLockoutUntil = now + delay;
        sessionStorage.setItem('mt_login_lockout', String(_loginLockoutUntil));
        if (errorEl) errorEl.textContent = `Too many attempts. Locked for ${Math.ceil(delay / 1000)}s.`;
      } else {
        if (errorEl) errorEl.textContent = 'Incorrect password. Please try again.';
      }
      if (input) { input.value = ''; input.focus(); }
    }
  });
}

// ─── Cross-tab Sync ──────────────────────────────────────────────
window.addEventListener('storage', (e) => {
  if (e.key && (e.key.startsWith('moneytrack_') || BACKUP_KEYS.includes(e.key))) {
    // Another tab changed data — refresh
    location.reload();
  }
});

// ─── Idle Session Timeout ────────────────────────────────────────
let _lastActivity = Date.now();
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function resetIdleTimer() { _lastActivity = Date.now(); }

['mousemove', 'keydown', 'click', 'touchstart'].forEach(evt => {
  document.addEventListener(evt, resetIdleTimer, { passive: true });
});

setInterval(() => {
  if (isAuthenticated() && Date.now() - _lastActivity > IDLE_TIMEOUT_MS) {
    sessionStorage.removeItem(SESSION_KEY);
    location.reload();
  }
}, 60000);

document.addEventListener('DOMContentLoaded', () => {
  if (isAuthenticated()) {
    showApp();
  } else {
    bindLoginForm();
    document.getElementById('login-pass')?.focus();
  }
});
