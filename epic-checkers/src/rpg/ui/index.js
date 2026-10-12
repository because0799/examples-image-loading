// «Валькирии доски» — RpgUI: DOM screens of the RPG mode over the Pixi canvas
// (docs/RPG-ARCHITECTURE.md «UI», GDD §17). Same conventions as src/ui: the root never takes
// pointer events itself, every interactive element does; touch targets ≥ 44 px; no backdrop-filter;
// no infinite CSS animation on the battle screen.
//
//   const ui = new RpgUI(rootEl /* #ui or a child */, { settings, audio, native, assets: RPG_ASSETS, voice: playVoice,
//                                                     meta? /* src/rpg/meta module, optional */, profile?, storage? });
//   ui.setProfile(profile)                      re-renders the current screen (keeps scroll / drafts)
//   ui.showScreen('hub'|'collection'|'hero'|'squad'|'summon'|'campaign'|'training'|'duel'|'battle'|'results', params)
//   ui.on(event, fn) -> unsubscribe
//   ui.hud.setup(state, opts) / update(state) / select(unitId, unitActions, opts) / setMode(type) / clear() /
//         log(events) / setBusy(bool) / setThinking(bool) / setSpeed(x) / setAuto(on) / setCinematic(on) /
//         flip(bottomSide) / toast(text) / lanes() / playerName(side)                  (see hud.js)
//   await ui.playSummon(results) -> 'done' | 'again1' | 'again10'   pull animation + reveals + results grid
//   await ui.showResults({ result, rewards, mode?, stageId?, squad?, squads?, playerSide?, mvp? })
//         -> 'again' | 'next' | 'hub' | 'squad'   ('hub' / 'squad': the UI navigates there itself)
//   await ui.passPhone(side)                    duel «Передай телефон» screen
//   ui.openPause() · ui.openSettings() · await ui.confirm(text, opts) · ui.toast(text)
//   ui.boardSlotRect() -> DOMRect;  ui.handleBack() -> boolean (Android back, while ui.visible)
//   ui.show() / ui.hide() / ui.visible          the RPG layer (showScreen shows it; hide() on 'exit')
//   ui.setEffectiveQuality('high'|'medium'|'low')   else read from the app root's q-* class
//   ui.updateSettings({ rpgVoice?, voiceVolume?, sfxVolume?, musicVolume? })
//
// Screen params:
//   hero      { heroId, from?, tab? }        from: 'collection' (default) | 'squad' | 'summon' | 'hub' | 'campaign'
//   campaign  { chapter?, stageId? }         stageId opens that stage's sheet
//   squad     { from?, stageId? }            from a stage sheet: saving returns to the stage
//   battle    — the HUD (ui.hud.setup first); results — use ui.showResults
//
// Events (payloads):
//   'start-battle' { mode: 'campaign', stageId, squads: { 1: Squad }, difficulty, bg }
//                  { mode: 'training', squads: { 1, '-1' }, difficulty, bg, enemyLevel, enemyKind }
//                  { mode: 'duel', squads: { 1, '-1' }, first: 'coin', passPhone, levels: 'equal'|'owned' }
//                  Squad = [{ heroId, level, constellation }]
//   'summon' (count 1|10)        'set-squad' (heroIds)        'exit' (back to the checkers menu)
//   'use-scroll' { heroId, count }  «Свиток опыта» on the hero screen (meta.useXpScrolls; then setProfile)
//   'battle-action' { type: 'move'|'attack'|'skill'|'ult'|'quirk'|'wait'|'end'|'cancel', unitId, quirkId? }
//   'select-unit' (unitId)       roster portrait tapped in the battle HUD (ignored while busy)
//   'pause' / 'resume'           battle pause menu opened / closed
//   'surrender' { side }         confirmed in the pause menu
//   'speed' (1|2)  'auto' (bool)  'skip'                         battle HUD chips
//   'settings' (settings)        RPG settings changed (live shared object, already saved)
//   'screen' (name)              'board-rect' (DOMRect)          'results' (choice)
//   'voice' { heroId, event }    a voice line was requested by the UI (also played through opts.voice)

