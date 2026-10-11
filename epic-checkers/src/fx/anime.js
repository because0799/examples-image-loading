// Anime / manga screen effects for FX (called through the FX class, see fx.js):
// impactFrame, speedLines, kanji (onomatopoeia), banner, cutIn, comboCounter, menacing, plus the
// lettering styles and font loading they share.

import { Graphics, Texture, TilingSprite, MeshSimple, Rectangle } from 'pixi.js';
import { Ease } from '../render/tween.js';
import { mixHex, shadeHex } from '../render/canvas.js';
import { EPIC, CLASSIC } from '../render/palette.js';

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const css = (hex) => `#${(hex & 0xffffff).toString(16).padStart(6, '0')}`;

// ============================================================================ fonts
const KANJI_SET = '斬撃ドンバゴゴ覚醒勝利対決必殺終ズドォ！!?×・';
const CYR = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя';
const LAT = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!?.,:-';

function timeout(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fontsApi() {
  return typeof document !== 'undefined' && document.fonts && document.fonts.load ? document.fonts : null;
}

export async function loadFonts(extra) {
  const F = fontsApi();
  if (!F) return;
  const sample = CYR + LAT + KANJI_SET + (Array.isArray(extra) ? extra.join('') : extra || '');
  const jobs = [
    F.load('64px "Dela Gothic One"', sample),
    F.load('64px "Russo One"', CYR + LAT),
    F.load('700 64px "Oswald"', CYR + LAT),
    F.load('500 64px "Oswald"', CYR + LAT),
    F.load('900 64px "Unbounded"', CYR + LAT + '×'),
  ].map((p) => p.catch(() => null));
  await Promise.race([Promise.all(jobs), timeout(3000)]);
}

function fontString(style) {
  return `${style.weight || 400} ${style.size}px ${style.font}`;
}

function fontReady(style, text) {
  const F = fontsApi();
  if (!F || !F.check) return true;
  try {
    return F.check(fontString(style), text);
  } catch {
    return true;
  }
}

/** Run `fn` once the fonts for all (style, text) pairs are available (or after a short timeout). */
function withFonts(fx, pairs, fn) {
  const missing = pairs.filter(([st, tx]) => tx && !fontReady(st, tx));
  if (!missing.length) return fn();
  const gen = fx._gen;
  const F = fontsApi();
  const load = Promise.all(missing.map(([st, tx]) => F.load(fontString(st), tx).catch(() => null)));
  return Promise.race([load, timeout(1500)]).then(() => (gen === fx._gen ? fn() : false));
}

// ============================================================================ lettering styles
function texRes(fx, boost = 1.35) {
  return Math.min(2.5, Math.max(1.5, (fx.renderer.resolution || 1) * boost));
}

export function kanjiStyle(fx, size, color) {
  const res = texRes(fx, 1.5);
  if (!fx.epic) {
    return {
      key: `kc|${size}|${res}`,
      font: '"Russo One", "Dela Gothic One"',
      size,
      fill: ['#fffaf0', '#f3d98a', '#c9a04c', '#8a6a2a'],
      stroke: { color: '#2a1a10', width: size * 0.06 },
      glow: { color: 'rgba(0,0,0,0.55)', blur: size * 0.14, alpha: 0.85 },
      shine: 0.5,
      res,
    };
  }
  return {
    key: `k|${size}|${color}|${res}`,
    font: '"Dela Gothic One"',
    size,
    fill: ['#ffffff', css(mixHex(color, 0xffffff, 0.7)), css(color), css(shadeHex(color, 0.55))],
    stroke: { color: '#000000', width: size * 0.06 },
    glow: { color: css(color), blur: size * 0.24, alpha: 0.95 },
    shadow: { dx: size * 0.05, dy: size * 0.065, color: '#000000' },
    shine: 0.8,
    jitter: 0.07,
    spacing: -0.02,
    res,
  };
}

export function titleStyle(fx, size, color, variant) {
  const res = texRes(fx);
  if (variant === 'classic') {
    return {
      key: `tc|${size}|${res}`,
      font: '"Oswald"',
      weight: 700,
      size,
      fill: ['#fff6dc', '#f3d98a', '#c9a04c', '#8a6a2a'],
      stroke: { color: '#160c06', width: size * 0.045 },
      glow: { color: 'rgba(0,0,0,0.6)', blur: size * 0.18, alpha: 0.8 },
      shine: 0.4,
      spacing: 0.05,
      res,
    };
  }
  if (variant === 'defeat') {
    return {
      key: `td|${size}|${res}`,
      font: '"Dela Gothic One"',
      size,
      fill: ['#f0f4ff', '#b4bfdc', '#6f7b98'],
      stroke: { color: '#05060c', width: size * 0.08 },
      glow: { color: 'rgba(120,140,200,0.6)', blur: size * 0.2, alpha: 0.6 },
      shine: 0.3,
      res,
    };
  }
  return {
    key: `t|${size}|${color}|${res}`,
    font: '"Dela Gothic One"',
    size,
    fill: ['#ffffff', css(mixHex(color, 0xffffff, 0.55)), css(color), css(shadeHex(color, 0.6))],
    stroke: { color: '#000000', width: size * 0.085 },
    rim: { color: '#ffffff', width: size * 0.028 },
    glow: { color: css(color), blur: size * 0.22, alpha: 0.9 },
    shadow: { dx: size * 0.04, dy: size * 0.06, color: '#000000' },
    shine: 0.9,
    spacing: -0.01,
    res,
  };
}

export function subStyle(fx, size, color, variant) {
  const res = texRes(fx);
  if (variant === 'classic') {
    return {
      key: `sc|${size}|${res}`,
      font: '"Oswald"',
      weight: 500,
      size,
      fill: '#f4eedd',
      glow: { color: 'rgba(0,0,0,0.7)', blur: size * 0.25, alpha: 0.9 },
      spacing: 0.08,
      res,
    };
  }
  return {
    key: `s|${size}|${color}|${variant}|${res}`,
    font: '"Russo One"',
    size,
    fill: variant === 'defeat' ? ['#dfe6f7', '#9ba7c4'] : ['#ffffff', css(mixHex(color, 0xffffff, 0.55))],
    stroke: { color: '#000000', width: size * 0.13 },
    glow: { color: 'rgba(0,0,0,0.8)', blur: size * 0.2, alpha: 0.8 },
    spacing: 0.03,
    res,
  };
}

function comboNumStyle(fx, size, color) {
  const res = texRes(fx, 1.6);
  if (!fx.epic) {
    return {
      key: `cnc|${size}|${res}`,
      font: '"Oswald"',
      weight: 700,
      size,
      fill: ['#fff6dc', '#f3d98a', '#c9a04c'],
      stroke: { color: '#160c06', width: size * 0.05 },
      glow: { color: 'rgba(0,0,0,0.6)', blur: size * 0.16, alpha: 0.85 },
      res,
    };
  }
  return {
    key: `cn|${size}|${color}|${res}`,
    font: '"Unbounded"',
    weight: 900,
    size,
    fill: ['#ffffff', css(mixHex(color, 0xffffff, 0.5)), css(color), css(shadeHex(color, 0.45))],
    stroke: { color: '#000000', width: size * 0.085 },
    rim: { color: '#ffffff', width: size * 0.03 },
    glow: { color: css(color), blur: size * 0.25, alpha: 0.95 },
    shadow: { dx: size * 0.05, dy: size * 0.06, color: '#000000' },
    shine: 1,
    spacing: -0.04,
    res,
  };
}

function comboLabelStyle(fx, size, color) {
  const res = texRes(fx, 1.5);
  if (!fx.epic) {
    return {
      key: `clc|${size}|${res}`,
      font: '"Oswald"',
      weight: 500,
      size,
      fill: '#f4eedd',
      glow: { color: 'rgba(0,0,0,0.7)', blur: size * 0.3, alpha: 0.9 },
      spacing: 0.12,
      res,
    };
  }
  return {
    key: `cl|${size}|${color}|${res}`,
    font: '"Dela Gothic One"',
    size,
    fill: ['#ffffff', css(mixHex(color, 0xffffff, 0.35))],
    stroke: { color: '#000000', width: size * 0.15 },
    glow: { color: css(color), blur: size * 0.3, alpha: 0.7 },
    spacing: 0.02,
    res,
  };
}

function menacingStyle(fx, size, color) {
  const res = texRes(fx, 1.4);
  return {
    key: `m|${size}|${color}|${res}`,
    font: '"Dela Gothic One"',
    size,
    fill: [css(mixHex(color, 0xffffff, 0.55)), css(color), css(shadeHex(color, 0.55)), css(shadeHex(color, 0.3))],
    stroke: { color: '#0a0010', width: size * 0.09 },
    rim: { color: css(mixHex(color, 0xffffff, 0.75)), width: size * 0.018 },
    glow: { color: css(shadeHex(color, 0.6)), blur: size * 0.25, alpha: 0.8 },
    shadow: { dx: size * 0.06, dy: size * 0.06, color: '#000000' },
    shine: 0.6,
    jitter: 0.1,
    res,
  };
}

/**
 * Pre-render a FEW common pieces of lettering so the first capture does not hitch (the strings
 * passed to preload() are for font loading; only short onomatopoeia are rasterised here, ≤ 6, so
 * the warmup itself never stalls the start of a game).
 */
export function warmup(fx, texts) {
  const sq = fx.sq;
  const T = fx.textures;
  const size = Math.round(sq * 1.9);
  const extra = (Array.isArray(texts) ? texts : []).filter((t) => typeof t === 'string' && Array.from(t).length <= 3 && !/[A-Za-zА-Яа-яЁё]/.test(t));
  const list = Array.from(new Set(['斬!', 'ドン!', ...extra])).slice(0, 6);
  const snapped = size > 36 ? Math.round(size / 6) * 6 : size;
  const cols = typeof fx.sideColor === 'function' ? [fx.sideColor(1), fx.sideColor(-1)] : [EPIC.white, EPIC.black];
  for (const c of cols) {
    for (const t of list) {
      const tex = T.text(t, kanjiStyle(fx, snapped, c), textSeed(t));
      T.releaseText(tex);
    }
  }
  const m = T.text('ゴ', menacingStyle(fx, Math.round(sq * 0.95), 0xb44dff));
  T.releaseText(m);
}

// ============================================================================ helpers
function screenFocus(fx, o, out) {
  const scr = fx.renderer.screen;
  if (o.screenFocus) {
    out.x = o.screenFocus.x;
    out.y = o.screenFocus.y;
  } else if (o.focus) {
    fx._w2s(o.focus.x, o.focus.y, out);
  } else {
    out.x = scr.width / 2;
    out.y = scr.height / 2;
  }
  return out;
}

function maxCornerDist(x, y, W, H) {
  return Math.max(Math.hypot(x, y), Math.hypot(W - x, y), Math.hypot(x, H - y), Math.hypot(W - x, H - y));
}

/** Clip a convex polygon (flat xy array) to the half-plane n·p >= 0. */
function clipHalf(poly, nx, ny) {
  const out = [];
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const ax = poly[i * 2];
    const ay = poly[i * 2 + 1];
    const bx = poly[((i + 1) % n) * 2];
    const by = poly[((i + 1) % n) * 2 + 1];
    const da = ax * nx + ay * ny;
    const db = bx * nx + by * ny;
    if (da >= 0) out.push(ax, ay);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push(ax + (bx - ax) * t, ay + (by - ay) * t);
    }
  }
  return out;
}

