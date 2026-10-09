// Variant definitions. PRELIMINARY metadata written by the coordinator so that the UI can be
// built in parallel. The engine owner completes the rule flags and full rules texts (and may
// fix/extend the metadata), keeping these ids, order and metadata fields.

export const VARIANTS = [
  {
    id: 'russian',
    flag: '🇷🇺',
    size: 8,
    playable: 'dark',
    piecesPerSide: 12,
    first: 1,
    name: { ru: 'Русские шашки', en: 'Russian draughts' },
    short: {
      ru: 'Классика: дамка летает, простые бьют назад, превращение прямо во время боя.',
      en: 'The classic: flying kings, men capture backwards, promotion mid-capture.',
    },
    badges: { ru: ['8×8', 'Дамка летает', 'Бой назад'], en: ['8×8', 'Flying kings', 'Backward capture'] },
    rules: { ru: [], en: [] },
  },
  {
    id: 'turkish',
    flag: '🇹🇷',
    size: 8,
    playable: 'all',
    piecesPerSide: 16,
    first: 1,
    name: { ru: 'Турецкие шашки', en: 'Turkish draughts' },
    short: {
      ru: 'Дама: ходы по прямой вперёд и вбок, 16 шашек, бить максимум — обязательно.',
      en: 'Dama: orthogonal moves forward and sideways, 16 pieces, maximum capture.',
    },
    badges: { ru: ['8×8', 'Ходы по прямой', 'Бить максимум'], en: ['8×8', 'Orthogonal', 'Max capture'] },
    rules: { ru: [], en: [] },
  },
  {
    id: 'international',
    flag: '🌍',
    size: 10,
    playable: 'dark',
    piecesPerSide: 20,
    first: 1,
    name: { ru: 'Международные шашки', en: 'International draughts' },
    short: {
      ru: 'Стоклеточные 10×10: 20 шашек, летающие дамки, бить максимум.',
      en: '10×10 board, 20 pieces each, flying kings, maximum capture.',
    },
    badges: { ru: ['10×10', 'Дамка летает', 'Бить максимум'], en: ['10×10', 'Flying kings', 'Max capture'] },
    rules: { ru: [], en: [] },
  },
  {
    id: 'english',
    flag: '🇬🇧',
    size: 8,
    playable: 'dark',
    piecesPerSide: 12,
    first: -1,
    name: { ru: 'Английские шашки (чекерс)', en: 'English draughts (checkers)' },
    short: {
      ru: 'Чекерс: простые бьют только вперёд, дамка ходит на одно поле. Начинают чёрные.',
      en: 'Checkers: men capture forward only, kings move one square. Dark moves first.',
    },
    badges: { ru: ['8×8', 'Короткая дамка', 'Бой только вперёд'], en: ['8×8', 'Short kings', 'Forward capture'] },
    rules: { ru: [], en: [] },
  },
  {
    id: 'brazilian',
    flag: '🇧🇷',
    size: 8,
    playable: 'dark',
    piecesPerSide: 12,
    first: 1,
    name: { ru: 'Бразильские шашки', en: 'Brazilian draughts' },
    short: {
      ru: 'Международные правила на доске 8×8: летающие дамки и обязательный бой максимума.',
      en: 'International rules on an 8×8 board: flying kings and maximum capture.',
    },
    badges: { ru: ['8×8', 'Дамка летает', 'Бить максимум'], en: ['8×8', 'Flying kings', 'Max capture'] },
    rules: { ru: [], en: [] },
  },
  {
    id: 'pool',
    flag: '🇺🇸',
    size: 8,
    playable: 'dark',
    piecesPerSide: 12,
    first: -1,
    name: { ru: 'Пул-чекерс', en: 'Pool checkers' },
    short: {
      ru: 'Американский пул: летающие дамки, бой назад, любой вариант взятия.',
      en: 'American pool: flying kings, backward captures, any capture sequence.',
    },
    badges: { ru: ['8×8', 'Дамка летает', 'Свободный выбор боя'], en: ['8×8', 'Flying kings', 'Free capture choice'] },
    rules: { ru: [], en: [] },
  },
  {
    id: 'italian',
    flag: '🇮🇹',
    size: 8,
    playable: 'dark',
    piecesPerSide: 12,
    first: 1,
    name: { ru: 'Итальянские шашки', en: 'Italian draughts' },
    short: {
      ru: 'Простая не может бить дамку, строгие приоритеты взятия, короткая дамка.',
      en: 'Men cannot capture kings, strict capture priorities, short kings.',
    },
    badges: { ru: ['8×8', 'Короткая дамка', 'Приоритеты боя'], en: ['8×8', 'Short kings', 'Capture priorities'] },
    rules: { ru: [], en: [] },
  },
  {
    id: 'canadian',
    flag: '🇨🇦',
    size: 12,
    playable: 'dark',
    piecesPerSide: 30,
    first: 1,
    name: { ru: 'Канадские шашки', en: 'Canadian draughts' },
    short: {
      ru: 'Гигант 12×12: по 30 шашек, международные правила. Эпичные битвы!',
      en: 'The giant 12×12: 30 pieces each, international rules. Epic battles!',
    },
    badges: { ru: ['12×12', 'Дамка летает', 'Бить максимум'], en: ['12×12', 'Flying kings', 'Max capture'] },
    rules: { ru: [], en: [] },
  },
];

export function getVariant(id) {
  const v = VARIANTS.find((x) => x.id === id);
  if (!v) throw new Error(`Unknown variant: ${id}`);
  return v;
}
