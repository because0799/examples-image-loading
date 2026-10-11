// Director showcase / verification page.
//
//   dev/director-demo/index.html?mode=epic|classic&scene=<name>&variant=<id>&quality=high|medium|low
//        &flipped=1 &lang=en &speed=1|1.5|2 &skip=<ms after start> &human=0 &audio=0 &announcer=0
//        &auto=0 (do not auto-run) &hud=0 (hide the HUD stand-ins) &label=1 (scene label)
//
// Scenes: quiet capture combo3 combo5turkish promote midpromo ultimate ultimate3 flying canadian
//         aicapture start win flawless lose draw turn turnai select illegal hint
//   ?variant only changes the generic scenes (quiet, start, win/lose/flawless/draw, turn, select,
//   illegal, hint) — capture/combo scenes carry their own variant.
//
// window.__demo (for tools/shot.mjs steps):
//   ready, done, result { scene, elapsed (real ms, clock time), ok, diff[], sfx[], haptics, speech[] }
//   start(name) → starts a scene (returns immediately; await run(name) to wait)
//   run(name) → Promise<result>
//   skip()                    Director.skip()
//   freeze() / unfreeze()     stop/start the Pixi ticker
//   advance(ms)               step the game deterministically (60 fps), flushing promise callbacks
//                             between frames, then render once (async)
//   stats()                   FX stats + marks + clock scale

import { Renderer } from '../render/renderer.js';
import { wait } from '../render/tween.js';
import { FX } from '../fx/fx.js';
import { Director } from '../fx/director.js';
import { allKanji } from '../fx/brag.js';
import { AudioEngine } from '../audio/audio.js';
import { createInitialState, stateFromString, legalMoves, applyMove, getVariant, VARIANTS } from '../engine/index.js';

const params = new URLSearchParams(location.search);
const P = {
  mode: params.get('mode') === 'classic' ? 'classic' : 'epic',
  scene: params.get('scene') || 'capture',
  variant: params.get('variant'),
  quality: params.get('quality') || 'high',
  flipped: params.get('flipped') === '1',
  lang: params.get('lang') === 'en' ? 'en' : 'ru',
  speed: Number(params.get('speed') || 1),
  skip: params.get('skip') != null ? Number(params.get('skip')) : null,
  human: params.get('human') !== '0',
  audio: params.get('audio') !== '0',
  announcer: params.get('announcer') !== '0',
  auto: params.get('auto') !== '0',
  hud: params.get('hud') !== '0',
  label: params.get('label') === '1',
  delay: Number(params.get('delay') || 500),
};

const stage = document.getElementById('stage');
const slot = document.getElementById('board-slot');
if (!P.hud) for (const id of ['hud-top', 'hud-bottom']) document.getElementById(id).style.display = 'none';

/** Board slot like the game screen: opponent panel on top, player panel + actions below. */
function layoutSlot() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const landscape = w > h * 1.1;
  const top = landscape ? 12 : Math.round(Math.max(76, h * 0.13));
  const bottom = landscape ? 12 : Math.round(Math.max(96, h * 0.2));
  const side = Math.min(w - 10, h - top - bottom, 900);
  const x = Math.round((w - side) / 2);
  const y = Math.round(top + (h - top - bottom - side) / 2);
  Object.assign(slot.style, { left: `${x}px`, top: `${y}px`, width: `${side}px`, height: `${side}px` });
  const ht = document.getElementById('hud-top');
  const hb = document.getElementById('hud-bottom');
  ht.style.height = `${Math.max(0, top - 22)}px`;
  hb.style.height = `${Math.max(0, bottom - 30)}px`;
  if (landscape) ht.style.display = hb.style.display = 'none';
  return { x, y, width: side, height: side };
}

// ------------------------------------------------------------------------------- scenes
const S = (v, str) => () => stateFromString(v, str);
const INIT = (v) => () => createInitialState(v);

