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
// game-time animation runs on renderer.clock (slow-mo / hit-stop / skip aware); timings are
// divided by settings.animSpeed. Budgets (real time, animSpeed 1): quiet ≤ 0.6 s, single capture
// ≤ 1.6 s, each extra hop ≤ 1.0 s (+ ≤ 1.5 s finale), promotion ≤ 2.2 s, start ≤ 2.5 s, end ≤ 4 s.

import { wait, tween, animate, Ease } from '../render/tween.js';
import { EPIC, CLASSIC } from '../render/palette.js';
import { mixHex } from '../render/canvas.js';
import { bragLine, attackName, kanjiFor } from './brag.js';
import { caption, turnBanner, versus, hintComet, godrays, pulse } from './director-ui.js';
import { Marks } from './director-marks.js';

const SKIP_SCALE = 5;
const ABORT = { director: 'abort' };

const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const STR = {
  ru: {
    yourTurn: 'ТВОЙ ХОД',
    oppTurn: 'ХОД ПРОТИВНИКА',
    whiteTurn: 'ХОД БЕЛЫХ',
    blackTurn: 'ХОД ЧЁРНЫХ',
    awakening: 'ПРОБУЖДЕНИЕ',
    awakeningSub: 'ДАМКА ВОССТАЛА',
    power: 'УРОВЕНЬ СИЛЫ',
    fight: 'ДА НАЧНЁТСЯ БИТВА!',
    victory: 'ПОБЕДА!',
    flawless: 'БЕЗУПРЕЧНО!',
    defeat: 'ПОРАЖЕНИЕ…',
    draw: 'НИЧЬЯ',
    whiteWins: 'БЕЛЫЕ ПОБЕДИЛИ!',
    blackWins: 'ЧЁРНЫЕ ПОБЕДИЛИ!',
    cWin: 'Победа',
    cLoss: 'Поражение',
    cDraw: 'Ничья',
    cWhite: 'Победа белых',
    cBlack: 'Победа чёрных',
    king: 'Дамка!',
    maxCombo: 'МАКС. КОМБО ×{n}',
    kings: 'ДАМОК: {n}',
    lost: 'ПОТЕРЬ: {n}',
    captures: 'СБИТО: {n}',
    combo: 'КОМБО ×{n}',
    white: 'Белые',
    black: 'Чёрные',
    you: 'Ты',
    ultimate: 'УЛЬТИМЕЙТ · ЯРОСТЬ 100%',
    resign: 'СОПЕРНИК СДАЛСЯ',
    youResign: 'КАПИТУЛЯЦИЯ',
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
    victory: 'VICTORY!',
    flawless: 'PERFECT!',
    defeat: 'DEFEAT…',
    draw: 'DRAW',
    whiteWins: 'WHITE WINS!',
    blackWins: 'BLACK WINS!',
    cWin: 'Victory',
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
    ultimate: 'ULTIMATE · FURY 100%',
    resign: 'OPPONENT RESIGNED',
    youResign: 'SURRENDER',
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
    this._clock.add(this._tick, this);
  }

  // =================================================================== settings
  setMode(mode) {
    this.mode = mode === 'epic' ? 'epic' : 'classic';
    if (this.fx && this.fx.setMode) this.fx.setMode(this.mode);
    this.syncAuras();
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

  get _speed() {
    const s = Number(this.settings && this.settings.animSpeed) || 1;
    return clamp(s, 0.25, 4);
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

  _haptic(name) {
    if (this._skipping || !this.settings || this.settings.vibration === false) return;
    const n = this.native;
    if (!n || typeof n.vibrate !== 'function') return;
    let p = HAPTIC[name];
    if (!p) return;
    if (!this.epic) p = p.slice(0, 3).map((v, i) => (i % 2 ? v : Math.max(8, Math.round(v * 0.45))));
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

  _sideColor(color) {
    return this.epic ? EPIC.side[color] || EPIC.white : CLASSIC.gold;
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

  /** Camera focus 70% of the way from the board centre to p (keeps the board readable). */
  _focus(p, zoom, ms, opts = {}) {
    const r = this.renderer;
    if (this._skipping) return Promise.resolve(false);
    const c = r.boardCenter;
    const k = opts.k != null ? opts.k : 0.7;
    return r.camera.focus(c.x + (p.x - c.x) * k, c.y + (p.y - c.y) * k, zoom, ms, opts.ease || Ease.outCubic, { realtime: !!opts.realtime });
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
    if (this.mode === 'epic') {
      r.forEachPiece((v) => {
        if (v.isKing) want.add(v);
      });
    }
    for (const [v, h] of Array.from(this._auras)) {
      const alive = v.auraLayer && v.auraLayer.children.some((c) => c.label === 'fx-aura' && !c.destroyed);
      if (!want.has(v) || !alive) {
        if (alive) this._try(() => h.stop());
        this._auras.delete(v);
      }
    }
    for (const v of want) {
      if (this._auras.has(v)) continue;
      const col = mixHex(EPIC.side[v.color] || EPIC.gold, EPIC.gold, 0.2);
      const h = this._try(() => fx.aura(v, { color: col, intensity: 0.9 }));
      if (h) this._auras.set(v, h);
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
    return this._run('playMove', async (cx) => {
      const r = this.renderer;
      if (!move || !move.path || move.path.length < 2) return;
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
      if (!r.pieceAt(move.path[0])) {
        // the board drifted (should not happen): show the result right away
        this._ensure(after);
        return;
      }
      this._streak[mover] = m.n ? this._streak[mover] + 1 : 0;
      this._sinceCaption[mover] = (this._sinceCaption[mover] || 0) + 1;
      if (this.epic) await this._epicMove(cx, m);
      else await this._classicMove(cx, m);
    });
  }

  // =================================================================== CLASSIC
  async _classicMove(cx, m) {
    const r = this.renderer;
    const fx = this.fx;
    for (let i = 0; i < m.hops.length; i++) {
      const h = m.hops[i];
      const capture = h.cap >= 0;
      const long = Math.max(0, h.dist - (capture ? 2 : 1));
      const dur = this._t((capture ? 250 : 220) + Math.min(6, long) * 28);
      let fired = false;
      const take = () => {
        if (fired) return;
        fired = true;
        r.removePiece(h.cap, { duration: this._t(340) });
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
    if (m.n >= 3 && fx) fx.comboCounter(m.n, { hold: this._t(900) });
    if (m.n >= 2) this._sfx('combo', { intensity: Math.min(1, m.n / 4) });
    await this._wait(cx, this._t(m.n ? 120 : 50));
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
      this._track(fx.kanji(this._s('king'), P.x, P.y - sz * 0.85, { duration: this._t(mid ? 800 : 1000) }));
    }
    await this._wait(cx, this._t(mid ? 260 : 380));
    if (!mid) await this._await(cx, Promise.race([crown, wait(this._t(400), { clock: this._clock })]));
  }

  // =================================================================== EPIC
  async _epicMove(cx, m) {
    if (!m.n) {
      await this._epicQuiet(cx, m);
    } else {
      if (m.ultimate) await this._epicUltimateIntro(cx, m);
      if (m.n === 1 && m.hops.length === 1) await this._epicSingle(cx, m);
      else await this._epicMulti(cx, m);
    }
    const last = m.hops[m.hops.length - 1];
    if (m.promoAt === m.move.path.length - 1) await this._epicPromote(cx, m, last.to, { short: false });
    else if (!m.n) this._maybeCaption(m, 'quiet');
  }

  /** Quiet move: charge → dash with afterimages + speed lines → impact ring, dust, micro-shake. */
  async _epicQuiet(cx, m) {
    const r = this.renderer;
    const fx = this.fx;
    const h = m.hops[0];
    const view = r.pieceAt(h.from);
    const col = m.col;
    // anticipation: crouch + gather energy
    fx.charge(h.A.x, h.A.y, { color: col, duration: this._t(150), radius: 0.9 });
    if (view) this._squashTo(view, 0.12, this._t(100));
    await this._wait(cx, this._t(105));
    // dash
    this._sfx('dash', { intensity: 0.7, pan: this._pan(h.B.x) });
    this._haptic('move');
    if (view) fx.afterimages(view, { duration: this._t(270), color: col });
    this._track(fx.speedLines({ style: 'dash', angle: h.ang, duration: this._rt(330), density: 0.45 }));
    const long = Math.max(0, h.dist - 1);
    const dur = this._t(clamp(190 + long * 32, 190, 330));
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
    fx.shockwave(h.B.x, h.B.y, { strength: 0.32, radius: 1.15, duration: this._t(380), color: col });
    fx.burst(h.B.x, h.B.y, { kind: 'dust', count: 9 });
    fx.burst(h.B.x, h.B.y, { kind: 'spark', count: 7, color: col, speed: 0.6 });
    fx.shake(0.13, 200);
    this._sfx('land', { intensity: 0.8 });
    this._haptic('land');
    await this._wait(cx, this._t(110));
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

  /** Single capture: lock-on → dash → STRIKE (hit-stop, impact frame, slash, cracks) → shatter. */
  async _epicSingle(cx, m) {
    const r = this.renderer;
    const fx = this.fx;
    const cam = r.camera;
    const h = m.hops[0];
    const view = r.pieceAt(h.from);
    const col = m.col;
    const zoom = this._zoom();
    // 1) lock-on: punch toward the attacker, focus lines, energy gathering, eye-glint
    this._focus({ x: h.A.x * 0.65 + h.V.x * 0.35, y: h.A.y * 0.65 + h.V.y * 0.35 }, zoom * 1.06, this._t(230));
    cam.punch(1.04, 220);
    this._track(fx.focusLines({ focus: h.A, duration: this._rt(m.ultimate ? 300 : 460), density: 0.75 }));
    fx.charge(h.A.x, h.A.y, { color: col, duration: this._t(250), radius: 1.3 });
    fx.burst(h.A.x, h.A.y - r.squareSize * 0.12, { kind: 'stars', count: 2, color: 0xffffff, size: 1.6, life: 0.6 });
    if (view) this._squashTo(view, 0.14, this._t(180));
    this._sfx('charge', { intensity: 0.55, pitch: 1.2 });
    await this._wait(cx, this._t(m.ultimate ? 150 : 240));
    // 2) dash + strike
    if (m.ultimate) {
      fx.slowMo(0.3, this._rt(520), { inMs: 90, outMs: 260 });
      cx.slow = true;
    }
    this._sfx('whoosh', { intensity: 0.9, pan: this._pan(h.V.x) });
    if (view) fx.afterimages(view, { duration: this._t(320), color: col });
    this._track(fx.speedLines({ focus: h.V, duration: this._rt(420), density: 0.75 }));
    this._focus(h.V, zoom * (m.ultimate ? 0.98 : 1.12), this._t(260));
    let corpse = null;
    const dist = Math.max(0, h.dist - 2);
    const p = r.movePiece(h.from, h.to, {
      duration: this._t(300 + Math.min(6, dist) * 30),
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
    for (const s of m.extra) r.removePiece(s, { duration: this._t(250) });
    if (m.ultimate) {
      const scr = r.screen;
      fx.zoomBlur(h.V.x, h.V.y, 0.3, this._rt(480));
      fx.bloomPulse(0.55, this._rt(700));
      fx.rays(h.V.x, h.V.y, { color: EPIC.gold, duration: this._t(1000), size: r.squareSize * 7 });
      this._track(godrays(fx, { duration: this._rt(1400), x: scr.width / 2 }));
      fx.flash(0xffffff, { duration: 220, alpha: 0.3 });
      fx.shake(0.95, 650);
      this._sfx('bigImpact', { intensity: 1 });
      this._sfx('boom', { intensity: 0.8 });
      this._haptic('ultimate');
    }
    if (m.ko) this._ko(m, h.V);
    this._maybeCaption(m, m.ultimate ? 'ultimate' : 'capture');
    await this._wait(cx, this._t(m.ultimate ? 520 : 360));
    this._camResetting = true;
    try {
      await this._await(cx, cam.reset(this._t(300), Ease.inOutCubic));
    } finally {
      this._camResetting = false;
    }
  }

  /** The hit: called when the attacker passes over the victim. Returns the marked stand-in. */
  _strike(m, h, i, { single = false } = {}) {
    const r = this.renderer;
    const fx = this.fx;
    const cam = r.camera;
    const V = h.V;
    const col = m.col;
    const sz = r.squareSize;
    const corpse = this._marks.mark(h.cap, { color: col, victimColor: m.vcol, angle: h.ang });
    if (!this._skipping) {
      fx.hitStop(Math.round((single ? (m.ultimate ? 170 : 115) : 75) / this._speed));
      cam.punch(single ? 1.12 : 1.08, single ? 300 : 240);
      if (single || i === 0) fx.impactFrame({ focus: V, frames: single ? 3 : 2, duration: single ? 130 : 90 });
    }
    const flip = i % 2 === 1;
    fx.slash(V.x, V.y, h.ang + (flip ? 0.62 : -0.62), { color: col, flip, length: single ? 3.4 : 2.8 });
    fx.burst(V.x, V.y, { kind: 'spark', color: col, count: single ? 22 : 16, angle: h.ang, spread: 1.5, speed: 1.1 });
    fx.crack(V.x, V.y, { color: col, size: single ? 2.6 : 2.0 });
    fx.chromatic(single ? 1 : 0.6, this._rt(260));
    fx.shake(single ? 0.5 : 0.38, single ? 420 : 340, { angle: h.ang });
    if (!single) fx.shockwave(V.x, V.y, { strength: 0.7, radius: 2.0, color: col, duration: 480 });
    this._sfx('slash', { intensity: 0.9, pitch: 1 + i * 0.05, pan: this._pan(V.x) });
    this._sfx('impact', { intensity: single ? 1 : 0.75, pitch: 1 + i * 0.04 });
    if (!single) this._sfx('taiko', { intensity: 0.8, pitch: 1 + i * 0.06 });
    this._haptic(single ? 'capture' : 'hit');
    if (!this._skipping) {
      const word = single ? kanjiFor('capture', this._lang) : kanjiFor('hit');
      const side = i % 2 ? 1 : -1;
      const len = Array.from(word).length;
      this._track(
        fx.kanji(word, V.x + (single ? 0 : side * sz * 0.55), V.y - sz * (single ? 0.95 : 0.75), {
          color: col,
          size: single ? this._kanjiSize(word, sz * (len > 3 ? 1.75 : 2.1)) : sz * 1.12,
          duration: single ? this._t(900) : Math.round(620 / this._speed),
          delay: single ? 140 : 50,
          realtime: !single,
        }),
      );
    }
    return corpse;
  }

  /** Explosion at a marked stand-in (removes it). */
  _detonate(m, corpse, { size = 1.1, big = false } = {}) {
    const fx = this.fx;
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
    const cam = r.camera;
    const hops = m.hops;
    const N = hops.length;
    const first = hops[0];
    const view = r.pieceAt(first.from);
    const col = m.col;
    const zoom = this._zoom();
    const corpses = [];
    const slow = m.ultimate ? 0.32 : N >= 6 ? 0.55 : 0.45;
    // combo counter on the side away from the action
    const avgX = hops.reduce((s, h) => s + h.B.x, 0) / N;
    m.comboSide = avgX < r.boardCenter.x ? 'right' : 'left';
    // anticipation (real time, before the slow-mo kicks in)
    this._focus(first.A, zoom * 0.95, this._t(200), { k: 0.58 });
    fx.charge(first.A.x, first.A.y, { color: col, duration: this._t(220), radius: 1.4 });
    if (view) this._squashTo(view, 0.14, this._t(140));
    this._sfx('riser', { intensity: Math.min(1, 0.5 + N * 0.12) });
    this._track(fx.vignette(0x000000, { alpha: 0.5, duration: this._rt(1200 + N * 900), fade: 220 }));
    await this._wait(cx, this._t(150), true);
    if (!this._skipping) {
      cx.slowP = fx.slowMo(slow, 1000 + N * 1100, { inMs: 160, outMs: 260 });
      cx.slow = true;
    }
    let prevV = null;
    for (let i = 0; i < N; i++) {
      const h = hops[i];
      const capture = h.cap >= 0;
      const v = r.pieceAt(h.from);
      if (capture) this._focus(h.V, zoom * 0.98, this._t(240), { k: 0.58 });
      else this._focus(h.B, zoom * 0.9, this._t(240), { k: 0.58 });
      if (v) fx.afterimages(v, { duration: this._t(340), color: col });
      if (capture && !this._skipping) this._track(fx.speedLines({ focus: h.V, duration: 420, density: 0.6 }));
      this._sfx('whoosh', { intensity: 0.8, pitch: 1 + i * 0.05, pan: this._pan(h.B.x) });
      const shrink = i >= 3 ? Math.max(0.72, 1 - (i - 2) * 0.07) : 1;
      const long = Math.max(0, h.dist - 2);
      const dur = this._t(((m.ultimate ? 235 : 290) + Math.min(5, long) * 26) * shrink);
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
      await this._wait(cx, this._t(30));
    }
    await this._epicFinale(cx, m, corpses);
  }

  /** A hit inside a multi-capture: strike, mark, chain lightning from the previous victim, combo. */
  _strikeMarked(m, h, k, prevV) {
    const fx = this.fx;
    if (h.cap < 0) return null;
    const corpse = this._strike(m, h, k, { single: false });
    const hits = k + 1;
    if (hits >= 2) {
      fx.comboCounter(hits, { side: m.comboSide, hold: 2600 });
      this._sfx('combo', { intensity: Math.min(1, 0.4 + hits * 0.15), pitch: 1 + hits * 0.05 });
      this._haptic('combo');
      if (prevV) {
        fx.lightning(prevV.x, prevV.y, h.V.x, h.V.y, { color: mixHex(m.col, 0xffffff, 0.25), branches: 2, duration: 420 });
        this._sfx('zap', { intensity: 0.6 });
      }
    }
    return corpse;
  }

  /** Pose → cut-in with the attack name → «НАНИ?!» → every marked victim explodes at once. */
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
    // back to normal speed for the punchline (real-time beats)
    if (cx.slow) {
      if (cx.slowP && cx.slowP.stop) cx.slowP.stop();
      fx.slowMo(1, 0, { inMs: 220, outMs: 0 });
    }
    cx.slow = false;
    for (const c of corpses) c.setUnstable(true);
    // 1) pose: camera pulls back, the attacker hovers in its aura, 「ゴゴゴ」
    const bc = r.boardCenter;
    const L = this._C(last.to);
    if (!this._skipping) cam.focus(bc.x + (L.x - bc.x) * 0.15, bc.y + (L.y - bc.y) * 0.15, 0.96, this._t(380), Ease.outCubic, { realtime: true });
    if (view) {
      tween(view, { lift: 0.22 }, { duration: this._t(260), ease: Ease.outBack, clock: this._clock, realtime: true });
      fx.burst(L.x, L.y, { kind: 'energy', color: col, inward: true, count: 16 });
      if (!this._skipping) this._track(fx.menacing(L.x, L.y, { count: 4, duration: this._t(1500), realtime: true }));
    }
    if (m.ultimate) fx.pillar(L.x, L.y, { color: col, duration: this._t(1500), width: 1.0 });
    this._sfx('menacing', { intensity: 0.8 });
    this._sfx('heartbeat', { intensity: 0.8 });
    r.lightning();
    // 2) cut-in: the attack name
    const name = m.attackName || attackName({ n: N, side: m.mover, king: !!(view && view.isKing), ultimate: m.ultimate }, this._lang);
    m.attackName = name;
    const bottom = m.mover === this._bottomColor;
    const cxs = corpses.length ? corpses.reduce((s, c) => s + c.x, 0) / corpses.length : L.x;
    const cys = corpses.length ? corpses.reduce((s, c) => s + c.y, 0) / corpses.length : L.y;
    if (!this._skipping) {
      // keep the band away from the doomed pieces (they must stay visible for the punchline)
      const doomY = r.worldToScreen(cxs, cys).y;
      const fr = r.frameBounds;
      const bandY = doomY > fr.y + fr.height * 0.5 ? Math.max(fr.y + fr.height * 0.1, scr.height * 0.24) : Math.min(fr.y + fr.height * 0.9, scr.height * 0.74);
      this._track(
        fx.cutIn({
          title: name,
          subtitle: bragLine('dead', {}, this._lang),
          side: bottom ? 'left' : 'right',
          pieceColor: m.mover,
          king: !!(view && view.isKing),
          duration: this._t(1000),
          y: bandY,
        }),
      );
    }
    this._sfx('swell', { intensity: 0.9 });
    this._announce(COMBO_CALL[N] || (N > 5 ? 'UNSTOPPABLE!' : 'COMBO!'), { force: true });
    await this._wait(cx, this._t(620), true);
    // 3) «НАНИ?!» over the doomed
    if (!this._skipping) {
      this._track(fx.kanji(kanjiFor('nani'), cxs, cys - sz * 0.6, { color: m.vcol, size: sz * 1.35, duration: this._t(430), exit: 'fade', backdrop: 'burst', realtime: true }));
    }
    this._sfx('glitch', { intensity: 0.7 });
    this._duck(0.75, 450);
    await this._wait(cx, this._t(260), true);
    // 4) the chain lights up…
    for (let k = 0; k + 1 < corpses.length; k++) {
      const a = corpses[k];
      const b = corpses[k + 1];
      fx.lightning(a.x, a.y, b.x, b.y, { color: mixHex(col, 0xffffff, 0.35), duration: 320, width: 1.3, branches: 2, sky: k === 0 });
    }
    this._sfx('thunder', { intensity: 0.8 });
    await this._wait(cx, this._t(80), true);
    // 5) …and everything explodes at once
    const many = corpses.length;
    const low = fx.quality === 'low';
    const size = many <= 2 ? 1.15 : many <= 4 ? 0.98 : 0.8;
    corpses.forEach((c, k) => {
      if (low && k > 0) {
        const x = c.x;
        const y = c.y;
        c.explode();
        fx.burst(x, y, { kind: 'shards', color: m.vcol, count: 14 });
      } else this._detonate(m, c, { size, big: k === 0 });
    });
    for (const s of m.extra) r.removePiece(s, { duration: this._t(200) });
    if (!this._skipping) {
      const fp = r.worldToScreen(cxs, cys);
      fx.impactFrame({ screenFocus: fp, frames: 3, duration: 120 });
      wait(120, { clock: this._clock, realtime: true }).then(() => this._skipping || fx.flash(0xffffff, { duration: 260, alpha: 0.32, attack: 0.05 }));
      fx.chromatic(1.4, this._rt(520));
      fx.bloomPulse(0.95, this._rt(800));
      fx.zoomBlur(cxs, cys, 0.24, this._rt(450));
    }
    fx.crack(cxs, cys, { color: col, size: 3.4 });
    fx.shake(0.95, 700);
    if (m.ultimate) this._track(godrays(fx, { duration: this._rt(1500), x: scr.width / 2 }));
    if (!this._skipping) {
      const word = kanjiFor('finale');
      const size = Math.min(sz * 2.4, (scr.width * 0.78) / Math.max(1, Array.from(word).length * 0.92));
      this._track(fx.kanji(word, cxs, cys - sz * 0.3, { color: col, size, duration: this._t(1000), delay: 130, realtime: true }));
    }
    this._sfx('bigImpact', { intensity: 1 });
    this._sfx('boom', { intensity: 1 });
    this._haptic(m.ultimate ? 'ultimate' : 'bigImpact');
    if (m.ko) this._ko(m, { x: cxs, y: cys });
    this._maybeCaption(m, 'combo');
    if (view) tween(view, { lift: 0 }, { duration: this._t(200), ease: Ease.inQuad, clock: this._clock, realtime: true });
    // 6) back to the board
    await this._wait(cx, this._t(140), true);
    this._camResetting = true;
    try {
      await this._await(cx, cam.reset(this._t(360), Ease.inOutCubic, { realtime: true }));
    } finally {
      this._camResetting = false;
    }
  }

  /** ULTIMATE intro: power-up pillar, 必殺 slams on screen, screen-wide cut-in with the attack name. */
  async _epicUltimateIntro(cx, m) {
    const r = this.renderer;
    const fx = this.fx;
    const scr = r.screen;
    const h = m.hops[0];
    const view = r.pieceAt(h.from);
    const col = m.col;
    this._announce('ULTIMATE!', { force: true });
    this._sfx('power', { intensity: 1 });
    this._sfx('riser', { intensity: 1 });
    this._haptic('ultimate');
    this._track(fx.vignette(0x000000, { alpha: 0.72, duration: this._rt(2300), fade: 220 }));
    this._focus(h.A, this._zoom(1.18), this._t(360), { realtime: true });
    fx.charge(h.A.x, h.A.y, { color: col, duration: this._t(620), radius: 2.4 });
    fx.pillar(h.A.x, h.A.y, { color: col, duration: this._t(1300), width: 1.0 });
    if (!this._skipping) this._track(fx.menacing(h.A.x, h.A.y, { count: 3, duration: this._t(1300) }));
    if (view) tween(view, { lift: 0.25 }, { duration: this._t(300), ease: Ease.outBack, clock: this._clock, realtime: true });
    fx.shake(0.3, 600);
    r.lightning();
    await this._wait(cx, this._t(360), true);
    // 必殺
    const big = Math.min(scr.width * 0.38, 210);
    if (!this._skipping) {
      this._track(fx.kanji(kanjiFor('ultimate'), scr.width / 2, scr.height * 0.36, { screen: true, size: big, color: EPIC.gold, duration: this._t(1250), backdrop: 'rays', exit: 'slice', realtime: true }));
      fx.flash(0xffffff, { duration: 200, alpha: 0.7 });
      fx.impactFrame({ frames: 2, duration: 100 });
    }
    fx.shake(0.6, 450);
    this._sfx('gong', { intensity: 1 });
    this._sfx('bigImpact', { intensity: 0.6 });
    await this._wait(cx, this._t(260), true);
    const name = attackName({ n: m.n, side: m.mover, king: !!(view && view.isKing), ultimate: true }, this._lang);
    m.attackName = name;
    const bottom = m.mover === this._bottomColor;
    if (!this._skipping) {
      this._track(
        fx.cutIn({
          title: name,
          subtitle: `${bragLine('ultimate', {}, this._lang)} · ${this._s('ultimate')}`,
          side: bottom ? 'left' : 'right',
          pieceColor: m.mover,
          king: !!(view && view.isKing),
          duration: this._t(1050),
          y: scr.height * 0.62,
        }),
      );
    }
    this._sfx('swell', { intensity: 1 });
    await this._wait(cx, this._t(820), true);
    if (view) await this._await(cx, tween(view, { lift: 0 }, { duration: this._t(110), ease: Ease.inQuad, clock: this._clock, realtime: true }));
  }

  /** «ПРОБУЖДЕНИЕ»: pillar of light, gold spiral, giant 覚醒, crown forms, aura ignites. */
  async _epicPromote(cx, m, sq, { short = false } = {}) {
    const r = this.renderer;
    const fx = this.fx;
    const cam = r.camera;
    const P = this._C(sq);
    const sz = r.squareSize;
    const scr = r.screen;
    const gold = EPIC.gold;
    if (!short) this._focus(P, this._zoom(1.06), this._t(300), { realtime: true });
    fx.charge(P.x, P.y, { color: gold, duration: this._t(short ? 220 : 360), radius: 1.6 });
    this._sfx('charge', { intensity: 0.8 });
    await this._wait(cx, this._t(short ? 180 : 320), true);
    fx.pillar(P.x, P.y, { color: gold, duration: this._t(short ? 950 : 1200), spiral: true, godrays: !short });
    fx.flash(gold, { duration: 240, alpha: 0.45 });
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
      const roomAbove = ps.y - (off + kz * 0.66) * zoomNow > 4;
      const ky = roomAbove ? P.y - off : P.y + off;
      this._track(fx.kanji(kanjiFor('promote'), P.x, ky, { color: gold, size: kz, duration: this._t(short ? 900 : 1350), exit: 'fade', backdrop: 'rays', delay: 60, realtime: true }));
      if (!short) {
        const fr = r.frameBounds;
        const topHalf = ps.y < scr.height / 2;
        const y = topHalf ? fr.y + fr.height * 0.8 : fr.y + fr.height * 0.2;
        const sub = m && (m.human || m.bothHuman || Math.random() < 0.6) ? bragLine('promote', {}, this._lang) : this._s('awakeningSub');
        this._track(fx.banner(this._s('awakening'), { sub: sub.toUpperCase(), style: 'gold', y, duration: this._t(1450) }));
      }
    }
    // the crown forms as the light column thins out
    await this._wait(cx, this._t(short ? 260 : 480), true);
    r.setPieceKing(sq, true, { animate: true });
    fx.burst(P.x, P.y, { kind: 'spark', color: gold, count: 22, speed: 1.1 });
    fx.shockwave(P.x, P.y, { color: 0xffffff, strength: 0.5, radius: 1.4, duration: 420 });
    this._sfx('sparkle', { intensity: 0.9 });
    await this._wait(cx, this._t(short ? 260 : 460), true);
    this.syncAuras();
    if (!short) {
      this._camResetting = true;
      try {
        await this._await(cx, cam.reset(this._t(380), Ease.inOutCubic, { realtime: true }));
      } finally {
        this._camResetting = false;
      }
    }
  }

  /** Last enemy piece down. */
  _ko(m, p) {
    const fx = this.fx;
    const sz = this.renderer.squareSize;
    this._announce('K.O.!', { force: true });
    if (!this._skipping) this._track(fx.kanji(kanjiFor('ko'), p.x, p.y + sz * 0.9, { color: EPIC.gold, size: sz * 1.9, duration: this._t(1100), delay: 260, exit: 'slice', realtime: true }));
  }

  /** Brag / taunt caption, rate-limited (never on every move). */
  _maybeCaption(m, kind) {
    if (!this.epic || this._skipping) return;
    const now = this._clock.realNow;
    if (now - this._lastCaption < 2600) return;
    const mover = m.mover;
    const since = this._sinceCaption[mover] || 0;
    const boaster = m.human || m.bothHuman;
    let event = null;
    let chance = 0;
    let gap = 0;
    if (kind === 'combo') {
      event = 'combo';
      chance = boaster ? 1 : 0.85;
    } else if (kind === 'ultimate') {
      event = 'ultimate';
      chance = 1;
    } else if (kind === 'capture') {
      event = m.kingVictims ? 'kingslayer' : boaster ? (m.behind ? 'comeback' : 'capture') : Math.random() < 0.6 ? 'taunt' : 'capture';
      chance = boaster ? 0.6 : 0.5;
      gap = boaster ? 2 : 3;
    } else if (kind === 'quiet') {
      event = boaster ? 'brag' : 'taunt';
      chance = boaster ? 0.04 : 0.09;
      gap = 6;
    }
    if (!event || since < gap || Math.random() > chance) return;
    const opp = m.names[-mover] && m.names[-mover].name;
    const text = bragLine(event, { n: m.n, name: m.speaker, opp, side: mover }, this._lang);
    this._lastCaption = now;
    this._sinceCaption[mover] = 0;
    const side = mover === this._bottomColor ? 'bottom' : 'top';
    this._track(caption(this.fx, { text, speaker: m.speaker, color: m.col, side, duration: 1900, epic: true }));
  }

  // =================================================================== game start
  playGameStart({ variant, players, epic, bottomColor } = {}) {
    return this._run('playGameStart', async (cx) => {
      const r = this.renderer;
      const fx = this.fx;
      this._streak = { 1: 0, '-1': 0 };
      this._sinceCaption = { 1: 99, '-1': 99 };
      this._lastCaption = -1e9;
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
      const fighter = (c) => {
        const p = P[c] || {};
        const human = p.isHuman !== false;
        const name = p.name || this._s(c === 1 ? 'white' : 'black');
        return {
          name: name.toUpperCase(),
          sub: (p.title || this._s(c === 1 ? 'white' : 'black')).toUpperCase(),
          color: EPIC.side[c],
          side: c,
          king: !human && (p.level || 0) >= 4,
          power: human ? 9001 : p.power || 1000 * (p.level || 3),
          powerSuffix: human ? '+' : '',
        };
      };
      this._sfx('start', { intensity: 1 });
      this._sfx('riser', { intensity: 0.8 });
      this._haptic('start');
      let clashResolve;
      const clash = new Promise((res) => (clashResolve = res));
      const vs = versus(fx, {
        top: fighter(-bottom),
        bottom: fighter(bottom),
        label: this._s('power'),
        holdMs: this._t(1300),
        onClash: () => {
          clashResolve();
          if (this._skipping) return;
          this._track(fx.kanji(kanjiFor('start'), scr.width / 2, scr.height / 2, { screen: true, color: EPIC.gold, size: Math.min(150, scr.width * 0.36), duration: this._t(1050), realtime: true, exit: 'shatter' }));
          fx.flash(0xffffff, { duration: 200, alpha: 0.65 });
          fx.shake(0.5, 420);
          this._sfx('gong', { intensity: 1 });
          this._sfx('taiko', { intensity: 1 });
          this._sfx('bigImpact', { intensity: 0.5 });
          this._haptic('capture');
          r.lightning();
        },
      });
      this._track(vs);
      await this._await(cx, Promise.race([clash, wait(this._t(400), { clock: this._clock, realtime: true })]));
      this._announce('FIGHT!', { force: true });
      await this._await(cx, Promise.race([vs, wait(this._t(1700), { clock: this._clock, realtime: true })]));
      if (!this._skipping) this._track(fx.banner(this._s('fight'), { style: 'epic', color: EPIC.gold, y: scr.height * 0.5, duration: this._t(1150) }));
      this._sfx('swell', { intensity: 0.8 });
      await this._dropPieces(cx, views, { epic: true });
      await this._wait(cx, this._t(120), true);
    });
  }

  /** Pieces drop onto the board, back rank first (both sides together). */
  async _dropPieces(cx, views, { epic }) {
    const r = this.renderer;
    const fx = this.fx;
    const n = r.layout ? r.layout.n : 8;
    // rank distance from the owner's edge (screen space): back rank first
    const ranks = new Map();
    for (const it of views) {
      const d = r.sqToDisplay(it.sq);
      const fromEdge = d.row < n / 2 ? d.row : n - 1 - d.row;
      it.edge = fromEdge;
      ranks.set(fromEdge, true);
    }
    const order = [...ranks.keys()].sort((a, b) => a - b);
    const stagger = epic ? 85 : 55;
    const dur = epic ? 230 : 320;
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
  playTurn({ color, isHuman, players } = {}) {
    const r = this.renderer;
    if (color === 1 || color === -1) this._try(() => r.setTurnGlow(color, { flare: true }));
    if (!this.epic || this.busy) return Promise.resolve(true);
    const P = players || {};
    const pvp = !!(P[1] && P[-1] && P[1].isHuman === P[-1].isHuman);
    const text = pvp ? this._s(color === 1 ? 'whiteTurn' : 'blackTurn') : isHuman ? this._s('yourTurn') : this._s('oppTurn');
    if (this._turnFx && this._turnFx.stop) this._try(() => this._turnFx.stop());
    const side = color === this._bottomColor ? 'bottom' : 'top';
    const p = this._try(() => turnBanner(this.fx, { text, color: EPIC.side[color] || EPIC.white, side, duration: Math.max(500, 1050 / this._speed) }));
    this._turnFx = p;
    this._sfx('turn', { intensity: isHuman ? 0.8 : 0.5 });
    if (isHuman) this._haptic('turn');
    return new Promise((res) => {
      wait(Math.max(250, 650 / this._speed), { clock: this._clock, realtime: true }).then(() => res(true));
    });
  }

  // =================================================================== game over
  playGameOver({ result, humanColor = 0, stats = null, players = null } = {}) {
    return this._run('playGameOver', async (cx) => {
      const winner = result ? result.winner : 0;
      const hero = humanColor === 1 || humanColor === -1 ? humanColor : winner || 0;
      const outcome = !winner ? 'draw' : humanColor === 1 || humanColor === -1 ? (winner === humanColor ? 'win' : 'loss') : 'win';
      if (this._turnFx && this._turnFx.stop) this._try(() => this._turnFx.stop());
      if (this.fx) this._try(() => this.fx.hideCombo());
      if (!this.epic) {
        await this._classicGameOver(cx, { winner, humanColor, outcome, result });
        return;
      }
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
    parts.push(this._s('lost', lost));
    return parts.join(' · ');
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
    const col = EPIC.side[winner] || gold;
    this._sfx('win', { intensity: 1 });
    this._sfx('gong', { intensity: 0.8 });
    this._haptic('win');
    this._announce(flawless ? 'PERFECT!' : human ? 'YOU WIN!' : winner === 1 ? 'WHITE WINS!' : 'BLACK WINS!', { force: true });
    fx.flash(gold, { duration: 320, alpha: 0.5 });
    fx.bloomPulse(1, this._rt(1100));
    this._track(fx.rays(W / 2, H * 0.32, { screen: true, color: gold, duration: this._t(3600), realtime: true }));
    this._track(godrays(fx, { duration: this._t(3600), x: W / 2 }));
    this._track(fx.weather('petals', { duration: this._t(3600) }));
    this._track(fx.weather('confetti', { duration: this._t(2800) }));
    this._track(fx.kanji(kanjiFor('win'), W / 2, H * 0.28, { screen: true, color: gold, size: Math.min(W * 0.42, 190), duration: this._t(3300), exit: 'fade', backdrop: 'rays', realtime: true }));
    // the winner's pieces celebrate: a hop wave across the board
    this._wave(winner);
    await this._wait(cx, this._t(380), true);
    const title = humanColor === 1 || humanColor === -1 ? (flawless ? this._s('flawless') : this._s('victory')) : flawless ? this._s('flawless') : this._s(winner === 1 ? 'whiteWins' : 'blackWins');
    this._track(fx.banner(title, { sub: this._statsLine(stats, winner), style: 'victory', color: flawless ? gold : mixHex(col, gold, 0.55), y: H * 0.5, duration: this._t(2900) }));
    this._sfx('swell', { intensity: 0.8 });
    await this._wait(cx, this._t(1000), true);
    const name = players && players[winner] && players[winner].name;
    const line = bragLine(flawless ? 'flawless' : 'win', { name }, this._lang);
    this._track(caption(fx, { text: line, speaker: name || this._s(winner === 1 ? 'white' : 'black'), color: col, side: winner === this._bottomColor ? 'bottom' : 'top', duration: this._t(2100), epic: true }));
    await this._wait(cx, this._t(1900), true);
  }

  async _epicDefeat(cx, { winner, hero, stats, players }) {
    const r = this.renderer;
    const fx = this.fx;
    const scr = r.screen;
    const W = scr.width;
    const H = scr.height;
    const steel = 0x8a96b8;
    this._sfx('lose', { intensity: 1 });
    this._sfx('heartbeat', { intensity: 0.9 });
    this._haptic('lose');
    this._announce('GAME OVER', { force: true });
    fx.slowMo(0.35, this._rt(2600), { inMs: 400, outMs: 500 });
    cx.slow = true;
    this._track(fx.grade({ amount: 0.9, dark: 0.32, duration: this._t(3800), fade: 500 }));
    this._track(fx.weather('rain', { duration: this._t(3700) }));
    this._track(fx.vignette(0x000000, { alpha: 0.75, duration: this._t(3800), fade: 600 }));
    r.lightning();
    this._sfx('thunder', { intensity: 0.7 });
    // the loser's pieces sag
    r.forEachPiece((v) => {
      if (v.color === hero) v.setDim(true);
    });
    await this._wait(cx, this._t(500), true);
    this._track(fx.kanji(kanjiFor('lose'), W / 2, H * 0.3, { screen: true, color: steel, size: Math.min(W * 0.4, 180), duration: this._t(3000), exit: 'fade', backdrop: 'none', realtime: true }));
    this._track(fx.banner(this._s('defeat'), { sub: bragLine('lose', {}, this._lang), style: 'defeat', y: H * 0.5, duration: this._t(3000) }));
    await this._wait(cx, this._t(1500), true);
    const wName = players && players[winner] && players[winner].name;
    if (wName) {
      this._track(caption(fx, { text: bragLine('taunt', { opp: players[hero] && players[hero].name }, this._lang), speaker: wName, color: EPIC.side[winner], side: winner === this._bottomColor ? 'bottom' : 'top', duration: this._t(1800), epic: true }));
    }
    await this._wait(cx, this._t(1700), true);
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
    this._sfx('draw', { intensity: 1 });
    this._sfx('gong', { intensity: 0.6 });
    this._haptic('draw');
    this._announce('DRAW!', { force: true });
    fx.flash(0xffffff, { duration: 260, alpha: 0.35 });
    this._track(fx.rays(W * 0.3, H * 0.3, { screen: true, color: EPIC.white, duration: this._t(2800), alpha: 0.4, realtime: true }));
    this._track(fx.rays(W * 0.7, H * 0.3, { screen: true, color: EPIC.black, duration: this._t(2800), alpha: 0.4, realtime: true }));
    this._track(fx.kanji(kanjiFor('draw'), W / 2, H * 0.3, { screen: true, color: mixHex(EPIC.grid, 0xffffff, 0.25), size: Math.min(W * 0.19, 96), duration: this._t(2800), exit: 'fade', backdrop: 'rays', realtime: true }));
    await this._wait(cx, this._t(350), true);
    this._track(fx.banner(this._s('draw'), { sub: bragLine('draw', {}, this._lang).toUpperCase(), style: 'gold', color: EPIC.grid, y: H * 0.5, duration: this._t(2500) }));
    await this._wait(cx, this._t(2600), true);
  }

  async _classicGameOver(cx, { winner, humanColor, outcome }) {
    const r = this.renderer;
    const fx = this.fx;
    const scr = r.screen;
    const title =
      outcome === 'draw'
        ? this._s('cDraw')
        : humanColor === 1 || humanColor === -1
          ? outcome === 'win'
            ? this._s('cWin')
            : this._s('cLoss')
          : this._s(winner === 1 ? 'cWhite' : 'cBlack');
    this._sfx(outcome === 'draw' ? 'draw' : outcome === 'win' ? 'win' : 'lose');
    this._haptic(outcome === 'draw' ? 'draw' : outcome === 'win' ? 'win' : 'lose');
    if (fx) {
      if (outcome === 'win') {
        this._track(fx.rays(scr.width / 2, scr.height * 0.45, { screen: true, color: CLASSIC.goldLight, duration: this._t(2400), realtime: true }));
        r.forEachPiece((v) => {
          if (v.color === winner) fx.burst(v.x, v.y, { kind: 'stars', count: 3, color: CLASSIC.goldLight });
        });
        this._wave(winner, 0.22);
      } else if (outcome === 'loss') {
        this._track(fx.vignette(0x000000, { alpha: 0.5, duration: this._t(2400), fade: 500 }));
      }
      this._track(fx.banner(title, { style: 'classic', duration: this._t(2200), y: scr.height * 0.45 }));
    }
    await this._wait(cx, this._t(2300), true);
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
    const col = EPIC.side[v.color] || EPIC.white;
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
        r.camera.shake(0.07, 160);
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
    this._marks.clear();
    this._clock.remove(this._tick, this);
  }
}
