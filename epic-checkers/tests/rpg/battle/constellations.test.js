// Constellations C1–C6 (effects.md §8): every patch of every hero is applied, and the C6 "special
// stars" (plus a sample of earlier stars) change the battle as described.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HEROES } from '../../../src/rpg/data/heroes.js';
import { heroDef } from '../../../src/rpg/battle/defs.js';
import { createBattle, unitStats } from '../../../src/rpg/battle/index.js';
import { only, turn, act, evs, own, U, sq, noCrits, setSeal, addStatus, dmgTo, unitActions } from './helpers.js';

function getPath(obj, path) {
  let n = obj;
  for (const k of String(path).split('.')) {
    if (n == null) return undefined;
    n = n[/^\d+$/.test(k) ? Number(k) : k];
  }
  return n;
}

function mults(node, out = []) {
  if (Array.isArray(node)) node.forEach((x) => mults(x, out));
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) (k === 'mult' && typeof v === 'number' ? out.push(v) : mults(v, out));
  return out;
}

const strip = (t) => {
  const { key, ...rest } = t;
  return rest;
};

test('every constellation patch of every hero is applied (C1 → C6 in order)', () => {
  let checked = 0;
  for (const h of HEROES) {
    for (const star of h.constellations) {
      const prev = heroDef(h.id, star.c - 1);
      const cur = heroDef(h.id, star.c);
      for (const p of star.patches) {
        checked++;
        const label = `${h.id} C${star.c} ${JSON.stringify(p)}`;
        if (p.path && /^(skill|ultimate)\.mult$/.test(p.path)) {
          const ab = p.path.split('.')[0];
          const a = mults(prev[ab].effects);
          const b = mults(cur[ab].effects);
          assert.equal(a.length, b.length, label);
          // later patches of the same star may overwrite some mults (Reika C6), so compare the scaled ones
          a.forEach((m, i) => assert.ok(Math.abs(b[i] - m * p.mul) < 1e-9 || star.patches.some((q) => q !== p && q.path && q.path.startsWith(`${ab}.`)), label));
        } else if (p.path && p.unset) {
          assert.equal(getPath(cur, p.path), undefined, label);
        } else if (p.path && p.set !== undefined) {
          assert.deepEqual(getPath(cur, p.path), p.set, label);
        } else if (p.path && p.mul !== undefined) {
          assert.ok(Math.abs(getPath(cur, p.path) - getPath(prev, p.path) * p.mul) < 1e-9, label);
        } else if (p.path && p.add !== undefined) {
          assert.equal(getPath(cur, p.path), getPath(prev, p.path) + p.add, label);
        } else if (p.mod) {
          assert.ok(cur.mods.some((m) => JSON.stringify(m) === JSON.stringify(p.mod)), label);
        } else if (p.trigger) {
          assert.ok(cur.triggers.some((t) => JSON.stringify(strip(t)) === JSON.stringify(p.trigger)), label);
        } else if (p.aura) {
          assert.ok(cur.auras.some((a) => JSON.stringify(a) === JSON.stringify(p.aura)), label);
        } else if (p.effect) {
          const list = getPath(cur, p.to).effects;
          assert.ok(list.some((e) => JSON.stringify(e) === JSON.stringify(p.effect)), label);
        } else assert.fail(`unknown patch ${label}`);
      }
    }
  }
  assert.equal(checked, HEROES.reduce((a, h) => a + h.constellations.reduce((b, c) => b + c.patches.length, 0), 0));
  // C0 definitions are untouched copies of heroes.js
  for (const h of HEROES) assert.deepEqual(heroDef(h.id, 0).skill, h.skill);
});

const C = (id, c = 6, extra = {}) => ({ heroId: id, level: 10, constellation: c, ...extra });
function duel(a, b, map) {
  return noCrits(only(createBattle({ sides: { 1: a.map((x) => (typeof x === 'string' ? C(x, 0) : x)), [-1]: b.map((x) => (typeof x === 'string' ? C(x, 0) : x)) }, seed: 3 }), map));
}
const full = (s, id) => {
  U(s, id).energy = U(s, id).maxEnergy;
  return s;
};
const tough = (s, ...ids) => {
  for (const id of ids) U(s, id).hp = U(s, id).maxHp = 100000;
  return s;
};

