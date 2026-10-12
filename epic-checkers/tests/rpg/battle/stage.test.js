// Campaign stage rules, chapter gimmicks (GDD §14) and bosses (§15).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, battleResult } from '../../../src/rpg/battle/index.js';
import { only, place, turn, act, evs, own, U, sq, noCrits, setSeal, addStatus, dmgTo, unitActions, legalActions } from './helpers.js';
import { rowOf, colOf, DARK } from '../../../src/rpg/battle/board.js';
import { resolveStage } from '../../../src/rpg/battle/stage.js';

const E = (id, level = 10, extra = {}) => ({ heroId: id, level, ...extra });
const campaign = (stage, a, b, o = {}) =>
  createBattle({ sides: { 1: a.map((x) => (typeof x === 'string' ? E(x, o.level || 10) : x)), [-1]: b.map((x) => (typeof x === 'string' ? E(x, o.level || 10) : x)) }, stage, mode: 'campaign', seed: o.seed || 11, first: o.first });

test('resolveStage: ids, CAMPAIGN objects and meta-like objects normalize to the same compact data', () => {
  const a = resolveStage('2-5');
  const b = resolveStage({ id: '2-5', extra: true });
  assert.equal(a.chapter, 2);
  assert.equal(a.rule.id, 'escort');
  assert.deepEqual(a.lava.sqs, b.lava.sqs);
  assert.equal(resolveStage('3-B').collapse.steps[0].round, 14);
  assert.equal(resolveStage('3-1').collapse.steps[0].round, 16);
  assert.equal(resolveStage(null), null);
});

test('Chapter 1 Dew: a unit starting its turn on c5 / e5 / d4 / f4 receives a Tide seal', () => {
  const s = campaign('1-1', ['vera', 'shio'], ['mara', 'vera']);
  assert.ok(s.zones.some((z) => z.kind === 'dew' && z.sqs.includes(sq('c5'))));
  place(s, { a0: 'c5' });
  const r = act(s, { type: 'pass', unit: 'a1' });
  const r2 = act(r.state, { type: 'pass', unit: r.state.units.find((u) => u.side === -1 && u.alive).id });
  assert.ok(U(r2.state, 'a0').seals.some((x) => x.element === 'tide'));
  assert.equal(s.roundLimit, 25);
});

test('1-3 ladder formation, 1-6 ambush (enemy first), 1-5 victory by 2 awakenings', () => {
  const s = campaign('1-3', ['vera', 'shio'], ['torvald', 'falk', 'runa', 'mara']);
  assert.deepEqual(s.units.filter((u) => u.side === -1).slice(0, 3).map((u) => u.sq), [sq('c5'), sq('e5'), sq('g5')]);
  const s6 = campaign('1-6', ['vera'], ['iskra']);
  assert.equal(s6.first, -1);
  assert.equal(s6.side, -1);
  const s5 = only(campaign('1-5', ['shio', 'iskra', 'vera'], ['mara', 'runa']), { a0: 'c7', a1: 'g7', a2: 'a1', b0: 'h4', b1: 'a5' });
  s5.zones = [];
  let r = act(s5, { type: 'move', unit: 'a0', to: sq('d8') });
  r = act(r.state, { type: 'pass', unit: 'a0' });
  assert.equal(battleResult(r.state), null);
  r = act(r.state, { type: 'pass', unit: 'b1' });
  r = act(r.state, { type: 'move', unit: 'a1', to: sq('h8') });
  assert.equal(battleResult(r.state).reason, 'awakenings');
  assert.equal(battleResult(r.state).winner, 1);
});

