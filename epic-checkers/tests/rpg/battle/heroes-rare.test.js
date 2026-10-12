// Ability-by-ability tests (Rare heroes).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { battle, only, turn, act, evs, own, U, sq, noCrits, setSeal, addStatus, dmgTo, unitActions } from './helpers.js';

const full = (s, id) => {
  U(s, id).energy = U(s, id).maxEnergy;
  return s;
};
const tough = (s, ...ids) => {
  for (const id of ids) U(s, id).hp = U(s, id).maxHp = 100000;
  return s;
};

describe('Torvald — Smith Guardian', () => {
  it('skill The Forge: adjacent enemies Taunted; a 15 % shield', () => {
    const s = only(battle(['torvald'], ['shio', 'mara']), { a0: 'd4', b0: 'e5', b1: 'h8' });
    const r = act(s, { type: 'skill', unit: 'a0' });
    assert.ok(U(r.state, 'b0').statuses.some((x) => x.id === 'taunt'));
    assert.equal(U(r.state, 'a0').shield, Math.floor(0.15 * U(s, 'a0').maxHp));
  });
  it('passive Red-Hot Shield: a melee attacker Burns for 1 turn', () => {
    const s = noCrits(only(battle(['torvald', 'vera'], ['shio', 'mara']), { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'a7' }));
    turn(s, -1);
    const r = act(s, { type: 'basic', unit: 'b0', target: sq('d4') });
    assert.ok(U(r.state, 'b0').statuses.some((x) => x.id === 'burn'));
  });
  it('ult Anvil Drop: adjacent enemies take 200 % DEF Flame and are Stunned', () => {
    const s = noCrits(only(full(battle(['torvald'], ['shio', 'mara']), 'a0'), { a0: 'd4', b0: 'e5', b1: 'h8' }));
    const r = act(s, { type: 'ult', unit: 'a0' });
    assert.ok(dmgTo(r.events, 'b0') > 0);
    assert.ok(U(r.state, 'b0').statuses.some((x) => x.id === 'stun'));
  });
  it('quirk Handyman: once per battle recharges an adjacent ally\'s skill', () => {
    const s = only(battle(['torvald', 'shio'], ['zlata', 'mara']), { a0: 'd4', a1: 'c3', b0: 'h8', b1: 'a7' });
    U(s, 'a1').cd.skill = 3;
    const r = act(s, { type: 'quirk', unit: 'a0', quirk: 'handyman', target: sq('c3') });
    assert.equal(U(r.state, 'a1').cd.skill, 0);
    const again = turn(r.state, 1);
    assert.equal(unitActions(again, 'a0').quirks[0].ok, false);
    assert.equal(unitActions(again, 'a0').quirks[0].reason, 'used');
  });
});

describe('Shio — Corsair of the Salt Wind', () => {
  it('skill Boarding Wave: dashes to the first enemy on a diagonal within 3 and strikes for 160 % Tide', () => {
    const s = noCrits(only(battle(['shio'], ['zlata', 'mara']), { a0: 'b2', b0: 'e5', b1: 'h8' }));
    const r = act(s, { type: 'skill', unit: 'a0', target: sq('c3') });
    assert.equal(U(r.state, 'a0').sq, sq('d4'));
    assert.ok(dmgTo(r.events, 'b0') > 0);
  });
  it('passive Boarding Party: a 10 % shield after a jump-strike chain', () => {
    const s = noCrits(tough(only(battle(['shio'], ['zlata', 'mara']), { a0: 'c3', b0: 'd4', b1: 'h8' }), 'b0'));
    const r = act(s, { type: 'jump', unit: 'a0', path: [sq('c3'), sq('e5')] });
    assert.equal(U(r.state, 'a0').shield, Math.floor(0.1 * U(s, 'a0').maxHp));
  });
  it('ult Ninth Wave: 180 % Tide to every enemy on a 4-square line and a 1-square push', () => {
    const s = noCrits(tough(only(full(battle(['shio'], ['zlata', 'mara']), 'a0'), { a0: 'b2', b0: 'c3', b1: 'e5' }), 'b0', 'b1'));
    const r = act(s, { type: 'ult', unit: 'a0', target: sq('c3') });
    assert.ok(dmgTo(r.events, 'b0') > 0 && dmgTo(r.events, 'b1') > 0);
    assert.equal(U(r.state, 'b1').sq, sq('f6'));
    assert.equal(U(r.state, 'b0').sq, sq('d4'));
  });
  it('quirk Corsair\'s Luck: each crit grants +10 energy', () => {
    const s = only(battle(['shio'], ['zlata', 'mara']), { a0: 'd4', b0: 'e5', b1: 'h8' });
    U(s, 'a0').crit = 1000;
    const r = act(s, { type: 'basic', unit: 'a0', target: sq('e5') });
    assert.ok(own(r.events).some((e) => e.type === 'energy' && e.unit === 'a0' && e.reason === 'effect' && e.delta === 10));
  });
});

