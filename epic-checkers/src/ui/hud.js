// Game screen + HUD. The screen element is persistent (created once); HUD methods work whether
// or not the game screen is currently visible.
//
// Layout (portrait):  top panel (opponent) / #board-slot (max square) / status / bottom panel / actions
// Layout (landscape): opponent + status | board | player + actions

import { h, tap } from './dom.js';
import { t, loc } from './i18n.js';
import { icon } from './icons.js';
import { flagEl } from './flags.js';
import { pieceChip } from './components.js';
import { LEVEL_GLYPHS } from './titles.js';

const BOARD_PAD = 4;

function buildPanel(pos) {
  const r = {};
  r.el = h(
    'div.hp',
    { class: `hp--${pos}` },
    h('span.hp__bg', { 'aria-hidden': 'true' }),
    h('span.hp__edge', { 'aria-hidden': 'true' }),
    (r.kanji = h('span.hp__kanji', { 'aria-hidden': 'true' })),
    h(
      'div.hp__main',
      (r.avatar = h('span.hp__avatar', h('span.hp__disc'), (r.glyph = h('span.hp__glyph')), h('span.hp__ring'))),
      h(
        'div.hp__info',
        (r.name = h('div.hp__name')),
        h(
          'div.hp__sub',
          (r.sub = h('span.hp__subtext')),
          (r.thinking = h('span.hp__thinking', (r.thinkingLabel = h('span')), h('i'), h('i'), h('i'))),
        ),
      ),
      h(
        'div.hp__counts',
        (r.piecesBox = h('div.hp__count', (r.chip = pieceChip(1, 'hp__chip')), (r.pieces = h('b', '0')))),
        (r.capBox = h('div.hp__count.hp__count--cap', icon('swords'), (r.captured = h('b', '0')))),
      ),
    ),
    (r.rage = h(
      'div.hp__rage',
      (r.rageLabel = h('span.hp__rage-label')),
      h('span.hp__rage-bar', (r.rageFill = h('i')), h('span.hp__rage-ticks')),
      (r.rageFull = h('span.hp__rage-full')),
    )),
  );
  return r;
}

