// Controller — the game loop (ARCHITECTURE.md §8). Owns the engine Game, tap input (select →
// multi-step path entry), AI turns, undo / hint / resign / draw, per-game stats + hype, results.
//
//   const c = new Controller({ ui, renderer, fx, director, audio, ai, native, settings, statsStore, opts });
//   c.startGame(GameConfig)        // from the UI 'play' event, rematch or the ?screen=game URL
//   c.resumeGame(save)             // continue an autosaved game (src/app-save.js readSave())
//   c.stopGame()                   // back to the menus (cancels AI, stops cinematics)
//
// Robustness rules:
//  - every game start / undo / resign / stop bumps `token`; every async step re-checks it, so an
//    AI answer or a cinematic that resolves after the game changed is ignored;
//  - every Director / FX call is guarded (a failing effect never breaks the game): errors are
//    logged, the renderer is re-synced from the engine state and the game continues;
//  - after every move the renderer piece map is compared with the engine state (mismatch →
//    console.error in debug builds + re-sync);
//  - the running game is autosaved after every move and on pause (Android may kill the WebView
//    in the background); the save is dropped when the game ends or is abandoned.
//
// Player-facing strings come from the UI i18n table via controller-text.js (with fallbacks).

import { WHITE, BLACK, Game, getVariant, findMove, movesWithPrefix, materialCount, stateFromString, stateToString, sqToRc } from './engine/index.js';
import { AI_LEVELS } from './ai/ai-client.js';
import { t, getLang } from './ui/i18n.js';
import { text, hasText } from './controller-text.js';
import { illegalTapReason } from './controller-capture.js';
import { writeSave, clearSave, saveableMode } from './app-save.js';
import { sideColors } from './controller-colors.js';

// Hype («ЯРОСТЬ») tuning: fills with captures (more for combos), a little when you lose pieces,
// a bit for promotions. At ≥ 1 the next capture is the ULTIMATE and the meter resets.
export const HYPE = Object.freeze({ perCapture: 0.22, comboBonus: 0.12, perLoss: 0.06, promotion: 0.12 });

/** Minimum AI "thinking" pause per settings.aiPace (ms); an AI-vs-AI demo waits a bit longer. */
export const AI_PACE_MS = Object.freeze({ fast: 300, normal: 700, slow: 1300 });
export const DEMO_EXTRA_MS = 400;
/** The AI does not wait longer than this (× textTime) for the opponent-turn banner. */
const TURN_BANNER_WAIT_MS = 1500;
const CINEMATIC_TIMEOUT = 25000; // ticker-time watchdog for a Director promise (hang protection)
const HAPTIC_LEVELS = ['off', 'light', 'strong'];
/** «Пропустить» chip: shown only once a cinematic has run this long (no flashing on short ones). */
export const SKIP_CHIP_DELAY = { epic: 900, classic: 1500 };
/** Taps within this time after the move was committed (or after a path tap) never skip it (MUX-01). */
export const SKIP_GRACE_MS = 350;
/** A tap on the next landing square of the committed move counts as move entry within this gap. */
export const ENTRY_TAP_GAP_MS = 1500;
/** Release keep-screen-on after this long without any input on the player's own turn (F7). */
export const IDLE_SCREEN_MS = 3 * 60 * 1000;
/** Draw offers to the AI (RTR-02): from this move on, accepted only if the AI is not better by more than 0.3 man. */
export const DRAW_MIN_MOVE = 20;
export const DRAW_ACCEPT_MAX = 30;
/** An explanation in the status line stays this long × settings.textTime. */
const STATUS_RESET_MS = 3000;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const isColor = (c) => c === WHITE || c === BLACK;
const clampLevel = (v, def = 3) => Math.min(5, Math.max(1, Math.round(Number(v) || def)));

/** settings.textTime as a number in [1, 3] (how long texts stay readable). */
export function textTimeOf(settings) {
  const v = Number(settings && settings.textTime);
  return Number.isFinite(v) && v > 0 ? Math.min(3, Math.max(1, v)) : 1.5;
}

/** Minimum AI pause for the settings (aiPace) and mode (a demo is a bit slower). */
export function aiMinDelay(settings, mode) {
  const pace = settings && AI_PACE_MS[settings.aiPace] != null ? settings.aiPace : 'normal';
  return AI_PACE_MS[pace] + (mode === 'demo' ? DEMO_EXTRA_MS : 0);
}

/** settings.haptics ('off' | 'light' | 'strong'), from the old boolean `vibration` if needed. */
export function hapticsOf(settings) {
  if (!settings) return 'strong';
  if (HAPTIC_LEVELS.includes(settings.haptics)) return settings.haptics;
  return settings.vibration === false ? 'off' : 'strong';
}

/** The player's display name: settings.playerName (trimmed, ≤ 16 chars) or «Ты» / "You". */
export function playerNameOf(settings, fallback) {
  const raw = settings && typeof settings.playerName === 'string' ? settings.playerName : '';
  const name = Array.from(raw.replace(/\s+/g, ' ').trim()).slice(0, 16).join('').trim();
  return name || fallback;
}

export function freshStats() {
  return {
    captures: { 1: 0, '-1': 0 },
    maxCombo: { 1: 0, '-1': 0 },
    kingsMade: { 1: 0, '-1': 0 },
    piecesLost: { 1: 0, '-1': 0 },
    ultimates: { 1: 0, '-1': 0 },
    hype: { 1: 0, '-1': 0 },
    moveNumber: 0,
  };
}

export function cloneStats(st) {
  const c = (o) => ({ 1: o[1], '-1': o[-1] });
  return {
    captures: c(st.captures),
    maxCombo: c(st.maxCombo),
    kingsMade: c(st.kingsMade),
    piecesLost: c(st.piecesLost),
    ultimates: c(st.ultimates),
    hype: c(st.hype),
    moveNumber: st.moveNumber,
  };
}

/** Updates the per-game stats + hype for one played move (pure: depends only on its inputs). */
export function applyMoveStats(st, move, mover, plies) {
  const n = move.captures.length;
  st.moveNumber = Math.ceil(plies / 2);
  if (n) {
    st.captures[mover] += n;
    st.piecesLost[-mover] += n;
    st.maxCombo[mover] = Math.max(st.maxCombo[mover], n);
    if (st.hype[mover] >= 1) {
      // this capture was the ULTIMATE: the meter is spent
      st.hype[mover] = 0;
      st.ultimates[mover]++;
    } else {
      st.hype[mover] = Math.min(1, st.hype[mover] + HYPE.perCapture * n + HYPE.comboBonus * (n - 1));
    }
    st.hype[-mover] = Math.min(1, st.hype[-mover] + HYPE.perLoss * n);
  }
  if (move.promotion) {
    st.kingsMade[mover]++;
    if (st.hype[mover] < 1) st.hype[mover] = Math.min(1, st.hype[mover] + HYPE.promotion);
  }
  return st;
}

/** Stats after replaying a Game history, plus the stats before each move (for undo). */
export function replayStats(history) {
  const stats = freshStats();
  const hist = [];
  history.forEach((h, i) => {
    hist.push(cloneStats(stats));
    applyMoveStats(stats, h.move, h.before.turn, i + 1);
  });
  return { stats, hist };
}

const uniqueMoves = (opts) => Array.from(new Set(opts.map((o) => o.move)));

function samePath(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Display copy of `move` that follows `path` (one of its equivalent `alts` routes), with the
 * captures re-ordered to match the hops — so the Director animates the route the player tapped.
 * Falls back to the canonical move when the route cannot be mapped cleanly.
 */
export function routeMove(move, path, size) {
  if (!move || !path || samePath(move.path, path)) return move;
  if (!move.captures || !move.captures.length) return move;
  if (path.length !== move.path.length) return move;
  if (move.promotion && move.promotionAt !== move.path.length - 1) return move; // mid-capture crowning
  const left = move.captures.map((sq, i) => ({ sq, code: move.captured[i] }));
  const caps = [];
  const codes = [];
  for (let i = 1; i < path.length; i++) {
    const [ra, ca] = sqToRc(path[i - 1], size);
    const [rb, cb] = sqToRc(path[i], size);
    const dr = rb - ra;
    const dc = cb - ca;
    if (!(dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc))) return move;
    const steps = Math.max(Math.abs(dr), Math.abs(dc));
    const sr = sign(dr);
    const sc = sign(dc);
    let found = -1;
    for (let k = 1; k < steps; k++) {
      const sq = (ra + sr * k) * size + (ca + sc * k);
      const j = left.findIndex((x) => x.sq === sq);
      if (j >= 0) {
        if (found >= 0) return move; // two victims on one hop: not a valid mapping
        found = j;
      }
    }
    if (found < 0) return move;
    caps.push(left[found].sq);
    codes.push(left[found].code);
    left.splice(found, 1);
  }
  if (left.length) return move;
  return { ...move, path: path.slice(), captures: caps, captured: codes };
}

