// Backdrops in layers.background (screen space).
//   ClassicBackdrop — dark walnut table in a dim warm room: out-of-focus planks, a warm lamp-light
//                     pool under the board, heavy vignette, film grain. Baked into ONE texture
//                     (re-baked only on resize / board move) → a single full-screen quad per frame.
//   EpicBackdrop    — storm/void: #05030C→#120A2A gradient, purple glow behind the board, drifting
//                     nebula clouds, distant lightning lighting the clouds, rising embers, vignette.
//                     The whole nebula stack is rendered into a low-resolution RenderTexture each
//                     frame (it is soft anyway), so the screen pays one full-screen quad + a few
//                     dozen tiny ember sprites instead of ~10 full-screen additive layers.
// Both get a slight parallax from the camera (shake / focus) for depth.

import { Container, Sprite, Graphics, RenderTexture } from 'pixi.js';
import { drawTexture, makeCanvas, textureFromCanvas, glowTexture, destroyTexture, addGrain } from './canvas.js';
import { woodTile } from './board-textures.js';
import { Noise2D, mulberry32 } from './noise.js';
import { EPIC } from './palette.js';

const QUALITY = {
  high: { clouds: 6, embers: 46, bolts: true, rtRes: 0.5 },
  medium: { clouds: 4, embers: 26, bolts: true, rtRes: 0.4 },
  low: { clouds: 3, embers: 10, bolts: false, rtRes: 0.33 },
};

