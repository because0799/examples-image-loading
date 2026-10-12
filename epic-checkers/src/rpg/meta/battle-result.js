// Applying a finished battle to the profile: stage records and stars, first-clear / ★★★ / repeat
// crystals, the daily first-battle bonus and daily tasks, XP for the squad and the bench, level-cap
// raises after chapter bosses, battle statistics and achievements (GDD §11, §13, §14, §16).
//
// The battle's facts are read from whatever the caller has (most reliable first):
//   stats  — explicit numbers (BattleStats below; also accepts per-side { 1: {...}, -1: {...} })
//   events — the full event log of the battle (contract vocabulary: ko, reaction, cast, awaken, jump…)
//   state  — the final BattleState (state.units with side / alive / heroId, state.round)
//   result — battleResult(state): { winner, reason, rounds, stats }
// BattleStats (player side): { rounds, lost (alias heroesLost / kosTaken), alive, kos, reactions |
//   reactionKinds, ults, awakenings, maxChain, mvp }; any value may also be given per side
//   ({ 1: x, -1: y }). Without `stats.lost`, `events` or `state`, losses count as 0 (★★★ then only
//   depends on the round count) — pass the final state or the event log for exact stars.

import { ECONOMY, PROGRESSION, battleXp } from '../data/rules.js';
import { HERO_BY_ID } from '../data/heroes.js';
import { cloneProfile, ensureProfile, REACTION_IDS, RECENT_BATTLES } from './profile.js';
import { stageById, computeStars } from './campaign.js';
import { addXp, applyLevelCap, levelCap, LEVEL_CAPS } from './progression.js';
import { credit, rollDaily, claimDailyTasks, evaluateAchievements, DAILY_TASKS, sumItems } from './economy.js';

const MODES = ['campaign', 'training', 'duel'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const n0 = (v) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : null);
/** A value that may be given per side ({ 1: x, -1: y } / { player: x }) resolved for `side`. */
const forSide = (v, side) => {
  if (!isObj(v)) return v;
  if (String(side) in v) return v[String(side)];
  if (side === 1 && 'player' in v) return v.player;
  if (side === -1 && 'enemy' in v) return v.enemy;
  return v;
};

function isHeroUnit(u) {
  return !!u && !!HERO_BY_ID[u.heroId] && !u.ward && u.kind !== 'ward' && u.type !== 'ward';
}

function winnerOf(result) {
  if (result === null || result === undefined) return null;
  if (typeof result === 'number') return result > 0 ? 1 : result < 0 ? -1 : 0;
  if (typeof result === 'string') {
    const s = result.toLowerCase();
    if (s === 'win' || s === 'victory' || s === 'won') return 1;
    if (s === 'draw' || s === 'tie') return 0;
    return -1; // loss / defeat / surrender / resign
  }
  if (isObj(result)) {
    if (typeof result.winner === 'number') return result.winner > 0 ? 1 : result.winner < 0 ? -1 : 0;
    if (typeof result.won === 'boolean') return result.won ? 1 : -1;
  }
  return null;
}

/** Pick the player-side block of a stats object that may be per-side ({ 1: {...}, -1: {...} }). */
function sideStats(stats, side) {
  if (!isObj(stats)) return {};
  const s = stats[side] || stats[String(side)];
  if (isObj(s)) return { ...stats, ...s };
  if (side === 1 && isObj(stats.player)) return { ...stats, ...stats.player };
  return stats;
}

function readReactions(src, side) {
  const kinds = {};
  let total = null;
  const r = forSide(src.reactionKinds || src.reactionsByKind || src.reactions, side);
  if (isObj(r)) {
    total = 0;
    for (const [k, v] of Object.entries(r)) {
      const c = n0(v) || 0;
      if (REACTION_IDS.includes(k)) kinds[k] = (kinds[k] || 0) + c;
      total += c;
    }
  } else if (Array.isArray(r)) {
    total = r.length;
    for (const k of r) if (REACTION_IDS.includes(k)) kinds[k] = (kinds[k] || 0) + 1;
  }
  const flat = forSide(src.reactions, side);
  if (typeof flat === 'number') total = n0(flat);
  return { total, kinds };
}