describe('Maren — Harpooner of the Deep', () => {
  it('skill Harpoon Reel: 130 % Tide on an enemy on a diagonal within 4, then reels it next to Maren', () => {
    const s = noCrits(only(battle(['maren'], ['zlata', 'mara']), { a0: 'b2', b0: 'e5', b1: 'h8' }));
    const r = act(s, { type: 'skill', unit: 'a0', target: sq('e5') });
    assert.equal(U(r.state, 'b0').sq, sq('c3'));
    assert.ok(dmgTo(r.events, 'b0') > 0);
  });
  it('passive Harpoon: her basic attack pulls the target 1 square toward her', () => {
    const s = noCrits(only(battle(['maren'], ['zlata', 'mara']), { a0: 'b2', b0: 'e5', b1: 'h8' }));
    const r = act(s, { type: 'basic', unit: 'a0', target: sq('e5') });
    assert.equal(U(r.state, 'b0').sq, sq('d4'));
  });
  it('ult Harpoon Storm: three diagonals, 140 % to the first enemy on each', () => {
    const s = noCrits(tough(only(full(battle(['maren'], ['zlata', 'mara', 'shio']), 'a0'), { a0: 'd4', b0: 'f6', b1: 'b2', b2: 'f2' }), 'b0', 'b1', 'b2'));
    const r = act(s, { type: 'ult', unit: 'a0', targets: [sq('e5'), sq('c3'), sq('e3')] });
    for (const id of ['b0', 'b1', 'b2']) assert.ok(dmgTo(r.events, id) > 0, id);
  });
  it('quirk Fisher\'s Patience: +25 % damage to Slowed or Rooted targets', () => {
    const mk = (st) => {
      const s = noCrits(tough(only(battle(['maren'], ['zlata', 'mara']), { a0: 'b2', b0: 'e5', b1: 'h8' }), 'b0'));
      if (st) addStatus(s, 'b0', st, 1);
      return dmgTo(act(s, { type: 'basic', unit: 'a0', target: sq('e5') }).events, 'b0');
    };
    const base = mk(null);
    assert.ok(Math.abs(mk('slow') / base - (1.15 + 0.25) / 1.15) < 0.01); // additive with Steady Aim
    assert.ok(Math.abs(mk('root') / base - (1.15 + 0.25) / 1.15) < 0.01);
  });
});

