// Game-over texts (draw reasons from result.detail, RO-3 / RTR-05 / RTR-07), EPIC stat chips
// (EAD-13 / MUX-15) and the demo name rule (MUX-18). Pure functions — no DOM needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setLang } from '../../src/ui/i18n.js';
import { drawReasonText, reasonText, epicStatBits } from '../../src/ui/overlays.js';
import { distinctNames } from '../../src/ui/hud.js';
import { stateFromString, positionResult } from '../../src/engine/index.js';

const NB = ' ';
const draw = (detail, extra = {}) => ({ winner: 0, reason: detail === 'one-each' ? 'insufficient' : 'move-limit', detail, ...extra });

test('draw reasons name the actual rule (ru)', () => {
  setLang('ru');
  assert.equal(drawReasonText(draw('repetition', { reason: 'repetition' })), 'Троекратное повторение позиции');
  assert.equal(drawReasonText(draw('agreement', { reason: 'agreement' })), 'Ничья по соглашению');
  assert.equal(drawReasonText(draw('kings-only', { limit: 15, rule: 'quiet' })), `15${NB}ходов каждой стороны только дамками и без взятий`);
  assert.equal(drawReasonText(draw('kings-only', { limit: 22, rule: 'quiet' })), `22${NB}хода каждой стороны только дамками и без взятий`);
  assert.equal(drawReasonText(draw('no-progress', { limit: 50, rule: 'quiet' })), `50${NB}ходов каждой стороны без взятий и ходов простыми вперёд`);
  assert.equal(drawReasonText(draw('endgame', { limit: 15, rule: 'r3v1' })), `Три дамки не поймали одинокую дамку за 15${NB}ходов`);
  assert.equal(drawReasonText(draw('endgame', { limit: 13, rule: 'p3v1' })), `Три дамки не поймали одинокую дамку за 13${NB}ходов`);
  assert.equal(drawReasonText(draw('endgame', { limit: 5, rule: 'f5' })), `Одинокая дамка продержалась 5${NB}ходов против превосходящих сил`);
  assert.equal(drawReasonText(draw('endgame', { limit: 16, rule: 'f16' })), `Одинокая дамка продержалась 16${NB}ходов против превосходящих сил`);
  assert.equal(drawReasonText(draw('endgame', { limit: 30, rule: 'rBalance' })), `Соотношение сил не менялось 30${NB}ходов`);
  assert.equal(drawReasonText(draw('endgame', { limit: 4, rule: 'xNew' })), `Правило эндшпиля: 4${NB}хода без результата`);
  assert.equal(drawReasonText(draw('main-diagonal', { limit: 5, rule: 'rRoad' })), `Одинокая дамка удержала большую дорогу${NB}— 5${NB}ходов`);
  assert.equal(drawReasonText(draw('one-each')), `По одной шашке у каждого${NB}— ничья по правилам турецких шашек`);
  assert.equal(drawReasonText(draw('insufficient', { reason: 'insufficient' })), 'Победить не сможет никто');
});

test('draw reasons in English', () => {
  setLang('en');
  assert.equal(drawReasonText(draw('kings-only', { limit: 15 })), `15${NB}moves by each side with kings only and no captures`);
  assert.equal(drawReasonText(draw('endgame', { limit: 1, rule: 'f5' })), `The lone king held out for 1${NB}move against superior forces`);
  assert.equal(drawReasonText(draw('one-each')), `One piece each${NB}— a draw under Turkish rules`);
  assert.equal(drawReasonText(draw('main-diagonal', { limit: 5 })), `The lone king held the main diagonal for 5${NB}moves`);
  setLang('ru');
});

test('reasonText falls back to result.reason without a detail; wins are unchanged', () => {
  setLang('ru');
  assert.equal(reasonText({ winner: 0, reason: 'move-limit' }, 'draw'), 'Слишком долго без взятий и продвижения');
  assert.equal(reasonText({ winner: 0, reason: 'insufficient' }, 'draw'), 'Победить не сможет никто');
  assert.equal(reasonText({ winner: 0, reason: 'repetition' }, 'draw'), 'Троекратное повторение позиции');
  // a detail without a limit falls back to the generic move-limit text, never to an empty line
  assert.equal(reasonText({ winner: 0, reason: 'move-limit', detail: 'endgame' }, 'draw'), 'Слишком долго без взятий и продвижения');
  assert.equal(reasonText({ winner: 1, reason: 'no-pieces', detail: 'no-pieces' }, 'win'), 'Все шашки соперника разбиты');
  assert.equal(reasonText({ winner: -1, reason: 'no-moves', detail: 'no-moves' }, 'loss'), `Твои шашки заперты${NB}— ходов нет`);
  assert.equal(reasonText({ winner: -1, reason: 'resign', detail: 'resign' }, 'loss'), 'Партия сдана');
  assert.equal(reasonText({ winner: 1, reason: 'no-pieces' }, 'win', true), `Твои шашки закончились первыми${NB}— победа в поддавках!`);
});

test('a real engine result: Turkish one piece each (RTR-07)', () => {
  setLang('ru');
  const st = stateFromString('turkish', 'w:......../......../...b..../......../...W..../......../......../........');
  const r = positionResult(st);
  assert.equal(r.detail, 'one-each');
  assert.equal(reasonText(r, 'draw'), `По одной шашке у каждого${NB}— ничья по правилам турецких шашек`);
});

test('EPIC stat chips never brag about zeros (EAD-13)', () => {
  setLang('ru');
  const txt = (bits) => bits.map((b) => b.text);
  // flawless win: captures, gold «Потерь: 0», no «Комбо ×1», no «Дамок: 0»
  const win = epicStatBits({ combo: 1, lost: 0, kings: 0, captures: 12, moves: 30 }, 'win');
  assert.deepEqual(txt(win), ['Взято: 12', 'Потерь: 0']);
  assert.equal(win[1].cls, 'is-gold');
  // a draw with nothing to brag about shows the move count
  assert.deepEqual(txt(epicStatBits({ combo: 0, lost: 0, kings: 0, captures: 0, moves: 37 }, 'draw')), ['Ходов: 37']);
  // a loss: honest numbers, combo only from ×2
  assert.deepEqual(txt(epicStatBits({ combo: 2, lost: 9, kings: 1, captures: 3, moves: 40 }, 'loss')), ['Взято: 3', 'Комбо ×2', 'Дамок: 1', 'Потерь: 9']);
  assert.deepEqual(txt(epicStatBits({ combo: 0, lost: 0, kings: 0, captures: 0, moves: 0 }, 'loss')), []);
});

test('demo fighters with the same name get the side added (MUX-18)', () => {
  setLang('ru');
  assert.deepEqual(distinctNames({ 1: 'Самурай', '-1': 'Самурай' }, 'demo'), { 1: 'Самурай белых', '-1': 'Самурай чёрных' });
  assert.deepEqual(distinctNames({ 1: 'Ученик', '-1': 'Бог шашек' }, 'demo'), { 1: 'Ученик', '-1': 'Бог шашек' });
  assert.deepEqual(distinctNames({ 1: 'Ты', '-1': 'Ты' }, 'ai'), { 1: 'Ты', '-1': 'Ты' });
  setLang('en');
  assert.deepEqual(distinctNames({ 1: 'Samurai', '-1': 'Samurai' }, 'demo'), { 1: 'White Samurai', '-1': 'Black Samurai' });
  setLang('ru');
});
