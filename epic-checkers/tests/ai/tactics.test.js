// Tactics in hand-made / brute-force-verified positions for several variants (incl. Turkish).
// Every "expected" move is double-checked by an independent material minimax written here on
// top of the engine (no AI code), so a test cannot pass because of a shared bug.
import test from 'node:test';
import assert from 'node:assert/strict';
import { E, place, pathStr } from './helpers.js';
import { search, MATE_BOUND } from '../../src/ai/search.js';

// ------------------------------------------------------------------ independent brute force
function material(s) {
  const c = E.materialCount(s);
  return s.turn * (c.wm + 3 * c.wk - (c.bm + 3 * c.bk));
}

/** Material negamax with alpha-beta; captures at the horizon are always resolved. */
function brute(s, d, a = -1e9, b = 1e9) {
  const ms = E.legalMoves(s);
  if (!ms.length) return s.options.giveaway ? 1000 + d : -1000 - d;
  if ((d <= 0 && !ms[0].captures.length) || d <= -14) return s.options.giveaway ? -material(s) : material(s);
  let best = -1e9;
  for (const m of ms) {
    const v = -brute(E.applyMove(s, m), d - 1, -b, -a);
    if (v > best) best = v;
    if (v > a) a = v;
    if (a >= b) break;
  }
  return best;
}

/** Exact brute-force value of every move: Map moveString → value. */
function bruteMoves(s, depth) {
  const out = new Map();
  for (const m of E.legalMoves(s)) out.set(E.moveToString(s.variantId, m), -brute(E.applyMove(s, m), depth - 1));
  return out;
}

// Node budgets instead of wall-clock limits keep these tests deterministic on a busy machine
// (≈ 0.2 / 0.4 / 0.8 s of search on a desktop core).
const NODES = { 3: 120000, 4: 250000, 5: 500000 };

// These tests check what the search CALCULATES. Levels 3 and 4 deliberately play a human-like
// share of imperfect moves (glances, slips, noise — see levels.js and levels.test.js), so their
// calculation is tested with the error model switched off; level 5 has none.
const CALC = { random: 0, glance: 0, slip: 0, noise: 0 };

function aiMove(s, level, extra = {}) {
  const params = level < 5 ? { ...CALC, ...(extra.params || {}) } : extra.params;
  const r = search(s, { level, timeMs: 30000, maxNodes: NODES[level], seed: 11, newGame: true, ...extra, params });
  return { r, str: pathStr(s, r.path), move: E.findMove(E.legalMoves(s), r.path) };
}

const STRONG = [3, 4, 5];

// ------------------------------------------------------------------ bigger capture (free choice)
for (const id of ['russian', 'english', 'pool', 'czech']) {
  test(`${id}: with a free choice of captures, takes the bigger one`, () => {
    const s = place(id, 1, { w: ['a3', 'g3'], b: ['b4', 'f4', 'd6', 'h6'] });
    const legal = E.legalMoves(s).map((m) => E.moveToString(id, m));
    assert.ok(legal.includes('g3:e5:c7') && legal.some((m) => m.startsWith('a3:')), `free choice exists: ${legal}`);
    const bm = bruteMoves(s, 5);
    assert.ok(bm.get('g3:e5:c7') > Math.max(...[...bm].filter(([k]) => k !== 'g3:e5:c7').map(([, v]) => v)));
    for (const level of STRONG) assert.equal(aiMove(s, level).str, 'g3:e5:c7', `level ${level}`);
  });
}

// ------------------------------------------------------------------ do not hang a piece
const HANG = [
  ['russian', { w: ['e3', 'a3'], b: ['g5', 'h6', 'a7'] }, 'e3-f4'],
  ['english', { w: ['e3', 'a3'], b: ['g5', 'h6', 'a7'] }, 'e3-f4'],
  ['brazilian', { w: ['e3', 'a3'], b: ['g5', 'h6', 'a7'] }, 'e3-f4'],
  ['turkish', { w: ['d4', 'a2', 'h2'], b: ['d6', 'h7', 'a7'] }, 'd4-d5'],
];
for (const [id, pieces, bad] of HANG) {
  test(`${id}: does not give a piece away for nothing (${bad})`, () => {
    const s = place(id, 1, pieces);
    const bm = bruteMoves(s, 4);
    const best = Math.max(...bm.values());
    assert.ok(bm.get(bad) < best, `${bad} really loses material`);
    for (const level of STRONG) {
      const { str } = aiMove(s, level);
      assert.notEqual(str, bad, `level ${level}`);
      assert.equal(bm.get(str), best, `level ${level}: ${str} keeps the material`);
    }
  });
}

