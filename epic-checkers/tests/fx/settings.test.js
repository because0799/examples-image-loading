// Personal settings (SETTINGS CONTRACT) as FX and the Director honour them, and the readability
// rule (prefs.readMs) every text overlay follows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Container, Texture, Rectangle } from 'pixi.js';
import { Clock } from '../../src/render/tween.js';
import { FX } from '../../src/fx/fx.js';
import { readMs, visibleChars, textTimeOf, animSpeedOf, fxPref, hapticsOf, hapticScale, bragRate, READ_BASE, epicSideColor, toHex } from '../../src/fx/prefs.js';
import { stateFromString, legalMoves, applyMove, createInitialState, VARIANTS } from '../../src/engine/index.js';
import { setupDirector, drive } from './_harness.js';

// ---------------------------------------------------------------- prefs / readability
test('readMs = max(base[kind], 700 + 70 ms × visible characters) × textTime', () => {
  assert.equal(readMs('斬!', 'kanji', { textTime: 1 }), READ_BASE.kanji);
  assert.equal(readMs('斬!', 'kanji', { textTime: 1.5 }), Math.round(READ_BASE.kanji * 1.5));
  assert.equal(readMs('Ты уже мёртв.', 'caption', { textTime: 1 }), READ_BASE.caption, 'short lines get the base');
  const long = 'Одним ходом — минус три шашки! Кто следующий?';
  assert.equal(readMs(long, 'caption', { textTime: 1 }), 700 + 70 * visibleChars(long));
  assert.equal(readMs(long, 'caption', { textTime: 2 }), 2 * (700 + 70 * visibleChars(long)));
  assert.equal(visibleChars('  А Б​В  '), 3, 'spaces and invisible marks do not count');
  assert.equal(readMs(['ПРОБУЖДЕНИЕ', 'ДАМКА ВОССТАЛА'], 'promo', 1), 700 + 70 * 24, 'several lines add up');
  // defaults: textTime 1.5 when unset / invalid
  assert.equal(textTimeOf(null), 1.5);
  assert.equal(textTimeOf({ textTime: 'x' }), 1.5);
  assert.equal(readMs('x', 'banner'), Math.round(READ_BASE.banner * 1.5));
  // minimum bases from the contract
  assert.ok(READ_BASE.caption >= 2600 && READ_BASE.banner >= 1500 && READ_BASE.kanji >= 1100 && READ_BASE.cutin >= 1800);
  assert.ok(READ_BASE.combo >= 2200 && READ_BASE.vs >= 2200 && READ_BASE.ultimate >= 2200 && READ_BASE.gameover >= 3000);
});

test('prefs: fx fields validated with contract defaults; haptics; brag rates; side colours', () => {
  assert.equal(fxPref(null, 'shake'), 1);
  assert.equal(fxPref({ fx: { shake: 0 } }, 'shake'), 0);
  assert.equal(fxPref({ fx: { shake: 9 } }, 'shake'), 1.5);
  assert.equal(fxPref({ fx: { particles: 0.01 } }, 'particles'), 0.25);
  assert.equal(fxPref({ fx: { flashes: 'no' } }, 'flashes'), true, 'wrong type → default');
  assert.equal(fxPref({ fx: { flashes: false } }, 'flashes'), false);
  assert.equal(fxPref({ fx: { brags: 'loud' } }, 'brags'), 'normal');
  assert.equal(animSpeedOf({ animSpeed: 0.5 }), 0.5);
  assert.equal(animSpeedOf({}), 1);
  assert.equal(hapticsOf({ haptics: 'light' }), 'light');
  assert.equal(hapticsOf({ vibration: false }), 'off', 'old saves');
  assert.equal(hapticsOf({}), 'strong');
  assert.deepEqual(hapticScale([40, 30, 70], 'light'), [20, 30, 35], 'light halves every pulse, pauses stay');
  assert.equal(hapticScale([40], 'off'), null);
  assert.equal(bragRate({ fx: { brags: 'off' } }).chance, 0);
  assert.ok(bragRate({ fx: { brags: 'rare' } }).per30 < bragRate({}).per30);
  assert.ok(bragRate({ fx: { brags: 'often' } }).per30 > bragRate({}).per30);
  assert.equal(toHex('#FF4FD8'), 0xff4fd8);
  assert.equal(epicSideColor({ sideColor: (s) => (s === 1 ? '#3DFF8F' : 0xff2e63) }, 1), 0x3dff8f);
  assert.equal(epicSideColor(null, -1), 0xff2e63, 'palette fallback');
});

