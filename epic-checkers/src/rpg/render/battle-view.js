// «Валькирии доски» — BattleView: the arena board, hero tokens and every battle cinematic
// (docs/RPG-ARCHITECTURE.md «Battle view», GDD §18).
//
//   const view = new BattleView({ renderer, fx, audio, native, settings, assets: RPG_ASSETS, voice: playVoice });
//   await view.init();  view.show();            // hide() restores the classic renderer layers untouched
//   view.setBoardRect(ui.boardSlotRect());  view.setBackground('bg-ash');
//   view.setState(state);                       // instant sync (tokens, HP, energy, statuses, seals, wards, zones)
//   await view.play(events, { state });         // animates the engine's event log, ends synced to `state`
//   view.highlight({ selectable, selected, moves, jumps, targets, area }); view.clearHighlight();
//   view.onTap(({ sq, unitId, x, y }) => …);  view.skip();  view.busy
//
// Additions (additive to the contract):
//   setFlipped(bool)      side −1 at the bottom (hot-seat Duel)
//   setSpeed(1 | 2)       battle speed (HUD ×1 / ×2); motion only — texts stay readable
//   setSafeRect(rect)     screen area free of the DOM HUD (kanji / labels stay inside)
//   applySettings(s)      live settings object (settings.fx.*, textTime, lang, rpgUltCinematic,
//                         rpgDamageNumbers)
//   preview([{ unitId | sq, amount, ko, reaction, heal }]) / clearPreview()   damage forecast labels
//   squareCenter(sq) → world {x, y};  screenPointOf(sq | unitId) → screen {x, y};  sqAt(screenX, screenY)
//   stats()               debug: sprites / tokens / numbers / pools
//
// Layers: the view owns its containers and inserts them into the Renderer's layers on show():
//   background:  arena art, ambient motes, vignette, cinematic dim
//   world:       [classic board — hidden] → board (tiles, decals, glows, highlights, ground VFX)
//                → [FX boardFx] → units (shadows, ground rings, bodies, glows, bars & chips)
//                → VFX over units → [FX worldFx] → numbers & labels
//   screenFx:    cut-ins, skill / ult name plates
// Choreography runs on renderer.clock (slow-mo / hit-stop aware); numbers animate in real time.
// Settings: settings.fx.shake / flashes / camera / slowmo / particles / cutins / kanji are honoured
// (FX gates its own primitives, this view gates its camera moves, dims and cut-ins).

import { Container, Sprite, Texture } from 'pixi.js';
import { animate, wait as clockWait, Ease } from '../../render/tween.js';
import { fxPref, hapticsOf, hapticScale, animSpeedOf, readMs } from '../../fx/prefs.js';
import { HERO_BY_ID } from '../data/heroes.js';
import { RPG_ASSETS } from '../assets.js';
import { computeLayout, sqCenter, sqAt as layoutSqAt, focusFor, coverFit, safeRectFor, sqDist, onDiagonal } from './layout.js';
import { IconAtlas, TokenAtlas, paintBoard, paintEdgeGlow, vignetteTexture, loadImage, imageTexture, hasDom, GlyphFont } from './art.js';
import { TokenView, WardView, TOKEN_D } from './tokens.js';
import { FloatingNumbers } from './numbers.js';
import { Highlights } from './highlights.js';
import { VFX } from './vfx.js';
import { CutIn } from './cutin.js';
import { playUltimate } from './ults.js';
import { ABORT } from './abort.js';
import { parseBeats, hitGroups, targetsOf, VoiceGate, isChainDamage } from './timeline.js';
import {
  ELEMENT_FX, REACTION_FX, SIDE_COLORS, BUDGET, GOLD, boardTheme, elementFx, word, mix, css, shade, formatAmount,
} from './theme.js';

/** Thrown inside choreography when skip() / hide() cuts a cinematic short. */
export { ABORT };

const DOT_LABELS = new Set(['burn', 'lava', 'eruption', 'zone', 'dot', 'collapse', 'regen', 'fireRain']);
const BG_BY_CHAPTER = { 1: 'bg-dawn', 2: 'bg-ash', 3: 'bg-sky' };
const NOOP = () => {};

export class BattleView {
  constructor({ renderer, fx, audio = null, native = null, settings = null, assets = RPG_ASSETS, voice = null } = {}) {
    if (!renderer) throw new Error('BattleView needs the main Renderer');
    this.renderer = renderer;
    this.fx = fx || null;
    this.audio = audio;
    this.native = native;
    this.settings = settings || null;
    this.assets = assets || RPG_ASSETS;
    this.voice = typeof voice === 'function' ? voice : null;
    this.clock = renderer.clock;
    this.ready = false;
    this.shown = false;
    this.flipped = false;
    this.lang = (settings && settings.lang) === 'en' ? 'en' : 'ru';
    this.layout = null;
    this.state = null;
    this.bgId = null;
    this._bgAuto = true;
    this.tokens = new Map();
    this.wards = new Map();
    this._tapFns = [];
    this._gen = 0;
    this._busy = false;
    this._skipping = false;
    this._playing = null;
    this._tasks = new Set();
    this._fxTracked = new Set();
    this._speed = 1;
    this._safe = null;
    this._deadline = null; // game-clock end of the running beat's time budget (see _budgeted)
    this._seenUlt = new Set();
    this.voiceGate = new VoiceGate(2);
    this.round = 0;
    this._decals = [];
    this._warnings = new Map();
    this._previews = [];
    this._splash = new Map();
    this._screen = { width: 0, height: 0 };
    this._saved = null;
    this._motes = [];
    this._tmp = { x: 0, y: 0 };
  }

  // ===================================================================== lifecycle
  /** Load fonts, paint the static atlases and build the containers (call once, after renderer.init()). */
  async init() {
    if (this.ready) return this;
    await loadFonts();
    const res = this._res();
    this.icons = new IconAtlas(res);
    this.layers = this._makeLayers();
    this.numbers = new FloatingNumbers(this);
    this.numbers.build(res);
    this.previewFont = this.numbers.fonts ? this.numbers.fonts.white : null;
    this.hl = new Highlights(this);
    this.vx = new VFX(this);
    this.cutin = new CutIn(this);
    this.tokenAtlas = null;
    this._vignette = vignetteTexture(0x05030c);
    this.bgVignette.texture = this._vignette;
    this._onTap = this._onTap.bind(this);
    this._tick = this._tick.bind(this);
    this.ready = true;
    this.applySettings(this.settings);
    return this;
  }

