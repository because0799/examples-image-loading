// Draw handling of the AI: contempt against early repetitions (RTR-01), dead-drawn endings scored
// as draws and no king given away in endings drawn by rule (RTR-03), endgame-rule mirror (RTR-04,
// pool 13 moves).
import test from 'node:test';
import assert from 'node:assert/strict';
import { E, place } from './helpers.js';
import { search, resetSearch } from '../../src/ai/search.js';
import { SearchBoard } from '../../src/ai/board.js';
import { evaluate, getEvalTables } from '../../src/ai/evaluate.js';

const NODES = { maxNodes: 60000, timeMs: 60000 };

function scoreOf(r, path) {
  const x = r.scores.find((s) => JSON.stringify(s.path) === JSON.stringify(path));
  assert.ok(x, 'move scored');
  return x.score;
}

test('contempt: a repetition in a full middlegame scores −contempt for the side to move', () => {
  // Turkish, 14 v 14, sideways shuffles do not reset the no-progress counter
  const s = E.stateFromString('turkish', 'w:......../bbbbbbb./bbbbbbb./......../......../wwwwwww./wwwwwww./........', {
    counters: { quiet: 10 },
  });
  const m = E.findMove(E.legalMoves(s), E.parseMove('turkish', 'g3-h3'));
  const after = E.applyMove(s, m);
  const history = [E.hashState(after), E.hashState(s)];
  const withC = search(s, { level: 4, ...NODES, seed: 1, newGame: true, allScores: true, historyHashes: history });
  assert.equal(scoreOf(withC, m.path), -20, 'repeating is slightly bad for the side that runs the search');
  assert.notDeepEqual(withC.path, m.path, 'and it plays something else');
  const noC = search(s, { level: 4, ...NODES, seed: 1, newGame: true, allScores: true, historyHashes: history, params: { contempt: 0 } });
  assert.equal(scoreOf(noC, m.path), 0);
  // black to move: the same holds from Black's side (and the TT salt keeps the sides apart)
  const sb = E.stateFromString('turkish', 'b:......../.bbbbbbb/.bbbbbbb/......../......../.wwwwwww/.wwwwwww/........', {
    counters: { quiet: 10 },
  });
  const mb = E.findMove(E.legalMoves(sb), E.parseMove('turkish', 'b6-a6'));
  const afterB = E.applyMove(sb, mb);
  const rb = search(sb, { level: 4, ...NODES, seed: 1, allScores: true, historyHashes: [E.hashState(afterB), E.hashState(sb)] });
  assert.equal(scoreOf(rb, mb.path), -20);
});

test('contempt is off in endings (below a third of the material) and in giveaway', () => {
  // Russian kings ending: 2 v 2 — repetition is a plain draw with the material tie-break (0 here)
  const s = place('russian', 1, { W: ['a1', 'c1'], B: ['h8', 'f8'] }, { counters: { quiet: 10 } });
  const m = E.findMove(E.legalMoves(s), E.parseMove('russian', 'c1-d2'));
  const after = E.applyMove(s, m);
  const r = search(s, { level: 4, ...NODES, seed: 1, newGame: true, allScores: true, historyHashes: [E.hashState(after), E.hashState(s)] });
  assert.equal(scoreOf(r, m.path), 0);
  // giveaway middlegame: no contempt, no tie-break
  const g = E.stateFromString('turkish', 'w:......../bbbbbbb./bbbbbbb./......../......../wwwwwww./wwwwwww./........', {
    giveaway: true,
    counters: { quiet: 10 },
  });
  const mg = E.findMove(E.legalMoves(g), E.parseMove('turkish', 'g3-h3'));
  const ag = E.applyMove(g, mg);
  const rg = search(g, { level: 4, ...NODES, seed: 1, newGame: true, allScores: true, historyHashes: [E.hashState(ag), E.hashState(g)] });
  assert.equal(scoreOf(rg, mg.path), 0);
});

test('equal-level Turkish AI games do not end in an early threefold repetition (RTR-01)', () => {
  // Seeds 1000..1485 reproduced the bug before the fix: games 1 and 4 ended by repetition at plies
  // 67 and 58 with 32 and 28 pieces on the board.
  for (let gi = 0; gi < 6; gi++) {
    resetSearch();
    const g = new E.Game('turkish');
    let seed = 1000 + gi * 97;
    while (!g.result && g.history.length < 90) {
      const r = search(g.state, { level: 3, ...NODES, maxNodes: 20000, historyHashes: g.hashes, seed: seed++ });
      g.play(r.path);
    }
    const m = E.materialCount(g.state);
    const pieces = m.wm + m.wk + m.bm + m.bk;
    assert.ok(!(g.result && g.result.reason === 'repetition' && pieces > 20), `game ${gi}: ${JSON.stringify(g.result)} at ply ${g.history.length} with ${pieces} pieces`);
  }
});

