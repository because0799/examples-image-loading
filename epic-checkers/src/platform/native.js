// Platform bridge (ARCHITECTURE.md §7).
//
// One object for everything "native": haptics, the TTS announcer, keep-screen-on, exit, the
// Android back button and app pause/resume. Inside the APK it talks to window.AndroidBridge
// (android/java/com/epicbadass/checkers/NativeBridge.java); in a normal browser it falls back
// to Web APIs (navigator.vibrate, speechSynthesis, Screen Wake Lock, visibilitychange).
// Every call is safe: a missing bridge, a missing Web API or a throwing implementation never
// propagates an exception to the game.
//
//   import { native } from './platform/native.js';
//   native.vibrate([40, 30, 80]);                 // web convention: vibrate, pause, vibrate…
//   native.haptic('capture', { intensity: 1.5 }); // named presets (HAPTICS)
//   native.speak('COMBO!', { lang: 'en-US', pitch: 0.8, rate: 1.1 });
//   native.setHaptics('light');                   // 'off' | 'light' | 'strong' (settings.haptics)
//   native.setBackHandler(() => ui.handleBack()); // return true = handled, false = exit app
//   const off = native.onPause(() => audio.setMuted(true));
//
// Android → page hooks installed here: window.__androidBack(), window.__androidPause(),
// window.__androidResume() (called by MainActivity).

const MAX_SEGMENTS = 64;
const MAX_SEGMENT_MS = 5000;
const MAX_TOTAL_MS = 10000;
const BACK_ERROR_WINDOW_MS = 2000;

/**
 * Named haptic presets (web pattern convention: first entry vibrates). Tuned to feel like a
 * fighting game: short ticks for UI, layered kicks for hits, long rumbles for finishers.
 */
export const HAPTICS = Object.freeze({
  tap: [10],
  select: [16],
  deselect: [8],
  move: [18],
  land: [26],
  illegal: [28, 45, 28],
  hint: [12, 60, 12],
  capture: [42, 28, 66],
  impact: [70],
  bigImpact: [55, 25, 110],
  combo: [30, 22, 42, 22, 80],
  promote: [18, 40, 18, 40, 140],
  ultimate: [60, 30, 60, 30, 60, 40, 220],
  win: [80, 60, 80, 60, 260],
  lose: [220, 120, 320],
  draw: [60, 90, 60],
  turn: [14],
});

/** settings.haptics values: every vibrate() call (UI, Director …) is gated by the current one. */
export const HAPTIC_MODES = Object.freeze(['off', 'light', 'strong']);
/**
 * 'light': every pulse capped to 4–28 ms, at most 3 pulses, and a weak amplitude where the phone
 * supports it. Idempotent on purpose: callers that already softened a pattern for the 'light'
 * level (storage.hapticPattern) are not softened twice.
 */
export const LIGHT_HAPTICS = Object.freeze({ min: 4, max: 28, pulses: 3, amplitude: 70 });

/** A normalised web pattern made short and gentle for the 'light' haptics setting. */
export function lightPattern(p) {
  const L = LIGHT_HAPTICS;
  const out = [];
  let pulses = 0;
  for (let i = 0; i < p.length; i++) {
    if (i % 2 === 0) {
      if (pulses >= L.pulses) break;
      out.push(p[i] > 0 ? Math.min(L.max, Math.max(L.min, p[i])) : 0);
      if (p[i] > 0) pulses++;
    } else out.push(p[i]);
  }
  if (out.length % 2 === 0) out.pop(); // never end on a pause
  return out;
}

/** Normalises ms | ms[] into a clamped array of whole milliseconds (web convention). */
export function normalizePattern(pattern) {
  let list;
  if (typeof pattern === 'number' || typeof pattern === 'string') list = [pattern];
  else if (Array.isArray(pattern)) list = pattern;
  else if (pattern && typeof pattern.length === 'number') list = Array.from(pattern);
  else return [];
  const out = [];
  let total = 0;
  for (let i = 0; i < list.length && i < MAX_SEGMENTS; i++) {
    let v = Math.round(Number(list[i]));
    if (!Number.isFinite(v) || v < 0) v = 0;
    if (v > MAX_SEGMENT_MS) v = MAX_SEGMENT_MS;
    if (total + v > MAX_TOTAL_MS) v = Math.max(0, MAX_TOTAL_MS - total);
    out.push(v);
    total += v;
  }
  return out;
}