test('stage boosts: 1-7 Vortex +50 %, 2-2 Flame +20 %, 2-6 Steam ×1.8, 2-3 Storm seals last 3 turns', () => {
  const vortex = (stage) => {
    const s = noCrits(only(campaign(stage, ['kaede'], ['zlata', 'mara', 'vera']), { a0: 'd4', b0: 'e5', b1: 'd6', b2: 'a7' }));
    s.zones = [];
    s.holes = [];
    U(s, 'b0').hp = U(s, 'b0').maxHp = 1e5;
    U(s, 'b1').hp = U(s, 'b1').maxHp = 1e5;
    setSeal(s, 'b0', 'flame');
    return evs(act(s, { type: 'basic', unit: 'a0', target: sq('e5') }).events, 'damage').find((e) => e.target === 'b1' && e.kind === 'reaction').amount;
  };
  assert.ok(Math.abs(vortex('1-7') / vortex('1-8') - 1.5) < 0.02);
  const flame = (stage) => {
    const s = noCrits(only(campaign(stage, ['akane'], ['zlata', 'mara']), { a0: 'd4', b0: 'e5', b1: 'a7' }));
    s.zones = [];
    U(s, 'b0').hp = U(s, 'b0').maxHp = 1e5;
    return dmgTo(act(s, { type: 'basic', unit: 'a0', target: sq('e5') }).events, 'b0');
  };
  assert.ok(Math.abs(flame('2-2') / flame('2-1') - (1.2 + 0.36) / 1.36) < 0.01);
  const steam = (stage) => {
    const s = noCrits(only(campaign(stage, ['akane'], ['zlata', 'mara']), { a0: 'd4', b0: 'e5', b1: 'a7' }));
    s.zones = [];
    U(s, 'b0').hp = U(s, 'b0').maxHp = 1e5;
    setSeal(s, 'b0', 'tide');
    return dmgTo(act(s, { type: 'basic', unit: 'a0', target: sq('e5') }).events, 'b0');
  };
  const aff = 1 + 30 / 200;
  assert.ok(Math.abs(steam('2-6') / steam('2-1') - (1 + 0.8 * aff) / (1 + 0.5 * aff)) < 0.01);
  const s = noCrits(only(campaign('2-3', ['iskra'], ['zlata', 'mara']), { a0: 'd4', b0: 'e5', b1: 'a7' }));
  s.zones = [];
  const r = act(s, { type: 'basic', unit: 'a0', target: sq('e5') });
  assert.equal(U(r.state, 'b0').seals.find((x) => x.element === 'storm').turns, 3);
});

test('Chapter 2: lava cracks burn 10 % max HP at the turn start; every 4th round a telegraphed row erupts (12 %)', () => {
  const st = campaign('2-1', ['vera', 'shio'], ['zlata', 'mara']);
  const lavaZone = st.zones.find((z) => z.kind === 'lava');
  assert.deepEqual(lavaZone.sqs.slice().sort((x, y) => x - y), ['b6', 'd6', 'e3', 'g3'].map(sq).sort((x, y) => x - y));
  const s = only(st, { a0: 'b6', a1: 'a1', b0: 'h8', b1: 'a7' });
  s.zones = [lavaZone];
  turn(s, -1);
  const r = act(s, { type: 'pass', unit: 'b1' });
  const lava = evs(r.events, 'damage').find((e) => e.kind === 'lava' && e.target === 'a0');
  assert.equal(lava.amount, Math.floor(0.1 * U(s, 'a0').maxHp));
  // eruption schedule
  let b = campaign('2-1', ['vera', 'shio'], ['zlata', 'mara'], { seed: 21 });
  const all = [];
  while (b.round < 5 && !b.result) {
    const u = b.units.find((x) => x.alive && x.side === b.side);
    const res = act(b, { type: 'pass', unit: u.id });
    all.push(...res.events);
    b = res.state;
  }
  const warn = all.find((e) => e.type === 'warning' && e.kind === 'eruption');
  const erupt = all.find((e) => e.type === 'eruption');
  assert.ok(warn && warn.round === 4);
  assert.ok(erupt && erupt.row === warn.row && erupt.round === 4);
  // 2-7: every 3 rounds
  assert.equal(resolveStage('2-7').lava.every, 3);
});

test('2-4 Obsidian Bridge: files a and h are chasms', () => {
  const s = campaign('2-4', ['vera', 'shio', 'iskra', 'maren', 'mashiro', 'akane'], ['zlata', 'kaede', 'koyuki', 'maren', 'mashiro', 'runa']);
  for (const u of s.units) assert.ok(colOf(u.sq) > 0 && colOf(u.sq) < 7, `${u.id} on ${u.sq}`);
  const iskra = s.units.find((u) => u.heroId === 'iskra');
  for (const q of unitActions(s, iskra.id).moves) assert.ok(colOf(q) > 0 && colOf(q) < 7);
});

