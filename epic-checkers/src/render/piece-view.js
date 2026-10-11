// PieceView — one checker on the board.
//
//   view.color        1 (white) | -1 (black)
//   view.isKing       boolean
//   view.sq           engine square index (kept up to date by the Renderer)
//   view.auraLayer    Container UNDER the piece (FX put flame auras etc. here)
//   view.body         Container with the disc graphics (lifted by `lift`)
//   view.lift         height above the board in square units (0 = resting); the move arc uses it
//   view.setKing(bool, animate) / setSelected(bool) / setDim(bool)
//
// The additive glows of a piece live in a shared glow layer underneath all pieces (so the whole
// pieces layer renders in ~2 batches); PieceView.update() keeps them in sync with the view's
// position / alpha / scale every frame. Keep pieces inside renderer.layers.pieces.

import { Container, Sprite } from 'pixi.js';
import { tween, animate, Ease } from './tween.js';
import { mixHex, glowTexture } from './canvas.js';
import { EPIC } from './palette.js';

const TAU = Math.PI * 2;

export class PieceView extends Container {
  constructor(skin, glowLayer, clock, topLayer = null) {
    super();
    this.topLayer = topLayer;
    this.label = 'piece';
    this.color = 1;
    this.isKing = false;
    this.sq = -1;
    this.clock = clock;
    this.glowLayer = glowLayer;

    this.auraLayer = new Container();
    this.auraLayer.label = 'aura';
    this.shadow = new Sprite();
    this.shadow.anchor.set(0.5);
    this.body = new Container();
    this.body.label = 'body';
    this.ring = new Sprite();
    this.ring.anchor.set(0.5);
    this.base = new Sprite();
    this.base.anchor.set(0.5);
    this.baseFade = new Sprite();
    this.baseFade.anchor.set(0.5);
    this.baseFade.visible = false;
    this.core = new Sprite();
    this.core.anchor.set(0.5);
    this.crown = new Sprite();
    this.crown.anchor.set(0.5);
    this.glint = new Sprite();
    this.glint.anchor.set(0.5);
    this.glint.visible = false;
    this.body.addChild(this.ring, this.base, this.baseFade, this.core, this.crown, this.glint);
    this.addChild(this.auraLayer, this.shadow, this.body);

    // external glows (shared glow layer)
    this.glow = new Sprite();
    this.glow.anchor.set(0.5);
    this.selGlow = new Sprite();
    this.selGlow.anchor.set(0.5);
    this.selGlow.alpha = 0;
    // additive bloom over the energy core (epic), lives in the layer ABOVE all pieces
    this.coreGlow = new Sprite(glowTexture(64, 1.7));
    this.coreGlow.anchor.set(0.5);
    this.coreGlow.blendMode = 'add';
    this.coreGlow.visible = false;

    this._arcLift = 0;
    this._selLift = 0;
    this._squash = 0;
    this._faceY = 0;
    this._dim = 0;
    this._selected = false;
    this._kingFx = 0; // 0..1 flare after promotion
    this._tweens = new Set();
    this.phase = Math.random() * TAU;
    this.breath = 0.85 + Math.random() * 0.3; // individual breathing speed
    this.skin = null;
    if (skin) this.applySkin(skin);
  }

  // ------------------------------------------------------------------ skin / identity
  applySkin(skin) {
    this.skin = skin;
    const T = skin.textures;
    const epic = skin.theme === 'epic';
    this.epic = epic;
    this.squareSize = skin.squareSize;
    this.shadow.texture = T.shadow;
    this.glint.texture = T.glint;
    this.glow.texture = T.glow;
    this.selGlow.texture = T.glow;
    this.glow.blendMode = 'add';
    this.selGlow.blendMode = epic ? 'add' : 'normal';
    this.selGlow.tint = epic ? EPIC.gold : 0xffc94a;
    this.core.visible = epic;
    this.ring.visible = false;
    if (epic) this.ring.texture = T.ring;
    this._syncTextures(false);
  }

  /** Set colour + king from an engine cell code (±1 man, ±2 king). */
  setCode(code) {
    this.color = code > 0 ? 1 : -1;
    this.isKing = Math.abs(code) === 2;
    this._kingFx = 0;
    this._syncTextures(false);
  }

