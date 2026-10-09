// Variants metadata, initial setups, coordinates, notation, text format, (de)serialization.
import test from 'node:test';
import assert from 'node:assert/strict';
import { E, moveStrs, sq } from './util.js';

const RUSSIAN_BOARD = '.b.b.b.b/b.b.b.b./.b.b.b.b/......../......../w.w.w.w./.w.w.w.w/w.w.w.w.';
const MIRRORED_BOARD = 'b.b.b.b./.b.b.b.b/b.b.b.b./......../......../.w.w.w.w/w.w.w.w./.w.w.w.w';

test('constants and variant list order', () => {
  assert.equal(E.WHITE, 1);
  assert.equal(E.BLACK, -1);
  const ids = E.VARIANTS.map((v) => v.id);
  assert.deepEqual(ids.slice(0, 8), ['russian', 'turkish', 'international', 'english', 'brazilian', 'pool', 'italian', 'canadian']);
  assert.deepEqual(ids.slice(8), ['spanish', 'czech']);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(E.getVariant('turkish').id, 'turkish');
  assert.equal(E.getVariant(E.VARIANTS[0]), E.VARIANTS[0]);
  assert.throws(() => E.getVariant('nope'), /Unknown variant/);
});

test('variant metadata is complete (ru + en) for the UI', () => {
  for (const v of E.VARIANTS) {
    assert.ok([8, 10, 12].includes(v.size), v.id);
    assert.ok(v.playable === 'dark' || v.playable === 'all', v.id);
    assert.ok(v.first === 1 || v.first === -1, v.id);
    assert.equal(typeof v.flag, 'string');
    assert.ok(v.flag.length > 0);
    for (const lang of ['ru', 'en']) {
      assert.ok(v.name[lang] && v.name[lang].length > 3, `${v.id} name.${lang}`);
      assert.ok(v.short[lang] && v.short[lang].length > 10, `${v.id} short.${lang}`);
      assert.ok(Array.isArray(v.badges[lang]) && v.badges[lang].length >= 2 && v.badges[lang].length <= 4, `${v.id} badges.${lang}`);
      assert.ok(Array.isArray(v.rules[lang]), `${v.id} rules.${lang}`);
      assert.ok(v.rules[lang].length >= 5 && v.rules[lang].length <= 9, `${v.id} rules.${lang} has ${v.rules[lang].length} paragraphs`);
      for (const p of v.rules[lang]) assert.ok(typeof p === 'string' && p.length > 30, `${v.id} rules paragraph`);
    }
    assert.equal(v.badges.ru.length, v.badges.en.length, `${v.id} badges ru/en count`);
    assert.equal(v.rules.ru.length, v.rules.en.length, `${v.id} rules ru/en count`);
    // Russian texts are actually Russian
    assert.match(v.rules.ru.join(' '), /[а-яё]{4,}/i);
    assert.match(v.name.ru, /[а-яё]/i);
  }
  for (const lang of ['ru', 'en']) assert.ok(E.GIVEAWAY_RULES[lang].length >= 2);
});

test('who moves first', () => {
  const first = Object.fromEntries(E.VARIANTS.map((v) => [v.id, v.first]));
  assert.deepEqual(first, {
    russian: 1,
    turkish: 1,
    international: 1,
    english: -1,
    brazilian: 1,
    pool: -1,
    italian: 1,
    canadian: 1,
    spanish: 1,
    czech: 1,
  });
  for (const v of E.VARIANTS) assert.equal(E.createInitialState(v.id).turn, v.first);
});

