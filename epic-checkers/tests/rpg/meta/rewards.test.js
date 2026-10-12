// applyBattleResult and the economy around it: first clears, boss rewards, ★★★ chests, repeat-win
// crystals with the shared daily cap, first battle of the day, daily tasks, XP shares (first clear,
// loss, training, bench), duels, dedupe, facts from the event log / final state, achievements, shop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { battleXp } from '../../../src/rpg/data/rules.js';
import {
  createProfile, sanitizeProfile, applyBattleResult, claimDaily, dailyStatus, normalizeBattleStats, battleMvp,
  ACHIEVEMENTS, ACHIEVEMENTS_TOTAL, achievementStatus, shopBuy, shopRemaining, SHOP, summon, dayKey, STAGES,
  xpToNext,
} from '../../../src/rpg/meta/index.js';

const DAY1 = new Date(2026, 9, 12, 10, 0, 0).getTime(); // local time: daily keys are local days
const DAY2 = new Date(2026, 9, 13, 9, 0, 0).getTime();
const H = 3600 * 1000;

const fresh = (seed = 1) => createProfile({ seed, now: DAY1 });
const camp = (p, stageId, winner = 1, extra = {}) =>
  applyBattleResult(p, { stageId, mode: 'campaign', result: { winner, rounds: 10 }, stats: { lost: 0 }, now: DAY1, ...extra });
const clearedThrough = (p, lastId) => {
  const campaign = {};
  for (const s of STAGES) {
    campaign[s.id] = { stars: 3, cleared: true };
    if (s.id === lastId) break;
  }
  return sanitizeProfile({ ...p, campaign });
};

test('first clear: 80 ✦ + scroll, ★★★ chest, first battle of the day, XP ×1.5 and bench 30 %', () => {
  let p = summon(fresh(), 10, 5).profile; // some bench heroes
  const before = JSON.stringify(p);
  const bench = Object.keys(p.heroes).filter((id) => !p.squad.includes(id));
  assert.ok(bench.length > 0);
  const r = camp(p, '1-1');
  assert.equal(JSON.stringify(p), before, 'input profile untouched');
  const kinds = r.rewards.items.map((i) => i.kind);
  assert.deepEqual(kinds.slice(0, 3), ['firstClear', 'threeStar', 'dailyFirst']);
  assert.equal(r.rewards.firstClear, true);
  assert.equal(r.rewards.stars, 3);
  assert.equal(r.rewards.threeStarChest, true);
  assert.equal(r.rewards.dailyFirst, true);
  const stageCrystals = 80 + 60 + 40;
  const achCrystals = r.rewards.items.filter((i) => i.kind === 'achievement').reduce((a, i) => a + i.crystals, 0);
  assert.equal(r.rewards.crystals, stageCrystals + achCrystals);
  assert.equal(r.profile.crystals, p.crystals + r.rewards.crystals);
  assert.equal(r.rewards.xpScrolls, 1);
  assert.equal(r.profile.xpScrolls, p.xpScrolls + 1);
  const squadXp = Math.round(battleXp(1) * 1.5);
  for (const id of p.squad) assert.equal(r.rewards.xp[id], squadXp);
  for (const id of bench) assert.equal(r.rewards.xp[id], Math.round(battleXp(1) * 1.5 * 0.3));
  // 113 XP lifts the squad to level 2; the bench's 34 XP does not (68 needed)
  assert.deepEqual(r.rewards.levelUps.map((l) => l.heroId).sort(), p.squad.slice().sort());
  for (const id of bench) assert.deepEqual([r.profile.heroes[id].level, r.profile.heroes[id].xp], [1, 34]);
  // second clear: repeat crystals only, no chest, no daily-first
  const r2 = camp(r.profile, '1-1');
  assert.equal(r2.rewards.firstClear, false);
  assert.equal(r2.rewards.threeStarChest, false);
  assert.equal(r2.rewards.dailyFirst, false);
  assert.equal(r2.rewards.repeat, 10);
  for (const id of p.squad) assert.equal(r2.rewards.xp[id], battleXp(1));
});