// ------------------------------------------------------------------------------- shared textures
let vignetteTex = null;
function vignetteTexture() {
  if (vignetteTex && !vignetteTex.destroyed) return vignetteTex;
  vignetteTex = drawTexture(256, 256, 1, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.25)');
    g.addColorStop(0.8, 'rgba(0,0,0,0.62)');
    g.addColorStop(1, 'rgba(0,0,0,0.92)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, { label: 'vignette' });
  return vignetteTex;
}

const cloudTex = [];
function cloudTextures() {
  if (cloudTex.length && !cloudTex[0].destroyed) return cloudTex;
  cloudTex.length = 0;
  for (let v = 0; v < 3; v++) {
    const S = 256;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(S, S);
    const d = img.data;
    const nz = new Noise2D(300 + v * 17);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const nx = x / S - 0.5;
        const ny = y / S - 0.5;
        const r = Math.sqrt(nx * nx + ny * ny) * 2;
        const fall = Math.max(0, 1 - r);
        // domain-warped fbm → billowy body, ridged → bright filaments
        const wx = nz.fbm(nx * 2 + 9, ny * 2, 3) * 0.6;
        const wy = nz.fbm(nx * 2, ny * 2 + 4, 3) * 0.6;
        const f = nz.fbm(nx * 3 + wx + v * 2, ny * 3 + wy, 5);
        const ridg = nz.ridged(nx * 3.2 + wx * 2 + 4, ny * 3.2 + wy * 2, 4);
        const body = Math.max(0, 0.5 + 0.5 * f - 0.38) * 1.9;
        const fil = Math.pow(ridg, 3) * 1.1;
        const a = Math.min(1, (body * 0.75 + fil * 0.65) * Math.pow(fall, 1.3));
        const i = (y * S + x) * 4;
        const b = Math.min(1, 0.55 + fil * 0.6);
        d[i] = 255 * b;
        d[i + 1] = 255 * b;
        d[i + 2] = 255 * b;
        d[i + 3] = Math.min(255, a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    cloudTex.push(textureFromCanvas(c, 1, { label: 'nebula' }));
  }
  return cloudTex;
}

// ------------------------------------------------------------------------------- classic
export class ClassicBackdrop {
  constructor(renderer) {
    this.r = renderer;
    this.container = new Container();
    this.container.label = 'backdrop-classic';
    this.sprite = new Sprite();
    this.container.addChild(this.sprite);
    this._tex = null;
    this._w = 0;
    this._h = 0;
    this._board = null;
    this._key = '';
  }

  resize(w, h) {
    this._w = w;
    this._h = h;
    this._bake();
  }

  setBoard(rect) {
    this._board = rect;
    this._bake();
  }

  _bake() {
    const w = this._w;
    const h = this._h;
    if (!w || !h) return;
    const b = this._board || { x: w * 0.05, y: h * 0.25, width: w * 0.9, height: w * 0.9 };
    const key = [w, h, Math.round(b.x), Math.round(b.y), Math.round(b.width)].join('|');
    if (key === this._key) return;
    this._key = key;
    // ~1 px per CSS px (+8 % margin for the parallax): dark, blurred and grainy → no full DPR needed
    const m = 0.04;
    const W = Math.ceil(w * (1 + 2 * m));
    const H = Math.ceil(h * (1 + 2 * m));
    const ox = w * m;
    const oy = h * m;
    const c = makeCanvas(W, H);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#140b06';
    ctx.fillRect(0, 0, W, H);
    // out-of-focus table planks (grain horizontal)
    const tile = woodTile('frame');
    const plank = Math.max(90, Math.min(W, H) * 0.3);
    const rnd = mulberry32(5);
    ctx.globalAlpha = 0.55;
    try {
      ctx.filter = `blur(${Math.max(1.5, Math.min(W, H) * 0.006)}px)`;
    } catch (e) {
      /* no canvas filters on old WebViews: sharp planks are fine */
    }
    for (let y = -plank * 0.3; y < H; y += plank) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, y, W, plank);
      ctx.clip();
      ctx.translate(W / 2, y + plank / 2);
      ctx.rotate(Math.PI / 2);
      const sz = 200 + rnd() * 120;
      ctx.drawImage(tile, rnd() * (512 - sz), rnd() * (512 - sz), sz, sz, -plank / 2 - 2, -W / 2 - 2, plank + 4, W + 4);
      ctx.restore();
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, y - 1, W, 2);
    }
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(14,7,3,0.62)';
    ctx.fillRect(0, 0, W, H);
    // warm lamp pool centred slightly above the board centre
    const cx = ox + b.x + b.width / 2;
    const cy = oy + b.y + b.height * 0.45;
    const R = Math.max(b.width, b.height) * 1.15;
    let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    g.addColorStop(0, 'rgba(255,170,90,0.30)');
    g.addColorStop(0.35, 'rgba(255,150,70,0.16)');
    g.addColorStop(0.7, 'rgba(255,130,50,0.04)');
    g.addColorStop(1, 'rgba(255,130,50,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    // vignette (elliptical, follows the screen)
    ctx.save();
    ctx.translate(W / 2, cy);
    ctx.scale(1, H / W);
    const vr = W * 0.95;
    g = ctx.createRadialGradient(0, 0, vr * 0.3, 0, 0, vr);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = g;
    ctx.fillRect(-W, -H, W * 2, H * 4);
    ctx.restore();
    addGrain(ctx, 0, 0, W, H, 6, 3);
    const old = this._tex;
    this._tex = textureFromCanvas(c, 1, { label: 'table' });
    this.sprite.texture = this._tex;
    this.sprite.width = w * (1 + 2 * m);
    this.sprite.height = h * (1 + 2 * m);
    this._ox = -ox;
    this._oy = -oy;
    this.sprite.position.set(this._ox, this._oy);
    destroyTexture(old);
  }

  setQuality() {}

  update(gdt, rdt, t, camera) {
    // gentle parallax only (the baked texture has a margin so the edges never show)
    this.container.position.set(camera.shakeX * 0.25, camera.shakeY * 0.25);
  }

  destroy() {
    destroyTexture(this._tex);
    this.container.destroy({ children: true });
  }
}

