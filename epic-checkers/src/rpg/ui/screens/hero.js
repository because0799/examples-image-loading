// Hero card screen (GDD §17.4): big splash, name RU/JP, title, rarity stars, element / role,
// level & XP, stats (now / next level), abilities with constellation numbers, the C1–C6
// constellation, voice lines (Epic+). Footer: add to / remove from the squad (or go summon).

import { h, rvIconButton, rvButton, heroSplash, rarityStars, elementBadge, roleBadge, bar, rvSeg, rvSection, constellationDots, heroVars } from '../components.js';
import { rvIcon } from '../icons.js';
import { rt, L, LL, fmt } from '../i18n.js';
import {
  getHero,
  isOwned,
  heroEntry,
  heroLevel,
  heroConstellation,
  heroStats,
  heroPower,
  abilityNumbers,
  xpProgress,
  levelCap,
  scrollsOwned,
  scrollsUseful,
  voiceLines,
  isVoiced,
  profileSquad,
  SQUAD_SIZE,
  ROLES,
} from '../model.js';
import { PROGRESSION } from '../../data/rules.js';
import { VOICE_EVENT_NAMES } from '../../data/voice-lines.js';

// constellation star layouts (6 points in a 100×60 box), picked per role for variety
const PATTERNS = {
  guardian: [[12, 40], [28, 18], [48, 30], [62, 12], [78, 34], [92, 20]],
  blade: [[10, 48], [26, 34], [42, 40], [56, 22], [74, 26], [90, 8]],
  ranger: [[12, 18], [30, 30], [46, 16], [60, 38], [78, 22], [92, 44]],
  mystic: [[16, 30], [32, 12], [50, 26], [50, 48], [70, 34], [88, 16]],
  oracle: [[12, 36], [28, 20], [46, 12], [64, 18], [80, 32], [90, 50]],
  shadow: [[10, 14], [28, 26], [40, 46], [58, 36], [74, 48], [92, 30]],
};

