// Battle setup helpers: the player's Squad from the profile, campaign / training / duel setups
// (GDD §14, §16) and the squad-management mutators (setSquad, formation, presets).
//
// A setup is exactly what the UI's 'start-battle' event and createBattle() need:
//   { ok, mode, stageId?, stage?, squads: { 1: Squad, [-1]: Squad }, difficulty, first, bg, seed, … }
// Squad = [{ heroId, level, constellation, sq? }]; enemies also carry reflection / elite / boss /
// miniBoss / hpMult / mirror flags. Everything random is seeded (deterministic).

import { BOARD, BATTLE, CAMPAIGN, SIDE_MODES } from '../data/rules.js';
import { HEROES, HERO_BY_ID } from '../data/heroes.js';
import { createRng, mixSeed, toRng } from './rng.js';
import { cloneProfile, ensureProfile, sanitizeSquadIds, sanitizeFormation, PRESET_COUNT } from './profile.js';
import { stageById, enemySquad, isUnlocked, CHAPTERS, STAGES, deploySquares } from './campaign.js';
import { clampInt, MAX_LEVEL } from './progression.js';

export const BACKGROUNDS = CAMPAIGN.map((c) => c.bg);
export const DIFFICULTIES = SIDE_MODES.training.ai.slice(); // ['easy', 'normal', 'hard']
export const TRAINING_LINEUPS = SIDE_MODES.training.enemySquad.slice(); // random | chapterPreset | mirror | custom
export const DUEL_DEFAULT_LEVEL = 20;
export const ALL_HERO_IDS = HEROES.map((h) => h.id);

// ------------------------------------------------------------------------------- player squad

/**
 * The player's Squad for createBattle: [{ heroId, level, constellation, sq? }]. `sq` comes from the
 * saved formation and is only set when EVERY member has a distinct valid deploy square (otherwise
 * the engine's default deployment is used for the whole squad).
 */
export function squadFor(profile, ids = profile.squad, { formation = profile.formation } = {}) {
  const valid = sanitizeSquadIds(ids, profile.heroes);
  const form = sanitizeFormation(formation, valid);
  const complete = valid.length > 0 && valid.every((id) => form[id] !== undefined);
  return valid.map((id) => {
    const e = profile.heroes[id];
    const u = { heroId: id, level: e.level, constellation: e.constellation };
    if (complete) u.sq = form[id];
    return u;
  });
}

/**
 * Contract API: set the squad (≤ 6 owned, unique heroes, order kept). Invalid / unowned ids are
 * dropped; an empty result keeps the old squad. The formation keeps only members' squares.
 * Pure: returns a NEW profile.
 */
export function setSquad(profileIn, ids) {
  const profile = ensureProfile(profileIn);
  const squad = sanitizeSquadIds(ids, profile.heroes);
  const p = cloneProfile(profile);
  if (!squad.length) return p;
  p.squad = squad;
  p.formation = sanitizeFormation(p.formation, squad);
  return p;
}

/** Validation details for the squad screen. -> { ok, ids, errors: ['empty'|'unowned:<id>'|'duplicate:<id>'|'too-many'] } */
export function validateSquad(profile, ids) {
  const errors = [];
  const seen = new Set();
  for (const x of Array.isArray(ids) ? ids : []) {
    const id = typeof x === 'string' ? x : x && x.heroId;
    if (!profile.heroes[id]) errors.push(`unowned:${id}`);
    else if (seen.has(id)) errors.push(`duplicate:${id}`);
    seen.add(id);
  }
  if (Array.isArray(ids) && ids.length > BOARD.squadSize) errors.push('too-many');
  const clean = sanitizeSquadIds(ids, profile.heroes);
  if (!clean.length) errors.push('empty');
  return { ok: errors.length === 0, ids: clean, errors };
}

/** Set the deployment { heroId: sq } of the current squad (player rows 6–7, dark squares). */
export function setFormation(profile, formation) {
  const p = cloneProfile(profile);
  p.formation = sanitizeFormation(formation, p.squad);
  return p;
}

