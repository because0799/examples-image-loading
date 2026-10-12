// Training / duel setup helpers and squad management (setSquad, formation, auto deployment, presets).
import test from 'node:test';
import assert from 'node:assert/strict';
import { HERO_BY_ID } from '../../../src/rpg/data/heroes.js';
import {
  createProfile, sanitizeProfile, trainingSetup, createDuelDraft, draftCurrent, draftOptions, draftPick, draftAutoPick,
  draftDone, duelSetup, DUEL_DRAFT_ORDER, setSquad, validateSquad, setFormation, autoFormation, savePreset, loadPreset,
  squadFor, deploySquares, summon, applyBattleResult,
} from '../../../src/rpg/meta/index.js';

const NOW = Date.UTC(2026, 9, 12, 9, 0, 0);
const fresh = (seed = 1) => createProfile({ seed, now: NOW });

test('training: random lineups are seeded, distinct heroes, at the chosen level', () => {
  const p = fresh();
  const a = trainingSetup(p, { level: 17, lineup: 'random', difficulty: 'hard', seed: 42 });
  const b = trainingSetup(p, { level: 17, lineup: 'random', difficulty: 'hard', seed: 42 });
  assert.deepEqual(a, b);
  assert.equal(a.ok, true);
  assert.equal(a.mode, 'training');
  assert.equal(a.difficulty, 'hard');
  assert.equal(a.enemyLevel, 17);
  assert.equal(a.bg, 'bg-ash');
  assert.equal(a.squads[-1].length, 6);
  assert.equal(new Set(a.squads[-1].map((u) => u.heroId)).size, 6);
  assert.ok(a.squads[-1].every((u) => u.level === 17 && u.constellation === 0 && u.reflection));
  assert.deepEqual(a.squads[1].map((u) => u.heroId), p.squad);
  const c = trainingSetup(p, { level: 17, lineup: 'random', seed: 43 });
  assert.notDeepEqual(c.squads[-1], a.squads[-1]);
  assert.equal(trainingSetup(p, { level: 99 }).enemyLevel, 30);
  assert.equal(trainingSetup(p, { level: 0, difficulty: 'godlike' }).difficulty, 'normal');
});

test('training: chapter presets, mirror, custom; results feed applyBattleResult', () => {
  const p = fresh();
  const pre = trainingSetup(p, { level: 5, lineup: 'chapterPreset', stageId: '1-4', seed: 1 });
  assert.equal(pre.lineupSource, '1-4');
  assert.deepEqual(pre.squads[-1].map((u) => u.heroId), ['vera', 'torvald', 'falk', 'maren', 'sirin']);
  const ch3 = trainingSetup(p, { level: 25, lineup: 'chapterPreset', seed: 3 });
  assert.equal(ch3.lineupSource[0], '3');
  assert.ok(ch3.squads[-1].every((u) => !u.boss && !u.miniBoss && !u.hpMult));
  const mir = trainingSetup(p, { level: 9, lineup: 'mirror' });
  assert.deepEqual(mir.squads[-1].map((u) => u.heroId), p.squad);
  assert.ok(mir.squads[-1].every((u) => u.mirror && u.level === 9));
  const cus = trainingSetup(p, { level: 3, lineup: 'custom', custom: ['liora', 'nope', 'nocturna'] });
  assert.deepEqual(cus.squads[-1].map((u) => u.heroId), ['liora', 'nocturna']);
  assert.equal(trainingSetup(p, { lineup: 'custom', custom: [] }).error, 'custom');
  const r = applyBattleResult(p, { mode: 'training', result: { winner: 1 }, squad: cus.squads[1], enemyLevel: cus.enemyLevel, now: NOW });
  assert.equal(r.rewards.enemyLevel, 3);
});

test('duel draft: order 1-2-2-2-2-2-1, six picks each, shared heroes allowed across players', () => {
  const p = fresh();
  assert.deepEqual(DUEL_DRAFT_ORDER, [1, 2, 2, 2, 2, 2, 1]);
  let d = createDuelDraft(p);
  assert.deepEqual(d.sequence, [1, 2, 2, 1, 1, 2, 2, 1, 1, 2, 2, 1]);
  assert.equal(d.pool.length, 6, 'owner heroes only');
  assert.equal(createDuelDraft(p, { allHeroes: true }).pool.length, 24);
  const seq = [];
  const order = ['akane', 'akane', 'vera', 'vera', 'shio', 'shio', 'maren', 'maren', 'iskra', 'iskra', 'mashiro', 'mashiro'];
  // player 1 takes akane; player 2 may also take akane (a Reflection), but nobody twice
  for (const id of order) {
    seq.push(draftCurrent(d));
    const r = draftPick(d, id);
    assert.equal(r.ok, true, id);
    assert.equal(draftPick(r.draft, id).error === 'taken' || draftCurrent(r.draft) !== draftCurrent(d), true);
    d = r.draft;
  }
  assert.deepEqual(seq, [1, 2, 2, 1, 1, 2, 2, 1, 1, 2, 2, 1]);
  assert.equal(draftDone(d), true);
  assert.equal(draftPick(d, 'akane').error, 'done');
  assert.equal(d.picks[1].length, 6);
  assert.equal(d.picks[2].length, 6);
  const dup = draftPick(createDuelDraft(p), 'akane').draft;
  assert.equal(draftPick(draftPick(dup, 'vera').draft, 'vera').error, 'taken');
  assert.equal(draftPick(createDuelDraft(p), 'liora').error, 'hero');
  // auto picks always complete a draft
  let auto = createDuelDraft(p, { allHeroes: true });
  for (let i = 0; i < 12; i++) {
    const before = draftOptions(auto).length;
    assert.ok(before > 0);
    auto = draftAutoPick(auto, 1000 + i).draft;
  }
  assert.equal(draftDone(auto), true);
});

