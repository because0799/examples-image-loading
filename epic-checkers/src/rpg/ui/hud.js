// «Валькирии доски» — battle screen + HUD (GDD §17.9). The screen element is persistent; HUD
// methods work whether or not the battle screen is visible.
//
// Layout (portrait): top bar (pause · round & turn · speed · auto) / enemy roster + HP share /
//   board area (#board-slot = the largest square that fits; the log feed lives in the lane above it)
//   / selected unit card / action bar / own roster + HP share.
// Layout (landscape): side columns (enemy | board | own + actions).
//
// ui.hud API:
//   setup(state, { mode, playerSide = 1, bottomSide = playerSide, stageId?, roundLimit?, names?, speed?, auto?, canAuto? })
//   update(state)                       round / turn / HP / energy / statuses (keyed DOM, no rebuild)
//   select(unitId | null, unitActions?, { moved?, mode? })   selected unit card + action availability
//   setMode(type | null)                highlight the active action (the controller's targeting mode)
//   log(events)                         battle log feed (last 3 lines, readable timing)
//   setBusy(bool)                       actions locked + «Пропустить» chip while a cinematic plays
//   setThinking(bool)  setSpeed(1|2)  setAuto(bool)  setCinematic(bool)  flip(bottomSide)
//   toast(text, opts)  clear()  lanes()  playerName(side)  state
// Emits on the RpgUI: 'battle-action' { type, unitId }, 'select-unit'(unitId), 'speed'(x), 'auto'(on),
//   'skip', 'board-rect'(DOMRect); the pause button opens ui.openPause().

import { h, heroToken, elementBadge, roleBadge, bar } from './components.js';
import { fitText } from '../../ui/dom.js';
import { rvIcon, STATUS_GLYPHS } from './icons.js';
import { rt, L, fmt } from './i18n.js';
import { getHero, unitsOf, unitById, isWard, hpShare, statusList, ultReady, roundLimitFrom, stageById, roundLimitOf, ELEMENTS } from './model.js';
import { describeEvents } from './battle-log.js';
import { readMs } from '../../ui/toasts.js';

const BOARD_PAD = 4;
const LOG_MAX = 3;
const CINEMATIC_FAILSAFE_MS = 8000;
const ACTIONS = ['move', 'attack', 'skill', 'ult', 'quirk', 'wait'];
const ACTION_ICONS = { move: 'move', attack: 'attack', skill: 'skill', ult: 'ult', quirk: 'quirk', wait: 'wait', end: 'end' };

