// Ability-by-ability tests (Mythic + Legendary): every skill, ultimate, passive and quirk does what its
// description in heroes.js says.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { battle, only, place, turn, act, evs, own, U, sq, noCrits, setSeal, addStatus, dmgTo, unitActions, legalActions } from './helpers.js';
import { unitStats } from '../../../src/rpg/battle/index.js';
import { critChance } from '../../../src/rpg/battle/stats.js';
import { rowOf } from '../../../src/rpg/battle/board.js';

const full = (s, id) => {
  U(s, id).energy = U(s, id).maxEnergy;
  return s;
};

describe('Liora — Queen of the Celestial Board', () => {
  it('quirk Born Crowned: starts crowned without the heal / energy; loses the crown at 30 % HP in one enemy turn', () => {
    const s = battle(['liora', 'vera'], ['shio', 'mara']);
    const l = U(s, 'a0');
    assert.ok(l.awakened);
    assert.ok(l.statuses.some((x) => x.id === 'crown'));
    assert.equal(l.energy, Math.floor(0.4 * l.maxEnergy));
    assert.equal(unitStats(s, 'a0').atk, Math.floor(l.atk * 1.2));
    const x = noCrits(only(battle(['liora', 'vera'], ['shio', 'mara']), { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'a7' }));
    turn(x, -1);
    U(x, 'a0').hp = U(x, 'a0').maxHp = 10000;
    U(x, 'b0').atk = 6000;
    const r = act(x, { type: 'basic', unit: 'b0', target: sq('d4') });
    assert.ok(dmgTo(r.events, 'a0') >= 3000);
    assert.ok(evs(r.events, 'crownLost').some((e) => e.unit === 'a0'));
    assert.equal(U(r.state, 'a0').awakened, false);
    // reaching the enemy back row restores it with the full Awakening (first time)
    const y = turn(r.state, 1);
    U(y, 'a0').sq = sq('c7');
    const r2 = act(y, { type: 'move', unit: 'a0', to: sq('d8') });
    assert.ok(U(r2.state, 'a0').awakened);
    assert.ok(evs(r2.events, 'awaken').some((e) => e.full));
  });
  it('quirk Heavenly Swap: once per battle swaps with any ally instead of moving', () => {
    const s = only(battle(['liora', 'vera'], ['shio']), { a0: 'a1', a1: 'h8' });
    assert.deepEqual(unitActions(s, 'a0').swaps, [sq('h8')]);
  });
  it('skill Dawn Verdict: 160 % to enemies on a 3-square line, allies on it +15 energy, she lands on the farthest empty square', () => {
    const s = noCrits(only(battle(['liora', 'vera'], ['mara', 'shio']), { a0: 'c3', a1: 'e5', b0: 'd4', b1: 'a7' }));
    U(s, 'b0').def = 0;
    U(s, 'b0').hp = U(s, 'b0').maxHp = 100000;
    const e1 = U(s, 'a1').energy;
    const r = act(s, { type: 'skill', unit: 'a0', target: sq('d4') });
    assert.equal(dmgTo(r.events, 'b0'), Math.floor(U(s, 'a0').atk * 1.2 * 1.6 * 1.3)); // crown +20 %, Radiance → Umbra ×1.3
    assert.equal(U(r.state, 'a1').energy, e1 + 15);
    assert.equal(U(r.state, 'a0').sq, sq('f6'));
  });
  it('passive Light at the End: a KO gives every ally +10 energy and heals her 10 %', () => {
    const s = noCrits(only(battle(['liora', 'vera'], ['mara', 'shio']), { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'a7' }));
    U(s, 'b0').hp = 1;
    U(s, 'a0').hp = 100;
    const e1 = U(s, 'a1').energy;
    const r = act(s, { type: 'basic', unit: 'a0', target: sq('e5') });
    assert.equal(U(r.state, 'a1').energy, e1 + 10);
    assert.ok(own(r.events).some((e) => e.type === 'heal' && e.target === 'a0' && e.amount === Math.floor(0.1 * U(s, 'a0').maxHp)));
  });
  it('ult Hymn: 190 % + Mark to enemies on both diagonals; allies there heal 15 %', () => {
    const s = noCrits(only(full(battle(['liora', 'vera'], ['zlata', 'shio']), 'a0'), { a0: 'd4', a1: 'b2', b0: 'g7', b1: 'a5' }));
    U(s, 'a1').hp = 100;
    const r = act(s, { type: 'ult', unit: 'a0' });
    assert.ok(dmgTo(r.events, 'b0') > 0 && dmgTo(r.events, 'b1') === 0);
    assert.ok(U(r.state, 'b0').statuses.some((x) => x.id === 'mark'));
    assert.ok(own(r.events).some((e) => e.type === 'heal' && e.target === 'a1' && e.amount === Math.floor(0.15 * U(s, 'a1').maxHp)));
    assert.equal(evs(r.events, 'cast')[0].vfx, 'ult-liora');
  });
});

