// Marked victims ("ты уже мёртв"): when the Director strikes a piece in EPIC mode it takes the
// piece off the renderer's piece map right away (so the map always follows the engine) and leaves
// a visual stand-in here — a snapshot of the disc that reels from the hit, cracks, flickers and
// trembles until the Director detonates it.
//
//   const marks = new Marks(director);
//   const c = marks.mark(sq, { color, victimColor, angle });  // null if no piece on sq
//   c.setUnstable(true);  c.x / c.y;  c.explode();             // explode() removes the stand-in
//   marks.clear();                                             // drop every stand-in (abort / end)
//
// Stand-ins live in a container inside renderer.layers.pieces (just above the shared piece-glow
// layer), so live pieces — the attacker included — always draw over them. Their animation runs
// on the FX effect runner (game time: they freeze with hit-stop and slow down with slow-mo), so
// fx.clear() also removes them.

import { Container, Sprite } from 'pixi.js';
import { Ease } from '../render/tween.js';
import { mixHex } from '../render/canvas.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function eachSprite(node, fn) {
  if (node instanceof Sprite) fn(node);
  if (node.children) for (const c of node.children) eachSprite(c, fn);
}

export class Marks {
  constructor(director) {
    this.d = director;
    this.list = [];
    this._layer = null;
  }

  get count() {
    let n = 0;
    for (const c of this.list) if (!c.dead) n++;
    return n;
  }

  layer() {
    const parent = this.d.renderer.layers.pieces;
    if (!this._layer || this._layer.destroyed) {
      this._layer = new Container();
      this._layer.label = 'director-marks';
    }
    if (this._layer.parent !== parent) parent.addChildAt(this._layer, Math.min(1, parent.children.length));
    return this._layer;
  }

  /** Replace the piece on `sq` by a struck stand-in. opts: { color (attacker), victimColor, angle, epic }. */
  mark(sq, o = {}) {
    const r = this.d.renderer;
    const fx = this.d.fx;
    const v = r.pieceAt(sq);
    if (!v) return null;
    const c = new Corpse(this, v, sq, o);
    r.removePiece(sq, { animate: false });
    this.list.push(c);
    if (fx && typeof fx._run === 'function') {
      c.promise = fx._run({ update: (dt, t) => c.update(dt, t), end: () => c.dispose() });
    }
    return c;
  }

  clear() {
    for (const c of this.list) {
      if (c.promise && c.promise.stop) c.promise.stop();
      c.dispose();
    }
    this.list.length = 0;
  }

  prune() {
    this.list = this.list.filter((c) => !c.dead);
  }
}

class Corpse {
  constructor(marks, view, sq, o) {
    const d = marks.d;
    const r = d.renderer;
    const fx = d.fx;
    this.marks = marks;
    this.sq = sq;
    this.dead = false;
    this.unstable = 0;
    this.angle = o.angle || 0;
    this.color = o.color != null ? o.color : 0xffffff;
    this.victimColor = o.victimColor != null ? o.victimColor : 0xff2e63;
    this.isKing = !!view.isKing;
    const size = r.squareSize;
    this.size = size;
    const p = r.squareCenter(sq);
    this.x0 = p.x;
    this.y0 = p.y;
    this.x = p.x;
    this.y = p.y;
    this.root = new Container();
    this.root.label = 'marked-victim';
    this.root.position.set(p.x, p.y);
    this.inner = new Container();
    this.root.addChild(this.inner);
    // dying energy glow behind the disc
    const T = fx && fx.textures && typeof fx.textures.frame === 'function' ? fx.textures : null;
    this.glow = T ? new Sprite(T.frame('dot')) : null;
    if (this.glow) {
      this.glow.anchor.set(0.5);
      this.glow.blendMode = 'add';
      this.glow.tint = this.victimColor;
      this.glow.scale.set((size * 1.35) / 64);
      this.glow.y = view.body.y;
      this.inner.addChild(this.glow);
    }
    this.snap = view.snapshot({ shadow: true });
    this.inner.addChild(this.snap);
    this.textures = [];
    eachSprite(this.snap, (s) => this.textures.push(s.texture));
    // additive copy: white-hot flash on impact, red strobe while marked
    this.hot = view.snapshot();
    eachSprite(this.hot, (s) => {
      s.blendMode = 'add';
      s.tint = 0xffffff;
    });
    this.hot.alpha = 1;
    this.inner.addChild(this.hot);
    // cracks on the disc
    this.crack = null;
    this.crackRec = null;
    if (T && typeof T.crack === 'function') {
      const rec = T.crack((sq * 7 + 3) % 6, { epic: true, color: this.color, size: Math.round(size * 0.92) });
      rec.refs = (rec.refs || 0) + 1;
      this.crackRec = rec;
      const box = new Container();
      box.y = view.body.y;
      box.rotation = Math.random() * Math.PI * 2;
      const sc = (size * 0.86) / rec.size;
      box.scale.set(sc * 0.5);
      const base = new Sprite(rec.base);
      base.anchor.set(0.5);
      base.alpha = 0;
      box.addChild(base);
      let glowS = null;
      if (rec.glow) {
        glowS = new Sprite(rec.glow);
        glowS.anchor.set(0.5);
        glowS.blendMode = 'add';
        glowS.alpha = 0;
        box.addChild(glowS);
      }
      this.inner.addChild(box);
      this.crack = { box, base, glow: glowS, sc };
    }
    // target reticle
    this.reticle = null;
    if (T) {
      const ret = new Container();
      const ring = new Sprite(T.frame('ring'));
      ring.anchor.set(0.5);
      ring.blendMode = 'add';
      ring.tint = this.color;
      const soft = new Sprite(T.frame('ringSoft'));
      soft.anchor.set(0.5);
      soft.blendMode = 'add';
      soft.tint = mixHex(this.color, 0xff2e63, 0.35);
      ret.addChild(soft, ring);
      ret.y = view.body.y;
      ret.alpha = 0;
      this.inner.addChild(ret);
      this.reticle = { box: ret, ring, soft };
    }
    marks.layer().addChild(this.root);
    this._jt = 0;
    this._jx = 0;
    this._jy = 0;
  }

