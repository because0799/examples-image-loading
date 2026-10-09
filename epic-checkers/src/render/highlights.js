// Highlights (renderer.highlights) — drawn in layers.highlights (under the pieces).
//
//   setSelectable(sqs)              subtle pulsing ring around every movable piece
//   setSelected(sq | -1)            selected square glow + the piece lifts with a gold glow
//   setTargets(sqs, { capture })    quiet targets = green dots, capture landings = red rings / reticles
//   setLastMove(path)               amber tint on the squares of the last move
//   setHint(path | null)            pulsing cyan path with flowing chevrons
//   setPath(path)                   partial multi-jump trail (gold)
//   clear()
//
// Textures are generated per theme + square size; sprites are pooled; pulses are cheap per-frame
// alpha/scale updates driven in real time (UI feedback is not slowed by slow-mo).

import { Container, Sprite, Graphics } from 'pixi.js';
import { drawTexture, rgba, destroyTexture, roundRectPath, mixHex } from './canvas.js';
import { CLASSIC, EPIC } from './palette.js';

const TAU = Math.PI * 2;

// ------------------------------------------------------------------------------- skin
class HighlightSkin {
  constructor(theme, sq, res) {
    this.theme = theme;
    this.sq = sq;
    const epic = theme === 'epic';
    const P = epic ? EPIC : CLASSIC;
    const r = Math.max(1, Math.min(res * 1.25, 3));
    const T = (this.tex = {});

    T.square = drawTexture(sq, sq, Math.min(r, 1.5), (ctx, w) => {
      const pad = w * 0.02;
      ctx.fillStyle = '#fff';
      roundRectPath(ctx, pad, pad, w - pad * 2, w - pad * 2, w * 0.06);
      ctx.fill();
    }, { label: 'hl-square' });

    // inner-glow square frame (white; tinted)
    T.frame = drawTexture(sq, sq, r, (ctx, w) => {
      const passes = epic
        ? [[w * 0.2, 0.1], [w * 0.11, 0.22], [w * 0.05, 0.55], [Math.max(1, w * 0.022), 1]]
        : [[w * 0.12, 0.12], [w * 0.06, 0.3], [Math.max(1, w * 0.03), 0.9]];
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, w);
      ctx.clip();
      for (const [lw, a] of passes) {
        ctx.strokeStyle = `rgba(255,255,255,${a})`;
        ctx.lineWidth = lw;
        roundRectPath(ctx, w * 0.035, w * 0.035, w * 0.93, w * 0.93, w * 0.08);
        ctx.stroke();
      }
      ctx.restore();
      if (epic) {
        // corner brackets
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(1, w * 0.04);
        ctx.lineCap = 'round';
        const c = w * 0.24;
        const o = w * 0.09;
        for (const [x, y, sx, sy] of [[o, o, 1, 1], [w - o, o, -1, 1], [w - o, w - o, -1, -1], [o, w - o, 1, -1]]) {
          ctx.beginPath();
          ctx.moveTo(x, y + sy * c);
          ctx.lineTo(x, y);
          ctx.lineTo(x + sx * c, y);
          ctx.stroke();
        }
      }
    }, { label: 'hl-frame' });

