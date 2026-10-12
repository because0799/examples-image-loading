// «Валькирии доски» — Ultimates («Вспышки», GDD §18.3): one shared timeline + 24 hero cinematics.
//
// Timeline (ms at speed 1; ULT_TIMELINE in theme.js keeps every rarity inside its budget):
//   dim      hit-stop, the scene darkens around the caster and her targets, element vignette,
//            focus speed lines, the voice line starts (playVoice(heroId, 'ultimate'))
//   cut-in   Rare: compact band · Epic / Legendary: art band + names (RU, JP) · Mythic: full-screen
//            splash with letterbox and an iridescent glint (settings.fx.cutins / rpgUltCinematic)
//   vfx      the hero's own board effect; hits land through ctx.hit() at the right moment
//   outro    remaining consequences, the scene brightens, camera returns
// Mythic Ultimates add grandeur: bloom pulses, a rainbow halo burst, bigger kanji and camera moves.

import { Sprite } from 'pixi.js';
import { Ease } from '../../render/tween.js';
import { readMs } from '../../fx/prefs.js';
import { HERO_BY_ID } from '../data/heroes.js';
import { ULT_TIMELINE, ULT_KANJI, cutInKind, elementFx, GOLD, iridescent, mix } from './theme.js';
import { hitGroups, targetsOf, ultMode, isChainDamage } from './timeline.js';
import { sqDist, diagonalRays } from './layout.js';
import { spotlightTexture } from './art.js';
import { ABORT } from './abort.js';

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ============================================================================ context
class UltCtx {
  constructor(view, beat, caster, parts) {
    this.v = view;
    this.vx = view.vx;
    this.fx = view.fx;
    this.beat = beat;
    this.head = beat.head || {};
    this.caster = caster;
    this.hero = caster.hero || HERO_BY_ID[caster.heroId] || null;
    this.el = elementFx(this.head.element || caster.element);
    this.groups = parts.groups;
    this.pre = parts.pre;
    this.post = parts.post;
    this.sq = view.sqSize;
    this.mythic = caster.rarity === 'mythic';
    const ids = targetsOf(this.groups);
    this.targets = ids.map((id) => view.piece(id)).filter(Boolean);
    this.enemies = this.targets.filter((t) => t.side !== caster.side);
    this.allies = this.targets.filter((t) => t.side === caster.side);
    this.layers = view.layers;
    this.inflight = [];
  }

  P(p) {
    return { x: p.x, y: p.y - (p.lift || 0) };
  }

  at(sq) {
    return this.v.center(sq, { x: 0, y: 0 });
  }

  wait(ms) {
    return this.v.wait(ms);
  }

  /** World y of the top of the screen above world x (for sky strikes). */
  skyY(x) {
    const r = this.v.renderer;
    if (typeof r.worldToScreen !== 'function' || typeof r.screenToWorld !== 'function') return this.v.layout.y - this.sq * 3;
    const s = r.worldToScreen(x, 0);
    return r.screenToWorld(s.x, -30).y;
  }

  /** Apply the pending hit group(s) of a target (id or piece). opts: { fx: bool, all, big } */
  async hit(ref, opts = {}) {
    const id = ref && typeof ref === 'object' ? ref.id : ref;
    const list = this.groups.filter((g) => !g.done && g.target === id);
    if (!list.length) return;
    const piece = this.v.piece(id);
    for (const g of opts.all === false ? list.slice(0, 1) : list) {
      if (opts.fx !== false && piece && g.events.some((e) => e.type === 'damage' && !isChainDamage(e))) {
        const dmg = g.events.find((e) => e.type === 'damage');
        this.vx.hit(this.el.id, piece, { big: opts.big !== false, crit: dmg && dmg.crit, from: this.caster });
      }
      await this.v.applyGroup(g);
    }
  }

  /** Apply the next pending group of a target (multi-hit sequences). */
  async hitNext(ref, opts = {}) {
    return this.hit(ref, { ...opts, all: false });
  }

  /** Fire-and-forget hit (from inside an animation callback); flush() waits for it. */
  fire(ref, opts = {}) {
    const p = this.hit(ref, opts).catch((e) => {
      if (e !== ABORT) console.error('[rpg-ult] hit failed', e);
    });
    this.inflight.push(p);
    return p;
  }

  /** Every pending group, staggered. */
  async hitAll({ stagger = 70, fx = true } = {}) {
    let first = true;
    for (const g of this.groups) {
      if (g.done) continue;
      if (!first && stagger) await this.wait(stagger);
      first = false;
      await this.hit(g.target, { fx, all: false });
    }
  }

  /** Apply what is left (groups, then the non-caster pre events if still pending). */
  async flush() {
    if (this.inflight.length) await Promise.all(this.inflight.splice(0));
    await this.applyPre();
    for (const g of this.groups) if (!g.done) await this.v.applyGroup(g);
  }

  async applyPre() {
    if (this._preDone) return;
    this._preDone = true;
    await this.v.applyEvents(this.pre);
  }

  kanji(text, x, y, size = 1.3, color) {
    const v = this.v;
    if (!v.pref('kanji') || !this.fx) return;
    const s = Math.round(this.sq * size * (this.mythic ? 1.2 : 1));
    this.vx.fxCall('kanji', text, x, y, { size: s, color: color != null ? color : this.el.color, hold: readMs(text, 'kanji', v.settings) * 0.6 });
  }

  shake(i, ms) {
    this.v.shake(i, ms);
  }

  flash(color = 0xffffff, alpha = 0.35, ms = 200) {
    this.vx.fxCall('flash', color, { alpha, duration: ms });
  }

  cam(x, y, zoom = 1.15, ms = 360) {
    return this.v.camFocus(x, y, zoom, ms);
  }

  /** Sprite helper in a VFX layer. */
  sprite(frame, layer, o) {
    return this.vx.sprite(frame, layer || this.layers.vfxOver, o);
  }
}

