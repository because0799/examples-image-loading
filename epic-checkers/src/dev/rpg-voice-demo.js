// rpg-voice-demo — click-test of src/rpg/voice.js + a gallery of the shipped RPG art (owner: assets).
//
//   python3 tools/rpg-assets.py                 (builds web/static/rpg and mirrors it to dist/dev/rpg)
//   node tools/build-web.mjs --demo rpg-voice-demo
//   node tools/shot.mjs --path dev/rpg-voice-demo/index.html --out /tmp/shots
//
// Query: ?base=<prefix> (asset URL prefix, default '../' = dist/dev/rpg), ?tab=gallery.
// window.__voiceDemo exposes { log, play, player state } for scripted checks.

import { RPG_ASSETS, setRpgAssetBase, RPG_VOICE_EVENTS } from '../rpg/assets.js';
import { playVoice, stopVoice, configureVoice, applyVoiceSettings, preloadVoice, currentVoice } from '../rpg/voice.js';
import { HEROES } from '../rpg/data/heroes.js';
import { VOICE_EVENT_NAMES } from '../rpg/data/voice-lines.js';
import { AudioEngine } from '../audio/audio.js';

const q = new URLSearchParams(location.search);
setRpgAssetBase(q.has('base') ? q.get('base') : '../');

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const RARITY_RU = { mythic: 'Мифическая', legendary: 'Легендарная', epic: 'Эпическая', rare: 'Редкая' };
const SHORT = { summon: 'Призыв', skill: 'Навык', ultimate: 'Вспышка', victory: 'Победа' };

// ------------------------------------------------------------------ state
const settings = { rpgVoice: true, voiceVolume: 0.9, muted: false };
const audio = new AudioEngine({ sfxVolume: 0.8, musicVolume: 0.6 });
const log = [];
configureVoice({ settings, audio });

function addLog(kind, text) {
  const t = (performance.now() / 1000).toFixed(2);
  log.push({ t: Number(t), kind, text });
  const box = $('log');
  const line = el('div', null, `${t}s ${kind === 'start' ? '<b>▶</b>' : kind === 'skip' ? '<em>✕</em>' : '■'} ${text}`);
  box.prepend(line);
  while (box.childNodes.length > 40) box.lastChild.remove();
}

function tokenEl(hero, size) {
  const t = el('div', `tok ${hero.rarity}`);
  if (size) t.style.width = t.style.height = size + 'px';
  const img = el('img');
  img.alt = hero.name.ru;
  img.decoding = 'async';
  img.src = RPG_ASSETS.token(hero.id);
  t.append(img);
  return t;
}

// ------------------------------------------------------------------ now playing panel
let barAnim = 0;
function showNow(hero, event, info) {
  const now = $('now');
  const tok = now.querySelector('.tok');
  tok.className = `tok ${hero.rarity}`;
  tok.querySelector('img').src = RPG_ASSETS.token(hero.id);
  now.querySelector('.name').textContent = `${hero.name.ru} · ${VOICE_EVENT_NAMES[event].ru}`;
  const line = info && info.line;
  now.querySelector('.jp').textContent = line ? line.jp : '—';
  now.querySelector('.tr').textContent = line ? `${line.ru} / ${line.en}` : '';
  const bar = now.querySelector('.bar i');
  cancelAnimationFrame(barAnim);
  const dur = (info && info.durationMs) || 3000;
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / dur);
    bar.style.width = (k * 100).toFixed(1) + '%';
    if (k < 1 && currentVoice()) barAnim = requestAnimationFrame(step);
  };
  step();
}

const buttons = new Map(); // `${id}-${event}` -> button
function markPlaying() {
  const cur = currentVoice();
  for (const [key, b] of buttons) b.classList.toggle('playing', !!cur && key === `${cur.heroId}-${cur.event}`);
}

function play(heroId, event, extra = {}) {
  const hero = HEROES.find((h) => h.id === heroId);
  const p = playVoice(heroId, event, {
    force: $('force').checked,
    ...extra,
    onStart: (info) => {
      addLog('start', `${heroId}-${info.event} (${info.durationMs || '?'} ms) «${info.line ? info.line.jp : ''}»`);
      showNow(hero, info.event, info);
      markPlaying();
    },
    onEnd: (r) => {
      if (r.played) addLog('end', `${heroId}-${r.event}${r.interrupted ? ' (прервана)' : ''}`);
      else addLog('skip', `${heroId}-${r.event}: ${r.reason}`);
      $('status').textContent = r.played ? '' : `не проиграно: ${r.reason}`;
      setTimeout(markPlaying, 0);
    },
  });
  setTimeout(markPlaying, 0);
  return p;
}

// ------------------------------------------------------------------ voiced heroes
const voiced = HEROES.filter((h) => h.voice);
let shipped = 0;
for (const hero of voiced) {
  const card = el('div', 'hero');
  card.append(tokenEl(hero));
  const right = el('div');
  right.append(el('div', 'nm', `${hero.name.ru} <small>${hero.name.jp} · ${RARITY_RU[hero.rarity]}</small>`));
  const row = el('div', 'btns');
  for (const ev of RPG_VOICE_EVENTS) {
    const b = el('button', null, SHORT[ev]);
    const ok = !!RPG_ASSETS.voice(hero.id, ev);
    shipped += ok ? 1 : 0;
    b.disabled = !ok;
    b.title = ok ? RPG_ASSETS.voice(hero.id, ev) : 'файл ещё не сгенерирован';
    b.dataset.line = `${hero.id}-${ev}`;
    b.addEventListener('click', () => play(hero.id, ev));
    buttons.set(`${hero.id}-${ev}`, b);
    row.append(b);
  }
  right.append(row);
  card.append(right);
  $('heroes').append(card);
}
$('stats').textContent = `${voiced.length} озвученных героинь · ${shipped}/${voiced.length * 4} реплик в сборке · 24 героя в галерее`;

