// Integration controller (src/rpg/controller.js) in Node: the real meta module, battle engine and
// battle AI (in-thread: no Worker in Node) with a fake RpgUI / BattleView / renderer. Covers the
// session (profile load / save), the step-level human input (select → move → end, jump chains hop
// by hop, square-shaped skill + pending relocation), the AI loop with «Авто», results and rewards,
// surrender, the mid-battle save + resume, and the duel's pass-the-phone + board flip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// controller.js / RpgUI import their CSS (esbuild bundles it): give Node an empty module for .css
register(
  'data:text/javascript,' +
    encodeURIComponent(
      "export async function load(url, ctx, next) { if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true }; return next(url, ctx); }",
    ),
);
globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || ((f) => setTimeout(f, 0));
globalThis.window = globalThis.window || { innerWidth: 390, innerHeight: 844 };

const { RpgController, BATTLE_SAVE_KEY } = await import('../../../src/rpg/controller.js');
const meta = await import('../../../src/rpg/meta/index.js');
const B = await import('../../../src/rpg/battle/index.js');
const { MemoryStorage } = await import('../../../src/ui/storage.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 20000, label = 'condition') {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timeout: ${label}`);
    await sleep(5);
  }
}

function makeFakes() {
  const calls = { results: null, passPhone: 0, flips: [], toasts: [], music: [], confirm: true };
  const hud = {
    setup() {},
    update() {},
    select() {},
    setMode() {},
    log() {},
    setBusy() {},
    setThinking() {},
    setSpeed() {},
    setAuto() {},
    setCinematic() {},
    flip(side) {
      calls.flips.push(side);
    },
    toast(t) {
      calls.toasts.push(t);
    },
    lanes: () => ({ top: null, bottom: null }),
  };
  let ctl = null;
  const ui = {
    hud,
    currentScreen: null,
    visible: false,
    paused: false,
    summoning: false,
    profile: null,
    on() {},
    setProfile(p) {
      this.profile = p;
    },
    showScreen(name) {
      this.visible = true;
      this.currentScreen = name;
      ctl._onScreen(name);
    },
    boardSlotRect: () => ({ x: 0, y: 160, width: 360, height: 360 }),
    toast(t) {
      calls.toasts.push(t);
    },
    confirm: async () => calls.confirm,
    openPause() {},
    passPhone: async () => {
      calls.passPhone++;
      return true;
    },
    async showResults(o) {
      calls.results = o;
      this.currentScreen = 'results';
      ctl._onScreen('results');
      await sleep(5);
      const choice = calls.choice || 'hub';
      if (choice === 'hub') this.showScreen('hub');
      return choice;
    },
    playSummon: async () => 'done',
    hide() {
      this.visible = false;
    },
    openSheet: () => ({ close() {} }),
    handleBack: () => true,
  };
  const view = {
    ready: true,
    shown: false,
    busy: false,
    flipped: false,
    plays: 0,
    spec: null,
    previews: [],
    show() {
      this.shown = true;
    },
    hide() {
      this.shown = false;
    },
    applySettings() {},
    setSpeed() {},
    setFlipped(v) {
      this.flipped = !!v;
    },
    setBackground() {},
    setBoardRect() {},
    setSafeRect() {},
    setState(s) {
      this.state = s;
    },
    async play(events, { state }) {
      this.busy = true;
      this.plays++;
      await sleep(0);
      this.state = state;
      this.busy = false;
    },
    skip() {},
    clearHighlight() {
      this.spec = null;
    },
    clearPreview() {
      this.previews = [];
    },
    highlight(spec) {
      this.spec = spec;
    },
    preview(list) {
      this.previews = list;
    },
    screenPointOf: () => ({ x: 0, y: 0 }),
  };
  const renderer = { layers: { world: { visible: false, alpha: 1 } }, occluded: false, setOccluded(on) { this.occluded = on; } };
  const audio = {
    currentTrack: null,
    music(t) {
      this.currentTrack = t;
      calls.music.push(t);
    },
    setIntensity() {},
    play() {},
  };
  const native = { keepScreenOn() {}, vibrate() {}, isPaused: false };
  const make = (storage) => {
    ctl = new RpgController({ root: null, renderer, audio, native, settings: { lang: 'ru', fx: {} }, opts: { fast: true, storage, now: () => Date.UTC(2026, 9, 12, 12) } });
    ctl.ui = ui;
    ctl.view = view;
    ctl._welcome = () => {
      ctl._setProfile(meta.completeFirstRun(ctl.profile));
    };
    return ctl;
  };
  return { make, ui, view, renderer, audio, calls };
}

