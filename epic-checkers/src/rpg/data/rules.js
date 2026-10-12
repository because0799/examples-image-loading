// «Валькирии доски» (Board Valkyries, 盤上戦姫) — rules data for the RPG mode.
//
// Source of truth for every number in docs/RPG-DESIGN.md (the GDD). Pure data + a few tiny pure
// helpers; no imports, no side effects, usable from the game, the AI worker and Node tests.
// Effect / shape / trigger vocabulary used by heroes.js is specified in ./effects.md.
//
// Conventions (same as the classic engine, see ARCHITECTURE.md):
//   8×8 board, sq = row * 8 + col, row 0 = top. Playable squares are the DARK ones: (row + col) odd.
//   The player's squad deploys on rows 6–7 and awakens on row 0; the enemy deploys on rows 0–1 and
//   awakens on row 7. "Distance" = Chebyshev distance max(|dr|, |dc|) between two dark squares.
//   "Turn" = one side's turn (exactly ONE hero is activated); "round" = player turn + enemy turn.
//   Durations ("turns") tick down at the END of the affected unit's own side turn.
//   Percentages are fractions (0.25 = 25 %). Multipliers apply to the attacker's ATK unless stated.

export const MODE = {
  id: 'valkyries',
  name: { ru: 'Валькирии доски', en: 'Board Valkyries', jp: '盤上戦姫' },
  tagline: { ru: 'Шашки, которые стали легендой', en: 'Checkers that became a legend' },
  version: 1,
};

// ---------------------------------------------------------------------------------- board / battle

export const BOARD = {
  size: 8,
  playable: 'dark', // (row + col) % 2 === 1
  deployRows: { player: [6, 7], enemy: [0, 1] }, // 8 dark squares per side, 6 heroes
  awakenRow: { player: 0, enemy: 7 },
  squadSize: 6,
};

export const BATTLE = {
  roundLimit: 30, // default; stages may override (see CAMPAIGN in the GDD)
  firstSide: 'player', // campaign default; 'enemy' for ambush stages; Duel = coin toss
  activationsPerTurn: 1,
  tieEpsilon: 0.005, // |hpPctA - hpPctB| <= 0.5 % at the round limit -> draw
  // Activation = [move] then [action]  OR  a jump-strike chain  OR  wait.
  wait: { energy: 10, status: { id: 'brace', turns: 1 } },
  moveOnlyEnergy: 10,
  // Push / pull into a blocker (edge, unit, ward): the moved unit takes collision damage.
  collision: { mult: 0.3, stat: 'atk', trueDamage: true, blockerShare: 0.5 },
  wardBaseDef: 0, // wards ignore seals/statuses, never react, do not count for victory / HP %
};

// ------------------------------------------------------------------------------------- elements

// natural = can hold a seal in the natural slot; celestial = seal in the celestial slot.
// leavesSeal = false: the element only TRIGGERS reactions (Вихрь, Твердь), it never seals.
export const ELEMENTS = {
  flame: {
    id: 'flame', name: { ru: 'Пламя', en: 'Flame', jp: '炎' }, kanji: '炎',
    color: '#FF5B3A', accent: '#FFC24B', dark: '#3A0F12', slot: 'natural', leavesSeal: true,
    icon: { ru: 'перо-язык пламени в ромбе', en: 'flame-shaped feather inside a rhombus' },
    vfx: 'embers, fire-slash arcs, heat shimmer, burn rim flicker on the token',
  },
  tide: {
    id: 'tide', name: { ru: 'Прилив', en: 'Tide', jp: '潮' }, kanji: '潮',
    color: '#2E8BFF', accent: '#8FF3FF', dark: '#0B2A55', slot: 'natural', leavesSeal: true,
    icon: { ru: 'капля с волной внутри', en: 'droplet with a wave inside' },
    vfx: 'water rings, droplets, wave arcs, foam',
  },
  frost: {
    id: 'frost', name: { ru: 'Иней', en: 'Frost', jp: '氷' }, kanji: '氷',
    color: '#8EEBFF', accent: '#FFFFFF', dark: '#24506B', slot: 'natural', leavesSeal: true,
    icon: { ru: 'шестилучевая снежинка-кристалл', en: 'six-pointed crystal snowflake' },
    vfx: 'ice shards, growing frost crystals, cold mist; Frozen = token encased in an ice block',
  },
  storm: {
    id: 'storm', name: { ru: 'Гроза', en: 'Storm', jp: '雷' }, kanji: '雷',
    color: '#A46BFF', accent: '#F4E9FF', dark: '#2A1650', slot: 'natural', leavesSeal: true,
    icon: { ru: 'ломаная молния в круге', en: 'jagged bolt in a circle' },
    vfx: 'forked lightning (fx.lightning), violet sparks, static crackle',
  },
  gale: {
    id: 'gale', name: { ru: 'Вихрь', en: 'Gale', jp: '風' }, kanji: '風',
    color: '#3BE3A0', accent: '#D9FFF0', dark: '#0E3B2E', slot: 'natural', leavesSeal: false,
    icon: { ru: 'спираль из трёх перьев', en: 'spiral of three feathers' },
    vfx: 'spiralling leaves and feathers, wind speed-lines, dust swirls',
  },
  terra: {
    id: 'terra', name: { ru: 'Твердь', en: 'Terra', jp: '岩' }, kanji: '岩',
    color: '#E3A13B', accent: '#FFE7B0', dark: '#4A2F10', slot: 'natural', leavesSeal: false,
    icon: { ru: 'шестигранный янтарный кристалл', en: 'hexagonal amber crystal' },
    vfx: 'rock debris, amber crystals, ground-crack decals (fx.crack)',
  },
  radiance: {
    id: 'radiance', name: { ru: 'Сияние', en: 'Radiance', jp: '光' }, kanji: '光',
    color: '#FFF0A0', accent: '#FFFFFF', dark: '#6B5418', slot: 'celestial', leavesSeal: true,
    icon: { ru: 'восьмилучевая звезда с нимбом', en: 'eight-pointed star with a halo' },
    vfx: 'light pillars (fx.pillar), halo rings, white feathers, sparkles, bloom',
  },
  umbra: {
    id: 'umbra', name: { ru: 'Сумрак', en: 'Umbra', jp: '闇' }, kanji: '闇',
    color: '#D7337E', accent: '#8A7CFF', dark: '#1A0820', slot: 'celestial', leavesSeal: true,
    icon: { ru: 'полумесяц, поглощающий звезду', en: 'crescent swallowing a star' },
    vfx: 'ink tendrils, inverted colours, magenta-black void, chromatic aberration',
  },
};

export const ELEMENT_ORDER = ['flame', 'tide', 'frost', 'storm', 'gale', 'terra', 'radiance', 'umbra'];

// Element multiplier applied to every damage instance (DAMAGE.formula, factor ELEM).
export const ELEMENT_MULT = {
  sameElement: 0.8, // a hero takes ×0.8 from her own element
  opposed: { radiance: 'umbra', umbra: 'radiance' }, // Radiance <-> Umbra: ×1.3 both ways
  opposedMult: 1.3,
  default: 1.0,
};

