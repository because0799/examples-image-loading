// UI — DOM screens, HUD and overlays on top of the Pixi canvas (ARCHITECTURE.md §6).
//
//   const ui = new UI(document.getElementById('ui'), { settings, stats, audio, native });
//   ui.on('play', (config) => ...);   // events below
//   ui.showScreen('title' | 'menu' | 'setup' | 'settings' | 'rules' | 'stats' | 'game', params?)
//   ui.hud.setup({ variant, players, bottomColor, epic, mode, level?, giveaway? }) ...
//   ui.boardSlotRect() -> DOMRect (CSS px, layout box of #board-slot)
//   await ui.showGameOver({...}) -> 'rematch' | 'menu'   (on 'menu' the UI shows the menu itself)
//   await ui.confirm(text, { ok?, cancel?, danger? }) -> boolean
//   ui.handleBack() -> boolean (Android back). On the title / menu root the first press shows
//                      «Нажми «Назад» ещё раз, чтобы выйти» and returns true; a second press within
//                      2 s returns false (the app exits).
//   ui.flashImpact(ms) -> manga impact frame on the DOM HUD (invert + contrast), skipped on 'low'
//   ui.hud.lanes() / ui.hud.setCinematic(on) -> see hud.js
//
// Events (ui.on(name, fn) returns an unsubscribe function):
//   'play'(GameConfig)        START pressed in setup (humanColor 0 = random, resolved by the controller)
//   'undo' 'hint'             HUD buttons
//   'pause' / 'resume'        pause overlay opened / closed (also emitted before resign/menu/rematch/offer-draw)
//   'resign'({ color })       confirmed resignation (color = human in ai mode, side to move in pvp)
//   'offer-draw'({ color, accepted: true })  pvp draw offer ACCEPTED by the other player (declines stay in the UI)
//   'offer-draw'({ color, vsAI: true })      draw offered to the AI (ai mode, no dialog; the controller
//                                            answers with a toast or ends the game)
//   'menu'                    user left the game from the pause menu (the UI already shows the menu)
//   'rematch'                 «Начать заново» from the pause menu (game over uses the showGameOver promise)
//   'settings'(settings)      after every settings change (live object, already saved)
//   'skip'                    «Пропустить» chip tapped during a cinematic (see hud.setSkippable)
//   'theme'('epic'|'classic') theme of the UI changed (EPIC toggle or hud.setup)
//   'board-rect'(DOMRect)     #board-slot moved/resized or hud.lanes() changed (orientation change, fonts ...)
//   'occluded'(bool)          an opaque full-screen sheet (settings / rules from the pause menu) covers
//                             the whole canvas (true) or no longer does (false, as it starts closing):
//                             wire it to renderer.setOccluded(on)
//   'screen'(name)            a screen became current

import './styles.css';
import './screens.css';
import './hud.css';
import './overlays.css';
import './epic.css';
import './perf.css';

import { VARIANTS } from '../engine/index.js';
import { h, feedback, fitAll } from './dom.js';
import { t, setLang, getLang } from './i18n.js';
import { loadSettings, saveSettings, sanitizeSettings, hapticPattern, presetPatch, StatsStore } from './storage.js';
import { createToastStack, readMs } from './toasts.js';
import { createTitle } from './screens/title.js';
import { createMenu } from './screens/menu.js';
import { createSetup } from './screens/setup.js';
import { createSettings } from './screens/settings.js';
import { createRules } from './screens/rules.js';
import { createStats } from './screens/stats.js';
import { createGameScreen } from './hud.js';
import { buildPause, buildGameOver, buildConfirm } from './overlays.js';

export const UI_VERSION = '1.0.0';

const SCREENS = {
  title: createTitle,
  menu: createMenu,
  setup: createSetup,
  settings: createSettings,
  rules: createRules,
  stats: createStats,
};
const DEPTH = { title: 0, menu: 1, setup: 2, settings: 2, rules: 2, stats: 2, game: 3 };
const SCREEN_MS = 420;
const OVERLAY_MS = 320;
const BACK_EXIT_MIN_MS = 2000; // second Android back press within the toast's lifetime exits the app
const IMPACT_MS = { min: 40, max: 400, def: 110 };

function currentQualityClass(root) {
  const cl = root.classList;
  return ['low', 'medium', 'high'].find((x) => cl.contains(`q-${x}`)) || null;
}

