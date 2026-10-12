// RPG UI demo: mounts RpgUI over a stand-in canvas with mock profile / battle state. URL params:
//   ?screen=hub|collection|hero|squad|summon|campaign|training|duel|battle|results|stage|settings|summon-anim|pause|pass
//   &profile=starter|mid|full|empty   &lang=ru|en   &quality=high|medium|low   &keyart=splash|none
//   hero:     &hero=<id>&tab=overview|skills|constellation|voice
//   campaign: &chapter=1..3  stage: &stage=1-3
//   summon-anim: &rarity=rare|epic|legendary|mythic &count=1|10 &step=pull|reveal|grid
//   battle:   &mode=campaign|duel &select=<unitId> &busy=1 &moved=1 &enemySel=1 &cine=1 &logdemo=1 &thinking=1
//   results:  &outcome=victory|defeat|draw &mode=campaign|training|duel
//   &classic=1  mount the classic src/ui UI in the same #ui root first (style coexistence check)
//   &meta=1   real meta module (src/rpg/meta): createProfile / summon / setSquad / useXpScrolls + RpgUI({ meta })
//   &assets=mock   stand-in asset URLs instead of the real RPG_ASSETS / playVoice (src/rpg/assets.js, voice.js)
//   &log=1 shows the event log; window.__rpg = the RpgUI, window.__demo = helpers.
// Assets: run `node src/dev/rpg-ui-demo.prep.mjs` after building (copies / crops into dist/dev/rpg-ui-demo/rpg).

import { RpgUI } from '../rpg/ui/index.js';
import { RPG_ASSETS } from '../rpg/assets.js';
import { playVoice } from '../rpg/voice.js';
import * as META from '../rpg/meta/index.js';
import { UI as ClassicUI } from '../ui/ui.js';
import { HEROES, getHero } from '../rpg/data/heroes.js';
import { RARITIES, GACHA, statsAt } from '../rpg/data/rules.js';
import { setLang } from '../ui/i18n.js';
import { MemoryStorage, sanitizeSettings } from '../ui/storage.js';

const q = new URLSearchParams(location.search);
const screen = q.get('screen') || 'hub';
const lang = q.get('lang') === 'en' ? 'en' : 'ru';
setLang(lang);
const devlog = document.getElementById('devlog');
const logs = [];
const log = (...a) => {
  logs.push(a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' '));
  if (q.get('log') === '1') {
    devlog.style.display = 'block';
    devlog.textContent = logs.slice(-14).join('\n');
    console.log('[demo]', ...a);
  }
};

// ------------------------------------------------------------------ assets (prep script output)
const base = 'rpg/';
const keyartMode = q.get('keyart') || (q.get('assets') === 'mock' ? 'none' : 'real');
const realAssets = q.get('assets') !== 'mock';
const mockAssets = {
  splash: (id) => `${base}splash/${id}.webp`,
  card: (id) => `${base}card/${id}.webp`,
  token: (id) => `${base}token/${id}.webp`,
  bg: (id) => `${base}bg/${id}.webp`,
  get keyart() {
    return keyartMode === 'splash' ? `${base}splash/liora.webp` : keyartMode === 'file' ? `${base}keyart.webp` : null;
  },
  voice: (heroId, event) => `${base}voice/${heroId}-${event}.mp3`,
  focal: (id) => (getHero(id) ? getHero(id).art.focal : { x: 0.5, y: 0.27 }),
};
const assets = realAssets
  ? {
      ...RPG_ASSETS,
      keyart: keyartMode === 'none' ? null : keyartMode === 'splash' ? RPG_ASSETS.splash('liora') : RPG_ASSETS.keyart,
    }
  : mockAssets;
const useMeta = q.get('meta') === '1';

