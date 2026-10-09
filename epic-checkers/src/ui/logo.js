// «EPIC ШАШКИ» logo: layered text, chromatic glow, slash and an energy bolt. Pure CSS animation.

import { h } from './dom.js';
import { t } from './i18n.js';

const BOLT =
  '<svg viewBox="0 0 120 40" preserveAspectRatio="none" aria-hidden="true">' +
  '<path class="lb1" d="M2 30 L26 18 L22 24 L50 10 L46 17 L78 4"/>' +
  '<path class="lb2" d="M118 8 L96 20 L100 24 L74 36"/></svg>';

/** size: 'big' (title screen) | 'small' (menu header). */
export function logo({ size = 'big' } = {}) {
  const top = t('app.logoTop');
  const main = t('app.logoMain');
  return h(
    'div.logo',
    { class: `logo--${size}`, role: 'img', 'aria-label': t('app.name') },
    h('span.logo__glow', { 'aria-hidden': 'true' }),
    h('span.logo__bolt', { html: BOLT }),
    h(
      'span.logo__top',
      h('span.logo__line'),
      h('span.logo__epic', { 'data-text': top }, top),
      h('span.logo__line'),
    ),
    h('span.logo__main', { 'data-fit': size === 'big' ? '28' : '20' }, h('span.logo__main-txt', { 'data-text': main }, main)),
    h('span.logo__slash', { 'aria-hidden': 'true' }),
    h('span.logo__sub', { 'aria-hidden': 'true' }, '必 殺 · 対 決 · 勝 利'),
  );
}
