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
      ru: 'Видит только взятия, часто ходит наугад и не замечает угроз. Для детей и первых партий.',
      en: 'Sees only captures, often moves at random and misses threats. For kids and first games.',
    },
  }),
  Object.freeze({
    id: 2,
    name: { ru: 'Любитель', en: 'Amateur' },
    epicName: { ru: 'Воин', en: 'Warrior' },
    kanji: '戦士',
    power: 1800,
    desc: {
      ru: 'Смотрит на ход вперёд, порой зевает шашку и не видит ваших ударов. Хорош для разминки.',
      en: 'Looks a move ahead, drops a piece now and then, never sees your shots coming. A warm-up.',
    },
  }),
  Object.freeze({
    id: 3,
    name: { ru: 'Боец', en: 'Fighter' },
    epicName: { ru: 'Самурай', en: 'Samurai' },
    kanji: '侍',
    power: 4200,
    desc: {
      ru: 'Игрок клубного уровня: считает на пару ходов, но порой играет «на глаз». Ловите момент!',
      en: 'Club player: calculates a few moves ahead but sometimes trusts a first impression.',
    },
  }),
  Object.freeze({
    id: 4,
    name: { ru: 'Мастер', en: 'Master' },
    epicName: { ru: 'Сёгун', en: 'Shogun' },
    kanji: '将軍',
    power: 9001,
    desc: {
      ru: 'Сильный игрок: глубокий расчёт, ошибается редко и почти любую ошибку накажет.',
      en: 'Strong player: deep calculation, rare slips, punishes almost every mistake.',
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
 * Search parameters per level. The ladder is meant to feel human: levels 1–4 are depth-capped
 * searches that score every root move exactly (multiPV) and then choose with a human-error
 * model — a beginner who sometimes just moves something, a casual player who does not see the
 * opponent's shots coming, a club player who now and then trusts a first impression instead of
 * calculating, a strong player who calculates six plies and only rarely plays on intuition.
 * Level 5 is the full-strength time-limited search (unchanged).
 *
 * Calibration (AI-vs-AI, balanced random openings, both colours, Russian / Turkish / English /
 * International): level k+1 scores 75 / 85 / 87 % against level k for k = 1..3, level 5 ~99 %
 * against level 4 and 100 % against level 1 (giveaway: 91 / 78 / 70 / 81 %). The steep step is
 * the one into the full-strength maximum: a level 4 that searches 0.8 s at full strength
 * (multiPV: false, maxDepth: 60, glance: 0, noise: 0, timeMs: 800) scores ~98 % against level 3
 * and ~68 % against level 5 instead — then the cliff sits between levels 3 and 4.
 *
 *  timeMs        default thinking time (for the depth-capped levels only a safety cap)
 *  maxDepth      iterative-deepening cap (plies, before extensions)
 *  multiPV       score every root move exactly at every depth (needed by the error model)
 *  qMax          capture plies followed beyond the horizon (Infinity = every forced capture; a
 *                small value means the level does not "see" the end of a capture sequence, e.g.
 *                the opponent's sacrifice followed by a multi-capture — the 2-for-1 shot)
 *  noise         std-dev of the gaussian noise added to the root scores (100 = a man)
 *  jitter        ± deterministic per-position evaluation noise (noisy judgement at the leaves)
 *  random        probability of a random move among the "safe" ones — after the move the piece
 *                that moved cannot be captured at once (in giveaway: the move does not look worse
 *                than the best by more than `suicide` at depth 1)
 *  glance        probability of trusting a first impression: the best move at `glanceDepth` (a
 *                shallower look) instead of the full depth — deeper tactics are missed — unless
 *                the full depth refutes it by more than `glanceMaxLoss`
 *  slip          probability of choosing one of the `slipTopN` next-best moves that are
 *                `slipMinLoss`..`slipMaxLoss` worse by the level's own scores
 *  threatExt     horizon threat extensions allowed per line (quiet leaf where the opponent threatens a capture)
 *  lmr           late-move reductions
 *  contempt      how much worse than 0 the AI scores a draw for itself while ≥ 1/3 of the starting
 *                material is on the board (100 = a man): avoids early repetition draws (search.js)
 *  giveaway      overrides for giveaway (поддавки) games
 */
const NO_ERRORS = { random: 0, suicide: 0, glance: 0, glanceDepth: 0, glanceMaxLoss: 0, slip: 0, slipTopN: 0, slipMinLoss: 0, slipMaxLoss: 0 };

export const LEVEL_PARAMS = Object.freeze({
  1: Object.freeze({
    ...NO_ERRORS,
    timeMs: 300, maxDepth: 1, multiPV: true, qMax: 2, noise: 25, jitter: 12,
    random: 0.35, suicide: 90,
    threatExt: 0, lmr: false, contempt: 20,
    giveaway: Object.freeze({}),
  }),
  2: Object.freeze({
    ...NO_ERRORS,
    timeMs: 500, maxDepth: 2, multiPV: true, qMax: 1, noise: 15, jitter: 12,
    slip: 0.15, slipTopN: 3, slipMinLoss: 10, slipMaxLoss: 60,
    threatExt: 1, lmr: false, contempt: 20,
    // giveaway is decided by forcing sequences, where two plies of sight already dominate one:
    // the casual player is sloppier there, or level 1 would hardly ever win a game
    giveaway: Object.freeze({ noise: 35, jitter: 20, slip: 0.2, slipMaxLoss: 150 }),
  }),
  3: Object.freeze({
    ...NO_ERRORS,
    timeMs: 1000, maxDepth: 4, multiPV: true, qMax: Infinity, noise: 10, jitter: 8,
    glance: 0.4, glanceDepth: 1, glanceMaxLoss: 300,
    threatExt: 1, lmr: false, contempt: 20,
    giveaway: Object.freeze({}),
  }),
  4: Object.freeze({
    ...NO_ERRORS,
    timeMs: 1500, maxDepth: 6, multiPV: true, qMax: Infinity, noise: 5, jitter: 5,
    glance: 0.15, glanceDepth: 2, glanceMaxLoss: 300,
    threatExt: 1, lmr: true, contempt: 20,
    giveaway: Object.freeze({}),
  }),
  5: Object.freeze({
    ...NO_ERRORS,
    timeMs: 2500, maxDepth: 60, multiPV: false, qMax: Infinity, noise: 0, jitter: 2,
    threatExt: 1, lmr: true, contempt: 20,
    giveaway: Object.freeze({}),
  }),
});

/**
 * Effective parameters of a level for a game type: the level's values, its giveaway overrides
 * (in giveaway) and explicit `overrides` (testing / tuning).
 */
export function levelParams(level, giveaway = false, overrides = null) {
  const base = LEVEL_PARAMS[clampLevel(level)];
  const P = { ...base, ...(giveaway && base.giveaway ? base.giveaway : null), ...(overrides && typeof overrides === 'object' ? overrides : null) };
  delete P.giveaway;
  return P;
}

export function clampLevel(level) {
  const l = Math.round(Number(level));
  if (!Number.isFinite(l)) return 3;
  return l < 1 ? 1 : l > 5 ? 5 : l;
}
