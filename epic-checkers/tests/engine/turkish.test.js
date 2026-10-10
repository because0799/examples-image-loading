// Turkish draughts (Dama) — TÜDAF rules. Includes the 10 worked examples of the TÜDAF rulebook
// (as transcribed square-by-square in github.com/ardacagankeser/turkish-draughts, "standard"
// landing-square notation = our path notation).
import test from 'node:test';
import assert from 'node:assert/strict';
import { E, place, assertMoves, moveStrs, mv, sq, playLine } from './util.js';

const T = 'turkish';

test('turkish: men move one square forward or sideways, never backward or diagonally', () => {
  assertMoves(place(T, 1, { w: ['d4'], b: ['h8', 'a8'] }), ['d4-c4', 'd4-d5', 'd4-e4']);
  assertMoves(place(T, -1, { w: ['a1', 'b1'], b: ['d5'] }), ['d5-c5', 'd5-d4', 'd5-e5']);
  // edge of the board
  assertMoves(place(T, 1, { w: ['a2'], b: ['h8'] }), ['a2-a3', 'a2-b2']);
});

test('turkish: men capture forward and sideways but not backward', () => {
  assertMoves(place(T, 1, { w: ['d4'], b: ['d5', 'c4', 'e4', 'h8'] }), ['d4:b4', 'd4:d6', 'd4:f4']);
  // an enemy behind is not capturable: quiet moves only
  assertMoves(place(T, 1, { w: ['d4'], b: ['d3', 'h8'] }), ['d4-c4', 'd4-d5', 'd4-e4']);
  assertMoves(place(T, -1, { w: ['d5', 'a1'], b: ['d4'] }), ['d4-c4', 'd4-d3', 'd4-e4']);
});

test('turkish: capture is mandatory', () => {
  assertMoves(place(T, 1, { w: ['a2', 'h4'], b: ['h5', 'a8'] }), ['h4:h6']);
});

test('turkish: captured pieces are removed immediately (a man continues over freed squares)', () => {
  assertMoves(place(T, 1, { w: ['g3'], W: ['a1'], b: ['g4', 'g6'], B: ['c1'] }), ['g3:g5:g7']);
});

test('turkish: immediate removal lets a king pass over a square it emptied earlier in the move', () => {
  // d1 x d3 -> d5, x f5 -> h5, x h4 -> h3, then west along rank 3 THROUGH d3 (already removed) x c3.
  // Under end-of-move removal (Russian style) d3 would block the last capture.
  const s = place(T, 1, { W: ['d1'], b: ['d3', 'f5', 'h4', 'c3'] });
  assertMoves(s, ['d1:d5:h5:h3:b3', 'd1:d5:h5:h3:a3']);
  const m = E.legalMoves(s)[0];
  assert.deepEqual(m.captures, ['d3', 'f5', 'h4', 'c3'].map((n) => sq(T, n)));
  const after = E.applyMove(s, m);
  assert.deepEqual(E.materialCount(after), { wm: 0, wk: 1, bm: 0, bk: 0 });
});

test('turkish: a king may not turn 180° between two consecutive jumps', () => {
  // without the ban d4 x d6 -> d7 could come straight back down and take d2 (2 pieces)
  const s = place(T, 1, { W: ['d4'], b: ['d6', 'd2'] });
  assertMoves(s, ['d4:d7', 'd4:d8', 'd4:d1']);
  // same horizontally
  assertMoves(place(T, 1, { W: ['d4'], b: ['f4', 'b4'] }), ['d4:g4', 'd4:h4', 'd4:a4']);
});

test('turkish: flying king — quiet moves along ranks and files, capture from a distance', () => {
  const s = place(T, 1, { W: ['d4'], w: ['d2'], b: ['h8'] });
  // king: up d5..d8 (4), left c4,b4,a4 (3), right e4..h4 (4), down d3 (1) = 12; man d2: c2, e2 (d3 is free too)
  assert.equal(E.legalMoves(s).filter((m) => m.piece === 2).length, 12);
  assertMoves(place(T, 1, { W: ['a1'], b: ['a4', 'h8'] }), ['a1:a5', 'a1:a6', 'a1:a7', 'a1:a8']);
  assertMoves(place(T, 1, { W: ['a1'], b: ['a4', 'c6', 'h8'] }), ['a1:a6:d6', 'a1:a6:e6', 'a1:a6:f6', 'a1:a6:g6', 'a1:a6:h6']);
});