describe('Mashiro — Snow Sister of Mercy', () => {
  it('skill Snow Bandage: heals an ally within 2 (or herself) for 140 %', () => {
    const s = only(battle(['mashiro', 'vera'], ['zlata', 'mara']), { a0: 'd4', a1: 'f6', b0: 'h8', b1: 'a7' });
    U(s, 'a1').hp = 100;
    const r = act(s, { type: 'skill', unit: 'a0', target: sq('f6') });
    assert.equal(own(r.events).find((e) => e.type === 'heal' && e.target === 'a1').amount, Math.floor(U(s, 'a0').atk * 1.4));
  });
  it('passive Cool Compress: her heals also remove Burn and Blight', () => {
    const s = only(battle(['mashiro', 'vera'], ['zlata', 'mara']), { a0: 'd4', a1: 'f6', b0: 'h8', b1: 'a7' });
    U(s, 'a1').hp = 100;
    addStatus(s, 'a1', 'burn', 2);
    addStatus(s, 'a1', 'blight', 2);
    addStatus(s, 'a1', 'mark', 2);
    const r = act(s, { type: 'skill', unit: 'a0', target: sq('f6') });
    const ids = U(r.state, 'a1').statuses.map((x) => x.id);
    assert.ok(!ids.includes('burn') && !ids.includes('blight') && ids.includes('mark'));
  });
  it('ult Quiet Snowfall: every ally heals 100 %; enemies within 2 of her get a Frost seal', () => {
    const s = only(full(battle(['mashiro', 'vera'], ['zlata', 'mara']), 'a0'), { a0: 'd4', a1: 'a1', b0: 'f6', b1: 'h8' });
    U(s, 'a1').hp = 100;
    const r = act(s, { type: 'ult', unit: 'a0' });
    assert.ok(own(r.events).some((e) => e.type === 'heal' && e.target === 'a1' && e.amount === Math.floor(U(s, 'a0').atk)));
    assert.ok(U(r.state, 'b0').seals.some((x) => x.element === 'frost'));
    assert.ok(!U(r.state, 'b1').seals.length);
  });
  it('quirk Ice Cocoon: once per battle an ally within 2 dropping below 20 % HP is Veiled and Stunned', () => {
    const s = noCrits(only(battle(['mashiro', 'vera'], ['shio', 'mara']), { a0: 'd4', a1: 'f6', b0: 'g7', b1: 'a7' }));
    turn(s, -1);
    U(s, 'a1').hp = Math.floor(0.25 * U(s, 'a1').maxHp);
    U(s, 'b0').atk = 400;
    const r = act(s, { type: 'basic', unit: 'b0', target: sq('f6') });
    const v = U(r.state, 'a1');
    assert.ok(v.alive && v.hp / v.maxHp < 0.2);
    assert.ok(v.statuses.some((x) => x.id === 'untargetable'));
    assert.ok(v.statuses.some((x) => x.id === 'stun'));
    assert.equal(U(r.state, 'a0').uses.cocoon, 1);
  });
});

describe('Iskra — Lightning Courier', () => {
  it('skill Back Zap: 150 % Storm to an adjacent enemy, then she may hop 1 square away', () => {
    const s = noCrits(only(battle(['iskra'], ['zlata', 'mara']), { a0: 'd4', b0: 'e5', b1: 'h8' }));
    const r = act(s, { type: 'skill', unit: 'a0', target: sq('e5') });
    assert.ok(dmgTo(r.events, 'b0') > 0);
    assert.equal(unitActions(r.state, 'a0').pending.kind, 'freeMove');
  });
  it('passive Express Delivery: glides 4 squares', () => {
    const s = only(battle(['iskra'], ['zlata']), { a0: 'a1', b0: 'h4' });
    assert.ok(unitActions(s, 'a0').moves.includes(sq('e5')));
  });
  it('ult Chain Post: 80 % on an enemy within 3 plus 3 deliveries to the nearest enemies within 2', () => {
    const s = noCrits(tough(only(full(battle(['iskra'], ['zlata', 'mara', 'shio', 'falk']), 'a0'), { a0: 'b2', b0: 'd4', b1: 'e5', b2: 'f6', b3: 'g7' }), 'b0', 'b1', 'b2', 'b3'));
    const r = act(s, { type: 'ult', unit: 'a0', target: sq('d4') });
    assert.equal(evs(r.events, 'bounce').length, 3);
    for (const id of ['b0', 'b1', 'b2', 'b3']) assert.ok(dmgTo(r.events, id) > 0, id);
  });
  it('quirk Momentum: +30 % damage after travelling 3+ squares', () => {
    const mk = (from) => {
      const s = noCrits(tough(only(battle(['iskra'], ['zlata', 'mara']), { a0: from, b0: 'f6', b1: 'h8' }), 'b0'));
      return dmgTo(act(s, { type: 'basic', unit: 'a0', to: sq('e5'), target: sq('f6') }).events, 'b0');
    };
    assert.ok(Math.abs(mk('b2') / mk('d4') - 1.3) < 0.01);
  });
});

