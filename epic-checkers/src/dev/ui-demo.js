// UI demo page: mounts the UI over an animated CSS backdrop (stand-in for the Pixi canvas) with
// fake data. URL params:
//   ?screen=title|menu|setup|settings|rules|stats|game|pause|gameover   (default title)
//   &epic=0|1  &lang=ru|en  &result=win|loss|draw|white|black  &mode=ai|pvp|demo
//   &variant=<id>  &bg=anim|plain  &quality=high|medium|low  &stats=empty|full
//   &rules=<variantId>|howto|epic  &setupMode=ai|pvp|demo  &flawless=1  &records=0
//   &detail=<result.detail>&limit=N&rule=<id>   (game over: draw reason by detail code)
//   &levelWhite=1..5&levelBlack=1..5 (demo fighters)  &status=capture|<text>  &skip=1
//   &cine=1 (hud.setCinematic(true))  &lanes=1 (outline hud.lanes())  &impact=1 (ui.flashImpact loop)
// window.__ui = the UI instance, window.__demo = helpers (used by screenshot steps).

import { UI } from '../ui/ui.js';
import { StatsStore, MemoryStorage, sanitizeSettings } from '../ui/storage.js';
import { VARIANTS } from '../engine/index.js';
import { drawBoardPreview, startLayout } from '../ui/board-preview.js';
import { t } from '../ui/i18n.js';

const q = new URLSearchParams(location.search);
const screen = q.get('screen') || 'title';
const epic = q.get('epic') !== '0';
const lang = q.get('lang') === 'en' ? 'en' : 'ru';
const result = q.get('result') || 'win';
const variantId = q.get('variant') || 'turkish';
const mode = q.get('mode') || 'ai';
const bg = q.get('bg') || 'anim';
const quality = ['high', 'medium', 'low'].includes(q.get('quality')) ? q.get('quality') : 'high';

const stage = document.getElementById('stage');
const standin = document.getElementById('standin');
const logEl = [];
const log = (...a) => {
  logEl.push(a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' '));
  if (q.get('log') === '1') console.log('[demo]', ...a);
};

// ------------------------------------------------------------------ fake stats
const storage = new MemoryStorage();
const stats = new StatsStore({ storage });
function seedStats() {
  const plan = [
    ['russian', 'win', 3, 4, 2, 0, 45],
    ['russian', 'win', 4, 2, 1, 2, 60],
    ['turkish', 'win', 3, 5, 3, 0, 38],
    ['turkish', 'loss', 4, 2, 1, 6, 70],
    ['turkish', 'win', 5, 3, 2, 1, 80],
    ['international', 'win', 3, 3, 1, 3, 90],
    ['english', 'draw', 3, 1, 0, 4, 120],
    ['brazilian', 'loss', 2, 2, 0, 8, 50],
    ['russian', 'win', 2, 3, 3, 2, 52],
    ['italian', 'win', 3, 2, 1, 1, 66],
    ['pool', 'win', 3, 2, 1, 0, 40],
  ];
  for (const [variantId, res, level, maxCombo, kingsMade, piecesLost, moves] of plan) {
    stats.record({
      variantId,
      mode: 'ai',
      epic: true,
      result: res,
      level,
      moves,
      captures: 6 + maxCombo * 2,
      maxCombo,
      kingsMade,
      piecesLost,
      durationSec: moves * 9,
    });
  }
  for (let i = 0; i < 3; i++) stats.record({ variantId: 'russian', mode: 'pvp', result: 'win', moves: 50 });
  stats.record({ variantId: 'canadian', mode: 'demo', result: 'win', moves: 140 });
}
if (q.get('stats') !== 'empty') seedStats();

// ------------------------------------------------------------------ fake audio / native
const audio = {
  unlock: () => log('audio.unlock'),
  play: (name) => log('sfx', name),
  setSfxVolume: (v) => log('sfxVolume', v),
  setMusicVolume: (v) => log('musicVolume', v),
};
const native = { vibrate: (p) => log('vibrate', p) };

const settings = sanitizeSettings({
  lang,
  quality,
  lastConfig: { variantId, mode, humanColor: 1, level: Number(q.get('level')) || 3, epic, giveaway: q.get('giveaway') === '1' },
});

const ui = new UI(document.getElementById('ui'), { settings, stats, audio, native });
window.__ui = ui;