/** Move scenes: variant, position, how to pick the move (from square or 'max'). */
const MOVE_SCENES = {
  quiet: { variant: null, state: null, pick: 'quiet' },
  capture: { variant: 'russian', state: S('russian', 'w:.b.b.b.b/b.b.b.../.......b/......../...b..../w.w.w.w./.w.w.w.w/w.w.w.w.'), pick: 42 },
  combo3: { variant: 'russian', state: S('russian', 'w:.b.b.b.b/......b./...b...b/......../...b..../......../.b.w.w.w/w.w.w.w.'), pick: 'max' },
  combo5turkish: { variant: 'turkish', state: S('turkish', 'w:..bb..bb/bb.b...b/....b.b./...b..../..b...../.b....w./.w.www../........'), pick: 'max' },
  promote: { variant: 'russian', state: S('russian', 'w:.b...b.b/..w.b.../.....b../......../...w..../w.....w./.w.w...w/w...w...'), pick: 10 },
  midpromo: { variant: 'russian', state: S('russian', 'w:......../..b...b./.b.b.b../......b./...b.w../w.....w./.w...b.w/w...w...'), pick: 'max' },
  ultimate: { variant: 'russian', state: S('russian', 'w:.b.b.b.b/b.b.b.../.......b/......../...b..../w.w.w.w./.w.w.w.w/w.w.w.w.'), pick: 42, hype: 1 },
  ultimate3: { variant: 'russian', state: S('russian', 'w:.b.b.b.b/......b./...b...b/......../...b..../......../.b.w.w.w/w.w.w.w.'), pick: 'max', hype: 1 },
  flying: {
    variant: 'international',
    state: S('international', 'w:........../........../...b.W.b../......b.../........../........../...b.w.b../....b...../.w.b.b...b/......w...'),
    pick: 'max',
  },
  canadian: {
    variant: 'canadian',
    state: S('canadian', 'w:............/........b.../.b...b....../..b.b.b.b.../...b......../........b.b./.b.w...w.w.w/..b.b......./.......b..../b.w.....w.w./...........b/..w.w.......'),
    pick: 'max',
  },
  aicapture: { variant: 'russian', state: S('russian', 'b:.b.b.b.b/b.b.b.../.....b.b/....b.../...w..../w...w.w./.w.w.w.w/w.w.w.w.'), pick: 'max', ai: true },
};

const END_POS = {
  win: 'b:......../......../......../..W...../.....w../w...W.../...w...w/w.w.....',
  flawless: 'b:...W..../......../.w....../..W...../.....w../w...W.../.w.w...w/w.w.w.w.',
  lose: 'w:.b...b../b.b.B.../.b...b.b/......../...B..../......../.......w/........',
  draw: 'w:......../......B./......../......../......../..W...../......../........',
};

function pickMove(state, pick) {
  const ms = legalMoves(state);
  if (!ms.length) return null;
  if (pick === 'max') return ms.slice().sort((a, b) => b.captures.length - a.captures.length || b.path.length - a.path.length)[0];
  if (pick === 'quiet') {
    const n = state.size;
    // a centre-ish quiet move
    const q = ms.filter((m) => !m.captures.length);
    const list = q.length ? q : ms;
    list.sort((a, b) => Math.abs((a.to % n) - n / 2 + 0.5) - Math.abs((b.to % n) - n / 2 + 0.5));
    return list[0];
  }
  return ms.find((m) => m.path[0] === pick) || ms[0];
}

function names(aiColor) {
  const ru = P.lang !== 'en';
  const you = { name: ru ? 'Ты' : 'You', isHuman: true, title: ru ? 'Легенда доски' : 'Board Legend' };
  const ai = { name: ru ? 'Сёгун' : 'Shogun', isHuman: false, title: ru ? 'ИИ · уровень 4' : 'AI · level 4', level: 4, power: 9001, kanji: '将軍' };
  return aiColor === 1 ? { 1: { ...ai, color: 1 }, '-1': { ...you, color: -1 } } : { 1: { ...you, color: 1 }, '-1': { ...ai, color: -1 } };
}

