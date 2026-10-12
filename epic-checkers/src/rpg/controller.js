// «Валькирии доски» — integration controller: owns the RPG session (docs/RPG-ARCHITECTURE.md
// «integration»). Wires the meta profile, RpgUI (DOM screens) and BattleView (Pixi, on the app's
// Renderer) to the battle engine and the battle AI.
//
//   const rpg = new RpgController({ root /* #ui */, classicUi, renderer, fx, audio, native, settings, perf?, opts });
//   rpg.open({ screen? })   show the hub (first run: starter squad + crystals + welcome sheet;
//                           an unfinished battle from a killed app is offered for resumption)
//   rpg.close()             back to the classic menu («К шашкам» / Android back on the hub)
//   rpg.handleBack()        Android back while rpg.visible (overlays → screens → pause in battle)
//   rpg.onAppPause(bool)    app to the background: the battle is saved and paused
//   rpg.applySettings(s)    live settings changed (classic settings screen or the RPG sheet)
//   rpg.snapshot()          test / debug state; rpg.battle (live battle record) when one runs
//
// Battle loop (engine's step-level turns, src/rpg/battle/index.js):
//   human side: select a unit (board tap / roster) → unitActions → view.highlight (+ damage
//     forecast via previewAction) → move / attack / jump chain / skill / ult / quirk / wait / end →
//     applyAction → view.play(events, { state }) → hud.update + hud.log; an open activation (after a
//     move, pending relocations, extra activations) keeps the same heroine selected;
//   AI side (enemy, or the player's side with «Авто»): RpgAIClient in a Web Worker
//     (__RPG_AI_WORKER_SRC__, injected by tools/build-web.mjs) with an in-thread fallback, called
//     until the side to act changes;
//   end: battleResult → meta.applyBattleResult (saved at once) → ui.showResults → next / again /
//     squad / hub.
// Mid-battle persistence: the battle (serializeBattle + its setup) is written to localStorage
// (BATTLE_SAVE_KEY) after every completed action and when the app goes to the background. Opening
// the hub with such a save offers «Продолжить» (resumes exactly) or «Бросить» (no rewards, no
// penalty). Rewards are applied and the profile saved the moment the battle ends, before the
// results screen, so a kill after the last blow never loses them.
//
// Options (opts): debug, fast (no AI pause), autoSkip (every cinematic skipped at once: tests),
// storage (profile + battle save; default localStorage), now().

import './controller.css';

import * as meta from './meta/index.js';
import {
  createBattle,
  applyAction,
  legalActions,
  unitActions,
  previewAction,
  battleResult,
  serializeBattle,
  deserializeBattle,
  activatableUnits,
  getUnit,
} from './battle/index.js';
import { RpgAIClient } from './ai/client.js';
import { chooseAction } from './ai/index.js';
import { RPG_ASSETS } from './assets.js';
import { playVoice, configureVoice, applyVoiceSettings, preloadVoice, stopVoice, currentVoice } from './voice.js';
import { RpgUI } from './ui/index.js';
import { BattleView } from './render/index.js';
import { warmShaders } from './render/warmup.js';
import { h, rvButton, heroToken } from './ui/components.js';
import { rt, L, fmt } from './ui/i18n.js';
import { HERO_BY_ID } from './data/heroes.js';

/* global __RPG_AI_WORKER_SRC__ */
const RPG_WORKER_SRC = typeof __RPG_AI_WORKER_SRC__ !== 'undefined' && __RPG_AI_WORKER_SRC__ ? __RPG_AI_WORKER_SRC__ : '';

export const BATTLE_SAVE_KEY = 'ec.rpg.battle.v1';
const BATTLE_SAVE_VERSION = 1;
/** «Авто» everywhere except the duel (GDD §16 gates it behind a first manual clear; the client brief
 *  asks for it from stage 1-1 — flip this to enforce meta.canAutoBattle again). */
export const AUTO_ANYWHERE = true;
/** Minimum pause before an AI action (ms) at ×1 / ×2 — the opponent should not «teleport». */
export const AI_PAUSE_MS = { 1: 520, 2: 240 };
const AI_WATCHDOG_MS = 6000;
const RESULTS_DELAY_MS = 700;
/** Targeting hints: HUD toasts that vanish as soon as an action plays (controller.css). */
const HINT = { tone: 'hint' };

const SELF_SHAPES = new Set(['self', 'all', 'auto']);
const sameStart = (path, prefix) => prefix.every((q, i) => path[i] === q);
const rowOf = (sq) => sq >> 3;
const colOf = (sq) => sq & 7;
/** Diagonal direction key from a to b ('' when not on a diagonal). */
function dirKey(a, b) {
  const dr = rowOf(b) - rowOf(a);
  const dc = colOf(b) - colOf(a);
  if (!dr || Math.abs(dr) !== Math.abs(dc)) return '';
  return `${Math.sign(dr)},${Math.sign(dc)}`;
}

function heroName(heroId) {
  const hero = HERO_BY_ID[heroId];
  return hero ? L(hero.name) : String(heroId || '');
}

function defaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch (e) {
    return null;
  }
}

// =================================================================================== AI wrapper
/**
 * Battle AI: RpgAIClient on a Web Worker started from the bundled worker source; falls back to the
 * in-thread client when workers are unavailable, crash or stay silent for AI_WATCHDOG_MS.
 */
export class RpgAI {
  constructor({ useWorker = true } = {}) {
    this.worker = useWorker ? RpgAI.makeWorker() : null;
    this.client = new RpgAIClient({ worker: this.worker });
    this.mode = this.worker ? 'worker' : 'inline';
  }

  static makeWorker() {
    if (!RPG_WORKER_SRC || typeof Worker !== 'function' || typeof Blob !== 'function' || typeof URL === 'undefined') return null;
    try {
      const url = URL.createObjectURL(new Blob([RPG_WORKER_SRC], { type: 'text/javascript' }));
      return new Worker(url);
    } catch (e) {
      return null;
    }
  }

  _fallback(reason) {
    if (this.mode === 'inline') return;
    console.warn('[rpg] AI worker abandoned:', reason);
    try {
      this.client.dispose();
    } catch (e) {
      /* ignore */
    }
    this.worker = null;
    this.client = new RpgAIClient();
    this.mode = 'inline';
  }

  /** Next step-level action for the side to act; null when cancelled. */
  async choose(state, opts) {
    if (this.mode === 'worker') {
      let timer = 0;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve('timeout'), AI_WATCHDOG_MS);
      });
      try {
        const r = await Promise.race([this.client.choose(state, opts), timeout]);
        clearTimeout(timer);
        if (r !== 'timeout') return r;
        this._fallback('timeout');
      } catch (e) {
        clearTimeout(timer);
        this._fallback(e && e.message);
      }
    }
    return this.client.choose(state, opts);
  }

  cancel() {
    try {
      this.client.cancel();
    } catch (e) {
      /* ignore */
    }
  }

  dispose() {
    try {
      this.client.dispose();
    } catch (e) {
      /* ignore */
    }
  }
}

// =================================================================================== controller
export class RpgController {
  constructor({ root, classicUi = null, renderer, fx = null, audio = null, native = null, settings, perf = null, opts = {} } = {}) {
    this.root = root;
    this.classicUi = classicUi;
    this.renderer = renderer;
    this.fx = fx;
    this.audio = audio;
    this.native = native;
    this.settings = settings;
    this.perf = perf;
    this.debug = !!opts.debug;
    this.fast = !!opts.fast;
    this.autoSkip = !!opts.autoSkip;
    this.storage = opts.storage || defaultStorage();
    this._now = typeof opts.now === 'function' ? opts.now : () => Date.now();

    this.ui = null; // RpgUI (lazy, first open)
    this.view = null; // BattleView (lazy, first battle)
    this._viewInit = null;
    this.ai = null;
    this.profile = null;
    this.visible = false;
    this.battle = null;
    this.token = 0;
    this.speed = 1;
    this.errors = [];
    this._waiters = [];
    this._lastRect = null;
    this._occluded = false;
    this._worldWasVisible = null;

    // voice defaults (settings.rpgVoice / voiceVolume, music duck on the AudioEngine)
    configureVoice({ settings, audio: audio || undefined });
  }

  // =============================================================================== helpers
  _log(label, err) {
    const msg = `[rpg] ${label}: ${err && err.stack ? err.stack : err}`;
    this.errors.push(msg);
    if (this.errors.length > 50) this.errors.shift();
    if (this.debug) console.error(msg);
    else console.warn(msg);
  }

  _try(label, fn) {
    try {
      return fn();
    } catch (e) {
      this._log(label, e);
      return undefined;
    }
  }

