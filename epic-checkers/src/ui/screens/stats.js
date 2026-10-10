// Statistics: totals vs AI, feats, per-variant results, other modes, titles (achievements).

import { h, formatDuration } from '../dom.js';
import { t, loc } from '../i18n.js';
import { icon } from '../icons.js';
import { flagEl } from '../flags.js';
import { header, section } from '../components.js';
import { TITLES } from '../titles.js';

export function titleBadge(info, { big = false } = {}) {
  const { id, icon: glyph, tier, unlocked, progress } = info;
  const name = t(`title.${id}.name`);
  const longest = Math.max(...name.split(/\s+/).map((w) => w.length));
  const prog = !unlocked && progress && progress[1] > 1 ? progress : null;
  return h(
    'div.tbadge',
    { class: `tier-${tier} ${unlocked ? 'is-unlocked' : 'is-locked'} ${big ? 'tbadge--big' : ''}` },
    h('span.tbadge__emblem', h('span.tbadge__glyph', glyph), unlocked ? null : icon('lock', 'tbadge__lock')),
    h(
      'span.tbadge__text',
      h('span.tbadge__name', { style: { '--wl': longest } }, name),
      h('span.tbadge__desc', t(`title.${id}.desc`)),
      prog
        ? h(
            'span.tbadge__prog',
            h('span.tbadge__bar', { style: { '--p': ((prog[0] / prog[1]) * 100).toFixed(1) + '%' } }),
            h('span.tbadge__progtxt', t('stats.progress', { cur: prog[0], goal: prog[1] })),
          )
        : null,
    ),
  );
}

export function createStats(ui) {
  const store = ui.stats;
  const d = store ? store.get() : null;
  const titles = store ? store.titles() : TITLES.map((x) => ({ id: x.id, icon: x.icon, tier: x.tier, unlocked: false, progress: null }));
  const unlocked = titles.filter((x) => x.unlocked).length;
  const currentId = store ? store.currentTitle() : null;
  const current = currentId ? TITLES.find((x) => x.id === currentId) : null;
  const totals = d ? d.totals : { games: 0, wins: 0, losses: 0, draws: 0, captures: 0, kingsMade: 0, flawless: 0, durationSec: 0 };
  const winRate = totals.games ? Math.round((totals.wins / totals.games) * 100) : 0;

  const hero = h(
    'div.stats-hero',
    { class: current ? `tier-${current.tier}` : 'tier-0' },
    h('span.stats-hero__emblem', h('span.stats-hero__glyph', current ? current.icon : '初')),
    h(
      'span.stats-hero__text',
      h('span.stats-hero__label', t('stats.yourTitle')),
      h('span.stats-hero__name', { 'data-fit': '14' }, current ? t(`title.${current.id}.name`) : t('menu.rookie')),
      // no title yet: a goal (the «play your first game» note below is shown only once)
      h('span.stats-hero__desc', current ? t(`title.${current.id}.desc`) : t('stats.noTitle')),
      h(
        'span.stats-hero__prog',
        h('span.stats-hero__bar', { style: { '--p': ((unlocked / TITLES.length) * 100).toFixed(1) + '%' } }),
        h('span.stats-hero__count', `${t('stats.titles')}: ${t('stats.titlesCount', { n: unlocked, total: TITLES.length })}`),
      ),
    ),
  );

  const ring = h(
    'div.ring',
    { style: { '--p': winRate } },
    h('span.ring__val', `${winRate}%`),
    h('span.ring__label', t('stats.winRate')),
  );
  const num = (val, label, cls = '') => h('div.num', { class: cls }, h('span.num__v', String(val)), h('span.num__k', label));
  const results = h(
    'div.card.results',
    ring,
    h(
      'div.results__grid',
      num(totals.games, t('stats.games')),
      num(totals.wins, t('stats.wins'), 'num--win'),
      num(totals.losses, t('stats.losses'), 'num--loss'),
      num(totals.draws, t('stats.draws'), 'num--draw'),
    ),
  );

  const feat = (glyph, val, label) => h('div.feat', h('span.feat__glyph', glyph), h('span.feat__v', String(val)), h('span.feat__k', label));
  const best = d ? d.best : { combo: 0, streak: 0 };
  const feats = h(
    'div.feats',
    feat('連', best.combo ? `×${best.combo}` : '—', t('stats.bestCombo')),
    feat('斬', totals.captures, t('stats.captures')),
    feat('王', totals.kingsMade, t('stats.kings')),
    feat('完', totals.flawless, t('stats.flawless')),
    feat('炎', d ? d.streak : 0, t('stats.streak')),
    feat('伝', best.streak, t('stats.bestStreak')),
  );

  const perVariant = h(
    'div.card.pv',
    ui.variants.map((v) => {
      const s = (d && d.perVariant[v.id]) || { games: 0, wins: 0, losses: 0, draws: 0 };
      const g = s.games || 0;
      const pct = (x) => (g ? ((x / g) * 100).toFixed(1) + '%' : '0%');
      return h(
        'div.pv__row',
        { class: g ? '' : 'is-empty' },
        flagEl(v.flag, 'pv__flag'),
        h(
          'div.pv__main',
          h('div.pv__name', loc(v.name)),
          g
            ? h('div.pv__bar', h('i.w', { style: { width: pct(s.wins) } }), h('i.d', { style: { width: pct(s.draws) } }), h('i.l', { style: { width: pct(s.losses) } }))
            : h('div.pv__none', t('stats.noGames')),
        ),
        h(
          'div.pv__nums',
          h('span.w', `${t('stats.w')} ${s.wins}`),
          h('span.l', `${t('stats.l')} ${s.losses}`),
          h('span.d', `${t('stats.d')} ${s.draws}`),
        ),
      );
    }),
  );

  const other = h(
    'div.card.other',
    h('div.other__row', icon('users'), h('span', t('stats.pvpGames')), h('b', String(d ? d.pvpGames : 0))),
    h('div.other__row', icon('swords'), h('span', t('stats.demoGames')), h('b', String(d ? d.demoGames : 0))),
    h('div.other__row', icon('speed'), h('span', t('stats.playTime')), h('b', formatDuration(totals.durationSec, t))),
  );

  const grid = h('div.tgrid', titles.map((x) => titleBadge(x)));

  const el = h(
    'div.screen.screen--stats',
    h('div.scr-deco', { 'aria-hidden': 'true' }, h('span.deco-kanji', '誉')),
    header({ title: t('stats.title'), onBack: () => ui.back(), kanji: '戦績' }),
    h(
      'div.scr-body.scr-scroll',
      hero,
      section(t('stats.vsAi'), results),
      totals.games ? null : h('div.note', icon('info', 'note__icon'), h('span', t('stats.empty'))),
      section(t('stats.feats'), feats),
      section(`${t('stats.titles')} · ${t('stats.titlesCount', { n: unlocked, total: TITLES.length })}`, grid),
      section(t('stats.perVariant'), perVariant),
      section(t('stats.other'), other),
      h('div.scr-body__pad'),
    ),
  );
  return { el, state: () => ({}) };
}