import './rpg.css';
import './screens.css';
import './hud.css';
import './summon.css';
import './perf.css';

import { fitAll, feedback } from '../../ui/dom.js';
import { hapticPattern, saveSettings } from '../../ui/storage.js';
import { onLangChange, rt, getLang } from './i18n.js';
import { ensureRpgSettings, updateRpgSettings } from './settings.js';
import { createToastStack, readMs } from '../../ui/toasts.js';
import { h, rvButton } from './components.js';
import { getHero, isVoiced } from './model.js';
import { createHub } from './screens/hub.js';
import { createCollection } from './screens/collection.js';
import { createHero } from './screens/hero.js';
import { createSquad } from './screens/squad.js';
import { createSummon } from './screens/summon.js';
import { createCampaign } from './screens/campaign.js';
import { createTraining } from './screens/training.js';
import { createDuel } from './screens/duel.js';
import { createResults } from './screens/results.js';
import { buildSettingsSheet } from './screens/settings.js';
import { createBattleScreen } from './hud.js';
import { playSummonAnimation } from './summon-anim.js';

export { describeEvents } from './battle-log.js';
export * as rpgModel from './model.js';
export { rt as rpgT } from './i18n.js';
export { ensureRpgSettings, updateRpgSettings, RPG_SETTINGS_DEFAULTS, RPG_SETTINGS_KEY } from './settings.js';

const SCREENS = {
  hub: createHub,
  collection: createCollection,
  hero: createHero,
  squad: createSquad,
  summon: createSummon,
  campaign: createCampaign,
  training: createTraining,
  duel: createDuel,
  results: createResults,
};
const DEPTH = { hub: 0, collection: 1, squad: 1, summon: 1, campaign: 1, training: 1, duel: 1, hero: 2, battle: 3, results: 4 };
const SCREEN_MS = 380;
const OVERLAY_MS = 300;

const sameParams = (a = {}, b = {}) => {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
};

function qualityFromAncestors(el) {
  for (let n = el; n && n.classList; n = n.parentElement) {
    for (const q of ['low', 'medium', 'high']) if (n.classList.contains(`q-${q}`)) return q;
  }
  return null;
}

