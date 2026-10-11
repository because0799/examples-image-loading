#!/usr/bin/env node
// Controller / bootstrap QA fixes in the real app (real taps, headless Chromium):
//   boot watchdog (F3), own combo not skipped by the entry taps (MUX-01), mandatory capture
//   announced (MUX-09), refused taps explained (MUX-02), draw offer vs AI (RO-4/RTR-02),
//   game ending under the pause menu (F1), keep-screen-on (F7), autosave + «Продолжить» (F8),
//   back on the menu (MUX-05), Director lanes + hooks (EAD-15/06/18).
//   (settings + frame budget: tests/e2e/settings-e2e.mjs)
//
//   node tests/e2e/controller-e2e.mjs [--only <step text>]

import { startServer, launchBrowser, newPage, waitApp, appState, waitState, tapSquare, squareXY, sleep, assert, reporter } from './lib.mjs';

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const R0 = reporter('controller');
// --only <text>: run just the steps whose label contains <text>
const R = { ...R0, step: (label, fn) => (!only || label.includes(only) ? R0.step(label, fn) : undefined) };
const srv = await startServer();
const browser = await launchBrowser();
const errorsAll = [];

const game = (q) => srv.url(`?debug=1&screen=game&intro=0&${q}`);
const statusText = (page) => page.evaluate(() => (document.querySelector('.screen--game .status__text') || {}).textContent || '');

async function open(url, opts = {}) {
  const ctx = await newPage(browser, { width: 390, height: 844, dpr: 1, ...opts });
  ctx.page.on('pageerror', (e) => errorsAll.push(e.message));
  if (url) {
    await ctx.page.goto(url);
    await waitApp(ctx.page);
  }
  return ctx;
}

/** The app's own controller text (UI i18n first, then the controller fallbacks). */
const appText = (page, key, params) => page.evaluate(([k, p]) => window.__app.text(k, p), [key, params || null]);

