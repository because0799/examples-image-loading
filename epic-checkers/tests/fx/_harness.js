// Shared headless harness for Director tests: fake renderer (instant camera, real piece map and
// clock) and a RECORDING FX stub (every primitive is a no-op that logs its name + options).
import { Container, Texture } from 'pixi.js';
import { Clock, animate } from '../../src/render/tween.js';
import { Director } from '../../src/fx/director.js';

const SQ = 40;

class FakeView {
  constructor(code) {
    this.setCode(code);
    this.x = 0;
    this.y = 0;
    this.alpha = 1;
    this.visible = true;
    const sc = { x: 1, y: 1, set: (v) => (sc.x = sc.y = v) };
    this.scale = sc;
    this.lift = 0;
    this.squash = 0;
    this.body = { x: 0, y: 0 };
    this.auraLayer = new Container();
    this.parent = {};
    this.destroyed = false;
    this.squareSize = SQ;
    this._moveTask = null;
  }
  setCode(c) {
    this.color = Math.sign(c);
    this.isKing = Math.abs(c) === 2;
  }
  snapshot() {
    return new Container();
  }
  setDim() {}
}

export function fakeRenderer(size) {
  const clock = new Clock();
  const pieces = new Array(size * size).fill(null);
  const done = (v = true) => {
    const p = Promise.resolve(v);
    p.cancel = () => {};
    return p;
  };
  const r = {
    clock,
    flipped: false,
    variant: { size },
    layout: { n: size },
    squareSize: SQ,
    boardCenter: { x: (size * SQ) / 2, y: (size * SQ) / 2 },
    frameBounds: { x: 0, y: 0, width: size * SQ, height: size * SQ },
    boardBounds: { x: 0, y: 0, width: size * SQ, height: size * SQ },
    screen: { width: 390, height: 844 },
    layers: { pieces: new Container() },
    highlights: { setHint() {} },
    camera: { zoom: 1, punchScale: 1, idle: true, focus: () => done(), reset: () => done(), punch() {}, shake() {}, snap() {} },
    squareCenter: (sq) => ({ x: (sq % size) * SQ + SQ / 2, y: Math.floor(sq / size) * SQ + SQ / 2 }),
    worldToScreen: (x, y) => ({ x, y }),
    sqToDisplay: (sq) => ({ row: Math.floor(sq / size), col: sq % size }),
    pieceAt: (sq) => pieces[sq] || null,
    forEachPiece(fn) {
      pieces.forEach((v, sq) => v && fn(v, sq));
    },
    setPosition(state) {
      r.setPositionCalls++;
      for (let sq = 0; sq < size * size; sq++) {
        const c = state.board[sq];
        if (!c) {
          if (pieces[sq]) pieces[sq].parent = null;
          pieces[sq] = null;
          continue;
        }
        const v = new FakeView(c);
        const p = r.squareCenter(sq);
        v.x = p.x;
        v.y = p.y;
        v.sq = sq;
        pieces[sq] = v;
      }
    },
    setPositionCalls: 0,
    movePiece(from, to, o = {}) {
      const v = pieces[from];
      if (!v) return done(false);
      pieces[from] = null;
      if (pieces[to] && pieces[to] !== v) pieces[to].parent = null;
      pieces[to] = v;
      v.sq = to;
      const a = { x: v.x, y: v.y };
      const b = r.squareCenter(to);
      const t = animate(
        o.duration || 200,
        (e) => {
          v.x = a.x + (b.x - a.x) * e;
          v.y = a.y + (b.y - a.y) * e;
          if (o.onUpdate) o.onUpdate(e, v.x, v.y, e);
        },
        { clock },
      );
      v._moveTask = t;
      return t.then((ok) => {
        if (v._moveTask === t) v._moveTask = null;
        v.x = b.x;
        v.y = b.y;
        return ok;
      });
    },
    removePiece(sq) {
      const v = pieces[sq];
      if (!v) return done(false);
      pieces[sq] = null;
      v.parent = null;
      return done(true);
    },
    setPieceKing(sq, k) {
      if (pieces[sq]) pieces[sq].isKing = !!k;
      return done(true);
    },
    setTurnGlow() {},
    lightning() {},
  };
  return r;
}

export function stubFx(mode) {
  const done = () => {
    const p = Promise.resolve(true);
    p.stop = () => {};
    return p;
  };
  const base = {
    mode,
    quality: 'high',
    q: { mul: 1 },
    get epic() {
      return this.mode === 'epic';
    },
    setMode(m) {
      this.mode = m;
    },
    setLang() {},
    aura(v) {
      const c = new Container();
      c.label = 'fx-aura';
      v.auraLayer.addChild(c);
      return {
        stop: () => {
          c.removeFromParent();
          c.destroy();
          return done();
        },
      };
    },
    textures: { frame: () => Texture.EMPTY, crack: () => ({ base: Texture.EMPTY, glow: null, size: 32, refs: 0 }) },
  };
  return new Proxy(base, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && !k.startsWith('_') ? () => done() : undefined) });
}


/** stubFx + a call log: fx.calls = [[name, ...args]] for every primitive used. */
export function recordingFx(mode) {
  const inner = stubFx(mode);
  const calls = [];
  const fx = new Proxy(inner, {
    get(t, k) {
      if (k === 'calls') return calls;
      const v = t[k];
      if (typeof v === 'function' && typeof k === 'string' && !k.startsWith('_')) {
        return (...a) => {
          calls.push([k, ...a]);
          return v.apply(t, a);
        };
      }
      return v;
    },
  });
  return fx;
}

export const flush = () => new Promise((res) => setImmediate(res));

export async function drive(r, p, { maxMs = 30000, onFrame } = {}) {
  let finished = false;
  p.then(() => (finished = true));
  let t = 0;
  while (!finished && t < maxMs) {
    r.clock.update(16);
    t += 16;
    if (onFrame) onFrame(t);
    await flush();
  }
  return { finished, t };
}

export function setupDirector(size, mode, settings = {}, { record = true } = {}) {
  const r = fakeRenderer(size);
  const fx = record ? recordingFx(mode) : stubFx(mode);
  const log = { speech: [], vib: [] };
  const native = { vibrate: (p) => log.vib.push(p), speak: (t) => log.speech.push(t) };
  const d = new Director({ renderer: r, fx, audio: { play() {}, duck() {} }, native, settings: { lang: 'ru', announcer: true, animSpeed: 1, ...settings } });
  d.setMode(mode);
  return { r, d, fx, log };
}

export { Clock, animate, Texture, Container };
