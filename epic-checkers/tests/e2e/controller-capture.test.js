// Illegal-tap explanations (RO-2 / MUX-02 / MUX-16): rawCaptureStats must agree with the engine's
// capture generator, and illegalTapReason must name the rule that refused the tap.

import test from 'node:test';
import assert from 'node:assert/strict';
import { rawCaptureStats, illegalTapReason } from '../../src/controller-capture.js';
import { getVariant, legalMoves, stateFromString, parseSquare, isPlayableSquare } from '../../src/engine/index.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CH = { 1: 'w', 2: 'W', '-1': 'b', '-2': 'B' };

/** Text position from { square name: code }. */
function pos(variantId, turn, pieces) {
  const v = getVariant(variantId);
  const n = v.size;
  const cells = new Array(n * n).fill('.');
  for (const [name, code] of Object.entries(pieces)) cells[parseSquare(variantId, name)] = CH[code];
  const rows = [];
  for (let r = 0; r < n; r++) rows.push(cells.slice(r * n, r * n + n).join(''));
  return stateFromString(variantId, `${turn > 0 ? 'w' : 'b'}:${rows.join('/')}`);
}

/** Random legal-looking position: pieces on playable squares, no man on its own promotion row. */
function randomState(variantId, rnd, { pieces = 14, kingP = 0.3 } = {}) {
  const v = getVariant(variantId);
  const n = v.size;
  const cells = new Array(n * n).fill('.');
  const free = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (isPlayableSquare(v, r, c)) free.push(r * n + c);
  const count = Math.min(free.length - 2, 3 + Math.floor(rnd() * pieces));
  for (let i = 0; i < count; i++) {
    const j = Math.floor(rnd() * free.length);
    const sq = free.splice(j, 1)[0];
    const r = Math.floor(sq / n);
    const color = rnd() < 0.5 ? 1 : -1;
    let king = rnd() < kingP;
    if ((color > 0 && r === 0) || (color < 0 && r === n - 1)) king = true;
    cells[sq] = CH[color * (king ? 2 : 1)];
  }
  const rows = [];
  for (let r = 0; r < n; r++) rows.push(cells.slice(r * n, r * n + n).join(''));
  return stateFromString(variantId, `${rnd() < 0.5 ? 'w' : 'b'}:${rows.join('/')}`);
}

const kingsOf = (m) => m.captured.filter((c) => Math.abs(c) === 2).length;

function ownSquares(st) {
  const out = [];
  for (let sq = 0; sq < st.board.length; sq++) if (st.board[sq] && Math.sign(st.board[sq]) === st.turn) out.push(sq);
  return out;
}

test('rawCaptureStats matches the engine in free-capture variants (every sequence is legal)', () => {
  for (const id of ['russian', 'english', 'pool']) {
    const rnd = rng(id.length * 7919);
    let checked = 0;
    for (let i = 0; i < 400; i++) {
      const st = randomState(id, rnd);
      const moves = legalMoves(st);
      for (const sq of ownSquares(st)) {
        const raw = rawCaptureStats(st, sq);
        const mine = moves.filter((m) => m.path[0] === sq && m.captures.length);
        const best = mine.reduce((a, m) => Math.max(a, m.captures.length), 0);
        assert.equal(raw.count, best, `${id} ${sq} in ${JSON.stringify(Array.from(st.board))} turn ${st.turn}`);
        if (best) {
          const k = mine.filter((m) => m.captures.length === best).reduce((a, m) => Math.max(a, kingsOf(m)), 0);
          assert.equal(raw.kings, k, `${id} kings ${sq}`);
          checked++;
        }
      }
    }
    assert.ok(checked > 50, `${id}: only ${checked} capturing pieces checked`);
  }
});