/** AI levels per colour for a config: demo games pit two different fighters (MUX-18). */
export function demoLevels(cfg, rnd = Math.random) {
  const L = clampLevel(cfg.level);
  const lw = cfg.levelWhite != null ? clampLevel(cfg.levelWhite, L) : null;
  const lb = cfg.levelBlack != null ? clampLevel(cfg.levelBlack, L) : null;
  if (lw && lb) return { 1: lw, '-1': lb };
  const other = L > 1 ? L - 1 : 2;
  return rnd() < 0.5 ? { 1: L, '-1': other } : { 1: other, '-1': L };
}

/**
 * A fighter name with its side, for two equal AIs in a demo: the UI's wording («Самурай белых» /
 * 'White Samurai', keys hud.sideName + common.whiteGen / blackGen) or a fallback.
 */
export function sideNamed(name, color, lang) {
  const sideKey = color > 0 ? 'common.whiteGen' : 'common.blackGen';
  if (hasText('hud.sideName') && hasText(sideKey)) return text('hud.sideName', { name, side: text(sideKey) });
  if (lang === 'en') return `${color > 0 ? 'White' : 'Black'} ${name}`;
  return `${name} ${color > 0 ? 'белых' : 'чёрных'}`;
}

export class Controller {
  constructor({ ui, renderer, fx, director, audio, ai, native, settings, statsStore, opts = {} }) {
    this.ui = ui;
    this.renderer = renderer;
    this.fx = fx;
    this.director = director;
    this.audio = audio;
    this.ai = ai;
    this.native = native;
    this.settings = settings;
    this.statsStore = statsStore;
    this.debug = !!opts.debug;
    this.fast = !!opts.fast;
    this.autoSkip = !!opts.autoSkip;
    this._now = typeof opts.now === 'function' ? opts.now : now;
    this.storage = opts.storage || undefined; // autosave storage (default: localStorage)
    this.autosave = opts.autosave !== false;

    this.token = 0;
    this.game = null;
    this.cfg = null; // resolved config of the current game (humanColor resolved)
    this.baseCfg = null; // as requested (humanColor 0 = random again on rematch)
    this.mode = 'ai';
    this.humanColor = WHITE;
    this.bottomColor = WHITE;
    this.players = null;
    this.stats = freshStats();
    this._statsHist = [];
    this.phase = 'idle'; // idle | intro | human | ai | animating | over
    this.active = false;
    this.paused = false;
    this.appPaused = false;
    this.sel = null;
    this._selectable = new Set();
    this._mustCapture = false;
    this._hintSeq = 0;
    this._hintPending = false;
    this._anim = null;
    this._inflight = new Set(); // Director promises still running (cinematics)
    this._undoing = false;
    this._resumeWaiters = [];
    this._intensity = 0;
    /** Effective graphics quality ('high' | 'medium' | 'low'; settings.quality may say 'auto'). */
    this.quality = ['high', 'medium', 'low'].includes(settings.quality) ? settings.quality : 'high';
    /** Frame budget / quality manager (src/app-perf.js), set by main.js; applySettings forwards to it. */
    this.perf = null;
    this._lang = settings.lang;
    this._sideColorsKey = undefined;
    this.startedAt = 0;
    this.mismatches = 0;
    this.errors = [];
    this.movesPlayed = 0;
    this._skipGuard = null;
    this._drawOffer = null;
    this._drawThinking = false;
    this._drawDecision = null;
    this._statusKind = '';
    this._statusTimer = 0;
    this._lastWarn = null;
    this._awake = undefined;
    this._idle = false;
    this._lastActivity = this._now();
    this._idleTimer = 0;

    // keep the Director's ЯРОСТЬ model in sync with ours (it spots the meter filling up itself)
    if (director && director.hypeModel && typeof director.hypeModel === 'object') director.hypeModel = { ...HYPE };

    renderer.onTap((e) => this._onTap(e));
    renderer.onSquareTap((sq) => this._onSquareTap(sq));
  }

  // =================================================================== helpers
  _logError(label, err) {
    const msg = `[controller] ${label}: ${err && err.stack ? err.stack : err}`;
    this.errors.push(msg);
    if (this.errors.length > 50) this.errors.shift();
    if (this.debug) console.error(msg);
    else console.warn(msg);
  }

  /** Runs fn() (sync or async) and never throws; returns its (awaited) value or undefined. */
  async _guard(label, fn) {
    try {
      return await fn();
    } catch (e) {
      this._logError(label, e);
      return undefined;
    }
  }

  /** Fire-and-forget guarded call. */
  _fire(label, fn) {
    try {
      const r = fn();
      if (r && typeof r.then === 'function') r.then(null, (e) => this._logError(label, e));
    } catch (e) {
      this._logError(label, e);
    }
  }

  _sfx(name, opts) {
    try {
      if (this.audio) this.audio.play(name, opts);
    } catch (e) {
      /* audio is optional */
    }
  }

  get hud() {
    return this.ui.hud;
  }

  get epic() {
    return !!(this.cfg && this.cfg.epic);
  }

  _isHuman(color) {
    if (this.mode === 'pvp') return true;
    if (this.mode === 'demo') return false;
    return color === this.humanColor;
  }

  _schedule(token) {
    Promise.resolve().then(() => this._advance(token));
  }

  _waitUnpaused() {
    if (!this.paused) return Promise.resolve();
    return new Promise((r) => this._resumeWaiters.push(r));
  }

  /** Is the UI's pause menu really open? (unknown → trust our own flag) */
  _uiPaused() {
    try {
      const p = this.ui.paused;
      return p === undefined ? true : !!p;
    } catch (e) {
      return true;
    }
  }

  /**
   * Waits until the pause menu is closed (F1). Also recovers when the UI closed its pause overlay
   * without emitting 'resume' (e.g. it was closed by another overlay).
   */
  async _waitUnpausedUi(token) {
    while (token === this.token && this.paused) {
      if (!this._uiPaused()) {
        this.onResume();
        break;
      }
      await Promise.race([this._waitUnpaused(), sleep(250)]);
    }
  }

  _flushWaiters() {
    const w = this._resumeWaiters;
    this._resumeWaiters = [];
    for (const r of w) r();
  }

  _track(promise) {
    if (!promise || typeof promise.then !== 'function') return;
    this._inflight.add(promise);
    const drop = () => this._inflight.delete(promise);
    promise.then(drop, drop);
  }

  /**
   * Skips and waits (bounded) for Director cinematics that are still running — e.g. the previous
   * game's playMove, whose final re-sync would otherwise land on the next game's board.
   */
  async _drainDirector(maxMs = 3000) {
    if (!this._inflight.size) return;
    const d = this.director;
    const t0 = now();
    while (this._inflight.size && now() - t0 < maxMs) {
      this._fire('director.skip', () => d.busy && d.skip());
      await Promise.race([Promise.all(Array.from(this._inflight)), sleep(100)]);
    }
    this._fire('fx.clear', () => this.fx && this.fx.clear());
  }

