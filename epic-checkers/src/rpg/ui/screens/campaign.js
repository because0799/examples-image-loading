// «Кампания» (GDD §14, §17.7): 3 chapters × (8 + boss) nodes on a diagonal path of checker tiles,
// stars and locks; tapping a node opens the stage sheet (enemies as Reflections, level, rules,
// rewards, recommended vs squad power) with «В бой!» -> 'start-battle'.

import { h, rvHeader, rvButton, heroToken, assetUrl, artImg, rvSection, starfield } from '../components.js';
import { rvIcon } from '../icons.js';
import { rt, L, fmt } from '../i18n.js';
import {
  KANJI,
  CAMPAIGN,
  REACTIONS,
  ELEMENTS,
  chapterNodes,
  chapterSummary,
  currentChapter,
  stageById,
  stageProgress,
  isStageUnlocked,
  stageEnemyIds,
  recommendedPower,
  stageRewards,
  roundLimitOf,
  threeStarRoundsOf,
  profileSquad,
  squadPower,
  squadEntries,
  campaignStars,
  STAGE_LIST,
  getHero,
} from '../model.js';

// node positions (x %, from the bottom up), boss last
const PATH_X = [22, 50, 78, 56, 26, 46, 76, 52, 50];

function ruleText(stage) {
  const r = stage.rule;
  if (!r) return null;
  const p = { ...r };
  if (r.id === 'reactionBoost') p.reaction = L((REACTIONS[r.reaction] || {}).name || r.reaction);
  if (r.id === 'elementBoost' || r.id === 'sealDuration') p.element = L((ELEMENTS[r.element] || {}).name || r.element);
  if (r.id === 'elementBoost') p.pct = Math.round((r.pct || 0) * 100);
  if (r.id === 'removeFiles') p.files = (r.files || []).join(', ');
  if (r.id === 'escort') p.rounds = r.surviveRounds;
  if (r.id === 'reactionBoost' && r.mult) p.reaction += ` ×${r.mult}`;
  const key = `campaign.rules.${r.id}`;
  const t = rt(key, p);
  return t === key ? null : t;
}

export function startStage(ui, stage) {
  const profile = ui.profile;
  const squad = profileSquad(profile);
  if (!squad.length) {
    ui.toast(rt('campaign.emptySquad'));
    ui.showScreen('squad', { from: 'campaign', stageId: stage.id });
    return;
  }
  const ch = CAMPAIGN.find((c) => c.chapter === stage.chapter);
  ui.emit('start-battle', {
    mode: 'campaign',
    stageId: stage.id,
    squads: { 1: squadEntries(profile, squad) },
    difficulty: stage.ai,
    bg: ch ? ch.bg : 'bg-dawn',
  });
}