for (const ev of ['play', 'undo', 'hint', 'resign', 'offer-draw', 'pause', 'resume', 'menu', 'rematch', 'settings', 'skip', 'theme', 'screen']) {
  ui.on(ev, (p) => log('event', ev, ev === 'settings' ? { lang: p.lang, quality: p.quality } : p));
}

// ------------------------------------------------------------------ backdrop stand-in
function paintBackdrop() {
  stage.className = bg === 'plain' ? 'bg-plain' : ui.isEpic ? 'bg-epic' : 'bg-classic';
}
ui.on('theme', () => {
  paintBackdrop();
  drawStandIn();
});
paintBackdrop();

let game = null;
function midGameLayout(variant) {
  const lay = startLayout(variant);
  const cells = lay.cells;
  const size = lay.size;
  // remove a few pieces and crown a couple to look like a game in progress
  let removed = 0;
  for (let i = 0; i < cells.length && removed < 7; i += 3) {
    if (cells[i]) {
      cells[i] = 0;
      removed++;
    }
  }
  // move some men to the middle
  const mid = Math.floor(size / 2);
  for (let c = 0; c < size; c++) {
    if (lay.playable(mid, c) && c % 3 === 0) cells[mid * size + c] = c % 2 ? 1 : -1;
    if (lay.playable(mid - 1, c) && c % 4 === 1) cells[(mid - 1) * size + c] = -2;
  }
  cells[(size - 1) * size + (lay.playable(size - 1, 2) ? 2 : 1)] = 2;
  return lay;
}

function drawStandIn() {
  if (!game || ui.currentScreen !== 'game') {
    standin.style.display = 'none';
    return;
  }
  const r = ui.boardSlotRect();
  if (!r.width) return;
  standin.style.display = 'block';
  standin.style.left = r.x + 'px';
  standin.style.top = r.y + 'px';
  standin.style.width = r.width + 'px';
  standin.style.height = r.height + 'px';
  drawBoardPreview(standin, game.variant, { px: r.width, epic: ui.isEpic, layout: game.layout });
}
ui.on('board-rect', drawStandIn);
ui.on('screen', () => drawStandIn());

// ------------------------------------------------------------------ fake game
function startFakeGame(cfg) {
  const variant = VARIANTS.find((v) => v.id === cfg.variantId) || VARIANTS[0];
  const humanColor = cfg.humanColor === 0 ? 1 : cfg.humanColor;
  game = { variant, cfg, layout: midGameLayout(variant), humanColor };
  const players =
    cfg.mode === 'ai'
      ? { [humanColor]: { isHuman: true }, [-humanColor]: { isHuman: false, level: cfg.level } }
      : cfg.mode === 'pvp'
        ? { 1: { isHuman: true }, '-1': { isHuman: true } }
        : { 1: { isHuman: false, level: cfg.levelWhite || cfg.level }, '-1': { isHuman: false, level: cfg.levelBlack || cfg.level } };
  ui.hud.setup({ variant, players, bottomColor: cfg.mode === 'ai' ? humanColor : 1, epic: cfg.epic, mode: cfg.mode, level: cfg.level, giveaway: cfg.giveaway });
  ui.showScreen('game');
  const n = variant.piecesPerSide;
  ui.hud.setCounts({ pieces: { 1: n - 3, '-1': n - 5 }, captured: { 1: 5, '-1': 3 } });
  ui.hud.setHype(humanColor, 0.65);
  ui.hud.setHype(-humanColor, 1);
  ui.hud.setCanUndo(true);
  ui.hud.setTurn(cfg.mode === 'ai' ? -humanColor : 1);
  if (cfg.mode !== 'pvp') ui.hud.setThinking(cfg.mode === 'ai' ? -humanColor : 1, true);
  drawStandIn();
}

ui.on('play', (cfg) => startFakeGame(cfg));
ui.on('rematch', () => game && startFakeGame(game.cfg));
ui.on('undo', () => ui.hud.toast(t('hud.undo')));
ui.on('hint', () => ui.hud.toast(t('hud.hint') + '…', { epic: false }));
ui.on('resign', () => showFakeGameOver('loss', 'resign'));

const fakeStats = (flawless) => ({
  captures: { 1: 9, '-1': flawless ? 0 : 3 },
  maxCombo: { 1: 4, '-1': 2 },
  kingsMade: { 1: 3, '-1': 1 },
  moveNumber: 42,
  hype: { 1: 1, '-1': 0.4 },
});

