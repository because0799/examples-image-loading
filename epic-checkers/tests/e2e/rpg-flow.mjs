#!/usr/bin/env node
// «Валькирии доски» end-to-end flow (real taps in headless Chromium, 390×844):
//   classic menu → RPG tile (key art, NEW badge) → hub → first-run grants + welcome sheet →
//   summon ×10 (animation skipped) → collection → hero screen (tabs) → squad (auto + save) →
//   campaign 1-1 stage sheet → battle with «Авто» + ×2 (cinematics skipped with the «Пропустить»
//   chip) to the end → results → rewards saved → «Дальше» opens the unlocked 1-2 →
//   training battle (pause via Android back → surrender) → duel draft + first turns with the
//   «Передай телефон» screen and the flipped board → RPG settings (voice, Ultimate cinematics,
//   damage numbers; persisted in the app's settings blob) → back navigation down to the classic
//   menu → no page errors.
//
//   node tests/e2e/rpg-flow.mjs [--headed] [--shots DIR]

import fs from 'node:fs';
import path from 'node:path';
import { startServer, launchBrowser, newPage, waitApp, sleep, tapSelector, assert, reporter } from './lib.mjs';
import {
  rpgSnap,
  waitRpg,
  tapText,
  tapWhenVisible,
  openRpgFromMenu,
  waitHumanTurn,
  skipUntilIdle,
  tapAction,
  storedProfile,
  storedSettings,
  androidBack,
  selection,
  tapRpgSquare,
} from './rpg-lib.mjs';

const args = process.argv.slice(2);
const shotsIdx = args.indexOf('--shots');
const SHOTS = shotsIdx >= 0 ? path.resolve(args[shotsIdx + 1]) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

const R = reporter('rpg-flow');
const srv = await startServer();
const browser = await launchBrowser();
const { page, log } = await newPage(browser, { width: 390, height: 844 });

