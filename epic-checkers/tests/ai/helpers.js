// Shared helpers for the AI tests (not a test file itself).
import * as E from '../../src/engine/index.js';
import { getTables } from '../../src/ai/board.js';

export { E };

/** Deterministic PRNG in [0, 1). */
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * Random position of a variant: random density and king share, men never on their own
 * promotion row (they become kings there).
 */
export function randomState(variantId, rand, { giveaway = false, minDensity = 0.12, maxDensity = 0.7 } = {}) {
  const t = getTables(variantId);
  const board = new Int8Array(t.count);
  const dens = minDensity + rand() * (maxDensity - minDensity);
  const kingP = rand() * 0.5;
  for (const sq of t.sqs) {
    if (rand() > dens) continue;
    const color = rand() < 0.5 ? 1 : -1;
    const r = t.row[sq];
    let king = rand() < kingP;
    if (!king && ((color === 1 && r === 0) || (color === -1 && r === t.n - 1))) king = true;
    board[sq] = color * (king ? 2 : 1);
  }
  // make sure both sides have something
  let w = 0;
  let b = 0;
  for (const c of board) {
    if (c > 0) w++;
    else if (c < 0) b++;
  }
  if (!w || !b) return randomState(variantId, rand, { giveaway, minDensity, maxDensity });
  return E.deserializeState({ variantId, board: Array.from(board), turn: rand() < 0.5 ? 1 : -1, options: { giveaway } });
}

/** Build a state from piece lists: place('russian', 1, { w: ['c3'], W: [], b: ['d4'], B: [] }). */
export function place(variantId, turn, pieces, options = {}) {
  const v = E.getVariant(variantId);
  const n = v.size;
  const rows = Array.from({ length: n }, () => Array(n).fill('.'));
  for (const [ch, list] of Object.entries(pieces)) {
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

/** Engine move (by path) → 'c3-d4' style string. */
export function pathStr(state, path) {
  const m = E.findMove(E.legalMoves(state), path);
  return m ? E.moveToString(state.variantId, m) : `ILLEGAL(${JSON.stringify(path)})`;
}

/** Is `path` a legal move in `state`? */
export function isLegal(state, path) {
  return Array.isArray(path) && E.findMove(E.legalMoves(state), path) !== null;
}

/** Outcome key of a move (from, to, promotion, sorted captured squares). */
export function outcomeKey(from, to, promo, caps) {
  return `${from}>${to}>${promo ? 1 : 0}>${Array.from(caps)
    .sort((a, b) => a - b)
    .join(',')}`;
}

/** Play a game AI vs AI (or with a custom chooser) until a result; returns { game, plies, result }. */
export function playGame(variantId, chooseWhite, chooseBlack, { giveaway = false, maxPlies = 2000, start } = {}) {
  const g = new E.Game(variantId, { giveaway }, start);
  let plies = 0;
  while (!g.result && plies < maxPlies) {
    const chooser = g.state.turn === 1 ? chooseWhite : chooseBlack;
    const path = chooser(g);
    g.play(path);
    plies++;
  }
  return { game: g, plies, result: g.result };
}