export function createBattleScreen(ui) {
  const st = {
    mode: 'campaign',
    playerSide: 1,
    bottomSide: 1,
    side: 1,
    round: 1,
    roundLimit: 30,
    names: null,
    speed: 1,
    auto: false,
    canAuto: true,
    busy: false,
    thinking: false,
    selected: null,
    actions: null,
    moved: false,
    mode2: null, // active targeting mode
    state: null,
    cinematic: 0,
  };

  // ---------------------------------------------------------------- top bar
  const pauseBtn = h('button.rv-bt__pause', { type: 'button', 'aria-label': rt('battle.pause'), on: { click: ui.tap(() => ui.openPause()) } }, rvIcon('pause'));
  const roundEl = h('span.rv-bt__round');
  const turnEl = h('span.rv-bt__turn');
  const thinkEl = h('span.rv-bt__think', h('i'), h('i'), h('i'));
  const turnPill = h('div.rv-bt__pill', roundEl, turnEl, thinkEl);
  const speedBtn = h(
    'button.rv-bt__chip',
    {
      type: 'button',
      'aria-label': rt('battle.speed'),
      on: {
        click: ui.tap(() => {
          st.speed = st.speed >= 2 ? 1 : 2;
          paintChips();
          ui.emit('speed', st.speed);
        }),
      },
    },
    rvIcon('speed'),
    h('b'),
  );
  const autoBtn = h(
    'button.rv-bt__chip.rv-bt__auto',
    {
      type: 'button',
      on: {
        click: ui.tap(() => {
          st.auto = !st.auto;
          paintChips();
          ui.emit('auto', st.auto);
        }),
      },
    },
    rvIcon('auto'),
    h('b', rt('battle.auto')),
  );
  autoBtn.setAttribute('aria-label', rt('battle.auto'));
  const topBar = h('div.rv-bt__bar', pauseBtn, turnPill, h('div.rv-bt__chips', speedBtn, autoBtn));

  // ---------------------------------------------------------------- rosters
  const mkRoster = (pos) => {
    const r = {};
    r.list = h('div.rv-roster__list');
    r.shareFill = h('i');
    r.shareTxt = h('b');
    r.name = h('span.rv-roster__name');
    r.el = h('div.rv-roster', { class: `rv-roster--${pos}` }, h('div.rv-roster__head', r.name, h('span.rv-roster__share', h('span.rv-roster__sharebar', r.shareFill), r.shareTxt)), r.list);
    r.nodes = new Map();
    r.key = '';
    return r;
  };
  const topRoster = mkRoster('top');
  const botRoster = mkRoster('bottom');

  // ---------------------------------------------------------------- board area
  const slot = h('div', { id: 'board-slot' });
  const logEl = h('div.rv-log', { 'aria-live': 'polite' });
  const toastEl = h('div.rv-bt__toasts');
  const boardArea = h('div.rv-bt__board', slot, logEl, toastEl);

  // ---------------------------------------------------------------- unit card + actions
  const card = h('div.rv-ucard');
  const skipChip = h('button.rv-bt__skip', { type: 'button', tabindex: '-1', on: { click: ui.tap(() => ui.emit('skip'), { sound: null, haptic: 6 }) } }, h('span', rt('battle.skip')), rvIcon('speed'));
  const actBtns = {};
  const mkAct = (type) => {
    const label = h('span.rv-act__label', { 'data-fit': '9' });
    const sub = h('span.rv-act__sub');
    const badge = h('span.rv-act__badge');
    const b = h(
      'button.rv-act',
      {
        type: 'button',
        dataset: { act: type },
        on: {
          click: ui.tap(() => {
            if (b.disabled || st.busy) return;
            const t = b.dataset.type || type;
            if (st.mode2 === t && t !== 'wait' && t !== 'end') {
              ui.emit('battle-action', { type: 'cancel', unitId: st.selected });
              setMode(null);
              return;
            }
            const payload = { type: t, unitId: st.selected };
            if (t === 'quirk') {
              const q = quirkInfo(st.actions);
              if (q && q.id) payload.quirkId = q.id;
            }
            ui.emit('battle-action', payload);
            if (t !== 'wait' && t !== 'end') setMode(t);
          }, { sound: type === 'ult' ? 'power' : 'click' }),
        },
      },
      h('span.rv-act__bg'),
      h('span.rv-act__ico', rvIcon(ACTION_ICONS[type])),
      label,
      sub,
      badge,
    );
    b._label = label;
    b._sub = sub;
    b._badge = badge;
    b.dataset.type = type;
    actBtns[type] = b;
    return b;
  };
  const actions = h('div.rv-actions', ...ACTIONS.map(mkAct), skipChip);

  const battle = h('div.rv-bt', topBar, topRoster.el, boardArea, card, actions, botRoster.el);
  const el = h('div.rv-screen.rv-screen--battle', battle);

  // ---------------------------------------------------------------- helpers
  const rosterFor = (side) => (side === st.bottomSide ? botRoster : topRoster);

  function playerName(side) {
    if (st.names && st.names[side]) return st.names[side];
    if (st.mode === 'duel') return side > 0 ? rt('common.player1') : rt('common.player2');
    return side === st.playerSide ? rt('common.you') : rt('common.enemy');
  }

  function paintChips() {
    speedBtn.querySelector('b').textContent = `×${st.speed}`;
    speedBtn.classList.toggle('is-on', st.speed > 1);
    autoBtn.classList.toggle('is-on', st.auto);
    autoBtn.hidden = !st.canAuto || st.mode === 'duel';
  }

  function paintTurn() {
    roundEl.textContent = rt('battle.round', { n: st.round, max: st.roundLimit });
    const mine = st.mode === 'duel' ? true : st.side === st.playerSide;
    turnEl.textContent = st.mode === 'duel' ? rt('battle.playerTurn', { player: playerName(st.side) }) : mine ? rt('battle.yourTurn') : rt('battle.enemyTurn');
    turnPill.classList.toggle('is-mine', st.mode !== 'duel' && mine);
    turnPill.classList.toggle('is-enemy', st.mode !== 'duel' && !mine);
    turnPill.classList.toggle('is-p1', st.mode === 'duel' && st.side > 0);
    turnPill.classList.toggle('is-p2', st.mode === 'duel' && st.side < 0);
    thinkEl.hidden = !st.thinking;
    el.classList.toggle('is-enemy-turn', st.mode !== 'duel' && !mine);
  }

  function statusChips(unit, max = 3) {
    const list = statusList(unit);
    const wrap = h('span.rv-sts');
    for (const s of list.slice(0, max)) {
      wrap.appendChild(h('span.rv-sts__i', { class: `rv-sts__i--${s.kind}`, style: { '--c': s.color }, title: L(s.name) }, STATUS_GLYPHS[s.id] || '•'));
    }
    if (list.length > max) wrap.appendChild(h('span.rv-sts__more', `+${list.length - max}`));
    return wrap;
  }

  /** Seal elements on a unit: `seal` (string | { slot: element }) and `seals` ([element] | [{ element }]). */
  function sealBadge(unit) {
    const seals = [];
    const s = unit && unit.seal;
    if (typeof s === 'string') seals.push(s);
    else if (s && typeof s === 'object') for (const v of Object.values(s)) if (typeof v === 'string') seals.push(v);
    if (unit && Array.isArray(unit.seals)) for (const x of unit.seals) seals.push(typeof x === 'string' ? x : x && x.element);
    return seals.filter((x, i) => x && ELEMENTS[x] && seals.indexOf(x) === i);
  }

  // ---------------------------------------------------------------- rosters (keyed)
  function buildRosterNode(u) {
    const hero = getHero(u.heroId);
    const node = {};
    node.token = heroToken(ui, u.heroId, { size: 44, grey: u.side !== st.playerSide && st.mode !== 'duel', side: st.mode === 'duel' ? u.side : 0, title: false });
    node.hp = h('i.rv-ru__hpfill');
    node.sts = h('span.rv-ru__sts');
    node.cd = h('span.rv-ru__cd');
    node.crown = h('span.rv-ru__crown', rvIcon('crown'));
    node.el = h(
      'button.rv-ru',
      {
        type: 'button',
        dataset: { unit: String(u.id) },
        'aria-label': hero ? L(hero.name) : String(u.id),
        on: {
          click: ui.tap(() => !st.busy && ui.emit('select-unit', u.id), { sound: 'select', haptic: 6 }),
        },
      },
      h('span.rv-ru__ring'),
      node.token,
      node.crown,
      node.cd,
      h('span.rv-ru__hp', node.hp),
      node.sts,
    );
    return node;
  }

  function paintRosterNode(node, u) {
    const hpP = u.maxHp > 0 ? Math.max(0, Math.min(1, u.hp / u.maxHp)) : 0;
    const eP = u.maxEnergy > 0 ? Math.max(0, Math.min(1, (u.energy || 0) / u.maxEnergy)) : 0;
    const alive = u.alive !== false && u.hp > 0;
    node.el.style.setProperty('--hp', hpP.toFixed(3));
    node.el.style.setProperty('--e', eP.toFixed(3));
    node.el.classList.toggle('is-ko', !alive);
    node.el.classList.toggle('is-low', alive && hpP < 0.3);
    const ready = alive && ultReady(u);
    if (ready && !node.el.classList.contains('is-ready')) {
      node.el.classList.add('is-ready', 'just-ready');
      setTimeout(() => node.el.classList.remove('just-ready'), 1300);
    } else if (!ready) node.el.classList.remove('is-ready');
    node.el.classList.toggle('is-selected', st.selected === u.id);
    node.el.classList.toggle('is-crowned', !!u.awakened);
    node.el.classList.toggle('is-boss', !!u.boss);
    node.el.classList.toggle('is-acting', alive && u.side === st.side);
    const cd = u.cd && typeof u.cd.skill === 'number' ? u.cd.skill : 0;
    node.cd.textContent = cd > 0 && alive ? String(cd) : '';
    node.cd.hidden = !(cd > 0 && alive);
    node.sts.textContent = '';
    if (alive) node.sts.appendChild(statusChips(u, 2));
  }

  function paintRoster(r, side) {
    const units = unitsOf(st.state).filter((u) => u.side === side && !isWard(u));
    const key = units.map((u) => u.id).join('|') + `|${st.mode}|${st.playerSide}`;
    if (key !== r.key) {
      r.key = key;
      r.nodes.clear();
      r.list.textContent = '';
      for (const u of units) {
        const node = buildRosterNode(u);
        r.nodes.set(u.id, node);
        r.list.appendChild(node.el);
      }
    }
    for (const u of units) {
      const node = r.nodes.get(u.id);
      if (node) paintRosterNode(node, u);
    }
    const share = hpShare(st.state, side);
    r.shareFill.style.transform = `scaleX(${share.pct.toFixed(3)})`;
    r.shareTxt.textContent = `${Math.round(share.pct * 100)}%`;
    r.name.textContent = playerName(side);
    r.el.classList.toggle('is-p1', st.mode === 'duel' ? side > 0 : side === st.playerSide);
    r.el.classList.toggle('is-p2', st.mode === 'duel' ? side < 0 : side !== st.playerSide);
    r.el.classList.toggle('is-active', side === st.side);
  }

  // ---------------------------------------------------------------- selected unit card
  function paintCard() {
    card.textContent = '';
    const u = st.selected != null ? unitById(st.state, st.selected) : null;
    const hero = u ? getHero(u.heroId) : null;
    if (!u || !hero) {
      card.className = 'rv-ucard is-empty';
      const myTurn = st.mode === 'duel' || st.side === st.playerSide;
      card.appendChild(h('span.rv-ucard__hint', myTurn ? rt('battle.selectHint') : st.thinking ? rt('battle.thinking') : rt('battle.enemyTurn')));
      return;
    }
    const enemy = st.mode !== 'duel' && u.side !== st.playerSide;
    const alive = u.alive !== false && u.hp > 0;
    card.className = `rv-ucard ${enemy ? 'is-enemy' : 'is-ally'} rv-ucard--${hero.rarity}`;
    const hpP = u.maxHp > 0 ? u.hp / u.maxHp : 0;
    const eP = u.maxEnergy > 0 ? (u.energy || 0) / u.maxEnergy : 0;
    const ready = alive && ultReady(u);
    const seals = sealBadge(u);
    card.append(
      h('span.rv-ucard__portrait', heroToken(ui, u.heroId, { size: 54, grey: enemy, title: false }), u.awakened ? h('span.rv-ucard__crown', rvIcon('crown')) : null),
      h(
        'div.rv-ucard__main',
        h(
          'div.rv-ucard__row',
          h('b.rv-ucard__name', { 'data-fit': '11' }, L(hero.name)),
          h('span.rv-ucard__lvl', rt('common.level', { n: u.level || 1 })),
          elementBadge(hero.element),
          roleBadge(hero.role),
          ...seals.map((s) => h('span.rv-ucard__seal', { style: { '--c': ELEMENTS[s].color }, title: rt('battle.seal', { el: L(ELEMENTS[s].name) }) }, ELEMENTS[s].kanji)),
        ),
        h(
          'div.rv-ucard__bars',
          bar(hpP, { kind: 'hp', cls: 'rv-ucard__hp', label: `${fmt(Math.max(0, u.hp))} / ${fmt(u.maxHp)}${u.shield ? `  ◈${fmt(u.shield)}` : ''}` }),
          bar(eP, { kind: 'energy', cls: `rv-ucard__en ${ready ? 'is-ready' : ''}`, label: ready ? rt('battle.ultReady') : `⚡ ${Math.round(u.energy || 0)} / ${u.maxEnergy || 0}` }),
        ),
        alive
          ? h(
              'div.rv-ucard__sts',
              ...statusList(u).map((s) => h('span.rv-ucard__st', { class: `is-${s.kind}`, style: { '--c': s.color }, title: L(s.desc) }, h('i', STATUS_GLYPHS[s.id] || '•'), L(s.name), s.turns ? h('small', `${s.turns}`) : null)),
              statusList(u).length ? null : h('span.rv-ucard__none', rt('battle.noStatuses')),
            )
          : h('div.rv-ucard__sts', h('span.rv-ucard__ko', `撃破 · ${rt('battle.ko')}`)),
      ),
    );
    ui.refit(card);
  }

  // ---------------------------------------------------------------- actions
  function reasonText(info, u, kind) {
    if (!info) return '';
    const r = info.reason;
    const cd = typeof info.cooldown === 'number' ? info.cooldown : u && u.cd && typeof u.cd.skill === 'number' ? u.cd.skill : 0;
    if (kind === 'skill' && (r === 'cooldown' || (!info.ok && cd > 0))) return rt('battle.reason.cooldown', { n: cd || '' });
    const cur = typeof info.energy === 'number' ? info.energy : (u && u.energy) || 0;
    const max = typeof info.cost === 'number' ? info.cost : (u && u.maxEnergy) || 0;
    if (kind === 'ult' && (r === 'energy' || (!info.ok && cur < max))) return rt('battle.reason.energy', { cur: Math.round(cur), max });
    if (r) {
      const key = `battle.reason.${r}`;
      const t = rt(key);
      return t === key ? '' : t;
    }
    return '';
  }

  function quirkInfo(a) {
    if (!a) return null;
    if (Array.isArray(a.quirks)) return a.quirks.find((q) => q && q.ok) || null;
    return a.quirk && a.quirk.ok ? a.quirk : null;
  }

  function paintActions() {
    const u = st.selected != null ? unitById(st.state, st.selected) : null;
    const a = st.actions;
    const mine = !!(u && a && (st.mode === 'duel' ? u.side === st.side : u.side === st.playerSide && st.side === st.playerSide));
    const alive = !!(u && u.alive !== false && u.hp > 0);
    const can = mine && alive && !st.busy;
    const has = (x) => Array.isArray(x) && x.length > 0;
    const set = (type, { enabled, label, sub = '', cls = '', badge = '' }) => {
      const b = actBtns[type];
      b.disabled = !enabled;
      if (b._label.textContent !== label) {
        b._label.textContent = label;
        b._fit = false;
      }
      b._sub.textContent = sub;
      b._sub.hidden = !sub;
      b._badge.textContent = badge;
      b._badge.hidden = !badge;
      b.className = `rv-act rv-act--${type} ${cls} ${st.mode2 === (b.dataset.type || type) ? 'is-active' : ''}`;
    };
    const moved = st.moved || !!(a && a.canEnd && !a.canWait);
    set('move', { enabled: can && !moved && (has(a && a.moves) || has(a && a.swaps)), label: rt('battle.actions.move') });
    set('attack', {
      enabled: can && (has(a && a.basic) || has(a && a.basicHeal) || has(a && a.jumps)),
      label: rt('battle.actions.attack'),
      sub: can && a && has(a.jumps) ? rt('battle.jumpShort') : '',
    });
    const sk = a && a.skill;
    const cdLeft = sk && typeof sk.cooldown === 'number' ? sk.cooldown : u && u.cd && typeof u.cd.skill === 'number' ? u.cd.skill : 0;
    set('skill', {
      enabled: can && !!(sk && sk.ok),
      label: rt('battle.actions.skill'),
      sub: mine && alive && sk && !sk.ok ? reasonText(sk, u, 'skill') : '',
      badge: mine && alive && cdLeft > 0 ? `⟳${cdLeft}` : '',
    });
    const ul = a && a.ult;
    const ready = !!(u && alive && ultReady(u));
    set('ult', {
      enabled: can && !!(ul && ul.ok),
      label: rt('battle.actions.ult'),
      sub: mine && alive && ul && !ul.ok ? reasonText(ul, u, 'ult') : '',
      cls: ready && mine ? 'is-ready' : '',
    });
    actBtns.ult.style.setProperty('--e', u && u.maxEnergy ? Math.max(0, Math.min(1, (u.energy || 0) / u.maxEnergy)).toFixed(3) : '0');
    const q = can ? quirkInfo(a) : null;
    set('quirk', { enabled: !!q, label: q && q.name ? L(q.name) : rt('battle.actions.quirk') });
    actBtns.quirk.hidden = !q;
    actions.classList.toggle('has-quirk', !!q);
    const waitType = moved ? 'end' : 'wait';
    if (actBtns.wait.dataset.type !== waitType) {
      actBtns.wait.dataset.type = waitType;
      const ico = actBtns.wait.querySelector('.rv-act__ico');
      ico.textContent = '';
      ico.appendChild(rvIcon(ACTION_ICONS[waitType]));
    }
    const waitOk = a ? (moved ? a.canEnd !== false : a.canWait !== false) : false;
    set('wait', { enabled: can && waitOk, label: rt(`battle.actions.${waitType}`) });
    actions.classList.toggle('is-busy', st.busy);
    actions.classList.toggle('is-idle', !can);
    skipChip.hidden = !st.busy;
    // labels shrink to fit narrow buttons (once per label text)
    for (const b of Object.values(actBtns)) {
      if (!b._fit && !b.hidden && b.isConnected) {
        fitText(b._label, { min: 9 });
        b._fit = true;
      }
    }
  }

  function setMode(type) {
    st.mode2 = type || null;
    paintActions();
  }

  // ---------------------------------------------------------------- log feed
  const logLines = [];
  function pushLog(line) {
    const node = h('div.rv-log__line', { class: `rv-log__line--${line.tone} ${line.mine ? 'is-mine' : 'is-theirs'}` }, line.text);
    logEl.appendChild(node);
    const entry = { node, t: 0 };
    logLines.push(entry);
    while (logLines.length > LOG_MAX) {
      const old = logLines.shift();
      clearTimeout(old.t);
      old.node.remove();
    }
    const ms = Math.max(2600, readMs(line.text, ui.settings.textTime || 1.5) * 0.9);
    entry.t = setTimeout(() => {
      node.classList.add('is-out');
      setTimeout(() => {
        node.remove();
        const i = logLines.indexOf(entry);
        if (i >= 0) logLines.splice(i, 1);
      }, 380);
    }, ms);
  }
  function clearLog() {
    for (const l of logLines.splice(0)) {
      clearTimeout(l.t);
      l.node.remove();
    }
    logEl.textContent = '';
  }

  // toasts (banners inside the board area)
  function toast(text, { tone = '', duration = 0 } = {}) {
    if (!text) return;
    const node = h('div.rv-bt__toast', { class: tone ? `is-${tone}` : '' }, text);
    toastEl.appendChild(node);
    while (toastEl.children.length > 2) toastEl.firstChild.remove();
    const ms = Math.max(duration, readMs(text, ui.settings.textTime || 1.5));
    setTimeout(() => {
      node.classList.add('is-out');
      setTimeout(() => node.remove(), 380);
    }, ms);
  }

  // ---------------------------------------------------------------- layout
  let lastRect = '';
  function layout() {
    if (!el.isConnected) return;
    const w = boardArea.clientWidth;
    const hh = boardArea.clientHeight;
    if (!w || !hh) return;
    const size = Math.max(0, Math.floor(Math.min(w, hh) - BOARD_PAD * 2));
    const left = Math.round((w - size) / 2);
    const top = Math.round((hh - size) / 2);
    slot.style.width = size + 'px';
    slot.style.height = size + 'px';
    slot.style.left = left + 'px';
    slot.style.top = top + 'px';
    el.style.setProperty('--board', size + 'px');
    el.style.setProperty('--lane', Math.max(0, top) + 'px');
    logEl.classList.toggle('is-over', top < 34);
    const r = slotRect();
    const key = `${r.x},${r.y},${r.width},${r.height}`;
    if (key !== lastRect) {
      lastRect = key;
      ui.emit('board-rect', r);
    }
  }

  function slotRect() {
    const r = slot.getBoundingClientRect();
    if (typeof DOMRect === 'function') return new DOMRect(r.x, r.y, r.width, r.height);
    return r;
  }

  function lanes() {
    const a = boardArea.getBoundingClientRect();
    const s = slot.getBoundingClientRect();
    const top = s.top - a.top;
    const bottom = a.bottom - s.bottom;
    return {
      top: top >= 8 ? { x: a.left, y: a.top, width: a.width, height: top } : null,
      bottom: bottom >= 8 ? { x: a.left, y: s.bottom, width: a.width, height: bottom } : null,
    };
  }

  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => layout());
    ro.observe(boardArea);
  }

  // ---------------------------------------------------------------- render all
  function renderAll() {
    paintChips();
    paintTurn();
    if (st.state) {
      paintRoster(topRoster, -st.bottomSide);
      paintRoster(botRoster, st.bottomSide);
    }
    paintCard();
    paintActions();
    pauseBtn.setAttribute('aria-label', rt('battle.pause'));
    skipChip.querySelector('span').textContent = rt('battle.skip');
    autoBtn.querySelector('b').textContent = rt('battle.auto');
  }

  function readState(state) {
    st.state = state || st.state;
    if (state) {
      if (state.side === 1 || state.side === -1) st.side = state.side;
      if (typeof state.round === 'number') st.round = state.round;
    }
  }

  let cineT = 0;
  const hud = {
    get state() {
      return st;
    },
    setup(state, opts = {}) {
      st.mode = opts.mode || 'campaign';
      st.playerSide = opts.playerSide === -1 ? -1 : 1;
      st.bottomSide = opts.bottomSide === -1 || opts.bottomSide === 1 ? opts.bottomSide : st.playerSide;
      st.names = opts.names || null;
      st.speed = opts.speed === 2 ? 2 : 1;
      st.auto = !!opts.auto;
      st.canAuto = opts.canAuto !== false;
      const stage = opts.stageId ? stageById(opts.stageId) : opts.stage && opts.stage.id ? stageById(opts.stage.id) || opts.stage : null;
      st.roundLimit = opts.roundLimit || (stage ? roundLimitOf(stage) : roundLimitFrom(state, opts));
      st.selected = null;
      st.actions = null;
      st.moved = false;
      st.mode2 = null;
      st.busy = false;
      st.thinking = false;
      topRoster.key = '';
      botRoster.key = '';
      readState(state);
      clearLog();
      toastEl.textContent = '';
      el.classList.toggle('is-duel', st.mode === 'duel');
      renderAll();
      requestAnimationFrame(layout);
    },
    update(state) {
      readState(state);
      if (st.selected != null) {
        const u = unitById(st.state, st.selected);
        if (!u || u.alive === false) {
          st.selected = null;
          st.actions = null;
        }
      }
      renderAll();
    },
    select(unitId, unitActions = null, opts = {}) {
      st.selected = unitId == null ? null : unitId;
      st.actions = unitId == null ? null : unitActions || null;
      st.moved = !!opts.moved;
      st.mode2 = opts.mode || null;
      renderAll();
    },
    setMode,
    clear() {
      st.selected = null;
      st.actions = null;
      st.moved = false;
      st.mode2 = null;
      clearLog();
      renderAll();
    },
    log(events) {
      const lines = describeEvents(events, { state: st.state, playerSide: st.mode === 'duel' ? st.side : st.playerSide });
      for (const l of lines) pushLog(l);
    },
    setBusy(on) {
      st.busy = !!on;
      el.classList.toggle('is-busy', st.busy);
      paintActions();
    },
    setThinking(on) {
      st.thinking = !!on;
      paintTurn();
      if (st.selected == null) paintCard();
    },
    setSpeed(x) {
      st.speed = x >= 2 ? 2 : 1;
      paintChips();
    },
    setAuto(on) {
      st.auto = !!on;
      paintChips();
    },
    setCinematic(on) {
      st.cinematic = on ? st.cinematic + 1 : Math.max(0, st.cinematic - 1);
      el.classList.toggle('is-cinematic', st.cinematic > 0);
      clearTimeout(cineT);
      if (st.cinematic > 0) {
        cineT = setTimeout(() => {
          st.cinematic = 0;
          el.classList.remove('is-cinematic');
        }, CINEMATIC_FAILSAFE_MS);
      }
    },
    flip(bottomSide) {
      st.bottomSide = bottomSide === -1 ? -1 : 1;
      topRoster.key = '';
      botRoster.key = '';
      renderAll();
    },
    toast,
    lanes,
    playerName,
    refresh: renderAll,
  };

  return {
    el,
    hud,
    layout,
    slotRect,
    renderAll,
    onShow() {
      renderAll();
      requestAnimationFrame(layout);
    },
    back() {
      ui.openPause();
      return true;
    },
    destroy() {
      // the battle screen is persistent: only timers are cleared when it is left
      clearTimeout(cineT);
    },
    dispose() {
      if (ro) ro.disconnect();
      clearLog();
    },
  };
}
