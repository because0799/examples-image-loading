// Adaptive graphics quality (performance): frame-time monitor, step-down policy, weak devices.

import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameMonitor, AdaptiveQuality, weakDevice, lowerQuality } from '../../src/app-quality.js';

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

test('FrameMonitor: smooth frames never trigger; ~4 s of slow frames do (after the warm-up)', () => {
  const mon = new FrameMonitor();
  assert.deepEqual(feed(mon, { t0: 0, ms: 30000, dt: 16.7 }).steps, []);
  assert.deepEqual(feed(mon, { t0: 0, ms: 30000, dt: 23 }).steps, [], '43 fps is fine');
  const m2 = new FrameMonitor();
  const r = feed(m2, { t0: 0, ms: 6000, dt: 30 });
  assert.equal(r.steps.length, 1);
  assert.ok(r.steps[0] >= 1500 + 4000 && r.steps[0] <= 1500 + 4000 + 60, `stepped at ${r.steps[0]}`);
  assert.ok(m2.lastAverage > 29 && m2.lastAverage < 31);
});

test('FrameMonitor: at most one step per 10 s; inactive time and long gaps are not measured', () => {
  const mon = new FrameMonitor();
  const r = feed(mon, { t0: 0, ms: 30000, dt: 40 });
  assert.ok(r.steps.length >= 2 && r.steps.length <= 3, `steps ${r.steps}`);
  for (let i = 1; i < r.steps.length; i++) assert.ok(r.steps[i] - r.steps[i - 1] >= 10000, 'cooldown');
  // menus (inactive): nothing, and coming back starts a fresh warm-up
  const m2 = new FrameMonitor();
  assert.deepEqual(feed(m2, { t0: 0, ms: 20000, dt: 50, active: false }).steps, []);
  const back = feed(m2, { t0: 20000, ms: 5000, dt: 50 });
  assert.equal(back.steps.length, 0, 'warm-up + a full window are needed after activation');
  // app switches / hitches (> 250 ms) are ignored rather than averaged in
  const m3 = new FrameMonitor();
  let t = 0;
  let stepped = false;
  for (let i = 0; i < 400; i++) {
    const dt = i % 10 === 0 ? 1200 : 16;
    t += dt;
    stepped = m3.sample(dt, t, true) || stepped;
  }
  assert.equal(stepped, false);
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
  assert.ok(aq.steps[1].at - aq.steps[0].at >= 10000);
});

test('AdaptiveQuality: disabled by the user / URL; a throwing apply turns it off', () => {
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
});

test('weakDevice / lowerQuality', () => {
  assert.equal(weakDevice({ hardwareConcurrency: 4, deviceMemory: 2 }), true);
  assert.equal(weakDevice({ hardwareConcurrency: 4, deviceMemory: 4 }), false);
  assert.equal(weakDevice({ hardwareConcurrency: 8, deviceMemory: 2 }), false);
  assert.equal(weakDevice({ hardwareConcurrency: 4 }), false, 'unknown memory never counts as weak');
  assert.equal(weakDevice(null), false);
  assert.equal(lowerQuality('high'), 'medium');
  assert.equal(lowerQuality('medium'), 'low');
  assert.equal(lowerQuality('low'), null);
});
