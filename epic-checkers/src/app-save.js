// Autosave of the game in progress (F8). Android may kill the WebView renderer or the whole
// process while the game is in the background; the controller writes the running game to
// localStorage after every move and on pause, and the next launch offers «Продолжить партию».
//
//   writeSave(data, storage?)  data = { cfg, humanColor, game: Game, elapsedSec }
//   readSave(storage?) -> { cfg, humanColor, game: Game, elapsedSec, savedAt, json } | null
//   clearSave(storage?)
//
// Only AI and two-player games are saved (an AI-vs-AI demo is not worth resuming). Per-game
// stats are not stored: they are a pure function of the move list and are replayed on resume.
// A corrupt, foreign or finished save reads as null (and is removed).

import { Game, getVariant } from './engine/index.js';

export const SAVE_KEY = 'epic-checkers.current.v1';
export const SAVE_VERSION = 1;

let memory = null;
function defaultStorage() {
  try {
    const ls = globalThis.localStorage;
    if (ls) return ls;
  } catch (e) {
    /* blocked */
  }
  if (!memory) {
    const map = new Map();
    memory = {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
    };
  }
  return memory;
}

const MODES = ['ai', 'pvp'];

/** Is a game in this mode worth saving? */
export function saveableMode(mode) {
  return MODES.includes(mode);
}

/** Serialise a running game. Returns the stored object, or null when nothing was written. */
export function writeSave({ cfg, humanColor, game, elapsedSec = 0 } = {}, storage = defaultStorage()) {
  if (!cfg || !game || !saveableMode(cfg.mode)) return null;
  try {
    if (game.result) return null;
    const obj = {
      v: SAVE_VERSION,
      savedAt: Date.now(),
      cfg: {
        variantId: game.variant.id,
        mode: cfg.mode,
        humanColor: cfg.humanColor,
        level: cfg.level,
        levelWhite: cfg.levelWhite,
        levelBlack: cfg.levelBlack,
        epic: !!cfg.epic,
        giveaway: !!game.options.giveaway,
      },
      humanColor: humanColor === -1 ? -1 : 1,
      elapsedSec: Math.max(0, Math.round(Number(elapsedSec) || 0)),
      game: game.toJSON(),
    };
    storage.setItem(SAVE_KEY, JSON.stringify(obj));
    return obj;
  } catch (e) {
    return null; // quota / blocked storage: the game simply is not resumable
  }
}

export function clearSave(storage = defaultStorage()) {
  try {
    storage.removeItem(SAVE_KEY);
  } catch (e) {
    /* ignore */
  }
}

/** Validated save or null. A broken / finished save is removed. */
export function readSave(storage = defaultStorage()) {
  let raw = null;
  try {
    raw = storage.getItem(SAVE_KEY);
  } catch (e) {
    return null;
  }
  if (!raw) return null;
  const bad = () => {
    clearSave(storage);
    return null;
  };
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    return bad();
  }
  if (!obj || typeof obj !== 'object' || obj.v !== SAVE_VERSION || !obj.cfg || !obj.game) return bad();
  const cfg = obj.cfg;
  if (!saveableMode(cfg.mode)) return bad();
  let game;
  try {
    getVariant(cfg.variantId);
    game = Game.fromJSON(obj.game);
  } catch (e) {
    return bad();
  }
  if (game.variant.id !== cfg.variantId || game.result) return bad();
  const level = Math.min(5, Math.max(1, Math.round(Number(cfg.level) || 3)));
  const lv = (x) => (x == null ? undefined : Math.min(5, Math.max(1, Math.round(Number(x) || level))));
  return {
    cfg: {
      variantId: cfg.variantId,
      mode: cfg.mode,
      humanColor: cfg.humanColor === -1 ? -1 : cfg.humanColor === 0 ? 0 : 1,
      level,
      levelWhite: lv(cfg.levelWhite),
      levelBlack: lv(cfg.levelBlack),
      epic: !!cfg.epic,
      giveaway: !!game.options.giveaway,
    },
    humanColor: obj.humanColor === -1 ? -1 : 1,
    elapsedSec: Math.max(0, Number(obj.elapsedSec) || 0),
    savedAt: Number(obj.savedAt) || 0,
    game,
  };
}