function meshFromPoly(tex, poly, w, h) {
  const n = poly.length / 2;
  const vertices = new Float32Array(poly);
  const uvs = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    uvs[i * 2] = poly[i * 2] / w + 0.5;
    uvs[i * 2 + 1] = poly[i * 2 + 1] / h + 0.5;
  }
  const idx = new Uint32Array((n - 2) * 3);
  for (let i = 0; i < n - 2; i++) {
    idx[i * 3] = 0;
    idx[i * 3 + 1] = i + 1;
    idx[i * 3 + 2] = i + 2;
  }
  return new MeshSimple({ texture: tex, vertices, uvs, indices: idx });
}

function starburst(g, R, spikes, color, inner, ink, seed) {
  let s = seed;
  const r = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const pts = [];
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * TAU;
    const rr = i % 2 === 0 ? R * (0.95 + r() * 0.35) : R * (0.55 + r() * 0.12);
    pts.push(Math.cos(a) * rr, Math.sin(a) * rr * 0.72);
  }
  g.poly(pts, true).fill({ color }).stroke({ width: Math.max(2, R * 0.05), color: ink, join: 'miter', miterLimit: 6 });
  const p2 = [];
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * TAU + 0.12;
    const rr = i % 2 === 0 ? R * (0.68 + r() * 0.2) : R * 0.42;
    p2.push(Math.cos(a) * rr, Math.sin(a) * rr * 0.72);
  }
  g.poly(p2, true).fill({ color: inner });
}

// ============================================================================ impact frame
/**
 * Iconic anime impact frame: 2–4 frames alternating inverted / posterized B&W (colour-matrix on
 * the background, world and screenFx layers) with bold radial impact lines around the focus,
 * then snap back. Low quality: white/black flash frames with the lines. Classic: a soft flash.
 */
export function impactFrame(fx, o = {}) {
  if (!fx.epic) return fx.flash(0xffe6b0, { duration: 160, alpha: 0.22, blend: 'add' });
  const T = fx.textures;
  const scr = fx.renderer.screen;
  const dur = o.duration || 120;
  const slots = Math.max(2, Math.min(4, o.frames || 3));
  const slotDur = dur / slots;
  const h = fx.filters.request('impact');
  const box = fx._box(fx.c.overlay, 'impact-frame');
  let bg = null;
  if (!h) {
    bg = fx._sprite(Texture.WHITE, box);
    bg.anchor.set(0);
    bg.width = scr.width + 4;
    bg.height = scr.height + 4;
    bg.position.set(-2, -2);
  }
  const lineBox = fx._box(box, 'impact-lines');
  const N = o.lines === false ? 0 : Math.round(38 * Math.max(0.6, fx.q.lines));
  const sprites = [];
  for (let i = 0; i < N; i++) {
    const thin = i % 3 === 0;
    const s = fx._sprite(T.frame(thin ? 'line' : 'wedge'), lineBox);
    s.anchor.set(0, 0.5);
    s._thin = thin;
    sprites.push(s);
  }
  const f = { x: 0, y: 0 };
  const k = Math.max(0.8, Math.min(2, Math.min(scr.width, scr.height) / 390));
  const layout = (mode) => {
    screenFocus(fx, o, f);
    const D = maxCornerDist(f.x, f.y, scr.width, scr.height) + 30;
    const ink = mode === 1 ? 0x000000 : o.color != null ? o.color : 0xffffff;
    for (const s of sprites) {
      const a = Math.random() * TAU;
      const rin = D * (s._thin ? rand(0.2, 0.5) : rand(0.14, 0.4));
      s.position.set(f.x + Math.cos(a) * rin, f.y + Math.sin(a) * rin);
      s.rotation = a;
      s.scale.x = (D * 1.1 - rin * 0.5) / 256;
      s.scale.y = s._thin ? (rand(2, 5) * k) / 14 : (rand(10, 46) * k) / 42;
      s.tint = ink;
      s.alpha = mode === 1 ? 1 : 0.85;
    }
  };
  let slot = 0;
  let slotT = 0;
  let frames = 0;
  const setSlot = (i) => {
    const mode = i % 2 === 0 ? 1 : 2;
    if (h) {
      h.mode = mode;
      h.amount = o.threshold != null ? o.threshold : 0.3;
    } else {
      // no colour-matrix filter: near-opaque paper / ink frames that still let the scene ghost through
      bg.tint = mode === 1 ? 0xffffff : 0x000000;
      bg.alpha = mode === 1 ? 0.84 : 0.72;
    }
    layout(mode);
  };
  setSlot(0);
  return fx._run({
    realtime: o.realtime !== false,
    update: (dt) => {
      slotT += dt;
      frames++;
      if (slotT >= slotDur && frames >= 1) {
        slot++;
        if (slot >= slots) return false;
        slotT = 0;
        frames = 0;
        setSlot(slot);
      }
    },
    end: () => {
      if (h) h.release();
      fx._dispose(box);
    },
  });
}

// ============================================================================ speed lines
/**
 * Manga speed lines. style 'speed' (radial streaks converging on the focus), 'focus' (dense
 * concentration lines framing the focus from the screen edges), 'dash' (parallel streaks rushing
 * past along `angle`). color: hex | 'white' | 'black'. Lines are re-randomised every ~2 frames.
 */
