// Battle results (GDD §17.10): «ПОБЕДА 勝利» / «ПОРАЖЕНИЕ 敗北» / «НИЧЬЯ», stars with their
// conditions, the MVP splash + victory line (Epic+), rewards, XP bars with level-ups.
// Buttons: «Дальше» (next stage) · «Повтор» · «Отряд» · «Штаб» -> params.onChoose(choice).

import { h, rvButton, heroSplash, heroToken, bar, rvSection, starfield } from '../components.js';
import { rvIcon } from '../icons.js';
import { rt, L, fmt } from '../i18n.js';
import {
  KANJI,
  getHero,
  stageById,
  threeStarRoundsOf,
  battleStars,
  pickMvp,
  normalizeLevelUps,
  heroEntry,
  heroLevel,
  xpGainPath,
  voiceLines,
  isVoiced,
  STAGE_LIST,
  profileSquad,
  ELEMENTS,
} from '../model.js';

function stageAdviceOf(ui, stageId) {
  try {
    return ui.meta && typeof ui.meta.stageAdvice === 'function' ? ui.meta.stageAdvice(ui.profile, stageId) : null;
  } catch (e) {
    return null;
  }
}

function squadPowerOf(ui) {
  try {
    return ui.meta && typeof ui.meta.squadPower === 'function' ? ui.meta.squadPower(ui.profile, profileSquad(ui.profile)) : 0;
  } catch (e) {
    return 0;
  }
}

