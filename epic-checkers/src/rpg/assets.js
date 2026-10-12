// «Валькирии доски» — URLs of the shipped RPG art and voice (owner: assets).
//
//   import { RPG_ASSETS } from './assets.js';
//   RPG_ASSETS.splash('liora')            // 'rpg/splash/liora.webp'   1280×720, the whole art
//   RPG_ASSETS.card('liora')              // 'rpg/card/liora.webp'     480×640, 3:4 head-to-thigh crop
//   RPG_ASSETS.token('liora')             // 'rpg/token/liora.webp'    256×256 face crop (mask it to a circle)
//   RPG_ASSETS.bg('bg-dawn')              // 'rpg/bg/bg-dawn.webp'     1280×720 ('dawn' works too)
//   RPG_ASSETS.keyart                     // 'rpg/keyart.webp' (falls back to Liora's splash until key art ships)
//   RPG_ASSETS.voice('liora', 'ultimate') // 'rpg/voice/liora-ultimate.mp3' or null (Rare heroes / not generated)
//   RPG_ASSETS.focal('liora')             // { x, y } face centre in the splash, 0..1
//
// URLs are relative to the page (dist/www/index.html in the app, the asset origin in the APK).
// Demo pages under dist/dev/<demo>/ call setRpgAssetBase('../'): tools/rpg-assets.py mirrors
// web/static/rpg into dist/dev/rpg/.
//
// Files are produced by tools/rpg-assets.py from assets/rpg/** (crops in assets/rpg/crops.json).
// The block between the @generated markers is rewritten by that tool: never edit it by hand.

// @generated-begin tools/rpg-assets.py — do not edit by hand, run `python3 tools/rpg-assets.py`.
/** Face centre of every hero in its 1280×720 splash, 0..1 (from assets/rpg/crops.json). */
const FOCAL = {
  akane: [0.5203, 0.2653],
  falk: [0.4570, 0.2208],
  fuyuka: [0.5172, 0.1667],
  iskra: [0.4836, 0.2597],
  kaede: [0.4469, 0.1903],
  karasu: [0.5266, 0.1653],
  koyuki: [0.4117, 0.2153],
  liora: [0.4656, 0.1750],
  lucille: [0.4945, 0.2028],
  mara: [0.5219, 0.1944],
  maren: [0.4391, 0.1542],
  mashiro: [0.4992, 0.1653],
  mizuha: [0.4758, 0.1819],
  nocturna: [0.5141, 0.1819],
  reika: [0.4234, 0.2139],
  runa: [0.5062, 0.1764],
  shio: [0.5336, 0.1861],
  sirin: [0.5312, 0.1722],
  torvald: [0.5047, 0.1347],
  tsubame: [0.5078, 0.2389],
  vera: [0.5078, 0.1597],
  vermilia: [0.4844, 0.1639],
  volta: [0.4648, 0.2375],
  zlata: [0.4766, 0.1458],
};
/** Voice lines shipped in web/static/rpg/voice/ as `<heroId>-<event>` (others are absent). */
const VOICE_FILES = [
  'akane-skill', 'akane-summon', 'akane-ultimate', 'akane-victory', 'fuyuka-skill', 'fuyuka-summon',
  'fuyuka-ultimate', 'fuyuka-victory', 'kaede-skill', 'kaede-summon', 'kaede-ultimate', 'kaede-victory',
  'karasu-skill', 'karasu-summon', 'karasu-ultimate', 'karasu-victory', 'koyuki-skill', 'koyuki-summon',
  'koyuki-ultimate', 'koyuki-victory', 'liora-skill', 'liora-summon', 'liora-ultimate', 'liora-victory',
  'lucille-skill', 'lucille-summon', 'lucille-ultimate', 'lucille-victory', 'mizuha-skill', 'mizuha-summon',
  'mizuha-ultimate', 'mizuha-victory', 'nocturna-skill', 'nocturna-summon', 'nocturna-ultimate', 'nocturna-victory',
  'reika-skill', 'reika-summon', 'reika-ultimate', 'reika-victory', 'tsubame-skill', 'tsubame-summon',
  'tsubame-ultimate', 'tsubame-victory', 'vermilia-skill', 'vermilia-summon', 'vermilia-ultimate', 'vermilia-victory',
  'volta-skill', 'volta-summon', 'volta-ultimate', 'volta-victory', 'zlata-skill', 'zlata-summon',
  'zlata-ultimate', 'zlata-victory',
];
/** Whether web/static/rpg/keyart.webp is shipped. */
const HAS_KEYART = true;
// @generated-end

/** Voice events (same order as VOICE_EVENTS in data/voice-lines.js). */
export const RPG_VOICE_EVENTS = Object.freeze(['summon', 'skill', 'ultimate', 'victory']);

/** Aliases accepted by voice(): battle event kinds / short names → file event names. */
const EVENT_ALIASES = Object.freeze({ ult: 'ultimate', ultimate: 'ultimate', skill: 'skill', summon: 'summon', intro: 'summon', victory: 'victory', win: 'victory', mvp: 'victory' });

/** Battle backgrounds (campaign chapters 1–3). */
export const RPG_BG_IDS = Object.freeze(['bg-dawn', 'bg-ash', 'bg-sky']);