// ------------------------------------------------------------------ 2-for-1 shots (sacrifice → forced capture → multi-capture)
// Found by a brute-force search (unique best move at depths 5, 7 and 9, net gain ≥ 1 man).
const SHOTS = [
  ['russian', 'w:......../....b.../.b...b.b/b......./...w.w.b/......../.....w.w/......w.', 'd4-e5'],
  ['russian', 'w:.b....../..b...../.b....../......../.b.b...w/......../...w..../..w...w.', 'd2-c3'],
  ['russian', 'w:.b....../......../.....b../....b.../.b.b...w/......w./...w...w/w.....w.', 'h4-g5'],
  ['english', 'w:......../b...b.../.....b../..b...../.b.b..../......../.w.w.w../....w...', 'd2-c3'],
  ['brazilian', 'w:......../....b.../.b...b.b/b......./...w.w.b/......../.....w.w/......w.', 'd4-e5'],
  ['turkish', 'w:....b.../......../......../...b..../bwbb...b/......../...w..../w.w.....', 'd2-d3'],
  ['turkish', 'w:b.....b./...b...b/.b....../...w..../ww.b...w/......../......../.....w..', 'b4-b5'],
  ['turkish', 'w:......../b.b.bb.b/b......./..w.w.../..w...w./..w...../.w....../........', 'e5-e6'],
  [
    'international',
    'w:........../w.....b.../........../..b......./........../........../........../....w...../.w.w.w.w.b/..........',
    '44-40',
  ],
];
for (const [id, pos, shot] of SHOTS) {
  test(`${id}: finds the 2-for-1 shot ${shot}`, () => {
    const s = E.stateFromString(id, pos);
    assert.equal(E.legalMoves(s)[0].captures.length, 0, 'quiet position (no capture yet)');
    const bm = bruteMoves(s, 7);
    const base = material(s);
    const others = [...bm].filter(([k]) => k !== shot).map(([, v]) => v);
    assert.ok(bm.get(shot) >= base + 1 && Math.max(...others) <= base, `brute force confirms ${shot}: ${[...bm]}`);
    const after = E.applyMove(s, E.findMove(E.legalMoves(s), E.parseMove(id, shot)));
    assert.ok(E.legalMoves(after)[0].captures.length > 0, 'it is a sacrifice: the opponent must capture');
    for (const level of STRONG) assert.equal(aiMove(s, level).str, shot, `level ${level}`);
  });
}

test('level 3 with its human errors still finds most of its own 2-for-1 shots', () => {
  // A first impression (depth 1 + the capture sequence) already shows a simple shot of one's own;
  // longer combinations (here Turkish e5-e6, International 44-40) need the full look that level 3
  // skips on some moves.
  let found = 0;
  let total = 0;
  for (const [id, pos, shot] of SHOTS) {
    const s = E.stateFromString(id, pos);
    for (let seed = 1; seed <= 10; seed++) {
      const r = search(s, { level: 3, timeMs: 30000, seed, newGame: true });
      total++;
      if (pathStr(s, r.path) === shot) found++;
    }
  }
  console.log(`  level 3 found its shot in ${found}/${total} searches`);
  assert.ok(found >= total * 0.75 && found < total, `${found}/${total}`);
});

// ------------------------------------------------------------------ promotion
const PROMOTE = [
  ['russian', { w: ['c7', 'a1'], b: ['h4', 'h6'] }],
  ['english', { w: ['c7', 'a1'], b: ['h4', 'h6'] }],
  ['italian', { w: ['d7', 'h1'], b: ['a4', 'a6'] }],
  ['turkish', { w: ['d7', 'a2', 'b2'], b: ['h4', 'g5'] }],
];
for (const [id, pieces] of PROMOTE) {
  test(`${id}: promotes when the way is free`, () => {
    const s = place(id, 1, pieces);
    assert.ok(E.legalMoves(s).some((m) => m.promotion));
    for (const level of STRONG) {
      const { move } = aiMove(s, level);
      assert.ok(move && move.promotion, `level ${level} played ${E.moveToString(id, move)}`);
    }
  });
}

// ------------------------------------------------------------------ mate (win) scoring by distance
test('russian: wins at once when it can (capture the last pieces), mate score = 1 ply', () => {
  // King a1 can take c3 and e5 in one move (game over); the man f4 could take only e5.
  const s = place('russian', 1, { W: ['a1'], w: ['f4'], b: ['c3', 'e5'] });
  const legal = E.legalMoves(s).map((m) => E.moveToString('russian', m));
  assert.ok(legal.includes('f4:d6'));
  for (const level of STRONG) {
    const { r, move } = aiMove(s, level);
    assert.equal(move.captures.length, 2, `level ${level}: ${E.moveToString('russian', move)}`);
    assert.ok(r.score > MATE_BOUND);
    assert.equal(r.mate, 1);
  }
});

