// Reusable UI controls. All interactive elements set pointer-events via CSS (.ui-root button etc.).

import { h, tap, feedback, rng } from './dom.js';
import { icon } from './icons.js';
import { t } from './i18n.js';

/**
 * Big game button.
 * opts: { label, sub, icon, kind: 'primary'|'secondary'|'ghost'|'danger', size: 'xl'|'lg'|'md'|'sm',
 *         onClick, sound, cls, disabled, kanji }
 */
export function button(opts) {
  const { label, sub, kind = 'secondary', size = 'lg', onClick, sound = 'click', cls = '', disabled, kanji } = opts;
  const b = h(
    'button.btn',
    {
      type: 'button',
      class: `btn--${kind} btn--${size} ${cls}`,
      disabled: !!disabled,
      on: { click: tap(onClick, { sound }) },
    },
    h('span.btn__bg'),
    kanji ? h('span.btn__kanji', { 'aria-hidden': 'true' }, kanji) : null,
    opts.icon ? icon(opts.icon, 'btn__icon') : null,
    h(
      'span.btn__text',
      h('span.btn__label', label),
      sub ? h('span.btn__sub', sub) : null,
    ),
    h('span.btn__shine'),
  );
  return b;
}

/** Round/square icon button (header back, HUD actions). */
export function iconButton({ name, label, onClick, cls = '', showLabel = false, sound = 'click' }) {
  return h(
    'button.icon-btn',
    { type: 'button', class: cls, 'aria-label': label || name, on: { click: tap(onClick, { sound }) } },
    h('span.icon-btn__bg'),
    icon(name),
    showLabel && label ? h('span.icon-btn__label', label) : null,
  );
}

/** iOS-like switch. Returns the element; el.setChecked(bool) updates it silently. */
export function switchControl({ checked, onChange, label }) {
  const el = h('button.switch', { type: 'button', role: 'switch', 'aria-label': label || '' }, h('span.switch__track', h('span.switch__knob')));
  const set = (v) => {
    el.classList.toggle('is-on', !!v);
    el.setAttribute('aria-checked', v ? 'true' : 'false');
    el._checked = !!v;
  };
  set(checked);
  el.addEventListener(
    'click',
    tap(() => {
      set(!el._checked);
      onChange && onChange(el._checked);
    }),
  );
  el.setChecked = set;
  return el;
}

/**
 * Segmented control. options: [{ value, label, icon?, glyph?, sub? }]
 * Returns element with el.setValue(v).
 */
export function segmented({ options, value, onChange, cls = '', label }) {
  const el = h('div.seg', { class: cls, role: 'radiogroup', 'aria-label': label || '' });
  const btns = options.map((o) => {
    const b = h(
      'button.seg__opt',
      {
        type: 'button',
        role: 'radio',
        dataset: { value: String(o.value) },
        on: {
          click: tap(() => {
            if (el._value === o.value) return;
            set(o.value);
            onChange && onChange(o.value);
          }),
        },
      },
      o.node || null,
      o.icon ? icon(o.icon, 'seg__icon') : null,
      o.glyph ? h('span.seg__glyph', o.glyph) : null,
      o.label != null ? h('span.seg__label', o.label) : null,
      o.sub ? h('span.seg__sub', o.sub) : null,
    );
    el.appendChild(b);
    return b;
  });
  el.appendChild(h('span.seg__thumb'));
  const set = (v) => {
    el._value = v;
    let idx = 0;
    btns.forEach((b, i) => {
      const on = b.dataset.value === String(v);
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      if (on) idx = i;
    });
    el.style.setProperty('--idx', idx);
    el.style.setProperty('--n', btns.length);
  };
  set(value);
  el.setValue = set;
  return el;
}

/** Range slider 0..1 with a filled track. onInput fires continuously, onChange on release. */
export function slider({ value, onInput, onChange, label, min = 0, max = 1, step = 0.05 }) {
  const input = h('input.slider__input', { type: 'range', min, max, step, 'aria-label': label || '' });
  input.value = String(value);
  const out = h('span.slider__value');
  const wrap = h('div.slider', input, out);
  const paint = () => {
    const v = Number(input.value);
    const p = ((v - min) / (max - min)) * 100;
    wrap.style.setProperty('--p', p + '%');
    out.textContent = Math.round(p) + '%';
  };
  paint();
  input.addEventListener('input', () => {
    paint();
    onInput && onInput(Number(input.value));
  });
  input.addEventListener('change', () => {
    feedback.haptic(6);
    onChange && onChange(Number(input.value));
  });
  return wrap;
}

