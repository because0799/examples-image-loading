// Bootstrap (ARCHITECTURE.md §8): fonts → settings → audio → UI → renderer → FX → Director → AI →
// controller, then wires UI / native events and shows the first screen.
//
// URL parameters (testing / debugging):
//   ?debug=1                      expose window.__app (see below) + console.error on desync
//   ?lang=en|ru                   UI language for this session
//   ?quality=auto|high|medium|low graphics quality for this session (a level turns adaptive quality off)
//   ?adaptive=0                   no automatic quality step-down
//   ?battery=0|1                  battery saver for this session (30 fps cap …)
//   ?speed=0.5|0.75|1|1.25|1.5|2  animation speed for this session
//   ?textTime=1|1.5|2|3           text reading time multiplier for this session
//   ?fast=1                       AI thinks ~40 ms and moves without the perceived delay (tests)
//   ?autoskip=1                   skip every cinematic as soon as it starts (tests)
//   ?screen=game&variant=turkish&mode=ai|pvp|demo&epic=0|1&color=1|-1|0&level=1..5&giveaway=0|1
//          &pos=<stateString>&intro=0   start a game directly (skips title / menu)
//   ?screen=menu|setup|settings|rules|stats   open that screen directly
//   (no ?screen: the title screen; an autosaved unfinished game is offered for resumption)
//
// window.__app = { game, controller, renderer, fx, director, ui, audio, ai, native, settings,
//                  stats, perf, quality (= perf.adaptive), startGame(cfg), playPath(path),
//                  setPosition(str), state() }

import * as storage from './ui/storage.js';
import { UI } from './ui/ui.js';
import { Renderer } from './render/renderer.js';
import { FX } from './fx/fx.js';
import { Director } from './fx/director.js';
import { AudioEngine } from './audio/audio.js';
import { AIClient } from './ai/ai-client.js';
import { native } from './platform/native.js';
import { Controller } from './controller.js';
import { text } from './controller-text.js';
import { readSave, clearSave } from './app-save.js';
import { PerfManager } from './app-perf.js';
import { stateFromString, getVariant } from './engine/index.js';
import { loc } from './ui/i18n.js';

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
  window.__bootFailed = true; // the inline watchdog in index.html leaves this message alone
  const el = document.getElementById('boot');
  if (el) {
    el.classList.add('is-error');
    const msg = el.querySelector('.boot__msg');
    if (msg) {
      msg.textContent = /^en/i.test(navigator.language || '')
        ? 'Graphics (WebGL) failed to start. Please restart the app.'
        : 'Не удалось запустить графику (WebGL). Перезапусти приложение.';
    }
  }
}

function hideSplash() {
  window.__booted = true; // index.html's boot watchdog: the app is up
  const el = document.getElementById('boot');
  if (!el) return;
  el.classList.remove('is-error', 'is-slow');
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
  const cfg = {
    variantId,
    mode,
    humanColor: color === -1 ? -1 : color === 0 ? 0 : 1,
    level: Math.min(5, Math.max(1, Math.round(num('level', last.level || 3)))),
    epic: params.has('epic') ? params.get('epic') !== '0' : last.epic !== false,
    giveaway: params.get('giveaway') === '1',
  };
  if (params.has('levelWhite')) cfg.levelWhite = num('levelWhite', cfg.level);
  if (params.has('levelBlack')) cfg.levelBlack = num('levelBlack', cfg.level);
  return cfg;
}

