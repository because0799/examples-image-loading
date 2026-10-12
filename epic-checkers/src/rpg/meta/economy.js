// Economy (GDD §13): Star Crystals ✦, Stardust, XP scrolls, summon tickets; daily first battle and
// daily tasks, the ~40 one-off achievements (2 400 ✦ in total), the Star Shop, and XP scrolls.
//
// Crystal sources (one-off): start 3 200 · first clears 24 × 80 + 3 × 400 = 3 120 · ★★★ chests
// 27 × 60 = 1 620 · achievements 2 400  →  10 340 ✦ ≈ 64 summons.
// Daily (device clock, local day): first battle 40 · tasks 30 + 20 + 20 · repeat wins 10 each up to
// 150  →  ≤ 260 ✦/day. Duels give no crystals. Clock rollback never resets the day (anti-farming:
// the day only moves forward).

import { ECONOMY, RARITIES } from '../data/rules.js';
import { HERO_BY_ID, HEROES } from '../data/heroes.js';
import { cloneProfile, ensureProfile, REACTION_IDS } from './profile.js';
import { STAGES, CHAPTERS, isCleared } from './campaign.js';
import { addXp, levelCap, XP_SCROLL, xpToNext, totalXpFor, MAX_LEVEL } from './progression.js';

// ------------------------------------------------------------------------------------ time keys

const pad = (n) => String(n).padStart(2, '0');

