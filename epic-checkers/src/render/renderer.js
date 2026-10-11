// Renderer — Pixi application, layers, board/pieces/highlights, input and animation primitives.
// See ARCHITECTURE.md §3 for the contract. Extra API (additive):
//   setTurnGlow(colorOrSide, { intensity, flare })   epic board edge glow in the colour of the side to move
//   setQuality(q)  pause()  resume()  addPiece(sq, code, { animate })  forEachPiece(fn)
//   boardBounds / frameBounds / boardCenter / layout / palette / theme / variant / flipped / resolution
//   isDarkSquare(sq)  sqToDisplay(sq)  pieceGlowLayer
//
// Settings + performance (SETTINGS CONTRACT; all idempotent, cheap, null-safe):
//   applySettings(settings)       showCoords, showLastMove, fx.backdrop (static backdrop), battery
//                                 (30 fps cap + resolution 1 + static backdrop). The quality level is
//                                 the controller's (it resolves 'auto' and calls setQuality)
//   setSideColors({ 1: hex, -1: hex } | null)   epic energy colours of the sides: re-skins the epic
//                                 pieces (skins are cached per colour pair), their glows, the turn glow,
//                                 the selectable rings and the last-move neon. Classic is unaffected.
//   sideColor(side) -> hex        THE side colour for FX / Director: the (custom) energy colour in
//                                 epic, CLASSIC.accent in classic; a hex passes through
//   epicSideColor(side) -> hex    the epic energy colour regardless of the current theme
//   setFpsCap(n)                  frame-rate cap via app.ticker.maxFPS (0 = uncapped; default 60)
//   wake()                        leave the idle frame rate now (tweens, input and every renderer
//                                 call already do this; FX / UI call it for anything else that moves)
//   addActivityProbe(fn) -> off   fn() → true while something animates that the renderer cannot see
//   setOccluded(bool)             an opaque UI covers the canvas: present nothing, pause the backdrop
//   idle / idleMode / perfStats() idle state, the switch (false = always render at the cap), stats
//   prewarm(themes)               generate the procedural tiles (wood, stone, nebula) of the given
//                                 themes in 5–8 ms idle slices (auto: both themes, 3 s after init),
//                                 so the first switch to the other theme does not freeze
//
// Frame scheduling: the Pixi ticker runs at the cap (60 by default, 30 with the battery saver);
// the scene is PRESENTED (app.render) every ticked frame while anything is active — a tween / wait,
// the camera, an FX layer with content, input, a renderer call, a probe. After 1.5 s without
// activity the renderer goes idle: EPIC presents at ≤ 30 fps (ambient animation keeps going), CLASSIC
// presents only when the scene graph actually changed (render on demand, ≤ 30 fps, plus a 1 s
// heartbeat). The ticker itself keeps its rate, so clock time, promises and frame-time monitors
// (app-perf) are not affected by idling — only the GPU work is skipped.
//
// Resolution: high min(DPR, 1.75), medium min(DPR, 1.25), low 1, battery 1; MSAA only on high
// (a context attribute: decided at init).
//
// World coordinates = CSS px at camera zoom 1; layers.world is transformed by the Camera around the
// board centre. Board rect comes from the DOM (#board-slot) via setBoardRect(); before that call the
// board auto-fits the screen.

import { Application, Container, UPDATE_PRIORITY } from 'pixi.js';
import { Clock, setDefaultClock, tween, animate, Ease, resolveEase } from './tween.js';
import { Camera } from './camera.js';
import { BoardView } from './board-view.js';
import { ClassicBackdrop, EpicBackdrop, backdropTileJobs } from './backdrop.js';
import { boardTileJobs } from './board-textures.js';
import { Highlights } from './highlights.js';
import { PieceView } from './piece-view.js';
import { createPieceSkin, skinKey, skinOversample, skinColors } from './piece-skin.js';
import { PALETTES, EPIC, CLASSIC } from './palette.js';

