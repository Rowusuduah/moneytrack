'use strict';

// Drive remains a private backup file. A three-way merge and durable baseline
// make it safe to use as a two-device sync source without date guesses.
const MoneyTrackDriveSync = (() => {
  const DB_NAME = 'moneytrack-sync';
  const BASE_KEY = 'last-synced-data';
  let timer = null, running = false, repeat = false, started = false;

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB is unavailable')); return; }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('state');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function baseStore(value) {
    const db = await openDB();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('state', value === undefined ? 'readonly' : 'readwrite');
        const req = value === undefined ? tx.objectStore('state').get(BASE_KEY)
          : tx.objectStore('state').put(value, BASE_KEY);
        req.onsuccess = () => { if (value === undefined) resolve(req.result || { data: {}, pending: null }); };
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => { if (value !== undefined) resolve(); };
        tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  }

  function localData() {
    const data = {};
    for (const key of BACKUP_KEYS) {
      const value = localStorage.getItem(key);
      if (value !== null) data[key] = value;
    }
    return data;
  }

  function sameData(a, b) {
    return BACKUP_KEYS.every(key => a[key] === b[key]);
  }

  function editing() {
    const el = document.activeElement;
    return document.body.classList.contains('sheet-open') ||
      (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !el.readOnly);
  }

  async function token(interactive) {
    if (_gAccessToken) return true;
    if (typeof google === 'undefined' || !google.accounts?.oauth2) return false;
    initGDrive();
    if (!interactive) return _silentTokenRefresh();
    return new Promise(resolve => {
      const timeout = setTimeout(() => resolve(false), 30000);
      gWithToken(() => { clearTimeout(timeout); resolve(true); });
    });
  }

  async function driveFile() {
    const found = await _gListFiles();
    if (!found.length) {
      if (localStorage.getItem(KEY_GDRIVE_CONNECTED) === '1')
        throw new Error('No backup in this Google account. Check that both devices use the same account.');
      return { ids: [], data: {}, version: 0 };
    }
    const copies = [];
    for (const file of found) {
      const resp = await _gFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
      if (!resp.ok) throw new Error(`Drive read failed (${resp.status})`);
      const parsed = await resp.json();
      if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data))
        throw new Error('A Drive file named MoneyTrack_Backup.json is not a MoneyTrack backup');
      const valid = Object.keys(parsed.data).filter(k => BACKUP_KEYS.includes(k));
      if (!valid.length) throw new Error('A Drive backup contains no MoneyTrack data');
      _validateRestoreData(valid, parsed);
      copies.push({ id: file.id, version: Number(parsed._version) || 1,
        exported: parsed._exportedAt || parsed._exported,
        data: Object.fromEntries(valid.map(k => [k, parsed.data[k]])) });
    }
    // Legacy devices could have created same-named files independently. Treat
    // missing records as unknown, not deleted; only shared IDs with different
    // values need review. After a successful merge, update every copy.
    let data = copies[0].data;
    for (const copy of copies.slice(1)) {
      const combined = MoneyTrackSyncMerge.mergeData({}, data, copy.data, BACKUP_KEYS);
      if (combined.conflicts.length)
        throw new Error(`${combined.conflicts.length} conflicting change(s) across Drive backups. Keep both files and review them.`);
      data = combined.data;
    }
    localStorage.setItem(KEY_GDRIVE_FILE, copies[0].id);
    return { ids: copies.map(c => c.id), copies, data,
      version: Math.min(...copies.map(c => c.version)), exported: copies[0].exported };
  }

  async function upload(ids, data) {
    const body = JSON.stringify({ _version: 2, _exported: todayISO(), _exportedAt: new Date().toISOString(), data });
    if (ids.length) {
      for (const id of ids) await _gUpdateFile(id, body);
    } else {
      const id = await _gCreateFile(body);
      localStorage.setItem(KEY_GDRIVE_FILE, id);
    }
  }

  async function sync(interactive = false) {
    if (running) { repeat = true; return; }
    if (!interactive && editing()) { queue(5000); return; }
    running = true;
    try {
      _gSetStatus('Syncing…');
      if (!await token(interactive)) {
        _gSetStatus('Drive disconnected — tap Sync now', true);
        return;
      }
      const state = await baseStore();
      const base = state.data || {};
      const local = localData();
      const remote = await driveFile();
      const combinedCopies = remote.copies?.some(copy => !sameData(copy.data, remote.data));
      if (remote.ids.length && remote.version < 2 && Object.keys(base).length) {
        _gSetStatus('An older app version changed Drive — update the other device, then sync again', true);
        return;
      }
      // A second device can finish an upload after this device did. Until our
      // upload is observed on a later read, retain its prior merge base so its
      // edits can be recovered instead of treating the rival upload as deletion.
      const mergeBase = state.pending && !sameData(remote.data, state.pending.uploaded)
        ? state.pending.base : base;
      const merged = MoneyTrackSyncMerge.mergeData(mergeBase, local, remote.data, BACKUP_KEYS);
      if (merged.conflicts.length) {
        _gSetStatus(`${merged.conflicts.length} conflicting change(s) — review before replacing either copy`, true);
        if (interactive) showToast('Both devices changed the same item. Export a backup on each device before choosing a copy.', 'error');
        return;
      }
      if (!sameData(merged.data, local) && !_saveLocalSafetyBackup())
        throw new Error('Could not save a recovery copy. Export a backup file first.');
      const uploaded = remote.version < 2 || !sameData(merged.data, remote.data) ||
        remote.copies?.some(copy => !sameData(copy.data, merged.data));
      if (uploaded) await upload(remote.ids, merged.data);
      await baseStore({ data: merged.data,
        pending: uploaded ? { base: mergeBase, uploaded: merged.data } : null });
      localStorage.setItem(KEY_GDRIVE_CONNECTED, '1');
      start();
      if (!sameData(localData(), local)) {
        _gSetStatus('New edits detected — syncing again…');
        repeat = true;
        return;
      }
      recordBackup('drive');
      if (!sameData(merged.data, local)) {
        for (const key of BACKUP_KEYS) {
          if (Object.hasOwn(merged.data, key)) localStorage.setItem(key, merged.data[key]);
          else localStorage.removeItem(key);
        }
        _gSetStatus('Updated from Drive');
        location.reload(); // Reloads the Wealth plan and every tab from the merged data.
      } else _gSetStatus(combinedCopies
        ? 'Synced multiple Drive backups. Review any items you recently deleted.'
        : `Synced ${new Date().toLocaleTimeString()}`, !!combinedCopies);
    } catch (err) {
      if (err?._gStatus === 401) _gAccessToken = null;
      _gSetStatus(`Sync failed: ${err.message || 'check your connection'}`, true);
      console.error('[MoneyTrack Drive sync]', err);
      if (interactive) showToast('Drive sync failed. Your data is still on this device.', 'error');
    } finally {
      running = false;
      if (repeat) { repeat = false; queue(500); }
    }
  }

  // The explicit load action is the conflict escape hatch. It never silently
  // replaces local records; a rolling local recovery copy is made first.
  async function load() {
    if (running) return;
    running = true;
    try {
      if (!await token(true)) { _gSetStatus('Drive disconnected', true); return; }
      const remote = await driveFile();
      if (!remote.ids.length) { showToast('No MoneyTrack backup found in this Google account.', 'info'); return; }
      if (!confirm(`Replace this device's MoneyTrack data with the Drive copy from ${remote.exported || 'an unknown time'}?\n\nA recovery copy of this device will be saved first.`)) return;
      if (!_saveLocalSafetyBackup()) throw new Error('Could not save a recovery copy. Export a backup file first.');
      if (remote.version < 2) await upload(remote.ids, remote.data);
      for (const key of BACKUP_KEYS) {
        if (Object.hasOwn(remote.data, key)) localStorage.setItem(key, remote.data[key]);
        else localStorage.removeItem(key);
      }
      await baseStore({ data: remote.data, pending: null });
      localStorage.setItem(KEY_GDRIVE_CONNECTED, '1');
      recordBackup('drive');
      location.reload();
    } catch (err) {
      _gSetStatus(`Load failed: ${err.message || 'check your connection'}`, true);
      console.error('[MoneyTrack Drive load]', err);
    } finally { running = false; }
  }

  function queue(delay = 3000) {
    if (localStorage.getItem(KEY_GDRIVE_CONNECTED) !== '1') return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; sync(false); }, delay);
  }

  function flush() {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    sync(false);
  }

  function start() {
    if (started || localStorage.getItem(KEY_GDRIVE_CONNECTED) !== '1') return;
    started = true;
    queue(800);
    setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine) queue(0); }, 60000);
    window.addEventListener('online', () => queue(0));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') queue(0);
    });
  }

  return { sync, load, queue, flush, start };
})();