  _res() {
    const r = this.renderer.resolution || (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    return Math.max(1, Math.min(2.5, r));
  }

  _makeLayers() {
    const mk = (label, parent, blend) => {
      const c = new Container();
      c.label = label;
      if (blend) c.blendMode = blend;
      if (parent) parent.addChild(c);
      return c;
    };
    const L = {};
    // background (screen space)
    L.bgRoot = mk('rpg-bg');
    this.bgSprite = new Sprite(Texture.WHITE);
    this.bgSprite.tint = 0x0a0814;
    L.bgRoot.addChild(this.bgSprite);
    L.bgMotes = mk('rpg-bg-motes', L.bgRoot);
    this.bgVignette = new Sprite(Texture.WHITE);
    this.bgVignette.alpha = 0.9;
    L.bgRoot.addChild(this.bgVignette);
    this.bgDim = new Sprite(Texture.WHITE);
    this.bgDim.tint = 0x000000;
    this.bgDim.alpha = this._bgBase();
    L.bgRoot.addChild(this.bgDim);
    // board (world)
    L.boardRoot = mk('rpg-board');
    this.boardSprite = new Sprite(Texture.WHITE);
    this.boardSprite.visible = false;
    L.boardRoot.addChild(this.boardSprite);
    L.decals = mk('rpg-decals', L.boardRoot);
    L.boardGlow = mk('rpg-board-glow', L.boardRoot);
    this.edgeGlow = new Sprite(Texture.WHITE);
    this.edgeGlow.anchor.set(0.5);
    this.edgeGlow.blendMode = 'add';
    this.edgeGlow.visible = false;
    L.boardGlow.addChild(this.edgeGlow);
    this.arenaGlow = new Sprite(Texture.WHITE);
    this.arenaGlow.anchor.set(0.5);
    this.arenaGlow.blendMode = 'add';
    this.arenaGlow.visible = false;
    L.boardGlow.addChild(this.arenaGlow);
    L.decalGlow = mk('rpg-decal-glow', L.boardGlow);
    L.hlUnder = mk('rpg-hl-under', L.boardRoot);
    L.hlAdd = mk('rpg-hl-add', L.boardRoot);
    this.worldDim = new Sprite(Texture.WHITE);
    this.worldDim.tint = 0x000000;
    this.worldDim.alpha = 0;
    this.worldDim.visible = false;
    L.boardRoot.addChild(this.worldDim);
    L.vfxUnder = mk('rpg-vfx-under', L.boardRoot);
    // units (world)
    L.unitsRoot = mk('rpg-units');
    L.shadows = mk('rpg-shadows', L.unitsRoot);
    L.ground = mk('rpg-ground', L.unitsRoot);
    L.base = mk('rpg-base', L.unitsRoot);
    L.glow = mk('rpg-glow', L.unitsRoot);
    L.hlTop = mk('rpg-hl-top', L.unitsRoot);
    L.top = mk('rpg-top', L.unitsRoot);
    for (const c of [L.ground, L.glow, L.hlAdd, L.hlTop, L.decalGlow, L.bgMotes, L.vfxUnder]) c.blendMode = 'add';
    // vfx over units (world)
    L.vfxRoot = mk('rpg-vfx');
    L.vfxOverN = mk('rpg-vfx-over-n', L.vfxRoot);
    L.vfxOver = mk('rpg-vfx-over', L.vfxRoot);
    L.vfxOver.blendMode = 'add';
    // numbers / labels (world, above FX)
    L.topRoot = mk('rpg-numbers');
    L.numbersGlow = mk('rpg-numbers-glow', L.topRoot);
    L.numbersGlow.blendMode = 'add';
    L.numbers = mk('rpg-numbers-text', L.topRoot);
    L.labels = mk('rpg-labels', L.topRoot);
    L.previews = mk('rpg-previews', L.topRoot);
    // screen
    L.screenRoot = mk('rpg-screen');
    return L;
  }

  /** Attach to the renderer: hide the classic board / pieces / backdrop, insert our layers. */
  show() {
    if (!this.ready) throw new Error('BattleView.init() first');
    if (this.shown) return;
    const r = this.renderer;
    const RL = r.layers;
    const L = this.layers;
    const saved = { vis: [], staticBackdrop: r.staticBackdrop, fxMode: this.fx ? this.fx.mode : null, safeRect: this.fx ? this.fx.safeRect : null };
    const hideNode = (n) => {
      if (!n) return;
      saved.vis.push([n, n.visible]);
      n.visible = false;
    };
    hideNode(RL.board);
    hideNode(RL.highlights);
    hideNode(RL.pieces);
    hideNode(r.pieceTopLayer);
    if (r.backdrop && r.backdrop.container) hideNode(r.backdrop.container);
    this._saved = saved;
    // the hidden epic backdrop would keep re-rendering its nebula RT: freeze it while we are up
    if (typeof r.setStaticBackdrop === 'function') r.setStaticBackdrop(true);
    RL.background.addChild(L.bgRoot);
    const world = RL.world;
    world.addChildAt(L.boardRoot, Math.min(world.children.length, world.getChildIndex(RL.board) + 1));
    world.addChildAt(L.unitsRoot, world.getChildIndex(RL.worldFx));
    world.addChildAt(L.vfxRoot, world.getChildIndex(RL.worldFx));
    world.addChild(L.topRoot);
    RL.screenFx.addChild(L.screenRoot);
    if (this.fx) {
      this.fx.setMode('epic');
      this.fx.setLang(this.lang);
    }
    if (r.camera) r.camera.snap();
    this.clock.add(this._tick);
    this._offTap = typeof r.onTap === 'function' ? r.onTap(this._onTap) : null;
    this.shown = true;
    this._relayout(true);
    if (typeof r.wake === 'function') r.wake(true);
  }

  /** Detach and restore the classic renderer exactly as it was. */
  hide() {
    if (!this.shown) return;
    this._abortPlay();
    this._clearTransient();
    const r = this.renderer;
    const L = this.layers;
    this.clock.remove(this._tick);
    if (this._offTap) this._offTap();
    this._offTap = null;
    for (const c of [L.bgRoot, L.boardRoot, L.unitsRoot, L.vfxRoot, L.topRoot, L.screenRoot]) c.removeFromParent();
    const saved = this._saved;
    if (saved) {
      for (const [n, v] of saved.vis) n.visible = v;
      if (typeof r.setStaticBackdrop === 'function') r.setStaticBackdrop(saved.staticBackdrop);
      if (this.fx) {
        if (saved.fxMode) this.fx.setMode(saved.fxMode);
        this.fx.safeRect = saved.safeRect;
      }
    }
    this._saved = null;
    if (r.camera) r.camera.snap();
    this.shown = false;
    if (typeof r.wake === 'function') r.wake(true);
  }

  destroy() {
    this.hide();
    for (const t of this.tokens.values()) t.destroy();
    for (const w of this.wards.values()) w.destroy();
    this.tokens.clear();
    this.wards.clear();
    if (this.hl) this.hl.destroy();
    if (this.numbers) this.numbers.destroy();
    if (this.vx) this.vx.destroy();
    if (this.cutin) this.cutin.destroy();
    for (const t of this._splash.values()) if (t && t.tex && t.tex !== Texture.WHITE) t.tex.destroy(true);
    this._splash.clear();
    if (this.tokenAtlas) this.tokenAtlas.destroy();
    if (this.icons) this.icons.destroy();
    if (this.layers) for (const c of Object.values(this.layers)) if (!c.destroyed && !c.parent) c.destroy({ children: true });
    this.ready = false;
  }

  // ===================================================================== settings / config
  applySettings(settings) {
    if (settings && typeof settings === 'object') this.settings = settings;
    const s = this.settings;
    if (s && (s.lang === 'en' || s.lang === 'ru')) this.lang = s.lang;
    if (this.fx && this.shown) this.fx.setLang(this.lang);
    this._buildMotes();
    return this;
  }

  setLang(lang) {
    this.lang = lang === 'en' ? 'en' : 'ru';
    if (this.fx && this.shown) this.fx.setLang(this.lang);
  }

  pref(key) {
    return fxPref(this.settings, key);
  }

  /** Battle speed (HUD ×1 / ×2). */
  setSpeed(x) {
    const v = Number(x);
    this._speed = Number.isFinite(v) && v > 0 ? Math.max(0.5, Math.min(4, v)) : 1;
  }

  get speed() {
    return this._speed * animSpeedOf(this.settings);
  }

  /** Scaled choreography duration (ms). */
  T(ms) {
    return Math.max(1, ms / this.speed);
  }

  setFlipped(on) {
    on = !!on;
    if (on === this.flipped) return;
    this.flipped = on;
    this._relayout(false);
  }

  setSafeRect(rect) {
    this._safe = rect ? { x: +rect.x || 0, y: +rect.y || 0, width: +rect.width || 0, height: +rect.height || 0 } : null;
    this._applySafeRect();
  }

  _applySafeRect() {
    if (!this.fx || !this.shown) return;
    this.fx.safeRect = this._safe || (this.layout ? safeRectFor(this.layout, this.renderer.screen, 0.8) : null);
  }

  setBoardRect(rect) {
    if (!rect) return;
    this._rect = { x: +rect.x || 0, y: +rect.y || 0, width: Math.max(10, +rect.width || 0), height: Math.max(10, +rect.height || 0) };
    this._relayout(false);
  }

  setBackground(bgId) {
    this._bgAuto = false;
    this._setBg(bgId || 'bg-dawn');
  }

  _setBg(bgId) {
    const theme = boardTheme(bgId);
    if (this.bgId === theme.id && this.theme) return;
    this.bgId = theme.id;
    this.theme = theme;
    if (!this.ready) return;
    if (!this.worldDim.visible) this.bgDim.alpha = this._bgBase();
    this._boardKey = '';
    this._relayout(true);
    const url = this.assets && this.assets.bg ? this.assets.bg(theme.id) : null;
    this._bgImgKey = url;
    this.bgSprite.texture = Texture.WHITE;
    this.bgSprite.tint = theme.vignette;
    if (this._bgTex && this._bgTex !== Texture.WHITE) {
      this._bgTex.destroy(true);
      this._bgTex = null;
    }
    loadImage(url).then((img) => {
      if (!img || this._bgImgKey !== url || !this.ready) return;
      this._bgTex = imageTexture(img, 'rpg-bg');
      this.bgSprite.texture = this._bgTex;
      this.bgSprite.tint = 0xffffff;
      this._fitBg(true);
      this._wake();
    });
    this._buildMotes();
  }

  _wake() {
    if (typeof this.renderer.wake === 'function') this.renderer.wake(true);
  }

  // ===================================================================== geometry
  get sqSize() {
    return this.layout ? this.layout.sq : 40;
  }

  center(sq, out = { x: 0, y: 0 }) {
    return sqCenter(this.layout, sq, this.flipped, out);
  }

  /** World centre of a square (public, allocates). */
  squareCenter(sq) {
    return this.center(sq, { x: 0, y: 0 });
  }

  /** Screen point of a square or a unit (for DOM overlays anchored to the board). */
  screenPointOf(ref) {
    let p;
    if (typeof ref === 'number') p = this.center(ref, { x: 0, y: 0 });
    else {
      const t = this.tokens.get(ref) || this.wards.get(ref);
      p = t ? { x: t.x, y: t.y } : this.center(-1, { x: 0, y: 0 });
    }
    return typeof this.renderer.worldToScreen === 'function' ? this.renderer.worldToScreen(p.x, p.y) : p;
  }

  /** Square under a SCREEN point (or -1). */
  sqAt(x, y) {
    const w = typeof this.renderer.screenToWorld === 'function' ? this.renderer.screenToWorld(x, y) : { x, y };
    return layoutSqAt(this.layout, w.x, w.y, this.flipped, 0.25);
  }

  token(id) {
    return this.tokens.get(id) || null;
  }

  forEachToken(fn) {
    for (const t of this.tokens.values()) fn(t);
  }

  /** The token / ward view of an id. */
  piece(id) {
    return this.tokens.get(id) || this.wards.get(id) || null;
  }

  /** Is a square occupied (living unit or ward) in the view's current model? */
  occupied(sq) {
    for (const t of this.tokens.values()) if (t.alive && t.sq === sq) return true;
    for (const w of this.wards.values()) if (w.sq === sq) return true;
    return false;
  }

  unitAt(sq) {
    for (const t of this.tokens.values()) if (t.alive && t.sq === sq) return t;
    for (const w of this.wards.values()) if (w.sq === sq) return w;
    return null;
  }

  sideColorOf(side) {
    const r = this.renderer;
    if (typeof r.epicSideColor === 'function') {
      try {
        const c = r.epicSideColor(side);
        if (typeof c === 'number') return c;
      } catch (e) {
        /* default below */
      }
    }
    return SIDE_COLORS[side] != null ? SIDE_COLORS[side] : 0xffffff;
  }

  /** FX size compensation: FX scales with the classic square size, we want ours. */
  get k() {
    const fsq = this.fx ? this.fx.sq || 40 : 40;
    return this.sqSize / fsq;
  }

  _relayout(force) {
    if (!this.ready) return;
    const r = this.renderer;
    const scr = r.screen;
    const rect = this._rect || { x: 8, y: Math.max(8, (scr.height - scr.width) / 2), width: scr.width - 16, height: scr.width - 16 };
    const res = this._res();
    const L = computeLayout(rect, { resolution: res });
    const prev = this.layout;
    const sizeChanged = !prev || Math.abs(prev.sq - L.sq) > 0.01 || prev.fw !== L.fw;
    this.layout = L;
    if (!this.theme) this._setBg(this.bgId || 'bg-dawn');
    const theme = this.theme || boardTheme('bg-dawn');
    const key = `${theme.id}|${L.sq}|${L.fw}|${res}`;
    if (force || key !== this._boardKey) {
      this._boardKey = key;
      const old = this.boardSprite.texture;
      this.boardSprite.texture = paintBoard(theme, L, res);
      if (old && old !== Texture.WHITE) old.destroy(true);
      const oldGlow = this.edgeGlow.texture;
      const eg = paintEdgeGlow(L, res);
      this.edgeGlow.texture = eg;
      this.edgeGlow._pad = eg.pad || 0;
      if (oldGlow && oldGlow !== Texture.WHITE) oldGlow.destroy(true);
    }
    this.boardSprite.visible = true;
    this.boardSprite.position.set(L.x, L.y);
    this.boardSprite.width = L.total;
    this.boardSprite.height = L.total;
    this.edgeGlow.visible = hasDom();
    this.edgeGlow.position.set(L.cx, L.cy);
    this.edgeGlow.width = L.total + (this.edgeGlow._pad || 0) * 2;
    this.edgeGlow.height = this.edgeGlow.width;
    this.arenaGlow.texture = this.icons.frame('dot');
    this.arenaGlow.visible = true;
    this.arenaGlow.tint = theme.accent;
    this.arenaGlow.position.set(L.cx, L.cy);
    this.arenaGlow.width = this.arenaGlow.height = L.total * 1.25;
    // dim sprite: generously covers the visible world even when the camera zooms out a little
    this.worldDim.position.set(L.cx - scr.width * 1.5, L.cy - scr.height * 1.5);
    this.worldDim.width = scr.width * 3;
    this.worldDim.height = scr.height * 3;
    // token atlas: portraits at device resolution for the current square size
    const cell = Math.round(Math.max(64, Math.min(256, L.sq * TOKEN_D * 1.25 * Math.min(2.5, res))));
    if (!this.tokenAtlas || (sizeChanged && Math.abs(cell - this.tokenAtlas.cell) / this.tokenAtlas.cell > 0.15)) this._rebuildTokenAtlas(cell);
    for (const t of this.tokens.values()) {
      t.layout(L.sq);
      if (t.sq >= 0 && !t._moving) {
        const p = this.center(t.sq, this._tmp);
        t.setPos(p.x, p.y);
      }
    }
    for (const w of this.wards.values()) {
      w.layout(L.sq);
      const p = this.center(w.sq, this._tmp);
      w.setPos(p.x, p.y);
    }
    this._buildDecals();
    this.hl.relayout();
    this._fitBg(true);
    this._applySafeRect();
    this._wake();
  }

  _rebuildTokenAtlas(cell) {
    const old = this.tokenAtlas;
    this.tokenAtlas = new TokenAtlas({
      cellPx: cell,
      cols: 4,
      rows: 5,
      url: this.assets && this.assets.token ? (id) => this.assets.token(id) : null,
      onUpdate: () => this._wake(),
    });
    for (const t of this.tokens.values()) t.refreshPortrait();
    for (const w of this.wards.values()) if (w.body && w.art && !w.art.frame) w.body.texture = this.portraitTexture({ heroId: w.ownerHero || 'nocturna', look: 'decoy' });
    if (old) old.destroy();
  }

  portraitTexture(spec) {
    if (!this.tokenAtlas) return Texture.WHITE;
    return this.tokenAtlas.get(spec);
  }

  _fitBg(force) {
    const scr = this.renderer.screen;
    if (!force && scr.width === this._screen.width && scr.height === this._screen.height) return;
    this._screen = { width: scr.width, height: scr.height };
    const tex = this.bgSprite.texture;
    const L = this.layout;
    const theme = this.theme || boardTheme('bg-dawn');
    if (tex && tex !== Texture.WHITE) {
      const iw = tex.width;
      const ih = tex.height;
      const f = coverFit(iw, ih, scr.width, scr.height, theme.arena.x, theme.arena.y, L ? L.cx : scr.width / 2, L ? L.cy : scr.height / 2, 1.08);
      this.bgSprite.position.set(f.x, f.y);
      this.bgSprite.scale.set(f.scale);
      this._bgFit = f;
    } else {
      this.bgSprite.position.set(0, 0);
      this.bgSprite.width = scr.width;
      this.bgSprite.height = scr.height;
      this._bgFit = null;
    }
    this.bgVignette.position.set(0, 0);
    this.bgVignette.width = scr.width;
    this.bgVignette.height = scr.height;
    this.bgDim.position.set(0, 0);
    this.bgDim.width = scr.width;
    this.bgDim.height = scr.height;
    for (const m of this._motes) {
      if (m.x > scr.width) m.x = Math.random() * scr.width;
      if (m.y > scr.height) m.y = Math.random() * scr.height;
    }
  }

  // ===================================================================== ambient motes
  _buildMotes() {
    if (!this.ready) return;
    const L = this.layers;
    for (const m of this._motes) m.s.destroy();
    this._motes = [];
    const theme = this.theme || boardTheme(this.bgId || 'bg-dawn');
    const s = this.settings;
    const off = (s && (s.battery === true || (s.fx && s.fx.backdrop === false))) || !hasDom();
    if (off) return;
    const n = Math.round(theme.motes.count * fxPref(s, 'particles'));
    const scr = this.renderer.screen;
    const frame = theme.motes.kind === 'stars' ? 'spark' : 'dot';
    for (let i = 0; i < n; i++) {
      const sp = new Sprite(this.icons.frame(frame));
      sp.anchor.set(0.5);
      sp.tint = theme.motes.color;
      L.bgMotes.addChild(sp);
      const m = { s: sp, x: Math.random() * scr.width, y: Math.random() * scr.height, vx: 0, vy: 0, size: 0, ph: Math.random() * 10, kind: theme.motes.kind };
      this._resetMote(m, scr, true);
      this._motes.push(m);
    }
  }

  _resetMote(m, scr, anywhere) {
    if (m.kind === 'embers') {
      m.x = Math.random() * scr.width;
      m.y = anywhere ? Math.random() * scr.height : scr.height + 10;
      m.vx = (Math.random() - 0.5) * 12;
      m.vy = -(14 + Math.random() * 26);
      m.size = 3 + Math.random() * 4;
    } else if (m.kind === 'stars') {
      m.x = Math.random() * scr.width;
      m.y = Math.random() * scr.height * 0.95;
      m.vx = 1 + Math.random() * 2;
      m.vy = 0;
      m.size = 5 + Math.random() * 7;
    } else {
      m.x = anywhere ? Math.random() * scr.width : -10;
      m.y = Math.random() * scr.height;
      m.vx = 6 + Math.random() * 10;
      m.vy = -(2 + Math.random() * 5);
      m.size = 3 + Math.random() * 4;
    }
    const tw = m.s.texture.orig.width || 16;
    m.s.scale.set(m.size / tw);
  }

  _updateMotes(rdt) {
    if (!this._motes.length) return;
    const scr = this.renderer.screen;
    const dt = rdt / 1000;
    for (const m of this._motes) {
      m.ph += dt;
      m.x += m.vx * dt + Math.sin(m.ph * 0.9) * 4 * dt;
      m.y += m.vy * dt;
      if (m.x < -20 || m.x > scr.width + 20 || m.y < -20 || m.y > scr.height + 20) this._resetMote(m, scr, false);
      m.s.position.set(m.x, m.y);
      m.s.alpha = m.kind === 'stars' ? 0.25 + 0.6 * Math.max(0, Math.sin(m.ph * 1.7)) : m.kind === 'embers' ? 0.5 + 0.4 * Math.sin(m.ph * 7) : 0.35 + 0.25 * Math.sin(m.ph * 2);
    }
  }

  // ===================================================================== state sync
  /** Instant sync of the whole board to a BattleState. */
  setState(state, { animate: anim = false } = {}) {
    if (!state || !this.ready) return;
    this.state = state;
    if (state.round != null) this.round = state.round;
    if (this._bgAuto) {
      const ch = state.stage && state.stage.chapter;
      const bg = (state.stage && state.stage.bg) || BG_BY_CHAPTER[ch] || this.bgId || 'bg-dawn';
      if (boardTheme(bg).id !== this.bgId) this._setBg(bg);
    }
    if (!this.layout) this._relayout(true);
    // integration fix: the portrait atlas (4×5 cells) only grows, so after a few battles with
    // different heroines it was full and new tokens came out blank (Texture.WHITE). A state that
    // needs portraits the atlas has no room for starts a fresh atlas (a new battle: old tokens go).
    const atlas = this.tokenAtlas;
    if (atlas && atlas.cells) {
      const need = new Set((state.units || []).map((u) => `${u.heroId}|${u.reflection ? 'reflection' : 'hero'}`));
      let missing = 0;
      for (const k of need) if (!atlas.cells.has(k)) missing++;
      if (missing && atlas.cells.size + missing > atlas.cols * atlas.rows) {
        for (const t of this.tokens.values()) t.destroy();
        this.tokens.clear();
        this._rebuildTokenAtlas(atlas.cell);
      }
    }
    const seen = new Set();
    for (const u of state.units || []) {
      seen.add(u.id);
      let t = this.tokens.get(u.id);
      if (t && (t.heroId !== u.heroId || t.side !== u.side || t.look !== (u.reflection ? 'reflection' : 'hero') || (u.rarity && t.rarity !== u.rarity))) {
        // the id now names another heroine (a new battle reusing ids): rebuild the token
        t.destroy();
        this.tokens.delete(u.id);
        t = null;
      }
      if (!t) {
        t = new TokenView(this, u, HERO_BY_ID[u.heroId]);
        this.tokens.set(u.id, t);
        this._preloadSplash(u.heroId);
      }
      t.sq = u.sq;
      t.statusList = (u.statuses || []).map((s) => s.id || s);
      t.lift = 0;
      t._moving = false;
      t.setDim(1);
      t.setScale(1);
      t.setAlpha(1);
      t.sync(u, { animate: anim });
      if (u.alive && u.sq >= 0) {
        const p = this.center(u.sq, this._tmp);
        t.setPos(p.x, p.y);
      }
    }
    for (const [id, t] of this.tokens) {
      if (!seen.has(id)) {
        t.destroy();
        this.tokens.delete(id);
      }
    }
    const wseen = new Set();
    for (const w of state.wards || []) {
      wseen.add(w.id);
      let v = this.wards.get(w.id);
      if (v && v.kind !== (w.kind || 'ward')) {
        v.destroy();
        this.wards.delete(w.id);
        v = null;
      }
      if (!v) {
        const owner = (state.units || []).find((u) => u.id === w.owner) || null;
        v = new WardView(this, w, owner);
        v.ownerHero = owner ? owner.heroId : null;
        this.wards.set(w.id, v);
      }
      v.sq = w.sq;
      v.setHp(w.hp, w.maxHp);
      v.setAlpha(1);
      v.setDim(1);
      const p = this.center(w.sq, this._tmp);
      v.setPos(p.x, p.y);
    }
    for (const [id, v] of this.wards) {
      if (!wseen.has(id)) {
        v.destroy();
        this.wards.delete(id);
      }
    }
    this._sideGlow(state.side);
    this._buildDecals();
    this._wake();
  }

  _preloadSplash(heroId) {
    if (!heroId || !this.assets || !this.assets.splash) return;
    // download only (decoded lazily when the Ultimate gets close)
    loadImage(this.assets.splash(heroId));
  }

  /** Splash texture of a hero for cut-ins ({ tex, w, h } or null). LRU of 2 GPU copies. */
  async splashTexture(heroId) {
    if (!this.assets || !this.assets.splash) return null;
    const hit = this._splash.get(heroId);
    if (hit) {
      this._splash.delete(heroId);
      this._splash.set(heroId, hit);
      return hit;
    }
    // never hold a cinematic hostage to the network / decoder: fall back after 700 ms
    const img = await Promise.race([loadImage(this.assets.splash(heroId)), new Promise((r) => setTimeout(() => r(null), 700))]);
    if (!img) return null;
    const again = this._splash.get(heroId);
    if (again) return again;
    const rec = { tex: imageTexture(img, `rpg-splash:${heroId}`), w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
    this._splash.set(heroId, rec);
    while (this._splash.size > 2) {
      const [k, v] = this._splash.entries().next().value;
      if (this.cutin && this.cutin.usesTexture(v.tex)) break;
      this._splash.delete(k);
      if (v.tex) v.tex.destroy(true);
    }
    return rec;
  }

  _sideGlow(side) {
    if (side !== 1 && side !== -1) return;
    this._glowSide = side;
    this.edgeGlow.tint = this.sideColorOf(side);
  }

  // ------------------------------------------------------------------ decals (stage gimmicks, zones, holes)
  _buildDecals() {
    if (!this.ready || !this.layout) return;
    for (const d of this._decals) d.s.destroy();
    this._decals = [];
    const st = this.state;
    if (!st) return;
    const sq = this.sqSize;
    const p = { x: 0, y: 0 };
    const add = (frame, q, { glow = false, tint = 0xffffff, alpha = 1, size = 1, anim = null, tex = null } = {}) => {
      const s = new Sprite(tex || this.icons.frame(frame));
      s.anchor.set(0.5);
      s.tint = tint;
      s.alpha = alpha;
      this.center(q, p);
      s.position.set(p.x, p.y);
      const tw = s.texture.orig.width || 1;
      s.scale.set((sq * size) / tw);
      (glow ? this.layers.decalGlow : this.layers.decals).addChild(s);
      this._decals.push({ s, anim, base: alpha, ph: Math.random() * 6, sc: s.scale.x });
      return s;
    };
    const stage = st.stage || {};
    for (const q of stage.dew || []) add('dew', q, { alpha: 0.9, size: 0.9 });
    if (stage.lava) for (const q of stage.lava.sqs || []) add('lava', q, { glow: true, alpha: 0.85, size: 1, anim: 'flicker' });
    for (const pair of stage.portals || []) {
      for (const q of pair) add('portal', q, { glow: true, tint: 0xb9a8ff, alpha: 0.85, size: 0.92, anim: 'spin' });
    }
    for (const q of st.holes || []) add('square', q, { tint: 0x020106, alpha: 0.96, size: 1.0 });
    for (const z of st.zones || []) {
      const look = ZONE_LOOK[z.kind] || ZONE_LOOK.default;
      for (const q of z.sqs || []) {
        for (const part of look.parts || [look]) {
          if (part.fxFrame && this.fx) add(null, q, { tex: this.fx.textures.frame(part.fxFrame), glow: part.glow, tint: part.tint, alpha: part.alpha, size: part.size, anim: part.anim });
          else add(part.frame, q, { glow: part.glow, tint: part.tint, alpha: part.alpha, size: part.size, anim: part.anim });
        }
      }
    }
    for (const [, w] of this._warnings) for (const q of w.sqs) add('square', q, { glow: true, tint: 0xff3a2a, alpha: 0.5, size: 0.96, anim: 'warn' });
  }

  _updateDecals(rdt) {
    if (!this._decals.length) return;
    const dt = rdt / 1000;
    for (const d of this._decals) {
      if (!d.anim) continue;
      d.ph += dt;
      if (d.anim === 'flicker') d.s.alpha = d.base * (0.75 + 0.25 * Math.sin(d.ph * 5) * Math.sin(d.ph * 2.3));
      else if (d.anim === 'spin') d.s.rotation = d.ph * 0.9;
      else if (d.anim === 'warn') d.s.alpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(d.ph * 7));
      else if (d.anim === 'pulse') d.s.alpha = d.base * (0.7 + 0.3 * Math.sin(d.ph * 3));
    }
  }

  // ===================================================================== highlights / preview / input
  highlight(spec) {
    if (!this.ready) return;
    this.hl.set(spec || null);
    this._wake();
  }

  clearHighlight() {
    if (!this.ready) return;
    this.hl.clear();
    this._wake();
  }

  /** Damage forecast above targets: [{ unitId | sq, amount, ko, reaction, heal }]. */
  preview(list) {
    this.clearPreview();
    if (!this.ready || !Array.isArray(list) || !this.previewFont) return;
    const sq = this.sqSize;
    for (const it of list) {
      const t = it.unitId != null ? this.piece(it.unitId) : this.unitAt(it.sq);
      const p = t ? { x: t.x, y: t.y - (t.R || sq * 0.4) - sq * 0.28 } : this.center(it.sq, { x: 0, y: 0 });
      const c = new Container();
      c.position.set(p.x, p.y);
      const text = `${it.heal ? '+' : '−'}${formatAmount(it.amount || 0)}`;
      const size = sq * 0.3;
      const font = this.previewFont;
      const kk = size / font.size;
      let w = 0;
      for (const ch of text) w += (font.glyph(ch) ? font.glyph(ch).adv : font.size * 0.5) * kk;
      const extra = it.ko ? size : 0;
      let x = -(w + extra) / 2;
      const bg = new Sprite(Texture.WHITE);
      bg.tint = 0x07040c;
      bg.alpha = 0.78;
      bg.anchor.set(0.5);
      bg.width = w + extra + size * 0.6;
      bg.height = size * 1.25;
      c.addChild(bg);
      for (const ch of text) {
        const g = font.glyph(ch);
        if (!g) continue;
        const s = new Sprite(g.tex);
        s.anchor.set(0, 0.5);
        s.scale.set(kk);
        s.position.set(x - (g.pad || 0) * kk, 0);
        s.tint = it.heal ? 0x5cff9d : it.ko ? 0xff5a5a : 0xffffff;
        c.addChild(s);
        x += g.adv * kk;
      }
      if (it.ko) {
        const sk = new Sprite(this.icons.frame('skull'));
        sk.anchor.set(0.5);
        sk.tint = 0xff5a5a;
        sk.scale.set((size * 0.9) / 24);
        sk.position.set(x + size * 0.55, 0);
        c.addChild(sk);
      }
      if (it.reaction && REACTION_FX[it.reaction]) {
        const R = REACTION_FX[it.reaction];
        const tex = this.labelTexture(R.kanji, R.colors, Math.round(size * 1.1));
        if (tex) {
          const s = new Sprite(tex);
          s.anchor.set(0.5);
          s.position.set(0, -size * 1.05);
          c.addChild(s);
          this._previews.push({ c, tex });
          this.layers.previews.addChild(c);
          continue;
        }
      }
      this._previews.push({ c, tex: null });
      this.layers.previews.addChild(c);
    }
    this._wake();
  }

  clearPreview() {
    for (const p of this._previews) {
      if (p.tex) this.releaseText(p.tex);
      p.c.destroy({ children: true });
    }
    this._previews = [];
  }

  /**
   * fn(on, info) when a full-screen cinematic (an Ultimate) starts (true) / ends (false): the UI may
   * fade its HUD chrome meanwhile (ui.hud.setCinematic). Returns an unsubscribe function.
   */
  onCinematic(fn) {
    if (typeof fn !== 'function') return NOOP;
    this._cineFns = this._cineFns || [];
    this._cineFns.push(fn);
    return () => {
      const i = this._cineFns.indexOf(fn);
      if (i >= 0) this._cineFns.splice(i, 1);
    };
  }

  emitCinematic(on, info = {}) {
    if (!!on === !!this._cineOn) return;
    this._cineOn = !!on;
    for (const fn of (this._cineFns || []).slice()) {
      try {
        fn(!!on, info);
      } catch (e) {
        console.error('[rpg-render] cinematic handler failed', e);
      }
    }
  }

  onTap(fn) {
    if (typeof fn !== 'function') return NOOP;
    this._tapFns.push(fn);
    return () => {
      const i = this._tapFns.indexOf(fn);
      if (i >= 0) this._tapFns.splice(i, 1);
    };
  }

  _onTap({ x, y } = {}) {
    if (!this.shown) return;
    const sq = this.sqAt(x, y);
    const t = sq >= 0 ? this.unitAt(sq) : null;
    const ev = { sq, unitId: t ? t.id : null, x, y };
    for (const fn of this._tapFns.slice()) {
      try {
        fn(ev);
      } catch (e) {
        console.error('[rpg-render] tap handler failed', e);
      }
    }
  }

  // ===================================================================== text labels
  /** Cached anime lettering in a two-colour gradient (FX texture cache: release with releaseText). */
  labelTexture(text, colors = [0xffffff, 0xffd23f], size = 20, { font = '"Dela Gothic One"', weight } = {}) {
    if (!this.fx || !this.fx.textures || !hasDom()) return null;
    const [a, b] = colors;
    const res = Math.min(2.5, Math.max(1.5, this._res() * 1.25));
    const sz = Math.max(8, Math.round(size));
    const style = {
      key: `rv|${sz}|${a}|${b}|${res}|${font}|${weight || ''}`,
      font,
      weight,
      size: sz,
      fill: [css(mix(a, 0xffffff, 0.7)), css(a), css(mix(a, b, 0.55)), css(b)],
      // small lettering gets a thinner ink line, or kanji / Cyrillic fill up into blobs
      stroke: { color: '#05020a', width: sz < 20 ? Math.max(1.1, sz * 0.085) : sz * 0.12 },
      glow: { color: css(a), blur: sz * (sz < 20 ? 0.18 : 0.3), alpha: 0.85 },
      shadow: sz < 20 ? undefined : { dx: sz * 0.03, dy: sz * 0.05, color: '#000000' },
      shine: 0.55,
      res,
    };
    try {
      return this.fx.textures.text(text, style, 7);
    } catch (e) {
      return null;
    }
  }

  releaseText(tex) {
    if (tex && this.fx && this.fx.textures) this.fx.textures.releaseText(tex);
  }

  /** A world-space label that pops, holds (readable) and fades. Fire-and-forget. */
  floatLabel(text, x, y, { colors = [0xffffff, GOLD], size, hold, rise = 0.3, delay = 0 } = {}) {
    const tex = this.labelTexture(text, colors, size || this.sqSize * 0.42);
    if (!tex) return Promise.resolve(false);
    const s = new Sprite(tex);
    s.anchor.set(0.5);
    s.position.set(x, y);
    s.alpha = 0;
    s.scale.set(0.6);
    this.layers.labels.addChild(s);
    const holdMs = hold != null ? hold : readMs(text, 'kanji', this.settings);
    const dur = 160 + holdMs + 260;
    const sq = this.sqSize;
    // keep it on screen
    const scr = this.renderer.screen;
    const hw = (tex.fx ? tex.fx.textWidth : tex.width) / 2 + 6;
    const w2s = typeof this.renderer.worldToScreen === 'function' ? this.renderer.worldToScreen(x, y) : { x, y };
    if (w2s.x - hw < 0) s.x += -(w2s.x - hw);
    else if (w2s.x + hw > scr.width) s.x -= w2s.x + hw - scr.width;
    // damage numbers keep clear of this label while it is up
    if (this.numbers) this.numbers.block(s.x, y - sq * rise, hw * 2, (tex.fx && tex.fx.height ? tex.fx.height : tex.height) * 0.8, (delay || 0) + dur);
    const p = animate(
      dur,
      (e, k) => {
        const t = k * dur;
        const pin = Math.min(1, t / 160);
        s.scale.set(0.6 + 0.4 * Ease.outBack(pin));
        s.alpha = t < dur - 260 ? Math.min(1, t / 120) : Math.max(0, (dur - t) / 260);
        s.y = y - sq * rise * Ease.outCubic(Math.min(1, t / 600));
      },
      { clock: this.clock, realtime: true, delay },
    );
    return p.then((ok) => {
      s.destroy();
      this.releaseText(tex);
      return ok;
    });
  }

  // ===================================================================== animation helpers
  /** Clock animation (game time unless realtime), tracked so skip() can finish it. */
  anim(ms, fn, opts = {}) {
    if (this._skipping) {
      try {
        fn(1, 1);
      } catch (e) {
        console.error(e);
      }
      return Promise.resolve(true);
    }
    const p = animate(ms, fn, { clock: this.clock, ease: opts.ease, delay: opts.delay, realtime: opts.realtime });
    return this._track(p);
  }

  _track(p) {
    if (!p || typeof p.cancel !== 'function') return p;
    this._tasks.add(p);
    p.then(() => this._tasks.delete(p));
    return p;
  }

  /** Track an FX promise (with .stop()) so skip() can drop it. */
  fxt(p) {
    if (!p || typeof p.stop !== 'function') return p;
    this._fxTracked.add(p);
    Promise.resolve(p).then(() => this._fxTracked.delete(p));
    return p;
  }

  /** Choreography wait (scaled by speed, game time). Throws ABORT when skipped. */
  async wait(ms, { realtime = false, raw = false } = {}) {
    if (this._skipping) throw ABORT;
    const p = clockWait(raw ? ms : this.T(ms), { clock: this.clock, realtime });
    this._track(p);
    await p;
    if (this._skipping) throw ABORT;
  }

  /** Run fn after ms (fire-and-forget, never throws). */
  later(ms, fn) {
    if (this._skipping) return;
    const p = clockWait(this.T(ms), { clock: this.clock });
    this._track(p);
    p.then((ok) => {
      if (ok && !this._skipping) {
        try {
          fn();
        } catch (e) {
          console.error('[rpg-render]', e);
        }
      }
    });
  }

  get skipping() {
    return this._skipping;
  }

  sfx(name, opts) {
    const a = this.audio;
    if (!a || typeof a.play !== 'function' || this._skipping) return;
    try {
      a.play(name, opts);
    } catch (e) {
      /* audio is optional */
    }
  }

  buzz(pattern) {
    const n = this.native;
    if (!n || typeof n.vibrate !== 'function') return;
    const p = hapticScale(Array.isArray(pattern) ? pattern : [pattern], hapticsOf(this.settings));
    if (!p) return;
    try {
      n.vibrate(p.length === 1 ? p[0] : p);
    } catch (e) {
      /* optional */
    }
  }

  /**
   * FX combo counter sized for the battle board: anchored over the board's top corner on the side
   * AWAY from world x (where the hits land and their numbers rise), fitted to ~1.6 squares.
   */
  combo(n, { color, label, x } = {}) {
    const fx = this.fx;
    const L = this.layout;
    if (!fx || !L || this._skipping || typeof fx.comboCounter !== 'function') return Promise.resolve(false);
    // a running counter keeps its side (FX anchors the new number by the side passed in)
    const live = fx.combo && !fx.combo.dead ? fx.combo : null;
    const right = live ? live.side === 'right' : x != null && x < L.cx;
    const r = this.renderer;
    const z = r.camera ? r.camera.zoom || 1 : 1;
    const wx = right ? L.bx + L.n * L.sq - L.sq * 0.15 : L.bx + L.sq * 0.15;
    const p = typeof r.worldToScreen === 'function' ? r.worldToScreen(wx, L.by + L.sq * 1.1) : { x: wx, y: L.by + L.sq * 1.1 };
    const scr = r.screen;
    const at = { x: Math.max(8, Math.min(scr.width - 8, p.x)), y: Math.max(L.sq, Math.min(scr.height - L.sq, p.y)) };
    return this.fxt(fx.comboCounter(n, { color, label, side: right ? 'right' : 'left', at, fit: L.sq * 1.6 * Math.min(1.2, z) }));
  }

  /** Camera: bring world point (x, y) to the board centre at `zoom` (settings.fx.camera). */
  camFocus(x, y, zoom = 1.15, ms = 360, { realtime = false, k = 0.75 } = {}) {
    if (this._skipping || !this.pref('camera') || !this.layout) return Promise.resolve(false);
    const L = this.layout;
    const px = L.cx + (x - L.cx) * k;
    const py = L.cy + (y - L.cy) * k;
    const cam = this.renderer.camera;
    const f = focusFor(px, py, zoom, this.renderer.boardCenter || { x: L.cx, y: L.cy }, L.cx, L.cy);
    return this._track(cam.focus(f.x, f.y, zoom, this.T(ms), Ease.outCubic, { realtime }));
  }

  camReset(ms = 320) {
    const cam = this.renderer.camera;
    if (!cam) return Promise.resolve(true);
    if (Math.abs(cam.zoom - 1) < 1e-3 && Math.abs(cam.ox) < 0.5 && Math.abs(cam.oy) < 0.5) return Promise.resolve(true);
    return cam.reset(Math.max(80, this.T(ms)), Ease.inOutCubic, { realtime: true });
  }

  punch(z = 1.05, ms = 240) {
    if (this._skipping || !this.pref('camera')) return;
    this.renderer.camera.punch(z, ms);
  }

  shake(i, ms) {
    if (this._skipping || !this.fx) return;
    this.fx.shake(i, ms);
  }

  /** Resting darkness of the arena art (keeps the tokens and the board the brightest thing). */
  _bgBase() {
    return this.theme && this.theme.bgDim != null ? this.theme.bgDim : 0.2;
  }

  /** Dim the world for a cinematic (k = brightness 0..1 of the uninvolved scene). */
  dimWorld(alpha, ms = 220, keep = []) {
    const keepSet = new Set(keep);
    const from = this.worldDim.alpha;
    this.worldDim.visible = true;
    const fromBg = this.bgDim.alpha;
    const target = Math.max(0, Math.min(0.85, alpha));
    for (const t of this.tokens.values()) if (!keepSet.has(t.id)) t._dimTo = 1 - target * 0.75;
    for (const w of this.wards.values()) if (!keepSet.has(w.id)) w._dimTo = 1 - target * 0.75;
    const tokFrom = new Map();
    for (const t of this.tokens.values()) tokFrom.set(t, t.dimK);
    return this.anim(ms, (e) => {
      this.worldDim.alpha = from + (target - from) * e;
      this.bgDim.alpha = fromBg + (Math.max(this._bgBase(), target * 0.8) - fromBg) * e;
      for (const t of this.tokens.values()) {
        const to = keepSet.has(t.id) ? 1 : 1 - target * 0.75;
        const f0 = tokFrom.get(t);
        t.setDim(f0 + (to - f0) * e);
      }
      for (const w of this.wards.values()) w.setDim(keepSet.has(w.id) ? 1 : 1 - target * 0.75 * e);
      if (e >= 1 && target <= 0.001) this.worldDim.visible = false;
    }, { realtime: true });
  }

  _undimNow() {
    this.worldDim.alpha = 0;
    this.worldDim.visible = false;
    this.bgDim.alpha = this._bgBase();
    for (const t of this.tokens.values()) t.setDim(1);
    for (const w of this.wards.values()) w.setDim(1);
  }

  // ===================================================================== frame
  _tick(gdt, rdt) {
    if (!this.shown) return;
    this._fitBg(false);
    const t = this.clock.now;
    for (const tok of this.tokens.values()) tok.update(t, rdt);
    for (const w of this.wards.values()) w.update(t, rdt);
    this.hl.update(rdt);
    this.vx.update(gdt);
    this.numbers.update(rdt);
    this._updateMotes(rdt);
    this._updateDecals(rdt);
    // board ambience
    const ph = this.clock.realNow / 1000;
    const gk = this.theme ? this.theme.glow : 0.08;
    this.arenaGlow.alpha = gk * (1 + 0.35 * Math.sin(ph * 0.8));
    this.edgeGlow.alpha = 0.13 + 0.05 * Math.sin(ph * 2.1);
    for (const p of this._previews) p.c.alpha = 0.82 + 0.18 * Math.sin(ph * 6);
    // gentle parallax of the arena art with the camera
    if (this._bgFit) {
      const cam = this.renderer.camera;
      const z = 1 + (cam.zoom * cam.punchScale - 1) * 0.3;
      this.bgSprite.scale.set(this._bgFit.scale * z);
      const scr = this._screen;
      const cx = scr.width / 2;
      const cy = scr.height / 2;
      this.bgSprite.position.set(cx + (this._bgFit.x - cx) * z - cam.ox * 0.12 + cam.shakeX * 0.3, cy + (this._bgFit.y - cy) * z - cam.oy * 0.12 + cam.shakeY * 0.3);
    }
  }

  /** Debug / verification snapshot. */
  stats() {
    const count = (n) => {
      let c = 1;
      if (n && n.children) for (const k of n.children) c += count(k);
      return c;
    };
    const L = this.layers || {};
    const nodes = ['bgRoot', 'boardRoot', 'unitsRoot', 'vfxRoot', 'topRoot', 'screenRoot'].reduce((s, k) => s + (L[k] ? count(L[k]) : 0), 0);
    return {
      shown: this.shown,
      busy: this._busy,
      tokens: this.tokens.size,
      wards: this.wards.size,
      numbers: this.numbers ? this.numbers.count : 0,
      vfx: this.vx ? this.vx.live.size : 0,
      bits: this.vx ? this.vx.bits.live.length : 0,
      tasks: this._tasks.size,
      nodes,
      sq: this.sqSize,
      atlasCell: this.tokenAtlas ? this.tokenAtlas.cell : 0,
      fx: this.fx && typeof this.fx.stats === 'function' ? this.fx.stats() : null,
    };
  }

  // ===================================================================== playback
  get busy() {
    return this._busy;
  }

  /**
   * Animate an event log (applyAction's events), then sync to opts.state. Resolves when done.
   * A play() while another one runs first skips the running one to its end state.
   */
  async play(events, opts = {}) {
    if (!this.ready) return;
    const final = opts && opts.state ? opts.state : null;
    if (this._playing) {
      this.skip();
      try {
        await this._playing;
      } catch (e) {
        /* already reported */
      }
    }
    const gen = ++this._gen;
    this._skipping = false;
    this._busy = true;
    this.clearHighlight();
    this.clearPreview();
    const run = (async () => {
      try {
        const beats = parseBeats(events);
        for (const beat of beats) {
          if (this._skipping || gen !== this._gen) break;
          await this._beat(beat);
        }
      } catch (e) {
        if (e !== ABORT) console.error('[rpg-render] play failed', e);
      } finally {
        const skipped = this._skipping;
        this._finishCinematics(skipped);
        if (final && gen === this._gen) this.setState(final, { animate: !skipped });
        if (gen === this._gen) {
          this._busy = false;
          this._skipping = false;
        }
      }
    })();
    this._playing = run;
    await run;
    if (this._playing === run) this._playing = null;
  }

  /** Tap → finish the running cinematic at once (the board jumps to the final state). */
  skip() {
    if (!this._busy || this._skipping) return;
    this._skipping = true;
    for (const p of Array.from(this._tasks)) p.cancel(true);
    this._tasks.clear();
    for (const p of Array.from(this._fxTracked)) {
      try {
        p.stop();
      } catch (e) {
        /* ignore */
      }
    }
    this._fxTracked.clear();
    if (this.vx) this.vx.stopAll();
    if (this.cutin) this.cutin.stop();
    if (this.fx) {
      try {
        this.fx.hideCombo();
        this.fx.slowMo(1, 0, { inMs: 0, outMs: 0 });
      } catch (e) {
        /* ignore */
      }
    }
    if (this.numbers) this.numbers.clear();
  }

  _abortPlay() {
    if (this._busy) this.skip();
  }

  /**
   * Drops the visuals that outlive a cinematic (lingering VFX / particles, name plates, damage
   * numbers, KO and reaction labels). Called when the view leaves: they were frozen with the
   * occluded renderer and came back over the next battle (playtest).
   */
  _clearTransient() {
    for (const p of Array.from(this._fxTracked)) {
      try {
        p.stop();
      } catch (e) {
        /* ignore */
      }
    }
    this._fxTracked.clear();
    if (this.vx) this.vx.stopAll();
    if (this.cutin) this.cutin.stop();
    if (this.numbers) this.numbers.clear();
    const lab = this.layers && this.layers.labels;
    if (lab) for (const c of lab.children) c.visible = false;
    if (this.fx) {
      try {
        this.fx.hideCombo();
        if (typeof this.fx.clear === 'function') this.fx.clear();
      } catch (e) {
        /* ignore */
      }
    }
  }

  _finishCinematics(skipped) {
    this.emitCinematic(false, { kind: 'end' });
    // a normal end lets name plates and lingering particles finish; a skip clears them at once
    if (skipped) {
      if (this.cutin) this.cutin.stop();
      if (this.vx) this.vx.stopAll();
    }
    this._undimNow();
    if (this.fx && skipped) this.fx.hideCombo();
    for (const t of this.tokens.values()) {
      t.setLift(0);
      t.setScale(1);
      t._moving = false;
    }
    this.camReset(skipped ? 160 : 320);
  }

  async _beat(beat) {
    switch (beat.type) {
      case 'turn':
        return this._turnBeat(beat);
      case 'move':
        return this._moveBeat(beat);
      case 'jump':
        return this._jumpBeat(beat, beat.events);
      case 'cast':
        if (beat.kind === 'ult') return playUltimate(this, beat);
        if (beat.kind === 'basic') return this._budgeted(BUDGET.attack, () => this._basicBeat(beat));
        return this._budgeted(BUDGET.skill, () => this._skillBeat(beat));
      case 'victory':
        return this._victoryBeat(beat);
      case 'end':
      case 'misc':
      default:
        return this.applyEvents(beat.events, { stagger: 60 });
    }
  }

  /**
   * Run a beat under its GDD time budget (ms at speed 1): KO pauses and closing waits shrink to
   * what is left (a KO's shatter then finishes under the next beat instead of holding the board).
   */
  async _budgeted(ms, fn) {
    const prev = this._deadline;
    this._deadline = this.clock.now + this.T(ms);
    try {
      return await fn();
    } finally {
      this._deadline = prev;
    }
  }

  /** Game-time ms left in the current beat's budget (Infinity outside a budgeted beat). */
  _budgetLeft() {
    return this._deadline == null ? Infinity : this._deadline - this.clock.now;
  }

  /** A closing / pacing wait clipped to the beat budget (minus `reserve` ms). */
  _paceWait(ms, reserve = 0) {
    const left = this._budgetLeft() - this.T(reserve);
    const w = Math.min(this.T(ms), left);
    return w > 8 ? this.wait(w, { raw: true }) : Promise.resolve(true);
  }

  // ------------------------------------------------------------------ generic event application
  /** Apply events in order (numbers, bars, small VFX); awaits only the animated ones. */
  async applyEvents(events, { stagger = 0 } = {}) {
    let last = null;
    for (const e of events || []) {
      if (this._skipping) throw ABORT;
      const subj = e.target || e.unit;
      if (stagger && last != null && subj != null && subj !== last && (e.type === 'damage' || e.type === 'heal')) await this.wait(stagger);
      if (subj != null) last = subj;
      const r = this.applyEvent(e);
      if (r && typeof r.then === 'function') await r;
    }
  }

  /** Apply all hit groups (with a stagger between targets). */
  async applyGroups(groups, { stagger = 70, hitFx = null } = {}) {
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (g.done) continue;
      if (i && stagger) await this.wait(stagger);
      await this.applyGroup(g, { hitFx });
    }
  }

