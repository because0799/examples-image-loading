// The human-like levels (levels.js LEVEL_PARAMS + search.js chooseHumanMove): every kind of error
// happens at about the rate the level asks for and stays within its bounds, the beginner's random
// moves are "safe", the casual level does not see an opponent's 2-for-1 shot coming while the
// club level does, the full-strength levels 4–5 do not use the error model, and the deliberately blind
// scores of a weak level never leak into a full-strength search through the shared table.
import test from 'node:test';
import assert from 'node:assert/strict';
import { E, rng } from './helpers.js';
import { search, chooseHumanMove, resetSearch } from '../../src/ai/search.js';
import { LEVEL_PARAMS, levelParams } from '../../src/ai/levels.js';

// ------------------------------------------------------------------ the error model on synthetic scores
const N = 4000;

function tally(byDepth, depth, P, seed, safe = null) {
  const r = rng(seed);
  const all = byDepth[depth].map((v, k) => k);
  const kinds = {};
  const picks = new Array(byDepth[depth].length).fill(0);
  for (let i = 0; i < N; i++) {
    const c = chooseHumanMove(byDepth, depth, P, r, safe || (() => all));
    kinds[c.kind] = (kinds[c.kind] || 0) + 1;
    picks[c.k]++;
  }
  return { rate: (kind) => (kinds[kind] || 0) / N, share: (ks) => ks.reduce((s, k) => s + picks[k], 0) / N, picks };
}

// six root moves: deep (full-depth) scores and the first impression (depth 1)
const DEEP = [60, 50, 20, -40, -120, -350];
const GLANCE = [10, 20, 45, -30, -100, -300]; // looks best: move 2 (really 40 worse than move 0)

test('level 1: about 35 % random moves, only among the safe ones', () => {
  const P = levelParams(1);
  assert.equal(P.random, 0.35);
  const t = tally([, DEEP], 1, P, 1);
  // a random pick is reported as such unless it hits the best move (1 of 6)
  assert.ok(Math.abs(t.rate('random') - 0.35 * (5 / 6)) < 0.03, `random ${t.rate('random')}`);
  // the "safe" pool is all the beginner looks at: moves 3 and 4 only
  const s = tally([, DEEP], 1, P, 2, () => [3, 4]);
  assert.ok(Math.abs(s.share([3, 4]) - 0.35) < 0.03, `safe-pool picks ${s.share([3, 4])}`);
  assert.equal(s.picks[5], 0, 'the clearly losing move 5 is never chosen by noise');
});

test('level 2: ~15 % slips among the next-best moves, never a big one', () => {
  const P = levelParams(2);
  const t = tally([, GLANCE, DEEP], 2, P, 3);
  assert.ok(Math.abs(t.rate('slip') - P.slip) < 0.03, `slip ${t.rate('slip')}`);
  // slips stay within slipMaxLoss (moves 1 and 2 here); noise rarely costs more than a little
  assert.equal(t.picks[4] + t.picks[5], 0);
  assert.ok(t.share([3]) < 0.01, `move 3 (−100) ${t.share([3])}`);
  assert.ok(t.share([0]) > 0.45, 'mostly the best move (move 1 is only 10 behind: noisy judgement)');
});

test('level 3: often trusts a first impression (glance rate); notices a refuted one', () => {
  const P = levelParams(3);
  const byDepth = [, GLANCE, DEEP, DEEP, DEEP];
  const t = tally(byDepth, 4, P, 4);
  // the first impression (move 2, sometimes 1) differs from the calculated best move 0
  assert.ok(Math.abs(t.rate('glance') - P.glance) < 0.04, `glance ${t.rate('glance')}`);
  assert.ok(t.share([3, 4, 5]) < 0.005);
  // a first impression the calculation refutes by more than glanceMaxLoss is not played
  const trap = [, [0, 0, 0, 0, 0, 200], DEEP, DEEP, DEEP];
  const u = tally(trap, 4, P, 5);
  assert.equal(u.picks[5], 0, 'the refuted move (−410) is never played');
  // with the error model off the level plays its best move every time
  const calc = levelParams(3, false, { glance: 0, noise: 0 });
  assert.equal(tally(byDepth, 4, calc, 6).share([0]), 1);
});

