#!/usr/bin/env node
// «Валькирии доски» — targeting mechanics by real taps (cinematics auto-skipped for speed):
// every ability target shape the HUD has to drive, plus pending relocations and quirk actions.
//   square (Volta / Fuyuka skill, Runa ult: pick empty squares, tap one again to confirm) →
//   Volta's mandatory blink afterwards (pending relocation: tap a highlighted square) →
//   row (Koyuki ult) · cross (Volta ult) · lines (Koyuki skill / Maren ult: one tap per direction) →
//   quirk (Zlata's «Бросок подруги»: an adjacent ally) → jump-shaped skill (Tsubame) when in reach.
// Battles are Training ones started with the same payload the RPG UI emits ('start-battle').
//
//   node tests/e2e/rpg-mechanics.mjs

import { startServer, launchBrowser, newPage, waitApp, sleep, assert, reporter } from './lib.mjs';
import { rpgSnap, waitRpg, waitHumanTurn, tapAction, tapRpgSquare, selection, androidBack, tapText } from './rpg-lib.mjs';

const R = reporter('rpg-mechanics');
const srv = await startServer();
const browser = await launchBrowser();
const { page, log } = await newPage(browser, { width: 390, height: 844 });

const actionsOf = (id) => page.evaluate((u) => window.__app.rpg.debugActions(u), id);
const eventCount = () => page.evaluate(() => (window.__app.rpg.battle ? window.__app.rpg.battle.events.length : 0));
const eventsSince = (n) => page.evaluate((k) => window.__app.rpg.battle.events.slice(k).map((e) => ({ type: e.type, kind: e.kind, unit: e.unit, abilityId: e.abilityId })), n);
const unitOf = async (heroId, side = 1) => (await rpgSnap(page)).battle.units.find((u) => u.heroId === heroId && u.side === side && u.alive);

async function selectUnit(id) {
  const s = await rpgSnap(page);
  const u = s.battle.units.find((x) => x.id === id);
  for (let i = 0; i < 3; i++) {
    await tapRpgSquare(page, u.sq);
    await sleep(350);
    const sel = await selection(page);
    if (sel && sel.unitId === id) return sel;
    await sleep(400);
  }
  throw new Error(`could not select ${id}`);
}

async function settle() {
  await sleep(250);
  await waitRpg(page, 's.battle && (s.battle.over || (!s.battle.busy && !s.viewBusy))', 120000, 200);
}

/** Pending relocation / open activation after an act: pick a square, else end. */
async function finishActivation() {
  for (let i = 0; i < 4; i++) {
    const s = await rpgSnap(page);
    if (!s.battle || s.battle.over || !s.battle.act || s.battle.side !== 1 || !s.battle.waiting) return null;
    const sel = await selection(page);
    if (sel && sel.ua && sel.ua.phase === 'pending' && sel.ua.pending) {
      const p = sel.ua.pending;
      const hl = await page.evaluate(() => window.__app.rpg.view.hl.spec);
      assert(hl && JSON.stringify(hl.moves) === JSON.stringify(p.squares), 'pending squares highlighted');
      if (p.squares.length) {
        const n0 = await eventCount();
        await tapRpgSquare(page, p.squares[0]);
        await settle();
        const ev = await eventsSince(n0);
        assert(ev.some((e) => e.type === 'move'), `relocation move (${ev.map((e) => e.type).join(',')})`);
        return p.kind;
      }
      await tapAction(page, 'wait');
      await settle();
      return `${p.kind}:skipped`;
    }
    await tapAction(page, 'wait'); // «Завершить»
    await settle();
  }
  return null;
}