  /**
   * Awaits a Director promise: shows the «Пропустить» chip once a cinematic has been running for a
   * while (EAD-22: never on short animations), honours autoSkip (tests), and protects against a
   * promise that never settles (watchdog on ticker time, so a backgrounded / paused app never
   * trips it).
   */
  async _cinematic(promise) {
    this._track(promise);
    const hud = this.hud;
    const d = this.director;
    const clock = this.renderer.clock;
    const t0 = now();
    const chipAfter = this.epic ? SKIP_CHIP_DELAY.epic : SKIP_CHIP_DELAY.classic;
    if (this.autoSkip) this._fire('skip', () => d.busy && d.skip());
    let done = false;
    let poll = 0;
    let chip = false;
    const tick = () => {
      if (done) return;
      const busy = !!d.busy;
      const on = busy && now() - t0 > chipAfter;
      if (on !== chip) {
        chip = on;
        hud.setSkippable(on);
      }
      if (busy && this.autoSkip) this._fire('skip', () => d.skip());
    };
    poll = setInterval(tick, 120);
    const start = clock.realNow;
    // slower animations / longer texts make legitimately longer cinematics
    const speed = Math.min(2, Math.max(0.5, Number(this.settings.animSpeed) || 1));
    const timeout = CINEMATIC_TIMEOUT * Math.max(1, 1 / speed) * Math.max(1, textTimeOf(this.settings) / 1.5);
    try {
      await new Promise((resolve) => {
        const wd = setInterval(() => {
          if (clock.realNow - start > timeout) {
            clearInterval(wd);
            this._logError('cinematic', new Error('director promise timed out'));
            this._fire('skip', () => d.skip());
            resolve();
          }
        }, 500);
        Promise.resolve(promise).then(
          () => {
            clearInterval(wd);
            resolve();
          },
          (e) => {
            clearInterval(wd);
            this._logError('cinematic', e);
            resolve();
          },
        );
      });
    } finally {
      done = true;
      clearInterval(poll);
      hud.setSkippable(false);
    }
  }

  _setTheme(theme) {
    theme = theme === 'epic' ? 'epic' : 'classic';
    this._fire('renderer.setTheme', () => this.renderer.setTheme(theme));
    this._fire('fx.setMode', () => this.fx && this.fx.setMode(theme));
    this._fire('director.setMode', () => this.director.setMode(theme));
  }

  _showBoard(on) {
    const w = this.renderer.layers.world;
    w.visible = !!on;
    w.alpha = 1;
  }

  /** Tell the Director (if it supports it) that the position was reset outside playMove. */
  _directorReset(state) {
    const d = this.director;
    if (!d) return;
    if (typeof d.syncPosition === 'function') this._fire('director.syncPosition', () => d.syncPosition(state));
    else if (typeof d.reset === 'function') this._fire('director.reset', () => d.reset(state));
  }

  /** The HUD fade for big cinematics (EAD-06) is reset at game boundaries (a hook may be cut short). */
  _resetHudCinematic() {
    const hud = this.hud;
    if (!hud) return;
    if (typeof hud.resetCinematic === 'function') this._fire('hud.resetCinematic', () => hud.resetCinematic());
    else if (typeof hud.setCinematic === 'function') this._fire('hud.setCinematic', () => hud.setCinematic(false));
  }

  // =================================================================== lanes (EAD-15)
  /**
   * Free screen space above / below the board frame for the Director's banners, captions and the
   * combo counter: from the UI (hud.lanes()) when it provides them, else measured from the DOM.
   */
  syncLanes() {
    const d = this.director;
    if (!d || typeof d.setLanes !== 'function' || !this.active) return;
    let lanes = null;
    const hud = this.hud;
    try {
      if (hud && typeof hud.lanes === 'function') lanes = hud.lanes();
    } catch (e) {
      lanes = null;
    }
    const valid = (l) => l && typeof l === 'object' && ('top' in l || 'bottom' in l);
    if (!valid(lanes)) lanes = this._domLanes();
    if (!valid(lanes)) return;
    this._fire('director.setLanes', () => d.setLanes({ top: lanes.top || null, bottom: lanes.bottom || null }));
  }

  /** Lane fallback: between the top HUD panel and the board frame, and the frame and the status chip. */
  _domLanes() {
    if (typeof document === 'undefined') return null;
    try {
      const fr = this.renderer.frameBounds;
      if (!fr || !(fr.height > 0)) return null;
      const scr = document.querySelector('.screen--game');
      if (!scr) return null;
      const top = scr.querySelector('.hp--top');
      const status = scr.querySelector('.status');
      const out = { top: null, bottom: null };
      if (top) {
        const b = top.getBoundingClientRect();
        const h = fr.y - b.bottom;
        if (b.height > 0 && h > 0 && b.bottom < fr.y) out.top = { y: b.bottom, h };
      }
      if (status) {
        const b = status.getBoundingClientRect();
        const y = fr.y + fr.height;
        const h = b.top - y;
        if (b.height > 0 && h > 0) out.bottom = { y, h };
      }
      return out;
    } catch (e) {
      return null;
    }
  }

  /** The #board-slot moved / resized (UI 'board-rect'). */
  onBoardRect(rect) {
    if (!this.active || !rect || !(rect.width > 0)) return;
    this._fire('renderer.setBoardRect', () => this.renderer.setBoardRect(rect));
    this.syncLanes();
  }

  // =================================================================== screen wake (F7)
  /** Keep the display on only while a game is actually being played. */
  _updateWake() {
    const on = !!(this.active && !this.paused && !this.appPaused && this.phase !== 'over' && !this._idle);
    if (on === this._awake) return;
    this._awake = on;
    this._fire('keepScreenOn', () => this.native && this.native.keepScreenOn(on));
  }

  /** Any user input (board taps, HUD buttons): re-arms the screen wake lock after an idle spell. */
  noteActivity() {
    this._lastActivity = this._now();
    if (this._idle) {
      this._idle = false;
      this._updateWake();
    }
  }

  /** The player has not touched the screen for IDLE_SCREEN_MS on their own turn: let it sleep. */
  _checkIdle() {
    if (this.active && this.phase === 'human' && !this._idle && this._now() - this._lastActivity > IDLE_SCREEN_MS) {
      this._idle = true;
      this._updateWake();
    }
  }

  _startIdleTimer() {
    if (this._idleTimer) return;
    this._idleTimer = setInterval(() => this._checkIdle(), 15000);
    if (this._idleTimer && typeof this._idleTimer.unref === 'function') this._idleTimer.unref();
  }

  _stopIdleTimer() {
    if (this._idleTimer) clearInterval(this._idleTimer);
    this._idleTimer = 0;
  }

  // =================================================================== autosave (F8)
  _saveGame() {
    const g = this.game;
    if (!this.autosave || !g || !this.active || !this.cfg || !saveableMode(this.mode) || g.result) return;
    try {
      writeSave(
        {
          cfg: { ...this.cfg, humanColor: this.baseCfg ? this.baseCfg.humanColor : this.cfg.humanColor },
          humanColor: this.humanColor,
          game: g,
          elapsedSec: (Date.now() - this.startedAt) / 1000,
        },
        this.storage,
      );
    } catch (e) {
      this._logError('autosave', e);
    }
  }

  _dropSave() {
    if (!this.autosave) return;
    try {
      clearSave(this.storage);
    } catch (e) {
      /* ignore */
    }
  }

  // =================================================================== players
  _makePlayers() {
    const lang = getLang();
    const cfg = this.cfg;
    const colorName = (c) => (c > 0 ? t('common.white') : t('common.black'));
    const custom = playerNameOf(this.settings, '');
    const mk = (color) => {
      if (this._isHuman(color)) {
        if (this.mode === 'pvp') {
          // two players on one phone: the owner's name (settings.playerName) goes to WHITE
          if (color === WHITE && custom) return { name: custom, isHuman: true, title: colorName(color), color, custom: true };
          return { name: colorName(color), isHuman: true, title: t('hud.player'), color };
        }
        let title = colorName(color);
        try {
          const tid = this.statsStore && this.statsStore.currentTitle();
          if (tid) title = t(`title.${tid}.name`);
        } catch (e) {
          /* ignore */
        }
        return { name: custom || text('hud.you'), isHuman: true, title, color, custom: !!custom };
      }
      const level = clampLevel(cfg.levels ? cfg.levels[color] : cfg.level);
      const L = AI_LEVELS[level - 1] || AI_LEVELS[2];
      const names = cfg.epic ? L.epicName : L.name;
      let name = names[lang] || names.ru;
      // two equal AIs in a demo still get different names: «Белый самурай» vs «Чёрный самурай»
      if (this.mode === 'demo' && cfg.levels && cfg.levels[1] === cfg.levels[-1]) name = sideNamed(name, color, lang);
      const title = this.mode === 'demo' ? `${colorName(color)} · ${t('hud.aiLevel', { n: level })}` : t('hud.aiLevel', { n: level });
      return { name, isHuman: false, title, level, kanji: L.kanji, power: L.power, color };
    };
    return { 1: mk(WHITE), '-1': mk(BLACK) };
  }