export function openStageSheet(ui, stageId) {
  const stage = stageById(stageId);
  if (!stage) return null;
  const build = (close) => {
    const profile = ui.profile;
    const ch = CAMPAIGN.find((c) => c.chapter === stage.chapter);
    const pr = stageProgress(profile, stage.id);
    const unlocked = isStageUnlocked(profile, stage.id, ui.meta);
    const enemies = stageEnemyIds(stage, profile);
    const elites = new Set([...(stage.elite || []), ...(stage.miniBoss ? [stage.miniBoss.hero] : [])]);
    const squad = profileSquad(profile);
    const power = squadPower(profile, squad, ui.meta);
    const rec = recommendedPower(stage);
    const rw = stageRewards(stage);
    const out = [];

    out.push(
      h(
        'div.rv-stage__meta',
        h('span.rv-stage__pill', rt('campaign.level', { n: stage.level })),
        h('span.rv-stage__pill', rt('campaign.ai', { ai: rt(`difficulty.${stage.ai}`) })),
        h('span.rv-stage__pill', rt('campaign.roundLimit', { n: roundLimitOf(stage) })),
      ),
    );
    const notes = [];
    if (stage.tutorial) notes.push(rt(`campaign.tutorial.${stage.tutorial}`));
    const rule = ruleText(stage);
    if (rule) notes.push(rule);
    if (notes.length) out.push(h('div.rv-stage__rule', rvIcon('info', 'rv-stage__ruleico'), h('div', ...notes.map((n) => h('p', n)))));

    // enemies (Reflections)
    out.push(
      rvSection(
        rt('campaign.enemies'),
        h(
          'div.rv-stage__enemies',
          ...enemies.map((id, i) => {
            const hero = getHero(id);
            if (!hero) return null;
            const boss = stage.boss && i === 0;
            const elite = elites.has(id);
            return h(
              'div.rv-foe',
              { class: `${boss ? 'is-boss' : ''} ${elite ? 'is-elite' : ''}` },
              heroToken(ui, id, { size: boss ? 64 : 50, grey: true }),
              h('span.rv-foe__name', { 'data-fit': '9' }, L(hero.name)),
              boss || elite ? h('span.rv-foe__tag', boss ? rt('common.boss') : rt('common.elite')) : null,
            );
          }),
        ),
      ),
    );
    if (stage.mechanics && stage.mechanics.length) {
      out.push(rvSection(rt('campaign.mechanics'), h('ul.rv-stage__list', ...stage.mechanics.map((m) => h('li', L(m.desc))))));
    }
    if (ch && ch.gimmick) out.push(rvSection(`${rt('campaign.gimmick')}: ${L(ch.gimmick.name)}`, h('p.rv-stage__text', L(ch.gimmick.desc))));

    // stars
    const starRow = (n, text) => h('div.rv-stage__star', { class: pr.stars >= n ? 'is-lit' : '' }, h('span.rv-stage__stars', ...Array.from({ length: n }, () => rvIcon('star'))), h('span', text));
    out.push(
      rvSection(
        rt('campaign.starsTitle'),
        h('div.rv-stage__starlist', starRow(1, rt('campaign.star1')), starRow(2, rt('campaign.star2')), starRow(3, rt('campaign.star3', { n: threeStarRoundsOf(stage) }))),
      ),
    );

    // rewards
    out.push(
      rvSection(
        rt('campaign.rewards'),
        h(
          'div.rv-stage__rewards',
          h('div.rv-reward', { class: pr.cleared ? 'is-done' : '' }, rvIcon('crystal', 'rv-reward__cry'), h('b', `+${fmt(rw.crystals)}`), h('span', rt('campaign.firstClear'))),
          h('div.rv-reward', { class: pr.cleared ? 'is-done' : '' }, rvIcon('scroll', 'rv-reward__scr'), h('b', `+${rw.scrolls}`), h('span', rt('common.scrolls'))),
          h('div.rv-reward', { class: pr.stars >= 3 ? 'is-done' : '' }, rvIcon('crystal', 'rv-reward__cry'), h('b', `+${fmt(rw.chest)}`), h('span', rt('campaign.chest'))),
        ),
      ),
    );

    // squad + power
    out.push(
      rvSection(
        rt('campaign.squad'),
        h(
          'div.rv-stage__squad',
          h('div.rv-stage__tokens', ...squad.map((id) => heroToken(ui, id, { size: 40 }))),
          h(
            'div.rv-stage__power',
            h('div', h('span', rt('campaign.yourPower')), h('b', { class: power >= rec ? 'is-ok' : 'is-low' }, fmt(power))),
            h('div', h('span', rt('campaign.recPower')), h('b', fmt(rec))),
          ),
        ),
        power < rec ? h('p.rv-note.rv-note--warn', rt('campaign.weak')) : null,
      ),
    );
    out.push(
      h(
        'div.rv-stage__btns',
        rvButton(ui, {
          label: rt('campaign.editSquad'),
          icon: 'squad',
          kind: 'glass',
          size: 'md',
          cls: 'rv-btn--center',
          onClick: () => {
            close();
            ui.showScreen('squad', { from: 'campaign', stageId: stage.id });
          },
        }),
        rvButton(ui, {
          label: unlocked ? rt('campaign.fight') : rt('campaign.locked'),
          icon: unlocked ? 'duel' : 'lock',
          kind: 'gold',
          size: 'md',
          cls: 'rv-btn--center rv-stage__fight',
          disabled: !unlocked,
          sound: 'gong',
          onClick: () => {
            close();
            startStage(ui, stage);
          },
        }),
      ),
    );
    return h('div.rv-stage', ...out);
  };
  const title = `${stage.id} · ${L(stage.name)}`;
  return ui.openSheet(build, { title, kanji: stage.boss ? '王' : '陣', cls: `rv-sheet--stage ${stage.boss ? 'is-boss' : ''}` });
}