/** Uses skill / ult / quirk of a heroine through the HUD + board taps. Returns the shape used. */
async function useAbility(heroId, kind) {
  const u = await unitOf(heroId);
  assert(u, `${heroId} on the board`);
  if (kind === 'ult') await page.evaluate((id) => window.__app.rpg.debugFillEnergy(id), u.id);
  const ua = await actionsOf(u.id);
  const info = kind === 'quirk' ? (ua.quirks || []).find((q) => q.ok) : ua[kind];
  if (!info || !info.ok) return null;
  await selectUnit(u.id);
  const n0 = await eventCount();
  await tapAction(page, kind);
  await sleep(350);
  let sel = await selection(page);
  assert(sel.mode === kind, `${kind} mode (${sel.mode})`);
  const ab = kind === 'quirk' ? sel.ua.quirks.find((q) => q.ok) : sel.ua[kind];
  const shape = ab.shape;
  if (sel.pending && sel.pending.self) {
    await tapRpgSquare(page, u.sq);
  } else if (shape === 'single') {
    await tapRpgSquare(page, ab.targets[0]);
  } else if (shape === 'square') {
    const n = Math.max(1, Math.min(ab.pick || 1, ab.targets.length));
    for (let i = 0; i < n; i++) {
      await tapRpgSquare(page, ab.targets[i]);
      await sleep(250);
    }
    await tapRpgSquare(page, ab.targets[0]); // a chosen square again: use it
  } else if (shape === 'lines') {
    const dir = (q) => `${Math.sign((q >> 3) - (u.sq >> 3))},${Math.sign((q & 7) - (u.sq & 7))}`;
    const seen = new Set();
    for (const q of ab.targets) {
      if (seen.has(dir(q))) continue;
      seen.add(dir(q));
      await tapRpgSquare(page, q);
      await sleep(300);
      sel = await selection(page);
      if (sel.pending) break;
    }
    assert(sel.pending, 'directions picked → forecast');
    await tapRpgSquare(page, sel.pending.sq);
  } else if (shape === 'jump') {
    const path = ab.paths[0];
    for (const q of path.slice(1)) {
      await tapRpgSquare(page, q);
      await sleep(300);
      const s = await rpgSnap(page);
      if (s.battle.busy || s.viewBusy || (await eventCount()) > n0) break;
    }
    if ((await eventCount()) === n0) await tapRpgSquare(page, path[path.length - 1]);
  } else {
    await tapRpgSquare(page, ab.targets[0]);
    await sleep(350);
    sel = await selection(page);
    assert(sel.pending, `${shape}: target picked → forecast (pending)`);
    const pv = await page.evaluate(() => window.__app.rpg.view.hl.spec.area.length);
    assert(pv > 0, `${shape}: area highlighted`);
    await tapRpgSquare(page, sel.pending.sq);
  }
  await settle();
  const ev = await eventsSince(n0);
  assert(ev.some((e) => e.type === 'cast' && e.kind === kind && e.unit === u.id), `${heroId} ${kind} (${shape}) cast: ${ev.map((e) => e.type).slice(0, 8).join(',')}`);
  const pending = await finishActivation();
  return { shape, pending };
}

async function startTraining(mine, foes) {
  const squads = { 1: mine.map((heroId) => ({ heroId, level: 12, constellation: 0 })), '-1': foes.map((heroId) => ({ heroId, level: 1, constellation: 0 })) };
  await page.evaluate((sq) => window.__app.rpg.startBattle({ mode: 'training', squads: sq, difficulty: 'easy', bg: 'bg-ash', enemyLevel: 1 }), squads);
  await waitRpg(page, "s.screen === 'battle' && s.battle && s.battle.mode === 'training'", 60000);
  await waitHumanTurn(page);
  await sleep(500);
}

const dist = (a, b) => Math.max(Math.abs((a >> 3) - (b >> 3)), Math.abs((a & 7) - (b & 7)));

/** Nobody could use it this turn: step one of `heroIds` toward the enemy (or wait), end the turn. */
async function advanceToward(heroIds) {
  const s = await rpgSnap(page);
  if (!s.battle || s.battle.over || s.battle.side !== 1 || !s.battle.waiting || !heroIds.length) return;
  const foes = s.battle.units.filter((x) => x.side === -1 && x.alive);
  let best = null;
  for (const hid of heroIds) {
    const u = s.battle.units.find((x) => x.heroId === hid && x.side === 1 && x.alive);
    if (!u) continue;
    const ua = await actionsOf(u.id);
    if (!ua || ua.phase !== 'start') continue;
    for (const to of ua.moves || []) {
      const d = Math.min(...foes.map((f) => dist(to, f.sq)));
      if (!best || d < best.d) best = { u, to, d };
    }
  }
  if (best) {
    await selectUnit(best.u.id);
    await tapRpgSquare(page, best.to);
    await settle();
    await finishActivation();
  } else {
    const u = s.battle.units.find((x) => x.side === 1 && x.alive);
    await selectUnit(u.id);
    await tapAction(page, 'wait');
    await settle();
  }
}

/** Tries `use()` on up to `turns` of our turns, advancing `walkers` between tries. */
async function eachTurn(turns, use, walkers) {
  for (let i = 0; i < turns; i++) {
    if (!(await nextTurn())) return null;
    const r = await use();
    if (r) return r;
    await advanceToward(walkers);
  }
  return null;
}

async function nextTurn() {
  const s = await rpgSnap(page);
  if (s.battle.over) return false;
  await waitHumanTurn(page);
  return !(await rpgSnap(page)).battle.over;
}