test('2-5 Caravan: a ward on d2 with 25 % of the squad HP; losing it loses the battle; 12 rounds win', () => {
  const s = campaign('2-5', ['vera', 'shio'], ['karasu', 'mara']);
  const car = s.wards.find((w) => w.special === 'caravan');
  assert.equal(car.sq, sq('d2'));
  assert.equal(car.hp, Math.floor(0.25 * (U(s, 'a0').maxHp + U(s, 'a1').maxHp)));
  assert.ok(!s.units.some((u) => u.sq === sq('d2')));
  place(s, { a0: 'a1', a1: 'h2', b0: 'e3', b1: 'a7' });
  turn(s, -1);
  car.hp = 1;
  const r = act(s, { type: 'basic', unit: 'b0', target: sq('d2') });
  assert.equal(battleResult(r.state).winner, -1);
  assert.equal(battleResult(r.state).reason, 'caravan-lost');
  let w = campaign('2-5', ['vera'], ['zlata']);
  w = only(w, { a0: 'a1', b0: 'h8' });
  w.wards = s.wards.filter((x) => x.special === 'caravan').map((x) => ({ ...x, hp: 999 }));
  for (let i = 0; i < 24 && !w.result; i++) w = act(w, { type: 'pass', unit: w.side === 1 ? 'a0' : 'b0' }).state;
  assert.equal(battleResult(w).reason, 'escort');
  assert.equal(battleResult(w).winner, 1);
  assert.equal(battleResult(w).rounds, 12);
});

test('Chapter 3: star gates carry a unit to the paired square; the board collapses from round 16', () => {
  const s = only(campaign('3-1', ['shio', 'vera'], ['zlata', 'mara']), { a0: 'a5', a1: 'a1', b0: 'h8', b1: 'a7' });
  s.zones = [];
  const r = act(s, { type: 'move', unit: 'a0', to: sq('b6') });
  assert.equal(U(r.state, 'a0').sq, sq('g3'));
  assert.ok(evs(r.events, 'displace').some((e) => e.kind === 'gate'));
  // collapse
  let c = only(campaign('3-1', ['vera', 'shio'], ['zlata', 'mara']), { a0: 'a1', a1: 'd4', b0: 'h8', b1: 'd6' });
  c.round = 15;
  const ev = [];
  for (let i = 0; i < 2; i++) {
    const res = act(c, { type: 'pass', unit: c.side === 1 ? 'a1' : 'b1' });
    ev.push(...res.events);
    c = res.state;
  }
  const col = ev.find((e) => e.type === 'collapse');
  assert.ok(col && col.round === 16);
  assert.ok(c.holes.includes(sq('a1')) && c.holes.includes(sq('h8')));
  assert.ok(colOf(U(c, 'a0').sq) > 0 && colOf(U(c, 'b0').sq) < 7);
  assert.ok(ev.some((e) => e.type === 'damage' && e.kind === 'collapse' && e.target === 'a0'));
  // round 18: ranks 1 and 8 fall, awakening rows move inward
  c.round = 17;
  for (let i = 0; i < 2; i++) c = act(c, { type: 'pass', unit: c.side === 1 ? 'a1' : 'b1' }).state;
  assert.equal(c.awakenRows[1], 1);
  assert.equal(c.awakenRows[-1], 6);
  assert.ok(!DARK.some((q) => rowOf(q) === 0 && !c.holes.includes(q)));
});

