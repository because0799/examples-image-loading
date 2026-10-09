// Random-playout fuzzing library (used by fuzz-*.test.js): play random games to the end through
// Game and, at EVERY ply, apply EVERY legal move checking the invariants.
import assert from 'node:assert/strict';
import { E, rng } from './util.js';

export const GAMES = Number(process.env.FUZZ_GAMES || 200);
const PLY_CAP = 20000;

function count(board) {
  const c = { 1: 0, 2: 0, [-1]: 0, [-2]: 0 };
  for (const x of board) if (x) c[x]++;
  return c;
}

/** Piece counts + check that no piece stands on an unplayable square (single pass). */
function countChecked(board, playable) {
  const c = { 1: 0, 2: 0, [-1]: 0, [-2]: 0 };
  for (let s = 0; s < board.length; s++) {
    const x = board[s];
    if (x === 0) continue;
    if (!playable[s]) assert.fail(`piece on unplayable square ${s}`);
    c[x]++;
  }
  return c;
}

const playableCache = new Map();
function playableMask(v) {
  let m = playableCache.get(v.id);
  if (!m) {
    m = new Uint8Array(v.size * v.size);
    for (let s = 0; s < m.length; s++) m[s] = E.isPlayableSquare(v, Math.floor(s / v.size), s % v.size) ? 1 : 0;
    playableCache.set(v.id, m);
  }
  return m;
}

function checkMove(v, state, m, seenPaths, before) {
  const playable = playableMask(v);
  const n = v.size;
  const turn = state.turn;
  const row = (s) => Math.floor(s / n);
  const col = (s) => s % n;
  const key = m.path.join(',');
  assert.ok(!seenPaths.has(key), 'duplicate path');
  seenPaths.add(key);
  assert.equal(m.path[0], m.from);
  assert.equal(m.path[m.path.length - 1], m.to);
  assert.equal(m.captures.length, m.captured.length);
  if (m.captures.length) assert.equal(m.path.length, m.captures.length + 1);
  else assert.equal(m.path.length, 2);
  assert.equal(m.piece, state.board[m.from]);
  assert.equal(Math.sign(m.piece), turn);
  assert.equal(new Set(m.captures).size, m.captures.length, 'a piece captured twice');
  for (let i = 0; i < m.captures.length; i++) {
    assert.equal(m.captured[i], state.board[m.captures[i]]);
    assert.equal(Math.sign(m.captured[i]), -turn);
    if (!v.menCaptureKings && Math.abs(m.piece) === 1) assert.equal(Math.abs(m.captured[i]), 1, 'Italian man took a king');
  }
  for (const p of m.path) assert.equal(playable[p], 1, 'path through unplayable square');
  // direction of men
  const promoRow = turn === 1 ? 0 : n - 1;
  const isMan = Math.abs(m.piece) === 1;
  if (isMan) {
    const steps = m.path.length - 1;
    for (let i = 0; i < steps; i++) {
      const a = m.path[i];
      const b = m.path[i + 1];
      const dr = (row(b) - row(a)) * turn; // < 0 means forward
      const dc = col(b) - col(a);
      const asKing = v.midPromotion === 'king' && m.promotionAt >= 0 && i >= m.promotionAt;
      if (asKing) continue;
      const len = m.captures.length ? 2 : 1;
      if (v.geometry === 'orthogonal') {
        // forward or sideways only, never backward, never diagonal
        assert.ok(dr <= 0, 'Turkish man moved backward');
        assert.ok(dr === 0 || dc === 0, 'Turkish man moved diagonally');
        assert.equal(Math.abs(dr) + Math.abs(dc), len);
      } else {
        assert.equal(Math.abs(dr), len, 'man step length');
        assert.equal(Math.abs(dc), len, 'man step length');
        if (!m.captures.length || !v.manBackCapture) assert.ok(dr < 0, 'man moved/captured backward');
      }
    }
  }
  // promotion bookkeeping
  if (!isMan) {
    assert.equal(m.promotion, false);
  } else if (v.midPromotion === 'king') {
    const firstLast = m.path.findIndex((s, i) => i > 0 && row(s) === promoRow);
    assert.equal(m.promotion, firstLast > 0);
    assert.equal(m.promotionAt, firstLast > 0 ? firstLast : -1);
  } else {
    assert.equal(m.promotion, row(m.to) === promoRow);
    assert.equal(m.promotionAt, m.promotion ? m.path.length - 1 : -1);
    if (v.midPromotion === 'stop') {
      for (let i = 1; i < m.path.length - 1; i++) assert.notEqual(row(m.path[i]), promoRow, 'did not stop on promotion');
    }
  }
  // apply
  const after = E.applyMove(state, m);
  const now = countChecked(after.board, playable);
  assert.equal(after.turn, -turn);
  assert.equal(after.ply, state.ply + 1);
  const mine = (c, k) => c[turn * k];
  const theirs = (c, k) => c[-turn * k];
  assert.equal(mine(now, 1) + mine(now, 2), mine(before, 1) + mine(before, 2), 'mover lost pieces');
  assert.equal(theirs(now, 1) + theirs(now, 2), theirs(before, 1) + theirs(before, 2) - m.captures.length);
  if (m.promotion) assert.equal(mine(now, 2), mine(before, 2) + 1);
  else assert.equal(mine(now, 2), mine(before, 2));
  assert.equal(after.board[m.to], m.promotion ? 2 * turn : m.piece);
  if (m.from !== m.to) assert.equal(after.board[m.from], 0);
  for (const x of m.captures) {
    // with immediate removal (Turkish) a king may finish on a square it emptied during the move
    if (x === m.to) assert.equal(v.removal, 'immediate', 'landed on a captured piece');
    else assert.equal(after.board[x], 0);
  }
  const mat = E.materialCount(after);
  assert.ok(mat.wm === now[1] && mat.wk === now[2] && mat.bm === now[-1] && mat.bk === now[-2], 'material counters');
  assert.ok(after.counters.quiet === 0 || after.counters.quiet === state.counters.quiet + 1);
  if (m.captures.length) assert.equal(after.counters.quiet, 0);
  return after;
}

