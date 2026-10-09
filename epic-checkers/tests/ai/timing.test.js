// Time limits: every level stays within its budget (level 5 ≤ ~3 s per move in Node), explicit
// timeMs overrides and depth caps are honoured, pathological capture-heavy positions do not
// hang. Reports nodes per second. Margins leave room for a busy machine (other processes can
// deschedule this one); the search itself stops at its deadline within a few ms.
import test from 'node:test';
import assert from 'node:assert/strict';
import { E, isLegal } from './helpers.js';
import { search } from '../../src/ai/search.js';
import { LEVEL_PARAMS } from '../../src/ai/levels.js';

/** A position after `plies` seeded pseudo-random moves that still offers at least 3 moves. */
function midgame(id, plies, seed) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const g = new E.Game(id);
    let s = seed + attempt * 7919;
    for (let i = 0; i < plies && !g.over; i++) {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      const moves = g.moves;
      g.play(moves[(s >>> 8) % moves.length]);
    }
    if (!g.over && g.moves.length >= 3) return g;
  }
  throw new Error('no suitable midgame position');
}

/** Board from a predicate (r, c) → code (only on playable squares). */
function build(id, turn, fn) {
  const v = E.getVariant(id);
  const n = v.size;
  const board = new Array(n * n).fill(0);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (E.isPlayableSquare(v, r, c)) board[r * n + c] = fn(r, c) || 0;
  return E.deserializeState({ variantId: id, board, turn });
}

test('level 5 (≈2.5 s) stays under 3 s per move; nodes/sec report', () => {
  const cases = [
    ['russian start', E.createInitialState('russian')],
    ['turkish midgame', midgame('turkish', 20, 5).state],
    ['international start', E.createInitialState('international')],
    ['canadian midgame', midgame('canadian', 16, 9).state],
  ];
  const report = [];
  for (const [name, s] of cases) {
    const t0 = performance.now();
    const r = search(s, { level: 5, newGame: true });
    const wall = performance.now() - t0;
    assert.ok(isLegal(s, r.path), name);
    assert.ok(wall <= 3100, `${name}: ${wall.toFixed(0)} ms`);
    assert.ok(r.depth >= 6, `${name}: reached depth ${r.depth}`);
    report.push(`${name}: ${wall.toFixed(0)} ms, depth ${r.depth}/${r.selDepth}, ${r.nodes} nodes, ${r.nps} nodes/s`);
  }
  console.log(`  level 5 → ${report.join(' | ')}`);
});

test('levels 1–4 respect their budgets', () => {
  const s = midgame('russian', 14, 3).state;
  for (const level of [1, 2, 3, 4]) {
    const t0 = performance.now();
    const r = search(s, { level, newGame: true, seed: level });
    const wall = performance.now() - t0;
    const budget = LEVEL_PARAMS[level].timeMs;
    assert.ok(isLegal(s, r.path));
    assert.ok(wall <= budget + 250, `level ${level}: ${wall.toFixed(0)} ms > ${budget} ms`);
    console.log(`  level ${level}: ${wall.toFixed(0)} ms (budget ${budget}), depth ${r.depth}, ${r.nps} nodes/s`);
  }
});

test('timeMs override and maxDepth are honoured', () => {
  const s = midgame('canadian', 30, 11).state;
  const t0 = performance.now();
  const r = search(s, { level: 5, timeMs: 50 });
  const wall = performance.now() - t0;
  assert.ok(isLegal(s, r.path));
  assert.ok(wall < 350, `timeMs 50 → ${wall.toFixed(0)} ms`);
  const d = search(E.createInitialState('russian'), { level: 5, maxDepth: 3, timeMs: 10000 });
  assert.ok(d.depth <= 3);
});

test('capture-heavy positions (flying kings, Turkish dama) do not hang', () => {
  // Turkish: white kings facing a checkerboard of black men → huge capture trees
  const turk = build('turkish', 1, (r, c) => {
    if (r === 6 && (c === 0 || c === 3 || c === 7)) return 2;
    if (r >= 1 && r <= 4 && (r + c) % 2 === 0) return -1;
    return 0;
  });
  // International: flying kings against rows of black men with gaps between them
  const intl = build('international', 1, (r, c) => {
    if (r === 8 && (c === 1 || c === 5 || c === 9)) return 2;
    if (r === 1 || r === 3 || r === 5) return -1;
    return 0;
  });
  for (const [name, s] of [
    ['turkish', turk],
    ['international', intl],
  ]) {
    const moves = E.legalMoves(s);
    assert.ok(moves.length > 0);
    const t0 = performance.now();
    const r = search(s, { level: 5, timeMs: 300 });
    const wall = performance.now() - t0;
    assert.ok(isLegal(s, r.path), name);
    assert.ok(wall < 1200, `${name}: ${wall.toFixed(0)} ms`);
    console.log(`  ${name} capture storm: ${moves.length} root moves (${moves[0].captures.length} captured), ${wall.toFixed(0)} ms`);
  }
});