// ------------------------------------------------------------------ controls
const syncControls = () => {
  $('bVoice').textContent = `Голос: ${settings.rpgVoice ? 'вкл' : 'выкл'}`;
  $('bVoice').classList.toggle('on', settings.rpgVoice);
  $('bMute').textContent = `Звук: ${settings.muted ? 'выкл' : 'вкл'}`;
  $('bMute').classList.toggle('on', !settings.muted);
};
syncControls();
$('bMute').classList.add('on');
$('bVoice').addEventListener('click', () => {
  settings.rpgVoice = !settings.rpgVoice;
  applyVoiceSettings(settings);
  syncControls();
});
$('bMute').addEventListener('click', () => {
  settings.muted = !settings.muted;
  audio.setMuted(settings.muted);
  applyVoiceSettings(settings);
  syncControls();
});
let musicOn = false;
$('bMusic').addEventListener('click', () => {
  audio.unlock();
  musicOn = !musicOn;
  audio.music(musicOn ? 'menu' : null, { fade: 600 });
  $('bMusic').classList.toggle('on', musicOn);
});
$('bStop').addEventListener('click', () => stopVoice());
$('vol').addEventListener('input', (e) => {
  settings.voiceVolume = Number(e.target.value);
  $('volOut').textContent = settings.voiceVolume.toFixed(2);
  applyVoiceSettings(settings);
});
// rapid fire: one voice at a time; a skill can't cut an ultimate (unless "force")
$('bSpam').addEventListener('click', async () => {
  const seq = [['liora', 'skill'], ['reika', 'skill'], ['nocturna', 'ultimate'], ['akane', 'skill'], ['volta', 'summon'], ['fuyuka', 'ultimate']];
  for (const [h, e] of seq) {
    play(h, e);
    await new Promise((r) => setTimeout(r, 180));
  }
});
// every line in order (listening test for loudness consistency)
let allRun = 0;
$('bAll').addEventListener('click', async () => {
  const run = ++allRun;
  for (const hero of voiced) {
    for (const ev of RPG_VOICE_EVENTS) {
      if (run !== allRun || !RPG_ASSETS.voice(hero.id, ev)) continue;
      await play(hero.id, ev, { force: true });
      await new Promise((r) => setTimeout(r, 250));
    }
  }
});

// ------------------------------------------------------------------ gallery
let galleryBuilt = false;
function buildGallery() {
  if (galleryBuilt) return;
  galleryBuilt = true;
  for (const hero of HEROES) {
    const c = el('div', 'gcell');
    const card = el('img', 'card');
    card.loading = 'lazy';
    card.alt = hero.name.ru;
    card.src = RPG_ASSETS.card(hero.id);
    c.append(card, tokenEl(hero), el('div', null, `${hero.name.ru} <small style="color:var(--dim)">${hero.id}</small>`));
    const sp = el('div', 'sp');
    const img = el('img');
    img.loading = 'lazy';
    img.src = RPG_ASSETS.splash(hero.id);
    const f = RPG_ASSETS.focal(hero.id);
    const dot = el('i');
    dot.style.left = (f.x * 100).toFixed(1) + '%';
    dot.style.top = (f.y * 100).toFixed(1) + '%';
    sp.append(img, dot);
    c.append(sp);
    $('gal').append(c);
  }
  for (const bg of RPG_ASSETS.bgIds) {
    const fig = el('figure');
    const img = el('img');
    img.src = RPG_ASSETS.bg(bg);
    fig.append(img, el('figcaption', null, bg));
    $('bgs').append(fig);
  }
  const fig = el('figure');
  const img = el('img');
  img.src = RPG_ASSETS.keyart;
  fig.append(img, el('figcaption', null, RPG_ASSETS.hasKeyart ? 'keyart' : 'keyart (заглушка: сплэш Лиоры)'));
  $('bgs').append(fig);
}
function showTab(name) {
  $('voice').style.display = name === 'voice' ? '' : 'none';
  $('gallery').style.display = name === 'gallery' ? 'block' : 'none';
  $('tVoice').classList.toggle('on', name === 'voice');
  $('tGallery').classList.toggle('on', name === 'gallery');
  if (name === 'gallery') buildGallery();
}
$('tVoice').addEventListener('click', () => showTab('voice'));
$('tGallery').addEventListener('click', () => showTab('gallery'));
showTab(q.get('tab') === 'gallery' ? 'gallery' : 'voice');

// idle "now playing" panel shows the first voiced heroine
{
  const tok = $('now').querySelector('.tok');
  tok.className = `tok ${voiced[0].rarity}`;
  tok.querySelector('img').src = RPG_ASSETS.token(voiced[0].id);
}

// warm the cache for a few heroes like a battle start would
preloadVoice(['liora', 'nocturna', 'reika']);

window.__voiceDemo = { log, play, settings, current: currentVoice, assets: RPG_ASSETS };
