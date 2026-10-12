// BattleView headless (no DOM, no WebGL): the real Renderer (never init()ed) provides layers, clock
// and camera; the real battle engine provides the event logs. Checks attaching / detaching, state
// sync, taps, that playing the engine's events alone keeps every token in step with the engine,
// skip / hide mid-cinematic, settings, and that nothing leaks across many turns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Container } from 'pixi.js';
import { Renderer } from '../../../src/render/renderer.js';
import { BattleView } from '../../../src/rpg/render/index.js';
import { createBattle, applyAction, legalActions } from '../../../src/rpg/battle/index.js';

const SCREEN = { width: 390, height: 844 };
const SLOT = { x: 0, y: 170, width: 390, height: 430 };

function makeRenderer() {
  const r = new Renderer({ clientWidth: SCREEN.width, clientHeight: SCREEN.height });
  r._sw = SCREEN.width;
  r._sh = SCREEN.height;
  // the layer tree Renderer.init() builds
  const L = r.layers;
  L.world.addChild(L.board, L.boardFx, L.highlights, L.pieces, r.pieceTopLayer, L.worldFx);
  return r;
}

async function makeView(settings = { lang: 'ru', fx: {} }) {
  const r = makeRenderer();
  const view = new BattleView({ renderer: r, fx: null, settings });
  await view.init();
  view.show();
  view.setBoardRect(SLOT);
  return { r, view };
}

const nextTask = () => new Promise((res) => setImmediate(res));

/** Step the game clock (frozen-frame style) until `done()` or maxFrames. Returns frames used. */
async function pump(r, done, maxFrames = 4000, dt = 1000 / 30) {
  let f = 0;
  for (; f < maxFrames && !done(); f++) {
    r.clock.update(dt);
    await nextTask();
  }
  return f;
}

function battle(seed = 5) {
  const side = (ids) => ids.map((heroId) => ({ heroId, level: 10 }));
  return createBattle({ sides: { 1: side(['akane', 'reika', 'liora', 'tsubame', 'vera']), [-1]: side(['nocturna', 'volta', 'zlata', 'mara', 'koyuki']) }, seed, first: 1, mode: 'training' });
}

