// Economy simulation helpers (used by economy.test.js). A simulated player goes through the
// campaign with the REAL meta API (applyBattleResult, summon, setSquad, useXpScrolls…); only the
// battle outcome is modelled: P(win) from the squad's «Мощь» against the stage's enemy lineup.
//
// Battle model (a proxy for a human against the stage AI):
//   ratio  = squadPower × SKILL / (enemyPower × AI_FACTOR[ai])   (bosses / mini-bosses: HP × (1 + (hpMult − 1) / 2)
//            in the HP/10 term — boss mechanics are designed to be beaten, HP alone overstates them)
//   P(win) = 1 / (1 + e^(−8 (ratio − 1)))
//   stars  on a win: ★★★ with 0.15 + 0.7·q, else ★★ 60 % / ★ 40 %, q = clamp((ratio − 0.9) / 0.6, 0, 1)
// Player policy per battle: next stage if P(win) ≥ 0.45; else a cleared stage without ★★★ if
// P(win) ≥ 0.85; else replay the highest cleared stage for XP. 10-pulls whenever affordable,
// squad = top-6 power, XP scrolls on the lowest-level squad hero. After the campaign: ★★★ cleanup.

import { HERO_BY_ID } from '../../../src/rpg/data/heroes.js';
import { statsAt } from '../../../src/rpg/data/rules.js';
import {
  createProfile, applyBattleResult, summon, canSummon, setSquad, useXpScrolls, scrollsUseful, heroPower,
  STAGES, CHAPTERS, enemySquad, nextStage, stageRecord, createRng,
} from '../../../src/rpg/meta/index.js';

export const SKILL = 1.15;
export const AI_FACTOR = { easy: 0.8, normal: 1.0, hard: 1.15 };
export const BATTLES_PER_DAY = 10;
export const BOSS_HP_WEIGHT = 0.5;
const DAY = 24 * 3600 * 1000;

function unitPower(u) {
  const s = statsAt(HERO_BY_ID[u.heroId], u.level);
  const hpMult = 1 + ((u.hpMult || 1) - 1) * BOSS_HP_WEIGHT;
  return ((s.hp * hpMult) / 10 + s.atk + s.def) * (1 + 0.05 * (u.constellation || 0));
}

export function enemyEffPower(stage, profile) {
  return enemySquad(stage, profile).reduce((a, u) => a + unitPower(u), 0) * (AI_FACTOR[stage.ai] || 1);
}

export function winChance(profile, stage) {
  const mine = profile.squad.reduce((a, id) => a + heroPower(profile, id), 0) * SKILL;
  const ratio = mine / enemyEffPower(stage, profile);
  return { p: 1 / (1 + Math.exp(-8 * (ratio - 1))), ratio };
}

function bestSquad(p) {
  return Object.keys(p.heroes)
    .sort((a, b) => heroPower(p, b) - heroPower(p, a))
    .slice(0, 6);
}

const SOURCES = ['start', 'firstClear', 'threeStar', 'achievement', 'dailyFirst', 'task', 'repeat'];

/**
 * Simulate one player. -> { chapters: [{ chapter, day, battles, pulls, crystals: {...}, avgLevel,
 * owned }], final: {...} , days, battles }
 */
