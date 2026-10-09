// Tiny DOM helpers shared by all UI screens.

/**
 * h('div.card.card--big', { on: { click }, style: { color }, attrs... }, ...children)
 * Props: class/className, style (string|object, supports --custom-props), on {event: fn},
 * dataset {k: v}, text, html (trusted static markup only), anything else -> attribute/property.
 */
export function h(tag, props, ...children) {
  let tagName = tag;
  let classes = [];
  if (tag.includes('.')) {
    const parts = tag.split('.');
    tagName = parts[0] || 'div';
    classes = parts.slice(1);
  }
  const el = document.createElement(tagName);
  if (tagName === 'button') classes.unshift('ui-b');
  else if (tagName === 'h1' || tagName === 'h2' || tagName === 'h3' || tagName === 'p') classes.unshift('ui-t');
  if (classes.length) el.className = classes.join(' ');
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') {
        el.className = [el.className, v].filter(Boolean).join(' ');
      } else if (k === 'style') {
        if (typeof v === 'string') el.style.cssText = v;
        else for (const [sk, sv] of Object.entries(v)) {
          if (sv == null) continue;
          if (sk.startsWith('--')) el.style.setProperty(sk, String(sv));
          else el.style[sk] = sv;
        }
      } else if (k === 'on') {
        for (const [ev, fn] of Object.entries(v)) if (fn) el.addEventListener(ev, fn);
      } else if (k === 'dataset') {
        for (const [dk, dv] of Object.entries(v)) if (dv != null) el.dataset[dk] = String(dv);
      } else if (k === 'text') {
        el.textContent = String(v);
      } else if (k === 'html') {
        el.innerHTML = v;
      } else if (k in el && typeof v !== 'string') {
        el[k] = v;
      } else {
        el.setAttribute(k, v === true ? '' : String(v));
      }
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Feedback hooks (sound + haptics) — the UI instance installs real implementations. */
export const feedback = {
  sound: (name) => {},
  haptic: (pattern) => {},
};

/** Wraps a tap handler with the standard click sound + light haptic. */
export function tap(fn, { sound = 'click', haptic = 8 } = {}) {
  return (e) => {
    if (sound) feedback.sound(sound);
    if (haptic) feedback.haptic(haptic);
    fn && fn(e);
  };
}

/**
 * True if the element's text is wider than its content box. Uses a Range for sub-pixel precision
 * (scrollWidth is rounded) and compensates for transforms (screens animate with scale).
 */
function overflows(el) {
  if (el.scrollWidth > el.clientWidth + 0.5) return true;
  const box = el.getBoundingClientRect();
  if (!box.width || !el.offsetWidth) return false;
  const range = document.createRange();
  range.selectNodeContents(el);
  const textW = range.getBoundingClientRect().width;
  const cs = getComputedStyle(el);
  const inner = (el.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0)) * (box.width / el.offsetWidth);
  return textW > inner + 0.05;
}

/**
 * Shrinks the font size until the text fits the element's width (works for single-line
 * `nowrap` text and for wrapping text whose longest word would otherwise overflow — Russian!).
 * The stylesheet size is re-read every time (media queries / theme may change it).
 */
export function fitText(el, { max, min = 10 } = {}) {
  if (!el || !el.isConnected) return 0;
  el.style.fontSize = '';
  const maxSize = max || parseFloat(getComputedStyle(el).fontSize);
  if (!el.clientWidth || !maxSize) return 0;
  if (!overflows(el)) return maxSize;
  let lo = Math.min(min, maxSize);
  let hi = maxSize;
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2;
    el.style.fontSize = mid + 'px';
    if (overflows(el)) hi = mid;
    else lo = mid;
  }
  el.style.fontSize = Math.floor(lo * 10) / 10 + 'px';
  return lo;
}

/** Applies fitText to every `[data-fit]` element inside root. */
export function fitAll(root) {
  if (!root) return;
  root.querySelectorAll('[data-fit]').forEach((el) => fitText(el, { min: parseFloat(el.dataset.fit) || 10 }));
}

export const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
export const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Deterministic pseudo-random generator for decorative layouts. */
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

export function formatDuration(sec, t) {
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  if (m >= 60) {
    const hh = Math.floor(m / 60);
    return `${hh}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  return m ? t('common.minSec', { m, s: s % 60 }) : t('common.sec', { s });
}
