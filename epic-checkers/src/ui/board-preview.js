// Mini board preview drawn on a <canvas> from variant metadata (size / playable / piecesPerSide).
// When the engine exposes createInitialState / isPlayableSquare they are used, so the preview
// matches the real starting position exactly; otherwise a standard layout is derived.

import * as Engine from '../engine/index.js';

const engineFn = (name) => (typeof Engine[name] === 'function' ? Engine[name] : null);

/** Returns { size, playable: (r,c)=>bool, cells: Int8Array } for the variant's start position. */
export function startLayout(variant, { giveaway = false } = {}) {
  const size = variant.size || 8;
  const create = engineFn('createInitialState');
  const isPlayable = engineFn('isPlayableSquare');
  if (create) {
    try {
      const st = create(variant.id, { giveaway });
      if (st && st.board && st.board.length === size * size) {
        return {
          size,
          playable: (r, c) => (isPlayable ? !!isPlayable(variant, r, c) : variant.playable === 'all' || (r + c) % 2 === 1),
          cells: Int8Array.from(st.board),
        };
      }
    } catch (e) {
      // engine still in progress — fall back to the derived layout
    }
  }
  const cells = new Int8Array(size * size);
  const all = variant.playable === 'all';
  const playable = (r, c) => all || (r + c) % 2 === 1;
  const n = variant.piecesPerSide || (all ? size * 2 : (size / 2) * 3);
  if (all) {
    const rows = Math.max(1, Math.round(n / size));
    for (let i = 0; i < rows; i++) {
      for (let c = 0; c < size; c++) {
        cells[(1 + i) * size + c] = -1;
        cells[(size - 2 - i) * size + c] = 1;
      }
    }
  } else {
    const rows = Math.max(1, Math.round(n / (size / 2)));
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!playable(r, c)) continue;
        if (r < rows) cells[r * size + c] = -1;
        else if (r >= size - rows) cells[r * size + c] = 1;
      }
    }
  }
  return { size, playable, cells };
}

const CLASSIC = {
  frame: '#2A1A10',
  inlay: '#C9A04C',
  light: '#E8D5B0',
  dark: '#6B3F22',
  allSquare: '#DCC398',
  grid: 'rgba(60,32,14,.55)',
  white: ['#FFFDF5', '#F4EEDD', '#BFB39A'],
  black: ['#5A4C48', '#1E1A1A', '#000000'],
  whiteRim: 'rgba(120,100,70,.9)',
  blackRim: 'rgba(0,0,0,.95)',
  king: '#C9A04C',
};

const EPIC = {
  frame: '#0A0618',
  inlay: '#7A5CFF',
  light: '#1B1236',
  dark: '#0B0718',
  allSquare: '#140D2A',
  grid: 'rgba(122,92,255,.55)',
  white: ['#FFFFFF', '#7FF3FF', '#0AA9C9'],
  black: ['#FFB3C6', '#FF2E63', '#7A0026'],
  whiteRim: 'rgba(41,230,255,1)',
  blackRim: 'rgba(255,46,99,1)',
  king: '#FFD23F',
};

/**
 * Draws the start position of `variant` on `canvas`.
 * opts: { epic, px (CSS size, default = canvas.clientWidth || 120), dpr, frame (bool), layout }
 */