test('C6 specials — Mythic / Legendary', () => {
  // Liora C6: Hymn costs 80 and restores a lost Crown
  let s = full(duel([C('liora')], ['zlata', 'mara'], { a0: 'd4', b0: 'g7', b1: 'a7' }), 'a0');
  assert.equal(U(s, 'a0').maxEnergy, 80);
  U(s, 'a0').awakened = false;
  U(s, 'a0').statuses = [];
  let r = act(s, { type: 'ult', unit: 'a0' });
  assert.ok(U(r.state, 'a0').awakened);
  // Nocturna C6: the Eclipse Silences every enemy
  s = full(duel([C('nocturna')], ['zlata', 'mara'], { a0: 'd4', b0: 'g7', b1: 'a7' }), 'a0');
  r = act(s, { type: 'ult', unit: 'a0' });
  for (const id of ['b0', 'b1']) assert.ok(U(r.state, id).statuses.some((x) => x.id === 'silence'), id);
  // Reika C6: 4 bounces
  s = tough(full(duel([C('reika')], ['zlata', 'mara', 'shio', 'falk', 'torvald'], { a0: 'a1', b0: 'd6', b1: 'e7', b2: 'f8', b3: 'f6', b4: 'h8' }), 'a0'), 'b0', 'b1', 'b2', 'b3', 'b4');
  r = act(s, { type: 'ult', unit: 'a0', target: sq('d6') });
  assert.equal(evs(r.events, 'bounce').length, 4);
  // Fuyuka C6: Frozen 2 turns; allies deal +20 % to Frozen enemies
  s = full(duel([C('fuyuka'), 'shio'], ['zlata', 'mara'], { a0: 'd4', a1: 'a1', b0: 'f6', b1: 'a7' }), 'a0');
  r = act(s, { type: 'ult', unit: 'a0' });
  assert.equal(U(r.state, 'b0').statuses.find((x) => x.id === 'frozen').turns, 2);
  s = duel([C('fuyuka'), 'shio'], ['mara', 'zlata'], { a0: 'a1', a1: 'd4', b0: 'e5', b1: 'a7' });
  tough(s, 'b0');
  const plain = dmgTo(act(JSON.parse(JSON.stringify(s)), { type: 'basic', unit: 'a1', target: sq('e5') }).events, 'b0');
  addStatus(s, 'b0', 'frozen', 1);
  const iced = dmgTo(act(s, { type: 'basic', unit: 'a1', target: sq('e5') }).events, 'b0');
  assert.ok(Math.abs(iced / plain - 1.4 * 1.2) < 0.02, `${iced}/${plain}`);
  // Vermilia C6: hatches at 70 % with a 200 % blast
  s = duel([C('vermilia'), 'vera'], ['shio', 'mara'], { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'a7' });
  turn(s, -1);
  U(s, 'a0').hp = 1;
  tough(s, 'b0');
  let st = act(s, { type: 'basic', unit: 'b0', target: sq('d4') }).state;
  st = act(st, { type: 'pass', unit: 'a1' }).state;
  r = act(st, { type: 'pass', unit: 'b1' });
  assert.equal(U(r.state, 'a0').hp, Math.floor(0.7 * U(r.state, 'a0').maxHp));
  assert.ok(evs(r.events, 'damage').some((e) => e.kind === 'hatch' && e.target === 'b0'));
  // Tsubame C6: 9 strikes, up to 4 per target
  s = tough(full(duel([C('tsubame')], ['zlata', 'mara'], { a0: 'd4', b0: 'e5', b1: 'f6' }), 'a0'), 'b0', 'b1');
  r = act(s, { type: 'ult', unit: 'a0' });
  const hits = own(r.events).filter((e) => e.type === 'damage' && e.source === 'a0');
  assert.equal(hits.length, 8); // 2 targets × max 4
});

