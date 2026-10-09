// Russian draughts rule nuances (hand-built positions, expected moves derived by hand).
import test from 'node:test';
import assert from 'node:assert/strict';
import { E, place, assertMoves, moveStrs, mv, sq } from './util.js';

const R = 'russian';

test('russian: men move one square diagonally forward only', () => {
  assertMoves(place(R, 1, { w: ['e3'], b: ['a7'] }), ['e3-d4', 'e3-f4']);
  assertMoves(place(R, -1, { w: ['e3'], b: ['a7'] }), ['a7-b6']);
  assertMoves(place(R, -1, { w: ['h2'], b: ['d6'] }), ['d6-c5', 'd6-e5']);
});

test('russian: men capture backward (white and black)', () => {
  // white d4 jumps c3 backwards to b2; quiet moves are not allowed (capture is mandatory)
  assertMoves(place(R, 1, { w: ['d4'], b: ['c3', 'h8'] }), ['d4:b2']);
  // black e5 jumps f6 "backwards" (upwards) to g7
  assertMoves(place(R, -1, { w: ['f6', 'a1'], b: ['e5'] }), ['e5:g7']);
});

test('russian: capture move object fields', () => {
  const s = place(R, 1, { w: ['c3'], b: ['d4', 'f6', 'h8'] });
  const ms = E.legalMoves(s);
  assert.equal(ms.length, 1);
  const m = ms[0];
  assert.equal(E.moveToString(R, m), 'c3:e5:g7');
  assert.equal(m.from, sq(R, 'c3'));
  assert.equal(m.to, sq(R, 'g7'));
  assert.deepEqual(m.path, [sq(R, 'c3'), sq(R, 'e5'), sq(R, 'g7')]);
  assert.deepEqual(m.captures, [sq(R, 'd4'), sq(R, 'f6')]);
  assert.deepEqual(m.captured, [-1, -1]);
  assert.equal(m.piece, 1);
  assert.equal(m.promotion, false);
  assert.equal(m.promotionAt, -1);
  const after = E.applyMove(s, m);
  assert.equal(E.stateToString(after), 'b:.......b/......w./......../......../......../......../......../........');
});

test('russian: flying king captures from a distance and may land on any square beyond', () => {
  assertMoves(place(R, 1, { W: ['a1'], b: ['d4'] }), ['a1:e5', 'a1:f6', 'a1:g7', 'a1:h8']);
});

test('russian: flying king quiet moves', () => {
  const s = place(R, 1, { W: ['d4'], b: ['a7'] });
  // NW c5,b6 (a7 blocks, cannot be captured: nothing behind it); NE 4; SW 3; SE 3
  assert.equal(E.legalMoves(s).length, 12);
  assert.ok(E.legalMoves(s).every((m) => m.captures.length === 0));
});

test('russian: after a capture the king must land where the capture continues', () => {
  // a1 x d4 could land on e5/f6/g7/h8, but only from e5 can it continue (x f4)
  assertMoves(place(R, 1, { W: ['a1'], b: ['d4', 'f4'] }), ['a1:e5:g3', 'a1:e5:h2']);
});

test('russian: Turkish strike — captured pieces stay until the move ends, block, and cannot be jumped twice', () => {
  // King d4 can take e5 (landing f6/g7/h8) or b2 (landing a1). After taking e5 it cannot come
  // back through e5 to take b2 (e5 is still on the board), and vice versa.
  const s = place(R, 1, { W: ['d4'], b: ['e5', 'b2'] });
  assertMoves(s, ['d4:f6', 'd4:g7', 'd4:h8', 'd4:a1']);
  for (const m of E.legalMoves(s)) assert.equal(m.captures.length, 1);
});

test('russian: a man promoted during a capture continues capturing as a king', () => {
  // b6 x c7 -> d8 (promotes), then as a flying king x e7 -> f6/g5/h4
  const s = place(R, 1, { w: ['b6'], b: ['c7', 'e7'] });
  assertMoves(s, ['b6:d8:f6', 'b6:d8:g5', 'b6:d8:h4']);
  for (const m of E.legalMoves(s)) {
    assert.equal(m.promotion, true);
    assert.equal(m.promotionAt, 1);
  }
  const after = E.applyMove(s, mv(s, 'b6:d8:h4'));
  assert.equal(after.board[sq(R, 'h4')], 2);
  assert.equal(after.board[sq(R, 'c7')], 0);
  assert.equal(after.board[sq(R, 'e7')], 0);
  assert.deepEqual(E.materialCount(after), { wm: 0, wk: 1, bm: 0, bk: 0 });
});

