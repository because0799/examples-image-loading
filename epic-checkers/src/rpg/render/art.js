// «Валькирии доски» — procedural art of the battle view (offscreen 2D canvas → Pixi textures).
//
//   loadImage(url)                 cached HTMLImageElement promise (null on error / without a DOM)
//   new IconAtlas(res)             ONE texture with every small shape the view draws: token parts
//                                  (shadow, rings, crown, shield bubble, ice block), element badges,
//                                  seals, status chips, highlight marks and ~40 VFX shapes
//                                  (feathers, leaves, crows, anvil, wings, sun, waves …)
//   new TokenAtlas(cellPx)         per-battle portraits: circular token art + rarity frame (+ the
//                                  «Отражение» look for reflections), placeholder until the WebP
//                                  arrives, then repainted in place (one texture → one batch)
//   paintBoard(theme, layout, res) the arena board (frame + 64 tiles) as one texture
//   new GlyphFont(style, res)      digit atlases for floating numbers (white = tintable, gold crit,
//                                  two-colour reaction gradients); pooled sprites compose numbers
//   vignetteTexture()              soft top/bottom darkening for the background
//
// Without a DOM (Node tests) every builder falls back to Texture.WHITE frames, so the view logic
// stays testable. Nothing here allocates per frame.

import { Texture, Rectangle, ImageSource } from 'pixi.js';
import { makeCanvas, textureFromCanvas } from '../../render/canvas.js';
import { ELEMENT_FX, STATUS_FX, RARITY_FX, css, mix, shade } from './theme.js';

export const hasDom = () => typeof document !== 'undefined' && typeof document.createElement === 'function';
const TAU = Math.PI * 2;
const rgba = (h, a = 1) => `rgba(${(h >> 16) & 255},${(h >> 8) & 255},${h & 255},${a})`;

// ============================================================================ images
const imageCache = new Map();

/** Cached image load. Resolves the decoded HTMLImageElement, or null (missing file / no DOM). */
export function loadImage(url) {
  if (!url || !hasDom() || typeof Image === 'undefined') return Promise.resolve(null);
  let p = imageCache.get(url);
  if (p) return p;
  p = new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      // decode() can wait for a frame that never comes (paused app, frozen test clock): cap it
      if (typeof img.decode === 'function') {
        const t = setTimeout(() => resolve(img), 250);
        img.decode().then(
          () => {
            clearTimeout(t);
            resolve(img);
          },
          () => {
            clearTimeout(t);
            resolve(img);
          },
        );
      } else resolve(img);
    };
    img.onerror = () => {
      imageCache.delete(url); // allow a later retry
      resolve(null);
    };
    img.src = url;
  });
  imageCache.set(url, p);
  return p;
}

/** A Pixi texture for a loaded image (caller owns it: destroy(true) frees the GPU copy). */
export function imageTexture(img, label = 'rpg-image') {
  if (!img) return Texture.WHITE;
  const source = new ImageSource({ resource: img, label, autoGenerateMipmaps: false });
  return new Texture({ source, label });
}

// ============================================================================ helpers
function paint(w, h, res, draw) {
  const c = makeCanvas(Math.ceil(w * res), Math.ceil(h * res));
  const ctx = c.getContext('2d');
  ctx.scale(c.width / w, c.height / h);
  draw(ctx, w, h);
  return c;
}

function radial(ctx, cx, cy, r, stops) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

function poly(ctx, pts, close = true) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  if (close) ctx.closePath();
}

function starPath(ctx, cx, cy, spikes, R, r, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const a = rot + (i * Math.PI) / spikes;
    const rr = i % 2 ? r : R;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

function circle(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
}

/** Soft glow behind a path: shadowBlur in device px (ctx is pre-scaled → use k). */
function glow(ctx, color, blur, fn) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur * (ctx.getTransform ? ctx.getTransform().a : 1);
  fn();
  ctx.restore();
}

function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================================ element glyphs
// 24×24 SVG path data (same designs as the HUD icons, rules.js icon briefs).
const EL_GLYPH = {
  flame: [
    { d: 'M12 1.8l10.2 10.2L12 22.2 1.8 12z', stroke: 1.7 },
    { d: 'M12.3 5.6c.5 2.4 3.6 3.9 3.6 7.3a3.9 3.9 0 0 1-7.8 0c0-1.8 1-2.8 1.6-4.2.9.7 1.4 1.7 1.5 2.8.9-1.7 1.4-3.6 1.1-5.9z' },
  ],
  tide: [
    { d: 'M12 2.6c3.9 4.9 6.6 8.3 6.6 12a6.6 6.6 0 0 1-13.2 0c0-3.7 2.7-7.1 6.6-12z' },
    { d: 'M7.6 15.2c1.4-1.1 2.9-1.1 4.4 0s3 1.1 4.4 0', stroke: 1.8, dark: true },
  ],
  frost: [
    { d: 'M12 2v20M3.3 7l17.4 10M3.3 17l17.4-10', stroke: 2 },
    { d: 'M9.6 3.8L12 6.2l2.4-2.4M9.6 20.2L12 17.8l2.4 2.4M4.1 10.4l3.3-.9-.9-3.3M19.9 13.6l-3.3.9.9 3.3M4.1 13.6l3.3.9-.9 3.3M19.9 10.4l-3.3-.9.9-3.3', stroke: 1.8 },
  ],
  storm: [
    { d: 'M2.4 12a9.6 9.6 0 1 0 19.2 0a9.6 9.6 0 1 0 -19.2 0', stroke: 1.7 },
    { d: 'M13.4 4.6L7.6 13h4l-1.2 6.4 6-8.6h-4.1z' },
  ],
  gale: [
    { d: 'M12 12c0-3.6 2.4-6.6 6.4-7.2-1.3 2.4-1.8 4.6-1.4 7.2M12 12c3.1 1.8 4.5 5.4 3 9.1-1.4-2.3-3.1-3.9-5.6-4.8M12 12c-3.1 1.8-6.9 1.2-9.4-1.9 2.7 0 4.9-.6 7-2.4', stroke: 2 },
    { d: 'M10.6 12a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0 -2.8 0' },
  ],
  terra: [
    { d: 'M12 2.2l8.5 4.9v9.8L12 21.8l-8.5-4.9V7.1z' },
    { d: 'M12 2.2v19.6M3.5 7.1l8.5 4.9 8.5-4.9', stroke: 1.3, dark: true },
  ],
  radiance: [
    { d: 'M2.2 12a9.8 9.8 0 1 0 19.6 0a9.8 9.8 0 1 0 -19.6 0', stroke: 1.3 },
    { d: 'M12 3.2l1.6 5.3 4.6-2.9-2.9 4.6 5.3 1.8-5.3 1.6 2.9 4.6-4.6-2.9L12 20.8l-1.6-5.5-4.6 2.9 2.9-4.6L3.2 12l5.5-1.8-2.9-4.6 4.6 2.9z' },
  ],
  umbra: [
    { d: 'M15.8 3.4A9 9 0 1 0 20.6 15 7.2 7.2 0 1 1 15.8 3.4z' },
    { d: 'M17.6 7.4l.7 1.6 1.7.2-1.3 1.1.4 1.7-1.5-.9-1.5.9.4-1.7-1.3-1.1 1.7-.2z' },
  ],
};

/** Draw an element glyph centred at (cx, cy) with size s (the 24-unit box). */
function drawGlyph(ctx, el, cx, cy, s, color, dark = '#0b0820') {
  const parts = EL_GLYPH[el];
  if (!parts || typeof Path2D === 'undefined') return;
  ctx.save();
  ctx.translate(cx - s / 2, cy - s / 2);
  ctx.scale(s / 24, s / 24);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const p of parts) {
    const path = new Path2D(p.d);
    if (p.stroke) {
      ctx.strokeStyle = p.dark ? dark : color;
      ctx.lineWidth = p.stroke;
      ctx.stroke(path);
    } else {
      ctx.fillStyle = p.dark ? dark : color;
      ctx.fill(path);
    }
  }
  ctx.restore();
}

// ============================================================================ icon atlas painters
// Every painter draws WHITE / neutral shapes unless the frame is listed as "coloured" (those are
// drawn in final colours and must not be tinted).
const KANJI_FONT = '"Dela Gothic One", "Noto Sans JP", sans-serif';

