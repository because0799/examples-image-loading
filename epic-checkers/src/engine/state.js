// Game state creation, cloning, (de)serialization and hashing.
//
// State: { variantId, size, board: Int8Array(size*size), turn: 1|-1, ply, counters, options }
// counters: { quiet, wm, wk, bm, bk, eg } — quiet = plies without progress, wm..bk = material,
// eg = flat endgame-rule trackers [key, plies, firstMover, ...] (see rules.js).

import { getVariant } from './variants.js';
import { getGeometry } from './geometry.js';
import { initialCounters, normalizeCounters } from './rules.js';

function normOptions(options) {
  return { giveaway: !!(options && options.giveaway) };
}

/** Initial position of a variant. */
export function createInitialState(variantId, options = { giveaway: false }) {
  const v = getVariant(variantId);
  const g = getGeometry(v);
  const n = v.size;
  const board = new Int8Array(n * n);
  const off = v.homeOffset || 0;
  for (let r = 0; r < n; r++) {
    let code = 0;
    if (r >= off && r < off + v.homeRows) code = -1;
    else if (r >= n - off - v.homeRows && r < n - off) code = 1;
    if (!code) continue;
    for (let c = 0; c < n; c++) {
      const sq = r * n + c;
      if (g.playable[sq]) board[sq] = code;
    }
  }
  const opts = normOptions(options);
  return {
    variantId: v.id,
    size: n,
    board,
    turn: v.first,
    ply: 0,
    counters: initialCounters(v.id, board, v.first, opts),
    options: opts,
  };
}

function copyCounters(c) {
  return { quiet: c.quiet, wm: c.wm, wk: c.wk, bm: c.bm, bk: c.bk, eg: c.eg.slice() };
}

/** Deep copy. */
export function cloneState(state) {
  return {
    variantId: state.variantId,
    size: state.size,
    board: state.board.slice(),
    turn: state.turn,
    ply: state.ply,
    counters: copyCounters(state.counters),
    options: normOptions(state.options),
  };
}

/** JSON-safe plain object (for worker postMessage / storage). */
export function serializeState(state) {
  return {
    variantId: state.variantId,
    size: state.size,
    board: Array.from(state.board),
    turn: state.turn,
    ply: state.ply,
    counters: {
      quiet: state.counters.quiet,
      wm: state.counters.wm,
      wk: state.counters.wk,
      bm: state.counters.bm,
      bk: state.counters.bk,
      eg: Array.from(state.counters.eg),
    },
    options: normOptions(state.options),
  };
}

/** Inverse of serializeState (validates the board against the variant). */
export function deserializeState(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('deserializeState: object expected');
  const v = getVariant(obj.variantId);
  const g = getGeometry(v);
  const n = v.size;
  if (!obj.board || obj.board.length !== n * n) throw new Error('deserializeState: bad board size');
  const board = Int8Array.from(obj.board);
  validateBoard(v, g, board);
  if (obj.turn !== 1 && obj.turn !== -1) throw new Error('deserializeState: bad turn');
  const turn = obj.turn;
  const options = normOptions(obj.options);
  return {
    variantId: v.id,
    size: n,
    board,
    turn,
    ply: Number.isFinite(obj.ply) && obj.ply >= 0 ? Math.floor(obj.ply) : 0,
    counters: normalizeCounters(v.id, board, turn, options, obj.counters),
    options,
  };
}

export function validateBoard(v, g, board) {
  for (let sq = 0; sq < board.length; sq++) {
    const c = board[sq];
    if (c === 0) continue;
    if (c !== 1 && c !== 2 && c !== -1 && c !== -2) throw new Error(`Invalid piece code ${c} on square ${sq}`);
    if (!g.playable[sq]) throw new Error(`Piece on unplayable square ${sq} (${v.id})`);
  }
}

// Hash characters indexed by code + 2: B, b, ., w, W
const HASH_CH = ['B', 'b', '.', 'w', 'W'];

/** Position hash (board + side to move) as a compact string; equal positions → equal strings. */
export function hashState(state) {
  const b = state.board;
  let s = state.turn === 1 ? 'w' : 'b';
  for (let i = 0; i < b.length; i++) s += HASH_CH[b[i] + 2];
  return s;
}
