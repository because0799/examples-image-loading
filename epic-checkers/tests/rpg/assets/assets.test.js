// RPG_ASSETS URLs + the shipped files produced by tools/rpg-assets.py (web/static/rpg/**) + crops.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { RPG_ASSETS, setRpgAssetBase, rpgAssetBase, DEFAULT_FOCAL, RPG_BG_IDS, RPG_VOICE_EVENTS, hasVoice, voiceEventName } from '../../../src/rpg/assets.js';
import { HEROES } from '../../../src/rpg/data/heroes.js';
import { VOICE_LINES } from '../../../src/rpg/data/voice-lines.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const STATIC = path.join(ROOT, 'web/static');
const CROPS = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/rpg/crops.json'), 'utf8'));
const fileOf = (url) => path.join(STATIC, url);

/** Width / height of a WebP file (VP8, VP8L and VP8X chunks). */
function webpSize(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.toString('ascii', 0, 4), 'RIFF', `${file}: not RIFF`);
  assert.equal(b.toString('ascii', 8, 12), 'WEBP', `${file}: not WEBP`);
  const kind = b.toString('ascii', 12, 16);
  if (kind === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (kind === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  throw new Error(`${file}: unknown WebP chunk ${kind}`);
}

test('image URLs are relative rpg/ paths', () => {
  assert.equal(RPG_ASSETS.splash('liora'), 'rpg/splash/liora.webp');
  assert.equal(RPG_ASSETS.card('liora'), 'rpg/card/liora.webp');
  assert.equal(RPG_ASSETS.token('liora'), 'rpg/token/liora.webp');
  assert.equal(RPG_ASSETS.bg('bg-dawn'), 'rpg/bg/bg-dawn.webp');
  assert.equal(RPG_ASSETS.bg('ash'), 'rpg/bg/bg-ash.webp');
  assert.ok(['rpg/keyart.webp', 'rpg/splash/liora.webp'].includes(RPG_ASSETS.keyart));
  assert.equal(RPG_ASSETS.keyart === 'rpg/keyart.webp', RPG_ASSETS.hasKeyart);
  assert.deepEqual(RPG_ASSETS.heroImages('vera'), { splash: 'rpg/splash/vera.webp', card: 'rpg/card/vera.webp', token: 'rpg/token/vera.webp' });
  // ids are escaped, never able to leave the folder
  assert.equal(RPG_ASSETS.token('../x'), 'rpg/token/..%2Fx.webp');
});

test('setRpgAssetBase prefixes every URL', () => {
  try {
    setRpgAssetBase('../');
    assert.equal(rpgAssetBase(), '../');
    assert.equal(RPG_ASSETS.token('mara'), '../rpg/token/mara.webp');
    assert.equal(RPG_ASSETS.voice('liora', 'skill'), '../rpg/voice/liora-skill.mp3');
    setRpgAssetBase('/cdn');
    assert.equal(RPG_ASSETS.splash('mara'), '/cdn/rpg/splash/mara.webp');
  } finally {
    setRpgAssetBase('');
  }
  assert.equal(RPG_ASSETS.base, '');
});

test('focal(): measured face centre for every hero, frozen, default for unknown ids', () => {
  for (const h of HEROES) {
    const f = RPG_ASSETS.focal(h.id);
    assert.ok(f !== DEFAULT_FOCAL, `${h.id}: no measured focal`);
    assert.ok(f.x > 0.2 && f.x < 0.8 && f.y > 0.05 && f.y < 0.6, `${h.id}: focal ${JSON.stringify(f)} out of the expected area`);
    assert.ok(Object.isFrozen(f));
    assert.equal(RPG_ASSETS.focal(h.id), f, 'cached object');
    const c = CROPS.heroes[h.id];
    assert.ok(Math.abs(f.x - c.face.x / 1280) < 1e-4 && Math.abs(f.y - c.face.y / 720) < 1e-4, `${h.id}: assets.js out of sync with crops.json (run tools/rpg-assets.py)`);
  }
  assert.equal(RPG_ASSETS.focal('nobody'), DEFAULT_FOCAL);
  assert.deepEqual([...RPG_ASSETS.heroIds].sort(), HEROES.map((h) => h.id).sort());
});

test('voice(): Rare heroes have no voice, unknown events are null, aliases work', () => {
  for (const h of HEROES.filter((x) => x.rarity === 'rare')) {
    for (const e of RPG_VOICE_EVENTS) assert.equal(RPG_ASSETS.voice(h.id, e), null, `${h.id}-${e}`);
    assert.deepEqual(RPG_ASSETS.heroVoices(h.id), {});
  }
  assert.equal(RPG_ASSETS.voice('liora', 'dance'), null);
  assert.equal(RPG_ASSETS.voice('liora', null), null);
  assert.equal(voiceEventName('ult'), 'ultimate');
  assert.equal(voiceEventName('win'), 'victory');
  assert.equal(voiceEventName('toString'), null);
  if (hasVoice('liora', 'ultimate')) assert.equal(RPG_ASSETS.voice('liora', 'ult'), 'rpg/voice/liora-ultimate.mp3');
});

test('voice manifest matches the shipped mp3 files', () => {
  const dir = path.join(STATIC, 'rpg/voice');
  const shipped = new Set(fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.mp3')).map((f) => f.slice(0, -4)) : []);
  for (const h of HEROES) {
    for (const e of RPG_VOICE_EVENTS) {
      const url = RPG_ASSETS.voice(h.id, e);
      assert.equal(!!url, shipped.has(`${h.id}-${e}`), `${h.id}-${e}: manifest vs disk (run tools/rpg-assets.py)`);
      if (url) {
        assert.ok(VOICE_LINES[h.id] && VOICE_LINES[h.id].lines[e], `${h.id}-${e}: shipped audio without subtitles`);
        const b = fs.readFileSync(fileOf(url));
        assert.ok(b.length > 2000, `${url}: too small`);
        assert.ok(b[0] === 0xff && (b[1] & 0xe0) === 0xe0, `${url}: does not start with an MPEG frame (tags must be stripped)`);
      }
    }
  }
});

test('every hero ships splash 1280x720, card 480x640 and token 256x256 WebP', () => {
  const want = { splash: [1280, 720], card: [480, 640], token: [256, 256] };
  for (const h of HEROES) {
    for (const [kind, [w, hh]] of Object.entries(want)) {
      const file = fileOf(RPG_ASSETS[kind](h.id));
      assert.ok(fs.existsSync(file), `${file} missing`);
      assert.deepEqual(webpSize(file), { width: w, height: hh }, file);
    }
  }
  for (const bg of RPG_BG_IDS) assert.deepEqual(webpSize(fileOf(RPG_ASSETS.bg(bg))), { width: 1280, height: 720 });
  if (RPG_ASSETS.hasKeyart) assert.deepEqual(webpSize(fileOf(RPG_ASSETS.keyart)), { width: 1280, height: 720 });
});

test('shipped RPG assets stay within the size budget', () => {
  let total = 0;
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else total += fs.statSync(p).size;
    }
  };
  walk(path.join(STATIC, 'rpg'));
  assert.ok(total < 9 * 1024 * 1024, `web/static/rpg is ${(total / 1048576).toFixed(2)} MB (budget 9 MB)`);
  for (const h of HEROES) assert.ok(fs.statSync(fileOf(RPG_ASSETS.token(h.id))).size < 40 * 1024, `${h.id} token too big`);
});

