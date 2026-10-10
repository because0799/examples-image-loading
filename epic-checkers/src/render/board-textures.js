// Procedural 2D-canvas painters for the boards (classic wood, epic obsidian), their frames,
// glow layers, rune glyphs and the magic circle. Pure canvas code — board-view.js turns the
// results into textures/sprites.
//
// Layout object `L` (all CSS px, local to the frame's top-left corner):
//   { n, sq, fw, total, playable: 'dark'|'all', parity, flipped, labels }
//   playing area = [fw, fw, n*sq, n*sq]

import { Noise2D, mulberry32 } from './noise.js';
import { makeCanvas, roundRectPath, chamferRectPath, rgba } from './canvas.js';
import { CLASSIC, EPIC } from './palette.js';

const FILES = 'abcdefghijkl';

// -------------------------------------------------------------------------------- helpers
export function isDarkSquare(L, r, c) {
  return (r + c) % 2 === L.parity;
}

/** engine (r, c) displayed at display (dr, dc) */
export function engineRC(L, dr, dc) {
  return L.flipped ? [L.n - 1 - dr, L.n - 1 - dc] : [dr, dc];
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smooth(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

// -------------------------------------------------------------------------------- wood
const WOODS = {
  // honey maple: fine, tight grain, warm cream
  maple: {
    light: [246, 224, 180], dark: [216, 172, 112], rings: 30, ring: 0.36, warp: 2.2,
    pores: 0.07, tone: 0.08, figure: 0.06, seed: 11,
  },
  // rich walnut, pronounced darker latewood
  walnut: {
    light: [134, 82, 46], dark: [62, 34, 17], rings: 30, ring: 0.62, warp: 2.6,
    pores: 0.3, tone: 0.12, figure: 0.0, seed: 23,
  },
  // very dark frame walnut
  frame: {
    light: [70, 43, 25], dark: [27, 15, 8], rings: 26, ring: 0.6, warp: 3.0,
    pores: 0.22, tone: 0.14, figure: 0.0, seed: 37,
  },
  // Turkish dama board: honey beech / light oak
  turkish: {
    light: [240, 208, 154], dark: [200, 146, 86], rings: 28, ring: 0.42, warp: 2.4,
    pores: 0.1, tone: 0.09, figure: 0.0, seed: 53,
  },
};

const woodCache = new Map();

/**
 * 512×512 quarter-sawn wood veneer tile, grain running vertically: asymmetric growth rings
 * (soft earlywood → narrow dark latewood line), warped by fbm, plus pore streaks, broad tonal
 * figure and (maple) a soft curly ripple.
 */
export function woodTile(kind) {
  if (woodCache.has(kind)) return woodCache.get(kind);
  const P = WOODS[kind];
  const S = 512;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const nz = new Noise2D(P.seed);
  const [lr, lg, lb] = P.light;
  const [dr, dg, db] = P.dark;
  for (let y = 0; y < S; y++) {
    const ny = y / S;
    for (let x = 0; x < S; x++) {
      const nx = x / S;
      const warp = nz.fbm(nx * 1.6, ny * 0.35, 3);
      const t = nx * P.rings + warp * P.warp + nz.noise(nx * 9, ny * 1.4) * 0.18;
      const f = t - Math.floor(t);
      // earlywood gradually darkens into a crisp latewood band
      let ring = f * f * 0.35 + smooth(0.78, 0.93, f) * (1 - smooth(0.96, 1.0, f)) * 0.9;
      // ring-to-ring variation
      ring *= 0.7 + 0.6 * (0.5 + 0.5 * nz.noise(Math.floor(t) * 0.37, 0.5));
      const pore = Math.max(0, nz.noise(nx * 300, ny * 7) - 0.25) * 1.6;
      const tone = nz.fbm(nx * 1.2 + 5, ny * 0.5, 2);
      let v = ring * P.ring + pore * P.pores;
      if (P.figure) v += P.figure * Math.sin(ny * 110 + nz.noise(nx * 4, ny * 10) * 4);
      v = clamp01(v);
      const k = 1 + tone * P.tone * 2;
      const i = (y * S + x) * 4;
      d[i] = (lr + (dr - lr) * v) * k;
      d[i + 1] = (lg + (dg - lg) * v) * k;
      d[i + 2] = (lb + (db - lb) * v) * k;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  woodCache.set(kind, c);
  return c;
}

/** Fill the polygon `pts` with a wood tile region rotated so the grain runs along `angle`. */
function woodFill(ctx, tile, pts, angle, rnd, grainScale) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  ctx.clip();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i]);
    minY = Math.min(minY, pts[i + 1]); maxY = Math.max(maxY, pts[i + 1]);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const diag = Math.hypot(maxX - minX, maxY - minY);
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  // grainScale: CSS px per tile px
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const srcSize = Math.min(512, diag / grainScale);
  const sx = rnd() * (512 - srcSize);
  const sy = rnd() * (512 - srcSize);
  ctx.drawImage(tile, sx, sy, srcSize, srcSize, -diag / 2, -diag / 2, diag, diag);
  ctx.restore();
}

// -------------------------------------------------------------------------------- stone (epic)
const stoneCache = new Map();

/** 256×256 dark glassy stone tiles: 'obsidian' (playable) and 'slate' (non-playable). */
export function stoneTile(kind) {
  if (stoneCache.has(kind)) return stoneCache.get(kind);
  const S = 256;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const nz = new Noise2D(kind === 'obsidian' ? 101 : 202);
  const rnd = mulberry32(kind === 'obsidian' ? 5 : 9);
  const obs = kind === 'obsidian';
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const nx = x / S;
      const ny = y / S;
      const f = nz.fbm(nx * 3, ny * 3, 4);
      const r2 = nz.ridged(nx * 2.2 + 3, ny * 2.2, 3);
      const i = (y * S + x) * 4;
      if (obs) {
        // deep volcanic glass: near-black with violet/indigo clouds and thin bright veins
        const vein = Math.pow(r2, 9) * 0.9;
        const cl = 0.5 + 0.5 * f;
        d[i] = 5 + cl * 10 + vein * 64;
        d[i + 1] = 4 + cl * 6 + vein * 40;
        d[i + 2] = 11 + cl * 20 + vein * 118;
      } else {
        // smoked slate: lighter, cooler, softer
        const cl = 0.5 + 0.5 * f;
        const vein = Math.pow(r2, 12) * 0.6;
        d[i] = 21 + cl * 16 + vein * 34;
        d[i + 1] = 16 + cl * 11 + vein * 26;
        d[i + 2] = 40 + cl * 26 + vein * 60;
      }
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // sparse glints
  for (let k = 0; k < (obs ? 70 : 35); k++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const a = 0.15 + rnd() * 0.4;
    ctx.fillStyle = `rgba(200,180,255,${a})`;
    ctx.fillRect(x, y, 1, 1);
  }
  stoneCache.set(kind, c);
  return c;
}

// -------------------------------------------------------------------------------- runes
/**
 * Draw a procedural rune glyph (strokes on a 3×4 lattice) centred at (cx, cy).
 * Deterministic per seed. Uses the current strokeStyle / lineWidth.
 */
export function runeGlyph(ctx, cx, cy, size, seed) {
  const rnd = mulberry32(seed * 7919 + 3);
  const w = size * 0.42;
  const h = size * 0.5;
  const px = (i) => cx - w + (i % 3) * w;
  const py = (i) => cy - h + Math.floor(i / 3) * (h * 2 / 3);
  ctx.beginPath();
  // spine
  const spine = Math.floor(rnd() * 3);
  ctx.moveTo(px(spine), py(spine));
  ctx.lineTo(px(spine + 9), py(spine + 9));
  const strokes = 2 + Math.floor(rnd() * 3);
  for (let s = 0; s < strokes; s++) {
    const a = Math.floor(rnd() * 12);
    let b = Math.floor(rnd() * 12);
    if (b === a) b = (a + 4) % 12;
    // avoid very long strokes across the glyph
    const dx = Math.abs((a % 3) - (b % 3));
    const dy = Math.abs(Math.floor(a / 3) - Math.floor(b / 3));
    if (dx + dy > 3) b = a + (a % 3 < 2 ? 1 : -1);
    ctx.moveTo(px(a), py(a));
    ctx.lineTo(px(b), py(b));
  }
  ctx.stroke();
  if (rnd() < 0.5) {
    const i = Math.floor(rnd() * 12);
    ctx.beginPath();
    ctx.arc(px(i), py(i), size * 0.09, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// -------------------------------------------------------------------------------- labels
function drawLabels(ctx, L, { color, shadow, font = 'Oswald', weight = 500, scale = 0.5, offset = 0.45 }) {
  const { n, sq, fw, total } = L;
  const fs = Math.max(7, Math.min(fw * scale, sq * 0.36));
  ctx.font = `${weight} ${fs}px "${font}", "Russo One", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    const [, c] = engineRC(L, 0, i);
    const [r] = engineRC(L, i, 0);
    const file = FILES[c];
    const rank = String(n - r);
    const x = fw + (i + 0.5) * sq;
    const yb = total - fw * offset - fw * 0.02;
    const xl = fw * offset + fw * 0.02;
    const y = fw + (i + 0.5) * sq;
    if (shadow) {
      ctx.fillStyle = shadow;
      ctx.fillText(file, x, yb + Math.max(0.6, fs * 0.07));
      ctx.fillText(rank, xl, y + Math.max(0.6, fs * 0.07));
    }
    ctx.fillStyle = color;
    ctx.fillText(file, x, yb);
    ctx.fillText(rank, xl, y);
  }
}

// -------------------------------------------------------------------------------- classic
export function drawClassicBoard(ctx, L) {
  const { n, sq, fw, total } = L;
  const bw = n * sq;
  const rnd = mulberry32(1234 + n * 7);
  const radius = Math.max(3, fw * 0.32);

  // ---- frame body (mitred walnut, grain along each side)
  ctx.save();
  roundRectPath(ctx, 0, 0, total, total, radius);
  ctx.clip();
  const ft = woodTile('frame');
  const T = total;
  const sides = [
    [[0, 0, T, 0, T - fw, fw, fw, fw], Math.PI / 2],
    [[T, 0, T, T, T - fw, T - fw, T - fw, fw], 0],
    [[T, T, 0, T, fw, T - fw, T - fw, T - fw], Math.PI / 2],
    [[0, T, 0, 0, fw, fw, fw, T - fw], 0],
  ];
  for (const [pts, ang] of sides) woodFill(ctx, ft, pts, ang, rnd, 0.42);
  // slight miter lines
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(fw, fw);
  ctx.moveTo(T, 0); ctx.lineTo(T - fw, fw);
  ctx.moveTo(T, T); ctx.lineTo(T - fw, T - fw);
  ctx.moveTo(0, T); ctx.lineTo(fw, T - fw);
  ctx.stroke();

  // frame lacquer: soft top light, darker bottom
  let g = ctx.createLinearGradient(0, 0, 0, T);
  g.addColorStop(0, 'rgba(255,220,170,0.10)');
  g.addColorStop(0.5, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, T, T);

  // rounded outer bevel: light top-left rim, dark bottom-right rim
  const bev = Math.max(1.5, fw * 0.14);
  g = ctx.createLinearGradient(0, 0, T, T);
  g.addColorStop(0, 'rgba(255,214,160,0.55)');
  g.addColorStop(0.45, 'rgba(255,214,160,0.10)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.10)');
  g.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.strokeStyle = g;
  ctx.lineWidth = bev;
  roundRectPath(ctx, bev / 2, bev / 2, T - bev, T - bev, radius - bev / 2);
  ctx.stroke();
  // lacquer gloss on the frame's rounded profile
  ctx.lineWidth = Math.max(1, fw * 0.12);
  g = ctx.createLinearGradient(0, 0, 0, T);
  g.addColorStop(0, 'rgba(255,220,170,0.22)');
  g.addColorStop(0.5, 'rgba(255,220,170,0.06)');
  g.addColorStop(1, 'rgba(255,220,170,0.02)');
  ctx.strokeStyle = g;
  roundRectPath(ctx, fw * 0.3, fw * 0.3, T - fw * 0.6, T - fw * 0.6, Math.max(1, radius - fw * 0.3));
  ctx.stroke();
  // crisp outer highlight line
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = 'rgba(255,225,180,0.28)';
  roundRectPath(ctx, bev + 0.4, bev + 0.4, T - 2 * bev - 0.8, T - 2 * bev - 0.8, Math.max(1, radius - bev));
  ctx.stroke();
  ctx.restore();

  // ---- playing field
  ctx.save();
  ctx.beginPath();
  ctx.rect(fw, fw, bw, bw);
  ctx.clip();
  const turkish = L.playable === 'all';
  const maple = woodTile(turkish ? 'turkish' : 'maple');
  const walnut = woodTile('walnut');
  for (let dr = 0; dr < n; dr++) {
    for (let dc = 0; dc < n; dc++) {
      const [r, c] = engineRC(L, dr, dc);
      const x = fw + dc * sq;
      const y = fw + dr * sq;
      const dark = !turkish && isDarkSquare(L, r, c);
      const tile = dark ? walnut : maple;
      // grain direction: all vertical on the checker board; alternate on the Turkish board
      const ang = turkish && (dr + dc) % 2 ? Math.PI / 2 : 0;
      woodFill(ctx, tile, [x, y, x + sq, y, x + sq, y + sq, x, y + sq], ang, rnd, dark ? 0.32 : 0.34);
      // per-veneer tonal variance
      const tv = (rnd() - 0.5) * (dark ? 0.1 : 0.07);
      ctx.fillStyle = tv > 0 ? `rgba(255,240,210,${tv})` : `rgba(40,20,5,${-tv})`;
      ctx.fillRect(x, y, sq, sq);
    }
  }

  if (turkish) {
    // Dama grid lines
    const lw = Math.max(1.1, sq * 0.035);
    ctx.strokeStyle = rgba(CLASSIC.turkishLine, 0.85);
    ctx.lineWidth = lw;
    ctx.beginPath();
    for (let i = 1; i < n; i++) {
      ctx.moveTo(fw + i * sq, fw);
      ctx.lineTo(fw + i * sq, fw + bw);
      ctx.moveTo(fw, fw + i * sq);
      ctx.lineTo(fw + bw, fw + i * sq);
    }
    ctx.stroke();
    // engraved highlight next to each line
    ctx.strokeStyle = 'rgba(255,240,210,0.35)';
    ctx.lineWidth = Math.max(0.6, lw * 0.4);
    ctx.beginPath();
    for (let i = 1; i < n; i++) {
      ctx.moveTo(fw + i * sq + lw * 0.85, fw);
      ctx.lineTo(fw + i * sq + lw * 0.85, fw + bw);
      ctx.moveTo(fw, fw + i * sq + lw * 0.85);
      ctx.lineTo(fw + bw, fw + i * sq + lw * 0.85);
    }
    ctx.stroke();
  } else {
    // fine joints between veneers
    ctx.strokeStyle = 'rgba(30,14,4,0.28)';
    ctx.lineWidth = Math.max(0.5, sq * 0.012);
    ctx.beginPath();
    for (let i = 1; i < n; i++) {
      ctx.moveTo(fw + i * sq, fw);
      ctx.lineTo(fw + i * sq, fw + bw);
      ctx.moveTo(fw, fw + i * sq);
      ctx.lineTo(fw + bw, fw + i * sq);
    }
    ctx.stroke();
  }

  // amber lacquer tone (warms the maple, deepens the walnut)
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = 'rgba(255,214,150,0.35)';
  ctx.fillRect(fw, fw, bw, bw);
  ctx.globalCompositeOperation = 'source-over';
  // lacquer sheen: broad diagonal light + gentle falloff to the corners
  g = ctx.createLinearGradient(fw, fw, fw + bw, fw + bw);
  g.addColorStop(0, 'rgba(255,244,220,0.10)');
  g.addColorStop(0.35, 'rgba(255,244,220,0.03)');
  g.addColorStop(0.55, 'rgba(255,248,230,0.0)');
  g.addColorStop(1, 'rgba(0,0,0,0.10)');
  ctx.fillStyle = g;
  ctx.fillRect(fw, fw, bw, bw);
  // soft reflection streak
  ctx.save();
  ctx.translate(fw + bw * 0.3, fw + bw * 0.3);
  ctx.rotate(-Math.PI / 4);
  g = ctx.createLinearGradient(0, -bw * 0.12, 0, bw * 0.12);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,250,235,0.06)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-bw, -bw * 0.12, bw * 2, bw * 0.24);
  ctx.restore();
  // vignette inside the field
  g = ctx.createRadialGradient(fw + bw / 2, fw + bw / 2, bw * 0.35, fw + bw / 2, fw + bw / 2, bw * 0.78);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(20,8,0,0.22)');
  ctx.fillStyle = g;
  ctx.fillRect(fw, fw, bw, bw);
  // inner shadow cast by the frame
  const sh = Math.max(2, sq * 0.14);
  const edges = [
    [fw, fw, fw, fw + sh, 0, 0, bw, sh],
    [fw, fw, fw + sh, fw, 0, 0, sh, bw],
  ];
  for (const [x0, y0, x1, y1, , , w, h] of edges) {
    g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(10,4,0,0.45)');
    g.addColorStop(1, 'rgba(10,4,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(fw, fw, w, h);
  }
  g = ctx.createLinearGradient(0, fw + bw, 0, fw + bw - sh * 0.6);
  g.addColorStop(0, 'rgba(10,4,0,0.25)');
  g.addColorStop(1, 'rgba(10,4,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(fw, fw + bw - sh, bw, sh);
  g = ctx.createLinearGradient(fw + bw, 0, fw + bw - sh * 0.6, 0);
  g.addColorStop(0, 'rgba(10,4,0,0.25)');
  g.addColorStop(1, 'rgba(10,4,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(fw + bw - sh, fw, sh, bw);
  ctx.restore();

  // ---- edge where the frame meets the field: dark groove + highlight
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = Math.max(1, fw * 0.07);
  ctx.strokeRect(fw - ctx.lineWidth / 2, fw - ctx.lineWidth / 2, bw + ctx.lineWidth, bw + ctx.lineWidth);

  // ---- gold inlay
  const gi = Math.max(1, Math.min(2.2, fw * 0.075));
  const inset = Math.max(2.5, fw * 0.2);
  const gx = fw - inset;
  g = ctx.createLinearGradient(0, 0, total, total);
  g.addColorStop(0, '#F6DE92');
  g.addColorStop(0.25, '#C9A04C');
  g.addColorStop(0.5, '#EED489');
  g.addColorStop(0.75, '#A77F33');
  g.addColorStop(1, '#D9B865');
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = gi;
  ctx.strokeRect(gx + 0.6, gx + 0.8, bw + 2 * inset, bw + 2 * inset);
  ctx.strokeStyle = g;
  ctx.strokeRect(gx, gx, bw + 2 * inset, bw + 2 * inset);
  // fine outer inlay line
  const oi = Math.max(2, fw * 0.17);
  ctx.lineWidth = Math.max(0.6, gi * 0.45);
  ctx.globalAlpha = 0.65;
  ctx.strokeRect(oi, oi, total - 2 * oi, total - 2 * oi);
  ctx.globalAlpha = 1;
  // corner diamonds
  const ds = Math.max(2, fw * 0.16);
  ctx.fillStyle = g;
  for (const [cx, cy] of [[gx, gx], [gx + bw + 2 * inset, gx], [gx, gx + bw + 2 * inset], [gx + bw + 2 * inset, gx + bw + 2 * inset]]) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - ds);
    ctx.lineTo(cx + ds, cy);
    ctx.lineTo(cx, cy + ds);
    ctx.lineTo(cx - ds, cy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,35,5,0.6)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }

  if (L.labels) {
    drawLabels(ctx, L, {
      color: 'rgba(222,190,118,0.92)',
      shadow: 'rgba(0,0,0,0.65)',
      scale: 0.48,
      offset: 0.47,
    });
  }
}

// -------------------------------------------------------------------------------- epic
export function drawEpicBoard(ctx, L) {
  const { n, sq, fw, total } = L;
  const bw = n * sq;
  const T = total;
  const rnd = mulberry32(777 + n);
  const ch = Math.max(4, fw * 0.55);

  // ---- frame: dark gunmetal with violet sheen
  ctx.save();
  chamferRectPath(ctx, 0, 0, T, T, ch);
  ctx.clip();
  let g = ctx.createLinearGradient(0, 0, 0, T);
  g.addColorStop(0, '#1d1638');
  g.addColorStop(0.5, '#120d24');
  g.addColorStop(1, '#0a0716');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, T, T);
  // brushed streaks
  ctx.globalAlpha = 0.5;
  const slate = stoneTile('slate');
  ctx.globalCompositeOperation = 'overlay';
  ctx.drawImage(slate, 0, 0, 256, 256, 0, 0, T, T);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  // diagonal sheen across the frame
  g = ctx.createLinearGradient(0, 0, T, T);
  g.addColorStop(0, 'rgba(160,140,255,0.16)');
  g.addColorStop(0.3, 'rgba(160,140,255,0.02)');
  g.addColorStop(0.7, 'rgba(0,0,0,0.0)');
  g.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, T, T);

  // circuit traces inside the band
  const trace = fw * 0.5;
  ctx.strokeStyle = rgba(EPIC.grid, 0.22);
  ctx.lineWidth = Math.max(0.6, fw * 0.035);
  ctx.beginPath();
  const tb = fw * 0.2;
  ctx.moveTo(ch + tb, tb);
  ctx.lineTo(T - ch - tb, tb);
  ctx.moveTo(T - tb, ch + tb);
  ctx.lineTo(T - tb, T - ch - tb);
  ctx.moveTo(T - ch - tb, T - tb);
  ctx.lineTo(ch + tb, T - tb);
  ctx.moveTo(tb, T - ch - tb);
  ctx.lineTo(tb, ch + tb);
  ctx.stroke();
  // small circuit nodes + jogs along the traces
  ctx.fillStyle = rgba(EPIC.grid, 0.45);
  for (let i = 0; i < n; i++) {
    const p = fw + (i + 0.5) * sq;
    if (i % 2 === 0) {
      // (bottom / left bands carry the coordinate labels → no nodes there when labelled)
      const bands = L.labels ? [[p, tb, 0, 1], [T - tb, p, -1, 0]] : [[p, tb, 0, 1], [T - tb, p, -1, 0], [p, T - tb, 0, -1], [tb, p, 1, 0]];
      for (const [x, y, dx, dy] of bands) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + dx * trace * 0.5, y + dy * trace * 0.5);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x + dx * trace * 0.5, y + dy * trace * 0.5, Math.max(0.8, fw * 0.05), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();

  // frame outer edge (bevel + neon hairline)
  ctx.lineWidth = Math.max(1, fw * 0.08);
  g = ctx.createLinearGradient(0, 0, T, T);
  g.addColorStop(0, 'rgba(190,170,255,0.55)');
  g.addColorStop(0.5, 'rgba(120,92,255,0.25)');
  g.addColorStop(1, 'rgba(60,40,140,0.5)');
  ctx.strokeStyle = g;
  chamferRectPath(ctx, ctx.lineWidth / 2, ctx.lineWidth / 2, T - ctx.lineWidth, T - ctx.lineWidth, ch);
  ctx.stroke();

  // ---- tiles
  ctx.save();
  ctx.beginPath();
  ctx.rect(fw, fw, bw, bw);
  ctx.clip();
  const obs = stoneTile('obsidian');
  const sl = stoneTile('slate');
  const turkish = L.playable === 'all';
  for (let dr = 0; dr < n; dr++) {
    for (let dc = 0; dc < n; dc++) {
      const [r, c] = engineRC(L, dr, dc);
      const x = fw + dc * sq;
      const y = fw + dr * sq;
      const dark = turkish || isDarkSquare(L, r, c);
      const tile = dark ? obs : sl;
      const src = 96 + rnd() * 60;
      ctx.drawImage(tile, rnd() * (256 - src), rnd() * (256 - src), src, src, x, y, sq, sq);
      // glassy tile shading: top-left light, bottom-right depth
      g = ctx.createLinearGradient(x, y, x + sq, y + sq);
      if (dark) {
        g.addColorStop(0, 'rgba(150,120,255,0.07)');
        g.addColorStop(0.5, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,0.4)');
      } else {
        g.addColorStop(0, 'rgba(190,170,255,0.10)');
        g.addColorStop(0.5, 'rgba(110,90,200,0.02)');
        g.addColorStop(1, 'rgba(0,0,0,0.3)');
      }
      ctx.fillStyle = g;
      ctx.fillRect(x, y, sq, sq);
      // bevel lines
      const b = Math.max(0.6, sq * 0.025);
      ctx.fillStyle = dark ? 'rgba(170,150,255,0.08)' : 'rgba(200,185,255,0.12)';
      ctx.fillRect(x, y, sq, b);
      ctx.fillRect(x, y, b, sq);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(x, y + sq - b, sq, b);
      ctx.fillRect(x + sq - b, y, b, sq);
      if (!dark) {
        // inactive tiles sink back (EAD-11: the playable diagonals must read at a glance)
        ctx.fillStyle = 'rgba(3,2,10,0.5)';
        ctx.fillRect(x, y, sq, sq);
        // faint etched rune on inactive tiles
        ctx.strokeStyle = 'rgba(150,130,255,0.06)';
        ctx.lineWidth = Math.max(0.6, sq * 0.03);
        ctx.lineCap = 'round';
        runeGlyph(ctx, x + sq / 2, y + sq / 2, sq * 0.38, r * 31 + c * 7);
      } else if (!turkish) {
        // playable tiles are lit energy pads: violet lift, inner glow toward the rim, neon edge
        ctx.fillStyle = 'rgba(104,74,232,0.50)';
        ctx.fillRect(x, y, sq, sq);
        g = ctx.createRadialGradient(x + sq / 2, y + sq / 2, sq * 0.18, x + sq / 2, y + sq / 2, sq * 0.74);
        g.addColorStop(0, 'rgba(122,92,255,0)');
        g.addColorStop(1, 'rgba(160,130,255,0.38)');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, sq, sq);
        const e = Math.max(1, sq * 0.03);
        ctx.strokeStyle = rgba(EPIC.grid, 0.5);
        ctx.lineWidth = e;
        ctx.strokeRect(x + e * 1.5, y + e * 1.5, sq - e * 3, sq - e * 3);
      }
    }
  }
  // seams: dark gap with a faint neon core (the glowing part lives in the seam glow layer)
  const seam = Math.max(1.2, sq * 0.05);
  ctx.strokeStyle = 'rgba(2,1,6,0.95)';
  ctx.lineWidth = seam;
  ctx.beginPath();
  for (let i = 1; i < n; i++) {
    ctx.moveTo(fw + i * sq, fw);
    ctx.lineTo(fw + i * sq, fw + bw);
    ctx.moveTo(fw, fw + i * sq);
    ctx.lineTo(fw + bw, fw + i * sq);
  }
  ctx.stroke();
  ctx.strokeStyle = rgba(EPIC.grid, turkish ? 0.8 : 0.55);
  ctx.lineWidth = Math.max(0.6, seam * 0.4);
  ctx.stroke();
  // depth vignette
  g = ctx.createRadialGradient(fw + bw / 2, fw + bw / 2, bw * 0.2, fw + bw / 2, fw + bw / 2, bw * 0.75);
  g.addColorStop(0, 'rgba(60,30,140,0.10)');
  g.addColorStop(1, 'rgba(0,0,0,0.4)');
  ctx.fillStyle = g;
  ctx.fillRect(fw, fw, bw, bw);
  // polished slab: broad diagonal reflection
  g = ctx.createLinearGradient(fw, fw, fw + bw, fw + bw);
  g.addColorStop(0, 'rgba(200,190,255,0.10)');
  g.addColorStop(0.28, 'rgba(200,190,255,0.03)');
  g.addColorStop(0.3, 'rgba(200,190,255,0.0)');
  g.addColorStop(0.62, 'rgba(200,190,255,0.0)');
  g.addColorStop(0.64, 'rgba(200,190,255,0.035)');
  g.addColorStop(0.72, 'rgba(200,190,255,0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(fw, fw, bw, bw);
  ctx.restore();

  // inner border: deep groove + neon line
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineWidth = Math.max(2, fw * 0.16);
  ctx.strokeRect(fw - ctx.lineWidth / 2, fw - ctx.lineWidth / 2, bw + ctx.lineWidth, bw + ctx.lineWidth);
  ctx.strokeStyle = rgba(EPIC.grid, 0.95);
  ctx.lineWidth = Math.max(1, fw * 0.07);
  ctx.strokeRect(fw - ctx.lineWidth * 1.5, fw - ctx.lineWidth * 1.5, bw + ctx.lineWidth * 3, bw + ctx.lineWidth * 3);

  if (L.labels) {
    drawLabels(ctx, L, {
      color: 'rgba(196,182,255,0.78)',
      shadow: 'rgba(0,0,0,0.8)',
      font: 'Oswald',
      weight: 500,
      scale: 0.42,
      offset: 0.5,
    });
  }
}

/** Additive glow layer of the epic seams (alpha-animated by the board view). */
export function drawEpicSeamGlow(ctx, L) {
  const { n, sq, fw } = L;
  const bw = n * sq;
  const turkish = L.playable === 'all';
  ctx.lineCap = 'round';
  // wide soft pass (manual blur: stacked strokes)
  const passes = [
    [Math.max(4, sq * 0.22), 0.035],
    [Math.max(2.5, sq * 0.1), 0.08],
    [Math.max(1.2, sq * 0.042), 0.32],
    [Math.max(0.7, sq * 0.016), 0.95],
  ];
  for (const [w, a] of passes) {
    ctx.strokeStyle = rgba(passes[3][0] === w ? EPIC.gridHot : EPIC.grid, a * (turkish ? 1.1 : 1));
    ctx.lineWidth = w;
    ctx.beginPath();
    for (let i = 1; i < n; i++) {
      ctx.moveTo(fw + i * sq, fw);
      ctx.lineTo(fw + i * sq, fw + bw);
      ctx.moveTo(fw, fw + i * sq);
      ctx.lineTo(fw + bw, fw + i * sq);
    }
    ctx.stroke();
  }
  // intersections: tiny hot nodes
  ctx.fillStyle = rgba(EPIC.gridHot, 0.9);
  const nr = Math.max(0.8, sq * 0.035);
  for (let i = 1; i < n; i++) {
    for (let j = 1; j < n; j++) {
      ctx.beginPath();
      ctx.arc(fw + i * sq, fw + j * sq, nr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // border
  const passesB = [
    [Math.max(6, fw * 0.5), 0.06],
    [Math.max(3, fw * 0.25), 0.14],
    [Math.max(1.2, fw * 0.08), 0.8],
  ];
  const off = Math.max(1, fw * 0.07) * 1.5;
  for (const [w, a] of passesB) {
    ctx.strokeStyle = rgba(EPIC.grid, a);
    ctx.lineWidth = w;
    ctx.strokeRect(fw - off, fw - off, bw + off * 2, bw + off * 2);
  }
}

/** Soft drop shadow under the whole board. Canvas is (T + 2m)². */
export function drawBoardShadow(ctx, T, m, { alpha = 0.7, radius = 6, k = 1 } = {}) {
  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${alpha})`;
  ctx.shadowBlur = m * 0.45 * k; // shadowBlur ignores the transform → scale by device px / unit
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  roundRectPath(ctx, m, m, T, T, radius);
  ctx.fill();
  ctx.restore();
}

/** White outer glow ring around the frame (tinted with the turn colour). Canvas (T + 2m)². */
export function drawEdgeGlow(ctx, T, m, chamfer) {
  const passes = [
    [m * 1.6, 0.05],
    [m * 1.0, 0.08],
    [m * 0.55, 0.14],
    [m * 0.25, 0.3],
    [Math.max(1.5, m * 0.08), 0.85],
  ];
  ctx.lineJoin = 'round';
  for (const [w, a] of passes) {
    ctx.strokeStyle = `rgba(255,255,255,${a})`;
    ctx.lineWidth = w;
    chamferRectPath(ctx, m, m, T, T, chamfer);
    ctx.stroke();
  }
  // punch the inside out a bit so the glow stays at the rim
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  chamferRectPath(ctx, m + m * 0.12, m + m * 0.12, T - m * 0.24, T - m * 0.24, chamfer);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

/** Magic circle (white; tinted + additive). `part`: 'outer' (ring with runes) | 'inner' (hexagram). */
export function drawMagicCircle(ctx, size, part) {
  const c = size / 2;
  const R = size / 2 - 2;
  ctx.translate(c, c);
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (part === 'outer') {
    ctx.lineWidth = Math.max(1, size * 0.004);
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, R * 0.9, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = Math.max(0.8, size * 0.0025);
    ctx.beginPath(); ctx.arc(0, 0, R * 0.965, 0, Math.PI * 2); ctx.stroke();
    // ticks
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      const l = i % 5 === 0 ? 0.035 : 0.015;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * R * 0.9, Math.sin(a) * R * 0.9);
      ctx.lineTo(Math.cos(a) * R * (0.9 + l), Math.sin(a) * R * (0.9 + l));
      ctx.stroke();
    }
    // runes between the rings
    const count = 24;
    ctx.lineWidth = Math.max(0.9, size * 0.0035);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      ctx.save();
      ctx.rotate(a);
      ctx.translate(0, -R * 0.932);
      runeGlyph(ctx, 0, 0, R * 0.05, i + 3);
      ctx.restore();
    }
    ctx.beginPath(); ctx.arc(0, 0, R * 0.78, 0, Math.PI * 2); ctx.stroke();
  } else {
    ctx.lineWidth = Math.max(1, size * 0.0035);
    const r = R * 0.74;
    // hexagram
    for (let k = 0; k < 2; k++) {
      ctx.beginPath();
      for (let i = 0; i <= 3; i++) {
        const a = -Math.PI / 2 + k * Math.PI + (i / 3) * Math.PI * 2;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.46, 0, Math.PI * 2); ctx.stroke();
    // small circles at the star points
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r, Math.sin(a) * r, R * 0.035, 0, Math.PI * 2);
      ctx.stroke();
    }
    // inner runes
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + ((i + 0.5) / 6) * Math.PI * 2;
      runeGlyph(ctx, Math.cos(a) * r * 0.66, Math.sin(a) * r * 0.66, R * 0.08, 40 + i);
    }
  }
}

