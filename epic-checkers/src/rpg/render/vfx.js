// «Валькирии доски» — element VFX of the battle view (GDD §18.2): hits, projectiles, areas and
// trails for the 8 elements, reactions, statuses, KO shatter, awakening, wards and zones.
//
// Built from the FX library primitives (slash, lightning, burst / emit, shockwave, explosion,
// pillar, kanji, crack …) plus a small sprite-particle system for SHAPED particles the FX atlas does
// not have (feathers, maple leaves, snowflakes, droplets, ice shards, ink, amber crystals). Sizes are
// compensated for the FX library's square size (it scales with the classic board). Every effect is a
// tracked clock animation, so BattleView.skip() finishes them at once; nothing allocates per frame
// beyond the particles themselves (pooled sprites).

import { Sprite, Texture, Rectangle } from 'pixi.js';
import { Ease } from '../../render/tween.js';
import { readMs } from '../../fx/prefs.js';
import { ELEMENT_FX, REACTION_FX, STATUS_FX, GOLD, HEAL_COLOR, SHIELD_COLOR, elementFx, word, mix } from './theme.js';
import { sqDist } from './layout.js';

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ============================================================================ mini particles
class Bits {
  constructor(vx) {
    this.vx = vx;
    this.live = [];
    this.pool = [];
    this.cap = 260;
  }

  spawn(frame, layer, o) {
    if (this.live.length >= this.cap) return null;
    const s = this.pool.pop() || new Sprite(Texture.WHITE);
    s.texture = typeof frame === 'string' ? this.vx.view.icons.frame(frame) : frame;
    s.anchor.set(0.5);
    s.visible = true;
    s.blendMode = 'inherit';
    s.tint = o.tint != null ? o.tint : 0xffffff;
    s.alpha = 0;
    s.rotation = o.rot || 0;
    layer.addChild(s);
    const tw = s.texture.orig.width || 16;
    const p = {
      s,
      x: o.x,
      y: o.y,
      vx: o.vx || 0,
      vy: o.vy || 0,
      ax: o.ax || 0,
      ay: o.ay || 0,
      drag: o.drag || 0,
      life: Math.max(0.05, o.life || 0.8),
      age: 0,
      s0: (o.size0 != null ? o.size0 : o.size || 10) / tw,
      s1: (o.size1 != null ? o.size1 : o.size || 10) / tw,
      a0: o.alpha != null ? o.alpha : 1,
      vr: o.vr || 0,
      sway: o.sway || 0,
      swayF: o.swayF || 3,
      ph: Math.random() * TAU,
      fin: o.fin != null ? o.fin : 0.1,
      fout: o.fout != null ? o.fout : 0.6,
      orbit: o.orbit || null, // { cx, cy, r, vr (rad/s), grow (px/s) }
      flip: o.flip || 0,
      sy: o.sy || 1,
    };
    this.live.push(p);
    return p;
  }

  update(dt) {
    const L = this.live;
    if (!L.length) return;
    const d = dt / 1000;
    let w = 0;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      p.age += d;
      const k = p.age / p.life;
      if (k >= 1) {
        this._free(p);
        continue;
      }
      L[w++] = p;
      if (p.orbit) {
        const o = p.orbit;
        o.a = (o.a || 0) + o.vr * d;
        o.r += (o.grow || 0) * d;
        o.cy += (o.rise || 0) * d;
        p.x = o.cx + Math.cos(o.a) * o.r;
        p.y = o.cy + Math.sin(o.a) * o.r * (o.flat || 1);
      } else {
        p.vx += p.ax * d;
        p.vy += p.ay * d;
        if (p.drag) {
          const f = Math.max(0, 1 - p.drag * d);
          p.vx *= f;
          p.vy *= f;
        }
        p.x += p.vx * d;
        p.y += p.vy * d;
      }
      const sx = p.sway ? Math.sin(p.age * p.swayF + p.ph) * p.sway : 0;
      p.s.position.set(p.x + sx, p.y);
      p.s.rotation += p.vr * d;
      const sc = p.s0 + (p.s1 - p.s0) * k;
      const fl = p.flip ? Math.abs(Math.cos(p.age * p.flip + p.ph)) * 0.8 + 0.2 : 1;
      p.s.scale.set(sc * fl, sc * p.sy);
      const a = k < p.fin ? k / p.fin : k > p.fout ? 1 - (k - p.fout) / (1 - p.fout) : 1;
      p.s.alpha = p.a0 * clamp01(a);
    }
    L.length = w;
  }

  _free(p) {
    const s = p.s;
    if (p.subTex) {
      // KO portrait pieces carry their own sub-frame texture: free it with the sprite
      s.texture = Texture.WHITE;
      p.subTex.destroy(false);
      p.subTex = null;
    }
    s.removeFromParent();
    s.visible = false;
    if (this.pool.length < 300) this.pool.push(s);
    else s.destroy();
  }

  clear() {
    for (const p of this.live) this._free(p);
    this.live.length = 0;
  }

  destroy() {
    this.clear();
    for (const s of this.pool) s.destroy();
    this.pool.length = 0;
  }
}

// ============================================================================ VFX
export class VFX {
  constructor(view) {
    this.view = view;
    this.bits = new Bits(this);
    this.live = new Set();
    this.spool = [];
  }

  get fx() {
    return this.view.fx;
  }

  get sq() {
    return this.view.sqSize;
  }

  get k() {
    return this.view.k;
  }

  get L() {
    return this.view.layers;
  }

  /** Particle count multiplier (quality × settings.fx.particles). */
  get pq() {
    const fx = this.fx;
    return fx ? Math.max(0.2, fx.pq || 1) : 1;
  }

  n(count) {
    return Math.max(1, Math.round(count * this.pq));
  }

  update(gdt) {
    this.bits.update(gdt);
  }

  // ------------------------------------------------------------------ sprites & runner
  sprite(frame, layer, o = {}) {
    const s = this.spool.pop() || new Sprite(Texture.WHITE);
    s.texture = typeof frame === 'string' ? this.view.icons.frame(frame) : frame || Texture.WHITE;
    s.anchor.set(o.ax != null ? o.ax : 0.5, o.ay != null ? o.ay : 0.5);
    s.tint = o.tint != null ? o.tint : 0xffffff;
    s.alpha = o.alpha != null ? o.alpha : 1;
    s.rotation = o.rot || 0;
    s.blendMode = 'inherit';
    s.visible = true;
    s.position.set(o.x || 0, o.y || 0);
    s.scale.set(1);
    if (o.w) this.fitW(s, o.w, o.h);
    (layer || this.L.vfxOver).addChild(s);
    return s;
  }

  fitW(s, w, h) {
    const t = s.texture.orig;
    const sx = w / (t.width || 1);
    s.scale.set(sx, h != null ? h / (t.height || 1) : sx);
    s.rvSx = s.scale.x;
    s.rvSy = s.scale.y;
    return s;
  }

  free(s) {
    if (!s || s.destroyed) return;
    s.removeFromParent();
    s.visible = false;
    s.texture = Texture.WHITE;
    if (this.spool.length < 200) this.spool.push(s);
    else s.destroy();
  }

  /** Tracked animation with cleanup (skip → jumps to the end, cleanup runs). */
  run(ms, fn, { end, realtime, delay, ease } = {}) {
    const rec = { done: false };
    rec.finish = () => {
      if (rec.done) return;
      rec.done = true;
      this.live.delete(rec);
      if (end) {
        try {
          end();
        } catch (e) {
          console.error('[rpg-vfx] cleanup failed', e);
        }
      }
    };
    this.live.add(rec);
    const p = this.view.anim(Math.max(1, ms), fn, { realtime, delay, ease });
    return p.then((ok) => {
      rec.finish();
      return ok;
    });
  }

  /**
   * A sprite that scales from width w0 to w1 and fades over `ms`, then frees itself.
   * o: { x, y, tint, w0, w1, h (height at w, keeps the aspect h / w), alpha, ms, spin, rot, ease,
   *      fadeAt (share of the life at full alpha), delay, follow (a piece to track), dy }
   */
  pulse(frame, layer, o) {
    const s = this.sprite(frame, layer, o);
    const w0 = o.w0 != null ? o.w0 : o.w || this.sq;
    const w1 = o.w1 != null ? o.w1 : w0;
    const a0 = o.alpha != null ? o.alpha : 1;
    const tw = s.texture.orig.width || 1;
    const th = s.texture.orig.height || 1;
    const asp = o.h && (o.w || o.w1) ? o.h / (o.w || o.w1) : th / tw;
    const spin = o.spin || 0;
    const easeF = o.ease || Ease.outCubic;
    const fadeAt = o.fadeAt != null ? o.fadeAt : 0.35;
    s.alpha = 0;
    return this.run(o.ms || 300, (e, k) => {
      const w = w0 + (w1 - w0) * easeF(k);
      s.scale.set(w / tw, (w * asp) / th);
      s.alpha = a0 * (k < 0.08 ? k / 0.08 : k > fadeAt ? 1 - (k - fadeAt) / (1 - fadeAt) : 1);
      if (spin) s.rotation = (o.rot || 0) + spin * k;
      if (o.follow) s.position.set(o.follow.x, o.follow.y - (o.follow.lift || 0) + (o.dy || 0));
    }, { end: () => this.free(s), delay: o.delay, realtime: o.realtime });
  }

