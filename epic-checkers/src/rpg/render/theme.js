// «Валькирии доски» — battle view look & timing data (pure, no Pixi, Node-testable).
//
// Colours come from the designer's data (src/rpg/data/rules.js) and are converted to Pixi hex
// numbers here once. Everything visual that is "data" lives in this file: element VFX recipes,
// reaction labels, status glyphs, rarity frames, board themes, timing budgets (GDD §18) and the
// floating-number style (GDD §18.4).

import { ELEMENTS, REACTIONS, RARITIES, STATUSES, ELEMENT_ORDER } from '../data/rules.js';
import { HEROES } from '../data/heroes.js';

export const hex = (c) => (typeof c === 'number' ? c & 0xffffff : parseInt(String(c).replace('#', ''), 16) & 0xffffff);
export const css = (h) => `#${(h & 0xffffff).toString(16).padStart(6, '0')}`;

/** Mix two hex colours: t = 0 → a, 1 → b. */
export function mix(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

/** Multiply the brightness of a hex colour (clamped per channel). */
export function shade(h, k) {
  const r = Math.min(255, Math.round(((h >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((h >> 8) & 255) * k));
  const b = Math.min(255, Math.round((h & 255) * k));
  return (r << 16) | (g << 8) | b;
}

// ------------------------------------------------------------------------------------- elements

/**
 * Per-element VFX recipe (GDD §18.2). `hit` / `bolt` / `area` / `trail` name the building blocks
 * implemented in vfx.js; `num` is the floating-number colour (readable on the dark board).
 */
const RECIPES = {
  flame: { hit: 'fireSlash', bolt: 'fireball', area: 'flameBurst', trail: 'embers', kanji: '炎', sfx: ['explosion', 'whoosh'], num: 0xff7a4a },
  tide: { hit: 'splash', bolt: 'waterOrb', area: 'waveRing', trail: 'droplets', kanji: '潮', sfx: ['whoosh', 'land'], num: 0x5aa8ff },
  frost: { hit: 'iceShatter', bolt: 'iceSpear', area: 'frostNova', trail: 'snow', kanji: '氷', sfx: ['shatter', 'slash'], num: 0x9ff0ff },
  storm: { hit: 'zap', bolt: 'bolt', area: 'thunderfall', trail: 'static', kanji: '雷', sfx: ['zap', 'thunder'], num: 0xc49bff },
  gale: { hit: 'windCut', bolt: 'windBlade', area: 'whirlwind', trail: 'wind', kanji: '風', sfx: ['whoosh', 'slash'], num: 0x5cf0b4 },
  terra: { hit: 'rockSmash', bolt: 'stoneShard', area: 'spikes', trail: 'dust', kanji: '岩', sfx: ['impact', 'bigImpact'], num: 0xf0b45a },
  radiance: { hit: 'starFlash', bolt: 'lightBeam', area: 'pillars', trail: 'sparkle', kanji: '光', sfx: ['sparkle', 'gong'], num: 0xfff2a8 },
  umbra: { hit: 'voidCut', bolt: 'shadowOrb', area: 'voidRift', trail: 'wisps', kanji: '闇', sfx: ['glitch', 'menacing'], num: 0xff5aa8 },
  none: { hit: 'plain', bolt: 'plainBolt', area: 'plainBurst', trail: 'none', kanji: '撃', sfx: ['impact', 'impact'], num: 0xffffff },
};

/** Element ids in the designer's order (rules.js ELEMENT_ORDER). */
export const ELEMENT_IDS = ELEMENT_ORDER.slice();

/** Visual spec of every element: colours (hex), names, kanji and the VFX recipe. */
export const ELEMENT_FX = Object.freeze(
  Object.fromEntries(
    [...ELEMENT_IDS, 'none'].map((id) => {
      const e = ELEMENTS[id];
      const r = RECIPES[id];
      const color = e ? hex(e.color) : 0xd8d2ff;
      const accent = e ? hex(e.accent) : 0xffffff;
      return [
        id,
        Object.freeze({
          id,
          name: e ? e.name : { ru: 'Без стихии', en: 'None', jp: '無' },
          kanji: e ? e.kanji : r.kanji,
          color,
          accent,
          dark: e ? hex(e.dark) : 0x1a1530,
          glow: mix(color, 0xffffff, 0.35),
          num: r.num,
          hit: r.hit,
          bolt: r.bolt,
          area: r.area,
          trail: r.trail,
          sfx: r.sfx,
          leavesSeal: e ? e.leavesSeal : false,
          slot: e ? e.slot : null,
        }),
      ];
    }),
  ),
);

/** Element spec, falling back to 'none' for unknown / missing elements. */
export function elementFx(id) {
  return ELEMENT_FX[id] || ELEMENT_FX.none;
}

// ------------------------------------------------------------------------------------ reactions

/** Reaction label specs (GDD §6, §18.4): «ПАР! 蒸» in the pair's two-colour gradient. */
export const REACTION_FX = Object.freeze(
  Object.fromEntries(
    Object.values(REACTIONS).map((r) => [
      r.id,
      Object.freeze({
        id: r.id,
        name: r.name,
        kanji: r.kanji,
        colors: [hex(r.color[0]), hex(r.color[1])],
        label: { ru: `${r.name.ru.toUpperCase()}! ${r.kanji}`, en: `${r.name.en.toUpperCase()}! ${r.kanji}` },
        kind: r.kind,
      }),
    ]),
  ),
);

export function reactionFx(id) {
  return REACTION_FX[id] || null;
}

// ------------------------------------------------------------------------------------- statuses

/** Kanji glyphs of the statuses (same set as the HUD chips in src/rpg/ui/icons.js). */
export const STATUS_GLYPHS = Object.freeze({
  burn: '燃', frozen: '凍', stun: '暈', root: '縛', slow: '遅', silence: '黙', taunt: '挑', mark: '印', brittle: '脆',
  weaken: '弱', blight: '蝕', inspire: '鼓', brace: '構', regen: '癒', shield: '盾', untargetable: '隠', charge: '電',
  crown: '冠', stagger: '揺', break: '砕',
});

/** Statuses never shown as a token icon (they have their own visual: crown, shield bubble, ice block). */
export const STATUS_HIDDEN = new Set(['crown', 'shield']);

/** Display priority of status icons on a token (lower first; at most 3 are shown). */
const STATUS_PRIORITY = ['frozen', 'stun', 'break', 'silence', 'root', 'taunt', 'burn', 'mark', 'brittle', 'blight', 'weaken', 'slow', 'stagger', 'charge', 'untargetable', 'inspire', 'regen', 'brace'];

export const STATUS_FX = Object.freeze(
  Object.fromEntries(
    Object.values(STATUSES).map((s) => [
      s.id,
      Object.freeze({ id: s.id, kind: s.kind, color: hex(s.color), glyph: STATUS_GLYPHS[s.id] || '?', name: s.name, order: (() => { const i = STATUS_PRIORITY.indexOf(s.id); return i < 0 ? 99 : i; })() }),
    ]),
  ),
);

/** The (≤ max) status ids to show on a token, most important first. */
export function visibleStatuses(statuses, max = 3) {
  if (!Array.isArray(statuses) || !statuses.length) return [];
  const ids = [];
  for (const st of statuses) {
    const id = st && (st.id || st);
    if (!id || STATUS_HIDDEN.has(id) || ids.includes(id) || !STATUS_FX[id]) continue;
    ids.push(id);
  }
  ids.sort((a, b) => STATUS_FX[a].order - STATUS_FX[b].order);
  return ids.slice(0, max);
}

// ------------------------------------------------------------------------------------- rarities

/**
 * Token frames by rarity (GDD §17.3): Rare steel-blue, Epic violet enamel + silver, Legendary
 * carved gold, Mythic iridescent (animated). `stops` = metal gradient (outer → inner light),
 * `gem` = crest colour, `glow` = soft additive glow (0 = none), `sheen` = animated iridescent pass.
 */
export const RARITY_FX = Object.freeze({
  rare: { id: 'rare', color: hex(RARITIES.rare.color), stops: [0x2b4d7a, 0x9fc6ff, 0x3c6aa8, 0xd8ecff], gem: 0x4fa3ff, glow: 0, sheen: false, stars: 3, tokenScale: 1 },
  epic: { id: 'epic', color: hex(RARITIES.epic.color), stops: [0x4a1f7a, 0xc89bff, 0x7a3fc0, 0xf0e4ff], gem: 0xb65cff, glow: 0.18, sheen: false, stars: 4, tokenScale: 1 },
  legendary: { id: 'legendary', color: hex(RARITIES.legendary.color), stops: [0x7a4a0a, 0xffe7a8, 0xc98a1a, 0xfff6d8], gem: 0xffb830, glow: 0.42, sheen: false, stars: 5, tokenScale: 1 },
  mythic: { id: 'mythic', color: hex(RARITIES.mythic.color), stops: [0xff4fd8, 0xffd23f, 0x6af0ff, 0xffffff], gem: 0xffffff, glow: 0.55, sheen: true, stars: 6, tokenScale: 1 },
});

export function rarityFx(id) {
  return RARITY_FX[id] || RARITY_FX.rare;
}

/** The Mythic shimmer cycle (pink → gold → cyan) as a function of time (seconds). */
export function iridescent(t) {
  const C = [0xff4fd8, 0xffd23f, 0x6af0ff];
  const u = ((t % 3) + 3) % 3;
  const i = Math.floor(u);
  return mix(C[i], C[(i + 1) % 3], u - i);
}

// ------------------------------------------------------------------------------------ sides / UI

/** Default side tints (the classic EPIC energy colours; renderer.epicSideColor overrides them).
 *  Shown as the token's outer band (the energy ring track) and the floor ring under it. */
export const SIDE_COLORS = Object.freeze({ 1: 0x29e6ff, [-1]: 0xff2e63 });
/** HP bar fills: allies green, enemies red (readable at a glance, GDD §17.9). */
export const HP_COLORS = Object.freeze({ 1: 0x52eb8a, [-1]: 0xff4d5e });
export const HP_TRAIL = 0xfff1d6;
export const SHIELD_COLOR = 0xd8f2ff;
export const ENERGY_COLOR = 0xffe9a8;
export const ENERGY_READY = 0xffd23f;
export const HEAL_COLOR = 0x5cff9d;
export const DRAIN_COLOR = 0xb27bff;
export const GOLD = 0xffd23f;

/** Highlight colours (classic palette: move dots / capture rings / last move). */
export const HL = Object.freeze({ move: 0x3ddc97, jump: 0xff4d4d, land: 0xffb547, target: 0xff6a3d, area: 0xff8a3d, ally: 0x5cff9d, selected: 0xffd23f });

// --------------------------------------------------------------------------------- board themes

/**
 * Arena board looks per background (GDD §14 chapters): light / dark squares, frame, accent glow,
 * ambient motes. `arena` = where the arena floor centre sits in the 1280×720 art (0..1).
 */
export const BOARD_THEMES = Object.freeze({
  'bg-dawn': {
    id: 'bg-dawn', arena: { x: 0.5, y: 0.56 },
    light: [0xd9cfb6, 0xb9ab8c], lightAlpha: 0.86, dark: [0x1f3a4e, 0x0d1a26], darkAlpha: 0.96,
    frame: [0xfff3d6, 0xc9a45a, 0x3a2a14], inlay: 0xe8b85a, gem: 0x6fd6ff, accent: 0x9fe8ff, rune: 0xbff2ff,
    motes: { color: 0xffe6a0, kind: 'pollen', count: 14 }, vignette: 0x0a1020, glow: 0.07,
  },
  'bg-ash': {
    id: 'bg-ash', arena: { x: 0.5, y: 0.54 },
    light: [0x6e625e, 0x4e4442], lightAlpha: 0.9, dark: [0x2a1414, 0x120809], darkAlpha: 0.96,
    frame: [0x8a6a5a, 0x3a2420, 0x0c0606], inlay: 0xff7a3a, gem: 0xff5b3a, accent: 0xff8a4a, rune: 0xffa060,
    motes: { color: 0xff9a4a, kind: 'embers', count: 18 }, vignette: 0x100406, glow: 0.12,
  },
  'bg-sky': {
    id: 'bg-sky', arena: { x: 0.5, y: 0.55 },
    light: [0xd6d2ec, 0xb2abd6], lightAlpha: 0.86, dark: [0x241c5c, 0x100b30], darkAlpha: 0.96,
    frame: [0xfafaff, 0xa9a0e0, 0x2a2258], inlay: 0xb9a8ff, gem: 0xffd23f, accent: 0xb9a8ff, rune: 0xd8ccff,
    motes: { color: 0xd8d0ff, kind: 'stars', count: 16 }, vignette: 0x06041a, glow: 0.1,
  },
});

export function boardTheme(bgId) {
  const id = typeof bgId === 'string' ? (bgId.startsWith('bg-') ? bgId : `bg-${bgId}`) : 'bg-dawn';
  return BOARD_THEMES[id] || BOARD_THEMES['bg-dawn'];
}

// ------------------------------------------------------------------------------------- timings

/**
 * Time budgets (GDD §18.1, ms at speed 1): quiet move ≤ 0.6 s, attack ≤ 1.2 s, each chain hop
 * ≤ 0.8 s, skill ≤ 1.8 s, Ultimate ≤ 4.0 s (Rare ≤ 2.5 s, Epic ≤ 3.5 s).
 */
export const BUDGET = Object.freeze({
  move: 600,
  attack: 1200,
  hop: 800,
  skill: 1800,
  ult: Object.freeze({ rare: 2500, epic: 3500, legendary: 4000, mythic: 4000 }),
  ko: 700,
  awaken: 1600,
});

/** Ultimate timeline marks (GDD §18.3), ms from the cast at speed 1, per cut-in kind. */
export const ULT_TIMELINE = Object.freeze({
  compact: { dim: 200, cutIn: 600, vfx: 1300, outro: 300 }, //   Rare:      ≤ 2.5 s
  band: { dim: 250, cutIn: 800, vfx: 1800, outro: 500 }, //       Epic:      ≤ 3.5 s (Legendary: +300 vfx)
  fullscreen: { dim: 250, cutIn: 1000, vfx: 2150, outro: 550 }, // Mythic:  ≤ 4.0 s
});

/** Cut-in kind of a rarity (rules.js RARITIES[r].cutIn). */
export function cutInKind(rarity) {
  const r = RARITIES[rarity];
  return r ? r.cutIn : 'compact';
}

/** Whole ult length (ms at speed 1) for a rarity — always within BUDGET.ult. */
export function ultLength(rarity) {
  const T = ULT_TIMELINE[cutInKind(rarity)] || ULT_TIMELINE.compact;
  const extra = rarity === 'legendary' ? 300 : 0;
  return T.dim + T.cutIn + T.vfx + extra + T.outro;
}

// ----------------------------------------------------------------------------- floating numbers

/**
 * Floating numbers (GDD §18.4): size in squares, rise 0.6 squares, readable hold scaled by
 * settings.textTime (default 1.5, like the classic readMs). Crit ×1.4, periodic ×0.7.
 */
export const NUMBER_STYLE = Object.freeze({
  size: 0.42,
  critScale: 1.4,
  dotScale: 0.7,
  reactionScale: 1.2,
  rise: 0.6,
  stackShift: 0.25,
  maxVisible: 6,
  collapseAfter: 3,
  baseHoldMs: 620, // full-alpha hold at textTime 1 (×1.5 by default → 930 ms)
  popMs: 140,
  fadeMs: 280,
});

/** Thousands separated by a narrow space: 2854 → "2 854". */
export function formatAmount(n) {
  const v = Math.max(0, Math.round(Math.abs(Number(n) || 0)));
  const s = String(v);
  if (s.length <= 3) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i && (s.length - i) % 3 === 0) out += ' ';
    out += s[i];
  }
  return out;
}

/** settings.textTime clamped (default 1.5 — the classic readability preference). */
export function textTimeOf(settings) {
  const v = Number(settings && settings.textTime);
  return Number.isFinite(v) && v > 0 ? Math.min(4, Math.max(0.5, v)) : 1.5;
}

/** Total visible life (ms) of a floating number. */
export function numberLifeMs(settings, { crit = false, reaction = false } = {}) {
  const S = NUMBER_STYLE;
  const hold = S.baseHoldMs * textTimeOf(settings) * (crit || reaction ? 1.25 : 1);
  return Math.round(S.popMs + hold + S.fadeMs);
}

// --------------------------------------------------------------------------------- ultimates

/** Every hero's ultimate VFX key (heroes.js ultimate.vfx, e.g. 'ult-liora'). */
export const ULT_KEYS = Object.freeze(HEROES.map((h) => (h.ultimate && h.ultimate.vfx) || `ult-${h.id}`));

/** Big kanji of each ultimate (GDD §18.3 table; Rare heroes use their element kanji). */
export const ULT_KANJI = Object.freeze({
  liora: '光', nocturna: '皇蝕', reika: '雷', fuyuka: '氷', vermilia: '不死鳥', tsubame: '嵐', mizuha: '潮', akane: '緋',
  volta: '落雷', koyuki: '吹雪', lucille: '祈', karasu: '夜', zlata: '砦', kaede: '嵐', torvald: '鉄', shio: '波',
  maren: '銛', mashiro: '雪', iskra: '電', sirin: '歌', falk: '岩', runa: '庭', vera: '暁', mara: '詐',
});

/** Words for overlays (ru / en). */
export const WORDS = Object.freeze({
  crit: { ru: 'КРИТ', en: 'CRIT' },
  ko: { ru: 'НОКАУТ!', en: 'K.O.!' },
  awaken: { ru: 'ПРОБУЖДЕНИЕ', en: 'AWAKENING' },
  crownLost: { ru: 'КОРОНА ПОТЕРЯНА', en: 'CROWN LOST' },
  extra: { ru: 'ЕЩЁ ХОД!', en: 'EXTRA TURN!' },
  revive: { ru: 'ВОЗРОЖДЕНИЕ', en: 'REVIVED' },
  survive: { ru: 'ВЫСТОЯЛА!', en: 'HOLDS ON!' },
  hits: { ru: 'УДАРОВ', en: 'HITS' },
  victory: { ru: 'ПОБЕДА', en: 'VICTORY' },
  defeat: { ru: 'ПОРАЖЕНИЕ', en: 'DEFEAT' },
  frozen: { ru: 'ЗАМОРОЖЕНА', en: 'FROZEN' },
  blocked: { ru: 'БЛОК', en: 'BLOCK' },
});

export function word(key, lang) {
  const w = WORDS[key];
  if (!w) return '';
  return lang === 'en' ? w.en : w.ru;
}
