// Audio module tests (Node, no real WebAudio): every SFX recipe and music track is executed
// against a validating mock AudioContext, and the AudioEngine's public API is exercised.
// Real rendering (levels, peaks, NaN) is verified in Chromium via src/dev/audio-demo.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioContextMock, AudioParamMock } from './mock-audio.js';
import { getResources, createMixer, mulberry32 } from '../../src/audio/core.js';
import { SFX, SFX_NAMES, SFX_META, startSfx, hasSfx } from '../../src/audio/sfx.js';
import { TRACKS, TRACK_NAMES, TrackPlayer } from '../../src/audio/music.js';

const CONTRACT_SFX = ['click', 'select', 'deselect', 'move', 'land', 'capture', 'combo', 'promote', 'illegal', 'turn', 'win', 'lose', 'draw', 'start', 'hint', 'undo', 'whoosh', 'dash', 'impact', 'bigImpact', 'slash', 'thunder', 'charge', 'explosion', 'shatter', 'gong', 'taiko', 'riser', 'swell', 'power', 'glitch', 'heartbeat', 'zap', 'boom', 'sparkle', 'menacing'];
const CONTRACT_TRACKS = ['menu', 'classic', 'epic', 'victory', 'defeat'];

function setup() {
  const ctx = new AudioContextMock();
  const res = getResources(ctx);
  const mix = createMixer(ctx, res);
  return { ctx, res, mix };
}

/** Collects every AudioParam reachable through the nodes created so far and checks events. */
function checkParamsSane(ctx) {
  assert.deepEqual(ctx.stats.badExpRamps, [], 'exponential ramps must start from a non-zero value');
}

test('every contract SFX exists, has policy metadata and nothing extra is unknown', () => {
  for (const n of CONTRACT_SFX) {
    assert.ok(hasSfx(n), `missing sfx ${n}`);
    assert.ok(SFX_META[n], `missing meta ${n}`);
    assert.ok(SFX_META[n].max >= 1 && SFX_META[n].gap > 0 && SFX_META[n].len > 0);
  }
  assert.equal(SFX_NAMES.length, Object.keys(SFX).length);
  assert.ok(!hasSfx('nope') && !hasSfx('__proto__') && !hasSfx('constructor') && !hasSfx(undefined));
});

test('SFX recipes build valid graphs for many intensities / pitches', () => {
  for (const name of SFX_NAMES) {
    for (const [intensity, pitch, pan] of [[1, 1, 0], [0, 1, 0], [2.5, 1, 0.7], [1, 0.5, -1], [1, 2, 1], [0.3, 1.4, 0.2]]) {
      const { ctx, res, mix } = setup();
      const t = 0.5;
      const v = startSfx(ctx, res, mix.sfx, name, t, { intensity, pitch, pan, rng: mulberry32(3) });
      assert.ok(v, name);
      assert.ok(v.sources.length > 0, `${name}: no sources`);
      for (const s of ctx.sources) {
        assert.notEqual(s.startTime, null, `${name}: source never started`);
        assert.notEqual(s.stopTime, null, `${name}: source never stopped (leak)`);
        assert.ok(s.stopTime >= s.startTime, `${name}: stop before start`);
        assert.ok(s.startTime >= t - 1e-9, `${name}: starts before the voice`);
      }
      assert.ok(Number.isFinite(v.end) && v.end > t && v.end < t + 12, `${name}: bad end ${v.end}`);
      checkParamsSane(ctx);
    }
  }
});

test('voice node budget per SFX stays small (no heavy per-call allocation)', () => {
  const budget = {};
  for (const name of SFX_NAMES) {
    const { ctx, res, mix } = setup();
    while (res.warmUp());
    const before = ctx.stats.nodes;
    const buffersBefore = ctx.stats.buffers;
    startSfx(ctx, res, mix.sfx, name, 0.1, { intensity: 2.5, rng: mulberry32(1) });
    const used = ctx.stats.nodes - before;
    budget[name] = used;
    assert.ok(used < 140, `${name}: ${used} nodes`);
    assert.equal(ctx.stats.buffers, buffersBefore, `${name}: allocated an AudioBuffer per call`);
    // resources are shared: a second context-level lookup returns the same object
    assert.equal(getResources(ctx), res);
  }
  if (process.env.AUDIO_VERBOSE) console.log('nodes per sfx @2.5:', JSON.stringify(budget));
});

test('voice kill() fades and stops all sources', () => {
  const { ctx, res, mix } = setup();
  const v = startSfx(ctx, res, mix.sfx, 'gong', 0.2, {});
  v.kill(0.3);
  for (const s of v.sources) assert.ok(s.stopTime <= 0.35);
  assert.ok(v.end < 0.4);
  v.disconnect();
});