  _syncTextures(keepFade) {
    const skin = this.skin;
    if (!skin) return;
    const T = skin.textures;
    const kind = this.isKing ? 'king' : 'man';
    this.base.texture = T.body[this.color][kind];
    if (!keepFade) this.baseFade.visible = false;
    this.crown.texture = T.crown[this.color];
    this.crown.visible = this.isKing;
    this.crown.scale.set(1);
    this.crown.alpha = 1;
    if (this.epic) {
      this.core.texture = T.core[this.color][kind];
      this.ring.visible = this.isKing;
      this.ring.alpha = 1;
      this.ring.scale.set(1);
      // energy colour of the side from the skin (the player's chosen colour, or the default)
      const side = skin.sideColor ? skin.sideColor(this.color) : EPIC.side[this.color];
      this.glow.tint = this.isKing ? mixHex(side, EPIC.gold, 0.25) : side;
      this.glow.visible = true;
      this.coreGlow.tint = this.isKing ? mixHex(EPIC.gold, 0xffffff, 0.2) : mixHex(side, 0xffffff, 0.25);
    } else {
      this.glow.visible = false;
      this.coreGlow.visible = false;
    }
    this._faceY = skin.faceOffset(this.isKing);
    this.crown.y = 0;
    this._layout();
  }

  // ------------------------------------------------------------------ lift / layout
  /** Height above the board in square units (0 = resting). */
  get lift() {
    return this._arcLift;
  }
  set lift(v) {
    this._arcLift = v;
    this._layout();
  }

  /** Landing squash (-0.2..0.2): >0 = flattened. */
  get squash() {
    return this._squash;
  }
  set squash(v) {
    this._squash = v;
    this._layout();
  }

  _layout() {
    const sq = this.squareSize || 40;
    const h = this._arcLift + this._selLift;
    const s = 1 + h * 0.26;
    this.body.y = this._faceY - h * sq * 0.5;
    this.body.scale.set(s * (1 + this._squash), s * (1 - this._squash));
    const off = 0.045 + h * 0.32;
    this.shadow.position.set(sq * off * 0.55, sq * (0.07 + h * 0.36));
    const ss = 1 + h * 0.4;
    this.shadow.scale.set(ss);
    this.shadow.alpha = Math.max(0.25, 1 - h * 0.55) * (this.epic ? 0.95 : 0.85);
  }

  // ------------------------------------------------------------------ states
  /** Animate to king (or back). With animate=false it switches instantly. */
  setKing(isKing, anim = false) {
    isKing = !!isKing;
    if (isKing === this.isKing) return Promise.resolve(true);
    const prevTex = this.base.texture;
    const prevFace = this._faceY;
    this.isKing = isKing;
    this._syncTextures(true);
    if (!anim || !this.skin) {
      this.baseFade.visible = false;
      return Promise.resolve(true);
    }
    // crossfade old body → new body, ease the face height
    this.baseFade.texture = prevTex;
    this.baseFade.visible = true;
    this.baseFade.alpha = 1;
    this.baseFade.y = prevFace - this._faceY;
    const clock = this.clock;
    const track = (p) => {
      this._tweens.add(p);
      p.then(() => this._tweens.delete(p));
      return p;
    };
    track(tween(this.baseFade, { alpha: 0 }, { duration: 380, ease: Ease.inOutQuad, clock })).then(() => {
      this.baseFade.visible = false;
    });
    const startFace = prevFace;
    const endFace = this._faceY;
    track(
      animate(420, (e) => {
        this._faceY = startFace + (endFace - startFace) * e;
        this._layout();
      }, { clock, ease: Ease.outBack })
    );
    let main;
    if (isKing) {
      this.crown.scale.set(0);
      this.crown.alpha = 0;
      main = track(tween(this.crown, { 'scale.x': 1, 'scale.y': 1 }, { duration: 520, ease: Ease.backOut(2.6), delay: 120, clock }));
      track(tween(this.crown, { alpha: 1 }, { duration: 180, delay: 120, clock }));
      // glint sweep
      this.glint.visible = true;
      this.glint.alpha = 0;
      this.glint.scale.set(0.2);
      this.glint.rotation = 0;
      this.glint.tint = this.epic ? 0xfff1b0 : 0xfff6dc;
      track(
        animate(700, (e, k) => {
          const p = Math.sin(Math.PI * k);
          this.glint.alpha = p;
          this.glint.scale.set(0.3 + p * 1.1);
          this.glint.rotation = k * 1.4;
        }, { clock, delay: 200 })
      ).then(() => (this.glint.visible = false));
      if (this.epic) {
        this.ring.scale.set(1.8);
        this.ring.alpha = 0;
        track(tween(this.ring, { 'scale.x': 1, 'scale.y': 1, alpha: 1 }, { duration: 600, ease: Ease.outExpo, delay: 200, clock }));
        this._kingFx = 1;
        track(tween(this, { _kingFx: 0 }, { duration: 1400, ease: Ease.outQuad, delay: 300, clock }));
      }
    } else {
      this.crown.visible = true;
      this.crown.alpha = 1;
      main = track(tween(this.crown, { alpha: 0, 'scale.x': 0.4, 'scale.y': 0.4 }, { duration: 300, ease: Ease.inBack, clock }));
      main.then(() => {
        this.crown.visible = this.isKing;
        this.crown.alpha = 1;
        this.crown.scale.set(1);
      });
    }
    return main;
  }