// ------------------------------------------------------------------ mock voice / audio / native
let currentAudio = null;
const mockVoice = (heroId, event, { settings } = {}) => {
  log('voice', heroId, event);
  if (settings && settings.rpgVoice === false) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      if (currentAudio) currentAudio.pause();
      const a = new Audio(assets.voice(heroId, event));
      a.volume = settings ? settings.voiceVolume ?? 0.9 : 0.9;
      currentAudio = a;
      a.onended = () => resolve(true);
      a.onerror = () => resolve(false);
      a.play().catch(() => resolve(false));
      setTimeout(() => resolve(true), 4000);
    } catch (e) {
      resolve(false);
    }
  });
};
const voice = realAssets
  ? (heroId, event, opts) => {
      log('voice', heroId, event);
      return playVoice(heroId, event, opts);
    }
  : mockVoice;
const audio = { play: (n) => log('sfx', n), setSfxVolume: (v) => log('sfxVol', v), setMusicVolume: (v) => log('musicVol', v), duck: () => {}, unlock: () => {} };
const native = { vibrate: (p) => log('vibrate', p) };

// ------------------------------------------------------------------ mock profiles
const STARTER = ['akane', 'vera', 'shio', 'maren', 'iskra', 'mashiro'];
function makeProfile(kind) {
  const p = { v: 1, crystals: 3200, dust: 0, xpScrolls: 5, heroes: {}, squad: [], campaign: {}, pity: { sinceEpicPlus: 0, sinceLegendaryPlus: 0, novicePulls: 0 }, firstRun: false };
  if (kind === 'empty') return { ...p, crystals: 0, firstRun: true };
  for (const id of STARTER) p.heroes[id] = { level: 1, xp: 0, constellation: 0, copies: 1 };
  p.squad = STARTER.slice();
  if (kind === 'starter') return p;
  const own = (id, level, constellation = 0, xp = 0) => (p.heroes[id] = { level, xp, constellation, copies: constellation + 1 });
  own('akane', 9, 1, 640);
  own('vera', 8, 2, 120);
  own('shio', 8, 3, 300);
  own('maren', 7, 1);
  own('iskra', 8, 2, 500);
  own('mashiro', 8, 4, 50);
  own('liora', 7, 0, 210);
  own('volta', 6, 0);
  own('koyuki', 6, 1);
  own('mara', 5, 2);
  own('falk', 4, 1);
  own('sirin', 5, 0);
  p.squad = ['liora', 'akane', 'volta', 'vera', 'mashiro', 'iskra'];
  p.crystals = 2240;
  p.dust = 140;
  p.xpScrolls = 3;
  p.pity = { sinceEpicPlus: 3, sinceLegendaryPlus: 22, novicePulls: 20 };
  const cleared = ['1-1', '1-2', '1-3', '1-4', '1-5'];
  const stars = [3, 3, 2, 3, 1];
  cleared.forEach((id, i) => (p.campaign[id] = { stars: stars[i], cleared: true }));
  if (kind === 'full') {
    for (const h of HEROES) if (!p.heroes[h.id]) own(h.id, 20, h.rarity === 'rare' ? 4 : 0);
    own('nocturna', 22, 1);
    own('liora', 26, 6);
    p.crystals = 12840;
    ['1-6', '1-7', '1-8', '1-B', '2-1', '2-2', '2-3'].forEach((id, i) => (p.campaign[id] = { stars: [3, 2, 3, 2, 3, 1, 2][i], cleared: true }));
  }
  return p;
}
function metaProfile(kind) {
  // a real meta profile (createProfile) dressed up like the mock kinds
  let p = META.createProfile({ seed: 1234 });
  if (kind === 'starter' || kind === 'empty') return p;
  const mock = makeProfile(kind);
  p = { ...p, crystals: mock.crystals, dust: mock.dust, xpScrolls: mock.xpScrolls, pity: { ...p.pity, ...mock.pity } };
  p.heroes = {};
  for (const [id, e] of Object.entries(mock.heroes)) p.heroes[id] = { ...e, obtainedAt: 0, seen: true };
  p.campaign = {};
  for (const [id, c] of Object.entries(mock.campaign)) p.campaign[id] = { ...c, clears: 1, attempts: 1, lossStreak: 0, bestRounds: 12 };
  return META.setSquad(p, mock.squad);
}
let profile = useMeta ? metaProfile(q.get('profile') || 'mid') : makeProfile(q.get('profile') || 'mid');

