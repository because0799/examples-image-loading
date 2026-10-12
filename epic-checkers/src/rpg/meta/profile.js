// Player profile + persistence for «Валькирии доски».
//
// Storage (GDD §20): localStorage key `ec.rpg.v1`, value = JSON envelope
//   { fmt: 'ec.rpg', v: <profile version>, savedAt, sum: <FNV-1a of body>, body: <profile JSON> }
// Every successful save first copies the previous VALID save to `ec.rpg.v1.bak`, so a torn or
// corrupted write can always fall back one save. Loading never throws:
//   main ok → 'ok' / 'migrated'; main bad + backup ok → 'backup'; checksum mismatch but JSON readable
//   → 'salvaged' (field-by-field sanitising keeps what is valid); nothing readable → fresh profile
//   ('reset', the unreadable text is kept under `ec.rpg.v1.corrupt` for diagnostics) or 'new'.
// A save written by a NEWER app version is loaded best-effort ('newer') and its raw text is kept
// under `ec.rpg.v1.future` before anything overwrites it.
//
// Migrations: MIGRATIONS[n] upgrades a raw profile object from version n to n + 1. Version 0 is an
// unversioned plain profile object (dev builds / hand-made fixtures, stored without an envelope).
// After migrating, sanitizeProfile() validates every field, so a migration only has to rename and
// restructure.
//
// All profile functions in src/rpg/meta are PURE: they never mutate the profile they receive and
// return a new one.

import { ECONOMY, GACHA, BOARD } from '../data/rules.js';
import { HERO_BY_ID, HEROES } from '../data/heroes.js';
import { fnv1a, randomSeed } from './rng.js';
import { STAGE_IDS, deploySquares } from './campaign.js';
import { levelCap, xpLimit, clampInt, MAX_LEVEL } from './progression.js';

export const PROFILE_KEY = 'ec.rpg.v1';
export const BACKUP_KEY = PROFILE_KEY + '.bak';
export const CORRUPT_KEY = PROFILE_KEY + '.corrupt';
export const FUTURE_KEY = PROFILE_KEY + '.future';
export const PROFILE_VERSION = 1;
export const HISTORY_LIMIT = 100;
export const PRESET_COUNT = 3;
export const RECENT_BATTLES = 8;

const ENVELOPE_FMT = 'ec.rpg';
const MAX_CURRENCY = 1e9;

export const STAT_KEYS = [
  'battles', 'wins', 'losses', 'draws', 'surrenders',
  'campaignBattles', 'campaignWins', 'trainingBattles', 'trainingWins', 'duels',
  'kos', 'heroesLost', 'reactions', 'ults', 'awakenings', 'maxChain', 'flawlessWins', 'lastStandWins',
  'summons', 'epicPulls', 'legendaryPulls', 'mythicPulls',
  'crystalsEarned', 'crystalsSpent', 'dustEarned', 'xpScrollsUsed',
];
export const REACTION_IDS = ['steam', 'detonation', 'shackles', 'arc', 'brittle', 'vortex', 'facet', 'eclipse'];
export const DAILY_TASK_IDS = ECONOMY.dailyTasks.map((t) => t.id);

// ---------------------------------------------------------------------------------- storage

let memoryStore = null;
/** localStorage when usable, otherwise an in-memory store (Node, blocked storage). */
export function defaultStorage() {
  try {
    const ls = globalThis.localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  } catch (e) {
    /* blocked (privacy mode, file://) */
  }
  if (!memoryStore) memoryStore = createMemoryStorage();
  return memoryStore;
}

/** A minimal Storage-compatible in-memory store (tests, fallbacks). */
export function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

function safeGet(storage, key) {
  try {
    const v = storage.getItem(key);
    return typeof v === 'string' ? v : null;
  } catch (e) {
    return null;
  }
}