/** Facts derived from the event log (player = `side`). */
export function statsFromEvents(events, { state = null, side = 1 } = {}) {
  const out = { kos: 0, lostIds: new Set(), reactions: 0, reactionKinds: {}, ults: 0, awakenings: 0, maxChain: 0, rounds: 0, damage: {}, heal: {} };
  if (!Array.isArray(events)) return out;
  const sideOf = new Map();
  const heroUnit = new Map();
  if (state && Array.isArray(state.units)) {
    for (const u of state.units) {
      sideOf.set(u.id, u.side);
      heroUnit.set(u.id, isHeroUnit(u));
    }
  }
  if (state && Array.isArray(state.wards)) {
    for (const w of state.wards) {
      if (w && w.id !== undefined && !sideOf.has(w.id)) {
        sideOf.set(w.id, w.side);
        heroUnit.set(w.id, false);
      }
    }
  }
  let turnSide = null;
  let chain = new Map();
  const unitSide = (id) => (sideOf.has(id) ? sideOf.get(id) : turnSide);
  for (const e of events) {
    if (!e || typeof e.type !== 'string') continue;
    switch (e.type) {
      case 'turnStart':
        turnSide = e.side;
        chain = new Map();
        if (Number.isFinite(e.round)) out.rounds = Math.max(out.rounds, e.round);
        break;
      case 'roundEnd':
        if (Number.isFinite(e.round)) out.rounds = Math.max(out.rounds, e.round);
        break;
      case 'jump':
        if (unitSide(e.unit) === side) {
          const c = (chain.get(e.unit) || 0) + 1;
          chain.set(e.unit, c);
          out.maxChain = Math.max(out.maxChain, c);
        }
        break;
      case 'move':
      case 'cast':
        if (e.unit !== undefined) chain.delete(e.unit);
        if (e.type === 'cast' && e.kind === 'ult' && unitSide(e.unit) === side) out.ults++;
        break;
      case 'reaction': {
        // the reaction is triggered by the side hitting the target (its enemy)
        const tSide = sideOf.has(e.target) ? sideOf.get(e.target) : -turnSide;
        if (tSide === -side) {
          out.reactions++;
          if (REACTION_IDS.includes(e.reaction)) out.reactionKinds[e.reaction] = (out.reactionKinds[e.reaction] || 0) + 1;
        }
        break;
      }
      case 'awaken':
        if (unitSide(e.unit) === side) out.awakenings++;
        break;
      case 'ko': {
        const known = sideOf.has(e.unit);
        if (known && heroUnit.get(e.unit) === false) break; // wards / props
        const s = known ? sideOf.get(e.unit) : null;
        if (s === side) out.lostIds.add(e.unit);
        else if (s === -side || (!known && turnSide === side)) out.kos++;
        break;
      }
      case 'damage':
        if (unitSide(e.source) === side && Number.isFinite(e.amount)) out.damage[e.source] = (out.damage[e.source] || 0) + e.amount;
        break;
      case 'heal':
        if (unitSide(e.source) === side && Number.isFinite(e.amount)) out.heal[e.source] = (out.heal[e.source] || 0) + e.amount;
        break;
      default:
        break;
    }
  }
  return out;
}

/**
 * MVP of a side: the hero with the most damage dealt + healing done in the event log (ties: the
 * earlier unit); without such events the first surviving hero. -> heroId | null
 */
export function battleMvp(state, events, side = 1) {
  const units = state && Array.isArray(state.units) ? state.units.filter((u) => u.side === side && isHeroUnit(u)) : [];
  const ev = statsFromEvents(events, { state, side });
  let best = null;
  let bestScore = -1;
  for (const u of units) {
    const score = (ev.damage[u.id] || 0) + (ev.heal[u.id] || 0);
    if (score > bestScore) {
      best = u;
      bestScore = score;
    }
  }
  if (best && bestScore > 0) return best.heroId;
  const alive = units.find((u) => u.alive !== false);
  return alive ? alive.heroId : units[0] ? units[0].heroId : null;
}

/**
 * Normalised facts of a finished battle for `side` (default: the player, side 1).
 * -> { winner, won, draw, surrendered, rounds, lost, alive, squadSize, kos, reactions,
 *      reactionKinds, ults, awakenings, maxChain, mvp }
 */
