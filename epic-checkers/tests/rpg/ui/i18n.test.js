import test from 'node:test';
import assert from 'node:assert/strict';
import { RPG_TABLES, rt, rtList, fmt, L } from '../../../src/rpg/ui/i18n.js';
import { setLang } from '../../../src/ui/i18n.js';

function shape(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !('one' in v)) out.push(...shape(v, key));
    else out.push(key);
  }
  return out.sort();
}

test('ru and en tables have the same keys', () => {
  assert.deepEqual(shape(RPG_TABLES.en), shape(RPG_TABLES.ru));
});

test('no empty strings', () => {
  for (const lang of ['ru', 'en']) {
    for (const key of shape(RPG_TABLES[lang])) {
      let v = RPG_TABLES[lang];
      for (const p of key.split('.')) v = v[p];
      if (typeof v === 'string') assert.ok(v.trim().length > 0, `${lang}:${key}`);
    }
  }
});

test('rt: interpolation, plurals, fallbacks', () => {
  setLang('ru');
  assert.equal(rt('summon.toEpic', { n: 7 }), 'До Эпической+: 7');
  assert.equal(rt('common.heroes', { n: 1 }), '1 героиня');
  assert.equal(rt('common.heroes', { n: 3 }), '3 героини');
  assert.equal(rt('common.heroes', { n: 5 }), '5 героинь');
  assert.equal(rt('common.heroes', { n: 21 }), '21 героиня');
  assert.equal(rt('no.such.key'), 'no.such.key');
  assert.equal(rtList('summon.pityText').length, 5);
  setLang('en');
  assert.equal(rt('common.heroes', { n: 1 }), '1 hero');
  assert.equal(rt('common.heroes', { n: 2 }), '2 heroes');
  assert.equal(L({ ru: 'Пламя', en: 'Flame' }), 'Flame');
  setLang('ru');
  assert.equal(L({ ru: 'Пламя', en: 'Flame' }), 'Пламя');
});

test('fmt groups thousands', () => {
  assert.equal(fmt(3200), '3 200');
  assert.equal(fmt(160), '160');
  assert.equal(fmt(1234567), '1 234 567');
  assert.equal(fmt(-1500), '−1 500');
});

test('every literal rt() key used by the RPG UI exists in ru and en', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../src/rpg/ui');
  const files = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.js')) files.push(p);
    }
  };
  walk(root);
  const keys = new Set();
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\brt(?:List)?\(\s*'([a-zA-Z0-9_.-]+)'/g)) keys.add(m[1]);
  }
  assert.ok(keys.size > 100, `found ${keys.size} keys`);
  const get = (t, k) => k.split('.').reduce((v, p) => (v == null ? v : v[p]), t);
  for (const k of keys) {
    assert.notEqual(get(RPG_TABLES.ru, k), undefined, `ru:${k}`);
    assert.notEqual(get(RPG_TABLES.en, k), undefined, `en:${k}`);
  }
});

test('templated key families are complete', () => {
  const get = (t, k) => k.split('.').reduce((v, p) => (v == null ? v : v[p]), t);
  const fams = {
    rarity: ['rare', 'epic', 'legendary', 'mythic'],
    stat: ['hp', 'atk', 'def', 'crit', 'aff'],
    statShort: ['hp', 'atk', 'def', 'crit', 'aff'],
    difficulty: ['easy', 'normal', 'hard'],
    'collection.sort': ['rarity', 'level', 'power', 'name'],
    'training.kind': ['random', 'chapter', 'mirror'],
    bg: ['bg-dawn', 'bg-ash', 'bg-sky'],
    'battle.actions': ['move', 'attack', 'skill', 'ult', 'quirk', 'wait', 'end'],
    'hero.tabs': ['overview', 'skills', 'constellation', 'voice'],
    'campaign.tutorial': ['basics', 'reactions', 'chains', 'taunt', 'awakening', 'portals'],
    'campaign.rules': ['presetFormation', 'altWinAwaken', 'enemyFirst', 'reactionBoost', 'elementBoost', 'sealDuration', 'removeFiles', 'escort', 'eruptionEvery', 'mirror'],
    'battle.log': ['cast', 'ult', 'jump', 'reaction', 'ko', 'koM', 'awaken', 'wait', 'crit', 'heal', 'crownLost', 'revive', 'survive', 'extra'],
    results: ['victory', 'defeat', 'draw'],
  };
  for (const lang of ['ru', 'en']) {
    for (const [base, ids] of Object.entries(fams)) {
      for (const id of ids) assert.notEqual(get(RPG_TABLES[lang], `${base}.${id}`), undefined, `${lang}:${base}.${id}`);
    }
  }
});
