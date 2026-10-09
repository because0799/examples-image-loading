// AIClient: runs the search in a Web Worker (started from the bundled __AI_WORKER_SRC__ via a
// Blob URL) so the UI never blocks, with an automatic in-thread fallback when workers are not
// available, fail to start, crash or stop answering. One request at a time: a new think()/hint()
// supersedes the previous one (whose promise resolves null); stale worker answers are ignored
// by request id. Every returned path is checked against the engine's legal moves.
//
//   const ai = new AIClient();
//   const r = await ai.think(game.state, { level: 3, historyHashes: game.hashes });
//   if (r) game.play(r.path);      // r === null when cancelled / superseded / disposed

import { legalMoves, findMove, serializeState, deserializeState } from '../engine/index.js';
import { search, resetSearch } from './search.js';
import { AI_LEVELS, LEVEL_PARAMS, clampLevel } from './levels.js';

export { AI_LEVELS };

/* global __AI_WORKER_SRC__ */
const WORKER_SRC = typeof __AI_WORKER_SRC__ !== 'undefined' && __AI_WORKER_SRC__ ? __AI_WORKER_SRC__ : '';

const WATCHDOG_EXTRA_MS = 5000; // a worker that has not answered after timeMs + this is presumed dead
const MAX_WORKER_FAILURES = 2;

function toEngineState(state) {
  if (!state || typeof state !== 'object') throw new Error('AIClient: state expected');
  if (state.board instanceof Int8Array && state.counters && Array.isArray(state.counters.eg)) return state;
  return deserializeState(state);
}

export class AIClient {
  /**
   * @param {{ useWorker?: boolean, inlineMaxMs?: number }} [options]
   *   useWorker   try a Web Worker first (default true); falls back to in-thread automatically
   *   inlineMaxMs cap on the thinking time when searching on the main thread (default 2000)
   */
  constructor({ useWorker = true, inlineMaxMs = 2000 } = {}) {
    this._wantWorker = !!useWorker;
    this._inlineMaxMs = inlineMaxMs > 0 ? inlineMaxMs : 2000;
    this._worker = null;
    this._workerUrl = null;
    this._workerReady = false;
    this._workerBusy = false;
    this._workerBroken = false;
    this._failures = 0;
    this._current = null;
    this._seq = 0;
    this._disposed = false;
    /** Result of the last finished request (or null). */
    this.lastResult = null;
  }

  /** 'worker' when requests go to the Web Worker, 'inline' when they run in this thread. */
  get mode() {
    return this._canUseWorker() ? 'worker' : 'inline';
  }

  get busy() {
    return this._current !== null;
  }

  /**
   * Choose a move for the side to move.
   * @returns {Promise<null | { path, score, depth, nodes, timeMs, ... }>} null if cancelled/superseded.
   *   `path` is null only when the side to move has no legal move at all.
   */
  think(state, { level = 3, timeMs, maxDepth, historyHashes = [], seed, newGame } = {}) {
    return this._request(state, { level, timeMs, maxDepth, historyHashes, seed, newGame });
  }

  /** Strong move suggestion for the human (defaults: level 5, 1 s). */
  hint(state, opts = {}) {
    const o = { level: 5, timeMs: 1000, historyHashes: [], ...opts };
    return this._request(state, o);
  }

  /** Forget learned data (transposition table) — call on a new game. */
  newGame() {
    resetSearch();
    if (this._worker && this._workerReady && !this._workerBusy) {
      try {
        this._worker.postMessage({ type: 'reset' });
      } catch (err) {
        /* ignored: the next request recreates the worker if needed */
      }
    }
  }

  /** Abort the current search; its promise resolves null. */
  cancel() {
    const req = this._current;
    if (!req) return;
    this._current = null;
    this._settle(req, null);
    if (this._workerBusy) {
      // The worker cannot be interrupted mid-search: replace it so the next request starts now.
      this._killWorker();
    }
  }

  dispose() {
    this.cancel();
    this._killWorker();
    this._disposed = true;
  }

  // ------------------------------------------------------------------------------- internals

  _canUseWorker() {
    return this._wantWorker && !this._workerBroken && !!WORKER_SRC && typeof Worker !== 'undefined' && typeof Blob !== 'undefined';
  }

  _request(state, opts) {
    if (this._disposed) return Promise.resolve(null);
    let engineState;
    try {
      engineState = toEngineState(state);
    } catch (err) {
      return Promise.reject(err);
    }
    this.cancel();
    const level = clampLevel(opts.level === undefined ? 3 : opts.level);
    const timeMs = Number.isFinite(opts.timeMs) && opts.timeMs > 0 ? opts.timeMs : LEVEL_PARAMS[level].timeMs;
    const payload = {
      level,
      timeMs,
      maxDepth: Number.isFinite(opts.maxDepth) ? opts.maxDepth : undefined,
      historyHashes: Array.isArray(opts.historyHashes) ? opts.historyHashes.filter((h) => typeof h === 'string') : [],
      seed: opts.seed,
      newGame: !!opts.newGame,
    };
    const id = ++this._seq;
    return new Promise((resolve) => {
      const req = { id, resolve, state: engineState, payload, timer: null, done: false };
      this._current = req;
      if (this._ensureWorker()) this._sendToWorker(req);
      else this._runInline(req);
    });
  }

