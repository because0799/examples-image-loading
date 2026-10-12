// «Валькирии доски» — reusable DOM pieces (rv-* classes, see rpg.css). Everything interactive is a
// <button> (≥ 44 px touch target) and uses ui.tap() for the click sound + light haptic.

import { h as domH } from '../../ui/dom.js';
import { rvIcon, ELEMENT_ICONS } from './icons.js';
import { rt, L, fmt } from './i18n.js';
import { ELEMENTS, ROLES, RARITIES, getHero, MAX_CONSTELLATION } from './model.js';

/**
 * src/ui/dom.js h() with the RPG reset classes: buttons get `rvb` (instead of the app's `ui-b`) and
 * h1/h2/h3/p get `rvt` (instead of `ui-t`), so the reset lives in rpg.css right before the RPG
 * components and wins no matter where the app's stylesheet lands in the bundle.
 */
export function h(tag, props, ...children) {
  const el = domH(tag, props, ...children);
  const cl = el.classList;
  if (cl.contains('ui-b')) {
    cl.remove('ui-b');
    cl.add('rvb');
  } else if (cl.contains('ui-t')) {
    cl.remove('ui-t');
    cl.add('rvt');
  }
  return el;
}

/** Safe asset URL: assets[kind](...args) or null (missing module / function / throw). */
export function assetUrl(ui, kind, ...args) {
  const a = ui && ui.assets;
  if (!a) return null;
  try {
    const v = typeof a[kind] === 'function' ? a[kind](...args) : a[kind];
    return typeof v === 'string' && v ? v : null;
  } catch (e) {
    return null;
  }
}

/**
 * <img> that marks its wrapper `.is-missing` when the file is absent (the wrapper's CSS fallback
 * — gradient + glyph — shows through). `wrap` gets `is-loaded` once decoded.
 */
export function artImg(url, wrap, { alt = '', cls = 'rv-art', lazy = true, position = null } = {}) {
  if (!url) {
    wrap.classList.add('is-missing');
    return null;
  }
  const img = h('img', {
    class: cls,
    alt,
    draggable: 'false',
    decoding: 'async',
    loading: lazy ? 'lazy' : 'eager',
    style: position ? { objectPosition: position } : null,
  });
  img.addEventListener('load', () => wrap.classList.add('is-loaded'), { once: true });
  img.addEventListener(
    'error',
    () => {
      wrap.classList.add('is-missing');
      img.remove();
    },
    { once: true },
  );
  img.src = url;
  return img;
}

/** Hero colour tokens for CSS (--c1..--c3 palette, --el element colour, --rar rarity colour). */
export function heroVars(hero) {
  if (!hero) return {};
  const el = ELEMENTS[hero.element] || {};
  const pal = hero.palette || [];
  return {
    '--c1': pal[0] || el.color,
    '--c2': pal[1] || el.accent,
    '--c3': pal[2] || el.dark,
    '--el': el.color,
    '--el2': el.accent,
    '--eld': el.dark,
    '--rar': RARITIES[hero.rarity] ? RARITIES[hero.rarity].color : '#4FA3FF',
  };
}

// ------------------------------------------------------------------------------------ buttons

/**
 * Button. opts: { label, sub, icon, kind: 'gold'|'glass'|'crystal'|'ghost'|'danger', size: 'xl'|'lg'|'md'|'sm',
 *   onClick, disabled, cls, cost (crystals), badge, sound, kanji }
 */
export function rvButton(ui, opts) {
  const { label, sub, kind = 'glass', size = 'lg', onClick, disabled, cls = '', cost, badge, sound = 'click', kanji } = opts;
  const b = h(
    'button.rv-btn',
    {
      type: 'button',
      class: `rv-btn--${kind} rv-btn--${size} ${cls}`,
      disabled: !!disabled,
      on: { click: ui.tap(onClick, { sound }) },
    },
    h('span.rv-btn__bg', { 'aria-hidden': 'true' }),
    kanji ? h('span.rv-btn__kanji', { 'aria-hidden': 'true' }, kanji) : null,
    opts.icon ? rvIcon(opts.icon, 'rv-btn__icon') : null,
    h('span.rv-btn__text', h('span.rv-btn__label', { 'data-fit': '11' }, label), sub ? h('span.rv-btn__sub', sub) : null),
    cost != null ? h('span.rv-btn__cost', rvIcon('crystal', 'rv-btn__cost-ico'), h('b', fmt(cost))) : null,
    badge ? h('span.rv-btn__badge', badge) : null,
  );
  return b;
}

