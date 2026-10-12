// «Валькирии доски» — Japanese hero voice lines (owner: assets).
//
//   import { playVoice, preloadVoice, stopVoice, configureVoice } from './voice.js';
//   configureVoice({ settings, audio });               // once, at startup (optional, see below)
//   preloadVoice(['liora', 'reika']);                  // e.g. when a battle starts (lazy otherwise)
//   const played = await playVoice('liora', 'ultimate', { settings, onStart: ({ line, durationMs }) => … });
//
// playVoice(heroId, event, opts) -> Promise<boolean>
//   Resolves when the line has finished (true), was cut off by another line / stopVoice() / the app
//   going to the background (true), or could not play at all (false: voice off, muted, no such line —
//   Rare heroes have none —, a missing / broken file, blocked autoplay, or a higher-priority line is
//   playing). It never rejects. event: 'summon' | 'skill' | 'ultimate' | 'victory' (aliases 'ult', 'win').
//   opts:
//     settings   live settings object: rpgVoice (bool, default true), voiceVolume (0..1, default 0.9),
//                muted (bool, optional). Falls back to the one given to configureVoice().
//     audio      AudioEngine (src/audio): when it is muted the voice is silent too, and while a line
//                plays the music is ducked by −8 dB (audio.duck). Falls back to configureVoice().
//     force      true: always interrupt the current line (e.g. a "play voice" button). Otherwise a new
//                line interrupts only a line of the same or lower priority: ultimate (3) >
//                summon = victory (2) > skill (1); a lower one is dropped (resolves false).
//     volume     extra 0..1 multiplier (default 1).
//     onStart(info)  called when sound starts: { heroId, event, url, line: { jp, ru, en } | null, durationMs }.
//     onEnd(result)  called once at the end: { played, reason?, interrupted?, heroId, event }.
//                reason (when played is false): 'disabled' | 'muted' | 'missing' | 'busy' | 'hidden' |
//                'blocked' | 'error' | 'unsupported'.
//
// Playback uses one HTMLAudioElement per line (works in the Android WebView, which serves the mp3s
// from the APK assets and allows playback without a user gesture); only one line sounds at a time.
// Elements are created on demand (preload = 'auto') and kept in a small LRU cache.
//
// The music duck: if `audio` is given here, do not duck again at the call site.

import { RPG_ASSETS, voiceEventName } from './assets.js';
import { VOICE_LINES } from './data/voice-lines.js';

export const VOICE_DEFAULTS = Object.freeze({ rpgVoice: true, voiceVolume: 0.9 });

/** Interruption priority per event (see playVoice opts.force). */
export const VOICE_PRIORITY = Object.freeze({ skill: 1, summon: 2, victory: 2, ultimate: 3 });

/** Music duck while a line plays: −8 dB (GDD §18.6) = gain 0.4 → amount 0.6. */
export const VOICE_DUCK = 0.6;

const DEFAULT_LINE_MS = 3500; // used for the duck / safety timer until the real duration is known
const MAX_LINE_MS = 9000; //     a line never blocks longer than this, even if 'ended' never fires
const END_SLACK_MS = 1500; //    grace after the known duration before the safety timer gives up
const RETRY_FAILED_MS = 30000; // a file that failed to load is not retried for this long

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** { enabled, volume, muted } that `settings` (+ an optional AudioEngine) ask for. */
export function voiceSettings(settings, audio) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const enabled = s.rpgVoice !== false;
  const volume = clamp01(num(s.voiceVolume, VOICE_DEFAULTS.voiceVolume));
  const muted = s.muted === true || !!(audio && audio.muted === true);
  return { enabled, volume, muted };
}

/** Subtitles of a line: { jp, ru, en } (frozen) or null. */
export function voiceLine(heroId, event) {
  const e = voiceEventName(event);
  const h = e && VOICE_LINES[heroId];
  const l = h && h.lines && h.lines[e];
  return l ? Object.freeze({ jp: l.jp, ru: l.ru, en: l.en }) : null;
}

function defaultCreateAudio() {
  return typeof Audio === 'function' ? new Audio() : null;
}