// ------------------------------------------------------------------ the UI
const root = document.getElementById('ui');
const settings = q.get('classic') === '1' ? sanitizeSettings({ lang }) : { lang, sfxVolume: 0.8, musicVolume: 0.5, textTime: 1.5, haptics: 'strong', fx: { flashes: true } };
// &classic=1: the app's classic UI owns #ui first (same root, same stylesheet) — checks that both coexist
const classic = q.get('classic') === '1' ? new ClassicUI(root, { settings, audio: null, native: null }) : null;
if (classic) classic.showScreen('menu');
const ui = new RpgUI(root, { settings, audio, native, assets, voice, profile, storage: new MemoryStorage(), meta: useMeta ? META : null });
const quality = q.get('quality');
if (quality) ui.setEffectiveQuality(quality);
window.__rpg = ui;

for (const ev of ['start-battle', 'summon', 'set-squad', 'use-scroll', 'exit', 'battle-action', 'select-unit', 'pause', 'resume', 'surrender', 'speed', 'auto', 'skip', 'settings', 'screen', 'results', 'voice']) {
  ui.on(ev, (p) => log('event', ev, p === undefined ? '' : p));
}

// ------------------------------------------------------------------ mock summon
let seed = Number(q.get('seed')) || 7;
const rnd = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
function rollRarity(force) {
  if (force) return force;
  const r = rnd();
  if (r < GACHA.rates.mythic) return 'mythic';
  if (r < GACHA.rates.mythic + GACHA.rates.legendary) return 'legendary';
  if (r < GACHA.rates.mythic + GACHA.rates.legendary + GACHA.rates.epic) return 'epic';
  return 'rare';
}
function mockSummon(count, best = null) {
  const results = [];
  for (let i = 0; i < count; i++) {
    let rarity = rollRarity(i === count - 1 && best ? best : null);
    if (count === 10 && i === 6 && !best) rarity = 'epic';
    const pool = HEROES.filter((h) => h.rarity === rarity);
    const hero = pool[Math.floor(rnd() * pool.length)];
    const owned = profile.heroes[hero.id];
    const r = { heroId: hero.id, rarity, isNew: !owned, constellation: owned ? Math.min(6, (owned.constellation || 0) + 1) : 0 };
    if (owned && owned.constellation >= 6) r.refund = RARITIES[rarity].dupDustAfterC6;
    if (owned) owned.constellation = Math.min(6, (owned.constellation || 0) + 1);
    else profile.heroes[hero.id] = { level: 1, xp: 0, constellation: 0, copies: 1 };
    results.push(r);
  }
  profile.crystals -= count === 10 ? GACHA.cost.multi : GACHA.cost.single;
  profile.pity.sinceEpicPlus = (profile.pity.sinceEpicPlus + count) % 10;
  return results;
}
ui.on('summon', async (count) => {
  let results;
  if (useMeta) {
    const r = META.summon(profile, count);
    if (!r.ok) return log('summon failed', r.error);
    profile = r.profile;
    results = r.results;
  } else {
    results = mockSummon(count);
    profile = { ...profile };
  }
  ui.setProfile(profile);
  const r = await ui.playSummon(results);
  log('summon done', r);
});
ui.on('set-squad', (ids) => {
  profile = useMeta ? META.setSquad(profile, ids) : { ...profile, squad: ids.slice() };
  ui.setProfile(profile);
});
ui.on('use-scroll', ({ heroId, count }) => {
  if (useMeta) {
    const r = META.useXpScrolls(profile, heroId, count);
    if (r.ok) profile = r.profile;
  } else {
    const e = profile.heroes[heroId];
    profile = { ...profile, xpScrolls: Math.max(0, (profile.xpScrolls || 0) - count), heroes: { ...profile.heroes, [heroId]: { ...e, xp: (e.xp || 0) + 1000 * count } } };
  }
  ui.setProfile(profile);
});
ui.on('exit', () => {
  ui.hide();
  setTimeout(() => ui.showScreen('hub'), 600);
});

