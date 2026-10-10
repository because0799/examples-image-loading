// Counter-based draw rules (positionResult) and counter bookkeeping in applyMove.
import test from 'node:test';
import assert from 'node:assert/strict';
import { E, place, mv, playLine, rng } from './util.js';

/**
 * Play `plies` plies alternating between two shuttle moves per side; `pick(state, ply)` may
 * override the move string. Returns all states.
 */
function shuttle(start, white, black, plies, pick = () => null) {
  const states = [start];
  let s = start;
  const toggle = { 1: 0, [-1]: 0 };
  for (let p = 0; p < plies; p++) {
    let str = pick(s, p);
    if (!str) {
      const pair = s.turn === 1 ? white : black;
      str = pair[toggle[s.turn] % 2];
      toggle[s.turn]++;
    }
    s = E.applyMove(s, mv(s, str));
    states.push(s);
  }
  return states;
}

function firstDraw(states) {
  return states.findIndex((s) => E.positionResult(s) !== null);
}

function egIndex(variantId, rule) {
  return E.getVariant(variantId).draw.rules.indexOf(rule) * 3;
}

/** Same position with the given endgame tracker preset to `n` plies (first mover = side to move). */
function withEg(variantId, turn, pieces, rule, n, extra = {}) {
  const s = place(variantId, turn, pieces);
  const eg = Array.from(s.counters.eg);
  const i = egIndex(variantId, rule);
  assert.ok(i >= 0, `${variantId} has rule ${rule}`);
  assert.notEqual(eg[i], '', `rule ${rule} applies to the position`);
  eg[i + 1] = n;
  eg[i + 2] = turn;
  return place(variantId, turn, pieces, { counters: { eg, ...extra } });
}

test('counters: quiet resets on man moves and captures; material is tracked', () => {
  const s = place('russian', 1, { W: ['a1'], w: ['e3'], b: ['h6', 'a7'] }, { counters: { quiet: 5 } });
  const k = E.applyMove(s, mv(s, 'a1-b2'));
  assert.equal(k.counters.quiet, 6);
  const m = E.applyMove(k, mv(k, 'a7-b6'));
  assert.equal(m.counters.quiet, 0);
  const cap = place('russian', 1, { W: ['a1'], b: ['d4', 'h6'] }, { counters: { quiet: 12 } });
  const c2 = E.applyMove(cap, E.legalMoves(cap)[0]);
  assert.equal(c2.counters.quiet, 0);
  assert.deepEqual(E.materialCount(c2), { wm: 0, wk: 1, bm: 1, bk: 0 });
  const promo = place('russian', 1, { w: ['c7'], b: ['h6'] });
  const p2 = E.applyMove(promo, mv(promo, 'c7-d8'));
  assert.deepEqual(E.materialCount(p2), { wm: 0, wk: 1, bm: 1, bk: 0 });
  assert.equal(p2.counters.quiet, 0);
});

test('russian: 15 moves of kings only without captures -> draw', () => {
  const pieces = { W: ['a1', 'c1'], B: ['h8', 'f8'] };
  const s = place('russian', 1, pieces, { counters: { quiet: 29 } });
  assert.equal(E.positionResult(s), null);
  const after = E.applyMove(s, mv(s, 'c1-d2'));
  assert.equal(after.counters.quiet, 30);
  assert.deepEqual(E.positionResult(after), { winner: 0, reason: 'move-limit', detail: 'kings-only', limit: 15, rule: 'quiet' });
  // a man move resets the count
  const s2 = place('russian', 1, { ...pieces, w: ['e3'] }, { counters: { quiet: 29 } });
  assert.equal(E.positionResult(E.applyMove(s2, mv(s2, 'e3-d4'))), null);
});

test('russian: three kings against a lone king — 15 moves of the strong side', () => {
  // the man h2 moves once (ply 8) so the 15-king-moves rule cannot be the reason
  const s = place('russian', 1, { W: ['a1', 'a3', 'a5'], w: ['h2'], B: ['h6'] });
  const states = shuttle(s, ['a1-b2', 'b2-a1'], ['h6-g5', 'g5-h6'], 30, (st, p) => (p === 8 ? 'h2-g3' : null));
  assert.equal(firstDraw(states), 29); // white made its 15th move at ply 29
  assert.deepEqual(E.positionResult(states[29]), { winner: 0, reason: 'move-limit', detail: 'endgame', limit: 15, rule: 'r3v1' });
  assert.ok(states[29].counters.quiet < 30);
});

