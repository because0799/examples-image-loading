// AudioEngine — 100% procedural WebAudio SFX + generative music (ARCHITECTURE.md §5).
//
//   const audio = new AudioEngine({ sfxVolume: 0.8, musicVolume: 0.6 });
//   audio.unlock();                       // on the first user gesture (also auto-attached)
//   audio.play('capture', { intensity: 1, pitch: 1, pan: 0, delay: 0 /* ms */ });
//   audio.music('epic', { fade: 1000 });  // 'menu'|'classic'|'epic'|'victory'|'defeat'|null
//   audio.setIntensity(0.8);              // epic music layers
//   audio.duck(0.6, 1500);                // lower the music by 60 % for 1.5 s
//   audio.pause(); audio.resume();        // app background / foreground (Android hooks)
//
// One lazily created AudioContext. Graph: voices → sfx bus ┐
//                                          music tracks → music bus ─ duck ┤→ HP → limiter → clipper → out
//                                          shared hall/room convolvers ────┘
// Unknown SFX / track names are ignored silently. Calls before the context is running are
// dropped (SFX) or remembered (music track, volumes, intensity). Noise buffers / reverb impulse
// responses are generated lazily over a few timer ticks after the context is created.
// Visibility changes pause/resume automatically; pause()/resume() are for the Android hooks.

import { getResources, createMixer, glide, holdAt, clamp } from './core.js';
import { SFX, SFX_META, DEFAULT_META, SFX_NAMES, hasSfx, startSfx } from './sfx.js';
import { TrackPlayer, TRACKS, TRACK_NAMES, hasTrack } from './music.js';

const LOOKAHEAD = 0.35; // s of music scheduled ahead
const TICK_MS = 50; // scheduler period
const START_OFFSET = 0.012; // s: schedule SFX slightly ahead so attacks are never truncated
const DEFAULT_MAX_VOICES = 32;

/** 0..1 slider value (or 0..100) → gain with a perceptual (squared) taper. */
function volumeToGain(v) {
  let x = Number(v);
  if (!Number.isFinite(x)) x = 1;
  if (x > 1) x /= 100;
  x = clamp(x, 0, 1);
  return x * x;
}

/** `delay` option → seconds. Milliseconds per the contract; small fractional values (< 5) are
 *  treated as seconds because a sub-5-ms fractional delay is never intended. */
function delayToSeconds(d) {
  const x = Number(d);
  if (!Number.isFinite(x) || x <= 0) return 0;
  if (x < 5 && !Number.isInteger(x)) return Math.min(x, 10);
  return Math.min(x / 1000, 10);
}

const GESTURE_EVENTS = ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'keydown', 'click'];

export class AudioEngine {
  /**
   * @param {object} [opts]
   * @param {number} [opts.sfxVolume=0.8]   0..1
   * @param {number} [opts.musicVolume=0.6] 0..1
   * @param {boolean} [opts.muted=false]
   * @param {boolean} [opts.autoUnlock=true] attach one-shot gesture listeners that call unlock()
   * @param {number} [opts.maxVoices=32]    cap on simultaneous SFX voices
   */
  constructor(opts = {}) {
    this.ctx = null;
    this._res = null;
    this._mix = null;
    this._sfxVolume = opts.sfxVolume != null ? opts.sfxVolume : 0.8;
    this._musicVolume = opts.musicVolume != null ? opts.musicVolume : 0.6;
    this._muted = !!opts.muted;
    this._intensity = 0.35;
    this.maxVoices = opts.maxVoices || DEFAULT_MAX_VOICES;
    this._voices = []; // { name, v, t }
    this._lastStart = new Map();
    this._track = null;
    this._fading = [];
    this._wantTrack = null;
    this._wantFade = 1000;
    this._pause = new Set();
    this._timer = null;
    this._duckUntil = 0;
    this._duckAmount = 0;
    this._disposed = false;
    this._unlocked = false;
    this._analyser = null;
    this._tick = this._tick.bind(this);

    this._onVisibility = () => {
      if (typeof document === 'undefined') return;
      if (document.hidden) this._addPause('hidden');
      else this._removePause('hidden');
    };
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', this._onVisibility);
      if (document.hidden) this._pause.add('hidden');
    }
    if (this._muted) this._pause.add('muted');

