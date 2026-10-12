// Web Worker entry for the «Валькирии доски» battle AI (GDD §10: the AI runs off the main thread).
// Bundle it separately (like src/ai/worker.js) and talk to it through RpgAIClient (./client.js).
//
//   worker.postMessage({ id, state, opts: { difficulty, seed } })
//   → { id, action, ms }   or   { id, error }

import { chooseAction } from './index.js';

/** Pure message handler (also used by tests and by the in-thread fallback). */
export function handleMessage(data) {
  const { id, state, opts } = data || {};
  const t0 = Date.now();
  try {
    const action = chooseAction(state, opts || {});
    return { id, action, ms: Date.now() - t0 };
  } catch (err) {
    return { id, error: String((err && err.message) || err) };
  }
}

const scope = typeof self !== 'undefined' ? self : null;
if (scope && typeof scope.postMessage === 'function' && typeof scope.document === 'undefined' && typeof window === 'undefined') {
  scope.onmessage = (e) => scope.postMessage(handleMessage(e.data));
}