  /** Apply one hit group: an optional hit VFX at its target, then its events. */
  async applyGroup(g, { hitFx = null } = {}) {
    if (!g || g.done) return;
    g.done = true;
    if (hitFx && g.target != null) {
      const p = this.piece(g.target);
      if (p && g.events.some((e) => e.type === 'damage' && !isChainDamage(e))) {
        const dmg = g.events.find((e) => e.type === 'damage');
        hitFx(p, dmg);
      }
    }
    await this.applyEvents(g.events);
  }

  /** Visual + model update of ONE event. Returns a promise for animated events. */
  applyEvent(e) {
    if (!e || typeof e !== 'object') return null;
    const vx = this.vx;
    switch (e.type) {
      case 'damage': {
        const t = this.piece(e.target);
        if (!t) return null;
        if (t instanceof WardView) {
          t.setHp(e.hp);
          vx.flashPiece(t);
        } else {
          t.setHp(e.hp, undefined, { animate: true });
          if (e.shield != null) t.setShield(e.shield);
          vx.flashPiece(t, e.crit ? 1.2 : 1);
        }
        const label = e.kind || 'hit';
        const dot = DOT_LABELS.has(label);
        const isTrue = label === 'true' || label === 'collision' || label === 'redirect' || dot;
        this.numbers.show({
          key: e.target,
          x: t.x,
          y: t.y - (t.lift || 0),
          amount: e.amount,
          kind: isTrue && !e.reaction ? 'true' : 'damage',
          element: e.element,
          crit: !!e.crit,
          reaction: e.reaction || null,
          dot,
        });
        if (e.reaction) this._reactionShown = e.target;
        if (e.absorbed > 0) vx.shieldHit(t);
        if (e.crit) {
          this.sfx('bigImpact', { intensity: 0.7 });
          this.buzz(18);
        }
        return null;
      }
      case 'heal': {
        const t = this.tokens.get(e.target);
        if (!t) return null;
        t.setHp(e.hp, undefined, { animate: true, heal: true });
        this.numbers.show({ key: `${e.target}:heal`, x: t.x, y: t.y, amount: e.amount, kind: 'heal' });
        vx.healPop(t);
        return null;
      }
      case 'shield': {
        const t = this.tokens.get(e.target);
        if (!t) return null;
        const v = e.value != null ? e.value : e.amount;
        const had = t.shield;
        t.setShield(v);
        if ((e.gained || e.amount) > 0 && v > had) {
          this.numbers.show({ key: `${e.target}:shield`, x: t.x, y: t.y, amount: e.gained || e.amount, kind: 'shield' });
          vx.shieldUp(t);
        }
        return null;
      }
      case 'status': {
        const t = this.tokens.get(e.target);
        if (!t) return null;
        const list = t.statusList || (t.statusList = []);
        const i = list.indexOf(e.status);
        if (e.on) {
          if (i < 0) list.push(e.status);
        } else if (i >= 0) list.splice(i, 1);
        const wasFrozen = t.frozen;
        t.setStatuses(list);
        if (e.on) vx.statusPop(t, e.status);
        else if (e.status === 'frozen' && wasFrozen) vx.iceShatter(t);
        if (e.status === 'crown' && !e.on) t.setAwakened(false, false);
        return null;
      }
      case 'seal': {
        const t = this.tokens.get(e.target);
        if (!t) return null;
        if (Array.isArray(e.seals)) t.setSeals(e.seals);
        else if (e.element) t.setSeals([...(t.sealEls || []).filter((x) => ELEMENT_FX[x] && ELEMENT_FX[x].slot !== ELEMENT_FX[e.element].slot), e.element]);
        else if (e.removed) t.setSeals((t.sealEls || []).filter((x) => x !== e.removed));
        if (e.element) vx.sealPop(t, e.element);
        return null;
      }
      case 'reaction': {
        const t = this.piece(e.target);
        if (!t) return null;
        if (this._reactionShown !== e.target && REACTION_FX[e.reaction]) {
          const R = REACTION_FX[e.reaction];
          this.floatLabel(R.label[this.lang === 'en' ? 'en' : 'ru'], t.x, t.y - this.sqSize * 0.7, { colors: R.colors, size: this.sqSize * 0.36 });
        }
        this._reactionShown = null;
        this.sfx('combo', { intensity: 0.8 });
        this.buzz(25);
        return vx.reaction(e.reaction, t, e);
      }
      case 'arc':
      case 'bounce': {
        const a = this.center(e.from, { x: 0, y: 0 });
        const tt = this.piece(e.target);
        const b = tt ? { x: tt.x, y: tt.y } : this.center(e.to, { x: 0, y: 0 });
        return vx.arcBolt(a, b, e.type === 'arc' ? 0xc49bff : null);
      }
      case 'energy': {
        const t = this.tokens.get(e.unit);
        if (!t) return null;
        const wasReady = t.ultReady;
        t.setEnergy(e.value, e.max);
        if (e.delta < 0 && (e.reason === 'steal' || e.reason === 'drain' || e.reason === 'burn' || e.reason === 'effect')) {
          this.numbers.show({ key: `${e.unit}:energy`, x: t.x, y: t.y, amount: -e.delta, kind: 'drain' });
        }
        if (!wasReady && t.ultReady) {
          vx.energyReady(t);
          this._decodeSplash(t.heroId);
        }
        return null;
      }
      case 'ko':
        return this._ko(e);
      case 'awaken':
        return this._awaken(e);
      case 'crownLost': {
        const t = this.tokens.get(e.unit);
        if (!t) return null;
        t.setAwakened(false, false);
        vx.crownBreak(t);
        this.floatLabel(word('crownLost', this.lang), t.x, t.y - this.sqSize * 0.8, { colors: [0xffffff, 0xff8a8a], size: this.sqSize * 0.28 });
        return null;
      }
      case 'displace':
        return this._displace(e);
      case 'move':
        return this._moveToken(e.unit, e.path || [e.from, e.to], { glide: false });
      case 'jump':
        return this._hop(e, []);
      case 'revive':
        return this._revive(e);
      case 'ward':
        return e.on ? this._wardOn(e) : this._wardOff(e);
      case 'zone':
        this._zoneEvent(e);
        return null;
      case 'zoneTrigger': {
        const t = this.tokens.get(e.unit);
        if (t) vx.zonePulse(t, e.kind);
        return null;
      }
      case 'survive': {
        const t = this.tokens.get(e.unit);
        if (!t) return null;
        if (e.hp != null) t.setHp(e.hp, undefined, { animate: true });
        vx.survive(t);
        this.floatLabel(word('survive', this.lang), t.x, t.y - this.sqSize * 0.75, { colors: [0xffffff, GOLD], size: this.sqSize * 0.3 });
        return null;
      }
      case 'redirect': {
        const a = this.tokens.get(e.unit);
        const b = this.tokens.get(e.from);
        if (a && b) vx.redirectLink(a, b);
        return null;
      }
      case 'execute': {
        const t = this.tokens.get(e.unit);
        if (t) return vx.execute(t);
        return null;
      }
      case 'wait': {
        // the Wait action: the heroine braces (its +energy and «brace» status follow)
        const t = this.tokens.get(e.unit);
        if (!t) return null;
        vx.pulse('glowRing', this.layers.vfxOver, { x: t.x, y: t.y, tint: t.sideColor, w0: this.sqSize * 1.5, w1: this.sqSize * 0.95, ms: 360, alpha: 0.9, fadeAt: 0.5 });
        this.floatLabel(word('wait', this.lang), t.x, t.y - this.sqSize * 0.72, { colors: [0xffffff, t.sideColor], size: this.sqSize * 0.28, rise: 0.15 });
        return this.wait(180);
      }
      case 'collision': {
        // a push / pull slammed into the edge or another piece: bump at the blocked square
        const t = this.piece(e.unit);
        if (!t) return null;
        const at = e.at != null && e.at >= 0 ? this.center(e.at, { x: 0, y: 0 }) : null;
        const x = at ? (t.x + at.x) / 2 : t.x;
        const y = at ? (t.y + at.y) / 2 : t.y;
        vx.pulse('ring', this.layers.vfxOver, { x, y, tint: 0xfff2d8, w0: this.sqSize * 0.3, w1: this.sqSize * 1.1, ms: 260, alpha: 1 });
        vx.emit('spark', x, y, { count: 8, color: 0xfff2d8 });
        this.shake(0.15, 160);
        this.sfx('impact', { intensity: 0.6 });
        return null;
      }
      case 'turnSkipped': {
        const L = this.layout;
        if (L) this.floatLabel(word('skipped', this.lang), L.cx, L.cy, { colors: [0xffffff, this.sideColorOf(e.side)], size: this.sqSize * 0.42, rise: 0.1 });
        return this.wait(420);
      }
      case 'wardAct': {
        const w = this.wards.get(e.id);
        if (!w) return null;
        vx.pulse('glowRing', this.layers.vfxOver, { x: w.x, y: w.y, tint: e.kind === 'ball-lightning' ? 0xc49bff : 0xffffff, w0: this.sqSize * 0.5, w1: this.sqSize * 1.6, ms: 320, alpha: 0.9 });
        return null;
      }
      case 'extraActivation': {
        const t = this.tokens.get(e.unit);
        if (!t) return null;
        vx.extraTurn(t);
        this.floatLabel(word('extra', this.lang), t.x, t.y - this.sqSize * 0.75, { colors: [0xd9fff0, 0x3be3a0], size: this.sqSize * 0.32 });
        return null;
      }
      case 'warning':
        this._warnings.set(e.kind || 'warning', { sqs: e.sqs || [], round: e.round });
        this._buildDecals();
        return null;
      case 'eruption':
        this._warnings.delete('eruption');
        this._buildDecals();
        return vx.eruption(e.sqs || []);
      case 'fireRain':
        this._warnings.delete('fireRain');
        this._buildDecals();
        return vx.fireRain(e.centers || [], e.sqs || []);
      case 'collapse':
        return vx.collapse(e.sqs || []).then(() => {
          if (this.state) {
            const holes = new Set([...(this.state.holes || []), ...(e.sqs || [])]);
            this.state = { ...this.state, holes: [...holes] };
          }
          this._buildDecals();
        });
      case 'bossPhase': {
        const t = this.tokens.get(e.unit);
        if (t) return vx.bossPhase(t, e.phase);
        return null;
      }
      case 'rule': {
        const t = this.tokens.get(e.target || e.unit);
        if (t && e.rule === 'cocoon') vx.statusPop(t, 'frozen');
        return null;
      }
      case 'turnStart':
        this._sideGlow(e.side);
        if (e.round != null) this.round = e.round;
        return null;
      case 'turnEnd':
      case 'roundEnd':
      case 'cooldown':
      default:
        return null;
    }
  }

