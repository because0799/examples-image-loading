// Shared helpers for the Playwright end-to-end scripts (run with plain node, not node --test).
// Serves dist/www on a free port and drives headless Chromium (WebGL via SwiftShader).

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// E2E_WWW=<dir> serves another build (node tools/build-web.mjs --out <dir>) instead of dist/www
export const WWW = process.env.E2E_WWW ? path.resolve(process.env.E2E_WWW) : path.join(ROOT, 'dist/www');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

export async function startServer(root = WWW) {
  if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error(`no build at ${root} — run node tools/build-web.mjs first`);
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, p);
    if (!file.startsWith(root)) return res.writeHead(403).end();
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404).end('not found');
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return { port, url: (q = '') => `http://127.0.0.1:${port}/index.html${q}`, close: () => new Promise((r) => server.close(r)) };
}

export async function launchBrowser() {
  return chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
  });
}

/**
 * New page with error collection. Returns { context, page, log }.
 * log = { errors: [] (pageerror), consoleErrors: [], lines: [] }.
 */
export async function newPage(browser, { width = 390, height = 844, dpr = 1, verbose = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const log = { errors: [], consoleErrors: [], lines: [] };
  page.on('pageerror', (e) => {
    log.errors.push(e.stack || e.message);
    console.log(`  [pageerror] ${e.stack || e.message}`);
  });
  page.on('console', (m) => {
    const line = `[${m.type()}] ${m.text()}`;
    log.lines.push(line);
    if (m.type() === 'error') {
      // resource 404s for optional files are not app errors
      if (/Failed to load resource/.test(m.text())) return;
      log.consoleErrors.push(m.text());
      console.log(`  [console.error] ${m.text().slice(0, 400)}`);
    } else if (verbose) console.log(`  ${line.slice(0, 300)}`);
  });
  return { context, page, log };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitApp(page, timeout = 180000) {
  await page.waitForFunction(() => !!window.__app && !document.getElementById('boot'), null, { timeout });
}

export async function appState(page) {
  return page.evaluate(() => window.__app.state());
}

/** Waits until fn(state) is truthy (state = __app.state()). */
export async function waitState(page, predicateSrc, timeout = 60000, poll = 150) {
  const t0 = Date.now();
  for (;;) {
    const st = await appState(page);
    // eslint-disable-next-line no-new-func
    if (new Function('s', `return (${predicateSrc})`)(st)) return st;
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${predicateSrc}; state: ${JSON.stringify({ phase: st.phase, ply: st.ply, turn: st.turn, busy: st.busy, thinking: st.thinking, screen: st.screen })}`);
    await sleep(poll);
  }
}

/** Screen (CSS px) centre of an engine square. */
export async function squareXY(page, sq) {
  return page.evaluate((s) => {
    const r = window.__app.renderer;
    const c = r.squareCenter(s);
    const p = r.worldToScreen(c.x, c.y);
    const rect = r.app.canvas.getBoundingClientRect();
    return { x: rect.left + p.x, y: rect.top + p.y };
  }, sq);
}

/** Real touch tap on a board square (goes through the canvas pointer handlers). */
export async function tapSquare(page, sq) {
  const { x, y } = await squareXY(page, sq);
  await page.touchscreen.tap(x, y);
}

export async function tapSelector(page, sel) {
  const box = await page.locator(sel).first().boundingBox();
  if (!box) throw new Error(`no box for ${sel}`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

export function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

/** Result tracker for a script: prints PASS/FAIL lines and exits non-zero on failure. */
export function reporter(name) {
  const results = [];
  return {
    async step(label, fn) {
      const t0 = Date.now();
      try {
        const r = await fn();
        results.push({ label, ok: true, ms: Date.now() - t0 });
        console.log(`PASS ${name} › ${label} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
        return r;
      } catch (e) {
        results.push({ label, ok: false, ms: Date.now() - t0, err: e.message });
        console.log(`FAIL ${name} › ${label}: ${e.message}`);
        return undefined;
      }
    },
    results,
    done() {
      const failed = results.filter((r) => !r.ok);
      console.log(`${name}: ${results.length - failed.length}/${results.length} passed`);
      return failed.length;
    },
  };
}