describe('Sirin — Song of the Winds', () => {
  it('skill Wind Ballad: an ally within 3 gains +25 energy and loses a debuff', () => {
    const s = only(battle(['sirin', 'vera'], ['zlata', 'mara']), { a0: 'd4', a1: 'g7', b0: 'h8', b1: 'a7' });
    U(s, 'a1').energy = 0;
    addStatus(s, 'a1', 'weaken', 2);
    const r = act(s, { type: 'skill', unit: 'a0', target: sq('g7') });
    assert.ok(U(r.state, 'a1').energy >= 25);
    assert.ok(!U(r.state, 'a1').statuses.some((x) => x.id === 'weaken'));
  });
  it('passive Travelling Song: at her turn start the ally with the least energy within 2 gains +8', () => {
    const s = only(battle(['sirin', 'vera'], ['zlata', 'mara']), { a0: 'd4', a1: 'f6', b0: 'h8', b1: 'a7' });
    turn(s, -1);
    U(s, 'a1').energy = 0;
    const r = act(s, { type: 'pass', unit: 'b0' });
    assert.equal(U(r.state, 'a1').energy, 8);
  });
  it('ult Storm Chorus: allies heal 80 % and get Inspire; enemies within 2 take 80 % Gale', () => {
    const s = noCrits(only(full(battle(['sirin', 'vera'], ['zlata', 'mara']), 'a0'), { a0: 'd4', a1: 'a1', b0: 'f6', b1: 'h8' }));
    U(s, 'a1').hp = 100;
    const r = act(s, { type: 'ult', unit: 'a0' });
    assert.ok(own(r.events).some((e) => e.type === 'heal' && e.target === 'a1' && e.amount > 0));
    assert.ok(U(r.state, 'a1').statuses.some((x) => x.id === 'inspire'));
    assert.ok(dmgTo(r.events, 'b0') > 0 && dmgTo(r.events, 'b1') === 0);
  });
  it('quirk Migrant Bird: swaps places with an ally within 2 instead of moving', () => {
    const s = only(battle(['sirin', 'vera'], ['zlata']), { a0: 'd4', a1: 'f6' });
    assert.deepEqual(unitActions(s, 'a0').swaps, [sq('f6')]);
  });
});

describe('Falk — Stone Crossbowman', () => {
  it('skill Siege Bolt: 140 % Terra to every enemy on 5 squares of a diagonal; the first is Rooted', () => {
    const s = noCrits(tough(only(battle(['falk'], ['zlata', 'mara']), { a0: 'b2', b0: 'c3', b1: 'f6' }), 'b0', 'b1'));
    const r = act(s, { type: 'skill', unit: 'a0', target: sq('c3') });
    assert.ok(dmgTo(r.events, 'b0') > 0 && dmgTo(r.events, 'b1') > 0);
    assert.ok(U(r.state, 'b0').statuses.some((x) => x.id === 'root'));
    assert.ok(!U(r.state, 'b1').statuses.some((x) => x.id === 'root'));
  });
  it('passive Heavy Bolts: his basic attack pushes the target 1 square', () => {
    const s = noCrits(only(battle(['falk'], ['zlata', 'mara']), { a0: 'b2', b0: 'd4', b1: 'h8' }));
    const r = act(s, { type: 'basic', unit: 'a0', target: sq('d4') });
    assert.equal(U(r.state, 'b0').sq, sq('e5'));
  });
  it('ult Rockfall: 160 % Terra to enemies within radius 1 of a point within 4', () => {
    const s = noCrits(tough(only(full(battle(['falk'], ['zlata', 'mara', 'shio']), 'a0'), { a0: 'b2', b0: 'e5', b1: 'f4', b2: 'h8' }), 'b0', 'b1'));
    const r = act(s, { type: 'ult', unit: 'a0', target: sq('e5') });
    assert.ok(dmgTo(r.events, 'b0') > 0 && dmgTo(r.events, 'b1') > 0 && dmgTo(r.events, 'b2') === 0);
  });
  it('quirk Entrenched: Brace if he did not move during his activation', () => {
    const s = noCrits(only(battle(['falk'], ['zlata', 'mara']), { a0: 'b2', b0: 'd4', b1: 'h8' }));
    const r = act(s, { type: 'basic', unit: 'a0', target: sq('d4') });
    assert.ok(U(r.state, 'a0').statuses.some((x) => x.id === 'brace'));
  });
});

