// FX runner: effect promises, clear(), composable slow-mo / hit-stop, aura auto-stop, cleanup.
// Runs headless with a minimal fake renderer (quality 'low' → no GPU filters are created).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Container, Texture, Rectangle } from 'pixi.js';
import { Clock } from '../../src/render/tween.js';
import { FX } from '../../src/fx/fx.js';

function fakeRenderer() {
  const layers = {};
  for (const k of ['background', 'world', 'board', 'boardFx', 'highlights', 'pieces', 'worldFx', 'screenFx', 'overlay']) layers[k] = new Container();
  return {
    ready: true,
    clock: new Clock(),
    layers,
    theme: 'epic',
    resolution: 1,
    squareSize: 40,
    boardCenter: { x: 160, y: 160 },
    frameBounds: { x: 0, y: 0, width: 320, height: 320 },
    screen: { width: 390, height: 844 },
    camera: { zoom: 1, punchScale: 1, rotation: 0, shakeRot: 0, ox: 0, oy: 0, shakeX: 0, shakeY: 0, shake() {} },
    app: { stage: new Container(), screen: new Rectangle(0, 0, 390, 844) },
    lightning() {},
  };
}

const tex = new Texture();
const fakeTextures = { atlas: tex, frame: () => tex, rays: () => tex, vignette: () => tex, destroy() {} };

function setup(mode = 'epic') {
  const r = fakeRenderer();
  const fx = new FX({ renderer: r, quality: 'low', mode, textures: fakeTextures });
  const step = (ms, n = 1) => {
    for (let i = 0; i < n; i++) r.clock.update(ms);
  };
  return { r, fx, step };
}

test('effects resolve true when finished and leave nothing behind', async () => {
  const { fx, step } = setup();
  const p = fx.shockwave(100, 100, { duration: 200 });
  const b = fx.burst(100, 100, { kind: 'spark' });
  assert.ok(fx.stats().nodes > 0);
  step(16, 60);
  assert.equal(await p, true);
  assert.equal(await b, true);
  const st = fx.stats();
  assert.equal(st.effects, 0);
  assert.equal(st.nodes, 0);
  assert.equal(st.particles, 0);
});

test('clear() interrupts everything: promises resolve false, containers empty, time restored', async () => {
  const { fx, r, step } = setup();
  const a = fx.shockwave(10, 10, { duration: 5000 });
  const f = fx.flash(0xffffff, { duration: 5000 });
  const s = fx.slowMo(0.3, 5000);
  step(16, 20);
  assert.ok(r.clock.scale < 0.5);
  fx.clear();
  assert.equal(await a, false);
  assert.equal(await f, false);
  assert.equal(await s, false);
  assert.equal(r.clock.scale, 1);
  assert.equal(fx.stats().nodes, 0);
});

test('hit-stop inside slow-mo returns to the slow-mo, then eases back to 1', () => {
  const { fx, r, step } = setup();
  fx.slowMo(0.5, 400, { inMs: 100, outMs: 100 });
  step(16, 10); // 160 ms: in the hold
  assert.equal(r.clock.scale, 0.5);
  fx.hitStop(100);
  assert.ok(r.clock.scale <= 0.02 + 1e-9, 'frozen immediately');
  step(16, 3);
  assert.ok(r.clock.scale <= 0.02 + 1e-9, 'still frozen');
  step(16, 5); // hit-stop over
  assert.equal(r.clock.scale, 0.5, 'back to slow-mo');
  step(16, 30); // past hold + out
  assert.equal(r.clock.scale, 1);
  assert.equal(fx._time.applied, null, 'FX released the time scale');
});

test('a lone hit-stop restores scale 1 and classic halves it', async () => {
  const { fx, r, step } = setup('classic');
  const p = fx.hitStop(100); // 50 ms in classic
  assert.ok(r.clock.scale < 0.05);
  step(16, 4);
  assert.equal(r.clock.scale, 1);
  assert.equal(await p, true);
});

test('aura auto-stops when the piece view is recycled', async () => {
  const { fx, step } = setup();
  const view = new Container();
  view.auraLayer = new Container();
  view.addChild(view.auraLayer);
  view.body = { y: -2, scale: { x: 1 } };
  view.squareSize = 40;
  view.color = 1;
  const parent = new Container();
  parent.addChild(view);
  const a = fx.aura(view, { color: 0xffd23f });
  step(16, 5);
  assert.equal(view.auraLayer.children.length, 1);
  view.auraLayer.removeChildren(); // what PieceView.resetState() does
  step(16, 1);
  assert.equal(await a.promise, false);
  assert.equal(fx.stats().auras, 0);
});

test('aura stop() fades out and resolves true', async () => {
  const { fx, step } = setup();
  const view = new Container();
  view.auraLayer = new Container();
  view.addChild(view.auraLayer);
  view.body = { y: 0, scale: { x: 1 } };
  view.squareSize = 40;
  new Container().addChild(view);
  const a = fx.aura(view);
  step(16, 3);
  const p = a.stop();
  step(16, 30);
  assert.equal(await p, true);
  assert.equal(view.auraLayer.children.length, 0);
});

test('classic mode turns epic-only punctuation into no-ops', async () => {
  const { fx } = setup('classic');
  assert.equal(await fx.speedLines({}), true);
  assert.equal(await fx.chromatic(1, 300), true);
  assert.equal(await fx.zoomBlur(0, 0, 0.3, 300), true);
  assert.equal(await fx.menacing(0, 0), true);
  assert.equal(fx.stats().nodes, 0);
});
