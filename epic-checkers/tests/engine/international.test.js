// International (FMJD 10×10), Brazilian (8×8) and Canadian (12×12) rule nuances.
import test from 'node:test';
import assert from 'node:assert/strict';
import { E, place, assertMoves, moveStrs } from './util.js';

const I = 'international';
const B = 'brazilian';
const C = 'canadian';

/** square name from (row, col) */
const at = (variant, r, c) => E.squareName(variant, r * E.getVariant(variant).size + c);
const I_ = (r, c) => at(I, r, c);

test('international: numeric notation of the start moves', () => {
  assert.deepEqual(moveStrs(E.createInitialState(I)), ['31-26', '31-27', '32-27', '32-28', '33-28', '33-29', '34-29', '34-30', '35-30']);
  assert.equal(I_(0, 1), '1');
  assert.equal(I_(9, 0), '46');
});

test('international: men capture backward', () => {
  // white man on (4,5) takes black (5,4) backwards, landing (6,3)
  const s = place(I, 1, { w: [I_(4, 5)], b: [I_(5, 4), I_(0, 9)] });
  assertMoves(s, [`${I_(4, 5)}x${I_(6, 3)}`]);
});

test('international: maximum capture — the longest sequence is mandatory', () => {
  // man (6,3): one capture over (5,2) -> (4,1); or two: over (5,4) -> (4,5), over (3,6) -> (2,7)
  const s = place(I, 1, { w: [I_(6, 3)], b: [I_(5, 2), I_(5, 4), I_(3, 6), I_(0, 1)] });
  assertMoves(s, [`${I_(6, 3)}x${I_(4, 5)}x${I_(2, 7)}`]);
  // the king's single capture loses to the man's double capture
  // king (0,9) can only take (3,6) once (landing (4,5); (5,4) behind is blocked by the man)
  const s2 = place(I, 1, { w: [I_(6, 3)], W: [I_(0, 9)], b: [I_(5, 4), I_(3, 6), I_(0, 1)] });
  assertMoves(s2, [`${I_(6, 3)}x${I_(4, 5)}x${I_(2, 7)}`]);
});

test('international: kings and men count the same for the majority rule', () => {
  // man (6,3) can take one king (5,2) or two men (5,4),(3,6): two men win
  const s = place(I, 1, { w: [I_(6, 3)], B: [I_(5, 2)], b: [I_(5, 4), I_(3, 6), I_(0, 1)] });
  assertMoves(s, [`${I_(6, 3)}x${I_(4, 5)}x${I_(2, 7)}`]);
  // one king vs one man: both legal
  const s2 = place(I, 1, { w: [I_(6, 3)], B: [I_(5, 2)], b: [I_(5, 4), I_(0, 1)] });
  assertMoves(s2, [`${I_(6, 3)}x${I_(4, 1)}`, `${I_(6, 3)}x${I_(4, 5)}`]);
});

test('international: a man passing through the last row during a capture stays a man', () => {
  // (2,1) x (1,2) -> (0,3) [last row], then backwards x (1,4) -> (2,5): not promoted
  const s = place(I, 1, { w: [I_(2, 1)], b: [I_(1, 2), I_(1, 4), I_(9, 0)] });
  const ms = E.legalMoves(s);
  assert.deepEqual(moveStrs(s, ms), [`${I_(2, 1)}x${I_(0, 3)}x${I_(2, 5)}`]);
  assert.equal(ms[0].promotion, false);
  assert.equal(ms[0].promotionAt, -1);
  const after = E.applyMove(s, ms[0]);
  assert.equal(after.board[2 * 10 + 5], 1);
});

test('international: a man ending its capture on the last row is crowned', () => {
  const s = place(I, 1, { w: [I_(2, 1)], b: [I_(1, 2), I_(9, 0)] });
  const ms = E.legalMoves(s);
  assert.deepEqual(moveStrs(s, ms), [`${I_(2, 1)}x${I_(0, 3)}`]);
  assert.equal(ms[0].promotion, true);
  assert.equal(ms[0].promotionAt, 1);
  assert.equal(E.applyMove(s, ms[0]).board[3], 2);
});

test('international: flying king landing squares and Turkish strike', () => {
  // king (5,4): NE over (4,5) lands (3,6)/(2,7)/(1,8)/(0,9); SW over (7,2) lands (8,1)/(9,0).
  // It can never come back over the first captured piece (still on the board).
  const s = place(I, 1, { W: [I_(5, 4)], b: [I_(4, 5), I_(7, 2)] });
  assertMoves(
    s,
    [[3, 6], [2, 7], [1, 8], [0, 9], [8, 1], [9, 0]].map(([r, c]) => `${I_(5, 4)}x${I_(r, c)}`),
  );
});