export function rvIconButton(ui, { name, label, onClick, cls = '', sound = 'click', badge = null }) {
  return h(
    'button.rv-ibtn',
    { type: 'button', class: cls, 'aria-label': label || name, title: label || '', on: { click: ui.tap(onClick, { sound }) } },
    rvIcon(name),
    badge ? h('span.rv-ibtn__badge', badge) : null,
  );
}

/** Screen header: back button, title (+kanji watermark), right slot. */
export function rvHeader(ui, { title, kanji, onBack, right }) {
  return h(
    'header.rv-header',
    onBack ? rvIconButton(ui, { name: 'back', label: rt('common.back'), onClick: onBack, cls: 'rv-header__back' }) : h('span.rv-header__spacer'),
    h('div.rv-header__titles', kanji ? h('span.rv-header__kanji', { 'aria-hidden': 'true' }, kanji) : null, h('h1.rv-header__title', { 'data-fit': '13' }, title)),
    h('div.rv-header__right', right || null),
  );
}

/** Crystal / dust / scroll counter pill. */
export function currencyPill(kind, value, { cls = '' } = {}) {
  const icon = kind === 'dust' ? 'dust' : kind === 'scrolls' ? 'scroll' : 'crystal';
  const title = kind === 'dust' ? rt('common.dust') : kind === 'scrolls' ? rt('common.scrolls') : rt('common.crystals');
  return h('span.rv-cur', { class: `rv-cur--${kind} ${cls}`, title }, rvIcon(icon, 'rv-cur__ico'), h('b.rv-cur__val', fmt(value)));
}

// ------------------------------------------------------------------------------------ badges

export function rarityStars(rarity, { cls = '' } = {}) {
  const n = (RARITIES[rarity] && RARITIES[rarity].stars) || 3;
  const el = h('span.rv-stars', { class: `rv-stars--${rarity} ${cls}`, 'aria-label': rt(`rarity.${rarity}`) });
  for (let i = 0; i < n; i++) el.appendChild(rvIcon('star', 'rv-stars__s'));
  return el;
}

export function elementBadge(element, { label = false, cls = '' } = {}) {
  const e = ELEMENTS[element];
  if (!e) return null;
  const el = h(
    'span.rv-el',
    { class: `rv-el--${element} ${label ? 'rv-el--label' : ''} ${cls}`, style: { '--el': e.color, '--el2': e.accent, '--eld': e.dark }, title: L(e.name) },
    h('span.rv-el__disc', { html: ELEMENT_ICONS[element] || '' }),
    label ? h('span.rv-el__label', L(e.name)) : null,
  );
  return el;
}

export function roleBadge(role, { label = false, cls = '' } = {}) {
  const r = ROLES[role];
  if (!r) return null;
  return h('span.rv-role', { class: `rv-role--${role} ${label ? 'rv-role--label' : ''} ${cls}`, title: L(r.name) }, rvIcon(role, 'rv-role__ico'), label ? h('span.rv-role__label', L(r.name)) : null);
}

/** C0..C6 dots. */
export function constellationDots(c, { cls = '' } = {}) {
  const el = h('span.rv-cdots', { class: cls, 'aria-label': `C${c}` });
  for (let i = 1; i <= MAX_CONSTELLATION; i++) el.appendChild(h('i', { class: i <= c ? 'is-lit' : '' }));
  return el;
}

/** Progress bar (pct 0..1). kind: 'xp'|'hp'|'energy'|'power'. */
export function bar(pct, { kind = 'xp', cls = '', label = null } = {}) {
  const p = Math.max(0, Math.min(1, Number(pct) || 0));
  return h('span.rv-bar', { class: `rv-bar--${kind} ${cls}`, style: { '--p': p } }, h('span.rv-bar__fill'), label ? h('span.rv-bar__label', label) : null);
}

// ------------------------------------------------------------------------------------ portraits

/**
 * Collection card 3:4: card art, rarity frame, element/role badges, level, constellation dots.
 * opts: { owned, level, constellation, onClick, compact, selected, tag, grey }
 */
