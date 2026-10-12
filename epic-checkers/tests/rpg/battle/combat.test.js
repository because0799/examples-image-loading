// Damage formula (GDD §4), elements (§5), seals & reactions (§6, effects.md §9), role traits (§8).
import test from 'node:test';
import assert from 'node:assert/strict';
import { battle, only, turn, act, evs, U, sq, noCrits, setSeal, addStatus, dmgTo, unitActions } from './helpers.js';
import { reactionFor, ELEMENT_ORDER, REACTIONS } from '../../../src/rpg/data/rules.js';
import { critChance } from '../../../src/rpg/battle/stats.js';
import { previewAction, unitStats } from '../../../src/rpg/battle/index.js';

/** Basic hit of `a` (side 1 at d4) on `b` (side -1 at e5); returns { r, s }. */
function basicHit(a, b, setup = () => {}, o = {}) {
  const s = noCrits(only(battle([a], [b, 'vera'], o), { a0: o.from || 'd4', b0: o.at || 'e5', b1: 'a7' }));
  setup(s);
  const r = act(s, { type: 'basic', unit: 'a0', target: sq(o.at || 'e5') });
  return { r, s };
}

test('GDD §4 worked example: Akane L10 2nd hop with Steam on Reika L10 = 991 (KO)', () => {
  const s = noCrits(only(battle(['akane', 'vera'], ['torvald', 'reika', 'shio']), { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'g7', b2: 'a7' }));
  setSeal(s, 'b1', 'tide');
  assert.equal(U(s, 'a0').atk, 405);
  assert.equal(U(s, 'b1').hp, 988);
  assert.equal(U(s, 'b1').def, 52);
  const r = act(s, { type: 'jump', unit: 'a0', path: [sq('d4'), sq('f6'), sq('h8')] });
  const hit = evs(r.events, 'damage').find((e) => e.target === 'b1');
  assert.equal(hit.amount, 991);
  assert.equal(hit.reaction, 'steam');
  assert.ok(evs(r.events, 'ko').some((e) => e.unit === 'b1'));
  assert.ok(evs(r.events, 'awaken').some((e) => e.unit === 'a0' && e.full));
  assert.equal(U(r.state, 'a0').energy, U(r.state, 'a0').maxEnergy);
});

test('DEF factor K = 150 + 10 × attacker level; minimum damage 1', () => {
  const { r, s } = basicHit('vera', 'zlata', (x) => {
    U(x, 'b0').def = 250;
  });
  const k = 150 + 10 * 10;
  assert.equal(dmgTo(r.events, 'b0'), Math.floor(U(s, 'a0').atk * (k / (k + 250))));
  const { r: r2 } = basicHit('vera', 'zlata', (x) => {
    U(x, 'a0').atk = 0;
  });
  assert.equal(dmgTo(r2.events, 'b0'), 1);
});

test('Elements: ×0.8 on the same element, Radiance ↔ Umbra ×1.3 both ways, others ×1.0', () => {
  const dmg = (a, b) => {
    const { r } = basicHit(a, b, (x) => {
      U(x, 'b0').def = 0;
      U(x, 'a0').atk = 1000;
    });
    return dmgTo(r.events, 'b0');
  };
  assert.equal(dmg('karasu', 'vera'), 1300); // umbra → radiance
  assert.equal(dmg('vera', 'mara'), 1300); // radiance → umbra
  assert.equal(dmg('karasu', 'mara'), 800); // same element
  assert.equal(dmg('karasu', 'zlata'), 1000);
});

test('Ranger: Steady Aim +15 % when she did not move; point-blank shots deal 60 %', () => {
  const shot = (moveFirst, at) => {
    const s = noCrits(only(battle(['falk'], ['mara', 'vera']), { a0: moveFirst ? 'a1' : 'b2', b0: at, b1: 'a7' }));
    U(s, 'b0').def = 0;
    U(s, 'a0').atk = 1000;
    const r = act(s, { type: 'basic', unit: 'a0', target: sq(at), to: moveFirst ? sq('b2') : undefined });
    return dmgTo(r.events, 'b0');
  };
  assert.equal(shot(false, 'e5'), Math.floor(1000 * 0.9 * 1.15));
  assert.equal(shot(true, 'e5'), Math.floor(1000 * 0.9));
  assert.equal(shot(false, 'c3'), Math.floor(1000 * 0.6 * 1.15));
});

