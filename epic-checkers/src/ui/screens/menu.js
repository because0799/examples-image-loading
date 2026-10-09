// Main menu: play vs AI / two players / AI battle, rules / stats / settings, EPIC toggle.

import { h, tap } from '../dom.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { logo } from '../logo.js';
import { button, epicToggle } from '../components.js';
import { TITLES } from '../titles.js';

export function createMenu(ui) {
  const titleId = ui.stats ? ui.stats.currentTitle() : null;
  const titleDef = titleId ? TITLES.find((x) => x.id === titleId) : null;
  const unlocked = ui.stats ? ui.stats.unlockedCount() : 0;

  const titleChip = h(
    'button.title-chip',
    {
      type: 'button',
      class: titleDef ? `tier-${titleDef.tier}` : 'tier-0',
      on: { click: tap(() => ui.showScreen('stats')) },
    },
    h('span.title-chip__glyph', titleDef ? titleDef.icon : '初'),
    h(
      'span.title-chip__text',
      h('span.title-chip__label', t('menu.yourTitle')),
      h('span.title-chip__name', titleDef ? t(`title.${titleDef.id}.name`) : t('menu.rookie')),
    ),
    h('span.title-chip__count', `${unlocked}/${TITLES.length}`),
  );

  const tile = (name, label, screen) =>
    h(
      'button.tile',
      { type: 'button', on: { click: tap(() => ui.showScreen(screen)) } },
      h('span.tile__bg'),
      icon(name, 'tile__icon'),
      h('span.tile__label', label),
    );

  const toggle = epicToggle({
    on: ui.isEpic,
    compact: true,
    onChange: (on) => ui.setEpic(on, { announce: true }),
  });

  const el = h(
    'div.screen.screen--menu.scr-scroll',
    h('div.scr-deco', { 'aria-hidden': 'true' }, h('span.deco-kanji', '勝'), h('span.deco-kanji.deco-kanji--2', '闘')),
    h(
      'div.menu',
      h('div.menu__logo', logo({ size: 'small' })),
      titleChip,
      h(
        'nav.menu__main',
        button({
          label: t('menu.playAi'),
          sub: t('menu.playAiSub'),
          icon: 'cpu',
          kind: 'primary',
          size: 'xl',
          kanji: '戦',
          onClick: () => ui.showScreen('setup', { mode: 'ai' }),
        }),
        button({
          label: t('menu.pvp'),
          sub: t('menu.pvpSub'),
          icon: 'users',
          kind: 'secondary',
          size: 'lg',
          onClick: () => ui.showScreen('setup', { mode: 'pvp' }),
        }),
        button({
          label: t('menu.demo'),
          sub: t('menu.demoSub'),
          icon: 'swords',
          kind: 'secondary',
          size: 'lg',
          onClick: () => ui.showScreen('setup', { mode: 'demo' }),
        }),
      ),
      h(
        'div.menu__tiles',
        tile('rules', t('menu.rules'), 'rules'),
        tile('stats', t('menu.stats'), 'stats'),
        tile('settings', t('menu.settings'), 'settings'),
      ),
      h('div.menu__epic', toggle),
    ),
  );
  return {
    el,
    onTheme: (epic) => toggle.setOn(epic),
  };
}
