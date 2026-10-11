// Director — choreographs every visible game event (ARCHITECTURE.md §4), per mode.
//
//   const director = new Director({ renderer, fx, audio, native, settings });
//   director.setMode('classic' | 'epic');  director.setLang('ru' | 'en');
//   await director.playMove({ move, before, after, mover, moverIsHuman, names, stats });
//   director.busy / director.skip()          // tap during a cinematic → finish fast
//   playGameStart / playTurn / playGameOver / playSelect / playDeselect / playIllegal / playHint
//   director.syncAuras()                     // king auras ↔ kings on the board (epic)
//   director.syncPosition(state)             // the position was reset outside playMove (undo,
//                                            // new game, re-sync): abort the running cinematic's
//                                            // board writes, re-sync pieces if needed, auras
//   director.setLanes({ top, bottom })       // free screen space above / below the board frame
//                                            // ({ y, h } CSS px | null): turn banners, brag
//                                            // captions and the combo counter live there (≥ 44 px)
//   director.hooks = { impact, cinematic }   // assigned by the controller: impact(ms) on every
//                                            // manga impact frame (flash the DOM HUD),
//                                            // cinematic(true/false) around the VS intro, big
//                                            // finales, the ULTIMATE and victory (fade the HUD)
//   director.playHypeReady(color)            // «ЯРОСТЬ 100%» on-board moment (idempotent while
//                                            // the meter stays full; playMove calls it itself)
//   director.applySettings(settings)         // personal settings (live object, also re-read at
//                                            // use time); forwards to fx.applySettings
//
// PERSONAL SETTINGS (SETTINGS CONTRACT, prefs.js): animSpeed scales every motion (0.5 = twice as
// slow), textTime scales every text's readable time (prefs.readMs), opponentFx 'short' gives the
// AI's moves compact cinematics (no cut-in, ≤ 1.4 s), haptics 'off' | 'light' (pulses halved) |
// 'strong', playerName shows on the VS screen, in captions and in the victory title, announcer.
// settings.fx: shake / flashes / slowmo / particles / kanji / cutins / combo / auras are enforced
// by FX itself; the Director honours camera (no zoom / pan / dutch / punch), cutins (the attack
// name becomes a caption), brags (off / rare / normal / often), turnBanners, auras, vsIntro.
// Side colours come from renderer.sideColor(side) (the player's chosen energy colour).
//
// READABILITY: every text holds for prefs.readMs(text, kind) (× textTime) at full size. Texts may
// outlive the move (non-blocking); the Stage keeps lane texts and the centre bands from
// overlapping, and a newer text never cuts one that has been readable for < 60 % of its time
// (only the player's tap / skip() does).
//
// CLASSIC: elegant and quick — glide with a small arc per hop, soft landing dust, captured pieces
// sink + fade with sparkles, gold shimmer + crown on promotion, light haptics.
// EPIC: every move is a fight scene — dash + afterimages + speed lines; captures are finishing
// moves (camera punch, hit-stop, impact frame, slash, cracks, shatter, onomatopoeia, brag
// captions); multi-captures are slow-motion cinematics where the victims are struck and MARKED,
// then all explode at once after a cut-in with the attack name ("ты уже мёртв"); promotion is the
// «ПРОБУЖДЕНИЕ» (pillar of light, 覚醒, crown, permanent aura); hype ≥ 1 turns a capture into the
// ULTIMATE (必殺 screen cut-in, deeper slow-mo, god-rays).
//
// Guarantees: when playMove resolves, the renderer's pieces match `after` (verified square by
// square; renderer.setPosition(after) re-syncs on any difference). Promises never reject. Every
// game-time animation runs on renderer.clock (slow-mo / hit-stop / skip aware); motion timings are
// divided by settings.animSpeed. Motion pacing (animSpeed 1): quiet ≈ 0.6 s, single capture ≈ 2 s,
// ×2 ≈ 2.6 s, ×3 ≈ 4.5 s (+ the attack name's readable hold), promotion ≈ 2.8 s, ULTIMATE ≈ 4.5 s;
// classic stays brisk. A tap (skip()) still finishes any of them within ~1 s.

import { wait, tween, animate, Ease } from '../render/tween.js';
import { EPIC, CLASSIC } from '../render/palette.js';
import { mixHex } from '../render/canvas.js';
import { bragLine, attackName, kanjiFor, allKanji } from './brag.js';
import { caption, turnBanner, versus, versusHold, hintComet, godrays, pulse, overlayHeight, screenSlash, shorten } from './director-ui.js';
import { Marks } from './director-marks.js';
import { Stage } from './director-stage.js';
import { readMs, animSpeedOf, fxPref, hapticsOf, hapticScale, bragRate, epicSideColor, MIN_VISIBLE_SHARE } from './prefs.js';

const SKIP_SCALE = 5;
/** a newer text may cut an older one once it has been readable for this share of its time */
const MIN_SHARE = MIN_VISIBLE_SHARE;
const ABORT = { director: 'abort' };

const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const STR = {
  ru: {
    yourTurn: 'ТВОЙ ХОД',
    oppTurn: 'ХОД СОПЕРНИКА',
    whiteTurn: 'ХОД БЕЛЫХ',
    blackTurn: 'ХОД ЧЁРНЫХ',
    awakening: 'ПРОБУЖДЕНИЕ',
    awakeningSub: 'ДАМКА ВОССТАЛА',
    power: 'УРОВЕНЬ СИЛЫ',
    fight: 'ДА НАЧНЁТСЯ БИТВА!',
    victory: 'ТВОЯ ПОБЕДА!',
    victoryNamed: '{name} ПОБЕЖДАЕТ!',
    flawless: 'БЕЗУПРЕЧНО!',
    flawlessNamed: '{name}: БЕЗУПРЕЧНО!',
    defeat: 'ПОРАЖЕНИЕ…',
    draw: 'НИЧЬЯ',
    whiteWins: 'БЕЛЫЕ ПОБЕДИЛИ!',
    blackWins: 'ЧЁРНЫЕ ПОБЕДИЛИ!',
    cWin: 'Твоя победа!',
    cLoss: 'Поражение',
    cDraw: 'Ничья',
    cWhite: 'Победа белых',
    cBlack: 'Победа чёрных',
    king: 'Дамка!',
    maxCombo: 'МАКС. КОМБО ×{n}',
    kings: 'ДАМОК: {n}',
    lost: 'ПОТЕРЬ: {n}',
    captures: 'ВЗЯТО: {n}',
    combo: 'КОМБО ×{n}',
    white: 'Белые',
    black: 'Чёрные',
    you: 'Ты',
    ultimate: 'УЛЬТА · ЯРОСТЬ 100%',
    rage: 'ЯРОСТЬ 100%!',
    player: 'ИГРОК',
    mustCapture: 'ОБЯЗАТЕЛЬНЫЙ БОЙ!',
    resign: 'СОПЕРНИК СДАЛСЯ',
    youResign: 'ПАРТИЯ СДАНА',
  },
  en: {
    yourTurn: 'YOUR TURN',
    oppTurn: "OPPONENT'S TURN",
    whiteTurn: 'WHITE TO MOVE',
    blackTurn: 'BLACK TO MOVE',
    awakening: 'AWAKENING',
    awakeningSub: 'A KING RISES',
    power: 'POWER LEVEL',
    fight: 'LET THE BATTLE BEGIN!',
    victory: 'YOU WIN!',
    victoryNamed: '{name} WINS!',
    flawless: 'PERFECT!',
    flawlessNamed: '{name}: PERFECT!',
    defeat: 'DEFEAT…',
    draw: 'DRAW',
    whiteWins: 'WHITE WINS!',
    blackWins: 'BLACK WINS!',
    cWin: 'You win!',
    cLoss: 'Defeat',
    cDraw: 'Draw',
    cWhite: 'White wins',
    cBlack: 'Black wins',
    king: 'King!',
    maxCombo: 'MAX COMBO ×{n}',
    kings: 'KINGS: {n}',
    lost: 'LOST: {n}',
    captures: 'TAKEN: {n}',
    combo: 'COMBO ×{n}',
    white: 'White',
    black: 'Black',
    you: 'You',
    ultimate: 'ULTIMATE · RAGE 100%',
    rage: 'RAGE 100%!',
    player: 'PLAYER',
    mustCapture: 'CAPTURE IS MANDATORY!',
    resign: 'OPPONENT RESIGNED',
    youResign: 'GAME RESIGNED',
  },
};

// web vibration patterns (vibrate, pause, vibrate …)
const HAPTIC = {
  select: [12],
  deselect: [8],
  move: [10],
  land: [16],
  hit: [26],
  capture: [40, 30, 70],
  combo: [30, 22, 42, 22, 80],
  bigImpact: [60, 25, 140],
  promote: [18, 40, 18, 40, 160],
  ultimate: [60, 30, 60, 30, 60, 40, 240],
  illegal: [25, 45, 25],
  win: [80, 60, 80, 60, 260],
  lose: [220, 120, 320],
  draw: [60, 90, 60],
  start: [40, 60, 90],
  turn: [12],
  hint: [10, 50, 10],
};

const COMBO_CALL = { 2: 'DOUBLE KILL!', 3: 'TRIPLE KILL!', 4: 'MEGA COMBO!', 5: 'ULTRA COMBO!' };

/** HUD portrait glyphs per AI level (same as the DOM HUD watermark). */
const LEVEL_GLYPH = { 1: '学', 2: '戦', 3: '侍', 4: '将', 5: '神' };

/**
 * Hype model (mirror of the controller's ЯРОСТЬ meter) used to spot the moment the meter fills up
 * at the end of playMove. The controller may overwrite director.hypeModel to stay in sync.
 */
export const HYPE_MODEL = { perCapture: 0.22, comboBonus: 0.12, perLoss: 0.06, promotion: 0.12 };

/** Finale templates for ×3 combos (rotated so consecutive triples differ, EAD-16). */
const TRIPLE_TEMPLATES = ['cutin', 'turned', 'slash'];

function material(state, color) {
  if (!state || !state.board) return 0;
  let s = 0;
  for (const c of state.board) if (sign(c) === color) s += Math.abs(c) === 2 ? 2.5 : 1;
  return s;
}

function countPieces(state, color) {
  if (!state || !state.board) return 0;
  let n = 0;
  for (const c of state.board) if (sign(c) === color) n++;
  return n;
}

export class Director {
  constructor({ renderer, fx = null, audio = null, native = null, settings = {} } = {}) {
    this.renderer = renderer;
    this.fx = fx;
    this.audio = audio;
    this.native = native;
    this.settings = settings || {};
    this.mode = 'classic';
    this.lang = this.settings.lang === 'en' ? 'en' : 'ru';
    this._depth = 0;
    this._gen = 0;
    this._skipping = false;
    this._waits = new Set();
    this._tracked = new Set();
    this._marks = new Marks(this);
    this._auras = new Map();
    this._lastCaption = -1e9;
    this._lastSpeak = -1e9;
    this._sinceCaption = { 1: 99, '-1': 99 };
    this._streak = { 1: 0, '-1': 0 };
    this._turnFx = null;
    this._clock = renderer.clock;
    /** controller hooks (never required): impact(ms), cinematic(on) */
    this.hooks = { impact: null, cinematic: null };
    this.hypeModel = { ...HYPE_MODEL };
    this._stage = new Stage(this);
    this._cineDepth = 0;
    this._bigUntil = 0; // real time until which a centre-screen banner / cut-in is up
    this._rageShown = { 1: false, '-1': false };
    this._lastMove = null; // { mover, n, at } of the last played move
    this._thinkFrom = null; // { color, at }: an AI turn started (playTurn) at real time `at`
    this._longThink = false;
    this._turnsShown = 0;
    this._firstTurn = true;
    this._tripleTpl = 0;
    this._doubles = 0;
    this._captionTimes = [];
    /** live Director kanji { seq, born, read, p, rect } (newer lettering keeps clear of them) */
    this._kanjiLive = [];
    this._kseq = 0;
    this._band = null;
    /** bumped on every playTurn: a queued turn banner of an older turn is dropped */
    this._turnSeq = 0;
    this._clock.add(this._tick, this);
    if (fx && typeof fx.applySettings === 'function' && !fx.settings) this._try(() => fx.applySettings(this.settings));
  }

  // =================================================================== lanes / hooks
  /**
   * Free screen space above / below the board frame (CSS px), between it and the HUD panels:
   * { top: { y, h } | null, bottom: { y, h } | null }. Lanes ≥ 44 px take the turn banners, brag
   * captions and the combo counter; smaller / missing lanes fall back to the board edges.
   */
  setLanes(lanes = {}) {
    this._stage.setLanes(lanes || {});
    if (this.fx) this.fx.safeRect = this._safeRect();
  }

  get lanes() {
    return this._stage.lanes;
  }

  /** Screen rect free of the DOM HUD (kanji are clamped into it), from the lanes when known. */
  _safeRect() {
    const r = this.renderer;
    const scr = r.screen;
    const L = this._stage.lanes;
    const fr = r.frameBounds;
    if (!fr || !(fr.height > 0)) return null;
    const top = L.top ? L.top.y : Math.max(0, fr.y - Math.min(40, fr.y * 0.35));
    const bottom = L.bottom ? L.bottom.y + L.bottom.h : Math.min(scr.height, fr.y + fr.height + Math.min(40, (scr.height - fr.y - fr.height) * 0.35));
    return { x: 0, y: top, width: scr.width, height: Math.max(40, bottom - top) };
  }

  _overlayHeight(kind, lines) {
    return overlayHeight(this.fx, kind, lines);
  }

  _hook(name, ...args) {
    const h = this.hooks && this.hooks[name];
    if (typeof h !== 'function') return;
    try {
      h(...args);
    } catch (e) {
      console.error(`[director] hooks.${name} failed`, e);
    }
  }

  /** Manga impact frame + the controller's DOM flash hook (EAD-18). */
  _impact(o = {}) {
    const fx = this.fx;
    if (!fx || this._skipping) return;
    const ms = o.duration || 120;
    this._try(() => fx.impactFrame(o));
    // the DOM HUD flash is a flash too (settings.fx.flashes off → none, photosensitivity)
    if (this.epic && this.pref('flashes')) this._hook('impact', ms);
  }

  /** Mark the running cinematic as a "big" one: the controller fades the HUD until it ends. */
  _cine(cx) {
    if (!cx || cx.cine || this._skipping || !this.epic) return;
    cx.cine = true;
    this._cineDepth++;
    if (this._cineDepth === 1) this._hook('cinematic', true);
  }

  _cineEnd(cx) {
    if (!cx || !cx.cine) return;
    cx.cine = false;
    this._cineDepth = Math.max(0, this._cineDepth - 1);
    if (this._cineDepth === 0) this._hook('cinematic', false);
  }

  /** The side ('top' | 'bottom') a colour is drawn on. */
  _sideOf(color) {
    return color === this._bottomColor ? 'bottom' : 'top';
  }

  // =================================================================== settings
  /**
   * Personal settings (SETTINGS CONTRACT). Keeps the LIVE object (fields are read again at use
   * time), forwards it to fx.applySettings, re-syncs auras (fx.auras off → they go out now) and the
   * language. Idempotent and cheap: the controller calls it on every 'settings' event.
   */
  applySettings(settings) {
    if (settings && typeof settings === 'object') this.settings = settings;
    const st = this.settings || {};
    if (st.lang === 'ru' || st.lang === 'en') this.lang = st.lang;
    const fx = this.fx;
    if (fx && typeof fx.applySettings === 'function') this._try(() => fx.applySettings(st));
    if (fx && fx.setLang) this._try(() => fx.setLang(this.lang));
    this.syncAuras();
    return this;
  }