  /** Selected = lifted + gold glow (UI interaction, real time). */
  setSelected(sel) {
    sel = !!sel;
    if (sel === this._selected) return;
    this._selected = sel;
    if (this._selTween) this._selTween.cancel();
    this._selTween = tween(this, { _selLift: sel ? 0.13 : 0 }, {
      duration: sel ? 170 : 140,
      ease: sel ? Ease.outBack : Ease.outCubic,
      realtime: true,
      clock: this.clock,
      onUpdate: () => this._layout(),
    });
  }

  get selected() {
    return this._selected;
  }

  setDim(dim) {
    const target = dim ? 1 : 0;
    if (this._dimTween) this._dimTween.cancel();
    this._dimTween = tween(this, { _dim: target }, {
      duration: 200,
      realtime: true,
      clock: this.clock,
      onUpdate: () => this._applyDim(),
    });
  }

  _applyDim() {
    const d = this._dim;
    const c = Math.round(255 - d * 105);
    const tint = (c << 16) | (c << 8) | c;
    this.base.tint = tint;
    this.crown.tint = tint;
    this.ring.tint = tint;
    this.body.alpha = 1 - d * 0.25;
  }

  // ------------------------------------------------------------------ per-frame
  /** @internal called by the Renderer every frame. t = game time in seconds. */
  update(t, realT) {
    const vis = this.visible && this.parent !== null && this.alpha > 0.001;
    const sx = this.scale.x;
    const bx = this.x + this.body.x * sx;
    const by = this.y + this.body.y * sx;
    const sq = this.squareSize || 40;
    const h = this._arcLift + this._selLift;
    if (this.epic) {
      const b = Math.sin(t * 2.2 * this.breath + this.phase);
      const k = this._kingFx;
      const dim = 1 - this._dim * 0.6;
      this.core.alpha = (0.72 + 0.28 * b) * dim + k * 0.3;
      const cs = 1 + 0.07 * b + k * 0.35;
      this.core.scale.set(cs);
      if (this.isKing) this.ring.rotation = t * 0.7 + this.phase;
      this.glow.visible = vis;
      if (vis) {
        this.glow.position.set(bx, by);
        const gs = (this.isKing ? 1.12 : 1.0) * sx * (1 + h * 0.15) * (1 + 0.05 * b + k * 0.5);
        this.glow.scale.set(gs);
        this.glow.alpha = ((this.isKing ? 0.85 : 0.66) + 0.14 * b + k * 0.4) * this.alpha * dim;
      }
      const cg = this.coreGlow;
      cg.visible = vis && this.topLayer !== null;
      if (cg.visible) {
        const R = this.skin.R;
        const bs = this.body.scale.x * sx;
        cg.position.set(bx, by);
        cg.scale.set(((R * (this.isKing ? 2.3 : 1.75)) / 64) * bs * (1 + 0.1 * b + k * 0.8));
        cg.alpha = ((this.isKing ? 0.55 : 0.5) + 0.25 * b + k * 0.5) * this.alpha * dim;
      }
    }
    const selVis = vis && (this._selected || this._selLift > 0.001);
    this.selGlow.visible = selVis;
    if (selVis) {
      const p = 0.5 + 0.5 * Math.sin(realT * 5.5);
      this.selGlow.position.set(bx, by + sq * 0.02);
      this.selGlow.scale.set(sx * (1.04 + 0.06 * p));
      this.selGlow.alpha = Math.min(1, this._selLift / 0.13) * (this.epic ? 0.75 + 0.25 * p : 0.55 + 0.25 * p) * this.alpha;
    }
  }

