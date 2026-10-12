// Persistent settings + statistics (localStorage, versioned, robust to corrupt data).
//
//   loadSettings(storage?) -> fresh settings object (defaults merged, every field validated,
//                             old saves migrated)
//   saveSettings(settings, storage?) -> boolean
//   sanitizeSettings(obj) -> NEW complete settings object (also derives haptics <-> vibration)
//   DEFAULT_SETTINGS (deep-frozen), DEFAULT_FX, PRESETS, PRESET_IDS, presetPatch(id),
//   detectPreset(settings), ENERGY_COLORS, PLAYER_COLORS, SIDE_COLORS, ANIM_SPEEDS, TEXT_TIMES,
//   AI_PACE_MS, hapticPattern(pattern, level), cleanPlayerName(str)
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
//
// SETTINGS CONTRACT (the live object is shared by every module; see the field comments below).
// The saved JSON carries `v: SETTINGS_VERSION`; the live object does not.

import { TITLES } from './titles.js';

export const SETTINGS_KEY = 'epic-checkers.settings.v1';
export const STATS_KEY = 'epic-checkers.stats.v1';
export const STATS_VERSION = 1;
export const SETTINGS_VERSION = 2;
/** Quality value the app (not the user) once chose — written by the bootstrap (main.js). */
export const QUALITY_AUTO_KEY = 'epic-checkers.quality-auto';

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

/** Epic energy colours the player can pick (settings.playerColor). */
export const ENERGY_COLORS = deepFreeze({
  cyan: '#29E6FF',
  gold: '#FFD23F',
  green: '#3DFF8F',
  violet: '#A06CFF',
  orange: '#FF8A2A',
  pink: '#FF4FD8',
});
/** Default energy colours of the sides (WHITE = 1, BLACK = -1). */
export const SIDE_COLORS = deepFreeze({ 1: '#29E6FF', '-1': '#FF2E63' });
export const PLAYER_COLORS = Object.freeze(['auto', ...Object.keys(ENERGY_COLORS)]);
export const QUALITIES = Object.freeze(['auto', 'high', 'medium', 'low']);
export const HAPTICS = Object.freeze(['off', 'light', 'strong']);
export const ANIM_SPEEDS = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 2]);
export const TEXT_TIMES = Object.freeze([1, 1.5, 2, 3]);
export const BRAGS = Object.freeze(['off', 'rare', 'normal', 'often']);
export const AI_PACE_MS = deepFreeze({ fast: 300, normal: 700, slow: 1300 });
export const PLAYER_NAME_MAX = 16;
export const FX_RANGES = deepFreeze({ shake: [0, 1.5], particles: [0.25, 1.5] });
/** «Валькирии доски» Ultimate cinematics (settings.rpgUltCinematic). */
export const RPG_ULT_CINEMATICS = Object.freeze(['full', 'short', 'first']);

/** Per-effect switches of EPIC BADASS MODE (settings.fx). */
export const DEFAULT_FX = deepFreeze({
  shake: 1, //          0..1.5 screen shake strength, 0 = off
  flashes: true, //     impact frames, white flashes, chromatic aberration (photosensitivity)
  slowmo: true, //      slow motion + hit-stop
  camera: true, //      zoom / pan / dutch angles
  cutins: true, //      cut-in bands + attack names
  kanji: true, //       onomatopoeia (ドン! БАХ!)
  brags: 'normal', //   'off' | 'rare' | 'normal' | 'often'
  turnBanners: true, // «ТВОЙ ХОД» banners
  combo: true, //       combo counter
  particles: 1, //      0.25..1.5 particle amount
  auras: true, //       king auras
  backdrop: true, //    animated epic background (false = static)
  vsIntro: true, //     VS screen at the start
});