    // quiet-move target dot
    const ds = sq * 0.7;
    T.dot = drawTexture(ds, ds, r, (ctx, w) => {
      const c = w / 2;
      const R = sq * 0.13;
      ctx.translate(c, c);
      if (epic) {
        let g = ctx.createRadialGradient(0, 0, 0, 0, 0, c);
        g.addColorStop(0, rgba(P.moveDot, 0.8));
        g.addColorStop(0.3, rgba(P.moveDot, 0.35));
        g.addColorStop(1, rgba(P.moveDot, 0));
        ctx.fillStyle = g;
        ctx.fillRect(-c, -c, w, w);
        ctx.beginPath();
        ctx.arc(0, 0, R * 0.95, 0, TAU);
        g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.5, rgba(mixHex(P.moveDot, 0xffffff, 0.5), 1));
        g.addColorStop(1, rgba(P.moveDot, 1));
        ctx.fillStyle = g;
        ctx.fill();
        // orbit ring
        ctx.beginPath();
        ctx.arc(0, 0, R * 1.75, 0, TAU);
        ctx.strokeStyle = rgba(P.moveDot, 0.7);
        ctx.lineWidth = Math.max(0.8, sq * 0.018);
        ctx.stroke();
      } else {
        // soft shadow, emerald dot with a glossy highlight
        ctx.beginPath();
        ctx.arc(R * 0.08, R * 0.16, R * 1.1, 0, TAU);
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fill();
        const g = ctx.createRadialGradient(-R * 0.35, -R * 0.35, 0, 0, 0, R);
        g.addColorStop(0, '#B8FFDD');
        g.addColorStop(0.45, rgba(P.moveDot, 1));
        g.addColorStop(1, '#1E9E66');
        ctx.beginPath();
        ctx.arc(0, 0, R, 0, TAU);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(10,70,40,0.55)';
        ctx.lineWidth = Math.max(0.6, R * 0.12);
        ctx.stroke();
      }
    }, { label: 'hl-dot' });

    // capture landing target
    const cs = sq * 1.1;
    T.capture = drawTexture(cs, cs, r, (ctx, w) => {
      const c = w / 2;
      ctx.translate(c, c);
      const R = sq * 0.38;
      if (epic) {
        for (const [lw, a] of [[sq * 0.16, 0.12], [sq * 0.08, 0.3], [Math.max(1, sq * 0.03), 1]]) {
          ctx.strokeStyle = rgba(P.capture, a);
          ctx.lineWidth = lw;
          for (let i = 0; i < 4; i++) {
            const a0 = (i / 4) * TAU + 0.28;
            const a1 = ((i + 1) / 4) * TAU - 0.28;
            ctx.beginPath();
            ctx.arc(0, 0, R, a0, a1);
            ctx.stroke();
          }
        }
        // inward ticks
        ctx.strokeStyle = '#ffd0da';
        ctx.lineWidth = Math.max(1, sq * 0.035);
        ctx.lineCap = 'round';
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * TAU;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * R * 1.12, Math.sin(a) * R * 1.12);
          ctx.lineTo(Math.cos(a) * R * 0.78, Math.sin(a) * R * 0.78);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(0, 0, sq * 0.05, 0, TAU);
        ctx.fillStyle = rgba(P.capture, 0.9);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(0, sq * 0.012, R, 0, TAU);
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = sq * 0.085;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, R, 0, TAU);
        ctx.strokeStyle = rgba(P.capture, 0.95);
        ctx.lineWidth = sq * 0.06;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, R - sq * 0.02, -Math.PI * 0.95, -Math.PI * 0.55);
        ctx.strokeStyle = 'rgba(255,220,220,0.8)';
        ctx.lineWidth = sq * 0.018;
        ctx.stroke();
      }
    }, { label: 'hl-capture' });

    // selectable ring (white, tinted)
    const rs = sq * 1.15;
    T.ring = drawTexture(rs, rs, r, (ctx, w) => {
      const c = w / 2;
      const R = sq * 0.465;
      ctx.translate(c, c);
      const passes = epic
        ? [[sq * 0.12, 0.12], [sq * 0.06, 0.3], [Math.max(1, sq * 0.025), 1]]
        : [[sq * 0.07, 0.18], [Math.max(1, sq * 0.03), 0.95]];
      for (const [lw, a] of passes) {
        ctx.beginPath();
        ctx.arc(0, 0, R, 0, TAU);
        ctx.strokeStyle = `rgba(255,255,255,${a})`;
        ctx.lineWidth = lw;
        ctx.stroke();
      }
    }, { label: 'hl-ring' });

    // chevron (hint flow)
    const chs = sq * 0.42;
    T.chevron = drawTexture(chs, chs, r, (ctx, w) => {
      const c = w / 2;
      ctx.translate(c, c);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const [lw, a] of [[w * 0.3, 0.15], [w * 0.16, 0.4], [w * 0.08, 1]]) {
        ctx.strokeStyle = `rgba(255,255,255,${a})`;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(-w * 0.14, -w * 0.22);
        ctx.lineTo(w * 0.1, 0);
        ctx.lineTo(-w * 0.14, w * 0.22);
        ctx.stroke();
      }
    }, { label: 'hl-chevron' });

    // node (path trail)
    const ns = sq * 0.5;
    T.node = drawTexture(ns, ns, r, (ctx, w) => {
      const c = w / 2;
      const g = ctx.createRadialGradient(c, c, 0, c, c, c);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.22, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.32, 'rgba(255,255,255,0.4)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, w);
    }, { label: 'hl-node' });
  }

  destroy() {
    for (const k of Object.keys(this.tex)) destroyTexture(this.tex[k]);
    this.tex = {};
  }
}