// ------------------------------------------------------------------------------- epic
export class EpicBackdrop {
  constructor(renderer, quality = 'high') {
    this.r = renderer;
    this.quality = QUALITY[quality] ? quality : 'high';
    this.container = new Container();
    this.container.label = 'backdrop-epic';
    this.rnd = mulberry32(42);

    // ---- offscreen nebula stack (rendered into this.rt)
    this.nebula = new Container();
    this._gradTex = drawTexture(4, 256, 1, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#05030C');
      g.addColorStop(0.55, '#0A0620');
      g.addColorStop(1, '#120A2A');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }, { label: 'epic-grad' });
    this.grad = new Sprite(this._gradTex);
    this.core = new Sprite(glowTexture(256, 1.1));
    this.core.anchor.set(0.5);
    this.core.tint = 0x3a1a8a;
    this.core.blendMode = 'add';
    this.core.alpha = 0.5;
    this.bolt = new Graphics();
    this.bolt.blendMode = 'add';
    this.bolt.alpha = 0;
    this.cloudLayer = new Container();
    this.flash = new Sprite(glowTexture(256, 1.3));
    this.flash.anchor.set(0.5);
    this.flash.blendMode = 'add';
    this.flash.tint = 0xb8a0ff;
    this.flash.alpha = 0;
    this.vignette = new Sprite(vignetteTexture());
    this.nebula.addChild(this.grad, this.core, this.cloudLayer, this.flash, this.vignette);

    this.rt = null;
    this.screenSprite = new Sprite();
    this.emberLayer = new Container();
    // the bolt is thin: draw it at full resolution on top of the (soft) nebula texture
    this.container.addChild(this.screenSprite, this.bolt, this.emberLayer);

