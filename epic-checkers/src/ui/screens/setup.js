// Game setup: variant carousel (mini board previews), colour, AI level, EPIC toggle, giveaway, START.
// AI-vs-AI demo: one level picker per fighter (GameConfig.levelWhite / levelBlack; `level` = white's).

import { h, tap } from '../dom.js';
import { t, loc, locList } from '../i18n.js';
import { icon } from '../icons.js';
import { flagEl } from '../flags.js';
import { drawBoardPreview } from '../board-preview.js';
import { button, header, section, segmented, switchControl, pieceChip, epicToggle } from '../components.js';
import { LEVEL_GLYPHS } from '../titles.js';

export function createSetup(ui, params = {}) {
  const mode = ['ai', 'pvp', 'demo'].includes(params.mode) ? params.mode : ui.settings.lastConfig.mode || 'ai';
  const last = ui.settings.lastConfig;
  const variants = ui.variants;
  const cfg = {
    variantId: variants.some((v) => v.id === last.variantId) ? last.variantId : variants[0].id,
    mode,
    humanColor: last.humanColor,
    level: last.level,
    levelWhite: last.levelWhite || last.level,
    levelBlack: last.levelBlack || last.level,
    epic: ui.isEpic,
    giveaway: last.giveaway,
  };

  // ------------------------------------------------------------ variant carousel
  const cards = new Map();
  const canvases = [];
  const track = h('div.vtrack');
  const dots = h('div.vdots', { 'aria-hidden': 'true' });
  for (const v of variants) {
    const cv = h('canvas.vcard__board');
    canvases.push({ cv, v });
    const badges = locList(v.badges).filter((b) => !/^\d+×\d+$/.test(b));
    const meta = [t('setup.perSide', { n: v.piecesPerSide }), v.first === -1 ? t('setup.firstBlack') : t('setup.firstWhite')];
    const card = h(
      'button.vcard',
      {
        type: 'button',
        dataset: { id: v.id },
        'aria-label': loc(v.name),
        on: { click: tap(() => select(v.id, true)) },
      },
      h('span.vcard__bg'),
      h(
        'span.vcard__top',
        h('span.vcard__board-wrap', cv),
        h(
          'span.vcard__head',
          h('span.vcard__flagrow', flagEl(v.flag), h('span.vcard__size', `${v.size}×${v.size}`)),
          h('span.vcard__name', { 'data-fit': '11' }, loc(v.name)),
          h('span.vcard__meta', meta.join(' · ')),
        ),
      ),
      h('span.vcard__short', loc(v.short)),
      h('span.vcard__badges', badges.map((b) => h('span.badge', b))),
      h('span.vcard__check', icon('check')),
    );
    cards.set(v.id, card);
    track.appendChild(card);
    dots.appendChild(h('i', { dataset: { id: v.id } }));
  }
  const carousel = h('div.vcarousel', track);

  const drawPreviews = () => {
    for (const { cv, v } of canvases) drawBoardPreview(cv, v, { px: 92, epic: cfg.epic });
  };

  function centerCard(id, smooth) {
    const card = cards.get(id);
    if (!card || !carousel.clientWidth) return;
    const left = card.offsetLeft - (carousel.clientWidth - card.offsetWidth) / 2;
    if (smooth && carousel.scrollTo) carousel.scrollTo({ left, behavior: 'smooth' });
    else carousel.scrollLeft = left;
  }

  function select(id, smooth) {
    cfg.variantId = id;
    for (const [vid, card] of cards) {
      card.classList.toggle('is-selected', vid === id);
      card.setAttribute('aria-pressed', vid === id ? 'true' : 'false');
    }
    dots.querySelectorAll('i').forEach((d) => d.classList.toggle('is-on', d.dataset.id === id));
    centerCard(id, smooth);
  }

  // ------------------------------------------------------------ colour
  let colorSec = null;
  if (mode === 'ai') {
    const seg = segmented({
      label: t('setup.color'),
      cls: 'seg--color',
      value: cfg.humanColor,
      options: [
        { value: 1, label: t('common.white'), node: pieceChip(1, 'seg__chip') },
        { value: -1, label: t('common.black'), node: pieceChip(-1, 'seg__chip') },
        { value: 0, label: t('setup.random'), node: pieceChip(0, 'seg__chip') },
      ],
      onChange: (v) => (cfg.humanColor = v),
    });
    colorSec = section(t('setup.color'), seg);
  }

  // ------------------------------------------------------------ level
  // One picker per AI: `key` is the cfg field it edits ('level' | 'levelWhite' | 'levelBlack').
  function levelPicker(key, { label, side = 0, compact = false } = {}) {
    const levelName = h('div.lvl__name');
    const levelDesc = compact ? null : h('div.lvl__desc');
    const lvlBtns = [];
    const lvl = h('div.lvl', { role: 'radiogroup', 'aria-label': label || t('setup.level') });
    for (let n = 1; n <= 5; n++) {
      const b = h(
        'button.lvl__opt',
        {
          type: 'button',
          role: 'radio',
          dataset: { n },
          on: {
            click: tap(() => {
              cfg[key] = n;
              paint();
            }),
          },
        },
        h('span.lvl__glyph', LEVEL_GLYPHS[n]),
        h('span.lvl__num', String(n)),
        h('span.lvl__pips', Array.from({ length: 5 }, (_, i) => h('i', { class: i < n ? 'on' : '' }))),
      );
      lvlBtns.push(b);
      lvl.appendChild(b);
    }
    const paint = () => {
      const v = cfg[key];
      lvlBtns.forEach((b, i) => {
        const on = i + 1 === v;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      const epic = cfg.epic;
      levelName.textContent = `${v} · ${t((epic ? 'levelEpic.' : 'level.') + v)}`;
      if (levelDesc) levelDesc.textContent = t((epic ? 'levelDescEpic.' : 'levelDesc.') + v);
      lvl.style.setProperty('--lvl', v);
    };
    const head = side ? h('div.lvl__side', pieceChip(side, 'lvl__chip'), h('span', label)) : null;
    const node = h('div.lvl-picker', { class: compact ? 'lvl-picker--compact' : '' }, head, lvl, h('div.lvl__info', levelName, levelDesc));
    return { node, paint };
  }

  let levelSec = null;
  let paintLevel = () => {};
  if (mode === 'ai') {
    const p = levelPicker('level');
    paintLevel = p.paint;
    levelSec = section(t('setup.level'), p.node);
  } else if (mode === 'demo') {
    const pw = levelPicker('levelWhite', { label: t('common.white'), side: 1, compact: true });
    const pb = levelPicker('levelBlack', { label: t('common.black'), side: -1, compact: true });
    paintLevel = () => {
      pw.paint();
      pb.paint();
    };
    levelSec = section(t('setup.levelDemo'), pw.node, pb.node);
  }

  // ------------------------------------------------------------ hints for pvp / demo
  const hintBox =
    mode === 'pvp'
      ? h('div.note', icon('users', 'note__icon'), h('span', t('setup.pvpHint')))
      : mode === 'demo'
        ? h('div.note', icon('swords', 'note__icon'), h('span', t('setup.demoHint')))
        : null;

  // ------------------------------------------------------------ toggles
  const startBtn = button({
    label: '',
    icon: 'play',
    kind: 'primary',
    size: 'xl',
    cls: 'setup__start',
    sound: 'start',
    kanji: '闘',
    onClick: () => start(),
  });
  const startLabel = startBtn.querySelector('.btn__label');
  const paintStart = () => (startLabel.textContent = cfg.epic ? t('setup.startEpic') : t('setup.start'));

  const epicSw = epicToggle({
    on: cfg.epic,
    onChange: (on) => {
      cfg.epic = on;
      ui.setEpic(on, { announce: false });
      onTheme(on);
    },
  });

  const giveSw = switchControl({ checked: cfg.giveaway, label: t('setup.giveaway'), onChange: (v) => (cfg.giveaway = v) });
  const giveRow = h(
    'div.row.row--card',
    h(
      'div.row__head',
      h('span.row__glyph', '逆'),
      h('div.row__text', h('div.row__label', t('setup.giveaway')), h('div.row__desc', t('setup.giveawayDesc'))),
      giveSw,
    ),
  );

  const rulesLink = h(
    'button.link-btn',
    { type: 'button', on: { click: tap(() => ui.openSheet('rules', { variantId: cfg.variantId })) } },
    icon('rules'),
    h('span', t('setup.rules')),
  );

  let busy = false;
  function start() {
    if (busy) return;
    busy = true;
    setTimeout(() => (busy = false), 900);
    const stored = { ...cfg };
    ui.updateSettings({ lastConfig: stored });
    const config = {
      variantId: cfg.variantId,
      mode,
      humanColor: mode === 'ai' ? cfg.humanColor : 1,
      level: mode === 'demo' ? cfg.levelWhite : cfg.level,
      epic: cfg.epic,
      giveaway: cfg.giveaway,
    };
    if (mode === 'demo') {
      config.levelWhite = cfg.levelWhite;
      config.levelBlack = cfg.levelBlack;
    }
    ui.emit('play', config);
  }

  function onTheme(epic) {
    cfg.epic = epic;
    epicSw.setOn(epic);
    drawPreviews();
    paintLevel();
    paintStart();
  }

  const el = h(
    'div.screen.screen--setup',
    h('div.scr-deco', { 'aria-hidden': 'true' }, h('span.deco-kanji', '対')),
    header({ title: t(`setup.title.${mode}`), onBack: () => ui.back(), kanji: '対決' }),
    h(
      'div.scr-body.scr-scroll',
      h(
        'section.sec.sec--variants',
        h('h2.sec__title', h('span', t('setup.variant')), rulesLink),
        carousel,
        dots,
      ),
      hintBox,
      colorSec,
      levelSec,
      h('div.setup__epic', epicSw),
      giveRow,
      h('div.scr-body__pad'),
    ),
    h('footer.scr-footer', startBtn),
  );

  paintLevel();
  paintStart();
  drawPreviews();
  select(cfg.variantId, false);

  return {
    el,
    onShow: () => {
      drawPreviews();
      centerCard(cfg.variantId, false);
    },
    onResize: () => centerCard(cfg.variantId, false),
    onTheme,
    state: () => ({ mode }),
  };
}
