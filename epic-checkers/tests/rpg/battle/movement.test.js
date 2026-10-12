// Movement per role (GDD §3.3) and jump-strike chains (GDD §3.4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { battle, only, turn, act, evs, U, moves, sqs, sq, unitActions, legalActions, noCrits, addStatus, dmgTo } from './helpers.js';
import { DARK, isDark, parseSq, sqName, dist } from '../../../src/rpg/battle/board.js';

test('board: 32 dark squares, a1 is dark, notation round-trips', () => {
  assert.equal(DARK.length, 32);
  assert.ok(isDark(parseSq('a1')));
  assert.ok(!isDark(parseSq('b1')));
  for (const q of DARK) assert.equal(parseSq(sqName(q)), q);
  assert.equal(dist(sq('a1'), sq('h8')), 7);
});

test('deployment: own two back rows; AI fills its back row, Auto puts Guardians and Blades forward', () => {
  const s = battle(['vera', 'akane', 'mashiro', 'maren', 'iskra', 'runa'], ['vera', 'akane', 'mashiro', 'maren', 'iskra', 'runa']);
  for (const u of s.units) {
    const row = u.sq >> 3;
    assert.ok(isDark(u.sq));
    if (u.side === 1) assert.ok(row === 6 || row === 7, `${u.id} row ${row}`);
    else assert.ok(row === 0 || row === 1, `${u.id} row ${row}`);
  }
  // AI: back row (row 0) completely filled
  assert.equal(s.units.filter((u) => u.side === -1 && u.sq >> 3 === 0).length, 4);
  // Auto: Guardian, Blade and Shadow in front (row 6)
  for (const id of ['a0', 'a1', 'a4']) assert.equal(U(s, id).sq >> 3, 6, id);
  // explicit squares are respected
  const s2 = battle([{ heroId: 'vera', sq: 'a1' }, { heroId: 'akane', sq: 'h2' }], ['vera']);
  assert.equal(U(s2, 'a0').sq, sq('a1'));
  assert.equal(U(s2, 'a1').sq, sq('h2'));
});

test('Guardian steps 1 square in any diagonal direction', () => {
  const s = only(battle(['vera'], ['vera']), { a0: 'd4' });
  assert.deepEqual(moves(s, 'a0'), sqs('c5', 'e5', 'c3', 'e3'));
});

test('Blade steps up to 2 squares, may turn, cannot pass through pieces', () => {
  const s = only(battle(['shio'], ['vera']), { a0: 'd4', b0: 'e5' });
  assert.deepEqual(moves(s, 'a0'), sqs('c5', 'c3', 'e3', 'b6', 'd6', 'b4', 'd2', 'b2', 'f4', 'f2'));
});

test('Ranger / Mystic / Oracle step 1', () => {
  for (const h of ['maren', 'runa', 'mashiro']) {
    const s = only(battle([h], ['vera']), { a0: 'd4' });
    assert.deepEqual(moves(s, 'a0'), sqs('c5', 'e5', 'c3', 'e3'), h);
  }
});

test('Shadow glides 1–3 squares along one diagonal; Iskra glides 4; blocked by pieces', () => {
  const s = only(battle(['mara'], ['vera']), { a0: 'd4', b0: 'f6' });
  assert.deepEqual(moves(s, 'a0'), sqs('c5', 'b6', 'a7', 'e5', 'c3', 'b2', 'a1', 'e3', 'f2', 'g1'));
  const s2 = only(battle(['iskra'], ['vera']), { a0: 'a1' });
  assert.deepEqual(moves(s2, 'a0'), sqs('b2', 'c3', 'd4', 'e5'));
});

test('Tsubame glides over allies (not landing on them)', () => {
  const s = only(battle(['tsubame', 'vera'], ['vera']), { a0: 'a1', a1: 'b2' });
  assert.deepEqual(moves(s, 'a0'), sqs('c3', 'd4'));
});

test('Nocturna blinks within 2 (3 when crowned)', () => {
  const s = only(battle(['nocturna'], ['vera']), { a0: 'd4' });
  const m = moves(s, 'a0');
  assert.ok(m.every((q) => dist(q, sq('d4')) <= 2));
  assert.ok(m.includes(sq('f6')) && m.includes(sq('b2')) && m.includes(sq('d6')) && !m.includes(sq('g7')));
  U(s, 'a0').awakened = true;
  assert.ok(moves(s, 'a0').includes(sq('g7')));
});

