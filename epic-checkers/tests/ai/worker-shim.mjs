// Runs src/ai/worker.js inside a Node worker thread with a minimal Web Worker-like global
// (postMessage / onmessage), so client.test.js can exercise the real worker protocol.
import { parentPort } from 'node:worker_threads';

globalThis.postMessage = (msg) => parentPort.postMessage(msg);
parentPort.on('message', (data) => {
  if (typeof globalThis.onmessage === 'function') globalThis.onmessage({ data });
});

await import('../../src/ai/worker.js');
