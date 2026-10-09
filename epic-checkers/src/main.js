// Bootstrap (ARCHITECTURE.md §8): fonts → settings → audio → UI → renderer → FX → Director → AI →
// controller, then wires UI / native events and shows the first screen.
//
// URL parameters (testing / debugging):
//   ?debug=1                      expose window.__app (see below) + console.error on desync
//   ?lang=en|ru                   UI language for this session
//   ?quality=high|medium|low      graphics quality for this session
//   ?speed=1|1.5|2                animation speed for this session
//   ?fast=1                       AI thinks ~40 ms and moves without the perceived delay (tests)
//   ?autoskip=1                   skip every cinematic as soon as it starts (tests)
//   ?screen=game&variant=turkish&mode=ai|pvp|demo&epic=0|1&color=1|-1|0&level=1..5&giveaway=0|1
//          &pos=<stateString>&intro=0   start a game directly (skips title / menu)
//   ?screen=menu|setup|settings|rules|stats   open that screen directly
//
// window.__app = { game, controller, renderer, fx, director, ui, audio, ai, native, settings,
//                  stats, startGame(cfg), playPath(path), setPosition(str), state() }

import { loadSettings, StatsStore } from './ui/storage.js';
import { UI } from './ui/ui.js';
import { Renderer } from './render/renderer.js';
import { FX } from './fx/fx.js';
import { Director } from './fx/director.js';
import { AudioEngine } from './audio/audio.js';
import { AIClient } from './ai/ai-client.js';
import { native } from './platform/native.js';
import { Controller } from './controller.js';
import { stateFromString, getVariant } from './engine/index.js';

/* global __DEV__ */
const DEV = typeof __DEV__ !== 'undefined' && __DEV__;
const params = new URLSearchParams(location.search);
const debug = params.get('debug') === '1' || DEV;

const errors = [];
window.addEventListener('error', (e) => {
  errors.push(String((e && e.message) || e));
});
window.addEventListener('unhandledrejection', (e) => {
  errors.push(String((e && e.reason && (e.reason.stack || e.reason.message)) || e.reason || e));
  if (debug) console.error('[app] unhandled rejection', e.reason);
});

const FONT_SPECS = [
  '400 32px "Dela Gothic One"',
  '400 32px "Russo One"',
  '400 16px "Oswald"',
  '500 16px "Oswald"',
  '700 16px "Oswald"',
  '400 16px "Unbounded"',
  '700 16px "Unbounded"',
  '900 16px "Unbounded"',
];

async function waitFonts(timeoutMs) {
  if (!document.fonts || !document.fonts.load) return;
  const all = Promise.all(FONT_SPECS.map((f) => document.fonts.load(f, 'ШАШКИ EPIC 勝利').catch(() => null)));
  await Promise.race([all, new Promise((r) => setTimeout(r, timeoutMs))]);
}

function bootError(err) {
  console.error('[app] boot failed', err);
  const el = document.getElementById('boot');
  if (el) {
    el.classList.add('is-error');
    const msg = el.querySelector('.boot__msg');
    if (msg) {
      msg.textContent = /^en/i.test(navigator.language || '')
        ? 'Graphics (WebGL) failed to start. Please restart the app.'
        : 'Не удалось запустить графику (WebGL). Перезапустите приложение.';
    }
  }
}

function hideSplash() {
  const el = document.getElementById('boot');
  if (!el) return;
  el.classList.add('is-done');
  setTimeout(() => el.remove(), 600);
}

function urlConfig(settings) {
  const last = settings.lastConfig || {};
  const num = (k, def) => {
    const v = Number(params.get(k));
    return Number.isFinite(v) && params.get(k) !== null && params.get(k) !== '' ? v : def;
  };
  let variantId = params.get('variant') || last.variantId || 'russian';
  try {
    variantId = getVariant(variantId).id;
  } catch (e) {
    variantId = 'russian';
  }
  const mode = ['ai', 'pvp', 'demo'].includes(params.get('mode')) ? params.get('mode') : 'ai';
  const color = num('color', 1);
  return {
    variantId,
    mode,
    humanColor: color === -1 ? -1 : color === 0 ? 0 : 1,
    level: Math.min(5, Math.max(1, Math.round(num('level', last.level || 3)))),
    epic: params.has('epic') ? params.get('epic') !== '0' : last.epic !== false,
    giveaway: params.get('giveaway') === '1',
  };
}

