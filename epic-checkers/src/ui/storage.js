// Persistent settings + statistics (localStorage, versioned, robust to corrupt data).
//
//   loadSettings(storage?) -> fresh settings object (defaults merged, every field validated)
//   saveSettings(settings, storage?) -> boolean
//   DEFAULT_SETTINGS (deep-frozen)
//   new StatsStore({ storage?, key? })
//     .record(summary) -> { newRecords: [{ id, value, prev }], newTitles: [{ id, icon, tier }] }
//                         (a record is "new" only when it beats an earlier one: the very first game
//                         sets the baselines silently)
//     .get() -> deep copy of the stats data
//     .titles() -> [{ id, icon, tier, unlocked, unlockedAt, progress: [cur, goal] | null }]
//     .currentTitle() -> title id | null (rarest unlocked title, newest first on ties)
//     .reset()
//
// summary = { variantId, mode: 'ai'|'pvp'|'demo', epic, result: 'win'|'loss'|'draw' (from the
// human's point of view; in pvp/demo it is ignored), level, moves, captures, maxCombo, kingsMade,
// piecesLost, durationSec, giveaway? }.
// Wins/losses/draws, captures, kings and records count only games against the AI; two-player and
// AI-battle games are counted separately (pvpGames / demoGames) and feed a few titles.

import { TITLES } from './titles.js';

export const SETTINGS_KEY = 'epic-checkers.settings.v1';
export const STATS_KEY = 'epic-checkers.stats.v1';
export const STATS_VERSION = 1;

const deepFreeze = (o) => {
  Object.values(o).forEach((v) => v && typeof v === 'object' && deepFreeze(v));
  return Object.freeze(o);
};

export const DEFAULT_CONFIG = deepFreeze({
  variantId: 'russian',
  mode: 'ai',
  humanColor: 1,
  level: 3,
  // AI-vs-AI demo: separate levels for both fighters (GameConfig.levelWhite / levelBlack)
  levelWhite: 3,
  levelBlack: 3,
  epic: true,
  giveaway: false,
});

export const DEFAULT_SETTINGS = deepFreeze({
  lang: 'ru',
  sfxVolume: 0.8,
  musicVolume: 0.5,
  vibration: true,
  announcer: true,
  quality: 'high',
  showMoves: true,
  animSpeed: 1,
  lastConfig: DEFAULT_CONFIG,
});

// ------------------------------------------------------------------ storage access

