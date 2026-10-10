// Player-facing texts owned by the engine (variant taglines, badges, rules, giveaway paragraphs):
// terminology, typography and agreement with the rules the engine actually enforces.
import test from 'node:test';
import assert from 'node:assert/strict';
import { E } from './util.js';

function allTexts(v, lang) {
  return [v.short[lang], ...v.badges[lang], ...v.rules[lang], ...v.giveawayRules[lang]];
}

const L = '[а-яё]';

test('no line ever starts with an em dash: spaced dashes carry a non-breaking space', () => {
  for (const v of E.VARIANTS) {
    for (const lang of ['ru', 'en']) {
      for (const t of allTexts(v, lang)) assert.ok(!/ —/.test(t), `${v.id}.${lang}: "${t}"`);
    }
  }
  for (const lang of ['ru', 'en']) for (const t of E.GIVEAWAY_RULES[lang]) assert.ok(!/ —/.test(t), t);
});

test('Russian terminology: «соперник», «дамка» («дама» only in quotes), no «вы»', () => {
  for (const v of E.VARIANTS) {
    for (const t of allTexts(v, 'ru')) {
      assert.ok(!/противник/i.test(t), `${v.id}: «противник» in "${t}"`);
      const dama = new RegExp(`(^|[^а-яё])(дам(?:а|ой|ы|у|е))(?!${L})`, 'gi');
      for (const m of t.matchAll(dama)) {
        assert.equal(m[1], '«', `${v.id}: «${m[2]}» without quotes in "${t}"`);
      }
      assert.ok(!new RegExp(`(^|[^а-яё])(вы|вас|вам|ваш${L}*)(?!${L})`, 'i').test(t), `${v.id}: «вы» in "${t}"`);
    }
  }
  // MUX-07: the Turkish tagline no longer reads as a statement about the king
  const tr = E.getVariant('turkish');
  assert.ok(!/^Дама:/.test(tr.short.ru));
  assert.ok(tr.badges.ru.includes('Дамка летает'));
  assert.match(tr.rules.ru[3], /^Дамка \(по-турецки «дама»\)/);
});

test('English: Black / White consistently (no "Dark moves first" / "Dark starts")', () => {
  for (const v of E.VARIANTS) {
    for (const t of allTexts(v, 'en')) assert.ok(!/\bDark\b/.test(t), `${v.id}: "${t}"`);
  }
  for (const id of ['english', 'pool']) {
    const v = E.getVariant(id);
    assert.equal(v.first, -1);
    assert.match(v.rules.en[0], /Black moves first/);
    assert.match(v.short.en, /Black (moves first|starts)/);
  }
});

test('badges say what the rule is (RO-5)', () => {
  const cz = E.getVariant('czech');
  assert.deepEqual(cz.badges.ru, ['8×8', 'Дамка летает', 'Бить обязана дамка', 'Простые бьют вперёд']);
  assert.deepEqual(cz.badges.en, ['8×8', 'Flying kings', 'King must capture', 'Men capture forward']);
  for (const v of E.VARIANTS) {
    assert.ok(!v.badges.ru.includes('Бой только вперёд'), v.id);
    assert.ok(!v.badges.en.includes('Forward capture'), v.id);
  }
});

test('rules texts state the limits the engine enforces', () => {
  for (const v of E.VARIANTS) {
    for (const lang of ['ru', 'en']) {
      const text = v.rules[lang].join(' ');
      assert.ok(text.includes(String(v.draw.quietMoves)), `${v.id}.${lang} mentions ${v.draw.quietMoves} moves`);
    }
  }
  const pool = E.getVariant('pool');
  for (const lang of ['ru', 'en']) {
    const text = pool.rules[lang].join(' ');
    assert.ok(text.includes('13'), `pool.${lang}: 13 moves`);
    assert.ok(!/15 (своих )?ходов, иначе|within 15/.test(text), 'pool: no 15-move 3v1 rule');
    assert.match(text, lang === 'ru' ? /Правило приложения/ : /App rule/);
  }
  // app-only limits are labelled as such
  for (const id of ['italian', 'spanish', 'czech', 'turkish']) {
    assert.match(E.getVariant(id).rules.ru.join(' '), /правило приложения/i, id);
    assert.match(E.getVariant(id).rules.en.join(' '), /app rule/i, id);
  }
  // RO-7: square numbers are a notation convention, not something drawn on the board
  for (const id of ['international', 'canadian']) {
    const v = E.getVariant(id);
    assert.match(v.rules.ru[0], /Для записи партий поля нумеруют/);
    assert.match(v.rules.ru[0], /на самой доске номера не пишут/);
    assert.match(v.rules.en[0], /not marked on the board/);
  }
  // RO-8: Spanish squares
  assert.match(E.getVariant('spanish').rules.ru.join(' '), /на светлых полях/);
  // RTR-08
  const tr = E.getVariant('turkish');
  assert.match(tr.rules.ru[6], /лишил его возможности сделать ход/);
  assert.match(tr.rules.ru[3], /если путь до неё свободен/);
  const ru = E.getVariant('russian').rules.ru;
  assert.match(ru[8], /большой дороге/);
  assert.ok(!/большой дороге/.test(ru[7]), 'the main-road clause has its own paragraph');
});

test('giveaway texts per variant: the no-progress rule stays, endgame draws are off (RTR-06)', () => {
  for (const v of E.VARIANTS) {
    const g = v.giveawayRules;
    assert.ok(g && g.ru.length >= 3 && g.ru.length === g.en.length, v.id);
    assert.deepEqual(E.giveawayRules(v.id), g);
    assert.ok(g.ru[2].includes(String(v.draw.quietMoves)), `${v.id}: ${g.ru[2]}`);
    assert.ok(g.en[2].includes(String(v.draw.quietMoves)), `${v.id}: ${g.en[2]}`);
    assert.equal(/правилу приложения/.test(g.ru[2]), !!v.draw.appRule, `${v.id}: app rule labelled`);
    assert.equal(/app’s rule/.test(g.en[2]), !!v.draw.appRule, `${v.id}: app rule labelled (en)`);
    if (v.draw.appRule) assert.match(v.rules.ru.join(' '), /правило приложения/i, `${v.id}: rules page labels the app rule`);
    if (v.draw.rules.length || v.draw.oneEach) assert.equal(g.ru.length, 4, `${v.id}: says which draw rules are off`);
    else assert.equal(g.ru.length, 3, v.id);
  }
  const tr = E.getVariant('turkish').giveawayRules;
  assert.match(tr.ru[2], /50 ходов подряд без взятий и ходов простыми вперёд/);
  assert.match(tr.ru[3], /по одной шашке у каждого/);
  assert.ok(!E.getVariant('turkish').giveawayRules.ru.join(' ').includes('только дамками'), 'not the kings-only wording for Turkish');
  assert.match(E.getVariant('russian').giveawayRules.ru[2], /15 ходов подряд только дамками/);
  // the generic text no longer claims a kings-only rule for every variant
  assert.ok(!/по правилу ходов только дамками выбранного варианта/.test(E.GIVEAWAY_RULES.ru.join(' ')));
  assert.equal(E.GIVEAWAY_RULES.ru.length, E.GIVEAWAY_RULES.en.length);
});