// ------------------------------------------------------------------ mock battle
const stage = document.getElementById('stage');
const bgImg = stage.querySelector('img.bg');
const canvas = document.getElementById('board');
const tokenImgs = {};
function tokenImg(id) {
  if (!tokenImgs[id]) {
    const im = new Image();
    im.onload = () => drawBoard();
    im.src = assets.token(id);
    tokenImgs[id] = im;
  }
  return tokenImgs[id];
}
const sq = (file, rank) => (8 - rank) * 8 + 'abcdefgh'.indexOf(file);
function unit(id, heroId, side, square, extra = {}) {
  const h = getHero(heroId);
  const lvl = extra.level || 9;
  const s = statsAt(h, lvl);
  const maxEnergy = h.ultimate.cost;
  return {
    id,
    heroId,
    side,
    sq: square,
    hp: Math.round(s.hp * (extra.hpPct ?? 1)),
    maxHp: s.hp,
    atk: s.atk,
    def: s.def,
    crit: s.crit,
    energy: Math.round(maxEnergy * (extra.ePct ?? 0.4)),
    maxEnergy,
    cd: { skill: extra.cd || 0 },
    statuses: extra.statuses || [],
    seal: extra.seal || null,
    shield: extra.shield || 0,
    awakened: !!extra.awakened,
    alive: extra.alive !== false,
    level: lvl,
    constellation: 0,
  };
}
let battleState = {
  side: 1,
  round: 5,
  roundLimit: 25,
  units: [
    unit('p1', 'liora', 1, sq('d', 4), { awakened: true, ePct: 1, statuses: [{ id: 'crown', turns: null }, { id: 'inspire', turns: 2 }] }),
    unit('p2', 'akane', 1, sq('c', 3), { hpPct: 0.62, ePct: 0.7, cd: 2, statuses: [{ id: 'burn', turns: 1 }], seal: 'tide' }),
    unit('p3', 'volta', 1, sq('f', 2), { hpPct: 0.9, ePct: 0.55 }),
    unit('p4', 'vera', 1, sq('a', 1), { hpPct: 0.45, ePct: 0.2, statuses: [{ id: 'brace', turns: 1 }, { id: 'shield', turns: 2 }], shield: 180 }),
    unit('p5', 'mashiro', 1, sq('e', 1), { hpPct: 1, ePct: 0.95 }),
    unit('p6', 'iskra', 1, sq('g', 1), { hpPct: 0, alive: false }),
    unit('e1', 'tsubame', -1, sq('e', 7), { level: 10, hpPct: 0.7, ePct: 0.5, statuses: [{ id: 'mark', turns: 2 }, { id: 'slow', turns: 1 }] }),
    unit('e2', 'kaede', -1, sq('b', 6), { level: 8, hpPct: 0.3, ePct: 0.8, seal: 'flame' }),
    unit('e3', 'sirin', -1, sq('d', 8), { level: 8, hpPct: 1, ePct: 0.3 }),
    unit('e4', 'vera', -1, sq('f', 6), { level: 8, hpPct: 0.85, ePct: 0.1, statuses: [{ id: 'frozen', turns: 1 }] }),
    unit('e5', 'koyuki', -1, sq('h', 8), { level: 8, hpPct: 0.55, ePct: 1 }),
    unit('e6', 'mara', -1, sq('c', 7), { level: 8, hpPct: 0.2, ePct: 0.6 }),
  ],
};
const duel = q.get('mode') === 'duel';
let boardRect = null;
function drawBoard() {
  if (ui.currentScreen !== 'battle' || !boardRect) {
    canvas.width = 0;
    return;
  }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const { x, y, width: w } = boardRect;
  canvas.style.left = x + 'px';
  canvas.style.top = y + 'px';
  canvas.style.width = w + 'px';
  canvas.style.height = w + 'px';
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(w * dpr);
  const c = canvas.getContext('2d');
  c.scale(dpr, dpr);
  const cell = w / 8;
  for (let r = 0; r < 8; r++) {
    for (let col = 0; col < 8; col++) {
      c.fillStyle = (r + col) % 2 ? 'rgba(20,14,52,0.92)' : 'rgba(225,215,255,0.16)';
      c.fillRect(col * cell, r * cell, cell, cell);
    }
  }
  c.strokeStyle = 'rgba(255,220,150,0.6)';
  c.lineWidth = 2;
  c.strokeRect(1, 1, w - 2, w - 2);
  for (const u of battleState.units) {
    if (!u.alive) continue;
    const r = Math.floor(u.sq / 8);
    const col = u.sq % 8;
    const cx = col * cell + cell / 2;
    const cy = r * cell + cell / 2;
    const rad = cell * 0.42;
    c.save();
    c.beginPath();
    c.arc(cx, cy, rad, 0, Math.PI * 2);
    c.closePath();
    c.fillStyle = u.side > 0 ? '#46e3ff' : '#ff4d7d';
    c.fill();
    c.beginPath();
    c.arc(cx, cy, rad - 3, 0, Math.PI * 2);
    c.clip();
    const im = tokenImg(u.heroId);
    if (im.complete && im.naturalWidth) c.drawImage(im, cx - rad, cy - rad, rad * 2, rad * 2);
    c.restore();
  }
  if (q.get('select')) {
    const u = battleState.units.find((x) => x.id === q.get('select'));
    if (u) {
      const r = Math.floor(u.sq / 8);
      const col = u.sq % 8;
      c.strokeStyle = '#fff';
      c.lineWidth = 3;
      c.strokeRect(col * cell + 2, r * cell + 2, cell - 4, cell - 4);
      c.fillStyle = 'rgba(61,220,151,0.8)';
      for (const [dr, dc] of [[-1, -1], [-1, 1]]) {
        const rr = r + dr;
        const cc = col + dc;
        if (rr >= 0 && cc >= 0 && cc < 8) {
          c.beginPath();
          c.arc(cc * cell + cell / 2, rr * cell + cell / 2, cell * 0.14, 0, Math.PI * 2);
          c.fill();
        }
      }
    }
  }
}
ui.on('board-rect', (r) => {
  boardRect = r;
  drawBoard();
});
ui.on('screen', (name) => {
  if (name !== 'battle') canvas.width = 0;
});

