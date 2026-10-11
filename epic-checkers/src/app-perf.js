// Frame budget at run time: frame-rate cap, effective graphics quality ('auto' + adaptive step
// down), ticker pause while the app is in the background. The policy itself (thresholds, device
// heuristics) lives in src/app-quality.js; this file wires it to the renderer / controller / UI.
//
//   const q0 = PerfManager.initialQuality(settings, { storage, env, urlQuality });  // before renderer.init
//   const perf = new PerfManager({ settings, renderer, controller, ui, storage, env, urlQuality,
//                                  isActive, notify });
//   perf.attach();               // after renderer.init: fps cap + frame monitor on the Pixi ticker
//   perf.applySettings(s);       // boot + every 'settings' event (battery → 30 fps, quality changes)
//   perf.pause() / perf.resume() // app hidden / visible again: the ticker stops completely
//   perf.setDimmed(true|false)   // pause menu open over the board: 30 fps is plenty
//
// settings.quality: 'auto' (default) | 'high' | 'medium' | 'low'. In 'auto' the effective level
// starts at the device default (app-quality.autoQuality) or at the level an earlier adaptive step
// down chose (remembered in localStorage under QUALITY_AUTO_KEY), and steps down by itself when
// frames are slow. An explicit level is used as is and is never changed by the app.
// isActive() may return true (measure this frame), false (not playing: reset the window) or
// 'skip' (playing, but a deliberate slow-mo / hit-stop runs: do not count this frame).

import { AdaptiveQuality, FPS_CAP, QUALITY_ORDER, autoQuality, resolveQuality, thresholdForCap, tickerMaxFps } from './app-quality.js';

export const QUALITY_AUTO_KEY = 'epic-checkers.quality-auto';

const isLevel = (q) => QUALITY_ORDER.includes(q);

function lsGet(storage, key) {
  try {
    return storage ? storage.getItem(key) : null;
  } catch (e) {
    return null;
  }
}

function lsSet(storage, key, value) {
  try {
    if (!storage) return;
    if (value == null) storage.removeItem(key);
    else storage.setItem(key, String(value));
  } catch (e) {
    /* storage blocked: the level is simply not remembered */
  }
}

/** Default storage: localStorage when usable. */
export function defaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch (e) {
    return null;
  }
}

/** Device facts for the 'auto' heuristic (overridable in tests). */
export function deviceEnv(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return { nav: null, screen: null, dpr: 1 };
  const scr = win.screen && win.screen.width > 0 ? { width: win.screen.width, height: win.screen.height } : { width: win.innerWidth, height: win.innerHeight };
  return { nav: win.navigator || null, screen: scr, dpr: Number(win.devicePixelRatio) || 1 };
}

export class PerfManager {
  /** Effective quality to start the renderer with. */
  static initialQuality(settings, { storage = defaultStorage(), env = deviceEnv(), urlQuality = null } = {}) {
    if (isLevel(urlQuality)) return urlQuality;
    return resolveQuality(settings, { remembered: lsGet(storage, QUALITY_AUTO_KEY), ...env });
  }

  constructor({ settings, renderer, controller = null, ui = null, storage = defaultStorage(), env = deviceEnv(), urlQuality = null, adaptive = true, isActive = () => false, notify = null, now = () => performance.now(), log = null } = {}) {
    this.settings = settings;
    this.renderer = renderer;
    this.controller = controller;
    this.ui = ui;
    this.storage = storage;
    this.env = env;
    this.urlQuality = isLevel(urlQuality) ? urlQuality : null;
    this.log = log || ((m) => console.info(m));
    this.effective = PerfManager.initialQuality(settings, { storage, env, urlQuality: this.urlQuality });
    this.fpsCap = 0;
    this.paused = false;
    this.dimmed = false;
    this._qSetting = undefined;
    this._attached = false;
    this.adaptive = new AdaptiveQuality({
      enabled: false, // decided by applySettings ('auto' only)
      getQuality: () => this.effective,
      apply: (next, prev) => this._autoStep(next, prev),
      isActive,
      notify,
      now,
    });
    this._allowAdaptive = !!adaptive && !this.urlQuality;
    this._onFrame = (tk) => {
      this.adaptive.frame(tk && tk.elapsedMS);
    };
  }

  get ticker() {
    const app = this.renderer && this.renderer.app;
    return (app && app.ticker) || null;
  }

  /** After renderer.init: frame monitor on the ticker, fps cap, quality class. */
  attach() {
    if (this._attached) return;
    const tk = this.ticker;
    if (!tk) return;
    this._attached = true;
    tk.add(this._onFrame, null, -100); // after the renderer's own update (UPDATE_PRIORITY.LOW-ish)
    this.applySettings(this.settings);
  }

