// Profile & save: starter grant, save/load round-trip, backup rotation, corruption recovery
// (truncated / tampered / garbage / both copies bad), field-level sanitising, migrations, newer
// versions, broken storage, export / import.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ECONOMY } from '../../../src/rpg/data/rules.js';
import {
  createProfile, loadProfile, loadProfileReport, saveProfile, clearProfile, sanitizeProfile, migrateProfile,
  serializeProfile, parseStored, exportProfile, importProfile, createMemoryStorage, PROFILE_KEY, BACKUP_KEY,
  PROFILE_VERSION, summon, applyBattleResult, setSquad, completeFirstRun, levelCap,
} from '../../../src/rpg/meta/index.js';

const NOW = Date.UTC(2026, 9, 12, 9, 0, 0);

function playedProfile() {
  let p = createProfile({ seed: 31337, now: NOW });
  p = summon(p, 10, { now: NOW }).profile;
  p = applyBattleResult(p, { stageId: '1-1', mode: 'campaign', result: { winner: 1, rounds: 10 }, stats: { lost: 0, reactions: 2, ults: 1 }, now: NOW }).profile;
  p = applyBattleResult(p, { stageId: '1-2', mode: 'campaign', result: { winner: 1, rounds: 18 }, stats: { lost: 1 }, now: NOW }).profile;
  return completeFirstRun(p);
}

test('first launch: starter squad, 3 200 crystals, 5 scrolls, firstRun', () => {
  const st = createMemoryStorage();
  const rep = loadProfileReport(st, { seed: 1, now: NOW });
  assert.equal(rep.status, 'new');
  const p = rep.profile;
  assert.equal(p.v, PROFILE_VERSION);
  assert.equal(p.crystals, 3200);
  assert.equal(p.xpScrolls, 5);
  assert.equal(p.dust, 0);
  assert.equal(p.firstRun, true);
  assert.deepEqual(p.squad, ECONOMY.starterSquad);
  assert.deepEqual(Object.keys(p.heroes).sort(), ECONOMY.starterSquad.slice().sort());
  for (const e of Object.values(p.heroes)) assert.deepEqual([e.level, e.xp, e.constellation, e.copies], [1, 0, 0, 1]);
  assert.equal(levelCap(p), 10);
  assert.deepEqual(sanitizeProfile(p, { now: NOW }), p, 'a fresh profile is already sanitized');
});

test('save → load round-trip is lossless and the previous save becomes the backup', () => {
  const st = createMemoryStorage();
  const p1 = createProfile({ seed: 5, now: NOW });
  assert.equal(saveProfile(p1, st, { now: NOW }), true);
  assert.equal(st.getItem(BACKUP_KEY), null, 'no backup before the second save');
  const p2 = playedProfile();
  assert.equal(saveProfile(p2, st, { now: NOW + 1 }), true);
  const rep = loadProfileReport(st, { now: NOW + 2 });
  assert.equal(rep.status, 'ok');
  assert.deepEqual(rep.profile, { ...p2, updatedAt: NOW + 1 });
  assert.deepEqual(rep.issues, []);
  const bak = parseStored(st.getItem(BACKUP_KEY));
  assert.ok(bak && bak.checksumOk);
  assert.equal(bak.obj.crystals, p1.crystals);
  assert.equal(JSON.stringify(loadProfile(st)), JSON.stringify(rep.profile));
});

test('truncated main save falls back to the backup', () => {
  const st = createMemoryStorage();
  const older = createProfile({ seed: 5, now: NOW });
  const newer = playedProfile();
  saveProfile(older, st, { now: NOW });
  saveProfile(newer, st, { now: NOW + 1 });
  const text = st.getItem(PROFILE_KEY);
  st.setItem(PROFILE_KEY, text.slice(0, Math.floor(text.length / 2))); // torn write
  const rep = loadProfileReport(st, { now: NOW });
  assert.equal(rep.status, 'backup');
  assert.equal(rep.source, 'backup');
  assert.equal(rep.profile.crystals, older.crystals);
  assert.ok(st.getItem(PROFILE_KEY + '.corrupt'), 'unreadable text kept for diagnostics');
  // the next save does not rotate the corrupt main into the backup
  saveProfile(rep.profile, st, { now: NOW + 5 });
  assert.ok(parseStored(st.getItem(BACKUP_KEY)).checksumOk);
  assert.equal(loadProfileReport(st).status, 'ok');
});