const P = {
  shadow(ctx, w, h) {
    ctx.fillStyle = radial(ctx, w / 2, h / 2, w / 2, [
      [0, 'rgba(0,0,0,0.85)'],
      [0.55, 'rgba(0,0,0,0.45)'],
      [1, 'rgba(0,0,0,0)'],
    ]);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(1, h / w);
    ctx.translate(-w / 2, -w / 2);
    circle(ctx, w / 2, w / 2, w / 2);
    ctx.fill();
    ctx.restore();
  },
  disc(ctx, w) {
    circle(ctx, w / 2, w / 2, w / 2 - 1);
    ctx.fillStyle = '#fff';
    ctx.fill();
  },
  dot(ctx, w) {
    ctx.fillStyle = radial(ctx, w / 2, w / 2, w / 2, [
      [0, 'rgba(255,255,255,1)'],
      [0.25, 'rgba(255,255,255,0.75)'],
      [0.6, 'rgba(255,255,255,0.2)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    ctx.fillRect(0, 0, w, w);
  },
  ring(ctx, w) {
    circle(ctx, w / 2, w / 2, w / 2 - 3);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();
  },
  glowRing(ctx, w) {
    const r = w / 2;
    ctx.fillStyle = radial(ctx, r, r, r, [
      [0, 'rgba(255,255,255,0)'],
      [0.58, 'rgba(255,255,255,0)'],
      [0.74, 'rgba(255,255,255,0.85)'],
      [0.8, 'rgba(255,255,255,0.6)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    ctx.fillRect(0, 0, w, w);
  },
  groundRing(ctx, w, h) {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(1, h / w);
    const r = w / 2;
    ctx.fillStyle = radial(ctx, 0, 0, r, [
      [0, 'rgba(255,255,255,0.18)'],
      [0.62, 'rgba(255,255,255,0.12)'],
      [0.8, 'rgba(255,255,255,0.95)'],
      [0.88, 'rgba(255,255,255,0.5)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    circle(ctx, 0, 0, r);
    ctx.fill();
    ctx.restore();
  },
  sheen(ctx, w) {
    // a ring that is bright on one side only: rotated over the Mythic frame
    const r = w / 2;
    ctx.save();
    ctx.translate(r, r);
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU;
      const k = Math.pow(Math.max(0, Math.cos(a)), 6);
      if (k < 0.02) continue;
      ctx.strokeStyle = `rgba(255,255,255,${(k * 0.95).toFixed(3)})`;
      ctx.lineWidth = w * 0.07;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.86, a - 0.07, a + 0.07);
      ctx.stroke();
    }
    ctx.restore();
  },
  crown(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#fff6c8');
    g.addColorStop(0.45, '#ffd23f');
    g.addColorStop(1, '#a8670a');
    poly(ctx, [w * 0.08, h * 0.9, w * 0.04, h * 0.28, w * 0.3, h * 0.55, w * 0.5, h * 0.08, w * 0.7, h * 0.55, w * 0.96, h * 0.28, w * 0.92, h * 0.9]);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#4a2a00';
    ctx.lineJoin = 'round';
    ctx.stroke();
    for (const [x, y, c] of [[0.5, 0.62, '#ff4f6a'], [0.25, 0.7, '#6af0ff'], [0.75, 0.7, '#6af0ff']]) {
      circle(ctx, w * x, h * y, w * 0.06);
      ctx.fillStyle = c;
      ctx.fill();
    }
  },
  halo(ctx, w, h) {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(1, h / w);
    ctx.lineWidth = w * 0.07;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    circle(ctx, 0, 0, w * 0.42);
    ctx.stroke();
    ctx.lineWidth = w * 0.16;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.stroke();
    ctx.restore();
  },
  hexBubble(ctx, w) {
    const r = w / 2 - 2;
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i * TAU) / 6;
      pts.push(w / 2 + Math.cos(a) * r, w / 2 + Math.sin(a) * r);
    }
    poly(ctx, pts);
    ctx.fillStyle = radial(ctx, w / 2, w / 2, r, [
      [0, 'rgba(255,255,255,0.05)'],
      [0.7, 'rgba(255,255,255,0.18)'],
      [1, 'rgba(255,255,255,0.55)'],
    ]);
    ctx.fill();
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineJoin = 'round';
    ctx.stroke();
    // inner facets
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 6; i += 2) {
      ctx.beginPath();
      ctx.moveTo(w / 2, w / 2);
      ctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
      ctx.stroke();
    }
  },
  iceBlock(ctx, w) {
    const m = w * 0.06;
    const g = ctx.createLinearGradient(0, 0, w, w);
    g.addColorStop(0, 'rgba(230,252,255,0.75)');
    g.addColorStop(0.5, 'rgba(150,225,255,0.45)');
    g.addColorStop(1, 'rgba(90,170,230,0.7)');
    poly(ctx, [m + w * 0.12, m, w - m, m + w * 0.06, w - m - w * 0.04, w - m - w * 0.1, w - m - w * 0.16, w - m, m, w - m - w * 0.05, m + w * 0.04, m + w * 0.14]);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = 'rgba(240,255,255,0.95)';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    poly(ctx, [w * 0.22, w * 0.2, w * 0.45, w * 0.16, w * 0.3, w * 0.42], false);
    ctx.stroke();
    poly(ctx, [w * 0.62, w * 0.78, w * 0.8, w * 0.6], false);
    ctx.stroke();
  },
  stunStar(ctx, w) {
    starPath(ctx, w / 2, w / 2, 5, w * 0.48, w * 0.2);
    ctx.fillStyle = '#ffe14d';
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#7a4a00';
    ctx.stroke();
  },
  star4(ctx, w) {
    ctx.fillStyle = radial(ctx, w / 2, w / 2, w / 2, [
      [0, 'rgba(255,255,255,1)'],
      [0.25, 'rgba(255,255,255,0.8)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    starPath(ctx, w / 2, w / 2, 4, w / 2, w * 0.07);
    ctx.fill();
  },
  burst(ctx, w) {
    starPath(ctx, w / 2, w / 2, 12, w / 2 - 1, w * 0.3, 0);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fill();
  },
  spark(ctx, w) {
    starPath(ctx, w / 2, w / 2, 4, w / 2, w * 0.12);
    ctx.fillStyle = '#fff';
    ctx.fill();
  },
  moveDot(ctx, w) {
    ctx.fillStyle = radial(ctx, w / 2, w / 2, w / 2, [
      [0, 'rgba(255,255,255,1)'],
      [0.35, 'rgba(255,255,255,0.95)'],
      [0.45, 'rgba(255,255,255,0.35)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    ctx.fillRect(0, 0, w, w);
  },
  reticle(ctx, w) {
    const m = 3;
    const L = w * 0.28;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    for (const [x, y, dx, dy] of [[m, m, 1, 1], [w - m, m, -1, 1], [m, w - m, 1, -1], [w - m, w - m, -1, -1]]) {
      ctx.beginPath();
      ctx.moveTo(x, y + dy * L);
      ctx.lineTo(x, y);
      ctx.lineTo(x + dx * L, y);
      ctx.stroke();
    }
    circle(ctx, w / 2, w / 2, w * 0.07);
    ctx.fillStyle = '#fff';
    ctx.fill();
  },
  square(ctx, w) {
    const m = 1.5;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(m, m, w - 2 * m, w - 2 * m);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(m + 1, m + 1, w - 2 * m - 2, w - 2 * m - 2);
  },
  dash(ctx, w, h) {
    ctx.fillStyle = '#fff';
    const r = h / 2;
    ctx.beginPath();
    ctx.arc(r, r, r, Math.PI / 2, -Math.PI / 2);
    ctx.lineTo(w - r, 0);
    ctx.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2);
    ctx.closePath();
    ctx.fill();
  },
  selRing(ctx, w) {
    const r = w / 2 - 3;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const a = (i * TAU) / 6;
      ctx.beginPath();
      ctx.arc(w / 2, w / 2, r, a + 0.12, a + TAU / 6 - 0.12);
      ctx.stroke();
    }
  },
  skull(ctx, w) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(w / 2, w * 0.42, w * 0.36, Math.PI * 0.85, Math.PI * 2.15);
    ctx.lineTo(w * 0.7, w * 0.86);
    ctx.lineTo(w * 0.3, w * 0.86);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#000';
    circle(ctx, w * 0.36, w * 0.46, w * 0.1);
    ctx.fill();
    circle(ctx, w * 0.64, w * 0.46, w * 0.1);
    ctx.fill();
  },
  boltIcon(ctx, w) {
    poly(ctx, [w * 0.6, w * 0.04, w * 0.14, w * 0.58, w * 0.46, w * 0.58, w * 0.36, w * 0.96, w * 0.86, w * 0.38, w * 0.54, w * 0.38]);
    ctx.fillStyle = '#fff';
    ctx.fill();
  },
  shieldIcon(ctx, w) {
    const r = w / 2 - 2;
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i * TAU) / 6;
      pts.push(w / 2 + Math.cos(a) * r, w / 2 + Math.sin(a) * r);
    }
    poly(ctx, pts);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = w * 0.1;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    poly(ctx, pts.map((v, i) => (i % 2 ? w / 2 + (v - w / 2) * 0.55 : w / 2 + (v - w / 2) * 0.55)));
    ctx.stroke();
  },
  // ------------------------------------------------------------------ VFX shapes (white, tint)
  feather(ctx, w, h) {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.moveTo(0, -h * 0.48);
    ctx.bezierCurveTo(w * 0.42, -h * 0.25, w * 0.32, h * 0.25, 0, h * 0.42);
    ctx.bezierCurveTo(-w * 0.32, h * 0.25, -w * 0.42, -h * 0.25, 0, -h * 0.48);
    ctx.fill();
    ctx.strokeStyle = 'rgba(180,190,210,0.9)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -h * 0.44);
    ctx.lineTo(0, h * 0.5);
    ctx.stroke();
    ctx.lineWidth = 0.7;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i * h * 0.1);
      ctx.lineTo((i % 2 ? 1 : -1) * w * 0.28, i * h * 0.1 - h * 0.06);
      ctx.stroke();
    }
    ctx.restore();
  },
  leaf(ctx, w) {
    // maple leaf
    const c = w / 2;
    ctx.save();
    ctx.translate(c, c);
    ctx.beginPath();
    const lobes = [[0, -0.48], [0.14, -0.22], [0.42, -0.3], [0.3, -0.06], [0.46, 0.08], [0.18, 0.12], [0.1, 0.3], [0, 0.18], [-0.1, 0.3], [-0.18, 0.12], [-0.46, 0.08], [-0.3, -0.06], [-0.42, -0.3], [-0.14, -0.22]];
    lobes.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * w) : ctx.moveTo(x * w, y * w)));
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, w * 0.46);
    ctx.lineTo(0, -w * 0.3);
    ctx.moveTo(0, 0);
    ctx.lineTo(w * 0.3, -w * 0.16);
    ctx.moveTo(0, 0);
    ctx.lineTo(-w * 0.3, -w * 0.16);
    ctx.stroke();
    ctx.restore();
  },
  snowflake(ctx, w) {
    ctx.save();
    ctx.translate(w / 2, w / 2);
    ctx.strokeStyle = '#fff';
    ctx.lineCap = 'round';
    ctx.lineWidth = w * 0.07;
    for (let i = 0; i < 6; i++) {
      ctx.rotate(TAU / 6);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -w * 0.44);
      ctx.moveTo(0, -w * 0.26);
      ctx.lineTo(w * 0.12, -w * 0.36);
      ctx.moveTo(0, -w * 0.26);
      ctx.lineTo(-w * 0.12, -w * 0.36);
      ctx.stroke();
    }
    ctx.restore();
  },
  crystal(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(200,200,200,0.8)');
    poly(ctx, [w * 0.5, 0, w * 0.92, h * 0.2, w * 0.92, h * 0.86, w * 0.5, h, w * 0.08, h * 0.86, w * 0.08, h * 0.2]);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(80,60,40,0.5)';
    ctx.lineWidth = 1;
    poly(ctx, [w * 0.5, 0, w * 0.5, h], false);
    ctx.stroke();
    poly(ctx, [w * 0.08, h * 0.2, w * 0.5, h * 0.32, w * 0.92, h * 0.2], false);
    ctx.stroke();
  },
  shard(ctx, w, h) {
    poly(ctx, [w * 0.5, 0, w * 0.95, h * 0.78, w * 0.5, h, w * 0.05, h * 0.78]);
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.7)');
    g.addColorStop(0.5, '#fff');
    g.addColorStop(1, 'rgba(210,210,210,0.75)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1;
    poly(ctx, [w * 0.5, 0, w * 0.5, h], false);
    ctx.stroke();
  },
  rockSpike(ctx, w, h) {
    // coloured (stone)
    poly(ctx, [w * 0.5, 0, w * 0.68, h * 0.35, w * 0.95, h, w * 0.05, h, w * 0.3, h * 0.42]);
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#5a4630');
    g.addColorStop(0.45, '#c79a5a');
    g.addColorStop(1, '#3a2c1c');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = '#1e140a';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,231,176,0.8)';
    poly(ctx, [w * 0.5, h * 0.05, w * 0.46, h * 0.6, w * 0.6, h * 0.95], false);
    ctx.stroke();
  },
  boulder(ctx, w) {
    // coloured
    const r = rng(7);
    const pts = [];
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * TAU;
      const rr = w * (0.36 + r() * 0.1);
      pts.push(w / 2 + Math.cos(a) * rr, w / 2 + Math.sin(a) * rr);
    }
    poly(ctx, pts);
    ctx.fillStyle = radial(ctx, w * 0.38, w * 0.34, w * 0.6, [
      [0, '#d8b88a'],
      [0.5, '#8a6a46'],
      [1, '#2e2216'],
    ]);
    ctx.fill();
    ctx.strokeStyle = '#1a120a';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.2;
    poly(ctx, [w * 0.3, w * 0.5, w * 0.48, w * 0.58, w * 0.56, w * 0.74], false);
    ctx.stroke();
  },
  crow(ctx, w, h) {
    // coloured (black silhouette)
    ctx.fillStyle = '#07040c';
    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.55);
    ctx.quadraticCurveTo(w * 0.3, h * 0.1, w * 0.02, h * 0.3);
    ctx.quadraticCurveTo(w * 0.24, h * 0.36, w * 0.34, h * 0.62);
    ctx.quadraticCurveTo(w * 0.42, h * 0.7, w * 0.46, h * 0.86);
    ctx.lineTo(w * 0.54, h * 0.86);
    ctx.quadraticCurveTo(w * 0.58, h * 0.7, w * 0.66, h * 0.62);
    ctx.quadraticCurveTo(w * 0.76, h * 0.36, w * 0.98, h * 0.3);
    ctx.quadraticCurveTo(w * 0.7, h * 0.1, w * 0.5, h * 0.55);
    ctx.fill();
    circle(ctx, w * 0.5, h * 0.5, w * 0.07);
    ctx.fill();
  },
  wing(ctx, w, h) {
    // white angelic wing, root at the bottom-left
    ctx.save();
    ctx.translate(w * 0.06, h * 0.94);
    for (let i = 0; i < 9; i++) {
      const a = -0.25 - i * 0.14;
      const len = w * (0.95 - i * 0.055);
      ctx.save();
      ctx.rotate(a);
      const g = ctx.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.65)');
      g.addColorStop(0.7, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0.4)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(len * 0.5, 0, len * 0.5, h * (0.07 + i * 0.004), 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  },
  anvil(ctx, w, h) {
    // coloured
    ctx.fillStyle = '#2a2a33';
    poly(ctx, [w * 0.04, h * 0.18, w * 0.96, h * 0.18, w * 0.96, h * 0.34, w * 0.68, h * 0.42, w * 0.62, h * 0.66, w * 0.82, h * 0.9, w * 0.18, h * 0.9, w * 0.38, h * 0.66, w * 0.32, h * 0.42, w * 0.04, h * 0.3]);
    ctx.fill();
    ctx.strokeStyle = '#ff9a4a';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(w * 0.08, h * 0.2, w * 0.84, h * 0.04);
  },
  harpoon(ctx, w, h) {
    // coloured, pointing right
    ctx.strokeStyle = '#c9d4e0';
    ctx.lineWidth = h * 0.14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(w * 0.04, h / 2);
    ctx.lineTo(w * 0.78, h / 2);
    ctx.stroke();
    ctx.fillStyle = '#eef6ff';
    poly(ctx, [w, h / 2, w * 0.74, h * 0.08, w * 0.8, h / 2, w * 0.74, h * 0.92]);
    ctx.fill();
    ctx.strokeStyle = '#4a5a70';
    ctx.lineWidth = 1;
    ctx.stroke();
  },
  note(ctx, w) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(w * 0.32, w * 0.76, w * 0.17, w * 0.12, -0.4, 0, TAU);
    ctx.fill();
    ctx.fillRect(w * 0.44, w * 0.12, w * 0.07, w * 0.64);
    ctx.beginPath();
    ctx.moveTo(w * 0.51, w * 0.12);
    ctx.quadraticCurveTo(w * 0.86, w * 0.22, w * 0.78, w * 0.48);
    ctx.quadraticCurveTo(w * 0.74, w * 0.3, w * 0.51, w * 0.3);
    ctx.fill();
  },
  coin(ctx, w) {
    // coloured
    circle(ctx, w / 2, w / 2, w * 0.46);
    ctx.fillStyle = radial(ctx, w * 0.38, w * 0.34, w * 0.6, [
      [0, '#fff6c8'],
      [0.5, '#ffd23f'],
      [1, '#a8670a'],
    ]);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#6a3d00';
    ctx.stroke();
    starPath(ctx, w / 2, w / 2, 5, w * 0.22, w * 0.09);
    ctx.fillStyle = '#8a5200';
    ctx.fill();
  },
  hand(ctx, w, h) {
    // coloured shadow hand reaching up
    ctx.fillStyle = '#2a0a3a';
    ctx.beginPath();
    ctx.moveTo(w * 0.3, h);
    ctx.lineTo(w * 0.28, h * 0.5);
    for (const [x, top] of [[0.24, 0.16], [0.4, 0.04], [0.56, 0.08], [0.72, 0.2]]) {
      ctx.lineTo(w * x, h * 0.46);
      ctx.lineTo(w * x, h * top);
      ctx.lineTo(w * (x + 0.08), h * top);
      ctx.lineTo(w * (x + 0.08), h * 0.46);
    }
    ctx.lineTo(w * 0.86, h * 0.5);
    ctx.lineTo(w * 0.96, h * 0.42);
    ctx.lineTo(w * 0.86, h * 0.68);
    ctx.lineTo(w * 0.72, h);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#d7337e';
    ctx.lineWidth = 1.6;
    ctx.stroke();
  },
  banner(ctx, w, h) {
    // coloured
    ctx.fillStyle = '#c9a04c';
    ctx.fillRect(w * 0.1, h * 0.02, w * 0.06, h * 0.96);
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#2e5aac');
    g.addColorStop(1, '#4f86e8');
    ctx.fillStyle = g;
    poly(ctx, [w * 0.16, h * 0.06, w * 0.95, h * 0.06, w * 0.86, h * 0.36, w * 0.95, h * 0.66, w * 0.16, h * 0.66]);
    ctx.fill();
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 2;
    ctx.stroke();
    starPath(ctx, w * 0.52, h * 0.36, 8, w * 0.18, w * 0.08);
    ctx.fillStyle = '#ffe9a0';
    ctx.fill();
  },
  candle(ctx, w, h) {
    // coloured
    ctx.fillStyle = '#f4ead2';
    ctx.fillRect(w * 0.34, h * 0.45, w * 0.32, h * 0.5);
    ctx.fillStyle = '#c9a04c';
    ctx.fillRect(w * 0.26, h * 0.9, w * 0.48, h * 0.08);
    ctx.fillStyle = radial(ctx, w / 2, h * 0.3, w * 0.4, [
      [0, 'rgba(255,255,230,1)'],
      [0.3, 'rgba(255,214,90,0.9)'],
      [1, 'rgba(255,140,40,0)'],
    ]);
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.3, w * 0.16, h * 0.18, 0, 0, TAU);
    ctx.fill();
  },
  sun(ctx, w) {
    const r = w / 2;
    ctx.fillStyle = radial(ctx, r, r, r, [
      [0, 'rgba(255,255,255,1)'],
      [0.36, 'rgba(255,255,255,1)'],
      [0.42, 'rgba(255,255,255,0.75)'],
      [0.6, 'rgba(255,255,255,0.22)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    ctx.fillRect(0, 0, w, w);
  },
  blackSun(ctx, w) {
    // coloured: black disc with a crimson corona
    const r = w / 2;
    ctx.fillStyle = radial(ctx, r, r, r, [
      [0, 'rgba(0,0,0,1)'],
      [0.4, 'rgba(0,0,0,1)'],
      [0.43, 'rgba(255,60,120,1)'],
      [0.5, 'rgba(215,51,126,0.75)'],
      [0.72, 'rgba(138,124,255,0.25)'],
      [1, 'rgba(60,0,60,0)'],
    ]);
    ctx.fillRect(0, 0, w, w);
  },
  cloud(ctx, w, h) {
    ctx.fillStyle = '#fff';
    for (const [x, y, r] of [[0.25, 0.62, 0.2], [0.42, 0.42, 0.24], [0.62, 0.45, 0.22], [0.78, 0.62, 0.18], [0.5, 0.66, 0.24]]) {
      ctx.beginPath();
      ctx.ellipse(w * x, h * y, w * r, h * r * 1.5, 0, 0, TAU);
      ctx.fill();
    }
  },
  wave(ctx, w, h) {
    // curling crest, white (tint)
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0.25)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.bezierCurveTo(w * 0.1, h * 0.4, w * 0.35, h * 0.05, w * 0.62, h * 0.08);
    ctx.bezierCurveTo(w * 0.86, h * 0.1, w * 0.98, h * 0.3, w * 0.86, h * 0.44);
    ctx.bezierCurveTo(w * 0.8, h * 0.28, w * 0.66, h * 0.26, w * 0.6, h * 0.4);
    ctx.bezierCurveTo(w * 0.56, h * 0.6, w * 0.8, h * 0.8, w, h);
    ctx.closePath();
    ctx.fill();
  },
  phoenix(ctx, w, h) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.18);
    ctx.quadraticCurveTo(w * 0.3, h * 0.02, w * 0.02, h * 0.12);
    ctx.quadraticCurveTo(w * 0.25, h * 0.22, w * 0.38, h * 0.42);
    ctx.quadraticCurveTo(w * 0.3, h * 0.7, w * 0.42, h * 0.98);
    ctx.quadraticCurveTo(w * 0.5, h * 0.72, w * 0.58, h * 0.98);
    ctx.quadraticCurveTo(w * 0.7, h * 0.7, w * 0.62, h * 0.42);
    ctx.quadraticCurveTo(w * 0.75, h * 0.22, w * 0.98, h * 0.12);
    ctx.quadraticCurveTo(w * 0.7, h * 0.02, w * 0.5, h * 0.18);
    ctx.fill();
  },
  stamp(ctx, w) {
    // coloured red seal stamp with 済
    circle(ctx, w / 2, w / 2, w * 0.44);
    ctx.lineWidth = w * 0.07;
    ctx.strokeStyle = '#e8303a';
    ctx.stroke();
    ctx.fillStyle = '#e8303a';
    ctx.font = `${Math.round(w * 0.5)}px ${KANJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('済', w / 2, w * 0.53);
  },
  crescent(ctx, w) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(w / 2, w / 2, w * 0.46, -Math.PI * 0.8, Math.PI * 0.8);
    ctx.arc(w * 0.36, w / 2, w * 0.38, Math.PI * 0.72, -Math.PI * 0.72, true);
    ctx.closePath();
    ctx.fill();
  },
  rune(ctx, w) {
    const r = w / 2;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    circle(ctx, r, r, r - 2);
    ctx.stroke();
    circle(ctx, r, r, r * 0.72);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 8; i++) {
      const a = (i * TAU) / 8;
      const x = r + Math.cos(a) * r * 0.86;
      const y = r + Math.sin(a) * r * 0.86;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(-3, -3);
      ctx.lineTo(3, 0);
      ctx.lineTo(-3, 3);
      ctx.stroke();
      ctx.restore();
    }
    starPath(ctx, r, r, 6, r * 0.5, r * 0.28, 0);
    ctx.stroke();
  },
  voidRift(ctx, w, h) {
    // coloured: dark ellipse with a magenta-violet rim
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(1, h / w);
    const r = w / 2;
    ctx.fillStyle = radial(ctx, 0, 0, r, [
      [0, 'rgba(0,0,0,1)'],
      [0.62, 'rgba(10,0,20,1)'],
      [0.72, 'rgba(215,51,126,1)'],
      [0.8, 'rgba(138,124,255,0.7)'],
      [1, 'rgba(60,0,80,0)'],
    ]);
    circle(ctx, 0, 0, r);
    ctx.fill();
    ctx.restore();
  },
  inkBlob(ctx, w) {
    const r = w / 2;
    ctx.fillStyle = radial(ctx, r, r, r, [
      [0, 'rgba(0,0,0,1)'],
      [0.55, 'rgba(0,0,0,0.85)'],
      [1, 'rgba(0,0,0,0)'],
    ]);
    ctx.fillRect(0, 0, w, w);
  },
  beam(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(0.65, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const v = ctx.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0, 'rgba(0,0,0,1)');
    v.addColorStop(0.2, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  },
  streak(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w * 0.9, 0);
    ctx.lineTo(w, h / 2);
    ctx.lineTo(w * 0.9, h);
    ctx.closePath();
    ctx.fill();
  },
  arrow(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, '#fff');
    ctx.fillStyle = g;
    ctx.fillRect(0, h * 0.42, w * 0.78, h * 0.16);
    poly(ctx, [w, h / 2, w * 0.72, 0, w * 0.78, h / 2, w * 0.72, h]);
    ctx.fillStyle = '#fff';
    ctx.fill();
  },
  chain(ctx, w, h) {
    // coloured chain links
    ctx.strokeStyle = '#d9b26a';
    ctx.lineWidth = h * 0.18;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(w * (0.2 + i * 0.3), h / 2, w * 0.16, h * (i % 2 ? 0.14 : 0.32), 0, 0, TAU);
      ctx.stroke();
    }
  },
  portal(ctx, w) {
    const r = w / 2;
    ctx.save();
    ctx.translate(r, r);
    for (let i = 0; i < 4; i++) {
      ctx.rotate(TAU / 4);
      ctx.strokeStyle = `rgba(255,255,255,${0.9 - i * 0.12})`;
      ctx.lineWidth = 3 - i * 0.4;
      ctx.beginPath();
      ctx.arc(0, 0, r * (0.86 - i * 0.14), 0, Math.PI * 1.2);
      ctx.stroke();
    }
    ctx.restore();
  },
  // ------------------------------------------------------------------ zone / ward art (coloured)
  lava(ctx, w) {
    ctx.fillStyle = radial(ctx, w / 2, w / 2, w * 0.6, [
      [0, 'rgba(255,200,80,0.9)'],
      [0.4, 'rgba(255,90,30,0.75)'],
      [1, 'rgba(80,10,0,0)'],
    ]);
    ctx.fillRect(0, 0, w, w);
    ctx.strokeStyle = 'rgba(255,240,180,0.9)';
    ctx.lineWidth = 1.6;
    const r = rng(3);
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      let x = w / 2;
      let y = w / 2;
      ctx.moveTo(x, y);
      const a = (i / 5) * TAU + r();
      for (let k = 0; k < 3; k++) {
        x += Math.cos(a + (r() - 0.5)) * w * 0.14;
        y += Math.sin(a + (r() - 0.5)) * w * 0.14;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  },
  dew(ctx, w) {
    const r = rng(11);
    for (let i = 0; i < 7; i++) {
      const x = w * (0.2 + r() * 0.6);
      const y = w * (0.2 + r() * 0.6);
      const s = w * (0.05 + r() * 0.05);
      ctx.fillStyle = radial(ctx, x - s * 0.3, y - s * 0.3, s * 1.6, [
        [0, 'rgba(240,255,255,0.95)'],
        [0.4, 'rgba(143,243,255,0.7)'],
        [1, 'rgba(46,139,255,0)'],
      ]);
      circle(ctx, x, y, s * 1.6);
      ctx.fill();
    }
  },
  egg(ctx, w, h) {
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.55, w * 0.34, h * 0.42, 0, 0, TAU);
    ctx.fillStyle = radial(ctx, w * 0.42, h * 0.4, w * 0.6, [
      [0, '#fff2c0'],
      [0.35, '#ffb84a'],
      [0.75, '#e0401e'],
      [1, '#5a0e08'],
    ]);
    ctx.fill();
    ctx.strokeStyle = '#ffe28a';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(90,14,8,0.7)';
    poly(ctx, [w * 0.3, h * 0.5, w * 0.42, h * 0.42, w * 0.5, h * 0.56, w * 0.6, h * 0.44, w * 0.7, h * 0.52], false);
    ctx.stroke();
  },
  pawn(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#5a5470');
    g.addColorStop(0.5, '#b8b2d0');
    g.addColorStop(1, '#3a3450');
    ctx.fillStyle = g;
    circle(ctx, w / 2, h * 0.26, w * 0.18);
    ctx.fill();
    poly(ctx, [w * 0.36, h * 0.42, w * 0.64, h * 0.42, w * 0.72, h * 0.82, w * 0.86, h * 0.96, w * 0.14, h * 0.96, w * 0.28, h * 0.82]);
    ctx.fill();
    ctx.strokeStyle = '#1a1626';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  },
  caravan(ctx, w, h) {
    ctx.fillStyle = '#8a5a2a';
    ctx.fillRect(w * 0.12, h * 0.42, w * 0.76, h * 0.3);
    ctx.fillStyle = '#e8d8b0';
    ctx.beginPath();
    ctx.moveTo(w * 0.12, h * 0.44);
    ctx.quadraticCurveTo(w * 0.5, h * 0.02, w * 0.88, h * 0.44);
    ctx.fill();
    ctx.fillStyle = '#3a2410';
    for (const x of [0.28, 0.72]) {
      circle(ctx, w * x, h * 0.78, w * 0.12);
      ctx.fill();
    }
    ctx.strokeStyle = '#2a1608';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(w * 0.12, h * 0.42, w * 0.76, h * 0.3);
  },
  iceWall(ctx, w, h) {
    for (const [x, ww, hh] of [[0.3, 0.32, 0.8], [0.58, 0.36, 0.95], [0.78, 0.26, 0.66]]) {
      const g = ctx.createLinearGradient(w * (x - ww / 2), 0, w * (x + ww / 2), 0);
      g.addColorStop(0, 'rgba(120,200,240,0.85)');
      g.addColorStop(0.5, 'rgba(235,252,255,0.95)');
      g.addColorStop(1, 'rgba(80,160,220,0.85)');
      ctx.fillStyle = g;
      poly(ctx, [w * x, h * (1 - hh), w * (x + ww / 2), h * (1 - hh * 0.75), w * (x + ww / 2), h, w * (x - ww / 2), h, w * (x - ww / 2), h * (1 - hh * 0.75)]);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  },
  pillar(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#6a5236');
    g.addColorStop(0.45, '#e3c08a');
    g.addColorStop(1, '#4a3622');
    ctx.fillStyle = g;
    ctx.fillRect(w * 0.24, h * 0.14, w * 0.52, h * 0.78);
    ctx.fillStyle = '#c9a46a';
    ctx.fillRect(w * 0.16, h * 0.06, w * 0.68, h * 0.1);
    ctx.fillRect(w * 0.16, h * 0.88, w * 0.68, h * 0.1);
    ctx.strokeStyle = '#2a1c0c';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(w * 0.24, h * 0.14, w * 0.52, h * 0.78);
    ctx.strokeStyle = 'rgba(255,231,176,0.8)';
    for (const y of [0.36, 0.6]) {
      ctx.beginPath();
      ctx.moveTo(w * 0.3, h * y);
      ctx.lineTo(w * 0.7, h * (y + 0.04));
      ctx.stroke();
    }
  },
  orb(ctx, w) {
    ctx.fillStyle = radial(ctx, w / 2, w / 2, w / 2, [
      [0, 'rgba(255,255,255,1)'],
      [0.3, 'rgba(244,233,255,0.95)'],
      [0.55, 'rgba(164,107,255,0.75)'],
      [1, 'rgba(90,40,180,0)'],
    ]);
    ctx.fillRect(0, 0, w, w);
  },
};

/** name → [w, h, painter, coloured?]. Logical px. */
const ICON_FRAMES = [
  ['shadow', 64, 24, P.shadow],
  ['disc', 64, 64, P.disc],
  ['dot', 64, 64, P.dot],
  ['ring', 64, 64, P.ring],
  ['glowRing', 96, 96, P.glowRing],
  ['groundRing', 96, 36, P.groundRing],
  ['sheen', 96, 96, P.sheen],
  ['crown', 40, 28, P.crown, true],
  ['halo', 64, 24, P.halo],
  ['hexBubble', 96, 96, P.hexBubble],
  ['iceBlock', 80, 80, P.iceBlock, true],
  ['stunStar', 20, 20, P.stunStar, true],
  ['star4', 64, 64, P.star4],
  ['burst', 96, 96, P.burst],
  ['spark', 24, 24, P.spark],
  ['moveDot', 32, 32, P.moveDot],
  ['reticle', 64, 64, P.reticle],
  ['square', 32, 32, P.square],
  ['dash', 24, 8, P.dash],
  ['selRing', 96, 96, P.selRing],
  ['skull', 24, 24, P.skull],
  ['boltIcon', 24, 24, P.boltIcon],
  ['shieldIcon', 24, 24, P.shieldIcon],
  ['feather', 20, 44, P.feather],
  ['leaf', 40, 40, P.leaf],
  ['snowflake', 36, 36, P.snowflake],
  ['crystal', 24, 48, P.crystal],
  ['shard', 20, 48, P.shard],
  ['rockSpike', 40, 64, P.rockSpike, true],
  ['boulder', 64, 64, P.boulder, true],
  ['crow', 64, 40, P.crow, true],
  ['wing', 128, 112, P.wing],
  ['anvil', 64, 48, P.anvil, true],
  ['harpoon', 96, 20, P.harpoon, true],
  ['note', 28, 28, P.note],
  ['coin', 32, 32, P.coin, true],
  ['hand', 56, 64, P.hand, true],
  ['banner', 56, 96, P.banner, true],
  ['candle', 24, 40, P.candle, true],
  ['sun', 128, 128, P.sun],
  ['blackSun', 128, 128, P.blackSun, true],
  ['cloud', 96, 48, P.cloud],
  ['wave', 128, 80, P.wave],
  ['phoenix', 96, 80, P.phoenix],
  ['stamp', 40, 40, P.stamp, true],
  ['crescent', 48, 48, P.crescent],
  ['rune', 64, 64, P.rune],
  ['voidRift', 96, 48, P.voidRift, true],
  ['inkBlob', 48, 48, P.inkBlob],
  ['beam', 32, 128, P.beam],
  ['streak', 96, 12, P.streak],
  ['arrow', 64, 14, P.arrow],
  ['chain', 40, 14, P.chain, true],
  ['portal', 64, 64, P.portal],
  ['lava', 64, 64, P.lava, true],
  ['dew', 64, 64, P.dew, true],
  ['egg', 48, 56, P.egg, true],
  ['pawn', 40, 56, P.pawn, true],
  ['caravan', 64, 52, P.caravan, true],
  ['iceWall', 64, 64, P.iceWall, true],
  ['pillar', 40, 72, P.pillar, true],
  ['orb', 48, 48, P.orb, true],
];

// element badges, seals and status chips are added programmatically
function elementBadgePainter(el) {
  const fx = ELEMENT_FX[el];
  return (ctx, w) => {
    const r = w / 2;
    circle(ctx, r, r, r - 1);
    ctx.fillStyle = radial(ctx, r, r * 0.8, r, [
      [0, css(mix(fx.dark, 0x000000, 0.1))],
      [1, css(mix(fx.dark, 0x000000, 0.45))],
    ]);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = css(fx.color);
    ctx.stroke();
    drawGlyph(ctx, el, r, r, w * 0.62, css(fx.accent === 0xffffff ? fx.glow : mix(fx.color, 0xffffff, 0.25)), css(fx.dark));
  };
}

function sealPainter(el) {
  const fx = ELEMENT_FX[el];
  return (ctx, w) => {
    const r = w / 2;
    ctx.fillStyle = radial(ctx, r, r, r, [
      [0, rgba(fx.color, 0.55)],
      [0.6, rgba(fx.color, 0.25)],
      [1, rgba(fx.color, 0)],
    ]);
    ctx.fillRect(0, 0, w, w);
    glow(ctx, css(fx.color), 3, () => drawGlyph(ctx, el, r, r, w * 0.7, css(mix(fx.color, 0xffffff, 0.45)), css(fx.dark)));
  };
}

function statusPainter(id) {
  const st = STATUS_FX[id];
  return (ctx, w) => {
    const r = w / 2;
    circle(ctx, r, r, r - 1);
    const dark = mix(st.color, 0x000000, 0.72);
    ctx.fillStyle = radial(ctx, r, r * 0.7, r, [
      [0, css(mix(st.color, 0x000000, 0.45))],
      [1, css(dark)],
    ]);
    ctx.fill();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = css(st.kind === 'buff' ? mix(st.color, 0xffffff, 0.3) : st.color);
    ctx.stroke();
    ctx.fillStyle = css(mix(st.color, 0xffffff, 0.55));
    ctx.font = `${Math.round(w * 0.58)}px ${KANJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(st.glyph, r, r + w * 0.03);
  };
}

