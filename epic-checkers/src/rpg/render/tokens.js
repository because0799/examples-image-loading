// «Валькирии доски» — hero tokens and wards on the board.
//
// A TokenView is spread over five shared layers so the whole army draws in ~5 batches (no masks,
// no filters, no per-token blend switches):
//   shadows (normal)  → soft ground shadow
//   ground  (add)     → side tint ring on the floor (ally cyan / enemy crimson)
//   base    (normal)  → energy ring (track + arc, redrawn only when the value changes) + portrait
//                       (token atlas cell: circular art + rarity frame, Reflection look baked in)
//   glow    (add)     → rarity glow, Mythic iridescent sheen, «ult ready» pulse, shield bubble, halo
//   top     (normal)  → HP bar (+ damage trail, shield segment), element badge, seals, status chips,
//                       crown, ice block, stun stars
// Per-frame update() only writes a few numbers (rotation / alpha / tint) — no allocation.

import { Container, Sprite, Graphics, Texture } from 'pixi.js';
import { Ease } from '../../render/tween.js';
import {
  ELEMENT_FX, RARITY_FX, STATUS_FX, SIDE_COLORS, HP_COLORS, HP_TRAIL, SHIELD_COLOR, ENERGY_COLOR, ENERGY_READY, GOLD,
  visibleStatuses, iridescent, mix,
} from './theme.js';

const TAU = Math.PI * 2;

/** Share of a square the token portrait covers (diameter). */
export const TOKEN_D = 0.84;

function spr(tex, parent, ax = 0.5, ay = 0.5) {
  const s = new Sprite(tex);
  s.anchor.set(ax, ay);
  if (parent) parent.addChild(s);
  return s;
}

/** Fit a sprite to a width (keeps the frame's aspect). */
function fitW(s, w) {
  const t = s.texture;
  const tw = t && t.orig ? t.orig.width : 1;
  s.scale.set(w / (tw || 1));
}