describe('Nocturna — Empress of the Eclipse', () => {
  it('skill Moonfall Rift: 130 % Umbra in radius 1 of a square within 3; the centre is Silenced', () => {
    const s = noCrits(only(battle(['nocturna'], ['mara', 'shio', 'vera']), { a0: 'd4', b0: 'f6', b1: 'g7', b2: 'a7' }));
    const r = act(s, { type: 'skill', unit: 'a0', target: sq('f6') });
    assert.ok(dmgTo(r.events, 'b0') > 0 && dmgTo(r.events, 'b1') > 0 && dmgTo(r.events, 'b2') === 0);
    assert.ok(U(r.state, 'b0').statuses.some((x) => x.id === 'silence'));
    assert.ok(!U(r.state, 'b1').statuses.some((x) => x.id === 'silence'));
  });
  it('passive Hunger of the Abyss: hits burn 10 energy; an enemy Ultimate gives her +20', () => {
    const s = noCrits(only(battle(['nocturna', 'vera'], ['shio', 'mara']), { a0: 'd4', a1: 'a1', b0: 'f6', b1: 'a7' }));
    const e0 = U(s, 'b0').energy;
    const r = act(s, { type: 'basic', unit: 'a0', target: sq('f6') });
    assert.equal(U(r.state, 'b0').energy, e0 + 6 - 10);
    const t = full(turn(noCrits(only(battle(['nocturna', 'vera'], ['shio', 'mara']), { a0: 'd4', a1: 'a1', b0: 'f6', b1: 'a7' })), -1), 'b0');
    const n0 = U(t, 'a0').energy;
    const r2 = act(t, { type: 'ult', unit: 'b0', target: sq('e5') });
    assert.ok(own(r2.events).some((e) => e.type === 'energy' && e.unit === 'a0' && e.reason === 'effect' && e.delta === 20));
    void n0;
  });
  it('ult Imperial Eclipse: every enemy takes 110 %, −20 energy and Blight 2', () => {
    const s = noCrits(only(full(battle(['nocturna'], ['shio', 'mara', 'vera']), 'a0'), { a0: 'd4', b0: 'h8', b1: 'a7', b2: 'f2' }));
    const before = ['b0', 'b1', 'b2'].map((id) => U(s, id).energy);
    const r = act(s, { type: 'ult', unit: 'a0' });
    ['b0', 'b1', 'b2'].forEach((id, i) => {
      assert.ok(dmgTo(r.events, id) > 0, id);
      assert.ok(U(r.state, id).statuses.some((x) => x.id === 'blight' && x.turns === 2), id);
      assert.ok(U(r.state, id).energy <= before[i] + 6 - 20, id);
    });
  });
  it('quirk Dusk Double: a decoy (30 % HP) on her back row saves her once from a lethal hit', () => {
    const s = battle(['nocturna', 'vera'], ['shio', 'mara']);
    const decoy = s.wards.find((w) => w.special === 'decoy');
    assert.ok(decoy);
    assert.equal(decoy.hp, Math.floor(0.3 * U(s, 'a0').maxHp));
    assert.equal(rowOf(decoy.sq), 7);
    place(s, { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'a7' });
    noCrits(s);
    turn(s, -1);
    U(s, 'a0').hp = 1;
    const r = act(s, { type: 'basic', unit: 'b0', target: sq('d4') });
    const n = U(r.state, 'a0');
    assert.ok(n.alive);
    assert.equal(n.sq, decoy.sq);
    assert.equal(n.hp, Math.floor(0.3 * n.maxHp));
    assert.ok(n.statuses.some((x) => x.id === 'untargetable'));
    assert.ok(!r.state.wards.some((w) => w.special === 'decoy'));
    assert.ok(evs(r.events, 'survive').some((e) => e.rule === 'decoyWard'));
  });
  it('quirk Stride Through Darkness: teleports instead of walking', () => {
    const s = only(battle(['nocturna'], ['shio']), { a0: 'd4', b0: 'e5' });
    assert.ok(unitActions(s, 'a0').moves.includes(sq('f6'))); // over the enemy
    const r = act(s, { type: 'move', unit: 'a0', to: sq('f6') });
    assert.equal(evs(r.events, 'move')[0].kind, 'blink');
  });
});