// ---------------------------------------------------------------- FX gating
function fakeRenderer() {
  const layers = {};
  for (const k of ['background', 'world', 'board', 'boardFx', 'highlights', 'pieces', 'worldFx', 'screenFx', 'overlay']) layers[k] = new Container();
  const shakes = [];
  return {
    ready: true,
    clock: new Clock(),
    layers,
    theme: 'epic',
    resolution: 1,
    squareSize: 40,
    boardCenter: { x: 160, y: 160 },
    frameBounds: { x: 0, y: 0, width: 320, height: 320 },
    screen: { width: 390, height: 844 },
    camera: { zoom: 1, punchScale: 1, rotation: 0, shakeRot: 0, ox: 0, oy: 0, shakeX: 0, shakeY: 0, shake: (i, ms) => shakes.push([i, ms]) },
    app: { stage: new Container(), screen: new Rectangle(0, 0, 390, 844) },
    lightning() {
      this.skies = (this.skies || 0) + 1;
    },
    shakes,
  };
}

function fxSetup(settings) {
  const r = fakeRenderer();
  const tex = new Texture();
  tex.fx = { width: 100, height: 60, textWidth: 90, key: 'k' };
  const seeds = [];
  const textures = {
    atlas: tex,
    frame: () => tex,
    rays: () => tex,
    vignette: () => tex,
    band: () => tex,
    bandStreaks: () => tex,
    emblem: () => tex,
    text: (t, st, seed) => {
      seeds.push([t, seed]);
      return tex;
    },
    releaseText() {},
    crack: () => ({ base: tex, glow: null, size: 32, refs: 0 }),
    destroy() {},
  };
  const fx = new FX({ renderer: r, quality: 'low', mode: 'epic', textures });
  if (settings) fx.applySettings(settings);
  const step = (ms, n = 1) => {
    for (let i = 0; i < n; i++) r.clock.update(ms);
  };
  return { r, fx, step, seeds };
}

test('FX: shake scale (0 = never shakes) and particle multiplier on top of the quality caps', () => {
  const { r, fx } = fxSetup({ fx: { shake: 0 } });
  fx.shake(0.5, 300);
  assert.equal(r.shakes.length, 0);
  fx.settings.fx.shake = 0.5; // the live object is read at use time
  fx.shake(0.5, 300);
  assert.deepEqual(r.shakes[0], [0.25, 300]);
  const a = fxSetup({ fx: { particles: 1 } }).fx;
  const b = fxSetup({ fx: { particles: 0.25 } }).fx;
  a.burst(10, 10, { kind: 'spark', count: 100 });
  b.burst(10, 10, { kind: 'spark', count: 100 });
  assert.ok(b.particles.count < a.particles.count * 0.5, `${b.particles.count} vs ${a.particles.count}`);
  assert.ok(b.particles.cap < a.particles.cap);
});

test('FX: flashes off → no white flash / impact frame / chromatic / bloom; a gentle pulse instead', () => {
  const { fx, r, step } = fxSetup({ fx: { flashes: false } });
  fx.flash(0xffffff, { alpha: 0.9, duration: 200 });
  fx.impactFrame({ duration: 120 });
  fx.chromatic(1, 300);
  fx.bloomPulse(1, 300);
  fx.lightning(0, 0, 100, 100, { sky: true });
  let peak = 0;
  for (let i = 0; i < 40; i++) {
    step(16);
    for (const s of fx.c.overlay.children) peak = Math.max(peak, s.alpha);
  }
  assert.ok(peak <= 0.3, `nothing bright on the overlay (peak alpha ${peak})`);
  assert.equal(r.skies || 0, 0, 'no sky flash');
  assert.equal(fx._impactUntil, 0, 'no impact frame registered');
});

