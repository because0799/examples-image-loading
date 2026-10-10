// Rules: «Как играть», «Что такое EPIC режим», list of variants -> rules page per variant.

import * as Engine from '../../engine/index.js';
import { h, tap, clear } from '../dom.js';
import { t, tl, loc, locList } from '../i18n.js';
import { icon } from '../icons.js';
import { flagEl } from '../flags.js';
import { boardPreview } from '../board-preview.js';
import { header, section } from '../components.js';

export function createRules(ui, params = {}) {
  // page: { kind: 'list' } | { kind: 'variant', id } | { kind: 'howto' } | { kind: 'epic' }
  let page = params.variantId
    ? { kind: 'variant', id: params.variantId }
    : params.page === 'howto' || params.page === 'epic'
      ? { kind: params.page }
      : { kind: 'list' };
  // opened straight on a sub page (e.g. from the pause menu) -> back closes instead of showing the list
  const direct = page.kind !== 'list' && !params.fromList;

  const headerSlot = h('div.rules__header');
  const body = h('div.scr-body.scr-scroll');
  const el = h('div.screen.screen--rules', h('div.scr-deco', { 'aria-hidden': 'true' }, h('span.deco-kanji', '法')), headerSlot, body);

  const exit = params.onBack || (() => ui.back());
  const goBack = () => {
    if (page.kind !== 'list' && !direct) {
      show({ kind: 'list' }, -1);
      return true;
    }
    exit();
    return true;
  };

  function listPage() {
    const item = (opts) =>
      h(
        'button.list-item',
        { type: 'button', class: opts.cls || '', on: { click: tap(opts.onClick) } },
        opts.lead,
        h('span.list-item__text', h('span.list-item__title', opts.title), opts.sub ? h('span.list-item__sub', opts.sub) : null),
        icon('chevron', 'list-item__chev'),
      );
    return [
      section(
        t('rules.basics'),
        h(
          'div.list',
          item({
            lead: h('span.list-item__glyph', '道'),
            title: t('rules.howTo'),
            sub: t('rules.howToSub'),
            onClick: () => show({ kind: 'howto' }, 1),
          }),
          item({
            lead: h('span.list-item__glyph.list-item__glyph--epic', '必殺'),
            title: t('rules.epic'),
            sub: t('rules.epicSub'),
            cls: 'list-item--epic',
            onClick: () => show({ kind: 'epic' }, 1),
          }),
        ),
      ),
      section(
        t('rules.variants'),
        h(
          'div.list',
          ui.variants.map((v) =>
            item({
              lead: flagEl(v.flag, 'list-item__flag'),
              title: loc(v.name),
              sub: loc(v.short),
              onClick: () => show({ kind: 'variant', id: v.id }, 1),
            }),
          ),
        ),
      ),
    ];
  }

  function textPage(paragraphs, glyph) {
    return [
      h('div.rules-hero', h('span.rules-hero__glyph', glyph)),
      h(
        'div.card.prose',
        paragraphs.map((p, i) => h('p', h('span.prose__num', String(i + 1).padStart(2, '0')), h('span', p))),
      ),
    ];
  }

  /**
   * Giveaway paragraphs for a variant: the engine's per-variant text (it says which draw rules
   * still apply), else the engine's generic GIVEAWAY_RULES, else the UI's short note.
   */
  function giveawayParagraphs(v) {
    const own = locList(v.giveawayRules);
    if (own.length) return own;
    const generic = locList(Engine.GIVEAWAY_RULES);
    if (generic.length) return generic;
    return [t('rules.giveaway')];
  }

  function variantPage(id) {
    const v = ui.variant(id);
    if (!v) return [h('p.prose', '—')];
    const rules = locList(v.rules);
    const squares = v.playable === 'all' ? t('rules.squaresAll') : v.squareTone === 'light' ? t('rules.squaresLight') : t('rules.squaresDark');
    const facts = [
      [t('rules.board'), `${v.size}×${v.size}`],
      [t('rules.pieces'), String(v.piecesPerSide)],
      [t('rules.squares'), squares],
      [t('rules.first'), v.first === -1 ? t('common.black') : t('common.white')],
    ];
    const giveaway = giveawayParagraphs(v);
    return [
      h(
        'div.vhero',
        h('div.vhero__board', boardPreview(v, { px: 132, epic: ui.isEpic, cls: 'vhero__canvas' })),
        h(
          'div.vhero__info',
          h('div.vhero__flagrow', flagEl(v.flag, 'vhero__flag')),
          h('div.vhero__name', { 'data-fit': '13' }, loc(v.name)),
          h('div.vhero__short', loc(v.short)),
        ),
      ),
      h('div.facts', facts.map(([k, val]) => h('div.fact', h('span.fact__v', { 'data-fit': '9' }, val), h('span.fact__k', k)))),
      locList(v.badges).length
        ? section(t('rules.keyFacts'), h('div.badges', locList(v.badges).map((b) => h('span.badge.badge--lg', b))))
        : null,
      rules.length
        ? section(
            t('rules.full'),
            h('div.card.prose', rules.map((p, i) => h('p', h('span.prose__num', String(i + 1).padStart(2, '0')), h('span', p)))),
          )
        : null,
      section(
        t('rules.giveawayTitle'),
        h(
          'div.card.prose.prose--giveaway',
          giveaway.map((p, i) => h('p', h('span.prose__num', i === 0 ? '逆' : String(i + 1).padStart(2, '0')), h('span', p))),
        ),
      ),
    ];
  }

  function show(next, dir = 0) {
    page = next;
    let title = t('rules.title');
    let content;
    if (page.kind === 'list') content = listPage();
    else if (page.kind === 'howto') {
      title = t('rules.howTo');
      content = textPage(tl('rules.howToText'), '道');
    } else if (page.kind === 'epic') {
      title = t('rules.epic');
      content = textPage(tl('rules.epicText'), '必殺');
    } else {
      const v = ui.variant(page.id);
      title = v ? loc(v.name) : t('rules.title');
      content = variantPage(page.id);
    }
    clear(headerSlot).appendChild(header({ title, onBack: goBack, kanji: page.kind === 'epic' ? '必殺' : '規則' }));
    clear(body);
    body.append(...content.filter(Boolean), h('div.scr-body__pad'));
    body.scrollTop = 0;
    if (dir) {
      body.classList.remove('page-in-fwd', 'page-in-back');
      void body.offsetWidth;
      body.classList.add(dir > 0 ? 'page-in-fwd' : 'page-in-back');
    }
    ui.refit(el);
  }

  show(page);
  return {
    el,
    back: () => goBack(),
    state: () =>
      page.kind === 'variant'
        ? { variantId: page.id, fromList: !direct }
        : page.kind === 'list'
          ? { variantId: undefined, page: undefined }
          : { page: page.kind, fromList: !direct },
    onTheme: () => show(page),
  };
}