export function speedLines(fx, o = {}) {
  if (!fx.epic) return fx._done();
  const T = fx.textures;
  const style = o.style || 'speed';
  const scr = fx.renderer.screen;
  const W = scr.width;
  const H = scr.height;
  const dur = o.duration || (style === 'focus' ? 750 : 560);
  const black = o.color === 'black' || o.color === 0;
  const color = black ? 0x000000 : o.color == null || o.color === 'white' ? 0xffffff : o.color;
  const density = o.density != null ? o.density : 1;
  const base = style === 'focus' ? 150 : style === 'dash' ? 64 : 84;
  const N = Math.max(8, Math.round(base * density * fx.q.lines));
  const box = fx._box(fx.c.screenLines, `speedlines-${style}`);
  const sk = Math.max(0.8, Math.min(2, Math.min(W, H) / 390));
  const tex = T.frame('line');
  const sprites = [];
  for (let i = 0; i < N; i++) {
    const s = fx._sprite(tex, box);
    s.anchor.set(0, 0.5);
    s.tint = color;
    s.blendMode = black ? 'normal' : 'add';
    sprites.push(s);
  }
  const f = { x: 0, y: 0 };
  let regen = 0;
  // dash state
  const ang = o.angle != null ? o.angle : 0;
  const dirX = Math.cos(ang);
  const dirY = Math.sin(ang);
  const span = Math.hypot(W, H);
  const dash = style === 'dash' ? sprites.map(() => ({ u: rand(-span, span), v: rand(-span / 2, span / 2), len: rand(0.15, 0.6) * span, w: rand(1.5, 6) * sk, sp: rand(2.4, 4.6) * span, a: rand(0.3, 0.85) })) : null;
  const randomize = () => {
    screenFocus(fx, o, f);
    const D = maxCornerDist(f.x, f.y, W, H) + 20;
    if (style === 'focus') {
      const rx = W * 0.4;
      const ry = H * 0.3;
      for (const s of sprites) {
        const a = Math.random() * TAU;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        const re = 1 / Math.sqrt((c * c) / (rx * rx) + (sn * sn) / (ry * ry));
        const rin = Math.min(D * 0.92, re * rand(0.95, 1.5));
        s.position.set(f.x + c * rin, f.y + sn * rin);
        s.rotation = a;
        s.scale.x = (D * 1.15 - rin * 0.6) / 256;
        s.scale.y = (rand(1.5, 6.5) * sk) / 14;
        s._a = rand(0.5, 1);
      }
    } else {
      for (const s of sprites) {
        const a = Math.random() * TAU;
        const rin = D * rand(0.13, 0.55);
        s.position.set(f.x + Math.cos(a) * rin, f.y + Math.sin(a) * rin);
        s.rotation = a;
        s.scale.x = (D * rand(0.6, 1.1)) / 256;
        s.scale.y = (rand(2, 11) * sk) / 14;
        s._a = rand(0.3, 0.9);
      }
    }
  };
  if (!dash) randomize();
  return fx._run({
    duration: dur,
    realtime: o.realtime !== false,
    update: (dt, t, k) => {
      const env = k < 0.12 ? k / 0.12 : k > 0.65 ? (1 - k) / 0.35 : 1;
      if (dash) {
        const cx = W / 2;
        const cy = H / 2;
        for (let i = 0; i < sprites.length; i++) {
          const d = dash[i];
          const s = sprites[i];
          d.u -= (d.sp * dt) / 1000;
          if (d.u < -span) {
            d.u += span * 2;
            d.v = rand(-span / 2, span / 2);
          }
          s.position.set(cx + dirX * d.u - dirY * d.v, cy + dirY * d.u + dirX * d.v);
          s.rotation = ang;
          s.scale.x = d.len / 256;
          s.scale.y = d.w / 14;
          s.alpha = d.a * env;
        }
        return;
      }
      regen -= dt;
      if (regen <= 0) {
        regen = 33;
        randomize();
      }
      for (const s of sprites) s.alpha = s._a * env;
    },
    end: () => fx._dispose(box),
  });
}

// ============================================================================ kanji
/** Stable texture seed for a piece of lettering: the same text reuses its cached texture. */
export function textSeed(text) {
  let h = 7;
  for (const ch of String(text)) h = (h * 31 + ch.codePointAt(0)) % 9973;
  return h + 1;
}

/** Entrance time (ms) of a kanji before it sits still at full size. */
export const KANJI_IN = { epic: 230, classic: 260 };

/**
 * Huge onomatopoeia / kanji pop: punch-in with overshoot, tilt + skew, shake, light-ray (or manga
 * starburst) backdrop, then shatter / slice / fade. World coords unless { screen: true }.
 * Timing: entrance (KANJI_IN) → o.hold ms at full size (default fx.readMs(text, 'kanji'), the
 * readable time for settings.textTime) → exit; o.duration overrides the whole length.
 * o.avoid() may return a screen rect or an array of rects the glyph keeps clear of.
 */
export function kanji(fx, text, x, y, o = {}) {
  const epic = fx.epic;
  const screen = !!o.screen;
  const sq = fx.sq;
  const len = Array.from(text).length;
  const auto = screen ? Math.min(fx.renderer.screen.width * 0.32, 150) : sq * (epic ? 2.1 : 1.05);
  // sizes snap to 6 px steps: a repeated glyph hits the texture cache instead of re-rasterising
  const raw = (o.size || auto) * (len > 3 && !o.size ? 0.78 : 1);
  const size = raw > 36 ? Math.round(raw / 6) * 6 : Math.round(raw);
  const color = o.color != null ? o.color : epic ? EPIC.black : CLASSIC.gold;
  const style = o.style || kanjiStyle(fx, size, color);
  return withFonts(fx, [[style, text]], () => kanjiNow(fx, text, x, y, o, style, size, color));
}

