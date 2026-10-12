// «Валькирии доски» — board geometry (pure helpers, no state).
//
// 8×8 board, sq = row * 8 + col, row 0 = top (the enemy's home side), col 0 = file "a".
// Only DARK squares are playable: (row + col) odd — a1 (row 7, col 0) is dark, as in Russian draughts.
// Side 1 (the player / «Белые» seat) deploys on rows 6–7 and awakens on row 0; side −1 deploys on
// rows 0–1 and awakens on row 7. Distance = Chebyshev distance; the 4 directions are the diagonals.

export const SIZE = 8;
export const DIRS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

export const rowOf = (sq) => sq >> 3;
export const colOf = (sq) => sq & 7;
export const sqOf = (r, c) => r * 8 + c;
export const onBoard = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
export const isDark = (sq) => sq >= 0 && sq < 64 && (((sq >> 3) + (sq & 7)) & 1) === 1;

/** All 32 dark squares in ascending order. */
export const DARK = [];
for (let sq = 0; sq < 64; sq++) if (isDark(sq)) DARK.push(sq);

export function dist(a, b) {
  return Math.max(Math.abs((a >> 3) - (b >> 3)), Math.abs((a & 7) - (b & 7)));
}

/** Square `n` steps from `sq` along direction index `d`, or -1 when off the board. */
export function stepSq(sq, d, n = 1) {
  const r = (sq >> 3) + DIRS[d][0] * n;
  const c = (sq & 7) + DIRS[d][1] * n;
  return onBoard(r, c) ? r * 8 + c : -1;
}

/** Direction index from a to b when they share a diagonal (a !== b), else -1. */
export function dirBetween(a, b) {
  const dr = (b >> 3) - (a >> 3);
  const dc = (b & 7) - (a & 7);
  if (dr === 0 || Math.abs(dr) !== Math.abs(dc)) return -1;
  if (dr < 0) return dc < 0 ? 0 : 1;
  return dc < 0 ? 2 : 3;
}

/** Squares strictly between a and b on a shared diagonal ([] when adjacent or not diagonal). */
export function between(a, b) {
  const d = dirBetween(a, b);
  if (d < 0) return [];
  const out = [];
  const n = dist(a, b);
  for (let k = 1; k < n; k++) out.push(stepSq(a, d, k));
  return out;
}

/** The (up to 4) diagonal neighbours of sq. */
export function neighbors(sq) {
  const out = [];
  for (let d = 0; d < 4; d++) {
    const t = stepSq(sq, d);
    if (t >= 0) out.push(t);
  }
  return out;
}

/** Home (back) row of a side. */
export const homeRow = (side) => (side === 1 ? 7 : 0);
/** Rows between the square and the side's own back row (0 on the back row, 7 on the enemy's). */
export const rowsAdvanced = (side, sq) => (side === 1 ? 7 - (sq >> 3) : sq >> 3);
/** Row delta of a forward step for a side. */
export const forwardDr = (side) => (side === 1 ? -1 : 1);
/** The two deployment rows of a side: [front, back]. */
export const deployRows = (side) => (side === 1 ? [6, 7] : [1, 0]);

const FILES = 'abcdefgh';
/** Board notation (a1 = row 7 col 0) → sq; returns -1 when invalid. Numbers pass through. */
export function parseSq(x) {
  if (typeof x === 'number') return Number.isInteger(x) && x >= 0 && x < 64 ? x : -1;
  if (typeof x !== 'string' || x.length < 2) return -1;
  const c = FILES.indexOf(x[0].toLowerCase());
  const rank = parseInt(x.slice(1), 10);
  if (c < 0 || !(rank >= 1 && rank <= 8)) return -1;
  return (8 - rank) * 8 + c;
}

export function sqName(sq) {
  if (!(sq >= 0 && sq < 64)) return '-';
  return FILES[sq & 7] + (8 - (sq >> 3));
}
