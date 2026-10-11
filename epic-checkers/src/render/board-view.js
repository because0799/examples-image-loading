// BoardView — the board in layers.board: drop shadow, turn glow (epic), the baked board texture
// (frame + squares + labels) and, in the epic theme, the living decorations: breathing energy
// seams, energy sparks racing along the seams, a slowly rotating magic circle under the glass,
// animated frame runes, corner sigils and an occasional light sheen sweeping across the obsidian.
//
// Performance (mobile GPUs are fill-rate bound): the drop shadow and the turn glow are EdgeFrames
// (9-slice without the centre that the opaque board hides anyway), the magic circle is ONE
// additive sprite, and every per-frame animation is a plain sprite transform / alpha / tint
// change (no Graphics rebuilds, no texture uploads, no filters) so the whole board batches.

import { Container, Rectangle, Sprite, Texture, TilingSprite } from 'pixi.js';
import { EdgeFrame } from './edge-frame.js';
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
  // medium / low: no magic circle (a full-board additive layer for a 14 % alpha detail)
  medium: { sparks: 7, sheen: true, magic: false, comets: 1 },
  low: { sparks: 3, sheen: false, magic: false, comets: 0 },
};

/**
 * Disjoint rectangles [x, y, w, h] (frame-local, logical px) that cover every glowing texel of the
 * epic seam texture (drawEpicSeamGlow): the 4 border bands, one strip per vertical line between
 * them (owning the crossings) and the horizontal segments between the vertical strips. null when
 * the board is too small for strips (draw the whole texture instead).
 */
