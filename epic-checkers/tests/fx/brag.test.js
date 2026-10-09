// brag.js: phrase banks (ru/en), placeholders, no immediate repeats, attack names, kanji.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bragLine, bragLines, attackName, kanjiFor, allKanji, pluralRu } from '../../src/fx/brag.js';

const MAIN = ['capture', 'combo', 'promote', 'win', 'lose', 'taunt', 'brag'];

test('at least 15 lines for the main events in both languages', () => {
  for (const lang of ['ru', 'en']) {
    for (const ev of MAIN) assert.ok(bragLines(ev, lang).length >= 15, `${lang}/${ev}: ${bragLines(ev, lang).length}`);
    for (const ev of ['flawless', 'draw', 'start', 'comeback', 'ultimate', 'kingslayer', 'dead']) assert.ok(bragLines(ev, lang).length >= 3, `${lang}/${ev}`);
  }
});

test('every event yields a filled, non-empty line; unknown events fall back', () => {
  for (const lang of ['ru', 'en']) {
    for (const ev of [...MAIN, 'flawless', 'draw', 'start', 'comeback', 'ultimate', 'kingslayer', 'dead', 'nani', 'ko', 'multi', 'whatever']) {
      for (let i = 0; i < 30; i++) {
        const s = bragLine(ev, { n: 1 + (i % 9), name: 'Герой', opp: 'Сёгун' }, lang);
        assert.ok(s && s.length > 1, `${lang}/${ev}`);
        assert.ok(!/[{}]/.test(s), `unfilled placeholder: ${s}`);
      }
    }
  }
});

test('Russian plural forms', () => {
  assert.equal(pluralRu(1, ['шашка', 'шашки', 'шашек']), 'шашка');
  assert.equal(pluralRu(3, ['шашка', 'шашки', 'шашек']), 'шашки');
  assert.equal(pluralRu(5, ['шашка', 'шашки', 'шашек']), 'шашек');
  assert.equal(pluralRu(11, ['шашка', 'шашки', 'шашек']), 'шашек');
  assert.equal(pluralRu(22, ['шашка', 'шашки', 'шашек']), 'шашки');
  let hits = 0;
  for (let i = 0; i < 300; i++) {
    const s = bragLine('combo', { n: 5 }, 'ru');
    if (/шаш/.test(s)) {
      hits++;
      assert.match(s, /5 шашек/, s);
    }
  }
  assert.ok(hits > 0);
});

test('no immediate repeats', () => {
  for (const ev of MAIN) {
    let prev = null;
    for (let i = 0; i < 60; i++) {
      const s = bragLine(ev, { n: 2 }, 'ru');
      assert.notEqual(s, prev, `${ev} repeated: ${s}`);
      prev = s;
    }
  }
});

test('attack names: non-empty, varied, numbers match the combo, ultimate gets a technique prefix', () => {
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    for (const lang of ['ru', 'en']) {
      const n = 2 + (i % 8);
      const name = attackName({ n, side: i % 2 ? 1 : -1, king: i % 3 === 0 }, lang);
      assert.ok(name.length > 6 && !name.includes('undefined'), name);
      seen.add(name);
    }
  }
  assert.ok(seen.size > 150, `only ${seen.size} distinct names`);
  for (let i = 0; i < 20; i++) assert.ok(attackName({ n: 3, ultimate: true }, 'ru').includes(':'));
  // a three-hit combo can produce «… Трёх …»
  let three = false;
  for (let i = 0; i < 200 && !three; i++) three = /Трёх/.test(attackName({ n: 3 }, 'ru'));
  assert.ok(three);
});

test('Russian adjectives agree with the noun gender', () => {
  const fem = ['Буря', 'Молния', 'Комета', 'Кара', 'Ярость', 'Атака', 'Казнь', 'Волна', 'Гроза'];
  const neu = ['Пламя', 'Сияние', 'Возмездие', 'Сокрушение', 'Затмение', 'Цунами'];
  for (let i = 0; i < 2000; i++) {
    const name = attackName({ n: 1, side: i % 2 ? 1 : -1 }, 'ru').replace(/^[^:]+: /, '');
    const words = name.split(' ');
    if (words.length !== 3) continue;
    const [a, b, noun] = words;
    if (fem.includes(noun)) {
      assert.match(a, /(ая|яя)$/, name);
      assert.match(b, /(ая|ья|яя)$/, name);
    } else if (neu.includes(noun)) {
      assert.match(a, /(ое|ее)$/, name);
      assert.match(b, /(ое|ье|ее)$/, name);
    }
  }
});

test('kanji per event', () => {
  assert.equal(kanjiFor('promote'), '覚醒');
  assert.equal(kanjiFor('ultimate'), '必殺');
  assert.equal(kanjiFor('win'), '勝利');
  assert.equal(kanjiFor('start'), '対決');
  assert.equal(kanjiFor('draw'), '引き分け');
  for (let i = 0; i < 30; i++) assert.ok(['斬!', '撃!', 'ドン!', '破!', 'БАХ!', 'ХРЯСЬ!', 'БАМ!'].includes(kanjiFor('capture', 'ru')));
  assert.ok(allKanji().includes('何?!'));
});