export class TokenView {
  /**
   * @param {object} view   the BattleView (icons, tokenAtlas, layers, clock helpers)
   * @param {object} unit   battle Unit (id, heroId, side, element, rarity, boss, reflection …)
   */
  constructor(view, unit, hero) {
    this.view = view;
    this.id = unit.id;
    this.heroId = unit.heroId;
    this.side = unit.side;
    this.element = unit.element || (hero && hero.element) || 'none';
    this.rarity = unit.rarity || (hero && hero.rarity) || 'rare';
    this.boss = !!(unit.boss && !unit.boss.mini) || !!unit.isBoss;
    this.miniBoss = !!(unit.boss && unit.boss.mini);
    this.look = unit.reflection ? 'reflection' : 'hero';
    this.hero = hero || null;
    this.sq = -1;
    this.x = 0;
    this.y = 0;
    this.lift = 0;
    this.alive = true;
    this.hp = unit.hp;
    this.maxHp = Math.max(1, unit.maxHp || unit.hp || 1);
    this.shield = unit.shield || 0;
    this.energy = unit.energy || 0;
    this.maxEnergy = Math.max(1, unit.maxEnergy || 100);
    this.awakened = !!unit.awakened;
    this.statusIds = [];
    this.sealEls = [];
    this.frozen = false;
    this.stunned = false;
    this.veiled = false;
    this.selected = false;
    this.dimK = 1;
    this.pop = 1; // scale pulse (hits / selection)
    this._t = Math.random() * 10;
    this._glitch = 1.5 + Math.random() * 3;
    this._energyKey = '';
    this._hpTween = null;
    this._trailTween = null;

    const I = view.icons;
    const L = view.layers;
    const mk = (parent, label) => {
      const c = new Container();
      c.label = label;
      parent.addChild(c);
      return c;
    };
    this.cShadow = mk(L.shadows, `tok-shadow-${this.id}`);
    this.cGround = mk(L.ground, `tok-ground-${this.id}`);
    this.cBase = mk(L.base, `tok-base-${this.id}`);
    this.cGlow = mk(L.glow, `tok-glow-${this.id}`);
    this.cTop = mk(L.top, `tok-top-${this.id}`);
    this.containers = [this.cShadow, this.cGround, this.cBase, this.cGlow, this.cTop];

    this.shadowS = spr(I.frame('shadow'), this.cShadow);
    this.shadowS.alpha = 0.6;
    this.groundS = spr(I.frame('groundRing'), this.cGround);
    this.energyG = new Graphics();
    // the ring is a few hundred vertices: Pixi's 'auto' mode would draw it on its own (2 draw calls
    // per token, the portrait breaking the batch again); it is redrawn only when energy changes
    this.energyG.context.batchMode = 'batch';
    this.cBase.addChild(this.energyG);
    this.portrait = spr(this._portraitTex(), this.cBase);

    const rar = RARITY_FX[this.rarity] || RARITY_FX.rare;
    this.rarGlow = spr(I.frame('glowRing'), this.cGlow);
    this.rarGlow.tint = rar.id === 'mythic' ? 0xff4fd8 : rar.color;
    this.rarGlow.visible = rar.glow > 0;
    this.sheen = spr(I.frame('sheen'), this.cGlow);
    this.sheen.visible = !!rar.sheen && this.look !== 'reflection';
    this.readyGlow = spr(I.frame('glowRing'), this.cGlow);
    this.readyGlow.tint = ENERGY_READY;
    this.readyGlow.visible = false;
    this.shieldS = spr(I.frame('hexBubble'), this.cGlow);
    this.shieldS.tint = SHIELD_COLOR;
    this.shieldS.visible = false;
    this.haloS = spr(I.frame('halo'), this.cGlow);
    this.haloS.tint = GOLD;
    this.haloS.visible = false;

    this.hpBack = spr(Texture.WHITE, this.cTop, 0, 0.5);
    this.hpBack.tint = 0x07040c;
    this.hpTrail = spr(Texture.WHITE, this.cTop, 0, 0.5);
    this.hpTrail.tint = HP_TRAIL;
    this.hpFill = spr(Texture.WHITE, this.cTop, 0, 0.5);
    this.hpFill.tint = HP_COLORS[this.side] || HP_COLORS[1];
    this.hpShield = spr(Texture.WHITE, this.cTop, 0, 0.5);
    this.hpShield.tint = SHIELD_COLOR;
    this.badge = spr(I.frame(`el-${this.element}`), this.cTop);
    this.badge.visible = this.element !== 'none' && !!ELEMENT_FX[this.element];
    this.ice = spr(I.frame('iceBlock'), this.cTop);
    this.ice.visible = false;
    this.crown = spr(I.frame('crown'), this.cTop);
    this.crown.visible = false;
    this.seals = [spr(Texture.WHITE, this.cTop), spr(Texture.WHITE, this.cTop)];
    for (const s of this.seals) s.visible = false;
    this.chips = [spr(Texture.WHITE, this.cTop), spr(Texture.WHITE, this.cTop), spr(Texture.WHITE, this.cTop)];
    for (const s of this.chips) s.visible = false;
    this.stars = [spr(I.frame('stunStar'), this.cTop), spr(I.frame('stunStar'), this.cTop), spr(I.frame('stunStar'), this.cTop)];
    for (const s of this.stars) s.visible = false;

    this.setSideColor(view.sideColorOf(this.side));
    this.layout(view.sqSize);
    this.setHp(this.hp, this.maxHp, { animate: false });
    this.setShield(this.shield);
    this.setEnergy(this.energy, this.maxEnergy);
    this.setAwakened(this.awakened, false);
  }

  _portraitTex() {
    const h = this.hero;
    const name = h && h.name ? h.name.ru || h.name.en || '' : this.heroId || '';
    return this.view.portraitTexture({ heroId: this.heroId, rarity: this.rarity, element: this.element, look: this.look, initial: name.slice(0, 1).toUpperCase() });
  }

