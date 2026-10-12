// Ability-by-ability tests (Epic heroes).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { battle, only, turn, act, evs, own, U, sq, noCrits, setSeal, addStatus, dmgTo, unitActions } from './helpers.js';
import { unitStats } from '../../../src/rpg/battle/index.js';
import { dist } from '../../../src/rpg/battle/board.js';

const full = (s, id) => {
  U(s, id).energy = U(s, id).maxEnergy;
  return s;
};
const tough = (s, ...ids) => {
  for (const id of ids) U(s, id).hp = U(s, id).maxHp = 100000;
  return s;
};

describe('Mizuha — Priestess of the Tide', () => {
  it('skill Tidal Bell: allies in radius 1 heal 140 % and lose a debuff; enemies get a Tide seal and are pushed 1', () => {
    const s = noCrits(only(battle(['mizuha', 'vera'], ['shio', 'mara']), { a0: 'd4', a1: 'c3', b0: 'e5', b1: 'a7' }));
    U(s, 'a1').hp = 100;
    addStatus(s, 'a1', 'weaken', 2);
    const r = act(s, { type: 'skill', unit: 'a0' });
    const heal = own(r.events).find((e) => e.type === 'heal' && e.target === 'a1');
    // round 1 is odd: Ebb and Flow +30 % healing
    assert.equal(heal.amount, Math.floor(U(s, 'a0').atk * 1.4 * 1.3));
    assert.ok(!U(r.state, 'a1').statuses.some((x) => x.id === 'weaken'));
    assert.ok(U(r.state, 'b0').seals.some((x) => x.element === 'tide'));
    assert.equal(U(r.state, 'b0').sq, sq('f6'));
  });
  it('passive Still Water: at her side\'s turn start the lowest-HP ally within 2 heals 6 %', () => {
    const s = only(battle(['mizuha', 'vera'], ['shio', 'mara']), { a0: 'd4', a1: 'c3', b0: 'h8', b1: 'a7' });
    turn(s, -1);
    U(s, 'a1').hp = 100;
    const r = act(s, { type: 'pass', unit: 'b0' });
    const h = evs(r.events, 'heal').find((e) => e.target === 'a1');
    assert.equal(h.amount, Math.floor(0.06 * U(s, 'a1').maxHp * 1.0)); // round 2 (even): no heal bonus
  });
  it('ult High Water: every ally heals 120 % and gains +20 energy; every enemy gets a Tide seal', () => {
    const s = noCrits(only(full(battle(['mizuha', 'vera'], ['shio', 'mara']), 'a0'), { a0: 'd4', a1: 'a1', b0: 'h8', b1: 'a7' }));
    U(s, 'a1').hp = 100;
    const e1 = U(s, 'a1').energy;
    const r = act(s, { type: 'ult', unit: 'a0' });
    assert.ok(own(r.events).some((e) => e.type === 'heal' && e.target === 'a1' && e.amount > 0));
    assert.ok(U(r.state, 'a1').energy >= e1 + 20);
    for (const id of ['b0', 'b1']) assert.ok(U(r.state, id).seals.some((x) => x.element === 'tide'), id);
  });
  it('quirk Ebb and Flow: +30 % healing in odd rounds, +30 % damage in even rounds', () => {
    const mk = (round) => {
      const s = noCrits(only(battle(['mizuha'], ['shio', 'mara']), { a0: 'd4', b0: 'f6', b1: 'a7' }));
      s.round = round;
      return dmgTo(act(s, { type: 'basic', unit: 'a0', target: sq('f6') }).events, 'b0');
    };
    assert.ok(Math.abs(mk(2) / mk(1) - 1.3) < 0.01);
  });
});

