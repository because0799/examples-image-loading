// Player-facing strings used by the controller / bootstrap. Every key is looked up in the UI i18n
// table first (src/ui/i18n.js owns the wording); the fallbacks below keep the game readable with
// an older i18n table that does not have the key yet. Russian follows the glossary: informal «ты»,
// «соперник», «дамка», «Ход назад», «УЛЬТА», «ЯРОСТЬ».
//
//   text('status.drawSoon', { n: 2 })            // 'До ничьей 2 хода' (i18n or fallback)
//   text('status.mustCapture', null, ['hud.mustCapture'])   // extra keys tried in order

import { t, getLang } from './ui/i18n.js';

function ruPlural(n, one, few, many) {
  const a = Math.abs(Math.trunc(Number(n) || 0));
  const m100 = a % 100;
  const m10 = a % 10;
  if (m100 >= 11 && m100 <= 14) return many;
  if (m10 === 1) return one;
  if (m10 >= 2 && m10 <= 4) return few;
  return many;
}

export const FALLBACK = {
  ru: {
    // illegal taps (RO-2 / MUX-02 / MUX-16)
    'status.mustCapture': 'Обязательный бой!',
    'status.mustCaptureMax': 'Бей максимум: эта шашка берёт меньше',
    'status.mustCaptureMaxAny': 'Бей максимум шашек — есть серия длиннее',
    'status.mustCaptureKings': 'При равном счёте бей больше дамок!',
    'status.capturePriority': 'Приоритет взятия: бей подсвеченной',
    'status.kingMustCapture': 'Бить обязана дамка!',
    'status.manCantTakeKing': 'Простая не может бить дамку',
    'status.noMovesForPiece': 'Этой шашке некуда ходить',
    // turn start (MUX-09)
    'status.yourTurnCapture': 'Твой ход — бей!',
    // draw warnings (MUX-20 / RTR-05)
    'status.repetitionWarn': 'Позиция повторилась — ещё раз, и ничья',
    'status.drawSoon': (p) => `До ничьей ${p.n} ${ruPlural(p.n, 'ход', 'хода', 'ходов')}`,
    // draw offer vs AI (RTR-02)
    'toast.drawDeclinedAi': 'Соперник отказывается от ничьей — бьёмся дальше!',
    'toast.drawAcceptedAi': 'Соперник согласен на ничью',
    // misc
    'toast.hintNone': 'Подсказка недоступна',
    'toast.recovered': 'Сбой эффекта — позиция восстановлена',
    'toast.pressBackAgain': 'Нажми «Назад» ещё раз, чтобы выйти',
    'toast.qualityLowered': 'Графика упрощена для плавности',
    // resume an unfinished game (F8)
    'resume.offer': 'Есть незаконченная партия: {desc}. Продолжить?',
    'resume.ok': 'Продолжить',
    'resume.cancel': 'Новая партия',
    'resume.vsAi': 'против ИИ',
    'resume.pvp': 'вдвоём',
    'resume.move': (p) => `${p.n}-й ход`,
  },
  en: {
    'status.mustCapture': 'Capture is mandatory!',
    'status.mustCaptureMax': 'Take the maximum: this piece captures fewer',
    'status.mustCaptureMaxAny': 'Take the maximum — a longer capture exists',
    'status.mustCaptureKings': 'Equal count: take the most kings!',
    'status.capturePriority': 'Capture priority: use a lit piece',
    'status.kingMustCapture': 'The king must capture!',
    'status.manCantTakeKing': "A man can't capture a king",
    'status.noMovesForPiece': 'This piece has no moves',
    'status.yourTurnCapture': 'Your move — capture!',
    'status.repetitionWarn': 'Position repeated — once more and it is a draw',
    'status.drawSoon': (p) => `Draw in ${p.n} ${Number(p.n) === 1 ? 'move' : 'moves'}`,
    'toast.drawDeclinedAi': 'Your opponent declines the draw — fight on!',
    'toast.drawAcceptedAi': 'Your opponent accepts the draw',
    'toast.hintNone': 'No hint available',
    'toast.recovered': 'Effect glitch — position restored',
    'toast.pressBackAgain': 'Press Back again to exit',
    'toast.qualityLowered': 'Graphics simplified for smoother play',
    'resume.offer': 'You have an unfinished game: {desc}. Continue?',
    'resume.ok': 'Continue',
    'resume.cancel': 'New game',
    'resume.vsAi': 'vs AI',
    'resume.pvp': 'two players',
    'resume.move': (p) => `move ${p.n}`,
  },
};

function interpolate(str, params) {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (m, name) => (params[name] != null ? String(params[name]) : m));
}

/** Is `key` translated by the UI i18n table? */
export function hasText(key) {
  try {
    return t(key) !== key;
  } catch (e) {
    return false;
  }
}

/**
 * Translated text for `key` (UI i18n table first, then `alts`, then the controller fallback).
 * Never throws; an unknown key returns the key itself.
 */
export function text(key, params, alts = []) {
  for (const k of [key, ...alts]) {
    try {
      const v = t(k, params);
      if (v !== k && v != null && v !== '') return v;
    } catch (e) {
      /* fall through to the fallback table */
    }
  }
  let lang = 'ru';
  try {
    lang = getLang() === 'en' ? 'en' : 'ru';
  } catch (e) {
    /* default ru */
  }
  const tab = FALLBACK[lang];
  let s = tab[key] != null ? tab[key] : FALLBACK.ru[key];
  if (s == null) return key;
  if (typeof s === 'function') s = s(params || {});
  return interpolate(String(s), params);
}
