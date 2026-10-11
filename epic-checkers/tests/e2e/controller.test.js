// Controller unit tests (node:test) with mocked renderer / UI / Director / AI — covers tap-by-tap
// path entry (incl. equivalent `alts` routes), auto-complete, final-destination taps, undo rules,
// stats + hype (ULTIMATE reset), stale AI answers and game over. Runs as part of `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Controller, routeMove, hapticsOf, playerNameOf, aiMinDelay, textTimeOf, DEMO_EXTRA_MS } from '../../src/controller.js';
import { sideColors, ENERGY_COLORS, DEFAULT_SIDE_COLORS } from '../../src/controller-colors.js';
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

function makeEnv({ aiMode = 'auto', hudExtra = {}, now = null, storage = null, manualMoves = false, think = null } = {}) {
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
  const anyTaps = [];
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
    onTap(fn) {
      anyTaps.push(fn);
    },
    setQuality(q) {
      calls.push(['renderer.setQuality', q]);
    },
    onSquareTap(fn) {
      taps.push(fn);
    },
  };
  const hudState = {};
  const hud = new Proxy(
    { state: hudState, ...hudExtra },
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
  const pendingMoves = [];
  const director = {
    busy: false,
    moves: [],
    skips: 0,
    turns: [],
    lanes: [],
    hooks: { impact: null, cinematic: null },
    hypeModel: { perCapture: 0 },
    setMode() {},
    skip() {
      this.skips++;
    },
    setLanes(l) {
      this.lanes.push(l);
    },
    syncPosition() {},
    playMove(o) {
      this.moves.push(o);
      if (manualMoves) {
        // the cinematic runs until the test finishes it
        this.busy = true;
        const d = deferred();
        pendingMoves.push(() => {
          renderer.setPosition(o.after);
          this.busy = false;
          d.resolve();
        });
        return d.p;
      }
      renderer.setPosition(o.after);
      return Promise.resolve();
    },
    playGameStart: () => Promise.resolve(),
    playTurn(o) {
      this.turns.push(o);
      return Promise.resolve();
    },
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
    think(state, opts) {
      if (think) return Promise.resolve(think(state, opts));
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
  const wake = [];
  const native = {
    keepScreenOn(on) {
      wake.push(on);
    },
  };
  const settings = { showMoves: true, lang: 'ru', quality: 'high', animSpeed: 1 };
  const statsStore = {
    record: (s) => {
      calls.push(['record', s]);
      return { newRecords: [], newTitles: [] };
    },
    currentTitle: () => null,
  };
  const opts = { fast: true };
  if (now) opts.now = now;
  if (storage) opts.storage = storage;
  else opts.autosave = false;
  const c = new Controller({ ui, renderer, fx: null, director, audio, ai, native, settings, statsStore, opts });
  // a real tap goes through renderer.onTap (skip / activity) first, then onSquareTap
  const tap = async (sq) => {
    anyTaps.forEach((fn) => fn({ x: 0, y: 0, sq }));
    taps.forEach((fn) => fn(sq));
    await settle();
  };
  const finishMove = async () => {
    const f = pendingMoves.shift();
    if (f) f();
    await settle(40);
  };
  return { c, renderer, hl, director, ai, pending, ui, calls, tap, board, wake, finishMove, chooseGameOver: (v) => gameOverChoice.resolve(v) };
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

// ============================================================================ QA fixes (controller)
import { readSave, writeSave } from '../../src/app-save.js';
import { text } from '../../src/controller-text.js';
import { SKIP_GRACE_MS, IDLE_SCREEN_MS, replayStats, demoLevels } from '../../src/controller.js';
import { Game } from '../../src/engine/index.js';

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const statusCalls = (calls) => calls.filter((x) => x[0] === 'hud.setStatus');
const toasts = (calls) => calls.filter((x) => x[0] === 'hud.toast').map((x) => x[1]);

test('MUX-01: taps that finish entering the own multi-capture never skip it; a fresh tap does', async () => {
  let T = 1000;
  const env = makeEnv({ now: () => T, manualMoves: true });
  const { c, tap, director, finishMove } = env;
  const POS = 'w:.b.....b/......../.....b../......../.....b../......../...b..../..w...w.';
  await c.startGame({ variantId: 'russian', mode: 'pvp', epic: true }, { startState: stateFromString('russian', POS), intro: false });
  await settle();
  const triple = c.game.moves.find((m) => m.captures.length === 3);
  assert.ok(triple, 'a triple capture exists');
  // the player taps the squares one by one, as the rules say; the move commits once unambiguous
  let i = 0;
  while (c.phase === 'human' && i < triple.path.length) {
    T += 300;
    await tap(triple.path[i++]);
  }
  assert.equal(c.phase, 'animating', 'committed');
  assert.ok(director.busy);
  T += SKIP_GRACE_MS - 50;
  await tap(0); // a stray tap right after the commit
  assert.equal(director.skips, 0, 'no skip within the grace period');
  for (; i < triple.path.length; i++) {
    T += 450; // the rest of the landing squares, at a human pace
    await tap(triple.path[i]);
  }
  assert.equal(director.skips, 0, 'remaining landing squares belong to the move entry');
  T += 500;
  await tap(0); // a fresh tap elsewhere
  assert.equal(director.skips, 1, 'a fresh tap skips');
  await finishMove();
  assert.equal(c.phase, 'human');
  // any other cinematic (no entry guard) is skipped by the first tap
  director.busy = true;
  T += 50;
  await tap(5);
  assert.equal(director.skips, 2);
  director.busy = false;
});

test('MUX-09: a mandatory capture is announced at the start of the turn; tapping a capture ring captures', async () => {
  const { c, tap, calls, director, hl } = makeEnv();
  // white d4 and f4 can both capture e5 / c5
  const POS = 'w:......../......../......../..b.b.../...w.w../......../......../........';
  await c.startGame({ variantId: 'russian', mode: 'pvp', epic: true }, { startState: stateFromString('russian', POS), intro: false });
  await settle();
  const st = statusCalls(calls).pop();
  assert.equal(st[1], text('status.yourTurnCapture'));
  assert.equal(st[2].tone, 'alert');
  assert.equal(director.turns.at(-1).mustCapture, true);
  const moves = c.game.moves;
  const landings = [...new Set(moves.map((m) => m.path[1]))];
  assert.deepEqual([...hl.state.targets].sort(), landings.sort(), 'capture landings shown as rings');
  assert.equal(hl.state.capture, true);
  assert.equal(c.sel, null, 'two capturers: nothing auto-selected');
  // a landing reached by exactly one piece: tapping it plays that capture
  const owners = (l) => new Set(moves.filter((m) => m.path[1] === l).map((m) => m.path[0]));
  const unique = landings.find((l) => owners(l).size === 1);
  await tap(unique);
  await settle(40);
  assert.equal(director.moves.length, 1);
  assert.equal(director.moves[0].move.path[1], unique);
});

test('MUX-02 / RO-2 / MUX-16: refused taps get a precise explanation', async () => {
  const env = makeEnv();
  const { c, tap, calls } = env;
  await c.startGame({ variantId: 'turkish', mode: 'pvp', epic: false }, { startState: stateFromString('turkish', 'w:......../......../.....b../......../.b...b../.w...w../......../........'), intro: false });
  await settle();
  await tap(41); // b3 could take one piece, f3 must take two
  let st = statusCalls(calls).pop();
  assert.equal(st[1], text('status.mustCaptureMax'));
  assert.equal(st[2].tone, 'alert');

  const env2 = makeEnv();
  await env2.c.startGame({ variantId: 'russian', mode: 'pvp', epic: false }, { intro: false });
  await settle();
  await env2.tap(49); // b2 at the start: blocked
  st = statusCalls(env2.calls).pop();
  assert.equal(st[1], text('status.noMovesForPiece'));
  assert.equal(st[2].tone, 'info');
});

test('MUX-20: a repeated position and an approaching move-limit draw are announced', async () => {
  const { c, tap, calls } = makeEnv();
  // kings shuffle h2-g3 / a7-b6 (10 pieces: no endgame counter)
  const POS = 'w:.b.b.b.b/B......./......../......../......../......../.......W/w.w.w.w.';
  await c.startGame({ variantId: 'russian', mode: 'pvp', epic: false }, { startState: stateFromString('russian', POS), intro: false });
  await settle();
  for (const [a, b] of [[55, 46], [8, 17], [46, 55], [17, 8]]) {
    await tap(a);
    await tap(b);
    await settle(30);
  }
  assert.equal(c.game.history.length, 4);
  assert.equal(c.game.repetitionCount(), 2);
  assert.ok(toasts(calls).includes(text('status.repetitionWarn')), `toasts: ${toasts(calls)}`);

  // a counter draw two moves away (stubbed progress)
  c.game.drawProgress = () => ({ detail: 'kings-only', movesLeft: 2, limit: 15, rule: 'quiet' });
  await tap(55);
  await tap(37); // h2-f4: a new position (no repetition)
  await settle(30);
  const want = text('status.drawSoon', { n: 2, count: 2 });
  assert.ok(toasts(calls).includes(want), `toasts: ${toasts(calls)}`);
  const n = toasts(calls).filter((x) => x === want).length;
  await tap(8);
  await tap(17);
  await settle(30);
  assert.equal(toasts(calls).filter((x) => x === want).length, n, 'the same countdown is not repeated');
});

/** A real game of `plies` random legal moves (seeded), still running. */
function longGame(variantId, plies, seed = 7) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let tries = 0; tries < 50; tries++) {
    const g = new Game(variantId);
    while (g.history.length < plies && !g.result) {
      const ms = g.moves;
      const quiet = ms.filter((m) => !m.captures.length);
      const pool = quiet.length && rnd() < 0.8 ? quiet : ms;
      g.play(pool[Math.floor(rnd() * pool.length)]);
    }
    if (!g.result && g.history.length === plies) return g;
  }
  throw new Error('no long game');
}

test('RTR-02 / MUX-04: a draw offer to the AI is answered from a short search', async () => {
  const scores = [];
  const mk = (score) => {
    const env = makeEnv({ think: (state, opts) => (scores.push(opts), { path: legalMoves(state)[0].path, score }) });
    return env;
  };
  const g = longGame('international', 44);
  const human = g.state.turn;
  // equal position: accepted → game over by agreement
  let env = mk(0);
  await env.c.startGame({ variantId: 'international', mode: 'ai', epic: false }, { resume: { game: Game.fromJSON(g.toJSON()), humanColor: human, elapsedSec: 0 }, intro: false });
  await settle(40);
  assert.equal(env.c.phase, 'human');
  env.c.offerDraw({ color: human, vsAI: true });
  await settle(80);
  assert.equal(scores.at(-1).level, 3);
  assert.ok(toasts(env.calls).includes(text('toast.drawAcceptedAi')));
  assert.equal(env.c.game.result && env.c.game.result.reason, 'agreement');
  // the AI is 1.5 men up (score from the human's side to move: -150) → declined, game goes on
  env = mk(-150);
  await env.c.startGame({ variantId: 'international', mode: 'ai', epic: false }, { resume: { game: Game.fromJSON(g.toJSON()), humanColor: human, elapsedSec: 0 }, intro: false });
  await settle(40);
  env.c.offerDraw({ color: human, vsAI: true });
  await settle(80);
  assert.ok(toasts(env.calls).includes(text('toast.drawDeclinedAi')));
  assert.equal(env.c.game.result, null);
  assert.equal(env.c.phase, 'human');
  // before move 20: declined without a search
  env = mk(0);
  const n = scores.length;
  await env.c.startGame({ variantId: 'international', mode: 'ai', humanColor: 1, epic: false }, { intro: false });
  await settle(40);
  env.c.offerDraw({ color: 1, vsAI: true });
  await settle(40);
  assert.equal(scores.length, n, 'no search before move 20');
  assert.ok(toasts(env.calls).includes(text('toast.drawDeclinedAi')));
});

test('F1: a game that ends while the pause menu is open waits for it; stats are recorded at once', async () => {
  const env = makeEnv();
  const { c, calls } = env;
  await c.startGame({ variantId: 'russian', mode: 'ai', humanColor: 1, epic: true }, { startState: stateFromString('russian', 'w:......../......../......../......../...b..../..w...../......../........'), intro: false });
  await settle();
  c.onPause(); // the player opened the pause menu during the final move
  await c.playPath([42, 28]);
  await settle(60);
  assert.ok(c.game.result && c.game.result.winner === 1);
  assert.ok(calls.some((x) => x[0] === 'record'), 'stats recorded right away');
  assert.ok(!calls.some((x) => x[0] === 'playGameOver'), 'no finale behind the pause menu');
  assert.ok(!calls.some((x) => x[0] === 'showGameOver'), 'no game-over card behind the pause menu');
  c.onResume();
  await settle(60);
  assert.ok(calls.some((x) => x[0] === 'playGameOver'));
  assert.ok(calls.some((x) => x[0] === 'showGameOver'));
  env.chooseGameOver('menu');
  await settle(20);
});

test('F7: keep-screen-on only while a game is played (not paused, not idle, not over)', async () => {
  let T = 0;
  const env = makeEnv({ now: () => T });
  const { c, wake } = env;
  await c.startGame({ variantId: 'russian', mode: 'pvp', epic: false }, { intro: false });
  await settle();
  assert.equal(wake.at(-1), true);
  c.onPause();
  assert.equal(wake.at(-1), false, 'paused');
  c.onResume();
  assert.equal(wake.at(-1), true);
  T += IDLE_SCREEN_MS + 1000;
  c._checkIdle();
  assert.equal(wake.at(-1), false, 'idle on the own turn');
  c.noteActivity();
  assert.equal(wake.at(-1), true, 'any tap wakes it again');
  c.onAppPause(true);
  assert.equal(wake.at(-1), false, 'app in the background');
  c.onAppPause(false);
  assert.equal(wake.at(-1), true, 'foreground again (no pause menu in this test)');
  c.resign({ color: 1 });
  await settle(40);
  assert.equal(wake.at(-1), false, 'game over');
  env.chooseGameOver('menu');
  await settle(20);
  assert.equal(c.active, false);
  assert.equal(wake.at(-1), false);
});

test('F8: the game is autosaved after every move, dropped at the end, and resumes with its stats', async () => {
  const storage = memStorage();
  const env = makeEnv({ storage });
  const { c, tap } = env;
  await c.startGame({ variantId: 'russian', mode: 'pvp', epic: true }, { startState: stateFromString('russian', BRANCH), intro: false });
  await settle();
  assert.equal(readSave(storage), null, 'nothing saved before the first move');
  await tap(SQ.a7);
  await settle(40);
  const save = readSave(storage);
  assert.ok(save, 'saved after the move');
  assert.equal(save.game.history.length, 1);
  assert.equal(save.cfg.mode, 'pvp');
  // a fresh app resumes it with the same stats (replayed from the moves)
  const env2 = makeEnv({ storage });
  await env2.c.resumeGame(save);
  await settle(40);
  assert.equal(env2.c.game.history.length, 1);
  assert.deepEqual(env2.c.stats.captures, c.stats.captures);
  assert.deepEqual(env2.c.stats.hype, c.stats.hype);
  assert.equal(env2.c.phase, 'human');
  assert.equal(env2.c.game.state.turn, -1);
  // the game ends → the save is gone
  env2.c.resign({ color: -1 });
  await settle(40);
  assert.equal(readSave(storage), null, 'dropped when the game ends');
  env2.chooseGameOver('menu');
  // leaving a game abandons its save; demo games are never saved
  const env3 = makeEnv({ storage });
  await env3.c.startGame({ variantId: 'russian', mode: 'pvp', epic: false }, { intro: false });
  await settle();
  writeSave({ cfg: env3.c.cfg, humanColor: 1, game: env3.c.game }, storage);
  env3.c.stopGame();
  assert.equal(readSave(storage), null, 'abandoned');
  assert.equal(writeSave({ cfg: { mode: 'demo' }, humanColor: 1, game: env3.c.game }, storage), null);
});

test('replayStats reproduces the live stats; demo fighters differ (MUX-18)', async () => {
  const { c, tap } = makeEnv();
  await c.startGame({ variantId: 'russian', mode: 'pvp', epic: true }, { startState: stateFromString('russian', BRANCH), intro: false });
  await settle();
  await tap(SQ.a7);
  await settle(40);
  const r = replayStats(c.game.history);
  assert.deepEqual(r.stats, c.stats);
  assert.equal(r.hist.length, 1);
  // demo without per-colour levels: neighbouring levels
  const lv = demoLevels({ level: 3 }, () => 0.2);
  assert.notEqual(lv[1], lv[-1]);
  assert.deepEqual(demoLevels({ level: 1 }, () => 0.9), { 1: 2, '-1': 1 });
  assert.deepEqual(demoLevels({ level: 3, levelWhite: 5, levelBlack: 2 }), { 1: 5, '-1': 2 });
  const env = makeEnv();
  await env.c.startGame({ variantId: 'russian', mode: 'demo', level: 4, levelWhite: 4, levelBlack: 4, epic: true }, { intro: false });
  const P = env.c.players;
  assert.equal(P[1].level, 4);
  assert.equal(P[-1].level, 4);
  assert.notEqual(P[1].name, P[-1].name, `${P[1].name} vs ${P[-1].name}`);
  env.c.stopGame();
  const env2 = makeEnv();
  await env2.c.startGame({ variantId: 'russian', mode: 'demo', level: 3, epic: true }, { intro: false });
  assert.notEqual(env2.c.players[1].name, env2.c.players[-1].name);
  env2.c.stopGame();
  await settle(20);
});

test('EAD-15 lanes go to the Director on start and on board-rect; hype model synced', async () => {
  const lanes = { top: { y: 100, h: 80 }, bottom: { y: 560, h: 76 } };
  const env = makeEnv({ hudExtra: { lanes: () => lanes } });
  const { c, director } = env;
  assert.equal(director.hypeModel.perCapture, 0.22, 'controller hype model pushed to the Director');
  await c.startGame({ variantId: 'russian', mode: 'pvp', epic: true }, { intro: false });
  await settle();
  assert.deepEqual(director.lanes.at(-1), lanes);
  const n = director.lanes.length;
  c.onBoardRect({ x: 0, y: 0, width: 300, height: 300 });
  assert.equal(director.lanes.length, n + 1);
});

test('EAD-22: the skip chip only shows for cinematics longer than ~0.9 s', async () => {
  const run = async (epic, ms) => {
    const env = makeEnv({ manualMoves: true });
    const { c, tap, calls, finishMove } = env;
    await c.startGame({ variantId: 'russian', mode: 'pvp', epic }, { startState: stateFromString('russian', BRANCH), intro: false });
    await settle();
    await tap(SQ.a7);
    await new Promise((r) => setTimeout(r, ms));
    await finishMove();
    return calls.some((x) => x[0] === 'hud.setSkippable' && x[1] === true);
  };
  assert.equal(await run(true, 600), false, 'epic 0.6 s: no chip');
  assert.equal(await run(false, 1200), false, 'classic 1.2 s: no chip');
  assert.equal(await run(true, 1300), true, 'epic 1.3 s: chip');
});

test('settings: applySettings reaches every module, gates haptics, forwards to the frame budget', async () => {
  const env = makeEnv();
  const { c, renderer, director, calls } = env;
  const got = [];
  renderer.applySettings = (st) => got.push(['renderer', st]);
  director.applySettings = (st) => got.push(['director', st]);
  c.fx = { quality: 'high', applySettings: (st) => got.push(['fx', st]), setQuality: (q) => got.push(['fx.setQuality', q]), setLang() {} };
  const haptic = [];
  c.native.setHaptics = (m) => haptic.push(m);
  const perf = [];
  c.perf = { applySettings: (st) => perf.push(st) };
  const st = c.settings;
  Object.assign(st, { haptics: 'light', vibration: true, sfxVolume: 0.3, musicVolume: 0.2 });
  c.applySettings(st);
  assert.deepEqual(got.map((g) => g[0]), ['renderer', 'fx', 'director']);
  assert.ok(got.every((g) => g[1] === st), 'the live object itself');
  assert.deepEqual(haptic, ['light']);
  assert.equal(perf.length, 1, 'frame budget / quality applied last');
  st.haptics = 'off';
  c.applySettings(st);
  assert.equal(st.vibration, false, 'legacy vibration mirror kept in sync');
  assert.deepEqual(haptic, ['light', 'off']);
  // an old settings object without haptics: the boolean decides
  assert.equal(hapticsOf({ vibration: false }), 'off');
  assert.equal(hapticsOf({ vibration: true }), 'strong');
  assert.equal(hapticsOf({ haptics: 'bogus', vibration: true }), 'strong');
  // a module without applySettings is simply skipped; a throwing one never breaks the others
  director.applySettings = () => {
    throw new Error('boom');
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    c.applySettings(st);
  } finally {
    console.warn = warn;
  }
  assert.equal(perf.length, 3);
  // quality goes to renderer + FX only when it differs
  renderer.quality = 'high';
  c.setQuality('medium');
  assert.ok(calls.some((x) => x[0] === 'renderer.setQuality' && x[1] === 'medium'));
  assert.ok(got.some((g) => g[0] === 'fx.setQuality' && g[1] === 'medium'));
  assert.equal(c.quality, 'medium');
  c.setQuality('auto');
  assert.equal(c.quality, 'medium', "'auto' is a setting, not an effective level");
});

test('settings: playerName names the human (HUD refresh, live); pvp gives it to WHITE; demo ignores it', async () => {
  const env = makeEnv();
  const { c, calls } = env;
  c.settings.playerName = '  Макс  ';
  await c.startGame({ variantId: 'russian', mode: 'ai', humanColor: -1, epic: true, level: 2 }, { intro: false });
  await settle();
  assert.equal(c.players[-1].name, 'Макс');
  assert.equal(c.players[-1].isHuman, true);
  const shared = c.players[-1];
  c.settings.playerName = 'Боец';
  c.applySettings(c.settings);
  assert.equal(shared.name, 'Боец', 'the same object the HUD / Director hold is updated');
  assert.ok(calls.some((x) => x[0] === 'hud.refresh'));
  c.settings.playerName = '';
  c.applySettings(c.settings);
  assert.equal(shared.name, text('hud.you'));
  c.settings.playerName = 'Макс';
  await c.startGame({ variantId: 'russian', mode: 'pvp', epic: true }, { intro: false });
  await settle();
  assert.equal(c.players[1].name, 'Макс');
  assert.notEqual(c.players[-1].name, 'Макс');
  await c.startGame({ variantId: 'russian', mode: 'demo', epic: true, level: 3 }, { intro: false });
  await settle();
  assert.ok(c.players[1].name !== 'Макс' && c.players[-1].name !== 'Макс');
  c.stopGame();
  assert.equal(playerNameOf({ playerName: 'Очень-длинное-имя-игрока' }, 'Ты'), 'Очень-длинное-им');
  assert.equal(playerNameOf({ playerName: '   ' }, 'Ты'), 'Ты');
});

test('settings: playerColor → renderer.setSideColors for the side the player plays (contrast rule)', async () => {
  const env = makeEnv();
  const { c, renderer } = env;
  const seen = [];
  renderer.setSideColors = (cols) => seen.push(cols);
  c.settings.playerColor = 'pink';
  await c.startGame({ variantId: 'russian', mode: 'ai', humanColor: 1, epic: true }, { intro: false });
  await settle();
  // pink next to the default crimson is too close: the opponent turns cyan
  assert.deepEqual(seen.at(-1), { 1: ENERGY_COLORS.pink, '-1': DEFAULT_SIDE_COLORS[1] });
  await c.startGame({ variantId: 'russian', mode: 'ai', humanColor: -1, epic: true }, { intro: false });
  await settle();
  // the human plays BLACK: pink goes there, WHITE keeps cyan
  assert.deepEqual(seen.at(-1), { '-1': ENERGY_COLORS.pink, 1: DEFAULT_SIDE_COLORS[1] });
  c.settings.playerColor = 'cyan';
  c.applySettings(c.settings);
  // cyan on BLACK next to cyan WHITE: WHITE switches to crimson
  assert.deepEqual(seen.at(-1), { '-1': ENERGY_COLORS.cyan, 1: DEFAULT_SIDE_COLORS[-1] });
  const n = seen.length;
  c.applySettings(c.settings);
  assert.equal(seen.length, n, 'unchanged colours are not re-applied');
  c.settings.playerColor = 'auto';
  c.applySettings(c.settings);
  assert.equal(seen.at(-1), null, "'auto' = renderer defaults");
  // two players / demo: WHITE gets the colour
  c.settings.playerColor = 'violet';
  await c.startGame({ variantId: 'russian', mode: 'demo', epic: true }, { intro: false });
  await settle();
  assert.deepEqual(seen.at(-1), { 1: ENERGY_COLORS.violet, '-1': DEFAULT_SIDE_COLORS[-1] });
  c.stopGame();
  assert.deepEqual(sideColors({ playerColor: 'orange', mode: 'pvp' }), { 1: ENERGY_COLORS.orange, '-1': DEFAULT_SIDE_COLORS[1] });
  assert.deepEqual(sideColors({ playerColor: 'gold', mode: 'ai', humanColor: 1 }), { 1: ENERGY_COLORS.gold, '-1': DEFAULT_SIDE_COLORS[-1] });
  assert.equal(sideColors({ playerColor: 'auto' }), null);
});

test('settings: aiPace sets the minimum AI pause; a demo waits a little longer', () => {
  assert.equal(aiMinDelay({ aiPace: 'fast' }, 'ai'), 300);
  assert.equal(aiMinDelay({ aiPace: 'normal' }, 'ai'), 700);
  assert.equal(aiMinDelay({ aiPace: 'slow' }, 'ai'), 1300);
  assert.equal(aiMinDelay({}, 'ai'), 700);
  assert.equal(aiMinDelay({ aiPace: 'slow' }, 'demo'), 1300 + DEMO_EXTRA_MS);
  assert.equal(textTimeOf({ textTime: 3 }), 3);
  assert.equal(textTimeOf({ textTime: 9 }), 3);
  assert.equal(textTimeOf({}), 1.5);
});