/** Local calendar day 'YYYY-MM-DD' of a timestamp (ms) or Date. */
export function dayKey(now = Date.now()) {
  const d = now instanceof Date ? now : new Date(now);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** ISO week 'YYYY-Www' of the local date (weekly shop limits). */
export function weekKey(now = Date.now()) {
  const d0 = now instanceof Date ? now : new Date(now);
  const d = new Date(Date.UTC(d0.getFullYear(), d0.getMonth(), d0.getDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad(week)}`;
}

// ---------------------------------------------------------------------------------- currencies

/** Credit currencies to a profile IN PLACE (internal). */
export function credit(p, { crystals = 0, xpScrolls = 0, dust = 0, tickets = 0 } = {}) {
  if (crystals > 0) {
    p.crystals += crystals;
    p.stats.crystalsEarned += crystals;
  }
  if (xpScrolls > 0) p.xpScrolls += xpScrolls;
  if (dust > 0) {
    p.dust += dust;
    p.stats.dustEarned += dust;
  }
  if (tickets > 0) p.tickets += tickets;
}

// -------------------------------------------------------------------------------------- daily

const TASK_KIND = { win: 'wins', react: 'reactions', ult: 'ults' };

/** Daily tasks with parsed targets: [{ id, kind: 'wins'|'reactions'|'ults', target, crystals, xpScrolls, desc }]. */
export const DAILY_TASKS = ECONOMY.dailyTasks.map((t) => {
  const m = /^([a-z]+)(\d+)$/.exec(t.id);
  return {
    id: t.id,
    kind: m ? TASK_KIND[m[1]] || m[1] : t.id,
    target: m ? Number(m[2]) : 1,
    crystals: t.crystals || 0,
    xpScrolls: t.xpScrolls || 0,
    desc: t.desc,
  };
});

export const DAILY_FIRST_BATTLE = ECONOMY.firstBattleOfDay;
export const REPEAT_WIN = ECONOMY.repeatWin;
export const REPEAT_DAILY_CAP = ECONOMY.repeatDailyCap;

/** Move the daily state to `now`'s day IN PLACE. Returns true when a new day started. */
export function rollDaily(p, now = Date.now()) {
  const today = dayKey(now);
  const d = p.daily;
  if (d.day && today <= d.day) return false; // same day, or the clock went backwards
  d.day = today;
  d.firstBattle = false;
  d.repeatCrystals = 0;
  for (const t of DAILY_TASKS) d.tasks[t.id] = { progress: 0, claimed: false };
  return true;
}

function rollWeekly(p, now) {
  const wk = weekKey(now);
  if (!p.weekly.week || wk > p.weekly.week) p.weekly = { week: wk, tickets: 0 };
}

/** Claim every completed-but-unclaimed daily task IN PLACE. -> reward items */
export function claimDailyTasks(p) {
  const items = [];
  for (const t of DAILY_TASKS) {
    const st = p.daily.tasks[t.id];
    if (!st || st.claimed || st.progress < t.target) continue;
    st.claimed = true;
    credit(p, { crystals: t.crystals, xpScrolls: t.xpScrolls });
    items.push({ kind: 'task', id: t.id, crystals: t.crystals, xpScrolls: t.xpScrolls, label: t.desc });
  }
  return items;
}

/**
 * Contract API: daily rollover + claim of every completed daily task not claimed yet.
 * (Battle results credit daily rewards automatically; this is the hub's "collect" / rollover call.)
 * -> { profile, newDay, rewards: { crystals, xpScrolls, items }, status: dailyStatus(...) }
 */
export function claimDaily(profile, now = Date.now()) {
  const p = cloneProfile(ensureProfile(profile));
  const newDay = rollDaily(p, now);
  rollWeekly(p, now);
  const items = claimDailyTasks(p);
  const rewards = sumItems(items);
  if (items.length || newDay) p.updatedAt = now;
  return { profile: p, newDay, rewards, status: dailyStatus(p, now) };
}

/** Read-only view of the daily state at `now` (a stale day shows as reset). */
export function dailyStatus(profile, now = Date.now()) {
  const today = dayKey(now);
  const d = profile.daily;
  const stale = !d.day || today > d.day;
  const tasks = DAILY_TASKS.map((t) => {
    const st = stale ? { progress: 0, claimed: false } : d.tasks[t.id] || { progress: 0, claimed: false };
    return {
      id: t.id,
      kind: t.kind,
      desc: t.desc,
      target: t.target,
      progress: Math.min(st.progress, t.target),
      done: st.progress >= t.target,
      claimed: !!st.claimed,
      crystals: t.crystals,
      xpScrolls: t.xpScrolls,
    };
  });
  return {
    day: today,
    firstBattle: { crystals: DAILY_FIRST_BATTLE, claimed: stale ? false : !!d.firstBattle },
    repeat: { earned: stale ? 0 : d.repeatCrystals, cap: REPEAT_DAILY_CAP, per: REPEAT_WIN },
    tasks,
    maxPerDay: DAILY_FIRST_BATTLE + REPEAT_DAILY_CAP + DAILY_TASKS.reduce((a, t) => a + t.crystals, 0),
  };
}

export function sumItems(items) {
  const out = { crystals: 0, xpScrolls: 0, dust: 0, items };
  for (const it of items) {
    out.crystals += it.crystals || 0;
    out.xpScrolls += it.xpScrolls || 0;
    out.dust += it.dust || 0;
  }
  return out;
}

// -------------------------------------------------------------------------------- achievements

const ownedCount = (p) => Object.keys(p.heroes).length;
const ownedOfRarity = (p, r) => Object.keys(p.heroes).filter((id) => HERO_BY_ID[id] && HERO_BY_ID[id].rarity === r).length;
const maxOf = (p, key) => Object.values(p.heroes).reduce((m, e) => Math.max(m, e[key] | 0), 0);
const threeStarCount = (p, chapter) =>
  STAGES.filter((s) => (!chapter || s.chapter === chapter) && p.campaign[s.id] && p.campaign[s.id].stars >= 3).length;
const chapterSize = (ch) => CHAPTERS[ch - 1].stageIds.length;
const clearedFlag = (id) => (p) => (isCleared(p, id) ? 1 : 0);

const A = (id, ru, en, dru, den, crystals, target, metric, group) => ({
  id, name: { ru, en }, desc: { ru: dru, en: den }, crystals, target, metric, group,
});

/**
 * One-off achievements (GDD §13): 40 entries, 30–150 ✦ each, 2 400 ✦ in total. `metric(profile)`
 * is compared against `target`; everything is derived from persisted profile data, so achievements
 * can be re-evaluated at any time (after battles, summons, level-ups, shop purchases).
 */
export const ACHIEVEMENTS = [
  // battles
  A('first-victory', 'Первая победа', 'First Victory', 'Выиграть первый бой.', 'Win your first battle.', 30, 1, (p) => p.stats.wins, 'battle'),
  A('veteran', 'Ветеран доски', 'Board Veteran', 'Одержать 25 побед.', 'Win 25 battles.', 50, 25, (p) => p.stats.wins, 'battle'),
  A('grand-strategist', 'Великий Стратег', 'Grand Strategist', 'Одержать 100 побед.', 'Win 100 battles.', 100, 100, (p) => p.stats.wins, 'battle'),
  A('first-crown', 'Первая дамка', 'First Queen', 'Пробудить героиню на заднем ряду врага.', "Awaken a hero on the enemy's back row.", 40, 1, (p) => p.stats.awakenings, 'battle'),
  A('coronations', 'Коронация за коронацией', 'Coronation After Coronation', 'Пробудить героинь 25 раз.', 'Awaken heroes 25 times.', 60, 25, (p) => p.stats.awakenings, 'battle'),
  A('chain-3', 'Прыжок за прыжком', 'Hop After Hop', 'Цепочка из 3 прыжков-ударов.', 'A chain of 3 jump-strikes.', 40, 3, (p) => p.stats.maxChain, 'battle'),
  A('chain-4', 'Цепь из 4 прыжков', 'Chain of Four', 'Цепочка из 4 прыжков-ударов.', 'A chain of 4 jump-strikes.', 80, 4, (p) => p.stats.maxChain, 'battle'),
  A('first-reaction', 'Алхимия стихий', 'Elemental Alchemy', 'Вызвать первую реакцию.', 'Trigger your first reaction.', 30, 1, (p) => p.stats.reactions, 'battle'),
  A('reactions-100', 'Мастер реакций', 'Reaction Master', 'Вызвать 100 реакций.', 'Trigger 100 reactions.', 60, 100, (p) => p.stats.reactions, 'battle'),
  A('all-reactions', 'Все 8 реакций', 'All 8 Reactions', 'Вызвать каждую из 8 реакций.', 'Trigger each of the 8 reactions.', 120, REACTION_IDS.length,
    (p) => REACTION_IDS.filter((r) => p.stats.reactionKinds[r] > 0).length, 'battle'),
  A('eclipse', 'Затмение!', 'Eclipse!', 'Вызвать реакцию Затмение.', 'Trigger the Eclipse reaction.', 50, 1, (p) => p.stats.reactionKinds.eclipse, 'battle'),
  A('first-ult', 'Первая Вспышка', 'First Flash', 'Применить Вспышку.', 'Cast an Ultimate.', 30, 1, (p) => p.stats.ults, 'battle'),
  A('ults-50', 'Режиссёр Вспышек', 'Flash Director', 'Применить 50 Вспышек.', 'Cast 50 Ultimates.', 60, 50, (p) => p.stats.ults, 'battle'),
  A('ko-100', 'Гроза Отражений', 'Bane of Reflections', 'Выбить 100 врагов.', 'Knock out 100 enemies.', 50, 100, (p) => p.stats.kos, 'battle'),
  A('flawless', 'Ни царапины', 'Not a Scratch', 'Победить, не потеряв ни одной героини.', 'Win without losing a single hero.', 40, 1, (p) => p.stats.flawlessWins, 'battle'),
  A('last-stand', 'Последняя на доске', 'Last One Standing', 'Победить, когда в строю осталась одна героиня.', 'Win with a single hero left standing.', 50, 1, (p) => p.stats.lastStandWins, 'battle'),
  // campaign
  A('grey-swallow', 'Серая Ласточка повержена', 'The Grey Swallow Falls', 'Победить босса главы 1.', 'Defeat the Chapter 1 boss.', 60, 1, clearedFlag('1-B'), 'campaign'),
  A('ashen-phoenix', 'Пепельный Феникс повержен', 'The Ashen Phoenix Falls', 'Победить босса главы 2.', 'Defeat the Chapter 2 boss.', 80, 1, clearedFlag('2-B'), 'campaign'),
  A('faceless-queen', 'Победить Безликую Дамку', 'Defeat the Faceless Queen', 'Победить финального босса.', 'Defeat the final boss.', 150, 1, clearedFlag('3-B'), 'campaign'),
  A('stars-dawn', 'Рассвет на ★★★', 'Dawn on ★★★', 'Получить ★★★ на всех этапах главы 1.', 'Get ★★★ on every Chapter 1 stage.', 50, chapterSize(1), (p) => threeStarCount(p, 1), 'campaign'),
  A('stars-ash', 'Пепел на ★★★', 'Ashes on ★★★', 'Получить ★★★ на всех этапах главы 2.', 'Get ★★★ on every Chapter 2 stage.', 50, chapterSize(2), (p) => threeStarCount(p, 2), 'campaign'),
  A('stars-sky', 'Небо на ★★★', 'Sky on ★★★', 'Получить ★★★ на всех этапах главы 3.', 'Get ★★★ on every Chapter 3 stage.', 80, chapterSize(3), (p) => threeStarCount(p, 3), 'campaign'),
  A('no-losses', 'Без потерь', 'No Losses', 'Получить ★★★ на 10 этапах.', 'Get ★★★ on 10 stages.', 80, 10, (p) => threeStarCount(p, 0), 'campaign'),
  // collection
  A('collector-1', 'Коллекционер I', 'Collector I', 'Собрать 8 героинь.', 'Collect 8 heroes.', 50, 8, ownedCount, 'collection'),
  A('collector-2', 'Коллекционер II', 'Collector II', 'Собрать 16 героинь.', 'Collect 16 heroes.', 80, 16, ownedCount, 'collection'),
  A('collector-3', 'Коллекционер III', 'Collector III', 'Собрать всех 24 героинь.', 'Collect all 24 heroes.', 120, HEROES.length, ownedCount, 'collection'),
  A('first-legendary', 'Легенда во плоти', 'A Living Legend', 'Получить Легендарную героиню.', 'Obtain a Legendary hero.', 50, 1, (p) => ownedOfRarity(p, 'legendary'), 'collection'),
  A('first-mythic', 'Встреча с мифом', 'Meeting a Myth', 'Получить Мифическую героиню.', 'Obtain a Mythic hero.', 80, 1, (p) => ownedOfRarity(p, 'mythic'), 'collection'),
  A('first-star', 'Первая звезда', 'First Star', 'Зажечь первую звезду Созвездия.', 'Light the first Constellation star.', 30, 1, (p) => maxOf(p, 'constellation'), 'collection'),
  A('first-c6', 'Первое C6', 'First C6', 'Довести Созвездие героини до C6.', "Raise a hero's Constellation to C6.", 80, 6, (p) => maxOf(p, 'constellation'), 'collection'),
  A('summons-100', 'Звездопад', 'Starfall', 'Совершить 100 призывов.', 'Make 100 summons.', 50, 100, (p) => p.stats.summons, 'collection'),
  A('stardust', 'Звёздная пыль', 'Stardust', 'Накопить 500 Звёздной пыли за всё время.', 'Earn 500 Stardust in total.', 30, 500, (p) => p.stats.dustEarned, 'collection'),
  // progression
  A('level-10', 'Первый предел', 'First Limit', 'Поднять героиню до 10-го уровня.', 'Raise a hero to level 10.', 30, 10, (p) => maxOf(p, 'level'), 'progression'),
  A('level-20', 'Второй предел', 'Second Limit', 'Поднять героиню до 20-го уровня.', 'Raise a hero to level 20.', 50, 20, (p) => maxOf(p, 'level'), 'progression'),
  A('level-30', 'Вершина', 'The Summit', 'Поднять героиню до 30-го уровня.', 'Raise a hero to level 30.', 60, 30, (p) => maxOf(p, 'level'), 'progression'),
  A('squad-30', 'Отряд легенд', 'Squad of Legends', 'Поднять шесть героинь до 30-го уровня.', 'Raise six heroes to level 30.', 100, 6,
    (p) => Object.values(p.heroes).filter((e) => e.level >= MAX_LEVEL).length, 'progression'),
  A('bookworm', 'Книжный червь', 'Bookworm', 'Прочитать 20 свитков опыта.', 'Use 20 XP scrolls.', 30, 20, (p) => p.stats.xpScrollsUsed, 'progression'),
  // side modes
  A('sparring', 'Спарринг', 'Sparring', 'Победить 10 раз в Тренировке.', 'Win 10 Training battles.', 40, 10, (p) => p.stats.trainingWins, 'modes'),
  A('first-duel', 'Вызов принят', 'Challenge Accepted', 'Сыграть Дуэль.', 'Play a Duel.', 30, 1, (p) => p.stats.duels, 'modes'),
  A('duelist', 'Дуэлянт', 'Duelist', 'Сыграть 10 Дуэлей.', 'Play 10 Duels.', 50, 10, (p) => p.stats.duels, 'modes'),
];

export const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
export const ACHIEVEMENTS_TOTAL = ACHIEVEMENTS.reduce((a, x) => a + x.crystals, 0);

/**
 * Unlock every achievement whose metric reached its target and credit its crystals IN PLACE.
 * -> [{ kind: 'achievement', id, crystals, label }]
 */
export function evaluateAchievements(p, now = Date.now()) {
  const out = [];
  for (const a of ACHIEVEMENTS) {
    if (p.achievements[a.id]) continue;
    let v = 0;
    try {
      v = Number(a.metric(p)) || 0;
    } catch (e) {
      v = 0;
    }
    if (v < a.target) continue;
    p.achievements[a.id] = { at: now };
    credit(p, { crystals: a.crystals });
    out.push({ kind: 'achievement', id: a.id, crystals: a.crystals, label: a.name });
  }
  return out;
}

/** Achievement list with progress for the «Задания и достижения» screen. */
export function achievementStatus(profile) {
  return ACHIEVEMENTS.map((a) => {
    let v = 0;
    try {
      v = Number(a.metric(profile)) || 0;
    } catch (e) {
      v = 0;
    }
    const got = profile.achievements[a.id];
    return {
      id: a.id,
      name: a.name,
      desc: a.desc,
      group: a.group,
      crystals: a.crystals,
      target: a.target,
      progress: Math.min(v, a.target),
      done: !!got,
      at: got ? got.at : null,
    };
  });
}

// ------------------------------------------------------------------------------------- XP scrolls

/** How many XP scrolls a hero can still use before her XP bar is full at the current cap. */
export function scrollsUseful(profile, heroId) {
  const e = profile.heroes[heroId];
  if (!e) return 0;
  const cap = levelCap(profile);
  if (e.level >= MAX_LEVEL) return 0;
  const target = cap >= MAX_LEVEL ? totalXpFor(MAX_LEVEL) : totalXpFor(cap) + xpToNext(cap);
  const have = totalXpFor(e.level) + e.xp;
  return Math.max(0, Math.ceil((target - have) / XP_SCROLL));
}

/**
 * Use XP scrolls on a hero («Повысить уровень»). `count` is limited to the scrolls owned and to
 * what the hero can absorb at the current cap (no scroll is wasted entirely).
 * -> { ok, error?: 'hero'|'scrolls'|'cap', profile, used, from, to, wasted, achievements }
 */
export function useXpScrolls(profileIn, heroId, count = 1, { now = Date.now() } = {}) {
  const profile = ensureProfile(profileIn);
  const e = profile.heroes[heroId];
  if (!e) return { ok: false, error: 'hero', profile, used: 0 };
  const want = Math.max(0, Math.floor(Number(count) || 0));
  if (!want || profile.xpScrolls <= 0) return { ok: false, error: 'scrolls', profile, used: 0 };
  const useful = scrollsUseful(profile, heroId);
  if (!useful) return { ok: false, error: 'cap', profile, used: 0 };
  const used = Math.min(want, profile.xpScrolls, useful);
  const p = cloneProfile(profile);
  const r = addXp(p.heroes[heroId], used * XP_SCROLL, levelCap(p));
  p.heroes[heroId].level = r.level;
  p.heroes[heroId].xp = r.xp;
  p.xpScrolls -= used;
  p.stats.xpScrollsUsed += used;
  p.updatedAt = now;
  const achievements = evaluateAchievements(p, now);
  return { ok: true, profile: p, used, from: r.from, to: r.to, wasted: r.wasted, achievements };
}

// ------------------------------------------------------------------------------------ Star Shop

const SHOP_STAR_RARITY = { 'epic-star': 'epic', 'legendary-star': 'legendary', 'mythic-star': 'mythic' };

/** Shop items (rules.js ECONOMY.shop) with names for the UI. Prices are in Stardust. */
export const SHOP = ECONOMY.shop.map((it) => ({
  ...it,
  name: {
    'xp-scroll': { ru: 'Свиток опыта', en: 'XP Scroll' },
    'summon-ticket': { ru: 'Билет призыва', en: 'Summon Ticket' },
    'epic-star': { ru: 'Звезда Созвездия (Эпическая)', en: 'Constellation Star (Epic)' },
    'legendary-star': { ru: 'Звезда Созвездия (Легендарная)', en: 'Constellation Star (Legendary)' },
    'mythic-star': { ru: 'Звезда Созвездия (Мифическая)', en: 'Constellation Star (Mythic)' },
  }[it.id] || { ru: it.id, en: it.id },
  rarity: SHOP_STAR_RARITY[it.id] || null,
}));
const SHOP_BY_ID = Object.fromEntries(SHOP.map((s) => [s.id, s]));

/** Remaining weekly purchases of an item (Infinity when unlimited). */
export function shopRemaining(profile, itemId, now = Date.now()) {
  const it = SHOP_BY_ID[itemId];
  if (!it) return 0;
  if (!it.weeklyLimit) return Infinity;
  const used = profile.weekly.week === weekKey(now) ? profile.weekly.tickets : 0;
  return Math.max(0, it.weeklyLimit - used);
}

/**
 * Buy from the Star Shop with Stardust. Constellation stars need `heroId` (an owned hero of the
 * item's rarity below C6). -> { ok, error?: 'item'|'dust'|'limit'|'hero'|'maxed', profile, achievements }
 */
export function shopBuy(profileIn, itemId, { heroId, now = Date.now() } = {}) {
  const profile = ensureProfile(profileIn);
  const it = SHOP_BY_ID[itemId];
  if (!it) return { ok: false, error: 'item', profile };
  if (profile.dust < it.price) return { ok: false, error: 'dust', profile };
  if (shopRemaining(profile, itemId, now) <= 0) return { ok: false, error: 'limit', profile };
  if (it.rarity) {
    const e = profile.heroes[heroId];
    if (!e || !HERO_BY_ID[heroId] || HERO_BY_ID[heroId].rarity !== it.rarity) return { ok: false, error: 'hero', profile };
    if (e.constellation >= 6) return { ok: false, error: 'maxed', profile };
  }
  const p = cloneProfile(profile);
  rollWeekly(p, now);
  p.dust -= it.price;
  if (it.gives.xpScrolls) p.xpScrolls += it.gives.xpScrolls;
  if (it.gives.pulls) {
    p.tickets += it.gives.pulls;
    p.weekly.tickets += 1;
  }
  if (it.rarity) p.heroes[heroId].constellation += 1;
  p.updatedAt = now;
  const achievements = evaluateAchievements(p, now);
  return { ok: true, profile: p, achievements };
}

/** Stardust value of one surplus copy (after C6) by rarity. */
export function dustForDuplicate(rarity) {
  return (RARITIES[rarity] && RARITIES[rarity].dupDustAfterC6) || 0;
}