export const DEFAULT_SETTINGS = deepFreeze({
  lang: 'ru',
  sfxVolume: 0.8,
  musicVolume: 0.5,
  announcer: true,
  haptics: 'strong', // 'off' | 'light' | 'strong'
  vibration: true, //   legacy mirror: haptics !== 'off' (kept in sync for old readers)
  quality: 'auto', //   'auto' | 'high' | 'medium' | 'low' ('auto': the app picks + adaptive downgrade)
  battery: false, //    battery saver: 30 fps cap, render scale 1, static backdrop, fewer particles
  animSpeed: 1, //      0.5 | 0.75 | 1 | 1.25 | 1.5 | 2 — motion speed multiplier (< 1 = slower)
  textTime: 1.5, //     1 | 1.5 | 2 | 3 — how long texts stay readable (multiplier)
  opponentFx: 'full', // 'full' | 'short' — compact cinematics for the opponent's (AI) moves
  aiPace: 'normal', //  'fast' | 'normal' | 'slow' — minimum AI "thinking" pause (AI_PACE_MS)
  showMoves: true,
  showLastMove: true,
  showCoords: true,
  playerName: '', //    ≤ 16 chars, trimmed; '' → «Ты» / "You"
  playerColor: 'auto', // 'auto' | 'cyan' | 'gold' | 'green' | 'violet' | 'orange' | 'pink'
  preset: 'balanced', // 'max' | 'balanced' | 'calm' | 'battery' | 'custom' (label, see detectPreset)
  // «Валькирии доски» (src/rpg): the RPG mode's own settings live on the same shared object
  rpgVoice: true, //    Japanese hero voice lines (src/rpg/voice.js)
  voiceVolume: 0.9, //  0..1 voice volume (its own slider: sfxVolume 0 does not mute voices)
  rpgUltCinematic: 'full', // 'full' | 'short' | 'first' (full the first time each Ultimate is seen, then short)
  rpgDamageNumbers: true, // floating damage / heal numbers on the RPG board
  fx: DEFAULT_FX,
  lastConfig: DEFAULT_CONFIG,
});

// ------------------------------------------------------------------ presets
//
// A preset sets every "preset-controlled" field: textTime, animSpeed, quality, battery and all of
// settings.fx. settings.preset is only a label: detectPreset() names the preset whose controlled
// fields all match, or 'custom'.

export const PRESET_IDS = Object.freeze(['max', 'balanced', 'calm', 'battery']);
const PRESET_BASE = { textTime: DEFAULT_SETTINGS.textTime, animSpeed: 1, quality: 'auto', battery: false };
export const PRESETS = deepFreeze({
  max: {
    ...PRESET_BASE,
    textTime: 2,
    fx: { ...DEFAULT_FX, shake: 1.3, particles: 1.5, brags: 'often' },
  },
  balanced: { ...PRESET_BASE, fx: { ...DEFAULT_FX } },
  calm: {
    ...PRESET_BASE,
    textTime: 2,
    animSpeed: 0.75,
    fx: { ...DEFAULT_FX, shake: 0.4, flashes: false, slowmo: false, turnBanners: false, particles: 0.6, brags: 'rare' },
  },
  battery: {
    ...PRESET_BASE,
    quality: 'low',
    battery: true,
    fx: { ...DEFAULT_FX, backdrop: false, particles: 0.4, auras: false, flashes: false, shake: 0.6 },
  },
});
const PRESET_FIELDS = ['textTime', 'animSpeed', 'quality', 'battery'];

/** Settings patch (fresh, mutable) that applies preset `id` — or null for an unknown id. */
export function presetPatch(id) {
  const p = PRESETS[id];
  if (!p) return null;
  return { textTime: p.textTime, animSpeed: p.animSpeed, quality: p.quality, battery: p.battery, fx: { ...p.fx }, preset: id };
}

/** 'max' | 'balanced' | 'calm' | 'battery' when every preset-controlled field matches, else 'custom'. */
export function detectPreset(settings) {
  const s = isObj(settings) ? settings : {};
  const fx = isObj(s.fx) ? s.fx : {};
  for (const id of PRESET_IDS) {
    const p = PRESETS[id];
    if (!PRESET_FIELDS.every((k) => s[k] === p[k])) continue;
    if (Object.keys(DEFAULT_FX).every((k) => fx[k] === p.fx[k])) return id;
  }
  return 'custom';
}

// ------------------------------------------------------------------ helpers shared with other modules

/**
 * Vibration pattern for a haptics level: null when 'off'; 'light' shortens every pulse (pauses stay)
 * so a tap stays a tap. Accepts ms or [ms, pause, ms, ...].
 */
export function hapticPattern(pattern, level = 'strong') {
  if (level === 'off' || level === false) return null;
  const light = level === 'light';
  const pulse = (ms) => {
    const v = Math.max(0, Number(ms) || 0);
    return light ? Math.max(4, Math.min(28, Math.round(v * 0.45))) : Math.round(v);
  };
  if (Array.isArray(pattern)) return pattern.map((v, i) => (i % 2 === 0 ? pulse(v) : Math.max(0, Math.round(Number(v) || 0))));
  return pulse(pattern);
}

/** Trimmed player name: no control characters, single spaces, ≤ 16 characters. */
export function cleanPlayerName(v) {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, PLAYER_NAME_MAX).join('').trim();
}

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

const numIn = (v, [lo, hi], def) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v * 100) / 100)) : def);
/** Nearest allowed value (old saves with in-between numbers keep their intent); non-numbers -> def. */
const nearest = (v, list, def) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return def;
  let best = list[0];
  for (const x of list) if (Math.abs(x - n) < Math.abs(best - n)) best = x;
  return best;
};

