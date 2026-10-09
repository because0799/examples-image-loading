// The AI's internal board (fast generator, make/unmake, Zobrist hash, draw counters) must agree
// with the engine — the engine is the source of truth for the rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { E, rng, randomState, outcomeKey } from './helpers.js';
import { SearchBoard, zobrist, zobristFromHashString } from '../../src/ai/board.js';

const POSITIONS_PER_VARIANT = Number(process.env.AI_XCHECK || 1500);

function aiKeys(b) {
  const start = b.mTop;
  const n = b.generate();
  const keys = [];
  for (let i = start; i < start + n; i++) keys.push(outcomeKey(b.mFrom[i], b.mTo[i], b.mPromo[i], b.capturesOf(i)));
  b.mTop = start;
  b.cTop = 0;
  return keys.sort();
}

function engineKeys(state) {
  return E.legalMoves(state)
    .map((m) => outcomeKey(m.from, m.to, m.promotion, m.captures))
    .sort();
}

for (const v of E.VARIANTS) {
  test(`generator matches the engine on ${POSITIONS_PER_VARIANT} random positions: ${v.id}`, () => {
    const rand = rng(0xc0ffee ^ v.id.length * 7919);
    const b = new SearchBoard(v.id, false);
    let captures = 0;
    for (let k = 0; k < POSITIONS_PER_VARIANT; k++) {
      const s = randomState(v.id, rand);
      b.load(s);
      const mine = aiKeys(b);
      const eng = engineKeys(s);
      if (eng.length && E.legalMoves(s)[0].captures.length) captures++;
      assert.deepEqual(mine, eng, `${v.id}: ${E.stateToString(s)}`);
      // the cheap predicates agree with full generation
      const hasCap = eng.length > 0 && E.legalMoves(s)[0].captures.length > 0;
      assert.equal(b.hasCapture(s.turn), hasCap, `hasCapture ${E.stateToString(s)}`);
      if (!hasCap) assert.equal(b.hasQuietMove(), eng.length > 0, `hasQuietMove ${E.stateToString(s)}`);
    }
    assert.ok(captures > POSITIONS_PER_VARIANT / 10, `enough capture positions (${captures})`);
  });
}

test('perft with make/unmake reproduces the published numbers', () => {
  const cases = { english: [7, 49, 302, 1469, 7361, 36768], international: [9, 81, 658, 4265, 27117], turkish: [8, 64, 708, 7538] };
  for (const [id, values] of Object.entries(cases)) {
    const b = new SearchBoard(id, false);
    b.load(E.createInitialState(id));
    const h0 = [b.hashLo, b.hashHi];
    const perft = (d) => {
      const start = b.mTop;
      const cs = b.cTop;
      const n = b.generate();
      let total = 0;
      if (d === 1) total = n;
      else
        for (let i = start; i < start + n; i++) {
          b.make(i);
          total += perft(d - 1);
          b.unmake(i);
        }
      b.mTop = start;
      b.cTop = cs;
      return total;
    };
    values.forEach((val, i) => assert.equal(perft(i + 1), val, `${id} perft(${i + 1})`));
    assert.deepEqual([b.hashLo, b.hashHi], h0, 'hash restored after perft');
  }
});

/**
 * Random games through the engine; at every ply every internal move is made and compared with
 * engine.applyMove (board, side, hash, no-progress counter, material, draw rules), then unmade.
 */
function checkGames(variantId, giveaway, games, seed) {
  const rand = rng(seed);
  const b = new SearchBoard(variantId, giveaway);
  let drawsSeen = 0;
  for (let gi = 0; gi < games; gi++) {
    let s = E.createInitialState(variantId, { giveaway });
    for (let ply = 0; ply < 400; ply++) {
      const moves = E.legalMoves(s);
      const res = E.positionResult(s, moves);
      b.load(s);
      // draw-rule replica (only meaningful when the side to move has moves)
      if (moves.length) {
        const engineDraw = !!res && res.winner === 0;
        assert.equal(b.drawByRule(), engineDraw, `drawByRule ${variantId} ${E.stateToString(s)} ${JSON.stringify(s.counters)}`);
        if (engineDraw) drawsSeen++;
      }
      if (res || !moves.length) break;
      const z = zobrist(s.board, s.turn);
      assert.deepEqual(zobristFromHashString(E.hashState(s), s.board.length), z);
      assert.deepEqual([b.hashLo, b.hashHi], [z.lo, z.hi]);
      const start = b.mTop;
      const n = b.generate();
      assert.equal(n, moves.length);
      const byKey = new Map(moves.map((m) => [outcomeKey(m.from, m.to, m.promotion, m.captures), m]));
      const boardBefore = b.board.slice();
      for (let i = start; i < start + n; i++) {
        const m = byKey.get(outcomeKey(b.mFrom[i], b.mTo[i], b.mPromo[i], b.capturesOf(i)));
        assert.ok(m, 'internal move exists in the engine list');
        const ns = E.applyMove(s, m);
        b.make(i);
        assert.deepEqual(Array.from(b.board), Array.from(ns.board), 'board after make');
        assert.equal(b.turn, ns.turn);
        assert.equal(b.quiet, ns.counters.quiet, 'no-progress counter');
        assert.deepEqual([b.wm, b.wk, b.bm, b.bk], [ns.counters.wm, ns.counters.wk, ns.counters.bm, ns.counters.bk]);
        const z2 = zobrist(ns.board, ns.turn);
        assert.deepEqual([b.hashLo, b.hashHi], [z2.lo, z2.hi], 'incremental hash');
        const nsMoves = E.legalMoves(ns);
        const nsRes = E.positionResult(ns, nsMoves);
        if (nsMoves.length) assert.equal(b.drawByRule(), !!nsRes && nsRes.winner === 0, 'drawByRule after make');
        b.unmake(i);
      }
      assert.deepEqual(Array.from(b.board), Array.from(boardBefore), 'board restored');
      assert.deepEqual([b.hashLo, b.hashHi], [z.lo, z.hi], 'hash restored');
      // continue the game: prefer quiet king moves sometimes to exercise draw counters
      const pick = moves[Math.floor(rand() * moves.length)];
      s = E.applyMove(s, pick);
    }
  }
  return drawsSeen;
}

