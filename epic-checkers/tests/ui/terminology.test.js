// Binding Russian terminology for every UI string (MUX-03, MUX-08, MUX-10, MUX-13, EAD-07) and the
// i18n keys the controller relies on (cross-module contract).
import test from 'node:test';
import assert from 'node:assert/strict';
import { TABLES, t, setLang } from '../../src/ui/i18n.js';

/** Every string of a table (plain strings, list items, plural forms) as [key, text]. */
function strings(tab) {
  const out = [];
  for (const [k, v] of Object.entries(tab)) {
    if (typeof v === 'string') out.push([k, v]);
    else if (Array.isArray(v)) v.forEach((s, i) => out.push([`${k}[${i}]`, s]));
    else for (const [f, s] of Object.entries(v)) out.push([`${k}.${f}`, s]);
  }
  return out;
}

// the only place that addresses more than one person: the two-player hint and the draw offer to «Чёрные»
const PLURAL_OK = new Set(['setup.pvpHint', 'pause.drawOffer']);

test('Russian system texts use «ты», never the formal «вы»', () => {
  const bad = [];
  const formal = /(^|[^А-Яа-яЁё])(Вы|вы|Ваш\S*|ваш\S*|Вам|вам|Вас|вас)(?![А-Яа-яЁё])|[А-Яа-яЁё]+(ите|йте)(?![А-Яа-яЁё])/;
  for (const [k, s] of strings(TABLES.ru)) {
    if (PLURAL_OK.has(k.replace(/\[\d+\]$/, ''))) continue;
    if (formal.test(s)) bad.push(`${k}: ${s}`);
  }
  assert.deepEqual(bad, []);
});

test('glossary: соперник, дамка, УЛЬТА, Взято, ЯРОСТЬ, «Ход назад»; «Отмена» only for dialogs', () => {
  const ru = strings(TABLES.ru);
  const offenders = (re) => ru.filter(([, s]) => re.test(s)).map(([k]) => k);
  assert.deepEqual(offenders(/противник/i), []);
  assert.deepEqual(offenders(/ультимейт/i), []);
  assert.deepEqual(offenders(/сбито/i), []);
  assert.deepEqual(offenders(/(^|[^А-Яа-яЁё])[Дд]ам(а|ой|у|ы)(?![А-Яа-яЁё])/), []); // «дама» is the Turkish word, not ours
  assert.deepEqual(offenders(/Отмена/), ['common.cancel']);
  setLang('ru');
  assert.equal(t('hud.undo'), 'Ход назад');
  assert.equal(t('hud.you'), 'Ты');
  assert.equal(t('hud.yourTurn'), 'Твой ход');
  assert.equal(t('hud.opponentTurn'), 'Ход соперника');
  assert.equal(t('hud.rage'), 'ЯРОСТЬ');
  assert.equal(t('hud.rageFull'), 'УЛЬТА ГОТОВА!');
  assert.equal(t('hud.captured'), 'Взято');
  assert.equal(t('pause.confirmResign'), 'Сдаёшься? Партия будет засчитана как поражение.');
  assert.match(t('settings.announcerDesc'), /COMBO!.*K\.O\.!.*по-английски/);
  setLang('en');
  assert.equal(t('hud.undo'), 'Take back');
  assert.equal(t('hud.rage'), 'RAGE');
  setLang('ru');
});

test('English uses Black / White, never Dark / Light for the sides', () => {
  const bad = strings(TABLES.en).filter(([k, s]) => /\bDark (moves|starts|wins)|\bLight (moves|starts|wins)/.test(s) && k);
  assert.deepEqual(bad, []);
});

test('MUX-13 wording fixes', () => {
  setLang('ru');
  assert.equal(t('title.lightning.desc'), 'Победи быстрее, чем за 30 ходов');
  assert.equal(t('settings.q.medium'), 'Среднее');
  assert.equal(t('go.r.insufficient'), 'Победить не сможет никто');
  assert.ok(!/клетк/.test(t('rules.howToText')));
});

test('no line starts with a dash: the space before every «—» is non-breaking', () => {
  for (const lang of ['ru', 'en']) {
    const bad = strings(TABLES[lang]).filter(([, s]) => / [—–]/.test(s)).map(([k]) => k);
    assert.deepEqual(bad, [], lang);
  }
});

test('controller contract keys exist in ru + en with the documented wording', () => {
  const keys = [
    'status.mustCapture',
    'status.mustCaptureMax',
    'status.mustCaptureMaxAny',
    'status.mustCaptureKings',
    'status.kingMustCapture',
    'status.capturePriority',
    'status.manCantTakeKing',
    'status.noMovesForPiece',
    'status.yourTurnCapture',
    'status.repetitionWarn',
    'status.drawSoon',
    'toast.drawDeclinedAi',
    'toast.drawAcceptedAi',
    'toast.pressBackAgain',
    'toast.hintNone',
    'toast.recovered',
    'toast.qualityLowered',
    'hud.sideName',
    'resume.offer',
    'resume.move',
  ];
  for (const k of keys) for (const lang of ['ru', 'en']) assert.ok(TABLES[lang][k], `${lang} ${k}`);
  setLang('ru');
  assert.equal(t('status.mustCaptureMax'), 'Бей максимум: эта шашка берёт меньше');
  assert.equal(t('status.mustCapture'), 'Обязательный бой!');
  assert.equal(t('status.noMovesForPiece'), 'У этой шашки нет ходов');
  assert.equal(t('status.yourTurnCapture'), 'Твой ход — бить обязательно!');
  assert.equal(t('status.repetitionWarn'), 'Позиция повторилась дважды — третий повтор = ничья');
  assert.equal(t('status.drawSoon', { n: 1 }), 'Ничья через 1\u00a0ход…');
  assert.equal(t('status.drawSoon', { n: 3 }), 'Ничья через 3\u00a0хода…');
  assert.equal(t('status.drawSoon', { n: 5 }), 'Ничья через 5\u00a0ходов…');
  assert.equal(t('toast.pressBackAgain'), 'Нажми «Назад» ещё раз, чтобы выйти');
  setLang('en');
  assert.equal(t('status.drawSoon', { n: 1 }), 'Draw in 1\u00a0move…');
  assert.equal(t('status.drawSoon', { n: 2 }), 'Draw in 2\u00a0moves…');
  setLang('ru');
});
