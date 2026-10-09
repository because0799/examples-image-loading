// Renderer — Pixi application, layers, board/pieces/highlights, input and animation primitives.
// See ARCHITECTURE.md §3 for the contract. Extra API (additive):
//   setTurnGlow(colorOrSide, { intensity, flare })   epic board edge glow in the colour of the side to move
//   setQuality(q)  pause()  resume()  addPiece(sq, code, { animate })  forEachPiece(fn)
//   boardBounds / frameBounds / boardCenter / layout / palette / theme / variant / flipped / resolution
//   isDarkSquare(sq)  sqToDisplay(sq)  pieceGlowLayer
//
// World coordinates = CSS px at camera zoom 1; layers.world is transformed by the Camera around the
// board centre. Board rect comes from the DOM (#board-slot) via setBoardRect(); before that call the
// board auto-fits the screen.

import { Application, Container } from 'pixi.js';
import { Clock, setDefaultClock, tween, animate, Ease, resolveEase } from './tween.js';
import { Camera } from './camera.js';
import { BoardView } from './board-view.js';
import { ClassicBackdrop, EpicBackdrop } from './backdrop.js';
import { Highlights } from './highlights.js';
import { PieceView } from './piece-view.js';
import { createPieceSkin } from './piece-skin.js';
import { PALETTES } from './palette.js';

export const QUALITY_LEVELS = {
  high: { resolution: 2, antialias: true },
  medium: { resolution: 1.5, antialias: true },
  low: { resolution: 1, antialias: false },
};

const FONT_SPECS = ['500 16px "Oswald"', '700 16px "Oswald"', '16px "Dela Gothic One"', '16px "Russo One"', '900 16px "Unbounded"'];

async function loadFonts(timeout = 1500) {
  if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) return;
  const all = Promise.all(FONT_SPECS.map((f) => document.fonts.load(f).catch(() => null)));
  await Promise.race([all, new Promise((r) => setTimeout(r, timeout))]);
}

export class Renderer {
  constructor(hostElement) {
    this.host = hostElement;
    this.app = new Application();
    this.clock = new Clock();
    setDefaultClock(this.clock);
    this.camera = new Camera(this);
    this.theme = 'classic';
    this.palette = PALETTES.classic;
    this.variant = null;
    this.flipped = false;
    this.quality = 'high';
    this.resolution = 1;
    this.squareSize = 40;
    this.layout = null;
    this.boardCenter = { x: 0, y: 0 };
    this.ready = false;

    const mk = (label) => {
      const c = new Container();
      c.label = label;
      return c;
    };
    this.layers = {
      background: mk('background'),
      world: mk('world'),
      board: mk('board'),
      boardFx: mk('boardFx'),
      highlights: mk('highlights'),
      pieces: mk('pieces'),
      worldFx: mk('worldFx'),
      screenFx: mk('screenFx'),
      overlay: mk('overlay'),
    };
    this.pieceGlowLayer = mk('piece-glows');
    /** additive glows drawn above all pieces (energy core bloom) — between pieces and worldFx */
    this.pieceTopLayer = mk('piece-top-glows');

    this._rect = null;
    this._sw = 0;
    this._sh = 0;
    this._pieces = []; // sq -> PieceView
    this._live = []; // all attached views (incl. dying)
    this._dying = new Set();
    this._pool = [];
    this._squareTapFns = [];
    this._tapFns = [];
    this._pieceSkin = null;
    this._turnGlow = null;
    this.backdrop = null;
    this.boardView = null;
    this.highlights = null;
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onResize = this._onResize.bind(this);
  }