// ============================================================================ timeline
export async function playUltimate(view, beat) {
  const caster = view.tokens.get(beat.unit);
  const parts = hitGroups(beat.events, beat.unit);
  if (!caster) {
    await view.applyEvents(parts.pre);
    await view.applyGroups(parts.groups);
    await view.applyEvents(parts.post);
    return;
  }
  // caster bookkeeping (energy → 0, cooldowns) right away; the rest of `pre` is the hero's to time
  const casterPre = parts.pre.filter((e) => (e.unit === caster.id || e.target === caster.id) && (e.type === 'energy' || e.type === 'cooldown'));
  parts.pre = parts.pre.filter((e) => !casterPre.includes(e));
  await view.applyEvents(casterPre);
  const u = new UltCtx(view, beat, caster, parts);
  const hero = u.hero;
  const rarity = caster.rarity || (hero && hero.rarity) || 'rare';
  const kind = cutInKind(rarity);
  const TL = ULT_TIMELINE[kind] || ULT_TIMELINE.compact;
  const vfxMs = TL.vfx + (rarity === 'legendary' ? 300 : 0);
  const mode = ultMode(view.settings);
  const full = mode === 'full' || (mode === 'first' && !view._seenUlt.has(caster.heroId));
  view._seenUlt.add(caster.heroId);
  const withCut = full && view.pref('cutins');
  const fx = view.fx;
  const el = u.el;
  const c = u.P(caster);
  const keep = [caster.id, ...u.targets.map((t) => t.id)];
  const total = TL.dim + (withCut ? TL.cutIn : 0) + vfxMs + TL.outro;

  // ---------------------------------------------------------------- 0) dim
  if (fx && view.pref('slowmo')) fx.hitStop(90);
  view.dimWorld(0.62, view.T(TL.dim), keep);
  u.vx.fxCall('vignette', el.color, { alpha: 0.42, duration: view.T(total), fade: 260 });
  const sp = typeof view.renderer.worldToScreen === 'function' ? view.renderer.worldToScreen(c.x, c.y) : c;
  u.vx.fxCall('speedLines', { screenFocus: sp, duration: view.T(TL.dim + (withCut ? TL.cutIn : 0) + 200), color: mix(el.color, 0xffffff, 0.4), style: 'focus' });
  u.vx.windup(el.id, caster, 1.6);
  view.sfx('riser', { intensity: 1 });
  view.buzz([20, 40, 30]);
  const lang = view.lang === 'en' ? 'en' : 'ru';
  view._say(caster.heroId, 'ultimate', {
    force: true,
    onStart: (info) => {
      const line = info && info.line ? info.line[lang] || info.line.ru : null;
      if (line && view.cutin) view.cutin.subtitle(line);
    },
  });
  await view.wait(TL.dim);

  // ---------------------------------------------------------------- 1) cut-in
  const ultName = hero && hero.ultimate ? hero.ultimate.name : null;
  if (withCut) {
    view.sfx('swell', { intensity: 1 });
    await view.cutin.play({ token: caster, hero, kind, ms: view.T(TL.cutIn), ultName });
    if (u.mythic) mythicBurst(u);
  }
  if (ultName) view.cutin.namePlate(ultName[lang] || ultName.ru, el, { jp: ultName.jp, hold: view.T(vfxMs) });

  // ---------------------------------------------------------------- 2) hero VFX
  const fn = ULTS[caster.heroId] || genericUlt;
  try {
    await fn(u, vfxMs);
  } finally {
    if (!view.skipping) await u.flush();
  }
  await view.applyEvents(parts.post);

  // ---------------------------------------------------------------- 3) outro
  view.dimWorld(0, view.T(TL.outro * 0.8), []);
  view.camReset(TL.outro);
  await view.wait(TL.outro * 0.7);
}

/** Mythic extra: an iridescent halo burst + bloom right after the full-screen splash. */
function mythicBurst(u) {
  const c = u.P(u.caster);
  const sq = u.sq;
  u.vx.fxCall('bloomPulse', 1.1, 700);
  for (let i = 0; i < 3; i++) {
    u.vx.pulse('glowRing', u.layers.vfxOver, { x: c.x, y: c.y, tint: iridescent(i), w0: sq * 0.8, w1: sq * (5 + i * 1.5), ms: 700 + i * 120, delay: i * 90, alpha: 0.9 });
  }
  u.vx.fxCall('rays', c.x, c.y, { color: 0xffe9ff, duration: 1200, size: sq * 7 });
  u.v.sfx('gong', { intensity: 1 });
}

// ============================================================================ helpers
function wings(u, piece, ms = 1500, tint = 0xfff6d8) {
  const c = u.P(piece);
  const sq = u.sq;
  const out = [];
  for (const dir of [-1, 1]) {
    const w = u.sprite('wing', u.layers.vfxUnder, { x: c.x, y: c.y - sq * 0.1, ax: 0.06, ay: 0.94, tint });
    w.scale.x = 0;
    out.push(w);
    u.vx.run(ms, (e, k) => {
      const open = Ease.outBack(clamp01(k / 0.25));
      const fade = k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
      const W = sq * 2.1 * open;
      u.vx.fitW(w, W, W * 0.88);
      w.scale.x *= dir;
      w.rotation = dir * (0.15 + 0.08 * Math.sin(k * 9));
      w.alpha = 0.9 * fade;
    }, { end: () => u.vx.free(w) });
  }
  return out;
}

/** Bits flying from a to b (sparks, drained energy …). */
function stream(u, a, b, { frame = 'spark', tint = 0xffffff, n = 8, ms = 420, size = 0.22, layer } = {}) {
  const sq = u.sq;
  for (let i = 0; i < u.vx.n(n); i++) {
    const life = (ms / 1000) * rand(0.8, 1.1);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    u.vx.bits.spawn(frame, layer || u.layers.vfxOver, { x: a.x + rand(-sq * 0.2, sq * 0.2), y: a.y + rand(-sq * 0.2, sq * 0.2), vx: dx / life, vy: dy / life - sq * rand(0, 1.5), ay: sq * rand(0, 3), size: sq * size, size1: sq * size * 0.4, life, tint, vr: rand(-4, 4) });
  }
}

/** A sprite that flies from a to b; resolves on arrival. */
function fly(u, frame, a, b, { ms = 360, tint = 0xffffff, w, h, layer, spin = 0, arc = 0, rotate = true, trail = null, ease = Ease.inQuad } = {}) {
  const s = u.sprite(frame, layer || u.layers.vfxOver, { x: a.x, y: a.y, tint });
  u.vx.fitW(s, w || u.sq * 0.6, h);
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  let n = 0;
  return u.vx.run(ms, (e, k) => {
    const x = a.x + (b.x - a.x) * e;
    const y = a.y + (b.y - a.y) * e - Math.sin(Math.PI * e) * arc;
    s.position.set(x, y);
    s.rotation = spin ? spin * k : rotate ? ang : 0;
    if (trail && (n++ & 1) === 0) trail(x, y);
  }, { end: () => u.vx.free(s), ease });
}

/** Hits scheduled by distance from a point (ms per square). */
async function hitsByDistance(u, fromSq, perSq, { base = 0, fx = true, list = null } = {}) {
  const tg = list || u.targets;
  await Promise.all(
    tg.map((t) => (async () => {
      await u.wait(base + sqDist(fromSq, t.sq) * perSq);
      await u.hit(t, { fx });
    })()),
  );
}