test('★★★ chest is paid once, also when the third star comes on a replay', () => {
  let r = applyBattleResult(fresh(), { stageId: '1-1', mode: 'campaign', result: { winner: 1, rounds: 20 }, stats: { lost: 0 }, now: DAY1 });
  assert.equal(r.rewards.stars, 2);
  assert.equal(r.rewards.threeStarChest, false);
  r = camp(r.profile, '1-1');
  assert.equal(r.rewards.threeStarChest, true);
  assert.equal(r.rewards.items.find((i) => i.kind === 'threeStar').crystals, 60);
  r = camp(r.profile, '1-1');
  assert.equal(r.rewards.threeStarChest, false);
});

test('boss first clear: 400 ✦ + 3 scrolls', () => {
  const p = clearedThrough(fresh(), '1-8');
  const r = camp(p, '1-B');
  const fc = r.rewards.items.find((i) => i.kind === 'firstClear');
  assert.deepEqual([fc.crystals, fc.xpScrolls], [400, 3]);
  const r2 = camp(clearedThrough(fresh(), '2-8'), '2-B');
  assert.equal(r2.rewards.items.find((i) => i.kind === 'firstClear').xpScrolls, 3);
  const r3 = camp(clearedThrough(fresh(), '2-B'), '3-1');
  assert.equal(r3.rewards.items.find((i) => i.kind === 'firstClear').xpScrolls, 3);
});

test('repeat wins: 10 ✦ each, 150 ✦ per day shared by stage replays and Training; resets next day', () => {
  let p = camp(fresh(), '1-1').profile;
  let total = 0;
  for (let i = 0; i < 10; i++) {
    const r = camp(p, '1-1');
    total += r.rewards.repeat;
    p = r.profile;
  }
  for (let i = 0; i < 10; i++) {
    const r = applyBattleResult(p, { mode: 'training', result: { winner: 1 }, enemyLevel: 5, now: DAY1 + H });
    total += r.rewards.repeat;
    p = r.profile;
  }
  assert.equal(total, 150);
  assert.equal(p.daily.repeatCrystals, 150);
  assert.equal(dailyStatus(p, DAY1).repeat.earned, 150);
  const next = applyBattleResult(p, { mode: 'training', result: { winner: 1 }, enemyLevel: 5, now: DAY2 });
  assert.equal(next.rewards.repeat, 10);
  assert.equal(next.rewards.dailyFirst, true);
  // losses never pay repeat crystals
  assert.equal(applyBattleResult(p, { mode: 'training', result: { winner: -1 }, enemyLevel: 5, now: DAY2 }).rewards.repeat, 0);
});

test('XP multipliers: loss 25 %, draw 25 %, Training 50 %, Training loss 12.5 %, surrender = loss', () => {
  const p = camp(fresh(), '1-1').profile; // cleared: no first-clear bonus
  const xpFor = (input) => applyBattleResult(p, { now: DAY1, ...input }).rewards.xp.akane;
  assert.equal(xpFor({ stageId: '1-2', mode: 'campaign', result: { winner: -1 } }), Math.round(battleXp(2) * 0.25));
  assert.equal(xpFor({ stageId: '1-2', mode: 'campaign', result: { winner: 0 } }), Math.round(battleXp(2) * 0.25));
  assert.equal(xpFor({ mode: 'training', result: { winner: 1 }, enemyLevel: 20 }), Math.round(battleXp(20) * 0.5));
  assert.equal(xpFor({ mode: 'training', result: { winner: -1 }, enemyLevel: 20 }), Math.round(battleXp(20) * 0.125));
  const sur = applyBattleResult(p, { stageId: '1-2', mode: 'campaign', result: { winner: -1, reason: 'surrender' }, now: DAY1 });
  assert.equal(sur.rewards.xp.akane, Math.round(battleXp(2) * 0.25));
  assert.equal(sur.profile.stats.surrenders, 1);
  assert.equal(sur.profile.campaign['1-2'].lossStreak, 1);
  assert.equal(sur.profile.campaign['1-2'].cleared, false);
  // Training level from the enemy squad when enemyLevel is not given
  const t = applyBattleResult(p, { mode: 'training', result: { winner: 1 }, enemySquad: [{ heroId: 'vera', level: 9 }, { heroId: 'mara', level: 11 }], now: DAY1 });
  assert.equal(t.rewards.enemyLevel, 10);
});