test('Shadow: Backstab +25 % crit chance against isolated targets', () => {
  const s = only(battle(['mara'], ['zlata', 'vera']), { a0: 'd4', b0: 'e5', b1: 'a7' });
  const base = U(s, 'a0').crit;
  assert.equal(critChance(s, U(s, 'a0'), { target: U(s, 'b0') }), base + 25);
  const s2 = only(battle(['mara'], ['zlata', 'vera']), { a0: 'd4', b0: 'e5', b1: 'f6' });
  assert.equal(critChance(s2, U(s2, 'a0'), { target: U(s2, 'b0') }), base);
});

test('Guardian Bulwark: allies next to a Guardian take 15 % less damage (does not stack)', () => {
  const dmg = (guards) => {
    const map = { a0: 'd4', b0: 'e5', b1: guards >= 1 ? 'f6' : 'a7', b2: guards >= 2 ? 'd6' : 'c7' };
    const s = noCrits(only(battle(['karasu'], ['mara', 'zlata', 'torvald']), map));
    U(s, 'b0').def = 0;
    U(s, 'a0').atk = 1000;
    return dmgTo(act(s, { type: 'basic', unit: 'a0', target: sq('e5') }).events, 'b0');
  };
  assert.equal(dmg(0), 800);
  assert.equal(dmg(1), Math.floor(800 * 0.85));
  assert.equal(dmg(2), Math.floor(800 * 0.85));
});

test('reactionFor matches the GDD matrix', () => {
  const M = {
    flame: { flame: null, tide: 'steam', frost: 'steam', storm: 'detonation', radiance: null, umbra: null },
    tide: { flame: 'steam', tide: null, frost: 'shackles', storm: 'arc', radiance: null, umbra: null },
    frost: { flame: 'steam', tide: 'shackles', frost: null, storm: 'brittle', radiance: null, umbra: null },
    storm: { flame: 'detonation', tide: 'arc', frost: 'brittle', storm: null, radiance: null, umbra: null },
    gale: { flame: 'vortex', tide: 'vortex', frost: 'vortex', storm: 'vortex', radiance: null, umbra: null },
    terra: { flame: 'facet', tide: 'facet', frost: 'facet', storm: 'facet', radiance: null, umbra: null },
    radiance: { flame: null, tide: null, frost: null, storm: null, radiance: null, umbra: 'eclipse' },
    umbra: { flame: null, tide: null, frost: null, storm: null, radiance: 'eclipse', umbra: null },
  };
  for (const hit of ELEMENT_ORDER) for (const seal of Object.keys(M[hit])) assert.equal(reactionFor(hit, seal), M[hit][seal], `${hit} on ${seal}`);
});

test('Steam: ×1.5 scaled by Affinity, consumes the seal, applies no new seal, +10 energy', () => {
  const plain = basicHit('akane', 'zlata').r;
  const { r, s } = basicHit('akane', 'zlata', (x) => setSeal(x, 'b0', 'tide'));
  const amp = 1 + 0.5 * (1 + U(s, 'a0').aff / 200);
  const d0 = dmgTo(plain.events, 'b0');
  const d1 = dmgTo(r.events, 'b0');
  assert.ok(Math.abs(d1 / d0 - amp) < 0.01, `${d1}/${d0}`);
  assert.ok(evs(r.events, 'reaction').some((e) => e.reaction === 'steam' && e.elements[0] === 'flame' && e.elements[1] === 'tide'));
  assert.deepEqual(U(r.state, 'b0').seals, []);
  assert.ok(evs(r.events, 'energy').some((e) => e.unit === 'a0' && e.reason === 'reaction' && e.delta === 10));
  // without a reaction the hit leaves its own seal
  assert.deepEqual(U(plain.state, 'b0').seals.map((x) => x.element), ['flame']);
});

test('Detonation: +100 % ATK bonus on the target, 60 % to its neighbours, target pushed 1', () => {
  const s = noCrits(only(battle(['akane'], ['zlata', 'vera', 'shio']), { a0: 'd4', b0: 'e5', b1: 'f6', b2: 'a7' }));
  setSeal(s, 'b0', 'storm');
  // f6 is behind e5: the push is blocked → collision; put the neighbour on d6 instead
  U(s, 'b1').sq = sq('d6');
  const r = act(s, { type: 'basic', unit: 'a0', target: sq('e5') });
  const reactionDmg = evs(r.events, 'damage').filter((e) => e.kind === 'reaction');
  assert.ok(reactionDmg.some((e) => e.target === 'b0'));
  assert.ok(reactionDmg.some((e) => e.target === 'b1'));
  assert.equal(U(r.state, 'b0').sq, sq('f6'));
  assert.ok(evs(r.events, 'displace').some((e) => e.unit === 'b0' && e.kind === 'push'));
});

