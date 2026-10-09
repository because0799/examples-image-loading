// Square / move notation and the compact text position format.
//
// Text format: "<w|b>:<row0>/<row1>/.../<rowN-1>[|giveaway]" — row 0 is the top as seen by White,
// each row has `size` chars: '.' empty/unplayable, 'w' white man, 'W' white king,
// 'b' black man, 'B' black king.

import { getVariant } from './variants.js';
import { getGeometry, isPlayableRC } from './geometry.js';
import { normalizeCounters } from './rules.js';
import { validateBoard } from './state.js';

export function rcToSq(r, c, size) {
  return r * size + c;
}

export function sqToRc(sq, size) {
  return [Math.floor(sq / size), sq % size];
}

/** Whether (r, c) is a playing square of the variant (accepts a Variant object or an id). */
export function isPlayableSquare(variant, r, c) {
  return isPlayableRC(getVariant(variant), r, c);
}

/** 'e3' on 8×8 boards (files a.. from White's left, ranks 1.. from White's side);
 *  '1'..'50' / '1'..'72' on 10×10 / 12×12 (FMJD numbering, square 1 at Black's side). */
export function squareName(variantId, sq) {
  const g = getGeometry(variantId);
  if (!(sq >= 0 && sq < g.count) || !g.playable[sq]) return '?';
  return g.names[sq];
}

/** Square index from its name, or -1. */
export function parseSquare(variantId, name) {
  const g = getGeometry(variantId);
  const sq = g.nameToSq.get(String(name).trim().toLowerCase());
  return sq === undefined ? -1 : sq;
}

/** 'c3-d4' (quiet), 'c3:e5:g3' (capture, every landing square); numeric boards use '32-28', '28x19x10'. */
export function moveToString(variantId, move) {
  const v = getVariant(variantId);
  const capture = move.captures && move.captures.length > 0;
  const sep = capture ? (v.notation === 'numeric' ? 'x' : ':') : '-';
  return move.path.map((sq) => squareName(v.id, sq)).join(sep);
}

/** Path (array of squares) from a move string ('c3-d4', 'c3:e5:g3', '28x19', 'c3xe5'); null if invalid. */
export function parseMove(variantId, str) {
  const parts = String(str)
    .trim()
    .split(/[-:x×]+/i)
    .filter((p) => p.length > 0);
  if (parts.length < 2) return null;
  const path = [];
  for (const p of parts) {
    const sq = parseSquare(variantId, p);
    if (sq < 0) return null;
    path.push(sq);
  }
  return path;
}

const CODE_TO_CH = { 0: '.', 1: 'w', 2: 'W', [-1]: 'b', [-2]: 'B' };
const CH_TO_CODE = { '.': 0, w: 1, W: 2, b: -1, B: -2 };

export function stateToString(state) {
  const n = state.size;
  const rows = [];
  for (let r = 0; r < n; r++) {
    let row = '';
    for (let c = 0; c < n; c++) row += CODE_TO_CH[state.board[r * n + c]];
    rows.push(row);
  }
  let s = `${state.turn === 1 ? 'w' : 'b'}:${rows.join('/')}`;
  if (state.options && state.options.giveaway) s += '|giveaway';
  return s;
}

/**
 * Parse a text position. options: { giveaway?, ply?, counters? } — `counters` (partial) lets
 * tests/positions continue draw counts; by default counters start fresh at this position.
 */
export function stateFromString(variantId, str, options = {}) {
  const v = getVariant(variantId);
  const g = getGeometry(v);
  const n = v.size;
  let text = String(str).trim();
  let giveaway = !!options.giveaway;
  const bar = text.indexOf('|');
  if (bar >= 0) {
    const flags = text
      .slice(bar + 1)
      .split(/[|,]/)
      .map((f) => f.trim().toLowerCase());
    if (flags.includes('giveaway')) giveaway = true;
    text = text.slice(0, bar).trim();
  }
  const m = /^([wbWB])\s*:\s*(.*)$/s.exec(text);
  if (!m) throw new Error(`stateFromString: expected "<w|b>:rows", got "${str}"`);
  const turn = m[1].toLowerCase() === 'w' ? 1 : -1;
  const rows = m[2]
    .split('/')
    .map((r) => r.replace(/\s+/g, ''))
    .filter((r, i, arr) => !(r === '' && i === arr.length - 1));
  if (rows.length !== n) throw new Error(`stateFromString: ${v.id} needs ${n} rows, got ${rows.length}`);
  const board = new Int8Array(n * n);
  for (let r = 0; r < n; r++) {
    const row = rows[r];
    if (row.length !== n) throw new Error(`stateFromString: row ${r} must have ${n} chars: "${row}"`);
    for (let c = 0; c < n; c++) {
      const ch = row[c];
      if (!(ch in CH_TO_CODE)) throw new Error(`stateFromString: bad char "${ch}" in row ${r}`);
      board[r * n + c] = CH_TO_CODE[ch];
    }
  }
  validateBoard(v, g, board);
  const opts = { giveaway };
  return {
    variantId: v.id,
    size: n,
    board,
    turn,
    ply: Number.isFinite(options.ply) && options.ply >= 0 ? Math.floor(options.ply) : 0,
    counters: normalizeCounters(v.id, board, turn, opts, options.counters),
    options: opts,
  };
}
