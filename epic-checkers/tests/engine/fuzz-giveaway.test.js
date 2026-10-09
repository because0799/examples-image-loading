// Random-playout fuzzing: ≥ 200 random games per variant in giveaway mode, every legal
// move of every ply is applied and checked (see fuzz-lib.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { E } from './util.js';
import { GAMES, runGames } from './fuzz-lib.js';

for (const v of E.VARIANTS) {
  test(`fuzz ${v.id} (giveaway): ${GAMES} random games keep all invariants`, () => {
    const stats = runGames(v, true);
    const total = Object.values(stats.reasons).reduce((a, b) => a + b, 0);
    assert.equal(total, GAMES);
    console.log(`  ${v.id}/giveaway: avg ${stats.avg} plies, max ${stats.maxPlies}`, stats.reasons);
  });
}
