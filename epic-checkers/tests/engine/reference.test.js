// Differential tests: the engine generator vs the independent naive reference generator,
// on perft trees from the start and on thousands of random positions for every variant.
import test from 'node:test';
import assert from 'node:assert/strict';
import { E, rng } from './util.js';
import { referenceMoves, outcomeKey } from './reference.js';

function engineMap(state) {
  const map = new Map();
  for (const m of E.legalMoves(state)) {
    const key = outcomeKey(m);
    assert.ok(!map.has(key), `engine returned duplicate outcome ${key}`);
    const paths = [m.path, ...(m.alts || [])].map((p) => p.join('-')).sort();
    map.set(key, { move: m, paths });
  }
  return map;
}

function referenceMap(v, state) {
  const map = new Map();
  for (const m of referenceMoves(v, state.board, state.turn)) {
    const key = outcomeKey(m);
    if (!map.has(key)) map.set(key, { list: [], paths: [] });
    const e = map.get(key);
    e.list.push(m);
    e.paths.push(m.path.join('-'));
  }
  for (const e of map.values()) e.paths.sort();
  return map;
}

function compare(v, state) {
  const a = engineMap(state);
  const b = referenceMap(v, state);
  const where = E.stateToString(state);
  assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort(), `outcome sets differ in ${v.id} ${where}`);
  for (const [key, { move, paths }] of a) {
    const ref = b.get(key);
    assert.deepEqual(paths, ref.paths, `paths differ for ${key} in ${v.id} ${where}`);
    const same = ref.list.find((m) => m.path.join('-') === move.path.join('-'));
    assert.deepEqual(move.captures, same.captures, `capture order differs ${where}`);
    assert.deepEqual(move.captured, same.captured, `captured codes differ ${where}`);
    assert.equal(move.promotion, same.promotion, `promotion differs ${where}`);
    assert.equal(move.promotionAt, same.promotionAt, `promotionAt differs ${where}`);
    assert.equal(move.piece, same.piece);
  }
}

function randomPosition(v, rand, maxMen, maxKings) {
  const g = E.getVariant(v.id);
  const n = g.size;
  const squares = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (E.isPlayableSquare(v, r, c)) squares.push([r, c]);
  // shuffle
  for (let i = squares.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [squares[i], squares[j]] = [squares[j], squares[i]];
  }
  const rows = Array.from({ length: n }, () => Array(n).fill('.'));
  let k = 0;
  const put = (ch, count, avoidRow) => {
    let placed = 0;
    while (placed < count && k < squares.length) {
      const [r, c] = squares[k++];
      if (r === avoidRow) continue;
      rows[r][c] = ch;
      placed++;
    }
  };
  put('w', Math.floor(rand() * (maxMen + 1)), 0);
  put('W', Math.floor(rand() * (maxKings + 1)), -1);
  put('b', Math.floor(rand() * (maxMen + 1)), n - 1);
  put('B', Math.floor(rand() * (maxKings + 1)), -1);
  const turn = rand() < 0.5 ? 'w' : 'b';
  return E.stateFromString(v.id, `${turn}:${rows.map((r) => r.join('')).join('/')}`);
}

function refPerft(v, state, depth) {
  if (depth === 0) return 1;
  const ms = referenceMoves(v, state.board, state.turn);
  // count outcomes (dedup like the engine)
  const uniq = new Map();
  for (const m of ms) if (!uniq.has(outcomeKey(m))) uniq.set(outcomeKey(m), m);
  if (depth === 1) return uniq.size;
  let total = 0;
  for (const m of uniq.values()) total += refPerft(v, E.applyMove(state, m), depth - 1);
  return total;
}

for (const v of E.VARIANTS) {
  test(`${v.id}: engine perft equals reference perft from the start`, () => {
    const s = E.createInitialState(v.id);
    const depth = v.size >= 10 ? 4 : 5;
    for (let d = 1; d <= depth; d++) {
      const enginePerft = (st, dd) => {
        if (dd === 0) return 1;
        const ms = E.legalMoves(st);
        if (dd === 1) return ms.length;
        return ms.reduce((acc, m) => acc + enginePerft(E.applyMove(st, m), dd - 1), 0);
      };
      assert.equal(enginePerft(s, d), refPerft(v, s, d), `${v.id} perft(${d})`);
    }
  });

  test(`${v.id}: engine move sets equal the reference on random positions`, () => {
    const rand = rng(0x5eed + v.size * 31 + v.id.length * 7 + v.id.charCodeAt(0));
    const count = v.size === 12 ? 500 : v.size === 10 ? 800 : 1500;
    let captures = 0;
    let multi = 0;
    for (let i = 0; i < count; i++) {
      const many = i % 3 === 0;
      const state = randomPosition(v, rand, many ? 12 : 6, many ? 2 : 4);
      compare(v, state);
      const ms = E.legalMoves(state);
      if (ms.length && ms[0].captures.length) captures++;
      if (ms.some((m) => m.captures.length >= 2)) multi++;
    }
    // sanity: the random sample must exercise captures and multi-captures
    assert.ok(captures > count / 10, `${v.id}: too few capture positions (${captures})`);
    assert.ok(multi > 10, `${v.id}: too few multi-capture positions (${multi})`);
  });

  test(`${v.id}: engine equals reference along random playouts`, () => {
    const rand = rng(0xabc + v.id.charCodeAt(1) * 13 + v.size);
    for (let gi = 0; gi < 40; gi++) {
      let s = E.createInitialState(v.id);
      for (let ply = 0; ply < 400; ply++) {
        compare(v, s);
        const ms = E.legalMoves(s);
        if (!ms.length || E.positionResult(s, ms)) break;
        s = E.applyMove(s, ms[Math.floor(rand() * ms.length)]);
      }
    }
  });
}
