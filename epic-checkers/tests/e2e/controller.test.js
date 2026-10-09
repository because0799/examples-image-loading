// Controller unit tests (node:test) with mocked renderer / UI / Director / AI — covers tap-by-tap
// path entry (incl. equivalent `alts` routes), auto-complete, final-destination taps, undo rules,
// stats + hype (ULTIMATE reset), stale AI answers and game over. Runs as part of `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Controller, routeMove } from '../../src/controller.js';
import { stateFromString, legalMoves, rcToSq } from '../../src/engine/index.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(n = 20) {
  for (let i = 0; i < n; i++) await tick();
}

function deferred() {
  let resolve;
  const p = new Promise((r) => (resolve = r));
  return { p, resolve };
}

function makeEnv({ aiMode = 'auto' } = {}) {
  const calls = [];
  const board = { cells: null, size: 8 };
  const hl = { state: { selectable: [], selected: -1, targets: [], capture: false, path: null, hint: null, lastMove: null } };
  for (const k of ['setSelectable', 'setSelected', 'setTargets', 'setPath', 'setHint', 'setLastMove']) {
    hl[k] = (v, o) => {
      const key = { setSelectable: 'selectable', setSelected: 'selected', setTargets: 'targets', setPath: 'path', setHint: 'hint', setLastMove: 'lastMove' }[k];
      hl.state[key] = v;
      if (k === 'setTargets') hl.state.capture = !!(o && o.capture);
    };
  }
  hl.clear = () => Object.assign(hl.state, { selectable: [], selected: -1, targets: [], path: null, hint: null });
  const taps = [];
  const renderer = {
    clock: { realNow: 0 },
    camera: { snap() {} },
    layers: { world: { visible: false, alpha: 1 } },
    highlights: hl,
    variant: null,
    setTheme() {},
    setQuality() {},
    setVariant(v) {
      this.variant = v;
      board.size = v.size;
    },
    setBoardRect() {},
    setTurnGlow() {},
    setPosition(state) {
      board.cells = Int8Array.from(state.board);
      board.size = state.size;
    },
    pieceAt(sq) {
      const c = board.cells ? board.cells[sq] : 0;
      return c ? { color: Math.sign(c), isKing: Math.abs(c) === 2 } : null;
    },
    onTap() {},
    onSquareTap(fn) {
      taps.push(fn);
    },
  };
  const hudState = {};
  const hud = new Proxy(
    { state: hudState },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        return (...a) => calls.push(['hud.' + String(prop), ...a]);
      },
    },
  );
  let gameOverChoice = deferred();
  const ui = {
    hud,
    currentScreen: 'menu',
    showScreen(name) {
      this.currentScreen = name;
    },
    boardSlotRect: () => ({ x: 0, y: 0, width: 400, height: 400 }),
    showGameOver(opts) {
      calls.push(['showGameOver', opts]);
      return gameOverChoice.p;
    },
    handleBack: () => true,
  };
  const director = {
    busy: false,
    moves: [],
    setMode() {},
    skip() {},
    syncPosition() {},
    playMove(o) {
      this.moves.push(o);
      renderer.setPosition(o.after);
      return Promise.resolve();
    },
    playGameStart: () => Promise.resolve(),
    playTurn: () => Promise.resolve(),
    playGameOver: (o) => {
      calls.push(['playGameOver', o]);
      return Promise.resolve();
    },
    playSelect: (sq) => calls.push(['select', sq]),
    playDeselect: () => calls.push(['deselect']),
    playIllegal: (sq) => calls.push(['illegal', sq]),
    playHint: () => Promise.resolve(),
  };
  const pending = [];
  const ai = {
    busy: false,
    think(state) {
      if (aiMode === 'manual') {
        const d = deferred();
        pending.push({ state, d });
        return d.p;
      }
      const m = legalMoves(state)[0];
      return Promise.resolve(m ? { path: m.path } : { path: null });
    },
    hint(state) {
      const m = legalMoves(state)[0];
      return Promise.resolve({ path: m.path });
    },
    cancel() {
      for (const p of pending.splice(0)) p.d.resolve(null);
    },
    newGame() {},
  };
  const audio = { play() {}, music() {}, setIntensity() {}, setSfxVolume() {}, setMusicVolume() {}, currentTrack: null };
  const native = { keepScreenOn() {} };
  const settings = { showMoves: true, lang: 'ru', quality: 'high', animSpeed: 1 };
  const statsStore = {
    record: (s) => {
      calls.push(['record', s]);
      return { newRecords: [], newTitles: [] };
    },
    currentTitle: () => null,
  };
  const c = new Controller({ ui, renderer, fx: null, director, audio, ai, native, settings, statsStore, opts: { fast: true } });
  const tap = async (sq) => {
    taps.forEach((fn) => fn(sq));
    await settle();
  };
  return { c, renderer, hl, director, ai, pending, ui, calls, tap, board, chooseGameOver: (v) => gameOverChoice.resolve(v) };
}

