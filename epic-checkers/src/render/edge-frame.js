// EdgeFrame — a 9-slice frame WITHOUT its centre: 4 corner sprites + 4 stretched edge sprites cut
// from one small texture. Used for the board's drop shadow and the epic turn glow, whose middle is
// always hidden under the (opaque) board: drawing them as full quads cost ~0.5 screen of blended
// fill each per frame; the frame only rasterises the visible border band. All 8 sprites share one
// texture source, so they batch with their neighbours (no extra draw call).
//
//   const f = new EdgeFrame();               // a Container
//   f.setTexture(tex, corner, edge);         // tex: S×S (logical) painted for a small S, corner c,
//                                            // edge band thickness e ≤ c (default c): the band
//                                            // between the corners only needs to reach under the board
//   f.setSize(W, H);                         // full outer size (corners keep c×c, edges stretch)
//   f.tint = 0x29e6ff; f.alpha = 0.6;        // tint is applied to all 8 sprites
//
// The painter must make the band between the corners uniform along each edge (a straight glow /
// blur), so stretching the middle slice is exact.

import { Container, Rectangle, Sprite, Texture } from 'pixi.js';

export class EdgeFrame extends Container {
  constructor() {
    super();
    this.label = 'edge-frame';
    this.parts = [];
    for (let i = 0; i < 8; i++) {
      const s = new Sprite();
      this.parts.push(s);
      this.addChild(s);
    }
    this._subs = [];
    this._c = 0;
    this._S = 0;
    this._w = 0;
    this._h = 0;
    this._tint = 0xffffff;
    this._blend = 'normal';
  }

  /** Source texture (logical S×S), corner size c (logical; c < S/2), edge thickness e (≤ c). */
  setTexture(tex, corner, edge = corner) {
    for (const t of this._subs) t.destroy(false);
    this._subs = [];
    if (!tex) {
      for (const s of this.parts) s.texture = Texture.EMPTY;
      return;
    }
    const S = Math.min(tex.width, tex.height);
    const c = Math.max(1, Math.min(corner, S / 2 - 0.5));
    const e = Math.max(1, Math.min(c, edge == null ? c : edge));
    const m = S - 2 * c;
    this._S = S;
    this._c = c;
    this._e = e;
    const src = tex.source;
    const ox = tex.frame.x;
    const oy = tex.frame.y;
    // order: TL, T, TR, L, R, BL, B, BR
    const rects = [
      [0, 0, c, c], [c, 0, m, e], [c + m, 0, c, c],
      [0, c, e, m], [S - e, c, e, m],
      [0, c + m, c, c], [c, S - e, m, e], [c + m, c + m, c, c],
    ];
    rects.forEach(([x, y, w, h], i) => {
      const t = new Texture({ source: src, frame: new Rectangle(ox + x, oy + y, w, h), label: 'edge-frame-part' });
      this._subs.push(t);
      this.parts[i].texture = t;
    });
    this._layout();
  }

  /** Outer size of the whole frame. */
  setSize(w, h) {
    this._w = Math.max(0, +w || 0);
    this._h = Math.max(0, +h || 0);
    this._layout();
  }

  _layout() {
    const c = this._c;
    const e = this._e || c;
    const W = Math.max(2 * c, this._w);
    const H = Math.max(2 * c, this._h);
    const P = this.parts;
    const mw = W - 2 * c;
    const mh = H - 2 * c;
    const place = (s, x, y, w, h) => {
      s.position.set(x, y);
      s.width = w;
      s.height = h;
    };
    place(P[0], 0, 0, c, c);
    place(P[1], c, 0, mw, e);
    place(P[2], W - c, 0, c, c);
    place(P[3], 0, c, e, mh);
    place(P[4], W - e, c, e, mh);
    place(P[5], 0, H - c, c, c);
    place(P[6], c, H - e, mw, e);
    place(P[7], W - c, H - c, c, c);
    // a zero-length edge (W == 2c) must not render a stretched sliver
    P[1].visible = P[6].visible = mw > 0.01;
    P[3].visible = P[4].visible = mh > 0.01;
  }

  get tint() {
    return this._tint;
  }

  set tint(v) {
    if (v === this._tint) return;
    this._tint = v;
    for (const s of this.parts) s.tint = v;
  }

  get blendMode() {
    return this._blend;
  }

  set blendMode(v) {
    this._blend = v;
    for (const s of this.parts) s.blendMode = v;
  }

  /** Pixels actually covered (logical units², for perf stats). */
  get coveredArea() {
    const c = this._c;
    const e = this._e || c;
    const mw = Math.max(0, this._w - 2 * c);
    const mh = Math.max(0, this._h - 2 * c);
    return 4 * c * c + 2 * e * mw + 2 * e * mh;
  }

  destroy(options) {
    for (const t of this._subs) t.destroy(false);
    this._subs = [];
    super.destroy({ children: true, ...(options || {}) });
  }
}
