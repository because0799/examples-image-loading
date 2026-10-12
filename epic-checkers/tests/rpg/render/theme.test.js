// Battle view data (src/rpg/render/theme.js) against the game rules: every element / reaction /
// status / rarity has a look, every heroine has an Ultimate cinematic, the GDD time budgets hold.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ELEMENT_FX, ELEMENT_IDS, elementFx, REACTION_FX, STATUS_FX, STATUS_GLYPHS, visibleStatuses, RARITY_FX, rarityFx, iridescent,
  BUDGET, ULT_TIMELINE, cutInKind, ultLength, NUMBER_STYLE, formatAmount, textTimeOf, numberLifeMs, ULT_KEYS, ULT_KANJI,
  BOARD_THEMES, boardTheme, WORDS, word, mix, hex, css,
} from '../../../src/rpg/render/theme.js';
import { ULT_IMPLEMENTED } from '../../../src/rpg/render/ults.js';
import { ELEMENTS, ELEMENT_ORDER, REACTIONS, STATUSES, RARITIES, RARITY_ORDER } from '../../../src/rpg/data/rules.js';
import { HEROES } from '../../../src/rpg/data/heroes.js';

test('8 elements, each with its own colours and a distinct VFX recipe', () => {
  assert.deepEqual(ELEMENT_IDS, ELEMENT_ORDER);
  assert.equal(ELEMENT_IDS.length, 8);
  const looks = new Set();
  for (const id of ELEMENT_IDS) {
    const E = ELEMENT_FX[id];
    assert.ok(E, id);
    assert.equal(E.color, hex(ELEMENTS[id].color), `${id} colour comes from rules.js`);
    for (const k of ['hit', 'bolt', 'area', 'trail', 'num']) assert.ok(E[k] != null, `${id}.${k}`);
    looks.add(`${E.hit}|${E.bolt}|${E.area}`);
  }
  assert.equal(looks.size, 8, 'no two elements share hit + projectile + area VFX');
  assert.equal(elementFx('nope'), ELEMENT_FX.none);
});

test('every reaction has a two-colour «ИМЯ! 漢» label; every status a glyph and a colour', () => {
  for (const r of Object.values(REACTIONS)) {
    const R = REACTION_FX[r.id];
    assert.ok(R, r.id);
    assert.equal(R.colors.length, 2);
    assert.ok(R.label.ru.startsWith(r.name.ru.toUpperCase()) && R.label.ru.endsWith(r.kanji), R.label.ru);
  }
  for (const s of Object.values(STATUSES)) {
    assert.ok(STATUS_FX[s.id], s.id);
    assert.ok(STATUS_GLYPHS[s.id], `${s.id} glyph`);
  }
  // ≤ 3 icons, most important first, hidden ones skipped, duplicates merged
  const vis = visibleStatuses([{ id: 'regen' }, { id: 'shield' }, { id: 'burn' }, { id: 'stun' }, { id: 'burn' }, { id: 'inspire' }, { id: 'crown' }]);
  assert.deepEqual(vis, ['stun', 'burn', 'inspire']);
  assert.deepEqual(visibleStatuses(null), []);
});

test('rarity frames: Rare blue, Epic violet, Legendary gold, Mythic iridescent (animated)', () => {
  for (const r of RARITY_ORDER) assert.ok(RARITY_FX[r], r);
  assert.equal(RARITY_FX.mythic.sheen, true);
  assert.equal(RARITY_FX.rare.sheen, false);
  assert.ok(RARITY_FX.legendary.glow > RARITY_FX.epic.glow && RARITY_FX.epic.glow > RARITY_FX.rare.glow);
  assert.equal(rarityFx('bogus'), RARITY_FX.rare);
  const cols = new Set([0, 0.5, 1, 1.5, 2, 2.5].map(iridescent));
  assert.ok(cols.size >= 5, 'the mythic shimmer keeps changing');
  assert.equal(iridescent(0), iridescent(3), 'periodic');
});

test('Ultimate timelines fit the GDD budgets: Rare ≤ 2.5 s, Epic ≤ 3.5 s, Legendary / Mythic ≤ 4 s', () => {
  for (const r of RARITY_ORDER) {
    assert.equal(cutInKind(r), RARITIES[r].cutIn);
    assert.ok(ULT_TIMELINE[cutInKind(r)], `${r} timeline`);
    assert.ok(ultLength(r) <= BUDGET.ult[r], `${r}: ${ultLength(r)} ms > ${BUDGET.ult[r]} ms`);
  }
  assert.ok(BUDGET.ult.mythic <= 4000 && BUDGET.skill <= 1800 && BUDGET.attack <= 1200 && BUDGET.move <= 600 && BUDGET.hop <= 800);
});

test('every heroine has a hand-made Ultimate cinematic and a kanji', () => {
  assert.equal(ULT_KEYS.length, HEROES.length);
  for (const h of HEROES) {
    assert.ok(ULT_IMPLEMENTED.includes(h.id), `${h.id} has an Ultimate`);
    assert.ok(ULT_KANJI[h.id], `${h.id} kanji`);
  }
});

test('numbers: thousands with a narrow space, readable life scales with settings.textTime', () => {
  assert.equal(formatAmount(7), '7');
  assert.equal(formatAmount(854), '854');
  assert.equal(formatAmount(2854), '2 854');
  assert.equal(formatAmount(1234567), '1 234 567');
  assert.equal(formatAmount(-42.6), '43');
  assert.equal(formatAmount('x'), '0');
  assert.equal(textTimeOf(null), 1.5);
  assert.equal(textTimeOf({ textTime: 3 }), 3);
  assert.equal(textTimeOf({ textTime: 99 }), 4);
  const base = numberLifeMs({ textTime: 1 });
  assert.ok(numberLifeMs({ textTime: 3 }) > base * 2, 'slow readers get longer numbers');
  assert.ok(numberLifeMs({ textTime: 1 }, { crit: true }) > base, 'crits linger');
  assert.ok(base >= NUMBER_STYLE.popMs + NUMBER_STYLE.fadeMs + 500, 'at least half a second at full alpha');
  assert.ok(NUMBER_STYLE.maxVisible <= 6 && NUMBER_STYLE.collapseAfter === 3);
});

test('arenas, words, colour helpers', () => {
  for (const id of ['bg-dawn', 'bg-ash', 'bg-sky']) {
    const T = BOARD_THEMES[id];
    assert.ok(T && T.light.length === 2 && T.dark.length === 2, id);
    assert.ok(T.bgDim >= 0 && T.bgDim < 0.6, `${id} arena dim`);
  }
  assert.equal(boardTheme('ash').id, 'bg-ash');
  assert.equal(boardTheme(null).id, 'bg-dawn');
  for (const [k, w] of Object.entries(WORDS)) {
    assert.ok(w.ru && w.en, k);
    assert.equal(word(k, 'en'), w.en);
    assert.equal(word(k, 'ru'), w.ru);
  }
  assert.equal(word('missing', 'ru'), '');
  assert.equal(mix(0x000000, 0xffffff, 0.5), 0x808080);
  assert.equal(css(0xff00aa), '#ff00aa');
  assert.equal(hex('#00ff00'), 0x00ff00);
});
