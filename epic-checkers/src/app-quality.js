// Graphics quality + frame budget (performance).
//
//   autoQuality({ nav, screen, dpr }) -> 'high' | 'medium'   the 'auto' starting level for a device
//   resolveQuality(settings, { remembered, nav, screen, dpr }) -> 'high' | 'medium' | 'low'
//   lowerQuality('high') -> 'medium'                          next step down, null at 'low'
//   FPS_CAP / tickerMaxFps(cap) / thresholdForCap(cap)        frame-rate cap + slow-frame threshold
//   new FrameMonitor({ thresholdMs, windowMs, cooldownMs, warmupMs }).sample(dtMs, nowMs, active)
//       -> true when the average frame time of a whole window stayed above the threshold
//   new AdaptiveQuality({ getQuality, apply, isActive, notify, now }).frame(dtMs)
//
// Policy (src/app-perf.js wires it to the Pixi ticker): settings.quality 'auto' starts at 'high'
// on capable phones and at 'medium' on weak ones (≤ 4 cores, ≤ 3 GB RAM, or a DPR ≥ 3 phone with a
// small screen). Then, while a game screen is shown in the foreground (and no cinematic slow-mo /
// hit-stop is running), if the average frame time stays above 22 ms (< ~45 fps) for a 3 s window,
// the quality steps down one level (high → medium → low), at most once per 8 s, never back up
// automatically; one small toast is shown. Frames longer than 1 s (app switch, a stall) are
// ignored, a single frame adds at most 100 ms to the average (one GC / texture hitch cannot trip
// a step; a phone that is slow on every frame still steps down), and the first 1.5 s after the
// screen appears / after a quality change are a warm-up that is not measured. An explicit user choice (high / medium / low) is never
// changed by the app.

export const QUALITY_ORDER = ['high', 'medium', 'low'];

export function lowerQuality(q) {
  const i = QUALITY_ORDER.indexOf(q);
  return i >= 0 && i < QUALITY_ORDER.length - 1 ? QUALITY_ORDER[i + 1] : null;
}

export const QUALITY_SETTINGS = ['auto', 'high', 'medium', 'low'];
const isLevel = (q) => QUALITY_ORDER.includes(q);

/**
 * A phone that should not start at 'high': ≤ 4 CPU cores, or ≤ 3 GB of RAM, or a very dense
 * small screen (DPR ≥ 3 and a short side ≤ 430 CSS px: many pixels for a mid-range GPU). A missing
 * API never counts as weak.
 */
export function weakDevice(nav, { screen = null, dpr = 0 } = {}) {
  if (!nav) return false;
  const cores = Number(nav.hardwareConcurrency);
  const mem = Number(nav.deviceMemory);
  if (cores > 0 && cores <= 4) return true;
  if (mem > 0 && mem <= 3) return true;
  const short = screen ? Math.min(Number(screen.width) || 0, Number(screen.height) || 0) : 0;
  return Number(dpr) >= 3 && short > 0 && short <= 430;
}

/** The level settings.quality 'auto' starts at on this device. */
export function autoQuality({ nav = null, screen = null, dpr = 1 } = {}) {
  return weakDevice(nav, { screen, dpr }) ? 'medium' : 'high';
}

/**
 * Effective quality for settings.quality: an explicit level as is; 'auto' (or anything unknown)
 * → the level remembered from an earlier adaptive step down, else the device default.
 */
export function resolveQuality(settings, { remembered = null, nav = null, screen = null, dpr = 1 } = {}) {
  const q = settings && settings.quality;
  if (isLevel(q)) return q;
  if (isLevel(remembered)) return remembered;
  return autoQuality({ nav, screen, dpr });
}

/**
 * Frame-rate caps (fps): 60 normally — phones with 90/120/144 Hz displays would otherwise render
 * up to 2.4× the frames for no visible gain — and 30 with the battery saver.
 */
export const FPS_CAP = Object.freeze({ normal: 60, battery: 30 });

/**
 * Pixi's Ticker.maxFPS value for a cap. Pixi drops a frame whenever the (integer-truncated) time
 * since the last one is below 1000 / maxFPS, so maxFPS = 60 on a 60–61 Hz display drops ~3–5 % of
 * the frames (visible stutter). A slightly higher limit keeps every vsync at 60 Hz and still
 * halves 120 Hz (simulation: 60 Hz → 59.9, 61 Hz → 60.9, 90/120/144 Hz → 62 fps).
 */
export function tickerMaxFps(cap) {
  const c = Number(cap) || 0;
  if (c <= 0) return 0;
  return c >= 50 ? Math.round(c * 1.066) : c + 1; // 60 → 64, 30 → 31
}

/** Slow-frame threshold for a cap: 22 ms at 60 fps; at 30 fps the normal 33 ms frame is not "slow". */
export function thresholdForCap(cap) {
  const c = Number(cap) || 60;
  return Math.max(22, Math.round((1000 / c) * 1.32));
}