export function simulatePlayer(seed, { maxDays = 120, start = new Date(2026, 9, 12, 18, 0, 0).getTime() } = {}) {
  const rng = createRng(seed);
  let p = createProfile({ seed, now: start });
  const earned = Object.fromEntries(SOURCES.map((s) => [s, 0]));
  earned.start = p.crystals;
  let pulls = 0;
  let battles = 0;
  const chapters = [];
  let day = 0;
  let slot = 0;

  const book = (items) => {
    for (const it of items || []) if (it.crystals && it.kind in earned) earned[it.kind] += it.crystals;
  };
  const shop = (now) => {
    while (canSummon(p, 10)) {
      const r = summon(p, 10, { now });
      p = r.profile;
      pulls += 10;
      book(r.achievements);
    }
    p = setSquad(p, bestSquad(p));
    for (let guard = 0; guard < 50 && p.xpScrolls > 0; guard++) {
      const id = p.squad.filter((h) => scrollsUseful(p, h) > 0).sort((a, b) => p.heroes[a].level - p.heroes[b].level)[0];
      if (!id) break;
      const r = useXpScrolls(p, id, 1, { now });
      if (!r.ok) break;
      p = r.profile;
      book(r.achievements);
    }
  };

  const fight = (stage, now) => {
    const { p: pw, ratio } = winChance(p, stage);
    const won = rng() < pw;
    let lost = 0;
    let rounds = stage.threeStarRounds - 2;
    if (won) {
      const q = Math.min(1, Math.max(0, (ratio - 0.9) / 0.6));
      const u = rng();
      if (u < 0.15 + 0.7 * q) lost = 0;
      else if (rng() < 0.6) lost = 1;
      else lost = 2 + Math.floor(rng() * 2);
    } else {
      lost = 6;
      rounds = stage.roundLimit;
    }
    const chain = rng();
    const stats = {
      lost,
      reactions: 2 + Math.floor(rng() * 5),
      ults: 1 + Math.floor(rng() * 4),
      awakenings: rng() < 0.4 ? 1 : 0,
      maxChain: chain < 0.04 ? 4 : chain < 0.3 ? 3 : chain < 0.6 ? 2 : 1,
      kos: won ? enemySquad(stage, p).length : Math.floor(rng() * 4),
      alive: won ? Math.max(1, p.squad.length - lost) : 0,
    };
    const r = applyBattleResult(p, { stageId: stage.id, mode: 'campaign', result: { winner: won ? 1 : -1, rounds }, squad: p.squad, stats, now });
    p = r.profile;
    battles++;
    book(r.rewards.items);
    return r;
  };

  const chooseStage = () => {
    const next = nextStage(p);
    if (next && winChance(p, next).p >= 0.45) return next;
    const stars = STAGES.filter((s) => stageRecord(p, s.id).cleared && stageRecord(p, s.id).stars < 3 && winChance(p, s).p >= 0.85);
    if (stars.length) return stars[0];
    const cleared = STAGES.filter((s) => stageRecord(p, s.id).cleared);
    if (cleared.length) return cleared[cleared.length - 1];
    return next;
  };

  let campaignDone = false;
  while (day < maxDays) {
    const now = start + day * DAY + slot * 6 * 60 * 1000;
    shop(now);
    let stage;
    if (!campaignDone) stage = chooseStage();
    else {
      stage = STAGES.find((s) => stageRecord(p, s.id).stars < 3);
      if (!stage) break;
    }
    const r = fight(stage, now);
    if (r.rewards.firstClear && stage.boss) {
      chapters.push({
        chapter: stage.chapter,
        day: day + 1,
        battles,
        pulls,
        crystals: { ...earned },
        avgLevel: p.squad.reduce((a, id) => a + p.heroes[id].level, 0) / p.squad.length,
        owned: Object.keys(p.heroes).length,
      });
      if (stage.chapter === CHAPTERS.length) campaignDone = true;
    }
    slot++;
    if (slot >= BATTLES_PER_DAY) {
      slot = 0;
      day++;
    }
  }
  shop(start + day * DAY);
  return {
    chapters,
    final: { day: day + 1, battles, pulls, crystals: { ...earned }, owned: Object.keys(p.heroes).length, threeStars: STAGES.filter((s) => stageRecord(p, s.id).stars >= 3).length },
    profile: p,
  };
}

/** Collection after `pulls` summons from a fresh profile (novice ×10 first). */
export function collectionAfter(seed, pulls) {
  let p = createProfile({ seed, now: 0 });
  let done = 0;
  while (done < pulls) {
    const n = pulls - done >= 10 ? 10 : 1;
    p = { ...p, crystals: 1e9 };
    p = summon(p, n, { now: 0 }).profile;
    done += n;
  }
  const by = (r) => Object.keys(p.heroes).filter((id) => HERO_BY_ID[id].rarity === r);
  const rares = by('rare');
  return {
    legendaryPlus: by('legendary').length + by('mythic').length,
    legendaryPlusCopies: Object.entries(p.heroes).filter(([id]) => ['legendary', 'mythic'].includes(HERO_BY_ID[id].rarity)).reduce((a, [, e]) => a + e.copies, 0),
    mythic: by('mythic').length,
    epics: by('epic').length,
    rares: rares.length,
    rareAvgC: rares.reduce((a, id) => a + p.heroes[id].constellation, 0) / Math.max(1, rares.length),
    owned: Object.keys(p.heroes).length,
  };
}
