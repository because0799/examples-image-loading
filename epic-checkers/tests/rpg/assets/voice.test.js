// src/rpg/voice.js with a fake HTMLAudioElement (no DOM in Node).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { VoicePlayer, voiceSettings, voiceLine, VOICE_DUCK, playVoice, configureVoice, resetVoice, stopVoice, preloadVoice, currentVoice } from '../../../src/rpg/voice.js';
import { RPG_ASSETS } from '../../../src/rpg/assets.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** Minimal HTMLAudioElement: async events like a browser; behaviour per instance via `mode`. */
class FakeAudio extends EventTarget {
  constructor(mode = {}) {
    super();
    this.mode = { play: 'ok', duration: 2.5, autoStart: true, loadError: false, ...mode };
    this._src = '';
    this.preload = '';
    this.volume = 1;
    this.muted = false;
    this.paused = true;
    this.ended = false;
    this.currentTime = 0;
    this.duration = NaN;
    this.loads = 0;
    this.plays = 0;
  }
  // like HTMLMediaElement: setting src (re)starts loading
  get src() {
    return this._src;
  }
  set src(v) {
    this._src = String(v);
    this.load();
  }
  fire(type) {
    setTimeout(() => this.dispatchEvent(new Event(type)), 0);
  }
  load() {
    this.loads++;
    if (!this.src) return;
    if (this.mode.loadError) this.fire('error');
    else
      setTimeout(() => {
        this.duration = this.mode.duration;
        this.dispatchEvent(new Event('loadedmetadata'));
      }, 0);
  }
  play() {
    this.plays++;
    if (this.mode.play === 'notallowed') return Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
    if (this.mode.play === 'unsupported') return Promise.reject(Object.assign(new Error('404'), { name: 'NotSupportedError' }));
    this.paused = false;
    this.ended = false;
    if (this.mode.play === 'hang') return new Promise(() => {});
    // like a browser: the promise settles once playback has really started
    return new Promise((resolve) =>
      setTimeout(() => {
        if (this.mode.autoStart) this.dispatchEvent(new Event('playing'));
        resolve();
      }, 1),
    );
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.fire('pause');
  }
  removeAttribute(name) {
    if (name === 'src') this._src = '';
  }
  /** test helper: the line plays to its end */
  finish() {
    this.currentTime = this.duration;
    this.ended = true;
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
    this.dispatchEvent(new Event('ended'));
  }
}

function setup(opts = {}) {
  const made = [];
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const player = new VoicePlayer({
    doc,
    createAudio: () => {
      const a = new FakeAudio(opts.mode);
      made.push(a);
      return a;
    },
    ...opts.player,
  });
  const byUrl = (url) => made.find((a) => a.src === url);
  return { player, made, doc, byUrl };
}

const EPIC = 'liora'; // Mythic, voiced
const RARE = 'vera'; //  Rare, never voiced
const hasLines = !!RPG_ASSETS.voice(EPIC, 'ultimate') && !!RPG_ASSETS.voice(EPIC, 'skill') && !!RPG_ASSETS.voice('reika', 'skill');

test('voiceSettings: defaults, clamping, mute sources', () => {
  assert.deepEqual(voiceSettings(undefined), { enabled: true, volume: 0.9, muted: false });
  assert.deepEqual(voiceSettings({ rpgVoice: false, voiceVolume: 3 }), { enabled: false, volume: 1, muted: false });
  assert.equal(voiceSettings({ voiceVolume: -1 }).volume, 0);
  assert.equal(voiceSettings({ voiceVolume: 'x' }).volume, 0.9);
  assert.equal(voiceSettings({ muted: true }).muted, true);
  assert.equal(voiceSettings({}, { muted: true }).muted, true);
});

test('voiceLine: subtitles for voiced heroes only', () => {
  const l = voiceLine('liora', 'ult');
  assert.ok(l && l.jp && l.ru && l.en);
  assert.equal(voiceLine(RARE, 'summon'), null);
  assert.equal(voiceLine('liora', 'nope'), null);
});