test('Crown adds a diagonal flight of up to 4 squares (Shadow 7)', () => {
  const s = only(battle(['vera'], ['zlata']), { a0: 'a1' });
  U(s, 'a0').awakened = true;
  assert.deepEqual(moves(s, 'a0'), sqs('b2', 'c3', 'd4', 'e5'));
  const s2 = only(battle(['mara'], ['zlata']), { a0: 'a1', b0: 'h4' });
  U(s2, 'a0').awakened = true;
  assert.ok(moves(s2, 'a0').includes(sq('h8')));
});

test('Akane cannot move backward until crowned', () => {
  const s = only(battle(['akane'], ['vera']), { a0: 'd4' });
  assert.deepEqual(moves(s, 'a0'), sqs('c5', 'e5', 'b6', 'd6', 'f6'));
  U(s, 'a0').awakened = true;
  assert.ok(moves(s, 'a0').includes(sq('c3')));
});

test('Kaede vaults over an adjacent ally (one step), the ally gains energy', () => {
  const s = only(battle(['kaede', 'vera'], ['zlata']), { a0: 'd4', a1: 'e5' });
  assert.ok(moves(s, 'a0').includes(sq('f6')));
  const before = U(s, 'a1').energy;
  const r = act(s, { type: 'move', unit: 'a0', to: sq('f6') });
  assert.equal(U(r.state, 'a0').sq, sq('f6'));
  assert.equal(U(r.state, 'a1').energy, before + 5);
});

test('swapMove: Sirin swaps with an ally within 2; Liora once per battle at any distance', () => {
  const s = only(battle(['sirin', 'vera'], ['zlata']), { a0: 'd4', a1: 'f6' });
  assert.deepEqual(unitActions(s, 'a0').swaps, [sq('f6')]);
  const r = act(s, { type: 'move', unit: 'a0', to: sq('f6') });
  assert.equal(U(r.state, 'a0').sq, sq('f6'));
  assert.equal(U(r.state, 'a1').sq, sq('d4'));
  const s2 = only(battle(['liora', 'vera'], ['zlata']), { a0: 'a1', a1: 'h8' });
  assert.deepEqual(unitActions(s2, 'a0').swaps, [sq('h8')]);
  const r2 = act(s2, { type: 'move', unit: 'a0', to: sq('h8') });
  U(r2.state, 'a0').uses.swapMove = 1;
  const s3 = turn(r2.state, 1);
  assert.deepEqual(unitActions(s3, 'a0').swaps, []);
});

test('Root: no moves and no jumps, but can act; Slow: 1 step, chain of 1', () => {
  const s = noCrits(only(battle(['akane'], ['vera', 'shio']), { a0: 'd4', b0: 'e5', b1: 'a7' }));
  addStatus(s, 'a0', 'root', 1);
  const ua = unitActions(s, 'a0');
  assert.deepEqual(ua.moves, []);
  assert.deepEqual(ua.jumps, []);
  assert.deepEqual(ua.basic, [sq('e5')]);
  const s2 = only(battle(['mara'], ['vera']), { a0: 'd4' });
  addStatus(s2, 'a0', 'slow', 1);
  assert.deepEqual(moves(s2, 'a0'), sqs('c5', 'e5', 'c3', 'e3'));
});

test('Jump-strike: over an adjacent enemy onto the empty square behind; prefixes are separate options', () => {
  const s = only(battle(['shio'], ['vera', 'zlata', 'torvald']), { a0: 'c3', b0: 'd4', b1: 'f6', b2: 'h2' });
  const j = unitActions(s, 'a0').jumps.map((p) => p.map(sqName).join('-'));
  assert.deepEqual(j.sort(), ['c3-e5', 'c3-e5-g7'].sort());
  // blocked landing
  const s2 = only(battle(['shio'], ['vera', 'zlata']), { a0: 'c3', b0: 'd4', b1: 'e5' });
  assert.deepEqual(unitActions(s2, 'a0').jumps, []);
  // edge
  const s3 = only(battle(['shio'], ['vera']), { a0: 'b2', b0: 'a3' });
  assert.deepEqual(unitActions(s3, 'a0').jumps, []);
  // allies cannot be jumped
  const s4 = only(battle(['shio', 'vera'], ['zlata']), { a0: 'c3', a1: 'd4' });
  assert.deepEqual(unitActions(s4, 'a0').jumps, []);
});

