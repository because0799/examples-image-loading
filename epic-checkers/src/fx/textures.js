// Procedural textures for the FX library (no image assets).
//
//   const T = new FxTextures(resolution);
//   T.frame('spark')            atlas frame (all particle / sprite-FX textures share ONE source, so
//                               they batch together and can live in a ParticleContainer)
//   T.rays() T.bandStreaks() T.beamFlow() T.vignette()     standalone cached textures
//   T.crack(seed, { epic, color, size })                   ground-crack decal { base, glow }
//   T.emblem(side, { epic, king, size })                   big piece "portrait" for cut-ins
//   T.text(text, style) / T.releaseText(tex)               anime lettering (multi-stroke, gradient)
//
// Everything is drawn on offscreen 2D canvases in LOGICAL units and uploaded at `resolution`
// device px per unit, so it stays crisp on 2x/3x phones. Atlas frames are padded so linear
// filtering never bleeds between frames.

import { Texture, Rectangle } from 'pixi.js';
import { makeCanvas, textureFromCanvas, rgba, mixHex, shadeHex } from '../render/canvas.js';

const TAU = Math.PI * 2;

/** Small deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexCss(hex) {
  return `#${(hex & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** Draw `w×h` logical units into a fresh canvas at `res`; returns { canvas, k }. */
function paint(w, h, res, draw) {
  const c = makeCanvas(w * res, h * res);
  const ctx = c.getContext('2d');
  const k = c.width / w;
  ctx.scale(k, c.height / h);
  draw(ctx, w, h, k);
  return c;
}

/**
 * Soft-edged fill: draws the path far off-canvas and lets the shadow (which ignores the transform)
 * land back in place, i.e. a blurred copy of the shape. `k` = device px per logical unit.
 */
function softFill(ctx, k, blur, color, pathFn) {
  ctx.save();
  const off = 4000;
  ctx.shadowColor = color;
  ctx.shadowBlur = blur * k;
  ctx.shadowOffsetX = off * k;
  ctx.shadowOffsetY = 0;
  ctx.translate(-off, 0);
  ctx.fillStyle = color;
  pathFn(ctx);
  ctx.fill();
  ctx.restore();
}

function radialAlpha(ctx, cx, cy, r, stops) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const [o, a] of stops) g.addColorStop(o, `rgba(255,255,255,${a})`);
  return g;
}