test('russian: three pieces against a lone king on the main road — 5 moves', () => {
  const s = place('russian', 1, { W: ['a3', 'a5', 'c1'], B: ['h8'] });
  const states = shuttle(s, ['a5-b6', 'b6-a5'], ['h8-g7', 'g7-h8'], 10);
  assert.equal(firstDraw(states), 9);
  // leaving the main road restarts the count
  const s2 = place('russian', 1, { W: ['a3', 'a5', 'c1'], B: ['h8'] });
  const line = ['a5-b6', 'h8-g7', 'b6-a5', 'g7-h6', 'a5-b6', 'h6-g7'];
  const st = playLine(s2, line);
  const more = shuttle(st[st.length - 1], ['b6-a5', 'a5-b6'], ['g7-h8', 'h8-g7'], 10);
  const all = [...st, ...more.slice(1)];
  assert.equal(firstDraw(all), 6 + 9); // re-established after ply 6 (white to move)
});

test('russian: both sides with kings, unchanged material — 2–3 pieces: 5 moves each', () => {
  const s = place('russian', 1, { W: ['a5'], B: ['h6'] });
  const states = shuttle(s, ['a5-b6', 'b6-a5'], ['h6-g5', 'g5-h6'], 12);
  assert.equal(firstDraw(states), 10);
  // a man that is never moved does not matter, a capture/promotion restarts the count
  const s3 = place('russian', 1, { W: ['a5'], B: ['h6'], b: ['h8'] });
  assert.equal(firstDraw(shuttle(s3, ['a5-b4', 'b4-a5'], ['h6-g5', 'g5-h6'], 12)), 10);
});

test('russian: balance rule limits — 4–5 pieces 30 moves, 6–7 pieces 60 moves', () => {
  const four = { W: ['a5', 'a3'], B: ['h6'], b: ['h8'] };
  const at59 = withEg('russian', 1, four, 'rBalance', 59);
  assert.equal(E.positionResult(at59), null);
  assert.deepEqual(E.positionResult(E.applyMove(at59, mv(at59, 'a5-b6'))), { winner: 0, reason: 'move-limit', detail: 'endgame', limit: 30, rule: 'rBalance' });
  const at58 = withEg('russian', 1, four, 'rBalance', 58);
  assert.equal(E.positionResult(E.applyMove(at58, mv(at58, 'a5-b6'))), null);
  const six = { W: ['a5', 'a3', 'c1'], w: ['e1'], B: ['h6'], b: ['h8'] };
  const at119 = withEg('russian', 1, six, 'rBalance', 119);
  assert.deepEqual(E.positionResult(E.applyMove(at119, mv(at119, 'a5-b6'))), { winner: 0, reason: 'move-limit', detail: 'endgame', limit: 60, rule: 'rBalance' });
  const at118 = withEg('russian', 1, six, 'rBalance', 118);
  assert.equal(E.positionResult(E.applyMove(at118, mv(at118, 'a5-b6'))), null);
  // 8+ pieces: rule does not apply
  const eight = place('russian', 1, { W: ['a5', 'a3'], w: ['e1', 'g1'], B: ['h6'], b: ['h8', 'f8', 'd8'] });
  assert.equal(eight.counters.eg[egIndex('russian', 'rBalance')], '');
});

