// Settings screen (also opened as a sheet from the pause menu: params.sheet).
//
// Sections: Профиль (name + live nameplate preview, energy colour) · Пресет эффектов (4 cards +
// «Свои настройки») · Эффекты EPIC (every fx switch / slider with a one-line explanation) ·
// Скорость и текст · Графика · Игра · Звук и вибрация · Язык · Сброс.
// A jump bar under the header scrolls to a section and follows the scroll position.
//
// Every change goes through ui.updateSettings (mutates the live settings object, validates, saves,
// re-derives settings.preset and emits 'settings'). Controls re-sync from the live object after
// every 'settings' event, so a preset, a reset or a change made elsewhere (adaptive quality) shows
// up at once.

import { h, tap, feedback } from '../dom.js';
import { t, getLang } from '../i18n.js';
import { icon } from '../icons.js';
import { header, row, segmented, switchControl, slider, button } from '../components.js';
import { readMs } from '../toasts.js';
import {
  ENERGY_COLORS,
  SIDE_COLORS,
  PLAYER_COLORS,
  PRESET_IDS,
  ANIM_SPEEDS,
  TEXT_TIMES,
  FX_RANGES,
  DEFAULT_SETTINGS,
  PLAYER_NAME_MAX,
  cleanPlayerName,
  sanitizeSettings,
} from '../storage.js';

const PRESET_META = {
  max: { kanji: '極', bars: 4 },
  balanced: { kanji: '均', bars: 3 },
  calm: { kanji: '静', bars: 2 },
  battery: { kanji: '省', bars: 1 },
};
const NAME_SAVE_MS = 450;

/** 1.5 -> «1,5×» (ru) / "1.5×" (en) */
export function fmtTimes(v) {
  const s = String(v);
  return (getLang() === 'ru' ? s.replace('.', ',') : s) + '×';
}

const pct = (v) => Math.round(v * 100) + '%';
/** 4.95 -> «5» / 3.3 -> «3,3» (ru) / "3.3" (en) */
const fmtSeconds = (s) => {
  const r = Math.round(s * 10) / 10;
  const txt = Number.isInteger(r) ? String(r) : r.toFixed(1);
  return getLang() === 'ru' ? txt.replace('.', ',') : txt;
};

