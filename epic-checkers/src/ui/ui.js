// UI — DOM screens, HUD and overlays on top of the Pixi canvas (ARCHITECTURE.md §6).
//
//   const ui = new UI(document.getElementById('ui'), { settings, stats, audio, native });
//   ui.on('play', (config) => ...);   // events below
//   ui.showScreen('title' | 'menu' | 'setup' | 'settings' | 'rules' | 'stats' | 'game', params?)
//   ui.hud.setup({ variant, players, bottomColor, epic, mode, level?, giveaway? }) ...
//   ui.boardSlotRect() -> DOMRect (CSS px, layout box of #board-slot)
//   await ui.showGameOver({...}) -> 'rematch' | 'menu'   (on 'menu' the UI shows the menu itself)
//   await ui.confirm(text, { ok?, cancel?, danger? }) -> boolean
//   ui.handleBack() -> boolean (false on the title / menu root -> the app may exit)
//
// Events (ui.on(name, fn) returns an unsubscribe function):
//   'play'(GameConfig)        START pressed in setup (humanColor 0 = random, resolved by the controller)
//   'undo' 'hint'             HUD buttons
//   'pause' / 'resume'        pause overlay opened / closed (also emitted before resign/menu/rematch/offer-draw)
//   'resign'({ color })       confirmed resignation (color = human in ai mode, side to move in pvp)
//   'offer-draw'({ color, accepted: true })  pvp draw offer ACCEPTED by the other player (declines stay in the UI)
//   'menu'                    user left the game from the pause menu (the UI already shows the menu)
//   'rematch'                 «Начать заново» from the pause menu (game over uses the showGameOver promise)
//   'settings'(settings)      after every settings change (live object, already saved)
//   'skip'                    «Пропустить» chip tapped during a cinematic (see hud.setSkippable)
//   'theme'('epic'|'classic') theme of the UI changed (EPIC toggle or hud.setup)
//   'board-rect'(DOMRect)     #board-slot moved/resized (orientation change, fonts loaded ...)
//   'screen'(name)            a screen became current

import './styles.css';
import './screens.css';
import './hud.css';
import './overlays.css';
import './epic.css';

import { VARIANTS } from '../engine/index.js';
import { h, feedback, fitAll } from './dom.js';
import { t, setLang, getLang } from './i18n.js';
import { loadSettings, saveSettings, StatsStore } from './storage.js';
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

    this._game = createGameScreen(this);
    this.hud = this._game.hud;

    this._applyThemeClasses();
    this._applyQuality();

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

  haptic(pattern) {
    if (!this.settings.vibration || !this.native || typeof this.native.vibrate !== 'function') return;
    try {
      this.native.vibrate(pattern);
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
  /** Mutates the live settings object, saves it and emits 'settings'. `_live: true` skips saving. */
  updateSettings(patch) {
    const live = !!patch._live;
    const p = { ...patch };
    delete p._live;
    const prevLang = this.settings.lang;
    const prevQuality = this.settings.quality;
    Object.assign(this.settings, p);
    if (!live) saveSettings(this.settings);
    if ('sfxVolume' in p && this.audio && this.audio.setSfxVolume) this.audio.setSfxVolume(p.sfxVolume);
    if ('musicVolume' in p && this.audio && this.audio.setMusicVolume) this.audio.setMusicVolume(p.musicVolume);
    if (p.quality && p.quality !== prevQuality) this._applyQuality();
    if (p.lang && p.lang !== prevLang) {
      setLang(p.lang);
      this._rebuildForLang();
    }
    this.emit('settings', this.settings);
  }

  _applyQuality() {
    const q = this.settings.quality || 'high';
    this.root.classList.remove('q-high', 'q-medium', 'q-low');
    this.root.classList.add(`q-${q}`);
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
      this._closeOverlays((o) => o.kind !== 'confirm');
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
        const turn = st.turn || 1;
        const ok = await this.confirm(t('pause.drawOffer', { side: sideName(turn), other: sideName(-turn) }), {
          ok: t('pause.drawAccept'),
          cancel: t('pause.drawDecline'),
        });
        resume();
        if (ok) this.emit('offer-draw', { color: turn, accepted: true });
        else this.hud.toast(t('pause.drawDeclined'), { tone: 'info' });
      },
      onRestart: async () => {
        if (!(await this.confirm(t('pause.confirmRestart')))) return;
        resume();
        this.emit('rematch');
      },
      onResign: async () => {
        const color = st.mode === 'ai' ? st.bottomColor : st.turn || 1;
        const text = st.mode === 'ai' ? t('pause.confirmResign') : t('pause.confirmResignSide', { side: sideName(color) });
        if (!(await this.confirm(text, { ok: t('pause.resign'), danger: true }))) return;
        resume();
        this.emit('resign', { color });
      },
      onMenu: async () => {
        if (!(await this.confirm(t('pause.confirmMenu'), { ok: t('pause.toMenu'), danger: true }))) return;
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
    return entry;
  }

  /**
   * Game over card. opts: { result, humanColor, mode, stats, records, epic, players, giveaway?, durationSec? }
   * Resolves with 'rematch' | 'menu'. On 'menu' the UI navigates to the menu screen itself.
   */
  showGameOver(opts = {}) {
    this._closeOverlays((o) => o.kind === 'pause' || o.kind === 'sheet' || o.kind === 'gameover');
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

  /** Confirm dialog. opts: { ok, cancel, danger, title } -> Promise<boolean>. */
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
      entry.rebuild = () => entry.setContent(buildConfirm(text, opts, finish));
    });
  }

  /** Small toast (game screen: inside the board area; elsewhere: top of the screen). */
  toast(text, opts = {}) {
    if (this._screen && this._screen.name === 'game') {
      this.hud.toast(text, opts);
      return;
    }
    const epic = opts.epic != null ? opts.epic : this._epic;
    const node = h('div.toast', { class: epic ? 'toast--epic' : '' }, epic ? h('span.toast__slash') : null, h('span.toast__text', text));
    this._toastsEl.appendChild(node);
    while (this._toastsEl.children.length > 2) this._toastsEl.removeChild(this._toastsEl.firstChild);
    setTimeout(() => {
      node.classList.add('is-out');
      setTimeout(() => node.remove(), 450);
    }, opts.duration || 1900);
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
    if (s.api.back && s.name !== 'game') return s.api.back() !== false;
    return this.back();
  }

  destroy() {
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
