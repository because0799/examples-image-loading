// Shared full-screen filter stack for FX.
//
// Filters are attached ONLY while an effect holds a request and are detached as soon as the last
// request is released (or on clear()). Overlapping effects share one filter instance per kind
// (the strongest request wins each frame), except shockwaves which get one instance each up to a
// per-quality cap. Foreign filters already present on a target are preserved.
//
//   const fm = new FilterManager(renderer);
//   const h = fm.request('rgb');  h.strength = 6; h.angle = 0.3;  ...  h.release();
//   const s = fm.shockwave();     s.filter.time = ...; s.x / s.y = screen px;  s.release();
//   fm.update(realDtMs)           once per frame (FX does this)
//
// Kinds / targets:
//   stage (whole frame, filterArea = screen):  shockwave ×N → zoom → rgb → bloom
//   background + world + screenFx:            'impact'  (manga B/W colour matrix, impact frames)
//   background + world:                        'grade'   (desaturate / darken, defeat mood)
//   background:                                'godray'  (light rays in the sky, pillars)
//
// Quality: high = everything; medium = cheap filters only (shockwave ≤1, rgb, impact, grade);
// low = none (FX falls back to sprite-only versions).
// Performance: soft filters (bloom, god-rays, zoom blur) render at HALF resolution (they are
// blurry by nature; a quarter of the fill cost), crisp ones (rgb split, impact frame, grade,
// shockwave) at the renderer resolution on high and 1 otherwise. Every filter is attached only
// while an effect holds it, and at most 2 shockwave distortion passes run at once.

import { ColorMatrixFilter } from 'pixi.js';
import { ShockwaveFilter } from 'pixi-filters/shockwave';
import { RGBSplitFilter } from 'pixi-filters/rgb-split';
import { ZoomBlurFilter } from 'pixi-filters/zoom-blur';
import { AdvancedBloomFilter } from 'pixi-filters/advanced-bloom';
import { GodrayFilter } from 'pixi-filters/godray';

export const FILTER_CAPS = {
  high: { shockwave: 2, rgb: true, zoom: true, bloom: true, impact: true, grade: true, godray: true },
  medium: { shockwave: 1, rgb: true, zoom: false, bloom: false, impact: true, grade: true, godray: false },
  low: { shockwave: 0, rgb: false, zoom: false, bloom: false, impact: false, grade: false, godray: false },
};

const ORDER = { shockwave: 10, zoom: 20, rgb: 30, bloom: 40, grade: 50, impact: 60, godray: 5 };
/** Resolution of the soft (blurry) filters: half the pixels in each direction. */
export const SOFT_RES = 0.5;
const SOFT = new Set(['bloom', 'zoom', 'godray']);
const SHARED = ['rgb', 'zoom', 'bloom', 'impact', 'grade'];

const LUM_R = 0.299;
const LUM_G = 0.587;
const LUM_B = 0.114;

class Handle {
  constructor(manager, kind) {
    this.manager = manager;
    this.kind = kind;
    this.alive = true;
    this.strength = 0;
    this.x = 0;
    this.y = 0;
    this.angle = 0;
    this.mode = 0; // impact: 0 off, 1 inverted B/W, 2 posterized B/W
    this.amount = 0; // grade: desaturation 0..1
    this.dark = 0; // grade: darkening 0..1
    this.tint = 0xffffff; // grade: multiply tint
    this.filter = null; // shockwave / godray instance
  }
  release() {
    if (!this.alive) return;
    this.alive = false;
    this.manager._release(this);
  }
}

/** Default filter constructors (overridable through `new FilterManager(r, { factories })` for tests). */
export const FILTER_FACTORIES = {
  rgb: () => new RGBSplitFilter({ red: { x: 0, y: 0 }, green: { x: 0, y: 0 }, blue: { x: 0, y: 0 } }),
  zoom: () => new ZoomBlurFilter({ strength: 0, center: { x: 0, y: 0 }, innerRadius: 0, radius: -1, maxKernelSize: 24 }),
  bloom: () => new AdvancedBloomFilter({ threshold: 0.42, bloomScale: 0, brightness: 1, blur: 4, quality: 2 }),
  impact: () => new ColorMatrixFilter(),
  grade: () => new ColorMatrixFilter(),
  shockwave: () =>
    new ShockwaveFilter({ center: { x: 0, y: 0 }, amplitude: 20, wavelength: 120, speed: 600, radius: -1, brightness: 1 }),
  godray: () => new GodrayFilter({ angle: 30, parallel: false, center: { x: 0, y: -100 }, gain: 0.55, lacunarity: 2.6, alpha: 1 }),
};

