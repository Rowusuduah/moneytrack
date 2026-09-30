'use strict';

// Three-way merge for the browser's data, the last copy this device synced,
// and the newest Drive copy. Pure so conflict cases can be tested in Node.
(function (root) {
  const ABSENT = Symbol('absent');
  const same = (a, b) => a === b || (a !== ABSENT && b !== ABSENT && JSON.stringify(a) === JSON.stringify(b));
  const object = v => v !== ABSENT && v !== null && typeof v === 'object' && !Array.isArray(v);

  function arrayKey(path, values) {
    const all = values.filter(Array.isArray).flat();
    if (!all.length) return path === 'moneytrack_snapshots' ? 'date' : 'id';
    if (all.every(v => typeof v === 'string')) return '$value';
    if (all.every(v => object(v) && v.id != null)) return 'id';
    if ((path === 'moneytrack_snapshots' || /(?:rateHistory|history)$/.test(path)) &&
        all.every(v => object(v) && typeof v.date === 'string')) return 'date';
    return null;
  }

  function mergeValue(base, local, remote, path, conflicts) {
    if (same(local, remote)) return local;
    if (same(local, base)) return remote;
    if (same(remote, base)) return local;

    // A deletion against a concurrent edit is ambiguous; never resurrect it.
    if (local === ABSENT || remote === ABSENT) {
      conflicts.push(path);
      return local;
    }

    if (object(local) && object(remote) && (base === ABSENT || object(base))) {
      const result = {};
      const keys = new Set([...Object.keys(base === ABSENT ? {} : base), ...Object.keys(local), ...Object.keys(remote)]);
      for (const key of keys) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        const get = v => v === ABSENT || !Object.hasOwn(v, key) ? ABSENT : v[key];
        const value = mergeValue(get(base), get(local), get(remote), `${path}.${key}`, conflicts);
        if (value !== ABSENT) result[key] = value;
      }
      return result;
    }

    if (Array.isArray(local) && Array.isArray(remote) && (base === ABSENT || Array.isArray(base))) {
      const key = arrayKey(path, [base, local, remote]);
      if (key) {
        const id = v => String(key === '$value' ? v : v[key]);
        const asMap = arr => new Map((arr === ABSENT ? [] : arr).map(v => [id(v), v]));
        const b = asMap(base), l = asMap(local), r = asMap(remote);
        const ids = new Set([...l.keys(), ...r.keys(), ...b.keys()]);
        const out = [];
        for (const itemId of ids) {
          const value = mergeValue(b.has(itemId) ? b.get(itemId) : ABSENT,
            l.has(itemId) ? l.get(itemId) : ABSENT,
            r.has(itemId) ? r.get(itemId) : ABSENT, `${path}[${itemId}]`, conflicts);
          if (value !== ABSENT) out.push(value);
        }
        if (key === 'date') out.sort((a, b) => a.date.localeCompare(b.date));
        if (path === 'moneytrack_txns') out.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
        return out;
      }
    }
    conflicts.push(path);
    return local;
  }

  function parseData(data, keys) {
    const out = {};
    for (const key of keys) {
      if (!Object.hasOwn(data || {}, key)) continue;
      out[key] = key === 'moneytrack_theme' ? data[key] : JSON.parse(data[key], (k, v) => k === '__proto__' ? undefined : v);
    }
    return out;
  }

  function mergeData(baseData, localData, remoteData, keys) {
    const b = parseData(baseData, keys), l = parseData(localData, keys), r = parseData(remoteData, keys);
    const conflicts = [], data = {};
    for (const key of keys) {
      const get = v => Object.hasOwn(v, key) ? v[key] : ABSENT;
      const value = mergeValue(get(b), get(l), get(r), key, conflicts);
      if (value !== ABSENT) data[key] = key === 'moneytrack_theme' ? value : JSON.stringify(value);
    }
    return { data, conflicts };
  }

  const api = { mergeData };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MoneyTrackSyncMerge = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
