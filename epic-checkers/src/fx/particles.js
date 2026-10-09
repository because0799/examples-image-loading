// Pooled particle system on Pixi v8 ParticleContainers.
//
//   const ps = new ParticleSystem({ textures, cap: 1500 });
//   const L = ps.layers(parent);           // { add, normal } ParticleContainers inside `parent`
//   const p = ps.spawn(L.add, textures.frame('spark'));   // null when the cap is reached
//   p.vx = ...; p.life = 0.5; ...          // see FxParticle fields below
//   ps.update(gameDtMs, realDtMs)          // called once per frame by FX
//   emitBurst(ps, L, kind, x, y, opts, env)  // preset bursts: spark dust shards embers energy
//                                            // petals confetti smoke + stars fire debris rain
//
// Every particle shares the FX atlas source, so each layer draws in ONE call. Particles are pooled
// (no allocation once warm); colour/alpha are written straight to the packed `color` field.
// Motion: velocity + acceleration (gravity) + drag, optional wobble (turbulence), flutter (3D flip
// for petals / confetti), orbit (spirals around a moving centre), velocity alignment + stretch.

import { ParticleContainer, Particle } from 'pixi.js';
import { mixHex, shadeHex } from '../render/canvas.js';

const TAU = Math.PI * 2;

function toBgr(rgb) {
  return ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff);
}

export class FxParticle extends Particle {
  constructor(texture) {
    super(texture);
    this.anchorX = 0.5;
    this.anchorY = 0.5;
    this.reset();
  }

  reset() {
    this.vx = 0; // px / s
    this.vy = 0;
    this.ax = 0; // px / s²
    this.ay = 0;
    this.drag = 0; // 1 / s
    this.life = 1; // s
    this.age = 0;
    this.vr = 0; // rad / s
    this.s0 = 1; // scale over life
    this.s1 = 1;
    this.sEase = 0; // 0 linear, 1 outQuad, 2 swell (0 → s1 → 0), 3 inQuad
    this.sy = 1; // y / x aspect
    this.stretch = 0; // extra x scale per px/s of speed
    this.maxStretch = 6;
    this.align = false; // rotation follows velocity
    this.a0 = 1;
    this.fin = 0; // fade-in fraction of life
    this.fout = 0.6; // fade-out starts at this fraction
    this.flick = 0; // random alpha flicker 0..1
    this.c0 = 0xffffff; // BGR colour stops
    this.c1 = 0xffffff;
    this.c2 = 0xffffff;
    this.cmid = 0.4;
    this.flut = 0; // flutter angular freq (rad/s)
    this.flutPh = 0;
    this.sway = 0; // px / s lateral sway amplitude
    this.swayF = 2;
    this.wob = 0; // px / s² turbulence
    this.wobF = 5;
    this.wobPh = 0;
    this.orb = false;
    this.ox = 0;
    this.oy = 0;
    this.oa = 0;
    this.or = 0;
    this.ova = 0;
    this.ovr = 0;
    this.ovx = 0;
    this.ovy = 0;
    this.oys = 1;
    this.depth = 0;
    this.px = 0;
    this.py = 0;
    this.rt = false;
    this.rotation = 0;
    this.x = 0;
    this.y = 0;
    this.scaleX = 1;
    this.scaleY = 1;
    this.color = 0;
  }

  /** Colour ramp (RGB hex): start → mid (at cmid) → end. */
  colors(c0, c1 = c0, c2 = c1, cmid = 0.4) {
    this.c0 = toBgr(c0);
    this.c1 = toBgr(c1);
    this.c2 = toBgr(c2);
    this.cmid = cmid;
    return this;
  }
}

function lerpBgr(a, b, t) {
  const ar = a & 0xff, ag = (a >> 8) & 0xff, ab = (a >> 16) & 0xff;
  const r = ar + ((b & 0xff) - ar) * t;
  const g = ag + (((b >> 8) & 0xff) - ag) * t;
  const bl = ab + (((b >> 16) & 0xff) - ab) * t;
  return (r | 0) | ((g | 0) << 8) | ((bl | 0) << 16);
}