const waitHuman = (ctl, ms) => until(() => ctl.battle && ctl.battle.waiting && !ctl.battle.busy && !ctl.battle.over, ms, 'human turn');

test('open: first run grants the starter squad + 3 200 ✦ and saves the profile', async () => {
  const storage = new MemoryStorage();
  const f = makeFakes();
  const ctl = f.make(storage);
  await ctl.open();
  assert.equal(ctl.visible, true);
  assert.equal(f.ui.currentScreen, 'hub');
  assert.equal(ctl.profile.crystals, 3200);
  assert.equal(ctl.profile.squad.length, 6);
  assert.equal(ctl.profile.firstRun, false);
  assert.equal(meta.loadProfile(storage).firstRun, false, 'first run completed and saved');
  assert.equal(f.renderer.occluded, true, 'opaque hub: the renderer stops presenting');
  ctl.close();
  assert.equal(ctl.visible, false);
  assert.equal(f.renderer.occluded, false);
});

test('campaign 1-1 with «Авто»: the AI plays both sides to the end, rewards land and are saved', async () => {
  const storage = new MemoryStorage();
  const f = makeFakes();
  const ctl = f.make(storage);
  await ctl.open();
  await ctl.startBattle({ mode: 'campaign', stageId: '1-1' });
  assert.equal(f.ui.currentScreen, 'battle');
  assert.equal(f.view.shown, true);
  assert.equal(f.renderer.layers.world.visible, true, 'world layer visible in battle');
  await waitHuman(ctl);
  assert.ok(storage.getItem(BATTLE_SAVE_KEY), 'battle saved while running');
  ctl.setAuto(true);
  await until(() => f.calls.results, 60000, 'results');
  const res = f.calls.results;
  assert.ok(res.result && (res.result.winner === 1 || res.result.winner === -1 || res.result.winner === 0));
  assert.equal(f.view.shown, false, 'view hidden for the results');
  assert.equal(f.renderer.layers.world.visible, false, 'world layer restored');
  assert.equal(storage.getItem(BATTLE_SAVE_KEY), null, 'battle save cleared');
  const saved = meta.loadProfile(storage);
  if (res.result.winner === 1) {
    assert.ok(saved.campaign['1-1'] && saved.campaign['1-1'].cleared, 'clear saved');
    assert.ok(saved.crystals > 3200, 'crystals rewarded');
    assert.ok(meta.isUnlocked(saved, '1-2'), '1-2 unlocked');
    assert.ok(res.mvp, 'MVP heroine passed to the results');
  }
  assert.ok(f.calls.music.includes('epic'));
  await until(() => !ctl.battle, 5000, 'battle cleared');
});

test('human input: select → move → «Завершить» → enemy turn → our turn again', async () => {
  const f = makeFakes();
  const ctl = f.make(new MemoryStorage());
  await ctl.open();
  await ctl.startBattle({ mode: 'campaign', stageId: '1-1' });
  await waitHuman(ctl);
  const s = ctl.battle.state;
  const u = s.units.find((x) => x.side === 1 && B.unitActions(s, x.id).moves.length);
  ctl._tapSquare(u.sq, u.id);
  assert.equal(ctl.battle.sel.unitId, u.id);
  assert.deepEqual(f.view.spec.moves, ctl.battle.sel.ua.moves, 'move dots');
  assert.equal(f.view.spec.selected, u.id);
  const to = ctl.battle.sel.ua.moves[0];
  const turn0 = s.turn;
  ctl._tapSquare(to, null);
  await until(() => ctl.battle.state.act && ctl.battle.state.act.moved && ctl.battle.waiting, 5000, 'moved');
  assert.equal(B.getUnit(ctl.battle.state, u.id).sq, to);
  assert.equal(ctl.battle.sel.unitId, u.id, 'still selected after the move');
  assert.equal(ctl.battle.sel.ua.phase, 'moved');
  ctl._onBattleAction({ type: 'end', unitId: u.id });
  await waitHuman(ctl);
  assert.ok(ctl.battle.state.turn >= turn0 + 2, 'enemy took its turn');
  assert.ok(ctl.battle.events.some((e) => e.type === 'turnStart' && e.side === -1));
  await ctl.surrender(1);
  await until(() => f.calls.results, 10000, 'results after surrender');
  assert.equal(f.calls.results.result.winner, -1);
});

