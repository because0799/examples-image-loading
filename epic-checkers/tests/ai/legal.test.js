// The AI must always return a legal path (from legalMoves(state)), for every variant, with and
// without giveaway, at every level — including odd positions (forced moves, no moves, kings only).
import test from 'node:test';
import assert from 'node:assert/strict';
import { E, rng, randomState, isLegal, place } from './helpers.js';
import { search, evaluateState, MATE } from '../../src/ai/search.js';

const PER_VARIANT = Number(process.env.AI_LEGAL || 24);

for (const giveaway of [false, true]) {
  test(`legal moves from random positions, all variants${giveaway ? ' (giveaway)' : ''}`, () => {
    const rand = rng(giveaway ? 4242 : 2424);
    let searched = 0;
    for (const v of E.VARIANTS) {
      for (let k = 0; k < PER_VARIANT; k++) {
        const s = randomState(v.id, rand, { giveaway });
        const moves = E.legalMoves(s);
        const level = 1 + (k % 5);
        const r = search(s, { level, timeMs: 15, seed: k, historyHashes: [E.hashState(s)] });
        if (moves.length === 0) {
          assert.equal(r.path, null, `${v.id}: no legal move → null path`);
          continue;
        }
        assert.ok(isLegal(s, r.path), `${v.id} L${level}: illegal ${JSON.stringify(r.path)} in ${E.stateToString(s)}`);
        assert.ok(Number.isFinite(r.score) && Number.isFinite(r.nodes) && Number.isFinite(r.depth));
        searched++;
      }
    }
    assert.ok(searched > PER_VARIANT * E.VARIANTS.length * 0.8);
  });
}

test('legal moves along random games at every level (start positions and later)', () => {
  const rand = rng(77);
  for (const v of E.VARIANTS) {
    const g = new E.Game(v.id, { giveaway: v.id === 'pool' });
    for (let ply = 0; ply < 30 && !g.over; ply++) {
      const level = 1 + (ply % 5);
      const r = search(g.state, { level, timeMs: 10, historyHashes: g.hashes, seed: ply });
      assert.ok(isLegal(g.state, r.path), `${v.id} ply ${ply}`);
      // alternate AI moves and random moves to reach varied positions
      if (rand() < 0.5) g.play(r.path);
      else g.play(g.moves[Math.floor(rand() * g.moves.length)]);
    }
  }
});

test('exactly one legal move: returned immediately without searching', () => {
  // Russian: white man c3 must capture d4 (only move)
  const s = place('russian', 1, { w: ['c3'], b: ['d4', 'h8'] });
  assert.equal(E.legalMoves(s).length, 1);
  const r = search(s, { level: 5 });
  assert.equal(r.nodes, 0);
  assert.equal(r.forced, true);
  assert.ok(isLegal(s, r.path));
  assert.ok(r.timeMs < 50, `took ${r.timeMs} ms`);
});

test('no legal move: path null, score reflects loss (or win in giveaway)', () => {
  // English: the white man a1 is blocked by black men b2 + c3 (no step, no jump)
  const blocked = 'w:......../......../......../......../......../..b...../.b....../w.......';
  const s = E.stateFromString('english', blocked);
  assert.equal(E.legalMoves(s).length, 0);
  const r = search(s, { level: 3 });
  assert.equal(r.path, null);
  assert.equal(r.score, -MATE);
  const sg = E.stateFromString('english', `${blocked}|giveaway`);
  const rg = search(sg, { level: 3 });
  assert.equal(rg.path, null);
  assert.equal(rg.score, MATE, 'blocked side wins in giveaway');
});

test('garbage / foreign history hashes are ignored', () => {
  const s = E.createInitialState('turkish');
  const r = search(s, { level: 2, historyHashes: ['nonsense', 42, null, E.hashState(E.createInitialState('russian'))] });
  assert.ok(isLegal(s, r.path));
});

test('deterministic with a seed and a node limit', () => {
  const s = E.createInitialState('russian');
  const a = search(s, { level: 3, maxNodes: 20000, timeMs: 60000, seed: 9, newGame: true });
  const b = search(s, { level: 3, maxNodes: 20000, timeMs: 60000, seed: 9, newGame: true });
  assert.deepEqual(a.path, b.path);
  assert.equal(a.score, b.score);
  assert.equal(a.nodes, b.nodes);
});

test('evaluateState: symmetric start, material-dominated, giveaway inverted', () => {
  for (const v of E.VARIANTS) assert.equal(evaluateState(E.createInitialState(v.id)), 0, `${v.id} start is balanced`);
  const up = place('russian', 1, { w: ['c3', 'e3', 'g3'], b: ['d6', 'f6'] });
  assert.ok(evaluateState(up) > 60, 'a man up is clearly better');
  const upGw = place('russian', 1, { w: ['c3', 'e3', 'g3'], b: ['d6', 'f6'] }, { giveaway: true });
  assert.ok(evaluateState(upGw) < -60, 'in giveaway an extra man is a burden');
});