// ------------------------------------------------------------------------------- pool helper
class SpritePool {
  constructor(parent) {
    this.parent = parent;
    this.items = [];
    this.used = 0;
  }
  begin() {
    this.used = 0;
  }
  next(texture, blend) {
    let s = this.items[this.used];
    if (!s) {
      s = new Sprite();
      s.anchor.set(0.5);
      this.items.push(s);
      this.parent.addChild(s);
    }
    this.used++;
    s.texture = texture;
    s.blendMode = blend;
    s.visible = true;
    s.alpha = 1;
    s.tint = 0xffffff;
    s.rotation = 0;
    s.scale.set(1);
    return s;
  }
  end() {
    for (let i = this.used; i < this.items.length; i++) this.items[i].visible = false;
  }
  get active() {
    return this.used;
  }
  destroy() {
    for (const s of this.items) s.destroy();
    this.items = [];
  }
}

// ------------------------------------------------------------------------------- highlights
export class Highlights {
  constructor(renderer) {
    this.r = renderer;
    this.layer = renderer.layers.highlights;
    this.gLast = new Container();
    this.gHint = new Container();
    this.gSel = new Container();
    this.gPath = new Container();
    this.gSelectable = new Container();
    this.gTargets = new Container();
    this.hintLine = new Graphics();
    this.pathLine = new Graphics();
    this.gHintSq = new Container();
    this.gHintFlow = new Container();
    this.gHint.addChild(this.gHintSq, this.hintLine, this.gHintFlow);
    this.gPathNodes = new Container();
    this.gPath.addChild(this.pathLine, this.gPathNodes);
    this.layer.addChild(this.gLast, this.gSel, this.gHint, this.gPath, this.gSelectable, this.gTargets);

    this.pLast = new SpritePool(this.gLast);
    this.pHint = new SpritePool(this.gHintSq);
    this.pHintFlow = new SpritePool(this.gHintFlow);
    this.pSel = new SpritePool(this.gSel);
    this.pPath = new SpritePool(this.gPathNodes);
    this.pSelectable = new SpritePool(this.gSelectable);
    this.pTargets = new SpritePool(this.gTargets);

    this.skin = null;
    this.state = {
      selectable: [],
      selected: -1,
      targets: [],
      capture: false,
      lastMove: null,
      hint: null,
      path: null,
    };
    this._hintPts = null;
    this._hintLen = 0;
    this._selectedPiece = null;
  }

  // -------------------------------------------------------------- public API
  setSelectable(sqs) {
    this.state.selectable = sqs ? Array.from(sqs) : [];
    this._drawSelectable();
  }

  setSelected(sq) {
    sq = sq == null ? -1 : sq;
    this.state.selected = sq;
    const piece = sq >= 0 ? this.r.pieceAt(sq) : null;
    if (this._selectedPiece && this._selectedPiece !== piece) this._selectedPiece.setSelected(false);
    this._selectedPiece = piece;
    if (piece) piece.setSelected(true);
    this._drawSelected();
  }

  setTargets(sqs, { capture = false } = {}) {
    this.state.targets = sqs ? Array.from(sqs) : [];
    this.state.capture = !!capture;
    this._drawTargets();
  }

  setLastMove(path) {
    this.state.lastMove = path && path.length ? Array.from(path) : null;
    this._drawLast();
  }

  setHint(path) {
    this.state.hint = path && path.length ? Array.from(path) : null;
    this._drawHint();
  }

  setPath(path) {
    this.state.path = path && path.length ? Array.from(path) : null;
    this._drawPath();
  }