    this.clouds = [];
    this.embers = [];
    this._emberTex = glowTexture(32, 2.2);
    this._w = 0;
    this._h = 0;
    this._t = 0;
    this._nextFlash = 2.5;
    this._flashT = -1;
    this._flashSeq = null;
    this._populate();
  }

  _populate() {
    const Q = QUALITY[this.quality];
    this.cloudLayer.removeChildren();
    this.emberLayer.removeChildren().forEach((c) => c.destroy());
    this.clouds = [];
    this.embers = [];
    const tex = cloudTextures();
    const colors = [0x6a2be0, 0xb0227e, 0x2a48d0, 0x7d2fe0, 0xc82a6e, 0x3b2fb8];
    for (let i = 0; i < Q.clouds; i++) {
      const s = new Sprite(tex[i % tex.length]);
      s.anchor.set(0.5);
      s.blendMode = 'add';
      const c = colors[i % colors.length];
      s.tint = c;
      this.cloudLayer.addChild(s);
      this.clouds.push({
        sprite: s,
        color: c,
        u: (i + 0.5) / Q.clouds + (this.rnd() - 0.5) * 0.2,
        v: i % 2 === 0 ? 0.06 + this.rnd() * 0.3 : 0.64 + this.rnd() * 0.32,
        scale: 0.9 + this.rnd() * 0.7,
        speed: (this.rnd() - 0.5) * 0.014,
        rot: (this.rnd() - 0.5) * 0.02,
        alpha: 0.55 + this.rnd() * 0.3,
        phase: this.rnd() * 6.28,
        litK: 0,
      });
    }
    for (let i = 0; i < Q.embers; i++) {
      const s = new Sprite(this._emberTex);
      s.anchor.set(0.5);
      s.blendMode = 'add';
      this.emberLayer.addChild(s);
      const e = { sprite: s, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1, sway: 0, phase: 0 };
      this._spawnEmber(e, true);
      this.embers.push(e);
    }
  }

  _spawnEmber(e, initial) {
    const w = this._w || 390;
    const h = this._h || 844;
    const rnd = this.rnd;
    e.x = rnd() * w;
    e.y = initial ? rnd() * h : h + 10 + rnd() * 40;
    e.vy = -(18 + rnd() * 46);
    e.vx = (rnd() - 0.5) * 10;
    e.max = 4 + rnd() * 6;
    e.life = initial ? rnd() * e.max : 0;
    e.size = 3 + rnd() * 6;
    e.sway = 6 + rnd() * 18;
    e.phase = rnd() * 6.28;
    const hot = rnd();
    e.sprite.tint = hot < 0.45 ? 0xff5a8a : hot < 0.75 ? 0xffa04a : hot < 0.9 ? 0xb48cff : 0x7fe9ff;
  }

  setQuality(q) {
    if (q === this.quality || !QUALITY[q]) return;
    this.quality = q;
    this._populate();
    this._makeRT();
  }

  _makeRT() {
    const w = this._w;
    const h = this._h;
    if (!w || !h) return;
    const res = QUALITY[this.quality].rtRes;
    if (!this.rt) {
      this.rt = RenderTexture.create({ width: w, height: h, resolution: res, dynamic: true, label: 'nebula-rt' });
      this.screenSprite.texture = this.rt;
    } else {
      this.rt.resize(w, h, res);
    }
    this.screenSprite.width = w;
    this.screenSprite.height = h;
  }

  resize(w, h) {
    this._w = w;
    this._h = h;
    this.grad.width = w;
    this.grad.height = h;
    this.vignette.width = w * 1.2;
    this.vignette.height = h * 1.14;
    this.vignette.position.set(-w * 0.1, -h * 0.07);
    this._makeRT();
  }

  setBoard(rect) {
    const s = Math.max(rect.width, rect.height);
    this.core.position.set(rect.x + rect.width / 2, rect.y + rect.height / 2);
    this.core.width = s * 2.2;
    this.core.height = s * 2.0;
  }

  _triggerFlash() {
    const w = this._w;
    const h = this._h;
    const rnd = this.rnd;
    const fx = w * (0.1 + rnd() * 0.8);
    const fy = h * (rnd() < 0.6 ? 0.05 + rnd() * 0.22 : 0.72 + rnd() * 0.22);
    this.flash.position.set(fx, fy);
    const fs = Math.max(w, h) * (0.5 + rnd() * 0.4);
    this.flash.width = fs;
    this.flash.height = fs * 0.8;
    // flicker keyframes: [time s, intensity, ...]
    this._flashSeq = [0, 0.9, 0.06, 0.15, 0.12, 1, 0.2, 0.25, 0.32, 0.7, 0.55, 0];
    this._flashT = 0;
    for (const c of this.clouds) {
      const d = Math.hypot(c.sprite.x - fx, c.sprite.y - fy) / Math.max(w, h);
      c.litK = Math.max(0, 1 - d * 1.6);
    }
    const Q = QUALITY[this.quality];
    this.bolt.clear();
    if (!Q.bolts) return;
    const len = h * (0.2 + rnd() * 0.2);
    const dir = fy < h / 2 ? 1 : -1;
    const x0 = fx + (rnd() - 0.5) * w * 0.1;
    const y0 = fy - dir * len * 0.35;
    const x1 = x0 + (rnd() - 0.5) * w * 0.35;
    const y1 = y0 + dir * len;
    const main = this._boltPath(x0, y0, x1, y1, len * 0.14, 5);
    const draw = (p, w1, a, color = 0xc9b6ff) => {
      this.bolt.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) this.bolt.lineTo(p[i], p[i + 1]);
      this.bolt.stroke({ width: w1, color, alpha: a, cap: 'round', join: 'round' });
    };
    draw(main, 10, 0.08);
    draw(main, 4.5, 0.22);
    draw(main, 2, 0.75);
    draw(main, 0.9, 1, 0xffffff);
    // forks
    const forks = 2 + Math.floor(rnd() * 2);
    for (let f = 0; f < forks; f++) {
      const i = 2 * (4 + Math.floor(rnd() * ((main.length / 2) - 10)));
      const bx = main[i];
      const by = main[i + 1];
      const ang = Math.atan2(y1 - y0, x1 - x0) + (rnd() < 0.5 ? -1 : 1) * (0.4 + rnd() * 0.5);
      const bl = len * (0.2 + rnd() * 0.25);
      const br = this._boltPath(bx, by, bx + Math.cos(ang) * bl, by + Math.sin(ang) * bl, bl * 0.18, 4);
      draw(br, 3, 0.14);
      draw(br, 1.3, 0.6);
    }
  }

  /** Midpoint-displacement polyline from (x0,y0) to (x1,y1). */
  _boltPath(x0, y0, x1, y1, disp, levels) {
    let pts = [x0, y0, x1, y1];
    let d = disp;
    for (let l = 0; l < levels; l++) {
      const next = [pts[0], pts[1]];
      for (let i = 2; i < pts.length; i += 2) {
        const ax = pts[i - 2];
        const ay = pts[i - 1];
        const bx = pts[i];
        const by = pts[i + 1];
        const len = Math.hypot(bx - ax, by - ay) || 1;
        const off = (this.rnd() - 0.5) * 2 * d;
        next.push((ax + bx) / 2 + (-(by - ay) / len) * off, (ay + by) / 2 + ((bx - ax) / len) * off);
        next.push(bx, by);
      }
      pts = next;
      d *= 0.55;
    }
    return pts;
  }

  /** Force a distant lightning strike now (FX can call this for drama). */
  lightning() {
    this._triggerFlash();
    this._nextFlash = 3 + this.rnd() * 4;
  }

  update(gdt, rdt, t, camera) {
    const dt = gdt / 1000;
    this._t += dt;
    const w = this._w;
    const h = this._h;
    if (!w || !this.rt) return;
    // parallax
    const px = camera.shakeX * 0.3 - camera.ox * 0.04;
    const py = camera.shakeY * 0.3 - camera.oy * 0.04;
    this.cloudLayer.position.set(px * 0.6, py * 0.6);
    this.bolt.position.set(px * 0.6, py * 0.6);
    this.emberLayer.position.set(px, py);
    this.core.alpha = 0.45 + 0.08 * Math.sin(this._t * 0.7);

    // lightning
    this._nextFlash -= dt;
    if (this._nextFlash <= 0) {
      this._triggerFlash();
      this._nextFlash = 4 + this.rnd() * 6;
    }
    let flashI = 0;
    if (this._flashSeq && this._flashT >= 0) {
      this._flashT += dt;
      const s = this._flashSeq;
      let found = false;
      for (let i = 0; i < s.length - 2; i += 2) {
        if (this._flashT >= s[i] && this._flashT < s[i + 2]) {
          const k = (this._flashT - s[i]) / (s[i + 2] - s[i]);
          flashI = s[i + 1] + (s[i + 3] - s[i + 1]) * k;
          found = true;
          break;
        }
      }
      if (!found) {
        this._flashSeq = null;
        this._flashT = -1;
        flashI = 0;
      }
    }
    this.flash.alpha = flashI * 0.55;
    this.bolt.alpha = flashI;

    // clouds
    const big = Math.max(w, h);
    for (const c of this.clouds) {
      const s = c.sprite;
      c.u += c.speed * dt;
      if (c.u > 1.3) c.u -= 1.6;
      if (c.u < -0.3) c.u += 1.6;
      const size = big * 0.7 * c.scale;
      s.width = size * 1.35;
      s.height = size;
      s.position.set(c.u * w, c.v * h + Math.sin(this._t * 0.05 + c.phase) * h * 0.02);
      s.rotation = c.phase + this._t * c.rot;
      const lit = c.litK * flashI;
      s.alpha = Math.min(1, c.alpha * (0.85 + 0.15 * Math.sin(this._t * 0.3 + c.phase)) + lit * 0.9);
      const tint = lit > 0.05 ? mix(c.color, 0xe4d8ff, Math.min(1, lit)) : c.color;
      if (tint !== c.tint) {
        c.tint = tint;
        s.tint = tint;
      }
    }
    const ro = this._rtOpts || (this._rtOpts = { container: this.nebula, target: this.rt, clear: true });
    ro.target = this.rt;
    this.r.app.renderer.render(ro);

    // embers
    for (const e of this.embers) {
      e.life += dt;
      if (e.life > e.max || e.y < -20) this._spawnEmber(e, false);
      e.y += e.vy * dt;
      e.x += e.vx * dt;
      const s = e.sprite;
      s.position.set(e.x + Math.sin(this._t * 1.3 + e.phase) * e.sway, e.y);
      const k = e.life / e.max;
      const fade = Math.min(1, k * 5) * Math.min(1, (1 - k) * 3);
      const flick = 0.75 + 0.25 * Math.sin(this._t * 9 + e.phase * 3);
      s.alpha = fade * flick * 0.9;
      s.width = s.height = e.size * (1 - k * 0.4);
    }
  }

  destroy() {
    destroyTexture(this._gradTex);
    if (this.rt) this.rt.destroy(true);
    this.nebula.destroy({ children: true });
    this.container.destroy({ children: true });
  }
}

function mix(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

export { EPIC };
