// Level 5 must beat level 1 in a short match (both colours) on Russian, Turkish and English.
import test from 'node:test';
import assert from 'node:assert/strict';
import { E, playGame } from './helpers.js';
import { search } from '../../src/ai/search.js';

const GAMES = Number(process.env.AI_MATCH_GAMES || 4);
// Level 5 search with a reduced clock to keep the test short (it is still far ahead of level 1).
const L5_MS = Number(process.env.AI_MATCH_MS || 80);

for (const id of ['russian', 'turkish', 'english']) {
  test(`${id}: level 5 beats level 1 (${GAMES} games, both colours)`, () => {
    let seed = 1000;
    const strong = (g) => search(g.state, { level: 5, timeMs: L5_MS, historyHashes: g.hashes, seed: seed++ }).path;
    const weak = (g) => search(g.state, { level: 1, historyHashes: g.hashes, seed: seed++ }).path;
    const tally = { strong: 0, weak: 0, draw: 0 };
    const lines = [];
    for (let i = 0; i < GAMES; i++) {
      const strongWhite = i % 2 === 0;
      const { result, plies } = playGame(id, strongWhite ? strong : weak, strongWhite ? weak : strong, { maxPlies: 1500 });
      assert.ok(result, 'game finished');
      const strongColor = strongWhite ? 1 : -1;
      if (result.winner === 0) tally.draw++;
      else if (result.winner === strongColor) tally.strong++;
      else tally.weak++;
      lines.push(`${strongWhite ? 'L5 white' : 'L5 black'}: ${result.winner === strongColor ? 'win' : result.winner === 0 ? 'draw' : 'LOSS'} (${result.reason}, ${plies} plies)`);
    }
    console.log(`  ${id} L5 vs L1: +${tally.strong} =${tally.draw} -${tally.weak} | ${lines.join('; ')}`);
    assert.equal(tally.weak, 0, 'level 1 never wins');
    assert.ok(tally.strong >= Math.ceil(GAMES * 0.75), `level 5 wins most games (${tally.strong}/${GAMES})`);
  });
}