  /** Clears everything except the last-move marker (pass true to clear it too). */
  clear(includeLastMove = false) {
    this.state.selectable = [];
    this.state.targets = [];
    this.state.hint = null;
    this.state.path = null;
    if (includeLastMove) this.state.lastMove = null;
    this.setSelected(-1);
    this._drawAll();
  }

  // -------------------------------------------------------------- internals
  /** Called by the renderer when theme / layout / variant changes. */
  rebuild(theme, sq, res) {
    if (!this.skin || this.skin.theme !== theme || Math.abs(this.skin.sq - sq) > 0.01 || this._res !== res) {
      if (this.skin) this.skin.destroy();
      this.skin = new HighlightSkin(theme, sq, res);
      this._res = res;
    }
    this.theme = theme;
    this.P = theme === 'epic' ? EPIC : CLASSIC;
    // re-acquire the selected piece (pieces may have been rebuilt)
    if (this._selectedPiece && this._selectedPiece.sq !== this.state.selected) this._selectedPiece = null;
    this._drawAll();
  }

  _drawAll() {
    if (!this.skin) return;
    this._drawLast();
    this._drawSelected();
    this._drawHint();
    this._drawPath();
    this._drawSelectable();
    this._drawTargets();
  }

  get _blend() {
    return this.theme === 'epic' ? 'add' : 'normal';
  }

  _center(sq) {
    return this.r.squareCenter(sq);
  }

  _drawLast() {
    if (!this.skin) return;
    const p = this.pLast;
    p.begin();
    const path = this.state.lastMove;
    if (path) {
      const T = this.skin.tex;
      const epic = this.theme === 'epic';
      const seen = new Set();
      path.forEach((sq, i) => {
        if (seen.has(sq)) return;
        seen.add(sq);
        const c = this._center(sq);
        const end = i === 0 || i === path.length - 1;
        const s = p.next(T.square, 'normal');
        s.position.set(c.x, c.y);
        s.tint = this.P.lastMove;
        s.alpha = (end ? this.P.lastMoveAlpha : this.P.lastMoveAlpha * 0.55) * (epic ? 0.7 : 1);
        if (epic && end) {
          const f = p.next(T.frame, 'add');
          f.position.set(c.x, c.y);
          f.tint = this.P.lastMove;
          f.alpha = i === path.length - 1 ? 0.75 : 0.45;
        }
      });
    }
    p.end();
  }

  _drawSelected() {
    if (!this.skin) return;
    const p = this.pSel;
    p.begin();
    const sq = this.state.selected;
    if (sq >= 0) {
      const T = this.skin.tex;
      const c = this._center(sq);
      const s = p.next(T.square, 'normal');
      s.position.set(c.x, c.y);
      s.tint = this.P.selected;
      s.alpha = this.theme === 'epic' ? 0.18 : 0.3;
      const f = p.next(T.frame, this._blend);
      f.position.set(c.x, c.y);
      f.tint = this.P.selected;
      f.alpha = 0.9;
    }
    p.end();
  }

  _drawTargets() {
    if (!this.skin) return;
    const p = this.pTargets;
    p.begin();
    const T = this.skin.tex;
    const cap = this.state.capture;
    for (const sq of this.state.targets) {
      const c = this._center(sq);
      const s = p.next(cap ? T.capture : T.dot, this._blend === 'add' ? 'add' : 'normal');
      s.position.set(c.x, c.y);
    }
    p.end();
  }

  _drawSelectable() {
    if (!this.skin) return;
    const p = this.pSelectable;
    p.begin();
    const T = this.skin.tex;
    for (const sq of this.state.selectable) {
      const c = this._center(sq);
      const s = p.next(T.ring, this._blend);
      s.position.set(c.x, c.y);
      if (this.theme === 'epic') {
        const piece = this.r.pieceAt(sq);
        s.tint = piece ? mixHex(EPIC.side[piece.color], 0xffffff, 0.25) : EPIC.selectable;
      } else {
        s.tint = this.P.selectable;
      }
    }
    p.end();
  }

  _polyline(path) {
    const pts = [];
    let prev = -1;
    for (const sq of path) {
      if (sq === prev) continue;
      const c = this._center(sq);
      pts.push(c.x, c.y);
      prev = sq;
    }
    return pts;
  }

