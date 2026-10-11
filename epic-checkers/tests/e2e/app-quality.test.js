// Frame budget (performance): frame-time monitor, step-down policy, 'auto' quality, fps cap,
// PerfManager wiring (src/app-perf.js).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FrameMonitor,
  AdaptiveQuality,
  weakDevice,
  autoQuality,
  resolveQuality,
  lowerQuality,
  tickerMaxFps,
  thresholdForCap,
  FPS_CAP,
} from '../../src/app-quality.js';
import { PerfManager, QUALITY_AUTO_KEY } from '../../src/app-perf.js';

/** Feeds `ms` of frames of `dt` ms each; returns the times at which a step down was requested. */
function feed(mon, { t0, ms, dt, active = true }) {
  const steps = [];
  let t = t0;
  while (t < t0 + ms) {
    t += dt;
    if (mon.sample(dt, t, active)) steps.push(t);
  }
  return { steps, t };
}

test('FrameMonitor: smooth frames never trigger; ~3 s of frames slower than 22 ms do (after the warm-up)', () => {
  const mon = new FrameMonitor();
  assert.deepEqual(feed(mon, { t0: 0, ms: 30000, dt: 16.7 }).steps, []);
  assert.deepEqual(feed(mon, { t0: 0, ms: 30000, dt: 21 }).steps, [], '48 fps is fine');
  const m2 = new FrameMonitor();
  const r = feed(m2, { t0: 0, ms: 6000, dt: 30 });
  assert.equal(r.steps.length, 1);
  assert.ok(r.steps[0] >= 1500 + 3000 && r.steps[0] <= 1500 + 3000 + 60, `stepped at ${r.steps[0]}`);
  assert.ok(m2.lastAverage > 29 && m2.lastAverage < 31);
});

test('FrameMonitor: at most one step per 8 s; inactive time and long gaps are not measured', () => {
  const mon = new FrameMonitor();
  const r = feed(mon, { t0: 0, ms: 30000, dt: 40 });
  assert.ok(r.steps.length >= 3 && r.steps.length <= 4, `steps ${r.steps}`);
  for (let i = 1; i < r.steps.length; i++) assert.ok(r.steps[i] - r.steps[i - 1] >= 8000, 'cooldown');
  // menus (inactive): nothing, and coming back starts a fresh warm-up
  const m2 = new FrameMonitor();
  assert.deepEqual(feed(m2, { t0: 0, ms: 20000, dt: 50, active: false }).steps, []);
  const back = feed(m2, { t0: 20000, ms: 4000, dt: 50 });
  assert.equal(back.steps.length, 0, 'warm-up + a full window are needed after activation');
  // app switches / stalls (> 1 s) are ignored rather than averaged in
  const m3 = new FrameMonitor();
  let t = 0;
  let stepped = false;
  for (let i = 0; i < 400; i++) {
    const dt = i % 10 === 0 ? 1200 : 16;
    t += dt;
    stepped = m3.sample(dt, t, true) || stepped;
  }
  assert.equal(stepped, false);
  // a GC / texture hitch now and then (one 900 ms frame per window) does not trip a step
  const m4 = new FrameMonitor();
  t = 0;
  for (let i = 0; i < 3000; i++) {
    const dt = i % 180 === 90 ? 900 : 16.7;
    t += dt;
    stepped = m4.sample(dt, t, true) || stepped;
  }
  assert.equal(stepped, false, 'hitches are clamped');
});

test('FrameMonitor: a phone that is slow on EVERY frame (4 fps) still steps down', () => {
  const mon = new FrameMonitor();
  const r = feed(mon, { t0: 0, ms: 8000, dt: 250 });
  assert.equal(r.steps.length, 1);
  assert.ok(mon.lastAverage >= 99 && mon.lastAverage <= 100, `clamped average ${mon.lastAverage}`);
  const m2 = new FrameMonitor();
  assert.equal(feed(m2, { t0: 0, ms: 9000, dt: 700 }).steps.length, 1, '1.4 fps too');
});

