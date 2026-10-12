// Statuses (GDD §7), energy & ultimates (§3.6), cooldowns (§3.5), awakening (§3.7), displacement (§3.9).
import test from 'node:test';
import assert from 'node:assert/strict';
import { battle, only, turn, act, evs, U, sq, noCrits, addStatus, dmgTo, own, unitActions, legalActions } from './helpers.js';
import { unitStats } from '../../../src/rpg/battle/index.js';
import { STATUSES } from '../../../src/rpg/data/rules.js';

const pass = (s, unit) => act(s, { type: 'pass', unit }).state;

test('Burn: 25 % of the applier ATK as true damage at the start of each of 2 own turns', () => {
  const s = noCrits(only(battle(['akane'], ['zlata', 'vera']), { a0: 'd4', b0: 'e5', b1: 'a7' }));
  let r = act(s, { type: 'skill', unit: 'a0', target: sq('d4') }); // Scarlet Crescent: Burn 2
  const tick = Math.floor(0.25 * U(s, 'a0').atk);
  const burns = evs(r.events, 'damage').filter((e) => e.kind === 'burn' && e.target === 'b0');
  assert.equal(burns.length, 1);
  assert.equal(burns[0].amount, tick);
  let st = pass(r.state, 'b1');
  st = act(st, { type: 'pass', unit: 'a0' });
  assert.equal(evs(st.events, 'damage').filter((e) => e.kind === 'burn' && e.target === 'b0').length, 1);
  st = pass(st.state, 'b1');
  const r3 = act(st, { type: 'pass', unit: 'a0' });
  assert.equal(evs(r3.events, 'damage').filter((e) => e.kind === 'burn' && e.target === 'b0').length, 0);
});

test('Stun / Frozen: cannot be activated, cooldowns paused, no energy gain', () => {
  const s = only(battle(['vera', 'zlata'], ['shio', 'mara']), { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'a7' });
  turn(s, -1);
  addStatus(s, 'a0', 'stun', 1);
  U(s, 'a0').cd.skill = 2;
  const e0 = U(s, 'a0').energy;
  // enemy hits the stunned Vera: no energy
  const r = act(s, { type: 'basic', unit: 'b0', target: sq('d4') });
  assert.equal(U(r.state, 'a0').energy, e0);
  assert.equal(U(r.state, 'a0').cd.skill, 2); // paused at the turn start
  assert.ok(!legalActions(r.state).some((a) => a.unit === 'a0'));
  assert.throws(() => act(r.state, { type: 'pass', unit: 'a0' }), /Illegal/);
  // the stun expires at the end of Vera's side turn
  const r2 = act(r.state, { type: 'pass', unit: 'a1' });
  assert.ok(!U(r2.state, 'a0').statuses.some((x) => x.id === 'stun'));
});

test('Root: no moves / jumps; Slow: steps of 1; Silence: no skill or ult, basic allowed', () => {
  const s = only(battle(['akane'], ['zlata', 'vera']), { a0: 'd4', b0: 'e5', b1: 'a7' });
  U(s, 'a0').energy = U(s, 'a0').maxEnergy;
  addStatus(s, 'a0', 'silence', 1);
  const ua = unitActions(s, 'a0');
  assert.equal(ua.skill.ok, false);
  assert.equal(ua.skill.reason, 'silenced');
  assert.equal(ua.ult.ok, false);
  assert.deepEqual(ua.basic, [sq('e5')]);
});

test('Taunt: a taunted attacker must hit the taunter when it can', () => {
  const s = only(battle(['shio'], ['zlata', 'mara', 'vera']), { a0: 'd4', b0: 'e5', b1: 'c5', b2: 'a7' });
  addStatus(s, 'a0', 'taunt', 1, { source: 'b0' });
  assert.deepEqual(unitActions(s, 'a0').basic, [sq('e5')]);
  assert.throws(() => act(s, { type: 'basic', unit: 'a0', target: sq('c5') }), /Illegal/);
  // the taunter out of reach: free choice
  const s2 = only(battle(['shio'], ['zlata', 'mara', 'vera']), { a0: 'd4', b0: 'h8', b1: 'c5', b2: 'a7' });
  addStatus(s2, 'a0', 'taunt', 1, { source: 'b0' });
  assert.deepEqual(unitActions(s2, 'a0').basic, [sq('c5')]);
});

