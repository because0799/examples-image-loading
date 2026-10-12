// «Валькирии доски» — floating damage / heal / shield numbers (GDD §18.4), Genshin-style.
//
//   numbers.show({ x, y, key, amount, kind: 'damage'|'heal'|'shield'|'drain'|'true', element,
//                  crit, reaction, dot })
//
// Numbers are composed from pooled glyph sprites of pre-rendered digit atlases (GlyphFont): no
// canvas text is rasterised during a battle, so a 6-target Ultimate costs nothing extra. The white
// atlas is tinted per element; crits use a gold atlas (+ a starburst and «КРИТ»), reactions their
// pair's two-colour atlas (built lazily, once per reaction) with the «ПАР! 蒸» label above.
// Readability: ≤ 6 on screen, a series on one target collapses into a sum after the 3rd hit
// («×6 = 2 854»), newer numbers push older ones up, life scales with settings.textTime. Numbers
// animate in REAL time (hit-stop / slow-mo never freeze a number you are reading).

import { Container, Sprite, Texture } from 'pixi.js';
import { Ease } from '../../render/tween.js';
import { GlyphFont, reactionFill, CRIT_FILL } from './art.js';
import { NUMBER_STYLE, ELEMENT_FX, REACTION_FX, HEAL_COLOR, SHIELD_COLOR, DRAIN_COLOR, formatAmount, textTimeOf, word, mix, css, shade } from './theme.js';
import { stackNumbers } from './timeline.js';

const S = NUMBER_STYLE;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

class NumberItem {
  constructor() {
    this.root = new Container();
    this.root.label = 'rpg-number';
    this.glyphs = [];
    this.icon = new Sprite(Texture.WHITE);
    this.icon.anchor.set(0.5);
    this.root.addChild(this.icon);
    this.label = new Sprite(Texture.WHITE);
    this.label.anchor.set(0.5, 1);
    this.root.addChild(this.label);
    this.back = new Sprite(Texture.WHITE);
    this.back.anchor.set(0.5);
    this.labelTex = null;
    this.reset();
  }

  reset() {
    this.key = null;
    this.age = 0;
    this.life = 1000;
    this.born = 0;
    this.touched = 0;
    this.sum = false;
    this.series = false;
    this.hits = 0;
    this.total = 0;
    this.dying = false;
    this.fade = S.fadeMs;
    this.shift = 0;
    this.shiftTo = 0;
    this.size = 16;
    this.scaleK = 1;
    this.crit = false;
    this.reaction = null;
    this.shake = 0;
    this.width = 0;
    this.icon.visible = false;
    this.label.visible = false;
    this.back.visible = false;
    this.root.alpha = 1;
    this.root.visible = true;
    this.root.scale.set(1);
  }
}

export class FloatingNumbers {
  /**
   * @param {object} view BattleView: layers.numbers / layers.numbersGlow, icons, fx, settings,
   *                      sqSize, lang, clock (realNow)
   */
  constructor(view) {
    this.view = view;
    this.live = [];
    this.pool = [];
    this.glyphPool = [];
    this.fonts = null;
    this.reactionFonts = new Map();
    this.res = 2;
  }

  /** Build the digit atlases (needs the Unbounded font loaded for the best look). */
  build(res = 2) {
    this.res = Math.max(1, Math.min(2.5, res));
    this.destroyFonts();
    this.fonts = {
      white: new GlyphFont({ size: 44, res: this.res, fill: '#ffffff', stroke: '#14060c', strokeK: 0.2 }),
      crit: new GlyphFont({ size: 44, res: this.res, fill: CRIT_FILL, stroke: '#2a1200', strokeK: 0.22, glow: 'rgba(255,170,40,0.85)' }),
    };
  }

  _reactionFont(id) {
    let f = this.reactionFonts.get(id);
    if (f) return f;
    const R = REACTION_FX[id];
    if (!R) return this.fonts.white;
    f = new GlyphFont({ size: 44, res: this.res, fill: reactionFill(R.colors), stroke: css(shade(R.colors[1], 0.18)), strokeK: 0.22, glow: `rgba(${(R.colors[0] >> 16) & 255},${(R.colors[0] >> 8) & 255},${R.colors[0] & 255},0.7)` });
    this.reactionFonts.set(id, f);
    return f;
  }

  get settings() {
    return this.view.settings;
  }

  _now() {
    return this.view.clock ? this.view.clock.realNow : 0;
  }

  _item() {
    const it = this.pool.pop() || new NumberItem();
    it.reset();
    this.view.layers.numbers.addChild(it.root);
    this.view.layers.numbersGlow.addChild(it.back);
    return it;
  }

  _glyph() {
    const g = this.glyphPool.pop() || new Sprite(Texture.WHITE);
    g.anchor.set(0, 0.5);
    g.visible = true;
    g.tint = 0xffffff;
    return g;
  }

