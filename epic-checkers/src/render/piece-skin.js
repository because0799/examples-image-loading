// Piece skins: all textures a PieceView needs for one theme at one square size.
// Generated procedurally on 2D canvases at (CSS size × resolution × oversample) so pieces stay crisp
// on 2×/3× phones and when the camera zooms in.
//
// Geometry (logical CSS px): R = piece radius = 0.42 × squareSize. Body textures are square and
// centred on the TOP FACE of the disc; the visible wall (thickness) extends below it. PieceView
// offsets the body by -thickness/2 so the whole disc is centred in its square.

import { drawTexture, rgba, mixHex, destroyTexture } from './canvas.js';
import { CLASSIC, EPIC } from './palette.js';
import { mulberry32 } from './noise.js';

export const PIECE_RADIUS = 0.42; // × squareSize

const TAU = Math.PI * 2;

// -------------------------------------------------------------------------------- shared shapes
function crownPath(ctx, s) {
  // crown centred at (0, 0), width ≈ 2s, height ≈ 1.45s
  ctx.beginPath();
  ctx.moveTo(-0.86 * s, 0.42 * s);
  ctx.lineTo(-0.98 * s, -0.42 * s);
  ctx.lineTo(-0.5 * s, -0.02 * s);
  ctx.lineTo(0, -0.62 * s);
  ctx.lineTo(0.5 * s, -0.02 * s);
  ctx.lineTo(0.98 * s, -0.42 * s);
  ctx.lineTo(0.86 * s, 0.42 * s);
  ctx.closePath();
}

function crownBand(ctx, s) {
  ctx.beginPath();
  ctx.moveTo(-0.86 * s, 0.4 * s);
  ctx.lineTo(0.86 * s, 0.4 * s);
  ctx.lineTo(0.82 * s, 0.66 * s);
  ctx.lineTo(-0.82 * s, 0.66 * s);
  ctx.closePath();
}

const CROWN_TIPS = [
  [-0.98, -0.42],
  [0, -0.62],
  [0.98, -0.42],
];

/** Capsule = visible disc wall from the top face (y = 0) down to y = t. */
function wallPath(ctx, R, t) {
  ctx.beginPath();
  ctx.moveTo(R, 0);
  ctx.lineTo(R, t);
  ctx.arc(0, t, R, 0, Math.PI, false);
  ctx.lineTo(-R, 0);
  ctx.arc(0, 0, R, Math.PI, 0, false);
  ctx.closePath();
}

// -------------------------------------------------------------------------------- classic painters
const IVORY = {
  face: ['#FFFDF6', '#F5EDD9', '#E6D8B8', '#C9B791'],
  wall: ['#D9CBAA', '#F2E8D0', '#B8A680', '#8C7A57'],
  groove: 'rgba(120,96,60,0.32)',
  grooveLight: 'rgba(255,255,255,0.65)',
  rings: 'rgba(150,120,80,0.05)',
  edge: 'rgba(90,70,40,0.55)',
  spec: 0.75,
};
const EBONY = {
  face: ['#4A3F3B', '#29211F', '#1A1514', '#0B0908'],
  wall: ['#2E2624', '#55483F', '#1A1412', '#060404'],
  groove: 'rgba(0,0,0,0.6)',
  grooveLight: 'rgba(255,236,215,0.2)',
  rings: 'rgba(255,230,200,0.025)',
  edge: 'rgba(0,0,0,0.8)',
  spec: 0.62,
};

