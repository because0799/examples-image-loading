// «Дуэль» (GDD §16): hot-seat duel setup with a 1-2-2-2-2-2-1 draft from the owner's heroes
// (option: all 24), equalised levels (20, C0) or as owned, optional «Передай телефон» screen.
// «В бой!» -> 'start-battle' { mode: 'duel', squads: { 1, '-1' }, first: 'coin', passPhone }.

import { h, rvHeader, rvButton, rvSeg, rvSwitch, heroCard, heroToken, rvSection } from '../components.js';
import { rt } from '../i18n.js';
import { KANJI, SQUAD_SIZE, HEROES, ownedIds, isOwned, heroLevel, heroConstellation, draftTurn, getHero, RARITY_RANK } from '../model.js';

const EQUAL_LEVEL = 20;

export function createDuel(ui, params = {}) {
  const ownedCount = ownedIds(ui.profile).length;
  const st = {
    pool: params.pool || (ownedCount >= SQUAD_SIZE ? 'owned' : 'all'),
    levels: params.levels || 'equal',
    passPhone: params.passPhone != null ? !!params.passPhone : true,
    picks: Array.isArray(params.picks) ? params.picks.slice() : [], // [{ side, heroId }]
  };

  const turnEl = h('div.rv-duel__turn');
  const teamsEl = h('div.rv-duel__teams');
  const poolEl = h('div.rv-duel__pool');
  const startBtnHolder = h('div.rv-duel__start');
  const undoHolder = h('div.rv-duel__undo');

  const playerName = (side) => (side > 0 ? rt('common.player1') : rt('common.player2'));
  const sideIds = (side) => st.picks.filter((p) => p.side === side).map((p) => p.heroId);

  function poolIds() {
    const ids = st.pool === 'all' ? HEROES.map((x) => x.id) : ownedIds(ui.profile);
    return ids.sort((a, b) => RARITY_RANK[getHero(b).rarity] - RARITY_RANK[getHero(a).rarity] || HEROES.indexOf(getHero(a)) - HEROES.indexOf(getHero(b)));
  }

  function entry(heroId) {
    if (st.levels === 'equal' || !isOwned(ui.profile, heroId)) return { heroId, level: EQUAL_LEVEL, constellation: 0 };
    return { heroId, level: heroLevel(ui.profile, heroId), constellation: heroConstellation(ui.profile, heroId) };
  }

  function pick(heroId) {
    const turn = draftTurn(st.picks);
    if (!turn) return;
    if (sideIds(turn.side).includes(heroId)) return;
    st.picks.push({ side: turn.side, heroId });
    ui.sound('select');
    render();
  }

  function render() {
    const turn = draftTurn(st.picks);
    turnEl.textContent = '';
    turnEl.className = `rv-duel__turn ${turn ? (turn.side > 0 ? 'is-p1' : 'is-p2') : 'is-ready'}`;
    turnEl.append(
      h('span.rv-duel__turnkanji', { 'aria-hidden': 'true' }, turn ? (turn.side > 0 ? '壱' : '弐') : '決'),
      h('span.rv-duel__turntext', turn ? rt('duel.turn', { player: playerName(turn.side), picks: rt('duel.picks', { n: turn.left }) }) : rt('duel.ready')),
    );

    teamsEl.textContent = '';
    for (const side of [1, -1]) {
      const ids = sideIds(side);
      const slots = [];
      for (let i = 0; i < SQUAD_SIZE; i++) {
        const id = ids[i];
        slots.push(
          id
            ? h('span.rv-duel__slot.is-filled', heroToken(ui, id, { size: 40, side, grey: side < 0 && sideIds(1).includes(id) }))
            : h('span.rv-duel__slot', h('i')),
        );
      }
      teamsEl.appendChild(
        h(
          'div.rv-duel__team',
          { class: `${side > 0 ? 'is-p1' : 'is-p2'} ${turn && turn.side === side ? 'is-active' : ''}` },
          h('span.rv-duel__pname', playerName(side)),
          h('div.rv-duel__slots', ...slots),
        ),
      );
    }

    poolEl.textContent = '';
    const p1 = sideIds(1);
    const p2 = sideIds(-1);
    for (const id of poolIds()) {
      const mine = turn ? sideIds(turn.side).includes(id) : false;
      const other = turn ? sideIds(-turn.side).includes(id) : false;
      const tag = p1.includes(id) && p2.includes(id) ? '1 · 2' : p1.includes(id) ? rt('common.player1') : p2.includes(id) ? rt('common.player2') : null;
      const tagKind = p1.includes(id) && p2.includes(id) ? 'both' : p1.includes(id) ? 'p1' : 'p2';
      poolEl.appendChild(
        heroCard(ui, id, {
          owned: true,
          level: entry(id).level,
          constellation: entry(id).constellation,
          compact: true,
          selected: mine,
          tag,
          tagKind,
          cls: `${other ? 'is-taken' : ''} ${!turn || mine ? 'is-dim' : ''}`,
          onClick: (hid) => {
            if (!turn) return;
            if (sideIds(turn.side).includes(hid)) return;
            if (sideIds(-turn.side).includes(hid)) ui.toast(rt('duel.taken'));
            pick(hid);
          },
        }),
      );
    }

    startBtnHolder.textContent = '';
    startBtnHolder.appendChild(
      rvButton(ui, {
        label: rt('duel.start'),
        icon: 'duel',
        kind: 'gold',
        size: 'md',
        cls: 'rv-btn--center',
        disabled: !!turn,
        sound: 'gong',
        onClick: () => {
          if (draftTurn(st.picks)) return;
          ui.emit('start-battle', {
            mode: 'duel',
            squads: { 1: sideIds(1).map(entry), '-1': sideIds(-1).map(entry) },
            first: 'coin',
            passPhone: st.passPhone,
            levels: st.levels,
          });
        },
      }),
    );
    undoHolder.textContent = '';
    undoHolder.appendChild(
      rvButton(ui, {
        label: st.picks.length ? rt('duel.undo') : rt('duel.restart'),
        icon: 'undo',
        kind: 'ghost',
        size: 'md',
        cls: 'rv-btn--center',
        disabled: !st.picks.length,
        onClick: () => {
          st.picks.pop();
          render();
        },
      }),
    );
    ui.refit(el);
  }

  const resetDraft = () => {
    st.picks = [];
    render();
  };

  const options = h(
    'div.rv-panel.rv-duel__opts',
    h(
      'div.rv-row',
      h('div.rv-row__text', h('div.rv-row__label', rt('duel.pool'))),
      rvSeg(ui, {
        options: [
          { value: 'owned', label: rt('duel.poolOwned') },
          { value: 'all', label: rt('duel.poolAll') },
        ],
        value: st.pool,
        cls: 'rv-duel__seg',
        onChange: (v) => {
          if (v === 'owned' && ownedCount < SQUAD_SIZE) {
            ui.toast(rt('duel.notEnough'));
            seg.setValue('all');
            return;
          }
          st.pool = v;
          resetDraft();
        },
      }),
    ),
    h(
      'div.rv-row',
      h('div.rv-row__text', h('div.rv-row__label', rt('duel.levels'))),
      rvSeg(ui, {
        options: [
          { value: 'equal', label: rt('duel.levelsEqual') },
          { value: 'owned', label: rt('duel.levelsOwned') },
        ],
        value: st.levels,
        cls: 'rv-duel__seg',
        onChange: (v) => {
          st.levels = v;
          render();
        },
      }),
    ),
    h(
      'div.rv-row',
      h('div.rv-row__text', h('div.rv-row__label', rt('duel.passPhone')), h('div.rv-row__desc', rt('duel.coin'))),
      rvSwitch(ui, {
        checked: st.passPhone,
        label: rt('duel.passPhone'),
        onChange: (v) => {
          st.passPhone = v;
        },
      }),
    ),
  );
  const seg = options.querySelector('.rv-seg');

  const body = h(
    'div.rv-body.rv-scroll',
    h('p.rv-train__sub', rt('duel.sub')),
    options,
    rvSection(rt('duel.draft'), h('p.rv-duel__hint', rt('duel.draftHint')), turnEl, teamsEl),
    poolEl,
    h('div.rv-body__pad'),
  );
  const el = h(
    'div.rv-screen.rv-duel',
    rvHeader(ui, { title: rt('duel.title'), kanji: KANJI.duel, onBack: () => ui.showScreen('hub', {}, { dir: -1 }) }),
    body,
    h('div.rv-footer', undoHolder, startBtnHolder),
  );
  render();

  return {
    el,
    refresh: render,
    state() {
      return { pool: st.pool, levels: st.levels, passPhone: st.passPhone, picks: st.picks.slice() };
    },
  };
}