test('international: 25 king moves each -> draw; FMJD 16-move and 5-move endgames', () => {
  const I = 'international';
  const n = (r, c) => E.squareName(I, r * 10 + c);
  // king vs king: 5 moves each
  const kk = place(I, 1, { W: [n(9, 0)], B: [n(0, 1)] });
  const states = shuttle(kk, [`${n(9, 0)}-${n(8, 1)}`, `${n(8, 1)}-${n(9, 0)}`], [`${n(0, 1)}-${n(1, 0)}`, `${n(1, 0)}-${n(0, 1)}`], 12);
  assert.equal(firstDraw(states), 10);
  // 3 kings vs king: 16 moves each (32 plies)
  const three = { W: [n(9, 0), n(9, 2), n(9, 4)], B: [n(0, 1)] };
  const at31 = withEg(I, 1, three, 'f16', 31);
  assert.equal(E.positionResult(at31), null);
  assert.deepEqual(E.positionResult(E.applyMove(at31, mv(at31, `${n(9, 0)}-${n(8, 1)}`))), { winner: 0, reason: 'move-limit', detail: 'endgame', limit: 16, rule: 'f16' });
  // king + 2 men vs king also counts; 3 men vs king does not
  const k2m = place(I, 1, { W: [n(9, 0)], w: [n(6, 1), n(6, 3)], B: [n(0, 1)] });
  assert.notEqual(k2m.counters.eg[egIndex(I, 'f16')], '');
  const m3 = place(I, 1, { w: [n(6, 1), n(6, 3), n(6, 5)], B: [n(0, 1)] });
  assert.equal(m3.counters.eg[egIndex(I, 'f16')], '');
  // 25-move rule
  const quiet = place(I, 1, { W: [n(9, 0), n(9, 2)], B: [n(0, 1), n(0, 3)] }, { counters: { quiet: 49 } });
  assert.deepEqual(E.positionResult(E.applyMove(quiet, mv(quiet, `${n(9, 0)}-${n(8, 1)}`))), { winner: 0, reason: 'move-limit', detail: 'kings-only', limit: 25, rule: 'quiet' });
});

test('brazilian: lone king on the main diagonal vs 3 pieces — 5 moves each; 20 king moves', () => {
  const s = place('brazilian', 1, { W: ['a3', 'a5', 'c1'], B: ['h8'] });
  const states = shuttle(s, ['a5-b6', 'b6-a5'], ['h8-g7', 'g7-h8'], 12);
  assert.equal(firstDraw(states), 10);
  // off the main diagonal: 16 moves each
  const off = place('brazilian', 1, { W: ['a3', 'a5', 'c1'], B: ['h6'] });
  assert.equal(off.counters.eg[egIndex('brazilian', 'bRoad')], '');
  assert.notEqual(off.counters.eg[egIndex('brazilian', 'f16')], '');
  const q = place('brazilian', 1, { W: ['a3', 'a5'], B: ['h8', 'h6'] }, { counters: { quiet: 39 } });
  assert.deepEqual(E.positionResult(E.applyMove(q, mv(q, 'a5-b6'))), { winner: 0, reason: 'move-limit', detail: 'kings-only', limit: 20, rule: 'quiet' });
  const q2 = place('brazilian', 1, { W: ['a3', 'a5'], B: ['h8', 'h6'] }, { counters: { quiet: 38 } });
  assert.equal(E.positionResult(E.applyMove(q2, mv(q2, 'a5-b6'))), null);
});

test('no-progress limits per variant (moves each side)', () => {
  const cases = [
    ['english', 40],
    ['italian', 40],
    ['spanish', 20],
    ['czech', 30],
    ['pool', 15],
    ['canadian', 25],
  ];
  for (const [id, moves] of cases) {
    const v = E.getVariant(id);
    assert.equal(v.draw.quietMoves, moves, id);
    // build a kings-only position from the first legal king squares
    const g = E.createInitialState(id);
    const sqs = [];
    for (let i = 0; i < g.board.length; i++) if (E.squareName(id, i) !== '?') sqs.push(i);
    const n = v.size;
    // white kings on the bottom row, black kings on the top row
    const bottom = sqs.filter((x) => Math.floor(x / n) === n - 1).slice(0, 2);
    const top = sqs.filter((x) => Math.floor(x / n) === 0).slice(-2);
    const pieces = { W: bottom.map((x) => E.squareName(id, x)), B: top.map((x) => E.squareName(id, x)) };
    const before = place(id, 1, pieces, { counters: { quiet: 2 * moves - 1 } });
    const quietKingMove = E.legalMoves(before).find((m) => m.captures.length === 0);
    const after = E.applyMove(before, quietKingMove);
    assert.deepEqual(E.positionResult(after), { winner: 0, reason: 'move-limit', detail: 'kings-only', limit: moves, rule: 'quiet' }, id);
    const early = place(id, 1, pieces, { counters: { quiet: 2 * moves - 2 } });
    assert.equal(E.positionResult(E.applyMove(early, quietKingMove)), null, id);
  }
});

