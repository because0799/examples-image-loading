// Autosave (F8) + controller texts: round trip, validation, i18n fallbacks.

import test from 'node:test';
import assert from 'node:assert/strict';
import { writeSave, readSave, clearSave, SAVE_KEY } from '../../src/app-save.js';
import { text, FALLBACK } from '../../src/controller-text.js';
import { setLang } from '../../src/ui/i18n.js';
import { Game } from '../../src/engine/index.js';

function memStorage() {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

function played(variantId, n) {
  const g = new Game(variantId);
  for (let i = 0; i < n; i++) g.play(g.moves.find((m) => !m.captures.length) || g.moves[0]);
  return g;
}

test('round trip: the saved game comes back with the same moves and config', () => {
  const st = memStorage();
  const g = played('turkish', 6);
  const obj = writeSave({ cfg: { variantId: 'turkish', mode: 'ai', humanColor: 0, level: 4, epic: true }, humanColor: -1, game: g, elapsedSec: 93.4 }, st);
  assert.ok(obj);
  const s = readSave(st);
  assert.ok(s.game instanceof Game);
  assert.equal(s.game.history.length, 6);
  assert.deepEqual(s.game.history.map((h) => h.move.path), g.history.map((h) => h.move.path));
  assert.equal(s.cfg.level, 4);
  assert.equal(s.cfg.humanColor, 0, 'random colour kept for a rematch');
  assert.equal(s.humanColor, -1);
  assert.equal(s.elapsedSec, 93);
  assert.equal(s.cfg.epic, true);
});

test('invalid saves read as null and are removed; demos and finished games are never saved', () => {
  const st = memStorage();
  st.setItem(SAVE_KEY, '{not json');
  assert.equal(readSave(st), null);
  assert.equal(st.getItem(SAVE_KEY), null, 'removed');
  st.setItem(SAVE_KEY, JSON.stringify({ v: 1, cfg: { variantId: 'russian', mode: 'ai' }, game: { variantId: 'russian', moves: [[1, 2]] } }));
  assert.equal(readSave(st), null, 'an illegal move list');
  st.setItem(SAVE_KEY, JSON.stringify({ v: 99, cfg: {}, game: {} }));
  assert.equal(readSave(st), null, 'another version');
  const g = played('russian', 2);
  assert.equal(writeSave({ cfg: { variantId: 'russian', mode: 'demo' }, humanColor: 1, game: g }, st), null);
  g.resign(1);
  assert.equal(writeSave({ cfg: { variantId: 'russian', mode: 'ai' }, humanColor: 1, game: g }, st), null);
  const g2 = played('russian', 2);
  writeSave({ cfg: { variantId: 'russian', mode: 'pvp' }, humanColor: 1, game: g2 }, st);
  assert.ok(readSave(st));
  clearSave(st);
  assert.equal(readSave(st), null);
  // a storage that throws never breaks the game
  const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
  assert.equal(writeSave({ cfg: { variantId: 'russian', mode: 'pvp' }, humanColor: 1, game: g2 }, broken), null);
  assert.equal(readSave(broken), null);
  clearSave(broken);
});

test('controller texts: UI i18n first, fallbacks in both languages, plural countdown', () => {
  setLang('ru');
  // a key the UI table has
  assert.notEqual(text('status.mustCapture'), 'status.mustCapture');
  // fallback-only keys
  assert.equal(text('resume.ok'), FALLBACK.ru['resume.ok']);
  assert.equal(text('status.drawSoon', { n: 1 }).includes('1'), true);
  assert.equal(text('no.such.key'), 'no.such.key');
  for (const k of Object.keys(FALLBACK.ru)) assert.ok(k in FALLBACK.en, `en fallback for ${k}`);
  // glossary: informal «ты», «соперник», never «противник» / «Вы» in the fallbacks
  for (const [k, v] of Object.entries(FALLBACK.ru)) {
    const s = typeof v === 'function' ? v({ n: 2 }) : v;
    assert.ok(!/противник|\bВы\b|\bвы\b|Ваш|ваш/.test(s), `${k}: ${s}`);
  }
  setLang('en');
  assert.equal(text('resume.ok'), FALLBACK.en['resume.ok']);
  setLang('ru');
});