test('FX: slowmo off keeps the clock at 1; kanji / cut-ins / combo / auras off draw nothing', async () => {
  const { fx, r, step } = fxSetup({ fx: { slowmo: false, kanji: false, cutins: false, combo: false, auras: false } });
  fx.slowMo(0.3, 500);
  fx.hitStop(100);
  step(16, 5);
  assert.equal(r.clock.scale, 1);
  const before = fx.stats().nodes;
  await fx.kanji('斬!', 10, 10);
  await fx.menacing(10, 10);
  await fx.cutIn({ title: 'X' });
  await fx.comboCounter(3);
  assert.equal(fx.stats().nodes, before);
  assert.equal(fx.combo, null);
  const view = new Container();
  view.auraLayer = new Container();
  view.addChild(view.auraLayer);
  new Container().addChild(view);
  view.body = { x: 0, y: 0, scale: { x: 1 } };
  const h = fx.aura(view, {});
  assert.equal(view.auraLayer.children.length, 0);
  assert.equal(typeof h.stop, 'function');
});

test('FX: switching auras off puts running auras out', () => {
  const { fx, step } = fxSetup({});
  const view = new Container();
  view.auraLayer = new Container();
  view.addChild(view.auraLayer);
  new Container().addChild(view);
  view.body = { x: 0, y: 0, scale: { x: 1 } };
  fx.aura(view, {});
  assert.equal(view.auraLayer.children.length, 1);
  fx.applySettings({ fx: { auras: false } });
  step(16, 40);
  assert.equal(view.auraLayer.children.length, 0);
});

test('FX: kanji hold is readable (readMs × textTime) and reuses one texture per text (fixed seed)', () => {
  const { fx, seeds } = fxSetup({ textTime: 2 });
  const p1 = fx.kanji('斬!', 10, 10, { realtime: true });
  const p2 = fx.kanji('斬!', 30, 10, { realtime: true });
  assert.equal(seeds[0][1], seeds[1][1], 'same seed → same cached texture');
  assert.ok(p1.effect.duration >= 230 + 1100 * 2, `duration ${p1.effect.duration}`);
  assert.ok(p2.effect.root, 'the root is exposed for the Director');
});

// ---------------------------------------------------------------- Director gating
const TRIPLE = 'w:.b.....b/......../...b.b../......../.b....../w......./......../....w.w.';
function triple() {
  const before = stateFromString('russian', TRIPLE);
  const move = legalMoves(before).find((m) => m.path.join('-') === '40-26-12-30');
  return { before, move, after: applyMove(before, move) };
}
const NAMES = { 1: { name: 'Ты', isHuman: true }, '-1': { name: 'Сёгун', isHuman: false, level: 4 } };
const AI_NAMES = { 1: { name: 'Сёгун', isHuman: false, level: 4 }, '-1': { name: 'Ты', isHuman: true } };

async function playTriple(settings, { human = true, hype = 0, setup } = {}) {
  const S = setupDirector(8, 'epic', settings);
  if (setup) setup(S);
  const { r, d } = S;
  const { before, move, after } = triple();
  r.setPosition(before);
  d.syncPosition(before);
  const camCalls = [];
  r.camera.focus = (...a) => {
    camCalls.push(['focus', ...a]);
    return Promise.resolve(true);
  };
  r.camera.punch = (...a) => camCalls.push(['punch', ...a]);
  const res = await drive(r, d.playMove({ move, before, after, mover: 1, moverIsHuman: human, names: human ? NAMES : AI_NAMES, stats: { hype: { 1: hype, '-1': 0 } } }));
  return { ...S, res, camCalls };
}

test('Director: camera off → no zoom / pan / dutch / punch', async () => {
  const on = await playTriple({});
  assert.ok(on.camCalls.length > 3);
  const off = await playTriple({ fx: { camera: false } });
  assert.deepEqual(off.camCalls, []);
  assert.ok(off.res.finished);
});

test('Director: cut-ins off → no band; the attack name becomes a speech bubble', async () => {
  const said = [];
  const { fx, res } = await playTriple({ fx: { cutins: false } }, { setup: ({ d }) => (d._say = (c, text) => (said.push(text), Promise.resolve(null))) });
  assert.ok(res.finished);
  assert.equal(fx.calls.filter((c) => c[0] === 'cutIn').length, 0);
  assert.ok(said.length >= 1, 'the attack name was said');
  const withBand = await playTriple({});
  assert.equal(withBand.fx.calls.filter((c) => c[0] === 'cutIn').length, 1);
});