  /** Re-fetch the portrait texture (after the token atlas was rebuilt). */
  refreshPortrait() {
    this.portrait.texture = this._portraitTex();
    this.layout(this.view.sqSize);
  }

  get scaleK() {
    return this.boss ? 1.25 : this.miniBoss ? 1.12 : 1;
  }

  /** Size everything for a square size (px). */
  layout(sq) {
    this.sqPx = sq;
    const D = sq * TOKEN_D * this.scaleK;
    const R = D / 2;
    this.D = D;
    this.R = R;
    this.ringW = Math.max(2, sq * 0.065);
    this.ringR = R + this.ringW * 0.55;
    fitW(this.shadowS, D * 1.05);
    this.shadowS.scale.y = this.shadowS.scale.x * 0.9;
    this.shadowS.y = R * 0.78;
    fitW(this.groundS, D * 1.34);
    this.groundS.y = R * 0.9;
    fitW(this.portrait, D);
    fitW(this.rarGlow, D * 1.55);
    fitW(this.sheen, D * 1.02);
    fitW(this.readyGlow, D * 1.75);
    fitW(this.shieldS, D * 1.3);
    fitW(this.haloS, D * 0.9);
    this.haloS.y = -R * 1.28;
    const bw = Math.min(sq * 0.96, D * 1.08);
    const bh = Math.max(3, Math.round(sq * 0.085));
    this.barW = bw;
    this.barY = R + this.ringW * 1.3 + bh * 0.5;
    for (const s of [this.hpBack, this.hpTrail, this.hpFill, this.hpShield]) {
      s.x = -bw / 2;
      s.y = this.barY;
      s.height = bh;
    }
    this.hpBack.x = -bw / 2 - 1;
    this.hpBack.width = bw + 2;
    this.hpBack.height = bh + 2;
    fitW(this.badge, sq * 0.34);
    this.badge.position.set(R * 0.74, R * 0.6);
    fitW(this.ice, D * 1.18);
    fitW(this.crown, sq * 0.46);
    this.crown.y = -R - sq * 0.1;
    const cs = sq * 0.3;
    this.chipSize = cs;
    this.chips.forEach((s, i) => {
      s.position.set(R * 0.86, -R * 0.62 + i * cs * 0.92);
    });
    this.seals.forEach((s, i) => s.position.set(-R * 0.86 + i * cs * 0.15, -R * 0.62 + i * cs * 0.95));
    for (const s of this.stars) fitW(s, sq * 0.2);
    this._sizeChips();
    this._applyHpBar();
    this._energyKey = '';
    this._drawEnergy();
  }

  _sizeChips() {
    const cs = this.chipSize || 12;
    for (const s of this.chips) if (s.texture) fitW(s, cs);
    for (const s of this.seals) if (s.texture) fitW(s, cs * 1.05);
  }

  setSideColor(c) {
    this.sideColor = c != null ? c : SIDE_COLORS[this.side] || 0xffffff;
    this.groundS.tint = this.sideColor;
    if (this.ringR) this._drawEnergy();
  }

  // ------------------------------------------------------------------ position
  setPos(x, y) {
    this.x = x;
    this.y = y;
    this._place();
  }

  _place() {
    const ly = this.y - this.lift;
    this.cShadow.position.set(this.x, this.y);
    this.cGround.position.set(this.x, this.y);
    this.cBase.position.set(this.x, ly);
    this.cGlow.position.set(this.x, ly);
    this.cTop.position.set(this.x, ly);
    const k = 1 / (1 + this.lift / Math.max(1, this.sqPx || 40));
    this.cShadow.scale.set(k);
    this.cShadow.alpha = 0.35 + 0.65 * k;
  }

  setLift(v) {
    this.lift = v;
    this._place();
  }

  /** Bring this token above the others (while it travels). */
  raise() {
    for (const c of this.containers) {
      const p = c.parent;
      if (p) p.setChildIndex(c, p.children.length - 1);
    }
  }