  /** FX particle burst with our square-size compensation. */
  emit(kind, x, y, o = {}) {
    const fx = this.fx;
    if (!fx || this.view.skipping) return;
    const k = this.k;
    const opts = { ...o, size: (o.size || 1) * k, speed: (o.speed || 1) * k };
    if (o.radius != null) opts.radius = o.radius;
    try {
      fx.emit(kind, x, y, opts);
    } catch (e) {
      /* FX is optional */
    }
  }

  fxCall(name, ...args) {
    const fx = this.fx;
    if (!fx || this.view.skipping || typeof fx[name] !== 'function') return Promise.resolve(false);
    try {
      return this.view.fxt(fx[name](...args));
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  slash(x, y, angle, o = {}) {
    const k = this.k;
    return this.fxCall('slash', x, y, angle, { ...o, length: (o.length || 1.6) * k, width: (o.width || 0.8) * k });
  }

  lightning(x1, y1, x2, y2, o = {}) {
    return this.fxCall('lightning', x1, y1, x2, y2, { ...o, width: (o.width || 1) * Math.min(1.6, Math.max(0.7, this.k)) });
  }

  shockwave(x, y, o = {}) {
    return this.fxCall('shockwave', x, y, { ...o, radius: (o.radius || 1.6) * this.k });
  }

  stopAll() {
    for (const rec of Array.from(this.live)) rec.finish();
    this.live.clear();
    this.bits.clear();
  }

  destroy() {
    this.stopAll();
    this.bits.destroy();
    for (const s of this.spool) s.destroy();
    this.spool.length = 0;
  }

  pos(p) {
    return { x: p.x, y: p.y - (p.lift || 0) };
  }

  // ------------------------------------------------------------------ element building blocks
  /** Wind-up at the caster: element energy converging. */
  windup(el, caster, s = 1) {
    const E = elementFx(el);
    const p = this.pos(caster);
    const sq = this.sq;
    this.pulse('glowRing', this.L.vfxOver, { x: p.x, y: p.y, tint: E.color, w0: sq * 2.2 * s, w1: sq * 0.9, ms: 280, alpha: 0.9, fadeAt: 0.6 });
    this.emit('energy', p.x, p.y, { count: 12 * s, color: E.glow, inward: true, radius: 1.2, life: 0.5 });
    if (el === 'storm') this.emit('spark', p.x, p.y, { count: 6, color: E.accent });
  }

  /** Small element particles left behind by a moving token. */
  trail(el, x, y, s = 1) {
    if (this.view.skipping) return;
    const E = elementFx(el);
    const sq = this.sq;
    switch (el) {
      case 'flame':
        this.emit('embers', x, y, { count: 2 * s, color: E.color, radius: 0.2 });
        break;
      case 'tide':
        this.bits.spawn('dot', this.L.vfxOver, { x: x + rand(-4, 4), y, vx: rand(-20, 20), vy: rand(-30, 10), ay: sq * 6, size: sq * 0.14, size1: sq * 0.06, life: 0.45, tint: E.accent });
        break;
      case 'frost':
        this.bits.spawn('spark', this.L.vfxOver, { x: x + rand(-6, 6), y: y + rand(-6, 6), size: sq * 0.22, size1: 2, life: 0.5, tint: 0xe8fdff, vr: 3 });
        break;
      case 'storm':
        this.emit('spark', x, y, { count: 2 * s, color: E.color, speed: 0.4 });
        break;
      case 'gale':
        this.bits.spawn('leaf', this.L.vfxOver, { x, y, vx: rand(-30, 30), vy: rand(-40, -10), size: sq * 0.18, life: 0.6, tint: mix(E.color, 0xffffff, 0.3), vr: rand(-6, 6), flip: 8 });
        break;
      case 'terra':
        this.emit('dust', x, y + sq * 0.25, { count: 1, color: E.color, size: 0.6 });
        break;
      case 'radiance':
        this.emit('stars', x, y, { count: 1 * s, color: E.color, radius: 0.25 });
        break;
      case 'umbra':
        this.bits.spawn('inkBlob', this.L.vfxOverN, { x: x + rand(-5, 5), y, vy: -sq * 0.6, size: sq * 0.3, size1: sq * 0.08, life: 0.5, alpha: 0.7, tint: 0x1a0420 });
        break;
      default:
        break;
    }
  }

  land(t, el, s = 1) {
    if (this.view.skipping) return;
    const E = elementFx(el);
    const sq = this.sq;
    this.pulse('groundRing', this.L.vfxUnder, { x: t.x, y: t.y + sq * 0.3, tint: E.color, w0: sq * 0.6, w1: sq * 1.6 * s, ms: 320, alpha: 0.85 });
    this.emit('dust', t.x, t.y + sq * 0.3, { count: 4 * s, color: mix(E.color, 0x888888, 0.5), size: 0.7 });
  }

  skid(t, a, b) {
    const sq = this.sq;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    this.emit('dust', b.x, b.y + sq * 0.2, { count: 6, angle: ang + Math.PI, spread: 1.2, size: 0.8 });
    this.view.shake(0.12, 160);
  }

  /** A hit flash on a token (additive white disc). */
  flashPiece(t, s = 1) {
    if (this.view.skipping) return;
    const p = this.pos(t);
    this.pulse('disc', this.L.vfxOver, { x: p.x, y: p.y, tint: 0xffffff, w0: (t.D || this.sq * 0.84) * 1.0, w1: (t.D || this.sq * 0.84) * 1.15 * s, ms: 150, alpha: 0.55, fadeAt: 0.1 });
    if (t.setScale && !t._moving) {
      this.run(160, (e, k) => t.setScale(1 + 0.1 * s * Math.sin(Math.PI * k)), { end: () => t.setScale(1) });
    }
  }

  /** Element hit at a piece. */
  hit(el, piece, { crit = false, big = false, from = null } = {}) {
    if (this.view.skipping || !piece) return;
    const E = elementFx(el);
    const p = this.pos(piece);
    const sq = this.sq;
    const s = (big ? 1.25 : 1) * (crit ? 1.2 : 1);
    const ang = from ? Math.atan2(p.y - from.y, p.x - from.x) : -0.6;
    switch (el) {
      case 'flame':
        this.slash(p.x, p.y, ang - 0.4, { color: 0xff8a2a, length: 1.5 * s, width: 0.8 * s, duration: 300 });
        this.emit('fire', p.x, p.y, { count: 12 * s, color: E.color, size: 0.75 * s });
        this.emit('embers', p.x, p.y, { count: 10 * s, color: E.accent, radius: 0.4 });
        this.pulse('dot', this.L.vfxOver, { x: p.x, y: p.y, tint: 0xff9a3a, w0: sq * 0.8, w1: sq * 2 * s, ms: 240, alpha: 0.9 });
        this.view.sfx('explosion', { intensity: 0.35 * s });
        break;
      case 'tide':
        this.pulse('ring', this.L.vfxOver, { x: p.x, y: p.y, tint: E.accent, w0: sq * 0.4, w1: sq * 1.8 * s, ms: 340, alpha: 0.95 });
        this.pulse('ring', this.L.vfxOver, { x: p.x, y: p.y, tint: E.color, w0: sq * 0.2, w1: sq * 1.2 * s, ms: 420, alpha: 0.8, delay: 60 });
        for (let i = 0; i < this.n(12 * s); i++) {
          const a = -Math.PI / 2 + rand(-1.3, 1.3);
          const v = sq * rand(2, 5);
          this.bits.spawn('dot', this.L.vfxOver, { x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ay: sq * 14, size: sq * 0.2, size1: sq * 0.08, life: rand(0.35, 0.6), tint: i % 3 ? E.accent : 0xffffff });
        }
        this.emit('spark', p.x, p.y, { count: 6, color: E.accent, speed: 0.7 });
        this.view.sfx('land', { intensity: 0.6 });
        break;
      case 'frost':
        this.emit('shards', p.x, p.y, { count: 12 * s, color: 0xcff8ff, size: 0.7 });
        this.pulse('snowflake', this.L.vfxOver, { x: p.x, y: p.y, tint: 0xe8fdff, w0: sq * 0.3, w1: sq * 1.4 * s, ms: 420, alpha: 1, spin: 1.2, fadeAt: 0.5 });
        for (let i = 0; i < this.n(5); i++) {
          const a = rand(0, TAU);
          this.bits.spawn('shard', this.L.vfxOver, { x: p.x, y: p.y, vx: Math.cos(a) * sq * 4, vy: Math.sin(a) * sq * 4, drag: 4, size: sq * 0.22, life: 0.45, tint: 0xbff6ff, rot: a + Math.PI / 2, sy: 1.8 });
        }
        this.view.sfx('shatter', { intensity: 0.5 * s });
        break;
      case 'storm':
        this.lightning(p.x + rand(-sq * 0.4, sq * 0.4), p.y - sq * 1.9, p.x, p.y, { color: E.color, duration: 260, branches: 2 });
        this.emit('spark', p.x, p.y, { count: 12 * s, color: E.accent });
        this.pulse('star4', this.L.vfxOver, { x: p.x, y: p.y, tint: E.accent, w0: sq * 0.6, w1: sq * 1.7 * s, ms: 200, alpha: 1, spin: 0.6 });
        this.view.sfx('zap', { intensity: 0.7 });
        break;
      case 'gale':
        this.slash(p.x, p.y, ang - 0.7, { color: E.color, length: 1.3 * s, width: 0.6, duration: 260 });
        this.slash(p.x, p.y, ang + 0.7, { color: mix(E.color, 0xffffff, 0.4), length: 1.2 * s, width: 0.5, duration: 280, flip: true });
        for (let i = 0; i < this.n(7 * s); i++) {
          const a0 = (i / 7) * TAU;
          this.bits.spawn('leaf', this.L.vfxOver, { x: p.x, y: p.y, orbit: { cx: p.x, cy: p.y, r: sq * 0.15, a: a0, vr: 9, grow: sq * 2.2, flat: 0.7 }, size: sq * 0.22, life: 0.55, tint: i % 2 ? E.color : E.accent, vr: 8, flip: 10 });
        }
        this.view.sfx('whoosh', { intensity: 0.6 });
        break;
      case 'terra': {
        const sp = this.sprite('rockSpike', this.L.vfxOverN, { x: p.x, y: p.y + sq * 0.42, ax: 0.5, ay: 1 });
        const w = sq * 0.62 * s;
        this.run(460, (e, k) => {
          const up = k < 0.25 ? Ease.outBack(k / 0.25) : 1 - Ease.inQuad(clamp01((k - 0.6) / 0.4));
          this.fitW(sp, w, w * 1.6 * Math.max(0.001, up));
          sp.alpha = k < 0.85 ? 1 : 1 - (k - 0.85) / 0.15;
        }, { end: () => this.free(sp) });
        this.emit('debris', p.x, p.y, { count: 10 * s, color: 0x8a6a46 });
        this.emit('dust', p.x, p.y + sq * 0.2, { count: 7 * s, color: E.color, size: 0.9 });
        this.view.shake(0.14 * s, 180);
        this.view.sfx('impact', { intensity: 0.8 });
        break;
      }
      case 'radiance':
        this.pulse('star4', this.L.vfxOver, { x: p.x, y: p.y, tint: 0xfff4c0, w0: sq * 0.8, w1: sq * 2.2 * s, ms: 300, alpha: 1, spin: 0.8 });
        this.pulse('burst', this.L.vfxOver, { x: p.x, y: p.y, tint: E.color, w0: sq * 0.5, w1: sq * 1.4 * s, ms: 260, alpha: 0.55 });
        this.emit('stars', p.x, p.y, { count: 9 * s, color: E.color, radius: 0.5 });
        for (let i = 0; i < this.n(3); i++) {
          this.bits.spawn('feather', this.L.vfxOver, { x: p.x + rand(-sq * 0.4, sq * 0.4), y: p.y - sq * 0.3, vx: rand(-15, 15), vy: rand(-30, -10), ay: sq * 0.8, size: sq * 0.24, life: rand(0.9, 1.3), tint: 0xffffff, vr: rand(-2, 2), sway: sq * 0.2 });
        }
        this.view.sfx('sparkle', { intensity: 0.7 });
        break;
      case 'umbra': {
        this.slash(p.x, p.y, ang - 0.3, { color: E.color, length: 1.6 * s, width: 0.75, duration: 320 });
        const rift = this.sprite('voidRift', this.L.vfxOverN, { x: p.x, y: p.y });
        const w = sq * 1.2 * s;
        this.run(420, (e, k) => {
          const open = k < 0.3 ? Ease.outBack(k / 0.3) : 1 - Ease.inCubic(clamp01((k - 0.55) / 0.45));
          this.fitW(rift, w * Math.max(0.01, open), w * 0.5 * Math.max(0.05, open));
          rift.rotation = ang;
          rift.alpha = 0.95;
        }, { end: () => this.free(rift) });
        for (let i = 0; i < this.n(5); i++) {
          this.bits.spawn('inkBlob', this.L.vfxOverN, { x: p.x + rand(-sq * 0.3, sq * 0.3), y: p.y, vy: -sq * rand(0.8, 1.6), size: sq * 0.35, size1: sq * 0.1, life: 0.6, alpha: 0.75, tint: 0x14001c });
        }
        this.emit('spark', p.x, p.y, { count: 8, color: E.num });
        this.view.sfx('glitch', { intensity: 0.6 });
        break;
      }
      default:
        this.emit('spark', p.x, p.y, { count: 8, color: 0xffffff });
        this.view.sfx('impact', { intensity: 0.5 });
    }
    if (crit) {
      this.pulse('burst', this.L.vfxOver, { x: p.x, y: p.y, tint: GOLD, w0: sq * 0.6, w1: sq * 2.4, ms: 260, alpha: 0.7, spin: 0.4 });
      this.view.punch(1.06, 220);
    }
  }

  /** Projectile from caster to target; resolves on arrival. */
  async bolt(el, caster, target, { arrow = false, small = false, big = false } = {}) {
    const E = elementFx(el);
    const a = this.pos(caster);
    const b = this.pos(target);
    const sq = this.sq;
    const dist = Math.hypot(b.x - a.x, b.y - a.y) / sq;
    const ms = Math.min(420, 140 + dist * 55);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const s = small ? 0.75 : big ? 1.25 : 1;
    if (el === 'storm' && !arrow) {
      this.lightning(a.x, a.y, b.x, b.y, { color: E.color, duration: 240, branches: 2 });
      this.view.sfx('zap', { intensity: 0.8 });
      return this.view.wait(90);
    }
    if (el === 'radiance' && !arrow) {
      const beam = this.sprite('beam', this.L.vfxOver, { x: a.x, y: a.y, ax: 0.5, ay: 1, tint: E.color, rot: ang + Math.PI / 2 });
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      await this.run(220, (e, k) => {
        this.fitW(beam, sq * 0.55 * s * (1 - 0.5 * k), len * Math.min(1, k * 3));
        beam.alpha = 1 - Math.max(0, (k - 0.5) / 0.5);
      }, { end: () => this.free(beam) });
      this.pulse('star4', this.L.vfxOver, { x: a.x, y: a.y, tint: 0xffffff, w0: sq * 0.6, w1: sq * 1.2, ms: 220 });
      this.view.sfx('sparkle', { intensity: 0.6 });
      return;
    }
    let frame = 'dot';
    let tint = E.color;
    let w = sq * 0.6 * s;
    let h = null;
    let spin = 0;
    let layer = this.L.vfxOver;
    let arc = 0;
    if (arrow) {
      frame = 'arrow';
      tint = mix(E.num, 0xffffff, 0.3);
      w = sq * 0.9;
      h = sq * 0.2;
    } else if (el === 'frost') {
      frame = 'arrow';
      tint = 0xcff8ff;
      w = sq * 0.95 * s;
      h = sq * 0.24 * s;
    } else if (el === 'gale') {
      frame = 'crescent';
      tint = E.color;
      spin = 22;
    } else if (el === 'terra') {
      frame = 'boulder';
      tint = 0xffffff;
      w = sq * 0.48 * s;
      spin = 9;
      layer = this.L.vfxOverN;
      arc = sq * 0.9;
    } else if (el === 'umbra') {
      frame = 'inkBlob';
      tint = 0x14001c;
      layer = this.L.vfxOverN;
      w = sq * 0.55 * s;
    } else if (el === 'tide') {
      frame = 'dot';
      tint = E.accent;
    }
    const pr = this.sprite(frame, layer, { x: a.x, y: a.y, tint });
    this.fitW(pr, w, h != null ? h : undefined);
    const core = el === 'flame' || el === 'tide' || el === 'umbra' || (!arrow && el !== 'terra' && el !== 'gale' && el !== 'frost') ? this.sprite('dot', this.L.vfxOver, { x: a.x, y: a.y, tint: el === 'umbra' ? E.num : 0xffffff }) : null;
    if (core) this.fitW(core, sq * 0.32 * s);
    let n = 0;
    this.view.sfx(arrow ? 'slash' : 'whoosh', { intensity: 0.5 });
    await this.run(ms, (e, k) => {
      const x = a.x + (b.x - a.x) * e;
      const y = a.y + (b.y - a.y) * e - Math.sin(Math.PI * e) * arc;
      pr.position.set(x, y);
      pr.rotation = spin ? k * spin : ang;
      if (core) core.position.set(x, y);
      if ((n++ & 1) === 0) this.trail(el, x, y, 1);
    }, { end: () => {
      this.free(pr);
      if (core) this.free(core);
    }, ease: Ease.inQuad });
  }

  /** A sweep along a diagonal line (Liora, Reika, Shio …) from the caster through the enemies. */
  async lineSweep(el, caster, enemies, area) {
    const E = elementFx(el);
    const a = this.pos(caster);
    let far = enemies[0];
    for (const p of enemies) if (Math.hypot(p.x - a.x, p.y - a.y) > Math.hypot(far.x - a.x, far.y - a.y)) far = p;
    let end = { x: far.x, y: far.y };
    if (area && area.length) {
      let best = null;
      for (const q of area) {
        const c = this.view.center(q, { x: 0, y: 0 });
        if (!best || Math.hypot(c.x - a.x, c.y - a.y) > Math.hypot(best.x - a.x, best.y - a.y)) best = c;
      }
      if (best) end = best;
    }
    const sq = this.sq;
    const ang = Math.atan2(end.y - a.y, end.x - a.x);
    const len = Math.hypot(end.x - a.x, end.y - a.y) + sq * 0.5;
    const beam = this.sprite(el === 'radiance' || el === 'storm' ? 'beam' : 'streak', this.L.vfxOver, { x: a.x, y: a.y, ax: el === 'radiance' || el === 'storm' ? 0.5 : 0, ay: el === 'radiance' || el === 'storm' ? 1 : 0.5, tint: E.glow });
    const vertical = beam.anchor.y === 1;
    beam.rotation = vertical ? ang + Math.PI / 2 : ang;
    this.view.sfx(el === 'storm' ? 'thunder' : 'slash', { intensity: 0.8 });
    let n = 0;
    await this.run(300, (e, k) => {
      const L = len * Ease.outCubic(Math.min(1, k * 1.6));
      if (vertical) this.fitW(beam, sq * 0.75 * (1 - 0.4 * k), L);
      else this.fitW(beam, L, sq * 0.55 * (1 - 0.3 * k));
      beam.alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      if ((n++ & 1) === 0) {
        const x = a.x + Math.cos(ang) * L;
        const y = a.y + Math.sin(ang) * L;
        this.trail(el, x, y, 2);
      }
    }, { end: () => this.free(beam) });
    if (el === 'storm') this.view.shake(0.25, 220);
  }

  /** Ground effect over the area squares; resolves when the hits should land. */
  async area(el, caster, sqs) {
    const E = elementFx(el);
    const sq = this.sq;
    const pts = sqs.map((q) => this.view.center(q, { x: 0, y: 0 }));
    if (!pts.length) return;
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const R = Math.max(sq, ...pts.map((p) => Math.hypot(p.x - cx, p.y - cy))) + sq * 0.6;
    const v = this.view;
    switch (el) {
      case 'flame':
        this.fxCall('explosion', cx, cy, { color: 0xff5b20, size: Math.min(0.85, 0.45 + pts.length * 0.08) * this.k });
        pts.forEach((p, i) => v.later(i * 40, () => {
          this.emit('fire', p.x, p.y, { count: 8, color: E.color, size: 0.8 });
          this.pulse('dot', this.L.vfxOver, { x: p.x, y: p.y, tint: 0xff8a3a, w0: sq * 0.5, w1: sq * 1.6, ms: 260 });
        }));
        v.shake(0.3, 260);
        v.sfx('explosion', { intensity: 0.8 });
        break;
      case 'tide':
        this.pulse('ring', this.L.vfxOver, { x: cx, y: cy, tint: E.accent, w0: sq * 0.5, w1: R * 2.2, ms: 480, alpha: 0.95 });
        this.pulse('wave', this.L.vfxOver, { x: cx, y: cy, tint: E.color, w0: sq * 0.6, w1: R * 1.6, h: R * 0.6, ms: 500, alpha: 0.6 });
        pts.forEach((p, i) => v.later(80 + i * 40, () => this.hitSplash(p, E)));
        v.sfx('whoosh', { intensity: 0.8 });
        break;
      case 'frost':
        this.pulse('glowRing', this.L.vfxUnder, { x: cx, y: cy, tint: E.color, w0: sq * 0.5, w1: R * 2.4, ms: 460, alpha: 0.85 });
        pts.forEach((p, i) => v.later(i * 45, () => {
          this.pulse('snowflake', this.L.vfxOver, { x: p.x, y: p.y, tint: 0xeafcff, w0: sq * 0.2, w1: sq * 1.1, ms: 460, spin: 1.5, fadeAt: 0.55 });
          this.emit('shards', p.x, p.y, { count: 6, color: 0xcff8ff, size: 0.6 });
        }));
        v.sfx('shatter', { intensity: 0.8 });
        break;
      case 'storm':
        pts.forEach((p, i) => v.later(i * 70, () => {
          this.lightning(p.x + rand(-sq * 0.3, sq * 0.3), p.y - sq * 2.4, p.x, p.y, { color: E.color, duration: 300, branches: 2 });
          this.emit('spark', p.x, p.y, { count: 8, color: E.accent });
        }));
        v.sfx('thunder', { intensity: 0.9 });
        v.shake(0.22, 300);
        break;
      case 'gale':
        for (let i = 0; i < this.n(18); i++) {
          this.bits.spawn('leaf', this.L.vfxOver, { x: cx, y: cy, orbit: { cx, cy, r: sq * 0.3, a: (i / 18) * TAU, vr: 10, grow: R * 1.6, flat: 0.75 }, size: sq * 0.24, life: 0.6, tint: i % 2 ? E.color : E.accent, vr: 9, flip: 9 });
        }
        this.emit('energy', cx, cy, { count: 14, color: E.color, radius: R / sq, flat: 0.7 });
        pts.forEach((p, i) => v.later(120 + i * 40, () => this.slash(p.x, p.y, rand(-1, 1), { color: E.color, length: 1.1, width: 0.5, duration: 240 })));
        v.sfx('whoosh', { intensity: 1 });
        break;
      case 'terra':
        this.fxCall('crack', cx, cy, { size: Math.min(2.4, 1.2 + pts.length * 0.12) * this.k, duration: 1400, color: 0x3a2410 });
        pts.forEach((p, i) => v.later(i * 50, () => this.hit('terra', { x: p.x, y: p.y, lift: 0 }, { big: false })));
        v.shake(0.3, 300);
        break;
      case 'radiance':
        pts.forEach((p, i) => v.later(i * 60, () => this.miniPillar(p.x, p.y, E.color)));
        this.pulse('glowRing', this.L.vfxUnder, { x: cx, y: cy, tint: E.color, w0: sq, w1: R * 2.2, ms: 500, alpha: 0.7 });
        v.sfx('gong', { intensity: 0.6 });
        break;
      case 'umbra':
        pts.forEach((p, i) => v.later(i * 50, () => {
          const rift = this.sprite('voidRift', this.L.vfxOverN, { x: p.x, y: p.y });
          this.run(480, (e, k) => {
            const open = k < 0.3 ? Ease.outBack(k / 0.3) : 1 - Ease.inCubic(clamp01((k - 0.55) / 0.45));
            this.fitW(rift, sq * 1.1 * Math.max(0.01, open), sq * 0.55 * Math.max(0.05, open));
          }, { end: () => this.free(rift) });
          this.emit('spark', p.x, p.y, { count: 6, color: E.num });
        }));
        this.fxCall('chromatic', 0.5, 260);
        v.sfx('menacing', { intensity: 0.7 });
        break;
      default:
        pts.forEach((p) => this.emit('spark', p.x, p.y, { count: 8 }));
    }
    await v.wait(el === 'storm' ? 220 + pts.length * 40 : 300);
  }

  hitSplash(p, E) {
    const sq = this.sq;
    this.pulse('ring', this.L.vfxOver, { x: p.x, y: p.y, tint: E.accent, w0: sq * 0.3, w1: sq * 1.4, ms: 300 });
    for (let i = 0; i < this.n(6); i++) {
      const a = -Math.PI / 2 + rand(-1.2, 1.2);
      const v = sq * rand(2, 4.5);
      this.bits.spawn('dot', this.L.vfxOver, { x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ay: sq * 14, size: sq * 0.18, size1: sq * 0.07, life: 0.45, tint: E.accent });
    }
  }

  /** A thin light pillar falling on a point (cheap: 3 sprites). */
  miniPillar(x, y, color = GOLD, s = 1) {
    const sq = this.sq;
    const top = y - sq * 4;
    const beam = this.sprite('beam', this.L.vfxOver, { x, y, ax: 0.5, ay: 1, tint: color });
    const core = this.sprite('beam', this.L.vfxOver, { x, y, ax: 0.5, ay: 1, tint: 0xffffff });
    this.pulse('star4', this.L.vfxOver, { x, y, tint: 0xffffff, w0: sq * 0.5, w1: sq * 1.5 * s, ms: 320, delay: 60 });
    this.emit('stars', x, y, { count: 5, color, radius: 0.4 });
    return this.run(520, (e, k) => {
      const grow = Ease.outCubic(Math.min(1, k * 4));
      const fade = k < 0.5 ? 1 : 1 - (k - 0.5) / 0.5;
      this.fitW(beam, sq * 0.9 * s * fade, (y - top) * grow);
      this.fitW(core, sq * 0.3 * s * fade, (y - top) * grow);
      beam.alpha = 0.8 * fade;
      core.alpha = fade;
    }, { end: () => {
      this.free(beam);
      this.free(core);
    } });
  }

  /** Melee lunge: the caster dashes 40 % of the way, strikes (onImpact), springs back. */
  async lunge(caster, target, onImpact, { big = false } = {}) {
    const v = this.view;
    const a = { x: caster.x, y: caster.y };
    const b = { x: target.x, y: target.y };
    const mx = a.x + (b.x - a.x) * 0.42;
    const my = a.y + (b.y - a.y) * 0.42;
    caster.raise();
    caster._moving = true;
    v.sfx('dash', { intensity: 0.6 });
    try {
      await v.anim(v.T(big ? 150 : 120), (e) => caster.setPos(a.x + (mx - a.x) * e, a.y + (my - a.y) * e), { ease: Ease.inQuad });
      if (v.fx && v.pref('slowmo')) v.fx.hitStop(big ? 70 : 50);
      v.punch(big ? 1.06 : 1.035, 200);
      v.shake(big ? 0.28 : 0.16, 200);
      v.buzz(big ? 22 : 12);
      if (onImpact) await onImpact();
      await v.anim(v.T(180), (e) => caster.setPos(mx + (a.x - mx) * e, my + (a.y - my) * e), { ease: Ease.outCubic });
    } finally {
      caster._moving = false;
      caster.setPos(a.x, a.y);
    }
  }

  /** Heal orb / beam from an Oracle to an ally. */
  async healBeam(caster, target) {
    const a = this.pos(caster);
    const b = this.pos(target);
    const sq = this.sq;
    const orb = this.sprite('dot', this.L.vfxOver, { x: a.x, y: a.y, tint: HEAL_COLOR });
    this.fitW(orb, sq * 0.6);
    let n = 0;
    await this.run(Math.min(380, 160 + (Math.hypot(b.x - a.x, b.y - a.y) / sq) * 50), (e) => {
      const x = a.x + (b.x - a.x) * e;
      const y = a.y + (b.y - a.y) * e - Math.sin(Math.PI * e) * sq * 0.5;
      orb.position.set(x, y);
      if ((n++ & 1) === 0) this.bits.spawn('spark', this.L.vfxOver, { x, y, size: sq * 0.2, size1: 2, life: 0.4, tint: HEAL_COLOR });
    }, { end: () => this.free(orb), ease: Ease.inOutQuad });
  }

  /** Support skill: light orbs from the caster to each ally. */
  async support(el, caster, targets) {
    const E = elementFx(el);
    const sq = this.sq;
    const a = this.pos(caster);
    this.pulse('glowRing', this.L.vfxOver, { x: a.x, y: a.y, tint: E.color, w0: sq * 0.8, w1: sq * 2.6, ms: 420, alpha: 0.8 });
    if (el === 'radiance') this.miniPillar(a.x, a.y, E.color, 0.8);
    this.view.sfx('sparkle', { intensity: 0.7 });
    const jobs = targets.filter((t) => t !== caster).map((t, i) => (async () => {
      await this.view.wait(i * 50);
      const b = this.pos(t);
      const orb = this.sprite('dot', this.L.vfxOver, { x: a.x, y: a.y, tint: mix(E.color, 0xffffff, 0.3) });
      this.fitW(orb, sq * 0.55);
      await this.run(300, (e) => orb.position.set(a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e - Math.sin(Math.PI * e) * sq * 0.6), { end: () => this.free(orb), ease: Ease.inOutQuad });
      this.pulse('glowRing', this.L.vfxOver, { x: b.x, y: b.y, tint: E.color, w0: sq * 0.6, w1: sq * 1.5, ms: 300 });
    })());
    await Promise.all(jobs);
  }

  // ------------------------------------------------------------------ hits on tokens
  healPop(t) {
    if (this.view.skipping) return;
    const sq = this.sq;
    const p = this.pos(t);
    this.pulse('glowRing', this.L.vfxOver, { x: p.x, y: p.y, tint: HEAL_COLOR, w0: sq * 0.7, w1: sq * 1.4, ms: 360, alpha: 0.8 });
    for (let i = 0; i < this.n(7); i++) {
      this.bits.spawn(i % 2 ? 'spark' : 'dot', this.L.vfxOver, { x: p.x + rand(-sq * 0.35, sq * 0.35), y: p.y + rand(-sq * 0.1, sq * 0.3), vy: -sq * rand(1, 2.2), size: sq * 0.2, size1: sq * 0.05, life: rand(0.5, 0.8), tint: HEAL_COLOR });
    }
    this.view.sfx('sparkle', { intensity: 0.4 });
  }

  shieldUp(t) {
    if (this.view.skipping) return;
    const p = this.pos(t);
    const sq = this.sq;
    this.pulse('hexBubble', this.L.vfxOver, { x: p.x, y: p.y, tint: SHIELD_COLOR, w0: sq * 1.9, w1: (t.D || sq) * 1.3, ms: 320, alpha: 0.9, fadeAt: 0.7, ease: Ease.outBack });
    this.emit('stars', p.x, p.y, { count: 5, color: SHIELD_COLOR, radius: 0.5 });
    this.view.sfx('power', { intensity: 0.4 });
  }

  shieldHit(t) {
    const p = this.pos(t);
    this.pulse('hexBubble', this.L.vfxOver, { x: p.x, y: p.y, tint: 0xffffff, w0: (t.D || this.sq) * 1.3, w1: (t.D || this.sq) * 1.45, ms: 200, alpha: 0.9, fadeAt: 0.2 });
    this.emit('spark', p.x, p.y, { count: 6, color: SHIELD_COLOR, speed: 0.6 });
  }

  statusPop(t, id) {
    if (this.view.skipping) return;
    const st = STATUS_FX[id];
    if (!st) return;
    const p = this.pos(t);
    const sq = this.sq;
    this.pulse(`st-${id}`, this.L.vfxOverN, { x: p.x, y: p.y - sq * 0.55, w0: sq * 0.8, w1: sq * 0.45, ms: 520, alpha: 1, fadeAt: 0.6, ease: Ease.outBack });
    switch (id) {
      case 'burn':
        this.emit('embers', p.x, p.y, { count: 10, color: 0xff7a3a, radius: 0.4 });
        break;
      case 'frozen':
        this.pulse('iceBlock', this.L.vfxOverN, { x: p.x, y: p.y, w0: sq * 1.6, w1: (t.D || sq) * 1.18, ms: 260, alpha: 1, fadeAt: 0.9, ease: Ease.outBack });
        this.emit('shards', p.x, p.y, { count: 8, color: 0xcff8ff, size: 0.6 });
        this.view.sfx('shatter', { intensity: 0.5 });
        break;
      case 'stun':
      case 'break':
        this.emit('stars', p.x, p.y - sq * 0.4, { count: 8, color: 0xffe14d, radius: 0.5 });
        break;
      case 'root': {
        const c = this.sprite('chain', this.L.vfxOverN, { x: p.x, y: p.y + sq * 0.1 });
        this.run(500, (e, k) => {
          this.fitW(c, sq * (1.4 - 0.4 * Ease.outCubic(k)), sq * 0.4);
          c.alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        }, { end: () => this.free(c) });
        break;
      }
      case 'mark':
        this.pulse('reticle', this.L.vfxOver, { x: p.x, y: p.y, tint: st.color, w0: sq * 1.6, w1: sq * 0.9, ms: 420, alpha: 1, fadeAt: 0.6, spin: 0.8 });
        break;
      case 'brittle':
        this.emit('shards', p.x, p.y, { count: 6, color: 0xb9c6ff, size: 0.5 });
        break;
      case 'inspire':
      case 'brace':
        for (let i = 0; i < this.n(6); i++) this.bits.spawn('spark', this.L.vfxOver, { x: p.x + rand(-sq * 0.4, sq * 0.4), y: p.y + sq * 0.3, vy: -sq * rand(1.2, 2.4), size: sq * 0.22, size1: 2, life: 0.6, tint: st.color });
        break;
      case 'regen':
        for (let i = 0; i < this.n(5); i++) this.bits.spawn('leaf', this.L.vfxOver, { x: p.x + rand(-sq * 0.4, sq * 0.4), y: p.y + sq * 0.3, vy: -sq * rand(0.8, 1.6), size: sq * 0.2, life: 0.8, tint: HEAL_COLOR, vr: 3, flip: 6 });
        break;
      case 'untargetable':
        this.pulse('glowRing', this.L.vfxOver, { x: p.x, y: p.y, tint: 0xc0b0ff, w0: sq * 0.6, w1: sq * 1.6, ms: 420 });
        break;
      case 'blight':
      case 'weaken':
      case 'silence':
        for (let i = 0; i < this.n(4); i++) this.bits.spawn('inkBlob', this.L.vfxOverN, { x: p.x + rand(-sq * 0.3, sq * 0.3), y: p.y, vy: -sq * 0.8, size: sq * 0.3, size1: sq * 0.1, life: 0.5, alpha: 0.6, tint: st.color });
        break;
      case 'taunt':
        this.pulse('glowRing', this.L.vfxOver, { x: p.x, y: p.y, tint: 0xff8a3d, w0: sq * 0.5, w1: sq * 1.8, ms: 420 });
        break;
      default:
        break;
    }
  }

  iceShatter(t) {
    const p = this.pos(t);
    this.emit('shards', p.x, p.y, { count: 16, color: 0xcff8ff, size: 0.8 });
    this.pulse('star4', this.L.vfxOver, { x: p.x, y: p.y, tint: 0xeafcff, w0: this.sq * 0.6, w1: this.sq * 1.8, ms: 220 });
    this.view.sfx('shatter', { intensity: 0.8 });
  }

  sealPop(t, el) {
    if (this.view.skipping) return;
    const E = ELEMENT_FX[el];
    if (!E) return;
    const p = this.pos(t);
    this.pulse(`seal-${el}`, this.L.vfxOverN, { x: p.x - (t.R || this.sq * 0.4) * 0.86, y: p.y - (t.R || this.sq * 0.4) * 0.62, w0: this.sq * 0.9, w1: this.sq * 0.32, ms: 420, alpha: 1, fadeAt: 0.75, ease: Ease.outCubic });
  }

  energyReady(t) {
    if (this.view.skipping) return;
    const p = this.pos(t);
    const sq = this.sq;
    this.pulse('glowRing', this.L.vfxOver, { x: p.x, y: p.y, tint: GOLD, w0: sq * 0.9, w1: sq * 2.1, ms: 460, alpha: 1 });
    this.emit('stars', p.x, p.y, { count: 10, color: GOLD, radius: 0.55 });
    this.view.sfx('power', { intensity: 0.6 });
  }

  crownBreak(t) {
    const p = this.pos(t);
    const sq = this.sq;
    this.emit('shards', p.x, p.y - sq * 0.5, { count: 10, color: GOLD, size: 0.5 });
    this.pulse('crown', this.L.vfxOverN, { x: p.x, y: p.y - sq * 0.5, w0: sq * 0.46, w1: sq * 0.8, ms: 380, alpha: 1, fadeAt: 0.2, spin: 0.6 });
    this.view.sfx('shatter', { intensity: 0.6 });
  }

  zonePulse(t, kind) {
    const p = this.pos(t);
    const sq = this.sq;
    const col = kind === 'phoenix-trail' || kind === 'lava' ? 0xff7a2a : kind === 'sand-rune' ? 0xe3a13b : kind === 'dew' ? 0x8ff3ff : kind === 'feathers' ? 0xd9fff0 : 0xb9a8ff;
    this.pulse('groundRing', this.L.vfxUnder, { x: p.x, y: p.y + sq * 0.3, tint: col, w0: sq * 0.5, w1: sq * 1.4, ms: 380 });
    if (kind === 'phoenix-trail' || kind === 'lava') this.emit('embers', p.x, p.y + sq * 0.2, { count: 8, color: col, radius: 0.4 });
  }

  zoneSpawn(q, kind) {
    const p = this.view.center(q, { x: 0, y: 0 });
    const sq = this.sq;
    if (kind === 'phoenix-trail') this.emit('fire', p.x, p.y, { count: 6, color: 0xff6a2a, size: 0.6 });
    else if (kind === 'sand-rune') this.pulse('rune', this.L.vfxUnder, { x: p.x, y: p.y, tint: 0xe3a13b, w0: sq * 1.4, w1: sq * 0.86, ms: 420, alpha: 1, fadeAt: 0.6, spin: -1 });
    else this.pulse('groundRing', this.L.vfxUnder, { x: p.x, y: p.y, tint: 0xb9a8ff, w0: sq * 0.4, w1: sq * 1.2, ms: 360 });
  }

  survive(t) {
    const p = this.pos(t);
    this.pulse('glowRing', this.L.vfxOver, { x: p.x, y: p.y, tint: GOLD, w0: this.sq * 0.6, w1: this.sq * 1.8, ms: 420 });
    this.pulse('star4', this.L.vfxOver, { x: p.x, y: p.y, tint: 0xffffff, w0: this.sq * 0.5, w1: this.sq * 1.4, ms: 260 });
  }

  redirectLink(a, b) {
    const pa = this.pos(a);
    const pb = this.pos(b);
    const sq = this.sq;
    const beam = this.sprite('streak', this.L.vfxOver, { x: pb.x, y: pb.y, ax: 0, ay: 0.5, tint: GOLD, rot: Math.atan2(pa.y - pb.y, pa.x - pb.x) });
    const len = Math.hypot(pa.x - pb.x, pa.y - pb.y);
    this.run(320, (e, k) => {
      this.fitW(beam, len * Math.min(1, k * 3), sq * 0.3);
      beam.alpha = 1 - k;
    }, { end: () => this.free(beam) });
  }

  async execute(t) {
    const p = this.pos(t);
    this.slash(p.x, p.y, -0.8, { color: 0xff2e4d, length: 2, width: 1, duration: 300 });
    this.slash(p.x, p.y, 0.8, { color: 0xff2e4d, length: 2, width: 1, duration: 320, flip: true });
    this.view.shake(0.3, 240);
    this.view.sfx('slash', { intensity: 1 });
    await this.view.wait(200);
  }

  extraTurn(t) {
    const p = this.pos(t);
    const sq = this.sq;
    for (let i = 0; i < this.n(10); i++) {
      this.bits.spawn('leaf', this.L.vfxOver, { x: p.x, y: p.y, orbit: { cx: p.x, cy: p.y, r: sq * 0.5, a: (i / 10) * TAU, vr: 8, grow: sq * 0.4, rise: -sq * 0.8, flat: 0.5 }, size: sq * 0.2, life: 0.8, tint: 0x5cf0b4, vr: 6, flip: 8 });
    }
  }

  tick(t, kind, el) {
    const p = this.pos(t);
    if (kind === 'burn') this.emit('embers', p.x, p.y, { count: 10, color: 0xff6a2a, radius: 0.4 });
    else if (kind === 'lava' || kind === 'eruption') this.emit('fire', p.x, p.y + this.sq * 0.2, { count: 8, color: 0xff6a20, size: 0.7 });
    else if (kind === 'collapse') this.emit('debris', p.x, p.y, { count: 8 });
    else this.hit(el || 'none', t, {});
  }

  async wardStrike(src, t, el) {
    const a = this.pos(src);
    const b = this.pos(t);
    if (src.kind === 'ball-lightning' || el === 'storm') {
      this.lightning(a.x, a.y, b.x, b.y, { color: 0xc49bff, duration: 240, branches: 2 });
      this.view.sfx('zap', { intensity: 0.7 });
      await this.view.wait(120);
    } else {
      await this.bolt(el || 'none', src, t, { small: true });
    }
  }

  arcBolt(a, b, color) {
    this.lightning(a.x, a.y, b.x, b.y, { color: color || 0xc49bff, duration: 220, branches: 1 });
    this.emit('spark', b.x, b.y, { count: 6, color: color || 0xc49bff });
    this.view.sfx('zap', { intensity: 0.5 });
    return this.view.wait(110);
  }

  // ------------------------------------------------------------------ reactions
  /** Reaction VFX at a piece (the label is shown with the damage number). */
  async reaction(id, t, e) {
    const R = REACTION_FX[id];
    if (!R || this.view.skipping) return;
    const p = this.pos(t);
    const sq = this.sq;
    const [c0, c1] = R.colors;
    const v = this.view;
    switch (id) {
      case 'steam':
        this.emit('smoke', p.x, p.y, { count: 10, color: 0xe8f6ff, size: 1.1, life: 0.9 });
        for (let i = 0; i < this.n(8); i++) this.bits.spawn('dot', this.L.vfxOver, { x: p.x + rand(-sq * 0.4, sq * 0.4), y: p.y, vy: -sq * rand(1.5, 3), drag: 1, size: sq * 0.5, size1: sq * 1.1, life: 0.7, alpha: 0.5, tint: 0xf4fbff });
        this.pulse('glowRing', this.L.vfxOver, { x: p.x, y: p.y, tint: mix(c0, c1, 0.5), w0: sq * 0.6, w1: sq * 2, ms: 380 });
        v.sfx('whoosh', { intensity: 0.8 });
        break;
      case 'detonation':
        this.fxCall('explosion', p.x, p.y, { color: 0xff6a3a, size: 0.6 * this.k });
        this.emit('spark', p.x, p.y, { count: 14, color: c1 });
        this.pulse('glowRing', this.L.vfxOver, { x: p.x, y: p.y, tint: c1, w0: sq * 0.6, w1: sq * 2.6, ms: 380 });
        v.shake(0.38, 300);
        v.sfx('explosion', { intensity: 1 });
        break;
      case 'shackles': {
        for (const rot of [0.6, -0.6]) {
          const c = this.sprite('chain', this.L.vfxOverN, { x: p.x, y: p.y, rot });
          this.run(520, (e2, k) => {
            this.fitW(c, sq * (1.8 - 0.6 * Ease.outBack(Math.min(1, k * 2))), sq * 0.42);
            c.alpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
          }, { end: () => this.free(c) });
        }
        this.emit('shards', p.x, p.y, { count: 10, color: c1, size: 0.6 });
        v.sfx('shatter', { intensity: 0.7 });
        break;
      }
      case 'arc':
        this.pulse('glowRing', this.L.vfxOver, { x: p.x, y: p.y, tint: c1, w0: sq * 0.6, w1: sq * 1.9, ms: 320 });
        this.emit('spark', p.x, p.y, { count: 14, color: 0xf4e9ff });
        v.sfx('zap', { intensity: 1 });
        break;
      case 'brittle':
        this.fxCall('crack', p.x, p.y, { size: 0.9 * this.k, duration: 1200, color: 0x24506b });
        this.emit('shards', p.x, p.y, { count: 10, color: 0xb9c6ff, size: 0.6 });
        this.pulse('star4', this.L.vfxOver, { x: p.x, y: p.y, tint: c1, w0: sq * 0.5, w1: sq * 1.6, ms: 260 });
        v.sfx('shatter', { intensity: 0.8 });
        break;
      case 'vortex': {
        const col = e && e.elements ? (ELEMENT_FX[e.elements[1]] || ELEMENT_FX.gale).color : c0;
        for (let i = 0; i < this.n(16); i++) {
          this.bits.spawn(i % 2 ? 'leaf' : 'dot', this.L.vfxOver, { x: p.x, y: p.y, orbit: { cx: p.x, cy: p.y, r: sq * 0.2, a: (i / 16) * TAU, vr: 12, grow: sq * 2.4, flat: 0.65 }, size: sq * 0.22, life: 0.6, tint: i % 2 ? c0 : col, vr: 8 });
        }
        this.pulse('glowRing', this.L.vfxOver, { x: p.x, y: p.y, tint: col, w0: sq * 0.4, w1: sq * 2.6, ms: 520, spin: 3 });
        v.sfx('whoosh', { intensity: 1 });
        break;
      }
      case 'facet':
        for (let i = 0; i < this.n(6); i++) {
          const a = (i / 6) * TAU;
          const cr = this.sprite('crystal', this.L.vfxOver, { x: p.x + Math.cos(a) * sq * 0.45, y: p.y + Math.sin(a) * sq * 0.35, ax: 0.5, ay: 1, tint: 0xe3a13b, rot: a + Math.PI / 2 });
          this.run(560, (e2, k) => {
            const g = k < 0.3 ? Ease.outBack(k / 0.3) : 1;
            this.fitW(cr, sq * 0.26, sq * 0.55 * Math.max(0.01, g));
            cr.alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
          }, { end: () => this.free(cr) });
        }
        v.sfx('power', { intensity: 0.6 });
        break;
      case 'eclipse':
        this.pulse('blackSun', this.L.vfxOverN, { x: p.x, y: p.y, w0: sq * 0.4, w1: sq * 1.9, ms: 520, alpha: 1, fadeAt: 0.55, ease: Ease.outBack });
        this.pulse('glowRing', this.L.vfxOver, { x: p.x, y: p.y, tint: c0, w0: sq * 1.2, w1: sq * 2.6, ms: 500 });
        this.fxCall('chromatic', 0.8, 300);
        v.shake(0.3, 280);
        v.sfx('gong', { intensity: 0.9 });
        break;
      default:
        break;
    }
    await v.wait(160);
  }

  // ------------------------------------------------------------------ jump strike, KO, awaken
  jumpStrike(t, victim, el, hopN) {
    const E = elementFx(el);
    const p = this.pos(victim);
    const ang = Math.atan2(victim.y - t.y, victim.x - t.x);
    this.hit(el, victim, { big: hopN >= 2, from: t });
    this.slash(p.x, p.y, ang + Math.PI / 2, { color: E.glow, length: 1.4 + hopN * 0.15, width: 0.7, duration: 280, flip: hopN % 2 === 0 });
    if (hopN >= 3) this.fxCall('impactFrame', { duration: 70, focus: { x: p.x, y: p.y } });
  }

  /** The token breaks into pieces of its portrait + element shards. Resolves when gone. */
  async ko(t) {
    const p = this.pos(t);
    const sq = this.sq;
    const E = elementFx(t.element);
    const tex = t.portrait ? t.portrait.texture : null;
    t.setVisible(false);
    this.emit('shards', p.x, p.y, { count: 22, color: E.color, size: 0.9 });
    this.emit('spark', p.x, p.y, { count: 16, color: E.glow });
    this.shockwave(p.x, p.y, { radius: 1.6, strength: 0.8, color: E.glow });
    this.pulse('dot', this.L.vfxOver, { x: p.x, y: p.y, tint: E.glow, w0: sq * 0.8, w1: sq * 2.6, ms: 300 });
    this.view.shake(0.32, 300);
    if (tex && tex.source && tex.frame && tex !== Texture.WHITE) {
      const f = tex.frame;
      const D = t.D || sq * 0.84;
      const n = 3;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const sub = new Texture({ source: tex.source, frame: new Rectangle(f.x + (f.width / n) * j, f.y + (f.height / n) * i, f.width / n, f.height / n) });
          const ox = (j - 1) * (D / n);
          const oy = (i - 1) * (D / n);
          const a = Math.atan2(oy, ox || 0.001) + rand(-0.4, 0.4);
          const sp = rand(2.5, 5.5) * sq;
          const bit = this.bits.spawn(sub, this.L.vfxOverN, { x: p.x + ox, y: p.y + oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - sq * 2.5, ay: sq * 16, drag: 1.5, size: D / n, life: rand(0.55, 0.8), vr: rand(-10, 10), fin: 0.01, fout: 0.55 });
          if (bit) bit.subTex = sub;
          else sub.destroy(false);
        }
      }
    }
    await this.view.wait(260);
  }