test('checksum mismatch: backup preferred; without a backup the data is salvaged field by field', () => {
  const st = createMemoryStorage();
  const p = playedProfile();
  saveProfile(p, st, { now: NOW });
  const env = JSON.parse(st.getItem(PROFILE_KEY));
  const body = JSON.parse(env.body);
  body.crystals = 999999; // hand-edited
  env.body = JSON.stringify(body);
  st.setItem(PROFILE_KEY, JSON.stringify(env));
  const rep = loadProfileReport(st, { now: NOW });
  assert.equal(rep.status, 'salvaged');
  assert.equal(rep.profile.crystals, 999999);
  assert.ok(rep.issues.some((m) => /checksum/.test(m)));
  assert.equal(rep.profile.campaign['1-1'].stars, 3);
  // with a valid backup present the backup wins
  const st2 = createMemoryStorage();
  saveProfile(createProfile({ seed: 2, now: NOW }), st2, { now: NOW });
  saveProfile(p, st2, { now: NOW + 1 });
  st2.setItem(PROFILE_KEY, JSON.stringify(env));
  assert.equal(loadProfileReport(st2).status, 'backup');
});

test('garbage everywhere → fresh profile (reset), never throws', () => {
  for (const junk of ['{', 'null', '[]', '"str"', '42', '{"fmt":"ec.rpg","body":"{oops"}', '\u0000\u0001', '{"fmt":"ec.rpg","body":"[1,2]"}']) {
    const st = createMemoryStorage({ [PROFILE_KEY]: junk, [BACKUP_KEY]: junk });
    const rep = loadProfileReport(st, { seed: 9, now: NOW });
    assert.equal(rep.status, 'reset', junk);
    assert.equal(rep.profile.crystals, 3200);
    assert.equal(rep.profile.firstRun, true);
  }
});

test('field-level corruption is repaired by the sanitizer', () => {
  const p = playedProfile();
  const raw = JSON.parse(JSON.stringify(p));
  raw.crystals = 'lots';
  raw.dust = -50;
  raw.xpScrolls = 3.7;
  raw.heroes.akane = { level: 99, xp: -5, constellation: 12, copies: 0 };
  raw.heroes.ghost = { level: 5 };
  raw.heroes.vera = 'broken';
  delete raw.heroes.shio; // starter heroes are always owned
  raw.squad = ['akane', 'akane', 'ghost', 'vera', 42, null, 'maren', 'iskra', 'mashiro', 'shio', 'liora'];
  raw.campaign['9-9'] = { stars: 3 };
  raw.campaign['1-3'] = { stars: 7, cleared: false };
  raw.pity = { sinceEpicPlus: 50, sinceLegendaryPlus: -3, legendaryStreak: 'x', novicePulls: 400 };
  raw.history = [{ id: 'ghost' }, { id: 'akane', n: 'q', t: 5 }, 7];
  raw.daily = { day: 'yesterday', tasks: { win3: { progress: 2, claimed: 1 } } };
  raw.stats = { wins: -4, reactionKinds: { steam: 3, nope: 9 } };
  raw.formation = { akane: 999, vera: 49, maren: 48 };
  raw.presets = [{ name: 'A'.repeat(100), squad: ['vera', 'nope'] }, 'x'];
  const issues = [];
  const s = sanitizeProfile(raw, { now: NOW, issues });
  assert.equal(s.crystals, 0);
  assert.equal(s.dust, 0);
  assert.equal(s.xpScrolls, 3);
  assert.deepEqual(s.heroes.akane, { ...s.heroes.akane, level: 10, constellation: 6, copies: 1 });
  assert.ok(s.heroes.akane.xp >= 0);
  assert.equal(s.heroes.ghost, undefined);
  assert.equal(s.heroes.vera.level, 1);
  assert.ok(s.heroes.shio, 'starter restored');
  assert.deepEqual(s.squad, ['akane', 'vera', 'maren', 'iskra', 'mashiro', 'shio']);
  assert.equal(s.campaign['9-9'], undefined);
  assert.deepEqual(s.campaign['1-3'].stars, 3);
  assert.equal(s.campaign['1-3'].cleared, true);
  assert.deepEqual(
    [s.pity.sinceEpicPlus, s.pity.sinceLegendaryPlus, s.pity.legendaryStreak, s.pity.novicePulls],
    [9, 0, 0, 20],
  );
  assert.deepEqual(s.history.map((h) => h.id), ['akane']);
  assert.equal(s.daily.day, null);
  assert.deepEqual(s.daily.tasks.win3, { progress: 2, claimed: true });
  assert.equal(s.stats.wins, 0);
  assert.equal(s.stats.reactionKinds.steam, 3);
  assert.equal(s.stats.reactionKinds.nope, undefined);
  assert.deepEqual(s.formation, { vera: 49 });
  assert.equal(s.presets[0].name.length, 40);
  assert.deepEqual(s.presets[0].squad, ['vera']);
  assert.equal(s.presets[1], null);
  assert.ok(issues.length >= 3, issues.join('; '));
  // sanitizing twice is stable
  assert.deepEqual(sanitizeProfile(s, { now: NOW }), s);
});

