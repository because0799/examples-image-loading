// Camera: transforms renderer.layers.world around the board centre.
//
//   camera.focus(x, y, zoom, ms, ease)  bring WORLD point (x, y) to the board centre at `zoom`
//   camera.reset(ms)                    back to identity (focus = board centre, zoom 1, rotation 0)
//   camera.shake(intensity, ms, opts)   smooth noise shake with quadratic decay; shakes stack as
//                                       sqrt(sum of squares) and the total is capped
//   camera.punch(zoom, ms)              quick impact zoom pulse (multiplies the focus zoom)
//   camera.rotateTo(rad, ms, ease)      dutch angle; camera.rotation / camera.zoom are settable
//
// Shake intensity: values ≤ 1 are normalised trauma (1 = very strong, ~22 px on a phone, scaled
// with the screen); values > 1 are CSS pixels. Suggested: micro 0.12, landing 0.2, capture 0.45,
// mega 0.9. Shake and punch run in REAL time by default (they keep going during hit-stop);
// focus/reset/rotateTo run on the game clock (they slow down with slow-mo) unless { realtime: true }.

import { tween, animate, Ease, resolveEase } from './tween.js';
import { Noise2D } from './noise.js';

const noise = new Noise2D(31);

export class Camera {
  constructor(renderer) {
    this.renderer = renderer;
    /** focus offset from the board centre, world units */
    this.ox = 0;
    this.oy = 0;
    this._zoom = 1;
    this._rot = 0;
    /** impact punch multiplier (1 = none) */
    this.punchScale = 1;
    this.shakeX = 0;
    this.shakeY = 0;
    this.shakeRot = 0;
    /** global multiplier for shakes (settings / accessibility) */
    this.shakeAmount = 1;
    this._shakes = [];
    this._focusTween = null;
    this._rotTween = null;
    this._punchTask = null;
    this._seed = 0;
  }

  get anchor() {
    return this.renderer.boardCenter;
  }

  get zoom() {
    return this._zoom;
  }
  set zoom(v) {
    if (this._focusTween) this._focusTween.cancel();
    this._zoom = Math.max(0.05, +v || 1);
  }

  get rotation() {
    return this._rot;
  }
  set rotation(v) {
    if (this._rotTween) this._rotTween.cancel();
    this._rot = +v || 0;
  }

  /** Current focus point (world coords). */
  get focusX() {
    return this.anchor.x + this.ox;
  }
  get focusY() {
    return this.anchor.y + this.oy;
  }

  /** True when the camera is at rest (identity transform, no shake/punch). */
  get idle() {
    return (
      this._shakes.length === 0 &&
      Math.abs(this.punchScale - 1) < 1e-4 &&
      Math.abs(this._zoom - 1) < 1e-4 &&
      Math.abs(this.ox) < 1e-3 &&
      Math.abs(this.oy) < 1e-3 &&
      Math.abs(this._rot) < 1e-5
    );
  }

  /**
   * Move the camera so WORLD point (x, y) sits at the board centre with the given zoom.
   * @returns {Promise<boolean>} cancellable (resolves false if superseded)
   */
  focus(x, y, zoom = this._zoom, ms = 450, ease = Ease.inOutCubic, opts = {}) {
    const a = this.anchor;
    if (this._focusTween) this._focusTween.cancel();
    const props = { ox: x - a.x, oy: y - a.y, _zoom: Math.max(0.05, zoom) };
    if (opts.rotation != null) {
      if (this._rotTween) this._rotTween.cancel();
      props._rot = opts.rotation;
    }
    if (!ms || ms <= 0) {
      this.ox = props.ox;
      this.oy = props.oy;
      this._zoom = props._zoom;
      if (props._rot != null) this._rot = props._rot;
      const p = Promise.resolve(true);
      p.cancel = () => {};
      return p;
    }
    const t = tween(this, props, {
      duration: ms,
      ease: resolveEase(ease, Ease.inOutCubic),
      clock: this.renderer.clock,
      realtime: !!opts.realtime,
    });
    this._focusTween = t;
    return t;
  }

  /** Back to the neutral framing. */
  reset(ms = 450, ease = Ease.inOutCubic, opts = {}) {
    const a = this.anchor;
    return this.focus(a.x, a.y, 1, ms, ease, { rotation: 0, realtime: opts.realtime });
  }

  rotateTo(angle, ms = 400, ease = Ease.inOutCubic, opts = {}) {
    if (this._rotTween) this._rotTween.cancel();
    this._rotTween = tween(this, { _rot: angle }, {
      duration: ms,
      ease: resolveEase(ease, Ease.inOutCubic),
      clock: this.renderer.clock,
      realtime: !!opts.realtime,
    });
    return this._rotTween;
  }