test('Shackles: Frozen 1 turn (cannot act), the next hit ×1.4 shatters the ice', () => {
  const { r } = basicHit('maren', 'zlata', (x) => setSeal(x, 'b0', 'frost'), { from: 'b2' });
  const st = r.state;
  assert.ok(U(st, 'b0').statuses.some((x) => x.id === 'frozen'));
  // enemy turn: b0 cannot be activated
  assert.equal(st.side, -1);
  assert.throws(() => act(st, { type: 'pass', unit: 'b0' }), /Illegal/);
  // compare the next hit with / without ice
  const s1 = turn(JSON.parse(JSON.stringify(st)), 1);
  const s2 = turn(JSON.parse(JSON.stringify(st)), 1);
  U(s2, 'b0').statuses = U(s2, 'b0').statuses.filter((x) => x.id !== 'frozen');
  const iced = act(s1, { type: 'basic', unit: 'a0', target: U(s1, 'b0').sq });
  const plain = act(s2, { type: 'basic', unit: 'a0', target: U(s2, 'b0').sq });
  const d1 = dmgTo(iced.events, 'b0');
  const d2 = dmgTo(plain.events, 'b0');
  assert.ok(Math.abs(d1 / d2 - 1.4) < 0.02, `${d1} vs ${d2}`);
  assert.ok(evs(iced.events, 'status').some((e) => e.status === 'frozen' && !e.on && e.reason === 'shattered'));
});

test('Arc: +60 % on the target, then 50 % arcs to the 2 nearest enemies within 2 (Storm seal)', () => {
  const s = noCrits(only(battle(['maren'], ['zlata', 'vera', 'shio', 'mara']), { a0: 'b2', b0: 'e5', b1: 'f6', b2: 'g5', b3: 'a7' }));
  setSeal(s, 'b0', 'storm');
  const r = act(s, { type: 'basic', unit: 'a0', target: sq('e5') });
  const arcs = evs(r.events, 'arc');
  assert.equal(arcs.length, 2);
  assert.deepEqual(arcs.map((e) => e.target).sort(), ['b1', 'b2']);
  for (const id of ['b1', 'b2']) assert.ok(U(r.state, id).seals.some((x) => x.element === 'storm'), id);
  assert.ok(evs(r.events, 'damage').some((e) => e.target === 'b0' && e.kind === 'reaction'));
});

test('Brittleness: DEF −35 % for 2 turns and Slow 1', () => {
  const { r } = basicHit('koyuki', 'zlata', (x) => setSeal(x, 'b0', 'storm'), { from: 'b2' });
  const b0 = U(r.state, 'b0');
  assert.ok(b0.statuses.some((x) => x.id === 'brittle' && x.turns === 2));
  assert.ok(b0.statuses.some((x) => x.id === 'slow'));
  const st = unitStats(r.state, 'b0');
  assert.equal(st.def, Math.floor(b0.def * 0.65));
});

test('Vortex: neighbours of the target take 50 % ATK of the sealed element and get the seal; target pushed', () => {
  const s = noCrits(only(battle(['kaede'], ['zlata', 'vera', 'shio']), { a0: 'd4', b0: 'e5', b1: 'd6', b2: 'a7' }));
  setSeal(s, 'b0', 'flame');
  const r = act(s, { type: 'basic', unit: 'a0', target: sq('e5') });
  assert.ok(evs(r.events, 'reaction').some((e) => e.reaction === 'vortex'));
  assert.ok(evs(r.events, 'damage').some((e) => e.target === 'b1' && e.kind === 'reaction' && e.element === 'flame'));
  assert.ok(U(r.state, 'b1').seals.some((x) => x.element === 'flame'));
  assert.equal(U(r.state, 'b0').sq, sq('f6'));
  // Gale never leaves a seal itself
  assert.deepEqual(U(r.state, 'b0').seals, []);
});

test('Facet: the triggering hero gets a shield of 15 % of her max HP; the target is Rooted', () => {
  const { r, s } = basicHit('zlata', 'shio', (x) => setSeal(x, 'b0', 'tide'));
  assert.ok(U(r.state, 'b0').statuses.some((x) => x.id === 'root'));
  const scale = (1 + U(s, 'a0').aff / 200);
  assert.ok(U(r.state, 'a0').shield >= Math.floor(0.15 * U(s, 'a0').maxHp * scale) - 1);
  assert.deepEqual(U(r.state, 'b0').seals, []);
});