  _music(track) {
    this._try('music', () => {
      if (!this.audio) return;
      if (this.audio.currentTrack !== track) this.audio.music(track);
    });
  }

  _toast(text, opts) {
    if (!text || !this.ui) return;
    this._try('toast', () => this.ui.toast(text, opts));
  }

  _saveProfile() {
    if (!this.profile) return false;
    const ok = this._try('saveProfile', () => meta.saveProfile(this.profile, this.storage || undefined));
    if (this.ui) this.ui.setProfile(this.profile);
    return !!ok;
  }

  _setProfile(p, save = true) {
    if (!p) return;
    this.profile = p;
    if (save) this._saveProfile();
    else if (this.ui) this.ui.setProfile(p);
  }

  _setOccluded(on) {
    on = !!on;
    if (on === this._occluded) return;
    this._occluded = on;
    const r = this.renderer;
    this._try('setOccluded', () => typeof r.setOccluded === 'function' && r.setOccluded(on));
  }

  get battleActive() {
    return !!(this.battle && !this.battle.over);
  }

  // =============================================================================== lifecycle
  _ensureUi() {
    if (this.ui) return this.ui;
    const ui = new RpgUI(this.root, {
      settings: this.settings,
      audio: this.audio,
      native: this.native,
      assets: RPG_ASSETS,
      voice: playVoice,
      meta,
      profile: this.profile,
    });
    this.ui = ui;
    ui.on('exit', () => this.close());
    ui.on('start-battle', (p) => this.startBattle(p));
    ui.on('summon', (n) => this.summon(n));
    ui.on('set-squad', (ids) => this.setSquad(ids));
    ui.on('use-scroll', (p) => this.useScroll(p));
    ui.on('select-unit', (id) => this._onSelectUnit(id));
    ui.on('battle-action', (a) => this._onBattleAction(a));
    ui.on('pause', () => this._onPause(true));
    ui.on('resume', () => this._onPause(false));
    ui.on('surrender', (p) => this.surrender(p && p.side));
    ui.on('speed', (x) => this.setSpeed(x));
    ui.on('auto', (on) => this.setAuto(on));
    ui.on('skip', () => this.skip());
    ui.on('settings', (s) => this.applySettings(s));
    ui.on('board-rect', (r) => this._onBoardRect(r));
    ui.on('screen', (name) => this._onScreen(name));
    return ui;
  }

  async _ensureView() {
    if (this.view && this.view.ready) return this.view;
    if (!this._viewInit) {
      this._viewInit = (async () => {
        const view = new BattleView({
          renderer: this.renderer,
          fx: this.fx,
          audio: this.audio,
          native: this.native,
          settings: this.settings,
          assets: RPG_ASSETS,
          voice: playVoice,
        });
        await view.init();
        view.onTap((e) => this._onBoardTap(e));
        view.onCinematic((on) => this._onCinematic(on));
        this.view = view;
        return view;
      })();
    }
    try {
      return await this._viewInit;
    } catch (e) {
      this._viewInit = null;
      throw e;
    }
  }

  _ensureAi() {
    if (!this.ai) this.ai = new RpgAI();
    return this.ai;
  }

  /** Shows the RPG hub (or params.screen). */
  async open(params = {}) {
    const ui = this._ensureUi();
    const now = this._now();
    let profile = this._try('loadProfile', () => meta.loadProfile(this.storage || undefined)) || meta.createProfile();
    const firstRun = !!profile.firstRun;
    // daily rollover: tasks finished yesterday are credited, «first battle of the day» re-arms
    const daily = this._try('claimDaily', () => meta.claimDaily(profile, now));
    if (daily && daily.profile) profile = daily.profile;
    this.profile = profile;
    this._saveProfile();
    this.visible = true;
    ui.setProfile(profile);
    const screen = params.screen && params.screen !== 'battle' && params.screen !== 'results' ? params.screen : 'hub';
    ui.showScreen(screen, params.screenParams || {}, { instant: true });
    this._setOccluded(true);
    this._music('menu');
    if (daily && daily.rewards && daily.rewards.crystals > 0) this._toast(rt('ctl.daily', { n: fmt(daily.rewards.crystals) }));
    if (firstRun) this._welcome();
    else if (params.resume !== false) this._offerResume();
    this._scheduleWarmup();
  }

  /**
   * Once per session, while the player is on a menu screen: compile the battle shaders (particles,
   * FX filters…) in small slices — compiled lazily they stalled the first Ultimate for up to 1 s.
   */
  _scheduleWarmup() {
    if (this._warm || this.autoSkip) return;
    this._warm = 'scheduled';
    setTimeout(() => {
      if (this._warm !== 'scheduled') return;
      const app = this.renderer && this.renderer.app;
      const fm = this.fx && this.fx.filters;
      if (!app || !app.renderer || !fm) {
        this._warm = 'skipped';
        return;
      }
      const kinds = ['shockwave', 'zoom', 'rgb', 'bloom', 'impact', 'godray'].filter((k) => {
        try {
          return fm.can(k);
        } catch (e) {
          return false;
        }
      });
      this._warm = 'running';
      const t0 = performance.now();
      this._stopWarm = warmShaders(app.renderer, {
        kinds,
        slice: 60,
        onDone: (ok) => {
          this._warm = ok ? 'done' : 'cancelled';
          this._stopWarm = null;
          if (this.debug) console.info(`[rpg] shader warm-up ${ok ? 'done' : 'cancelled'} in ${Math.round(performance.now() - t0)} ms (${kinds.join(', ')})`);
        },
      });
    }, 1200);
  }

  /** Leaves the RPG mode: the classic menu comes back. */
  close() {
    if (this.battle) this._abandonBattle({ keepSave: false });
    this._hideBattleView();
    if (this.ui) this.ui.hide();
    this.visible = false;
    this._setOccluded(false);
    this._try('stopVoice', () => stopVoice());
    this._try('keepScreenOn', () => this.native && this.native.keepScreenOn(false));
    const cu = this.classicUi;
    if (cu) this._try('classic menu', () => cu.currentScreen !== 'menu' && cu.showScreen('menu', {}, { dir: -1 }));
    this._music('menu');
  }

  handleBack() {
    if (!this.visible || !this.ui) return false;
    try {
      this.ui.handleBack();
    } catch (e) {
      this._log('back', e);
    }
    return true;
  }

  /** App to the background (true) / foreground (false). */
  onAppPause(paused) {
    const b = this.battle;
    if (!b || b.over) return;
    if (paused) {
      this._saveBattle();
      if (this.ui && this.ui.currentScreen === 'battle' && !this.ui.paused) this._try('openPause', () => this.ui.openPause());
    }
    this._updateWake();
  }

  applySettings(s) {
    const st = s && typeof s === 'object' ? s : this.settings;
    this._try('voice settings', () => applyVoiceSettings(st, this.audio || undefined));
    if (this.view) this._try('view.applySettings', () => this.view.applySettings(st));
  }

  // =============================================================================== first run / resume
  _welcome() {
    const ui = this.ui;
    const p = this.profile;
    this._setProfile(meta.completeFirstRun(p));
    ui.openSheet(
      (close) =>
        h(
          'div.rv-welcome',
          h('div.rv-welcome__tokens', ...p.squad.map((id) => heroToken(ui, id, { size: 50 }))),
          h('p.rv-welcome__p', rt('ctl.welcome1')),
          h('p.rv-welcome__p', rt('ctl.welcome2', { crystals: fmt(p.crystals), scrolls: p.xpScrolls })),
          h('p.rv-welcome__p', rt('ctl.welcome3')),
          h(
            'div.rv-welcome__btns',
            rvButton(ui, {
              label: rt('ctl.welcomeSummon'),
              icon: 'summon',
              kind: 'glass',
              size: 'md',
              onClick: () => {
                close();
                ui.showScreen('summon');
              },
            }),
            rvButton(ui, {
              label: rt('ctl.welcomeGo'),
              icon: 'campaign',
              kind: 'gold',
              size: 'md',
              onClick: () => {
                close();
                ui.showScreen('campaign', { chapter: 1, stageId: '1-1' });
              },
            }),
          ),
        ),
      { title: rt('ctl.welcomeTitle'), kanji: '歓迎', cls: 'rv-sheet--welcome' },
    );
  }

  _readBattleSave() {
    const st = this.storage;
    if (!st) return null;
    try {
      const raw = st.getItem(BATTLE_SAVE_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || o.v !== BATTLE_SAVE_VERSION || !o.state || !o.setup) return null;
      return o;
    } catch (e) {
      return null;
    }
  }