test('skips without creating audio when voice is off, muted, missing or hidden', async () => {
  const { player, made, doc } = setup();
  const ends = [];
  const onEnd = (r) => ends.push(r.reason);
  assert.equal(await player.play(EPIC, 'summon', { settings: { rpgVoice: false }, onEnd }), false);
  assert.equal(await player.play(EPIC, 'summon', { settings: { voiceVolume: 0 }, onEnd }), false);
  assert.equal(await player.play(EPIC, 'summon', { settings: {}, audio: { muted: true }, onEnd }), false);
  assert.equal(await player.play(RARE, 'summon', { onEnd }), false);
  assert.equal(await player.play(EPIC, 'dance', { onEnd }), false);
  doc.visibilityState = 'hidden';
  assert.equal(await player.play(EPIC, 'summon', { onEnd }), false);
  assert.deepEqual(ends, ['disabled', 'muted', 'muted', 'missing', 'missing', 'hidden']);
  assert.equal(made.length, 0);
});

test('plays a line: url, volume, onStart with subtitles, duck, resolves true at the end', { skip: !hasLines && 'voice files not shipped' }, async () => {
  const { player, made } = setup();
  const ducks = [];
  const audio = { muted: false, duck: (a, ms) => ducks.push([a, ms]) };
  let started = null;
  let ended = null;
  const p = player.play(EPIC, 'ult', { settings: { voiceVolume: 0.5 }, audio, onStart: (i) => (started = i), onEnd: (r) => (ended = r) });
  assert.equal(made.length, 1);
  const el = made[0];
  assert.equal(el.src, RPG_ASSETS.voice(EPIC, 'ultimate'));
  assert.equal(el.preload, 'auto');
  assert.equal(el.volume, 0.5);
  assert.deepEqual(player.current, { heroId: EPIC, event: 'ultimate' });
  await tick(5);
  assert.ok(started, 'onStart called');
  assert.equal(started.event, 'ultimate');
  assert.ok(started.line && started.line.jp);
  assert.equal(started.durationMs, 2500);
  assert.equal(ducks.length, 1);
  assert.equal(ducks[0][0], VOICE_DUCK);
  assert.ok(ducks[0][1] >= 2500);
  el.finish();
  assert.equal(await p, true);
  assert.deepEqual(ended, { played: true, heroId: EPIC, event: 'ultimate' });
  assert.equal(player.current, null);
});

test('one voice at a time: same priority interrupts, lower priority is dropped, force interrupts', { skip: !hasLines && 'voice files not shipped' }, async () => {
  const { player, byUrl } = setup();
  const results = [];
  const a = player.play(EPIC, 'skill', { onEnd: (r) => results.push(['a', r]) });
  await tick(5);
  const b = player.play('reika', 'skill', { onEnd: (r) => results.push(['b', r]) });
  assert.equal(await a, true, 'interrupted line still counts as played');
  assert.equal(byUrl(RPG_ASSETS.voice(EPIC, 'skill')).paused, true, 'first line paused');
  assert.deepEqual(results[0], ['a', { played: true, interrupted: true, heroId: EPIC, event: 'skill' }]);
  await tick(5);

  const u = player.play(EPIC, 'ultimate');
  await tick(5);
  assert.equal(await b, true);
  // a skill line can't cut an ultimate
  assert.equal(await player.play('reika', 'skill', { onEnd: (r) => results.push(['c', r]) }), false);
  assert.equal(results.at(-1)[1].reason, 'busy');
  assert.deepEqual(player.current, { heroId: EPIC, event: 'ultimate' });
  // ... unless forced
  const d = player.play('reika', 'skill', { force: true });
  assert.equal(await u, true);
  await tick(5);
  byUrl(RPG_ASSETS.voice('reika', 'skill')).finish();
  assert.equal(await d, true);
});

test('replaying the same line restarts it on the same element', { skip: !hasLines && 'voice files not shipped' }, async () => {
  const { player, made } = setup();
  const first = player.play(EPIC, 'skill');
  await tick(5);
  made[0].currentTime = 1.2;
  const second = player.play(EPIC, 'skill');
  assert.equal(made.length, 1, 'cached element reused');
  assert.equal(made[0].currentTime, 0);
  assert.equal(await first, true);
  await tick(5);
  assert.equal(player.playing, true, 'stale pause/ended events do not end the new line');
  made[0].finish();
  assert.equal(await second, true);
});