  setVisible(v) {
    for (const c of this.containers) c.visible = v;
  }

  setAlpha(a) {
    for (const c of this.containers) c.alpha = a;
  }

  /** Dim for cinematics (1 = normal). */
  setDim(k) {
    this.dimK = k;
    const t = k >= 0.999 ? 0xffffff : mix(0x000000, 0xffffff, Math.max(0, Math.min(1, k)));
    this.cBase.tint = t;
    this.cTop.tint = t;
    this.cGlow.alpha = k;
    this.cGround.alpha = k;
  }

  setScale(k) {
    this.pop = k;
    const s = k;
    this.cBase.scale.set(s);
    this.cGlow.scale.set(s);
    this.cTop.scale.set(s);
  }

  // ------------------------------------------------------------------ stats
  setHp(hp, maxHp, { animate = true, heal = false } = {}) {
    const prev = this.hp;
    this.hp = Math.max(0, Number(hp) || 0);
    if (maxHp) this.maxHp = Math.max(1, maxHp);
    const k = Math.max(0, Math.min(1, this.hp / this.maxHp));
    const pk = Math.max(0, Math.min(1, prev / this.maxHp));
    this._hpK = k;
    const v = this.view;
    if (this._hpTween) this._hpTween.cancel();
    if (this._trailTween) this._trailTween.cancel();
    this._hpTween = null;
    this._trailTween = null;
    if (!animate || !v.ready || Math.abs(k - pk) < 1e-4) {
      this._fillK = k;
      this._trailK = k;
      this._applyHpBar();
      return;
    }
    if (k < pk) {
      // damage: the fill snaps, the trail waits a moment, then drains
      this._fillK = k;
      this._trailK = Math.max(this._trailK != null ? this._trailK : pk, pk);
      this._applyHpBar();
      const from = this._trailK;
      this._trailTween = v.anim(420, (e) => {
        this._trailK = from + (k - from) * e;
        this._applyHpBar();
      }, { delay: 260, ease: Ease.inOutQuad });
    } else {
      // heal: the trail shows the new value in green at once, the fill catches up
      this._trailK = k;
      const from = this._fillK != null ? this._fillK : pk;
      this.hpTrail.tint = 0x9dffbf;
      this._hpTween = v.anim(380, (e) => {
        this._fillK = from + (k - from) * e;
        this._applyHpBar();
        if (e >= 1) this.hpTrail.tint = HP_TRAIL;
      }, { ease: Ease.outCubic });
      this._applyHpBar();
    }
    void heal;
  }

  _applyHpBar() {
    const w = this.barW || 30;
    const f = this._fillK != null ? this._fillK : this.hp / this.maxHp;
    const t = this._trailK != null ? this._trailK : f;
    this.hpFill.width = Math.max(0, w * f);
    this.hpTrail.width = Math.max(0, w * Math.max(f, t));
    const sh = Math.min(1 - Math.min(1, f), this.shield / this.maxHp);
    const shOver = Math.min(0.35, this.shield / this.maxHp);
    // shield: a pale segment after the fill (or over its end when HP is full)
    if (this.shield > 0) {
      const sw = Math.max(2, w * Math.max(sh, Math.min(shOver, 0.35)));
      this.hpShield.visible = true;
      this.hpShield.width = sw;
      this.hpShield.x = -w / 2 + Math.min(w - sw, w * f);
    } else this.hpShield.visible = false;
  }

  setShield(v) {
    this.shield = Math.max(0, Number(v) || 0);
    this.shieldS.visible = this.shield > 0;
    this._applyHpBar();
  }

  setEnergy(v, max) {
    this.energy = Math.max(0, Number(v) || 0);
    if (max) this.maxEnergy = Math.max(1, max);
    this._drawEnergy();
  }

  get ultReady() {
    return this.energy >= this.maxEnergy - 1e-6;
  }

