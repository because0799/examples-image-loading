import test from 'node:test';
import assert from 'node:assert/strict';
import { Clock } from '../../src/render/tween.js';
import { Camera } from '../../src/render/camera.js';

function setup() {
  const clock = new Clock();
  const renderer = { clock, boardCenter: { x: 200, y: 400 }, screen: { width: 390, height: 844 } };
  const cam = new Camera(renderer);
  const world = {
    pivot: { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } },
    position: { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } },
    scale: { x: 1, y: 1, set(x, y) { this.x = x; this.y = y; } },
    rotation: 0,
  };
  const step = (ms) => {
    for (let t = 0; t < ms; t += 16) {
      clock.update(16);
      cam.update(clock.realDelta, clock.delta);
      cam.apply(world);
    }
  };
  return { clock, cam, world, step };
}

test('identity at rest maps world == screen', () => {
  const { cam, world, step } = setup();
  step(16);
  assert.equal(world.pivot.x, 200);
  assert.equal(world.position.x, 200);
  assert.equal(world.scale.x, 1);
  assert.ok(cam.idle);
});

test('focus brings a world point to the board centre with zoom; reset returns', async () => {
  const { cam, world, step } = setup();
  const p = cam.focus(260, 380, 1.5, 200);
  step(240);
  assert.equal(await p, true);
  assert.equal(world.pivot.x, 260);
  assert.equal(world.pivot.y, 380);
  assert.equal(world.scale.x, 1.5);
  cam.reset(200);
  step(240);
  assert.ok(cam.idle);
});

test('shake decays smoothly to zero and is capped when stacked', () => {
  const { cam, step } = setup();
  for (let i = 0; i < 8; i++) cam.shake(1, 600);
  let maxMag = 0;
  let prevX = 0;
  let maxJump = 0;
  for (let t = 0; t < 640; t += 16) {
    step(16);
    const m = Math.hypot(cam.shakeX, cam.shakeY);
    maxMag = Math.max(maxMag, m);
    maxJump = Math.max(maxJump, Math.abs(cam.shakeX - prevX));
    prevX = cam.shakeX;
  }
  assert.ok(maxMag <= cam.unitShake * 1.8 + 1e-6, `capped: ${maxMag}`);
  assert.ok(maxMag > 5, 'visible');
  assert.equal(cam.shakeX, 0);
  assert.equal(cam.shakeY, 0);
  assert.ok(Math.abs(cam.shakeRot) < 1e-9);
});

test('shake keeps running during hit-stop (real time by default)', () => {
  const { cam, clock, step } = setup();
  clock.setScale(0);
  cam.shake(0.5, 300);
  let any = 0;
  for (let i = 0; i < 6; i++) {
    step(16);
    any = Math.max(any, Math.abs(cam.shakeX) + Math.abs(cam.shakeY));
  }
  assert.ok(any > 0.5);
});

test('punch pulses zoom and returns to exactly 1', async () => {
  const { cam, world, step } = setup();
  const p = cam.punch(1.1, 200);
  step(48);
  assert.ok(world.scale.x > 1.03);
  step(200);
  await p;
  assert.equal(cam.punchScale, 1);
});