function paintClassicWall(ctx, R, t, P, king) {
  const g = ctx.createLinearGradient(-R, 0, R, 0);
  g.addColorStop(0, P.wall[0]);
  g.addColorStop(0.28, P.wall[1]);
  g.addColorStop(0.62, P.wall[2]);
  g.addColorStop(1, P.wall[3]);
  wallPath(ctx, R, t);
  ctx.fillStyle = g;
  ctx.fill();
  // vertical shading: wall darker towards the board
  const v = ctx.createLinearGradient(0, 0, 0, R + t);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = v;
  ctx.fill();
  ctx.lineWidth = Math.max(0.5, R * 0.03);
  ctx.strokeStyle = P.edge;
  ctx.stroke();
  if (king) {
    // seam between the two stacked discs
    ctx.beginPath();
    ctx.arc(0, t / 2, R * 0.995, 0.02, Math.PI - 0.02, false);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = Math.max(0.6, R * 0.045);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, t / 2 + Math.max(0.6, R * 0.045), R * 0.99, 0.15, Math.PI - 0.15, false);
    ctx.strokeStyle = P === IVORY ? 'rgba(255,250,235,0.55)' : 'rgba(255,235,210,0.12)';
    ctx.lineWidth = Math.max(0.4, R * 0.025);
    ctx.stroke();
  }
}

function paintClassicFace(ctx, R, P, king) {
  // base
  let g = ctx.createRadialGradient(-0.32 * R, -0.38 * R, 0, -0.1 * R, -0.1 * R, 1.25 * R);
  g.addColorStop(0, P.face[0]);
  g.addColorStop(0.45, P.face[1]);
  g.addColorStop(0.82, P.face[2]);
  g.addColorStop(1, P.face[3]);
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.fillStyle = g;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.clip();
  // lathe rings
  ctx.strokeStyle = P.rings;
  ctx.lineWidth = Math.max(0.4, R * 0.02);
  for (let r = R * 0.1; r < R * 0.9; r += R * 0.09) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.stroke();
  }
  // grooves (engraved: dark line, light line offset towards the light)
  const gw = Math.max(0.6, R * 0.045);
  for (const rr of king ? [0.7] : [0.74, 0.42]) {
    ctx.lineWidth = gw;
    ctx.strokeStyle = P.groove;
    ctx.beginPath();
    ctx.arc(-gw * 0.2, -gw * 0.2, R * rr, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = gw * 0.7;
    ctx.strokeStyle = P.grooveLight;
    ctx.beginPath();
    ctx.arc(gw * 0.45, gw * 0.45, R * rr, 0, TAU);
    ctx.stroke();
  }
  // rim bevel
  g = ctx.createLinearGradient(-R, -R, R, R);
  g.addColorStop(0, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.42, 'rgba(255,255,255,0.08)');
  g.addColorStop(0.58, 'rgba(0,0,0,0.05)');
  g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.strokeStyle = g;
  ctx.lineWidth = R * 0.12;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.94, 0, TAU);
  ctx.stroke();
  // lacquer specular: soft broad + crisp window
  ctx.save();
  ctx.translate(-0.36 * R, -0.42 * R);
  ctx.rotate(-Math.PI / 5);
  ctx.scale(1, 0.55);
  g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.62);
  g.addColorStop(0, `rgba(255,255,255,${P.spec})`);
  g.addColorStop(0.35, `rgba(255,255,255,${P.spec * 0.45})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.62, 0, TAU);
  ctx.fill();
  ctx.restore();
  // crisp window reflection (lacquer)
  ctx.save();
  ctx.translate(-0.42 * R, -0.5 * R);
  ctx.rotate(-Math.PI / 4.2);
  ctx.scale(1, 0.38);
  g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.3);
  g.addColorStop(0, `rgba(255,255,255,${P === IVORY ? 0.75 : 0.5})`);
  g.addColorStop(0.6, `rgba(255,255,255,${P === IVORY ? 0.35 : 0.22})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.3, 0, TAU);
  ctx.fill();
  ctx.restore();
  // reflected bounce light at the bottom-right rim
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.9, 0.15 * Math.PI, 0.45 * Math.PI);
  ctx.strokeStyle = P === IVORY ? 'rgba(255,255,255,0.35)' : 'rgba(255,225,190,0.12)';
  ctx.lineWidth = R * 0.06;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();

  // crisp outer edge
  ctx.beginPath();
  ctx.arc(0, 0, R - Math.max(0.3, R * 0.012), 0, TAU);
  ctx.strokeStyle = P.edge;
  ctx.lineWidth = Math.max(0.5, R * 0.03);
  ctx.stroke();

  if (king) {
    // gold rim inlay — makes kings readable even at tiny sizes
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.84, 0, TAU);
    g = ctx.createLinearGradient(-R, -R, R, R);
    g.addColorStop(0, '#FFF0B0');
    g.addColorStop(0.5, '#C9A04C');
    g.addColorStop(1, '#8A6420');
    ctx.strokeStyle = g;
    ctx.lineWidth = Math.max(0.8, R * 0.075);
    ctx.stroke();
  }
}