    this._onGesture = () => {
      this.unlock();
      if (this.ctx && this.ctx.state === 'running') this._detachGestures();
    };
    this._gesturesAttached = false;
    if (opts.autoUnlock !== false && typeof window !== 'undefined' && window.addEventListener) {
      for (const e of GESTURE_EVENTS) window.addEventListener(e, this._onGesture, { capture: true, passive: true });
      this._gesturesAttached = true;
    }
  }

  // ------------------------------------------------------------------ public API (contract)

  /** Creates / resumes the AudioContext. Call from a user gesture handler. */
  unlock() {
    const ctx = this._ensure(true);
    if (!ctx) return;
    this._unlocked = true;
    const kick = () => {
      if (this.ctx === ctx) this._onState();
    };
    if (ctx.state === 'running') {
      kick();
      return;
    }
    if (this._pause.size === 0) {
      const p = ctx.resume();
      if (p && p.then) p.then(kick, () => {});
    }
    // WebKit/WebView kick: a 1-sample silent buffer played inside the gesture
    try {
      const b = ctx.createBuffer(1, 1, ctx.sampleRate);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
    } catch (e) {
      /* ignore */
    }
  }

  setSfxVolume(v) {
    this._sfxVolume = v;
    if (this._mix) glide(this._mix.sfxParams, volumeToGain(v), this.ctx.currentTime, 0.03);
  }

  setMusicVolume(v) {
    this._musicVolume = v;
    if (this._mix) glide(this._mix.musicParams, volumeToGain(v), this.ctx.currentTime, 0.05);
  }

  setMuted(m) {
    m = !!m;
    if (m === this._muted) return;
    this._muted = m;
    if (m) this._addPause('muted');
    else this._removePause('muted');
  }

  /**
   * Fire-and-forget SFX. Unknown names are ignored.
   * opts: intensity 0..2.5 (loudness + size, default 1), pitch (multiplier), pan -1..1,
   * delay in milliseconds, gain / volume (extra trim, default 1).
   */
  play(name, opts = {}) {
    if (!hasSfx(name)) return;
    if (this._muted || volumeToGain(this._sfxVolume) <= 0) return;
    const ctx = this._ensure(false);
    if (!ctx || ctx.state !== 'running' || this._pause.size) return;
    const o = opts || {};
    const now = ctx.currentTime;
    const t = now + START_OFFSET + delayToSeconds(o.delay);
    const meta = SFX_META[name] || DEFAULT_META;
    // natural variation for non-tonal sounds (avoids the "machine-gun" effect on repeats)
    let pitch = Number.isFinite(o.pitch) && o.pitch > 0 ? o.pitch : 1;
    if (meta.vary) pitch *= 1 + (Math.random() - 0.5) * meta.vary;
    const last = this._lastStart.get(name);
    if (last != null && Math.abs(t - last) < meta.gap) return; // merge near-duplicates
    this._prune(now);
    // per-sound cap → steal the oldest instance of that sound
    let same = 0;
    let oldestSame = null;
    let alive = 0;
    let oldest = null;
    // only voices whose sources still run count (a voice in its reverb tail costs nothing)
    for (const e of this._voices) {
      if (e.v.killed || e.v.srcEnd <= now) continue;
      alive++;
      if (!oldest || e.t < oldest.t) oldest = e;
      if (e.name === name) {
        same++;
        if (!oldestSame || e.t < oldestSame.t) oldestSame = e;
      }
    }
    if (same >= meta.max && oldestSame) {
      oldestSame.v.kill(now + 0.005);
      alive--;
      if (oldest === oldestSame) oldest = null;
    }
    if (alive >= this.maxVoices) {
      // global cap → steal the oldest voice overall
      let victim = oldest;
      if (!victim || victim.v.killed) {
        victim = null;
        for (const e of this._voices) if (!e.v.killed && e.v.srcEnd > now && (!victim || e.t < victim.t)) victim = e;
      }
      if (victim) victim.v.kill(now + 0.005);
    }
    let v = null;
    try {
      v = startSfx(ctx, this._res, this._mix.sfx, name, t, {
        intensity: o.intensity,
        pitch,
        pan: o.pan,
        gain: Number.isFinite(o.gain) ? o.gain : o.volume,
      });
    } catch (err) {
      if (v) v.kill(now);
      if (typeof console !== 'undefined') console.warn('[audio] sfx failed', name, err);
      return;
    }
    if (!v) return;
    this._voices.push({ name, v, t });
    this._lastStart.set(name, t);
    this._ensureTimer();
  }

  /** Switches the music track with a crossfade (`fade` ms). null stops the music. */
  music(track, { fade = 1000 } = {}) {
    const name = track == null || track === '' ? null : track;
    if (name !== null && !hasTrack(name)) return; // unknown track → ignored
    this._wantTrack = name;
    this._wantFade = Number.isFinite(fade) ? Math.max(0, fade) : 1000;
    if (this._isRunning()) this._applyTrack();
  }

  /** Epic music intensity 0..1 (adds / removes layers). */
  setIntensity(x) {
    this._intensity = clamp(Number(x) || 0, 0, 1);
    if (this._track && this.ctx) this._track.setIntensity(this._intensity, this.ctx.currentTime);
  }

  /** Lowers the music by `amount` (0..1) for `ms` milliseconds, then restores it. */
  duck(amount = 0.5, ms = 800) {
    if (!this._mix) return;
    const now = this.ctx.currentTime;
    let a = clamp(Number(amount) || 0, 0, 1);
    const until = now + Math.max(0, Number(ms) || 0) / 1000;
    if (this._duckUntil > now) a = Math.max(a, this._duckAmount);
    const end = Math.max(until, this._duckUntil);
    this._duckAmount = a;
    this._duckUntil = end;
    for (const p of this._mix.duckParams) {
      holdAt(p, now);
      p.setTargetAtTime(1 - a, now, 0.025);
      p.setTargetAtTime(1, end, 0.16);
    }
  }

  // ------------------------------------------------------------------ extra API

  /** App went to background (Android onPause). Suspends the context. */
  pause() {
    this._addPause('app');
  }

  /** App came back (Android onResume). */
  resume() {
    this._removePause('app');
  }

  /** Stops every playing SFX voice (music untouched). */
  stopAll() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const e of this._voices) e.v.kill(now);
  }

  get sfxNames() {
    return SFX_NAMES.slice();
  }

  get trackNames() {
    return TRACK_NAMES.slice();
  }

  has(name) {
    return hasSfx(name);
  }

  /** Current track name (null when silent). */
  get currentTrack() {
    return this._track && !this._track.done ? this._track.name : null;
  }

  get intensity() {
    return this._intensity;
  }

  get muted() {
    return this._muted;
  }

  get state() {
    return this.ctx ? this.ctx.state : 'none';
  }

  get activeVoices() {
    if (!this.ctx) return 0;
    const now = this.ctx.currentTime;
    return this._voices.filter((e) => !e.v.killed && e.v.srcEnd > now).length;
  }

  /** AnalyserNode tapped from the master output (for meters / visualisers). */
  getAnalyser() {
    if (!this._mix) return null;
    if (!this._analyser) {
      this._analyser = this.ctx.createAnalyser();
      this._analyser.fftSize = 1024;
      this._analyser.smoothingTimeConstant = 0.6;
      this._mix.output.connect(this._analyser);
    }
    return this._analyser;
  }

  dispose() {
    this._disposed = true;
    this._stopTimer();
    this._detachGestures();
    if (typeof document !== 'undefined' && document.removeEventListener) {
      document.removeEventListener('visibilitychange', this._onVisibility);
    }
    if (this.ctx) {
      try {
        this.ctx.close();
      } catch (e) {
        /* ignore */
      }
    }
    this.ctx = null;
    this._mix = null;
    this._voices.length = 0;
    this._track = null;
    this._fading.length = 0;
  }

  // ------------------------------------------------------------------ internals

  _isRunning() {
    return !!this.ctx && this.ctx.state === 'running' && this._pause.size === 0;
  }

  _ensure(fromGesture) {
    if (this.ctx) return this.ctx;
    if (this._disposed || typeof window === 'undefined') return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!fromGesture) {
      // avoid the "AudioContext was not allowed to start" warning before any user gesture
      const ua = typeof navigator !== 'undefined' ? navigator.userActivation : null;
      if (ua && !ua.hasBeenActive) return null;
    }
    let ctx;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch (e) {
      try {
        ctx = new AC();
      } catch (e2) {
        return null;
      }
    }
    this.ctx = ctx;
    this._res = getResources(ctx);
    this._mix = createMixer(ctx, this._res, ctx.destination, { deferReverb: true });
    this._warmUp();
    const now = ctx.currentTime;
    for (const p of this._mix.sfxParams) p.setValueAtTime(volumeToGain(this._sfxVolume), now);
    for (const p of this._mix.musicParams) p.setValueAtTime(volumeToGain(this._musicVolume), now);
    this._mix.master.gain.setValueAtTime(this._pause.size ? 0 : 1, now);
    ctx.onstatechange = () => this._onState();
    if (this._pause.size && ctx.state === 'running') ctx.suspend().catch(() => {});
    // some engines start "running" without a statechange event
    else if (ctx.state === 'running') Promise.resolve().then(() => this._onState());
    return ctx;
  }

  /** Builds the remaining DSP resources over a few timer ticks (keeps the first tap smooth). */
  _warmUp() {
    const res = this._res;
    const mix = this._mix;
    let step = 0;
    const tick = () => {
      if (this._disposed || this._res !== res) return;
      const more = res.warmUp();
      step++;
      if (step === 3) mix.attachReverb(); // white noise, room IR, hall IR are ready
      if (more) setTimeout(tick, 16);
      else mix.attachReverb();
    };
    setTimeout(tick, 0);
  }

  _onState() {
    if (!this.ctx) return;
    if (this.ctx.state === 'running') {
      if (this._pause.size) {
        // resumed by the browser while we want it paused
        this.ctx.suspend().catch(() => {});
        return;
      }
      this._detachGestures();
      this._applyTrack();
      this._ensureTimer();
    } else {
      this._stopTimer();
    }
  }

  _addPause(reason) {
    const had = this._pause.size > 0;
    this._pause.add(reason);
    if (had || !this.ctx || this.ctx.state === 'closed') return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // fade the output, then suspend (no click)
    glide([this._mix.master.gain], 0, now, 0.012);
    this._stopTimer();
    const doSuspend = () => {
      if (this._pause.size && this.ctx === ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
    };
    if (ctx.state === 'running') setTimeout(doSuspend, 70);
  }

  _removePause(reason) {
    if (!this._pause.delete(reason) || this._pause.size) return;
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') return;
    const open = () => {
      if (this._pause.size || this.ctx !== ctx) return;
      glide([this._mix.master.gain], 1, ctx.currentTime, 0.02);
    };
    if (ctx.state === 'running') {
      open();
      this._applyTrack();
      this._ensureTimer();
    } else if (this._unlocked || (typeof navigator !== 'undefined' && navigator.userActivation && navigator.userActivation.hasBeenActive)) {
      const p = ctx.resume();
      if (p && p.then) p.then(open, () => {});
    }
  }

  _applyTrack() {
    if (!this._isRunning()) return;
    const ctx = this.ctx;
    const name = this._wantTrack;
    const cur = this._track;
    if (cur && !cur.done && cur.name === name) return;
    const now = ctx.currentTime;
    const fade = Math.max(0.02, this._wantFade / 1000);
    if (cur) {
      if (cur.done) cur.dispose();
      else {
        cur.fadeOut(now, fade);
        this._fading.push(cur);
      }
      this._track = null;
    }
    if (name) {
      const def = TRACKS[name];
      const p = new TrackPlayer(ctx, this._res, def, this._mix.music, { intensity: this._intensity });
      p.start(now + 0.05, def.oneShot ? 0.02 : fade);
      p.scheduleUntil(now + LOOKAHEAD);
      this._track = p;
    }
    this._ensureTimer();
  }

  _ensureTimer() {
    if (this._timer || !this._isRunning()) return;
    this._timer = setInterval(this._tick, TICK_MS);
  }

  _stopTimer() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  _tick() {
    if (!this._isRunning()) {
      this._stopTimer();
      return;
    }
    const now = this.ctx.currentTime;
    const until = now + LOOKAHEAD;
    const tr = this._track;
    if (tr) {
      tr.scheduleUntil(until);
      if (tr.done) {
        tr.dispose();
        this._track = null;
        if (this._wantTrack === tr.name) this._wantTrack = null;
      }
    }
    if (this._fading.length) {
      for (const p of this._fading) {
        p.scheduleUntil(until);
        if (now > p.stopTime + 0.05 || p.done) p.dispose(); // dispose() marks it done
      }
      this._fading = this._fading.filter((p) => !p.done);
    }
    this._prune(now);
    if (!this._track && !this._fading.length && !this._voices.length) this._stopTimer();
  }

  _prune(now) {
    if (!this._voices.length) return;
    let w = 0;
    for (let r = 0; r < this._voices.length; r++) {
      const e = this._voices[r];
      if (e.v.end + 0.1 < now) e.v.disconnect();
      else this._voices[w++] = e;
    }
    this._voices.length = w;
    if (this._lastStart.size > 64) this._lastStart.clear();
  }

  _detachGestures() {
    if (!this._gesturesAttached) return;
    this._gesturesAttached = false;
    for (const e of GESTURE_EVENTS) window.removeEventListener(e, this._onGesture, { capture: true });
  }
}

export { SFX_NAMES, TRACK_NAMES, SFX };
export default AudioEngine;