/**
 * One atlas texture for every small shape of the view. frame(name) → Texture (falls back to
 * Texture.WHITE). `coloured(name)` tells whether a frame was painted in final colours.
 */
export class IconAtlas {
  constructor(resolution = 2) {
    this.res = Math.max(1, Math.min(2, resolution));
    this.frames = Object.create(null);
    this.coloured = new Set();
    this.texture = null;
    this.ok = false;
    this._build();
  }

  _build() {
    const items = ICON_FRAMES.map(([name, w, h, draw, col]) => ({ name, w, h, draw, col }));
    for (const el of Object.keys(ELEMENT_FX)) {
      if (el === 'none') continue;
      items.push({ name: `el-${el}`, w: 32, h: 32, draw: elementBadgePainter(el), col: true });
      if (ELEMENT_FX[el].leavesSeal) items.push({ name: `seal-${el}`, w: 32, h: 32, draw: sealPainter(el), col: true });
    }
    for (const id of Object.keys(STATUS_FX)) items.push({ name: `st-${id}`, w: 32, h: 32, draw: statusPainter(id), col: true });
    for (const it of items) if (it.col) this.coloured.add(it.name);
    if (!hasDom()) {
      for (const it of items) this.frames[it.name] = Texture.WHITE;
      return;
    }
    const res = this.res;
    const PAD = 2;
    const W = 512;
    const order = items.slice().sort((a, b) => b.h - a.h || b.w - a.w);
    let x = PAD;
    let y = PAD;
    let rowH = 0;
    for (const it of order) {
      if (x + it.w + PAD > W) {
        x = PAD;
        y += rowH + PAD * 2;
        rowH = 0;
      }
      it.x = x;
      it.y = y;
      x += it.w + PAD * 2;
      rowH = Math.max(rowH, it.h);
    }
    const H = y + rowH + PAD;
    const canvas = makeCanvas(W * res, H * res);
    const ctx = canvas.getContext('2d');
    for (const it of items) {
      try {
        const c = paint(it.w, it.h, res, it.draw);
        ctx.drawImage(c, Math.round(it.x * res), Math.round(it.y * res));
      } catch (e) {
        console.error('[rpg-render] icon painter failed', it.name, e);
      }
    }
    this.texture = textureFromCanvas(canvas, res, { label: 'rpg-icons' });
    const src = this.texture.source;
    for (const it of items) {
      this.frames[it.name] = new Texture({ source: src, frame: new Rectangle(Math.round(it.x * res) / res, Math.round(it.y * res) / res, it.w, it.h), label: `rpg:${it.name}` });
    }
    this.ok = true;
  }