describe('Runa — Sand Draughtswoman', () => {
  it('skill Sand Rune: radius-1 rune (2 turns); an enemy starting its turn inside takes 60 % Terra and is Slowed', () => {
    const s = noCrits(only(battle(['runa', 'vera'], ['zlata', 'mara']), { a0: 'd4', a1: 'a1', b0: 'f6', b1: 'h8' }));
    const r = act(s, { type: 'skill', unit: 'a0', target: sq('f6') });
    const z = r.state.zones.find((x) => x.kind === 'sand-rune');
    assert.ok(z && z.sqs.includes(sq('f6')) && z.turns === 2);
    assert.ok(evs(r.events, 'damage').some((e) => e.target === 'b0' && e.source === 'a0'));
    assert.ok(U(r.state, 'b0').statuses.some((x) => x.id === 'slow'));
  });
  it('passive Rune Circle: triggering Facet also shields the lowest-HP ally within 2 (15 % of Runa\'s HP)', () => {
    const s = noCrits(only(battle(['runa', 'vera'], ['shio', 'mara']), { a0: 'd4', a1: 'c3', b0: 'f6', b1: 'h8' }));
    setSeal(s, 'b0', 'tide');
    U(s, 'a1').hp = 100;
    const r = act(s, { type: 'basic', unit: 'a0', target: sq('f6') });
    assert.ok(evs(r.events, 'reaction').some((e) => e.reaction === 'facet'));
    assert.equal(U(r.state, 'a1').shield, Math.floor(0.15 * U(s, 'a0').maxHp));
  });
  it('ult Stone Garden: up to 3 pillars (15 % HP, 3 turns); enemies next to a pillar take 100 % Terra', () => {
    const s = noCrits(only(full(battle(['runa'], ['zlata', 'mara']), 'a0'), { a0: 'd4', b0: 'f6', b1: 'h8' }));
    const r = act(s, { type: 'ult', unit: 'a0', targets: [sq('e5'), sq('c5'), sq('e3')] });
    const pillars = r.state.wards.filter((w) => w.kind === 'stone-pillar');
    assert.equal(pillars.length, 3);
    assert.equal(pillars[0].hp, Math.floor(0.15 * U(s, 'a0').maxHp));
    assert.equal(evs(r.events, 'damage').filter((e) => e.target === 'b0' && e.source === 'a0').length, 1);
  });
  it('quirk Draughtswoman: allies vault over her pillars when moving and inside jump chains', () => {
    const s = noCrits(tough(only(battle(['runa', 'shio'], ['zlata', 'mara']), { a0: 'a1', a1: 'c3', b0: 'f6', b1: 'h8' }), 'b0'));
    s.wards.push({ id: 'w90', isWard: true, kind: 'stone-pillar', owner: 'a0', side: 1, sq: sq('d4'), hp: 50, maxHp: 50, turns: 3, blocks: true, jumpable: true, behavior: null, aura: null, special: null, springboard: true, data: null });
    const ua = unitActions(s, 'a1');
    assert.ok(ua.moves.includes(sq('e5'))); // step over the pillar
    const j = ua.jumps.map((p) => p.join('.'));
    assert.ok(j.includes([sq('c3'), sq('e5'), sq('g7')].join('.')), 'pillar hop then strike');
    const r = act(s, { type: 'jump', unit: 'a1', path: [sq('c3'), sq('e5'), sq('g7')] });
    assert.ok(evs(r.events, 'jump').some((e) => e.spring));
    assert.equal(r.state.wards.find((w) => w.id === 'w90').hp, 50);
    assert.ok(dmgTo(r.events, 'b0') > 0);
  });
});