test('make/unmake, hash and counters agree with the engine along random games (all variants)', () => {
  for (const v of E.VARIANTS) checkGames(v.id, false, 6, 1234 + v.size);
});

test('giveaway: make/unmake and counters agree with the engine', () => {
  for (const id of ['russian', 'turkish', 'english', 'international']) checkGames(id, true, 4, 77);
});

test('endgame draw-rule replica matches positionResult in king endings (all rule sets)', () => {
  // Random sparse king endings walked randomly: exercises r3v1, rRoad, rBalance, f16, f5, bRoad,
  // the Turkish one-each rule and the no-progress limits.
  const rand = rng(99);
  let draws = 0;
  for (const v of E.VARIANTS) {
    const b = new SearchBoard(v.id, false);
    for (let k = 0; k < 60; k++) {
      // 2..6 pieces, mostly kings
      const t = b.t;
      const board = new Int8Array(t.count);
      const total = 2 + Math.floor(rand() * 5);
      const wN = 1 + Math.floor(rand() * (total - 1));
      let placed = 0;
      while (placed < total) {
        const sq = t.sqs[Math.floor(rand() * t.sqs.length)];
        if (board[sq]) continue;
        const color = placed < wN ? 1 : -1;
        const r = t.row[sq];
        let king = rand() < 0.8;
        if ((color === 1 && r === 0) || (color === -1 && r === t.n - 1)) king = true;
        board[sq] = color * (king ? 2 : 1);
        placed++;
      }
      let s = E.deserializeState({ variantId: v.id, board: Array.from(board), turn: rand() < 0.5 ? 1 : -1 });
      for (let ply = 0; ply < 140; ply++) {
        const moves = E.legalMoves(s);
        if (!moves.length) break;
        const res = E.positionResult(s, moves);
        b.load(s);
        const expect = !!res && res.winner === 0;
        assert.equal(b.drawByRule(), expect, `${v.id} ${E.stateToString(s)} ${JSON.stringify(s.counters)}`);
        if (res) {
          if (expect) draws++;
          break;
        }
        // walk with internal make to also test incremental tracking over many plies
        const start = b.mTop;
        const n = b.generate();
        const i = start + Math.floor(rand() * n);
        const key = outcomeKey(b.mFrom[i], b.mTo[i], b.mPromo[i], b.capturesOf(i));
        const m = moves.find((mm) => outcomeKey(mm.from, mm.to, mm.promotion, mm.captures) === key);
        b.make(i);
        s = E.applyMove(s, m);
        const nm = E.legalMoves(s);
        if (nm.length) {
          const r2 = E.positionResult(s, nm);
          assert.equal(b.drawByRule(), !!r2 && r2.winner === 0, `incremental ${v.id} ${E.stateToString(s)}`);
        }
      }
    }
  }
  assert.ok(draws > 50, `draw rules triggered (${draws})`);
});

test('repetition detection along the path and against the game history', () => {
  // Two kings shuffling on different diagonals: K c1-d2, k f8-e7, K d2-c1, k e7-f8 → the
  // position repeats after 4 plies.
  const s0 = E.stateFromString('russian', 'w:.....B../......../......../......../......../......../......../..W.....');
  const b = new SearchBoard('russian', false);
  b.load(s0);
  const play = (fromName, toName) => {
    const from = E.parseSquare('russian', fromName);
    const to = E.parseSquare('russian', toName);
    const start = b.mTop;
    const n = b.generate();
    for (let i = start; i < start + n; i++) {
      if (b.mFrom[i] === from && b.mTo[i] === to) {
        b.mTop = start + n;
        b.make(i);
        return;
      }
    }
    throw new Error(`no move ${fromName}-${toName}`);
  };
  play('c1', 'd2');
  assert.equal(b.isRepetition(), false);
  play('f8', 'e7');
  play('d2', 'c1');
  assert.equal(b.isRepetition(), false);
  play('e7', 'f8');
  assert.equal(b.isRepetition(), true, 'back to the root position after 4 plies');

  // Game history: H0 = s0, H1..H4 shuffle back to s0, then c1-b2 (H5, black to move). From H5,
  // f8-e7 b2-c1 reaches H3 (white K c1, black K e7, black to move) — a game-history position.
  const g = new E.Game('russian', {}, s0);
  for (const m of ['c1-d2', 'f8-e7', 'd2-c1', 'e7-f8', 'c1-b2']) g.play(E.parseMove('russian', m));
  b.load(g.state);
  b.setHistory(g.hashes);
  assert.equal(b.quiet, 5);
  play('f8', 'e7');
  assert.equal(b.isRepetition(), false);
  play('b2', 'c1');
  assert.equal(b.isRepetition(), true, 'game-history position recognised');
  b.setHistory([]);
  assert.equal(b.isRepetition(), false, 'no history → not a repetition (only 2 plies into the search)');
});