describe('Reika — The Thunder Ballista', () => {
  it('skill Rail Shot: 150 % to every enemy on the whole diagonal; the first is pushed 1', () => {
    const s = noCrits(only(battle(['reika'], ['shio', 'mara', 'vera']), { a0: 'b2', b0: 'd4', b1: 'f6', b2: 'a7' }));
    const r = act(s, { type: 'skill', unit: 'a0', target: sq('c3') });
    assert.ok(dmgTo(r.events, 'b0') > 0 && dmgTo(r.events, 'b1') > 0);
    assert.equal(U(r.state, 'b0').sq, sq('e5'));
  });
  it('passive Cold Calculation: basic range 5; +20 % crit chance at 3+ squares', () => {
    const s = only(battle(['reika'], ['shio', 'vera']), { a0: 'a1', b0: 'f6', b1: 'a7' });
    assert.deepEqual(unitActions(s, 'a0').basic, [sq('f6')]);
    const base = U(s, 'a0').crit;
    assert.equal(critChance(s, U(s, 'a0'), { target: U(s, 'b0') }), base + 20);
  });
  it('ult Heaven Ballista: 200 % on any enemy, then 2 bounces of 100 % to enemies within 2', () => {
    const s = noCrits(only(full(battle(['reika'], ['shio', 'mara', 'torvald', 'zlata']), 'a0'), { a0: 'a1', b0: 'd6', b1: 'e7', b2: 'f8', b3: 'h2' }));
    for (const u of s.units) if (u.side === -1) u.hp = u.maxHp = 100000;
    const r = act(s, { type: 'ult', unit: 'a0', target: sq('d6') });
    assert.equal(evs(r.events, 'bounce').length, 2);
    for (const id of ['b0', 'b1', 'b2']) assert.ok(dmgTo(r.events, id) > 0, id);
    assert.equal(dmgTo(r.events, 'b3'), 0);
  });
  it('quirk Charge: +1 Charge per own turn not activated (max 3); next damaging action spends them: +20 % each and piercing shots', () => {
    let s = noCrits(only(battle(['reika', 'vera'], ['shio', 'mara']), { a0: 'a1', a1: 'h2', b0: 'c3', b1: 'e5' }));
    for (let i = 0; i < 4; i++) {
      s = act(s, { type: 'pass', unit: 'a1' }).state;
      s = act(s, { type: 'pass', unit: 'b1' }).state;
    }
    assert.equal(U(s, 'a0').statuses.find((x) => x.id === 'charge').stacks, 3);
    const r = act(s, { type: 'basic', unit: 'a0', target: sq('c3') });
    assert.ok(dmgTo(r.events, 'b0') > 0 && dmgTo(r.events, 'b1') > 0, 'pierces');
    assert.ok(!U(r.state, 'a0').statuses.some((x) => x.id === 'charge'));
    const plain = noCrits(only(battle(['reika', 'vera'], ['shio', 'mara']), { a0: 'a1', a1: 'h2', b0: 'c3', b1: 'h8' }));
    const r0 = act(plain, { type: 'basic', unit: 'a0', target: sq('c3') });
    // damage bonuses add up: (1 + 0.15 aim + 3 × 0.2) / (1 + 0.15 aim)
    assert.ok(Math.abs(dmgTo(r.events, 'b0') / dmgTo(r0.events, 'b0') - 1.75 / 1.15) < 0.01);
  });
  it('quirk Personal Space: once per enemy turn she hops back when an enemy ends next to her', () => {
    const s = only(battle(['reika', 'vera'], ['shio', 'mara']), { a0: 'd4', a1: 'a1', b0: 'f6', b1: 'a7' });
    turn(s, -1);
    const r = act(act(s, { type: 'move', unit: 'b0', to: sq('e5') }).state, { type: 'pass', unit: 'b0' });
    assert.ok(evs(r.events, 'displace').some((e) => e.unit === 'a0' && e.kind === 'retreat'));
    assert.ok(rowOf(U(r.state, 'a0').sq) > rowOf(sq('d4')));
  });
});

