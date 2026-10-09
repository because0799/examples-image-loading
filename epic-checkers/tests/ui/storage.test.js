import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  sanitizeSettings,
  StatsStore,
  MemoryStorage,
  SETTINGS_KEY,
  STATS_KEY,
  emptyStats,
} from '../../src/ui/storage.js';
import { TITLES } from '../../src/ui/titles.js';

const game = (o = {}) => ({
  variantId: 'russian',
  mode: 'ai',
  epic: false,
  result: 'win',
  level: 3,
  moves: 40,
  captures: 8,
  maxCombo: 2,
  kingsMade: 1,
  piecesLost: 3,
  durationSec: 300,
  ...o,
});

test('DEFAULT_SETTINGS has the contract defaults and is frozen', () => {
  assert.equal(DEFAULT_SETTINGS.lang, 'ru');
  assert.equal(DEFAULT_SETTINGS.sfxVolume, 0.8);
  assert.equal(DEFAULT_SETTINGS.musicVolume, 0.5);
  assert.equal(DEFAULT_SETTINGS.vibration, true);
  assert.equal(DEFAULT_SETTINGS.announcer, true);
  assert.equal(DEFAULT_SETTINGS.quality, 'high');
  assert.equal(DEFAULT_SETTINGS.showMoves, true);
  assert.equal(DEFAULT_SETTINGS.animSpeed, 1);
  assert.ok(DEFAULT_SETTINGS.lastConfig);
  assert.ok(Object.isFrozen(DEFAULT_SETTINGS));
  assert.ok(Object.isFrozen(DEFAULT_SETTINGS.lastConfig));
});

