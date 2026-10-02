import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';

globalThis.crypto ??= webcrypto;
const require = createRequire(import.meta.url);
const C = require('../js/backup-crypto.js');

test('Drive envelope encrypts data and the recovery key opens it on another device', async () => {
  const created = await C.createRecovery();
  assert.equal(created.recoveryKey.length, 43);
  assert.equal(created.key.extractable, false);
  const data = { moneytrack_txns: '[{"amount":123.45}]', moneytrack_theme: 'dark' };
  const envelope = await C.encrypt(data, created.key, created.keyId);
  assert.equal(envelope._version, 3);
  assert.equal(envelope._encrypted, true);
  assert.ok(!JSON.stringify(envelope).includes('123.45'));
  const recovered = await C.importRecovery(created.recoveryKey);
  assert.equal(recovered.keyId, created.keyId);
  assert.deepEqual(await C.decrypt(envelope, recovered.key, recovered.keyId), data);
});

test('each upload uses a fresh nonce and a wrong key cannot decrypt', async () => {
  const first = await C.createRecovery();
  const second = await C.createRecovery();
  const a = await C.encrypt({ x: 'private' }, first.key, first.keyId);
  const b = await C.encrypt({ x: 'private' }, first.key, first.keyId);
  assert.notEqual(a._iv, b._iv);
  assert.notEqual(a._ciphertext, b._ciphertext);
  await assert.rejects(C.decrypt(a, second.key, second.keyId), /different recovery key/);
  await assert.rejects(C.decrypt({ ...a, _ciphertext: b._ciphertext }, first.key, first.keyId), /Could not decrypt/);
});

test('invalid recovery strings and malformed envelopes fail closed', async () => {
  await assert.rejects(C.importRecovery('not a recovery key'), /Invalid recovery key/);
  const vault = await C.createRecovery();
  await assert.rejects(C.decrypt({ _version: 3, _encrypted: true, _keyId: vault.keyId,
    _iv: 'bad', _ciphertext: 'bad' }, vault.key, vault.keyId), /Could not decrypt/);
});

test('large backups encode without overflowing the call stack', async () => {
  const vault = await C.createRecovery();
  const data = { moneytrack_txns: 'x'.repeat(200_000) };
  const envelope = await C.encrypt(data, vault.key, vault.keyId);
  assert.deepEqual(await C.decrypt(envelope, vault.key, vault.keyId), data);
});
