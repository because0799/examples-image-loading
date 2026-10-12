// «Тренировка» (GDD §16): enemy level 1–30, line-up (random / chapter set / mirror), AI
// difficulty, arena; the player's squad. «В бой!» -> 'start-battle' { mode: 'training', … }.

import { h, rvHeader, rvButton, rvSeg, rvSlider, heroToken, rvSection, assetUrl, artImg } from '../components.js';
import { rt, L, fmt } from '../i18n.js';
import { KANJI, CAMPAIGN, profileSquad, squadEntries, squadPower, trainingEnemies, powerOf, nextStage, getHero } from '../model.js';
import { PROGRESSION } from '../../data/rules.js';

const BGS = ['bg-dawn', 'bg-ash', 'bg-sky'];

export function createTraining(ui, params = {}) {
  const ns = nextStage(ui.profile, ui.meta);
  const st = {
    level: params.level || (ns ? ns.level : 10),
    kind: params.kind || 'random',
    chapter: params.chapter || (ns ? ns.chapter : 1),
    ai: params.ai || 'normal',
    bg: params.bg || 'bg-dawn',
    seed: params.seed || (Date.now() % 100000) + 1,
  };
  const enemiesEl = h('div.rv-train__enemies');
  const chapterRow = h('div.rv-train__chapter');
  const squadEl = h('div.rv-train__squad');
  const bgEl = h('div.rv-train__bgs');

  const enemies = () => trainingEnemies({ kind: st.kind, chapter: st.chapter, level: st.level, profile: ui.profile, seed: st.seed });

  function renderEnemies() {
    enemiesEl.textContent = '';
    const list = enemies();
    let pow = 0;
    for (const e of list) {
      const hero = getHero(e.heroId);
      pow += powerOf(e.heroId, e.level, 0);
      enemiesEl.appendChild(h('div.rv-foe', heroToken(ui, e.heroId, { size: 46, grey: true }), h('span.rv-foe__name', { 'data-fit': '9' }, L(hero.name))));
    }
    enemiesEl.appendChild(h('div.rv-train__epow', `${rt('common.power')} ≈ ${fmt(pow)}`));
    chapterRow.hidden = st.kind !== 'chapter';
    ui.refit(enemiesEl);
  }

  function renderSquad() {
    const squad = profileSquad(ui.profile);
    squadEl.textContent = '';
    squadEl.append(
      h('div.rv-train__tokens', ...squad.map((id) => heroToken(ui, id, { size: 42 }))),
      h('div.rv-train__pow', h('span', rt('campaign.yourPower')), h('b', fmt(squadPower(ui.profile, squad, ui.meta)))),
      rvButton(ui, { label: rt('campaign.editSquad'), icon: 'squad', kind: 'glass', size: 'sm', onClick: () => ui.showScreen('squad', { from: 'training' }) }),
    );
  }

  function renderBgs() {
    bgEl.textContent = '';
    for (const id of BGS) {
      const holder = h('span.rv-train__bgimg');
      const img = artImg(assetUrl(ui, 'bg', id), holder, { alt: '', cls: 'rv-art' });
      if (img) holder.appendChild(img);
      bgEl.appendChild(
        h(
          'button.rv-train__bg',
          {
            type: 'button',
            class: `rv-train__bg--${id} ${st.bg === id ? 'is-active' : ''}`,
            on: {
              click: ui.tap(() => {
                st.bg = id;
                renderBgs();
              }),
            },
          },
          holder,
          h('span.rv-train__bgname', { 'data-fit': '9' }, rt(`bg.${id}`)),
        ),
      );
    }
    ui.refit(bgEl);
  }

  chapterRow.appendChild(
    rvSeg(ui, {
      options: CAMPAIGN.map((c) => ({ value: c.chapter, label: rt('campaign.chapter', { n: c.chapter }) })),
      value: st.chapter,
      onChange: (v) => {
        st.chapter = v;
        st.seed++;
        renderEnemies();
      },
    }),
  );

  const body = h(
    'div.rv-body.rv-scroll',
    h('p.rv-train__sub', rt('training.sub')),
    rvSection(
      rt('training.enemyLevel'),
      h(
        'div.rv-panel.rv-train__panel',
        rvSlider(ui, {
          value: st.level,
          min: 1,
          max: PROGRESSION.maxLevel,
          step: 1,
          label: rt('training.enemyLevel'),
          format: (v) => rt('common.level', { n: v }),
          onInput: (v) => {
            st.level = v;
          },
          onChange: (v) => {
            st.level = v;
            renderEnemies();
          },
        }),
      ),
    ),
    rvSection(
      rt('training.enemies'),
      rvSeg(ui, {
        options: ['random', 'chapter', 'mirror'].map((k) => ({ value: k, label: rt(`training.kind.${k}`) })),
        value: st.kind,
        onChange: (v) => {
          st.kind = v;
          renderEnemies();
        },
      }),
      chapterRow,
      h('div.rv-panel.rv-train__epanel', enemiesEl, rvButton(ui, { label: rt('training.reroll'), icon: 'dice', kind: 'ghost', size: 'sm', cls: 'rv-train__reroll', onClick: () => {
        st.seed++;
        renderEnemies();
      } })),
    ),
    rvSection(
      rt('training.ai'),
      rvSeg(ui, {
        options: ['easy', 'normal', 'hard'].map((k) => ({ value: k, label: rt(`difficulty.${k}`) })),
        value: st.ai,
        onChange: (v) => {
          st.ai = v;
        },
      }),
    ),
    rvSection(rt('training.bg'), bgEl),
    rvSection(rt('campaign.squad'), h('div.rv-panel.rv-train__spanel', squadEl)),
    h('div.rv-body__pad'),
  );

  const fight = () => {
    const squad = profileSquad(ui.profile);
    if (!squad.length) {
      ui.toast(rt('campaign.emptySquad'));
      ui.showScreen('squad', { from: 'training' });
      return;
    }
    ui.emit('start-battle', {
      mode: 'training',
      squads: { 1: squadEntries(ui.profile, squad), '-1': enemies() },
      difficulty: st.ai,
      bg: st.bg,
      enemyLevel: st.level,
      enemyKind: st.kind,
    });
  };

  const el = h(
    'div.rv-screen.rv-train',
    rvHeader(ui, { title: rt('training.title'), kanji: KANJI.training, onBack: () => ui.showScreen('hub', {}, { dir: -1 }) }),
    body,
    h('div.rv-footer', rvButton(ui, { label: rt('training.fight'), icon: 'duel', kind: 'gold', size: 'lg', cls: 'rv-btn--center', sound: 'gong', onClick: fight })),
  );
  renderEnemies();
  renderSquad();
  renderBgs();

  return {
    el,
    refresh() {
      renderSquad();
      renderEnemies();
    },
    state() {
      return { ...st };
    },
  };
}