test('music tracks schedule cleanly for 40 s, with intensity changes and fades', () => {
  for (const name of CONTRACT_TRACKS) {
    assert.ok(TRACKS[name], `missing track ${name}`);
    const { ctx, res, mix } = setup();
    const p = new TrackPlayer(ctx, res, TRACKS[name], mix.music, { intensity: 0, seed: 5 });
    p.start(0.05, 1);
    const nodes0 = ctx.stats.nodes;
    for (let t = 0; t < 40; t += 0.05) {
      ctx.currentTime = t;
      if (Math.abs(t - 10) < 0.01) p.setIntensity(0.5, t);
      if (Math.abs(t - 20) < 0.01) p.setIntensity(1, t);
      p.scheduleUntil(t + 0.35);
    }
    const perSec = (ctx.stats.nodes - nodes0) / 40;
    if (process.env.AUDIO_VERBOSE) console.log(`${name}: ${perSec.toFixed(1)} nodes/s`);
    // CPU proxy: node creation rate stays modest (one-shots front-load their score)
    assert.ok(perSec < 260, `${name}: ${perSec.toFixed(0)} nodes/s`);
    if (TRACKS[name].oneShot) assert.ok(p.done, `${name} one-shot should finish`);
    else {
      assert.ok(!p.done);
      ctx.currentTime = 40;
      p.fadeOut(40, 1.5);
      ctx.currentTime = 41.6;
      p.scheduleUntil(42);
      assert.ok(p.done, `${name}: should be done after the fade`);
    }
    for (const s of ctx.sources) assert.ok(s.startTime !== null && (s.stopTime !== null || s.kind === 'osc'));
    p.dispose();
    checkParamsSane(ctx);
  }
});

test('epic intensity adds layers (more notes at 1 than at 0)', () => {
  const count = (x) => {
    const { ctx, res, mix } = setup();
    const p = new TrackPlayer(ctx, res, TRACKS.epic, mix.music, { intensity: x, seed: 9 });
    p.start(0, 0.1);
    for (let t = 0; t < 12.8; t += 0.05) {
      ctx.currentTime = t;
      p.scheduleUntil(t + 0.35);
    }
    return ctx.sources.length;
  };
  const lo = count(0), mid = count(0.5), hi = count(1);
  assert.ok(lo < mid && mid < hi, `${lo} < ${mid} < ${hi}`);
});

test('scheduler skips steps that fell behind (main-thread stall) instead of bunching them', () => {
  const { ctx, res, mix } = setup();
  const p = new TrackPlayer(ctx, res, TRACKS.epic, mix.music, { intensity: 1, seed: 1 });
  p.start(0, 0.1);
  p.scheduleUntil(0.35);
  ctx.currentTime = 5; // 5 s stall
  p.scheduleUntil(5.35);
  for (const s of ctx.sources) {
    if (s.startTime > 0.4) assert.ok(s.startTime >= 4.99, `late note at ${s.startTime}`);
  }
});

// ------------------------------------------------------------------------------ AudioEngine

async function withFakeWindow(fn) {
  const listeners = {};
  const created = [];
  class AC extends AudioContextMock {
    constructor(o) {
      super({ ...o, state: 'suspended' });
      created.push(this);
    }
  }
  const saved = { window: globalThis.window, document: globalThis.document };
  globalThis.window = {
    AudioContext: AC,
    addEventListener: (e, f) => ((listeners[e] = listeners[e] || []).push(f)),
    removeEventListener: (e, f) => (listeners[e] = (listeners[e] || []).filter((x) => x !== f)),
  };
  const docListeners = {};
  globalThis.document = {
    hidden: false,
    addEventListener: (e, f) => ((docListeners[e] = docListeners[e] || []).push(f)),
    removeEventListener: (e, f) => (docListeners[e] = (docListeners[e] || []).filter((x) => x !== f)),
  };
  try {
    await fn({ created, listeners, docListeners });
  } finally {
    globalThis.window = saved.window;
    globalThis.document = saved.document;
  }
}

test('AudioEngine without WebAudio is a silent no-op', async () => {
  const { AudioEngine } = await import('../../src/audio/audio.js');
  const a = new AudioEngine({ autoUnlock: false });
  a.unlock();
  a.play('impact');
  a.play('nope');
  a.music('epic');
  a.setIntensity(0.7);
  a.duck(0.5, 100);
  a.setSfxVolume(0.3);
  a.setMusicVolume(0.3);
  a.setMuted(true);
  a.setMuted(false);
  a.pause();
  a.resume();
  assert.equal(a.state, 'none');
  a.dispose();
});

