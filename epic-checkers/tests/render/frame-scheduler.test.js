// Renderer frame scheduling: fps cap (ticker.maxFPS), idle detection, epic ≤ 30 fps idle, classic
// render-on-demand + heartbeat, wake() / tweens / input / FX layers / probes, occlusion. Headless:
// the Renderer is never init()ed — a fake app (ticker, stage render group, render counter) and a
// virtual clock drive _tick() + _present() like the Pixi ticker does (60 Hz).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sprite, Texture } from 'pixi.js';
import { Renderer, tickerMaxFps, IDLE_DELAY_MS, HEARTBEAT_MS } from '../../src/render/renderer.js';
import { tween } from '../../src/render/tween.js';

function make(theme = 'epic') {
  const r = new Renderer({ clientWidth: 360, clientHeight: 640 });
  const rg = { structureDidChange: false, childrenRenderablesToUpdate: { index: 0, list: [] }, childrenToUpdate: {}, renderGroupChildren: [] };
  const stage = { filters: null, renderGroup: rg };
  const presents = [];
  let t = 10000;
  r.app = {
    ticker: { maxFPS: 0 },
    stage,
    render: () => {
      presents.push(t);
      rg.structureDidChange = false; // a render consumes the change flags
    },
    renderer: { texture: { managedTextures: [] } },
    canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 640 }) },
    screen: { width: 360, height: 640 },
  };
  r.ready = true;
  r.theme = theme;
  r._now = () => t;
  const frame = (ms = 1000 / 60) => {
    t += ms;
    r._tick({ deltaMS: ms });
    r._present();
  };
  const run = (ms, step = 1000 / 60) => {
    const n0 = presents.length;
    const frames = Math.round(ms / step);
    for (let i = 0; i < frames; i++) frame(step);
    return presents.length - n0;
  };
  return { r, presents, frame, run, rg, stage, now: () => t };
}

test('tickerMaxFps: 60 → 64 (keeps every 60 Hz vsync, halves 120 Hz), 30 → 31, 0 → uncapped', () => {
  assert.equal(tickerMaxFps(60), 64);
  assert.equal(tickerMaxFps(30), 31);
  assert.equal(tickerMaxFps(0), 0);
  assert.equal(tickerMaxFps(null), 0);
});

test('setFpsCap drives ticker.maxFPS; the battery saver caps at 30 and releases back', () => {
  const { r } = make();
  r.setFpsCap(60);
  assert.equal(r.fpsCap, 60);
  assert.equal(r.app.ticker.maxFPS, 64);
  r.setFpsCap(45);
  assert.equal(r.app.ticker.maxFPS, 46);
  r.setFpsCap(0);
  assert.equal(r.fpsCap, 0);
  assert.equal(r.app.ticker.maxFPS, 0);
  r.setFpsCap(60);
  r.applySettings({ battery: true });
  assert.equal(r.fpsCap, 30);
  assert.equal(r.app.ticker.maxFPS, 31);
  r.setFpsCap(20); // an explicit lower cap still wins
  assert.equal(r.fpsCap, 20);
  r.setFpsCap(60);
  assert.equal(r.fpsCap, 30);
  r.applySettings({ battery: false });
  assert.equal(r.fpsCap, 60);
  assert.equal(r.app.ticker.maxFPS, 64);
});

test('active: every ticked frame is presented; idle after 1.5 s; epic idle presents at ≤ 30 fps', () => {
  const { r, run } = make('epic');
  assert.equal(run(1000), 60);
  assert.equal(r.idle, false);
  run(1000);
  assert.equal(r.idle, true, 'nothing moved for > 1.5 s since the first frame woke it');
  const idleRate = run(2000) / 2;
  assert.ok(idleRate >= 28 && idleRate <= 31, `epic idle ≈ 30 fps, got ${idleRate}`);
});

test('the idle switch flips after IDLE_DELAY_MS without activity', () => {
  const { r, run } = make('epic');
  r.wake();
  run(IDLE_DELAY_MS - 100);
  assert.equal(r.idle, false);
  run(200);
  assert.equal(r.idle, true);
});