function paintClassicCrown(ctx, s, onIvory) {
  // drop/engrave shadow
  ctx.save();
  ctx.translate(s * 0.04, s * 0.08);
  crownPath(ctx, s);
  ctx.fillStyle = onIvory ? 'rgba(70,45,15,0.45)' : 'rgba(0,0,0,0.7)';
  ctx.fill();
  crownBand(ctx, s);
  ctx.fill();
  ctx.restore();

  const g = ctx.createLinearGradient(0, -0.65 * s, 0, 0.7 * s);
  g.addColorStop(0, '#FFF6C8');
  g.addColorStop(0.35, '#F2CF6A');
  g.addColorStop(0.7, '#C9963A');
  g.addColorStop(1, '#8E6222');
  ctx.fillStyle = g;
  crownPath(ctx, s);
  ctx.fill();
  ctx.strokeStyle = 'rgba(80,50,10,0.85)';
  ctx.lineWidth = Math.max(0.6, s * 0.07);
  ctx.lineJoin = 'round';
  ctx.stroke();
  crownBand(ctx, s);
  ctx.fill();
  ctx.stroke();
  // jewels on the band
  for (const x of [-0.45, 0, 0.45]) {
    ctx.beginPath();
    ctx.arc(x * s, 0.53 * s, s * 0.085, 0, TAU);
    ctx.fillStyle = x === 0 ? '#B3122E' : '#1E5BB8';
    ctx.fill();
    ctx.lineWidth = Math.max(0.4, s * 0.035);
    ctx.stroke();
  }
  // tip balls
  for (const [tx, ty] of CROWN_TIPS) {
    ctx.beginPath();
    ctx.arc(tx * s, ty * s - s * 0.06, s * 0.12, 0, TAU);
    ctx.fillStyle = '#FBE59A';
    ctx.fill();
    ctx.lineWidth = Math.max(0.5, s * 0.05);
    ctx.stroke();
  }
  // highlight
  ctx.beginPath();
  ctx.moveTo(-0.7 * s, 0.3 * s);
  ctx.lineTo(-0.8 * s, -0.2 * s);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = Math.max(0.5, s * 0.06);
  ctx.lineCap = 'round';
  ctx.stroke();
}

// -------------------------------------------------------------------------------- epic painters
const EPIC_BODY = {
  1: {
    // light titanium (the «white» side) — cyan energy
    wall: ['#5D6B80', '#AEBBCC', '#3B4658', '#1A2130'],
    metalLo: [66, 80, 102],
    metalHi: [196, 214, 236],
    ring: ['#E8F2FF', '#7488A3', '#232B3A'],
    socket: '#05101A',
  },
  [-1]: {
    // black chrome (the «black» side) — crimson energy
    wall: ['#1A1420', '#3A2E44', '#0C0910', '#030205'],
    metalLo: [26, 20, 34],
    metalHi: [86, 70, 102],
    ring: ['#8E7AA6', '#2C2238', '#0A070E'],
    socket: '#12030A',
  },
};