function kanjiNow(fx, text, x, y, o, style, size, color) {
  const epic = fx.epic;
  const screen = !!o.screen;
  const scr = fx.renderer.screen;
  const parent = screen ? fx.c.screenUI : fx.c.worldOver;
  const exit = o.exit || (epic ? (Array.from(text)[0] === '斬' ? 'slice' : 'shatter') : 'fade');
  const exitDur = epic ? (exit === 'shatter' ? 180 : 260) : 300;
  const hold = o.hold != null ? o.hold : typeof fx.readMs === 'function' ? fx.readMs(text, 'kanji') : 1100;
  const dur = o.duration || (epic ? KANJI_IN.epic : KANJI_IN.classic) + hold + exitDur;
  const e = { cleanup: [], realtime: o.realtime != null ? !!o.realtime : false, duration: dur, delay: o.delay || 0 };
  const root = fx._box(parent, 'kanji');
  e.root = root; // the Director keeps newer lettering clear of this one
  root.visible = !e.delay;
  e.start = () => (root.visible = true);
  const back = fx._box(root, 'kanji-back');
  const inner = fx._box(root, 'kanji-inner');
  // a fixed seed per text: repeated onomatopoeia reuse one cached texture (no canvas work)
  const main = fx._textSprite(text, style, inner, e, o.seed != null ? o.seed : textSeed(text));
  const tex = main.texture;
  const tw = tex.fx.width;
  const th = tex.fx.height;
  // keep the lettering on screen
  let px = x;
  let py = y;
  if (!screen) {
    const z = fx.zoom;
    const p = fx._w2s(x, y, { x: 0, y: 0 });
    const hw = Math.min(scr.width * 0.48, tex.fx.textWidth * 0.5 * z + size * 0.15 * z);
    const hh = size * 0.6 * z;
    p.x = Math.max(hw + 6, Math.min(scr.width - hw - 6, p.x));
    p.y = Math.max(hh + 6, Math.min(scr.height - hh - 6, p.y));
    const w = fx._s2w(p.x, p.y, { x: 0, y: 0 });
    px = w.x;
    py = w.y;
  } else {
    const hw = Math.min(scr.width * 0.48, tex.fx.textWidth * 0.5 + size * 0.15);
    px = Math.max(hw + 6, Math.min(scr.width - hw - 6, px));
  }
  root.position.set(px, py);
  // world kanji: keep the glyph inside the safe screen area (between the HUD panels) every frame,
  // even while the camera keeps moving (EAD-08)
  const clampRect = o.clamp === false ? null : o.clampRect || fx.safeRect || null;
  const halfW = tex.fx.textWidth * 0.5 + size * 0.12;
  const halfH = size * 0.62;
  const anchorX = px;
  const anchorY = py;
  const q = { x: 0, y: 0 };
  const w2 = { x: 0, y: 0 };
  const keepInside = (k) => {
    if (screen) {
      if (!clampRect) return;
      const hw = Math.min(scr.width * 0.49, halfW * k);
      const hh = halfH * k;
      root.x = Math.max(clampRect.x + hw + 4, Math.min(clampRect.x + clampRect.width - hw - 4, anchorX));
      root.y = Math.max(clampRect.y + hh + 4, Math.min(clampRect.y + clampRect.height - hh - 4, anchorY));
      return;
    }
    const R = clampRect || scr;
    const rx = R.x || 0;
    const ry = R.y || 0;
    const z = fx.zoom;
    fx._w2s(anchorX, anchorY, q);
    const hw = Math.min(R.width * 0.49, halfW * k * z);
    const hh = Math.min(R.height * 0.49, halfH * k * z);
    let cx = Math.max(rx + hw + 4, Math.min(rx + R.width - hw - 4, q.x));
    let cy = Math.max(ry + hh + 4, Math.min(ry + R.height - hh - 4, q.y));
    // keep clear of other lettering on screen (the combo counter, an earlier kanji …): checked
    // once per avoid rect, nudging to the nearest free side that stays inside R
    const A = typeof o.avoid === 'function' ? o.avoid() : null;
    const list = Array.isArray(A) ? A : A ? [A] : null;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!a || !(cx + hw > a.x && cx - hw < a.x + a.width && cy + hh > a.y && cy - hh < a.y + a.height)) continue;
        const right = a.x + a.width + hw + 4;
        const left = a.x - hw - 4;
        const below = a.y + a.height + hh + 4;
        const above = a.y - hh - 4;
        let bx = cx;
        let by = cy;
        let best = Infinity;
        if (right + hw <= rx + R.width && right - cx < best) (best = right - cx), (bx = right), (by = cy);
        if (left - hw >= rx && cx - left < best) (best = cx - left), (bx = left), (by = cy);
        if (below + hh <= ry + R.height && below - cy < best) (best = below - cy), (bx = cx), (by = below);
        if (above - hh >= ry && cy - above < best) (best = cy - above), (bx = cx), (by = above);
        cx = bx;
        cy = by;
      }
    }
    if (cx !== q.x || cy !== q.y) {
      fx._s2w(cx, cy, w2);
      root.position.set(w2.x, w2.y);
    } else root.position.set(anchorX, anchorY);
  };
  keepInside(1);
  const rot0 = o.rotation != null ? o.rotation : epic ? (Math.random() - 0.5) * 0.28 : 0;
  const skew = epic ? -0.13 : 0;
  inner.rotation = rot0;
  inner.skew.x = skew;
  // backdrop
  const backdrop = o.backdrop || (epic ? 'rays' : 'none');
  let rays = null;
  let burstG = null;
  let disc = null;
  if (epic && backdrop !== 'none') {
    disc = fx._sprite(fx.textures.frame('dot'), back);
    disc.blendMode = 'add';
    disc.tint = color;
    disc.alpha = 0;
  }
  if (epic && backdrop === 'rays') {
    rays = fx._sprite(fx.textures.rays(), back);
    rays.blendMode = 'add';
    rays.tint = color;
    rays.alpha = 0;
    rays._s = (Math.max(tw, th) * 1.45) / 256;
    rays.rotation = Math.random() * TAU;
  } else if (epic && backdrop === 'burst') {
    burstG = new Graphics();
    starburst(burstG, Math.max(tw * 0.5, th * 0.62), 14, mixHex(color, 0xffffff, 0.15), 0xffffff, 0x000000, (Math.random() * 1e6) | 1);
    burstG.rotation = rot0 * 0.5;
    back.addChild(burstG);
    burstG.alpha = 0;
  }
  let exited = false;
  let pieces = null;
  let halves = null;
  let cutFlare = null;
  let breakFlash = null;
  const startExit = () => {
    exited = true;
    if (exit === 'shatter') {
      // irregular glass shards cut along random lines through the glyph centre (EAD-09): each
      // shard carries the glyph texture plus an additive copy in the kanji colour; a white flash
      // and a spray of sparks mark the break
      main.visible = false;
      if (disc) disc.visible = false;
      pieces = [];
      const rect = [-tw / 2, -th / 2, tw / 2, -th / 2, tw / 2, th / 2, -tw / 2, th / 2];
      const K = 7 + ((Math.random() * 4) | 0);
      const ox = rand(-0.08, 0.08) * tw;
      const oy = rand(-0.12, 0.12) * th;
      const a0 = Math.random() * TAU;
      const angs = [];
      for (let i = 0; i < K; i++) angs.push(a0 + ((i + rand(-0.32, 0.32)) / K) * TAU);
      for (let i = 0; i < K; i++) {
        const a = angs[i];
        const b = i + 1 < K ? angs[i + 1] : angs[0] + TAU;
        // wedge between rays a and b from (ox, oy): two half-planes through that point
        const moved = [];
        for (let j = 0; j < rect.length; j += 2) moved.push(rect[j] - ox, rect[j + 1] - oy);
        let poly = clipHalf(moved, -Math.sin(a), Math.cos(a));
        if (poly.length >= 6) poly = clipHalf(poly, Math.sin(b), -Math.cos(b));
        if (poly.length < 6) continue;
        for (let j = 0; j < poly.length; j += 2) {
          poly[j] += ox;
          poly[j + 1] += oy;
        }
        const m = meshFromPoly(tex, poly, tw, th);
        inner.addChild(m);
        const glow = meshFromPoly(tex, poly, tw, th);
        glow.blendMode = 'add';
        glow.tint = color;
        inner.addChild(glow);
        const mid = (a + b) / 2;
        const sp = size * rand(3.2, 6.5);
        pieces.push({ m, glow, vx: Math.cos(mid) * sp, vy: Math.sin(mid) * sp - size * rand(0.6, 2), vr: rand(-6, 6), x: 0, y: 0, r: 0 });
      }
      breakFlash = fx._sprite(fx.textures.frame('dot'), inner);
      breakFlash.blendMode = 'add';
      breakFlash.scale.set((Math.max(tw, th) * 0.9) / 64);
      breakFlash.alpha = 1;
      const wp = screen ? root.position : root.position;
      fx.emit('spark', wp.x, wp.y, { count: 12, color: mixHex(color, 0xffffff, 0.4), speed: 1.1, screen, realtime: e.realtime });
    } else if (exit === 'slice') {
      main.visible = false;
      const a = o.sliceAngle != null ? o.sliceAngle : -0.32;
      const nx = -Math.sin(a);
      const ny = Math.cos(a);
      const rect = [-tw / 2, -th / 2, tw / 2, -th / 2, tw / 2, th / 2, -tw / 2, th / 2];
      const pa = clipHalf(rect, nx, ny);
      const pb = clipHalf(rect, -nx, -ny);
      halves = [];
      for (const [poly, sgn] of [[pa, 1], [pb, -1]]) {
        if (poly.length < 6) continue;
        const m = meshFromPoly(tex, poly, tw, th);
        inner.addChild(m);
        halves.push({ m, sgn, dx: Math.cos(a), dy: Math.sin(a), nx, ny });
      }
      cutFlare = fx._sprite(fx.textures.frame('flare'), inner);
      cutFlare.blendMode = 'add';
      cutFlare.rotation = a;
      cutFlare.scale.set((tw * 1.8) / 128, (size * 0.5) / 24);
    }
  };
  let jx = 0;
  let jy = 0;
  let shakeT = 0;
  e.update = (dt, t) => {
    // the exit follows e.duration, so shorten() (a newer overlay needs the spot) works too
    const exitStart = e.duration - exitDur;
    // entrance
    let s;
    if (!epic) {
      const kin = clamp01(t / 260);
      s = 0.9 + 0.1 * Ease.outCubic(kin);
      inner.alpha = kin;
      inner.y = (1 - Ease.outCubic(kin)) * size * 0.25;
    } else if (t < 90) {
      s = 2.1 + (0.9 - 2.1) * Ease.inQuad(t / 90);
      inner.alpha = Math.min(1, t / 45);
    } else if (t < 230) {
      s = 0.9 + 0.1 * Ease.outBack((t - 90) / 140);
      inner.alpha = 1;
    } else {
      s = 1 + 0.05 * clamp01((t - 230) / Math.max(1, exitStart - 230));
    }
    inner.scale.set(s);
    if (!screen || clampRect) keepInside(Math.min(1.25, s));
    inner.rotation = rot0 + (epic && t < 90 ? 0.22 * (1 - t / 90) * Math.sign(rot0 || 1) : 0);
    // shake (stepped ~30 Hz for a hand-drawn jitter)
    if (epic) {
      shakeT -= dt;
      const amp = size * 0.06 * Math.max(0, 1 - t / 420);
      if (shakeT <= 0) {
        shakeT = 33;
        jx = (Math.random() - 0.5) * 2 * amp;
        jy = (Math.random() - 0.5) * 2 * amp;
      }
      inner.position.set(jx, jy);
    }
    const outK = t > exitStart ? 1 - (t - exitStart) / exitDur : 1;
    if (rays) {
      const rk = clamp01(t / 160);
      rays.scale.set(rays._s * (0.5 + 0.5 * Ease.outCubic(rk)) * (1 + 0.15 * clamp01((t - 160) / 900)));
      rays.rotation += dt * 0.0007;
      rays.alpha = rk * outK;
    }
    if (disc) {
      const dk = clamp01(t / 120);
      disc.scale.set((Math.max(tw, th) * (1.0 + 0.6 * Math.max(0, 1 - t / 300))) / 64);
      disc.alpha = (0.55 + 0.6 * Math.max(0, 1 - t / 250)) * dk * outK;
    }
    if (burstG) {
      const bk = clamp01((t - 20) / 120);
      burstG.scale.set(0.6 + 0.4 * Ease.outBack(bk));
      burstG.alpha = bk * (t > exitStart - 100 ? Math.max(0, 1 - (t - exitStart + 100) / 200) : 1);
    }
    // exit
    if (t >= exitStart) {
      if (!exited) startExit();
      const ke = clamp01((t - exitStart) / exitDur);
      const sdt = dt / 1000;
      if (pieces) {
        for (const p of pieces) {
          p.vy += size * 14 * sdt;
          p.x += p.vx * sdt;
          p.y += p.vy * sdt;
          p.r += p.vr * sdt;
          p.m.position.set(p.x, p.y);
          p.m.rotation = p.r;
          p.m.alpha = 1 - Math.pow(ke, 1.4);
          p.glow.position.set(p.x, p.y);
          p.glow.rotation = p.r;
          p.glow.alpha = 0.6 * (1 - ke);
        }
        if (breakFlash) breakFlash.alpha = Math.max(0, 1 - ke * 3.5);
      } else if (halves) {
        const d = Ease.outCubic(ke) * size * 0.9;
        for (const hm of halves) {
          hm.m.position.set(hm.dx * d * hm.sgn + hm.nx * d * 0.25 * hm.sgn, hm.dy * d * hm.sgn + hm.ny * d * 0.25 * hm.sgn);
          hm.m.rotation = 0.12 * ke * hm.sgn;
          hm.m.alpha = 1 - Math.pow(ke, 1.6);
        }
        if (cutFlare) cutFlare.alpha = Math.max(0, 1 - ke * 2.5);
      } else {
        inner.alpha = 1 - ke;
        inner.scale.set(s * (1 + 0.2 * ke));
      }
    }
  };
  e.end = () => fx._dispose(root);
  return fx._run(e);
}