/**
 * «Авто» deployment (GDD §3.1): Guardians and Blades in front (row 6), Rangers, Mystics and Oracles
 * behind (row 7), Shadows fill the remaining slots; centre files first.
 */
export function autoFormation(profile, ids = profile.squad) {
  const squad = sanitizeSquadIds(ids, profile.heroes);
  const front = deploySquares(1).filter((sq) => Math.floor(sq / BOARD.size) === BOARD.deployRows.player[0]);
  const back = deploySquares(1).filter((sq) => Math.floor(sq / BOARD.size) === BOARD.deployRows.player[1]);
  const centre = (a, b) => Math.abs((a % BOARD.size) - 3.5) - Math.abs((b % BOARD.size) - 3.5);
  front.sort(centre);
  back.sort(centre);
  const rank = { guardian: 0, blade: 1, shadow: 2, ranger: 3, mystic: 4, oracle: 5 };
  const order = squad.slice().sort((a, b) => rank[HERO_BY_ID[a].role] - rank[HERO_BY_ID[b].role]);
  const out = {};
  for (const id of order) {
    const role = HERO_BY_ID[id].role;
    const wantsFront = role === 'guardian' || role === 'blade' || role === 'shadow';
    const list = wantsFront ? (front.length ? front : back) : back.length ? back : front;
    out[id] = list.shift();
  }
  return out;
}

/** Save the current squad + formation into preset slot 0..2. */
export function savePreset(profile, index, name = '') {
  const i = clampInt(index, 0, PRESET_COUNT - 1, 0);
  const p = cloneProfile(profile);
  p.presets[i] = { name: String(name || '').slice(0, 40), squad: p.squad.slice(), formation: { ...p.formation } };
  return p;
}

/** Load preset 0..2 as the current squad (unowned members are skipped). */
export function loadPreset(profile, index) {
  const pr = profile.presets[clampInt(index, 0, PRESET_COUNT - 1, 0)];
  if (!pr) return cloneProfile(profile);
  const p = setSquad(profile, pr.squad);
  p.formation = sanitizeFormation(pr.formation, p.squad);
  return p;
}

/** Seed for the next battle of this profile (deterministic; changes after every battle). */
export function battleSeed(profile, salt = '') {
  return mixSeed(profile.seeds.battle, salt, profile.stats.battles);
}

// ------------------------------------------------------------------------------------ campaign

/**
 * Campaign battle setup. -> { ok, error?: 'stage'|'locked'|'squad', mode: 'campaign', stageId, stage,
 * squads, difficulty (stage AI: 'easy'|'normal'|'hard'), boss, first (−1 on ambush stages), bg,
 * roundLimit, threeStarRounds, seed }
 */
export function campaignSetup(profile, stageId, { seed, ids, ignoreLock = false } = {}) {
  const stage = stageById(stageId);
  if (!stage) return { ok: false, error: 'stage' };
  if (!ignoreLock && !isUnlocked(profile, stageId)) return { ok: false, error: 'locked', stageId };
  const player = squadFor(profile, ids || profile.squad);
  if (!player.length) return { ok: false, error: 'squad', stageId };
  return {
    ok: true,
    mode: 'campaign',
    stageId,
    stage,
    squads: { 1: player, [-1]: enemySquad(stage, profile) },
    difficulty: stage.ai,
    boss: stage.boss,
    first: stage.first,
    bg: stage.bg,
    roundLimit: stage.roundLimit,
    threeStarRounds: stage.threeStarRounds,
    seed: Number.isFinite(seed) ? seed >>> 0 : battleSeed(profile, stageId),
  };
}

// ------------------------------------------------------------------------------------ training

function chapterForLevel(level) {
  const ch = CHAPTERS.find((c) => level >= c.levels[0] && level <= c.levels[1]);
  return ch ? ch.chapter : level < CHAPTERS[0].levels[0] ? 1 : CHAPTERS.length;
}