test('initial positions (exact layouts)', () => {
  const s = (id) => E.stateToString(E.createInitialState(id));
  assert.equal(s('russian'), `w:${RUSSIAN_BOARD}`); // example from ARCHITECTURE.md
  assert.equal(s('brazilian'), `w:${RUSSIAN_BOARD}`);
  assert.equal(s('czech'), `w:${RUSSIAN_BOARD}`);
  assert.equal(s('english'), `b:${RUSSIAN_BOARD}`);
  assert.equal(s('pool'), `b:${RUSSIAN_BOARD}`);
  assert.equal(s('italian'), `w:${MIRRORED_BOARD}`);
  assert.equal(s('spanish'), `w:${MIRRORED_BOARD}`);
  assert.equal(s('turkish'), 'w:......../bbbbbbbb/bbbbbbbb/......../......../wwwwwwww/wwwwwwww/........');
  assert.equal(
    s('international'),
    'w:.b.b.b.b.b/b.b.b.b.b./.b.b.b.b.b/b.b.b.b.b./........../........../.w.w.w.w.w/w.w.w.w.w./.w.w.w.w.w/w.w.w.w.w.',
  );
  const can = E.createInitialState('canadian');
  const rows = E.stateToString(can).slice(2).split('/');
  assert.equal(rows.length, 12);
  for (let r = 0; r < 12; r++) {
    const ch = r < 5 ? 'b' : r >= 7 ? 'w' : null;
    const expected = Array.from({ length: 12 }, (_, c) => ((r + c) % 2 === 1 && ch ? ch : '.')).join('');
    assert.equal(rows[r], expected, `canadian row ${r}`);
  }
});

test('initial piece counts and counters', () => {
  for (const v of E.VARIANTS) {
    const s = E.createInitialState(v.id);
    assert.equal(s.board.length, v.size * v.size);
    assert.ok(s.board instanceof Int8Array);
    const m = E.materialCount(s);
    assert.deepEqual(m, { wm: v.piecesPerSide, wk: 0, bm: v.piecesPerSide, bk: 0 }, v.id);
    assert.equal(s.ply, 0);
    assert.equal(s.counters.quiet, 0);
    assert.deepEqual(s.options, { giveaway: false });
    assert.equal(E.positionResult(s), null);
    // pieces only on playable squares
    for (let i = 0; i < s.board.length; i++) {
      const [r, c] = E.sqToRc(i, v.size);
      if (!E.isPlayableSquare(v, r, c)) assert.equal(s.board[i], 0);
    }
  }
  assert.deepEqual(E.createInitialState('russian', { giveaway: true }).options, { giveaway: true });
});

test('playable squares / board orientation', () => {
  const ru = E.getVariant('russian');
  assert.equal(E.isPlayableSquare(ru, 7, 0), true); // a1 dark
  assert.equal(E.isPlayableSquare(ru, 7, 7), false); // h1 light
  assert.equal(E.isPlayableSquare(ru, 0, 7), true); // h8
  assert.equal(E.isPlayableSquare('international', 9, 0), true); // square 46
  assert.equal(E.isPlayableSquare('international', 0, 0), false);
  assert.equal(E.isPlayableSquare('canadian', 11, 0), true);
  for (const id of ['italian', 'spanish']) {
    assert.equal(E.isPlayableSquare(id, 7, 7), true, `${id}: bottom-right corner is a playing square`);
    assert.equal(E.isPlayableSquare(id, 7, 0), false);
    assert.equal(E.isPlayableSquare(id, 0, 0), true);
  }
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) assert.equal(E.isPlayableSquare('turkish', r, c), true);
  assert.equal(E.isPlayableSquare('russian', -1, 0), false);
  assert.equal(E.isPlayableSquare('russian', 8, 1), false);
});

test('rcToSq / sqToRc', () => {
  assert.equal(E.rcToSq(5, 2, 8), 42);
  assert.deepEqual(E.sqToRc(42, 8), [5, 2]);
  assert.equal(E.rcToSq(9, 8, 10), 98);
  assert.deepEqual(E.sqToRc(143, 12), [11, 11]);
  for (let s = 0; s < 144; s++) assert.equal(E.rcToSq(...E.sqToRc(s, 12), 12), s);
});

test('square names', () => {
  assert.equal(E.squareName('russian', 56), 'a1');
  assert.equal(E.squareName('russian', 7), 'h8');
  assert.equal(E.squareName('russian', 42), 'c3');
  assert.equal(E.squareName('russian', 0), '?'); // a8 is a light square in Russian
  assert.equal(E.squareName('turkish', 0), 'a8');
  assert.equal(E.squareName('turkish', 63), 'h1');
  assert.equal(E.squareName('italian', 63), 'h1');
  assert.equal(E.squareName('italian', 0), 'a8');
  assert.equal(E.squareName('international', 1), '1');
  assert.equal(E.squareName('international', 90), '46');
  assert.equal(E.squareName('international', 98), '50');
  assert.equal(E.squareName('canadian', 1), '1');
  assert.equal(E.squareName('canadian', 142), '72');
  for (const v of E.VARIANTS) {
    const g = E.createInitialState(v.id);
    let count = 0;
    for (let s = 0; s < g.board.length; s++) {
      const name = E.squareName(v.id, s);
      if (name === '?') continue;
      count++;
      assert.equal(E.parseSquare(v.id, name), s, `${v.id} ${name}`);
    }
    assert.equal(count, v.playable === 'all' ? v.size * v.size : (v.size * v.size) / 2);
  }
  assert.equal(E.parseSquare('russian', 'a8'), -1);
  assert.equal(E.parseSquare('international', '51'), -1);
});