test('loadSettings returns a fresh mutable copy of defaults on empty storage', () => {
  const st = new MemoryStorage();
  const s = loadSettings(st);
  assert.deepEqual(s, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
  s.lang = 'en';
  s.lastConfig.level = 5;
  assert.equal(DEFAULT_SETTINGS.lang, 'ru');
  assert.equal(DEFAULT_SETTINGS.lastConfig.level, 3);
});

test('settings round-trip and validation', () => {
  const st = new MemoryStorage();
  const s = loadSettings(st);
  s.lang = 'en';
  s.sfxVolume = 0.3;
  s.quality = 'low';
  s.animSpeed = 1.5;
  s.lastConfig = { variantId: 'turkish', mode: 'pvp', humanColor: 0, level: 5, epic: false, giveaway: true };
  assert.ok(saveSettings(s, st));
  const back = loadSettings(st);
  assert.equal(back.lang, 'en');
  assert.equal(back.sfxVolume, 0.3);
  assert.equal(back.quality, 'low');
  assert.equal(back.animSpeed, 1.5);
  assert.deepEqual(back.lastConfig, s.lastConfig);
});

test('corrupt or hostile settings fall back field by field', () => {
  const st = new MemoryStorage({ [SETTINGS_KEY]: '{not json' });
  assert.deepEqual(loadSettings(st), sanitizeSettings(null));
  st.setItem(
    SETTINGS_KEY,
    JSON.stringify({ lang: 'de', sfxVolume: 7, musicVolume: 'loud', vibration: 'yes', quality: 'ultra', animSpeed: 3, lastConfig: { variantId: '../../x', level: 9, humanColor: 2, mode: 'online' } }),
  );
  const s = loadSettings(st);
  assert.equal(s.lang, 'ru');
  assert.equal(s.sfxVolume, 1);
  assert.equal(s.musicVolume, 0.5);
  assert.equal(s.vibration, true);
  assert.equal(s.quality, 'high');
  assert.equal(s.animSpeed, 1);
  assert.equal(s.lastConfig.variantId, 'russian');
  assert.equal(s.lastConfig.level, 3);
  assert.equal(s.lastConfig.humanColor, 1);
  assert.equal(s.lastConfig.mode, 'ai');
});

test('StatsStore records wins/losses/draws per variant and persists', () => {
  const st = new MemoryStorage();
  const s = new StatsStore({ storage: st });
  s.record(game());
  s.record(game({ result: 'loss', variantId: 'turkish' }));
  s.record(game({ result: 'draw', variantId: 'turkish' }));
  const d = new StatsStore({ storage: st }).get();
  assert.equal(d.totals.games, 3);
  assert.equal(d.totals.wins, 1);
  assert.equal(d.totals.losses, 1);
  assert.equal(d.totals.draws, 1);
  assert.deepEqual(d.perVariant.russian, { games: 1, wins: 1, losses: 0, draws: 0 });
  assert.deepEqual(d.perVariant.turkish, { games: 2, wins: 0, losses: 1, draws: 1 });
  assert.equal(d.totals.captures, 24);
  assert.equal(d.streak, 0);
});

test('first win unlocks First Blood and reports records', () => {
  const s = new StatsStore({ storage: new MemoryStorage() });
  const r = s.record(game({ maxCombo: 3, kingsMade: 2 }));
  const ids = r.newTitles.map((x) => x.id);
  assert.ok(ids.includes('first-blood'));
  assert.ok(ids.includes('triple'));
  const recIds = r.newRecords.map((x) => x.id);
  assert.ok(recIds.includes('bestCombo'));
  assert.ok(recIds.includes('mostCaptures'));
  assert.ok(recIds.includes('mostKings'));
  assert.ok(recIds.includes('fastestWin'));
  // same game again: no new titles, no new records except none
  const r2 = s.record(game({ maxCombo: 3, kingsMade: 2 }));
  assert.equal(r2.newTitles.length, 0);
  assert.ok(!r2.newRecords.some((x) => x.id === 'bestCombo'));
  assert.ok(r2.newRecords.some((x) => x.id === 'bestStreak' && x.value === 2));
});

test('flawless, combo, level 5 and giveaway titles', () => {
  const s = new StatsStore({ storage: new MemoryStorage() });
  const r = s.record(game({ piecesLost: 0, maxCombo: 5, level: 5, giveaway: true, epic: true }));
  const ids = new Set(r.newTitles.map((x) => x.id));
  for (const id of ['flawless', 'triple', 'grinder', 'hurricane', 'god', 'blade-master', 'philanthropist']) assert.ok(ids.has(id), id);
  assert.equal(s.currentTitle(), 'god');
});

test('streak titles and Turkish sultan', () => {
  const s = new StatsStore({ storage: new MemoryStorage() });
  let unlocked = [];
  for (let i = 0; i < 10; i++) unlocked.push(...s.record(game({ variantId: 'turkish' })).newTitles.map((x) => x.id));
  assert.ok(unlocked.includes('unstoppable'));
  assert.ok(unlocked.includes('legend'));
  assert.ok(unlocked.includes('sultan'));
  s.record(game({ result: 'loss' }));
  assert.equal(s.get().streak, 0);
  assert.equal(s.get().best.streak, 10);
});

test('pvp and demo games are counted separately', () => {
  const s = new StatsStore({ storage: new MemoryStorage() });
  for (let i = 0; i < 10; i++) s.record({ variantId: 'russian', mode: 'pvp', result: 'win', moves: 120 });
  for (let i = 0; i < 5; i++) s.record({ variantId: 'russian', mode: 'demo', result: 'win', moves: 30 });
  const d = s.get();
  assert.equal(d.totals.games, 0);
  assert.equal(d.pvpGames, 10);
  assert.equal(d.demoGames, 5);
  const unlocked = s.titles().filter((x) => x.unlocked).map((x) => x.id);
  assert.ok(unlocked.includes('couch'));
  assert.ok(unlocked.includes('connoisseur'));
  assert.ok(unlocked.includes('marathon'));
});

test('stats survive corrupt storage and garbage values', () => {
  const st = new MemoryStorage({ [STATS_KEY]: '][' });
  const s = new StatsStore({ storage: st });
  assert.deepEqual(s.get(), emptyStats());
  st.setItem(
    STATS_KEY,
    JSON.stringify({ v: 99, totals: { wins: -5, games: 'x', captures: 12.7 }, perVariant: { russian: { wins: 3 }, 'bad id!': {} }, titles: { god: 123, nope: 1 } }),
  );
  const s2 = new StatsStore({ storage: st });
  const d = s2.get();
  assert.equal(d.totals.wins, 0);
  assert.equal(d.totals.games, 0);
  assert.equal(d.totals.captures, 12);
  assert.deepEqual(d.perVariant.russian, { games: 0, wins: 3, losses: 0, draws: 0 });
  assert.equal(d.perVariant['bad id!'], undefined);
  assert.deepEqual(Object.keys(d.titles), ['god']);
  // recording still works
  s2.record(game());
  assert.equal(s2.get().totals.wins, 1);
});

test('record() tolerates junk summaries', () => {
  const s = new StatsStore({ storage: new MemoryStorage() });
  assert.doesNotThrow(() => s.record(null));
  assert.doesNotThrow(() => s.record({ captures: NaN, maxCombo: Infinity, moves: -3 }));
  const d = s.get();
  assert.equal(d.totals.games, 2);
  assert.equal(d.best.combo, 0);
});

test('titles() lists all titles with progress, at least 15 of them', () => {
  const s = new StatsStore({ storage: new MemoryStorage() });
  const list = s.titles();
  assert.equal(list.length, TITLES.length);
  assert.ok(list.length >= 15);
  const dm = list.find((x) => x.id === 'devourer');
  assert.deepEqual(dm.progress, [0, 100]);
  s.reset();
  assert.equal(s.unlockedCount(), 0);
  assert.equal(s.currentTitle(), null);
});