function paintEpicWall(ctx, R, t, B, king, col) {
  const g = ctx.createLinearGradient(-R, 0, R, 0);
  g.addColorStop(0, B.wall[0]);
  g.addColorStop(0.3, B.wall[1]);
  g.addColorStop(0.65, B.wall[2]);
  g.addColorStop(1, B.wall[3]);
  wallPath(ctx, R, t);
  ctx.fillStyle = g;
  ctx.fill();
  // energy band glowing around the wall (thin), brighter for kings
  ctx.save();
  wallPath(ctx, R, t);
  ctx.clip();
  ctx.beginPath();
  ctx.arc(0, t * (king ? 0.5 : 0.62), R * 1.0, 0.05, Math.PI - 0.05);
  ctx.strokeStyle = rgba(col, king ? 0.95 : 0.75);
  ctx.lineWidth = Math.max(0.8, R * 0.05);
  ctx.stroke();
  if (king) {
    ctx.beginPath();
    ctx.arc(0, t * 0.95, R * 1.0, 0.05, Math.PI - 0.05);
    ctx.strokeStyle = rgba(EPIC.gold, 0.85);
    ctx.lineWidth = Math.max(0.6, R * 0.035);
    ctx.stroke();
  }
  ctx.restore();
  ctx.lineWidth = Math.max(0.5, R * 0.03);
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  wallPath(ctx, R, t);
  ctx.stroke();
}

function paintEpicFace(ctx, R, B, side, king, col) {
  // outer machined ring
  let g = ctx.createLinearGradient(-R, -R, R, R);
  g.addColorStop(0, B.ring[0]);
  g.addColorStop(0.5, B.ring[1]);
  g.addColorStop(1, B.ring[2]);
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.fillStyle = g;
  ctx.fill();

  // inner face: anisotropic brushed metal (manual conic: wedges)
  const inner = R * 0.84;
  const N = 96;
  const [lr, lg, lb] = B.metalLo;
  const [hr, hg, hb] = B.metalHi;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * TAU;
    const a1 = ((i + 1.15) / N) * TAU;
    const am = (a0 + a1) / 2;
    // two highlight lobes (anisotropic reflection) aligned with the light (top-left)
    let b = Math.pow(Math.abs(Math.cos(am - Math.PI * 1.25)), 6) * 0.85 + Math.pow(Math.abs(Math.cos(am - Math.PI * 0.25)), 10) * 0.25;
    b = Math.min(1, b);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, inner, a0, a1);
    ctx.closePath();
    ctx.fillStyle = `rgb(${Math.round(lr + (hr - lr) * b)},${Math.round(lg + (hg - lg) * b)},${Math.round(lb + (hb - lb) * b)})`;
    ctx.fill();
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, inner, 0, TAU);
  ctx.clip();
  // machined concentric lines
  for (let r = R * 0.44, k = 0; r < inner; r += R * 0.045, k++) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.strokeStyle = k % 2 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.12)';
    ctx.lineWidth = Math.max(0.4, R * 0.018);
    ctx.stroke();
  }
  // energy tint wash from the rim
  g = ctx.createRadialGradient(0, 0, inner * 0.55, 0, 0, inner);
  g.addColorStop(0, rgba(col, 0));
  g.addColorStop(1, rgba(col, side === 1 ? 0.28 : 0.38));
  ctx.fillStyle = g;
  ctx.fillRect(-R, -R, 2 * R, 2 * R);
  ctx.restore();

  // energy rim (inside the face) — layered strokes = baked glow
  const rimR = R * 0.86;
  const passes = [
    [R * 0.2, 0.12],
    [R * 0.12, 0.25],
    [R * 0.065, 0.75],
  ];
  for (const [w, a] of passes) {
    ctx.beginPath();
    ctx.arc(0, 0, rimR, 0, TAU);
    ctx.strokeStyle = rgba(col, a);
    ctx.lineWidth = w;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, rimR, 0, TAU);
  ctx.strokeStyle = rgba(mixHex(col, 0xffffff, 0.65), 0.95);
  ctx.lineWidth = Math.max(0.6, R * 0.028);
  ctx.stroke();

  // segmented tech ring
  const segs = king ? 8 : 6;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * TAU + 0.12;
    const a1 = ((i + 1) / segs) * TAU - 0.12;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.64, a0, a1);
    ctx.strokeStyle = rgba(king ? EPIC.gold : col, 0.55);
    ctx.lineWidth = Math.max(0.6, R * 0.045);
    ctx.stroke();
  }

  // outer edge bevel + dark outline
  g = ctx.createLinearGradient(-R, -R, R, R);
  g.addColorStop(0, 'rgba(255,255,255,0.6)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.05)');
  g.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.965, 0, TAU);
  ctx.strokeStyle = g;
  ctx.lineWidth = R * 0.06;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, R - Math.max(0.3, R * 0.012), 0, TAU);
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineWidth = Math.max(0.5, R * 0.03);
  ctx.stroke();

  // core socket
  const sr = R * 0.42;
  g = ctx.createRadialGradient(0, 0, sr * 0.2, 0, 0, sr);
  g.addColorStop(0, B.socket);
  g.addColorStop(0.8, '#000000');
  g.addColorStop(1, 'rgba(0,0,0,0.9)');
  ctx.beginPath();
  ctx.arc(0, 0, sr, 0, TAU);
  ctx.fillStyle = g;
  ctx.fill();
  // socket bevel
  g = ctx.createLinearGradient(-sr, -sr, sr, sr);
  g.addColorStop(0, 'rgba(0,0,0,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0.45)');
  ctx.strokeStyle = g;
  ctx.lineWidth = Math.max(0.6, R * 0.05);
  ctx.stroke();
  // baked dim core so the piece reads even when the breathing overlay is at its minimum
  g = ctx.createRadialGradient(0, 0, 0, 0, 0, sr * 0.95);
  g.addColorStop(0, rgba(mixHex(col, 0xffffff, 0.6), 0.95));
  g.addColorStop(0.45, rgba(col, 0.75));
  g.addColorStop(1, rgba(col, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, sr * 0.95, 0, TAU);
  ctx.fill();
}