try {
  await R.step('F3: an app.js that cannot be parsed shows the «update WebView» message', async () => {
    const { page, context } = await newPage(browser, { width: 390, height: 844 });
    await page.route('**/app.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'const x = { a: 1 }?.a ?? ;' }));
    await page.goto(srv.url('?debug=1'));
    await page.waitForFunction(() => document.querySelector('#boot.is-error .boot__msg') && document.querySelector('#boot .boot__msg').textContent.length > 20, null, { timeout: 10000 });
    const msg = await page.locator('#boot .boot__msg').textContent();
    assert(/WebView/.test(msg), `message: ${msg}`);
    await context.close();
  });

  await R.step('F3: a start-up that never finishes shows a hint (bar keeps running)', async () => {
    const { page, context } = await newPage(browser, { width: 390, height: 844 });
    await page.route('**/app.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* never boots */' }));
    await page.goto(srv.url('?debug=1&boottimeout=1200'));
    await page.waitForFunction(() => document.querySelector('#boot.is-slow'), null, { timeout: 10000 });
    const msg = await page.locator('#boot .boot__msg').textContent();
    assert(/WebView/.test(msg), `message: ${msg}`);
    await context.close();
  });

  await R.step('F3: a normal boot sets __booted and never shows the watchdog', async () => {
    const { page, context } = await open(srv.url('?debug=1&boottimeout=1'));
    await sleep(500);
    assert(await page.evaluate(() => window.__booted === true), '__booted');
    assert(!(await page.evaluate(() => !!document.querySelector('#boot.is-slow, #boot.is-error'))), 'no watchdog message');
    await context.close();
  });

  await R.step('MUX-01: tapping every landing square of the own triple does not skip it', async () => {
    const POS = 'w:.b.....b/......../.....b../......../.....b../......../...b..../..w...w.';
    const { page, context } = await open(game(`variant=russian&mode=pvp&epic=1&pos=${encodeURIComponent(POS)}`));
    let st = await waitState(page, "s.phase === 'human'", 60000);
    const triple = st.legal.find((p) => p.length === 4);
    assert(triple, `triple in ${JSON.stringify(st.legal)}`);
    await page.evaluate(() => {
      const d = window.__app.director;
      window.__skips = 0;
      const orig = d.skip.bind(d);
      window.__skipLog = [];
      d.skip = () => {
        if (d.busy) {
          window.__skips++;
          window.__skipLog.push(new Error().stack.split('\n').slice(1, 5).join(' < '));
        }
        return orig();
      };
    });
    // the player taps where the squares are at rest (the camera moves during the cinematic); a
    // virtual clock gives every tap a human pace of 0.4 s whatever the load of the test machine
    const spots = [];
    for (const sq of triple) spots.push(await squareXY(page, sq));
    await page.evaluate(() => {
      const c = window.__app.controller;
      let v = performance.now();
      c._now = () => v;
      window.addEventListener('pointerdown', () => (v += 400), true);
    });
    for (const p of spots) {
      await page.touchscreen.tap(p.x, p.y);
      await sleep(150);
    }
    st = await appState(page);
    assert(st.busy, 'the cinematic is still running after the entry taps');
    assert((await page.evaluate(() => window.__skips)) === 0, `not skipped by the entry taps: ${await page.evaluate(() => window.__skipLog.join(' || '))}`);
    // a fresh tap far from the path skips it
    await page.touchscreen.tap(30, 820);
    await sleep(200);
    assert((await page.evaluate(() => window.__skips)) >= 1, 'a fresh tap skips');
    await waitState(page, "s.phase === 'human' && s.ply === 1", 60000);
    await context.close();
  });

  await R.step('MUX-09 / MUX-02: mandatory capture announced; a refused capture explained', async () => {
    const { page, context } = await open(game(`variant=turkish&mode=pvp&epic=0&pos=${encodeURIComponent('w:......../......../.....b../......../.b...b../.w...w../......../........')}`));
    await waitState(page, "s.phase === 'human'", 60000);
    await sleep(300);
    const want = await appText(page, 'status.yourTurnCapture');
    assert((await statusText(page)) === want, `turn status «${await statusText(page)}» vs «${want}»`);
    await tapSquare(page, 41); // b3 can take one piece; f3 must take two
    await sleep(300);
    const max = await appText(page, 'status.mustCaptureMax');
    assert((await statusText(page)) === max, `status «${await statusText(page)}»`);
    await context.close();
  });

  await R.step('RO-4 / RTR-02: «Предложить ничью» against the AI is answered with a toast', async () => {
    const { page, context } = await open(game('variant=russian&mode=ai&color=1&epic=0&fast=1'));
    await waitState(page, "s.phase === 'human'", 60000);
    await page.click('[data-act="hud.menu"]');
    await page.waitForSelector('.ov--pause');
    const btn = page.locator('.ov--pause button', { hasText: /ничью|draw/i }).first();
    assert((await btn.count()) === 1, 'draw offer button in the pause menu vs AI');
    await btn.click();
    await page.waitForFunction(() => /ничь|draw/i.test(Array.from(document.querySelectorAll('.toast__text')).map((n) => n.textContent).join(' ')), null, { timeout: 15000 });
    const st = await appState(page);
    assert(!st.result && st.phase === 'human' && !st.paused, 'declined at move 1, game goes on');
    await context.close();
  });

  await R.step('F1: the game ends under the pause menu; no stale confirm on the card or the menu', async () => {
    const POS = 'w:......../......../......../......../...b..../..w...../......../........';
    const { page, context } = await open(game(`fast=1&variant=russian&mode=ai&color=1&epic=1&pos=${encodeURIComponent(POS)}`));
    await waitState(page, "s.phase === 'human'", 60000);
    const kinds = () => page.evaluate(() => window.__app.ui._overlays.map((o) => o.kind));
    await page.evaluate(() => {
      window.__app.playPath([42, 28]);
      window.__app.ui.openPause();
    });
    await sleep(400);
    await page.locator('.ov--pause button', { hasText: 'Сдаться' }).first().click();
    await page.waitForSelector('.ov--confirm');
    let st = await appState(page);
    assert(st.result && st.result.winner === 1, 'the game is already over (white won)');
    assert(!(await kinds()).includes('gameover'), 'no game-over card under the pause menu');
    await page.click('.ov--confirm .dlg__btns button >> nth=1'); // confirm «Сдаться»: too late, the game is won
    await page.waitForSelector('.ov--gameover', { timeout: 60000 });
    await sleep(600);
    const k2 = await kinds();
    assert(!k2.includes('confirm') && !k2.includes('pause'), `overlays at game over: ${k2}`);
    st = await appState(page);
    assert(st.result.reason === 'no-pieces' && st.result.winner === 1, `result ${JSON.stringify(st.result)}`);
    await page.evaluate(() => window.__androidBack());
    await page.waitForSelector('.screen--menu');
    await sleep(800);
    assert((await kinds()).length === 0, `overlays in the menu: ${await kinds()}`);
    await context.close();
  });

  await R.step('F7: keep-screen-on follows play / pause / menu', async () => {
    const { page, context } = await open(game('variant=russian&mode=pvp&epic=0'));
    await waitState(page, "s.phase === 'human'", 60000);
    assert((await appState(page)).awake, 'awake in a game');
    await page.click('[data-act="hud.menu"]');
    await page.waitForSelector('.ov--pause');
    assert(!(await appState(page)).awake, 'released on the pause menu');
    await page.click('.ov--pause .pause__resume');
    await sleep(300);
    assert((await appState(page)).awake, 'back on');
    await page.evaluate(() => window.__app.controller.stopGame());
    assert(!(await appState(page)).awake, 'released in the menus');
    await context.close();
  });

  await R.step('F8: a game killed mid-way is offered on the next launch and resumes', async () => {
    const { page, context } = await open(game('variant=turkish&mode=ai&color=1&epic=0&fast=1&level=1'));
    let st = await waitState(page, "s.phase === 'human'", 60000);
    await page.evaluate((p) => window.__app.playPath(p), st.legal[0]);
    st = await waitState(page, "s.phase === 'human' && s.ply >= 2", 60000);
    const position = st.position;
    // the WebView is killed and the app restarts on the title screen
    await page.goto(srv.url('?debug=1'));
    await waitApp(page);
    await page.waitForSelector('.ov--confirm', { timeout: 15000 });
    const txt = await page.locator('.ov--confirm').textContent();
    assert(/Турецк/.test(txt), `offer text: ${txt}`);
    await page.click('.ov--confirm .dlg__btns button >> nth=1');
    st = await waitState(page, "s.active && s.phase === 'human'", 60000);
    assert(st.position === position && st.ply === 2 && st.variantId === 'turkish' && st.mode === 'ai', `resumed ${JSON.stringify({ p: st.position, ply: st.ply })}`);
    assert(st.screen === 'game', 'on the game screen');
    // leaving the game abandons the save: no offer on the next launch
    await page.evaluate(() => window.__app.controller.stopGame());
    await page.goto(srv.url('?debug=1'));
    await waitApp(page);
    await sleep(1500);
    assert((await page.locator('.ov--confirm').count()) === 0, 'no offer for an abandoned game');
    await context.close();
  });

  await R.step('MUX-05: Back on the menu warns first, the second press exits', async () => {
    const { page, context } = await open(srv.url('?debug=1&screen=menu'));
    await sleep(600);
    const first = await page.evaluate(() => window.__androidBack());
    const second = await page.evaluate(() => window.__androidBack());
    assert(first === true && second === false, `back: ${first}, ${second}`);
    await sleep(2200);
    assert((await page.evaluate(() => window.__androidBack())) === true, 'armed again after 2 s');
    await context.close();
  });

  await R.step('EAD-15 / EAD-06 / EAD-18: lanes reach the Director, hooks drive the DOM HUD', async () => {
    // an explicit quality: 'auto' may step down to 'low' on the slow headless GPU, and the DOM
    // impact frame is (deliberately) skipped on 'low'
    const { page, context } = await open(game('variant=russian&mode=ai&color=1&epic=1&fast=1&quality=high'));
    await waitState(page, "s.phase === 'human'", 60000);
    await sleep(500);
    const lanes = await page.evaluate(() => window.__app.director.lanes);
    assert(lanes && lanes.top && lanes.bottom && lanes.top.h > 40 && lanes.bottom.h > 40, `lanes ${JSON.stringify(lanes)}`);
    const frame = await page.evaluate(() => window.__app.renderer.frameBounds);
    assert(lanes.top.y + lanes.top.h <= frame.y + 1 && lanes.bottom.y >= frame.y + frame.height - 1, `lanes outside the frame ${JSON.stringify({ lanes, frame })}`);
    const hooks = await page.evaluate(async () => {
      const d = window.__app.director;
      const el = document.querySelector('.screen--game');
      d.hooks.cinematic(true);
      const on = el.classList.contains('is-cinematic');
      d.hooks.cinematic(false);
      const off = el.classList.contains('is-cinematic');
      d.hooks.impact(200);
      const imp = document.getElementById('ui').classList.contains('fx-impact');
      return { on, off, imp };
    });
    assert(hooks.on && !hooks.off && hooks.imp, `hooks ${JSON.stringify(hooks)}`);
    // the lanes follow a resize
    await page.setViewportSize({ width: 412, height: 915 });
    // (layout → 'board-rect' → syncLanes runs on animation frames: slow on a loaded headless GPU)
    await page
      .waitForFunction((y0) => window.__app.director.lanes && window.__app.director.lanes.bottom && window.__app.director.lanes.bottom.y !== y0, lanes.bottom.y, { timeout: 30000, polling: 200 })
      .catch(() => null);
    await sleep(300);
    const [l2, f2] = await page.evaluate(() => [window.__app.director.lanes, window.__app.renderer.frameBounds]);
    assert(l2.top && l2.bottom && l2.bottom.y !== lanes.bottom.y, `lanes not recomputed after resize ${JSON.stringify({ lanes, l2 })}`);
    assert(l2.top.y + l2.top.h <= f2.y + 1 && l2.bottom.y >= f2.y + f2.height - 1, `lanes vs new frame ${JSON.stringify({ l2, f2 })}`);
    await context.close();
  });

  await R.step('no page errors', async () => {
    assert(errorsAll.length === 0, `page errors: ${errorsAll.join('\n')}`);
  });
} finally {
  await browser.close();
  await srv.close();
}
process.exit(R0.done() ? 1 : 0);
