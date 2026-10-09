#!/usr/bin/env node
// Launcher icon generator for EPIC ШАШКИ.
//
//   node tools/make-icon.mjs                 -> writes all icons (see OUTPUTS below)
//   node tools/make-icon.mjs --preview DIR   -> also writes large previews (masks, sizes) to DIR
//
// The icon is drawn procedurally with Canvas 2D inside headless Chromium (Playwright), so it is
// reproducible from source: a glossy obsidian checker piece charged with energy (electric cyan
// vs crimson, the two sides of EPIC mode), a gold crown and a lightning slash, on a dark void
// (#05030C -> #2A0F3A) with manga speed rays.
//
// Outputs (committed to the repo; build-apk.sh only regenerates them when missing):
//   android/res/mipmap-{mdpi..xxxhdpi}/ic_launcher.png, ic_launcher_round.png      (legacy, 48dp)
//   android/res/mipmap-{mdpi..xxxhdpi}/ic_launcher_{background,foreground,monochrome}.png (108dp)
//   android/res/mipmap-anydpi-v26/ic_launcher.xml, ic_launcher_round.xml          (adaptive)
//   web/static/icon-512.png                                                       (web build)
//
// Everything is drawn in "dp" units of the 108x108 adaptive-icon canvas. The important content
// stays inside the 66dp safe circle; launchers show the central 72dp.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const previewIdx = args.indexOf('--preview');
const previewDir = previewIdx >= 0 ? path.resolve(args[previewIdx + 1]) : null;

const DENSITIES = [
  { name: 'mdpi', scale: 1 },
  { name: 'hdpi', scale: 1.5 },
  { name: 'xhdpi', scale: 2 },
  { name: 'xxhdpi', scale: 3 },
  { name: 'xxxhdpi', scale: 4 },
];

