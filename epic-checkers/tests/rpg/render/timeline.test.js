// How the battle view reads the engine's event log (src/rpg/render/timeline.js): beats, per-target
// hit groups, floating-number stacking, voice throttling and the cinematic preferences. Checked on
// hand-written logs and on real logs from the battle engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBeats, hitGroups, targetsOf, stackNumbers, VoiceGate, ultMode, numbersOn, subjectOf, isPrimary, isChainDamage } from '../../../src/rpg/render/timeline.js';
import { createBattle, applyAction, legalActions } from '../../../src/rpg/battle/index.js';

const dmg = (target, o = {}) => ({ type: 'damage', source: 'a0', target, amount: 100, crit: false, element: 'flame', absorbed: 0, hp: 500, shield: 0, kind: 'hit', ...o });

test('parseBeats: turn ticks, a move, a cast with its consequences, the turn end, victory', () => {
  const events = [
    { type: 'turnStart', side: 1, round: 2, turn: 3 },
    dmg('a1', { source: null, kind: 'burn' }),
    { type: 'activate', unit: 'a0' },
    { type: 'move', unit: 'a0', from: 42, to: 33, path: [42, 33], kind: 'step' },
    { type: 'cast', unit: 'a0', kind: 'skill', abilityId: 'x', element: 'flame', target: 24, area: [24] },
    dmg('b0'),
    { type: 'ko', unit: 'b0', sq: 24, by: 'a0' },
    { type: 'activationEnd', unit: 'a0', kind: 'skill' },
    { type: 'turnEnd', side: 1 },
    { type: 'roundEnd', round: 2 },
    { type: 'victory', winner: 1, reason: 'annihilation', round: 2 },
  ];
  const beats = parseBeats(events);
  assert.deepEqual(beats.map((b) => b.type), ['turn', 'move', 'cast', 'end', 'victory']);
  assert.equal(beats[0].side, 1);
  assert.equal(beats[0].round, 2);
  assert.equal(beats[0].events.length, 2, 'burn tick + activate stay with the turn start');
  assert.equal(beats[2].kind, 'skill');
  assert.equal(beats[2].unit, 'a0');
  assert.deepEqual(beats[2].events.map((e) => e.type), ['damage', 'ko', 'activationEnd']);
  assert.deepEqual(beats[3].events.map((e) => e.type), ['turnEnd', 'roundEnd'], 'turnEnd + roundEnd form one end beat');
  assert.equal(beats[4].winner, 1);
  // every input event lands in exactly one beat (heads included), nothing is dropped
  const seen = new Set();
  for (const b of beats) {
    if (b.head) seen.add(b.head);
    for (const e of b.events) seen.add(e);
  }
  assert.equal(seen.size, events.length);
});

test('parseBeats: a jump chain is one beat; jumps right after a cast of the same unit stay in the cast', () => {
  const chain = [
    { type: 'chainStart', unit: 'a0', path: [42, 28, 14], element: 'gale' },
    { type: 'jump', unit: 'a0', from: 42, to: 28, over: 35, victim: 'b0', hop: 1 },
    dmg('b0', { kind: 'jump' }),
    { type: 'jump', unit: 'a0', from: 28, to: 14, over: 21, victim: 'b1', hop: 2 },
    dmg('b1', { kind: 'jump' }),
  ];
  const b1 = parseBeats(chain);
  assert.deepEqual(b1.map((b) => b.type), ['misc', 'jump']);
  assert.equal(b1[1].events.filter((e) => e.type === 'jump').length, 2);
  const b2 = parseBeats([{ type: 'cast', unit: 'a0', kind: 'skill', target: 28 }, ...chain.slice(1)]);
  assert.deepEqual(b2.map((b) => b.type), ['cast']);
  assert.equal(b2[0].events.length, 4);
  // another unit's jump opens its own beat
  const b3 = parseBeats([{ type: 'cast', unit: 'a1', kind: 'skill' }, ...chain.slice(1)]);
  assert.deepEqual(b3.map((b) => b.type), ['cast', 'jump']);
});

