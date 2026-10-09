// AI demo / browser check: creates an AIClient (Web Worker by default, `?worker=0` forces the
// in-thread fallback), runs think() on the start positions of three variants and on a mid-game
// position, and prints every result into the page and the console. While each search runs, a
// timer measures the longest main-thread stall — tiny with the worker, about one time slice
// (~25–30 ms) with the in-thread fallback.
//
//   node tools/build-web.mjs --demo ai-demo
//   node tools/shot.mjs --path dev/ai-demo/index.html --wait 9000 --out /tmp/shots
//   node tools/shot.mjs --path "dev/ai-demo/index.html?worker=0" --wait 9000 --out /tmp/shots

import * as E from '../engine/index.js';
import { AIClient, AI_LEVELS } from '../ai/ai-client.js';
import { evaluateState } from '../ai/search.js';

const params = new URLSearchParams(location.search);
const useWorker = params.get('worker') !== '0';
const level = Math.max(1, Math.min(5, Number(params.get('level')) || 3));

const out = document.getElementById('out');
const statusEl = document.getElementById('status');
const modeEl = document.getElementById('mode');

function log(...args) {
  console.log('[ai-demo]', ...args);
}

function boardText(state) {
  const n = state.size;
  const ch = { 0: '·', 1: 'w', 2: 'W', [-1]: 'b', [-2]: 'B' };
  const v = E.getVariant(state.variantId);
  const rows = [];
  for (let r = 0; r < n; r++) {
    let line = '';
    for (let c = 0; c < n; c++) {
      const code = state.board[r * n + c];
      line += code === 0 && !E.isPlayableSquare(v, r, c) ? '  ' : `${ch[code]} `;
    }
    rows.push(line.trimEnd());
  }
  return rows.join('\n');
}

/** Run a promise while measuring the longest gap between 16 ms timer ticks (main-thread stalls). */
async function measured(promiseFactory) {
  let last = performance.now();
  let maxGap = 0;
  const timer = setInterval(() => {
    const t = performance.now();
    maxGap = Math.max(maxGap, t - last);
    last = t;
  }, 16);
  const t0 = performance.now();
  const value = await promiseFactory();
  const wall = performance.now() - t0;
  clearInterval(timer);
  maxGap = Math.max(maxGap, performance.now() - last);
  return { value, wall, maxGap };
}

function card(title, state, lines, ok) {
  const div = document.createElement('div');
  div.className = 'card';
  const h = document.createElement('h2');
  h.textContent = title;
  const row = document.createElement('div');
  row.className = 'row';
  const pre = document.createElement('pre');
  pre.className = 'board';
  pre.textContent = boardText(state);
  const kv = document.createElement('div');
  kv.className = `kv ${ok ? '' : 'bad'}`;
  kv.textContent = lines.join('\n');
  row.append(pre, kv);
  div.append(h, row);
  out.append(div);
}

/** Mid-game position: 18 plies of seeded pseudo-random play in Russian (same every run). */
function midGame() {
  const g = new E.Game('russian');
  let seed = 20261009;
  for (let i = 0; i < 18 && !g.over; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    const moves = g.moves;
    g.play(moves[(seed >>> 8) % moves.length]);
  }
  return g;
}