export function runGames(v, giveaway) {
  const rand = rng((giveaway ? 0x9e37 : 0x1234) ^ (v.id.charCodeAt(0) * 977 + v.id.length * 131 + v.size));
  const reasons = {};
  let totalPlies = 0;
  let maxPlies = 0;
  for (let gi = 0; gi < GAMES; gi++) {
    const g = new E.Game(v.id, { giveaway });
    let plies = 0;
    while (!g.result) {
      assert.ok(plies < PLY_CAP, `${v.id} game did not terminate`);
      const moves = g.moves;
      assert.ok(moves.length > 0, 'no moves but no result');
      const seen = new Set();
      const before = count(g.state.board);
      for (const m of moves) checkMove(v, g.state, m, seen, before);
      // mandatory capture: all moves capture or none
      assert.ok(moves.every((m) => m.captures.length > 0) || moves.every((m) => m.captures.length === 0));
      if (v.capture === 'max') {
        const mx = Math.max(...moves.map((m) => m.captures.length));
        assert.ok(moves.every((m) => m.captures.length === mx), 'majority rule violated');
      }
      g.play(moves[Math.floor(rand() * moves.length)]);
      plies++;
    }
    const r = g.result;
    reasons[r.reason] = (reasons[r.reason] || 0) + 1;
    if (r.reason === 'no-moves') assert.equal(E.legalMoves(g.state).length, 0);
    if (r.reason === 'no-pieces') {
      const m = E.materialCount(g.state);
      assert.ok(m.wm + m.wk === 0 || m.bm + m.bk === 0);
    }
    if (r.reason === 'no-moves' || r.reason === 'no-pieces') {
      const loser = r.reason === 'no-pieces' ? (E.materialCount(g.state).wm + E.materialCount(g.state).wk === 0 ? 1 : -1) : g.state.turn;
      assert.equal(r.winner, giveaway ? loser : -loser, 'winner inversion');
    } else {
      assert.equal(r.winner, 0);
    }
    totalPlies += plies;
    maxPlies = Math.max(maxPlies, plies);
  }
  return { reasons, avg: Math.round(totalPlies / GAMES), maxPlies };
}

