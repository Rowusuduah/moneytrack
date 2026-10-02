'use strict';

// Encrypt only the Google Drive backup. Browser-local data and JSON exports
// stay readable, so the recovery key must be kept outside this browser.
(function (root) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const cryptoAPI = () => {
    if (!root.crypto?.subtle || !root.crypto?.getRandomValues)
      throw new Error('Encrypted backups require a secure browser connection.');
    return root.crypto;
  };
  const b64 = bytes => {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  };
  function bytes(text, expectedLength) {
    if (typeof text !== 'string' || !/^[A-Za-z0-9_-]+$/.test(text))
      throw new Error('Invalid recovery key or encrypted backup.');
    const raw = Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')
      .padEnd(Math.ceil(text.length / 4) * 4, '=')), c => c.charCodeAt(0));
    if (expectedLength && raw.length !== expectedLength)
      throw new Error('Invalid recovery key or encrypted backup.');
    return raw;
  }
  async function fromRaw(raw) {
    const api = cryptoAPI();
    const digest = new Uint8Array(await api.subtle.digest('SHA-256', raw));
    const key = await api.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    return { key, keyId: b64(digest.slice(0, 16)) };
  }
  async function createRecovery() {
    const raw = cryptoAPI().getRandomValues(new Uint8Array(32));
    return { ...await fromRaw(raw), recoveryKey: b64(raw) };
  }
  async function importRecovery(text) {
    const raw = bytes(String(text || '').trim().replace(/\s+/g, ''), 32);
    return fromRaw(raw);
  }
  async function encrypt(data, key, keyId) {
    if (!key || !keyId) throw new Error('Unlock the Drive backup first.');
    const iv = cryptoAPI().getRandomValues(new Uint8Array(12));
    const plaintext = encoder.encode(JSON.stringify(data));
    const ciphertext = new Uint8Array(await cryptoAPI().subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
    return { _version: 3, _encrypted: true, _keyId: keyId,
      _exportedAt: new Date().toISOString(), _iv: b64(iv), _ciphertext: b64(ciphertext) };
  }
  async function decrypt(envelope, key, keyId) {
    if (envelope?._version !== 3 || envelope._encrypted !== true || envelope._keyId !== keyId)
      throw new Error('This backup needs a different recovery key.');
    if (typeof envelope._ciphertext !== 'string' || envelope._ciphertext.length > 20 * 1024 * 1024)
      throw new Error('Invalid encrypted backup.');
    try {
      const plaintext = await cryptoAPI().subtle.decrypt(
        { name: 'AES-GCM', iv: bytes(envelope._iv, 12) }, key, bytes(envelope._ciphertext));
      const data = JSON.parse(decoder.decode(plaintext));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid data');
      return data;
    } catch {
      throw new Error('Could not decrypt the backup. Check the recovery key or file.');
    }
  }
  const api = { createRecovery, importRecovery, encrypt, decrypt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MoneyTrackBackupCrypto = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
