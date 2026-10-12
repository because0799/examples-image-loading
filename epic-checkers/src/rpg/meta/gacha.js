// «Призыв» — gacha (GDD §12, rules.js GACHA). Star Crystals only, no real money.
//
// One pull, given the shared pity counters { sinceEpicPlus, sinceLegendaryPlus, legendaryStreak }:
//   k  = sinceLegendaryPlus + 1                       (index of this pull since the last Legendary+)
//   pL = legendaryPlusChance(k)                       2.5 % · soft pity from #46: +6 %/pull · #60 = 100 %
//   u < pL           → Legendary+: Mythic with 20 %, or for sure after 4 non-Mythic Legendary+ in a row
//   else             → Epic or Rare in the base ratio 15 : 82.5 (soft pity takes probability from both)
//   Rare on the 10th pull without Epic+  → upgraded to Epic («гарантия Эпической+»).
// Novice banner: the first 20 pulls made as ×10 (two 10-pulls = the 3 200 starting crystals) contain
// at least one Legendary+ — if none came naturally, the 20th novice pull is forced to Legendary+.
// Counters are shared by both banners and persist in the profile.
// This model reproduces the GDD's Monte-Carlo figures exactly (stationary rates: Mythic 1.04 %,
// Legendary 2.45 %, Epic 17.61 %, Rare 78.89 %; 28.6 pulls per Legendary+, 96.2 per Mythic).
//
// Duplicates: each copy after the first lights the next constellation star (copies 2–7 → C1–C6);
// at C6 a duplicate turns into Stardust (Rare 20, Epic 60, Legendary 200, Mythic 300).

import { GACHA, RARITIES, RARITY_ORDER, legendaryPlusChance } from '../data/rules.js';
import { HEROES, HERO_BY_ID } from '../data/heroes.js';
import { toRng } from './rng.js';
import { cloneProfile, ensureProfile, HISTORY_LIMIT } from './profile.js';
import { evaluateAchievements } from './economy.js';

export const SUMMON_COST = Object.freeze({
  1: GACHA.cost.single,
  10: GACHA.cost.multi,
  single: GACHA.cost.single,
  multi: GACHA.cost.multi,
});
export const SUMMON_COUNTS = [1, GACHA.cost.multiCount];

/** Hero ids per rarity, in roster order (uniform pick inside the rolled rarity). */
export const HEROES_BY_RARITY = Object.fromEntries(
  RARITY_ORDER.map((r) => [r, HEROES.filter((h) => h.rarity === r).map((h) => h.id)]),
);

const EPIC_SHARE = GACHA.rates.epic / (GACHA.rates.epic + GACHA.rates.rare);

export const BANNERS = [
  {
    id: 'novice',
    name: { ru: 'Призыв новичка', en: 'Novice Summon' },
    desc: {
      ru: 'Первые 20 призывов (только по 10): гарантированная Легендарная или Мифическая героиня.',
      en: 'Your first 20 summons (10 at a time): a guaranteed Legendary or Mythic hero.',
    },
    pulls: GACHA.noviceBanner.pulls,
    onlyMulti: true,
  },
  {
    id: 'standard',
    name: { ru: 'Звёздный призыв', en: 'Star Summon' },
    desc: {
      ru: 'Все 24 героини. Гарантия Эпической+ каждые 10 призывов, Легендарной+ — не позже 60-го.',
      en: 'All 24 heroes. Epic+ guaranteed every 10 summons, Legendary+ by the 60th.',
    },
    pulls: Infinity,
    onlyMulti: false,
  },
];

// -------------------------------------------------------------------------------- core roll

export function emptyPity() {
  return { sinceEpicPlus: 0, sinceLegendaryPlus: 0, legendaryStreak: 0, novicePulls: 0, noviceLegendary: false, total: 0 };
}

