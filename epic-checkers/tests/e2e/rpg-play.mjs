#!/usr/bin/env node
// «Валькирии доски» manual play (real taps, cinematics ON, 390×844): a Training battle against the
// easy AI driven only through the board and the HUD —
//   select a heroine (HUD card + board highlights) → move → «Завершить» → enemy turn →
//   attack: a jump-strike chain (landing squares tapped hop by hop) or a basic attack →
//   skill (HUD «Навык»: self-cast area / single target / target + confirm tap) →
//   Ultimate when ready (energy filled through the debug hook; full cut-in cinematic, HUD
//   cinematic mode) → «Ждать» → forecast labels while targeting → pause → surrender → results.
// The planning reads unitActions through window.__app.rpg.debugActions; every action is a tap.
//
//   node tests/e2e/rpg-play.mjs [--shots DIR]

import fs from 'node:fs';
import path from 'node:path';
import { startServer, launchBrowser, newPage, waitApp, sleep, tapSelector, assert, reporter } from './lib.mjs';
import { rpgSnap, waitRpg, tapText, tapWhenVisible, waitHumanTurn, tapAction, tapRpgSquare, selection, androidBack } from './rpg-lib.mjs';

const args = process.argv.slice(2);
const shotsIdx = args.indexOf('--shots');
const SHOTS = shotsIdx >= 0 ? path.resolve(args[shotsIdx + 1]) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

const R = reporter('rpg-play');
const srv = await startServer();
const browser = await launchBrowser();
const { page, log } = await newPage(browser, { width: 390, height: 844 });

const dist = (a, b) => Math.max(Math.abs((a >> 3) - (b >> 3)), Math.abs((a & 7) - (b & 7)));
const actionsOf = (id) => page.evaluate((u) => window.__app.rpg.debugActions(u), id);
const eventsSince = (n) => page.evaluate((k) => window.__app.rpg.battle.events.slice(k).map((e) => ({ type: e.type, kind: e.kind, unit: e.unit, target: e.target, amount: e.amount })), n);
const eventCount = () => page.evaluate(() => (window.__app.rpg.battle ? window.__app.rpg.battle.events.length : 0));

async function myUnits() {
  const s = await rpgSnap(page);
  return { s, mine: s.battle.units.filter((u) => u.side === 1 && u.alive), foes: s.battle.units.filter((u) => u.side === -1 && u.alive) };
}

async function selectUnit(id) {
  const s = await rpgSnap(page);
  const u = s.battle.units.find((x) => x.id === id);
  await tapRpgSquare(page, u.sq);
  await sleep(350);
  let sel = await selection(page);
  if (!sel || sel.unitId !== id) {
    await sleep(500);
    await tapRpgSquare(page, u.sq);
    await sleep(400);
    sel = await selection(page);
  }
  assert(sel && sel.unitId === id, `selected ${id} (got ${sel && sel.unitId})`);
  return sel;
}

/** Waits for the action to resolve: play done, then either our activation continues or the enemy turn passes. */
async function settle() {
  await sleep(300);
  await waitRpg(page, 's.battle && (s.battle.over || (!s.battle.busy && !s.viewBusy))', 180000, 250);
}

async function endTurnIfOpen() {
  const s = await rpgSnap(page);
  if (s.battle && s.battle.act && s.battle.act.unit && s.battle.side === 1 && !s.battle.over) {
    await tapAction(page, 'wait'); // «Завершить» after a move / «Ждать»
    await settle();
  }
}