test('Director: the cut-in holds the attack name for its readable time; textTime stretches the scene', async () => {
  const a = await playTriple({ textTime: 1 });
  const b = await playTriple({ textTime: 3 });
  const cutA = a.fx.calls.find((c) => c[0] === 'cutIn')[1];
  const cutB = b.fx.calls.find((c) => c[0] === 'cutIn')[1];
  assert.equal(cutA.hold, readMs(cutA.title, 'cutin', { textTime: 1 }));
  assert.equal(cutB.hold, readMs(cutB.title, 'cutin', { textTime: 3 }));
  // the move waits for the band: the longer hold shows up in the scene length
  assert.ok(b.res.t - a.res.t >= (cutB.hold - cutA.hold) * 0.9, `${a.res.t} → ${b.res.t} (holds ${cutA.hold} → ${cutB.hold})`);
  // kanji get readable holds too
  const k = b.fx.calls.filter((c) => c[0] === 'kanji');
  assert.ok(k.length >= 2);
  for (const c of k) assert.equal(c[4].hold, readMs(c[1], 'kanji', { textTime: 3 }), c[1]);
});

test('Director: animSpeed < 1 slows motion; skip() still finishes fast at textTime 3', async () => {
  // compare the motion around the attack-name band (its readable hold depends on the random name)
  const bandSpy = (box) => ({ d }) => {
    const claim = d._claimCenter.bind(d);
    d._claimCenter = (p, read, dur) => ((box.hold = (box.hold || 0) + (dur || read)), claim(p, read, dur));
  };
  const hf = {};
  const hs = {};
  const fast = await playTriple({ animSpeed: 1, textTime: 1 }, { setup: bandSpy(hf) });
  const slow = await playTriple({ animSpeed: 0.5, textTime: 1 }, { setup: bandSpy(hs) });
  assert.ok(slow.res.t - hs.hold > (fast.res.t - hf.hold) * 1.4, `${fast.res.t}-${hf.hold} vs ${slow.res.t}-${hs.hold}`);
  const S = setupDirector(8, 'epic', { textTime: 3, animSpeed: 0.5 });
  const { before, move, after } = triple();
  S.r.setPosition(before);
  S.d.syncPosition(before);
  let at = -1;
  const res = await drive(S.r, S.d.playMove({ move, before, after, mover: 1, moverIsHuman: true, names: NAMES, stats: null }), {
    onFrame: (t) => {
      if (at < 0 && t >= 1500) {
        S.d.skip();
        at = t;
      }
    },
  });
  assert.ok(res.finished && res.t - at < 1200, `skip took ${res.t - at}`);
});

test('Director: opponentFx short → the AI move is compact (≤ 1.4 s, no cut-in), full otherwise', async () => {
  for (const hype of [0, 1]) {
    const c = await playTriple({ opponentFx: 'short' }, { human: false, hype });
    assert.ok(c.res.t <= 1400, `compact took ${c.res.t}`);
    assert.equal(c.fx.calls.filter((x) => x[0] === 'cutIn').length, 0);
    assert.deepEqual(c.camCalls, [], 'no camera work');
  }
  const f = await playTriple({ opponentFx: 'full' }, { human: false });
  assert.ok(f.res.t > 1400);
  // the player's own moves are never compact
  const own = await playTriple({ opponentFx: 'short' }, { human: true });
  assert.equal(own.fx.calls.filter((x) => x[0] === 'cutIn').length, 1);
});

test('Director: haptics light halves pulses, off silences, legacy vibration:false silences', async () => {
  const pulses = async (settings) => {
    const { log } = await playTriple(settings);
    return log.vib;
  };
  const strong = await pulses({ haptics: 'strong' });
  const light = await pulses({ haptics: 'light' });
  assert.ok(strong.length > 0 && light.length === strong.length);
  for (let i = 0; i < strong.length; i++) assert.ok(light[i][0] <= Math.max(6, strong[i][0] / 2) + 0.5, `${light[i]} vs ${strong[i]}`);
  assert.deepEqual(await pulses({ haptics: 'off' }), []);
  assert.deepEqual(await pulses({ vibration: false }), []);
});

