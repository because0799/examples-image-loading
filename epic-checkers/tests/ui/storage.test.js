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
  DEFAULT_FX,
  PRESETS,
  PRESET_IDS,
  presetPatch,
  detectPreset,
  hapticPattern,
  cleanPlayerName,
  migrateSettings,
  ENERGY_COLORS,
  PLAYER_COLORS,
  QUALITY_AUTO_KEY,
  SETTINGS_VERSION,
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
  const d = DEFAULT_SETTINGS;
  assert.equal(d.lang, 'ru');
  assert.equal(d.sfxVolume, 0.8);
  assert.equal(d.musicVolume, 0.5);
  assert.equal(d.announcer, true);
  assert.equal(d.haptics, 'strong');
  assert.equal(d.vibration, true);
  assert.equal(d.quality, 'auto');
  assert.equal(d.battery, false);
  assert.equal(d.animSpeed, 1);
  assert.equal(d.textTime, 1.5);
  assert.equal(d.opponentFx, 'full');
  assert.equal(d.aiPace, 'normal');
  assert.equal(d.showMoves, true);
  assert.equal(d.showLastMove, true);
  assert.equal(d.showCoords, true);
  assert.equal(d.playerName, '');
  assert.equal(d.playerColor, 'auto');
  assert.equal(d.preset, 'balanced');
  assert.deepEqual(
    { ...d.fx },
    {
      shake: 1,
      flashes: true,
      slowmo: true,
      camera: true,
      cutins: true,
      kanji: true,
      brags: 'normal',
      turnBanners: true,
      combo: true,
      particles: 1,
      auras: true,
      backdrop: true,
      vsIntro: true,
    },
  );
  assert.ok(d.lastConfig);
  assert.ok(Object.isFrozen(d));
  assert.ok(Object.isFrozen(d.lastConfig));
  assert.ok(Object.isFrozen(d.fx));
  assert.deepEqual(Object.keys(ENERGY_COLORS), ['cyan', 'gold', 'green', 'violet', 'orange', 'pink']);
  assert.equal(ENERGY_COLORS.cyan, '#29E6FF');
  assert.equal(ENERGY_COLORS.pink, '#FF4FD8');
  assert.deepEqual([...PLAYER_COLORS], ['auto', 'cyan', 'gold', 'green', 'violet', 'orange', 'pink']);
});

test('loadSettings returns a fresh mutable copy of defaults on empty storage', () => {
  const st = new MemoryStorage();
  const s = loadSettings(st);
  assert.deepEqual(s, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
  s.lang = 'en';
  s.lastConfig.level = 5;
  s.fx.shake = 0;
  assert.equal(DEFAULT_SETTINGS.lang, 'ru');
  assert.equal(DEFAULT_SETTINGS.fx.shake, 1);
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
  // demo fighter levels default to the single level of older saved configs
  assert.deepEqual(back.lastConfig, { ...s.lastConfig, levelWhite: 5, levelBlack: 5 });
});

test('demo fighter levels (levelWhite / levelBlack) round-trip and are validated', () => {
  const st = new MemoryStorage();
  const s = loadSettings(st);
  assert.equal(s.lastConfig.levelWhite, 3);
  assert.equal(s.lastConfig.levelBlack, 3);
  s.lastConfig = { ...s.lastConfig, mode: 'demo', level: 2, levelWhite: 1, levelBlack: 5 };
  saveSettings(s, st);
  const back = loadSettings(st);
  assert.equal(back.lastConfig.levelWhite, 1);
  assert.equal(back.lastConfig.levelBlack, 5);
  assert.equal(back.lastConfig.level, 2);
  st.setItem(SETTINGS_KEY, JSON.stringify({ lastConfig: { level: 4, levelWhite: 9, levelBlack: 'x' } }));
  const bad = loadSettings(st);
  assert.equal(bad.lastConfig.levelWhite, 4);
  assert.equal(bad.lastConfig.levelBlack, 4);
});

test('corrupt or hostile settings fall back field by field', () => {
  const st = new MemoryStorage({ [SETTINGS_KEY]: '{not json' });
  assert.deepEqual(loadSettings(st), sanitizeSettings(null));
  st.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      v: SETTINGS_VERSION,
      lang: 'de',
      sfxVolume: 7,
      musicVolume: 'loud',
      haptics: 'max',
      vibration: 'yes',
      quality: 'ultra',
      battery: 1,
      animSpeed: 'fast',
      textTime: null,
      opponentFx: 'none',
      aiPace: 9,
      showCoords: 'no',
      playerName: { evil: true },
      playerColor: '#fff',
      preset: 'godmode',
      fx: { shake: 99, flashes: 'off', brags: 'always', particles: -3, vsIntro: 0 },
      lastConfig: { variantId: '../../x', level: 9, humanColor: 2, mode: 'online' },
    }),
  );
  const s = loadSettings(st);
  assert.equal(s.lang, 'ru');
  assert.equal(s.sfxVolume, 1);
  assert.equal(s.musicVolume, 0.5);
  assert.equal(s.haptics, 'strong');
  assert.equal(s.vibration, true);
  assert.equal(s.quality, 'auto');
  assert.equal(s.battery, false);
  assert.equal(s.animSpeed, 1);
  assert.equal(s.textTime, 1.5);
  assert.equal(s.opponentFx, 'full');
  assert.equal(s.aiPace, 'normal');
  assert.equal(s.showCoords, true);
  assert.equal(s.playerName, '');
  assert.equal(s.playerColor, 'auto');
  assert.equal(s.fx.shake, 1.5, 'clamped to the range');
  assert.equal(s.fx.particles, 0.25, 'clamped to the range');
  assert.equal(s.fx.flashes, true);
  assert.equal(s.fx.brags, 'normal');
  assert.equal(s.fx.vsIntro, true);
  assert.equal(s.preset, 'custom', 'the label follows the actual values');
  assert.equal(s.lastConfig.variantId, 'russian');
  assert.equal(s.lastConfig.level, 3);
  assert.equal(s.lastConfig.humanColor, 1);
  assert.equal(s.lastConfig.mode, 'ai');
});