export function elementMult(attackEl, targetEl) {
  if (!attackEl || attackEl === 'none') return 1;
  if (attackEl === targetEl) return ELEMENT_MULT.sameElement;
  if (ELEMENT_MULT.opposed[attackEl] === targetEl) return ELEMENT_MULT.opposedMult;
  return ELEMENT_MULT.default;
}

// Elemental SEALS («Печать стихии») — not to be confused with the status «Метка» (mark).
export const SEALS = {
  name: { ru: 'Печать стихии', en: 'Element Seal' },
  duration: 2, // turns of the sealed unit's side
  // A unit holds at most ONE natural seal and ONE celestial seal.
  // Hit by element X on a slot holding Y: X == Y -> refresh; REACTION(X, Y) -> react, consume Y,
  // X is NOT applied; no reaction -> X replaces Y (only for elements with leavesSeal).
  // Wards never carry seals.
};

// ------------------------------------------------------------------------------------ reactions

// trigger: the element of the incoming hit; consumes: the seal on the target. Symmetric unless
// noted (Пар fires for Flame on Tide/Frost AND Tide/Frost on Flame).
// Reaction strength scales with the TRIGGERING hero's Affinity (AFF):
//   amplify:  mult' = 1 + (mult - 1) * (1 + AFF / 200)
//   damage:   ATK_trig * coef * (1 + AFF / 200) * DEF factor of each victim (crit cannot apply)
// AFF is capped at 200. Mystic role trait multiplies the final reaction effect by 1.2.
export const REACTIONS = {
  steam: {
    id: 'steam', name: { ru: 'Пар', en: 'Steam' }, kanji: '蒸',
    pairs: [['flame', 'tide'], ['flame', 'frost']],
    kind: 'amplify', mult: 1.5,
    desc: { ru: 'Удар, вызвавший реакцию, наносит ×1.5 урона.', en: 'The triggering hit deals ×1.5 damage.' },
    color: ['#FF5B3A', '#8FF3FF'],
  },
  detonation: {
    id: 'detonation', name: { ru: 'Детонация', en: 'Detonation' }, kanji: '爆',
    pairs: [['flame', 'storm']],
    kind: 'damage', coef: 1.0, splashCoef: 0.6, splash: { shape: 'radius', r: 1, center: 'target', side: 'enemy' },
    push: 1,
    desc: {
      ru: 'Взрыв: цель получает 100% ATK доп. урона, враги вокруг неё (радиус 1) — 60%; цель отбрасывает на 1 клетку.',
      en: 'Blast: +100% ATK bonus damage to the target, 60% to enemies within radius 1; target is pushed 1 square.',
    },
    color: ['#FF5B3A', '#A46BFF'],
  },
  shackles: {
    id: 'shackles', name: { ru: 'Оковы', en: 'Shackles' }, kanji: '凍',
    pairs: [['tide', 'frost']],
    kind: 'control', status: { id: 'frozen', turns: 1 },
    desc: {
      ru: 'Цель заморожена на 1 ход: не может действовать; следующий удар по ней ×1.4 и разбивает лёд.',
      en: 'Target is Frozen for 1 turn: cannot act; the next hit on it deals ×1.4 and breaks the ice.',
    },
    color: ['#2E8BFF', '#8EEBFF'],
  },
  arc: {
    id: 'arc', name: { ru: 'Разряд', en: 'Arc' }, kanji: '電',
    pairs: [['tide', 'storm']],
    kind: 'damage', coef: 0.6, chain: { count: 2, range: 2, coef: 0.5, applySeal: 'storm' },
    desc: {
      ru: 'Ток: цель получает 60% ATK доп. урона, затем разряд перескакивает на 2 ближайших врагов в пределах 2 клеток (50% ATK, печать Грозы).',
      en: 'Current: +60% ATK bonus damage, then arcs to the 2 nearest enemies within 2 squares (50% ATK each, apply a Storm seal).',
    },
    color: ['#2E8BFF', '#A46BFF'],
  },
  brittle: {
    id: 'brittle', name: { ru: 'Хрупкость', en: 'Brittleness' }, kanji: '脆',
    pairs: [['frost', 'storm']],
    kind: 'control', statuses: [{ id: 'brittle', turns: 2 }, { id: 'slow', turns: 1 }],
    desc: {
      ru: 'Защита цели −35% на 2 хода и Замедление на 1 ход.',
      en: "Target's DEF −35% for 2 turns and Slow for 1 turn.",
    },
    color: ['#8EEBFF', '#A46BFF'],
  },
  vortex: {
    id: 'vortex', name: { ru: 'Воронка', en: 'Vortex' }, kanji: '渦',
    trigger: ['gale'], consumes: ['flame', 'tide', 'frost', 'storm'],
    kind: 'damage', coef: 0.5, spread: { shape: 'radius', r: 1, center: 'target', side: 'enemy' },
    push: 1,
    desc: {
      ru: 'Вихрь подхватывает стихию печати: враги в радиусе 1 от цели получают 50% ATK урона этой стихии и её печать (если у них нет другой); цель отбрасывает на 1.',
      en: 'The wind carries the sealed element: enemies within radius 1 of the target take 50% ATK damage of that element and gain its seal (if they have none); the target is pushed 1.',
    },
    note: 'Spread seals never trigger reactions themselves (no chains).',
    color: ['#3BE3A0', '#FFFFFF'],
  },
  facet: {
    id: 'facet', name: { ru: 'Огранка', en: 'Facet' }, kanji: '晶',
    trigger: ['terra'], consumes: ['flame', 'tide', 'frost', 'storm'],
    kind: 'shield', shield: { pctMaxHp: 0.15, turns: 2, who: 'triggerer' }, status: { id: 'root', turns: 1 },
    desc: {
      ru: 'Печать кристаллизуется: героиня, вызвавшая реакцию, получает щит 15% своего макс. HP на 2 хода; цель Обездвижена на 1 ход.',
      en: 'The seal crystallises: the triggering hero gains a shield of 15% of her max HP for 2 turns; the target is Rooted for 1 turn.',
    },
    color: ['#E3A13B', '#FFE7B0'],
  },
  eclipse: {
    id: 'eclipse', name: { ru: 'Затмение', en: 'Eclipse' }, kanji: '蝕',
    pairs: [['radiance', 'umbra']],
    kind: 'amplify', mult: 2.0, status: { id: 'silence', turns: 1 },
    desc: {
      ru: 'Свет встречает Сумрак: удар наносит ×2 урона и накладывает Немоту на 1 ход.',
      en: 'Light meets Umbra: the hit deals ×2 damage and Silences the target for 1 turn.',
    },
    color: ['#FFF0A0', '#D7337E'],
  },
};

/** Which reaction fires when a hit of `hitEl` lands on a unit carrying the seal `sealEl`, or null. */
export function reactionFor(hitEl, sealEl) {
  if (!hitEl || !sealEl || hitEl === sealEl) return null;
  for (const r of Object.values(REACTIONS)) {
    if (r.pairs) {
      for (const [a, b] of r.pairs) if ((a === hitEl && b === sealEl) || (a === sealEl && b === hitEl)) return r.id;
    } else if (r.trigger.includes(hitEl) && r.consumes.includes(sealEl)) return r.id;
  }
  return null;
}

// ---------------------------------------------------------------------------------------- roles