/**
 * The player behind playVoice(). Exported for tests and for hosts that want their own instance.
 * Options (all optional): assets (RPG_ASSETS), createAudio () => HTMLAudioElement, doc (document,
 * for visibility), settings, audio, maxCached (24), maxLineMs, setTimeout / clearTimeout.
 */
export class VoicePlayer {
  constructor(opts = {}) {
    this.assets = opts.assets || RPG_ASSETS;
    this.createAudio = opts.createAudio || defaultCreateAudio;
    this.doc = opts.doc !== undefined ? opts.doc : typeof document !== 'undefined' ? document : null;
    this.settings = opts.settings || null;
    this.audio = opts.audio || null;
    this.maxCached = Math.max(2, opts.maxCached || 24);
    this.maxLineMs = opts.maxLineMs || MAX_LINE_MS;
    this._setTimeout = opts.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    this._clearTimeout = opts.clearTimeout || ((id) => clearTimeout(id));
    this._cache = new Map(); // url -> { el, failedAt, used }
    this._session = null; //    the line that is playing
    this._tick = 0;
    this._disposed = false;
    this._onVisibility = () => {
      if (this.doc && this.doc.visibilityState === 'hidden') this.stop('hidden');
    };
    if (this.doc && typeof this.doc.addEventListener === 'function') this.doc.addEventListener('visibilitychange', this._onVisibility);
  }

  /** Default settings / audio engine for later play() calls (pass only what changes). */
  configure({ settings, audio } = {}) {
    if (settings !== undefined) this.settings = settings || null;
    if (audio !== undefined) this.audio = audio || null;
    this.applySettings(settings || undefined, audio || undefined);
  }

  /** Re-reads the settings for the playing line: stops it when voice got disabled / muted, else updates its volume. */
  applySettings(settings, audio) {
    const s = this._session;
    if (!s) return;
    const v = voiceSettings(settings || s.settings || this.settings, audio || s.audio || this.audio);
    if (!v.enabled || v.muted || v.volume <= 0) {
      this.stop(v.enabled ? 'muted' : 'disabled');
      return;
    }
    try {
      s.el.volume = clamp01(v.volume * s.gain);
    } catch (e) {
      /* read-only volume (iOS): ignore */
    }
  }

  /** { heroId, event } of the line that is playing, or null. */
  get current() {
    const s = this._session;
    return s ? { heroId: s.heroId, event: s.event } : null;
  }

  get playing() {
    return !!this._session;
  }

  /** Warms the cache for these heroes (id or array) and events (default: all four). Returns the number of lines. */
  preload(heroIds, events = RPG_ASSETS.voiceEvents) {
    if (this._disposed) return 0;
    const ids = Array.isArray(heroIds) ? heroIds : [heroIds];
    let n = 0;
    for (const id of ids) {
      for (const ev of events) {
        const url = this.assets.voice(id, ev);
        if (url && this._element(url)) n++;
      }
    }
    return n;
  }

  /** Stops the playing line (its promise resolves true, interrupted). */
  stop(reason = 'stopped') {
    const s = this._session;
    if (!s) return false;
    this._finish(s, s.started, reason, true);
    try {
      s.el.pause();
    } catch (e) {
      /* ignore */
    }
    return true;
  }