  _decodeSplash(heroId) {
    if (!this.assets || !this.assets.splash) return;
    loadImage(this.assets.splash(heroId));
  }

  // ------------------------------------------------------------------ beats
  async _turnBeat(beat) {
    this._sideGlow(beat.side);
    if (beat.round != null) this.round = beat.round;
    const { pre, groups, post } = hitGroups(beat.events, null);
    await this.applyEvents(pre);
    for (const g of groups) {
      const prim = g.events.find((x) => x.type === 'damage' || x.type === 'heal');
      const src = prim && prim.source ? this.wards.get(prim.source) : null;
      const t = this.piece(g.target);
      if (src && t && prim.type === 'damage') await this.vx.wardStrike(src, t, prim.element);
      else if (t && prim && prim.type === 'damage') this.vx.tick(t, prim.kind, prim.element);
      await this.applyGroup(g);
      await this.wait(90);
    }
    await this.applyEvents(post);
  }

  async _moveBeat(beat) {
    const e = beat.head;
    await this._moveToken(e.unit, e.path || [e.from, e.to], {});
    await this.applyEvents(beat.events);
  }

  /** Animate a token along a path of squares (steps hop slightly; long glides dash). */
  async _moveToken(id, path, { glide } = {}) {
    const t = this.tokens.get(id);
    if (!t || !Array.isArray(path) || path.length < 1) return;
    const pts = path.filter((q) => typeof q === 'number' && q >= 0);
    if (pts.length && pts[0] !== t.sq && t.sq >= 0) pts.unshift(t.sq);
    if (pts.length < 2) return;
    const from = pts[0];
    const to = pts[pts.length - 1];
    const blink = !pts.slice(1).every((q, i) => onDiagonal(pts[i], q)) || (t.hero && heroHasRule(t.hero, 'blinkMove'));
    t._moving = true;
    t.raise();
    const el = elementFx(t.element);
    try {
      if (blink) {
        await this.vx.blink(t, from, to);
      } else {
        const steps = pts.length - 1;
        const total = Math.min(BUDGET.move - 60, 170 * steps + 120);
        const per = this.T(total / steps);
        this.sfx('dash', { intensity: 0.5 });
        for (let i = 1; i < pts.length; i++) {
          const a = this.center(pts[i - 1], { x: 0, y: 0 });
          const b = this.center(pts[i], { x: 0, y: 0 });
          const dist = sqDist(pts[i - 1], pts[i]);
          const lift = this.sqSize * (dist > 1 || glide ? 0.12 : 0.22);
          let acc = 0;
          await this.anim(per * Math.max(1, dist * 0.7), (e2, k) => {
            t.setPos(a.x + (b.x - a.x) * e2, a.y + (b.y - a.y) * e2);
            t.setLift(Math.sin(Math.PI * k) * lift);
            acc += 1;
            if (acc % 3 === 0) this.vx.trail(el.id, t.x, t.y);
          }, { ease: Ease.inOutQuad });
          if (this._skipping) throw ABORT;
        }
        t.setLift(0);
        this.vx.land(t, el.id);
      }
      t.sq = to;
    } finally {
      t._moving = false;
      if (to >= 0) {
        const p = this.center(to, this._tmp);
        t.sq = to;
        t.setPos(p.x, p.y);
        t.setLift(0);
      }
    }
  }

