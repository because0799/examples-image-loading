// English draughts (checkers) and American pool checkers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { E, place, assertMoves, moveStrs } from './util.js';

const EN = 'english';
const P = 'pool';

test('english: dark (black) moves first, downwards', () => {
  const s = E.createInitialState(EN);
  assert.equal(s.turn, -1);
  assert.deepEqual(moveStrs(s), ['b6-a5', 'b6-c5', 'd6-c5', 'd6-e5', 'f6-e5', 'f6-g5', 'h6-g5']);
});

test('english: men capture forward only', () => {
  // the black man behind d4 cannot be captured
  assertMoves(place(EN, 1, { w: ['d4'], b: ['c3', 'a7'] }), ['d4-c5', 'd4-e5']);
  // black captures downwards only
  assertMoves(place(EN, -1, { w: ['d4', 'h2'], b: ['e5'] }), ['e5:c3']);
  assertMoves(place(EN, -1, { w: ['f6', 'h2'], b: ['e5'] }), ['e5-d4', 'e5-f4']);
});

test('english: a man reaching the king row is crowned and the move ends', () => {
  const s = place(EN, 1, { w: ['b6'], b: ['c7', 'e7'] });
  const ms = E.legalMoves(s);
  assert.deepEqual(moveStrs(s, ms), ['b6:d8']);
  assert.equal(ms[0].promotion, true);
  assert.equal(ms[0].promotionAt, 1);
  const after = E.applyMove(s, ms[0]);
  assert.equal(after.board[E.parseSquare(EN, 'd8')], 2);
  assert.equal(after.board[E.parseSquare(EN, 'e7')], -1); // e7 survives
});

test('english: kings move one square in any diagonal direction', () => {
  assertMoves(place(EN, 1, { W: ['d4'], b: ['a7'] }), ['d4-c5', 'd4-e5', 'd4-c3', 'd4-e3']);
  // a piece two squares away is not capturable by a short king
  assertMoves(place(EN, 1, { W: ['d4'], b: ['f6'] }), ['d4-c5', 'd4-e5', 'd4-c3', 'd4-e3']);
});

test('english: kings capture short, forwards and backwards, and may turn', () => {
  assertMoves(place(EN, 1, { W: ['d4'], b: ['e5', 'a7'] }), ['d4:f6']);
  assertMoves(place(EN, 1, { W: ['d4'], b: ['c3', 'a7'] }), ['d4:b2']);
  assertMoves(place(EN, 1, { W: ['a1'], b: ['b2', 'd2'] }), ['a1:c3:e1']);
});

test('english: a multi-jump must be completed, but any sequence may be chosen', () => {
  assertMoves(place(EN, 1, { w: ['c3'], b: ['d4', 'f6'] }), ['c3:e5:g7']);
  assertMoves(place(EN, 1, { w: ['c3'], b: ['b4', 'd4', 'f6'] }), ['c3:a5', 'c3:e5:g7']);
});

test('english: blocked side loses; giveaway inverts', () => {
  const s = place(EN, 1, { w: ['a1'], b: ['b2', 'c3'] }); // a1 cannot move nor capture (c3 behind b2)
  assert.deepEqual(E.legalMoves(s), []);
  assert.deepEqual(E.positionResult(s), { winner: -1, reason: 'no-moves' });
  const g = place(EN, 1, { w: ['a1'], b: ['b2', 'c3'] }, { giveaway: true });
  assert.deepEqual(E.positionResult(g), { winner: 1, reason: 'no-moves' });
});

test('pool: dark moves first; same opening as checkers', () => {
  const s = E.createInitialState(P);
  assert.equal(s.turn, -1);
  assert.equal(E.legalMoves(s).length, 7);
});

test('pool: men capture backward, kings fly and must land where the capture continues', () => {
  assertMoves(place(P, 1, { w: ['d4'], b: ['c3', 'h8'] }), ['d4:b2']);
  assertMoves(place(P, 1, { W: ['a1'], b: ['d4'] }), ['a1:e5', 'a1:f6', 'a1:g7', 'a1:h8']);
  assertMoves(place(P, 1, { W: ['a1'], b: ['d4', 'f4'] }), ['a1:e5:g3', 'a1:e5:h2']);
});

test('pool: free choice of capture (no majority rule)', () => {
  assertMoves(place(P, 1, { w: ['c3'], b: ['b4', 'd4', 'f6'] }), ['c3:a5', 'c3:e5:g7']);
});

test('pool: a man touching the king row mid-capture continues as a man and is not crowned', () => {
  const s = place(P, 1, { w: ['b6'], b: ['c7', 'e7'] });
  const ms = E.legalMoves(s);
  assert.deepEqual(moveStrs(s, ms), ['b6:d8:f6']);
  assert.equal(ms[0].promotion, false);
  assert.equal(E.applyMove(s, ms[0]).board[E.parseSquare(P, 'f6')], 1);
});

test('pool: a man ending its capture on the king row is crowned', () => {
  const s = place(P, 1, { w: ['b6'], b: ['c7', 'h2'] });
  const ms = E.legalMoves(s);
  assert.deepEqual(moveStrs(s, ms), ['b6:d8']);
  assert.equal(ms[0].promotion, true);
});

test('pool: Turkish strike — captured pieces block until the move ends', () => {
  assertMoves(place(P, 1, { W: ['d4'], b: ['e5', 'b2'] }), ['d4:f6', 'd4:g7', 'd4:h8', 'd4:a1']);
});