test('rawCaptureStats agrees with the majority rule (max variants) and the priority rules', () => {
  for (const id of ['turkish', 'international', 'brazilian', 'canadian', 'spanish', 'czech', 'italian']) {
    const v = getVariant(id);
    const rnd = rng(id.length * 104729);
    let refused = 0;
    for (let i = 0; i < 300; i++) {
      const st = randomState(id, rnd, { pieces: id === 'canadian' ? 22 : 16 });
      const moves = legalMoves(st);
      if (!moves.length || !moves[0].captures.length) continue;
      const M = Math.max(...moves.map((m) => m.captures.length));
      const K = Math.max(...moves.filter((m) => m.captures.length === M).map(kingsOf));
      const froms = new Set(moves.map((m) => m.path[0]));
      for (const sq of ownSquares(st)) {
        const raw = rawCaptureStats(st, sq);
        if (froms.has(sq)) {
          if (v.capture !== 'king-first') assert.equal(raw.count, M, `${id}: legal capturer ${sq} must reach the maximum`);
          if (v.capture === 'max-kings') assert.equal(raw.kings, K, `${id}: legal capturer ${sq} kings`);
          assert.equal(illegalTapReason(st, moves, sq), null);
          continue;
        }
        const reason = illegalTapReason(st, moves, sq);
        assert.ok(reason, `${id}: an own piece that cannot move must be explained`);
        if (raw.count === 0) {
          assert.ok(reason === 'mustCapture' || reason === 'manCantTakeKing', `${id}: ${reason}`);
          continue;
        }
        refused++;
        if (v.capture === 'max') {
          assert.ok(raw.count < M, `${id}: a refused capturer takes fewer (${raw.count} < ${M})`);
          assert.equal(reason, 'mustCaptureMax');
        } else if (v.capture === 'max-kings') {
          assert.ok(raw.count < M || (raw.count === M && raw.kings < K), `${id}: refused by quantity or quality`);
          assert.equal(reason, raw.count < M ? 'mustCaptureMax' : 'mustCaptureKings');
        } else if (v.capture === 'king-first') {
          assert.ok(Math.abs(st.board[sq]) === 1 && moves.every((m) => Math.abs(m.piece) === 2), `${id}: only a man is refused, for a king`);
          assert.equal(reason, 'kingMustCapture');
        } else {
          assert.ok(['mustCaptureMax', 'kingMustCapture', 'mustCaptureKings', 'capturePriority'].includes(reason), `${id}: ${reason}`);
        }
      }
    }
    if (id !== 'italian' && id !== 'czech') assert.ok(refused > 5, `${id}: only ${refused} refused capturers seen`);
  }
});

test('reviewer positions: Turkish majority, Czech king-first, Italian man vs king, blocked piece', () => {
  // MUX-02 (t4.mjs): f3 must take two; b3 could take one
  const tk = stateFromString('turkish', 'w:......../......../.....b../......../.b...b../.w...w../......../........');
  const tkMoves = legalMoves(tk);
  assert.deepEqual(tkMoves.map((m) => m.path), [[45, 29, 13]]);
  assert.equal(illegalTapReason(tk, tkMoves, 41), 'mustCaptureMax');
  assert.equal(illegalTapReason(tk, tkMoves, 20), 'mustCapture', 'an enemy piece while a capture is pending');

  // RO-2: Czech, man c3 could take two, but the king h2 must capture
  const cz = pos('czech', 1, { c3: 1, h2: 2, d4: -1, f6: -1, g3: -1 });
  const czMoves = legalMoves(cz);
  assert.ok(czMoves.every((m) => m.piece === 2));
  assert.equal(illegalTapReason(cz, czMoves, parseSquare('czech', 'c3')), 'kingMustCapture');

  // RO-2: Italian man c4 next to the king d5 (only c4-b5 is legal); aiming at e6 is explained
  const it = pos('italian', 1, { c4: 1, d5: -2 });
  const itMoves = legalMoves(it);
  const c4 = parseSquare('italian', 'c4');
  const e6 = parseSquare('italian', 'e6');
  assert.equal(rawCaptureStats(it, c4).manVsKing, true);
  assert.equal(illegalTapReason(it, itMoves, e6, c4), 'manCantTakeKing');
  assert.equal(illegalTapReason(it, itMoves, e6), null, 'without a selected piece an empty square needs no text');

  // MUX-16: Russian start, b2 is blocked by its neighbours
  const ru = stateFromString('russian', 'w:.b.b.b.b/b.b.b.b./.b.b.b.b/......../......../w.w.w.w./.w.w.w.w/w.w.w.w.');
  const ruMoves = legalMoves(ru);
  assert.equal(illegalTapReason(ru, ruMoves, parseSquare('russian', 'b2')), 'noMovesForPiece');
  assert.equal(illegalTapReason(ru, ruMoves, parseSquare('russian', 'e5')), null);

  // a selected piece aimed at a shorter capture than its own longest series (majority rule)
  const in10 = pos('international', 1, { 28: 2, 23: -1, 33: -1, 44: -1 });
  const inMoves = legalMoves(in10);
  const from = parseSquare('international', '28');
  const raw = rawCaptureStats(in10, from);
  const legalFirst = new Set(inMoves.flatMap((m) => [m.path].concat(m.alts || []).map((p) => p[1])));
  const shorter = raw.lands.find((l) => !legalFirst.has(l));
  if (shorter != null) assert.equal(illegalTapReason(in10, inMoves, shorter, from), 'mustCaptureMaxAny');
});