  _clearBattleSave() {
    try {
      if (this.storage) this.storage.removeItem(BATTLE_SAVE_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  _saveBattle() {
    const b = this.battle;
    if (!b || b.over || !this.storage) return;
    try {
      const setup = { ...b.setup };
      delete setup.stage;
      delete setup.sides;
      this.storage.setItem(
        BATTLE_SAVE_KEY,
        JSON.stringify({ v: BATTLE_SAVE_VERSION, savedAt: this._now(), setup, state: serializeBattle(b.state), auto: b.auto, speed: this.speed, lastHumanSide: b.lastHumanSide }),
      );
    } catch (e) {
      this._log('saveBattle', e);
    }
  }

  async _offerResume() {
    const save = this._readBattleSave();
    if (!save) return;
    let state = null;
    try {
      state = deserializeBattle(save.state);
    } catch (e) {
      this._clearBattleSave();
      return;
    }
    if (battleResult(state)) {
      // finished but the rewards never landed (should not happen: they are applied at once)
      this._clearBattleSave();
      return;
    }
    const s = save.setup;
    const what = s.mode === 'campaign' ? rt('ctl.descCampaign', { stage: s.stageId }) : s.mode === 'duel' ? rt('ctl.descDuel') : rt('ctl.descTraining');
    const desc = `${what}, ${rt('ctl.descRound', { n: state.round })}`;
    const ok = await this.ui.confirm(rt('ctl.resumeOffer', { desc }), { ok: rt('ctl.resumeOk'), cancel: rt('ctl.resumeNo') });
    if (!this.visible || this.battle) return;
    if (!ok) {
      this._clearBattleSave();
      return;
    }
    this.speed = save.speed === 2 ? 2 : 1;
    await this._enterBattle(s, state, { fresh: false, auto: !!save.auto && s.mode !== 'duel', lastHumanSide: save.lastHumanSide });
  }

  // =============================================================================== meta actions
  summon(count) {
    const ui = this.ui;
    const n = count === 10 ? 10 : 1;
    if (!this.profile || !ui) return;
    const can = this._try('canSummon', () => meta.canSummon(this.profile, n));
    if (can === false || (can && can.ok === false)) {
      this._toast(rt('summon.notEnough', { n: fmt(meta.SUMMON_COST[n] || 0) }));
      return;
    }
    const r = this._try('summon', () => meta.summon(this.profile, n));
    if (!r || !r.ok) {
      this._toast(rt('summon.notEnough', { n: fmt(meta.SUMMON_COST[n] || 0) }));
      return;
    }
    // saved before the animation: a kill during the pull never loses heroes or crystals
    this._setProfile(r.profile);
    for (const res of r.results) if (res.isNew) preloadVoice(res.heroId, ['summon']);
    return ui.playSummon(r.results).then((choice) => {
      if (choice === 'done' && ui.currentScreen === 'summon') ui.setProfile(this.profile);
      return choice;
    });
  }

  setSquad(ids) {
    if (!this.profile) return;
    const p = this._try('setSquad', () => meta.setSquad(this.profile, ids));
    if (p) this._setProfile(p);
  }

  useScroll({ heroId, count = 1 } = {}) {
    if (!this.profile || !heroId) return;
    const r = this._try('useXpScrolls', () => meta.useXpScrolls(this.profile, heroId, count, { now: this._now() }));
    if (r && r.ok && r.profile) {
      this._setProfile(r.profile);
      this._try('sound', () => this.audio && this.audio.play('promote', { intensity: 0.6 }));
    } else if (r && r.error === 'scrolls') this._toast(rt('common.scrolls') + ': 0');
  }

  // =============================================================================== battle setup
  /** RpgUI 'start-battle' payload → setup → createBattle → battle screen. */
  async startBattle(payload = {}, { again = false } = {}) {
    if (!this.profile || this._starting) return;
    if (this.battle && !this.battle.over) return;
    this._starting = true;
    try {
      await this._startBattle(payload, again);
    } finally {
      this._starting = false;
    }
  }

  async _startBattle(payload, again) {
    const profile = this.profile;
    let setup = null;
    try {
      if (payload.mode === 'campaign') {
        const r = meta.campaignSetup(profile, payload.stageId);
        if (!r.ok) {
          this._toast(r.error === 'locked' ? rt('ctl.locked') : r.error === 'squad' ? rt('ctl.noSquad') : rt('ctl.error'));
          return;
        }
        setup = {
          mode: 'campaign',
          stageId: r.stageId,
          stage: r.stage,
          sides: r.squads,
          difficulty: r.boss && r.difficulty === 'hard' ? 'boss' : r.difficulty,
          first: r.first,
          bg: r.bg,
          seed: r.seed,
        };
      } else if (payload.mode === 'training') {
        const sq = payload.squads || {};
        // the profile's squad entries (levels, constellations and the saved formation squares)
        const ids = (sq[1] || sq['1'] || []).map((e) => (typeof e === 'string' ? e : e && e.heroId)).filter(Boolean);
        const own = ids.length ? meta.squadFor(profile, ids) : meta.squadFor(profile);
        const mine = ids.length && own.length !== ids.length ? sq[1] || sq['1'] : own;
        const enemies = (sq[-1] || sq['-1'] || []).map((e) => ({ ...e, reflection: true }));
        if (!mine.length || !enemies.length) {
          this._toast(rt('ctl.noSquad'));
          return;
        }
        const level = Number(payload.enemyLevel) || (enemies[0] && enemies[0].level) || 1;
        setup = {
          mode: 'training',
          stageId: null,
          sides: { 1: mine, [-1]: enemies },
          difficulty: ['easy', 'normal', 'hard'].includes(payload.difficulty) ? payload.difficulty : 'normal',
          first: 1,
          bg: payload.bg || 'bg-dawn',
          seed: meta.battleSeed(profile, `training:${level}:${this._now()}`),
          enemyLevel: level,
          payload: { ...payload },
        };
      } else if (payload.mode === 'duel') {
        const sq = payload.squads || {};
        const p1 = sq[1] || sq['1'] || [];
        const p2 = sq[-1] || sq['-1'] || [];
        if (!p1.length || !p2.length) {
          this._toast(rt('ctl.noSquad'));
          return;
        }
        const seed = meta.battleSeed(profile, `duel:${this._now()}`);
        setup = {
          mode: 'duel',
          stageId: null,
          sides: { 1: p1, [-1]: p2 },
          difficulty: null,
          first: payload.first === 1 || payload.first === -1 ? payload.first : 'random',
          bg: meta.BACKGROUNDS[seed % meta.BACKGROUNDS.length] || 'bg-dawn',
          seed,
          passPhone: payload.passPhone !== false,
          payload: { ...payload },
        };
      } else return;
    } catch (e) {
      this._log('setup', e);
      this._toast(rt('ctl.error'));
      return;
    }
    setup.squadIds = (setup.sides[1] || []).map((e) => e.heroId);
    let state;
    try {
      state = createBattle({ sides: setup.sides, mode: setup.mode, stage: setup.stage || null, seed: setup.seed, first: setup.first });
    } catch (e) {
      this._log('createBattle', e);
      this._toast(rt('ctl.error'));
      return;
    }
    const auto = again && this._lastAuto && setup.mode !== 'duel';
    await this._enterBattle(setup, state, { fresh: true, auto });
  }

  async _enterBattle(setup, state, { fresh = true, auto = false, lastHumanSide = null } = {}) {
    const ui = this._ensureUi();
    let view;
    try {
      view = await this._ensureView();
    } catch (e) {
      this._log('BattleView.init', e);
      this._toast(rt('ctl.error'));
      return;
    }
    if (!this.visible) return;
    const token = ++this.token;
    const mode = setup.mode;
    const b = {
      token,
      setup,
      mode,
      stageId: setup.stageId || null,
      state,
      playerSide: 1,
      difficulty: setup.difficulty || 'normal',
      auto: !!auto && mode !== 'duel',
      events: [],
      sel: null,
      waiting: false,
      busy: false,
      over: false,
      paused: false,
      lastHumanSide: lastHumanSide === 1 || lastHumanSide === -1 ? lastHumanSide : null,
      bottomSide: 1,
      startedAt: this._now(),
    };
    if (mode === 'duel') b.bottomSide = lastHumanSide === -1 ? -1 : state.side === -1 && b.lastHumanSide == null ? -1 : 1;
    this.battle = b;
    this._lastAuto = b.auto;
    this._ensureAi();

    // the HUD first (its layout gives the board rect), then the Pixi view on the app's renderer
    ui.hud.setup(state, {
      mode: mode === 'duel' ? 'duel' : mode,
      playerSide: 1,
      bottomSide: b.bottomSide,
      stageId: b.stageId,
      roundLimit: state.roundLimit,
      speed: this.speed,
      auto: b.auto,
      canAuto: mode !== 'duel' && (AUTO_ANYWHERE || mode !== 'campaign' || meta.canAutoBattle(this.profile, b.stageId)),
    });
    ui.showScreen('battle', {}, { force: true });
    this._setOccluded(false);
    this._showBattleView(setup.bg, b.bottomSide === -1);
    this._try('view.setBoardRect', () => view.setBoardRect(ui.boardSlotRect()));
    this._applySafeRect();
    view.setState(state);
    await new Promise((r) => requestAnimationFrame(() => r()));
    if (token !== this.token) return;
    this._try('view.setBoardRect', () => view.setBoardRect(ui.boardSlotRect()));
    this._applySafeRect();
    // fonts / portraits settle the HUD a moment later: measure once more
    setTimeout(() => {
      if (token === this.token && this.view && this.view.shown) this._onBoardRect(ui.boardSlotRect());
    }, 450);
    this._music('epic');
    this._intensity();
    this._updateWake();
    // voices of the Epic+ heroines on the board (Ultimates / skills start without a load delay)
    this._try('preloadVoice', () => preloadVoice([...new Set(state.units.map((u) => u.heroId))], ['ultimate', 'skill']));
    if (fresh && Array.isArray(state.startEvents) && state.startEvents.length) {
      ui.hud.log(state.startEvents);
      await this._play(state.startEvents, state, token);
      if (token !== this.token) return;
    }
    // first time on a tutorial stage: 1-1 gets step-by-step coach hints, the others a short card
    const tut = this._tutorialFor(setup);
    if (tut === 'basics') b.coach = { turns: 0, enemySeen: false, ultSeen: false };
    else if (tut && !b.auto && !this.autoSkip && typeof ui.openTutorial === 'function') {
      await ui.openTutorial(tut);
      if (token !== this.token) return;
      this._markTutorial(tut);
    }
    this._saveBattle();
    this._advance(token);
  }

  // =============================================================================== tutorials
  /** The stage's tutorial id when the player has not seen it yet (campaign only). */
  _tutorialFor(setup) {
    if (!setup || setup.mode !== 'campaign' || !this.profile) return null;
    const st = meta.stageById(setup.stageId);
    const id = st && st.tutorial;
    if (!id) return null;
    const flags = this.profile.flags || {};
    return flags[`tut.${id}`] ? null : id;
  }

  _markTutorial(id) {
    if (!this.profile) return;
    const p = this._try('setFlag', () => meta.setFlag(this.profile, `tut.${id}`, true));
    if (p) this._setProfile(p);
  }

  /** 1-1 coach: one hint for what the player sees right now (selection / phase / energy / enemy turn). */
  _coachUpdate() {
    const b = this.battle;
    const ui = this.ui;
    if (!b || !b.coach || !ui) return;
    const c = b.coach;
    const hud = ui.hud;
    if (!hud || typeof hud.coach !== 'function') return;
    const off = () => this._coachDone(true);
    if (b.over) {
      hud.coach(null);
      return;
    }
    const s = b.state;
    if (!this._isHuman(s.side)) {
      // the first enemy turn gets one line, later ones stay clean
      if (!c.enemySeen) {
        c.enemySeen = true;
        c.enemyNow = true;
        hud.coach(rt('tut.coach.enemy'), { onOff: off });
      } else if (!c.enemyNow) hud.coach(null);
      return;
    }
    c.enemyNow = false;
    if (!b.waiting) return;
    const mine = s.units.filter((u) => u.side === b.playerSide && u.alive && !u.isWard);
    const ultReady = !c.ultSeen && mine.some((u) => u.maxEnergy && u.energy >= u.maxEnergy);
    const sel = b.sel;
    let key = 'select';
    if (sel && sel.ua && sel.ua.phase) {
      const ua = sel.ua;
      if (sel.mode === 'skill' || sel.mode === 'ult' || sel.mode === 'quirk') key = null; // the card shows the ability
      else if (ua.phase === 'moved') key = 'moved';
      else if (ua.phase === 'pending') key = null;
      else if (ultReady && ua.ult && ua.ult.ok) key = 'ult';
      else if ((ua.jumps || []).length) key = 'jump';
      else if ((ua.basic || []).length) key = 'attack';
      else if ((ua.moves || []).length) key = c.turns >= 2 && ua.skill && ua.skill.ok && !c.skillSeen ? 'skill' : 'move';
      else key = 'select';
      if (key === 'skill') c.skillSeen = true;
    } else if (ultReady) key = 'ult';
    hud.coach(key ? rt(`tut.coach.${key}`) : null, { onOff: off });
  }

  /** The coach is finished (or switched off with ✕): flag it so it never shows again. */
  _coachDone(byUser = false) {
    const b = this.battle;
    if (b) b.coach = null;
    const hud = this.ui && this.ui.hud;
    const can = hud && typeof hud.coach === 'function';
    this._markTutorial('basics');
    if (!can) return;
    if (byUser) {
      this._try('coach', () => hud.coach(null));
      return;
    }
    // the farewell line stays in the bubble (off the board) for a few seconds
    const hide = () => this._try('coach', () => hud.coach(null));
    this._try('coach', () => hud.coach(rt('tut.coach.done'), { onOff: hide }));
    const token = this.token;
    setTimeout(() => {
      if (token === this.token) hide();
    }, 5000);
  }

  _showBattleView(bg, flipped) {
    const view = this.view;
    const r = this.renderer;
    if (!view) return;
    if (!view.shown) {
      const w = r.layers && r.layers.world;
      if (w) {
        this._worldWasVisible = w.visible;
        w.visible = true;
        w.alpha = 1;
      }
      view.show();
    }
    view.applySettings(this.settings);
    view.setSpeed(this.speed);
    view.setFlipped(!!flipped);
    view.setBackground(bg || 'bg-dawn');
  }

  _hideBattleView() {
    const view = this.view;
    if (!view || !view.shown) return;
    this._try('view.hide', () => {
      view.clearHighlight();
      view.clearPreview();
      view.hide();
    });
    const w = this.renderer.layers && this.renderer.layers.world;
    if (w && this._worldWasVisible !== null) w.visible = this._worldWasVisible;
    this._worldWasVisible = null;
  }

  _updateWake() {
    const b = this.battle;
    const on = !!(this.visible && b && !b.over && !b.paused && !(this.native && this.native.isPaused));
    if (on === this._awake) return;
    this._awake = on;
    this._try('keepScreenOn', () => this.native && this.native.keepScreenOn(on));
  }

  /** Battle music intensity: rises as the squads thin out and with Ultimates ready. */
  _intensity() {
    const b = this.battle;
    if (!b || !this.audio || typeof this.audio.setIntensity !== 'function') return;
    const s = b.state;
    let hp = { 1: [0, 0], '-1': [0, 0] };
    let ready = 0;
    for (const u of s.units) {
      const k = String(u.side);
      hp[k][0] += Math.max(0, u.hp);
      hp[k][1] += u.maxHp || 1;
      if (u.alive && u.maxEnergy && u.energy >= u.maxEnergy) ready++;
    }
    const share = Math.min(hp[1][0] / (hp[1][1] || 1), hp['-1'][0] / (hp['-1'][1] || 1));
    const boss = s.units.some((u) => u.boss && u.alive);
    const x = Math.min(1, 0.25 + 0.45 * (1 - share) + 0.08 * ready + (boss ? 0.2 : 0));
    this._try('setIntensity', () => this.audio.setIntensity(x));
  }

  // =============================================================================== turn loop
  _isHuman(side) {
    const b = this.battle;
    if (!b) return false;
    if (b.mode === 'duel') return true;
    return side === b.playerSide && !b.auto;
  }

  _waitUnpaused(token) {
    const b = this.battle;
    if (!b || !b.paused || token !== this.token) return Promise.resolve();
    return new Promise((resolve) => this._waiters.push(resolve));
  }

  _flushWaiters() {
    const w = this._waiters.splice(0);
    for (const fn of w) fn();
  }

  async _advance(token) {
    for (;;) {
      const b = this.battle;
      if (!b || token !== this.token || b.over) return;
      await this._waitUnpaused(token);
      if (token !== this.token || !this.battle || this.battle !== b) return;
      const res = battleResult(b.state);
      if (res) {
        await this._finish(token, res);
        return;
      }
      const side = b.state.side;
      if (this._isHuman(side)) {
        await this._humanTurn(token, side);
        return; // resumes from the human's action
      }
      // ---- AI: the enemy (or the player's side on «Авто»)
      const enemy = side !== b.playerSide;
      if (enemy) this.ui.hud.setThinking(true);
      if (b.coach) {
        if (b.auto) this._coachDone(true);
        else this._coachUpdate();
      }
      const t0 = this._now();
      let action = null;
      try {
        action = await this.ai.choose(b.state, { difficulty: enemy ? b.difficulty : 'normal', seed: (b.setup.seed + b.state.turn * 977 + (b.state.seq || 0)) >>> 0 });
      } catch (e) {
        this._log('ai', e);
      }
      if (token !== this.token || this.battle !== b) return;
      if (!action) action = this._fallbackAction(b.state);
      if (!action) {
        this._log('ai', 'no action');
        return;
      }
      const pause = this.fast ? 0 : (AI_PAUSE_MS[this.speed] || AI_PAUSE_MS[1]) - (this._now() - t0);
      if (pause > 0) await new Promise((r) => setTimeout(r, pause));
      await this._waitUnpaused(token);
      if (token !== this.token || this.battle !== b) return;
      this.ui.hud.setThinking(false);
      let result = this._apply(b.state, action);
      if (!result) {
        const fb = this._fallbackAction(b.state, true);
        result = fb ? this._apply(b.state, fb) : null;
      }
      if (!result) {
        this._log('ai', 'no legal action could be applied');
        return;
      }
      await this._commit(result, token);
    }
  }

  /** In-thread AI (worker trouble) or the first legal action as the last resort. */
  _fallbackAction(state, legalOnly = false) {
    if (!legalOnly) {
      try {
        return chooseAction(state, { difficulty: 'normal', seed: state.turn || 1 });
      } catch (e) {
        this._log('chooseAction', e);
      }
    }
    const list = this._try('legalActions', () => legalActions(state)) || [];
    return list.find((a) => a.type !== 'pass') || list[0] || null;
  }

  _apply(state, action) {
    try {
      return applyAction(state, action);
    } catch (e) {
      this._log(`applyAction ${JSON.stringify(action)}`, e);
      return null;
    }
  }

  /** Plays an applied action and syncs HUD / save / music. */
  async _commit(result, token) {
    const b = this.battle;
    if (!b) return;
    b.state = result.state;
    for (const e of result.events) b.events.push(e);
    if (b.events.length > 6000) b.events.splice(0, b.events.length - 6000);
    this.ui.hud.log(result.events);
    await this._play(result.events, result.state, token);
    if (token !== this.token || this.battle !== b) return;
    this._intensity();
    if (!battleResult(b.state)) this._saveBattle();
  }

  async _play(events, state, token) {
    const b = this.battle;
    const ui = this.ui;
    const view = this.view;
    if (!b || !view) return;
    b.busy = true;
    ui.hud.setBusy(true);
    try {
      view.clearHighlight();
      view.clearPreview();
    } catch (e) {
      /* ignore */
    }
    try {
      const p = view.play(events, { state });
      if (this.autoSkip) view.skip();
      await p;
    } catch (e) {
      this._log('view.play', e);
      this._try('view.setState', () => view.setState(state));
    }
    if (this.battle !== b) return;
    b.busy = false;
    ui.hud.setBusy(false);
    ui.hud.update(b.state);
    if (token !== this.token) return;
  }

  async _humanTurn(token, side) {
    const b = this.battle;
    const ui = this.ui;
    ui.hud.setThinking(false);
    if (b.mode === 'duel' && b.lastHumanSide !== side) {
      const first = b.lastHumanSide == null;
      b.lastHumanSide = side;
      if (b.bottomSide !== side) {
        b.bottomSide = side;
        this._try('flip', () => {
          this.view.setFlipped(side === -1);
          ui.hud.flip(side);
        });
        this._try('view.setBoardRect', () => this.view.setBoardRect(ui.boardSlotRect()));
      }
      if (b.setup.passPhone && !first) {
        await ui.passPhone(side);
        if (token !== this.token || this.battle !== b) return;
      }
      ui.hud.update(b.state);
    }
    b.waiting = true;
    b.sel = null;
    const s = b.state;
    if (s.act && s.act.unit) this._select(s.act.unit, { silent: true });
    else {
      ui.hud.select(null, null);
      this._paint();
    }
  }

  // =============================================================================== human input
  _humanSide() {
    const b = this.battle;
    if (!b) return 0;
    return b.mode === 'duel' ? b.state.side : b.playerSide;
  }

  _canInput() {
    const b = this.battle;
    return !!(b && b.waiting && !b.busy && !b.over && !b.paused && this._isHuman(b.state.side));
  }

  _onSelectUnit(id) {
    const b = this.battle;
    if (!b || b.busy) return;
    this._select(id);
  }

  /** Selects a heroine: own + can act → actions; otherwise an info card. */
  _select(unitId, { silent = false } = {}) {
    const b = this.battle;
    const ui = this.ui;
    if (!b) return;
    const s = b.state;
    const u = getUnit(s, unitId);
    if (!u || u.isWard) return;
    const mineSide = this._humanSide();
    if (u.side === mineSide && this._canInput()) {
      if (s.act && s.act.unit && s.act.unit !== unitId) {
        const cur = getUnit(s, s.act.unit);
        if (!silent && cur) this._toast(rt('ctl.otherActive', { name: heroName(cur.heroId) }));
        this._select(s.act.unit, { silent: true });
        return;
      }
      const ua = unitActions(s, unitId);
      b.sel = { unitId, ua, mode: null, prefix: [u.sq], pending: null, dirs: {}, squares: [], cache: new Map() };
      ui.hud.select(unitId, this._hudActs(ua), { moved: ua.phase === 'moved' || ua.phase === 'pending' });
      if (!ua.phase && !silent && u.alive) this._toast(rt('ctl.cantAct', { name: heroName(u.heroId) }));
      if (ua.phase === 'pending' && ua.pending) this._toast(rt(ua.pending.optional ? 'ctl.pendingOptional' : 'ctl.pending'), HINT);
    } else {
      b.sel = { unitId, ua: null, info: true };
      ui.hud.select(unitId, u.side === mineSide ? unitActions(s, unitId) : null);
    }
    this._paint();
  }

  /** The HUD's view of unitActions (pending relocation: only «Завершить» when optional). */
  _hudActs(ua) {
    if (!ua || ua.phase !== 'pending') return ua;
    return { ...ua, moves: [], swaps: [], jumps: [], basic: [], basicHeal: [], quirks: [], canWait: false, canEnd: !!(ua.pending && ua.pending.optional) };
  }

  _clearSelection() {
    const b = this.battle;
    if (!b) return;
    b.sel = null;
    this.ui.hud.select(null, null);
    this._paint();
  }

  _abilityInfo(sel, mode) {
    const ua = sel && sel.ua;
    if (!ua) return null;
    if (mode === 'skill') return { type: 'skill', info: ua.skill };
    if (mode === 'ult') return { type: 'ult', info: ua.ult };
    if (mode === 'quirk') {
      const q = (ua.quirks || []).find((x) => x && x.ok && (!sel.quirkId || x.id === sel.quirkId)) || null;
      return q ? { type: 'quirk', info: q, quirk: q.id } : null;
    }
    return null;
  }

  _onBattleAction(a) {
    const b = this.battle;
    if (!b || !a) return;
    if (!this._canInput()) return;
    const sel = b.sel;
    const ui = this.ui;
    const unit = (sel && sel.unitId) || a.unitId;
    if (!unit) return;
    switch (a.type) {
      case 'wait':
      case 'end':
        this._humanAct({ type: 'pass', unit });
        return;
      case 'cancel':
        this._setMode(null);
        return;
      case 'move':
      case 'attack':
        this._setMode(a.type);
        return;
      case 'skill':
      case 'ult':
      case 'quirk': {
        if (!sel || sel.unitId !== unit || !sel.ua) this._select(unit, { silent: true });
        const cur = b.sel;
        if (!cur || !cur.ua) return;
        cur.quirkId = a.quirkId || null;
        const ab = this._abilityInfo(cur, a.type);
        if (!ab || !ab.info || !ab.info.ok) {
          this._toast(rt('ctl.noTargets'));
          ui.hud.setMode(null);
          return;
        }
        this._setMode(a.type);
        return;
      }
      default:
    }
  }

  _setMode(mode) {
    const b = this.battle;
    const sel = b && b.sel;
    if (!sel || !sel.ua) return;
    const u = getUnit(b.state, sel.unitId);
    sel.mode = mode || null;
    sel.prefix = [u.sq];
    sel.pending = null;
    sel.dirs = {};
    sel.squares = [];
    this.ui.hud.setMode(sel.mode);
    // self-centred abilities: the area and the forecast right away, a tap on the board confirms
    const ab = this._abilityInfo(sel, sel.mode);
    if (ab && ab.info && this._selfCast(ab.info)) {
      const action = { type: ab.type, unit: sel.unitId, target: u.sq, ...(ab.quirk ? { quirk: ab.quirk } : {}) };
      if (previewAction(b.state, action)) {
        const area = this._areaOf(ab.info, u.sq);
        sel.pending = { action, sq: u.sq, area: area.length ? area : [u.sq], self: true };
        this._toast(rt('ctl.tapArea'), HINT);
      }
    }
    this._paint();
  }

  _selfCast(info) {
    return !!(info && (info.selfCast || SELF_SHAPES.has(info.shape)));
  }

  _areaOf(info, sq) {
    try {
      const a = info && typeof info.area === 'function' ? info.area(sq) : [];
      return Array.isArray(a) ? a : [];
    } catch (e) {
      return [];
    }
  }

  /** Damage forecast labels for actions (onlyTarget: just the unit on each action's target square). */
  _previewList(actions, { onlyTarget = false } = {}) {
    const b = this.battle;
    const out = [];
    const seen = new Set();
    for (const action of actions) {
      const key = JSON.stringify(action);
      let pv = b.sel && b.sel.cache ? b.sel.cache.get(key) : undefined;
      if (pv === undefined) {
        pv = this._try('previewAction', () => previewAction(b.state, action)) || null;
        if (b.sel && b.sel.cache) b.sel.cache.set(key, pv);
      }
      if (!pv) continue;
      let only = null;
      if (onlyTarget) {
        const tsq = action.target != null ? action.target : Array.isArray(action.path) ? null : null;
        const at = tsq != null ? b.state.units.find((x) => x.alive && x.sq === tsq) || (b.state.wards || []).find((w) => w.sq === tsq) : null;
        only = at ? at.id : null;
      }
      for (const [id, t] of Object.entries(pv.targets || {})) {
        if (only && id !== only) continue;
        if (seen.has(id)) continue;
        if (t.damage > 0) out.push({ unitId: id, amount: Math.round(t.damage), ko: !!t.ko, reaction: t.reaction || null });
        else if (t.heal > 0) out.push({ unitId: id, amount: Math.round(t.heal), heal: true });
        else continue;
        seen.add(id);
      }
    }
    return out;
  }

  /** Board highlights + forecast for the current selection / targeting mode. */
  _paint() {
    const b = this.battle;
    const view = this.view;
    if (!b || !view || b.over) return;
    if (b.busy) return;
    const s = b.state;
    const human = this._canInput();
    const selectable = human ? activatableUnits(s).filter((u) => u.side === this._humanSide()).map((u) => u.id) : [];
    const sel = b.sel;
    try {
      if (!sel || !sel.unitId) {
        view.clearPreview();
        view.highlight({ selectable });
        this._coachUpdate();
        return;
      }
      if (!sel.ua || !sel.ua.phase || !human) {
        view.clearPreview();
        view.highlight({ selectable, selected: sel.unitId });
        this._coachUpdate();
        return;
      }
      const ua = sel.ua;
      const unit = sel.unitId;
      const spec = { selectable, selected: unit, moves: [], jumps: [], targets: [], area: [] };
      let previews = [];
      if (ua.phase === 'pending') {
        spec.moves = (ua.pending && ua.pending.squares) || [];
      } else if (!sel.mode || sel.mode === 'move' || sel.mode === 'attack') {
        const showMoves = sel.mode !== 'attack';
        const showAttacks = sel.mode !== 'move';
        if (showMoves) spec.moves = sel.mode === 'move' ? [...(ua.moves || []), ...(ua.swaps || [])] : (ua.moves || []).slice();
        if (showAttacks) {
          spec.jumps = (ua.jumps || []).filter((p) => sameStart(p, sel.prefix));
          const basics = ua.basic || [];
          const heals = sel.mode === 'attack' ? ua.basicHeal || [] : [];
          spec.targets = [...basics, ...heals];
          if (sel.prefix.length > 1) {
            spec.area = [sel.prefix[sel.prefix.length - 1]];
            previews = this._previewList([{ type: 'jump', unit, path: sel.prefix.slice() }]);
          } else previews = this._previewList([...basics, ...heals].map((t) => ({ type: 'basic', unit, target: t })), { onlyTarget: true });
        }
      } else {
        const ab = this._abilityInfo(sel, sel.mode);
        const info = ab && ab.info;
        if (info) {
          if (info.shape === 'jump') {
            spec.jumps = (info.paths || []).filter((p) => sameStart(p, sel.prefix));
            if (sel.prefix.length > 1) spec.area = [sel.prefix[sel.prefix.length - 1]];
          } else if (!this._selfCast(info)) spec.targets = (info.targets || []).slice();
          if (sel.pending) {
            spec.area = sel.pending.area.slice();
            previews = this._previewList([sel.pending.action]);
          } else if (info.shape === 'lines' && Object.keys(sel.dirs).length) {
            spec.area = [].concat(...Object.values(sel.dirs).map((q) => this._areaOf(info, q)));
          } else if (info.shape === 'square' && sel.squares.length) {
            spec.area = sel.squares.slice();
          } else if (info.shape === 'single') {
            previews = this._previewList((info.targets || []).map((t) => ({ type: ab.type, unit, target: t, ...(ab.quirk ? { quirk: ab.quirk } : {}) })), { onlyTarget: true });
          }
        }
      }
      view.highlight(spec);
      if (previews.length) view.preview(previews);
      else view.clearPreview();
    } catch (e) {
      this._log('paint', e);
    }
    this._coachUpdate();
  }

  _onBoardTap(e) {
    const b = this.battle;
    const view = this.view;
    if (!b || !view || !view.shown) return;
    if (view.busy) {
      view.skip();
      return;
    }
    if (!this._canInput()) return;
    const sq = e && Number.isInteger(e.sq) ? e.sq : -1;
    if (sq < 0) return;
    try {
      this._tapSquare(sq, e.unitId || null);
    } catch (err) {
      this._log('tap', err);
    }
  }

  _tapSquare(sq, unitId) {
    const b = this.battle;
    const s = b.state;
    const sel = b.sel;
    const mine = this._humanSide();
    const occupant = s.units.find((u) => u.alive && u.sq === sq) || null;
    const ownActivatable = occupant && occupant.side === mine && activatableUnits(s).some((u) => u.id === occupant.id);

    if (!sel || !sel.ua || !sel.ua.phase) {
      if (occupant) this._select(occupant.id);
      else if (unitId) this._select(unitId);
      else if (sel) this._clearSelection();
      return;
    }
    const ua = sel.ua;
    const unit = sel.unitId;
    const u = getUnit(s, unit);

    // pending relocation: only its squares
    if (ua.phase === 'pending') {
      if (ua.pending && ua.pending.squares.includes(sq)) this._humanAct({ type: 'move', unit, to: sq });
      return;
    }

    const mode = sel.mode;
    if (!mode || mode === 'move' || mode === 'attack') {
      // jump chain entry (landing squares, hop by hop)
      if (mode !== 'move' && this._jumpTap(sq, ua.jumps || [], (path) => ({ type: 'jump', unit, path }))) return;
      if (mode !== 'move' && (ua.basic || []).includes(sq)) {
        this._humanAct({ type: 'basic', unit, target: sq });
        return;
      }
      if (mode === 'attack' && (ua.basicHeal || []).includes(sq)) {
        this._humanAct({ type: 'basic', unit, target: sq });
        return;
      }
      if (mode !== 'attack') {
        const moves = ua.moves || [];
        const swaps = mode === 'move' ? ua.swaps || [] : [];
        if (moves.includes(sq) || swaps.includes(sq)) {
          this._humanAct({ type: 'move', unit, to: sq });
          return;
        }
      }
      if (occupant && occupant.id !== unit && (ownActivatable || occupant.side !== mine)) {
        this._select(occupant.id);
        return;
      }
      if (occupant && occupant.id === unit) {
        if (sel.prefix.length > 1) this._setMode(sel.mode);
        return;
      }
      if (sel.prefix.length > 1) this._setMode(sel.mode);
      return;
    }

    // ability targeting
    const ab = this._abilityInfo(sel, mode);
    if (!ab || !ab.info) return;
    const info = ab.info;
    const base = { type: ab.type, unit, ...(ab.quirk ? { quirk: ab.quirk } : {}) };
    if (sel.pending) {
      const p = sel.pending;
      if (sq === p.sq || p.area.includes(sq) || (p.self && sq === u.sq)) {
        this._humanAct(p.action);
        return;
      }
      if (p.self) return; // self-cast: taps elsewhere keep the forecast
      sel.pending = null;
    }
    if (info.shape === 'jump') {
      this._jumpTap(sq, info.paths || [], (path) => ({ ...base, path }));
      return;
    }
    const targets = info.targets || [];
    if (!targets.includes(sq)) {
      if (occupant && occupant.id !== unit && (ownActivatable || occupant.side !== mine) && !s.act) this._select(occupant.id);
      else this._paint();
      return;
    }
    if (info.shape === 'single') {
      this._humanAct({ ...base, target: sq });
      return;
    }
    if (info.shape === 'lines') {
      const key = dirKey(u.sq, sq);
      if (!key) return;
      const allDirs = new Set(targets.map((q) => dirKey(u.sq, q)).filter(Boolean));
      const need = Math.max(1, Math.min(info.pick || 1, allDirs.size));
      sel.dirs[key] = sq;
      const chosen = Object.values(sel.dirs);
      if (chosen.length >= need) {
        const action = { ...base, targets: chosen.slice(0, need) };
        if (!previewAction(b.state, action)) {
          sel.dirs = {};
          this._toast(rt('ctl.noTargets'));
        } else {
          const area = [].concat(...chosen.map((q) => this._areaOf(info, q)));
          sel.pending = { action, sq, area };
          this._toast(rt('ctl.tapAgain'), HINT);
        }
      } else this._toast(rt('ctl.pickDirs', { n: need - chosen.length }), HINT);
      this._paint();
      return;
    }
    if (info.shape === 'square') {
      const count = Math.max(1, info.pick || 1);
      const i = sel.squares.indexOf(sq);
      if (i >= 0) {
        // a chosen square tapped again: use the ability with the squares chosen so far
        this._humanAct({ ...base, targets: sel.squares.slice() });
        return;
      }
      sel.squares.push(sq);
      if (sel.squares.length > count) sel.squares.shift();
      if (sel.squares.length >= count) {
        const action = { ...base, targets: sel.squares.slice() };
        if (previewAction(b.state, action)) sel.pending = { action, sq, area: sel.squares.slice() };
        this._toast(rt('ctl.tapAgain'), HINT);
      } else this._toast(rt('ctl.pickSquares', { n: count }), HINT);
      this._paint();
      return;
    }
    // line / row / cross / radius / diagonals around a target: pick, forecast, tap again to confirm
    const action = { ...base, target: sq };
    if (!previewAction(b.state, action)) {
      this._toast(rt('ctl.noTargets'));
      return;
    }
    const area = this._areaOf(info, sq);
    sel.pending = { action, sq, area: area.length ? area : [sq] };
    this._toast(rt('ctl.tapAgain'), HINT);
    this._paint();
  }

  /**
   * Jump chain entry: taps on landing squares extend the chain hop by hop; a chain that cannot
   * continue (or a tap on the last landing again) strikes. Returns true when the tap was used.
   */
  _jumpTap(sq, paths, make) {
    const b = this.battle;
    const sel = b.sel;
    if (!paths.length) return false;
    const prefix = sel.prefix;
    const last = prefix[prefix.length - 1];
    const exact = (p) => paths.some((x) => x.length === p.length && sameStart(x, p));
    if (sq === last && prefix.length > 1 && exact(prefix)) {
      this._humanAct(make(prefix.slice()));
      return true;
    }
    const next = prefix.concat(sq);
    const cands = paths.filter((p) => p.length >= next.length && sameStart(p, next));
    if (cands.length) {
      const longer = cands.some((p) => p.length > next.length);
      if (exact(next) && !longer) {
        this._humanAct(make(next));
        return true;
      }
      sel.prefix = next;
      if (exact(next)) this._toast(rt('ctl.chain'), HINT);
      this._paint();
      return true;
    }
    // a whole chain ending on this square (tapped directly)
    const ending = paths.filter((p) => p[p.length - 1] === sq && sameStart(p, prefix));
    if (ending.length) {
      ending.sort((a, c) => a.length - c.length);
      this._humanAct(make(ending[0]));
      return true;
    }
    return false;
  }

  async _humanAct(action) {
    const b = this.battle;
    if (!b || !this._canInput()) return;
    const token = this.token;
    const result = this._apply(b.state, action);
    if (!result) {
      this._toast(rt('ctl.noTargets'));
      this._select(action.unit, { silent: true });
      return;
    }
    b.waiting = false;
    const keep = b.sel ? b.sel.unitId : null;
    b.sel = null;
    this.ui.hud.setMode(null);
    if (b.coach) {
      if (action.type === 'ult') b.coach.ultSeen = true;
      if (action.type !== 'move') b.coach.turns++;
    }
    await this._commit(result, token);
    if (token !== this.token || this.battle !== b) return;
    // the activation goes on (after a move, a pending relocation, an extra activation)
    if (!battleResult(b.state) && this._isHuman(b.state.side) && b.state.act && b.state.act.unit) {
      b.waiting = true;
      this._select(b.state.act.unit, { silent: true });
      return;
    }
    if (keep && this.ui) this.ui.hud.select(null, null);
    // the coach has said everything once the player has used an Ultimate (or played 8 activations)
    if (b.coach && (b.coach.ultSeen || b.coach.turns >= 8)) this._coachDone(false);
    this._advance(token);
  }

  // =============================================================================== HUD chips / pause
  setSpeed(x) {
    this.speed = x >= 2 ? 2 : 1;
    if (this.view) this.view.setSpeed(this.speed);
    if (this.ui) this.ui.hud.setSpeed(this.speed);
  }

  setAuto(on) {
    const b = this.battle;
    if (!b || b.over || b.mode === 'duel') return;
    on = !!on;
    if (b.auto === on) return;
    b.auto = on;
    this._lastAuto = on;
    if (this.ui) this.ui.hud.setAuto(on);
    this._toast(rt(on ? 'ctl.autoOn' : 'ctl.autoOff'));
    if (on && b.waiting) {
      // the AI takes over at once (also an activation the player already started)
      b.waiting = false;
      b.sel = null;
      this.ui.hud.select(null, null);
      try {
        this.view.clearHighlight();
        this.view.clearPreview();
      } catch (e) {
        /* ignore */
      }
      this._advance(this.token);
    }
  }

  skip() {
    if (this.view && this.view.busy) this.view.skip();
  }

  _onPause(on) {
    const b = this.battle;
    if (!b) return;
    b.paused = !!on;
    if (on) {
      if (this.view && this.view.busy) this.view.skip();
      this._saveBattle();
    } else {
      this._flushWaiters();
    }
    if (this.perf && typeof this.perf.setDimmed === 'function') this._try('perf.setDimmed', () => this.perf.setDimmed(!!on));
    this._updateWake();
  }

  async surrender(side) {
    const b = this.battle;
    if (!b || b.over) return;
    const token = ++this.token;
    b.waiting = false;
    b.paused = false;
    b.sel = null;
    if (this.ai) this.ai.cancel();
    this._flushWaiters();
    if (this.view && this.view.busy) {
      this.view.skip();
      for (let i = 0; i < 200 && this.view.busy; i++) await new Promise((r) => setTimeout(r, 20));
    }
    if (token !== this.token || this.battle !== b) return;
    const s = side === 1 || side === -1 ? side : b.mode === 'duel' ? b.state.side : b.playerSide;
    const result = this._apply(b.state, { type: 'resign', side: s });
    if (result) await this._commit(result, token);
    this._advance(token);
  }

  // =============================================================================== layout
  _onBoardRect(rect) {
    if (!this.view || !this.view.shown || !rect || !(rect.width > 0)) return;
    this._try('view.setBoardRect', () => this.view.setBoardRect(rect));
    this._applySafeRect();
  }

  /** Screen area free of the DOM HUD (between the enemy roster and the unit card). */
  _hudSafeRect() {
    const ui = this.ui;
    if (!ui) return null;
    try {
      const slot = ui.boardSlotRect();
      const lanes = ui.hud.lanes();
      const top = lanes && lanes.top ? lanes.top.y : slot.y;
      const bottom = lanes && lanes.bottom ? lanes.bottom.y + lanes.bottom.height : slot.y + slot.height;
      const lane = (lanes && (lanes.top || lanes.bottom)) || null;
      const x = lane ? lane.x : slot.x;
      const width = lane ? lane.width : slot.width;
      return { x, y: top, width, height: Math.max(slot.height, bottom - top) };
    } catch (e) {
      return null;
    }
  }

  _applySafeRect() {
    if (!this.view || !this.view.shown) return;
    const r = this._cinematic ? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight } : this._hudSafeRect();
    this._try('view.setSafeRect', () => this.view.setSafeRect(r));
  }

  _onCinematic(on) {
    this._cinematic = !!on;
    if (this.ui) this._try('hud.setCinematic', () => this.ui.hud.setCinematic(!!on));
    this._applySafeRect();
  }

  _onScreen(name) {
    // opaque DOM screens cover the whole canvas: the renderer can stop presenting meanwhile
    if (this.visible) this._setOccluded(name !== 'battle');
    const b = this.battle;
    if (b && name !== 'battle' && name !== 'results') {
      if (!b.over) this._abandonBattle({ keepSave: false });
      this._hideBattleView();
      this.battle = null;
      this._updateWake();
      this._music('menu');
    }
    if (name === 'hub' || name === 'collection' || name === 'squad' || name === 'summon' || name === 'campaign' || name === 'training' || name === 'duel') this._music('menu');
  }

  _abandonBattle({ keepSave = false } = {}) {
    const b = this.battle;
    this.token++;
    if (this.ai) this.ai.cancel();
    this._flushWaiters();
    if (b) {
      b.over = true;
      b.waiting = false;
    }
    if (!keepSave) this._clearBattleSave();
    if (this.view && this.view.busy) this._try('view.skip', () => this.view.skip());
    this.battle = null;
    this._updateWake();
  }

  // =============================================================================== results
  async _finish(token, res) {
    const b = this.battle;
    const ui = this.ui;
    if (!b || b.over) return;
    b.over = true;
    b.waiting = false;
    this._clearBattleSave();
    ui.hud.setThinking(false);
    if (b.coach) this._coachDone(true);
    this._try('view', () => {
      this.view.clearHighlight();
      this.view.clearPreview();
    });
    this._updateWake();

    // rewards first (saved at once): a kill on the results screen never loses them
    // (duels too: no crystals / XP there, but they count for achievements)
    let rewards = {};
    const r = this._try('applyBattleResult', () =>
      meta.applyBattleResult(this.profile, {
        stageId: b.stageId || undefined,
        mode: b.mode,
        result: res,
        squad: b.setup.squadIds,
        state: b.state,
        events: b.events,
        enemyLevel: b.setup.enemyLevel,
        battleId: b.setup.seed,
        now: this._now(),
      }),
    );
    if (r && r.profile) {
      this._setProfile(r.profile);
      rewards = r.rewards || {};
    }
    const won = res.winner === b.playerSide || b.mode === 'duel';
    this._music(res.winner === 0 ? 'defeat' : won ? 'victory' : 'defeat');
    await new Promise((r) => setTimeout(r, this.autoSkip || this.fast ? 50 : RESULTS_DELAY_MS));
    if (token !== this.token || this.battle !== b) return;

    const mvpSide = b.mode === 'duel' ? res.winner : b.playerSide;
    const mvpId = res.stats && res.stats.mvp ? res.stats.mvp[mvpSide] : null;
    const mvpUnit = mvpId ? getUnit(b.state, mvpId) : null;
    // (a resumed battle's setup has no `sides`: the final state names every heroine)
    const idsOf = (side) => b.state.units.filter((u) => u.side === side && !u.isWard).map((u) => u.heroId);
    const squads = { 1: idsOf(1), '-1': idsOf(-1) };
    if (rewards.capRaised && rewards.capRaised.to) this._toast(rt('ctl.capRaised', { n: rewards.capRaised.to }));
    this._hideBattleView();
    this._setOccluded(true);
    const choice = await ui.showResults({
      result: res,
      rewards,
      mode: b.mode,
      stageId: b.stageId,
      squad: b.setup.squadIds,
      squads,
      playerSide: b.playerSide,
      mvp: res.winner !== 0 && mvpUnit && (b.mode === 'duel' || res.winner === b.playerSide) ? mvpUnit.heroId : null,
    });
    if (this.battle !== b) return;
    this.battle = null;
    this._updateWake();
    if (choice === 'again') {
      const setup = b.setup;
      const entries = (side) =>
        b.state.units.filter((u) => u.side === side && !u.isWard).map((u) => ({ heroId: u.heroId, level: u.level, constellation: u.constellation || 0 }));
      const payload =
        setup.mode === 'campaign'
          ? { mode: 'campaign', stageId: setup.stageId }
          : setup.payload || { mode: setup.mode, squads: { 1: entries(1), '-1': entries(-1) }, difficulty: setup.difficulty, bg: setup.bg, enemyLevel: setup.enemyLevel };
      this.startBattle(payload, { again: true });
    } else if (choice === 'next') {
      const next = this._nextStage(b.stageId);
      if (next) ui.showScreen('campaign', { chapter: next.chapter, stageId: next.id });
      else ui.showScreen('campaign', {});
      this._music('menu');
    } else this._music('menu');
  }

  _nextStage(stageId) {
    const list = meta.STAGES;
    const i = list.findIndex((s) => s.id === stageId);
    const next = i >= 0 ? list[i + 1] : null;
    if (next && meta.isUnlocked(this.profile, next.id)) return next;
    return meta.nextStage(this.profile) || null;
  }

  // =============================================================================== debug / tests
  snapshot() {
    const b = this.battle;
    const ui = this.ui;
    const s = b ? b.state : null;
    return {
      visible: this.visible,
      screen: ui ? ui.currentScreen : null,
      summoning: ui ? ui.summoning : false,
      paused: ui ? ui.paused : false,
      aiMode: this.ai ? this.ai.mode : null,
      profile: this.profile
        ? {
            crystals: this.profile.crystals,
            heroes: Object.keys(this.profile.heroes).length,
            squad: this.profile.squad.slice(),
            firstRun: this.profile.firstRun,
            campaign: JSON.parse(JSON.stringify(this.profile.campaign)),
            pulls: this.profile.pity ? this.profile.pity.total : 0,
          }
        : null,
      battle: b
        ? {
            mode: b.mode,
            stageId: b.stageId,
            round: s.round,
            side: s.side,
            turn: s.turn,
            act: s.act ? { unit: s.act.unit, moved: !!s.act.moved, pending: (s.act.pending || []).length } : null,
            over: b.over,
            busy: b.busy,
            waiting: b.waiting,
            auto: b.auto,
            paused: b.paused,
            selected: b.sel ? b.sel.unitId : null,
            mode2: b.sel ? b.sel.mode : null,
            events: b.events.length,
            result: battleResult(s) ? { winner: s.result.winner, reason: s.result.reason } : null,
            units: s.units.map((u) => ({ id: u.id, heroId: u.heroId, side: u.side, sq: u.sq, hp: u.hp, maxHp: u.maxHp, energy: u.energy, maxEnergy: u.maxEnergy, alive: u.alive, cd: u.cd ? u.cd.skill : 0 })),
          }
        : null,
      voice: this._try('currentVoice', () => currentVoice()) || null,
      viewShown: !!(this.view && this.view.shown),
      viewBusy: !!(this.view && this.view.busy),
      errors: this.errors.slice(-10),
    };
  }

  /**
   * Debug / tests only (?debug=1): fills a heroine's energy so her Ultimate is ready (the state is
   * copied, the view re-synced, the open selection refreshed).
   */
  debugFillEnergy(unitId) {
    const b = this.battle;
    if (!this.debug || !b || b.over || b.busy) return false;
    const s = deserializeBattle(serializeBattle(b.state));
    const u = s.units.find((x) => x.id === unitId);
    if (!u || !u.alive) return false;
    u.energy = u.maxEnergy;
    b.state = s;
    this.view.setState(s);
    this.ui.hud.update(s);
    if (b.sel && b.sel.unitId) this._select(b.sel.unitId, { silent: true });
    return true;
  }

  /** Tests: plain unitActions of a heroine in the running battle (planning only; input stays taps). */
  debugActions(unitId) {
    const b = this.battle;
    if (!b) return null;
    try {
      return JSON.parse(JSON.stringify(unitActions(b.state, unitId)));
    } catch (e) {
      return null;
    }
  }

  /** Screen centre (CSS px) of a battle square (tests). */
  squareXY(sq) {
    if (!this.view) return null;
    const p = this.view.screenPointOf(sq);
    const c = this.renderer.app && this.renderer.app.canvas ? this.renderer.app.canvas.getBoundingClientRect() : { left: 0, top: 0 };
    return { x: c.left + p.x, y: c.top + p.y };
  }
}

export default RpgController;