test('pool: three kings against a lone king — 13 moves of the strong side (APCA), not 15', () => {
  const s = place('pool', 1, { W: ['a1', 'a3', 'a5'], w: ['h2'], B: ['h6'] });
  const states = shuttle(s, ['a1-b2', 'b2-a1'], ['h6-g5', 'g5-h6'], 30, (st, p) => (p === 8 ? 'h2-g3' : null));
  assert.equal(firstDraw(states), 25); // white made its 13th move at ply 25
  assert.equal(E.positionResult(states[24]), null, 'after 12 strong moves the game goes on');
  assert.deepEqual(E.positionResult(states[25]), { winner: 0, reason: 'move-limit', detail: 'endgame', limit: 13, rule: 'p3v1' });
  // preset tracker (as in the review script): 12 strong moves → on, 13 → draw
  const w = { W: ['a1', 'c1', 'e1'], B: ['h8'] };
  const at = (n) => withEg('pool', 1, w, 'p3v1', n);
  assert.equal(E.positionResult(at(24)), null); // white to move, 12 white moves made
  assert.deepEqual(E.positionResult(E.applyMove(at(24), mv(at(24), 'a1-b2'))), { winner: 0, reason: 'move-limit', detail: 'endgame', limit: 13, rule: 'p3v1' });
  // the Russian rule stays at 15
  assert.equal(E.getVariant('russian').draw.rules.includes('r3v1'), true);
  assert.deepEqual(E.getVariant('pool').draw.rules, ['p3v1']);
});

test('giveaway: material endgame limits are off, the king-moves limit and inversion remain', () => {
  const s = place('russian', 1, { W: ['a3', 'a5', 'c1'], B: ['h8'] }, { giveaway: true });
  const states = shuttle(s, ['a5-b6', 'b6-a5'], ['h8-g7', 'g7-h8'], 30);
  assert.equal(firstDraw(states), 30); // only the 15-king-moves rule
  assert.deepEqual(E.positionResult(states[30]), { winner: 0, reason: 'move-limit', detail: 'kings-only', limit: 15, rule: 'quiet' });
  // capturing everything wins for the side that lost its pieces
  const lone = place('russian', 1, { W: ['a1'], b: ['d4'] }, { giveaway: true });
  const after = E.applyMove(lone, E.legalMoves(lone)[0]);
  assert.deepEqual(E.positionResult(after), { winner: -1, reason: 'no-pieces', detail: 'no-pieces' });
});

test('positionResult accepts precomputed moves and reports wins', () => {
  const s = place('english', -1, { w: ['c3'] });
  assert.deepEqual(E.positionResult(s, []), { winner: 1, reason: 'no-pieces', detail: 'no-pieces' });
  const t = place('english', 1, { w: ['c3'], b: ['h8'] });
  assert.equal(E.positionResult(t, E.legalMoves(t)), null);
  // if the side NOT to move has no pieces, the side to move has won
  assert.deepEqual(E.positionResult(place('english', 1, { w: ['c3'] })), { winner: 1, reason: 'no-pieces', detail: 'no-pieces' });
});