export function createGameScreen(ui) {
  const st = {
    variant: null,
    players: { 1: {}, '-1': {} },
    bottomColor: 1,
    epic: false,
    mode: 'ai',
    level: 3,
    giveaway: false,
    turn: 0,
    pieces: { 1: 0, '-1': 0 },
    captured: { 1: 0, '-1': 0 },
    hype: { 1: 0, '-1': 0 },
    thinking: { 1: false, '-1': false },
    canUndo: false,
    canHint: true,
    status: '',
    statusTone: '',
    statusCustom: false,
    skippable: false,
  };

  const top = buildPanel('top');
  const bottom = buildPanel('bottom');
  const panelFor = (color) => (color === st.bottomColor ? bottom : top);

  const slot = h('div', { id: 'board-slot' });
  const toasts = h('div.toasts', { 'aria-live': 'polite' });
  const skipChip = h(
    'button.skip-chip',
    { type: 'button', on: { click: tap(() => ui.emit('skip'), { sound: null, haptic: 6 }) } },
    h('span.skip-chip__label'),
    icon('speed'),
  );
  const boardArea = h('div.board-area', slot, toasts, skipChip);

  const statusFlag = h('span.status__flag');
  const statusText = h('span.status__text');
  const statusTag = h('span.status__tag');
  const statusEl = h('div.status', statusFlag, h('span.status__pill', h('span.status__dot'), statusText), statusTag);

  const mkAction = (name, key, onClick) => {
    const label = h('span.act__label');
    const b = h(
      'button.act',
      { type: 'button', dataset: { act: key }, on: { click: tap(onClick) } },
      h('span.act__bg'),
      icon(name, 'act__icon'),
      label,
    );
    b._label = label;
    b._key = key;
    return b;
  };
  const actMenu = mkAction('menu', 'hud.menu', () => ui.openPause());
  const actUndo = mkAction('undo', 'hud.undo', () => !actUndo.disabled && ui.emit('undo'));
  const actHint = mkAction('hint', 'hud.hint', () => !actHint.disabled && ui.emit('hint'));
  const actions = h('div.actions', actMenu, actUndo, actHint);

  const el = h(
    'div.screen.screen--game',
    h('div.game', top.el, boardArea, statusEl, bottom.el, actions),
  );

  // ------------------------------------------------------------ rendering helpers
  function playerInfo(color) {
    const p = st.players[color] || {};
    const isHuman = p.isHuman != null ? !!p.isHuman : st.mode === 'pvp' || (st.mode === 'ai' && color === st.bottomColor);
    const level = p.level || st.level || 3;
    const colorName = color > 0 ? t('common.white') : t('common.black');
    let name;
    let sub;
    let glyph;
    if (isHuman) {
      if (st.mode === 'pvp') {
        name = p.name || colorName;
        sub = p.title || t('hud.player');
        glyph = color > 0 ? '白' : '黒';
      } else {
        name = p.name || t('hud.you');
        const tid = ui.stats ? ui.stats.currentTitle() : null;
        sub = p.title || (tid ? t(`title.${tid}.name`) : colorName);
        glyph = '主';
      }
    } else {
      name = p.name || t((st.epic ? 'levelEpic.' : 'level.') + level);
      sub = p.title || (st.mode === 'demo' ? `${colorName} · ${t('hud.aiLevel', { n: level })}` : t('hud.aiLevel', { n: level }));
      glyph = LEVEL_GLYPHS[level] || '機';
    }
    return { isHuman, name, sub, glyph, level, colorName };
  }

  function renderPanel(color) {
    const r = panelFor(color);
    const info = playerInfo(color);
    r.el.dataset.side = String(color);
    r.el.classList.toggle('is-human', info.isHuman);
    r.el.classList.toggle('is-ai', !info.isHuman);
    r.name.textContent = info.name;
    r.sub.textContent = info.sub;
    r.glyph.textContent = st.epic ? info.glyph : info.isHuman ? '' : String(info.level);
    r.kanji.textContent = st.epic ? info.glyph : '';
    r.chip.className = `piece-chip hp__chip ${color > 0 ? 'piece-chip--white' : 'piece-chip--black'}`;
    r.thinkingLabel.textContent = st.epic ? t('hud.thinkingEpic') : t('hud.thinking');
    r.rageLabel.textContent = t('hud.rage');
    r.rageFull.textContent = t('hud.rageFull');
    r.piecesBox.title = t('hud.pieces');
    r.capBox.title = t('hud.captured');
    paintCounts(color, false);
    paintHype(color);
    r.el.classList.toggle('is-thinking', !!st.thinking[color]);
    r.el.classList.toggle('is-active', st.turn === color);
  }

  function paintCounts(color, bump = true) {
    const r = panelFor(color);
    const p = String(st.pieces[color] ?? 0);
    const c = String(st.captured[color] ?? 0);
    if (r.pieces.textContent !== p) {
      r.pieces.textContent = p;
      if (bump) pulse(r.pieces.parentNode, 'bump-down');
    }
    if (r.captured.textContent !== c) {
      r.captured.textContent = c;
      if (bump) pulse(r.captured.parentNode, 'bump-up');
    }
  }

  function paintHype(color) {
    const r = panelFor(color);
    const v = Math.max(0, Math.min(1, st.hype[color] || 0));
    r.rageFill.style.width = (v * 100).toFixed(1) + '%';
    r.el.classList.toggle('rage-full', v >= 0.999);
    r.el.style.setProperty('--rage', v.toFixed(3));
  }

  function pulse(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  }

  function defaultStatus() {
    if (!st.turn) return '';
    if (st.mode === 'ai') {
      const human = playerInfo(st.turn).isHuman;
      return human ? t('hud.yourTurn') : t('hud.opponentTurn');
    }
    return st.turn > 0 ? t('hud.turnWhite') : t('hud.turnBlack');
  }

  function paintStatus() {
    const text = st.statusCustom ? st.status : defaultStatus();
    statusText.textContent = text;
    let tone = st.statusTone;
    if (!tone && text && text === t('hud.mustCapture')) tone = 'alert';
    statusEl.dataset.tone = tone || '';
    statusEl.dataset.side = String(st.turn || 0);
    statusEl.classList.toggle('is-empty', !text);
  }

  function paintActions() {
    actMenu._label.textContent = t('hud.menu');
    actUndo._label.textContent = t('hud.undo');
    actHint._label.textContent = t('hud.hint');
    const demo = st.mode === 'demo';
    actUndo.hidden = demo;
    actHint.hidden = demo;
    actions.classList.toggle('actions--single', demo);
    actUndo.disabled = !st.canUndo;
    actHint.disabled = !st.canHint;
    skipChip.querySelector('.skip-chip__label').textContent = t('hud.skip');
    skipChip.classList.toggle('is-on', st.skippable);
  }

  function paintMeta() {
    statusFlag.textContent = '';
    if (st.variant) {
      statusFlag.appendChild(flagEl(st.variant.flag, 'status__flag-img'));
      statusFlag.title = loc(st.variant.name);
    }
    statusTag.textContent = st.giveaway ? t('hud.giveaway') : st.mode === 'demo' ? t('hud.demo') : '';
    statusTag.hidden = !statusTag.textContent;
    el.classList.toggle('is-epic', st.epic);
    el.dataset.mode = st.mode;
  }

  function renderAll() {
    renderPanel(st.bottomColor);
    renderPanel(-st.bottomColor);
    paintStatus();
    paintActions();
    paintMeta();
  }

  // ------------------------------------------------------------ layout of the board slot
  let lastRect = '';
  function layout() {
    if (!el.isConnected) return;
    const w = boardArea.clientWidth;
    const hh = boardArea.clientHeight;
    if (!w || !hh) return;
    const size = Math.max(0, Math.floor(Math.min(w, hh) - BOARD_PAD * 2));
    slot.style.width = size + 'px';
    slot.style.height = size + 'px';
    slot.style.left = Math.round((w - size) / 2) + 'px';
    slot.style.top = Math.round((hh - size) / 2) + 'px';
    el.style.setProperty('--board-size', size + 'px');
    const rect = slotRect();
    const key = `${rect.x},${rect.y},${rect.width},${rect.height}`;
    if (key !== lastRect) {
      lastRect = key;
      ui.emit('board-rect', rect);
    }
  }

  // The game screen never uses transforms (it only fades), so the client rect is exact.
  function slotRect() {
    if (!slot.isConnected) return new DOMRect(0, 0, 0, 0);
    const r = slot.getBoundingClientRect();
    return new DOMRect(r.x, r.y, r.width, r.height);
  }

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => layout());
    ro.observe(boardArea);
  }

  // ------------------------------------------------------------ public HUD API
  const hud = {
    /** { variant, players, bottomColor, epic, mode, level?, giveaway? } */
    setup({ variant, players, bottomColor = 1, epic = false, mode = 'ai', level, giveaway = false } = {}) {
      st.variant = variant || null;
      st.players = { 1: (players && players[1]) || {}, '-1': (players && players[-1]) || {} };
      st.bottomColor = bottomColor === -1 ? -1 : 1;
      st.epic = !!epic;
      st.mode = ['ai', 'pvp', 'demo'].includes(mode) ? mode : 'ai';
      st.level = level || (players && (players[1]?.level || players[-1]?.level)) || ui.settings.lastConfig.level || 3;
      st.giveaway = !!giveaway;
      st.turn = 0;
      const n = variant ? variant.piecesPerSide : 0;
      st.pieces = { 1: n, '-1': n };
      st.captured = { 1: 0, '-1': 0 };
      st.hype = { 1: 0, '-1': 0 };
      st.thinking = { 1: false, '-1': false };
      st.canUndo = false;
      st.canHint = st.mode !== 'demo';
      st.status = '';
      st.statusTone = '';
      st.statusCustom = false;
      st.skippable = false;
      toasts.textContent = '';
      ui.setTheme(st.epic);
      renderAll();
      layout();
    },
    setTurn(color) {
      st.turn = color === -1 ? -1 : color === 1 ? 1 : 0;
      st.statusCustom = false;
      st.statusTone = '';
      top.el.classList.toggle('is-active', st.turn === -st.bottomColor);
      bottom.el.classList.toggle('is-active', st.turn === st.bottomColor);
      paintStatus();
    },
    /** counts: { pieces: {1, -1}, captured: {1, -1} } or { 1: { pieces, captured }, -1: {...} } */
    setCounts(counts) {
      if (!counts) return;
      for (const c of [1, -1]) {
        const per = counts[c] || counts[String(c)];
        const pieces = per && per.pieces != null ? per.pieces : counts.pieces ? counts.pieces[c] : undefined;
        const captured = per && per.captured != null ? per.captured : counts.captured ? counts.captured[c] : undefined;
        if (pieces != null) st.pieces[c] = pieces;
        if (captured != null) st.captured[c] = captured;
        paintCounts(c, true);
      }
    },
    setThinking(color, on) {
      st.thinking[color] = !!on;
      panelFor(color).el.classList.toggle('is-thinking', !!on);
    },
    setHype(color, v) {
      const prev = st.hype[color] || 0;
      st.hype[color] = Math.max(0, Math.min(1, Number(v) || 0));
      paintHype(color);
      if (st.hype[color] >= 0.999 && prev < 0.999) pulse(panelFor(color).rage, 'rage-burst');
    },
    toast(text, opts = {}) {
      showToast(text, opts);
    },
    setCanUndo(v) {
      st.canUndo = !!v;
      actUndo.disabled = !st.canUndo;
    },
    setCanHint(v) {
      st.canHint = !!v;
      actHint.disabled = !st.canHint;
    },
    /** text: string ('' = default "whose turn" text); opts.tone: 'alert' | 'info' | 'epic' */
    setStatus(text, opts = {}) {
      st.statusCustom = !!text;
      st.status = text || '';
      st.statusTone = opts.tone || '';
      paintStatus();
      if (st.statusTone === 'alert' || (text && text === t('hud.mustCapture'))) pulse(statusEl, 'status-flash');
    },
    /** Shows the «Пропустить» chip while a skippable cinematic plays (tap emits 'skip'). */
    setSkippable(v) {
      st.skippable = !!v;
      skipChip.classList.toggle('is-on', st.skippable);
    },
    /** Re-renders all labels (language / title change). */
    refresh() {
      renderAll();
    },
    get state() {
      return st;
    },
  };

  // ------------------------------------------------------------ toasts
  function showToast(text, { epic = st.epic, duration, tone } = {}) {
    if (!text) return;
    const node = h(
      'div.toast',
      { class: `${epic ? 'toast--epic' : ''} ${tone ? 'toast--' + tone : ''}` },
      epic ? h('span.toast__slash', { 'aria-hidden': 'true' }) : null,
      h('span.toast__text', text),
    );
    toasts.appendChild(node);
    while (toasts.children.length > 3) toasts.removeChild(toasts.firstChild);
    const ms = duration || (epic ? 2200 : 2000);
    setTimeout(() => {
      node.classList.add('is-out');
      setTimeout(() => node.remove(), 450);
    }, ms);
  }

  return {
    el,
    hud,
    layout,
    slotRect,
    renderAll,
    onShow: () => {
      renderAll();
      layout();
    },
  };
}