function stats({ hype = {}, lost = { 1: 3, '-1': 9 } } = {}) {
  return {
    captures: { 1: lost[-1], '-1': lost[1] },
    maxCombo: { 1: 4, '-1': 2 },
    kingsMade: { 1: 2, '-1': 1 },
    piecesLost: { 1: lost[1], '-1': lost[-1] },
    ultimates: { 1: 1, '-1': 0 },
    hype: { 1: hype[1] || 0, '-1': hype[-1] || 0 },
    moveNumber: 23,
  };
}

// ------------------------------------------------------------------------------- feedback stubs
const log = { sfx: [], haptics: 0, speech: [] };
const audioStub = {
  play(name, o) {
    log.sfx.push(name);
  },
  music() {},
  setIntensity() {},
  duck() {},
  unlock() {},
};
const nativeStub = {
  isAndroid: false,
  vibrate() {
    log.haptics++;
  },
  speak(text) {
    log.speech.push(text);
  },
};

// ------------------------------------------------------------------------------- main
const renderer = new Renderer(stage);
let fx = null;
let director = null;
// personal settings from the URL: &textTime=2&opponentFx=short&haptics=light&playerName=Макс
// &fx=shake:0,flashes:0,brags:often,particles:0.5 (SETTINGS CONTRACT, src/ui/storage.js)
const Q = new URLSearchParams(location.search);
const fxOverrides = {};
for (const kv of (Q.get('fx') || '').split(',').filter(Boolean)) {
  const [k, v] = kv.split(':');
  fxOverrides[k] = v === '0' || v === 'false' ? false : v === '1' || v === 'true' ? true : Number.isFinite(+v) ? +v : v;
}
const settings = {
  lang: P.lang,
  haptics: Q.get('haptics') || 'strong',
  vibration: Q.get('haptics') !== 'off',
  announcer: P.announcer,
  quality: P.quality,
  animSpeed: P.speed,
  textTime: +(Q.get('textTime') || 1.5),
  opponentFx: Q.get('opponentFx') || 'full',
  playerName: Q.get('playerName') || '',
  fx: { shake: 1, flashes: true, slowmo: true, camera: true, cutins: true, kanji: true, brags: 'normal', turnBanners: true, combo: true, particles: 1, auras: true, backdrop: true, vsIntro: true, ...fxOverrides },
};
let current = null;
let frozen = false;

function variantFor(id) {
  try {
    return getVariant(id);
  } catch {
    return VARIANTS[0];
  }
}

/** Renderer pieces vs engine state: [] when identical. */
function diffBoard(state) {
  const out = [];
  const n = state.size;
  for (let sq = 0; sq < n * n; sq++) {
    const code = state.board[sq];
    const v = renderer.pieceAt(sq);
    if (!code) {
      if (v) out.push(`${sq}: extra piece`);
      continue;
    }
    if (!v) {
      out.push(`${sq}: missing ${code}`);
      continue;
    }
    if (v.color !== Math.sign(code) || v.isKing !== (Math.abs(code) === 2)) out.push(`${sq}: wrong piece`);
    const c = renderer.squareCenter(sq);
    if (Math.abs(v.x - c.x) > 0.5 || Math.abs(v.y - c.y) > 0.5) out.push(`${sq}: off-square`);
    if (!v.visible || v.alpha < 0.98 || Math.abs(v.scale.x - 1) > 0.02) out.push(`${sq}: not shown`);
  }
  return out;
}

function prepare(name) {
  const def = MOVE_SCENES[name];
  const vid = def ? def.variant || P.variant || 'russian' : P.variant || 'russian';
  const variant = variantFor(vid);
  let state;
  if (def && def.state) state = def.state();
  else if (['win', 'flawless', 'lose', 'draw'].includes(name)) state = variant.id === 'russian' && END_POS[name] ? stateFromString('russian', END_POS[name]) : createInitialState(variant.id);
  else state = createInitialState(variant.id);
  renderer.setVariant(variant, { flipped: P.flipped });
  renderer.setBoardRect(layoutSlot());
  renderer.camera.snap();
  renderer.highlights.clear(true);
  renderer.setPosition(state);
  director.syncPosition(state);
  renderer.setTurnGlow(state.turn);
  return { def, variant, state };
}

