// Shared helpers for the «Валькирии доски» end-to-end scripts (rpg-*.mjs). Built on lib.mjs.

import { sleep, tapSelector } from './lib.mjs';

/** window.__app.rpg.snapshot() */
export function rpgSnap(page) {
  return page.evaluate(() => window.__app.rpg.snapshot());
}

/** Waits until fn(snapshot) is truthy. */
export async function waitRpg(page, predicateSrc, timeout = 60000, poll = 200) {
  const t0 = Date.now();
  for (;;) {
    const s = await rpgSnap(page);
    // eslint-disable-next-line no-new-func
    if (new Function('s', `return (${predicateSrc})`)(s)) return s;
    if (Date.now() - t0 > timeout) {
      const b = s.battle;
      throw new Error(
        `timeout waiting for ${predicateSrc}; rpg: ${JSON.stringify({ screen: s.screen, visible: s.visible, battle: b && { round: b.round, side: b.side, busy: b.busy, waiting: b.waiting, over: b.over, act: b.act }, errors: s.errors })}`,
      );
    }
    await sleep(poll);
  }
}

/** Real touch tap on the first element matching `sel` whose text contains `text`. */
export async function tapText(page, sel, text, { timeout = 15000 } = {}) {
  const loc = page.locator(sel, { hasText: text }).first();
  await loc.waitFor({ state: 'visible', timeout });
  await loc.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
  await sleep(250);
  const box = await loc.boundingBox();
  if (!box) throw new Error(`no box for ${sel} «${text}»`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

/** Tap when visible (waits for it, scrolls it into the middle of its scroller, lets transitions end). */
export async function tapWhenVisible(page, sel, timeout = 15000) {
  const loc = page.locator(sel).first();
  await loc.waitFor({ state: 'visible', timeout });
  await loc.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
  await sleep(450);
  const box = await loc.boundingBox();
  if (!box) throw new Error(`no box for ${sel}`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

/** Screen point of an RPG board square. */
export function rpgSquareXY(page, sq) {
  return page.evaluate((s) => window.__app.rpg.squareXY(s), sq);
}

export async function tapRpgSquare(page, sq) {
  const p = await rpgSquareXY(page, sq);
  await page.touchscreen.tap(p.x, p.y);
}

/** Opens the RPG from the classic menu tile (the menu must be on screen). */
export async function openRpgFromMenu(page) {
  await tapWhenVisible(page, '.menu-rpg');
  await waitRpg(page, "s.visible && s.screen === 'hub'", 60000);
}

/** The player's turn with input enabled (battle.waiting, nothing playing). */
export function waitHumanTurn(page, timeout = 240000) {
  return waitRpg(page, 's.battle && s.battle.waiting && !s.battle.busy && !s.viewBusy && !s.battle.over', timeout, 250);
}

/** Current selection details from the live battle record (unitActions of the selected heroine). */
export function selection(page) {
  return page.evaluate(() => {
    const b = window.__app.rpg.battle;
    if (!b || !b.sel) return null;
    const ua = b.sel.ua;
    const pick = (x) =>
      x
        ? {
            ok: x.ok,
            reason: x.reason,
            shape: x.shape,
            targets: x.targets || [],
            selfCast: !!x.selfCast,
            pick: x.pick,
            paths: x.paths || null,
            id: x.id,
          }
        : null;
    return {
      unitId: b.sel.unitId,
      mode: b.sel.mode,
      prefix: b.sel.prefix || null,
      pending: b.sel.pending ? { sq: b.sel.pending.sq, area: b.sel.pending.area, self: !!b.sel.pending.self } : null,
      ua: ua
        ? {
            phase: ua.phase,
            moves: ua.moves,
            swaps: ua.swaps,
            jumps: ua.jumps,
            basic: ua.basic,
            basicHeal: ua.basicHeal,
            canWait: ua.canWait,
            canEnd: ua.canEnd,
            pending: ua.pending,
            skill: pick(ua.skill),
            ult: pick(ua.ult),
            quirks: (ua.quirks || []).map(pick),
          }
        : null,
    };
  });
}

/** While a cinematic plays, press «Пропустить» (the HUD chip); resolves when idle. */
export async function skipUntilIdle(page, timeout = 60000) {
  const t0 = Date.now();
  for (;;) {
    const s = await rpgSnap(page);
    if (!s.viewBusy) return s;
    if (Date.now() - t0 > timeout) throw new Error('cinematic did not end');
    const vis = await page.locator('.rv-bt__skip:not([hidden])').first().isVisible().catch(() => false);
    if (vis) await tapSelector(page, '.rv-bt__skip').catch(() => {});
    await sleep(300);
  }
}

/** HUD action button by its data-act ('move' | 'attack' | 'skill' | 'ult' | 'quirk' | 'wait'). */
export async function tapAction(page, act) {
  const sel = `.rv-act[data-act="${act}"]`;
  await page.waitForFunction((s) => {
    const b = document.querySelector(s);
    return b && !b.disabled && b.offsetParent !== null;
  }, sel, { timeout: 15000 });
  await tapSelector(page, sel);
}

/** Saved RPG profile (localStorage ec.rpg.v1 → body). */
export function storedProfile(page) {
  return page.evaluate(() => {
    try {
      const o = JSON.parse(localStorage.getItem('ec.rpg.v1'));
      return o && o.body ? (typeof o.body === 'string' ? JSON.parse(o.body) : o.body) : o;
    } catch (e) {
      return null;
    }
  });
}

/** Classic settings blob as saved (epic-checkers.settings.v1). */
export function storedSettings(page) {
  return page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('epic-checkers.settings.v1'));
    } catch (e) {
      return null;
    }
  });
}

export function androidBack(page) {
  return page.evaluate(() => window.__androidBack());
}