test('Mark +20 % damage taken; Brittle DEF −35 %; Weaken ATK −25 %; Inspire +25 %; Brace +30 %; Crown +20 %', () => {
  const s = only(battle(['vera'], ['zlata', 'mara']), { a0: 'd4', b0: 'e5', b1: 'a7' });
  const base = unitStats(s, 'a0');
  const chk = (st, field, mult) => {
    const x = JSON.parse(JSON.stringify(s));
    addStatus(x, 'a0', st, 2);
    assert.equal(unitStats(x, 'a0')[field], Math.floor(base[field === 'atk' ? 'atk' : 'def'] * mult), st);
  };
  chk('brittle', 'def', 0.65);
  chk('weaken', 'atk', 0.75);
  chk('inspire', 'atk', 1.25);
  chk('brace', 'def', 1.3);
  const c = JSON.parse(JSON.stringify(s));
  U(c, 'a0').awakened = true;
  assert.equal(unitStats(c, 'a0').atk, Math.floor(U(c, 'a0').atk * 1.2));
  const m = JSON.parse(JSON.stringify(s));
  addStatus(m, 'a0', 'mark', 2);
  assert.ok(Math.abs(unitStats(m, 'a0').damageTakenPct - 0.2) < 1e-9);
});

test('Blight halves healing; Regen heals 8 % max HP at the turn start', () => {
  const s = only(battle(['mashiro', 'vera'], ['zlata', 'mara']), { a0: 'd4', a1: 'e3', b0: 'h8', b1: 'a7' });
  const heal = (blight) => {
    const x = JSON.parse(JSON.stringify(s));
    U(x, 'a1').hp = 100;
    if (blight) addStatus(x, 'a1', 'blight', 2);
    const r = act(x, { type: 'skill', unit: 'a0', target: sq('e3') });
    return evs(r.events, 'heal').find((e) => e.target === 'a1').amount;
  };
  const full = heal(false);
  assert.ok(Math.abs(heal(true) - Math.floor(full * 0.5)) <= 1);
  const x = JSON.parse(JSON.stringify(s));
  turn(x, -1);
  U(x, 'a1').hp = 100;
  addStatus(x, 'a1', 'regen', 2);
  const r = act(x, { type: 'pass', unit: 'b0' });
  assert.equal(evs(r.events, 'heal').find((e) => e.target === 'a1').amount, Math.floor(0.08 * U(x, 'a1').maxHp));
});

test('Shield absorbs damage first; a new shield does not stack — the larger stays', () => {
  const s = noCrits(only(battle(['shio'], ['vera', 'mara']), { a0: 'd4', b0: 'e5', b1: 'a7' }));
  U(s, 'b0').shield = 50;
  addStatus(s, 'b0', 'shield', 2, { value: 50 });
  const hp0 = U(s, 'b0').hp;
  const r = act(s, { type: 'basic', unit: 'a0', target: sq('e5') });
  const d = evs(r.events, 'damage').find((e) => e.target === 'b0');
  assert.equal(d.absorbed, 50);
  assert.equal(U(r.state, 'b0').hp, hp0 - (d.amount - 50) - dmgTo([], 'b0'));
  // Vera's shield skill on herself twice: smaller value keeps the bigger shield
  const s2 = only(battle(['vera'], ['zlata', 'mara']), { a0: 'd4', b0: 'h8', b1: 'a7' });
  U(s2, 'a0').shield = 100000;
  addStatus(s2, 'a0', 'shield', 2, { value: 100000 });
  const r2 = act(s2, { type: 'skill', unit: 'a0', target: sq('d4') });
  assert.equal(U(r2.state, 'a0').shield, 100000);
});

