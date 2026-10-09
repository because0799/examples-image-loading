// Controller — the game loop (ARCHITECTURE.md §8). Owns the engine Game, tap input (select →
// multi-step path entry), AI turns, undo / hint / resign / draw, per-game stats + hype, results.
//
//   const c = new Controller({ ui, renderer, fx, director, audio, ai, native, settings, statsStore, opts });
//   c.startGame(GameConfig)        // from the UI 'play' event, rematch or the ?screen=game URL
//   c.stopGame()                   // back to the menus (cancels AI, stops cinematics)
//
// Robustness rules:
//  - every game start / undo / resign / stop bumps `token`; every async step re-checks it, so an
//    AI answer or a cinematic that resolves after the game changed is ignored;
//  - every Director / FX call is guarded (a failing effect never breaks the game): errors are
//    logged, the renderer is re-synced from the engine state and the game continues;
//  - after every move the renderer piece map is compared with the engine state (mismatch →
//    console.error in debug builds + re-sync).

import { WHITE, BLACK, Game, getVariant, findMove, movesWithPrefix, materialCount, stateFromString, stateToString, sqToRc } from './engine/index.js';
import { AI_LEVELS } from './ai/ai-client.js';
import { evaluateState } from './ai/search.js';
import { t, getLang } from './ui/i18n.js';

// Strings the UI i18n table does not have (controller-only messages).
const STR = {
  ru: {
    hintNone: 'Подсказка недоступна',
    drawDeclinedAi: 'ИИ отказывается от ничьей — бьёмся дальше!',
    drawAcceptedAi: 'ИИ принимает ничью',
    recovered: 'Сбой эффекта — позиция восстановлена',
  },
  en: {
    hintNone: 'No hint available',
    drawDeclinedAi: 'The AI declines the draw — fight on!',
    drawAcceptedAi: 'The AI accepts the draw',
    recovered: 'Effect glitch — position restored',
  },
};
const s = (key) => (STR[getLang()] || STR.ru)[key] || key;

// Hype («ЯРОСТЬ») tuning: fills with captures (more for combos), a little when you lose pieces,
// a bit for promotions. At ≥ 1 the next capture is the ULTIMATE and the meter resets.
const HYPE_PER_CAPTURE = 0.22;
const HYPE_COMBO_BONUS = 0.12;
const HYPE_PER_LOSS = 0.06;
const HYPE_PROMOTION = 0.12;

const AI_MIN_DELAY = 450; // perceived thinking time (ms)
const DEMO_MIN_DELAY = 700;
const CINEMATIC_TIMEOUT = 25000; // ticker-time watchdog for a Director promise (hang protection)

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