  /** Battery saver → 30 fps; quality setting changes (user picked a level / went back to 'auto'). */
  applySettings(st = this.settings) {
    if (!st) return;
    this.setFpsCap(st.battery || this.dimmed ? FPS_CAP.battery : FPS_CAP.normal);
    const q = st.quality;
    const first = this._qSetting === undefined;
    if (q !== this._qSetting) {
      this._qSetting = q;
      if (this.urlQuality) {
        this._setEffective(this.urlQuality);
      } else if (isLevel(q)) {
        // the user's choice: used as is, never changed by the app
        if (!first) lsSet(this.storage, QUALITY_AUTO_KEY, null);
        this._setEffective(q);
      } else if (first) {
        this._setEffective(this.effective); // 'auto' at boot: device default or remembered level
      } else {
        // back to 'auto': start again from the device default
        lsSet(this.storage, QUALITY_AUTO_KEY, null);
        this._setEffective(autoQuality(this.env));
      }
      const auto = !this.urlQuality && !isLevel(q);
      if (auto && this._allowAdaptive) this.adaptive.enable();
      else this.adaptive.disable(this.urlQuality ? 'url' : this._allowAdaptive ? 'user' : 'off');
    } else {
      this._setEffective(this.effective); // re-assert after other modules re-applied their settings
    }
  }

  /** Frame-rate cap in fps (60 normally, 30 with the battery saver; 0 = uncapped). */
  setFpsCap(cap) {
    const c = Math.max(0, Number(cap) || 0);
    const tk = this.ticker;
    if (this.renderer && typeof this.renderer.setFpsCap === 'function') {
      try {
        this.renderer.setFpsCap(c);
      } catch (e) {
        /* optional */
      }
    }
    // the tuned Pixi limit (see tickerMaxFps) — set after the renderer's own setFpsCap
    if (tk) tk.maxFPS = tickerMaxFps(c);
    if (c !== this.fpsCap) {
      this.fpsCap = c;
      this.adaptive.monitor.setThreshold(thresholdForCap(c || FPS_CAP.normal));
      this.adaptive.monitor.warmup(this.adaptive.now());
    }
  }

  /** Effective level → renderer + FX (via the controller) + the UI's q-* class. */
  _setEffective(q) {
    if (!isLevel(q)) return;
    const changed = q !== this.effective;
    this.effective = q;
    const c = this.controller;
    if (c && typeof c.setQuality === 'function') c.setQuality(q);
    else if (this.renderer && typeof this.renderer.setQuality === 'function') this.renderer.setQuality(q);
    this._uiClass(q);
    if (changed) this.adaptive.monitor.warmup(this.adaptive.now());
  }

  _uiClass(q) {
    const root = (this.ui && this.ui.root) || (typeof document !== 'undefined' ? document.getElementById('ui') : null);
    if (!root || !root.classList) return;
    for (const l of QUALITY_ORDER) if (l !== q) root.classList.remove(`q-${l}`);
    root.classList.add(`q-${q}`);
  }

  /** Adaptive step down ('auto' only): applied now and remembered for the next launch. */
  _autoStep(next, prev) {
    this._setEffective(next);
    lsSet(this.storage, QUALITY_AUTO_KEY, next);
    this.log(`[perf] graphics quality ${prev} → ${next} (avg frame ${this.adaptive.monitor.lastAverage.toFixed(1)} ms)`);
  }

  /** Forces one adaptive step down (tests / debugging). */
  stepDown() {
    return this.adaptive.stepDown();
  }

  /** The pause menu covers the board (only the backdrop moves behind it): 30 fps. */
  setDimmed(on) {
    on = !!on;
    if (on === this.dimmed) return;
    this.dimmed = on;
    const st = this.settings || {};
    this.setFpsCap(st.battery || on ? FPS_CAP.battery : FPS_CAP.normal);
  }

  /** App in the background: stop rendering completely. */
  pause() {
    this.paused = true;
    if (this.renderer && typeof this.renderer.pause === 'function') this.renderer.pause();
    else if (this.ticker) this.ticker.stop();
  }

  resume() {
    this.paused = false;
    if (this.renderer && typeof this.renderer.resume === 'function') this.renderer.resume();
    else if (this.ticker) this.ticker.start();
    this.adaptive.monitor.warmup(this.adaptive.now());
  }

  state() {
    const tk = this.ticker;
    return {
      setting: this.settings ? this.settings.quality : null,
      effective: this.effective,
      remembered: lsGet(this.storage, QUALITY_AUTO_KEY),
      adaptive: this.adaptive.enabled,
      disabledReason: this.adaptive.disabledReason,
      steps: this.adaptive.steps.slice(),
      fpsCap: this.fpsCap,
      maxFPS: tk ? tk.maxFPS : 0,
      tickerStarted: tk ? !!tk.started : false,
      thresholdMs: this.adaptive.monitor.thresholdMs,
      lastAverage: this.adaptive.monitor.lastAverage,
    };
  }
}