export const QUALITY_LEVELS = {
  high: { resolution: 1.75, antialias: true },
  medium: { resolution: 1.25, antialias: false },
  low: { resolution: 1, antialias: false },
};

/** Battery saver: render scale 1, 30 fps, static backdrop. */
export const BATTERY = { resolution: 1, fps: 30 };
/** Default frame-rate cap (no point rendering 90 / 120 fps on a fast screen). */
export const DEFAULT_FPS_CAP = 60;
/** Idle: no activity for IDLE_DELAY_MS → present at ≤ IDLE_FPS (classic: only on change). */
export const IDLE_DELAY_MS = 1500;
export const IDLE_FPS = 30;
/** Classic render-on-demand safety net: present at least once per HEARTBEAT_MS while idle. */
export const HEARTBEAT_MS = 1000;

/**
 * Pixi Ticker.maxFPS for a cap. Pixi skips a frame when the integer-truncated time since the last
 * one is below 1000 / maxFPS, so a slightly higher limit keeps every vsync at 60 Hz and still
 * halves 120 Hz (same rule as app-quality.tickerMaxFps).
 */
export function tickerMaxFps(cap) {
  const c = Number(cap) || 0;
  if (c <= 0) return 0;
  return c >= 50 ? Math.round(c * 1.066) : c + 1;
}

/** Device pixel ratio cap for a quality level (battery → 1). */
export function resolutionFor(quality, dpr = 1, battery = false) {
  const Q = QUALITY_LEVELS[quality] || QUALITY_LEVELS.high;
  const d = Number(dpr) > 0 ? Number(dpr) : 1;
  return Math.min(d, battery ? BATTERY.resolution : Q.resolution);
}

/** Is the stage's scene graph changed since the last render? (Pixi 8 render-group bookkeeping) */
function groupDirty(rg, depth = 0) {
  if (!rg) return true;
  if (rg.structureDidChange) return true;
  const cr = rg.childrenRenderablesToUpdate;
  if (cr && cr.index > 0) return true;
  const cu = rg.childrenToUpdate;
  if (cu) for (const k in cu) if (cu[k] && cu[k].index > 0) return true;
  const kids = rg.renderGroupChildren;
  if (kids && depth < 8) for (let i = 0; i < kids.length; i++) if (groupDirty(kids[i], depth + 1)) return true;
  return false;
}