class Layer {
  constructor(system, parent, blend) {
    this.system = system;
    this.pc = new ParticleContainer({
      texture: system.textures.atlas,
      dynamicProperties: { vertex: true, position: true, rotation: true, uvs: true, color: true },
    });
    this.pc.label = `fx-particles-${blend}`;
    this.pc.blendMode = blend;
    this.list = this.pc.particleChildren;
    this.parent = parent;
    parent.addChild(this.pc);
  }
}

export class ParticleSystem {
  constructor({ textures, cap = 1500 }) {
    this.textures = textures;
    this.cap = cap;
    this._pool = [];
    this._layers = [];
    this._byParent = new Map();
    this.count = 0;
    this.spawned = 0; // stats
  }

  setCap(cap) {
    this.cap = Math.max(0, cap | 0);
    // trim the oldest particles if we are over the new cap
    while (this.count > this.cap) {
      let trimmed = false;
      for (const L of this._layers) {
        if (L.list.length && this.count > this.cap) {
          this._kill(L, 0);
          trimmed = true;
        }
      }
      if (!trimmed) break;
    }
  }

  /** { add, normal } layer pair living inside `parent` (normal under add). */
  layers(parent) {
    let pair = this._byParent.get(parent);
    if (!pair) {
      const normal = new Layer(this, parent, 'normal');
      const add = new Layer(this, parent, 'add');
      this._layers.push(normal, add);
      pair = { normal, add };
      this._byParent.set(parent, pair);
    }
    return pair;
  }

  /** Free capacity. */
  get room() {
    return this.cap - this.count;
  }

  spawn(layer, texture) {
    if (this.count >= this.cap) return null;
    let p = this._pool.pop();
    if (p) p.reset();
    else p = new FxParticle(texture);
    p.texture = texture;
    layer.list.push(p);
    layer.pc._childrenDirty = true;
    this.count++;
    this.spawned++;
    return p;
  }

  _kill(L, i) {
    const list = L.list;
    const last = list.length - 1;
    const p = list[i];
    list[i] = list[last];
    list.length = last;
    L.pc._childrenDirty = true;
    this._pool.push(p);
    this.count--;
  }