// ---------------------------------------------------------------------------- title blocks
let measureCtx = null;
function measureText(style, text) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = fontString(style);
  return measureCtx.measureText(text).width + (style.spacing || 0) * style.size * Math.max(0, Array.from(text).length - 1);
}

/**
 * Break a title into 1–3 balanced lines: one line when it fits at >= minScale, otherwise the line
 * count giving the largest type (bounded by maxH), preferring fewer lines when nearly as large.
 */
function splitTitle(style, text, maxW, minScale, maxH) {
  const words = text.split(' ').filter(Boolean);
  const one = measureText(style, text);
  if (words.length < 2 || one * minScale <= maxW) return [text];
  const lineH = style.size * 0.96;
  const cands = [{ lines: [text], m: one }];
  for (let i = 1; i < words.length; i++) {
    const L = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    cands.push({ lines: L, m: Math.max(...L.map((l) => measureText(style, l))) });
    for (let j = i + 1; j < words.length; j++) {
      const L3 = [words.slice(0, i).join(' '), words.slice(i, j).join(' '), words.slice(j).join(' ')];
      cands.push({ lines: L3, m: Math.max(...L3.map((l) => measureText(style, l))) });
    }
  }
  for (const c of cands) {
    c.scale = Math.min(1, maxW / c.m, maxH ? maxH / (lineH * c.lines.length) : 1);
  }
  const byCount = [];
  let top = 0;
  for (const c of cands) {
    const k = c.lines.length;
    if (!byCount[k] || c.scale > byCount[k].scale) byCount[k] = c;
    if (c.scale > top) top = c.scale;
  }
  // fewest lines whose type is almost as big as the best option
  for (let k = 1; k <= 3; k++) if (byCount[k] && byCount[k].scale >= top * 0.88) return byCount[k].lines;
  return [text];
}

function makeTitle(fx, text, style, maxW, parent, e, minScale = 0.72, maxH = 0) {
  const lines = splitTitle(style, text, maxW, minScale, maxH);
  const sprites = lines.map((l) => fx._textSprite(l, style, parent, e));
  let scale = 1;
  for (const s of sprites) scale = Math.min(scale, maxW / s.texture.fx.textWidth);
  const lineH = style.size * 0.96;
  if (maxH) scale = Math.min(scale, maxH / (lineH * sprites.length));
  return { sprites, scale, lineH, lines: sprites.length, height: lineH * sprites.length * scale };
}

function placeTitle(b, x, y, k = 1, skew = 0, alpha = 1) {
  const s = b.scale * k;
  const n = b.sprites.length;
  for (let i = 0; i < n; i++) {
    const sp = b.sprites[i];
    sp.scale.set(s);
    sp.position.set(x, y + (i - (n - 1) / 2) * b.lineH * s);
    sp.skew.x = skew;
    sp.alpha = alpha;
  }
}

// ============================================================================ banner
/**
 * Big text banner: diagonal band (gradient + scrolling streaks + hot edges) slams in, title slides
 * across, subtitle follows, everything exits. style: 'epic' | 'gold' | 'victory' | 'defeat' | 'classic'.
 * Long titles wrap onto two lines. Timing: entrance → o.hold ms readable (default
 * fx.readMs([title, sub], o.readKind || 'title')) → exit; o.duration overrides the whole length.
 */
export function banner(fx, text, o = {}) {
  const style = o.style || (fx.epic ? 'epic' : 'classic');
  const classic = style === 'classic' || !fx.epic;
  const variant = classic ? 'classic' : style === 'defeat' ? 'defeat' : 'epic';
  const color =
    o.color != null ? o.color : style === 'defeat' ? 0x4f5c7a : classic ? CLASSIC.gold : style === 'epic' ? EPIC.white : EPIC.gold;
  const scr = fx.renderer.screen;
  const W = scr.width;
  const bh0 = Math.max(96, Math.min(180, W * 0.3));
  const tSize = Math.round(bh0 * (classic ? 0.42 : 0.48));
  const sSize = Math.round(bh0 * 0.16);
  const ts = titleStyle(fx, tSize, color, variant);
  const ss = subStyle(fx, sSize, color, variant);
  const pairs = [[ts, text]];
  if (o.sub) pairs.push([ss, o.sub]);

  return withFonts(fx, pairs, () => bannerNow(fx, text, o, { style, classic, color, bh0, ts, ss }));
}

function bannerNow(fx, text, o, P) {
  const { classic, color, bh0, ts, ss, style } = P;
  const scr = fx.renderer.screen;
  const W = scr.width;
  const H = scr.height;
  const T = fx.textures;
  const slow = style === 'defeat' ? 1.8 : 1;
  const inMs = classic ? 600 : Math.round(460 * slow);
  const exitDur = classic ? 320 : 280;
  const hold = o.hold != null ? o.hold : typeof fx.readMs === 'function' ? fx.readMs(o.sub ? [text, o.sub] : text, o.readKind || 'title') : 1600;
  const dur = o.duration || inMs + hold + exitDur;
  const e = { cleanup: [], realtime: o.realtime !== false, duration: dur };
  const root = fx._box(fx.c.screenUI, 'banner');
  root.position.set(W / 2, o.y != null ? o.y : H * 0.42);
  root.rotation = classic ? 0 : style === 'defeat' ? 0.025 : -0.085;
  const back = fx._box(root, 'banner-back');
  const band = fx._box(root, 'band');
  const textBox = fx._box(root, 'banner-text');
  const title = makeTitle(fx, text, ts, W * 0.86, textBox, e, 0.72, bh0 * 1.5);
  let sub = null;
  let sScale = 1;
  if (o.sub) {
    sub = fx._textSprite(o.sub, ss, textBox, e);
    sScale = Math.min(1, (W * 0.8) / sub.texture.fx.textWidth);
    sub.scale.set(sScale);
  }
  const subH = sub ? ss.size * sScale * 1.3 : 0;
  const bh = Math.max(bh0, title.height + subH + bh0 * 0.34);
  const bw = W * 1.8;
  let rays = null;
  if (style === 'victory') {
    rays = fx._sprite(T.rays(), back);
    rays.blendMode = 'add';
    rays.tint = color;
    rays.scale.set((W * 1.7) / 256);
    rays.alpha = 0;
  }
  const bg = fx._sprite(T.band(color, classic ? 'classic' : 'epic'), band);
  bg.width = bw;
  bg.height = classic ? bh * 1.25 : bh;
  let streaks = null;
  if (!classic) {
    streaks = new TilingSprite({ texture: T.bandStreaks(), width: bw, height: bh * 0.94 });
    streaks.anchor.set(0.5);
    streaks.blendMode = 'add';
    streaks.alpha = style === 'defeat' ? 0.12 : 0.32;
    band.addChild(streaks);
  }
  const edges = [];
  const edgeColor = classic ? CLASSIC.gold : mixHex(color, 0xffffff, 0.6);
  for (const y of classic ? [-bh * 0.4, bh * 0.4] : [-bh / 2, bh / 2]) {
    const l = fx._sprite(Texture.WHITE, band);
    l.width = bw;
    l.height = classic ? 1.2 : 3;
    l.y = y;
    l.tint = edgeColor;
    l.blendMode = classic ? 'normal' : 'add';
    l._main = true;
    edges.push(l);
    if (!classic) {
      const l2 = fx._sprite(Texture.WHITE, band);
      l2.width = bw;
      l2.height = 1.5;
      l2.y = y + Math.sign(y) * 7;
      l2.tint = color;
      l2.alpha = 0.7;
      l2.blendMode = 'add';
      edges.push(l2);
    }
  }
  let flash = null;
  if (!classic && style !== 'defeat' && fx.flashesOn !== false) {
    flash = fx._sprite(Texture.WHITE, band);
    flash.width = bw;
    flash.height = bh;
    flash.blendMode = 'add';
  }
  const ty = sub ? -subH * 0.5 : 0;
  const sy = ty + title.height / 2 + subH * 0.5 + 2;
  e.update = (dt, t) => {
    const exitStart = e.duration - exitDur;
    const ke = t > exitStart ? clamp01((t - exitStart) / exitDur) : 0;
    if (classic) {
      const kin = clamp01(t / 300);
      band.alpha = Ease.outCubic(kin) * (1 - ke);
      band.scale.set(1, 0.6 + 0.4 * Ease.outCubic(kin));
      placeTitle(title, 0, ty + (1 - Ease.outCubic(clamp01((t - 120) / 400))) * 10, 1, 0, clamp01((t - 120) / 300) * (1 - ke));
      if (sub) {
        sub.alpha = clamp01((t - 300) / 300) * (1 - ke);
        sub.position.set(0, sy);
      }
      return;
    }
    const kin = clamp01(t / (170 * slow));
    band.scale.set(1, ke > 0 ? 1 - Ease.inBack(ke) : Ease.outBack(kin));
    band.x = (1 - Ease.outCubic(kin)) * W * 0.5;
    band.alpha = 1 - ke * ke;
    if (streaks) streaks.tilePosition.x -= dt * (style === 'defeat' ? 0.15 : 1.5);
    if (flash) flash.alpha = Math.max(0, 1 - t / 170) * 0.9;
    for (const l of edges) l.alpha = l._main ? 0.75 + 0.25 * Math.sin(t * 0.03) : 0.7;
    if (rays) {
      rays.rotation += dt * 0.0004;
      rays.alpha = 0.7 * clamp01(t / 300) * (1 - ke);
    }
    const tk = clamp01((t - 80 * slow) / (240 * slow));
    let tx = (1 - Ease.outQuart(tk)) * W * 0.95 - (t / 1000) * W * 0.02;
    if (ke > 0) tx -= Ease.inQuart(ke) * W * 1.2;
    placeTitle(title, tx, ty, 1 + 0.04 * clamp01((t - 300) / 1000), -0.12 - (1 - tk) * 0.35, tk > 0 ? 1 : 0);
    if (sub) {
      const sk = clamp01((t - 220 * slow) / (240 * slow));
      sub.position.set(-(1 - Ease.outCubic(sk)) * W * 0.3 + (ke > 0 ? Ease.inQuart(ke) * W : 0), sy);
      sub.alpha = sk * (1 - ke);
      sub.skew.x = -0.08;
    }
  };
  e.end = () => fx._dispose(root);
  return fx._run(e);
}