function lcg(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** Charge every heroine of side 1 and return the first legal Ultimate. */
function chargeUlt(s) {
  for (const u of s.units) if (u.side === 1 && u.alive) u.energy = u.maxEnergy || 100;
  return legalActions(s).find((a) => a.type === 'ult') || null;
}

/** Play `n` plies of seeded actions (favouring ultimates / skills / jumps); calls check(res) after each. */
async function playPlies(r, view, s, n, rand, { check, ultChance = 0.2, final = false } = {}) {
  let maxFrames = 0;
  for (let ply = 0; ply < n && !s.result; ply++) {
    for (const u of s.units) if (u.alive && rand() < ultChance) u.energy = u.maxEnergy || 100;
    view.setState(s);
    const acts = legalActions(s);
    if (!acts.length) break;
    const pri = acts.filter((a) => a.type === 'ult' || a.type === 'skill' || a.type === 'jump' || a.type === 'basic');
    const pool = pri.length && rand() < 0.85 ? pri : acts;
    const action = pool[Math.floor(rand() * pool.length)];
    const res = applyAction(s, action);
    let done = false;
    let err = null;
    view.play(res.events, final ? { state: res.state } : {}).then(() => (done = true), (e) => {
      err = e;
      done = true;
    });
    const f = await pump(r, () => done);
    maxFrames = Math.max(maxFrames, f);
    assert.equal(err, null);
    assert.ok(done, `ply ${ply} (${action.type}) finished`);
    assert.equal(view.busy, false);
    if (check) check(res, ply, action);
    s = res.state;
  }
  return { s, maxFrames };
}

test('show() hides the classic board and inserts the RPG layers; hide() restores everything as it was', async () => {
  const r = makeRenderer();
  r.layers.highlights.visible = false; // already hidden before: must stay hidden after hide()
  r.staticBackdrop = false;
  const view = new BattleView({ renderer: r, fx: null, settings: {} });
  await view.init();
  const before = { world: r.layers.world.children.slice(), bg: r.layers.background.children.length, screen: r.layers.screenFx.children.length };
  view.show();
  assert.equal(r.layers.board.visible, false);
  assert.equal(r.layers.pieces.visible, false);
  assert.equal(r.pieceTopLayer.visible, false);
  assert.equal(r.staticBackdrop, true, 'the hidden epic backdrop is frozen');
  assert.ok(r.layers.world.children.includes(view.layers.boardRoot));
  assert.ok(r.layers.world.children.includes(view.layers.unitsRoot));
  assert.ok(r.layers.background.children.includes(view.layers.bgRoot));
  assert.ok(r.layers.screenFx.children.includes(view.layers.screenRoot));
  // ordering: our board above the hidden classic board, units below the FX world layer, numbers on top
  const w = r.layers.world;
  assert.ok(w.getChildIndex(view.layers.boardRoot) > w.getChildIndex(r.layers.board));
  assert.ok(w.getChildIndex(view.layers.unitsRoot) < w.getChildIndex(r.layers.worldFx));
  assert.equal(w.children[w.children.length - 1], view.layers.topRoot);
  view.show(); // idempotent
  view.hide();
  assert.equal(r.layers.board.visible, true);
  assert.equal(r.layers.pieces.visible, true);
  assert.equal(r.pieceTopLayer.visible, true);
  assert.equal(r.layers.highlights.visible, false, 'a layer hidden before show() stays hidden');
  assert.equal(r.staticBackdrop, false);
  assert.deepEqual(r.layers.world.children, before.world);
  assert.equal(r.layers.background.children.length, before.bg);
  assert.equal(r.layers.screenFx.children.length, before.screen);
  assert.equal(r._tapFns.length, 0, 'tap listener removed');
  view.hide(); // idempotent
  view.destroy();
});

test('setState: one token per living heroine on her square; KO / hero change / wards are synced', async () => {
  const { view } = await makeView();
  const s = battle();
  view.setState(s);
  const alive = s.units.filter((u) => u.alive && u.sq >= 0);
  assert.equal([...view.tokens.values()].filter((t) => t.alive).length, alive.length);
  for (const u of alive) {
    const t = view.tokens.get(u.id);
    const c = view.squareCenter(u.sq);
    assert.equal(t.sq, u.sq);
    assert.ok(Math.abs(t.x - c.x) < 1e-6 && Math.abs(t.y - c.y) < 1e-6, `${u.id} centred on its square`);
    assert.equal(t.hp, u.hp);
    assert.equal(t.side, u.side);
  }
  // KO
  const s2 = structuredClone(s);
  const victim = s2.units.find((u) => u.side === -1);
  victim.alive = false;
  victim.hp = 0;
  victim.sq = -1;
  view.setState(s2);
  assert.equal(view.tokens.get(victim.id).alive, false);
  assert.equal(view.unitAt(s.units.find((u) => u.id === victim.id).sq), null, 'the square is free');
  // same id, another heroine (a new battle reusing a0): the token is rebuilt with the new portrait
  const s3 = structuredClone(s);
  s3.units[0].heroId = 'koyuki';
  view.setState(s3);
  assert.equal(view.tokens.get(s3.units[0].id).heroId, 'koyuki');
  // wards
  const s4 = structuredClone(s);
  const q = [...Array(64).keys()].find((k) => ((k >> 3) + (k & 7)) % 2 === 1 && !s4.units.some((u) => u.alive && u.sq === k));
  s4.wards = [{ id: 'w1', kind: 'ice-wall', sq: q, owner: s4.units[0].id, side: 1, hp: 300, maxHp: 300 }];
  view.setState(s4);
  assert.ok(view.wards.has('w1'));
  assert.equal(view.piece('w1').sq, q);
  view.setState(s);
  assert.equal(view.wards.size, (s.wards || []).length, 'removed wards are gone');
  assert.ok(!view.wards.has('w1'));
  view.destroy();
});

test('taps map to squares and heroines, also on a flipped board', async () => {
  const { r, view } = await makeView();
  const s = battle();
  view.setState(s);
  const taps = [];
  const off = view.onTap((e) => taps.push(e));
  const u = s.units.find((x) => x.side === -1 && x.alive);
  for (const flipped of [false, true]) {
    view.setFlipped(flipped);
    const p = view.screenPointOf(u.id);
    for (const fn of r._tapFns.slice()) fn({ x: p.x, y: p.y, sq: -1 });
    const last = taps[taps.length - 1];
    assert.equal(last.sq, u.sq, `flipped=${flipped}`);
    assert.equal(last.unitId, u.id);
  }
  // an empty dark square → no unit
  const empty = [...Array(64).keys()].find((k) => ((k >> 3) + (k & 7)) % 2 === 1 && !s.units.some((x) => x.alive && x.sq === k));
  const pe = view.screenPointOf(empty);
  for (const fn of r._tapFns.slice()) fn({ x: pe.x, y: pe.y, sq: -1 });
  assert.equal(taps[taps.length - 1].sq, empty);
  assert.equal(taps[taps.length - 1].unitId, null);
  off();
  const n = taps.length;
  for (const fn of r._tapFns.slice()) fn({ x: pe.x, y: pe.y, sq: -1 });
  assert.equal(taps.length, n, 'unsubscribed');
  view.destroy();
});

test('playing the engine events alone keeps every token in step with the engine (HP, square, KO, energy)', async () => {
  const { r, view } = await makeView();
  const rand = lcg(11);
  let mismatches = 0;
  const kinds = new Set();
  const { maxFrames } = await playPlies(r, view, battle(5), 40, rand, {
    check: (res, ply, action) => {
      kinds.add(action.type);
      for (const u of res.state.units) {
        const t = view.tokens.get(u.id);
        const alive = !!u.alive && u.sq >= 0;
        if (!t) {
          if (alive) mismatches++;
          continue;
        }
        const bad = [];
        if (t.alive !== alive) bad.push(`alive ${t.alive} ≠ ${alive}`);
        if (alive && t.sq !== u.sq) bad.push(`sq ${t.sq} ≠ ${u.sq}`);
        if (alive && t.hp !== u.hp) bad.push(`hp ${t.hp} ≠ ${u.hp}`);
        if (alive && Math.round(t.energy) !== Math.round(u.energy)) bad.push(`energy ${t.energy} ≠ ${u.energy}`);
        if (bad.length) {
          mismatches++;
          assert.fail(`ply ${ply} ${action.type} ${action.unit}: ${u.id} ${bad.join(', ')}`);
        }
      }
    },
  });
  assert.equal(mismatches, 0);
  assert.ok(kinds.has('ult'), `ultimates were played (${[...kinds].join(', ')})`);
  // one action (with the turn change after it) never takes more than ~6 s of game time at speed 1
  assert.ok(maxFrames * (1000 / 30) <= 6500, `longest action ${Math.round(maxFrames * 33)} ms`);
  view.destroy();
});

test('skip() during an Ultimate ends it at once and lands on the final state; hide() mid-play aborts', async () => {
  const { r, view } = await makeView();
  let s = battle(9);
  const ult = chargeUlt(s);
  view.setState(s);
  assert.ok(ult, 'an ultimate is available');
  const res = applyAction(s, ult);
  let done = false;
  view.play(res.events, { state: res.state }).then(() => (done = true));
  await pump(r, () => false, 20); // ~0.6 s into the cinematic
  assert.equal(view.busy, true);
  view.skip();
  const frames = await pump(r, () => done, 200);
  assert.ok(done && frames <= 3, `resolved ${frames} frames after skip`);
  for (const u of res.state.units) {
    const t = view.tokens.get(u.id);
    if (!t) continue;
    assert.equal(t.alive, !!u.alive && u.sq >= 0);
    if (u.alive) assert.equal(t.hp, u.hp);
  }
  assert.equal(view.stats().tasks, 0, 'no choreography left running');
  // hide() in the middle of a play: resolves, detaches
  s = res.state;
  const acts = legalActions(s);
  const res2 = applyAction(s, acts.find((a) => a.type !== 'pass') || acts[0]);
  let done2 = false;
  view.play(res2.events, { state: res2.state }).then(() => (done2 = true));
  await pump(r, () => false, 5);
  view.hide();
  await pump(r, () => done2, 50);
  assert.equal(done2, true);
  assert.equal(view.shown, false);
  view.destroy();
});

test('settings: no damage numbers when switched off; "short" Ultimates skip the splash cut-in', async () => {
  const settings = { lang: 'en', fx: {}, rpgDamageNumbers: false, rpgUltCinematic: 'short' };
  const { r, view } = await makeView(settings);
  assert.equal(view.lang, 'en');
  let cutins = 0;
  const orig = view.cutin.play.bind(view.cutin);
  view.cutin.play = (...a) => {
    cutins++;
    return orig(...a);
  };
  let shown = 0;
  const origShow = view.numbers.show.bind(view.numbers);
  view.numbers.show = (o) => {
    const it = origShow(o);
    if (it) shown++;
    return it;
  };
  await playPlies(r, view, battle(3), 12, lcg(5), { ultChance: 0.5, final: true });
  assert.equal(cutins, 0, 'no cut-in in short mode');
  assert.equal(shown, 0, 'no numbers');
  // full mode plays the cut-in (once per ult)
  view.applySettings({ lang: 'ru', fx: {}, rpgUltCinematic: 'full' });
  const s = battle(4);
  const ult = chargeUlt(s);
  assert.ok(ult);
  view.setState(s);
  const res = applyAction(s, ult);
  let done = false;
  view.play(res.events, { state: res.state }).then(() => (done = true));
  await pump(r, () => done);
  assert.equal(cutins, 1);
  assert.ok(shown > 0, 'numbers are back once the setting is on again');
  view.destroy();
});

test('no leaks: after many turns the scene graph is the size of a fresh view of the same state', async () => {
  const { r, view } = await makeView();
  const { s } = await playPlies(r, view, battle(7), 30, lcg(3), { final: true });
  view.setState(s);
  await pump(r, () => false, 150); // lingering particles / numbers / labels end
  const used = view.stats();
  const fresh = await makeView();
  fresh.view.setState(s);
  const clean = fresh.view.stats();
  assert.equal(used.numbers, 0);
  assert.equal(used.tasks, 0);
  assert.equal(used.bits, 0);
  assert.ok(used.nodes <= clean.nodes + 4, `scene graph ${used.nodes} nodes vs fresh ${clean.nodes}`);
  // an idle board does not grow either
  const n0 = view.stats().nodes;
  await pump(r, () => false, 120);
  assert.equal(view.stats().nodes, n0);
  assert.ok(r.layers.world.children.every((c) => c instanceof Container));
  view.destroy();
  fresh.view.destroy();
});