  _strokeLine(g, pts, color, arrow, epic) {
    g.clear();
    if (pts.length < 4) return;
    const sq = this.r.squareSize;
    const layers = epic
      ? [[sq * 0.34, 0.1, color], [sq * 0.17, 0.25, color], [sq * 0.075, 0.85, color], [sq * 0.03, 1, 0xffffff]]
      : [[sq * 0.16, 0.25, 0x000000], [sq * 0.09, 0.85, color], [sq * 0.03, 0.7, 0xffffff]];
    // shorten the end so the arrow head sits inside the target square
    const n = pts.length;
    const ex = pts[n - 2];
    const ey = pts[n - 1];
    const dx = ex - pts[n - 4];
    const dy = ey - pts[n - 3];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const head = sq * 0.26;
    const line = pts.slice();
    if (arrow) {
      line[n - 2] = ex - ux * head * 0.9;
      line[n - 1] = ey - uy * head * 0.9;
    }
    for (const [w, a, col] of layers) {
      g.moveTo(line[0], line[1]);
      for (let i = 2; i < line.length; i += 2) g.lineTo(line[i], line[i + 1]);
      g.stroke({ width: w, color: col, alpha: a, cap: 'round', join: 'round' });
    }
    if (arrow) {
      const px = -uy;
      const py = ux;
      const tipX = ex + ux * head * 0.25;
      const tipY = ey + uy * head * 0.25;
      const bx = ex - ux * head;
      const by = ey - uy * head;
      const hw = head * 0.62;
      const tri = [tipX, tipY, bx + px * hw, by + py * hw, bx - px * hw, by - py * hw];
      if (!epic) {
        g.poly(tri.map((v, i) => v + (i % 2 ? sq * 0.015 : 0))).fill({ color: 0x000000, alpha: 0.25 });
      } else {
        g.poly(tri).stroke({ width: sq * 0.14, color, alpha: 0.25, join: 'round' });
      }
      g.poly(tri).fill({ color, alpha: epic ? 1 : 0.92 });
    }
  }

  _drawHint() {
    if (!this.skin) return;
    const p = this.pHint;
    const flow = this.pHintFlow;
    p.begin();
    flow.begin();
    const path = this.state.hint;
    const epic = this.theme === 'epic';
    const col = this.P.hint;
    if (path) {
      const T = this.skin.tex;
      const seen = new Set();
      for (const sq of path) {
        if (seen.has(sq)) continue;
        seen.add(sq);
        const c = this._center(sq);
        const s = p.next(T.square, 'normal');
        s.position.set(c.x, c.y);
        s.tint = col;
        s.alpha = epic ? 0.14 : 0.12;
        if (!epic) {
          const f = p.next(T.frame, 'normal');
          f.position.set(c.x, c.y);
          f.tint = col;
          f.alpha = 0.85;
        }
      }
      const pts = this._polyline(path);
      this.hintLine.blendMode = epic ? 'add' : 'normal';
      this._strokeLine(this.hintLine, pts, col, true, epic);
      // flow chevrons
      this._hintPts = pts;
      let L = 0;
      for (let i = 2; i < pts.length; i += 2) L += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
      this._hintLen = L;
      const count = Math.max(1, Math.floor(L / (this.r.squareSize * 0.55)));
      for (let i = 0; i < count; i++) {
        const s = flow.next(T.chevron, epic ? 'add' : 'normal');
        s.tint = epic ? 0xffffff : 0xe8fbff;
      }
    } else {
      this.hintLine.clear();
      this._hintPts = null;
    }
    p.end();
    flow.end();
  }

  _drawPath() {
    if (!this.skin) return;
    const p = this.pPath;
    p.begin();
    const path = this.state.path;
    const epic = this.theme === 'epic';
    if (path && path.length) {
      const T = this.skin.tex;
      const pts = this._polyline(path);
      this.pathLine.blendMode = epic ? 'add' : 'normal';
      if (pts.length >= 4) this._strokeLine(this.pathLine, pts, this.P.path, false, epic);
      else this.pathLine.clear();
      for (let i = 0; i < pts.length; i += 2) {
        const s = p.next(T.node, epic ? 'add' : 'normal');
        s.position.set(pts[i], pts[i + 1]);
        s.tint = i === pts.length - 2 ? 0xffffff : this.P.path;
        s.scale.set(i === 0 ? 0.8 : 1);
      }
    } else {
      this.pathLine.clear();
    }
    p.end();
  }

