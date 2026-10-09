// AI Web Worker entry. Bundled separately by tools/build-web.mjs and injected into app.js as
// the string constant __AI_WORKER_SRC__ (started from a Blob URL by AIClient).
//
// Protocol (main → worker):
//   { type: 'think',  id, state: serializeState(state), opts: { level, timeMs, maxDepth, historyHashes, seed, newGame } }
//   { type: 'reset' }                       forget the transposition table / history (new game)
//   { type: 'config', opts: { ttBits } }    resize the transposition table
//   { type: 'ping', id }
// Worker → main:
//   { type: 'ready' }                       posted once the script has loaded
//   { type: 'result', id, result }          result of search(): { path, score, depth, nodes, timeMs, ... }
//   { type: 'error', id, message }          the request failed (the client falls back to in-thread)
//   { type: 'pong', id }

import { deserializeState } from '../engine/index.js';
import { search, resetSearch, configureSearch } from './search.js';

const scope = typeof self !== 'undefined' ? self : globalThis;

scope.onmessage = (e) => {
  const msg = (e && e.data) || {};
  try {
    switch (msg.type) {
      case 'think': {
        const state = deserializeState(msg.state);
        const result = search(state, msg.opts || {});
        scope.postMessage({ type: 'result', id: msg.id, result });
        break;
      }
      case 'reset':
        resetSearch();
        break;
      case 'config':
        configureSearch(msg.opts || {});
        break;
      case 'ping':
        scope.postMessage({ type: 'pong', id: msg.id });
        break;
      default:
        break;
    }
  } catch (err) {
    scope.postMessage({ type: 'error', id: msg.id, message: String((err && err.message) || err) });
  }
};

scope.postMessage({ type: 'ready' });