  // =================================================================== game lifecycle
  /**
   * Start a game. cfg: GameConfig { variantId, mode, humanColor (0 = random), level, epic, giveaway,
   * levelWhite?, levelBlack? (demo) }. opts.startState: optional engine State to start from
   * (tests / ?pos=); opts.intro=false skips the VS cinematic; opts.resume: a validated autosave
   * (readSave()) to continue.
   */
  async startGame(cfgIn, { startState = null, intro = true, resume = null } = {}) {
    const token = ++this.token;
    this._abortCurrent();
    if (this._inflight.size) {
      this.active = false; // no input / loop for the old game while it winds down
      await this._drainDirector();
      if (token !== this.token) return;
    }
    const base = {
      variantId: 'russian',
      mode: 'ai',
      humanColor: WHITE,
      level: 3,
      epic: true,
      giveaway: false,
      ...(cfgIn || {}),
    };
    if (!['ai', 'pvp', 'demo'].includes(base.mode)) base.mode = 'ai';
    base.level = clampLevel(base.level);
    base.epic = !!base.epic;
    base.giveaway = !!base.giveaway;
    let variant;
    try {
      variant = getVariant(base.variantId);
    } catch (e) {
      this._logError('variant', e);
      variant = getVariant('russian');
    }
    base.variantId = variant.id;
    this.baseCfg = { ...base };

    let game = null;
    if (resume && resume.game instanceof Game && resume.game.variant.id === variant.id && !resume.game.result) game = resume.game;
    else resume = null;
    let human = 0;
    if (base.mode === 'ai') {
      if (resume) human = resume.humanColor === BLACK ? BLACK : WHITE;
      else human = base.humanColor === BLACK ? BLACK : base.humanColor === WHITE ? WHITE : Math.random() < 0.5 ? WHITE : BLACK;
    }
    if (!game) {
      try {
        game = new Game(variant.id, { giveaway: base.giveaway }, startState || undefined);
      } catch (e) {
        this._logError('start position', e);
        game = new Game(variant.id, { giveaway: base.giveaway });
      }
    }
    // a new game abandons the previous unfinished one (the resumed one is saved again below)
    this._dropSave();
    this.game = game;
    // a game started from a position: the HUD «captured» counters start from the missing pieces
    this._capOffset = { 1: 0, '-1': 0 };
    try {
      const m = materialCount(game.startState);
      this._capOffset[1] = Math.max(0, variant.piecesPerSide - (m.bm + m.bk));
      this._capOffset[-1] = Math.max(0, variant.piecesPerSide - (m.wm + m.wk));
    } catch (e) {
      /* counters are cosmetic */
    }
    this.cfg = { ...base, humanColor: human, giveaway: game.options.giveaway };
    if (base.mode === 'demo') this.cfg.levels = demoLevels(base);
    this.mode = base.mode;
    this.humanColor = human;
    this.bottomColor = base.mode === 'ai' ? human : WHITE;
    this.players = this._makePlayers();
    if (resume) {
      const r = replayStats(game.history);
      this.stats = r.stats;
      this._statsHist = r.hist;
      this.startedAt = Date.now() - Math.max(0, Number(resume.elapsedSec) || 0) * 1000;
    } else {
      this.stats = freshStats();
      this._statsHist = [];
      this.startedAt = Date.now();
    }
    this.active = true;
    this.paused = false;
    this.phase = 'intro';
    this.sel = null;
    this._intensity = 0;
    this.movesPlayed = 0;
    this._drawOffer = null;
    this._drawDecision = null;
    this._lastWarn = null;
    this._statusKind = '';
    this._idle = false;
    this._lastActivity = this._now();
    this._fire('ai.newGame', () => this.ai.newGame());

    const theme = base.epic ? 'epic' : 'classic';
    const ui = this.ui;
    try {
      ui.hud.setup({
        variant,
        players: this.players,
        bottomColor: this.bottomColor,
        epic: base.epic,
        mode: base.mode,
        level: base.level,
        giveaway: this.cfg.giveaway,
      });
      ui.showScreen('game');
    } catch (e) {
      this._logError('hud.setup', e);
    }
    this._resetHudCinematic();
    this._setTheme(theme);
    this._applySideColors(); // the player's energy colour depends on the side they play
    const r = this.renderer;
    try {
      r.camera.snap();
      r.setVariant(variant, { flipped: this.bottomColor === BLACK });
      r.setBoardRect(ui.boardSlotRect());
      r.setPosition(game.state);
      r.highlights.clear(true);
      if (resume && game.lastMove) r.highlights.setLastMove(game.lastMove.path);
      r.setTurnGlow(game.state.turn);
    } catch (e) {
      this._logError('renderer setup', e);
    }
    this.syncLanes();
    this._showBoard(true);
    this._directorReset(game.state);
    this._refreshHud();
    this._updateWake();
    this._startIdleTimer();
    this._fire('music', () => {
      this.audio.music(theme);
      this.audio.setIntensity(base.epic ? 0.12 : 0);
    });
    if (resume) {
      this._updateIntensity(game.lastMove);
      this._saveGame();
    }

    if (intro && !resume) {
      const p = this._guard('playGameStart', () => this.director.playGameStart({ variant, players: this.players, epic: base.epic, mode: base.mode, bottomColor: this.bottomColor }));
      await this._cinematic(p);
      if (token !== this.token) return;
      this._checkSync('start');
    }
    this._schedule(token);
  }

  /** Continue an autosaved game (F8): `save` comes from readSave() (validated Game inside). */
  resumeGame(save) {
    if (!save || !save.game || !save.cfg) return Promise.resolve(false);
    return this.startGame({ ...save.cfg }, { resume: save, intro: false }).then(() => true);
  }

  /** Cancel whatever runs now (AI, hint, cinematic, effects). Does not touch the game object. */
  _abortCurrent() {
    this._fire('ai.cancel', () => this.ai.cancel());
    this._hintSeq++;
    this._hintPending = false;
    this._drawThinking = false;
    this._skipGuard = null;
    const d = this.director;
    this._fire('director.skip', () => d.busy && d.skip());
    this._fire('fx.clear', () => this.fx && this.fx.clear());
    this._flushWaiters();
    this.sel = null;
    clearTimeout(this._statusTimer);
    try {
      this.renderer.highlights.clear(true);
    } catch (e) {
      /* ignore */
    }
    try {
      this.hud.setThinking(1, false);
      this.hud.setThinking(-1, false);
      this.hud.setSkippable(false);
    } catch (e) {
      /* ignore */
    }
  }

  /** Leave the game (menu): cancel AI, stop cinematics/effects, hide the board, menu music. */
  stopGame() {
    const wasActive = this.active;
    // leaving a running game abandons it (a finished game dropped its save already)
    if (wasActive) this._dropSave();
    this.token++;
    this.active = false;
    this.paused = false;
    this.phase = 'idle';
    this._drawOffer = null;
    this._abortCurrent();
    // stop any cinematic's further board / screen writes (VS screen, captions …) over the menus
    this._directorReset(null);
    this._fire('fx.clear', () => this.fx && this.fx.clear());
    try {
      this.renderer.camera.snap();
      this.renderer.setTurnGlow(null);
    } catch (e) {
      /* ignore */
    }
    this._showBoard(false);
    this._resetHudCinematic();
    this._stopIdleTimer();
    this._updateWake();
    if (wasActive || (this.audio && this.audio.currentTrack !== 'menu')) {
      this._fire('music', () => {
        this.audio.setIntensity(0);
        this.audio.music('menu');
      });
    }
  }

  rematch() {
    if (!this.baseCfg) return;
    this.startGame(this.baseCfg);
  }

  // =================================================================== turn loop
  async _advance(token) {
    if (token !== this.token || !this.game || !this.active) return;
    const g = this.game;
    try {
      this._refreshHud();
      if (g.result) {
        await this._finish(token);
        return;
      }
      const turn = g.state.turn;
      this._fire('setTurnGlow', () => this.renderer.setTurnGlow(turn));
      if (this._isHuman(turn)) this._humanTurn(token);
      else await this._aiTurn(token);
    } catch (e) {
      this._logError('advance', e);
      // try to keep the game alive: re-sync and retry once a little later
      this._resync();
      if (!this._advanceRetry || this._advanceRetry < 3) {
        this._advanceRetry = (this._advanceRetry || 0) + 1;
        setTimeout(() => this._advance(token), 300);
      }
    }
  }

