// BoardView — the board in layers.board: drop shadow, turn glow (epic), the baked board texture
// (frame + squares + labels) and, in the epic theme, the living decorations: breathing energy
// seams, energy sparks racing along the seams, a slowly rotating magic circle under the glass,
// animated frame runes, corner sigils and an occasional light sheen sweeping across the obsidian.

import { Container, Sprite, TilingSprite } from 'pixi.js';
import { drawTexture, destroyTexture, glowTexture, mixHex } from './canvas.js';
import {
  drawClassicBoard,
  drawEpicBoard,
  drawEpicSeamGlow,
  drawBoardShadow,
  drawEdgeGlow,
  drawMagicCircle,
  drawRuneSprite,
  drawCornerSigil,
  drawStreak,
} from './board-textures.js';
import { EPIC, CLASSIC } from './palette.js';
import { tween, Ease, lerpColor } from './tween.js';
import { mulberry32 } from './noise.js';

const QUALITY = {
  high: { sparks: 12, sheen: true, magic: true, comets: 2 },
  medium: { sparks: 7, sheen: true, magic: true, comets: 1 },
  low: { sparks: 3, sheen: false, magic: false, comets: 0 },
};

export class BoardView {
  constructor(renderer) {
    this.r = renderer;
    this.root = renderer.layers.board;
    this.quality = 'high';
    this.theme = 'classic';
    this.key = '';
    this._textures = [];
    this._turnColor = EPIC.grid;
    this._turnTween = null;
    this._turnFlare = 0;
    this._turnIntensity = 1;
    this._sheenTimer = 3.5;
    this._rnd = mulberry32(99);

    this.shadow = new Sprite();
    this.turnGlow = new Sprite();
    this.turnGlow.blendMode = 'add';
    this.base = new Sprite();
    this.fx = new Container(); // epic decorations above the base
    this.fx.label = 'board-fx';
    this.root.addChild(this.shadow, this.turnGlow, this.base, this.fx);

    this.seams = null;
    this.magicOuter = null;
    this.magicInner = null;
    this.sparks = [];
    this.runes = [];
    this.sigils = [];
    this.comets = [];
    this._pt = { x: 0, y: 0 };
    this.sheen = null;
  }

  setQuality(q) {
    if (!QUALITY[q] || q === this.quality) return;
    this.quality = q;
    this.key = ''; // force rebuild of decorations on next build
  }

  /** (Re)build for theme + layout. L = layout (see renderer). res = texture resolution. */
  build(theme, L, res) {
    const key = [theme, L.n, L.playable, L.parity, L.flipped, L.sq.toFixed(3), L.fw.toFixed(3), res.toFixed(3), this.quality, L.labels].join('|');
    if (key === this.key) {
      this._position(L);
      return;
    }
    this.key = key;
    this.theme = theme;
    this.L = L;
    this._clearDecor();
    for (const t of this._textures) destroyTexture(t);
    this._textures = [];
    const keep = (t) => (this._textures.push(t), t);
    const T = L.total;
    const epic = theme === 'epic';

    // board base texture (oversampled for camera zoom, capped)
    const bres = Math.max(1, Math.min(res * 1.25, 2600 / T, 3));
    this.base.texture = keep(
      drawTexture(T, T, bres, (ctx) => (epic ? drawEpicBoard(ctx, L) : drawClassicBoard(ctx, L)), { label: 'board' })
    );

    // drop shadow
    const m = Math.round(T * 0.09);
    this._shadowM = m;
    this.shadow.texture = keep(
      drawTexture(T + 2 * m, T + 2 * m, 0.5, (ctx, w, h, k) => drawBoardShadow(ctx, T, m, { alpha: epic ? 0.9 : 0.8, radius: L.fw * 0.4, k }), {
        label: 'board-shadow',
      })
    );
    this.shadow.alpha = epic ? 0.95 : 0.85;

    // turn glow (epic)
    if (epic) {
      const gm = Math.max(14, L.fw * 1.3);
      this._glowM = gm;
      const ch = Math.max(4, L.fw * 0.55);
      this.turnGlow.texture = keep(
        drawTexture(T + 2 * gm, T + 2 * gm, Math.min(res, 1.5), (ctx) => drawEdgeGlow(ctx, T, gm, ch), { label: 'turn-glow' })
      );
      this.turnGlow.visible = true;
      if (this._appliedTurn !== this._turnColor) {
      this._appliedTurn = this._turnColor;
      this.turnGlow.tint = this._turnColor;
    }
      this._buildEpicDecor(L, res, keep);
    } else {
      this.turnGlow.visible = false;
    }
    this._position(L);
  }

