// AI-vs-AI full games for EVERY variant (and giveaway for several) must terminate — by a result
// or a draw rule — without errors, every move legal (Game.play throws on illegal moves).
import test from 'node:test';
import assert from 'node:assert/strict';
import { E, playGame } from './helpers.js';
import { search } from '../../src/ai/search.js';

const MOVE_MS = Number(process.env.AI_GAME_MS || 15);
const PLY_CAP = 3000;

function runGame(id, giveaway, seed0) {
  let seed = seed0;
  let slowest = 0;
  let nodes = 0;
  let ms = 0;
  const ai = (level) => (g) => {
    const r = search(g.state, { level, timeMs: MOVE_MS, historyHashes: g.hashes, seed: seed++ });
    slowest = Math.max(slowest, r.timeMs);
    nodes += r.nodes;
    ms += r.timeMs;
    assert.ok(r.path, 'a move is returned while the game goes on');
    return r.path;
  };
  const t0 = Date.now();
  const { result, plies, game } = playGame(id, ai(3), ai(4), { giveaway, maxPlies: PLY_CAP });
  const wall = Date.now() - t0;
  assert.ok(result, `${id}${giveaway ? ' giveaway' : ''}: game ended within ${PLY_CAP} plies`);
  assert.ok(['no-pieces', 'no-moves', 'repetition', 'move-limit', 'insufficient'].includes(result.reason));
  assert.equal(game.history.length, plies);
  // The search stops at its wall-clock deadline; on a loaded machine the process can still be
  // descheduled for a while, so this only guards against real hangs (precise checks: timing.test.js).
  assert.ok(slowest <= MOVE_MS + 1500, `no move took far beyond the limit (slowest ${slowest} ms)`);
  const nps = ms > 0 ? Math.round((nodes * 1000) / ms) : 0;
  console.log(
    `  ${id.padEnd(13)}${giveaway ? ' (giveaway)' : '           '} ${result.winner === 1 ? 'white wins' : result.winner === -1 ? 'black wins' : 'draw      '} by ${result.reason.padEnd(11)} after ${String(plies).padStart(3)} plies, ${wall} ms, ${nps} nodes/s, slowest move ${slowest} ms`,
  );
}

for (const v of E.VARIANTS) {
  test(`AI vs AI full game terminates: ${v.id}`, () => runGame(v.id, false, 31 + v.size));
}

for (const id of ['russian', 'turkish', 'international', 'english', 'italian']) {
  test(`AI vs AI full game terminates: ${id} giveaway`, () => runGame(id, true, 77));
}