  _drawEnergy() {
    const k = Math.max(0, Math.min(1, this.energy / this.maxEnergy));
    const ready = k >= 0.999;
    const key = `${Math.round(k * 200)}|${ready}|${this.ringR.toFixed(2)}|${this.sideColor}`;
    this.readyGlow.visible = ready && this.alive;
    if (key === this._energyKey) return;
    this._energyKey = key;
    const g = this.energyG;
    const r = this.ringR;
    const w = this.ringW;
    g.clear();
    // the outer band = side tint (ally / enemy), the energy arc runs on top of it
    g.circle(0, 0, r).stroke({ width: w + 1.6, color: 0x05030a, alpha: 0.9 });
    g.circle(0, 0, r).stroke({ width: w, color: mix(this.sideColor != null ? this.sideColor : 0x888888, 0x000000, 0.42), alpha: 1 });
    if (k > 0.005) {
      const a0 = -Math.PI / 2;
      const a1 = a0 + TAU * k;
      g.moveTo(Math.cos(a0) * r, Math.sin(a0) * r);
      g.arc(0, 0, r, a0, a1);
      g.stroke({ width: w * 0.72, color: ready ? ENERGY_READY : ENERGY_COLOR, alpha: 1, cap: 'round' });
    }
  }

  setStatuses(statuses) {
    const ids = visibleStatuses(statuses, 3);
    const list = Array.isArray(statuses) ? statuses.map((s) => (s && s.id) || s) : [];
    this.frozen = list.includes('frozen');
    this.stunned = list.includes('stun') || list.includes('break');
    this.veiled = list.includes('untargetable');
    this.ice.visible = this.frozen && this.alive;
    for (const s of this.stars) s.visible = this.stunned && this.alive;
    const I = this.view.icons;
    this.chips.forEach((s, i) => {
      const id = ids[i];
      s.visible = !!id && this.alive;
      if (id) s.texture = I.frame(`st-${id}`);
    });
    this.statusIds = ids;
    this._sizeChips();
    this.cBase.alpha = this.veiled ? 0.55 : 1;
  }

  /** seals: array of element ids (natural, celestial). */
  setSeals(seals) {
    const els = (Array.isArray(seals) ? seals : seals ? [seals] : []).map((x) => (x && x.element) || x).filter((x) => x && ELEMENT_FX[x] && ELEMENT_FX[x].leavesSeal);
    const I = this.view.icons;
    this.seals.forEach((s, i) => {
      const el = els[i];
      s.visible = !!el && this.alive;
      if (el) s.texture = I.frame(`seal-${el}`);
    });
    this.sealEls = els;
    this._sizeChips();
  }

  setAwakened(on, animate = true) {
    this.awakened = !!on;
    this.crown.visible = this.awakened && this.alive;
    this.haloS.visible = this.awakened && this.alive;
    if (on && animate && this.view.ready) {
      const sc = this.crown.scale.x;
      this.crown.scale.set(sc * 2.2);
      this.crown.alpha = 0;
      this.view.anim(420, (e) => {
        this.crown.scale.set(sc * (2.2 - 1.2 * e));
        this.crown.alpha = e;
      }, { ease: Ease.outBack });
    }
  }

  setAlive(on) {
    this.alive = !!on;
    this.setVisible(this.alive);
    if (!on) {
      this.readyGlow.visible = false;
      this.ice.visible = false;
    }
  }

  /** Full sync from a Unit. */
  sync(u, { animate = false } = {}) {
    if (!u) return;
    this.setAlive(!!u.alive && u.sq >= 0);
    if (u.maxHp) this.maxHp = Math.max(1, u.maxHp);
    if (u.hp !== this.hp) this.setHp(u.hp, u.maxHp, { animate });
    else this._applyHpBar();
    this.setShield(u.shield || 0);
    this.setEnergy(u.energy || 0, u.maxEnergy);
    this.setStatuses(u.statuses || []);
    this.setSeals(u.seals ? u.seals : u.seal ? [u.seal] : []);
    if (!!u.awakened !== this.awakened) this.setAwakened(!!u.awakened, animate);
    else {
      this.crown.visible = this.awakened && this.alive;
      this.haloS.visible = this.awakened && this.alive;
    }
  }