test('Veiled (untargetable): cannot be picked or jumped, still hit by area effects', () => {
  const s = noCrits(only(battle(['akane'], ['zlata', 'mara']), { a0: 'd4', b0: 'e5', b1: 'a7' }));
  addStatus(s, 'b0', 'untargetable', 1);
  const ua = unitActions(s, 'a0');
  assert.deepEqual(ua.basic, []);
  assert.deepEqual(ua.jumps, []);
  const r = act(s, { type: 'skill', unit: 'a0', target: sq('d4') });
  assert.ok(dmgTo(r.events, 'b0') > 0);
});

test('Durations tick at the end of the holder side turn; a status gained in its own turn skips that tick', () => {
  // Mark (2) applied to the enemy during our turn: present during our next two turns
  const s = noCrits(only(battle(['karasu'], ['zlata', 'mara']), { a0: 'd4', b0: 'e5', b1: 'a7' }));
  let st = act(s, { type: 'basic', unit: 'a0', target: sq('e5') }).state;
  assert.equal(U(st, 'b0').statuses.find((x) => x.id === 'mark').turns, 2);
  st = pass(st, 'b1');
  assert.equal(U(st, 'b0').statuses.find((x) => x.id === 'mark').turns, 1);
  st = pass(st, 'a0');
  st = pass(st, 'b1');
  assert.equal(U(st, 'b0').statuses.find((x) => x.id === 'mark'), undefined);
  // Brace from Wait (own turn) lasts through the enemy turn
  const s2 = only(battle(['vera'], ['zlata', 'mara']), { a0: 'd4', b0: 'h8', b1: 'a7' });
  let w = pass(s2, 'a0');
  assert.ok(U(w, 'a0').statuses.some((x) => x.id === 'brace'));
  w = pass(w, 'b1');
  assert.ok(U(w, 'a0').statuses.some((x) => x.id === 'brace'));
  w = pass(w, 'a0');
  assert.ok(U(w, 'a0').statuses.some((x) => x.id === 'brace')); // re-applied by this Wait
});

test('Cleanse removes the newest debuff first; dispel with steal moves buffs to the thief', () => {
  const s = only(battle(['vera', 'zlata'], ['mara', 'shio']), { a0: 'd4', a1: 'e3', b0: 'f4', b1: 'a7' });
  addStatus(s, 'a1', 'weaken', 2);
  addStatus(s, 'a1', 'mark', 2);
  const r = act(s, { type: 'skill', unit: 'a0', target: sq('e3') }); // Radiant Shield: shield + cleanse 1
  const ids = U(r.state, 'a1').statuses.map((x) => x.id);
  assert.ok(ids.includes('weaken') && !ids.includes('mark'));
  // Mara's ult steals a buff
  const s2 = noCrits(only(battle(['mara'], ['shio', 'vera']), { a0: 'd4', b0: 'f6', b1: 'a7' }));
  U(s2, 'a0').energy = U(s2, 'a0').maxEnergy;
  addStatus(s2, 'b0', 'inspire', 2, { value: 0.25 });
  const r2 = act(s2, { type: 'ult', unit: 'a0', target: sq('f6') });
  assert.ok(!U(r2.state, 'b0').statuses.some((x) => x.id === 'inspire'));
  assert.ok(U(r2.state, 'a0').statuses.some((x) => x.id === 'inspire'));
});