  _humanTurn(token) {
    const g = this.game;
    this._advanceRetry = 0;
    this.phase = 'human';
    this.sel = null;
    this._lastActivity = this._now();
    const moves = g.moves;
    this._mustCapture = moves.some((m) => m.captures.length > 0);
    this._selectable = new Set(moves.map((m) => m.path[0]));
    this._statusKind = '';
    this._paintSelection();
    const turn = g.state.turn;
    this.hud.setThinking(turn, false);
    this.hud.setCanHint(true);
    this.hud.setCanUndo(this._canUndo());
    // MUX-09: a mandatory capture is announced before the player tries a quiet move
    this._setTurnStatus();
    const mustCapture = this._mustCapture;
    this._fire('playTurn', () => this.director.playTurn({ color: turn, isHuman: true, players: this.players, mustCapture }));
    // a single piece that must capture: pick it up right away
    if (this._mustCapture && this._selectable.size === 1 && token === this.token) {
      this._select(moves[0].path[0], { silent: true, auto: true });
    }
    // a draw offer made while the AI was busy is answered now (RTR-02)
    if (this._drawOffer && this.mode === 'ai') this._evalDrawOffer(token);
  }

  async _aiTurn(token) {
    const g = this.game;
    this._advanceRetry = 0;
    this.phase = 'ai';
    const color = g.state.turn;
    const player = this.players[color] || {};
    this.hud.setThinking(color, true);
    this.hud.setThinking(-color, false);
    this.hud.setCanHint(false);
    this.hud.setCanUndo(this._canUndo());
    const t0 = now();
    const opts = { level: player.level || this.cfg.level, historyHashes: g.hashes };
    if (this.fast) opts.timeMs = 40;
    const think = () =>
      this.ai.think(g.state, opts).then(null, (e) => {
        this._logError('ai.think', e);
        return null;
      });
    const turnP = this._guard('playTurn', () => this.director.playTurn({ color, isHuman: false, players: this.players }));
    let r = await think();
    if (token !== this.token) return;
    if (!r) {
      // superseded by something that is not ours (should not happen) — ask again once
      r = await think();
      if (token !== this.token) return;
    }
    await Promise.race([turnP, sleep(this.fast ? 0 : TURN_BANNER_WAIT_MS * textTimeOf(this.settings))]);
    const minDelay = this.fast ? 0 : aiMinDelay(this.settings, this.mode);
    const rest = minDelay - (now() - t0);
    if (rest > 0) await sleep(rest);
    if (token !== this.token) return;
    await this._waitUnpaused();
    if (token !== this.token) return;
    this.hud.setThinking(color, false);
    const moves = g.moves;
    let move = r && r.path ? findMove(moves, r.path) : null;
    if (!move) {
      if (!moves.length) {
        this._schedule(token);
        return;
      }
      this._logError('ai', new Error(`AI returned no usable move (${r ? JSON.stringify(r.path) : 'null'}); playing the first legal move`));
      move = moves[0];
    }
    const display = r && r.path ? routeMove(move, r.path, g.state.size) : move;
    await this._playMove(move, display, token);
    if (token !== this.token) return;
    this._schedule(token);
  }

  /** Plays `move` on the Game, animates `display` (same move, maybe another equivalent route). */
  async _playMove(move, display, token, { human = false, tapped = 0 } = {}) {
    const g = this.game;
    this.phase = 'animating';
    this._hintSeq++;
    this._clearInputHighlights();
    clearTimeout(this._statusTimer);
    this.hud.setCanUndo(false);
    this.hud.setCanHint(false);
    const mover = g.state.turn;
    const before = g.state;
    this._statsHist.push(cloneStats(this.stats));
    try {
      g.play(move);
    } catch (e) {
      this._statsHist.pop();
      this._logError('game.play', e);
      this._resync();
      return;
    }
    this.movesPlayed++;
    this._saveGame();
    const after = g.state;
    const shown = display || move;
    // MUX-01: the rest of the player's own tap sequence must not skip their cinematic
    this._skipGuard = human ? { at: this._now(), last: this._now(), rest: shown.path.slice(Math.max(1, tapped)) } : null;
    const statsForDirector = cloneStats(this.stats);
    statsForDirector.moveNumber = Math.ceil(g.history.length / 2);
    const p = this._guard('playMove', () =>
      this.director.playMove({
        move: shown,
        before,
        after,
        mover,
        moverIsHuman: this._isHuman(mover),
        names: this.players,
        stats: statsForDirector,
      }),
    );
    this._anim = p;
    await this._cinematic(p);
    if (this._anim === p) this._anim = null;
    if (human) this._skipGuard = null;
    if (token !== this.token) return;
    applyMoveStats(this.stats, move, mover, this.game.history.length);
    try {
      this.renderer.highlights.setLastMove(shown.path);
    } catch (e) {
      /* ignore */
    }
    this._checkSync('move');
    this._updateIntensity(move);
    this._refreshHud();
    this._drawWarnings();
  }

  /** MUX-20 / RTR-05: warn before a repetition or a move-limit draw ends the game. */
  _drawWarnings() {
    const g = this.game;
    if (!g || g.result) return;
    const ply = g.history.length;
    let msg = null;
    let key = null;
    try {
      if (typeof g.repetitionCount === 'function' && g.repetitionCount() === 2) {
        key = `rep:${ply}`;
        msg = text('status.repetitionWarn');
      } else if (typeof g.drawProgress === 'function') {
        const dp = g.drawProgress();
        if (dp && dp.movesLeft > 0 && dp.movesLeft <= 3) {
          key = `dp:${dp.rule}:${dp.movesLeft}`;
          msg = text('status.drawSoon', { n: dp.movesLeft, count: dp.movesLeft });
        }
      }
    } catch (e) {
      this._logError('draw warning', e);
      return;
    }
    if (!msg || key === this._lastWarn) return;
    this._lastWarn = key;
    this._fire('hud.toast', () => this.hud.toast(msg, { tone: 'info', epic: this.epic }));
  }

  _updateIntensity(move) {
    if (!this.epic) return;
    const st = this.stats;
    const hype = Math.max(st.hype[1], st.hype[-1]);
    let x = 0.15 + 0.6 * hype;
    if (move && move.captures.length) x += 0.12 * Math.min(3, move.captures.length);
    x = Math.max(0, Math.min(1, x));
    this._intensity = x;
    this._fire('setIntensity', () => this.audio.setIntensity(x));
  }

  _canUndo() {
    const g = this.game;
    if (!g || !this.active || this.mode === 'demo' || g.result || this._drawThinking) return false;
    if (this.phase === 'animating' || this.phase === 'intro' || this.phase === 'over') return false;
    if (this.mode === 'pvp') return g.history.length > 0;
    return g.history.some((h) => h.before.turn === this.humanColor);
  }

  _refreshHud() {
    const g = this.game;
    if (!g) return;
    const hud = this.hud;
    try {
      const m = materialCount(g.state);
      const st = this.stats;
      const off = this._capOffset || { 1: 0, '-1': 0 };
      hud.setCounts({ pieces: { 1: m.wm + m.wk, '-1': m.bm + m.bk }, captured: { 1: st.captures[1] + off[1], '-1': st.captures[-1] + off[-1] } });
      hud.setTurn(g.result ? 0 : g.state.turn);
      hud.setHype(1, st.hype[1]);
      hud.setHype(-1, st.hype[-1]);
      hud.setCanUndo(this._canUndo());
      hud.setCanHint(this.phase === 'human' && this.mode !== 'demo' && !this._drawThinking);
    } catch (e) {
      this._logError('hud', e);
    }
  }

  // =================================================================== status line
  /** The turn's status text: «Твой ход — бей!» when a capture is mandatory, else the HUD default. */
  _setTurnStatus() {
    clearTimeout(this._statusTimer);
    const kind = this.phase === 'human' && this._mustCapture ? 'capture' : 'turn';
    if (kind === this._statusKind) return;
    this._statusKind = kind;
    try {
      if (kind === 'capture') this.hud.setStatus(text('status.yourTurnCapture'), { tone: 'alert' });
      else this.hud.setStatus('');
    } catch (e) {
      /* ignore */
    }
  }

  /** An explanation in the status line; it falls back to the turn status after a while. */
  _explain(msg, tone) {
    clearTimeout(this._statusTimer);
    this._statusKind = 'explain';
    try {
      this.hud.setStatus(msg, { tone });
    } catch (e) {
      /* ignore */
    }
    const token = this.token;
    this._statusTimer = setTimeout(() => {
      if (token === this.token && this.phase === 'human' && this._statusKind === 'explain') this._setTurnStatus();
    }, STATUS_RESET_MS * textTimeOf(this.settings));
    if (this._statusTimer && typeof this._statusTimer.unref === 'function') this._statusTimer.unref();
  }

