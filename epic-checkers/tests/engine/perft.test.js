// Perft (move-path enumeration) from the initial positions.
// Counting convention: one node per legal move as returned by legalMoves — capture sequences
// with an identical outcome (same from, to, captured set) count once, as in the published
// draughts perft tables (no such duplicates occur at these depths anyway).
import test from 'node:test';
import assert from 'node:assert/strict';
import { E, perft } from './util.js';

// Published values.
//  English: talkchess.com "perft for 8x8 checkers" (7, 49, 302, 1469, 7361, 36768, 179740, 845931)
//  International: World Draughts Forum perft thread (9, 81, 658, 4265, 27117, 167140, 1049442, …)
//  Turkish: github.com/ardacagankeser/turkish-draughts (TÜDAF-rules engine) movegen tests
const PUBLISHED = {
  english: [7, 49, 302, 1469, 7361, 36768, 179740, 845931],
  international: [9, 81, 658, 4265, 27117, 167140, 1049442],
  turkish: [8, 64, 708, 7538, 85090],
};

// Regression values of this engine (shallow depths cross-checked against the independent
// reference generator in reference.test.js; deeper ones guard against regressions).
const REGRESSION = {
  russian: [7, 49, 302, 1469, 7482, 37986, 190146],
  pool: [7, 49, 302, 1469, 7482, 37986, 190146],
  brazilian: [7, 49, 302, 1469, 7473, 37628, 187302],
  italian: [7, 49, 302, 1469, 7361, 36473, 177532],
  spanish: [7, 49, 302, 1469, 7361, 36473, 177532],
  czech: [7, 49, 302, 1469, 7361, 36768, 179740],
  canadian: [11, 121, 1222, 10053, 79049, 584100],
};

for (const [id, values] of Object.entries({ ...PUBLISHED, ...REGRESSION })) {
  test(`perft ${id} 1..${values.length}${PUBLISHED[id] ? ' (published)' : ''}`, () => {
    const s = E.createInitialState(id);
    for (let d = 1; d <= values.length; d++) assert.equal(perft(s, d), values[d - 1], `${id} perft(${d})`);
  });
}

test('perft does not depend on the giveaway option (same move rules)', () => {
  for (const id of ['russian', 'turkish', 'english']) {
    assert.equal(perft(E.createInitialState(id, { giveaway: true }), 4), perft(E.createInitialState(id), 4));
  }
});

test('performance: English perft(6) well under 2 s', () => {
  const s = E.createInitialState('english');
  perft(s, 4); // warm-up
  const t0 = performance.now();
  assert.equal(perft(s, 6), 36768);
  const ms = performance.now() - t0;
  console.log(`  english perft(6): ${ms.toFixed(1)} ms`);
  assert.ok(ms < 2000, `perft(6) took ${ms} ms`);
});
