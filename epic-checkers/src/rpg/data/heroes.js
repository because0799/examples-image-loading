// «Валькирии доски» — hero roster (24 heroes: 10 Rare, 8 Epic, 4 Legendary, 2 Mythic; 22 f / 2 m).
//
// Data only. Abilities use the vocabulary in ./effects.md; numbers (statuses, reactions, damage,
// energy) live in ./rules.js. Design reasoning: docs/RPG-DESIGN.md.
//   base   = level-1 stats; growth = added per level (stat(L) = floor(base + growth * (L - 1)))
//   crit   = crit chance in percent points; aff = Affinity (reaction strength, rules.js REACTIONS)
//   move / basic / jump = role defaults (rules.js ROLES), copied here so a hero is self-contained;
//                         quirks/passives may modify them through rules/mods.
//   voice  = archetype id in voice-lines.js (null for Rare heroes — no voice acting)
//   art    = generation prompt (16:9, 1280×720) + focal = face position (0..1) for the circular
//            board token / portrait crops (measured values copied from RPG_ASSETS.focal /
//            assets/rpg/crops.json at integration; RPG_ASSETS.focal stays the source of truth).

const cp = (o) => JSON.parse(JSON.stringify(o));

const MOVE = {
  step1: { type: 'step', steps: 1 },
  step2: { type: 'step', steps: 2 },
  glide3: { type: 'glide', length: 3 },
  blink2: { type: 'blink', range: 2 },
};

const BASIC = {
  melee: { range: 1, los: 'adjacent', mult: 1.0 },
  shot4: { range: 4, los: 'diag', mult: 0.9, pointBlankMult: 0.6 },
  bolt2: { range: 2, los: 'free', mult: 0.8 },
  oracle2: { range: 2, los: 'free', mult: 0.6, allyHeal: { mult: 0.8, stat: 'atk' } },
};

const JUMP = {
  guardian: { mult: 1.0, chainMax: 2, comboStep: 0.1, landMax: 1 },
  blade: { mult: 1.2, chainMax: 3, comboStep: 0.15, landMax: 1 },
  ranged: { mult: 0.8, chainMax: 1, comboStep: 0.1, landMax: 1 },
  oracle: { mult: 0.7, chainMax: 1, comboStep: 0.1, landMax: 1 },
  shadow: { mult: 1.1, chainMax: 2, comboStep: 0.1, landMax: 2 },
};

// ------------------------------------------------------------------------------------ art style

export const ART_STYLE =
  'high-quality anime gacha RPG key art, cel-shaded with painterly lighting, clean lineart, vibrant ' +
  'element-coloured lighting, 16:9 landscape, the character centered with her face in the upper-middle ' +
  'of the frame, upper body to knees visible, dynamic heroic pose, detailed fantasy background matching ' +
  'her element, no text, no logo, no watermark';

export const ART_RARITY = {
  rare: 'Rare-tier design: simple, clean costume with few accessories.',
  epic: 'Epic-tier design: refined costume with ornate details and a subtle magical glow.',
  legendary: 'Legendary-tier design: lavish ornate costume, golden rim light, sparkling particles.',
  mythic: 'Mythic-tier design: divine and epic, glowing halo, majestic wings, cosmic star effects, ultra detailed.',
};

const SAFE_F = 'Modest outfit, no cleavage, no fanservice, fully covered practical fantasy battle attire.';
const SAFE_M = 'Modest practical fantasy battle attire, no fanservice.';

/** Full prompt = style preamble (pronouns adapted for male heroes) + subject + safety + rarity tier. */
export function artPrompt(gender, rarity, subject) {
  const style = gender === 'm' ? ART_STYLE.replace('with her face', 'with his face').replace('matching her element', 'matching his element') : ART_STYLE;
  return `${style}. ${subject} ${gender === 'm' ? SAFE_M : SAFE_F} ${ART_RARITY[rarity]} Original character design, not based on any existing franchise.`;
}

// ----------------------------------------------------------------------------------------- roster