export function drawBoardPreview(canvas, variant, opts = {}) {
  const epic = !!opts.epic;
  const pal = epic ? EPIC : CLASSIC;
  const px = Math.max(16, Math.round(opts.px || canvas.clientWidth || 120));
  const dpr = Math.min(3, opts.dpr || (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1);
  canvas.width = Math.round(px * dpr);
  canvas.height = Math.round(px * dpr);
  if (!canvas.style.width) {
    canvas.style.width = px + 'px';
    canvas.style.height = px + 'px';
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, px, px);

  const layout = opts.layout || startLayout(variant, opts);
  const { size, playable, cells } = layout;
  const withFrame = opts.frame !== false;
  const fw = withFrame ? Math.max(2, Math.round(px * 0.045)) : 0;
  const inner = px - fw * 2;
  const sq = inner / size;

  // frame
  if (withFrame) {
    ctx.fillStyle = pal.frame;
    roundRect(ctx, 0, 0, px, px, Math.max(2, px * 0.04));
    ctx.fill();
    ctx.strokeStyle = pal.inlay;
    ctx.globalAlpha = epic ? 0.9 : 0.75;
    ctx.lineWidth = Math.max(0.75, px * 0.006);
    ctx.strokeRect(fw - ctx.lineWidth, fw - ctx.lineWidth, inner + ctx.lineWidth * 2, inner + ctx.lineWidth * 2);
    ctx.globalAlpha = 1;
  }

  const allMode = variant.playable === 'all';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const x = fw + c * sq;
      const y = fw + r * sq;
      if (allMode) ctx.fillStyle = (r + c) % 2 ? pal.allSquare : shade(pal.allSquare, epic ? 1.18 : 1.05);
      else ctx.fillStyle = playable(r, c) ? pal.dark : pal.light;
      ctx.fillRect(x, y, Math.ceil(sq), Math.ceil(sq));
    }
  }
  // grid lines (Turkish-style board, and the neon grid in epic)
  if (allMode || epic) {
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = Math.max(0.5, sq * 0.05);
    ctx.beginPath();
    for (let i = 0; i <= size; i++) {
      ctx.moveTo(fw + i * sq, fw);
      ctx.lineTo(fw + i * sq, fw + inner);
      ctx.moveTo(fw, fw + i * sq);
      ctx.lineTo(fw + inner, fw + i * sq);
    }
    ctx.stroke();
  }
  if (!allMode && !epic) {
    // subtle wood grain sheen
    const g = ctx.createLinearGradient(0, fw, px, fw + inner);
    g.addColorStop(0, 'rgba(255,255,255,.10)');
    g.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(0,0,0,.12)');
    ctx.fillStyle = g;
    ctx.fillRect(fw, fw, inner, inner);
  }

  // pieces
  const rad = sq * 0.39;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const code = cells[r * size + c];
      if (!code) continue;
      const cx = fw + c * sq + sq / 2;
      const cy = fw + r * sq + sq / 2;
      drawPiece(ctx, cx, cy, rad, code, pal, epic);
    }
  }
}

function drawPiece(ctx, x, y, rad, code, pal, epic) {
  const white = code > 0;
  const cols = white ? pal.white : pal.black;
  ctx.save();
  if (epic) {
    ctx.shadowColor = white ? 'rgba(41,230,255,.9)' : 'rgba(255,46,99,.9)';
    ctx.shadowBlur = rad * 1.1;
  } else {
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = rad * 0.5;
    ctx.shadowOffsetY = rad * 0.18;
  }
  const g = ctx.createRadialGradient(x - rad * 0.35, y - rad * 0.4, rad * 0.1, x, y, rad);
  g.addColorStop(0, cols[0]);
  g.addColorStop(0.55, cols[1]);
  g.addColorStop(1, cols[2]);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, rad, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = Math.max(0.5, rad * 0.12);
  ctx.strokeStyle = white ? pal.whiteRim : pal.blackRim;
  ctx.globalAlpha = epic ? 0.9 : 0.5;
  ctx.beginPath();
  ctx.arc(x, y, rad * 0.94, 0, Math.PI * 2);
  ctx.stroke();
  if (rad > 5) {
    ctx.globalAlpha = epic ? 0.6 : 0.35;
    ctx.lineWidth = Math.max(0.5, rad * 0.06);
    ctx.beginPath();
    ctx.arc(x, y, rad * 0.58, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (Math.abs(code) === 2) {
    ctx.fillStyle = pal.king;
    const s = rad * 0.55;
    ctx.beginPath();
    ctx.moveTo(x - s, y + s * 0.45);
    ctx.lineTo(x - s, y - s * 0.35);
    ctx.lineTo(x - s * 0.5, y + s * 0.05);
    ctx.lineTo(x, y - s * 0.6);
    ctx.lineTo(x + s * 0.5, y + s * 0.05);
    ctx.lineTo(x + s, y - s * 0.35);
    ctx.lineTo(x + s, y + s * 0.45);
    ctx.closePath();
    ctx.fill();
  }
}

function roundRect(ctx, x, y, w, hgt, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hgt, r);
  ctx.arcTo(x + w, y + hgt, x, y + hgt, r);
  ctx.arcTo(x, y + hgt, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

/** Creates a canvas element with the preview drawn (redraw with drawBoardPreview on theme change). */
export function boardPreview(variant, { px = 96, epic = false, cls = 'mini-board' } = {}) {
  const c = document.createElement('canvas');
  c.className = cls;
  c.style.width = px + 'px';
  c.style.height = px + 'px';
  drawBoardPreview(c, variant, { px, epic });
  return c;
}