test('first battle of the day counts losses too; daily tasks 3 wins / 5 reactions / 2 Flashes auto-claim', () => {
  let p = fresh();
  let r = applyBattleResult(p, { mode: 'training', result: { winner: -1 }, stats: { reactions: 3, ults: 1 }, enemyLevel: 1, now: DAY1 });
  assert.equal(r.rewards.dailyFirst, true);
  assert.equal(r.rewards.items.filter((i) => i.kind === 'task').length, 0);
  p = r.profile;
  r = applyBattleResult(p, { mode: 'training', result: { winner: 1 }, stats: { reactions: 2, ults: 1 }, enemyLevel: 1, now: DAY1 });
  const tasks = r.rewards.items.filter((i) => i.kind === 'task').map((i) => [i.id, i.crystals, i.xpScrolls]);
  assert.deepEqual(tasks, [['react5', 20, 0], ['ult2', 20, 1]]);
  p = r.profile;
  for (let i = 0; i < 2; i++) p = applyBattleResult(p, { mode: 'training', result: { winner: 1 }, enemyLevel: 1, now: DAY1 }).profile;
  const st = dailyStatus(p, DAY1);
  assert.ok(st.tasks.every((t) => t.done && t.claimed), JSON.stringify(st.tasks));
  assert.equal(st.maxPerDay, 260);
  // duels do not progress daily tasks nor pay the first battle
  const d = applyBattleResult(fresh(), { mode: 'duel', result: { winner: 1 }, stats: { reactions: 9, ults: 9 }, now: DAY1 });
  assert.equal(d.rewards.dailyFirst, false);
  assert.equal(d.profile.daily.tasks.react5.progress, 0);
});

test('autoClaim: false leaves completed tasks for claimDaily; claimDaily rolls the day forward only', () => {
  let p = fresh();
  for (let i = 0; i < 3; i++) p = applyBattleResult(p, { mode: 'training', result: { winner: 1 }, enemyLevel: 1, now: DAY1, autoClaim: false }).profile;
  assert.equal(p.daily.tasks.win3.claimed, false);
  const c = claimDaily(p, DAY1 + H);
  assert.equal(c.newDay, false);
  assert.equal(c.rewards.crystals, 30);
  assert.equal(c.profile.crystals, p.crystals + 30);
  assert.equal(claimDaily(c.profile, DAY1 + 2 * H).rewards.crystals, 0, 'nothing twice');
  const n = claimDaily(c.profile, DAY2);
  assert.equal(n.newDay, true);
  assert.equal(n.profile.daily.day, dayKey(DAY2));
  assert.equal(n.profile.daily.tasks.win3.progress, 0);
  // clock moved back: no reset (anti-farming)
  const back = claimDaily(n.profile, DAY1);
  assert.equal(back.newDay, false);
  assert.equal(back.profile.daily.day, dayKey(DAY2));
  assert.equal(dailyStatus(n.profile, DAY2 + 30 * H).firstBattle.claimed, false, 'a stale day shows as reset');
});

test('duel: no crystals or XP, but counts for achievements', () => {
  const p = fresh();
  const r = applyBattleResult(p, { mode: 'duel', result: { winner: -1 }, now: DAY1 });
  assert.equal(r.profile.stats.duels, 1);
  assert.deepEqual(r.rewards.xp, {});
  assert.deepEqual(r.rewards.achievements, ['first-duel']);
  assert.equal(r.rewards.crystals, 30);
  assert.equal(r.profile.crystals, p.crystals + 30);
  assert.ok(Object.values(r.profile.heroes).every((e) => e.level === 1 && e.xp === 0));
});

test('battleId dedupe: the same battle is never rewarded twice', () => {
  const r1 = camp(fresh(), '1-1', 1, { battleId: 'b-123' });
  const r2 = camp(r1.profile, '1-1', 1, { battleId: 'b-123' });
  assert.equal(r2.rewards.duplicate, true);
  assert.equal(r2.profile, r1.profile);
  assert.equal(camp(r1.profile, '1-1', 1, { battleId: 'b-124' }).rewards.duplicate, undefined);
  assert.equal(applyBattleResult(fresh(), { stageId: 'x-9', mode: 'campaign', result: { winner: 1 } }).rewards.error, 'stage');
});