  async _displace(e) {
    const t = this.tokens.get(e.unit);
    if (!t) return;
    const kind = e.kind || 'push';
    t._moving = true;
    t.raise();
    const a = this.center(e.from, { x: 0, y: 0 });
    const b = this.center(e.to, { x: 0, y: 0 });
    try {
      if (kind === 'gate' || kind === 'teleport' || kind === 'decoy' || kind === 'blink') {
        await this.vx.blink(t, e.from, e.to, kind === 'gate' ? 0xb9a8ff : null);
      } else if (kind === 'swap' || kind === 'toss' || kind === 'relocate' || kind === 'collapse' || kind === 'freeMove' || kind === 'step' || kind === 'moveSelf' || kind === 'dash') {
        const high = kind === 'toss' ? 1.6 : kind === 'swap' ? 0.5 : 0.25;
        const dur = this.T(kind === 'toss' ? 520 : 320);
        const el = elementFx(t.element);
        await this.anim(dur, (e2, k) => {
          t.setPos(a.x + (b.x - a.x) * e2, a.y + (b.y - a.y) * e2);
          t.setLift(Math.sin(Math.PI * k) * this.sqSize * high);
          if (kind === 'moveSelf' || kind === 'dash') this.vx.trail(el.id, t.x, t.y);
        }, { ease: Ease.inOutCubic });
        t.setLift(0);
        this.vx.land(t, t.element, kind === 'toss' ? 1.4 : 0.7);
      } else {
        // push / pull: a fast slide with a recoil
        await this.anim(this.T(220), (e2) => {
          t.setPos(a.x + (b.x - a.x) * e2, a.y + (b.y - a.y) * e2);
        }, { ease: Ease.outCubic });
        this.vx.skid(t, a, b);
      }
    } finally {
      t._moving = false;
      t.sq = e.to;
      t.setPos(b.x, b.y);
      t.setLift(0);
    }
  }