test('turkish: no capture when the square behind is occupied or the piece is own', () => {
  const s = place(T, 1, { W: ['a1'], w: ['a3'], b: ['a5', 'h8'] });
  assert.ok(E.legalMoves(s).every((m) => m.captures.length === 0));
  const s2 = place(T, 1, { W: ['a1'], b: ['a4', 'a5', 'h8'] });
  assert.ok(E.legalMoves(s2).every((m) => m.captures.length === 0));
});

test('turkish: maximum capture rule — men and kings count the same', () => {
  // man can take 2 men, king only 1 king -> the man must capture
  assertMoves(place(T, 1, { w: ['c3'], W: ['a1'], b: ['c4', 'c6'], B: ['f1'] }), ['c3:c5:c7']);
  // man takes 1 king vs king takes 1 man: equal count -> both legal (king picks any landing)
  assertMoves(place(T, 1, { w: ['c3'], W: ['a1'], B: ['c4'], b: ['a4', 'h7'] }), [
    'c3:c5',
    'a1:a5',
    'a1:a6',
    'a1:a7',
    'a1:a8',
  ]);
  // the king's 2-capture beats the man's 1-capture
  assertMoves(place(T, 1, { w: ['c3'], W: ['h1'], b: ['c4', 'h5', 'e6'] }), [
    'h1:h6:d6',
    'h1:h6:c6',
    'h1:h6:b6',
    'h1:h6:a6',
  ]);
});

test('turkish: a man reaching the last row during a capture continues as a man, promoted at the end', () => {
  // f6 x f7 -> f8 (last row), then sideways x e8 (king) -> d8. As a king it could also take d5
  // from d8 — but it is still a man, so the move ends on d8 and it is crowned there.
  const s = place(T, 1, { w: ['f6'], b: ['f7', 'd5'], B: ['e8'] });
  const ms = E.legalMoves(s);
  assert.deepEqual(moveStrs(s, ms), ['f6:f8:d8']);
  assert.equal(ms[0].promotion, true);
  assert.equal(ms[0].promotionAt, 2);
  const after = E.applyMove(s, ms[0]);
  assert.equal(after.board[sq(T, 'd8')], 2);
});

test('turkish: quiet promotion on the last row', () => {
  const s = place(T, 1, { w: ['d7'], b: ['a2'] });
  const ms = E.legalMoves(s);
  assert.deepEqual(moveStrs(s, ms).sort(), ['d7-c7', 'd7-d8', 'd7-e7']);
  assert.ok(ms.find((m) => E.moveToString(T, m) === 'd7-d8').promotion);
  assert.ok(!ms.find((m) => E.moveToString(T, m) === 'd7-c7').promotion);
  const b = place(T, -1, { w: ['h8'], b: ['c2'] });
  const bm = E.legalMoves(b).find((m) => E.moveToString(T, m) === 'c2-c1');
  assert.ok(bm.promotion);
});

test('turkish: a man on the last row keeps moving sideways (only as a king after promotion)', () => {
  // a white man can never stand on the last row (it is promoted), so check black kings move all ways
  assertMoves(place(T, -1, { B: ['h1'], w: ['a8'] }), [
    'h1-g1', 'h1-f1', 'h1-e1', 'h1-d1', 'h1-c1', 'h1-b1', 'h1-a1',
    'h1-h2', 'h1-h3', 'h1-h4', 'h1-h5', 'h1-h6', 'h1-h7', 'h1-h8',
  ]);
});

test('turkish: one piece each is a draw', () => {
  assert.deepEqual(E.positionResult(place(T, 1, { W: ['a1'], b: ['h7'] })), { winner: 0, reason: 'insufficient', detail: 'one-each' });
  assert.deepEqual(E.positionResult(place(T, -1, { w: ['a2'], B: ['h7'] })), { winner: 0, reason: 'insufficient', detail: 'one-each' });
  // not in giveaway, and not with two pieces on one side
  assert.equal(E.positionResult(place(T, 1, { W: ['a1'], b: ['h7'] }, { giveaway: true })), null);
  assert.equal(E.positionResult(place(T, 1, { W: ['a1', 'b1'], b: ['h7'] })), null);
  // capturing down to one-each ends the game immediately
  const s = place(T, 1, { W: ['a1'], b: ['a4', 'h7'] });
  const after = E.applyMove(s, E.legalMoves(s)[0]);
  assert.deepEqual(E.positionResult(after), { winner: 0, reason: 'insufficient', detail: 'one-each' });
});