test('classic idle renders on demand: nothing changed → only the heartbeat; a change → presented', () => {
  const { r, run, rg, frame, presents } = make('classic');
  run(2000);
  assert.equal(r.idle, true);
  const quiet = run(3000);
  assert.ok(quiet >= 2 && quiet <= 4, `heartbeat only (~1/s), got ${quiet} in 3 s`);
  assert.ok(HEARTBEAT_MS >= 500);
  // a scene change while idle: presented within the 30 fps idle gap
  rg.structureDidChange = true;
  const n0 = presents.length;
  frame();
  frame();
  frame();
  assert.ok(presents.length > n0, 'a dirty scene is presented');
  assert.equal(rg.structureDidChange, false);
  // continuous ambient change (e.g. a pulsing ring) → ≤ 30 fps
  const n1 = presents.length;
  for (let i = 0; i < 60; i++) {
    rg.childrenToUpdate[0] = { index: 1, list: [] };
    frame();
    if (presents.length && presents[presents.length - 1] === undefined) break;
  }
  const rate = presents.length - n1;
  assert.ok(rate >= 25 && rate <= 31, `classic ambient change ≈ 30 fps while idle, got ${rate}`);
});

test('wake() presents the very next frame at the full rate', () => {
  const { r, run, frame, presents } = make('classic');
  run(3000);
  assert.equal(r.idle, true);
  r.wake();
  const n0 = presents.length;
  frame();
  assert.equal(presents.length, n0 + 1);
  assert.equal(r.idle, false);
  assert.equal(run(500), 30, 'full rate while woken');
});

test('a tween on the renderer clock wakes it (clock.onActivity) and keeps it active while it runs', () => {
  const { r, run, frame, presents } = make('classic');
  run(3000);
  assert.equal(r.idle, true);
  const o = { x: 0 };
  tween(o, { x: 1 }, { duration: 2500, clock: r.clock });
  const n0 = presents.length;
  frame();
  assert.equal(presents.length, n0 + 1);
  assert.equal(run(2000), 120, 'every frame presented while the tween runs');
  assert.equal(r.idle, false);
  run(2500);
  assert.equal(r.idle, true, 'idle again 1.5 s after the tween ended');
});

test('pointer input, camera shakes, FX layer content and probes count as activity', async () => {
  const { r, run } = make('epic');
  run(3000);
  assert.equal(r.idle, true);
  r._onPointerDown({ isPrimary: true, pointerType: 'touch', clientX: 0, clientY: 0 });
  run(100);
  assert.equal(r.idle, false);

  run(3000);
  r.camera.shake(0.3, 2000);
  run(1900);
  assert.equal(r.idle, false, 'a running shake is activity');

  run(4000);
  assert.equal(r.idle, true);
  const s = new Sprite(Texture.WHITE);
  const box = r.layers.screenFx;
  box.addChild(s);
  run(3000);
  assert.equal(r.idle, false, 'a visible sprite in an FX layer (an effect) keeps it active');
  s.visible = false;
  run(2000);
  assert.equal(r.idle, true, 'hidden FX content does not');
  box.removeChild(s);

  // a deeply nested effect (root → band → sprite, below the FX container) counts too
  const { Container } = await import('pixi.js');
  const fxRoot = new Container();
  const band = new Container();
  const deep = new Container();
  deep.addChild(new Sprite(Texture.WHITE));
  band.addChild(deep);
  fxRoot.addChild(band);
  const permanent = new Container(); // an FX module's own (empty) container
  box.addChild(permanent);
  run(3000);
  assert.equal(r.idle, true, 'empty FX containers are not activity');
  permanent.addChild(fxRoot);
  run(2000);
  assert.equal(r.idle, false, 'nested effect content is activity');
  permanent.removeChild(fxRoot);
  run(2000);
  assert.equal(r.idle, true);

  let busy = true;
  const off = r.addActivityProbe(() => busy);
  run(3000);
  assert.equal(r.idle, false);
  busy = false;
  run(2000);
  assert.equal(r.idle, true);
  off();
  assert.equal(r._probes.length, 0);
});

test('occluded: nothing is presented; un-occluding presents at once', () => {
  const { r, run, frame, presents } = make('epic');
  r.setOccluded(true);
  assert.equal(run(1000), 0);
  r.setOccluded(false);
  const n0 = presents.length;
  frame();
  assert.equal(presents.length, n0 + 1);
});

test('idleMode = false presents every frame forever', () => {
  const { r, run } = make('classic');
  r.idleMode = false;
  run(3000);
  assert.equal(r.idle, false);
  assert.equal(run(1000), 60);
});

test('perfStats reports the scheduler state and counters', () => {
  const { r, run } = make('epic');
  run(3000);
  const s = r.perfStats();
  assert.equal(s.idle, true);
  assert.equal(s.ticks, 180);
  assert.ok(s.renders > 100 && s.renders < 180);
  assert.equal(s.renders + s.skipped, s.ticks);
  assert.ok(s.idleRenders > 0);
});