test('jump chain entered hop by hop on the board', async () => {
  const f = makeFakes();
  const ctl = f.make(new MemoryStorage());
  await ctl.open();
  // a hand-made position: Akane (Blade, chain up to 3) in front of two enemies with landings free
  let state = B.createBattle({
    sides: { 1: [{ heroId: 'akane', level: 10, constellation: 0 }, { heroId: 'vera', level: 10, constellation: 0 }], [-1]: [{ heroId: 'shio', level: 1, constellation: 0 }, { heroId: 'mara', level: 1, constellation: 0 }, { heroId: 'falk', level: 1, constellation: 0 }] },
    mode: 'training',
    seed: 11,
  });
  state = B.deserializeBattle(B.serializeBattle(state));
  const at = (id, sq) => {
    state.units.find((u) => u.id === id).sq = sq;
  };
  at('a0', 44); // e3-ish
  at('a1', 60);
  at('b0', 35); // over 35 → land 26
  at('b1', 19); // over 19 → land 12
  at('b2', 1);
  const path = B.unitActions(state, 'a0').jumps.sort((a, b) => b.length - a.length)[0];
  assert.ok(path && path.length >= 3, `a 2-hop chain exists (${JSON.stringify(path)})`);
  await ctl._enterBattle({ mode: 'training', sides: { 1: [], [-1]: [] }, difficulty: 'easy', bg: 'bg-dawn', seed: 11, squadIds: ['akane', 'vera'], enemyLevel: 1 }, state, { fresh: false });
  await waitHuman(ctl);
  ctl._tapSquare(44, 'a0');
  assert.equal(ctl.battle.sel.unitId, 'a0');
  assert.ok(f.view.spec.jumps.length >= 1, 'chains highlighted');
  for (const q of path.slice(1)) ctl._tapSquare(q, null);
  await until(() => ctl.battle.events.filter((e) => e.type === 'jump').length >= path.length - 1, 5000, 'jump events');
  const hops = ctl.battle.events.filter((e) => e.type === 'jump');
  assert.equal(hops.length, path.length - 1, 'every hop struck');
  assert.ok(ctl.battle.events.some((e) => e.type === 'damage' && e.kind === 'jump'));
  ctl._abandonBattle();
});

test('square-shaped skill (Volta) → mandatory blink handled as a pending relocation', async () => {
  const f = makeFakes();
  const ctl = f.make(new MemoryStorage());
  await ctl.open();
  await ctl.startBattle({
    mode: 'training',
    squads: { 1: ['volta', 'akane'].map((heroId) => ({ heroId, level: 10, constellation: 0 })), '-1': ['shio', 'mara'].map((heroId) => ({ heroId, level: 1, constellation: 0 })) },
    difficulty: 'easy',
    bg: 'bg-ash',
    enemyLevel: 1,
  });
  await waitHuman(ctl);
  const volta = ctl.battle.state.units.find((u) => u.heroId === 'volta' && u.side === 1);
  ctl._tapSquare(volta.sq, volta.id);
  ctl._onBattleAction({ type: 'skill', unitId: volta.id });
  const info = ctl.battle.sel.ua.skill;
  assert.equal(info.shape, 'square');
  ctl._tapSquare(info.targets[0], null);
  ctl._tapSquare(info.targets[0], null); // a chosen square again: use it
  await until(() => ctl.battle.events.some((e) => e.type === 'cast' && e.kind === 'skill'), 5000, 'skill cast');
  await until(() => ctl.battle.waiting && ctl.battle.sel && ctl.battle.sel.ua && ctl.battle.sel.ua.phase === 'pending', 5000, 'pending blink');
  const sq = ctl.battle.sel.ua.pending.squares[0];
  assert.deepEqual(f.view.spec.moves, ctl.battle.sel.ua.pending.squares, 'pending squares highlighted');
  ctl._tapSquare(sq, null);
  await until(() => B.getUnit(ctl.battle.state, volta.id).sq === sq, 5000, 'blinked');
  await waitHuman(ctl);
  assert.ok(ctl.battle.state.turn >= 3, 'the turn passed to the enemy and back');
  ctl._abandonBattle();
});

