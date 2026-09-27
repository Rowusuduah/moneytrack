/* email-login.js — shared lock screen for MoneyTrack, Smart Deadline Tracker and FE Civil.
   Master copy: the private login-codes repo (client/email-login.js). Apps get an identical
   copy from `node scripts/sync-client.mjs`, with the public config below baked in.

   A 6-digit code is emailed to the owner's Gmail; a correct code returns a 30-day pass
   signed by the service. The pass is checked here with the service's public key, so it
   works offline and cannot be forged by editing storage. One pass unlocks all three apps
   on a device (they share the rowusuduah.github.io origin). This is a screen lock: app
   data in localStorage is not encrypted. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EmailLogin = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const CONFIG = /*@config*/{"serviceUrl":"https://login-codes-nine.vercel.app","publicKeyJwk":{"kty":"EC","x":"pvbrmQVGxQvW-0l86qkNZpTbz0MFOZZvYjedzmhY0PA","y":"-hd-BJPbaNR528Hu1eyC_FPTqAq16YqsVB_t9zdmKtU","crv":"P-256"},"recoveryKeySha256":"e70d80a869c0c917dc3371f0079b586a868635155db768207668c3f0ffb04cd2","maskedEmail":"r…⁠@gmail.com"}/*@end*/;

  const PASS_KEY = 'rowusuduah_login_pass_v1';
  // { challenge, expiresAt } in localStorage so a pending code survives new tabs, the other
  // two apps and the phone closing the app; the challenge is useless without the emailed code.
  const CHALLENGE_KEY = 'rowusuduah_login_challenge_v2';
  // Rewritten on every Lock. A tab opened with the recovery key has no stored pass to lose,
  // so this change is the only thing it can hear.
  const LOCK_KEY = 'rowusuduah_login_locked_v1';
  const AUDIENCE = 'rowusuduah.github.io';
  const TIMEOUT_MS = 20000;
  const OFFLINE = "You're offline. Connect to the internet to get a code.";
  // A firewall rate-limit block carries no CORS headers, so it also lands here.
  const UNREACHABLE = 'Could not reach the login service. Wait a few minutes, then try again.';
  const TOO_SLOW = 'The login service is taking too long to answer. Check your connection and try again.';
  const TOO_MANY = 'Too many code requests. Wait 10 minutes, then try again.';
  const STORAGE_BLOCKED = "This browser is blocking storage for this site, so the app can't open. Allow site data for rowusuduah.github.io, then reload.";

  function memoryStore() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
  }
  function browserStore(name) {
    try { const s = globalThis[name]; return s || memoryStore(); } catch { return memoryStore(); }
  }
  // Blocked storage makes the getter throw (Chrome, Safari) or return null (Firefox).
  function browserStoreUsable(name) {
    try {
      const s = globalThis[name];
      if (!s) return false;
      s.setItem('__email_login_probe__', '1');
      const ok = s.getItem('__email_login_probe__') === '1';
      s.removeItem('__email_login_probe__');
      return ok;
    } catch { return false; }
  }
  function bytesFromB64url(s) {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function create(options) {
    const opts = options || {};
    const cfg = Object.assign({}, CONFIG, opts.config);
    const storage = opts.storage || browserStore('localStorage');
    const session = opts.session || browserStore('sessionStorage');
    const fetchImpl = opts.fetch || ((url, init) => globalThis.fetch(url, init));
    const now = opts.now || (() => Date.now());
    const online = opts.online || (() => !(typeof navigator !== 'undefined' && navigator.onLine === false));
    const timeoutMs = opts.timeoutMs || TIMEOUT_MS;
    const subtle = globalThis.crypto.subtle;
    const storageBlocked = !opts.storage && !browserStoreUsable('localStorage');
    let keyPromise = null;
    let recoveryUnlocked = false;
    let pending = null;   // pending challenge, kept here only when storage refuses it

    function safeGet(store, key) { try { return store.getItem(key); } catch { return null; } }
    function safeSet(store, key, value) { try { store.setItem(key, value); return true; } catch { return false; } }
    function safeRemove(store, key) { try { store.removeItem(key); } catch { /* storage blocked */ } }

    function publicKey() {
      if (!keyPromise) keyPromise = subtle.importKey('jwk', cfg.publicKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      return keyPromise;
    }

    async function verifyPass(pass) {
      if (typeof pass !== 'string' || !cfg.publicKeyJwk) return null;
      const parts = pass.split('.');
      if (parts.length !== 3 || parts[0] !== 'v1') return null;
      let payload;
      try {
        payload = JSON.parse(new TextDecoder().decode(bytesFromB64url(parts[1])));
        const ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await publicKey(),
          bytesFromB64url(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
        if (!ok) return null;
      } catch { return null; }
      if (!payload || payload.v !== 1 || payload.aud !== AUDIENCE || !(payload.exp > now())) return null;
      return payload;
    }

    async function hasValidPass() {
      if (recoveryUnlocked) return true;
      const pass = safeGet(storage, PASS_KEY);
      if (!pass) return false;
      if (await verifyPass(pass)) return true;
      safeRemove(storage, PASS_KEY);
      return false;
    }

    async function post(path, body) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      let timer;
      // Weak wifi can leave a request open with no answer; give up so the button comes back.
      const tooSlow = new Promise((resolve, reject) => {
        timer = setTimeout(() => { reject(new Error(TOO_SLOW)); if (controller) controller.abort(); }, timeoutMs);
      });
      async function send() {
        let res;
        try {
          res = await fetchImpl(cfg.serviceUrl + path, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            signal: controller ? controller.signal : undefined,
          });
        } catch {
          throw new Error(online() ? UNREACHABLE : OFFLINE);
        }
        if (res.status === 429) throw new Error(TOO_MANY);
        let data = null;
        try { data = await res.json(); } catch { /* non-JSON error page */ }
        if (!res.ok) throw new Error((data && data.error) || 'Something went wrong. Try again.');
        return data;
      }
      try { return await Promise.race([send(), tooSlow]); }
      finally { clearTimeout(timer); }
    }

    function readPending() {
      let stored = null;
      try { stored = JSON.parse(safeGet(storage, CHALLENGE_KEY) || 'null'); } catch { stored = null; }
      const p = stored || pending;
      return p && typeof p.challenge === 'string' && p.expiresAt > now() ? p : null;
    }

    async function requestCode(app) {
      if (storageBlocked) throw new Error(STORAGE_BLOCKED);
      if (!online()) throw new Error(OFFLINE);
      const data = await post('/api/send-code', { app });
      const record = { challenge: data.challenge, expiresAt: data.expiresAt };
      // Storage is the shared source of truth; memory only covers a browser that refuses the write.
      pending = safeSet(storage, CHALLENGE_KEY, JSON.stringify(record)) ? null : record;
      return data;
    }

    async function submitCode(code) {
      const digits = String(code == null ? '' : code).replace(/\D/g, '');
      if (storageBlocked) throw new Error(STORAGE_BLOCKED);
      const current = readPending();
      if (!current) throw new Error('Tap “Email me a code” first.');
      const challenge = current.challenge;
      if (digits.length !== 6) throw new Error('Enter the 6-digit code from the email.');
      if (!online()) throw new Error(OFFLINE);
      const data = await post('/api/verify-code', { challenge, code: digits });
      if (!(await verifyPass(data && data.pass))) throw new Error('The login service sent an invalid pass. Try again.');
      if (!safeSet(storage, PASS_KEY, data.pass)) throw new Error('This browser blocked storage, so the device cannot stay unlocked.');
      pending = null;
      safeRemove(storage, CHALLENGE_KEY);
      return true;
    }

    function normalizeRecoveryKey(key) { return String(key || '').toUpperCase().replace(/[\s-]/g, ''); }

    async function sha256Hex(text) {
      const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    }

    // Recovery unlocks this page load only: nothing is written, so it can't be replayed from storage.
    async function unlockWithRecoveryKey(key) {
      const normalized = normalizeRecoveryKey(key);
      if (!normalized || !cfg.recoveryKeySha256) return false;
      if ((await sha256Hex(normalized)) !== cfg.recoveryKeySha256) return false;
      recoveryUnlocked = true;
      return true;
    }

    function lock() {
      recoveryUnlocked = false;
      pending = null;
      safeRemove(storage, PASS_KEY);
      safeRemove(storage, CHALLENGE_KEY);
      safeSet(storage, LOCK_KEY, now() + '.' + Math.random().toString(36).slice(2));
    }

    function hasPendingCode() { return !!readPending(); }

    // Lock in any of the three apps removes the shared pass; other open tabs follow.
    function onLockedElsewhere(callback) {
      if (typeof globalThis.addEventListener !== 'function') return;
      globalThis.addEventListener('storage', (e) => {
        if ((e.key === PASS_KEY && !e.newValue) || (e.key === LOCK_KEY && e.newValue)) callback();
      });
    }

    function mountLockScreen({ app, onUnlock, legacyKeys = [], legacySessionKeys = [] }) {
      const $ = (id) => document.getElementById(id);
      const el = {
        message: $('el-message'), request: $('el-step-request'), send: $('el-send'),
        codeForm: $('el-step-code'), code: $('el-code'), verify: $('el-verify'), resend: $('el-resend'),
        recoveryForm: $('el-step-recovery'), recovery: $('el-recovery'), back: $('el-back'),
        useRecovery: $('el-use-recovery'), error: $('el-error'),
      };
      const setError = (text) => { el.error.textContent = text; };
      if (storageBlocked) {
        el.request.hidden = true; el.codeForm.hidden = true; el.recoveryForm.hidden = true; el.useRecovery.hidden = true;
        el.message.textContent = STORAGE_BLOCKED;
        return;
      }
      const show = (step) => {
        el.request.hidden = step !== 'request';
        el.codeForm.hidden = step !== 'code';
        el.recoveryForm.hidden = step !== 'recovery';
        el.useRecovery.hidden = step === 'recovery';
        setError('');
        if (step === 'code') el.message.textContent = `Enter the 6-digit code we emailed to ${cfg.maskedEmail}. It expires in 10 minutes.`;
        else if (step === 'request') el.message.textContent = `We'll email a 6-digit code to ${cfg.maskedEmail}.`;
        else el.message.textContent = 'Enter your recovery key. It unlocks this app until you close it.';
        const target = step === 'code' ? el.code : step === 'recovery' ? el.recovery : el.send;
        if (target) target.focus();
      };
      const busy = (button, text) => {
        const original = button.textContent;
        button.disabled = true;
        button.textContent = text;
        return () => { button.disabled = false; button.textContent = original; };
      };
      const finish = () => {
        legacyKeys.forEach((k) => safeRemove(storage, k));
        legacySessionKeys.forEach((k) => safeRemove(session, k));
        onUnlock();
      };
      async function send(button) {
        const done = busy(button, 'Sending…');
        try { await requestCode(app); show('code'); el.code.value = ''; }
        catch (err) { setError(err.message); }
        finally { done(); }
      }
      el.send.addEventListener('click', () => send(el.send));
      el.resend.addEventListener('click', () => send(el.resend));
      el.codeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (el.verify.disabled) return;
        const done = busy(el.verify, 'Checking…');
        let unlocked = false;
        try { await submitCode(el.code.value); unlocked = true; }
        catch (err) { setError(err.message); el.code.select(); }
        finally { done(); }
        // Outside the try: a failure while the app starts must not land in the hidden lock screen.
        if (unlocked) finish();
      });
      // Phones autofill the emailed code; submit as soon as six digits are in.
      el.code.addEventListener('input', () => {
        const digits = el.code.value.replace(/\D/g, '').slice(0, 6);
        if (digits !== el.code.value) el.code.value = digits;
        if (digits.length === 6) el.codeForm.requestSubmit();
      });
      el.useRecovery.addEventListener('click', () => show('recovery'));
      el.back.addEventListener('click', () => show(hasPendingCode() ? 'code' : 'request'));
      el.recoveryForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (await unlockWithRecoveryKey(el.recovery.value)) { el.recovery.value = ''; finish(); }
        else setError('That recovery key is not right.');
      });
      show(hasPendingCode() ? 'code' : 'request');
    }

    return {
      hasValidPass, requestCode, submitCode, unlockWithRecoveryKey, lock, hasPendingCode,
      onLockedElsewhere, mountLockScreen, verifyPass, normalizeRecoveryKey,
    };
  }

  const api = { create };
  if (typeof window !== 'undefined' && typeof document !== 'undefined') Object.assign(api, create());
  return api;
});
