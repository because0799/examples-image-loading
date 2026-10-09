// ParticleSystem: pooling, caps, kinematics, colour packing and every burst preset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Container, Texture } from 'pixi.js';
import { ParticleSystem, BURSTS, emitBurst } from '../../src/fx/particles.js';

const tex = new Texture();
const textures = { atlas: tex, frame: () => tex };

function sys(cap = 100) {
  const ps = new ParticleSystem({ textures, cap });
  const L = ps.layers(new Container());
  return { ps, L };
}

test('layers() returns one normal+add pair per parent', () => {
  const ps = new ParticleSystem({ textures, cap: 10 });
  const parent = new Container();
  const a = ps.layers(parent);
  assert.equal(ps.layers(parent), a);
  assert.equal(parent.children.length, 2);
  assert.equal(parent.children[0], a.normal.pc, 'normal under add');
  assert.equal(a.add.pc.blendMode, 'add');
});

test('cap is enforced and dead particles are pooled', () => {
  const { ps, L } = sys(4);
  const got = [];
  for (let i = 0; i < 10; i++) got.push(ps.spawn(L.add, tex));
  assert.equal(got.filter(Boolean).length, 4);
  assert.equal(ps.count, 4);
  for (const p of got.filter(Boolean)) p.life = 0.01;
  ps.update(50, 50);
  assert.equal(ps.count, 0);
  assert.equal(L.add.list.length, 0);
  const again = ps.spawn(L.add, tex);
  assert.ok(got.includes(again), 'pooled object reused');
  assert.equal(again.age, 0, 'reset on reuse');
});

test('setCap trims live particles', () => {
  const { ps, L } = sys(20);
  for (let i = 0; i < 12; i++) ps.spawn(i % 2 ? L.add : L.normal, tex);
  ps.setCap(5);
  assert.equal(ps.count, 5);
  assert.equal(L.add.list.length + L.normal.list.length, 5);
});

test('velocity + gravity integrate on game time; realtime particles ignore slow-mo', () => {
  const { ps, L } = sys();
  const p = ps.spawn(L.normal, tex);
  p.life = 10;
  p.ay = 10;
  ps.update(100, 100);
  ps.update(100, 100);
  assert.ok(Math.abs(p.vy - 2) < 1e-9);
  assert.ok(Math.abs(p.y - 0.3) < 1e-9);
  const q = ps.spawn(L.normal, tex);
  q.life = 10;
  q.vx = 100;
  q.rt = true;
  ps.update(0, 100); // frozen game time (hit-stop)
  assert.ok(Math.abs(q.x - 10) < 1e-9);
  assert.ok(Math.abs(p.vy - 2) < 1e-9, 'game-time particle frozen');
});

test('colour + alpha are packed as ABGR', () => {
  const { ps, L } = sys();
  const p = ps.spawn(L.add, tex);
  p.life = 10;
  p.a0 = 1;
  p.fout = 1;
  p.colors(0xff0000);
  ps.update(16, 16);
  assert.equal(p.color >>> 0, 0xff0000ff);
  p.colors(0x00ff00, 0x0000ff, 0x0000ff, 0.5);
  p.age = 0;
  p.life = 1;
  ps.update(500, 500); // k = 0.5 → mid colour (blue)
  assert.equal(p.color & 0xffffff, 0xff0000);
});

test('orbit particles circle their centre and spiral inward', () => {
  const { ps, L } = sys();
  const p = ps.spawn(L.add, tex);
  p.life = 10;
  p.orb = true;
  p.ox = 50;
  p.oy = 50;
  p.or = 20;
  p.ova = Math.PI; // half a turn per second
  p.ovr = -10;
  ps.update(1000, 1000);
  assert.ok(Math.abs(p.x - (50 - 10)) < 1e-6);
  assert.ok(Math.abs(p.y - 50) < 1e-6);
});

test('every burst preset spawns sane particles in both modes and respects the cap', () => {
  for (const epic of [true, false]) {
    for (const kind of Object.keys(BURSTS)) {
      const { ps, L } = sys(60);
      emitBurst(ps, L, kind, 100, 100, { color: 0x29e6ff, count: 30 }, { epic, mul: 1, sq: 40, T: textures });
      assert.ok(ps.count > 0, `${kind} epic=${epic} spawned`);
      assert.ok(ps.count <= 60);
      for (const l of [L.add, L.normal]) {
        for (const p of l.list) {
          assert.ok(p.life > 0 && Number.isFinite(p.life), `${kind} life`);
          assert.ok(Number.isFinite(p.vx) && Number.isFinite(p.vy), `${kind} velocity`);
        }
      }
      for (let i = 0; i < 400; i++) ps.update(16, 16);
      assert.equal(ps.count, 0, `${kind} epic=${epic} all particles die`);
    }
  }
});

test('unknown kinds fall back to sparks', () => {
  const { ps, L } = sys(200);
  emitBurst(ps, L, 'nope', 0, 0, {}, { epic: true, mul: 1, sq: 40, T: textures });
  assert.ok(ps.count > 0);
});