// Movement types:  step N  = up to N single diagonal steps onto empty dark squares (may turn);
//                  glide N = slide 1..N squares along ONE diagonal, all squares empty;
//                  blink N = teleport to any empty dark square within distance N.
// Basic attack los: 'adjacent' (distance 1), 'diag' (first unit along a diagonal ray, blocked by
//                  any unit/ward), 'free' (any unit within distance, ignores blockers).
// Jump-strike: over a diagonally adjacent enemy (or enemy ward) onto an empty square behind it
//   (landMax = how many empty squares beyond the victim she may choose to land on).
//   Hop n deals ATK * mult * (1 + comboStep * (n - 1)). A unit can be jumped once per chain.
export const ROLES = {
  guardian: {
    id: 'guardian', name: { ru: 'Страж', en: 'Guardian' }, icon: 'shield',
    move: { type: 'step', steps: 1 },
    basic: { range: 1, los: 'adjacent', mult: 1.0 },
    jump: { mult: 1.0, chainMax: 2, comboStep: 0.10, landMax: 1 },
    trait: {
      id: 'bulwark', name: { ru: 'Заслон', en: 'Bulwark' },
      desc: {
        ru: 'Союзники по диагонали рядом со Стражем получают на 15% меньше урона (не суммируется).',
        en: 'Allies diagonally adjacent to a Guardian take 15% less damage (does not stack).',
      },
      params: { range: 1, damageTakenPct: -0.15 },
    },
    base: { hp: 820, atk: 110, def: 75, crit: 5, aff: 20 },
    ai: { targetValue: 0.8 },
  },
  blade: {
    id: 'blade', name: { ru: 'Клинок', en: 'Blade' }, icon: 'sword',
    move: { type: 'step', steps: 2 },
    basic: { range: 1, los: 'adjacent', mult: 1.0 },
    jump: { mult: 1.2, chainMax: 3, comboStep: 0.15, landMax: 1 },
    trait: {
      id: 'onslaught', name: { ru: 'Натиск', en: 'Onslaught' },
      desc: {
        ru: 'Бонус комбо +15% за каждый следующий прыжок (у других ролей +10%). Цепочка из 2+ прыжков даёт ещё +10 энергии.',
        en: 'Combo bonus +15% per extra hop (other roles +10%). A chain of 2+ hops grants +10 more energy.',
      },
      params: { comboStep: 0.15, chainEnergy: 10, chainMinHops: 2 },
    },
    base: { hp: 600, atk: 220, def: 40, crit: 15, aff: 20 },
    ai: { targetValue: 1.0 },
  },
  ranger: {
    id: 'ranger', name: { ru: 'Стрелок', en: 'Ranger' }, icon: 'bow',
    move: { type: 'step', steps: 1 },
    basic: { range: 4, los: 'diag', mult: 0.9, pointBlankMult: 0.6 },
    jump: { mult: 0.8, chainMax: 1, comboStep: 0.10, landMax: 1 },
    trait: {
      id: 'steady-aim', name: { ru: 'Прицел', en: 'Steady Aim' },
      desc: {
        ru: '+15% урона, если в этой активации героиня не двигалась. Выстрел в упор (соседняя клетка) — только 60%.',
        en: '+15% damage if she did not move this activation. Point-blank shots (adjacent) deal only 60%.',
      },
      params: { noMoveDamagePct: 0.15 },
    },
    base: { hp: 540, atk: 230, def: 28, crit: 15, aff: 20 },
    ai: { targetValue: 1.15 },
  },
  mystic: {
    id: 'mystic', name: { ru: 'Мистик', en: 'Mystic' }, icon: 'orb',
    move: { type: 'step', steps: 1 },
    basic: { range: 2, los: 'free', mult: 0.8 },
    jump: { mult: 0.8, chainMax: 1, comboStep: 0.10, landMax: 1 },
    trait: {
      id: 'resonator', name: { ru: 'Резонатор', en: 'Resonator' },
      desc: {
        ru: 'Реакции, вызванные Мистиком, сильнее на 20%.',
        en: 'Reactions triggered by a Mystic are 20% stronger.',
      },
      params: { reactionPct: 0.2 },
    },
    base: { hp: 560, atk: 210, def: 30, crit: 5, aff: 80 },
    ai: { targetValue: 1.2 },
  },
  oracle: {
    id: 'oracle', name: { ru: 'Оракул', en: 'Oracle' }, icon: 'staff',
    move: { type: 'step', steps: 1 },
    basic: { range: 2, los: 'free', mult: 0.6, allyHeal: { mult: 0.8, stat: 'atk' } },
    jump: { mult: 0.7, chainMax: 1, comboStep: 0.10, landMax: 1 },
    trait: {
      id: 'bond', name: { ru: 'Связь', en: 'Bond' },
      desc: {
        ru: 'Обычная атака по союзнику лечит его на 80% ATK. Любое лечение или щит от Оракула даёт цели +5 энергии.',
        en: 'Basic attack on an ally heals 80% ATK instead. Any heal or shield from an Oracle grants the target +5 energy.',
      },
      params: { energyOnSupport: 5 },
    },
    base: { hp: 600, atk: 160, def: 42, crit: 5, aff: 40 },
    ai: { targetValue: 1.3 },
  },
  shadow: {
    id: 'shadow', name: { ru: 'Тень', en: 'Shadow' }, icon: 'dagger',
    move: { type: 'glide', length: 3 },
    basic: { range: 1, los: 'adjacent', mult: 1.0 },
    jump: { mult: 1.1, chainMax: 2, comboStep: 0.10, landMax: 2 },
    trait: {
      id: 'backstab', name: { ru: 'Удар в спину', en: 'Backstab' },
      desc: {
        ru: '+25% к шансу крита по одиночным целям (рядом с целью по диагонали нет её союзников).',
        en: '+25% crit chance against isolated targets (no ally of the target diagonally adjacent).',
      },
      params: { critChance: 25, cond: 'targetIsolated' },
    },
    base: { hp: 520, atk: 230, def: 28, crit: 25, aff: 20 },
    ai: { targetValue: 1.1 },
  },
};

export const ROLE_ORDER = ['guardian', 'blade', 'ranger', 'mystic', 'oracle', 'shadow'];

// -------------------------------------------------------------------------------------- rarities

export const RARITIES = {
  rare: {
    id: 'rare', name: { ru: 'Редкая', en: 'Rare' }, stars: 3,
    color: '#4FA3FF', glow: '#BFE0FF',
    frame: 'brushed steel-blue frame, single inner line, small sapphire at the top',
    rate: 0.825, statMult: 1.0, growthPct: 0.068, ultCost: [60, 70], voiced: false,
    cutIn: 'compact', ultMaxMs: 2500, dupDustAfterC6: 20,
  },
  epic: {
    id: 'epic', name: { ru: 'Эпическая', en: 'Epic' }, stars: 4,
    color: '#B65CFF', glow: '#E6C8FF',
    frame: 'violet enamel frame with silver filigree and amethyst corners',
    rate: 0.15, statMult: 1.08, growthPct: 0.070, ultCost: [70, 100], voiced: true,
    cutIn: 'band', ultMaxMs: 3500, dupDustAfterC6: 60,
  },
  legendary: {
    id: 'legendary', name: { ru: 'Легендарная', en: 'Legendary' }, stars: 5,
    color: '#FFB830', glow: '#FFE7A8',
    frame: 'ornate gold frame, engraved laurels, soft animated glow, topaz crest',
    rate: 0.02, statMult: 1.16, growthPct: 0.072, ultCost: [80, 90], voiced: true,
    cutIn: 'band', ultMaxMs: 4000, dupDustAfterC6: 200,
  },
  mythic: {
    id: 'mythic', name: { ru: 'Мифическая', en: 'Mythic' }, stars: 6,
    color: '#FF4FD8', glow: '#6AF0FF', gradient: ['#FF4FD8', '#FFD23F', '#6AF0FF'],
    frame: 'iridescent animated frame (pink-gold-cyan shimmer), drifting star particles, crown crest',
    rate: 0.005, statMult: 1.22, growthPct: 0.074, ultCost: [90, 100], voiced: true,
    cutIn: 'fullscreen', ultMaxMs: 4000, dupDustAfterC6: 300,
  },
};