test('russian: 3+ kings vs a lone king is tracked with any number of extra men (RTR-04)', () => {
  // 3 kings + 4 men (8 pieces) vs a lone king: the rule applies above 7 pieces too
  const big = E.stateFromString('russian', 'w:......../B......./......../......../......../......../...W.W.W/w.w.w.w.');
  const i = egIndex('russian', 'r3v1');
  assert.equal(big.counters.eg[i], 'w');
  // the strong side makes 15 moves, some of them man moves (they reset the kings-only counter
  // but not the 3-kings count) → draw after its 15th move
  // White: kings d2 f2 h2 + men a1 c1 e1 g1 (8 pieces with the black king); the black king
  // shuttles a7-b8 on the edge (it can neither capture nor be captured).
  const s = place('russian', 1, { W: ['d2', 'f2', 'h2'], w: ['a1', 'c1', 'e1', 'g1'], B: ['a7'] });
  const manMoves = { 4: 'a1-b2', 10: 'b2-a3', 16: 'c1-b2', 22: 'a3-b4' };
  const kingShuttle = ['d2-c3', 'c3-d2'];
  let s0 = s;
  const states = [s0];
  let k = 0;
  let bk = 0;
  for (let p = 0; p < 32; p++) {
    let str;
    if (s0.turn === 1) str = manMoves[p] || kingShuttle[k++ % 2];
    else str = ['a7-b8', 'b8-a7'][bk++ % 2];
    s0 = E.applyMove(s0, mv(s0, str));
    states.push(s0);
    if (E.positionResult(s0)) break;
  }
  const at = firstDraw(states);
  assert.equal(at, 29, 'draw right after white’s 15th move');
  assert.deepEqual(E.positionResult(states[29]), { winner: 0, reason: 'move-limit', detail: 'endgame', limit: 15, rule: 'r3v1' });
  assert.ok(states[29].counters.quiet < 30, 'not the kings-only rule');
  // with only men extra and fewer than 3 kings nothing is tracked
  const two = E.stateFromString('russian', 'w:......../B......./......../......../......../......../.....W.W/w.w.w.w.');
  assert.equal(two.counters.eg[i], '');
});

test('result details: main-diagonal, FMJD 5-move, balance rule, giveaway no-progress', () => {
  const road = place('russian', 1, { W: ['a3', 'a5', 'c1'], B: ['h8'] });
  const rs = shuttle(road, ['a5-b6', 'b6-a5'], ['h8-g7', 'g7-h8'], 10);
  assert.deepEqual(E.positionResult(rs[9]), { winner: 0, reason: 'move-limit', detail: 'main-diagonal', limit: 5, rule: 'rRoad' });
  const br = place('brazilian', 1, { W: ['a3', 'a5', 'c1'], B: ['h8'] });
  const bs = shuttle(br, ['a5-b6', 'b6-a5'], ['h8-g7', 'g7-h8'], 12);
  assert.deepEqual(E.positionResult(bs[10]), { winner: 0, reason: 'move-limit', detail: 'main-diagonal', limit: 5, rule: 'bRoad' });
  const I = 'international';
  const n = (r, c) => E.squareName(I, r * 10 + c);
  const kk = place(I, 1, { W: [n(9, 0)], B: [n(0, 1)] });
  const ks = shuttle(kk, [`${n(9, 0)}-${n(8, 1)}`, `${n(8, 1)}-${n(9, 0)}`], [`${n(0, 1)}-${n(1, 0)}`, `${n(1, 0)}-${n(0, 1)}`], 10);
  assert.deepEqual(E.positionResult(ks[10]), { winner: 0, reason: 'move-limit', detail: 'endgame', limit: 5, rule: 'f5' });
  const bal = place('russian', 1, { W: ['a5'], B: ['h6'] });
  const bals = shuttle(bal, ['a5-b6', 'b6-a5'], ['h6-g5', 'g5-h6'], 10);
  assert.deepEqual(E.positionResult(bals[10]), { winner: 0, reason: 'move-limit', detail: 'endgame', limit: 5, rule: 'rBalance' });
  const gw = place('turkish', 1, { w: ['a2', 'c2'], b: ['h7', 'f7'] }, { giveaway: true, counters: { quiet: 99 } });
  const ge = E.applyMove(gw, mv(gw, 'a2-b2'));
  assert.deepEqual(E.positionResult(ge), { winner: 0, reason: 'move-limit', detail: 'no-progress', limit: 50, rule: 'quiet' });
  // Turkish one piece each: switched off in giveaway
  assert.equal(E.positionResult(place('turkish', 1, { w: ['a2'], B: ['h7'] }, { giveaway: true })), null);
});

