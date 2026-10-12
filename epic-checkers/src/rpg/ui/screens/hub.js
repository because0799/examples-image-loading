// «Штаб Стратега» — the RPG hub (GDD §17.2): key art banner, currencies, the mode's main buttons
// and a squad heroine greeting the player (Epic+ — with her voice, once per session).

import { h, rvButton, rvIconButton, currencyPill, heroToken, heroSplash, assetUrl, artImg, starfield } from '../components.js';
import { rvIcon } from '../icons.js';
import { rt, L, fmt } from '../i18n.js';
import {
  KANJI,
  CAMPAIGN,
  chapterSummary,
  currentChapter,
  nextStage,
  campaignStars,
  STAGE_LIST,
  collectionCount,
  profileSquad,
  squadPower,
  crystalsOf,
  pityInfo,
  canSummonCount,
  ownedIds,
  isVoiced,
  voiceLines,
  getHero,
  RARITY_RANK,
} from '../model.js';

function pickGreeter(profile) {
  const squad = profileSquad(profile).filter(isVoiced);
  const pool = squad.length ? squad : ownedIds(profile).filter(isVoiced);
  if (!pool.length) return null;
  // the rarest voiced heroine of the squad, rotating daily among equals
  const best = Math.max(...pool.map((id) => RARITY_RANK[getHero(id).rarity]));
  const top = pool.filter((id) => RARITY_RANK[getHero(id).rarity] === best);
  const day = Math.floor(Date.now() / 86400000);
  return top[day % top.length];
}