export function normalizeBattleStats({ result = null, stats = null, state = null, events = null, side = 1 } = {}) {
  const explicit = sideStats(stats, side);
  const fromResult = sideStats(result && result.stats, side);
  const ev = statsFromEvents(events, { state, side });
  const units = state && Array.isArray(state.units) ? state.units.filter((u) => u.side === side && isHeroUnit(u)) : [];

  let winner = winnerOf(result);
  if (winner === null && stats && 'winner' in stats) winner = winnerOf({ winner: stats.winner });
  if (winner !== null && side !== 1) winner = winner === 0 ? 0 : winner === side ? 1 : -1;
  const reason = (result && typeof result.reason === 'string' && result.reason) || (typeof result === 'string' ? result : '');
  const surrendered = /surrender|resign|forfeit/i.test(reason);

  const pick = (...vals) => {
    for (const v of vals) {
      const x = n0(forSide(v, side));
      if (x !== null) return x;
    }
    return null;
  };
  const rounds = n0(result && result.rounds) ?? n0(explicit.rounds) ?? n0(fromResult.rounds) ?? n0(state && state.round) ?? ev.rounds ?? 0;

  const lostState = units.length ? units.filter((u) => u.alive === false || (Number.isFinite(u.hp) && u.hp <= 0)).length : null;
  const lostEvents = Array.isArray(events) ? ev.lostIds.size : null;
  const lostExplicit = pick(
    explicit.lost, explicit.heroesLost, explicit.kosTaken, explicit.koTaken,
    fromResult.lost, fromResult.heroesLost, fromResult.kosTaken, fromResult.koTaken,
  );
  let lost = lostExplicit;
  if (lost === null) lost = Math.max(lostState || 0, lostEvents || 0);
  const squadSize = units.length || pick(explicit.squadSize, fromResult.squadSize) || 0;
  let alive = pick(explicit.alive, fromResult.alive);
  if (alive === null) alive = units.length ? units.filter((u) => u.alive !== false && !(Number.isFinite(u.hp) && u.hp <= 0)).length : squadSize ? Math.max(0, squadSize - lost) : null;

  const rx = readReactions(explicit, side);
  const rxr = readReactions(fromResult, side);
  const reactions = rx.total !== null ? rx.total : rxr.total !== null ? rxr.total : ev.reactions;
  const reactionKinds = Object.keys(rx.kinds).length ? rx.kinds : Object.keys(rxr.kinds).length ? rxr.kinds : ev.reactionKinds;

  return {
    winner,
    won: winner === 1,
    draw: winner === 0,
    surrendered,
    rounds,
    lost,
    alive,
    squadSize,
    kos: pick(explicit.kos, explicit.kills, fromResult.kos, fromResult.kills) ?? ev.kos,
    reactions: reactions || 0,
    reactionKinds,
    ults: pick(explicit.ults, explicit.ultimates, fromResult.ults, fromResult.ultimates) ?? ev.ults,
    awakenings: pick(explicit.awakenings, explicit.awakens, fromResult.awakenings, fromResult.awakens) ?? ev.awakenings,
    maxChain: pick(explicit.maxChain, explicit.longestChain, fromResult.maxChain, fromResult.longestChain) ?? ev.maxChain,
    mvp: (typeof explicit.mvp === 'string' && explicit.mvp) || (state ? battleMvp(state, events, side) : null),
  };
}

function squadIdsOf(squad, p) {
  const src = Array.isArray(squad) ? squad : p.squad;
  const out = [];
  for (const x of src) {
    const id = typeof x === 'string' ? x : x && x.heroId;
    if (id && p.heroes[id] && !out.includes(id)) out.push(id);
  }
  return out;
}

function enemyLevelOf({ enemyLevel, state, enemySquad }) {
  const lv = n0(enemyLevel);
  if (lv) return Math.min(PROGRESSION.maxLevel, lv);
  const src = Array.isArray(enemySquad)
    ? enemySquad
    : state && Array.isArray(state.units)
      ? state.units.filter((u) => u.side === -1 && isHeroUnit(u))
      : [];
  const levels = src.map((u) => n0(u.level)).filter((x) => x);
  if (!levels.length) return 1;
  return Math.round(levels.reduce((a, b) => a + b, 0) / levels.length);
}