  async awaken(t) {
    const v = this.view;
    const p = this.pos(t);
    const sq = this.sq;
    const fx = this.fx;
    v.camFocus(p.x, p.y, 1.15, 380);
    if (fx) this.fxCall('pillar', p.x, p.y, { color: GOLD, width: 1.1 * this.k, duration: 1300, godrays: fx.quality === 'high' });
    this.fxCall('rays', p.x, p.y, { color: GOLD, duration: 1300, size: sq * 4.5 });
    this.emit('stars', p.x, p.y, { count: 16, color: GOLD, radius: 0.8 });
    if (v.pref('kanji') && fx) this.fxCall('kanji', '覚醒', p.x, p.y - sq * 0.6, { size: Math.round(sq * 1.3), color: GOLD, hold: readMs('覚醒', 'kanji', v.settings) * 0.6 });
    v.floatLabel(word('awaken', v.lang), p.x, p.y + sq * 0.65, { colors: [0xfff6c8, GOLD], size: sq * 0.34, rise: 0.1 });
    await v.wait(560);
    this.pulse('halo', this.L.vfxOver, { x: p.x, y: p.y - sq * 0.6, tint: GOLD, w0: sq * 2.2, w1: sq * 0.8, ms: 420, alpha: 1, fadeAt: 0.7 });
    await v.wait(480);
    v.camReset(360);
  }