function sceneLabel(name, extra = '') {
  const el = document.getElementById('label');
  if (P.label) el.textContent = `${P.mode} · ${name}${extra ? ' · ' + extra : ''}`;
}

async function play(name) {
  const { def, variant, state } = prepare(name);
  log.sfx = [];
  log.haptics = 0;
  log.speech = [];
  const clock = renderer.clock;
  const result = { scene: name, mode: P.mode, variant: variant.id, ok: true, diff: [], elapsed: 0 };
  sceneLabel(name, variant.id);
  if (P.skip != null) {
    const at = clock.realNow + P.skip;
    const off = clock.add(() => {
      if (clock.realNow >= at) {
        off();
        director.skip();
        result.skippedAt = Math.round(clock.realNow - t0);
      }
    });
  }
  const t0 = clock.realNow;
  if (def) {
    const move = pickMove(state, def.pick);
    if (!move) throw new Error(`scene ${name}: no move`);
    const after = applyMove(state, move);
    const mover = state.turn;
    const aiMover = def.ai || !P.human;
    const nm = names(aiMover ? mover : -mover);
    const st = stats({ hype: def.hype ? { [mover]: 1 } : {} });
    result.move = { path: move.path, captures: move.captures.length, promotion: move.promotion, promotionAt: move.promotionAt };
    await director.playMove({ move, before: state, after, mover, moverIsHuman: !aiMover, names: nm, stats: st });
    result.elapsed = Math.round(clock.realNow - t0);
    result.diff = diffBoard(after);
    result.ok = result.diff.length === 0;
    result.marks = director._marks.count;
  } else if (name === 'start') {
    const nm = names(-1);
    await director.playGameStart({ variant, players: nm, epic: P.mode === 'epic', mode: 'ai', bottomColor: P.flipped ? -1 : 1 });
    result.elapsed = Math.round(clock.realNow - t0);
    result.diff = diffBoard(state);
    result.ok = result.diff.length === 0;
  } else if (['win', 'flawless', 'lose', 'draw'].includes(name)) {
    const human = P.flipped ? -1 : 1;
    const winner = name === 'draw' ? 0 : name === 'lose' ? -human : human;
    const st = stats({ lost: name === 'flawless' ? { [human]: 0, [-human]: 12 } : { [human]: 4, [-human]: 12 } });
    renderer.setTurnGlow(winner || null);
    await director.playGameOver({ result: { winner, reason: 'no-pieces' }, humanColor: human, stats: st, players: names(-human) });
    result.elapsed = Math.round(clock.realNow - t0);
    result.diff = diffBoard(state);
    result.ok = result.diff.length === 0;
  } else if (name === 'turn' || name === 'turnai') {
    const human = name === 'turn';
    const color = human ? (P.flipped ? -1 : 1) : P.flipped ? 1 : -1;
    await director.playTurn({ color, isHuman: human, players: names(P.flipped ? 1 : -1) });
    await wait(700, { clock, realtime: true });
    result.elapsed = Math.round(clock.realNow - t0);
  } else if (name === 'select') {
    const ms = legalMoves(state);
    director.playSelect(ms[0].path[0]);
    renderer.highlights.setSelected(ms[0].path[0]);
    await wait(600, { clock, realtime: true });
    result.elapsed = Math.round(clock.realNow - t0);
  } else if (name === 'illegal') {
    const ms = legalMoves(state);
    director.playIllegal(ms[ms.length - 1].path[0]);
    await wait(600, { clock, realtime: true });
    result.elapsed = Math.round(clock.realNow - t0);
  } else if (name === 'hint') {
    const ms = legalMoves(state);
    await director.playHint(ms[Math.floor(ms.length / 2)].path);
    result.elapsed = Math.round(clock.realNow - t0);
  } else {
    throw new Error(`unknown scene ${name}`);
  }
  result.sfx = log.sfx.slice();
  result.haptics = log.haptics;
  result.speech = log.speech.slice();
  result.busyAfter = director.busy;
  result.clockScale = renderer.clock.scale;
  return result;
}