test('old (v1) saves migrate: vibration -> haptics, old default quality -> auto, animSpeed kept', () => {
  const v1 = { lang: 'en', sfxVolume: 0.4, musicVolume: 0.2, vibration: false, announcer: false, quality: 'high', showMoves: false, animSpeed: 2 };
  const st = new MemoryStorage({ [SETTINGS_KEY]: JSON.stringify(v1) });
  const s = loadSettings(st);
  assert.equal(s.haptics, 'off');
  assert.equal(s.vibration, false);
  assert.equal(s.quality, 'auto', "'high' was the old default, not a choice");
  assert.equal(s.animSpeed, 2);
  assert.equal(s.textTime, 1.5);
  assert.equal(s.lang, 'en');
  assert.equal(s.showMoves, false);
  assert.equal(s.announcer, false);
  assert.deepEqual(s.fx, { ...DEFAULT_FX });
  assert.equal(s.preset, 'custom', 'animSpeed 2 is not a preset value');
  // vibration: true -> strong
  st.setItem(SETTINGS_KEY, JSON.stringify({ vibration: true }));
  assert.equal(loadSettings(st).haptics, 'strong');
  // a quality the user picked stays; one the app picked (quality-auto key) becomes auto
  st.setItem(SETTINGS_KEY, JSON.stringify({ quality: 'low' }));
  assert.equal(loadSettings(st).quality, 'low');
  st.setItem(SETTINGS_KEY, JSON.stringify({ quality: 'medium' }));
  st.setItem(QUALITY_AUTO_KEY, 'medium');
  assert.equal(loadSettings(st).quality, 'auto');
  // in-between speeds snap to the nearest option
  st.setItem(SETTINGS_KEY, JSON.stringify({ animSpeed: 1.4, textTime: 2.6 }));
  const snapped = loadSettings(st);
  assert.equal(snapped.animSpeed, 1.5);
  assert.equal(snapped.textTime, 3);
  // saved v2 files are not migrated again: an explicit 'high' stays 'high'
  const s2 = loadSettings(new MemoryStorage());
  s2.quality = 'high';
  const st2 = new MemoryStorage();
  saveSettings(s2, st2);
  assert.equal(JSON.parse(st2.getItem(SETTINGS_KEY)).v, SETTINGS_VERSION);
  assert.equal(loadSettings(st2).quality, 'high');
  assert.ok(!('v' in loadSettings(st2)), 'the live object carries no version field');
  assert.equal(migrateSettings(null), null);
});

test('haptics and the legacy vibration flag stay in sync', () => {
  assert.equal(sanitizeSettings({ haptics: 'off' }).vibration, false);
  assert.equal(sanitizeSettings({ haptics: 'light' }).vibration, true);
  assert.equal(sanitizeSettings({ haptics: 'light', vibration: false }).haptics, 'light', 'haptics wins');
  assert.equal(sanitizeSettings({ vibration: false }).haptics, 'off');
});