  frame(name) {
    return this.frames[name] || Texture.WHITE;
  }

  destroy() {
    if (this.texture) {
      for (const t of Object.values(this.frames)) if (t !== Texture.WHITE) t.destroy(false);
      this.texture.destroy(true);
    }
    this.frames = Object.create(null);
    this.texture = null;
  }
}

// ============================================================================ token atlas
/**
 * Circular hero portraits for the units of a battle, packed in one canvas texture. A cell is keyed
 * by `${heroId}|${look}` (look: 'hero' | 'reflection' | 'boss' | 'decoy'). paint(key) draws a
 * placeholder at once; when the token WebP arrives the cell is repainted and the GPU copy updated.
 */
export class TokenAtlas {
  constructor({ cellPx = 128, cols = 4, rows = 4, url = null, onUpdate = null } = {}) {
    this.cell = Math.max(32, Math.min(256, Math.round(cellPx)));
    this.cols = cols;
    this.rows = rows;
    this.url = url;
    this.onUpdate = onUpdate;
    this.cells = new Map(); // key -> { index, texture, spec, loaded }
    this.canvas = null;
    this.ctx = null;
    this.texture = null;
    this.destroyed = false;
    if (hasDom()) {
      this.canvas = makeCanvas(this.cell * cols, this.cell * rows);
      this.ctx = this.canvas.getContext('2d');
      this.texture = textureFromCanvas(this.canvas, 1, { label: 'rpg-tokens' });
    }
  }