  async revive(t) {
    const p = this.pos(t);
    const sq = this.sq;
    this.miniPillar(p.x, p.y, GOLD, 1.3);
    for (let i = 0; i < this.n(6); i++) this.bits.spawn('feather', this.L.vfxOver, { x: p.x + rand(-sq * 0.6, sq * 0.6), y: p.y - sq * 1.2, vx: rand(-10, 10), vy: rand(10, 30), size: sq * 0.26, life: 1.1, tint: 0xffffff, vr: rand(-2, 2), sway: sq * 0.2 });
    await this.run(520, (e, k) => {
      t.setAlpha(k);
      t.setScale(0.6 + 0.4 * Ease.outBack(k));
    }, { end: () => {
      t.setAlpha(1);
      t.setScale(1);
    } });
  }

  async blink(t, from, to, color) {
    const E = elementFx(t.element);
    const col = color || E.color;
    const a = this.view.center(from, { x: 0, y: 0 });
    const b = this.view.center(to, { x: 0, y: 0 });
    this.emit('energy', a.x, a.y, { count: 12, color: col, radius: 0.9, life: 0.5 });
    this.view.sfx('glitch', { intensity: 0.5 });
    await this.run(170, (e) => {
      t.setScale(1 - 0.85 * e);
      t.setAlpha(1 - e);
    });
    t.setPos(b.x, b.y);
    this.pulse('glowRing', this.L.vfxOver, { x: b.x, y: b.y, tint: col, w0: this.sq * 1.8, w1: this.sq * 0.6, ms: 220 });
    this.emit('energy', b.x, b.y, { count: 12, color: col, inward: true, radius: 1, life: 0.4 });
    await this.run(190, (e) => {
      t.setScale(0.15 + 0.85 * Ease.outBack(e));
      t.setAlpha(e);
    }, { end: () => {
      t.setScale(1);
      t.setAlpha(1);
    } });
  }