function startBattle(opts = {}) {
  bgImg.hidden = false;
  bgImg.src = assets.bg(opts.bg || 'bg-dawn');
  ui.hud.setup(battleState, {
    mode: duel ? 'duel' : opts.mode || 'campaign',
    playerSide: 1,
    stageId: duel ? null : '1-B',
    roundLimit: duel ? 30 : undefined,
    canAuto: true,
  });
  ui.showScreen('battle');
  const sel = q.get('select');
  if (sel) {
    const u = battleState.units.find((x) => x.id === sel);
    const mine = u && u.side === 1;
    const fake = mine
      ? {
          moves: [10, 12],
          jumps: u.id === 'p1' ? [[35, 17]] : [],
          basic: [20],
          skill: { ok: !u.cd.skill, reason: u.cd.skill ? 'cooldown' : null, targets: [20], area: () => [] },
          ult: { ok: u.energy >= u.maxEnergy, reason: u.energy >= u.maxEnergy ? null : 'energy', targets: [20], area: () => [] },
        }
      : null;
    ui.hud.select(sel, fake, { moved: q.get('moved') === '1' });
  }
  if (q.get('busy') === '1') ui.hud.setBusy(true);
  if (q.get('thinking') === '1') {
    battleState = { ...battleState, side: -1 };
    ui.hud.update(battleState);
    ui.hud.setThinking(true);
  }
  if (q.get('cine') === '1') ui.hud.setCinematic(true);
  if (q.get('logdemo') !== '0') setTimeout(() => ui.hud.log([
      { type: 'cast', unit: 'p1', kind: 'ult', abilityId: 'hymn-of-the-celestial-queen' },
      { type: 'damage', source: 'p1', target: 'e2', amount: 1242, crit: true, element: 'radiance' },
      { type: 'damage', source: 'p1', target: 'e1', amount: 860, element: 'radiance' },
      { type: 'reaction', target: 'e2', reaction: 'eclipse', elements: ['radiance', 'umbra'] },
      { type: 'ko', unit: 'e6' },
    ]), Number(q.get('logdelay')) || 1800);
  requestAnimationFrame(() => drawBoard());
}
ui.on('start-battle', (cfg) => {
  log('start-battle', cfg.mode, cfg.stageId || '');
  startBattle(cfg);
});
ui.on('select-unit', (id) => {
  const u = battleState.units.find((x) => x.id === id);
  if (!u) return;
  ui.hud.select(id, u.side === 1 ? { moves: [1], jumps: [], basic: [2], skill: { ok: !u.cd.skill, reason: u.cd.skill ? 'cooldown' : null }, ult: { ok: u.energy >= u.maxEnergy, reason: 'energy' } } : null);
});
ui.on('surrender', () => showResultsDemo('defeat'));

