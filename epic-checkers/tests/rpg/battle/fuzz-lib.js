// Fuzz harness: AI-vs-AI (or random-action) battles with random squads, levels, constellations and
// campaign stages. After EVERY action it checks the state invariants (HP never NaN / negative, energy
// in range, no overlapping pieces, ...) and that the event stream replays to the same state.
import { createBattle, legalActions, applyAction, battleResult } from '../../../src/rpg/battle/index.js';
import { chooseAction } from '../../../src/rpg/ai/index.js';
import { HEROES } from '../../../src/rpg/data/heroes.js';
import { CAMPAIGN } from '../../../src/rpg/data/rules.js';
import { makeRng } from '../../../src/rpg/battle/rng.js';
import { Shadow, invariants } from './shadow.js';

const IDS = HEROES.map((h) => h.id);
const STAGES = CAMPAIGN.flatMap((c) => c.stages);

function randomSquad(rng, size, level) {
  const out = [];
  const pool = IDS.slice();
  for (let i = 0; i < size; i++) {
    const dup = rng.next() < 0.05 && out.length;
    const heroId = dup ? out[rng.int(out.length)].heroId : pool.splice(rng.int(pool.length), 1)[0];
    out.push({ heroId, level: level != null ? level : 1 + rng.int(30), constellation: rng.next() < 0.5 ? 0 : rng.int(7) });
  }
  return out;
}

/** Enemy squad of a campaign stage (as meta would build it): enemies at the stage level, boss escorts. */
function stageSquad(stage, rng) {
  if (stage.boss) return [{ heroId: stage.bossHero, level: stage.level }, ...stage.escorts.map(([heroId, level]) => ({ heroId, level }))];
  if (stage.enemies === 'mirror') return randomSquad(rng, 6, stage.level);
  return stage.enemies.map((heroId) => ({ heroId, level: stage.level }));
}

/** One fuzz job description (deterministic for the seed). */
export function makeJob(seed) {
  const rng = makeRng(`fuzz:${seed}`);
  const useStage = rng.next() < 0.3;
  const stage = useStage ? STAGES[rng.int(STAGES.length)] : null;
  const sizeA = rng.next() < 0.7 ? 6 : 1 + rng.int(6);
  const sameLevel = rng.next() < 0.6 ? 1 + rng.int(30) : null;
  const a = randomSquad(rng, sizeA, stage ? stage.level : sameLevel);
  const b = stage ? stageSquad(stage, rng) : randomSquad(rng, rng.next() < 0.7 ? 6 : 1 + rng.int(6), sameLevel);
  const diffs = ['easy', 'normal', 'normal', 'normal'];
  const d1 = rng.next() < 0.03 ? 'hard' : diffs[rng.int(diffs.length)];
  const d2 = rng.next() < 0.03 ? 'boss' : diffs[rng.int(diffs.length)];
  return { seed, stage: stage ? stage.id : null, a, b, first: rng.next() < 0.5 ? 1 : -1, difficulty: { 1: d1, '-1': d2 } };
}

/**
 * Play one battle; throws on any violation. mode 'ai' (chooseAction for both sides) or 'random'.
 * Returns { result, steps, actions }.
 */
export function playJob(job, mode = 'ai', o = {}) {
  const rng = makeRng(`play:${job.seed}`);
  let s = createBattle({ sides: { 1: job.a, [-1]: job.b }, seed: job.seed, stage: job.stage, mode: job.stage ? 'campaign' : 'training', first: job.first });
  const sh = new Shadow(s);
  const fail = (msg, a) => {
    throw new Error(`fuzz seed ${job.seed} (${mode}) step ${steps}: ${msg}\naction ${JSON.stringify(a)}\njob ${JSON.stringify(job)}`);
  };
  let steps = 0;
  const maxSteps = o.maxSteps || 4000;
  const bad0 = invariants(s);
  if (bad0.length) fail(bad0.join('; '), null);
  while (!s.result) {
    if (steps >= maxSteps) fail('battle did not terminate', null);
    const legal = legalActions(s);
    if (!legal.length) fail('no legal action while the battle runs', null);
    let a;
    if (mode === 'ai') {
      a = chooseAction(s, { difficulty: job.difficulty[s.side], seed: job.seed });
      if (!a) fail('AI returned no action', null);
    } else {
      const np = legal.filter((x) => x.type !== 'pass');
      a = np.length && rng.next() < 0.85 ? np[rng.int(np.length)] : legal[rng.int(legal.length)];
    }
    const snap = steps % 25 === 0 ? JSON.stringify(s) : null;
    let r;
    try {
      r = applyAction(s, a);
    } catch (e) {
      fail(`applyAction threw ${e.message}`, a);
    }
    if (snap && JSON.stringify(s) !== snap) fail('applyAction mutated its input', a);
    const bad = invariants(r.state);
    if (bad.length) fail(bad.join('; '), a);
    sh.apply(r.events);
    const diff = sh.compare(r.state);
    if (diff.length) fail(`events inconsistent with state: ${diff.slice(0, 5).join('; ')}`, a);
    if (r.state.result && !r.events.some((e) => e.type === 'victory')) fail('result without a victory event', a);
    s = r.state;
    steps++;
  }
  const res = battleResult(s);
  if (!res || ![1, -1, 0].includes(res.winner)) fail(`bad result ${JSON.stringify(res)}`, null);
  if (res.rounds > s.roundLimit) fail(`rounds ${res.rounds} > limit ${s.roundLimit}`, null);
  return { result: res, steps };
}