test('Director: turn banners off; vsIntro off → quick start without VS / banner', async () => {
  const S = setupDirector(8, 'epic', { fx: { turnBanners: false } });
  const shown = [];
  S.d._banner = (c, text) => (shown.push(text), Promise.resolve(null));
  const st = createInitialState('russian');
  S.r.setPosition(st);
  S.d.syncPosition(st);
  await drive(S.r, S.d.playTurn({ color: 1, isHuman: true, players: NAMES }));
  assert.deepEqual(shown, []);
  const Q = setupDirector(8, 'epic', { fx: { vsIntro: false } });
  Q.r.setPosition(st);
  Q.d.syncPosition(st);
  const res = await drive(Q.r, Q.d.playGameStart({ variant: VARIANTS[0], players: NAMES, epic: true, bottomColor: 1 }));
  assert.ok(res.finished && res.t < 700, `quick start ${res.t}`);
  assert.equal(Q.fx.calls.filter((c) => c[0] === 'banner').length, 0);
  Q.r.forEachPiece((v) => assert.equal(v.alpha, 1));
});

test('Director: brags off / rare / often pace the captions', async () => {
  const count = async (brags) => {
    let n = 0;
    const orig = Math.random;
    let s = 12345;
    Math.random = () => (s = (s * 16807) % 2147483647) / 2147483647;
    try {
      const S = setupDirector(8, 'epic', { fx: { brags } });
      S.d._say = () => (n++, Promise.resolve(null));
      const before = stateFromString('russian', 'w:.b.b.b.b/b.b.b.b./......../......../...b..../..w...../.w.w.w.w/w.w.w.w.');
      const move = legalMoves(before).find((m) => m.captures.length === 1);
      const after = applyMove(before, move);
      for (let i = 0; i < 12; i++) {
        S.r.setPosition(before);
        S.d.syncPosition(before);
        S.d._lastCaption = -1e9; // no cooldown between the samples: count the per-move chance
        S.d._captionTimes = [];
        S.d._sinceCaption = { 1: 99, '-1': 99 };
        await drive(S.r, S.d.playMove({ move, before, after, mover: 1, moverIsHuman: true, names: NAMES, stats: null }));
      }
    } finally {
      Math.random = orig;
    }
    return n;
  };
  assert.equal(await count('off'), 0);
  const rare = await count('rare');
  const normal = await count('normal');
  const often = await count('often');
  assert.ok(rare < normal && normal <= often, `rare ${rare} normal ${normal} often ${often}`);
});

test('Director: the player name shows on the VS screen, in the victory title and in named brag lines', () => {
  const { d } = setupDirector(8, 'epic', { playerName: '  Макс  ' });
  const f = d._fighters(NAMES, 1);
  assert.equal(f.bottom.name, 'МАКС');
  assert.equal(f.top.name, 'СЁГУН');
  assert.equal(d._victoryTitle(1, 1, false), 'МАКС ПОБЕЖДАЕТ!');
  assert.equal(d._victoryTitle(1, 1, true), 'МАКС: БЕЗУПРЕЧНО!');
  const anon = setupDirector(8, 'epic', { playerName: '' }).d;
  assert.equal(anon._fighters(NAMES, 1).bottom.name, 'ИГРОК');
  assert.equal(anon._victoryTitle(1, 1, false), 'ТВОЯ ПОБЕДА!');
});

test('Director: side colours come from renderer.sideColor (the player picked green)', async () => {
  const { fx } = await playTriple({}, { setup: ({ r }) => (r.sideColor = (s) => (s === 1 ? '#3DFF8F' : '#FF2E63')) });
  const slash = fx.calls.find((c) => c[0] === 'slash');
  assert.equal(slash[4].color, 0x3dff8f);
  const cut = fx.calls.find((c) => c[0] === 'cutIn')[1];
  assert.equal(cut.color, 0x3dff8f);
});

test('Director: auras off removes the king auras at once; applySettings forwards to FX', () => {
  const S = setupDirector(8, 'epic', {});
  const st = stateFromString('russian', 'w:......../..W...../......../..b...../......../..B...../......../w.......');
  S.r.setPosition(st);
  S.d.syncPosition(st);
  const auras = () => {
    let n = 0;
    S.r.forEachPiece((v) => (n += v.auraLayer.children.length));
    return n;
  };
  assert.equal(auras(), 2);
  S.d.settings.fx = { auras: false };
  S.d.applySettings(S.d.settings);
  assert.equal(auras(), 0);
  assert.ok(S.fx.calls.some((c) => c[0] === 'applySettings'));
});