  // =================================================================== consistency
  /** Compares the renderer's piece map with the engine state; re-syncs on mismatch. */
  _checkSync(tag) {
    const g = this.game;
    const r = this.renderer;
    if (!g) return true;
    const st = g.state;
    const n = st.size;
    const bad = [];
    for (let sq = 0; sq < n * n; sq++) {
      const code = st.board[sq];
      const v = r.pieceAt(sq);
      if (!code) {
        if (v) bad.push(sq);
      } else if (!v || v.color !== sign(code) || !!v.isKing !== (Math.abs(code) === 2)) bad.push(sq);
    }
    if (!bad.length) return true;
    this.mismatches++;
    const msg = `[controller] renderer/state mismatch after ${tag} (ply ${g.history.length}) at squares ${bad.join(',')}`;
    if (this.debug) console.error(msg);
    else console.warn(msg);
    this._resync();
    return false;
  }

  _resync() {
    const g = this.game;
    if (!g) return;
    try {
      this.renderer.setPosition(g.state);
      this._directorReset(g.state);
    } catch (e) {
      console.error('[controller] re-sync failed', e);
    }
  }

  // =================================================================== input
  /**
   * Any tap on the canvas: skips a running cinematic (MUX-01: except the taps that still belong
   * to the player's own move entry — the remaining landing squares of the move just committed,
   * and anything within SKIP_GRACE_MS of the commit / of such a tap).
   */
  _onTap(e) {
    if (!this.active) return;
    this.noteActivity();
    const d = this.director;
    if (!d || !d.busy) return;
    if (this._entryTap(e)) return;
    this._skipGuard = null;
    this._fire('director.skip', () => d.skip());
  }

  /**
   * Does this tap belong to the move entry that started the running cinematic? The player taps
   * the remaining landing squares where they were on screen before the camera moved, so a tap
   * counts when it is on such a square now (e.sq) or near its resting position.
   */
  _entryTap(e) {
    const gd = this._skipGuard;
    if (!gd) return false;
    const tNow = this._now();
    if (tNow - gd.last < SKIP_GRACE_MS) return true;
    if (!e || tNow - gd.last >= ENTRY_TAP_GAP_MS || !gd.rest.length) return false;
    const r = this.renderer;
    const near = (sq) => {
      if (e.sq === sq) return true;
      try {
        const c = r.squareCenter(sq); // world coords = screen coords with the camera at rest
        return Number.isFinite(e.x) && Math.hypot(e.x - c.x, e.y - c.y) <= 0.75 * r.squareSize;
      } catch (err) {
        return false;
      }
    };
    const i = gd.rest.findIndex(near);
    if (i < 0) return false;
    gd.rest = gd.rest.slice(i + 1);
    gd.last = tNow;
    return true;
  }

  _onSquareTap(sq) {
    if (!this.active || this.phase !== 'human' || this.paused || this._drawThinking) return;
    try {
      this._handleSquare(sq);
    } catch (e) {
      this._logError('input', e);
      this.sel = null;
      this._paintSelection();
    }
  }

  /** The only piece whose capture lands on `sq` first (a tap on a red capture ring), or -1. */
  _landingOwner(sq) {
    const froms = new Set();
    for (const m of this.game.moves) {
      if (!m.captures.length) continue;
      for (const p of [m.path].concat(m.alts || [])) if (p[1] === sq) froms.add(p[0]);
    }
    return froms.size === 1 ? froms.values().next().value : -1;
  }

  _handleSquare(sq) {
    const g = this.game;
    const moves = g.moves;
    const turn = g.state.turn;
    const code = g.state.board[sq];
    const own = code !== 0 && sign(code) === turn;
    const sel = this.sel;
    if (!sel) {
      if (own && this._selectable.has(sq)) this._select(sq);
      else if (!own && this._mustCapture && this._landingOwner(sq) >= 0) {
        // a tap on a capture landing ring: pick up the capturing piece and take that hop
        this._select(this._landingOwner(sq), { silent: true });
        this._handleSquare(sq);
      } else if (own || this._mustCapture) this._illegal(sq);
      return;
    }
    const prefix = sel.prefix;
    const k = prefix.length;
    const opts = movesWithPrefix(moves, prefix);
    // 1) next landing square of the partial path
    const nexts = new Set();
    for (const o of opts) if (o.path.length > k) nexts.add(o.path[k]);
    if (nexts.has(sq)) {
      this._extend(sq);
      return;
    }
    // 2) a final destination that identifies exactly one move
    const finals = opts.filter((o) => o.path[o.path.length - 1] === sq);
    const fm = uniqueMoves(finals);
    if (fm.length === 1) {
      this._commitHuman(fm[0], finals[0].path, finals[0].path.length);
      return;
    }
    // 3) tapping the end of the partial path finishes a move that may stop there
    if (k > 1 && sq === prefix[k - 1]) {
      const exact = opts.find((o) => o.path.length === k);
      if (exact) this._commitHuman(exact.move, exact.path, k);
      return;
    }
    // 4) own pieces: reselect / deselect / restart the path
    if (sq === sel.from) {
      if (k > 1 || sel.auto) {
        // restart the path (an auto-selected forced piece stays selected)
        this.sel = { from: sq, prefix: [sq], auto: sel.auto };
        this._paintSelection();
        this._fire('playSelect', () => this.director.playSelect(sq));
      } else this._deselect();
      return;
    }
    if (own && this._selectable.has(sq)) {
      this._select(sq);
      return;
    }
    this._illegal(sq);
  }

  _select(sq, { silent = false, auto = false } = {}) {
    this.sel = { from: sq, prefix: [sq], auto };
    this._paintSelection();
    if (!silent || this.epic) this._fire('playSelect', () => this.director.playSelect(sq));
    if (this._statusKind === 'explain') this._setTurnStatus();
  }

  _deselect() {
    this.sel = null;
    this._paintSelection();
    this._fire('playDeselect', () => this.director.playDeselect());
  }

  _extend(sq) {
    const g = this.game;
    const prefix = this.sel.prefix.concat(sq);
    const opts = movesWithPrefix(g.moves, prefix);
    const distinct = uniqueMoves(opts);
    if (distinct.length === 1) {
      const exact = opts.find((o) => o.path.length === prefix.length);
      this._commitHuman(distinct[0], exact ? exact.path : opts[0].path, prefix.length);
      return;
    }
    this.sel = { from: this.sel.from, prefix, auto: this.sel.auto };
    this._paintSelection();
    this._sfx('click', { pitch: 1 + Math.min(0.5, prefix.length * 0.08) });
  }

  /** Refused tap: shake + a precise explanation (RO-2 / MUX-02 / MUX-16). */
  _illegal(sq) {
    this._fire('playIllegal', () => this.director.playIllegal(sq));
    let reason = null;
    const sel = this.sel;
    try {
      reason = illegalTapReason(this.game.state, this.game.moves, sq, sel && sel.prefix.length === 1 ? sel.from : -1);
    } catch (e) {
      reason = this._mustCapture ? 'mustCapture' : null;
    }
    if (!reason) return;
    const msg = reason === 'mustCapture' ? text('status.mustCapture', null, ['hud.mustCapture']) : text(`status.${reason}`);
    this._explain(msg, reason === 'noMovesForPiece' ? 'info' : 'alert');
  }

  async _commitHuman(move, path, tapped = 0) {
    if (this.phase !== 'human' || !this.game) return;
    const token = this.token;
    const display = routeMove(move, path, this.game.state.size);
    this.sel = null;
    if (this._hintPending) {
      this._hintPending = false;
      this._fire('ai.cancel', () => this.ai.cancel());
    }
    await this._playMove(move, display, token, { human: true, tapped });
    if (token !== this.token) return;
    this._schedule(token);
  }

  /** Every capture landing reachable first (MUX-09: shown as red rings while nothing is selected). */
  _captureLandings() {
    const out = [];
    for (const m of this.game.moves) {
      if (!m.captures.length) continue;
      for (const p of [m.path].concat(m.alts || [])) if (!out.includes(p[1])) out.push(p[1]);
    }
    return out;
  }

