// Fuzz part 1/4: 125 AI-vs-AI battles (500 in total across fuzz-ai-1..4) with random squads, levels,
// constellations and campaign stages. Every action is checked (see fuzz-lib.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeJob, playJob } from './fuzz-lib.js';

test('fuzz: 125 AI-vs-AI battles (part 1/4) — no exceptions, termination, sane HP, events consistent with state', () => {
  const reasons = {};
  for (let k = 0; k < 125; k++) {
    const job = makeJob(1000 + k);
    const { result } = playJob(job, 'ai');
    reasons[result.reason] = (reasons[result.reason] || 0) + 1;
  }
  assert.ok((reasons.annihilation || 0) > 60, JSON.stringify(reasons));
});
