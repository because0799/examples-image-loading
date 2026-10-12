#!/usr/bin/env node
// Headless-Chromium driver for visual checks. Serves dist/ itself on a free port.
//
//   node tools/shot.mjs --path www/index.html?debug=1 --out /tmp/shots \
//        [--viewport 390x844] [--dpr 2] [--wait 1500] [--shots 1] [--interval 250] \
//        [--steps steps.json | --steps-inline '[{"click":[195,600]},{"wait":500},{"shot":"after"}]'] \
//        [--video] [--timeout 60000]
//
// Steps (executed in order after the initial --wait):
//   {"wait": ms}                     sleep (real time)
//   {"click": [x, y]}                mouse click at CSS px
//   {"tap": "css selector"}          click element
//   {"eval": "js expression"}        evaluate in page (awaited); result printed
//   {"waitFor": "js expression"}     poll until truthy (max 20 s)
//   {"shot": "name"}                 screenshot -> <out>/<name>.png
//   {"burst": {"name": "x", "count": 10, "interval": 100}}  screenshot sequence x-00.png ...
// Without --steps, takes --shots screenshots every --interval ms named shot-NN.png.
// Console messages / page errors are printed; exit code 2 if any page error occurred.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const flag = (name) => args.includes(name);

const relPath = opt('--path', 'www/index.html');
const outDir = path.resolve(opt('--out', path.join(ROOT, 'dist/shots')));
const [vw, vh] = opt('--viewport', '390x844').split('x').map(Number);
const dpr = Number(opt('--dpr', '2'));
const waitMs = Number(opt('--wait', '1500'));
const nShots = Number(opt('--shots', '1'));
const interval = Number(opt('--interval', '250'));
const timeout = Number(opt('--timeout', '90000'));
let steps = null;
if (opt('--steps')) steps = JSON.parse(fs.readFileSync(opt('--steps'), 'utf8'));
if (opt('--steps-inline')) steps = JSON.parse(opt('--steps-inline'));

fs.mkdirSync(outDir, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
};
const distRoot = path.join(ROOT, 'dist');
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(distRoot, p);
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404).end('not found');
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const killer = setTimeout(() => {
  console.error(`[shot] global timeout ${timeout} ms`);
  process.exit(3);
}, timeout);

const browser = await chromium.launch({
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const context = await browser.newContext({
  viewport: { width: vw, height: vh },
  deviceScaleFactor: dpr,
  isMobile: true,
  hasTouch: true,
  ...(flag('--video') ? { recordVideo: { dir: outDir, size: { width: vw, height: vh } } } : {}),
});
const page = await context.newPage();
let pageErrors = 0;
page.on('console', (m) => console.log(`[console.${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => {
  pageErrors++;
  console.log(`[pageerror] ${e.stack || e.message}`);
});
const url = `http://127.0.0.1:${port}/${relPath.replace(/^\//, '')}`;
console.log(`[shot] ${url}`);
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(waitMs);

const shot = async (name) => {
  const f = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: f });
  console.log(`[shot] ${f}`);
};

if (steps) {
  for (const s of steps) {
    if (s.wait != null) await page.waitForTimeout(s.wait);
    else if (s.click) await page.mouse.click(s.click[0], s.click[1]);
    else if (s.tap) await page.click(s.tap);
    else if (s.eval) {
      const r = await page.evaluate(`(async () => (${s.eval}))()`);
      console.log(`[eval] ${s.eval.slice(0, 80)} => ${JSON.stringify(r)?.slice(0, 500)}`);
    } else if (s.waitFor) await page.waitForFunction(s.waitFor, null, { timeout: 20000 });
    else if (s.shot) await shot(s.shot);
    else if (s.burst) {
      const { name, count = 10, interval: iv = 100 } = s.burst;
      for (let i = 0; i < count; i++) {
        await shot(`${name}-${String(i).padStart(2, '0')}`);
        await page.waitForTimeout(iv);
      }
    }
  }
} else {
  for (let i = 0; i < nShots; i++) {
    await shot(`shot-${String(i).padStart(2, '0')}`);
    if (i < nShots - 1) await page.waitForTimeout(interval);
  }
}

await context.close();
await browser.close();
server.close();
clearTimeout(killer);
process.exit(pageErrors ? 2 : 0);