test("FrameMonitor: 'skip' frames (slow-mo / hit-stop) are not counted and do not reset the window", () => {
  const mon = new FrameMonitor();
  let t = 0;
  let steps = 0;
  // smooth play interleaved with slow (but deliberate) slow-mo frames: never a step down
  for (let i = 0; i < 2000; i++) {
    const slow = i % 4 === 0;
    const dt = slow ? 60 : 16;
    t += dt;
    if (mon.sample(dt, t, slow ? 'skip' : true)) steps++;
  }
  assert.equal(steps, 0);
  // slow play with slow-mo moments in between still steps down (the window keeps running)
  const m2 = new FrameMonitor();
  t = 0;
  for (let i = 0; i < 400; i++) {
    const skip = i % 5 === 0;
    t += 35;
    if (m2.sample(35, t, skip ? 'skip' : true)) steps++;
  }
  assert.equal(steps, 1);
});

test('AdaptiveQuality: high → medium → low, notifies once, then stops', () => {
  let q = 'high';
  const applied = [];
  let notes = 0;
  let t = 0;
  const aq = new AdaptiveQuality({
    getQuality: () => q,
    apply: (next, prev) => {
      applied.push(`${prev}>${next}`);
      q = next;
    },
    isActive: () => true,
    notify: () => notes++,
    now: () => t,
  });
  for (let i = 0; i < 2000; i++) {
    t += 45;
    aq.frame(45);
  }
  assert.deepEqual(applied, ['high>medium', 'medium>low']);
  assert.equal(notes, 1);
  assert.equal(aq.enabled, false);
  assert.equal(aq.disabledReason, 'lowest');
  assert.equal(aq.steps.length, 2);
  assert.ok(aq.steps[1].at - aq.steps[0].at >= 8000);
});

test('AdaptiveQuality: disabled by the user / URL; a throwing apply turns it off; enable() again', () => {
  let t = 0;
  const off = new AdaptiveQuality({ enabled: false, getQuality: () => 'high', apply: () => assert.fail('must not apply'), isActive: () => true, now: () => t });
  for (let i = 0; i < 500; i++) {
    t += 60;
    off.frame(60);
  }
  const bad = new AdaptiveQuality({
    getQuality: () => 'high',
    apply: () => {
      throw new Error('boom');
    },
    isActive: () => true,
    now: () => t,
  });
  const err = console.error;
  console.error = () => {};
  try {
    for (let i = 0; i < 500; i++) {
      t += 60;
      bad.frame(60);
    }
  } finally {
    console.error = err;
  }
  assert.equal(bad.enabled, false);
  assert.equal(bad.disabledReason, 'error');
  const low = new AdaptiveQuality({ enabled: false, getQuality: () => 'low', apply() {}, isActive: () => true, now: () => t });
  low.enable();
  assert.equal(low.enabled, false, 'nothing below low');
  const hi = new AdaptiveQuality({ enabled: false, getQuality: () => 'high', apply() {}, isActive: () => true, now: () => t });
  hi.enable();
  assert.equal(hi.enabled, true);
});

test("'auto' quality: device heuristics, remembered level, explicit levels", () => {
  const phone = { width: 393, height: 873 };
  assert.equal(weakDevice({ hardwareConcurrency: 8, deviceMemory: 8 }, { screen: phone, dpr: 2.75 }), false);
  assert.equal(weakDevice({ hardwareConcurrency: 4, deviceMemory: 8 }), true, '≤ 4 cores');
  assert.equal(weakDevice({ hardwareConcurrency: 8, deviceMemory: 3 }), true, '≤ 3 GB');
  assert.equal(weakDevice({ hardwareConcurrency: 8, deviceMemory: 8 }, { screen: phone, dpr: 3 }), true, 'DPR 3 on a small screen');
  assert.equal(weakDevice({ hardwareConcurrency: 8, deviceMemory: 8 }, { screen: { width: 800, height: 1280 }, dpr: 3 }), false, 'DPR 3 tablet');
  assert.equal(weakDevice({}), false, 'unknown never counts as weak');
  assert.equal(weakDevice(null), false);
  assert.equal(autoQuality({ nav: { hardwareConcurrency: 8, deviceMemory: 8 }, screen: phone, dpr: 2.75 }), 'high');
  assert.equal(autoQuality({ nav: { hardwareConcurrency: 4 } }), 'medium');
  const nav = { hardwareConcurrency: 8, deviceMemory: 8 };
  assert.equal(resolveQuality({ quality: 'auto' }, { nav, screen: phone, dpr: 2 }), 'high');
  assert.equal(resolveQuality({ quality: 'auto' }, { nav, remembered: 'low' }), 'low', 'an earlier step down is remembered');
  assert.equal(resolveQuality({ quality: 'auto' }, { nav, remembered: 'bogus' }), 'high');
  assert.equal(resolveQuality({ quality: 'medium' }, { nav, remembered: 'low' }), 'medium', 'the user’s choice wins');
  assert.equal(lowerQuality('high'), 'medium');
  assert.equal(lowerQuality('medium'), 'low');
  assert.equal(lowerQuality('low'), null);
});