  /** One settings.fx field (validated; contract default when unset). */
  pref(key) {
    return fxPref(this.settings, key);
  }

  /** Readable hold (ms) of a text for the current settings.textTime; a few frames while skipping. */
  _read(text, kind) {
    if (this._skipping) return 120;
    return readMs(text, kind, this.settings);
  }

  /** The player's own name (settings.playerName, trimmed, ≤ 16 chars) or ''. */
  _playerName() {
    const n = this.settings && this.settings.playerName;
    if (typeof n !== 'string') return '';
    return Array.from(n.replace(/\s+/g, ' ').trim()).slice(0, 16).join('').trim();
  }

  /** Opponent's (AI) moves get compact cinematics (settings.opponentFx 'short')? */
  get _compactOpponent() {
    return !!(this.settings && this.settings.opponentFx === 'short');
  }

  setMode(mode) {
    this.mode = mode === 'epic' ? 'epic' : 'classic';
    if (this.fx && this.fx.setMode) this.fx.setMode(this.mode);
    if (this.mode === 'epic') this._preload();
    this.syncAuras();
  }

  /** Load the anime fonts / glyphs the Director uses once, so the first 覚醒 or 何?! never hitches. */
  _preload() {
    if (this._preloaded || !this.fx || typeof this.fx.preload !== 'function') return;
    this._preloaded = true;
    const texts = allKanji().concat(['ТВОЙ ХОД', 'ХОД СОПЕРНИКА', "OPPONENT'S TURN", 'ПРОБУЖДЕНИЕ', 'УРОВЕНЬ СИЛЫ: 0123456789+', 'КОМБО', 'ЯРОСТЬ 100%!', '学戦侍将神主白黒怒']);
    try {
      Promise.resolve(this.fx.preload(texts)).catch(() => {});
    } catch (e) {
      /* fonts are a nicety */
    }
  }

  setLang(lang) {
    this.lang = lang === 'en' ? 'en' : 'ru';
    if (this.fx && this.fx.setLang) this.fx.setLang(this.lang);
  }

  /** True while a cinematic (move / game start / game over) is playing. */
  get busy() {
    return this._depth > 0;
  }

  get epic() {
    return this.mode === 'epic' && !!this.fx;
  }

  get _lang() {
    const l = this.settings && this.settings.lang;
    return l === 'en' || l === 'ru' ? l : this.lang;
  }

  _s(key, n) {
    const t = (STR[this._lang] || STR.ru)[key] || STR.ru[key] || key;
    return n != null ? t.replace('{n}', String(n)) : t;
  }

  /** settings.animSpeed (0.5 / 0.75 = slower, 2 = faster). */
  get _speed() {
    return animSpeedOf(this.settings);
  }

  /** Game-time duration, scaled by animSpeed (and shortened while skipping). */
  _t(ms) {
    return Math.max(1, ms / this._speed / (this._skipping ? 2 : 1));
  }

  // =================================================================== skip / lifecycle
  /** Speed up the running cinematic: raise the clock scale, drop holds and overlays. */
  skip() {
    if (!this.busy || this._skipping) return;
    this._skipping = true;
    const fx = this.fx;
    if (fx) {
      this._try(() => fx.slowMo(1, 0, { inMs: 0, outMs: 0 }));
      this._try(() => fx.hideCombo());
    }
    for (const p of Array.from(this._tracked)) this._try(() => p.stop && p.stop());
    this._tracked.clear();
    for (const w of Array.from(this._waits)) this._try(() => w.cancel(true));
    this._waits.clear();
    this._clock.setScale(SKIP_SCALE, 0);
    this._try(() => this.renderer.camera.reset(160, Ease.outCubic, { realtime: true }));
  }

  _tick() {
    if (this._skipping && this._depth > 0 && this._clock.scale !== SKIP_SCALE) this._clock.setScale(SKIP_SCALE, 0);
    this._stage.tick();
  }

  _try(fn) {
    try {
      return fn();
    } catch (e) {
      console.error('[director]', e);
      return null;
    }
  }

  /** Track a long overlay so skip() can drop it. */
  _track(p) {
    if (!p || typeof p.stop !== 'function') return p;
    this._tracked.add(p);
    Promise.resolve(p).then(() => this._tracked.delete(p));
    return p;
  }

  async _run(name, fn) {
    const cx = { gen: this._gen, slow: false };
    this._depth++;
    try {
      await fn(cx);
    } catch (e) {
      if (e !== ABORT) console.error(`[director] ${name} failed`, e);
    } finally {
      if (cx.slow && this.fx && cx.gen === this._gen) this._try(() => this.fx.slowMo(1, 0, { inMs: 140, outMs: 0 }));
      if (cx.finally) this._try(() => cx.finally(cx.gen === this._gen));
      this._cineEnd(cx);
      this._depth = Math.max(0, this._depth - 1);
      if (this._depth === 0 && this._skipping) {
        this._skipping = false;
        this._clock.setScale(1, 0);
      }
    }
  }

  _check(cx) {
    if (cx.gen !== this._gen) throw ABORT;
  }

  /** Cancellable wait (game time unless real). Instant while skipping. */
  async _wait(cx, ms, real = false) {
    this._check(cx);
    if (this._skipping || ms <= 1) return;
    const p = wait(ms, { clock: this._clock, realtime: real });
    this._waits.add(p);
    try {
      await p;
    } finally {
      this._waits.delete(p);
    }
    this._check(cx);
  }

  async _await(cx, p) {
    const r = await p;
    this._check(cx);
    return r;
  }

  // =================================================================== feedback channels
  _sfx(name, opts) {
    if (this._skipping) return;
    const a = this.audio;
    if (!a || typeof a.play !== 'function') return;
    try {
      a.play(name, opts);
    } catch (e) {
      /* audio is optional */
    }
  }

  /** Vibration for an event: settings.haptics 'off' = none, 'light' = every pulse halved. */
  _haptic(name) {
    if (this._skipping) return;
    const level = hapticsOf(this.settings);
    if (level === 'off') return;
    const n = this.native;
    if (!n || typeof n.vibrate !== 'function') return;
    let p = HAPTIC[name];
    if (!p) return;
    if (!this.epic) p = p.slice(0, 3).map((v, i) => (i % 2 ? v : Math.max(8, Math.round(v * 0.45))));
    p = hapticScale(p, level);
    if (!p) return;
    try {
      n.vibrate(p);
    } catch (e) {
      /* ignore */
    }
  }

  /** TTS announcer (epic only, settings.announcer): short low-pitched English hype lines. */
  _announce(text, { force = false } = {}) {
    if (!this.epic || this._skipping || !this.settings || !this.settings.announcer) return;
    const n = this.native;
    if (!n || typeof n.speak !== 'function') return;
    const now = this._clock.realNow;
    if (!force && now - this._lastSpeak < 1300) return;
    this._lastSpeak = now;
    try {
      n.speak(text, { lang: 'en-US', pitch: 0.55, rate: 0.92 });
    } catch (e) {
      /* ignore */
    }
  }

  _duck(amount, ms) {
    if (this._skipping || !this.audio || typeof this.audio.duck !== 'function') return;
    this._try(() => this.audio.duck(amount, ms));
  }

  // =================================================================== geometry helpers
  _C(sq) {
    return this.renderer.squareCenter(sq);
  }

  /** Energy colour of a side (renderer.sideColor: the player's chosen colour) or classic gold. */
  _sideColor(color) {
    return this.epic ? epicSideColor(this.renderer, color === -1 ? -1 : 1) : CLASSIC.gold;
  }

  /** Epic colour of a side regardless of the mode (VS screen, banners). */
  _epicColor(color) {
    return epicSideColor(this.renderer, color === -1 ? -1 : 1);
  }

  /** Combo counter colour: the mover's energy colour, heating up to gold on big combos. */
  _comboColor(m, hits) {
    const c = m.col;
    if (hits <= 2) return c;
    if (hits === 3) return mixHex(c, 0xffffff, 0.3);
    if (hits === 4) return mixHex(c, EPIC.gold, 0.55);
    if (hits <= 6) return EPIC.gold;
    return mixHex(EPIC.gold, 0xff2edb, 0.45);
  }

  /** Camera punch (settings.fx.camera). */
  _punch(z, ms) {
    if (this._skipping || !this.pref('camera')) return;
    this._try(() => this.renderer.camera.punch(z, ms));
  }

  /** Sky lightning on the backdrop (a flash: settings.fx.flashes). */
  _sky() {
    if (!this.pref('flashes')) return;
    this._try(() => this.renderer.lightning());
  }

  /** Which side is drawn at the bottom of the screen. */
  get _bottomColor() {
    return this.renderer.flipped ? -1 : 1;
  }

  _zoom(k = 1) {
    const sq = this.renderer.squareSize || 40;
    return clamp(58 / sq, 1.12, 1.6) * k;
  }

  /** World-space kanji size that keeps `word` within ~80% of the screen width at the current zoom. */
  _kanjiSize(word, base) {
    const r = this.renderer;
    const cam = r.camera;
    const z = Math.max(0.5, cam.zoom * Math.max(1.1, cam.punchScale));
    const len = Math.max(1, Array.from(word).length);
    const fit = (r.screen.width * 0.74) / (len * 0.9) / z;
    return Math.min(base, fit);
  }

  /**
   * Camera focus 70% of the way from the board centre to p (keeps the board readable).
   * opts.rotation: a dutch angle (radians, epic only; cam.reset() levels it again, EAD-19).
   */
  _focus(p, zoom, ms, opts = {}) {
    const r = this.renderer;
    if (this._skipping || !this.pref('camera')) return Promise.resolve(false);
    const c = r.boardCenter;
    const k = opts.k != null ? opts.k : 0.7;
    const o = { realtime: !!opts.realtime };
    if (opts.rotation != null && this.epic) o.rotation = opts.rotation;
    return r.camera.focus(c.x + (p.x - c.x) * k, c.y + (p.y - c.y) * k, zoom, ms, opts.ease || Ease.outCubic, o);
  }