  _release(it) {
    for (const g of it.glyphs) {
      g.removeFromParent();
      g.texture = Texture.WHITE;
      if (this.glyphPool.length < 160) this.glyphPool.push(g);
      else g.destroy();
    }
    it.glyphs.length = 0;
    if (it.labelTex) {
      this.view.releaseText(it.labelTex);
      it.labelTex = null;
    }
    it.label.texture = Texture.WHITE;
    it.root.removeFromParent();
    it.back.removeFromParent();
    if (this.pool.length < 24) this.pool.push(it);
    else {
      it.root.destroy({ children: true });
      it.back.destroy();
    }
  }

  /** Lay out `text` in `font` at glyph size `size` (px), tinted `tint`; centred on x = 0. */
  _setText(it, text, font, size, tint, iconFrame, iconTint) {
    for (const g of it.glyphs) {
      g.removeFromParent();
      this.glyphPool.push(g);
    }
    it.glyphs.length = 0;
    const k = size / font.size;
    let w = 0;
    const chars = Array.from(text);
    for (const ch of chars) {
      const gl = font.glyph(ch);
      w += gl ? gl.adv * k : size * 0.5;
    }
    const iconW = iconFrame ? size * 0.95 : 0;
    const total = w + iconW;
    let x = -total / 2 + iconW;
    for (const ch of chars) {
      const gl = font.glyph(ch);
      if (!gl) {
        x += size * 0.5;
        continue;
      }
      const s = this._glyph();
      s.texture = gl.tex;
      s.scale.set(k);
      s.position.set(x - (gl.pad || 0) * k, 0);
      s.tint = tint;
      it.root.addChildAt(s, 0);
      it.glyphs.push(s);
      x += gl.adv * k;
    }
    if (iconFrame) {
      it.icon.visible = true;
      it.icon.texture = this.view.icons.frame(iconFrame);
      it.icon.tint = iconTint;
      const fw = it.icon.texture.orig.width || 24;
      it.icon.scale.set((size * 0.8) / fw);
      it.icon.position.set(-total / 2 + iconW * 0.45, 0);
    } else it.icon.visible = false;
    it.width = total;
  }

  /** Show a number. Returns the item (or null when numbers are off / zero). */
  show(o) {
    if (!this.fonts || !o) return null;
    const view = this.view;
    if (view.settings && view.settings.rpgDamageNumbers === false) return null;
    const amount = Math.round(Math.abs(Number(o.amount) || 0));
    const kind = o.kind || 'damage';
    if (!amount && kind !== 'damage') return null;
    const now = this._now();
    const sq = view.sqSize || 40;
    const series = kind === 'damage' && !o.dot;
    const dec = stackNumbers(this.live, o.key, { maxVisible: S.maxVisible, collapseAfter: S.collapseAfter, now, series });
    for (const ev of dec.evict) this._kill(ev, 140);
    const el = ELEMENT_FX[o.element] || ELEMENT_FX.none;
    let size = sq * S.size * (o.dot ? S.dotScale : 1);
    if (o.crit) size *= S.critScale;
    if (o.reaction) size *= S.reactionScale;
    const life = (S.popMs + S.baseHoldMs * textTimeOf(view.settings) * (o.crit || o.reaction ? 1.25 : 1) + S.fadeMs);

    if (dec.mode === 'sum' || dec.mode === 'collapse') {
      let it = dec.into;
      if (!it) {
        it = this._item();
        it.key = o.key;
        it.sum = true;
        it.series = true;
        it.born = now;
        it.hits = 0;
        it.total = 0;
        it.x = o.x;
        it.y = o.y;
        for (const m of dec.merge) {
          it.hits += m.hits || 1;
          it.total += m.total || 0;
          this._kill(m, 120);
        }
        this.live.push(it);
      }
      it.hits += 1;
      it.total += amount;
      it.touched = now;
      it.age = Math.min(it.age, S.popMs * 0.5);
      it.life = Math.max(it.life, life + 200);
      it.crit = it.crit || !!o.crit;
      const font = this.fonts.white;
      const fs = sq * S.size * 1.18;
      it.size = fs;
      this._setText(it, `×${it.hits} = ${formatAmount(it.total)}`, font, fs, mix(el.num, 0xffffff, 0.25), null, 0);
      it.root.position.set(it.x, it.y - sq * 0.55);
      it.scaleK = 1.18;
      it.punch = 1;
      return it;
    }

    for (const m of dec.shift) {
      m.shiftTo += sq * S.stackShift;
    }
    const it = this._item();
    it.key = o.key;
    it.series = series;
    it.hits = 1;
    it.total = amount;
    it.born = now;
    it.touched = now;
    it.life = life;
    it.size = size;
    it.crit = !!o.crit;
    it.reaction = o.reaction || null;
    it.x = o.x + (Math.random() - 0.5) * sq * 0.18;
    it.y = o.y - sq * 0.38;
    let font = this.fonts.white;
    let tint = el.num;
    let text = formatAmount(amount);
    let icon = null;
    let iconTint = 0xffffff;
    if (kind === 'heal') {
      tint = HEAL_COLOR;
      text = `+${text}`;
    } else if (kind === 'shield') {
      tint = SHIELD_COLOR;
      icon = 'shieldIcon';
      iconTint = SHIELD_COLOR;
    } else if (kind === 'drain') {
      tint = DRAIN_COLOR;
      text = `−${text}`;
      icon = 'boltIcon';
      iconTint = DRAIN_COLOR;
    } else if (kind === 'true') {
      tint = o.element && o.element !== 'none' ? el.num : 0xe8e2f2;
    } else if (o.reaction && REACTION_FX[o.reaction]) {
      font = this._reactionFont(o.reaction);
      tint = 0xffffff;
    } else if (o.crit) {
      font = this.fonts.crit;
      tint = 0xffffff;
    }
    this._setText(it, text, font, size, tint, icon, iconTint);
    // crit: starburst + «КРИТ»; reaction: ring + label
    if (o.crit || o.reaction) {
      it.back.visible = true;
      it.back.texture = view.icons.frame(o.crit ? 'burst' : 'glowRing');
      it.back.tint = o.reaction && REACTION_FX[o.reaction] ? REACTION_FX[o.reaction].colors[0] : 0xffb830;
      const bw = it.back.texture.orig.width || 96;
      it.backBase = (Math.max(it.width, size * 1.6) * 1.25) / bw;
      it.back.scale.set(0);
      it.back.alpha = 0.85;
    }
    const lbl = o.reaction && REACTION_FX[o.reaction] ? REACTION_FX[o.reaction].label[view.lang === 'en' ? 'en' : 'ru'] : o.crit ? word('crit', view.lang) : null;
    if (lbl) {
      const tex = view.labelTexture(lbl, o.reaction ? REACTION_FX[o.reaction].colors : [0xffd23f, 0xff8a1f], Math.round(size * (o.reaction ? 0.62 : 0.5)));
      if (tex) {
        it.labelTex = tex;
        it.label.texture = tex;
        it.label.visible = true;
        it.label.scale.set(1);
        it.label.position.set(0, -size * 0.52);
        it.shake = o.reaction ? 1 : 0;
      }
    }
    it.root.position.set(it.x, it.y);
    this.live.push(it);
    return it;
  }