test('international: identical-outcome sequences are merged (alts)', () => {
  // man (6,3) circles a diamond of 4 men clockwise or counter-clockwise, ending on its start square
  const s = place(I, 1, { w: [I_(6, 3)], b: [I_(5, 4), I_(3, 4), I_(3, 2), I_(5, 2), I_(0, 9)] });
  const ms = E.legalMoves(s);
  assert.equal(ms.length, 1);
  const m = ms[0];
  assert.equal(m.captures.length, 4);
  assert.equal(m.from, m.to);
  assert.equal(m.alts.length, 1);
  assert.deepEqual([...m.alts[0]].reverse(), m.path);
  const after = E.applyMove(s, m);
  assert.deepEqual(E.materialCount(after), { wm: 1, wk: 0, bm: 1, bk: 0 });
  assert.equal(after.board[6 * 10 + 3], 1);
  // the alternative path is accepted by Game and findMove / movesWithPrefix
  assert.equal(E.findMove(ms, m.alts[0]), m);
  assert.equal(E.movesWithPrefix(ms, m.alts[0].slice(0, 2)).length, 1);
  const g = new E.Game(I, {}, s);
  assert.deepEqual(g.play(m.alts[0]).path, m.path);
  assert.deepEqual(E.materialCount(g.state), { wm: 1, wk: 0, bm: 1, bk: 0 });
});

test('international: king must take the maximum even through a long zig-zag', () => {
  // king (9,0) x (7,2) -> lands (6,3) (only square that continues) x (5,4)... set two victims
  const s = place(I, 1, { W: [I_(9, 0)], b: [I_(7, 2), I_(4, 5), I_(3, 2)] });
  // from (6,3)/(5,4)... after (7,2): landings (6,3),(5,4) [(4,5) blocks]; from (5,4) NW: (4,3),(3,2)b,(2,1),(1,0)
  // from (6,3) NE: (5,4),(4,5)b,(3,6)... ; NW: (5,2),(4,1),(3,0) empty
  // (landing on (5,4) and taking (4,5) gives the same outcomes as via (6,3): merged as alts)
  const ms = E.legalMoves(s);
  assert.ok(ms.every((m) => m.captures.length === 2), moveStrs(s, ms).join(' '));
  assert.equal(ms.filter((m) => m.alts && m.alts.length === 1).length, 4);
  assert.deepEqual(moveStrs(s, ms).sort(), [
    `${I_(9, 0)}x${I_(5, 4)}x${I_(2, 1)}`,
    `${I_(9, 0)}x${I_(5, 4)}x${I_(1, 0)}`,
    `${I_(9, 0)}x${I_(6, 3)}x${I_(3, 6)}`,
    `${I_(9, 0)}x${I_(6, 3)}x${I_(2, 7)}`,
    `${I_(9, 0)}x${I_(6, 3)}x${I_(1, 8)}`,
    `${I_(9, 0)}x${I_(6, 3)}x${I_(0, 9)}`,
  ].sort());
});

test('brazilian: maximum capture on 8×8', () => {
  // Russian would allow both; Brazilian keeps only the double capture
  const s = place(B, 1, { w: ['c3'], b: ['b4', 'd4', 'f6'] });
  assertMoves(s, ['c3:e5:g7']);
  assertMoves(place('russian', 1, { w: ['c3'], b: ['b4', 'd4', 'f6'] }), ['c3:a5', 'c3:e5:g7']);
});

test('brazilian: passing through the last row does not crown (unlike Russian)', () => {
  const s = place(B, 1, { w: ['b6'], b: ['c7', 'e7'] });
  const ms = E.legalMoves(s);
  assert.deepEqual(moveStrs(s, ms), ['b6:d8:f6']);
  assert.equal(ms[0].promotion, false);
  const russian = place('russian', 1, { w: ['b6'], b: ['c7', 'e7'] });
  assert.deepEqual(moveStrs(russian).sort(), ['b6:d8:f6', 'b6:d8:g5', 'b6:d8:h4']);
});

test('brazilian: men capture backward, kings fly', () => {
  assertMoves(place(B, 1, { w: ['d4'], b: ['c3', 'h8'] }), ['d4:b2']);
  assertMoves(place(B, 1, { W: ['a1'], b: ['d4'] }), ['a1:e5', 'a1:f6', 'a1:g7', 'a1:h8']);
  assertMoves(place(B, 1, { W: ['a1'], b: ['d4', 'f4'] }), ['a1:e5:g3', 'a1:e5:h2']);
});

test('canadian: 12×12 setup, numeric squares 1..72 and maximum capture', () => {
  const s = E.createInitialState(C);
  assert.equal(E.legalMoves(s).length, 11);
  assert.equal(at(C, 11, 10), '72');
  assert.equal(at(C, 0, 1), '1');
  const C_ = (r, c) => at(C, r, c);
  // man (8,5): single (7,4)->(6,3) or double (7,6)->(6,7), (5,8)->(4,9)
  const p = place(C, 1, { w: [C_(8, 5)], b: [C_(7, 4), C_(7, 6), C_(5, 8), C_(0, 1)] });
  assertMoves(p, [`${C_(8, 5)}x${C_(6, 7)}x${C_(4, 9)}`]);
  // pass-through without promotion on 12×12
  const q = place(C, 1, { w: [C_(2, 1)], b: [C_(1, 2), C_(1, 4), C_(11, 0)] });
  const ms = E.legalMoves(q);
  assert.deepEqual(moveStrs(q, ms), [`${C_(2, 1)}x${C_(0, 3)}x${C_(2, 5)}`]);
  assert.equal(ms[0].promotion, false);
});
