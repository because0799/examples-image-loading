// Settings: language, volumes, vibration, announcer, quality, show moves, animation speed.
// Every change mutates the live settings object, saves it and emits 'settings'.

import { h } from '../dom.js';
import { t } from '../i18n.js';
import { header, section, row, segmented, switchControl, slider, button } from '../components.js';

export function createSettings(ui, params = {}) {
  const s = ui.settings;
  const set = (patch) => ui.updateSettings(patch);

  const langSeg = segmented({
    label: t('settings.lang'),
    value: s.lang,
    cls: 'seg--lang',
    options: [
      { value: 'ru', label: 'Русский', glyph: 'RU' },
      { value: 'en', label: 'English', glyph: 'EN' },
    ],
    onChange: (v) => set({ lang: v }),
  });

  const sfx = slider({
    label: t('settings.sfx'),
    value: s.sfxVolume,
    onInput: (v) => set({ sfxVolume: v, _live: true }),
    onChange: (v) => {
      set({ sfxVolume: v });
      ui.sound('click');
    },
  });
  const music = slider({
    label: t('settings.music'),
    value: s.musicVolume,
    onInput: (v) => set({ musicVolume: v, _live: true }),
    onChange: (v) => set({ musicVolume: v }),
  });

  const vib = switchControl({
    checked: s.vibration,
    label: t('settings.vibration'),
    onChange: (v) => {
      set({ vibration: v });
      if (v) ui.haptic([20, 40, 20]);
    },
  });
  const ann = switchControl({ checked: s.announcer, label: t('settings.announcer'), onChange: (v) => set({ announcer: v }) });
  const moves = switchControl({ checked: s.showMoves, label: t('settings.showMoves'), onChange: (v) => set({ showMoves: v }) });

  const quality = segmented({
    label: t('settings.quality'),
    value: s.quality,
    options: [
      { value: 'high', label: t('settings.q.high') },
      { value: 'medium', label: t('settings.q.medium') },
      { value: 'low', label: t('settings.q.low') },
    ],
    onChange: (v) => set({ quality: v }),
  });
  const speed = segmented({
    label: t('settings.animSpeed'),
    value: s.animSpeed,
    cls: 'seg--num',
    options: [
      { value: 1, label: '1×' },
      { value: 1.5, label: '1.5×' },
      { value: 2, label: '2×' },
    ],
    onChange: (v) => set({ animSpeed: v }),
  });

  const resetBtn = button({
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

  const onBack = params.onBack || (() => ui.back());
  const el = h(
    'div.screen.screen--settings',
    h('div.scr-deco', { 'aria-hidden': 'true' }, h('span.deco-kanji', '設')),
    header({ title: t('settings.title'), onBack, kanji: '設定' }),
    h(
      'div.scr-body.scr-scroll',
      section(t('settings.secGeneral'), h('div.card', row({ icon: 'globe', label: t('settings.lang'), control: langSeg, stack: true }))),
      section(
        t('settings.secSound'),
        h(
          'div.card',
          row({ icon: 'sound', label: t('settings.sfx'), control: sfx, stack: true }),
          row({ icon: 'music', label: t('settings.music'), control: music, stack: true }),
          row({ icon: 'mic', label: t('settings.announcer'), desc: t('settings.announcerDesc'), control: ann }),
          row({ icon: 'vibration', label: t('settings.vibration'), desc: t('settings.vibrationDesc'), control: vib }),
        ),
      ),
      section(
        t('settings.secGame'),
        h(
          'div.card',
          row({ icon: 'eye', label: t('settings.showMoves'), desc: t('settings.showMovesDesc'), control: moves }),
          row({ icon: 'speed', label: t('settings.animSpeed'), desc: t('settings.animSpeedDesc'), control: speed, stack: true }),
        ),
      ),
      section(
        t('settings.secGraphics'),
        h('div.card', row({ icon: 'sparkle', label: t('settings.quality'), desc: t('settings.qualityDesc'), control: quality, stack: true })),
      ),
      params.sheet ? null : h('div.settings__footer', resetBtn, h('div.settings__ver', `${t('app.name')} · ${t('app.version', { v: ui.version })}`)),
      h('div.scr-body__pad'),
    ),
  );
  return { el, state: () => ({}) };
}