test('Energy: start 40 %, +25 per action, +10 for Wait / move only, +6 per hit taken (max 12 per enemy turn), +15 per KO', () => {
  const s = noCrits(only(battle(['shio', 'vera'], ['zlata', 'mara']), { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'a7' }));
  assert.equal(U(s, 'a0').energy, Math.floor(0.4 * U(s, 'a0').maxEnergy));
  const e0 = U(s, 'a0').energy;
  const r = act(s, { type: 'basic', unit: 'a0', target: sq('e5') });
  assert.equal(own(r.events).filter((e) => e.type === 'energy' && e.unit === 'a0' && e.reason === 'action')[0].delta, 25);
  assert.ok(U(r.state, 'b0').energy >= Math.floor(0.4 * U(s, 'b0').maxEnergy) + 6 - 0);
  const w = act(s, { type: 'pass', unit: 'a0' });
  assert.equal(U(w.state, 'a0').energy, e0 + 10);
  const m = act(act(s, { type: 'move', unit: 'a0', to: sq('c3') }).state, { type: 'pass', unit: 'a0' });
  assert.equal(U(m.state, 'a0').energy, e0 + 10);
  // hit cap: Iskra ult bounces several times on one target in one enemy turn → at most +12
  const s3 = noCrits(only(battle(['vera', 'zlata'], ['tsubame', 'mara']), { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'a7' }));
  turn(s3, -1);
  U(s3, 'b0').energy = U(s3, 'b0').maxEnergy;
  U(s3, 'a0').hp = U(s3, 'a0').maxHp = 100000;
  const e1 = U(s3, 'a0').energy;
  const r3 = act(s3, { type: 'ult', unit: 'b0' });
  const hits = own(r3.events).filter((e) => e.type === 'damage' && e.target === 'a0').length;
  assert.ok(hits >= 3);
  assert.equal(U(r3.state, 'a0').energy - e1 <= 12 + 20, true);
  assert.equal(own(r3.events).filter((e) => e.type === 'energy' && e.unit === 'a0' && e.reason === 'hit').reduce((a, e) => a + e.delta, 0), 12);
});

test('Ultimate: needs full energy, consumes it all and gains nothing from its own hits or KOs', () => {
  const s = noCrits(only(battle(['akane'], ['mara', 'vera']), { a0: 'd4', b0: 'e5', b1: 'a7' }));
  assert.equal(unitActions(s, 'a0').ult.ok, false);
  assert.equal(unitActions(s, 'a0').ult.reason, 'energy');
  U(s, 'a0').energy = U(s, 'a0').maxEnergy;
  U(s, 'b0').hp = 10;
  const r = act(s, { type: 'ult', unit: 'a0', target: sq('e5') });
  assert.ok(evs(r.events, 'ko').some((e) => e.unit === 'b0'));
  assert.equal(U(r.state, 'a0').energy, 0);
  const cast = evs(r.events, 'cast')[0];
  assert.equal(cast.kind, 'ult');
  assert.equal(cast.vfx, 'ult-akane');
});

test('Skill cooldown: used on turn t, usable again on turn t + N; Stun pauses it', () => {
  const s = noCrits(only(battle(['akane', 'vera'], ['zlata', 'mara']), { a0: 'd4', a1: 'a1', b0: 'h8', b1: 'a7' }));
  let st = act(s, { type: 'skill', unit: 'a0', target: sq('d4') }).state;
  assert.equal(U(st, 'a0').cd.skill, 3);
  for (let t = 1; t <= 2; t++) {
    st = pass(st, 'b1');
    assert.equal(unitActions(st, 'a0').skill.ok, false, `turn t+${t}`);
    st = pass(st, 'a1');
  }
  st = pass(st, 'b1');
  assert.equal(U(st, 'a0').cd.skill, 0);
  assert.equal(unitActions(st, 'a0').skill.ok, true);
});

test('Awakening: reaching the enemy back row crowns her: +20 % ATK/DEF, one-time heal 25 % and +50 energy, flight', () => {
  const s = only(battle(['shio', 'vera'], ['zlata', 'mara']), { a0: 'c7', a1: 'a1', b0: 'h4', b1: 'a7' });
  U(s, 'a0').hp = 100;
  const e0 = U(s, 'a0').energy;
  const r = act(s, { type: 'move', unit: 'a0', to: sq('d8') });
  const a0 = U(r.state, 'a0');
  assert.ok(a0.awakened);
  assert.ok(evs(r.events, 'awaken').some((e) => e.unit === 'a0' && e.full));
  assert.equal(a0.hp, 100 + Math.floor(0.25 * a0.maxHp));
  assert.equal(a0.energy, Math.min(a0.maxEnergy, e0 + 50));
  assert.equal(unitStats(r.state, 'a0').atk, Math.floor(a0.atk * 1.2));
  assert.ok(a0.statuses.some((x) => x.id === 'crown'));
  // the bonus is granted once per battle
  const x = JSON.parse(JSON.stringify(r.state));
  U(x, 'a0').awakened = false;
  U(x, 'a0').statuses = [];
  U(x, 'a0').sq = sq('c7');
  turn(x, 1);
  const r2 = act(x, { type: 'move', unit: 'a0', to: sq('b8') });
  assert.ok(U(r2.state, 'a0').awakened);
  assert.ok(!evs(r2.events, 'awaken').some((e) => e.full));
});