test('Bosses: HP ×mult, control → Stagger stacks, 3 stacks → Break (skips its activation, +30 % damage taken)', () => {
  const s = campaign('1-B', ['torvald', 'zlata', 'vera'], [E('tsubame'), E('kaede', 8), E('sirin', 8), E('vera', 8)]);
  const boss = U(s, 'b0');
  assert.ok(boss.boss && !boss.boss.mini);
  const plain = createBattle({ sides: { 1: [E('vera')], [-1]: [E('tsubame')] } }).units[1];
  assert.equal(boss.maxHp, plain.maxHp * 5);
  only(s, { a0: 'd4', a1: 'a1', a2: 'h2', b0: 'e5', b1: 'h8', b2: 'f8', b3: 'd8' });
  noCrits(s);
  U(s, 'a0').energy = U(s, 'a0').maxEnergy;
  const r = act(s, { type: 'ult', unit: 'a0' }); // Anvil Drop: Stun → Stagger
  assert.ok(!U(r.state, 'b0').statuses.some((x) => x.id === 'stun'));
  assert.equal(U(r.state, 'b0').statuses.find((x) => x.id === 'stagger').stacks, 1);
  const x = JSON.parse(JSON.stringify(s));
  addStatus(x, 'b0', 'stagger', null, { stacks: 2 });
  U(x, 'a0').energy = U(x, 'a0').maxEnergy;
  const r2 = act(x, { type: 'ult', unit: 'a0' });
  assert.ok(U(r2.state, 'b0').statuses.some((x2) => x2.id === 'break'));
  assert.ok(!legalActions(r2.state).some((a) => a.unit === 'b0'));
  // push on a boss: no move, a stagger stack
  const y = noCrits(only(campaign('1-B', ['mizuha'], [E('tsubame'), E('kaede', 8)]), { a0: 'd4', b0: 'e5', b1: 'h8' }));
  const r3 = act(y, { type: 'skill', unit: 'a0' });
  assert.equal(U(r3.state, 'b0').sq, sq('e5'));
  assert.equal(U(r3.state, 'b0').statuses.find((z) => z.id === 'stagger').stacks, 1);
});

test('Bosses act once more every 3rd own turn; execute deals +100 % ATK instead of a KO', () => {
  let s = only(campaign('1-B', ['vera', 'zlata'], [E('tsubame'), E('kaede', 8)]), { a0: 'a1', a1: 'c1', b0: 'h8', b1: 'f8' });
  s.zones = [];
  const extra = [];
  for (let i = 0; i < 8 && !s.result; i++) {
    const res = act(s, { type: 'pass', unit: s.act ? s.act.unit : s.side === 1 ? 'a0' : 'b1' });
    extra.push(...evs(res.events, 'extraActivation'));
    s = res.state;
  }
  assert.ok(extra.some((e) => e.unit === 'b0' && e.boss));
  const k = noCrits(only(campaign('1-B', ['karasu'], [E('tsubame'), E('kaede', 8)]), { a0: 'd4', b0: 'f6', b1: 'h8' }));
  U(k, 'a0').energy = U(k, 'a0').maxEnergy;
  U(k, 'b0').hp = Math.floor(0.2 * U(k, 'b0').maxHp);
  const r = act(k, { type: 'ult', unit: 'a0', target: sq('f6') });
  assert.ok(!evs(r.events, 'execute').length);
  assert.ok(evs(r.events, 'damage').some((e) => e.kind === 'execute' && e.target === 'b0'));
});

test('1-B Grey Swallow: feathers on her glide path Slow; once at 50 % HP she escapes Veiled to her back row', () => {
  const s = only(campaign('1-B', ['vera', 'zlata'], [E('tsubame'), E('kaede', 8)]), { a0: 'a1', a1: 'c1', b0: 'b6', b1: 'h8' });
  turn(s, -1);
  let r = act(s, { type: 'move', unit: 'b0', to: sq('e3') });
  const z = r.state.zones.find((x) => x.kind === 'feathers');
  assert.ok(z && z.sqs.includes(sq('c5')) && z.sqs.includes(sq('d4')));
  const t = noCrits(only(campaign('1-B', ['shio', 'vera'], [E('tsubame'), E('kaede', 8)]), { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'h8' }));
  U(t, 'b0').hp = Math.floor(0.5 * U(t, 'b0').maxHp) + 5;
  r = act(t, { type: 'basic', unit: 'a0', target: sq('e5') });
  assert.ok(evs(r.events, 'rule').some((e) => e.rule === 'galeEscape'));
  assert.equal(rowOf(U(r.state, 'b0').sq), 0);
  assert.ok(U(r.state, 'b0').statuses.some((x) => x.id === 'untargetable'));
});