async function run() {
  const ai = new AIClient({ useWorker });
  modeEl.innerHTML = `Режим: <span class="mode ${ai.mode}">${ai.mode === 'worker' ? 'WORKER' : 'INLINE'}</span>`;
  log(`mode=${ai.mode} requested useWorker=${useWorker} level=${level} (${AI_LEVELS[level - 1].name.ru} / ${AI_LEVELS[level - 1].epicName.ru})`);

  const jobs = [
    { title: 'Русские — старт', game: new E.Game('russian') },
    { title: 'Турецкие — старт', game: new E.Game('turkish') },
    { title: 'Международные 10×10 — старт', game: new E.Game('international') },
    { title: 'Русские — миттельшпиль', game: midGame() },
    { title: 'Английские, поддавки — старт', game: new E.Game('english', { giveaway: true }) },
  ];

  let allOk = true;
  let maxStall = 0;
  for (const job of jobs) {
    const { game } = job;
    const state = game.state;
    const { value: r, wall, maxGap } = await measured(() => ai.think(state, { level, historyHashes: game.hashes }));
    const legal = r && r.path && E.findMove(E.legalMoves(state), r.path);
    const ok = !!legal;
    allOk = allOk && ok;
    maxStall = Math.max(maxStall, maxGap);
    const moveStr = legal ? E.moveToString(state.variantId, legal) : 'НЕТ ХОДА';
    const lines = [
      `ход: ${moveStr}  ${ok ? '✓ легален' : '✗ НЕЛЕГАЛЕН'}`,
      `оценка: ${r ? r.score : '-'}   глубина: ${r ? r.depth : '-'} (сел. ${r ? r.selDepth : '-'})`,
      `узлы: ${r ? r.nodes : '-'}   ${r ? r.nps : '-'} узл/с`,
      `время поиска: ${r ? r.timeMs : '-'} мс, всего: ${wall.toFixed(0)} мс`,
      `макс. зависание UI: ${maxGap.toFixed(0)} мс`,
      `PV: ${r && r.pv ? r.pv.join(' ') : ''}`,
      `статическая оценка (белые): ${evaluateState(state)}`,
    ];
    card(job.title, state, lines, ok);
    log(
      `${state.variantId}${state.options.giveaway ? '+giveaway' : ''} ply=${state.ply} move=${moveStr} legal=${ok} score=${r && r.score} depth=${r && r.depth} nodes=${r && r.nodes} nps=${r && r.nps} searchMs=${r && r.timeMs} wallMs=${wall.toFixed(0)} uiStallMs=${maxGap.toFixed(0)} pv=${r && r.pv ? r.pv.join(' ') : ''}`,
    );
  }

  // cancel(): the cancelled / superseded promise resolves null and the next request still works;
  // a running search is aborted (worker: replaced; in-thread: stops at the next time slice).
  const g = new E.Game('canadian');
  const p0 = ai.think(g.state, { level: 5, timeMs: 2500 });
  ai.cancel();
  const cancelledNow = await p0;
  const t0 = performance.now();
  const p1 = ai.think(g.state, { level: 5, timeMs: 2500 });
  await new Promise((r) => setTimeout(r, 150));
  ai.cancel();
  const cancelledLater = await p1;
  const cancelMs = performance.now() - t0;
  const pa = ai.think(g.state, { level: 4 });
  const superseding = ai.think(g.state, { level: 2 }); // supersedes `pa`
  const superseded = await pa;
  const after = await superseding;
  const cancelOk =
    cancelledNow === null && cancelledLater === null && superseded === null && after && E.findMove(g.moves, after.path);
  allOk = allOk && !!cancelOk;
  log(
    `cancel: immediate=${cancelledNow === null ? 'null' : 'NOT NULL'} mid-search=${cancelledLater === null ? `null after ${cancelMs.toFixed(0)} ms` : 'NOT NULL'} superseded=${superseded === null ? 'null' : 'NOT NULL'} next=${after ? E.moveToString('canadian', E.findMove(g.moves, after.path)) : 'none'} ok=${!!cancelOk}`,
  );

  const summary = `${allOk ? 'OK' : 'FAIL'} · mode=${ai.mode} · max UI stall ${maxStall.toFixed(0)} ms · cancel ${cancelOk ? 'ok' : 'FAIL'}`;
  statusEl.innerHTML = `<span class="${allOk ? 'ok' : 'bad'}">${summary}</span>`;
  log(`AI DEMO DONE ${summary}`);
  ai.dispose();
}

run().catch((err) => {
  statusEl.innerHTML = `<span class="bad">ERROR: ${String(err && err.stack ? err.stack : err)}</span>`;
  console.error('[ai-demo] ERROR', err);
});