test('presets: every preset is complete, detectable and matches the contract', () => {
  assert.deepEqual([...PRESET_IDS], ['max', 'balanced', 'calm', 'battery']);
  for (const id of PRESET_IDS) {
    const patch = presetPatch(id);
    assert.deepEqual(Object.keys(patch.fx).sort(), Object.keys(DEFAULT_FX).sort(), id);
    const s = sanitizeSettings({ ...DEFAULT_SETTINGS, ...patch });
    assert.equal(s.preset, id);
    assert.equal(detectPreset(s), id);
    // the patch is a fresh object
    patch.fx.shake = 0.1;
    assert.notEqual(PRESETS[id].fx.shake, 0.1);
  }
  assert.equal(presetPatch('nope'), null);
  // balanced = defaults
  assert.equal(detectPreset(DEFAULT_SETTINGS), 'balanced');
  const max = PRESETS.max;
  assert.equal(max.textTime, 2);
  assert.equal(max.fx.shake, 1.3);
  assert.equal(max.fx.particles, 1.5);
  assert.equal(max.fx.brags, 'often');
  for (const k of ['flashes', 'slowmo', 'camera', 'cutins', 'kanji', 'turnBanners', 'combo', 'auras', 'backdrop', 'vsIntro']) assert.equal(max.fx[k], true, k);
  const calm = PRESETS.calm;
  assert.deepEqual(
    [calm.textTime, calm.animSpeed, calm.fx.shake, calm.fx.flashes, calm.fx.slowmo, calm.fx.turnBanners, calm.fx.particles, calm.fx.brags],
    [2, 0.75, 0.4, false, false, false, 0.6, 'rare'],
  );
  const bat = PRESETS.battery;
  assert.deepEqual(
    [bat.quality, bat.battery, bat.fx.backdrop, bat.fx.particles, bat.fx.auras, bat.fx.flashes, bat.fx.shake],
    ['low', true, false, 0.4, false, false, 0.6],
  );
  // changing any controlled field turns the label into 'custom'; changing it back restores it
  const s = sanitizeSettings({ ...DEFAULT_SETTINGS, ...presetPatch('calm') });
  s.fx.kanji = false;
  assert.equal(detectPreset(s), 'custom');
  s.fx.kanji = true;
  assert.equal(detectPreset(s), 'calm');
  s.textTime = 3;
  assert.equal(detectPreset(s), 'custom');
  // non-preset fields do not matter
  const b = sanitizeSettings({ playerName: 'Макс', playerColor: 'gold', haptics: 'off', lang: 'en', showCoords: false });
  assert.equal(b.preset, 'balanced');
});

test('player name is cleaned and limited to 16 characters', () => {
  assert.equal(cleanPlayerName('  Макс  '), 'Макс');
  assert.equal(cleanPlayerName('a\u0000b\nc\u202Ed'), 'ab cd');
  assert.equal(cleanPlayerName('Очень-очень длинное имя игрока'), 'Очень-очень длин');
  assert.equal(Array.from(cleanPlayerName('🔥'.repeat(20))).length, 16);
  assert.equal(cleanPlayerName(42), '');
  assert.equal(sanitizeSettings({ playerName: '   ' }).playerName, '');
});

test('hapticPattern: off -> null, light shortens pulses, strong keeps them', () => {
  assert.equal(hapticPattern(30, 'off'), null);
  assert.equal(hapticPattern(30, 'strong'), 30);
  assert.ok(hapticPattern(30, 'light') < 30);
  assert.ok(hapticPattern(6, 'light') >= 4);
  assert.deepEqual(hapticPattern([30, 40, 60], 'strong'), [30, 40, 60]);
  const l = hapticPattern([30, 40, 60], 'light');
  assert.equal(l[1], 40, 'pauses are kept');
  assert.ok(l[0] < 30 && l[2] <= 28);
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

test('first win unlocks First Blood; records are reported only when an earlier one is beaten', () => {
  const s = new StatsStore({ storage: new MemoryStorage() });
  const r = s.record(game({ maxCombo: 3, kingsMade: 2 }));
  const ids = r.newTitles.map((x) => x.id);
  assert.ok(ids.includes('first-blood'));
  assert.ok(ids.includes('triple'));
  // MUX-15: the very first game only sets the baselines (no «НОВЫЙ РЕКОРД» on game one)
  assert.deepEqual(r.newRecords, []);
  // same game again: no new titles, no records except the 2-win streak
  const r2 = s.record(game({ maxCombo: 3, kingsMade: 2 }));
  assert.equal(r2.newTitles.length, 0);
  assert.ok(!r2.newRecords.some((x) => x.id === 'bestCombo'));
  assert.ok(r2.newRecords.some((x) => x.id === 'bestStreak' && x.value === 2));
  // a better game beats every baseline
  const base = s.get().best;
  const r3 = s.record(game({ maxCombo: 4, kingsMade: 3, captures: base.captures + 2, moves: base.fastestWin - 5 }));
  const recIds = r3.newRecords.map((x) => x.id);
  for (const id of ['bestCombo', 'mostCaptures', 'mostKings', 'fastestWin', 'bestStreak']) assert.ok(recIds.includes(id), id);
  const combo = r3.newRecords.find((x) => x.id === 'bestCombo');
  assert.deepEqual([combo.value, combo.prev], [4, 3]);
});

test('records on a loss are stored (shown later) but a first loss reports none', () => {
  const s = new StatsStore({ storage: new MemoryStorage() });
  const r = s.record(game({ result: 'loss', maxCombo: 2, captures: 5 }));
  assert.deepEqual(r.newRecords, []);
  assert.equal(s.get().best.captures, 5);
  assert.equal(s.get().best.combo, 2);
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