describe('Akane — The Scarlet Blade', () => {
  it('skill Scarlet Crescent: 140 % Flame to every adjacent enemy and Burn 2', () => {
    const s = noCrits(only(battle(['akane'], ['shio', 'mara', 'zlata']), { a0: 'd4', b0: 'e5', b1: 'c3', b2: 'f6' }));
    const r = act(s, { type: 'skill', unit: 'a0' });
    for (const id of ['b0', 'b1']) {
      assert.ok(dmgTo(r.events, id) > 0, id);
      assert.ok(U(r.state, id).statuses.some((x) => x.id === 'burn' && x.turns === 2), id);
    }
    assert.equal(dmgTo(r.events, 'b2'), 0);
  });
  it('passive Hot Blood: chains of 4 hops, every hop Burns the victim', () => {
    const s = noCrits(tough(only(battle(['akane'], ['shio', 'mara', 'zlata', 'falk']), { a0: 'c1', b0: 'd2', b1: 'f4', b2: 'f6', b3: 'd6' }), 'b0', 'b1', 'b2', 'b3'));
    const longest = Math.max(...unitActions(s, 'a0').jumps.map((p) => p.length - 1));
    assert.equal(longest, 4);
    const path = unitActions(s, 'a0').jumps.find((p) => p.length === 5);
    const r = act(s, { type: 'jump', unit: 'a0', path });
    for (const id of ['b0', 'b1', 'b2', 'b3']) assert.ok(U(r.state, id).statuses.some((x) => x.id === 'burn'), id);
  });
  it('ult Rise of the Scarlet Sun: 280 % on an adjacent enemy; a KO blasts the enemies around it for 100 %', () => {
    const s = noCrits(only(full(battle(['akane'], ['mara', 'shio', 'zlata']), 'a0'), { a0: 'd4', b0: 'e5', b1: 'f6', b2: 'a7' }));
    U(s, 'b0').hp = 10;
    const r = act(s, { type: 'ult', unit: 'a0', target: sq('e5') });
    assert.ok(evs(r.events, 'ko').some((e) => e.unit === 'b0'));
    assert.ok(dmgTo(r.events, 'b1') > 0);
    const s2 = noCrits(tough(only(full(battle(['akane'], ['mara', 'shio', 'zlata']), 'a0'), { a0: 'd4', b0: 'e5', b1: 'f6', b2: 'a7' }), 'b0'));
    U(s2, 'b0').def = 0;
    const r2 = act(s2, { type: 'ult', unit: 'a0', target: sq('e5') });
    assert.equal(dmgTo(r2.events, 'b1'), 0);
    // 280 % × rows bonus (+36 % at d4: 3 rows advanced)
    assert.equal(dmgTo(r2.events, 'b0'), Math.floor(U(s2, 'a0').atk * 2.8 * 1.36));
  });
  it('quirk Not One Step Back: no backward moves; +12 % damage per row advanced (max +48 %)', () => {
    const dmgAt = (from, at) => {
      const s = noCrits(tough(only(battle(['akane'], ['mara', 'shio']), { a0: from, b0: at, b1: 'a7' }), 'b0'));
      U(s, 'b0').def = 0;
      return dmgTo(act(s, { type: 'basic', unit: 'a0', target: sq(at) }).events, 'b0');
    };
    const atk = only(battle(['akane'], ['mara']), {}).units[0].atk;
    assert.equal(dmgAt('a1', 'b2'), Math.floor(atk * 1.0));
    assert.equal(dmgAt('d4', 'e5'), Math.floor(atk * 1.36));
    assert.equal(dmgAt('c7', 'd8'), Math.floor(atk * 1.48));
  });
});