function hasVibration(p) {
  for (let i = 0; i < p.length; i += 2) if (p[i] > 0) return true;
  return false;
}

function clamp(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n < lo ? lo : n > hi ? hi : n;
}

function normLang(tag) {
  return String(tag || '').trim().replace(/_/g, '-').toLowerCase();
}

/**
 * Picks the best speechSynthesis voice for a BCP-47 tag: exact match first, then the same
 * primary language; local (offline) voices and the platform default win ties.
 */
export function pickVoice(voices, lang) {
  if (!voices || !voices.length) return null;
  const want = normLang(lang);
  const primary = want.split('-')[0];
  let best = null;
  let bestScore = 0;
  for (const v of voices) {
    const vl = normLang(v.lang);
    let score = 0;
    if (vl === want) score = 100;
    else if (vl.split('-')[0] === primary && primary) score = 50;
    if (!score) continue;
    if (v.localService) score += 10;
    if (v.default) score += 5;
    if (score > bestScore) {
      best = v;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Builds a native facade over a window-like object. `createNative()` uses the real window;
 * tests can pass a fake `{ AndroidBridge, navigator, document, speechSynthesis, ... }`.
 */
export function createNative(win = typeof window !== 'undefined' ? window : null) {
  const bridge = () => {
    try {
      return (win && win.AndroidBridge) || null;
    } catch (e) {
      return null;
    }
  };
  const nav = () => (win && win.navigator) || null;
  const doc = () => (win && win.document) || null;

  const warn = (what, e) => {
    try {
      console.warn(`[native] ${what} failed:`, e && e.message ? e.message : e);
    } catch (_) {
      /* no console */
    }
  };

  // Web APIs that require a user gesture: skip quietly until the page has been interacted with,
  // instead of filling the console with interventions.
  const userActivated = () => {
    const ua = nav() && nav().userActivation;
    return !ua || ua.hasBeenActive !== false;
  };

  // ------------------------------------------------------------------ speech (web fallback)
  let voices = [];
  let voicesHooked = false;
  const synth = () => (win && win.speechSynthesis) || null;
  const loadVoices = () => {
    const s = synth();
    if (!s) return;
    try {
      voices = s.getVoices() || [];
    } catch (e) {
      voices = [];
    }
    if (!voicesHooked) {
      voicesHooked = true;
      try {
        if (typeof s.addEventListener === 'function') s.addEventListener('voiceschanged', loadVoices);
        else s.onvoiceschanged = loadVoices;
      } catch (e) {
        /* ignore */
      }
    }
  };

  // ------------------------------------------------------------------ wake lock (web fallback)
  let wantAwake = false;
  let wakeSentinel = null;
  let wakePending = false;
  const requestWake = () => {
    const wl = nav() && nav().wakeLock;
    if (!wl || typeof wl.request !== 'function' || wakeSentinel || wakePending) return;
    const d = doc();
    if (d && d.visibilityState === 'hidden') return; // re-requested on visibility
    wakePending = true;
    Promise.resolve()
      .then(() => wl.request('screen'))
      .then((sentinel) => {
        wakePending = false;
        if (!wantAwake) {
          sentinel.release().catch(() => {});
          return;
        }
        wakeSentinel = sentinel;
        try {
          sentinel.addEventListener('release', () => {
            if (wakeSentinel === sentinel) wakeSentinel = null;
          });
        } catch (e) {
          /* ignore */
        }
      })
      .catch(() => {
        wakePending = false; // denied / unsupported: silently ignore
      });
  };
  const releaseWake = () => {
    const s = wakeSentinel;
    wakeSentinel = null;
    if (s) {
      try {
        s.release().catch(() => {});
      } catch (e) {
        /* ignore */
      }
    }
  };

  // ------------------------------------------------------------------ lifecycle hooks
  let backHandler = null;
  let lastBackErrorAt = -Infinity;
  const pauseListeners = new Set();
  const resumeListeners = new Set();
  let paused = false;
  let hooksInstalled = false;

  const emit = (set, info) => {
    for (const fn of Array.from(set)) {
      try {
        fn(info);
      } catch (e) {
        try {
          console.error('[native] lifecycle listener failed', e);
        } catch (_) {
          /* no console */
        }
      }
    }
  };
  const doPause = (source) => {
    if (paused) return;
    paused = true;
    emit(pauseListeners, { source });
  };
  const doResume = (source) => {
    if (!paused) return;
    paused = false;
    if (wantAwake && !bridge()) requestWake();
    emit(resumeListeners, { source });
  };

  const backEntry = () => {
    const fn = backHandler;
    if (typeof fn !== 'function') return false;
    try {
      const r = fn();
      if (r && typeof r.then === 'function') {
        // async handlers (confirm dialogs…) count as handled; swallow their rejection
        r.then(null, (e) => warn('back handler', e));
        return true;
      }
      return !!r;
    } catch (e) {
      try {
        console.error('[native] back handler threw', e);
      } catch (_) {
        /* no console */
      }
      // Never quit the game because of one bug, but don't trap the user either:
      // a second failing press within 2 s lets the app close.
      const now = Date.now();
      const exit = now - lastBackErrorAt < BACK_ERROR_WINDOW_MS;
      lastBackErrorAt = now;
      return !exit;
    }
  };

  const installHooks = () => {
    if (hooksInstalled || !win) return;
    hooksInstalled = true;
    try {
      win.__androidBack = backEntry;
      win.__androidPause = () => doPause('android');
      win.__androidResume = () => doResume('android');
    } catch (e) {
      warn('install hooks', e);
    }
    const d = doc();
    if (d && typeof d.addEventListener === 'function') {
      paused = d.visibilityState === 'hidden';
      d.addEventListener('visibilitychange', () => {
        if (d.visibilityState === 'hidden') doPause('visibility');
        else doResume('visibility');
      });
    }
    if (typeof win.addEventListener === 'function') {
      win.addEventListener('pagehide', () => doPause('pagehide'));
      win.addEventListener('pageshow', (ev) => {
        if (ev && ev.persisted) doResume('pageshow');
      });
    }
  };

  let hapticsMode = 'strong';

  // ------------------------------------------------------------------ the facade
  const api = {
    /** true inside the Android APK (window.AndroidBridge exists). */
    get isAndroid() {
      return !!bridge();
    },
    get platform() {
      return bridge() ? 'android' : 'web';
    },
    /** true while the app is in the background (after onPause listeners ran). */
    get isPaused() {
      return paused;
    },

    /** Current haptics setting ('off' | 'light' | 'strong'). */
    get haptics() {
      return hapticsMode;
    },

    /** settings.haptics: 'off' silences every vibrate() (a cancel still passes), 'light' softens. */
    setHaptics(mode) {
      const m = mode === true ? 'strong' : mode === false ? 'off' : mode;
      hapticsMode = HAPTIC_MODES.includes(m) ? m : 'strong';
      if (hapticsMode === 'off') api.vibrate(0); // stop a long rumble that is still playing
      return hapticsMode;
    },

    /** @param pattern ms | ms[] (vibrate, pause, vibrate, …). 0 / [] cancels. */
    vibrate(pattern) {
      let p = normalizePattern(pattern);
      const on = hasVibration(p);
      if (on && hapticsMode === 'off') return false;
      const light = on && hapticsMode === 'light';
      if (light) p = lightPattern(p);
      const b = bridge();
      try {
        if (b && typeof b.vibrate === 'function') {
          const spec = p.length === 1 ? String(p[0]) : JSON.stringify(p);
          if (light && typeof b.vibrateLevel === 'function') b.vibrateLevel(spec, LIGHT_HAPTICS.amplitude);
          else b.vibrate(spec);
          return true;
        }
        const n = nav();
        if (n && typeof n.vibrate === 'function') {
          if (!hasVibration(p)) return userActivated() ? n.vibrate(0) !== false : true;
          if (!userActivated()) return false;
          return n.vibrate(p.length === 1 ? p[0] : p) !== false;
        }
      } catch (e) {
        warn('vibrate', e);
      }
      return false;
    },

    /** Named preset from HAPTICS; intensity scales durations (0 = off, 1 = default, ≤ 2). */
    haptic(name, { intensity = 1 } = {}) {
      const base = HAPTICS[name];
      if (!base) return false;
      const k = clamp(intensity, 0, 2, 1);
      if (k <= 0) return false;
      return api.vibrate(base.map((ms, i) => (i % 2 === 0 ? Math.max(1, Math.round(ms * k)) : ms)));
    },

    /** Speaks with the platform TTS (flushes anything still being spoken). */
    speak(text, { lang = 'en-US', pitch = 1, rate = 1 } = {}) {
      if (text == null) return false;
      const str = String(text).trim();
      if (!str) return false;
      const pt = clamp(pitch, 0.1, 2, 1);
      const rt = clamp(rate, 0.1, 4, 1);
      const b = bridge();
      try {
        if (b && typeof b.speak === 'function') {
          b.speak(str, String(lang || 'en-US'), pt, rt);
          return true;
        }
        const s = synth();
        const U = win && win.SpeechSynthesisUtterance;
        if (!s || typeof U !== 'function' || !userActivated()) return false;
        if (!voices.length) loadVoices();
        if (s.speaking || s.pending) s.cancel();
        const u = new U(str);
        u.lang = String(lang || 'en-US');
        u.pitch = pt;
        u.rate = rt;
        u.volume = 1;
        const v = pickVoice(voices, lang);
        if (v) u.voice = v;
        s.speak(u);
        return true;
      } catch (e) {
        warn('speak', e);
        return false;
      }
    },

    stopSpeaking() {
      const b = bridge();
      try {
        if (b && typeof b.stopSpeaking === 'function') b.stopSpeaking();
        else if (synth()) synth().cancel();
      } catch (e) {
        warn('stopSpeaking', e);
      }
    },

    /** Whether speak() can produce sound (best guess; Android answers synchronously). */
    hasTTS() {
      const b = bridge();
      try {
        if (b && typeof b.hasTts === 'function') return !!b.hasTts();
        return !!(synth() && win && typeof win.SpeechSynthesisUtterance === 'function');
      } catch (e) {
        return false;
      }
    },

    /** Closes the app on Android; no-op on the web. Returns true if an exit was requested. */
    exitApp() {
      const b = bridge();
      try {
        if (b && typeof b.exitApp === 'function') {
          b.exitApp();
          return true;
        }
      } catch (e) {
        warn('exitApp', e);
      }
      return false;
    },

    /** Keeps the display awake during a game (Android window flag / Screen Wake Lock API). */
    keepScreenOn(on) {
      wantAwake = !!on;
      const b = bridge();
      try {
        if (b && typeof b.keepScreenOn === 'function') {
          b.keepScreenOn(wantAwake);
          return;
        }
        installHooks(); // re-acquire the wake lock when the page becomes visible again
        if (wantAwake) requestWake();
        else releaseWake();
      } catch (e) {
        warn('keepScreenOn', e);
      }
    },

    /**
     * Android back button handler: fn() returns true when it handled the press (close dialog,
     * go to the previous screen…), false to let the app exit. null removes the handler.
     */
    setBackHandler(fn) {
      backHandler = typeof fn === 'function' ? fn : null;
      installHooks();
    },

    /** Subscribes to app pause (background / screen off). Returns an unsubscribe function. */
    onPause(fn) {
      if (typeof fn !== 'function') return () => {};
      installHooks();
      pauseListeners.add(fn);
      return () => pauseListeners.delete(fn);
    },

    /** Subscribes to app resume (foreground again). Returns an unsubscribe function. */
    onResume(fn) {
      if (typeof fn !== 'function') return () => {};
      installHooks();
      resumeListeners.add(fn);
      return () => resumeListeners.delete(fn);
    },

    /** App / device facts: { platform, versionName?, versionCode?, sdk?, device?, locale? }. */
    info() {
      const b = bridge();
      try {
        if (b && typeof b.getInfo === 'function') {
          const o = JSON.parse(b.getInfo());
          if (o && typeof o === 'object') return o;
        }
      } catch (e) {
        warn('info', e);
      }
      const n = nav();
      return { platform: 'web', userAgent: n ? n.userAgent : '', locale: n ? n.language : '' };
    },
  };
  return api;
}

export const native = createNative();
export default native;
