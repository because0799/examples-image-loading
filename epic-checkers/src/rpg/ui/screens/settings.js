// «Валькирии» — the mode's small settings section (opened from the hub gear and the battle pause
// menu): hero voices on/off (settings.rpgVoice), voice volume (settings.voiceVolume), and the
// shared sound / music volumes for convenience.

import { h, rvSwitch, rvSlider, rvButton } from '../components.js';
import { rvIcon } from '../icons.js';
import { rt } from '../i18n.js';
import { profileSquad, ownedIds, isVoiced } from '../model.js';

export function buildSettingsSheet(ui, close) {
  const s = ui.settings;
  const pct = (v) => Math.round(v * 100) + '%';
  const row = (icon, label, desc, control) =>
    h('div.rv-row', rvIcon(icon, 'rv-row__ico'), h('div.rv-row__text', h('div.rv-row__label', label), desc ? h('div.rv-row__desc', desc) : null), control);
  const stack = (icon, label, control) => h('div.rv-row.rv-row--stack', h('div.rv-row__head', rvIcon(icon, 'rv-row__ico'), h('div.rv-row__label', label)), control);

  const testHero = () => {
    const pool = [...profileSquad(ui.profile), ...ownedIds(ui.profile)].filter(isVoiced);
    return pool[0] || 'liora';
  };
  const volSlider = rvSlider(ui, {
    value: s.voiceVolume ?? 0.9,
    label: rt('settings.voiceVolume'),
    format: pct,
    onInput: (v) => ui.updateSettings({ voiceVolume: v }, { live: true }),
    onChange: (v) => {
      ui.updateSettings({ voiceVolume: v });
      ui.voice(testHero(), 'skill', { force: true });
    },
  });
  const voiceRow = row(
    'mic',
    rt('settings.voice'),
    rt('settings.voiceDesc'),
    rvSwitch(ui, {
      checked: s.rpgVoice !== false,
      label: rt('settings.voice'),
      onChange: (on) => {
        ui.updateSettings({ rpgVoice: on });
        volBox.classList.toggle('is-off', !on);
      },
    }),
  );
  const volBox = stack('sound', rt('settings.voiceVolume'), volSlider);
  volBox.classList.toggle('is-off', s.rpgVoice === false);

  return h(
    'div.rv-settings',
    h(
      'div.rv-panel',
      voiceRow,
      volBox,
      h(
        'div.rv-row',
        rvButton(ui, {
          label: rt('settings.test'),
          icon: 'play',
          kind: 'glass',
          size: 'sm',
          cls: 'rv-btn--center',
          sound: null,
          onClick: () => {
            if (s.rpgVoice === false) ui.updateSettings({ rpgVoice: true });
            ui.voice(testHero(), 'summon', { force: true });
            const sw = voiceRow.querySelector('.rv-switch');
            if (sw && sw.setChecked) sw.setChecked(true);
            volBox.classList.remove('is-off');
          },
        }),
      ),
    ),
    h(
      'div.rv-panel.rv-settings__audio',
      stack(
        'sound',
        rt('settings.sfx'),
        rvSlider(ui, {
          value: s.sfxVolume ?? 0.8,
          label: rt('settings.sfx'),
          format: pct,
          onInput: (v) => ui.updateSettings({ sfxVolume: v }, { live: true }),
          onChange: (v) => {
            ui.updateSettings({ sfxVolume: v });
            ui.sound('select');
          },
        }),
      ),
      stack(
        'music',
        rt('settings.music'),
        rvSlider(ui, {
          value: s.musicVolume ?? 0.5,
          label: rt('settings.music'),
          format: pct,
          onInput: (v) => ui.updateSettings({ musicVolume: v }, { live: true }),
          onChange: (v) => ui.updateSettings({ musicVolume: v }),
        }),
      ),
    ),
    h('p.rv-note', rt('settings.note')),
  );
}