/** Screen header with back button and title. */
export function header({ title, onBack, right, kanji }) {
  return h(
    'header.scr-header',
    onBack ? iconButton({ name: 'back', label: t('common.back'), onClick: onBack, cls: 'scr-header__back' }) : h('span.scr-header__spacer'),
    h('h1.scr-header__title', { 'data-fit': '11' }, title),
    kanji ? h('span.scr-header__kanji', { 'aria-hidden': 'true' }, kanji) : null,
    right || h('span.scr-header__spacer'),
  );
}

export function section(title, ...children) {
  return h('section.sec', title ? h('h2.sec__title', h('span', title)) : null, ...children);
}

/** Settings-style row: icon, label + description, control on the right (or below on narrow). */
export function row({ icon: ic, label, desc, control, stack = false }) {
  return h(
    'div.row',
    { class: stack ? 'row--stack' : '' },
    h(
      'div.row__head',
      ic ? icon(ic, 'row__icon') : null,
      h('div.row__text', h('div.row__label', label), desc ? h('div.row__desc', desc) : null),
      !stack ? control : null,
    ),
    stack ? h('div.row__control', control) : null,
  );
}

/** Small piece chip in side colour. */
export function pieceChip(color, cls = '') {
  return h('span.piece-chip', { class: `${color > 0 ? 'piece-chip--white' : color < 0 ? 'piece-chip--black' : 'piece-chip--random'} ${cls}` });
}

/**
 * EPIC BADASS MODE hero toggle. opts: { on, compact, onChange(on) }.
 * Returns element with el.setOn(bool).
 */
export function epicToggle({ on, compact = false, onChange }) {
  const r = rng(7);
  const flames = h('span.et__flames', { 'aria-hidden': 'true' });
  const N = compact ? 12 : 16;
  for (let i = 0; i < N; i++) {
    flames.appendChild(
      h('i', {
        style: {
          '--x': ((i + 0.5) / N) * 100 + '%',
          '--d': (0.55 + r() * 0.6).toFixed(2) + 's',
          '--delay': (-r() * 1.2).toFixed(2) + 's',
          '--s': (0.7 + r() * 0.7).toFixed(2),
        },
      }),
    );
  }
  const embers = h('span.et__embers', { 'aria-hidden': 'true' });
  for (let i = 0; i < (compact ? 10 : 16); i++) {
    embers.appendChild(
      h('i', {
        style: {
          '--x': (r() * 100).toFixed(1) + '%',
          '--d': (1.4 + r() * 1.6).toFixed(2) + 's',
          '--delay': (-r() * 3).toFixed(2) + 's',
          '--dx': ((r() - 0.5) * 40).toFixed(0) + 'px',
        },
      }),
    );
  }
  const bolts = h('span.et__bolts', {
    'aria-hidden': 'true',
    html:
      '<svg viewBox="0 0 200 60" preserveAspectRatio="none"><path class="b1" d="M8 4 L30 22 L22 26 L48 44 L40 47 L70 58"/><path class="b2" d="M196 2 L170 18 L178 23 L150 38 L158 42 L128 58"/><path class="b3" d="M110 0 L100 14 L106 16 L96 30"/></svg>',
  });
  const title = h('span.et__title', { 'data-text': 'EPIC BADASS MODE' }, h('span.et__epic', 'EPIC'), ' ', h('span.et__badass', 'BADASS'), ' ', h('span.et__mode', 'MODE'));
  const pitch = h('span.et__pitch', t('epic.pitch'));
  const hint = h('span.et__hint');
  const knobLabel = h('span.et__knob-label');
  const sw = h('span.et__switch', h('span.et__knob', icon('bolt', 'et__knob-ico'), knobLabel));
  const el = h(
    'button.epic-toggle',
    { type: 'button', role: 'switch', class: compact ? 'epic-toggle--compact' : '' },
    h('span.et__bg', { 'aria-hidden': 'true' }),
    h('span.et__kanji', { 'aria-hidden': 'true' }, '必殺'),
    h('span.et__lines', { 'aria-hidden': 'true' }),
    flames,
    embers,
    bolts,
    h('span.et__border', { 'aria-hidden': 'true' }),
    h('span.et__body', h('span.et__text', title, pitch, compact ? null : hint), sw),
  );
  const set = (v) => {
    el._on = !!v;
    el.classList.toggle('is-on', el._on);
    el.setAttribute('aria-checked', el._on ? 'true' : 'false');
    knobLabel.textContent = el._on ? t('epic.on') : t('epic.off');
    hint.textContent = el._on ? t('epic.onHint') : t('epic.offHint');
  };
  set(on);
  el.addEventListener('click', () => {
    const next = !el._on;
    feedback.sound(next ? 'power' : 'click');
    feedback.haptic(next ? [15, 40, 30, 40, 60] : 10);
    set(next);
    if (next) {
      el.classList.remove('just-on');
      void el.offsetWidth;
      el.classList.add('just-on');
    }
    onChange && onChange(next);
  });
  el.setOn = set;
  return el;
}