  _buildEpicDecor(L, res, keep) {
    const Q = QUALITY[this.quality];
    const T = L.total;
    const bw = L.n * L.sq;
    const fx = this.fx;

    // magic circle under the glass (two counter-rotating parts)
    if (Q.magic) {
      const size = bw * 0.94;
      const mres = Math.min(res, 1.5);
      const outer = keep(drawTexture(size, size, mres, (ctx) => drawMagicCircle(ctx, size, 'outer'), { label: 'magic-outer' }));
      const inner = keep(drawTexture(size, size, mres, (ctx) => drawMagicCircle(ctx, size, 'inner'), { label: 'magic-inner' }));
      this.magicOuter = new Sprite(outer);
      this.magicInner = new Sprite(inner);
      for (const s of [this.magicOuter, this.magicInner]) {
        s.anchor.set(0.5);
        s.blendMode = 'add';
        s.tint = EPIC.grid;
        fx.addChild(s);
      }
    }

    // seam glow
    this.seams = new Sprite(keep(drawTexture(T, T, Math.min(res, 2), (ctx) => drawEpicSeamGlow(ctx, L), { label: 'seam-glow' })));
    this.seams.blendMode = 'add';
    fx.addChild(this.seams);

    // sheen sweep: a TilingSprite clipped to the playing field by its own rect (no stencil mask);
    // the tile holds one diagonal band on x + y = const, so moving tilePosition sweeps it diagonally
    if (Q.sheen) {
      const TS = 128;
      const tex = keep(
        drawTexture(TS, TS, 1, (ctx, w) => {
          const img = ctx.getImageData(0, 0, w, w);
          const d = img.data;
          for (let y = 0; y < w; y++) {
            for (let x = 0; x < w; x++) {
              const u = ((x + y) % w) / w; // 0..1 along the diagonal
              const dist = Math.abs(u - 0.5) * 2; // 0 at the band centre
              const a = Math.pow(Math.max(0, 1 - dist * 6), 2) * 0.85 + Math.pow(Math.max(0, 1 - dist * 2.2), 3) * 0.25;
              const i = (y * w + x) * 4;
              d[i] = d[i + 1] = d[i + 2] = 255;
              d[i + 3] = Math.min(255, a * 255);
            }
          }
          ctx.putImageData(img, 0, 0);
        }, { label: 'sheen' })
      );
      this.sheen = new TilingSprite({ texture: tex, width: bw, height: bw });
      this.sheen.blendMode = 'add';
      this.sheen.tint = 0xc8baff;
      this.sheen.alpha = 0;
      this.sheen.visible = false;
      this._sheenTS = TS;
      fx.addChild(this.sheen);
    }

    // energy sparks along the seams
    const streakTex = keep(drawTexture(64, 12, 2, (ctx, w, h) => drawStreak(ctx, w, h), { label: 'spark-streak' }));
    this._streakTex = streakTex;
    const n = Q.sparks;
    for (let i = 0; i < n; i++) {
      const s = new Sprite(streakTex);
      s.anchor.set(0.5);
      s.blendMode = 'add';
      s.tint = i % 3 === 0 ? 0xffffff : EPIC.gridHot;
      fx.addChild(s);
      const sp = { sprite: s, x: 0, y: 0, tx: 0, ty: 0, dx: 1, dy: 0, speed: 2, life: 0, max: 1 };
      this._respawnSpark(sp, L, true);
      this.sparks.push(sp);
    }

    // frame runes + corner sigils
    const fw = L.fw;
    const rs = Math.max(6, fw * 0.62);
    const runeTex = [];
    for (let i = 0; i < 10; i++) {
      runeTex.push(keep(drawTexture(rs, rs, Math.min(res * 1.25, 3), (ctx, w) => drawRuneSprite(ctx, w, 100 + i * 13), { label: 'rune' })));
    }
    const positions = [];
    const bands = L.labels ? ['top', 'right'] : ['top', 'right', 'bottom', 'left'];
    const mid = fw * 0.5;
    for (const band of bands) {
      for (let i = 0; i < L.n; i++) {
        const p = fw + (i + 0.5) * L.sq;
        let x, y, u;
        if (band === 'top') { x = p; y = mid; u = (p / T) * 0.25; }
        else if (band === 'right') { x = T - mid; y = p; u = 0.25 + (p / T) * 0.25; }
        else if (band === 'bottom') { x = T - p; y = T - mid; u = 0.5 + (p / T) * 0.25; }
        else { x = mid; y = T - p; u = 0.75 + (p / T) * 0.25; }
        positions.push([x, y, u]);
      }
    }
    positions.forEach(([x, y, u], i) => {
      const s = new Sprite(runeTex[i % runeTex.length]);
      s.anchor.set(0.5);
      s.blendMode = 'add';
      s.tint = EPIC.grid;
      fx.addChild(s);
      this.runes.push({ sprite: s, lx: x, ly: y, u, flick: this._rnd() * 10 });
    });
    const ss = Math.max(10, fw * 1.05);
    const sigTex = keep(drawTexture(ss, ss, Math.min(res * 1.25, 3), (ctx, w) => drawCornerSigil(ctx, w), { label: 'sigil' }));
    const cpos = [[fw * 0.5, fw * 0.5, 0], [T - fw * 0.5, fw * 0.5, 0.25], [T - fw * 0.5, T - fw * 0.5, 0.5], [fw * 0.5, T - fw * 0.5, 0.75]];
    for (const [x, y, u] of cpos) {
      const s = new Sprite(sigTex);
      s.anchor.set(0.5);
      s.blendMode = 'add';
      s.tint = EPIC.gridHot;
      fx.addChild(s);
      this.sigils.push({ sprite: s, lx: x, ly: y, u });
    }

    // energy comets racing around the inner neon border (tinted with the turn colour)
    const off = Math.max(1, fw * 0.07) * 1.5;
    this._perim = { x: fw - off, y: fw - off, size: bw + 2 * off };
    const per = this._perim.size * 4;
    const ctex = glowTexture(32, 2.0);
    for (let c = 0; c < Q.comets; c++) {
      const sprites = [];
      for (let i = 0; i < 12; i++) {
        const sp = new Sprite(ctex);
        sp.anchor.set(0.5);
        sp.blendMode = 'add';
        fx.addChild(sp);
        sprites.push(sp);
      }
      this.comets.push({ sprites, pos: (c * per) / Math.max(1, Q.comets), speed: per / (6 + c * 1.3) });
    }
  }

