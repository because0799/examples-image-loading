// FxTextures crack decal cache (F10): bounded to 8 variants, evicting any unreferenced entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FxTextures } from '../../src/fx/textures.js';

function cache() {
  const T = Object.create(FxTextures.prototype);
  T._misc = new Map();
  return T;
}

function rec(refs = 0) {
  const tex = () => ({ destroyed: false, destroy() { this.destroyed = true; } });
  return { base: tex(), glow: tex(), size: 64, destroyed: false, refs };
}

test('evicts the oldest unreferenced cracks, not just the first key', () => {
  const T = cache();
  const list = [];
  for (let i = 0; i < 14; i++) {
    const r = rec(i < 3 ? 1 : 0); // the three oldest are still on screen
    list.push(r);
    T._misc.set(`crack|${i}`, r);
  }
  T._misc.set('emblem|x', rec(0)); // other caches are untouched
  T._trimCracks(list[13]);
  assert.equal(T.crackCount, 8);
  for (let i = 0; i < 3; i++) assert.equal(list[i].destroyed, false, 'in-use cracks stay');
  assert.equal(list[13].destroyed, false, 'the entry being returned stays');
  assert.equal(list[3].destroyed, true);
  assert.equal(list[3].base.destroyed, true);
  assert.ok(T._misc.has('emblem|x'));
});

test('stays above the bound only while every extra crack is in use, and trims once they are released', () => {
  const T = cache();
  const list = [];
  for (let i = 0; i < 10; i++) {
    const r = rec(1);
    list.push(r);
    T._misc.set(`crack|${i}`, r);
  }
  T._trimCracks();
  assert.equal(T.crackCount, 10);
  for (const r of list) r.refs = 0;
  T._trimCracks();
  assert.equal(T.crackCount, 8);
});