export function seamStripRects(L) {
  const { n, sq, fw } = L;
  const bw = n * sq;
  const off = Math.max(1, fw * 0.07) * 1.5; // border line offset (drawEpicSeamGlow)
  const hb = Math.max(6, fw * 0.5) / 2 + 1.5; // half band of the widest border pass + margin
  const hl = Math.max(4, sq * 0.22) / 2 + 1.5; // half band of the widest line pass + margin
  const x0 = fw - off;
  const x1 = fw + bw + off;
  const i0 = x0 + hb;
  const i1 = x1 - hb;
  const T = L.total != null ? L.total : bw + 2 * fw;
  const fits = n >= 2 && fw + sq - hl > i0 + 0.5 && sq > 2 * hl + 1 && x0 - hb >= 0 && x1 + hb <= T;
  if (!fits) return null;
  const out = [];
  const add = (x, y, w, h) => {
    if (w > 0.01 && h > 0.01) out.push([x, y, w, h]);
  };
  add(x0 - hb, x0 - hb, x1 - x0 + 2 * hb, 2 * hb);
  add(x0 - hb, x1 - hb, x1 - x0 + 2 * hb, 2 * hb);
  add(x0 - hb, i0, 2 * hb, i1 - i0);
  add(x1 - hb, i0, 2 * hb, i1 - i0);
  const xs = [];
  for (let i = 1; i < n; i++) {
    const x = fw + i * sq;
    xs.push(x);
    add(x - hl, i0, 2 * hl, i1 - i0);
  }
  for (let j = 1; j < n; j++) {
    const y = fw + j * sq - hl;
    let from = i0;
    for (const x of xs) {
      add(from, y, x - hl - from, 2 * hl);
      from = x + hl;
    }
    add(from, y, i1 - from, 2 * hl);
  }
  return out;
}

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
    this._subTextures = [];

    this.shadow = new EdgeFrame();
    this.shadow.label = 'board-shadow';
    this.turnGlow = new EdgeFrame();
    this.turnGlow.label = 'turn-glow';
    this.turnGlow.blendMode = 'add';
    /** side (1 / -1) the turn glow shows, or null when it was given a plain colour */
    this._turnSide = null;
    this.base = new Sprite();
    this.fx = new Container(); // epic decorations above the base
    this.fx.label = 'board-fx';
    this.root.addChild(this.shadow, this.turnGlow, this.base, this.fx);

    this.seams = null;
    /** the magic circle (outer ring + inner hexagram baked into ONE additive sprite) */
    this.magic = null;
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

    // board base texture (labels / grain): oversampled a little for the camera's zoom-ins, at most
    // a 2048 px texture; 'low' skips the oversampling
    const over = this.quality === 'low' ? 1 : 1.15;
    const bres = Math.max(1, Math.min(res * over, 2048 / T, 3));
    this.base.texture = keep(
      drawTexture(T, T, bres, (ctx) => (epic ? drawEpicBoard(ctx, L) : drawClassicBoard(ctx, L)), { label: 'board' })
    );

    // drop shadow: a small blurred rounded rect sliced into an EdgeFrame (its middle is under the board)
    const m = Math.round(T * 0.09);
    this._shadowM = m;
    const sRad = L.fw * 0.4;
    const ch = Math.max(4, L.fw * 0.55);
    // corner slice: past the rounded corner + 3σ of the blur (σ ≈ 0.225·m), so the stretched middle
    // slice is exactly uniform; and deep enough that the hole stays under the (lower) board
    const sc = Math.ceil(m + Math.max(sRad + m * 0.75 + 2, T * 0.03 + 2, ch + 2));
    const sS = 2 * sc + 4;
    this.shadow.setTexture(
      keep(
        drawTexture(sS, sS, 0.75, (ctx, w, h, k) => drawBoardShadow(ctx, sS - 2 * m, m, { alpha: epic ? 0.9 : 0.8, radius: sRad, k }), {
          label: 'board-shadow',
        })
      ),
      sc,
      // edges only reach under the board: the shadow sits 0.025·T lower than the board
      Math.ceil(m + T * 0.025 + 3)
    );
    this.shadow.setSize(T + 2 * m, T + 2 * m);
    this.shadow.alpha = epic ? 0.95 : 0.85;

    // turn glow (epic): an EdgeFrame too (the inside of the ring is under the board)
    if (epic) {
      const gm = Math.max(14, L.fw * 1.3);
      this._glowM = gm;
      // corner slice: past the chamfer + the widest glow pass (half of 1.6·gm), so the stretched
      // middle slice is exactly uniform along the edge
      const gc = Math.ceil(gm + ch + gm * 0.85 + 3);
      const gS = 2 * gc + 4;
      this.turnGlow.setTexture(
        keep(drawTexture(gS, gS, Math.min(res, 1.5), (ctx) => drawEdgeGlow(ctx, gS - 2 * gm, gm, ch), { label: 'turn-glow' })),
        gc,
        Math.ceil(gm + 3)
      );
      this.turnGlow.setSize(T + 2 * gm, T + 2 * gm);
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

    // magic circle under the glass: outer ring + inner hexagram baked into ONE additive sprite
    // (was two counter-rotating full-board sprites: ~0.35 screen of blended fill each per frame)
    if (Q.magic) {
      const size = bw * 0.94;
      const mres = Math.min(res, 1.25);
      const tex = keep(
        drawTexture(size, size, mres, (ctx) => {
          ctx.save();
          drawMagicCircle(ctx, size, 'outer');
          ctx.restore();
          ctx.save();
          ctx.globalAlpha = 0.8;
          drawMagicCircle(ctx, size, 'inner');
          ctx.restore();
        }, { label: 'magic-circle' })
      );
      this.magic = new Sprite(tex);
      this.magic.anchor.set(0.5);
      this.magic.blendMode = 'add';
      this.magic.tint = EPIC.grid;
      fx.addChild(this.magic);
    }

    // seam glow (soft glow lines: 1.5× is plenty even on 3× phones), drawn as disjoint strips
    this.seams = this._seamStrips(L, keep(drawTexture(T, T, Math.min(res, 1.5), (ctx) => drawEpicSeamGlow(ctx, L), { label: 'seam-glow' })));
    fx.addChild(this.seams);

    // sheen sweep: a TilingSprite clipped to the playing field by its own rect (no stencil mask);
    // the tile holds one diagonal band on x + y = const, so moving tilePosition sweeps it diagonally
    if (Q.sheen) {
      const TS = 128;
      const tex = keep(
        drawTexture(TS, TS, 1, (ctx, w) => {
          const img = ctx.createImageData(w, w); // every texel is written: no read-back needed
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

  /**
   * The seam glow texture is mostly empty (thin lines on a T×T square). Instead of one full-board
   * additive quad, cut it into DISJOINT sub-texture strips that cover only the glowing parts: the
   * 4 border bands, one strip per vertical line (between the border bands) and the horizontal line
   * segments between the vertical strips. Same image (every texel is drawn exactly once), ~45 %
   * less blended fill, one batch. Falls back to the full sprite when the board is too small.
   */
  _seamStrips(L, tex) {
    const box = new Container();
    box.label = 'seam-glow';
    const rects = seamStripRects(L);
    if (!rects) {
      const sp = new Sprite(tex);
      sp.blendMode = 'add';
      box.addChild(sp);
      return box;
    }
    for (const [x, y, w, h] of rects) {
      // sub-textures share the seam texture's source: destroyed WITHOUT the source (_clearDecor)
      const t = new Texture({ source: tex.source, frame: new Rectangle(x, y, w, h), label: 'seam-part' });
      this._subTextures.push(t);
      const sp = new Sprite(t);
      sp.position.set(x, y);
      sp.blendMode = 'add';
      box.addChild(sp);
    }
    return box;
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
    this.fx.removeChildren().forEach((c) => c.destroy({ children: true }));
    for (const t of this._subTextures) t.destroy(false);
    this._subTextures = [];
    this.seams = null;
    this.magic = null;
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
    if (this.magic) this.magic.position.set(cx, cy);
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
   * A side uses the renderer's (possibly custom) energy colour of that side.
   */
  setTurnGlow(color, { intensity = 1, flare = true } = {}) {
    let c = color;
    this._turnSide = color === 1 || color === -1 ? color : null;
    if (this._turnSide) c = this._sideColor(color);
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

  _sideColor(side) {
    const r = this.r;
    return r && typeof r.epicSideColor === 'function' ? r.epicSideColor(side) : EPIC.side[side];
  }

  /** The side colours changed: re-tint the turn glow if it shows a side. */
  refreshSideColors() {
    if (this._turnSide) this.setTurnGlow(this._turnSide, { intensity: this._turnIntensity || 1, flare: false });
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
    if (this.magic) {
      this.magic.rotation = t * 0.035;
      this.magic.alpha = 0.14 + 0.045 * Math.sin(t * 0.8);
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
