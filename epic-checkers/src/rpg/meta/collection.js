// Collection view helpers (GDD §17.3–17.4): every roster hero with ownership, level, XP bar,
// constellation, power and display stats, in the collection's default order (rarity high → low,
// then roster order). Pure read-only functions plus `markHeroSeen` for the «Новая!» badge.

import { RARITY_ORDER } from '../data/rules.js';
import { HEROES, HERO_BY_ID } from '../data/heroes.js';
import { cloneProfile } from './profile.js';
import { heroStatsAt, powerAt, xpProgress, levelCap, MAX_LEVEL } from './progression.js';

/** One hero card view-model. */
export function heroView(profile, heroId) {
  const hero = HERO_BY_ID[heroId];
  if (!hero) return null;
  const e = profile && profile.heroes[heroId];
  const cap = levelCap(profile);
  const level = e ? e.level : 1;
  const constellation = e ? e.constellation : 0;
  return {
    id: heroId,
    owned: !!e,
    isNew: !!e && e.seen === false,
    rarity: hero.rarity,
    element: hero.element,
    role: hero.role,
    name: hero.name,
    title: hero.title,
    level,
    cap,
    constellation,
    copies: e ? e.copies : 0,
    xp: xpProgress(e || { level: 1, xp: 0 }, cap),
    stats: heroStatsAt(heroId, level, constellation),
    nextStats: level < MAX_LEVEL ? heroStatsAt(heroId, level + 1, constellation) : null,
    power: powerAt(heroId, level, constellation),
    inSquad: !!profile && profile.squad.includes(heroId),
  };
}

const rarityRank = (r) => RARITY_ORDER.indexOf(r);

/**
 * All 24 heroes as view-models. opts: { filter: { element?, role?, rarity?, owned?: boolean },
 * sort: 'rarity' (default) | 'level' | 'power' | 'name' (lang via `lang`) }
 */
export function collectionView(profile, { filter = {}, sort = 'rarity', lang = 'ru' } = {}) {
  let list = HEROES.map((h, i) => ({ ...heroView(profile, h.id), order: i }));
  if (filter.element) list = list.filter((v) => v.element === filter.element);
  if (filter.role) list = list.filter((v) => v.role === filter.role);
  if (filter.rarity) list = list.filter((v) => v.rarity === filter.rarity);
  if (typeof filter.owned === 'boolean') list = list.filter((v) => v.owned === filter.owned);
  const byRarity = (a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || a.order - b.order;
  const cmp = {
    rarity: (a, b) => Number(b.owned) - Number(a.owned) || byRarity(a, b),
    level: (a, b) => Number(b.owned) - Number(a.owned) || b.level - a.level || byRarity(a, b),
    power: (a, b) => Number(b.owned) - Number(a.owned) || b.power - a.power || byRarity(a, b),
    name: (a, b) => String(a.name[lang] || a.name.en).localeCompare(String(b.name[lang] || b.name.en), lang),
  }[sort] || byRarity;
  return list.sort(cmp);
}

/** Owned / total counts per rarity. */
export function collectionSummary(profile) {
  const out = { owned: 0, total: HEROES.length, byRarity: {} };
  for (const r of RARITY_ORDER) out.byRarity[r] = { owned: 0, total: 0 };
  for (const h of HEROES) {
    out.byRarity[h.rarity].total++;
    if (profile.heroes[h.id]) {
      out.owned++;
      out.byRarity[h.rarity].owned++;
    }
  }
  return out;
}

/** Clear the «Новая!» badge of a hero (or of every hero when `heroId` is omitted). */
export function markHeroSeen(profile, heroId) {
  const p = cloneProfile(profile);
  for (const [id, e] of Object.entries(p.heroes)) if (!heroId || id === heroId) e.seen = true;
  return p;
}