test('russian: a man promoted mid-capture captures as a king (long range), not as a man', () => {
  // after d8 the new king takes f6 from a distance (e7 empty) — a man could not
  const s = place(R, 1, { w: ['b6'], b: ['c7', 'f6'] });
  assertMoves(s, ['b6:d8:g5', 'b6:d8:h4']);
});

test('russian: promotion at the end of a capture', () => {
  const s = place(R, 1, { w: ['b6'], b: ['c7', 'h2'] });
  const ms = E.legalMoves(s);
  assert.deepEqual(moveStrs(s, ms), ['b6:d8']);
  assert.equal(ms[0].promotion, true);
  assert.equal(ms[0].promotionAt, 1);
});

test('russian: quiet promotion and black promotion', () => {
  const s = place(R, 1, { w: ['c7'], b: ['a5'] });
  const ms = E.legalMoves(s);
  assert.deepEqual(moveStrs(s, ms), ['c7-b8', 'c7-d8']);
  assert.ok(ms.every((m) => m.promotion && m.promotionAt === 1));
  const b = place(R, -1, { w: ['h6'], b: ['b2'] });
  const bm = E.legalMoves(b);
  assert.deepEqual(moveStrs(b, bm), ['b2-a1', 'b2-c1']);
  assert.ok(bm.every((m) => m.promotion));
  assert.equal(E.applyMove(b, bm[0]).board[sq(R, 'a1')], -2);
});

test('russian: capture is mandatory but any sequence may be chosen (no majority rule)', () => {
  // c3 can take one (b4 -> a5) or two (d4, f6 -> g7); both are legal in Russian
  assertMoves(place(R, 1, { w: ['c3'], b: ['b4', 'd4', 'f6'] }), ['c3:a5', 'c3:e5:g7']);
  // ...but a started sequence must be completed: c3:e5 alone is not legal
  const s = place(R, 1, { w: ['c3'], b: ['d4', 'f6'] });
  assert.equal(E.findMove(E.legalMoves(s), E.parseMove(R, 'c3:e5')), null);
});

test('russian: king and man capture choices coexist', () => {
  // man e3 x d4 -> c5; king a1 x d4 must land on e5 (only square that continues) and take c7
  assertMoves(place(R, 1, { w: ['e3'], W: ['a1'], b: ['d4', 'c7'] }), ['e3:c5', 'a1:e5:b8']);
  // without c7 the king may land on e5/f6/g7 (h8 is occupied)
  assertMoves(place(R, 1, { w: ['e3'], W: ['a1'], b: ['d4', 'h8'] }), ['e3:c5', 'a1:e5', 'a1:f6', 'a1:g7']);
});

test('russian: giveaway — no pieces / no moves wins', () => {
  // black has no pieces left: in normal play white won; in giveaway black won
  const normal = place(R, -1, { w: ['c3'] });
  assert.deepEqual(E.positionResult(normal), { winner: 1, reason: 'no-pieces' });
  const gw = place(R, -1, { w: ['c3'] }, { giveaway: true });
  assert.deepEqual(E.positionResult(gw), { winner: -1, reason: 'no-pieces' });
  // white is blocked (man a1? no — man h2 blocked by g3 and nothing to capture)
  const blocked = place(R, 1, { w: ['h2'], b: ['g3', 'f4'] });
  assert.deepEqual(E.legalMoves(blocked), []);
  assert.deepEqual(E.positionResult(blocked), { winner: -1, reason: 'no-moves' });
  const blockedGw = place(R, 1, { w: ['h2'], b: ['g3', 'f4'] }, { giveaway: true });
  assert.deepEqual(E.positionResult(blockedGw), { winner: 1, reason: 'no-moves' });
});