// ------------------------------------------------------------------ in-page renderer
// Runs inside Chromium. Exposes window.renderIcon(kind, px) -> PNG data URL.
const PAGE_SCRIPT = String.raw`
const COL = {
  void0: '#05030C', void1: '#2A0F3A', cyan: '#29E6FF', crimson: '#FF2E63',
  gold: '#FFD23F', violet: '#7A5CFF', white: '#FFFFFF',
};

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(px) {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  return c;
}

// Geometry of the hero piece (dp, 108 canvas). Inner safe circle: r = 33 around (54, 54).
const CX = 54, CY = 51.5, R = 24, TH = 5.6;

// Draws with a blur on a temp canvas and adds it to ctx ('lighter'), for soft energy glows.
function glow(ctx, S, blurDp, draw, { op = 'lighter', alpha = 1 } = {}) {
  const u = S / 108;
  const t = canvas(S);
  const g = t.getContext('2d');
  g.scale(u, u);
  draw(g);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = op;
  ctx.globalAlpha = alpha;
  ctx.filter = 'blur(' + (blurDp * u).toFixed(2) + 'px)';
  ctx.drawImage(t, 0, 0);
  ctx.restore();
}

function softDot(ctx, x, y, r, color, alpha = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function conicDuel(ctx, cx, cy) {
  // cyan owns the upper-left half, crimson the lower-right half; they clash white-hot on the
  // bolt's axis (upper-right and lower-left)
  const g = ctx.createConicGradient(Math.PI * 0.75, cx, cy);
  g.addColorStop(0.0, '#FFFFFF');
  g.addColorStop(0.05, COL.cyan);
  g.addColorStop(0.25, '#9DF3FF');
  g.addColorStop(0.45, COL.cyan);
  g.addColorStop(0.5, '#FFFFFF');
  g.addColorStop(0.55, COL.crimson);
  g.addColorStop(0.75, '#FF86A8');
  g.addColorStop(0.95, COL.crimson);
  g.addColorStop(1.0, '#FFFFFF');
  return g;
}

// ---- lightning slash: a classic bolt glyph striking diagonally through the crown, the line
// where the two energies clash (cyan glow on its upper-left side, crimson on the lower-right)
const BOLT = { x: 54.5, y: 53, angle: 0.64 };
// Spine in the bolt's local frame (vertical, pointing down) + width at each vertex.
const BOLT_SPINE = [
  [6.5, -60, 0],
  [-3.5, -33, 4.9],
  [6.5, -27.5, 5.5],
  [-5.5, 25, 5.7],
  [4.5, 30.5, 5.1],
  [-6.5, 60, 0],
];
function boltPoints() {
  const c = Math.cos(BOLT.angle), s = Math.sin(BOLT.angle);
  return BOLT_SPINE.map(([lx, ly, w]) => ({ x: BOLT.x + lx * c - ly * s, y: BOLT.y + lx * s + ly * c, w }));
}

// Tapered ribbon along a polyline with mitred (sharp) corners.
function boltPath(ctx, widthScale = 1) {
  const pts = boltPoints();
  const n = pts.length;
  const normal = (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    return { x: -dy / l, y: dx / l };
  };
  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const hw = (p.w * widthScale) / 2 + (widthScale > 1 ? (widthScale - 1) * 1.2 : 0);
    let ox, oy;
    if (i === 0 || i === n - 1) {
      const nn = i === 0 ? normal(pts[0], pts[1]) : normal(pts[n - 2], pts[n - 1]);
      ox = nn.x * hw; oy = nn.y * hw;
    } else {
      const n0 = normal(pts[i - 1], p), n1 = normal(p, pts[i + 1]);
      let mx = n0.x + n1.x, my = n0.y + n1.y;
      const ml = Math.hypot(mx, my) || 1;
      mx /= ml; my /= ml;
      const d = Math.max(0.3, mx * n0.x + my * n0.y);
      const len = Math.min(hw / d, hw * 3);
      ox = mx * len; oy = my * len;
    }
    left.push({ x: p.x + ox, y: p.y + oy });
    right.push({ x: p.x - ox, y: p.y - oy });
  }
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < n; i++) ctx.lineTo(left[i].x, left[i].y);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
}

function drawBolt(ctx, S, { mono = false } = {}) {
  if (mono) return; // the monochrome (themed) icon keeps only piece + crown
  const nx = -Math.cos(BOLT.angle), ny = -Math.sin(BOLT.angle); // towards the upper-left side
  glow(ctx, S, 4, (g) => {
    g.save(); g.translate(nx * 2.2, ny * 2.2); g.fillStyle = COL.cyan; boltPath(g, 1.5); g.fill(); g.restore();
    g.save(); g.translate(-nx * 2.2, -ny * 2.2); g.fillStyle = COL.crimson; boltPath(g, 1.5); g.fill(); g.restore();
  }, { alpha: 0.95 });
  glow(ctx, S, 1.2, (g) => {
    g.save(); g.translate(nx * 0.9, ny * 0.9); g.fillStyle = COL.cyan; boltPath(g, 1.1); g.fill(); g.restore();
    g.save(); g.translate(-nx * 0.9, -ny * 0.9); g.fillStyle = COL.crimson; boltPath(g, 1.1); g.fill(); g.restore();
  });
  ctx.save();
  ctx.lineJoin = 'miter';
  ctx.fillStyle = '#FFFFFF';
  boltPath(ctx, 1);
  ctx.fill();
  ctx.restore();
}

// ---- the piece
function drawAura(ctx, S) {
  glow(ctx, S, 6, (g) => {
    g.lineWidth = 7;
    g.strokeStyle = conicDuel(g, CX, CY + TH * 0.5);
    g.beginPath(); g.arc(CX, CY + TH * 0.5, R + 3.5, 0, Math.PI * 2); g.stroke();
  }, { alpha: 0.85 });
  glow(ctx, S, 2.2, (g) => {
    g.lineWidth = 3;
    g.strokeStyle = conicDuel(g, CX, CY + TH * 0.5);
    g.beginPath(); g.arc(CX, CY + TH * 0.5, R + 1.2, 0, Math.PI * 2); g.stroke();
  }, { alpha: 0.9 });
}

function drawBody(ctx, S, { mono = false } = {}) {
  if (mono) {
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(CX, CY + TH, R + 0.8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(CX, CY, R + 0.8, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.arc(CX, CY, R - 3.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return;
  }
  // side wall (thickness), lit by both energies
  ctx.save();
  const side = ctx.createLinearGradient(CX - R, 0, CX + R, 0);
  side.addColorStop(0, '#0E5A78');
  side.addColorStop(0.28, '#0A0D1C');
  side.addColorStop(0.72, '#1A0610');
  side.addColorStop(1, '#8A1438');
  ctx.fillStyle = side;
  ctx.beginPath();
  ctx.arc(CX, CY + TH, R, 0, Math.PI);
  ctx.lineTo(CX - R, CY);
  ctx.arc(CX, CY, R, Math.PI, 0, true);
  ctx.closePath();
  ctx.fill();
  // groove on the side wall
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath(); ctx.arc(CX, CY + TH * 0.55, R, 0.02 * Math.PI, 0.98 * Math.PI); ctx.stroke();
  // bottom rim light
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = conicDuel(ctx, CX, CY + TH);
  ctx.beginPath(); ctx.arc(CX, CY + TH - 0.4, R - 0.2, 0.04 * Math.PI, 0.96 * Math.PI); ctx.stroke();
  ctx.restore();

  // top face: deep glossy obsidian
  ctx.save();
  const face = ctx.createRadialGradient(CX - R * 0.3, CY - R * 0.4, R * 0.05, CX, CY, R * 1.02);
  face.addColorStop(0, '#271838');
  face.addColorStop(0.5, '#0E0818');
  face.addColorStop(1, '#030106');
  ctx.fillStyle = face;
  ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2); ctx.fill();

  ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2); ctx.clip();
  // energy bleeding in from the rim (reflections of the aura on the lacquer)
  glow(ctx, S, 2.6, (g) => {
    g.lineWidth = 4;
    g.strokeStyle = conicDuel(g, CX, CY);
    g.beginPath(); g.arc(CX, CY, R - 2.2, 0, Math.PI * 2); g.stroke();
  }, { alpha: 0.28 });
  // violet core glow under the crown
  const bloom = ctx.createRadialGradient(CX, CY + 2, 0, CX, CY + 2, R * 0.9);
  bloom.addColorStop(0, 'rgba(140,100,255,0.50)');
  bloom.addColorStop(0.6, 'rgba(122,92,255,0.10)');
  bloom.addColorStop(1, 'rgba(122,92,255,0)');
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = bloom;
  ctx.fillRect(CX - R, CY - R, 2 * R, 2 * R);
  ctx.globalCompositeOperation = 'source-over';
  // concentric grooves (dark cut + lit edge)
  for (const [rr, a] of [[0.79, 0.7], [0.63, 0.45]]) {
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(0,0,0,' + a + ')';
    ctx.beginPath(); ctx.arc(CX, CY + 0.3, R * rr, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 0.55;
    ctx.globalAlpha = a;
    ctx.strokeStyle = conicDuel(ctx, CX, CY);
    ctx.beginPath(); ctx.arc(CX, CY - 0.45, R * rr, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // energy rim on the top edge
  ctx.save();
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = conicDuel(ctx, CX, CY);
  ctx.beginPath(); ctx.arc(CX, CY, R - 1.0, 0, Math.PI * 2); ctx.stroke();
  glow(ctx, S, 1.3, (g) => {
    g.lineWidth = 2.6;
    g.strokeStyle = conicDuel(g, CX, CY);
    g.beginPath(); g.arc(CX, CY, R - 1.0, 0, Math.PI * 2); g.stroke();
  }, { alpha: 0.85 });
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath(); ctx.arc(CX, CY, R - 1.0, Math.PI * 1.02, Math.PI * 1.58); ctx.stroke();
  ctx.beginPath(); ctx.arc(CX, CY, R - 1.0, Math.PI * 0.08, Math.PI * 0.42); ctx.stroke();
  ctx.restore();
}

function drawGloss(ctx) {
  // lacquer specular: a soft crescent on the upper-left of the face
  ctx.save();
  ctx.beginPath(); ctx.arc(CX, CY, R - 2.4, 0, Math.PI * 2); ctx.clip();
  ctx.translate(CX - R * 0.28, CY - R * 0.5);
  ctx.rotate(-0.6);
  ctx.scale(1, 0.4);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.7);
  g.addColorStop(0, 'rgba(255,255,255,0.42)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, R * 0.7, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ---- the crown
const CROWN = { w: 32, h: 23, cx: CX, cy: CY + 10.4 };
function crownPath(ctx, cx, cy, w, h) {
  const x0 = cx - w / 2, x1 = cx + w / 2;
  const base = cy, band = cy - h * 0.27, top = cy - h;
  ctx.beginPath();
  ctx.moveTo(x0 + w * 0.05, base);
  ctx.lineTo(x0 + w * 0.01, band);
  ctx.lineTo(x0 - w * 0.03, top + h * 0.2);            // left spike
  ctx.lineTo(x0 + w * 0.28, band - h * 0.28);
  ctx.lineTo(cx, top);                                  // centre spike
  ctx.lineTo(x1 - w * 0.28, band - h * 0.28);
  ctx.lineTo(x1 + w * 0.03, top + h * 0.2);             // right spike
  ctx.lineTo(x1 - w * 0.01, band);
  ctx.lineTo(x1 - w * 0.05, base);
  ctx.quadraticCurveTo(cx, base + h * 0.12, x0 + w * 0.05, base);
  ctx.closePath();
}

function crownBalls(c) {
  const { w, h, cx, cy } = c;
  return [
    { x: cx - w / 2 - w * 0.03, y: cy - h + h * 0.2 - 1.3, r: 2.3 },
    { x: cx, y: cy - h - 1.6, r: 2.8 },
    { x: cx + w / 2 + w * 0.03, y: cy - h + h * 0.2 - 1.3, r: 2.3 },
  ];
}

function drawCrown(ctx, S, { mono = false } = {}) {
  const { w, h, cx, cy } = CROWN;
  const balls = crownBalls(CROWN);
  const silhouette = (g, grow = 0) => {
    crownPath(g, cx, cy, w + grow, h + grow);
    g.fill();
    for (const b of balls) { g.beginPath(); g.arc(b.x, b.y, b.r + grow * 0.3, 0, Math.PI * 2); g.fill(); }
  };
  if (mono) {
    // cut the crown out of the face ring area, then draw it solid
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000';
    crownPath(ctx, cx, cy, w, h); ctx.stroke();
    for (const b of balls) { ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 1.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    ctx.fillStyle = '#fff';
    silhouette(ctx);
    return;
  }
  // drop shadow onto the face
  glow(ctx, S, 1.6, (g) => {
    g.save(); g.translate(0.6, 2.2); g.fillStyle = 'rgba(0,0,0,0.9)'; silhouette(g, 1); g.restore();
  }, { op: 'source-over', alpha: 0.9 });
  // golden power glow
  glow(ctx, S, 3.4, (g) => { g.fillStyle = 'rgba(255,196,48,1)'; silhouette(g, 1.5); }, { alpha: 0.75 });

  const gold = ctx.createLinearGradient(cx - w * 0.2, cy - h, cx + w * 0.2, cy + 2);
  gold.addColorStop(0, '#FFFBE0');
  gold.addColorStop(0.28, '#FFDE59');
  gold.addColorStop(0.6, '#F7A928');
  gold.addColorStop(1, '#A85A06');
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.7;
  ctx.strokeStyle = '#2B1000';
  crownPath(ctx, cx, cy, w, h);
  ctx.stroke();
  ctx.fillStyle = gold;
  ctx.fill();

  // bevel: bright inner edge on the upper side, darker band below
  ctx.save();
  crownPath(ctx, cx, cy, w, h);
  ctx.clip();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = 'rgba(255,255,230,0.85)';
  ctx.save(); ctx.translate(0.35, 0.7); crownPath(ctx, cx, cy, w, h); ctx.stroke(); ctx.restore();
  const band = ctx.createLinearGradient(0, cy - h * 0.27, 0, cy + 2);
  band.addColorStop(0, 'rgba(120,50,0,0.0)');
  band.addColorStop(1, 'rgba(120,50,0,0.45)');
  ctx.fillStyle = band;
  ctx.fillRect(cx - w, cy - h * 0.27, w * 2, h);
  ctx.strokeStyle = 'rgba(80,30,0,0.9)';
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, cy - h * 0.27);
  ctx.quadraticCurveTo(cx, cy - h * 0.2, cx + w / 2, cy - h * 0.27);
  ctx.stroke();
  // diagonal sheen
  ctx.globalCompositeOperation = 'lighter';
  const sheen = ctx.createLinearGradient(cx - w * 0.5, cy - h, cx + w * 0.1, cy - h * 0.1);
  sheen.addColorStop(0, 'rgba(255,255,255,0.0)');
  sheen.addColorStop(0.45, 'rgba(255,255,255,0.0)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  sheen.addColorStop(0.56, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(cx - w, cy - h * 1.3, w * 2, h * 1.5);
  ctx.restore();

  // balls on the spikes
  for (const b of balls) {
    const bg = ctx.createRadialGradient(b.x - b.r * 0.4, b.y - b.r * 0.45, 0, b.x, b.y, b.r * 1.1);
    bg.addColorStop(0, '#FFFFFF');
    bg.addColorStop(0.3, '#FFE884');
    bg.addColorStop(1, '#B86E08');
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = bg;
    ctx.fill();
  }

  // gems: cyan | crimson | cyan -> the duel on the band
  const gy = cy - h * 0.12;
  const gems = [
    { x: cx - w * 0.3, c: COL.cyan, r: 1.8 },
    { x: cx, c: COL.crimson, r: 2.5 },
    { x: cx + w * 0.3, c: COL.cyan, r: 1.8 },
  ];
  for (const gm of gems) {
    softDot(ctx, gm.x, gy, gm.r * 2.8, gm.c, 0.9);
    const rg = ctx.createRadialGradient(gm.x - gm.r * 0.35, gy - gm.r * 0.4, 0, gm.x, gy, gm.r);
    rg.addColorStop(0, '#FFFFFF');
    rg.addColorStop(0.32, gm.c);
    rg.addColorStop(1, '#1A0020');
    ctx.beginPath();
    ctx.arc(gm.x, gy, gm.r, 0, Math.PI * 2);
    ctx.fillStyle = rg;
    ctx.fill();
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = '#2B1000';
    ctx.stroke();
  }
  ctx.restore();
}

function star(ctx, x, y, r, color) {
  softDot(ctx, x, y, r * 3.4, color, 0.95);
  ctx.save();
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.moveTo(x, y - r * 2.4);
  ctx.quadraticCurveTo(x, y, x + r * 2.4, y);
  ctx.quadraticCurveTo(x, y, x, y + r * 2.4);
  ctx.quadraticCurveTo(x, y, x - r * 2.4, y);
  ctx.quadraticCurveTo(x, y, x, y - r * 2.4);
  ctx.fill();
  ctx.restore();
}

function drawSparks(ctx) {
  star(ctx, CX - R * 0.92, CY - R * 0.7, 1.1, COL.cyan);
  star(ctx, CX + R * 1.05, CY + R * 0.82, 0.95, COL.crimson);
  star(ctx, CX + R * 0.2, CY - R * 1.2, 0.6, COL.gold);
  const r = rng(1234);
  for (let i = 0; i < 24; i++) {
    const a = r() * Math.PI * 2;
    const d = R + 4.5 + r() * 8;
    const x = CX + Math.cos(a) * d, y = CY + TH * 0.5 + Math.sin(a) * d;
    const c = Math.cos(a - Math.PI * 1.25) > 0 ? COL.cyan : COL.crimson;
    const rad = 0.25 + r() * 0.4;
    softDot(ctx, x, y, rad * 3.2, c, 0.9);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
  }
}

function drawBackground(ctx, S) {
  const u = S / 108;
  ctx.save();
  ctx.scale(u, u);
  const base = ctx.createRadialGradient(54, 50, 2, 54, 54, 78);
  base.addColorStop(0, '#2A0F3A');
  base.addColorStop(0.5, '#170A26');
  base.addColorStop(1, '#05030C');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 108, 108);

  // the duel: cyan sky top-left, crimson fire bottom-right
  ctx.globalCompositeOperation = 'lighter';
  const cy = ctx.createRadialGradient(14, 12, 0, 14, 12, 66);
  cy.addColorStop(0, 'rgba(41,230,255,0.42)');
  cy.addColorStop(0.5, 'rgba(41,230,255,0.10)');
  cy.addColorStop(1, 'rgba(41,230,255,0)');
  ctx.fillStyle = cy;
  ctx.fillRect(0, 0, 108, 108);
  const cr = ctx.createRadialGradient(96, 98, 0, 96, 98, 66);
  cr.addColorStop(0, 'rgba(255,46,99,0.45)');
  cr.addColorStop(0.5, 'rgba(255,46,99,0.10)');
  cr.addColorStop(1, 'rgba(255,46,99,0)');
  ctx.fillStyle = cr;
  ctx.fillRect(0, 0, 108, 108);

  // manga speed rays converging on the piece
  const r = rng(42);
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * Math.PI * 2 + r() * 0.05;
    const w = 0.004 + r() * 0.012;
    const inner = 30 + r() * 8;
    const col = r() < 0.5 ? '255,255,255' : '122,92,255';
    const alpha = 0.05 + r() * 0.10;
    const g = ctx.createRadialGradient(54, 52, inner, 54, 52, 80);
    g.addColorStop(0, 'rgba(' + col + ',0)');
    g.addColorStop(0.35, 'rgba(' + col + ',' + alpha.toFixed(3) + ')');
    g.addColorStop(1, 'rgba(' + col + ',' + (alpha * 0.4).toFixed(3) + ')');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(54 + Math.cos(a - w) * inner, 52 + Math.sin(a - w) * inner);
    ctx.lineTo(54 + Math.cos(a - w * 3) * 90, 52 + Math.sin(a - w * 3) * 90);
    ctx.lineTo(54 + Math.cos(a + w * 3) * 90, 52 + Math.sin(a + w * 3) * 90);
    ctx.lineTo(54 + Math.cos(a + w) * inner, 52 + Math.sin(a + w) * inner);
    ctx.closePath();
    ctx.fill();
  }

  // neon grid floor hint (very faint) in the lower half
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = 'rgba(122,92,255,0.10)';
  ctx.lineWidth = 0.35;
  for (let i = -6; i <= 6; i++) {
    ctx.beginPath();
    ctx.moveTo(54 + i * 4, 70);
    ctx.lineTo(54 + i * 16, 108);
    ctx.stroke();
  }
  for (let k = 0; k < 6; k++) {
    const y = 70 + Math.pow(k / 5, 1.6) * 38;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(108, y); ctx.stroke();
  }

  // vignette
  const v = ctx.createRadialGradient(54, 54, 30, 54, 54, 78);
  v.addColorStop(0, 'rgba(5,3,12,0)');
  v.addColorStop(1, 'rgba(5,3,12,0.75)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, 108, 108);
  ctx.restore();
}

function drawForeground(ctx, S, opts = {}) {
  const u = S / 108;
  ctx.save();
  ctx.scale(u, u);
  if (!opts.mono) drawAura(ctx, S);
  drawBody(ctx, S, opts);
  if (!opts.mono) drawGloss(ctx);
  drawBolt(ctx, S, opts);
  drawCrown(ctx, S, opts);
  if (!opts.mono) drawSparks(ctx);
  ctx.restore();
}

// Supersampled render + progressive halving for crisp small sizes.
function finish(src, px) {
  let cur = src;
  while (cur.width / 2 >= px) {
    const n = canvas(Math.round(cur.width / 2));
    const g = n.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, n.width, n.height);
    cur = n;
  }
  if (cur.width !== px) {
    const n = canvas(px);
    const g = n.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, px, px);
    cur = n;
  }
  return cur;
}

// Master layers are rendered once at 12 px/dp; every output is cropped/downscaled from them.
const MASTER = 1296;
const masters = {};
function master(kind) {
  if (masters[kind]) return masters[kind];
  const c = canvas(MASTER);
  const ctx = c.getContext('2d');
  if (kind === 'bg') drawBackground(ctx, MASTER);
  else if (kind === 'fg') drawForeground(ctx, MASTER);
  else if (kind === 'mono') drawForeground(ctx, MASTER, { mono: true });
  else if (kind === 'full') { ctx.drawImage(master('bg'), 0, 0); ctx.drawImage(master('fg'), 0, 0); }
  masters[kind] = c;
  return c;
}

// Clips the visible central 72dp of the composition to a launcher shape.
function shaped(shape, px, { edge = false } = {}) {
  const full = master('full');
  const crop = MASTER * 72 / 108, off = MASTER * 18 / 108;
  const SS = Math.round(crop);
  const c = canvas(SS);
  const ctx = c.getContext('2d');
  const m = shape === 'round' || shape === 'rounded' ? (edge ? SS * 0.04 : 0) : 0;
  const size = SS - 2 * m;
  ctx.save();
  ctx.beginPath();
  if (shape === 'round' || shape === 'circle') ctx.arc(SS / 2, SS / 2, size / 2, 0, Math.PI * 2);
  else if (shape === 'rounded') ctx.roundRect(m, m, size, size, size * 0.22);
  else if (shape === 'squircle') ctx.roundRect(0, 0, SS, SS, SS * 0.3);
  else if (shape === 'square-rounded') ctx.roundRect(0, 0, SS, SS, SS * 0.12);
  else ctx.rect(0, 0, SS, SS);
  ctx.clip();
  ctx.drawImage(full, off, off, crop, crop, m, m, size, size);
  ctx.restore();
  if (edge) {
    // thin energy edge so legacy icons pop on light wallpapers too
    ctx.save();
    ctx.lineWidth = SS * 0.014;
    ctx.strokeStyle = conicDuel(ctx, SS / 2, SS / 2);
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    const h = ctx.lineWidth / 2;
    if (shape === 'round') ctx.arc(SS / 2, SS / 2, size / 2 - h, 0, Math.PI * 2);
    else ctx.roundRect(m + h, m + h, size - 2 * h, size - 2 * h, size * 0.21);
    ctx.stroke();
    ctx.restore();
  }
  return finish(c, px);
}

window.renderIcon = (kind, px) => {
  let out;
  if (kind === 'bg' || kind === 'fg' || kind === 'mono' || kind === 'full') out = finish(master(kind), px);
  else if (kind === 'legacy-rounded') out = shaped('rounded', px, { edge: true });
  else if (kind === 'legacy-round') out = shaped('round', px, { edge: true });
  else if (kind === 'legacy-square') out = shaped('square', px);
  else if (kind.startsWith('mask-')) out = shaped(kind.slice(5), px);
  else throw new Error('unknown kind ' + kind);
  return out.toDataURL('image/png');
};
`;