/** Is the novice guarantee due on THIS pull (20th novice pull without a Legendary+ so far)? */
function noviceForced(pity, novice) {
  return !!novice && !pity.noviceLegendary && pity.novicePulls === GACHA.noviceBanner.pulls - 1;
}

/**
 * Chances of the NEXT pull for a pity state: { mythic, legendary, epic, rare, legendaryPlus,
 * epicForced, mythicGuaranteed }. Sums to 1.
 */
export function pullChances(pity, { novice = false } = {}) {
  const pt = pity || emptyPity();
  const pL = noviceForced(pt, novice) ? 1 : legendaryPlusChance(pt.sinceLegendaryPlus + 1);
  const mythicGuaranteed = pt.legendaryStreak >= GACHA.pity.mythicGuaranteeAfter;
  const pM = mythicGuaranteed ? 1 : GACHA.pity.mythicShare;
  const epicForced = pt.sinceEpicPlus + 1 >= GACHA.pity.epicPlusEvery;
  const rest = 1 - pL;
  return {
    mythic: pL * pM,
    legendary: pL * (1 - pM),
    epic: epicForced ? rest : rest * EPIC_SHARE,
    rare: epicForced ? 0 : rest * (1 - EPIC_SHARE),
    legendaryPlus: pL,
    epicForced,
    mythicGuaranteed,
  };
}

/**
 * Roll the rarity of one pull. Pure: returns the new pity object, never mutates `pity`.
 * Consumes 1 random number (2 on a Legendary+). `rng` = () => [0, 1).
 * -> { rarity, pity, guarantee: null | 'epic' | 'soft' | 'hard' | 'novice', mythicGuarantee: boolean }
 */
export function rollRarity(pity, rng, { novice = false } = {}) {
  const pt = pity || emptyPity();
  const k = pt.sinceLegendaryPlus + 1;
  const forceNovice = noviceForced(pt, novice);
  const pL = forceNovice ? 1 : legendaryPlusChance(k);
  const u = rng();
  let rarity;
  let guarantee = null;
  let mythicGuarantee = false;
  if (u < pL) {
    mythicGuarantee = pt.legendaryStreak >= GACHA.pity.mythicGuaranteeAfter;
    const mythic = mythicGuarantee || rng() < GACHA.pity.mythicShare;
    rarity = mythic ? 'mythic' : 'legendary';
    if (forceNovice && u >= legendaryPlusChance(k)) guarantee = 'novice';
    else if (k >= GACHA.pity.legendaryPlusHard) guarantee = 'hard';
    else if (k >= GACHA.pity.legendaryPlusSoftFrom) guarantee = 'soft';
  } else {
    // u is uniform on [pL, 1): split Epic : Rare in the base 15 : 82.5 ratio
    rarity = (u - pL) / (1 - pL) < EPIC_SHARE ? 'epic' : 'rare';
    if (rarity === 'rare' && pt.sinceEpicPlus + 1 >= GACHA.pity.epicPlusEvery) {
      rarity = 'epic';
      guarantee = 'epic';
    }
  }
  const lPlus = rarity === 'legendary' || rarity === 'mythic';
  const next = {
    sinceEpicPlus: rarity === 'rare' ? pt.sinceEpicPlus + 1 : 0,
    sinceLegendaryPlus: lPlus ? 0 : k,
    legendaryStreak: rarity === 'mythic' ? 0 : rarity === 'legendary' ? pt.legendaryStreak + 1 : pt.legendaryStreak,
    novicePulls: novice ? pt.novicePulls + 1 : pt.novicePulls,
    noviceLegendary: pt.noviceLegendary || (novice && lPlus),
    total: (pt.total | 0) + 1,
  };
  return { rarity, pity: next, guarantee, mythicGuarantee };
}