test('C6 specials — Epic', () => {
  // Mizuha C6: High Water grants Regen
  let s = full(duel([C('mizuha'), 'vera'], ['zlata', 'mara'], { a0: 'd4', a1: 'a1', b0: 'h8', b1: 'a7' }), 'a0');
  let r = act(s, { type: 'ult', unit: 'a0' });
  for (const id of ['a0', 'a1']) assert.ok(U(r.state, id).statuses.some((x) => x.id === 'regen'), id);
  // Akane C6: a KO with Scarlet Sun refunds 35 energy (C1: cost 60)
  s = full(duel([C('akane')], ['mara', 'zlata'], { a0: 'd4', b0: 'e5', b1: 'a7' }), 'a0');
  assert.equal(U(s, 'a0').maxEnergy, 60);
  U(s, 'b0').hp = 10;
  r = act(s, { type: 'ult', unit: 'a0', target: sq('e5') });
  assert.equal(U(r.state, 'a0').energy, 35);
  // Volta C6: cross of length 3, centre Stunned
  s = full(duel([C('volta')], ['zlata', 'mara', 'shio'], { a0: 'a1', b0: 'e5', b1: 'e1', b2: 'h8' }), 'a0');
  r = act(s, { type: 'ult', unit: 'a0', target: sq('e5') });
  assert.ok(dmgTo(r.events, 'b1') > 0, 'length 3 reaches 6 squares down');
  assert.ok(U(r.state, 'b0').statuses.some((x) => x.id === 'stun'));
  // Koyuki C6: the Blizzard covers 2 rows
  s = tough(full(duel([C('koyuki')], ['zlata', 'mara', 'shio'], { a0: 'a1', b0: 'd4', b1: 'e5', b2: 'h8' }), 'a0'), 'b0', 'b1');
  r = act(s, { type: 'ult', unit: 'a0', target: sq('e5') });
  assert.ok(dmgTo(r.events, 'b0') > 0 && dmgTo(r.events, 'b1') > 0);
  // Lucille C6: the Litany costs 80
  s = duel([C('lucille')], ['zlata'], { a0: 'd4', b0: 'h8' });
  assert.equal(U(s, 'a0').maxEnergy, 80);
  // Karasu C6: executes at 40 % and a KO refunds 40 energy
  s = full(duel([C('karasu')], ['zlata', 'mara'], { a0: 'd4', b0: 'f6', b1: 'h8' }), 'a0');
  U(s, 'b0').hp = U(s, 'b0').maxHp = 100000;
  U(s, 'b0').hp = 40001;
  U(s, 'b0').def = 0;
  r = act(s, { type: 'ult', unit: 'a0', target: sq('f6') });
  assert.ok(evs(r.events, 'execute').length === 1);
  assert.equal(U(r.state, 'a0').energy, 40);
  // Zlata C6: Fortress costs 70, Root lasts 2 turns
  s = full(duel([C('zlata')], ['shio', 'mara'], { a0: 'd4', b0: 'e5', b1: 'h8' }), 'a0');
  assert.equal(U(s, 'a0').maxEnergy, 70);
  r = act(s, { type: 'ult', unit: 'a0' });
  assert.equal(U(r.state, 'b0').statuses.find((x) => x.id === 'root').turns, 2);
  // Kaede C6: full diagonals; her Vortex is 50 % stronger
  s = tough(full(duel([C('kaede')], ['zlata', 'mara'], { a0: 'a1', b0: 'g7', b1: 'h2' }), 'a0'), 'b0');
  r = act(s, { type: 'ult', unit: 'a0' });
  assert.ok(dmgTo(r.events, 'b0') > 0);
  const vortex = (c) => {
    const x = duel([C('kaede', c)], ['zlata', 'mara', 'shio'], { a0: 'd4', b0: 'e5', b1: 'd6', b2: 'h8' });
    tough(x, 'b0', 'b1');
    setSeal(x, 'b0', 'flame');
    return evs(act(x, { type: 'basic', unit: 'a0', target: sq('e5') }).events, 'damage').find((e) => e.target === 'b1' && e.kind === 'reaction').amount;
  };
  const scale = (aff, extra) => (1 + aff / 200) * (1 + extra);
  const aff = heroDef('kaede', 0).base.aff;
  assert.ok(Math.abs(vortex(6) / vortex(5) - scale(aff, 0.5) / scale(aff, 0)) < 0.03);
});