describe('Vera — Shield of Dawn', () => {
  it('skill Radiant Shield: an ally within 2 (or Vera) gets a shield of 20 % of Vera\'s HP and loses a debuff', () => {
    const s = only(battle(['vera', 'shio'], ['zlata', 'mara']), { a0: 'd4', a1: 'f6', b0: 'h8', b1: 'a7' });
    const r = act(s, { type: 'skill', unit: 'a0', target: sq('f6') });
    assert.equal(U(r.state, 'a1').shield, Math.floor(0.2 * U(s, 'a0').maxHp));
  });
  it('passive Oath: once per enemy turn Vera takes 40 % of the damage aimed at an adjacent ally', () => {
    const s = noCrits(only(battle(['vera', 'shio'], ['zlata', 'mara']), { a0: 'c3', a1: 'd4', b0: 'e5', b1: 'a7' }));
    turn(s, -1);
    const r = act(s, { type: 'basic', unit: 'b0', target: sq('d4') });
    assert.ok(evs(r.events, 'redirect').some((e) => e.unit === 'a0' && e.from === 'a1'));
    assert.ok(dmgTo(r.events, 'a0') > 0);
  });
  it('ult Morning Watch: enemies within 2 Taunted; Brace +40 % for 2 turns; heals 15 %', () => {
    const s = only(full(battle(['vera'], ['zlata', 'mara']), 'a0'), { a0: 'd4', b0: 'f6', b1: 'h8' });
    U(s, 'a0').hp = 100;
    const r = act(s, { type: 'ult', unit: 'a0' });
    assert.ok(U(r.state, 'b0').statuses.some((x) => x.id === 'taunt'));
    assert.ok(U(r.state, 'a0').statuses.some((x) => x.id === 'brace' && x.value === 0.4));
    assert.equal(U(r.state, 'a0').hp, 100 + Math.floor(0.15 * U(s, 'a0').maxHp));
  });
  it('quirk Stubborn: once per battle a lethal jump-strike leaves her at 1 HP', () => {
    const s = noCrits(only(battle(['vera', 'zlata'], ['shio', 'mara']), { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'a7' }));
    turn(s, -1);
    U(s, 'a0').hp = 5;
    const r = act(s, { type: 'jump', unit: 'b0', path: [sq('e5'), sq('c3')] });
    assert.equal(U(r.state, 'a0').hp, 1);
    assert.ok(U(r.state, 'a0').alive);
    // not against basic attacks (before C6)
    const s2 = noCrits(only(battle(['vera', 'zlata'], ['shio', 'mara']), { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'a7' }));
    turn(s2, -1);
    U(s2, 'a0').hp = 5;
    const r2 = act(s2, { type: 'basic', unit: 'b0', target: sq('d4') });
    assert.equal(U(r2.state, 'a0').alive, false);
  });
});

describe('Mara — Night Thief', () => {
  it('skill Trip: 130 % Umbra to an adjacent enemy and they swap places', () => {
    const s = noCrits(tough(only(battle(['mara'], ['zlata', 'shio']), { a0: 'd4', b0: 'e5', b1: 'h8' }), 'b0'));
    const r = act(s, { type: 'skill', unit: 'a0', target: sq('e5') });
    assert.equal(U(r.state, 'a0').sq, sq('e5'));
    assert.equal(U(r.state, 'b0').sq, sq('d4'));
  });
  it('passive Pickpocket: each hit steals 10 energy for herself', () => {
    const s = noCrits(only(battle(['mara'], ['zlata', 'shio']), { a0: 'd4', b0: 'e5', b1: 'h8' }));
    const r = act(s, { type: 'basic', unit: 'a0', target: sq('e5') });
    assert.ok(own(r.events).some((e) => e.type === 'energy' && e.unit === 'a0' && e.reason === 'steal' && e.delta === 10));
  });
  it('ult Shadow Con: 200 % Umbra on an enemy within 3 and steals a buff', () => {
    const s = noCrits(only(full(battle(['mara'], ['shio', 'zlata']), 'a0'), { a0: 'd4', b0: 'f6', b1: 'h8' }));
    addStatus(s, 'b0', 'brace', 2, { value: 0.3 });
    const r = act(s, { type: 'ult', unit: 'a0', target: sq('f6') });
    assert.ok(dmgTo(r.events, 'b0') > 0);
    assert.ok(U(r.state, 'a0').statuses.some((x) => x.id === 'brace'));
  });
  it('quirk Nimble Fingers: may glide 1 more square after a jump-strike chain', () => {
    const s = noCrits(tough(only(battle(['mara'], ['zlata', 'shio']), { a0: 'c3', b0: 'd4', b1: 'h8' }), 'b0'));
    const r = act(s, { type: 'jump', unit: 'a0', path: [sq('c3'), sq('e5')] });
    assert.equal(unitActions(r.state, 'a0').pending.kind, 'freeMove');
  });
});