  /** Point at distance p along the inner border (local coords) → this._pt (no allocation). */
  _perimPoint(p) {
    const P = this._perim;
    const S = P.size;
    const side = Math.floor(p / S) % 4;
    const t = p - Math.floor(p / S) * S;
    const pt = this._pt;
    if (side === 0) { pt.x = P.x + t; pt.y = P.y; }
    else if (side === 1) { pt.x = P.x + S; pt.y = P.y + t; }
    else if (side === 2) { pt.x = P.x + S - t; pt.y = P.y + S; }
    else { pt.x = P.x; pt.y = P.y + S - t; }
    return pt;
  }

  _respawnSpark(sp, L, initial) {
    const n = L.n;
    const rnd = this._rnd;
    // start at a random intersection, random direction
    const i = 1 + Math.floor(rnd() * (n - 1));
    const j = 1 + Math.floor(rnd() * (n - 1));
    sp.x = i;
    sp.y = j;
    const d = Math.floor(rnd() * 4);
    sp.dx = d === 0 ? 1 : d === 1 ? -1 : 0;
    sp.dy = d === 2 ? 1 : d === 3 ? -1 : 0;
    sp.tx = i + sp.dx;
    sp.ty = j + sp.dy;
    sp.speed = 1.6 + rnd() * 2.2; // squares / s
    sp.max = 1.4 + rnd() * 2.2;
    sp.life = initial ? -rnd() * 3 : -rnd() * 1.5; // negative = waiting
    sp.sprite.alpha = 0;
  }