/**
 * Contract API. Apply a finished battle to the profile (pure: returns a NEW profile).
 * input: { stageId?, mode: 'campaign'|'training'|'duel', result, squad?, stats?, state?, events?,
 *          enemyLevel? (training), enemySquad?, now?, battleId? (dedupe), autoClaim? = true }
 * -> { profile, rewards: { mode, stageId, won, draw, crystals, xpScrolls, dust, xp: {heroId: n},
 *      xpDetail: {heroId: { amount, gained, from, to, xp, need }}, levelUps: [{ heroId, from, to }],
 *      firstClear, stars, bestStars, prevStars, threeStarChest, repeat, dailyFirst, capRaised,
 *      items: [{ kind, id?, crystals?, xpScrolls?, label }], achievements: [ids], battle: facts,
 *      duplicate?, error? } }
 */
export function applyBattleResult(profileIn, input = {}) {
  const profile = ensureProfile(profileIn);
  const now = Number.isFinite(input.now) ? input.now : Date.now();
  const mode = MODES.includes(input.mode) ? input.mode : input.stageId ? 'campaign' : 'training';
  const facts = normalizeBattleStats(input);
  const rewards = {
    mode,
    stageId: input.stageId || null,
    won: facts.won,
    draw: facts.draw,
    crystals: 0,
    xpScrolls: 0,
    dust: 0,
    xp: {},
    xpDetail: {},
    levelUps: [],
    firstClear: false,
    stars: 0,
    bestStars: 0,
    prevStars: 0,
    threeStarChest: false,
    repeat: 0,
    dailyFirst: false,
    capRaised: null,
    items: [],
    achievements: [],
    battle: facts,
  };
  const battleId = input.battleId !== undefined && input.battleId !== null ? String(input.battleId) : null;
  if (battleId && profile.recentBattles.includes(battleId)) return { profile, rewards: { ...rewards, duplicate: true } };

  let stage = null;
  if (mode === 'campaign') {
    stage = stageById(input.stageId);
    if (!stage) return { profile, rewards: { ...rewards, error: 'stage' } };
  }

  const p = cloneProfile(profile);
  const items = [];
  rollDaily(p, now);

  // ---- statistics
  const st = p.stats;
  st.battles++;
  if (facts.won) st.wins++;
  else if (facts.draw) st.draws++;
  else st.losses++;
  if (facts.surrendered) st.surrenders++;
  if (mode === 'duel') {
    st.duels++;
  } else {
    if (mode === 'campaign') {
      st.campaignBattles++;
      if (facts.won) st.campaignWins++;
    } else {
      st.trainingBattles++;
      if (facts.won) st.trainingWins++;
    }
    st.kos += facts.kos;
    st.heroesLost += facts.lost;
    st.reactions += facts.reactions;
    for (const [k, v] of Object.entries(facts.reactionKinds || {})) if (REACTION_IDS.includes(k)) st.reactionKinds[k] += v;
    st.ults += facts.ults;
    st.awakenings += facts.awakenings;
    st.maxChain = Math.max(st.maxChain, facts.maxChain);
    if (facts.won && facts.lost === 0) st.flawlessWins++;
    if (facts.won && facts.alive === 1) st.lastStandWins++;
  }

  let firstClear = false;
  if (mode !== 'duel') {
    // ---- stage record, stars, stage crystals
    const capBefore = levelCap(p);
    if (stage) {
      const rec = p.campaign[stage.id] || { stars: 0, cleared: false, clears: 0, attempts: 0, lossStreak: 0, bestRounds: 0 };
      p.campaign[stage.id] = rec;
      rec.attempts++;
      rewards.prevStars = rec.stars;
      if (facts.won) {
        const stars = computeStars({ won: true, lost: facts.lost, rounds: facts.rounds, threeStarRounds: stage.threeStarRounds });
        firstClear = !rec.cleared;
        rec.cleared = true;
        rec.clears++;
        rec.lossStreak = 0;
        if (facts.rounds > 0) rec.bestRounds = rec.bestRounds ? Math.min(rec.bestRounds, facts.rounds) : facts.rounds;
        rewards.stars = stars;
        if (firstClear) {
          const fc = stage.rewards.firstClear;
          items.push({ kind: 'firstClear', crystals: fc.crystals, xpScrolls: fc.xpScrolls, label: { ru: 'Первое прохождение', en: 'First clear' } });
          rewards.firstClear = true;
        } else {
          items.push(...repeatReward(p));
        }
        if (stars >= 3 && rec.stars < 3) {
          items.push({ kind: 'threeStar', crystals: stage.rewards.threeStar, label: { ru: 'Сундук ★★★', en: '★★★ chest' } });
          rewards.threeStarChest = true;
        }
        rec.stars = Math.max(rec.stars, stars);
      } else if (!facts.draw) {
        rec.lossStreak++;
      }
      rewards.bestStars = rec.stars;
    } else if (mode === 'training' && facts.won) {
      items.push(...repeatReward(p));
    }

    // ---- daily first battle
    if (!p.daily.firstBattle) {
      p.daily.firstBattle = true;
      items.push({ kind: 'dailyFirst', crystals: ECONOMY.firstBattleOfDay, label: { ru: 'Первый бой дня', en: 'First battle of the day' } });
      rewards.dailyFirst = true;
    }

    // ---- level cap raise (chapter boss) — before this battle's XP so it is not wasted
    const capAfter = levelCap(p);
    const levelUps = new Map();
    if (capAfter > capBefore) {
      rewards.capRaised = { from: capBefore, to: capAfter, stageId: (LEVEL_CAPS.find((c) => c.cap === capAfter) || {}).stageId || null };
      for (const [id, e] of Object.entries(p.heroes)) {
        const r = applyLevelCap(e, capAfter);
        if (r.level !== e.level) levelUps.set(id, { heroId: id, from: e.level, to: r.level });
        e.level = r.level;
        e.xp = r.xp;
      }
    }

    // ---- XP: squad full share, bench 30 %
    const level = stage ? stage.level : enemyLevelOf(input);
    let mult = 1;
    if (stage && firstClear) mult *= PROGRESSION.firstClearMult;
    if (mode === 'training') mult *= PROGRESSION.trainingMult;
    if (!facts.won) mult *= PROGRESSION.lossMult;
    const base = battleXp(level) * mult;
    const squadIds = squadIdsOf(input.squad, p);
    for (const [id, e] of Object.entries(p.heroes)) {
      const amount = Math.round(squadIds.includes(id) ? base : base * PROGRESSION.benchShare);
      const r = addXp(e, amount, capAfter);
      const prev = levelUps.get(id);
      if (r.to > r.from) levelUps.set(id, { heroId: id, from: prev ? prev.from : r.from, to: r.to });
      e.level = r.level;
      e.xp = r.xp;
      rewards.xp[id] = amount;
      rewards.xpDetail[id] = { amount, gained: r.gained, from: prev ? prev.from : r.from, to: r.to, xp: r.xp, inSquad: squadIds.includes(id) };
    }
    rewards.levelUps = [...levelUps.values()];
    rewards.enemyLevel = level;

    // ---- daily tasks
    for (const t of DAILY_TASKS) {
      const add = t.kind === 'wins' ? (facts.won ? 1 : 0) : t.kind === 'reactions' ? facts.reactions : t.kind === 'ults' ? facts.ults : 0;
      if (add > 0) p.daily.tasks[t.id].progress = Math.min(1e6, p.daily.tasks[t.id].progress + add);
    }
  }

  // ---- credit stage/daily items, then tasks and achievements (they credit themselves)
  for (const it of items) credit(p, it);
  if (mode !== 'duel' && input.autoClaim !== false) items.push(...claimDailyTasks(p));
  const ach = evaluateAchievements(p, now);
  items.push(...ach);
  rewards.achievements = ach.map((a) => a.id);
  const sum = sumItems(items);
  rewards.crystals = sum.crystals;
  rewards.xpScrolls = sum.xpScrolls;
  rewards.dust = sum.dust;
  rewards.repeat = items.filter((i) => i.kind === 'repeat').reduce((a, i) => a + i.crystals, 0);
  rewards.items = items;

  if (battleId) {
    p.recentBattles.push(battleId);
    if (p.recentBattles.length > RECENT_BATTLES) p.recentBattles.splice(0, p.recentBattles.length - RECENT_BATTLES);
  }
  p.updatedAt = now;
  return { profile: p, rewards };
}

/** Repeat-win crystals (stage replays and Training) under the shared daily cap; mutates p.daily. */
function repeatReward(p) {
  const room = ECONOMY.repeatDailyCap - p.daily.repeatCrystals;
  const c = Math.max(0, Math.min(ECONOMY.repeatWin, room));
  if (!c) return [];
  p.daily.repeatCrystals += c;
  return [{ kind: 'repeat', crystals: c, label: { ru: 'Повторная победа', en: 'Repeat victory' } }];
}