function start(name) {
  window.__demo.done = false;
  window.__demo.result = null;
  current = play(name).then(
    (r) => {
      window.__demo.result = r;
      window.__demo.done = true;
      if (!r.ok) console.error('[director-demo] FINAL POSITION MISMATCH', JSON.stringify(r.diff));
      else console.log(`[director-demo] ${name} done in ${r.elapsed} ms — final position OK`);
      return r;
    },
    (e) => {
      console.error('[director-demo] scene failed', e);
      window.__demo.result = { scene: name, ok: false, error: String(e && e.stack ? e.stack : e) };
      window.__demo.done = true;
      return window.__demo.result;
    },
  );
  return true;
}

const flush = () =>
  new Promise((res) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => res();
    ch.port2.postMessage(0);
  });

async function advance(ms, step = 1000 / 60) {
  const t = renderer.app.ticker;
  const n = Math.max(1, Math.round(ms / step));
  for (let i = 0; i < n - 1; i++) {
    renderer._tick({ deltaMS: step });
    await flush();
  }
  t.update(t.lastTime + step);
  await flush();
  return { done: window.__demo.done, t: Math.round(renderer.clock.realNow) };
}

function buildControls() {
  const box = document.getElementById('controls');
  if (P.auto || !params.get('controls')) return;
  for (const name of [...Object.keys(MOVE_SCENES), 'start', 'win', 'flawless', 'lose', 'draw', 'turn', 'turnai', 'select', 'illegal', 'hint']) {
    const b = document.createElement('button');
    b.textContent = name;
    b.onclick = () => start(name);
    box.appendChild(b);
  }
}

(async () => {
  await renderer.init({ quality: P.quality });
  renderer.setTheme(P.mode);
  renderer.setVariant(variantFor(P.variant || 'russian'), { flipped: P.flipped });
  renderer.setBoardRect(layoutSlot());
  window.addEventListener('resize', () => renderer.setBoardRect(layoutSlot()));
  fx = new FX({ renderer, quality: P.quality, mode: P.mode });
  fx.setLang(P.lang);
  // the real AudioEngine (unlocked by the first tap) behind a logging wrapper; ?audio=0 = stub only
  let audio = audioStub;
  if (P.audio) {
    try {
      const real = new AudioEngine({});
      real.music(P.mode === 'epic' ? 'epic' : 'classic', { fade: 600 });
      audio = {
        ...audioStub,
        play: (n, o) => {
          audioStub.play(n, o);
          real.play(n, o);
        },
        duck: (a, b) => real.duck(a, b),
        setIntensity: (x) => real.setIntensity(x),
        unlock: () => real.unlock(),
      };
    } catch (e) {
      console.warn('audio unavailable', e);
    }
  }
  director = new Director({ renderer, fx, audio, native: nativeStub, settings });
  director.setMode(P.mode);
  director.setLang(P.lang);
  await fx.preload(allKanji().concat(['ТВОЙ ХОД', 'ПРОБУЖДЕНИЕ']));
  renderer.onTap(() => director.busy && director.skip());
  window.__demo = {
    ready: true,
    done: false,
    result: null,
    renderer,
    fx,
    director,
    log,
    start,
    run: (name) => (start(name), current),
    skip: () => (director.skip(), true),
    freeze: () => {
      frozen = true;
      renderer.app.ticker.stop();
      return true;
    },
    unfreeze: () => {
      frozen = false;
      renderer.app.ticker.start();
      return true;
    },
    advance,
    stats: () => ({ ...fx.stats(), marks: director._marks.count, busy: director.busy, clock: renderer.clock.scale, done: window.__demo.done }),
    get frozen() {
      return frozen;
    },
  };
  buildControls();
  prepare(P.scene);
  if (P.auto) {
    await wait(P.delay, { clock: renderer.clock, realtime: true });
    start(P.scene);
  }
})();