  _clearDecor() {
    this.fx.removeChildren().forEach((c) => c.destroy());
    this.seams = null;
    this.magicOuter = this.magicInner = null;
    this.sparks = [];
    this.runes = [];
    this.sigils = [];
    this.comets = [];
    this.sheen = null;
  }

  _position(L) {
    this.L = L;
    this.base.position.set(L.x, L.y);
    const m = this._shadowM || 0;
    this.shadow.position.set(L.x - m, L.y - m + L.total * 0.025);
    if (this._glowM != null) this.turnGlow.position.set(L.x - this._glowM, L.y - this._glowM);
    if (this.seams) this.seams.position.set(L.x, L.y);
    const cx = L.x + L.total / 2;
    const cy = L.y + L.total / 2;
    if (this.magicOuter) {
      this.magicOuter.position.set(cx, cy);
      this.magicInner.position.set(cx, cy);
    }
    if (this.sheen) {
      const bw = L.n * L.sq;
      this.sheen.position.set(L.x + L.fw, L.y + L.fw);
      this.sheen.width = bw;
      this.sheen.height = bw;
      const k = bw / this._sheenTS;
      this.sheen.tileScale.set(k, k);
    }
    for (const r of this.runes) r.sprite.position.set(L.x + r.lx, L.y + r.ly);
    for (const s of this.sigils) s.sprite.position.set(L.x + s.lx, L.y + s.ly);
  }

  /**
   * Edge glow colour (epic). color: side (1 / -1), a hex colour, or null to switch it off.
   */
  setTurnGlow(color, { intensity = 1, flare = true } = {}) {
    let c = color;
    if (color === 1 || color === -1) c = EPIC.side[color];
    this._turnIntensity = c == null ? 0 : intensity;
    if (c == null) return;
    if (this._turnTween) this._turnTween.cancel();
    const from = this._turnColor;
    this._turnTween = tween({ k: 0 }, { k: 1 }, {
      duration: 450,
      ease: Ease.inOutQuad,
      clock: this.r.clock,
      realtime: true,
      onUpdate: (e) => {
        this._turnColor = lerpColor(from, c, e);
      },
    });
    if (flare) this._turnFlare = 1;
  }