// A small battle in contract vocabulary: player units p1..p3 (side 1), enemies e1..e3 (side −1), a ward w1.
function fixtureBattle() {
  const state = {
    round: 7,
    side: 1,
    units: [
      { id: 'p1', heroId: 'akane', side: 1, alive: true, hp: 500, level: 4 },
      { id: 'p2', heroId: 'vera', side: 1, alive: false, hp: 0, level: 4 },
      { id: 'p3', heroId: 'mashiro', side: 1, alive: true, hp: 300, level: 4 },
      { id: 'e1', heroId: 'mara', side: -1, alive: false, hp: 0, level: 5 },
      { id: 'e2', heroId: 'shio', side: -1, alive: false, hp: 0, level: 5 },
      { id: 'e3', heroId: 'iskra', side: -1, alive: false, hp: 0, level: 5 },
      { id: 'w1', heroId: 'volta', side: -1, alive: false, hp: 0, ward: true },
    ],
    wards: [{ id: 'w9', kind: 'ball-lightning', side: -1, sq: 20, hp: 0 }],
  };
  const events = [
    { type: 'turnStart', side: 1, round: 1 },
    { type: 'jump', unit: 'p1', from: 50, to: 36, over: 43 },
    { type: 'damage', source: 'p1', target: 'e1', amount: 300 },
    { type: 'reaction', target: 'e1', reaction: 'steam', elements: ['flame', 'tide'] },
    { type: 'jump', unit: 'p1', from: 36, to: 22, over: 29 },
    { type: 'damage', source: 'p1', target: 'e2', amount: 250 },
    { type: 'ko', unit: 'e2' },
    { type: 'jump', unit: 'p1', from: 22, to: 8, over: 15 },
    { type: 'ko', unit: 'w1' },
    { type: 'ko', unit: 'w9' },
    { type: 'awaken', unit: 'p1' },
    { type: 'turnEnd', side: 1 },
    { type: 'turnStart', side: -1, round: 1 },
    { type: 'cast', unit: 'e3', kind: 'ult', abilityId: 'x' },
    { type: 'damage', source: 'e3', target: 'p2', amount: 999 },
    { type: 'reaction', target: 'p2', reaction: 'arc', elements: ['tide', 'storm'] },
    { type: 'ko', unit: 'p2' },
    { type: 'turnEnd', side: -1 },
    { type: 'turnStart', side: 1, round: 2 },
    { type: 'cast', unit: 'p3', kind: 'ult', abilityId: 'y' },
    { type: 'heal', source: 'p3', target: 'p1', amount: 100 },
    { type: 'damage', source: 'p3', target: 'e1', amount: 50 },
    { type: 'reaction', target: 'e1', reaction: 'eclipse', elements: ['radiance', 'umbra'] },
    { type: 'ko', unit: 'e1' },
    { type: 'turnStart', side: 1, round: 7 },
    { type: 'jump', unit: 'p3', from: 1, to: 2, over: 3 },
    { type: 'ko', unit: 'e3' },
    { type: 'victory', winner: 1, reason: 'elimination' },
  ];
  return { state, events };
}