  /**
   * A lightweight visual copy of the disc (body sprites only, current lift/scale/king state) for
   * FX: afterimages, shatter stand-ins, cut-in portraits. Position it yourself (it is centred like
   * the view). The caller owns it: call snapshot.destroy({ children: true }) when done — textures
   * are shared with the skin and must NOT be destroyed.
   */
  snapshot({ shadow = false } = {}) {
    const root = new Container();
    root.label = 'piece-snapshot';
    const copy = (src, parent) => {
      if (!src.visible || !src.texture) return;
      const s = new Sprite(src.texture);
      s.anchor.copyFrom(src.anchor);
      s.position.copyFrom(src.position);
      s.scale.copyFrom(src.scale);
      s.rotation = src.rotation;
      s.alpha = src.alpha;
      s.tint = src.tint;
      s.blendMode = src.blendMode;
      parent.addChild(s);
    };
    if (shadow) copy(this.shadow, root);
    const body = new Container();
    body.position.copyFrom(this.body.position);
    body.scale.copyFrom(this.body.scale);
    for (const c of [this.ring, this.base, this.core, this.crown]) copy(c, body);
    root.addChild(body);
    return root;
  }

  /** Attach / detach the external glow sprites. */
  attachGlows() {
    if (this.glow.parent !== this.glowLayer) this.glowLayer.addChild(this.glow);
    if (this.selGlow.parent !== this.glowLayer) this.glowLayer.addChild(this.selGlow);
    if (this.topLayer && this.coreGlow.parent !== this.topLayer) this.topLayer.addChild(this.coreGlow);
  }

  detachGlows() {
    if (this.glow.parent) this.glow.parent.removeChild(this.glow);
    if (this.selGlow.parent) this.selGlow.parent.removeChild(this.selGlow);
    if (this.coreGlow.parent) this.coreGlow.parent.removeChild(this.coreGlow);
  }

  /** Cancel animations and restore the neutral state (pooling). */
  resetState() {
    for (const p of this._tweens) p.cancel();
    this._tweens.clear();
    if (this._selTween) this._selTween.cancel();
    if (this._dimTween) this._dimTween.cancel();
    if (this._moveTask) this._moveTask.cancel();
    if (this._settleTask) this._settleTask.cancel();
    this._moveTask = null;
    this._settleTask = null;
    if (this.clock) this.clock.cancelTweensOf(this);
    this._arcLift = 0;
    this._selLift = 0;
    this._squash = 0;
    this._selected = false;
    this._dim = 0;
    this._kingFx = 0;
    this._applyDim();
    this.alpha = 1;
    this.visible = true;
    this.scale.set(1);
    this.rotation = 0;
    this.body.alpha = 1;
    this.body.rotation = 0;
    this.body.x = 0;
    this.baseFade.visible = false;
    this.glint.visible = false;
    this.selGlow.alpha = 0;
    this.auraLayer.removeChildren();
    this._syncTextures(false);
  }

  destroy(options) {
    this.resetState();
    this.detachGlows();
    this.glow.destroy();
    this.selGlow.destroy();
    this.coreGlow.destroy();
    super.destroy({ children: true, ...(options || {}) });
  }
}
