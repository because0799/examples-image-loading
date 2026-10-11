// Fill-saving board geometry: EdgeFrame (9-slice without the hidden centre) and the seam-glow
// strips (disjoint sub-rectangles that cover every glowing texel exactly once).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Texture, TextureSource } from 'pixi.js';
import { EdgeFrame } from '../../src/render/edge-frame.js';
import { seamStripRects } from '../../src/render/board-view.js';

const overlap = (a, b) => {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return w > 1e-6 && h > 1e-6 ? w * h : 0;
};
const contains = (r, x, y) => x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3];

function frameRects(f) {
  return f.parts.filter((p) => p.visible).map((p) => [p.x, p.y, p.width, p.height]);
}

test('EdgeFrame: 8 disjoint parts covering only the border band (corner c, edge e)', () => {
  const src = new TextureSource({ width: 60, height: 60, resolution: 1 });
  const tex = new Texture({ source: src });
  const f = new EdgeFrame();
  f.setTexture(tex, 25, 12);
  f.setSize(400, 300);
  const rects = frameRects(f);
  assert.equal(rects.length, 8);
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) assert.equal(overlap(rects[i], rects[j]), 0, `parts ${i} and ${j} overlap`);
  // outer edge fully covered, the middle is a hole
  for (const [x, y] of [[0, 0], [399, 0], [200, 1], [1, 150], [398, 150], [200, 298], [399, 299], [24, 24], [11, 100]]) {
    assert.ok(rects.some((r) => contains(r, x, y)), `outer point ${x},${y} covered`);
  }
  for (const [x, y] of [[200, 150], [13, 100], [200, 13], [386, 150]]) {
    assert.ok(!rects.some((r) => contains(r, x, y)), `inner point ${x},${y} not drawn`);
  }
  const area = rects.reduce((a, r) => a + r[2] * r[3], 0);
  assert.ok(Math.abs(area - f.coveredArea) < 1e-6);
  assert.ok(area < 400 * 300 * 0.3, 'much less fill than the full quad');
  // the edge slices sample the texture's middle band only
  const top = f.parts[1].texture.frame;
  assert.deepEqual([top.x, top.y, top.width, top.height], [25, 0, 10, 12]);
  f.tint = 0xff0000;
  assert.ok(f.parts.every((p) => p.tint === 0xff0000));
  f.blendMode = 'add';
  assert.ok(f.parts.every((p) => p.blendMode === 'add'));
  f.destroy();
});

test('EdgeFrame: a frame no larger than its corners hides the stretched edges', () => {
  const tex = new Texture({ source: new TextureSource({ width: 40, height: 40 }) });
  const f = new EdgeFrame();
  f.setTexture(tex, 15);
  f.setSize(30, 30);
  assert.equal(f.parts[1].visible, false);
  assert.equal(f.parts[3].visible, false);
  f.setSize(100, 30);
  assert.equal(f.parts[1].visible, true);
  assert.equal(f.parts[3].visible, false);
});

const LAYOUTS = [
  { n: 8, sq: 44, fw: 16 },
  { n: 8, sq: 36, fw: 14 },
  { n: 10, sq: 33, fw: 12 },
  { n: 12, sq: 27, fw: 11 },
  { n: 8, sq: 70, fw: 30 },
].map((L) => ({ ...L, total: L.n * L.sq + 2 * L.fw }));

test('seam strips are pairwise disjoint and inside the texture', () => {
  for (const L of LAYOUTS) {
    const rects = seamStripRects(L);
    assert.ok(rects, `strips for ${JSON.stringify(L)}`);
    assert.equal(rects.length, 4 + (L.n - 1) + (L.n - 1) * L.n);
    for (const r of rects) {
      assert.ok(r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= L.total + 1e-6 && r[1] + r[3] <= L.total + 1e-6);
    }
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) assert.equal(overlap(rects[i], rects[j]), 0, `${i}/${j} overlap (n=${L.n})`);
  }
});

test('seam strips cover every glowing texel: all grid lines (± the widest glow) and the border', () => {
  for (const L of LAYOUTS) {
    const { n, sq, fw } = L;
    const rects = seamStripRects(L);
    const covered = (x, y) => rects.some((r) => contains(r, x, y));
    const half = Math.max(4, sq * 0.22) / 2; // widest line pass
    for (let i = 1; i < n; i++) {
      const c = fw + i * sq;
      for (let k = 0; k <= 40; k++) {
        const u = fw + (k / 40) * n * sq * 0.999;
        for (const d of [-half, -half / 2, 0, half / 2, half - 0.01]) {
          assert.ok(covered(c + d, u), `vertical line ${i} at ${u} (+${d})`);
          assert.ok(covered(u, c + d), `horizontal line ${i} at ${u} (+${d})`);
        }
      }
    }
    const off = Math.max(1, fw * 0.07) * 1.5;
    const hbw = Math.max(6, fw * 0.5) / 2;
    const a = fw - off;
    const b = fw + n * sq + off;
    for (let k = 0; k <= 40; k++) {
      const u = a + ((b - a) * k) / 40;
      for (const d of [-hbw, 0, hbw - 0.01]) {
        assert.ok(covered(u, a + d) && covered(u, b + d) && covered(a + d, u) && covered(b + d, u), `border at ${u}`);
      }
    }
    const area = rects.reduce((s, r) => s + r[2] * r[3], 0);
    assert.ok(area < L.total * L.total * 0.62, `strips cover ${((100 * area) / (L.total * L.total)).toFixed(0)} % of the quad`);
  }
});

test('seam strips fall back to the full quad on a degenerate board', () => {
  assert.equal(seamStripRects({ n: 8, sq: 6, fw: 6, total: 60 }), null);
  assert.equal(seamStripRects({ n: 1, sq: 40, fw: 10, total: 60 }), null);
});
