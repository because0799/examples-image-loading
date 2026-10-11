// FilterManager: shared full-screen filter stack (attach only while requested, sharing, caps, cleanup).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Container, Rectangle } from 'pixi.js';
import { FilterManager } from '../../src/fx/filters.js';

class FakeFilter {
  constructor(kind) {
    this.kind = kind;
    this.enabled = true;
    this.resolution = 1;
    this.matrix = null;
    this.time = 0;
  }
  destroy() {
    this.destroyed = true;
  }
}

function setup(quality = 'high') {
  const layers = {};
  for (const k of ['background', 'world', 'screenFx', 'overlay']) layers[k] = new Container();
  const stage = new Container();
  const renderer = { ready: true, resolution: 2, layers, app: { stage, screen: new Rectangle(0, 0, 390, 844) } };
  const factories = {};
  for (const k of ['rgb', 'zoom', 'bloom', 'impact', 'grade', 'shockwave', 'godray']) factories[k] = () => new FakeFilter(k);
  const fm = new FilterManager(renderer, { factories });
  fm.setQuality(quality);
  return { fm, stage, layers, renderer };
}

const kinds = (c) => (c.filters || []).map((f) => f.kind || f.name);
const none = (c) => !c.filters || c.filters.length === 0;

test('a request attaches its filter to the stage only while held', () => {
  const { fm, stage } = setup();
  assert.ok(none(stage));
  const h = fm.request('rgb');
  assert.deepEqual(kinds(stage), ['rgb']);
  assert.ok(stage.filterArea, 'stage gets a screen filterArea while filters run');
  h.release();
  assert.ok(none(stage));
  assert.ok(!stage.filterArea);
  h.release(); // double release is harmless
  assert.ok(none(stage));
});

test('overlapping requests share one instance; the strongest wins', () => {
  const { fm, stage } = setup();
  const a = fm.request('rgb');
  const b = fm.request('rgb');
  assert.equal(a.filter, b.filter);
  assert.deepEqual(kinds(stage), ['rgb']);
  a.strength = 2;
  a.angle = 0;
  b.strength = 6;
  b.angle = 0;
  fm.update();
  assert.equal(a.filter.redX, 6);
  assert.equal(a.filter.blueX, -6);
  b.release();
  fm.update();
  assert.equal(a.filter.redX, 2);
  assert.deepEqual(kinds(stage), ['rgb']);
  a.release();
  assert.ok(none(stage));
});

test('stage order is fixed (shockwave → zoom → rgb → bloom) and foreign filters are kept', () => {
  const { fm, stage } = setup();
  const foreign = { name: 'foreign', enabled: true };
  stage.filters = [foreign];
  const bl = fm.request('bloom');
  const rg = fm.request('rgb');
  const sw = fm.shockwave();
  const zo = fm.request('zoom');
  assert.deepEqual(kinds(stage), ['foreign', 'shockwave', 'zoom', 'rgb', 'bloom']);
  for (const h of [bl, rg, sw, zo]) h.release();
  assert.deepEqual(kinds(stage), ['foreign']);
});

test('shockwaves get dedicated instances up to the per-quality cap and are pooled', () => {
  const { fm, stage } = setup('high');
  const hs = [fm.shockwave(), fm.shockwave()];
  assert.ok(hs.every(Boolean));
  assert.equal(new Set(hs.map((h) => h.filter)).size, 2);
  assert.equal(fm.shockwave(), null, 'cap reached (2 distortion passes at most)');
  const first = hs[0].filter;
  hs[0].release();
  assert.equal(kinds(stage).length, 1);
  const again = fm.shockwave();
  assert.equal(again.filter, first, 'released instance is reused');
  for (const h of [again, hs[1]]) h.release();
  assert.ok(none(stage));
});

test('soft filters (bloom, zoom blur, god-rays) render at half resolution, crisp ones at the renderer resolution', () => {
  const { fm } = setup('high');
  const b = fm.request('bloom');
  const z = fm.request('zoom');
  const g = fm.godray();
  const r = fm.request('rgb');
  const i = fm.request('impact');
  assert.equal(b.filter.resolution, 0.5);
  assert.equal(z.filter.resolution, 0.5);
  assert.equal(g.filter.resolution, 0.5);
  assert.equal(r.filter.resolution, 2);
  assert.equal(i.filter.resolution, 2);
  fm.setQuality('medium');
  assert.equal(r.filter.resolution, 1);
  assert.equal(b.filter.resolution, 0.5);
  for (const h of [b, z, g, r, i]) h.release();
});

test('quality gates expensive filters', () => {
  const { fm } = setup('medium');
  assert.equal(fm.request('zoom'), null);
  assert.equal(fm.request('bloom'), null);
  assert.ok(fm.request('rgb'));
  assert.ok(fm.shockwave());
  assert.equal(fm.shockwave(), null);
  const low = setup('low').fm;
  for (const k of ['rgb', 'zoom', 'bloom', 'impact', 'grade']) assert.equal(low.request(k), null, k);
  assert.equal(low.shockwave(), null);
  assert.equal(low.godray(), null);
});

test('impact frame matrix goes on background, world and screenFx (inverted / posterized)', () => {
  const { fm, layers, stage } = setup();
  const h = fm.request('impact');
  h.mode = 1;
  h.amount = 0.3;
  fm.update();
  for (const k of ['background', 'world', 'screenFx']) assert.deepEqual(kinds(layers[k]), ['impact'], k);
  assert.ok(none(stage));
  const m = h.filter.matrix;
  assert.ok(m[0] < 0 && m[1] < 0 && m[2] < 0, 'inverted luminance');
  assert.equal(m[18], 1, 'alpha preserved');
  h.mode = 2;
  fm.update();
  assert.ok(h.filter.matrix[0] > 0, 'posterized positive');
  h.release();
  for (const k of ['background', 'world', 'screenFx']) assert.ok(none(layers[k]), k);
});

test('grade fully desaturates to luminance', () => {
  const { fm } = setup();
  const h = fm.request('grade');
  h.amount = 1;
  h.dark = 0;
  h.tint = 0xffffff;
  fm.update();
  const m = h.filter.matrix;
  for (let r = 0; r < 3; r++) {
    assert.ok(Math.abs(m[r * 5] - 0.299) < 1e-6);
    assert.ok(Math.abs(m[r * 5 + 1] - 0.587) < 1e-6);
    assert.ok(Math.abs(m[r * 5 + 2] - 0.114) < 1e-6);
  }
  h.release();
});

test('clear() detaches everything and kills handles', () => {
  const { fm, stage, layers } = setup();
  const hs = [fm.request('rgb'), fm.request('bloom'), fm.request('impact'), fm.shockwave(), fm.godray(), fm.request('grade')];
  assert.ok(hs.every(Boolean));
  fm.clear();
  assert.ok(none(stage));
  for (const k of ['background', 'world', 'screenFx']) assert.ok(none(layers[k]), k);
  assert.ok(hs.every((h) => !h.alive));
  hs[0].release();
  assert.ok(none(stage));
  assert.ok(fm.request('rgb'), 'usable again after clear');
});