// ------------------------------------------------------------------ results
function showResultsDemo(outcome) {
  const mode = q.get('mode') || 'campaign';
  const win = outcome === 'victory';
  const result = { winner: outcome === 'draw' ? 0 : win ? 1 : -1, reason: 'no-heroes', rounds: 13, stats: { kosTaken: win ? 0 : 6, damage: { akane: 4200, liora: 6100, volta: 2900 } } };
  const squad = profile.squad.slice();
  const xp = Object.fromEntries(squad.map((id) => [id, win ? 1262 : 315]));
  const levelUps = win ? [{ heroId: 'akane', from: 9, to: 10 }, { heroId: 'mashiro', from: 8, to: 9 }] : [];
  if (win) {
    profile.heroes.akane = { ...profile.heroes.akane, level: 10, xp: 120 };
    profile.heroes.mashiro = { ...profile.heroes.mashiro, level: 9, xp: 300 };
  }
  ui.setProfile(profile);
  return ui
    .showResults({
      result,
      rewards: mode === 'duel' ? {} : { crystals: win ? 400 : 0, xp, levelUps, firstClear: win, stars: win ? 3 : 0, xpScrolls: win ? 3 : 0 },
      mode,
      stageId: mode === 'campaign' ? '1-B' : null,
      squad,
      squads: mode === 'duel' ? { 1: ['liora', 'akane', 'volta', 'vera', 'mashiro', 'iskra'], '-1': ['tsubame', 'kaede', 'sirin', 'vera', 'koyuki', 'mara'] } : undefined,
    })
    .then((c) => log('results ->', c));
}

// ------------------------------------------------------------------ helpers + initial screen
window.__demo = {
  ui,
  logs,
  get profile() {
    return profile;
  },
  setProfile(p) {
    profile = p;
    ui.setProfile(p);
  },
  summon(count = 10, best = null) {
    if (useMeta) {
      const r = META.summon(profile, count);
      if (!r.ok) return Promise.resolve(r.error);
      profile = r.profile;
      ui.setProfile(profile);
      return ui.playSummon(r.results);
    }
    const res = mockSummon(count, best);
    ui.setProfile({ ...profile });
    return ui.playSummon(res);
  },
  battle: startBattle,
  results: showResultsDemo,
  state: () => battleState,
};

switch (screen) {
  case 'battle':
  case 'pause':
  case 'pass':
    startBattle();
    if (screen === 'pause') setTimeout(() => ui.openPause(), 300);
    if (screen === 'pass') setTimeout(() => ui.passPhone(-1), 300);
    break;
  case 'results':
    showResultsDemo(q.get('outcome') || 'victory');
    break;
  case 'summon-anim': {
    const count = Number(q.get('count')) || 10;
    ui.showScreen('summon');
    setTimeout(() => window.__demo.summon(count, q.get('rarity') || null), 200);
    break;
  }
  case 'stage':
    ui.showScreen('campaign', { chapter: Number(q.get('chapter')) || 1, stageId: q.get('stage') || '1-6' });
    break;
  case 'settings':
    ui.showScreen('hub');
    setTimeout(() => ui.openSettings(), 200);
    break;
  case 'hero':
    ui.showScreen('hero', { heroId: q.get('hero') || 'liora', tab: q.get('tab') || 'overview' });
    break;
  case 'campaign':
    ui.showScreen('campaign', { chapter: Number(q.get('chapter')) || undefined });
    break;
  default:
    ui.showScreen(screen);
}