  /** Hops of a move: { from, to, cap, code, A, B, V, ang, dist, f } (cap = captured square or -1). */
  _hops(move, size) {
    const r = this.renderer;
    const path = move.path || [move.from, move.to];
    const caps = move.captures || [];
    const codes = move.captured || [];
    const used = caps.map(() => false);
    const hops = [];
    for (let i = 1; i < path.length; i++) {
      const from = path[i - 1];
      const to = path[i];
      const ra = Math.floor(from / size);
      const ca = from % size;
      const rb = Math.floor(to / size);
      const cb = to % size;
      const dr = rb - ra;
      const dc = cb - ca;
      let cap = -1;
      let code = 0;
      if (caps.length && (dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc))) {
        const steps = Math.max(Math.abs(dr), Math.abs(dc));
        for (let k = 1; k < steps && cap < 0; k++) {
          const s = (ra + sign(dr) * k) * size + (ca + sign(dc) * k);
          for (let j = 0; j < caps.length; j++) {
            if (!used[j] && caps[j] === s) {
              cap = s;
              code = codes[j] || 0;
              used[j] = true;
              break;
            }
          }
        }
      }
      if (cap < 0 && caps.length === path.length - 1 && !used[i - 1]) {
        cap = caps[i - 1];
        code = codes[i - 1] || 0;
        used[i - 1] = true;
      }
      const A = r.squareCenter(from);
      const B = r.squareCenter(to);
      const V = cap >= 0 ? r.squareCenter(cap) : null;
      const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
      const f = V ? clamp(Math.hypot(V.x - A.x, V.y - A.y) / len, 0.15, 0.9) : 1;
      hops.push({ i: i - 1, from, to, cap, code, A, B, V, ang: Math.atan2(B.y - A.y, B.x - A.x), dist: Math.max(Math.abs(dr), Math.abs(dc)), f });
    }
    const extra = [];
    caps.forEach((s, j) => {
      if (!used[j]) extra.push(s);
    });
    return { hops, extra };
  }

  // =================================================================== auras / sync
  /** Keep the permanent flame auras in sync with the kings on the board (epic only). */
  syncAuras() {
    const r = this.renderer;
    const fx = this.fx;
    if (!r || !fx || typeof fx.aura !== 'function') return;
    const want = new Set();
    if (this.mode === 'epic' && this.pref('auras')) {
      r.forEachPiece((v) => {
        if (v.isKing) want.add(v);
      });
    }
    const colorOf = (v) => mixHex(this._epicColor(v.color), EPIC.gold, 0.2);
    for (const [v, h] of Array.from(this._auras)) {
      const alive = v.auraLayer && v.auraLayer.children.some((c) => c.label === 'fx-aura' && !c.destroyed);
      if (!want.has(v) || !alive) {
        if (alive) this._try(() => h.stop());
        this._auras.delete(v);
      } else {
        // the player picked another energy colour: re-tint the running aura
        const col = colorOf(v);
        if (h._col !== col && typeof h.setColor === 'function') {
          this._try(() => h.setColor(col));
          h._col = col;
        }
      }
    }
    for (const v of want) {
      if (this._auras.has(v)) continue;
      const col = colorOf(v);
      const h = this._try(() => fx.aura(v, { color: col, intensity: 0.9 }));
      if (h) {
        h._col = col;
        this._auras.set(v, h);
      }
    }
  }

  /** Renderer pieces equal to `state` (codes + resting positions)? */
  _matches(state) {
    const r = this.renderer;
    if (!state || !state.board) return true;
    const n = state.size || Math.round(Math.sqrt(state.board.length));
    if (!r.variant || r.variant.size !== n) return false;
    for (let sq = 0; sq < n * n; sq++) {
      const code = state.board[sq];
      const v = r.pieceAt(sq);
      if (!code) {
        if (v) return false;
        continue;
      }
      if (!v || v.color !== sign(code) || !!v.isKing !== (Math.abs(code) === 2)) return false;
      const c = r.squareCenter(sq);
      if (Math.abs(v.x - c.x) > 0.5 || Math.abs(v.y - c.y) > 0.5) return false;
      if (!v.visible || v.alpha < 0.98 || Math.abs(v.scale.x - 1) > 0.02 || (v.lift > 0.002 && !v._moveTask)) return false;
    }
    return true;
  }

  /** Safety re-sync: renderer.setPosition(state) whenever anything differs from `state`. */
  _ensure(state) {
    if (!state || !state.board) return;
    if (!this._matches(state)) this.renderer.setPosition(state);
  }

  /**
   * The position was set outside playMove (new game, undo, re-sync): abort any running
   * cinematic's board writes, drop marks, re-sync pieces when they differ, refresh auras.
   */
  syncPosition(state) {
    this._gen++;
    this._stage.clear();
    this._kanjiLive = [];
    this._band = null;
    this._bigUntil = 0;
    this._turnSeq++;
    this._lastMove = null;
    this._longThink = false;
    this._thinkFrom = null;
    for (const w of Array.from(this._waits)) this._try(() => w.cancel(false));
    this._waits.clear();
    for (const p of Array.from(this._tracked)) this._try(() => p.stop && p.stop());
    this._tracked.clear();
    this._marks.clear();
    if (this._skipping) {
      this._skipping = false;
      this._clock.setScale(1, 0);
    }
    if (state) this._try(() => this._ensure(state));
    this.syncAuras();
  }

  /** Alias of syncPosition (older integration code). */
  reset(state) {
    this.syncPosition(state);
  }

  // =================================================================== playMove
  playMove({ move, before, after, mover, moverIsHuman = true, names = null, stats = null } = {}) {
    let hypeM = null;
    const run = this._run('playMove', async (cx) => {
      const r = this.renderer;
      if (!move || !move.path || move.path.length < 2) return;
      if (this.fx) this.fx.safeRect = this._safeRect();
      cx.finally = (alive) => {
        if (!alive) return;
        this._marks.clear();
        const fromV = r.pieceAt(move.path[move.path.length - 1]);
        if (fromV && fromV.lift > 0 && !fromV._moveTask) fromV.lift = 0;
        this._ensure(after);
        this.syncAuras();
        const cam = r.camera;
        if (!cam.idle && !this._camResetting) this._try(() => cam.reset(220, Ease.outCubic, { realtime: true }));
      };
      const size = (before && before.size) || (after && after.size) || (r.variant && r.variant.size) || 8;
      if (mover !== 1 && mover !== -1) mover = before && before.turn ? before.turn : sign(move.piece) || 1;
      const { hops, extra } = this._hops(move, size);
      const caps = hops.filter((h) => h.cap >= 0).length;
      const m = {
        move,
        before,
        after,
        mover,
        human: moverIsHuman !== false,
        names: names || {},
        stats: stats || null,
        hops,
        extra,
        n: caps + extra.length,
        promoAt: move.promotion ? (move.promotionAt > 0 && move.promotionAt < move.path.length ? move.promotionAt : move.path.length - 1) : -1,
        col: this._sideColor(mover),
        vcol: this._sideColor(-mover),
        kingVictims: (move.captured || []).filter((c) => Math.abs(c) === 2).length,
        behind: material(before, mover) + 1.5 <= material(before, -mover),
        ko: !!(after && after.board && countPieces(after, -mover) === 0 && (move.captures || []).length > 0),
      };
      m.ultimate = this.epic && m.n > 0 && !!(m.stats && m.stats.hype && m.stats.hype[mover] >= 1);
      m.speaker = (m.names[mover] && m.names[mover].name) || this._s(mover === 1 ? 'white' : 'black');
      m.bothHuman = !!(m.names[1] && m.names[-1] && m.names[1].isHuman && m.names[-1].isHuman);
      const oppHuman = !!(m.names[-mover] && m.names[-mover].isHuman);
      // the AI's cinematics are shorter when a human waits for them (MUX-19); with
      // settings.opponentFx 'short' they are compact (no cut-in, ≤ 1.4 s of motion)
      m.quick = !m.human && oppHuman;
      m.compact = m.quick && this._compactOpponent;
      m.tk = m.quick ? 0.8 : 1;
      m.named = m.human && !m.bothHuman && !!this._playerName();
      m.afterCapture = !!(this._lastMove && this._lastMove.n > 0 && this._lastMove.mover === -mover);
      // an AI move that took long to come: the next human turn is announced
      if (this._thinkFrom && this._thinkFrom.color === mover && !m.human) {
        this._longThink = this._clock.realNow - this._thinkFrom.at > 2600;
      }
      this._thinkFrom = null;
      for (const c of [1, -1]) {
        if (m.stats && m.stats.hype && !(m.stats.hype[c] >= 1)) this._rageShown[c] = false;
      }
      if (!r.pieceAt(move.path[0])) {
        // the board drifted (should not happen): show the result right away
        this._ensure(after);
        return;
      }
      this._streak[mover] = m.n ? this._streak[mover] + 1 : 0;
      this._sinceCaption[mover] = (this._sinceCaption[mover] || 0) + 1;
      if (this.epic) await (m.compact ? this._epicCompact(cx, m) : this._epicMove(cx, m));
      else await this._classicMove(cx, m);
      this._lastMove = { mover, n: m.n, at: this._clock.realNow, promo: m.promoAt >= 0 };
      if (cx.gen === this._gen) hypeM = m;
    });
    // the ЯРОСТЬ moment plays after the move (also after a skipped one), without blocking
    return run.then(() => {
      if (hypeM && this.epic) this._try(() => this._checkHype(hypeM));
    });
  }

  /** Predicted ЯРОСТЬ after this move (same rules as the controller's meter). */
  _hypeAfter(m) {
    const h = m.stats && m.stats.hype;
    if (!h) return null;
    const M = this.hypeModel || HYPE_MODEL;
    const out = { 1: +h[1] || 0, '-1': +h[-1] || 0 };
    const n = (m.move.captures || []).length;
    const c = m.mover;
    if (n) {
      if (out[c] >= 1) out[c] = 0;
      else out[c] = Math.min(1, out[c] + M.perCapture * n + M.comboBonus * (n - 1));
      out[-c] = Math.min(1, out[-c] + M.perLoss * n);
    }
    if (m.move.promotion && out[c] < 1) out[c] = Math.min(1, out[c] + M.promotion);
    return out;
  }

  /** The meter of a side just filled up: its on-board moment (EAD-20), without blocking the game. */
  _checkHype(m) {
    const before = m.stats && m.stats.hype;
    const after = this._hypeAfter(m);
    if (!before || !after) return;
    for (const c of [m.mover, -m.mover]) {
      if (!(before[c] >= 1) && after[c] >= 1 - 1e-9) this.playHypeReady(c);
    }
  }

  // =================================================================== CLASSIC
  async _classicMove(cx, m) {
    const r = this.renderer;
    const fx = this.fx;
    for (let i = 0; i < m.hops.length; i++) {
      const h = m.hops[i];
      const capture = h.cap >= 0;
      const long = Math.max(0, h.dist - (capture ? 2 : 1));
      const dur = this._t((capture ? 270 : 230) + Math.min(6, long) * 28);
      let fired = false;
      const take = () => {
        if (fired) return;
        fired = true;
        r.removePiece(h.cap, { duration: this._t(360) });
        if (fx) {
          fx.burst(h.V.x, h.V.y, { kind: 'stars', count: 7, color: CLASSIC.goldLight });
          fx.burst(h.V.x, h.V.y, { kind: 'dust', count: 4, size: 0.7 });
        }
        this._sfx('capture', { intensity: 0.75 + Math.min(0.5, i * 0.1), pitch: 1 + i * 0.06 });
        this._haptic('hit');
      };
      this._sfx('move', { intensity: 0.7, pitch: 1 + i * 0.03 });
      const p = r.movePiece(h.from, h.to, {
        duration: dur,
        arc: capture ? 0.42 : 0.2 + Math.min(0.2, long * 0.04),
        ease: Ease.inOutCubic,
        onUpdate: capture ? (e) => e >= h.f && take() : null,
      });
      await this._await(cx, p);
      if (capture) take();
      if (fx) fx.burst(h.B.x, h.B.y, { kind: 'dust', count: 5, size: 0.8 });
      this._sfx('land', { intensity: 0.55 });
      this._haptic('land');
      if (m.promoAt === i + 1) await this._classicPromote(cx, m, h.to, i + 1 < m.hops.length);
    }
    for (const s of m.extra) r.removePiece(s, { duration: this._t(300) });
    if (m.n >= 3 && fx) {
      // in a free lane when there is one: never over the a8/b8 corner squares (EAD-22); the
      // counter stays readable after the move (non-blocking)
      this._placeCombo(m);
      this._combo(m, m.n);
    }
    if (m.n >= 2) this._sfx('combo', { intensity: Math.min(1, m.n / 4) });
    await this._wait(cx, this._t(m.n ? 140 : 60));
  }

  async _classicPromote(cx, m, sq, mid) {
    const r = this.renderer;
    const fx = this.fx;
    const P = this._C(sq);
    const sz = r.squareSize;
    this._sfx('promote');
    this._haptic('promote');
    const crown = r.setPieceKing(sq, true, { animate: true });
    if (fx) {
      fx.burst(P.x, P.y, { kind: 'stars', count: 12, color: CLASSIC.goldLight });
      fx.shockwave(P.x, P.y, { radius: 1.3, strength: 0.6, duration: 600 });
      fx.pillar(P.x, P.y, { duration: this._t(mid ? 700 : 1000), width: 0.7 });
      // «Дамка!» stays readable (non-blocking: it may outlive the move)
      this._kanji(this._s('king'), P.x, P.y - sz * 0.85, {});
    }
    await this._wait(cx, this._t(mid ? 280 : 420));
    if (!mid) await this._await(cx, Promise.race([crown, wait(this._t(420), { clock: this._clock })]));
  }

  // =================================================================== text helpers
  /**
   * Kanji / onomatopoeia that stays readable (prefs.readMs, × textTime) at full size; it may
   * outlive the move. Older lettering that has been readable for ≥ 60 % of its time exits now;
   * younger lettering is kept clear of (the new glyph is nudged aside). o: fx.kanji options plus
   * hold (ms) and avoidCombo (keep clear of the combo counter).
   */
  _kanji(word, x, y, o = {}) {
    const fx = this.fx;
    if (!fx || this._skipping || !this.pref('kanji')) return null;
    const hold = o.hold != null ? o.hold : this._read(word, 'kanji');
    const now = this._clock.realNow;
    const live = this._kanjiLive.filter((k) => !k.done);
    this._kanjiLive = live;
    for (const k of live) if (!k.cut && now - k.born >= MIN_SHARE * k.read) (k.cut = true), shorten(k.p, 180);
    const self = { seq: ++this._kseq, born: now + (o.delay || 0), read: hold, p: null, rect: null, at: -1e9, done: false, cut: false };
    const avoidCombo = !!o.avoidCombo;
    const opts = { ...o, hold, avoid: () => this._avoidRects(self, avoidCombo) };
    delete opts.avoidCombo;
    const p = this._try(() => fx.kanji(word, x, y, opts));
    if (!p) return null;
    self.p = p;
    live.push(self);
    Promise.resolve(p).then(() => (self.done = true));
    this._track(p);
    return p;
  }

  /** Screen rects newer lettering keeps clear of: the combo counter + older live kanji. */
  _avoidRects(self, combo) {
    const out = self.rects || (self.rects = []);
    out.length = 0;
    if (combo) {
      const c = this._comboRect();
      if (c) out.push(c);
    }
    const now = this._clock.realNow;
    if (this._band && this._band.until > now) out.push(this._band.rect);
    for (const k of this._kanjiLive) {
      if (k.done || k.seq >= self.seq || !k.p) continue;
      if (now - k.at > 90) {
        k.rect = this._kanjiRect(k.p);
        k.at = now;
      }
      if (k.rect) out.push(k.rect);
    }
    return out;
  }

  _kanjiRect(p) {
    const e = p.effect || (p.inner && p.inner.effect);
    const root = e && e.root;
    if (!root || root.destroyed || !root.visible) return null;
    try {
      const b = root.getBounds();
      return b && b.width > 0 ? { x: b.x, y: b.y, width: b.width, height: b.height } : null;
    } catch (err) {
      return null;
    }
  }

  /** Wait (inside a cinematic) until the centre band slot is free: older bands / banners go once readable enough. */
  async _centerFree(cx, maxWait = 3200) {
    if (this._skipping) return;
    await this._await(cx, this._stage.whenFree('center', 'big', { maxWait }));
  }

  /** Register a centre band / banner (cut-in, «ПРОБУЖДЕНИЕ» …) with its readable time. */
  _claimCenter(p, read, duration) {
    if (!p) return p;
    this._stage.claim('center', 'big', p, null, read);
    this._bigUntil = Math.max(this._bigUntil, this._clock.realNow + (duration || read));
    return p;
  }

  // =================================================================== EPIC
  async _epicMove(cx, m) {
    if (!m.n) {
      await this._epicQuiet(cx, m);
    } else {
      if (m.ultimate) await this._epicUltimateIntro(cx, m);
      if (m.n === 1 && m.hops.length === 1) await this._epicSingle(cx, m);
      else await this._epicMulti(cx, m);
      if (m.ultimateBand) await this._ultimateBandEnd(cx, m);
    }
    const last = m.hops[m.hops.length - 1];
    if (m.promoAt === m.move.path.length - 1) await this._epicPromote(cx, m, last.to, { short: false });
    else if (!m.n) this._maybeCaption(m, 'quiet');
  }

  /** Quiet move (≈ 0.6 s): charge → dash with afterimages + speed lines → impact ring, dust, micro-shake. */
  async _epicQuiet(cx, m) {
    const r = this.renderer;
    const fx = this.fx;
    const h = m.hops[0];
    const view = r.pieceAt(h.from);
    const col = m.col;
    // anticipation: crouch + gather energy
    fx.charge(h.A.x, h.A.y, { color: col, duration: this._t(170), radius: 0.9 });
    if (view) this._squashTo(view, 0.12, this._t(120));
    await this._wait(cx, this._t(140));
    // dash
    this._sfx('dash', { intensity: 0.7, pan: this._pan(h.B.x) });
    this._haptic('move');
    if (view) fx.afterimages(view, { duration: this._t(320), color: col });
    this._track(fx.speedLines({ style: 'dash', angle: h.ang, duration: this._rt(400), density: 0.45 }));
    const long = Math.max(0, h.dist - 1);
    const dur = this._t(clamp(250 + long * 36, 250, 420));
    await this._await(
      cx,
      r.movePiece(h.from, h.to, {
        duration: dur,
        arc: 0.14 + Math.min(0.16, long * 0.03),
        ease: Ease.inOutQuart,
        onUpdate: (e) => {
          if (view) view.squash = -0.11 * Math.sin(Math.PI * e);
        },
      }),
    );
    // landing
    fx.shockwave(h.B.x, h.B.y, { strength: 0.32, radius: 1.15, duration: this._t(400), color: col });
    fx.burst(h.B.x, h.B.y, { kind: 'dust', count: 9 });
    fx.burst(h.B.x, h.B.y, { kind: 'spark', count: 7, color: col, speed: 0.6 });
    fx.shake(0.13, 200);
    this._sfx('land', { intensity: 0.8 });
    this._haptic('land');
    await this._wait(cx, this._t(170));
  }

  _rt(ms) {
    return this._t(ms);
  }

  _pan(x) {
    const w = this.renderer.screen.width || 1;
    return clamp((x / w) * 2 - 1, -0.8, 0.8);
  }

  _squashTo(view, v, ms) {
    return tween(view, { squash: v }, { duration: ms, ease: Ease.outQuad, clock: this._clock });
  }

  /** Single capture (≈ 2 s): lock-on → dash → STRIKE (hit-stop, impact frame, slash, cracks) → shatter. */
  async _epicSingle(cx, m) {
    const r = this.renderer;
    const fx = this.fx;
    const cam = r.camera;
    const h = m.hops[0];
    const view = r.pieceAt(h.from);
    const col = m.col;
    const zoom = this._zoom();
    const tk = m.tk || 1;
    // tilt toward the strike: a dutch angle on the lock-on, a little more on the hit (EAD-19)
    const tilt = (Math.cos(h.ang) >= 0 ? 1 : -1) * (Math.sin(h.ang) >= 0 ? 1 : -1);
    // 1) lock-on: punch toward the attacker, focus lines, energy gathering, eye-glint
    this._focus({ x: h.A.x * 0.65 + h.V.x * 0.35, y: h.A.y * 0.65 + h.V.y * 0.35 }, zoom * 1.06, this._t(360), { rotation: tilt * 0.05 });
    this._punch(1.04, 260);
    this._track(fx.focusLines({ focus: h.A, duration: this._rt(m.ultimate ? 380 : 620), density: 0.75 }));
    fx.charge(h.A.x, h.A.y, { color: col, duration: this._t(380), radius: 1.3 });
    fx.burst(h.A.x, h.A.y - r.squareSize * 0.12, { kind: 'stars', count: 2, color: 0xffffff, size: 1.6, life: 0.6 });
    if (view) this._squashTo(view, 0.14, this._t(260));
    this._sfx('charge', { intensity: 0.55, pitch: 1.2 });
    await this._wait(cx, this._t((m.ultimate ? 220 : 380) * tk));
    // 2) dash + strike
    if (m.ultimate) {
      fx.slowMo(0.3, this._rt(620 * tk), { inMs: 90, outMs: 300 });
      cx.slow = true;
    }
    this._sfx('whoosh', { intensity: 0.9, pan: this._pan(h.V.x) });
    if (view) fx.afterimages(view, { duration: this._t(420), color: col });
    this._track(fx.speedLines({ focus: h.V, duration: this._rt(520), density: 0.75 }));
    this._focus(h.V, zoom * (m.ultimate ? 0.98 : 1.12), this._t(360), { rotation: tilt * 0.07 });
    let corpse = null;
    const dist = Math.max(0, h.dist - 2);
    const p = r.movePiece(h.from, h.to, {
      duration: this._t(400 + Math.min(6, dist) * 34),
      arc: 0.55,
      ease: Ease.inOutCubic,
      onUpdate: (e) => {
        if (view) view.squash = -0.12 * Math.sin(Math.PI * e);
        if (!corpse && e >= h.f) corpse = this._strike(m, h, 0, { single: true });
      },
    });
    await this._await(cx, p);
    if (!corpse) corpse = this._strike(m, h, 0, { single: true });
    fx.burst(h.B.x, h.B.y, { kind: 'dust', count: 8 });
    this._sfx('land', { intensity: 0.7 });
    // 3) shatter (the hit-stop has passed by now: landing happens after it)
    if (corpse) this._detonate(m, corpse, { size: 1.15, big: m.ultimate });
    else this._boomAt(m, h.V, 1.15);
    for (const s of m.extra) r.removePiece(s, { duration: this._t(260) });
    if (m.ultimate) {
      // the strike's impact frame first, then a measured glow: ドン! must stay readable (EAD-04)
      const scr = r.screen;
      fx.zoomBlur(h.V.x, h.V.y, 0.15, this._rt(460));
      fx.bloomPulse(0.35, this._rt(660));
      fx.rays(h.V.x, h.V.y, { color: EPIC.gold, duration: this._t(1200), size: r.squareSize * 7 });
      this._track(godrays(fx, { duration: this._rt(1500), x: scr.width / 2 }));
      fx.flash(0xffffff, { duration: 200, alpha: 0.18 });
      fx.shake(0.95, 650);
      this._sfx('bigImpact', { intensity: 1 });
      this._sfx('boom', { intensity: 0.8 });
      this._haptic('ultimate');
    }
    if (m.ko) this._ko(m, h.V);
    this._maybeCaption(m, m.ultimate ? 'ultimate' : 'capture');
    await this._wait(cx, this._t((m.ultimate ? 700 : 620) * tk));
    this._camResetting = true;
    try {
      await this._await(cx, cam.reset(this._t(420), Ease.inOutCubic));
    } finally {
      this._camResetting = false;
    }
  }

  /** The hit: called when the attacker passes over the victim. Returns the marked stand-in. */
  _strike(m, h, i, { single = false, compact = false } = {}) {
    const r = this.renderer;
    const fx = this.fx;
    const V = h.V;
    const col = m.col;
    const sz = r.squareSize;
    const corpse = this._marks.mark(h.cap, { color: col, victimColor: m.vcol, angle: h.ang });
    if (!this._skipping) {
      if (!compact) fx.hitStop(Math.round((single ? (m.ultimate ? 170 : 130) : 85) / this._speed));
      if (!compact) this._punch(single ? 1.12 : 1.08, single ? 320 : 260);
      if (!compact && (single || i === 0)) this._impact({ focus: V, frames: single ? 3 : 2, duration: single ? 130 : 90 });
    }
    const flip = i % 2 === 1;
    fx.slash(V.x, V.y, h.ang + (flip ? 0.62 : -0.62), { color: col, flip, length: single ? 3.4 : 2.8 });
    fx.burst(V.x, V.y, { kind: 'spark', color: col, count: single ? 22 : 16, angle: h.ang, spread: 1.5, speed: 1.1 });
    fx.crack(V.x, V.y, { color: col, size: single ? 2.6 : 2.0 });
    if (!compact) fx.chromatic(single ? 1 : 0.6, this._rt(280));
    fx.shake(single ? 0.5 : 0.38, single ? 420 : 340, { angle: h.ang });
    if (!single) fx.shockwave(V.x, V.y, { strength: 0.7, radius: 2.0, color: col, duration: 480 });
    this._sfx('slash', { intensity: 0.9, pitch: 1 + i * 0.05, pan: this._pan(V.x) });
    this._sfx('impact', { intensity: single ? 1 : 0.75, pitch: 1 + i * 0.04 });
    if (!single) this._sfx('taiko', { intensity: 0.8, pitch: 1 + i * 0.06 });
    this._haptic(single ? 'capture' : 'hit');
    // one readable onomatopoeia per strike sequence: the single capture's, or the first hit of a
    // chain (the combo counter takes over from there; the finale has its own)
    if (!this._skipping && (single || i === 0)) {
      const word = single ? kanjiFor('capture', this._lang) : kanjiFor('hit');
      const side = m.comboOnBoard ? (m.comboSide === 'left' ? 1 : -1) : -1;
      const len = Array.from(word).length;
      this._kanji(word, V.x + (single ? 0 : side * sz * 0.55), V.y - sz * (single ? 0.95 : 0.75), {
        color: col,
        size: single ? this._kanjiSize(word, sz * (len > 3 ? 1.75 : 2.1)) : this._kanjiSize(word, sz * 1.3),
        delay: single ? 140 : 50,
        realtime: true,
        avoidCombo: !!m.comboOnBoard,
      });
    }
    return corpse;
  }

  /** Explosion at a marked stand-in (removes it). */
  _detonate(m, corpse, { size = 1.1, big = false } = {}) {
    const x = corpse.x;
    const y = corpse.y;
    corpse.explode();
    this._boomAt(m, { x, y }, size, corpse.angle, big);
  }

  _boomAt(m, p, size, angle = 0, big = false) {
    const fx = this.fx;
    fx.explosion(p.x, p.y, { color: mixHex(m.col, 0xffffff, 0.15), size });
    fx.burst(p.x, p.y, { kind: 'shards', color: m.vcol, angle, spread: 1.7, count: big ? 30 : 22, speed: 1.1 });
    fx.burst(p.x, p.y, { kind: 'energy', color: m.vcol, count: 10 });
    this._sfx('shatter', { intensity: 0.9, pan: this._pan(p.x) });
    this._sfx('explosion', { intensity: big ? 1 : 0.75 });
  }

  /** Multi-capture: slow-motion chain of strikes that MARK the victims, then the finale. */
  async _epicMulti(cx, m) {
    const r = this.renderer;
    const fx = this.fx;
    const hops = m.hops;
    const N = hops.length;
    const first = hops[0];
    const view = r.pieceAt(first.from);
    const col = m.col;
    const zoom = this._zoom();
    const corpses = [];
    const short = m.n <= 2 && !m.ultimate;
    // a double is short and punchy; the AI's combos run a little faster (MUX-19)
    const slow = m.ultimate ? (m.quick ? 0.45 : 0.34) : short ? 0.72 : m.quick ? 0.64 : N >= 6 ? 0.62 : 0.58;
    this._placeCombo(m);
    // anticipation (real time, before the slow-mo kicks in)
    this._focus(first.A, zoom * 0.95, this._t(260), { k: 0.58, rotation: (first.B.x < first.A.x ? 1 : -1) * 0.04 });
    fx.charge(first.A.x, first.A.y, { color: col, duration: this._t(300), radius: 1.4 });
    if (view) this._squashTo(view, 0.14, this._t(180));
    this._sfx('riser', { intensity: Math.min(1, 0.5 + N * 0.12) });
    this._track(fx.vignette(0x000000, { alpha: 0.5, duration: this._rt(1500 + N * 1000), fade: 240 }));
    await this._wait(cx, this._t((short ? 160 : 210) * (m.tk || 1)), true);
    if (!this._skipping) {
      cx.slowP = fx.slowMo(slow, 1200 + N * 1200, { inMs: 160, outMs: 280 });
      cx.slow = true;
    }
    // a hop never takes more than ~0.7 s of real time (long flying-king hops on 10×10 / 12×12),
    // and the waiting player never sits through more than ~1.6 s of hops (MUX-19)
    const hopCap = m.quick ? Math.min(650 * slow, ((m.ultimate ? 1200 : 1600) * slow) / N) : 700 * slow;
    let prevV = null;
    for (let i = 0; i < N; i++) {
      const h = hops[i];
      const capture = h.cap >= 0;
      const v = r.pieceAt(h.from);
      // alternate dutch angles per hop: fight-scene camera grammar (EAD-19)
      const tilt = (i % 2 ? 1 : -1) * 0.05;
      if (capture) this._focus(h.V, zoom * 0.98, this._t(260), { k: 0.58, rotation: tilt });
      else this._focus(h.B, zoom * 0.9, this._t(260), { k: 0.58, rotation: tilt });
      if (v) fx.afterimages(v, { duration: this._t(380), color: col });
      if (capture && !this._skipping) this._track(fx.speedLines({ focus: h.V, duration: 460, density: 0.6 }));
      this._sfx('whoosh', { intensity: 0.8, pitch: 1 + i * 0.05, pan: this._pan(h.B.x) });
      const shrink = i >= 3 ? Math.max(0.72, 1 - (i - 2) * 0.07) : 1;
      const long = Math.max(0, h.dist - 2);
      const base = (m.ultimate ? 270 : short ? 300 : 320) + Math.min(5, long) * 28;
      const dur = this._t(Math.min(hopCap, base * shrink * (m.quick ? 0.85 : 1)));
      let corpse = null;
      let struck = !capture;
      const p = r.movePiece(h.from, h.to, {
        duration: dur,
        arc: 0.66,
        ease: Ease.inOutCubic,
        onUpdate: (e) => {
          if (v) v.squash = -0.12 * Math.sin(Math.PI * e);
          if (!struck && e >= h.f) {
            struck = true;
            corpse = this._strikeMarked(m, h, corpses.length, prevV);
          }
        },
      });
      await this._await(cx, p);
      if (!struck) corpse = this._strikeMarked(m, h, corpses.length, prevV);
      if (corpse) corpses.push(corpse);
      if (capture) prevV = h.V;
      fx.burst(h.B.x, h.B.y, { kind: 'dust', count: 5 });
      this._sfx('land', { intensity: 0.5 });
      // a man crowned mid-capture keeps going as a king
      if (m.promoAt === i + 1 && i + 1 < N) await this._epicPromote(cx, m, h.to, { short: true });
      await this._wait(cx, this._t(40));
    }
    await this._epicFinale(cx, m, corpses);
  }

  /**
   * Where the combo counter goes (EAD-03): the free lane on the mover's OPPONENT side (the mover's
   * own lane is for its brag caption), else the board-frame corner away from the action. A lane
   * still showing a text that has not been readable long enough is not taken.
   */
  _placeCombo(m) {
    const r = this.renderer;
    const avgX = m.hops.reduce((s, h) => s + h.B.x, 0) / Math.max(1, m.hops.length);
    m.comboSide = avgX < r.boardCenter.x ? 'right' : 'left';
    const opp = this._sideOf(-m.mover);
    const own = this._sideOf(m.mover);
    let lane = null;
    for (const side of [opp, own]) {
      if (this._stage.lane(side) && this._stage.isFree(side, 'combo')) {
        lane = side;
        break;
      }
    }
    m.comboLane = lane;
    m.comboOnBoard = !lane;
  }

  /** Screen rect of the combo counter while it is up (kanji keep clear of it), else null. */
  _comboRect() {
    const C = this.fx && this.fx.combo;
    if (!C || C.dead || !C.root || C.root.destroyed) return null;
    // measured at most every ~90 ms (getBounds walks the subtree and allocates)
    const now = this._clock.realNow;
    const cache = this._comboR || (this._comboR = { C: null, at: -1e9, rect: null });
    if (cache.C === C && now - cache.at < 90) return cache.rect;
    cache.C = C;
    cache.at = now;
    try {
      const b = C.root.getBounds();
      cache.rect = b && b.width > 0 ? { x: b.x, y: b.y, width: b.width, height: b.height } : null;
    } catch (e) {
      cache.rect = null;
    }
    return cache.rect;
  }

  /** Show / bump the combo counter (in its lane when there is one); it stays readable after the last hit. */
  _combo(m, hits) {
    const fx = this.fx;
    if (!fx || !this.pref('combo')) return null;
    const label = this._lang === 'en' ? 'HIT COMBO!' : 'КОМБО';
    const read = this._read(`${label} ×${hits}`, 'combo');
    const o = { side: m.comboSide || 'left', hold: read, color: this.epic ? this._comboColor(m, hits) : undefined };
    if (m.comboLane) {
      const l = this._stage.lane(m.comboLane);
      const fr = this.renderer.frameBounds;
      const W = this.renderer.screen.width;
      o.side = 'left';
      o.at = { x: Math.max(12, Math.min(W * 0.2, fr.x + 8)), y: l.y + l.h / 2 };
      o.fit = l.h - 6;
    }
    const p = this._try(() => fx.comboCounter(hits, o));
    if (p && m.comboLane) {
      const C = fx.combo;
      if (!m.comboItem) m.comboItem = this._stage.claim(m.comboLane, 'combo', p, () => !!(C && !C.dead && fx.combo === C), read);
      else {
        // every hit restarts the readable time
        m.comboItem.born = this._clock.realNow;
        m.comboItem.read = read;
      }
    }
    return p;
  }

  /** A hit inside a multi-capture: strike, mark, chain lightning from the previous victim, combo. */
  _strikeMarked(m, h, k, prevV, compact = false) {
    const fx = this.fx;
    if (h.cap < 0) return null;
    const corpse = this._strike(m, h, k, { single: false, compact });
    const hits = k + 1;
    if (hits >= 2) {
      this._combo(m, hits);
      this._sfx('combo', { intensity: Math.min(1, 0.4 + hits * 0.15), pitch: 1 + hits * 0.05 });
      this._haptic('combo');
      if (prevV) {
        fx.lightning(prevV.x, prevV.y, h.V.x, h.V.y, { color: mixHex(m.col, 0xffffff, 0.25), branches: 2, duration: 440 });
        this._sfx('zap', { intensity: 0.6 });
      }
    }
    return corpse;
  }

  /**
   * The finale of a multi-capture, scaled with the combo (EAD-16):
   *   ×2   short and punchy: double slash through both marked victims, they burst one after the
   *        other, 連斬 — no cut-in (the first double of the game gets the cut-in once);
   *   ×3   cut-in with the attack name, then one of three rotating beats: «НАНИ?!», a silent
   *        back-turned beat, or a one-frame screen-wide cut;
   *   ×4+ / ULTIMATE   the full treatment, the only tier with a white-out flash.
   * READABLE: the cut-in band (placed away from the doomed pieces) holds the attack name for its
   * readable time while the punchline plays beside it — impact frame → the victims detonate one
   * by one → the finale kanji (which may outlive the move). The camera returns once the band is
   * gone. With settings.fx.cutins off the attack name becomes a speech bubble instead.
   */
  async _epicFinale(cx, m, corpses) {
    const r = this.renderer;
    const fx = this.fx;
    const cam = r.camera;
    const last = m.hops[m.hops.length - 1];
    const view = r.pieceAt(last.to);
    const col = m.col;
    const sz = r.squareSize;
    const scr = r.screen;
    const N = Math.max(corpses.length, m.n);
    const tk = m.tk || 1;
    const T = (ms) => this._t(ms * tk);
    let tier = m.ultimate || N >= 4 ? 'full' : N >= 3 ? 'cut' : 'short';
    let tpl = 'cutin';
    if (tier === 'short' && N === 2 && this._doubles === 0 && !m.quick) tier = 'cut'; // the first double: the full show once
    else if (tier === 'cut') {
      tpl = TRIPLE_TEMPLATES[this._tripleTpl % TRIPLE_TEMPLATES.length];
      this._tripleTpl++;
    }
    if (N === 2) this._doubles++;
    // the AI keeps the player waiting less: no 何?! beat, and its ULTIMATE already had its 必殺
    if (m.quick && tpl === 'cutin' && tier !== 'full') tpl = 'turned';
    const bandWanted = tier !== 'short' && !(m.quick && m.ultimate) && !m.ultimateBand;
    const withCutIn = bandWanted && this.pref('cutins');
    // back to normal speed for the punchline (real-time beats)
    if (cx.slow) {
      if (cx.slowP && cx.slowP.stop) cx.slowP.stop();
      fx.slowMo(1, 0, { inMs: 240, outMs: 0 });
    }
    cx.slow = false;
    for (const c of corpses) c.setUnstable(true);
    const bc = r.boardCenter;
    const L = this._C(last.to);
    const cxs = corpses.length ? corpses.reduce((s, c) => s + c.x, 0) / corpses.length : L.x;
    const cys = corpses.length ? corpses.reduce((s, c) => s + c.y, 0) / corpses.length : L.y;
    // 1) pose: the camera pulls back with a dutch tilt toward the attacker
    const dutch = (L.x < bc.x ? -1 : 1) * (tier === 'short' ? 0.05 : 0.09);
    if (!this._skipping && this.pref('camera')) cam.focus(bc.x + (L.x - bc.x) * 0.15, bc.y + (L.y - bc.y) * 0.15, 0.96, T(420), Ease.outCubic, { realtime: true, rotation: dutch });
    if (view) {
      tween(view, { lift: 0.22 }, { duration: this._t(280), ease: Ease.outBack, clock: this._clock, realtime: true });
      fx.burst(L.x, L.y, { kind: 'energy', color: col, inward: true, count: 16 });
    }
    if (tier === 'short') {
      await this._finaleShort(cx, m, corpses, { cxs, cys, view, T });
      return;
    }
    if (withCutIn) this._cine(cx);
    if (view && !this._skipping) this._track(fx.menacing(L.x, L.y, { count: 4, duration: T(1700), realtime: true }));
    if (m.ultimate) fx.pillar(L.x, L.y, { color: col, duration: T(1700), width: 1.0 });
    this._sfx('menacing', { intensity: 0.8 });
    this._sfx('heartbeat', { intensity: 0.8 });
    this._sky();
    // 2) the attack name: a cut-in band (readable hold), or a speech bubble with cut-ins off
    const name = m.attackName || attackName({ n: N, side: m.mover, king: !!(view && view.isKing), ultimate: m.ultimate }, this._lang);
    m.attackName = name;
    const bottom = m.mover === this._bottomColor;
    let bandEnd = 0;
    if (withCutIn && !this._skipping) {
      await this._centerFree(cx);
      // keep the band away from the doomed pieces (they must stay visible for the punchline)
      const bandY = this._bandY(cys, m);
      // on the board (no lane) the counter would sit under the band: the band takes over
      if (m.comboOnBoard) this._try(() => fx.hideCombo());
      const hold = this._read(name, 'cutin');
      const dur = 480 + hold + 230;
      const p = this._track(fx.cutIn({ title: name, side: bottom ? 'left' : 'right', pieceColor: m.mover, color: col, king: !!(view && view.isKing), hold, y: bandY, dim: 0.28 }));
      this._claimCenter(p, hold, dur);
      bandEnd = this._clock.realNow + dur;
      this._setBand(bandY, bandEnd);
      this._sfx('swell', { intensity: 0.9 });
    } else if (bandWanted) {
      this._attackCaption(m, name);
    }
    this._announce(COMBO_CALL[N] || (N > 5 ? 'UNSTOPPABLE!' : 'COMBO!'), { force: true });
    await this._wait(cx, withCutIn ? T(640) : T(300), true);
    // 3) the beat before the punchline
    if (tpl === 'cutin') {
      let nani = null;
      if (!this._skipping) {
        // «НАНИ?!» over the doomed, pushed away from a combo counter sitting on the board
        const off = m.comboOnBoard ? (m.comboSide === 'left' ? 1 : -1) * sz * 1.2 : 0;
        nani = this._kanji(kanjiFor('nani'), cxs + off, cys - sz * 0.6, { color: m.vcol, size: sz * 1.35, exit: 'fade', backdrop: 'burst', realtime: true, avoidCombo: !!m.comboOnBoard });
      }
      this._sfx('glitch', { intensity: 0.7 });
      this._duck(0.75, 600);
      // 何?! is readable for a moment before the chain goes off (it then exits for the punchline)
      await this._wait(cx, nani ? 230 + MIN_SHARE * this._read(kanjiFor('nani'), 'kanji') : T(300), true);
    } else if (tpl === 'turned') {
      // the attacker has already turned away: a beat of silence, then the chain goes off
      this._duck(0.85, 640);
      this._sfx('heartbeat', { intensity: 1 });
      await this._wait(cx, T(520), true);
    } else if (tpl === 'slash') {
      // one-frame cut: a single screen-wide slash through all the doomed pieces
      const a = corpses[0] || { x: cxs - sz, y: cys };
      const b = corpses[corpses.length - 1] || { x: cxs + sz, y: cys };
      const ang = Math.hypot(b.x - a.x, b.y - a.y) > 1 ? Math.atan2(b.y - a.y, b.x - a.x) : -0.5;
      const span = (Math.hypot(r.boardBounds.width, r.boardBounds.height) / sz) * 1.1;
      fx.slash(cxs, cys, ang, { color: mixHex(col, 0xffffff, 0.55), length: span, width: 1.3, duration: 320 });
      this._sfx('slash', { intensity: 1 });
      this._duck(0.6, 360);
      await this._wait(cx, T(260), true);
    }
    // 4) the chain lights up…
    for (let k = 0; k + 1 < corpses.length; k++) {
      const a = corpses[k];
      const b = corpses[k + 1];
      fx.lightning(a.x, a.y, b.x, b.y, { color: mixHex(col, 0xffffff, 0.35), duration: 340, width: 1.3, branches: 2, sky: k === 0 });
    }
    this._sfx('thunder', { intensity: 0.8 });
    await this._wait(cx, T(100), true);
    // 5) the climax: impact frame alone → readable hold → chain reaction (EAD-04)
    this._impact({ screenFocus: r.worldToScreen(cxs, cys), frames: 2, duration: 100 });
    this._sfx('bigImpact', { intensity: 1 });
    this._haptic(m.ultimate ? 'ultimate' : 'bigImpact');
    await this._wait(cx, this._t(130), true);
    for (const s of m.extra) r.removePiece(s, { duration: this._t(220) });
    const full = tier === 'full';
    if (!this._skipping) {
      fx.chromatic(0.6, this._rt(380));
      fx.bloomPulse(full ? 0.45 : 0.28, this._rt(640));
      if (full) {
        fx.zoomBlur(cxs, cys, 0.1, this._rt(320));
        // the white-out belongs to ×4+ and the ULTIMATE alone (EAD-16)
        fx.flash(0xffffff, { duration: 240, alpha: 0.2, attack: 0.08 });
      }
    }
    // staggered bursts overlap: keep each fireball modest so the board stays readable
    const size = corpses.length <= 2 ? 1.0 : corpses.length <= 4 ? 0.84 : 0.72;
    await this._chainDetonate(cx, m, corpses, { gap: tpl === 'slash' ? 50 : full ? 70 : 80, size });
    fx.crack(cxs, cys, { color: col, size: 3.4 });
    fx.shake(0.95, 700);
    if (m.ultimate) this._track(godrays(fx, { duration: this._rt(1600), x: scr.width / 2 }));
    this._sfx('boom', { intensity: 1 });
    // 6) the finale kanji, 60 ms after the last detonation; it may outlive the move
    if (!this._skipping) {
      const word = kanjiFor('finale');
      const ksz = Math.min(sz * 2.4, (scr.width * 0.78) / Math.max(1, Array.from(word).length * 0.92));
      this._kanji(word, cxs, cys - sz * 0.3, { color: col, size: ksz, delay: 60, realtime: true, avoidCombo: !!m.comboOnBoard });
    }
    if (m.ko) this._ko(m, { x: cxs, y: cys });
    // the brag bubble only once the band is gone (one sentence to read at a time)
    if (!bandEnd) this._maybeCaption(m, 'combo');
    if (view) tween(view, { lift: 0 }, { duration: this._t(220), ease: Ease.inQuad, clock: this._clock, realtime: true });
    // 7) back to the board once the band has been read
    await this._wait(cx, Math.max(T(420), bandEnd - this._clock.realNow), true);
    if (bandEnd) this._maybeCaption(m, 'combo');
    this._camResetting = true;
    try {
      await this._await(cx, cam.reset(T(380), Ease.inOutCubic, { realtime: true }));
    } finally {
      this._camResetting = false;
    }
  }

  /**
   * Screen y of a cut-in band that must leave the world point y (the doomed pieces / the strike)
   * visible: the other half of the board, decided in BOARD space (the camera is mid-move when
   * this is asked), and clear of a lane that shows the combo counter.
   */
  _bandY(worldY, m) {
    const r = this.renderer;
    const scr = r.screen;
    const fr = r.frameBounds;
    const W = scr.width;
    const bc = r.boardCenter;
    // half the band's on-screen height (band + its tilt across the screen width)
    const half = (Math.max(120, Math.min(220, W * 0.4)) + W * 0.17) / 2;
    const upper = worldY < bc.y;
    let y = upper ? Math.min(fr.y + fr.height * 0.9, scr.height * 0.74) : Math.max(fr.y + fr.height * 0.1, scr.height * 0.24);
    // never over a lane (captions / the combo counter / turn banners live there)
    const top = this._stage.lane('top');
    const bot = this._stage.lane('bottom');
    if (!upper && top) y = Math.max(y, top.y + top.h + half);
    if (upper && bot) y = Math.min(y, bot.y - half);
    return Math.max(half * 0.6, Math.min(scr.height - half * 0.6, y));
  }

  /** A cut-in band is on screen at bandY until `until`: newer lettering keeps clear of it. */
  _setBand(bandY, until) {
    const W = this.renderer.screen.width;
    const half = (Math.max(120, Math.min(220, W * 0.4)) + W * 0.17) / 2;
    this._band = { rect: { x: 0, y: bandY - half, width: W, height: half * 2 }, until };
  }

  /** The attack name as a speech bubble (settings.fx.cutins off), if brags are allowed. */
  _attackCaption(m, name) {
    if (this._skipping || this.pref('brags') === 'off' || !name) return;
    m.saidName = true;
    this._lastCaption = this._clock.realNow;
    this._say(m.mover, name, { speaker: m.speaker, color: m.col, maxWait: 1800 });
  }

  /** ×2 finale (≈ 1.3 s): double slash through both victims → impact → two quick bursts → 連斬. */
  async _finaleShort(cx, m, corpses, { cxs, cys, view, T }) {
    const r = this.renderer;
    const fx = this.fx;
    const cam = r.camera;
    const sz = r.squareSize;
    const col = m.col;
    this._sfx('menacing', { intensity: 0.5 });
    await this._wait(cx, T(160), true);
    const a = corpses[0] || { x: cxs - sz, y: cys };
    const b = corpses[corpses.length - 1] || { x: cxs + sz, y: cys };
    const ang = Math.hypot(b.x - a.x, b.y - a.y) > 1 ? Math.atan2(b.y - a.y, b.x - a.x) : -0.5;
    const len = Math.hypot(b.x - a.x, b.y - a.y) / sz + 2.4;
    fx.slash(cxs, cys, ang + 0.2, { color: col, length: len, width: 1.1, duration: 420 });
    this._sfx('slash', { intensity: 1 });
    wait(this._t(90), { clock: this._clock, realtime: true }).then(() => {
      if (this._skipping) return;
      fx.slash(cxs, cys, ang - 0.2, { color: mixHex(col, 0xffffff, 0.5), length: len, width: 0.9, flip: true, duration: 420 });
      this._sfx('slash', { intensity: 0.8, pitch: 1.15 });
    });
    this._announce(COMBO_CALL[2], { force: true });
    await this._wait(cx, T(160), true);
    this._impact({ screenFocus: r.worldToScreen(cxs, cys), frames: 2, duration: 90 });
    this._sfx('bigImpact', { intensity: 0.75 });
    this._haptic('combo');
    await this._wait(cx, this._t(120), true);
    for (const s of m.extra) r.removePiece(s, { duration: this._t(220) });
    if (!this._skipping) {
      fx.chromatic(0.5, this._rt(320));
      fx.bloomPulse(0.3, this._rt(480));
    }
    await this._chainDetonate(cx, m, corpses, { gap: 80, size: 1.1 });
    fx.crack(cxs, cys, { color: col, size: 2.6 });
    fx.shake(0.6, 480);
    this._sfx('boom', { intensity: 0.7 });
    if (!this._skipping) {
      const word = kanjiFor('combo');
      this._kanji(word, cxs, cys - sz * 0.35, { color: col, size: this._kanjiSize(word, sz * 1.9), delay: 60, realtime: true, exit: 'slice', avoidCombo: !!m.comboOnBoard });
    }
    if (m.ko) this._ko(m, { x: cxs, y: cys });
    this._maybeCaption(m, 'combo');
    if (view) tween(view, { lift: 0 }, { duration: this._t(200), ease: Ease.inQuad, clock: this._clock, realtime: true });
    await this._wait(cx, T(420), true);
    this._camResetting = true;
    try {
      await this._await(cx, cam.reset(T(360), Ease.inOutCubic, { realtime: true }));
    } finally {
      this._camResetting = false;
    }
  }

  /** Detonate the marked victims one by one along the chain, each with its own small shake. */
  async _chainDetonate(cx, m, corpses, { gap = 70, size = 1 } = {}) {
    const fx = this.fx;
    const low = fx.quality === 'low';
    for (let k = 0; k < corpses.length; k++) {
      const c = corpses[k];
      if (low && k > 0) {
        const x = c.x;
        const y = c.y;
        c.explode();
        fx.burst(x, y, { kind: 'shards', color: m.vcol, count: 14 });
      } else this._detonate(m, c, { size, big: k === corpses.length - 1 });
      fx.shake(0.28 + 0.06 * Math.min(4, k), 240);
      if (k + 1 < corpses.length) await this._wait(cx, this._t(gap), true);
    }
  }

  /**
   * ULTIMATE intro: power-up pillar, 必殺 slams on screen (impact frame, then the flash), and the
   * cut-in band with «Тайная техника: …» and a gold «УЛЬТА · ЯРОСТЬ 100%» tag. The band holds the
   * name for its readable time WHILE the strike plays out in the other half of the board
   * (_ultimateBandEnd waits for it at the end). The AI's version skips the band (MUX-19); with
   * cut-ins off the name becomes a speech bubble.
   */
  async _epicUltimateIntro(cx, m) {
    const r = this.renderer;
    const fx = this.fx;
    const scr = r.screen;
    const h = m.hops[0];
    const view = r.pieceAt(h.from);
    const col = m.col;
    const tk = m.tk || 1;
    await this._centerFree(cx);
    this._cine(cx);
    this._announce('ULTIMATE!', { force: true });
    this._sfx('power', { intensity: 1 });
    this._sfx('riser', { intensity: 1 });
    this._haptic('ultimate');
    this._track(fx.vignette(0x000000, { alpha: 0.72, duration: this._rt((m.quick ? 1600 : 2600) * tk), fade: 240 }));
    this._focus(h.A, this._zoom(1.18), this._t(420 * tk), { realtime: true, rotation: -0.1 });
    fx.charge(h.A.x, h.A.y, { color: col, duration: this._t(700 * tk), radius: 2.4 });
    fx.pillar(h.A.x, h.A.y, { color: col, duration: this._t(1500 * tk), width: 1.0 });
    if (!this._skipping) this._track(fx.menacing(h.A.x, h.A.y, { count: 3, duration: this._t(1500 * tk) }));
    if (view) tween(view, { lift: 0.25 }, { duration: this._t(340), ease: Ease.outBack, clock: this._clock, realtime: true });
    fx.shake(0.3, 600);
    this._sky();
    await this._wait(cx, this._t(m.quick ? 240 : 420), true);
    // where the band will go (away from the victims) — 必殺 takes the other half meanwhile
    const victims = m.hops.filter((hp) => hp.V);
    const wy = victims.length ? victims.reduce((a, hp) => a + hp.V.y, 0) / victims.length : h.B.y;
    const bandY = this._bandY(wy, m);
    const frb = r.frameBounds;
    const kanjiY = bandY < scr.height / 2 ? Math.min(scr.height * 0.66, frb.y + frb.height * 0.68) : scr.height * 0.3;
    // 必殺 (readable)
    const big = Math.min(scr.width * 0.38, 210);
    if (!this._skipping) {
      this._impact({ frames: 2, duration: 100 });
      this._kanji(kanjiFor('ultimate'), scr.width / 2, kanjiY, { screen: true, size: big, color: EPIC.gold, backdrop: 'rays', exit: 'slice', realtime: true, delay: 60, clamp: false });
      fx.flash(0xffffff, { duration: 200, alpha: 0.5 }); // lands right after the impact frame (FX gate)
    }
    fx.shake(0.6, 450);
    this._sfx('gong', { intensity: 1 });
    this._sfx('bigImpact', { intensity: 0.6 });
    await this._wait(cx, this._t(m.quick ? 200 : 320), true);
    const name = attackName({ n: m.n, side: m.mover, king: !!(view && view.isKing), ultimate: true }, this._lang);
    m.attackName = name;
    const bottom = m.mover === this._bottomColor;
    if (!m.quick) {
      if (!this._skipping && this.pref('cutins')) {
        // the band goes to the half of the board away from the strike, and stays there, readable
        const hold = this._read(name, 'ultimate');
        const dur = 480 + hold + 230;
        const p = this._track(
          fx.cutIn({
            title: name,
            tag: this._s('ultimate'),
            side: bottom ? 'left' : 'right',
            pieceColor: m.mover,
            color: col,
            king: !!(view && view.isKing),
            hold,
            y: bandY,
            dim: 0.24,
          }),
        );
        this._claimCenter(p, hold, dur);
        m.ultimateBand = { end: this._clock.realNow + dur };
        this._setBand(bandY, m.ultimateBand.end);
        this._sfx('swell', { intensity: 1 });
        // the name is in and read for a moment before the strike starts beside it
        await this._wait(cx, 480 + Math.min(hold * 0.2, 700), true);
      } else {
        this._attackCaption(m, name);
        await this._wait(cx, this._t(260), true);
      }
    } else {
      await this._wait(cx, this._t(140), true);
    }
    if (view) await this._await(cx, tween(view, { lift: 0 }, { duration: this._t(130), ease: Ease.inQuad, clock: this._clock, realtime: true }));
  }

  /** The ULTIMATE's band has been readable for its full time: wait for it before handing back. */
  async _ultimateBandEnd(cx, m) {
    const left = m.ultimateBand.end - this._clock.realNow;
    m.ultimateBand = null;
    if (left > 0) await this._wait(cx, left, true);
  }

  /** «ПРОБУЖДЕНИЕ» (≈ 2.8 s): pillar of light, gold spiral, giant 覚醒, crown forms, aura ignites. */
  async _epicPromote(cx, m, sq, { short = false } = {}) {
    const r = this.renderer;
    const fx = this.fx;
    const cam = r.camera;
    const P = this._C(sq);
    const sz = r.squareSize;
    const scr = r.screen;
    const gold = EPIC.gold;
    const tk = (m && m.tk) || 1;
    if (!short) this._focus(P, this._zoom(1.06), this._t(380), { realtime: true });
    fx.charge(P.x, P.y, { color: gold, duration: this._t(short ? 260 : 460), radius: 1.6 });
    this._sfx('charge', { intensity: 0.8 });
    await this._wait(cx, this._t((short ? 220 : 440) * tk), true);
    fx.pillar(P.x, P.y, { color: gold, duration: this._t(short ? 1050 : 1500), spiral: true, godrays: !short });
    fx.flash(gold, { duration: 260, alpha: 0.45 });
    fx.shockwave(P.x, P.y, { color: gold, strength: 0.9, radius: 2.6 });
    fx.shake(0.42, 480);
    fx.burst(P.x, P.y, { kind: 'energy', color: gold, inward: true, count: 24 });
    this._sfx('power', { intensity: 0.9 });
    this._sfx('promote', { intensity: 1 });
    this._haptic('promote');
    this._announce('AWAKENING!');
    if (!this._skipping) {
      // put 覚醒 on the side of the piece that has room (the crown must stay visible)
      const ps = r.worldToScreen(P.x, P.y);
      const kz = this._kanjiSize('覚醒', sz * (short ? 1.8 : 2.2));
      const zoomNow = cam.zoom * cam.punchScale;
      const off = kz * 0.66 + sz * 0.5;
      // room above means room below the opponent's HUD panel, not just below the screen edge (EAD-08)
      const safe = this._safeRect() || { y: 0 };
      const roomAbove = ps.y - (off + kz * 0.66) * zoomNow > safe.y + 4;
      const ky = roomAbove ? P.y - off : P.y + off;
      this._kanji(kanjiFor('promote'), P.x, ky, { color: gold, size: kz, exit: 'fade', backdrop: 'rays', delay: 60, realtime: true });
      if (!short) {
        // «ПРОБУЖДЕНИЕ» goes into the mover's lane as a gold slash banner: readable, and it may
        // outlive the move without covering the board (the Stage keeps the lane tidy); the
        // brag line is a speech bubble
        const mover = m ? m.mover : r.pieceAt(sq) ? r.pieceAt(sq).color : 1;
        this._banner(mover, this._s('awakening'), { tint: gold, kind: 'promo', maxWait: 3000 });
        if (m) this._maybeCaption(m, 'promote');
      }
    }
    // the crown forms as the light column thins out
    await this._wait(cx, this._t((short ? 300 : 640) * tk), true);
    r.setPieceKing(sq, true, { animate: true });
    fx.burst(P.x, P.y, { kind: 'spark', color: gold, count: 22, speed: 1.1 });
    fx.shockwave(P.x, P.y, { color: 0xffffff, strength: 0.5, radius: 1.4, duration: 420 });
    this._sfx('sparkle', { intensity: 0.9 });
    await this._wait(cx, this._t((short ? 300 : 640) * tk), true);
    this.syncAuras();
    if (!short) {
      this._camResetting = true;
      try {
        await this._await(cx, cam.reset(this._t(460), Ease.inOutCubic, { realtime: true }));
      } finally {
        this._camResetting = false;
      }
    }
  }

  /** Last enemy piece down. */
  _ko(m, p) {
    const sz = this.renderer.squareSize;
    this._announce('K.O.!', { force: true });
    this._kanji(kanjiFor('ko'), p.x, p.y + sz * 0.9, { color: EPIC.gold, size: sz * 1.9, delay: 260, exit: 'slice', realtime: true });
  }

  // =================================================================== compact (opponentFx 'short')
  /**
   * The opponent's (AI) move with settings.opponentFx 'short': ≤ 1.4 s of motion, no cut-in, no
   * slow-mo, no camera work — dash, strikes, a quick chain detonation, one readable onomatopoeia
   * (non-blocking) and the crown on a promotion.
   */
  async _epicCompact(cx, m) {
    const r = this.renderer;
    const fx = this.fx;
    if (!m.n) {
      await this._epicQuiet(cx, m);
      if (m.promoAt === m.move.path.length - 1) await this._compactPromote(cx, m, m.hops[m.hops.length - 1].to);
      return;
    }
    const sz = r.squareSize;
    if (m.ultimate && !this._skipping) {
      const h0 = m.hops[0];
      fx.pillar(h0.A.x, h0.A.y, { color: m.col, duration: 700, width: 0.9, godrays: false });
      this._kanji(kanjiFor('ultimate'), h0.A.x, h0.A.y - sz * 1.1, { color: EPIC.gold, size: this._kanjiSize('必殺', sz * 1.8), realtime: true, exit: 'fade' });
      this._sfx('power', { intensity: 0.8 });
      this._haptic('ultimate');
    }
    this._placeCombo(m);
    const N = m.hops.length;
    const budget = 900; // ms of hops at animSpeed 1
    const corpses = [];
    let prevV = null;
    for (let i = 0; i < N; i++) {
      const h = m.hops[i];
      const capture = h.cap >= 0;
      const v = r.pieceAt(h.from);
      if (v) fx.afterimages(v, { duration: this._t(260), color: m.col });
      this._sfx('whoosh', { intensity: 0.7, pitch: 1 + i * 0.05, pan: this._pan(h.B.x) });
      const long = Math.max(0, h.dist - 2);
      const dur = this._t(Math.min(budget / N, 300 + Math.min(5, long) * 22));
      let corpse = null;
      let struck = !capture;
      const single = m.n === 1 && N === 1;
      await this._await(
        cx,
        r.movePiece(h.from, h.to, {
          duration: dur,
          arc: 0.5,
          ease: Ease.inOutCubic,
          onUpdate: (e) => {
            if (!struck && e >= h.f) {
              struck = true;
              corpse = single ? this._strike(m, h, 0, { single: true, compact: true }) : this._strikeMarked(m, h, corpses.length, prevV, true);
            }
          },
        }),
      );
      if (!struck) corpse = single ? this._strike(m, h, 0, { single: true, compact: true }) : this._strikeMarked(m, h, corpses.length, prevV, true);
      if (corpse) corpses.push(corpse);
      if (capture) prevV = h.V;
      fx.burst(h.B.x, h.B.y, { kind: 'dust', count: 5 });
      this._sfx('land', { intensity: 0.5 });
      if (m.promoAt === i + 1 && i + 1 < N) r.setPieceKing(h.to, true, { animate: true });
    }
    for (const s of m.extra) r.removePiece(s, { duration: this._t(200) });
    await this._chainDetonate(cx, m, corpses, { gap: 50, size: corpses.length > 2 ? 0.8 : 1 });
    if (corpses.length > 1) {
      const cxs = corpses.reduce((s, c) => s + c.x, 0) / corpses.length;
      const cys = corpses.reduce((s, c) => s + c.y, 0) / corpses.length;
      fx.shake(0.6, 420);
      this._sfx('boom', { intensity: 0.8 });
      if (m.ko) this._ko(m, { x: cxs, y: cys });
    } else if (m.ko && m.hops[0].V) this._ko(m, m.hops[0].V);
    this._maybeCaption(m, m.n > 1 ? 'combo' : 'capture');
    await this._wait(cx, this._t(220));
    if (m.promoAt === m.move.path.length - 1) await this._compactPromote(cx, m, m.hops[m.hops.length - 1].to);
  }

  /** Compact crowning: a short light column, the crown, 覚醒 (non-blocking). */
  async _compactPromote(cx, m, sq) {
    const fx = this.fx;
    const r = this.renderer;
    const P = this._C(sq);
    fx.pillar(P.x, P.y, { color: EPIC.gold, duration: 700, width: 0.8, godrays: false });
    this._sfx('promote', { intensity: 0.9 });
    this._haptic('promote');
    this._kanji(kanjiFor('promote'), P.x, P.y - r.squareSize * 1.2, { color: EPIC.gold, size: this._kanjiSize('覚醒', r.squareSize * 1.6), exit: 'fade', realtime: true });
    r.setPieceKing(sq, true, { animate: true });
    await this._wait(cx, this._t(260));
    this.syncAuras();
  }

  /**
   * Brag / taunt caption (EAD-21): a speech bubble in the speaker's lane, paced by
   * settings.fx.brags ('off' none · 'rare' · 'normal' · 'often'): a chance per event, a minimum
   * number of moves between two captions of a side, a cooldown and a cap per 30 s. Never two on
   * screen at once (the Stage queues them behind banners); capture streaks of 3+ get their own
   * lines and a 連撃, and the AI sometimes answers a capture with a quiet-move taunt. The player's
   * own name (settings.playerName) shows up in the lines that use it.
   */
  _maybeCaption(m, kind) {
    if (!this.epic || this._skipping) return;
    if (m.saidName && kind !== 'ultimate') return; // the attack name was the bubble of this move
    const rate = bragRate(this.settings);
    if (rate.level === 'off') return;
    const now = this._clock.realNow;
    if (now - this._lastCaption < rate.cooldown) return;
    this._captionTimes = this._captionTimes.filter((t) => now - t < 30000);
    if (this._captionTimes.length >= rate.per30 && kind !== 'ultimate') return;
    const mover = m.mover;
    const since = this._sinceCaption[mover] || 0;
    const boaster = m.human || m.bothHuman;
    const streak = this._streak[mover] || 0;
    let event = null;
    let chance = 0;
    let gap = 0;
    let n = m.n;
    if (kind === 'combo') {
      event = 'combo';
      chance = boaster ? 1 : 0.85;
    } else if (kind === 'ultimate') {
      event = 'ultimate';
      chance = 1;
    } else if (kind === 'promote') {
      event = 'promote';
      chance = boaster ? 0.85 : 0.5;
    } else if (kind === 'capture') {
      if (streak >= 3 && Math.random() < 0.6) {
        event = 'streak';
        n = streak;
      } else event = m.kingVictims ? 'kingslayer' : boaster ? (m.behind ? 'comeback' : 'capture') : Math.random() < 0.6 ? 'taunt' : 'capture';
      chance = boaster ? 0.8 : 0.65;
      gap = 1;
    } else if (kind === 'quiet') {
      // the AI answers the player's capture now and then
      if (!boaster && m.afterCapture) {
        event = Math.random() < 0.5 ? 'taunt' : m.behind ? 'comeback' : 'taunt';
        chance = 0.3;
        gap = 1;
      } else {
        event = boaster ? 'brag' : 'taunt';
        chance = boaster ? 0.05 : 0.08;
        gap = 5;
      }
    }
    if (!event) return;
    chance = Math.min(1, chance * rate.chance);
    gap = rate.level === 'often' ? Math.max(0, gap - 1) : rate.level === 'rare' ? gap + rate.gap : gap;
    if (since < gap || Math.random() > chance) return;
    const opp = m.names[-mover] && m.names[-mover].name;
    const named = !!m.named;
    const text = bragLine(event, { n, name: named ? this._playerName() : m.speaker, named, opp, side: mover }, this._lang);
    this._lastCaption = now;
    this._captionTimes.push(now);
    this._sinceCaption[mover] = 0;
    this._say(mover, text, { speaker: m.speaker, color: m.col, streak: event === 'streak' });
  }

  /**
   * Queue a speech bubble for `color` in its lane; it stays readable (prefs.readMs × textTime)
   * and is dropped only if it cannot show within maxWait. kind: readability kind ('caption' or
   * 'gameover').
   */
  _say(color, text, { speaker, color: col, maxWait = 2600, streak = false, kind = 'caption' } = {}) {
    const fx = this.fx;
    if (!fx) return Promise.resolve(null);
    const side = this._sideOf(color);
    const lines = text.length > 22 ? 2 : 1;
    const h = this._overlayHeight('caption', lines);
    const tint = col != null ? col : this._sideColor(color);
    const read = this._read(text, kind);
    const duration = 290 + read + 220;
    // no lane: the bubble sits at the board edge, where a cut-in band may be — wait for it
    const now = this._clock.realNow;
    const behind = !this._stage.lane(side) && this._band && this._band.until > now ? this._band.until - now : 0;
    const ask = () => this._stage.request(side, 'caption', {
      h,
      maxWait,
      duration,
      read,
      make: (pl) => {
        if (this._skipping) return null;
        const c = caption(fx, { text, speaker, color: tint, side, duration, epic: true, y: pl.y, maxH: pl.maxH, compact: !pl.lane });
        this._track(c);
        if (streak && pl.y != null) {
          // 連撃 flashes next to the bubble (screen space, inside the lane)
          const W = this.renderer.screen.width;
          this._track(fx.kanji(kanjiFor('combo'), W * 0.86, pl.y, { screen: true, size: Math.min(pl.maxH * 0.8, 60), color: EPIC.gold, hold: this._read('連撃', 'kanji'), realtime: true, exit: 'fade', backdrop: 'burst', clamp: false, delay: 220 }));
        }
        return c;
      },
    });
    return behind > 0 ? wait(behind, { clock: this._clock, realtime: true }).then(ask) : ask();
  }

  /** Queue a slash banner for `color`'s side (readable). Resolves with the overlay (null = not shown). */
  _banner(color, text, { tint, kind = 'banner', maxWait = 2500, delay = 0, turnSeq = 0 } = {}) {
    const fx = this.fx;
    if (!fx) return Promise.resolve(null);
    const side = this._sideOf(color);
    const read = this._read(text, kind);
    const duration = 350 + read + 200;
    const start = () =>
      this._stage.request(side, kind === 'hype' || kind === 'promo' ? 'hype' : 'banner', {
        h: this._overlayHeight('banner'),
        maxWait,
        duration,
        read,
        make: (pl) => {
          // a turn banner that waited past its turn (a newer turn / game began) is stale
          if (!this.epic || (turnSeq && turnSeq !== this._turnSeq)) return null;
          const b = turnBanner(fx, { text, color: tint != null ? tint : this._epicColor(color), side, duration, y: pl.y, maxH: pl.maxH });
          this._turnFx = b;
          return b;
        },
      });
    if (delay > 0) return wait(delay, { clock: this._clock, realtime: true }).then(start);
    return start();
  }

  // =================================================================== game start
  playGameStart({ variant, players, epic, bottomColor } = {}) {
    return this._run('playGameStart', async (cx) => {
      const r = this.renderer;
      const fx = this.fx;
      this._streak = { 1: 0, '-1': 0 };
      this._sinceCaption = { 1: 99, '-1': 99 };
      this._lastCaption = -1e9;
      this._captionTimes = [];
      this._rageShown = { 1: false, '-1': false };
      this._lastMove = null;
      this._longThink = false;
      this._thinkFrom = null;
      this._firstTurn = true;
      this._turnsShown = 0;
      this._doubles = 0;
      this._tripleTpl = 0;
      this._bigUntil = 0;
      const views = [];
      r.forEachPiece((v, sq) => views.push({ v, sq }));
      cx.finally = (alive) => {
        if (!alive) return;
        for (const { v } of views) {
          if (v.destroyed || !v.parent) continue;
          this._clock.cancelTweensOf(v);
          v.alpha = 1;
          v.lift = 0;
          v.squash = 0;
        }
        this.syncAuras();
      };
      // pieces wait off-stage
      for (const { v } of views) v.alpha = 0;
      if (!this.epic) {
        this._sfx('start');
        await this._dropPieces(cx, views, { epic: false });
        return;
      }
      const scr = r.screen;
      const P = players || {};
      const bottom = bottomColor === -1 || bottomColor === 1 ? bottomColor : this._bottomColor;
      // settings.fx.vsIntro off: a quick start (the pieces drop in, no VS screen, no banner)
      if (!this.pref('vsIntro')) {
        this._sfx('start', { intensity: 0.8 });
        this._haptic('start');
        await this._dropPieces(cx, views, { epic: true, quick: true });
        return;
      }
      this._cine(cx);
      this._sfx('start', { intensity: 1 });
      this._sfx('riser', { intensity: 0.8 });
      this._haptic('start');
      let clashResolve;
      const clash = new Promise((res) => (clashResolve = res));
      const { top, bottom: bot } = this._fighters(P, bottom);
      // names, titles and power levels stay readable (prefs.readMs, kind 'vs' × textTime)
      const holdMs = this._skipping ? 300 : versusHold(fx, top, bot);
      const vs = versus(fx, {
        top,
        bottom: bot,
        label: this._s('power'),
        holdMs,
        onClash: () => {
          clashResolve();
          if (this._skipping) return;
          const fb = r.frameBounds;
          const ky = fb.height > 0 ? Math.max(scr.height * 0.36, Math.min(scr.height * 0.64, fb.y + fb.height / 2)) : scr.height / 2;
          // 対決 sits on the split while the names are read (screen space, readable)
          this._kanji(kanjiFor('start'), scr.width / 2, ky, { screen: true, color: EPIC.gold, size: Math.min(150, scr.width * 0.36), hold: Math.max(this._read('対決', 'kanji'), holdMs - 900), realtime: true, exit: 'shatter' });
          fx.flash(0xffffff, { duration: 200, alpha: 0.65 });
          fx.shake(0.5, 420);
          this._sfx('gong', { intensity: 1 });
          this._sfx('taiko', { intensity: 1 });
          this._sfx('bigImpact', { intensity: 0.5 });
          this._haptic('capture');
          this._sky();
        },
      });
      this._track(vs);
      this._claimCenter(vs, holdMs, holdMs + 300);
      await this._await(cx, Promise.race([clash, wait(400, { clock: this._clock, realtime: true })]));
      this._announce('FIGHT!', { force: true });
      await this._await(cx, Promise.race([vs, wait(holdMs + 600, { clock: this._clock, realtime: true })]));
      // the HUD comes back while the pieces drop; «ДА НАЧНЁТСЯ БИТВА!» stays readable meanwhile
      // (it may outlive the intro: the first turn banner waits for it)
      this._cineEnd(cx);
      if (!this._skipping) {
        const title = this._s('fight');
        const hold = this._read(title, 'title');
        const p = this._track(fx.banner(title, { style: 'epic', color: EPIC.gold, y: scr.height * 0.5, hold }));
        this._claimCenter(p, hold, 460 + hold + 280);
      }
      this._sfx('swell', { intensity: 0.8 });
      await this._dropPieces(cx, views, { epic: true });
      await this._wait(cx, this._t(160), true);
    });
  }

  /**
   * The two VS fighters { top, bottom }: name, sub-line, energy colour, portrait glyph, power level.
   * The player is introduced by their own name (settings.playerName), else an earned title, else
   * «ИГРОК» — never «ТЫ / ВЫ» (EAD-06).
   */
  _fighters(players, bottom) {
    const P = players || {};
    const pvp = !!(P[1] && P[-1] && P[1].isHuman !== false && P[-1].isHuman !== false);
    const myName = this._playerName();
    const fighter = (c) => {
      const p = P[c] || {};
      const human = p.isHuman !== false;
      const colorName = this._s(c === 1 ? 'white' : 'black');
      let name = p.name || colorName;
      let sub = p.title || colorName;
      let glyph = p.glyph || null;
      if (human && !pvp) {
        const earned = p.title && p.title.toLowerCase() !== colorName.toLowerCase() ? p.title : null;
        name = myName || earned || this._s('player');
        sub = myName && earned ? earned : colorName;
        glyph = glyph || '主';
      } else if (human) {
        glyph = glyph || (c === 1 ? '白' : '黒');
      } else {
        glyph = glyph || LEVEL_GLYPH[p.level] || (p.kanji ? Array.from(p.kanji)[0] : '侍');
      }
      return {
        name: name.toUpperCase(),
        sub: sub.toUpperCase(),
        color: this._epicColor(c),
        side: c,
        king: !human && (p.level || 0) >= 4,
        glyph,
        power: human ? 9001 : p.power || 1000 * (p.level || 3),
        powerSuffix: human ? '+' : '',
      };
    };
    const b = bottom === -1 ? -1 : 1;
    return { top: fighter(-b), bottom: fighter(b) };
  }

  /** Pieces drop onto the board, back rank first (both sides together). */
  async _dropPieces(cx, views, { epic, quick = false }) {
    const r = this.renderer;
    const fx = this.fx;
    const n = r.layout ? r.layout.n : 8;
    if (quick) {
      // quick fade-in (settings.fx.vsIntro off)
      const jobs = views.map(({ v }) => {
        v.lift = 0;
        v.alpha = 0;
        return tween(v, { alpha: 1 }, { duration: this._t(280), ease: Ease.outCubic, clock: this._clock });
      });
      await this._await(cx, Promise.all(jobs));
      return;
    }
    // rank distance from the owner's edge (screen space): back rank first
    const ranks = new Map();
    for (const it of views) {
      const d = r.sqToDisplay(it.sq);
      const fromEdge = d.row < n / 2 ? d.row : n - 1 - d.row;
      it.edge = fromEdge;
      ranks.set(fromEdge, true);
    }
    const order = [...ranks.keys()].sort((a, b) => a - b);
    const stagger = epic ? 95 : 60;
    const dur = epic ? 260 : 340;
    const jobs = [];
    const rowsLanded = new Set();
    for (const it of views) {
      const { v } = it;
      const rank = order.indexOf(it.edge);
      const delay = this._t(rank * stagger + (epic ? Math.random() * 30 : 0));
      v.lift = epic ? 2.8 : 0.7;
      v.alpha = 0;
      const t = tween(v, { lift: 0, alpha: 1 }, { duration: this._t(dur), delay, ease: epic ? Ease.inQuad : Ease.outCubic, clock: this._clock });
      jobs.push(
        t.then((ok) => {
          if (!ok || v.destroyed || !v.parent) return;
          const c = r.squareCenter(v.sq);
          if (epic) {
            animate(240, (e, k) => (v.squash = 0.2 * Math.exp(-k * 4) * Math.cos(k * Math.PI * 2.2)), { clock: this._clock }).then(() => (v.squash = 0));
            if (fx) fx.burst(c.x, c.y, { kind: 'dust', count: 3, size: 0.8 });
            if (!rowsLanded.has(rank)) {
              rowsLanded.add(rank);
              if (fx) fx.shake(0.16 + 0.04 * (order.length - rank), 220);
              this._sfx('taiko', { intensity: 0.9, pitch: 0.9 + rank * 0.08 });
              this._haptic('land');
            }
          } else if (!rowsLanded.has(rank)) {
            rowsLanded.add(rank);
            this._sfx('land', { intensity: 0.4, pitch: 1 + rank * 0.05 });
          }
        }),
      );
    }
    await this._await(cx, Promise.all(jobs));
    if (epic && fx) {
      const c = r.boardCenter;
      fx.shockwave(c.x, c.y, { strength: 0.6, radius: 5, duration: 520 });
    }
  }

  // =================================================================== turn
  /**
   * Whose turn it is. The edge glow flares on every turn; the slash banner only when it tells the
   * player something (EAD-17): the first turn of the game, the turn after a capture, the player's
   * turn after a long AI think, or a mandatory capture (opts.mustCapture). It lives in the lane of
   * the side to move and never covers a caption / the combo counter (EAD-01/02).
   * Resolves ~650 ms after the banner appeared (at once when there is none).
   */
  playTurn({ color, isHuman, players, mustCapture = false } = {}) {
    const r = this.renderer;
    const seq = ++this._turnSeq;
    if (color === 1 || color === -1) this._try(() => r.setTurnGlow(color, { flare: true }));
    if (!isHuman && (color === 1 || color === -1)) this._thinkFrom = { color, at: this._clock.realNow };
    if (!this.epic || this.busy || (color !== 1 && color !== -1)) return Promise.resolve(true);
    const P = players || {};
    const pvp = !!(P[1] && P[-1] && P[1].isHuman === P[-1].isHuman);
    const lm = this._lastMove;
    const afterCapture = !!(lm && lm.n > 0);
    const must = !!(isHuman && mustCapture);
    const informative = this._firstTurn || afterCapture || (isHuman && this._longThink) || must;
    const first = this._firstTurn;
    this._firstTurn = false;
    if (isHuman) this._longThink = false;
    this._sfx('turn', { intensity: isHuman ? (informative ? 0.8 : 0.45) : informative ? 0.5 : 0.3 });
    if (isHuman) this._haptic('turn');
    // settings.fx.turnBanners off: the edge glow and the HUD chip tell whose turn it is
    if (!informative || !this.pref('turnBanners')) return Promise.resolve(true);
    let text = pvp ? this._s(color === 1 ? 'whiteTurn' : 'blackTurn') : isHuman ? this._s('yourTurn') : this._s('oppTurn');
    if (must) text = this._s('mustCapture');
    this._turnsShown++;
    // the first banner waits for «ДА НАЧНЁТСЯ БИТВА!» / a cut-in still on screen to be read
    const delay = Math.max(0, this._bigUntil - this._clock.realNow);
    return this._banner(color, text, { delay, maxWait: first ? 4000 : 2600, tint: must ? EPIC.capture : undefined, turnSeq: seq }).then((b) => {
      if (!b) return true;
      return wait(Math.max(250, 650 / this._speed), { clock: this._clock, realtime: true }).then(() => true);
    });
  }

  /**
   * «ЯРОСТЬ 100%» — the side's hype meter just filled up (EAD-20): a gold banner in its lane, 怒
   * over its pieces, their auras flare, 'power' + announcer. Idempotent while the meter stays
   * full (playMove calls it itself when it sees the meter cross 1; a second call from the
   * controller is ignored). Never blocks: resolves when the moment is over.
   */
  playHypeReady(color) {
    if (color !== 1 && color !== -1) return Promise.resolve(false);
    if (this._rageShown[color]) return Promise.resolve(false);
    this._rageShown[color] = true;
    if (!this.epic) return Promise.resolve(false);
    const r = this.renderer;
    const fx = this.fx;
    const gold = EPIC.gold;
    const views = [];
    r.forEachPiece((v) => {
      if (v.color === color) views.push(v);
    });
    this._sfx('power', { intensity: 0.9 });
    this._haptic('promote');
    this._announce('ULTIMATE READY!');
    // the pieces of that side flare up in red-gold for a moment (auras: settings.fx.auras)
    const flares = [];
    const flareCol = mixHex(gold, this._epicColor(color), 0.3);
    for (const v of views) {
      if (v.isKing) continue;
      if (this.pref('auras')) {
        const h = this._try(() => fx.aura(v, { color: flareCol, intensity: 0.7 }));
        if (h) flares.push(h);
      } else this._try(() => fx.burst(v.x, v.y, { kind: 'embers', count: 4, color: flareCol }));
    }
    const stopFlares = () => {
      for (const h of flares) this._try(() => h.stop());
      this.syncAuras();
    };
    wait(this._t(750), { clock: this._clock, realtime: true }).then(stopFlares);
    if (views.length && !this._skipping) {
      const cx = views.reduce((s, v) => s + v.x, 0) / views.length;
      const cy = views.reduce((s, v) => s + v.y, 0) / views.length;
      const sz = r.squareSize;
      this._kanji('怒', cx, cy, { color: gold, size: this._kanjiSize('怒', sz * 2), realtime: true, backdrop: 'rays', exit: 'fade' });
    }
    return this._banner(color, this._s('rage'), { tint: gold, kind: 'hype', maxWait: 3000 }).then((b) => (b ? b.overlay : false));
  }

  // =================================================================== game over
  playGameOver({ result, humanColor = 0, stats = null, players = null } = {}) {
    return this._run('playGameOver', async (cx) => {
      const winner = result ? result.winner : 0;
      const hero = humanColor === 1 || humanColor === -1 ? humanColor : winner || 0;
      const outcome = !winner ? 'draw' : humanColor === 1 || humanColor === -1 ? (winner === humanColor ? 'win' : 'loss') : 'win';
      if (this._turnFx && this._turnFx.stop) this._try(() => this._turnFx.stop());
      if (this.fx) this._try(() => this.fx.hideCombo());
      this._stage.clear();
      if (!this.epic) {
        await this._classicGameOver(cx, { winner, humanColor, outcome, result });
        return;
      }
      this._cine(cx);
      if (outcome === 'win') await this._epicVictory(cx, { winner, humanColor, stats, players, result });
      else if (outcome === 'loss') await this._epicDefeat(cx, { winner, hero, stats, players, result });
      else await this._epicDraw(cx, { stats, players });
    });
  }

  _statsLine(stats, color) {
    if (!stats) return '';
    const g = (o) => (o ? o[color] || 0 : 0);
    const parts = [];
    const combo = g(stats.maxCombo);
    if (combo >= 2) parts.push(this._s('maxCombo', combo));
    const caps = g(stats.captures);
    if (caps) parts.push(this._s('captures', caps));
    const kings = g(stats.kingsMade);
    if (kings) parts.push(this._s('kings', kings));
    const lost = stats.piecesLost ? g(stats.piecesLost) : stats.captures ? stats.captures[-color] || 0 : 0;
    if (lost || parts.length) parts.push(this._s('lost', lost));
    return parts.join(' · ');
  }

  /** Title of a win: «ТВОЯ ПОБЕДА!» / «{ИМЯ} ПОБЕЖДАЕТ!» (settings.playerName) / colour wins. */
  _victoryTitle(winner, humanColor, flawless) {
    const mine = (humanColor === 1 || humanColor === -1) && winner === humanColor;
    const name = mine ? this._playerName() : '';
    if (flawless) return name ? this._s('flawlessNamed').replace('{name}', name.toUpperCase()) : this._s('flawless');
    if (humanColor === 1 || humanColor === -1) {
      return name ? this._s('victoryNamed').replace('{name}', name.toUpperCase()) : this._s('victory');
    }
    return this._s(winner === 1 ? 'whiteWins' : 'blackWins');
  }

  async _epicVictory(cx, { winner, humanColor, stats, players, result }) {
    const r = this.renderer;
    const fx = this.fx;
    const scr = r.screen;
    const W = scr.width;
    const H = scr.height;
    const lost = stats ? (stats.piecesLost ? stats.piecesLost[winner] || 0 : stats.captures ? stats.captures[-winner] || 0 : 1) : 1;
    const flawless = !!stats && lost === 0;
    const human = humanColor === winner;
    const gold = EPIC.gold;
    const col = this._epicColor(winner);
    const title = this._victoryTitle(winner, humanColor, flawless);
    // everything stays up for the title's readable time (≥ 3 s × textTime)
    const hold = this._read(title, 'gameover');
    const total = 380 + 460 + hold + 280;
    this._sfx('win', { intensity: 1 });
    this._sfx('gong', { intensity: 0.8 });
    this._haptic('win');
    this._announce(flawless ? 'PERFECT!' : human ? 'YOU WIN!' : winner === 1 ? 'WHITE WINS!' : 'BLACK WINS!', { force: true });
    fx.flash(gold, { duration: 320, alpha: 0.35 });
    fx.bloomPulse(0.7, this._rt(1100));
    // a flawless win is its own moment (EAD-12): 完璧, bigger rays, two slashes across it
    const ky = H * 0.3;
    this._track(fx.rays(W / 2, H * 0.32, { screen: true, color: gold, duration: total, realtime: true, size: flawless ? 1.3 * 1.4 * Math.max(W, H) : undefined }));
    this._track(godrays(fx, { duration: total, x: W / 2 }));
    this._track(fx.weather('petals', { duration: total }));
    this._track(fx.weather('confetti', { duration: Math.round(total * 0.75) }));
    const kz = Math.min(W * (flawless ? 0.46 : 0.42), flawless ? 210 : 190);
    this._kanji(kanjiFor(flawless ? 'flawless' : 'win'), W / 2, ky, { screen: true, color: gold, size: kz, hold: total - 500, exit: 'fade', backdrop: 'rays', realtime: true, clamp: false });
    if (flawless) {
      // two sword strokes cross the glyph once it has landed
      const len = kz * 2.3;
      wait(this._t(300), { clock: this._clock, realtime: true }).then(() => {
        if (this._skipping) return;
        this._track(screenSlash(fx, W / 2, ky, -0.42, { color: gold, length: len, width: 12, duration: this._t(420) }));
        this._sfx('slash', { intensity: 1 });
      });
      wait(this._t(460), { clock: this._clock, realtime: true }).then(() => {
        if (this._skipping) return;
        this._track(screenSlash(fx, W / 2, ky, 0.36, { color: 0xffffff, length: len, width: 10, duration: this._t(420) }));
        this._sfx('slash', { intensity: 0.8, pitch: 1.2 });
      });
    }
    // the winner's pieces celebrate: a hop wave across the board
    this._wave(winner);
    await this._wait(cx, 380, true);
    const sub = this._statsLine(stats, winner);
    const p = this._track(fx.banner(title, { sub, style: 'victory', color: flawless ? gold : mixHex(col, gold, 0.55), y: H * 0.5, hold }));
    this._claimCenter(p, hold, 460 + hold + 280);
    this._sfx('swell', { intensity: 0.8 });
    await this._wait(cx, 900, true);
    const name = players && players[winner] && players[winner].name;
    const named = human && !!this._playerName();
    const line = bragLine(flawless ? 'flawless' : 'win', { name: named ? this._playerName() : name, named }, this._lang);
    if (this.pref('brags') !== 'off') this._say(winner, line, { speaker: name || this._s(winner === 1 ? 'white' : 'black'), color: col, maxWait: 1200, kind: 'gameover' });
    await this._wait(cx, total - 380 - 900, true);
  }

  async _epicDefeat(cx, { winner, hero, stats, players, result }) {
    const r = this.renderer;
    const fx = this.fx;
    const scr = r.screen;
    const W = scr.width;
    const H = scr.height;
    const steel = 0x8a96b8;
    const resigned = result && result.reason === 'resign';
    const title = this._s('defeat');
    const sub = resigned ? this._s('youResign') : bragLine('lose', {}, this._lang);
    const hold = this._read([title, sub], 'gameover');
    const total = 500 + 830 + hold + 280;
    this._sfx('lose', { intensity: 1 });
    this._sfx('heartbeat', { intensity: 0.9 });
    this._haptic('lose');
    this._announce('GAME OVER', { force: true });
    fx.slowMo(0.35, this._rt(2600), { inMs: 400, outMs: 500 });
    cx.slow = true;
    this._track(fx.grade({ amount: 0.9, dark: 0.32, duration: total + 300, fade: 500 }));
    this._track(fx.weather('rain', { duration: total + 200 }));
    this._track(fx.vignette(0x000000, { alpha: 0.75, duration: total + 300, fade: 600 }));
    this._sky();
    this._sfx('thunder', { intensity: 0.7 });
    // the loser's pieces sag
    r.forEachPiece((v) => {
      if (v.color === hero) v.setDim(true);
    });
    await this._wait(cx, 500, true);
    this._kanji(kanjiFor('lose'), W / 2, H * 0.32, { screen: true, color: steel, size: Math.min(W * 0.36, 170), hold: total - 1000, exit: 'fade', backdrop: 'none', realtime: true, clamp: false });
    const p = this._track(fx.banner(title, { sub, style: 'defeat', y: H * 0.5, hold }));
    this._claimCenter(p, hold, 830 + hold + 280);
    await this._wait(cx, 1300, true);
    const wName = players && players[winner] && players[winner].name;
    if (wName && this.pref('brags') !== 'off') {
      this._say(winner, bragLine('taunt', { opp: players[hero] && players[hero].name }, this._lang), { speaker: wName, color: this._epicColor(winner), maxWait: 1200, kind: 'gameover' });
    }
    await this._wait(cx, total - 1800, true);
    r.forEachPiece((v) => {
      if (v.color === hero) v.setDim(false);
    });
  }

  async _epicDraw(cx, { stats, players }) {
    const r = this.renderer;
    const fx = this.fx;
    const scr = r.screen;
    const W = scr.width;
    const H = scr.height;
    const title = this._s('draw');
    const sub = bragLine('draw', {}, this._lang).toUpperCase();
    const hold = this._read([title, sub], 'gameover');
    const total = 350 + 460 + hold + 280;
    this._sfx('draw', { intensity: 1 });
    this._sfx('gong', { intensity: 0.6 });
    this._haptic('draw');
    this._announce('DRAW!', { force: true });
    fx.flash(0xffffff, { duration: 260, alpha: 0.35 });
    this._track(fx.rays(W * 0.3, H * 0.3, { screen: true, color: this._epicColor(1), duration: total, alpha: 0.4, realtime: true }));
    this._track(fx.rays(W * 0.7, H * 0.3, { screen: true, color: this._epicColor(-1), duration: total, alpha: 0.4, realtime: true }));
    this._kanji(kanjiFor('draw'), W / 2, H * 0.3, { screen: true, color: mixHex(EPIC.grid, 0xffffff, 0.25), size: Math.min(W * 0.19, 96), hold: total - 600, exit: 'fade', backdrop: 'rays', realtime: true, clamp: false });
    await this._wait(cx, 350, true);
    const p = this._track(fx.banner(title, { sub, style: 'gold', color: EPIC.grid, y: H * 0.5, hold }));
    this._claimCenter(p, hold, 460 + hold + 280);
    await this._wait(cx, total - 350, true);
  }

  async _classicGameOver(cx, { winner, humanColor, outcome }) {
    const r = this.renderer;
    const fx = this.fx;
    const scr = r.screen;
    let title =
      outcome === 'draw'
        ? this._s('cDraw')
        : humanColor === 1 || humanColor === -1
          ? outcome === 'win'
            ? this._s('cWin')
            : this._s('cLoss')
          : this._s(winner === 1 ? 'cWhite' : 'cBlack');
    if (outcome === 'win' && (humanColor === 1 || humanColor === -1) && this._playerName()) title = this._playerName() + (this._lang === 'en' ? ' wins!' : ' побеждает!');
    const hold = this._read(title, 'gameover');
    const total = 600 + hold + 320;
    this._sfx(outcome === 'draw' ? 'draw' : outcome === 'win' ? 'win' : 'lose');
    this._haptic(outcome === 'draw' ? 'draw' : outcome === 'win' ? 'win' : 'lose');
    if (fx) {
      if (outcome === 'win') {
        this._track(fx.rays(scr.width / 2, scr.height * 0.45, { screen: true, color: CLASSIC.goldLight, duration: total, realtime: true }));
        r.forEachPiece((v) => {
          if (v.color === winner) fx.burst(v.x, v.y, { kind: 'stars', count: 3, color: CLASSIC.goldLight });
        });
        this._wave(winner, 0.22);
      } else if (outcome === 'loss') {
        this._track(fx.vignette(0x000000, { alpha: 0.5, duration: total, fade: 500 }));
      }
      const p = this._track(fx.banner(title, { style: 'classic', hold, y: scr.height * 0.45 }));
      this._claimCenter(p, hold, total);
    }
    await this._wait(cx, total, true);
  }

  /** Victory wave: the winner's pieces hop one after another (left → right). */
  _wave(color, height = 0.35) {
    const r = this.renderer;
    const list = [];
    r.forEachPiece((v) => {
      if (v.color === color) list.push(v);
    });
    list.sort((a, b) => a.x - b.x);
    const w = r.boardBounds.width || 1;
    for (const v of list) {
      const delay = ((v.x - r.boardBounds.x) / w) * 600;
      animate(
        460,
        (e, k) => {
          if (!v.destroyed) v.lift = height * Math.sin(Math.PI * k);
        },
        { clock: this._clock, realtime: true, delay },
      ).then(() => {
        if (!v.destroyed) v.lift = 0;
      });
    }
  }

  // =================================================================== small feedback
  playSelect(sq) {
    this._sfx('select');
    this._haptic('select');
    if (!this.epic) return;
    const v = this.renderer.pieceAt(sq);
    if (!v) return;
    const col = this._epicColor(v.color);
    this._try(() => {
      pulse(this.fx, v.x, v.y, { color: v.isKing ? EPIC.gold : col });
      this.fx.burst(v.x, v.y, { kind: 'spark', count: 8, color: col, speed: 0.5, life: 0.6, realtime: true });
    });
  }

  playDeselect() {
    this._sfx('deselect');
    this._haptic('deselect');
  }

  playIllegal(sq) {
    const r = this.renderer;
    this._sfx('illegal');
    this._haptic('illegal');
    const v = sq != null && sq >= 0 ? r.pieceAt(sq) : null;
    if (v && !v._moveTask) {
      const amp = r.squareSize * 0.09;
      if (v._illegalTask) v._illegalTask.cancel(true);
      const t = animate(
        320,
        (e, k) => {
          v.body.x = Math.sin(k * Math.PI * 6) * amp * (1 - k);
        },
        { clock: this._clock, realtime: true },
      );
      v._illegalTask = t;
      t.then(() => {
        if (v._illegalTask === t) v._illegalTask = null;
        if (!v.destroyed) v.body.x = 0;
      });
    }
    if (this.epic) {
      const c = sq != null && sq >= 0 ? r.squareCenter(sq) : null;
      this._try(() => {
        if (c) pulse(this.fx, c.x, c.y, { color: EPIC.capture, duration: 300 });
        const k = this.pref('shake');
        if (k > 0) r.camera.shake(0.07 * k, 160);
      });
    }
  }

  playHint(path) {
    this._sfx('hint');
    this._haptic('hint');
    if (!path || path.length < 2) return Promise.resolve(true);
    const r = this.renderer;
    this._try(() => r.highlights && r.highlights.setHint && r.highlights.setHint(path));
    if (!this.fx) return Promise.resolve(true);
    const p = this._try(() => hintComet(this.fx, path, { epic: this.epic, hopMs: 230 / this._speed }));
    return p ? Promise.resolve(p).then(() => true) : Promise.resolve(true);
  }

  destroy() {
    this._gen++;
    this._stage.clear();
    this._marks.clear();
    this._clock.remove(this._tick, this);
  }
}