  async _jumpBeat(beat, events) {
    // split into hops: each 'jump' starts one, following events belong to it
    const hops = [];
    let cur = null;
    const lead = [];
    for (const e of events) {
      if (e.type === 'jump') {
        cur = { e, events: [] };
        hops.push(cur);
      } else if (cur) cur.events.push(e);
      else lead.push(e);
    }
    await this.applyEvents(lead);
    for (let i = 0; i < hops.length; i++) {
      await this._hop(hops[i].e, hops[i].events, { index: i, count: hops.length });
    }
    if (hops.length > 1 && this.fx) this.later(600, () => this.fx.hideCombo());
  }

  /** One jump-strike hop: arc over the victim, strike at the apex, land. */
  async _hop(e, after, { index = 0, count = 1 } = {}) {
    const t = this.tokens.get(e.unit);
    if (!t) return this.applyEvents(after);
    const el = elementFx(t.element);
    const a = this.center(e.from, { x: 0, y: 0 });
    const b = this.center(e.to, { x: 0, y: 0 });
    const victim = e.victim != null ? this.piece(e.victim) : this.unitAt(e.over);
    const { groups, pre, post } = hitGroups(after, e.unit);
    t._moving = true;
    t.raise();
    await this.applyEvents(pre);
    const sq = this.sqSize;
    const hopN = e.hop || index + 1;
    if (hopN >= 2) this.camFocus(b.x, b.y, 1.12, 320);
    // wind-up crouch
    await this.anim(this.T(90), (k) => t.setScale(1 - 0.08 * Math.sin(Math.PI * k)));
    this.sfx('whoosh', { intensity: 0.6 + 0.1 * hopN });
    const arcMs = this.T(Math.min(420, 300 + sqDist(e.from, e.to) * 30));
    let struck = false;
    let afterimg = 0;
    await this.anim(arcMs, (e2, k) => {
      t.setPos(a.x + (b.x - a.x) * e2, a.y + (b.y - a.y) * e2);
      t.setLift(Math.sin(Math.PI * Math.min(1, k)) * sq * 0.85);
      if ((afterimg++ & 1) === 0) this.vx.trail(el.id, t.x, t.y - t.lift, 1.2);
      if (!struck && k >= 0.5) {
        struck = true;
        if (victim) this.vx.jumpStrike(t, victim, el.id, hopN);
      }
    }, { ease: Ease.inOutSine });
    if (!struck && victim) this.vx.jumpStrike(t, victim, el.id, hopN);
    t.sq = e.to;
    t.setPos(b.x, b.y);
    t.setLift(0);
    t._moving = false;
    // impact: hit-stop, numbers, combo counter
    if (this.fx && this.pref('slowmo')) this.fx.hitStop(hopN >= 2 ? 90 : 60);
    this.punch(1.04 + 0.015 * hopN, 220);
    this.shake(0.18 + 0.06 * hopN, 220);
    if (count > 1 && hopN >= 2) this.combo(hopN, { color: el.color, label: word('hits', this.lang), x: b.x });
    this.sfx(hopN >= 2 ? 'combo' : 'impact', { intensity: 0.7 + 0.1 * hopN });
    this.buzz(14 + 6 * hopN);
    await this.applyGroups(groups, { stagger: 50 });
    this.vx.land(t, el.id, 0.9);
    await this.applyEvents(post);
    await this.wait(140);
  }

