// FX — effect primitives for EPIC ШАШКИ (ARCHITECTURE.md §4).
//
//   const fx = new FX({ renderer, quality: 'high' });   fx.setMode('epic' | 'classic');
//   await fx.preload();                                   // fonts + common lettering (optional)
//
// Every primitive returns a Promise that resolves when the effect has ended (true) or was
// interrupted by clear() (false). Promises never reject. Long-running ones also get `.stop()`.
// Positions are WORLD coords (renderer.squareCenter etc.) unless an option says `screen: true`.
// World effects run on renderer.clock game time (slow-mo / hit-stop affect them); screen-level
// punctuation (flash, impactFrame, speedLines, chromatic, zoomBlur, bloomPulse, banner, cutIn,
// comboCounter) runs in real time by default — pass { realtime: false } to put them on game time.
// Sizes / speeds scale with renderer.squareSize, so effects read the same on 8×8 and 12×12.
//
// Modes: 'epic' = full power. 'classic' = the elegant subset (soft dust, gold sparkles, light
// ripples, gentle shimmer); punctuation that has no classic counterpart (speedLines, chromatic,
// zoomBlur, menacing, impact frames) degrades to nothing or a soft flash.
// Quality: high (bloom/zoom/godrays, ~1500 particles) · medium (cheap filters only, ~600) ·
// low (no full-screen filters, ~200) — see QUALITY below and filters.js.
//
// Primitives (contract):
//   burst(x, y, { kind, color, count, speed, life, size, angle, spread, layer, screen, realtime })
//       kind: spark dust shards embers energy petals confetti smoke | stars fire debris rain
//       speed / life / size are multipliers; count is the high-quality count (scaled by quality);
//       angle + spread aim the burst (radians); layer 'world' | 'board' | 'screen'; energy: inward, radius
//   shockwave(x, y, { strength, radius (squares), duration, color })
//   flash(color, { duration, alpha, blend: 'add' | 'normal', attack, force })
//   impactFrame({ duration, focus: {x,y} world | screenFocus: {x,y}, lines, threshold })
//       Screen budget (EAD-04): flash / chromatic / zoomBlur / bloomPulse requested while an impact
//       frame runs start right after it (the manga panel stays crisp; flash { force } opts out); a
//       third simultaneous heavy filter kind gets half strength; a flash over a bloom is softened.
//   speedLines({ focus | screenFocus, duration, density, color, style: 'speed'|'focus'|'dash', angle })
//   focusLines(opts)                    = speedLines({ style: 'focus' })
//   shake(intensity, duration, opts)    → camera.shake (×0.35 in classic)
//   slowMo(scale, duration, { inMs, outMs }) / hitStop(ms)   drive renderer.clock through FX's own
//       controller so they compose (hit-stop inside slow-mo returns to the slow-mo, then to 1).
//       Prefer these over calling clock.slowMo / clock.hitStop directly.
//   chromatic(strength, duration)  zoomBlur(x, y, strength, duration)  bloomPulse(strength, duration)
//   lightning(x1, y1, x2, y2, { color, duration, branches, width, sky })
//   slash(x, y, angle, { color, length (squares), duration, width, flip })
//   kanji(text, x, y, { size (px), color, duration, screen, exit: 'shatter'|'slice'|'fade', backdrop:
//         'rays'|'burst'|'none', rotation, delay, realtime, clamp, clampRect, avoid })
//         world kanji are kept inside fx.safeRect (else the screen) EVERY frame, even while the camera
//         moves (clamp: false opts out); avoid() -> screen rect to keep clear of (e.g. the combo counter)
//   banner(text, { sub, color, style: 'epic'|'gold'|'victory'|'defeat'|'classic', duration, y })
//   cutIn({ title, subtitle (wraps to ≤ 2 lines, ≥ 13 px), tag (small gold plate above the band),
//          color, side: 'left'|'right', duration, pieceColor (1|-1), king, y })
//   comboCounter(n, { color, label, hold, side, at: {x, y} screen, fit: max height })
//         (stays up `hold` ms after the last hit; `at`/`fit` put it in a free lane)
//   pillar(x, y, { color, duration, width (squares), spiral, godrays })
//   aura(pieceView, { color, intensity }) -> { stop(), setColor(c), setIntensity(v), promise }
//   afterimages(pieceView, { duration, color, spacing, alpha })
//   crack(x, y, { size (squares), color, duration, seed })
//   menacing(x, y, { text: 'ゴ', count, duration, color })
//   clear()
// Additions:
//   explosion(x, y, { color, size })            fireball + sparks + smoke + ring (+ shockwave)
//   charge(x, y, { color, duration, radius })   energy converging into a point
//   rays(x, y, { color, duration, size, screen }) rotating light-ray burst (victory, awakening)
//   weather(kind, { duration, rate, color })    screen-wide petals/confetti/rain/embers (.stop())
//   grade({ amount, dark, tint, duration, fade }) desaturate/darken the scene (defeat) (.stop())
//   vignette(color, { alpha, duration, fade })
//   hideCombo(), emit(kind, x, y, opts) (raw particles, no promise), sideColor(side)
//   fx.safeRect = { x, y, width, height } | null   screen area free of the DOM HUD (set by the Director)
//   setLang('ru'|'en') (default labels), setQuality(q) (FX only — call renderer.setQuality too),
//   preload(texts?), destroy(), stats() (debug: live effects / particles / nodes / attached filters)
//   new FX({ renderer, quality, mode, textures }) — `textures` lets several FX share one FxTextures.

import { Container, Sprite, Graphics, Texture, TilingSprite } from 'pixi.js';
import { Ease } from '../render/tween.js';
import { mixHex, shadeHex } from '../render/canvas.js';
import { EPIC, CLASSIC } from '../render/palette.js';
import { FxTextures } from './textures.js';
import { ParticleSystem, emitBurst } from './particles.js';
import { FilterManager } from './filters.js';
import * as Anime from './anime.js';

export const QUALITY = {
  high: { cap: 1500, mul: 1, lines: 1 },
  medium: { cap: 600, mul: 0.55, lines: 0.7 },
  low: { cap: 200, mul: 0.3, lines: 0.45 },
};

const TAU = Math.PI * 2;
const KIND_LIFE = {
  spark: 650, stars: 1000, dust: 900, shards: 1100, embers: 1500, energy: 850, petals: 3300,
  confetti: 2600, smoke: 1700, fire: 750, debris: 850, rain: 950,
};