test('C6 specials — Rare', () => {
  // Torvald C6: Handyman twice, the ally also gains +20 energy (C1: HP +10 %)
  let s = duel([C('torvald'), 'shio'], ['zlata', 'mara'], { a0: 'd4', a1: 'c3', b0: 'h8', b1: 'a7' });
  assert.equal(U(s, 'a0').maxHp, Math.floor(createBattle({ sides: { 1: [C('torvald', 0)], [-1]: [C('vera', 0)] } }).units[0].maxHp * 1.1));
  U(s, 'a1').cd.skill = 3;
  const e1 = U(s, 'a1').energy;
  let r = act(s, { type: 'quirk', unit: 'a0', quirk: 'handyman', target: sq('c3') });
  assert.equal(U(r.state, 'a1').energy, e1 + 20);
  const q = unitActions(turn(r.state, 1), 'a0').quirks[0];
  assert.equal(q.usesPerBattle, 2);
  assert.equal(q.uses, 1);
  assert.equal(q.ok, true);
  // Shio C6: Boarding Wave cooldown 2, range 4
  s = duel([C('shio')], ['zlata', 'mara'], { a0: 'a1', b0: 'e5', b1: 'h8' });
  r = act(s, { type: 'skill', unit: 'a0', target: sq('b2') });
  assert.equal(U(r.state, 'a0').cd.skill, 2);
  assert.equal(U(r.state, 'a0').sq, sq('d4'));
  // Maren C6: four diagonals and Slow
  s = tough(full(duel([C('maren')], ['zlata', 'mara', 'shio', 'falk'], { a0: 'd4', b0: 'f6', b1: 'b2', b2: 'f2', b3: 'b6' }), 'a0'), 'b0', 'b1', 'b2', 'b3');
  r = act(s, { type: 'ult', unit: 'a0', targets: [sq('e5'), sq('c3'), sq('e3'), sq('c5')] });
  for (const id of ['b0', 'b1', 'b2', 'b3']) {
    assert.ok(dmgTo(r.events, id) > 0, id);
    assert.ok(U(r.state, id).statuses.some((x) => x.id === 'slow'), id);
  }
  // Mashiro C6: Snowfall cleanses one debuff from every ally
  s = full(duel([C('mashiro'), 'vera'], ['zlata', 'mara'], { a0: 'd4', a1: 'a1', b0: 'h8', b1: 'a7' }), 'a0');
  addStatus(s, 'a1', 'mark', 2);
  r = act(s, { type: 'ult', unit: 'a0' });
  assert.ok(!U(r.state, 'a1').statuses.some((x) => x.id === 'mark'));
  // Iskra C6: 5 deliveries after the first
  s = tough(full(duel([C('iskra')], ['zlata', 'mara', 'shio', 'falk', 'torvald', 'vera'], { a0: 'b2', b0: 'd4', b1: 'e5', b2: 'f6', b3: 'g7', b4: 'h8', b5: 'f4' }), 'a0'), 'b0', 'b1', 'b2', 'b3', 'b4', 'b5');
  r = act(s, { type: 'ult', unit: 'a0', target: sq('d4') });
  assert.equal(evs(r.events, 'bounce').length, 5);
  // Sirin C6: Wind Ballad cooldown 2 (C3: +35 energy)
  s = duel([C('sirin'), 'vera'], ['zlata', 'mara'], { a0: 'd4', a1: 'f6', b0: 'h8', b1: 'a7' });
  U(s, 'a1').energy = 0;
  r = act(s, { type: 'skill', unit: 'a0', target: sq('f6') });
  assert.equal(U(r.state, 'a0').cd.skill, 2);
  assert.equal(U(r.state, 'a1').energy, 35);
  // Falk C6: Rockfall Roots
  s = full(duel([C('falk')], ['zlata', 'mara'], { a0: 'b2', b0: 'e5', b1: 'h8' }), 'a0');
  r = act(s, { type: 'ult', unit: 'a0', target: sq('e5') });
  assert.ok(U(r.state, 'b0').statuses.some((x) => x.id === 'root'));
  // Runa C6: 4 pillars
  s = full(duel([C('runa')], ['zlata', 'mara'], { a0: 'd4', b0: 'h8', b1: 'a7' }), 'a0');
  r = act(s, { type: 'ult', unit: 'a0', targets: [sq('c5'), sq('e5'), sq('c3'), sq('e3')] });
  assert.equal(r.state.wards.filter((w) => w.kind === 'stone-pillar').length, 4);
  // Vera C6: Stubborn saves her from any lethal hit
  s = duel([C('vera'), 'zlata'], ['shio', 'mara'], { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'a7' });
  turn(s, -1);
  U(s, 'a0').hp = 5;
  r = act(s, { type: 'basic', unit: 'b0', target: sq('d4') });
  assert.equal(U(r.state, 'a0').hp, 1);
  // Mara C6: Shadow Con steals every buff; Trip cooldown 2
  s = full(duel([C('mara')], ['shio', 'zlata'], { a0: 'd4', b0: 'f6', b1: 'h8' }), 'a0');
  addStatus(s, 'b0', 'brace', 2, { value: 0.3 });
  addStatus(s, 'b0', 'inspire', 2, { value: 0.25 });
  r = act(s, { type: 'ult', unit: 'a0', target: sq('f6') });
  for (const id of ['brace', 'inspire']) assert.ok(U(r.state, 'a0').statuses.some((x) => x.id === id), id);
  assert.equal(heroDef('mara', 6).skill.cooldown, 2);
});

