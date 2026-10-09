// Offscreen-canvas → Pixi texture helpers and small colour utilities shared by the render module.
// (FX code may reuse them: glowTexture(), textureFromCanvas(), makeCanvas(), rgba()...)

import { CanvasSource, Texture } from 'pixi.js';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/**
 * Wrap a canvas into a Texture whose LOGICAL size is pixels / resolution, so a canvas drawn at
 * N× density displays at the intended CSS size and stays crisp on high-DPI screens.
 */
export function textureFromCanvas(canvas, resolution = 1, { label = 'render-canvas', mipmap = false } = {}) {
  const source = new CanvasSource({ resource: canvas, resolution: 1, label, autoGenerateMipmaps: mipmap });
  source.resolution = resolution;
  return new Texture({ source, label });
}

/**
 * Draw with a callback in logical units: draw(ctx, w, h, k) where the context is pre-scaled by
 * k ≈ res (device pixels per logical unit; needed for shadowBlur/shadowOffset which ignore the
 * transform). Returns a Texture of logical size w×h.
 */
export function drawTexture(w, h, res, draw, opts) {
  const c = makeCanvas(w * res, h * res);
  const ctx = c.getContext('2d');
  const k = c.width / w;
  ctx.scale(k, c.height / h);
  draw(ctx, w, h, k);
  return textureFromCanvas(c, k, opts);
}

export function hexToRgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

export function rgba(hex, a = 1) {
  return `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${a})`;
}

/** Mix two hex colours: t = 0 → a, 1 → b. */
export function mixHex(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (
    (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t)
  );
}

/** Multiply brightness of a hex colour (k > 1 brightens, clamps per channel). */
export function shadeHex(hex, k) {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * k));
  const b = Math.min(255, Math.round((hex & 255) * k));
  return (r << 16) | (g << 8) | b;
}

const glowCache = new Map();

/**
 * Cached soft radial glow (white, tint it). `falloff` > 1 makes the core tighter.
 * size = logical diameter; generated at 2× for crispness when scaled up a bit.
 */
export function glowTexture(size = 128, falloff = 1.6, res = 2) {
  const key = `${size}|${falloff}|${res}`;
  let t = glowCache.get(key);
  if (t && !t.destroyed) return t;
  t = drawTexture(size, size, res, (ctx, w) => {
    const r = w / 2;
    const g = ctx.createRadialGradient(r, r, 0, r, r, r);
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const s = i / steps;
      const a = Math.pow(1 - s, falloff);
      g.addColorStop(s, `rgba(255,255,255,${a.toFixed(4)})`);
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  }, { label: 'glow' });
  glowCache.set(key, t);
  return t;
}

/** Rounded-rect path helper. */
export function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** Chamfered (cut-corner) rect path helper — the "tech" frame shape of the epic theme. */
export function chamferRectPath(ctx, x, y, w, h, c) {
  ctx.beginPath();
  ctx.moveTo(x + c, y);
  ctx.lineTo(x + w - c, y);
  ctx.lineTo(x + w, y + c);
  ctx.lineTo(x + w, y + h - c);
  ctx.lineTo(x + w - c, y + h);
  ctx.lineTo(x + c, y + h);
  ctx.lineTo(x, y + h - c);
  ctx.lineTo(x, y + c);
  ctx.closePath();
}

/** Add fine monochrome noise (film grain / dithering) to a canvas region. */
export function addGrain(ctx, x, y, w, h, amount = 6, seed = 1) {
  const img = ctx.getImageData(x, y, w, h);
  const d = img.data;
  let s = seed * 1103515245 + 12345;
  for (let i = 0; i < d.length; i += 4) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const n = ((s >> 8) & 255) / 255 - 0.5;
    const v = n * amount;
    d[i] = d[i] + v;
    d[i + 1] = d[i + 1] + v;
    d[i + 2] = d[i + 2] + v;
  }
  ctx.putImageData(img, x, y);
}

/** Destroy a texture (and its source) if it exists and is not already destroyed. */
export function destroyTexture(t) {
  if (t && !t.destroyed) t.destroy(true);
}