  play(heroId, event, opts = {}) {
    const ev = voiceEventName(event);
    const base = { heroId, event: ev || String(event) };
    const settings = opts.settings || this.settings;
    const audio = opts.audio || this.audio;
    const done = (played, reason) => {
      const result = played ? { played, ...base } : { played, reason, ...base };
      if (typeof opts.onEnd === 'function') safeCall(opts.onEnd, result);
      return Promise.resolve(played);
    };
    if (this._disposed) return done(false, 'unsupported');

    const v = voiceSettings(settings, audio);
    if (!v.enabled) return done(false, 'disabled');
    const gain = clamp01(num(opts.volume, 1));
    if (v.muted || v.volume * gain <= 0) return done(false, 'muted');
    const url = ev ? this.assets.voice(heroId, ev) : null;
    if (!url) return done(false, 'missing');
    if (this.doc && this.doc.visibilityState === 'hidden') return done(false, 'hidden');

    const priority = VOICE_PRIORITY[ev] || 1;
    const cur = this._session;
    if (cur && !opts.force && priority < cur.priority) return done(false, 'busy');

    const entry = this._entry(url);
    if (!entry) return done(false, 'unsupported');
    if (entry.failedAt && Date.now() - entry.failedAt < RETRY_FAILED_MS) return done(false, 'missing');
    if (entry.failedAt) this._reload(entry, url);

    if (cur) {
      this._finish(cur, cur.started, 'interrupted', true);
      if (cur.el !== entry.el) {
        try {
          cur.el.pause();
        } catch (e) {
          /* ignore */
        }
      }
    }

    return new Promise((resolve) => {
      const el = entry.el;
      const s = {
        id: ++this._tick, heroId, event: ev, url, el, entry, priority, gain, settings, audio, opts,
        resolve, started: false, finished: false, timer: 0, listeners: [],
      };
      this._session = s;
      entry.used = ++this._tick;

      const on = (type, fn) => {
        el.addEventListener(type, fn);
        s.listeners.push([type, fn]);
      };
      on('playing', () => this._started(s));
      on('ended', () => {
        if (el.ended !== false) this._finish(s, true, 'ended');
      });
      on('pause', () => {
        // the system (audio focus, app pause) paused us; a stale 'pause' of an interrupted session is ignored
        if (el.paused && !el.ended && s.started) this._finish(s, true, 'paused', true);
      });
      on('error', () => {
        entry.failedAt = Date.now();
        this._finish(s, s.started, 'error');
      });
      on('loadedmetadata', () => {
        this._arm(s);
        // duration known only now: stretch the music duck over the whole line
        const d = this._durationMs(s);
        if (s.started && d && s.audio && typeof s.audio.duck === 'function') safeCall(() => s.audio.duck(VOICE_DUCK, d + 250));
      });

      try {
        el.muted = false;
        el.volume = clamp01(v.volume * gain);
      } catch (e) {
        /* ignore */
      }
      try {
        if (el.currentTime) el.currentTime = 0;
      } catch (e) {
        /* not seekable yet: starts at 0 anyway */
      }
      this._arm(s);
      let p;
      try {
        p = el.play();
      } catch (e) {
        this._finish(s, false, 'error');
        return;
      }
      if (p && typeof p.then === 'function') {
        p.then(
          () => this._started(s),
          (err) => {
            if (s.finished) return;
            const name = err && err.name;
            if (name === 'AbortError') this._finish(s, s.started, 'interrupted', s.started);
            else if (name === 'NotAllowedError') this._finish(s, false, 'blocked');
            else {
              entry.failedAt = Date.now();
              this._finish(s, false, 'error');
            }
          },
        );
      }
      this._evict();
    });
  }

  dispose() {
    this.stop('disposed');
    this._disposed = true;
    if (this.doc && typeof this.doc.removeEventListener === 'function') this.doc.removeEventListener('visibilitychange', this._onVisibility);
    for (const [, entry] of this._cache) release(entry.el);
    this._cache.clear();
  }

  // ------------------------------------------------------------------ internals

  _entry(url) {
    let entry = this._cache.get(url);
    if (entry) return entry;
    const el = this.createAudio();
    if (!el) return null;
    try {
      el.preload = 'auto';
      el.src = url; // setting src starts the media load algorithm (no load() call needed)
    } catch (e) {
      return null;
    }
    entry = { el, failedAt: 0, used: ++this._tick };
    const onError = () => {
      entry.failedAt = Date.now();
    };
    el.addEventListener('error', onError);
    this._cache.set(url, entry);
    return entry;
  }

  _element(url) {
    const entry = this._entry(url);
    this._evict();
    return entry ? entry.el : null;
  }

  _reload(entry, url) {
    entry.failedAt = 0;
    try {
      entry.el.src = url; // re-setting src (even to the same value) reloads the resource
    } catch (e) {
      /* ignore */
    }
  }

  _evict() {
    if (this._cache.size <= this.maxCached) return;
    const playing = this._session && this._session.url;
    const order = [...this._cache.entries()].filter(([url]) => url !== playing).sort((a, b) => a[1].used - b[1].used);
    while (this._cache.size > this.maxCached && order.length) {
      const [url, entry] = order.shift();
      this._cache.delete(url);
      release(entry.el);
    }
  }

