// Game clock + tween engine.
//
//   const clock = new Clock();             // the Renderer drives it from the Pixi ticker
//   clock.setScale(0.25, 200);             // smooth slow-mo (transition runs in REAL time)
//   clock.slowMo(0.3, 600);                // ease in, hold, ease back (composes with hitStop)
//   clock.hitStop(90);                     // freeze game time for 90 real ms, then restore
//   await tween(sprite, { x: 100, 'scale.x': 2, tint: 0xff0000 }, { duration: 300, ease: 'outBack' });
//   await wait(500);                       // game time (slow-mo aware)
//   await wait(500, { realtime: true });   // real time (ignores slow-mo / hit-stop)
//
// Time scale model: setScale() sets the BASE scale (an explicit override: it also cancels a running
// slowMo / hitStop). slowMo() and hitStop() are layered on top of the base and compose: a hit-stop
// inside a slow-mo freezes, then returns to the slow-mo, which still eases back to the base; a
// hit-stop during the slow-mo's ease-in does not cut the transition short; a hit-stop that outlives
// the slow-mo restores the base. Clock.update() is exception-safe: a throwing task or listener is
// logged and dropped, the clock keeps running (one bad effect never freezes the game).
//
// clock.onActivity (optional fn) is called whenever a tween / wait / animate task or a per-frame
// listener is added; clock.hasTasks is true while any task is pending. The Renderer uses both to
// leave its idle frame rate the moment something starts to move.
//
// Every tween()/wait() promise has .cancel(finish = false): cancelling resolves the promise with
// `false` (never rejects, so fire-and-forget code is safe); cancel(true) jumps to the end values
// first and resolves with `true`. Note that `.then()` returns a plain promise without cancel().
//
// Props: numeric properties, dotted paths ('scale.x', 'pivot.y'), and colours — keys named `tint`
// or ending in `Color` are interpolated per RGB channel. A value may be [from, to] to force a start
// value (applied immediately, even when the tween has a delay).

// ------------------------------------------------------------------------------------- easing
const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;
const c4 = (2 * Math.PI) / 3;
const c5 = (2 * Math.PI) / 4.5;

function bounceOut(t) {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

export const Ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => t * (2 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) * (-2 * t + 2)) / 2),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - (1 - t) * (1 - t) * (1 - t),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inQuart: (t) => t * t * t * t,
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  inOutQuart: (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
  inQuint: (t) => t * t * t * t * t,
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
  inOutQuint: (t) => (t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2),
  inSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  outSine: (t) => Math.sin((t * Math.PI) / 2),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  inExpo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutExpo: (t) =>
    t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
  inCirc: (t) => 1 - Math.sqrt(1 - t * t),
  outCirc: (t) => Math.sqrt(1 - (t - 1) * (t - 1)),
  inOutCirc: (t) =>
    t < 0.5 ? (1 - Math.sqrt(1 - 4 * t * t)) / 2 : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2,
  inBack: (t) => c3 * t * t * t - c1 * t * t,
  outBack: (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2),
  inOutBack: (t) =>
    t < 0.5
      ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
      : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2,
  inElastic: (t) => (t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4)),
  outElastic: (t) => (t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1),
  inOutElastic: (t) =>
    t === 0
      ? 0
      : t === 1
        ? 1
        : t < 0.5
          ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
          : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1,
  inBounce: (t) => 1 - bounceOut(1 - t),
  outBounce: bounceOut,
  inOutBounce: (t) => (t < 0.5 ? (1 - bounceOut(1 - 2 * t)) / 2 : (1 + bounceOut(2 * t - 1)) / 2),
  smoothstep: (t) => t * t * (3 - 2 * t),
  /** Configurable overshoot: Ease.backOut(2.4) */
  backOut: (s = c1) => (t) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
  /** 0 → 1 → 0 hump, handy for flashes: ease(t) peaks at t = 0.5 */
  pulse: (t) => Math.sin(Math.PI * t),
};

/** Accepts an easing function or a name from Ease; falls back to outCubic. */
export function resolveEase(e, fallback = Ease.outCubic) {
  if (typeof e === 'function') return e;
  if (typeof e === 'string' && typeof Ease[e] === 'function' && e !== 'backOut') return Ease[e];
  return fallback;
}

// ------------------------------------------------------------------------------------- colours
export function lerpColor(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (
    (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t)
  );
}

function isColorKey(key) {
  return key === 'tint' || key.endsWith('Color') || key.endsWith('color');
}

// ------------------------------------------------------------------------------------- clock
let clockIds = 0;

