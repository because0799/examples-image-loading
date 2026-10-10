// Game: play / undo / repetition / resign / agreement / JSON.
import test from 'node:test';
import assert from 'node:assert/strict';
import { E, place, rng } from './util.js';

function snapshot(state) {
  return JSON.stringify(E.serializeState(state));
}

test('Game: basics, cached moves, play by Move or path', () => {
  const g = new E.Game('russian');
  assert.equal(g.variant.id, 'russian');
  assert.equal(g.state.turn, 1);
  assert.equal(g.moves.length, 7);
  assert.equal(g.moves, g.moves, 'moves are cached');
  assert.equal(g.canUndo, false);
  assert.equal(g.lastMove, null);
  assert.equal(g.result, null);
  const m1 = g.play(g.moves[2]); // c3-d4
  assert.equal(E.moveToString('russian', m1), 'c3-d4');
  assert.equal(g.lastMove, m1);
  assert.equal(g.history.length, 1);
  assert.equal(g.history[0].move, m1);
  assert.equal(g.state.turn, -1);
  const m2 = g.play(E.parseMove('russian', 'f6-e5'));
  assert.equal(E.moveToString('russian', m2), 'f6-e5');
  // now white must capture d4 x e5 -> f6
  assert.deepEqual(g.moves.map((m) => E.moveToString('russian', m)), ['d4:f6']);
  assert.throws(() => g.play(E.parseMove('russian', 'a3-b4')), /Illegal move/);
  assert.throws(() => g.play(null), /Illegal move/);
  g.play(g.moves[0]);
  assert.equal(g.hashes.length, 4);
  assert.equal(g.hashes[3], E.hashState(g.state));
});

test('Game: undo restores the exact previous states', () => {
  const g = new E.Game('turkish');
  const rand = rng(7);
  const snaps = [snapshot(g.state)];
  for (let i = 0; i < 40 && !g.result; i++) {
    g.play(g.moves[Math.floor(rand() * g.moves.length)]);
    snaps.push(snapshot(g.state));
  }
  const states = g.history.map((h) => h.before);
  while (g.history.length) {
    const expectedBefore = states[g.history.length - 1];
    assert.equal(g.undo(), true);
    assert.equal(g.state, expectedBefore);
    assert.equal(snapshot(g.state), snaps[g.history.length]);
    assert.equal(g.hashes.length, g.history.length + 1);
  }
  assert.equal(g.undo(), false);
  assert.equal(g.canUndo, false);
  assert.equal(snapshot(g.state), snaps[0]);
  assert.equal(g.moves.length, 8);
});

test('Game: threefold repetition', () => {
  // English kings shuffle: the start position occurs for the 3rd time after 8 plies
  const start = place('english', 1, { W: ['a1'], B: ['h8'] });
  const g = new E.Game('english', {}, start);
  const line = ['a1-b2', 'h8-g7', 'b2-a1', 'g7-h8'];
  for (let i = 0; i < 8; i++) {
    assert.equal(g.result, null, `ply ${i}`);
    g.play(E.parseMove('english', line[i % 4]));
    if (i === 3) assert.equal(g.repetitionCount(), 2);
  }
  assert.equal(g.repetitionCount(), 3);
  assert.deepEqual(g.result, { winner: 0, reason: 'repetition', detail: 'repetition' });
  assert.equal(g.over, true);
  assert.deepEqual(g.moves, []);
  assert.throws(() => g.play(E.parseMove('english', 'a1-b2')), /over/);
  // undo leaves the repetition
  g.undo();
  assert.equal(g.result, null);
  assert.ok(g.moves.length > 0);
});

test('Game: results from the position (win / no-moves / draw rules)', () => {
  const g = new E.Game('russian', {}, place('russian', 1, { W: ['a1'], b: ['d4'] }));
  g.play(g.moves[0]);
  assert.deepEqual(g.result, { winner: 1, reason: 'no-pieces', detail: 'no-pieces' });
  const gw = new E.Game('russian', {}, place('russian', 1, { W: ['a1'], b: ['d4'] }, { giveaway: true }));
  assert.equal(gw.options.giveaway, true);
  gw.play(gw.moves[0]);
  assert.deepEqual(gw.result, { winner: -1, reason: 'no-pieces', detail: 'no-pieces' });
  const tk = new E.Game('turkish', {}, place('turkish', 1, { W: ['a1'], b: ['a4', 'h7'] }));
  tk.play(tk.moves[0]);
  assert.deepEqual(tk.result, { winner: 0, reason: 'insufficient', detail: 'one-each' });
});

test('Game: resign and agreement; undo clears them', () => {
  const g = new E.Game('international');
  g.play(g.moves[0]);
  assert.deepEqual(g.resign(-1), { winner: 1, reason: 'resign', detail: 'resign' });
  assert.deepEqual(g.result, { winner: 1, reason: 'resign', detail: 'resign' });
  assert.deepEqual(g.moves, []);
  assert.throws(() => g.play([0, 1]), /over/);
  assert.equal(g.canUndo, true);
  g.undo(); // clears the resignation and takes back the move
  assert.equal(g.result, null);
  assert.equal(g.history.length, 0);
  assert.deepEqual(g.agreeDraw(), { winner: 0, reason: 'agreement', detail: 'agreement' });
  // resign after the game is over does not change the result
  assert.deepEqual(g.resign(1), { winner: 0, reason: 'agreement', detail: 'agreement' });
  assert.equal(g.undo(), true); // clears the agreement even with no moves
  assert.equal(g.result, null);
  assert.throws(() => g.resign(3), /color/);
});

test('Game: toJSON / fromJSON round-trip', () => {
  const rand = rng(99);
  for (const v of E.VARIANTS) {
    const g = new E.Game(v.id, { giveaway: v.id === 'italian' });
    for (let i = 0; i < 30 && !g.result; i++) g.play(g.moves[Math.floor(rand() * g.moves.length)]);
    const json = JSON.parse(JSON.stringify(g.toJSON()));
    const h = E.Game.fromJSON(json);
    assert.equal(h.variant.id, v.id);
    assert.equal(h.options.giveaway, v.id === 'italian');
    assert.equal(snapshot(h.state), snapshot(g.state));
    assert.deepEqual(h.history.map((x) => x.move.path), g.history.map((x) => x.move.path));
    assert.deepEqual(h.hashes, g.hashes);
    assert.deepEqual(h.result, g.result);
  }
  // custom start + manual result
  const start = place('pool', -1, { W: ['a1'], B: ['h8'], b: ['f8'] });
  const g = new E.Game('pool', {}, start);
  g.play(g.moves[0]);
  g.agreeDraw();
  const h = E.Game.fromJSON(JSON.parse(JSON.stringify(g)));
  assert.equal(E.stateToString(h.startState), E.stateToString(start));
  assert.deepEqual(h.result, { winner: 0, reason: 'agreement', detail: 'agreement' });
  assert.throws(() => new E.Game('russian', {}, E.createInitialState('english')), /another variant/);
});

test('Game: giveaway option flows into the state', () => {
  const g = new E.Game('english', { giveaway: true });
  assert.equal(g.state.options.giveaway, true);
  assert.ok(E.stateToString(g.state).endsWith('|giveaway'));
});