test('missing / broken files and blocked autoplay resolve false, never reject', { skip: !hasLines && 'voice files not shipped' }, async () => {
  {
    const { player } = setup({ mode: { play: 'unsupported' } });
    const reasons = [];
    assert.equal(await player.play(EPIC, 'skill', { onEnd: (r) => reasons.push(r.reason) }), false);
    // remembered as failed: the next try does not hit the network again
    assert.equal(await player.play(EPIC, 'skill', { onEnd: (r) => reasons.push(r.reason) }), false);
    assert.deepEqual(reasons, ['error', 'missing']);
  }
  {
    const { player } = setup({ mode: { play: 'notallowed' } });
    let reason = null;
    assert.equal(await player.play(EPIC, 'skill', { onEnd: (r) => (reason = r.reason) }), false);
    assert.equal(reason, 'blocked');
  }
  {
    const { player, made } = setup({ mode: { loadError: true, autoStart: false, play: 'hang' } });
    let reason = null;
    const p = player.play(EPIC, 'skill', { onEnd: (r) => (reason = r.reason) });
    assert.equal(made.length, 1);
    assert.equal(await p, false);
    assert.equal(reason, 'error');
  }
});

test('safety timer: a line whose ended event never comes still resolves', { skip: !hasLines && 'voice files not shipped' }, async () => {
  const { player } = setup({ mode: { duration: 0.05 }, player: { maxLineMs: 3000 } });
  const t0 = Date.now();
  assert.equal(await player.play(EPIC, 'skill'), true);
  const dt = Date.now() - t0;
  assert.ok(dt >= 50 && dt < 2500, `resolved after ${dt} ms (duration 50 ms + slack)`);
  // never starts at all -> false after maxLineMs
  const p2 = setup({ mode: { autoStart: false, play: 'hang', duration: NaN }, player: { maxLineMs: 60 } });
  assert.equal(await p2.player.play(EPIC, 'skill'), false);
});

test('app going to the background stops the line; settings changes apply live', { skip: !hasLines && 'voice files not shipped' }, async () => {
  const { player, doc, made } = setup();
  const settings = { voiceVolume: 0.8 };
  const p = player.play(EPIC, 'summon', { settings });
  await tick(5);
  settings.voiceVolume = 0.3;
  player.applySettings();
  assert.equal(made[0].volume, 0.3);
  doc.visibilityState = 'hidden';
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(await p, true);
  assert.equal(made[0].paused, true);
  assert.equal(player.playing, false);

  doc.visibilityState = 'visible';
  const q = player.play(EPIC, 'summon', { settings });
  await tick(5);
  settings.rpgVoice = false;
  player.applySettings();
  assert.equal(await q, true);
  assert.equal(player.playing, false);
});

test('preload creates elements lazily per line, Rare heroes nothing, LRU cache is capped', { skip: !hasLines && 'voice files not shipped' }, async () => {
  const { player, made } = setup({ player: { maxCached: 6 } });
  assert.equal(player.preload(RARE), 0);
  assert.equal(made.length, 0);
  const n = player.preload([EPIC, 'reika']);
  assert.equal(n, Object.keys(RPG_ASSETS.heroVoices(EPIC)).length + Object.keys(RPG_ASSETS.heroVoices('reika')).length);
  assert.ok(made.every((a) => a.preload === 'auto' && a.loads >= 1));
  assert.equal(player._cache.size, Math.min(6, n));
  const evicted = made.filter((a) => a.src === '');
  assert.equal(evicted.length, Math.max(0, n - 6), 'evicted elements release their source');
  // preloading again does not create new elements for cached lines
  const before = made.length;
  player.preload('reika');
  assert.equal(made.length, before);
});

test('module API: configureVoice / playVoice / stopVoice / preloadVoice', { skip: !hasLines && 'voice files not shipped' }, async () => {
  resetVoice();
  const made = [];
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  configureVoice({ createAudio: () => (made.push(new FakeAudio()), made.at(-1)), doc, settings: { voiceVolume: 0.7 } });
  try {
    const p = playVoice(EPIC, 'victory');
    assert.equal(made[0].volume, 0.7, 'configured settings are the default');
    assert.deepEqual(currentVoice(), { heroId: EPIC, event: 'victory' });
    await tick(5);
    assert.equal(stopVoice(), true);
    assert.equal(await p, true);
    assert.equal(await playVoice(EPIC, 'victory', { settings: { rpgVoice: false } }), false);
    assert.ok(preloadVoice(EPIC) >= 1);
    configureVoice({ settings: { rpgVoice: false } });
    assert.equal(await playVoice(EPIC, 'victory'), false);
  } finally {
    resetVoice();
  }
});
