import test from 'node:test';
import assert from 'node:assert/strict';
import { Clock, tween, wait, animate, Ease, lerpColor, resolveEase } from '../../src/render/tween.js';

const flush = () => new Promise((r) => setImmediate(r));

function run(clock, ms, step = 16) {
  for (let t = 0; t < ms; t += step) clock.update(Math.min(step, ms - t));
}

test('clock advances game and real time with scale', () => {
  const c = new Clock();
  c.update(16);
  assert.equal(c.now, 16);
  assert.equal(c.realNow, 16);
  c.setScale(0.5);
  c.update(16);
  assert.equal(c.now, 24);
  assert.equal(c.realNow, 32);
  assert.equal(c.delta, 8);
  assert.equal(c.realDelta, 16);
});

test('clock clamps huge deltas (tab switch) to maxDelta', () => {
  const c = new Clock();
  c.update(5000);
  assert.equal(c.realNow, c.maxDelta);
});

test('setScale transitions smoothly over real time', () => {
  const c = new Clock();
  c.setScale(0.2, 100);
  const seen = [];
  for (let i = 0; i < 8; i++) {
    c.update(16);
    seen.push(c.scale);
  }
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] <= seen[i - 1] + 1e-9, 'monotonic');
  assert.ok(seen[0] < 1 && seen[0] > 0.2);
  assert.equal(c.scale, 0.2);
});

test('tween numeric, dotted and colour props; resolves true', async () => {
  const c = new Clock();
  const o = { x: 0, scale: { x: 1 }, tint: 0x000000 };
  const p = tween(o, { x: 100, 'scale.x': 3, tint: 0xff0000 }, { duration: 100, ease: 'linear', clock: c });
  run(c, 48);
  assert.ok(o.x > 40 && o.x < 60, `x=${o.x}`);
  assert.ok(o.scale.x > 1.8 && o.scale.x < 2.2);
  const r = (o.tint >> 16) & 255;
  assert.ok(r > 100 && r < 150, `r=${r}`);
  assert.equal(o.tint & 0xffff, 0);
  run(c, 80);
  assert.equal(o.x, 100);
  assert.equal(o.scale.x, 3);
  assert.equal(o.tint, 0xff0000);
  assert.equal(await p, true);
});

test('tween delay keeps value; explicit [from, to] applied immediately', () => {
  const c = new Clock();
  const o = { a: 5, b: 0 };
  tween(o, { a: 10, b: [1, 2] }, { duration: 50, delay: 50, clock: c });
  assert.equal(o.b, 1);
  run(c, 32);
  assert.equal(o.a, 5);
  run(c, 100);
  assert.equal(o.a, 10);
  assert.equal(o.b, 2);
});

test('cancel resolves false and freezes; cancel(true) jumps to end', async () => {
  const c = new Clock();
  const o = { x: 0 };
  const p = tween(o, { x: 100 }, { duration: 100, ease: 'linear', clock: c });
  run(c, 32);
  const mid = o.x;
  p.cancel();
  run(c, 100);
  assert.equal(o.x, mid);
  assert.equal(await p, false);

  const o2 = { x: 0 };
  const p2 = tween(o2, { x: 100 }, { duration: 100, clock: c });
  p2.cancel(true);
  assert.equal(o2.x, 100);
  assert.equal(await p2, true);
});

test('realtime tweens run during hit-stop, game-time tweens freeze', async () => {
  const c = new Clock();
  const g = { v: 0 };
  const r = { v: 0 };
  c.setScale(0);
  tween(g, { v: 1 }, { duration: 100, ease: 'linear', clock: c });
  tween(r, { v: 1 }, { duration: 100, ease: 'linear', clock: c, realtime: true });
  run(c, 64);
  assert.equal(g.v, 0);
  assert.ok(r.v > 0.5);
});

test('wait (game vs real) and hitStop restores the scale', async () => {
  const c = new Clock();
  let gameDone = false;
  let realDone = false;
  c.setScale(0.5);
  wait(100, { clock: c }).then(() => (gameDone = true));
  wait(100, { clock: c, realtime: true }).then(() => (realDone = true));
  run(c, 112);
  await flush();
  assert.equal(realDone, true);
  assert.equal(gameDone, false);
  run(c, 112);
  await flush();
  assert.equal(gameDone, true);

  c.setScale(1);
  const hs = c.hitStop(80);
  c.update(16);
  assert.ok(c.scale < 0.05);
  run(c, 96);
  await hs;
  assert.equal(c.scale, 1);
});

test('slowMo eases in, holds and returns to 1', async () => {
  const c = new Clock();
  const p = c.slowMo(0.25, 100, { inMs: 40, outMs: 40 });
  run(c, 60);
  assert.ok(c.scale <= 0.26);
  run(c, 120);
  await flush(); // the ease-out phase is chained in a microtask
  assert.ok(c.scale < 1);
  run(c, 64);
  await p;
  assert.equal(c.scale, 1);
});

test('tasks created inside onUpdate/listeners are processed later without errors', async () => {
  const c = new Clock();
  const o = { x: 0, y: 0 };
  let spawned = null;
  tween(o, { x: 1 }, {
    duration: 32,
    clock: c,
    onUpdate: () => {
      if (!spawned) spawned = tween(o, { y: 1 }, { duration: 32, clock: c });
    },
  });
  run(c, 160);
  assert.equal(o.x, 1);
  assert.equal(o.y, 1);
  assert.equal(await spawned, true);
});

test('listeners receive deltas and can unsubscribe', () => {
  const c = new Clock();
  let calls = 0;
  const off = c.add((g, r) => {
    calls++;
    assert.equal(r, 16);
  });
  c.update(16);
  c.update(16);
  off();
  c.update(16);
  assert.equal(calls, 2);
});

test('animate() callback receives eased progress and finishes at 1', async () => {
  const c = new Clock();
  const seen = [];
  const p = animate(64, (e, k) => seen.push([e, k]), { clock: c, ease: Ease.inQuad });
  run(c, 96);
  assert.equal(await p, true);
  const last = seen[seen.length - 1];
  assert.deepEqual(last, [1, 1]);
  assert.ok(seen[0][0] < seen[0][1]); // inQuad lags the raw progress
});

test('Ease set: endpoints and characteristic shapes', () => {
  const required = ['linear', 'inQuad', 'outQuad', 'inOutQuad', 'inCubic', 'outCubic', 'inOutCubic', 'outBack', 'inBack',
    'outElastic', 'inExpo', 'outExpo', 'inOutExpo', 'outBounce'];
  for (const k of required) {
    assert.equal(typeof Ease[k], 'function', k);
    assert.ok(Math.abs(Ease[k](0)) < 1e-6, `${k}(0)`);
    assert.ok(Math.abs(Ease[k](1) - 1) < 1e-6, `${k}(1)`);
  }
  let max = 0;
  for (let t = 0; t <= 1; t += 0.01) max = Math.max(max, Ease.outBack(t));
  assert.ok(max > 1.05, 'outBack overshoots');
  assert.equal(resolveEase('nope'), Ease.outCubic);
  assert.equal(lerpColor(0x000000, 0xffffff, 0.5), 0x808080);
});
