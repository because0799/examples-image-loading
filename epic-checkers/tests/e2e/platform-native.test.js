// Platform bridge: settings.haptics gate for every vibrate() (UI, Director …), light patterns,
// the Android amplitude path.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createNative, lightPattern, LIGHT_HAPTICS, HAPTICS } from '../../src/platform/native.js';

function androidWin() {
  const calls = [];
  const win = {
    AndroidBridge: {
      vibrate: (spec) => calls.push(['vibrate', spec]),
      vibrateLevel: (spec, amp) => calls.push(['vibrateLevel', spec, amp]),
    },
  };
  return { win, calls };
}

test("haptics 'strong' (default) passes patterns through unchanged", () => {
  const { win, calls } = androidWin();
  const n = createNative(win);
  assert.equal(n.haptics, 'strong');
  n.vibrate([42, 28, 66]);
  n.vibrate(30);
  assert.deepEqual(calls, [
    ['vibrate', '[42,28,66]'],
    ['vibrate', '30'],
  ]);
});

test("haptics 'off' silences every vibration (a cancel still passes)", () => {
  const { win, calls } = androidWin();
  const n = createNative(win);
  n.setHaptics('off');
  calls.length = 0; // setHaptics('off') cancels a rumble that may still play
  assert.equal(n.vibrate([80, 60, 260]), false);
  assert.equal(n.haptic('win'), false);
  assert.deepEqual(calls, []);
  n.vibrate(0);
  assert.deepEqual(calls, [['vibrate', '0']]);
  assert.equal(n.setHaptics(false), 'off', 'old boolean vibration:false');
  assert.equal(n.setHaptics(true), 'strong');
  assert.equal(n.setHaptics('bogus'), 'strong');
});

test("haptics 'light': short pulses, at most 3, weak amplitude on Android", () => {
  const { win, calls } = androidWin();
  const n = createNative(win);
  n.setHaptics('light');
  n.vibrate(HAPTICS.ultimate); // [60,30,60,30,60,40,220]
  assert.equal(calls.length, 1);
  const [kind, spec, amp] = calls[0];
  assert.equal(kind, 'vibrateLevel');
  assert.equal(amp, LIGHT_HAPTICS.amplitude);
  const p = JSON.parse(spec);
  assert.deepEqual(p, [28, 30, 28, 30, 28]);
  // without the amplitude method (older APK): the plain call with the light pattern
  const calls2 = [];
  const n2 = createNative({ AndroidBridge: { vibrate: (s) => calls2.push(s) } });
  n2.setHaptics('light');
  n2.vibrate(200);
  assert.deepEqual(calls2, ['28']);
});

test('lightPattern is idempotent (an already softened pattern is not softened twice)', () => {
  for (const p of [[10], [42, 28, 66], [60, 30, 60, 30, 60, 40, 220], [2, 50, 3]]) {
    const once = lightPattern(p);
    assert.deepEqual(lightPattern(once), once);
    for (let i = 0; i < once.length; i += 2) assert.ok(once[i] === 0 || (once[i] >= LIGHT_HAPTICS.min && once[i] <= LIGHT_HAPTICS.max));
    assert.equal(once.length % 2, 1, 'ends on a pulse');
  }
});

test('web fallback: navigator.vibrate gets the gated pattern', () => {
  const calls = [];
  const win = { navigator: { vibrate: (p) => (calls.push(p), true), userActivation: { hasBeenActive: true } } };
  const n = createNative(win);
  n.setHaptics('light');
  n.vibrate([100, 50, 100]);
  n.setHaptics('off');
  n.vibrate([100, 50, 100]);
  assert.deepEqual(calls, [[28, 50, 28], 0]);
});