// ============================================================================ atlas frame painters
const P = {
  dot(ctx, w, h) {
    const r = w / 2;
    const g = ctx.createRadialGradient(r, r, 0, r, r, r);
    for (let i = 0; i <= 12; i++) {
      const s = i / 12;
      g.addColorStop(s, `rgba(255,255,255,${Math.pow(1 - s, 1.7).toFixed(4)})`);
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  },
  core(ctx, w, h) {
    const r = w / 2;
    ctx.fillStyle = radialAlpha(ctx, r, r, r, [[0, 1], [0.18, 0.95], [0.38, 0.45], [0.65, 0.12], [1, 0]]);
    ctx.fillRect(0, 0, w, h);
  },
  spark(ctx, w, h) {
    // elongated soft glow with a hot white centre line
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(w / 2, h / 2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.7)');
    g.addColorStop(0.65, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
    ctx.restore();
    const lg = ctx.createLinearGradient(0, 0, w, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.25, 'rgba(255,255,255,0.9)');
    lg.addColorStop(0.75, 'rgba(255,255,255,0.9)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w * 0.46, h * 0.13, 0, 0, TAU);
    ctx.fill();
  },
  streak(ctx, w, h) {
    // comet streak: faint tail on the left, bright head on the right
    const tmp = makeCanvas(ctx.canvas.width, ctx.canvas.height);
    const t = tmp.getContext('2d');
    t.scale(ctx.canvas.width / w, ctx.canvas.height / h);
    const lg = t.createLinearGradient(0, 0, w, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.55, 'rgba(255,255,255,0.45)');
    lg.addColorStop(0.9, 'rgba(255,255,255,1)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    t.fillStyle = lg;
    t.fillRect(0, 0, w, h);
    t.globalCompositeOperation = 'destination-in';
    const vg = t.createLinearGradient(0, 0, 0, h);
    vg.addColorStop(0, 'rgba(255,255,255,0)');
    vg.addColorStop(0.5, 'rgba(255,255,255,1)');
    vg.addColorStop(1, 'rgba(255,255,255,0)');
    t.fillStyle = vg;
    t.fillRect(0, 0, w, h);
    ctx.drawImage(tmp, 0, 0, w, h);
  },
  shard(seed) {
    return (ctx, w, h) => {
      const r = rng(seed);
      const n = r() < 0.55 ? 3 : 4;
      const pts = [];
      const a0 = r() * TAU;
      for (let i = 0; i < n; i++) {
        const a = a0 + (i / n) * TAU + (r() - 0.5) * 0.9;
        const rad = w * (0.3 + r() * 0.18);
        pts.push([w / 2 + Math.cos(a) * rad, h / 2 + Math.sin(a) * rad * (0.7 + r() * 0.3)]);
      }
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.45, '#d9d9d9');
      g.addColorStop(1, '#7c7c7c');
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
      // facet line
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      const o = pts[Math.floor(n / 2)];
      const o2 = pts[(Math.floor(n / 2) + 1) % n];
      ctx.lineTo((o[0] + o2[0]) / 2, (o[1] + o2[1]) / 2);
      ctx.stroke();
      // lit edge + dark edges
      for (let i = 0; i < n; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % n];
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(q[0], q[1]);
        ctx.strokeStyle = i === 0 ? 'rgba(255,255,255,1)' : 'rgba(40,40,40,0.55)';
        ctx.lineWidth = i === 0 ? 1.4 : 0.9;
        ctx.stroke();
      }
    };
  },
  smoke(seed) {
    return (ctx, w, h) => {
      const tmp = makeCanvas(ctx.canvas.width, ctx.canvas.height);
      const t = tmp.getContext('2d');
      t.scale(ctx.canvas.width / w, ctx.canvas.height / h);
      const r = rng(seed);
      for (let i = 0; i < 11; i++) {
        const a = r() * TAU;
        const d = r() * w * 0.2;
        const cx = w / 2 + Math.cos(a) * d;
        const cy = h / 2 + Math.sin(a) * d;
        const rad = w * (0.16 + r() * 0.17);
        t.fillStyle = radialAlpha(t, cx, cy, rad, [[0, 0.42], [0.5, 0.25], [1, 0]]);
        t.fillRect(0, 0, w, h);
      }
      t.globalCompositeOperation = 'destination-in';
      t.fillStyle = radialAlpha(t, w / 2, h / 2, w / 2, [[0, 1], [0.6, 0.85], [1, 0]]);
      t.fillRect(0, 0, w, h);
      ctx.drawImage(tmp, 0, 0, w, h);
    };
  },
  ember(ctx, w) {
    const r = w / 2;
    ctx.fillStyle = radialAlpha(ctx, r, r, r, [[0, 1], [0.22, 1], [0.45, 0.35], [1, 0]]);
    ctx.fillRect(0, 0, w, w);
  },
  petal(ctx, w, h) {
    const L = w * 0.46;
    const W = h * 0.42;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(-L, 0);
    ctx.bezierCurveTo(-L * 0.35, -W * 1.15, L * 0.55, -W * 1.2, L, -W * 0.38);
    ctx.lineTo(L * 0.74, 0);
    ctx.lineTo(L, W * 0.38);
    ctx.bezierCurveTo(L * 0.55, W * 1.2, -L * 0.35, W * 1.15, -L, 0);
    ctx.closePath();
    const g = ctx.createLinearGradient(-L, 0, L, 0);
    g.addColorStop(0, '#f06f9c');
    g.addColorStop(0.35, '#ffb3cc');
    g.addColorStop(1, '#fff0f5');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(214,60,120,0.35)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(-L * 0.8, 0);
    ctx.quadraticCurveTo(0, -W * 0.15, L * 0.6, 0);
    ctx.stroke();
    ctx.restore();
  },
  confetti(ctx, w, h) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    const r = Math.min(w, h) * 0.18;
    ctx.moveTo(1 + r, 1);
    ctx.arcTo(w - 1, 1, w - 1, h - 1, r);
    ctx.arcTo(w - 1, h - 1, 1, h - 1, r);
    ctx.arcTo(1, h - 1, 1, 1, r);
    ctx.arcTo(1, 1, w - 1, 1, r);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(1, h * 0.55, w - 2, h * 0.45 - 1);
  },
  wisp(ctx, w, h, k) {
    // tapered curved energy tongue (head on the right)
    const N = 24;
    const top = [];
    const bot = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const x = w * (0.04 + u * 0.92);
      const y = h / 2 + Math.sin(u * Math.PI * 1.3 + 0.4) * h * 0.18;
      const t = h * 0.3 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.08)), 0.7) * (0.35 + u * 0.65);
      top.push([x, y - t]);
      bot.push([x, y + t]);
    }
    const path = (c) => {
      c.beginPath();
      top.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
      for (let i = bot.length - 1; i >= 0; i--) c.lineTo(bot[i][0], bot[i][1]);
      c.closePath();
    };
    softFill(ctx, k, 3, 'rgba(255,255,255,0.75)', path);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.save();
    ctx.translate(0, h * 0.0);
    ctx.scale(1, 0.45);
    ctx.translate(0, h * 0.61);
    path(ctx);
    ctx.fill();
    ctx.restore();
  },
  ring(ctx, w) {
    const r = w / 2;
    ctx.fillStyle = radialAlpha(ctx, r, r, r, [[0, 0], [0.7, 0], [0.82, 0.35], [0.88, 1], [0.93, 0.45], [1, 0]]);
    ctx.fillRect(0, 0, w, w);
  },
  ringSoft(ctx, w) {
    const r = w / 2;
    ctx.fillStyle = radialAlpha(ctx, r, r, r, [[0, 0], [0.3, 0], [0.62, 0.18], [0.82, 0.55], [0.9, 1], [0.95, 0.4], [1, 0]]);
    ctx.fillRect(0, 0, w, w);
  },
  star(ctx, w, h) {
    const c = w / 2;
    ctx.fillStyle = radialAlpha(ctx, c, c, c * 0.5, [[0, 1], [0.25, 0.8], [1, 0]]);
    ctx.fillRect(0, 0, w, h);
    const spike = (ang, len, thick, a) => {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(ang);
      ctx.scale(len, thick);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(0.35, `rgba(255,255,255,${a * 0.55})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, TAU);
      ctx.fill();
      ctx.restore();
    };
    spike(0, c * 0.98, c * 0.07, 1);
    spike(Math.PI / 2, c * 0.98, c * 0.07, 1);
    spike(Math.PI / 4, c * 0.5, c * 0.05, 0.6);
    spike(-Math.PI / 4, c * 0.5, c * 0.05, 0.6);
  },
  flame(seed) {
    return (ctx, w, h, k) => {
      const r = rng(seed);
      const cx = w / 2;
      const cy = h * 0.72;
      const R = w * 0.33;
      const tipX = cx + (r() - 0.5) * w * 0.25;
      const tipY = h * 0.05;
      const path = (c) => {
        c.beginPath();
        c.moveTo(cx - R, cy);
        c.arc(cx, cy, R, Math.PI, 0, true);
        c.bezierCurveTo(cx + R * 1.05, cy - h * 0.28, tipX + w * 0.12, tipY + h * 0.22, tipX, tipY);
        c.bezierCurveTo(tipX - w * 0.08, tipY + h * 0.25, cx - R * 1.1, cy - h * 0.2, cx - R, cy);
        c.closePath();
      };
      softFill(ctx, k, 3.5, 'rgba(255,255,255,0.55)', path);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy - h * 0.1, h * 0.62);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.3, 'rgba(255,255,255,0.8)');
      g.addColorStop(0.75, 'rgba(255,255,255,0.15)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      path(ctx);
      ctx.fill();
    };
  },
  chunk(seed) {
    return (ctx, w, h) => {
      const r = rng(seed);
      const n = 5 + Math.floor(r() * 3);
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + (r() - 0.5) * 0.6;
        const d = w * (0.3 + r() * 0.17);
        pts.push([w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d]);
      }
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#bdbdbd');
      g.addColorStop(1, '#4a4a4a');
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(pts[n - 1][0], pts[n - 1][1]);
      ctx.lineTo(pts[0][0], pts[0][1]);
      ctx.lineTo(pts[1][0], pts[1][1]);
      ctx.stroke();
    };
  },
  taper(tipAlpha) {
    // long thin triangle: sharp point at x=0, full width at x=w (speed / impact lines)
    return (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, `rgba(255,255,255,${tipAlpha})`);
      g.addColorStop(0.3, 'rgba(255,255,255,0.85)');
      g.addColorStop(1, 'rgba(255,255,255,1)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h * 0.06);
      ctx.lineTo(w, h * 0.94);
      ctx.closePath();
      ctx.fill();
    };
  },
  beam(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    const stops = [[0, 0], [0.15, 0.08], [0.32, 0.4], [0.44, 0.9], [0.5, 1], [0.56, 0.9], [0.68, 0.4], [0.85, 0.08], [1, 0]];
    for (const [o, a] of stops) g.addColorStop(o, `rgba(255,255,255,${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  },
  flare(ctx, w, h) {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(w / 2, h / 2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.2, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
    ctx.restore();
    const lg = ctx.createLinearGradient(0, 0, w, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.5, 'rgba(255,255,255,1)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(0, h / 2 - h * 0.06, w, h * 0.12);
  },
  hex(ctx, w) {
    const c = w / 2;
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.lineWidth = w * 0.09;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + Math.PI / 6;
      const x = c + Math.cos(a) * c * 0.78;
      const y = c + Math.sin(a) * c * 0.78;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  },
  drop(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.8, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0.2)');
    ctx.fillStyle = g;
    ctx.fillRect(w * 0.25, 0, w * 0.5, h);
  },
};

const ATLAS_FRAMES = [
  ['dot', 64, 64, P.dot],
  ['core', 32, 32, P.core],
  ['spark', 64, 14, P.spark],
  ['streak', 128, 10, P.streak],
  ['shard0', 32, 32, P.shard(11)],
  ['shard1', 32, 32, P.shard(23)],
  ['shard2', 32, 32, P.shard(37)],
  ['shard3', 32, 32, P.shard(41)],
  ['smoke0', 64, 64, P.smoke(5)],
  ['smoke1', 64, 64, P.smoke(9)],
  ['ember', 16, 16, P.ember],
  ['petal', 28, 24, P.petal],
  ['confetti', 12, 8, P.confetti],
  ['wisp', 64, 24, P.wisp],
  ['ring', 128, 128, P.ring],
  ['ringSoft', 128, 128, P.ringSoft],
  ['star', 64, 64, P.star],
  ['flame0', 32, 64, P.flame(3)],
  ['flame1', 32, 64, P.flame(8)],
  ['chunk0', 16, 16, P.chunk(2)],
  ['chunk1', 16, 16, P.chunk(6)],
  ['chunk2', 16, 16, P.chunk(13)],
  ['line', 256, 16, P.taper(0)],
  ['wedge', 256, 48, P.taper(0.6)],
  ['beam', 64, 16, P.beam],
  ['flare', 128, 24, P.flare],
  ['hex', 24, 24, P.hex],
  ['drop', 6, 40, P.drop],
];

// ============================================================================ text
/**
 * Anime lettering style (all sizes in logical px):
 *  font, weight, size, fill: [css colours top→bottom] | css, stroke: { color, width } (ink outline),
 *  rim: { color, width } (coloured outline between ink and fill), inner: { color, width } (thin line
 *  over the fill edge), glow: { color, blur, alpha }, shadow: { dx, dy, color } (hard offset ink),
 *  shine (0..1 highlight on the upper half), spacing (fraction of size), jitter (rotation per char).
 */
function buildText(text, st, res, seed) {
  const size = st.size || 96;
  const font = `${st.weight || 400} ${size}px ${st.font || '"Dela Gothic One"'}`;
  const m = makeCanvas(4, 4).getContext('2d');
  m.font = font;
  const chars = Array.from(text);
  const widths = chars.map((c) => m.measureText(c).width);
  const spacing = (st.spacing || 0) * size;
  let total = 0;
  for (let i = 0; i < widths.length; i++) total += widths[i] + (i ? spacing : 0);
  const mt = m.measureText(text);
  const asc = Math.max(size * 0.6, mt.actualBoundingBoxAscent || size * 0.8);
  const desc = Math.max(size * 0.05, mt.actualBoundingBoxDescent || size * 0.2);
  const ink = st.stroke ? st.stroke.width : 0;
  const rimW = st.rim ? st.rim.width : 0;
  const glowB = st.glow ? st.glow.blur : 0;
  const sh = st.shadow ? Math.max(Math.abs(st.shadow.dx), Math.abs(st.shadow.dy)) : 0;
  const jit = st.jitter || 0;
  const pad = Math.ceil(ink + rimW + glowB * 1.25 + sh + 2 + jit * size * 0.35);
  const W = Math.ceil(total + pad * 2);
  const H = Math.ceil(asc + desc + pad * 2);
  const base = pad + asc;
  const r = rng(seed || 7);
  const pos = [];
  let x = pad;
  for (let i = 0; i < chars.length; i++) {
    pos.push({ c: chars[i], x: x + widths[i] / 2, rot: jit ? (r() - 0.5) * 2 * jit : 0, dy: jit ? (r() - 0.5) * size * 0.06 : 0 });
    x += widths[i] + spacing;
  }
  const eachChar = (ctx, fn) => {
    for (const p of pos) {
      ctx.save();
      ctx.translate(p.x, base + p.dy - asc * 0.4);
      ctx.rotate(p.rot);
      ctx.translate(0, asc * 0.4);
      fn(p.c);
      ctx.restore();
    }
  };
  const canvas = paint(W, H, res, (ctx, w, h, k) => {
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    const outer = ink + rimW;
    if (st.glow) {
      ctx.save();
      ctx.shadowColor = st.glow.color;
      ctx.shadowBlur = st.glow.blur * k;
      ctx.globalAlpha = st.glow.alpha == null ? 1 : st.glow.alpha;
      ctx.strokeStyle = st.glow.color;
      ctx.fillStyle = st.glow.color;
      ctx.lineWidth = outer * 2 + 1;
      eachChar(ctx, (c) => {
        ctx.strokeText(c, 0, 0);
        ctx.fillText(c, 0, 0);
      });
      ctx.restore();
    }
    if (st.shadow) {
      ctx.save();
      ctx.translate(st.shadow.dx, st.shadow.dy);
      ctx.strokeStyle = st.shadow.color;
      ctx.fillStyle = st.shadow.color;
      ctx.lineWidth = outer * 2;
      eachChar(ctx, (c) => {
        if (outer > 0) ctx.strokeText(c, 0, 0);
        ctx.fillText(c, 0, 0);
      });
      ctx.restore();
    }
    if (outer > 0) {
      ctx.strokeStyle = st.stroke ? st.stroke.color : st.rim.color;
      ctx.lineWidth = outer * 2;
      eachChar(ctx, (c) => ctx.strokeText(c, 0, 0));
    }
    if (st.rim) {
      ctx.strokeStyle = st.rim.color;
      ctx.lineWidth = rimW * 2;
      eachChar(ctx, (c) => ctx.strokeText(c, 0, 0));
    }
    // gradient fill on its own layer so the shine can be clipped to the glyphs
    const layer = makeCanvas(ctx.canvas.width, ctx.canvas.height);
    const L = layer.getContext('2d');
    L.scale(k, ctx.canvas.height / h);
    L.font = font;
    L.textAlign = 'center';
    L.textBaseline = 'alphabetic';
    const top = base - asc;
    const bottom = base + desc;
    let fill = st.fill || '#ffffff';
    if (Array.isArray(fill)) {
      // glyphs are drawn at a local origin on their baseline → gradient in local glyph space
      const g = L.createLinearGradient(0, -asc, 0, desc);
      fill.forEach((c, i) => g.addColorStop(fill.length === 1 ? 0 : i / (fill.length - 1), c));
      fill = g;
    }
    L.fillStyle = fill;
    eachChar(L, (c) => L.fillText(c, 0, 0));
    if (st.shine) {
      L.globalCompositeOperation = 'source-atop';
      const sg = L.createLinearGradient(0, top, 0, top + (bottom - top) * 0.55);
      sg.addColorStop(0, `rgba(255,255,255,${0.75 * st.shine})`);
      sg.addColorStop(0.75, `rgba(255,255,255,${0.25 * st.shine})`);
      sg.addColorStop(1, 'rgba(255,255,255,0)');
      L.fillStyle = sg;
      L.fillRect(0, top, w, (bottom - top) * 0.55);
      // hard anime highlight band
      L.fillStyle = `rgba(255,255,255,${0.22 * st.shine})`;
      L.fillRect(0, top + (bottom - top) * 0.08, w, (bottom - top) * 0.16);
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
    if (st.inner) {
      ctx.strokeStyle = st.inner.color;
      ctx.lineWidth = st.inner.width;
      eachChar(ctx, (c) => ctx.strokeText(c, 0, 0));
    }
  });
  return { canvas, width: W, height: H, pad, ascent: asc, descent: desc, textWidth: total };
}

// ============================================================================ FxTextures
export class FxTextures {
  constructor(resolution = 2) {
    this.res = Math.max(1, Math.min(3, resolution));
    this.frames = Object.create(null);
    this.atlas = null;
    this._misc = new Map();
    this._text = new Map(); // key -> { tex, refs, used, px }
    this._textClock = 0;
    this._textPx = 0;
    /** cache limits for lettering: entry count and device-pixel budget (~4 bytes each on the GPU) */
    this.maxText = 24;
    this.maxTextPixels = 5e6;
    this._buildAtlas();
  }

  // ------------------------------------------------------------------ atlas
  _buildAtlas() {
    const res = Math.min(2, this.res);
    const PAD = 2;
    const W = 512;
    const items = ATLAS_FRAMES.map(([name, w, h, draw]) => ({ name, w, h, draw }));
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
      const c = paint(it.w, it.h, res, it.draw);
      ctx.drawImage(c, Math.round(it.x * res), Math.round(it.y * res));
    }
    this.atlas = textureFromCanvas(canvas, res, { label: 'fx-atlas' });
    const src = this.atlas.source;
    for (const it of items) {
      this.frames[it.name] = new Texture({
        source: src,
        frame: new Rectangle(Math.round(it.x * res) / res, Math.round(it.y * res) / res, it.w, it.h),
        label: `fx:${it.name}`,
      });
    }
  }

  /** Atlas frame by name (throws on typos in dev builds; falls back to 'dot'). */
  frame(name) {
    return this.frames[name] || this.frames.dot;
  }

  _cached(key, make) {
    let t = this._misc.get(key);
    if (t && !t.destroyed) return t;
    t = make();
    this._misc.set(key, t);
    return t;
  }

  // ------------------------------------------------------------------ standalone textures
  /** Radial god-ray burst (white; tint it). Logical 256. */
  rays() {
    return this._cached('rays', () => {
      const S = 256;
      const c = paint(S, S, Math.min(2, this.res), (ctx, w) => {
        const r = rng(77);
        const cx = w / 2;
        ctx.translate(cx, cx);
        const N = 44;
        for (let i = 0; i < N; i++) {
          const a = (i / N) * TAU + (r() - 0.5) * 0.08;
          const wa = 0.015 + r() * 0.07;
          const len = cx * (0.55 + r() * 0.45);
          ctx.fillStyle = `rgba(255,255,255,${(0.18 + r() * 0.5).toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, len, a - wa / 2, a + wa / 2);
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'destination-in';
        ctx.fillStyle = radialAlpha(ctx, 0, 0, cx, [[0, 1], [0.12, 0.95], [0.5, 0.45], [0.85, 0.1], [1, 0]]);
        ctx.fillRect(-cx, -cx, w, w);
      });
      return textureFromCanvas(c, Math.min(2, this.res), { label: 'fx-rays' });
    });
  }

  /** Horizontally tileable streak pattern (banner / cut-in interiors). Logical 256×64. */
  bandStreaks() {
    return this._cached('bandStreaks', () => {
      const w = 256;
      const h = 64;
      const c = paint(w, h, 1.5, (ctx) => {
        const r = rng(31);
        for (let i = 0; i < 46; i++) {
          const y = r() * h;
          const len = 30 + r() * 170;
          const x = r() * w;
          const th = 0.4 + r() * r() * 3.2;
          const a = 0.12 + r() * 0.55;
          for (const ox of [0, -w, w]) {
            const g = ctx.createLinearGradient(x + ox, 0, x + ox + len, 0);
            g.addColorStop(0, 'rgba(255,255,255,0)');
            g.addColorStop(0.7, `rgba(255,255,255,${a})`);
            g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g;
            ctx.fillRect(x + ox, y - th / 2, len, th);
          }
        }
      });
      return textureFromCanvas(c, 1.5, { label: 'fx-band-streaks' });
    });
  }

  /** Vertically tileable energy-flow streaks (light pillars). Logical 64×256. */
  beamFlow() {
    return this._cached('beamFlow', () => {
      const w = 64;
      const h = 256;
      const c = paint(w, h, 1, (ctx) => {
        const r = rng(19);
        for (let i = 0; i < 40; i++) {
          const x = w / 2 + (r() + r() + r() - 1.5) * w * 0.32;
          const len = 20 + r() * 110;
          const y = r() * h;
          const th = 0.6 + r() * 2.6;
          const a = 0.2 + r() * 0.6;
          for (const oy of [0, -h, h]) {
            const g = ctx.createLinearGradient(0, y + oy, 0, y + oy + len);
            g.addColorStop(0, 'rgba(255,255,255,0)');
            g.addColorStop(0.5, `rgba(255,255,255,${a})`);
            g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g;
            ctx.fillRect(x - th / 2, y + oy, th, len);
          }
        }
      });
      return textureFromCanvas(c, 1, { label: 'fx-beam-flow' });
    });
  }

  /** Soft black vignette (transparent centre). Logical 256 square; stretch to the screen. */
  vignette() {
    return this._cached('vignette', () => {
      const S = 256;
      const c = paint(S, S, 1, (ctx, w) => {
        const g = ctx.createRadialGradient(w / 2, w / 2, w * 0.22, w / 2, w / 2, w * 0.72);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(0.55, 'rgba(0,0,0,0.35)');
        g.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, w);
      });
      return textureFromCanvas(c, 1, { label: 'fx-vignette' });
    });
  }

  /** Horizontal band gradient (dark → colour → dark) used behind banner / cut-in text. */
  band(color, style = 'epic') {
    return this._cached(`band|${color}|${style}`, () => {
      const w = 256;
      const h = 64;
      const c = paint(w, h, 1, (ctx) => {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        if (style === 'classic') {
          g.addColorStop(0, 'rgba(20,12,7,0.0)');
          g.addColorStop(0.18, 'rgba(26,16,9,0.88)');
          g.addColorStop(0.5, 'rgba(42,26,16,0.94)');
          g.addColorStop(0.82, 'rgba(26,16,9,0.88)');
          g.addColorStop(1, 'rgba(20,12,7,0.0)');
        } else {
          const dark = shadeHex(color, 0.22);
          const mid = shadeHex(color, 0.55);
          g.addColorStop(0, rgba(dark, 0.96));
          g.addColorStop(0.42, rgba(mid, 0.97));
          g.addColorStop(0.5, rgba(mixHex(color, 0xffffff, 0.15), 0.98));
          g.addColorStop(0.58, rgba(mid, 0.97));
          g.addColorStop(1, rgba(dark, 0.96));
        }
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      });
      return textureFromCanvas(c, 1, { label: 'fx-band' });
    });
  }

  /**
   * Ground-crack decal: { base (normal blend: crevices + crater), glow (additive: energy in the
   * cracks, epic only, else null), size }. Cached per seed/mode/colour/size bucket.
   */
  crack(seed, { epic = true, color = 0xff2e63, size = 100 } = {}) {
    const S = Math.max(32, Math.round(size / 8) * 8);
    const key = `crack|${seed}|${epic ? 1 : 0}|${epic ? color : 0}|${S}`;
    let rec = this._misc.get(key);
    if (rec && !rec.base.destroyed) return rec;
    const res = Math.min(2, this.res);
    const r = rng(seed * 977 + 13);
    const c = S / 2;
    const lines = []; // { pts: [[x,y]...], w0 }
    const grow = (x, y, ang, len, w0, depth) => {
      const pts = [[x, y]];
      const step = S * 0.045;
      let a = ang;
      let cx = x;
      let cy = y;
      const n = Math.max(2, Math.floor(len / step));
      for (let i = 0; i < n; i++) {
        a += (r() - 0.5) * 0.75;
        cx += Math.cos(a) * step * (0.7 + r() * 0.6);
        cy += Math.sin(a) * step * (0.7 + r() * 0.6);
        pts.push([cx, cy]);
        if (depth < 2 && i > 1 && r() < 0.22) {
          grow(cx, cy, a + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.7), len * (0.25 + r() * 0.3), w0 * 0.55, depth + 1);
        }
      }
      lines.push({ pts, w0 });
    };
    const N = 6 + Math.floor(r() * 4);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU + (r() - 0.5) * 0.5;
      grow(c + Math.cos(a) * S * 0.05, c + Math.sin(a) * S * 0.05, a, c * (0.55 + r() * 0.42), S * 0.034, 0);
    }
    // a few concentric fracture arcs
    const arcs = [];
    for (let i = 0; i < 3; i++) arcs.push({ rad: S * (0.12 + i * 0.07 + r() * 0.03), a0: r() * TAU, span: 0.6 + r() * 1.4 });

    const strokeLines = (ctx, widthMul, add, color, alpha) => {
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const l of lines) {
        const n = l.pts.length - 1;
        for (let i = 0; i < n; i++) {
          const u = i / n;
          ctx.globalAlpha = alpha * (1 - u * 0.6);
          ctx.lineWidth = Math.max(0.35, l.w0 * (1 - u * 0.85) * widthMul + add);
          ctx.beginPath();
          ctx.moveTo(l.pts[i][0], l.pts[i][1]);
          ctx.lineTo(l.pts[i + 1][0], l.pts[i + 1][1]);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    };
    const baseCanvas = paint(S, S, res, (ctx) => {
      // crater
      const g = ctx.createRadialGradient(c, c, 0, c, c, S * 0.3);
      g.addColorStop(0, epic ? 'rgba(0,0,0,0.75)' : 'rgba(40,22,10,0.5)');
      g.addColorStop(0.55, epic ? 'rgba(0,0,0,0.4)' : 'rgba(40,22,10,0.22)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
      // fracture arcs
      ctx.lineCap = 'round';
      for (const a of arcs) {
        ctx.strokeStyle = epic ? 'rgba(0,0,0,0.6)' : 'rgba(35,20,10,0.4)';
        ctx.lineWidth = S * 0.008;
        ctx.beginPath();
        ctx.arc(c, c, a.rad, a.a0, a.a0 + a.span);
        ctx.stroke();
      }
      // highlight edge (offset), then the dark crevices
      ctx.save();
      ctx.translate(S * 0.006, S * 0.006);
      strokeLines(ctx, 1.25, 0.6, epic ? 'rgba(160,140,255,1)' : 'rgba(255,240,210,1)', epic ? 0.22 : 0.3);
      ctx.restore();
      strokeLines(ctx, 1.4, 0.9, epic ? '#000000' : '#24140a', 0.92);
      // debris specks
      for (let i = 0; i < 26; i++) {
        const a = r() * TAU;
        const d = S * (0.06 + r() * 0.38);
        ctx.fillStyle = epic ? `rgba(0,0,0,${0.35 + r() * 0.4})` : `rgba(40,22,10,${0.2 + r() * 0.3})`;
        ctx.beginPath();
        ctx.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, S * (0.004 + r() * 0.01), 0, TAU);
        ctx.fill();
      }
    });
    const base = textureFromCanvas(baseCanvas, res, { label: 'fx-crack' });
    let glow = null;
    if (epic) {
      const glowCanvas = paint(S, S, res, (ctx, w, h, k) => {
        ctx.save();
        ctx.shadowColor = hexCss(color);
        ctx.shadowBlur = S * 0.045 * k;
        strokeLines(ctx, 1.6, 1.2, hexCss(color), 0.95);
        ctx.restore();
        strokeLines(ctx, 0.6, 0.4, hexCss(mixHex(color, 0xffffff, 0.75)), 1);
        const g = ctx.createRadialGradient(c, c, 0, c, c, S * 0.16);
        g.addColorStop(0, rgba(mixHex(color, 0xffffff, 0.5), 0.9));
        g.addColorStop(1, rgba(color, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, S, S);
      });
      glow = textureFromCanvas(glowCanvas, res, { label: 'fx-crack-glow' });
    }
    rec = { base, glow, size: S, destroyed: false };
    this._misc.set(key, rec);
    // keep at most 8 crack variants alive
    const keys = [...this._misc.keys()].filter((k) => k.startsWith('crack|'));
    if (keys.length > 8) {
      const old = this._misc.get(keys[0]);
      if (old && old.refs === 0) {
        old.base.destroy(true);
        if (old.glow) old.glow.destroy(true);
        old.destroyed = true;
        this._misc.delete(keys[0]);
      }
    }
    rec.refs = rec.refs || 0;
    return rec;
  }

  /** Big piece emblem ("portrait") for cut-ins. side: 1 white, -1 black. */
  emblem(side, { epic = true, king = false, size = 256, color } = {}) {
    const S = Math.min(320, Math.round(size / 16) * 16);
    const col = color != null ? color : side > 0 ? 0x29e6ff : 0xff2e63;
    return this._cached(`emblem|${side}|${epic ? 1 : 0}|${king ? 1 : 0}|${S}|${col}`, () => {
      const res = Math.min(2, this.res);
      const c = paint(S, S, res, (ctx, w, h, k) => drawEmblem(ctx, S, side, epic, king, col, k));
      return textureFromCanvas(c, res, { label: 'fx-emblem' });
    });
  }

  // ------------------------------------------------------------------ text
  /**
   * Cached anime-lettering texture. Returns a Texture with `.fx` = layout metrics.
   * Call releaseText(tex) when no longer displayed so the cache may evict it.
   */
  text(text, style, seed = 7) {
    const key = `${text}|${style.key || JSON.stringify(style)}|${seed}`;
    let e = this._text.get(key);
    if (!e || e.tex.destroyed) {
      const res = Math.min(3, style.res || this.res);
      const t = buildText(text, style, res, seed);
      const tex = textureFromCanvas(t.canvas, res, { label: 'fx-text' });
      tex.fx = { width: t.width, height: t.height, pad: t.pad, ascent: t.ascent, descent: t.descent, textWidth: t.textWidth, key };
      e = { tex, refs: 0, used: 0, px: t.canvas.width * t.canvas.height };
      this._text.set(key, e);
      this._textPx += e.px;
      this._evictText();
    }
    e.refs++;
    e.used = ++this._textClock;
    return e.tex;
  }

  releaseText(tex) {
    if (!tex || !tex.fx) return;
    const e = this._text.get(tex.fx.key);
    if (e && e.tex === tex && e.refs > 0) e.refs--;
  }

  _evictText() {
    const over = () => this._text.size > this.maxText || this._textPx > this.maxTextPixels;
    if (!over()) return;
    const free = [...this._text.entries()].filter(([, e]) => e.refs === 0).sort((a, b) => a[1].used - b[1].used);
    while (over() && free.length) {
      const [k, e] = free.shift();
      e.tex.destroy(true);
      this._text.delete(k);
      this._textPx -= e.px;
    }
  }

  /** Debug: cached lettering entries and their device-pixel total. */
  get textStats() {
    return { entries: this._text.size, pixels: this._textPx };
  }

  destroy() {
    for (const t of Object.values(this.frames)) t.destroy(false);
    if (this.atlas) this.atlas.destroy(true);
    for (const v of this._misc.values()) {
      if (v && v.base) {
        v.base.destroy(true);
        if (v.glow) v.glow.destroy(true);
      } else if (v && !v.destroyed) v.destroy(true);
    }
    for (const e of this._text.values()) e.tex.destroy(true);
    this._misc.clear();
    this._text.clear();
  }
}

// ============================================================================ emblem painter
function drawEmblem(ctx, S, side, epic, king, col, k) {
  const c = S / 2;
  const R = S * 0.4;
  if (epic) {
    // outer energy halo
    let g = ctx.createRadialGradient(c, c, R * 0.85, c, c, c);
    g.addColorStop(0, rgba(col, 0.75));
    g.addColorStop(0.4, rgba(col, 0.25));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    // body (forged metal)
    g = ctx.createRadialGradient(c - R * 0.3, c - R * 0.35, R * 0.1, c, c, R);
    g.addColorStop(0, '#4a4566');
    g.addColorStop(0.55, '#221d33');
    g.addColorStop(1, '#0d0b16');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, R, 0, TAU);
    ctx.fill();
    // metallic rim
    const lg = ctx.createLinearGradient(c - R, c - R, c + R, c + R);
    lg.addColorStop(0, '#d7dcff');
    lg.addColorStop(0.35, '#6c6a8e');
    lg.addColorStop(0.7, '#1c1828');
    lg.addColorStop(1, '#8a86b0');
    ctx.strokeStyle = lg;
    ctx.lineWidth = R * 0.09;
    ctx.beginPath();
    ctx.arc(c, c, R * 0.955, 0, TAU);
    ctx.stroke();
    // grooves
    for (const f of [0.8, 0.62]) {
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.lineWidth = R * 0.03;
      ctx.beginPath();
      ctx.arc(c, c, R * f, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.13)';
      ctx.lineWidth = R * 0.012;
      ctx.beginPath();
      ctx.arc(c, c, R * f + R * 0.022, 0, TAU);
      ctx.stroke();
    }
    // glowing energy channel
    ctx.save();
    ctx.shadowColor = rgba(col, 1);
    ctx.shadowBlur = R * 0.18 * k;
    ctx.strokeStyle = rgba(mixHex(col, 0xffffff, 0.35), 1);
    ctx.lineWidth = R * 0.05;
    ctx.beginPath();
    ctx.arc(c, c, R * 0.71, 0, TAU);
    ctx.stroke();
    ctx.restore();
    // rune ticks
    ctx.strokeStyle = rgba(col, 0.75);
    ctx.lineWidth = R * 0.018;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      const r0 = R * (i % 3 === 0 ? 0.84 : 0.865);
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
      ctx.lineTo(c + Math.cos(a) * R * 0.9, c + Math.sin(a) * R * 0.9);
      ctx.stroke();
    }
    // core
    g = ctx.createRadialGradient(c, c, 0, c, c, R * 0.55);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, rgba(mixHex(col, 0xffffff, 0.45), 0.95));
    g.addColorStop(0.6, rgba(col, 0.45));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, R * 0.55, 0, TAU);
    ctx.fill();
    if (king) {
      drawCrown(ctx, c, c, R * 0.36, '#ffe9a0', '#ffd23f', '#7a4a00', k);
    } else if (side > 0) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(c, c, R * 0.13, 0, TAU);
      ctx.fill();
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(c, c - R * 0.2);
      ctx.lineTo(c + R * 0.14, c);
      ctx.lineTo(c, c + R * 0.2);
      ctx.lineTo(c - R * 0.14, c);
      ctx.closePath();
      ctx.fill();
    }
    // specular arc
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = R * 0.035;
    ctx.beginPath();
    ctx.arc(c, c, R * 0.9, Math.PI * 1.08, Math.PI * 1.42);
    ctx.stroke();
  } else {
    const ivory = side > 0;
    const body0 = ivory ? '#fffaf0' : '#3b3434';
    const body1 = ivory ? '#e8dcc0' : '#1e1a1a';
    const body2 = ivory ? '#bfae8a' : '#0c0a0a';
    let g = ctx.createRadialGradient(c - R * 0.35, c - R * 0.4, R * 0.05, c, c, R);
    g.addColorStop(0, body0);
    g.addColorStop(0.6, body1);
    g.addColorStop(1, body2);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = R * 0.12 * k;
    ctx.shadowOffsetY = R * 0.05 * k;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, R, 0, TAU);
    ctx.fill();
    ctx.restore();
    for (const f of [0.82, 0.64, 0.46]) {
      ctx.strokeStyle = ivory ? 'rgba(120,90,50,0.35)' : 'rgba(0,0,0,0.6)';
      ctx.lineWidth = R * 0.025;
      ctx.beginPath();
      ctx.arc(c, c, R * f, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = ivory ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.12)';
      ctx.lineWidth = R * 0.012;
      ctx.beginPath();
      ctx.arc(c, c, R * f + R * 0.02, 0, TAU);
      ctx.stroke();
    }
    ctx.strokeStyle = '#c9a04c';
    ctx.lineWidth = R * 0.03;
    ctx.beginPath();
    ctx.arc(c, c, R * 0.97, 0, TAU);
    ctx.stroke();
    if (king) drawCrown(ctx, c, c, R * 0.36, '#f3d98a', '#c9a04c', '#5a3c10', k);
    g = ctx.createLinearGradient(c, c - R, c, c);
    g.addColorStop(0, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(c, c - R * 0.45, R * 0.7, R * 0.42, 0, 0, TAU);
    ctx.fill();
  }
}

function drawCrown(ctx, x, y, s, light, mid, dark, k) {
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowColor = 'rgba(255,200,60,0.8)';
  ctx.shadowBlur = s * 0.4 * k;
  const g = ctx.createLinearGradient(0, -s, 0, s);
  g.addColorStop(0, light);
  g.addColorStop(0.55, mid);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-s, s * 0.55);
  ctx.lineTo(-s * 1.05, -s * 0.45);
  ctx.lineTo(-s * 0.5, s * 0.05);
  ctx.lineTo(0, -s * 0.8);
  ctx.lineTo(s * 0.5, s * 0.05);
  ctx.lineTo(s * 1.05, -s * 0.45);
  ctx.lineTo(s, s * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = dark;
  ctx.lineWidth = s * 0.08;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fillStyle = light;
  for (const [px, py] of [[-s * 1.05, -s * 0.45], [0, -s * 0.8], [s * 1.05, -s * 0.45]]) {
    ctx.beginPath();
    ctx.arc(px, py, s * 0.13, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}