test('Chain length per role: Guardian 2, Blade 3 (Akane 4), Ranger/Mystic 1, Shadow 2 with landing up to 2', () => {
  const longest = (s, id) => Math.max(0, ...unitActions(s, id).jumps.map((p) => p.length - 1));
  // zig-zag ladder: a3 → c5 → a7 → (c9 off) ... use a longer one
  const mk = (h) => only(battle([h], ['vera', 'zlata', 'torvald', 'fuyuka']), { a0: 'a1', b0: 'b2', b1: 'd4', b2: 'f6', b3: 'h2' });
  assert.equal(longest(mk('vera'), 'a0'), 2);
  assert.equal(longest(mk('shio'), 'a0'), 3);
  assert.equal(longest(mk('maren'), 'a0'), 1);
  assert.equal(longest(mk('runa'), 'a0'), 1);
  assert.equal(longest(mk('mara'), 'a0'), 2);
  // Shadow lands 1 or 2 squares beyond
  const s = only(battle(['mara'], ['vera']), { a0: 'a1', b0: 'b2' });
  assert.deepEqual(unitActions(s, 'a0').jumps.map((p) => p[1]).sort((x, y) => x - y), sqs('c3', 'd4'));
  // Akane's Hot Blood: 4 hops
  const sa = only(battle(['akane'], ['vera', 'zlata', 'torvald', 'falk', 'fuyuka']), { a0: 'c1', b0: 'd2', b1: 'f4', b2: 'f6', b3: 'd6', b4: 'h8' });
  assert.equal(longest(sa, 'a0'), 4);
});

test('Each enemy can be jumped only once per chain; the combo bonus grows per hop (Blade +15 %)', () => {
  const s = noCrits(only(battle(['shio'], ['vera', 'torvald', 'zlata']), { a0: 'c3', b0: 'd4', b1: 'f6', b2: 'h8' }));
  for (const u of s.units) if (u.side === -1) u.def = 0;
  const r = act(s, { type: 'jump', unit: 'a0', path: [sq('c3'), sq('e5'), sq('g7')] });
  const d = evs(r.events, 'damage').filter((e) => e.kind === 'jump');
  assert.equal(d.length, 2);
  // hop 2 = 1.2 × 1.15 vs hop 1 = 1.2 (same DEF 0, element tide vs flame/radiance = 1.0; tide vs torvald flame)
  assert.ok(Math.abs(d[1].amount / d[0].amount - 1.15) < 0.01, `${d[0].amount} ${d[1].amount}`);
});

test('Fuyuka can only be jumped by crowned enemies and Shadows; Veiled enemies cannot be jumped', () => {
  const s = only(battle(['shio', 'mara'], ['fuyuka']), { a0: 'c3', a1: 'g3', b0: 'd4' });
  assert.deepEqual(unitActions(s, 'a0').jumps, []);
  U(s, 'a0').awakened = true;
  assert.ok(unitActions(s, 'a0').jumps.length > 0);
  const s2 = only(battle(['mara'], ['fuyuka']), { a0: 'c3', b0: 'd4' });
  assert.ok(unitActions(s2, 'a0').jumps.length > 0);
  const s3 = only(battle(['shio'], ['vera']), { a0: 'c3', b0: 'd4' });
  addStatus(s3, 'b0', 'untargetable', 1);
  assert.deepEqual(unitActions(s3, 'a0').jumps, []);
  assert.deepEqual(unitActions(s3, 'a0').basic, []);
});

test('Enemy wards can be jump-struck and take damage', () => {
  // place a ball lightning ward directly
  const s2 = only(battle(['shio'], ['volta', 'vera']), { a0: 'c3', b0: 'h8', b1: 'a7' });
  s2.wards.push({ id: 'w99', isWard: true, kind: 'ball-lightning', owner: 'b0', side: -1, sq: sq('d4'), hp: 1, maxHp: 1, turns: 2, blocks: true, jumpable: true, behavior: null, aura: null, special: null, springboard: false, data: null });
  assert.deepEqual(unitActions(s2, 'a0').jumps.map((p) => p.map(sqName).join('-')), ['c3-e5']);
  const r = act(s2, { type: 'jump', unit: 'a0', path: [sq('c3'), sq('e5')] });
  assert.ok(evs(r.events, 'ward').some((e) => e.id === 'w99' && !e.on && e.reason === 'destroyed'));
});