test('dead-drawn endings evaluate as draws, without jitter (RTR-03)', () => {
  const cases = [
    ['russian', { W: ['a1', 'c1'], B: ['h8'] }, 2],
    ['russian', { W: ['a1'], w: ['c3'], B: ['h8'] }, 2],
    ['international', { W: ['46', '47'], B: ['5'] }, 2],
    ['pool', { W: ['a1', 'c1'], B: ['h8'] }, 2],
    ['turkish', { W: ['a1', 'h1'], B: ['d5'] }, 2],
  ];
  for (const [id, pieces, expect] of cases) {
    const s = place(id, 1, pieces);
    const b = new SearchBoard(id, false);
    b.load(s);
    const e = getEvalTables(id);
    for (const seed of [1, 2, 3, 99, 12345]) assert.equal(evaluate(b, e, 8, seed), expect, `${id} seed ${seed}`);
    const sb = place(id, -1, pieces);
    b.load(sb);
    assert.equal(evaluate(b, e, 8, 7), -expect, `${id} black to move`);
  }
  // 3 kings vs a lone king off the main road is a real win and keeps its full value
  const win = place('russian', 1, { W: ['a1', 'c1', 'e1'], B: ['h6'] });
  const b = new SearchBoard('russian', false);
  b.load(win);
  assert.ok(evaluate(b, getEvalTables('russian'), 0, 0) > 300);
});

test('no king is given away in an ending that the rules are about to draw (RTR-03)', () => {
  // Russian: kings c1 e1 g1 vs a1; after c1-f4 a1-b2 e1-h4 b2-g7 h4-d8 g7-h8 the lone king holds the
  // main road and the 5-move limit is close. f4-e5?? used to score +20 (2 kings vs 1 > a draw).
  const st = place('russian', 1, { W: ['c1', 'e1', 'g1'], B: ['a1'] });
  const g = new E.Game('russian', {}, st);
  for (const m of 'c1-f4 a1-b2 e1-h4 b2-g7 h4-d8 g7-h8'.split(' ')) g.play(E.parseMove('russian', m));
  for (const level of [3, 4, 5]) {
    for (const seed of [1, 2, 3]) {
      const r = search(g.state, { level, ...NODES, seed, newGame: true, historyHashes: g.hashes });
      const ns = E.applyMove(g.state, E.findMove(E.legalMoves(g.state), r.path));
      const over = E.positionResult(ns);
      const hangs = !over && E.legalMoves(ns).some((x) => x.captures.length > 0);
      assert.ok(!hangs, `level ${level} seed ${seed}: ${E.moveToString('russian', E.findMove(E.legalMoves(g.state), r.path))} (${r.score}) hangs a king`);
      assert.ok(Math.abs(r.score) < 50, `a draw score (${r.score})`);
    }
  }
});

test('search board mirrors the engine’s endgame rules: 3 kings + men vs a lone king, pool 13 moves', () => {
  for (const [id, str] of [
    ['russian', 'w:......../B......./......../......../......../......../...W.W.W/w.w.w.w.'],
    ['pool', 'w:......../B......./......../......../......../......../...W.W.W/w.w.w.w.'],
    ['pool', 'w:.......B/......../......../......../......../......../......../W.W.W...'],
  ]) {
    let s = E.stateFromString(id, str);
    const b = new SearchBoard(id, false);
    let draws = 0;
    for (let ply = 0; ply < 40; ply++) {
      const moves = E.legalMoves(s).filter((m) => m.captures.length === 0);
      const all = E.legalMoves(s);
      const res = E.positionResult(s, all);
      b.load(s);
      if (all.length) assert.equal(b.drawByRule(), !!res && res.winner === 0, `${id} ply ${ply} ${E.stateToString(s)} ${JSON.stringify(s.counters.eg)}`);
      if (res) {
        draws++;
        break;
      }
      // prefer quiet king moves of the strong side so the count runs
      const pick = (moves.length ? moves : all).find((m) => Math.abs(m.piece) === 2) || all[0];
      s = E.applyMove(s, pick);
    }
    assert.equal(draws, 1, `${id}: the 3-kings limit ended the walk`);
  }
});
