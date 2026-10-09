// Title screen: big animated logo, tagline, "tap to start".

import { h, rng } from '../dom.js';
import { t } from '../i18n.js';
import { logo } from '../logo.js';

export function createTitle(ui) {
  const r = rng(11);
  const embers = h('div.embers', { 'aria-hidden': 'true' });
  for (let i = 0; i < 26; i++) {
    embers.appendChild(
      h('i', {
        style: {
          '--x': (r() * 100).toFixed(1) + '%',
          '--d': (3 + r() * 4).toFixed(2) + 's',
          '--delay': (-r() * 7).toFixed(2) + 's',
          '--dx': ((r() - 0.5) * 80).toFixed(0) + 'px',
          '--s': (0.5 + r() * 1.1).toFixed(2),
        },
      }),
    );
  }
  const el = h(
    'div.screen.screen--title',
    {
      on: {
        click: () => {
          ui.sound('start');
          ui.haptic(15);
          ui.showScreen('menu');
        },
      },
    },
    h(
      'div.ttl__bg',
      { 'aria-hidden': 'true' },
      h('div.ttl__rays'),
      h('div.ttl__kanji', '闘'),
      h('div.ttl__kanji2', '勝'),
      embers,
    ),
    h(
      'div.ttl__center',
      logo({ size: 'big' }),
      h('div.ttl__tagline', { 'data-fit': '12' }, t('app.tagline')),
      h('div.ttl__variants', t('title.sub')),
    ),
    h('div.ttl__tap', h('span.ttl__tap-txt', { 'data-fit': '11' }, t('title.tap'))),
    h('div.ttl__ver', t('app.version', { v: ui.version })),
  );
  return { el };
}
