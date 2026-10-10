// Renderer.squareAt touch tolerance (MUX-11) and exception-safe frame (F2). Headless: the Renderer
// is constructed but never init()ed — the layout is computed directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer } from '../../src/render/renderer.js';

function make(size, playable = 'dark', flipped = false) {
  const r = new Renderer({ clientWidth: 360, clientHeight: 640 });
  r.variant = { size, playable };
  r.flipped = flipped;
  r._rect = { x: 0, y: 100, width: 360, height: 360 };
  r.layout = r._computeLayout();
  r.squareSize = r.layout.sq;
  r.boardCenter.x = r.layout.x + r.layout.total / 2;
  r.boardCenter.y = r.layout.y + r.layout.total / 2;
  return r;
}

/** Screen point at (col + u, row + v) in display squares. */
function at(r, col, row, u = 0.5, v = 0.5) {
  const L = r.layout;
  return [L.bx + (col + u) * L.sq, L.by + (row + v) * L.sq];
}

test('exact taps map to their square (normal and flipped)', () => {
  for (const flipped of [false, true]) {
    const r = make(10, 'dark', flipped);
    for (const [c, rw] of [[0, 0], [3, 4], [9, 9]]) {
      const sq = r.squareAt(...at(r, c, rw));
      const d = r.sqToDisplay(sq);
      assert.deepEqual([d.col, d.row], [c, rw]);
    }
  }
});

test('10x10: a tap on a light square near a dark square snaps to it; the centre stays light', () => {
  const r = make(10);
  // display (row 0, col 0) is light on International (dark parity 1), (0,1) is dark
  assert.equal(r.isDarkSquare(r.squareAt(...at(r, 0, 0), { tolerance: 0 })), false);
  const near = r.squareAt(...at(r, 0, 0, 0.8, 0.5)); // 0.2 square from the dark (0,1)
  assert.equal(near, 1);
  assert.equal(r.isDarkSquare(near), true);
  const below = r.squareAt(...at(r, 2, 0, 0.5, 0.75)); // 0.25 from dark (1,2)
  assert.equal(below, 12);
  const centre = r.squareAt(...at(r, 0, 0));
  assert.equal(r.isDarkSquare(centre), false, 'the middle of a light square is not snapped');
  assert.equal(r.squareAtExact(...at(r, 0, 0, 0.8, 0.5)), 0);
});

test('taps slightly outside the board count for the edge square; far outside is -1', () => {
  const r = make(12);
  const L = r.layout;
  const [x, y] = at(r, 11, 5);
  assert.equal(r.squareAt(L.bx + L.n * L.sq + L.sq * 0.2, y), r.squareAt(x, y));
  assert.equal(r.squareAt(L.bx + L.n * L.sq + L.sq * 0.6, y), -1);
  assert.equal(r.squareAt(L.bx - L.sq, L.by - L.sq), -1);
});

test('all-squares variants (Turkish) never snap to a neighbour', () => {
  const r = make(8, 'all');
  for (const u of [0.1, 0.5, 0.9]) {
    const sq = r.squareAt(...at(r, 3, 3, u, 0.5));
    assert.equal(sq, 3 * 8 + 3);
  }
});

test('the frame is exception-safe: a throwing stage does not escape _tick', () => {
  const r = make(8);
  r.camera.update = () => {};
  r.camera.apply = () => {};
  r.boardView = { update: () => { throw new Error('board'); } };
  r.highlights = { update: () => {} };
  r._live = [{ update: () => { throw new Error('piece'); } }];
  let ok = 0;
  r.clock.add(() => ok++);
  const orig = console.error;
  console.error = () => {};
  try {
    r._tick({ deltaMS: 16 });
    r._tick({ deltaMS: 16 });
  } finally {
    console.error = orig;
  }
  assert.equal(ok, 2);
  assert.ok(r.frameErrors >= 4);
});