async function showFakeGameOver(res = result, reason) {
  const humanColor = game ? game.humanColor : 1;
  const m = game ? game.cfg.mode : mode;
  const winner = res === 'win' ? humanColor : res === 'loss' ? -humanColor : res === 'white' ? 1 : res === 'black' ? -1 : 0;
  const flawless = q.get('flawless') !== '0' && res === 'win';
  const records =
    q.get('records') === '0'
      ? { newRecords: [], newTitles: [] }
      : res === 'win'
        ? {
            newRecords: [
              { id: 'bestCombo', value: 4, prev: 3 },
              { id: 'mostKings', value: 3, prev: 2 },
            ],
            newTitles: [
              { id: 'grinder', icon: '斬', tier: 2 },
              { id: 'god', icon: '神', tier: 5 },
            ],
          }
        : { newRecords: [], newTitles: res === 'loss' ? [{ id: 'unbroken', icon: '魂', tier: 1 }] : [] };
  const detail = q.get('detail');
  const res0 = { winner, reason: reason || (winner ? 'no-pieces' : detail === 'one-each' ? 'insufficient' : detail && detail !== 'repetition' && detail !== 'agreement' ? 'move-limit' : 'repetition') };
  if (detail) Object.assign(res0, { detail, limit: Number(q.get('limit')) || undefined, rule: q.get('rule') || undefined });
  const choice = await ui.showGameOver({
    result: res0,
    humanColor: m === 'ai' ? humanColor : 0,
    mode: m,
    stats: fakeStats(flawless),
    records,
    epic: ui.isEpic,
    players: {},
  });
  log('gameover choice', choice);
  if (choice === 'rematch' && game) startFakeGame(game.cfg);
}

window.__demo = { startFakeGame, showFakeGameOver, log: logEl, stats };

// ------------------------------------------------------------------ initial screen
const cfg = {
  variantId,
  mode: screen === 'game' || screen === 'pause' || screen === 'gameover' ? mode : 'ai',
  humanColor: Number(q.get('color')) || 1,
  level: Number(q.get('level')) || 3,
  levelWhite: Number(q.get('levelWhite')) || undefined,
  levelBlack: Number(q.get('levelBlack')) || undefined,
  epic,
  giveaway: q.get('giveaway') === '1',
};

// outline of hud.lanes() (the free space above / below the board the Director uses)
function drawLanes() {
  document.querySelectorAll('.demo-lane').forEach((e) => e.remove());
  if (q.get('lanes') !== '1' || ui.currentScreen !== 'game') return;
  const ln = ui.hud.lanes();
  for (const k of ['top', 'bottom']) {
    const l = ln[k];
    if (!l) continue;
    const d = document.createElement('div');
    d.className = 'demo-lane';
    Object.assign(d.style, { position: 'fixed', left: '0', right: '0', top: l.y + 'px', height: l.h + 'px', outline: '2px dashed #ffd23f', background: 'rgba(255,210,63,.12)', zIndex: 50, pointerEvents: 'none', font: '12px monospace', color: '#ffd23f' });
    d.textContent = `${k} lane y=${l.y} h=${l.h}`;
    document.body.appendChild(d);
  }
}
ui.on('board-rect', drawLanes);
if (screen === 'game' || screen === 'pause' || screen === 'gameover') {
  startFakeGame(cfg);
  if (q.get('status')) ui.hud.setStatus(q.get('status') === 'capture' ? t('status.yourTurnCapture') : q.get('status'), { tone: q.get('tone') || '' });
  if (q.get('toast')) ui.hud.toast(q.get('toast'), { epic });
  if (q.get('skip') === '1') ui.hud.setSkippable(true);
  if (q.get('cine') === '1') ui.hud.setCinematic(true);
  if (q.get('impact') === '1') setInterval(() => ui.flashImpact(120), 900);
  setTimeout(drawLanes, 100);
  if (screen === 'pause') setTimeout(() => ui.openPause(), 50);
  if (screen === 'gameover') setTimeout(() => showFakeGameOver(result), 50);
} else if (screen === 'setup') {
  ui.showScreen('setup', { mode: q.get('setupMode') || 'ai' });
} else if (screen === 'rules') {
  const r = q.get('rules');
  ui.showScreen('rules', r === 'howto' || r === 'epic' ? { page: r, fromList: true } : r ? { variantId: r, fromList: true } : {});
} else {
  ui.showScreen(screen);
}