test('hitGroups: everything that happens to one target travels with its hit; reaction fallout follows the trigger', () => {
  const events = [
    { type: 'energy', unit: 'a0', value: 0, max: 100, delta: -100, reason: 'ult' },
    dmg('b0', { reaction: 'detonation' }),
    { type: 'reaction', target: 'b0', reaction: 'detonation', elements: ['flame', 'storm'], source: 'a0' },
    dmg('b0', { kind: 'reaction' }),
    dmg('b1', { kind: 'reaction' }),
    { type: 'seal', target: 'b0', element: null, slot: 'natural', seals: [], removed: 'storm', reason: 'reaction' },
    dmg('b2'),
    { type: 'status', target: 'b2', status: 'burn', turns: 2, on: true },
    { type: 'ko', unit: 'b2', sq: 20, by: 'a0' },
    dmg('b0'), // a second hit on b0 opens a new group (multi-hit)
    { type: 'energy', unit: 'a0', value: 10, max: 100, delta: 10, reason: 'action' },
  ];
  const { pre, groups, post } = hitGroups(events, 'a0');
  assert.deepEqual(pre.map((e) => e.reason), ['ult']);
  assert.deepEqual(groups.map((g) => g.target), ['b0', 'b2', 'b0']);
  assert.deepEqual(groups[0].events.map((e) => e.type + (e.kind ? ':' + e.kind : '')), ['damage:hit', 'reaction', 'damage:reaction', 'damage:reaction', 'seal']);
  assert.deepEqual(groups[1].events.map((e) => e.type), ['damage', 'status', 'ko']);
  assert.equal(groups[2].events.length, 1);
  assert.deepEqual(post.map((e) => e.reason), ['action']);
  assert.deepEqual(targetsOf(groups), ['b0', 'b2']);
  assert.equal(isChainDamage(dmg('x', { kind: 'collision' })), true);
  assert.equal(isPrimary(dmg('x', { kind: 'reaction' })), false);
  assert.equal(isPrimary({ type: 'shield', target: 'a1', amount: 0 }), false, 'a removed shield is not a hit');
  assert.equal(subjectOf({ type: 'redirect', unit: 'a3', from: 'a1' }), 'a1');
});

test('hitGroups: a bounce announces the next target of a chain (Reika / Iskra)', () => {
  const { groups } = hitGroups([
    dmg('b0'),
    { type: 'bounce', from: 20, to: 29, target: 'b1', source: 'a0' },
    dmg('b1'),
    { type: 'bounce', from: 29, to: 38, target: 'b2', source: 'a0' },
    dmg('b2'),
  ], 'a0');
  assert.deepEqual(groups.map((g) => [g.target, g.events.map((e) => e.type).join('+')]), [['b0', 'damage'], ['b1', 'bounce+damage'], ['b2', 'bounce+damage']]);
});

test('stackNumbers: ≤ 6 visible, a series collapses into a sum after the 3rd hit, the sum keeps growing', () => {
  const live = [];
  const add = (key, now, extra = {}) => {
    const d = stackNumbers(live, key, { now });
    for (const ev of d.evict) ev.dying = true;
    if (d.mode === 'sum') {
      d.into.hits += 1;
      return d;
    }
    if (d.mode === 'collapse') {
      for (const m of d.merge) m.dying = true;
      live.push({ key, sum: true, series: true, hits: d.merge.length + 1, total: 0, born: now, touched: now });
      return d;
    }
    live.push({ key, sum: false, series: true, hits: 1, born: now, touched: now, ...extra });
    return d;
  };
  assert.equal(add('b0', 0).mode, 'new');
  assert.equal(add('b0', 100).mode, 'new');
  const third = add('b0', 200);
  assert.equal(third.mode, 'new');
  assert.equal(third.shift.length, 2, 'older numbers on the target are pushed up');
  const fourth = add('b0', 300);
  assert.equal(fourth.mode, 'collapse');
  assert.equal(fourth.merge.length, 3);
  const fifth = add('b0', 400);
  assert.equal(fifth.mode, 'sum');
  assert.equal(fifth.into.hits, 5);
  // a series that went quiet starts over
  const late = stackNumbers(live, 'b0', { now: 400 + 5000 });
  assert.equal(late.mode, 'new');
  // the cap: the 7th visible number evicts the oldest
  const many = [];
  for (let i = 0; i < 6; i++) many.push({ key: `t${i}`, born: i, touched: i, series: true });
  const d = stackNumbers(many, 'x', { now: 10 });
  assert.equal(d.evict.length, 1);
  assert.equal(d.evict[0].key, 't0');
  // DoT ticks never collapse (series: false)
  const dots = [{ key: 'b1', born: 0, touched: 0, series: false }, { key: 'b1', born: 1, touched: 1, series: false }, { key: 'b1', born: 2, touched: 2, series: false }];
  assert.equal(stackNumbers(dots, 'b1', { now: 3, series: false }).mode, 'new');
});