test('Mid-chain awakening: landing on the enemy back row crowns her and the chain continues as a queen', () => {
  // c5 → e7? use: start d6, hop over e7 → f8 (back row, awaken), then flying hop over the piece at d6? (now empty)
  const s = noCrits(only(battle(['shio'], ['vera', 'zlata', 'torvald']), { a0: 'b4', b0: 'c5', b1: 'c7', b2: 'g5' }));
  // b4 → d6 (over c5) → b8 (over c7): awakened on b8, then flying jump b8 → ... over g5? not on a diagonal from b8
  const chains = unitActions(s, 'a0').jumps.map((p) => p.map(sqName).join('-'));
  assert.ok(chains.includes('b4-d6-b8'));
  const r = act(s, { type: 'jump', unit: 'a0', path: [sq('b4'), sq('d6'), sq('b8')] });
  assert.ok(evs(r.events, 'awaken').some((e) => e.unit === 'a0' && e.full));
  // flying continuation: b6 → d8 over c7 (awakens), then a flying hop from d8 over f6 (2 squares away)
  // landing 1 or 2 squares beyond (g5 / h4); the first victim keeps blocking the way back
  const s2 = noCrits(only(battle(['shio'], ['vera', 'zlata', 'torvald']), { a0: 'b6', b0: 'c7', b1: 'f6', b2: 'h2' }));
  const c2 = unitActions(s2, 'a0').jumps.map((p) => p.map(sqName).join('-'));
  assert.deepEqual(c2.sort(), ['b6-d8', 'b6-d8-g5', 'b6-d8-h4']);
  const r2 = act(s2, { type: 'jump', unit: 'a0', path: [sq('b6'), sq('d8'), sq('h4')] });
  assert.equal(evs(r2.events, 'jump').length, 2);
  assert.ok(U(r2.state, 'a0').awakened);
});

test('Crowned flying jump: victim up to 4 squares away, landing up to 2 beyond', () => {
  const s = only(battle(['vera'], ['zlata']), { a0: 'a1', b0: 'e5' });
  U(s, 'a0').awakened = true;
  const j = unitActions(s, 'a0').jumps.map((p) => p.map(sqName).join('-'));
  assert.deepEqual(j.sort(), ['a1-f6', 'a1-g7']);
});

test('Jump energy: +25, +5 per extra hop, Blades +10 for 2+ hops', () => {
  const s = noCrits(only(battle(['shio'], ['zlata', 'fuyuka', 'vera']), { a0: 'c3', b0: 'd4', b1: 'h2', b2: 'f6' }));
  for (const u of s.units) if (u.side === -1) {
    u.hp = 100000;
    u.maxHp = 100000;
  }
  const e0 = U(s, 'a0').energy;
  const r = act(s, { type: 'jump', unit: 'a0', path: [sq('c3'), sq('e5'), sq('g7')] });
  assert.equal(U(r.state, 'a0').energy, Math.min(U(s, 'a0').maxEnergy, e0 + 25 + 5 + 10));
});

test('Jump-strike chains cannot follow a move; jumps are listed in legalActions', () => {
  const s = only(battle(['shio'], ['zlata']), { a0: 'c3', b0: 'd4' });
  assert.ok(legalActions(s).some((a) => a.type === 'jump' && a.unit === 'a0'));
  const r = act(s, { type: 'move', unit: 'a0', to: sq('a5') });
  assert.ok(!legalActions(r.state).some((a) => a.type === 'jump'));
  assert.throws(() => act(r.state, { type: 'jump', unit: 'a0', path: [sq('a5'), sq('c7')] }), /Illegal/);
});

test('Damage of a jump: hop n = ATK × role mult × (1 + combo × (n−1)) (Guardian 1.0 / +10 %)', () => {
  const s = noCrits(only(battle(['vera'], ['zlata', 'fuyuka']), { a0: 'c3', b0: 'd4', b1: 'h2' }));
  U(s, 'b0').def = 0;
  const r = act(s, { type: 'jump', unit: 'a0', path: [sq('c3'), sq('e5')] });
  // Vera radiance vs Zlata terra: ×1.0; DEF 0 → factor 1; Zlata's amber shield absorbs nothing before the hit
  assert.equal(dmgTo(r.events, 'b0'), Math.floor(U(s, 'a0').atk * 1.0));
});