  get full() {
    return this.cells.size >= this.cols * this.rows;
  }

  /** Texture of a portrait cell (painted on first request). spec = { heroId, rarity, element, look, initial }. */
  get(spec) {
    const key = `${spec.heroId}|${spec.look || 'hero'}`;
    let c = this.cells.get(key);
    if (c) return c.texture;
    if (!this.texture || this.full) return Texture.WHITE;
    const index = this.cells.size;
    const col = index % this.cols;
    const row = Math.floor(index / this.cols);
    const C = this.cell;
    const texture = new Texture({ source: this.texture.source, frame: new Rectangle(col * C, row * C, C, C), label: `rpg-token:${key}` });
    c = { index, texture, spec: { ...spec }, loaded: false, x: col * C, y: row * C };
    this.cells.set(key, c);
    this._paint(c, null);
    const url = this.url ? this.url(spec.heroId) : null;
    if (url) {
      loadImage(url).then((img) => {
        if (this.destroyed || !img || this.cells.get(key) !== c) return;
        c.loaded = true;
        this._paint(c, img);
        this.texture.source.update();
        if (this.onUpdate) this.onUpdate(key);
      });
    }
    return texture;
  }

  _paint(c, img) {
    const ctx = this.ctx;
    if (!ctx) return;
    const C = this.cell;
    ctx.save();
    ctx.clearRect(c.x, c.y, C, C);
    ctx.translate(c.x, c.y);
    paintToken(ctx, C, c.spec, img);
    ctx.restore();
  }

