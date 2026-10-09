// AIClient (in-thread mode in Node, a scripted mock Worker for every failure path), the real
// worker.js protocol (in a Node worker thread) and the AI_LEVELS metadata.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { E, isLegal } from './helpers.js';
import { AIClient, AI_LEVELS } from '../../src/ai/ai-client.js';
import { search } from '../../src/ai/search.js';

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ metadata
test('AI_LEVELS: five levels with ru/en names, epic names and descriptions', () => {
  assert.equal(AI_LEVELS.length, 5);
  AI_LEVELS.forEach((l, i) => {
    assert.equal(l.id, i + 1);
    for (const key of ['name', 'epicName', 'desc']) {
      assert.ok(l[key] && typeof l[key].ru === 'string' && l[key].ru.length > 2, `${key}.ru of level ${l.id}`);
      assert.ok(typeof l[key].en === 'string' && l[key].en.length > 2, `${key}.en of level ${l.id}`);
    }
    assert.ok(l.desc.ru.length <= 90 && l.desc.en.length <= 90, 'short descriptions');
  });
  assert.deepEqual(
    AI_LEVELS.map((l) => l.name.ru),
    ['Новичок', 'Любитель', 'Боец', 'Мастер', 'Гроссмейстер'],
  );
});

// ------------------------------------------------------------------ in-thread (Node has no Worker)
test('AIClient in Node: inline mode, legal moves, hint, serialized states, historyHashes', async () => {
  const ai = new AIClient();
  assert.equal(ai.mode, 'inline');
  const g = new E.Game('turkish');
  const r = await ai.think(g.state, { level: 2, historyHashes: g.hashes });
  assert.ok(r && isLegal(g.state, r.path));
  for (const k of ['score', 'depth', 'nodes', 'timeMs']) assert.ok(Number.isFinite(r[k]), k);
  const h = await ai.hint(g.state, { timeMs: 100 });
  assert.ok(h && isLegal(g.state, h.path));
  // a plain serialized state works too
  const plain = JSON.parse(JSON.stringify(E.serializeState(E.createInitialState('international'))));
  const r2 = await ai.think(plain, { level: 1 });
  assert.ok(isLegal(E.deserializeState(plain), r2.path));
  ai.dispose();
});

test('AIClient: cancel / supersede resolve null, dispose stops everything', async () => {
  const ai = new AIClient();
  const s = E.createInitialState('russian');
  const p1 = ai.think(s, { level: 5 });
  ai.cancel();
  assert.equal(await p1, null, 'cancelled before it started');
  const pa = ai.think(s, { level: 4 });
  const pb = ai.think(s, { level: 1 });
  assert.equal(await pa, null, 'superseded request resolves null');
  assert.ok(isLegal(s, (await pb).path));
  ai.dispose();
  assert.equal(await ai.think(s), null, 'disposed client answers null');
});

test('AIClient in-thread: time-sliced (event loop keeps running) and cancellable mid-search', async () => {
  const ai = new AIClient({ sliceMs: 20 });
  const s = E.createInitialState('international');
  let last = performance.now();
  let maxGap = 0;
  let ticks = 0;
  const iv = setInterval(() => {
    const t = performance.now();
    maxGap = Math.max(maxGap, t - last);
    last = t;
    ticks++;
  }, 2);
  const r = await ai.think(s, { level: 5, timeMs: 600 });
  clearInterval(iv);
  assert.ok(isLegal(s, r.path));
  // A blocking search lets the timer fire at most once before and once after it; with 20 ms
  // slices it fires between slices (~15–30× on an idle machine, fewer when the CPU is shared).
  assert.ok(ticks >= 3, `event loop ran ${ticks} times during the search (longest stall ${maxGap.toFixed(0)} ms)`);
  console.log(`  in-thread search: event loop ran ${ticks}× during 600 ms, longest stall ${maxGap.toFixed(0)} ms`);
  const p = ai.think(s, { level: 5, timeMs: 3000 });
  await tick(60);
  const t0 = performance.now();
  ai.cancel();
  assert.equal(await p, null);
  assert.ok(performance.now() - t0 < 100, 'cancel takes effect at once');
  await tick(80); // the abandoned search stops at its next slice
  const r2 = await ai.think(s, { level: 1 });
  assert.ok(isLegal(s, r2.path));
  ai.dispose();
});