function safeSet(storage, key, value) {
  try {
    storage.setItem(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

// ------------------------------------------------------------------------------ construction

function emptyStats() {
  const s = {};
  for (const k of STAT_KEYS) s[k] = 0;
  s.reactionKinds = {};
  for (const r of REACTION_IDS) s.reactionKinds[r] = 0;
  return s;
}

function emptyDaily() {
  const tasks = {};
  for (const id of DAILY_TASK_IDS) tasks[id] = { progress: 0, claimed: false };
  return { day: null, firstBattle: false, repeatCrystals: 0, tasks };
}

function heroEntry(now, extra = {}) {
  return { level: 1, xp: 0, constellation: 0, copies: 1, obtainedAt: now, seen: true, ...extra };
}

/**
 * A fresh profile: GDD §13 starting resources (3 200 ✦, 5 XP scrolls) and the guaranteed starter
 * squad (Аканэ, Вера, Сио, Марен, Искра, Масиро) already in the squad. `seed` makes the summon RNG
 * deterministic (tests); otherwise a random seed is drawn.
 */
export function createProfile({ seed, now = Date.now() } = {}) {
  const s = Number.isFinite(seed) ? seed >>> 0 : randomSeed();
  const heroes = {};
  for (const id of ECONOMY.starterSquad) if (HERO_BY_ID[id]) heroes[id] = heroEntry(now);
  return {
    v: PROFILE_VERSION,
    createdAt: now,
    updatedAt: now,
    crystals: ECONOMY.start.crystals,
    dust: ECONOMY.start.dust,
    xpScrolls: ECONOMY.start.xpScrolls,
    tickets: 0,
    heroes,
    squad: ECONOMY.starterSquad.filter((id) => heroes[id]).slice(0, BOARD.squadSize),
    formation: {},
    presets: new Array(PRESET_COUNT).fill(null),
    campaign: {},
    pity: { sinceEpicPlus: 0, sinceLegendaryPlus: 0, legendaryStreak: 0, novicePulls: 0, noviceLegendary: false, total: 0 },
    history: [],
    daily: emptyDaily(),
    weekly: { week: null, tickets: 0 },
    stats: emptyStats(),
    achievements: {},
    seeds: { summon: s, battle: (s ^ 0x5bd1e995) >>> 0 },
    recentBattles: [],
    firstRun: true,
    flags: {},
  };
}

/**
 * The profile itself when it has the current shape, otherwise a sanitized copy (lets the mutators
 * accept partial objects from mocks / older callers without crashing).
 */
export function ensureProfile(p) {
  const ok =
    isObj(p) && p.v === PROFILE_VERSION && isObj(p.heroes) && Array.isArray(p.squad) && isObj(p.campaign) &&
    isObj(p.pity) && isObj(p.daily) && isObj(p.daily.tasks) && isObj(p.weekly) && isObj(p.stats) &&
    isObj(p.stats.reactionKinds) && isObj(p.achievements) && isObj(p.seeds) && Array.isArray(p.history) &&
    Array.isArray(p.recentBattles) && Array.isArray(p.presets) && isObj(p.formation) && isObj(p.flags);
  return ok ? p : sanitizeProfile(p);
}

/** Deep copy (JSON-safe profile). */
export function cloneProfile(profile) {
  return JSON.parse(JSON.stringify(profile));
}

/** The intro / tutorial was shown: clear `firstRun`. */
export function completeFirstRun(profile) {
  const p = cloneProfile(profile);
  p.firstRun = false;
  return p;
}

/** Set a free-form UI flag (tutorial hints seen etc.). */
export function setFlag(profile, key, value = true) {
  const p = cloneProfile(profile);
  if (typeof key === 'string' && key.length <= 64) p.flags[key] = sanitizeFlagValue(value);
  return p;
}

function sanitizeFlagValue(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') return v.slice(0, 200);
  return !!v;
}

// --------------------------------------------------------------------------------- sanitizing

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, lo, hi, dflt) => clampInt(v, lo, hi, dflt);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_RE = /^\d{4}-W\d{2}$/;

/**
 * Validate and repair a (migrated) raw profile object. Unknown heroes / stages / keys are dropped,
 * numbers clamped, inconsistent states fixed (stars ⇒ cleared, levels ≤ level cap, squad ⊆ owned,
 * starter heroes always owned). Returns a NEW valid profile; `issues` (optional array) collects
 * human-readable notes about what was repaired.
 */
export function sanitizeProfile(raw, { now = Date.now(), seed, issues = [] } = {}) {
  const fresh = createProfile({ seed, now });
  if (!isObj(raw)) {
    issues.push('profile is not an object');
    return fresh;
  }
  const p = fresh;
  const note = (msg) => issues.push(msg);

  p.createdAt = num(raw.createdAt, 0, 8.64e15, now);
  p.updatedAt = num(raw.updatedAt, 0, 8.64e15, now);
  p.crystals = num(raw.crystals, 0, MAX_CURRENCY, raw.crystals === undefined ? fresh.crystals : 0);
  p.dust = num(raw.dust, 0, MAX_CURRENCY, 0);
  p.xpScrolls = num(raw.xpScrolls, 0, MAX_CURRENCY, raw.xpScrolls === undefined ? fresh.xpScrolls : 0);
  p.tickets = num(raw.tickets, 0, 1e6, 0);

  // campaign first: the level cap depends on it
  p.campaign = {};
  if (isObj(raw.campaign)) {
    for (const id of STAGE_IDS) {
      const r = raw.campaign[id];
      if (!isObj(r)) continue;
      const stars = num(r.stars, 0, 3, 0);
      const cleared = !!r.cleared || stars > 0;
      p.campaign[id] = {
        stars,
        cleared,
        clears: num(r.clears, 0, 1e7, cleared ? 1 : 0),
        attempts: num(r.attempts, 0, 1e7, 0),
        lossStreak: num(r.lossStreak, 0, 1e6, 0),
        bestRounds: num(r.bestRounds, 0, 1000, 0),
      };
      if (p.campaign[id].clears < (cleared ? 1 : 0)) p.campaign[id].clears = 1;
    }
    for (const k of Object.keys(raw.campaign)) if (!STAGE_IDS.includes(k)) note(`unknown stage ${k} dropped`);
  }
  const cap = levelCap(p);

  // heroes
  p.heroes = {};
  if (isObj(raw.heroes)) {
    for (const [id, e] of Object.entries(raw.heroes)) {
      if (!HERO_BY_ID[id]) {
        note(`unknown hero ${id} dropped`);
        continue;
      }
      if (!isObj(e)) {
        note(`hero ${id}: invalid entry replaced`);
        p.heroes[id] = heroEntry(now);
        continue;
      }
      let level = num(e.level, 1, MAX_LEVEL, 1);
      if (level > cap) {
        note(`hero ${id}: level ${level} above cap ${cap}`);
        level = cap;
      }
      const lim = xpLimit(level, cap);
      let xp = num(e.xp, 0, Number.MAX_SAFE_INTEGER, 0);
      if (xp > lim) xp = lim === Infinity ? xp : lim;
      p.heroes[id] = {
        level,
        xp,
        constellation: num(e.constellation, 0, 6, 0),
        copies: num(e.copies, 1, 1e6, 1),
        obtainedAt: num(e.obtainedAt, 0, 8.64e15, now),
        seen: e.seen === undefined ? true : !!e.seen,
      };
    }
  }
  for (const id of ECONOMY.starterSquad) {
    if (HERO_BY_ID[id] && !p.heroes[id]) {
      p.heroes[id] = heroEntry(now);
      if (isObj(raw.heroes) && Object.keys(raw.heroes).length) note(`starter hero ${id} restored`);
    }
  }

  // squad / formation / presets
  p.squad = sanitizeSquadIds(raw.squad, p.heroes);
  if (!p.squad.length) {
    p.squad = ECONOMY.starterSquad.filter((id) => p.heroes[id]).slice(0, BOARD.squadSize);
    if (raw.squad !== undefined) note('squad rebuilt');
  }
  p.formation = sanitizeFormation(raw.formation, p.squad);
  p.presets = new Array(PRESET_COUNT).fill(null);
  if (Array.isArray(raw.presets)) {
    for (let i = 0; i < PRESET_COUNT; i++) {
      const pr = raw.presets[i];
      if (!isObj(pr)) continue;
      const squad = sanitizeSquadIds(pr.squad, p.heroes);
      if (!squad.length) continue;
      p.presets[i] = {
        name: typeof pr.name === 'string' ? pr.name.slice(0, 40) : '',
        squad,
        formation: sanitizeFormation(pr.formation, squad),
      };
    }
  }

  // pity
  const rp = isObj(raw.pity) ? raw.pity : {};
  p.pity = {
    sinceEpicPlus: num(rp.sinceEpicPlus, 0, GACHA.pity.epicPlusEvery - 1, 0),
    sinceLegendaryPlus: num(rp.sinceLegendaryPlus, 0, GACHA.pity.legendaryPlusHard - 1, 0),
    legendaryStreak: num(rp.legendaryStreak, 0, GACHA.pity.mythicGuaranteeAfter, 0),
    novicePulls: num(rp.novicePulls, 0, GACHA.noviceBanner.pulls, 0),
    noviceLegendary: !!rp.noviceLegendary,
    total: num(rp.total, 0, 1e9, 0),
  };

  // history
  p.history = [];
  if (Array.isArray(raw.history)) {
    for (const h of raw.history.slice(-HISTORY_LIMIT)) {
      if (!isObj(h) || !HERO_BY_ID[h.id]) continue;
      p.history.push({ id: h.id, r: HERO_BY_ID[h.id].rarity, n: num(h.n, 0, 1e9, 0), t: num(h.t, 0, 8.64e15, 0) });
    }
  }

  // daily / weekly
  const rd = isObj(raw.daily) ? raw.daily : {};
  p.daily = emptyDaily();
  p.daily.day = typeof rd.day === 'string' && DAY_RE.test(rd.day) ? rd.day : null;
  p.daily.firstBattle = !!rd.firstBattle;
  p.daily.repeatCrystals = num(rd.repeatCrystals, 0, ECONOMY.repeatDailyCap, 0);
  if (isObj(rd.tasks)) {
    for (const id of DAILY_TASK_IDS) {
      const t = rd.tasks[id];
      if (isObj(t)) p.daily.tasks[id] = { progress: num(t.progress, 0, 1e6, 0), claimed: !!t.claimed };
    }
  }
  const rw = isObj(raw.weekly) ? raw.weekly : {};
  p.weekly = {
    week: typeof rw.week === 'string' && WEEK_RE.test(rw.week) ? rw.week : null,
    tickets: num(rw.tickets, 0, 1e6, 0),
  };

  // stats
  const rs = isObj(raw.stats) ? raw.stats : {};
  for (const k of STAT_KEYS) p.stats[k] = num(rs[k], 0, Number.MAX_SAFE_INTEGER, 0);
  if (isObj(rs.reactionKinds)) {
    for (const r of REACTION_IDS) p.stats.reactionKinds[r] = num(rs.reactionKinds[r], 0, Number.MAX_SAFE_INTEGER, 0);
  }

  // achievements (validated against the list lazily: unknown ids are harmless but dropped by economy)
  p.achievements = {};
  if (isObj(raw.achievements)) {
    for (const [id, a] of Object.entries(raw.achievements)) {
      if (typeof id !== 'string' || id.length > 64) continue;
      if (a === true) p.achievements[id] = { at: 0 };
      else if (isObj(a)) p.achievements[id] = { at: num(a.at, 0, 8.64e15, 0) };
    }
  }

  // seeds / misc
  const sd = isObj(raw.seeds) ? raw.seeds : {};
  if (Number.isFinite(Number(sd.summon))) p.seeds.summon = Number(sd.summon) >>> 0;
  if (Number.isFinite(Number(sd.battle))) p.seeds.battle = Number(sd.battle) >>> 0;
  p.recentBattles = Array.isArray(raw.recentBattles)
    ? raw.recentBattles.filter((x) => typeof x === 'string' || Number.isFinite(x)).map(String).slice(-RECENT_BATTLES)
    : [];
  p.firstRun = raw.firstRun === undefined ? false : !!raw.firstRun;
  p.flags = {};
  if (isObj(raw.flags)) {
    for (const [k, v] of Object.entries(raw.flags)) if (k.length <= 64) p.flags[k] = sanitizeFlagValue(v);
  }
  return p;
}

/** Valid squad ids: owned, unique, ≤ 6, roster order of the input kept. */
export function sanitizeSquadIds(ids, heroes) {
  const out = [];
  if (!Array.isArray(ids)) return out;
  for (const x of ids) {
    const id = typeof x === 'string' ? x : x && x.heroId;
    if (typeof id === 'string' && heroes[id] && !out.includes(id)) out.push(id);
    if (out.length >= BOARD.squadSize) break;
  }
  return out;
}

/** Deployment { heroId: sq } restricted to squad members on distinct player deploy squares. */
export function sanitizeFormation(formation, squad) {
  const out = {};
  if (!isObj(formation)) return out;
  const allowed = new Set(deploySquares(1));
  const used = new Set();
  for (const id of squad) {
    const sq = formation[id];
    if (Number.isInteger(sq) && allowed.has(sq) && !used.has(sq)) {
      out[id] = sq;
      used.add(sq);
    }
  }
  return out;
}

// --------------------------------------------------------------------------------- migrations

/** MIGRATIONS[n](raw) -> raw object of version n + 1. */
export const MIGRATIONS = {
  // v0: unversioned plain profile (contract-shaped dev saves). Renames the short-lived field names
  // used by early prototypes and stamps the version; everything else is validated by the sanitizer.
  0: (raw) => {
    const o = { ...raw };
    if (o.scrolls !== undefined && o.xpScrolls === undefined) o.xpScrolls = o.scrolls;
    if (o.stardust !== undefined && o.dust === undefined) o.dust = o.stardust;
    if (isObj(o.pity)) {
      const pt = { ...o.pity };
      if (pt.epic !== undefined && pt.sinceEpicPlus === undefined) pt.sinceEpicPlus = pt.epic;
      if (pt.legendary !== undefined && pt.sinceLegendaryPlus === undefined) pt.sinceLegendaryPlus = pt.legendary;
      o.pity = pt;
    }
    if (o.firstRun === undefined) o.firstRun = false;
    o.v = 1;
    return o;
  },
};

/** Run migrations up to PROFILE_VERSION. -> { obj, from, migrated, newer } */
export function migrateProfile(raw) {
  let obj = isObj(raw) ? raw : {};
  const from = Number.isInteger(obj.v) && obj.v >= 0 ? obj.v : 0;
  if (from > PROFILE_VERSION) return { obj, from, migrated: false, newer: true };
  let v = from;
  while (v < PROFILE_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) break;
    obj = step(obj);
    v = Number.isInteger(obj.v) && obj.v > v ? obj.v : v + 1;
  }
  return { obj, from, migrated: from !== PROFILE_VERSION, newer: false };
}

// ---------------------------------------------------------------------------- serialization

/** Envelope text for a profile (what is stored under PROFILE_KEY). */
export function serializeProfile(profile, now = Date.now()) {
  const body = JSON.stringify(profile);
  return JSON.stringify({ fmt: ENVELOPE_FMT, v: PROFILE_VERSION, savedAt: now, sum: fnv1a(body), body });
}

/**
 * Parse stored text. -> null (unreadable) | { obj, version, checksumOk, envelope: boolean }.
 * A bare profile object (no envelope) is accepted as a legacy save (checksumOk = true).
 */
export function parseStored(text) {
  if (typeof text !== 'string' || !text) return null;
  let outer;
  try {
    outer = JSON.parse(text);
  } catch (e) {
    return null;
  }
  if (!isObj(outer)) return null;
  if (outer.fmt === ENVELOPE_FMT && typeof outer.body === 'string') {
    let obj;
    try {
      obj = JSON.parse(outer.body);
    } catch (e) {
      return null;
    }
    if (!isObj(obj)) return null;
    const checksumOk = Number(outer.sum) === fnv1a(outer.body);
    const version = Number.isInteger(obj.v) ? obj.v : Number.isInteger(outer.v) ? outer.v : 0;
    if (!Number.isInteger(obj.v)) obj.v = version;
    return { obj, version, checksumOk, envelope: true };
  }
  if (isObj(outer.heroes) || outer.crystals !== undefined) {
    return { obj: outer, version: Number.isInteger(outer.v) ? outer.v : 0, checksumOk: true, envelope: false };
  }
  return null;
}

// ------------------------------------------------------------------------------- load / save

/**
 * Load with a diagnostic report. Never throws.
 * -> { profile, status: 'new'|'ok'|'migrated'|'backup'|'salvaged'|'reset'|'newer', source, issues }
 */
export function loadProfileReport(storage = defaultStorage(), { now = Date.now(), seed } = {}) {
  const st = storage || defaultStorage();
  const issues = [];
  const mainText = safeGet(st, PROFILE_KEY);
  const main = parseStored(mainText);

  const finish = (parsed, status, source) => {
    const m = migrateProfile(parsed.obj);
    if (m.newer) {
      if (source === 'main' && mainText && safeGet(st, FUTURE_KEY) === null) safeSet(st, FUTURE_KEY, mainText);
      issues.push(`save version ${m.from} is newer than ${PROFILE_VERSION}`);
    }
    const profile = sanitizeProfile(m.obj, { now, seed, issues });
    let s = status;
    if (m.newer) s = 'newer';
    else if (status === 'ok' && m.migrated) s = 'migrated';
    return { profile, status: s, source, issues };
  };

  if (main && main.checksumOk) return finish(main, 'ok', 'main');

  // main missing, unreadable or failing its checksum
  if (mainText !== null) {
    issues.push(main ? 'checksum mismatch on main save' : 'main save unreadable');
    safeSet(st, CORRUPT_KEY, mainText);
  }
  const backup = parseStored(safeGet(st, BACKUP_KEY));
  if (backup && backup.checksumOk) return finish(backup, 'backup', 'backup');
  if (main) return finish(main, 'salvaged', 'main');
  if (backup) return finish(backup, 'salvaged', 'backup');
  const profile = createProfile({ seed, now });
  return { profile, status: mainText === null ? 'new' : 'reset', source: null, issues };
}

/** Contract API: load the profile (fresh starter profile on first launch or unrecoverable data). */
export function loadProfile(storage = defaultStorage(), opts = {}) {
  return loadProfileReport(storage, opts).profile;
}

/**
 * Persist the profile. The previous valid save is rotated into BACKUP_KEY first.
 * Returns true on success, false when storage refused the write (quota / blocked).
 */
export function saveProfile(profile, storage = defaultStorage(), { now = Date.now() } = {}) {
  const st = storage || defaultStorage();
  let text;
  try {
    const p = { ...profile, v: PROFILE_VERSION, updatedAt: now };
    text = serializeProfile(p, now);
  } catch (e) {
    return false;
  }
  const prev = safeGet(st, PROFILE_KEY);
  if (prev !== null && prev !== text) {
    const parsed = parseStored(prev);
    if (parsed && parsed.checksumOk) safeSet(st, BACKUP_KEY, prev);
  }
  return safeSet(st, PROFILE_KEY, text);
}

/** Remove the save (and its backup). The next load starts a fresh profile. */
export function clearProfile(storage = defaultStorage()) {
  const st = storage || defaultStorage();
  for (const k of [PROFILE_KEY, BACKUP_KEY]) {
    try {
      st.removeItem(k);
    } catch (e) {
      /* ignore */
    }
  }
}

// ------------------------------------------------------------------------------ export/import

const EXPORT_PREFIX = 'ECRPG1:';

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Portable backup code (copy/paste between devices). */
export function exportProfile(profile, now = Date.now()) {
  return EXPORT_PREFIX + toBase64(serializeProfile(profile, now));
}

/** Parse a backup code. -> { profile, status, issues } | null when the code is not valid. */
export function importProfile(code, { now = Date.now() } = {}) {
  if (typeof code !== 'string' || !code.trim().startsWith(EXPORT_PREFIX)) return null;
  let text;
  try {
    text = fromBase64(code.trim().slice(EXPORT_PREFIX.length));
  } catch (e) {
    return null;
  }
  const parsed = parseStored(text);
  if (!parsed || !parsed.checksumOk) return null;
  const issues = [];
  const m = migrateProfile(parsed.obj);
  const profile = sanitizeProfile(m.obj, { now, issues });
  return { profile, status: m.newer ? 'newer' : m.migrated ? 'migrated' : 'ok', issues };
}

/** Roster ids in data order (stable iteration for UI lists). */
export const HERO_IDS = HEROES.map((h) => h.id);
