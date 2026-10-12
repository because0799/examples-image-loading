// «Валькирии доски» — Ultimate cut-ins with the hero's splash art (GDD §18.3) and name plates.
//
//   cutin.play({ token, hero, kind: 'compact' | 'band' | 'fullscreen', ms, ultName })  → Promise
//       compact     Rare: a short tilted band cropped around the face (0.6 s)
//       band        Epic / Legendary: a tilted band ≈ ⅓ of the screen, art cropped by the measured
//                   face point (RPG_ASSETS.focal), name RU + Ultimate name RU and JP (Dela Gothic)
//       fullscreen  Mythic: the whole 16:9 splash covering the screen with a slow push-in, letterbox
//                   bars and an iridescent glint sweep
//   cutin.subtitle(text)     voice subtitle under the band (RU / EN, from playVoice's onStart)
//   cutin.namePlate(text, el, { jp, hold })  small skill / Ultimate name plate over the board top
//   cutin.stop()             remove everything now (skip)
// The splash texture is created when the cut-in starts and released by BattleView's LRU.

import { Container, Sprite, Texture, Rectangle, Graphics, TilingSprite } from 'pixi.js';
import { Ease } from '../../render/tween.js';
import { readMs } from '../../fx/prefs.js';
import { elementFx, iridescent, mix, GOLD } from './theme.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class CutIn {
  constructor(view) {
    this.view = view;
    this.active = new Set(); // { root, texs: [], subTex }
    this.plates = new Set();
    this._sub = null;
  }

  get layer() {
    return this.view.layers.screenRoot;
  }

  usesTexture(tex) {
    for (const a of this.active) if (a.splash === tex) return true;
    return false;
  }

  _label(text, colors, size) {
    return this.view.labelTexture(text, colors, size);
  }

  _spriteFor(tex, parent, ax = 0, ay = 0.5) {
    const s = new Sprite(tex);
    s.anchor.set(ax, ay);
    parent.addChild(s);
    return s;
  }

  _dispose(rec) {
    if (!rec || rec.disposed) return;
    rec.disposed = true;
    this.active.delete(rec);
    for (const t of rec.texs) this.view.releaseText(t);
    rec.texs.length = 0;
    if (rec.crop) rec.crop.destroy(false);
    rec.root.destroy({ children: true });
    if (this._sub && this._sub.rec === rec) this._sub = null;
  }

  stop() {
    for (const rec of Array.from(this.active)) this._dispose(rec);
    for (const p of Array.from(this.plates)) this._disposePlate(p);
  }

  destroy() {
    this.stop();
  }

  /**
   * Play a cut-in. Resolves when it has left the screen (or at once when skipped).
   * o = { token, hero, kind, ms, ultName: { ru, en, jp } }
   */
  async play(o) {
    const v = this.view;
    if (v.skipping) return;
    const hero = o.hero;
    const heroId = hero ? hero.id : o.token ? o.token.heroId : null;
    const el = elementFx(hero ? hero.element : o.token ? o.token.element : 'none');
    const splash = heroId ? await v.splashTexture(heroId) : null;
    if (v.skipping) return;
    const scr = v.renderer.screen;
    const rec = { root: new Container(), texs: [], splash: splash ? splash.tex : null, crop: null, disposed: false };
    rec.root.label = 'rpg-cutin';
    this.layer.addChild(rec.root);
    this.active.add(rec);
    const lang = v.lang === 'en' ? 'en' : 'ru';
    const name = hero ? hero.name[lang] || hero.name.ru : '';
    const ult = o.ultName ? o.ultName[lang] || o.ultName.ru : '';
    const jp = o.ultName ? o.ultName.jp : '';
    const ms = Math.max(300, o.ms || 800);
    try {
      if (o.kind === 'fullscreen') await this._fullscreen(rec, splash, heroId, el, { name, ult, jp, ms, scr });
      else await this._band(rec, splash, heroId, el, { name, ult, jp, ms, scr, compact: o.kind === 'compact' });
    } finally {
      this._dispose(rec);
    }
  }

  _focal(heroId) {
    const a = this.view.assets;
    if (a && typeof a.focal === 'function') {
      const f = a.focal(heroId);
      if (f && Number.isFinite(f.x) && Number.isFinite(f.y)) return f;
    }
    return { x: 0.5, y: 0.27 };
  }

  async _band(rec, splash, heroId, el, { name, ult, jp, ms, scr, compact }) {
    const v = this.view;
    const W = scr.width;
    const H = scr.height;
    const bh = Math.round(compact ? Math.min(H * 0.2, W * 0.5) : Math.min(H * 0.33, W * 0.9));
    const bw = W * 1.5;
    const cy = v.layout ? Math.max(bh * 0.6, Math.min(H - bh * 0.6, v.layout.y + v.layout.total * 0.32)) : H * 0.38;
    const sgn = heroId && heroId.length % 2 ? 1 : -1; // vary the entry side per heroine
    const root = rec.root;
    const band = new Container();
    band.position.set(W / 2, cy);
    band.rotation = -0.1 * sgn;
    root.addChild(band);
    const content = new Container();
    band.addChild(content);
    const mask = new Graphics();
    mask.rect(-bw / 2, -bh / 2, bw, bh).fill(0xffffff);
    band.addChild(mask);
    content.mask = mask;
    // background: element gradient (shows when the art is missing / around it)
    const bg = new Sprite(Texture.WHITE);
    bg.anchor.set(0.5);
    bg.width = bw;
    bg.height = bh;
    bg.tint = mix(el.dark, 0x000000, 0.3);
    content.addChild(bg);
    // art crop
    let art = null;
    if (splash && splash.tex && splash.tex !== Texture.WHITE) {
      const f = this._focal(heroId);
      const sw = splash.w;
      const sh = splash.h;
      const viewW = W * 1.05; // the visible part of the band
      const aspect = viewW / bh;
      let ch = sh * (compact ? 0.36 : 0.62);
      let cw = ch * aspect;
      if (cw > sw) {
        cw = sw;
        ch = cw / aspect;
      }
      const cx0 = Math.max(0, Math.min(sw - cw, f.x * sw - cw / 2));
      const cy0 = Math.max(0, Math.min(sh - ch, f.y * sh - ch * (compact ? 0.42 : 0.3)));
      rec.crop = new Texture({ source: splash.tex.source, frame: new Rectangle(cx0, cy0, cw, ch), label: 'rpg-cutin-crop' });
      art = new Sprite(rec.crop);
      art.anchor.set(0.5);
      art._base = viewW / cw;
      art.scale.set(art._base);
      content.addChild(art);
    } else if (v.tokenAtlas && heroId) {
      const tok = v.token([...v.tokens.keys()].find((id) => v.tokens.get(id).heroId === heroId));
      if (tok) {
        art = new Sprite(tok.portrait.texture);
        art.anchor.set(0.5);
        art._base = (bh * 1.6) / (art.texture.orig.width || 1);
        art.scale.set(art._base);
        art.y = bh * 0.25;
        content.addChild(art);
      }
    }
    // element light + speed streaks
    const glow = new Sprite(v.icons.frame('dot'));
    glow.anchor.set(0.5);
    glow.blendMode = 'add';
    glow.tint = el.color;
    glow.width = bw * 0.9;
    glow.height = bh * 1.6;
    glow.alpha = 0.35;
    content.addChild(glow);
    let streaks = null;
    if (v.fx && v.fx.textures && typeof v.fx.textures.bandStreaks === 'function') {
      streaks = new TilingSprite({ texture: v.fx.textures.bandStreaks(), width: bw, height: bh });
      streaks.anchor.set(0.5);
      streaks.blendMode = 'add';
      streaks.tint = mix(el.color, 0xffffff, 0.4);
      streaks.alpha = 0.28;
      content.addChild(streaks);
    }
    // bottom shade for the text
    const shade = new Sprite(Texture.WHITE);
    shade.anchor.set(0.5, 1);
    shade.tint = 0x000000;
    shade.alpha = 0.55;
    shade.width = bw;
    shade.height = bh * (compact ? 0.5 : 0.42);
    shade.y = bh / 2;
    content.addChild(shade);
    // edges
    const edges = [];
    for (const y of [-bh / 2, bh / 2]) {
      const l = new Sprite(Texture.WHITE);
      l.anchor.set(0.5);
      l.width = bw;
      l.height = 4;
      l.y = y;
      l.blendMode = 'add';
      l.tint = 0xffffff;
      band.addChild(l);
      const l2 = new Sprite(Texture.WHITE);
      l2.anchor.set(0.5);
      l2.width = bw;
      l2.height = 3;
      l2.y = y + Math.sign(y) * 8;
      l2.blendMode = 'add';
      l2.tint = el.color;
      band.addChild(l2);
      edges.push(l, l2);
    }
    // text
    const text = new Container();
    band.addChild(text);
    const colorsA = [0xffffff, el.color];
    const tName = this._label(name, colorsA, Math.round(bh * (compact ? 0.24 : 0.2)));
    const tUlt = ult ? this._label(ult, [0xffffff, mix(el.color, GOLD, 0.35)], Math.round(bh * (compact ? 0.13 : 0.105))) : null;
    const tJp = jp && !compact ? this._label(jp, [mix(el.color, 0xffffff, 0.6), el.color], Math.round(bh * 0.13)) : null;
    for (const t of [tName, tUlt, tJp]) if (t) rec.texs.push(t);
    const left = -W * 0.43;
    const sName = tName ? this._spriteFor(tName, text, 0, 1) : null;
    const sUlt = tUlt ? this._spriteFor(tUlt, text, 0, 1) : null;
    const sJp = tJp ? this._spriteFor(tJp, text, 1, 0) : null;
    const fit = (s, maxW) => {
      if (!s) return;
      const w = s.texture.fx ? s.texture.fx.textWidth : s.texture.width;
      s.scale.set(Math.min(1, maxW / Math.max(1, w)));
    };
    fit(sName, W * 0.82);
    fit(sUlt, W * 0.82);
    fit(sJp, W * 0.6);
    if (sUlt) sUlt.position.set(left, bh / 2 - bh * 0.06);
    if (sName) sName.position.set(left, (sUlt ? sUlt.y - sUlt.height * 0.86 : bh / 2 - bh * 0.06));
    if (sJp) sJp.position.set(W * 0.43, -bh / 2 + bh * 0.06);
    // subtitle slot under the band
    this._sub = { rec, band, y: bh / 2 + 10, W };
    // animate
    const inMs = compact ? 140 : 170;
    const outMs = compact ? 150 : 200;
    const flash = v.pref('flashes');
    await v.anim(ms, (e, k) => {
      if (rec.disposed) return;
      const t = k * ms;
      const kin = clamp01(t / inMs);
      const ke = t > ms - outMs ? clamp01((t - (ms - outMs)) / outMs) : 0;
      band.x = W / 2 - sgn * (1 - Ease.outQuart(kin)) * W * 1.4 + sgn * Ease.inQuart(ke) * W * 1.5 + sgn * (t / 1000) * W * 0.02;
      band.scale.y = 1 - 0.6 * Ease.inQuad(ke);
      if (art) {
        art.scale.set(art._base * (1.08 - 0.08 * Ease.outCubic(k)));
        art.x = -sgn * W * 0.03 * k;
      }
      if (streaks) streaks.tilePosition.x += 18 * sgn;
      for (const l of edges) l.alpha = 0.8 + 0.2 * Math.sin(t * 0.04);
      glow.alpha = 0.3 + (flash ? 0.5 * Math.max(0, 1 - t / 200) : 0);
      const tk = clamp01((t - inMs * 0.6) / 220);
      text.alpha = tk * (1 - ke);
      text.x = -sgn * (1 - Ease.outCubic(tk)) * W * 0.12;
      if (this._sub && this._sub.sprite) this._sub.sprite.alpha = (1 - ke) * clamp01((t - inMs) / 200);
    }, { realtime: true });
  }

  async _fullscreen(rec, splash, heroId, el, { name, ult, jp, ms, scr }) {
    const v = this.view;
    const W = scr.width;
    const H = scr.height;
    const root = rec.root;
    const back = new Sprite(Texture.WHITE);
    back.tint = 0x000000;
    back.width = W;
    back.height = H;
    root.addChild(back);
    let art = null;
    const f = this._focal(heroId);
    if (splash && splash.tex && splash.tex !== Texture.WHITE) {
      art = new Sprite(splash.tex);
      art.anchor.set(f.x, Math.min(0.6, f.y + 0.2));
      const s = Math.max(W / splash.w, H / splash.h);
      art._base = s;
      art.scale.set(s);
      art.position.set(W / 2, H * 0.42);
      // keep the cover inside the screen
      art._fit = () => {
        const w = splash.w * art.scale.x;
        const h = splash.h * art.scale.y;
        const minX = W - (1 - art.anchor.x) * w;
        const maxX = art.anchor.x * w;
        const minY = H - (1 - art.anchor.y) * h;
        const maxY = art.anchor.y * h;
        art.x = Math.max(minX, Math.min(maxX, art.x));
        art.y = Math.max(minY, Math.min(maxY, art.y));
      };
      art._fit();
      root.addChild(art);
    }
    // iridescent glint sweep + sparkles
    const glint = new Sprite(v.icons.frame('beam'));
    glint.anchor.set(0.5);
    glint.blendMode = 'add';
    glint.rotation = 0.55;
    glint.width = W * 0.5;
    glint.height = H * 1.9;
    root.addChild(glint);
    const halo = new Sprite(v.icons.frame('glowRing'));
    halo.anchor.set(0.5);
    halo.blendMode = 'add';
    halo.position.set(W / 2, H * 0.32);
    root.addChild(halo);
    const stars = [];
    for (let i = 0; i < 14; i++) {
      const s = new Sprite(v.icons.frame('spark'));
      s.anchor.set(0.5);
      s.blendMode = 'add';
      s.position.set(Math.random() * W, Math.random() * H * 0.8);
      s._ph = Math.random() * 6;
      s._sz = 8 + Math.random() * 16;
      root.addChild(s);
      stars.push(s);
    }
    // letterbox + text
    const barH = Math.round(H * 0.11);
    const top = new Sprite(Texture.WHITE);
    top.tint = 0x000000;
    top.width = W;
    top.height = barH;
    root.addChild(top);
    const bot = new Sprite(Texture.WHITE);
    bot.tint = 0x000000;
    bot.width = W;
    bot.height = barH * 2.1;
    root.addChild(bot);
    const textBox = new Container();
    root.addChild(textBox);
    const rainbow = [0xff4fd8, 0x6af0ff];
    const tName = this._label(name, [0xffffff, 0xffd23f], Math.round(Math.min(W * 0.16, barH * 0.75)));
    const tUlt = ult ? this._label(ult, [0xffffff, 0xff4fd8], Math.round(Math.min(W * 0.075, barH * 0.38))) : null;
    const tJp = jp ? this._label(jp, rainbow, Math.round(Math.min(W * 0.1, barH * 0.5))) : null;
    for (const t of [tName, tUlt, tJp]) if (t) rec.texs.push(t);
    const sName = tName ? this._spriteFor(tName, textBox, 0.5, 0.5) : null;
    const sUlt = tUlt ? this._spriteFor(tUlt, textBox, 0.5, 0.5) : null;
    const sJp = tJp ? this._spriteFor(tJp, textBox, 0.5, 0.5) : null;
    const fit = (s, maxW) => {
      if (!s) return;
      const w = s.texture.fx ? s.texture.fx.textWidth : s.texture.width;
      s.scale.set(Math.min(1, maxW / Math.max(1, w)));
    };
    fit(sName, W * 0.9);
    fit(sUlt, W * 0.9);
    fit(sJp, W * 0.8);
    if (sJp) sJp.position.set(W / 2, barH * 0.55);
    if (sName) sName.position.set(W / 2, H - barH * 1.45);
    if (sUlt) sUlt.position.set(W / 2, H - barH * 0.62);
    this._sub = { rec, band: root, y: H - barH * 2.1 - 16, W, screen: true };
    const flash = v.pref('flashes');
    const inMs = 220;
    const outMs = 230;
    await v.anim(ms, (e, k) => {
      if (rec.disposed) return;
      const t = k * ms;
      const kin = clamp01(t / inMs);
      const ke = t > ms - outMs ? clamp01((t - (ms - outMs)) / outMs) : 0;
      root.alpha = Ease.outCubic(kin) * (1 - ke);
      if (art) {
        art.scale.set(art._base * (1.12 - 0.1 * Ease.outCubic(k)));
        art.x = W / 2 + (1 - k) * W * 0.06;
        art._fit();
      }
      back.alpha = 0.92;
      const gk = clamp01((t - 120) / (ms * 0.6));
      glint.x = -W * 0.4 + gk * W * 1.8;
      glint.y = H * 0.4;
      glint.tint = iridescent(t / 260);
      glint.alpha = gk > 0 && gk < 1 ? 0.55 : 0;
      halo.tint = iridescent(t / 300 + 1);
      halo.width = halo.height = W * (0.7 + 0.25 * Ease.outCubic(k));
      halo.alpha = 0.25 + (flash ? 0.45 * Math.max(0, 1 - t / 260) : 0);
      for (const s of stars) {
        const a = Math.max(0, Math.sin(t * 0.008 + s._ph));
        s.alpha = a * 0.9;
        s.tint = iridescent(s._ph + t / 400);
        s.scale.set((s._sz * (0.6 + 0.4 * a)) / 24);
      }
      const tk = clamp01((t - 160) / 260);
      textBox.alpha = tk;
      if (sName) sName.scale.y = sName.scale.x * (0.6 + 0.4 * Ease.outBack(tk));
      top.y = -barH * (1 - Ease.outCubic(kin));
      bot.y = H - bot.height * Ease.outCubic(kin);
    }, { realtime: true });
  }

  /** Voice subtitle (RU / EN) under the running cut-in. */
  subtitle(text) {
    const s = this._sub;
    if (!s || !text || s.rec.disposed) return;
    const tex = this.view.labelTexture(text, [0xffffff, 0xd8d0ff], Math.round(Math.max(13, Math.min(18, s.W * 0.042))), { font: '"Oswald"', weight: 500 });
    if (!tex) return;
    s.rec.texs.push(tex);
    const sp = new Sprite(tex);
    sp.anchor.set(0.5, 0);
    const w = tex.fx ? tex.fx.textWidth : tex.width;
    sp.scale.set(Math.min(1, (s.W * 0.92) / Math.max(1, w)));
    if (s.screen) sp.position.set(s.W / 2, s.y);
    else {
      sp.position.set(0, s.y);
      sp.rotation = 0;
    }
    sp.alpha = 0;
    (s.screen ? s.rec.root : s.band).addChild(sp);
    s.sprite = sp;
  }

  // ------------------------------------------------------------------ name plates
  /** A small plate with a skill / Ultimate name over the top of the board (fire-and-forget). */
  namePlate(text, el, { jp = null, hold = 1000 } = {}) {
    const v = this.view;
    if (!text || !v.layout || v.skipping) return Promise.resolve(false);
    const E = el && el.color != null ? el : elementFx(el);
    const L = v.layout;
    const size = Math.round(Math.max(13, Math.min(22, L.sq * 0.4)));
    const tex = v.labelTexture(text, [0xffffff, E.color], size);
    // the plate is a quick read: Russian / English only (the JP name lives in the cut-in band)
    const jtex = null;
    void jp;
    if (!tex) return Promise.resolve(false);
    const root = new Container();
    const tw = (tex.fx ? tex.fx.textWidth : tex.width) + (jtex ? (jtex.fx ? jtex.fx.textWidth : jtex.width) + size * 0.6 : 0);
    const bg = new Sprite(Texture.WHITE);
    bg.anchor.set(0.5);
    bg.tint = 0x05030c;
    bg.alpha = 0.72;
    bg.width = tw + size * 1.6;
    bg.height = size * 1.7;
    root.addChild(bg);
    const line = new Sprite(Texture.WHITE);
    line.anchor.set(0.5);
    line.tint = E.color;
    line.width = bg.width;
    line.height = 2;
    line.y = bg.height / 2;
    root.addChild(line);
    const s = new Sprite(tex);
    s.anchor.set(0, 0.5);
    s.x = -tw / 2;
    root.addChild(s);
    if (jtex) {
      const j = new Sprite(jtex);
      j.anchor.set(1, 0.5);
      j.x = tw / 2;
      root.addChild(j);
    }
    const scr = v.renderer.screen;
    const p = typeof v.renderer.worldToScreen === 'function' ? v.renderer.worldToScreen(L.cx, L.y) : { x: L.cx, y: L.y };
    root.position.set(Math.max(bg.width / 2 + 4, Math.min(scr.width - bg.width / 2 - 4, p.x)), Math.max(bg.height, p.y + L.sq * 0.55));
    v.layers.screenRoot.addChild(root);
    const rec = { root, texs: [tex, jtex].filter(Boolean) };
    this.plates.add(rec);
    const dur = 180 + hold + 260;
    rec.anim = v.anim(dur, (e, k) => {
      if (rec.disposed) return;
      const t = k * dur;
      const kin = clamp01(t / 180);
      root.alpha = t < dur - 260 ? kin : clamp01((dur - t) / 260);
      root.scale.set(0.9 + 0.1 * Ease.outBack(kin));
    }, { realtime: true });
    return rec.anim.then(() => this._disposePlate(rec));
  }

  _disposePlate(rec) {
    if (!rec || rec.disposed) return;
    rec.disposed = true;
    if (rec.anim && typeof rec.anim.cancel === 'function') rec.anim.cancel();
    this.plates.delete(rec);
    for (const t of rec.texs) this.view.releaseText(t);
    rec.root.destroy({ children: true });
  }
}