test('move strings and parsing', () => {
  const s = E.createInitialState('russian');
  assert.deepEqual(moveStrs(s), ['a3-b4', 'c3-b4', 'c3-d4', 'e3-d4', 'e3-f4', 'g3-f4', 'g3-h4']);
  const intl = E.createInitialState('international');
  assert.deepEqual(moveStrs(intl), ['31-26', '31-27', '32-27', '32-28', '33-28', '33-29', '34-29', '34-30', '35-30']);
  const cap = E.stateFromString('russian', 'w:......../......../......../..b.b.../.w....../......../......../........');
  // white man b4 jumps c5 (forward) and then e5 (backward) — Russian men capture backwards
  assert.deepEqual(moveStrs(cap), ['b4:d6:f4']);
  for (const m of E.legalMoves(cap)) {
    const str = E.moveToString('russian', m);
    if (m.captures.length) assert.match(str, /^[a-h][1-8](:[a-h][1-8])+$/);
    else assert.match(str, /^[a-h][1-8]-[a-h][1-8]$/);
  }
  assert.equal(
    E.moveToString('international', { path: [sq('international', '28'), sq('international', '19'), sq('international', '10')], captures: [1, 2] }),
    '28x19x10',
  );
  assert.equal(E.moveToString('russian', { path: [42, 28, 14], captures: [35, 21] }), 'c3:e5:g7');
  assert.deepEqual(E.parseMove('russian', 'c3:e5:g7'), [42, 28, 14]);
  assert.deepEqual(E.parseMove('russian', 'c3xe5'), [42, 28]);
  assert.deepEqual(E.parseMove('russian', ' c3-d4 '), [42, 35]);
  assert.deepEqual(E.parseMove('international', '32-28'), [sq('international', '32'), sq('international', '28')]);
  assert.equal(E.parseMove('russian', 'c3'), null);
  assert.equal(E.parseMove('russian', 'c3-z9'), null);
});

test('text position round-trips and validation', () => {
  for (const v of E.VARIANTS) {
    const s = E.createInitialState(v.id);
    const str = E.stateToString(s);
    const back = E.stateFromString(v.id, str);
    assert.deepEqual(Array.from(back.board), Array.from(s.board));
    assert.equal(back.turn, s.turn);
    assert.equal(E.stateToString(back), str);
    const gw = E.createInitialState(v.id, { giveaway: true });
    assert.ok(E.stateToString(gw).endsWith('|giveaway'));
    assert.equal(E.stateFromString(v.id, E.stateToString(gw)).options.giveaway, true);
  }
  assert.equal(E.stateFromString('russian', `b:${RUSSIAN_BOARD}`, { giveaway: true }).options.giveaway, true);
  // lenient whitespace / case of the side char
  const spaced = E.stateFromString('russian', ` W : ${RUSSIAN_BOARD.replace(/\//g, ' / ')} `);
  assert.equal(E.stateToString(spaced), `w:${RUSSIAN_BOARD}`);
  assert.throws(() => E.stateFromString('russian', 'w:........'), /rows/);
  assert.throws(() => E.stateFromString('russian', `x:${RUSSIAN_BOARD}`));
  assert.throws(() => E.stateFromString('russian', `w:${RUSSIAN_BOARD.replace('.b.b.b.b', 'b.b.b.b.')}`), /unplayable/);
  assert.throws(() => E.stateFromString('russian', `w:${RUSSIAN_BOARD.replace('.b.b.b.b', '.b.b.b.q')}`), /bad char/);
  assert.throws(() => E.stateFromString('russian', `w:${RUSSIAN_BOARD.replace('.b.b.b.b', '.b.b.b.')}`), /chars/);
  // ply / counters passthrough
  const withCounters = E.stateFromString('russian', `w:${RUSSIAN_BOARD}`, { ply: 12, counters: { quiet: 7 } });
  assert.equal(withCounters.ply, 12);
  assert.equal(withCounters.counters.quiet, 7);
});