/** Does an FX layer hold anything visible (an effect is running)? Shallow walk, no allocation. */
function layerBusy(node, depth) {
  const ch = node.children;
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i];
    if (!c.visible || c.alpha <= 0.001) continue;
    if (c.particleChildren) {
      if (c.particleChildren.length) return true;
      continue;
    }
    if (c.children.length === 0) {
      if (c.texture || c.context || c.text != null) return true;
      continue;
    }
    // deeper than we look: a visible, non-empty container is an effect at work (conservative)
    if (depth <= 1 || layerBusy(c, depth - 1)) return true;
  }
  return false;
}

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

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

    // ---- settings (SETTINGS CONTRACT)
    this.settings = null;
    this.battery = false;
    this.showCoords = true;
    this.staticBackdrop = false;
    /** custom epic energy colours { 1, -1 } or null (defaults) */
    this._sideColors = null;
    /** piece skins by key (theme / size / resolution / colours), most recent last */
    this._skinCache = new Map();
    this.skinCacheSize = 3;

    // ---- frame scheduling
    this.fpsCap = DEFAULT_FPS_CAP;
    this._userFpsCap = DEFAULT_FPS_CAP;
    /** false = never idle (present every ticked frame) */
    this.idleMode = true;
    this.idle = false;
    this.occluded = false;
    this._woke = true;
    this._lastActive = -1e9;
    this._lastRender = -1e9;
    this._forceRender = true;
    this._probes = [];
    this._now = nowMs;
    this.stats = { ticks: 0, renders: 0, skipped: 0, idleRenders: 0, rtRenders: 0 };
    this.clock.onActivity = () => {
      this._woke = true;
    };
    this._onContextRestored = () => this.wake(true);
    /** pre-warm the other theme's procedural tiles in idle slices after init */
    this.autoPrewarm = true;
    this._prewarmQueue = [];
    this._prewarmTimer = 0;
    this._prewarmIdle = false;
  }

  // ===================================================================== init / lifecycle
  async init({ quality = 'high', fonts = true, battery = this.battery } = {}) {
    // 'auto' (or anything unknown) starts at 'high'; the controller picks the effective level
    this.quality = QUALITY_LEVELS[quality] ? quality : 'high';
    this.battery = !!battery;
    const Q = QUALITY_LEVELS[this.quality];
    this.resolution = resolutionFor(this.quality, this._dpr(), this.battery);
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
    if (this._showLastMove === false) this.highlights.setShowLastMove(false);
    this._buildBackdrop();
    if (this._turnGlow != null) this.boardView.setTurnGlow(this._turnGlow, { flare: false });

    canvas.addEventListener('pointerdown', this._onPointerDown);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(this.host);
    }
    window.addEventListener('resize', this._onResize);
    canvas.addEventListener('webglcontextrestored', this._onContextRestored);
    const tk = this.app.ticker;
    tk.add(this._tick, this);
    // present through the scheduler instead of Pixi's unconditional render-every-tick
    tk.remove(this.app.render, this.app);
    tk.add(this._present, this, UPDATE_PRIORITY.LOW);
    this.ready = true;
    this._applyFpsCap();
    this._applyLayout(true);
    if (this.staticBackdrop && this.backdrop) this.backdrop.setStatic(true);
    if (this.autoPrewarm) this._prewarmTimer = setTimeout(() => {
      this._prewarmTimer = 0;
      this.prewarm();
    }, 3000);
    return this;
  }

  /**
   * Generate the procedural tiles of `themes` ahead of time in small slices while the renderer
   * is idle (requestIdleCallback when available): a later theme switch then only composes cached
   * tiles instead of freezing on a noise loop. Safe to call any time; done tiles are skipped.
   */
  prewarm(themes = ['classic', 'epic']) {
    for (const t of themes) this._prewarmQueue.push(...boardTileJobs(t), ...backdropTileJobs(t));
    this._schedulePrewarm();
  }

  _schedulePrewarm() {
    if (this._prewarmTimer || !this._prewarmQueue.length || this._destroyed) return;
    const run = (deadline) => {
      this._prewarmTimer = 0;
      this._prewarmIdle = false;
      if (this._destroyed) return;
      // never compete with an animation: wait until the renderer is idle
      if (this.ready && !this.idle) {
        this._prewarmTimer = setTimeout(() => {
          this._prewarmTimer = 0;
          this._schedulePrewarm();
        }, 400);
        return;
      }
      // ≤ 8 ms per slice (an idle 30 fps frame has ~25 ms to spare); at least 5 ms even when the
      // callback came from its timeout, so a busy main thread still makes progress
      const left = deadline && typeof deadline.timeRemaining === 'function' && !deadline.didTimeout ? deadline.timeRemaining() : 6;
      const budget = Math.max(5, Math.min(8, left));
      const t0 = this._now();
      const q = this._prewarmQueue;
      try {
        while (q.length) {
          const spent = this._now() - t0;
          if (spent >= budget) break;
          const job = q[0]();
          if (!job || job.step(budget - spent)) q.shift();
        }
      } catch (e) {
        q.shift();
        this._frameError('prewarm', e);
      }
      this._schedulePrewarm();
    };
    if (typeof requestIdleCallback === 'function') {
      this._prewarmIdle = true;
      this._prewarmTimer = requestIdleCallback(run, { timeout: 250 });
    } else {
      this._prewarmTimer = setTimeout(run, 30);
    }
  }

  _cancelPrewarm() {
    if (!this._prewarmTimer) return;
    if (this._prewarmIdle && typeof cancelIdleCallback === 'function') cancelIdleCallback(this._prewarmTimer);
    else clearTimeout(this._prewarmTimer);
    this._prewarmTimer = 0;
    this._prewarmQueue.length = 0;
  }

  _dpr() {
    return (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
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
    this.wake(true);
  }

  destroy() {
    if (!this.ready) return;
    this.ready = false;
    this._destroyed = true;
    this._cancelPrewarm();
    this.app.ticker.remove(this._tick, this);
    this.app.ticker.remove(this._present, this);
    this.clock.onActivity = null;
    this.app.canvas.removeEventListener('pointerdown', this._onPointerDown);
    this.app.canvas.removeEventListener('webglcontextrestored', this._onContextRestored);
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
    for (const skin of this._skinCache.values()) skin.destroy();
    if (this._pieceSkin && !this._pieceSkin.destroyed) this._pieceSkin.destroy();
    this._skinCache.clear();
    this._pieceSkin = null;
    this.app.destroy(true, { children: true });
    this._squareTapFns = [];
    this._tapFns = [];
  }

  /** 'high' | 'medium' | 'low' ('auto' / unknown: ignored — the controller resolves 'auto'). */
  setQuality(q) {
    if (!QUALITY_LEVELS[q] || q === this.quality) return;
    this.quality = q;
    if (this.ready) {
      this.boardView.setQuality(q);
      if (this.backdrop) this.backdrop.setQuality(q);
    }
    this._applyResolution(true);
  }

  /** Recompute the render resolution (quality / battery / DPR); rebuild textures when it changed. */
  _applyResolution(force = false) {
    const res = resolutionFor(this.quality, this._dpr(), this.battery);
    const changed = Math.abs(res - this.resolution) > 1e-6;
    this.resolution = res;
    if (!this.ready || (!changed && !force)) return;
    if (changed) this.app.renderer.resize(this._sw, this._sh, this.resolution);
    this._applyLayout(true);
    this.wake(true);
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
    this.wake(true);
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
    this.wake();
  }

  /** Flip the view without rebuilding the position (keeps pieces). */
  setFlipped(flipped) {
    if (!!flipped === this.flipped) return;
    this.flipped = !!flipped;
    this._applyLayout(true);
    this.wake();
  }

  setBoardRect(rect) {
    if (!rect) {
      this._rect = null;
    } else {
      this._rect = { x: +rect.x || 0, y: +rect.y || 0, width: Math.max(10, +rect.width || 0), height: Math.max(10, +rect.height || 0) };
    }
    if (this.ready) this._applyLayout(false);
    this.wake();
  }

  /** Epic edge glow colour: side (1 / -1), a hex colour or null (off). */
  setTurnGlow(color, opts) {
    this._turnGlow = color;
    if (this.boardView) this.boardView.setTurnGlow(color, opts);
    this.wake();
  }

  /** Epic backdrop: trigger a distant lightning strike now (no-op in classic / static backdrop). */
  lightning() {
    if (this.backdrop && typeof this.backdrop.lightning === 'function') this.backdrop.lightning();
    this.wake();
  }

  _buildBackdrop() {
    if (this.backdrop) {
      this.backdrop.destroy();
      this.backdrop = null;
    }
    this.backdrop = this.theme === 'epic' ? new EpicBackdrop(this, this.quality) : new ClassicBackdrop(this);
    this.layers.background.addChild(this.backdrop.container);
    this.backdrop.resize(this._sw, this._sh);
    if (typeof this.backdrop.setStatic === 'function') this.backdrop.setStatic(this.staticBackdrop);
    if (this.layout) this.backdrop.setBoard({ x: this.layout.x, y: this.layout.y, width: this.layout.total, height: this.layout.total });
  }

  // ===================================================================== settings
  /**
   * Personal settings (live object; SETTINGS CONTRACT). Idempotent and cheap: call it on every
   * 'settings' event. Reads showCoords, showLastMove, fx.backdrop and battery (render scale 1 +
   * 30 fps + static backdrop). settings.quality is NOT applied here: the controller owns the
   * effective level ('auto' resolution, adaptive step-down, URL override) and calls setQuality() —
   * applying it from two places would rebuild every texture back and forth when they disagree.
   */
  applySettings(settings) {
    if (!settings || typeof settings !== 'object') return;
    this.settings = settings;
    const fx = settings.fx && typeof settings.fx === 'object' ? settings.fx : {};
    const battery = settings.battery === true;
    const coords = settings.showCoords !== false;
    const lastMove = settings.showLastMove !== false;
    const staticBg = battery || fx.backdrop === false;

    if (battery !== this.battery) {
      this.battery = battery;
      this._applyResolution(false);
    }
    this._applyFpsCap();
    if (coords !== this.showCoords) {
      this.showCoords = coords;
      if (this.ready) this._applyLayout(true);
    }
    this._showLastMove = lastMove;
    if (this.highlights) this.highlights.setShowLastMove(lastMove);
    this.setStaticBackdrop(staticBg);
    this.wake();
  }

  /** Static (frozen) epic backdrop: no nebula refresh, no embers, no lightning. */
  setStaticBackdrop(on) {
    on = !!on;
    if (on === this.staticBackdrop) return;
    this.staticBackdrop = on;
    if (this.backdrop && typeof this.backdrop.setStatic === 'function') this.backdrop.setStatic(on);
    this.wake(true);
  }

  /**
   * Epic energy colours of the two sides: { 1: hex, -1: hex } (either may be missing → default)
   * or null for the defaults (cyan / crimson). Re-skins epic pieces (cached per colour pair), their
   * glows, the turn glow, selectable rings and the last-move neon. Classic ignores colours.
   */
  setSideColors(colors) {
    let next = null;
    if (colors && typeof colors === 'object') {
      const c = skinColors(colors);
      if (c[1] !== EPIC.side[1] || c[-1] !== EPIC.side[-1]) next = c;
    }
    const cur = this._sideColors;
    if ((!next && !cur) || (next && cur && next[1] === cur[1] && next[-1] === cur[-1])) return;
    this._sideColors = next;
    if (!this.ready) return;
    if (this.theme === 'epic') {
      this._refreshSkin();
      if (this.boardView) this.boardView.refreshSideColors();
      if (this.highlights) this.highlights.refreshSideColors();
    }
    this.wake(true);
  }

  /** Current custom colours ({ 1, -1 }) or null. */
  get sideColors() {
    return this._sideColors ? { 1: this._sideColors[1], [-1]: this._sideColors[-1] } : null;
  }

  /** Epic energy colour of a side (custom or default), whatever the current theme. */
  epicSideColor(side) {
    if (side !== 1 && side !== -1) return EPIC.grid;
    const c = this._sideColors;
    return c && c[side] != null ? c[side] : EPIC.side[side];
  }

  /**
   * THE side colour for FX / Director: the (custom) energy colour in epic, CLASSIC.accent in
   * classic. A number that is not a side is returned as is (hex pass-through).
   */
  sideColor(side) {
    if (side === 1 || side === -1) return this.theme === 'epic' ? this.epicSideColor(side) : CLASSIC.accent[side];
    return typeof side === 'number' ? side : EPIC.grid;
  }

  // ===================================================================== frame scheduling
  /** Frame-rate cap (fps) through app.ticker.maxFPS; 0 / null = uncapped. Battery saver → ≤ 30. */
  setFpsCap(n) {
    const v = Number(n);
    this._userFpsCap = Number.isFinite(v) && v > 0 ? Math.max(5, Math.min(240, v)) : 0;
    this._applyFpsCap();
  }

  _applyFpsCap() {
    const base = this._userFpsCap;
    const cap = this.battery ? (base > 0 ? Math.min(base, BATTERY.fps) : BATTERY.fps) : base;
    this.fpsCap = cap;
    const tk = this.app && this.app.ticker;
    if (tk) tk.maxFPS = tickerMaxFps(cap);
  }

  /**
   * Something is about to move / change: present every frame again (idle mode ends). Cheap — call
   * it freely. force = true also guarantees the next frame is presented in render-on-demand mode.
   */
  wake(force = false) {
    this._woke = true;
    if (force) this._forceRender = true;
    if (this.idle) this._forceRender = true;
  }

  /** fn() → truthy while something animates that the renderer cannot see. Returns an unsubscribe. */
  addActivityProbe(fn) {
    if (typeof fn !== 'function') return () => {};
    this._probes.push(fn);
    return () => {
      const i = this._probes.indexOf(fn);
      if (i >= 0) this._probes.splice(i, 1);
    };
  }

  /** An opaque UI covers the whole canvas: present nothing (and refresh nothing) until false. */
  setOccluded(on) {
    on = !!on;
    if (on === this.occluded) return;
    this.occluded = on;
    if (!on) this.wake(true);
  }

  /** Is anything animating right now (tweens / waits, camera, FX layers, probes, input)? */
  _isActive() {
    if (this._woke) return true;
    if (this.clock.hasTasks) return true; // tweens / waits / camera focus & punch
    if (this.camera.shaking) return true;
    const st = this.app && this.app.stage;
    if (st && st.filters && st.filters.length) return true;
    const L = this.layers;
    if (layerBusy(L.screenFx, 3) || layerBusy(L.overlay, 3) || layerBusy(L.worldFx, 3) || layerBusy(L.boardFx, 3)) return true;
    for (let i = 0; i < this._probes.length; i++) {
      try {
        if (this._probes[i]()) return true;
      } catch (e) {
        this._frameError('probe', e);
      }
    }
    return false;
  }

  /** Did the stage change since the last presented frame (or does it animate filters)? */
  _sceneDirty() {
    const st = this.app && this.app.stage;
    if (!st) return true;
    if (st.filters && st.filters.length) return true;
    const L = this.layers;
    for (const k of ['background', 'world', 'screenFx', 'overlay']) if (L[k].filters && L[k].filters.length) return true;
    return groupDirty(st.renderGroup);
  }

  /** Decide whether this ticked frame is presented. */
  _shouldPresent(now) {
    if (this.occluded) return false;
    if (this._forceRender || !this.idle) return true;
    const since = now - this._lastRender;
    if (since < 1000 / IDLE_FPS - 6) return false;
    if (this.theme === 'epic' && !this.staticBackdrop) return true;
    if (since >= HEARTBEAT_MS) return true;
    return this._sceneDirty() || !!(this.backdrop && this.backdrop.rtDue);
  }

  /** Ticker (LOW priority, after _tick): present the frame when the scheduler says so. */
  _present() {
    if (!this.ready) return;
    const now = this._now();
    if (!this._shouldPresent(now)) {
      this.stats.skipped++;
      return;
    }
    if (this.backdrop) {
      this._guard('backdrop', () => {
        if (this.backdrop.prerender()) this.stats.rtRenders++;
      });
    }
    this._forceRender = false;
    this._lastRender = now;
    this.stats.renders++;
    if (this.idle) this.stats.idleRenders++;
    this.app.render();
  }

  /**
   * Perf snapshot: frame scheduling state, render resolution, GPU texture memory (MB, from the
   * texture system's managed sources) and counters (ticks / presented / skipped / nebula RT renders).
   */
  perfStats() {
    const out = {
      quality: this.quality,
      resolution: this.resolution,
      battery: this.battery,
      fpsCap: this.fpsCap,
      maxFPS: this.app && this.app.ticker ? this.app.ticker.maxFPS : 0,
      idle: this.idle,
      idleMode: this.idleMode,
      occluded: this.occluded,
      staticBackdrop: this.staticBackdrop,
      ...this.stats,
      textures: 0,
      textureMB: 0,
      skins: this._skinCache.size,
    };
    try {
      const ts = (this.app.renderer.texture.managedTextures || []).filter(Boolean);
      let bytes = 0;
      for (const s of ts) bytes += (s.pixelWidth || 0) * (s.pixelHeight || 0) * 4;
      out.textures = ts.length;
      out.textureMB = +(bytes / 1048576).toFixed(2);
    } catch (e) {
      /* not initialised */
    }
    return out;
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
    this.wake(true);
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
      labels: this.showCoords !== false && n <= 8 && fw >= 11,
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
      prev.parity !== L.parity ||
      prev.labels !== L.labels;
    if (!changed) return;
    const sizeChanged = !prev || prev.sq !== L.sq || force;
    this.layout = L;
    this.squareSize = L.sq;
    this.boardCenter.x = L.x + L.total / 2;
    this.boardCenter.y = L.y + L.total / 2;

    this.boardView.build(this.theme, L, this.resolution);
    if (this.backdrop) this.backdrop.setBoard({ x: L.x, y: L.y, width: L.total, height: L.total });

    if (sizeChanged || !this._pieceSkin || this._pieceSkin.theme !== this.theme) this._refreshSkin();
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

  /** Options of the piece skin for the current theme / size / quality / colours. */
  _skinOpts() {
    const sq = this.layout ? this.layout.sq : this.squareSize;
    return {
      oversample: skinOversample(sq, this.quality),
      colors: this.theme === 'epic' ? this._sideColors : null,
    };
  }

  /** Make sure the pieces use the skin for the current state (cached per key, LRU). */
  _refreshSkin() {
    if (!this.layout) return;
    const sq = this.layout.sq;
    const opts = this._skinOpts();
    const key = skinKey(this.theme, sq, this.resolution, opts);
    if (this._pieceSkin && this._pieceSkin.key === key && !this._pieceSkin.destroyed) return;
    let skin = this._skinCache.get(key);
    if (skin && skin.destroyed) skin = null;
    if (skin) this._skinCache.delete(key);
    else skin = createPieceSkin(this.theme, sq, this.resolution, opts);
    this._skinCache.set(key, skin); // most recent last
    const old = this._pieceSkin;
    this._pieceSkin = skin;
    for (const v of this._live) {
      v.applySkin(skin);
      v._applyDim();
    }
    for (const v of this._pool) v.applySkin(skin);
    // evict the oldest unused skins (never the current one)
    for (const [k, s2] of this._skinCache) {
      if (this._skinCache.size <= Math.max(1, this.skinCacheSize)) break;
      if (s2 === skin) continue;
      this._skinCache.delete(k);
      if (!s2.destroyed) s2.destroy();
    }
    if (old && old !== skin && !old.destroyed && !this._skinCache.has(old.key)) old.destroy();
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

  /**
   * Square under a SCREEN point (CSS px relative to the canvas), or -1.
   * Touch tolerance (MUX-11): a tap slightly off the board (within `tolerance` squares of its edge)
   * counts for the edge square, and a tap on a non-playable square snaps to the nearest playable
   * neighbour when it lands within `tolerance` squares of that square's edge. Default tolerance:
   * 0.35 on 10×10 / 12×12 (26–30 px squares on phones), 0.25 on 8×8. Pass { tolerance: 0 } (or
   * squareAtExact) for the exact cell.
   */
  squareAt(screenX, screenY, opts = {}) {
    const L = this.layout;
    if (!L) return -1;
    const p = this.screenToWorld(screenX, screenY);
    let fx = (p.x - L.bx) / L.sq;
    let fy = (p.y - L.by) / L.sq;
    const n = L.n;
    const tol = opts.tolerance != null ? Math.max(0, +opts.tolerance || 0) : n >= 10 ? 0.35 : 0.25;
    if (!(fx >= 0 && fy >= 0 && fx < n && fy < n)) {
      if (!(fx >= -tol && fy >= -tol && fx < n + tol && fy < n + tol)) return -1;
      fx = Math.min(n - 1e-6, Math.max(0, fx));
      fy = Math.min(n - 1e-6, Math.max(0, fy));
    }
    let dc = Math.floor(fx);
    let dr = Math.floor(fy);
    const toSq = (r, c) => (this.flipped ? (n - 1 - r) * n + (n - 1 - c) : r * n + c);
    let sq = toSq(dr, dc);
    if (tol > 0 && L.playable !== 'all' && !this.isDarkSquare(sq)) {
      // the four edge neighbours of a non-playable square are playable: take the closest one
      const ux = fx - dc;
      const uy = fy - dr;
      const cand = [
        [ux, 0, -1],
        [1 - ux, 0, 1],
        [uy, -1, 0],
        [1 - uy, 1, 0],
      ].filter(([, r, c]) => dr + r >= 0 && dr + r < n && dc + c >= 0 && dc + c < n);
      cand.sort((a, b) => a[0] - b[0]);
      if (cand.length && cand[0][0] <= tol) {
        dr += cand[0][1];
        dc += cand[0][2];
        sq = toSq(dr, dc);
      }
    }
    return sq;
  }

  /** Exact cell under a screen point (no touch tolerance), or -1. */
  squareAtExact(screenX, screenY) {
    return this.squareAt(screenX, screenY, { tolerance: 0 });
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
    this.wake();
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
    this.wake();
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
    this.wake();
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
    this.wake();
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
    this.wake();
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
    this.wake();
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
  /**
   * One frame. Exception-safe: every stage is guarded on its own, so a throw in one effect /
   * view never stops the Pixi ticker (Ticker only requests the next frame when update() returns).
   */
  _tick(ticker) {
    this.stats.ticks++;
    this._guard('clock', () => this.clock.update(ticker.deltaMS));
    const gdt = this.clock.delta;
    const rdt = this.clock.realDelta;
    const t = this.clock.now / 1000;
    const rt = this.clock.realNow / 1000;
    this._guard('camera', () => {
      this.camera.update(rdt, gdt);
      this.camera.apply(this.layers.world);
    });
    if (this.backdrop) this._guard('backdrop', () => this.backdrop.update(gdt, rdt, t, this.camera));
    if (this.boardView) this._guard('board', () => this.boardView.update(gdt, rdt, t, rt));
    if (this.highlights) this._guard('highlights', () => this.highlights.update(rt));
    const live = this._live;
    for (let i = 0; i < live.length; i++) {
      const v = live[i];
      try {
        v.update(t, rt);
      } catch (e) {
        this._frameError('piece', e);
      }
    }
    // idle detection (after the updates: FX ran inside clock.update)
    const now = this._now();
    let active = true;
    try {
      active = this._isActive();
    } catch (e) {
      this._frameError('activity', e);
    }
    this._woke = false;
    if (active) this._lastActive = now;
    const idle = this.idleMode && now - this._lastActive > IDLE_DELAY_MS;
    if (!idle && this.idle) this._forceRender = true;
    this.idle = idle;
  }

  _guard(where, fn) {
    try {
      fn();
    } catch (e) {
      this._frameError(where, e);
    }
  }

  /** Log a per-frame failure at most once per second (a broken stage would otherwise flood). */
  _frameError(where, e) {
    this.frameErrors = (this.frameErrors || 0) + 1;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (this._lastFrameError && now - this._lastFrameError < 1000) return;
    this._lastFrameError = now;
    console.error(`[renderer] ${where} update failed`, e);
  }
}