export const RARITY_ORDER = ['rare', 'epic', 'legendary', 'mythic'];

// -------------------------------------------------------------------------------------- statuses

// kind: buff | debuff | control | special. stack: 'refresh' (re-apply = max(turns), max(value)),
// 'max' (keep the larger value), 'stacks' (counter up to maxStacks). boss: what a BOSS does instead.
export const STATUSES = {
  burn: {
    id: 'burn', name: { ru: 'Горение', en: 'Burn' }, kind: 'debuff', turns: 2, stack: 'refresh',
    tick: { at: 'turnStart', mult: 0.25, stat: 'applierAtk', trueDamage: true },
    desc: { ru: 'В начале своего хода получает 25% ATK наложившего чистого урона.', en: "Takes 25% of the applier's ATK as true damage at the start of its turn." },
    icon: 'flame', color: '#FF5B3A',
  },
  frozen: {
    id: 'frozen', name: { ru: 'Заморозка', en: 'Frozen' }, kind: 'control', turns: 1, stack: 'refresh',
    effect: { cannotActivate: true, noEnergyGain: true, cooldownsPaused: true, aurasSuppressed: true, nextHitTakenMult: 1.4, breaksOnHit: true },
    desc: { ru: 'Не может действовать, не копит энергию; следующий удар ×1.4 и снимает лёд.', en: 'Cannot act or gain energy; the next hit deals ×1.4 and shatters the ice.' },
    boss: 'stagger', icon: 'ice-block', color: '#8EEBFF',
  },
  stun: {
    id: 'stun', name: { ru: 'Оглушение', en: 'Stun' }, kind: 'control', turns: 1, stack: 'refresh',
    effect: { cannotActivate: true, noEnergyGain: true, cooldownsPaused: true, aurasSuppressed: true },
    desc: { ru: 'Не может действовать и копить энергию; перезарядки стоят.', en: 'Cannot act or gain energy; cooldowns are paused.' },
    boss: 'stagger', icon: 'stars', color: '#FFE14D',
  },
  root: {
    id: 'root', name: { ru: 'Обездвиживание', en: 'Root' }, kind: 'control', turns: 1, stack: 'refresh',
    effect: { cannotMove: true, cannotJump: true },
    desc: { ru: 'Не может ходить и прыгать (атаковать на месте может).', en: 'Cannot move or jump-strike (can still act in place).' },
    boss: 'stagger', icon: 'chains', color: '#E3A13B',
  },
  slow: {
    id: 'slow', name: { ru: 'Замедление', en: 'Slow' }, kind: 'debuff', turns: 1, stack: 'refresh',
    effect: { moveOverride: { type: 'step', steps: 1 }, noGlide: true, chainMax: 1 },
    desc: { ru: 'Ход только на 1 клетку, без скольжения и полёта; цепочка не длиннее 1 прыжка.', en: 'Moves only 1 square, no glide/flight; chains limited to 1 hop.' },
    icon: 'snail', color: '#7FA8C9',
  },
  silence: {
    id: 'silence', name: { ru: 'Немота', en: 'Silence' }, kind: 'control', turns: 1, stack: 'refresh',
    effect: { noSkill: true, noUlt: true },
    desc: { ru: 'Не может применять навык и Вспышку.', en: 'Cannot use the skill or the Ultimate.' },
    boss: 'stagger', icon: 'muted', color: '#9AA0B5',
  },
  taunt: {
    id: 'taunt', name: { ru: 'Провокация', en: 'Taunt' }, kind: 'control', turns: 1, stack: 'refresh',
    effect: { mustTargetSource: true },
    desc: { ru: 'Если эта героиня атакует, то обязана бить провокатора (если может до него достать).', en: 'If this unit attacks, it must target the taunter whenever the taunter is a legal target.' },
    boss: 'stagger', icon: 'exclaim', color: '#FF8A3D',
  },
  mark: {
    id: 'mark', name: { ru: 'Метка', en: 'Mark' }, kind: 'debuff', turns: 2, stack: 'max', value: 0.2,
    effect: { damageTakenPct: 0.2 },
    desc: { ru: 'Получает на 20% больше урона.', en: 'Takes 20% more damage.' },
    icon: 'crosshair', color: '#D7337E',
  },
  brittle: {
    id: 'brittle', name: { ru: 'Хрупкость', en: 'Brittle' }, kind: 'debuff', turns: 2, stack: 'max', value: 0.35,
    effect: { defPct: -0.35 },
    desc: { ru: 'Защита −35%.', en: 'DEF −35%.' }, icon: 'cracked-shield', color: '#B9C6FF',
  },
  weaken: {
    id: 'weaken', name: { ru: 'Ослабление', en: 'Weaken' }, kind: 'debuff', turns: 2, stack: 'max', value: 0.25,
    effect: { atkPct: -0.25 },
    desc: { ru: 'Атака −25%.', en: 'ATK −25%.' }, icon: 'broken-sword', color: '#8C8C8C',
  },
  blight: {
    id: 'blight', name: { ru: 'Порча', en: 'Blight' }, kind: 'debuff', turns: 2, stack: 'max', value: 0.5,
    effect: { healingReceivedPct: -0.5 },
    desc: { ru: 'Получаемое лечение −50%.', en: 'Healing received −50%.' }, icon: 'wilted-flower', color: '#6E2A5A',
  },
  inspire: {
    id: 'inspire', name: { ru: 'Воодушевление', en: 'Inspire' }, kind: 'buff', turns: 2, stack: 'max', value: 0.25,
    effect: { atkPct: 0.25 },
    desc: { ru: 'Атака +25%.', en: 'ATK +25%.' }, icon: 'sun-sword', color: '#FFD23F',
  },
  brace: {
    id: 'brace', name: { ru: 'Стойка', en: 'Brace' }, kind: 'buff', turns: 1, stack: 'max', value: 0.3,
    effect: { defPct: 0.3 },
    desc: { ru: 'Защита +30% (за пропуск действия).', en: 'DEF +30% (from the Wait action).' }, icon: 'stance', color: '#9FD3FF',
  },
  regen: {
    id: 'regen', name: { ru: 'Регенерация', en: 'Regen' }, kind: 'buff', turns: 2, stack: 'max', value: 0.08,
    tick: { at: 'turnStart', healPctMaxHp: 0.08 },
    desc: { ru: 'В начале своего хода лечит 8% макс. HP.', en: 'Heals 8% max HP at the start of its turn.' }, icon: 'leaf', color: '#5CFF9D',
  },
  shield: {
    id: 'shield', name: { ru: 'Щит', en: 'Shield' }, kind: 'buff', turns: 2, stack: 'max',
    effect: { absorb: true },
    desc: { ru: 'Поглощает урон. Новый щит не складывается — остаётся больший.', en: 'Absorbs damage. Shields do not stack — the larger one stays.' },
    icon: 'hex-shield', color: '#BFE9FF',
  },
  untargetable: {
    id: 'untargetable', name: { ru: 'Сокрытие', en: 'Veiled' }, kind: 'buff', turns: 1, stack: 'refresh',
    effect: { untargetable: true },
    desc: { ru: 'Нельзя выбрать целью и перепрыгнуть; задевают только эффекты «по всем».', en: "Can't be targeted or jumped; only 'all' effects reach it." },
    icon: 'veil', color: '#C0B0FF',
  },
  charge: {
    id: 'charge', name: { ru: 'Заряд', en: 'Charge' }, kind: 'special', stack: 'stacks', maxStacks: 3, turns: null,
    desc: { ru: 'Счётчик зарядов (см. фишку героини).', en: "Charge counter (see the hero's quirk)." }, icon: 'battery', color: '#A46BFF',
  },
  crown: {
    id: 'crown', name: { ru: 'Корона', en: 'Crown' }, kind: 'special', turns: null, stack: 'refresh',
    effect: { awakened: true },
    desc: { ru: 'Пробуждённая «дамка»: см. AWAKEN.', en: 'Awakened "queen": see AWAKEN.' }, icon: 'crown', color: '#FFD23F',
  },
  stagger: {
    id: 'stagger', name: { ru: 'Ошеломление', en: 'Stagger' }, kind: 'special', stack: 'stacks', maxStacks: 3, turns: null,
    desc: { ru: 'Только у боссов: контроль копит стаки; 3 стака — Надлом.', en: 'Bosses only: control effects add stacks; 3 stacks — Break.' },
    icon: 'cracks', color: '#FF4D4D',
  },
  break: {
    id: 'break', name: { ru: 'Надлом', en: 'Break' }, kind: 'control', turns: 1, stack: 'refresh',
    effect: { cannotActivate: true, damageTakenPct: 0.3 },
    desc: { ru: 'Босс пропускает активацию и получает +30% урона.', en: 'The boss skips its activation and takes +30% damage.' },
    icon: 'shatter', color: '#FF4D4D',
  },
};

