// «Валькирии доски» — meta layer: profile & save, collection, «Призыв» gacha, progression,
// campaign, economy, training / duel setup and battle results (GDD §11–16, docs/RPG-ARCHITECTURE.md).
//
// Pure and deterministic: every function that changes the profile returns a NEW profile and never
// mutates its input; randomness comes from a seed / injectable RNG (the profile persists its own
// summon and battle seeds). No DOM, no timers — usable in Node tests and the AI worker.
//
// Contract API
//   loadProfile(storage?) -> Profile                 saveProfile(profile, storage?) -> boolean
//   summon(profile, 1|10, seed|opts?) -> { ok, error?, results, profile, best, banner, cost, achievements }
//   canSummon(profile, count) · SUMMON_COST {1: 160, 10: 1600}
//   STAGES · stageById(id) · enemySquad(stage, profile?) -> Squad · isUnlocked(profile, stageId)
//   applyBattleResult(profile, { stageId?, mode, result, squad, stats, state?, events?, enemyLevel?, now?, battleId? })
//     -> { profile, rewards: { crystals, xp: {heroId: n}, levelUps, firstClear, stars, … } }
//   heroPower(profile, heroId) · setSquad(profile, ids) -> Profile · claimDaily(profile, now) -> { profile, rewards, newDay, status }
//
// Profile (v1): { v, createdAt, updatedAt, crystals, dust, xpScrolls, tickets,
//   heroes: { [id]: { level, xp, constellation, copies, obtainedAt, seen } }, squad: [id ≤ 6],
//   formation: { heroId: sq }, presets: [ { name, squad, formation } | null ] ×3,
//   campaign: { [stageId]: { stars, cleared, clears, attempts, lossStreak, bestRounds } },
//   pity: { sinceEpicPlus, sinceLegendaryPlus, legendaryStreak, novicePulls, noviceLegendary, total },
//   history: [{ id, r, n, t }] (last 100 pulls), daily: { day, firstBattle, repeatCrystals, tasks },
//   weekly: { week, tickets }, stats: {…, reactionKinds}, achievements: { id: { at } },
//   seeds: { summon, battle }, recentBattles, firstRun, flags }

export {
  PROFILE_KEY, BACKUP_KEY, PROFILE_VERSION, MIGRATIONS, HERO_IDS,
  createProfile, cloneProfile, ensureProfile, sanitizeProfile, migrateProfile, loadProfile, loadProfileReport, saveProfile,
  clearProfile, serializeProfile, parseStored, exportProfile, importProfile, createMemoryStorage, defaultStorage,
  completeFirstRun, setFlag,
} from './profile.js';

export {
  SUMMON_COST, SUMMON_COUNTS, SUMMON_RATES, BANNERS, HEROES_BY_RARITY,
  summon, canSummon, summonCost, bannerFor, noviceAvailable, pityStatus, pullChances, rollRarity, pickHero, emptyPity,
} from './gacha.js';

export {
  STAGES, STAGE_IDS, CHAPTERS, stageById, chapterOf, enemySquad, enemyPower, recommendedPower, isUnlocked, isCleared,
  isChapterUnlocked, nextStage, computeStars, starConditions, chapterProgress, campaignProgress, stageRecord,
  canAutoBattle, stageAdvice, squareIndex, squareName, deploySquares,
} from './campaign.js';

export {
  MAX_LEVEL, XP_SCROLL, LEVEL_CAPS, xpToNext, battleXp, totalXpFor, levelCap, nextLevelCap, addXp, xpProgress,
  heroStatsAt, constellationMods, powerAt, heroPower, squadPower, lineupPower,
} from './progression.js';

export {
  DAILY_TASKS, DAILY_FIRST_BATTLE, REPEAT_WIN, REPEAT_DAILY_CAP, ACHIEVEMENTS, ACHIEVEMENT_BY_ID, ACHIEVEMENTS_TOTAL, SHOP,
  claimDaily, dailyStatus, achievementStatus, useXpScrolls, scrollsUseful, shopBuy, shopRemaining, dayKey, weekKey,
  dustForDuplicate,
} from './economy.js';

export { applyBattleResult, normalizeBattleStats, statsFromEvents, battleMvp } from './battle-result.js';

export {
  BACKGROUNDS, DIFFICULTIES, TRAINING_LINEUPS, DUEL_DRAFT_ORDER, DUEL_DEFAULT_LEVEL,
  squadFor, setSquad, validateSquad, setFormation, autoFormation, savePreset, loadPreset, battleSeed,
  campaignSetup, trainingSetup, createDuelDraft, draftCurrent, draftOptions, draftPick, draftAutoPick, draftDone, duelSetup,
} from './modes.js';

export { heroView, collectionView, collectionSummary, markHeroSeen } from './collection.js';

export { createRng, toRng, mixSeed, fnv1a } from './rng.js';