  /**
   * Screen shake. opts: { frequency = 16 (Hz), rotation = 1 (rotational component multiplier),
   * angle (radians: bias the shake along a direction, e.g. the hit direction), realtime = true }.
   */
  shake(intensity = 0.3, ms = 380, opts = {}) {
    if (!(intensity > 0) || !(ms > 0) || this.shakeAmount <= 0) return;
    const amp = (intensity <= 1 ? intensity * this.unitShake : intensity) * this.shakeAmount;
    const s = {
      amp,
      dur: ms,
      t: 0,
      phase: 0,
      freq: opts.frequency || 16,
      sx: (this._seed += 17.31),
      sy: (this._seed += 23.77),
      sr: (this._seed += 11.13),
      rot: opts.rotation == null ? 1 : opts.rotation,
      realtime: opts.realtime !== false,
      dirX: 0,
      dirY: 0,
      directional: false,
    };
    if (opts.angle != null) {
      s.directional = true;
      s.dirX = Math.cos(opts.angle);
      s.dirY = Math.sin(opts.angle);
    }
    this._shakes.push(s);
    if (this._shakes.length > 12) this._shakes.shift();
  }

  stopShake() {
    this._shakes.length = 0;
    this.shakeX = this.shakeY = this.shakeRot = 0;
  }

  /** px amplitude for intensity 1 (scales with the screen's short side). */
  get unitShake() {
    const s = this.renderer.screen;
    const short = Math.min(s.width || 390, s.height || 844);
    return 22 * Math.max(0.9, Math.min(2, short / 390));
  }

  /**
   * Impact zoom pulse: quickly zooms to `zoom` (e.g. 1.06) and eases back to 1.
   * @returns {Promise<boolean>}
   */
  punch(zoom = 1.06, ms = 260, opts = {}) {
    if (this._punchTask) this._punchTask.cancel();
    const from = this.punchScale;
    const attack = Math.min(0.35, Math.max(0.12, opts.attack || 0.22));
    const task = animate(
      ms,
      (e, k) => {
        if (k < attack) {
          const u = Ease.outCubic(k / attack);
          this.punchScale = from + (zoom - from) * u;
        } else {
          const u = Ease.inOutSine((k - attack) / (1 - attack));
          this.punchScale = zoom + (1 - zoom) * u;
        }
      },
      { clock: this.renderer.clock, realtime: opts.realtime !== false }
    );
    this._punchTask = task;
    return task;
  }

  /** Cancel all camera motion and snap back to identity. */
  snap() {
    if (this._focusTween) this._focusTween.cancel();
    if (this._rotTween) this._rotTween.cancel();
    if (this._punchTask) this._punchTask.cancel();
    this.ox = this.oy = 0;
    this._zoom = 1;
    this._rot = 0;
    this.punchScale = 1;
    this.stopShake();
  }

  /** @internal per-frame update (renderer ticker). */
  update(realDt, gameDt) {
    const list = this._shakes;
    let sx = 0;
    let sy = 0;
    let sr = 0;
    let peak = 0;
    if (list.length) {
      let w = 0;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        const dt = s.realtime ? realDt : gameDt;
        s.t += dt;
        if (s.t >= s.dur) continue;
        list[w++] = s;
        const k = s.t / s.dur;
        const attack = Math.min(1, s.t / 24);
        const a = s.amp * (1 - k) * (1 - k) * attack;
        if (a > peak) peak = a;
        s.phase += (dt / 1000) * s.freq;
        const nx = noise.noise1(s.phase + s.sx);
        const ny = noise.noise1(s.phase + s.sy);
        if (s.directional) {
          // mostly along the hit direction, a little perpendicular
          sx += a * (s.dirX * nx * 1.25 - s.dirY * ny * 0.35);
          sy += a * (s.dirY * nx * 1.25 + s.dirX * ny * 0.35);
        } else {
          sx += a * nx;
          sy += a * ny;
        }
        sr += a * s.rot * noise.noise1(s.phase * 0.7 + s.sr);
      }
      list.length = w;
      // cap the stacked amplitude so many simultaneous shakes stay readable
      const cap = Math.max(peak * 1.6, 1) ;
      const hardCap = this.unitShake * 1.8;
      const m = Math.hypot(sx, sy);
      const lim = Math.min(cap, hardCap);
      if (m > lim) {
        sx *= lim / m;
        sy *= lim / m;
      }
    }
    this.shakeX = sx;
    this.shakeY = sy;
    // ~0.09° per px of shake, capped at ±2.2°
    const rot = sr * 0.0016;
    this.shakeRot = rot > 0.038 ? 0.038 : rot < -0.038 ? -0.038 : rot;
  }

  /** @internal apply to a container (layers.world). */
  apply(world) {
    const a = this.anchor;
    const z = this._zoom * this.punchScale;
    world.pivot.set(a.x + this.ox, a.y + this.oy);
    world.position.set(a.x + this.shakeX, a.y + this.shakeY);
    world.scale.set(z, z);
    world.rotation = this._rot + this.shakeRot;
  }
}