test('AIClient: no legal move → path null; invalid state → rejects', async () => {
  const ai = new AIClient();
  const blocked = E.stateFromString('english', 'w:......../......../......../......../......../..b...../.b....../w.......');
  const r = await ai.think(blocked);
  assert.equal(r.path, null);
  await assert.rejects(() => ai.think(null));
  await assert.rejects(() => ai.think({ variantId: 'nope', board: [] }));
  ai.dispose();
});

// ------------------------------------------------------------------ mock Worker (failure paths)
class MockWorker {
  static mode = 'ok';
  static instances = [];

  constructor(url) {
    this.url = url;
    this.mode = MockWorker.mode;
    this.terminated = false;
    this.received = [];
    this.onmessage = null;
    this.onerror = null;
    MockWorker.instances.push(this);
    setTimeout(() => {
      if (this.terminated) return;
      if (this.mode === 'crash') {
        if (this.onerror) this.onerror({ message: 'failed to load', preventDefault() {} });
        return;
      }
      this._emit({ type: 'ready' });
    }, 0);
  }

  _emit(data) {
    if (!this.terminated && this.onmessage) this.onmessage({ data });
  }

  postMessage(msg) {
    if (this.terminated) throw new Error('posted to a terminated worker');
    this.received.push(msg);
    if (msg.type !== 'think') return;
    assert.ok(Array.isArray(msg.state.board), 'state is serialized for postMessage');
    const answer = () => ({ type: 'result', id: msg.id, result: search(E.deserializeState(msg.state), msg.opts) });
    const delay = this.mode === 'slow' ? 300 : 5;
    setTimeout(() => {
      if (this.terminated) return;
      switch (this.mode) {
        case 'ok':
        case 'slow':
          this._emit(answer());
          break;
        case 'error':
          this._emit({ type: 'error', id: msg.id, message: 'search exploded' });
          break;
        case 'illegal':
          this._emit({ type: 'result', id: msg.id, result: { path: [0, 1, 2], score: 0, depth: 1, nodes: 1, timeMs: 1 } });
          break;
        case 'stale':
          this._emit({ type: 'result', id: msg.id - 1, result: { path: [9, 9], score: 0 } });
          this._emit(answer());
          break;
        case 'silent':
        default:
          break;
      }
    }, delay);
  }

  terminate() {
    this.terminated = true;
  }
}