export function createHub(ui, params = {}) {
  const profile = ui.profile || {};
  const meta = ui.meta;

  // ---------------------------------------------------------------- top bar
  const top = h(
    'header.rv-hub__top',
    rvIconButton(ui, { name: 'back', label: rt('hub.exit'), onClick: () => ui.exit(), cls: 'rv-hub__exit' }),
    h('div.rv-hub__curs', currencyPill('crystals', crystalsOf(profile)), profile.dust ? currencyPill('dust', profile.dust) : null, profile.xpScrolls || profile.scrolls ? currencyPill('scrolls', profile.xpScrolls || profile.scrolls) : null),
    rvIconButton(ui, { name: 'settings', label: rt('hub.settings'), onClick: () => ui.openSettings() }),
  );

  // ---------------------------------------------------------------- key art banner
  const greeterId = pickGreeter(profile);
  const banner = h('div.rv-hub__banner');
  const keyart = assetUrl(ui, 'keyart');
  const art = h('div.rv-hub__art');
  if (keyart) {
    const img = artImg(keyart, art, { alt: '', cls: 'rv-hub__keyart', lazy: false });
    if (img) art.appendChild(img);
  } else art.classList.add('is-missing');
  // fallback composition (shown when the key art is missing or fails): the greeting heroine's
  // splash over a celestial gradient
  const fallback = h('div.rv-hub__fallback', starfield(11, 46), greeterId ? heroSplash(ui, greeterId, { cls: 'rv-hub__fsplash' }) : null);
  banner.append(fallback, art, h('div.rv-hub__bannershade'));
  banner.append(
    h(
      'div.rv-hub__logo',
      h('div.rv-hub__jp', rt('mode.jp')),
      h('div.rv-hub__name', { 'data-fit': '20' }, rt('mode.name')),
      h('div.rv-hub__tag', rt('mode.tagline')),
    ),
  );

  // greeting bubble
  let greet = null;
  if (greeterId) {
    const line = voiceLines(greeterId).find((v) => v.event === 'summon');
    const hero = getHero(greeterId);
    greet = h(
      'button.rv-greet',
      {
        type: 'button',
        'aria-label': L(hero.name),
        on: { click: ui.tap(() => ui.voice(greeterId, 'summon', { force: true }), { sound: null }) },
      },
      heroToken(ui, greeterId, { size: 54 }),
      h(
        'span.rv-greet__bubble',
        h('span.rv-greet__name', L(hero.name)),
        h('span.rv-greet__text', line ? (ui.lang === 'en' ? line.en : line.ru) : rt('hub.greeting')),
        line ? h('span.rv-greet__jp', line.jp) : null,
      ),
      rvIcon('sound', 'rv-greet__snd'),
    );
  }

  // ---------------------------------------------------------------- main buttons
  const chNum = currentChapter(profile, meta);
  const ch = CAMPAIGN.find((c) => c.chapter === chNum) || CAMPAIGN[0];
  const sum = chapterSummary(profile, ch.chapter, meta);
  const ns = nextStage(profile, meta);
  const allDone = !ns;
  const campBg = h('span.rv-tile__bg');
  const campImg = artImg(assetUrl(ui, 'bg', ch.bg), campBg, { alt: '', cls: 'rv-tile__img', lazy: false });
  if (campImg) campBg.appendChild(campImg);
  const campaign = h(
    'button.rv-tile.rv-tile--campaign',
    { type: 'button', on: { click: ui.tap(() => ui.showScreen('campaign', { chapter: ch.chapter })) } },
    campBg,
    h('span.rv-tile__shade'),
    h('span.rv-tile__kanji', { 'aria-hidden': 'true' }, KANJI.campaign),
    rvIcon('campaign', 'rv-tile__ico'),
    h(
      'span.rv-tile__text',
      h('span.rv-tile__label', rt('hub.campaign')),
      h('span.rv-tile__sub', allDone ? rt('hub.campaignDone') : `${L(ch.name)} · ${rt('hub.campaignSub', { ch: ch.chapter, done: sum.cleared, total: sum.total })}`),
      h(
        'span.rv-tile__chips',
        h('span.rv-tile__chip', rvIcon('star', 'rv-tile__star'), `${campaignStars(profile)}/${STAGE_LIST.length * 3}`),
        ns ? h('span.rv-tile__chip.rv-tile__chip--next', rt('hub.next', { stage: ns.id })) : null,
      ),
    ),
    rvIcon('chevron', 'rv-tile__go'),
  );

  const pity = pityInfo(profile, meta);
  const canTen = canSummonCount(profile, 10, meta);
  const summon = h(
    'button.rv-tile.rv-tile--summon',
    { type: 'button', on: { click: ui.tap(() => ui.showScreen('summon')) } },
    h('span.rv-tile__glow'),
    starfield(5, 18, 'rv-tile__stars'),
    h('span.rv-tile__kanji', { 'aria-hidden': 'true' }, KANJI.summon),
    h('span.rv-tile__mythics', heroToken(ui, 'nocturna', { size: 46, title: false }), heroToken(ui, 'liora', { size: 54, title: false })),
    h(
      'span.rv-tile__text',
      h('span.rv-tile__label', rt('hub.summon')),
      h('span.rv-tile__sub', pity.novicePullsLeft > 0 ? rt('hub.summonNovice') : rt('hub.summonSub')),
      h('span.rv-tile__chips', h('span.rv-tile__chip', rvIcon('crystal', 'rv-tile__cry'), fmt(crystalsOf(profile))), canTen ? h('span.rv-tile__chip.rv-tile__chip--hot', '×10') : null),
    ),
  );

  const cc = collectionCount(profile);
  const squad = profileSquad(profile);
  const small = (icon, label, sub, kanji, onClick, cls = '') =>
    h(
      'button.rv-tile.rv-tile--small',
      { type: 'button', class: cls, on: { click: ui.tap(onClick) } },
      h('span.rv-tile__kanji', { 'aria-hidden': 'true' }, kanji),
      rvIcon(icon, 'rv-tile__ico'),
      h('span.rv-tile__text', h('span.rv-tile__label', { 'data-fit': '12' }, label), h('span.rv-tile__sub', sub)),
    );
  const grid = h(
    'div.rv-hub__grid',
    small('collection', rt('hub.collection'), `${cc.owned}/${cc.total}`, KANJI.collection, () => ui.showScreen('collection')),
    small('squad', rt('hub.squad'), `${rt('common.power')} ${fmt(squadPower(profile, squad, meta))}`, KANJI.squad, () => ui.showScreen('squad', { from: 'hub' })),
    small('training', rt('hub.training'), rt('hub.trainingSub'), KANJI.training, () => ui.showScreen('training')),
    small('duel', rt('hub.duel'), rt('hub.duelSub'), KANJI.duel, () => ui.showScreen('duel')),
  );

  const body = h(
    'div.rv-body.rv-scroll.rv-hub__body',
    banner,
    greet,
    h('div.rv-hub__main', campaign, summon, grid, rvButton(ui, { label: rt('hub.exit'), icon: 'exit', kind: 'ghost', size: 'sm', cls: 'rv-hub__back', onClick: () => ui.exit() })),
    h('div.rv-body__pad'),
  );

  const el = h('div.rv-screen.rv-hub', starfield(23, 50), top, body);

  return {
    el,
    onShow() {
      if (greeterId && !ui._greeted && ui.settings.rpgVoice !== false) {
        ui._greeted = true;
        setTimeout(() => {
          if (ui.currentScreen === 'hub' && ui.visible) ui.voice(greeterId, 'summon');
        }, 650);
      }
    },
    back() {
      ui.exit();
      return true;
    },
  };
}