export function createHero(ui, params = {}) {
  const heroId = params.heroId;
  const hero = getHero(heroId);
  if (!hero) {
    return { el: h('div.rv-screen'), onShow: () => ui.showScreen('collection', {}, { instant: true }) };
  }
  let tab = params.tab || 'overview';
  const from = params.from || 'collection';
  const goBack = () => {
    if (from === 'summon' || from === 'squad' || from === 'hub' || from === 'campaign') ui.showScreen(from, from === 'squad' ? { from: 'hub' } : {}, { dir: -1 });
    else ui.showScreen('collection', {}, { dir: -1 });
  };

  const content = h('div.rv-hero__content');
  const tabsEl = h('div.rv-hero__tabs');
  const footer = h('div.rv-footer.rv-hero__footer');
  const scroller = h('div.rv-body.rv-scroll.rv-hero__body');

  function render() {
    const profile = ui.profile;
    const owned = isOwned(profile, heroId);
    const level = owned ? heroLevel(profile, heroId) : 1;
    const c = owned ? heroConstellation(profile, heroId) : 0;
    const voiced = isVoiced(heroId);
    scroller.textContent = '';

    // ---------------------------------------------------------------- splash + names
    const splash = heroSplash(ui, heroId, { cls: 'rv-hero__splash', grey: !owned });
    const kanjiDeco = h('span.rv-hero__deco', { 'aria-hidden': 'true' }, hero.name.jp);
    const names = h(
      'div.rv-hero__names',
      h('div.rv-hero__jp', hero.name.jp),
      h('h1.rv-hero__name', { 'data-fit': '20' }, L(hero.name)),
      h('div.rv-hero__title', L(hero.title)),
      h(
        'div.rv-hero__badges',
        rarityStars(hero.rarity, { cls: 'rv-hero__stars' }),
        h('span.rv-hero__rar', rt(`rarity.${hero.rarity}`)),
        elementBadge(hero.element, { label: true }),
        roleBadge(hero.role, { label: true }),
      ),
    );
    const top = h('div.rv-hero__top', splash, kanjiDeco, h('div.rv-hero__shade'), names);
    scroller.appendChild(top);

    if (!owned) {
      scroller.appendChild(
        h('div.rv-hero__locked.rv-panel', rvIcon('lock', 'rv-hero__lock'), h('div', h('b', rt('hero.lockedTitle')), h('p', rt('hero.lockedText')))),
      );
    }

    // ---------------------------------------------------------------- tabs
    const tabs = [
      { value: 'overview', label: rt('hero.tabs.overview') },
      { value: 'skills', label: rt('hero.tabs.skills') },
      { value: 'constellation', label: rt('hero.tabs.constellation') },
    ];
    if (voiced) tabs.push({ value: 'voice', label: rt('hero.tabs.voice') });
    if (!tabs.some((t) => t.value === tab)) tab = 'overview';
    tabsEl.textContent = '';
    tabsEl.appendChild(
      rvSeg(ui, {
        options: tabs,
        value: tab,
        cls: 'rv-hero__seg',
        onChange: (v) => {
          tab = v;
          renderTab();
        },
      }),
    );
    scroller.appendChild(tabsEl);
    scroller.appendChild(content);
    scroller.appendChild(h('div.rv-body__pad'));

    function renderTab() {
      content.textContent = '';
      content.className = `rv-hero__content rv-hero__content--${tab}`;
      if (tab === 'overview') content.append(...overview(owned, level, c));
      else if (tab === 'skills') content.append(...skills(c));
      else if (tab === 'constellation') content.append(...constellation(owned, c));
      else if (tab === 'voice') content.append(...voice());
      ui.refit(content);
    }
    renderTab();

    // ---------------------------------------------------------------- footer
    footer.textContent = '';
    if (owned) {
      const squad = profileSquad(profile);
      const inSquad = squad.includes(heroId);
      footer.appendChild(
        rvButton(ui, {
          label: inSquad ? rt('hero.fromSquad') : rt('hero.toSquad'),
          icon: 'squad',
          kind: inSquad ? 'glass' : 'gold',
          size: 'md',
          cls: 'rv-btn--center',
          onClick: () => {
            if (inSquad) {
              const next = squad.filter((x) => x !== heroId);
              if (!next.length) {
                ui.toast(rt('squad.needOne'));
                return;
              }
              ui.emit('set-squad', next);
              ui.toast(rt(hero.gender === 'm' ? 'hero.removedM' : 'hero.removed', { name: L(hero.name) }));
            } else {
              if (squad.length >= SQUAD_SIZE) {
                ui.toast(rt('hero.squadFull'));
                return;
              }
              ui.emit('set-squad', [...squad, heroId]);
              ui.toast(rt('hero.added', { name: L(hero.name) }));
            }
          },
        }),
      );
    } else {
      footer.appendChild(rvButton(ui, { label: rt('hero.toSummon'), icon: 'summon', kind: 'crystal', size: 'md', cls: 'rv-btn--center', onClick: () => ui.showScreen('summon') }));
    }
    ui.refit(el);
  }

  // ---------------------------------------------------------------- tab: overview
  function overview(owned, level, c) {
    const profile = ui.profile;
    const out = [];
    const cap = levelCap(profile, ui.meta);
    const entry = heroEntry(profile, heroId) || {};
    const xp = xpProgress(level, entry.xp || 0);
    const now = heroStats(hero, level, c);
    const nextLv = Math.min(PROGRESSION.maxLevel, level + 1);
    const next = heroStats(hero, nextLv, c);
    if (owned) {
      out.push(
        h(
          'div.rv-hero__lvl.rv-panel',
          h('div.rv-hero__lvlnum', h('small', rt('common.levelShort')), h('b', String(level)), h('span', `/${cap}`)),
          h(
            'div.rv-hero__xp',
            h('div.rv-hero__xprow', h('span', xp.max ? rt('hero.xpMax') : rt('hero.xp', { xp: fmt(xp.xp), need: fmt(xp.need) })), h('span.rv-hero__pow', rvIcon('sword'), fmt(heroPower(profile, heroId, ui.meta)))),
            bar(xp.pct, { kind: 'xp' }),
            h('div.rv-hero__cap', rt('hero.cap', { cap }), ' · ', rt('hero.copies', { n: Math.max(1, Number(entry.copies) || 1) }), ' · ', constellationDots(c)),
          ),
        ),
      );
      // «Повысить уровень» with XP scrolls (GDD §17.4) -> 'use-scroll' { heroId, count }
      const owned = scrollsOwned(profile);
      const useful = scrollsUseful(profile, heroId, ui.meta);
      out.push(
        rvButton(ui, {
          label: rt('hero.useScroll'),
          sub: owned ? (useful ? rt('hero.useScrollSub', { n: owned }) : rt('hero.scrollCap')) : rt('hero.noScrolls'),
          icon: 'scroll',
          kind: 'glass',
          size: 'sm',
          cls: 'rv-hero__scroll',
          disabled: !owned || !useful,
          sound: 'promote',
          onClick: () => ui.emit('use-scroll', { heroId, count: 1 }),
        }),
      );
    }
    const statRow = (key, a, b, fmtFn = fmt) =>
      h(
        'div.rv-stat',
        h('span.rv-stat__name', rt(`stat.${key}`)),
        h('span.rv-stat__short', rt(`statShort.${key}`)),
        h('b.rv-stat__val', fmtFn(a)),
        b != null && b !== a ? h('span.rv-stat__next', `+${fmtFn(b - a)}`) : h('span.rv-stat__next'),
      );
    out.push(
      rvSection(
        rt('hero.stats') + (owned && level < PROGRESSION.maxLevel ? ` · ${rt('hero.nextLevel', { n: nextLv })}` : ''),
        h(
          'div.rv-stats.rv-panel',
          statRow('hp', now.hp, owned ? next.hp : null),
          statRow('atk', now.atk, owned ? next.atk : null),
          statRow('def', now.def, owned ? next.def : null),
          statRow('crit', now.crit, null, (v) => `${v}%`),
          statRow('aff', now.aff, null),
        ),
      ),
    );
    out.push(
      rvSection(
        rt('hero.personality'),
        h('div.rv-hero__traits', ...LL(hero.personality).map((p) => h('span.rv-trait', p))),
      ),
    );
    out.push(rvSection(rt('hero.lore'), h('p.rv-hero__lore', L(hero.lore))));
    return out;
  }

  // ---------------------------------------------------------------- tab: skills
  function skills(c) {
    const nums = abilityNumbers(hero, c);
    const role = ROLES[hero.role];
    const out = [];
    const block = (kind, icon, title, name, desc, extra = [], cls = '') =>
      h(
        'div.rv-ab.rv-panel',
        { class: `rv-ab--${kind} ${cls}` },
        h('div.rv-ab__head', rvIcon(icon, 'rv-ab__ico'), h('div.rv-ab__titles', h('span.rv-ab__kind', title), name ? h('b.rv-ab__name', name) : null), h('div.rv-ab__chips', ...extra)),
        h('p.rv-ab__desc', desc),
      );
    const pctBonus = (m) => (m > 1.001 ? h('span.rv-ab__chip.rv-ab__chip--c', rt('hero.bonus', { n: Math.round((m - 1) * 100) })) : null);
    // movement + basic + jump (role data)
    const mv = hero.move || role.move;
    const mvText =
      mv.type === 'step'
        ? rt('hero.moveDesc.step', { n: mv.steps })
        : mv.type === 'glide'
        ? rt('hero.moveDesc.glide', { n: mv.length })
        : rt('hero.moveDesc.blink', { n: mv.range });
    const basic = hero.basic || role.basic;
    const jump = hero.jump || role.jump;
    out.push(
      block(
        'basic',
        'attack',
        `${rt('hero.basic')} · ${L(role.name)}`,
        null,
        `${rt('hero.move')}: ${mvText}. ${rt(`hero.basicDesc.${basic.los}`, { r: basic.range, pct: Math.round(basic.mult * 100) })}. ${rt('hero.jump')}: ${rt('hero.jumpDesc', {
          mult: jump.mult.toFixed(1),
          chain: jump.chainMax,
        })}.`,
        [],
      ),
    );
    out.push(h('p.rv-ab__trait', h('b', `${L(role.trait.name)}: `), L(role.trait.desc)));
    out.push(
      block('skill', 'skill', rt('hero.skill'), L(hero.skill.name), L(hero.skill.desc), [
        h('span.rv-ab__chip', rvIcon('cooldown'), rt('hero.cooldown', { n: nums.skillCooldown })),
        pctBonus(nums.skillMult),
      ]),
    );
    out.push(block('passive', 'sparkle', rt('hero.passive'), L(hero.passive.name), L(hero.passive.desc)));
    out.push(
      block(
        'ult',
        'ult',
        rt('hero.ult'),
        L(hero.ultimate.name),
        L(hero.ultimate.desc),
        [h('span.rv-ab__chip.rv-ab__chip--energy', rvIcon('energy'), rt('hero.cost', { n: nums.ultCost })), pctBonus(nums.ultMult)],
        '',
      ),
    );
    if (hero.ultimate.name.jp) out[out.length - 1].appendChild(h('div.rv-ab__jp', { 'aria-hidden': 'true' }, hero.ultimate.name.jp));
    for (const q of hero.quirks || []) out.push(block('quirk', 'quirk', rt('hero.quirk'), L(q.name), L(q.desc)));
    return out;
  }

  // ---------------------------------------------------------------- tab: constellation
  function constellation(owned, c) {
    const pts = PATTERNS[hero.role] || PATTERNS.blade;
    const lines = pts
      .slice(1)
      .map((p, i) => `<line x1="${pts[i][0]}" y1="${pts[i][1]}" x2="${p[0]}" y2="${p[1]}" class="${i + 2 <= c ? 'is-lit' : ''}"/>`)
      .join('');
    const sky = h('div.rv-const__sky', { style: heroVars(hero) }, h('span.rv-const__name', { 'aria-hidden': 'true' }, hero.name.jp));
    sky.insertAdjacentHTML('afterbegin', `<svg class="rv-const__lines" viewBox="0 0 100 60" preserveAspectRatio="none">${lines}</svg>`);
    const list = h('div.rv-const__list');
    const items = [];
    const select = (i) => {
      items.forEach((it, j) => it.classList.toggle('is-focus', j === i));
      stars.forEach((s, j) => s.classList.toggle('is-focus', j === i));
      if (items[i]) items[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    const stars = pts.map(([x, y], i) => {
      const lit = owned && i + 1 <= c;
      const b = h(
        'button.rv-const__star',
        {
          type: 'button',
          class: lit ? 'is-lit' : '',
          // same box as the SVG lines (inset 12% 8%)
          style: { left: `${(8 + x * 0.84).toFixed(2)}%`, top: `${(12 + (y / 60) * 76).toFixed(2)}%` },
          'aria-label': `C${i + 1}`,
          on: { click: ui.tap(() => select(i), { sound: 'sparkle' }) },
        },
        rvIcon('star'),
        h('span.rv-const__c', `C${i + 1}`),
      );
      sky.appendChild(b);
      return b;
    });
    for (const cc of hero.constellations || []) {
      const lit = owned && cc.c <= c;
      const it = h(
        'div.rv-const__item',
        { class: lit ? 'is-lit' : '' },
        h('span.rv-const__badge', `C${cc.c}`),
        h('p', L(cc.desc)),
        h('span.rv-const__state', lit ? rt('hero.starLit') : rt('hero.starUnlit')),
      );
      items.push(it);
      list.appendChild(it);
    }
    return [sky, h('p.rv-note', rt('hero.constellationHint')), list];
  }

  // ---------------------------------------------------------------- tab: voice
  function voice() {
    const lines = voiceLines(heroId);
    if (!lines.length) return [h('p.rv-note', rt('hero.voiceNone'))];
    const out = [];
    if (ui.settings.rpgVoice === false) {
      out.push(
        h(
          'button.rv-note.rv-note--warn.rv-hero__voiceoff',
          { type: 'button', on: { click: ui.tap(() => ui.openSettings()) } },
          rt('hero.voiceOff'),
        ),
      );
    }
    for (const v of lines) {
      const b = h(
        'button.rv-voice',
        {
          type: 'button',
          on: {
            click: ui.tap(
              () => {
                b.classList.remove('is-playing');
                void b.offsetWidth;
                b.classList.add('is-playing');
                ui.voice(heroId, v.event, { force: true }).finally(() => setTimeout(() => b.classList.remove('is-playing'), 300));
              },
              { sound: null },
            ),
          },
        },
        h('span.rv-voice__play', rvIcon('play')),
        h('span.rv-voice__text', h('span.rv-voice__ev', L(VOICE_EVENT_NAMES[v.event])), h('span.rv-voice__jp', v.jp), h('span.rv-voice__sub', ui.lang === 'en' ? v.en : v.ru)),
      );
      out.push(b);
    }
    return out;
  }

  const back = rvIconButton(ui, { name: 'back', label: rt('common.back'), onClick: goBack, cls: 'rv-hero__back' });
  const el = h('div.rv-screen.rv-hero', { style: heroVars(hero), class: `rv-hero--${hero.rarity}` }, scroller, back, footer);
  render();

  return {
    el,
    refresh() {
      const top = scroller.scrollTop;
      render();
      scroller.scrollTop = top;
    },
    state() {
      return { tab };
    },
    back() {
      goBack();
      return true;
    },
  };
}