test('crops.json: one valid entry per hero', () => {
  const ids = Object.keys(CROPS.heroes).sort();
  assert.deepEqual(ids, HEROES.map((h) => h.id).sort());
  for (const [id, c] of Object.entries(CROPS.heroes)) {
    const { x: fx, y: fy } = c.face;
    const size = c.token.size;
    assert.ok(size >= 128 && size <= 360, `${id}: token size ${size}`);
    // the token square around the face must fit the frame (up to 4% clamping)
    const tx = Math.min(Math.max(fx - size / 2, 0), 1280 - size);
    const ty = Math.min(Math.max(fy - size / 2, 0), 720 - size);
    assert.ok(Math.abs(tx + size / 2 - fx) <= size * 0.04 && Math.abs(ty + size / 2 - fy) <= size * 0.04, `${id}: token off-centre`);
    const { x, y, w, h } = c.card;
    assert.ok(x >= 0 && y >= 0 && x + w <= 1280 && y + h <= 720, `${id}: card outside the frame`);
    assert.ok(Math.abs(w / h - 0.75) < 0.01, `${id}: card is not 3:4`);
    assert.ok(h >= 480, `${id}: card crop too small (${h}px tall)`);
    assert.ok(fx > x + w * 0.3 && fx < x + w * 0.7, `${id}: face not horizontally centred in the card`);
    assert.ok(fy > y + h * 0.1 && fy < y + h * 0.35, `${id}: face not in the upper part of the card`);
  }
});

test('crops were measured on the current hero art', (t) => {
  const dir = path.join(ROOT, 'assets/rpg/heroes');
  if (!fs.existsSync(dir)) return t.skip('source art not present');
  for (const [id, c] of Object.entries(CROPS.heroes)) {
    const file = path.join(dir, `${id}.png`);
    if (!fs.existsSync(file)) continue;
    const sha = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 12);
    assert.equal(c.src, sha, `${id}.png changed since its crop was measured: re-check it, then python3 tools/rpg-assets.py --stamp ${id}`);
  }
});
