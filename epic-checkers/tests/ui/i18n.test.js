import test from 'node:test';
import assert from 'node:assert/strict';
import { TABLES, t, tl, setLang, getLang, pluralCategory, loc, pick } from '../../src/ui/i18n.js';
import { TITLES } from '../../src/ui/titles.js';

test('ru and en tables have exactly the same keys and value shapes', () => {
  const ru = TABLES.ru;
  const en = TABLES.en;
  const missingEn = Object.keys(ru).filter((k) => !(k in en));
  const missingRu = Object.keys(en).filter((k) => !(k in ru));
  assert.deepEqual(missingEn, [], 'keys missing in en');
  assert.deepEqual(missingRu, [], 'keys missing in ru');
  for (const k of Object.keys(ru)) {
    const a = ru[k];
    const b = en[k];
    assert.equal(Array.isArray(a), Array.isArray(b), `shape of ${k}`);
    assert.equal(typeof a, typeof b, `type of ${k}`);
    if (typeof a === 'string') {
      const pa = (a.match(/\{\w+\}/g) || []).sort().join();
      const pb = (b.match(/\{\w+\}/g) || []).sort().join();
      assert.equal(pa, pb, `placeholders of ${k}`);
      assert.ok(a.length && b.length, `empty ${k}`);
    }
  }
});

test('every title has a name and description in both languages', () => {
  for (const x of TITLES) {
    for (const lang of ['ru', 'en']) {
      assert.ok(TABLES[lang][`title.${x.id}.name`], `${lang} name ${x.id}`);
      assert.ok(TABLES[lang][`title.${x.id}.desc`], `${lang} desc ${x.id}`);
    }
  }
});

test('AI level names (normal + epic) exist', () => {
  setLang('ru');
  assert.equal(t('level.1'), 'Новичок');
  assert.equal(t('level.5'), 'Гроссмейстер');
  assert.equal(t('levelEpic.3'), 'Самурай');
  assert.equal(t('levelEpic.5'), 'Бог шашек');
  setLang('en');
  assert.equal(t('level.4'), 'Master');
  assert.equal(t('levelEpic.4'), 'Shogun');
  assert.equal(t('levelEpic.5'), 'God of Draughts');
  setLang('ru');
});

test('Russian plurals', () => {
  assert.equal(pluralCategory(1, 'ru'), 'one');
  assert.equal(pluralCategory(2, 'ru'), 'few');
  assert.equal(pluralCategory(5, 'ru'), 'many');
  assert.equal(pluralCategory(11, 'ru'), 'many');
  assert.equal(pluralCategory(21, 'ru'), 'one');
  assert.equal(pluralCategory(112, 'ru'), 'many');
  assert.equal(pluralCategory(23, 'ru'), 'few');
  setLang('ru');
  assert.equal(t('common.pieces', { n: 1 }), '1 шашка');
  assert.equal(t('common.pieces', { n: 3 }), '3 шашки');
  assert.equal(t('common.pieces', { n: 12 }), '12 шашек');
  assert.equal(t('setup.perSide', { n: 16 }), 'по 16 шашек');
  setLang('en');
  assert.equal(t('common.pieces', { n: 1 }), '1 piece');
  assert.equal(t('common.pieces', { n: 20 }), '20 pieces');
  setLang('ru');
});

test('interpolation, fallbacks, lists, loc', () => {
  setLang('ru');
  assert.equal(getLang(), 'ru');
  assert.equal(t('pause.drawOffer', { side: 'Белые', other: 'Чёрные' }), 'Белые предлагают ничью. Чёрные, принимаете?');
  assert.equal(t('no.such.key'), 'no.such.key');
  setLang('xx');
  assert.equal(getLang(), 'ru');
  assert.ok(tl('rules.howToText').length >= 4);
  assert.ok(tl('go.brag.win').includes(pick('go.brag.win', 2)));
  assert.equal(loc({ ru: 'а', en: 'b' }), 'а');
  setLang('en');
  assert.equal(loc({ ru: 'а', en: 'b' }), 'b');
  assert.equal(loc('plain'), 'plain');
  setLang('ru');
});