describe('Volta — Witch of the Thunder Tower', () => {
  it('skill Ball Lightning: a 1-HP ward (2 turns) that zaps the nearest enemy within 2 for 80 % at her turn start', () => {
    const s = noCrits(only(battle(['volta', 'vera'], ['shio', 'mara']), { a0: 'd4', a1: 'a1', b0: 'g5', b1: 'a7' }));
    let r = act(s, { type: 'skill', unit: 'a0', target: sq('f4') });
    const w = r.state.wards.find((x) => x.kind === 'ball-lightning');
    assert.ok(w && w.hp === 1 && w.turns === 2);
    // Fidget: Volta must blink after the action
    const pend = unitActions(r.state, 'a0').pending;
    r = act(r.state, { type: 'move', unit: 'a0', to: pend.squares[0] });
    r = act(r.state, { type: 'pass', unit: 'b1' });
    const zap = evs(r.events, 'damage').find((e) => e.target === 'b0' && e.source === 'a0');
    assert.ok(zap && zap.amount > 0);
    assert.ok(evs(r.events, 'wardAct').some((e) => e.kind === 'ball-lightning'));
  });
  it('passive Lightning Rod: +10 energy when her side triggers Detonation, Arc or Brittleness', () => {
    const s = noCrits(only(battle(['akane', 'volta'], ['zlata', 'mara']), { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'a7' }));
    setSeal(s, 'b0', 'storm');
    const r = act(s, { type: 'basic', unit: 'a0', target: sq('e5') });
    assert.ok(own(r.events).some((e) => e.type === 'energy' && e.unit === 'a1' && e.delta === 10));
  });
  it('ult Scheduled Thunderstorm: 160 % to each enemy on a cross (centre + 2 squares each straight direction)', () => {
    const s = noCrits(only(full(battle(['volta'], ['shio', 'mara', 'zlata', 'falk']), 'a0'), { a0: 'a1', b0: 'e5', b1: 'e3', b2: 'g5', b3: 'f6' }));
    const r = act(s, { type: 'ult', unit: 'a0', target: sq('e5') });
    for (const id of ['b0', 'b1', 'b2']) assert.ok(dmgTo(r.events, id) > 0, id);
    assert.equal(dmgTo(r.events, 'b3'), 0);
  });
  it('quirk Fidget: after acting she must teleport within 2', () => {
    const s = noCrits(only(battle(['volta'], ['shio', 'mara']), { a0: 'd4', b0: 'f6', b1: 'a7' }));
    const r = act(s, { type: 'basic', unit: 'a0', target: sq('f6') });
    const p = unitActions(r.state, 'a0').pending;
    assert.equal(p.kind, 'blink');
    assert.ok(p.squares.every((q) => dist(q, sq('d4')) <= 2));
  });
});

describe('Koyuki — The Snow Archer', () => {
  it('skill Icicle Volley: two arrows down two diagonals (5 squares): 140 % to the first enemy on each', () => {
    const s = noCrits(only(battle(['koyuki'], ['shio', 'mara', 'zlata']), { a0: 'd4', b0: 'f6', b1: 'b2', b2: 'g7' }));
    const r = act(s, { type: 'skill', unit: 'a0', targets: [sq('e5'), sq('c3')] });
    assert.ok(dmgTo(r.events, 'b0') > 0 && dmgTo(r.events, 'b1') > 0);
    assert.equal(dmgTo(r.events, 'b2'), 0);
  });
  it('passive Frost on the String: hits on targets 3+ squares away Slow them', () => {
    const s = noCrits(only(battle(['koyuki'], ['shio', 'mara']), { a0: 'a1', b0: 'd4', b1: 'h8' }));
    const r = act(s, { type: 'basic', unit: 'a0', target: sq('d4') });
    assert.ok(U(r.state, 'b0').statuses.some((x) => x.id === 'slow'));
    const s2 = noCrits(only(battle(['koyuki'], ['shio', 'mara']), { a0: 'a1', b0: 'c3', b1: 'h8' }));
    const r2 = act(s2, { type: 'basic', unit: 'a0', target: sq('c3') });
    assert.ok(!U(r2.state, 'b0').statuses.some((x) => x.id === 'slow'));
  });
  it('ult Silent Blizzard: 170 % and Slow 2 to every enemy in the chosen row', () => {
    const s = noCrits(only(full(battle(['koyuki'], ['shio', 'mara', 'zlata']), 'a0'), { a0: 'a1', b0: 'b4', b1: 'h4', b2: 'c5' }));
    const r = act(s, { type: 'ult', unit: 'a0', target: sq('d4') });
    for (const id of ['b0', 'b1']) {
      assert.ok(dmgTo(r.events, id) > 0, id);
      assert.ok(U(r.state, id).statuses.some((x) => x.id === 'slow' && x.turns === 2), id);
    }
    assert.equal(dmgTo(r.events, 'b2'), 0);
  });
  it('quirk Whiteout: single and line attacks from 3+ squares cannot target her', () => {
    const s = only(battle(['maren'], ['koyuki', 'vera']), { a0: 'a1', b0: 'd4', b1: 'h8' });
    assert.deepEqual(unitActions(s, 'a0').basic, []);
    const s2 = only(battle(['maren'], ['koyuki', 'vera']), { a0: 'b2', b0: 'd4', b1: 'h8' });
    assert.deepEqual(unitActions(s2, 'a0').basic, [sq('d4')]);
  });
});