describe('Fuyuka — The Glacier Citadel', () => {
  it('skill Ice Bastion: up to 2 ice walls (25 % HP, 3 turns) on adjacent squares; allies next to a wall get +20 % DEF', () => {
    const s = only(battle(['fuyuka', 'vera'], ['shio', 'mara']), { a0: 'd4', a1: 'b6', b0: 'h8', b1: 'a7' });
    const def0 = unitStats(s, 'a1').def;
    const r = act(s, { type: 'skill', unit: 'a0', targets: [sq('c5'), sq('e5')] });
    const walls = r.state.wards.filter((w) => w.kind === 'ice-wall');
    assert.equal(walls.length, 2);
    assert.equal(walls[0].hp, Math.floor(0.25 * U(s, 'a0').maxHp));
    assert.equal(walls[0].turns, 3);
    assert.equal(unitStats(r.state, 'a1').def, Math.floor(U(s, 'a1').def * 1.2));
    assert.ok(unitStats(r.state, 'a1').def > def0);
  });
  it('passive Regal Chill: a melee attacker gets a Frost seal and Slow', () => {
    const s = noCrits(only(battle(['fuyuka', 'vera'], ['shio', 'mara']), { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'a7' }));
    turn(s, -1);
    const r = act(s, { type: 'basic', unit: 'b0', target: sq('d4') });
    assert.ok(U(r.state, 'b0').seals.some((x) => x.element === 'frost'));
    assert.ok(U(r.state, 'b0').statuses.some((x) => x.id === 'slow'));
  });
  it('ult Palace of Eternal Winter: radius 2 — enemies take 150 % DEF Frost and are Frozen; allies get a 20 % shield', () => {
    const s = noCrits(only(full(battle(['fuyuka', 'vera'], ['shio', 'mara']), 'a0'), { a0: 'd4', a1: 'c3', b0: 'f6', b1: 'a7' }));
    const r = act(s, { type: 'ult', unit: 'a0' });
    assert.ok(dmgTo(r.events, 'b0') > 0);
    assert.ok(U(r.state, 'b0').statuses.some((x) => x.id === 'frozen'));
    assert.equal(U(r.state, 'a1').shield, Math.floor(0.2 * U(s, 'a0').maxHp));
  });
  it('quirk Royal Etiquette: cannot be displaced; only crowned enemies and Shadows can jump her', () => {
    const s = only(battle(['shio', 'mara'], ['fuyuka']), { a0: 'c3', a1: 'g3', b0: 'd4' });
    assert.deepEqual(unitActions(s, 'a0').jumps, []);
    const s2 = only(battle(['mara'], ['fuyuka']), { a0: 'c3', b0: 'd4' });
    assert.ok(unitActions(s2, 'a0').jumps.length > 0);
  });
  it('quirk Ice Throne: a shield of 10 % max HP if she did not move during her activation', () => {
    const s = noCrits(only(battle(['fuyuka', 'vera'], ['shio', 'mara']), { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'a7' }));
    const r = act(s, { type: 'basic', unit: 'a0', target: sq('e5') });
    assert.equal(U(r.state, 'a0').shield, Math.floor(0.1 * U(s, 'a0').maxHp));
    // moving before acting: no shield; a Wait is not an action: no shield either
    const m = noCrits(only(battle(['fuyuka', 'vera'], ['shio', 'mara']), { a0: 'd4', a1: 'a1', b0: 'f6', b1: 'a7' }));
    const r3 = act(m, { type: 'basic', unit: 'a0', to: sq('e5'), target: sq('f6') });
    assert.equal(U(r3.state, 'a0').shield, 0);
    const r4 = act(m, { type: 'pass', unit: 'a0' });
    assert.equal(U(r4.state, 'a0').shield, 0);
  });
});

