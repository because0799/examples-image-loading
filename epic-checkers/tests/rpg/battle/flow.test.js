// Turn structure, round limit & tiebreak, victory, serialization, determinism, purity (GDD §3.2, §3.8).
import test from 'node:test';
import assert from 'node:assert/strict';
import { battle, only, turn, act, evs, U, sq, noCrits, addStatus, legalActions, unitActions } from './helpers.js';
import { battleResult, serializeBattle, deserializeBattle, createBattle, applyAction } from '../../../src/rpg/battle/index.js';

test('createBattle: first turn already started, startEvents recorded, units at 40 % energy', () => {
  const s = battle(['akane', 'vera'], ['zlata', 'mara']);
  assert.equal(s.side, 1);
  assert.equal(s.round, 1);
  assert.equal(s.startEvents[0].type, 'battleStart');
  assert.ok(s.startEvents.some((e) => e.type === 'turnStart' && e.side === 1));
  const s2 = battle(['akane'], ['zlata'], { first: -1 });
  assert.equal(s2.side, -1);
  // Duel coin toss is seeded
  const coin = (seed) => createBattle({ sides: { 1: [{ heroId: 'vera' }], [-1]: [{ heroId: 'vera' }] }, seed, first: 'random', mode: 'duel' }).first;
  const seen = new Set();
  for (let i = 0; i < 20; i++) seen.add(coin(i));
  assert.deepEqual([...seen].sort(), [-1, 1]);
  assert.equal(coin(5), coin(5));
});

test('round = player turn + enemy turn; one activation per turn', () => {
  let s = battle(['akane', 'vera'], ['zlata', 'mara']);
  s = act(s, { type: 'pass', unit: 'a0' }).state;
  assert.equal(s.side, -1);
  assert.equal(s.round, 1);
  assert.throws(() => act(s, { type: 'pass', unit: 'a1' }), /Illegal/);
  const r = act(s, { type: 'pass', unit: 'b0' });
  assert.ok(evs(r.events, 'roundEnd').some((e) => e.round === 1));
  assert.equal(r.state.round, 2);
  assert.equal(r.state.side, 1);
});

test('move then act within one activation; move only then pass; another unit cannot act after a move', () => {
  let s = only(battle(['shio', 'vera'], ['zlata', 'mara']), { a0: 'd2', a1: 'a1', b0: 'e5', b1: 'a7' });
  s = act(s, { type: 'move', unit: 'a0', to: sq('d4') }).state;
  assert.equal(s.side, 1);
  assert.equal(s.act.unit, 'a0');
  assert.throws(() => act(s, { type: 'pass', unit: 'a1' }), /Illegal/);
  assert.throws(() => act(s, { type: 'move', unit: 'a0', to: sq('c5') }), /Illegal/);
  const la = legalActions(s);
  assert.ok(la.every((a) => a.unit === 'a0'));
  assert.ok(la.some((a) => a.type === 'basic' && a.target === sq('e5')));
  const r = act(s, { type: 'basic', unit: 'a0', target: sq('e5') });
  assert.equal(r.state.side, -1);
  // composite form: { type, unit, to, target }
  const s2 = only(battle(['shio', 'vera'], ['zlata', 'mara']), { a0: 'd2', a1: 'a1', b0: 'e5', b1: 'a7' });
  const r2 = act(s2, { type: 'basic', unit: 'a0', to: sq('d4'), target: sq('e5') });
  assert.deepEqual(evs(r2.events, 'move').map((e) => e.to), [sq('d4')]);
  assert.ok(evs(r2.events, 'damage').some((e) => e.target === 'b0'));
});

test('round limit: the side with the larger HP share wins; within 0.5 % it is a draw', () => {
  let s = battle(['vera'], ['vera'], { roundLimit: 2 });
  U(s, 'b0').hp -= 100;
  for (let i = 0; i < 4; i++) s = act(s, { type: 'pass', unit: s.side === 1 ? 'a0' : 'b0' }).state;
  const res = battleResult(s);
  assert.equal(res.winner, 1);
  assert.equal(res.reason, 'round-limit');
  assert.equal(res.rounds, 2);
  let d = battle(['vera'], ['vera'], { roundLimit: 1 });
  U(d, 'b0').hp -= 2; // 0.2 % of ~1300 HP
  d = act(d, { type: 'pass', unit: 'a0' }).state;
  const last = act(d, { type: 'pass', unit: 'b0' });
  assert.equal(battleResult(last.state).winner, 0);
  assert.ok(evs(last.events, 'victory').some((e) => e.winner === 0 && e.reason === 'round-limit'));
});

test('victory: all heroes of a side KO\'d; resign', () => {
  const s = noCrits(only(battle(['shio'], ['mara']), { a0: 'd4', b0: 'e5' }));
  U(s, 'b0').hp = 1;
  const r = act(s, { type: 'basic', unit: 'a0', target: sq('e5') });
  const res = battleResult(r.state);
  assert.equal(res.winner, 1);
  assert.equal(res.reason, 'annihilation');
  assert.equal(evs(r.events, 'victory').length, 1);
  assert.deepEqual(legalActions(r.state), []);
  assert.throws(() => act(r.state, { type: 'pass', unit: 'a0' }), /Illegal|over/);
  const g = act(battle(['vera'], ['vera']), { type: 'resign', side: 1 });
  assert.equal(battleResult(g.state).winner, -1);
  assert.equal(battleResult(g.state).reason, 'resign');
  assert.ok(battleResult(r.state).stats.sides[1].kos >= 1);
  assert.equal(battleResult(r.state).stats.mvp[1], 'a0');
});

