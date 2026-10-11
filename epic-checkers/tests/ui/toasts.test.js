// Readable toasts: readMs formula, stacking/queueing, de-duplication, never an instant replace.
import test from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------- minimal DOM for dom.h()
class FakeNode {
  constructor() {
    this.childNodes = [];
    this.parentNode = null;
  }
  appendChild(c) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    this.childNodes.push(c);
    return c;
  }
  removeChild(c) {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) this.childNodes.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
  get children() {
    return this.childNodes.filter((n) => n instanceof FakeEl);
  }
  get firstChild() {
    return this.childNodes[0] || null;
  }
  get textContent() {
    return this.childNodes.map((n) => n.textContent).join('');
  }
  set textContent(v) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = v ? [new FakeText(String(v))] : [];
  }
}
class FakeText extends FakeNode {
  constructor(text) {
    super();
    this.text = text;
  }
  get textContent() {
    return this.text;
  }
}
class FakeEl extends FakeNode {
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
    this._cls = new Set();
    this.attrs = {};
    this.dataset = {};
    this.style = { setProperty() {}, cssText: '' };
    const self = this;
    this.classList = {
      add: (...c) => c.forEach((x) => self._cls.add(x)),
      remove: (...c) => c.forEach((x) => self._cls.delete(x)),
      contains: (c) => self._cls.has(c),
      toggle: (c, on) => ((on ?? !self._cls.has(c)) ? self._cls.add(c) : self._cls.delete(c)),
    };
  }
  get className() {
    return [...this._cls].join(' ');
  }
  set className(v) {
    this._cls = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  addEventListener() {}
  /** '.class' selectors only */
  querySelector(sel) {
    const cls = sel.replace(/^\./, '');
    const walk = (n) => {
      for (const c of n.children) {
        if (c.classList.contains(cls)) return c;
        const r = walk(c);
        if (r) return r;
      }
      return null;
    };
    return walk(this);
  }
  get offsetWidth() {
    return 100;
  }
}
globalThis.Node = FakeNode;
globalThis.document = {
  createElement: (t) => new FakeEl(t),
  createTextNode: (s) => new FakeText(s),
};

const { readMs, createToastStack, READ_MIN_MS } = await import('../../src/ui/toasts.js');

const texts = (container) => container.children.filter((n) => !n.classList.contains('is-out')).map((n) => n.textContent);

test('readMs = max(2200, 900 + 60 ms × characters) × textTime', () => {
  assert.equal(READ_MIN_MS, 2200);
  assert.equal(readMs('Ход назад', 1), 2200);
  assert.equal(readMs('x'.repeat(30), 1), 2700);
  assert.equal(readMs('x'.repeat(30), 2), 5400);
  assert.equal(readMs('Нажми «Назад» ещё раз, чтобы выйти', 1.5), Math.round((900 + 60 * 34) * 1.5));
  assert.equal(readMs('🔥🔥', 1), 2200, 'characters, not UTF-16 units');
  assert.equal(readMs('', 3), 6600);
  assert.equal(readMs('abc', 'junk'), 3300, 'bad textTime falls back to 1.5');
});

test('toasts stack, wait in a queue when full, and each stays readable', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const box = new FakeEl('div');
  let tt = 1;
  const stack = createToastStack(box, { max: 2, textTime: () => tt });
  stack.show('Первый');
  stack.show('Второй');
  stack.show('Третий');
  assert.deepEqual(texts(box), ['Первый', 'Второй'], 'the third one does not knock the first one off');
  assert.deepEqual(stack.queued, ['Третий']);
  t.mock.timers.tick(2199);
  assert.deepEqual(texts(box), ['Первый', 'Второй'], 'still readable before 2.2 s');
  t.mock.timers.tick(2);
  assert.deepEqual(texts(box), ['Третий'], 'expired toasts leave, the queued one appears');
  // the queued one gets its full readable time from the moment it appears
  t.mock.timers.tick(2199);
  assert.deepEqual(texts(box), ['Третий']);
  t.mock.timers.tick(500);
  assert.deepEqual(texts(box), []);
  // textTime scales the lifetime
  tt = 3;
  stack.show('Долгий');
  t.mock.timers.tick(6599);
  assert.deepEqual(texts(box), ['Долгий']);
  t.mock.timers.tick(2);
  assert.deepEqual(texts(box), []);
});

test('the same text is not repeated: its timer restarts instead; duration can only extend', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const box = new FakeEl('div');
  const stack = createToastStack(box, { max: 3, textTime: () => 1 });
  stack.show('Подсказка недоступна');
  t.mock.timers.tick(2000);
  stack.show('Подсказка недоступна');
  assert.deepEqual(texts(box), ['Подсказка недоступна']);
  t.mock.timers.tick(2000);
  assert.deepEqual(texts(box), ['Подсказка недоступна'], 'restarted');
  t.mock.timers.tick(300);
  assert.deepEqual(texts(box), []);
  stack.show('Коротко', { duration: 500 });
  t.mock.timers.tick(2100);
  assert.deepEqual(texts(box), ['Коротко'], 'a short duration is raised to readMs');
  stack.show('Долго', { duration: 9000 });
  t.mock.timers.tick(5000);
  assert.deepEqual(texts(box), ['Долго']);
  t.mock.timers.tick(4001);
  assert.deepEqual(texts(box), []);
  stack.show('a');
  stack.show('b');
  stack.clear();
  assert.equal(stack.size, 0);
  assert.equal(box.children.length, 0);
});

test('a keyed toast is updated in place instead of stacking copies', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const box = new FakeEl('div');
  const stack = createToastStack(box, { max: 2, textTime: () => 1 });
  stack.show('Подсказка: 3,3 с', { key: 'sample' });
  t.mock.timers.tick(2000);
  stack.show('Подсказка: 6,6 с', { key: 'sample', duration: 6600 });
  assert.equal(box.children.length, 1);
  assert.match(box.children[0].textContent, /6,6/);
  t.mock.timers.tick(6000);
  assert.deepEqual(texts(box), ['Подсказка: 6,6 с'], 'the timer restarted with the new lifetime');
  t.mock.timers.tick(700);
  assert.deepEqual(texts(box), []);
});

test('the queue is bounded (stale toasts are dropped, never shown late in bulk)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const box = new FakeEl('div');
  const stack = createToastStack(box, { max: 1, textTime: () => 1 });
  for (let i = 0; i < 20; i++) stack.show(`t${i}`);
  assert.ok(stack.queued.length <= 6);
  assert.equal(stack.queued[stack.queued.length - 1], 't19', 'the newest is kept');
});
