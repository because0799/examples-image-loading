// Main-thread client for the battle AI. With a Worker (running ./worker.js) the search never blocks the
// UI; without one it falls back to computing in-thread after yielding a frame.
//
//   const ai = new RpgAIClient({ worker });            // or new RpgAIClient() for in-thread
//   const action = await ai.choose(state, { difficulty: 'normal', seed });   // null if cancelled
//   ai.cancel(); ai.dispose();

import { handleMessage } from './worker.js';

export class RpgAIClient {
  constructor({ worker = null } = {}) {
    this.worker = worker;
    this.seq = 0;
    this.pending = new Map();
    if (worker) {
      worker.onmessage = (e) => {
        const msg = e.data || {};
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(msg.action);
      };
      worker.onerror = (err) => {
        for (const p of this.pending.values()) p.reject(err instanceof Error ? err : new Error(String(err && err.message)));
        this.pending.clear();
      };
    }
  }

  /** Next action for the side to act (Promise). Resolves null when cancelled. */
  choose(state, opts = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      if (this.worker) {
        this.worker.postMessage({ id, state, opts });
        return;
      }
      setTimeout(() => {
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        const res = handleMessage({ id, state, opts });
        if (res.error) p.reject(new Error(res.error));
        else p.resolve(res.action);
      }, 0);
    });
  }

  /** Abort every pending request: their promises resolve null. */
  cancel() {
    for (const p of this.pending.values()) p.resolve(null);
    this.pending.clear();
  }

  dispose() {
    this.cancel();
    if (this.worker && this.worker.terminate) this.worker.terminate();
    this.worker = null;
  }
}
