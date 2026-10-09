// AI difficulty levels: player-facing metadata (AI_LEVELS, re-exported by ai-client.js) and the
// search parameters behind each level (LEVEL_PARAMS, used by search.js).

export const AI_LEVELS = Object.freeze([
  Object.freeze({
    id: 1,
    name: { ru: 'Новичок', en: 'Novice' },
    epicName: { ru: 'Ученик', en: 'Apprentice' },
    kanji: '弟子',
    power: 530,
    desc: {
      ru: 'Видит на ход вперёд и часто зевает. Для первых партий и детей.',
      en: 'Looks one move ahead and blunders a lot. For first games and kids.',
    },
  }),
  Object.freeze({
    id: 2,
    name: { ru: 'Любитель', en: 'Amateur' },
    epicName: { ru: 'Воин', en: 'Warrior' },
    kanji: '戦士',
    power: 1800,
    desc: {
      ru: 'Знает простые удары, но иногда ошибается. Хорош для разминки.',
      en: 'Knows simple shots but still slips up now and then. A good warm-up.',
    },
  }),
  Object.freeze({
    id: 3,
    name: { ru: 'Боец', en: 'Fighter' },
    epicName: { ru: 'Самурай', en: 'Samurai' },
    kanji: '侍',
    power: 4200,
    desc: {
      ru: 'Крепкий соперник: считает комбинации и не отдаёт шашки даром.',
      en: 'A solid opponent: calculates combinations and never gives pieces away.',
    },
  }),
  Object.freeze({
    id: 4,
    name: { ru: 'Мастер', en: 'Master' },
    epicName: { ru: 'Сёгун', en: 'Shogun' },
    kanji: '将軍',
    power: 9001,
    desc: {
      ru: 'Глубокий расчёт и позиционное чутьё. Ошибок не прощает.',
      en: 'Deep calculation and positional sense. Punishes every mistake.',
    },
  }),
  Object.freeze({
    id: 5,
    name: { ru: 'Гроссмейстер', en: 'Grandmaster' },
    epicName: { ru: 'Бог шашек', en: 'Checkers God' },
    kanji: '神',
    power: 53000,
    desc: {
      ru: 'Максимальная сила: думает дольше всех и бьёт без пощады.',
      en: 'Full strength: thinks the longest and strikes without mercy.',
    },
  }),
]);

/**
 * Search parameters per level.
 *  timeMs     default thinking time
 *  maxDepth   iterative-deepening cap (plies, before extensions)
 *  multiPV    score every root move exactly (needed for noisy move choice)
 *  noise      std-dev of the gaussian noise added to root scores (multiPV levels; 100 = a man)
 *  blunder    probability of playing a random legal move instead
 *  jitter     ± deterministic per-position evaluation noise (variety without blunders)
 *  threatExt  horizon threat extensions allowed per line (quiet leaf where the opponent threatens a capture)
 *  lmr        late-move reductions
 */
export const LEVEL_PARAMS = Object.freeze({
  1: Object.freeze({ timeMs: 120, maxDepth: 2, multiPV: true, noise: 140, blunder: 0.2, jitter: 0, threatExt: 0, lmr: false }),
  2: Object.freeze({ timeMs: 220, maxDepth: 4, multiPV: true, noise: 45, blunder: 0.05, jitter: 0, threatExt: 1, lmr: false }),
  3: Object.freeze({ timeMs: 400, maxDepth: 60, multiPV: false, noise: 0, blunder: 0, jitter: 8, threatExt: 1, lmr: true }),
  4: Object.freeze({ timeMs: 1200, maxDepth: 60, multiPV: false, noise: 0, blunder: 0, jitter: 3, threatExt: 1, lmr: true }),
  5: Object.freeze({ timeMs: 2500, maxDepth: 60, multiPV: false, noise: 0, blunder: 0, jitter: 0, threatExt: 2, lmr: true }),
});

export function clampLevel(level) {
  const l = Math.round(Number(level));
  if (!Number.isFinite(l)) return 3;
  return l < 1 ? 1 : l > 5 ? 5 : l;
}