async function boot() {
  await waitFonts(2500);

  const settings = loadSettings();
  if (params.get('lang') === 'en' || params.get('lang') === 'ru') settings.lang = params.get('lang');
  if (['high', 'medium', 'low'].includes(params.get('quality'))) settings.quality = params.get('quality');
  const speed = Number(params.get('speed'));
  if ([1, 1.5, 2].includes(speed)) settings.animSpeed = speed;
  const directGame = params.get('screen') === 'game';
  const urlCfg = directGame ? urlConfig(settings) : null;
  if (urlCfg) settings.lastConfig = { ...settings.lastConfig, epic: urlCfg.epic };

  const statsStore = new StatsStore();
  const audio = new AudioEngine({ sfxVolume: settings.sfxVolume, musicVolume: settings.musicVolume });
  const ui = new UI(document.getElementById('ui'), { settings, stats: statsStore, audio, native });

  const renderer = new Renderer(document.getElementById('stage'));
  try {
    await renderer.init({ quality: settings.quality });
  } catch (e) {
    bootError(e);
    return;
  }
  const theme = ui.isEpic ? 'epic' : 'classic';
  renderer.setTheme(theme);
  renderer.layers.world.visible = false; // menus: live backdrop only

  let fx = null;
  try {
    fx = new FX({ renderer, quality: settings.quality, mode: theme });
    fx.setLang(settings.lang);
  } catch (e) {
    console.error('[app] FX init failed — continuing without effects', e);
  }
  const director = new Director({ renderer, fx, audio, native, settings });
  director.setMode(theme);
  if (typeof director.setLang === 'function') director.setLang(settings.lang);
  const ai = new AIClient();

  const controller = new Controller({
    ui,
    renderer,
    fx,
    director,
    audio,
    ai,
    native,
    settings,
    statsStore,
    opts: { debug, fast: params.get('fast') === '1', autoSkip: params.get('autoskip') === '1' },
  });

  // ------------------------------------------------------------------ UI events
  ui.on('play', (cfg) => controller.startGame(cfg));
  ui.on('undo', () => controller.undo());
  ui.on('hint', () => controller.hint());
  ui.on('resign', (p) => controller.resign(p));
  ui.on('offer-draw', (p) => controller.offerDraw(p));
  ui.on('pause', () => controller.onPause());
  ui.on('resume', () => controller.onResume());
  ui.on('menu', () => controller.stopGame());
  ui.on('rematch', () => controller.rematch());
  ui.on('skip', () => {
    try {
      if (director.busy) director.skip();
    } catch (e) {
      console.warn('[app] skip failed', e);
    }
  });
  ui.on('settings', (s) => controller.applySettings(s));
  ui.on('theme', (t) => {
    if (!controller.active) controller._setTheme(t);
  });
  ui.on('board-rect', (rect) => {
    if (controller.active && rect && rect.width > 0) renderer.setBoardRect(rect);
  });
  ui.on('screen', (name) => {
    // any way out of the game screen (menu from pause, game over → menu, …) ends the game
    if (name !== 'game' && controller.active) controller.stopGame();
  });

  // ------------------------------------------------------------------ native
  native.setBackHandler(() => controller.handleBack());
  native.onPause(() => {
    controller.appPaused = true;
    try {
      audio.pause();
    } catch (e) {
      /* ignore */
    }
    renderer.pause();
    if (controller.active && controller.phase !== 'over' && !ui.paused) {
      try {
        ui.openPause();
      } catch (e) {
        /* ignore */
      }
    }
  });
  native.onResume(() => {
    controller.appPaused = false;
    try {
      audio.resume();
    } catch (e) {
      /* ignore */
    }
    renderer.resume();
  });

  // ------------------------------------------------------------------ testing hooks
  if (debug) {
    window.__app = {
      get game() {
        return controller.game;
      },
      controller,
      renderer,
      fx,
      director,
      ui,
      audio,
      ai,
      native,
      settings,
      stats: statsStore,
      errors,
      startGame: (cfg) => controller.startGame(cfg),
      playPath: (path) => controller.playPath(path),
      setPosition: (str) => controller.setPositionString(str),
      state: () => controller.snapshot(),
    };
  }

  // ------------------------------------------------------------------ first screen
  hideSplash();
  if (urlCfg) {
    let startState = null;
    const pos = params.get('pos');
    if (pos) {
      try {
        startState = stateFromString(urlCfg.variantId, pos, { giveaway: urlCfg.giveaway || /\|giveaway$/.test(pos) });
      } catch (e) {
        console.error('[app] bad ?pos=', e);
      }
    }
    controller.startGame(urlCfg, { startState, intro: params.get('intro') !== '0' });
  } else {
    const screen = params.get('screen');
    if (screen && ['menu', 'setup', 'settings', 'rules', 'stats'].includes(screen)) {
      ui.showScreen(screen, screen === 'setup' ? { mode: params.get('mode') || 'ai' } : {});
    } else ui.showScreen('title');
    audio.music('menu');
  }
}

boot().catch(bootError);