function freshStats() {
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

function cloneStats(st) {
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
    this._quality = settings.quality;
    this._lang = settings.lang;
    this.startedAt = 0;
    this.mismatches = 0;
    this.errors = [];
    this.movesPlayed = 0;

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
   * Awaits a Director promise: shows the «Пропустить» chip while a cinematic is busy, honours
   * autoSkip (tests), and protects against a promise that never settles (watchdog on ticker time,
   * so a backgrounded / paused app never trips it).
   */
  async _cinematic(promise) {
    this._track(promise);
    const hud = this.hud;
    const d = this.director;
    const clock = this.renderer.clock;
    const t0 = now();
    if (this.autoSkip) this._fire('skip', () => d.busy && d.skip());
    let done = false;
    let poll = 0;
    const tick = () => {
      if (done) return;
      const busy = !!d.busy;
      hud.setSkippable(busy && now() - t0 > 400);
      if (busy && this.autoSkip) this._fire('skip', () => d.skip());
    };
    poll = setInterval(tick, 120);
    const start = clock.realNow;
    try {
      await new Promise((resolve) => {
        const wd = setInterval(() => {
          if (clock.realNow - start > CINEMATIC_TIMEOUT) {
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

  // =================================================================== players
  _makePlayers() {
    const lang = getLang();
    const cfg = this.cfg;
    const colorName = (c) => (c > 0 ? t('common.white') : t('common.black'));
    const mk = (color) => {
      if (this._isHuman(color)) {
        if (this.mode === 'pvp') return { name: colorName(color), isHuman: true, title: t('hud.player'), color };
        let title = colorName(color);
        try {
          const tid = this.statsStore && this.statsStore.currentTitle();
          if (tid) title = t(`title.${tid}.name`);
        } catch (e) {
          /* ignore */
        }
        return { name: t('hud.you'), isHuman: true, title, color };
      }
      const level = Math.min(5, Math.max(1, cfg.level || 3));
      const L = AI_LEVELS[level - 1] || AI_LEVELS[2];
      const name = (cfg.epic ? L.epicName : L.name)[lang] || (cfg.epic ? L.epicName : L.name).ru;
      const title = this.mode === 'demo' ? `${colorName(color)} · ${t('hud.aiLevel', { n: level })}` : t('hud.aiLevel', { n: level });
      return { name, isHuman: false, title, level, kanji: L.kanji, power: L.power, color };
    };
    return { 1: mk(WHITE), '-1': mk(BLACK) };
  }

  // =================================================================== game lifecycle
  /**
   * Start a game. cfg: GameConfig { variantId, mode, humanColor (0 = random), level, epic, giveaway }.
   * opts.startState: optional engine State to start from (tests / ?pos=); opts.intro=false skips
   * the VS cinematic.
   */
  async startGame(cfgIn, { startState = null, intro = true } = {}) {
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
    base.level = Math.min(5, Math.max(1, Math.round(Number(base.level) || 3)));
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

    let human = 0;
    if (base.mode === 'ai') human = base.humanColor === BLACK ? BLACK : base.humanColor === WHITE ? WHITE : Math.random() < 0.5 ? WHITE : BLACK;
    let game;
    try {
      game = new Game(variant.id, { giveaway: base.giveaway }, startState || undefined);
    } catch (e) {
      this._logError('start position', e);
      game = new Game(variant.id, { giveaway: base.giveaway });
    }
    this.game = game;
    // a game started from a position: the HUD «captured» counters start from the missing pieces
    this._capOffset = { 1: 0, '-1': 0 };
    if (startState) {
      const m = materialCount(game.state);
      this._capOffset[1] = Math.max(0, variant.piecesPerSide - (m.bm + m.bk));
      this._capOffset[-1] = Math.max(0, variant.piecesPerSide - (m.wm + m.wk));
    }
    this.cfg = { ...base, humanColor: human, giveaway: game.options.giveaway };
    this.mode = base.mode;
    this.humanColor = human;
    this.bottomColor = base.mode === 'ai' ? human : WHITE;
    this.players = this._makePlayers();
    this.stats = freshStats();
    this._statsHist = [];
    this.startedAt = Date.now();
    this.active = true;
    this.paused = false;
    this.phase = 'intro';
    this.sel = null;
    this._intensity = 0;
    this.movesPlayed = 0;
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
    this._setTheme(theme);
    const r = this.renderer;
    try {
      r.camera.snap();
      r.setVariant(variant, { flipped: this.bottomColor === BLACK });
      r.setBoardRect(ui.boardSlotRect());
      r.setPosition(game.state);
      r.highlights.clear(true);
      r.setTurnGlow(game.state.turn);
    } catch (e) {
      this._logError('renderer setup', e);
    }
    this._showBoard(true);
    this._directorReset(game.state);
    this._refreshHud();
    this._fire('keepScreenOn', () => this.native && this.native.keepScreenOn(true));
    this._fire('music', () => {
      this.audio.music(theme);
      this.audio.setIntensity(base.epic ? 0.12 : 0);
    });

    if (intro) {
      const p = this._guard('playGameStart', () => this.director.playGameStart({ variant, players: this.players, epic: base.epic, mode: base.mode, bottomColor: this.bottomColor }));
      await this._cinematic(p);
      if (token !== this.token) return;
      this._checkSync('start');
    }
    this._schedule(token);
  }

  /** Cancel whatever runs now (AI, hint, cinematic, effects). Does not touch the game object. */
  _abortCurrent() {
    this._fire('ai.cancel', () => this.ai.cancel());
    this._hintSeq++;
    this._hintPending = false;
    const d = this.director;
    this._fire('director.skip', () => d.busy && d.skip());
    this._fire('fx.clear', () => this.fx && this.fx.clear());
    this._flushWaiters();
    this.sel = null;
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
    this.token++;
    this.active = false;
    this.paused = false;
    this.phase = 'idle';
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
    this._fire('keepScreenOn', () => this.native && this.native.keepScreenOn(false));
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
    const moves = g.moves;
    this._mustCapture = moves.some((m) => m.captures.length > 0);
    this._selectable = new Set(moves.map((m) => m.path[0]));
    this._paintSelection();
    const turn = g.state.turn;
    this.hud.setThinking(turn, false);
    this.hud.setCanHint(true);
    this.hud.setCanUndo(this._canUndo());
    this._fire('playTurn', () => this.director.playTurn({ color: turn, isHuman: true, players: this.players }));
    // a single piece that must capture: pick it up right away
    if (this._mustCapture && this._selectable.size === 1 && token === this.token) {
      this._select(moves[0].path[0], { silent: true, auto: true });
    }
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
    await Promise.race([turnP, sleep(this.fast ? 0 : 1500)]);
    const minDelay = this.fast ? 0 : this.mode === 'demo' ? DEMO_MIN_DELAY : AI_MIN_DELAY;
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
  async _playMove(move, display, token) {
    const g = this.game;
    this.phase = 'animating';
    this._hintSeq++;
    this._clearInputHighlights();
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
    const after = g.state;
    const statsForDirector = cloneStats(this.stats);
    statsForDirector.moveNumber = Math.ceil(g.history.length / 2);
    const p = this._guard('playMove', () =>
      this.director.playMove({
        move: display || move,
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
    if (token !== this.token) return;
    this._applyStats(move, mover);
    try {
      this.renderer.highlights.setLastMove((display || move).path);
    } catch (e) {
      /* ignore */
    }
    this._checkSync('move');
    this._updateIntensity(move);
    this._refreshHud();
  }

  _applyStats(move, mover) {
    const st = this.stats;
    const n = move.captures.length;
    st.moveNumber = Math.ceil(this.game.history.length / 2);
    if (n) {
      st.captures[mover] += n;
      st.piecesLost[-mover] += n;
      st.maxCombo[mover] = Math.max(st.maxCombo[mover], n);
      if (st.hype[mover] >= 1) {
        // this capture was the ULTIMATE: the meter is spent
        st.hype[mover] = 0;
        st.ultimates[mover]++;
      } else {
        st.hype[mover] = Math.min(1, st.hype[mover] + HYPE_PER_CAPTURE * n + HYPE_COMBO_BONUS * (n - 1));
      }
      st.hype[-mover] = Math.min(1, st.hype[-mover] + HYPE_PER_LOSS * n);
    }
    if (move.promotion) {
      st.kingsMade[mover]++;
      if (st.hype[mover] < 1) st.hype[mover] = Math.min(1, st.hype[mover] + HYPE_PROMOTION);
    }
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
    if (!g || !this.active || this.mode === 'demo' || g.result) return false;
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
      hud.setCanHint(this.phase === 'human' && this.mode !== 'demo');
    } catch (e) {
      this._logError('hud', e);
    }
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
  _onTap() {
    if (!this.active) return;
    const d = this.director;
    if (d.busy) this._fire('director.skip', () => d.skip());
  }

  _onSquareTap(sq) {
    if (!this.active || this.phase !== 'human' || this.paused) return;
    try {
      this._handleSquare(sq);
    } catch (e) {
      this._logError('input', e);
      this.sel = null;
      this._paintSelection();
    }
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
      else if (own || this._mustCapture) this._illegal(sq);
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
      this._commitHuman(fm[0], finals[0].path);
      return;
    }
    // 3) tapping the end of the partial path finishes a move that may stop there
    if (k > 1 && sq === prefix[k - 1]) {
      const exact = opts.find((o) => o.path.length === k);
      if (exact) this._commitHuman(exact.move, exact.path);
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
    try {
      this.hud.setStatus('');
    } catch (e) {
      /* ignore */
    }
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
      this._commitHuman(distinct[0], exact ? exact.path : opts[0].path);
      return;
    }
    this.sel = { from: this.sel.from, prefix, auto: this.sel.auto };
    this._paintSelection();
    this._sfx('click', { pitch: 1 + Math.min(0.5, prefix.length * 0.08) });
  }

  _illegal(sq) {
    this._fire('playIllegal', () => this.director.playIllegal(sq));
    if (this._mustCapture) {
      try {
        this.hud.setStatus(t('hud.mustCapture'), { tone: 'alert' });
      } catch (e) {
        /* ignore */
      }
    }
  }

  async _commitHuman(move, path) {
    if (this.phase !== 'human' || !this.game) return;
    const token = this.token;
    const display = routeMove(move, path, this.game.state.size);
    this.sel = null;
    if (this._hintPending) {
      this._hintPending = false;
      this._fire('ai.cancel', () => this.ai.cancel());
    }
    await this._playMove(move, display, token);
    if (token !== this.token) return;
    this._schedule(token);
  }

  /** Selectable rings / selected piece / targets / partial path for the current input state. */
  _paintSelection() {
    const hl = this.renderer.highlights;
    const show = this.settings.showMoves !== false;
    const human = this.phase === 'human';
    try {
      hl.setSelectable(human && show ? Array.from(this._selectable) : []);
      const sel = this.sel;
      if (!human || !sel) {
        hl.setSelected(-1);
        hl.setTargets([]);
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
      this._resync();
      const last = g.lastMove;
      this.renderer.highlights.setLastMove(last ? last.path : null);
      this._sfx('undo');
      this._updateIntensity(null);
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
    if (!g || this.phase !== 'human' || this.mode === 'demo' || this._hintPending) return false;
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
      this.hud.toast(s('hintNone'));
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
    const color = p.color === WHITE || p.color === BLACK ? p.color : this.mode === 'ai' ? this.humanColor : g.state.turn;
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

  offerDraw(payload) {
    const g = this.game;
    if (!g || !this.active || g.result) return;
    if (this.mode === 'ai') {
      // the AI accepts only a balanced position after move 20
      let accept = false;
      try {
        const ev = evaluateState(g.state); // White's point of view, 100 = a man
        accept = g.history.length >= 40 && Math.abs(ev) <= 60;
      } catch (e) {
        this._logError('evaluate', e);
      }
      if (!accept) {
        this.hud.toast(s('drawDeclinedAi'), { epic: this.epic });
        return;
      }
      this.hud.toast(s('drawAcceptedAi'));
    } else if (this.mode === 'pvp') {
      if (payload && payload.accepted === false) return;
    } else return;
    const token = ++this.token;
    this._abortCurrent();
    g.agreeDraw();
    this._schedule(token);
  }

  onPause() {
    if (!this.active) return;
    this.paused = true;
    const d = this.director;
    this._fire('director.skip', () => d.busy && d.skip());
  }

  onResume() {
    this.paused = false;
    this._flushWaiters();
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

  applySettings(st) {
    if (!st) return;
    if (st.quality && st.quality !== this._quality) {
      this._quality = st.quality;
      this._fire('renderer.setQuality', () => this.renderer.setQuality(st.quality));
      this._fire('fx.setQuality', () => this.fx && this.fx.setQuality(st.quality));
    }
    this._fire('volumes', () => {
      this.audio.setSfxVolume(st.sfxVolume);
      this.audio.setMusicVolume(st.musicVolume);
      if ('muted' in st) this.audio.setMuted(!!st.muted);
    });
    if (st.lang && st.lang !== this._lang) {
      this._lang = st.lang;
      this._fire('fx.setLang', () => this.fx && this.fx.setLang(st.lang));
      this._fire('director.setLang', () => typeof this.director.setLang === 'function' && this.director.setLang(st.lang));
      if (this.active && this.players) {
        const fresh = this._makePlayers();
        Object.assign(this.players[1], fresh[1]);
        Object.assign(this.players[-1], fresh[-1]);
        this._fire('hud.refresh', () => this.hud.refresh());
      }
    }
    if (this.active && this.phase === 'human') this._paintSelection();
  }

  // =================================================================== game over
  async _finish(token) {
    const g = this.game;
    this.phase = 'over';
    this._fire('ai.cancel', () => this.ai.cancel());
    this._clearInputHighlights();
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
    // resign / agreement interrupted the game (effects were cleared): re-sync pieces + king auras
    if (this._checkSync('final') && (result.reason === 'resign' || result.reason === 'agreement')) this._directorReset(g.state);
    const humanColor = this.mode === 'ai' ? this.humanColor : 0;
    const winner = result.winner;
    const outcome = !winner ? 'draw' : this.mode === 'ai' ? (winner === this.humanColor ? 'win' : 'loss') : 'win';
    this._fire('keepScreenOn', () => this.native && this.native.keepScreenOn(false));
    this._fire('music', () => {
      this.audio.setIntensity(0);
      this.audio.music(outcome === 'loss' ? 'defeat' : outcome === 'win' ? 'victory' : null, { fade: 600 });
    });
    this._fire('setTurnGlow', () => this.renderer.setTurnGlow(winner || null));
    const finalStats = cloneStats(this.stats);
    const p = this._guard('playGameOver', () => this.director.playGameOver({ result, humanColor, stats: finalStats, players: this.players }));
    await this._cinematic(p);
    if (token !== this.token) return;

    // stats + records (StatsStore counts ai games fully; pvp/demo separately)
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
    await this._commitHuman(m, path);
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
    };
  }
}