// Russian: white man e3 must take d4, then b6 (→ a7) or d6 (→ e7)
const BRANCH = 'w:.......b/......../.b.b..../......../...b..../....w.../......../w.......';
const SQ = { e3: 44, c5: 26, e7: 12, a7: 8, a1: 56 };

test('routeMove re-orders captures to follow an equivalent route', () => {
  const I = (r, c) => rcToSq(r, c, 10);
  const s = stateFromString('international', 'w:.........b/........../........../..b.b...../........../..b.b...../...w....../........../........../..........');
  const [m] = legalMoves(s);
  assert.ok(m.alts && m.alts.length === 1);
  const d = routeMove(m, m.alts[0], 10);
  assert.deepEqual(d.path, m.alts[0]);
  assert.deepEqual([...d.captures].sort(), [...m.captures].sort());
  // every capture lies between the two landing squares of its hop
  for (let i = 0; i < d.captures.length; i++) {
    const a = d.path[i];
    const b = d.path[i + 1];
    const mid = I((Math.floor(a / 10) + Math.floor(b / 10)) / 2, ((a % 10) + (b % 10)) / 2);
    assert.equal(d.captures[i], mid);
  }
  assert.equal(routeMove(m, m.path, 10), m);
});

test('tap-by-tap capture entry with a branch, auto-complete and stats', async () => {
  const env = makeEnv();
  const { c, tap, hl, director } = env;
  await c.startGame({ variantId: 'russian', mode: 'pvp', epic: true }, { startState: stateFromString('russian', BRANCH), intro: false });
  await settle();
  assert.equal(c.phase, 'human');
  // single forced capturer is auto-selected
  assert.deepEqual(c.sel.prefix, [SQ.e3]);
  assert.deepEqual(hl.state.targets, [SQ.c5]);
  assert.equal(hl.state.capture, true);
  await tap(SQ.e3); // stays selected (auto)
  assert.deepEqual(c.sel.prefix, [SQ.e3]);
  await tap(SQ.c5);
  assert.deepEqual(c.sel.prefix, [SQ.e3, SQ.c5]);
  assert.deepEqual([...hl.state.targets].sort((a, b) => a - b), [SQ.a7, SQ.e7]);
  assert.deepEqual(hl.state.path, [SQ.e3, SQ.c5]);
  await tap(SQ.e7);
  await settle(40);
  assert.equal(director.moves.length, 1);
  assert.deepEqual(director.moves[0].move.path, [SQ.e3, SQ.c5, SQ.e7]);
  assert.equal(director.moves[0].mover, 1);
  assert.equal(director.moves[0].stats.hype[1], 0, 'Director gets the pre-move hype');
  assert.equal(c.stats.captures[1], 2);
  assert.equal(c.stats.maxCombo[1], 2);
  assert.equal(c.stats.piecesLost[-1], 2);
  assert.ok(c.stats.hype[1] > 0.5 && c.stats.hype[1] < 1);
  assert.ok(c.stats.hype[-1] > 0);
  assert.equal(c.mismatches, 0);
  // pvp: black to move now, human again
  assert.equal(c.phase, 'human');
  assert.equal(c.game.state.turn, -1);
});