export function createSettings(ui, params = {}) {
  const s = ui.settings;
  const set = (patch) => ui.updateSettings(patch);
  const setFx = (patch, live = false) => set({ fx: patch, ...(live ? { _live: true } : null) });
  const syncers = [];
  const bind = (fn) => {
    syncers.push(fn);
    return fn;
  };
  const sync = () => {
    for (const fn of syncers) {
      try {
        fn();
      } catch (e) {
        /* a control that failed to sync must not stop the others */
      }
    }
  };

  // ------------------------------------------------------------ control helpers (bound to the live object)
  const sw = (get, put, label) => {
    const el = switchControl({ checked: get(), label, onChange: (v) => put(v) });
    bind(() => el.setChecked(get()));
    return el;
  };
  const seg = (get, put, options, { label, cls } = {}) => {
    const el = segmented({ value: get(), options, label, cls, onChange: (v) => put(v) });
    bind(() => el.setValue(get()));
    return el;
  };
  const fxSwitchRow = (key, ic) =>
    row({
      icon: ic,
      label: t(`settings.fx.${key}`),
      desc: t(`settings.fx.${key}Desc`),
      control: sw(() => s.fx[key], (v) => setFx({ [key]: v }), t(`settings.fx.${key}`)),
      cls: 'row--fx',
    });
  const rangeRow = ({ ic, key, range, step, get, put, format }) => {
    const el = slider({
      value: get(),
      min: range[0],
      max: range[1],
      step,
      label: t(key),
      format,
      onInput: (v) => put(v, true),
      onChange: (v) => put(v, false),
    });
    bind(() => el.setValue(get()));
    return row({ icon: ic, label: t(key), desc: t(`${key}Desc`), control: el, stack: true });
  };

  // ------------------------------------------------------------ Профиль
  const preview = buildPreview(ui);
  const nameInput = h('input.text-input', {
    type: 'text',
    maxLength: PLAYER_NAME_MAX * 2, // UTF-16 units; cleanPlayerName cuts to 16 characters
    placeholder: t('hud.you'),
    autocomplete: 'off',
    autocapitalize: 'words',
    enterKeyHint: 'done',
    'aria-label': t('settings.playerName'),
  });
  nameInput.value = s.playerName || '';
  nameInput.spellcheck = false; // (h() skips `false` props)
  let nameTimer = 0;
  const commitName = () => {
    clearTimeout(nameTimer);
    const v = cleanPlayerName(nameInput.value);
    if (v !== s.playerName) set({ playerName: v });
  };
  nameInput.addEventListener('input', () => {
    // live preview on every keystroke, the save (and the 'settings' event) a moment later
    preview.update({ name: cleanPlayerName(nameInput.value) });
    clearTimeout(nameTimer);
    nameTimer = setTimeout(commitName, NAME_SAVE_MS);
  });
  nameInput.addEventListener('change', commitName);
  nameInput.addEventListener('blur', () => {
    commitName();
    nameInput.value = s.playerName || '';
  });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      nameInput.blur();
    }
  });
  const clearName = h(
    'button.text-clear',
    {
      type: 'button',
      'aria-label': t('common.close'),
      on: {
        click: tap(() => {
          nameInput.value = '';
          preview.update({ name: '' });
          commitName();
        }),
      },
    },
    icon('close'),
  );
  bind(() => {
    if (document.activeElement !== nameInput) nameInput.value = s.playerName || '';
    clearName.hidden = !(nameInput.value || '').length;
  });
  nameInput.addEventListener('input', () => (clearName.hidden = !nameInput.value.length));

  const swatches = buildSwatches(s, (v) => set({ playerColor: v }));
  bind(() => swatches.setValue(s.playerColor));
  bind(() => preview.update({ name: document.activeElement === nameInput ? cleanPlayerName(nameInput.value) : s.playerName, color: s.playerColor }));

  const secProfile = sectionBlock(
    'profile',
    t('settings.secProfile'),
    preview.el,
    h(
      'div.card',
      row({
        icon: 'user',
        label: t('settings.playerName'),
        desc: t('settings.playerNameDesc'),
        control: h('div.text-field', nameInput, clearName, h('div.text-field__hint', t('settings.playerNameHint'))),
        stack: true,
      }),
      row({ icon: 'palette', label: t('settings.energy'), desc: t('settings.energyDesc'), control: swatches.el, stack: true }),
    ),
  );

  // ------------------------------------------------------------ Пресет эффектов
  const presets = buildPresets(s, (id) => {
    set({ preset: id });
    feedback.haptic(id === 'max' ? [12, 30, 24] : 10);
  });
  bind(() => presets.setValue(s.preset));
  const secPreset = sectionBlock('preset', t('settings.secPreset'), h('p.sec__lead', t('settings.presetDesc')), presets.el);

  // ------------------------------------------------------------ Эффекты EPIC
  const offOr = (fmt) => (v) => (v <= 0.001 ? t('settings.off') : fmt(v));
  const secFx = sectionBlock(
    'fx',
    t('settings.secFx'),
    h('div.note.note--slim', icon('info', 'note__icon'), h('span', t('settings.fxNote'))),
    h(
      'div.card.card--fx',
      rangeRow({
        ic: 'vibration',
        key: 'settings.fx.shake',
        range: FX_RANGES.shake,
        step: 0.1,
        get: () => s.fx.shake,
        put: (v, live) => setFx({ shake: v }, live),
        format: offOr(pct),
      }),
      fxSwitchRow('flashes', 'bolt'),
      fxSwitchRow('slowmo', 'clock'),
      fxSwitchRow('camera', 'target'),
      fxSwitchRow('cutins', 'film'),
      fxSwitchRow('kanji', 'text'),
      row({
        icon: 'mic',
        label: t('settings.fx.brags'),
        desc: t('settings.fx.bragsDesc'),
        stack: true,
        control: seg(
          () => s.fx.brags,
          (v) => setFx({ brags: v }),
          ['off', 'rare', 'normal', 'often'].map((v) => ({ value: v, label: t(`settings.brags.${v}`) })),
          { label: t('settings.fx.brags') },
        ),
      }),
      fxSwitchRow('turnBanners', 'flag'),
      fxSwitchRow('combo', 'swords'),
      rangeRow({
        ic: 'sparkle',
        key: 'settings.fx.particles',
        range: FX_RANGES.particles,
        step: 0.05,
        get: () => s.fx.particles,
        put: (v, live) => setFx({ particles: v }, live),
        format: pct,
      }),
      fxSwitchRow('auras', 'flame'),
      fxSwitchRow('vsIntro', 'crown'),
    ),
  );

  // ------------------------------------------------------------ Скорость и текст
  const speedIdx = () => Math.max(0, ANIM_SPEEDS.indexOf(s.animSpeed));
  const speedName = h('span.row__value');
  const paintSpeedName = () => (speedName.textContent = `${fmtTimes(s.animSpeed)} · ${t(`settings.speedName.${s.animSpeed}`)}`);
  bind(paintSpeedName);
  paintSpeedName();
  const speed = slider({
    value: speedIdx(),
    min: 0,
    max: ANIM_SPEEDS.length - 1,
    step: 1,
    label: t('settings.animSpeed'),
    cls: 'slider--steps',
    format: (i) => fmtTimes(ANIM_SPEEDS[Math.round(i)]),
    onInput: (i) => set({ animSpeed: ANIM_SPEEDS[Math.round(i)], _live: true }),
    onChange: (i) => set({ animSpeed: ANIM_SPEEDS[Math.round(i)] }),
  });
  bind(() => speed.setValue(speedIdx()));
  const speedTicks = h(
    'div.slider-ticks',
    { 'aria-hidden': 'true' },
    h('span.slider-ticks__dots', ANIM_SPEEDS.map((v) => h('i', { class: v === 1 ? 'is-mid' : '' }))),
    h('span.slider-ticks__labels', h('span', t('settings.speedSlow')), h('span', t('settings.speedFast'))),
  );
  const secSpeed = sectionBlock(
    'speed',
    t('settings.secSpeed'),
    h(
      'div.card',
      row({
        icon: 'speed',
        label: t('settings.animSpeed'),
        desc: t('settings.animSpeedDesc'),
        aside: speedName,
        control: h('div.slider-block', speed, speedTicks),
        stack: true,
        cls: 'row--speed',
      }),
      row({
        icon: 'text',
        label: t('settings.textTime'),
        desc: t('settings.textTimeDesc'),
        stack: true,
        control: seg(
          () => s.textTime,
          (v) => {
            set({ textTime: v });
            // feel it: a sample toast that stays exactly as long as a hint now does
            const sample = (secs) => t('settings.textTimeSample', { s: fmtSeconds(secs) });
            ui.toast(sample(readMs(sample(9.9), v) / 1000), { key: 'text-time-sample' });
          },
          TEXT_TIMES.map((v) => ({ value: v, label: fmtTimes(v) })),
          { label: t('settings.textTime'), cls: 'seg--num' },
        ),
      }),
      row({
        icon: 'film',
        label: t('settings.opponentFx'),
        desc: t('settings.opponentFxDesc'),
        stack: true,
        control: seg(
          () => s.opponentFx,
          (v) => set({ opponentFx: v }),
          ['full', 'short'].map((v) => ({ value: v, label: t(`settings.opp.${v}`) })),
          { label: t('settings.opponentFx') },
        ),
      }),
      row({
        icon: 'cpu',
        label: t('settings.aiPace'),
        desc: t('settings.aiPaceDesc'),
        stack: true,
        control: seg(
          () => s.aiPace,
          (v) => set({ aiPace: v }),
          ['fast', 'normal', 'slow'].map((v) => ({ value: v, label: t(`settings.pace.${v}`) })),
          { label: t('settings.aiPace') },
        ),
      }),
    ),
  );

  // ------------------------------------------------------------ Графика
  const secGraphics = sectionBlock(
    'graphics',
    t('settings.secGraphics'),
    h(
      'div.card',
      row({
        icon: 'sparkle',
        label: t('settings.quality'),
        desc: t('settings.qualityDesc'),
        stack: true,
        control: seg(
          () => s.quality,
          (v) => set({ quality: v }),
          ['auto', 'high', 'medium', 'low'].map((v) => ({ value: v, label: t(`settings.q.${v}`) })),
          { label: t('settings.quality') },
        ),
      }),
      row({
        icon: 'battery',
        label: t('settings.battery'),
        desc: t('settings.batteryDesc'),
        control: sw(() => s.battery, (v) => set({ battery: v }), t('settings.battery')),
      }),
      row({
        icon: 'image',
        label: t('settings.backdrop'),
        desc: t('settings.backdropDesc'),
        control: sw(() => s.fx.backdrop, (v) => setFx({ backdrop: v }), t('settings.backdrop')),
      }),
    ),
  );

  // ------------------------------------------------------------ Игра
  const secGame = sectionBlock(
    'game',
    t('settings.secGame'),
    h(
      'div.card',
      row({ icon: 'eye', label: t('settings.showMoves'), desc: t('settings.showMovesDesc'), control: sw(() => s.showMoves, (v) => set({ showMoves: v }), t('settings.showMoves')) }),
      row({
        icon: 'move',
        label: t('settings.showLastMove'),
        desc: t('settings.showLastMoveDesc'),
        control: sw(() => s.showLastMove, (v) => set({ showLastMove: v }), t('settings.showLastMove')),
      }),
      row({ icon: 'grid', label: t('settings.showCoords'), desc: t('settings.showCoordsDesc'), control: sw(() => s.showCoords, (v) => set({ showCoords: v }), t('settings.showCoords')) }),
    ),
  );

  // ------------------------------------------------------------ Звук и вибрация
  const volume = (key, label) => {
    const el = slider({
      value: s[key],
      label,
      onInput: (v) => set({ [key]: v, _live: true }),
      onChange: (v) => {
        set({ [key]: v });
        if (key === 'sfxVolume') ui.sound('click');
      },
    });
    bind(() => el.setValue(s[key]));
    return el;
  };
  const secSound = sectionBlock(
    'sound',
    t('settings.secSound'),
    h(
      'div.card',
      row({ icon: 'sound', label: t('settings.sfx'), control: volume('sfxVolume', t('settings.sfx')), stack: true }),
      row({ icon: 'music', label: t('settings.music'), control: volume('musicVolume', t('settings.music')), stack: true }),
      row({
        icon: 'mic',
        label: t('settings.announcer'),
        desc: t('settings.announcerDesc'),
        control: sw(() => s.announcer, (v) => set({ announcer: v }), t('settings.announcer')),
      }),
      row({
        icon: 'vibration',
        label: t('settings.vibration'),
        desc: t('settings.vibrationDesc'),
        stack: true,
        control: seg(
          () => s.haptics,
          (v) => {
            set({ haptics: v });
            if (v !== 'off') ui.haptic([20, 40, 20]);
          },
          ['off', 'light', 'strong'].map((v) => ({ value: v, label: t(`settings.haptics.${v}`) })),
          { label: t('settings.vibration') },
        ),
      }),
    ),
  );

  // ------------------------------------------------------------ Язык
  const secLang = sectionBlock(
    'lang',
    t('settings.secLang'),
    h(
      'div.card',
      row({
        icon: 'globe',
        label: t('settings.lang'),
        stack: true,
        control: seg(
          () => s.lang,
          (v) => set({ lang: v }),
          [
            { value: 'ru', label: 'Русский', glyph: 'RU' },
            { value: 'en', label: 'English', glyph: 'EN' },
          ],
          { label: t('settings.lang'), cls: 'seg--lang' },
        ),
      }),
    ),
  );

  // ------------------------------------------------------------ Сброс
  const resetSettingsBtn = button({
    label: t('settings.resetSettings'),
    icon: 'reset',
    kind: 'secondary',
    size: 'md',
    cls: 'settings__reset',
    onClick: async () => {
      const ok = await ui.confirm(t('settings.resetSettingsConfirm'), { ok: t('settings.reset') });
      if (!ok) return;
      const fresh = sanitizeSettings({ ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), lang: s.lang, lastConfig: s.lastConfig });
      delete fresh.lastConfig;
      set(fresh);
      ui.toast(t('settings.resetSettingsDone'));
    },
  });
  const resetStatsBtn = params.sheet
    ? null
    : button({
        label: t('settings.resetStats'),
        icon: 'trash',
        kind: 'ghost',
        size: 'md',
        cls: 'settings__reset',
        onClick: async () => {
          const ok = await ui.confirm(t('settings.resetConfirm'), { ok: t('settings.reset'), danger: true });
          if (ok) {
            ui.stats && ui.stats.reset();
            ui.toast(t('settings.resetDone'));
          }
        },
      });
  const footer = h(
    'div.settings__footer',
    { dataset: { sec: 'reset' } },
    resetSettingsBtn,
    resetStatsBtn,
    h('div.settings__ver', `${t('app.name')} · ${t('app.version', { v: ui.version })}`),
  );

  // ------------------------------------------------------------ jump bar + layout
  const sections = [secProfile, secPreset, secFx, secSpeed, secGraphics, secGame, secSound, secLang];
  const scroller = h('div.scr-body.scr-scroll.settings__body', ...sections, footer, h('div.scr-body__pad'));
  const jumpBtns = sections.map((sec) =>
    h(
      'button.jump__chip',
      {
        type: 'button',
        dataset: { sec: sec.dataset.sec },
        on: {
          click: tap(
            () => {
              const top = sec.offsetTop - 6;
              jumpLockUntil = Date.now() + 900; // the chip does not flicker through the sections passed
              try {
                scroller.scrollTo({ top, behavior: 'smooth' });
              } catch (e) {
                scroller.scrollTop = top;
              }
              markJump(sec.dataset.sec);
            },
            { haptic: 6 },
          ),
        },
      },
      t(`settings.jump.${sec.dataset.sec}`),
    ),
  );
  const jump = h('nav.jump', { 'aria-label': t('settings.title') }, h('div.jump__track', jumpBtns));
  let activeSec = '';
  let jumpLockUntil = 0;
  function markJump(id) {
    if (id === activeSec) return;
    activeSec = id;
    for (const b of jumpBtns) {
      const on = b.dataset.sec === id;
      b.classList.toggle('is-active', on);
      if (on) {
        // keep the active chip visible in the horizontally scrolling bar
        const track = jump.firstChild;
        const l = b.offsetLeft - 12;
        const r = b.offsetLeft + b.offsetWidth + 12;
        if (l < track.scrollLeft) track.scrollLeft = l;
        else if (r > track.scrollLeft + track.clientWidth) track.scrollLeft = r - track.clientWidth;
      }
    }
  }
  let scrollRaf = 0;
  scroller.addEventListener(
    'scroll',
    () => {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        if (Date.now() < jumpLockUntil) return;
        const y = scroller.scrollTop + Math.min(140, scroller.clientHeight * 0.3);
        let id = sections[0].dataset.sec;
        for (const sec of sections) if (sec.offsetTop <= y) id = sec.dataset.sec;
        if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) id = sections[sections.length - 1].dataset.sec;
        markJump(id);
      });
    },
    { passive: true },
  );
  markJump(sections[0].dataset.sec);

  const onBack = params.onBack || (() => ui.back());
  const el = h(
    'div.screen.screen--settings',
    h('div.scr-deco', { 'aria-hidden': 'true' }, h('span.deco-kanji', '設')),
    header({ title: t('settings.title'), onBack, kanji: '設定' }),
    jump,
    scroller,
  );

  // re-sync on every settings change (presets, reset, adaptive quality, the other copy of this
  // screen in a sheet ...) while the screen is attached; a detached copy unsubscribes itself
  let seen = false;
  const off = ui.on('settings', () => {
    if (!el.isConnected) {
      if (seen) off();
      return;
    }
    seen = true;
    sync();
  });
  requestAnimationFrame(() => {
    if (el.isConnected) seen = true;
  });
  sync();

  return {
    el,
    state: () => ({}),
    onShow: () => {
      seen = true;
    },
    destroy: () => {
      commitName();
      off();
    },
  };
}