function paintEpicCore(ctx, R, col, king) {
  const r = R * (king ? 0.62 : 0.52);
  let g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  const halo = king ? mixHex(col, EPIC.gold, 0.55) : col;
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.16, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.36, rgba(mixHex(halo, 0xffffff, 0.35), 0.85));
  g.addColorStop(0.62, rgba(halo, 0.35));
  g.addColorStop(1, rgba(halo, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  if (!king) {
    // energy crystal (rhombus) with a hot edge
    const s = R * 0.2;
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.35);
    ctx.lineTo(s, 0);
    ctx.lineTo(0, s * 1.35);
    ctx.lineTo(-s, 0);
    ctx.closePath();
    g = ctx.createLinearGradient(0, -s, 0, s);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, rgba(mixHex(col, 0xffffff, 0.5), 1));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = rgba(col, 0.9);
    ctx.lineWidth = Math.max(0.5, R * 0.03);
    ctx.stroke();
  }
}

function paintEpicSigil(ctx, s) {
  // glowing gold crown sigil
  const passes = [
    [s * 0.42, 0.1],
    [s * 0.26, 0.2],
    [s * 0.13, 0.55],
  ];
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const [w, a] of passes) {
    ctx.strokeStyle = rgba(EPIC.gold, a);
    ctx.lineWidth = w;
    crownPath(ctx, s);
    ctx.stroke();
  }
  const g = ctx.createLinearGradient(0, -0.6 * s, 0, 0.5 * s);
  g.addColorStop(0, '#FFFBE0');
  g.addColorStop(0.5, '#FFE27A');
  g.addColorStop(1, '#FFB21F');
  ctx.fillStyle = g;
  crownPath(ctx, s);
  ctx.fill();
  ctx.strokeStyle = '#5A3A00';
  ctx.lineWidth = Math.max(0.5, s * 0.06);
  ctx.stroke();
  ctx.fillStyle = g;
  crownBand(ctx, s);
  ctx.fill();
  ctx.stroke();
  for (const [tx, ty] of CROWN_TIPS) {
    ctx.beginPath();
    ctx.arc(tx * s, ty * s - s * 0.06, s * 0.11, 0, TAU);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
  }
}