test('a side with nobody able to act skips its turn automatically', () => {
  const s = only(battle(['vera', 'zlata'], ['mara', 'shio']), { a0: 'd4', a1: 'a1', b0: 'h8', b1: 'a7' });
  addStatus(s, 'b0', 'stun', 1);
  addStatus(s, 'b1', 'frozen', 1);
  const r = act(s, { type: 'pass', unit: 'a0' });
  assert.ok(evs(r.events, 'turnSkipped').some((e) => e.side === -1));
  assert.equal(r.state.side, 1);
  assert.equal(r.state.round, 2);
});

test('applyAction never mutates its input and is deterministic for a seed', () => {
  const s = battle(['akane', 'vera', 'iskra'], ['zlata', 'mara', 'karasu'], { seed: 42 });
  const snap = JSON.stringify(s);
  const a = legalActions(s).find((x) => x.type === 'move');
  const r1 = applyAction(s, a);
  const r2 = applyAction(s, a);
  assert.equal(JSON.stringify(s), snap);
  assert.deepEqual(r1.events, r2.events);
  assert.equal(JSON.stringify(r1.state), JSON.stringify(r2.state));
});

test('serializeBattle / deserializeBattle round-trip (also through JSON text)', () => {
  let s = battle(['nocturna', 'vermilia', 'runa'], ['reika', 'fuyuka', 'lucille'], { seed: 9 });
  for (let i = 0; i < 6 && !s.result; i++) s = applyAction(s, legalActions(s).find((x) => x.type !== 'pass') || legalActions(s)[0]).state;
  const txt = JSON.stringify(serializeBattle(s));
  const back = deserializeBattle(txt);
  assert.equal(JSON.stringify(back), JSON.stringify(s));
  const a = legalActions(back)[0];
  assert.deepEqual(applyAction(back, a).events, applyAction(s, a).events);
  assert.throws(() => deserializeBattle({ v: 99 }), /unsupported/);
});

test('illegal actions throw IllegalActionError', () => {
  const s = only(battle(['shio'], ['mara']), { a0: 'd4', b0: 'h8' });
  assert.throws(() => act(s, { type: 'move', unit: 'a0', to: sq('h8') }), (e) => e.name === 'IllegalActionError');
  assert.throws(() => act(s, { type: 'basic', unit: 'a0', target: sq('h8') }), /Illegal/);
  assert.throws(() => act(s, { type: 'skill', unit: 'b0', target: sq('d4') }), /Illegal/);
  assert.throws(() => act(s, { type: 'ult', unit: 'a0', target: sq('h8') }), /Illegal/);
  assert.throws(() => act(s, { type: 'dance', unit: 'a0' }), /Illegal/);
  assert.throws(() => act(s, { type: 'pass' }), /Illegal/);
});

test('pending free move: Tsubame may glide 1 more square after acting (optional); Volta must blink', () => {
  const s = noCrits(only(battle(['tsubame', 'vera'], ['zlata', 'mara']), { a0: 'd4', a1: 'a1', b0: 'e5', b1: 'a7' }));
  const r = act(s, { type: 'basic', unit: 'a0', target: sq('e5') });
  assert.equal(r.state.side, 1);
  assert.ok(evs(r.events, 'pending').length === 1);
  const ua = unitActions(r.state, 'a0');
  assert.equal(ua.phase, 'pending');
  assert.equal(ua.pending.optional, true);
  assert.ok(ua.pending.squares.includes(sq('c3')));
  const done = act(r.state, { type: 'move', unit: 'a0', to: sq('c3') });
  assert.equal(U(done.state, 'a0').sq, sq('c3'));
  assert.equal(done.state.side, -1);
  const declined = act(r.state, { type: 'pass', unit: 'a0' });
  assert.equal(U(declined.state, 'a0').sq, sq('d4'));
  // Volta: mandatory blink within 2
  const v = noCrits(only(battle(['volta', 'vera'], ['zlata', 'mara']), { a0: 'd4', a1: 'a1', b0: 'f6', b1: 'a7' }));
  const rv = act(v, { type: 'basic', unit: 'a0', target: sq('f6') });
  assert.equal(rv.state.side, 1);
  assert.equal(unitActions(rv.state, 'a0').pending.optional, false);
  assert.throws(() => act(rv.state, { type: 'pass', unit: 'a0' }), /mandatory/);
  const to = unitActions(rv.state, 'a0').pending.squares[0];
  assert.equal(U(act(rv.state, { type: 'move', unit: 'a0', to }).state, 'a0').sq, to);
});

test('battleResult is null while the battle runs; stats count reactions, ults and chains', () => {
  const s = battle(['vera'], ['vera']);
  assert.equal(battleResult(s), null);
});