test('turkish: sideways man moves are not progress for the no-progress (50-move) rule', () => {
  const s = place(T, 1, { w: ['a2', 'c2'], b: ['h7', 'f7'] }, { counters: { quiet: 10 } });
  const states = playLine(s, ['a2-b2', 'h7-g7', 'b2-a2', 'g7-h7']);
  assert.equal(states[4].counters.quiet, 14);
  const fwd = E.applyMove(states[4], mv(states[4], 'a2-a3'));
  assert.equal(fwd.counters.quiet, 0);
  // 100 plies without progress -> draw
  const late = place(T, 1, { w: ['a2', 'c2'], b: ['h7', 'f7'] }, { counters: { quiet: 99 } });
  assert.equal(E.positionResult(late), null);
  const end = E.applyMove(late, mv(late, 'a2-b2'));
  assert.deepEqual(E.positionResult(end), { winner: 0, reason: 'move-limit', detail: 'no-progress', limit: 50, rule: 'quiet' });
});

// ---- TÜDAF rulebook examples -----------------------------------------------------------------

const EX_WHITE_1 = ['a4', 'h4', 'a3', 'b3', 'c3', 'd3', 'e3', 'f3', 'g3', 'h3', 'a2', 'c2', 'd2', 'f2'];

test('TÜDAF example 1: man captures 4 (zig-zag, maximum)', () => {
  const s = place(T, 1, {
    w: EX_WHITE_1,
    b: ['c7', 'h7', 'a6', 'b6', 'c6', 'd6', 'e6', 'g6', 'h6', 'a5', 'b5', 'c5', 'e5', 'g5', 'f4'],
  });
  assertMoves(s, ['f3:f5:d5:d7:b7']);
});

test('TÜDAF example 2: man captures 6', () => {
  const s = place(T, 1, {
    w: EX_WHITE_1,
    b: ['c7', 'e7', 'g7', 'a6', 'b6', 'c6', 'd6', 'e6', 'g6', 'h6', 'a5', 'b5', 'c5', 'e5', 'g5', 'f4'],
  });
  assertMoves(s, ['f3:f5:h5:h7:f7:d7:b7']);
});

test('TÜDAF example 3: king captures 8 with U-turns over two corners (two equivalent orders)', () => {
  const s = place(T, -1, {
    w: ['c5', 'a4', 'g4', 'a3', 'b3', 'c3', 'f3', 'h3', 'b2', 'e2', 'g2'],
    B: ['c8'],
    b: ['a7', 'd7', 'e7', 'f7', 'g7', 'e6', 'f6', 'g6', 'e5'],
  });
  const ms = E.legalMoves(s);
  assert.equal(ms.length, 1, moveStrs(s, ms).join(' '));
  const m = ms[0];
  assert.equal(m.captures.length, 8);
  assert.equal(m.to, sq(T, 'a2'));
  const all = [m.path, ...(m.alts || [])].map((p) => p.map((x) => E.squareName(T, x)).join(':')).sort();
  // The two orders of the rulebook; in the first one the king may also stop on e2/d2/c2 before the
  // last jump over b2 (all landing squares from which the capture continues are allowed).
  assert.deepEqual(all, [
    'c8:c4:c2:f2:f4:h4:h2:c2:a2',
    'c8:c4:c2:f2:f4:h4:h2:d2:a2',
    'c8:c4:c2:f2:f4:h4:h2:e2:a2',
    'c8:c4:c2:f2:f4:h4:h2:f2:a2',
    'c8:c4:c2:f2:h2:h4:f4:f2:a2',
  ]);
  assert.deepEqual(
    [...m.captures].sort((a, b) => a - b),
    ['b2', 'c3', 'c5', 'e2', 'f3', 'g2', 'g4', 'h3'].map((n) => sq(T, n)).sort((a, b) => a - b),
  );
  // either order is accepted by Game.play
  for (const p of all) {
    const g = new E.Game(T, {}, s);
    const played = g.play(E.parseMove(T, p));
    assert.equal(played, g.history[0].move);
    assert.deepEqual(E.materialCount(g.state), { wm: 3, wk: 0, bm: 9, bk: 1 });
  }
});