test('facts from the event log + final state (contract vocabulary)', () => {
  const { state, events } = fixtureBattle();
  const f = normalizeBattleStats({ result: { winner: 1, reason: 'elimination', rounds: 7 }, state, events });
  assert.equal(f.won, true);
  assert.equal(f.rounds, 7);
  assert.equal(f.lost, 1);
  assert.equal(f.alive, 2);
  assert.equal(f.squadSize, 3);
  assert.equal(f.kos, 3, 'ward KO not counted');
  assert.equal(f.reactions, 2, 'enemy-triggered Arc not counted');
  assert.deepEqual(f.reactionKinds, { steam: 1, eclipse: 1 });
  assert.equal(f.ults, 1);
  assert.equal(f.awakenings, 1);
  assert.equal(f.maxChain, 3);
  assert.equal(f.mvp, 'akane');
  assert.equal(battleMvp(state, events, -1), 'iskra');
  // explicit stats win over derived ones; per-side stats objects are understood
  const g = normalizeBattleStats({ result: { winner: 1, rounds: 7, stats: { 1: { reactions: 9, ults: 4 }, [-1]: { reactions: 1 } } }, state, events });
  assert.equal(g.reactions, 9);
  assert.equal(g.ults, 4);
  // string results
  assert.equal(normalizeBattleStats({ result: 'victory' }).won, true);
  assert.equal(normalizeBattleStats({ result: 'surrender' }).surrendered, true);
  assert.equal(normalizeBattleStats({ result: 'draw' }).draw, true);
  // stars from the state: 1 hero lost → ★★
  const p = sanitizeProfile({ ...fresh(), campaign: {} });
  const r = applyBattleResult(p, { stageId: '1-1', mode: 'campaign', result: { winner: 1, rounds: 7 }, state, events, now: DAY1 });
  assert.equal(r.rewards.stars, 2);
  assert.equal(r.profile.stats.maxChain, 3);
  assert.equal(r.profile.stats.reactionKinds.eclipse, 1);
  assert.ok(r.rewards.achievements.includes('eclipse'));
  assert.ok(r.rewards.achievements.includes('chain-3'));
  assert.ok(r.rewards.achievements.includes('first-crown'));
  assert.ok(!r.rewards.achievements.includes('flawless'));
});

test('achievements: 40 one-offs, 30–150 ✦ each, 2 400 ✦ in total, all reachable, credited once', () => {
  assert.equal(ACHIEVEMENTS.length, 40);
  assert.equal(ACHIEVEMENTS_TOTAL, 2400);
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, 40);
  for (const a of ACHIEVEMENTS) {
    assert.ok(a.crystals >= 30 && a.crystals <= 150, a.id);
    assert.ok(a.name.ru && a.name.en && a.desc.ru && a.desc.en, a.id);
  }
  // a maxed-out profile unlocks every achievement exactly once
  const heroes = {};
  for (const id of ['liora', 'nocturna', 'reika', 'fuyuka', 'vermilia', 'tsubame', 'mizuha', 'akane', 'volta', 'koyuki', 'lucille', 'karasu', 'zlata', 'kaede', 'torvald', 'shio', 'maren', 'mashiro', 'iskra', 'sirin', 'falk', 'runa', 'vera', 'mara']) {
    heroes[id] = { level: 30, xp: 0, constellation: 6, copies: 7 };
  }
  const campaign = Object.fromEntries(STAGES.map((s) => [s.id, { stars: 3, cleared: true }]));
  const stats = {
    wins: 100, awakenings: 25, maxChain: 4, reactions: 100, ults: 50, kos: 100, flawlessWins: 1, lastStandWins: 1,
    summons: 100, dustEarned: 500, xpScrollsUsed: 20, trainingWins: 10, duels: 10,
    reactionKinds: { steam: 1, detonation: 1, shackles: 1, arc: 1, brittle: 1, vortex: 1, facet: 1, eclipse: 1 },
  };
  const p = sanitizeProfile({ ...fresh(), heroes, campaign, stats });
  assert.ok(achievementStatus(p).every((a) => !a.done && a.progress === a.target));
  const r = applyBattleResult(p, { mode: 'duel', result: { winner: 1 }, now: DAY1 });
  assert.equal(r.rewards.achievements.length, 40);
  assert.equal(r.rewards.crystals, 2400);
  assert.ok(achievementStatus(r.profile).every((a) => a.done));
  const again = applyBattleResult(r.profile, { mode: 'duel', result: { winner: 1 }, now: DAY1 });
  assert.equal(again.rewards.crystals, 0);
});