  _kill(it, ms = 160) {
    if (it.dying) return;
    it.dying = true;
    it.life = it.age + ms;
    it.fade = ms;
  }

  /** Per frame (real-time dt in ms). */
  update(rdt) {
    const list = this.live;
    if (!list.length) return;
    const sq = this.view.sqSize || 40;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      it.age += rdt;
      if (it.age >= it.life) {
        this._release(it);
        continue;
      }
      list[w++] = it;
      const a = it.age;
      // stack shift eases toward its target
      it.shift += (it.shiftTo - it.shift) * Math.min(1, rdt / 90);
      const pk = clamp01(a / S.popMs);
      const pop = pk < 1 ? 0.4 + 0.9 * Ease.outBack(pk) : 1;
      const rise = it.sum ? sq * 0.12 * Ease.outCubic(clamp01(a / 600)) : sq * S.rise * Ease.outCubic(clamp01(a / 700));
      const fadeStart = it.life - it.fade;
      const alpha = a < fadeStart ? 1 : clamp01(1 - (a - fadeStart) / it.fade);
      let sx = 0;
      if (it.shake && a < 380) sx = Math.sin(a * 0.09) * sq * 0.035 * (1 - a / 380);
      let k = pop * (it.scaleK || 1);
      if (it.punch) {
        const pa = clamp01((this._now() - it.touched) / 160);
        k *= 1 + 0.25 * (1 - pa);
      }
      it.root.scale.set(k);
      it.root.alpha = alpha;
      const y = (it.sum ? it.y - sq * 0.55 : it.y) - rise - it.shift;
      it.root.position.set(it.x + sx, y);
      if (it.back.visible) {
        const bk = clamp01(a / 260);
        it.back.position.set(it.x + sx, y);
        it.back.scale.set(it.backBase * (0.5 + 0.7 * Ease.outCubic(bk)));
        it.back.rotation = a * 0.0012;
        it.back.alpha = 0.75 * alpha * (1 - 0.6 * bk);
      }
    }
    list.length = w;
  }

  get count() {
    return this.live.length;
  }

  clear() {
    for (const it of this.live) this._release(it);
    this.live.length = 0;
  }

  destroyFonts() {
    if (this.fonts) for (const f of Object.values(this.fonts)) f.destroy();
    for (const f of this.reactionFonts.values()) f.destroy();
    this.reactionFonts.clear();
    this.fonts = null;
  }

  destroy() {
    this.clear();
    this.destroyFonts();
    for (const it of this.pool) {
      it.root.destroy({ children: true });
      it.back.destroy();
    }
    for (const g of this.glyphPool) g.destroy();
    this.pool.length = 0;
    this.glyphPool.length = 0;
  }
}
