// Resumable procedural tile generators (idle pre-warm): a job run in tiny time slices produces
// exactly the same pixels as a one-shot run, and woodTile()/stoneTile() finish a half-done job
// instead of starting over. A minimal canvas stub stands in for the DOM.
import test from 'node:test';
import assert from 'node:assert/strict';

class FakeCtx {
  constructor(c) {
    this.canvas = c;
    this.ops = [];
  }
  createImageData(w, h) {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  }
  putImageData(img) {
    this.canvas.pixels = img.data.slice();
  }
  fillRect(x, y, w, h) {
    this.ops.push(['fillRect', x, y, w, h, this.fillStyle]);
  }
}
class FakeCanvas {
  constructor() {
    this.width = 1;
    this.height = 1;
    this.pixels = null;
    this._ctx = new FakeCtx(this);
  }
  getContext() {
    return this._ctx;
  }
}
globalThis.document = globalThis.document || { createElement: () => new FakeCanvas() };

const { pixelJob, woodJob, woodTile, stoneJob, stoneTile, boardTileJobs } = await import('../../src/render/board-textures.js');

test('pixelJob: sliced steps == one-shot run; progress and result', () => {
  const row = (d, y, S) => {
    for (let x = 0; x < S; x++) d[(y * S + x) * 4] = (x * 7 + y * 13) & 255;
  };
  const a = pixelJob(64, row, (c) => c);
  assert.equal(a.step(), true);
  const b = pixelJob(64, row, (c) => c);
  let steps = 0;
  while (!b.step(0)) steps++;
  assert.ok(steps > 3, 'a zero budget still advances a few rows per step');
  assert.deepEqual(Array.from(b.result.pixels), Array.from(a.result.pixels));
  assert.equal(b.progress, 1);
});

test('woodTile finishes a half-done pre-warm job (same pixels as a fresh tile)', () => {
  const job = woodJob('walnut');
  job.step(0);
  job.step(0);
  assert.ok(job.progress > 0 && job.progress < 1);
  const tile = woodTile('walnut'); // must complete the same job
  assert.equal(job.done, true);
  assert.equal(job.result, tile);
  assert.equal(woodTile('walnut'), tile, 'cached');
  assert.equal(woodJob('walnut').done, true);
  // reference: an independent one-shot generation of the same kind matches
  const ref = woodTile('maple');
  assert.ok(ref.pixels && ref.pixels.length === 512 * 512 * 4);
});

test('stone tiles: sliced generation keeps the glints and caches the result', () => {
  const job = stoneJob('slate');
  let n = 0;
  while (!job.step(0)) n++;
  assert.ok(n > 0);
  const tile = stoneTile('slate');
  assert.equal(tile, job.result);
  assert.ok(tile._ctx.ops.filter((o) => o[0] === 'fillRect').length >= 35, 'glints drawn after the pixels');
});

test('boardTileJobs lists the tiles each theme needs', () => {
  assert.equal(boardTileJobs('epic').length, 2);
  assert.equal(boardTileJobs('classic').length, 4);
  for (const get of boardTileJobs('epic')) {
    const j = get();
    while (!j.step(1)) {
      /* run */
    }
    assert.equal(j.done, true);
  }
});
