import test from 'node:test';
import assert from 'node:assert/strict';
import { describeEvents } from '../../../src/rpg/ui/battle-log.js';
import { setLang } from '../../../src/ui/i18n.js';

const state = {
  side: 1,
  round: 5,
  units: [
    { id: 'u1', heroId: 'akane', side: 1, hp: 900, maxHp: 1000 },
    { id: 'u2', heroId: 'mizuha', side: 1, hp: 900, maxHp: 1000 },
    { id: 'e1', heroId: 'volta', side: -1, hp: 0, maxHp: 988, alive: false },
    { id: 'e2', heroId: 'mashiro', side: -1, hp: 300, maxHp: 900 },
    { id: 'e3', heroId: 'torvald', side: -1, hp: 300, maxHp: 900 },
  ],
};

test('a jump chain with a reaction, KO and awakening', () => {
  setLang('ru');
  const lines = describeEvents(
    [
      { type: 'jump', unit: 'u1', from: 1, to: 2, over: 'e1' },
      { type: 'damage', source: 'u1', target: 'e1', amount: 991, crit: false, element: 'flame', reaction: 'steam' },
      { type: 'reaction', target: 'e1', reaction: 'steam', elements: ['flame', 'tide'] },
      { type: 'ko', unit: 'e1' },
      { type: 'jump', unit: 'u1', from: 2, to: 3, over: 'e2' },
      { type: 'damage', source: 'u1', target: 'e2', amount: 420, crit: true, element: 'flame' },
      { type: 'awaken', unit: 'u1' },
      { type: 'energy', unit: 'u1', value: 70, max: 70 },
    ],
    { state, playerSide: 1 },
  );
  const tones = lines.map((l) => l.tone);
  assert.deepEqual(tones, ['cast', 'reaction', 'ko', 'awaken', 'damage']);
  assert.match(lines[0].text, /Аканэ: цепочка ×2/);
  assert.match(lines.find((l) => l.tone === 'reaction').text, /ПАР! 蒸 — Вольта/);
  assert.match(lines.find((l) => l.tone === 'ko').text, /撃破 Вольта выбита!/);
  assert.match(lines.find((l) => l.tone === 'damage').text, /Вольта −991 · Масиро −420 КРИТ/);
  assert.ok(lines.every((l) => l.mine));
});

test('ultimate headline names the ability; heals are summed; male KO wording', () => {
  setLang('ru');
  const lines = describeEvents(
    [
      { type: 'cast', unit: 'u2', kind: 'ult', abilityId: 'x' },
      { type: 'heal', source: 'u2', target: 'u1', amount: 100 },
      { type: 'heal', source: 'u2', target: 'u1', amount: 50 },
      { type: 'ko', unit: 'e3' },
    ],
    { state, playerSide: -1 },
  );
  assert.match(lines[0].text, /^Мидзуха: Вспышка «/);
  assert.equal(lines[0].tone, 'ult');
  assert.match(lines.find((l) => l.tone === 'ko').text, /Торвальд выбит!/);
  assert.match(lines.find((l) => l.tone === 'heal').text, /Аканэ \+150/);
  assert.equal(lines[0].mine, false);
});

test('unknown events and missing units are tolerated', () => {
  setLang('en');
  const lines = describeEvents([{ type: 'nope' }, null, { type: 'damage', target: 'zz', amount: 5 }], { state: null });
  assert.equal(lines.length, 1);
  assert.match(lines[0].text, /zz −5/);
  setLang('ru');
});