// Negative statuses removable by `cleanse`; positive ones removable by `dispel`.
export const CLEANSABLE = ['burn', 'frozen', 'stun', 'root', 'slow', 'silence', 'taunt', 'mark', 'brittle', 'weaken', 'blight'];
export const DISPELLABLE = ['inspire', 'brace', 'regen', 'shield', 'untargetable'];

// --------------------------------------------------------------------------------- damage & stats

// DMG = floor( ATKeff * mult * DEFF * ELEM * REACT * CRIT * (1 + dmgBonus) * (1 + takenBonus) ), min 1
//   ATKeff = ATK * (1 + Σ atkPct)               (Inspire +25 %, Weaken −25 %, Crown +20 %, ...)
//   DEFF   = K / (K + DEFeff), K = 150 + 10 * attackerLevel, DEFeff = max(0, DEF * (1 + Σ defPct))
//   ELEM   = elementMult(attackElement, targetElement)
//   REACT  = amplify multiplier of a triggered Пар / Затмение (else 1)
//   CRIT   = 1.5 on a crit (chance = CRIT % + bonuses, max 100 %); AI uses the expected value
//   dmgBonus   = Σ attacker bonuses (Прицел, combo step, quirks, constellations)
//   takenBonus = Σ target modifiers (Метка +20 %, Заслон −15 %, Заморозка ×1.4 handled as +40 %)
// trueDamage skips DEFF, ELEM, REACT and CRIT. Shields absorb before HP.
export const DAMAGE = {
  kBase: 150,
  kPerLevel: 10,
  critMult: 1.5,
  critCap: 100,
  minDamage: 1,
  affDivisor: 200,
  affCap: 200,
  rng: 'seeded per battle (mulberry32); AI uses expected values',
};

export function defenseFactor(attackerLevel, defEff) {
  const k = DAMAGE.kBase + DAMAGE.kPerLevel * attackerLevel;
  return k / (k + Math.max(0, defEff));
}

/** Stats of a hero (heroes.js entry) at a level, before battle modifiers and constellations. */
export function statsAt(hero, level) {
  const l = Math.max(1, Math.min(PROGRESSION.maxLevel, level)) - 1;
  return {
    hp: Math.floor(hero.base.hp + hero.growth.hp * l),
    atk: Math.floor(hero.base.atk + hero.growth.atk * l),
    def: Math.floor(hero.base.def + hero.growth.def * l),
    crit: hero.base.crit,
    aff: hero.base.aff,
  };
}

// ---------------------------------------------------------------------------------------- energy

export const ENERGY = {
  startPct: 0.4, // battle start: 40 % of the hero's ult cost (rounded down)
  action: 25, // basic / skill / jump chain / quirk action
  extraHop: 5, // per hop after the first
  moveOnly: 10,
  wait: 10,
  hitTaken: 6, // per damaging enemy instance
  hitTakenCapPerTurn: 12,
  reaction: 10, // to the hero that triggered it
  ko: 15,
  awaken: 50, // once, on reaching the enemy back row
  ultResetsTo: 0, // casting the Ultimate consumes ALL energy and grants none for that action
};

// ------------------------------------------------------------------------------------ awakening

export const AWAKEN = {
  name: { ru: 'Пробуждение', en: 'Awakening', jp: '覚醒' },
  title: { ru: 'Дамка', en: 'Queen' },
  atkPct: 0.2,
  defPct: 0.2,
  healPctMaxHp: 0.25,
  energy: 50,
  // Added as an ALTERNATIVE to the role move (the hero picks one each activation):
  move: { type: 'glide', length: 4 },
  moveShadow: { type: 'glide', length: 7 },
  moveBlink: { type: 'blink', range: 3 }, // heroes whose role move is blink
  jump: { flying: true, approachMax: 4, landMax: 2, chainBonus: 1 },
  // flying: the victim may be up to approachMax squares away along a diagonal with empty squares
  // between; landing on any of landMax empty squares directly beyond it. Awakening mid-chain applies
  // immediately and the chain continues with the awakened rules (as in Russian draughts).
};

// ---------------------------------------------------------------------------------------- bosses

export const BOSS = {
  ccImmune: ['frozen', 'stun', 'silence', 'taunt', 'root'],
  displaceImmune: true, // push / pull / swap / toss do nothing (collision damage still applies)
  staggerPerCc: 1, // each blocked control / displacement adds 1 stack of «Ошеломление»
  breakAt: 3, // 3 stacks -> «Надлом» (status break) and stacks reset
  extraActivationEvery: 3, // every 3rd enemy turn the boss acts IN ADDITION to the normal activation
  executeImmune: true, // execute effects deal +1.0×ATK damage instead
  tokenScale: 1.25, // drawn bigger, still occupies one square
};