  setUnstable(v) {
    this.unstable = v ? 1 : 0;
  }

  update(dt, t) {
    if (this.dead || this.root.destroyed) return false;
    for (const tex of this.textures) {
      if (!tex || tex.destroyed) {
        this.dead = true;
        return false;
      }
    }
    const sq = this.size;
    // impact: knock-back + tilt + white-hot flash
    const k = clamp01(t / 220);
    const kb = Ease.outCubic(k);
    const ox = Math.cos(this.angle) * sq * 0.17 * kb;
    const oy = Math.sin(this.angle) * sq * 0.17 * kb;
    const tilt = (Math.cos(this.angle) >= 0 ? 1 : -1) * 0.24 * Ease.outBack(k);
    // tremble (stepped, hand-drawn feel)
    this._jt -= dt;
    const amp = sq * (0.012 + 0.03 * this.unstable) * (t > 160 ? 1 : 0);
    if (this._jt <= 0) {
      this._jt = this.unstable ? 30 : 48;
      this._jx = (Math.random() - 0.5) * 2 * amp;
      this._jy = (Math.random() - 0.5) * 2 * amp;
    }
    this.x = this.x0 + ox;
    this.y = this.y0 + oy;
    this.root.position.set(this.x + this._jx, this.y + this._jy);
    this.inner.rotation = tilt;
    // strobe: white-hot at the hit, then a nervous red/white flicker
    const strobeHz = this.unstable ? 0.045 : 0.02;
    const on = Math.sin(t * strobeHz * Math.PI * 2) > (this.unstable ? -0.1 : 0.55);
    if (t < 180) {
      this.hot.alpha = 1 - t / 220;
      this.setHotTint(0xffffff);
    } else {
      this.hot.alpha = on ? (this.unstable ? 0.75 : 0.42) : 0.04;
      this.setHotTint(this.unstable && Math.floor(t / 70) % 2 ? 0xffffff : this.victimColor === 0xffffff ? 0xff2e63 : mixHex(this.victimColor, 0xff0000, 0.3));
    }
    this.snap.alpha = 0.92 - 0.1 * (on ? 1 : 0);
    if (this.glow) this.glow.alpha = (0.25 + 0.35 * (on ? 1 : 0)) * (this.unstable ? 1.4 : 1);
    if (this.crack) {
      const ck = clamp01((t - 20) / 140);
      this.crack.box.scale.set(this.crack.sc * (0.5 + 0.5 * Ease.outBack(ck)));
      this.crack.base.alpha = 0.95 * ck;
      if (this.crack.glow) this.crack.glow.alpha = ck * (0.55 + 0.45 * (on ? 1 : 0)) * (this.unstable ? 1 : 0.85);
    }
    if (this.reticle) {
      const rk = clamp01((t - 120) / 200);
      const R = this.reticle;
      const pulse = 1 + 0.08 * Math.sin(t * 0.02);
      R.ring.scale.set(((sq * 0.56) / 56) * (1.6 - 0.6 * Ease.outCubic(rk)) * pulse);
      R.soft.scale.set(((sq * 0.7) / 56) * pulse);
      R.box.rotation = t * 0.004;
      R.box.alpha = rk * (on ? 1 : 0.6);
    }
    return true;
  }

  setHotTint(c) {
    if (this._hotTint === c) return;
    this._hotTint = c;
    eachSprite(this.hot, (s) => {
      s.tint = c;
    });
  }

  /** Remove the stand-in (the Director spawns the explosion at c.x / c.y). */
  explode() {
    if (this.dead) return;
    this.dead = true;
    if (this.promise && this.promise.stop) this.promise.stop();
    this.dispose();
  }

  dispose() {
    this.dead = true;
    if (this.crackRec) {
      this.crackRec.refs = Math.max(0, (this.crackRec.refs || 1) - 1);
      this.crackRec = null;
    }
    if (this.root && !this.root.destroyed) {
      this.root.removeFromParent();
      // textures are shared (piece skin / FX atlas / crack cache): never destroy them here
      this.root.destroy({ children: true });
    }
  }
}