/** Validates settings.fx; unknown/invalid fields fall back to the defaults. */
export function sanitizeFx(obj) {
  const f = isObj(obj) ? obj : {};
  const d = DEFAULT_FX;
  return {
    shake: numIn(f.shake, FX_RANGES.shake, d.shake),
    flashes: bool(f.flashes, d.flashes),
    slowmo: bool(f.slowmo, d.slowmo),
    camera: bool(f.camera, d.camera),
    cutins: bool(f.cutins, d.cutins),
    kanji: bool(f.kanji, d.kanji),
    brags: oneOf(f.brags, BRAGS, d.brags),
    turnBanners: bool(f.turnBanners, d.turnBanners),
    combo: bool(f.combo, d.combo),
    particles: numIn(f.particles, FX_RANGES.particles, d.particles),
    auras: bool(f.auras, d.auras),
    backdrop: bool(f.backdrop, d.backdrop),
    vsIntro: bool(f.vsIntro, d.vsIntro),
  };
}

/**
 * Validates a settings object; returns a NEW object with every field present.
 * Old shapes are understood: a boolean `vibration` without `haptics` becomes haptics 'off' /
 * 'strong'; `vibration` is always re-derived from haptics. `preset` is re-derived (detectPreset)
 * unless it names a preset whose fields still match.
 */
export function sanitizeSettings(obj) {
  const s = isObj(obj) ? obj : {};
  const d = DEFAULT_SETTINGS;
  const haptics = HAPTICS.includes(s.haptics) ? s.haptics : typeof s.vibration === 'boolean' ? (s.vibration ? 'strong' : 'off') : d.haptics;
  const out = {
    lang: oneOf(s.lang, ['ru', 'en'], d.lang),
    sfxVolume: num01(s.sfxVolume, d.sfxVolume),
    musicVolume: num01(s.musicVolume, d.musicVolume),
    announcer: bool(s.announcer, d.announcer),
    haptics,
    vibration: haptics !== 'off',
    quality: oneOf(s.quality, QUALITIES, d.quality),
    battery: bool(s.battery, d.battery),
    animSpeed: nearest(s.animSpeed, ANIM_SPEEDS, d.animSpeed),
    textTime: nearest(s.textTime, TEXT_TIMES, d.textTime),
    opponentFx: oneOf(s.opponentFx, ['full', 'short'], d.opponentFx),
    aiPace: oneOf(s.aiPace, Object.keys(AI_PACE_MS), d.aiPace),
    showMoves: bool(s.showMoves, d.showMoves),
    showLastMove: bool(s.showLastMove, d.showLastMove),
    showCoords: bool(s.showCoords, d.showCoords),
    playerName: cleanPlayerName(s.playerName),
    playerColor: oneOf(s.playerColor, PLAYER_COLORS, d.playerColor),
    preset: 'custom',
    rpgVoice: bool(s.rpgVoice, d.rpgVoice),
    voiceVolume: numIn(s.voiceVolume, [0, 1], d.voiceVolume),
    rpgUltCinematic: oneOf(s.rpgUltCinematic, RPG_ULT_CINEMATICS, d.rpgUltCinematic),
    rpgDamageNumbers: bool(s.rpgDamageNumbers, d.rpgDamageNumbers),
    fx: sanitizeFx(s.fx),
    lastConfig: sanitizeConfig(s.lastConfig),
  };
  out.preset = detectPreset(out);
  return out;
}

/**
 * Migrates a raw saved settings blob of an older version (before SETTINGS_VERSION 2) in place of a
 * copy: 'high' was the old default quality, and a quality the app once picked by itself
 * (QUALITY_AUTO_KEY) is the app's choice too — both become 'auto'. vibration -> haptics happens in
 * sanitizeSettings.
 */
export function migrateSettings(raw, storage = null) {
  if (!isObj(raw)) return raw;
  const out = { ...raw };
  if (!(Number(raw.v) >= SETTINGS_VERSION)) {
    let appQuality = null;
    try {
      appQuality = storage && storage.getItem ? storage.getItem(QUALITY_AUTO_KEY) : null;
    } catch (e) {
      appQuality = null;
    }
    if (raw.quality === 'high' || (appQuality && raw.quality === appQuality)) out.quality = 'auto';
  }
  delete out.v;
  return out;
}

export function loadSettings(storage = defaultStorage()) {
  const data = readJSON(storage, SETTINGS_KEY);
  return sanitizeSettings(migrateSettings(data, storage));
}

export function saveSettings(settings, storage = defaultStorage()) {
  return writeJSON(storage, SETTINGS_KEY, { v: SETTINGS_VERSION, ...sanitizeSettings(settings) });
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