// -------------------------------------------------------------------------------------- gacha

export const GACHA = {
  currency: { id: 'star-crystal', name: { ru: 'Звёздный кристалл', en: 'Star Crystal' }, icon: '✦' },
  cost: { single: 160, multi: 1600, multiCount: 10 }, // no discount: the 10-pull is convenience
  rates: { mythic: 0.005, legendary: 0.020, epic: 0.15, rare: 0.825 },
  pity: {
    epicPlusEvery: 10, // 9 pulls without Epic+ -> the 10th is at least Epic
    legendaryPlusSoftFrom: 46, // pulls 46..59: Legendary+ chance += 6 % per pull after 45
    legendaryPlusSoftStep: 0.06,
    legendaryPlusHard: 60, // 60th pull since the last Legendary+ is guaranteed Legendary+
    mythicShare: 0.2, // a Legendary+ result is Mythic with 20 %
    mythicGuaranteeAfter: 4, // after 4 Legendary+ in a row that were not Mythic, the 5th is Mythic
    sharedAcrossBanners: true,
  },
  // Measured (Monte Carlo, 3M pulls): consolidated Mythic ≈1.0 %, Legendary ≈2.5 %, Epic ≈17.6 %,
  // Rare ≈78.9 %; ≈29 pulls per Legendary+, ≈96 pulls per Mythic.
  noviceBanner: { pulls: 20, legendaryPlusGuaranteed: true, onlyMulti: true },
  duplicates: { constellationCopies: 6 }, // copies 2..7 -> C1..C6; further copies -> dust
};

export function legendaryPlusChance(pullsSinceLegendaryPlus /* this pull's index, 1-based */) {
  const p = GACHA.pity;
  const base = GACHA.rates.mythic + GACHA.rates.legendary;
  if (pullsSinceLegendaryPlus >= p.legendaryPlusHard) return 1;
  if (pullsSinceLegendaryPlus >= p.legendaryPlusSoftFrom) {
    return Math.min(1, base + p.legendaryPlusSoftStep * (pullsSinceLegendaryPlus - (p.legendaryPlusSoftFrom - 1)));
  }
  return base;
}

// ----------------------------------------------------------------------------------- progression

export const PROGRESSION = {
  maxLevel: 30,
  levelCaps: [
    { cap: 10, unlock: 'start' },
    { cap: 20, unlock: 'clear:1-boss' },
    { cap: 30, unlock: 'clear:2-boss' },
  ],
  xpScroll: 1000, // «Свиток опыта»
  benchShare: 0.3, // heroes not in the squad get 30 % of battle XP
  firstClearMult: 1.5,
  lossMult: 0.25,
  trainingMult: 0.5,
};

/** XP needed to go from `level` to level + 1:  60·L + 8·L². Total 1→30 = 94 540. */
export function xpToNext(level) {
  return 60 * level + 8 * level * level;
}

/** XP every surviving AND KO'd squad hero gets for a win against enemies of average level L. */
export function battleXp(enemyLevel) {
  return Math.round(25 * Math.pow(enemyLevel, 1.5) + 50);
}

// ------------------------------------------------------------------------------------- economy

export const ECONOMY = {
  start: { crystals: 3200, xpScrolls: 5, dust: 0 },
  starterSquad: ['akane', 'vera', 'shio', 'maren', 'iskra', 'mashiro'],
  firstClear: { stage: 80, boss: 400, xpScrollsCh: [1, 2, 3] },
  threeStarChest: 60,
  repeatWin: 10, // stage replays and Training wins
  repeatDailyCap: 150,
  firstBattleOfDay: 40,
  dailyTasks: [
    { id: 'win3', desc: { ru: 'Победить в 3 боях', en: 'Win 3 battles' }, crystals: 30 },
    { id: 'react5', desc: { ru: 'Вызвать 5 реакций', en: 'Trigger 5 reactions' }, crystals: 20 },
    { id: 'ult2', desc: { ru: 'Применить 2 Вспышки', en: 'Use 2 Ultimates' }, crystals: 20, xpScrolls: 1 },
  ],
  achievementsTotal: 2400, // ≈40 one-off achievements, 30–150 crystals each (list in the GDD)
  dust: { id: 'stardust', name: { ru: 'Звёздная пыль', en: 'Stardust' } },
  shop: [
    { id: 'xp-scroll', price: 10, gives: { xpScrolls: 1 } },
    { id: 'summon-ticket', price: 100, gives: { pulls: 1 }, weeklyLimit: 5 },
    { id: 'epic-star', price: 250, gives: { constellation: 'epic-owned' } },
    { id: 'legendary-star', price: 900, gives: { constellation: 'legendary-owned' } },
    { id: 'mythic-star', price: 1500, gives: { constellation: 'mythic-owned' } },
  ],
  realMoney: false,
};

// ------------------------------------------------------------------------------------------- AI

// Greedy scoring of every legal activation (see GDD §AI). Weights are in "HP-equivalent points".
export const AI = {
  levels: {
    easy: { lookahead: 1, pickFromTop: 5, randomActionChance: 0.25, noise: 0.25, ult: 'asap', timeMs: 150 },
    normal: { lookahead: 1, pickFromTop: 1, randomActionChance: 0, noise: 0.05, ult: 'smart', timeMs: 400 },
    hard: { lookahead: 2, beam: 12, replyWeight: 0.8, noise: 0, ult: 'smart-hold', timeMs: 1200 },
  },
  weights: {
    damage: 1.0, // per HP removed (capped at HP + shield)
    koBonusPctMaxHp: 0.6,
    koUltReadyBonusPctMaxHp: 0.3,
    ultReadyTargetMult: 1.25,
    heal: 0.9, // per HP of missing health restored
    shield: 0.6, // per shield point on an ally that can be hit next turn
    control: { stun: 1.6, frozen: 1.6, silence: 0.8, root: 0.5, slow: 0.4, taunt: 0.5 }, // × target ATK × turns
    debuff: { mark: 0.25, brittle: 0.3, weaken: 0.3, blight: 0.2, burn: 0.5 }, // × target ATK × turns
    sealSetup: 0.15, // × average ATK of allies that can react with the new seal next turn
    energy: 1.5, // per energy point gained by own heroes (ult readiness)
    awaken: 0.4, // × hero max HP
    advancePerRow: 8, // melee roles, rows closer to the awakening row
    danger: 0.5, // × max damage the activated hero can take next enemy turn (hard: 0.25)
    isolationPenalty: 20, // oracle/mystic ending with no ally within 2 squares
  },
  targetPriority: ['canKo', 'taunt', 'oracle', 'mystic', 'ranger', 'shadow', 'blade', 'guardian', 'lowestHp', 'highestEnergy'],
  ultPolicy: {
    smart: 'cast if it KOs ≥1, or hits ≥2 enemies, or heals ≥30 % of team missing HP, or energy has been full for ≥2 own turns',
    'smart-hold': 'smart, but hold if lookahead shows a ≥25 % better cast next turn and no ally is in KO danger',
    asap: 'cast on the best-scoring target as soon as energy is full',
  },
};

// -------------------------------------------------------------------------------------- campaign