// ============================================================================ the 24 cinematics
const ULTS = {
  // ------------------------------------------------------------------ Mythic
  async liora(u) {
    const c = u.P(u.caster);
    const sq = u.sq;
    wings(u, u.caster, 1900);
    u.vx.fxCall('pillar', c.x, c.y, { color: GOLD, width: 1.2 * u.v.k, duration: 1500, godrays: u.fx && u.fx.quality === 'high' });
    u.kanji('光', u.v.layout.cx, u.v.layout.y + sq * 1.2, 1.6, GOLD);
    u.vx.fxCall('bloomPulse', 0.9, 900);
    u.v.sfx('gong', { intensity: 1 });
    await u.wait(260);
    // golden pillars march outward along both diagonals, one step every 0.1 s
    const rays = diagonalRays(u.caster.sq, 7);
    for (let step = 0; step < 7; step++) {
      for (const ray of rays) {
        const q = ray[step];
        if (q == null) continue;
        u.v.later(step * 100, () => {
          const p = u.at(q);
          u.vx.miniPillar(p.x, p.y, GOLD, 1.15);
        });
      }
    }
    for (let i = 0; i < u.vx.n(18); i++) {
      u.vx.bits.spawn('feather', u.layers.vfxOver, { x: u.v.layout.x + Math.random() * u.v.layout.total, y: u.v.layout.y - sq * rand(0, 1), vx: rand(-12, 12), vy: rand(20, 45), size: sq * 0.3, life: rand(1.4, 2), tint: 0xffffff, vr: rand(-2, 2), sway: sq * 0.3, fout: 0.75 });
    }
    await hitsByDistance(u, u.caster.sq, 100, { base: 60 });
    u.shake(0.35, 320);
    await u.wait(380);
  },

  async nocturna(u) {
    const sq = u.sq;
    const L = u.v.layout;
    const c = u.P(u.caster);
    u.vx.fxCall('impactFrame', { duration: 200 });
    u.v.sfx('menacing', { intensity: 1 });
    // the black sun rises over the board
    const sunX = L.cx;
    const sunY = L.y + L.total * 0.3;
    const sun = u.sprite('blackSun', u.layers.vfxOverN, { x: sunX, y: sunY + sq * 2 });
    const corona = u.sprite('glowRing', u.layers.vfxOver, { x: sunX, y: sunY, tint: 0xd7337e });
    u.vx.fxCall('rays', sunX, sunY, { color: 0xd7337e, duration: 1900, size: sq * 6.5 });
    const life = u.vx.run(2000, (e, k) => {
      const rise = Ease.outCubic(clamp01(k / 0.35));
      const fade = k > 0.82 ? 1 - (k - 0.82) / 0.18 : 1;
      sun.position.set(sunX, sunY + sq * 2 * (1 - rise));
      u.vx.fitW(sun, sq * 3.2 * (0.4 + 0.6 * rise));
      sun.alpha = fade;
      sun.rotation = k * 0.6;
      corona.position.set(sunX, sun.y);
      u.vx.fitW(corona, sq * 4.6 * (0.5 + 0.5 * rise) * (1 + 0.05 * Math.sin(k * 30)));
      corona.alpha = 0.8 * fade;
      corona.tint = mix(0xd7337e, 0x8a7cff, 0.5 + 0.5 * Math.sin(k * 8));
    }, { end: () => {
      u.vx.free(sun);
      u.vx.free(corona);
    } });
    u.kanji('皇蝕', L.cx, L.y + L.total * 0.62, 1.5, 0xd7337e);
    u.vx.fxCall('chromatic', 0.9, 700);
    await u.wait(420);
    // ink tendrils crawl from the edges to every enemy, then the energy flows to Nocturna
    await Promise.all(u.enemies.map((t, i) => (async () => {
      await u.wait(i * 60);
      const p = u.P(t);
      const edgeX = p.x < L.cx ? L.x - sq * 0.3 : L.x + L.total + sq * 0.3;
      const from = { x: edgeX, y: p.y + rand(-sq, sq) };
      const steps = 10;
      for (let s = 0; s <= steps; s++) {
        const k = s / steps;
        const x = from.x + (p.x - from.x) * k;
        const y = from.y + (p.y - from.y) * k + Math.sin(k * 9 + i) * sq * 0.25;
        u.vx.bits.spawn('inkBlob', u.layers.vfxOverN, { x, y, size: sq * (0.45 - 0.2 * k), size1: sq * 0.12, life: 0.7 - k * 0.2, alpha: 0.85, tint: 0x0c0012, fin: 0.05 });
        if (s % 3 === 0) await u.wait(25);
      }
      await u.hit(t);
      stream(u, p, c, { frame: 'spark', tint: 0xb27bff, n: 6, ms: 420 });
    })()));
    await life;
  },

  // ------------------------------------------------------------------ Legendary
  async reika(u) {
    const sq = u.sq;
    const first = u.enemies[0] || u.targets[0];
    if (!first) return;
    const p = u.P(first);
    const c = u.P(u.caster);
    u.cam(p.x, p.y, 1.25, 320);
    u.vx.pulse('reticle', u.layers.vfxOver, { x: p.x, y: p.y, tint: 0xff4d6a, w0: sq * 2.4, w1: sq * 0.95, ms: 420, alpha: 1, fadeAt: 0.85, spin: 1.2 });
    const ang = Math.atan2(p.y - c.y, p.x - c.x);
    for (let i = 1; i <= 3; i++) {
      u.vx.pulse('ring', u.layers.vfxOver, { x: c.x + Math.cos(ang) * sq * 0.45 * i, y: c.y + Math.sin(ang) * sq * 0.45 * i, tint: 0xc49bff, w0: sq * 0.3, w1: sq * (0.9 - i * 0.12), ms: 520, delay: i * 70, alpha: 1 });
    }
    u.v.sfx('charge', { intensity: 1 });
    await u.wait(440);
    // the heavenly bolt
    u.vx.lightning(p.x + rand(-sq * 0.3, sq * 0.3), u.skyY(p.x), p.x, p.y, { color: 0xc49bff, duration: 420, branches: 4, width: 2.4 });
    u.flash(0xe6d6ff, 0.35, 180);
    u.shake(0.55, 380);
    u.v.sfx('thunder', { intensity: 1 });
    u.kanji('雷', p.x, p.y - sq * 0.9, 1.5, 0xc49bff);
    await u.hit(first, { all: false });
    // bounces
    let prev = first;
    const rest = u.groups.filter((g) => !g.done);
    for (const g of rest) {
      const t = u.v.piece(g.target);
      if (!t) continue;
      await u.wait(130);
      const a = u.P(prev);
      const b = u.P(t);
      u.vx.lightning(a.x, a.y, b.x, b.y, { color: 0xc49bff, duration: 260, branches: 2, width: 1.3 });
      u.v.sfx('zap', { intensity: 0.8 });
      await u.hitNext(t);
      prev = t;
    }
    await u.wait(300);
  },

  async fuyuka(u) {
    const sq = u.sq;
    const c = u.P(u.caster);
    u.v.sfx('shatter', { intensity: 1 });
    const frost = u.sprite('snowflake', u.layers.vfxUnder, { x: c.x, y: c.y, tint: 0x8eebff });
    const ring = u.sprite('glowRing', u.layers.vfxUnder, { x: c.x, y: c.y, tint: 0xcff8ff });
    const spread = u.vx.run(1900, (e, k) => {
      const g = Ease.outCubic(clamp01(k / 0.4));
      const fade = k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
      u.vx.fitW(frost, sq * 5.2 * g);
      frost.rotation = k * 0.8;
      frost.alpha = 0.55 * fade;
      u.vx.fitW(ring, sq * 5.6 * g);
      ring.alpha = 0.8 * fade;
    }, { end: () => {
      u.vx.free(frost);
      u.vx.free(ring);
    } });
    for (let i = 0; i < u.vx.n(20); i++) {
      const a = Math.random() * TAU;
      const r = Math.random() * sq * 2.5;
      u.vx.bits.spawn('snowflake', u.layers.vfxOver, { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r * 0.8, vy: -sq * 0.3, size: sq * 0.22, life: rand(0.8, 1.4), tint: 0xeafcff, vr: rand(-2, 2) });
    }
    u.kanji('氷', c.x, c.y - sq * 1.1, 1.5, 0x8eebff);
    await u.wait(380);
    // ice pillars on the enemies, hexagonal shields on the allies
    for (const t of u.enemies) {
      const p = u.P(t);
      u.vx.fxCall('pillar', p.x, p.y, { color: 0x9ff0ff, width: 0.85 * u.v.k, duration: 900, godrays: false, spiral: false });
    }
    u.shake(0.35, 300);
    await u.wait(140);
    await Promise.all([
      (async () => {
        for (const t of u.enemies) {
          await u.hit(t);
          await u.wait(60);
        }
      })(),
      (async () => {
        for (const t of u.allies) {
          await u.hit(t, { fx: false });
          await u.wait(50);
        }
      })(),
    ]);
    await spread;
  },

  async vermilia(u) {
    const sq = u.sq;
    const caster = u.caster;
    const c = u.P(caster);
    // the line end: her moveSelf destination (post) or the farthest target
    const dash = u.post.find((e) => e.type === 'displace' && e.unit === caster.id);
    let end = dash ? u.at(dash.to) : null;
    if (!end) {
      let far = null;
      for (const t of u.enemies) if (!far || sqDist(caster.sq, t.sq) > sqDist(caster.sq, far.sq)) far = t;
      end = far ? u.P(far) : c;
    }
    const bird = u.sprite('phoenix', u.layers.vfxOver, { x: c.x, y: c.y, tint: 0xff7a2a });
    const core = u.sprite('sun', u.layers.vfxOver, { x: c.x, y: c.y, tint: 0xffc24b });
    u.v.sfx('explosion', { intensity: 0.8 });
    u.vx.fxCall('explosion', c.x, c.y, { color: 0xff6a20, size: 0.9 * u.v.k });
    await u.vx.run(360, (e, k) => {
      u.vx.fitW(bird, sq * (0.6 + 1.6 * Ease.outBack(k)));
      bird.alpha = Math.min(1, k * 3);
      u.vx.fitW(core, sq * 1.2 * k);
    });
    u.kanji('不死鳥', c.x, c.y - sq * 1.2, 1.1, 0xff7a2a);
    caster.setAlpha(0.15);
    // dash along the diagonal with a fire trail; enemies burst as she passes
    const ang = Math.atan2(end.y - c.y, end.x - c.x);
    const hitAt = u.enemies.map((t) => ({ t, k: Math.hypot(t.x - c.x, t.y - c.y) / Math.max(1, Math.hypot(end.x - c.x, end.y - c.y)), done: false }));
    let n = 0;
    await u.vx.run(720, (e, k) => {
      const x = c.x + (end.x - c.x) * e;
      const y = c.y + (end.y - c.y) * e;
      bird.position.set(x, y);
      bird.rotation = ang + Math.PI / 2;
      core.position.set(x, y);
      if ((n++ & 1) === 0) {
        u.vx.emit('fire', x, y, { count: 3, color: 0xff6a20, size: 0.8 });
        u.vx.emit('embers', x, y, { count: 3, color: 0xffc24b, radius: 0.3 });
      }
      for (const h of hitAt) {
        if (!h.done && e >= Math.min(0.98, h.k)) {
          h.done = true;
          const p = u.P(h.t);
          u.vx.fxCall('explosion', p.x, p.y, { color: 0xff6a20, size: 0.75 * u.v.k });
          u.fire(h.t, { fx: false });
        }
      }
    }, { ease: Ease.inOutQuad, end: () => {
      u.vx.free(bird);
      u.vx.free(core);
      caster.setAlpha(1);
    } });
    u.shake(0.45, 320);
    await u.wait(250);
  },

  async tsubame(u) {
    const sq = u.sq;
    const caster = u.caster;
    const c = u.P(caster);
    // she dissolves into a spiral of feathers
    for (let i = 0; i < u.vx.n(22); i++) {
      u.vx.bits.spawn(i % 2 ? 'feather' : 'leaf', u.layers.vfxOver, { x: c.x, y: c.y, orbit: { cx: c.x, cy: c.y, r: sq * 0.1, a: (i / 22) * TAU, vr: 11, grow: sq * 1.4, rise: -sq * 0.5, flat: 0.6 }, size: sq * 0.24, life: 0.7, tint: i % 2 ? 0xd9fff0 : 0x3be3a0, vr: 7 });
    }
    u.v.sfx('whoosh', { intensity: 1 });
    await u.vx.run(260, (e) => {
      caster.setAlpha(1 - e);
      caster.setScale(1 - 0.6 * e);
    });
    u.kanji('嵐', u.v.layout.cx, u.v.layout.y + sq * 1.3, 1.5, 0x3be3a0);
    // six green slashes, 0.25 s apart, through the volley's hits
    const order = u.groups.filter((g) => !g.done);
    const n = Math.max(1, Math.min(6, order.length));
    for (let i = 0; i < Math.max(n, order.length); i++) {
      const g = order[i];
      const t = g ? u.v.piece(g.target) : u.enemies[i % Math.max(1, u.enemies.length)];
      if (!t) continue;
      const p = u.P(t);
      const a = rand(-1.2, 1.2);
      u.vx.slash(p.x, p.y, a, { color: 0x3be3a0, length: 1.9, width: 0.9, duration: 240, flip: i % 2 === 1 });
      u.vx.emit('spark', p.x, p.y, { count: 8, color: 0xd9fff0 });
      u.v.sfx('slash', { intensity: 0.8 });
      if (u.fx) u.v.fxt(u.fx.comboCounter(i + 1, { color: 0x3be3a0, label: u.v.lang === 'en' ? 'HIT' : 'УДАР' }));
      if (g) await u.v.applyGroup(g);
      u.shake(0.16, 140);
      await u.wait(i < 5 ? 210 : 120);
    }
    if (u.fx) u.v.later(500, () => u.fx.hideCombo());
    caster.setAlpha(1);
    caster.setScale(1);
  },

  // ------------------------------------------------------------------ Epic
  async mizuha(u) {
    const sq = u.sq;
    const L = u.v.layout;
    const c = u.P(u.caster);
    u.vx.shockwave(c.x, c.y, { radius: 2.4, strength: 1, color: 0x6fb8ff });
    u.vx.pulse('ring', u.layers.vfxOver, { x: c.x, y: c.y, tint: 0x8ff3ff, w0: sq * 0.5, w1: sq * 3.4, ms: 520 });
    u.v.sfx('gong', { intensity: 0.8 });
    u.kanji('潮', c.x, c.y - sq * 1.1, 1.4, 0x2e8bff);
    await u.wait(240);
    // a wave rolls across the board from her side
    const fromBottom = u.v.flipped ? u.caster.side === -1 : u.caster.side === 1;
    const y0 = fromBottom ? L.y + L.total + sq * 0.6 : L.y - sq * 0.6;
    const y1 = fromBottom ? L.y - sq * 0.6 : L.y + L.total + sq * 0.6;
    const wave = u.sprite('wave', u.layers.vfxOver, { x: L.cx, y: y0, tint: 0x5aa8ff });
    if (!fromBottom) wave.scale.y = -1;
    const order = u.targets.map((t) => ({ t, done: false }));
    let n = 0;
    await u.vx.run(900, (e, k) => {
      const y = y0 + (y1 - y0) * e;
      wave.position.set(L.cx, y);
      u.vx.fitW(wave, L.total * 1.15, sq * 1.6);
      if (!fromBottom) wave.scale.y *= -1;
      wave.alpha = k < 0.85 ? 0.75 : 0.75 * (1 - (k - 0.85) / 0.15);
      if ((n++ % 3) === 0) {
        const x = L.x + Math.random() * L.total;
        u.vx.bits.spawn('dot', u.layers.vfxOver, { x, y, vx: rand(-20, 20), vy: (fromBottom ? -1 : 1) * sq * rand(1, 3), ay: sq * 6, size: sq * 0.22, size1: sq * 0.06, life: 0.6, tint: 0xd8fbff });
      }
      for (const o of order) {
        if (!o.done && (fromBottom ? y <= o.t.y : y >= o.t.y)) {
          o.done = true;
          u.fire(o.t, { fx: false });
          const p = u.P(o.t);
          if (o.t.side === u.caster.side) u.vx.healPop(o.t);
          else u.vx.hitSplash(p, u.el);
        }
      }
    }, { ease: Ease.inOutSine, end: () => u.vx.free(wave) });
    await u.wait(200);
  },

  async akane(u) {
    const sq = u.sq;
    const t = u.enemies[0] || u.targets[0];
    if (!t) return;
    const p = u.P(t);
    u.cam(p.x, p.y, 1.2, 320);
    u.vx.fxCall('vignette', 0xff2a10, { alpha: 0.55, duration: 1600, fade: 300 });
    const sun = u.sprite('sun', u.layers.vfxUnder, { x: p.x, y: p.y + sq * 1.5, tint: 0xff5b3a });
    const sunLife = u.vx.run(1700, (e, k) => {
      const r = Ease.outCubic(clamp01(k / 0.4));
      sun.position.set(p.x, p.y + sq * 1.5 - sq * 1.9 * r);
      u.vx.fitW(sun, sq * (1.5 + 2.6 * r));
      sun.alpha = k > 0.8 ? (1 - (k - 0.8) / 0.2) * 0.95 : 0.95;
    }, { end: () => u.vx.free(sun) });
    u.kanji('緋', p.x, p.y - sq * 1.4, 1.5, 0xff5b3a);
    u.v.sfx('charge', { intensity: 1 });
    await u.wait(520);
    // the vertical scarlet cut (two hits)
    u.vx.slash(p.x, p.y, -Math.PI / 2 + 0.08, { color: 0xff6a2a, length: 3.2, width: 1.4, duration: 360 });
    u.vx.emit('fire', p.x, p.y, { count: 22, color: 0xff5b3a, size: 1.1 });
    u.flash(0xff8a3a, 0.3, 180);
    u.shake(0.5, 320);
    u.v.sfx('slash', { intensity: 1 });
    await u.hitNext(t);
    await u.wait(260);
    u.vx.slash(p.x, p.y, -Math.PI / 2 - 0.25, { color: 0xffc24b, length: 2.6, width: 1.1, duration: 300, flip: true });
    await u.hitNext(t);
    if (!t.alive || (u.v.tokens.get(t.id) && u.v.tokens.get(t.id).hp <= 0)) {
      u.vx.fxCall('explosion', p.x, p.y, { color: 0xff5b3a, size: 1.4 * u.v.k });
      u.shake(0.6, 380);
    }
    await sunLife;
  },

  async volta(u) {
    const sq = u.sq;
    const area = Array.isArray(u.head.area) && u.head.area.length ? u.head.area : u.targets.map((t) => t.sq);
    const pts = area.map((q) => ({ q, p: u.at(q) }));
    const cx = pts.reduce((s, o) => s + o.p.x, 0) / Math.max(1, pts.length);
    const cy = pts.reduce((s, o) => s + o.p.y, 0) / Math.max(1, pts.length);
    const cloudY = cy - sq * 2.6;
    const clouds = [];
    for (let i = 0; i < 4; i++) {
      const cl = u.sprite('cloud', u.layers.vfxOverN, { x: cx + (i - 1.5) * sq * 1.1, y: cloudY + rand(-sq * 0.2, sq * 0.2), tint: 0x3a3360 });
      clouds.push(cl);
    }
    const pet = u.sprite('cloud', u.layers.vfxOverN, { x: u.caster.x + sq * 0.55, y: u.caster.y - sq * 0.75, tint: 0xd8d0ff });
    u.vx.fitW(pet, sq * 0.55);
    const life = u.vx.run(1750, (e, k) => {
      const a = k < 0.15 ? k / 0.15 : k > 0.85 ? 1 - (k - 0.85) / 0.15 : 1;
      clouds.forEach((cl, i) => {
        u.vx.fitW(cl, sq * 1.9);
        cl.alpha = 0.92 * a;
        cl.x += Math.sin(k * 6 + i) * 0.3;
      });
      pet.alpha = a;
      pet.y = u.caster.y - sq * 0.75 - Math.abs(Math.sin(k * 18)) * sq * 0.15;
    }, { end: () => {
      for (const cl of clouds) u.vx.free(cl);
      u.vx.free(pet);
    } });
    u.kanji('落雷', cx, cloudY - sq * 0.2, 1.1, 0xa46bff);
    u.v.sfx('thunder', { intensity: 0.8 });
    await u.wait(320);
    for (const { q, p } of pts) {
      u.vx.lightning(p.x + rand(-sq * 0.2, sq * 0.2), cloudY + sq * 0.3, p.x, p.y, { color: 0xb88cff, duration: 300, branches: 2, width: 1.5 });
      u.vx.emit('spark', p.x, p.y, { count: 10, color: 0xf4e9ff });
      u.shake(0.18, 140);
      const hit = u.targets.find((t) => t.sq === q);
      if (hit) u.fire(hit, { fx: false });
      await u.wait(100);
    }
    u.vx.emit('stars', pet.x, pet.y, { count: 8, color: 0xffe14d, radius: 0.4 });
    await u.hitAll({ stagger: 40, fx: false });
    await life;
  },

  async koyuki(u) {
    const sq = u.sq;
    const L = u.v.layout;
    const rowY = u.targets.length ? u.targets.reduce((s, t) => s + t.y, 0) / u.targets.length : u.caster.y - sq * 3;
    if (u.v.audio && typeof u.v.audio.duck === 'function') {
      try {
        u.v.audio.duck(0.92, 320); // a beat of silence before the blizzard
      } catch (e) {
        /* optional */
      }
    }
    u.kanji('吹雪', L.cx, rowY - sq * 1.3, 1.2, 0xcff8ff);
    await u.wait(300);
    const veil = u.sprite('beam', u.layers.vfxOver, { x: L.x - sq, y: rowY, tint: 0xf4fdff, rot: Math.PI / 2 });
    const order = u.targets.slice().sort((a, b) => a.x - b.x).map((t) => ({ t, done: false }));
    let n = 0;
    await u.vx.run(1000, (e, k) => {
      const x = L.x - sq + (L.total + sq * 2) * e;
      veil.position.set(x, rowY + sq * 0.55);
      u.vx.fitW(veil, sq * 1.6, sq * 3.2);
      veil.alpha = 0.85;
      if ((n++ & 1) === 0) {
        u.vx.bits.spawn('snowflake', u.layers.vfxOver, { x: x + rand(-sq, 0), y: rowY + rand(-sq * 0.5, sq * 0.5), vx: sq * rand(2, 5), size: sq * 0.2, life: 0.5, tint: 0xffffff, vr: 4 });
        if (n % 6 === 0) fly(u, 'arrow', { x: x - sq * 1.5, y: rowY + rand(-sq * 0.3, sq * 0.3) }, { x: x + sq * 2.5, y: rowY + rand(-sq * 0.3, sq * 0.3) }, { ms: 200, tint: 0xcff8ff, w: sq * 0.9, h: sq * 0.2 });
      }
      for (const o of order) {
        if (!o.done && x >= o.t.x) {
          o.done = true;
          u.fire(o.t);
        }
      }
    }, { ease: Ease.inOutSine, end: () => u.vx.free(veil) });
    await u.wait(150);
  },

  async lucille(u) {
    const sq = u.sq;
    const c = u.P(u.caster);
    u.vx.fxCall('rays', c.x, c.y, { color: 0xffe9a0, duration: 1700, size: sq * 7 });
    u.flash(0xffe9a0, 0.18, 600);
    u.kanji('祈', c.x, c.y - sq * 1.2, 1.4, 0xfff0a0);
    u.v.sfx('gong', { intensity: 0.8 });
    const candles = [];
    for (const t of u.allies) {
      const p = u.P(t);
      const cd = u.sprite('candle', u.layers.vfxOverN, { x: p.x, y: p.y - sq * 0.95 });
      const glow = u.sprite('dot', u.layers.vfxOver, { x: p.x, y: p.y - sq * 1.05, tint: 0xffd27a });
      candles.push([cd, glow]);
    }
    const life = u.vx.run(1700, (e, k) => {
      const a = k < 0.15 ? k / 0.15 : k > 0.85 ? 1 - (k - 0.85) / 0.15 : 1;
      for (const [cd, gl] of candles) {
        u.vx.fitW(cd, sq * 0.36);
        cd.alpha = a;
        u.vx.fitW(gl, sq * (0.9 + 0.1 * Math.sin(k * 30)));
        gl.alpha = 0.7 * a;
      }
    }, { end: () => {
      for (const [cd, gl] of candles) {
        u.vx.free(cd);
        u.vx.free(gl);
      }
    } });
    await u.wait(380);
    for (const g of u.groups) {
      if (g.done) continue;
      const t = u.v.piece(g.target);
      if (t) u.vx.miniPillar(t.x, t.y, 0xfff0a0, 0.9);
      await u.v.applyGroup(g);
      await u.wait(90);
    }
    await life;
  },

  async karasu(u) {
    const sq = u.sq;
    const t = u.enemies[0] || u.targets[0];
    if (!t) return;
    const p = u.P(t);
    u.cam(p.x, p.y, 1.3, 300);
    // darkness everywhere except the prey
    const tex = spotlightTexture();
    const spot = new Sprite(tex);
    spot.anchor.set(0.5);
    u.layers.vfxOverN.addChild(spot);
    const scr = u.v.renderer.screen;
    const life = u.vx.run(1750, (e, k) => {
      spot.position.set(p.x, p.y);
      const s = Math.max(scr.width, scr.height) * 3.2;
      spot.width = spot.height = s * (1.4 - 0.4 * Ease.outCubic(clamp01(k / 0.3)));
      spot.alpha = k < 0.15 ? k / 0.15 : k > 0.82 ? 1 - (k - 0.82) / 0.18 : 1;
    }, { end: () => spot.destroy() });
    u.kanji('夜', p.x, p.y - sq * 1.3, 1.5, 0xd7337e);
    u.v.sfx('menacing', { intensity: 1 });
    // a flock of crows sweeps across
    const L = u.v.layout;
    for (let i = 0; i < 10; i++) {
      const y = p.y + rand(-sq * 1.8, sq * 1.2);
      const crow = u.sprite('crow', u.layers.vfxOverN, { x: L.x - sq * 2, y });
      const w = sq * rand(0.5, 0.85);
      const delay = i * 45;
      u.vx.run(700, (e, k) => {
        crow.position.set(L.x - sq * 2 + (L.total + sq * 4) * e, y - Math.sin(e * 3 + i) * sq * 0.3);
        u.vx.fitW(crow, w, w * 0.62 * (0.4 + 0.6 * Math.abs(Math.sin(k * 22 + i))));
        crow.alpha = 0.95;
      }, { delay, end: () => u.vx.free(crow) });
    }
    await u.wait(640);
    // one red stroke
    u.vx.slash(p.x, p.y, -0.5, { color: 0xff2e4d, length: 3, width: 1.2, duration: 340 });
    u.v.sfx('slash', { intensity: 1 });
    u.shake(0.45, 300);
    await u.hit(t, { fx: false });
    const tok = u.v.tokens.get(t.id);
    if (tok && tok.hp <= 0) {
      for (let i = 0; i < u.vx.n(16); i++) u.vx.bits.spawn('feather', u.layers.vfxOverN, { x: p.x, y: p.y, vx: rand(-80, 80), vy: rand(-90, -20), ay: sq * 1.2, size: sq * 0.3, life: rand(0.9, 1.3), tint: 0x1a1020, vr: rand(-5, 5), sway: sq * 0.2 });
    }
    await life;
  },

  async zlata(u) {
    const sq = u.sq;
    const c = u.P(u.caster);
    await u.vx.run(160, (e, k) => u.caster.setScale(1 + 0.2 * Math.sin(Math.PI * k)));
    u.vx.shockwave(c.x, c.y, { radius: 2.6, strength: 1.1, color: 0xe3a13b });
    u.shake(0.4, 300);
    u.v.sfx('bigImpact', { intensity: 1 });
    u.kanji('砦', c.x, c.y - sq * 1.2, 1.4, 0xe3a13b);
    // amber crystals around radius 2
    const ring = [];
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const r = (u.caster.sq >> 3) + dr;
      const cc = (u.caster.sq & 7) + dc;
      if ((dr || dc) && r >= 0 && r < 8 && cc >= 0 && cc < 8 && ((r + cc) & 1) && Math.max(Math.abs(dr), Math.abs(dc)) === 2) ring.push(r * 8 + cc);
    }
    ring.forEach((q, i) => {
      const p = u.at(q);
      const cr = u.sprite('crystal', u.layers.vfxOver, { x: p.x, y: p.y + sq * 0.35, ax: 0.5, ay: 1, tint: 0xffc56a });
      u.vx.run(1500, (e, k) => {
        const g = Ease.outBack(clamp01((k - i * 0.03) / 0.25));
        u.vx.fitW(cr, sq * 0.42, sq * 0.95 * Math.max(0.01, g));
        cr.alpha = k > 0.82 ? 1 - (k - 0.82) / 0.18 : 1;
      }, { end: () => u.vx.free(cr) });
    });
    await u.wait(380);
    for (const t of u.allies) u.fire(t, { fx: false });
    for (const t of u.enemies) {
      const p = u.P(t);
      const sp = u.sprite('rockSpike', u.layers.vfxOverN, { x: p.x, y: p.y + sq * 0.45, ax: 0.5, ay: 1 });
      u.vx.run(520, (e, k) => {
        const up = k < 0.25 ? Ease.outBack(k / 0.25) : 1 - Ease.inQuad(clamp01((k - 0.6) / 0.4));
        u.vx.fitW(sp, sq * 0.7, sq * 1.2 * Math.max(0.01, up));
      }, { end: () => u.vx.free(sp) });
      u.vx.emit('debris', p.x, p.y, { count: 8 });
      await u.hit(t, { fx: false });
      await u.wait(60);
    }
    await u.wait(500);
  },

  async kaede(u) {
    const sq = u.sq;
    const c = u.P(u.caster);
    u.kanji('嵐', c.x, c.y - sq * 1.2, 1.4, 0xff7a3a);
    u.v.sfx('whoosh', { intensity: 1 });
    // maple storm along the four diagonals
    const leaves = [0xff7a3a, 0xffb84a, 0xd93a2a, 0x3be3a0];
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      for (let i = 0; i < u.vx.n(10); i++) {
        const v0 = sq * rand(5, 9);
        u.vx.bits.spawn('leaf', u.layers.vfxOver, { x: c.x, y: c.y, vx: dx * v0 * 0.707 + rand(-30, 30), vy: dy * v0 * 0.707 + rand(-30, 30), drag: 0.8, size: sq * rand(0.2, 0.32), life: rand(0.5, 0.8), tint: leaves[i % 4], vr: rand(-10, 10), flip: 9 });
      }
      fly(u, 'crescent', c, { x: c.x + dx * sq * 3, y: c.y + dy * sq * 3 }, { ms: 380, tint: 0x5cf0b4, w: sq * 0.8, spin: 18 });
    }
    await hitsByDistance(u, u.caster.sq, 110, { base: 60 });
    // the leaves fall afterwards
    const L = u.v.layout;
    for (let i = 0; i < u.vx.n(14); i++) {
      u.vx.bits.spawn('leaf', u.layers.vfxOver, { x: L.x + Math.random() * L.total, y: L.y - sq * rand(0, 0.5), vx: rand(-15, 15), vy: rand(30, 60), size: sq * 0.26, life: rand(1, 1.5), tint: leaves[i % 3], vr: rand(-3, 3), sway: sq * 0.4, flip: 5 });
    }
    await u.wait(500);
  },

  // ------------------------------------------------------------------ Rare
  async torvald(u) {
    const sq = u.sq;
    const c = u.P(u.caster);
    const anvil = u.sprite('anvil', u.layers.vfxOverN, { x: c.x, y: c.y - sq * 4 });
    await u.vx.run(360, (e) => {
      anvil.position.set(c.x, c.y - sq * 4 * (1 - e) - sq * 0.2);
      u.vx.fitW(anvil, sq * 1.3);
    }, { ease: Ease.inQuad });
    u.vx.shockwave(c.x, c.y, { radius: 2, strength: 1, color: 0xff9a4a });
    u.vx.emit('spark', c.x, c.y, { count: 26, color: 0xffb84a });
    u.shake(0.5, 320);
    u.v.sfx('bigImpact', { intensity: 1 });
    u.kanji('鉄', c.x, c.y - sq * 1.2, 1.2, 0xff8a3a);
    u.vx.run(500, (e, k) => {
      anvil.alpha = 1 - k;
    }, { end: () => u.vx.free(anvil) });
    await u.hitAll({ stagger: 50 });
    await u.wait(300);
  },

  async shio(u) {
    const sq = u.sq;
    const c = u.P(u.caster);
    let far = null;
    for (const t of u.enemies) if (!far || sqDist(u.caster.sq, t.sq) > sqDist(u.caster.sq, far.sq)) far = t;
    const end = far ? u.P(far) : { x: c.x, y: c.y - sq * 3 };
    const ang = Math.atan2(end.y - c.y, end.x - c.x);
    const wave = u.sprite('wave', u.layers.vfxOver, { x: c.x, y: c.y, tint: 0x5aa8ff, rot: ang + Math.PI / 2 });
    await u.vx.run(300, (e, k) => u.vx.fitW(wave, sq * 2 * Ease.outBack(k), sq * 1.3 * Ease.outBack(k)));
    u.v.sfx('whoosh', { intensity: 1 });
    const hitAt = u.enemies.map((t) => ({ t, k: Math.hypot(t.x - c.x, t.y - c.y) / Math.max(1, Math.hypot(end.x - c.x, end.y - c.y) + sq * 0.6), done: false }));
    await u.vx.run(520, (e) => {
      const x = c.x + (end.x - c.x + Math.cos(ang) * sq * 0.6) * e;
      const y = c.y + (end.y - c.y + Math.sin(ang) * sq * 0.6) * e;
      wave.position.set(x, y);
      u.vx.bits.spawn('dot', u.layers.vfxOver, { x: x + rand(-sq * 0.5, sq * 0.5), y, vx: rand(-30, 30), vy: -sq * rand(1, 2), ay: sq * 8, size: sq * 0.2, size1: sq * 0.05, life: 0.5, tint: 0xe8fbff });
      for (const h of hitAt) {
        if (!h.done && e >= h.k) {
          h.done = true;
          u.fire(h.t);
        }
      }
    }, { ease: Ease.inQuad, end: () => u.vx.free(wave) });
    await u.wait(260);
  },

  async maren(u) {
    const sq = u.sq;
    const c = u.P(u.caster);
    u.v.sfx('slash', { intensity: 1 });
    const jobs = u.enemies.slice(0, 3).map((t, i) => (async () => {
      await u.wait(i * 110);
      const p = u.P(t);
      const ang = Math.atan2(p.y - c.y, p.x - c.x);
      const rope = u.sprite('streak', u.layers.vfxOverN, { x: c.x, y: c.y, ax: 0, ay: 0.5, tint: 0xd8c8a0, rot: ang });
      const len = Math.hypot(p.x - c.x, p.y - c.y);
      await fly(u, 'harpoon', c, p, { ms: 260, w: sq * 1.1, h: sq * 0.24, layer: u.layers.vfxOverN, trail: (x, y) => u.vx.fitW(rope, Math.hypot(x - c.x, y - c.y), sq * 0.08) });
      u.vx.hitSplash(p, u.el);
      await u.hit(t);
      u.vx.run(300, (e, k) => {
        u.vx.fitW(rope, len * (1 - k), sq * 0.08);
      }, { end: () => u.vx.free(rope) });
    })());
    await Promise.all(jobs);
    await u.hitAll({ stagger: 40 });
    await u.wait(240);
  },

  async mashiro(u) {
    const sq = u.sq;
    const L = u.v.layout;
    for (let i = 0; i < u.vx.n(30); i++) {
      u.vx.bits.spawn(i % 3 ? 'dot' : 'snowflake', u.layers.vfxOver, { x: L.x + Math.random() * L.total, y: L.y - sq * rand(0, 1.5), vx: rand(-10, 10), vy: rand(25, 55), size: sq * rand(0.12, 0.26), life: rand(1.1, 1.6), tint: 0xffffff, sway: sq * 0.25, vr: rand(-1, 1), alpha: 0.9 });
    }
    u.v.sfx('sparkle', { intensity: 0.8 });
    await u.wait(380);
    for (const g of u.groups) {
      if (g.done) continue;
      const t = u.v.piece(g.target);
      if (t && t.side === u.caster.side) u.vx.healPop(t);
      await u.v.applyGroup(g);
      await u.wait(60);
    }
    await u.wait(300);
  },

  async iskra(u) {
    const sq = u.sq;
    let prev = u.P(u.caster);
    const order = u.groups.filter((g) => !g.done);
    for (const g of order) {
      const t = u.v.piece(g.target);
      if (!t) continue;
      const p = u.P(t);
      await fly(u, 'orb', prev, p, { ms: 200, w: sq * 0.7, arc: sq * 0.6, rotate: false, trail: (x, y) => u.vx.emit('spark', x, y, { count: 1, color: 0xc49bff, speed: 0.4 }) });
      u.vx.lightning(prev.x, prev.y, p.x, p.y, { color: 0xc49bff, duration: 200, branches: 1 });
      u.vx.pulse('stamp', u.layers.vfxOverN, { x: p.x + sq * 0.15, y: p.y - sq * 0.15, w0: sq * 1.2, w1: sq * 0.55, ms: 520, alpha: 1, fadeAt: 0.7, rot: -0.3, ease: Ease.outBack });
      u.v.sfx('zap', { intensity: 0.8 });
      await u.v.applyGroup(g);
      prev = p;
    }
    await u.wait(260);
  },

  async sirin(u) {
    const sq = u.sq;
    u.v.sfx('sparkle', { intensity: 1 });
    for (const t of u.allies) {
      const p = u.P(t);
      for (let i = 0; i < u.vx.n(4); i++) u.vx.bits.spawn('note', u.layers.vfxOver, { x: p.x, y: p.y, orbit: { cx: p.x, cy: p.y, r: sq * 0.5, a: (i / 4) * TAU, vr: 5, grow: sq * 0.2, rise: -sq * 0.6, flat: 0.6 }, size: sq * 0.26, life: 0.9, tint: i % 2 ? 0xd9fff0 : 0x5cf0b4 });
    }
    for (const t of u.enemies) {
      const p = u.P(t);
      u.vx.slash(p.x, p.y, rand(-1, 1), { color: 0x5cf0b4, length: 1.3, width: 0.6, duration: 260 });
    }
    await u.wait(300);
    await u.hitAll({ stagger: 50, fx: false });
    await u.wait(300);
  },

  async falk(u) {
    const sq = u.sq;
    const area = Array.isArray(u.head.area) && u.head.area.length ? u.head.area : u.targets.map((t) => t.sq);
    let cx = 0;
    let cy = 0;
    for (const q of area) {
      const p = u.at(q);
      cx += p.x / area.length;
      cy += p.y / area.length;
    }
    if (!area.length) return;
    const rock = u.sprite('boulder', u.layers.vfxOverN, { x: cx, y: cy - sq * 5 });
    await u.vx.run(380, (e, k) => {
      rock.position.set(cx + sq * 0.6 * (1 - e), cy - sq * 5 * (1 - e));
      u.vx.fitW(rock, sq * (1.1 + 0.5 * e));
      rock.rotation = k * 4;
    }, { ease: Ease.inQuad });
    u.vx.fxCall('crack', cx, cy, { size: 2 * u.v.k, duration: 1500, color: 0x3a2410 });
    u.vx.emit('debris', cx, cy, { count: 20 });
    u.vx.emit('dust', cx, cy, { count: 12, color: 0xe3a13b });
    u.shake(0.55, 360);
    u.v.sfx('bigImpact', { intensity: 1 });
    u.vx.run(300, (e, k) => {
      rock.alpha = 1 - k;
    }, { end: () => u.vx.free(rock) });
    await u.hitAll({ stagger: 50 });
    await u.wait(300);
  },

  async runa(u) {
    const sq = u.sq;
    const wardSqs = u.pre.filter((e) => e.type === 'ward' && e.on).map((e) => e.sq);
    for (const q of wardSqs) {
      const p = u.at(q);
      u.vx.pulse('rune', u.layers.vfxUnder, { x: p.x, y: p.y, tint: 0xe3a13b, w0: sq * 1.6, w1: sq * 0.9, ms: 700, alpha: 1, fadeAt: 0.75, spin: -2 });
    }
    u.v.sfx('power', { intensity: 0.8 });
    await u.wait(360);
    await u.applyPre();
    u.shake(0.3, 260);
    await u.hitAll({ stagger: 60 });
    await u.wait(260);
  },

  async vera(u) {
    const sq = u.sq;
    const c = u.P(u.caster);
    const banner = u.sprite('banner', u.layers.vfxOverN, { x: c.x - sq * 0.35, y: c.y + sq * 0.3, ax: 0.15, ay: 1 });
    u.vx.run(1200, (e, k) => {
      const g = Ease.outBack(clamp01(k / 0.3));
      u.vx.fitW(banner, sq * 0.8, sq * 1.4 * Math.max(0.01, g));
      banner.rotation = Math.sin(k * 8) * 0.04;
      banner.alpha = k > 0.85 ? 1 - (k - 0.85) / 0.15 : 1;
    }, { end: () => u.vx.free(banner) });
    u.vx.pulse('star4', u.layers.vfxOver, { x: c.x, y: c.y, tint: 0xffffff, w0: sq * 0.5, w1: sq * 1.8, ms: 300 });
    u.v.sfx('gong', { intensity: 0.7 });
    await u.wait(300);
    for (const t of u.enemies) {
      const p = u.P(t);
      u.vx.pulse('glowRing', u.layers.vfxOver, { x: p.x, y: p.y, tint: GOLD, w0: sq * 1.8, w1: sq * 1.0, ms: 600, alpha: 1, fadeAt: 0.7 });
      u.v.floatLabel('!', p.x, p.y - sq * 0.75, { colors: [0xffffff, GOLD], size: sq * 0.6, hold: 600, rise: 0.2 });
    }
    await u.hitAll({ stagger: 40, fx: false });
    await u.wait(320);
  },

  async mara(u) {
    const sq = u.sq;
    const t = u.enemies[0] || u.targets[0];
    if (!t) return;
    const c = u.P(u.caster);
    const p = u.P(t);
    await fly(u, 'coin', c, { x: (c.x + p.x) / 2, y: Math.min(c.y, p.y) - sq * 1.2 }, { ms: 320, w: sq * 0.4, rotate: false, spin: 14, layer: u.layers.vfxOverN, ease: Ease.outQuad });
    u.v.sfx('glitch', { intensity: 0.8 });
    const hand = u.sprite('hand', u.layers.vfxOverN, { x: p.x, y: p.y + sq * 0.6, ax: 0.5, ay: 1 });
    await u.vx.run(300, (e, k) => {
      u.vx.fitW(hand, sq * 0.9, sq * 1.1 * Ease.outBack(k));
    });
    u.vx.slash(p.x, p.y, -0.6, { color: 0xb27bff, length: 2, width: 0.9, duration: 300 });
    await u.hit(t, { fx: false });
    u.vx.run(300, (e, k) => {
      hand.alpha = 1 - k;
      hand.y = p.y + sq * 0.6 + sq * 0.5 * k;
    }, { end: () => u.vx.free(hand) });
    stream(u, p, c, { frame: 'star4', tint: GOLD, n: 3, ms: 380, size: 0.35 });
    await u.wait(300);
  },
};

/** Fallback for unknown heroes: the element area on every target. */
async function genericUlt(u) {
  const sqs = u.targets.map((t) => t.sq).filter((q) => q >= 0);
  u.kanji(ULT_KANJI[u.caster.heroId] || u.el.kanji, u.v.layout.cx, u.v.layout.y + u.sq * 1.4, 1.4);
  if (sqs.length) await u.vx.area(u.el.id, u.caster, sqs);
  await u.hitAll({ stagger: 60 });
  await u.wait(300);
}

/** Every implemented cinematic (for tests / the demo). */
export const ULT_IMPLEMENTED = Object.freeze(Object.keys(ULTS));
export { ULTS };