test('serialize / deserialize round-trip (JSON-safe)', () => {
  for (const v of E.VARIANTS) {
    let s = E.createInitialState(v.id, { giveaway: v.id === 'pool' });
    for (let i = 0; i < 6; i++) s = E.applyMove(s, E.legalMoves(s)[i % E.legalMoves(s).length]);
    const obj = JSON.parse(JSON.stringify(E.serializeState(s)));
    assert.ok(Array.isArray(obj.board));
    const back = E.deserializeState(obj);
    assert.ok(back.board instanceof Int8Array);
    assert.deepEqual(Array.from(back.board), Array.from(s.board));
    assert.equal(back.turn, s.turn);
    assert.equal(back.ply, s.ply);
    assert.deepEqual(back.counters, { ...s.counters, eg: Array.from(s.counters.eg) });
    assert.deepEqual(back.options, s.options);
    assert.equal(E.hashState(back), E.hashState(s));
    assert.deepEqual(moveStrs(back), moveStrs(s));
  }
  assert.throws(() => E.deserializeState({ variantId: 'russian', board: [1, 2], turn: 1 }), /board size/);
  assert.throws(() => E.deserializeState({ variantId: 'nope', board: [], turn: 1 }), /Unknown variant/);
  const bad = E.serializeState(E.createInitialState('russian'));
  bad.turn = 3;
  assert.throws(() => E.deserializeState(bad), /turn/);
});

test('cloneState is deep; applyMove never mutates its input', () => {
  const s = E.createInitialState('russian');
  const c = E.cloneState(s);
  c.board[0] = 2;
  c.counters.quiet = 99;
  c.options.giveaway = true;
  assert.equal(s.board[0], 0);
  assert.equal(s.counters.quiet, 0);
  assert.equal(s.options.giveaway, false);
  const before = E.stateToString(s);
  const beforeCounters = JSON.stringify(E.serializeState(s));
  const m = E.legalMoves(s)[0];
  const next = E.applyMove(s, m);
  assert.equal(E.stateToString(s), before);
  assert.equal(JSON.stringify(E.serializeState(s)), beforeCounters);
  assert.notEqual(next.board, s.board);
  assert.equal(next.turn, -s.turn);
  assert.equal(next.ply, 1);
});

test('hashState identifies board + side to move', () => {
  const a = E.createInitialState('russian');
  const b = E.stateFromString('russian', E.stateToString(a));
  assert.equal(E.hashState(a), E.hashState(b));
  const c = E.stateFromString('russian', `b:${RUSSIAN_BOARD}`);
  assert.notEqual(E.hashState(a), E.hashState(c));
  const d = E.applyMove(a, E.legalMoves(a)[0]);
  assert.notEqual(E.hashState(a), E.hashState(d));
  assert.equal(typeof E.hashState(a), 'string');
});

test('applyMove rejects moves that do not fit the position', () => {
  const s = E.createInitialState('russian');
  assert.throws(() => E.applyMove(s, { from: sq('russian', 'd4'), to: sq('russian', 'e5'), path: [], captures: [], promotion: false }), /no piece/);
  assert.throws(() => E.applyMove(s, { from: sq('russian', 'b6'), to: sq('russian', 'a5'), path: [], captures: [], promotion: false }), /no piece/);
  assert.throws(
    () => E.applyMove(s, { from: sq('russian', 'c3'), to: sq('russian', 'b2'), path: [], captures: [], promotion: false }),
    /occupied/,
  );
});

test('hand-built states without counters still work', () => {
  const ref = E.createInitialState('russian');
  const bare = { variantId: 'russian', size: 8, board: ref.board.slice(), turn: 1 };
  assert.equal(E.positionResult(bare), null);
  const next = E.applyMove(bare, E.legalMoves(bare)[0]);
  assert.equal(next.ply, 1);
  assert.deepEqual(E.materialCount(next), { wm: 12, wk: 0, bm: 12, bk: 0 });
  assert.equal(next.counters.quiet, 0);
});