async function boot() {
  await waitFonts(2500);

  const settings = storage.loadSettings();
  if (params.get('lang') === 'en' || params.get('lang') === 'ru') settings.lang = params.get('lang');
  // session overrides (tests / debugging)
  const urlQuality = ['high', 'medium', 'low'].includes(params.get('quality')) ? params.get('quality') : null;
  if (urlQuality || params.get('quality') === 'auto') settings.quality = urlQuality || 'auto';
  const speed = Number(params.get('speed'));
  if ([0.5, 0.75, 1, 1.25, 1.5, 2].includes(speed)) settings.animSpeed = speed;
  const textTime = Number(params.get('textTime'));
  if ([1, 1.5, 2, 3].includes(textTime)) settings.textTime = textTime;
  if (params.has('battery')) settings.battery = params.get('battery') === '1';
  const quality0 = PerfManager.initialQuality(settings, { urlQuality });
  const directGame = params.get('screen') === 'game';
  const urlCfg = directGame ? urlConfig(settings) : null;
  if (urlCfg) settings.lastConfig = { ...settings.lastConfig, epic: urlCfg.epic };

  const statsStore = new storage.StatsStore();
  const audio = new AudioEngine({ sfxVolume: settings.sfxVolume, musicVolume: settings.musicVolume });
  const ui = new UI(document.getElementById('ui'), { settings, stats: statsStore, audio, native });

  const renderer = new Renderer(document.getElementById('stage'));
  try {
    // effective quality: an explicit level, or for 'auto' the device default / the level an earlier
    // adaptive step down chose (app-perf); MSAA is decided here, at init
    // (battery saver known up front: no texture rebuild right after boot)
    await renderer.init({ quality: quality0, battery: settings.battery === true });
  } catch (e) {
    bootError(e);
    return;
  }
  const theme = ui.isEpic ? 'epic' : 'classic';
  renderer.setTheme(theme);
  renderer.layers.world.visible = false; // menus: live backdrop only

  let fx = null;
  try {
    fx = new FX({ renderer, quality: quality0, mode: theme });
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

  // ------------------------------------------------------------------ Director ↔ DOM HUD hooks
  // EAD-06: big cinematics (VS intro, ×3+ finales, ULTIMATE, epic game over) slide the HUD away;
  // EAD-18: every manga impact frame also hits the DOM HUD (not on 'low' quality).
  if (director.hooks && typeof director.hooks === 'object') {
    director.hooks.cinematic = (on) => {
      const hud = ui.hud;
      if (on && !controller.active) return;
      if (hud && typeof hud.setCinematic === 'function') hud.setCinematic(!!on);
    };
    director.hooks.impact = (ms) => {
      // not on 'low', not with the battery saver, never with flashes off (photosensitivity)
      if (!controller.active || controller.quality === 'low' || settings.battery) return;
      if (settings.fx && settings.fx.flashes === false) return;
      if (typeof ui.flashImpact === 'function') ui.flashImpact(ms);
    };
  }

  // ------------------------------------------------------------------ frame budget + settings
  // 60 fps cap (30 with the battery saver), 'auto' quality with adaptive step down, ticker
  // stopped in the background (src/app-perf.js). Then every module gets the settings.
  const perf = new PerfManager({
    settings,
    renderer,
    controller,
    ui,
    urlQuality,
    adaptive: params.get('adaptive') !== '0',
    isActive: () => {
      if (!controller.active || controller.paused || ui.currentScreen !== 'game') return false;
      if (document.visibilityState === 'hidden' || native.isPaused) return false;
      // a deliberate slow-mo / hit-stop is not a slow phone
      const clk = renderer.clock;
      return clk && clk.scale < 0.9 ? 'skip' : true;
    },
    notify: () => ui.toast(text('toast.qualityLowered'), { tone: 'info' }),
  });
  controller.perf = perf;
  perf.attach();
  controller.applySettings(settings);

  // ------------------------------------------------------------------ UI events
  ui.on('play', (cfg) => controller.startGame(cfg));
  ui.on('undo', () => controller.undo());
  ui.on('hint', () => controller.hint());
  ui.on('resign', (p) => controller.resign(p));
  ui.on('offer-draw', (p) => controller.offerDraw(p));
  ui.on('pause', () => {
    controller.onPause();
    perf.setDimmed(true);
  });
  ui.on('resume', () => {
    controller.onResume();
    perf.setDimmed(false);
  });
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
  // the board slot moved / resized, or the lanes around it changed (EAD-15)
  ui.on('board-rect', (rect) => controller.onBoardRect(rect));
  ui.on('screen', (name) => {
    // any way out of the game screen (menu from pause, game over → menu, …) ends the game
    if (name !== 'game' && controller.active) controller.stopGame();
    perf.setDimmed(false);
  });
  let laneRaf = 0;
  window.addEventListener('resize', () => {
    if (laneRaf) return;
    laneRaf = requestAnimationFrame(() => {
      laneRaf = 0;
      controller.syncLanes();
    });
  });
  // any input counts as activity (keep-screen-on idle timer, F7)
  window.addEventListener('pointerdown', () => controller.noteActivity(), { capture: true, passive: true });

  // ------------------------------------------------------------------ native
  // Android back (MUX-05): the UI handles it everywhere, incl. «press Back again to exit» on the
  // root screens. With an older UI that exits on the first press, the same rule is applied here.
  let rootBackAt = 0;
  let uiDoublePress = false; // the UI implements «press Back again» itself (its window, its toast)
  native.setBackHandler(() => {
    const screen = ui.currentScreen;
    const root = screen === 'title' || screen === 'menu';
    const overlay = !!document.querySelector('#ui .ov:not(.is-closing)');
    const handled = controller.handleBack();
    if (!root || overlay) return handled;
    const now = Date.now();
    if (handled) {
      uiDoublePress = true; // the UI armed its own double press
      return true;
    }
    if (uiDoublePress) return false; // the UI's second press: exit
    if (now - rootBackAt < 3000) return false;
    rootBackAt = now;
    ui.toast(text('toast.pressBackAgain'));
    return true;
  });
  native.onPause(() => {
    controller.onAppPause(true);
    try {
      audio.pause();
    } catch (e) {
      /* ignore */
    }
    perf.pause(); // no frames at all in the background
    if (controller.active && controller.phase !== 'over' && !ui.paused) {
      try {
        ui.openPause();
      } catch (e) {
        /* ignore */
      }
    }
  });
  native.onResume(() => {
    controller.onAppPause(false);
    try {
      audio.resume();
    } catch (e) {
      /* ignore */
    }
    perf.resume();
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
      perf,
      quality: perf.adaptive,
      text,
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
    } else {
      ui.showScreen('title');
      offerResume(ui, controller);
    }
    audio.music('menu');
  }
}

/** F8: an unfinished game from the last session (killed in the background) can be continued. */
async function offerResume(ui, controller) {
  const save = readSave();
  if (!save) return;
  let desc = '';
  try {
    const v = getVariant(save.cfg.variantId);
    const moveNo = Math.max(1, Math.ceil((save.game.history.length + 1) / 2));
    desc = [loc(v.name), text(save.cfg.mode === 'pvp' ? 'resume.pvp' : 'resume.vsAi'), text('resume.move', { n: moveNo })].join(', ');
  } catch (e) {
    desc = save.cfg.variantId;
  }
  let ok = false;
  try {
    ok = await ui.confirm(text('resume.offer', { desc }), { ok: text('resume.ok'), cancel: text('resume.cancel') });
  } catch (e) {
    ok = false;
  }
  if (controller.active) return; // a game was started some other way meanwhile
  if (ok) controller.resumeGame(save);
  else clearSave();
}

boot().catch(bootError);