  _durationMs(s) {
    const d = Number(s.el.duration);
    return Number.isFinite(d) && d > 0 ? Math.round(d * 1000) : null;
  }

  /** (Re)arms the safety timer: known duration + slack, else the maximum line length. */
  _arm(s) {
    if (s.finished) return;
    if (s.timer) this._clearTimeout(s.timer);
    const d = this._durationMs(s);
    const remaining = d ? Math.max(0, d - Math.round((Number(s.el.currentTime) || 0) * 1000)) : null;
    const ms = Math.min(this.maxLineMs, remaining != null ? remaining + END_SLACK_MS : this.maxLineMs);
    s.timer = this._setTimeout(() => this._finish(s, s.started, s.started ? 'timeout' : 'error'), ms);
  }

  _started(s) {
    if (s.finished || s.started) return;
    s.started = true;
    this._arm(s);
    const durationMs = this._durationMs(s);
    const audio = s.audio;
    if (audio && typeof audio.duck === 'function') safeCall(() => audio.duck(VOICE_DUCK, (durationMs || DEFAULT_LINE_MS) + 250));
    if (typeof s.opts.onStart === 'function') {
      safeCall(s.opts.onStart, { heroId: s.heroId, event: s.event, url: s.url, line: voiceLine(s.heroId, s.event), durationMs });
    }
  }

  _finish(s, played, reason, interrupted = false) {
    if (s.finished) return;
    s.finished = true;
    if (s.timer) this._clearTimeout(s.timer);
    for (const [type, fn] of s.listeners) s.el.removeEventListener(type, fn);
    s.listeners.length = 0;
    if (this._session === s) this._session = null;
    if (!played) {
      try {
        s.el.pause();
      } catch (e) {
        /* ignore */
      }
    }
    const result = { played: !!played, heroId: s.heroId, event: s.event };
    if (!played) result.reason = reason;
    else if (interrupted) result.interrupted = true;
    if (typeof s.opts.onEnd === 'function') safeCall(s.opts.onEnd, result);
    s.resolve(!!played);
  }
}

function release(el) {
  try {
    el.pause();
    el.removeAttribute('src');
    if (typeof el.load === 'function') el.load();
  } catch (e) {
    /* ignore */
  }
}

function safeCall(fn, arg) {
  try {
    fn(arg);
  } catch (e) {
    if (typeof console !== 'undefined') console.error('[voice]', e);
  }
}

// ------------------------------------------------------------------ module-level API

let player = null;
let pending = {};

function getPlayer() {
  if (!player) player = new VoicePlayer(pending);
  return player;
}

/**
 * Configures the shared player: { settings, audio } defaults for playVoice, and — before the first
 * use only — { createAudio, doc, maxCached, assets }.
 */
export function configureVoice(opts = {}) {
  if (!player) {
    pending = { ...pending, ...opts };
    return;
  }
  player.configure(opts);
}

/** Plays a hero line (see the header). Never rejects. */
export function playVoice(heroId, event, opts = {}) {
  try {
    return getPlayer().play(heroId, event, opts || {});
  } catch (e) {
    if (typeof console !== 'undefined') console.error('[voice]', e);
    return Promise.resolve(false);
  }
}

/** Starts loading the lines of these heroes (id or array; default: all four events). */
export function preloadVoice(heroIds, events) {
  try {
    return getPlayer().preload(heroIds, events || RPG_ASSETS.voiceEvents);
  } catch (e) {
    return 0;
  }
}

/** Stops the line that is playing (if any). */
export function stopVoice() {
  return player ? player.stop() : false;
}

/** Applies changed settings to the playing line (volume; stops it when voice was turned off / muted). */
export function applyVoiceSettings(settings, audio) {
  if (player) player.applySettings(settings, audio);
}

/** { heroId, event } of the playing line, or null. */
export function currentVoice() {
  return player ? player.current : null;
}

/** Drops the shared player (tests / hot reload). */
export function resetVoice() {
  if (player) player.dispose();
  player = null;
  pending = {};
}

export default playVoice;
