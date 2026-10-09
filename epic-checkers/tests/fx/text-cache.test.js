// FxTextures lettering cache: LRU eviction by count and pixel budget, never evicting in-use entries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FxTextures } from '../../src/fx/textures.js';

function cache({ maxText = 3, maxTextPixels = 1e9 } = {}) {
  const T = Object.create(FxTextures.prototype);
  T._text = new Map();
  T._textClock = 0;
  T._textPx = 0;
  T.maxText = maxText;
  T.maxTextPixels = maxTextPixels;
  return T;
}

function add(T, key, { refs = 0, px = 100 } = {}) {
  const tex = { destroyed: false, fx: { key }, destroy() { this.destroyed = true; } };
  T._text.set(key, { tex, refs, used: ++T._textClock, px });
  T._textPx += px;
  return tex;
}

test('evicts least-recently-used free entries beyond the count limit', () => {
  const T = cache({ maxText: 2 });
  const a = add(T, 'a');
  const b = add(T, 'b');
  const c = add(T, 'c');
  T._evictText();
  assert.equal(a.destroyed, true);
  assert.equal(b.destroyed, false);
  assert.equal(c.destroyed, false);
  assert.equal(T._text.size, 2);
});

test('entries in use are never evicted, even over budget', () => {
  const T = cache({ maxText: 1 });
  const a = add(T, 'a', { refs: 1 });
  const b = add(T, 'b', { refs: 2 });
  T._evictText();
  assert.equal(a.destroyed || b.destroyed, false);
  T.releaseText(a);
  T._evictText();
  assert.equal(a.destroyed, true);
  assert.equal(b.destroyed, false);
});

test('pixel budget evicts until under the limit and keeps the total in sync', () => {
  const T = cache({ maxText: 99, maxTextPixels: 250 });
  const a = add(T, 'a', { px: 100 });
  const b = add(T, 'b', { px: 100 });
  const c = add(T, 'c', { px: 100 });
  T._evictText();
  assert.equal(a.destroyed, true);
  assert.equal(b.destroyed || c.destroyed, false);
  assert.equal(T.textStats.pixels, 200);
});

test('releaseText ignores foreign / already released textures', () => {
  const T = cache();
  const a = add(T, 'a', { refs: 1 });
  T.releaseText(a);
  T.releaseText(a);
  assert.equal(T._text.get('a').refs, 0);
  T.releaseText({ fx: { key: 'zzz' } });
  T.releaseText(null);
});