test('fps cap: tuned Pixi maxFPS and the slow-frame threshold per cap', () => {
  assert.equal(FPS_CAP.normal, 60);
  assert.equal(FPS_CAP.battery, 30);
  assert.equal(tickerMaxFps(60), 64);
  assert.equal(tickerMaxFps(30), 31);
  assert.equal(tickerMaxFps(0), 0);
  assert.equal(thresholdForCap(60), 22);
  assert.ok(thresholdForCap(30) > 1000 / 30, '30 fps frames are not "slow" with the battery saver');
  // Pixi 8 Ticker.update throttle, simulated: the tuned limit keeps 60 Hz at 60 and halves 120 Hz
  const sim = (hz, maxFPS, jitter) => {
    const min = 1000 / maxFPS;
    let last = -1;
    let n = 0;
    let seed = 7;
    for (let i = 0; i < hz * 10; i++) {
      seed = (seed * 16807) % 2147483647;
      const t = (i * 1000) / hz + (seed / 2147483647 - 0.5) * jitter;
      const delta = (t - last) | 0;
      if (delta < min) continue;
      last = t - (delta % min);
      n++;
    }
    return n / 10;
  };
  for (const hz of [59.9, 60, 61]) assert.ok(sim(hz, tickerMaxFps(60), 1.5) >= hz - 0.5, `${hz} Hz keeps every frame`);
  for (const hz of [90, 120, 144]) assert.ok(sim(hz, tickerMaxFps(60), 1.5) <= 64, `${hz} Hz capped`);
  assert.ok(sim(60, 60, 1.5) < 59, 'plain maxFPS = 60 would drop frames on a 60 Hz display');
  assert.ok(Math.abs(sim(60, tickerMaxFps(30), 1.5) - 30) < 1.5);
});

// ---------------------------------------------------------------- PerfManager
function fakeTicker() {
  return {
    maxFPS: 0,
    started: true,
    listeners: [],
    add(fn, ctx, prio) {
      this.listeners.push({ fn, prio });
    },
    stop() {
      this.started = false;
    },
    start() {
      this.started = true;
    },
  };
}

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

function makePerf({ settings, storage = memStorage(), env, urlQuality = null, active = () => true } = {}) {
  const tk = fakeTicker();
  const log = [];
  const renderer = {
    app: { ticker: tk },
    quality: null,
    setQuality(q) {
      this.quality = q;
      log.push(['renderer.setQuality', q]);
    },
    setFpsCap(c) {
      log.push(['renderer.setFpsCap', c]);
      tk.maxFPS = c; // a naive implementation: PerfManager re-tunes it afterwards
    },
    pause() {
      tk.stop();
    },
    resume() {
      tk.start();
    },
  };
  let t = 0;
  const notes = [];
  const perf = new PerfManager({
    settings,
    renderer,
    storage,
    env: env || { nav: { hardwareConcurrency: 8, deviceMemory: 8 }, screen: { width: 412, height: 915 }, dpr: 2 },
    urlQuality,
    isActive: active,
    notify: (n) => notes.push(n),
    now: () => t,
    log: () => {},
  });
  const frames = (n, dt) => {
    for (let i = 0; i < n; i++) {
      t += dt;
      for (const l of tk.listeners) l.fn({ elapsedMS: dt });
    }
  };
  return { perf, tk, renderer, log, notes, storage, frames };
}

