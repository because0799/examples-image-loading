// «Коллекция» (GDD §17.3): 3-column card grid with rarity frames, locked silhouettes, filters by
// rarity / element / role / owned and a sort switch. Tapping a card opens the hero screen.

import { h, rvHeader, heroCard, chip, elementBadge } from '../components.js';
import { rvIcon } from '../icons.js';
import { rt, L } from '../i18n.js';
import { KANJI, ELEMENTS, ELEMENT_ORDER, ROLES, ROLE_ORDER, RARITY_ORDER, SORTS, collectionList, collectionCount, profileSquad } from '../model.js';

const DEFAULT_FILTERS = { rarity: 'all', element: 'all', role: 'all', owned: 'all', sort: 'rarity' };

export function createCollection(ui, params = {}) {
  const f = { ...DEFAULT_FILTERS, ...(ui._collectionFilters || {}), ...(params.filters || {}) };
  const grid = h('div.rv-coll__grid');
  const countEl = h('span.rv-coll__count');
  const filtersEl = h('div.rv-coll__filters');
  const scroller = h('div.rv-body.rv-scroll.rv-coll__body', filtersEl, grid, h('div.rv-body__pad'));

  const save = () => {
    ui._collectionFilters = { ...f };
  };

  function renderFilters() {
    filtersEl.textContent = '';
    const row = (label, ...chips) => h('div.rv-coll__frow', h('span.rv-coll__flabel', label), h('div.rv-coll__chips.rv-hscroll', ...chips));
    const set = (k, v) => () => {
      f[k] = f[k] === v && v !== 'all' ? 'all' : v;
      save();
      renderFilters();
      renderGrid();
    };
    filtersEl.append(
      row(
        rt('collection.rarityFilter'),
        chip(ui, { label: rt('collection.filterAll'), active: f.rarity === 'all', onClick: set('rarity', 'all') }),
        ...RARITY_ORDER.map((r) => chip(ui, { label: rt(`rarity.${r}`), active: f.rarity === r, cls: `rv-chip--r rv-chip--${r}`, onClick: set('rarity', r) })),
      ),
      row(
        rt('collection.elementFilter'),
        chip(ui, { label: rt('collection.filterAll'), active: f.element === 'all', onClick: set('element', 'all') }),
        ...ELEMENT_ORDER.map((e) => chip(ui, { node: elementBadge(e), active: f.element === e, title: L(ELEMENTS[e].name), cls: 'rv-chip--icon', onClick: set('element', e) })),
      ),
      row(
        rt('collection.roleFilter'),
        chip(ui, { label: rt('collection.filterAll'), active: f.role === 'all', onClick: set('role', 'all') }),
        ...ROLE_ORDER.map((r) => chip(ui, { icon: r, label: L(ROLES[r].name), active: f.role === r, onClick: set('role', r) })),
      ),
      h(
        'div.rv-coll__frow.rv-coll__frow--last',
        h(
          'div.rv-coll__chips',
          chip(ui, { label: rt('collection.filterAll'), active: f.owned === 'all', onClick: set('owned', 'all') }),
          chip(ui, { label: rt('collection.owned'), active: f.owned === 'owned', onClick: set('owned', 'owned') }),
          chip(ui, { label: rt('collection.missing'), active: f.owned === 'missing', onClick: set('owned', 'missing') }),
        ),
        h(
          'button.rv-coll__sort',
          {
            type: 'button',
            on: {
              click: ui.tap(() => {
                f.sort = SORTS[(SORTS.indexOf(f.sort) + 1) % SORTS.length];
                save();
                renderFilters();
                renderGrid();
              }),
            },
          },
          rvIcon('stairs', 'rv-coll__sort-ico'),
          h('span', rt(`collection.sort.${f.sort}`)),
        ),
      ),
    );
  }

  function renderGrid() {
    const list = collectionList(ui.profile, f, ui.meta, ui.lang);
    const squad = profileSquad(ui.profile);
    grid.textContent = '';
    if (!list.length) {
      grid.appendChild(
        h(
          'div.rv-coll__empty',
          h('p', rt('collection.empty')),
          h(
            'button.rv-chip.is-active',
            {
              type: 'button',
              on: {
                click: ui.tap(() => {
                  Object.assign(f, DEFAULT_FILTERS);
                  save();
                  renderFilters();
                  renderGrid();
                }),
              },
            },
            rt('collection.reset'),
          ),
        ),
      );
    }
    for (const it of list) {
      grid.appendChild(
        heroCard(ui, it.id, {
          owned: it.owned,
          level: it.level,
          constellation: it.constellation,
          tag: it.owned && squad.includes(it.id) ? rt('hero.inSquad') : null,
          onClick: (id) => {
            save();
            ui.showScreen('hero', { heroId: id, from: 'collection' });
          },
        }),
      );
    }
    const c = collectionCount(ui.profile);
    countEl.textContent = rt('collection.count', c);
    ui.refit(grid);
  }

  renderFilters();
  renderGrid();

  const el = h(
    'div.rv-screen.rv-coll',
    rvHeader(ui, {
      title: rt('collection.title'),
      kanji: KANJI.collection,
      onBack: () => ui.showScreen('hub', {}, { dir: -1 }),
      right: h('span.rv-coll__badge', rvIcon('collection'), countEl),
    }),
    scroller,
  );
  return {
    el,
    refresh() {
      renderGrid();
    },
    state() {
      return { filters: { ...f } };
    },
  };
}