export function createCampaign(ui, params = {}) {
  let chapter = params.chapter || currentChapter(ui.profile, ui.meta);
  const tabs = h('div.rv-camp__tabs');
  const map = h('div.rv-camp__map');
  const info = h('div.rv-camp__info');
  const starsEl = h('span.rv-camp__total');
  const scroller = h('div.rv-body.rv-scroll.rv-camp__body', tabs, info, map, h('div.rv-body__pad'));

  function render() {
    const profile = ui.profile;
    starsEl.textContent = '';
    starsEl.append(rvIcon('star', 'rv-camp__totalico'), `${campaignStars(profile)}/${STAGE_LIST.length * 3}`);

    tabs.textContent = '';
    for (const ch of CAMPAIGN) {
      const s = chapterSummary(profile, ch.chapter, ui.meta);
      tabs.appendChild(
        h(
          'button.rv-camp__tab',
          {
            type: 'button',
            class: `${ch.chapter === chapter ? 'is-active' : ''} ${s.unlocked ? '' : 'is-locked'}`,
            on: {
              click: ui.tap(() => {
                if (!s.unlocked) {
                  ui.toast(rt('campaign.chapterLocked', { n: ch.chapter - 1 }));
                  return;
                }
                chapter = ch.chapter;
                render();
                scroller.scrollTop = 0;
              }),
            },
          },
          h('span.rv-camp__tabnum', ['I', 'II', 'III'][ch.chapter - 1] || String(ch.chapter)),
          h('span.rv-camp__tabname', { 'data-fit': '9' }, L(ch.name)),
          s.unlocked ? h('span.rv-camp__tabstars', rvIcon('star'), `${s.stars}/${s.maxStars}`) : rvIcon('lock', 'rv-camp__tablock'),
        ),
      );
    }

    const ch = CAMPAIGN.find((c) => c.chapter === chapter) || CAMPAIGN[0];
    info.textContent = '';
    info.append(
      h(
        'div.rv-camp__head',
        h('div.rv-camp__chap', rt('campaign.chapter', { n: ch.chapter })),
        h('h2.rv-camp__name', { 'data-fit': '16' }, L(ch.name)),
        ch.gimmick ? h('button.rv-camp__gimmick', { type: 'button', on: { click: ui.tap(() => ui.toast(L(ch.gimmick.desc))) } }, rvIcon('info'), L(ch.gimmick.name)) : null,
      ),
    );

    // map: background + path + nodes (bottom = stage 1)
    map.textContent = '';
    map.className = `rv-camp__map rv-camp__map--${ch.chapter}`;
    const bg = h('div.rv-camp__bg');
    const img = artImg(assetUrl(ui, 'bg', ch.bg), bg, { alt: '', cls: 'rv-art' });
    if (img) bg.appendChild(img);
    map.append(bg, h('div.rv-camp__veil'), starfield(ch.chapter * 7, 30));
    const nodes = chapterNodes(profile, ch.chapter, ui.meta);
    const n = nodes.length;
    // px layout from the bottom: regular nodes every STEP px, the boss gets extra room on top
    const STEP = 96;
    const BOTTOM = 64;
    const BOSS_GAP = 136;
    const TOP = 96;
    const yPx = nodes.map((nd, i) => BOTTOM + i * STEP + (nd.stage.boss ? BOSS_GAP - STEP : 0));
    const mapH = yPx[n - 1] + TOP;
    map.style.setProperty('--map-h', mapH + 'px');
    const yOf = (i) => 100 - (yPx[i] / mapH) * 100;
    const segs = [];
    for (let i = 0; i < n - 1; i++) {
      const lit = nodes[i].cleared;
      segs.push(`<line x1="${PATH_X[i]}" y1="${yOf(i)}" x2="${PATH_X[i + 1]}" y2="${yOf(i + 1)}" class="${lit ? 'is-lit' : ''}"/>`);
    }
    map.insertAdjacentHTML('beforeend', `<svg class="rv-camp__path" viewBox="0 0 100 100" preserveAspectRatio="none">${segs.join('')}</svg>`);
    nodes.forEach((nd, i) => {
      const st = nd.stage;
      const boss = !!st.boss;
      const btn = h(
        'button.rv-node',
        {
          type: 'button',
          class: `${boss ? 'rv-node--boss' : ''} ${nd.unlocked ? 'is-open' : 'is-locked'} ${nd.cleared ? 'is-cleared' : ''} ${nd.current ? 'is-current' : ''}`,
          style: { left: PATH_X[i] + '%', top: yOf(i) + '%' },
          'aria-label': `${st.id} ${L(st.name)}`,
          dataset: { stage: st.id },
          on: {
            click: ui.tap(() => {
              if (!nd.unlocked) {
                ui.toast(rt('campaign.locked'));
                return;
              }
              openStageSheet(ui, st.id);
            }),
          },
        },
        h('span.rv-node__tile', boss ? heroToken(ui, st.bossHero, { size: 62, grey: true, title: false }) : h('span.rv-node__num', st.id.split('-')[1])),
        nd.unlocked ? null : rvIcon('lock', 'rv-node__lock'),
        h('span.rv-node__stars', ...[1, 2, 3].map((k) => rvIcon('star', k <= nd.stars ? 'is-lit' : ''))),
        h('span.rv-node__label', { 'data-fit': '9' }, boss ? `${rt('common.boss')} · ${L(st.name)}` : L(st.name)),
      );
      map.appendChild(btn);
    });
    ui.refit(el);
  }

  const el = h(
    'div.rv-screen.rv-camp',
    rvHeader(ui, { title: rt('campaign.title'), kanji: KANJI.campaign, onBack: () => ui.showScreen('hub', {}, { dir: -1 }), right: starsEl }),
    scroller,
  );
  render();

  return {
    el,
    refresh: render,
    onShow() {
      if (params.stageId) setTimeout(() => openStageSheet(ui, params.stageId), 60);
      // bring the current node into view (scroll the body only, never the screen)
      requestAnimationFrame(() => {
        const cur = map.querySelector('.rv-node.is-current');
        if (!cur) return;
        const sr = scroller.getBoundingClientRect();
        const cr = cur.getBoundingClientRect();
        scroller.scrollTop += cr.top + cr.height / 2 - (sr.top + sr.height * 0.55);
      });
    },
    state() {
      return { chapter, stageId: null };
    },
  };
}