describe('Lucille — Candle of Dawn', () => {
  it('skill Candle Blessing: heals 160 %, Inspire (+25 % ATK, 2 turns) and removes a debuff', () => {
    const s = only(battle(['lucille', 'vera'], ['shio', 'mara']), { a0: 'd4', a1: 'f6', b0: 'h8', b1: 'a7' });
    U(s, 'a1').hp = 100;
    addStatus(s, 'a1', 'mark', 2);
    const r = act(s, { type: 'skill', unit: 'a0', target: sq('f6') });
    assert.equal(own(r.events).find((e) => e.type === 'heal' && e.target === 'a1').amount, Math.floor(U(s, 'a0').atk * 1.6));
    assert.ok(U(r.state, 'a1').statuses.some((x) => x.id === 'inspire' && x.value === 0.25));
    assert.ok(!U(r.state, 'a1').statuses.some((x) => x.id === 'mark'));
  });
  it('passive Warm Light: overhealing becomes a shield (max 20 % of the target max HP)', () => {
    const s = only(battle(['lucille', 'vera'], ['shio', 'mara']), { a0: 'd4', a1: 'f6', b0: 'h8', b1: 'a7' });
    U(s, 'a1').hp = U(s, 'a1').maxHp - 10;
    const r = act(s, { type: 'skill', unit: 'a0', target: sq('f6') });
    const over = Math.floor(U(s, 'a0').atk * 1.6) - 10;
    assert.equal(U(r.state, 'a1').shield, Math.floor(Math.min(over, 0.2 * U(s, 'a1').maxHp)));
  });
  it('ult Dawn Litany: revives the last KO\'d ally at 40 % on her back rows and heals all 60 %; else heals all 140 %', () => {
    const s = only(full(battle(['lucille', 'vera', 'shio'], ['zlata', 'mara']), 'a0'), { a0: 'd4', a1: 'f6', a2: null, b0: 'h8', b1: 'a7' });
    U(s, 'a2').koAt = 1;
    U(s, 'a2').final = false;
    const r = act(s, { type: 'ult', unit: 'a0' });
    const rv = evs(r.events, 'revive')[0];
    assert.equal(rv.unit, 'a2');
    assert.equal(U(r.state, 'a2').hp, Math.floor(0.4 * U(r.state, 'a2').maxHp));
    assert.ok([6, 7].includes(rv.sq >> 3));
    const s2 = only(full(battle(['lucille', 'vera'], ['zlata', 'mara']), 'a0'), { a0: 'd4', a1: 'f6', b0: 'h8', b1: 'a7' });
    U(s2, 'a1').hp = 100;
    const r2 = act(s2, { type: 'ult', unit: 'a0' });
    assert.equal(own(r2.events).find((e) => e.type === 'heal' && e.target === 'a1').amount, Math.floor(U(s2, 'a0').atk * 1.4));
  });
  it('quirk Ember of Hope: a KO leaves a Candle that heals adjacent allies 8 % at her side\'s turn start', () => {
    const s = noCrits(only(battle(['lucille', 'vera'], ['shio', 'mara']), { a0: 'd4', a1: 'c3', b0: 'e5', b1: 'a7' }));
    turn(s, -1);
    U(s, 'a0').hp = 1;
    U(s, 'a1').hp = 100;
    let r = act(s, { type: 'basic', unit: 'b0', target: sq('d4') });
    const candle = r.state.wards.find((w) => w.special === 'candle');
    assert.ok(candle && candle.sq === sq('d4') && candle.turns === 3);
    assert.ok(evs(r.events, 'heal').some((e) => e.target === 'a1' && e.reason === 'candle' && e.amount === Math.floor(0.08 * U(s, 'a1').maxHp)));
  });
});

