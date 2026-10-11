// Readable toasts. Every toast stays on screen long enough to be read:
//
//   readMs(text, textTime = 1.5) = max(2200, 900 + 60 ms × characters) × textTime
//
// Toasts stack (newest at the bottom). A new toast never knocks a visible one off the screen: when
// the stack is full it waits in a queue and appears as soon as a slot frees up. The same text that
// is already visible (or queued) is not repeated; its timer restarts instead.
//
//   const stack = createToastStack(containerEl, { max: 3, textTime: () => settings.textTime });
//   stack.show(text, { epic, tone, duration, key })   // duration = minimum ms (raised to readMs);
//                                                     // key: a toast with the same key is updated
//                                                     // in place (new text, timer restarted)
//   stack.clear()                                 // removes everything at once (new game, screen change)

import { h } from './dom.js';

export const READ_MIN_MS = 2200;
export const READ_BASE_MS = 900;
export const READ_PER_CHAR_MS = 60;
const OUT_MS = 420; // exit animation
const QUEUE_MAX = 6; // older queued toasts are dropped beyond this (they would be stale by then)

/** How long `text` must stay visible to be read comfortably (ms), scaled by settings.textTime. */
export function readMs(text, textTime = 1.5) {
  const n = Array.from(String(text == null ? '' : text)).length;
  const k = typeof textTime === 'number' && Number.isFinite(textTime) && textTime > 0 ? textTime : 1.5;
  return Math.round(Math.max(READ_MIN_MS, READ_BASE_MS + READ_PER_CHAR_MS * n) * k);
}

export function createToastStack(container, { max = 3, textTime = () => 1.5, epic = () => false } = {}) {
  const visible = []; // { text, node, timer, until }
  const queue = []; // { text, opts }

  const tt = () => {
    try {
      return textTime();
    } catch (e) {
      return 1.5;
    }
  };
  const lifeOf = (text, opts) => Math.max(readMs(text, tt()), Number(opts && opts.duration) || 0);

  function build(text, opts) {
    const isEpic = opts.epic != null ? !!opts.epic : !!epic();
    return h(
      'div.toast',
      { class: `${isEpic ? 'toast--epic' : ''} ${opts.tone ? 'toast--' + opts.tone : ''}`, role: 'status' },
      isEpic ? h('span.toast__slash', { 'aria-hidden': 'true' }) : null,
      h('span.toast__text', text),
    );
  }

  function arm(entry, ms) {
    clearTimeout(entry.timer);
    entry.until = Date.now() + ms;
    entry.timer = setTimeout(() => dismiss(entry), ms);
  }

  function dismiss(entry) {
    const i = visible.indexOf(entry);
    if (i < 0) return;
    visible.splice(i, 1);
    clearTimeout(entry.timer);
    entry.node.classList.remove('is-again');
    entry.node.classList.add('is-out');
    setTimeout(() => entry.node.remove(), OUT_MS);
    pump();
  }

  function pump() {
    while (visible.length < max && queue.length) {
      const q = queue.shift();
      present(q.text, q.opts);
    }
  }

  function present(text, opts) {
    const node = build(text, opts);
    container.appendChild(node);
    const entry = { text, key: opts.key || null, node, timer: 0, until: 0 };
    visible.push(entry);
    arm(entry, lifeOf(text, opts));
  }

  function bumpNode(node) {
    node.classList.remove('is-again');
    void node.offsetWidth;
    node.classList.add('is-again');
  }

  return {
    show(text, opts = {}) {
      if (text == null || text === '') return;
      const s = String(text);
      if (opts.key) {
        const keyed = visible.find((e) => e.key === opts.key);
        if (keyed) {
          keyed.text = s;
          const label = keyed.node.querySelector ? keyed.node.querySelector('.toast__text') : null;
          if (label) label.textContent = s;
          arm(keyed, lifeOf(s, opts));
          bumpNode(keyed.node);
          return;
        }
        const qi = queue.findIndex((q) => q.opts && q.opts.key === opts.key);
        if (qi >= 0) {
          queue[qi] = { text: s, opts };
          return;
        }
      }
      const same = visible.find((e) => e.text === s);
      if (same) {
        arm(same, lifeOf(s, opts));
        bumpNode(same.node);
        return;
      }
      if (queue.some((q) => q.text === s)) return;
      if (visible.length < max) present(s, opts);
      else {
        queue.push({ text: s, opts });
        while (queue.length > QUEUE_MAX) queue.shift();
      }
    },
    clear() {
      queue.length = 0;
      for (const e of visible.splice(0)) {
        clearTimeout(e.timer);
        e.node.remove();
      }
      container.textContent = '';
    },
    get size() {
      return visible.length + queue.length;
    },
    /** [{ text, msLeft }] of the visible toasts (tests / debugging). */
    get visible() {
      const now = Date.now();
      return visible.map((e) => ({ text: e.text, msLeft: Math.max(0, e.until - now) }));
    },
    get queued() {
      return queue.map((q) => q.text);
    },
  };
}
