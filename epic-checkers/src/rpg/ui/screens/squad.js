// «Отряд» (GDD §17.5): 6 slots, squad power, element-reaction and role-coverage hints, the owned
// heroes to pick from, «Авто» and «Сохранить» (emits 'set-squad').

import { h, rvHeader, rvButton, heroCard, rvSection, roleBadge, heroToken } from '../components.js';
import { rvIcon } from '../icons.js';
import { rt, L, fmt } from '../i18n.js';
import {
  KANJI,
  SQUAD_SIZE,
  REACTIONS,
  ROLES,
  ROLE_ORDER,
  profileSquad,
  ownedIds,
  squadPower,
  squadSynergy,
  autoSquad,
  heroLevel,
  heroConstellation,
  heroPower,
  stageById,
  recommendedPower,
  getHero,
  RARITY_RANK,
} from '../model.js';

export function createSquad(ui, params = {}) {
  let ids = Array.isArray(params.draft) ? params.draft.slice() : profileSquad(ui.profile);
  const stage = params.stageId ? stageById(params.stageId) : null;
  const from = params.from || 'hub';
  const saved = () => profileSquad(ui.profile).join(',') === ids.join(',');

  const powerEl = h('b.rv-squad__power');
  const recEl = h('div.rv-squad__rec');
  const slotsEl = h('div.rv-squad__slots');
  const synEl = h('div.rv-squad__syn');
  const pickEl = h('div.rv-squad__pick');
  const titleCount = h('span.rv-squad__count');

  function goBack() {
    if (stage) ui.showScreen('campaign', { chapter: stage.chapter, stageId: stage.id }, { dir: -1 });
    else ui.showScreen(from === 'training' || from === 'campaign' ? from : 'hub', {}, { dir: -1 });
  }

  async function tryBack() {
    if (!saved() && ids.length) {
      const ok = await ui.confirm(rt('squad.unsaved'), { ok: rt('squad.save'), cancel: rt('squad.discard') });
      if (ok) save(false);
    }
    goBack();
  }

  function save(navigate = true) {
    if (!ids.length) {
      ui.toast(rt('squad.needOne'));
      return;
    }
    ui.emit('set-squad', ids.slice());
    ui.toast(rt('squad.saved'));
    if (navigate && stage) goBack();
  }

  function toggle(id) {
    const i = ids.indexOf(id);
    if (i >= 0) ids.splice(i, 1);
    else if (ids.length >= SQUAD_SIZE) {
      ui.toast(rt('squad.full'));
      return;
    } else ids.push(id);
    render();
  }

  function render() {
    const profile = ui.profile;
    // power
    const p = squadPower(profile, ids, ui.meta);
    powerEl.textContent = fmt(p);
    titleCount.textContent = rt('squad.slots', { n: ids.length });
    recEl.textContent = '';
    if (stage) {
      const rec = recommendedPower(stage);
      recEl.append(
        h('span', `${rt('campaign.recPower')}: `),
        h('b', { class: p >= rec ? 'is-ok' : 'is-low' }, fmt(rec)),
      );
    }

    // slots
    slotsEl.textContent = '';
    for (let i = 0; i < SQUAD_SIZE; i++) {
      const id = ids[i];
      if (id) {
        const hero = getHero(id);
        slotsEl.appendChild(
          h(
            'button.rv-slot.is-filled',
            { type: 'button', class: `rv-slot--${hero.rarity}`, 'aria-label': L(hero.name), on: { click: ui.tap(() => toggle(id)) } },
            heroToken(ui, id, { size: 64 }),
            h('span.rv-slot__name', { 'data-fit': '9' }, L(hero.name)),
            h('span.rv-slot__lvl', rt('common.level', { n: heroLevel(profile, id) })),
            h('span.rv-slot__x', { 'aria-hidden': 'true' }, '×'),
          ),
        );
      } else {
        slotsEl.appendChild(h('div.rv-slot.is-empty', h('span.rv-slot__plus', '+'), h('span.rv-slot__name', rt('squad.empty'))));
      }
    }

    // synergy
    const syn = squadSynergy(ids);
    synEl.textContent = '';
    const reacts = syn.reactions.map((rid) => {
      const r = REACTIONS[rid];
      return h('span.rv-react', { style: { '--a': r.color[0], '--b': r.color[1] }, title: L(r.desc) }, h('b', r.kanji), L(r.name));
    });
    synEl.append(
      h('div.rv-squad__synrow', h('span.rv-squad__synlabel', rt('squad.reactions')), h('div.rv-squad__reacts', ...(reacts.length ? reacts : [h('span.rv-squad__none', rt('squad.noReactions'))]))),
      h(
        'div.rv-squad__synrow',
        h('span.rv-squad__synlabel', rt('squad.roles')),
        h(
          'div.rv-squad__roles',
          ...ROLE_ORDER.map((r) => h('span.rv-squad__role', { class: syn.roles[r] ? 'is-on' : '', title: L(ROLES[r].name) }, roleBadge(r), syn.roles[r] > 1 ? h('i', `×${syn.roles[r]}`) : null)),
        ),
      ),
    );
    const hints = [];
    if (ids.length) {
      if (syn.missingRoles.length) hints.push(rt('squad.missingRoles', { list: syn.missingRoles.map((r) => L(ROLES[r].name)).join(', ') }));
      else hints.push(rt('squad.allRoles'));
      if (syn.noHealer) hints.push(rt('squad.noHealer'));
      if (syn.noGuardian) hints.push(rt('squad.noGuardian'));
    }
    if (hints.length) synEl.appendChild(h('ul.rv-squad__hints', ...hints.map((t, i) => h('li', { class: i > 0 || syn.missingRoles.length ? 'is-warn' : 'is-ok' }, t))));

    // picker
    pickEl.textContent = '';
    const owned = ownedIds(profile).sort(
      (a, b) => RARITY_RANK[getHero(b).rarity] - RARITY_RANK[getHero(a).rarity] || heroPower(profile, b, ui.meta) - heroPower(profile, a, ui.meta),
    );
    for (const id of owned) {
      pickEl.appendChild(
        heroCard(ui, id, {
          owned: true,
          level: heroLevel(profile, id),
          constellation: heroConstellation(profile, id),
          compact: true,
          selected: ids.includes(id),
          onClick: toggle,
        }),
      );
    }
    ui.refit(el);
  }

  const powerBox = h(
    'div.rv-squad__top.rv-panel',
    h('div.rv-squad__pw', h('span.rv-squad__pwlabel', rt('squad.power')), h('div.rv-squad__pwrow', rvIcon('sword', 'rv-squad__pwico'), powerEl), recEl),
    rvButton(ui, {
      label: rt('squad.auto'),
      icon: 'auto',
      kind: 'glass',
      size: 'sm',
      cls: 'rv-squad__auto',
      onClick: () => {
        ids = autoSquad(ui.profile, ui.meta);
        render();
      },
    }),
  );

  const body = h(
    'div.rv-body.rv-scroll',
    powerBox,
    rvSection(null, h('div.rv-squad__slotshead', titleCount), slotsEl),
    synEl,
    rvSection(rt('squad.pick'), h('p.rv-squad__pickhint', rt('squad.pickHint')), pickEl),
    h('div.rv-body__pad'),
  );
  const footer = h(
    'div.rv-footer',
    rvButton(ui, {
      label: rt('squad.clear'),
      icon: 'trash',
      kind: 'ghost',
      size: 'md',
      cls: 'rv-btn--center rv-squad__clear',
      onClick: () => {
        ids = [];
        render();
      },
    }),
    rvButton(ui, { label: rt('squad.save'), icon: 'check', kind: 'gold', size: 'md', cls: 'rv-btn--center', onClick: () => save(true) }),
  );
  const el = h('div.rv-screen.rv-squad', rvHeader(ui, { title: rt('squad.title'), kanji: KANJI.squad, onBack: tryBack }), body, footer);
  render();

  return {
    el,
    refresh() {
      // the saved squad changed elsewhere: keep the local draft unless it was unchanged
      render();
    },
    state() {
      return { draft: ids.slice() };
    },
    back() {
      tryBack();
      return true;
    },
  };
}