test('drawProgress: closest counter rule, counts down to the draw exactly', () => {
  // nothing is counting at the start
  assert.equal(E.drawProgress(E.createInitialState('russian')), null);
  // kings-only counter: 15 moves each
  // 8 pieces: the balance rule (≤ 7 pieces) does not apply, only the kings-only counter
  const P8 = { W: ['a1', 'c1'], w: ['e3', 'g3'], B: ['h8', 'f8'], b: ['a7', 'c7'] };
  const s = place('russian', 1, P8);
  assert.equal(E.drawProgress(s), null);
  const k1 = E.applyMove(s, mv(s, 'a1-b2'));
  assert.deepEqual(E.drawProgress(k1), { detail: 'kings-only', movesLeft: 15, limit: 15, rule: 'quiet' });
  const q29 = place('russian', 1, P8, { counters: { quiet: 29 } });
  assert.deepEqual(E.drawProgress(q29), { detail: 'kings-only', movesLeft: 1, limit: 15, rule: 'quiet' });
  const q30 = E.applyMove(q29, mv(q29, 'a1-b2'));
  assert.equal(E.drawProgress(q30).movesLeft, 0);
  assert.equal(E.positionResult(q30).detail, 'kings-only');
  // the 3-kings rule counts the strong side's moves and wins over the slower kings-only count
  const r = place('russian', 1, { W: ['a1', 'a3', 'a5'], B: ['h6'] });
  assert.deepEqual(E.drawProgress(r), { detail: 'endgame', movesLeft: 15, limit: 15, rule: 'r3v1' });
  const r1 = E.applyMove(r, mv(r, 'a1-b2'));
  assert.equal(E.drawProgress(r1).movesLeft, 14);
  const r2 = E.applyMove(r1, mv(r1, 'h6-g5'));
  assert.equal(E.drawProgress(r2).movesLeft, 14, 'the lone king’s moves do not count');
  // Game wrapper: null once the game is over
  const g = new E.Game('russian', {}, r);
  assert.equal(g.drawProgress().rule, 'r3v1');
  g.resign(-1);
  assert.equal(g.drawProgress(), null);
});

test('drawProgress agrees with positionResult along random king endings (all variants)', () => {
  const rand = rng(4242);
  let checked = 0;
  let zeros = 0;
  for (const v of E.VARIANTS) {
    for (const giveaway of [false, true]) {
      for (let k = 0; k < 25; k++) {
        const base = E.createInitialState(v.id);
        const sqs = [];
        for (let i = 0; i < base.board.length; i++) if (E.isPlayableSquare(v, Math.floor(i / v.size), i % v.size)) sqs.push(i);
        const board = new Array(base.board.length).fill(0);
        const total = 2 + Math.floor(rand() * 5);
        const wN = 1 + Math.floor(rand() * (total - 1));
        for (let placed = 0; placed < total; ) {
          const sq = sqs[Math.floor(rand() * sqs.length)];
          if (board[sq]) continue;
          const color = placed < wN ? 1 : -1;
          const row = Math.floor(sq / v.size);
          const king = rand() < 0.75 || (color === 1 && row === 0) || (color === -1 && row === v.size - 1);
          board[sq] = color * (king ? 2 : 1);
          placed++;
        }
        let s = E.deserializeState({ variantId: v.id, board, turn: rand() < 0.5 ? 1 : -1, options: { giveaway } });
        let prev = null;
        let prevMat = '';
        for (let ply = 0; ply < 160; ply++) {
          const moves = E.legalMoves(s);
          const res = E.positionResult(s, moves);
          const dp = E.drawProgress(s);
          if (moves.length && !(res && res.reason === 'insufficient')) {
            const counterDraw = !!res && res.reason === 'move-limit';
            assert.equal(!!dp && dp.movesLeft === 0, counterDraw, `${v.id} ${E.stateToString(s)} ${JSON.stringify(dp)} ${JSON.stringify(res)}`);
            if (counterDraw) {
              assert.equal(dp.detail, res.detail);
              zeros++;
            }
            const mat = JSON.stringify(E.materialCount(s));
            if (prev && dp && prev.rule === dp.rule && mat === prevMat) assert.ok(dp.movesLeft >= prev.movesLeft - 1, 'counts down one move at a time');
            prevMat = mat;
            checked++;
          }
          if (res || !moves.length) break;
          prev = dp;
          s = E.applyMove(s, moves[Math.floor(rand() * moves.length)]);
        }
      }
    }
  }
  assert.ok(checked > 2000 && zeros > 8, `checked ${checked}, draws ${zeros}`); // deterministic (seeded)
});