export function createResults(ui, params = {}) {
  const result = params.result || {};
  const rewards = params.rewards || {};
  const mode = params.mode || (params.stageId ? 'campaign' : 'training');
  const playerSide = params.playerSide || 1;
  const stage = params.stageId ? stageById(params.stageId) : null;
  const squad = (Array.isArray(params.squad) && params.squad.length ? params.squad : profileSquad(ui.profile)).map((x) => (typeof x === 'string' ? x : x && x.heroId)).filter((id) => getHero(id));
  const duel = mode === 'duel';
  const outcome = result.winner === 0 || result.winner == null ? 'draw' : duel ? 'victory' : result.winner === playerSide ? 'victory' : 'defeat';
  const stars = duel ? 0 : battleStars({ result, rewards, stage, playerSide });
  // duel: the MVP comes from the winner's squad (params.squads = { 1: ids|entries, '-1': … })
  const winnerSquad = duel && params.squads && result.winner ? (params.squads[result.winner] || params.squads[String(result.winner)] || []).map((x) => (typeof x === 'string' ? x : x && x.heroId)).filter((id) => getHero(id)) : squad;
  const mvp = outcome === 'victory' ? params.mvp || ((!duel || winnerSquad.length) && pickMvp({ result, squad: winnerSquad, playerSide: duel ? result.winner : playerSide })) || null : null;
  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const choose = (c) => params.onChoose && params.onChoose(c);

  // ---------------------------------------------------------------- headline
  const title = duel
    ? rt('results.duelWin', { player: result.winner > 0 ? rt('common.player1') : rt('common.player2') })
    : rt(`results.${outcome}`);
  const kanji = outcome === 'victory' ? KANJI.victory : outcome === 'defeat' ? KANJI.defeat : KANJI.draw;
  const head = h(
    'div.rv-res__head',
    h('div.rv-res__rays', { 'aria-hidden': 'true' }),
    h('div.rv-res__kanji', { 'aria-hidden': 'true' }, kanji),
    h('h1.rv-res__title', { 'data-fit': '20' }, title),
    stage ? h('div.rv-res__stage', `${stage.id} · ${L(stage.name)}`) : null,
    result.rounds ? h('div.rv-res__rounds', rt('results.rounds', { n: result.rounds })) : null,
  );

  const parts = [head];

  // ---------------------------------------------------------------- stars
  if (!duel && mode === 'campaign') {
    const starEls = [1, 2, 3].map((n) => h('span.rv-res__star', { class: n <= stars ? 'is-lit' : '', style: { '--i': n } }, rvIcon('star')));
    const conds = [rt('campaign.star1'), rt('campaign.star2'), rt('campaign.star3', { n: threeStarRoundsOf(stage) })];
    parts.push(
      h(
        'div.rv-res__stars',
        h('div.rv-res__starrow', ...starEls),
        h('ul.rv-res__conds', ...conds.map((c, i) => h('li', { class: i < stars ? 'is-lit' : '' }, rvIcon(i < stars ? 'check' : 'close'), c))),
      ),
    );
  }

  // ---------------------------------------------------------------- MVP
  if (mvp) {
    const hero = getHero(mvp);
    const line = voiceLines(mvp).find((v) => v.event === 'victory');
    parts.push(
      h(
        'div.rv-res__mvp',
        heroSplash(ui, mvp, { cls: 'rv-res__splash' }),
        h('div.rv-res__mvpshade'),
        h('span.rv-res__mvptag', rt('results.mvp')),
        h(
          'div.rv-res__mvptext',
          h('b', L(hero.name)),
          line ? h('span.rv-res__line', `«${ui.lang === 'en' ? line.en : line.ru}»`) : h('span.rv-res__line', L(hero.title)),
          line ? h('span.rv-res__jp', line.jp) : null,
        ),
      ),
    );
  }

  // ---------------------------------------------------------------- rewards
  const rewardItems = [];
  if (rewards.crystals) rewardItems.push(h('div.rv-reward', rvIcon('crystal', 'rv-reward__cry'), h('b', `+${fmt(rewards.crystals)}`), h('span', rt('common.crystals'))));
  const scrolls = rewards.xpScrolls || rewards.scrolls;
  if (scrolls) rewardItems.push(h('div.rv-reward', rvIcon('scroll', 'rv-reward__scr'), h('b', `+${scrolls}`), h('span', rt('common.scrolls'))));
  if (rewards.dust) rewardItems.push(h('div.rv-reward', rvIcon('dust', 'rv-reward__dust'), h('b', `+${fmt(rewards.dust)}`), h('span', rt('common.dust'))));
  if (!duel) {
    parts.push(
      rvSection(
        rt('results.rewards'),
        rewards.firstClear ? h('div.rv-res__first', rvIcon('sparkle'), rt('results.firstClear')) : null,
        rewardItems.length ? h('div.rv-stage__rewards', ...rewardItems) : h('p.rv-note', rt('results.none')),
      ),
    );
  }

  // ---------------------------------------------------------------- XP
  const xpMap = rewards.xp && typeof rewards.xp === 'object' ? rewards.xp : {};
  const ups = normalizeLevelUps(rewards.levelUps);
  const bars = [];
  if (!duel && squad.length) {
    const rows = squad.map((id) => {
      const hero = getHero(id);
      const e = heroEntry(ui.profile, id) || {};
      const lvAfter = heroLevel(ui.profile, id);
      const gained = Number(xpMap[id]) || 0;
      const path = xpGainPath(lvAfter, e.xp || 0, gained);
      const up = ups.find((u) => u.heroId === id);
      if (up && up.from != null && up.to != null && up.to > up.from) {
        path.from.level = up.from;
        path.levelUps = up.to - up.from;
      } else if (Array.isArray(rewards.levelUps) && !up) {
        // the meta module lists every level-up: this hero stayed on her level
        const to = path.to;
        const fromXp = Math.max(0, (to.max ? 0 : to.xp) - gained);
        path.from = { ...to, xp: fromXp, pct: to.need ? Math.min(1, fromXp / to.need) : 1 };
        path.levelUps = 0;
      }
      const lvlEl = h('b.rv-xp__lvl', rt('common.level', { n: path.from.level }));
      const b = bar(path.from.pct, { kind: 'xp', cls: 'rv-xp__bar' });
      const flair = h('span.rv-xp__up', rt('results.levelUp'));
      const row = h(
        'div.rv-xp',
        h('span.rv-xp__tok', heroToken(ui, id, { size: 40 }), flair),
        h('div.rv-xp__main', h('div.rv-xp__top', h('span.rv-xp__name', { 'data-fit': '10' }, L(hero.name)), lvlEl, h('span.rv-xp__gain', gained ? `+${fmt(gained)} XP` : '')), b),
      );
      bars.push({ row, bar: b, lvlEl, flair, path });
      return row;
    });
    parts.push(rvSection(rt('results.xp'), h('div.rv-res__xps.rv-panel', ...rows)));
  }

  if (outcome === 'defeat') parts.push(h('p.rv-note', rt('results.defeatText'), h('br'), rt('results.tip')));
  // GDD §14.4 «помощь при поражении»: after 2 losses in a row on a stage — what to change, and a
  // training button at the stage's level
  const advice = outcome === 'defeat' && mode === 'campaign' && stage ? stageAdviceOf(ui, stage.id) : null;
  if (advice && advice.show) {
    const lines = [];
    const power = squadPowerOf(ui);
    if (power && advice.recommendedPower && power < advice.recommendedPower) lines.push(rt('results.advice.power', { power: fmt(power), rec: fmt(advice.recommendedPower) }));
    if (advice.counterElements && advice.counterElements.length) lines.push(rt('results.advice.counter', { list: advice.counterElements.map((e) => L(ELEMENTS[e].name)).join(', ') }));
    if (advice.avoidElements && advice.avoidElements.length) lines.push(rt('results.advice.avoid', { list: advice.avoidElements.map((e) => L(ELEMENTS[e].name)).join(', ') }));
    lines.push(rt('results.advice.levels'));
    parts.push(
      h(
        'div.rv-res__advice.rv-panel',
        h('b.rv-res__advicetitle', rt('results.advice.title')),
        h('ul', ...lines.map((t) => h('li', t))),
        rvButton(ui, {
          label: rt('results.advice.training', { n: advice.trainingLevel }),
          icon: 'training',
          kind: 'glass',
          size: 'md',
          cls: 'rv-btn--center',
          onClick: () => ui.showScreen('training', { level: advice.trainingLevel }),
        }),
      ),
    );
  }
  if (outcome === 'draw' && !duel) parts.push(h('p.rv-note', rt('results.drawText')));
  parts.push(h('div.rv-body__pad'));

  // ---------------------------------------------------------------- buttons
  const nextIdx = stage ? STAGE_LIST.findIndex((s) => s.id === stage.id) + 1 : -1;
  const hasNext = outcome === 'victory' && mode === 'campaign' && nextIdx > 0 && nextIdx < STAGE_LIST.length;
  const footer = h(
    'div.rv-footer.rv-res__footer',
    hasNext ? rvButton(ui, { label: rt('results.next'), icon: 'chevron', kind: 'gold', size: 'md', cls: 'rv-btn--center rv-res__next', onClick: () => choose('next') }) : null,
    rvButton(ui, { label: rt('results.again'), icon: 'restart', kind: hasNext ? 'glass' : 'gold', size: 'md', cls: 'rv-btn--center', onClick: () => choose('again') }),
  );
  const footer2 = h(
    'div.rv-res__links',
    duel ? null : rvButton(ui, { label: rt('results.squad'), icon: 'squad', kind: 'ghost', size: 'sm', cls: 'rv-btn--center', onClick: () => choose('squad') }),
    rvButton(ui, { label: rt('results.hub'), icon: 'home', kind: 'ghost', size: 'sm', cls: 'rv-btn--center', onClick: () => choose('hub') }),
  );

  const el = h(
    'div.rv-screen.rv-res',
    { class: `rv-res--${outcome} ${duel ? 'rv-res--duel' : ''}` },
    starfield(31, 40),
    h('div.rv-body.rv-scroll.rv-res__body', ...parts),
    h('div.rv-res__bottom', footer, footer2),
  );

  function animateBars() {
    bars.forEach((b, i) => {
      const { path } = b;
      let level = path.from.level;
      let t = 500 + i * 160;
      const fill = b.bar.querySelector('.rv-bar__fill');
      for (let k = 0; k < path.levelUps; k++) {
        later(() => b.bar.style.setProperty('--p', '1'), t);
        t += 620;
        later(() => {
          level++;
          fill.style.transition = 'none';
          b.bar.style.setProperty('--p', '0');
          void fill.offsetWidth;
          fill.style.transition = '';
          b.lvlEl.textContent = rt('common.level', { n: level });
          b.row.classList.remove('is-up');
          void b.row.offsetWidth;
          b.row.classList.add('is-up');
          ui.sound('promote', { intensity: 0.6 });
        }, t);
        t += 60;
      }
      later(() => b.bar.style.setProperty('--p', String(path.to.pct)), t);
    });
  }

  return {
    el,
    onShow() {
      if (outcome === 'victory') {
        ui.sound('win');
        ui.haptic([20, 40, 60]);
        if (stars) later(() => ui.sound('sparkle'), 700);
        if (mvp && isVoiced(mvp)) later(() => ui.visible && ui.currentScreen === 'results' && ui.voice(mvp, 'victory'), 900);
      } else if (outcome === 'defeat') ui.sound('lose');
      else ui.sound('draw');
      animateBars();
    },
    destroy() {
      timers.forEach(clearTimeout);
    },
    back() {
      choose('hub');
      return true;
    },
  };
}
