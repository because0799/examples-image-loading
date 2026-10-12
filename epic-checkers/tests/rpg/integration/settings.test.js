// Integration: the «Валькирии доски» settings live on the app's shared settings object and are
// persisted by src/ui/storage.js (rpgVoice, voiceVolume, rpgUltCinematic, rpgDamageNumbers).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, RPG_ULT_CINEMATICS, sanitizeSettings, loadSettings, saveSettings, MemoryStorage, detectPreset } from '../../../src/ui/storage.js';
import { ensureRpgSettings, updateRpgSettings, RPG_SETTINGS_KEY } from '../../../src/rpg/ui/settings.js';
import { ultMode, numbersOn } from '../../../src/rpg/render/timeline.js';

test('defaults: voice on at 0.9, full Ultimate cinematics, damage numbers on', () => {
  assert.equal(DEFAULT_SETTINGS.rpgVoice, true);
  assert.equal(DEFAULT_SETTINGS.voiceVolume, 0.9);
  assert.equal(DEFAULT_SETTINGS.rpgUltCinematic, 'full');
  assert.equal(DEFAULT_SETTINGS.rpgDamageNumbers, true);
  assert.deepEqual([...RPG_ULT_CINEMATICS], ['full', 'short', 'first']);
  // RPG fields are not preset-controlled: the default preset label stays 'balanced'
  assert.equal(detectPreset({ ...DEFAULT_SETTINGS, rpgVoice: false, rpgUltCinematic: 'short' }), 'balanced');
});

test('sanitize validates the RPG fields', () => {
  const s = sanitizeSettings({ rpgVoice: 'yes', voiceVolume: 7, rpgUltCinematic: 'epic', rpgDamageNumbers: 0 });
  assert.equal(s.rpgVoice, true);
  assert.equal(s.voiceVolume, 1);
  assert.equal(s.rpgUltCinematic, 'full');
  assert.equal(s.rpgDamageNumbers, true);
  const t = sanitizeSettings({ rpgVoice: false, voiceVolume: 0.333, rpgUltCinematic: 'first', rpgDamageNumbers: false });
  assert.deepEqual([t.rpgVoice, t.voiceVolume, t.rpgUltCinematic, t.rpgDamageNumbers], [false, 0.33, 'first', false]);
  assert.equal(sanitizeSettings({ voiceVolume: -2 }).voiceVolume, 0);
});

test('save / load round trip keeps them; the render module reads them', () => {
  const st = new MemoryStorage();
  const s = loadSettings(st);
  Object.assign(s, { rpgVoice: false, voiceVolume: 0.4, rpgUltCinematic: 'short', rpgDamageNumbers: false });
  assert.equal(saveSettings(s, st), true);
  const back = loadSettings(st);
  assert.deepEqual([back.rpgVoice, back.voiceVolume, back.rpgUltCinematic, back.rpgDamageNumbers], [false, 0.4, 'short', false]);
  assert.equal(ultMode(back), 'short');
  assert.equal(numbersOn(back), false);
  assert.equal(ultMode(loadSettings(new MemoryStorage())), 'full');
});

test('the RPG UI settings helpers keep the values the app storage loaded', () => {
  const st = new MemoryStorage();
  // an older build stored voice settings under the RPG key only
  st.setItem(RPG_SETTINGS_KEY, JSON.stringify({ v: 1, rpgVoice: true, voiceVolume: 0.2 }));
  const s = loadSettings(st);
  s.rpgVoice = false;
  ensureRpgSettings(s, st);
  assert.equal(s.rpgVoice, false, 'a value on the live object wins');
  updateRpgSettings(s, { voiceVolume: 0.7 }, st);
  assert.equal(s.voiceVolume, 0.7);
  assert.equal(saveSettings(s, st), true);
  assert.equal(loadSettings(st).voiceVolume, 0.7);
});