const ADAPTIVE_XML = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by tools/make-icon.mjs -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
`;

function writePng(file, dataUrl) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => {
    console.error('[make-icon] page error:', e.message);
    process.exitCode = 1;
  });
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ content: PAGE_SCRIPT });
  const render = (kind, px) => page.evaluate(([k, p]) => window.renderIcon(k, p), [kind, px]);

  const res = path.join(ROOT, 'android/res');
  let count = 0;
  for (const d of DENSITIES) {
    const dir = path.join(res, `mipmap-${d.name}`);
    const legacyPx = Math.round(48 * d.scale);
    const layerPx = Math.round(108 * d.scale);
    writePng(path.join(dir, 'ic_launcher.png'), await render('legacy-rounded', legacyPx));
    writePng(path.join(dir, 'ic_launcher_round.png'), await render('legacy-round', legacyPx));
    writePng(path.join(dir, 'ic_launcher_background.png'), await render('bg', layerPx));
    writePng(path.join(dir, 'ic_launcher_foreground.png'), await render('fg', layerPx));
    writePng(path.join(dir, 'ic_launcher_monochrome.png'), await render('mono', layerPx));
    count += 5;
  }
  const anydpi = path.join(res, 'mipmap-anydpi-v26');
  fs.mkdirSync(anydpi, { recursive: true });
  fs.writeFileSync(path.join(anydpi, 'ic_launcher.xml'), ADAPTIVE_XML);
  fs.writeFileSync(path.join(anydpi, 'ic_launcher_round.xml'), ADAPTIVE_XML);
  writePng(path.join(ROOT, 'web/static/icon-512.png'), await render('legacy-square', 512));
  count += 3;

  if (previewDir) {
    fs.mkdirSync(previewDir, { recursive: true });
    for (const [kind, px] of [
      ['mask-circle', 512], ['mask-squircle', 512], ['mask-square-rounded', 512],
      ['legacy-rounded', 512], ['legacy-round', 512], ['fg', 432], ['bg', 432], ['mono', 432],
      ['mask-circle', 48], ['legacy-rounded', 48], ['mask-squircle', 96],
    ]) {
      writePng(path.join(previewDir, `${kind}-${px}.png`), await render(kind, px));
    }
    console.log(`[make-icon] previews -> ${previewDir}`);
  }
  console.log(`[make-icon] wrote ${count} files (android/res/mipmap-*, web/static/icon-512.png)`);
} finally {
  await browser.close();
}