test('levels above the current cap are clamped (cap from campaign progress)', () => {
  const p = createProfile({ seed: 1, now: NOW });
  const raw = { ...p, heroes: { ...p.heroes, akane: { level: 25, xp: 0, constellation: 0, copies: 1 } } };
  assert.equal(sanitizeProfile(raw).heroes.akane.level, 10);
  raw.campaign = { '1-B': { stars: 1, cleared: true } };
  assert.equal(sanitizeProfile(raw).heroes.akane.level, 20);
  raw.campaign['2-B'] = { stars: 2, cleared: true };
  assert.equal(sanitizeProfile(raw).heroes.akane.level, 25);
});

test('migration: an unversioned v0 profile (no envelope) is upgraded and sanitized', () => {
  const v0 = {
    crystals: 4000,
    scrolls: 7,
    stardust: 120,
    heroes: { akane: { level: 4, xp: 10, constellation: 1, copies: 2 }, reika: { level: 2, xp: 0, constellation: 0, copies: 1 } },
    squad: ['reika', 'akane'],
    campaign: { '1-1': { stars: 2, cleared: true } },
    pity: { epic: 4, legendary: 33 },
  };
  const m = migrateProfile(v0);
  assert.equal(m.from, 0);
  assert.equal(m.migrated, true);
  assert.equal(m.obj.v, PROFILE_VERSION);
  const st = createMemoryStorage({ [PROFILE_KEY]: JSON.stringify(v0) });
  const rep = loadProfileReport(st, { now: NOW });
  assert.equal(rep.status, 'migrated');
  const p = rep.profile;
  assert.equal(p.v, PROFILE_VERSION);
  assert.equal(p.xpScrolls, 7);
  assert.equal(p.dust, 120);
  assert.equal(p.pity.sinceEpicPlus, 4);
  assert.equal(p.pity.sinceLegendaryPlus, 33);
  assert.equal(p.heroes.reika.level, 2);
  assert.deepEqual(p.squad, ['reika', 'akane']);
  assert.equal(p.firstRun, false);
  // saving writes the current format
  saveProfile(p, st, { now: NOW });
  assert.equal(parseStored(st.getItem(PROFILE_KEY)).version, PROFILE_VERSION);
  assert.equal(loadProfileReport(st).status, 'ok');
});

test('a save from a newer app version is loaded best-effort and preserved', () => {
  const p = playedProfile();
  const future = { ...p, v: PROFILE_VERSION + 3, newThing: { a: 1 } };
  const text = serializeProfile(future, NOW);
  const st = createMemoryStorage({ [PROFILE_KEY]: text });
  const rep = loadProfileReport(st, { now: NOW });
  assert.equal(rep.status, 'newer');
  assert.equal(rep.profile.crystals, p.crystals);
  assert.equal(rep.profile.newThing, undefined);
  assert.equal(st.getItem(PROFILE_KEY + '.future'), text);
});

test('broken storage (throws on every call) never crashes load/save', () => {
  const bad = {
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('QuotaExceededError');
    },
    removeItem() {
      throw new Error('nope');
    },
  };
  const rep = loadProfileReport(bad, { seed: 4, now: NOW });
  assert.equal(rep.status, 'new');
  assert.equal(saveProfile(rep.profile, bad), false);
  clearProfile(bad);
  // quota exceeded on the main write keeps the previous save readable
  const st = createMemoryStorage();
  saveProfile(createProfile({ seed: 1, now: NOW }), st, { now: NOW });
  const full = { ...st, setItem: () => { throw new Error('QuotaExceededError'); } };
  assert.equal(saveProfile(playedProfile(), full), false);
  assert.equal(loadProfileReport(st).status, 'ok');
});

test('clearProfile resets to a fresh start; export / import round-trip', () => {
  const st = createMemoryStorage();
  const p = setSquad(playedProfile(), ['vera', 'akane']);
  saveProfile(p, st, { now: NOW });
  const code = exportProfile(p, NOW);
  assert.match(code, /^ECRPG1:/);
  const imp = importProfile(code, { now: NOW });
  assert.equal(imp.status, 'ok');
  assert.deepEqual(imp.profile, p);
  assert.equal(importProfile(code.slice(0, -8)), null);
  assert.equal(importProfile('hello'), null);
  clearProfile(st);
  assert.equal(loadProfileReport(st, { now: NOW }).status, 'new');
});

test('Cyrillic preset names survive export/import (UTF-8 safe)', () => {
  let p = playedProfile();
  p = sanitizeProfile({ ...p, presets: [{ name: 'Огненный строй 炎', squad: ['akane', 'vera'], formation: {} }] });
  const back = importProfile(exportProfile(p, NOW), { now: NOW });
  assert.equal(back.profile.presets[0].name, 'Огненный строй 炎');
});
