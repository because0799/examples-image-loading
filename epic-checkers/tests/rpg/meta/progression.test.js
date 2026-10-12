// Progression: XP curve and battle XP vs the GDD §11 tables, level caps 10 / 20 / 30, XP at the
// cap, stats (rules.statsAt + constellation mods, GDD §19.1 table), «Мощь», XP scrolls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { statsAt } from '../../../src/rpg/data/rules.js';
import { HEROES, HERO_BY_ID } from '../../../src/rpg/data/heroes.js';
import {
  xpToNext, totalXpFor, battleXp, addXp, levelCap, nextLevelCap, heroStatsAt, powerAt, heroPower, squadPower,
  createProfile, sanitizeProfile, useXpScrolls, scrollsUseful, xpProgress, constellationMods, collectionView,
  heroView, collectionSummary, markHeroSeen, applyBattleResult, MAX_LEVEL,
} from '../../../src/rpg/meta/index.js';

const NOW = Date.UTC(2026, 9, 12, 9, 0, 0);

test('XP curve XP(L) = 60·L + 8·L² — GDD §11.1 table', () => {
  const table = [[1, 68, 68], [5, 500, 1340], [9, 1188, 4980], [15, 2700, 17120], [19, 4028, 31160], [25, 6500, 63700], [29, 8468, 94540]];
  for (const [l, step, total] of table) {
    assert.equal(xpToNext(l), step, `step ${l}`);
    assert.equal(totalXpFor(l + 1), total, `total to ${l + 1}`);
  }
  assert.equal(totalXpFor(30), 94540);
  assert.equal(totalXpFor(1), 0);
});

test('battle XP 25·L^1.5 + 50 — 75 / 841 / 2 286 / 4 158; chapter 1 first clears ≈ 5 015 XP', () => {
  assert.equal(battleXp(1), 75);
  assert.equal(battleXp(10), 841);
  assert.equal(battleXp(20), 2286);
  assert.equal(battleXp(30), 4158);
  const ch1 = [1, 2, 3, 4, 5, 6, 7, 8, 10].reduce((a, l) => a + battleXp(l) * 1.5, 0);
  assert.ok(Math.abs(ch1 - 5015) < 3, `${ch1}`);
});

test('addXp: level-ups, the cap fills the bar, raising the cap converts it', () => {
  let r = addXp({ level: 1, xp: 0 }, 68, 10);
  assert.deepEqual([r.level, r.xp, r.from, r.to], [2, 0, 1, 2]);
  r = addXp({ level: 1, xp: 0 }, 4980, 10);
  assert.deepEqual([r.level, r.xp], [10, 0]);
  r = addXp({ level: 1, xp: 0 }, 1e6, 10);
  assert.equal(r.level, 10);
  assert.equal(r.xp, xpToNext(10), 'bar full at the cap');
  assert.equal(r.gained, 4980 + xpToNext(10));
  assert.equal(r.wasted, 1e6 - r.gained);
  const raised = addXp({ level: r.level, xp: r.xp }, 0, 20);
  assert.deepEqual([raised.level, raised.xp], [11, 0]);
  const max = addXp({ level: 29, xp: 0 }, 1e9, 30);
  assert.deepEqual([max.level, max.xp], [30, 0]);
  assert.deepEqual(xpProgress({ level: 30, xp: 0 }).max, true);
  assert.deepEqual(xpProgress({ level: 10, xp: 1400 }, 10).atCap, true);
});

test('level caps: 10 at start, 20 after 1-B, 30 after 2-B', () => {
  const p = createProfile({ seed: 1, now: NOW });
  assert.equal(levelCap(p), 10);
  assert.deepEqual(nextLevelCap(p), { cap: 20, stageId: '1-B' });
  const p2 = sanitizeProfile({ ...p, campaign: { '1-B': { stars: 1, cleared: true } } });
  assert.equal(levelCap(p2), 20);
  const p3 = sanitizeProfile({ ...p, campaign: { '1-B': { stars: 1 }, '2-B': { stars: 2 } } });
  assert.equal(levelCap(p3), 30);
  assert.equal(nextLevelCap(p3), null);
});

test('clearing a chapter boss raises the cap and converts full XP bars into levels', () => {
  let p = createProfile({ seed: 2, now: NOW });
  const heroes = {};
  for (const [id, e] of Object.entries(p.heroes)) heroes[id] = { ...e, level: 10, xp: xpToNext(10) };
  const campaign = {};
  for (const id of ['1-1', '1-2', '1-3', '1-4', '1-5', '1-6', '1-7', '1-8']) campaign[id] = { stars: 3, cleared: true };
  p = sanitizeProfile({ ...p, heroes, campaign });
  const r = applyBattleResult(p, { stageId: '1-B', mode: 'campaign', result: { winner: 1, rounds: 19 }, stats: { lost: 0 }, now: NOW });
  assert.deepEqual(r.rewards.capRaised, { from: 10, to: 20, stageId: '1-B' });
  // full bar → 11, then 841 × 1.5 = 1 262 XP more: 11 → 11 (needs 1 628)
  for (const lu of r.rewards.levelUps) assert.deepEqual([lu.from, lu.to], [10, 11]);
  assert.equal(r.profile.heroes.akane.level, 11);
  assert.equal(r.profile.heroes.akane.xp, Math.round(841 * 1.5));
  assert.equal(levelCap(r.profile), 20);
});

