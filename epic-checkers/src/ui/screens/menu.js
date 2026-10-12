// Main menu: play vs AI / two players / AI battle, the «Валькирии доски» RPG mode (big tile with a
// key-art thumbnail and a NEW badge -> ui.emit('open-rpg')), rules / stats / settings, EPIC toggle.

import { h, tap } from '../dom.js';
import { RPG_ASSETS } from '../../rpg/assets.js';
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

  // «Валькирии доски» (盤上戦姫): the anime RPG mode (src/rpg, integration: src/rpg/controller.js)
  let keyart = null;
  try {
    keyart = RPG_ASSETS.keyart;
  } catch (e) {
    keyart = null;
  }
  const thumb = h('span.menu-rpg__art', { 'aria-hidden': 'true' });
  if (keyart) {
    thumb.appendChild(
      h('img.menu-rpg__img', {
        src: keyart,
        alt: '',
        draggable: 'false',
        decoding: 'async',
        on: { error: (e) => thumb.classList.add('is-missing') || e.target.remove() },
      }),
    );
  } else thumb.classList.add('is-missing');
  const rpgTile = h(
    'button.menu-rpg',
    { type: 'button', 'aria-label': `${t('menu.rpg')} ${t('menu.rpgSub')}`, on: { click: tap(() => ui.emit('open-rpg'), { sound: 'gong', haptic: 14 }) } },
    h('span.menu-rpg__bg'),
    h('span.menu-rpg__shine'),
    thumb,
    h(
      'span.menu-rpg__text',
      h('span.menu-rpg__jp', '盤上戦姫'),
      h('span.menu-rpg__label', { 'data-fit': '16' }, t('menu.rpg')),
      h('span.menu-rpg__sub', t('menu.rpgSub')),
    ),
    h('span.menu-rpg__badge', t('menu.rpgNew')),
    icon('chevron', 'menu-rpg__go'),
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
      rpgTile,
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