test('AudioEngine: unlock, play, caps, unknown names, music, pause/resume, mute', async () => {
  const { AudioEngine } = await import('../../src/audio/audio.js');
  await withFakeWindow(async ({ created, listeners, docListeners }) => {
    const a = new AudioEngine({ maxVoices: 12 });
    assert.ok(listeners.pointerdown && listeners.pointerdown.length, 'gesture listener attached');
    // a gesture unlocks
    listeners.pointerdown[0]();
    assert.equal(created.length, 1);
    const ctx = created[0];
    assert.equal(a.state, 'running');
    assert.equal((listeners.pointerdown || []).length, 0, 'gesture listeners removed once running');

    // unknown names are ignored silently
    assert.doesNotThrow(() => {
      a.play('definitelyNot');
      a.play(undefined);
      a.play('__proto__');
      a.play('impact', null);
      a.music('noSuchTrack');
    });

    // voice cap
    for (let k = 0; k < 80; k++) a.play(SFX_NAMES[k % SFX_NAMES.length], { delay: k * 10 });
    assert.ok(a.activeVoices <= 12, `active ${a.activeVoices}`);

    // same-sound merge within the gap
    const nBefore = a._voices.length;
    a.play('click');
    a.play('click');
    assert.equal(a._voices.length - nBefore, 1);

    // music + crossfade
    a.music('epic', { fade: 500 });
    assert.equal(a.currentTrack, 'epic');
    a.setIntensity(1);
    a.music('epic');
    assert.equal(a._fading.length, 0, 'same track does not restart');
    a.music('menu', { fade: 500 });
    assert.equal(a.currentTrack, 'menu');
    assert.equal(a._fading.length, 1);
    a.duck(0.6, 300);
    a.duck(0.2, 100);
    assert.equal(a._duckAmount, 0.6);

    // background → suspend; foreground → resume
    globalThis.document.hidden = true;
    docListeners.visibilitychange[0]();
    a.play('impact'); // dropped while paused
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(ctx.state, 'suspended');
    globalThis.document.hidden = false;
    docListeners.visibilitychange[0]();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(ctx.state, 'running');

    // explicit pause/resume (Android hooks)
    a.pause();
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(ctx.state, 'suspended');
    a.resume();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(ctx.state, 'running');

    // mute suspends, unmute resumes; music request while muted is remembered
    a.setMuted(true);
    a.music('classic');
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(ctx.state, 'suspended');
    a.setMuted(false);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(ctx.state, 'running');
    assert.equal(a.currentTrack, 'classic');

    a.music(null, { fade: 100 });
    assert.equal(a.currentTrack, null);
    a.dispose();
    assert.equal(ctx.state, 'closed');
  });
});

test('mock sanity: exponential ramp to zero throws', () => {
  const ctx = new AudioContextMock();
  const p = new AudioParamMock(ctx, 'x', 1);
  assert.throws(() => p.exponentialRampToValueAtTime(0, 1));
});

test('one-shot stingers create their nodes progressively (no 500-node frame)', () => {
  for (const name of ['victory', 'defeat']) {
    const { ctx, res, mix } = setup();
    const p = new TrackPlayer(ctx, res, TRACKS[name], mix.music, { seed: 2 });
    const n0 = ctx.stats.nodes;
    p.start(0.05, 0.02);
    p.scheduleUntil(0.4);
    const first = ctx.stats.nodes - n0;
    let maxStep = first;
    for (let t = 0.05; t < 12; t += 0.05) {
      ctx.currentTime = t;
      const b = ctx.stats.nodes;
      p.scheduleUntil(t + 0.35);
      maxStep = Math.max(maxStep, ctx.stats.nodes - b);
    }
    const total = ctx.stats.nodes - n0;
    assert.ok(maxStep < 160, `${name}: ${maxStep} nodes in one tick`);
    assert.ok(total > first * 2, `${name}: score should be spread (${first}/${total})`);
    assert.ok(p.done);
  }
});

test('resources are lazy: warmUp builds them one by one, then nothing is allocated again', () => {
  const ctx = new AudioContextMock();
  const res = getResources(ctx);
  assert.equal(ctx.stats.buffers, 0, 'no buffers before use');
  const mix = createMixer(ctx, res, ctx.destination, { deferReverb: true });
  assert.equal(ctx.stats.buffers, 0, 'deferred reverb');
  let steps = 0;
  while (res.warmUp()) steps++;
  assert.equal(steps + 1, 6);
  const n = ctx.stats.buffers;
  mix.attachReverb();
  for (const name of SFX_NAMES) startSfx(ctx, res, mix.sfx, name, 0.1, {});
  assert.equal(ctx.stats.buffers, n);
});