  // ------------------------------------------------------------------ wards / stage events
  async wardSpawn(w) {
    const sq = this.sq;
    const p = { x: w.x, y: w.y };
    w.setAlpha(0);
    switch (w.kind) {
      case 'ice-wall':
        this.emit('shards', p.x, p.y, { count: 10, color: 0xcff8ff, size: 0.6 });
        this.pulse('snowflake', this.L.vfxOver, { x: p.x, y: p.y, tint: 0xeafcff, w0: sq * 0.4, w1: sq * 1.3, ms: 420, spin: 1 });
        break;
      case 'ball-lightning':
        this.lightning(p.x, p.y - sq * 2.2, p.x, p.y, { color: 0xc49bff, duration: 260 });
        break;
      case 'stone-pillar':
        this.emit('debris', p.x, p.y, { count: 10 });
        this.emit('dust', p.x, p.y + sq * 0.2, { count: 8, color: 0xe3a13b });
        this.view.shake(0.14, 180);
        break;
      case 'phoenix-egg':
        this.emit('fire', p.x, p.y, { count: 14, color: 0xff6a20 });
        break;
      case 'candle':
        this.miniPillar(p.x, p.y, 0xffd27a, 0.7);
        break;
      default:
        this.emit('smoke', p.x, p.y, { count: 6, color: 0x6a5a8a, size: 0.8 });
    }
    await this.run(280, (e) => {
      w.setAlpha(e);
      for (const c of w.containers) if (c !== w.cShadow) c.scale.set(0.5 + 0.5 * Ease.outBack(e));
    }, { end: () => {
      w.setAlpha(1);
      for (const c of w.containers) c.scale.set(1);
    } });
  }

