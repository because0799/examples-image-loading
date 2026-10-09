// Shared helpers for engine tests (not a test file itself).
import assert from 'node:assert/strict';
import * as E from '../../src/engine/index.js';

export { E };

/**
 * Build a state from piece lists: place('russian', 1, { w: ['c3'], W: ['a1'], b: ['d4'], B: [] }).
 * Goes through stateFromString, so it also exercises the text format.
 */
export function place(variantId, turn, pieces, options = {}) {
  const v = E.getVariant(variantId);
  const n = v.size;
  const rows = Array.from({ length: n }, () => Array(n).fill('.'));
  for (const [ch, list] of Object.entries(pieces)) {
    if (!['w', 'W', 'b', 'B'].includes(ch)) throw new Error(`bad piece key ${ch}`);
    for (const name of list) {
      const sq = E.parseSquare(variantId, name);
      if (sq < 0) throw new Error(`bad square ${name} for ${variantId}`);
      const [r, c] = E.sqToRc(sq, n);
      if (rows[r][c] !== '.') throw new Error(`square ${name} used twice`);
      rows[r][c] = ch;
    }
  }
  const str = `${turn === 1 ? 'w' : 'b'}:${rows.map((r) => r.join('')).join('/')}`;
  return E.stateFromString(variantId, str, options);
}

export function moveStrs(state, moves = E.legalMoves(state)) {
  return moves.map((m) => E.moveToString(state.variantId, m));
}

export function sortedMoves(state) {
  return moveStrs(state).sort();
}

export function assertMoves(state, expected, msg) {
  assert.deepEqual(sortedMoves(state), [...expected].sort(), msg);
}

/** Find a legal move by its string; throws if not legal. */
export function mv(state, str) {
  const path = E.parseMove(state.variantId, str);
  assert.ok(path, `cannot parse ${str}`);
  const m = E.findMove(E.legalMoves(state), path);
  assert.ok(m, `${str} is not legal in ${E.stateToString(state)}; legal: ${moveStrs(state).join(' ')}`);
  return m;
}

/** Play a list of move strings, returning all states [s0, s1, ...]. */
export function playLine(state, line) {
  const out = [state];
  let s = state;
  for (const str of line) {
    s = E.applyMove(s, mv(s, str));
    out.push(s);
  }
  return out;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function perft(state, depth) {
  if (depth === 0) return 1;
  const ms = E.legalMoves(state);
  if (depth === 1) return ms.length;
  let n = 0;
  for (const m of ms) n += perft(E.applyMove(state, m), depth - 1);
  return n;
}

export function sq(variantId, name) {
  const s = E.parseSquare(variantId, name);
  if (s < 0) throw new Error(`bad square ${name}`);
  return s;
}