/** Expected face position when a hero has no measured crop (GDD §18.5). */
export const DEFAULT_FOCAL = Object.freeze({ x: 0.5, y: 0.27 });

/** Pixel sizes of the shipped images. */
export const RPG_IMAGE_SIZES = Object.freeze({
  splash: Object.freeze({ width: 1280, height: 720 }),
  card: Object.freeze({ width: 480, height: 640 }),
  token: Object.freeze({ width: 256, height: 256 }),
  bg: Object.freeze({ width: 1280, height: 720 }),
  keyart: Object.freeze({ width: 1280, height: 720 }),
});

const KEYART_FALLBACK_HERO = 'liora';
const VOICE_SET = new Set(VOICE_FILES);
const FOCAL_CACHE = new Map();

let base = '';

/**
 * Sets the URL prefix of every RPG asset ('' = relative to the page). Demo pages in
 * dist/dev/<demo>/ use '../' (the dist/dev/rpg mirror); a trailing slash is added when missing.
 */
export function setRpgAssetBase(prefix = '') {
  const p = String(prefix == null ? '' : prefix);
  base = p && !p.endsWith('/') ? p + '/' : p;
}

/** Current URL prefix (see setRpgAssetBase). */
export function rpgAssetBase() {
  return base;
}

/** Hero / background ids are lowercase slugs; anything else is escaped so it can't break the URL. */
const slug = (id) => encodeURIComponent(String(id == null ? '' : id).trim().toLowerCase());

const url = (path) => base + 'rpg/' + path;

function bgSlug(bgId) {
  const s = slug(bgId);
  return s.startsWith('bg-') ? s : 'bg-' + s;
}

/** Normalised voice event name, or null for an unknown event. */
export function voiceEventName(event) {
  const e = String(event == null ? '' : event).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(EVENT_ALIASES, e) ? EVENT_ALIASES[e] : null;
}

/** True when the voice line `<heroId>-<event>` is shipped. */
export function hasVoice(heroId, event) {
  const e = voiceEventName(event);
  return !!e && VOICE_SET.has(`${slug(heroId)}-${e}`);
}

function focal(id) {
  const key = slug(id);
  let f = FOCAL_CACHE.get(key);
  if (!f) {
    const v = Object.prototype.hasOwnProperty.call(FOCAL, key) ? FOCAL[key] : null;
    f = v ? Object.freeze({ x: v[0], y: v[1] }) : DEFAULT_FOCAL;
    FOCAL_CACHE.set(key, f);
  }
  return f;
}

export const RPG_ASSETS = Object.freeze({
  /** 1280×720 WebP: the whole hero art (cut-ins, Mythic splash, hero screen). */
  splash: (id) => url(`splash/${slug(id)}.webp`),
  /** 480×640 WebP: 3:4 portrait crop, head to thigh (collection / squad cards). */
  card: (id) => url(`card/${slug(id)}.webp`),
  /** 256×256 WebP: square face crop, face centred (board token; apply the circle mask at render time). */
  token: (id) => url(`token/${slug(id)}.webp`),
  /** 1280×720 WebP battle background: 'bg-dawn' | 'bg-ash' | 'bg-sky' (the 'bg-' prefix is optional). */
  bg: (bgId) => url(`bg/${bgSlug(bgId)}.webp`),
  /** 1280×720 WebP mode key art; Liora's splash until the key art is generated (see hasKeyart). */
  get keyart() {
    return HAS_KEYART ? url('keyart.webp') : url(`splash/${KEYART_FALLBACK_HERO}.webp`);
  },
  /** Whether the real key art is shipped (keyart is a fallback otherwise). */
  hasKeyart: HAS_KEYART,
  /**
   * MP3 URL of a voice line, or null when it is not shipped (Rare heroes have no voice; lines may
   * still be missing while they are generated). event: 'summon' | 'skill' | 'ultimate' | 'victory'
   * (aliases: 'ult', 'win', 'intro').
   */
  voice(heroId, event) {
    const e = voiceEventName(event);
    if (!e) return null;
    const name = `${slug(heroId)}-${e}`;
    return VOICE_SET.has(name) ? url(`voice/${name}.mp3`) : null;
  },
  /** Face centre in the splash as { x, y } fractions 0..1 (frozen); DEFAULT_FOCAL for unknown ids. */
  focal,
  /** All image URLs of one hero (for preloading). */
  heroImages: (id) => ({ splash: url(`splash/${slug(id)}.webp`), card: url(`card/${slug(id)}.webp`), token: url(`token/${slug(id)}.webp`) }),
  /** Every voice URL of one hero that is shipped ({ event: url }, possibly empty). */
  heroVoices(heroId) {
    const out = {};
    for (const e of RPG_VOICE_EVENTS) {
      const name = `${slug(heroId)}-${e}`;
      if (VOICE_SET.has(name)) out[e] = url(`voice/${name}.mp3`);
    }
    return out;
  },
  /** Hero ids that have measured crops (= shipped art). */
  heroIds: Object.freeze(Object.keys(FOCAL)),
  bgIds: RPG_BG_IDS,
  voiceEvents: RPG_VOICE_EVENTS,
  sizes: RPG_IMAGE_SIZES,
  hasVoice,
  setBase: setRpgAssetBase,
  get base() {
    return base;
  },
});

export default RPG_ASSETS;
