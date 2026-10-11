// Personal settings as FX / the Director read them (SETTINGS CONTRACT, src/ui/storage.js), plus
// the single READABILITY rule every text overlay follows.
//
//   readMs(text, kind, settingsOrTextTime) -> ms a text must stay readable (at full size):
//       max(READ_BASE[kind], READ_LEAD + READ_PER_CHAR × visible characters) × settings.textTime
//   visibleChars(text)            characters a reader has to read (no spaces / invisible marks)
//   textTimeOf(settings)          settings.textTime (default 1.5, clamped 0.5..4)
//   animSpeedOf(settings)         settings.animSpeed (default 1, clamped 0.25..4; < 1 = slower)
//   fxPref(settings, key)         one settings.fx field, validated, with the contract default
//   hapticsOf(settings)           'off' | 'light' | 'strong' (old boolean `vibration` understood)
//   hapticScale(pattern, level)   web vibration pattern for a level ('light' halves every pulse)
//   bragRate(settings)            caption rate limits for settings.fx.brags
//   MIN_VISIBLE_SHARE             a newer text may only cut an older one that has been readable
//                                 for at least this share of its readable time (the player's tap
//                                 to skip is the only exception)
//
//   epicSideColor(renderer, side) the side's energy colour: renderer.sideColor(side) (the player's
//                                 chosen colour) or the palette; toHex('#29E6FF') -> 0x29e6ff
//
// Everything is null-safe: a missing settings object behaves like DEFAULT_SETTINGS.

import { EPIC } from '../render/palette.js';

/** Readable time (ms, at textTime 1) per kind of text overlay. */
export const READ_BASE = Object.freeze({
  caption: 2600, //  brag / taunt speech bubbles
  banner: 1500, //   turn banners («ТВОЙ ХОД», «ОБЯЗАТЕЛЬНЫЙ БОЙ!»)
  kanji: 1100, //    onomatopoeia at full size (斬! 覚醒 …)
  cutin: 1800, //    cut-in title + attack name
  combo: 2200, //    combo counter after the last hit
  vs: 2200, //       VS screen: names, titles, power levels
  title: 1600, //    big centre banners («ДА НАЧНЁТСЯ БИТВА!»)
  promo: 2200, //    «ПРОБУЖДЕНИЕ» banner
  ultimate: 2200, // «Тайная техника: …»
  hype: 1800, //     «ЯРОСТЬ 100%!»
  gameover: 3000, // victory / defeat / draw banners and their brag lines
  toast: 2000, //    small HUD toasts (UI)
});
export const READ_LEAD = 700;
export const READ_PER_CHAR = 70;
export const DEFAULT_TEXT_TIME = 1.5;
export const MIN_VISIBLE_SHARE = 0.6;

const INVISIBLE = /[\s​-‏⁠️]/g;

/** Number of characters a reader has to read (whitespace / joiners do not count). */
export function visibleChars(text) {
  if (text == null) return 0;
  return Array.from(String(text).replace(INVISIBLE, '')).length;
}

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** settings.textTime (how long texts stay readable), default 1.5. */
export function textTimeOf(settings) {
  if (typeof settings === 'number') return clamp(num(settings, DEFAULT_TEXT_TIME), 0.5, 4);
  return clamp(num(settings && settings.textTime, DEFAULT_TEXT_TIME), 0.5, 4);
}

/** settings.animSpeed (motion speed multiplier, < 1 = slower), default 1. */
export function animSpeedOf(settings) {
  return clamp(num(settings && settings.animSpeed, 1), 0.25, 4);
}

/**
 * How long (ms) `text` must stay on screen, readable at full size:
 * max(READ_BASE[kind], 700 + 70 ms × visible characters) × textTime.
 * `text` may be an array (several lines shown together: their characters add up).
 */
export function readMs(text, kind = 'caption', settings = null) {
  const chars = Array.isArray(text) ? text.reduce((n, t) => n + visibleChars(t), 0) : visibleChars(text);
  const base = READ_BASE[kind] != null ? READ_BASE[kind] : READ_BASE.caption;
  return Math.round(Math.max(base, READ_LEAD + READ_PER_CHAR * chars) * textTimeOf(settings));
}

/** Contract defaults of settings.fx (src/ui/storage.js DEFAULT_FX). */
export const FX_DEFAULTS = Object.freeze({
  shake: 1,
  flashes: true,
  slowmo: true,
  camera: true,
  cutins: true,
  kanji: true,
  brags: 'normal',
  turnBanners: true,
  combo: true,
  particles: 1,
  auras: true,
  backdrop: true,
  vsIntro: true,
});
const BRAG_LEVELS = ['off', 'rare', 'normal', 'often'];

/** One settings.fx field, validated (wrong types fall back to the contract default). */
export function fxPref(settings, key) {
  const d = FX_DEFAULTS[key];
  const f = settings && settings.fx;
  const v = f && typeof f === 'object' ? f[key] : undefined;
  if (key === 'shake') return Number.isFinite(+v) && v !== null && v !== '' ? clamp(+v, 0, 1.5) : d;
  if (key === 'particles') return Number.isFinite(+v) && v !== null && v !== '' ? clamp(+v, 0.25, 1.5) : d;
  if (key === 'brags') return BRAG_LEVELS.includes(v) ? v : d;
  return typeof v === 'boolean' ? v : d;
}

/** settings.haptics ('off' | 'light' | 'strong'); the old boolean `vibration: false` means 'off'. */
export function hapticsOf(settings) {
  const h = settings && settings.haptics;
  if (h === 'off' || h === 'light' || h === 'strong') return h;
  if (h === false) return 'off';
  return settings && settings.vibration === false ? 'off' : 'strong';
}

/** A web vibration pattern for a haptics level: null when 'off'; 'light' halves every pulse. */
export function hapticScale(pattern, level) {
  if (!pattern || level === 'off') return null;
  if (level !== 'light') return pattern.slice();
  return pattern.map((v, i) => (i % 2 ? v : Math.max(6, Math.round(v * 0.5))));
}

/**
 * Brag caption pacing for settings.fx.brags: chance multiplier, minimum moves between two captions
 * of a side, cooldown (ms) between any two captions and the cap per 30 s.
 */
export function bragRate(settings) {
  switch (fxPref(settings, 'brags')) {
    case 'off':
      return { level: 'off', chance: 0, gap: Infinity, cooldown: Infinity, per30: 0 };
    case 'rare':
      return { level: 'rare', chance: 0.4, gap: 3, cooldown: 9000, per30: 2 };
    case 'often':
      return { level: 'often', chance: 1.25, gap: 0, cooldown: 2400, per30: 8 };
    default:
      return { level: 'normal', chance: 1, gap: 1, cooldown: 4200, per30: 5 };
  }
}

/** '#29E6FF' | 0x29e6ff -> 0x29e6ff (null when not a colour). */
export function toHex(c) {
  if (typeof c === 'number' && Number.isFinite(c)) return c & 0xffffff;
  if (typeof c === 'string') {
    const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
    if (m) return parseInt(m[1], 16);
  }
  return null;
}

/**
 * Epic energy colour of a side: renderer.sideColor(side) (the player's chosen colour, the single
 * source of side colours) when the renderer has it, else the palette (#29E6FF / #FF2E63).
 */
export function epicSideColor(renderer, side) {
  if (renderer && typeof renderer.sideColor === 'function') {
    try {
      const c = toHex(renderer.sideColor(side));
      if (c != null) return c;
    } catch (e) {
      /* fall back to the palette */
    }
  }
  return EPIC.side[side] != null ? EPIC.side[side] : EPIC.white;
}