export class RpgUI {
  constructor(root, { settings = null, audio = null, native = null, assets = null, voice = null, meta = null, profile = null, storage = null } = {}) {
    this.host = root;
    this.settings = settings || {};
    this.audio = audio;
    this.native = native;
    this.assets = assets;
    this.voiceFn = typeof voice === 'function' ? voice : null;
    this.meta = meta;
    this.storage = storage;
    this.profile = profile || null;
    this._handlers = new Map();
    this._screen = null;
    this._overlays = [];
    this._visible = false;
    ensureRpgSettings(this.settings, storage);

    this.el = h('div.rv-root', { 'aria-hidden': 'true' });
    this._screensEl = h('div.rv-screens');
    this._overlaysEl = h('div.rv-overlays');
    this._toastsEl = h('div.rv-toasts', { 'aria-live': 'polite' });
    this.el.append(this._screensEl, this._overlaysEl, this._toastsEl);
    root.appendChild(this.el);
    this._toasts = createToastStack(this._toastsEl, { max: 2, textTime: () => this.settings.textTime || 1.5, epic: () => false });

    this._battle = createBattleScreen(this);
    this.hud = this._battle.hud;
    this._syncQuality();

    this._onResize = () => {
      if (this._resizeRaf) return;
      this._resizeRaf = requestAnimationFrame(() => {
        this._resizeRaf = 0;
        if (!this._visible) return;
        this.refit();
        if (this._screen && this._screen.api.onResize) this._screen.api.onResize();
        this._battle.layout();
      });
    };
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
    this._onFonts = () => {
      if (!this._visible) return;
      this.refit();
      this._battle.layout();
    };
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', this._onFonts);
    this._offLang = onLangChange(() => this._rebuild());
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
        console.error(`[rpg-ui] handler for '${event}' failed`, e);
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

  /** Wraps a handler with the click sound + light haptic. */
  tap(fn, { sound = 'click', haptic = 8 } = {}) {
    return (e) => {
      if (sound) this.sound(sound);
      if (haptic) this.haptic(haptic);
      if (fn) fn(e);
    };
  }

  /**
   * Plays a hero voice line through the voice module (opts.voice = playVoice). Only Epic+ heroes
   * have voices; settings.rpgVoice === false mutes them (the voice module checks it too).
   * opts go to playVoice (e.g. { force: true } for buttons the player pressed).
   */
  voice(heroId, event, opts = {}) {
    if (!heroId || !isVoiced(heroId) || this.settings.rpgVoice === false) return Promise.resolve(false);
    this.emit('voice', { heroId, event });
    if (!this.voiceFn) return Promise.resolve(false);
    try {
      // the voice module ducks the music itself when it gets the AudioEngine (src/rpg/voice.js)
      return Promise.resolve(this.voiceFn(heroId, event, { settings: this.settings, audio: this.audio || undefined, ...opts })).catch(() => false);
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  // ------------------------------------------------------------------ data
  setProfile(profile) {
    this.profile = profile || null;
    const s = this._screen;
    if (s && s.api.refresh) s.api.refresh();
    else if (s && s.name !== 'battle' && s.name !== 'results' && this._visible) this._rerender();
    for (const o of this._overlays) if (o.refresh) o.refresh();
  }

  /** RPG settings patch (rpgVoice, voiceVolume; sfxVolume / musicVolume are forwarded to audio). */
  updateSettings(patch = {}, { live = false } = {}) {
    const s = this.settings;
    updateRpgSettings(s, patch, this.storage, { live });
    if ('sfxVolume' in patch) {
      s.sfxVolume = Math.max(0, Math.min(1, Number(patch.sfxVolume) || 0));
      if (this.audio && this.audio.setSfxVolume) this.audio.setSfxVolume(s.sfxVolume);
    }
    if ('musicVolume' in patch) {
      s.musicVolume = Math.max(0, Math.min(1, Number(patch.musicVolume) || 0));
      if (this.audio && this.audio.setMusicVolume) this.audio.setMusicVolume(s.musicVolume);
    }
    // battle presentation (integration: src/ui/storage.js knows and persists these fields)
    if ('rpgUltCinematic' in patch) s.rpgUltCinematic = ['full', 'short', 'first'].includes(patch.rpgUltCinematic) ? patch.rpgUltCinematic : 'full';
    if ('rpgDamageNumbers' in patch) s.rpgDamageNumbers = patch.rpgDamageNumbers !== false;
    if (!live) {
      // shared fields go to the app's settings store (it keeps only the fields it knows — the RPG
      // ones included since the integration)
      if (!this.storage) {
        try {
          saveSettings(s);
        } catch (e) {
          /* storage unavailable */
        }
      }
      this.emit('settings', s);
    }
  }

  // ------------------------------------------------------------------ visibility / quality
  get visible() {
    return this._visible;
  }

  show() {
    if (this._visible) return;
    this._visible = true;
    this.el.classList.add('is-visible');
    // the app's classic screens under the RPG layer stop rendering (display: none, rpg.css) — the
    // battle screen is transparent and their looping menu animations would cost GPU time for nothing
    this._classicRoot = this.host && this.host.closest ? this.host.closest('.ui-root') || this.host : this.host;
    if (this._classicRoot) this._classicRoot.classList.add('rv-host-active');
    this.el.removeAttribute('aria-hidden');
    this._syncQuality();
    // the classic UI's feedback hooks (switches etc. from src/ui) point at our audio while visible
    this._prevFeedback = { sound: feedback.sound, haptic: feedback.haptic };
    feedback.sound = (n) => this.sound(n);
    feedback.haptic = (p) => this.haptic(p);
  }

  /** Hides the whole RPG layer (the integration shows the classic menu). */
  hide() {
    if (!this._visible) return;
    this._visible = false;
    this.el.classList.remove('is-visible');
    if (this._classicRoot) this._classicRoot.classList.remove('rv-host-active');
    this.el.setAttribute('aria-hidden', 'true');
    this._closeOverlays();
    this._toasts.clear();
    if (this._summon) this._summon.skipAll();
    if (this._prevFeedback) {
      feedback.sound = this._prevFeedback.sound;
      feedback.haptic = this._prevFeedback.haptic;
      this._prevFeedback = null;
    }
    const s = this._screen;
    if (s) {
      if (s.api.destroy) s.api.destroy();
      s.el.remove();
      this._screen = null;
    }
    delete this.el.dataset.screen;
  }

  /** 'high' | 'medium' | 'low' — follows the classic UI root (q-*) or setEffectiveQuality(). */
  setEffectiveQuality(q) {
    if (!['high', 'medium', 'low'].includes(q)) return;
    this._quality = q;
    this._syncQuality();
  }

  get effectiveQuality() {
    return this._quality || qualityFromAncestors(this.host) || 'high';
  }

  _syncQuality() {
    const q = this.effectiveQuality;
    for (const x of ['high', 'medium', 'low']) this.el.classList.toggle(`rq-${x}`, x === q);
    this.el.classList.toggle('rv-battery', !!this.settings.battery);
  }

  refit(el) {
    const run = () => fitAll(el || this.el);
    run();
    requestAnimationFrame(run);
  }

  // ------------------------------------------------------------------ screens
  get currentScreen() {
    return this._screen ? this._screen.name : null;
  }

  showScreen(name, params = {}, opts = {}) {
    if (name !== 'battle' && !SCREENS[name]) {
      console.warn(`[rpg-ui] unknown screen '${name}'`);
      return;
    }
    this.show();
    this._syncQuality();
    const prev = this._screen;
    if (prev && prev.name === name && !opts.force && sameParams(params || {}, prev.params)) return;
    this._closeOverlays((o) => !o.persistent);
    this._toasts.clear();

    let next;
    if (name === 'battle') next = { name, params: params || {}, el: this._battle.el, api: this._battle };
    else {
      const api = SCREENS[name](this, params || {});
      next = { name, params: params || {}, el: api.el, api };
    }
    const instant = !!opts.instant || !prev;
    const dir = opts.dir || (prev && (DEPTH[name] ?? 1) < (DEPTH[prev.name] ?? 1) ? -1 : 1);
    const el = next.el;
    clearTimeout(el._leaveT);
    el.classList.remove('is-leaving');
    el.style.setProperty('--dir', dir);
    if (!instant) el.classList.add('is-entering');
    this._screensEl.appendChild(el);
    this._screen = next;
    this.el.dataset.screen = name;
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
    if (!instant) requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('is-entering')));
    if (name === 'battle') requestAnimationFrame(() => this._battle.layout());
    this.emit('screen', name);
  }

  /** Re-renders the current screen in place (profile / language change), keeping its scroll. */
  _rerender() {
    const s = this._screen;
    if (!s || s.name === 'battle') return;
    const scroller = s.el.querySelector('.rv-scroll');
    const top = scroller ? scroller.scrollTop : 0;
    const params = { ...s.params, ...(s.api.state ? s.api.state() : {}) };
    this.showScreen(s.name, params, { force: true, instant: true });
    const sc2 = this._screen && this._screen.el.querySelector('.rv-scroll');
    if (sc2) sc2.scrollTop = top;
  }

  _rebuild() {
    if (!this._visible) return;
    this._rerender();
    this._battle.renderAll();
    for (const o of this._overlays) if (o.rebuild) o.rebuild();
    this.refit();
  }

  /** Default back navigation of a screen. */
  back() {
    const s = this._screen;
    if (!s) return false;
    if (s.api.back && s.api.back() !== false) return true;
    if (s.name === 'battle') {
      this.openPause();
      return true;
    }
    if (s.name === 'hub') {
      this.exit();
      return true;
    }
    if (s.name === 'hero') {
      const from = s.params.from || 'collection';
      this.showScreen(from, from === 'collection' ? s.params.collection || {} : {}, { dir: -1 });
      return true;
    }
    this.showScreen('hub', {}, { dir: -1 });
    return true;
  }

  /** Leaves the RPG mode (the integration shows the classic menu and may call ui.hide()). */
  exit() {
    this.emit('exit');
  }

  // ------------------------------------------------------------------ battle
  boardSlotRect() {
    this._battle.layout();
    return this._battle.slotRect();
  }

  /** Battle pause menu. */
  openPause() {
    if (!this._screen || this._screen.name !== 'battle' || this._findOverlay('pause')) return;
    this.emit('pause');
    const st = this.hud.state;
    const resume = () => {
      const p = this._findOverlay('pause');
      if (p) p.close();
      this.emit('resume');
    };
    const build = () =>
      h(
        'div.rv-dlg.rv-pause',
        h('div.rv-dlg__kanji', { 'aria-hidden': 'true' }, '休'),
        h('h2.rv-dlg__title', rt('battle.pauseTitle')),
        h(
          'div.rv-dlg__btns',
          rvButton(this, { label: rt('battle.resume'), icon: 'play', kind: 'gold', size: 'md', onClick: resume }),
          rvButton(this, { label: rt('settings.title'), sub: rt('settings.sub'), icon: 'settings', kind: 'glass', size: 'md', onClick: () => this.openSettings() }),
          rvButton(this, {
            label: rt('battle.surrender'),
            icon: 'flag',
            kind: 'danger',
            size: 'md',
            onClick: async () => {
              const duel = st.mode === 'duel';
              const side = duel ? st.side || 1 : st.playerSide || 1;
              const text = duel ? rt('battle.surrenderDuel', { player: this.hud.playerName(side) }) : rt('battle.surrenderConfirm');
              if (!(await this.confirm(text, { ok: rt('battle.surrender'), danger: true }))) return;
              resume();
              this.emit('surrender', { side });
            },
          }),
        ),
      );
    const entry = this._pushOverlay('pause', build(), { onBack: resume, backdropClose: true });
    entry.rebuild = () => entry.setContent(build());
  }

  get paused() {
    return !!this._findOverlay('pause');
  }

  /** Duel: «Передай телефон» screen. Resolves when the next player taps «Я готов(а)». */
  passPhone(side) {
    return new Promise((resolve) => {
      let entry = null;
      const done = () => {
        if (entry) entry.close();
        resolve(true);
      };
      const build = () =>
        h(
          'div.rv-pass',
          { class: side > 0 ? 'is-p1' : 'is-p2' },
          h('div.rv-pass__kanji', { 'aria-hidden': 'true' }, '交代'),
          h('div.rv-pass__title', rt('battle.passTitle')),
          h('div.rv-pass__who', this.hud.playerName(side)),
          rvButton(this, { label: rt('battle.passReady'), kind: 'gold', size: 'lg', icon: 'play', onClick: done }),
        );
      entry = this._pushOverlay('pass', build(), { onBack: done, cls: 'rv-ov--full' });
      entry.rebuild = () => entry.setContent(build());
    });
  }

  // ------------------------------------------------------------------ summon
  /** Pull animation by the best rarity, reveals, results grid. Resolves when closed. */
  playSummon(results) {
    this.show();
    if (this._summon) this._summon.skipAll();
    const run = playSummonAnimation(this, results || []);
    this._summon = run;
    return run.done.then((v) => {
      if (this._summon === run) this._summon = null;
      return v;
    });
  }

  get summoning() {
    return !!this._summon;
  }

  // ------------------------------------------------------------------ results
  /**
   * Results screen. opts: { result, rewards, mode?, stageId?, squad? (hero ids), playerSide?, mvp? }.
   * Resolves 'again' | 'next' | 'hub' | 'squad'. On 'hub' / 'squad' the UI shows that screen itself.
   */
  showResults(opts = {}) {
    return new Promise((resolve) => {
      let done = false;
      const choose = (choice) => {
        if (done) return;
        done = true;
        this.emit('results', choice);
        if (choice === 'hub') this.showScreen('hub', {}, { dir: -1 });
        else if (choice === 'squad') this.showScreen('squad', { from: 'hub', stageId: opts.stageId || null }, { dir: -1 });
        resolve(choice);
      };
      this.showScreen('results', { ...opts, onChoose: choose }, { force: true });
    });
  }

  // ------------------------------------------------------------------ overlays
  _pushOverlay(kind, content, { onBack, cls = '', backdropClose = false, persistent = false } = {}) {
    const panel = h('div.rv-ov__panel', content);
    const backdrop = h('div.rv-ov__backdrop');
    const el = h('div.rv-ov', { class: `rv-ov--${kind} ${cls}` }, backdrop, panel);
    const entry = {
      kind,
      el,
      panel,
      persistent,
      onBack: onBack || (() => entry.close()),
      close: (instant = false) => {
        const i = this._overlays.indexOf(entry);
        if (i < 0) return;
        this._overlays.splice(i, 1);
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
      if (o.resolve) o.resolve(false);
      o.close(true);
    }
  }

  /**
   * Bottom sheet. build(close) -> Node (called again on language / profile changes).
   * Returns the overlay entry ({ close }).
   */
  openSheet(build, { cls = '', title = null, kanji = null, onClose = null } = {}) {
    let entry = null;
    const close = () => entry && entry.close();
    const make = () =>
      h(
        'div.rv-sheet',
        { class: cls },
        h('div.rv-sheet__grip', { 'aria-hidden': 'true' }),
        title
          ? h(
              'div.rv-sheet__head',
              kanji ? h('span.rv-sheet__kanji', { 'aria-hidden': 'true' }, kanji) : null,
              h('h2.rv-sheet__title', { 'data-fit': '12' }, title),
              h('button.rv-sheet__close', { type: 'button', 'aria-label': rt('common.close'), on: { click: this.tap(close) } }, '✕'),
            )
          : null,
        h('div.rv-sheet__body.rv-scroll', build(close)),
      );
    entry = this._pushOverlay('sheet', make(), { backdropClose: true, cls: 'rv-ov--sheet' });
    entry.rebuild = () => entry.setContent(make());
    entry.refresh = entry.rebuild;
    entry.onClose = onClose;
    return entry;
  }

  /** «Валькирии» mode settings (voice on/off, voice volume, sounds, music). */
  openSettings() {
    return this.openSheet((close) => buildSettingsSheet(this, close), { title: rt('settings.title'), kanji: '設定', cls: 'rv-sheet--settings' });
  }

  confirm(text, { ok = rt('common.confirm'), cancel = rt('common.cancel'), danger = false, title = null } = {}) {
    return new Promise((resolve) => {
      let entry = null;
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        if (entry) entry.close();
        resolve(v);
      };
      const build = () =>
        h(
          'div.rv-dlg.rv-confirm',
          title ? h('h2.rv-dlg__title', title) : null,
          h('p.rv-dlg__text', text),
          h(
            'div.rv-dlg__row',
            rvButton(this, { label: cancel, kind: 'glass', size: 'md', onClick: () => finish(false) }),
            rvButton(this, { label: ok, kind: danger ? 'danger' : 'gold', size: 'md', onClick: () => finish(true) }),
          ),
        );
      entry = this._pushOverlay('confirm', build(), { onBack: () => finish(false), backdropClose: true });
      entry.resolve = finish;
      entry.rebuild = () => entry.setContent(build());
    });
  }

  toast(text, opts = {}) {
    if (this._screen && this._screen.name === 'battle') {
      this.hud.toast(text, opts);
      return;
    }
    this._toasts.show(text, { tone: 'rv', ...opts });
  }

  readMs(text) {
    return readMs(text, this.settings.textTime || 1.5);
  }

  // ------------------------------------------------------------------ Android back
  handleBack() {
    if (!this._visible) return false;
    if (this._summon) {
      this._summon.back();
      return true;
    }
    const top = this._overlays[this._overlays.length - 1];
    if (top) {
      top.onBack();
      return true;
    }
    return this.back();
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
    if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener('loadingdone', this._onFonts);
    if (this._offLang) this._offLang();
    if (this._summon) this._summon.skipAll();
    this._closeOverlays();
    this._battle.destroy();
    this._battle.dispose();
    if (this._classicRoot) this._classicRoot.classList.remove('rv-host-active');
    this.el.remove();
    this._handlers.clear();
  }

  get lang() {
    return getLang();
  }

  /** Hero by id (data), for integrations. */
  hero(id) {
    return getHero(id);
  }
}

export default RpgUI;