describe('Vermilia — Phoenix of the Final Move', () => {
  it('skill Fire Fan: 100 % Flame to enemies on all four diagonals within 2', () => {
    const s = noCrits(only(battle(['vermilia'], ['shio', 'mara', 'torvald']), { a0: 'd4', b0: 'f6', b1: 'b2', b2: 'g7' }));
    const r = act(s, { type: 'skill', unit: 'a0' });
    assert.ok(dmgTo(r.events, 'b0') > 0 && dmgTo(r.events, 'b1') > 0 && dmgTo(r.events, 'b2') === 0);
  });
  it('passive Ashes to Ashes: every hit Burns (2); +25 % damage to Burning targets', () => {
    const s = noCrits(only(battle(['vermilia'], ['shio', 'vera']), { a0: 'd4', b0: 'f6', b1: 'a7' }));
    const r = act(s, { type: 'basic', unit: 'a0', target: sq('f6') });
    assert.ok(U(r.state, 'b0').statuses.some((x) => x.id === 'burn' && x.turns === 2));
    const s2 = JSON.parse(JSON.stringify(s));
    addStatus(s2, 'b0', 'burn', 2, { source: 'a0' });
    const r2 = act(s2, { type: 'basic', unit: 'a0', target: sq('f6') });
    assert.ok(Math.abs(dmgTo(r2.events, 'b0') / dmgTo(r.events, 'b0') - 1.25) < 0.01);
  });
  it('ult Final Move: 180 % to every enemy on a diagonal, burning trail, lands on the farthest empty square (crowned on the back row)', () => {
    const s = noCrits(only(full(battle(['vermilia'], ['shio', 'mara', 'vera']), 'a0'), { a0: 'a1', b0: 'c3', b1: 'e5', b2: 'h2' }));
    const r = act(s, { type: 'ult', unit: 'a0', target: sq('b2') });
    assert.ok(dmgTo(r.events, 'b0') > 0 && dmgTo(r.events, 'b1') > 0);
    assert.equal(U(r.state, 'a0').sq, sq('h8'));
    assert.ok(U(r.state, 'a0').awakened);
    const z = r.state.zones.find((x) => x.kind === 'phoenix-trail');
    assert.ok(z && z.sqs.includes(sq('d4')));
  });
  it('quirk Rebirth: once per battle an Egg (25 % HP) that hatches at the start of her side\'s 2nd turn with 40 % HP and full energy', () => {
    let s = noCrits(only(battle(['vermilia', 'vera'], ['shio', 'mara']), { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'a7' }));
    turn(s, -1);
    U(s, 'a0').hp = 1;
    let r = act(s, { type: 'basic', unit: 'b0', target: sq('d4') });
    const egg = r.state.wards.find((w) => w.special === 'egg');
    assert.ok(egg);
    assert.equal(egg.sq, sq('d4'));
    assert.equal(egg.hp, Math.floor(0.25 * U(s, 'a0').maxHp));
    s = act(r.state, { type: 'pass', unit: 'a1' }).state; // own turn 1
    s = act(s, { type: 'pass', unit: 'b1' }).state; // enemy turn; own turn 2 starts → hatch
    const v = U(s, 'a0');
    assert.ok(v.alive);
    assert.equal(v.hp, Math.floor(0.4 * v.maxHp));
    assert.equal(v.energy, v.maxEnergy);
    assert.equal(v.sq, sq('d4'));
  });
  it('quirk Rebirth: a broken Egg is a final KO', () => {
    const s = noCrits(only(battle(['vermilia', 'vera'], ['shio', 'mara']), { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'a7' }));
    turn(s, -1);
    U(s, 'a0').hp = 1;
    let st = act(s, { type: 'basic', unit: 'b0', target: sq('d4') }).state;
    st = act(st, { type: 'pass', unit: 'a1' }).state;
    st.wards.find((w) => w.special === 'egg').hp = 1;
    const r = act(st, { type: 'basic', unit: 'b0', target: sq('d4') });
    assert.ok(evs(r.events, 'ko').some((e) => e.unit === 'a0' && e.final));
    assert.equal(U(r.state, 'a0').final, true);
  });
  it('quirk Diva: +10 energy when an ally casts an Ultimate', () => {
    const s = noCrits(only(full(battle(['vera', 'vermilia'], ['shio', 'mara']), 'a0'), { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'a7' }));
    const e0 = U(s, 'a1').energy;
    const r = act(s, { type: 'ult', unit: 'a0' });
    assert.equal(own(r.events).filter((e) => e.type === 'energy' && e.unit === 'a1').reduce((a, e) => a + e.delta, 0), 10);
    void e0;
  });
});

