// «Призыв» (GDD §12, §17.6): banner with the Mythic heroes, pity counters, ×1 / ×10 with cost,
// crystals, the rates sheet. Tapping a summon button emits 'summon'(count); the integration runs
// meta.summon, calls ui.setProfile and then ui.playSummon(results).

import { h, rvHeader, rvButton, currencyPill, heroSplash, heroToken, assetUrl, artImg, bar, starfield } from '../components.js';
import { rvIcon } from '../icons.js';
import { rt, rtList, L, fmt } from '../i18n.js';
import { KANJI, RARITY_ORDER, HEROES, crystalsOf, pityInfo, summonCost, canSummonCount, isOwned } from '../model.js';
import { GACHA } from '../../data/rules.js';

export function createSummon(ui, params = {}) {
  const curEl = h('span.rv-summon__cur');
  const body = h('div.rv-body.rv-scroll.rv-summon__body');
  const footer = h('div.rv-footer.rv-summon__footer');

  function openRates() {
    ui.openSheet(
      () =>
        h(
          'div.rv-rates',
          h(
            'div.rv-rates__table',
            ...[...RARITY_ORDER].reverse().map((r) =>
              h(
                'div.rv-rates__row',
                { class: `rv-rates__row--${r}` },
                h('span.rv-rates__name', rt(`rarity.${r}`)),
                h('span.rv-rates__count', `${HEROES.filter((x) => x.rarity === r).length}`),
                h('b.rv-rates__pct', `${(GACHA.rates[r] * 100).toFixed(1).replace(/\.0$/, '')}%`),
              ),
            ),
          ),
          h('h3.rv-rates__sub', rt('summon.pityTitle')),
          h('ul.rv-rates__list', ...rtList('summon.pityText').map((t) => h('li', t))),
        ),
      { title: rt('summon.ratesTitle'), kanji: '確率' },
    );
  }

  function pull(count) {
    const profile = ui.profile;
    if (!canSummonCount(profile, count, ui.meta)) {
      ui.toast(rt('summon.notEnough', { n: fmt(summonCost(count, ui.meta)) }));
      ui.haptic([10, 40, 10]);
      return;
    }
    ui.emit('summon', count);
  }

  function render() {
    const profile = ui.profile;
    const pity = pityInfo(profile, ui.meta);
    curEl.textContent = '';
    curEl.appendChild(currencyPill('crystals', crystalsOf(profile)));
    body.textContent = '';

    // banner: key art, else the two Mythic splashes split diagonally
    const art = h('div.rv-banner__art');
    const keyart = assetUrl(ui, 'keyart');
    const split = h('div.rv-banner__split', heroSplash(ui, 'liora', { cls: 'rv-banner__a' }), heroSplash(ui, 'nocturna', { cls: 'rv-banner__b' }), h('span.rv-banner__cut'));
    art.appendChild(split);
    if (keyart) {
      const holder = h('div.rv-banner__keyart');
      const img = artImg(keyart, holder, { alt: '', cls: 'rv-art', lazy: false });
      if (img) {
        holder.appendChild(img);
        art.appendChild(holder);
      }
    }
    const banner = h(
      'div.rv-banner',
      art,
      starfield(9, 22, 'rv-banner__stars'),
      h('div.rv-banner__shade'),
      h('div.rv-banner__kanji', { 'aria-hidden': 'true' }, '星降'),
      h(
        'div.rv-banner__text',
        h('div.rv-banner__tag', rvIcon('sparkle'), rt('rarity.mythic')),
        h('h2.rv-banner__title', { 'data-fit': '18' }, rt('summon.banner')),
        h('p.rv-banner__sub', rt('summon.bannerSub')),
      ),
      h('button.rv-banner__rates', { type: 'button', on: { click: ui.tap(openRates) } }, rvIcon('info'), rt('summon.rates')),
    );
    body.appendChild(banner);

    if (pity.novicePullsLeft > 0) body.appendChild(h('div.rv-novice', rvIcon('sparkle', 'rv-novice__ico'), h('span', rt('summon.novice', { n: pity.novicePullsLeft }))));

    const pityCard = (label, left, total, cls) =>
      h('div.rv-pity', { class: cls }, h('div.rv-pity__row', h('span', label), h('b', String(left))), bar(1 - (left - 1) / total, { kind: 'xp', cls: 'rv-pity__bar' }));
    body.appendChild(
      h(
        'div.rv-pities',
        pityCard(rt('summon.epicPity'), pity.toEpicPlus, GACHA.pity.epicPlusEvery, 'rv-pity--epic'),
        pityCard(rt('summon.legendaryPity'), pity.toLegendaryPlus, GACHA.pity.legendaryPlusHard, 'rv-pity--legendary'),
      ),
    );

    // showcase: Legendary+ heroes (owned in colour, missing as reflections)
    const showcase = HEROES.filter((x) => x.rarity === 'mythic' || x.rarity === 'legendary');
    body.appendChild(
      h(
        'div.rv-showcase',
        ...showcase.map((x) =>
          h(
            'button.rv-showcase__item',
            { type: 'button', class: `rv-showcase__item--${x.rarity}`, on: { click: ui.tap(() => ui.showScreen('hero', { heroId: x.id, from: 'summon' })) } },
            heroToken(ui, x.id, { size: 50, grey: !isOwned(profile, x.id) }),
            h('span.rv-showcase__name', { 'data-fit': '9' }, L(x.name)),
          ),
        ),
      ),
    );
    body.appendChild(h('p.rv-summon__hint', rt('summon.earnHint')));
    body.appendChild(h('div.rv-body__pad'));

    footer.textContent = '';
    const can1 = canSummonCount(profile, 1, ui.meta);
    const can10 = canSummonCount(profile, 10, ui.meta);
    footer.append(
      rvButton(ui, { label: rt('summon.once'), kind: 'glass', size: 'md', cost: summonCost(1, ui.meta), cls: `rv-summon__btn ${can1 ? '' : 'is-poor'}`, onClick: () => pull(1), sound: null }),
      rvButton(ui, {
        label: rt('summon.ten'),
        kind: 'crystal',
        size: 'md',
        cost: summonCost(10, ui.meta),
        cls: `rv-summon__btn ${can10 ? '' : 'is-poor'}`,
        badge: pity.novicePullsLeft > 0 ? rt('rarity.legendary') + '+' : null,
        onClick: () => pull(10),
        sound: null,
      }),
    );
    ui.refit(el);
  }

  const el = h(
    'div.rv-screen.rv-summon',
    rvHeader(ui, { title: rt('summon.title'), kanji: KANJI.summon, onBack: () => ui.showScreen('hub', {}, { dir: -1 }), right: curEl }),
    body,
    footer,
  );
  render();
  return { el, refresh: render };
}