export class FilterManager {
  constructor(renderer, { factories } = {}) {
    this.renderer = renderer;
    this.factories = { ...FILTER_FACTORIES, ...(factories || {}) };
    this.quality = 'high';
    this.caps = FILTER_CAPS.high;
    this._owned = new Set();
    this._targets = new Map(); // container -> Set(filter)
    this._handles = { rgb: [], zoom: [], bloom: [], impact: [], grade: [], shockwave: [], godray: [] };
    this._inst = {};
    this._swPool = [];
    this._savedArea = undefined;
    this._impactM = new Array(20).fill(0);
    this._gradeM = new Array(20).fill(0);
  }

  setQuality(q) {
    this.quality = FILTER_CAPS[q] ? q : 'high';
    this.caps = FILTER_CAPS[this.quality];
    this._applyResolution();
  }

  /** Can this kind of filter run at the current quality? */
  can(kind) {
    const c = this.caps[kind];
    return typeof c === 'number' ? c > 0 : !!c;
  }

  get _res() {
    const r = this.renderer.resolution || 1;
    return this.quality === 'high' ? r : 1;
  }

  /** Resolution for a filter kind (soft filters at SOFT_RES). */
  _resFor(kind) {
    return SOFT.has(kind) ? SOFT_RES : this._res;
  }

  _applyResolution() {
    for (const f of this._owned) f.resolution = this._resFor(f._fxKind);
  }

  _make(kind) {
    let f = this._inst[kind];
    if (f) return f;
    if (!SHARED.includes(kind)) return null;
    f = this.factories[kind]();
    f.label = `fx-${kind}`;
    f._fxOrder = ORDER[kind];
    f._fxKind = kind;
    this._inst[kind] = f;
    this._owned.add(f);
    f.resolution = this._resFor(kind);
    return f;
  }

  _targetsFor(kind) {
    const L = this.renderer.layers;
    switch (kind) {
      case 'impact':
        return [L.background, L.world, L.screenFx];
      case 'grade':
        return [L.background, L.world];
      case 'godray':
        return [L.background];
      default:
        return [this.renderer.app.stage];
    }
  }

  _attach(filter, kind) {
    for (const t of this._targetsFor(kind)) {
      let set = this._targets.get(t);
      if (!set) {
        set = new Set();
        this._targets.set(t, set);
      }
      if (!set.has(filter)) {
        set.add(filter);
        this._sync(t);
      }
    }
  }

  _detach(filter, kind) {
    for (const t of this._targetsFor(kind)) {
      const set = this._targets.get(t);
      if (set && set.delete(filter)) this._sync(t);
    }
  }

  _sync(target) {
    const set = this._targets.get(target);
    const foreign = (target.filters || []).filter((f) => !this._owned.has(f));
    const ours = set ? [...set].sort((a, b) => a._fxOrder - b._fxOrder) : [];
    const list = foreign.concat(ours);
    const stage = this.renderer.app.stage;
    if (target === stage) {
      if (ours.length) {
        if (this._savedArea === undefined) this._savedArea = target.filterArea || null;
        target.filterArea = this.renderer.app.screen;
      } else if (this._savedArea !== undefined) {
        target.filterArea = this._savedArea;
        this._savedArea = undefined;
      }
    }
    target.filters = list.length ? list : null;
  }

  // ------------------------------------------------------------------ requests
  /** Shared-kind request ('rgb' | 'zoom' | 'bloom' | 'impact' | 'grade'); null when unavailable. */
  request(kind) {
    if (!this.can(kind) || !this.renderer.ready) return null;
    const f = this._make(kind);
    if (!f) return null;
    const h = new Handle(this, kind);
    h.filter = f;
    this._handles[kind].push(h);
    this._attach(f, kind);
    this._combine(kind);
    return h;
  }

  /** Dedicated shockwave instance (handle.filter); null when the cap is reached / unavailable. */
  shockwave() {
    if (!this.renderer.ready) return null;
    const list = this._handles.shockwave;
    if (list.length >= (this.caps.shockwave | 0)) return null;
    let f = this._swPool.pop();
    if (!f) {
      f = this.factories.shockwave();
      f._fxOrder = ORDER.shockwave;
      f._fxKind = 'shockwave';
      f.label = 'fx-shockwave';
      this._owned.add(f);
    }
    f.resolution = this._resFor('shockwave');
    f.time = 0;
    f.enabled = true;
    const h = new Handle(this, 'shockwave');
    h.filter = f;
    list.push(h);
    this._attach(f, 'shockwave');
    return h;
  }

  /** Godray instance on the background (high quality only). */
  godray() {
    if (!this.can('godray') || !this.renderer.ready) return null;
    if (this._handles.godray.length) return null;
    let f = this._inst.godray;
    if (!f) {
      f = this.factories.godray();
      f._fxOrder = ORDER.godray;
      f._fxKind = 'godray';
      f.label = 'fx-godray';
      this._inst.godray = f;
      this._owned.add(f);
    }
    f.resolution = this._resFor('godray');
    const h = new Handle(this, 'godray');
    h.filter = f;
    this._handles.godray.push(h);
    this._attach(f, 'godray');
    return h;
  }