  update(gdtMs, rdtMs) {
    const gdt = gdtMs / 1000;
    const rdt = rdtMs / 1000;
    for (let li = 0; li < this._layers.length; li++) {
      const L = this._layers[li];
      const list = L.list;
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        const dt = p.rt ? rdt : gdt;
        p.age += dt;
        if (p.age >= p.life) {
          this._kill(L, i);
          continue;
        }
        const k = p.age / p.life;
        let depthMul = 1;
        if (p.orb) {
          p.px = p.x;
          p.py = p.y;
          p.oa += p.ova * dt;
          p.or += p.ovr * dt;
          if (p.or < 0) p.or = 0;
          p.ox += p.ovx * dt;
          p.oy += p.ovy * dt;
          const sa = Math.sin(p.oa);
          p.x = p.ox + Math.cos(p.oa) * p.or;
          p.y = p.oy + sa * p.or * p.oys;
          if (dt > 0) {
            p.vx = (p.x - p.px) / dt;
            p.vy = (p.y - p.py) / dt;
          }
          if (p.depth) depthMul = 1 - p.depth * 0.5 * (1 - sa);
        } else {
          if (p.drag) {
            const f = 1 / (1 + p.drag * dt);
            p.vx *= f;
            p.vy *= f;
          }
          p.vx += p.ax * dt;
          p.vy += p.ay * dt;
          if (p.wob) p.vx += Math.sin(p.age * p.wobF + p.wobPh) * p.wob * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (p.sway) p.x += Math.cos(p.age * p.swayF + p.flutPh) * p.sway * dt;
        }
        if (p.align) {
          if (p.vx !== 0 || p.vy !== 0) p.rotation = Math.atan2(p.vy, p.vx);
        } else if (p.vr) {
          p.rotation += p.vr * dt;
        }
        let s;
        switch (p.sEase) {
          case 1:
            s = p.s0 + (p.s1 - p.s0) * k * (2 - k);
            break;
          case 2:
            s = p.s1 * Math.sqrt(Math.sin(Math.PI * k));
            break;
          case 3:
            s = p.s0 + (p.s1 - p.s0) * k * k;
            break;
          default:
            s = p.s0 + (p.s1 - p.s0) * k;
        }
        let sx = s;
        if (p.stretch) {
          let st = 1 + Math.sqrt(p.vx * p.vx + p.vy * p.vy) * p.stretch;
          if (st > p.maxStretch) st = p.maxStretch;
          sx *= st;
        }
        if (p.flut) sx *= Math.cos(p.age * p.flut + p.flutPh);
        p.scaleX = sx;
        p.scaleY = s * p.sy;
        let a = p.a0 * depthMul;
        if (k < p.fin) a *= k / p.fin;
        else if (k > p.fout) a *= (1 - k) / (1 - p.fout);
        if (p.flick) a *= 1 - p.flick * Math.random();
        if (a > 1) a = 1;
        else if (a < 0) a = 0;
        let c;
        if (p.c0 === p.c1 && p.c1 === p.c2) c = p.c0;
        else if (k < p.cmid) c = lerpBgr(p.c0, p.c1, k / p.cmid);
        else c = lerpBgr(p.c1, p.c2, (k - p.cmid) / (1 - p.cmid));
        p.color = (((a * 255) | 0) << 24) | c;
      }
    }
  }

  clear() {
    for (const L of this._layers) {
      for (let i = L.list.length - 1; i >= 0; i--) this._kill(L, i);
    }
  }

  destroy() {
    this.clear();
    for (const L of this._layers) {
      if (L.pc.parent) L.pc.parent.removeChild(L.pc);
      L.pc.destroy({ texture: false });
    }
    this._layers = [];
    this._byParent.clear();
    this._pool = [];
  }
}

// =========================================================================================== presets
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const CONFETTI = [0xffd23f, 0x29e6ff, 0xff2e63, 0x7a5cff, 0x3ddc97, 0xffffff, 0xff8a3d];
const SHARDS = ['shard0', 'shard1', 'shard2', 'shard3'];
const SMOKES = ['smoke0', 'smoke1'];
const CHUNKS = ['chunk0', 'chunk1', 'chunk2'];

function dirAngle(o, spread) {
  return o.angle != null ? o.angle + (Math.random() - 0.5) * (o.spread != null ? o.spread : spread) : Math.random() * TAU;
}

/**
 * Burst presets. env = { epic, mul (quality count multiplier), sq (square px), T (FxTextures) }.
 * opts: count (at high quality), color, speed / life / size (multipliers), angle + spread (cone),
 * radius (energy), inward (energy), realtime.
 */