/** Pick a hero of the rarity uniformly (1 random number). */
export function pickHero(rarity, rng) {
  const list = HEROES_BY_RARITY[rarity];
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

// ---------------------------------------------------------------------------- profile level

/** Is the novice banner still open (fewer than 20 novice pulls made)? */
export function noviceAvailable(profile) {
  return !!profile && profile.pity.novicePulls < GACHA.noviceBanner.pulls;
}

/** Which banner a summon of `count` goes to: 'novice' for ×10 while it is open, else 'standard'. */
export function bannerFor(profile, count) {
  return count === GACHA.cost.multiCount && noviceAvailable(profile) ? 'novice' : 'standard';
}

/** Payment for `count` pulls: tickets first (1 ticket = 1 pull), the rest in crystals. */
export function summonCost(profile, count, { useTickets = true } = {}) {
  const n = count === GACHA.cost.multiCount ? GACHA.cost.multiCount : 1;
  const tickets = useTickets ? Math.min(n, Math.max(0, (profile && profile.tickets) | 0)) : 0;
  const crystals = n === GACHA.cost.multiCount && tickets === 0 ? GACHA.cost.multi : (n - tickets) * GACHA.cost.single;
  return { tickets, crystals };
}

/** Can the profile afford `count` (1 | 10) pulls? */
export function canSummon(profile, count, opts = {}) {
  if (!profile || !SUMMON_COUNTS.includes(count)) return false;
  const cost = summonCost(profile, count, opts);
  return profile.crystals >= cost.crystals && profile.tickets >= cost.tickets;
}

/**
 * Summon `count` heroes (contract API). The third argument is a seed number or an options object
 * { seed?, rng?, banner?: 'auto'|'novice'|'standard', now?, useTickets? = true }. Without seed/rng
 * the profile's persisted summon seed is used and advanced (deterministic per profile).
 * Pure: returns a NEW profile.
 * -> { ok, error?, results: [{ heroId, rarity, isNew, constellation, copies, refund?: { dust },
 *      guarantee, pull }], profile, best, banner, cost, achievements: [unlocked…] }
 * error: 'count' | 'banner' | 'crystals'
 */
export function summon(profileIn, count, seedOrOpts) {
  const profile = ensureProfile(profileIn);
  const opts = typeof seedOrOpts === 'number' ? { seed: seedOrOpts } : seedOrOpts || {};
  const fail = (error) => ({ ok: false, error, results: [], profile, best: null, banner: null, cost: null, achievements: [] });
  if (!SUMMON_COUNTS.includes(count)) return fail('count');
  let banner = opts.banner && opts.banner !== 'auto' ? opts.banner : bannerFor(profile, count);
  if (banner === 'novice' && (count !== GACHA.cost.multiCount || !noviceAvailable(profile))) return fail('banner');
  if (banner !== 'novice' && banner !== 'standard') return fail('banner');
  if (!canSummon(profile, count, opts)) return fail('crystals');

  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const p = cloneProfile(profile);
  const cost = summonCost(p, count, opts);
  p.crystals -= cost.crystals;
  p.tickets -= cost.tickets;
  p.stats.crystalsSpent += cost.crystals;

  const explicit = opts.rng !== undefined || Number.isFinite(opts.seed);
  const rng = toRng(opts.rng !== undefined ? opts.rng : opts.seed, p.seeds.summon);
  const novice = banner === 'novice';
  const results = [];
  let bestIdx = -1;
  for (let i = 0; i < count; i++) {
    const roll = rollRarity(p.pity, rng, { novice });
    p.pity = roll.pity;
    const heroId = pickHero(roll.rarity, rng);
    const res = grantHero(p, heroId, now);
    res.rarity = roll.rarity;
    res.guarantee = roll.guarantee || (roll.mythicGuarantee ? 'mythic' : null);
    res.pull = p.pity.total;
    results.push(res);
    p.history.push({ id: heroId, r: roll.rarity, n: p.pity.total, t: now });
    p.stats.summons++;
    if (roll.rarity === 'epic') p.stats.epicPulls++;
    else if (roll.rarity === 'legendary') p.stats.legendaryPulls++;
    else if (roll.rarity === 'mythic') p.stats.mythicPulls++;
    if (bestIdx < 0 || RARITY_ORDER.indexOf(roll.rarity) > RARITY_ORDER.indexOf(results[bestIdx].rarity)) bestIdx = i;
  }
  if (p.history.length > HISTORY_LIMIT) p.history.splice(0, p.history.length - HISTORY_LIMIT);
  if (!explicit) p.seeds.summon = rng.state() >>> 0;
  p.updatedAt = now;
  const achievements = evaluateAchievements(p, now);
  return { ok: true, results, profile: p, best: results[bestIdx].rarity, banner, cost, achievements };
}

/**
 * Give one copy of a hero to a profile IN PLACE (internal helper for summons and rewards).
 * -> { heroId, isNew, constellation, copies, refund? }
 */
export function grantHero(p, heroId, now = Date.now()) {
  const hero = HERO_BY_ID[heroId];
  const e = p.heroes[heroId];
  if (!e) {
    p.heroes[heroId] = { level: 1, xp: 0, constellation: 0, copies: 1, obtainedAt: now, seen: false };
    return { heroId, isNew: true, constellation: 0, copies: 1 };
  }
  e.copies++;
  if (e.constellation < GACHA.duplicates.constellationCopies) {
    e.constellation++;
    return { heroId, isNew: false, constellation: e.constellation, copies: e.copies };
  }
  const dust = RARITIES[hero.rarity].dupDustAfterC6;
  p.dust += dust;
  p.stats.dustEarned += dust;
  return { heroId, isNew: false, constellation: e.constellation, copies: e.copies, refund: { dust } };
}

/**
 * Pity counters for the summon screen: «До Эпической+: 7», «До Легендарной+: 38» etc.
 */
export function pityStatus(profile) {
  const pt = (profile && profile.pity) || emptyPity();
  const novice = noviceAvailable(profile);
  const next = pullChances(pt, { novice: false });
  return {
    toEpicPlus: GACHA.pity.epicPlusEvery - pt.sinceEpicPlus,
    toLegendaryPlus: GACHA.pity.legendaryPlusHard - pt.sinceLegendaryPlus,
    softPityFrom: GACHA.pity.legendaryPlusSoftFrom,
    inSoftPity: pt.sinceLegendaryPlus + 1 >= GACHA.pity.legendaryPlusSoftFrom,
    nextLegendaryPlusChance: next.legendaryPlus,
    mythicGuaranteed: next.mythicGuaranteed,
    legendaryStreak: pt.legendaryStreak,
    total: pt.total,
    novicePullsLeft: Math.max(0, GACHA.noviceBanner.pulls - pt.novicePulls),
    novice: {
      available: novice,
      remaining: Math.max(0, GACHA.noviceBanner.pulls - pt.novicePulls),
      guaranteePending: novice && !pt.noviceLegendary,
    },
  };
}

/** Rates table for the «Шансы» sheet (base and consolidated, in percent). */
export const SUMMON_RATES = {
  base: { mythic: 0.5, legendary: 2.0, epic: 15, rare: 82.5 },
  consolidated: { mythic: 1.04, legendary: 2.45, epic: 17.61, rare: 78.89 },
  pullsPerLegendaryPlus: 28.6,
  pullsPerMythic: 96.2,
  perHero: Object.fromEntries(
    RARITY_ORDER.map((r) => [r, { base: (GACHA.rates[r] * 100) / HEROES_BY_RARITY[r].length }]),
  ),
  pity: {
    epicPlusEvery: GACHA.pity.epicPlusEvery,
    softFrom: GACHA.pity.legendaryPlusSoftFrom,
    softStepPct: GACHA.pity.legendaryPlusSoftStep * 100,
    hard: GACHA.pity.legendaryPlusHard,
    mythicSharePct: GACHA.pity.mythicShare * 100,
    mythicAfter: GACHA.pity.mythicGuaranteeAfter + 1,
  },
};