/**
 * Game clock. `now` advances by real delta × `scale`; `realNow` by real delta.
 * Tasks (tweens / waits) and per-frame listeners run inside update().
 */
export class Clock {
  constructor() {
    this.id = ++clockIds;
    /** current time scale (0 = frozen, 1 = normal, 0.2 = slow-mo) */
    this.scale = 1;
    /** game time in ms */
    this.now = 0;
    /** real time in ms (since the clock started) */
    this.realNow = 0;
    /** game delta of the last frame (ms) */
    this.delta = 0;
    /** real delta of the last frame (ms) */
    this.realDelta = 0;
    this.frame = 0;
    /** largest real delta accepted per frame (protects animations after a pause / tab switch) */
    this.maxDelta = 50;

    this._scaleFrom = 1;
    this._scaleTo = 1;
    this._scaleElapsed = 0;
    this._scaleDuration = 0;
    this._scaleEase = Ease.inOutQuad;
    this._scaleToken = 0;
    /** base scale (set by setScale); slowMo / hitStop compose on top of it */
    this._base = 1;
    /** active slow-mo: { from, scale, t0, inMs, holdEnd, outMs } (real-time ms) or null */
    this._slow = null;
    /** active hit-stop: { until, scale } (real-time ms) or null */
    this._hit = null;
    /** errors swallowed by update() (debug) */
    this.errors = 0;
    this._lastErrorLog = -1e9;

    this._tasks = [];
    this._incoming = [];
    this._iterating = false;

    this._listeners = [];
    this._listenersDirty = false;

    this._autoHandle = 0;
    this._autoLast = 0;
    this._wantsAuto = false;

    /**
     * Optional activity hook: called whenever a tween / wait / animate task or a per-frame listener
     * is added (the Renderer uses it to leave its idle frame-rate mode instantly).
     */
    this.onActivity = null;
  }

  /** True while any tween / wait / animate task is pending (cheap: no iteration). */
  get hasTasks() {
    return this._tasks.length > 0 || this._incoming.length > 0;
  }

  /** Smoothly change the time scale. The transition always runs in real time. */
  setScale(v, transitionMs = 0, ease = Ease.inOutQuad) {
    v = Math.max(0, +v || 0);
    this._scaleToken++;
    // an explicit scale is an override: it ends a running slow-mo / hit-stop
    this._slow = null;
    this._hit = null;
    this._base = v;
    if (!transitionMs || transitionMs <= 0) {
      this.scale = v;
      this._scaleFrom = this._scaleTo = v;
      this._scaleDuration = 0;
      return;
    }
    this._scaleFrom = this.scale;
    this._scaleTo = v;
    this._scaleElapsed = 0;
    this._scaleDuration = transitionMs;
    this._scaleEase = resolveEase(ease, Ease.inOutQuad);
  }

  /** Target time scale (the value scale is transitioning to). */
  get targetScale() {
    if (this._hit) return this._hit.scale;
    if (this._slow) return this._slow.scale;
    return this._scaleTo;
  }

  /** True while a slowMo / hitStop owns the time scale. */
  get managed() {
    return !!(this._slow || this._hit);
  }

  /**
   * Hit-stop: freeze game time for `ms` real milliseconds, then return to whatever the scale would
   * be without it (the running slow-mo, else the base scale). Overlapping hit-stops extend the
   * freeze. An explicit setScale() meanwhile wins (the hit-stop is dropped).
   * Resolves (true) when the freeze is over.
   */
  hitStop(ms = 80, freezeScale = 0.02) {
    ms = Math.max(0, +ms || 0);
    const until = this.realNow + ms;
    const scale = Math.max(0, +freezeScale || 0);
    if (this._hit) {
      this._hit.until = Math.max(this._hit.until, until);
      this._hit.scale = Math.min(this._hit.scale, scale);
    } else {
      this._enterManaged();
      this._hit = { until, scale };
    }
    this._applyManaged(this.realNow);
    return wait(ms, { clock: this, realtime: true });
  }

  /**
   * Slow motion: ease into `scale` (inMs), hold `ms`, ease back to the base scale (outMs) — all in
   * real time. Starts from the current slow-mo value (a new slowMo replaces the previous one).
   * Composes with hitStop (see the header). Resolves when the slow-mo is over.
   */
  slowMo(scale = 0.3, ms = 600, { inMs = 120, outMs = 260 } = {}) {
    const now = this.realNow;
    this._enterManaged();
    const from = this._slow ? this._slowValue(now) : this._base;
    inMs = Math.max(0, +inMs || 0);
    outMs = Math.max(0, +outMs || 0);
    ms = Math.max(0, +ms || 0);
    this._slow = { from, scale: Math.max(0, +scale || 0), t0: now, inMs, holdEnd: now + inMs + ms, outMs };
    this._applyManaged(now);
    return wait(inMs + ms + outMs, { clock: this, realtime: true });
  }