  /** Selectable rings / selected piece / targets / partial path for the current input state. */
  _paintSelection() {
    const hl = this.renderer.highlights;
    const show = this.settings.showMoves !== false;
    const human = this.phase === 'human';
    try {
      // (the capture flag is a hint for the renderer to tint forced capturers; older ones ignore it)
      hl.setSelectable(human && show ? Array.from(this._selectable) : [], { capture: human && this._mustCapture });
      const sel = this.sel;
      if (!human || !sel) {
        hl.setSelected(-1);
        if (human && show && this._mustCapture) hl.setTargets(this._captureLandings(), { capture: true });
        else hl.setTargets([]);
        hl.setPath(null);
        return;
      }
      hl.setSelected(sel.from);
      const opts = movesWithPrefix(this.game.moves, sel.prefix);
      const k = sel.prefix.length;
      const nexts = [];
      for (const o of opts) if (o.path.length > k && !nexts.includes(o.path[k])) nexts.push(o.path[k]);
      const capture = opts.some((o) => o.move.captures.length > 0);
      hl.setTargets(show ? nexts : [], { capture });
      hl.setPath(k > 1 ? sel.prefix : null);
    } catch (e) {
      this._logError('highlights', e);
    }
  }

  _clearInputHighlights() {
    const hl = this.renderer.highlights;
    this.sel = null;
    try {
      hl.setSelectable([]);
      hl.setSelected(-1);
      hl.setTargets([]);
      hl.setPath(null);
      hl.setHint(null);
    } catch (e) {
      /* ignore */
    }
  }

  // =================================================================== actions
  async undo() {
    const g = this.game;
    if (!g || this._undoing || !this._canUndo()) return false;
    this._undoing = true;
    const token = ++this.token;
    try {
      this._abortCurrent();
      if (this._anim) await Promise.race([this._anim, sleep(3000)]);
      if (token !== this.token) return false;
      if (this.mode === 'ai') {
        let guard = 0;
        do {
          if (!g.undo()) break;
          if (this._statsHist.length) this.stats = this._statsHist.pop();
        } while (g.history.length && g.state.turn !== this.humanColor && ++guard < 8);
      } else {
        if (g.undo() && this._statsHist.length) this.stats = this._statsHist.pop();
      }
      this.phase = 'idle';
      this._drawOffer = null;
      this._resync();
      const last = g.lastMove;
      this.renderer.highlights.setLastMove(last ? last.path : null);
      this._sfx('undo');
      this._updateIntensity(null);
      this._saveGame();
    } catch (e) {
      this._logError('undo', e);
      this._resync();
    } finally {
      this._undoing = false;
    }
    this._refreshHud();
    this._schedule(token);
    return true;
  }

  async hint() {
    const g = this.game;
    if (!g || this.phase !== 'human' || this.mode === 'demo' || this._hintPending || this._drawThinking) return false;
    const token = this.token;
    const seq = ++this._hintSeq;
    this._hintPending = true;
    this.hud.setCanHint(false);
    const opts = { historyHashes: g.hashes };
    if (this.fast) opts.timeMs = 80;
    let r = null;
    try {
      r = await this.ai.hint(g.state, opts);
    } catch (e) {
      this._logError('ai.hint', e);
    }
    if (seq !== this._hintSeq || token !== this.token || this.phase !== 'human') return false;
    this._hintPending = false;
    this.hud.setCanHint(true);
    if (!r || !r.path) {
      this.hud.toast(text('toast.hintNone', null, ['hud.hintNone']));
      return false;
    }
    try {
      this.renderer.highlights.setHint(r.path);
    } catch (e) {
      /* ignore */
    }
    await this._guard('playHint', () => this.director.playHint(r.path));
    return r.path;
  }

  resign(payload) {
    const g = this.game;
    if (!g || !this.active || g.result) return;
    const p = payload || {};
    const color = isColor(p.color) ? p.color : this.mode === 'ai' ? this.humanColor : g.state.turn;
    const token = ++this.token;
    this._abortCurrent();
    try {
      g.resign(color);
    } catch (e) {
      this._logError('resign', e);
      return;
    }
    this._schedule(token);
  }

  /**
   * Draw offer. pvp: { accepted } from the two-player dialog. vs AI ({ vsAI: true } or mode 'ai'):
   * the AI answers after a short search (RTR-02) — on the player's turn, so it never interrupts
   * its own thinking.
   */
  offerDraw(payload) {
    const g = this.game;
    if (!g || !this.active || g.result) return;
    const p = payload || {};
    if (this.mode === 'ai') {
      if (this._drawOffer) return; // already being considered
      this._drawOffer = { ply: g.history.length };
      if (this.phase === 'human') this._evalDrawOffer(this.token);
      return;
    }
    if (this.mode !== 'pvp' || p.accepted === false) return;
    this._agreeDraw();
  }

  _agreeDraw() {
    const g = this.game;
    const token = ++this.token;
    this._abortCurrent();
    g.agreeDraw();
    this._schedule(token);
  }

  /** The AI's answer to a draw offer: a ~400 ms level-3 search from its point of view. */
  async _evalDrawOffer(token) {
    const g = this.game;
    if (!this._drawOffer || this._drawThinking || !g || g.result) return;
    const ply = g.history.length;
    const aiColor = -this.humanColor;
    let accept = false;
    const decided = this._drawDecision;
    if (Math.ceil(ply / 2) < DRAW_MIN_MOVE) accept = false;
    else if (decided && decided.ply === ply && decided.game === g) accept = decided.accept;
    else {
      this._drawThinking = true;
      this.hud.setThinking(aiColor, true);
      this.hud.setCanHint(false);
      this.hud.setCanUndo(false);
      let r = null;
      try {
        r = await this.ai.think(g.state, { level: 3, timeMs: this.fast ? 80 : 400, historyHashes: g.hashes });
      } catch (e) {
        this._logError('draw offer', e);
      }
      this._drawThinking = false;
      if (token !== this.token || this.game !== g || g.history.length !== ply || this.phase !== 'human') {
        this._drawOffer = null;
        return; // the position changed meanwhile: the offer lapses
      }
      this.hud.setThinking(aiColor, false);
      this._refreshHud();
      if (r && Number.isFinite(r.score)) {
        // search scores are from the side to move's point of view (100 = a man)
        const aiScore = g.state.turn === aiColor ? r.score : -r.score;
        accept = aiScore <= DRAW_ACCEPT_MAX;
      }
      this._drawDecision = { ply, game: g, accept };
    }
    this._drawOffer = null;
    if (!accept) {
      this._fire('hud.toast', () => this.hud.toast(text('toast.drawDeclinedAi'), { epic: this.epic }));
      return;
    }
    this._fire('hud.toast', () => this.hud.toast(text('toast.drawAcceptedAi'), { epic: this.epic }));
    this._agreeDraw();
  }

  onPause() {
    if (!this.active) return;
    this.paused = true;
    const d = this.director;
    this._fire('director.skip', () => d.busy && d.skip());
    this._saveGame();
    this._updateWake();
  }

  onResume() {
    this.paused = false;
    this._flushWaiters();
    this.noteActivity();
    this._updateWake();
  }

  /** The whole app went to the background / came back (native pause / resume). */
  onAppPause(paused) {
    this.appPaused = !!paused;
    if (paused) this._saveGame();
    this._updateWake();
  }

  /** Android back: let the UI handle it (pause menu in game, previous screen, overlays). */
  handleBack() {
    try {
      return this.ui.handleBack();
    } catch (e) {
      this._logError('back', e);
      return true;
    }
  }

  /** Effective graphics quality: renderer + FX (the UI class is app-perf's business). */
  setQuality(q) {
    if (!['high', 'medium', 'low'].includes(q)) return;
    this.quality = q;
    const r = this.renderer;
    if (r && r.quality !== q) this._fire('renderer.setQuality', () => r.setQuality(q));
    const fx = this.fx;
    if (fx && fx.quality !== q) this._fire('fx.setQuality', () => fx.setQuality(q));
  }

