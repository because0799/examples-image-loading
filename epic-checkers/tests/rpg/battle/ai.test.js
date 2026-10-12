// Battle AI (GDD §10): legality, determinism, tactics, ultimate policy, difficulty ladder, speed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseAction, generatePlans, DIFFICULTIES } from '../../../src/rpg/ai/index.js';
import { createBattle, applyAction, battleResult, legalActions } from '../../../src/rpg/battle/index.js';
import { HEROES } from '../../../src/rpg/data/heroes.js';
import { makeRng } from '../../../src/rpg/battle/rng.js';
import { battle, only, U, sq, noCrits, unitActions } from './helpers.js';

const squadOf = (rng, lvl) => {
  const a = HEROES.map((h) => h.id);
  const out = [];
  for (let i = 0; i < 6; i++) out.push({ heroId: a.splice(rng.int(a.length), 1)[0], level: lvl });
  return out;
};

function play(dA, dB, seed) {
  const rng = makeRng(`ai-test:${seed}`);
  const lvl = 1 + rng.int(30);
  const team = squadOf(rng, lvl);
  const aSide = seed % 2 ? 1 : -1;
  let s = createBattle({ sides: { 1: team, [-1]: team }, seed, first: (seed >> 1) % 2 ? 1 : -1 });
  const times = [];
  while (!s.result) {
    const d = s.side === aSide ? dA : dB;
    const t0 = performance.now();
    const a = chooseAction(s, { difficulty: d, seed });
    if (d === dA) times.push(performance.now() - t0);
    s = applyAction(s, a).state;
  }
  return { winA: battleResult(s).winner === aSide, times };
}

test('chooseAction returns a legal action for every difficulty, deterministically for a seed', () => {
  const s = battle(['akane', 'vera', 'shio', 'maren', 'iskra', 'mashiro'], ['zlata', 'koyuki', 'volta', 'mizuha', 'karasu', 'kaede'], { seed: 4 });
  for (const d of DIFFICULTIES) {
    const a = chooseAction(s, { difficulty: d, seed: 1 });
    assert.ok(a && typeof a.type === 'string', d);
    assert.doesNotThrow(() => applyAction(s, a), d);
    assert.deepEqual(chooseAction(s, { difficulty: d, seed: 1 }), a, `${d} deterministic`);
  }
  assert.equal(chooseAction({ ...s, result: { winner: 1 } }, {}), null);
});

test('AI takes a KO when one is available and finishes the battle', () => {
  const s = noCrits(only(battle(['shio', 'vera'], ['mara', 'zlata']), { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'h8' }));
  U(s, 'b0').hp = 20;
  U(s, 'b1').hp = 20;
  U(s, 'b1').sq = sq('g7');
  // the jump chain d4 → f6 → h8 over both enemies wins on the spot
  const a = chooseAction(s, { difficulty: 'normal', seed: 1 });
  const r = applyAction(s, a);
  assert.ok(r.events.some((e) => e.type === 'ko' && e.unit === 'b0'), JSON.stringify(a));
  assert.equal(battleResult(r.state)?.winner, 1);
});

test('AI casts an Ultimate that KOs (smart policy) and holds a useless one', () => {
  const s = noCrits(only(battle(['akane', 'vera'], ['mara', 'zlata']), { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'h8' }));
  U(s, 'a0').energy = U(s, 'a0').maxEnergy;
  U(s, 'b0').hp = 300;
  const a = chooseAction(s, { difficulty: 'normal', seed: 2 });
  const r = applyAction(s, a);
  assert.ok(r.events.some((e) => e.type === 'ko' && e.unit === 'b0'));
  // a healing ult with nobody hurt and nothing else to gain is not cast by the smart policy
  const h = only(battle(['mashiro', 'vera'], ['zlata', 'mara']), { a0: 'a1', a1: 'c1', b0: 'h8', b1: 'f8' });
  U(h, 'a0').energy = U(h, 'a0').maxEnergy;
  const plans = generatePlans(h);
  assert.ok(plans.some((p) => p.kind === 'ult'));
  for (let seed = 0; seed < 4; seed++) assert.notEqual(chooseAction(h, { difficulty: 'normal', seed }).type, 'ult');
  // easy casts it as soon as it is ready
  assert.equal(chooseAction(h, { difficulty: 'easy', seed: 0 }).type, 'ult');
});