// ============================================================================ cut-in
/**
 * Anime cut-in: a tilted band slides in from `side` with a zoomed glowing piece "portrait"
 * (pieceColor 1 | -1, king), streaming speed lines, big title (wraps to 2 lines) + subtitle,
 * then slides out. Timing: entrance → o.hold ms with title + subtitle at full size (default
 * fx.readMs([title, subtitle], o.readKind || 'cutin')) → exit; o.duration overrides the length.
 * The portrait and the band use the side's energy colour (fx.sideColor) unless o.color is given.
 */
export function cutIn(fx, o = {}) {
  const classic = !fx.epic;
  const side = o.side === 'right' ? 'right' : 'left';
  const pc = o.pieceColor === -1 ? -1 : 1;
  const color = o.color != null ? o.color : classic ? CLASSIC.gold : typeof fx.sideColor === 'function' ? fx.sideColor(pc) : EPIC.side[pc];
  const scr = fx.renderer.screen;
  const W = scr.width;
  const bh = Math.max(120, Math.min(220, W * 0.4));
  const tSize = Math.round(bh * (classic ? 0.3 : 0.34));
  const sSize = Math.round(bh * 0.13);
  const variant = classic ? 'classic' : 'epic';
  const ts = titleStyle(fx, tSize, color, variant);
  const ss = subStyle(fx, sSize, color, variant);
  const pairs = [];
  if (o.title) pairs.push([ts, o.title]);
  if (o.subtitle) pairs.push([ss, o.subtitle]);
  let gs = null;
  if (o.tag) {
    gs = subStyle(fx, Math.round(Math.max(13, bh * 0.1)), EPIC.gold, variant);
    pairs.push([gs, o.tag]);
  }
  return withFonts(fx, pairs, () => cutInNow(fx, o, { classic, side, pc, color, bh, ts, ss, gs }));
}

/** Break a subtitle into ≤ 2 balanced lines when one line would shrink below ~85 %. */
function splitSub(style, text, maxW) {
  const one = measureText(style, text);
  if (one <= maxW * 1.15 || !text.includes(' ')) return [text];
  const words = text.split(' ');
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const L = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    const m = Math.max(...L.map((l) => measureText(style, l)));
    if (!best || m < best.m) best = { m, lines: L };
  }
  return best.lines;
}