  // ------------------------------------------------------------------ frame
  update(t, dt) {
    if (!this.alive) return;
    this._t += dt / 1000;
    const T = this._t;
    if (this.sheen.visible) {
      this.sheen.rotation = T * 1.4;
      this.sheen.tint = iridescent(T * 0.6);
      this.rarGlow.tint = iridescent(T * 0.6 + 1.5);
      this.rarGlow.alpha = 0.5 + 0.12 * Math.sin(T * 2.2);
    } else if (this.rarGlow.visible) {
      const rar = RARITY_FX[this.rarity];
      this.rarGlow.alpha = (rar ? rar.glow : 0.3) * (0.8 + 0.2 * Math.sin(T * 2.4));
    }
    if (this.readyGlow.visible) {
      const p = 0.5 + 0.5 * Math.sin(T * 5.2);
      this.readyGlow.alpha = 0.45 + 0.45 * p;
      const s = (this.D * (1.62 + 0.12 * p)) / (this.readyGlow.texture.orig.width || 1);
      this.readyGlow.scale.set(s);
    }
    if (this.shieldS.visible) this.shieldS.alpha = 0.42 + 0.12 * Math.sin(T * 3.1);
    if (this.haloS.visible) this.haloS.alpha = 0.7 + 0.25 * Math.sin(T * 2.6);
    if (this.stunned) {
      for (let i = 0; i < this.stars.length; i++) {
        const a = T * 4 + (i * TAU) / 3;
        this.stars[i].position.set(Math.cos(a) * this.R * 0.7, -this.R * 1.05 + Math.sin(a) * this.R * 0.22);
      }
    }
    if (this.sealEls.length) {
      const k = 1 + 0.06 * Math.sin(T * 3.4);
      for (const s of this.seals) if (s.visible) s.alpha = 0.85 + 0.15 * Math.sin(T * 3.4);
      void k;
    }
    if (this.look === 'reflection') {
      this._glitch -= dt / 1000;
      if (this._glitch <= 0) {
        this.portrait.x = (Math.random() < 0.5 ? -1 : 1) * this.sqPx * 0.035;
        this.portrait.tint = 0xd8b8ff;
        if (this._glitch <= -0.08) {
          this.portrait.x = 0;
          this.portrait.tint = 0xffffff;
          this._glitch = 1.8 + Math.random() * 3.5;
        }
      }
    }
  }

  destroy() {
    if (this._hpTween) this._hpTween.cancel();
    if (this._trailTween) this._trailTween.cancel();
    for (const c of this.containers) c.destroy({ children: true });
    this.containers = [];
  }
}

// ============================================================================ wards
const WARD_ART = {
  'ice-wall': { frame: 'iceWall', w: 0.9, glow: 0x8eebff },
  'ball-lightning': { frame: 'orb', w: 0.78, glow: 0xa46bff, spin: true },
  'stone-pillar': { frame: 'pillar', w: 0.62, glow: 0 },
  'phoenix-egg': { frame: 'egg', w: 0.7, glow: 0xff7a3a },
  candle: { frame: 'candle', w: 0.42, glow: 0xffd27a },
  'hollow-pawn': { frame: 'pawn', w: 0.58, glow: 0x8a7cff },
  caravan: { frame: 'caravan', w: 0.86, glow: 0 },
};

