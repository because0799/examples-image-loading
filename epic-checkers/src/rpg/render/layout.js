// «Валькирии доски» — board geometry of the battle view (pure, Node-testable).
//
// World coordinates = CSS px at camera zoom 1 (the main Renderer's convention). The 8×8 board is
// fitted into the DOM board slot rect; sq = row * 8 + col, row 0 = top as seen by side 1 (the
// player), dark squares ((row + col) odd) are playable. `flipped` draws side −1 at the bottom
// (hot-seat Duel); engine coordinates never change.

export const N = 8;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Is sq a dark (playable) square? */
export function isDarkSq(sq) {
  return sq >= 0 && sq < 64 && (((sq >> 3) + (sq & 7)) & 1) === 1;
}

/**
 * Fit the board into `rect` ({ x, y, width, height }, CSS px). Squares are snapped to device
 * pixels (`resolution`) so tile edges stay crisp. Returns
 * { n, sq, fw, total, x, y, bx, by, cx, cy, rect }: sq = square size, fw = frame width,
 * (x, y) = top-left of the frame, (bx, by) = top-left of the playing area, (cx, cy) = centre.
 */
export function computeLayout(rect, { resolution = 1, frameRatio = 0.034, minFrame = 5, maxFrame = 22 } = {}) {
  const r = rect && rect.width > 0 && rect.height > 0 ? rect : { x: 0, y: 0, width: 390, height: 390 };
  const res = Math.max(1, Number(resolution) || 1);
  const side = Math.max(48, Math.min(r.width, r.height));
  let fw = clamp(side * frameRatio, minFrame, maxFrame);
  let sq = Math.max(4, Math.floor(((side - 2 * fw) / N) * res) / res);
  fw = Math.max(minFrame * 0.5, Math.floor(((side - N * sq) / 2) * res) / res);
  const total = N * sq + 2 * fw;
  const x = Math.round((r.x + (r.width - total) / 2) * res) / res;
  const y = Math.round((r.y + (r.height - total) / 2) * res) / res;
  return { n: N, sq, fw, total, x, y, bx: x + fw, by: y + fw, cx: x + total / 2, cy: y + total / 2, rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
}

/** Displayed (row, col) of a square. */
export function displayRC(sq, flipped = false) {
  const r = sq >> 3;
  const c = sq & 7;
  return flipped ? { row: N - 1 - r, col: N - 1 - c } : { row: r, col: c };
}

/** World centre of a square (writes into `out` when given: no allocation in hot paths). */
export function sqCenter(L, sq, flipped = false, out = { x: 0, y: 0 }) {
  if (!L || sq < 0 || sq > 63) {
    out.x = L ? L.cx : 0;
    out.y = L ? L.cy : 0;
    return out;
  }
  let r = sq >> 3;
  let c = sq & 7;
  if (flipped) {
    r = N - 1 - r;
    c = N - 1 - c;
  }
  out.x = L.bx + (c + 0.5) * L.sq;
  out.y = L.by + (r + 0.5) * L.sq;
  return out;
}

/**
 * Square under a WORLD point, or -1. A tap slightly outside the board (within `tolerance`
 * squares) counts for the edge square, and a tap on a light square snaps to the nearest dark
 * neighbour when it lands within `tolerance` of that square's edge (same rule as the classic
 * Renderer.squareAt). tolerance = 0 → exact cell (light squares included).
 */
export function sqAt(L, x, y, flipped = false, tolerance = 0.25) {
  if (!L) return -1;
  let fx = (x - L.bx) / L.sq;
  let fy = (y - L.by) / L.sq;
  const tol = Math.max(0, Number(tolerance) || 0);
  if (!(fx >= 0 && fy >= 0 && fx < N && fy < N)) {
    if (!(fx >= -tol && fy >= -tol && fx < N + tol && fy < N + tol)) return -1;
    fx = Math.min(N - 1e-6, Math.max(0, fx));
    fy = Math.min(N - 1e-6, Math.max(0, fy));
  }
  let dc = Math.floor(fx);
  let dr = Math.floor(fy);
  const toSq = (rr, cc) => (flipped ? (N - 1 - rr) * N + (N - 1 - cc) : rr * N + cc);
  let sq = toSq(dr, dc);
  if (tol > 0 && !isDarkSq(sq)) {
    const ux = fx - dc;
    const uy = fy - dr;
    const cand = [
      [ux, 0, -1],
      [1 - ux, 0, 1],
      [uy, -1, 0],
      [1 - uy, 1, 0],
    ].filter(([, a, b]) => dr + a >= 0 && dr + a < N && dc + b >= 0 && dc + b < N);
    cand.sort((a, b) => a[0] - b[0]);
    if (cand.length && cand[0][0] <= tol) {
      dr += cand[0][1];
      dc += cand[0][2];
      sq = toSq(dr, dc);
    }
  }
  return sq;
}

/** Chebyshev distance between two squares. */
export function sqDist(a, b) {
  return Math.max(Math.abs((a >> 3) - (b >> 3)), Math.abs((a & 7) - (b & 7)));
}

/** Squares strictly between a and b on a shared diagonal ([] when not diagonal / adjacent). */
export function between(a, b) {
  const dr = (b >> 3) - (a >> 3);
  const dc = (b & 7) - (a & 7);
  if (!dr || Math.abs(dr) !== Math.abs(dc)) return [];
  const sr = Math.sign(dr);
  const sc = Math.sign(dc);
  const out = [];
  for (let k = 1; k < Math.abs(dr); k++) out.push(((a >> 3) + sr * k) * N + (a & 7) + sc * k);
  return out;
}

/** True when a and b share a diagonal. */
export function onDiagonal(a, b) {
  const dr = (b >> 3) - (a >> 3);
  const dc = (b & 7) - (a & 7);
  return dr !== 0 && Math.abs(dr) === Math.abs(dc);
}

/** The four diagonal rays from sq (up to `len` squares each), as arrays of squares. */
export function diagonalRays(sq, len = 7) {
  const out = [];
  for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const ray = [];
    for (let k = 1; k <= len; k++) {
      const r = (sq >> 3) + dr * k;
      const c = (sq & 7) + dc * k;
      if (r < 0 || r >= N || c < 0 || c >= N) break;
      ray.push(r * N + c);
    }
    out.push(ray);
  }
  return out;
}

