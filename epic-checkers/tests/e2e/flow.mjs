#!/usr/bin/env node
// Full click-through from the title screen (real taps on DOM buttons and board squares):
//   title → menu → setup (Russian, white, EPIC) → START → human moves tapped square by square
//   (incl. a branching multi-capture entered tap-by-tap and a direct final-destination tap)
//   → AI answers → undo → hint → pause/resume → back button → resign → game over → rematch → menu.
// Asserts zero page errors / console errors and no renderer/state desync.
//
//   node tests/e2e/flow.mjs [--shots DIR] [--epic 0|1]

import path from 'node:path';
import fs from 'node:fs';
import { startServer, launchBrowser, newPage, waitApp, appState, waitState, tapSquare, sleep, assert, reporter } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const shotDir = opt('--shots', null);
const epic = opt('--epic', '1') !== '0';
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });

const R = reporter(`flow(${epic ? 'epic' : 'classic'})`);
const srv = await startServer();
const browser = await launchBrowser();
const { page, log } = await newPage(browser, { width: 390, height: 844, dpr: 1 });
const shot = async (name) => shotDir && page.screenshot({ path: path.join(shotDir, `${name}.png`) });

// Russian 8×8: white man e3 must take d4 and then choose b6 (→ a7) or d6 (→ e7).
const BRANCH_POS = 'w:.......b/......../.b.b..../......../...b..../....w.../......../w.......';
const SQ = { e3: 44, c5: 26, e7: 12, a7: 8 };

/** Plays one legal move for the human by tapping squares (stops when the move auto-completes). */
async function tapMove(pathSq) {
  for (let i = 0; i < pathSq.length; i++) {
    const st = await appState(page);
    if (st.phase !== 'human') break;
    await tapSquare(page, pathSq[i]);
    await sleep(120);
  }
}