test('levels 4–5 are full searches without the error model, only a tiny evaluation jitter', () => {
  for (const l of [4, 5]) {
    const p = levelParams(l);
    for (const k of ['random', 'glance', 'slip', 'noise']) assert.equal(p[k], 0, `level ${l} ${k}`);
    assert.equal(p.multiPV, false);
    assert.ok(p.jitter > 0 && p.jitter <= 5 && p.jitter < levelParams(3).jitter);
    const t = tally([, GLANCE, DEEP, DEEP, DEEP], 4, p, 7);
    assert.equal(t.share([0]), 1);
  }
  assert.ok(LEVEL_PARAMS[4].timeMs < LEVEL_PARAMS[5].timeMs);
  // the depth caps grow with the level; levels 1–2 do not follow capture sequences to the end
  const depth = [1, 2, 3, 4, 5].map((l) => LEVEL_PARAMS[l].maxDepth);
  for (let i = 1; i < 5; i++) assert.ok(depth[i] > depth[i - 1] || depth[i] === 60, `level ${i + 1} depth`);
  assert.ok(LEVEL_PARAMS[1].qMax < Infinity && LEVEL_PARAMS[2].qMax < Infinity);
  for (const l of [3, 4, 5]) assert.equal(LEVEL_PARAMS[l].qMax, Infinity);
});

test('levelParams: giveaway overrides and explicit overrides', () => {
  const p = levelParams(3, true, { noise: 0 });
  assert.equal(p.noise, 0);
  assert.equal(p.giveaway, undefined);
  assert.equal(levelParams(9).maxDepth, LEVEL_PARAMS[5].maxDepth, 'clamped to level 5');
  for (const l of [1, 2, 3, 4, 5]) {
    const g = levelParams(l, true);
    for (const [k, v] of Object.entries(LEVEL_PARAMS[l].giveaway)) assert.equal(g[k], v, `level ${l} ${k}`);
  }
});

// ------------------------------------------------------------------ rates on real positions
/** Midgame positions reached by seeded random play (≥ 3 legal moves, no capture pending). */
function positions(id, count, seed) {
  const out = [];
  const r = rng(seed);
  for (let attempt = 0; out.length < count && attempt < count * 20; attempt++) {
    const g = new E.Game(id);
    const plies = 6 + Math.floor(r() * 24);
    for (let i = 0; i < plies && !g.result; i++) g.play(g.moves[Math.floor(r() * g.moves.length)]);
    if (!g.result && g.moves.length >= 3 && !g.moves[0].captures.length) out.push(g.state);
  }
  return out;
}

const VARIANTS = ['russian', 'turkish', 'english', 'international'];
const POS = VARIANTS.flatMap((id, i) => positions(id, 30, 100 + i));

function errorRates(level, extra = {}) {
  let n = 0;
  let small = 0;
  let big = 0;
  let unsafeRandom = 0;
  POS.forEach((s, i) => {
    const r = search(s, { level, timeMs: 60000, seed: 1000 + i, newGame: i === 0, ...extra });
    assert.ok(E.findMove(E.legalMoves(s), r.path), 'legal');
    const loss = r.bestScore - r.score;
    assert.ok(loss >= 0);
    n++;
    if (loss >= 15) small++;
    if (loss >= 90) big++;
    if (r.choice === 'random') {
      // a random move of the beginner never leaves the moved piece en prise when it had a choice
      const m = E.findMove(E.legalMoves(s), r.path);
      const replies = E.legalMoves(E.applyMove(s, m));
      if (replies.some((x) => x.captures.includes(m.to))) {
        const anySafe = E.legalMoves(s).some((mm) => !E.legalMoves(E.applyMove(s, mm)).some((x) => x.captures.includes(mm.to)));
        if (anySafe) unsafeRandom++;
      }
    }
  });
  return { n, small: small / n, big: big / n, unsafeRandom };
}