test('Eclipse: ×2 (scaled by Affinity) and Silence', () => {
  const plain = basicHit('karasu', 'zlata').r;
  const { r, s } = basicHit('karasu', 'zlata', (x) => setSeal(x, 'b0', 'radiance'));
  const amp = 1 + 1 * (1 + U(s, 'a0').aff / 200);
  assert.ok(Math.abs(dmgTo(r.events, 'b0') / dmgTo(plain.events, 'b0') - amp) < 0.01);
  assert.ok(U(r.state, 'b0').statuses.some((x) => x.id === 'silence'));
});

test('Mystic Resonator: reactions of Mystics are 20 % stronger', () => {
  const plain = basicHit('vermilia', 'zlata', () => {}, { from: 'c3' }).r;
  const { r, s } = basicHit('vermilia', 'zlata', (x) => setSeal(x, 'b0', 'tide'), { from: 'c3' });
  const amp = 1 + 0.5 * (1 + U(s, 'a0').aff / 200) * 1.2;
  assert.ok(Math.abs(dmgTo(r.events, 'b0') / dmgTo(plain.events, 'b0') - amp) < 0.01);
});

test('Reaction damage never triggers further reactions', () => {
  const s = noCrits(only(battle(['akane'], ['zlata', 'vera', 'shio']), { a0: 'd4', b0: 'e5', b1: 'd6', b2: 'a7' }));
  setSeal(s, 'b0', 'storm');
  setSeal(s, 'b1', 'tide');
  const r = act(s, { type: 'basic', unit: 'a0', target: sq('e5') });
  assert.equal(evs(r.events, 'reaction').length, 1);
  assert.ok(U(r.state, 'b1').seals.some((x) => x.element === 'tide'));
});

test('Seals: same element refreshes, another natural element replaces, celestial slot independent, Terra never seals', () => {
  const { r } = basicHit('maren', 'zlata', (x) => setSeal(x, 'b0', 'tide'), { from: 'b2' });
  assert.deepEqual(U(r.state, 'b0').seals.map((x) => [x.element, x.turns]), [['tide', 2]]);
  // radiance hit on a tide-sealed target: both slots
  const { r: r2 } = basicHit('vera', 'zlata', (x) => setSeal(x, 'b0', 'tide'));
  assert.deepEqual(U(r2.state, 'b0').seals.map((x) => x.element).sort(), ['radiance', 'tide']);
  // terra hit on an unsealed target: nothing
  const { r: r3 } = basicHit('zlata', 'shio');
  assert.deepEqual(U(r3.state, 'b0').seals, []);
  // seal expiry: 2 turns of the holder's side
  const st = r3.state;
  void st;
  const { r: r4 } = basicHit('vera', 'zlata');
  let s4 = r4.state; // now side -1 to act
  assert.equal(U(s4, 'b0').seals.length, 1);
  s4 = act(s4, { type: 'pass', unit: 'b1' }).state; // b0's side turn 1 ends → 1 left
  assert.equal(U(s4, 'b0').seals[0].turns, 1);
  s4 = act(s4, { type: 'pass', unit: 'a0' }).state;
  s4 = act(s4, { type: 'pass', unit: 'b1' }).state; // turn 2 ends → gone
  assert.equal(U(s4, 'b0').seals.length, 0);
});

test('previewAction forecasts damage, reactions and KOs without consuming randomness', () => {
  const s = noCrits(only(battle(['akane'], ['zlata', 'vera']), { a0: 'd4', b0: 'e5', b1: 'a7' }));
  setSeal(s, 'b0', 'tide');
  const p = previewAction(s, { type: 'basic', unit: 'a0', target: sq('e5') });
  assert.ok(p.targets.b0.damage > 0);
  assert.equal(p.targets.b0.reaction, 'steam');
  assert.equal(s.rng, p.state.rng);
  assert.equal(previewAction(s, { type: 'basic', unit: 'a0', target: sq('h8') }), null);
  void unitActions;
});

test('every reaction id is reachable', () => {
  const seen = new Set();
  for (const a of ELEMENT_ORDER) for (const b of ELEMENT_ORDER) {
    const r = reactionFor(a, b);
    if (r) seen.add(r);
  }
  assert.deepEqual([...seen].sort(), Object.keys(REACTIONS).sort());
});