describe('Karasu — Midnight Crow', () => {
  it('skill Crow\'s Passage: flies next to an enemy within 4 and strikes for 160 % (+30 % crit)', () => {
    const s = noCrits(only(battle(['karasu'], ['shio', 'mara']), { a0: 'a1', b0: 'e5', b1: 'h8' }));
    const r = act(s, { type: 'skill', unit: 'a0', target: sq('e5') });
    assert.equal(dist(U(r.state, 'a0').sq, sq('e5')), 1);
    assert.ok(dmgTo(r.events, 'b0') > 0);
  });
  it('passive Feather Mark: every hit Marks the target (2 turns)', () => {
    const s = noCrits(only(battle(['karasu'], ['shio', 'mara']), { a0: 'd4', b0: 'e5', b1: 'h8' }));
    const r = act(s, { type: 'basic', unit: 'a0', target: sq('e5') });
    assert.ok(U(r.state, 'b0').statuses.some((x) => x.id === 'mark' && x.turns === 2));
  });
  it('ult Starless Midnight: 260 %, and a target left at ≤ 30 % HP is executed', () => {
    const s = noCrits(only(full(battle(['karasu'], ['zlata', 'mara']), 'a0'), { a0: 'd4', b0: 'f6', b1: 'h8' }));
    U(s, 'b0').hp = U(s, 'b0').maxHp = 100000;
    U(s, 'b0').hp = 30001;
    U(s, 'b0').def = 0;
    const r = act(s, { type: 'ult', unit: 'a0', target: sq('f6') });
    assert.ok(evs(r.events, 'execute').some((e) => e.unit === 'b0'));
    assert.equal(U(r.state, 'b0').alive, false);
  });
  it('quirk Murder of Crows: +15 % damage per Marked enemy (max +45 %)', () => {
    const mk = (marks) => {
      const s = noCrits(tough(only(battle(['karasu'], ['shio', 'mara', 'zlata', 'falk']), { a0: 'd4', b0: 'e5', b1: 'h8', b2: 'a7', b3: 'b8' }), 'b0'));
      ['b1', 'b2', 'b3'].slice(0, marks).forEach((id) => addStatus(s, id, 'mark', 2));
      U(s, 'b0').def = 0;
      return dmgTo(act(s, { type: 'basic', unit: 'a0', target: sq('e5') }).events, 'b0');
    };
    const base = mk(0);
    assert.ok(Math.abs(mk(2) / base - 1.3) < 0.01);
    assert.ok(Math.abs(mk(3) / base - 1.45) < 0.01);
  });
});