test('TÜDAF example 4: the 180° ban limits the king to 4 captures', () => {
  const s = place(T, -1, {
    w: ['c5', 'a4', 'f4', 'g4', 'h4', 'a3', 'b3', 'c3', 'f3', 'h3', 'b2', 'e2', 'g2'],
    B: ['c8'],
    b: ['a7', 'd7', 'e7', 'f7', 'g7', 'e6', 'f6', 'g6', 'f5'],
  });
  assertMoves(s, ['c8:c4:c2:f2:h2']);
});

test('TÜDAF example 5: man captures to the last row and is crowned', () => {
  const s = place(T, 1, {
    w: ['e4', 'a3', 'b3', 'e3', 'f3', 'h3', 'd2', 'e2', 'g2'],
    B: ['c8'],
    b: ['a7', 'd7', 'e7', 'f7', 'g7', 'f6', 'g6', 'e5'],
  });
  const ms = E.legalMoves(s);
  assert.deepEqual(moveStrs(s, ms), ['e4:e6:e8']);
  assert.equal(ms[0].promotion, true);
  const after = E.applyMove(s, ms[0]);
  assert.equal(after.board[sq(T, 'e8')], 2);
  assert.equal(after.turn, -1);
});

test('TÜDAF example 6: promotion without capture next to an enemy king, then the king strikes', () => {
  const s = place(T, 1, {
    w: ['f7', 'a4', 'c4', 'a3', 'b3', 'c3', 'd3', 'e3', 'g3', 'a2', 'b2', 'd2', 'f2', 'g2'],
    B: ['e8'],
    b: ['a7', 'b7', 'c7', 'd7', 'a6', 'b6', 'c6', 'd6', 'h6', 'a5', 'c5'],
  });
  const ms = E.legalMoves(s);
  assert.ok(ms.every((m) => m.captures.length === 0));
  const promo = mv(s, 'f7-f8');
  assert.equal(promo.promotion, true);
  const after = E.applyMove(s, promo);
  assert.equal(after.board[sq(T, 'f8')], 2);
  assertMoves(after, ['e8:e2:c2']);
});

test('TÜDAF example 7: man captures onto the last row and continues sideways taking the king', () => {
  const s = place(T, 1, {
    w: ['f6', 'a4', 'c4', 'a3', 'b3', 'c3', 'd3', 'g3', 'a2', 'b2', 'd2', 'f2', 'g2'],
    B: ['e8'],
    b: ['a7', 'b7', 'c7', 'd7', 'f7', 'a6', 'b6', 'c6', 'd6', 'h6', 'a5', 'c5'],
  });
  const ms = E.legalMoves(s);
  assert.deepEqual(moveStrs(s, ms), ['f6:f8:d8']);
  assert.deepEqual(ms[0].captured, [-1, -2]);
  assert.equal(ms[0].promotion, true);
});

const EX_WHITE_8 = { W: ['h1'], w: ['e5', 'a4', 'c4', 'a3', 'b3', 'c3', 'd3', 'e3', 'g3', 'a2', 'b2', 'c2', 'd2', 'e2', 'f2'] };

test('TÜDAF example 8: man and king both capture one — free choice, king may pick its landing', () => {
  const s = place(T, 1, { ...EX_WHITE_8, b: ['a7', 'b7', 'c7', 'd7', 'a6', 'b6', 'c6', 'd6', 'h6', 'a5', 'c5', 'f5'] });
  assertMoves(s, ['e5:g5', 'h1:h7', 'h1:h8']);
});

test('TÜDAF example 9: the man captures two, so it must', () => {
  const s = place(T, 1, {
    ...EX_WHITE_8,
    b: ['a7', 'b7', 'c7', 'd7', 'a6', 'b6', 'c6', 'd6', 'f6', 'g6', 'h6', 'a5', 'c5', 'f5'],
  });
  assertMoves(s, ['e5:g5:g7']);
});

test('TÜDAF example 10: the king captures two even though it will be lost right after', () => {
  const s = place(T, 1, {
    ...EX_WHITE_8,
    b: ['a7', 'b7', 'c7', 'd7', 'e7', 'g7', 'a6', 'b6', 'c6', 'd6', 'f6', 'h6', 'a5', 'c5', 'f5'],
  });
  assertMoves(s, ['h1:h7:f7']);
});