  /** @internal per frame. t = game seconds, rt = real seconds. */
  update(gdt, rdt, t, rt) {
    if (this.theme !== 'epic' || !this.L) return;
    const L = this.L;
    const dt = gdt / 1000;
    // turn glow: breathing + flare on turn change
    this._turnFlare = Math.max(0, this._turnFlare - (rdt / 1000) * 1.4);
    const breathe = 0.5 + 0.5 * Math.sin(rt * 1.9);
    if (this._appliedTurn !== this._turnColor) {
      this._appliedTurn = this._turnColor;
      this.turnGlow.tint = this._turnColor;
    }
    this.turnGlow.alpha = this._turnIntensity * (0.5 + 0.22 * breathe + 0.5 * this._turnFlare);

    if (this.seams) this.seams.alpha = 0.55 + 0.25 * Math.sin(t * 1.3) + 0.12 * Math.sin(t * 3.7);
    if (this.magicOuter) {
      this.magicOuter.rotation = t * 0.035;
      this.magicInner.rotation = -t * 0.06;
      this.magicOuter.alpha = 0.13 + 0.04 * Math.sin(t * 0.8);
      this.magicInner.alpha = 0.1 + 0.04 * Math.sin(t * 0.8 + 1.5);
    }

    // sparks
    const ox = L.x + L.fw;
    const oy = L.y + L.fw;
    const sq = L.sq;
    const n = L.n;
    for (const sp of this.sparks) {
      sp.life += dt;
      if (sp.life < 0) {
        sp.sprite.alpha = 0;
        continue;
      }
      if (sp.life > sp.max) {
        this._respawnSpark(sp, L, false);
        continue;
      }
      let adv = sp.speed * dt;
      let guard = 4;
      while (adv > 0 && guard-- > 0) {
        const dist = Math.abs(sp.tx - sp.x) + Math.abs(sp.ty - sp.y);
        if (adv < dist) {
          sp.x += sp.dx * adv;
          sp.y += sp.dy * adv;
          break;
        }
        sp.x = sp.tx;
        sp.y = sp.ty;
        adv -= dist;
        if (sp.x <= 0 || sp.x >= n || sp.y <= 0 || sp.y >= n) {
          sp.life = Math.max(sp.life, sp.max - 0.3); // reached the border: fade out
        } else if (this._rnd() < 0.38) {
          const left = this._rnd() < 0.5 ? 1 : -1;
          const ndx = -sp.dy * left;
          const ndy = sp.dx * left;
          sp.dx = ndx;
          sp.dy = ndy;
        }
        sp.tx = sp.x + sp.dx;
        sp.ty = sp.y + sp.dy;
      }
      const s = sp.sprite;
      s.position.set(ox + sp.x * sq, oy + sp.y * sq);
      s.rotation = sp.dx ? 0 : Math.PI / 2;
      const fadeIn = Math.min(1, sp.life / 0.25);
      const fadeOut = Math.min(1, (sp.max - sp.life) / 0.35);
      s.alpha = Math.min(fadeIn, fadeOut) * 0.95;
      s.width = sq * 0.95;
      s.height = Math.max(3, sq * 0.16);
    }

    // comets
    if (this.comets.length) {
      const per = this._perim.size * 4;
      const fw = L.fw;
      const trailTint = mixHex(this._turnColor, 0xffffff, 0.15);
      for (const c of this.comets) {
        c.pos = (c.pos + c.speed * (rdt / 1000)) % per;
        const n = c.sprites.length;
        const gap = Math.max(2.5, fw * 0.4);
        for (let i = 0; i < n; i++) {
          const sp = c.sprites[i];
          const pt = this._perimPoint((c.pos - i * gap + per) % per);
          sp.position.set(L.x + pt.x, L.y + pt.y);
          const k = i / n;
          sp.alpha = Math.pow(1 - k, 1.6) * (i === 0 ? 1 : 0.85);
          const size = fw * (i === 0 ? 1.25 : 0.85 * (1 - k * 0.6));
          sp.width = sp.height = size;
          const tint = i === 0 ? 0xffffff : trailTint;
          if (sp.tint !== tint) sp.tint = tint;
        }
      }
    }

    // runes: a scan wave runs around the frame + individual flicker
    const wave = (rt * 0.11) % 1;
    for (const r of this.runes) {
      let d = Math.abs(r.u - wave);
      if (d > 0.5) d = 1 - d;
      const hit = Math.exp(-(d * 14) * (d * 14));
      const flick = 0.5 + 0.5 * Math.sin(rt * 2.3 + r.flick * 3.1);
      r.sprite.alpha = 0.22 + 0.16 * flick + 0.75 * hit;
      const tint = hit > 0.35 ? 0xd8ceff : EPIC.grid;
      if (r.tint !== tint) {
        r.tint = tint;
        r.sprite.tint = tint;
      }
    }
    for (const s of this.sigils) {
      let d = Math.abs(s.u - wave);
      if (d > 0.5) d = 1 - d;
      const hit = Math.exp(-(d * 10) * (d * 10));
      s.sprite.rotation = rt * 0.5;
      s.sprite.alpha = 0.5 + 0.5 * hit;
      s.sprite.scale.set(1 + 0.15 * hit);
    }

    // sheen sweep every few seconds
    if (this.sheen) {
      this._sheenTimer -= dt;
      if (this._sheenTimer <= 0) {
        const k = Math.min(1, -this._sheenTimer / 1.9);
        const e = Ease.inOutSine(k);
        const span = this._sheenTS * this.sheen.tileScale.x;
        // band starts off the top-left corner and leaves at the bottom-right
        this.sheen.tilePosition.set(-span * 0.5 + e * span * 2 - span, 0);
        this.sheen.visible = true;
        this.sheen.alpha = Math.sin(Math.PI * k) * 0.16;
        if (k >= 1) {
          this._sheenTimer = 6 + this._rnd() * 5;
          this.sheen.alpha = 0;
          this.sheen.visible = false;
        }
      }
    }
  }

  destroy() {
    this._clearDecor();
    for (const t of this._textures) destroyTexture(t);
    this._textures = [];
  }
}

export { CLASSIC };