test('AIClient with a (mock) Web Worker: protocol, fallbacks, cancel, stale answers', async () => {
  const saved = { src: globalThis.__AI_WORKER_SRC__, Worker: globalThis.Worker };
  globalThis.__AI_WORKER_SRC__ = '/* worker source */';
  globalThis.Worker = MockWorker;
  try {
    const { AIClient: WorkerClient } = await import('../../src/ai/ai-client.js?mock-worker');
    const s = E.createInitialState('russian');
    const fresh = (mode, opts) => {
      MockWorker.mode = mode;
      MockWorker.instances = [];
      return new WorkerClient(opts);
    };

    // normal operation
    let ai = fresh('ok');
    assert.equal(ai.mode, 'worker');
    let r = await ai.think(s, { level: 2, historyHashes: [E.hashState(s)] });
    assert.ok(isLegal(s, r.path));
    assert.equal(MockWorker.instances.length, 1);
    const sent = MockWorker.instances[0].received.find((m) => m.type === 'think');
    assert.equal(sent.opts.level, 2);
    assert.deepEqual(sent.opts.historyHashes, [E.hashState(s)]);
    ai.newGame();
    assert.ok(MockWorker.instances[0].received.some((m) => m.type === 'reset'), 'newGame resets the worker');
    ai.dispose();
    assert.ok(MockWorker.instances[0].terminated);

    // worker fails to load → in-thread fallback, permanently
    ai = fresh('crash');
    r = await ai.think(s, { level: 1 });
    assert.ok(isLegal(s, r.path), 'answered in-thread');
    assert.equal(ai.mode, 'inline');
    ai.dispose();

    // the worker reports an error → this request in-thread; after repeated errors → inline mode
    ai = fresh('error');
    r = await ai.think(s, { level: 1 });
    assert.ok(isLegal(s, r.path));
    r = await ai.think(s, { level: 1 });
    assert.ok(isLegal(s, r.path));
    assert.equal(ai.mode, 'inline');
    ai.dispose();

    // an illegal answer is never passed on
    ai = fresh('illegal');
    r = await ai.think(s, { level: 1 });
    assert.ok(isLegal(s, r.path));
    ai.dispose();

    // a silent worker is presumed dead after timeMs + watchdog
    ai = fresh('silent', { watchdogMs: 100 });
    const t0 = Date.now();
    r = await ai.think(s, { level: 1, timeMs: 20 });
    assert.ok(isLegal(s, r.path));
    assert.ok(Date.now() - t0 < 2000);
    ai.dispose();

    // stale answers (wrong id) are ignored
    ai = fresh('stale');
    r = await ai.think(s, { level: 1 });
    assert.ok(isLegal(s, r.path));
    ai.dispose();

    // cancel mid-search: resolves null at once, the busy worker is replaced
    ai = fresh('slow');
    const p = ai.think(s, { level: 2 });
    await tick(30);
    const tc = Date.now();
    ai.cancel();
    assert.equal(await p, null);
    assert.ok(Date.now() - tc < 50);
    assert.ok(MockWorker.instances[0].terminated, 'busy worker terminated');
    r = await ai.think(s, { level: 1 });
    assert.ok(isLegal(s, r.path));
    assert.equal(MockWorker.instances.length, 2, 'a new worker took over');
    // supersede while busy
    const pa = ai.think(s, { level: 3 });
    const pb = ai.think(s, { level: 1 });
    assert.equal(await pa, null);
    assert.ok(isLegal(s, (await pb).path));
    ai.dispose();
  } finally {
    if (saved.src === undefined) delete globalThis.__AI_WORKER_SRC__;
    else globalThis.__AI_WORKER_SRC__ = saved.src;
    if (saved.Worker === undefined) delete globalThis.Worker;
    else globalThis.Worker = saved.Worker;
  }
});

// ------------------------------------------------------------------ real worker.js protocol
test('worker.js protocol (in a Node worker thread): ready, think, error, ping', async () => {
  const w = new NodeWorker(new URL('./worker-shim.mjs', import.meta.url));
  const inbox = [];
  const waiters = [];
  w.on('message', (m) => {
    inbox.push(m);
    for (const f of waiters.splice(0)) f();
  });
  const next = async (pred) => {
    for (let i = 0; i < 400; i++) {
      const idx = inbox.findIndex(pred);
      if (idx >= 0) return inbox.splice(idx, 1)[0];
      await new Promise((r) => {
        waiters.push(r);
        setTimeout(r, 25);
      });
    }
    throw new Error('worker did not answer');
  };
  try {
    await next((m) => m.type === 'ready');
    const s = E.createInitialState('canadian');
    w.postMessage({ type: 'think', id: 7, state: E.serializeState(s), opts: { level: 3, timeMs: 100 } });
    const res = await next((m) => m.id === 7);
    assert.equal(res.type, 'result');
    assert.ok(isLegal(s, res.result.path));
    w.postMessage({ type: 'think', id: 8, state: { variantId: 'nope' }, opts: {} });
    const err = await next((m) => m.id === 8);
    assert.equal(err.type, 'error');
    assert.ok(err.message.length > 0);
    w.postMessage({ type: 'reset' });
    w.postMessage({ type: 'ping', id: 9 });
    assert.equal((await next((m) => m.id === 9)).type, 'pong');
  } finally {
    await w.terminate();
  }
});