try {
  await R.step('boot to title', async () => {
    await page.goto(srv.url('?debug=1'));
    await waitApp(page);
    await page.waitForSelector('.screen--title');
    await sleep(600);
    await shot('01-title');
  });

  await R.step('title → menu', async () => {
    await page.click('.screen--title');
    await page.waitForSelector('.screen--menu');
    await sleep(500);
    if (epic !== (await page.evaluate(() => window.__app.ui.isEpic))) {
      await page.click('.menu__epic button, .menu__epic [role=switch], .menu__epic .epic-toggle');
      await sleep(400);
    }
    assert((await page.evaluate(() => window.__app.ui.isEpic)) === epic, 'epic toggle state');
    await shot('02-menu');
  });

  await R.step('menu → setup (vs AI)', async () => {
    await page.click('.menu__main .btn--primary');
    await page.waitForSelector('.screen--setup');
    await sleep(500);
    await page.click('.vcard[data-id="russian"]');
    await page.click('.seg--color button >> nth=0').catch(() => {});
    await page.click('.lvl__opt[data-n="1"]');
    await sleep(300);
    await shot('03-setup');
  });

  await R.step('START → game, human to move', async () => {
    await page.click('.setup__start');
    // the epic VS intro now holds its texts until they are readable (textTime): give it time
    await waitState(page, "s.active && s.screen === 'game' && s.phase === 'human'", 240000);
    const st = await appState(page);
    assert(st.variantId === 'russian' && st.mode === 'ai' && st.humanColor === 1, `config ${JSON.stringify(st)}`);
    assert(st.epic === epic, 'epic flag');
    await shot('04-game-start');
  });

  await R.step('three tapped moves, AI answers each', async () => {
    for (let n = 0; n < 3; n++) {
      const st = await waitState(page, "s.phase === 'human' || !!s.result", 120000);
      if (st.result) break;
      const before = st.ply;
      // select a piece first (checks the selection highlights), then tap the route
      const mv = st.legal[0];
      await tapMove(mv);
      await waitState(page, `s.ply >= ${before + 2} && s.phase === 'human' || !!s.result`, 120000);
    }
    const st = await appState(page);
    assert(st.ply >= 4, `ply ${st.ply}`);
    assert(st.mismatches === 0, 'no desync');
    await shot('05-after-moves');
  });

  await R.step('selection + illegal tap feedback', async () => {
    const st = await waitState(page, "s.phase === 'human'", 30000);
    const from = st.legal[0][0];
    if (st.selected) {
      // a single forced capturer is auto-selected and stays selected when tapped
      await tapSquare(page, from);
      await sleep(200);
      const s2 = await appState(page);
      assert(s2.selected && s2.selected[0] === from, 'auto-selected piece stays selected');
      return;
    }
    await tapSquare(page, from);
    await sleep(200);
    let s2 = await appState(page);
    assert(s2.selected && s2.selected[0] === from, 'piece selected');
    // an opponent piece is not a target: illegal feedback, selection kept
    const pos = s2.position.split(':')[1].replace(/\//g, '');
    const enemy = [...pos].findIndex((ch) => ch === 'b' || ch === 'B');
    if (enemy >= 0) {
      await tapSquare(page, enemy);
      await sleep(200);
      s2 = await appState(page);
      assert(s2.selected && s2.selected[0] === from && s2.phase === 'human', 'selection kept after illegal tap');
    }
    await tapSquare(page, from); // tap again → deselect
    await sleep(200);
    s2 = await appState(page);
    assert(!s2.selected, 'deselected');
  });

  await R.step('branching multi-capture entered tap-by-tap', async () => {
    await page.evaluate((p) => window.__app.setPosition(p), BRANCH_POS);
    await waitState(page, "s.phase === 'human' && s.ply === 0", 30000);
    let st = await appState(page);
    assert(st.legal.length === 2, `2 capture routes, got ${JSON.stringify(st.legal)}`);
    await tapSquare(page, SQ.e3);
    await sleep(150);
    await tapSquare(page, SQ.c5);
    await sleep(200);
    st = await appState(page);
    assert(st.phase === 'human' && st.selected && st.selected.join() === [SQ.e3, SQ.c5].join(), `partial path ${JSON.stringify(st.selected)}`);
    const hl = await page.evaluate(() => window.__app.renderer.highlights.state);
    assert(hl.capture && hl.targets.length === 2, `capture targets ${JSON.stringify(hl.targets)}`);
    await shot('06-partial-path');
    await tapSquare(page, SQ.e7);
    st = await waitState(page, 's.ply >= 1', 20000);
    const g = await page.evaluate(() => window.__app.game.history[0].move.path);
    assert(g.join() === [SQ.e3, SQ.c5, SQ.e7].join(), `played ${g}`);
    st = await waitState(page, "s.ply >= 2 && s.phase === 'human' || !!s.result", 120000);
    assert(st.stats.captures[1] === 2 && st.stats.maxCombo[1] === 2, `stats ${JSON.stringify(st.stats)}`);
    assert(st.mismatches === 0, 'no desync after combo');
  });

  await R.step('undo returns to the human move before the capture', async () => {
    await page.click('[data-act="hud.undo"]');
    const st = await waitState(page, "s.phase === 'human' && s.ply === 0", 20000);
    assert(st.legal.length === 2 && st.stats.captures[1] === 0, 'undone');
    assert(st.mismatches === 0, 'resynced');
  });

  await R.step('final destination tap commits a unique move', async () => {
    await tapSquare(page, SQ.e3);
    await sleep(150);
    await tapSquare(page, SQ.a7); // skips the intermediate c5 landing
    await waitState(page, 's.ply >= 1', 20000);
    const g = await page.evaluate(() => window.__app.game.history[0].move.path);
    assert(g.join() === [SQ.e3, SQ.c5, SQ.a7].join(), `played ${g}`);
    await waitState(page, "s.phase === 'human' || !!s.result", 120000);
  });

  await R.step('undo again, then hint', async () => {
    let st = await appState(page);
    if (st.canUndo) {
      await page.click('[data-act="hud.undo"]');
      await waitState(page, "s.phase === 'human' && s.ply === 0", 20000);
    }
    await page.click('[data-act="hud.hint"]');
    await page.waitForFunction(() => !!window.__app.renderer.highlights.state.hint, null, { timeout: 20000 });
    const hint = await page.evaluate(() => window.__app.renderer.highlights.state.hint);
    st = await appState(page);
    assert(st.legal.some((p) => p.join() === hint.join()), `hint is legal ${hint}`);
    await shot('07-hint');
  });

  await R.step('pause / resume via HUD menu', async () => {
    await page.click('[data-act="hud.menu"]');
    await page.waitForSelector('.ov--pause');
    let st = await appState(page);
    assert(st.paused, 'controller paused');
    await sleep(500);
    await shot('08-pause');
    await page.click('.ov--pause .pause__resume');
    await sleep(400);
    st = await appState(page);
    assert(!st.paused, 'resumed');
  });

  await R.step('android back opens pause, back again resumes', async () => {
    const handled = await page.evaluate(() => window.__androidBack());
    assert(handled === true, 'back handled');
    await page.waitForSelector('.ov--pause');
    await page.evaluate(() => window.__androidBack());
    await sleep(400);
    assert((await page.locator('.ov--pause.is-open').count()) === 0, 'pause closed');
  });

  await R.step('resign → game over card', async () => {
    await page.click('[data-act="hud.menu"]');
    await page.waitForSelector('.ov--pause');
    await page.getByRole('button', { name: 'Сдаться' }).first().click();
    await page.waitForSelector('.ov--confirm');
    await page.click('.ov--confirm .dlg__btns button >> nth=1');
    await page.waitForSelector('.ov--gameover', { timeout: 180000 }); // after the (readable) finale
    const st = await appState(page);
    assert(st.result && st.result.reason === 'resign' && st.result.winner === -1, `result ${JSON.stringify(st.result)}`);
    await sleep(1500);
    await shot('09-gameover');
  });

  await R.step('rematch starts a fresh game', async () => {
    await page.getByRole('button', { name: 'Реванш' }).first().click();
    const st = await waitState(page, "s.active && s.ply === 0 && (s.phase === 'human' || s.phase === 'intro')", 60000);
    assert(!st.result, 'new game');
    await waitState(page, "s.phase === 'human'", 240000);
  });

  await R.step('pause → menu', async () => {
    await page.click('[data-act="hud.menu"]');
    await page.waitForSelector('.ov--pause');
    await page.getByRole('button', { name: 'В меню' }).first().click();
    await page.waitForSelector('.ov--confirm');
    await page.click('.ov--confirm .dlg__btns button >> nth=1');
    await page.waitForSelector('.screen--menu');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.screen--menu')).opacity === '1', null, { timeout: 15000 });
    const st = await appState(page);
    assert(!st.active && st.screen === 'menu', 'back in menu');
    const worldVisible = await page.evaluate(() => window.__app.renderer.layers.world.visible);
    assert(!worldVisible, 'board hidden in menus');
    await shot('10-menu-again');
  });

  await R.step('no page errors / console errors / desync', async () => {
    const st = await appState(page);
    assert(log.errors.length === 0, `page errors: ${log.errors.join('\n')}`);
    assert(log.consoleErrors.length === 0, `console errors: ${log.consoleErrors.join('\n')}`);
    assert(st.mismatches === 0, 'mismatches');
    assert(st.errors.length === 0, `controller errors: ${st.errors.join('\n')}`);
  });
} finally {
  await browser.close();
  await srv.close();
}
process.exit(R.done() ? 1 : 0);