// ------------------------------------------------------------------ building blocks

function sectionBlock(id, title, ...children) {
  return h('section.sec.sec--set', { dataset: { sec: id } }, h('h2.sec__title', h('span', title)), ...children);
}

/** Live nameplate preview: the player's panel as the opponent sees it, in the chosen energy colour. */
function buildPreview(ui) {
  const name = h('span.pp__name');
  const sub = h('span.pp__sub');
  const el = h(
    'div.pp',
    { 'aria-hidden': 'true' },
    h('span.pp__tag', t('settings.previewTag')),
    h(
      'div.pp__plate',
      h('span.pp__bg'),
      h('span.pp__kanji', '主'),
      h('span.pp__avatar', h('span.pp__disc'), h('span.pp__glyph', '主')),
      h('span.pp__info', name, sub),
      h('span.pp__pieces', h('i.pp__piece'), h('i.pp__piece.pp__piece--king')),
    ),
  );
  const state = { name: ui.settings.playerName, color: ui.settings.playerColor };
  const paint = () => {
    name.textContent = state.name || t('hud.you');
    const tid = ui.stats && ui.stats.currentTitle ? ui.stats.currentTitle() : null;
    sub.textContent = t('settings.previewSub', { title: tid ? t(`title.${tid}.name`) : t('menu.rookie') });
    const hex = state.color && state.color !== 'auto' ? ENERGY_COLORS[state.color] : SIDE_COLORS[1];
    el.style.setProperty('--pc', hex || SIDE_COLORS[1]);
    el.classList.toggle('is-auto', !state.color || state.color === 'auto');
  };
  paint();
  return {
    el,
    update(patch) {
      Object.assign(state, patch);
      paint();
    },
  };
}