export function heroCard(ui, heroId, opts = {}) {
  const hero = getHero(heroId);
  if (!hero) return h('span');
  const { owned = true, level = 1, constellation = 0, onClick, compact = false, selected = false, tag = null, tagKind = '', grey = false, cls = '' } = opts;
  const art = h('span.rv-card__art', { 'data-glyph': hero.name.jp ? Array.from(hero.name.jp)[0] : '' });
  const img = artImg(assetUrl(ui, 'card', heroId), art, { alt: L(hero.name) });
  if (img) art.appendChild(img);
  const body = [
    hero.rarity === 'mythic' ? h('span.rv-card__iris', { 'aria-hidden': 'true' }) : null,
    h('span.rv-card__frame', { 'aria-hidden': 'true' }),
    art,
    h('span.rv-card__shade', { 'aria-hidden': 'true' }),
    h('span.rv-card__top', elementBadge(hero.element), roleBadge(hero.role)),
    owned
      ? h(
          'span.rv-card__bottom',
          h('span.rv-card__name', { 'data-fit': '9' }, L(hero.name)),
          h('span.rv-card__meta', h('span.rv-card__lvl', rt('common.level', { n: level })), constellationDots(constellation)),
          rarityStars(hero.rarity, { cls: 'rv-card__stars' }),
        )
      : h(
          'span.rv-card__bottom',
          h('span.rv-card__name', { 'data-fit': '9' }, grey ? L(hero.name) : '???'),
          h('span.rv-card__meta', h('span.rv-card__lvl', rt('collection.locked'))),
          rarityStars(hero.rarity, { cls: 'rv-card__stars' }),
        ),
    !owned && !grey ? h('span.rv-card__q', { 'aria-hidden': 'true' }, '?') : null,
    tag ? h('span.rv-card__tag', { class: tagKind ? `rv-card__tag--${tagKind}` : '' }, tag) : null,
  ];
  const tagName = onClick ? 'button.rv-card' : 'span.rv-card';
  const el = h(
    tagName,
    {
      type: onClick ? 'button' : null,
      class: `rv-card--${hero.rarity} ${owned ? 'is-owned' : 'is-locked'} ${grey ? 'is-grey' : ''} ${compact ? 'rv-card--compact' : ''} ${selected ? 'is-selected' : ''} ${cls}`,
      style: heroVars(hero),
      dataset: { hero: heroId },
      'aria-label': owned || grey ? `${L(hero.name)}, ${rt(`rarity.${hero.rarity}`)}` : `${rt('collection.locked')}, ${rt(`rarity.${hero.rarity}`)}`,
      on: onClick ? { click: ui.tap(() => onClick(heroId)) } : null,
    },
    body,
  );
  return el;
}

/** Circular portrait token (token webp, rarity ring). opts: { size, grey, cls, side } */
export function heroToken(ui, heroId, { size = 48, grey = false, cls = '', side = 0, title = true } = {}) {
  const hero = getHero(heroId);
  const wrap = h('span.rv-token', {
    class: `${hero ? 'rv-token--' + hero.rarity : ''} ${grey ? 'is-grey' : ''} ${side ? (side > 0 ? 'is-p1' : 'is-p2') : ''} ${cls}`,
    style: { ...heroVars(hero), '--sz': size + 'px' },
    title: title && hero ? L(hero.name) : null,
    'data-glyph': hero && hero.name.jp ? Array.from(hero.name.jp)[0] : '?',
  });
  const img = artImg(hero ? assetUrl(ui, 'token', heroId) : null, wrap, { alt: hero ? L(hero.name) : '', cls: 'rv-token__img' });
  if (img) wrap.appendChild(img);
  wrap.appendChild(h('span.rv-token__ring', { 'aria-hidden': 'true' }));
  return wrap;
}

/** 16:9 splash with an `object-position` around the focal point. */
export function heroSplash(ui, heroId, { cls = '', grey = false, lazy = false } = {}) {
  const hero = getHero(heroId);
  const wrap = h('div.rv-splash', {
    class: `${grey ? 'is-grey' : ''} ${cls}`,
    style: heroVars(hero),
    'data-glyph': hero && hero.name.jp ? hero.name.jp : '',
  });
  let focal = hero && hero.art ? hero.art.focal : null;
  if (hero && ui && ui.assets && typeof ui.assets.focal === 'function') {
    try {
      const v = ui.assets.focal(heroId);
      if (v && typeof v.x === 'number') focal = v;
    } catch (e) {
      /* data focal */
    }
  }
  const pos = focal ? `${Math.round(focal.x * 100)}% ${Math.round(Math.min(1, focal.y * 1.15) * 100)}%` : '50% 25%';
  const img = artImg(hero ? assetUrl(ui, 'splash', heroId) : null, wrap, { alt: hero ? L(hero.name) : '', cls: 'rv-splash__img', lazy, position: pos });
  if (img) wrap.appendChild(img);
  return wrap;
}

// ------------------------------------------------------------------------------------ controls

export function rvSwitch(ui, { checked, onChange, label }) {
  const el = h('button.rv-switch', { type: 'button', role: 'switch', 'aria-label': label || '' }, h('span.rv-switch__track', h('span.rv-switch__knob')));
  const set = (v) => {
    el._on = !!v;
    el.classList.toggle('is-on', el._on);
    el.setAttribute('aria-checked', el._on ? 'true' : 'false');
  };
  set(checked);
  el.addEventListener(
    'click',
    ui.tap(() => {
      set(!el._on);
      onChange && onChange(el._on);
    }),
  );
  el.setChecked = set;
  return el;
}

