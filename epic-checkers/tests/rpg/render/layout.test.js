// Battle view geometry (src/rpg/render/layout.js): fitting, square centres and taps (normal and
// flipped), diagonal helpers, camera focus maths and cover fitting. Pure, no Pixi.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  N, computeLayout, isDarkSq, displayRC, sqCenter, sqAt, sqDist, between, onDiagonal, diagonalRays, safeRectFor, focusFor, coverFit,
} from '../../../src/rpg/render/layout.js';

const RECT = { x: 0, y: 160, width: 390, height: 520 };

test('computeLayout: square board centred in the slot, squares snapped to device pixels', () => {
  for (const res of [1, 2, 3]) {
    const L = computeLayout(RECT, { resolution: res });
    assert.equal(L.n, N);
    assert.ok(L.total <= Math.min(RECT.width, RECT.height) + 1e-9, 'fits the slot');
    assert.ok(Math.abs(L.sq * res - Math.round(L.sq * res)) < 1e-9, 'sq is a whole number of device pixels');
    assert.ok(L.fw > 0 && L.fw < L.sq, 'frame narrower than a square');
    assert.ok(Math.abs(L.cx - (RECT.x + RECT.width / 2)) <= 1, 'centred horizontally');
    assert.ok(Math.abs(L.cy - (RECT.y + RECT.height / 2)) <= 1, 'centred vertically');
    assert.equal(L.bx, L.x + L.fw);
    assert.equal(L.by, L.y + L.fw);
    assert.ok(Math.abs(L.total - (8 * L.sq + 2 * L.fw)) < 1e-9);
  }
  // degenerate rect → a sane default instead of NaN
  const D = computeLayout(null);
  assert.ok(D.sq > 0 && Number.isFinite(D.x));
});

test('dark squares are the playable ones: (row + col) odd, 32 of them', () => {
  let n = 0;
  for (let q = 0; q < 64; q++) if (isDarkSq(q)) n++;
  assert.equal(n, 32);
  assert.equal(isDarkSq(1), true);
  assert.equal(isDarkSq(0), false);
  assert.equal(isDarkSq(-1), false);
  assert.equal(isDarkSq(64), false);
});

test('sqCenter ↔ sqAt round-trip on every square, normal and flipped', () => {
  const L = computeLayout(RECT, { resolution: 2 });
  for (const flipped of [false, true]) {
    for (let q = 0; q < 64; q++) {
      const p = sqCenter(L, q, flipped);
      assert.equal(sqAt(L, p.x, p.y, flipped, 0), q, `exact ${q} flipped=${flipped}`);
      assert.equal(sqAt(L, p.x, p.y, flipped), q, `tolerant ${q} flipped=${flipped}`);
    }
  }
  // flipped puts square 0 at the bottom-right
  const a = sqCenter(L, 0, true);
  assert.ok(a.x > L.cx && a.y > L.cy);
  const rc = displayRC(0, true);
  assert.deepEqual(rc, { row: 7, col: 7 });
  // sqCenter writes into `out` (no allocation in hot paths)
  const out = { x: 0, y: 0 };
  assert.equal(sqCenter(L, 9, false, out), out);
});

test('sqAt: taps on a light square near a dark one snap to it; far outside the board → -1', () => {
  const L = computeLayout(RECT, { resolution: 1 });
  // light square (0, 0); its right neighbour (0, 1) = sq 1 is dark
  const x = L.bx + 0.9 * L.sq;
  const y = L.by + 0.5 * L.sq;
  assert.equal(sqAt(L, x, y, false, 0), 0, 'exact: the light square');
  assert.equal(sqAt(L, x, y), 1, 'tolerant: snaps to the dark neighbour');
  // the middle of a light square stays light (no snapping across half a square)
  assert.equal(sqAt(L, L.bx + 0.5 * L.sq, L.by + 0.5 * L.sq), 0);
  // just outside the frame counts for the edge square, far outside does not
  assert.equal(sqAt(L, L.bx + 1.5 * L.sq, L.by - 0.1 * L.sq), 1);
  assert.equal(sqAt(L, L.bx + 1.5 * L.sq, L.by - 2 * L.sq), -1);
  assert.equal(sqAt(null, 0, 0), -1);
});

test('diagonal helpers', () => {
  const sq = (r, c) => r * 8 + c;
  assert.equal(sqDist(sq(0, 1), sq(3, 4)), 3);
  assert.deepEqual(between(sq(0, 1), sq(3, 4)), [sq(1, 2), sq(2, 3)]);
  assert.deepEqual(between(sq(0, 1), sq(1, 2)), []);
  assert.deepEqual(between(sq(0, 1), sq(0, 5)), [], 'not diagonal');
  assert.equal(onDiagonal(sq(2, 3), sq(5, 0)), true);
  assert.equal(onDiagonal(sq(2, 3), sq(2, 5)), false);
  assert.equal(onDiagonal(sq(2, 3), sq(2, 3)), false);
  const rays = diagonalRays(sq(3, 4));
  assert.equal(rays.length, 4);
  for (const ray of rays) for (const q of ray) assert.ok(onDiagonal(sq(3, 4), q) && isDarkSq(q) === isDarkSq(sq(3, 4)));
  assert.equal(rays.reduce((n, r) => n + r.length, 0), 13, 'a centre square sees 13 diagonal squares');
  assert.deepEqual(diagonalRays(sq(0, 1), 2)[3], [sq(1, 2), sq(2, 3)]);
});

test('focusFor: the camera maps the focused world point to the board centre at any zoom', () => {
  const anchor = { x: 195, y: 420 };
  const cx = 195;
  const cy = 400;
  for (const zoom of [1, 1.15, 1.6]) {
    const p = { x: 80, y: 250 };
    const f = focusFor(p.x, p.y, zoom, anchor, cx, cy);
    // Renderer.worldToScreen with camera offset o = f − anchor: s = anchor + (p − (anchor + o)) · zoom
    const sx = anchor.x + (p.x - f.x) * zoom;
    const sy = anchor.y + (p.y - f.y) * zoom;
    assert.ok(Math.abs(sx - cx) < 1e-9 && Math.abs(sy - cy) < 1e-9);
  }
});

test('safeRectFor stays on screen; coverFit covers the screen and keeps the focal point', () => {
  const L = computeLayout(RECT);
  const R = safeRectFor(L, { width: 390, height: 844 });
  assert.ok(R.x >= 0 && R.y >= 0 && R.x + R.width <= 390 && R.y + R.height <= 844);
  assert.ok(R.y < L.y && R.y + R.height > L.y + L.total, 'margin above and below the board');
  const c = coverFit(1024, 1536, 390, 844, 0.5, 0.56);
  assert.ok(c.width >= 390 && c.height >= 844);
  assert.ok(c.x <= 0 && c.y <= 0 && c.x + c.width >= 390 && c.y + c.height >= 844, 'no uncovered edge');
});
