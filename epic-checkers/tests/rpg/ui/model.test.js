import test from 'node:test';
import assert from 'node:assert/strict';
import {
  heroStats, powerOf, heroPower, squadPower, abilityNumbers, xpProgress, xpGainPath, levelCap,
  squadReactions, squadSynergy, autoSquad, chapterNodes, chapterSummary, isStageUnlocked, nextStage,
  recommendedPower, stageEnemyIds, stageById, summonCost, canSummonCount, pityInfo, bestRarity,
  revealOrder, refundDust, hpShare, sqName, trainingEnemies, DUEL_DRAFT, draftTurn, collectionList,
  battleStars, normalizeLevelUps, pickMvp, voiceLines, isVoiced, STAGE_LIST, profileSquad, squadEntries,
} from '../../../src/rpg/ui/model.js';
import { HEROES } from '../../../src/rpg/data/heroes.js';
import { statsAt, xpToNext, GACHA } from '../../../src/rpg/data/rules.js';

const STARTER = ['akane', 'vera', 'shio', 'maren', 'iskra', 'mashiro'];
const profileWith = (extra = {}) => ({
  v: 1,
  crystals: 3200,
  heroes: Object.fromEntries(STARTER.map((id) => [id, { level: 1, xp: 0, constellation: 0, copies: 1 }])),
  squad: STARTER.slice(),
  campaign: {},
  pity: {},
  ...extra,
});

test('heroStats = statsAt at C0 and applies constellation stat mods', () => {
  const vera = HEROES.find((h) => h.id === 'vera');
  assert.deepEqual(heroStats(vera, 10, 0), statsAt(vera, 10));
  const c = vera.constellations.flatMap((x) => (x.c <= 6 ? x.patches : [])).filter((p) => p.mod);
  const s6 = heroStats(vera, 10, 6);
  const base = statsAt(vera, 10);
  const hpPct = c.filter((p) => p.mod.stat === 'hpPct').reduce((a, p) => a + p.mod.value, 0);
  assert.equal(s6.hp, Math.floor(base.hp * (1 + hpPct)));
});

test('power formula = (HP/10 + ATK + DEF) × (1 + 0.05C)', () => {
  const s = heroStats('akane', 5, 0);
  assert.equal(powerOf('akane', 5, 0), Math.round(s.hp / 10 + s.atk + s.def));
  const s2 = heroStats('akane', 5, 2);
  assert.equal(powerOf('akane', 5, 2), Math.round((s2.hp / 10 + s2.atk + s2.def) * 1.1));
  const p = profileWith();
  assert.equal(squadPower(p, STARTER), STARTER.reduce((a, id) => a + powerOf(id, 1, 0), 0));
  // injected meta wins
  assert.equal(heroPower(p, 'akane', { heroPower: () => 1234.4 }), 1234);
});

test('abilityNumbers applies cooldown / cost / multiplier patches', () => {
  const liora = abilityNumbers('liora', 6);
  assert.equal(liora.ultCost, 80);
  assert.ok(Math.abs(liora.skillMult - 1.2) < 1e-9);
  assert.ok(Math.abs(liora.ultMult - 1.2) < 1e-9);
  const mara = abilityNumbers('mara', 6);
  assert.equal(mara.skillCooldown, 2);
  assert.equal(abilityNumbers('mara', 0).skillCooldown, 3);
});

test('xpProgress / xpGainPath', () => {
  assert.deepEqual(xpProgress(1, 34), { level: 1, xp: 34, need: 68, pct: 0.5, max: false });
  assert.equal(xpProgress(30, 0).max, true);
  // an old total-XP value is converted
  const conv = xpProgress(1, 68 + 10);
  assert.equal(conv.level, 2);
  assert.equal(conv.xp, 10);
  const path = xpGainPath(3, 20, xpToNext(2) + 30);
  assert.equal(path.to.level, 3);
  assert.equal(path.from.level, 1);
  assert.equal(path.levelUps, 2);
  // from = level 1 with (xpToNext(1) - 10) xp
  assert.equal(path.from.xp, xpToNext(1) - 10);
});