  async wardBreak(w) {
    const p = { x: w.x, y: w.y };
    const col = w.art && w.art.glow ? w.art.glow : 0xcccccc;
    this.emit('shards', p.x, p.y, { count: 14, color: col, size: 0.7 });
    this.emit('dust', p.x, p.y, { count: 6 });
    this.view.sfx('shatter', { intensity: 0.6 });
    await this.run(220, (e) => {
      w.setAlpha(1 - e);
      for (const c of w.containers) c.scale.set(1 + 0.25 * e);
    });
  }

  async eruption(sqs) {
    const sq = this.sq;
    sqs.forEach((q, i) => this.view.later(i * 40, () => {
      const p = this.view.center(q, { x: 0, y: 0 });
      this.miniPillar(p.x, p.y, 0xff6a20, 1);
      this.emit('fire', p.x, p.y, { count: 10, color: 0xff6a20, size: 0.9 });
    }));
    this.view.shake(0.35, 420);
    this.view.sfx('explosion', { intensity: 1 });
    await this.view.wait(380 + sqs.length * 20);
    void sq;
  }

  async fireRain(centers, sqs) {
    const sq = this.sq;
    const jobs = centers.map((q, i) => (async () => {
      await this.view.wait(i * 120);
      const p = this.view.center(q, { x: 0, y: 0 });
      const m = this.sprite('sun', this.L.vfxOver, { x: p.x + sq * 1.5, y: p.y - sq * 5, tint: 0xff8a3a });
      this.fitW(m, sq * 0.9);
      await this.run(300, (e) => m.position.set(p.x + sq * 1.5 * (1 - e), p.y - sq * 5 * (1 - e)), { end: () => this.free(m), ease: Ease.inQuad });
      this.fxCall('explosion', p.x, p.y, { color: 0xff6a20, size: 1.1 * this.k });
      this.view.shake(0.3, 260);
    })());
    await Promise.all(jobs);
    void sqs;
  }

