// The level ladder in short seeded matches (both colours, balanced random openings). The full
// ladder — four variants, hundreds of games, real clocks — is measured separately (AI report);
// these matches guard its shape:
//  - level 5 crushes level 1;
//  - neighbouring levels: the stronger one wins the match, but the weaker one is not helpless —
//    it takes points off the stronger one (the ladder is a slope, not a wall).
// The depth-capped levels 1–3 get a generous clock and level 4 a node budget, so every match is
// deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { E, rng } from './helpers.js';
import { search, resetSearch } from '../../src/ai/search.js';

const GAMES = Number(process.env.AI_MATCH_GAMES || 4);
// Level 5 search with a reduced clock to keep the test short (it is still far ahead of level 1).
const L5_MS = Number(process.env.AI_MATCH_MS || 80);

/** A balanced opening: `plies` random moves, equal material, no capture pending. */
function opening(id, plies, seed) {
  const r = rng(seed);
  for (;;) {
    const g = new E.Game(id);
    for (let i = 0; i < plies && !g.result; i++) g.play(g.moves[Math.floor(r() * g.moves.length)]);
    const m = E.materialCount(g.state);
    if (!g.result && m.wm === m.bm && !g.moves[0].captures.length) return g.history.map((h) => h.move.path);
  }
}

/**
 * `pairs` openings, each played with both colours. a, b: (game, seed) → path.
 * Returns { score (of a, 0..1), W, D, L, lines }.
 */
function match(id, a, b, pairs, seed0, maxPlies = 600) {
  const t = { W: 0, D: 0, L: 0 };
  const lines = [];
  for (let p = 0; p < pairs; p++) {
    const open = opening(id, id === 'international' ? 6 : 4, seed0 + p);
    for (const aWhite of [true, false]) {
      resetSearch();
      const g = new E.Game(id);
      for (const path of open) g.play(path);
      let seed = (seed0 + p) * 1000 + (aWhite ? 0 : 500);
      while (!g.result && g.history.length < maxPlies) {
        const aMoves = (g.state.turn === 1) === aWhite;
        g.play((aMoves ? a : b)(g, seed++));
      }
      const w = g.result ? g.result.winner : 0;
      const aColor = aWhite ? 1 : -1;
      if (w === 0) t.D++;
      else if (w === aColor) t.W++;
      else t.L++;
      lines.push(`${w === 0 ? '=' : w === aColor ? '+' : '-'}${g.result ? g.result.reason : 'cap'}`);
    }
  }
  const n = t.W + t.D + t.L;
  return { ...t, score: (t.W + t.D / 2) / n, lines };
}

const level = (l, extra = {}) => (g, seed) => search(g.state, { level: l, timeMs: 60000, historyHashes: g.hashes, seed, ...extra }).path;

for (const id of ['russian', 'turkish', 'english']) {
  test(`${id}: level 5 beats level 1 (${GAMES} games, both colours)`, () => {
    let seed = 1000;
    const strong = (g) => search(g.state, { level: 5, timeMs: L5_MS, historyHashes: g.hashes, seed: seed++ }).path;
    const weak = (g) => search(g.state, { level: 1, historyHashes: g.hashes, seed: seed++ }).path;
    const tally = { strong: 0, weak: 0, draw: 0 };
    const lines = [];
    for (let i = 0; i < GAMES; i++) {
      const strongWhite = i % 2 === 0;
      const g = new E.Game(id);
      let plies = 0;
      while (!g.result && plies < 1500) {
        g.play(((g.state.turn === 1) === strongWhite ? strong : weak)(g));
        plies++;
      }
      const result = g.result;
      assert.ok(result, 'game finished');
      const strongColor = strongWhite ? 1 : -1;
      if (result.winner === 0) tally.draw++;
      else if (result.winner === strongColor) tally.strong++;
      else tally.weak++;
      lines.push(`${strongWhite ? 'L5 white' : 'L5 black'}: ${result.winner === strongColor ? 'win' : result.winner === 0 ? 'draw' : 'LOSS'} (${result.reason}, ${plies} plies)`);
    }
    console.log(`  ${id} L5 vs L1: +${tally.strong} =${tally.draw} -${tally.weak} | ${lines.join('; ')}`);
    assert.equal(tally.weak, 0, 'level 1 never wins');
    assert.ok(tally.strong >= Math.ceil(GAMES * 0.75), `level 5 wins most games (${tally.strong}/${GAMES})`);
  });
}

// Neighbouring levels: [stronger, weaker, openings per variant, lowest / highest expected score].
// The full ladder measures ~75-90 % per step; small samples get wider bounds.
const STEPS = [
  [2, 1, 8, 0.55, 0.95],
  [3, 2, 8, 0.6, 0.97],
];

for (const [hi, lo, pairs, min, max] of STEPS) {
  test(`level ${hi} beats level ${lo}, but not every game (russian + english, ${pairs * 4} games)`, () => {
    let W = 0;
    let D = 0;
    let L = 0;
    const out = [];
    for (const id of ['russian', 'english']) {
      const m = match(id, level(hi), level(lo), pairs, 7 + hi * 100);
      W += m.W;
      D += m.D;
      L += m.L;
      out.push(`${id} +${m.W} =${m.D} -${m.L}`);
    }
    const score = (W + D / 2) / (W + D + L);
    console.log(`  L${hi} vs L${lo}: ${out.join(', ')} → ${(score * 100).toFixed(1)} %`);
    assert.ok(score >= min, `level ${hi} wins the match (${(score * 100).toFixed(1)} %)`);
    assert.ok(score <= max, `level ${lo} takes points off level ${hi} (${(score * 100).toFixed(1)} %)`);
  });
}

test('level 4 beats level 3 (node-limited level 4, russian, 8 games)', () => {
  const m = match('russian', level(4, { maxNodes: 40000 }), level(3), 4, 31);
  console.log(`  L4 vs L3: +${m.W} =${m.D} -${m.L} (${m.lines.join(' ')})`);
  assert.ok(m.score >= 0.6, `${(m.score * 100).toFixed(1)} %`);
});
