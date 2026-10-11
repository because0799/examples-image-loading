// Every i18n key the settings screen uses exists in ru + en (static keys are read from the source,
// dynamic ones are enumerated from the settings contract), and the wording rules hold for them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TABLES } from '../../src/ui/i18n.js';
import { PLAYER_COLORS, PRESET_IDS, ANIM_SPEEDS, DEFAULT_FX } from '../../src/ui/storage.js';

const SRC = fs.readFileSync(fileURLToPath(new URL('../../src/ui/screens/settings.js', import.meta.url)), 'utf8');

function usedKeys() {
  const keys = new Set();
  for (const m of SRC.matchAll(/\bt\('([a-zA-Z0-9_.-]+)'/g)) keys.add(m[1]);
  const fxKeys = Object.keys(DEFAULT_FX).filter((k) => !['shake', 'particles', 'brags', 'backdrop'].includes(k));
  for (const k of [...fxKeys, 'shake', 'particles', 'brags']) {
    keys.add(`settings.fx.${k}`);
    keys.add(`settings.fx.${k}Desc`);
  }
  for (const v of ['off', 'rare', 'normal', 'often']) keys.add(`settings.brags.${v}`);
  for (const v of ['full', 'short']) keys.add(`settings.opp.${v}`);
  for (const v of ['fast', 'normal', 'slow']) keys.add(`settings.pace.${v}`);
  for (const v of ['auto', 'high', 'medium', 'low']) keys.add(`settings.q.${v}`);
  for (const v of ['off', 'light', 'strong']) keys.add(`settings.haptics.${v}`);
  for (const v of PLAYER_COLORS) keys.add(`settings.color.${v}`);
  for (const v of [...PRESET_IDS, 'custom']) {
    keys.add(`settings.preset.${v}`);
    keys.add(`settings.preset.${v}Desc`);
  }
  for (const v of ANIM_SPEEDS) keys.add(`settings.speedName.${v}`);
  for (const v of ['profile', 'preset', 'fx', 'speed', 'graphics', 'game', 'sound', 'lang']) keys.add(`settings.jump.${v}`);
  return [...keys];
}

test('every key used by the settings screen exists in ru and en', () => {
  const keys = usedKeys();
  assert.ok(keys.length > 90, `found ${keys.length} keys`);
  for (const lang of ['ru', 'en']) {
    const missing = keys.filter((k) => !TABLES[lang][k]);
    assert.deepEqual(missing, [], lang);
  }
});

test('settings wording: the announcer shouts in English, «ты» forms, the vibration levels', () => {
  const ru = TABLES.ru;
  assert.match(ru['settings.announcer'], /диктор/);
  assert.match(ru['settings.announcerDesc'], /COMBO!.*K\.O\.!.*по-английски/);
  assert.deepEqual([ru['settings.haptics.off'], ru['settings.haptics.light'], ru['settings.haptics.strong']], ['Выкл', 'Слабая', 'Сильная']);
  assert.deepEqual([ru['settings.opp.full'], ru['settings.opp.short']], ['Полные', 'Короткие']);
  assert.deepEqual([ru['settings.pace.fast'], ru['settings.pace.normal'], ru['settings.pace.slow']], ['Быстро', 'Обычно', 'Медленно']);
  assert.deepEqual([ru['settings.q.auto'], ru['settings.q.high'], ru['settings.q.medium'], ru['settings.q.low']], ['Авто', 'Высокое', 'Среднее', 'Низкое']);
  assert.deepEqual(
    PRESET_IDS.map((id) => ru[`settings.preset.${id}`]),
    ['Максимум', 'Баланс', 'Спокойно', 'Экономия батареи'],
  );
  assert.equal(ru['settings.speedSlow'], 'Медленно');
  assert.equal(ru['settings.speedFast'], 'Быстро');
  assert.equal(ru['settings.resetSettings'], 'Сбросить настройки');
});