  /** Leave plain setScale mode: finish a running transition (its target becomes the base). */
  _enterManaged() {
    if (this._slow || this._hit) return;
    if (this._scaleDuration > 0) {
      this._scaleDuration = 0;
      this._base = this._scaleTo;
    } else this._base = this.scale;
  }

  /** Slow-mo value at real time t (base scale when no slow-mo runs). */
  _slowValue(t) {
    const S = this._slow;
    if (!S) return this._base;
    if (t < S.t0 + S.inMs) return S.from + (S.scale - S.from) * Ease.inOutQuad((t - S.t0) / S.inMs);
    if (t < S.holdEnd) return S.scale;
    if (t < S.holdEnd + S.outMs) return S.scale + (this._base - S.scale) * Ease.inOutQuad((t - S.holdEnd) / S.outMs);
    return this._base;
  }

  /** Recompute the composed scale at real time t (drops expired slow-mo / hit-stop). */
  _applyManaged(t) {
    const S = this._slow;
    if (S && t >= S.holdEnd + S.outMs) this._slow = null;
    let v = this._slowValue(t);
    const H = this._hit;
    if (H) {
      if (t < H.until) v = H.scale;
      else this._hit = null;
    }
    this.scale = v;
    this._scaleFrom = this._scaleTo = this._slow || this._hit ? v : this._base;
    this._scaleDuration = 0;
  }

  /** Per-frame listener: fn(gameDeltaMs, realDeltaMs, clock). Returns an unsubscribe function. */
  add(fn, context = null) {
    this._listeners.push({ fn, context, dead: false });
    this._activity();
    return () => this.remove(fn, context);
  }

  remove(fn, context = null) {
    for (const l of this._listeners) {
      if (l.fn === fn && l.context === context && !l.dead) {
        l.dead = true;
        this._listenersDirty = true;
        break;
      }
    }
  }

  /** Advance the clock by a real delta (ms). Called once per frame by the driver. */
  update(realDeltaMs) {
    let dt = +realDeltaMs || 0;
    if (dt < 0 || dt !== dt) dt = 0;
    if (dt > this.maxDelta) dt = this.maxDelta;
    this.frame++;

    if (this._slow || this._hit) {
      // the scale of this frame is the composed value at the frame's start (a hit-stop issued
      // just now freezes this very frame)
      this._applyManaged(this.realNow);
    } else if (this._scaleDuration > 0) {
      this._scaleElapsed += dt;
      const k = Math.min(1, this._scaleElapsed / this._scaleDuration);
      this.scale = this._scaleFrom + (this._scaleTo - this._scaleFrom) * this._scaleEase(k);
      if (k >= 1) {
        this.scale = this._scaleTo;
        this._scaleDuration = 0;
      }
    }

    const gdt = dt * this.scale;
    this.realDelta = dt;
    this.delta = gdt;
    this.realNow += dt;
    this.now += gdt;

    // tasks (exception-safe: a throwing task is dropped, the others keep running)
    if (this._incoming.length) {
      for (let i = 0; i < this._incoming.length; i++) this._tasks.push(this._incoming[i]);
      this._incoming.length = 0;
    }
    const tasks = this._tasks;
    if (tasks.length) {
      this._iterating = true;
      let w = 0;
      let i = 0;
      try {
        for (; i < tasks.length; i++) {
          const t = tasks[i];
          if (!t.done) {
            try {
              t.step(t.realtime ? dt : gdt);
            } catch (e) {
              this._report('task', e);
              try {
                if (typeof t.cancel === 'function') t.cancel(false);
              } catch (e2) {
                /* ignore */
              }
              t.done = true;
            }
          }
          if (!t.done) tasks[w++] = t;
        }
      } finally {
        // (defensive) keep whatever was not visited if the loop itself was interrupted
        for (i += 1; i < tasks.length; i++) if (!tasks[i].done) tasks[w++] = tasks[i];
        tasks.length = w;
        this._iterating = false;
      }
    }

    // listeners (exception-safe)
    const ls = this._listeners;
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i];
      if (l.dead) continue;
      try {
        l.fn.call(l.context, gdt, dt, this);
      } catch (e) {
        this._report('listener', e);
      }
    }
    if (this._listenersDirty) {
      let w = 0;
      for (let i = 0; i < ls.length; i++) if (!ls[i].dead) ls[w++] = ls[i];
      ls.length = w;
      this._listenersDirty = false;
    }
  }

  /** Log a swallowed error (at most once per second, so a per-frame failure cannot flood). */
  _report(where, e) {
    this.errors++;
    if (this.realNow - this._lastErrorLog < 1000) return;
    this._lastErrorLog = this.realNow;
    if (typeof console !== 'undefined') console.error(`[clock] ${where} failed`, e);
  }

  /** @internal */
  _addTask(task) {
    if (this._iterating) this._incoming.push(task);
    else this._tasks.push(task);
    if (!this._autoHandle && this._wantsAuto) this.startAuto();
    this._activity();
  }

  /** @internal notify the activity hook (never throws). */
  _activity() {
    const fn = this.onActivity;
    if (!fn) return;
    try {
      fn();
    } catch (e) {
      this._report('activity', e);
    }
  }

  /** Number of running tweens/waits (debug). */
  get activeTasks() {
    let n = 0;
    for (const t of this._tasks) if (!t.done) n++;
    return n + this._incoming.length;
  }

  /** Cancel every task that targets `target` (all tasks when target is omitted). */
  cancelTweensOf(target, finish = false) {
    const all = this._tasks.concat(this._incoming);
    for (const t of all) {
      if (!t.done && (target === undefined || t.target === target)) t.cancel(finish);
    }
  }

  /**
   * Drive the clock by itself with requestAnimationFrame (used for the default clock when no
   * renderer exists, e.g. in tests). The Renderer drives its clock from the Pixi ticker instead.
   */
  startAuto() {
    this._wantsAuto = true;
    if (this._autoHandle) return;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f) => setTimeout(() => f(nowMs()), 16);
    const loop = (ts) => {
      const t = typeof ts === 'number' ? ts : nowMs();
      const d = this._autoLast ? t - this._autoLast : 16;
      this._autoLast = t;
      this.update(d);
      if (this._wantsAuto && (this._tasks.length || this._incoming.length || this._listeners.length)) {
        this._autoHandle = raf(loop);
      } else {
        this._autoHandle = 0;
        this._autoLast = 0;
      }
    };
    this._autoHandle = raf(loop);
  }

  stopAuto() {
    this._wantsAuto = false;
  }
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

