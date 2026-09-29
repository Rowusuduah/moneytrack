import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// iPhone safe areas. Without viewport-fit=cover, iOS reports every
// env(safe-area-inset-*) as 0, so the phone tab bar, the + button and the Add
// sheet sit on the home-indicator strip and its swipe zone eats their taps.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');

test('the viewport opts in to iPhone safe areas (viewport-fit=cover)', () => {
  const meta = html.match(/<meta\s+name="viewport"\s+content="([^"]*)"/);
  assert.ok(meta, 'viewport meta tag is missing');
  assert.match(meta[1], /viewport-fit=cover/);
});

test('the phone tab bar pads itself by the bottom safe area', () => {
  assert.match(css, /--safe-bottom:\s*env\(safe-area-inset-bottom/);
  const tablist = css.match(/#nav \[role="tablist"\] \{[^}]*position: fixed;[^}]*\}/)?.[0] ?? '';
  assert.match(tablist,/height:\s*calc\(var\(--tabbar-h\)\s*\+\s*var\(--safe-bottom\)\)/);
  assert.match(tablist, /padding:[^;]*var\(--safe-bottom\)/);
});

test('the phone tab bar is solid, so the page never shows through it', () => {
  const tablist = css.match(/#nav \[role="tablist"\] \{[^}]*position: fixed;[^}]*\}/)?.[0] ?? '';
  assert.match(tablist, /background:\s*var\(--surf\);/);
  assert.doesNotMatch(tablist, /backdrop-filter/);
});