function setQualityClass(root, q) {
  const cl = root.classList;
  for (const x of ['high', 'medium', 'low']) if (x !== q && cl.contains(`q-${x}`)) cl.remove(`q-${x}`);
  if (!cl.contains(`q-${q}`)) cl.add(`q-${q}`);
}

/** DOM-side guess of the 'auto' quality until the controller reports its pick. */
function guessQuality() {
  try {
    const n = globalThis.navigator || {};
    const cores = Number(n.hardwareConcurrency) || 8;
    const mem = Number(n.deviceMemory) || 8;
    return cores <= 4 || mem <= 3 ? 'medium' : 'high';
  } catch (e) {
    return 'high';
  }
}

const sameParams = (a = {}, b = {}) => {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
};

export class UI {
  constructor(root, { settings, stats, audio = null, native = null, version = UI_VERSION } = {}) {
    this.root = root;
    this.settings = settings || loadSettings();
    this.stats = stats || new StatsStore();
    this.audio = audio || null;
    this.native = native || null;
    this.version = version;
    this._handlers = new Map();
    this._screen = null;
    this._overlays = [];
    this._epic = !!(this.settings.lastConfig && this.settings.lastConfig.epic);

    setLang(this.settings.lang);
    feedback.sound = (name) => this.sound(name);
    feedback.haptic = (p) => this.haptic(p);

    root.classList.add('ui-root');
    this._screensEl = h('div.ui-screens');
    this._overlaysEl = h('div.ui-overlays');
    this._toastsEl = h('div.ui-toasts', { 'aria-live': 'polite' });
    this._flashEl = h('div.ui-flash', { 'aria-hidden': 'true' });
    root.append(this._screensEl, this._overlaysEl, this._toastsEl, this._flashEl);
    this._toastStack = createToastStack(this._toastsEl, {
      max: 2,
      textTime: () => this.settings.textTime,
      epic: () => this._epic,
    });

    this._game = createGameScreen(this);
    this.hud = this._game.hud;

    this._applyThemeClasses();
    this._applyQuality();
    this._applySettingsClasses();

    // first user gesture unlocks WebAudio
    this._unlock = () => {
      try {
        this.audio && this.audio.unlock && this.audio.unlock();
      } catch (e) {
        /* ignore */
      }
    };
    window.addEventListener('pointerdown', this._unlock, { once: true, capture: true });

    this._onResize = () => {
      if (this._resizeRaf) return;
      this._resizeRaf = requestAnimationFrame(() => {
        this._resizeRaf = 0;
        this.refit();
        if (this._screen && this._screen.api.onResize) this._screen.api.onResize();
        this._game.layout();
      });
    };
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
    // Fonts load lazily (on first use): refit text + board slot whenever a font finishes loading.
    this._onFonts = () => {
      this.refit();
      this._game.layout();
    };
    if (document.fonts) {
      if (document.fonts.ready) document.fonts.ready.then(this._onFonts);
      if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', this._onFonts);
    }
  }