// Squares use board notation: file a..h = col 0..7, rank 1..8 = row 7..0 (a1 is dark, as in
// Russian draughts). Enemy squads are «Отражения» (grey reflections of roster heroes, C0, art
// tinted by a shader). `elite` = a Legendary/Mythic reflection with normal rules; `miniBoss` =
// BOSS rules with hpMult but no extra activation; `boss` = full BOSS rules.
// Rewards: first clear STAGE 80 / BOSS 400 crystals + XP scrolls (ECONOMY.firstClear), ★★★ chest 60.
// Stars: ★ win · ★★ win with ≤1 hero KO'd · ★★★ win with no KO within `threeStarRounds`.
export const CAMPAIGN = [
  {
    chapter: 1, name: { ru: 'Рассветная Марка', en: 'Dawn March' }, bg: 'bg-dawn',
    levels: [1, 10], roundLimit: 25, threeStarRounds: 14,
    gimmick: {
      id: 'dew', name: { ru: 'Роса', en: 'Dew' }, squares: ['c5', 'e5', 'd4', 'f4'],
      desc: {
        ru: 'Четыре центральные клетки покрыты росой: фигура, начинающая на них ход, получает Печать Прилива. Учит реакциям — и работает на обе стороны.',
        en: 'The four central squares are dewy: a unit starting its turn there receives a Tide seal. Teaches reactions — and works for both sides.',
      },
    },
    stages: [
      { id: '1-1', name: { ru: 'Первая расстановка', en: 'First Formation' }, level: 1, ai: 'easy', enemies: ['vera', 'shio', 'mara'], tutorial: 'basics' },
      { id: '1-2', name: { ru: 'Роса на клетках', en: 'Dew on the Squares' }, level: 2, ai: 'easy', enemies: ['maren', 'shio', 'mashiro', 'iskra'], tutorial: 'reactions' },
      { id: '1-3', name: { ru: 'Прыжок за прыжком', en: 'Hop After Hop' }, level: 3, ai: 'easy', enemies: ['torvald', 'falk', 'runa', 'mara'], tutorial: 'chains', rule: { id: 'presetFormation', formation: 'ladder' } },
      { id: '1-4', name: { ru: 'Стена щитов', en: 'Shield Wall' }, level: 4, ai: 'easy', enemies: ['vera', 'torvald', 'falk', 'maren', 'sirin'], tutorial: 'taunt' },
      { id: '1-5', name: { ru: 'Дорога к короне', en: 'Road to the Crown' }, level: 5, ai: 'normal', enemies: ['iskra', 'mara', 'shio', 'runa', 'mashiro'], tutorial: 'awakening', rule: { id: 'altWinAwaken', count: 2 } },
      { id: '1-6', name: { ru: 'Засада в росе', en: 'Ambush in the Dew' }, level: 6, ai: 'normal', enemies: ['iskra', 'mara', 'shio', 'maren', 'sirin', 'torvald'], rule: { id: 'enemyFirst' } },
      { id: '1-7', name: { ru: 'Ветер перемен', en: 'Winds of Change' }, level: 7, ai: 'normal', enemies: ['sirin', 'kaede', 'iskra', 'falk', 'vera', 'mashiro'], rule: { id: 'reactionBoost', reaction: 'vortex', pct: 0.5 } },
      { id: '1-8', name: { ru: 'Предрассветный бой', en: 'Battle Before Dawn' }, level: 8, ai: 'normal', enemies: ['koyuki', 'kaede', 'shio', 'torvald', 'mashiro', 'iskra'] },
      {
        id: '1-B', boss: true, name: { ru: 'Серая Ласточка', en: 'The Grey Swallow' }, level: 10, ai: 'normal',
        bossHero: 'tsubame', hpMult: 5, escorts: [['kaede', 8], ['sirin', 8], ['vera', 8]], roundLimit: 30, threeStarRounds: 20,
        mechanics: [
          { id: 'featherTrail', desc: { ru: 'Клетки, по которым скользит босс, на 2 хода становятся «перьями»: встал — Замедлен.', en: 'Squares the boss glides through become "feathers" for 2 turns: ending there Slows.' } },
          { id: 'galeEscape', desc: { ru: 'Один раз при 50% HP: Сокрытие на 1 ход и прыжок на свой задний ряд.', en: 'Once at 50% HP: Veiled for 1 turn and a leap to her own back row.' } },
        ],
      },
    ],
  },
  {
    chapter: 2, name: { ru: 'Пепельный Предел', en: 'Ashen Frontier' }, bg: 'bg-ash',
    levels: [11, 20], roundLimit: 28, threeStarRounds: 16,
    gimmick: {
      id: 'lava', name: { ru: 'Лава и извержения', en: 'Lava and Eruptions' }, squares: ['b6', 'd6', 'e3', 'g3'],
      eruptionEvery: 4, eruptionPctMaxHp: 0.12, lavaPctMaxHp: 0.1,
      desc: {
        ru: 'Лавовые трещины: начавшая на них ход фигура теряет 10% макс. HP (чистый урон). Каждый 4-й раунд извергается случайный ряд (подсвечен за раунд до этого): все в нём теряют 12% макс. HP.',
        en: 'Lava cracks: a unit starting its turn on one loses 10% max HP (true damage). Every 4th round a random row erupts (lit up one round before): everyone on it loses 12% max HP.',
      },
    },
    stages: [
      { id: '2-1', name: { ru: 'Пепел и сталь', en: 'Ash and Steel' }, level: 11, ai: 'normal', enemies: ['torvald', 'falk', 'zlata', 'shio', 'maren', 'iskra'] },
      { id: '2-2', name: { ru: 'Плавильня', en: 'The Smeltery' }, level: 12, ai: 'normal', enemies: ['torvald', 'akane', 'mara', 'runa', 'mashiro', 'falk'], rule: { id: 'elementBoost', element: 'flame', pct: 0.2 } },
      { id: '2-3', name: { ru: 'Сухая гроза', en: 'Dry Thunder' }, level: 13, ai: 'normal', enemies: ['volta', 'iskra', 'karasu', 'shio', 'vera', 'sirin'], rule: { id: 'sealDuration', element: 'storm', turns: 3 } },
      { id: '2-4', name: { ru: 'Обсидиановый мост', en: 'Obsidian Bridge' }, level: 14, ai: 'normal', enemies: ['zlata', 'kaede', 'koyuki', 'maren', 'mashiro', 'runa'], rule: { id: 'removeFiles', files: ['a', 'h'] } },
      { id: '2-5', name: { ru: 'Караван', en: 'The Caravan' }, level: 15, ai: 'normal', enemies: ['karasu', 'mara', 'iskra', 'kaede', 'shio', 'falk'], rule: { id: 'escort', ward: 'caravan', square: 'd2', hpPctSquad: 0.25, surviveRounds: 12 } },
      { id: '2-6', name: { ru: 'Огонь и лёд', en: 'Fire and Ice' }, level: 16, ai: 'normal', enemies: ['fuyuka', 'akane', 'koyuki', 'torvald', 'mashiro', 'maren'], elite: ['fuyuka'], rule: { id: 'reactionBoost', reaction: 'steam', mult: 1.8 } },
      { id: '2-7', name: { ru: 'Кузница бури', en: 'Storm Forge' }, level: 17, ai: 'normal', enemies: ['reika', 'volta', 'zlata', 'lucille', 'iskra', 'falk'], elite: ['reika'], rule: { id: 'eruptionEvery', rounds: 3 } },
      { id: '2-8', name: { ru: 'Стражи кратера', en: 'Crater Wardens' }, level: 18, ai: 'hard', enemies: ['zlata', 'fuyuka', 'lucille', 'karasu', 'kaede', 'volta'], elite: ['fuyuka'] },
      {
        id: '2-B', boss: true, name: { ru: 'Пепельный Феникс', en: 'The Ashen Phoenix' }, level: 20, ai: 'hard',
        bossHero: 'vermilia', hpMult: 5, escorts: [['akane', 18], ['torvald', 18], ['lucille', 18], ['volta', 18]], roundLimit: 30, threeStarRounds: 20,
        mechanics: [
          { id: 'bossEgg', desc: { ru: 'При 0 HP становится Яйцом (20% макс. HP босса); не разбили за 2 хода — возрождается с 50% HP.', en: 'At 0 HP she becomes an Egg (20% of boss max HP); if not broken within 2 turns she returns at 50% HP.' } },
          { id: 'fireRain', every: 3, mult: 1.2, desc: { ru: 'Каждый 3-й раунд — Огненный дождь: 3 круга радиуса 1 (подсвечены за ход) по 120% ATK босса Пламенем.', en: 'Every 3rd round — Fire Rain: 3 radius-1 circles (shown a turn earlier), 120% boss ATK Flame each.' } },
        ],
      },
    ],
  },
  {
    chapter: 3, name: { ru: 'Небесный Эндшпиль', en: 'Celestial Endgame' }, bg: 'bg-sky',
    levels: [21, 30], roundLimit: 30, threeStarRounds: 18,
    gimmick: {
      id: 'portals-collapse', name: { ru: 'Звёздные врата и Сжатие', en: 'Star Gates and Collapse' },
      portals: [['b6', 'g3'], ['c3', 'f6']], collapseFrom: 16,
      collapse: [{ round: 16, files: ['a', 'h'] }, { round: 18, ranks: [1, 8] }, { round: 20, files: ['b', 'g'] }],
      collapsePctMaxHp: 0.1,
      desc: {
        ru: 'Врата: закончив ход на клетке врат, фигура переносится на парную клетку (если она свободна). Сжатие: с 16-го раунда края доски по очереди обрушиваются; фигуры с них сталкивает внутрь (−10% макс. HP), а ряды пробуждения сдвигаются к центру.',
        en: 'Gates: a unit ending its move on a gate square is carried to its pair (if empty). Collapse: from round 16 the board edges fall away one after another; units on them are pushed inward (−10% max HP) and the awakening rows move inward.',
      },
    },
    stages: [
      { id: '3-1', name: { ru: 'Лестница в небо', en: 'Stairway to the Sky' }, level: 21, ai: 'normal', enemies: ['lucille', 'vera', 'kaede', 'sirin', 'koyuki', 'shio'] },
      { id: '3-2', name: { ru: 'Врата созвездий', en: 'Constellation Gates' }, level: 22, ai: 'normal', enemies: ['tsubame', 'iskra', 'karasu', 'mara', 'kaede', 'mashiro'], elite: ['tsubame'], tutorial: 'portals' },
      { id: '3-3', name: { ru: 'Сияющий караул', en: 'Radiant Watch' }, level: 23, ai: 'normal', enemies: ['vera', 'vera', 'lucille', 'zlata', 'reika', 'mizuha'], elite: ['reika'] },
      { id: '3-4', name: { ru: 'Полночная стража', en: 'Midnight Watch' }, level: 24, ai: 'normal', enemies: ['karasu', 'mara', 'mara', 'volta', 'koyuki', 'mizuha'], rule: { id: 'sealDuration', element: 'umbra', turns: 3 } },
      { id: '3-5', name: { ru: 'Танец бурь', en: 'Dance of Storms' }, level: 25, ai: 'normal', enemies: ['tsubame', 'reika', 'volta', 'iskra', 'kaede', 'sirin'], elite: ['tsubame', 'reika'] },
      { id: '3-6', name: { ru: 'Ледяной двор', en: 'The Ice Court' }, level: 26, ai: 'hard', enemies: ['fuyuka', 'koyuki', 'mashiro', 'mizuha', 'zlata', 'vera'], miniBoss: { hero: 'fuyuka', hpMult: 3 } },
      { id: '3-7', name: { ru: 'Эхо феникса', en: 'Echo of the Phoenix' }, level: 27, ai: 'hard', enemies: ['vermilia', 'akane', 'torvald', 'lucille', 'kaede', 'reika'], miniBoss: { hero: 'vermilia', hpMult: 3 } },
      { id: '3-8', name: { ru: 'Перед последним ходом', en: 'Before the Final Move' }, level: 28, ai: 'hard', enemies: 'mirror', rule: { id: 'mirror' } },
      {
        id: '3-B', boss: true, name: { ru: 'Безликая Дамка', en: 'The Faceless Queen' }, level: 30, ai: 'hard',
        bossHero: 'nocturna', bossRules: [{ rule: 'startCrowned', params: { lossThresholdPct: 0.1 } }], hpMult: 6,
        escorts: [['karasu', 28], ['fuyuka', 28], ['lucille', 28], ['reika', 28], ['tsubame', 28]], roundLimit: 30, threeStarRounds: 22,
        collapseShift: -2, // the chapter collapse schedule starts 2 rounds earlier: rounds 14 / 16 / 18
        mechanics: [
          { id: 'phase1', hpAbove: 0.6, desc: { ru: 'Вечное затмение: лечение игрока −30%.', en: 'Endless Eclipse: player healing −30%.' } },
          { id: 'phase2', hpAbove: 0.3, desc: { ru: 'Пустые пешки: каждые 2 раунда ставит 2 пешки-подставки (по 10% её HP) на свой задний ряд; каждая живая пешка даёт ей +10 энергии в начале хода.', en: 'Hollow Pawns: every 2 rounds she places 2 pawn wards (10% of her HP each) on her back row; each living pawn grants her +10 energy per turn.' } },
          { id: 'phase3', hpAbove: 0, desc: { ru: 'Последняя партия: действует каждый ход дополнительно к обычной активации, но получает +25% урона.', en: 'The Last Game: acts every turn on top of the normal activation, but takes +25% damage.' } },
        ],
      },
    ],
  },
];

export const SIDE_MODES = {
  training: {
    name: { ru: 'Тренировка', en: 'Training' },
    enemyLevel: [1, 30], enemySquad: ['random', 'chapterPreset', 'mirror', 'custom'], ai: ['easy', 'normal', 'hard'],
    rewards: { xpMult: PROGRESSION.trainingMult, crystals: ECONOMY.repeatWin, sharesDailyCap: true },
  },
  duel: {
    name: { ru: 'Дуэль', en: 'Duel' },
    players: 2, device: 'one phone (hot-seat)', draft: 'alternate picks 1-2-2-2-2-2-1 (12 picks) from owned heroes (option: all 24)',
    levelRule: 'equalized (default L20, C0) or "as owned"', firstSide: 'coin toss', rewards: { crystals: 0, achievements: true },
  },
};
