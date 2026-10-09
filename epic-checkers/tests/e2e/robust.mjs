#!/usr/bin/env node
// Robustness: undo while the AI thinks (late AI answer ignored), menu while the AI thinks, double
// game start, rapid random taps, Android back mid-cinematic, rotation / resize mid-game.
//
//   node tests/e2e/robust.mjs

import { startServer, launchBrowser, newPage, waitApp, appState, waitState, tapSquare, sleep, assert, reporter } from './lib.mjs';

const R = reporter('robust');
const srv = await startServer();
const browser = await launchBrowser();
const { page, log } = await newPage(browser, { width: 390, height: 844, dpr: 1 });

async function tapMove(p) {
  for (let i = 0; i < p.length; i++) {
    const st = await appState(page);
    if (st.phase !== 'human') break;
    if (i === 0 && st.selected && st.selected.length === 1 && st.selected[0] === p[0]) continue; // already selected
    await tapSquare(page, p[i]);
    await sleep(100);
  }
}

try {
  await R.step('undo while the AI is thinking; its late answer is ignored', async () => {
    await page.goto(srv.url('?debug=1&screen=game&mode=ai&variant=russian&epic=1&level=5&intro=0&color=1'));
    await waitApp(page);
    let st = await waitState(page, "s.phase === 'human'", 60000);
    await tapMove(st.legal[0]);
    await waitState(page, "s.phase === 'ai' && s.thinking", 30000, 50);
    await page.click('[data-act="hud.undo"]');
    st = await waitState(page, "s.phase === 'human' && s.ply === 0", 10000);
    assert(!st.thinking, 'AI cancelled');
    await sleep(3500); // level 5 thinks ~2.5 s: a stale answer would have arrived by now
    st = await appState(page);
    assert(st.ply === 0 && st.phase === 'human', `stale AI move ignored (ply ${st.ply})`);
  });

  await R.step('menu while the AI is thinking', async () => {
    let st = await appState(page);
    await tapMove(st.legal[0]);
    await waitState(page, "s.phase === 'ai'", 30000, 50);
    await page.click('[data-act="hud.menu"]');
    await page.waitForSelector('.ov--pause');
    await sleep(300);
    await page.getByRole('button', { name: 'В меню' }).first().click();
    await page.waitForSelector('.ov--confirm');
    await sleep(300);
    await page.click('.ov--confirm .dlg__btns button >> nth=1');
    await page.waitForSelector('.screen--menu');
    await sleep(3500);
    st = await appState(page);
    assert(!st.active && st.ply === 1, `no AI move after leaving (ply ${st.ply}, active ${st.active})`);
    const vis = await page.evaluate(() => window.__app.renderer.layers.world.visible);
    assert(!vis, 'board hidden');
  });

  await R.step('double start: only the second game runs', async () => {
    await page.evaluate(() => {
      window.__app.startGame({ variantId: 'turkish', mode: 'demo', level: 1, epic: true });
      window.__app.startGame({ variantId: 'international', mode: 'demo', level: 1, epic: false });
    });
    const st = await waitState(page, 's.ply >= 6', 120000);
    assert(st.variantId === 'international' && !st.epic, 'second config wins');
    const size = await page.evaluate(() => window.__app.renderer.variant.size);
    assert(size === 10, 'renderer shows the 10x10 board');
    assert(st.mismatches === 0, 'no desync');
  });

  await R.step('Android back mid-cinematic → pause, resume continues', async () => {
    await waitState(page, 's.busy', 60000, 30);
    const handled = await page.evaluate(() => window.__androidBack());
    assert(handled, 'handled');
    await page.waitForSelector('.ov--pause');
    let st = await appState(page);
    assert(st.paused, 'paused');
    const ply = st.ply;
    await sleep(2500);
    st = await appState(page);
    assert(st.ply <= ply + 1, `no moves while paused (${ply} → ${st.ply})`);
    await page.evaluate(() => window.__androidBack()); // closes the pause menu (resume)
    await waitState(page, `s.ply >= ${st.ply + 2}`, 60000);
  });

  await R.step('rotation / resize mid-game keeps the board in its slot', async () => {
    for (const [w, h] of [[844, 390], [390, 844], [360, 640], [768, 1024], [390, 844]]) {
      await page.setViewportSize({ width: w, height: h });
      await sleep(700);
    }
    await sleep(800);
    const L = await page.evaluate(() => {
      const r = window.__app.renderer;
      const f = r.frameBounds;
      const slot = window.__app.ui.boardSlotRect();
      return { f, slot: { x: slot.x, y: slot.y, w: slot.width, h: slot.height } };
    });
    assert(L.f.x >= L.slot.x - 1.5 && L.f.y >= L.slot.y - 1.5 && L.f.x + L.f.width <= L.slot.x + L.slot.w + 1.5 && L.f.y + L.f.height <= L.slot.y + L.slot.h + 1.5, `frame ${JSON.stringify(L)}`);
    const st = await appState(page);
    assert(st.mismatches === 0, 'no desync after resizes');
  });

  await R.step('rapid random taps during a human turn', async () => {
    await page.evaluate(() => window.__app.startGame({ variantId: 'russian', mode: 'pvp', epic: true }));
    await waitState(page, "s.phase === 'human'", 60000);
    const taps = [];
    for (let i = 0; i < 40; i++) {
      const sq = Math.floor(Math.random() * 64);
      taps.push(tapSquare(page, sq).catch(() => {}));
      await sleep(15);
    }
    await Promise.all(taps);
    await sleep(1500);
    // play on normally afterwards
    for (let i = 0; i < 4; i++) {
      const st = await waitState(page, "s.phase === 'human' || !!s.result", 30000);
      if (st.result) break;
      await tapMove(st.legal[0]);
      await waitState(page, `s.ply > ${st.ply}`, 30000);
    }
    const st = await appState(page);
    assert(st.mismatches === 0 && st.errors.length === 0, 'clean');
  });

  await R.step('human plays black: flipped board, AI opens, tapped answer', async () => {
    await page.evaluate(() => window.__app.startGame({ variantId: 'english', mode: 'ai', humanColor: -1, level: 1, epic: false }));
    // English: black moves first → the human (black) starts
    let st = await waitState(page, "s.phase === 'human' && s.variantId === 'english'", 60000);
    assert(st.humanColor === -1 && st.bottomColor === -1, 'black at the bottom');
    assert(await page.evaluate(() => window.__app.renderer.flipped), 'renderer flipped');
    await tapMove(st.legal[0]);
    st = await waitState(page, "s.ply >= 2 && s.phase === 'human'", 60000);
    await page.evaluate(() => window.__app.startGame({ variantId: 'russian', mode: 'ai', humanColor: -1, level: 1, epic: true }));
    // Russian: white (AI) opens, then the human answers
    st = await waitState(page, "s.variantId === 'russian' && s.ply === 1 && s.phase === 'human'", 60000);
    await tapMove(st.legal[st.legal.length - 1]);
    st = await waitState(page, "s.ply >= 3 && s.phase === 'human'", 60000);
    assert(st.mismatches === 0, 'in sync');
  });

  await R.step('no page / console errors', async () => {
    assert(log.errors.length === 0, `page errors: ${log.errors.join('\n')}`);
    assert(log.consoleErrors.length === 0, `console errors: ${log.consoleErrors.join('\n')}`);
  });
} finally {
  await browser.close();
  await srv.close();
}
process.exit(R.done() ? 1 : 0);