  // ===================================================================== init / lifecycle
  async init({ quality = 'high', fonts = true } = {}) {
    this.quality = QUALITY_LEVELS[quality] ? quality : 'high';
    const Q = QUALITY_LEVELS[this.quality];
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this.resolution = Math.min(dpr, Q.resolution);
    const w = Math.max(1, this.host.clientWidth || window.innerWidth);
    const h = Math.max(1, this.host.clientHeight || window.innerHeight);
    await this.app.init({
      width: w,
      height: h,
      resolution: this.resolution,
      autoDensity: true,
      antialias: Q.antialias,
      background: this.palette.bg,
      preference: 'webgl',
      powerPreference: 'high-performance',
      hello: false,
      eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
    });
    const canvas = this.app.canvas;
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    this.host.appendChild(canvas);
    this._sw = w;
    this._sh = h;

    const L = this.layers;
    L.world.addChild(L.board, L.boardFx, L.highlights, L.pieces, this.pieceTopLayer, L.worldFx);
    L.pieces.addChild(this.pieceGlowLayer);
    this.app.stage.addChild(L.background, L.world, L.screenFx, L.overlay);

    if (fonts) await loadFonts();

    this.boardView = new BoardView(this);
    this.boardView.setQuality(this.quality);
    this.highlights = new Highlights(this);
    this._buildBackdrop();
    if (this._turnGlow != null) this.boardView.setTurnGlow(this._turnGlow, { flare: false });

    canvas.addEventListener('pointerdown', this._onPointerDown);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(this.host);
    }
    window.addEventListener('resize', this._onResize);
    this.app.ticker.add(this._tick, this);
    this.ready = true;
    this._applyLayout(true);
    return this;
  }

  get screen() {
    if (!this.ready) {
      return { width: this._sw || (typeof window !== 'undefined' ? window.innerWidth : 390), height: this._sh || (typeof window !== 'undefined' ? window.innerHeight : 844) };
    }
    const s = this.app.screen;
    return { width: s.width, height: s.height };
  }

  pause() {
    if (this.app.ticker) this.app.ticker.stop();
  }

  resume() {
    if (this.app.ticker) this.app.ticker.start();
  }

  destroy() {
    if (!this.ready) return;
    this.ready = false;
    this.app.ticker.remove(this._tick, this);
    this.app.canvas.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('resize', this._onResize);
    if (this._ro) this._ro.disconnect();
    this.clock.cancelTweensOf();
    for (const v of this._live.concat(this._pool)) v.destroy();
    this._live = [];
    this._pool = [];
    this._pieces = [];
    this.highlights.destroy();
    this.boardView.destroy();
    if (this.backdrop) this.backdrop.destroy();
    if (this._pieceSkin) this._pieceSkin.destroy();
    this.app.destroy(true, { children: true });
    this._squareTapFns = [];
    this._tapFns = [];
  }

  setQuality(q) {
    if (!QUALITY_LEVELS[q] || q === this.quality) return;
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.resolution = Math.min(dpr, QUALITY_LEVELS[q].resolution);
    if (this.ready) {
      this.app.renderer.resize(this._sw, this._sh, this.resolution);
      this.boardView.setQuality(q);
      if (this.backdrop) this.backdrop.setQuality(q);
      this._applyLayout(true);
    }
  }

  // ===================================================================== theme / variant / rect
  setTheme(theme) {
    theme = theme === 'epic' ? 'epic' : 'classic';
    if (theme === this.theme && this.backdrop) return;
    this.theme = theme;
    this.palette = PALETTES[theme];
    if (!this.ready) return;
    this.app.renderer.background.color = this.palette.bg;
    this._buildBackdrop();
    this._applyLayout(true);
    if (theme === 'epic' && this._turnGlow != null) this.boardView.setTurnGlow(this._turnGlow, { flare: false });
  }

  setVariant(variant, { flipped = false } = {}) {
    this.variant = variant;
    this.flipped = !!flipped;
    // pieces belong to the old board
    for (const v of this._live.slice()) this._releaseView(v);
    this._pieces = new Array(variant.size * variant.size).fill(null);
    if (this.highlights) this.highlights.clear(true);
    if (this.ready) {
      this.camera.snap();
      this._applyLayout(true);
    }
  }

  /** Flip the view without rebuilding the position (keeps pieces). */
  setFlipped(flipped) {
    if (!!flipped === this.flipped) return;
    this.flipped = !!flipped;
    this._applyLayout(true);
  }

  setBoardRect(rect) {
    if (!rect) {
      this._rect = null;
    } else {
      this._rect = { x: +rect.x || 0, y: +rect.y || 0, width: Math.max(10, +rect.width || 0), height: Math.max(10, +rect.height || 0) };
    }
    if (this.ready) this._applyLayout(false);
  }

  /** Epic edge glow colour: side (1 / -1), a hex colour or null (off). */
  setTurnGlow(color, opts) {
    this._turnGlow = color;
    if (this.boardView) this.boardView.setTurnGlow(color, opts);
  }

  /** Epic backdrop: trigger a distant lightning strike now (no-op in classic). */
  lightning() {
    if (this.backdrop && typeof this.backdrop.lightning === 'function') this.backdrop.lightning();
  }

  _buildBackdrop() {
    if (this.backdrop) {
      this.backdrop.destroy();
      this.backdrop = null;
    }
    this.backdrop = this.theme === 'epic' ? new EpicBackdrop(this, this.quality) : new ClassicBackdrop(this);
    this.layers.background.addChild(this.backdrop.container);
    this.backdrop.resize(this._sw, this._sh);
  }

  _onResize() {
    if (!this.ready) return;
    const w = Math.max(1, this.host.clientWidth || window.innerWidth);
    const h = Math.max(1, this.host.clientHeight || window.innerHeight);
    if (w === this._sw && h === this._sh) return;
    this._sw = w;
    this._sh = h;
    this.app.renderer.resize(w, h, this.resolution);
    if (this.backdrop) this.backdrop.resize(w, h);
    this._applyLayout(false);
  }

  _autoRect() {
    const w = this._sw;
    const h = this._sh;
    const side = Math.max(40, Math.min(w, h) - 16);
    return { x: (w - side) / 2, y: (h - side) / 2, width: side, height: side };
  }

  _computeLayout() {
    const rect = this._rect || this._autoRect();
    const v = this.variant || { size: 8, playable: 'dark' };
    const n = v.size;
    const side = Math.min(rect.width, rect.height);
    const res = this.resolution;
    let fw = Math.min(30, Math.max(9, (side / (n + 1)) * 0.46));
    let sq = 0;
    for (let i = 0; i < 3; i++) {
      sq = (side - 2 * fw) / n;
      fw = Math.min(30, Math.max(9, sq * 0.46));
    }
    sq = Math.max(4, Math.floor(sq * res) / res);
    fw = Math.floor(((side - n * sq) / 2) * res) / res;
    fw = Math.max(6, fw);
    const total = n * sq + 2 * fw;
    const x = Math.round((rect.x + (rect.width - total) / 2) * res) / res;
    const y = Math.round((rect.y + (rect.height - total) / 2) * res) / res;
    const parity = v.darkParity != null ? v.darkParity : 1;
    return {
      n,
      sq,
      fw,
      total,
      x,
      y,
      bx: x + fw,
      by: y + fw,
      playable: v.playable === 'all' ? 'all' : 'dark',
      parity,
      flipped: this.flipped,
      labels: n <= 8 && fw >= 11,
      rect,
    };
  }

  _applyLayout(force) {
    if (!this.ready) return;
    const L = this._computeLayout();
    const prev = this.layout;
    const changed =
      force ||
      !prev ||
      prev.n !== L.n ||
      prev.sq !== L.sq ||
      prev.fw !== L.fw ||
      prev.x !== L.x ||
      prev.y !== L.y ||
      prev.flipped !== L.flipped ||
      prev.playable !== L.playable ||
      prev.parity !== L.parity;
    if (!changed) return;
    const sizeChanged = !prev || prev.sq !== L.sq || force;
    this.layout = L;
    this.squareSize = L.sq;
    this.boardCenter.x = L.x + L.total / 2;
    this.boardCenter.y = L.y + L.total / 2;

    this.boardView.build(this.theme, L, this.resolution);
    if (this.backdrop) this.backdrop.setBoard({ x: L.x, y: L.y, width: L.total, height: L.total });

    if (sizeChanged || !this._pieceSkin || this._pieceSkin.theme !== this.theme) {
      const old = this._pieceSkin;
      this._pieceSkin = createPieceSkin(this.theme, L.sq, this.resolution);
      for (const v of this._live) {
        v.applySkin(this._pieceSkin);
        v._applyDim();
      }
      for (const v of this._pool) v.applySkin(this._pieceSkin);
      if (old) old.destroy();
    }
    // reposition resting pieces
    for (let sq = 0; sq < this._pieces.length; sq++) {
      const v = this._pieces[sq];
      if (!v) continue;
      if (v._moveTask) {
        const t = v._moveTask;
        v._moveTask = null; // detach first so its completion does not re-position the view
        t.cancel(true);
        v.lift = 0;
      }
      const c = this.squareCenter(sq);
      v.position.set(c.x, c.y);
      v._layout();
    }
    this.highlights.rebuild(this.theme, L.sq, this.resolution);
  }

  // ===================================================================== geometry
  sqToDisplay(sq) {
    const n = this.layout ? this.layout.n : this.variant ? this.variant.size : 8;
    const r = Math.floor(sq / n);
    const c = sq - r * n;
    return this.flipped ? { row: n - 1 - r, col: n - 1 - c } : { row: r, col: c };
  }

  isDarkSquare(sq) {
    const L = this.layout;
    if (!L) return false;
    if (L.playable === 'all') return true;
    const r = Math.floor(sq / L.n);
    const c = sq - r * L.n;
    return (r + c) % 2 === L.parity;
  }

  squareCenter(sq) {
    const L = this.layout;
    if (!L) return { x: 0, y: 0 };
    const r = Math.floor(sq / L.n);
    const c = sq - r * L.n;
    const dr = this.flipped ? L.n - 1 - r : r;
    const dc = this.flipped ? L.n - 1 - c : c;
    return { x: L.bx + (dc + 0.5) * L.sq, y: L.by + (dr + 0.5) * L.sq };
  }

  /** Square under a SCREEN point (CSS px relative to the canvas), or -1. */
  squareAt(screenX, screenY) {
    const L = this.layout;
    if (!L) return -1;
    const p = this.screenToWorld(screenX, screenY);
    const fx = p.x - L.bx;
    const fy = p.y - L.by;
    const span = L.n * L.sq;
    if (fx < 0 || fy < 0 || fx >= span || fy >= span) return -1;
    const dc = Math.floor(fx / L.sq);
    const dr = Math.floor(fy / L.sq);
    const r = this.flipped ? L.n - 1 - dr : dr;
    const c = this.flipped ? L.n - 1 - dc : dc;
    return r * L.n + c;
  }

  worldToScreen(x, y) {
    const cam = this.camera;
    const a = this.boardCenter;
    const z = cam.zoom * cam.punchScale;
    const rot = cam.rotation + cam.shakeRot;
    const dx = x - (a.x + cam.ox);
    const dy = y - (a.y + cam.oy);
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    return { x: a.x + cam.shakeX + (dx * cs - dy * sn) * z, y: a.y + cam.shakeY + (dx * sn + dy * cs) * z };
  }

  screenToWorld(x, y) {
    const cam = this.camera;
    const a = this.boardCenter;
    const z = cam.zoom * cam.punchScale || 1;
    const rot = cam.rotation + cam.shakeRot;
    const dx = (x - (a.x + cam.shakeX)) / z;
    const dy = (y - (a.y + cam.shakeY)) / z;
    const cs = Math.cos(-rot);
    const sn = Math.sin(-rot);
    return { x: a.x + cam.ox + dx * cs - dy * sn, y: a.y + cam.oy + dx * sn + dy * cs };
  }

  /** Playing-area rect in world coords. */
  get boardBounds() {
    const L = this.layout;
    if (!L) return { x: 0, y: 0, width: 0, height: 0 };
    return { x: L.bx, y: L.by, width: L.n * L.sq, height: L.n * L.sq };
  }

  /** Whole board incl. frame in world coords. */
  get frameBounds() {
    const L = this.layout;
    if (!L) return { x: 0, y: 0, width: 0, height: 0 };
    return { x: L.x, y: L.y, width: L.total, height: L.total };
  }

  // ===================================================================== pieces
  pieceAt(sq) {
    return this._pieces[sq] || null;
  }

  forEachPiece(fn) {
    for (let sq = 0; sq < this._pieces.length; sq++) if (this._pieces[sq]) fn(this._pieces[sq], sq);
  }

  _acquireView() {
    let v = this._pool.pop();
    if (!v) v = new PieceView(this._pieceSkin, this.pieceGlowLayer, this.clock, this.pieceTopLayer);
    else if (v.skin !== this._pieceSkin) v.applySkin(this._pieceSkin);
    v.resetState();
    this.layers.pieces.addChild(v);
    v.attachGlows();
    this._live.push(v);
    return v;
  }

  _releaseView(v) {
    const i = this._live.indexOf(v);
    if (i < 0) return;
    this._live.splice(i, 1);
    this._dying.delete(v);
    v.resetState();
    v.detachGlows();
    if (v.parent) v.parent.removeChild(v);
    v.sq = -1;
    this._pool.push(v);
  }

  /** Place all pieces instantly from an engine state ({ size, board }). */
  setPosition(state) {
    const board = state.board;
    const n = state.size || Math.round(Math.sqrt(board.length));
    if (!this.variant || this.variant.size !== n) {
      // tolerate a missing setVariant() call
      this.setVariant({ id: state.variantId || 'custom', size: n, playable: 'dark' }, { flipped: this.flipped });
    }
    for (const v of Array.from(this._dying)) this._releaseView(v);
    const used = new Set();
    for (let sq = 0; sq < n * n; sq++) {
      const code = board[sq];
      let v = this._pieces[sq];
      if (!code) {
        if (v) this._releaseView(v);
        this._pieces[sq] = null;
        continue;
      }
      if (v && used.has(v)) v = null;
      if (!v) {
        v = this._acquireView();
      } else {
        v.resetState();
      }
      v.setCode(code);
      v.sq = sq;
      const c = this.squareCenter(sq);
      v.position.set(c.x, c.y);
      this._pieces[sq] = v;
      used.add(v);
    }
    // anything attached but not on the board any more
    for (const v of this._live.slice()) if (!used.has(v)) this._releaseView(v);
    // keep the highlight selection consistent
    if (this.highlights && this.highlights.state.selected >= 0) this.highlights.setSelected(this.highlights.state.selected);
  }

  /** Add a single piece (e.g. undo animations). */
  addPiece(sq, code, { animate: anim = false, duration = 260 } = {}) {
    if (!code) return Promise.resolve(false);
    const old = this._pieces[sq];
    if (old) this._releaseView(old);
    const v = this._acquireView();
    v.setCode(code);
    v.sq = sq;
    const c = this.squareCenter(sq);
    v.position.set(c.x, c.y);
    this._pieces[sq] = v;
    if (!anim) return Promise.resolve(true);
    v.alpha = 0;
    v.scale.set(0.6);
    return tween(v, { alpha: 1, 'scale.x': 1, 'scale.y': 1 }, { duration, ease: Ease.outBack, clock: this.clock });
  }

  /**
   * Move a piece (updates the piece map immediately).
   * opts: duration (ms, default by distance), ease, arc (jump height in SQUARES: 0 = slide,
   * 0.5 = hop, 1 = big leap), onUpdate(easedT, x, y, rawT), settle (landing squash, default true).
   * Resolves on landing (true) or false if cancelled/missing.
   */
  movePiece(fromSq, toSq, opts = {}) {
    const v = this._pieces[fromSq];
    if (!v) return Promise.resolve(false);
    if (v._moveTask) {
      const t = v._moveTask;
      v._moveTask = null;
      t.cancel(true);
    }
    if (v._settleTask) v._settleTask.cancel(true);
    if (this._pieces[fromSq] === v) this._pieces[fromSq] = null;
    if (this.highlights && this.highlights.state.selected === fromSq) this.highlights.setSelected(-1);
    else if (v.selected) v.setSelected(false);
    const occupant = this._pieces[toSq];
    if (occupant && occupant !== v) this._releaseView(occupant);
    this._pieces[toSq] = v;
    v.sq = toSq;
    // on top of the other pieces while travelling
    this.layers.pieces.addChild(v);

    const sx = v.x;
    const sy = v.y;
    const end = this.squareCenter(toSq);
    const dist = Math.hypot(end.x - sx, end.y - sy) / (this.squareSize || 1);
    const duration = opts.duration != null ? opts.duration : Math.max(180, Math.min(560, 150 + dist * 75));
    const ease = resolveEase(opts.ease, Ease.inOutCubic);
    const arc = +opts.arc || 0;
    const onUpdate = opts.onUpdate;
    const startLift = v.lift;
    const task = animate(
      duration,
      (e, k) => {
        v.x = sx + (end.x - sx) * e;
        v.y = sy + (end.y - sy) * e;
        if (arc) v.lift = startLift * (1 - e) + arc * 4 * e * (1 - e);
        else if (startLift) v.lift = startLift * (1 - e);
        if (onUpdate) onUpdate(e, v.x, v.y, k);
      },
      { clock: this.clock, ease }
    );
    v._moveTask = task;
    return task.then((ok) => {
      // superseded (a newer move / layout change / reset took over): don't touch the view
      const current = v._moveTask === task;
      if (current) v._moveTask = null;
      if (!ok || !current) return ok;
      v.x = end.x;
      v.y = end.y;
      v.lift = 0;
      if (opts.settle !== false && (arc > 0 || dist > 0.5)) {
        const amp = arc > 0 ? Math.min(0.16, 0.07 + arc * 0.08) : 0.05;
        const st = animate(
          arc > 0 ? 260 : 180,
          (e, k) => {
            v.squash = amp * Math.exp(-k * 4) * Math.cos(k * Math.PI * 2.2);
          },
          { clock: this.clock }
        );
        v._settleTask = st;
        st.then(() => {
          if (v._settleTask === st) {
            v._settleTask = null;
            v.squash = 0;
          }
        });
      }
      return true;
    });
  }

  /**
   * Remove a piece. animate (default true): fade + shrink + sink. Resolves when gone.
   * opts.duration (ms).
   */
  removePiece(sq, { animate: anim = true, duration = 320 } = {}) {
    const v = this._pieces[sq];
    if (!v) return Promise.resolve(false);
    this._pieces[sq] = null;
    if (v.selected) v.setSelected(false);
    if (!anim) {
      this._releaseView(v);
      return Promise.resolve(true);
    }
    this._dying.add(v);
    if (v._moveTask) {
      const t = v._moveTask;
      v._moveTask = null;
      t.cancel(true);
    }
    const t = tween(v, { alpha: 0, 'scale.x': 0.45, 'scale.y': 0.45 }, { duration, ease: Ease.inCubic, clock: this.clock });
    return t.then(() => {
      if (this._dying.has(v)) this._releaseView(v);
      return true;
    });
  }

  /** Crown / un-crown the piece on sq. Returns a promise (resolves when the animation ends). */
  setPieceKing(sq, isKing, { animate: anim = false } = {}) {
    const v = this._pieces[sq];
    if (!v) return Promise.resolve(false);
    return v.setKing(isKing, anim) || Promise.resolve(true);
  }

  // ===================================================================== input
  onSquareTap(fn) {
    this._squareTapFns.push(fn);
    return () => {
      const i = this._squareTapFns.indexOf(fn);
      if (i >= 0) this._squareTapFns.splice(i, 1);
    };
  }

  onTap(fn) {
    this._tapFns.push(fn);
    return () => {
      const i = this._tapFns.indexOf(fn);
      if (i >= 0) this._tapFns.splice(i, 1);
    };
  }

  _onPointerDown(e) {
    if (e.isPrimary === false) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const rect = this.app.canvas.getBoundingClientRect();
    const sx = rect.width ? (this._sw / rect.width) : 1;
    const sy = rect.height ? (this._sh / rect.height) : 1;
    const x = (e.clientX - rect.left) * sx;
    const y = (e.clientY - rect.top) * sy;
    const sq = this.squareAt(x, y);
    for (const fn of this._tapFns.slice()) {
      try {
        fn({ x, y, sq });
      } catch (err) {
        console.error(err);
      }
    }
    if (sq >= 0) {
      for (const fn of this._squareTapFns.slice()) {
        try {
          fn(sq);
        } catch (err) {
          console.error(err);
        }
      }
    }
  }

  // ===================================================================== frame
  _tick(ticker) {
    this.clock.update(ticker.deltaMS);
    const gdt = this.clock.delta;
    const rdt = this.clock.realDelta;
    const t = this.clock.now / 1000;
    const rt = this.clock.realNow / 1000;
    this.camera.update(rdt, gdt);
    this.camera.apply(this.layers.world);
    if (this.backdrop) this.backdrop.update(gdt, rdt, t, this.camera);
    this.boardView.update(gdt, rdt, t, rt);
    this.highlights.update(rt);
    const live = this._live;
    for (let i = 0; i < live.length; i++) live[i].update(t, rt);
  }
}