test('duel setup: equalized L20 C0 by default, «as owned» option, Reflection for shared picks, seeded coin toss', () => {
  let p = summon(fresh(), 10, 7).profile;
  p = sanitizeProfile({ ...p, heroes: { ...p.heroes, akane: { ...p.heroes.akane, level: 9, constellation: 2, copies: 3 } } });
  const picks = { 1: ['akane', 'vera', 'shio'], 2: ['akane', 'liora', 'mara'] };
  const s = duelSetup(p, { picks, seed: 5 });
  assert.equal(s.ok, true);
  assert.equal(s.mode, 'duel');
  assert.ok(s.squads[1].every((u) => u.level === 20 && u.constellation === 0 && !u.reflection));
  assert.deepEqual(s.squads[-1].map((u) => [u.heroId, !!u.reflection]), [['akane', true], ['liora', false], ['mara', false]]);
  const owned = duelSetup(p, { picks, levelMode: 'owned', seed: 5 });
  assert.deepEqual([owned.squads[1][0].level, owned.squads[1][0].constellation], [9, 2]);
  assert.equal(owned.squads[-1][1].level, 20, 'unowned hero → equalized level');
  assert.equal(duelSetup(p, { picks, seed: 5 }).first, s.first);
  let ones = 0;
  for (let i = 0; i < 2000; i++) if (duelSetup(p, { picks, seed: i }).first === 1) ones++;
  assert.ok(ones > 900 && ones < 1100, `coin toss ${ones}/2000`);
  assert.equal(duelSetup(p, { picks: { 1: ['akane'] } }).error, 'picks');
  assert.equal(duelSetup(p, { picks, first: -1 }).first, -1);
});

test('setSquad / validateSquad: owned, unique, ≤ 6; empty keeps the old squad', () => {
  const p = summon(fresh(), 10, 11).profile;
  const owned = Object.keys(p.heroes);
  const q = setSquad(p, [owned[6], owned[6], 'liora-not-owned', owned[0], owned[1], owned[2], owned[3], owned[4], owned[5]]);
  assert.deepEqual(q.squad, [owned[6], owned[0], owned[1], owned[2], owned[3], owned[4]]);
  assert.deepEqual(setSquad(p, []).squad, p.squad);
  assert.deepEqual(setSquad(p, ['nope']).squad, p.squad);
  const v = validateSquad(p, ['akane', 'akane', 'ghost']);
  assert.equal(v.ok, false);
  assert.deepEqual(v.errors, ['duplicate:akane', 'unowned:ghost']);
  assert.deepEqual(validateSquad(p, []).errors, ['empty']);
  assert.equal(validateSquad(p, p.squad).ok, true);
});

test('formation: auto deployment by role, sq only when complete, presets', () => {
  let p = fresh();
  const auto = autoFormation(p);
  const squares = Object.values(auto);
  assert.equal(squares.length, 6);
  assert.equal(new Set(squares).size, 6);
  for (const sq of squares) assert.ok(deploySquares(1).includes(sq));
  // Guardian (Вера) and Blade (Аканэ) in the front row 6; Oracle (Масиро) and Ranger (Марен) behind
  assert.equal(Math.floor(auto.vera / 8), 6);
  assert.equal(Math.floor(auto.akane / 8), 6);
  assert.equal(Math.floor(auto.mashiro / 8), 7);
  assert.equal(Math.floor(auto.maren / 8), 7);
  p = setFormation(p, auto);
  const sq = squadFor(p);
  assert.ok(sq.every((u) => u.sq === auto[u.heroId]));
  // incomplete formation → no sq at all (engine default deployment)
  const partial = setFormation(p, { akane: auto.akane });
  assert.ok(squadFor(partial).every((u) => u.sq === undefined));
  // invalid squares are dropped
  assert.deepEqual(setFormation(p, { akane: 0, vera: 48, shio: 49 }).formation, { shio: 49 });
  // presets
  const saved = savePreset(p, 1, 'Огонь');
  assert.equal(saved.presets[1].name, 'Огонь');
  const changed = setSquad(saved, ['vera', 'shio']);
  assert.deepEqual(changed.formation, { vera: auto.vera, shio: auto.shio });
  const back = loadPreset(changed, 1);
  assert.deepEqual(back.squad, p.squad);
  assert.deepEqual(back.formation, auto);
  assert.deepEqual(loadPreset(changed, 2).squad, changed.squad, 'empty slot: no change');
  assert.ok(HERO_BY_ID[back.squad[0]]);
});