  /**
   * Applies the live settings object to every module (boot and every UI 'settings' event; the
   * settings contract). Idempotent and cheap: modules re-read what they need.
   *  - renderer / FX / Director applySettings (when they have it),
   *  - haptics gate for every vibrate() (native.setHaptics), legacy `vibration` kept in sync,
   *  - audio volumes, language,
   *  - the player's name and energy colour (HUD, VS screen, captions, pieces),
   *  - frame budget + quality (app-perf), board hints (showMoves).
   */
  applySettings(st) {
    if (!st || typeof st !== 'object') st = this.settings;
    if (!st) return;
    const haptics = hapticsOf(st);
    if (st.vibration !== (haptics !== 'off')) st.vibration = haptics !== 'off';
    const call = (label, obj, fn) => {
      if (obj && typeof obj[fn] === 'function') this._fire(label, () => obj[fn](st));
    };
    call('renderer.applySettings', this.renderer, 'applySettings');
    call('fx.applySettings', this.fx, 'applySettings');
    call('director.applySettings', this.director, 'applySettings');
    this._fire('native.setHaptics', () => this.native && typeof this.native.setHaptics === 'function' && this.native.setHaptics(haptics));
    this._fire('volumes', () => {
      const a = this.audio;
      if (!a) return;
      if (Number.isFinite(st.sfxVolume)) a.setSfxVolume(st.sfxVolume);
      if (Number.isFinite(st.musicVolume)) a.setMusicVolume(st.musicVolume);
      if ('muted' in st) a.setMuted(!!st.muted);
    });
    const langChanged = !!st.lang && st.lang !== this._lang;
    if (langChanged) {
      this._lang = st.lang;
      this._fire('fx.setLang', () => this.fx && this.fx.setLang(st.lang));
      this._fire('director.setLang', () => typeof this.director.setLang === 'function' && this.director.setLang(st.lang));
    }
    // player names (language, settings.playerName) — the objects are shared with the HUD / Director
    if (this.active && this.players) {
      const fresh = this._makePlayers();
      const changed = [1, -1].some((c) => fresh[c].name !== this.players[c].name || fresh[c].title !== this.players[c].title);
      if (changed || langChanged) {
        Object.assign(this.players[1], fresh[1]);
        Object.assign(this.players[-1], fresh[-1]);
        this._fire('hud.refresh', () => typeof this.hud.refresh === 'function' && this.hud.refresh());
      }
      if (langChanged && this.phase === 'human') {
        this._statusKind = '';
        this._setTurnStatus();
      }
    }
    this._applySideColors();
    // frame budget + quality last: other modules' applySettings may have touched the renderer
    if (this.perf && typeof this.perf.applySettings === 'function') this._fire('perf.applySettings', () => this.perf.applySettings(st));
    if (this.active && this.phase === 'human') this._paintSelection();
  }

  /** settings.playerColor → the two sides' energy colours (renderer is the single source). */
  _applySideColors() {
    const r = this.renderer;
    if (!r || typeof r.setSideColors !== 'function') return;
    const st = this.settings || {};
    const mode = this.active ? this.mode : 'pvp'; // menus: the player's colour on WHITE
    const colors = sideColors({ playerColor: st.playerColor, mode, humanColor: this.humanColor });
    const key = colors ? `${colors[1]}|${colors[-1]}` : 'default';
    if (key === this._sideColorsKey) return;
    this._sideColorsKey = key;
    this._fire('renderer.setSideColors', () => r.setSideColors(colors));
  }

  // =================================================================== game over
  async _finish(token) {
    const g = this.game;
    this.phase = 'over';
    this._drawOffer = null;
    this._fire('ai.cancel', () => this.ai.cancel());
    this._clearInputHighlights();
    clearTimeout(this._statusTimer);
    const hud = this.hud;
    try {
      hud.setThinking(1, false);
      hud.setThinking(-1, false);
      hud.setCanUndo(false);
      hud.setCanHint(false);
      hud.setTurn(0);
    } catch (e) {
      /* ignore */
    }
    if (this._anim) await Promise.race([this._anim, sleep(3000)]);
    if (token !== this.token) return;
    const result = g.result;
    this._dropSave();
    this._updateWake();
    const humanColor = this.mode === 'ai' ? this.humanColor : 0;
    const winner = result.winner;
    const outcome = !winner ? 'draw' : this.mode === 'ai' ? (winner === this.humanColor ? 'win' : 'loss') : 'win';
    const finalStats = cloneStats(this.stats);

    // stats + records right away (F1): leaving from a pause menu opened at the end cannot lose them
    // (StatsStore counts ai games fully; pvp/demo separately)
    const me = this.mode === 'ai' ? this.humanColor : winner || WHITE;
    const durationSec = Math.max(0, Math.round((Date.now() - this.startedAt) / 1000));
    const summary = {
      variantId: this.cfg.variantId,
      mode: this.mode,
      epic: this.epic,
      giveaway: !!this.cfg.giveaway,
      result: outcome,
      level: this.cfg.level,
      moves: Math.ceil(g.history.length / 2),
      captures: this.stats.captures[me],
      maxCombo: this.stats.maxCombo[me],
      kingsMade: this.stats.kingsMade[me],
      piecesLost: this.stats.piecesLost[me],
      durationSec,
    };
    let records = { newRecords: [], newTitles: [] };
    try {
      records = this.statsStore.record(summary) || records;
    } catch (e) {
      this._logError('stats.record', e);
    }
    this.lastSummary = summary;
    this.lastRecords = records;

    // F1: a game that ended under the pause menu (its last move's cinematic was skipped by
    // opening it) waits until the menu is closed before the finale and the game-over card
    await this._waitUnpausedUi(token);
    if (token !== this.token) return;

    // resign / agreement interrupted the game (effects were cleared): re-sync pieces + king auras
    if (this._checkSync('final') && (result.reason === 'resign' || result.reason === 'agreement')) this._directorReset(g.state);
    this._fire('music', () => {
      this.audio.setIntensity(0);
      this.audio.music(outcome === 'loss' ? 'defeat' : outcome === 'win' ? 'victory' : null, { fade: 600 });
    });
    this._fire('setTurnGlow', () => this.renderer.setTurnGlow(winner || null));
    const p = this._guard('playGameOver', () => this.director.playGameOver({ result, humanColor, stats: finalStats, players: this.players }));
    await this._cinematic(p);
    if (token !== this.token) return;
    await this._waitUnpausedUi(token);
    if (token !== this.token) return;

    let choice = 'menu';
    try {
      choice = await this.ui.showGameOver({
        result,
        humanColor,
        mode: this.mode,
        stats: { ...finalStats, moveNumber: summary.moves },
        records,
        epic: this.epic,
        players: this.players,
        giveaway: !!this.cfg.giveaway,
        durationSec,
      });
    } catch (e) {
      this._logError('showGameOver', e);
    }
    if (token !== this.token) return;
    if (choice === 'rematch') this.startGame(this.baseCfg);
    else this.stopGame();
  }

  // =================================================================== testing hooks
  /** Plays a path for the human side to move (tests). Resolves after the animation. */
  async playPath(path) {
    const g = this.game;
    if (!g || this.phase !== 'human') return false;
    const m = findMove(g.moves, path);
    if (!m) return false;
    const token = this.token;
    await this._commitHuman(m, path, path.length);
    return token === this.token || true;
  }

  /** Restart the current game from a text position (tests): "w:..../...." */
  setPositionString(str) {
    const cfg = this.baseCfg || this.cfg;
    if (!cfg) return false;
    const st = stateFromString(cfg.variantId, str, { giveaway: !!cfg.giveaway || /\|giveaway$/.test(str) });
    return this.startGame({ ...cfg, humanColor: this.cfg ? this.cfg.humanColor || cfg.humanColor : cfg.humanColor }, { startState: st, intro: false });
  }

  snapshot() {
    const g = this.game;
    return {
      active: this.active,
      phase: this.phase,
      mode: this.mode,
      screen: this.ui.currentScreen,
      variantId: this.cfg ? this.cfg.variantId : null,
      epic: this.epic,
      humanColor: this.humanColor,
      bottomColor: this.bottomColor,
      turn: g ? g.state.turn : 0,
      ply: g ? g.history.length : 0,
      result: g ? g.result : null,
      position: g ? stateToString(g.state) : null,
      legal: g && !g.result ? g.moves.map((m) => m.path) : [],
      selected: this.sel ? this.sel.prefix.slice() : null,
      busy: !!this.director.busy,
      thinking: !!this.ai.busy,
      paused: this.paused,
      canUndo: this._canUndo(),
      stats: cloneStats(this.stats),
      mismatches: this.mismatches,
      errors: this.errors.slice(),
      movesPlayed: this.movesPlayed,
      quality: this.quality,
      awake: !!this._awake,
      levels: this.cfg && this.cfg.levels ? { ...this.cfg.levels } : null,
    };
  }
}