  /** @internal per-frame pulses (real time seconds). */
  update(rt) {
    if (!this.skin) return;
    const epic = this.theme === 'epic';
    // selectable rings
    if (this.pSelectable.active) {
      const a = 0.4 + 0.35 * (0.5 + 0.5 * Math.sin(rt * 3.6));
      const sc = 1 + 0.035 * Math.sin(rt * 3.6);
      for (let i = 0; i < this.pSelectable.active; i++) {
        const s = this.pSelectable.items[i];
        s.alpha = epic ? a + 0.15 : a;
        s.scale.set(sc);
      }
    }
    // targets
    if (this.pTargets.active) {
      const cap = this.state.capture;
      for (let i = 0; i < this.pTargets.active; i++) {
        const s = this.pTargets.items[i];
        const ph = rt * (cap ? 4.2 : 3.4) - i * 0.35;
        if (cap) {
          s.scale.set(1 + 0.06 * Math.sin(ph));
          if (epic) s.rotation = rt * 1.2;
          s.alpha = 0.85 + 0.15 * Math.sin(ph);
        } else {
          s.scale.set(1 + 0.12 * Math.sin(ph));
          s.alpha = 0.8 + 0.2 * Math.sin(ph);
        }
      }
    }
    // selected frame breathing
    if (this.pSel.active > 1) {
      this.pSel.items[1].alpha = 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(rt * 5));
    }
    // hint pulse + flowing chevrons
    if (this._hintPts && this.pHintFlow.active) {
      const pulse = 0.5 + 0.5 * Math.sin(rt * 4.2);
      this.gHint.alpha = 0.72 + 0.28 * pulse;
      for (let i = 0; i < this.pHint.active; i++) {
        const s = this.pHint.items[i];
        if (s.texture === this.skin.tex.square) s.alpha = epic ? 0.1 + 0.1 * pulse : 0.08 + 0.08 * pulse;
      }
      const pts = this._hintPts;
      const L = this._hintLen;
      const n = this.pHintFlow.active;
      const speed = this.r.squareSize * 1.6;
      for (let k = 0; k < n; k++) {
        const s = this.pHintFlow.items[k];
        let d = ((rt * speed) + (k * L) / n) % L;
        // walk the polyline
        let x = pts[0];
        let y = pts[1];
        let ang = 0;
        for (let i = 2; i < pts.length; i += 2) {
          const sx = pts[i - 2];
          const sy = pts[i - 1];
          const ex = pts[i];
          const ey = pts[i + 1];
          const seg = Math.hypot(ex - sx, ey - sy);
          ang = Math.atan2(ey - sy, ex - sx);
          if (d <= seg) {
            x = sx + ((ex - sx) * d) / seg;
            y = sy + ((ey - sy) * d) / seg;
            break;
          }
          d -= seg;
          x = ex;
          y = ey;
        }
        s.position.set(x, y);
        s.rotation = ang;
        const u = (((rt * speed) + (k * L) / n) % L) / L;
        s.alpha = Math.min(1, u * 6, (1 - u) * 6) * (epic ? 1 : 0.85);
      }
    } else if (this._hintPts) {
      this.gHint.alpha = 1;
    }
    // path: current end node pulse
    if (this.pPath.active) {
      const s = this.pPath.items[this.pPath.active - 1];
      s.scale.set(1.1 + 0.25 * (0.5 + 0.5 * Math.sin(rt * 6)));
    }
  }

  destroy() {
    if (this.skin) this.skin.destroy();
    this.skin = null;
    for (const p of [this.pLast, this.pHint, this.pHintFlow, this.pSel, this.pPath, this.pSelectable, this.pTargets]) p.destroy();
    this.hintLine.destroy();
    this.pathLine.destroy();
  }
}
