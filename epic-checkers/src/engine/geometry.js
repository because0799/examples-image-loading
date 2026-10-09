// Precomputed per-variant board geometry: playable squares, rays in the 4 move directions,
// direction sets for men/kings, promotion rows, square names. Built lazily and cached.

import { getVariant } from './variants.js';

// Direction order is chosen so that the opposite of direction d is always 3 - d.
//   diagonal:   0 = up-left, 1 = up-right, 2 = down-left, 3 = down-right
//   orthogonal: 0 = up,      1 = left,     2 = right,     3 = down
// "Up" means row decreasing = WHITE's forward direction.
const DIAG_DIRS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];
const ORTHO_DIRS = [
  [-1, 0],
  [0, -1],
  [0, 1],
  [1, 0],
];

const cache = new Map();

export function isPlayableRC(variant, r, c) {
  const n = variant.size;
  if (r < 0 || c < 0 || r >= n || c >= n) return false;
  if (variant.playable === 'all') return true;
  return (r + c) % 2 === variant.darkParity;
}

/**
 * Geometry object:
 *  size, count (size*size)
 *  playable: Uint8Array(count)
 *  squares: Int16Array of playable squares, ascending
 *  rays: Array(count*4) of Int16Array (squares along direction d from sq, nearest first)
 *  dr: Int8Array(4) row delta per direction
 *  manMoveDirs / manCapDirs: { [1]: number[], [-1]: number[] }
 *  kingDirs: number[]
 *  promoRow: { [1]: 0, [-1]: size - 1 }
 *  mainDiag: Uint8Array(count) — squares on the long playable diagonal ("main road")
 *  names: string[] (square names), nameToSq: Map
 */
export function getGeometry(variantOrId) {
  const variant = getVariant(variantOrId);
  let g = cache.get(variant.id);
  if (g) return g;
  g = buildGeometry(variant);
  cache.set(variant.id, g);
  return g;
}

function buildGeometry(v) {
  const n = v.size;
  const count = n * n;
  const dirs = v.geometry === 'orthogonal' ? ORTHO_DIRS : DIAG_DIRS;
  const playable = new Uint8Array(count);
  const list = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (isPlayableRC(v, r, c)) {
        playable[r * n + c] = 1;
        list.push(r * n + c);
      }
    }
  }
  const empty = new Int16Array(0);
  const rays = new Array(count * 4).fill(empty);
  for (const sq of list) {
    const r0 = Math.floor(sq / n);
    const c0 = sq % n;
    for (let d = 0; d < 4; d++) {
      const [dr, dc] = dirs[d];
      const ray = [];
      let r = r0 + dr;
      let c = c0 + dc;
      while (r >= 0 && c >= 0 && r < n && c < n) {
        ray.push(r * n + c);
        r += dr;
        c += dc;
      }
      rays[sq * 4 + d] = Int16Array.from(ray);
    }
  }

  let whiteMove;
  let blackMove;
  if (v.geometry === 'orthogonal') {
    // forward + sideways (Turkish men); ascending direction order for determinism
    whiteMove = v.manSideways ? [0, 1, 2] : [0];
    blackMove = v.manSideways ? [1, 2, 3] : [3];
  } else {
    whiteMove = [0, 1];
    blackMove = [2, 3];
  }
  const allDirs = [0, 1, 2, 3];
  const manMoveDirs = { 1: whiteMove, [-1]: blackMove };
  const manCapDirs = v.manBackCapture ? { 1: allDirs, [-1]: allDirs } : manMoveDirs;

  // Main road: the long diagonal made of playable squares (only meaningful for diagonal boards).
  const mainDiag = new Uint8Array(count);
  if (v.geometry === 'diagonal') {
    for (let i = 0; i < n; i++) {
      // parity 1 → a1..h8 runs from (n-1, 0) to (0, n-1); parity 0 → (0,0)..(n-1,n-1)
      const sq = v.darkParity === 1 ? (n - 1 - i) * n + i : i * n + i;
      if (playable[sq]) mainDiag[sq] = 1;
    }
  }

  // Square names
  const names = new Array(count).fill('');
  const nameToSq = new Map();
  let num = 0;
  for (let sq = 0; sq < count; sq++) {
    if (!playable[sq]) continue;
    const r = Math.floor(sq / n);
    const c = sq % n;
    let name;
    if (v.notation === 'numeric') {
      num++;
      name = String(num);
    } else {
      name = String.fromCharCode(97 + c) + String(n - r);
    }
    names[sq] = name;
    nameToSq.set(name, sq);
  }

  return Object.freeze({
    size: n,
    count,
    playable,
    squares: Int16Array.from(list),
    rays,
    dr: Int8Array.from(dirs.map((d) => d[0])),
    manMoveDirs,
    manCapDirs,
    kingDirs: allDirs,
    promoRow: { 1: 0, [-1]: n - 1 },
    mainDiag,
    names,
    nameToSq,
  });
}