/**
 * «Тренировка» setup (GDD §16): enemy level 1–30, lineup 'random' | 'chapterPreset' | 'mirror' |
 * 'custom', AI 'easy' | 'normal' | 'hard', background. Enemies are C0 reflections at `level` with
 * normal rules (no boss / mini-boss multipliers). XP ×0.5 and the repeat-win crystals are applied
 * by applyBattleResult (mode 'training', pass `enemyLevel`).
 * opts: { level, lineup, chapter?, stageId? (preset source), custom?: [ids], difficulty, bg?, seed, ids? }
 */
export function trainingSetup(profile, opts = {}) {
  const level = clampInt(opts.level, 1, MAX_LEVEL, Math.min(MAX_LEVEL, Math.max(1, ...Object.values(profile.heroes).map((e) => e.level))));
  const lineup = TRAINING_LINEUPS.includes(opts.lineup) ? opts.lineup : 'random';
  const difficulty = DIFFICULTIES.includes(opts.difficulty) ? opts.difficulty : 'normal';
  const seed = Number.isFinite(opts.seed) ? opts.seed >>> 0 : battleSeed(profile, `training:${lineup}:${level}`);
  const rng = createRng(mixSeed(seed, 'lineup'));
  const player = squadFor(profile, opts.ids || profile.squad);
  if (!player.length) return { ok: false, error: 'squad' };

  let ids;
  let source = null;
  if (lineup === 'mirror') {
    ids = player.map((u) => u.heroId);
  } else if (lineup === 'custom') {
    ids = (Array.isArray(opts.custom) ? opts.custom : []).filter((id) => HERO_BY_ID[id]).slice(0, BOARD.squadSize);
    if (!ids.length) return { ok: false, error: 'custom' };
  } else if (lineup === 'chapterPreset') {
    const chapter = clampInt(opts.chapter, 1, CHAPTERS.length, chapterForLevel(level));
    const pool = STAGES.filter((s) => s.chapter === chapter && Array.isArray(s.enemies));
    const st = (opts.stageId && stageById(opts.stageId) && Array.isArray(stageById(opts.stageId).enemies) && stageById(opts.stageId)) || rng.pick(pool);
    source = st.id;
    ids = st.enemies.slice(0, BOARD.squadSize);
  } else {
    ids = rng.shuffle(ALL_HERO_IDS).slice(0, BOARD.squadSize);
  }
  const constellations = lineup === 'mirror' ? Object.fromEntries(player.map((u) => [u.heroId, u.constellation])) : {};
  const enemies = ids.map((id) => ({
    heroId: id,
    level,
    constellation: constellations[id] || 0,
    reflection: true,
    ...(lineup === 'mirror' ? { mirror: true } : {}),
  }));
  const bg = BACKGROUNDS.includes(opts.bg) ? opts.bg : CHAPTERS[chapterForLevel(level) - 1].bg;
  return {
    ok: true,
    mode: 'training',
    stage: null,
    squads: { 1: player, [-1]: enemies },
    difficulty,
    enemyLevel: level,
    lineup,
    lineupSource: source,
    first: 1,
    bg,
    roundLimit: BATTLE.roundLimit,
    seed,
  };
}

// ---------------------------------------------------------------------------------------- duel

/** Draft order 1-2-2-2-2-2-1 (GDD §16): picks per turn, players alternate starting with player 1. */
export const DUEL_DRAFT_ORDER = [1, 2, 2, 2, 2, 2, 1];

function draftSequence(firstPicker) {
  const seq = [];
  let who = firstPicker === 2 ? 2 : 1;
  for (const n of DUEL_DRAFT_ORDER) {
    for (let i = 0; i < n; i++) seq.push(who);
    who = who === 1 ? 2 : 1;
  }
  return seq;
}

/**
 * Start a duel draft from the phone owner's heroes (or all 24 with `allHeroes`). A hero may be
 * picked by both players (the second copy plays as a Reflection in that player's colours), but
 * not twice by the same player. -> Draft { pool, picks: { 1: [], 2: [] }, sequence, step, allHeroes }
 */