  _release(h) {
    const list = this._handles[h.kind];
    const i = list.indexOf(h);
    if (i >= 0) list.splice(i, 1);
    if (h.kind === 'shockwave') {
      this._detach(h.filter, 'shockwave');
      this._swPool.push(h.filter);
      return;
    }
    if (!list.length && h.filter) this._detach(h.filter, h.kind);
    else this._combine(h.kind);
  }

  // ------------------------------------------------------------------ per frame
  update() {
    for (let i = 0; i < SHARED.length; i++) if (this._handles[SHARED[i]].length) this._combine(SHARED[i]);
  }

  _strongest(kind) {
    let best = null;
    for (const h of this._handles[kind]) if (!best || h.strength > best.strength) best = h;
    return best;
  }

  _combine(kind) {
    const f = this._inst[kind];
    if (!f) return;
    const list = this._handles[kind];
    if (!list.length) return;
    if (kind === 'rgb') {
      const h = this._strongest(kind);
      const s = h.strength;
      const cx = Math.cos(h.angle) * s;
      const cy = Math.sin(h.angle) * s;
      f.redX = cx;
      f.redY = cy;
      f.greenX = 0;
      f.greenY = 0;
      f.blueX = -cx;
      f.blueY = -cy;
      f.enabled = s > 0.05;
    } else if (kind === 'zoom') {
      const h = this._strongest(kind);
      f.strength = h.strength;
      f.centerX = h.x;
      f.centerY = h.y;
      f.innerRadius = h.amount || 0;
      f.enabled = h.strength > 0.002;
    } else if (kind === 'bloom') {
      const h = this._strongest(kind);
      f.bloomScale = h.strength;
      f.brightness = 1 + h.strength * 0.08;
      f.enabled = h.strength > 0.01;
    } else if (kind === 'impact') {
      const h = list[list.length - 1];
      if (!h.mode) {
        f.enabled = false;
        return;
      }
      f.enabled = true;
      const m = this._impactM;
      const kc = 7.5;
      const t = h.amount || 0.3; // luminance threshold
      const inv = h.mode === 1 ? -1 : 1;
      for (let r = 0; r < 3; r++) {
        const o = r * 5;
        m[o] = inv * kc * LUM_R;
        m[o + 1] = inv * kc * LUM_G;
        m[o + 2] = inv * kc * LUM_B;
        m[o + 3] = 0;
        m[o + 4] = 0.5 - inv * kc * t;
      }
      m[15] = 0;
      m[16] = 0;
      m[17] = 0;
      m[18] = 1;
      m[19] = 0;
      f.matrix = m;
    } else if (kind === 'grade') {
      // strongest desaturation; darkening and tint from the same request
      const h = this._strongest('grade') || list[0];
      let best = h;
      for (const x of list) if (x.amount > best.amount) best = x;
      const a = Math.max(0, Math.min(1, best.amount));
      const d = 1 - Math.max(0, Math.min(1, best.dark)) * 0.6;
      const tr = ((best.tint >> 16) & 255) / 255;
      const tg = ((best.tint >> 8) & 255) / 255;
      const tb = (best.tint & 255) / 255;
      const m = this._gradeM;
      const tints = [tr, tg, tb];
      for (let r = 0; r < 3; r++) {
        const o = r * 5;
        const tt = (1 - a) + a * tints[r];
        m[o] = (a * LUM_R + (r === 0 ? 1 - a : 0)) * d * tt;
        m[o + 1] = (a * LUM_G + (r === 1 ? 1 - a : 0)) * d * tt;
        m[o + 2] = (a * LUM_B + (r === 2 ? 1 - a : 0)) * d * tt;
        m[o + 3] = 0;
        m[o + 4] = 0;
      }
      m[15] = 0;
      m[16] = 0;
      m[17] = 0;
      m[18] = 1;
      m[19] = 0;
      f.matrix = m;
      f.enabled = a > 0.001 || best.dark > 0.001;
    }
  }

  /** Detach everything (handles become dead). */
  clear() {
    for (const kind of Object.keys(this._handles)) {
      for (const h of this._handles[kind].slice()) h.release();
    }
    for (const [t, set] of this._targets) {
      if (set.size) {
        set.clear();
        this._sync(t);
      }
    }
  }

  /** Debug: which FX filters are attached where. */
  describe() {
    const out = {};
    const L = this.renderer.layers;
    const names = new Map([
      [this.renderer.app.stage, 'stage'],
      [L.background, 'background'],
      [L.world, 'world'],
      [L.screenFx, 'screenFx'],
      [L.overlay, 'overlay'],
    ]);
    for (const [t, name] of names) {
      const fl = t.filters || [];
      out[name] = fl.map((f) => f.label || f.constructor.name);
    }
    out.stageFilterArea = !!this.renderer.app.stage.filterArea;
    return out;
  }

  destroy() {
    this.clear();
    for (const f of this._owned) f.destroy();
    this._owned.clear();
    this._inst = {};
    this._swPool = [];
  }
}