/** Rune glyph sprite texture painter (glowing), size×size. */
export function drawRuneSprite(ctx, size, seed) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = size * 0.22;
  runeGlyph(ctx, size / 2, size / 2, size * 0.6, seed);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = size * 0.12;
  runeGlyph(ctx, size / 2, size / 2, size * 0.6, seed);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = Math.max(0.8, size * 0.055);
  runeGlyph(ctx, size / 2, size / 2, size * 0.6, seed);
}

/** Corner sigil: diamond in a circle with ticks. size×size, white. */
export function drawCornerSigil(ctx, size) {
  const c = size / 2;
  ctx.translate(c, c);
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  const passes = [[size * 0.16, 0.12], [size * 0.08, 0.3], [Math.max(0.8, size * 0.035), 1]];
  for (const [w, a] of passes) {
    ctx.globalAlpha = a;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.2);
    ctx.lineTo(size * 0.2, 0);
    ctx.lineTo(0, size * 0.2);
    ctx.lineTo(-size * 0.2, 0);
    ctx.closePath();
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const a2 = (i * Math.PI) / 2 + Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a2) * size * 0.33, Math.sin(a2) * size * 0.33);
      ctx.lineTo(Math.cos(a2) * size * 0.43, Math.sin(a2) * size * 0.43);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

/** Elongated soft streak (white) used for the energy sparks running along the seams. */
export function drawStreak(ctx, w, h) {
  ctx.save();
  ctx.scale(1, h / w);
  const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.15, 'rgba(255,255,255,0.8)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, w);
  ctx.restore();
}

export { smooth };