/** A ward (summoned object) on the board: ice wall, ball lightning, pillar, egg, candle, decoy … */
export class WardView {
  constructor(view, ward, ownerUnit) {
    this.view = view;
    this.id = ward.id;
    this.kind = ward.kind || 'ward';
    this.side = ward.side;
    this.sq = -1;
    this.x = 0;
    this.y = 0;
    this.lift = 0;
    this.hp = ward.hp;
    this.maxHp = Math.max(1, ward.maxHp || ward.hp || 1);
    this.alive = true;
    this._t = Math.random() * 10;
    const I = view.icons;
    const L = view.layers;
    const mk = (parent, label) => {
      const c = new Container();
      c.label = label;
      parent.addChild(c);
      return c;
    };
    this.cShadow = mk(L.shadows, `ward-shadow-${this.id}`);
    this.cBase = mk(L.base, `ward-base-${this.id}`);
    this.cGlow = mk(L.glow, `ward-glow-${this.id}`);
    this.cTop = mk(L.top, `ward-top-${this.id}`);
    this.containers = [this.cShadow, this.cBase, this.cGlow, this.cTop];
    this.shadowS = spr(I.frame('shadow'), this.cShadow);
    this.shadowS.alpha = 0.55;
    const decoy = this.kind === 'decoy' || ward.special === 'decoy';
    this.art = decoy ? { frame: null, w: 0.8, glow: 0x8a7cff } : WARD_ART[this.kind] || { frame: 'pillar', w: 0.6, glow: 0 };
    if (decoy && ownerUnit) {
      this.body = spr(view.portraitTexture({ heroId: ownerUnit.heroId, rarity: ownerUnit.rarity, element: ownerUnit.element, look: 'decoy', initial: '?' }), this.cBase);
      this.body.alpha = 0.8;
    } else this.body = spr(I.frame(this.art.frame || 'pillar'), this.cBase, 0.5, 0.8);
    this.glowS = spr(I.frame('dot'), this.cGlow);
    this.glowS.tint = this.art.glow || 0xffffff;
    this.glowS.visible = !!this.art.glow;
    this.hpBack = spr(Texture.WHITE, this.cTop, 0, 0.5);
    this.hpBack.tint = 0x07040c;
    this.hpFill = spr(Texture.WHITE, this.cTop, 0, 0.5);
    this.hpFill.tint = mix(HP_COLORS[this.side] || 0xcccccc, 0xffffff, 0.25);
    this.showBar = this.maxHp > 1;
    this.layout(view.sqSize);
  }

  layout(sq) {
    this.sqPx = sq;
    const w = sq * this.art.w;
    fitW(this.body, w);
    if (this.body.anchor.y > 0.6) this.body.y = sq * 0.3;
    else this.body.y = 0;
    fitW(this.shadowS, sq * 0.8);
    this.shadowS.y = sq * 0.3;
    fitW(this.glowS, sq * 1.3);
    const bw = sq * 0.7;
    const bh = Math.max(2, Math.round(sq * 0.07));
    this.barW = bw;
    for (const s of [this.hpBack, this.hpFill]) {
      s.x = -bw / 2;
      s.y = sq * 0.42;
      s.height = bh;
      s.visible = this.showBar;
    }
    this.hpBack.width = bw;
    this.setHp(this.hp);
  }

  setPos(x, y) {
    this.x = x;
    this.y = y;
    for (const c of this.containers) c.position.set(x, y - (c === this.cShadow ? 0 : this.lift));
  }

  setHp(hp, maxHp) {
    this.hp = Math.max(0, Number(hp) || 0);
    if (maxHp) this.maxHp = Math.max(1, maxHp);
    this.hpFill.width = this.barW * Math.max(0, Math.min(1, this.hp / this.maxHp));
  }

  setAlpha(a) {
    for (const c of this.containers) c.alpha = a;
  }

  setDim(k) {
    const t = k >= 0.999 ? 0xffffff : mix(0x000000, 0xffffff, Math.max(0, Math.min(1, k)));
    this.cBase.tint = t;
    this.cGlow.alpha = k;
  }

  update(t, dt) {
    this._t += dt / 1000;
    if (this.glowS.visible) this.glowS.alpha = 0.45 + 0.25 * Math.sin(this._t * (this.art.spin ? 9 : 2.5));
    if (this.art.spin) this.body.rotation = Math.sin(this._t * 3) * 0.15;
  }

  destroy() {
    for (const c of this.containers) c.destroy({ children: true });
    this.containers = [];
  }
}