const used = {};
try {
  await R.step('boot', async () => {
    await page.goto(srv.url('?debug=1&screen=rpg&fast=1&autoskip=1'));
    await waitApp(page);
    await waitRpg(page, "s.visible && s.screen === 'hub'", 60000);
    await page.evaluate(() => window.__app.rpg.ui._closeOverlays());
  });

  await R.step('square (Volta skill) → mandatory blink (pending relocation)', async () => {
    await startTraining(['volta', 'koyuki', 'runa', 'maren', 'zlata', 'tsubame'], ['vera', 'shio', 'mara', 'iskra', 'torvald', 'falk']);
    const r = await useAbility('volta', 'skill');
    assert(r && r.shape === 'square', `volta skill ${JSON.stringify(r)}`);
    assert(r.pending && /blink|relocate|freeMove/.test(r.pending), `Volta blinked after acting (${r.pending})`);
    used.square = true;
  });

  await R.step('row (Koyuki Ultimate)', async () => {
    assert(await nextTurn(), 'battle goes on');
    const r = await useAbility('koyuki', 'ult');
    assert(r && r.shape === 'row', JSON.stringify(r));
  });

  await R.step('square (Runa Ultimate: stone pillars)', async () => {
    assert(await nextTurn(), 'battle goes on');
    const r = await useAbility('runa', 'ult');
    assert(r && r.shape === 'square', JSON.stringify(r));
  });

  await R.step('cross (Volta Ultimate) → blink', async () => {
    assert(await nextTurn(), 'battle goes on');
    const r = await useAbility('volta', 'ult');
    assert(r && r.shape === 'cross', JSON.stringify(r));
  });

  await R.step('quirk: Zlata «Бросок подруги» (adjacent ally)', async () => {
    // the toss needs an ally diagonally in front of Zlata with room behind her: step one in first
    const prep = async () => {
      const s = await rpgSnap(page);
      const z = s.battle.units.find((x) => x.heroId === 'zlata' && x.side === 1 && x.alive);
      const zr = z.sq >> 3;
      const zc = z.sq & 7;
      const spots = [[zr - 1, zc - 1], [zr - 1, zc + 1]].filter(([r, c]) => r >= 0 && c >= 0 && c < 8).map(([r, c]) => r * 8 + c);
      for (const a of s.battle.units.filter((x) => x.side === 1 && x.alive && x.id !== z.id)) {
        const ua = await actionsOf(a.id);
        const to = ua && ua.phase === 'start' ? (ua.moves || []).find((q) => spots.includes(q)) : undefined;
        if (to === undefined) continue;
        await selectUnit(a.id);
        await tapRpgSquare(page, to);
        await settle();
        await finishActivation();
        return true;
      }
      return false;
    };
    const r = await eachTurn(
      8,
      async () => {
        const q = await useAbility('zlata', 'quirk');
        if (q) return q;
        await prep();
        return null;
      },
      [],
    );
    assert(r && r.shape === 'single', `quirk ${JSON.stringify(r)}`);
  });

  await R.step('lines (Koyuki skill or Maren Ultimate: a tap per direction)', async () => {
    const r = await eachTurn(12, async () => (await useAbility('koyuki', 'skill')) || (await useAbility('maren', 'ult')), ['koyuki', 'maren']);
    assert(r && r.shape === 'lines', `lines ${JSON.stringify(r)}`);
  });

  await R.step('jump-shaped skill (Tsubame) when an enemy is in reach (best effort)', async () => {
    let r = null;
    for (let i = 0; i < 6 && !r; i++) {
      if (!(await nextTurn())) break;
      r = await useAbility('tsubame', 'skill');
      if (!r) {
        // walk Tsubame toward the enemy
        const t = await unitOf('tsubame');
        if (!t) break;
        const ua = await actionsOf(t.id);
        const foes = (await rpgSnap(page)).battle.units.filter((x) => x.side === -1 && x.alive);
        const d = (a, b) => Math.max(Math.abs((a >> 3) - (b >> 3)), Math.abs((a & 7) - (b & 7)));
        const best = (ua.moves || []).sort((a, b) => Math.min(...foes.map((f) => d(a, f.sq))) - Math.min(...foes.map((f) => d(b, f.sq))))[0];
        await selectUnit(t.id);
        if (best != null) {
          await tapRpgSquare(page, best);
          await settle();
          await finishActivation();
        } else {
          await tapAction(page, 'wait');
          await settle();
        }
      }
    }
    console.log(`  Tsubame jump skill: ${r ? 'used' : 'no target came in reach'}`);
  });

  await R.step('leave: surrender → hub', async () => {
    const s = await rpgSnap(page);
    if (s.battle && !s.battle.over) {
      await waitHumanTurn(page);
      await androidBack(page);
      await waitRpg(page, 's.paused');
      await tapText(page, '.rv-ov:not(.is-closing) .rv-pause .rv-btn', 'Сдаться');
      await tapText(page, '.rv-ov:not(.is-closing) .rv-confirm .rv-btn', 'Сдаться');
    }
    await waitRpg(page, "s.screen === 'results'", 60000);
    await tapText(page, '.rv-res__links .rv-btn', 'Штаб');
    await waitRpg(page, "s.screen === 'hub' && !s.battle");
  });

  await R.step('no page errors', async () => {
    const errs = await page.evaluate(() => ({ app: window.__app.errors.slice(), rpg: window.__app.rpg.errors.slice() }));
    assert(log.errors.length === 0, `page errors: ${log.errors.join(' | ')}`);
    assert(errs.app.length === 0 && errs.rpg.length === 0, `errors: ${JSON.stringify(errs)}`);
    assert(log.consoleErrors.length === 0, `console errors: ${log.consoleErrors.join(' | ')}`);
  });
} catch (e) {
  console.log(`FATAL ${e.stack || e.message}`);
  R.results.push({ label: 'fatal', ok: false });
}

await browser.close();
await srv.close();
process.exit(R.done() ? 1 : 0);
