// Graphics quality management (performance): adaptive step-down + weak-device default.
//
//   weakDevice(navigator) -> boolean          ≤ 4 CPU cores AND ≤ 3 GB RAM (when both APIs exist)
//   lowerQuality('high') -> 'medium'          next step down, null at 'low'
//   new FrameMonitor({ thresholdMs, windowMs, cooldownMs, warmupMs }).sample(dtMs, nowMs, active)
//       -> true when the average frame time of a whole window stayed above the threshold
//   new AdaptiveQuality({ getQuality, apply, isActive, notify, now }).frame(dtMs)
//
// Policy (main.js wires it to the Pixi ticker): while a game screen is shown and the app is in
// the foreground, if the average frame time stays above ~24 ms (< ~42 fps) for a ~4 s window,
// step the quality down one level (high → medium → low), at most once per 10 s, never back up
// automatically; a small toast is shown once. Frames longer than 250 ms (app switch, GC, a
// texture rebuild) are ignored, and the first 1.5 s after the screen appears / after a quality
// change are a warm-up that is not measured.

export const QUALITY_ORDER = ['high', 'medium', 'low'];

export function lowerQuality(q) {
  const i = QUALITY_ORDER.indexOf(q);
  return i >= 0 && i < QUALITY_ORDER.length - 1 ? QUALITY_ORDER[i + 1] : null;
}

/** ≤ 4 cores AND ≤ 3 GB of RAM. Unknown (missing API) never counts as weak. */
export function weakDevice(nav) {
  if (!nav) return false;
  const cores = Number(nav.hardwareConcurrency);
  const mem = Number(nav.deviceMemory);
  if (!(cores > 0) || !(mem > 0)) return false;
  return cores <= 4 && mem <= 3;
}

export class FrameMonitor {
  constructor({ thresholdMs = 24, windowMs = 4000, cooldownMs = 10000, warmupMs = 1500, maxFrameMs = 250, minFrames = 20 } = {}) {
    this.thresholdMs = thresholdMs;
    this.windowMs = windowMs;
    this.cooldownMs = cooldownMs;
    this.warmupMs = warmupMs;
    this.maxFrameMs = maxFrameMs;
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

  /** Start a warm-up period now (screen shown, quality changed …). */
  warmup(now) {
    this._clear();
    this._quietUntil = Math.max(this._quietUntil, now + this.warmupMs);
  }

  /** Feed one frame. Returns true when a quality step down is due. */
  sample(dt, now, active) {
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
    this._sum += dt;
    this._n++;
    if (now - this._winStart < this.windowMs) return false;
    const n = this._n;
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

  /** Per-frame hook (Pixi ticker: frame(ticker.elapsedMS)). Cheap: a few comparisons. */
  frame(dt) {
    if (!this.enabled) return false;
    let active = false;
    try {
      active = !!this.isActive();
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