test('levelCap follows boss clears', () => {
  assert.equal(levelCap(profileWith()), 10);
  assert.equal(levelCap(profileWith({ campaign: { '1-B': { stars: 1, cleared: true } } })), 20);
  assert.equal(levelCap(profileWith({ campaign: { '1-B': { stars: 1 }, '2-B': { stars: 2 } } })), 30);
});

test('squad reactions: the starter squad has every natural pair', () => {
  const r = squadReactions(STARTER);
  for (const id of ['steam', 'shackles', 'arc', 'brittle', 'detonation']) assert.ok(r.includes(id), id);
  assert.ok(!r.includes('eclipse'));
  assert.ok(squadReactions(['liora', 'nocturna']).includes('eclipse'));
  assert.ok(squadReactions(['kaede', 'akane']).includes('vortex'));
  assert.ok(!squadReactions(['kaede', 'zlata']).includes('vortex'));
  const syn = squadSynergy(STARTER);
  assert.deepEqual(syn.missingRoles, ['mystic']);
  assert.equal(syn.noHealer, false);
  assert.equal(syn.empty, 0);
});

test('autoSquad picks the strongest and keeps a healer', () => {
  const p = profileWith({
    heroes: {
      liora: { level: 10 }, nocturna: { level: 10 }, reika: { level: 10 }, fuyuka: { level: 10 },
      vermilia: { level: 10 }, tsubame: { level: 10 }, mashiro: { level: 1 }, iskra: { level: 1 },
    },
  });
  const s = autoSquad(p);
  assert.equal(s.length, 6);
  assert.ok(s.includes('mashiro'), 'oracle kept');
  assert.ok(s.includes('liora'));
});

test('campaign: unlocks, current node, summary, next stage', () => {
  const p = profileWith();
  assert.equal(STAGE_LIST.length, 27);
  assert.equal(isStageUnlocked(p, '1-1'), true);
  assert.equal(isStageUnlocked(p, '1-2'), false);
  const p2 = profileWith({ campaign: { '1-1': { stars: 3, cleared: true }, '1-2': { stars: 1, cleared: true } } });
  const nodes = chapterNodes(p2, 1);
  assert.equal(nodes.length, 9);
  assert.equal(nodes[2].unlocked, true);
  assert.equal(nodes[2].current, true);
  assert.equal(nodes[3].unlocked, false);
  assert.deepEqual(
    { cleared: chapterSummary(p2, 1).cleared, stars: chapterSummary(p2, 1).stars },
    { cleared: 2, stars: 4 },
  );
  assert.equal(chapterSummary(p2, 2).unlocked, false);
  assert.equal(nextStage(p2).id, '1-3');
  assert.equal(isStageUnlocked(p2, '1-5', { isUnlocked: () => true }), true);
});

test('stage enemies / recommended power', () => {
  const b = stageById('1-B');
  assert.deepEqual(stageEnemyIds(b), ['tsubame', 'kaede', 'sirin', 'vera']);
  const mirror = stageById('3-8');
  assert.deepEqual(stageEnemyIds(mirror, profileWith()), STARTER);
  assert.ok(recommendedPower(stageById('1-1')) > 0);
  assert.ok(recommendedPower(stageById('3-1')) > recommendedPower(stageById('1-1')));
});

test('summon cost / can summon / novice ×10 only', () => {
  assert.equal(summonCost(1), GACHA.cost.single);
  assert.equal(summonCost(10), GACHA.cost.multi);
  assert.equal(summonCost(10, { SUMMON_COST: { single: 100, multi: 900 } }), 900);
  assert.equal(canSummonCount(profileWith({ crystals: 100 }), 1), false);
  assert.equal(canSummonCount(profileWith({ crystals: 1600 }), 10), true);
  // ×1 during the novice banner goes to the standard banner (meta: bannerFor)
  assert.equal(canSummonCount(profileWith({ crystals: 1600, pity: { novicePulls: 10 } }), 1), true);
  assert.equal(canSummonCount(profileWith({ crystals: 100 }), 1, { canSummon: () => true }), true);
});