test('VoiceGate: skill lines at most once per 2 rounds per heroine; ultimates always speak', () => {
  const g = new VoiceGate(2);
  assert.equal(g.allow('akane', 'skill', 1), true);
  assert.equal(g.allow('akane', 'skill', 2), false);
  assert.equal(g.allow('vera', 'skill', 2), true, 'per heroine');
  assert.equal(g.allow('akane', 'skill', 3), true);
  assert.equal(g.allow('akane', 'ultimate', 3), true);
  g.reset();
  assert.equal(g.allow('akane', 'skill', 3), true);
});

test('cinematic preferences default to the full show', () => {
  assert.equal(ultMode(null), 'full');
  assert.equal(ultMode({ rpgUltCinematic: 'short' }), 'short');
  assert.equal(ultMode({ rpgUltCinematic: 'first' }), 'first');
  assert.equal(ultMode({ rpgUltCinematic: 'bogus' }), 'full');
  assert.equal(numbersOn(null), true);
  assert.equal(numbersOn({ rpgDamageNumbers: false }), false);
});

test('real engine logs: every event lands in one beat, cast beats split into groups without loss', () => {
  const heroes1 = ['akane', 'reika', 'liora', 'tsubame', 'vera'];
  const heroes2 = ['nocturna', 'volta', 'zlata', 'mara', 'koyuki'];
  let s = createBattle({ sides: { 1: heroes1.map((h) => ({ heroId: h, level: 10 })), [-1]: heroes2.map((h) => ({ heroId: h, level: 10 })) }, seed: 21, first: 1, mode: 'training' });
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const kinds = new Set();
  for (let ply = 0; ply < 60 && !s.result; ply++) {
    for (const u of s.units) if (u.alive && rand() < 0.2) u.energy = u.maxEnergy || 100;
    const acts = legalActions(s);
    if (!acts.length) break;
    const pri = acts.filter((a) => a.type !== 'move' && a.type !== 'pass' && a.type !== 'wait');
    const pool = pri.length && rand() < 0.85 ? pri : acts;
    const res = applyAction(s, pool[Math.floor(rand() * pool.length)]);
    const beats = parseBeats(res.events);
    const seen = new Set();
    for (const b of beats) {
      if (b.head) seen.add(b.head);
      for (const e of b.events) seen.add(e);
      if (b.type === 'cast') {
        kinds.add(b.kind);
        const { pre, groups, post } = hitGroups(b.events, b.unit);
        const n = pre.length + post.length + groups.reduce((k, g) => k + g.events.length, 0);
        assert.equal(n, b.events.length, `ply ${ply}: hitGroups keeps every event of the cast`);
        for (const g of groups) assert.ok(g.events.length > 0);
      }
    }
    assert.equal(seen.size, res.events.length, `ply ${ply}: parseBeats keeps every event`);
    s = res.state;
  }
  assert.ok(kinds.has('ult') && kinds.has('skill'), `exercised ${[...kinds].join(', ')}`);
});