test('a tap on a final destination commits the unique move; undo in pvp takes one ply', async () => {
  const { c, tap, director } = makeEnv();
  await c.startGame({ variantId: 'russian', mode: 'pvp', epic: false }, { startState: stateFromString('russian', BRANCH), intro: false });
  await settle();
  await tap(SQ.a7);
  await settle(40);
  assert.deepEqual(director.moves[0].move.path, [SQ.e3, SQ.c5, SQ.a7]);
  assert.equal(c.game.history.length, 1);
  await c.undo();
  await settle();
  assert.equal(c.game.history.length, 0);
  assert.equal(c.stats.captures[1], 0, 'stats restored');
  assert.equal(c.phase, 'human');
});

test('illegal taps: an immovable own piece / empty square while a capture is mandatory', async () => {
  const { c, tap, calls } = makeEnv();
  await c.startGame({ variantId: 'russian', mode: 'pvp', epic: false }, { startState: stateFromString('russian', BRANCH), intro: false });
  await settle();
  await tap(SQ.a1); // own piece that cannot move (capture is mandatory elsewhere)
  assert.ok(calls.some((x) => x[0] === 'illegal' && x[1] === SQ.a1));
  assert.ok(calls.some((x) => x[0] === 'hud.setStatus' && x[2] && x[2].tone === 'alert'));
  assert.deepEqual(c.sel.prefix, [SQ.e3], 'selection kept');
});

test('ai mode: undo goes back to the human turn and a stale AI answer is ignored', async () => {
  const env = makeEnv({ aiMode: 'manual' });
  const { c, pending, tap } = env;
  await c.startGame({ variantId: 'russian', mode: 'ai', humanColor: 1, level: 1, epic: true }, { intro: false });
  await settle();
  assert.equal(c.phase, 'human');
  const first = c.game.moves.find((m) => m.path.length === 2);
  await tap(first.path[0]);
  await tap(first.path[1]);
  await settle(40);
  assert.equal(c.phase, 'ai');
  assert.equal(pending.length, 1);
  const stale = pending[0];
  await c.undo(); // cancels the AI (its promise resolves null)
  await settle(40);
  assert.equal(c.game.history.length, 0);
  assert.equal(c.phase, 'human');
  stale.d.resolve({ path: legalMoves(stale.state)[0].path }); // late answer: ignored
  await settle(40);
  assert.equal(c.game.history.length, 0);
  // now let the AI answer properly
  await tap(first.path[0]);
  await tap(first.path[1]);
  await settle(40);
  const req = pending[pending.length - 1];
  req.d.resolve({ path: legalMoves(req.state)[0].path });
  await settle(80);
  assert.equal(c.game.history.length, 2);
  assert.equal(c.phase, 'human');
  // undo after the AI replied: back two plies to the human's turn
  await c.undo();
  await settle(40);
  assert.equal(c.game.history.length, 0);
  assert.equal(c.game.state.turn, 1);
});

test('hype: full meter makes the next capture the ULTIMATE and resets it', async () => {
  const { c, director, tap } = makeEnv();
  await c.startGame({ variantId: 'russian', mode: 'pvp', epic: true }, { startState: stateFromString('russian', BRANCH), intro: false });
  await settle();
  c.stats.hype[1] = 1;
  await tap(SQ.a7);
  await settle(40);
  assert.equal(director.moves[0].stats.hype[1], 1, 'Director sees a full meter → ULTIMATE');
  assert.equal(c.stats.hype[1], 0, 'meter spent');
  assert.equal(c.stats.ultimates[1], 1);
});

test('game over: resign → playGameOver, stats recorded, showGameOver → menu stops the game', async () => {
  const env = makeEnv();
  const { c, calls } = env;
  await c.startGame({ variantId: 'turkish', mode: 'ai', humanColor: -1, level: 2, epic: true }, { intro: false });
  await settle(80);
  assert.equal(c.bottomColor, -1);
  c.resign({ color: -1 });
  await settle(80);
  const over = calls.find((x) => x[0] === 'playGameOver');
  assert.ok(over && over[1].result.reason === 'resign' && over[1].result.winner === 1 && over[1].humanColor === -1);
  const rec = calls.find((x) => x[0] === 'record');
  assert.ok(rec && rec[1].result === 'loss' && rec[1].mode === 'ai' && rec[1].variantId === 'turkish');
  const go = calls.find((x) => x[0] === 'showGameOver');
  assert.ok(go && go[1].humanColor === -1 && go[1].epic === true);
  env.chooseGameOver('menu');
  await settle(20);
  assert.equal(c.active, false);
});