  async _basicBeat(beat) {
    const head = beat.head;
    const caster = this.tokens.get(beat.unit);
    const { pre, groups, post } = hitGroups(beat.events, beat.unit);
    await this.applyEvents(pre);
    if (!caster || !groups.length) {
      await this.applyGroups(groups);
      await this.applyEvents(post);
      return;
    }
    const el = elementFx(head.element || caster.element);
    const role = caster.hero ? caster.hero.role : 'blade';
    const g = groups[0];
    const target = this.piece(g.target);
    const heal = g.events.some((x) => x.type === 'heal') && !g.events.some((x) => x.type === 'damage');
    const hitFx = (p, dmg) => this.vx.hit(el.id, p, { crit: dmg && dmg.crit, from: caster });
    if (target && !heal && (role === 'guardian' || role === 'blade' || role === 'shadow') && sqDist(caster.sq, target.sq || 0) <= 1) {
      await this.vx.lunge(caster, target, async () => {
        await this.applyGroups(groups, { hitFx });
      });
    } else if (target) {
      this.vx.windup(el.id, caster, 0.6);
      await this.wait(120);
      if (heal) await this.vx.healBeam(caster, target);
      else await this.vx.bolt(el.id, caster, target, { arrow: role === 'ranger', small: role === 'oracle' });
      await this.applyGroups(groups, { hitFx: heal ? null : hitFx });
    } else await this.applyGroups(groups);
    await this.applyEvents(post);
    await this._paceWait(160);
  }