export const HEROES = [
  // ================================================================================== MYTHIC
  {
    id: 'liora',
    name: { ru: 'Лиора', en: 'Liora', jp: 'リオラ' },
    title: { ru: 'Небесная Дамка', en: 'Queen of the Celestial Board' },
    gender: 'f', rarity: 'mythic', element: 'radiance', role: 'blade',
    base: { hp: 730, atk: 268, def: 51, crit: 15, aff: 40 },
    growth: { hp: 54, atk: 19.8, def: 3.8 },
    move: cp(MOVE.step2), basic: cp(BASIC.melee), jump: cp(JUMP.blade),
    skill: {
      id: 'dawn-verdict',
      name: { ru: 'Рассветный приговор', en: 'Dawn Verdict', jp: '暁の裁き' },
      desc: {
        ru: 'Рассекает диагональ на 3 клетки: 160% ATK каждому врагу на пути, союзницы на линии получают +15 энергии; затем Лиора встаёт на самую дальнюю свободную клетку линии.',
        en: 'Cleaves 3 squares along a diagonal: 160% ATK to every enemy in the path, allies on the line gain +15 energy; then Liora lands on the farthest empty square of the line.',
      },
      cooldown: 3,
      target: { shape: 'line', length: 3, pierce: true, side: 'enemy' },
      effects: [
        { op: 'damage', mult: 1.6 },
        { op: 'energy', amount: 15, who: 'alliesInShape' },
        { op: 'moveSelf', to: 'lineEnd' },
      ],
    },
    passive: {
      id: 'light-at-the-end',
      name: { ru: 'Свет в конце хода', en: 'Light at the End of the Move' },
      desc: {
        ru: 'Когда Лиора выбивает врага, все союзницы получают +10 энергии, а сама она лечит 10% макс. HP.',
        en: 'When Liora KOs an enemy, every ally gains +10 energy and she heals 10% of her max HP.',
      },
      triggers: [{ on: 'kill', effects: [{ op: 'energy', amount: 10, who: 'allAllies' }, { op: 'heal', pctMaxHp: 0.1, who: 'self' }] }],
    },
    ultimate: {
      id: 'hymn-of-the-celestial-queen',
      name: { ru: 'Гимн Небесной Дамки', en: 'Hymn of the Celestial Queen', jp: '天后の聖歌' },
      desc: {
        ru: 'Лиора раскрывает крылья, и обе её диагонали пронзают столпы света: 190% ATK Сиянием и Метка (2 хода) каждому врагу на них; союзницы на этих диагоналях лечатся на 15% макс. HP.',
        en: 'Liora spreads her wings and pillars of light pierce both of her diagonals: 190% ATK Radiance damage and Mark (2 turns) to every enemy on them; allies on those diagonals heal 15% max HP.',
      },
      cost: 90,
      target: { shape: 'diagonals', length: 7, center: 'caster', side: 'enemy' },
      effects: [
        { op: 'damage', mult: 1.9 },
        { op: 'status', id: 'mark', turns: 2 },
        { op: 'heal', pctMaxHp: 0.15, who: 'alliesInShape' },
      ],
      vfx: 'ult-liora',
    },
    quirks: [
      {
        id: 'born-crowned',
        name: { ru: 'Корона с рождения', en: 'Born Crowned' },
        desc: {
          ru: 'Начинает бой уже дамкой: +20% ATK и DEF, полёт по диагонали. Если за один ход противника потеряет 30% макс. HP и больше — корона слетает, пока Лиора снова не дойдёт до заднего ряда врага.',
          en: 'Starts the battle already a queen: +20% ATK and DEF, diagonal flight. If she loses 30%+ of her max HP during one enemy turn, the Crown falls off until she reaches the enemy back row again.',
        },
        rules: [{ rule: 'startCrowned', params: { lossThresholdPct: 0.3 } }],
      },
      {
        id: 'heavenly-swap',
        name: { ru: 'Небесная рокировка', en: 'Heavenly Swap' },
        desc: {
          ru: 'Раз за бой вместо хода может поменяться местами с любой союзницей на доске.',
          en: 'Once per battle, instead of moving, she can swap places with any ally on the board.',
        },
        rules: [{ rule: 'swapMove', params: { range: 7, usesPerBattle: 1 } }],
      },
    ],
    constellations: [
      { c: 1, desc: { ru: 'Приговор бьёт на 4 клетки.', en: 'Dawn Verdict reaches 4 squares.' }, patches: [{ path: 'skill.target.length', set: 4 }] },
      { c: 2, desc: { ru: 'Корона слетает только при потере 45% HP за ход.', en: 'The Crown falls only at 45% HP lost in one turn.' }, patches: [{ path: 'quirks.0.rules.0.params.lossThresholdPct', set: 0.45 }] },
      { c: 3, desc: { ru: 'Урон Приговора +20%.', en: 'Dawn Verdict damage +20%.' }, patches: [{ path: 'skill.mult', mul: 1.2 }] },
      { c: 4, desc: { ru: 'Гимн снимает все негативные эффекты с союзниц на диагоналях.', en: 'The Hymn cleanses all debuffs from allies on its diagonals.' }, patches: [{ effect: { op: 'cleanse', count: 'all', who: 'alliesInShape' }, to: 'ultimate' }] },
      { c: 5, desc: { ru: 'Урон Гимна +20%.', en: 'Hymn damage +20%.' }, patches: [{ path: 'ultimate.mult', mul: 1.2 }] },
      { c: 6, desc: { ru: '«Вечная Дамка»: Гимн стоит 80 энергии и возвращает потерянную корону.', en: '"Eternal Queen": the Hymn costs 80 energy and restores a lost Crown.' }, patches: [{ path: 'ultimate.cost', set: 80 }, { effect: { op: 'awaken', bonuses: false, if: { selfAwakened: false } }, to: 'ultimate' }] },
    ],
    lore: {
      ru: 'Первая фигура, когда-либо коронованная на Доске Мироздания. Говорят, каждая шашка, дошедшая до края, слышит её голос.',
      en: 'The first piece ever crowned on the Board of Creation. They say every piece that reaches the far edge hears her voice.',
    },
    personality: { ru: ['благородная', 'тёплая', 'непоколебимая', 'чуть старомодная'], en: ['noble', 'warm', 'unshakeable', 'a little old-fashioned'] },
    palette: ['#FFF4C9', '#F2C14E', '#7FD8FF'],
    voice: 'radiant-sovereign',
    art: {
      prompt: artPrompt('f', 'mythic', 'Subject: an adult woman, a divine queen-knight of light. Long flowing platinum-blonde hair with a single side braid, golden eyes, serene confident smile. A radiant halo of eight golden star points floats behind her head; a pair of large luminous white-gold feathered wings. Outfit: high-collared white and gold plate armour over a long flowing white skirt-cape, long sleeves, gauntlets, a black-and-gold checkered sash at the waist. Weapon: a huge greatsword of crystallised starlight held diagonally across her body. Palette: white, warm gold, pale sky blue. Background: a celestial throne hall floating in a sunrise sky, beams of light falling across a giant floating checkerboard floor.'),
      focal: { x: 0.466, y: 0.175 },
    },
  },
  {
    id: 'nocturna',
    name: { ru: 'Ноктюрна', en: 'Nocturna', jp: 'ノクトゥルナ' },
    title: { ru: 'Императрица Затмения', en: 'Empress of the Eclipse' },
    gender: 'f', rarity: 'mythic', element: 'umbra', role: 'mystic',
    base: { hp: 650, atk: 250, def: 37, crit: 5, aff: 120 },
    growth: { hp: 48.1, atk: 18.5, def: 2.7 },
    move: cp(MOVE.blink2), basic: cp(BASIC.bolt2), jump: cp(JUMP.ranged),
    skill: {
      id: 'moonfall-rift',
      name: { ru: 'Лунный провал', en: 'Moonfall Rift', jp: '月堕ち' },
      desc: {
        ru: 'Обрушивает осколок луны на клетку в пределах 3: 100% ATK Сумраком врагам в радиусе 1; враг в центре получает Немоту на 1 ход.',
        en: 'Drops a shard of the moon on a square within 3: 100% ATK Umbra damage to enemies within radius 1; the enemy in the center is Silenced for 1 turn.',
      },
      cooldown: 3,
      target: { shape: 'radius', r: 1, center: 'square', range: 3, side: 'enemy' },
      effects: [
        { op: 'damage', mult: 1.0 },
        { op: 'status', id: 'silence', turns: 1, who: 'center' },
      ],
    },
    passive: {
      id: 'hunger-of-the-abyss',
      name: { ru: 'Голод бездны', en: 'Hunger of the Abyss' },
      desc: {
        ru: 'Каждое попадание Ноктюрны сжигает цели 5 энергии. Когда враг применяет Вспышку, Ноктюрна получает +20 энергии.',
        en: "Every hit from Nocturna burns 5 of the target's energy. Whenever an enemy casts an Ultimate, Nocturna gains +20 energy.",
      },
      triggers: [
        { on: 'hitDealt', effects: [{ op: 'energy', amount: -5, who: 'eventTarget' }] },
        { on: 'enemyUlt', effects: [{ op: 'energy', amount: 20, who: 'self' }] },
      ],
    },
    ultimate: {
      id: 'imperial-eclipse',
      name: { ru: 'Императорское Затмение', en: 'Imperial Eclipse', jp: '皇蝕' },
      desc: {
        ru: 'Чёрное солнце гасит доску: всем врагам 90% ATK Сумраком, −20 энергии и Порча (лечение −50%) на 2 хода.',
        en: 'A black sun extinguishes the board: 90% ATK Umbra damage, −20 energy and Blight (healing −50%) for 2 turns to every enemy.',
      },
      cost: 100,
      target: { shape: 'all', side: 'enemy' },
      effects: [
        { op: 'damage', mult: 0.9 },
        { op: 'energy', amount: -20 },
        { op: 'status', id: 'blight', turns: 2 },
      ],
      vfx: 'ult-nocturna',
    },
    quirks: [
      {
        id: 'dusk-double',
        name: { ru: 'Двойник в сумраке', en: 'Dusk Double' },
        desc: {
          ru: 'В начале боя ставит на свой задний ряд Двойника (20% её макс. HP). Раз за бой, получив смертельный удар, пока Двойник стоит, Ноктюрна меняется с ним местами: Двойник рассыпается, а она остаётся с 30% HP и Сокрытием на 1 ход.',
          en: 'At battle start she places a Double (20% of her max HP) on her own back row. Once per battle, if she takes a lethal hit while the Double stands, they swap: the Double crumbles and she survives at 30% HP, Veiled for 1 turn.',
        },
        rules: [{ rule: 'decoyWard', params: { hpPct: 0.2, place: 'ownBackRow', reviveHpPct: 0.3, veil: 1 } }],
      },
      {
        id: 'stride-through-darkness',
        name: { ru: 'Поступь сквозь тьму', en: 'Stride Through Darkness' },
        desc: {
          ru: 'Не ходит, а телепортируется: на любую свободную тёмную клетку в пределах 2 (дамкой — в пределах 3).',
          en: 'She never walks — she teleports to any empty dark square within 2 (within 3 once Crowned).',
        },
        rules: [{ rule: 'blinkMove', params: { range: 2 } }],
      },
    ],
    constellations: [
      { c: 1, desc: { ru: 'Двойник получает 30% HP.', en: 'The Double has 30% HP.' }, patches: [{ path: 'quirks.0.rules.0.params.hpPct', set: 0.3 }] },
      { c: 2, desc: { ru: 'Перезарядка Лунного провала 2.', en: 'Moonfall Rift cooldown 2.' }, patches: [{ path: 'skill.cooldown', set: 2 }] },
      { c: 3, desc: { ru: 'Урон Лунного провала +20%.', en: 'Moonfall Rift damage +20%.' }, patches: [{ path: 'skill.mult', mul: 1.2 }] },
      { c: 4, desc: { ru: 'Попадания сжигают 10 энергии; за Вспышку врага +30.', en: 'Hits burn 10 energy; +30 per enemy Ultimate.' }, patches: [{ path: 'passive.triggers.0.effects.0.amount', set: -10 }, { path: 'passive.triggers.1.effects.0.amount', set: 30 }] },
      { c: 5, desc: { ru: 'Урон Затмения +20%.', en: 'Eclipse damage +20%.' }, patches: [{ path: 'ultimate.mult', mul: 1.2 }] },
      { c: 6, desc: { ru: '«Вечная ночь»: Затмение накладывает на всех врагов Немоту на 1 ход.', en: '"Endless Night": the Eclipse Silences every enemy for 1 turn.' }, patches: [{ effect: { op: 'status', id: 'silence', turns: 1 }, to: 'ultimate' }] },
    ],
    lore: {
      ru: 'Императрица ночной стороны доски, которой наскучила вечность. Она пришла не помогать, а проверить, сумеешь ли ты её удивить.',
      en: "Empress of the board's night side, bored of eternity. She came not to help, but to see whether you can surprise her.",
    },
    personality: { ru: ['властная', 'загадочная', 'скучающая', 'втайне любопытная'], en: ['imperious', 'mysterious', 'bored', 'secretly curious'] },
    palette: ['#1A0820', '#D7337E', '#8A7CFF'],
    voice: 'eclipse-empress',
    art: {
      prompt: artPrompt('f', 'mythic', 'Subject: an adult woman, an imperial sorceress of the eclipse. Long straight black hair with magenta inner highlights, pale skin, violet-magenta eyes, calm imperious expression. A black eclipse-sun halo with a magenta corona behind her head; translucent wings made of starry night sky. Outfit: high-necked black and deep-violet imperial gown with long sleeves, layered skirt embroidered with constellations, silver crescent jewellery. Weapon: a slender crescent-topped sceptre, with an orb of black flame floating above her raised palm. Palette: black, magenta-crimson, lavender. Background: a dark palace balcony under a total solar eclipse, ink-like shadow tendrils and drifting stars.'),
      focal: { x: 0.514, y: 0.182 },
    },
  },

  // ============================================================================== LEGENDARY
  {
    id: 'reika',
    name: { ru: 'Рэйка', en: 'Reika', jp: '零華' },
    title: { ru: 'Громовая Баллиста', en: 'The Thunder Ballista' },
    gender: 'f', rarity: 'legendary', element: 'storm', role: 'ranger',
    base: { hp: 600, atk: 280, def: 32, crit: 20, aff: 30 },
    growth: { hp: 43.2, atk: 20.2, def: 2.3 },
    move: cp(MOVE.step1), basic: cp(BASIC.shot4), jump: cp(JUMP.ranged),
    skill: {
      id: 'rail-shot',
      name: { ru: 'Рельсовый выстрел', en: 'Rail Shot', jp: '電磁貫通' },
      desc: {
        ru: 'Выстрел через всю диагональ: 150% ATK Грозой каждому врагу на линии; первого задетого отбрасывает на 1 клетку.',
        en: 'A shot through the whole diagonal: 150% ATK Storm damage to every enemy on the line; the first one hit is pushed 1 square.',
      },
      cooldown: 3,
      target: { shape: 'line', length: 7, pierce: true, side: 'enemy' },
      effects: [
        { op: 'damage', mult: 1.5 },
        { op: 'push', dist: 1, from: 'caster', who: 'firstInLine' },
      ],
    },
    passive: {
      id: 'cold-calculation',
      name: { ru: 'Холодный расчёт', en: 'Cold Calculation' },
      desc: {
        ru: 'Дальность обычной атаки 5 вместо 4. +20% к шансу крита по целям в 3+ клетках.',
        en: 'Basic attack range 5 instead of 4. +20% crit chance against targets 3+ squares away.',
      },
      mods: [{ stat: 'basicRange', value: 1 }, { stat: 'critChance', value: 20, if: { distanceAtLeast: 3 } }],
    },
    ultimate: {
      id: 'heaven-ballista',
      name: { ru: 'Небесная баллиста', en: 'Heaven Ballista', jp: '天弩' },
      desc: {
        ru: 'Молния с неба в любого врага на доске: 200% ATK Грозой, затем разряд дважды перескакивает на ближайших врагов в пределах 2 (по 100% ATK).',
        en: 'Lightning from the sky strikes any enemy on the board: 200% ATK Storm damage, then it jumps twice to the nearest enemies within 2 (100% ATK each).',
      },
      cost: 80,
      target: { shape: 'single', range: 7, los: 'free', side: 'enemy' },
      effects: [
        { op: 'damage', mult: 2.0 },
        { op: 'bounce', count: 2, range: 2, mult: 1.0 },
      ],
      vfx: 'ult-reika',
    },
    quirks: [
      {
        id: 'charge',
        name: { ru: 'Заряд', en: 'Charge' },
        desc: {
          ru: 'За каждый ход своей стороны, когда Рэйку не активировали, она копит Заряд (макс. 3). Следующее атакующее действие тратит все Заряды: +20% урона за каждый, а её выстрелы пробивают насквозь.',
          en: 'For each own turn in which Reika was not activated she gains a Charge (max 3). Her next damaging action spends them all: +20% damage per Charge, and her shots pierce.',
        },
        rules: [{ rule: 'chargeStacks', params: { max: 3, dmgPerStack: 0.2, pierceWhenCharged: true } }],
      },
      {
        id: 'personal-space',
        name: { ru: 'Личное пространство', en: 'Personal Space' },
        desc: {
          ru: 'Раз за ход врага: если враг закончил ход вплотную к Рэйке, она тут же отпрыгивает на 1 клетку назад.',
          en: 'Once per enemy turn: if an enemy ends its activation next to Reika, she instantly hops 1 square back.',
        },
        rules: [{ rule: 'retreatOnAdjacent', params: { steps: 1 } }],
      },
    ],
    constellations: [
      { c: 1, desc: { ru: 'До 4 Зарядов.', en: 'Up to 4 Charges.' }, patches: [{ path: 'quirks.0.rules.0.params.max', set: 4 }] },
      { c: 2, desc: { ru: 'Перезарядка Рельсового выстрела 2.', en: 'Rail Shot cooldown 2.' }, patches: [{ path: 'skill.cooldown', set: 2 }] },
      { c: 3, desc: { ru: 'Урон Рельсового выстрела +20%.', en: 'Rail Shot damage +20%.' }, patches: [{ path: 'skill.mult', mul: 1.2 }] },
      { c: 4, desc: { ru: 'Отпрыгивая, бьёт подошедшего врага на 60% ATK.', en: 'When she hops back, she zaps the enemy for 60% ATK.' }, patches: [{ trigger: { on: 'enemyEndsAdjacent', oncePerTurn: true, effects: [{ op: 'damage', mult: 0.6, who: 'eventSource' }] } }] },
      { c: 5, desc: { ru: 'Урон Баллисты +20%.', en: 'Ballista damage +20%.' }, patches: [{ path: 'ultimate.mult', mul: 1.2 }] },
      { c: 6, desc: { ru: 'Разряд Баллисты перескакивает 4 раза по 130% ATK.', en: 'The Ballista arc jumps 4 times at 130% ATK.' }, patches: [{ path: 'ultimate.effects.1.count', set: 4 }, { path: 'ultimate.effects.1.mult', set: 1.3 }] },
    ],
    lore: {
      ru: 'Снайпер Громовой стражи, которая считает углы рикошета быстрее, чем моргает. Никогда не промахивается — и никогда не улыбается на службе.',
      en: 'A Thunder Guard sniper who calculates ricochet angles faster than she blinks. She never misses — and never smiles on duty.',
    },
    personality: { ru: ['хладнокровная', 'точная', 'немногословная', 'любит расчёты'], en: ['cool-headed', 'precise', 'laconic', 'loves calculations'] },
    palette: ['#A46BFF', '#2B2D42', '#F4E9FF'],
    voice: 'cool-marksman',
    art: {
      prompt: artPrompt('f', 'legendary', 'Subject: an adult woman, a cool-headed thunder sniper. Short asymmetrical lavender bob with one longer side lock, sharp violet eyes, a small crystal targeting lens over one eye, focused expression. Outfit: long dark-navy military greatcoat with violet trim, high collar, long sleeves, fitted gloves and tall boots. Weapon: a large ornate crossbow-railgun crackling with violet lightning, aimed in a firing stance with one knee raised. Palette: violet, dark navy, white. Background: a storm-lashed watchtower rooftop at night, lightning across purple clouds.'),
      focal: { x: 0.423, y: 0.214 },
    },
  },
  {
    id: 'fuyuka',
    name: { ru: 'Фуюка', en: 'Fuyuka', jp: '冬華' },
    title: { ru: 'Ледяная Цитадель', en: 'The Glacier Citadel' },
    gender: 'f', rarity: 'legendary', element: 'frost', role: 'guardian',
    base: { hp: 950, atk: 115, def: 100, crit: 5, aff: 40 },
    growth: { hp: 68.4, atk: 8.3, def: 7.2 },
    move: cp(MOVE.step1), basic: cp(BASIC.melee), jump: cp(JUMP.guardian),
    skill: {
      id: 'ice-bastion',
      name: { ru: 'Ледяной бастион', en: 'Ice Bastion', jp: '氷の城壁' },
      desc: {
        ru: 'Возводит до 2 ледяных стен на свободных соседних клетках (по 25% её макс. HP, 3 хода). Стены преграждают путь и прыжки; союзницы рядом со стеной получают +20% DEF.',
        en: 'Raises up to 2 ice walls on empty adjacent squares (25% of her max HP each, 3 turns). Walls block movement and jumps; allies next to a wall get +20% DEF.',
      },
      cooldown: 3,
      target: { shape: 'square', range: 1, count: 2, empty: true },
      effects: [
        { op: 'ward', id: 'ice-wall', hpPct: 0.25, turns: 3, blocks: true, jumpable: true, aura: { range: 1, side: 'ally', mods: [{ stat: 'defPct', value: 0.2 }] } },
      ],
    },
    passive: {
      id: 'regal-chill',
      name: { ru: 'Холод величия', en: 'Regal Chill' },
      desc: {
        ru: 'Враг, ударивший Фуюку вплотную (обычной атакой или прыжком), получает Печать Инея и Замедление на 1 ход.',
        en: 'An enemy that hits Fuyuka up close (basic attack or jump-strike) receives a Frost seal and is Slowed for 1 turn.',
      },
      triggers: [{ on: 'meleeHitTaken', effects: [{ op: 'seal', element: 'frost', who: 'eventSource' }, { op: 'status', id: 'slow', turns: 1, who: 'eventSource' }] }],
    },
    ultimate: {
      id: 'palace-of-eternal-winter',
      name: { ru: 'Дворец вечной зимы', en: 'Palace of Eternal Winter', jp: '永冬の宮' },
      desc: {
        ru: 'Вокруг Фуюки вырастает ледяной дворец (радиус 2): враги получают 150% DEF урона Инеем и Заморозку на 1 ход; союзницы — щит в 20% её макс. HP на 2 хода.',
        en: 'An ice palace rises around Fuyuka (radius 2): enemies take 150% DEF as Frost damage and are Frozen for 1 turn; allies gain a shield of 20% of her max HP for 2 turns.',
      },
      cost: 80,
      target: { shape: 'radius', r: 2, center: 'caster', side: 'any' },
      effects: [
        { op: 'damage', mult: 1.5, stat: 'def', who: 'enemiesInShape' },
        { op: 'status', id: 'frozen', turns: 1, who: 'enemiesInShape' },
        { op: 'shield', pctCasterMaxHp: 0.2, turns: 2, who: 'alliesInShape' },
      ],
      vfx: 'ult-fuyuka',
    },
    quirks: [
      {
        id: 'royal-etiquette',
        name: { ru: 'Королевский этикет', en: 'Royal Etiquette' },
        desc: {
          ru: 'Её нельзя толкнуть, притянуть, поменять местами или бросить. Перепрыгнуть Фуюку могут только вражеские дамки и Тени.',
          en: "She can't be pushed, pulled, swapped or tossed. Only Crowned enemies and Shadows can jump-strike her.",
        },
        rules: [{ rule: 'displaceImmune', params: {} }, { rule: 'jumpProof', params: { except: ['shadow'] } }],
      },
      {
        id: 'ice-throne',
        name: { ru: 'Ледяной трон', en: 'Ice Throne' },
        desc: {
          ru: 'Если в свою активацию Фуюка не сдвинулась с места, она получает щит в 10% макс. HP на 2 хода.',
          en: 'If Fuyuka does not move during her activation, she gains a shield of 10% max HP for 2 turns.',
        },
        triggers: [{ on: 'afterAction', if: { selfMoved: false }, effects: [{ op: 'shield', pctMaxHp: 0.1, turns: 2, who: 'self' }] }],
      },
    ],
    constellations: [
      { c: 1, desc: { ru: 'Ледяные стены — 35% HP.', en: 'Ice walls have 35% HP.' }, patches: [{ path: 'skill.effects.0.hpPct', set: 0.35 }] },
      { c: 2, desc: { ru: 'Холод величия также Ослабляет на 1 ход.', en: 'Regal Chill also Weakens for 1 turn.' }, patches: [{ effect: { op: 'status', id: 'weaken', turns: 1, who: 'eventSource' }, to: 'passive.triggers.0' }] },
      { c: 3, desc: { ru: 'Бастион: 3 стены на 4 хода.', en: 'Bastion: 3 walls for 4 turns.' }, patches: [{ path: 'skill.target.count', set: 3 }, { path: 'skill.effects.0.turns', set: 4 }] },
      { c: 4, desc: { ru: 'Щит Дворца — 30% её макс. HP.', en: "The Palace shield is 30% of her max HP." }, patches: [{ path: 'ultimate.effects.2.pctCasterMaxHp', set: 0.3 }] },
      { c: 5, desc: { ru: 'Урон Дворца +20%.', en: 'Palace damage +20%.' }, patches: [{ path: 'ultimate.mult', mul: 1.2 }] },
      { c: 6, desc: { ru: 'Заморозка Дворца — 2 хода; союзницы наносят Замороженным врагам +20% урона.', en: 'The Palace freezes for 2 turns; allies deal +20% damage to Frozen enemies.' }, patches: [{ path: 'ultimate.effects.1.turns', set: 2 }, { aura: { range: 7, side: 'ally', mods: [{ stat: 'dmgPct', value: 0.2, if: { targetHasStatus: 'frozen' } }] } }] },
    ],
    lore: {
      ru: 'Хозяйка Ледяного дворца, где даже снежинки падают по этикету. Её крепость не пала ни разу — и она не позволит испортить эту статистику.',
      en: "Mistress of the Ice Palace, where even snowflakes fall by etiquette. Her fortress has never fallen — and she won't let you ruin that record.",
    },
    personality: { ru: ['аристократка', 'гордая', 'втайне заботливая', 'обожает чай'], en: ['aristocratic', 'proud', 'secretly caring', 'adores tea'] },
    palette: ['#8EEBFF', '#E8F7FF', '#3B5B8C'],
    voice: 'frost-noble',
    art: {
      prompt: artPrompt('f', 'legendary', 'Subject: an adult woman, an aristocratic ice-queen guardian. Long silver-white hair in an elegant updo with an ice-crystal tiara, pale blue eyes, poised proud expression. Outfit: high-collared pale-blue and white armoured gown with a structured breastplate, long sleeves, a short fur-trimmed cape. Weapon: a tall crystalline tower shield in one hand and a slender ice lance in the other. Palette: ice cyan, white, deep royal blue. Background: a frozen palace hall of glacier pillars and icicle chandeliers, snow drifting in blue light.'),
      focal: { x: 0.517, y: 0.167 },
    },
  },
  {
    id: 'vermilia',
    name: { ru: 'Вермилия', en: 'Vermilia', jp: 'ヴァーミリア' },
    title: { ru: 'Феникс Последнего Хода', en: 'Phoenix of the Final Move' },
    gender: 'f', rarity: 'legendary', element: 'flame', role: 'mystic',
    base: { hp: 650, atk: 256, def: 33, crit: 10, aff: 100 },
    growth: { hp: 46.8, atk: 18.4, def: 2.4 },
    move: cp(MOVE.step1), basic: cp(BASIC.bolt2), jump: cp(JUMP.ranged),
    skill: {
      id: 'fire-fan',
      name: { ru: 'Огненный веер', en: 'Fire Fan', jp: '炎扇' },
      desc: {
        ru: 'Раскрывает веер пламени по всем четырём диагоналям на 2 клетки: 100% ATK Пламенем каждому врагу.',
        en: 'Opens a fan of flame along all four diagonals for 2 squares: 100% ATK Flame damage to each enemy.',
      },
      cooldown: 2,
      target: { shape: 'diagonals', length: 2, center: 'caster', side: 'enemy' },
      effects: [{ op: 'damage', mult: 1.0 }],
    },
    passive: {
      id: 'ashes-to-ashes',
      name: { ru: 'Пепел к пеплу', en: 'Ashes to Ashes' },
      desc: {
        ru: 'Каждое попадание Вермилии поджигает цель (Горение, 2 хода). По горящим целям она наносит +25% урона.',
        en: 'Every hit from Vermilia sets the target on fire (Burn, 2 turns). She deals +25% damage to Burning targets.',
      },
      triggers: [{ on: 'hitDealt', effects: [{ op: 'status', id: 'burn', turns: 2, who: 'eventTarget' }] }],
      mods: [{ stat: 'dmgPct', value: 0.25, if: { targetHasStatus: 'burn' } }],
    },
    ultimate: {
      id: 'phoenix-final-move',
      name: { ru: 'Последний ход феникса', en: "The Phoenix's Final Move", jp: '不死鳥の一手' },
      desc: {
        ru: 'Вермилия становится фениксом и пролетает диагональ насквозь: 180% ATK Пламенем всем врагам на пути, огненный след (2 хода) поджигает тех, кто на нём стоит. Приземляется на самую дальнюю свободную клетку — если это задний ряд врага, она становится дамкой.',
        en: 'Vermilia becomes a phoenix and flies through a whole diagonal: 180% ATK Flame damage to every enemy in the path and a fiery trail (2 turns) that burns anyone standing on it. She lands on the farthest empty square — if it is the enemy back row, she is Crowned.',
      },
      cost: 90,
      target: { shape: 'line', length: 7, pierce: true, side: 'enemy' },
      effects: [
        { op: 'damage', mult: 1.8 },
        { op: 'zone', id: 'phoenix-trail', turns: 2, side: 'enemy', onTurnStart: [{ op: 'status', id: 'burn', turns: 2 }], onEnter: [{ op: 'status', id: 'burn', turns: 2 }] },
        { op: 'moveSelf', to: 'lineEnd' },
      ],
      vfx: 'ult-vermilia',
    },
    quirks: [
      {
        id: 'rebirth-from-ashes',
        name: { ru: 'Возрождение из пепла', en: 'Rebirth from Ashes' },
        desc: {
          ru: 'Раз за бой, выбыв, Вермилия превращается в Яйцо феникса (25% её макс. HP) на своей клетке. Если яйцо доживёт до начала 2-го хода её стороны, она вылупляется с 40% HP и полной энергией. Разбитое яйцо — окончательный нокаут.',
          en: 'Once per battle, when KO’d, Vermilia turns into a Phoenix Egg (25% of her max HP) on her square. If the egg survives to the start of her side’s 2nd turn, she hatches with 40% HP and full energy. A broken egg means a final KO.',
        },
        rules: [{ rule: 'eggRevive', params: { eggHpPct: 0.25, hatchAfterTurns: 2, hatchHpPct: 0.4, hatchEnergy: 'full', hatchBlastMult: 0 } }],
      },
      {
        id: 'diva',
        name: { ru: 'Дива', en: 'Diva' },
        desc: {
          ru: 'Любит быть в центре внимания: когда союзница применяет Вспышку, Вермилия получает +10 энергии.',
          en: 'Loves the spotlight: whenever an ally casts an Ultimate, Vermilia gains +10 energy.',
        },
        triggers: [{ on: 'allyUlt', effects: [{ op: 'energy', amount: 10, who: 'self' }] }],
      },
    ],
    constellations: [
      { c: 1, desc: { ru: 'Урон по горящим +40%.', en: '+40% damage to Burning targets.' }, patches: [{ path: 'passive.mods.0.value', set: 0.4 }] },
      { c: 2, desc: { ru: 'Яйцо феникса — 40% HP.', en: 'The Phoenix Egg has 40% HP.' }, patches: [{ path: 'quirks.0.rules.0.params.eggHpPct', set: 0.4 }] },
      { c: 3, desc: { ru: 'Урон Огненного веера +20%.', en: 'Fire Fan damage +20%.' }, patches: [{ path: 'skill.mult', mul: 1.2 }] },
      { c: 4, desc: { ru: 'Огненный след держится 3 хода.', en: 'The fiery trail lasts 3 turns.' }, patches: [{ path: 'ultimate.effects.1.turns', set: 3 }] },
      { c: 5, desc: { ru: 'Урон Последнего хода +20%.', en: 'Final Move damage +20%.' }, patches: [{ path: 'ultimate.mult', mul: 1.2 }] },
      { c: 6, desc: { ru: 'Вылупляется с 70% HP, и вылупление взрывается: 200% ATK врагам в радиусе 1.', en: 'Hatches at 70% HP, and the hatching explodes: 200% ATK to enemies within radius 1.' }, patches: [{ path: 'quirks.0.rules.0.params.hatchHpPct', set: 0.7 }, { path: 'quirks.0.rules.0.params.hatchBlastMult', set: 2.0 }] },
    ],
    lore: {
      ru: 'Феникс, сгоравшая и возрождавшаяся сто раз, — и каждый раз эффектнее прежнего. Обожает сцену, аплодисменты и последние ходы.',
      en: 'A phoenix who has burned and risen a hundred times — each time more dazzling than before. She adores the stage, applause and final moves.',
    },
    personality: { ru: ['кокетливая', 'эффектная', 'бесстрашная', 'старшая сестра для всех'], en: ['flirtatious', 'flamboyant', 'fearless', 'everyone’s big sister'] },
    palette: ['#FF5B3A', '#FFC24B', '#3A0F12'],
    voice: 'elder-sister',
    art: {
      prompt: artPrompt('f', 'legendary', 'Subject: an adult woman, a flamboyant phoenix sorceress. Long voluminous crimson hair turning into flame at the tips, amber eyes, playful confident smirk; flaming phoenix feathers fan out behind her like wings. Outfit: high-necked crimson and gold sorceress dress with long sleeves and a layered flame-pattern skirt, gold arm cuffs. Weapon: an ornate folding fan made of fire and a burning phoenix-feather staff. Palette: crimson-orange, gold, dark wine. Background: a volcanic twilight sky with a rising phoenix of fire and swirling embers.'),
      focal: { x: 0.484, y: 0.164 },
    },
  },
  {
    id: 'tsubame',
    name: { ru: 'Цубамэ', en: 'Tsubame', jp: '燕' },
    title: { ru: 'Ласточка Бури', en: 'Swallow of the Storm' },
    gender: 'f', rarity: 'legendary', element: 'gale', role: 'shadow',
    base: { hp: 600, atk: 267, def: 32, crit: 25, aff: 60 },
    growth: { hp: 43.2, atk: 19.2, def: 2.3 },
    move: cp(MOVE.glide3), basic: cp(BASIC.melee), jump: cp(JUMP.shadow),
    skill: {
      id: 'swallow-stroke',
      name: { ru: 'Ласточкин росчерк', en: "Swallow's Stroke", jp: '燕の一筆' },
      desc: {
        ru: 'Летящий прыжок-удар: может перепрыгнуть врага на расстоянии до 3 клеток по диагонали (клетки между — пустые) и приземлиться до 2 клеток за ним; 150% ATK Вихрем. Затем цепочку можно продолжить обычными прыжками (всего до 2).',
        en: 'A flying jump-strike: she can jump an enemy up to 3 squares away along a diagonal (empty squares between) and land up to 2 squares beyond it; 150% ATK Gale damage. The chain can then continue with normal hops (2 total).',
      },
      cooldown: 2,
      target: { shape: 'jump' },
      effects: [{ op: 'jumpStrike', mult: 1.5, chainMax: 2, approachMax: 3, landMax: 2, thenRole: true }],
    },
    passive: {
      id: 'tailwind',
      name: { ru: 'Попутный ветер', en: 'Tailwind' },
      desc: {
        ru: 'После своего действия Цубамэ может скользнуть ещё на 1 клетку.',
        en: 'After her action, Tsubame may glide 1 more square.',
      },
      triggers: [{ on: 'afterAction', effects: [{ op: 'freeMove', glide: 1 }] }],
    },
    ultimate: {
      id: 'thousand-storm-feathers',
      name: { ru: 'Тысяча перьев бури', en: 'Thousand Storm Feathers', jp: '千羽嵐' },
      desc: {
        ru: 'Цубамэ растворяется в урагане (Сокрытие) и наносит 6 ударов по 70% ATK Вихрем врагам в радиусе 3 — по кругу, начиная с самого раненого, не больше 3 по одной цели. Затем появляется на любой свободной клетке в пределах 3.',
        en: 'Tsubame dissolves into a hurricane (Veiled) and lands 6 strikes of 70% ATK Gale damage on enemies within radius 3 — round-robin from the most wounded, max 3 per target. Then she reappears on any empty square within 3.',
      },
      cost: 80,
      target: { shape: 'radius', r: 3, center: 'caster', side: 'enemy' },
      effects: [
        { op: 'status', id: 'untargetable', turns: 1, who: 'self' },
        { op: 'volley', hits: 6, mult: 0.7, maxPerTarget: 3 },
        { op: 'moveSelf', to: 'anyWithin', range: 3 },
      ],
      vfx: 'ult-tsubame',
    },
    quirks: [
      {
        id: 'updraft',
        name: { ru: 'Восходящий поток', en: 'Updraft' },
        desc: {
          ru: 'Раз за ход: выбив врага, Цубамэ тут же получает ещё одну полную активацию.',
          en: 'Once per turn: when Tsubame KOs an enemy, she immediately gets another full activation.',
        },
        triggers: [{ on: 'kill', oncePerTurn: true, effects: [{ op: 'extraActivation' }] }],
      },
      {
        id: 'light-as-a-feather',
        name: { ru: 'Лёгкая как перо', en: 'Light as a Feather' },
        desc: {
          ru: 'Скользя по диагонали, пролетает над союзницами.',
          en: 'When gliding, she flies over allies.',
        },
        rules: [{ rule: 'passThroughAllies', params: {} }],
      },
    ],
    constellations: [
      { c: 1, desc: { ru: 'Попутный ветер — до 2 клеток.', en: 'Tailwind glides up to 2 squares.' }, patches: [{ path: 'passive.triggers.0.effects.0.glide', set: 2 }] },
      { c: 2, desc: { ru: 'Росчерк достаёт врага в 4 клетках.', en: "Swallow's Stroke reaches enemies 4 squares away." }, patches: [{ path: 'skill.effects.0.approachMax', set: 4 }] },
      { c: 3, desc: { ru: 'Урон Росчерка +20%.', en: "Swallow's Stroke damage +20%." }, patches: [{ path: 'skill.mult', mul: 1.2 }] },
      { c: 4, desc: { ru: 'Восходящий поток — до 2 раз за ход.', en: 'Updraft can trigger twice per turn.' }, patches: [{ path: 'quirks.0.triggers.0.oncePerTurn', set: false }, { path: 'quirks.0.triggers.0.maxPerTurn', set: 2 }] },
      { c: 5, desc: { ru: 'Урон Тысячи перьев +20%.', en: 'Thousand Feathers damage +20%.' }, patches: [{ path: 'ultimate.mult', mul: 1.2 }] },
      { c: 6, desc: { ru: '9 ударов, до 4 по одной цели.', en: '9 strikes, up to 4 per target.' }, patches: [{ path: 'ultimate.effects.1.hits', set: 9 }, { path: 'ultimate.effects.1.maxPerTarget', set: 4 }] },
    ],
    lore: {
      ru: 'Ниндзя с горных перевалов, проигравшая гонку лишь ветру — и то однажды. С тех пор она гоняется за ним по всей доске.',
      en: 'A ninja of the mountain passes who has lost a race only to the wind — and only once. She has been chasing it across the board ever since.',
    },
    personality: { ru: ['сорванец', 'быстрая', 'азартная', 'прямолинейная'], en: ['tomboy', 'fast', 'competitive', 'blunt'] },
    palette: ['#3BE3A0', '#1D3B4A', '#FFFFFF'],
    voice: 'hot-blood',
    art: {
      prompt: artPrompt('f', 'legendary', 'Subject: an adult woman, a tomboyish wind ninja. Short messy dark-teal hair with a long swallow-tail ponytail, bright green eyes, cocky grin, a small scar on one cheek. Outfit: fitted dark-navy ninja jacket with long sleeves and a high collar, a long jade-green scarf trailing in the wind, wrapped forearms, shorts over full-length leggings and tall boots. Weapon: two reverse-grip short blades; swirls of wind and swallow feathers around her as she leaps through the air. Palette: jade green, dark navy, white. Background: cliffs above a sea of clouds with strong wind streaks.'),
      focal: { x: 0.508, y: 0.239 },
    },
  },

  // =================================================================================== EPIC
  {
    id: 'mizuha',
    name: { ru: 'Мидзуха', en: 'Mizuha', jp: '瑞葉' },
    title: { ru: 'Жрица Прилива', en: 'Priestess of the Tide' },
    gender: 'f', rarity: 'epic', element: 'tide', role: 'oracle',
    base: { hp: 680, atk: 173, def: 45, crit: 5, aff: 60 },
    growth: { hp: 47.6, atk: 12.1, def: 3.2 },
    move: cp(MOVE.step1), basic: cp(BASIC.oracle2), jump: cp(JUMP.oracle),
    skill: {
      id: 'tidal-bell',
      name: { ru: 'Колокол прилива', en: 'Tidal Bell', jp: '潮の鈴' },
      desc: {
        ru: 'Звон колокола в радиусе 1: союзницы (и сама Мидзуха) лечатся на 140% ATK и снимают 1 негативный эффект; враги получают Печать Прилива и отбрасываются на 1 клетку.',
        en: 'The bell rings within radius 1: allies (Mizuha included) heal 140% ATK and lose 1 debuff; enemies receive a Tide seal and are pushed 1 square.',
      },
      cooldown: 3,
      target: { shape: 'radius', r: 1, center: 'caster', side: 'any' },
      effects: [
        { op: 'heal', mult: 1.4, who: 'alliesInShape' },
        { op: 'cleanse', count: 1, who: 'alliesInShape' },
        { op: 'seal', element: 'tide', who: 'enemiesInShape' },
        { op: 'push', dist: 1, from: 'caster', who: 'enemiesInShape' },
      ],
    },
    passive: {
      id: 'still-water',
      name: { ru: 'Тихая вода', en: 'Still Water' },
      desc: {
        ru: 'В начале хода своей стороны союзница с наименьшим HP в пределах 2 клеток лечится на 6% макс. HP.',
        en: 'At the start of her side’s turn, the ally with the lowest HP within 2 squares heals 6% max HP.',
      },
      triggers: [{ on: 'turnStart', effects: [{ op: 'heal', pctMaxHp: 0.06, who: 'lowestHpAlly', range: 2, count: 1 }] }],
    },
    ultimate: {
      id: 'high-water',
      name: { ru: 'Высокая вода', en: 'High Water', jp: '大潮' },
      desc: {
        ru: 'Прилив накрывает доску: все союзницы лечатся на 120% ATK и получают +20 энергии, все враги — Печать Прилива (готовьте Пар, Оковы и Разряд!).',
        en: 'The tide floods the board: every ally heals 120% ATK and gains +20 energy; every enemy receives a Tide seal (set up Steam, Shackles and Arc!).',
      },
      cost: 80,
      target: { shape: 'all', side: 'any' },
      effects: [
        { op: 'heal', mult: 1.2, who: 'allAllies' },
        { op: 'energy', amount: 20, who: 'allAllies' },
        { op: 'seal', element: 'tide', who: 'allEnemies' },
      ],
      vfx: 'ult-mizuha',
    },
    quirks: [
      {
        id: 'ebb-and-flow',
        name: { ru: 'Прилив и отлив', en: 'Ebb and Flow' },
        desc: {
          ru: 'В нечётных раундах её лечение сильнее на 30% (прилив), в чётных — её урон сильнее на 30% (отлив).',
          en: 'In odd rounds her healing is 30% stronger (flood tide); in even rounds her damage is 30% stronger (ebb tide).',
        },
        mods: [{ stat: 'healPct', value: 0.3, if: { round: 'odd' } }, { stat: 'dmgPct', value: 0.3, if: { round: 'even' } }],
      },
    ],
    constellations: [
      { c: 1, desc: { ru: 'Тихая вода лечит 2 союзниц.', en: 'Still Water heals 2 allies.' }, patches: [{ path: 'passive.triggers.0.effects.0.count', set: 2 }] },
      { c: 2, desc: { ru: 'Перезарядка Колокола 2.', en: 'Tidal Bell cooldown 2.' }, patches: [{ path: 'skill.cooldown', set: 2 }] },
      { c: 3, desc: { ru: 'Лечение Колокола +20%.', en: 'Tidal Bell healing +20%.' }, patches: [{ path: 'skill.mult', mul: 1.2 }] },
      { c: 4, desc: { ru: 'Высокая вода даёт +30 энергии.', en: 'High Water grants +30 energy.' }, patches: [{ path: 'ultimate.effects.1.amount', set: 30 }] },
      { c: 5, desc: { ru: 'Лечение Высокой воды +20%.', en: 'High Water healing +20%.' }, patches: [{ path: 'ultimate.mult', mul: 1.2 }] },
      { c: 6, desc: { ru: 'Высокая вода даёт всем союзницам Регенерацию на 2 хода.', en: 'High Water grants every ally Regen for 2 turns.' }, patches: [{ effect: { op: 'status', id: 'regen', turns: 2, who: 'allAllies' }, to: 'ultimate' }] },
    ],
    lore: {
      ru: 'Смотрительница маяка на краю Тессеры. Её колокол слышен даже в шторм — и под его звон раны затягиваются, как следы на песке.',
      en: 'Keeper of the lighthouse at the edge of Tessera. Her bell rings even through storms — and at its sound, wounds close like footprints in the sand.',
    },
    personality: { ru: ['спокойная', 'мягкая', 'мечтательная', 'заботливая'], en: ['calm', 'gentle', 'dreamy', 'caring'] },
    palette: ['#2E8BFF', '#BFF4FF', '#F5F0E6'],
    voice: 'quiet-whisper',
    art: {
      prompt: artPrompt('f', 'epic', 'Subject: an adult woman, a gentle tide priestess and lighthouse keeper. Long wavy sea-blue hair with white seashell hairpins, soft blue eyes, calm kind smile. Outfit: layered white and ocean-blue priestess robes with wide long sleeves and a long skirt, a rope belt with a small brass bell. Weapon: a tall staff topped with a large bronze bell and a hanging lantern filled with glowing water. Palette: ocean blue, aqua, warm white. Background: a lighthouse on a rocky shore at twilight with gently glowing waves.'),
      focal: { x: 0.476, y: 0.182 },
    },
  },
  {
    id: 'akane',
    name: { ru: 'Аканэ', en: 'Akane', jp: '茜' },
    title: { ru: 'Алый Клинок', en: 'The Scarlet Blade' },
    gender: 'f', rarity: 'epic', element: 'flame', role: 'blade',
    base: { hp: 650, atk: 249, def: 41, crit: 15, aff: 30 },
    growth: { hp: 45.5, atk: 17.4, def: 2.9 },
    move: cp(MOVE.step2), basic: cp(BASIC.melee), jump: cp(JUMP.blade),
    skill: {
      id: 'scarlet-crescent',
      name: { ru: 'Алый полумесяц', en: 'Scarlet Crescent', jp: '緋の三日月' },
      desc: {
        ru: 'Круговой взмах: 140% ATK Пламенем всем соседним врагам и Горение на 2 хода.',
        en: 'A circular slash: 140% ATK Flame damage to every adjacent enemy and Burn for 2 turns.',
      },
      cooldown: 3,
      target: { shape: 'radius', r: 1, center: 'caster', includeCenter: false, side: 'enemy' },
      effects: [{ op: 'damage', mult: 1.4 }, { op: 'status', id: 'burn', turns: 2 }],
    },
    passive: {
      id: 'hot-blood',
      name: { ru: 'Горячая кровь', en: 'Hot Blood' },
      desc: {
        ru: 'Цепочка прыжков Аканэ — до 4 ударов (а не 3), и каждый прыжок поджигает жертву (Горение, 2 хода).',
        en: "Akane's jump chains reach 4 hops (not 3), and every hop sets the victim on fire (Burn, 2 turns).",
      },
      mods: [{ stat: 'chainMax', value: 1 }],
      triggers: [{ on: 'jumpHop', effects: [{ op: 'status', id: 'burn', turns: 2, who: 'eventTarget' }] }],
    },
    ultimate: {
      id: 'rise-of-the-scarlet-sun',
      name: { ru: 'Восход алого солнца', en: 'Rise of the Scarlet Sun', jp: '緋陽昇' },
      desc: {
        ru: 'Удар-восход по соседнему врагу: 280% ATK Пламенем. Если враг выбит — взрыв задевает врагов вокруг него на 100% ATK.',
        en: 'A sunrise strike on an adjacent enemy: 280% ATK Flame damage. If it KOs the target, the blast hits enemies around it for 100% ATK.',
      },
      cost: 70,
      target: { shape: 'single', range: 1, los: 'adjacent', side: 'enemy' },
      effects: [
        { op: 'damage', mult: 2.8 },
        { op: 'damage', mult: 1.0, who: 'enemiesAroundCenter', if: { ko: true } },
      ],
      vfx: 'ult-akane',
    },
    quirks: [
      {
        id: 'not-one-step-back',
        name: { ru: 'Ни шагу назад', en: 'Not One Step Back' },
        desc: {
          ru: 'Как настоящая шашка, не может ходить назад (бить прыжком — может). За каждый ряд, пройденный от своего края, +12% урона (макс. +48%). Став дамкой, свободна в движении.',
          en: 'Like a true checker, she cannot move backward (jump-strikes may go any way). +12% damage per row advanced from her own edge (max +48%). Once Crowned, she moves freely.',
        },
        rules: [{ rule: 'forwardOnly', params: {} }],
        mods: [{ stat: 'dmgPct', scale: 'rowsAdvanced', perUnit: 0.12, max: 0.48 }],
      },
    ],
    constellations: [
      { c: 1, desc: { ru: 'Восход стоит 60 энергии.', en: 'Scarlet Sun costs 60 energy.' }, patches: [{ path: 'ultimate.cost', set: 60 }] },
      { c: 2, desc: { ru: '+16% урона за ряд (макс. +64%).', en: '+16% damage per row (max +64%).' }, patches: [{ path: 'quirks.0.mods.0.perUnit', set: 0.16 }, { path: 'quirks.0.mods.0.max', set: 0.64 }] },
      { c: 3, desc: { ru: 'Урон Полумесяца +20%.', en: 'Scarlet Crescent damage +20%.' }, patches: [{ path: 'skill.mult', mul: 1.2 }] },
      { c: 4, desc: { ru: 'Её Горение длится 3 хода.', en: 'Her Burns last 3 turns.' }, patches: [{ path: 'skill.effects.1.turns', set: 3 }, { path: 'passive.triggers.0.effects.0.turns', set: 3 }] },
      { c: 5, desc: { ru: 'Урон Восхода +20%.', en: 'Scarlet Sun damage +20%.' }, patches: [{ path: 'ultimate.mult', mul: 1.2 }] },
      { c: 6, desc: { ru: 'Нокаут Восходом возвращает 35 энергии.', en: 'A KO with Scarlet Sun refunds 35 energy.' }, patches: [{ effect: { op: 'energy', amount: 35, who: 'self', if: { ko: true } }, to: 'ultimate' }] },
    ],
    lore: {
      ru: 'Мечница с пограничной заставы, поклявшаяся никогда не отступать. Первой откликнулась на зов Стратега — и первой рвётся в бой.',
      en: "A swordswoman from a border outpost who swore never to retreat. She was the first to answer the Strategist's call — and is always first into battle.",
    },
    personality: { ru: ['горячая', 'упрямая', 'честная', 'рвётся вперёд'], en: ['hot-blooded', 'stubborn', 'honest', 'always charging ahead'] },
    palette: ['#E2232E', '#FF8A3D', '#1E1A1A'],
    voice: 'hot-blood',
    art: {
      prompt: artPrompt('f', 'epic', 'Subject: an adult woman, a hot-blooded flame swordswoman. Long bright scarlet hair in a high ponytail tied with a black ribbon, fierce red-orange eyes, determined grin. Outfit: a crimson and black battle jacket in a kimono style with long sleeves over a fitted black high-necked bodysuit, an armoured shoulder guard, wide trousers and boots. Weapon: a katana wreathed in fire, swung forward in a charging stance. Palette: scarlet, orange, black. Background: a sunrise battlefield with burning embers under a red sky.'),
      focal: { x: 0.52, y: 0.265 },
    },
  },
  {
    id: 'volta',
    name: { ru: 'Вольта', en: 'Volta', jp: 'ヴォルタ' },
    title: { ru: 'Ведьма Громовой Башни', en: 'Witch of the Thunder Tower' },
    gender: 'f', rarity: 'epic', element: 'storm', role: 'mystic',
    base: { hp: 570, atk: 227, def: 32, crit: 10, aff: 100 },
    growth: { hp: 39.9, atk: 15.9, def: 2.2 },
    move: cp(MOVE.step1), basic: cp(BASIC.bolt2), jump: cp(JUMP.ranged),
    skill: {
      id: 'ball-lightning',
      name: { ru: 'Шаровая молния', en: 'Ball Lightning', jp: '球雷' },
      desc: {
        ru: 'Выпускает на свободную клетку в пределах 3 шаровую молнию (2 хода, лопается от любого удара). В начале каждого хода Вольты она бьёт ближайшего врага в пределах 2 на 80% ATK Грозой.',
        en: 'Releases a ball lightning onto an empty square within 3 (2 turns, pops on any hit). At the start of each of Volta’s turns it zaps the nearest enemy within 2 for 80% ATK Storm damage.',
      },
      cooldown: 3,
      target: { shape: 'square', range: 3, count: 1, empty: true },
      effects: [
        { op: 'ward', id: 'ball-lightning', hp: 1, turns: 2, blocks: true, jumpable: true, behavior: [{ on: 'turnStart', effects: [{ op: 'damage', mult: 0.8, who: 'nearestEnemy', range: 2, count: 1 }] }] },
      ],
    },
    passive: {
      id: 'lightning-rod',
      name: { ru: 'Громоотвод', en: 'Lightning Rod' },
      desc: {
        ru: 'Когда её сторона вызывает Детонацию, Разряд или Хрупкость, Вольта получает +10 энергии.',
        en: 'Whenever her side triggers Detonation, Arc or Brittleness, Volta gains +10 energy.',
      },
      triggers: [{ on: 'allyReaction', if: { reaction: ['detonation', 'arc', 'brittle'] }, effects: [{ op: 'energy', amount: 10, who: 'self' }] }],
    },
    ultimate: {
      id: 'scheduled-thunderstorm',
      name: { ru: 'Гроза по расписанию', en: 'Scheduled Thunderstorm', jp: '落雷注意報' },
      desc: {
        ru: 'Молнии падают крестом в любой точке доски (центр и по 2 клетки в каждую прямую сторону): 160% ATK Грозой каждому врагу.',
        en: 'Lightning falls in a cross anywhere on the board (center plus 2 squares in each straight direction): 160% ATK Storm damage to each enemy.',
      },
      cost: 80,
      target: { shape: 'cross', length: 2, center: 'target', range: 7, side: 'enemy' },
      effects: [{ op: 'damage', mult: 1.6 }],
      vfx: 'ult-volta',
    },
    quirks: [
      {
        id: 'fidget',
        name: { ru: 'Непоседа', en: 'Fidget' },
        desc: {
          ru: 'Не может усидеть на месте: после своего действия обязательно телепортируется на свободную клетку в пределах 2.',
          en: "Can't sit still: after her action she must teleport to an empty square within 2.",
        },
        rules: [{ rule: 'blinkAfterAction', params: { range: 2 } }],
      },
    ],
    constellations: [
      { c: 1, desc: { ru: 'Шаровая молния живёт 3 хода.', en: 'Ball Lightning lasts 3 turns.' }, patches: [{ path: 'skill.effects.0.turns', set: 3 }] },
      { c: 2, desc: { ru: 'Молния бьёт 2 врагов.', en: 'The ball zaps 2 enemies.' }, patches: [{ path: 'skill.effects.0.behavior.0.effects.0.count', set: 2 }] },
      { c: 3, desc: { ru: 'Урон Шаровой молнии +20%.', en: 'Ball Lightning damage +20%.' }, patches: [{ path: 'skill.mult', mul: 1.2 }] },
      { c: 4, desc: { ru: 'Громоотвод даёт +15 энергии.', en: 'Lightning Rod grants +15 energy.' }, patches: [{ path: 'passive.triggers.0.effects.0.amount', set: 15 }] },
      { c: 5, desc: { ru: 'Урон Грозы +20%.', en: 'Thunderstorm damage +20%.' }, patches: [{ path: 'ultimate.mult', mul: 1.2 }] },
      { c: 6, desc: { ru: 'Крест длиной 3; враг в центре Оглушён на 1 ход.', en: 'Cross length 3; the enemy in the center is Stunned for 1 turn.' }, patches: [{ path: 'ultimate.target.length', set: 3 }, { effect: { op: 'status', id: 'stun', turns: 1, who: 'center' }, to: 'ultimate' }] },
    ],
    lore: {
      ru: 'Ведьма, которая сама построила себе Громовую башню (и трижды её взорвала). Её ручная тучка — лучший друг и главный подозреваемый.',
      en: 'A witch who built her own Thunder Tower (and blew it up three times). Her pet cloud is both her best friend and the prime suspect.',
    },
    personality: { ru: ['озорная', 'болтливая', 'изобретательная', 'шкодница'], en: ['mischievous', 'chatty', 'inventive', 'prankster'] },
    palette: ['#A46BFF', '#FFE14D', '#2A2140'],
    voice: 'trickster',
    art: {
      prompt: artPrompt('f', 'epic', 'Subject: an adult woman, a mischievous storm witch. Fluffy medium-length violet hair with yellow lightning-shaped streaks, a tall crooked witch hat with a copper lightning rod on top, bright yellow eyes, teasing wink; a small grumpy storm-cloud pet floats beside her. Outfit: high-collared purple witch coat with long sleeves and yellow trim, a long skirt, striped stockings and boots. Weapon: a staff shaped like a lightning rod crackling with sparks, which she sits on sideways. Palette: violet, electric yellow, dark plum. Background: a crooked wizard tower in a thunderstorm.'),
      focal: { x: 0.465, y: 0.237 },
    },
  },
  {
    id: 'koyuki',
    name: { ru: 'Коюки', en: 'Koyuki', jp: '小雪' },
    title: { ru: 'Снежная Лучница', en: 'The Snowfall Archer' },
    gender: 'f', rarity: 'epic', element: 'frost', role: 'ranger',
    base: { hp: 580, atk: 248, def: 30, crit: 15, aff: 40 },
    growth: { hp: 40.6, atk: 17.4, def: 2.1 },
    move: cp(MOVE.step1), basic: cp(BASIC.shot4), jump: cp(JUMP.ranged),
    skill: {
      id: 'icicle-volley',
      name: { ru: 'Ледяная очередь', en: 'Icicle Volley', jp: '氷柱連射' },
      desc: {
        ru: 'Две ледяные стрелы по двум разным диагоналям (до 5 клеток): 140% ATK Инеем первому врагу на каждой.',
        en: 'Two ice arrows down two different diagonals (up to 5 squares): 140% ATK Frost damage to the first enemy on each.',
      },
      cooldown: 3,
      target: { shape: 'lines', length: 5, pierce: false, dirs: 2, side: 'enemy' },
      effects: [{ op: 'damage', mult: 1.4 }],
    },
    passive: {
      id: 'frost-on-the-string',
      name: { ru: 'Иней на тетиве', en: 'Frost on the String' },
      desc: {
        ru: 'Её попадания по целям в 3+ клетках накладывают Замедление на 1 ход.',
        en: 'Her hits on targets 3+ squares away apply Slow for 1 turn.',
      },
      triggers: [{ on: 'hitDealt', if: { distanceAtLeast: 3 }, effects: [{ op: 'status', id: 'slow', turns: 1, who: 'eventTarget' }] }],
    },
    ultimate: {
      id: 'silent-blizzard',
      name: { ru: 'Беззвучная метель', en: 'Silent Blizzard', jp: '無音吹雪' },
      desc: {
        ru: 'Метель проносится по выбранному ряду доски: 170% ATK Инеем и Замедление на 2 хода каждому врагу в ряду.',
        en: 'A blizzard sweeps a chosen row of the board: 170% ATK Frost damage and Slow for 2 turns to every enemy in it.',
      },
      cost: 70,
      target: { shape: 'row', rows: 1, side: 'enemy' },
      effects: [{ op: 'damage', mult: 1.7 }, { op: 'status', id: 'slow', turns: 2 }],
      vfx: 'ult-koyuki',
    },
    quirks: [
      {
        id: 'whiteout',
        name: { ru: 'Белая мгла', en: 'Whiteout' },
        desc: {
          ru: 'Её не видно в снегу: одиночные и линейные атаки с 3+ клеток не могут выбрать Коюки целью.',
          en: "She vanishes into the snow: single-target and line attacks from 3+ squares away can't target Koyuki.",
        },
        rules: [{ rule: 'rangedVeil', params: { minDistance: 3 } }],
      },
    ],
    constellations: [
      { c: 1, desc: { ru: 'Её Замедление также даёт Хрупкость на 1 ход.', en: 'Her Slow also applies Brittle for 1 turn.' }, patches: [{ effect: { op: 'status', id: 'brittle', turns: 1, who: 'eventTarget' }, to: 'passive.triggers.0' }] },
      { c: 2, desc: { ru: 'Ледяная очередь — 3 стрелы.', en: 'Icicle Volley fires 3 arrows.' }, patches: [{ path: 'skill.target.dirs', set: 3 }] },
      { c: 3, desc: { ru: 'Урон Очереди +20%.', en: 'Icicle Volley damage +20%.' }, patches: [{ path: 'skill.mult', mul: 1.2 }] },
      { c: 4, desc: { ru: 'Иней на тетиве — уже с 2 клеток.', en: 'Frost on the String works from 2 squares.' }, patches: [{ path: 'passive.triggers.0.if.distanceAtLeast', set: 2 }] },
      { c: 5, desc: { ru: 'Урон Метели +20%.', en: 'Blizzard damage +20%.' }, patches: [{ path: 'ultimate.mult', mul: 1.2 }] },
      { c: 6, desc: { ru: 'Метель накрывает 2 ряда.', en: 'The Blizzard covers 2 rows.' }, patches: [{ path: 'ultimate.target.rows', set: 2 }] },
    ],
    lore: {
      ru: 'Лучница из северного леса, где охотятся молча. Говорит мало, но её стрелы попадают в снежинку на лету.',
      en: 'An archer from a northern forest where hunters stay silent. She says little, but her arrows can hit a snowflake in flight.',
    },
    personality: { ru: ['тихая', 'сосредоточенная', 'наблюдательная', 'любит снег'], en: ['quiet', 'focused', 'observant', 'loves snow'] },
    palette: ['#8EEBFF', '#FFFFFF', '#5A7FB0'],
    voice: 'cool-marksman',
    art: {
      prompt: artPrompt('f', 'epic', 'Subject: an adult woman, a quiet petite snow archer. Straight shoulder-length white hair with pale-blue tips and a snowflake hair clip, calm light-blue eyes, focused gentle expression. Outfit: a white fur-lined hooded winter coat with long sleeves, a pale-blue scarf, fingerless mittens, a long skirt over leggings, boots. Weapon: a crystal ice bow drawn with an arrow of frost. Palette: white, ice blue, slate blue. Background: a silent snowy pine forest at dusk with falling snow.'),
      focal: { x: 0.412, y: 0.215 },
    },
  },
  {
    id: 'lucille',
    name: { ru: 'Люсиль', en: 'Lucille', jp: 'リュシール' },
    title: { ru: 'Свеча Рассвета', en: 'Candle of Dawn' },
    gender: 'f', rarity: 'epic', element: 'radiance', role: 'oracle',
    base: { hp: 650, atk: 173, def: 48, crit: 5, aff: 40 },
    growth: { hp: 45.5, atk: 12.1, def: 3.4 },
    move: cp(MOVE.step1), basic: cp(BASIC.oracle2), jump: cp(JUMP.oracle),
    skill: {
      id: 'candle-blessing',
      name: { ru: 'Свечное благословение', en: 'Candle Blessing', jp: '燭の祝福' },
      desc: {
        ru: 'Союзница в пределах 3 (или сама Люсиль): лечение 160% ATK, Воодушевление (ATK +25%) на 2 хода и снятие 1 негативного эффекта.',
        en: 'An ally within 3 (or Lucille herself): heals 160% ATK, Inspire (ATK +25%) for 2 turns and removes 1 debuff.',
      },
      cooldown: 3,
      target: { shape: 'single', range: 3, los: 'free', side: 'allyOrSelf', includeSelf: true },
      effects: [
        { op: 'heal', mult: 1.6 },
        { op: 'status', id: 'inspire', turns: 2, value: 0.25 },
        { op: 'cleanse', count: 1 },
      ],
    },
    passive: {
      id: 'warm-light',
      name: { ru: 'Тёплый свет', en: 'Warm Light' },
      desc: {
        ru: 'Излишек её лечения превращается в щит (до 20% макс. HP цели, 2 хода).',
        en: "Overhealing from her heals becomes a shield (up to 20% of the target's max HP, 2 turns).",
      },
      mods: [{ stat: 'overhealToShieldPct', value: 0.2 }],
    },
    ultimate: {
      id: 'dawn-litany',
      name: { ru: 'Рассветная литания', en: 'Dawn Litany', jp: '暁の祈り' },
      desc: {
        ru: 'Если есть выбывшая союзница — Люсиль возвращает последнюю из них (40% HP, на свободную клетку своих задних рядов; каждую — раз за бой), а всех союзниц лечит на 60% ATK. Если выбывших нет — лечит всех союзниц на 140% ATK.',
        en: "If an ally has been KO'd, Lucille brings back the most recent one (40% HP, on an empty square of her own back rows; each ally once per battle) and heals every ally 60% ATK. If nobody is KO'd, she heals every ally 140% ATK.",
      },
      cost: 100,
      target: { shape: 'all', side: 'ally' },
      effects: [
        { op: 'heal', mult: 1.4, who: 'allAllies', if: { anyAllyKo: false } },
        { op: 'heal', mult: 0.6, who: 'allAllies', if: { anyAllyKo: true } },
        { op: 'revive', hpPct: 0.4, pick: 'lastKo', place: 'ownBackRows', if: { anyAllyKo: true } },
      ],
      vfx: 'ult-lucille',
    },
    quirks: [
      {
        id: 'ember-of-hope',
        name: { ru: 'Огонёк надежды', en: 'Ember of Hope' },
        desc: {
          ru: 'Выбыв, Люсиль оставляет на своей клетке Свечу (лопается от любого удара, 3 хода). В начале каждого хода стороны Свеча лечит соседних союзниц на 8% макс. HP.',
          en: 'When KO’d, Lucille leaves a Candle on her square (pops on any hit, 3 turns). At the start of each of her side’s turns the Candle heals adjacent allies 8% max HP.',
        },
        rules: [{ rule: 'candleOnKo', params: { turns: 3, healPctMaxHp: 0.08 } }],
      },
    ],
    constellations: [
      { c: 1, desc: { ru: 'Щит от излишка — до 30% HP.', en: 'Overheal shield up to 30% HP.' }, patches: [{ path: 'passive.mods.0.value', set: 0.3 }] },
      { c: 2, desc: { ru: 'Благословение достаёт на 4 клетки.', en: 'Candle Blessing reaches 4 squares.' }, patches: [{ path: 'skill.target.range', set: 4 }] },
      { c: 3, desc: { ru: 'Лечение Благословения +20%.', en: 'Candle Blessing healing +20%.' }, patches: [{ path: 'skill.mult', mul: 1.2 }] },
      { c: 4, desc: { ru: 'Воодушевление: ATK +35%.', en: 'Inspire: ATK +35%.' }, patches: [{ path: 'skill.effects.1.value', set: 0.35 }] },
      { c: 5, desc: { ru: 'Лечение Литании +20%; возвращённая союзница получает 60% HP.', en: 'Litany healing +20%; the revived ally returns at 60% HP.' }, patches: [{ path: 'ultimate.mult', mul: 1.2 }, { path: 'ultimate.effects.2.hpPct', set: 0.6 }] },
      { c: 6, desc: { ru: 'Литания стоит 80 энергии.', en: 'The Litany costs 80 energy.' }, patches: [{ path: 'ultimate.cost', set: 80 }] },
    ],
    lore: {
      ru: 'Послушница Рассветного собора, хранящая свечу, что не гаснет триста лет. Боится темноты — и всё равно идёт в неё первой ради других.',
      en: "A novice of the Dawn Cathedral who tends a candle that hasn't gone out in three hundred years. She fears the dark — and still walks into it first for others.",
    },
    personality: { ru: ['добрая', 'застенчивая', 'самоотверженная', 'верит в лучшее'], en: ['kind', 'shy', 'selfless', 'hopeful'] },
    palette: ['#FFF0A0', '#FFB070', '#FFFFFF'],
    voice: 'gentle-saint',
    art: {
      prompt: artPrompt('f', 'epic', 'Subject: an adult woman, a gentle candle cleric. Soft wavy honey-blonde hair in a low side braid, warm amber eyes, shy kind smile. Outfit: a cream-white and gold cleric habit with long sleeves and a high collar, a short cape embroidered with a sun. Weapon: a tall staff topped with a glowing lantern-candle; warm motes of light float around her. Palette: warm white, honey gold, soft peach. Background: a cathedral interior at dawn with stained-glass light beams and floating candles.'),
      focal: { x: 0.494, y: 0.203 },
    },
  },
  {
    id: 'karasu',
    name: { ru: 'Карасу', en: 'Karasu', jp: '鴉' },
    title: { ru: 'Полуночная Ворона', en: 'The Midnight Crow' },
    gender: 'f', rarity: 'epic', element: 'umbra', role: 'shadow',
    base: { hp: 530, atk: 261, def: 30, crit: 25, aff: 20 },
    growth: { hp: 37.1, atk: 18.3, def: 2.1 },
    move: cp(MOVE.glide3), basic: cp(BASIC.melee), jump: cp(JUMP.shadow),
    skill: {
      id: 'crows-passage',
      name: { ru: 'Вороний перелёт', en: "Crow's Passage", jp: '鴉渡り' },
      desc: {
        ru: 'Перелетает к врагу в пределах 4 (на свободную соседнюю с ним клетку) и бьёт на 160% ATK Сумраком с +30% к шансу крита.',
        en: 'Flies to an enemy within 4 (onto an empty square next to it) and strikes for 160% ATK Umbra damage with +30% crit chance.',
      },
      cooldown: 3,
      target: { shape: 'single', range: 4, los: 'free', side: 'enemy' },
      effects: [
        { op: 'moveSelf', to: 'adjacentToTarget' },
        { op: 'damage', mult: 1.6, critBonus: 30 },
      ],
    },
    passive: {
      id: 'feather-mark',
      name: { ru: 'Перо-метка', en: 'Feather Mark' },
      desc: {
        ru: 'Каждое её попадание оставляет Метку (цель получает +20% урона) на 2 хода.',
        en: 'Each of her hits leaves a Mark (the target takes +20% damage) for 2 turns.',
      },
      triggers: [{ on: 'hitDealt', effects: [{ op: 'status', id: 'mark', turns: 2, value: 0.2, who: 'eventTarget' }] }],
    },
    ultimate: {
      id: 'starless-midnight',
      name: { ru: 'Полночь без звёзд', en: 'Starless Midnight', jp: '星なき真夜中' },
      desc: {
        ru: 'Удар из полной темноты по врагу в пределах 3: 260% ATK Сумраком. Если у цели остаётся 30% HP или меньше — она выбывает (боссы вместо этого получают ещё 100% ATK).',
        en: 'A strike from total darkness on an enemy within 3: 260% ATK Umbra damage. If the target is left at 30% HP or less, it is KO’d (bosses take another 100% ATK instead).',
      },
      cost: 80,
      target: { shape: 'single', range: 3, los: 'free', side: 'enemy' },
      effects: [{ op: 'damage', mult: 2.6 }, { op: 'execute', hpPct: 0.3 }],
      vfx: 'ult-karasu',
    },
    quirks: [
      {
        id: 'murder-of-crows',
        name: { ru: 'Стая', en: 'Murder of Crows' },
        desc: {
          ru: '+15% урона за каждого врага на доске с Меткой (макс. +45%).',
          en: '+15% damage for every Marked enemy on the board (max +45%).',
        },
        mods: [{ stat: 'dmgPct', scale: 'markedEnemies', perUnit: 0.15, max: 0.45 }],
      },
    ],
    constellations: [
      { c: 1, desc: { ru: 'Метка: +30% урона.', en: 'Mark: +30% damage.' }, patches: [{ path: 'passive.triggers.0.effects.0.value', set: 0.3 }] },
      { c: 2, desc: { ru: 'Перезарядка Перелёта 2.', en: "Crow's Passage cooldown 2." }, patches: [{ path: 'skill.cooldown', set: 2 }] },
      { c: 3, desc: { ru: 'Урон Перелёта +20%.', en: "Crow's Passage damage +20%." }, patches: [{ path: 'skill.mult', mul: 1.2 }] },
      { c: 4, desc: { ru: 'Стая — до +60%.', en: 'Murder of Crows up to +60%.' }, patches: [{ path: 'quirks.0.mods.0.max', set: 0.6 }] },
      { c: 5, desc: { ru: 'Урон Полуночи +20%.', en: 'Midnight damage +20%.' }, patches: [{ path: 'ultimate.mult', mul: 1.2 }] },
      { c: 6, desc: { ru: 'Добивает с 40% HP; нокаут Полуночью возвращает 40 энергии.', en: 'Executes at 40% HP; a KO with Midnight refunds 40 energy.' }, patches: [{ path: 'ultimate.effects.1.hpPct', set: 0.4 }, { effect: { op: 'energy', amount: 40, who: 'self', if: { ko: true } }, to: 'ultimate' }] },
    ],
    lore: {
      ru: 'Тень из гильдии Полуночных Ворон: сто заданий — и ни одного следа. Втайне мечтает, чтобы её хоть раз похвалили.',
      en: 'A shadow of the Midnight Crow guild: a hundred missions and not a single trace. Secretly, she wishes someone would praise her, just once.',
    },
    personality: { ru: ['молчаливая', 'исполнительная', 'одинокая', 'втайне хочет похвалы'], en: ['silent', 'dutiful', 'lonely', 'secretly craves praise'] },
    palette: ['#2A1630', '#D7337E', '#9AA0B5'],
    voice: 'quiet-whisper',
    art: {
      prompt: artPrompt('f', 'epic', 'Subject: an adult woman, a silent crow assassin. Straight black hair in a blunt princess cut with a few crimson-magenta streaks, half-lidded grey eyes, calm expressionless face, a black feather earring. Outfit: a long black feathered cloak with a high collar over a fitted dark-grey long-sleeved bodysuit, a crimson sash, gloves and boots. Weapon: two black kunai-like blades; crow feathers swirl around her. Palette: black, crimson-magenta, cool grey. Background: moonlit rooftops of a fantasy city at midnight with a flock of crows.'),
      focal: { x: 0.527, y: 0.165 },
    },
  },
  {
    id: 'zlata',
    name: { ru: 'Злата', en: 'Zlata', jp: 'ズラータ' },
    title: { ru: 'Янтарный Бастион', en: 'The Amber Bastion' },
    gender: 'f', rarity: 'epic', element: 'terra', role: 'guardian',
    base: { hp: 930, atk: 119, def: 81, crit: 5, aff: 20 },
    growth: { hp: 65.1, atk: 8.3, def: 5.7 },
    move: cp(MOVE.step1), basic: cp(BASIC.melee), jump: cp(JUMP.guardian),
    skill: {
      id: 'earth-rumble',
      name: { ru: 'Гул земли', en: 'Earth Rumble', jp: '地鳴り' },
      desc: {
        ru: 'Бьёт щитом о землю: враги в радиусе 2 получают Провокацию на 1 ход, Злата — щит в 20% макс. HP.',
        en: 'Slams her shield into the ground: enemies within radius 2 are Taunted for 1 turn and Zlata gains a shield of 20% max HP.',
      },
      cooldown: 3,
      target: { shape: 'radius', r: 2, center: 'caster', side: 'enemy' },
      effects: [{ op: 'status', id: 'taunt', turns: 1 }, { op: 'shield', pctMaxHp: 0.2, turns: 2, who: 'self' }],
    },
    passive: {
      id: 'amber-skin',
      name: { ru: 'Янтарная кожа', en: 'Amber Skin' },
      desc: {
        ru: 'Раз за ход врага, получив удар, Злата покрывается янтарём: щит в 6% макс. HP на 2 хода.',
        en: 'Once per enemy turn, when hit, Zlata coats herself in amber: a shield of 6% max HP for 2 turns.',
      },
      triggers: [{ on: 'hitTaken', oncePerTurn: true, effects: [{ op: 'shield', pctMaxHp: 0.06, turns: 2, who: 'self' }] }],
    },
    ultimate: {
      id: 'amber-fortress',
      name: { ru: 'Янтарная крепость', en: 'Amber Fortress', jp: '琥珀の砦' },
      desc: {
        ru: 'Союзницы в радиусе 2 получают щит в 25% макс. HP Златы на 2 хода; соседние враги — 200% DEF урона Твердью и Обездвиживание на 1 ход.',
        en: 'Allies within radius 2 gain a shield of 25% of Zlata’s max HP for 2 turns; adjacent enemies take 200% DEF Terra damage and are Rooted for 1 turn.',
      },
      cost: 80,
      target: { shape: 'radius', r: 2, center: 'caster', side: 'any' },
      effects: [
        { op: 'shield', pctCasterMaxHp: 0.25, turns: 2, who: 'alliesInShape' },
        { op: 'damage', mult: 2.0, stat: 'def', who: 'adjacentEnemies' },
        { op: 'status', id: 'root', turns: 1, who: 'adjacentEnemies' },
      ],
      vfx: 'ult-zlata',
    },
    quirks: [
      {
        id: 'friend-toss',
        name: { ru: 'Бросок подруги', en: 'Friend Toss' },
        desc: {
          ru: 'Вместо действия Злата может зашвырнуть соседнюю союзницу по той же диагонали через любые фигуры — на самую дальнюю свободную клетку в пределах 3. Подруга получает +10 энергии. Перезарядка 2.',
          en: 'Instead of her action, Zlata can hurl an adjacent ally along the same diagonal over any pieces onto the farthest empty square within 3. The ally gains +10 energy. Cooldown 2.',
        },
        rules: [{ rule: 'tossAlly', params: { range: 3, energy: 10, cooldown: 2 } }],
      },
      {
        id: 'heavy-landing',
        name: { ru: 'Тяжёлое приземление', en: 'Heavy Landing' },
        desc: {
          ru: 'Приземляясь после прыжка-удара, сотрясает землю: враги вокруг клетки приземления получают 100% DEF урона Твердью.',
          en: 'When she lands a jump-strike, the ground shakes: enemies around the landing square take 100% DEF Terra damage.',
        },
        triggers: [{ on: 'jumpHop', effects: [{ op: 'damage', mult: 1.0, stat: 'def', who: 'adjacentEnemies' }] }],
      },
    ],
    constellations: [
      { c: 1, desc: { ru: 'Янтарная кожа — 9% HP.', en: 'Amber Skin: 9% HP.' }, patches: [{ path: 'passive.triggers.0.effects.0.pctMaxHp', set: 0.09 }] },
      { c: 2, desc: { ru: 'Бросок — до 4 клеток, подруга получает +20 энергии.', en: 'Toss up to 4 squares; the ally gains +20 energy.' }, patches: [{ path: 'quirks.0.rules.0.params.range', set: 4 }, { path: 'quirks.0.rules.0.params.energy', set: 20 }] },
      { c: 3, desc: { ru: 'Щит Гула земли — 30% HP.', en: 'Earth Rumble shield: 30% HP.' }, patches: [{ path: 'skill.effects.1.pctMaxHp', set: 0.3 }] },
      { c: 4, desc: { ru: 'Спровоцированные враги также Ослаблены на 1 ход.', en: 'Taunted enemies are also Weakened for 1 turn.' }, patches: [{ effect: { op: 'status', id: 'weaken', turns: 1 }, to: 'skill' }] },
      { c: 5, desc: { ru: 'Щит Крепости — 30% её HP.', en: "Fortress shield: 30% of her HP." }, patches: [{ path: 'ultimate.effects.0.pctCasterMaxHp', set: 0.3 }] },
      { c: 6, desc: { ru: 'Крепость стоит 70 энергии; Обездвиживание — 2 хода.', en: 'The Fortress costs 70 energy; Root lasts 2 turns.' }, patches: [{ path: 'ultimate.cost', set: 70 }, { path: 'ultimate.effects.2.turns', set: 2 }] },
    ],
    lore: {
      ru: 'Дочь каменотёсов из Янтарного каньона, поднимающая щит размером с ворота. Зовёт весь отряд «малышами» — даже тех, кто старше.',
      en: "A stonemason's daughter from the Amber Canyon who lifts a shield the size of a gate. She calls the whole squad 'kiddos' — even those older than her.",
    },
    personality: { ru: ['весёлая', 'надёжная', 'сильная', 'опекает всех'], en: ['cheerful', 'dependable', 'strong', 'looks after everyone'] },
    palette: ['#E3A13B', '#7A4A1E', '#FFE7B0'],
    voice: 'elder-sister',
    art: {
      prompt: artPrompt('f', 'epic', 'Subject: an adult woman, a cheerful sturdy amber guardian. Long honey-brown hair in two thick braids, warm amber eyes, big confident smile, athletic build. Outfit: bronze and amber plate armour over a long-sleeved brown tunic, a layered armoured skirt, an embroidered folk-pattern sash, heavy boots. Weapon: a huge round shield studded with glowing amber crystals and a stone war hammer resting on her shoulder. Palette: amber, bronze-brown, cream. Background: a canyon of amber-crystal rock formations in golden afternoon light.'),
      focal: { x: 0.477, y: 0.146 },
    },
  },
  {
    id: 'kaede',
    name: { ru: 'Каэдэ', en: 'Kaede', jp: '楓' },
    title: { ru: 'Кленовый Вихрь', en: 'The Maple Whirlwind' },
    gender: 'f', rarity: 'epic', element: 'gale', role: 'blade',
    base: { hp: 620, atk: 238, def: 43, crit: 15, aff: 80 },
    growth: { hp: 43.4, atk: 16.7, def: 3 },
    move: cp(MOVE.step2), basic: cp(BASIC.melee), jump: cp(JUMP.blade),
    skill: {
      id: 'maple-whirl',
      name: { ru: 'Кленовый смерч', en: 'Maple Whirl', jp: '紅葉旋' },
      desc: {
        ru: 'Закручивает смерч: враги на её диагоналях в пределах 2 притягиваются на 1 клетку, затем все соседние враги получают 120% ATK Вихрем (с Воронкой по запечатанным).',
        en: 'Spins up a whirlwind: enemies on her diagonals within 2 are pulled 1 square closer, then every adjacent enemy takes 120% ATK Gale damage (Vortex on sealed ones).',
      },
      cooldown: 3,
      target: { shape: 'diagonals', length: 2, center: 'caster', side: 'enemy' },
      effects: [
        { op: 'pull', dist: 1, toward: 'caster' },
        { op: 'damage', mult: 1.2, area: { shape: 'radius', r: 1, center: 'caster', includeCenter: false, side: 'enemy' } },
      ],
    },
    passive: {
      id: 'leaf-dance',
      name: { ru: 'Танец листьев', en: 'Leaf Dance' },
      desc: {
        ru: 'Каждый прыжок её цепочки дарит +5 энергии союзнице, у которой энергии меньше всех.',
        en: 'Every hop of her chain gives +5 energy to the ally with the least energy.',
      },
      triggers: [{ on: 'jumpHop', effects: [{ op: 'energy', amount: 5, who: 'lowestEnergyAlly', count: 1 }] }],
    },
    ultimate: {
      id: 'autumn-hurricane',
      name: { ru: 'Осенний ураган', en: 'Autumn Hurricane', jp: '秋嵐' },
      desc: {
        ru: 'Ураган листьев по всем четырём диагоналям на 3 клетки: 160% ATK Вихрем каждому врагу и отбрасывание на 1 клетку.',
        en: 'A hurricane of leaves along all four diagonals for 3 squares: 160% ATK Gale damage to each enemy and a 1-square push.',
      },
      cost: 80,
      target: { shape: 'diagonals', length: 3, center: 'caster', side: 'enemy' },
      effects: [{ op: 'damage', mult: 1.6 }, { op: 'push', dist: 1, from: 'caster' }],
      vfx: 'ult-kaede',
    },
    quirks: [
      {
        id: 'leapfrog',
        name: { ru: 'Чехарда', en: 'Leapfrog' },
        desc: {
          ru: 'Шагая, может перепрыгнуть соседнюю союзницу на свободную клетку за ней (это один шаг); союзница получает +5 энергии.',
          en: 'When stepping, she can vault over an adjacent ally onto the empty square behind (counts as one step); the ally gains +5 energy.',
        },
        rules: [{ rule: 'leapfrog', params: { energy: 5 } }],
      },
    ],
    constellations: [
      { c: 1, desc: { ru: 'Чехарда даёт +10 энергии.', en: 'Leapfrog grants +10 energy.' }, patches: [{ path: 'quirks.0.rules.0.params.energy', set: 10 }] },
      { c: 2, desc: { ru: 'Смерч тянет с 3 клеток и на 2 клетки.', en: 'The Whirl pulls from 3 squares, by 2 squares.' }, patches: [{ path: 'skill.target.length', set: 3 }, { path: 'skill.effects.0.dist', set: 2 }] },
      { c: 3, desc: { ru: 'Урон Смерча +20%.', en: 'Maple Whirl damage +20%.' }, patches: [{ path: 'skill.mult', mul: 1.2 }] },
      { c: 4, desc: { ru: 'Танец листьев: +10 энергии.', en: 'Leaf Dance: +10 energy.' }, patches: [{ path: 'passive.triggers.0.effects.0.amount', set: 10 }] },
      { c: 5, desc: { ru: 'Урон Урагана +20%.', en: 'Hurricane damage +20%.' }, patches: [{ path: 'ultimate.mult', mul: 1.2 }] },
      { c: 6, desc: { ru: 'Ураган — по диагоналям целиком; её Воронки сильнее на 50%.', en: 'The Hurricane covers full diagonals; her Vortex reactions are 50% stronger.' }, patches: [{ path: 'ultimate.target.length', set: 7 }, { mod: { stat: 'reactionPct', value: 0.5, if: { reaction: 'vortex' } } }] },
    ],
    lore: {
      ru: 'Танцовщица осеннего храма, чей танец поднимает настоящие смерчи из листьев. Уверена, что любую битву можно превратить в праздник.',
      en: 'A dancer of the autumn shrine whose dance stirs up real whirlwinds of leaves. She believes any battle can be turned into a festival.',
    },
    personality: { ru: ['жизнерадостная', 'лёгкая', 'артистичная', 'любит осень'], en: ['cheerful', 'light-footed', 'artistic', 'loves autumn'] },
    palette: ['#E2552B', '#3BE3A0', '#FFD08A'],
    voice: 'sunny-dancer',
    art: {
      prompt: artPrompt('f', 'epic', 'Subject: an adult woman, a graceful maple wind dancer. Long auburn-red hair with green inner highlights flowing in the wind, a maple-leaf hair ornament, bright green eyes, joyful smile. Outfit: an autumn-coloured dancer’s outfit with long flowing sleeves, a high collar, a layered skirt over leggings, a jade sash. Weapon: two folding war fans with bladed edges; red maple leaves whirl around her as she spins. Palette: maple red-orange, jade green, warm gold. Background: an autumn mountain shrine path with whirling red maple leaves.'),
      focal: { x: 0.447, y: 0.19 },
    },
  },

  // =================================================================================== RARE
  {
    id: 'torvald',
    name: { ru: 'Торвальд', en: 'Torvald', jp: 'トルヴァルド' },
    title: { ru: 'Кузнец-Страж', en: 'The Forge Warden' },
    gender: 'm', rarity: 'rare', element: 'flame', role: 'guardian',
    base: { hp: 903, atk: 116, def: 79, crit: 5, aff: 20 },
    growth: { hp: 61.4, atk: 7.9, def: 5.4 },
    move: cp(MOVE.step1), basic: cp(BASIC.melee), jump: cp(JUMP.guardian),
    skill: {
      id: 'the-forge',
      name: { ru: 'Горн', en: 'The Forge', jp: '炉' },
      desc: {
        ru: 'Раздувает горн: соседние враги получают Провокацию на 1 ход, Торвальд — щит в 15% макс. HP.',
        en: 'Fans the forge: adjacent enemies are Taunted for 1 turn and Torvald gains a shield of 15% max HP.',
      },
      cooldown: 3,
      target: { shape: 'radius', r: 1, center: 'caster', includeCenter: false, side: 'enemy' },
      effects: [{ op: 'status', id: 'taunt', turns: 1 }, { op: 'shield', pctMaxHp: 0.15, turns: 2, who: 'self' }],
    },
    passive: {
      id: 'red-hot-shield',
      name: { ru: 'Раскалённый щит', en: 'Red-Hot Shield' },
      desc: {
        ru: 'Враг, ударивший его вплотную, получает Горение на 1 ход.',
        en: 'An enemy that hits him up close gets Burn for 1 turn.',
      },
      triggers: [{ on: 'meleeHitTaken', effects: [{ op: 'status', id: 'burn', turns: 1, who: 'eventSource' }] }],
    },
    ultimate: {
      id: 'anvil-drop',
      name: { ru: 'Наковальня', en: 'Anvil Drop', jp: '鉄床落とし' },
      desc: {
        ru: 'Молот обрушивается как наковальня: соседние враги получают 200% DEF урона Пламенем и Оглушение на 1 ход.',
        en: 'The hammer drops like an anvil: adjacent enemies take 200% DEF Flame damage and are Stunned for 1 turn.',
      },
      cost: 60,
      target: { shape: 'radius', r: 1, center: 'caster', includeCenter: false, side: 'enemy' },
      effects: [{ op: 'damage', mult: 2.0, stat: 'def' }, { op: 'status', id: 'stun', turns: 1 }],
      vfx: 'ult-torvald',
    },
    quirks: [
      {
        id: 'handyman',
        name: { ru: 'Мастер на все руки', en: 'Handyman' },
        desc: {
          ru: 'Раз за бой вместо действия чинит снаряжение соседней союзницы: её навык сразу перезаряжается.',
          en: "Once per battle, instead of acting, he fixes an adjacent ally's gear: her skill is recharged at once.",
        },
        action: {
          target: { shape: 'single', range: 1, los: 'adjacent', side: 'ally' },
          effects: [{ op: 'cooldown', delta: -99 }],
          usesPerBattle: 1,
        },
      },
    ],
    constellations: [
      { c: 1, desc: { ru: 'HP +10%.', en: 'HP +10%.' }, patches: [{ mod: { stat: 'hpPct', value: 0.1 } }] },
      { c: 2, desc: { ru: 'Горение от щита — 2 хода.', en: 'Shield Burn lasts 2 turns.' }, patches: [{ path: 'passive.triggers.0.effects.0.turns', set: 2 }] },
      { c: 3, desc: { ru: 'Щит Горна — 22% HP.', en: 'Forge shield: 22% HP.' }, patches: [{ path: 'skill.effects.1.pctMaxHp', set: 0.22 }] },
      { c: 4, desc: { ru: 'DEF +15%.', en: 'DEF +15%.' }, patches: [{ mod: { stat: 'defPct', value: 0.15 } }] },
      { c: 5, desc: { ru: 'Урон Наковальни +20%.', en: 'Anvil damage +20%.' }, patches: [{ path: 'ultimate.mult', mul: 1.2 }] },
      { c: 6, desc: { ru: '«Мастер» — 2 раза за бой, союзница также получает +20 энергии.', en: 'Handyman twice per battle; the ally also gains +20 energy.' }, patches: [{ path: 'quirks.0.action.usesPerBattle', set: 2 }, { path: 'quirks.0.action.effects.1', set: { op: 'energy', amount: 20 } }] },
    ],
    lore: {
      ru: 'Кузнец, выковавший доспехи половине отряда и не дождавшийся ни одного «спасибо». Ворчит — но заслоняет собой каждую.',
      en: "A smith who forged armour for half the squad and never got a single 'thank you'. He grumbles — but shields every one of them.",
    },
    personality: { ru: ['ворчливый', 'добродушный', 'трудяга', 'мастер'], en: ['grumpy', 'good-natured', 'hard-working', 'craftsman'] },
    palette: ['#FF5B3A', '#4A3B33', '#C9A04C'],
    voice: null,
    art: {
      prompt: artPrompt('m', 'rare', 'Subject: an adult man, a burly blacksmith knight. Short dark-brown hair and a neat short beard, a smudge of soot on his cheek, warm brown eyes, gruff but kind expression. Outfit: a heavy leather blacksmith apron over dark plate armour with glowing red-hot seams, long sleeves, thick gloves, boots. Weapon: a massive forge hammer and a riveted iron shield glowing orange at the rim. Palette: fire orange, iron grey, brass. Background: a forge workshop full of sparks and molten metal.'),
      focal: { x: 0.505, y: 0.135 },
    },
  },
  {
    id: 'shio',
    name: { ru: 'Сио', en: 'Shio', jp: '汐' },
    title: { ru: 'Корсарша Солёного Ветра', en: 'Corsair of the Salt Wind' },
    gender: 'f', rarity: 'rare', element: 'tide', role: 'blade',
    base: { hp: 630, atk: 231, def: 42, crit: 20, aff: 20 },
    growth: { hp: 42.8, atk: 15.8, def: 2.8 },
    move: cp(MOVE.step2), basic: cp(BASIC.melee), jump: cp(JUMP.blade),
    skill: {
      id: 'boarding-wave',
      name: { ru: 'Волна абордажа', en: 'Boarding Wave', jp: '乗り込み波' },
      desc: {
        ru: 'Рывок по диагонали к первому врагу в пределах 3 и удар на 160% ATK Приливом.',
        en: 'Dashes along a diagonal to the first enemy within 3 and strikes for 160% ATK Tide damage.',
      },
      cooldown: 3,
      target: { shape: 'line', length: 3, pierce: false, side: 'enemy' },
      effects: [{ op: 'moveSelf', to: 'adjacentToTarget' }, { op: 'damage', mult: 1.6 }],
    },
    passive: {
      id: 'boarding-party',
      name: { ru: 'Абордаж', en: 'Boarding Party' },
      desc: {
        ru: 'После цепочки прыжков-ударов получает щит в 10% макс. HP на 2 хода.',
        en: 'After a jump-strike chain she gains a shield of 10% max HP for 2 turns.',
      },
      triggers: [{ on: 'afterAction', if: { source: 'jump' }, effects: [{ op: 'shield', pctMaxHp: 0.1, turns: 2, who: 'self' }] }],
    },
    ultimate: {
      id: 'ninth-wave',
      name: { ru: 'Девятый вал', en: 'The Ninth Wave', jp: '九の大波' },
      desc: {
        ru: 'Огромная волна по диагонали на 4 клетки: 180% ATK Приливом всем врагам и отбрасывание на 1 клетку.',
        en: 'A giant wave down a diagonal for 4 squares: 180% ATK Tide damage to every enemy and a 1-square push.',
      },
      cost: 60,
      target: { shape: 'line', length: 4, pierce: true, side: 'enemy' },
      effects: [{ op: 'damage', mult: 1.8 }, { op: 'push', dist: 1, from: 'caster' }],
      vfx: 'ult-shio',
    },
    quirks: [
      {
        id: 'corsairs-luck',
        name: { ru: 'Удача корсара', en: "Corsair's Luck" },
        desc: {
          ru: 'Каждый её крит приносит +10 энергии.',
          en: 'Each of her crits grants +10 energy.',
        },
        triggers: [{ on: 'hitDealt', if: { crit: true }, effects: [{ op: 'energy', amount: 10, who: 'self' }] }],
      },
    ],
    constellations: [
      { c: 1, desc: { ru: 'ATK +8%.', en: 'ATK +8%.' }, patches: [{ mod: { stat: 'atkPct', value: 0.08 } }] },
      { c: 2, desc: { ru: 'Щит Абордажа — 15% HP.', en: 'Boarding shield: 15% HP.' }, patches: [{ path: 'passive.triggers.0.effects.0.pctMaxHp', set: 0.15 }] },
      { c: 3, desc: { ru: 'Урон Волны абордажа +20%.', en: 'Boarding Wave damage +20%.' }, patches: [{ path: 'skill.mult', mul: 1.2 }] },
      { c: 4, desc: { ru: 'Шанс крита +10%.', en: 'Crit chance +10%.' }, patches: [{ mod: { stat: 'critChance', value: 10 } }] },
      { c: 5, desc: { ru: 'Урон Девятого вала +20%.', en: 'Ninth Wave damage +20%.' }, patches: [{ path: 'ultimate.mult', mul: 1.2 }] },
      { c: 6, desc: { ru: 'Волна абордажа: перезарядка 2, дальность 4.', en: 'Boarding Wave: cooldown 2, range 4.' }, patches: [{ path: 'skill.cooldown', set: 2 }, { path: 'skill.target.length', set: 4 }] },
    ],
    lore: {
      ru: 'Корсарша, которая грабит только пиратов и угощает команду лимонадом. Уверена, что удача любит смелых — особенно её.',
      en: "A corsair who only robs pirates and treats her crew to lemonade. She's sure luck favours the bold — especially her.",
    },
    personality: { ru: ['лихая', 'весёлая', 'азартная', 'морская душа'], en: ['dashing', 'cheerful', 'reckless', 'a sea soul'] },
    palette: ['#2E8BFF', '#F2E2C4', '#C0392B'],
    voice: null,
    art: {
      prompt: artPrompt('f', 'rare', 'Subject: an adult woman, a cheerful sea corsair swordswoman. Wavy sea-blue hair in a short ponytail under a tricorn hat, tanned skin, bright blue eyes, confident grin. Outfit: a white long-sleeved shirt with a buttoned navy waistcoat, a red sash, a long navy coat, trousers and boots. Weapon: a curved cutlass dripping with seawater. Palette: navy blue, sand beige, red. Background: the deck of a ship on sunny waves with sea spray.'),
      focal: { x: 0.534, y: 0.186 },
    },
  },
  {
    id: 'maren',
    name: { ru: 'Марен', en: 'Maren', jp: 'マーレン' },
    title: { ru: 'Гарпунщица Глубин', en: 'Harpooner of the Deep' },
    gender: 'f', rarity: 'rare', element: 'tide', role: 'ranger',
    base: { hp: 598, atk: 230, def: 30, crit: 10, aff: 20 },
    growth: { hp: 40.7, atk: 15.6, def: 2.1 },
    move: cp(MOVE.step1), basic: cp(BASIC.shot4), jump: cp(JUMP.ranged),
    skill: {
      id: 'harpoon-reel',
      name: { ru: 'Рывок гарпуна', en: 'Harpoon Reel', jp: '銛引き' },
      desc: {
        ru: 'Гарпун во врага на диагонали в пределах 4: 130% ATK Приливом, затем цель подтягивается вплотную к Марен.',
        en: 'A harpoon into an enemy on a diagonal within 4: 130% ATK Tide damage, then the target is reeled in next to Maren.',
      },
      cooldown: 3,
      target: { shape: 'single', range: 4, los: 'diag', side: 'enemy' },
      effects: [{ op: 'damage', mult: 1.3 }, { op: 'pull', dist: 3, toward: 'caster' }],
    },
    passive: {
      id: 'harpoon',
      name: { ru: 'Гарпун', en: 'Harpoon' },
      desc: {
        ru: 'Обычная атака подтягивает цель на 1 клетку к Марен.',
        en: 'Her basic attack pulls the target 1 square toward Maren.',
      },
      triggers: [{ on: 'hitDealt', if: { source: 'basic' }, effects: [{ op: 'pull', dist: 1, toward: 'caster', who: 'eventTarget' }] }],
    },
    ultimate: {
      id: 'harpoon-storm',
      name: { ru: 'Шторм гарпунов', en: 'Harpoon Storm', jp: '銛の嵐' },
      desc: {
        ru: 'Гарпуны по трём выбранным диагоналям (до 4 клеток): 140% ATK Приливом первому врагу на каждой.',
        en: 'Harpoons down three chosen diagonals (up to 4 squares): 140% ATK Tide damage to the first enemy on each.',
      },
      cost: 60,
      target: { shape: 'lines', length: 4, pierce: false, dirs: 3, side: 'enemy' },
      effects: [{ op: 'damage', mult: 1.4 }],
      vfx: 'ult-maren',
    },
    quirks: [
      {
        id: 'fishers-patience',
        name: { ru: 'Терпение рыбачки', en: "Fisher's Patience" },
        desc: {
          ru: '+25% урона по Замедленным и Обездвиженным целям.',
          en: '+25% damage to Slowed and Rooted targets.',
        },
        mods: [{ stat: 'dmgPct', value: 0.25, if: { targetHasStatus: ['slow', 'root'] } }],
      },
    ],
    constellations: [
      { c: 1, desc: { ru: 'HP +10%.', en: 'HP +10%.' }, patches: [{ mod: { stat: 'hpPct', value: 0.1 } }] },
      { c: 2, desc: { ru: 'Перезарядка Рывка 2.', en: 'Harpoon Reel cooldown 2.' }, patches: [{ path: 'skill.cooldown', set: 2 }] },
      { c: 3, desc: { ru: 'Урон Рывка +20%.', en: 'Harpoon Reel damage +20%.' }, patches: [{ path: 'skill.mult', mul: 1.2 }] },
      { c: 4, desc: { ru: 'ATK +10%.', en: 'ATK +10%.' }, patches: [{ mod: { stat: 'atkPct', value: 0.1 } }] },
      { c: 5, desc: { ru: 'Урон Шторма +20%.', en: 'Harpoon Storm damage +20%.' }, patches: [{ path: 'ultimate.mult', mul: 1.2 }] },
      { c: 6, desc: { ru: 'Шторм — по всем 4 диагоналям и Замедляет на 1 ход.', en: 'Harpoon Storm fires down all 4 diagonals and Slows for 1 turn.' }, patches: [{ path: 'ultimate.target.dirs', set: 4 }, { effect: { op: 'status', id: 'slow', turns: 1 }, to: 'ultimate' }] },
    ],
    lore: {
      ru: 'Гарпунщица северных гаваней, вытаскивавшая из глубин чудовищ размером с корабль. Притянуть врага через полдоски — пустяк.',
      en: 'A harpooner of the northern harbours who has hauled ship-sized monsters from the deep. Pulling an enemy across half the board is nothing.',
    },
    personality: { ru: ['терпеливая', 'суровая', 'практичная', 'северянка'], en: ['patient', 'stern', 'practical', 'a northerner'] },
    palette: ['#1F6FB2', '#C9D6DF', '#7A5230'],
    voice: null,
    art: {
      prompt: artPrompt('f', 'rare', 'Subject: an adult woman, a stern northern harpoon hunter. Long dark-blue hair in a single thick braid, grey-blue eyes, serious calm expression. Outfit: a hooded oilskin coat over a thick knitted sweater, a fur collar, leather bracers, long trousers and boots. Weapon: a long harpoon with a coiled rope. Palette: deep blue, steel grey, leather brown. Background: an icy northern harbour with grey waves.'),
      focal: { x: 0.439, y: 0.154 },
    },
  },
  {
    id: 'mashiro',
    name: { ru: 'Масиро', en: 'Mashiro', jp: '真白' },
    title: { ru: 'Снежная Сестра Милосердия', en: 'Snow Sister of Mercy' },
    gender: 'f', rarity: 'rare', element: 'frost', role: 'oracle',
    base: { hp: 630, atk: 168, def: 44, crit: 5, aff: 40 },
    growth: { hp: 42.8, atk: 11.4, def: 3 },
    move: cp(MOVE.step1), basic: cp(BASIC.oracle2), jump: cp(JUMP.oracle),
    skill: {
      id: 'snow-bandage',
      name: { ru: 'Снежная повязка', en: 'Snow Bandage', jp: '雪の包帯' },
      desc: {
        ru: 'Лечит союзницу в пределах 2 (или себя) на 140% ATK.',
        en: 'Heals an ally within 2 (or herself) for 140% ATK.',
      },
      cooldown: 2,
      target: { shape: 'single', range: 2, los: 'free', side: 'allyOrSelf', includeSelf: true },
      effects: [{ op: 'heal', mult: 1.4 }],
    },
    passive: {
      id: 'cool-compress',
      name: { ru: 'Прохладный компресс', en: 'Cool Compress' },
      desc: {
        ru: 'Любое её лечение также снимает Горение и Порчу.',
        en: 'Any heal from her also removes Burn and Blight.',
      },
      triggers: [{ on: 'healGiven', effects: [{ op: 'cleanse', count: 'all', ids: ['burn', 'blight'], who: 'eventTarget' }] }],
    },
    ultimate: {
      id: 'quiet-snowfall',
      name: { ru: 'Тихий снегопад', en: 'Quiet Snowfall', jp: '静かな雪' },
      desc: {
        ru: 'Все союзницы лечатся на 100% ATK; враги в радиусе 2 от Масиро получают Печать Инея.',
        en: 'Every ally heals 100% ATK; enemies within radius 2 of Mashiro receive a Frost seal.',
      },
      cost: 70,
      target: { shape: 'all', side: 'any' },
      effects: [
        { op: 'heal', mult: 1.0, who: 'allAllies' },
        { op: 'seal', element: 'frost', area: { shape: 'radius', r: 2, center: 'caster', side: 'enemy' } },
      ],
      vfx: 'ult-mashiro',
    },
    quirks: [
      {
        id: 'ice-cocoon',
        name: { ru: 'Ледяной кокон', en: 'Ice Cocoon' },
        desc: {
          ru: 'Раз за бой: когда союзница в пределах 2 падает ниже 20% HP, её окутывает лёд — Сокрытие и Оглушение на 1 ход (неуязвима, но не действует).',
          en: 'Once per battle: when an ally within 2 drops below 20% HP, ice wraps her — Veiled and Stunned for 1 turn (safe, but she cannot act).',
        },
        rules: [{ rule: 'cocoon', params: { hpBelow: 0.2, range: 2, uses: 1 } }],
      },
    ],
    constellations: [
      { c: 1, desc: { ru: 'HP +10%.', en: 'HP +10%.' }, patches: [{ mod: { stat: 'hpPct', value: 0.1 } }] },
      { c: 2, desc: { ru: 'Повязка достаёт на 3 клетки.', en: 'Snow Bandage reaches 3 squares.' }, patches: [{ path: 'skill.target.range', set: 3 }] },
      { c: 3, desc: { ru: 'Лечение Повязки +20%.', en: 'Snow Bandage healing +20%.' }, patches: [{ path: 'skill.mult', mul: 1.2 }] },
      { c: 4, desc: { ru: 'Ледяной кокон — 2 раза за бой.', en: 'Ice Cocoon twice per battle.' }, patches: [{ path: 'quirks.0.rules.0.params.uses', set: 2 }] },
      { c: 5, desc: { ru: 'Лечение Снегопада +20%.', en: 'Snowfall healing +20%.' }, patches: [{ path: 'ultimate.mult', mul: 1.2 }] },
      { c: 6, desc: { ru: 'Снегопад снимает с каждой союзницы 1 негативный эффект.', en: 'Snowfall removes 1 debuff from every ally.' }, patches: [{ effect: { op: 'cleanse', count: 1, who: 'allAllies' }, to: 'ultimate' }] },
    ],
    lore: {
      ru: 'Сестра милосердия из снежной деревни: строга с ранеными и нежна со всеми остальными. Всегда немного сонная — кроме минут, когда кто-то ранен.',
      en: 'A sister of mercy from a snowy village: strict with the wounded and gentle with everyone else. Always a little sleepy — except when someone gets hurt.',
    },
    personality: { ru: ['нежная', 'строгая к раненым', 'заботливая', 'сонная'], en: ['gentle', 'strict with patients', 'caring', 'sleepy'] },
    palette: ['#E8F7FF', '#8EEBFF', '#FF9AA2'],
    voice: null,
    art: {
      prompt: artPrompt('f', 'rare', 'Subject: an adult woman, a gentle snow healer. Fluffy white hair in a low bun with a snowflake brooch, sleepy pale-blue eyes, soft smile. Outfit: a long white and pale-blue winter healer’s dress with long sleeves, an apron with pockets, a knitted shawl. Weapon: a small staff topped with an ice crystal and a roll of glowing frost bandages. Palette: white, pale cyan, soft pink. Background: a cosy snowy village courtyard at dusk with warm windows.'),
      focal: { x: 0.499, y: 0.165 },
    },
  },
  {
    id: 'iskra',
    name: { ru: 'Искра', en: 'Iskra', jp: 'イスクラ' },
    title: { ru: 'Курьер-Молния', en: 'The Lightning Courier' },
    gender: 'f', rarity: 'rare', element: 'storm', role: 'shadow',
    base: { hp: 514, atk: 242, def: 29, crit: 25, aff: 40 },
    growth: { hp: 35, atk: 16.4, def: 2 },
    move: cp(MOVE.glide3), basic: cp(BASIC.melee), jump: cp(JUMP.shadow),
    skill: {
      id: 'back-zap',
      name: { ru: 'Разряд в спину', en: 'Back Zap', jp: '背雷' },
      desc: {
        ru: 'Бьёт соседнего врага на 150% ATK Грозой и тут же отскакивает на 1 клетку.',
        en: 'Zaps an adjacent enemy for 150% ATK Storm damage, then hops 1 square away.',
      },
      cooldown: 2,
      target: { shape: 'single', range: 1, los: 'adjacent', side: 'enemy' },
      effects: [{ op: 'damage', mult: 1.5 }, { op: 'freeMove', steps: 1 }],
    },
    passive: {
      id: 'express-delivery',
      name: { ru: 'Срочная доставка', en: 'Express Delivery' },
      desc: {
        ru: 'Скользит по диагонали на 4 клетки вместо 3.',
        en: 'Glides 4 squares instead of 3.',
      },
      mods: [{ stat: 'glideLength', value: 1 }],
    },
    ultimate: {
      id: 'chain-post',
      name: { ru: 'Цепная почта', en: 'Chain Post', jp: '連鎖便' },
      desc: {
        ru: 'Молния-«посылка» во врага в пределах 3 (80% ATK Грозой) и ещё 3 доставки по ближайшим врагам в пределах 2 от предыдущего (по 80% ATK).',
        en: 'A lightning "parcel" to an enemy within 3 (80% ATK Storm damage) plus 3 more deliveries to the nearest enemies within 2 of the previous one (80% ATK each).',
      },
      cost: 60,
      target: { shape: 'single', range: 3, los: 'free', side: 'enemy' },
      effects: [{ op: 'damage', mult: 0.8 }, { op: 'bounce', count: 3, range: 2, mult: 0.8 }],
      vfx: 'ult-iskra',
    },
    quirks: [
      {
        id: 'momentum',
        name: { ru: 'Разгон', en: 'Momentum' },
        desc: {
          ru: 'Если в эту активацию Искра пролетела 3+ клетки, её действие наносит +30% урона.',
          en: 'If Iskra travelled 3+ squares this activation, her action deals +30% damage.',
        },
        mods: [{ stat: 'dmgPct', value: 0.3, if: { movedAtLeast: 3 } }],
      },
    ],
    constellations: [
      { c: 1, desc: { ru: 'ATK +8%.', en: 'ATK +8%.' }, patches: [{ mod: { stat: 'atkPct', value: 0.08 } }] },
      { c: 2, desc: { ru: 'Шанс крита +10%.', en: 'Crit chance +10%.' }, patches: [{ mod: { stat: 'critChance', value: 10 } }] },
      { c: 3, desc: { ru: 'Урон Разряда в спину +20%.', en: 'Back Zap damage +20%.' }, patches: [{ path: 'skill.mult', mul: 1.2 }] },
      { c: 4, desc: { ru: 'Разгон: +45%.', en: 'Momentum: +45%.' }, patches: [{ path: 'quirks.0.mods.0.value', set: 0.45 }] },
      { c: 5, desc: { ru: 'Урон Цепной почты +20%.', en: 'Chain Post damage +20%.' }, patches: [{ path: 'ultimate.mult', mul: 1.2 }] },
      { c: 6, desc: { ru: 'Цепная почта: 5 доставок после первой.', en: 'Chain Post: 5 deliveries after the first.' }, patches: [{ path: 'ultimate.effects.1.count', set: 5 }] },
    ],
    lore: {
      ru: 'Курьер «Молниеносной почты», доставляющая письма раньше, чем их напишут. Опоздала один раз в жизни — и до сих пор переживает.',
      en: "A courier of the Lightning Post who delivers letters before they're written. She was late once in her life — and still isn't over it.",
    },
    personality: { ru: ['непоседа', 'пунктуальная', 'болтушка', 'гонщица'], en: ['restless', 'punctual', 'chatterbox', 'speed freak'] },
    palette: ['#A46BFF', '#FFE14D', '#1E1E2A'],
    voice: null,
    art: {
      prompt: artPrompt('f', 'rare', 'Subject: an adult woman, an energetic lightning courier. Short spiky violet hair with yellow goggles pushed up on her forehead, bright yellow eyes, cheeky grin. Outfit: a fitted purple messenger jacket with long sleeves, a satchel stuffed with letters, fingerless gloves, shorts over full-length leggings, running boots trailing sparks. Weapon: a short lightning dagger; she is mid-sprint with electric trails behind her. Palette: violet, electric yellow, black. Background: city rooftops under a thundery evening sky.'),
      focal: { x: 0.484, y: 0.26 },
    },
  },
  {
    id: 'sirin',
    name: { ru: 'Сирин', en: 'Sirin', jp: 'シリン' },
    title: { ru: 'Песнь Ветров', en: 'Song of the Winds' },
    gender: 'f', rarity: 'rare', element: 'gale', role: 'oracle',
    base: { hp: 630, atk: 160, def: 44, crit: 5, aff: 60 },
    growth: { hp: 42.8, atk: 10.8, def: 3 },
    move: cp(MOVE.step1), basic: cp(BASIC.oracle2), jump: cp(JUMP.oracle),
    skill: {
      id: 'wind-ballad',
      name: { ru: 'Баллада ветра', en: 'Wind Ballad', jp: '風のバラッド' },
      desc: {
        ru: 'Песня для союзницы в пределах 3: +25 энергии и снятие 1 негативного эффекта.',
        en: 'A song for an ally within 3: +25 energy and removes 1 debuff.',
      },
      cooldown: 3,
      target: { shape: 'single', range: 3, los: 'free', side: 'ally' },
      effects: [{ op: 'energy', amount: 25 }, { op: 'cleanse', count: 1 }],
    },
    passive: {
      id: 'travelling-song',
      name: { ru: 'Попутная песня', en: 'Travelling Song' },
      desc: {
        ru: 'В начале хода своей стороны союзница с наименьшей энергией в пределах 2 получает +8 энергии.',
        en: 'At the start of her side’s turn, the ally with the least energy within 2 gains +8 energy.',
      },
      triggers: [{ on: 'turnStart', effects: [{ op: 'energy', amount: 8, who: 'lowestEnergyAlly', range: 2, count: 1 }] }],
    },
    ultimate: {
      id: 'storm-chorus',
      name: { ru: 'Хор бури', en: 'Storm Chorus', jp: '嵐の合唱' },
      desc: {
        ru: 'Все союзницы лечатся на 80% ATK и получают Воодушевление на 1 ход; враги в радиусе 2 получают 80% ATK Вихрем (Воронка по запечатанным).',
        en: 'Every ally heals 80% ATK and gains Inspire for 1 turn; enemies within radius 2 take 80% ATK Gale damage (Vortex on sealed ones).',
      },
      cost: 70,
      target: { shape: 'all', side: 'any' },
      effects: [
        { op: 'heal', mult: 0.8, who: 'allAllies' },
        { op: 'status', id: 'inspire', turns: 1, value: 0.25, who: 'allAllies' },
        { op: 'damage', mult: 0.8, area: { shape: 'radius', r: 2, center: 'caster', side: 'enemy' } },
      ],
      vfx: 'ult-sirin',
    },
    quirks: [
      {
        id: 'migrant-bird',
        name: { ru: 'Перелётная птица', en: 'Migrant Bird' },
        desc: {
          ru: 'Вместо хода может поменяться местами с союзницей в пределах 2.',
          en: 'Instead of moving, she can swap places with an ally within 2.',
        },
        rules: [{ rule: 'swapMove', params: { range: 2, usesPerBattle: null } }],
      },
    ],
    constellations: [
      { c: 1, desc: { ru: 'HP +10%.', en: 'HP +10%.' }, patches: [{ mod: { stat: 'hpPct', value: 0.1 } }] },
      { c: 2, desc: { ru: 'Попутная песня: +12 энергии.', en: 'Travelling Song: +12 energy.' }, patches: [{ path: 'passive.triggers.0.effects.0.amount', set: 12 }] },
      { c: 3, desc: { ru: 'Баллада: +35 энергии.', en: 'Wind Ballad: +35 energy.' }, patches: [{ path: 'skill.effects.0.amount', set: 35 }] },
      { c: 4, desc: { ru: 'Воодушевление от Хора — 2 хода.', en: 'Chorus Inspire lasts 2 turns.' }, patches: [{ path: 'ultimate.effects.1.turns', set: 2 }] },
      { c: 5, desc: { ru: 'Лечение и урон Хора +20%.', en: 'Chorus healing and damage +20%.' }, patches: [{ path: 'ultimate.mult', mul: 1.2 }] },
      { c: 6, desc: { ru: 'Перезарядка Баллады 2.', en: 'Wind Ballad cooldown 2.' }, patches: [{ path: 'skill.cooldown', set: 2 }] },
    ],
    lore: {
      ru: 'Странствующая певица с крылатой арфой: ветер подпевает ей, а уставшие воины снова встают в строй. Из каждой битвы она складывает балладу.',
      en: 'A wandering singer with a winged harp: the wind sings along and weary warriors rise again. She turns every battle into a ballad.',
    },
    personality: { ru: ['мечтательная', 'поэтичная', 'свободолюбивая', 'весёлая'], en: ['dreamy', 'poetic', 'free-spirited', 'cheerful'] },
    palette: ['#3BE3A0', '#F5E6C8', '#4B7BEC'],
    voice: null,
    art: {
      prompt: artPrompt('f', 'rare', 'Subject: an adult woman, a dreamy wind bard. Long light-green hair with feather ornaments, sky-blue eyes, gentle singing expression. Outfit: a cream and green travelling bard’s tunic dress with long sleeves, a short feathered cape, boots. Weapon: a lyre-like harp shaped like a pair of bird wings; ribbons of wind and music swirl around her. Palette: mint green, cream, sky blue. Background: a grassy hilltop with windmills and birds in a bright sky.'),
      focal: { x: 0.531, y: 0.172 },
    },
  },
  {
    id: 'falk',
    name: { ru: 'Фальк', en: 'Falk', jp: 'ファルク' },
    title: { ru: 'Каменный Арбалетчик', en: 'The Stoneshot Crossbowman' },
    gender: 'm', rarity: 'rare', element: 'terra', role: 'ranger',
    base: { hp: 567, atk: 254, def: 29, crit: 10, aff: 20 },
    growth: { hp: 38.5, atk: 17.3, def: 2 },
    move: cp(MOVE.step1), basic: cp(BASIC.shot4), jump: cp(JUMP.ranged),
    skill: {
      id: 'siege-bolt',
      name: { ru: 'Осадный болт', en: 'Siege Bolt', jp: '攻城の矢' },
      desc: {
        ru: 'Болт пробивает диагональ на 5 клеток: 140% ATK Твердью всем врагам; первого задетого Обездвиживает на 1 ход.',
        en: 'A bolt pierces 5 squares of a diagonal: 140% ATK Terra damage to every enemy; the first one hit is Rooted for 1 turn.',
      },
      cooldown: 3,
      target: { shape: 'line', length: 5, pierce: true, side: 'enemy' },
      effects: [{ op: 'damage', mult: 1.4 }, { op: 'status', id: 'root', turns: 1, who: 'firstInLine' }],
    },
    passive: {
      id: 'heavy-bolts',
      name: { ru: 'Тяжёлые болты', en: 'Heavy Bolts' },
      desc: {
        ru: 'Обычная атака отбрасывает цель на 1 клетку.',
        en: 'His basic attack pushes the target 1 square.',
      },
      triggers: [{ on: 'hitDealt', if: { source: 'basic' }, effects: [{ op: 'push', dist: 1, from: 'caster', who: 'eventTarget' }] }],
    },
    ultimate: {
      id: 'rockfall',
      name: { ru: 'Камнепад', en: 'Rockfall', jp: '落石' },
      desc: {
        ru: 'Обрушивает скалу на точку в пределах 4: 160% ATK Твердью врагам в радиусе 1.',
        en: 'Brings a cliff down on a point within 4: 160% ATK Terra damage to enemies within radius 1.',
      },
      cost: 60,
      target: { shape: 'radius', r: 1, center: 'square', range: 4, side: 'enemy' },
      effects: [{ op: 'damage', mult: 1.6 }],
      vfx: 'ult-falk',
    },
    quirks: [
      {
        id: 'entrenched',
        name: { ru: 'Окоп', en: 'Entrenched' },
        desc: {
          ru: 'Если в свою активацию Фальк не двигался, он получает Стойку (DEF +30%) на 1 ход.',
          en: 'If Falk did not move during his activation, he gains Brace (DEF +30%) for 1 turn.',
        },
        triggers: [{ on: 'afterAction', if: { selfMoved: false }, effects: [{ op: 'status', id: 'brace', turns: 1, who: 'self' }] }],
      },
    ],
    constellations: [
      { c: 1, desc: { ru: 'HP +10%.', en: 'HP +10%.' }, patches: [{ mod: { stat: 'hpPct', value: 0.1 } }] },
      { c: 2, desc: { ru: 'DEF +15%.', en: 'DEF +15%.' }, patches: [{ mod: { stat: 'defPct', value: 0.15 } }] },
      { c: 3, desc: { ru: 'Урон Осадного болта +20%.', en: 'Siege Bolt damage +20%.' }, patches: [{ path: 'skill.mult', mul: 1.2 }] },
      { c: 4, desc: { ru: 'ATK +10%.', en: 'ATK +10%.' }, patches: [{ mod: { stat: 'atkPct', value: 0.1 } }] },
      { c: 5, desc: { ru: 'Урон Камнепада +20%.', en: 'Rockfall damage +20%.' }, patches: [{ path: 'ultimate.mult', mul: 1.2 }] },
      { c: 6, desc: { ru: 'Камнепад Обездвиживает всех задетых на 1 ход.', en: 'Rockfall Roots everyone hit for 1 turn.' }, patches: [{ effect: { op: 'status', id: 'root', turns: 1 }, to: 'ultimate' }] },
    ],
    lore: {
      ru: 'Охотник из каменных каньонов, который в основном говорит звуком спущенной тетивы. Держит позицию, даже когда все остальные бегут.',
      en: 'A hunter from the stone canyons who mostly speaks with the twang of his crossbow. He holds his position even when everyone else runs.',
    },
    personality: { ru: ['немногословный', 'надёжный', 'упрямый', 'охотник'], en: ['taciturn', 'reliable', 'stubborn', 'hunter'] },
    palette: ['#E3A13B', '#5B5B5B', '#2F4F2F'],
    voice: null,
    art: {
      prompt: artPrompt('m', 'rare', 'Subject: an adult man, a stoic stone crossbowman. Short ash-blond hair, light stubble, narrow green eyes, serious expression. Outfit: a hooded olive cloak over brown leather armour with stone-plate pauldrons, long sleeves, gloves and boots. Weapon: a heavy siege crossbow loaded with a stone-tipped bolt, aimed forward. Palette: amber, stone grey, forest green. Background: a rocky canyon with crumbling stone ruins.'),
      focal: { x: 0.457, y: 0.221 },
    },
  },
  {
    id: 'runa',
    name: { ru: 'Руна', en: 'Runa', jp: 'ルーナ' },
    title: { ru: 'Песчаная Чертёжница', en: 'The Sand Draughtswoman' },
    gender: 'f', rarity: 'rare', element: 'terra', role: 'mystic',
    base: { hp: 588, atk: 210, def: 35, crit: 5, aff: 80 },
    growth: { hp: 40, atk: 14.3, def: 2.3 },
    move: cp(MOVE.step1), basic: cp(BASIC.bolt2), jump: cp(JUMP.ranged),
    skill: {
      id: 'sand-rune',
      name: { ru: 'Песчаная руна', en: 'Sand Rune', jp: '砂の符' },
      desc: {
        ru: 'Чертит руну вокруг клетки в пределах 3 (радиус 1, 2 хода): враг, начинающий ход внутри, получает 60% ATK Твердью и Замедление на 1 ход.',
        en: 'Draws a rune around a square within 3 (radius 1, 2 turns): an enemy starting its turn inside takes 60% ATK Terra damage and is Slowed for 1 turn.',
      },
      cooldown: 3,
      target: { shape: 'radius', r: 1, center: 'square', range: 3, side: 'enemy' },
      effects: [
        { op: 'zone', id: 'sand-rune', turns: 2, side: 'enemy', onTurnStart: [{ op: 'damage', mult: 0.6 }, { op: 'status', id: 'slow', turns: 1 }] },
      ],
    },
    passive: {
      id: 'rune-circle',
      name: { ru: 'Рунный круг', en: 'Rune Circle' },
      desc: {
        ru: 'Когда Руна вызывает Огранку, союзница с наименьшим HP в пределах 2 тоже получает щит в 15% макс. HP Руны.',
        en: "When Runa triggers Facet, the ally with the lowest HP within 2 also gains a shield of 15% of Runa's max HP.",
      },
      triggers: [{ on: 'reaction', if: { reaction: 'facet' }, effects: [{ op: 'shield', pctCasterMaxHp: 0.15, turns: 2, who: 'lowestHpAlly', range: 2, count: 1 }] }],
    },
    ultimate: {
      id: 'stone-garden',
      name: { ru: 'Каменный сад', en: 'Stone Garden', jp: '石庭' },
      desc: {
        ru: 'Возводит до 3 каменных колонн на свободных клетках в пределах 3 (по 15% её макс. HP, 3 хода); каждый враг рядом с колонной получает 100% ATK Твердью (один раз).',
        en: 'Raises up to 3 stone pillars on empty squares within 3 (15% of her max HP each, 3 turns); every enemy next to a pillar takes 100% ATK Terra damage (once).',
      },
      cost: 70,
      target: { shape: 'square', range: 3, count: 3, empty: true },
      effects: [
        { op: 'ward', id: 'stone-pillar', hpPct: 0.15, turns: 3, blocks: true, jumpable: true },
        { op: 'damage', mult: 1.0, area: { shape: 'radius', r: 1, center: 'chosenSquares', side: 'enemy' } },
      ],
      vfx: 'ult-runa',
    },
    quirks: [
      {
        id: 'draughtswoman',
        name: { ru: 'Чертёжница', en: 'Draughtswoman' },
        desc: {
          ru: 'Союзницы могут перепрыгивать её колонны — и при ходе, и внутри цепочки прыжков-ударов (колонна не повреждается, прыжок засчитывается в цепочку).',
          en: 'Allies can vault over her pillars — both when moving and inside jump-strike chains (the pillar is unharmed, the hop counts toward the chain).',
        },
        rules: [{ rule: 'springboardWards', params: {} }],
      },
    ],
    constellations: [
      { c: 1, desc: { ru: 'HP +10%.', en: 'HP +10%.' }, patches: [{ mod: { stat: 'hpPct', value: 0.1 } }] },
      { c: 2, desc: { ru: 'Песчаная руна держится 3 хода.', en: 'Sand Rune lasts 3 turns.' }, patches: [{ path: 'skill.effects.0.turns', set: 3 }] },
      { c: 3, desc: { ru: 'Урон Руны +20%.', en: 'Sand Rune damage +20%.' }, patches: [{ path: 'skill.mult', mul: 1.2 }] },
      { c: 4, desc: { ru: 'Колонны — 25% HP.', en: 'Pillars have 25% HP.' }, patches: [{ path: 'ultimate.effects.0.hpPct', set: 0.25 }] },
      { c: 5, desc: { ru: 'Урон Сада +20%.', en: 'Stone Garden damage +20%.' }, patches: [{ path: 'ultimate.mult', mul: 1.2 }] },
      { c: 6, desc: { ru: '4 колонны.', en: '4 pillars.' }, patches: [{ path: 'ultimate.target.count', set: 4 }] },
    ],
    lore: {
      ru: 'Архитектор, чертящая руны на песке, — и из песка встают колонны. Уверена, что у каждой доски есть идеальная схема, и ищет её.',
      en: "An architect who draws runes in the sand — and pillars rise from it. She believes every board has a perfect blueprint, and she's searching for it.",
    },
    personality: { ru: ['рассудительная', 'педантичная', 'любознательная', 'архитектор'], en: ['level-headed', 'meticulous', 'curious', 'architect'] },
    palette: ['#E3A13B', '#F3E0B5', '#2C6E8F'],
    voice: null,
    art: {
      prompt: artPrompt('f', 'rare', 'Subject: an adult woman, a studious sand-rune architect. Neat shoulder-length teal-black hair, round glasses, amber eyes, thoughtful expression. Outfit: a long sand-coloured architect’s robe with long sleeves, rolled blueprints in a satchel, a belt of measuring tools. Weapon: a stylus drawing glowing amber runes in the air while floating stone blocks orbit her. Palette: sand gold, cream, teal. Background: desert ruins with geometric stone pillars at golden hour.'),
      focal: { x: 0.506, y: 0.176 },
    },
  },
  {
    id: 'vera',
    name: { ru: 'Вера', en: 'Vera', jp: 'ヴェーラ' },
    title: { ru: 'Щит Рассвета', en: 'Shield of Dawn' },
    gender: 'f', rarity: 'rare', element: 'radiance', role: 'guardian',
    base: { hp: 861, atk: 110, def: 87, crit: 5, aff: 20 },
    growth: { hp: 58.6, atk: 7.5, def: 5.9 },
    move: cp(MOVE.step1), basic: cp(BASIC.melee), jump: cp(JUMP.guardian),
    skill: {
      id: 'radiant-shield',
      name: { ru: 'Сияющий щит', en: 'Radiant Shield', jp: '輝く盾' },
      desc: {
        ru: 'Союзница в пределах 2 (или сама Вера) получает щит в 20% макс. HP Веры на 2 хода и избавляется от 1 негативного эффекта.',
        en: "An ally within 2 (or Vera herself) gains a shield of 20% of Vera's max HP for 2 turns and loses 1 debuff.",
      },
      cooldown: 3,
      target: { shape: 'single', range: 2, los: 'free', side: 'allyOrSelf', includeSelf: true },
      effects: [{ op: 'shield', pctCasterMaxHp: 0.2, turns: 2 }, { op: 'cleanse', count: 1 }],
    },
    passive: {
      id: 'oath',
      name: { ru: 'Присяга', en: 'Oath' },
      desc: {
        ru: 'Раз за ход врага: когда соседняя союзница получает урон, Вера принимает 40% этого урона на себя.',
        en: 'Once per enemy turn: when an adjacent ally takes damage, Vera takes 40% of it instead.',
      },
      triggers: [{ on: 'allyHit', oncePerTurn: true, effects: [{ op: 'redirect', pct: 0.4 }] }],
    },
    ultimate: {
      id: 'morning-watch',
      name: { ru: 'Утренняя стража', en: 'Morning Watch', jp: '暁の番' },
      desc: {
        ru: 'Вера поднимает знамя: враги в радиусе 2 получают Провокацию на 1 ход; Вера — Стойку (DEF +40%) на 2 хода и лечение 15% макс. HP.',
        en: 'Vera raises her banner: enemies within radius 2 are Taunted for 1 turn; Vera gains Brace (DEF +40%) for 2 turns and heals 15% max HP.',
      },
      cost: 60,
      target: { shape: 'radius', r: 2, center: 'caster', side: 'enemy' },
      effects: [
        { op: 'status', id: 'taunt', turns: 1 },
        { op: 'status', id: 'brace', turns: 2, value: 0.4, who: 'self' },
        { op: 'heal', pctMaxHp: 0.15, who: 'self' },
      ],
      vfx: 'ult-vera',
    },
    quirks: [
      {
        id: 'stubborn',
        name: { ru: 'Упрямица', en: 'Stubborn' },
        desc: {
          ru: 'Раз за бой прыжок-удар, который должен был выбить Веру, оставляет её с 1 HP.',
          en: 'Once per battle, a jump-strike that would KO Vera leaves her at 1 HP instead.',
        },
        triggers: [{ on: 'lethalDamage', oncePerBattle: true, if: { source: 'jump' }, effects: [{ op: 'survive', hp: 1 }] }],
      },
    ],
    constellations: [
      { c: 1, desc: { ru: 'HP +10%.', en: 'HP +10%.' }, patches: [{ mod: { stat: 'hpPct', value: 0.1 } }] },
      { c: 2, desc: { ru: 'Присяга: 50% урона.', en: 'Oath: 50% of the damage.' }, patches: [{ path: 'passive.triggers.0.effects.0.pct', set: 0.5 }] },
      { c: 3, desc: { ru: 'Сияющий щит — 24% HP.', en: 'Radiant Shield: 24% HP.' }, patches: [{ path: 'skill.effects.0.pctCasterMaxHp', set: 0.24 }] },
      { c: 4, desc: { ru: 'DEF +15%.', en: 'DEF +15%.' }, patches: [{ mod: { stat: 'defPct', value: 0.15 } }] },
      { c: 5, desc: { ru: 'Утренняя стража лечит 25% HP.', en: 'Morning Watch heals 25% HP.' }, patches: [{ path: 'ultimate.effects.2.pctMaxHp', set: 0.25 }] },
      { c: 6, desc: { ru: 'Упрямица спасает от любого смертельного удара.', en: 'Stubborn saves her from any lethal hit.' }, patches: [{ path: 'quirks.0.triggers.0.if', unset: true }] },
    ],
    lore: {
      ru: 'Самая юная паладинка Рассветного ордена, принявшая присягу на год раньше положенного. Не умеет ни отступать, ни врать — ни капельки.',
      en: 'The youngest paladin of the Order of Dawn, sworn in a year early. She can neither retreat nor lie — not one bit.',
    },
    personality: { ru: ['честная', 'упрямая', 'храбрая', 'немного наивная'], en: ['honest', 'stubborn', 'brave', 'a little naive'] },
    palette: ['#FFF0A0', '#C0C8D8', '#2E5AAC'],
    voice: null,
    art: {
      prompt: artPrompt('f', 'rare', 'Subject: an adult woman, an earnest young paladin. Short golden-blonde hair with a straight fringe, bright blue eyes, determined honest expression. Outfit: polished silver plate armour with a long blue tabard bearing a sun emblem, chainmail sleeves, gauntlets and boots. Weapon: a large kite shield glowing with radiant light, raised high, and a short sword. Palette: pale gold, silver, royal blue. Background: a castle courtyard at sunrise with fluttering banners.'),
      focal: { x: 0.508, y: 0.16 },
    },
  },
  {
    id: 'mara',
    name: { ru: 'Мара', en: 'Mara', jp: 'マーラ' },
    title: { ru: 'Ночная Воровка', en: 'The Night Thief' },
    gender: 'f', rarity: 'rare', element: 'umbra', role: 'shadow',
    base: { hp: 546, atk: 230, def: 29, crit: 25, aff: 20 },
    growth: { hp: 37.2, atk: 15.6, def: 2 },
    move: cp(MOVE.glide3), basic: cp(BASIC.melee), jump: cp(JUMP.shadow),
    skill: {
      id: 'trip',
      name: { ru: 'Подножка', en: 'Trip', jp: '足払い' },
      desc: {
        ru: 'Удар по соседнему врагу на 130% ATK Сумраком — и Мара меняется с ним местами.',
        en: 'Hits an adjacent enemy for 130% ATK Umbra damage — and Mara swaps places with it.',
      },
      cooldown: 3,
      target: { shape: 'single', range: 1, los: 'adjacent', side: 'enemy' },
      effects: [{ op: 'damage', mult: 1.3 }, { op: 'swap' }],
    },
    passive: {
      id: 'pickpocket',
      name: { ru: 'Карманница', en: 'Pickpocket' },
      desc: {
        ru: 'Каждое её попадание крадёт у цели 10 энергии себе.',
        en: 'Each of her hits steals 10 energy from the target for herself.',
      },
      triggers: [{ on: 'hitDealt', effects: [{ op: 'energy', amount: -10, stealTo: 'self', who: 'eventTarget' }] }],
    },
    ultimate: {
      id: 'shadow-con',
      name: { ru: 'Тёмная афера', en: 'Shadow Con', jp: '闇の詐術' },
      desc: {
        ru: 'Афера против врага в пределах 3: 200% ATK Сумраком и кража 1 положительного эффекта (он переходит к Маре).',
        en: 'A con on an enemy within 3: 200% ATK Umbra damage and steals 1 buff (Mara gets it).',
      },
      cost: 60,
      target: { shape: 'single', range: 3, los: 'free', side: 'enemy' },
      effects: [{ op: 'damage', mult: 2.0 }, { op: 'dispel', count: 1, steal: true }],
      vfx: 'ult-mara',
    },
    quirks: [
      {
        id: 'nimble-fingers',
        name: { ru: 'Ловкие пальцы', en: 'Nimble Fingers' },
        desc: {
          ru: 'После цепочки прыжков-ударов может скользнуть ещё на 1 клетку.',
          en: 'After a jump-strike chain she may glide 1 more square.',
        },
        triggers: [{ on: 'afterAction', if: { source: 'jump' }, effects: [{ op: 'freeMove', glide: 1 }] }],
      },
    ],
    constellations: [
      { c: 1, desc: { ru: 'ATK +8%.', en: 'ATK +8%.' }, patches: [{ mod: { stat: 'atkPct', value: 0.08 } }] },
      { c: 2, desc: { ru: 'Карманница крадёт 15 энергии.', en: 'Pickpocket steals 15 energy.' }, patches: [{ path: 'passive.triggers.0.effects.0.amount', set: -15 }] },
      { c: 3, desc: { ru: 'Урон Подножки +20%.', en: 'Trip damage +20%.' }, patches: [{ path: 'skill.mult', mul: 1.2 }] },
      { c: 4, desc: { ru: 'Шанс крита +10%.', en: 'Crit chance +10%.' }, patches: [{ mod: { stat: 'critChance', value: 10 } }] },
      { c: 5, desc: { ru: 'Урон Аферы +20%.', en: 'Shadow Con damage +20%.' }, patches: [{ path: 'ultimate.mult', mul: 1.2 }] },
      { c: 6, desc: { ru: 'Афера крадёт все положительные эффекты; перезарядка Подножки 2.', en: 'Shadow Con steals every buff; Trip cooldown 2.' }, patches: [{ path: 'ultimate.effects.1.count', set: 'all' }, { path: 'skill.cooldown', set: 2 }] },
    ],
    lore: {
      ru: 'Воровка с ночного рынка, которая крадёт только у воров. Обаятельно улыбается — проверьте карманы.',
      en: 'A thief from the night market who only steals from thieves. She smiles charmingly — check your pockets.',
    },
    personality: { ru: ['хитрая', 'обаятельная', 'ловкая', 'со своим кодексом'], en: ['sly', 'charming', 'nimble', 'has her own code'] },
    palette: ['#D7337E', '#1A0820', '#C9A04C'],
    voice: null,
    art: {
      prompt: artPrompt('f', 'rare', 'Subject: an adult woman, a sly charming night thief. Long dark-purple hair in a loose low ponytail, magenta eyes, playful smirk, a beauty mark under one eye. Outfit: a dark hooded cloak with gold clasps, a fitted long-sleeved black and plum jacket, trousers with many pouches, gloves and boots. Weapon: a dagger twirled in one hand and a stolen golden coin in the other; shadows curl around her feet. Palette: plum-magenta, black, gold. Background: a moonlit night-market alley with paper lanterns.'),
      focal: { x: 0.522, y: 0.194 },
    },
  },
];

export const HERO_BY_ID = Object.fromEntries(HEROES.map((h) => [h.id, h]));

export function getHero(id) {
  return HERO_BY_ID[id] || null;
}