test('2-B Ashen Phoenix: Egg of 20 % boss HP that returns at 50 %; Fire Rain every 3rd round, telegraphed a turn ahead', () => {
  const s = noCrits(only(campaign('2-B', ['shio', 'vera'], [E('vermilia', 20), E('akane', 18)], { level: 20 }), { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'h8' }));
  s.zones = [];
  U(s, 'b0').hp = 1;
  const r = act(s, { type: 'basic', unit: 'a0', target: sq('e5') });
  const egg = r.state.wards.find((w) => w.special === 'egg');
  assert.equal(egg.hp, Math.floor(0.2 * U(s, 'b0').maxHp));
  assert.equal(egg.data.hatchHpPct, 0.5);
  // fire rain
  let f = only(campaign('2-B', ['shio', 'vera'], [E('vermilia', 20), E('akane', 18)], { level: 20 }), { a0: 'd4', a1: 'a1', b0: 'h8', b1: 'f8' });
  f.zones = [];
  const ev = [];
  while (f.round <= 3 && !f.result) {
    const res = act(f, { type: 'pass', unit: f.act ? f.act.unit : f.side === 1 ? 'a0' : 'b1' });
    ev.push(...res.events);
    f = res.state;
  }
  const w = ev.find((e) => e.type === 'warning' && e.kind === 'fireRain');
  const strike = ev.find((e) => e.type === 'fireRain');
  assert.ok(w && strike);
  assert.ok(ev.indexOf(w) < ev.indexOf(strike));
  assert.ok(ev.some((e) => e.type === 'damage' && e.kind === 'fireRain'));
});

test('3-B Faceless Queen: starts crowned (loses it at 10 %), heals of the player −30 % in phase 1, pawns in phase 2, extra activations and +25 % damage taken in phase 3', () => {
  const sq6 = [E('nocturna', 30), E('karasu', 28)];
  const s = campaign('3-B', ['mashiro', 'vera'], sq6, { level: 30 });
  const boss = U(s, 'b0');
  assert.ok(boss.awakened);
  assert.equal(boss.maxHp % 6, 0);
  // phase 1 healing malus
  const h = only(JSON.parse(JSON.stringify(s)), { a0: 'd4', a1: 'f6', b0: 'h8', b1: 'b8' });
  h.zones = [];
  U(h, 'a1').hp = 100;
  const r = act(h, { type: 'skill', unit: 'a0', target: sq('f6') });
  assert.equal(own(r.events).find((e) => e.type === 'heal' && e.target === 'a1').amount, Math.floor(U(h, 'a0').atk * 1.4 * 0.7));
  // phases
  const p = noCrits(only(JSON.parse(JSON.stringify(s)), { a0: 'a1', a1: 'd4', b0: 'e5', b1: 'b8' }));
  p.zones = [];
  U(p, 'b0').hp = Math.floor(0.6 * U(p, 'b0').maxHp) + 50;
  const r2 = act(p, { type: 'basic', unit: 'a1', target: sq('e5') });
  assert.ok(evs(r2.events, 'bossPhase').some((e) => e.phase === 2));
  // pawns appear at the boss side's next turn start (on her back row)
  const pawns = r2.state.wards.filter((w) => w.special === 'pawn');
  assert.equal(pawns.length, 2);
  for (const w of pawns) assert.equal(rowOf(w.sq), 0);
  const q = noCrits(only(JSON.parse(JSON.stringify(s)), { a0: 'a1', a1: 'd4', b0: 'e5', b1: 'b8' }));
  q.zones = [];
  U(q, 'b0').boss.phase = 3;
  q.units.find((u) => u.id === 'b0').hp = 100000;
  const r3 = act(q, { type: 'pass', unit: 'a0' });
  const r4 = act(r3.state, { type: 'pass', unit: 'b0' });
  assert.ok(evs(r4.events, 'extraActivation').some((e) => e.unit === 'b0'));
});

test('Mini-bosses (3-6 Fuyuka): HP ×3 and Stagger, but no extra activation', () => {
  const s = campaign('3-6', ['vera'], [E('fuyuka', 26), E('koyuki', 26)], { level: 26 });
  const b = U(s, 'b0');
  assert.ok(b.boss && b.boss.mini);
  const plain = createBattle({ sides: { 1: [E('vera')], [-1]: [E('fuyuka', 26)] } }).units[1];
  assert.equal(b.maxHp, plain.maxHp * 3);
  let st = only(s, { a0: 'a1', b0: 'h8', b1: 'f8' });
  st.zones = [];
  const ev = [];
  for (let i = 0; i < 8; i++) {
    const res = act(st, { type: 'pass', unit: st.act ? st.act.unit : st.side === 1 ? 'a0' : 'b1' });
    ev.push(...res.events);
    st = res.state;
  }
  assert.ok(!ev.some((e) => e.type === 'extraActivation'));
});
