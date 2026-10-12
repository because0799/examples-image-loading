// «Валькирии доски» — UI view-model helpers. Pure functions over the data files (src/rpg/data) and
// the meta Profile shape (docs/RPG-ARCHITECTURE.md); no DOM, no side effects, Node-testable.
//
// The UI never needs the meta module to render: everything it shows (stats, power, unlocks, pity,
// campaign map) is derived here from rules.js / heroes.js. When the integration injects the meta
// module (`new RpgUI(root, { meta })`) its functions win where they exist (heroPower, isUnlocked,
// canSummon, pityStatus, SUMMON_COST), so the numbers always match the game logic.

import {
  ELEMENTS,
  ELEMENT_ORDER,
  ROLES,
  ROLE_ORDER,
  RARITIES,
  RARITY_ORDER,
  REACTIONS,
  STATUSES,
  GACHA,
  PROGRESSION,
  ECONOMY,
  CAMPAIGN,
  BATTLE,
  statsAt,
  xpToNext,
} from '../data/rules.js';
import { HEROES, HERO_BY_ID } from '../data/heroes.js';
import { VOICE_LINES, VOICE_EVENTS } from '../data/voice-lines.js';

export { ELEMENTS, ELEMENT_ORDER, ROLES, ROLE_ORDER, RARITIES, RARITY_ORDER, REACTIONS, STATUSES, HEROES, HERO_BY_ID };

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const num = (v, def = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
const int = (v, def = 0) => Math.floor(num(v, def));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const SQUAD_SIZE = 6;
export const MAX_CONSTELLATION = 6;
export const RARITY_RANK = Object.freeze({ rare: 0, epic: 1, legendary: 2, mythic: 3 });

/** Kanji used for decorative glyphs. */
export const KANJI = Object.freeze({
  victory: '勝利',
  defeat: '敗北',
  draw: '引分',
  summon: '召喚',
  awaken: '覚醒',
  ko: '撃破',
  rare: '煌',
  epic: '煌',
  legendary: '伝説',
  mythic: '神話',
  campaign: '戦記',
  collection: '図鑑',
  squad: '編成',
  training: '修練',
  duel: '決闘',
  hub: '本陣',
});

// ------------------------------------------------------------------------------------ heroes

export function getHero(id) {
  return HERO_BY_ID[id] || null;
}

export function rarityOf(id) {
  const h = getHero(id);
  return h ? h.rarity : 'rare';
}

export function isVoiced(id) {
  const h = getHero(id);
  return !!(h && h.voice && VOICE_LINES[id] && RARITIES[h.rarity] && RARITIES[h.rarity].voiced);
}

/** Voice lines of a hero in VOICE_EVENTS order: [{ event, jp, ru, en }] ([] for Rare heroes). */
export function voiceLines(id) {
  const v = VOICE_LINES[id];
  if (!v || !isVoiced(id)) return [];
  return VOICE_EVENTS.filter((e) => v.lines[e]).map((e) => ({ event: e, ...v.lines[e] }));
}

/** The profile entry of an owned hero, or null. */
export function heroEntry(profile, id) {
  const e = profile && isObj(profile.heroes) ? profile.heroes[id] : null;
  return isObj(e) ? e : null;
}

export function isOwned(profile, id) {
  return !!heroEntry(profile, id);
}

export function ownedIds(profile) {
  if (!profile || !isObj(profile.heroes)) return [];
  return HEROES.map((h) => h.id).filter((id) => isObj(profile.heroes[id]));
}

export function heroLevel(profile, id) {
  const e = heroEntry(profile, id);
  return e ? clamp(int(e.level, 1) || 1, 1, PROGRESSION.maxLevel) : 1;
}

export function heroConstellation(profile, id) {
  const e = heroEntry(profile, id);
  return e ? clamp(int(e.constellation, 0), 0, MAX_CONSTELLATION) : 0;
}

/** Constellations unlocked at C`c` (patches of C1..Cc). */
function litConstellations(hero, c) {
  return (hero.constellations || []).filter((x) => x.c <= c);
}

/** Final stats at a level with the stat mods of the lit constellations (C1…Cc). */
export function heroStats(heroOrId, level = 1, constellation = 0) {
  const hero = typeof heroOrId === 'string' ? getHero(heroOrId) : heroOrId;
  if (!hero) return { hp: 0, atk: 0, def: 0, crit: 0, aff: 0 };
  const s = statsAt(hero, level);
  const pct = { hpPct: 0, atkPct: 0, defPct: 0 };
  let crit = 0;
  for (const c of litConstellations(hero, constellation)) {
    for (const p of c.patches || []) {
      const m = p.mod;
      if (!m || typeof m.value !== 'number') continue;
      if (m.stat in pct) pct[m.stat] += m.value;
      else if (m.stat === 'critChance') crit += m.value;
    }
  }
  return {
    hp: Math.floor(s.hp * (1 + pct.hpPct)),
    atk: Math.floor(s.atk * (1 + pct.atkPct)),
    def: Math.floor(s.def * (1 + pct.defPct)),
    crit: s.crit + crit,
    aff: s.aff,
  };
}

/** GDD §17.5: power = (HP/10 + ATK + DEF) × (1 + 0.05 × C). */
export function powerOf(heroOrId, level = 1, constellation = 0) {
  const s = heroStats(heroOrId, level, constellation);
  return Math.round((s.hp / 10 + s.atk + s.def) * (1 + 0.05 * constellation));
}

/** Power of an owned hero (meta.heroPower when injected). */
export function heroPower(profile, id, meta = null) {
  if (meta && typeof meta.heroPower === 'function') {
    try {
      const v = meta.heroPower(profile, id);
      if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
    } catch (e) {
      /* fall back to the local formula */
    }
  }
  return powerOf(id, heroLevel(profile, id), heroConstellation(profile, id));
}

export function squadPower(profile, ids, meta = null) {
  return (ids || []).filter(Boolean).reduce((sum, id) => sum + heroPower(profile, id, meta), 0);
}

/** Applies the display-relevant constellation patches (cooldown, cost, multipliers). */
export function abilityNumbers(heroOrId, constellation = 0) {
  const hero = typeof heroOrId === 'string' ? getHero(heroOrId) : heroOrId;
  const out = { skillCooldown: 0, ultCost: 0, skillMult: 1, ultMult: 1 };
  if (!hero) return out;
  out.skillCooldown = num(hero.skill && hero.skill.cooldown, 0);
  out.ultCost = num(hero.ultimate && hero.ultimate.cost, 0);
  for (const c of litConstellations(hero, constellation)) {
    for (const p of c.patches || []) {
      if (p.path === 'skill.mult' && typeof p.mul === 'number') out.skillMult *= p.mul;
      else if (p.path === 'ultimate.mult' && typeof p.mul === 'number') out.ultMult *= p.mul;
      else if (p.path === 'skill.cooldown') out.skillCooldown = patchNum(out.skillCooldown, p);
      else if (p.path === 'ultimate.cost') out.ultCost = patchNum(out.ultCost, p);
    }
  }
  return out;
}

function patchNum(v, p) {
  if (typeof p.set === 'number') return p.set;
  if (typeof p.add === 'number') return v + p.add;
  if (typeof p.mul === 'number') return Math.round(v * p.mul);
  return v;
}

// ------------------------------------------------------------------------------- progression

/** Current level cap (10 / 20 / 30) from the campaign progress (rules.js PROGRESSION.levelCaps). */
export function levelCap(profile) {
  let cap = PROGRESSION.levelCaps[0].cap;
  for (const lc of PROGRESSION.levelCaps) {
    if (lc.unlock === 'start') cap = Math.max(cap, lc.cap);
    else if (lc.unlock.startsWith('clear:')) {
      const id = lc.unlock.slice(6).replace(/-boss$/i, '-B');
      if (stageProgress(profile, id).cleared) cap = Math.max(cap, lc.cap);
    }
  }
  return cap;
}

/**
 * XP bar of a hero: { level, xp, need, pct, max }. `xp` in the profile is the progress inside the
 * current level; a value ≥ the requirement (an older "total XP" save) is converted.
 */
export function xpProgress(level, xp) {
  let L = clamp(int(level, 1) || 1, 1, PROGRESSION.maxLevel);
  let x = Math.max(0, int(xp, 0));
  if (L >= PROGRESSION.maxLevel) return { level: L, xp: 0, need: 0, pct: 1, max: true };
  let need = xpToNext(L);
  if (x >= need) {
    // total XP from level 1 -> walk the curve
    let total = x;
    L = 1;
    while (L < PROGRESSION.maxLevel && total >= xpToNext(L)) {
      total -= xpToNext(L);
      L++;
    }
    x = total;
    need = L >= PROGRESSION.maxLevel ? 0 : xpToNext(L);
    if (!need) return { level: L, xp: 0, need: 0, pct: 1, max: true };
  }
  return { level: L, xp: x, need, pct: clamp(x / need, 0, 1), max: false };
}

/**
 * Reconstructs the XP bar before a battle from the bar after it and the XP gained, so the results
 * screen can animate it: { from: {level, xp, need, pct}, to: {...}, levelUps }.
 */
export function xpGainPath(levelAfter, xpAfter, gained) {
  const to = xpProgress(levelAfter, xpAfter);
  let L = to.level;
  let x = to.max ? 0 : to.xp;
  let g = Math.max(0, int(gained, 0));
  if (to.max) {
    // capped at 30: the bar was filling toward 30
    x = 0;
  }
  while (g > 0) {
    if (g <= x) {
      x -= g;
      g = 0;
    } else {
      g -= x;
      if (L <= 1) {
        x = 0;
        break;
      }
      L--;
      x = xpToNext(L);
    }
  }
  const from = xpProgress(L, x);
  return { from, to, levelUps: Math.max(0, to.level - from.level) };
}

// ------------------------------------------------------------------------------------ squads

export function profileSquad(profile) {
  const ids = profile && Array.isArray(profile.squad) ? profile.squad : [];
  const out = [];
  for (const id of ids) if (getHero(id) && !out.includes(id) && out.length < SQUAD_SIZE) out.push(id);
  return out;
}

/** Squad entries for createBattle: [{ heroId, level, constellation }]. */
export function squadEntries(profile, ids, { level = null, constellation = null } = {}) {
  return (ids || [])
    .filter((id) => getHero(id))
    .map((id) => ({
      heroId: id,
      level: level != null ? level : heroLevel(profile, id),
      constellation: constellation != null ? constellation : heroConstellation(profile, id),
    }));
}

/** The strongest owned heroes (ties: rarity, then roster order). */
export function autoSquad(profile, meta = null) {
  const owned = ownedIds(profile);
  const scored = owned.map((id, i) => ({ id, p: heroPower(profile, id, meta), r: RARITY_RANK[rarityOf(id)], i }));
  scored.sort((a, b) => b.p - a.p || b.r - a.r || a.i - b.i);
  // keep at least one Oracle (healer) if the player owns one and the top 6 have none
  const top = scored.slice(0, SQUAD_SIZE).map((x) => x.id);
  const hasRole = (ids, role) => ids.some((id) => getHero(id).role === role);
  if (top.length === SQUAD_SIZE && !hasRole(top, 'oracle')) {
    const healer = scored.find((x) => getHero(x.id).role === 'oracle');
    if (healer) top[SQUAD_SIZE - 1] = healer.id;
  }
  return top;
}

/** Reactions the squad can trigger by itself: [reactionId] in REACTIONS order. */
export function squadReactions(ids) {
  const els = new Set((ids || []).map((id) => getHero(id)).filter(Boolean).map((h) => h.element));
  const sealing = ELEMENT_ORDER.filter((e) => els.has(e) && ELEMENTS[e].leavesSeal && ELEMENTS[e].slot === 'natural');
  const out = [];
  for (const r of Object.values(REACTIONS)) {
    if (r.pairs) {
      if (r.pairs.some(([a, b]) => els.has(a) && els.has(b))) out.push(r.id);
    } else if (r.trigger.some((e) => els.has(e)) && r.consumes.some((e) => sealing.includes(e))) out.push(r.id);
  }
  return out;
}

/** Hints for the squad builder: { reactions, missingRoles, elements, roles, noHealer, empty }. */
export function squadSynergy(ids) {
  const heroes = (ids || []).map((id) => getHero(id)).filter(Boolean);
  const roles = {};
  const elements = {};
  for (const h of heroes) {
    roles[h.role] = (roles[h.role] || 0) + 1;
    elements[h.element] = (elements[h.element] || 0) + 1;
  }
  return {
    reactions: squadReactions(ids),
    missingRoles: ROLE_ORDER.filter((r) => !roles[r]),
    roles,
    elements,
    noHealer: heroes.length > 0 && !roles.oracle,
    noGuardian: heroes.length > 0 && !roles.guardian,
    empty: SQUAD_SIZE - heroes.length,
  };
}

// --------------------------------------------------------------------------------- campaign

export const STAGE_LIST = CAMPAIGN.flatMap((ch) => ch.stages.map((s, i) => ({ ...s, chapter: ch.chapter, index: i })));

export function stageById(id) {
  return STAGE_LIST.find((s) => s.id === id) || null;
}

export function chapterOf(stageOrId) {
  const s = typeof stageOrId === 'string' ? stageById(stageOrId) : stageOrId;
  return s ? CAMPAIGN.find((c) => c.chapter === s.chapter) || null : null;
}

export function stageProgress(profile, id) {
  const p = profile && isObj(profile.campaign) ? profile.campaign[id] : null;
  if (!isObj(p)) return { stars: 0, cleared: false };
  const stars = clamp(int(p.stars, 0), 0, 3);
  return { stars, cleared: !!p.cleared || stars > 0 };
}

/** A stage is open when it is the very first one or the previous stage (campaign order) is cleared. */
export function isStageUnlocked(profile, id, meta = null) {
  if (meta && typeof meta.isUnlocked === 'function') {
    try {
      return !!meta.isUnlocked(profile, id);
    } catch (e) {
      /* local rule below */
    }
  }
  const i = STAGE_LIST.findIndex((s) => s.id === id);
  if (i < 0) return false;
  if (i === 0) return true;
  return stageProgress(profile, STAGE_LIST[i - 1].id).cleared;
}

export function roundLimitOf(stage) {
  const ch = chapterOf(stage);
  return (stage && stage.roundLimit) || (ch && ch.roundLimit) || BATTLE.roundLimit;
}

export function threeStarRoundsOf(stage) {
  const ch = chapterOf(stage);
  return (stage && stage.threeStarRounds) || (ch && ch.threeStarRounds) || 14;
}

/** Enemy hero ids of a stage (boss first). 'mirror' -> the player's squad. */
export function stageEnemyIds(stage, profile = null) {
  if (!stage) return [];
  if (stage.enemies === 'mirror' || (stage.rule && stage.rule.id === 'mirror')) return profileSquad(profile);
  if (stage.boss) return [stage.bossHero, ...(stage.escorts || []).map((e) => e[0])];
  return Array.isArray(stage.enemies) ? stage.enemies.slice() : [];
}

/** Recommended squad power: the enemies' average power at the stage level, for 6 heroes. */
export function recommendedPower(stage) {
  if (!stage) return 0;
  const ids = stageEnemyIds(stage).filter((id) => getHero(id));
  if (!ids.length) return 0;
  const avg = ids.reduce((s, id) => s + powerOf(id, stage.level, 0), 0) / ids.length;
  return Math.round(avg * SQUAD_SIZE);
}

/** First-clear and chest rewards of a stage. */
export function stageRewards(stage) {
  if (!stage) return { crystals: 0, scrolls: 0, chest: 0 };
  const scrolls = stage.boss ? 3 : ECONOMY.firstClear.xpScrollsCh[(stage.chapter || 1) - 1] || 1;
  return {
    crystals: stage.boss ? ECONOMY.firstClear.boss : ECONOMY.firstClear.stage,
    scrolls,
    chest: ECONOMY.threeStarChest,
  };
}

/** Map view of a chapter: [{ stage, unlocked, stars, cleared, current }]. */
export function chapterNodes(profile, chapter, meta = null) {
  const ch = CAMPAIGN.find((c) => c.chapter === chapter);
  if (!ch) return [];
  const nodes = ch.stages.map((s) => {
    const stage = stageById(s.id);
    const pr = stageProgress(profile, s.id);
    return { stage, unlocked: isStageUnlocked(profile, s.id, meta), stars: pr.stars, cleared: pr.cleared, current: false };
  });
  const cur = nodes.find((n) => n.unlocked && !n.cleared);
  if (cur) cur.current = true;
  return nodes;
}

export function chapterSummary(profile, chapter, meta = null) {
  const nodes = chapterNodes(profile, chapter, meta);
  return {
    chapter,
    unlocked: nodes.length > 0 && nodes[0].unlocked,
    cleared: nodes.filter((n) => n.cleared).length,
    total: nodes.length,
    stars: nodes.reduce((s, n) => s + n.stars, 0),
    maxStars: nodes.length * 3,
    complete: nodes.length > 0 && nodes.every((n) => n.cleared),
  };
}

/** The chapter the player is working on (first with an uncleared, unlocked stage). */
export function currentChapter(profile, meta = null) {
  for (const ch of CAMPAIGN) {
    const s = chapterSummary(profile, ch.chapter, meta);
    if (s.unlocked && !s.complete) return ch.chapter;
  }
  const open = CAMPAIGN.filter((ch) => chapterSummary(profile, ch.chapter, meta).unlocked);
  return open.length ? open[open.length - 1].chapter : 1;
}

/** The next stage to play (or null when the campaign is complete). */
export function nextStage(profile, meta = null) {
  return STAGE_LIST.find((s) => isStageUnlocked(profile, s.id, meta) && !stageProgress(profile, s.id).cleared) || null;
}

export function campaignStars(profile) {
  return STAGE_LIST.reduce((sum, s) => sum + stageProgress(profile, s.id).stars, 0);
}

/** 1-B -> «1-Б» style label is done in i18n; here: 'B' stages are bosses. */
export function stageNumber(stage) {
  return stage ? stage.id : '';
}

// ------------------------------------------------------------------------------------ gacha

export function summonCost(count, meta = null) {
  if (meta && meta.SUMMON_COST != null) {
    const c = meta.SUMMON_COST;
    if (typeof c === 'number') return c * count;
    if (isObj(c)) {
      if (count >= 10 && typeof c.multi === 'number') return c.multi;
      if (typeof c.single === 'number') return c.single * count;
      if (typeof c[count] === 'number') return c[count];
    }
  }
  return count >= GACHA.cost.multiCount ? GACHA.cost.multi : GACHA.cost.single * count;
}

export function crystalsOf(profile) {
  return Math.max(0, int(profile && profile.crystals, 0));
}

/** Novice banner: pulls left of the first 20 (only ×10, Legendary+ guaranteed). */
export function novicePullsLeft(profile) {
  const p = profile && isObj(profile.pity) ? profile.pity : {};
  const total = GACHA.noviceBanner.pulls;
  for (const k of ['noviceLeft', 'novicePullsLeft']) if (typeof p[k] === 'number') return clamp(int(p[k]), 0, total);
  for (const k of ['novice', 'novicePulls', 'noviceDone']) if (typeof p[k] === 'number') return clamp(total - int(p[k]), 0, total);
  if (p.noviceDone === true || p.novice === false) return 0;
  for (const k of ['total', 'pulls', 'totalPulls']) if (typeof p[k] === 'number') return clamp(total - int(p[k]), 0, total);
  return 0;
}

export function canSummonCount(profile, count, meta = null) {
  if (meta && typeof meta.canSummon === 'function') {
    try {
      return !!meta.canSummon(profile, count);
    } catch (e) {
      /* local rule below */
    }
  }
  if (count < GACHA.cost.multiCount && novicePullsLeft(profile) > 0 && GACHA.noviceBanner.onlyMulti) return false;
  return crystalsOf(profile) >= summonCost(count, meta);
}

function firstNum(obj, keys) {
  for (const k of keys) if (obj && typeof obj[k] === 'number' && Number.isFinite(obj[k])) return obj[k];
  return null;
}

/**
 * Pity counters for the summon screen: { toEpicPlus, toLegendaryPlus, legendaryStreak, novicePullsLeft }.
 * Uses meta.pityStatus(profile) when injected; otherwise reads profile.pity tolerantly
 * (since-counters under several plausible names).
 */
export function pityInfo(profile, meta = null) {
  if (meta && typeof meta.pityStatus === 'function') {
    try {
      const s = meta.pityStatus(profile);
      if (isObj(s)) {
        return {
          toEpicPlus: clamp(int(s.toEpicPlus, GACHA.pity.epicPlusEvery), 1, GACHA.pity.epicPlusEvery),
          toLegendaryPlus: clamp(int(s.toLegendaryPlus, GACHA.pity.legendaryPlusHard), 1, GACHA.pity.legendaryPlusHard),
          legendaryStreak: Math.max(0, int(s.legendaryStreak, 0)),
          novicePullsLeft: Math.max(0, int(s.novicePullsLeft, novicePullsLeft(profile))),
        };
      }
    } catch (e) {
      /* fall through */
    }
  }
  const p = profile && isObj(profile.pity) ? profile.pity : {};
  const sinceEpic = firstNum(p, ['sinceEpicPlus', 'sinceEpic', 'epicPlus', 'epic', 'noEpic']);
  const sinceLeg = firstNum(p, ['sinceLegendaryPlus', 'sinceLegendary', 'legendaryPlus', 'legendary', 'noLegendary']);
  const streak = firstNum(p, ['legendaryStreak', 'nonMythicStreak', 'sinceMythicLegendaries', 'mythicMiss']);
  return {
    toEpicPlus: clamp(GACHA.pity.epicPlusEvery - Math.max(0, int(sinceEpic, 0)), 1, GACHA.pity.epicPlusEvery),
    toLegendaryPlus: clamp(GACHA.pity.legendaryPlusHard - Math.max(0, int(sinceLeg, 0)), 1, GACHA.pity.legendaryPlusHard),
    legendaryStreak: Math.max(0, int(streak, 0)),
    novicePullsLeft: novicePullsLeft(profile),
  };
}

/** Best rarity of a summon batch. */
export function bestRarity(results) {
  let best = 'rare';
  for (const r of results || []) {
    const rar = (r && r.rarity) || rarityOf(r && r.heroId);
    if (RARITY_RANK[rar] > RARITY_RANK[best]) best = rar;
  }
  return best;
}

/**
 * Reveal order of a batch (GDD §12: the best card last). Stable: equal rarities keep pull order.
 * Returns [{ ...result, rarity, index }].
 */
export function revealOrder(results) {
  const list = (results || [])
    .filter((r) => r && getHero(r.heroId))
    .map((r, index) => ({ ...r, rarity: r.rarity || rarityOf(r.heroId), index }));
  const bestRank = Math.max(-1, ...list.map((r) => RARITY_RANK[r.rarity]));
  if (bestRank <= RARITY_RANK.rare) return list;
  // move every top-rarity card to the end, keep the rest in pull order
  const top = list.filter((r) => RARITY_RANK[r.rarity] === bestRank);
  const rest = list.filter((r) => RARITY_RANK[r.rarity] !== bestRank);
  return [...rest, ...top];
}

/** Dust refund of a duplicate result (number | { dust } | { stardust }) -> number. */
export function refundDust(result) {
  const r = result && result.refund;
  if (typeof r === 'number') return Math.max(0, Math.round(r));
  if (isObj(r)) return Math.max(0, Math.round(num(r.dust, num(r.stardust, num(r.amount, 0)))));
  return 0;
}

// ------------------------------------------------------------------------------------ battle

/** Sum of current / max HP of a side's heroes (wards excluded); KO'd count as 0. */
export function hpShare(state, side) {
  const units = state && Array.isArray(state.units) ? state.units : state && isObj(state.units) ? Object.values(state.units) : [];
  let cur = 0;
  let max = 0;
  for (const u of units) {
    if (!u || u.side !== side || u.ward || u.isWard || u.kind === 'ward') continue;
    max += Math.max(0, num(u.maxHp, 0));
    if (u.alive !== false) cur += Math.max(0, num(u.hp, 0));
  }
  return { cur, max, pct: max > 0 ? clamp(cur / max, 0, 1) : 0 };
}

export function unitsOf(state) {
  if (!state) return [];
  if (Array.isArray(state.units)) return state.units.filter(Boolean);
  if (isObj(state.units)) return Object.values(state.units).filter(Boolean);
  return [];
}

export function unitById(state, id) {
  return unitsOf(state).find((u) => u.id === id) || null;
}

export function isWard(u) {
  return !!(u && (u.ward || u.isWard || u.kind === 'ward' || !getHero(u.heroId)));
}

/** Heroes (not wards) of a side in roster order (by id / deployment order). */
export function sideHeroes(state, side) {
  return unitsOf(state).filter((u) => u.side === side && !isWard(u));
}

export function statusList(unit) {
  const list = unit && Array.isArray(unit.statuses) ? unit.statuses : [];
  return list
    .filter((s) => s && STATUSES[s.id] && s.id !== 'crown')
    .map((s) => ({ ...STATUSES[s.id], turns: s.turns, stacks: s.stacks }));
}

export function ultReady(unit) {
  if (!unit) return false;
  const max = num(unit.maxEnergy, 0);
  return max > 0 && num(unit.energy, 0) >= max;
}

/** A square index (row * 8 + col) in board notation (a1 = bottom-left as seen by the player). */
export function sqName(sq) {
  if (typeof sq !== 'number' || sq < 0 || sq > 63) return '';
  const row = Math.floor(sq / 8);
  const col = sq % 8;
  return 'abcdefgh'[col] + String(8 - row);
}

export function roundLimitFrom(state, opts = {}) {
  return int(
    (state && (state.roundLimit || (state.stage && state.stage.roundLimit) || (state.rules && state.rules.roundLimit))) ||
      opts.roundLimit ||
      BATTLE.roundLimit,
    BATTLE.roundLimit,
  );
}

// ------------------------------------------------------------------------------ training/duel

/** Seeded generator (mulberry32) for UI-side picks (training squads). */
export function seeded(seed = 1) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Enemy squad for Training: kind 'random' (6 distinct heroes, ≤ 1 Legendary+), 'chapter' (the
 * line-up of a random stage of chapter `chapter`), 'mirror' (the player's squad).
 */
export function trainingEnemies({ kind = 'random', chapter = 1, level = 10, profile = null, seed = 1 } = {}) {
  const rnd = seeded(seed);
  let ids = [];
  if (kind === 'mirror') ids = profileSquad(profile);
  else if (kind === 'chapter') {
    const ch = CAMPAIGN.find((c) => c.chapter === chapter) || CAMPAIGN[0];
    const regular = ch.stages.filter((s) => Array.isArray(s.enemies) && s.enemies.length >= 5);
    const st = regular[Math.floor(rnd() * regular.length)] || ch.stages[0];
    ids = (Array.isArray(st.enemies) ? st.enemies : []).slice(0, SQUAD_SIZE);
  }
  if (!ids.length) {
    const pool = HEROES.map((h) => h.id);
    let premium = 0;
    while (ids.length < SQUAD_SIZE && pool.length) {
      const id = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
      const rank = RARITY_RANK[rarityOf(id)];
      if (rank >= RARITY_RANK.legendary) {
        if (premium >= 1) continue;
        premium++;
      }
      ids.push(id);
    }
  }
  return ids.map((heroId) => ({ heroId, level: clamp(int(level, 1), 1, PROGRESSION.maxLevel), constellation: 0 }));
}

/** Duel draft order 1-2-2-2-2-2-1 (GDD §16): picks[i] = side (1 | -1) of the i-th pick. */
export const DUEL_DRAFT = Object.freeze([1, -1, -1, 1, 1, -1, -1, 1, 1, -1, -1, 1]);

export function draftTurn(picks) {
  const n = (picks && picks.length) || 0;
  if (n >= DUEL_DRAFT.length) return null;
  const side = DUEL_DRAFT[n];
  let left = 0;
  for (let i = n; i < DUEL_DRAFT.length && DUEL_DRAFT[i] === side; i++) left++;
  return { side, left, index: n };
}

// ------------------------------------------------------------------------------- collection

export const SORTS = ['rarity', 'level', 'power', 'name'];

/**
 * Filters + sorts the roster for the collection grid.
 * f = { rarity: 'all'|id, element: 'all'|id, role: 'all'|id, owned: 'all'|'owned'|'missing', sort }
 */
export function collectionList(profile, f = {}, meta = null, lang = 'ru') {
  const filters = { rarity: 'all', element: 'all', role: 'all', owned: 'all', sort: 'rarity', ...f };
  const list = HEROES.filter((h) => {
    if (filters.rarity !== 'all' && h.rarity !== filters.rarity) return false;
    if (filters.element !== 'all' && h.element !== filters.element) return false;
    if (filters.role !== 'all' && h.role !== filters.role) return false;
    const own = isOwned(profile, h.id);
    if (filters.owned === 'owned' && !own) return false;
    if (filters.owned === 'missing' && own) return false;
    return true;
  }).map((h, i) => ({
    id: h.id,
    hero: h,
    owned: isOwned(profile, h.id),
    level: heroLevel(profile, h.id),
    constellation: heroConstellation(profile, h.id),
    power: isOwned(profile, h.id) ? heroPower(profile, h.id, meta) : 0,
    order: HEROES.indexOf(h),
    i,
  }));
  const byRarity = (a, b) => RARITY_RANK[b.hero.rarity] - RARITY_RANK[a.hero.rarity];
  const ownedFirst = (a, b) => (b.owned ? 1 : 0) - (a.owned ? 1 : 0);
  const cmp = {
    rarity: (a, b) => ownedFirst(a, b) || byRarity(a, b) || b.level - a.level || a.order - b.order,
    level: (a, b) => ownedFirst(a, b) || b.level - a.level || byRarity(a, b) || a.order - b.order,
    power: (a, b) => ownedFirst(a, b) || b.power - a.power || byRarity(a, b) || a.order - b.order,
    name: (a, b) => (a.hero.name[lang] || a.hero.name.ru).localeCompare(b.hero.name[lang] || b.hero.name.ru, lang),
  }[filters.sort] || ((a, b) => a.order - b.order);
  return list.sort(cmp);
}

export function collectionCount(profile) {
  return { owned: ownedIds(profile).length, total: HEROES.length };
}

// ---------------------------------------------------------------------------------- results

/**
 * Stars earned in a battle (GDD §14): 1 = win, 2 = win with ≤ 1 hero KO'd, 3 = no KO within the
 * stage's ★★★ round limit. Prefers `rewards.stars` / `result.stars` when the meta module sent them.
 */
export function battleStars({ result, rewards, stage, playerSide = 1 } = {}) {
  if (rewards && typeof rewards.stars === 'number') return clamp(int(rewards.stars), 0, 3);
  if (result && typeof result.stars === 'number') return clamp(int(result.stars), 0, 3);
  if (!result || result.winner !== playerSide) return 0;
  const st = result.stats || {};
  const kos = firstNum(st, ['kosTaken', 'losses', 'heroesLost', 'lost', 'kod']);
  const lost = kos != null ? kos : isObj(st.kos) ? num(st.kos[-playerSide] ?? st.kos[String(-playerSide)], 0) : null;
  if (lost == null) return 1;
  const rounds = num(result.rounds, 99);
  if (lost === 0 && rounds <= threeStarRoundsOf(stage)) return 3;
  return lost <= 1 ? 2 : 1;
}

/** Level-up list normalisation: strings | { heroId, from, to } | { id, level } -> [{ heroId, from, to }]. */
export function normalizeLevelUps(levelUps) {
  const out = [];
  for (const x of levelUps || []) {
    if (typeof x === 'string') out.push({ heroId: x, from: null, to: null });
    else if (isObj(x)) {
      const heroId = x.heroId || x.id || x.hero;
      if (!heroId) continue;
      out.push({ heroId, from: x.from ?? x.prev ?? null, to: x.to ?? x.level ?? null });
    }
  }
  return out;
}

/** MVP of a battle: result.stats.mvp | highest damage dealer of the player's side | first squad hero. */
export function pickMvp({ result, squad = [], playerSide = 1 } = {}) {
  const st = (result && result.stats) || {};
  if (st.mvp && getHero(typeof st.mvp === 'string' ? st.mvp : st.mvp.heroId)) return typeof st.mvp === 'string' ? st.mvp : st.mvp.heroId;
  const dmg = st.damage || st.damageBy || st.dealt;
  if (isObj(dmg)) {
    let best = null;
    let bestV = -1;
    for (const [k, v] of Object.entries(dmg)) {
      const heroId = getHero(k) ? k : null;
      if (heroId && squad.includes(heroId) && num(v) > bestV) {
        best = heroId;
        bestV = num(v);
      }
    }
    if (best) return best;
  }
  return squad.find((id) => getHero(id)) || null;
}

export function clampNum(v, lo, hi) {
  return clamp(num(v, lo), lo, hi);
}