test('Director: the brag bubble of a ×3 comes only after the attack-name band was read', async () => {
  let bandAt = -1;
  let bandHold = 0;
  let captionAt = -1;
  await playTriple({ textTime: 1.5 }, {
    setup: ({ d, r, fx }) => {
      const orig = d._maybeCaption.bind(d);
      d._maybeCaption = (m, kind) => {
        if (kind === 'combo' && captionAt < 0) captionAt = r.clock.realNow;
        return orig(m, kind);
      };
      const oc = d._claimCenter.bind(d);
      d._claimCenter = (p, read, dur) => {
        if (bandAt < 0) {
          bandAt = r.clock.realNow;
          bandHold = read;
        }
        return oc(p, read, dur);
      };
      assert.ok(fx);
    },
  });
  assert.ok(bandAt >= 0 && captionAt >= 0);
  assert.ok(captionAt - bandAt >= 480 + bandHold, `caption ${captionAt - bandAt} ms after the band (hold ${bandHold})`);
});

test('Director: «ПРОБУЖДЕНИЕ» is a gold lane banner (it may outlive the move without covering the board)', async () => {
  const S = setupDirector(8, 'epic', {});
  const banners = [];
  S.d._banner = (c, text, o) => (banners.push([c, text, o.kind]), Promise.resolve(null));
  const before = stateFromString('russian', 'w:......../..w...../......../....b.../......../......../......../b.......');
  const move = legalMoves(before).find((m) => m.promotion);
  const after = applyMove(before, move);
  S.r.setPosition(before);
  S.d.syncPosition(before);
  const res = await drive(S.r, S.d.playMove({ move, before, after, mover: 1, moverIsHuman: true, names: NAMES, stats: null }));
  assert.ok(res.finished);
  assert.deepEqual(banners, [[1, 'ПРОБУЖДЕНИЕ', 'promo']]);
  assert.equal(S.fx.calls.filter((c) => c[0] === 'banner').length, 0, 'no full-width band over the board');
  assert.ok(res.t < 3200, `promotion ${res.t} ms`);
});

test('Director: a turn banner that waited past its turn is dropped (never «ХОД СОПЕРНИКА» on the player\'s turn)', async () => {
  const S = setupDirector(8, 'epic', {});
  const st = createInitialState('russian');
  S.r.setPosition(st);
  S.d.syncPosition(st);
  const shown = [];
  const origShow = S.d._stage._show.bind(S.d._stage);
  S.d._stage._show = (q) => {
    const before = S.d._stage.items.length;
    origShow(q);
    if (S.d._stage.items.length > before) shown.push(q.kind);
  };
  // a centre text is still being read: the first (AI) turn banner has to wait for it…
  S.d._bigUntil = S.r.clock.realNow + 3000;
  S.d.playTurn({ color: -1, isHuman: false, players: NAMES });
  for (let t = 0; t < 1000; t += 16) S.r.clock.update(16);
  // …meanwhile the AI moved and it is the player's turn (a quiet move: no banner for it)
  S.d._firstTurn = false;
  S.d._lastMove = { mover: -1, n: 0 };
  S.d.playTurn({ color: 1, isHuman: true, players: NAMES });
  await drive(S.r, new Promise((r) => setTimeout(r, 50)), { maxMs: 4000 });
  for (let t = 0; t < 4000; t += 16) S.r.clock.update(16);
  assert.deepEqual(shown, [], 'the stale AI banner never showed');
});

test('Director: flashes off → no DOM impact hook either (the HUD inversion is a flash)', async () => {
  const calls = [];
  await playTriple({ fx: { flashes: false } }, { setup: ({ d }) => (d.hooks.impact = (ms) => calls.push(ms)) });
  assert.deepEqual(calls, []);
  const on = [];
  await playTriple({}, { setup: ({ d }) => (d.hooks.impact = (ms) => on.push(ms)) });
  assert.ok(on.length >= 2);
});