test('stats: statsAt + unconditional constellation mods; GDD §19.1 level-30 values', () => {
  // GDD §19.1 sample rows (HP / ATK / DEF at L30, C0), after the battle engine's balance pass on
  // heroes.js: Nocturna's ATK 846 → 786 (base 280 → 250, growth 20.7 → 18.5), every Rare ×1.05
  const rows = { liora: [2296, 842, 161], nocturna: [2044, 786, 115], fuyuka: [2933, 355, 308], akane: [1969, 753, 125], vera: [2560, 327, 258], mara: [1624, 682, 87] };
  for (const [id, [hp, atk, def]] of Object.entries(rows)) {
    const s = heroStatsAt(id, 30, 0);
    assert.deepEqual([s.hp, s.atk, s.def], [hp, atk, def], id);
  }
  for (const h of HEROES) {
    for (const l of [1, 10, 30]) assert.deepEqual(heroStatsAt(h.id, l, 0).base, statsAt(h, l));
    const mods = constellationMods(h, 6);
    const s6 = heroStatsAt(h.id, 20, 6);
    const b = statsAt(h, 20);
    assert.equal(s6.hp, Math.floor(b.hp * (1 + mods.hpPct)), h.id);
    assert.equal(s6.atk, Math.floor(b.atk * (1 + mods.atkPct)), h.id);
    assert.equal(s6.def, Math.floor(b.def * (1 + mods.defPct)), h.id);
  }
  // a Rare with «HP +10 %» at C1
  const rareHp = HEROES.find((h) => h.rarity === 'rare' && h.constellations[0].patches.some((x) => x.mod && x.mod.stat === 'hpPct'));
  assert.ok(rareHp);
  assert.equal(heroStatsAt(rareHp.id, 10, 1).hp, Math.floor(statsAt(rareHp, 10).hp * 1.1));
  assert.equal(heroStatsAt(rareHp.id, 10, 0).hp, statsAt(rareHp, 10).hp);
  assert.equal(heroStatsAt('nobody', 1), null);
});

test('«Мощь» = (HP/10 + ATK + DEF) × (1 + 0.05·C)', () => {
  const s = statsAt(HERO_BY_ID.akane, 12);
  assert.equal(powerAt('akane', 12, 0), Math.round(s.hp / 10 + s.atk + s.def));
  assert.equal(powerAt('akane', 12, 4), Math.round((s.hp / 10 + s.atk + s.def) * 1.2));
  const p = createProfile({ seed: 3, now: NOW });
  assert.equal(heroPower(p, 'akane'), powerAt('akane', 1, 0));
  assert.equal(heroPower(p, 'liora'), powerAt('liora', 1, 0), 'unowned: level-1 preview');
  assert.equal(squadPower(p), p.squad.reduce((a, id) => a + heroPower(p, id), 0));
  // at equal level a Mythic is ≈ 29 % stronger than a Rare of the same class at L30 (GDD §4)
  const ratio = powerAt('liora', 30) / powerAt('shio', 30);
  assert.ok(ratio > 1.15 && ratio < 1.45, `${ratio}`);
});

test('XP scrolls: 1 000 XP each, never wasted beyond the cap', () => {
  let p = createProfile({ seed: 4, now: NOW });
  assert.equal(p.xpScrolls, 5);
  assert.equal(scrollsUseful(p, 'akane'), Math.ceil((4980 + 1400) / 1000));
  let r = useXpScrolls(p, 'akane', 2, { now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.used, 2);
  assert.equal(r.profile.xpScrolls, 3);
  assert.equal(r.profile.heroes.akane.level, 7); // 2 000 XP: total to L7 = 1 916
  assert.equal(r.profile.heroes.akane.xp, 2000 - totalXpFor(7));
  assert.equal(useXpScrolls(p, 'liora', 1).error, 'hero');
  assert.equal(useXpScrolls(sanitizeProfile({ ...p, xpScrolls: 0 }), 'akane', 1).error, 'scrolls');
  p = sanitizeProfile({ ...p, xpScrolls: 50 });
  r = useXpScrolls(p, 'vera', 50, { now: NOW });
  assert.equal(r.used, 7);
  assert.equal(r.profile.heroes.vera.level, 10);
  assert.equal(r.profile.heroes.vera.xp, xpToNext(10));
  assert.equal(useXpScrolls(r.profile, 'vera', 1).error, 'cap');
  assert.equal(r.profile.stats.xpScrollsUsed, 7);
});

test('collection view-models, filters, summary, «Новая!» badge', () => {
  const p = createProfile({ seed: 5, now: NOW });
  const all = collectionView(p);
  assert.equal(all.length, 24);
  assert.ok(all.slice(0, 6).every((v) => v.owned), 'owned first');
  assert.equal(all[0].id, 'akane', 'highest rarity owned first');
  assert.equal(collectionView(p, { filter: { owned: false } }).length, 18);
  assert.equal(collectionView(p, { filter: { rarity: 'mythic' } }).map((v) => v.id).join(), 'liora,nocturna');
  assert.equal(collectionView(p, { filter: { role: 'guardian' } }).length, 4);
  assert.equal(collectionView(p, { filter: { element: 'flame' } }).length, 3);
  const v = heroView(p, 'akane');
  assert.equal(v.power, powerAt('akane', 1, 0));
  assert.equal(v.inSquad, true);
  assert.equal(v.nextStats.hp > v.stats.hp, true);
  assert.equal(heroView(p, 'liora').owned, false);
  assert.deepEqual(collectionSummary(p).byRarity.rare, { owned: 5, total: 10 });
  const q = sanitizeProfile({ ...p, heroes: { ...p.heroes, reika: { level: 1, xp: 0, constellation: 0, copies: 1, seen: false } } });
  assert.equal(heroView(q, 'reika').isNew, true);
  assert.equal(heroView(markHeroSeen(q, 'reika'), 'reika').isNew, false);
  assert.ok(MAX_LEVEL === 30);
});