// default clock -------------------------------------------------------------------------------
let defaultClock = null;

/** The clock used by tween()/wait() when no clock option is given. */
export function getDefaultClock() {
  if (!defaultClock) {
    defaultClock = new Clock();
    defaultClock._wantsAuto = true;
  }
  return defaultClock;
}

/** The Renderer registers its ticker-driven clock as the default. */
export function setDefaultClock(clock) {
  if (defaultClock && defaultClock !== clock && defaultClock._wantsAuto) {
    // move pending work from the auto clock to the new one so nothing is lost
    for (const t of defaultClock._tasks.concat(defaultClock._incoming)) if (!t.done) clock._addTask(t);
    defaultClock._tasks.length = 0;
    defaultClock._incoming.length = 0;
    defaultClock.stopAuto();
  }
  defaultClock = clock;
}

// ------------------------------------------------------------------------------------- tasks
class Task {
  constructor(clock, duration, delay, realtime) {
    this.clock = clock;
    this.duration = Math.max(0, +duration || 0);
    this.delay = Math.max(0, +delay || 0);
    this.realtime = !!realtime;
    this.elapsed = 0;
    this.done = false;
    this.started = false;
    this.target = null;
    this._resolve = null;
    this.promise = new Promise((r) => (this._resolve = r));
  }
  step(dt) {
    if (this.delay > 0) {
      this.delay -= dt;
      if (this.delay > 0) return;
      dt = -this.delay;
      this.delay = 0;
    }
    if (!this.started) {
      this.started = true;
      this.onStart();
    }
    this.elapsed += dt;
    const k = this.duration > 0 ? Math.min(1, this.elapsed / this.duration) : 1;
    this.apply(k);
    if (k >= 1) this.finish(true);
  }
  onStart() {}
  apply() {}
  finish(completed) {
    if (this.done) return;
    this.done = true;
    if (completed && this.onComplete) this.onComplete();
    this._resolve(completed);
  }
  cancel(jumpToEnd = false) {
    if (this.done) return;
    if (jumpToEnd) {
      if (!this.started) {
        this.started = true;
        this.onStart();
      }
      this.apply(1);
      this.finish(true);
    } else {
      this.done = true;
      this._resolve(false);
    }
  }
}

