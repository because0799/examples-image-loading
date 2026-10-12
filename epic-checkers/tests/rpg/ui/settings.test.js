import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureRpgSettings, updateRpgSettings, loadRpgSettings, sanitizeRpgSettings, RPG_SETTINGS_KEY } from '../../../src/rpg/ui/settings.js';
import { MemoryStorage } from '../../../src/ui/storage.js';

test('defaults and validation', () => {
  assert.deepEqual(sanitizeRpgSettings(null), { rpgVoice: true, voiceVolume: 0.9 });
  assert.deepEqual(sanitizeRpgSettings({ rpgVoice: 'yes', voiceVolume: 7 }), { rpgVoice: true, voiceVolume: 1 });
  assert.deepEqual(sanitizeRpgSettings({ rpgVoice: false, voiceVolume: -1 }), { rpgVoice: false, voiceVolume: 0 });
});

test('ensure fills missing fields from storage and keeps the live object identity', () => {
  const storage = new MemoryStorage();
  storage.setItem(RPG_SETTINGS_KEY, JSON.stringify({ v: 1, rpgVoice: false, voiceVolume: 0.4 }));
  const live = { lang: 'ru', sfxVolume: 0.8 };
  const same = ensureRpgSettings(live, storage);
  assert.equal(same, live);
  assert.equal(live.rpgVoice, false);
  assert.equal(live.voiceVolume, 0.4);
  assert.equal(live.sfxVolume, 0.8);
  // present values win
  const live2 = { rpgVoice: true };
  ensureRpgSettings(live2, storage);
  assert.equal(live2.rpgVoice, true);
  assert.equal(live2.voiceVolume, 0.4);
});

test('update persists; live drag does not', () => {
  const storage = new MemoryStorage();
  const live = {};
  ensureRpgSettings(live, storage);
  updateRpgSettings(live, { voiceVolume: 0.5, sfxVolume: 0.1 }, storage, { live: true });
  assert.equal(live.voiceVolume, 0.5);
  assert.equal(live.sfxVolume, undefined, 'only RPG fields are touched');
  assert.equal(loadRpgSettings(storage).voiceVolume, 0.9);
  updateRpgSettings(live, { rpgVoice: false }, storage);
  assert.deepEqual(loadRpgSettings(storage), { rpgVoice: false, voiceVolume: 0.5 });
});

test('broken storage never throws', () => {
  const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
  assert.deepEqual(loadRpgSettings(bad), { rpgVoice: true, voiceVolume: 0.9 });
  const live = {};
  ensureRpgSettings(live, bad);
  assert.equal(live.rpgVoice, true);
  updateRpgSettings(live, { rpgVoice: false }, bad);
  assert.equal(live.rpgVoice, false);
});