function cutInNow(fx, o, P) {
  const { classic, side, pc, color, bh, ts, ss, gs } = P;
  const T = fx.textures;
  const scr = fx.renderer.screen;
  const W = scr.width;
  const H = scr.height;
  const sgn = side === 'left' ? 1 : -1;
  const inDur = classic ? 320 : 170;
  const exitDur = classic ? 320 : 230;
  // the title is at full size ~300 ms in, the subtitle ~480 ms in: the readable hold starts there
  const settle = classic ? 580 : 480;
  const texts = [o.title, o.subtitle].filter(Boolean);
  const hold = o.hold != null ? o.hold : typeof fx.readMs === 'function' ? fx.readMs(texts, o.readKind || 'cutin') : 1800;
  const dur = o.duration || settle + hold + exitDur;
  const e = { cleanup: [], realtime: o.realtime !== false, duration: dur };
  const root = fx._box(fx.c.screenUI, 'cutin');
  const dim = fx._sprite(Texture.WHITE, root);
  dim.anchor.set(0);
  dim.width = W + 4;
  dim.height = H + 4;
  dim.position.set(-2, -2);
  dim.tint = 0x000000;
  dim.alpha = 0;
  const band = fx._box(root, 'cutin-band');
  band.position.set(W / 2, o.y != null ? o.y : H * 0.35);
  band.rotation = classic ? 0 : -0.16 * sgn;
  const bw = W * 2.4;
  const content = fx._box(band, 'cutin-content');
  const mask = new Graphics();
  mask.rect(-bw / 2, -bh / 2, bw, bh).fill(0xffffff);
  band.addChild(mask);
  content.mask = mask;
  const bg = fx._sprite(T.band(color, classic ? 'classic' : 'epic'), content);
  bg.width = bw;
  bg.height = classic ? bh * 1.3 : bh;
  let streaks = null;
  if (!classic) {
    streaks = new TilingSprite({ texture: T.bandStreaks(), width: bw, height: bh });
    streaks.anchor.set(0.5);
    streaks.blendMode = 'add';
    streaks.alpha = 0.45;
    content.addChild(streaks);
  }
  // portrait: zoomed piece emblem, cropped by the band
  const pSize = Math.round(bh * 1.95);
  const texSize = Math.min(320, pSize);
  const portrait = fx._sprite(T.emblem(pc, { epic: !classic, king: !!o.king, size: texSize, color: classic ? undefined : o.portraitColor != null ? o.portraitColor : color }), content);
  const pBase = pSize / texSize;
  const px0 = -sgn * W * 0.33;
  portrait.position.set(px0, bh * 0.2);
  let pGlow = null;
  let pRays = null;
  if (!classic) {
    pRays = fx._sprite(T.rays(), content);
    pRays.blendMode = 'add';
    pRays.tint = color;
    pRays.alpha = 0.55;
    content.setChildIndex(pRays, content.getChildIndex(portrait));
    pGlow = fx._sprite(T.frame('dot'), content);
    pGlow.blendMode = 'add';
    pGlow.tint = color;
    pGlow.alpha = 0.5;
  }
  const edges = [];
  for (const y of classic ? [-bh * 0.42, bh * 0.42] : [-bh / 2, bh / 2]) {
    const l = fx._sprite(Texture.WHITE, band);
    l.width = bw;
    l.height = classic ? 1.2 : 4;
    l.y = y;
    l.tint = classic ? CLASSIC.gold : 0xffffff;
    l.blendMode = classic ? 'normal' : 'add';
    l._main = true;
    edges.push(l);
    if (!classic) {
      const l2 = fx._sprite(Texture.WHITE, band);
      l2.width = bw;
      l2.height = 2;
      l2.y = y + Math.sign(y) * 8;
      l2.tint = color;
      l2.blendMode = 'add';
      edges.push(l2);
    }
  }
  let glint = null;
  let glintFlare = null;
  if (!classic) {
    glint = fx._sprite(T.frame('star'), band);
    glint.blendMode = 'add';
    glint.alpha = 0;
    glintFlare = fx._sprite(T.frame('flare'), band);
    glintFlare.blendMode = 'add';
    glintFlare.alpha = 0;
  }
  const textBox = fx._box(band, 'cutin-text');
  const tx0 = sgn * W * 0.13;
  // subtitle: wrap to ≤ 2 lines first, never shrink below 13 CSS px (EAD-10)
  let subs = [];
  let sScale = 1;
  const subMaxW = W * 0.64;
  if (o.subtitle) {
    const lines = splitSub(ss, o.subtitle, subMaxW);
    subs = lines.map((l) => fx._textSprite(l, ss, textBox, e));
    const wMax = Math.max(...subs.map((sp) => sp.texture.fx.textWidth));
    sScale = Math.max(Math.min(1, 13 / ss.size), Math.min(1, subMaxW / wMax));
    for (const sp of subs) sp.scale.set(sScale);
  }
  const subLineH = ss.size * sScale * 1.12;
  const subH = subs.length ? subLineH * subs.length + ss.size * sScale * 0.15 : 0;
  const title = o.title ? makeTitle(fx, o.title, ts, W * 0.68, textBox, e, 0.8, bh * (subs.length ? (subs.length > 1 ? 0.56 : 0.66) : 0.82)) : null;
  const tH = title ? title.height : 0;
  const ty = -subH * 0.5;
  const sy = ty + tH / 2 + subH * 0.5;
  const sub = subs.length ? subs : null;
  // small gold tag plate above the band («УЛЬТА · ЯРОСТЬ 100%»)
  let tag = null;
  if (o.tag && gs) {
    tag = fx._box(band, 'cutin-tag');
    const tsp = fx._textSprite(o.tag, gs, null, e);
    const tw2 = tsp.texture.fx.textWidth;
    const th2 = gs.size * 1.5;
    const pw = tw2 + gs.size * 1.6;
    const g = new Graphics();
    g.poly([-pw / 2 + th2 * 0.3, -th2 / 2, pw / 2 + th2 * 0.3, -th2 / 2, pw / 2 - th2 * 0.3, th2 / 2, -pw / 2 - th2 * 0.3, th2 / 2], true).fill({ color: 0x05030c, alpha: 0.92 });
    g.poly([-pw / 2 + th2 * 0.3, -th2 / 2, pw / 2 + th2 * 0.3, -th2 / 2, pw / 2 - th2 * 0.3, th2 / 2, -pw / 2 - th2 * 0.3, th2 / 2], true).stroke({ width: 2, color: EPIC.gold, alpha: 1 });
    tag.addChild(g, tsp);
    tag.position.set(tx0 + sgn * W * 0.06, -bh / 2 - th2 * 0.15);
    tag.alpha = 0;
  }
  e.update = (dt, t) => {
    const exitStart = e.duration - exitDur;
    const kin = clamp01(t / inDur);
    const ke = t > exitStart ? clamp01((t - exitStart) / exitDur) : 0;
    // o.dim: lighter when the action keeps playing beside the band (finale / ULTIMATE)
    dim.alpha = (o.dim != null ? o.dim : classic ? 0.35 : 0.5) * Ease.outCubic(kin) * (1 - ke);
    if (classic) {
      band.alpha = kin * (1 - ke);
      band.x = W / 2 - sgn * (1 - Ease.outCubic(kin)) * 40 + sgn * ke * 40;
    } else {
      band.x = W / 2 - sgn * (1 - Ease.outQuart(kin)) * W * 1.3 + sgn * Ease.inQuart(ke) * W * 1.4 + sgn * (t / 1000) * W * 0.02;
      band.scale.y = 1 - 0.6 * Ease.inQuad(ke);
    }
    if (streaks) streaks.tilePosition.x += dt * 1.8 * sgn;
    const pk = clamp01(t / e.duration);
    portrait.x = px0 + sgn * pk * W * 0.06;
    portrait.scale.set(pBase * (1.14 - 0.12 * Ease.outCubic(pk)));
    portrait.rotation = -0.05 * sgn + pk * 0.08 * sgn;
    if (pGlow) {
      pGlow.position.copyFrom(portrait.position);
      pGlow.scale.set((pSize * 1.1) / 64);
      pGlow.alpha = 0.45 + 0.15 * Math.sin(t * 0.02);
      pRays.position.copyFrom(portrait.position);
      pRays.scale.set((pSize * 1.5) / 256);
      pRays.rotation = t * 0.0006;
    }
    if (glint) {
      const gk = clamp01((t - Math.min(900, e.duration * 0.32)) / 300);
      const ga = gk > 0 && gk < 1 ? Math.sin(Math.PI * gk) : 0;
      glint.position.set(portrait.x, portrait.y);
      glint.scale.set((bh * 1.3 * ga) / 64);
      glint.rotation = gk * 1.2;
      glint.alpha = ga;
      glintFlare.position.set(portrait.x, portrait.y);
      glintFlare.scale.set((W * 1.4 * ga) / 128, (bh * 0.2) / 24);
      glintFlare.alpha = ga * 0.9;
    }
    if (title) {
      const tk = clamp01((t - (classic ? 160 : 110)) / (classic ? 360 : 180));
      if (classic) {
        placeTitle(title, tx0, ty + (1 - Ease.outCubic(tk)) * 8, 1, 0, tk * (1 - ke));
      } else {
        const amp = bh * 0.03 * Math.max(0, 1 - (t - 110) / 380);
        placeTitle(
          title,
          tx0 + (Math.random() - 0.5) * amp,
          ty + (Math.random() - 0.5) * amp,
          1 + 0.6 * (1 - Ease.outBack(tk)),
          -0.12,
          tk > 0 ? Math.min(1, tk * 3) : 0
        );
      }
    }
    if (sub) {
      const sk = clamp01((t - (classic ? 320 : 220)) / 260);
      for (let i = 0; i < sub.length; i++) {
        const sp = sub[i];
        sp.alpha = sk * (1 - ke);
        sp.position.set(tx0 - sgn * (1 - Ease.outCubic(sk)) * W * 0.18, sy + (i - (sub.length - 1) / 2) * subLineH);
        if (!classic) sp.skew.x = -0.12;
      }
    }
    if (tag) {
      const gk = clamp01((t - 90) / 200);
      tag.alpha = gk * (1 - ke);
      tag.scale.set(0.7 + 0.3 * Ease.outBack(gk));
    }
    for (const l of edges) if (l._main) l.alpha = 0.85 + 0.15 * Math.sin(t * 0.04);
  };
  e.end = () => fx._dispose(root);
  return fx._run(e);
}


// ============================================================================ combo counter
const COMBO_TIERS = [
  { n: 2, color: EPIC.white },
  { n: 3, color: EPIC.gold },
  { n: 4, color: 0xff8a3d },
  { n: 5, color: EPIC.black },
  { n: 7, color: 0xff2edb },
];

function tierColor(n) {
  let c = COMBO_TIERS[0].color;
  for (const t of COMBO_TIERS) if (n >= t.n) c = t.color;
  return c;
}

/**
 * Fighting-game combo counter («КОМБО ×3» / "3 HIT COMBO!"). Each call punches the number in
 * bigger; the counter hides `hold` ms after the last call. Resolves when it has hidden.
 * Placement: by default inside the top-left / top-right corner of the board frame (`side`).
 * o.at = { x, y } puts it at a screen point instead (x = the outer edge on `side`, y = the vertical
 * centre of the block) and o.fit = max block height (px), e.g. a free lane above / below the board.
 * Russian reads «КОМБО» above «×3»; English "3" above "HIT COMBO!".
 */
export function comboCounter(fx, n, o = {}) {
  const scr = fx.renderer.screen;
  const W = scr.width;
  const color = o.color != null ? o.color : fx.epic ? tierColor(n) : CLASSIC.gold;
  const numSize = Math.round(Math.max(52, Math.min(100, W * 0.19)));
  const labSize = Math.round(numSize * 0.34);
  const ns = comboNumStyle(fx, numSize, color);
  const ls = comboLabelStyle(fx, labSize, color);
  const ru = fx.lang !== 'en';
  const numText = ru ? `×${n}` : `${n}`;
  const label = o.label || (ru ? 'КОМБО' : 'HIT COMBO!');
  return withFonts(fx, [[ns, numText], [ls, label]], () => comboNow(fx, n, o, { ns, ls, numText, label, color, numSize, labSize, above: ru }));
}