class TweenTask extends Task {
  constructor(clock, target, props, opts) {
    super(clock, opts.duration ?? 300, opts.delay, opts.realtime);
    this.target = target;
    this.ease = resolveEase(opts.ease);
    this.onUpdate = opts.onUpdate || null;
    this.onComplete = opts.onComplete || null;
    const keys = Object.keys(props);
    const n = keys.length;
    this.owners = new Array(n);
    this.names = new Array(n);
    this.from = new Float64Array(n);
    this.to = new Float64Array(n);
    this.hasFrom = new Uint8Array(n);
    this.isColor = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const key = keys[i];
      let owner = target;
      let name = key;
      if (key.indexOf('.') > 0) {
        const parts = key.split('.');
        for (let j = 0; j < parts.length - 1; j++) owner = owner[parts[j]];
        name = parts[parts.length - 1];
      }
      this.owners[i] = owner;
      this.names[i] = name;
      this.isColor[i] = isColorKey(name) ? 1 : 0;
      const v = props[key];
      if (Array.isArray(v)) {
        this.hasFrom[i] = 1;
        this.from[i] = +v[0];
        this.to[i] = +v[1];
        owner[name] = +v[0];
      } else {
        this.to[i] = +v;
      }
    }
  }
  onStart() {
    for (let i = 0; i < this.owners.length; i++) {
      if (!this.hasFrom[i]) {
        const cur = this.owners[i][this.names[i]];
        this.from[i] = typeof cur === 'number' ? cur : this.isColor[i] ? 0xffffff : 0;
      }
    }
  }
  apply(k) {
    const e = k >= 1 ? 1 : this.ease(k);
    const owners = this.owners;
    for (let i = 0; i < owners.length; i++) {
      const a = this.from[i];
      const b = this.to[i];
      owners[i][this.names[i]] = this.isColor[i] ? lerpColor(a, b, k >= 1 ? 1 : Math.max(0, Math.min(1, e))) : a + (b - a) * e;
    }
    if (this.onUpdate) this.onUpdate(e, k, this.target);
  }
}

class WaitTask extends Task {
  constructor(clock, ms, realtime) {
    super(clock, ms, 0, realtime);
  }
}

class CallbackTask extends Task {
  constructor(clock, duration, fn, opts) {
    super(clock, duration, opts.delay, opts.realtime);
    this.fn = fn;
    this.ease = resolveEase(opts.ease, Ease.linear);
    this.onComplete = opts.onComplete || null;
  }
  apply(k) {
    this.fn(k >= 1 ? 1 : this.ease(k), k);
  }
}

function wrap(task) {
  const p = task.promise;
  p.cancel = (jumpToEnd = false) => task.cancel(jumpToEnd);
  p.task = task;
  return p;
}

/**
 * Tween numeric properties of `target`.
 * @param {object} target
 * @param {object} props  { key: to | [from, to] }, dotted keys allowed, `tint`/`*Color` keys are colours
 * @param {object} [o]    { duration=300, ease='outCubic', delay=0, clock, realtime=false, onUpdate(e, k, target), onComplete }
 * @returns {Promise<boolean> & { cancel(jumpToEnd?: boolean): void }}
 */
export function tween(target, props, o = {}) {
  const clock = o.clock || getDefaultClock();
  const task = new TweenTask(clock, target, props, o);
  if (task.duration <= 0 && task.delay <= 0) {
    task.started = true;
    task.onStart();
    task.apply(1);
    task.finish(true);
    return wrap(task);
  }
  clock._addTask(task);
  return wrap(task);
}

/** Wait `ms` of game time (or real time with { realtime: true }). Cancellable. */
export function wait(ms, o = {}) {
  const clock = o.clock || getDefaultClock();
  const task = new WaitTask(clock, ms, o.realtime);
  if (task.duration <= 0) {
    task.finish(true);
    return wrap(task);
  }
  clock._addTask(task);
  return wrap(task);
}

/**
 * Run fn(easedProgress, rawProgress) every frame for `duration` ms. Cancellable like tween().
 * Handy for custom animations (paths, arcs) without a target object.
 */
export function animate(duration, fn, o = {}) {
  const clock = o.clock || getDefaultClock();
  const task = new CallbackTask(clock, duration, fn, o);
  if (task.duration <= 0 && task.delay <= 0) {
    task.started = true;
    task.apply(1);
    task.finish(true);
    return wrap(task);
  }
  clock._addTask(task);
  return wrap(task);
}

/** Cancel all tweens of `target` on a clock (default clock when omitted). */
export function killTweensOf(target, { clock, finish = false } = {}) {
  (clock || getDefaultClock()).cancelTweensOf(target, finish);
}

/** Small helpers shared by render/fx code. */
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
