// Director: the board ALWAYS ends exactly in `after` (all variants, both modes, with and without
// skip), syncPosition() aborts a running cinematic's board writes, auras follow the kings, the
// clock is handed back at scale 1. Headless: fake renderer + stub FX (every primitive = no-op).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Container, Texture } from 'pixi.js';
import { Clock, animate } from '../../src/render/tween.js';
import { Director } from '../../src/fx/director.js';
import { VARIANTS, createInitialState, legalMoves, applyMove, stateFromString } from '../../src/engine/index.js';

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

function fakeRenderer(size) {
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

function stubFx(mode) {
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

function setup(variantId, mode, settings = {}) {
  const v = VARIANTS.find((x) => x.id === variantId);
  const r = fakeRenderer(v.size);
  const fx = stubFx(mode);
  const log = { speech: [], vib: 0 };
  const native = { vibrate: () => log.vib++, speak: (t) => log.speech.push(t) };
  const d = new Director({ renderer: r, fx, audio: { play() {}, duck() {} }, native, settings: { lang: 'ru', vibration: true, announcer: true, animSpeed: 1, ...settings } });
  d.setMode(mode);
  return { r, d, fx, log };
}

const flush = () => new Promise((res) => setImmediate(res));

async function drive(r, p, { maxMs = 30000, onFrame } = {}) {
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

function boardDiff(r, state) {
  const bad = [];
  for (let sq = 0; sq < state.board.length; sq++) {
    const c = state.board[sq];
    const v = r.pieceAt(sq);
    if (!c) {
      if (v) bad.push(sq);
    } else if (!v || v.color !== Math.sign(c) || v.isKing !== (Math.abs(c) === 2)) bad.push(sq);
    else {
      const p = r.squareCenter(sq);
      if (Math.abs(v.x - p.x) > 0.5 || Math.abs(v.y - p.y) > 0.5) bad.push(sq);
    }
  }
  return bad;
}

/** Deterministic random playouts: returns [before, move, after] triples with captures preferred. */
function samples(variantId, count, seed) {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const out = [];
  let st = createInitialState(variantId);
  for (let ply = 0; out.length < count && ply < 400; ply++) {
    const ms = legalMoves(st);
    if (!ms.length) st = createInitialState(variantId);
    else {
      const caps = ms.filter((m) => m.captures.length);
      const m = caps.length && rnd() < 0.9 ? caps[Math.floor(rnd() * caps.length)] : ms[Math.floor(rnd() * ms.length)];
      const after = applyMove(st, m);
      if (m.captures.length || m.promotion || rnd() < 0.25) out.push([st, m, after]);
      st = after;
    }
  }
  return out;
}

const NAMES = { 1: { name: 'Ты', isHuman: true }, '-1': { name: 'Сёгун', isHuman: false, level: 4, power: 9001 } };

for (const mode of ['epic', 'classic']) {
  test(`${mode}: playMove always ends exactly in "after" (every variant)`, async () => {
    const errors = [];
    const orig = console.error;
    console.error = (...a) => errors.push(a.join(' '));
    try {
      for (const v of VARIANTS) {
        const { r, d } = setup(v.id, mode);
        for (const [before, move, after] of samples(v.id, 6, 7 + v.size)) {
          r.setPosition(before);
          d.syncPosition(before);
          const hype = { 1: Math.random() < 0.3 ? 1 : 0, '-1': 0 };
          const p = d.playMove({ move, before, after, mover: before.turn, moverIsHuman: before.turn === 1, names: NAMES, stats: { hype, captures: { 1: 0, '-1': 0 } } });
          const res = await drive(r, p);
          assert.ok(res.finished, `${v.id} ${move.path.join('-')} did not finish`);
          assert.deepEqual(boardDiff(r, after), [], `${v.id} ${mode} ${move.path.join('-')}`);
          assert.equal(d.busy, false);
          assert.equal(r.clock.scale, 1);
          assert.equal(d._marks.count, 0);
        }
      }
    } finally {
      console.error = orig;
    }
    assert.deepEqual(errors, []);
  });
}

test('skip() at any moment still ends in "after", fast, with the clock back at 1', async () => {
  for (const id of ['russian', 'turkish', 'international']) {
    const { r, d } = setup(id, 'epic');
    for (const [before, move, after] of samples(id, 5, 99)) {
      for (const at of [16, 300, 900]) {
        r.setPosition(before);
        d.syncPosition(before);
        const p = d.playMove({ move, before, after, mover: before.turn, moverIsHuman: true, names: NAMES, stats: { hype: { 1: 1, '-1': 1 } } });
        let skippedAt = -1;
        const res = await drive(r, p, {
          onFrame: (t) => {
            if (skippedAt < 0 && t >= at && d.busy) {
              d.skip();
              skippedAt = t;
            }
          },
        });
        assert.ok(res.finished);
        if (skippedAt >= 0) assert.ok(res.t - skippedAt < 1200, `skip took ${res.t - skippedAt} ms`);
        assert.deepEqual(boardDiff(r, after), []);
        assert.equal(r.clock.scale, 1);
        assert.equal(d.busy, false);
      }
    }
  }
});

test('syncPosition() during a cinematic aborts it without writing the stale "after"', async () => {
  const { r, d } = setup('russian', 'epic');
  const before = stateFromString('russian', 'w:.b.b.b.b/......b./...b...b/......../...b..../......../.b.w.w.w/w.w.w.w.');
  const move = legalMoves(before).sort((a, b) => b.captures.length - a.captures.length)[0];
  const after = applyMove(before, move);
  r.setPosition(before);
  d.syncPosition(before);
  const p = d.playMove({ move, before, after, mover: 1, moverIsHuman: true, names: NAMES, stats: null });
  for (let i = 0; i < 40; i++) {
    r.clock.update(16);
    await flush();
  }
  assert.equal(d.busy, true);
  // a new game starts: the controller re-sets the board and tells the Director
  const fresh = createInitialState('russian');
  r.setPosition(fresh);
  d.syncPosition(fresh);
  const res = await drive(r, p);
  assert.ok(res.finished);
  assert.deepEqual(boardDiff(r, fresh), [], 'the new position must survive the aborted cinematic');
  assert.equal(d.busy, false);
  assert.equal(r.clock.scale, 1);
});

test('auras follow the kings (epic only)', async () => {
  const { r, d } = setup('russian', 'epic');
  const st = stateFromString('russian', 'w:......../..W...../......../..b...../......../..B...../......../w.......');
  r.setPosition(st);
  d.syncPosition(st);
  const auras = () => {
    let n = 0;
    r.forEachPiece((v) => (n += v.auraLayer.children.filter((c) => c.label === 'fx-aura').length));
    return n;
  };
  assert.equal(auras(), 2);
  d.syncAuras();
  assert.equal(auras(), 2, 'no duplicates');
  d.setMode('classic');
  assert.equal(auras(), 0);
  d.setMode('epic');
  assert.equal(auras(), 2);
});

test('promotion crowns the piece; mid-capture promotion keeps going as a king', async () => {
  const { r, d } = setup('russian', 'epic');
  const before = stateFromString('russian', 'w:......../..b...b./.b.b.b../......b./...b.w../w.....w./.w...b.w/w...w...');
  const move = legalMoves(before).sort((a, b) => b.captures.length - a.captures.length)[0];
  assert.ok(move.promotion && move.promotionAt > 0 && move.promotionAt < move.path.length - 1);
  const after = applyMove(before, move);
  r.setPosition(before);
  d.syncPosition(before);
  const res = await drive(r, d.playMove({ move, before, after, mover: 1, moverIsHuman: true, names: NAMES, stats: null }));
  assert.ok(res.finished);
  assert.deepEqual(boardDiff(r, after), []);
  const king = r.pieceAt(move.path[move.path.length - 1]);
  assert.equal(king.isKing, true);
  assert.equal(king.auraLayer.children.length, 1, 'the new king burns');
});

test('announcer only speaks in epic with settings.announcer, vibration honours settings', async () => {
  for (const [mode, announcer, vibration] of [
    ['epic', true, true],
    ['epic', false, false],
    ['classic', true, true],
  ]) {
    const { r, d, log } = setup('russian', mode, { announcer, vibration });
    const before = stateFromString('russian', 'w:.b.b.b.b/......b./...b...b/......../...b..../......../.b.w.w.w/w.w.w.w.');
    const move = legalMoves(before).sort((a, b) => b.captures.length - a.captures.length)[0];
    const after = applyMove(before, move);
    r.setPosition(before);
    await drive(r, d.playMove({ move, before, after, mover: 1, moverIsHuman: true, names: NAMES, stats: null }));
    if (mode === 'epic' && announcer) assert.ok(log.speech.includes('TRIPLE KILL!'), JSON.stringify(log.speech));
    else assert.deepEqual(log.speech, []);
    if (vibration) assert.ok(log.vib > 0);
    else assert.equal(log.vib, 0);
  }
});

test('game start / game over / turn resolve and leave the board intact', async () => {
  for (const mode of ['epic', 'classic']) {
    const { r, d } = setup('turkish', mode);
    const st = createInitialState('turkish');
    r.setPosition(st);
    d.syncPosition(st);
    let res = await drive(r, d.playGameStart({ variant: VARIANTS[1], players: NAMES, epic: mode === 'epic', bottomColor: 1 }));
    assert.ok(res.finished);
    assert.ok(res.t < 2600, `start took ${res.t}`);
    assert.deepEqual(boardDiff(r, st), []);
    r.forEachPiece((v) => assert.equal(v.alpha, 1));
    for (const [winner, human] of [[1, 1], [-1, 1], [0, 1], [1, 0]]) {
      res = await drive(r, d.playGameOver({ result: { winner, reason: 'no-pieces' }, humanColor: human, stats: { captures: { 1: 3, '-1': 0 }, piecesLost: { 1: 0, '-1': 3 } }, players: NAMES }));
      assert.ok(res.finished);
      assert.ok(res.t <= 4100, `game over took ${res.t}`);
      assert.equal(r.clock.scale, 1);
    }
    res = await drive(r, d.playTurn({ color: 1, isHuman: true, players: NAMES }));
    assert.ok(res.finished);
    assert.equal(d.busy, false);
  }
});