function comboNow(fx, n, o, P) {
  const scr = fx.renderer.screen;
  const W = scr.width;
  const side = o.side === 'right' ? 'right' : 'left';
  const sgn = side === 'left' ? 1 : -1;
  let C = fx.combo;
  if (!C || C.dead) {
    const fr = fx.renderer.frameBounds;
    const root = fx._box(fx.c.screenUI, 'combo');
    let x0;
    let y0;
    if (o.at) {
      x0 = o.at.x;
      y0 = o.at.y;
    } else {
      x0 = side === 'left' ? Math.max(10, fr.x + 4) : Math.min(W - 10, fr.x + fr.width - 4);
      y0 = fr.height > 0 ? fr.y + Math.min(fr.height * 0.16, 90) : scr.height * 0.25;
    }
    root.position.set(x0, y0);
    C = fx.combo = {
      root,
      x0,
      y0,
      fit: o.fit || 0,
      centred: !!o.at,
      side,
      sgn,
      num: null,
      numFlash: null,
      label: null,
      waiters: [],
      since: 0,
      life: 0,
      hold: 1700,
      dead: false,
      e: null,
      exitT: -1,
      n: 0,
      emitAcc: 0,
    };
    const e = { cleanup: [], realtime: true };
    C.e = e;
    e.update = (dt) => comboUpdate(fx, C, dt);
    e.end = (completed) => {
      C.dead = true;
      if (C.num) fx.textures.releaseText(C.num.texture);
      if (C.label) fx.textures.releaseText(C.label.texture);
      fx._dispose(C.root);
      if (fx.combo === C) fx.combo = null;
      for (const w of C.waiters) w(completed);
      C.waiters.length = 0;
    };
    fx._run(e);
  }
  // (re)build the number
  const T = fx.textures;
  if (C.num) T.releaseText(C.num.texture);
  const tex = T.text(P.numText, P.ns);
  if (!C.num) {
    C.num = fx._sprite(tex, C.root);
    C.numFlash = fx._sprite(tex, C.root);
    C.numFlash.blendMode = 'add';
  } else {
    C.num.texture = tex;
    C.numFlash.texture = tex;
  }
  C.num.anchor.set(side === 'left' ? 0 : 1, 0.5);
  C.numFlash.anchor.copyFrom(C.num.anchor);
  if (!C.label || C.labelText !== P.label || C.labelColor !== P.color) {
    if (C.label) {
      T.releaseText(C.label.texture);
      C.label.texture = T.text(P.label, P.ls);
    } else {
      C.label = fx._sprite(T.text(P.label, P.ls), C.root);
    }
    C.labelText = P.label;
    C.labelColor = P.color;
    C.label.anchor.set(side === 'left' ? 0 : 1, 0.5);
  }
  C.n = n;
  C.since = 0;
  C.exitT = -1;
  // readable after the last hit (settings.textTime): «КОМБО ×3» stays up ≥ 2.2 s × textTime
  C.hold = o.hold != null ? o.hold : typeof fx.readMs === 'function' ? fx.readMs(`${P.label} ${P.numText}`, 'combo') : 2200;
  C.base = Math.min(1.35, 1 + 0.08 * Math.max(0, n - 2));
  C.color = P.color;
  C.texW = tex.fx.textWidth;
  C.numSize = P.numSize;
  C.labSize = P.labSize;
  C.above = !!P.above;
  // block extents (relative to the number's centre line) → centre offset and fit scale
  const top = C.above ? -(P.numSize * 0.62 * C.base + P.labSize * 0.6) : -P.numSize * 0.42 * C.base;
  const bottom = C.above ? P.numSize * 0.42 * C.base : P.numSize * 0.62 * C.base + P.labSize * 0.6;
  C.mid = (top + bottom) / 2;
  C.k = C.fit > 0 ? Math.min(1, C.fit / (bottom - top)) : 1;
  if (fx.epic) {
    const cx = C.root.x + C.sgn * C.texW * 0.5 * C.base * (C.k || 1);
    fx.emit('spark', cx, C.root.y, { screen: true, realtime: true, count: 16 + n * 3, color: P.color, speed: 0.9 });
  }
  return new Promise((r) => C.waiters.push(r));
}

function comboUpdate(fx, C, dt) {
  C.since += dt;
  C.life += dt;
  const epic = fx.epic;
  const sgn = C.sgn;
  // entry slide on first appearance
  const ent = clamp01(C.life / 200);
  let x = C.x0 - sgn * (1 - Ease.outCubic(ent)) * 160;
  let alpha = ent;
  if (C.exitT < 0 && C.since > C.hold) C.exitT = 0;
  if (C.exitT >= 0) {
    C.exitT += dt;
    const ke = clamp01(C.exitT / 260);
    x -= sgn * Ease.inQuad(ke) * 200;
    alpha *= 1 - ke;
    if (ke >= 1) return false;
  }
  const pk = clamp01(C.since / 280);
  const punch = epic ? 1 + 0.95 * (1 - Ease.outBack(pk)) : 1 + 0.25 * (1 - Ease.outCubic(pk));
  const s = C.base * punch;
  const amp = epic ? C.numSize * 0.07 * Math.max(0, 1 - C.since / 320) : 0;
  const k = C.k || 1;
  C.root.scale.set(k);
  const y = C.centred ? C.y0 - (C.mid || 0) * k : C.y0;
  C.root.position.set(x + (Math.random() - 0.5) * amp * k, y);
  C.root.alpha = alpha;
  C.num.scale.set(s);
  C.num.skew.x = epic ? -0.14 : 0;
  C.numFlash.scale.set(s);
  C.numFlash.skew.x = C.num.skew.x;
  C.numFlash.alpha = epic ? Math.max(0, 1 - C.since / 170) : 0;
  const w = C.texW * C.base;
  C.label.position.set(sgn * (w * 0.06), (C.above ? -1 : 1) * C.numSize * 0.62 * C.base);
  C.label.skew.x = epic ? -0.14 : 0;
  C.label.scale.set(Math.min(1.15, 0.9 + 0.05 * C.n));
  // burning counter at high combos
  if (epic && C.n >= 4 && C.exitT < 0) {
    const pq = fx.pq || fx.q.mul;
    C.emitAcc += (dt / 1000) * 14 * pq;
    while (C.emitAcc >= 1) {
      C.emitAcc -= 1;
      fx.emit('embers', C.root.x + sgn * Math.random() * w * k, C.root.y + C.numSize * 0.3 * k, {
        screen: true,
        realtime: true,
        count: 1 / pq,
        color: C.color,
        speed: 1.5,
        size: 1.4,
      });
    }
  }
  return true;
}

export function hideCombo(fx, immediate = false) {
  const C = fx.combo;
  if (!C || C.dead) return Promise.resolve(true);
  if (immediate) {
    fx._finish(C.e, false);
    return Promise.resolve(false);
  }
  if (C.exitT < 0) C.exitT = 0;
  return new Promise((r) => C.waiters.push(r));
}

// ============================================================================ menacing
/** 「ゴゴゴ」 floating next to a point (JoJo vibe). Epic only. */
export function menacing(fx, x, y, o = {}) {
  if (!fx.epic) return fx._done();
  const sq = fx.sq;
  const color = o.color != null ? o.color : 0xb44dff;
  const size = Math.round(Math.max(22, sq * (o.size || 0.95)));
  const st = menacingStyle(fx, size, color);
  const text = o.text || 'ゴ';
  return withFonts(fx, [[st, text]], () => menacingNow(fx, x, y, o, st, size, text, color));
}

function menacingNow(fx, x, y, o, st, size, text, color) {
  const sq = fx.sq;
  const count = o.count || 4;
  const dur = o.duration || 1700;
  const e = { cleanup: [], duration: dur, realtime: !!o.realtime };
  const root = fx._box(fx.c.worldOver, 'menacing');
  root.position.set(x, y);
  // side with more room on screen
  const p = fx._w2s(x, y, { x: 0, y: 0 });
  const side = o.side || (p.x > fx.renderer.screen.width * 0.6 ? -1 : 1);
  const haze = fx._sprite(fx.textures.frame('dot'), root);
  haze.tint = shadeHex(color, 0.35);
  haze.alpha = 0;
  haze.position.set(side * sq * 0.9, -sq * 0.6);
  const glyphs = [];
  for (let i = 0; i < count; i++) {
    const s = fx._textSprite(text, st, root, e, 100 + i * 17);
    const gx = side * (sq * (0.85 + 0.42 * i) + (Math.random() - 0.5) * sq * 0.18);
    const gy = sq * (0.35 - 0.95 * i) + (Math.random() - 0.5) * sq * 0.12;
    s.position.set(gx, gy);
    s.alpha = 0;
    s.scale.set(0);
    glyphs.push({ s, gx, gy, t0: i * 140, rot: (Math.random() - 0.5) * 0.35, ph: Math.random() * TAU, sc: 0.85 + i * 0.08 });
  }
  e.update = (dt, t, k) => {
    haze.scale.set((sq * 3.4) / 64, (sq * 3.8) / 64);
    haze.alpha = 0.5 * clamp01(t / 300) * (k > 0.75 ? (1 - k) / 0.25 : 1);
    for (const g of glyphs) {
      const lt = t - g.t0;
      if (lt < 0) continue;
      const pop = clamp01(lt / 220);
      const throb = 1 + 0.07 * Math.sin(lt * 0.028 + g.ph);
      g.s.scale.set(g.sc * Ease.outBack(pop) * throb, g.sc * Ease.outBack(pop) * (2 - throb));
      g.s.rotation = g.rot + 0.05 * Math.sin(lt * 0.011 + g.ph);
      g.s.skew.x = -0.15;
      g.s.position.set(g.gx + Math.sin(lt * 0.004 + g.ph) * sq * 0.05, g.gy - (lt / 1000) * sq * 0.35);
      g.s.alpha = Math.min(1, lt / 80) * (k > 0.72 ? Math.max(0, (1 - k) / 0.28) : 1);
    }
  };
  e.end = () => fx._dispose(root);
  return fx._run(e);
}