/**
 * Screen rect that kanji / labels must stay inside: the board area plus a margin (in squares)
 * above and below, clamped to the screen.
 */
export function safeRectFor(L, screen, margin = 0.8) {
  if (!L) return null;
  const m = L.sq * margin;
  const x = Math.max(0, L.x - L.sq * 0.2);
  const y = Math.max(0, L.y - m);
  const w = Math.min(screen.width, L.x + L.total + L.sq * 0.2) - x;
  const h = Math.min(screen.height, L.y + L.total + m) - y;
  return { x, y, width: Math.max(10, w), height: Math.max(10, h) };
}

/**
 * Camera focus point that puts WORLD point (px, py) at the board centre (cx, cy) on screen at
 * `zoom`, for a camera that pivots around `anchor` (the classic Renderer's board centre).
 * screen = anchor + (world − focus) · zoom  →  focus = p − (c − anchor) / zoom.
 */
export function focusFor(px, py, zoom, anchor, cx, cy) {
  const z = zoom > 0 ? zoom : 1;
  return { x: px - (cx - anchor.x) / z, y: py - (cy - anchor.y) / z };
}

/** Cover-fit of an image (iw × ih) into the screen, keeping image point (ax, ay) (0..1) near (tx, ty). */
export function coverFit(iw, ih, sw, sh, ax = 0.5, ay = 0.5, tx = sw / 2, ty = sh / 2, over = 1.06) {
  const s = Math.max(sw / iw, sh / ih) * over;
  const w = iw * s;
  const h = ih * s;
  let x = tx - ax * w;
  let y = ty - ay * h;
  x = Math.min(0, Math.max(sw - w, x));
  y = Math.min(0, Math.max(sh - h, y));
  return { x, y, scale: s, width: w, height: h };
}