/** Energy colour swatches (radiogroup): Авто + six colours, each with its name. */
function buildSwatches(s, onPick) {
  const el = h('div.swatches', { role: 'radiogroup', 'aria-label': t('settings.energy') });
  const hint = h('div.swatches__hint', t('settings.energyAuto'));
  const btns = PLAYER_COLORS.map((id) => {
    const hex = id === 'auto' ? null : ENERGY_COLORS[id];
    const b = h(
      'button.sw',
      {
        type: 'button',
        role: 'radio',
        dataset: { value: id },
        style: hex ? { '--c': hex } : null,
        class: id === 'auto' ? 'sw--auto' : '',
        on: {
          click: tap(() => {
            if (s.playerColor === id) return;
            onPick(id);
          }),
        },
      },
      h('span.sw__chip', h('span.sw__check', icon('check'))),
      h('span.sw__name', t(`settings.color.${id}`)),
    );
    el.appendChild(b);
    return b;
  });
  const wrap = h('div.swatches-wrap', el, hint);
  return {
    el: wrap,
    setValue(v) {
      for (const b of btns) {
        const on = b.dataset.value === v;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      }
      hint.hidden = v !== 'auto';
    },
  };
}

/** Four big preset cards + the «Свои настройки» card (shown, active, when nothing matches). */
function buildPresets(s, onPick) {
  const cards = PRESET_IDS.map((id) => {
    const meta = PRESET_META[id];
    const bars = h('span.pc__bars', { 'aria-hidden': 'true' });
    for (let i = 0; i < 4; i++) bars.appendChild(h('i', { class: i < meta.bars ? 'on' : '' }));
    return h(
      'button.pc',
      {
        type: 'button',
        role: 'radio',
        dataset: { preset: id },
        class: `pc--${id}`,
        on: {
          click: tap(() => onPick(id), { haptic: 0 }),
        },
      },
      h('span.pc__bg', { 'aria-hidden': 'true' }),
      h('span.pc__kanji', { 'aria-hidden': 'true' }, meta.kanji),
      h('span.pc__check', { 'aria-hidden': 'true' }, icon('check')),
      bars,
      h('span.pc__name', { 'data-fit': '13' }, t(`settings.preset.${id}`)),
      h('span.pc__desc', t(`settings.preset.${id}Desc`)),
    );
  });
  const custom = h(
    'div.pc-custom',
    { role: 'status' },
    icon('settings', 'pc-custom__icon'),
    h('span.pc-custom__text', h('b', t('settings.preset.custom')), h('span', t('settings.preset.customDesc'))),
  );
  const el = h('div.presets', h('div.presets__grid', { role: 'radiogroup', 'aria-label': t('settings.secPreset') }, cards), custom);
  return {
    el,
    setValue(id) {
      for (const c of cards) {
        const on = c.dataset.preset === id;
        c.classList.toggle('is-active', on);
        c.setAttribute('aria-checked', on ? 'true' : 'false');
      }
      custom.hidden = id !== 'custom';
    },
  };
}