test('AI answers pending relocations (optional free move, mandatory blink) and extra activations', () => {
  const s = noCrits(only(battle(['volta', 'vera'], ['zlata', 'mara']), { a0: 'd4', a1: 'a1', b0: 'f6', b1: 'a7' }));
  let st = applyAction(s, { type: 'basic', unit: 'a0', target: sq('f6') }).state;
  assert.equal(unitActions(st, 'a0').phase, 'pending');
  const a = chooseAction(st, { difficulty: 'normal', seed: 1 });
  assert.equal(a.type, 'move');
  st = applyAction(st, a).state;
  assert.equal(st.side, -1);
  // Tsubame's Updraft: the AI keeps acting with her
  const t = noCrits(only(battle(['tsubame', 'vera'], ['mara', 'zlata', 'shio']), { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'h8', b2: 'b8' }));
  U(t, 'b0').hp = 1;
  let x = applyAction(t, { type: 'basic', unit: 'a0', target: sq('e5') }).state;
  let guard = 0;
  while (x.side === 1 && !x.result && guard++ < 6) x = applyAction(x, chooseAction(x, { difficulty: 'normal', seed: 3 })).state;
  assert.equal(x.side, -1);
});

test('AI never targets anyone but the taunter while taunted (when it attacks)', () => {
  const s = noCrits(only(battle(['shio', 'vera'], ['zlata', 'mara']), { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'c5' }));
  U(s, 'b1').hp = 10; // tempting KO on the non-taunter
  s.units.find((u) => u.id === 'a0').statuses.push({ id: 'taunt', turns: 1, stacks: 1, source: 'b0', seq: 99 });
  const a = chooseAction(s, { difficulty: 'normal', seed: 1 });
  if (a.unit === 'a0' && (a.type === 'basic' || a.type === 'jump')) {
    const r = applyAction(s, a);
    assert.ok(!r.events.some((e) => e.type === 'damage' && e.target === 'b1' && e.source === 'a0' && e.kind === 'basic'));
  }
  assert.ok(legalActions(s).filter((x) => x.unit === 'a0' && x.type === 'basic').every((x) => x.target === sq('e5')));
});

test('difficulty ladder: normal beats easy, hard beats normal (mirrored squads)', () => {
  let n = 0;
  for (let seed = 0; seed < 16; seed++) if (play('normal', 'easy', seed).winA) n++;
  assert.ok(n >= 12, `normal won ${n}/16 against easy`);
  let h = 0;
  for (let seed = 100; seed < 106; seed++) if (play('hard', 'normal', seed).winA) h++;
  assert.ok(h >= 4, `hard won ${h}/6 against normal`);
});

test('speed: normal decides in well under 150 ms (Node); hard stays within its 1.2 s budget', () => {
  const t = [];
  for (let seed = 200; seed < 206; seed++) t.push(...play('normal', 'normal', seed).times);
  t.sort((a, b) => a - b);
  const p95 = t[Math.floor(t.length * 0.95)];
  const max = t[t.length - 1];
  assert.ok(p95 < 150, `normal p95 ${p95.toFixed(1)} ms`);
  assert.ok(max < 400, `normal max ${max.toFixed(1)} ms`);
  const h = play('hard', 'normal', 300).times.sort((a, b) => a - b);
  assert.ok(h[h.length - 1] < 1200, `hard max ${h[h.length - 1].toFixed(0)} ms`);
});

test('boss difficulty plays a campaign boss battle to the end', () => {
  let s = createBattle({ sides: { 1: [{ heroId: 'akane', level: 10 }, { heroId: 'vera', level: 10 }, { heroId: 'mashiro', level: 10 }], [-1]: [{ heroId: 'tsubame', level: 10 }, { heroId: 'kaede', level: 8 }] }, stage: '1-B', mode: 'campaign', seed: 8 });
  let steps = 0;
  while (!s.result && steps++ < 3000) s = applyAction(s, chooseAction(s, { difficulty: s.side === -1 ? 'boss' : 'normal', seed: 8 })).state;
  assert.ok(battleResult(s));
});

test('RpgAIClient: in-thread fallback, worker protocol and cancel', async () => {
  const { RpgAIClient } = await import('../../../src/rpg/ai/client.js');
  const { handleMessage } = await import('../../../src/rpg/ai/worker.js');
  const s = battle(['akane', 'vera'], ['zlata', 'mara'], { seed: 2 });
  const local = new RpgAIClient();
  const a = await local.choose(s, { difficulty: 'normal', seed: 1 });
  assert.deepEqual(a, chooseAction(s, { difficulty: 'normal', seed: 1 }));
  const p = local.choose(s, { difficulty: 'normal', seed: 1 });
  local.cancel();
  assert.equal(await p, null);
  // a fake worker that answers through the same handler
  const fake = { postMessage(msg) { setTimeout(() => this.onmessage({ data: handleMessage(msg) }), 0); }, terminate() { this.dead = true; } };
  const w = new RpgAIClient({ worker: fake });
  assert.deepEqual(await w.choose(s, { difficulty: 'easy', seed: 3 }), chooseAction(s, { difficulty: 'easy', seed: 3 }));
  w.dispose();
  assert.equal(fake.dead, true);
  assert.ok(handleMessage({ id: 1, state: null }).action === null);
});