/** Range slider; onInput while dragging, onChange on release. */
export function rvSlider(ui, { value, min = 0, max = 1, step = 0.05, onInput, onChange, label, format }) {
  const input = h('input.rv-slider__input', { type: 'range', min, max, step, 'aria-label': label || '' });
  input.value = String(value);
  const out = h('span.rv-slider__val');
  const wrap = h('div.rv-slider', input, out);
  const paint = () => {
    const v = Number(input.value);
    const p = (v - min) / (max - min);
    wrap.style.setProperty('--p', String(p));
    out.textContent = format ? format(v) : Math.round(p * 100) + '%';
  };
  paint();
  input.addEventListener('input', () => {
    paint();
    onInput && onInput(Number(input.value));
  });
  input.addEventListener('change', () => {
    ui.haptic(6);
    onChange && onChange(Number(input.value));
  });
  wrap.setValue = (v) => {
    input.value = String(v);
    paint();
  };
  return wrap;
}

/** Segmented control: options [{ value, label, icon }]. */
export function rvSeg(ui, { options, value, onChange, cls = '', label }) {
  const el = h('div.rv-seg', { class: cls, role: 'radiogroup', 'aria-label': label || '', style: { '--n': options.length } });
  const btns = options.map((o) =>
    h(
      'button.rv-seg__opt',
      {
        type: 'button',
        role: 'radio',
        dataset: { value: String(o.value) },
        on: {
          click: ui.tap(() => {
            if (el._value === o.value) return;
            set(o.value);
            onChange && onChange(o.value);
          }),
        },
      },
      o.icon ? rvIcon(o.icon, 'rv-seg__ico') : null,
      o.node || null,
      o.label != null ? h('span.rv-seg__label', o.label) : null,
    ),
  );
  btns.forEach((b) => el.appendChild(b));
  const set = (v) => {
    el._value = v;
    btns.forEach((b) => {
      const on = b.dataset.value === String(v);
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  };
  set(value);
  el.setValue = set;
  return el;
}

/** Filter chip (toggle). */
export function chip(ui, { label, icon, node, active, onClick, cls = '', title, style }) {
  return h(
    'button.rv-chip',
    { type: 'button', class: `${active ? 'is-active' : ''} ${cls}`, title: title || null, 'aria-pressed': active ? 'true' : 'false', style, on: { click: ui.tap(onClick) } },
    icon ? rvIcon(icon, 'rv-chip__ico') : null,
    node || null,
    label != null ? h('span.rv-chip__label', label) : null,
  );
}

/** Section with a title rule. */
export function rvSection(title, ...children) {
  return h('section.rv-sec', title ? h('h2.rv-sec__title', h('span', title)) : null, ...children);
}

/** Decorative starfield (static dots; no animation). */
export function starfield(seed = 3, n = 40, cls = '') {
  const el = h('span.rv-starfield', { class: cls, 'aria-hidden': 'true' });
  let s = seed >>> 0 || 1;
  const r = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
  for (let i = 0; i < n; i++) {
    el.appendChild(h('i', { style: { left: (r() * 100).toFixed(1) + '%', top: (r() * 100).toFixed(1) + '%', '--s': (0.4 + r() * 1.2).toFixed(2), '--o': (0.3 + r() * 0.7).toFixed(2) } }));
  }
  return el;
}

/**
 * «Кого заменить?» — the squad is full and the player wants `newId` in it: a sheet with the current
 * members; resolves the id to replace, or null when closed.
 */
export function pickReplacement(ui, squadIds, newId, { levelOf = null } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const hero = getHero(newId);
    ui.openSheet(
      (close) =>
        h(
          'div.rv-replace',
          h('p.rv-replace__hint', rt('squad.replaceHint', { name: hero ? L(hero.name) : '' })),
          h(
            'div.rv-replace__list',
            ...squadIds.map((id) => {
              const x = getHero(id);
              return h(
                'button.rv-replace__item',
                {
                  type: 'button',
                  dataset: { hero: id },
                  on: {
                    click: ui.tap(() => {
                      finish(id);
                      close();
                    }),
                  },
                },
                heroToken(ui, id, { size: 56 }),
                h('span.rv-replace__name', { 'data-fit': '9' }, x ? L(x.name) : id),
                levelOf ? h('span.rv-replace__lvl', rt('common.level', { n: levelOf(id) })) : null,
              );
            }),
          ),
        ),
      { title: rt('squad.replaceTitle'), kanji: '交代', cls: 'rv-sheet--replace', onClose: () => finish(null) },
    );
  });
}