  // ------------------------------------------------------------------ events
  on(event, fn) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    const set = this._handlers.get(event);
    if (set) set.delete(fn);
  }

  emit(event, payload) {
    const set = this._handlers.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (e) {
        console.error(`[ui] handler for '${event}' failed`, e);
      }
    }
  }

  // ------------------------------------------------------------------ feedback
  sound(name, opts) {
    if (!name || !this.audio || typeof this.audio.play !== 'function') return;
    try {
      this.audio.play(name, opts);
    } catch (e) {
      /* audio is optional */
    }
  }

  /** UI haptics, gated by settings.haptics ('off' | 'light' shortens pulses | 'strong'). */
  haptic(pattern) {
    if (!this.native || typeof this.native.vibrate !== 'function') return;
    const level = this.settings.haptics || (this.settings.vibration === false ? 'off' : 'strong');
    const p = hapticPattern(pattern, level);
    if (p == null) return;
    try {
      this.native.vibrate(p);
    } catch (e) {
      /* ignore */
    }
  }

  // ------------------------------------------------------------------ data helpers
  get variants() {
    return VARIANTS;
  }

  variant(id) {
    return VARIANTS.find((v) => v.id === id) || null;
  }

  get isEpic() {
    return this._epic;
  }

  get currentScreen() {
    return this._screen ? this._screen.name : null;
  }

  /** Re-applies fitText to every [data-fit] element (or inside `el`). */
  refit(el) {
    const run = () => {
      fitAll(el || this.root);
    };
    run();
    // fonts may still be loading on the very first frames
    requestAnimationFrame(run);
  }

  // ------------------------------------------------------------------ settings
  /**
   * Mutates the live settings object, saves it and emits 'settings'. `_live: true` skips saving
   * (slider drags). patch.fx is merged into settings.fx (same object); `haptics` and the legacy
   * `vibration` flag stay in sync; every field is validated and settings.preset is re-derived (any
   * change of a preset-controlled field makes it 'custom'). patch.preset = 'max' | 'balanced' |
   * 'calm' | 'battery' applies that preset.
   */
  updateSettings(patch = {}) {
    const live = !!patch._live;
    const p = { ...patch };
    delete p._live;
    const s = this.settings;
    const prevLang = s.lang;
    const prevQuality = s.quality;
    if (p.preset && p.preset !== 'custom') Object.assign(p, presetPatch(p.preset) || {});
    if ('vibration' in p && !('haptics' in p)) {
      // an old reader toggled the boolean flag
      p.haptics = p.vibration ? (s.haptics && s.haptics !== 'off' ? s.haptics : 'strong') : 'off';
    }
    const fxPatch = p.fx && typeof p.fx === 'object' ? p.fx : null;
    delete p.fx;
    delete p.preset;
    Object.assign(s, p);
    if (!s.fx || typeof s.fx !== 'object' || Object.isFrozen(s.fx)) s.fx = { ...(s.fx || {}) };
    if (fxPatch) Object.assign(s.fx, fxPatch);
    // validate in place (keeps the identity of settings, settings.fx and settings.lastConfig)
    const clean = sanitizeSettings(s);
    for (const [k, v] of Object.entries(clean)) {
      if (k === 'fx') Object.assign(s.fx, v);
      else if (k === 'lastConfig' && s.lastConfig && typeof s.lastConfig === 'object' && !Object.isFrozen(s.lastConfig)) Object.assign(s.lastConfig, v);
      else s[k] = v;
    }
    if (!live) saveSettings(s);
    if ('sfxVolume' in p && this.audio && this.audio.setSfxVolume) this.audio.setSfxVolume(s.sfxVolume);
    if ('musicVolume' in p && this.audio && this.audio.setMusicVolume) this.audio.setMusicVolume(s.musicVolume);
    if (s.quality !== prevQuality) this._applyQuality();
    this._applySettingsClasses();
    if (this.hud && typeof this.hud.applySettings === 'function') this.hud.applySettings();
    if (s.lang !== prevLang) {
      setLang(s.lang);
      this._rebuildForLang();
    }
    this.emit('settings', s);
  }

  /** Re-applies the settings-driven CSS classes (idempotent; also callable by the controller). */
  applySettings() {
    this._applyQuality();
    this._applySettingsClasses();
  }

  /**
   * Graphics quality class of the DOM (q-high | q-medium | q-low). An explicit settings.quality is
   * used as is. With 'auto' the level the app picked wins: ui.setEffectiveQuality(q), or the class
   * the perf manager already put on the root; a device guess only until then.
   */
  _applyQuality() {
    const pref = this.settings.quality || 'auto';
    const q = pref === 'auto' ? this._effectiveQuality || currentQualityClass(this.root) || guessQuality() : pref;
    setQualityClass(this.root, q);
  }

  /** The quality actually in use (controller: 'auto' pick or adaptive step-down). */
  setEffectiveQuality(q) {
    if (!['high', 'medium', 'low'].includes(q)) return;
    this._effectiveQuality = q;
    setQualityClass(this.root, q);
  }

  /** 'high' | 'medium' | 'low' in use right now (the root's q-* class is the DOM's truth). */
  get effectiveQuality() {
    const cur = currentQualityClass(this.root);
    if (cur) return cur;
    const pref = this.settings.quality || 'auto';
    return pref === 'auto' ? this._effectiveQuality || guessQuality() : pref;
  }

  _applySettingsClasses() {
    const s = this.settings;
    const fx = s.fx || {};
    const cl = this.root.classList;
    cl.toggle('is-battery', !!s.battery);
    // photosensitivity: no flickering DOM effects either (perf.css)
    cl.toggle('no-flashes', fx.flashes === false);
  }

  // ------------------------------------------------------------------ theme
  _applyThemeClasses() {
    this.root.classList.toggle('theme-epic', this._epic);
    this.root.classList.toggle('theme-classic', !this._epic);
  }

  /** Visual theme only (used by hud.setup and when returning to the menu). */
  setTheme(epic, { flash = false } = {}) {
    const next = !!epic;
    if (next === this._epic) return;
    this._epic = next;
    this._applyThemeClasses();
    if (flash) this._flash(next);
    if (this._screen && this._screen.api.onTheme) this._screen.api.onTheme(next);
    for (const o of this._overlays) if (o.onTheme) o.onTheme(next);
    this.refit();
    this.emit('theme', next ? 'epic' : 'classic');
  }

  /** User toggled EPIC BADASS MODE (persists in lastConfig.epic). */
  setEpic(on, { announce = false } = {}) {
    const lastConfig = { ...this.settings.lastConfig, epic: !!on };
    this.updateSettings({ lastConfig });
    this.setTheme(!!on, { flash: true });
    if (announce) this.toast(on ? t('epic.toastOn') : t('epic.toastOff'), { epic: !!on });
  }

  _flash(epic) {
    if (this.settings.fx && this.settings.fx.flashes === false) return;
    const el = this._flashEl;
    el.className = 'ui-flash';
    void el.offsetWidth;
    el.classList.add(epic ? 'ui-flash--epic' : 'ui-flash--classic');
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => (el.className = 'ui-flash'), 900);
    if (epic) this.sound('thunder', { intensity: 0.7 });
  }

  // ------------------------------------------------------------------ screens
  showScreen(name, params = {}, opts = {}) {
    if (name !== 'game' && !SCREENS[name]) {
      console.warn(`[ui] unknown screen '${name}'`);
      return;
    }
    const prev = this._screen;
    if (prev && prev.name === name && !opts.force && sameParams(params || {}, prev.params)) return;

    if (name !== 'game') {
      // confirms opened from the pause menu belong to the game and go away with it
      this._closeOverlays((o) => o.kind !== 'confirm' || o.scope === 'game');
      if (this._epic !== !!this.settings.lastConfig.epic) this.setTheme(!!this.settings.lastConfig.epic);
    }

    let next;
    if (name === 'game') next = { name, params: params || {}, el: this._game.el, api: this._game };
    else {
      const api = SCREENS[name](this, params || {});
      next = { name, params: params || {}, el: api.el, api };
    }
    const instant = !!opts.instant || !prev;
    const dir = opts.dir || (prev && DEPTH[name] < DEPTH[prev.name] ? -1 : 1);
    const el = next.el;
    clearTimeout(el._leaveT);
    el.classList.remove('is-leaving');
    el.style.setProperty('--dir', dir);
    if (!instant) el.classList.add('is-entering');
    this._screensEl.appendChild(el); // (re)attach on top of the leaving screen
    this._screen = next;
    this.root.dataset.screen = name;
    if (next.api.onShow) next.api.onShow();
    this.refit(el);

    if (prev && prev.el !== el) {
      const pel = prev.el;
      if (prev.api.destroy) prev.api.destroy();
      if (instant) pel.remove();
      else {
        pel.style.setProperty('--dir', dir);
        pel.classList.remove('is-entering');
        pel.classList.add('is-leaving');
        clearTimeout(pel._leaveT);
        pel._leaveT = setTimeout(() => {
          pel.classList.remove('is-leaving');
          if (!this._screen || this._screen.el !== pel) pel.remove();
        }, SCREEN_MS);
      }
    }
    if (!instant) {
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('is-entering')));
      if (this._epic && !opts.silent) this.sound('whoosh', { intensity: 0.35 });
    }
    this.emit('screen', name);
  }

  /** Back navigation from the current screen (header back buttons). */
  back() {
    const s = this._screen;
    if (!s) return false;
    if (s.name === 'game') {
      this.openPause();
      return true;
    }
    if (s.name === 'title' || s.name === 'menu') return false;
    this.showScreen('menu', {}, { dir: -1 });
    return true;
  }

  _rebuildForLang() {
    const s = this._screen;
    if (s && s.name !== 'game') {
      const scroller = s.el.querySelector('.scr-scroll');
      const scrollTop = scroller ? scroller.scrollTop : 0;
      const params = { ...s.params, ...(s.api.state ? s.api.state() : {}) };
      this.showScreen(s.name, params, { force: true, instant: true });
      const sc2 = this._screen.el.querySelector('.scr-scroll');
      if (sc2) sc2.scrollTop = scrollTop;
    }
    this._game.renderAll();
    for (const o of this._overlays) if (o.rebuild) o.rebuild();
    this.refit();
  }

  // ------------------------------------------------------------------ game screen helpers
  boardSlotRect() {
    this._game.layout();
    return this._game.slotRect();
  }

  // ------------------------------------------------------------------ overlays
  _pushOverlay(kind, content, { onBack, cls = '', backdropClose = false } = {}) {
    const panel = h('div.ov__panel', content);
    const backdrop = h('div.ov__backdrop');
    const el = h('div.ov', { class: `ov--${kind} ${cls}` }, backdrop, panel);
    const entry = {
      kind,
      el,
      panel,
      onBack: onBack || (() => entry.close()),
      close: (instant = false) => {
        const i = this._overlays.indexOf(entry);
        if (i >= 0) this._overlays.splice(i, 1);
        if (entry.onClose) {
          try {
            entry.onClose();
          } catch (e) {
            /* ignore */
          }
        }
        el.classList.remove('is-open');
        el.classList.add('is-closing');
        if (instant) el.remove();
        else setTimeout(() => el.remove(), OVERLAY_MS);
      },
      setContent: (node) => {
        panel.textContent = '';
        panel.appendChild(node);
        this.refit(el);
      },
    };
    if (backdropClose) backdrop.addEventListener('click', () => entry.onBack());
    this._overlays.push(entry);
    this._overlaysEl.appendChild(el);
    void el.offsetWidth;
    requestAnimationFrame(() => el.classList.add('is-open'));
    this.refit(el);
    return entry;
  }

  _findOverlay(kind) {
    return this._overlays.find((o) => o.kind === kind) || null;
  }

  _closeOverlays(filter = () => true) {
    for (const o of [...this._overlays]) {
      if (!filter(o)) continue;
      if (o.kind === 'confirm' && o.resolve) o.resolve(false);
      if (o.kind === 'gameover' && o.resolve) o.resolve('menu');
      o.close(true);
    }
  }

  /** Opens the pause overlay (HUD menu button / Android back during a game). */
  openPause() {
    if (!this._screen || this._screen.name !== 'game') return;
    if (this._findOverlay('pause') || this._findOverlay('gameover')) return;
    this._game.resetCinematic(); // the HUD (and the menu button) is always back after a pause
    this.emit('pause');
    const st = this.hud.state;
    const sideName = (c) => (c > 0 ? t('common.white') : t('common.black'));
    const closePause = () => {
      const p = this._findOverlay('pause');
      if (p) p.close();
      this._closeOverlays((o) => o.kind === 'sheet');
    };
    const resume = () => {
      closePause();
      this.emit('resume');
    };
    const handlers = {
      onResume: resume,
      onRules: () => this.openSheet('rules', { variantId: st.variant ? st.variant.id : undefined }),
      onSettings: () => this.openSheet('settings'),
      onDraw: async () => {
        if (st.mode === 'ai') {
          // offered to the AI: no dialog, the controller answers (toast) or ends the game
          resume();
          this.emit('offer-draw', { color: st.bottomColor, vsAI: true });
          return;
        }
        const turn = st.turn || 1;
        const ok = await this.confirm(t('pause.drawOffer', { side: sideName(turn), other: sideName(-turn) }), {
          ok: t('pause.drawAccept'),
          cancel: t('pause.drawDecline'),
          scope: 'game',
        });
        resume();
        if (ok) this.emit('offer-draw', { color: turn, accepted: true });
        else this.hud.toast(t('pause.drawDeclined'), { tone: 'info' });
      },
      onRestart: async () => {
        if (!(await this.confirm(t('pause.confirmRestart'), { scope: 'game' }))) return;
        resume();
        this.emit('rematch');
      },
      onResign: async () => {
        const color = st.mode === 'ai' ? st.bottomColor : st.turn || 1;
        const text = st.mode === 'ai' ? t('pause.confirmResign') : t('pause.confirmResignSide', { side: sideName(color) });
        if (!(await this.confirm(text, { ok: t('pause.resign'), danger: true, scope: 'game' }))) return;
        resume();
        this.emit('resign', { color });
      },
      onMenu: async () => {
        if (!(await this.confirm(t('pause.confirmMenu'), { ok: t('pause.toMenu'), danger: true, scope: 'game' }))) return;
        resume();
        this.showScreen('menu', {}, { dir: -1 });
        this.emit('menu');
      },
    };
    const entry = this._pushOverlay('pause', buildPause(this, handlers), { onBack: resume, backdropClose: true });
    entry.rebuild = () => entry.setContent(buildPause(this, handlers));
    entry.onTheme = entry.rebuild;
  }

  /** Is the pause overlay open? */
  get paused() {
    return !!this._findOverlay('pause');
  }

  /** Full-screen sheet with the settings or rules screen (used from the pause menu / setup). */
  openSheet(kind, params = {}) {
    if (!SCREENS[kind]) return null;
    let api = null;
    let entry = null;
    const close = () => entry && entry.close();
    const build = () => {
      api = SCREENS[kind](this, { ...params, ...(api && api.state ? api.state() : {}), sheet: true, onBack: close });
      return api.el;
    };
    entry = this._pushOverlay('sheet', build(), {
      cls: `ov--sheet-${kind}`,
      onBack: () => {
        if (api && api.back) api.back();
        else close();
      },
    });
    entry.rebuild = () => entry.setContent(build());
    entry.onTheme = () => api && api.onTheme && api.onTheme(this._epic);
    // once fully open the sheet is opaque and covers the whole canvas: the renderer may stop
    // presenting behind it ('occluded' event); it comes back as soon as the sheet starts to close
    entry._opaqueT = setTimeout(() => {
      if (!this._overlays.includes(entry)) return;
      entry.el.classList.add('is-opaque');
      this._syncOcclusion();
    }, OVERLAY_MS + 60);
    entry.onClose = () => {
      clearTimeout(entry._opaqueT);
      entry.el.classList.remove('is-opaque');
      this._syncOcclusion();
    };
    return entry;
  }

  /** Emits 'occluded'(bool) when an opaque full-screen sheet starts / stops covering the canvas. */
  _syncOcclusion() {
    const on = this._overlays.some((o) => o.kind === 'sheet' && o.el.classList.contains('is-opaque'));
    if (on === !!this._occluded) return;
    this._occluded = on;
    this.emit('occluded', on);
  }

  /** Is an opaque UI sheet covering the whole canvas right now? */
  get occluded() {
    return !!this._occluded;
  }

  /**
   * Game over card. opts: { result, humanColor, mode, stats, records, epic, players, giveaway?, durationSec? }
   * Resolves with 'rematch' | 'menu'. On 'menu' the UI navigates to the menu screen itself.
   */
  showGameOver(opts = {}) {
    // everything opened during the game goes: pause menu, sheets, pending confirms (resolved false)
    this._closeOverlays((o) => o.kind === 'pause' || o.kind === 'sheet' || o.kind === 'gameover' || o.kind === 'confirm');
    this._game.resetCinematic();
    const epic = opts.epic != null ? !!opts.epic : this._epic;
    const o = { giveaway: this.hud.state.giveaway, mode: this.hud.state.mode, ...opts, epic };
    return new Promise((resolve) => {
      let done = false;
      let entry = null;
      const choose = (choice) => {
        if (done) return;
        done = true;
        if (entry) entry.close();
        if (choice === 'menu') this.showScreen('menu', {}, { dir: -1 });
        resolve(choice);
      };
      entry = this._pushOverlay('gameover', buildGameOver(this, o, choose), {
        cls: epic ? 'ov--epic-go' : 'ov--classic-go',
        onBack: () => choose('menu'),
      });
      entry.resolve = (c) => {
        if (done) return;
        done = true;
        resolve(c);
      };
      entry.rebuild = () => entry.setContent(buildGameOver(this, o, choose));
      if (epic) {
        setTimeout(() => {
          if (!done) {
            this.sound('impact', { intensity: 1 });
            this.haptic([30, 30, 60]);
          }
        }, 380);
        const titles = (o.records && o.records.newTitles) || [];
        const recs = (o.records && o.records.newRecords) || [];
        if (titles.length || recs.length) setTimeout(() => !done && this.sound('sparkle'), 1100);
      }
    });
  }

  /**
   * Confirm dialog. opts: { ok, cancel, danger, title, scope } -> Promise<boolean>.
   * scope 'game': closed (resolved false) when the game screen is left or the game ends.
   */
  confirm(text, opts = {}) {
    return new Promise((resolve) => {
      let entry = null;
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        if (entry) entry.close();
        resolve(v);
      };
      entry = this._pushOverlay('confirm', buildConfirm(text, opts, finish), {
        onBack: () => finish(false),
        backdropClose: true,
      });
      entry.resolve = (v) => finish(v);
      entry.scope = opts.scope || null;
      entry.rebuild = () => entry.setContent(buildConfirm(text, opts, finish));
    });
  }

  /**
   * Small toast (game screen: inside the board area; elsewhere: top of the screen). Readable:
   * at least readMs(text) (opts.duration can only make it longer); toasts stack instead of
   * replacing each other.
   */
  toast(text, opts = {}) {
    if (this._screen && this._screen.name === 'game') {
      this.hud.toast(text, opts);
      return;
    }
    this._toastStack.show(text, opts);
  }

  /** Minimum readable time (ms) of a text at the current settings.textTime. */
  readMs(text) {
    return readMs(text, this.settings.textTime);
  }

  // ------------------------------------------------------------------ Android back
  handleBack() {
    const top = this._overlays[this._overlays.length - 1];
    if (top) {
      top.onBack();
      return true;
    }
    const s = this._screen;
    if (!s) return false;
    if (s.name === 'title' || s.name === 'menu') return this._backToExit();
    this._backArmedAt = 0;
    if (s.api.back && s.name !== 'game') return s.api.back() !== false;
    return this.back();
  }

  /** Root screens: the first back press only warns, a second one within 2 s lets the app exit. */
  _backToExit() {
    const now = Date.now();
    if (this._backArmedAt && now - this._backArmedAt <= (this._backExitMs || BACK_EXIT_MIN_MS)) {
      this._backArmedAt = 0;
      return false;
    }
    this._backArmedAt = now;
    const text = t('toast.pressBackAgain');
    // the second press counts while the warning is on screen
    this._backExitMs = Math.max(BACK_EXIT_MIN_MS, this.readMs(text));
    this.toast(text, { duration: this._backExitMs });
    this.haptic(12);
    return true;
  }

  // ------------------------------------------------------------------ impact frame
  /**
   * Manga impact frame on the DOM HUD for `ms` (clamped 40..400): an inverted negative, then a
   * crushed grey frame, then back to normal. Only on (effective) quality 'high', never with
   * settings.battery or settings.fx.flashes === false. Safe to call repeatedly.
   */
  flashImpact(ms = IMPACT_MS.def) {
    const s = this.settings;
    // a filter on the whole UI root is a full-screen GPU pass: high quality only, never in battery
    // mode or with flashes off (photosensitivity)
    if (this.effectiveQuality !== 'high' || s.battery || (s.fx && s.fx.flashes === false)) return;
    const d = Math.max(IMPACT_MS.min, Math.min(IMPACT_MS.max, Number(ms) || IMPACT_MS.def));
    const cl = this.root.classList;
    clearTimeout(this._impactT1);
    clearTimeout(this._impactT2);
    cl.remove('fx-impact-b');
    cl.add('fx-impact');
    this._impactT1 = setTimeout(() => {
      cl.remove('fx-impact');
      cl.add('fx-impact-b');
    }, Math.round(d * 0.55));
    this._impactT2 = setTimeout(() => cl.remove('fx-impact', 'fx-impact-b'), d);
  }

  destroy() {
    clearTimeout(this._impactT1);
    clearTimeout(this._impactT2);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
    window.removeEventListener('pointerdown', this._unlock, { capture: true });
    if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener('loadingdone', this._onFonts);
    this._closeOverlays();
    this.root.textContent = '';
    this._handlers.clear();
  }

  get lang() {
    return getLang();
  }
}

export { loadSettings, saveSettings, StatsStore };