describe('Zlata — The Amber Bastion', () => {
  it('skill Earth Rumble: enemies within radius 2 are Taunted; she gains a 20 % shield', () => {
    const s = only(battle(['zlata'], ['shio', 'mara', 'falk']), { a0: 'd4', b0: 'f6', b1: 'e5', b2: 'h8' });
    const r = act(s, { type: 'skill', unit: 'a0' });
    for (const id of ['b0', 'b1']) assert.ok(U(r.state, id).statuses.some((x) => x.id === 'taunt' && x.source === 'a0'), id);
    assert.ok(!U(r.state, 'b2').statuses.some((x) => x.id === 'taunt'));
    assert.ok(U(r.state, 'a0').shield >= Math.floor(0.2 * U(s, 'a0').maxHp));
  });
  it('passive Amber Skin: once per enemy turn, when hit, a 6 % shield', () => {
    const s = noCrits(only(battle(['zlata', 'vera'], ['shio', 'mara']), { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'a7' }));
    turn(s, -1);
    const r = act(s, { type: 'basic', unit: 'b0', target: sq('d4') });
    assert.equal(U(r.state, 'a0').shield, Math.floor(0.06 * U(s, 'a0').maxHp));
  });
  it('ult Amber Fortress: allies within 2 get a 25 % shield; adjacent enemies take 200 % DEF Terra and are Rooted', () => {
    const s = noCrits(only(full(battle(['zlata', 'vera'], ['shio', 'mara']), 'a0'), { a0: 'd4', a1: 'b2', b0: 'e5', b1: 'h8' }));
    const r = act(s, { type: 'ult', unit: 'a0' });
    assert.equal(U(r.state, 'a1').shield, Math.floor(0.25 * U(s, 'a0').maxHp));
    assert.ok(dmgTo(r.events, 'b0') > 0);
    assert.ok(U(r.state, 'b0').statuses.some((x) => x.id === 'root'));
    assert.equal(dmgTo(r.events, 'b1'), 0);
  });
  it('quirk Friend Toss: throws an adjacent ally along the diagonal over pieces to the farthest empty square within 3 (+10 energy, cooldown 2)', () => {
    const s = only(battle(['zlata', 'shio'], ['mara', 'falk']), { a0: 'c3', a1: 'd4', b0: 'e5', b1: 'h8' });
    const e1 = U(s, 'a1').energy;
    const r = act(s, { type: 'quirk', unit: 'a0', quirk: 'friend-toss', target: sq('d4') });
    assert.equal(U(r.state, 'a1').sq, sq('g7'));
    assert.equal(U(r.state, 'a1').energy, e1 + 10);
    assert.equal(U(r.state, 'a0').cd.quirk['friend-toss'], 2);
  });
  it('quirk Heavy Landing: a jump-strike landing deals 100 % DEF Terra to enemies around the landing square', () => {
    const s = noCrits(tough(only(battle(['zlata'], ['shio', 'mara', 'falk']), { a0: 'c3', b0: 'd4', b1: 'f6', b2: 'h8' }), 'b0', 'b1'));
    const r = act(s, { type: 'jump', unit: 'a0', path: [sq('c3'), sq('e5')] });
    assert.ok(dmgTo(r.events, 'b1') > 0);
  });
});

describe('Kaede — Maple Whirlwind', () => {
  it('skill Maple Whirl: pulls enemies on her diagonals within 2 one square closer, then 120 % Gale to adjacent enemies', () => {
    const s = noCrits(only(battle(['kaede'], ['shio', 'mara']), { a0: 'd4', b0: 'f6', b1: 'h8' }));
    const r = act(s, { type: 'skill', unit: 'a0' });
    assert.equal(U(r.state, 'b0').sq, sq('e5'));
    assert.ok(dmgTo(r.events, 'b0') > 0);
  });
  it('passive Leaf Dance: each hop gives +5 energy to the ally with the least energy', () => {
    const s = noCrits(tough(only(battle(['kaede', 'vera'], ['shio', 'mara']), { a0: 'c3', a1: 'a1', b0: 'd4', b1: 'h8' }), 'b0'));
    U(s, 'a1').energy = 0;
    const r = act(s, { type: 'jump', unit: 'a0', path: [sq('c3'), sq('e5')] });
    assert.equal(U(r.state, 'a1').energy, 5);
  });
  it('ult Autumn Hurricane: 160 % Gale to enemies on all four diagonals (3 squares) and a 1-square push', () => {
    const s = noCrits(tough(only(full(battle(['kaede'], ['shio', 'mara']), 'a0'), { a0: 'd4', b0: 'f6', b1: 'b2' }), 'b0', 'b1'));
    const r = act(s, { type: 'ult', unit: 'a0' });
    assert.ok(dmgTo(r.events, 'b0') > 0 && dmgTo(r.events, 'b1') > 0);
    assert.equal(U(r.state, 'b0').sq, sq('g7'));
    assert.equal(U(r.state, 'b1').sq, sq('a1'));
  });
  it('quirk Leapfrog: vaults over an adjacent ally as a step', () => {
    const s = only(battle(['kaede', 'vera'], ['shio']), { a0: 'd4', a1: 'e5' });
    assert.ok(unitActions(s, 'a0').moves.includes(sq('f6')));
    void unitStats;
  });
});
