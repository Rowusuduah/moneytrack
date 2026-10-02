'use strict';

// Drive remains a private backup file. A three-way merge and durable baseline
// make it safe to use as a two-device sync source without date guesses.
const MoneyTrackDriveSync = (() => {
  const DB_NAME = 'moneytrack-sync';
  const BASE_KEY = 'last-synced-data';
  const CRYPTO_KEY = 'drive-backup-key-v1';
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

  async function keyStore(value) {
    const db = await openDB();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('state', value === undefined ? 'readonly' : 'readwrite');
        const req = value === undefined ? tx.objectStore('state').get(CRYPTO_KEY)
          : tx.objectStore('state').put(value, CRYPTO_KEY);
        req.onsuccess = () => { if (value === undefined) resolve(req.result || null); };
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => { if (value !== undefined) resolve(); };
        tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  }

  async function askRecovery(mode, expectedKeyId) {
    const dialog = document.getElementById('backup-key-dialog');
    if (!dialog?.showModal) throw new Error('This browser cannot show the recovery key form.');
    const form = document.getElementById('backup-key-form');
    const created = document.getElementById('backup-key-created');
    const unlock = document.getElementById('backup-key-unlock');
    const code = document.getElementById('backup-key-code');
    const input = document.getElementById('backup-key-input');
    const saved = document.getElementById('backup-key-saved');
    const error = document.getElementById('backup-key-error');
    const candidate = mode === 'setup' ? await MoneyTrackBackupCrypto.createRecovery() : null;
    document.getElementById('backup-key-title').textContent = mode === 'setup' ? 'Protect Drive backup' : 'Unlock Drive backup';
    document.getElementById('backup-key-explanation').textContent = mode === 'setup'
      ? 'Save this recovery key outside MoneyTrack before continuing. It is shown once. Losing it after browser data is cleared means the Drive backup cannot be recovered. Existing Drive copies will be replaced with encrypted copies; older Drive revisions may remain readable.'
      : 'Enter the recovery key saved when Drive encryption was enabled. The email login code cannot decrypt this backup.';
    created.hidden = mode !== 'setup';
    unlock.hidden = mode !== 'unlock';
    code.value = candidate?.recoveryKey || '';
    input.value = '';
    saved.checked = false;
    error.textContent = '';
    document.getElementById('backup-key-submit').textContent = mode === 'setup' ? 'Enable encryption' : 'Unlock backup';
    return new Promise(resolve => {
      let finished = false;
      const onCancel = e => { e.preventDefault(); finish(null); };
      const finish = value => {
        if (finished) return;
        finished = true;
        code.value = '';
        input.value = '';
        if (candidate) candidate.recoveryKey = '';
        form.onsubmit = null;
        document.getElementById('backup-key-cancel').onclick = null;
        document.getElementById('backup-key-copy').onclick = null;
        dialog.removeEventListener('cancel', onCancel);
        dialog.close();
        resolve(value);
      };
      form.onsubmit = async e => {
        e.preventDefault();
        if (mode === 'setup') {
          if (!saved.checked) { error.textContent = 'Save the recovery key before enabling encryption.'; return; }
          finish({ key: candidate.key, keyId: candidate.keyId });
          return;
        }
        try {
          const imported = await MoneyTrackBackupCrypto.importRecovery(input.value);
          if (imported.keyId !== expectedKeyId) throw new Error('This key does not match the Drive backup.');
          finish(imported);
        } catch (err) { error.textContent = err.message; }
      };
      document.getElementById('backup-key-cancel').onclick = () => finish(null);
      document.getElementById('backup-key-copy').onclick = async () => {
        try { await navigator.clipboard.writeText(candidate.recoveryKey); }
        catch { code.select(); }
      };
      dialog.addEventListener('cancel', onCancel);
      dialog.showModal();
      (mode === 'setup' ? code : input).focus();
    });
  }

  async function keyForBackup(envelope, interactive) {
    const stored = await keyStore();
    if (stored?.key && stored.keyId === envelope._keyId) return stored;
    if (!interactive) throw new Error('Encrypted backup locked — tap Sync now and enter your recovery key.');
    const recovered = await askRecovery('unlock', envelope._keyId);
    if (!recovered) throw new Error('Encrypted backup remains locked.');
    await keyStore(recovered);
    return recovered;
  }

  async function encryptionKey(interactive) {
    const stored = await keyStore();
    if (stored?.key && stored.keyId) return stored;
    if (!interactive) throw new Error('Set up a Drive recovery key with Sync now before background sync can continue.');
    const created = await askRecovery('setup');
    if (!created) throw new Error('Drive encryption setup was cancelled.');
    await keyStore(created);
    return created;
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

  async function driveFile(interactive = false) {
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
      if (Number(parsed._version) >= 3 && parsed._encrypted !== true)
        throw new Error('A Drive backup claims encryption but has no encrypted data.');
      const payload = parsed._encrypted
        ? await MoneyTrackBackupCrypto.decrypt(parsed,
          (await keyForBackup(parsed, interactive)).key, parsed._keyId)
        : parsed.data;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        throw new Error('A Drive file named MoneyTrack_Backup.json is not a MoneyTrack backup');
      const valid = Object.keys(payload).filter(k => BACKUP_KEYS.includes(k));
      if (!valid.length) throw new Error('A Drive backup contains no MoneyTrack data');
      _validateRestoreData(valid, { data: payload });
      copies.push({ id: file.id, version: Number(parsed._version) || 1,
        exported: parsed._exportedAt || parsed._exported,
        data: Object.fromEntries(valid.map(k => [k, payload[k]])) });
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
    const vault = await encryptionKey(false);
    const body = JSON.stringify(await MoneyTrackBackupCrypto.encrypt(data, vault.key, vault.keyId));
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
      const remote = await driveFile(interactive);
      await encryptionKey(interactive);
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
      const uploaded = remote.version < 3 || !sameData(merged.data, remote.data) ||
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
      const remote = await driveFile(true);
      if (!remote.ids.length) { showToast('No MoneyTrack backup found in this Google account.', 'info'); return; }
      if (!confirm(`Replace this device's MoneyTrack data with the Drive copy from ${remote.exported || 'an unknown time'}?\n\nA recovery copy of this device will be saved first.`)) return;
      if (!_saveLocalSafetyBackup()) throw new Error('Could not save a recovery copy. Export a backup file first.');
      if (remote.version < 3) { await encryptionKey(true); await upload(remote.ids, remote.data); }
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