try {
  await R.step('boot into the RPG hub, Training vs the easy AI', async () => {
    await page.goto(srv.url('?debug=1&screen=rpg&fast=1'));
    await waitApp(page);
    await waitRpg(page, "s.visible && s.screen === 'hub'", 60000);
    await sleep(400);
    if (await page.locator('.rv-welcome').count()) await androidBack(page);
    await tapText(page, '.rv-tile', 'Тренировка');
    await waitRpg(page, "s.screen === 'training'");
    await tapText(page, '.rv-seg__opt', 'Лёгкий');
    await tapText(page, '.rv-footer .rv-btn', 'В бой!');
    await waitRpg(page, "s.screen === 'battle' && s.battle && s.battle.mode === 'training'", 60000);
    await waitHumanTurn(page);
    await sleep(600);
    await shot(page, '01-start');
  });

  await R.step('select a heroine: HUD card + action bar + board highlights', async () => {
    const { mine } = await myUnits();
    const sel = await selectUnit(mine[0].id);
    assert(sel.ua.phase === 'start', `phase ${sel.ua.phase}`);
    const hud = await page.evaluate(() => ({
      card: document.querySelector('.rv-ucard').classList.contains('is-ally'),
      name: (document.querySelector('.rv-ucard__name') || {}).textContent,
      moveEnabled: !document.querySelector('.rv-act[data-act="move"]').disabled,
      hl: window.__app.rpg.view.hl.spec,
    }));
    assert(hud.card && hud.name, `unit card ${JSON.stringify(hud)}`);
    assert(hud.hl && hud.hl.selected === mine[0].id, 'board shows the selection');
    assert(Array.isArray(hud.hl.moves) && hud.hl.moves.length === sel.ua.moves.length, 'move dots on the board');
    await shot(page, '02-selected');
  });

  await R.step('move toward the enemy → «Завершить» → enemy turn → our turn again', async () => {
    const { mine, foes } = await myUnits();
    let best = null;
    for (const u of mine) {
      const ua = await actionsOf(u.id);
      for (const to of ua.moves || []) {
        const d = Math.min(...foes.map((f) => dist(to, f.sq)));
        if (!best || d < best.d) best = { u, to, d };
      }
    }
    assert(best, 'some heroine can move');
    await selectUnit(best.u.id);
    const n0 = await eventCount();
    await tapRpgSquare(page, best.to);
    await settle();
    const ev = await eventsSince(n0);
    assert(ev.some((e) => e.type === 'move' && e.unit === best.u.id), `move event (${ev.map((e) => e.type).join(',')})`);
    const s = await rpgSnap(page);
    const moved = s.battle.units.find((x) => x.id === best.u.id);
    assert(moved.sq === best.to, `on the target square (${moved.sq} vs ${best.to})`);
    if (s.battle.act && s.battle.act.unit === best.u.id) {
      const sel = await selection(page);
      assert(sel && sel.unitId === best.u.id && sel.ua.phase === 'moved', 'the same heroine stays selected after a move');
      await shot(page, '03-moved');
      await tapAction(page, 'wait'); // «Завершить»
    }
    await waitHumanTurn(page);
    const s2 = await rpgSnap(page);
    assert(s2.battle.round >= 2, `round ${s2.battle.round}`);
  });

  let attacked = false;
  let jumped = false;
  await R.step('attack: jump-strike chain (tapped hop by hop) or a basic attack with forecast', async () => {
    for (let turn = 0; turn < 14 && !(attacked && jumped); turn++) {
      const { mine, foes, s } = await myUnits();
      if (s.battle.over) break;
      let plan = null;
      for (const u of mine) {
        const ua = await actionsOf(u.id);
        if (!ua || !ua.phase) continue;
        if (!jumped && ua.jumps && ua.jumps.length) {
          plan = { kind: 'jump', u, path: ua.jumps.slice().sort((a, b) => b.length - a.length)[0] };
          break;
        }
        if (!attacked && ua.basic && ua.basic.length && !plan) plan = { kind: 'basic', u, target: ua.basic[0] };
      }
      if (plan) {
        await selectUnit(plan.u.id);
        const n0 = await eventCount();
        if (plan.kind === 'jump') {
          // hop by hop: every landing square; the last one strikes (or a repeat tap stops the chain)
          for (const sq of plan.path.slice(1)) {
            await tapRpgSquare(page, sq);
            await sleep(350);
            const st = await rpgSnap(page);
            if (st.battle.busy || st.viewBusy) break;
          }
          let st = await rpgSnap(page);
          if (!st.battle.busy && !st.viewBusy && st.battle.events === n0) {
            await tapRpgSquare(page, plan.path[plan.path.length - 1]); // stop here
          }
          await settle();
          const ev = await eventsSince(n0);
          assert(ev.some((e) => e.type === 'jump'), `jump events (${ev.map((e) => e.type).join(',')})`);
          assert(ev.some((e) => e.type === 'damage'), 'the chain hit');
          jumped = true;
          attacked = true;
          await shot(page, '04-jump');
        } else {
          // forecast labels over the targets before the tap
          const pv = await page.evaluate(() => window.__app.rpg.view._previews.length);
          assert(pv > 0, 'damage forecast shown over the attack targets');
          await shot(page, '04-forecast');
          await tapRpgSquare(page, plan.target);
          await settle();
          const ev = await eventsSince(n0);
          assert(ev.some((e) => e.type === 'cast' && e.kind === 'basic'), `basic attack (${ev.map((e) => e.type).join(',')})`);
          assert(ev.some((e) => e.type === 'damage'), 'the attack hit');
          attacked = true;
        }
        await endTurnIfOpen();
      } else {
        // nobody can attack yet: advance the heroine closest to the enemy, then end
        let best = null;
        for (const u of mine) {
          const ua = await actionsOf(u.id);
          if (!ua || ua.phase !== 'start') continue;
          for (const to of ua.moves || []) {
            const d = Math.min(...foes.map((f) => dist(to, f.sq)));
            if (!best || d < best.d) best = { u, to, d };
          }
        }
        if (!best) {
          await selectUnit(mine[0].id);
          await tapAction(page, 'wait');
        } else {
          await selectUnit(best.u.id);
          await tapRpgSquare(page, best.to);
          await settle();
          await endTurnIfOpen();
        }
      }
      const st = await rpgSnap(page);
      if (st.battle.over) break;
      await waitHumanTurn(page);
    }
    assert(attacked, 'an attack was made by tapping');
    console.log(`  jump chain used: ${jumped}`);
  });

  await R.step('skill through the HUD «Навык» (self area / single target / target + confirm)', async () => {
    let done = false;
    for (let turn = 0; turn < 10 && !done; turn++) {
      const { mine, s } = await myUnits();
      if (s.battle.over) break;
      let pick = null;
      for (const u of mine) {
        const ua = await actionsOf(u.id);
        if (ua && ua.phase && ua.skill && ua.skill.ok) {
          pick = { u, skill: ua.skill };
          break;
        }
      }
      if (!pick) {
        await selectUnit(mine[0].id);
        await tapAction(page, 'wait');
        await waitHumanTurn(page);
        continue;
      }
      await selectUnit(pick.u.id);
      const n0 = await eventCount();
      await tapAction(page, 'skill');
      await sleep(400);
      let sel = await selection(page);
      assert(sel.mode === 'skill', `skill mode (${sel.mode})`);
      if (sel.pending && sel.pending.self) {
        await tapRpgSquare(page, pick.u.sq);
      } else {
        const t = (sel.ua.skill.targets || [])[0];
        assert(t != null, 'a skill target');
        await tapRpgSquare(page, t);
        await sleep(400);
        sel = await selection(page);
        if (sel && sel.pending) {
          await shot(page, '05-skill-confirm');
          await tapRpgSquare(page, sel.pending.sq); // confirm
        }
      }
      await settle();
      const ev = await eventsSince(n0);
      assert(ev.some((e) => e.type === 'cast' && e.kind === 'skill'), `skill cast (${ev.map((e) => e.type).slice(0, 12).join(',')})`);
      done = true;
      await endTurnIfOpen();
      const st = await rpgSnap(page);
      if (!st.battle.over) await waitHumanTurn(page);
    }
    assert(done, 'a skill was used');
  });

  await R.step('Ultimate: energy full → HUD «Вспышка» → target → full cinematic (HUD steps aside)', async () => {
    const { mine } = await myUnits();
    let hero = null;
    for (const u of mine) {
      const ok = await page.evaluate((id) => window.__app.rpg.debugFillEnergy(id), u.id);
      if (!ok) continue;
      const ua = await actionsOf(u.id);
      if (ua && ua.ult && ua.ult.ok) {
        hero = u;
        break;
      }
    }
    assert(hero, 'a heroine with a usable Ultimate');
    await selectUnit(hero.id);
    const btn = await page.evaluate(() => document.querySelector('.rv-act[data-act="ult"]').classList.contains('is-ready'));
    assert(btn, 'the Ultimate button glows when ready');
    const n0 = await eventCount();
    await tapAction(page, 'ult');
    await sleep(400);
    let sel = await selection(page);
    if (sel.pending && sel.pending.self) await tapRpgSquare(page, hero.sq);
    else {
      const t = sel.ua.ult.targets[0];
      await tapRpgSquare(page, t);
      await sleep(400);
      sel = await selection(page);
      if (sel && sel.pending) await tapRpgSquare(page, sel.pending.sq);
    }
    // the cinematic: HUD in cinematic mode at some point, no skipping
    let cine = false;
    const t0 = Date.now();
    for (;;) {
      const st = await rpgSnap(page);
      if (await page.evaluate(() => document.querySelector('.rv-screen--battle').classList.contains('is-cinematic'))) {
        if (!cine) await shot(page, '06-ult-cinematic');
        cine = true;
      }
      if (!st.viewBusy && !st.battle.busy && Date.now() - t0 > 600) break;
      if (Date.now() - t0 > 240000) throw new Error('Ultimate did not finish');
      await sleep(300);
    }
    const ev = await eventsSince(n0);
    assert(ev.some((e) => e.type === 'cast' && e.kind === 'ult'), `ult cast (${ev.map((e) => e.type).slice(0, 10).join(',')})`);
    assert(cine, 'HUD cinematic mode during the Ultimate');
    const s = await rpgSnap(page);
    const u = s.battle.units.find((x) => x.id === hero.id);
    assert(!u.alive || u.energy < u.maxEnergy, `energy spent (${u.energy}/${u.maxEnergy})`);
    console.log(`  Ultimate of ${hero.heroId}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await endTurnIfOpen();
  });

  await R.step('«Ждать» → enemy turn; tap during the enemy cinematic skips it', async () => {
    const s0 = await rpgSnap(page);
    if (s0.battle.over) return;
    await waitHumanTurn(page);
    const { mine } = await myUnits();
    await selectUnit(mine[0].id);
    const n0 = await eventCount();
    await tapAction(page, 'wait');
    // the enemy acts: tap the board while something plays (skip)
    const t0 = Date.now();
    let skipped = false;
    while (Date.now() - t0 < 120000) {
      const st = await rpgSnap(page);
      if (st.battle.over || (st.battle.waiting && st.battle.side === 1 && !st.viewBusy && !st.battle.busy)) break;
      if (st.viewBusy && !skipped) {
        await page.touchscreen.tap(195, 420);
        skipped = true;
      }
      await sleep(200);
    }
    const ev = await eventsSince(n0);
    assert(ev.some((e) => e.type === 'wait' || (e.type === 'energy' && e.kind === undefined)), `wait (${ev.map((e) => e.type).slice(0, 6).join(',')})`);
  });

  await R.step('pause (Android back) → resume → pause → surrender → results → hub', async () => {
    const s0 = await rpgSnap(page);
    if (!s0.battle || s0.battle.over) {
      await waitRpg(page, "s.screen === 'results'", 60000);
    } else {
      await waitHumanTurn(page);
      await androidBack(page);
      await waitRpg(page, 's.paused');
      await tapText(page, '.rv-ov:not(.is-closing) .rv-pause .rv-btn', 'Продолжить');
      await waitRpg(page, '!s.paused');
      await androidBack(page);
      await waitRpg(page, 's.paused');
      await tapText(page, '.rv-ov:not(.is-closing) .rv-pause .rv-btn', 'Сдаться');
      await tapText(page, '.rv-ov:not(.is-closing) .rv-confirm .rv-btn', 'Сдаться');
      await waitRpg(page, "s.screen === 'results'", 60000);
    }
    await shot(page, '07-results');
    await tapText(page, '.rv-res__links .rv-btn', 'Штаб');
    await waitRpg(page, "s.screen === 'hub' && !s.battle");
  });

  await R.step('mid-battle save: app killed (reload) → hub offers «Продолжить» → same battle resumes', async () => {
    await tapText(page, '.rv-tile', 'Тренировка');
    await waitRpg(page, "s.screen === 'training'");
    await tapText(page, '.rv-seg__opt', 'Лёгкий');
    await tapText(page, '.rv-footer .rv-btn', 'В бой!');
    await waitRpg(page, "s.screen === 'battle' && s.battle && s.battle.mode === 'training'", 60000);
    await waitHumanTurn(page);
    await sleep(500);
    const { mine } = await myUnits();
    await selectUnit(mine[0].id);
    await tapAction(page, 'wait');
    await waitHumanTurn(page);
    const before = await rpgSnap(page);
    const saved = await page.evaluate(() => !!localStorage.getItem('ec.rpg.battle.v1'));
    assert(saved, 'battle saved while running');
    // killed in the background: Android pause first (saves), then the process dies
    await page.evaluate(() => window.__androidPause && window.__androidPause());
    await sleep(300);
    await page.reload();
    await waitApp(page);
    await waitRpg(page, "s.visible && s.screen === 'hub'", 60000);
    await page.locator('.rv-confirm').waitFor({ state: 'visible', timeout: 15000 });
    const text = await page.evaluate(() => document.querySelector('.rv-confirm .rv-dlg__text').textContent);
    assert(/тренировка/i.test(text), `resume offer: ${text}`);
    await shot(page, '08-resume-offer');
    await tapText(page, '.rv-ov:not(.is-closing) .rv-confirm .rv-btn', 'Продолжить');
    await waitRpg(page, "s.screen === 'battle' && s.battle && s.battle.waiting", 60000);
    const after = await rpgSnap(page);
    assert(after.battle.round === before.battle.round && after.battle.side === before.battle.side, `round ${before.battle.round} → ${after.battle.round}`);
    const pos = (x) => JSON.stringify(x.battle.units.map((u) => [u.id, u.sq, u.hp]));
    assert(pos(after) === pos(before), 'same positions and HP');
    await androidBack(page);
    await waitRpg(page, 's.paused');
    await tapText(page, '.rv-ov:not(.is-closing) .rv-pause .rv-btn', 'Сдаться');
    await tapText(page, '.rv-ov:not(.is-closing) .rv-confirm .rv-btn', 'Сдаться');
    await waitRpg(page, "s.screen === 'results'", 60000);
    const gone = await page.evaluate(() => !localStorage.getItem('ec.rpg.battle.v1'));
    assert(gone, 'save cleared after the battle');
    await tapText(page, '.rv-res__links .rv-btn', 'Штаб');
    await waitRpg(page, "s.screen === 'hub' && !s.battle");
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