export const BURSTS = {
  spark(ps, L, x, y, o, env) {
    const { sq, T } = env;
    const col = o.color != null ? o.color : env.epic ? 0xffd23f : 0xffd27a;
    const sp = o.speed || 1;
    const lf = o.life || 1;
    const sz = o.size || 1;
    if (!env.epic) {
      const n = Math.max(2, Math.round((o.count != null ? o.count : 10) * env.mul * 0.6));
      for (let i = 0; i < n; i++) {
        const p = ps.spawn(L.add, T.frame('star'));
        if (!p) return;
        const a = dirAngle(o, TAU);
        const v = sq * rand(0.7, 2.4) * sp;
        p.x = x + Math.cos(a) * sq * 0.15;
        p.y = y + Math.sin(a) * sq * 0.15;
        p.vx = Math.cos(a) * v;
        p.vy = Math.sin(a) * v;
        p.drag = 3;
        p.ay = -sq * 0.4;
        p.life = rand(0.55, 1.0) * lf;
        p.sEase = 2;
        p.s1 = (rand(0.28, 0.5) * sq * sz) / 64;
        p.vr = rand(-2, 2);
        p.a0 = 0.95;
        p.fout = 0.5;
        p.colors(0xfffbe8, mixHex(col, 0xffffff, 0.3), col, 0.5);
        p.rt = !!o.realtime;
      }
      return;
    }
    const n = Math.max(3, Math.round((o.count != null ? o.count : 28) * env.mul));
    for (let i = 0; i < n; i++) {
      const p = ps.spawn(L.add, T.frame('spark'));
      if (!p) return;
      const a = dirAngle(o, 1.6);
      const v = sq * rand(4.5, 15) * sp;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * v;
      p.vy = Math.sin(a) * v;
      p.drag = 3.4;
      p.ay = sq * 4;
      p.life = rand(0.22, 0.55) * lf;
      p.align = true;
      p.s0 = (rand(0.32, 0.55) * sq * sz) / 64;
      p.s1 = p.s0 * 0.25;
      p.sy = 1.35;
      p.stretch = 0.24 / sq;
      p.fout = 0.55;
      p.colors(0xffffff, mixHex(col, 0xffffff, 0.25), shadeHex(col, 0.55), 0.3);
      p.rt = !!o.realtime;
    }
    // coloured halo + hot core flash
    {
      const p = ps.spawn(L.add, T.frame('dot'));
      if (!p) return;
      p.x = x;
      p.y = y;
      p.life = 0.28 * lf;
      p.s0 = (2.6 * sq * sz) / 64;
      p.s1 = p.s0 * 1.5;
      p.sEase = 1;
      p.a0 = 0.75;
      p.fout = 0.1;
      p.colors(mixHex(col, 0xffffff, 0.3), col, shadeHex(col, 0.4), 0.4);
      p.rt = !!o.realtime;
    }
    for (let i = 0; i < 2; i++) {
      const p = ps.spawn(L.add, T.frame('core'));
      if (!p) return;
      p.x = x;
      p.y = y;
      p.life = rand(0.12, 0.2) * lf;
      p.s0 = (rand(1.3, 1.9) * sq * sz) / 32;
      p.s1 = p.s0 * 0.25;
      p.sEase = 1;
      p.fout = 0.2;
      p.colors(0xffffff, col, col, 0.5);
      p.rt = !!o.realtime;
    }
    // a couple of twinkles
    for (let i = 0; i < 3; i++) {
      const p = ps.spawn(L.add, T.frame('star'));
      if (!p) return;
      const a = Math.random() * TAU;
      const d = sq * rand(0.2, 0.7);
      p.x = x + Math.cos(a) * d;
      p.y = y + Math.sin(a) * d;
      p.life = rand(0.25, 0.45) * lf;
      p.sEase = 2;
      p.s1 = (rand(0.5, 0.9) * sq * sz) / 64;
      p.vr = rand(-3, 3);
      p.colors(0xffffff, col, col);
      p.rt = !!o.realtime;
    }
  },

  stars(ps, L, x, y, o, env) {
    const { sq, T } = env;
    const col = o.color != null ? o.color : env.epic ? 0xffd23f : 0xffd27a;
    const n = Math.max(2, Math.round((o.count != null ? o.count : 10) * env.mul));
    const R = (o.radius != null ? o.radius : 0.6) * sq;
    for (let i = 0; i < n; i++) {
      const p = ps.spawn(L.add, T.frame('star'));
      if (!p) return;
      const a = Math.random() * TAU;
      const d = Math.sqrt(Math.random()) * R;
      p.x = x + Math.cos(a) * d;
      p.y = y + Math.sin(a) * d;
      p.vy = -sq * rand(0.2, 0.9) * (o.speed || 1);
      p.drag = 1;
      p.life = rand(0.45, 0.95) * (o.life || 1);
      p.sEase = 2;
      p.s1 = (rand(0.3, 0.6) * sq * (o.size || 1)) / 64;
      p.vr = rand(-2.5, 2.5);
      p.colors(0xffffff, mixHex(col, 0xffffff, 0.2), col, 0.5);
      p.rt = !!o.realtime;
    }
  },

  dust(ps, L, x, y, o, env) {
    const { sq, T } = env;
    const col = o.color != null ? o.color : env.epic ? 0xb6a8ff : 0xe6d2a8;
    const alpha = env.epic ? 0.5 : 0.55;
    const n = Math.max(3, Math.round((o.count != null ? o.count : 12) * env.mul));
    const sp = o.speed || 1;
    for (let i = 0; i < n; i++) {
      const p = ps.spawn(L.normal, T.frame(pick(SMOKES)));
      if (!p) return;
      const a = dirAngle(o, TAU);
      const r0 = sq * rand(0.3, 0.46);
      p.x = x + Math.cos(a) * r0;
      p.y = y + Math.sin(a) * r0 * 0.8;
      const v = sq * rand(1.4, 3.6) * sp;
      p.vx = Math.cos(a) * v;
      p.vy = Math.sin(a) * v * 0.8;
      p.drag = 4.5;
      p.ay = -sq * 0.2;
      p.life = rand(0.45, 0.85) * (o.life || 1);
      p.s0 = (rand(0.36, 0.5) * sq * (o.size || 1)) / 64;
      p.s1 = p.s0 * rand(2.2, 3);
      p.sEase = 1;
      p.vr = rand(-1.2, 1.2);
      p.rotation = Math.random() * TAU;
      p.a0 = alpha;
      p.fin = 0.08;
      p.fout = 0.35;
      p.colors(mixHex(col, 0xffffff, 0.25), col, col);
      p.rt = !!o.realtime;
    }
    if (env.epic) {
      for (let i = 0; i < Math.round(n * 0.5); i++) {
        const p = ps.spawn(L.add, T.frame('ember'));
        if (!p) return;
        const a = Math.random() * TAU;
        const v = sq * rand(1.5, 4) * sp;
        p.x = x;
        p.y = y;
        p.vx = Math.cos(a) * v;
        p.vy = Math.sin(a) * v;
        p.drag = 4;
        p.life = rand(0.3, 0.6);
        p.s0 = (0.12 * sq) / 16;
        p.s1 = p.s0 * 0.4;
        p.colors(0xffffff, col, col);
        p.rt = !!o.realtime;
      }
    }
  },

  shards(ps, L, x, y, o, env) {
    const { sq, T } = env;
    const col = o.color != null ? o.color : env.epic ? 0xff2e63 : 0xf4eedd;
    const sp = o.speed || 1;
    const lf = o.life || 1;
    const sz = o.size || 1;
    if (!env.epic) {
      const n = Math.max(2, Math.round((o.count != null ? o.count : 8) * env.mul * 0.6));
      for (let i = 0; i < n; i++) {
        const p = ps.spawn(L.normal, T.frame(pick(SHARDS)));
        if (!p) return;
        const a = dirAngle(o, TAU);
        const v = sq * rand(1.2, 3.6) * sp;
        p.x = x;
        p.y = y;
        p.vx = Math.cos(a) * v;
        p.vy = Math.sin(a) * v - sq * 1.2;
        p.drag = 2.5;
        p.ay = sq * 7;
        p.life = rand(0.4, 0.7) * lf;
        p.s0 = p.s1 = (rand(0.1, 0.17) * sq * sz) / 32;
        p.vr = rand(-9, 9);
        p.rotation = Math.random() * TAU;
        p.fout = 0.55;
        p.colors(col);
        p.rt = !!o.realtime;
      }
      BURSTS.stars(ps, L, x, y, { count: 5, color: 0xffd27a, radius: 0.5, realtime: o.realtime }, env);
      return;
    }
    const n = Math.max(4, Math.round((o.count != null ? o.count : 26) * env.mul));
    const metal = 0x3d3658;
    for (let i = 0; i < n; i++) {
      const glow = i % 2 === 0;
      const p = ps.spawn(glow ? L.add : L.normal, T.frame(pick(SHARDS)));
      if (!p) return;
      const a = dirAngle(o, Math.PI * 1.1);
      const v = sq * rand(3, 12) * sp;
      p.x = x + (Math.random() - 0.5) * sq * 0.3;
      p.y = y + (Math.random() - 0.5) * sq * 0.3;
      p.vx = Math.cos(a) * v;
      p.vy = Math.sin(a) * v - sq * rand(0, 3);
      p.drag = 2.2;
      p.ay = sq * 9;
      p.life = rand(0.6, 1.1) * lf;
      p.s0 = (rand(0.24, 0.5) * sq * sz) / 32;
      p.s1 = p.s0 * 0.75;
      p.sy = rand(0.6, 1);
      p.vr = rand(-16, 16);
      p.rotation = Math.random() * TAU;
      p.fout = 0.65;
      if (glow) p.colors(0xffffff, mixHex(col, 0xffffff, 0.35), shadeHex(col, 0.6), 0.25);
      else if (Math.random() < 0.5) p.colors(mixHex(metal, 0xffffff, 0.35), metal, shadeHex(metal, 0.6), 0.5);
      else p.colors(mixHex(col, 0xffffff, 0.6), mixHex(col, 0xffffff, 0.2), shadeHex(col, 0.55), 0.35);
      p.rt = !!o.realtime;
    }
    // glowing edge glints flying with the shards
    BURSTS.spark(ps, L, x, y, { count: Math.round(n * 0.7), color: col, speed: sp * 1.1, angle: o.angle, spread: o.spread, realtime: o.realtime }, env);
  },

  embers(ps, L, x, y, o, env) {
    const { sq, T } = env;
    const col = o.color != null ? o.color : env.epic ? 0xff8a3d : 0xffcf7a;
    const n = Math.max(2, Math.round((o.count != null ? o.count : 22) * env.mul * (env.epic ? 1 : 0.6)));
    const R = (o.radius != null ? o.radius : 0.45) * sq;
    for (let i = 0; i < n; i++) {
      const p = ps.spawn(L.add, T.frame('ember'));
      if (!p) return;
      const a = Math.random() * TAU;
      const d = Math.sqrt(Math.random()) * R;
      p.x = x + Math.cos(a) * d;
      p.y = y + Math.sin(a) * d;
      p.vx = rand(-0.7, 0.7) * sq * (o.speed || 1);
      p.vy = -sq * rand(0.8, 2.8) * (o.speed || 1);
      p.ay = -sq * 0.6;
      p.drag = 0.8;
      p.wob = sq * rand(3, 6);
      p.wobF = rand(3, 8);
      p.wobPh = Math.random() * TAU;
      p.life = rand(0.7, 1.5) * (o.life || 1);
      p.s0 = (rand(0.2, 0.36) * sq * (o.size || 1)) / 16;
      p.s1 = p.s0 * 0.3;
      p.flick = env.epic ? 0.35 : 0.15;
      p.fout = 0.45;
      p.colors(0xfff4c8, col, shadeHex(col, 0.45), 0.35);
      p.rt = !!o.realtime;
    }
  },

  energy(ps, L, x, y, o, env) {
    const { sq, T } = env;
    const col = o.color != null ? o.color : env.epic ? 0x29e6ff : 0xffd27a;
    const n = Math.max(3, Math.round((o.count != null ? o.count : 24) * env.mul * (env.epic ? 1 : 0.5)));
    const R = (o.radius != null ? o.radius : 1.6) * sq;
    const inward = !!o.inward;
    const lf = o.life || 1;
    for (let i = 0; i < n; i++) {
      const wisp = Math.random() < 0.7;
      const p = ps.spawn(L.add, T.frame(wisp ? 'streak' : 'dot'));
      if (!p) return;
      const life = rand(0.45, 0.8) * lf;
      p.life = life;
      p.orb = true;
      p.ox = x;
      p.oy = y;
      p.oa = Math.random() * TAU;
      const dir = Math.random() < 0.5 ? -1 : 1;
      p.ova = dir * rand(3, 7) * (o.speed || 1);
      if (inward) {
        p.or = R * rand(0.75, 1.15);
        p.ovr = -(p.or / life) * rand(0.95, 1.1);
      } else {
        p.or = R * rand(0.05, 0.2);
        p.ovr = (R / life) * rand(0.7, 1.1);
      }
      p.oys = o.flat != null ? o.flat : 1;
      p.align = wisp;
      p.s0 = wisp ? (rand(0.7, 1.2) * sq * (o.size || 1)) / 128 : (rand(0.35, 0.6) * sq) / 64;
      p.sy = wisp ? rand(1.6, 2.4) : 1;
      p.s1 = p.s0 * (inward ? 0.6 : 0.3);
      p.fin = 0.15;
      p.fout = inward ? 0.75 : 0.5;
      p.colors(mixHex(col, 0xffffff, 0.7), mixHex(col, 0xffffff, 0.25), col, 0.4);
      p.rt = !!o.realtime;
    }
  },

  petals(ps, L, x, y, o, env) {
    const { sq, T } = env;
    const n = Math.max(3, Math.round((o.count != null ? o.count : 30) * env.mul));
    const tint = o.color != null ? o.color : 0xffffff;
    for (let i = 0; i < n; i++) {
      const p = ps.spawn(L.normal, T.frame('petal'));
      if (!p) return;
      const a = o.angle != null ? dirAngle(o, 1.6) : -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
      const v = sq * rand(2, 7) * (o.speed || 1);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * v;
      p.vy = Math.sin(a) * v;
      p.drag = 2.4;
      p.ay = sq * 1.3;
      p.sway = sq * rand(0.6, 1.4);
      p.swayF = rand(1.5, 3);
      p.flut = rand(4, 9);
      p.flutPh = Math.random() * TAU;
      p.vr = rand(-3, 3);
      p.rotation = Math.random() * TAU;
      p.life = rand(1.8, 3.2) * (o.life || 1);
      p.s0 = p.s1 = (rand(0.32, 0.5) * sq * (o.size || 1)) / 28;
      p.fin = 0.04;
      p.fout = 0.75;
      p.colors(tint);
      p.rt = !!o.realtime;
    }
  },

  confetti(ps, L, x, y, o, env) {
    const { sq, T } = env;
    const n = Math.max(4, Math.round((o.count != null ? o.count : 40) * env.mul));
    for (let i = 0; i < n; i++) {
      const p = ps.spawn(L.normal, T.frame('confetti'));
      if (!p) return;
      const a = o.angle != null ? dirAngle(o, 1.6) : -Math.PI / 2 + (Math.random() - 0.5) * 1.7;
      const v = sq * rand(6, 15) * (o.speed || 1);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * v;
      p.vy = Math.sin(a) * v;
      p.drag = 2.6;
      p.ay = sq * 8;
      p.sway = sq * rand(0.3, 1);
      p.swayF = rand(2, 4);
      p.flut = rand(8, 16);
      p.flutPh = Math.random() * TAU;
      p.vr = rand(-8, 8);
      p.rotation = Math.random() * TAU;
      p.life = rand(1.4, 2.5) * (o.life || 1);
      p.s0 = p.s1 = (rand(0.28, 0.42) * sq * (o.size || 1)) / 12;
      p.sy = rand(0.7, 1.1);
      p.fout = 0.8;
      p.colors(o.color != null ? o.color : pick(CONFETTI));
      p.rt = !!o.realtime;
    }
  },

  smoke(ps, L, x, y, o, env) {
    const { sq, T } = env;
    const col = o.color != null ? o.color : env.epic ? 0x2b2340 : 0x5a4a3a;
    const n = Math.max(2, Math.round((o.count != null ? o.count : 10) * env.mul));
    for (let i = 0; i < n; i++) {
      const p = ps.spawn(L.normal, T.frame(pick(SMOKES)));
      if (!p) return;
      const a = Math.random() * TAU;
      const d = sq * rand(0, 0.35);
      p.x = x + Math.cos(a) * d;
      p.y = y + Math.sin(a) * d;
      p.vx = Math.cos(a) * sq * rand(0.3, 1.3) * (o.speed || 1);
      p.vy = Math.sin(a) * sq * rand(0.3, 1.0) - sq * rand(0.3, 1.1);
      p.drag = 1.4;
      p.life = rand(0.9, 1.6) * (o.life || 1);
      p.s0 = (rand(0.45, 0.65) * sq * (o.size || 1)) / 64;
      p.s1 = p.s0 * rand(2.2, 3.2);
      p.sEase = 1;
      p.vr = rand(-0.8, 0.8);
      p.rotation = Math.random() * TAU;
      p.a0 = env.epic ? 0.6 : 0.42;
      p.fin = 0.12;
      p.fout = 0.4;
      p.colors(col);
      p.rt = !!o.realtime;
    }
  },

  fire(ps, L, x, y, o, env) {
    const { sq, T } = env;
    const col = o.color != null ? o.color : 0xff7a1f;
    const n = Math.max(3, Math.round((o.count != null ? o.count : 16) * env.mul));
    const sz = o.size || 1;
    for (let i = 0; i < n; i++) {
      const p = ps.spawn(L.add, T.frame(pick(SMOKES)));
      if (!p) return;
      const a = Math.random() * TAU;
      const v = sq * rand(1, 4.5) * (o.speed || 1) * sz;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * v;
      p.vy = Math.sin(a) * v;
      p.drag = 3.2;
      p.ay = -sq * 1.5;
      p.life = rand(0.35, 0.7) * (o.life || 1);
      p.s0 = (rand(0.5, 0.8) * sq * sz) / 64;
      p.s1 = p.s0 * rand(1.8, 2.6);
      p.sEase = 1;
      p.vr = rand(-2, 2);
      p.rotation = Math.random() * TAU;
      p.fout = 0.3;
      p.colors(0xfff2c0, col, 0x3a0c10, 0.3);
      p.rt = !!o.realtime;
    }
  },

  debris(ps, L, x, y, o, env) {
    const { sq, T } = env;
    const col = o.color != null ? o.color : env.epic ? 0x4a4466 : 0x6b4a2e;
    const n = Math.max(2, Math.round((o.count != null ? o.count : 12) * env.mul));
    for (let i = 0; i < n; i++) {
      const p = ps.spawn(L.normal, T.frame(pick(CHUNKS)));
      if (!p) return;
      const a = dirAngle(o, TAU);
      const v = sq * rand(1.5, 6) * (o.speed || 1);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * v;
      p.vy = Math.sin(a) * v - sq * rand(1, 3);
      p.drag = 2;
      p.ay = sq * 12;
      p.life = rand(0.4, 0.8) * (o.life || 1);
      p.s0 = p.s1 = (rand(0.08, 0.16) * sq * (o.size || 1)) / 16;
      p.vr = rand(-12, 12);
      p.rotation = Math.random() * TAU;
      p.fout = 0.6;
      p.colors(col);
      p.rt = !!o.realtime;
    }
  },

  rain(ps, L, x, y, o, env) {
    const { sq, T } = env;
    const n = Math.max(1, Math.round((o.count != null ? o.count : 1) * env.mul));
    const col = o.color != null ? o.color : 0x9fb4d8;
    for (let i = 0; i < n; i++) {
      const p = ps.spawn(L.add, T.frame('drop'));
      if (!p) return;
      const a = o.angle != null ? o.angle : Math.PI / 2 + 0.18;
      const v = sq * rand(18, 26) * (o.speed || 1);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * v;
      p.vy = Math.sin(a) * v;
      p.rotation = a - Math.PI / 2;
      p.life = rand(0.5, 0.9) * (o.life || 1);
      p.s0 = p.s1 = (rand(0.5, 1) * sq * (o.size || 1)) / 40;
      p.sy = rand(0.8, 1.4);
      p.a0 = rand(0.25, 0.55);
      p.fout = 0.85;
      p.colors(col);
      p.rt = !!o.realtime;
    }
  },
};

/** Run a preset. Unknown kinds fall back to 'spark'. */
export function emitBurst(ps, L, kind, x, y, opts, env) {
  const fn = BURSTS[kind] || BURSTS.spark;
  fn(ps, L, x, y, opts || {}, env);
}
