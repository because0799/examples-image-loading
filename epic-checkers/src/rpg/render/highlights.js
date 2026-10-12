// «Валькирии доски» — board highlights: selectable / selected heroes, move dots, jump-strike chains
// (red victim rings + dashed path + landing marks), target reticles and ability areas.
// Pooled sprites from the icon atlas in two layers (area fills: normal blend; rings / dots /
// paths: additive). Pulses are a few alpha / scale writes per frame.

import { Container, Sprite, Texture } from 'pixi.js';
import { HL, mix } from './theme.js';
import { between } from './layout.js';

const TAU = Math.PI * 2;

export class Highlights {
  constructor(view) {
    this.view = view;
    this.under = view.layers.hlUnder;
    this.add = view.layers.hlAdd; // board level: dots, dashes
    this.top = view.layers.hlTop; // above the tokens: rings and reticles (hollow, never cover a face)
    this.pool = [];
    this.used = [];
    this.spec = null;
    this._t = 0;
  }

  _s(frame, parent, tint, kind) {
    const s = this.pool.pop() || new Sprite(Texture.WHITE);
    s.texture = this.view.icons.frame(frame);
    s.anchor.set(0.5);
    s.tint = tint;
    s.alpha = 1;
    s.rotation = 0;
    s.visible = true;
    s.blendMode = 'inherit';
    s._kind = kind;
    s._phase = Math.random() * TAU;
    parent.addChild(s);
    this.used.push(s);
    return s;
  }

  _size(s, w, h = w) {
    const t = s.texture.orig;
    s.scale.set(w / (t.width || 1), h / (t.height || 1));
    s.rvSx = s.scale.x;
    s.rvSy = s.scale.y;
  }

  clear() {
    for (const s of this.used) {
      s.removeFromParent();
      s.visible = false;
      this.pool.push(s);
    }
    this.used.length = 0;
    this.spec = null;
    this.view.forEachToken((t) => t.setScale(1));
  }

  /** spec = { selectable: [unitId], selected: unitId, moves: [sq], jumps: [[sq]], targets: [sq], area: [sq], allies: [sq] } */
  set(spec) {
    this.clear();
    if (!spec) return;
    this.spec = spec;
    this._build();
  }

  relayout() {
    if (!this.spec) return;
    const spec = this.spec;
    this.clear();
    this.spec = spec;
    this._build();
  }

  _build() {
    const v = this.view;
    const sq = v.sqSize;
    const S = this.spec;
    const p = { x: 0, y: 0 };
    // ability area (under the tokens, normal blend)
    for (const q of S.area || []) {
      v.center(q, p);
      const s = this._s('square', this.under, HL.area, 'area');
      s.position.set(p.x, p.y);
      this._size(s, sq * 0.96);
      s.alpha = 0.32;
    }
    // selectable heroes: a soft ring under the token in the side colour
    for (const id of S.selectable || []) {
      if (id === S.selected) continue;
      const t = v.token(id);
      if (!t || !t.alive) continue;
      const s = this._s('glowRing', this.top, mix(t.sideColor, 0xffffff, 0.3), 'selectable');
      s.position.set(t.x, t.y);
      this._size(s, sq * 1.36);
    }
    // selected hero: gold ring + rotating arcs + lift
    if (S.selected != null) {
      const t = v.token(S.selected);
      if (t && t.alive) {
        const a = this._s('glowRing', this.top, HL.selected, 'selected');
        a.position.set(t.x, t.y);
        this._size(a, sq * 1.5);
        const b = this._s('selRing', this.top, HL.selected, 'spin');
        b.position.set(t.x, t.y);
        this._size(b, sq * 1.22);
        t.setScale(1.07);
      }
    }
    // moves
    for (const q of S.moves || []) {
      v.center(q, p);
      const s = this._s('moveDot', this.add, HL.move, 'dot');
      s.position.set(p.x, p.y);
      this._size(s, sq * 0.42);
    }
    // jump chains: victims (red rings), dashed path, landing marks
    const start = S.selected != null && v.token(S.selected) ? v.token(S.selected).sq : -1;
    const seenVictim = new Set();
    const seenLand = new Set();
    for (const path0 of S.jumps || []) {
      if (!Array.isArray(path0) || !path0.length) continue;
      const path = start >= 0 && path0[0] !== start ? [start, ...path0] : path0.slice();
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1];
        const b = path[i];
        for (const m of between(a, b)) {
          if (seenVictim.has(m) || !v.occupied(m)) continue;
          seenVictim.add(m);
          v.center(m, p);
          const s = this._s('glowRing', this.top, HL.jump, 'victim');
          s.position.set(p.x, p.y);
          this._size(s, sq * 1.42);
        }
        this._dashes(a, b);
        if (!seenLand.has(b)) {
          seenLand.add(b);
          v.center(b, p);
          const s = this._s('moveDot', this.add, HL.land, 'dot');
          s.position.set(p.x, p.y);
          this._size(s, sq * (i === path.length - 1 ? 0.5 : 0.36));
        }
      }
    }
    // targets
    for (const q of S.targets || []) {
      v.center(q, p);
      const s = this._s('reticle', this.top, HL.target, 'reticle');
      s.position.set(p.x, p.y);
      this._size(s, sq * 0.96);
    }
    for (const q of S.allies || []) {
      v.center(q, p);
      const s = this._s('reticle', this.top, HL.ally, 'reticle');
      s.position.set(p.x, p.y);
      this._size(s, sq * 0.96);
    }
  }

  _dashes(a, b) {
    const v = this.view;
    const sq = v.sqSize;
    const pa = v.center(a, { x: 0, y: 0 });
    const pb = v.center(b, { x: 0, y: 0 });
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const len = Math.hypot(dx, dy);
    const n = Math.max(2, Math.round(len / (sq * 0.24)));
    const ang = Math.atan2(dy, dx);
    for (let i = 1; i < n; i++) {
      const k = i / n;
      const s = this._s('dash', this.add, HL.jump, 'dash');
      s.position.set(pa.x + dx * k, pa.y + dy * k);
      s.rotation = ang;
      this._size(s, sq * 0.14, sq * 0.05);
      s._k = k;
    }
  }

  update(dt) {
    if (!this.used.length) return;
    this._t += dt / 1000;
    const t = this._t;
    for (const s of this.used) {
      switch (s._kind) {
        case 'dot':
        case 'victim':
        case 'selectable': {
          const p = 0.5 + 0.5 * Math.sin(t * 4.2 + s._phase);
          s.alpha = s._kind === 'selectable' ? 0.45 + 0.35 * p : 0.7 + 0.3 * p;
          const k = 1 + 0.08 * p;
          s.scale.set(s.rvSx * k, s.rvSy * k);
          break;
        }
        case 'selected':
          s.alpha = 0.75 + 0.25 * Math.sin(t * 5);
          break;
        case 'spin':
          s.rotation = t * 1.6;
          break;
        case 'reticle':
          s.rotation = Math.sin(t * 2 + s._phase) * 0.12;
          s.alpha = 0.8 + 0.2 * Math.sin(t * 6);
          break;
        case 'dash':
          s.alpha = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 6 - s._k * 6));
          break;
        default:
          break;
      }
    }
  }

  destroy() {
    this.clear();
    for (const s of this.pool) s.destroy();
    this.pool.length = 0;
  }
}