test('Star Shop: scrolls, weekly-limited summon tickets, constellation stars for owned heroes', () => {
  let p = sanitizeProfile({ ...fresh(), dust: 5000, heroes: { ...fresh().heroes, reika: { level: 1, xp: 0, constellation: 5, copies: 6 } } });
  assert.deepEqual(SHOP.map((s) => [s.id, s.price]), [['xp-scroll', 10], ['summon-ticket', 100], ['epic-star', 250], ['legendary-star', 900], ['mythic-star', 1500]]);
  let r = shopBuy(p, 'xp-scroll', { now: DAY1 });
  assert.equal(r.profile.xpScrolls, p.xpScrolls + 1);
  assert.equal(r.profile.dust, 4990);
  p = r.profile;
  for (let i = 0; i < 5; i++) {
    r = shopBuy(p, 'summon-ticket', { now: DAY1 });
    assert.equal(r.ok, true);
    p = r.profile;
  }
  assert.equal(p.tickets, 5);
  assert.equal(shopRemaining(p, 'summon-ticket', DAY1), 0);
  assert.equal(shopBuy(p, 'summon-ticket', { now: DAY1 }).error, 'limit');
  assert.equal(shopRemaining(p, 'summon-ticket', DAY1 + 8 * 24 * H), 5, 'new week');
  assert.equal(shopBuy(p, 'epic-star', { heroId: 'reika', now: DAY1 }).error, 'hero', 'wrong rarity');
  assert.equal(shopBuy(p, 'legendary-star', { heroId: 'fuyuka', now: DAY1 }).error, 'hero', 'not owned');
  r = shopBuy(p, 'legendary-star', { heroId: 'reika', now: DAY1 });
  assert.equal(r.profile.heroes.reika.constellation, 6);
  assert.equal(shopBuy(r.profile, 'legendary-star', { heroId: 'reika', now: DAY1 }).error, 'maxed');
  assert.equal(shopBuy(sanitizeProfile({ ...p, dust: 5 }), 'xp-scroll').error, 'dust');
  assert.equal(shopBuy(p, 'nope').error, 'item');
  // tickets pay for pulls first
  const s = summon(p, 10, { seed: 1, now: DAY1 });
  assert.equal(s.cost.tickets, 5);
  assert.equal(s.cost.crystals, 800);
});

test('a hero at the level cap keeps a full XP bar until the cap rises', () => {
  const p = sanitizeProfile({ ...fresh(), heroes: { ...fresh().heroes, akane: { level: 10, xp: 0, constellation: 0, copies: 1 } } });
  const r = applyBattleResult(p, { mode: 'training', result: { winner: 1 }, enemyLevel: 30, now: DAY1 });
  assert.equal(r.profile.heroes.akane.level, 10);
  assert.equal(r.profile.heroes.akane.xp, xpToNext(10));
  assert.equal(r.rewards.xpDetail.akane.gained, xpToNext(10));
});

test('per-side stat values ({ 1: x, -1: y }) resolve to the player side', () => {
  const f = normalizeBattleStats({
    result: { winner: 1, rounds: 12, stats: { reactions: { 1: 4, [-1]: 9 }, ults: { 1: 2, [-1]: 5 }, reactionKinds: { 1: { steam: 3, arc: 1 }, [-1]: { eclipse: 9 } }, lost: { 1: 1, [-1]: 6 } } },
  });
  assert.deepEqual([f.reactions, f.ults, f.lost, f.rounds], [4, 2, 1, 12]);
  assert.deepEqual(f.reactionKinds, { steam: 3, arc: 1 });
  const e = normalizeBattleStats({ result: { winner: 1, stats: { player: { kos: 3 }, enemy: { kos: 5 } } } });
  assert.equal(e.kos, 3);
});

test('mutators accept a partial / unsanitized profile object without crashing', () => {
  const partial = { crystals: 2000, heroes: { akane: { level: 3 } } };
  const r = applyBattleResult(partial, { stageId: '1-1', mode: 'campaign', result: { winner: 1, rounds: 8 }, now: DAY1 });
  assert.equal(r.rewards.firstClear, true);
  assert.equal(r.profile.heroes.akane.level >= 3, true);
  const s = summon(partial, 10, 3);
  assert.equal(s.ok, true);
  assert.equal(s.profile.pity.total, 10);
  assert.equal(claimDaily(null, DAY1).profile.crystals, 3200);
});