test('error rates on real positions: suboptimal moves become rarer with every level', () => {
  const rates = {};
  for (const level of [1, 2, 3]) rates[level] = errorRates(level);
  // level 4 thinks ~0.8 s; a node budget keeps this test short (the rate does not depend on it)
  rates[4] = errorRates(4, { maxNodes: 30000 });
  rates[5] = errorRates(5, { maxNodes: 30000 });
  console.log(
    `  moves worse than the level's own best by ≥ 0.15 / ≥ 0.9 man: ${[1, 2, 3, 4, 5]
      .map((l) => `L${l} ${(rates[l].small * 100).toFixed(1)} / ${(rates[l].big * 100).toFixed(1)} %`)
      .join(', ')} (${POS.length} positions)`,
  );
  assert.equal(rates[1].unsafeRandom, 0, 'random moves of level 1 are safe');
  assert.ok(rates[1].small >= 0.15 && rates[1].small <= 0.5, 'level 1: many loose moves');
  assert.ok(rates[2].small >= 0.04 && rates[2].small <= 0.25, 'level 2: ~15 % slips (some within 0.15 man)');
  assert.ok(rates[2].big <= 0.03, 'level 2: its slips are small by its own judgement');
  assert.ok(rates[3].small >= 0.03 && rates[3].small <= 0.2, 'level 3: occasional inaccuracies');
  assert.equal(rates[4].small, 0, 'level 4: none (full search)');
  assert.equal(rates[5].small, 0, 'level 5: none');
});

// ------------------------------------------------------------------ tactical vision
// Black to move. In each position one natural-looking move walks into White's 2-for-1 shot
// (verified by tests/ai/tactics.test.js's brute force: the shot positions there are the same
// with White to move). Levels 1–2 do not see it coming, levels 3+ do.
const SHOT_COMING = [
  ['russian', 'b:......../....b.../.b...b.b/b......./...w.w.b/......../.....w.w/......w.', 'e7-d6'],
  ['turkish', 'b:b.....b./...b...b/.b....../...w..../ww.b...w/......../......../.....w..', 'a8-b8'],
];

for (const [id, pos, blunder] of SHOT_COMING) {
  test(`${id}: levels 1–2 do not see the opponent's shot after ${blunder}, levels 3–5 do`, () => {
    const s = E.stateFromString(id, pos);
    const path = E.findMove(E.legalMoves(s), E.parseMove(id, blunder)).path;
    for (const level of [1, 2, 3, 4, 5]) {
      const r = search(s, { level, allScores: true, timeMs: 60000, maxDepth: level >= 4 ? 7 : undefined, seed: 1, newGame: true });
      const best = r.scores[0].score;
      const mine = r.scores.find((x) => JSON.stringify(x.path) === JSON.stringify(path)).score;
      if (level <= 2) assert.ok(best - mine <= 40, `level ${level} sees nothing wrong with ${blunder} (${mine} vs ${best})`);
      else assert.ok(best - mine >= 150, `level ${level} sees the shot (${mine} vs ${best})`);
    }
  });
}

test('a weak level’s blind scores never leak into a full-strength search (TT salt)', () => {
  const s = E.stateFromString('russian', SHOT_COMING[0][1]);
  const opts = { level: 4, allScores: true, maxDepth: 3, timeMs: 60000, seed: 5 };
  const fresh = search(s, { ...opts, newGame: true }).scores;
  resetSearch();
  search(s, { level: 2, allScores: true, timeMs: 60000, seed: 5 }); // fills the table with depth-2, capture-limited scores
  const after = search(s, opts).scores;
  assert.deepEqual(after, fresh);
  // control: the same search made as blind as level 2 rates the blunder as harmless
  const blind = search(s, { ...opts, maxDepth: 2, params: { qMax: 1, threatExt: 1 } }).scores;
  const path = E.findMove(E.legalMoves(s), E.parseMove('russian', 'e7-d6')).path;
  const sc = (arr) => arr.find((x) => JSON.stringify(x.path) === JSON.stringify(path)).score;
  assert.ok(sc(fresh) < sc(blind) - 150);
});