test('english: sees a forced win a few plies deep and reports it as mate', () => {
  // white K c5 + man; black single man a7 → can be trapped/captured; mate within the horizon
  const s = place('english', 1, { W: ['d6'], w: ['b4'], b: ['a7'] });
  const { r } = aiMove(s, 5);
  assert.ok(r.score > MATE_BOUND, `score ${r.score}`);
  assert.ok(r.mate > 0 && r.mate < 30);
});

// ------------------------------------------------------------------ giveaway
test('giveaway (russian): gives the last piece away to win immediately', () => {
  // white's only man c3: c3-d4 forces e5:c3 → white has no pieces → white WINS
  const s = place('russian', 1, { w: ['c3'], b: ['e5', 'a7', 'h8'] }, { giveaway: true });
  for (const level of STRONG) {
    const { r, str } = aiMove(s, level);
    assert.equal(str, 'c3-d4', `level ${level}`);
    assert.ok(r.score > MATE_BOUND && r.mate === 2, `score ${r.score}`);
  }
});

// Positions where the independent brute force (material, inverted) prefers one move by ≥ 2 men
// at depths 6, 8 and 10. A move the AI proves to be a forced win is accepted as well.
const GIVEAWAY = [
  ['russian', 'w:.......b/......../.......b/......../...w...w/......../.......w/........|giveaway', 'h4-g5'],
  ['russian', 'w:......../b......./.......b/..b...b./......../w......./.....w../........|giveaway', 'a3-b4'],
  ['english', 'w:......../......../......../....b.../.......b/w.w...../.w.w..../........|giveaway', 'c3-d4'],
  ['turkish', 'w:...b..../......../......../.b....../w......./....w..w/......../........|giveaway', 'a4-b4'],
  ['turkish', 'w:......../....b.../......../....w.../...w..b./......../......../.....w..|giveaway', 'e5-e6'],
];
for (const [id, pos, expected] of GIVEAWAY) {
  test(`giveaway ${id}: plays the losing-is-winning move ${expected}`, () => {
    const s = E.stateFromString(id, pos);
    assert.ok(s.options.giveaway);
    const bm = bruteMoves(s, 8);
    const sorted = [...bm].sort((x, y) => y[1] - x[1]);
    assert.equal(sorted[0][0], expected, `brute force: ${sorted}`);
    assert.ok(sorted[0][1] - sorted[1][1] >= 2);
    for (const level of STRONG) {
      const { r, str } = aiMove(s, level);
      assert.ok(str === expected || r.score > MATE_BOUND, `level ${level}: ${str} (${r.score})`);
    }
  });
}

// ------------------------------------------------------------------ repetition awareness
test('repetition: avoids repeating a game position when winning, seeks it when losing', () => {
  // White (kings b2, c1) against a lone black man: winning. If the position after White's
  // natural move already occurred in the game, a different move is chosen.
  const s = E.stateFromString('russian', 'w:......../......../...b..../......../......../......../.W....../..W.....', {
    counters: { quiet: 10 },
  });
  const r1 = search(s, { level: 4, timeMs: 30000, maxNodes: 200000, seed: 1, newGame: true });
  assert.ok(r1.score > 100, `white is winning (${r1.score})`);
  const after = E.applyMove(s, E.findMove(E.legalMoves(s), r1.path));
  const r2 = search(s, { level: 4, timeMs: 30000, maxNodes: 200000, seed: 1, newGame: true, historyHashes: [E.hashState(after), E.hashState(s)] });
  assert.notDeepEqual(r2.path, r1.path, 'the winning side avoids the repetition');
  assert.ok(r2.score > 100);

  // Black: a lone king against four kings is lost — a repetition is welcome.
  const sb = E.stateFromString('russian', 'b:.....B../......../......../......../......../W......./.......W/..W.W...', {
    counters: { quiet: 10 },
  });
  const base = search(sb, { level: 4, timeMs: 30000, maxNodes: 200000, seed: 1, newGame: true });
  assert.ok(base.score < -100, `black is losing (${base.score})`);
  const moves = E.legalMoves(sb);
  const target = moves.find((m) => !E.findMove([m], base.path));
  const afterB = E.applyMove(sb, target);
  const r3 = search(sb, { level: 4, timeMs: 30000, maxNodes: 200000, seed: 1, newGame: true, historyHashes: [E.hashState(afterB), E.hashState(sb)] });
  assert.deepEqual(r3.path, target.path, 'the losing side goes for the repetition');
  // a draw score: no contempt in an ending, 2 × (own − opponent's pieces) tie-break = 2 × (1 − 4)
  assert.equal(r3.score, -6);
});
