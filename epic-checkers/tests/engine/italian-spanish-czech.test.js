// Italian, Spanish and Czech draughts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { E, place, assertMoves, moveStrs } from './util.js';

const IT = 'italian';
const ES = 'spanish';
const CZ = 'czech';

// ---- Italian ----------------------------------------------------------------------------------

test('italian: mirrored board — first moves', () => {
  const s = E.createInitialState(IT);
  // white front row: a3? no — b3, d3, f3, h3 are the playing squares of rank 3
  assert.deepEqual(moveStrs(s), ['b3-a4', 'b3-c4', 'd3-c4', 'd3-e4', 'f3-e4', 'f3-g4', 'h3-g4']);
  assert.equal(E.parseSquare(IT, 'a1'), -1);
  assert.notEqual(E.parseSquare(IT, 'h1'), -1);
});

test('italian: a man can never capture a king', () => {
  assertMoves(place(IT, 1, { w: ['c4'], B: ['d5'] }), ['c4-b5']);
  assertMoves(place(IT, 1, { w: ['c4'], b: ['d5'] }), ['c4:e6']);
  // a man's sequence stops in front of a king
  assertMoves(place(IT, 1, { w: ['c4'], b: ['d5'], B: ['f7'] }), ['c4:e6']);
  // a king may capture a king
  assertMoves(place(IT, 1, { W: ['c4'], B: ['d5'] }), ['c4:e6']);
});

test('italian: men move and capture only forward; kings are short', () => {
  assertMoves(place(IT, 1, { w: ['d5'], b: ['c4', 'a8'] }), ['d5-c6', 'd5-e6']);
  assertMoves(place(IT, 1, { W: ['d5'], b: ['a8'] }), ['d5-c6', 'd5-e6', 'd5-c4', 'd5-e4']);
  assertMoves(place(IT, 1, { W: ['d5'], b: ['c4', 'a8'] }), ['d5:b3']);
  assertMoves(place(IT, 1, { W: ['d5'], b: ['f7', 'a8'] }), ['d5-c6', 'd5-e6', 'd5-c4', 'd5-e4']);
});

test('italian priority 1: capture the most pieces', () => {
  // man takes two (d5, f7), king takes one (f3)
  const s = place(IT, 1, { w: ['c4'], W: ['e2'], b: ['d5', 'f7', 'f3'] });
  const ms = E.legalMoves(s);
  assert.deepEqual(moveStrs(s, ms), ['c4:e6:g8']);
  assert.equal(ms[0].promotion, true);
});

test('italian priority 2: with equal counts, capture with the king', () => {
  assertMoves(place(IT, 1, { w: ['c4'], W: ['e2'], b: ['d5', 'f3'] }), ['e2:g4']);
});

test('italian priority 3: capture the most kings', () => {
  assertMoves(place(IT, 1, { W: ['e2'], b: ['f3'], B: ['d3'] }), ['e2:c4']);
});

test('italian priority 4: capture the king as early as possible', () => {
  // A: e4 x d5(K) -> c6 x b7 -> a8   [king first]
  // B: e4 x f5 -> g6 x f7(K) -> e8   [king second]
  assertMoves(place(IT, 1, { W: ['e4'], B: ['d5', 'f7'], b: ['b7', 'f5'] }), ['e4:c6:a8']);
});

test('italian: promotion on the last row ends the move', () => {
  const s = place(IT, 1, { w: ['d7'], b: ['a8'] });
  const ms = E.legalMoves(s);
  assert.deepEqual(moveStrs(s, ms), ['d7-c8', 'd7-e8']);
  assert.ok(ms.every((m) => m.promotion && m.promotionAt === 1));
});

// ---- Spanish ----------------------------------------------------------------------------------

test('spanish: mirrored board like Italian, white starts', () => {
  const s = E.createInitialState(ES);
  assert.equal(s.turn, 1);
  assert.deepEqual(moveStrs(s), ['b3-a4', 'b3-c4', 'd3-c4', 'd3-e4', 'f3-e4', 'f3-g4', 'h3-g4']);
});

test('spanish: flying kings, men capture only forward', () => {
  assertMoves(place(ES, 1, { W: ['b1'], b: ['e4'] }), ['b1:f5', 'b1:g6', 'b1:h7']);
  assertMoves(place(ES, 1, { w: ['d5'], b: ['c4', 'a8'] }), ['d5-c6', 'd5-e6']);
  // must land where the capture continues
  assertMoves(place(ES, 1, { W: ['b1'], b: ['e4', 'e6'] }), ['b1:f5:d7', 'b1:f5:c8']);
});

test('spanish: law of quantity — the man taking two beats the king taking one', () => {
  const s = place(ES, 1, { W: ['c8'], w: ['d7', 'e2'], b: ['b7', 'f3', 'f5'] });
  assertMoves(s, ['e2:g4:e6']);
});

test('spanish: law of quality — with equal counts take the most kings (men may take kings)', () => {
  const pieces = { w: ['c4', 'g4'], b: ['d5'], B: ['f5'] };
  assertMoves(place(ES, 1, pieces), ['g4:e6']);
  // in Italian the man g4 could not take the king at all
  assertMoves(place(IT, 1, pieces), ['c4:e6']);
});

test('spanish: promotion ends the move (no continuation as a king)', () => {
  const s = place(ES, 1, { w: ['c6'], b: ['d7', 'f7'] });
  const ms = E.legalMoves(s);
  assert.deepEqual(moveStrs(s, ms), ['c6:e8']);
  assert.equal(ms[0].promotion, true);
});

test('spanish: Turkish strike for the flying king', () => {
  assertMoves(place(ES, 1, { W: ['e4'], b: ['f5', 'd3'] }), ['e4:g6', 'e4:h7', 'e4:c2', 'e4:b1']);
});

// ---- Czech ------------------------------------------------------------------------------------

test('czech: if a king can capture, a king must capture', () => {
  assertMoves(place(CZ, 1, { w: ['c3'], W: ['h8'], b: ['d4', 'g7'] }), ['h8:f6', 'h8:e5']);
  // Russian rules allow the man too
  assertMoves(place('russian', 1, { w: ['c3'], W: ['h8'], b: ['d4', 'g7'] }), ['c3:e5', 'h8:f6', 'h8:e5']);
});

test('czech: the king captures even if a man could take more', () => {
  assertMoves(place(CZ, 1, { W: ['a7'], w: ['e1'], b: ['b6', 'e3', 'f2', 'f4'] }), ['a7:c5', 'a7:d4']);
});

test('czech: free choice among the king captures (no majority rule)', () => {
  assertMoves(place(CZ, 1, { W: ['d4'], b: ['e5', 'c5', 'c7'] }), ['d4:f6', 'd4:g7', 'd4:h8', 'd4:b6:d8']);
});

test('czech: men move and capture only forward; promotion ends the move', () => {
  assertMoves(place(CZ, 1, { w: ['d4'], b: ['c3', 'a7'] }), ['d4-c5', 'd4-e5']);
  const s = place(CZ, 1, { w: ['b6'], b: ['c7', 'e7'] });
  const ms = E.legalMoves(s);
  assert.deepEqual(moveStrs(s, ms), ['b6:d8']);
  assert.equal(ms[0].promotion, true);
});

test('czech: Turkish strike', () => {
  assertMoves(place(CZ, 1, { W: ['d4'], b: ['e5', 'b2'] }), ['d4:f6', 'd4:g7', 'd4:h8', 'd4:a1']);
});
