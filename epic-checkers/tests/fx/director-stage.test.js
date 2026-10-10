// Stage (director lanes): banners / captions / combo never overlap — they queue, stack in two rows,
// preempt or get dropped; overlays go into the free lanes above / below the board when present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Clock } from '../../src/render/tween.js';
import { Stage, MIN_LANE } from '../../src/fx/director-stage.js';

/** A fake overlay like caption() / turnBanner(): a promise with .stop() and a live effect record. */
function overlay(clock, duration) {
  const e = { t: 0, duration, done: false };
  let resolve;
  const p = new Promise((r) => (resolve = r));
  p.effect = e;
  p.stop = () => {
    if (!e.done) {
      e.done = true;
      resolve(false);
    }
  };
  const tick = () => {
    if (e.done) return;
    e.t += clock.realDelta;
    if (e.t >= e.duration) {
      e.done = true;
      resolve(true);
    }
  };
  clock.add(tick);
  return p;
}

function setup(lanes, heights = { banner: 42, caption: 60 }) {
  const clock = new Clock();
  const d = {
    _clock: clock,
    fx: { hideCombo() {} },
    _overlayHeight: (kind, lines) => (kind === 'banner' ? heights.banner : heights.caption + (lines === 2 ? 26 : 0)),
  };
  const st = new Stage(d);
  st.setLanes(lanes);
  clock.add(() => st.tick());
  const shown = [];
  const make = (kind, side, h, dur) => (pl) => {
    const p = overlay(clock, dur);
    const rec = { kind, side, y: pl.y, h: Math.min(h, pl.maxH || h), at: clock.realNow, p, lane: pl.lane };
    shown.push(rec);
    p.then(() => (rec.end = clock.realNow));
    return p;
  };
  const run = async (ms) => {
    for (let t = 0; t < ms; t += 16) {
      clock.update(16);
      await new Promise((r) => setImmediate(r));
    }
  };
  return { clock, st, make, run, shown };
}

const overlapsInTime = (a, b) => a.at < (b.end ?? Infinity) && b.at < (a.end ?? Infinity);
const overlapsInSpace = (a, b) => a.side === b.side && (a.y == null || b.y == null || Math.abs(a.y - b.y) < (a.h + b.h) / 2);

test('one-row lane: a caption waits for the banner (never on screen together)', async () => {
  const { st, make, run, shown } = setup({ top: { y: 90, h: 92 }, bottom: { y: 556, h: 92 } });
  st.request('bottom', 'banner', { h: 42, make: make('banner', 'bottom', 42, 1000), maxWait: 1500 });
  st.request('bottom', 'caption', { h: 86, make: make('caption', 'bottom', 86, 2000), maxWait: 1500 });
  await run(3500);
  assert.equal(shown.length, 2);
  assert.ok(!overlapsInTime(shown[0], shown[1]), 'the caption came after the banner');
  for (const r of shown) {
    assert.equal(r.lane, true);
    assert.ok(r.y > 556 && r.y < 556 + 92, `centred in the bottom lane (${r.y})`);
  }
});

test('two-row lane: banner (next to the board) and caption (next to the HUD) share it without overlapping', async () => {
  const { st, make, run, shown } = setup({ top: { y: 90, h: 120 }, bottom: { y: 600, h: 120 } });
  st.request('top', 'caption', { h: 60, make: make('caption', 'top', 60, 2000) });
  st.request('top', 'banner', { h: 42, make: make('banner', 'top', 42, 1000) });
  await run(200);
  assert.equal(shown.length, 2, 'both visible at once');
  const [cap, ban] = shown;
  assert.ok(!overlapsInSpace(cap, ban), `rows overlap: caption ${cap.y}/${cap.h} banner ${ban.y}/${ban.h}`);
  assert.ok(ban.y > cap.y, 'top lane: the banner hugs the board (below the caption)');
  for (const r of shown) assert.ok(r.y - r.h / 2 >= 90 - 0.5 && r.y + r.h / 2 <= 210 + 0.5, 'inside the lane');
});

test('a banner preempts a caption that has been readable for a while; a stale caption is dropped', async () => {
  const { st, make, run, shown } = setup({ top: null, bottom: { y: 556, h: 92 } });
  st.request('bottom', 'caption', { h: 86, make: make('caption', 'bottom', 86, 5000) });
  await run(800);
  st.request('bottom', 'banner', { h: 42, make: make('banner', 'bottom', 42, 1000), maxWait: 1500 });
  await run(600);
  assert.equal(shown.length, 2, 'the banner got the lane');
  assert.ok(shown[0].end != null && shown[0].end <= shown[1].at, 'the caption exited first');
  // a caption that cannot get the lane in time is dropped (null)
  const late = st.request('bottom', 'caption', { h: 86, make: make('caption', 'bottom', 86, 2000), maxWait: 100 });
  st.claim('bottom', 'combo', new Promise(() => {}), () => true);
  await run(400);
  assert.equal(await late, null);
});

test('no lane (small phones): overlays fall back to the board edge, one at a time', async () => {
  const { st, make, run, shown } = setup({ top: { y: 80, h: 20 }, bottom: { y: 450, h: MIN_LANE - 1 } });
  assert.equal(st.lane('top'), null);
  assert.equal(st.lane('bottom'), null);
  st.request('bottom', 'banner', { h: 42, make: make('banner', 'bottom', 42, 900) });
  st.request('bottom', 'caption', { h: 60, make: make('caption', 'bottom', 60, 900), maxWait: 2000 });
  await run(2200);
  assert.equal(shown.length, 2);
  assert.equal(shown[0].y, undefined, 'the overlay picks its board-edge spot');
  assert.ok(!overlapsInTime(shown[0], shown[1]));
});

test('request() resolves when the overlay SHOWS (not when it ends) and never rejects', async () => {
  const { st, make, run } = setup({ top: { y: 90, h: 92 }, bottom: null });
  let got = null;
  st.request('top', 'banner', { h: 42, make: make('banner', 'top', 42, 5000) }).then((r) => (got = r));
  await run(50);
  assert.ok(got && got.overlay, 'resolved at once with { overlay }');
  const bad = await st.request('bottom', 'caption', {
    h: 60,
    maxWait: 0,
    make: () => {
      throw new Error('boom');
    },
  });
  assert.equal(bad, null);
});