  destroy() {
    this.destroyed = true;
    for (const c of this.cells.values()) c.texture.destroy(false);
    this.cells.clear();
    if (this.texture) this.texture.destroy(true);
    this.texture = null;
  }
}

/** Paint one circular token (portrait + rarity frame) into a C×C box at the origin. */
export function paintToken(ctx, C, spec, img) {
  const R = C / 2;
  const fx = ELEMENT_FX[spec.element] || ELEMENT_FX.none;
  const rar = RARITY_FX[spec.rarity] || RARITY_FX.rare;
  const reflection = spec.look === 'reflection' || spec.look === 'decoy';
  const ring = C * (rar.id === 'legendary' || rar.id === 'mythic' ? 0.085 : 0.07);
  const inner = R - ring - C * 0.01;
  // portrait
  ctx.save();
  circle(ctx, R, R, inner);
  ctx.clip();
  if (img) {
    if (reflection) ctx.filter = 'grayscale(1) contrast(1.15) brightness(0.92)';
    const s = Math.max((inner * 2) / img.width, (inner * 2) / img.height) * 1.04;
    ctx.drawImage(img, R - (img.width * s) / 2, R - (img.height * s) / 2, img.width * s, img.height * s);
    ctx.filter = 'none';
  } else {
    // placeholder: element gradient + initial
    ctx.fillStyle = radial(ctx, R, R * 0.7, R, [
      [0, css(mix(fx.color, 0xffffff, 0.25))],
      [0.6, css(fx.color)],
      [1, css(fx.dark)],
    ]);
    ctx.fillRect(0, 0, C, C);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `${Math.round(C * 0.42)}px "Russo One", "Dela Gothic One", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(spec.initial || '?', R, R + C * 0.03);
  }
  if (reflection) {
    // «Отражение»: violet-grey tone, glitch bands, inverted rim
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = spec.look === 'decoy' ? 'rgba(120,70,190,1)' : 'rgba(150,130,200,1)';
    ctx.fillRect(0, 0, C, C);
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = 'rgba(60,20,90,0.35)';
    ctx.fillRect(0, 0, C, C);
    ctx.globalCompositeOperation = 'source-over';
    const r = rng(spec.heroId.length * 97 + 13);
    for (let i = 0; i < 4; i++) {
      const y = C * (0.15 + r() * 0.7);
      const h = C * (0.02 + r() * 0.05);
      const dx = C * (r() - 0.5) * 0.12;
      ctx.fillStyle = i % 2 ? 'rgba(215,51,126,0.28)' : 'rgba(110,240,255,0.22)';
      ctx.fillRect(dx, y, C, h);
    }
  }
  // depth: inner vignette + element rim light
  ctx.fillStyle = radial(ctx, R, R, inner, [
    [0, 'rgba(0,0,0,0)'],
    [0.72, 'rgba(0,0,0,0)'],
    [1, 'rgba(0,0,0,0.5)'],
  ]);
  ctx.fillRect(0, 0, C, C);
  ctx.lineWidth = C * 0.03;
  ctx.strokeStyle = rgba(fx.color, reflection ? 0.35 : 0.75);
  circle(ctx, R, R, inner - C * 0.012);
  ctx.stroke();
  ctx.restore();

  // rarity frame (metal ring)
  const stops = reflection ? rar.stops.map((h) => mix(h, 0x6a6080, 0.65)) : rar.stops;
  let grad;
  if (rar.id === 'mythic' && !reflection && typeof ctx.createConicGradient === 'function') {
    grad = ctx.createConicGradient(-Math.PI / 2, R, R);
    const cyc = [0xff4fd8, 0xffd23f, 0x6af0ff, 0xffffff, 0xff4fd8, 0xffd23f, 0x6af0ff, 0xff4fd8];
    cyc.forEach((h, i) => grad.addColorStop(i / (cyc.length - 1), css(h)));
  } else {
    grad = ctx.createLinearGradient(0, 0, C, C);
    grad.addColorStop(0, css(stops[1]));
    grad.addColorStop(0.35, css(stops[0]));
    grad.addColorStop(0.6, css(stops[3]));
    grad.addColorStop(1, css(stops[2]));
  }
  ctx.lineWidth = ring;
  ctx.strokeStyle = grad;
  circle(ctx, R, R, R - ring / 2 - C * 0.005);
  ctx.stroke();
  // fine edges
  ctx.lineWidth = Math.max(1, C * 0.012);
  ctx.strokeStyle = 'rgba(10,6,20,0.85)';
  circle(ctx, R, R, R - C * 0.006);
  ctx.stroke();
  circle(ctx, R, R, R - ring - C * 0.004);
  ctx.stroke();
  ctx.strokeStyle = reflection ? 'rgba(200,190,230,0.4)' : 'rgba(255,255,255,0.55)';
  ctx.lineWidth = Math.max(0.8, C * 0.008);
  circle(ctx, R, R, R - ring * 0.55);
  ctx.stroke();
  // ornaments per rarity
  const gem = (x, y, s, h) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = radial(ctx, -s * 0.2, -s * 0.2, s * 1.2, [
      [0, '#ffffff'],
      [0.35, css(mix(h, 0xffffff, 0.3))],
      [1, css(mix(h, 0x000000, 0.4))],
    ]);
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.lineWidth = Math.max(0.8, C * 0.01);
    ctx.strokeStyle = 'rgba(20,10,0,0.8)';
    ctx.strokeRect(-s / 2, -s / 2, s, s);
    ctx.restore();
  };
  const gemCol = reflection ? 0x8a7cb0 : rar.gem;
  if (rar.id === 'rare') gem(R, ring * 0.55, C * 0.07, gemCol);
  else if (rar.id === 'epic') for (const [x, y] of [[R, ring * 0.55], [R, C - ring * 0.55], [ring * 0.55, R], [C - ring * 0.55, R]]) gem(x, y, C * 0.06, gemCol);
  else if (rar.id === 'legendary') {
    ctx.strokeStyle = 'rgba(90,50,0,0.7)';
    ctx.lineWidth = Math.max(0.8, C * 0.01);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      ctx.beginPath();
      ctx.moveTo(R + Math.cos(a) * (R - ring * 0.85), R + Math.sin(a) * (R - ring * 0.85));
      ctx.lineTo(R + Math.cos(a) * (R - ring * 0.3), R + Math.sin(a) * (R - ring * 0.3));
      ctx.stroke();
    }
    gem(R, ring * 0.6, C * 0.09, gemCol);
  } else if (rar.id === 'mythic') {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.3;
      starPath(ctx, R + Math.cos(a) * (R - ring / 2), R + Math.sin(a) * (R - ring / 2), 4, ring * 0.5, ring * 0.14);
      ctx.fill();
    }
    // crown crest
    ctx.save();
    ctx.translate(R, ring * 0.25);
    const cw = C * 0.2;
    poly(ctx, [-cw / 2, cw * 0.32, -cw / 2, -cw * 0.14, -cw / 4, cw * 0.08, 0, -cw * 0.3, cw / 4, cw * 0.08, cw / 2, -cw * 0.14, cw / 2, cw * 0.32]);
    ctx.fillStyle = reflection ? '#a89cc8' : '#ffe27a';
    ctx.fill();
    ctx.lineWidth = Math.max(0.8, C * 0.01);
    ctx.strokeStyle = '#4a2a00';
    ctx.stroke();
    ctx.restore();
  }
}

// ============================================================================ board
/**
 * The arena board as one texture: an ornate frame (layered metal, inlay, rune studs, corner gems)
 * and 64 tiles. Light tiles are muted, slightly translucent marble (the arena floor shows through
 * a little); dark tiles (playable) are deep glassy stone with a bevel, a faint glowing rune and
 * corner sparks in the theme accent. Holes (collapsed squares) are not baked: the view covers them.
 */
export function paintBoard(theme, L, res = 1) {
  if (!hasDom()) return Texture.WHITE;
  const T = L.total;
  const fw = L.fw;
  const sq = L.sq;
  const r = Math.max(1, Math.min(2, res));
  const R = rng(theme.id.length * 131 + 7);
  const c = paint(T, T, r, (ctx) => {
    // soft drop shadow so the board floats over the arena
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = fw * 1.6 * r;
    ctx.fillStyle = css(theme.frame[2]);
    ctx.fillRect(fw * 0.4, fw * 0.4, T - fw * 0.8, T - fw * 0.8);
    ctx.restore();
    // frame: dark core + metal bands
    ctx.fillStyle = css(mix(theme.frame[2], 0x000000, 0.35));
    ctx.fillRect(0, 0, T, T);
    const band = (inset, w, a, b) => {
      const g = ctx.createLinearGradient(0, 0, T, T);
      g.addColorStop(0, css(a));
      g.addColorStop(0.5, css(b));
      g.addColorStop(1, css(a));
      ctx.strokeStyle = g;
      ctx.lineWidth = w;
      ctx.strokeRect(inset + w / 2, inset + w / 2, T - 2 * inset - w, T - 2 * inset - w);
    };
    band(0, fw * 0.34, theme.frame[1], theme.frame[0]);
    band(fw * 0.34, fw * 0.3, mix(theme.frame[2], 0x000000, 0.2), theme.frame[2]);
    band(fw * 0.64, fw * 0.22, theme.frame[1], theme.frame[0]);
    // inlay line + rune studs along every edge (one per square)
    ctx.lineWidth = Math.max(1, fw * 0.09);
    ctx.strokeStyle = css(theme.inlay);
    ctx.strokeRect(fw * 0.47, fw * 0.47, T - fw * 0.94, T - fw * 0.94);
    const stud = (x, y, s, col) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = col;
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    };
    for (let i = 0; i < 8; i++) {
      const m = fw + (i + 0.5) * sq;
      const col = rgba(theme.accent, 0.85);
      stud(m, fw * 0.47, fw * 0.22, col);
      stud(m, T - fw * 0.47, fw * 0.22, col);
      stud(fw * 0.47, m, fw * 0.22, col);
      stud(T - fw * 0.47, m, fw * 0.22, col);
    }
    // corner gems
    const gemAt = (x, y, s) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.shadowColor = rgba(theme.gem, 0.9);
      ctx.shadowBlur = s * 0.8 * r;
      ctx.fillStyle = radial(ctx, -s * 0.2, -s * 0.2, s, [
        [0, '#ffffff'],
        [0.35, css(mix(theme.gem, 0xffffff, 0.35))],
        [1, css(mix(theme.gem, 0x000000, 0.45))],
      ]);
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(20,10,0,0.85)';
      ctx.lineWidth = Math.max(0.8, s * 0.12);
      ctx.strokeRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    };
    const gs = fw * 0.78;
    for (const [x, y] of [[fw / 2, fw / 2], [T - fw / 2, fw / 2], [fw / 2, T - fw / 2], [T - fw / 2, T - fw / 2]]) gemAt(x, y, gs);
    // the playing area: a dark glass plate first (light tiles are translucent over it)
    const bx = fw;
    const by = fw;
    ctx.clearRect(bx, by, 8 * sq, 8 * sq);
    ctx.fillStyle = rgba(mix(theme.dark[1], 0x000000, 0.3), 0.55);
    ctx.fillRect(bx, by, 8 * sq, 8 * sq);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const x = bx + col * sq;
        const y = by + row * sq;
        const dark = (row + col) % 2 === 1;
        if (!dark) {
          const g = ctx.createLinearGradient(x, y, x + sq, y + sq);
          g.addColorStop(0, rgba(theme.light[0], theme.lightAlpha));
          g.addColorStop(1, rgba(theme.light[1], theme.lightAlpha));
          ctx.fillStyle = g;
          ctx.fillRect(x, y, sq, sq);
          // marble veins
          ctx.strokeStyle = 'rgba(255,255,255,0.18)';
          ctx.lineWidth = Math.max(0.5, sq * 0.012);
          ctx.beginPath();
          let vx = x + R() * sq;
          let vy = y;
          ctx.moveTo(vx, vy);
          for (let k = 0; k < 4; k++) {
            vx += (R() - 0.5) * sq * 0.5;
            vy += sq * 0.25;
            ctx.lineTo(Math.max(x, Math.min(x + sq, vx)), vy);
          }
          ctx.stroke();
          // soft inner shade
          ctx.strokeStyle = 'rgba(0,0,0,0.18)';
          ctx.lineWidth = Math.max(0.6, sq * 0.04);
          ctx.strokeRect(x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, sq - ctx.lineWidth, sq - ctx.lineWidth);
        } else {
          const g = ctx.createRadialGradient(x + sq * 0.42, y + sq * 0.36, sq * 0.04, x + sq * 0.5, y + sq * 0.5, sq * 0.78);
          g.addColorStop(0, rgba(mix(theme.dark[0], theme.accent, 0.12), theme.darkAlpha));
          g.addColorStop(0.65, rgba(theme.dark[0], theme.darkAlpha));
          g.addColorStop(1, rgba(theme.dark[1], theme.darkAlpha));
          ctx.fillStyle = g;
          ctx.fillRect(x, y, sq, sq);
          // bevel: light top-left, dark bottom-right
          const bw = Math.max(1, sq * 0.06);
          ctx.fillStyle = 'rgba(255,255,255,0.10)';
          poly(ctx, [x, y, x + sq, y, x + sq - bw, y + bw, x + bw, y + bw, x + bw, y + sq - bw, x, y + sq]);
          ctx.fill();
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          poly(ctx, [x + sq, y + sq, x, y + sq, x + bw, y + sq - bw, x + sq - bw, y + sq - bw, x + sq - bw, y + bw, x + sq, y]);
          ctx.fill();
          // glowing rune ring + four sparks
          ctx.save();
          ctx.shadowColor = rgba(theme.accent, 0.8);
          ctx.shadowBlur = sq * 0.12 * r;
          ctx.strokeStyle = rgba(theme.rune, 0.2);
          ctx.lineWidth = Math.max(0.6, sq * 0.02);
          circle(ctx, x + sq / 2, y + sq / 2, sq * 0.3);
          ctx.stroke();
          ctx.restore();
          ctx.fillStyle = rgba(theme.accent, 0.35);
          for (const [ux, uy] of [[0.12, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88]]) {
            starPath(ctx, x + sq * ux, y + sq * uy, 4, sq * 0.045, sq * 0.012);
            ctx.fill();
          }
        }
      }
    }
    // inner lip of the frame
    ctx.strokeStyle = rgba(theme.inlay, 0.9);
    ctx.lineWidth = Math.max(1, fw * 0.12);
    ctx.strokeRect(bx - ctx.lineWidth / 2, by - ctx.lineWidth / 2, 8 * sq + ctx.lineWidth, 8 * sq + ctx.lineWidth);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = Math.max(1, fw * 0.05);
    ctx.strokeRect(bx + ctx.lineWidth / 2, by + ctx.lineWidth / 2, 8 * sq - ctx.lineWidth, 8 * sq - ctx.lineWidth);
  });
  return textureFromCanvas(c, c.width / T, { label: 'rpg-board' });
}

/** A frame-shaped soft glow (tint it with the side to move): the board's edge light. */
export function paintEdgeGlow(L, res = 1) {
  if (!hasDom()) return Texture.WHITE;
  const pad = L.fw * 1.6;
  const W = L.total + pad * 2;
  const r = Math.max(1, Math.min(1.5, res)) * 0.5;
  const c = paint(W, W, r, (ctx) => {
    ctx.save();
    ctx.shadowColor = 'rgba(255,255,255,1)';
    ctx.shadowBlur = pad * 0.9 * r;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = L.fw * 0.5;
    ctx.strokeRect(pad + L.fw * 0.25, pad + L.fw * 0.25, L.total - L.fw * 0.5, L.total - L.fw * 0.5);
    ctx.restore();
  });
  const t = textureFromCanvas(c, c.width / W, { label: 'rpg-edge-glow' });
  t.pad = pad;
  return t;
}

/** Vertical vignette (transparent centre band, dark top / bottom), stretch to the screen. */
export function vignetteTexture(color = 0x000000) {
  if (!hasDom()) return Texture.WHITE;
  const c = paint(8, 256, 1, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgba(color, 0.78));
    g.addColorStop(0.22, rgba(color, 0.25));
    g.addColorStop(0.5, rgba(color, 0.05));
    g.addColorStop(0.78, rgba(color, 0.3));
    g.addColorStop(1, rgba(color, 0.85));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  return textureFromCanvas(c, 1, { label: 'rpg-vignette' });
}

/** Radial spotlight: black everywhere except a soft transparent hole in the centre. */
export function spotlightTexture() {
  if (!hasDom()) return Texture.WHITE;
  const c = paint(256, 256, 1, (ctx, w) => {
    ctx.fillStyle = radial(ctx, w / 2, w / 2, w / 2, [
      [0, 'rgba(0,0,0,0)'],
      [0.18, 'rgba(0,0,0,0)'],
      [0.5, 'rgba(0,0,0,0.85)'],
      [1, 'rgba(0,0,0,1)'],
    ]);
    ctx.fillRect(0, 0, w, w);
  });
  return textureFromCanvas(c, 1, { label: 'rpg-spotlight' });
}

// ============================================================================ number glyphs
export const GLYPH_CHARS = '0123456789+-−×=.,  ';

/**
 * Digit atlas for floating numbers. style = { fill: 'white' | [css top, css bottom] | gradient
 * stops, stroke: css, strokeK (× size), glow: css | null }. glyph(ch) → { tex, adv } in logical px
 * at `size`; the composing sprites are scaled to the wanted height.
 */
export class GlyphFont {
  constructor({ size = 48, res = 2, fill = '#ffffff', stroke = '#12060a', strokeK = 0.2, glow: g = 'rgba(0,0,0,0.65)', font = '900 {s}px "Unbounded", "Russo One", sans-serif' } = {}) {
    this.size = size;
    this.res = Math.max(1, Math.min(2.5, res));
    this.glyphs = Object.create(null);
    this.texture = null;
    this.height = size * 1.35;
    if (!hasDom()) {
      for (const ch of GLYPH_CHARS) this.glyphs[ch] = { tex: Texture.WHITE, adv: size * 0.62, w: size * 0.62 };
      return;
    }
    const fontStr = font.replace('{s}', String(size));
    const m = makeCanvas(8, 8).getContext('2d');
    m.font = fontStr;
    const pad = Math.ceil(size * (strokeK + 0.18));
    const chars = Array.from(new Set(Array.from(GLYPH_CHARS)));
    const cellH = Math.ceil(size * 1.35 + pad * 2);
    const metrics = chars.map((ch) => ({ ch, adv: ch === ' ' || ch === ' ' ? size * 0.28 : m.measureText(ch).width }));
    let W = 0;
    for (const mt of metrics) W += Math.ceil(mt.adv + pad * 2) + 2;
    const R = this.res;
    const canvas = makeCanvas(Math.ceil(W * R), Math.ceil(cellH * R));
    const ctx = canvas.getContext('2d');
    ctx.scale(R, R);
    ctx.font = fontStr;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    let x = 0;
    const cy = cellH / 2 + size * 0.04;
    const places = [];
    for (const mt of metrics) {
      const w = Math.ceil(mt.adv + pad * 2);
      places.push({ ...mt, x, w });
      if (mt.ch.trim()) {
        const tx = x + pad;
        if (g) {
          ctx.save();
          ctx.shadowColor = g;
          ctx.shadowBlur = size * 0.22 * R;
          ctx.strokeStyle = stroke;
          ctx.lineWidth = size * strokeK;
          ctx.strokeText(mt.ch, tx, cy);
          ctx.restore();
        }
        ctx.strokeStyle = stroke;
        ctx.lineWidth = size * strokeK;
        ctx.strokeText(mt.ch, tx, cy);
        if (Array.isArray(fill)) {
          const gr = ctx.createLinearGradient(0, cy - size * 0.5, 0, cy + size * 0.5);
          fill.forEach((c, i) => gr.addColorStop(i / Math.max(1, fill.length - 1), c));
          ctx.fillStyle = gr;
        } else ctx.fillStyle = fill;
        ctx.fillText(mt.ch, tx, cy);
      }
      x += w + 2;
    }
    this.texture = textureFromCanvas(canvas, R, { label: 'rpg-glyphs' });
    const src = this.texture.source;
    for (const p of places) {
      this.glyphs[p.ch] = {
        tex: new Texture({ source: src, frame: new Rectangle(p.x, 0, p.w, cellH), label: `rpg-glyph:${p.ch}` }),
        adv: p.adv,
        w: p.w,
        pad,
      };
    }
    this.cellH = cellH;
    this.pad = pad;
  }

  glyph(ch) {
    return this.glyphs[ch] || this.glyphs[' '] || null;
  }

  destroy() {
    for (const g of Object.values(this.glyphs)) if (g.tex !== Texture.WHITE) g.tex.destroy(false);
    if (this.texture) this.texture.destroy(true);
    this.glyphs = Object.create(null);
    this.texture = null;
  }
}

/** Two-colour fill for a reaction's numbers: light top of colour A → colour B at the bottom. */
export function reactionFill(colors) {
  const [a, b] = colors;
  return [css(mix(a, 0xffffff, 0.65)), css(a), css(mix(a, b, 0.5)), css(b)];
}

export const CRIT_FILL = ['#fffbe0', '#ffe37a', '#ffb830', '#ff8a1f'];

export { shade };