export class FrameMonitor {
  /**
   * thresholdMs: average frame time that counts as slow; windowMs: measuring window; cooldownMs:
   * minimum time between two steps; warmupMs: not measured after (re)activation / a change;
   * maxFrameMs: longer frames (app switch, a stall) are ignored; clampMs: one frame adds at most
   * this much to the average (a single GC / texture hitch cannot trip a step, while a phone that
   * is slow on every frame still does); minFrames: fewer frames in a window → no decision.
   */
  constructor({ thresholdMs = 22, windowMs = 3000, cooldownMs = 8000, warmupMs = 1500, maxFrameMs = 1000, clampMs = 100, minFrames = 8 } = {}) {
    this.thresholdMs = thresholdMs;
    this.windowMs = windowMs;
    this.cooldownMs = cooldownMs;
    this.warmupMs = warmupMs;
    this.maxFrameMs = maxFrameMs;
    this.clampMs = clampMs;
    this.minFrames = minFrames;
    this._lastStep = -Infinity;
    this._quietUntil = -Infinity;
    this._active = false;
    this.lastAverage = 0;
    this._clear();
  }

  _clear() {
    this._winStart = null;
    this._sum = 0;
    this._n = 0;
  }

  /** New slow-frame threshold (fps cap changed); restarts the current window. */
  setThreshold(ms) {
    const v = Number(ms);
    if (!(v > 0) || v === this.thresholdMs) return;
    this.thresholdMs = v;
    this._clear();
  }

  /** Start a warm-up period now (screen shown, quality changed …). */
  warmup(now) {
    this._clear();
    this._quietUntil = Math.max(this._quietUntil, now + this.warmupMs);
  }

  /**
   * Feed one frame. `active`: true = measure, false = not playing (resets the window), 'skip' =
   * playing but this frame is not representative (deliberate slow-mo / hit-stop): not counted,
   * the window keeps running. Returns true when a quality step down is due.
   */
  sample(dt, now, active) {
    if (active === 'skip') return false;
    if (!active) {
      if (this._active) this._clear();
      this._active = false;
      return false;
    }
    if (!this._active) {
      this._active = true;
      this.warmup(now);
    }
    if (now < this._quietUntil) return false;
    if (!(dt > 0) || dt > this.maxFrameMs) return false;
    if (this._winStart === null) this._winStart = now - dt;
    this._sum += Math.min(dt, this.clampMs);
    this._n++;
    if (now - this._winStart < this.windowMs) return false;
    const n = this._n;
    // a very slow phone (< ~3 fps) has too few frames for a decision: keep the window open longer
    if (n < this.minFrames && now - this._winStart < this.windowMs * 4) return false;
    const avg = n ? this._sum / n : 0;
    this._clear();
    if (n < this.minFrames) return false;
    this.lastAverage = avg;
    if (avg <= this.thresholdMs || now - this._lastStep < this.cooldownMs) return false;
    this._lastStep = now;
    this.warmup(now);
    return true;
  }
}

export class AdaptiveQuality {
  /**
   * getQuality() -> current effective quality; apply(next, prev) switches it; isActive() -> is
   * a game screen in the foreground; notify(next, prev) is called once (first step down).
   */
  constructor({ getQuality, apply, isActive, notify = null, now = () => performance.now(), monitor = null, enabled = true } = {}) {
    this.getQuality = getQuality;
    this.apply = apply;
    this.isActive = isActive;
    this.notify = notify;
    this.now = now;
    this.monitor = monitor || new FrameMonitor();
    this.enabled = !!enabled;
    this.disabledReason = enabled ? null : 'off';
    this.steps = [];
    this._notified = false;
  }

  disable(reason = 'off') {
    this.enabled = false;
    this.disabledReason = reason;
  }

  /** (Re-)enable, e.g. the user switched the quality back to 'auto'. Never past 'low'. */
  enable() {
    if (this.getQuality() === QUALITY_ORDER[QUALITY_ORDER.length - 1]) {
      this.disable('lowest');
      return;
    }
    this.enabled = true;
    this.disabledReason = null;
    this.monitor.warmup(this.now());
  }

  /** Per-frame hook (Pixi ticker: frame(ticker.elapsedMS)). Cheap: a few comparisons. */
  frame(dt) {
    if (!this.enabled) return false;
    let active = false;
    try {
      active = this.isActive();
      if (active !== 'skip') active = !!active;
    } catch (e) {
      active = false;
    }
    const t = this.now();
    if (!this.monitor.sample(dt, t, active)) return false;
    return this.stepDown(t);
  }

  stepDown(t = this.now()) {
    const prev = this.getQuality();
    const next = lowerQuality(prev);
    if (!next) {
      this.disable('lowest');
      return false;
    }
    try {
      this.apply(next, prev);
    } catch (e) {
      console.error('[quality] step down failed', e);
      this.disable('error');
      return false;
    }
    this.steps.push({ at: Math.round(t), from: prev, to: next, avgMs: +this.monitor.lastAverage.toFixed(1) });
    if (!this._notified && typeof this.notify === 'function') {
      this._notified = true;
      try {
        this.notify(next, prev);
      } catch (e) {
        /* a toast is optional */
      }
    }
    if (next === QUALITY_ORDER[QUALITY_ORDER.length - 1]) this.disable('lowest');
    return true;
  }
}