  async _skillBeat(beat) {
    const head = beat.head;
    const caster = this.tokens.get(beat.unit);
    const el = elementFx(head.element || (caster && caster.element));
    const { pre, groups, post } = hitGroups(beat.events, beat.unit);
    // name plate + voice
    if (caster) {
      const hero = caster.hero;
      const ab = hero ? (beat.kind === 'quirk' ? null : hero.skill) : null;
      const name = head.name || (ab && ab.name ? ab.name[this.lang === 'en' ? 'en' : 'ru'] : null);
      if (name) this.cutin.namePlate(name, el, { jp: ab && ab.name ? ab.name.jp : null, hold: readMs(name, 'caption', this.settings) * 0.7 });
      if (beat.kind === 'skill' && this.voice && this.voiceGate.allow(caster.heroId, 'skill', this.round)) this._say(caster.heroId, 'skill');
      this.vx.windup(el.id, caster, 1);
      this.sfx('charge', { intensity: 0.6 });
      await this.wait(200);
    }
    // pre: dashes / wards / self buffs before the hits
    await this.applyEvents(pre);
    const targets = targetsOf(groups).map((id) => this.piece(id)).filter(Boolean);
    const enemies = caster ? targets.filter((p) => p.side !== caster.side) : targets;
    const hitFx = (p, dmg) => this.vx.hit(el.id, p, { crit: dmg && dmg.crit, big: true, from: caster });
    if (caster && enemies.length) {
      const area = Array.isArray(head.area) && head.area.length ? head.area : null;
      const line = enemies.length >= 1 && enemies.every((p) => p.sq >= 0 && onDiagonal(caster.sq, p.sq)) && (area ? area.every((q) => onDiagonal(caster.sq, q)) : enemies.length > 1) && sharesRay(caster.sq, enemies.map((p) => p.sq));
      if (enemies.length === 1 && !area && sqDist(caster.sq, enemies[0].sq) <= 1 && (caster.hero && ['guardian', 'blade', 'shadow'].includes(caster.hero.role))) {
        await this.vx.lunge(caster, enemies[0], async () => {
          await this.applyGroups(groups, { hitFx });
        }, { big: true });
      } else if (line) {
        await this.vx.lineSweep(el.id, caster, enemies, area);
        await this.applyGroups(groups, { hitFx, stagger: 60 });
      } else if (enemies.length === 1 && !area) {
        await this.vx.bolt(el.id, caster, enemies[0], { big: true });
        await this.applyGroups(groups, { hitFx });
      } else {
        const sqs = area || enemies.map((p) => p.sq);
        await this.vx.area(el.id, caster, sqs);
        await this.applyGroups(groups, { hitFx, stagger: 70 });
      }
    } else if (caster && targets.length) {
      // support: heals / shields / buffs on allies
      await this.vx.support(el.id, caster, targets);
      await this.applyGroups(groups, { stagger: 60 });
    } else {
      await this.applyGroups(groups, { stagger: 60 });
    }
    await this.applyEvents(post);
    await this._paceWait(200);
  }

  _say(heroId, event, opts = {}) {
    if (!this.voice) return null;
    try {
      const p = this.voice(heroId, event, { settings: this.settings, audio: this.audio, ...opts });
      if (p && typeof p.catch === 'function') p.catch(() => {});
      return p;
    } catch (e) {
      return null;
    }
  }

  async _ko(e) {
    const t = this.tokens.get(e.unit);
    if (!t || !t.alive) return;
    this.sfx('shatter', { intensity: 1 });
    this.buzz([30, 40, 50]);
    const p = this.vx.ko(t);
    const sq = this.sqSize;
    // the 撃破 stamp sits on the shattering token; inside an Ultimate the ult's own kanji and the
    // damage numbers already fill the board, so only the «НОКАУТ!» label is shown there
    if (this.fx && this.pref('kanji') && !this._inUlt) this.fxt(this.fx.kanji('撃破', t.x, t.y + sq * 0.12, { size: Math.round(sq * 0.82), color: elementFx(t.element).color, hold: readMs('撃破', 'kanji', this.settings) * 0.5, backdrop: 'burst' }));
    this.floatLabel(word('ko', this.lang), t.x, t.y + sq * 0.62, { colors: [0xffffff, 0xff4d5e], size: sq * 0.3, rise: 0.1 });
    t.alive = false; // the token is already hidden by the shatter; the board treats the square as free
    if (!this._inUlt) {
      // a KO is a beat of its own — except inside an Ultimate, whose timeline is fixed (≤ 4 s),
      // and only as long as the attack / skill that caused it still has time in its budget
      if (this._budgetLeft() === Infinity) {
        await this.wait(Math.min(BUDGET.ko, 420));
        await p;
      } else await this._paceWait(420, 120);
    }
    t.setAlive(false);
    t.sq = -1;
  }

  async _awaken(e) {
    const t = this.tokens.get(e.unit);
    if (!t) return;
    this.sfx('promote', { intensity: 1 });
    this.buzz([20, 30, 60]);
    await this.vx.awaken(t);
    t.setAwakened(true, true);
  }

  async _revive(e) {
    const t = this.tokens.get(e.unit);
    if (!t) return;
    const p = this.center(e.sq, { x: 0, y: 0 });
    t.sq = e.sq;
    t.setPos(p.x, p.y);
    t.setAlive(true);
    if (e.hp != null) t.setHp(e.hp, undefined, { animate: false });
    if (e.energy != null) t.setEnergy(e.energy);
    t.setAlpha(0);
    await this.vx.revive(t);
    t.setAlpha(1);
    this.floatLabel(word('revive', this.lang), t.x, t.y - this.sqSize * 0.8, { colors: [0xffffff, GOLD], size: this.sqSize * 0.3 });
  }

  async _wardOn(e) {
    let v = this.wards.get(e.id);
    if (!v) {
      const owner = this.state && this.state.units ? this.state.units.find((u) => u.id === e.owner) : null;
      v = new WardView(this, { id: e.id, kind: e.kind, side: e.side, hp: e.hp, maxHp: e.maxHp || e.hp, special: e.special }, owner || (this.tokens.get(e.owner) ? { heroId: this.tokens.get(e.owner).heroId, rarity: this.tokens.get(e.owner).rarity, element: this.tokens.get(e.owner).element } : null));
      this.wards.set(e.id, v);
    }
    v.sq = e.sq;
    const p = this.center(e.sq, { x: 0, y: 0 });
    v.setPos(p.x, p.y);
    v.setHp(e.hp, e.maxHp);
    // the ward rises while the action goes on (a short beat, never a wait)
    this.vx.wardSpawn(v);
    await this.wait(120);
  }

  async _wardOff(e) {
    const v = this.wards.get(e.id);
    if (!v) return;
    this.wards.delete(e.id);
    await this.vx.wardBreak(v);
    v.destroy();
  }

  _zoneEvent(e) {
    if (!this.state) return;
    const zones = (this.state.zones || []).filter((z) => z.id !== e.id);
    if (e.on) zones.push({ id: e.id, kind: e.kind, sqs: e.sqs || [], owner: e.owner, side: e.side, turns: e.turns });
    this.state = { ...this.state, zones };
    this._buildDecals();
    if (e.on) for (const q of e.sqs || []) this.vx.zoneSpawn(q, e.kind);
  }

  async _victoryBeat(beat) {
    const winner = beat.winner;
    await this.applyEvents(beat.events);
    const winners = [...this.tokens.values()].filter((t) => t.alive && t.side === winner);
    for (const t of this.tokens.values()) if (t.alive && t.side !== winner) t.setDim(0.55);
    await this.vx.victory(winners, winner);
  }
}

// ---------------------------------------------------------------------------------------------
const ZONE_LOOK = {
  // scorched tile: a soot mark, a smouldering ember ring and a burning phoenix feather
  'phoenix-trail': {
    parts: [
      { frame: 'dot', glow: false, tint: 0x1c0703, alpha: 0.6, size: 1.0, anim: null },
      { frame: 'glowRing', glow: true, tint: 0xff5a1a, alpha: 0.5, size: 0.8, anim: 'flicker' },
      { frame: 'feather', glow: true, tint: 0xffa23a, alpha: 0.85, size: 0.5, anim: 'flicker' },
    ],
  },
  'sand-rune': { frame: 'rune', glow: true, tint: 0xe3a13b, alpha: 0.8, size: 0.86, anim: 'pulse' },
  feathers: { frame: 'feather', glow: false, tint: 0xd9fff0, alpha: 0.85, size: 0.45, anim: null },
  dew: { frame: 'dew', glow: false, tint: 0xffffff, alpha: 0.9, size: 0.9, anim: null },
  lava: { frame: 'lava', glow: true, tint: 0xffffff, alpha: 0.85, size: 1, anim: 'flicker' },
  'fire-rain': { frame: 'square', glow: true, tint: 0xff3a2a, alpha: 0.5, size: 0.96, anim: 'warn' },
  default: { frame: 'rune', glow: true, tint: 0xb9a8ff, alpha: 0.6, size: 0.8, anim: 'pulse' },
};

function heroHasRule(hero, rule) {
  for (const q of hero.quirks || []) for (const r of q.rules || []) if (r.rule === rule) return true;
  return false;
}

/** All squares lie on ONE diagonal ray from `from`. */
function sharesRay(from, sqs) {
  let dir = null;
  for (const q of sqs) {
    const d = [Math.sign((q >> 3) - (from >> 3)), Math.sign((q & 7) - (from & 7))].join(',');
    if (dir == null) dir = d;
    else if (dir !== d) return false;
  }
  return true;
}

const FONT_SPECS = ['900 44px "Unbounded"', '64px "Dela Gothic One"', '64px "Russo One"', '700 32px "Oswald"'];
const JP_SAMPLE = '撃破覚醒蒸爆凍電脆渦晶蝕燃暈縛遅黙挑印弱鼓構癒盾隠冠揺砕光皇雷氷不死鳥嵐潮緋落吹雪祈夜砦鉄波銛歌岩庭暁詐済天后の聖歌永冬宮一手千羽大昇注意報無音暁祈星なき真夜中琥珀砦秋嵐鉄床落とし九大波銛静かな雪連鎖便合唱落石石庭番闇詐術弩炎風';

async function loadFonts() {
  if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) return;
  const jobs = FONT_SPECS.map((f) => document.fonts.load(f, f.includes('Dela') ? `АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ!0123456789${JP_SAMPLE}` : 'АБВабв0123456789+-×=').catch(() => null));
  await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, 2500))]);
}

export { TOKEN_D };
