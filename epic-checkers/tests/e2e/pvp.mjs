#!/usr/bin/env node
// Two players on one phone: moves for both sides by tapping, the board never flips, one-ply undo,
// draw offer declined (game goes on) and accepted (game over by agreement).
//
//   node tests/e2e/pvp.mjs [--variant russian] [--epic 1] [--shots DIR]

import fs from 'node:fs';
import path from 'node:path';
import { startServer, launchBrowser, newPage, waitApp, appState, waitState, tapSquare, sleep, assert, reporter } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const variant = opt('--variant', 'russian');
const epic = opt('--epic', '1') !== '0';
const shotDir = opt('--shots', null);
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });

const R = reporter(`pvp(${variant}, ${epic ? 'epic' : 'classic'})`);
const srv = await startServer();
const browser = await launchBrowser();
const { page, log } = await newPage(browser, { width: 390, height: 844, dpr: 1 });
const shot = async (name) => shotDir && page.screenshot({ path: path.join(shotDir, `${name}.png`) });

async function tapMove(p) {
  for (const sq of p) {
    const st = await appState(page);
    if (st.phase !== 'human') break;
    await tapSquare(page, sq);
    await sleep(120);
  }
}

try {
  await R.step('start pvp game', async () => {
    await page.goto(srv.url(`?debug=1&screen=game&mode=pvp&variant=${variant}&epic=${epic ? 1 : 0}&speed=2`));
    await waitApp(page);
    const st = await waitState(page, "s.phase === 'human'", 60000);
    assert(st.mode === 'pvp' && st.bottomColor === 1, 'pvp, white at the bottom');
  });

  await R.step('six plies tapped by both sides, board stays oriented', async () => {
    for (let i = 0; i < 6; i++) {
      const st = await waitState(page, "s.phase === 'human' || !!s.result", 30000);
      if (st.result) break;
      const before = st.ply;
      // prefer a move of the piece nearest the centre for some variety
      await tapMove(st.legal[st.legal.length >> 1]);
      await waitState(page, `s.ply === ${before + 1} && (s.phase === 'human' || !!s.result)`, 30000);
      const flipped = await page.evaluate(() => window.__app.renderer.flipped);
      assert(flipped === false, 'board not flipped');
    }
    const st = await appState(page);
    assert(st.ply === 6, `ply ${st.ply}`);
    const hudBottom = await page.evaluate(() => window.__app.ui.hud.state.bottomColor);
    assert(hudBottom === 1, 'HUD bottom = white');
    await shot('pvp-midgame');
  });

  await R.step('undo takes back exactly one ply', async () => {
    const st0 = await appState(page);
    await page.click('[data-act="hud.undo"]');
    const st = await waitState(page, `s.ply === ${st0.ply - 1} && s.phase === 'human'`, 20000);
    assert(st.turn === -st0.turn, 'side to move switched back');
    assert(st.mismatches === 0, 'in sync');
  });

  await R.step('draw offer declined → game continues', async () => {
    await page.click('[data-act="hud.menu"]');
    await page.waitForSelector('.ov--pause');
    await sleep(300);
    await page.getByRole('button', { name: 'Предложить ничью' }).first().click();
    await page.waitForSelector('.ov--confirm');
    await sleep(300);
    await page.click('.ov--confirm .dlg__btns button >> nth=0'); // decline
    await sleep(800);
    const st = await appState(page);
    assert(!st.result && st.phase === 'human' && !st.paused, `continues ${JSON.stringify({ r: st.result, p: st.phase, paused: st.paused })}`);
  });

  await R.step('draw offer accepted → game over (agreement)', async () => {
    await page.click('[data-act="hud.menu"]');
    await page.waitForSelector('.ov--pause');
    await sleep(300);
    await page.getByRole('button', { name: 'Предложить ничью' }).first().click();
    await page.waitForSelector('.ov--confirm');
    await sleep(300);
    await page.click('.ov--confirm .dlg__btns button >> nth=1'); // accept
    await page.waitForSelector('.ov--gameover', { timeout: 30000 });
    const st = await appState(page);
    assert(st.result && st.result.winner === 0 && st.result.reason === 'agreement', `result ${JSON.stringify(st.result)}`);
    await sleep(1200);
    await shot('pvp-draw');
  });

  await R.step('game over → menu', async () => {
    await page.getByRole('button', { name: 'В меню' }).first().click();
    await page.waitForSelector('.screen--menu');
    const st = await appState(page);
    assert(!st.active, 'stopped');
  });

  await R.step('no errors', async () => {
    const st = await appState(page);
    assert(log.errors.length === 0, `page errors: ${log.errors.join('\n')}`);
    assert(log.consoleErrors.length === 0, `console errors: ${log.consoleErrors.join('\n')}`);
    assert(st.errors.length === 0 && st.mismatches === 0, 'controller clean');
  });
} finally {
  await browser.close();
  await srv.close();
}
process.exit(R.done() ? 1 : 0);