describe('Tsubame — Swallow of the Storm', () => {
  it('skill Swallow\'s Stroke: flying jump-strike (enemy up to 3 away, land up to 2 beyond) for 150 %', () => {
    const s = noCrits(only(battle(['tsubame'], ['shio', 'mara']), { a0: 'a1', b0: 'd4', b1: 'a7' }));
    const sk = unitActions(s, 'a0').skill;
    assert.ok(sk.ok);
    const ends = sk.paths.map((p) => p[p.length - 1]).sort((x, y) => x - y);
    assert.deepEqual(ends, [sq('f6'), sq('e5')].sort((x, y) => x - y));
    U(s, 'b0').def = 0;
    const r = act(s, { type: 'skill', unit: 'a0', path: [sq('a1'), sq('e5')] });
    assert.equal(dmgTo(r.events, 'b0'), Math.floor(unitStats(s, 'a0').atk * 1.5));
  });
  it('passive Tailwind: may glide 1 more square after acting', () => {
    const s = noCrits(only(battle(['tsubame', 'vera'], ['shio', 'mara']), { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'a7' }));
    const r = act(s, { type: 'basic', unit: 'a0', target: sq('e5') });
    assert.equal(unitActions(r.state, 'a0').pending.kind, 'freeMove');
  });
  it('ult Thousand Feathers: Veiled, 6 strikes of 70 % (max 3 per target) within radius 3, then reappears within 3', () => {
    const s = noCrits(only(full(battle(['tsubame', 'vera'], ['shio', 'mara']), 'a0'), { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'f6' }));
    for (const id of ['b0', 'b1']) U(s, id).hp = U(s, id).maxHp = 100000;
    const r = act(s, { type: 'ult', unit: 'a0' });
    const hits = own(r.events).filter((e) => e.type === 'damage' && e.source === 'a0');
    assert.equal(hits.length, 6);
    assert.equal(hits.filter((e) => e.target === 'b0').length, 3);
    assert.ok(U(r.state, 'a0').statuses.some((x) => x.id === 'untargetable'));
    const ua = unitActions(r.state, 'a0');
    assert.equal(ua.pending.kind, 'relocate');
    assert.equal(ua.pending.optional, false);
  });
  it('quirk Updraft: a KO grants another full activation (once per turn)', () => {
    const s = noCrits(only(battle(['tsubame', 'vera'], ['shio', 'mara']), { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'a7' }));
    U(s, 'b0').hp = 1;
    let r = act(s, { type: 'basic', unit: 'a0', target: sq('e5') });
    r = act(r.state, { type: 'pass', unit: 'a0' }); // decline Tailwind
    assert.equal(r.state.side, 1);
    assert.equal(r.state.act.unit, 'a0');
    assert.ok(r.state.act.extra);
    assert.ok(evs(r.events, 'activate').some((e) => e.unit === 'a0' && e.extra));
  });
  it('quirk Light as a Feather: glides over allies', () => {
    const s = only(battle(['tsubame', 'vera'], ['shio']), { a0: 'a1', a1: 'b2' });
    assert.ok(unitActions(s, 'a0').moves.includes(sq('c3')));
    void legalActions;
    void setSeal;
  });
});