  async collapse(sqs) {
    sqs.forEach((q, i) => this.view.later(i * 25, () => {
      const p = this.view.center(q, { x: 0, y: 0 });
      this.emit('debris', p.x, p.y, { count: 6 });
      this.emit('dust', p.x, p.y, { count: 4 });
    }));
    this.view.shake(0.4, 500);
    this.view.sfx('bigImpact', { intensity: 1 });
    await this.view.wait(420);
  }

  async bossPhase(t, phase) {
    const p = this.pos(t);
    const sq = this.sq;
    this.pulse('glowRing', this.L.vfxOver, { x: p.x, y: p.y, tint: 0xff2e63, w0: sq, w1: sq * 4, ms: 600 });
    this.fxCall('shockwave', p.x, p.y, { radius: 3 * this.k, strength: 1.2, color: 0xff2e63 });
    if (this.view.pref('kanji')) this.fxCall('kanji', '変', p.x, p.y - sq * 0.4, { size: Math.round(sq * 1.4), color: 0xff2e63 });
    this.view.shake(0.45, 420);
    this.view.sfx('menacing', { intensity: 1 });
    await this.view.wait(520);
    void phase;
  }

  async victory(winners, side) {
    const sq = this.sq;
    for (const t of winners) {
      const p = this.pos(t);
      this.emit('stars', p.x, p.y, { count: 10, color: GOLD, radius: 0.6 });
      this.run(700, (e, k) => t.setLift(Math.abs(Math.sin(k * Math.PI * 2)) * sq * 0.25 * (1 - k)), { end: () => t.setLift(0) });
    }
    if (side === 1) this.fxCall('burst', this.view.layout.cx, this.view.layout.cy, { kind: 'confetti', count: 50 });
    this.view.sfx(side === 1 ? 'win' : 'lose', { intensity: 1 });
    await this.view.wait(800);
  }
}

export { sqDist };