test('mid-battle save → a new session resumes the same battle', async () => {
  const storage = new MemoryStorage();
  const f = makeFakes();
  const ctl = f.make(storage);
  await ctl.open();
  await ctl.startBattle({ mode: 'campaign', stageId: '1-1' });
  await waitHuman(ctl);
  const u = ctl.battle.state.units.find((x) => x.side === 1);
  ctl._tapSquare(u.sq, u.id);
  ctl._onBattleAction({ type: 'wait', unitId: u.id });
  await waitHuman(ctl);
  const before = B.serializeBattle(ctl.battle.state);
  ctl.onAppPause(true);
  // the app dies; a new session opens the hub
  const g = makeFakes();
  const ctl2 = g.make(storage);
  await ctl2.open();
  await until(() => ctl2.battle && ctl2.battle.waiting, 10000, 'resumed');
  assert.equal(JSON.stringify(ctl2.battle.state), JSON.stringify(before), 'exactly the saved state');
  assert.equal(ctl2.battle.mode, 'campaign');
  assert.equal(ctl2.battle.stageId, '1-1');
  // declining instead drops the save
  ctl2._abandonBattle();
  storage.setItem(BATTLE_SAVE_KEY, JSON.stringify({ v: 1, setup: { mode: 'training', squadIds: [] }, state: before }));
  const h = makeFakes();
  h.calls.confirm = false;
  const ctl3 = h.make(storage);
  await ctl3.open();
  await sleep(20);
  assert.equal(ctl3.battle, null);
  assert.equal(storage.getItem(BATTLE_SAVE_KEY), null, '«Бросить» clears the save');
});

test('duel: the board turns to the player to move, «Передай телефон» between turns', async () => {
  const f = makeFakes();
  const ctl = f.make(new MemoryStorage());
  await ctl.open();
  const sq = (ids) => ids.map((heroId) => ({ heroId, level: 20, constellation: 0 }));
  await ctl.startBattle({ mode: 'duel', first: 1, passPhone: true, squads: { 1: sq(['akane', 'vera', 'shio']), '-1': sq(['liora', 'mara', 'vera']) } });
  await waitHuman(ctl);
  assert.equal(ctl.battle.state.side, 1);
  assert.equal(f.view.flipped, false);
  const a = ctl.battle.state.units.find((u) => u.side === 1);
  ctl._tapSquare(a.sq, a.id);
  ctl._onBattleAction({ type: 'wait', unitId: a.id });
  await until(() => ctl.battle.waiting && ctl.battle.state.side === -1, 5000, 'player 2');
  assert.equal(f.calls.passPhone, 1, 'pass-the-phone screen shown');
  assert.equal(f.view.flipped, true, 'board flipped to player 2');
  assert.deepEqual(f.calls.flips, [-1]);
  const reflection = ctl.battle.state.units.find((u) => u.side === -1 && u.heroId === 'vera');
  assert.ok(reflection.reflection, 'a heroine picked by both is a Reflection for player 2');
  await ctl.surrender(-1);
  await until(() => f.calls.results, 5000, 'results');
  assert.equal(f.calls.results.result.winner, 1);
  assert.equal(f.calls.results.mode, 'duel');
});

test('first battles: 1-1 coach hints follow the selection, 1-2 opens its tutorial card — each only once', async () => {
  const storage = new MemoryStorage();
  const f = makeFakes();
  const coach = [];
  f.ui.hud.coach = (text) => coach.push(text);
  const cards = [];
  f.ui.openTutorial = async (id) => {
    cards.push(id);
  };
  const ctl = f.make(storage);
  await ctl.open();
  await ctl.startBattle({ mode: 'campaign', stageId: '1-1' });
  await waitHuman(ctl);
  assert.ok(ctl.battle.coach, '1-1 runs the coach');
  assert.match(coach[coach.length - 1], /Коснись своей героини/);
  const s = ctl.battle.state;
  const u = s.units.find((x) => x.side === 1 && B.unitActions(s, x.id).moves.length);
  ctl._tapSquare(u.sq, u.id);
  assert.match(coach[coach.length - 1], /Зелёные точки/, 'move hint once a heroine is selected');
  // «Авто» ends the coach (no more hints) and marks it seen
  ctl.setAuto(true);
  await until(() => f.calls.results, 60000, 'results');
  assert.equal(meta.loadProfile(storage).flags['tut.basics'], true);
  await until(() => !ctl.battle, 5000, 'battle cleared');
  // 1-2: the reactions card once, never again
  const p = meta.loadProfile(storage);
  p.campaign['1-1'] = { stars: 3, cleared: true, clears: 1, attempts: 1, lossStreak: 0, bestRounds: 9 };
  meta.saveProfile(p, storage);
  ctl.profile = meta.loadProfile(storage);
  await ctl.startBattle({ mode: 'campaign', stageId: '1-2' });
  await waitHuman(ctl);
  assert.deepEqual(cards, ['reactions']);
  assert.equal(ctl.battle.coach, undefined, 'no coach outside 1-1');
  assert.equal(meta.loadProfile(storage).flags['tut.reactions'], true);
  ctl._abandonBattle();
  await ctl.startBattle({ mode: 'campaign', stageId: '1-2' });
  await waitHuman(ctl);
  assert.deepEqual(cards, ['reactions'], 'the card is not shown twice');
  ctl._abandonBattle();
});
