// Hero progression (GDD §11): levels 1–30, XP curve XP(L) = 60·L + 8·L², battle XP
// 25·L^1.5 + 50, level caps 10 / 20 / 30 unlocked by chapter bosses, XP scrolls, display stats
// (rules.statsAt + unconditional constellation stat mods) and «Мощь» (power, GDD §17.5).
//
// XP at the level cap: XP keeps filling the bar up to exactly xpToNext(cap) ("bar full") and the
// rest is lost; as soon as the cap rises (chapter boss cleared) a full bar turns into the next
// level and further banked XP is not needed — see applyLevelCap(). At level 30 the bar stays at 0.

import { PROGRESSION, xpToNext, battleXp, statsAt } from '../data/rules.js';
import { HERO_BY_ID } from '../data/heroes.js';

export { xpToNext, battleXp };

export const MAX_LEVEL = PROGRESSION.maxLevel;
export const XP_SCROLL = PROGRESSION.xpScroll;

/** Cumulative XP needed to reach `level` from level 1 (totalXpFor(30) = 94 540). */
export function totalXpFor(level) {
  let sum = 0;
  const to = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  for (let l = 1; l < to; l++) sum += xpToNext(l);
  return sum;
}

/** Stage-id that unlocks each cap, parsed from PROGRESSION.levelCaps ('clear:1-boss' -> '1-B'). */
export const LEVEL_CAPS = PROGRESSION.levelCaps.map((c) => {
  const m = /^clear:(\d+)-boss$/.exec(c.unlock);
  return { cap: c.cap, stageId: m ? `${m[1]}-B` : null };
});

/** Current level cap of the profile (10 at start, 20 after 1-B, 30 after 2-B). */
export function levelCap(profile) {
  let cap = LEVEL_CAPS[0].cap;
  const camp = (profile && profile.campaign) || {};
  for (const c of LEVEL_CAPS) {
    if (!c.stageId || (camp[c.stageId] && camp[c.stageId].cleared)) cap = Math.max(cap, c.cap);
  }
  return Math.min(cap, MAX_LEVEL);
}

/** Next cap and the stage that unlocks it, or null at the final cap. */
export function nextLevelCap(profile) {
  const cur = levelCap(profile);
  const next = LEVEL_CAPS.find((c) => c.cap > cur);
  return next ? { cap: next.cap, stageId: next.stageId } : null;
}

/** Max XP a hero entry may hold at `level` under `cap`. */
export function xpLimit(level, cap) {
  if (level >= MAX_LEVEL) return 0;
  if (level >= cap) return xpToNext(level);
  return Infinity;
}

/**
 * Add XP to a hero entry `{ level, xp }` (returns a NEW entry-like result, input untouched).
 * -> { level, xp, from, to, gained (XP actually kept), wasted }
 */
export function addXp(entry, amount, cap) {
  let level = clampInt(entry.level, 1, MAX_LEVEL, 1);
  let xp = clampInt(entry.xp, 0, Number.MAX_SAFE_INTEGER, 0);
  const from = level;
  const add = Math.max(0, Math.floor(Number(amount) || 0));
  const c = Math.max(1, Math.min(MAX_LEVEL, cap | 0));
  const before = totalXpFor(level) + xp;
  xp += add;
  while (level < c && level < MAX_LEVEL && xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level++;
  }
  const lim = xpLimit(level, c);
  if (xp > lim) xp = lim;
  const gained = totalXpFor(level) + xp - before;
  return { level, xp, from, to: level, gained, wasted: add - gained };
}

/** Re-apply a (raised) cap to an entry whose bar was full: returns { level, xp, from, to }. */
export function applyLevelCap(entry, cap) {
  return addXp(entry, 0, cap);
}

/** XP needed for the next level (0 at 30) and progress fraction 0..1 for an XP bar. */
export function xpProgress(entry, cap = MAX_LEVEL) {
  const level = clampInt(entry && entry.level, 1, MAX_LEVEL, 1);
  if (level >= MAX_LEVEL) return { level, xp: 0, need: 0, pct: 1, atCap: true, max: true };
  const need = xpToNext(level);
  const xp = Math.min(need, clampInt(entry && entry.xp, 0, need, 0));
  return { level, xp, need, pct: need ? xp / need : 1, atCap: level >= cap, max: false };
}

// ------------------------------------------------------------------------------------- stats

const STAT_MODS = { hpPct: 'hp', atkPct: 'atk', defPct: 'def' };

/** Unconditional constellation stat mods for C1..constellation: { hpPct, atkPct, defPct, critChance }. */
export function constellationMods(hero, constellation) {
  const out = { hpPct: 0, atkPct: 0, defPct: 0, critChance: 0 };
  if (!hero || !Array.isArray(hero.constellations)) return out;
  const c = clampInt(constellation, 0, 6, 0);
  for (const star of hero.constellations) {
    if (!star || star.c > c || !Array.isArray(star.patches)) continue;
    for (const p of star.patches) {
      const m = p && p.mod;
      if (!m || m.if || m.scale || !(m.stat in out)) continue;
      out[m.stat] += Number(m.value) || 0;
    }
  }
  return out;
}

/**
 * Display stats of a hero at a level / constellation: rules.statsAt + unconditional constellation
 * stat mods (Rare C1 HP +10 % etc.). The battle engine applies constellations itself; this is for
 * cards, power and previews. -> { hp, atk, def, crit, aff, base: statsAt(...) }
 */
export function heroStatsAt(heroId, level = 1, constellation = 0) {
  const hero = HERO_BY_ID[heroId];
  if (!hero) return null;
  const base = statsAt(hero, clampInt(level, 1, MAX_LEVEL, 1));
  const mods = constellationMods(hero, constellation);
  const out = { ...base, base };
  for (const [mod, stat] of Object.entries(STAT_MODS)) out[stat] = Math.floor(base[stat] * (1 + mods[mod]));
  out.crit = base.crit + mods.critChance;
  return out;
}

/** «Мощь» of one hero (GDD §17.5): (HP/10 + ATK + DEF) × (1 + 0.05 × C), base stats at the level. */
export function powerAt(heroId, level = 1, constellation = 0) {
  const hero = HERO_BY_ID[heroId];
  if (!hero) return 0;
  const s = statsAt(hero, clampInt(level, 1, MAX_LEVEL, 1));
  return Math.round((s.hp / 10 + s.atk + s.def) * (1 + 0.05 * clampInt(constellation, 0, 6, 0)));
}

/** Power of an owned hero (unowned heroes: level 1, C0 — for the collection silhouettes). */
export function heroPower(profile, heroId) {
  const e = profile && profile.heroes && profile.heroes[heroId];
  return e ? powerAt(heroId, e.level, e.constellation) : powerAt(heroId, 1, 0);
}

/** Σ power of a squad (default: the profile's squad). */
export function squadPower(profile, ids = profile && profile.squad) {
  let sum = 0;
  for (const id of ids || []) sum += heroPower(profile, typeof id === 'string' ? id : id && id.heroId);
  return sum;
}

/** Power of a Squad array ([{ heroId, level, constellation }]) — enemy lineups etc. */
export function lineupPower(squad) {
  let sum = 0;
  for (const u of squad || []) if (u) sum += powerAt(u.heroId, u.level, u.constellation || 0);
  return sum;
}

export function clampInt(v, lo, hi, dflt) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}
