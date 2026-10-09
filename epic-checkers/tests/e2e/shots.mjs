#!/usr/bin/env node
// Screenshots of the game screen in both themes at 390x844, 360x640 and 768x1024 with a real
// mid-game position (generated deterministically by the engine + AI search), plus a layout check:
// the rendered board frame must sit inside the HUD's #board-slot, centred, and must not overlap
// the HUD panels / status / action bar.
//
//   node tests/e2e/shots.mjs [--out DIR] [--variants russian,turkish,international]

import fs from 'node:fs';
import path from 'node:path';
import { Game, stateToString } from '../../src/engine/index.js';
import { search, resetSearch } from '../../src/ai/search.js';
import { startServer, launchBrowser, newPage, waitApp, waitState, appState, tapSquare, sleep, assert, reporter, ROOT } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const out = path.resolve(opt('--out', path.join(ROOT, 'dist/shots/game')));
const variants = opt('--variants', 'russian,turkish,international').split(',');
const viewports = opt('--viewports', '390x844,360x640,768x1024').split(',').map((s) => s.split('x').map(Number));
fs.mkdirSync(out, { recursive: true });

/** Mid-game position: `plies` moves of a deterministic level-2 self-play, white to move. */
function midGame(variantId, plies = 22) {
  resetSearch();
  const g = new Game(variantId);
  for (let i = 0; i < plies && !g.result; i++) {
    const r = search(g.state, { level: 2, maxNodes: 4000, seed: 7 + i, historyHashes: g.hashes });
    if (!r || !r.path) break;
    g.play(r.path);
  }
  if (g.state.turn !== 1 && !g.result) {
    const r = search(g.state, { level: 2, maxNodes: 4000, seed: 99, historyHashes: g.hashes });
    if (r && r.path) g.play(r.path);
  }
  return { str: stateToString(g.state), last: g.lastMove };
}

const R = reporter('shots');
const srv = await startServer();
const browser = await launchBrowser();
const files = [];

try {
  for (const variant of variants) {
    const pos = midGame(variant);
    for (const epic of [false, true]) {
      for (const [w, h] of viewports) {
        const name = `${variant}-${epic ? 'epic' : 'classic'}-${w}x${h}`;
        await R.step(name, async () => {
          const { context, page, log } = await newPage(browser, { width: w, height: h, dpr: 2 });
          try {
            await page.goto(srv.url(`?debug=1&screen=game&mode=ai&variant=${variant}&epic=${epic ? 1 : 0}&color=1&level=3&intro=0&pos=${encodeURIComponent(pos.str)}`));
            await waitApp(page);
            const st = await waitState(page, "s.phase === 'human'", 60000);
            // show selection highlights on a piece that can move
            const mv = st.legal.find((p) => p.length > 2) || st.legal[0];
            await tapSquare(page, mv[0]);
            await sleep(900);
            // layout: board frame inside the slot, centred; no overlap with HUD blocks
            const L = await page.evaluate(() => {
              const r = window.__app.renderer;
              const f = r.frameBounds;
              const a = r.worldToScreen(f.x, f.y);
              const b = r.worldToScreen(f.x + f.width, f.y + f.height);
              const slot = window.__app.ui.boardSlotRect();
              const box = (sel) => {
                const e = document.querySelector(sel);
                if (!e) return null;
                const q = e.getBoundingClientRect();
                return { x: q.x, y: q.y, w: q.width, h: q.height, b: q.bottom, r: q.right };
              };
              return { frame: { x: a.x, y: a.y, r: b.x, b: b.y }, slot: { x: slot.x, y: slot.y, r: slot.right, b: slot.bottom }, top: box('.hp--top'), bottom: box('.hp--bottom'), status: box('.status'), actions: box('.actions') };
            });
            const eps = 1.5;
            assert(L.frame.x >= L.slot.x - eps && L.frame.y >= L.slot.y - eps && L.frame.r <= L.slot.r + eps && L.frame.b <= L.slot.b + eps, `board frame ${JSON.stringify(L.frame)} outside slot ${JSON.stringify(L.slot)}`);
            const cx = (L.frame.x + L.frame.r) / 2 - (L.slot.x + L.slot.r) / 2;
            const cy = (L.frame.y + L.frame.b) / 2 - (L.slot.y + L.slot.b) / 2;
            assert(Math.abs(cx) <= 1.5 && Math.abs(cy) <= 1.5, `board not centred in slot (${cx.toFixed(1)}, ${cy.toFixed(1)})`);
            for (const k of ['top', 'bottom', 'status', 'actions']) {
              const bx = L[k];
              if (!bx || !bx.w) continue;
              const overlap = !(bx.r <= L.frame.x + eps || bx.x >= L.frame.r - eps || bx.b <= L.frame.y + eps || bx.y >= L.frame.b - eps);
              assert(!overlap, `${k} overlaps the board: ${JSON.stringify(bx)} vs ${JSON.stringify(L.frame)}`);
            }
            const file = path.join(out, `${name}.png`);
            await page.screenshot({ path: file });
            files.push(file);
            const s2 = await appState(page);
            assert(log.errors.length === 0 && log.consoleErrors.length === 0, `errors: ${log.errors.concat(log.consoleErrors).join('\n')}`);
            assert(s2.mismatches === 0 && s2.errors.length === 0, 'controller clean');
          } finally {
            await context.close();
          }
        });
      }
    }
  }
} finally {
  await browser.close();
  await srv.close();
}
console.log(files.join('\n'));
process.exit(R.done() ? 1 : 0);