test("PerfManager: 'auto' starts at the device level, steps down on slow frames, remembers it, toasts once", () => {
  const settings = { quality: 'auto', battery: false };
  const P = makePerf({ settings });
  assert.equal(PerfManager.initialQuality(settings, { storage: P.storage, env: { nav: { hardwareConcurrency: 8, deviceMemory: 8 } } }), 'high');
  P.perf.attach();
  assert.equal(P.tk.maxFPS, 64, '60 fps cap (tuned)');
  assert.equal(P.renderer.quality, 'high');
  assert.equal(P.perf.adaptive.enabled, true);
  P.frames(200, 16.7);
  assert.equal(P.renderer.quality, 'high', 'smooth: no change');
  P.frames(600, 30); // 18 s of 33 fps
  assert.equal(P.renderer.quality, 'low', 'high → medium → low, 8 s apart');
  assert.equal(P.storage.getItem(QUALITY_AUTO_KEY), 'low');
  assert.equal(settings.quality, 'auto', 'the setting itself stays auto');
  assert.equal(P.notes.length, 1, 'one toast');
  // next launch starts at the remembered level
  assert.equal(PerfManager.initialQuality(settings, { storage: P.storage, env: { nav: { hardwareConcurrency: 8 } } }), 'low');
});

test('PerfManager: an explicit level is never changed; back to auto forgets the remembered level', () => {
  const storage = memStorage({ [QUALITY_AUTO_KEY]: 'medium' });
  const settings = { quality: 'auto', battery: false };
  const P = makePerf({ settings, storage });
  P.perf.attach();
  assert.equal(P.renderer.quality, 'medium', 'remembered');
  settings.quality = 'high';
  P.perf.applySettings(settings);
  assert.equal(P.renderer.quality, 'high');
  assert.equal(P.perf.adaptive.enabled, false);
  P.frames(600, 40);
  assert.equal(P.renderer.quality, 'high', 'slow frames do not touch the user’s choice');
  assert.equal(storage.getItem(QUALITY_AUTO_KEY), null);
  settings.quality = 'auto';
  P.perf.applySettings(settings);
  assert.equal(P.renderer.quality, 'high', 'device default again');
  assert.equal(P.perf.adaptive.enabled, true);
  // ?quality=low pins the level for the session
  const U = makePerf({ settings: { quality: 'auto' }, urlQuality: 'low' });
  U.perf.attach();
  assert.equal(U.renderer.quality, 'low');
  assert.equal(U.perf.adaptive.enabled, false);
});

test('PerfManager: battery saver → 30 fps cap and a matching threshold; pause stops the ticker', () => {
  const settings = { quality: 'auto', battery: true };
  const P = makePerf({ settings });
  P.perf.attach();
  assert.equal(P.tk.maxFPS, 31);
  assert.equal(P.perf.fpsCap, 30);
  assert.ok(P.log.some((x) => x[0] === 'renderer.setFpsCap' && x[1] === 30));
  P.frames(600, 33.4); // a steady 30 fps is what the saver asked for
  assert.equal(P.renderer.quality, 'high');
  settings.battery = false;
  P.perf.applySettings(settings);
  assert.equal(P.tk.maxFPS, 64);
  assert.equal(P.perf.adaptive.monitor.thresholdMs, 22);
  P.perf.pause();
  assert.equal(P.tk.started, false);
  P.perf.resume();
  assert.equal(P.tk.started, true);
  // not active (menus / pause): never measured
  const M = makePerf({ settings: { quality: 'auto' }, active: () => false });
  M.perf.attach();
  M.frames(800, 45);
  assert.equal(M.renderer.quality, 'high');
});

test('PerfManager: the pause menu drops the cap to 30 fps and restores it', () => {
  const settings = { quality: 'auto', battery: false };
  const P = makePerf({ settings });
  P.perf.attach();
  P.perf.setDimmed(true);
  assert.equal(P.tk.maxFPS, 31);
  P.perf.applySettings(settings); // a settings change while paused keeps the dimmed cap
  assert.equal(P.tk.maxFPS, 31);
  P.perf.setDimmed(false);
  assert.equal(P.tk.maxFPS, 64);
  settings.battery = true;
  P.perf.applySettings(settings);
  P.perf.setDimmed(false);
  assert.equal(P.tk.maxFPS, 31, 'battery saver still caps');
});