test('pityInfo reads tolerant shapes and meta', () => {
  assert.deepEqual(pityInfo(profileWith({ pity: { sinceEpicPlus: 3, sinceLegendaryPlus: 22, novicePulls: 20 } })), {
    toEpicPlus: 7, toLegendaryPlus: 38, legendaryStreak: 0, novicePullsLeft: 0,
  });
  const def = pityInfo(profileWith());
  assert.equal(def.toEpicPlus, 10);
  assert.equal(def.toLegendaryPlus, 60);
  const m = pityInfo(profileWith(), { pityStatus: () => ({ toEpicPlus: 2, toLegendaryPlus: 5, novicePullsLeft: 10 }) });
  assert.equal(m.toEpicPlus, 2);
  assert.equal(m.novicePullsLeft, 10);
});

test('summon ordering: best rarity last, stable', () => {
  const res = [
    { heroId: 'vera', rarity: 'rare' },
    { heroId: 'liora', rarity: 'mythic', isNew: true },
    { heroId: 'akane', rarity: 'epic' },
    { heroId: 'mara', rarity: 'rare' },
  ];
  assert.equal(bestRarity(res), 'mythic');
  assert.deepEqual(revealOrder(res).map((r) => r.heroId), ['vera', 'akane', 'mara', 'liora']);
  assert.deepEqual(revealOrder([{ heroId: 'vera' }, { heroId: 'mara' }]).map((r) => r.heroId), ['vera', 'mara']);
  assert.equal(refundDust({ refund: 60 }), 60);
  assert.equal(refundDust({ refund: { dust: 20 } }), 20);
  assert.equal(refundDust({}), 0);
});

test('battle helpers', () => {
  const state = {
    units: [
      { id: 1, heroId: 'akane', side: 1, hp: 50, maxHp: 100, alive: true },
      { id: 2, heroId: 'vera', side: 1, hp: 0, maxHp: 100, alive: false },
      { id: 3, heroId: 'mara', side: -1, hp: 80, maxHp: 80, alive: true },
      { id: 4, heroId: 'egg', side: -1, hp: 10, maxHp: 10, ward: true },
    ],
  };
  assert.deepEqual(hpShare(state, 1), { cur: 50, max: 200, pct: 0.25 });
  assert.equal(hpShare(state, -1).pct, 1);
  assert.equal(sqName(7 * 8 + 0), 'a1');
  assert.equal(sqName(0 * 8 + 7), 'h8');
});

test('training enemies and duel draft order', () => {
  const r = trainingEnemies({ kind: 'random', level: 12, seed: 42 });
  assert.equal(r.length, 6);
  assert.equal(new Set(r.map((x) => x.heroId)).size, 6);
  assert.ok(r.every((x) => x.level === 12 && x.constellation === 0));
  assert.ok(r.filter((x) => ['legendary', 'mythic'].includes(HEROES.find((h) => h.id === x.heroId).rarity)).length <= 1);
  assert.deepEqual(trainingEnemies({ kind: 'random', seed: 42 }).map((x) => x.heroId), trainingEnemies({ kind: 'random', seed: 42 }).map((x) => x.heroId));
  assert.equal(trainingEnemies({ kind: 'chapter', chapter: 2, seed: 3 }).length, 6);
  assert.deepEqual(trainingEnemies({ kind: 'mirror', profile: profileWith() }).map((x) => x.heroId), STARTER);
  assert.equal(DUEL_DRAFT.filter((s) => s === 1).length, 6);
  assert.equal(DUEL_DRAFT.filter((s) => s === -1).length, 6);
  assert.deepEqual(draftTurn([]), { side: 1, left: 1, index: 0 });
  assert.deepEqual(draftTurn(['a']), { side: -1, left: 2, index: 1 });
  assert.deepEqual(draftTurn(['a', 'b']), { side: -1, left: 1, index: 2 });
  assert.equal(draftTurn(new Array(12).fill('x')), null);
});