export function createDuelDraft(profile, { allHeroes = false, firstPicker = 1 } = {}) {
  const pool = allHeroes ? ALL_HERO_IDS.slice() : ALL_HERO_IDS.filter((id) => profile && profile.heroes[id]);
  return { pool, picks: { 1: [], 2: [] }, sequence: draftSequence(firstPicker), step: 0, allHeroes: !!allHeroes };
}

/** Whose pick it is (1 | 2), or null when the draft is complete. */
export function draftCurrent(draft) {
  return draft.step < draft.sequence.length ? draft.sequence[draft.step] : null;
}

/** Heroes the current picker may still take. */
export function draftOptions(draft) {
  const who = draftCurrent(draft);
  if (!who) return [];
  return draft.pool.filter((id) => !draft.picks[who].includes(id));
}

/** Pick a hero for the current player. Pure. -> { ok, error?: 'done'|'hero'|'taken', draft } */
export function draftPick(draft, heroId) {
  const who = draftCurrent(draft);
  if (!who) return { ok: false, error: 'done', draft };
  if (!draft.pool.includes(heroId)) return { ok: false, error: 'hero', draft };
  if (draft.picks[who].includes(heroId)) return { ok: false, error: 'taken', draft };
  const next = { ...draft, picks: { 1: draft.picks[1].slice(), 2: draft.picks[2].slice() }, step: draft.step + 1 };
  next.picks[who].push(heroId);
  return { ok: true, draft: next };
}

/** Random pick for the current player («Случайно»). */
export function draftAutoPick(draft, rngOrSeed) {
  const opts = draftOptions(draft);
  if (!opts.length) return { ok: false, error: 'done', draft };
  const rng = toRng(rngOrSeed, draft.step + 1);
  return draftPick(draft, rng.pick(opts));
}

export function draftDone(draft) {
  return draftCurrent(draft) === null;
}

/**
 * Duel setup («Дуэль», hot-seat). Player 1 = side 1 (bottom), player 2 = side −1.
 * opts: { draft | picks: { 1: [ids], 2: [ids] }, levelMode: 'equalized'|'owned', level = 20, seed,
 *         first?: 1|-1 (default: seeded coin toss), bg? }
 * Levels «выровнены» (default L20, C0) or «как в коллекции» (owned level/constellation; heroes not
 * owned use the equalized level, C0). Duels give no crystals and no XP.
 */
export function duelSetup(profile, opts = {}) {
  const picks = opts.draft ? opts.draft.picks : opts.picks || {};
  const p1 = (picks[1] || []).filter((id) => HERO_BY_ID[id]);
  const p2 = (picks[2] || []).filter((id) => HERO_BY_ID[id]);
  if (!p1.length || !p2.length) return { ok: false, error: 'picks' };
  const levelMode = opts.levelMode === 'owned' ? 'owned' : 'equalized';
  const level = clampInt(opts.level, 1, MAX_LEVEL, DUEL_DEFAULT_LEVEL);
  const seed = Number.isFinite(opts.seed) ? opts.seed >>> 0 : battleSeed(profile, 'duel');
  const rng = createRng(mixSeed(seed, 'duel'));
  const make = (ids, other, isSecond) =>
    [...new Set(ids)].slice(0, BOARD.squadSize).map((id) => {
      const e = levelMode === 'owned' && profile && profile.heroes[id];
      const u = { heroId: id, level: e ? e.level : level, constellation: e ? e.constellation : 0 };
      if (isSecond && other.includes(id)) u.reflection = true;
      return u;
    });
  const coin = rng() < 0.5 ? 1 : -1;
  return {
    ok: true,
    mode: 'duel',
    stage: null,
    squads: { 1: make(p1, p2, false), [-1]: make(p2, p1, true) },
    difficulty: null,
    first: opts.first === 1 || opts.first === -1 ? opts.first : coin,
    levelMode,
    level,
    bg: BACKGROUNDS.includes(opts.bg) ? opts.bg : rng.pick(BACKGROUNDS),
    roundLimit: BATTLE.roundLimit,
    seed,
  };
}