  _ensureWorker() {
    if (!this._canUseWorker()) return false;
    if (this._worker) return true;
    try {
      const blob = new Blob([WORKER_SRC], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      const w = new Worker(url);
      this._worker = w;
      this._workerUrl = url;
      this._workerReady = false;
      this._workerBusy = false;
      w.onmessage = (e) => this._onWorkerMessage(w, e.data);
      w.onerror = (e) => {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        this._onWorkerFailure(w, e && e.message ? e.message : 'worker error');
      };
      w.onmessageerror = () => this._onWorkerFailure(w, 'message error');
      return true;
    } catch (err) {
      this._workerBroken = true;
      this._killWorker();
      return false;
    }
  }

  _sendToWorker(req) {
    const w = this._worker;
    try {
      w.postMessage({ type: 'think', id: req.id, state: serializeState(req.state), opts: req.payload });
    } catch (err) {
      this._onWorkerFailure(w, String(err));
      return;
    }
    this._workerBusy = true;
    req.timer = setTimeout(() => {
      if (req.done || this._current !== req) return;
      this._onWorkerFailure(w, 'timeout');
    }, req.payload.timeMs + WATCHDOG_EXTRA_MS);
  }

  _onWorkerMessage(w, msg) {
    if (w !== this._worker || !msg) return;
    if (msg.type === 'ready') {
      this._workerReady = true;
      this._revokeUrl();
      return;
    }
    if (msg.type !== 'result' && msg.type !== 'error') return;
    this._workerBusy = false;
    const req = this._current;
    if (!req || req.id !== msg.id) return; // stale answer of a superseded request
    if (msg.type === 'error') {
      this._failures++;
      if (this._failures >= MAX_WORKER_FAILURES) this._workerBroken = true;
      this._runInline(req);
      return;
    }
    const result = msg.result;
    if (!this._isValidResult(req.state, result)) {
      this._runInline(req);
      return;
    }
    this._failures = 0;
    this._finish(req, result);
  }

  _onWorkerFailure(w, reason) {
    if (w !== this._worker) return;
    const neverStarted = !this._workerReady;
    this._failures++;
    if (neverStarted || this._failures >= MAX_WORKER_FAILURES) this._workerBroken = true;
    this._killWorker();
    const req = this._current;
    if (req && !req.done) this._runInline(req);
    this.lastError = reason;
  }

  _killWorker() {
    if (this._worker) {
      try {
        this._worker.onmessage = null;
        this._worker.onerror = null;
        this._worker.terminate();
      } catch (err) {
        /* already gone */
      }
    }
    this._worker = null;
    this._workerReady = false;
    this._workerBusy = false;
    this._revokeUrl();
  }

  _revokeUrl() {
    if (this._workerUrl) {
      try {
        URL.revokeObjectURL(this._workerUrl);
      } catch (err) {
        /* ignore */
      }
      this._workerUrl = null;
    }
  }

  _runInline(req) {
    if (req.timer) {
      clearTimeout(req.timer);
      req.timer = null;
    }
    // yield first so the UI can paint the "thinking" state before the synchronous search
    setTimeout(() => {
      if (req.done || this._current !== req) return;
      let result;
      try {
        const payload = { ...req.payload, timeMs: Math.min(req.payload.timeMs, this._inlineMaxMs) };
        result = search(req.state, payload);
      } catch (err) {
        result = this._emergencyMove(req.state, err);
      }
      this._finish(req, result);
    }, 0);
  }

  /** Last-resort answer if the search itself throws: the first legal move. */
  _emergencyMove(state, err) {
    const moves = legalMoves(state);
    return {
      path: moves.length ? moves[0].path.slice() : null,
      score: 0,
      depth: 0,
      nodes: 0,
      timeMs: 0,
      error: String((err && err.message) || err),
    };
  }

  _isValidResult(state, result) {
    if (!result || typeof result !== 'object') return false;
    const moves = legalMoves(state);
    if (moves.length === 0) return result.path === null;
    return Array.isArray(result.path) && findMove(moves, result.path) !== null;
  }

  _finish(req, result) {
    if (req.done) return;
    if (this._current === req) this._current = null;
    if (result) this.lastResult = result;
    this._settle(req, result);
  }

  _settle(req, value) {
    if (req.done) return;
    req.done = true;
    if (req.timer) {
      clearTimeout(req.timer);
      req.timer = null;
    }
    req.resolve(value);
  }
}
