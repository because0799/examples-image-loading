// Fuzz: 250 battles of random legal step actions (exercises paths the AI rarely takes: declined free
// moves, swaps, quirk actions, Wait spam...). Every action is checked (see fuzz-lib.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeJob, playJob } from './fuzz-lib.js';

test('fuzz: 250 random-action battles — no exceptions, termination, sane HP, events consistent with state', () => {
  let finished = 0;
  for (let k = 0; k < 250; k++) {
    const { result } = playJob(makeJob(90000 + k), 'random');
    if (result) finished++;
  }
  assert.equal(finished, 250);
});
