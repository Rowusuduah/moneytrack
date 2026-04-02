'use strict';

const CACHE_NAME = 'moneytrack-v5';
const APP_SHELL  = [
  './index.html',
  './css/styles.css',
  './js/app.js',
  './icons/icon.svg',
  './manifest.json',
];

// Pre-cache the app shell on install
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Delete old caches on activate
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first for app shell; network-only for Google APIs
self.addEventListener('fetch', e => {
  const url = e.request.url;
  // Never intercept Google auth / Drive API calls
  if (url.includes('googleapis.com') || url.includes('accounts.google.com')) return;
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return response;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