test('earlier stars: a sample of C1–C5 effects', () => {
  // Shio C1 ATK +8 %, C4 crit +10
  let s = duel([C('shio', 4)], ['zlata'], { a0: 'd4', b0: 'h8' });
  assert.equal(unitStats(s, 'a0').atk, Math.floor(U(s, 'a0').atk * 1.08));
  // Reika C1: up to 4 charges
  s = duel([C('reika', 1), 'vera'], ['zlata', 'mara'], { a0: 'a1', a1: 'h2', b0: 'h8', b1: 'a7' });
  for (let i = 0; i < 5; i++) {
    s = act(s, { type: 'pass', unit: 'a1' }).state;
    s = act(s, { type: 'pass', unit: 'b1' }).state;
  }
  assert.equal(U(s, 'a0').statuses.find((x) => x.id === 'charge').stacks, 4);
  // Liora C2: the Crown falls only at 45 %
  assert.equal(heroDef('liora', 2).rules.startCrowned.lossThresholdPct, 0.45);
  // Karasu C1: Mark +30 %
  s = duel([C('karasu', 1)], ['zlata', 'mara'], { a0: 'd4', b0: 'e5', b1: 'h8' });
  let r = act(s, { type: 'basic', unit: 'a0', target: sq('e5') });
  assert.equal(U(r.state, 'b0').statuses.find((x) => x.id === 'mark').value, 0.3);
  // Kaede C2: the Whirl pulls from 3 squares by 2
  s = tough(duel([C('kaede', 2)], ['zlata', 'mara'], { a0: 'd4', b0: 'g7', b1: 'a7' }), 'b0');
  r = act(s, { type: 'skill', unit: 'a0' });
  assert.equal(U(r.state, 'b0').sq, sq('e5'));
  // Koyuki C4: Slow from 2 squares
  s = duel([C('koyuki', 4)], ['zlata', 'mara'], { a0: 'a1', b0: 'c3', b1: 'h8' });
  r = act(s, { type: 'basic', unit: 'a0', target: sq('c3') });
  assert.ok(U(r.state, 'b0').statuses.some((x) => x.id === 'slow'));
  // Lucille C4: Inspire +35 %
  s = duel([C('lucille', 4), 'vera'], ['zlata'], { a0: 'd4', a1: 'f6', b0: 'h8' });
  r = act(s, { type: 'skill', unit: 'a0', target: sq('f6') });
  assert.equal(U(r.state, 'a1').statuses.find((x) => x.id === 'inspire').value, 0.35);
  // Nocturna C2: Moonfall Rift cooldown 2; C1: Double 45 %
  s = createBattle({ sides: { 1: [C('nocturna', 2)], [-1]: [C('zlata', 0)] }, seed: 1 });
  assert.equal(s.wards.find((w) => w.special === 'decoy').hp, Math.floor(0.45 * U(s, 'a0').maxHp));
  assert.equal(heroDef('nocturna', 2).skill.cooldown, 2);
  // Zlata C2: toss 4 squares, +20 energy
  s = duel([C('zlata', 2), 'shio'], ['mara', 'falk'], { a0: 'b2', a1: 'c3', b0: 'd4', b1: 'h2' });
  const e = U(s, 'a1').energy;
  r = act(s, { type: 'quirk', unit: 'a0', quirk: 'friend-toss', target: sq('c3') });
  assert.equal(U(r.state, 'a1').sq, sq('g7'));
  assert.equal(U(r.state, 'a1').energy, e + 20);
});