try {
  await R.step('boot to the classic menu', async () => {
    await page.goto(srv.url('?debug=1&screen=menu'));
    await waitApp(page);
    await page.locator('.menu-rpg').waitFor({ state: 'visible', timeout: 30000 });
  });

  await R.step('menu tile: key art thumbnail + NEW badge, classic items intact', async () => {
    await page.waitForFunction(() => {
      const i = document.querySelector('.menu-rpg__img');
      return i && i.complete && i.naturalWidth > 0;
    }, null, { timeout: 30000 });
    const info = await page.evaluate(() => ({
      label: document.querySelector('.menu-rpg__label').textContent,
      badge: document.querySelector('.menu-rpg__badge').textContent,
      jp: document.querySelector('.menu-rpg__jp').textContent,
      tiles: document.querySelectorAll('.menu__tiles .tile').length,
      main: document.querySelectorAll('.menu__main .btn').length,
    }));
    assert(/Валькирии доски/i.test(info.label), `label ${info.label}`);
    assert(/Новое/i.test(info.badge), `badge ${info.badge}`);
    assert(info.jp === '盤上戦姫', info.jp);
    assert(info.tiles === 3 && info.main === 3, JSON.stringify(info));
    await shot(page, '01-menu');
  });

  await R.step('open the RPG: hub + first-run grants (starter squad, 3 200 ✦, 5 scrolls) + welcome', async () => {
    await openRpgFromMenu(page);
    const s = await rpgSnap(page);
    assert(s.profile.crystals === 3200, `crystals ${s.profile.crystals}`);
    assert(s.profile.heroes === 6 && s.profile.squad.length === 6, JSON.stringify(s.profile));
    assert(s.profile.squad.includes('akane'), 'Akane in the starter squad');
    await page.locator('.rv-welcome').waitFor({ state: 'visible', timeout: 10000 });
    const hidden = await page.evaluate(() => getComputedStyle(document.querySelector('.ui-screens')).display);
    assert(hidden === 'none', `classic screens hidden under the RPG layer (${hidden})`);
    const saved = await storedProfile(page);
    assert(saved && saved.crystals === 3200 && saved.firstRun === false, 'profile saved, first run done');
    await shot(page, '02-hub-welcome');
  });

  await R.step('welcome → summon ×10 (animation skipped) → results grid → saved', async () => {
    await tapText(page, '.rv-welcome .rv-btn', 'Сначала призыв');
    await waitRpg(page, "s.screen === 'summon'");
    await sleep(500);
    await tapSelector(page, '.rv-btn--crystal, .rv-sum-pull--ten, .rv-summon__ten').catch(async () => {
      await tapText(page, '.rv-btn', '×10');
    });
    await waitRpg(page, 's.summoning', 15000);
    await sleep(600);
    await tapWhenVisible(page, '.rv-sum__skip');
    await page.locator('.rv-sum__grid').waitFor({ state: 'visible', timeout: 20000 });
    const cards = await page.locator('.rv-sum__cell').count();
    assert(cards === 10, `10 cards (${cards})`);
    await shot(page, '03-summon-grid');
    await tapText(page, '.rv-sum__btns .rv-btn', 'Готово');
    await waitRpg(page, '!s.summoning', 15000);
    const s = await rpgSnap(page);
    // 3 200 − 1 600 (+ achievement crystals the pull may unlock, e.g. a first Epic)
    assert(s.profile.crystals >= 1600 && s.profile.crystals < 3200, `crystals after ×10: ${s.profile.crystals}`);
    assert(s.profile.pulls === 10, `pulls ${s.profile.pulls}`);
    const saved = await storedProfile(page);
    assert(saved.crystals === s.profile.crystals && saved.pity.total === 10, 'summon saved');
    const owned = Object.keys(saved.heroes).length;
    assert(owned >= 7, `new heroes owned (${owned})`);
    const rarities = await page.evaluate(() => Object.keys(JSON.parse(JSON.parse(localStorage.getItem('ec.rpg.v1')).body).heroes));
    console.log(`  owned: ${rarities.join(', ')}`);
  });

  await R.step('collection → hero screen (XP scroll, tabs) → back', async () => {
    await androidBack(page);
    await waitRpg(page, "s.screen === 'hub'");
    await tapText(page, '.rv-tile', 'Коллекция');
    await waitRpg(page, "s.screen === 'collection'");
    await page.locator('.rv-card[data-hero="akane"]').first().waitFor({ state: 'visible', timeout: 10000 });
    await tapWhenVisible(page, '.rv-card[data-hero="akane"]');
    await waitRpg(page, "s.screen === 'hero'");
    await sleep(500);
    // «Свиток опыта» → 'use-scroll' → meta.useXpScrolls → saved, the screen re-renders
    const lv0 = await page.evaluate(() => window.__app.rpg.profile.heroes.akane.level);
    const sc0 = await page.evaluate(() => window.__app.rpg.profile.xpScrolls);
    await tapWhenVisible(page, '.rv-hero__scroll');
    await sleep(500);
    const after = await storedProfile(page);
    assert(after.xpScrolls === sc0 - 1, `scroll used (${sc0} → ${after.xpScrolls})`);
    assert(after.heroes.akane.level > lv0, `level up (${lv0} → ${after.heroes.akane.level})`);
    const tabs = page.locator('.rv-hero__seg .rv-seg__opt, .rv-hero__tabs button');
    const n = await tabs.count();
    for (let i = 0; i < n; i++) {
      const box = await tabs.nth(i).boundingBox();
      if (box) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await sleep(250);
    }
    await shot(page, '04-hero');
    await androidBack(page);
    await waitRpg(page, "s.screen === 'collection'");
    await androidBack(page);
    await waitRpg(page, "s.screen === 'hub'");
  });

  await R.step('squad: «Авто» + save', async () => {
    await tapText(page, '.rv-tile', 'Отряд');
    await waitRpg(page, "s.screen === 'squad'");
    await tapText(page, '.rv-btn', 'Авто');
    await sleep(300);
    await tapText(page, '.rv-btn', 'Сохранить');
    await sleep(400);
    const s = await rpgSnap(page);
    assert(s.profile.squad.length === 6, `squad of 6 (${s.profile.squad})`);
    const saved = await storedProfile(page);
    assert(JSON.stringify(saved.squad) === JSON.stringify(s.profile.squad), 'squad saved');
    await androidBack(page);
    await waitRpg(page, "s.screen === 'hub'");
  });

  let crystalsBefore = 0;
  await R.step('campaign 1-1 → stage sheet → «В бой!» → battle screen', async () => {
    crystalsBefore = (await rpgSnap(page)).profile.crystals;
    await tapWhenVisible(page, '.rv-tile--campaign');
    await waitRpg(page, "s.screen === 'campaign'");
    await sleep(600);
    await tapWhenVisible(page, '.rv-node[data-stage="1-1"]');
    await tapWhenVisible(page, '.rv-stage__fight');
    await waitRpg(page, "s.screen === 'battle' && s.battle && s.viewShown", 60000);
    await waitHumanTurn(page, 120000);
    const st = await page.evaluate(() => ({
      world: window.__app.renderer.layers.world.visible,
      occluded: window.__app.renderer.occluded,
      music: window.__app.audio.currentTrack,
    }));
    assert(st.world === true, 'world layer visible in battle');
    assert(st.occluded !== true, 'renderer not occluded in battle');
    await shot(page, '05-battle-start');
  });

  await R.step('battle: «Авто» ON + ×2, skip cinematics to the end → results', async () => {
    await tapSelector(page, '.rv-bt__auto');
    await tapSelector(page, '.rv-bt__chip:not(.rv-bt__auto)');
    const s0 = await rpgSnap(page);
    assert(s0.battle.auto === true, 'auto on');
    const t0 = Date.now();
    let cine = false;
    for (;;) {
      const s = await rpgSnap(page);
      if (s.screen === 'results') break;
      if (Date.now() - t0 > 900000) throw new Error(`battle did not end: ${JSON.stringify(s.battle && { round: s.battle.round, side: s.battle.side })}`);
      if (await page.evaluate(() => document.querySelector('.rv-screen--battle').classList.contains('is-cinematic'))) cine = true;
      if (s.viewBusy) {
        const vis = await page.locator('.rv-bt__skip:not([hidden])').first().isVisible().catch(() => false);
        if (vis) await tapSelector(page, '.rv-bt__skip').catch(() => {});
      }
      await sleep(400);
    }
    console.log(`  battle took ${((Date.now() - t0) / 1000).toFixed(0)} s (ult cinematic seen: ${cine})`);
    await sleep(1200);
    await shot(page, '06-results');
  });

  await R.step('results: rewards saved, 1-2 unlocked, view hidden, renderer restored', async () => {
    const s = await rpgSnap(page);
    const rec = s.profile.campaign['1-1'];
    const st = await page.evaluate(() => ({ world: window.__app.renderer.layers.world.visible, title: document.querySelector('.rv-res__title').textContent }));
    console.log(`  1-1: ${JSON.stringify(rec)}  ${st.title}`);
    assert(!s.viewShown, 'battle view hidden on results');
    assert(st.world === false, 'world layer back to menu state');
    const saved = await storedProfile(page);
    if (rec && rec.cleared) {
      assert(s.profile.crystals > crystalsBefore, `crystals ${crystalsBefore} → ${s.profile.crystals}`);
      assert(saved.campaign['1-1'] && saved.campaign['1-1'].cleared, 'clear saved');
      assert(saved.crystals === s.profile.crystals, 'crystals saved');
      const unlocked = await page.evaluate(() => window.__app.rpg.profile && window.__app.rpg.profile.campaign && true);
      assert(unlocked, 'profile');
    } else throw new Error(`stage 1-1 not won with auto: ${JSON.stringify(rec)}`);
    const battleSave = await page.evaluate(() => localStorage.getItem('ec.rpg.battle.v1'));
    assert(!battleSave, 'mid-battle save cleared after the battle');
  });

  await R.step('«Дальше» → campaign sheet of the unlocked 1-2', async () => {
    await tapSelector(page, '.rv-res__next');
    await waitRpg(page, "s.screen === 'campaign'");
    await page.locator('.rv-stage__fight').waitFor({ state: 'visible', timeout: 10000 });
    const open = await page.evaluate(() => {
      const n = document.querySelector('.rv-node[data-stage="1-2"]');
      return n && n.classList.contains('is-open');
    });
    assert(open, '1-2 node unlocked');
    await shot(page, '07-next-stage');
    await androidBack(page); // sheet / campaign → hub
    await sleep(400);
    if ((await rpgSnap(page)).screen !== 'hub') await androidBack(page);
    await waitRpg(page, "s.screen === 'hub'");
  });

  await R.step('training battle: start, Android back → pause → surrender → results', async () => {
    await tapText(page, '.rv-tile', 'Тренировка');
    await waitRpg(page, "s.screen === 'training'");
    await tapText(page, '.rv-footer .rv-btn', 'В бой!');
    await waitRpg(page, "s.screen === 'battle' && s.battle && s.battle.mode === 'training'", 60000);
    await waitHumanTurn(page, 120000);
    await androidBack(page);
    await waitRpg(page, 's.paused');
    await shot(page, '08-training-pause');
    await tapText(page, '.rv-ov:not(.is-closing) .rv-pause .rv-btn', 'Сдаться');
    await tapText(page, '.rv-ov:not(.is-closing) .rv-confirm .rv-btn', 'Сдаться');
    await waitRpg(page, "s.screen === 'results'", 60000);
    const title = await page.evaluate(() => document.querySelector('.rv-res__title').textContent);
    assert(/ПОРАЖЕНИЕ/i.test(title), title);
    await tapText(page, '.rv-res__links .rv-btn', 'Штаб');
    await waitRpg(page, "s.screen === 'hub' && !s.battle");
  });

  await R.step('duel: draft 12 picks → battle → first turns with «Передай телефон» + flipped board', async () => {
    await tapText(page, '.rv-tile', 'Дуэль');
    await waitRpg(page, "s.screen === 'duel'");
    // pool «Все 24» so both players have enough heroines
    await tapText(page, '.rv-seg__opt', 'Все 24').catch(() => {});
    for (let i = 0; i < 12; i++) {
      const ok = await page.evaluate(() => {
        const c = [...document.querySelectorAll('.rv-duel .rv-card')].find((x) => !x.classList.contains('is-dim') && !x.classList.contains('is-taken'));
        if (!c) return false;
        c.scrollIntoView({ block: 'center' });
        return true;
      });
      assert(ok, `a pick option at step ${i}`);
      const box = await page.evaluate(() => {
        const c = [...document.querySelectorAll('.rv-duel .rv-card')].find((x) => !x.classList.contains('is-dim') && !x.classList.contains('is-taken'));
        const r = c.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await page.touchscreen.tap(box.x, box.y);
      await sleep(200);
    }
    await shot(page, '09-duel-draft');
    await tapText(page, '.rv-btn', 'В бой!');
    await waitRpg(page, "s.screen === 'battle' && s.battle && s.battle.mode === 'duel'", 60000);
    await waitHumanTurn(page, 120000);
    const s1 = await rpgSnap(page);
    const side1 = s1.battle.side;
    const flip1 = await page.evaluate(() => window.__app.rpg.view.flipped);
    assert(flip1 === (side1 === -1), `board faces the player to move (side ${side1}, flipped ${flip1})`);
    // player A: select a heroine and wait
    const mine = s1.battle.units.find((u) => u.side === side1 && u.alive);
    await tapRpgSquare(page, mine.sq);
    await sleep(400);
    let sel = await selection(page);
    if (!sel || sel.unitId !== mine.id) {
      const diag = await page.evaluate((sq) => {
        const r = window.__app.rpg;
        const p = r.squareXY(sq);
        const e = document.elementFromPoint(p.x, p.y);
        const b = r.battle;
        return { p, hit: e ? `${e.tagName}.${e.className}` : null, waiting: b.waiting, busy: b.busy, paused: b.paused, viewBusy: r.view.busy, shown: r.view.shown, sqAt: r.view.sqAt(p.x, p.y) };
      }, mine.sq);
      console.log(`  selection retry: ${JSON.stringify(diag)}`);
      await tapRpgSquare(page, mine.sq);
      await sleep(600);
      sel = await selection(page);
    }
    assert(sel && sel.unitId === mine.id && sel.ua.phase === 'start', `selected ${JSON.stringify(sel && sel.unitId)}`);
    await tapAction(page, 'wait');
    await page.locator('.rv-pass').waitFor({ state: 'visible', timeout: 60000 });
    await shot(page, '10-duel-pass');
    await tapText(page, '.rv-ov:not(.is-closing) .rv-pass .rv-btn', 'готов');
    await waitHumanTurn(page, 60000);
    const s2 = await rpgSnap(page);
    assert(s2.battle.side === -side1, 'the other player acts');
    const flip2 = await page.evaluate(() => window.__app.rpg.view.flipped);
    assert(flip2 === (s2.battle.side === -1), 'board flipped to the other player');
    // player B: move a heroine, then end
    const theirs = s2.battle.units.filter((u) => u.side === s2.battle.side && u.alive);
    let moved = false;
    for (const u of theirs) {
      await tapRpgSquare(page, u.sq);
      await sleep(300);
      const sl = await selection(page);
      if (sl && sl.ua && sl.ua.moves && sl.ua.moves.length) {
        await tapRpgSquare(page, sl.ua.moves[0]);
        await waitRpg(page, 's.battle && s.battle.act && s.battle.act.moved && !s.viewBusy', 60000);
        moved = true;
        break;
      }
    }
    assert(moved, 'player B moved a heroine');
    await tapAction(page, 'wait'); // «Завершить»
    await page.locator('.rv-pass').waitFor({ state: 'visible', timeout: 60000 });
    await tapText(page, '.rv-ov:not(.is-closing) .rv-pass .rv-btn', 'готов');
    await waitHumanTurn(page, 60000);
    await shot(page, '11-duel-turn3');
    // leave: surrender for the player to move
    await androidBack(page);
    await waitRpg(page, 's.paused');
    await tapText(page, '.rv-ov:not(.is-closing) .rv-pause .rv-btn', 'Сдаться');
    await tapText(page, '.rv-ov:not(.is-closing) .rv-confirm .rv-btn', 'Сдаться');
    await waitRpg(page, "s.screen === 'results'", 60000);
    const title = await page.evaluate(() => document.querySelector('.rv-res__title').textContent);
    assert(/Побеждает/i.test(title), title);
    await tapText(page, '.rv-res__links .rv-btn', 'Штаб');
    await waitRpg(page, "s.screen === 'hub' && !s.battle");
  });

  await R.step('hero voice: the hub greeting plays a Japanese line (voice on)', async () => {
    await page.evaluate(() => window.__app.rpg.ui._closeOverlays());
    await tapWhenVisible(page, '.rv-greet');
    let heard = null;
    for (let i = 0; i < 20 && !heard; i++) {
      await sleep(150);
      heard = (await rpgSnap(page)).voice;
    }
    assert(heard && heard.heroId, `a voice line is playing (${JSON.stringify(heard)})`);
    console.log(`  voice: ${heard.heroId}-${heard.event}`);
  });

  await R.step('RPG settings: voice off, Ultimates «Короткая», damage numbers off — live + persisted', async () => {
    await tapWhenVisible(page, '.rv-hub__top .rv-ibtn[aria-label="Настройки режима"]');
    await page.locator('.rv-settings').waitFor({ state: 'visible', timeout: 10000 });
    await shot(page, '12-settings');
    const sw = page.locator('.rv-settings .rv-switch');
    // voice switch (first), damage numbers (second)
    let box = await sw.nth(0).boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await tapText(page, '.rv-settings .rv-seg__opt', 'Короткая');
    box = await sw.nth(1).boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(300);
    const live = await page.evaluate(() => {
      const s = window.__app.settings;
      return { v: s.rpgVoice, c: s.rpgUltCinematic, n: s.rpgDamageNumbers };
    });
    assert(live.v === false && live.c === 'short' && live.n === false, JSON.stringify(live));
    const saved = await storedSettings(page);
    assert(saved.rpgVoice === false && saved.rpgUltCinematic === 'short' && saved.rpgDamageNumbers === false, `saved ${JSON.stringify(saved && { v: saved.rpgVoice, c: saved.rpgUltCinematic, n: saved.rpgDamageNumbers })}`);
    // voice off: the line stops and new ones stay silent (the voice module reads the live object)
    const silent = await page.evaluate(async () => {
      const v = await window.__app.rpg.ui.voice('akane', 'summon', { force: true });
      return { played: v, now: window.__app.rpg.snapshot().voice };
    });
    assert(!silent.played && !silent.now, `voice off is silent (${JSON.stringify(silent)})`);
    // restore
    box = await sw.nth(0).boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await tapText(page, '.rv-settings .rv-seg__opt', 'Полная');
    box = await sw.nth(1).boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(300);
    const back = await storedSettings(page);
    assert(back.rpgVoice === true && back.rpgUltCinematic === 'full' && back.rpgDamageNumbers === true, 'restored');
    await androidBack(page); // closes the sheet
    await sleep(300);
    assert((await rpgSnap(page)).screen === 'hub', 'sheet closed, still on the hub');
  });

  await R.step('back navigation: hub → classic menu; RPG again (no welcome) → «К шашкам»', async () => {
    const handled = await androidBack(page);
    assert(handled === true, 'back handled on the hub');
    await waitRpg(page, '!s.visible', 10000);
    const st = await page.evaluate(() => ({
      screen: window.__app.ui.currentScreen,
      host: document.getElementById('ui').classList.contains('rv-host-active'),
      display: getComputedStyle(document.querySelector('.ui-screens')).display,
      occluded: window.__app.renderer.occluded,
    }));
    assert(st.screen === 'menu' && !st.host && st.display !== 'none', JSON.stringify(st));
    assert(st.occluded !== true, 'renderer presents again');
    await openRpgFromMenu(page);
    const welcome = await page.locator('.rv-welcome').count();
    assert(welcome === 0, 'no welcome on the second visit');
    await tapText(page, '.rv-btn', 'К шашкам');
    await waitRpg(page, '!s.visible', 10000);
    await page.locator('.menu-rpg').waitFor({ state: 'visible', timeout: 10000 });
    await shot(page, '13-back-to-menu');
  });

  await R.step('classic mode still works: quick game start from the menu', async () => {
    await tapText(page, '.menu__main .btn', 'Играть с ИИ');
    await page.waitForFunction(() => window.__app.ui.currentScreen === 'setup', null, { timeout: 15000 });
    await page.evaluate(() => window.__app.startGame({ variantId: 'russian', mode: 'ai', humanColor: 1, level: 1, epic: true }));
    await page.waitForFunction(() => window.__app.ui.currentScreen === 'game' && window.__app.controller.phase === 'human', null, { timeout: 120000 });
    const r = await page.evaluate(() => ({ world: window.__app.renderer.layers.world.visible, board: window.__app.renderer.layers.board.visible, pieces: window.__app.renderer.layers.pieces.visible }));
    assert(r.world && r.board && r.pieces, `classic board visible ${JSON.stringify(r)}`);
  });

  await R.step('no page errors', async () => {
    const errs = await page.evaluate(() => ({ app: window.__app.errors.slice(), rpg: window.__app.rpg.errors.slice() }));
    assert(log.errors.length === 0, `page errors: ${log.errors.join(' | ')}`);
    assert(errs.app.length === 0, `app errors: ${errs.app.join(' | ')}`);
    assert(errs.rpg.length === 0, `rpg errors: ${errs.rpg.join(' | ')}`);
    assert(log.consoleErrors.length === 0, `console errors: ${log.consoleErrors.join(' | ')}`);
  });
} catch (e) {
  console.log(`FATAL ${e.stack || e.message}`);
  R.results.push({ label: 'fatal', ok: false });
}

await browser.close();
await srv.close();
process.exit(R.done() ? 1 : 0);