test('KO: the unit is removed with its statuses; the killer gains +15 energy', () => {
  const s = noCrits(only(battle(['shio', 'vera'], ['mara', 'zlata']), { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'a7' }));
  U(s, 'b0').hp = 5;
  addStatus(s, 'b0', 'mark', 2);
  const r = act(s, { type: 'basic', unit: 'a0', target: sq('e5') });
  const b0 = U(r.state, 'b0');
  assert.equal(b0.alive, false);
  assert.equal(b0.sq, -1);
  assert.deepEqual(b0.statuses, []);
  assert.ok(own(r.events).some((e) => e.type === 'energy' && e.unit === 'a0' && e.reason === 'ko' && e.delta === 15));
});

test('Push and collision: blocked pushes deal 30 % ATK true damage, the blocker takes half; Fuyuka cannot be moved', () => {
  // Mizuha's Tidal Bell pushes adjacent enemies away
  const s = noCrits(only(battle(['mizuha'], ['mara', 'zlata', 'vera']), { a0: 'd4', b0: 'e5', b1: 'a7', b2: 'h8' }));
  let r = act(s, { type: 'skill', unit: 'a0', target: sq('d4') });
  assert.equal(U(r.state, 'b0').sq, sq('f6'));
  // blocked by a piece behind
  const s2 = noCrits(only(battle(['mizuha'], ['mara', 'zlata', 'vera']), { a0: 'd4', b0: 'e5', b1: 'f6', b2: 'h8' }));
  r = act(s2, { type: 'skill', unit: 'a0', target: sq('d4') });
  const col = Math.floor(0.3 * unitStats(s2, 'a0').atk);
  assert.equal(U(r.state, 'b0').sq, sq('e5'));
  assert.ok(evs(r.events, 'collision').length === 1);
  assert.equal(evs(r.events, 'damage').find((e) => e.kind === 'collision' && e.target === 'b0').amount, col);
  assert.equal(evs(r.events, 'damage').find((e) => e.kind === 'collision' && e.target === 'b1').amount, Math.floor(col / 2));
  // Fuyuka stays and takes the collision damage
  const s3 = noCrits(only(battle(['mizuha'], ['fuyuka', 'vera']), { a0: 'd4', b0: 'e5', b1: 'h8' }));
  r = act(s3, { type: 'skill', unit: 'a0', target: sq('d4') });
  assert.equal(U(r.state, 'b0').sq, sq('e5'));
  assert.ok(evs(r.events, 'damage').some((e) => e.kind === 'collision' && e.target === 'b0'));
});

test('Pull: Maren reels an enemy toward her', () => {
  const s = noCrits(only(battle(['maren'], ['mara', 'vera']), { a0: 'b2', b0: 'e5', b1: 'a7' }));
  const r = act(s, { type: 'skill', unit: 'a0', target: sq('e5') });
  assert.equal(U(r.state, 'b0').sq, sq('c3'));
  assert.ok(evs(r.events, 'displace').some((e) => e.unit === 'b0' && e.kind === 'pull'));
});

test('status definitions exist for every id used by the engine', () => {
  for (const id of ['burn', 'frozen', 'stun', 'root', 'slow', 'silence', 'taunt', 'mark', 'brittle', 'weaken', 'blight', 'inspire', 'brace', 'regen', 'shield', 'untargetable', 'charge', 'crown', 'stagger', 'break']) assert.ok(STATUSES[id], id);
});