const rand = (a, b) => a + Math.random() * (b - a);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class FX {
  /** opts.textures: share an existing FxTextures (else one is created and owned by this FX). */
  constructor({ renderer, quality = 'high', mode, textures } = {}) {
    this.renderer = renderer;
    this.clock = renderer.clock;
    this.lang = 'ru';
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this._ownTextures = !textures;
    this.textures = textures || new FxTextures(Math.min(3, Math.max(2, Math.max(renderer.resolution || 1, dpr) * 1.25)));
    this.particles = new ParticleSystem({ textures: this.textures, cap: QUALITY.high.cap });
    this.filters = new FilterManager(renderer);
    this._effects = [];
    this._spritePool = [];
    this._auras = [];
    this._gen = 0;
    this._time = { sActive: false, sFrom: 1, sScale: 1, t0: 0, inMs: 0, outMs: 0, holdEnd: 0, hitUntil: 0, applied: null };
    this._tmp = { x: 0, y: 0 };
    this._tmp2 = { x: 0, y: 0 };
    this.combo = null;
    /** real-time end of the running impact frame (screen punctuation waits for it, EAD-04) */
    this._impactUntil = 0;
    /** live heavy full-screen filter effects per kind (rgb / zoom / bloom) */
    this._heavy = { rgb: 0, zoom: 0, bloom: 0 };
    /** optional screen rect (CSS px) kept free of the DOM HUD; kanji are clamped into it */
    this.safeRect = null;

    // containers inside the renderer's FX layers
    const L = renderer.layers;
    const mk = (parent, label) => {
      const c = new Container();
      c.label = label;
      parent.addChild(c);
      return c;
    };
    this.c = {};
    this.c.decals = mk(L.boardFx, 'fx-decals');
    this.pBoard = this.particles.layers(L.boardFx);
    this.c.worldUnder = mk(L.worldFx, 'fx-world-under');
    this.pWorld = this.particles.layers(L.worldFx);
    this.c.worldOver = mk(L.worldFx, 'fx-world-over');
    this.c.screenLines = mk(L.screenFx, 'fx-screen-lines');
    this.pScreen = this.particles.layers(L.screenFx);
    this.c.screenUI = mk(L.screenFx, 'fx-screen-ui');
    this.c.overlay = mk(L.overlay, 'fx-overlay');

    this.env = { epic: true, mul: 1, sq: 40, T: this.textures };
    this.setQuality(quality);
    this.setMode(mode || renderer.theme || 'epic');
    this.clock.add(this._tick, this);
  }

  // ===================================================================== settings
  setMode(mode) {
    this.mode = mode === 'classic' ? 'classic' : 'epic';
    this.epic = this.mode === 'epic';
    this.env.epic = this.epic;
  }

  setQuality(q) {
    this.quality = QUALITY[q] ? q : 'high';
    this.q = QUALITY[this.quality];
    this.particles.setCap(this.q.cap);
    this.filters.setQuality(this.quality);
    this.env.mul = this.q.mul;
  }

  setLang(lang) {
    this.lang = lang === 'en' ? 'en' : 'ru';
  }

  get sq() {
    return this.renderer.squareSize || 40;
  }

  get palette() {
    return this.epic ? EPIC : CLASSIC;
  }

  /** Colour for a side (1 / -1) in the current mode; passes hex colours through. */
  sideColor(side) {
    if (side === 1 || side === -1) return this.epic ? EPIC.side[side] : CLASSIC.gold;
    return side;
  }

  // ===================================================================== runner
  /**
   * Run an effect: { duration (ms; 0/undefined = until update() returns false), delay, realtime,
   * update(dt, t, k) -> false to finish, end(completed) }. Returns a Promise<boolean> with .stop().
   */
  _run(e) {
    e.t = 0;
    e.done = false;
    e.cleanup = e.cleanup || [];
    e.delay = e.delay || 0;
    const p = new Promise((r) => (e._resolve = r));
    p.stop = () => this._finish(e, false);
    p.effect = e;
    this._effects.push(e);
    return p;
  }

  _finish(e, completed) {
    if (e.done) return;
    e.done = true;
    try {
      if (e.end) e.end(completed);
    } catch (err) {
      console.error('[fx] effect end failed', err);
    }
    for (const fn of e.cleanup) {
      try {
        fn();
      } catch (err) {
        console.error('[fx] cleanup failed', err);
      }
    }
    e.cleanup.length = 0;
    e._resolve(completed);
  }

  /** A promise that resolves after ms (game or real time), cancelled (false) by clear(). */
  _wait(ms, realtime = false) {
    return this._run({ duration: Math.max(1, ms), realtime });
  }

  _done() {
    const p = Promise.resolve(true);
    p.stop = () => {};
    return p;
  }

  _tick(gdt, rdt) {
    this.env.sq = this.sq;
    this._safe('particles', () => this.particles.update(gdt, rdt));
    const list = this._effects;
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const e = list[i];
      if (e.done) continue;
      let dt = e.realtime ? rdt : gdt;
      if (!e.started) {
        if (e.delay > 0) {
          e.delay -= dt;
          if (e.delay > 0) continue;
          dt = -e.delay;
          e.delay = 0;
        }
        e.started = true;
        if (e.start) {
          try {
            e.start();
          } catch (err) {
            console.error('[fx] effect start failed', err);
          }
        }
      }
      e.t += dt;
      const k = e.duration > 0 ? Math.min(1, e.t / e.duration) : 0;
      let keep = true;
      try {
        keep = e.update ? e.update(dt, e.t, k) !== false : true;
      } catch (err) {
        console.error('[fx] effect update failed', err);
        keep = false;
      }
      if (e.duration > 0 && e.t >= e.duration) keep = false;
      if (!keep) this._finish(e, true);
    }
    let w = 0;
    for (let i = 0; i < list.length; i++) if (!list[i].done) list[w++] = list[i];
    list.length = w;
    this._safe('auras', () => this._updateAuras(gdt, rdt));
    this._safe('filters', () => this.filters.update());
    this._safe('time', () => this._applyTime());
  }

  /** Run one stage of the frame; a throw is logged (rate-limited) and the frame goes on (F2). */
  _safe(where, fn) {
    try {
      fn();
    } catch (err) {
      const now = this.clock.realNow;
      if (!(now - (this._errAt || -1e9) < 1000)) {
        this._errAt = now;
        console.error(`[fx] ${where} update failed`, err);
      }
    }
  }

  // ===================================================================== pools / helpers
  _sprite(tex, parent) {
    let s = this._spritePool.pop();
    if (!s || s.destroyed) s = new Sprite(tex);
    else s.texture = tex;
    s.anchor.set(0.5);
    s.position.set(0, 0);
    s.scale.set(1);
    s.rotation = 0;
    s.skew.set(0, 0);
    s.pivot.set(0, 0);
    s.alpha = 1;
    s.tint = 0xffffff;
    s.blendMode = 'normal';
    s.visible = true;
    if (parent) parent.addChild(s);
    return s;
  }

  _free(s) {
    if (!s || s.destroyed) return;
    s.removeFromParent();
    s.mask = null;
    s.texture = Texture.EMPTY;
    if (this._spritePool.length < 600) this._spritePool.push(s);
    else s.destroy();
  }

  /** Return pooled sprites under `node` to the pool and destroy everything else. */
  _dispose(node) {
    if (!node || node.destroyed) return;
    if (node.constructor === Sprite) {
      this._free(node);
      return;
    }
    const kids = node.children ? node.children.slice() : [];
    for (const k of kids) this._dispose(k);
    node.removeFromParent();
    node.mask = null;
    node.destroy({ children: true });
  }

  _box(parent, label) {
    const c = new Container();
    if (label) c.label = label;
    parent.addChild(c);
    return c;
  }

  /** Text sprite whose texture is released when effect `e` ends. */
  _textSprite(text, style, parent, e, seed) {
    const tex = this.textures.text(text, style, seed);
    const s = this._sprite(tex, parent);
    e.cleanup.push(() => this.textures.releaseText(tex));
    return s;
  }

  _w2s(x, y, out = this._tmp) {
    const r = this.renderer;
    const cam = r.camera;
    const a = r.boardCenter;
    const z = cam.zoom * cam.punchScale;
    const rot = cam.rotation + cam.shakeRot;
    const dx = x - (a.x + cam.ox);
    const dy = y - (a.y + cam.oy);
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    out.x = a.x + cam.shakeX + (dx * cs - dy * sn) * z;
    out.y = a.y + cam.shakeY + (dx * sn + dy * cs) * z;
    return out;
  }

  _s2w(x, y, out = this._tmp2) {
    const r = this.renderer;
    const cam = r.camera;
    const a = r.boardCenter;
    const z = cam.zoom * cam.punchScale || 1;
    const rot = cam.rotation + cam.shakeRot;
    const dx = (x - (a.x + cam.shakeX)) / z;
    const dy = (y - (a.y + cam.shakeY)) / z;
    const cs = Math.cos(-rot);
    const sn = Math.sin(-rot);
    out.x = a.x + cam.ox + dx * cs - dy * sn;
    out.y = a.y + cam.oy + dx * sn + dy * cs;
    return out;
  }

  get zoom() {
    const cam = this.renderer.camera;
    return cam.zoom * cam.punchScale;
  }

  _pl(layer) {
    return layer === 'board' ? this.pBoard : layer === 'screen' ? this.pScreen : this.pWorld;
  }

  /** Raw particle emission for advanced callers: fx.emit('spark', x, y, opts). */
  emit(kind, x, y, o = {}) {
    const layer = o.screen ? 'screen' : o.layer || (kind === 'dust' || kind === 'debris' ? 'board' : 'world');
    this.env.sq = this.sq;
    emitBurst(this.particles, this._pl(layer), kind, x, y, o, this.env);
  }

  // ===================================================================== particles
  burst(x, y, o = {}) {
    const kind = o.kind || 'spark';
    this.emit(kind, x, y, o);
    return this._wait((KIND_LIFE[kind] || 800) * (o.life || 1), !!o.realtime);
  }

  // ===================================================================== shockwave
  shockwave(x, y, o = {}) {
    const sq = this.sq;
    const strength = o.strength != null ? o.strength : 1;
    const epic = this.epic;
    const R = (o.radius != null ? o.radius : epic ? 3.2 : 1.6) * sq;
    const duration = o.duration || (epic ? 560 : 650);
    const color = o.color != null ? o.color : epic ? 0xbfe9ff : 0xfff1d0;
    const box = this._box(this.c.worldUnder, 'shockwave');
    const ring = this._sprite(this.textures.frame('ring'), box);
    ring.blendMode = 'add';
    ring.tint = epic ? mixHex(color, 0xffffff, 0.35) : color;
    const soft = epic ? this._sprite(this.textures.frame('ringSoft'), box) : null;
    if (soft) {
      soft.blendMode = 'add';
      soft.tint = color;
    }
    const core = epic ? this._sprite(this.textures.frame('dot'), box) : null;
    if (core) {
      core.blendMode = 'add';
      core.tint = mixHex(color, 0xffffff, 0.5);
    }
    let ripple2 = null;
    if (!epic) {
      ripple2 = this._sprite(this.textures.frame('ring'), box);
      ripple2.blendMode = 'add';
      ripple2.tint = color;
      ripple2.alpha = 0;
    }
    box.position.set(x, y);
    const RING_R = 56; // radius of the ring peak in the 128px texture
    let h = null;
    if (epic || this.quality === 'high') h = this.filters.shockwave();
    const z0 = this.zoom;
    if (h) {
      const f = h.filter;
      f.amplitude = (epic ? 13 : 5) * Math.min(1.4, strength);
      f.wavelength = Math.max(32, sq * (epic ? 1.15 : 0.9)) * z0;
      f.brightness = epic ? 1 + 0.18 * strength : 1;
      // the distortion ring outruns the sprite ring a little: a crisp, fast ripple
      f.radius = R * z0 * 1.1;
      f.speed = (R * z0 * 1.1) / ((duration * 0.75) / 1000);
      f.time = 0;
    }
    return this._run({
      duration,
      update: (dt, t, k) => {
        const e = Ease.outCubic(k);
        const rr = (0.12 + 0.88 * e) * R;
        ring.scale.set(rr / RING_R);
        ring.alpha = (epic ? 1 : 0.55) * Math.pow(1 - k, 1.4) * Math.min(1, strength);
        if (soft) {
          const e2 = Ease.outCubic(Math.max(0, k - 0.04) / 0.96);
          soft.scale.set(((0.08 + 0.85 * e2) * R) / RING_R);
          soft.alpha = 0.7 * Math.pow(1 - k, 1.8) * Math.min(1, strength);
        }
        if (core) {
          const kk = Math.min(1, k / 0.35);
          core.scale.set((sq * (1.8 - kk) * Math.min(1.6, strength)) / 64);
          core.alpha = 0.9 * (1 - kk);
        }
        if (ripple2) {
          const k2 = Math.max(0, (k - 0.18) / 0.82);
          ripple2.scale.set(((0.1 + 0.6 * Ease.outCubic(k2)) * R) / RING_R);
          ripple2.alpha = k2 > 0 ? 0.35 * Math.pow(1 - k2, 1.5) : 0;
        }
        if (h) {
          h.filter.time = t / 1000;
          const p = this._w2s(x, y);
          h.filter.centerX = p.x;
          h.filter.centerY = p.y;
        }
      },
      end: () => {
        if (h) h.release();
        this._dispose(box);
      },
    });
  }

  // ===================================================================== flash / vignette
  flash(color = 0xffffff, o = {}) {
    const scr = this.renderer.screen;
    const s = this._sprite(Texture.WHITE, this.c.overlay);
    s.anchor.set(0);
    s.width = scr.width + 4;
    s.height = scr.height + 4;
    s.position.set(-2, -2);
    s.tint = color;
    const blend = o.blend || (this.epic ? 'add' : 'normal');
    s.blendMode = blend;
    let peak = (o.alpha != null ? o.alpha : this.epic ? 0.85 : 0.35) * (this.epic ? 1 : 0.6);
    const attack = o.attack != null ? o.attack : 0.12;
    s.alpha = 0;
    // a flash never lands on an impact frame (it would white out the manga panel): it waits for it
    const gate = o.force ? { delay: 0, k: 1 } : this._screenGate(null);
    return this._run({
      duration: o.duration || 200,
      delay: gate.delay,
      realtime: o.realtime !== false,
      start: () => {
        // bloom already glowing: a full-strength additive flash on top only washes the frame out
        if (this._heavy.bloom > 0 && blend === 'add') peak *= 0.6;
      },
      update: (dt, t, k) => {
        s.alpha = peak * (k < attack ? k / attack : Math.pow(1 - (k - attack) / (1 - attack), 2));
      },
      end: () => this._free(s),
    });
  }

  /**
   * Full-screen punctuation budget (EAD-04): effects requested while an impact frame runs start
   * right after it (the inverted panel must stay crisp), and a third simultaneous heavy filter
   * kind (rgb / zoom / bloom) only gets half strength. Returns { delay (ms), k (strength mul) }.
   */
  _screenGate(kind) {
    const now = this.clock.realNow;
    const delay = this._impactUntil > now ? this._impactUntil - now : 0;
    let others = 0;
    for (const key of ['rgb', 'zoom', 'bloom']) if (key !== kind && this._heavy[key] > 0) others++;
    return { delay, k: others >= 2 ? 0.5 : 1 };
  }

  /** Run a heavy full-screen filter effect through the gate; `make(h, k)` returns the updater. */
  _heavyRun(kind, duration, o, make) {
    const gate = this._screenGate(kind);
    let h = null;
    let counted = false;
    let upd = null;
    return this._run({
      duration,
      delay: gate.delay,
      realtime: o.realtime !== false,
      start: () => {
        h = this.filters.request(kind);
        if (!h) return;
        this._heavy[kind]++;
        counted = true;
        const g2 = this._screenGate(kind);
        upd = make(h, Math.min(gate.k, g2.k));
      },
      update: (dt, t, k) => {
        if (upd) upd(dt, t, k);
      },
      end: () => {
        if (counted) this._heavy[kind] = Math.max(0, this._heavy[kind] - 1);
        if (h) h.release();
      },
    });
  }

  vignette(color = 0x000000, o = {}) {
    const scr = this.renderer.screen;
    const s = this._sprite(this.textures.vignette(), this.c.overlay);
    s.anchor.set(0.5);
    s.position.set(scr.width / 2, scr.height / 2);
    s.width = scr.width * 1.15;
    s.height = scr.height * 1.15;
    s.tint = color;
    const peak = o.alpha != null ? o.alpha : 0.7;
    const fade = o.fade != null ? o.fade : 250;
    const dur = o.duration || 1200;
    s.alpha = 0;
    return this._run({
      duration: dur,
      realtime: o.realtime !== false,
      update: (dt, t) => {
        const a = Math.min(1, t / fade, (dur - t) / fade);
        s.alpha = peak * clamp01(a);
      },
      end: () => this._free(s),
    });
  }

  // ===================================================================== camera / time
  shake(intensity = 0.3, duration = 380, opts) {
    const k = this.epic ? 1 : 0.35;
    this.renderer.camera.shake(intensity * k, duration, opts);
    return this._wait(duration, true);
  }

  /**
   * Slow motion: ease into `scale` (inMs), hold `duration`, ease back to 1 (outMs) — all real time.
   * FX owns the time scale while slow-mo / hit-stop run, so they compose: a hit-stop inside a
   * slow-mo freezes, then returns to the slow-mo, which still eases back to 1 (the raw
   * Clock.slowMo / hitStop pair drops the restore when they overlap). A new slowMo replaces the
   * previous one, starting from the current slow-mo value.
   */
  slowMo(scale = 0.3, duration = 600, o = {}) {
    if (!this.epic) scale = Math.max(0.5, scale);
    const T = this._time;
    const now = this.clock.realNow;
    T.sFrom = this._slowValue(now);
    T.sScale = Math.max(0.02, scale);
    T.t0 = now;
    T.inMs = o.inMs != null ? o.inMs : 120;
    T.outMs = o.outMs != null ? o.outMs : 260;
    T.holdEnd = now + T.inMs + duration;
    T.sActive = true;
    this._applyTime();
    return this._wait(T.inMs + duration + T.outMs, true);
  }

  /** Freeze game time for `ms` real milliseconds (composes with slowMo, see above). */
  hitStop(ms = 90) {
    if (!this.epic) ms *= 0.5;
    const T = this._time;
    T.hitUntil = Math.max(T.hitUntil, this.clock.realNow + ms);
    this._applyTime();
    return this._wait(ms, true);
  }

  _slowValue(now) {
    const T = this._time;
    if (!T.sActive) return 1;
    if (now < T.t0 + T.inMs) return T.sFrom + (T.sScale - T.sFrom) * Ease.inOutQuad((now - T.t0) / T.inMs);
    if (now < T.holdEnd) return T.sScale;
    if (now < T.holdEnd + T.outMs) return T.sScale + (1 - T.sScale) * Ease.inOutQuad((now - T.holdEnd) / T.outMs);
    T.sActive = false;
    return 1;
  }

  _applyTime() {
    const T = this._time;
    if (!T.sActive && !T.hitUntil && T.applied == null) return;
    const now = this.clock.realNow;
    let v = this._slowValue(now);
    if (T.hitUntil && now < T.hitUntil) v = 0.02;
    else T.hitUntil = 0;
    if (v !== T.applied) {
      this.clock.setScale(v, 0);
      T.applied = v;
    }
    if (!T.sActive && !T.hitUntil) T.applied = null; // back at 1: release control
  }

  _resetTime() {
    const T = this._time;
    if (T.applied != null) this.clock.setScale(1, 0);
    T.sActive = false;
    T.hitUntil = 0;
    T.applied = null;
  }

  // ===================================================================== full-screen filters
  chromatic(strength = 1, duration = 320, o = {}) {
    if (!this.epic || !this.filters.can('rgb')) return this._done();
    const scr = this.renderer.screen;
    const px0 = 7 * strength * Math.max(0.8, Math.min(1.8, Math.min(scr.width, scr.height) / 390));
    return this._heavyRun('rgb', duration, o, (h, gk) => {
      const px = px0 * gk;
      let jitT = 0;
      h.angle = Math.random() * TAU;
      return (dt, t, k) => {
        jitT -= dt;
        if (jitT <= 0) {
          jitT = 34;
          h.angle = (Math.random() - 0.5) * 0.9 + (Math.random() < 0.5 ? 0 : Math.PI);
        }
        h.strength = px * Math.pow(1 - k, 1.6);
      };
    });
  }

  zoomBlur(x, y, strength = 0.22, duration = 360, o = {}) {
    if (!this.epic) return this._done();
    if (!this.filters.can('zoom')) {
      return this.speedLines({ focus: { x, y }, duration, density: 0.6, style: 'speed', realtime: o.realtime });
    }
    return this._heavyRun('zoom', duration, o, (h, gk) => (dt, t, k) => {
      const p = this._w2s(x, y);
      h.x = p.x;
      h.y = p.y;
      h.amount = this.sq * 0.7 * this.zoom;
      const env = k < 0.12 ? k / 0.12 : Math.pow(1 - (k - 0.12) / 0.88, 1.5);
      h.strength = strength * gk * env;
    });
  }

  bloomPulse(strength = 1, duration = 520, o = {}) {
    const s = this.epic ? strength : strength * 0.35;
    if (!this.filters.can('bloom')) {
      if (!this.epic) return this._done();
      return this.flash(0xffffff, { alpha: 0.12 * strength, duration, blend: 'add', attack: 0.25 });
    }
    return this._heavyRun('bloom', duration, o, (h, gk) => (dt, t, k) => {
      const env = k < 0.2 ? Ease.outCubic(k / 0.2) : Math.pow(1 - (k - 0.2) / 0.8, 2);
      h.strength = 1.6 * s * gk * env;
    });
  }

  /** Desaturate / darken / tint the scene (defeat mood). Returns a promise with .stop(). */
  grade(o = {}) {
    const amount = o.amount != null ? o.amount : 0.85;
    const dark = o.dark != null ? o.dark : 0.3;
    const tint = o.tint != null ? o.tint : 0xc8d4ff;
    const dur = o.duration || 2500;
    const fade = o.fade != null ? o.fade : 400;
    const h = this.filters.request('grade');
    let s = null;
    if (!h) {
      const scr = this.renderer.screen;
      s = this._sprite(Texture.WHITE, this.c.overlay);
      s.anchor.set(0);
      s.width = scr.width;
      s.height = scr.height;
      s.tint = 0x0a0c18;
    }
    return this._run({
      duration: dur,
      realtime: o.realtime !== false,
      update: (dt, t) => {
        const a = clamp01(Math.min(t / fade, (dur - t) / fade));
        if (h) {
          h.amount = amount * a;
          h.dark = dark * a;
          h.tint = tint;
        } else s.alpha = 0.45 * dark * 2 * a;
      },
      end: () => {
        if (h) h.release();
        if (s) this._free(s);
      },
    });
  }

  // ===================================================================== lightning
  lightning(x1, y1, x2, y2, o = {}) {
    const epic = this.epic;
    const sq = this.sq;
    const color = o.color != null ? o.color : epic ? 0x8fe9ff : CLASSIC.goldLight;
    const duration = o.duration || (epic ? 440 : 360);
    const branches = epic ? (o.branches != null ? o.branches : 3) : 0;
    const wmul = (o.width || 1) * Math.max(0.7, Math.min(1.6, sq / 42));
    if (epic && o.sky) this.renderer.lightning();
    const box = this._box(this.c.worldUnder, 'lightning');
    const g = new Graphics();
    g.blendMode = 'add';
    box.addChild(g);
    const ends = [];
    if (epic) {
      for (const [px, py, s] of [[x1, y1, 0.9], [x2, y2, 1.3]]) {
        const d = this._sprite(this.textures.frame('dot'), box);
        d.blendMode = 'add';
        d.tint = color;
        d.position.set(px, py);
        d.scale.set((sq * 1.6 * s) / 64);
        const c = this._sprite(this.textures.frame('core'), box);
        c.blendMode = 'add';
        c.position.set(px, py);
        c.scale.set((sq * 0.9 * s) / 32);
        ends.push(d, c);
      }
    }
    const build = () => {
      const paths = [];
      const main = boltPath(x1, y1, x2, y2, 5, epic ? 0.2 : 0.08);
      paths.push({ pts: main, w: 1 });
      const len = Math.hypot(x2 - x1, y2 - y1);
      const ang = Math.atan2(y2 - y1, x2 - x1);
      for (let b = 0; b < branches; b++) {
        const n = main.length / 2;
        const i = Math.floor(n * rand(0.15, 0.75));
        const bx = main[i * 2];
        const by = main[i * 2 + 1];
        const a = ang + (Math.random() < 0.5 ? -1 : 1) * rand(0.35, 0.85);
        const bl = len * rand(0.18, 0.42);
        const ex = bx + Math.cos(a) * bl;
        const ey = by + Math.sin(a) * bl;
        const bp = boltPath(bx, by, ex, ey, 4, 0.25);
        paths.push({ pts: bp, w: 0.55 });
        if (Math.random() < 0.4) {
          const j = Math.floor((bp.length / 2) * rand(0.3, 0.7));
          const a2 = a + (Math.random() < 0.5 ? -1 : 1) * rand(0.3, 0.7);
          const l2 = bl * rand(0.3, 0.55);
          paths.push({ pts: boltPath(bp[j * 2], bp[j * 2 + 1], bp[j * 2] + Math.cos(a2) * l2, bp[j * 2 + 1] + Math.sin(a2) * l2, 3, 0.25), w: 0.35 });
        }
      }
      g.clear();
      const layers = epic
        ? [
            [20, color, 0.09],
            [9, color, 0.24],
            [4.2, mixHex(color, 0xffffff, 0.4), 0.85],
            [1.8, 0xffffff, 1],
          ]
        : [
            [4, color, 0.18],
            [1.4, mixHex(color, 0xffffff, 0.5), 0.85],
          ];
      for (const [w, c, a] of layers) {
        for (const p of paths) {
          const pts = p.pts;
          g.moveTo(pts[0], pts[1]);
          for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
          g.stroke({ width: Math.max(0.6, w * p.w * wmul), color: c, alpha: a, join: 'round', cap: 'round' });
        }
      }
    };
    build();
    const FLICK = [1, 0.25, 1, 0.85, 0.35, 1, 0.7, 1, 0.5];
    let regen = 0;
    let fi = 0;
    let ft = 0;
    if (epic) this.emit('spark', x2, y2, { count: 14, color, speed: 0.9 });
    return this._run({
      duration,
      update: (dt, t, k) => {
        regen -= dt;
        if (regen <= 0 && k < 0.7) {
          regen = epic ? 55 : 80;
          build();
        }
        ft += dt;
        if (ft > 32) {
          ft = 0;
          fi = (fi + 1) % FLICK.length;
        }
        const fade = k < 0.6 ? 1 : Math.pow(1 - (k - 0.6) / 0.4, 1.5);
        const a = (epic ? FLICK[fi] : 1) * fade;
        g.alpha = a;
        for (const s of ends) s.alpha = a * 0.9;
      },
      end: () => this._dispose(box),
    });
  }

  // ===================================================================== slash
  slash(x, y, angle = -0.6, o = {}) {
    const epic = this.epic;
    const sq = this.sq;
    const color = o.color != null ? o.color : epic ? 0x29e6ff : CLASSIC.goldLight;
    const L = (o.length != null ? o.length : epic ? 3.4 : 2) * sq;
    const W = (o.width != null ? o.width : 1) * sq * (epic ? 0.42 : 0.13);
    const duration = o.duration || (epic ? 380 : 320);
    const side = o.flip ? -1 : 1;
    // circle through the chord ends with sagitta h
    const hS = L * 0.17;
    const R = (L * L) / 4 / (2 * hS) + hS / 2;
    const phi = Math.asin(Math.min(1, L / 2 / R));
    const nx = -Math.sin(angle) * side;
    const ny = Math.cos(angle) * side;
    // centre lies opposite the bulge (bulge towards +n)
    const cx = x - nx * (R - hS);
    const cy = y - ny * (R - hS);
    const base = Math.atan2(ny, nx);
    const dirSign = side; // sweep direction along the chord
    const box = this._box(this.c.worldOver, 'slash');
    const g = new Graphics();
    g.blendMode = 'add';
    box.addChild(g);
    const N = 34;
    const layers = epic
      ? [
          { out: 0.55, inn: 1.9, color, alpha: 0.32 },
          { out: 0.05, inn: 1.0, color: mixHex(color, 0xffffff, 0.35), alpha: 0.95 },
          { out: -0.08, inn: 0.42, color: 0xffffff, alpha: 1 },
        ]
      : [
          { out: 0.3, inn: 1.3, color, alpha: 0.35 },
          { out: 0, inn: 0.55, color: 0xffffff, alpha: 0.85 },
        ];
    const arcPt = (u, r) => {
      const th = base + dirSign * (-phi + 2 * phi * u);
      return [cx + Math.cos(th) * r, cy + Math.sin(th) * r];
    };
    let flare = null;
    if (epic) {
      flare = this._sprite(this.textures.frame('flare'), box);
      flare.blendMode = 'add';
      flare.position.set(x, y);
      flare.rotation = angle;
      flare.alpha = 0;
    }
    let lastHead = 0;
    const draw = (tail, head, wm) => {
      g.clear();
      if (head - tail < 0.004 || wm <= 0.01) return;
      for (const ly of layers) {
        const pts = [];
        const inner = [];
        for (let i = 0; i <= N; i++) {
          const u = tail + ((head - tail) * i) / N;
          const v = i / N;
          const prof = (Math.pow(v, 1.2) * Math.pow(1 - v, 0.35)) / 0.437;
          const w = W * wm * prof;
          const o1 = arcPt(u, R + w * ly.out);
          const o2 = arcPt(u, R - w * ly.inn);
          pts.push(o1[0], o1[1]);
          inner.push(o2[0], o2[1]);
        }
        for (let i = inner.length - 2; i >= 0; i -= 2) pts.push(inner[i], inner[i + 1]);
        g.poly(pts, true).fill({ color: ly.color, alpha: ly.alpha });
      }
    };
    return this._run({
      duration,
      update: (dt, t, k) => {
        const head = Ease.outCubic(Math.min(1, k / 0.34));
        const tail = Ease.inCubic(clamp01((k - 0.1) / 0.9)) * 0.999;
        const wm = k < 0.45 ? 1 : Math.pow(1 - (k - 0.45) / 0.55, 0.6);
        draw(tail, Math.max(head, tail + 0.001), wm);
        if (flare) {
          const fk = clamp01((k - 0.12) / 0.45);
          const fa = fk <= 0 ? 0 : Math.sin(Math.PI * Math.min(1, fk));
          flare.alpha = fa;
          flare.scale.set(((L * 2.4) / 128) * (0.6 + 0.4 * fk), (sq * 0.5 * (1 - fk * 0.7)) / 24);
        }
        if (epic && head > lastHead + 0.02 && head < 0.99) {
          const p = arcPt(head, R - W * 0.3);
          const tang = base + dirSign * (-phi + 2 * phi * head) + (Math.PI / 2) * dirSign;
          this.emit('spark', p[0], p[1], { count: 2, color, angle: tang, spread: 0.8, speed: 0.6, life: 0.7 });
          lastHead = head;
        }
      },
      end: () => this._dispose(box),
    });
  }

  // ===================================================================== pillar of light
  pillar(x, y, o = {}) {
    const epic = this.epic;
    const sq = this.sq;
    const color = o.color != null ? o.color : epic ? EPIC.gold : CLASSIC.goldLight;
    const duration = o.duration || (epic ? 1700 : 1500);
    const W = (o.width != null ? o.width : epic ? 1.35 : 0.8) * sq;
    const T = this.textures;
    const box = this._box(this.c.worldOver, 'pillar');
    const under = this._box(this.c.worldUnder, 'pillar-base');
    const beamTex = T.frame('beam');
    const outer = this._sprite(beamTex, box);
    outer.anchor.set(0.5, 0);
    outer.blendMode = 'add';
    outer.tint = color;
    const core = this._sprite(beamTex, box);
    core.anchor.set(0.5, 0);
    core.blendMode = 'add';
    core.tint = mixHex(color, 0xffffff, 0.75);
    let flow = null;
    if (epic) {
      flow = new TilingSprite({ texture: T.beamFlow(), width: 64, height: 256 });
      flow.anchor.set(0.5, 0);
      flow.blendMode = 'add';
      flow.tint = mixHex(color, 0xffffff, 0.4);
      box.addChild(flow);
    }
    const glow = this._sprite(T.frame('dot'), under);
    glow.blendMode = 'add';
    glow.tint = color;
    glow.position.set(x, y);
    const rays = epic ? this._sprite(T.rays(), under) : null;
    if (rays) {
      rays.blendMode = 'add';
      rays.tint = color;
      rays.position.set(x, y);
      rays.alpha = 0;
    }
    const rings = [];
    if (epic) {
      for (let i = 0; i < 3; i++) {
        const r = this._sprite(T.frame('ring'), under);
        r.blendMode = 'add';
        r.tint = mixHex(color, 0xffffff, 0.3);
        r.position.set(x, y);
        r.alpha = 0;
        rings.push(r);
      }
    }
    let god = null;
    if (epic && o.godrays !== false) god = this.filters.godray();
    const strike = epic ? 120 : 260;
    let struck = false;
    let emitAcc = 0;
    const spiral = epic && o.spiral !== false;
    const fadeStart = 0.68;
    const top = { x: 0, y: 0 };
    return this._run({
      duration,
      update: (dt, t, k) => {
        // beam reaches from above the top of the screen down to the target
        const ps = this._w2s(x, y, this._tmp);
        const topW = this._s2w(ps.x, -40, top);
        const fullH = Math.max(sq, y - topW.y);
        const grow = epic ? Ease.inQuad(Math.min(1, t / strike)) : Ease.outCubic(Math.min(1, t / strike));
        const h = fullH * grow;
        const y0 = y - fullH;
        let wk;
        if (k < fadeStart) wk = 1 + 0.06 * Math.sin(t * 0.05) + 0.04 * Math.sin(t * 0.13);
        else wk = Math.pow(1 - (k - fadeStart) / (1 - fadeStart), 1.6);
        const a = k < fadeStart ? 1 : wk;
        const tw = epic ? 1 : 0.9;
        outer.position.set(x, y0);
        outer.width = W * 2.6 * wk * tw;
        outer.height = h + sq * 0.2;
        outer.alpha = (epic ? 0.75 : 0.32) * a;
        core.position.set(x, y0);
        core.width = W * 0.8 * wk * (struck ? 1 : 0.6);
        core.height = h + sq * 0.15;
        core.alpha = (epic ? 1 : 0.5) * a;
        if (flow) {
          flow.position.set(x, y0);
          flow.width = W * 1.3 * wk;
          flow.height = h;
          flow.tilePosition.y -= dt * 1.1;
          flow.alpha = 0.55 * a;
        }
        if (!struck && t >= strike) {
          struck = true;
          if (epic) {
            this.emit('spark', x, y, { count: 30, color, speed: 1.2 });
            this.emit('dust', x, y, { count: 12, color: mixHex(color, 0x5a4a8a, 0.5) });
          } else {
            this.emit('stars', x, y, { count: 8, color, radius: 0.6 });
          }
        }
        const sk = struck ? Math.min(1, (t - strike) / 200) : 0;
        const g0 = struck ? 1.9 - 0.9 * sk : 0.5 * grow;
        glow.scale.set((W * 2.4 * g0 * wk) / 64, (W * 1.3 * g0 * wk) / 64);
        glow.alpha = (epic ? 0.95 : 0.4) * a;
        if (rays) {
          rays.rotation += dt * 0.0006;
          rays.scale.set((sq * 5.2 * (0.6 + 0.4 * sk) * wk) / 256);
          rays.alpha = 0.55 * sk * a;
        }
        for (let i = 0; i < rings.length; i++) {
          const rk = struck ? ((t - strike) / 650 + i / rings.length) % 1 : 0;
          const r = rings[i];
          const rr = sq * (0.3 + 2.3 * Ease.outCubic(rk));
          r.scale.set(rr / 56, (rr * 0.55) / 56);
          r.alpha = struck && k < 0.9 ? 0.6 * (1 - rk) * a : 0;
        }
        if (god) {
          const f = god.filter;
          f.time += dt / 1000;
          f.centerX = ps.x;
          f.centerY = -this.renderer.screen.height * 0.15;
          f.alpha = 0.55 * a * Math.min(1, t / 250);
          f.gain = 0.5;
        }
        // rising particles inside the beam (+ helix)
        if (struck && k < 0.85) {
          emitAcc += (dt / 1000) * (epic ? 60 : 14) * this.q.mul;
          while (emitAcc >= 1) {
            emitAcc -= 1;
            this._pillarParticle(x, y, W, color, spiral);
          }
        }
      },
      end: () => {
        if (god) god.release();
        this._dispose(box);
        this._dispose(under);
      },
    });
  }

  _pillarParticle(x, y, W, color, spiral) {
    const sq = this.sq;
    const T = this.textures;
    const ps = this.particles;
    const L = this.pWorld;
    if (!this.epic) {
      const p = ps.spawn(L.add, T.frame('star'));
      if (!p) return;
      p.x = x + (Math.random() - 0.5) * W * 0.8;
      p.y = y - Math.random() * sq;
      p.vy = -sq * rand(0.8, 1.8);
      p.life = rand(0.8, 1.4);
      p.sEase = 2;
      p.s1 = (rand(0.25, 0.45) * sq) / 64;
      p.vr = rand(-2, 2);
      p.colors(0xffffff, color, color);
      return;
    }
    if (spiral && Math.random() < 0.5) {
      const p = ps.spawn(L.add, T.frame(Math.random() < 0.5 ? 'wisp' : 'dot'));
      if (!p) return;
      p.orb = true;
      p.ox = x;
      p.oy = y + sq * 0.1;
      p.oa = Math.random() * TAU;
      p.or = W * rand(0.55, 0.8);
      p.ova = rand(6, 9);
      p.ovy = -sq * rand(3.5, 6);
      p.oys = 0.32;
      p.depth = 1;
      p.align = true;
      p.life = rand(0.6, 1.0);
      p.s0 = (rand(0.4, 0.6) * sq) / 64;
      p.s1 = p.s0 * 0.4;
      p.fin = 0.1;
      p.colors(0xffffff, color, shadeHex(color, 0.6), 0.5);
      return;
    }
    const p = ps.spawn(L.add, T.frame('spark'));
    if (!p) return;
    p.x = x + (Math.random() - 0.5) * W * 1.1;
    p.y = y - Math.random() * sq * 2;
    p.vx = (Math.random() - 0.5) * sq * 0.3;
    p.vy = -sq * rand(5, 11);
    p.align = true;
    p.stretch = 0.15 / sq;
    p.life = rand(0.3, 0.6);
    p.s0 = (rand(0.25, 0.4) * sq) / 64;
    p.s1 = p.s0 * 0.4;
    p.colors(0xffffff, mixHex(color, 0xffffff, 0.3), color, 0.4);
  }

  // ===================================================================== rays / charge / explosion
  rays(x, y, o = {}) {
    const color = o.color != null ? o.color : this.epic ? EPIC.gold : CLASSIC.goldLight;
    const dur = o.duration || 1400;
    const parent = o.screen ? this.c.screenLines : this.c.worldUnder;
    const size = (o.size != null ? o.size : o.screen ? 1.4 * Math.max(this.renderer.screen.width, this.renderer.screen.height) : 6 * this.sq) / 256;
    const a = this._sprite(this.textures.rays(), parent);
    const b = this._sprite(this.textures.rays(), parent);
    for (const s of [a, b]) {
      s.blendMode = 'add';
      s.tint = color;
      s.position.set(x, y);
      s.alpha = 0;
    }
    b.tint = mixHex(color, 0xffffff, 0.5);
    const peak = o.alpha != null ? o.alpha : this.epic ? 0.8 : 0.28;
    return this._run({
      duration: dur,
      realtime: !!o.realtime,
      update: (dt, t, k) => {
        const env = k < 0.15 ? Ease.outCubic(k / 0.15) : k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
        a.rotation = t * 0.00035;
        b.rotation = -t * 0.0005 + 0.3;
        a.scale.set(size * (0.7 + 0.3 * env));
        b.scale.set(size * 0.75 * (0.7 + 0.3 * env));
        a.alpha = peak * env;
        b.alpha = peak * 0.6 * env;
      },
      end: () => {
        this._free(a);
        this._free(b);
      },
    });
  }

  charge(x, y, o = {}) {
    const sq = this.sq;
    const color = o.color != null ? o.color : this.epic ? EPIC.white : CLASSIC.goldLight;
    const dur = o.duration || 700;
    const R = (o.radius != null ? o.radius : 1.8) * sq;
    const box = this._box(this.c.worldOver, 'charge');
    const glow = this._sprite(this.textures.frame('dot'), box);
    glow.blendMode = 'add';
    glow.tint = color;
    glow.position.set(x, y);
    const ring = this._sprite(this.textures.frame('ring'), box);
    ring.blendMode = 'add';
    ring.tint = mixHex(color, 0xffffff, 0.4);
    ring.position.set(x, y);
    let acc = 0;
    return this._run({
      duration: dur,
      update: (dt, t, k) => {
        glow.scale.set((sq * (0.4 + 1.6 * k * k)) / 64);
        glow.alpha = (this.epic ? 0.95 : 0.5) * Math.min(1, k * 2);
        const rk = (t / 260) % 1;
        ring.scale.set((R * (1 - Ease.inQuad(rk)) + sq * 0.2) / 56);
        ring.alpha = 0.7 * rk * (this.epic ? 1 : 0.5);
        acc += (dt / 1000) * (this.epic ? 45 : 12) * this.q.mul;
        if (acc >= 1) {
          const n = acc | 0;
          acc -= n;
          this.emit('energy', x, y, { count: n / this.q.mul, color, inward: true, radius: R / sq, life: 0.8 });
        }
      },
      end: () => this._dispose(box),
    });
  }

  explosion(x, y, o = {}) {
    const sq = this.sq;
    const size = o.size || 1;
    const color = o.color != null ? o.color : this.epic ? 0xff7a1f : 0xffd27a;
    if (!this.epic) {
      this.emit('dust', x, y, { count: 14, size });
      this.emit('stars', x, y, { count: 8, color: CLASSIC.goldLight, radius: 0.8 * size });
      return this.shockwave(x, y, { radius: 1.4 * size });
    }
    this.emit('fire', x, y, { count: 26, color, size: size * 1.35, life: 1.25 });
    this.emit('spark', x, y, { count: 34, color: mixHex(color, 0xffd23f, 0.5), speed: 1.2 * size });
    this.emit('debris', x, y, { count: 10, size });
    this.emit('smoke', x, y, { count: 8, size: size * 1.2, life: 1.1 });
    // under the lettering layer: an onomatopoeia popping over a blast must stay readable
    const box = this._box(this.c.worldUnder, 'explosion');
    const flash = this._sprite(this.textures.frame('dot'), box);
    flash.blendMode = 'add';
    flash.position.set(x, y);
    const core = this._sprite(this.textures.frame('core'), box);
    core.blendMode = 'add';
    core.position.set(x, y);
    const p = this._run({
      duration: 420,
      update: (dt, t, k) => {
        const e = Ease.outCubic(Math.min(1, k * 2.5));
        flash.scale.set((sq * size * (1.5 + 2.8 * e)) / 64);
        flash.tint = mixHex(0xffffff, color, Math.min(1, k * 2));
        flash.alpha = Math.pow(1 - k, 1.5);
        core.scale.set((sq * size * 2.2 * (1 - k * 0.6)) / 32);
        core.alpha = Math.max(0, 1 - k * 2);
      },
      end: () => this._dispose(box),
    });
    const s = this.shockwave(x, y, { strength: 1.1 * size, radius: 3.4 * size, color: mixHex(color, 0xffffff, 0.5) });
    return Promise.all([p, s]).then((r) => r[0] && r[1]);
  }

  // ===================================================================== decals
  crack(x, y, o = {}) {
    const sq = this.sq;
    const epic = this.epic;
    const color = o.color != null ? o.color : EPIC.black;
    const size = (o.size != null ? o.size : epic ? 2.8 : 1.15) * sq;
    const dur = o.duration || (epic ? 3200 : 1800);
    const seed = o.seed != null ? o.seed : (Math.random() * 6) | 0;
    const rec = this.textures.crack(seed, { epic, color, size });
    rec.refs = (rec.refs || 0) + 1;
    const box = this._box(this.c.decals, 'crack');
    box.position.set(x, y);
    box.rotation = Math.random() * TAU;
    const base = this._sprite(rec.base, box);
    const baseA = epic ? 1 : 0.38;
    base.alpha = baseA;
    const glow = rec.glow ? this._sprite(rec.glow, box) : null;
    if (glow) glow.blendMode = 'add';
    const sc = size / rec.size;
    if (epic) {
      this.emit('debris', x, y, { count: 12 });
      this.emit('dust', x, y, { count: 10 });
    } else {
      this.emit('dust', x, y, { count: 6, size: 0.8 });
    }
    return this._run({
      duration: dur,
      update: (dt, t, k) => {
        const pop = Math.min(1, t / 110);
        box.scale.set(sc * (0.55 + 0.45 * Ease.outBack(pop)));
        const fadeK = k < 0.72 ? 1 : 1 - (k - 0.72) / 0.28;
        base.alpha = baseA * fadeK;
        if (glow) {
          const gk = t < 140 ? 1 : Math.max(0.18, 1 - (t - 140) / 900);
          glow.alpha = gk * fadeK * (0.85 + 0.15 * Math.sin(t * 0.04));
        }
      },
      end: () => {
        rec.refs = Math.max(0, rec.refs - 1);
        this._dispose(box);
        if (typeof this.textures._trimCracks === 'function') this.textures._trimCracks();
      },
    });
  }

  // ===================================================================== afterimages
  afterimages(view, o = {}) {
    if (!view || view.destroyed) return this._done();
    const epic = this.epic;
    const sq = this.sq;
    const color = o.color != null ? o.color : epic ? EPIC.side[view.color] || EPIC.white : 0xffffff;
    const dur = o.duration || 450;
    const spacing = (o.spacing != null ? o.spacing : epic ? 0.3 : 0.45) * sq;
    const alpha0 = o.alpha != null ? o.alpha : epic ? 0.6 : 0.22;
    const fade = epic ? 240 : 200;
    const ghosts = [];
    let lx = view.x;
    let ly = view.y;
    let count = 0;
    const maxGhosts = epic ? 14 : 4;
    const spawn = () => {
      const g = new Container();
      const bodyS = view.body.scale.x * view.scale.x;
      g.position.set(view.x + view.body.x * view.scale.x, view.y + view.body.y * view.scale.y);
      g.scale.set(bodyS);
      if (epic) {
        const glow = this._sprite(this.textures.frame('dot'), g);
        glow.blendMode = 'add';
        glow.tint = color;
        glow.scale.set((sq * 1.25) / 64);
        glow.alpha = 0.55;
      }
      for (const part of [view.ring, view.base, view.core, view.crown]) {
        if (!part || !part.visible || !part.texture || part.texture === Texture.EMPTY) continue;
        const s = this._sprite(part.texture, g);
        s.anchor.copyFrom(part.anchor);
        s.position.copyFrom(part.position);
        s.scale.copyFrom(part.scale);
        s.rotation = part.rotation;
        if (epic) {
          s.blendMode = 'add';
          s.tint = mixHex(color, 0xffffff, part === view.base ? 0.15 : 0.5);
        }
      }
      this.c.worldUnder.addChild(g);
      ghosts.push({ g, t: 0 });
      count++;
    };
    return this._run({
      duration: dur + fade,
      update: (dt, t) => {
        if (t < dur && !view.destroyed && view.parent) {
          const d = Math.hypot(view.x - lx, view.y - ly);
          if (d >= spacing && count < maxGhosts * 3) {
            spawn();
            lx = view.x;
            ly = view.y;
          }
        }
        for (let i = ghosts.length - 1; i >= 0; i--) {
          const gh = ghosts[i];
          gh.t += dt;
          const k = gh.t / fade;
          if (k >= 1) {
            this._dispose(gh.g);
            ghosts.splice(i, 1);
            continue;
          }
          gh.g.alpha = alpha0 * Math.pow(1 - k, 1.4);
        }
        while (ghosts.length > maxGhosts) this._dispose(ghosts.shift().g);
        if (t >= dur && !ghosts.length) return false;
      },
      end: () => {
        for (const gh of ghosts) this._dispose(gh.g);
        ghosts.length = 0;
      },
    });
  }

  // ===================================================================== aura
  /**
   * Persistent flame aura under a PieceView (in its auraLayer). Cheap: ~10 sprites + a trickle of
   * embers. Auto-stops when the view is captured/recycled. Returns { stop(), setColor(), setIntensity(), promise }.
   */
  aura(view, o = {}) {
    if (!view || view.destroyed || !view.auraLayer) {
      return { stop: () => this._done(), setColor() {}, setIntensity() {}, promise: this._done() };
    }
    // one aura per view: replace the previous one
    for (const a of this._auras) if (a.view === view && !a.dead) this._killAura(a, true);
    const epic = this.epic;
    const sq = view.squareSize || this.sq;
    const R = sq * 0.42;
    const T = this.textures;
    const color = o.color != null ? o.color : epic ? EPIC.gold : CLASSIC.goldLight;
    const box = new Container();
    box.label = 'fx-aura';
    view.auraLayer.addChild(box);
    const halo = this._sprite(T.frame('dot'), box);
    halo.blendMode = 'add';
    const ring = this._sprite(T.frame(epic ? 'ringSoft' : 'ring'), box);
    ring.blendMode = 'add';
    const flames = [];
    if (epic) {
      // outer tongues, then a hotter inner ring (both lean outward and up)
      for (const [n, hot] of [[10, false], [6, true]]) {
        for (let i = 0; i < n; i++) {
          const a = -Math.PI / 2 + ((i / (n - 1)) * 2 - 1) * Math.PI * 0.95 + (hot ? 0.15 : 0);
          const f = this._sprite(T.frame(i % 2 ? 'flame0' : 'flame1'), box);
          f.anchor.set(0.5, 0.86);
          f.blendMode = 'add';
          flames.push({ s: f, a, hot, ph: Math.random() * TAU, sp: rand(7, 12) });
        }
      }
      const inner = this._sprite(T.frame('core'), box);
      inner.blendMode = 'add';
      flames.push({ s: inner, core: true });
    }
    let res;
    const aura = {
      view,
      box,
      halo,
      ring,
      flames,
      color,
      intensity: o.intensity != null ? o.intensity : 1,
      t: Math.random() * 1000,
      emitAcc: 0,
      dead: false,
      fading: 0,
      epic,
      R,
      promise: new Promise((r) => (res = r)),
      setColor(c) {
        this.color = c;
        halo.tint = c;
        ring.tint = epic ? mixHex(c, 0xffffff, 0.25) : c;
        for (const f of flames) f.s.tint = f.core || f.hot ? mixHex(c, 0xffffff, 0.6) : c;
      },
    };
    aura._resolve = res;
    aura.setColor(color);
    this._auras.push(aura);
    const api = {
      stop: () => {
        if (!aura.dead && !aura.fading) aura.fading = 1;
        return aura.promise;
      },
      setColor: (c) => aura.setColor(c),
      setIntensity: (v) => {
        aura.intensity = v;
      },
      promise: aura.promise,
    };
    return api;
  }

  _killAura(a, completed) {
    if (a.dead) return;
    a.dead = true;
    this._dispose(a.box);
    a._resolve(completed);
  }

  _updateAuras(gdt, rdt) {
    const list = this._auras;
    if (!list.length) return;
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i];
      const v = a.view;
      if (a.dead) {
        list.splice(i, 1);
        continue;
      }
      if (v.destroyed || a.box.destroyed || a.box.parent !== v.auraLayer || !v.parent) {
        this._killAura(a, false);
        list.splice(i, 1);
        continue;
      }
      a.t += gdt;
      let fadeMul = 1;
      if (a.fading) {
        a.fading += gdt;
        fadeMul = Math.max(0, 1 - (a.fading - 1) / 320);
        if (fadeMul <= 0) {
          this._killAura(a, true);
          list.splice(i, 1);
          continue;
        }
      }
      const t = a.t / 1000;
      const I = a.intensity * fadeMul;
      const R = a.R;
      a.box.y = v.body.y;
      a.box.scale.set(v.body.scale.x);
      const pulse = 0.5 + 0.5 * Math.sin(t * 3.1);
      a.halo.scale.set((R * (a.epic ? 3.1 : 2.7) * (0.95 + 0.08 * pulse)) / 64);
      a.halo.alpha = (a.epic ? 0.55 + 0.2 * pulse : 0.28 + 0.12 * pulse) * I;
      const rs = a.epic ? 1.18 + 0.06 * Math.sin(t * 5.3) : 1.12 + 0.05 * pulse;
      a.ring.scale.set((R * rs) / 56);
      a.ring.alpha = (a.epic ? 0.55 : 0.3 + 0.2 * pulse) * I;
      for (const f of a.flames) {
        if (f.core) {
          f.s.scale.set((R * 1.9 * (0.9 + 0.12 * Math.sin(t * 9))) / 32);
          f.s.alpha = 0.35 * I;
          continue;
        }
        const n1 = Math.sin(t * f.sp + f.ph) * 0.5 + Math.sin(t * f.sp * 1.73 + f.ph * 2.1) * 0.35;
        const ca = Math.cos(f.a);
        const sa = Math.sin(f.a);
        f.s.position.set(ca * R * 0.92, sa * R * 0.8);
        // tongues lean outward and up
        const up = -Math.PI / 2;
        const lean = f.a + (up - f.a) * 0.55;
        f.s.rotation = lean + Math.PI / 2 + n1 * 0.12;
        const tall = (0.7 + 0.6 * (-sa * 0.5 + 0.5)) * (f.hot ? 0.62 : 1);
        const h = (R * 1.55 * tall * (1 + 0.38 * n1) * (0.85 + 0.15 * I)) / 64;
        f.s.scale.set(((R * (f.hot ? 0.5 : 0.74)) / 32) * (1 - 0.18 * n1), h);
        f.s.alpha = (f.hot ? 0.7 : 0.5 + 0.35 * (0.5 + 0.5 * n1)) * I;
      }
      // trickle of embers / sparkles
      if (I > 0.05 && this.q.mul > 0.4) {
        a.emitAcc += (gdt / 1000) * (a.epic ? 7 : 2.5) * this.q.mul * I;
        while (a.emitAcc >= 1) {
          a.emitAcc -= 1;
          const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
          const px = v.x + Math.cos(ang) * R * 0.9;
          const py = v.y + v.body.y + Math.sin(ang) * R * 0.75;
          if (a.epic) this.emit('embers', px, py, { count: 1 / this.q.mul, color: a.color, radius: 0.05, speed: 0.8 });
          else this.emit('stars', px, py, { count: 1 / this.q.mul, color: a.color, radius: 0.05, size: 0.7 });
        }
      }
    }
  }

  // ===================================================================== weather
  /** Screen-wide continuous emitter: 'petals' | 'confetti' | 'rain' | 'embers'. */
  weather(kind = 'petals', o = {}) {
    const dur = o.duration || 3000;
    const rateBase = o.rate != null ? o.rate : { petals: 14, confetti: 40, rain: 70, embers: 18 }[kind] || 14;
    let acc = 0;
    return this._run({
      duration: dur,
      realtime: o.realtime !== false,
      update: (dt, t, k) => {
        const scr = this.renderer.screen;
        const ramp = Math.min(1, t / 300) * (k > 0.8 ? (1 - k) / 0.2 : 1);
        acc += (dt / 1000) * rateBase * this.q.mul * ramp;
        while (acc >= 1) {
          acc -= 1;
          const x = Math.random() * scr.width;
          if (kind === 'rain') {
            this.emit('rain', x + scr.height * 0.18, -20, { screen: true, count: 1 / this.q.mul, realtime: o.realtime !== false, color: o.color, life: (scr.height / 844) * 1.1 });
          } else if (kind === 'embers') {
            this.emit('embers', x, scr.height + 10, { screen: true, count: 1 / this.q.mul, color: o.color, speed: 2.2, life: 2.2, realtime: o.realtime !== false });
          } else {
            this.emit(kind, x, -16, {
              screen: true,
              count: 1 / this.q.mul,
              angle: Math.PI / 2,
              spread: 0.6,
              speed: kind === 'petals' ? 0.35 : 0.3,
              life: kind === 'petals' ? 2 : 1.6,
              color: o.color,
              realtime: o.realtime !== false,
            });
          }
        }
      },
    });
  }

  // ===================================================================== anime (anime.js)
  impactFrame(o = {}) {
    if (this.epic) this._impactUntil = Math.max(this._impactUntil, this.clock.realNow + (o.duration || 120));
    return Anime.impactFrame(this, o);
  }

  speedLines(o = {}) {
    return Anime.speedLines(this, o);
  }

  focusLines(o = {}) {
    return Anime.speedLines(this, { ...o, style: 'focus' });
  }

  kanji(text, x, y, o = {}) {
    return Anime.kanji(this, text, x, y, o);
  }

  banner(text, o = {}) {
    return Anime.banner(this, text, o);
  }

  cutIn(o = {}) {
    return Anime.cutIn(this, o);
  }

  comboCounter(n, o = {}) {
    return Anime.comboCounter(this, n, o);
  }

  hideCombo() {
    return Anime.hideCombo(this);
  }

  menacing(x, y, o = {}) {
    return Anime.menacing(this, x, y, o);
  }

  // ===================================================================== lifecycle
  /** Load fonts and pre-render common lettering so the first capture does not hitch. */
  async preload(texts) {
    await Anime.loadFonts(texts);
    Anime.warmup(this, texts);
  }

  /** Stop and remove everything (auras and combo counter included). */
  clear() {
    this._gen++;
    const list = this._effects.slice();
    for (const e of list) this._finish(e, false);
    this._effects.length = 0;
    for (const a of this._auras.slice()) this._killAura(a, false);
    this._auras.length = 0;
    Anime.hideCombo(this, true);
    this.particles.clear();
    this.filters.clear();
    this._resetTime();
    this._impactUntil = 0;
    this._heavy = { rgb: 0, zoom: 0, bloom: 0 };
    for (const c of Object.values(this.c)) {
      for (const k of c.children.slice()) this._dispose(k);
    }
  }

  /** Debug / verification snapshot. */
  stats() {
    let sprites = 0;
    for (const c of Object.values(this.c)) sprites += countNodes(c) - 1;
    return {
      effects: this._effects.length,
      particles: this.particles.count,
      auras: this._auras.length,
      nodes: sprites,
      pool: this._spritePool.length,
      filters: this.filters.describe(),
      clockScale: this.clock.scale,
    };
  }

  destroy() {
    this.clear();
    this.clock.remove(this._tick, this);
    this.particles.destroy();
    this.filters.destroy();
    for (const c of Object.values(this.c)) c.destroy({ children: true });
    for (const s of this._spritePool) s.destroy();
    this._spritePool = [];
    if (this._ownTextures) this.textures.destroy();
  }
}

function countNodes(n) {
  let c = 1;
  if (n.children) for (const k of n.children) c += countNodes(k);
  return c;
}

/** Jagged bolt by midpoint displacement → flat [x0, y0, x1, y1, ...]. */
function boltPath(x1, y1, x2, y2, levels, rough) {
  let pts = [x1, y1, x2, y2];
  let off = Math.hypot(x2 - x1, y2 - y1) * rough;
  for (let l = 0; l < levels; l++) {
    const next = [pts[0], pts[1]];
    for (let i = 0; i < pts.length - 2; i += 2) {
      const ax = pts[i];
      const ay = pts[i + 1];
      const bx = pts[i + 2];
      const by = pts[i + 3];
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const d = (Math.random() * 2 - 1) * off;
      next.push(mx + (-dy / len) * d, my + (dx / len) * d, bx, by);
    }
    pts = next;
    off *= 0.52;
  }
  return pts;
}