/** In-memory Storage-like object (used in Node tests or when localStorage is unavailable). */
export class MemoryStorage {
  constructor(init = {}) {
    this.map = new Map(Object.entries(init));
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

let fallbackStorage = null;
function defaultStorage() {
  try {
    const ls = globalThis.localStorage;
    if (ls) {
      const probe = '__epic_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return ls;
    }
  } catch (e) {
    // localStorage blocked (private mode, file:// in some WebViews ...)
  }
  if (!fallbackStorage) fallbackStorage = new MemoryStorage();
  return fallbackStorage;
}

function readJSON(storage, key) {
  try {
    const s = storage.getItem(key);
    if (s == null || s === '') return null;
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

function writeJSON(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

// ------------------------------------------------------------------ validation helpers

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const num01 = (v, def) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : def);
const bool = (v, def) => (typeof v === 'boolean' ? v : def);
const oneOf = (v, list, def) => (list.includes(v) ? v : def);
const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const nonNeg = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** Validates a GameConfig; unknown/invalid fields fall back to `base`. */
export function sanitizeConfig(cfg, base = DEFAULT_CONFIG) {
  const c = isObj(cfg) ? cfg : {};
  return {
    variantId:
      typeof c.variantId === 'string' && /^[a-z0-9_-]{1,32}$/.test(c.variantId) ? c.variantId : base.variantId,
    mode: oneOf(c.mode, ['ai', 'pvp', 'demo'], base.mode),
    humanColor: oneOf(c.humanColor, [1, -1, 0], base.humanColor),
    level: oneOf(c.level, [1, 2, 3, 4, 5], base.level),
    levelWhite: oneOf(c.levelWhite, [1, 2, 3, 4, 5], oneOf(c.level, [1, 2, 3, 4, 5], base.levelWhite ?? base.level)),
    levelBlack: oneOf(c.levelBlack, [1, 2, 3, 4, 5], oneOf(c.level, [1, 2, 3, 4, 5], base.levelBlack ?? base.level)),
    epic: bool(c.epic, base.epic),
    giveaway: bool(c.giveaway, base.giveaway),
  };
}

/** Validates a settings object; returns a NEW object with every field present. */
export function sanitizeSettings(obj) {
  const s = isObj(obj) ? obj : {};
  const d = DEFAULT_SETTINGS;
  return {
    lang: oneOf(s.lang, ['ru', 'en'], d.lang),
    sfxVolume: num01(s.sfxVolume, d.sfxVolume),
    musicVolume: num01(s.musicVolume, d.musicVolume),
    vibration: bool(s.vibration, d.vibration),
    announcer: bool(s.announcer, d.announcer),
    quality: oneOf(s.quality, ['high', 'medium', 'low'], d.quality),
    showMoves: bool(s.showMoves, d.showMoves),
    animSpeed: oneOf(s.animSpeed, [1, 1.5, 2], d.animSpeed),
    lastConfig: sanitizeConfig(s.lastConfig),
  };
}

export function loadSettings(storage = defaultStorage()) {
  const data = readJSON(storage, SETTINGS_KEY);
  return sanitizeSettings(data);
}

export function saveSettings(settings, storage = defaultStorage()) {
  return writeJSON(storage, SETTINGS_KEY, sanitizeSettings(settings));
}

// ------------------------------------------------------------------ stats

export function emptyStats() {
  return {
    v: STATS_VERSION,
    totals: {
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      captures: 0,
      kingsMade: 0,
      flawless: 0,
      piecesLost: 0,
      moves: 0,
      durationSec: 0,
    },
    best: { combo: 0, streak: 0, captures: 0, kings: 0, fastestWin: 0, longestGame: 0 },
    streak: 0,
    maxLevelBeaten: 0,
    epicWins: 0,
    giveawayWins: 0,
    pvpGames: 0,
    demoGames: 0,
    perVariant: {},
    titles: {},
    updatedAt: 0,
  };
}

/** Repairs any stored stats blob into a valid structure (never throws). */
export function sanitizeStats(obj) {
  const out = emptyStats();
  if (!isObj(obj)) return out;
  if (isObj(obj.totals)) for (const k of Object.keys(out.totals)) out.totals[k] = k === 'durationSec' ? nonNeg(obj.totals[k]) : count(obj.totals[k]);
  if (isObj(obj.best)) for (const k of Object.keys(out.best)) out.best[k] = count(obj.best[k]);
  for (const k of ['streak', 'maxLevelBeaten', 'epicWins', 'giveawayWins', 'pvpGames', 'demoGames', 'updatedAt']) out[k] = count(obj[k]);
  out.maxLevelBeaten = Math.min(5, out.maxLevelBeaten);
  if (isObj(obj.perVariant)) {
    for (const [id, v] of Object.entries(obj.perVariant)) {
      if (!/^[a-z0-9_-]{1,32}$/.test(id) || !isObj(v)) continue;
      out.perVariant[id] = { games: count(v.games), wins: count(v.wins), losses: count(v.losses), draws: count(v.draws) };
    }
  }
  if (isObj(obj.titles)) {
    for (const [id, ts] of Object.entries(obj.titles)) {
      if (TITLES.some((x) => x.id === id)) out.titles[id] = count(ts) || 1;
    }
  }
  return out;
}

function sanitizeSummary(s) {
  const o = isObj(s) ? s : {};
  return {
    variantId: typeof o.variantId === 'string' && /^[a-z0-9_-]{1,32}$/.test(o.variantId) ? o.variantId : 'unknown',
    mode: oneOf(o.mode, ['ai', 'pvp', 'demo'], 'ai'),
    epic: !!o.epic,
    giveaway: !!o.giveaway,
    result: oneOf(o.result, ['win', 'loss', 'draw'], 'draw'),
    level: oneOf(o.level, [1, 2, 3, 4, 5], 0),
    moves: count(o.moves),
    captures: count(o.captures),
    maxCombo: count(o.maxCombo),
    kingsMade: count(o.kingsMade),
    piecesLost: count(o.piecesLost),
    durationSec: nonNeg(o.durationSec),
  };
}

const RECORD_MIN = { bestCombo: 2, mostCaptures: 1, mostKings: 1, bestStreak: 2 };

export class StatsStore {
  constructor({ storage = defaultStorage(), key = STATS_KEY } = {}) {
    this.storage = storage;
    this.key = key;
    this.data = this._load();
  }

  _load() {
    const raw = readJSON(this.storage, this.key);
    if (raw && raw.v !== STATS_VERSION) {
      // Future/older versions: keep what can be understood.
      return sanitizeStats(raw);
    }
    return sanitizeStats(raw);
  }

  _save() {
    this.data.updatedAt = Date.now();
    writeJSON(this.storage, this.key, this.data);
  }

  /** Deep copy of the stats data. */
  get() {
    return JSON.parse(JSON.stringify(this.data));
  }

  reset() {
    this.data = emptyStats();
    this._save();
  }

  /**
   * Records a finished game. Returns new personal records (only for games vs AI) and titles
   * unlocked by this game.
   */
  record(summary) {
    const s = sanitizeSummary(summary);
    const d = this.data;
    const newRecords = [];
    // only a record that beats an earlier one is news (no «НОВЫЙ РЕКОРД» on the very first game)
    const bump = (id, value, prev, better) => {
      if (better && prev > 0 && value >= (RECORD_MIN[id] || 1)) newRecords.push({ id, value, prev });
    };

    if (s.mode === 'ai') {
      const t = d.totals;
      t.games++;
      t.captures += s.captures;
      t.kingsMade += s.kingsMade;
      t.piecesLost += s.piecesLost;
      t.moves += s.moves;
      t.durationSec += s.durationSec;
      const pv = d.perVariant[s.variantId] || (d.perVariant[s.variantId] = { games: 0, wins: 0, losses: 0, draws: 0 });
      pv.games++;

      // per-game records (any result)
      bump('bestCombo', s.maxCombo, d.best.combo, s.maxCombo > d.best.combo);
      d.best.combo = Math.max(d.best.combo, s.maxCombo);
      bump('mostCaptures', s.captures, d.best.captures, s.captures > d.best.captures);
      d.best.captures = Math.max(d.best.captures, s.captures);
      bump('mostKings', s.kingsMade, d.best.kings, s.kingsMade > d.best.kings);
      d.best.kings = Math.max(d.best.kings, s.kingsMade);

      if (s.result === 'win') {
        t.wins++;
        pv.wins++;
        d.streak = d.streak + 1;
        bump('bestStreak', d.streak, d.best.streak, d.streak > d.best.streak);
        d.best.streak = Math.max(d.best.streak, d.streak);
        if (s.piecesLost === 0) t.flawless++;
        if (s.level) d.maxLevelBeaten = Math.max(d.maxLevelBeaten, s.level);
        if (s.epic) d.epicWins++;
        if (s.giveaway) d.giveawayWins++;
        if (s.moves > 0) {
          const prev = d.best.fastestWin;
          bump('fastestWin', s.moves, prev, prev === 0 || s.moves < prev);
          if (prev === 0 || s.moves < prev) d.best.fastestWin = s.moves;
        }
      } else if (s.result === 'loss') {
        t.losses++;
        pv.losses++;
        d.streak = 0;
      } else {
        t.draws++;
        pv.draws++;
        d.streak = 0;
      }
    } else if (s.mode === 'pvp') {
      d.pvpGames++;
    } else {
      d.demoGames++;
    }
    if (s.mode !== 'demo') d.best.longestGame = Math.max(d.best.longestGame, s.moves);

    const newTitles = [];
    const now = Date.now();
    for (const title of TITLES) {
      if (d.titles[title.id]) continue;
      let ok = false;
      try {
        ok = !!title.check(d);
      } catch (e) {
        ok = false;
      }
      if (ok) {
        d.titles[title.id] = now;
        newTitles.push({ id: title.id, icon: title.icon, tier: title.tier });
      }
    }
    this._save();
    return { newRecords, newTitles };
  }

  /** All titles with unlock state and progress, in display order (unlocked first, by tier). */
  titles() {
    const d = this.data;
    return TITLES.map((x) => {
      let progress = null;
      if (x.progress) {
        try {
          progress = x.progress(d);
        } catch (e) {
          progress = null;
        }
      }
      return {
        id: x.id,
        icon: x.icon,
        tier: x.tier,
        unlocked: !!d.titles[x.id],
        unlockedAt: d.titles[x.id] || 0,
        progress,
      };
    }).sort((a, b) => (b.unlocked - a.unlocked) || (a.unlocked ? b.tier - a.tier : a.tier - b.tier));
  }

  unlockedCount() {
    return Object.keys(this.data.titles).length;
  }

  /** The most prestigious unlocked title id (highest tier, newest on ties), or null. */
  currentTitle() {
    let best = null;
    for (const x of TITLES) {
      const ts = this.data.titles[x.id];
      if (!ts) continue;
      if (!best || x.tier > best.tier || (x.tier === best.tier && ts > best.ts)) best = { id: x.id, tier: x.tier, ts };
    }
    return best ? best.id : null;
  }
}