test('collection filters / sorting', () => {
  const p = profileWith();
  const all = collectionList(p);
  assert.equal(all.length, 24);
  assert.ok(all.slice(0, 6).every((x) => x.owned), 'owned first');
  assert.equal(all[0].id, 'akane', 'epic owned before rares');
  assert.equal(collectionList(p, { owned: 'missing' }).length, 18);
  assert.equal(collectionList(p, { element: 'flame' }).length, 3);
  assert.equal(collectionList(p, { role: 'oracle', rarity: 'rare' }).length, 2);
});

test('results helpers', () => {
  assert.equal(battleStars({ rewards: { stars: 2 } }), 2);
  assert.equal(battleStars({ result: { winner: -1 } }), 0);
  assert.equal(battleStars({ result: { winner: 1, rounds: 10, stats: { kosTaken: 0 } }, stage: stageById('1-1') }), 3);
  assert.equal(battleStars({ result: { winner: 1, rounds: 20, stats: { kosTaken: 0 } }, stage: stageById('1-1') }), 2);
  assert.equal(battleStars({ result: { winner: 1, rounds: 10, stats: { kosTaken: 3 } }, stage: stageById('1-1') }), 1);
  assert.deepEqual(normalizeLevelUps(['akane', { heroId: 'vera', from: 1, to: 3 }, { id: 'mara', level: 4 }]), [
    { heroId: 'akane', from: null, to: null },
    { heroId: 'vera', from: 1, to: 3 },
    { heroId: 'mara', from: null, to: 4 },
  ]);
  assert.equal(pickMvp({ result: { stats: { damage: { vera: 10, akane: 99 } } }, squad: STARTER }), 'akane');
  assert.equal(pickMvp({ result: {}, squad: STARTER }), 'akane');
});

test('voice lines exist for every Epic+ hero only', () => {
  for (const h of HEROES) {
    const v = voiceLines(h.id);
    if (h.rarity === 'rare') assert.equal(v.length, 0, h.id);
    else {
      assert.equal(isVoiced(h.id), true, h.id);
      assert.equal(v.length, 4, h.id);
      assert.deepEqual(v.map((x) => x.event), ['summon', 'skill', 'ultimate', 'victory']);
    }
  }
});

test('profileSquad / squadEntries sanitize', () => {
  const p = profileWith({ squad: ['akane', 'akane', 'nobody', 'vera'] });
  assert.deepEqual(profileSquad(p), ['akane', 'vera']);
  assert.deepEqual(squadEntries(p, ['akane']), [{ heroId: 'akane', level: 1, constellation: 0 }]);
  assert.deepEqual(squadEntries(p, ['liora'], { level: 20, constellation: 0 }), [{ heroId: 'liora', level: 20, constellation: 0 }]);
});

test('XP scrolls: owned / useful (local rule and meta)', async () => {
  const { scrollsOwned, scrollsUseful } = await import('../../../src/rpg/ui/model.js');
  const p = profileWith({ xpScrolls: 3 });
  assert.equal(scrollsOwned(p), 3);
  // level 1 at cap 10: needs Σ xpToNext(1..10) XP -> ceil(/1000)
  let need = 0;
  for (let L = 1; L <= 10; L++) need += xpToNext(L);
  assert.equal(scrollsUseful(p, 'akane'), Math.ceil(need / 1000));
  assert.equal(scrollsUseful(p, 'liora'), 0, 'not owned');
  const full = profileWith({ heroes: { akane: { level: 10, xp: xpToNext(10) } } });
  assert.equal(scrollsUseful(full, 'akane'), 0);
  assert.equal(scrollsUseful(p, 'akane', { scrollsUseful: () => 2 }), 2);
});