function paintKingRing(ctx, R) {
  const r = R * 1.13;
  ctx.lineCap = 'round';
  const arcs = 3;
  for (const [w, a] of [[R * 0.12, 0.12], [R * 0.06, 0.3], [Math.max(0.6, R * 0.03), 0.95]]) {
    ctx.strokeStyle = rgba(EPIC.gold, a);
    ctx.lineWidth = w;
    for (let i = 0; i < arcs; i++) {
      const a0 = (i / arcs) * TAU + 0.25;
      const a1 = ((i + 1) / arcs) * TAU - 0.25;
      ctx.beginPath();
      ctx.arc(0, 0, r, a0, a1);
      ctx.stroke();
    }
  }
  // tick marks
  ctx.strokeStyle = rgba(0xfff1b0, 0.85);
  ctx.lineWidth = Math.max(0.5, R * 0.025);
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * TAU;
    if (i % 12 === 0) continue;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 1.04, Math.sin(a) * r * 1.04);
    ctx.lineTo(Math.cos(a) * r * 1.08, Math.sin(a) * r * 1.08);
    ctx.stroke();
  }
  // diamonds in the gaps
  ctx.fillStyle = '#FFF4C2';
  for (let i = 0; i < arcs; i++) {
    const a = (i / arcs) * TAU;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    const d = R * 0.09;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(-d * 1.6, 0);
    ctx.lineTo(0, -d);
    ctx.lineTo(d * 1.6, 0);
    ctx.lineTo(0, d);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// -------------------------------------------------------------------------------- skin
/**
 * Build a skin. `res` = renderer resolution; textures are generated at res × oversample.
 * @returns {PieceSkin}
 */
export function createPieceSkin(theme, squareSize, res = 1) {
  return theme === 'epic' ? new PieceSkin('epic', squareSize, res) : new PieceSkin('classic', squareSize, res);
}

export class PieceSkin {
  constructor(theme, sq, res) {
    this.theme = theme;
    this.squareSize = sq;
    this.R = sq * PIECE_RADIUS;
    const R = this.R;
    const epic = theme === 'epic';
    // oversample so camera zoom-ins stay crisp; cap texture size
    const bodyLogical = 2 * (R * 1.0 + R * 0.4 + 2);
    this.res = Math.max(1, Math.min(res * 1.6, 300 / bodyLogical));
    this.thickness = epic ? { man: R * 0.13, king: R * 0.26 } : { man: R * 0.17, king: R * 0.36 };
    this.palette = epic ? EPIC : CLASSIC;
    const tex = (this.textures = {});
    const resT = this.res;
    const S = bodyLogical;

    // contact shadow
    const sh = R * 2.7;
    tex.shadow = drawTexture(sh, sh, Math.min(resT, 2), (ctx, w) => {
      const c = w / 2;
      const g = ctx.createRadialGradient(c, c, 0, c, c, c);
      const a = epic ? 0.85 : 0.6;
      g.addColorStop(0, `rgba(0,0,0,${a})`);
      g.addColorStop(0.42, `rgba(0,0,0,${a * 0.85})`);
      g.addColorStop(0.62, `rgba(0,0,0,${a * 0.35})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, w);
    }, { label: 'piece-shadow' });

    // selection / generic glow (white, tinted per use)
    const gs = R * 3.4;
    tex.glow = drawTexture(gs, gs, Math.min(resT, 2), (ctx, w) => {
      const c = w / 2;
      const g = ctx.createRadialGradient(c, c, 0, c, c, c);
      const r0 = R / c;
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(r0 * 0.85, 'rgba(255,255,255,0.75)');
      g.addColorStop(r0 * 1.05, 'rgba(255,255,255,0.5)');
      g.addColorStop(r0 * 1.35, 'rgba(255,255,255,0.16)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, w);
    }, { label: 'piece-glow' });

    tex.body = { 1: {}, [-1]: {} };
    tex.crown = { 1: null, [-1]: null };
    for (const side of [1, -1]) {
      for (const king of [false, true]) {
        const t = king ? this.thickness.king : this.thickness.man;
        tex.body[side][king ? 'king' : 'man'] = drawTexture(S, S, resT, (ctx, w) => {
          ctx.translate(w / 2, w / 2);
          if (epic) {
            const B = EPIC_BODY[side];
            const col = EPIC.side[side];
            paintEpicWall(ctx, R, t, B, king, col);
            paintEpicFace(ctx, R, B, side, king, col);
          } else {
            const P = side === 1 ? IVORY : EBONY;
            paintClassicWall(ctx, R, t, P, king);
            paintClassicFace(ctx, R, P, king);
          }
        }, { label: `piece-body-${theme}-${side}-${king ? 'k' : 'm'}` });
      }
      const cs = R * 1.5;
      tex.crown[side] = drawTexture(cs * 1.25, cs * 1.25, resT, (ctx, w) => {
        ctx.translate(w / 2, w / 2);
        if (epic) paintEpicSigil(ctx, R * 0.5);
        else paintClassicCrown(ctx, R * 0.46, side === 1);
      }, { label: `piece-crown-${theme}-${side}` });
    }

    if (epic) {
      tex.core = { 1: {}, [-1]: {} };
      for (const side of [1, -1]) {
        for (const king of [false, true]) {
          const cs = R * 1.4;
          tex.core[side][king ? 'king' : 'man'] = drawTexture(cs, cs, resT, (ctx, w) => {
            ctx.translate(w / 2, w / 2);
            paintEpicCore(ctx, R, EPIC.side[side], king);
          }, { label: `piece-core-${side}-${king ? 'k' : 'm'}` });
        }
      }
      const rs = R * 2.6;
      tex.ring = drawTexture(rs, rs, resT, (ctx, w) => {
        ctx.translate(w / 2, w / 2);
        paintKingRing(ctx, R);
      }, { label: 'piece-king-ring' });
    }

    // glint star (promotion shimmer / selection sparkle)
    const st = R * 1.4;
    tex.glint = drawTexture(st, st, Math.min(resT, 2), (ctx, w) => {
      const c = w / 2;
      const rnd = mulberry32(3);
      ctx.translate(c, c);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, c * 0.35);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, c * 0.35, 0, TAU);
      ctx.fill();
      for (let i = 0; i < 4; i++) {
        ctx.save();
        ctx.rotate((i * Math.PI) / 2 + (rnd() - 0.5) * 0.02);
        const lg = ctx.createLinearGradient(0, 0, c, 0);
        lg.addColorStop(0, 'rgba(255,255,255,0.95)');
        lg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.moveTo(0, -c * 0.05);
        ctx.lineTo(c, 0);
        ctx.lineTo(0, c * 0.05);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }, { label: 'piece-glint' });
  }

  faceOffset(king) {
    return -(king ? this.thickness.king : this.thickness.man) / 2;
  }

  sideColor(side) {
    return this.palette.side[side];
  }

  destroy() {
    const walk = (o) => {
      if (!o) return;
      if (o.source && typeof o.destroy === 'function') destroyTexture(o);
      else if (typeof o === 'object') for (const k of Object.keys(o)) walk(o[k]);
    };
    walk(this.textures);
    this.textures = null;
  }
}
