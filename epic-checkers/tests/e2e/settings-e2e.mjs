#!/usr/bin/env node
// Individual settings + frame budget in the real app (headless Chromium, real build):
//   - settings apply live: the player's name in the HUD and the Director's players, energy colours,
//     haptics gate (fake AndroidBridge), AI pace, battery saver → 30 fps cap;
//   - effect switches: fx.shake 0 → the camera never shakes, fx.flashes off → no impact frame
//     (Pixi or DOM), textTime 3 → captions stay ≥ ~3× as long as at textTime 1;
//   - frame budget: 60 fps cap, ticker stopped while the app is paused, 'auto' quality by device,
//     adaptive step down under injected slow frames (busy loop) — remembered for the next launch,
//     never applied to an explicit choice.
//   (autosave / «Продолжить партию» is covered by controller-e2e.mjs, step F8)
//
//   node tests/e2e/settings-e2e.mjs [--only <step text>]

import { startServer, launchBrowser, newPage, waitApp, waitState, sleep, assert, reporter } from './lib.mjs';

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const R0 = reporter('settings');
const R = { ...R0, step: (label, fn) => (!only || label.includes(only) ? R0.step(label, fn) : undefined) };
const srv = await startServer();
const browser = await launchBrowser();
const errorsAll = [];

const game = (q) => srv.url(`?debug=1&screen=game&intro=0&${q}`);
// the reviewers' Russian triple capture (white c1:e3:g5:e7) and a plain single capture
const TRIPLE = 'w:.b.....b/......../.....b../......../.....b../......../...b..../..w...w.';
const SINGLE = 'w:.b.b.b.b/b.b.b.b./......../......../...b..../..w.w.../.w.w.w.w/w.w.w.w.';
const DEVICE = {
  capable: { cores: 8, mem: 8 },
  weak: { cores: 2, mem: 2 },
};

/** New page; `device` fakes navigator.hardwareConcurrency / deviceMemory, `bridge` a fake AndroidBridge. */
async function open(url, { device = 'capable', bridge = false, dpr = 1, context: ctx0 = null } = {}) {
  const ctx = ctx0 ? { context: ctx0, page: await ctx0.newPage() } : await newPage(browser, { width: 390, height: 844, dpr });
  const d = DEVICE[device] || DEVICE.capable;
  if (!ctx0) {
    await ctx.context.addInitScript(
      ([cores, mem, withBridge]) => {
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => cores, configurable: true });
        Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => mem, configurable: true });
        if (withBridge) {
          window.__vib = [];
          window.AndroidBridge = {
            vibrate: (s) => window.__vib.push({ s }),
            vibrateLevel: (s, a) => window.__vib.push({ s, a }),
            keepScreenOn() {},
            hasTts: () => false,
            speak() {},
            stopSpeaking() {},
            exitApp() {},
          };
        }
      },
      [d.cores, d.mem, bridge],
    );
  }
  ctx.page.on('pageerror', (e) => errorsAll.push(e.message));
  if (process.env.E2E_DEBUG) {
    ctx.page.on('framenavigated', (f) => f === ctx.page.mainFrame() && console.log(`  [nav] ${f.url()}`));
    ctx.page.on('crash', () => console.log('  [crash]'));
    ctx.page.on('console', (m) => /error|warn/.test(m.type()) && console.log(`  [${m.type()}] ${m.text().slice(0, 300)}`));
  }
  if (url) {
    await ctx.page.goto(url);
    await waitApp(ctx.page, 180000); // generous: the headless GPU is slow on a loaded machine
  }
  return ctx;
}

const set = (page, patch) => page.evaluate((p) => window.__app.ui.updateSettings(p), patch);
const setFx = (page, patch) => page.evaluate((p) => window.__app.ui.updateSettings({ fx: { ...window.__app.settings.fx, ...p } }), patch);

/** Restart the current game from `pos` and wait for the human's turn. */
async function restart(page, pos) {
  await page.evaluate((p) => window.__app.setPosition(p), pos);
  await waitState(page, "s.phase === 'human' && !s.busy", 120000);
}

/**
 * Plays `path` (human) and records, every rendered frame until the move is over: max camera shake,
 * impact frames (Pixi overlay 'impact-frame', DOM .fx-impact, director.hooks.impact calls) and the
 * on-screen time of speech bubbles ('director-caption') in renderer.clock.realNow ms.
 */
async function playAndWatch(page, path, { forceCaptions = false, maxMs = 1800000 } = {}) {
  return page.evaluate(
    async ([p, force, maxMs]) => {
      const A = window.__app;
      const r = A.renderer;
      const cam = r.camera;
      const W = { shake: 0, impactPixi: 0, impactDom: 0, impactHook: 0, captions: [] };
      const live = new Map(); // caption object -> first seen
      // only the FX text / overlay containers (walking every particle each frame is slow)
      const roots = A.fx && A.fx.c ? [A.fx.c.screenUI, A.fx.c.overlay].filter(Boolean) : [r.app.stage];
      const find = (node, out, depth = 0) => {
        if (!node || !node.children || depth > 3) return;
        for (const ch of node.children) {
          if (ch.label === 'director-caption') out.push(ch);
          else if (ch.label === 'impact-frame') W.impactPixiSeen = true;
          find(ch, out, depth + 1);
        }
      };
      const findAll = (out) => {
        for (const root of roots) find(root, out);
        return out;
      };
      const hooks = A.director.hooks || {};
      const origImpact = hooks.impact;
      hooks.impact = (ms) => {
        W.impactHook++;
        return origImpact && origImpact(ms);
      };
      const ui = document.getElementById('ui');
      const mo = new MutationObserver(() => {
        if (ui.classList.contains('fx-impact') || ui.classList.contains('fx-impact-b')) W.impactDom++;
      });
      mo.observe(ui, { attributes: true, attributeFilter: ['class'] });
      const rnd = Math.random;
      if (force) Math.random = () => 0.001; // every brag chance hits (deterministic captions)
      const watch = () => {
        W.shake = Math.max(W.shake, Math.abs(cam.shakeX || 0) + Math.abs(cam.shakeY || 0) + Math.abs(cam.shakeRot || 0) * 100);
        W.impactPixiSeen = false;
        const caps = findAll([]);
        if (W.impactPixiSeen) W.impactPixi++;
        const t = r.clock.realNow;
        for (const c of caps) if (!live.has(c)) live.set(c, { t0: t, t1: t, text: (c.children[0] && c.children[0].label) || '' });
        for (const [c, v] of live) {
          if (caps.includes(c) && !c.destroyed) v.t1 = t;
        }
      };
      r.app.ticker.add(watch, null, -1000);
      const t0 = performance.now();
      try {
        await A.playPath(p);
        // captions outlive the move: keep watching until none is left (bounded in wall-clock time;
        // a slow headless GPU makes game / real clock time run far slower than the wall clock)
        while (performance.now() - t0 < maxMs) {
          const caps = findAll([]);
          if (!caps.length && !A.director.busy) break;
          await new Promise((res) => setTimeout(res, 100));
        }
      } finally {
        r.app.ticker.remove(watch, null);
        mo.disconnect();
        hooks.impact = origImpact;
        Math.random = rnd;
      }
      W.captions = Array.from(live.values()).map((v) => Math.round(v.t1 - v.t0));
      W.captionSpans = Array.from(live.values()).map((v) => [Math.round(v.t0), Math.round(v.t1)]);
      W.end = Math.round(r.clock.realNow);
      W.timedOut = performance.now() - t0 >= maxMs;
      return W;
    },
    [path, forceCaptions, maxMs],
  );
}

const legalOf = (page) => page.evaluate(() => window.__app.state().legal);

try {
  await R.step('frame budget: 60 fps cap (tuned 64), battery saver / pause menu → 30, ticker stopped while the app is paused', async () => {
    const { page, context } = await open(game('variant=russian&mode=pvp&epic=1'));
    await waitState(page, "s.phase === 'human'", 120000);
    const s0 = await page.evaluate(() => window.__app.perf.state());
    assert(s0.fpsCap === 60 && s0.maxFPS === 64, `cap ${JSON.stringify(s0)}`);
    await set(page, { battery: true });
    const s1 = await page.evaluate(() => window.__app.perf.state());
    assert(s1.fpsCap === 30 && s1.maxFPS === 31, `battery cap ${JSON.stringify(s1)}`);
    await set(page, { battery: false });
    assert((await page.evaluate(() => window.__app.perf.state().maxFPS)) === 64, 'cap back to 60');
    // the pause menu over the board: 30 fps; closing it: 60 again
    await page.evaluate(() => window.__app.ui.openPause());
    await page.waitForSelector('.ov--pause');
    const pausedCap = await page.evaluate(() => window.__app.perf.state().maxFPS);
    await page.evaluate(() => window.__androidBack()); // back closes the pause menu
    await page.waitForFunction(() => window.__app.perf.state().maxFPS === 64, null, { timeout: 30000 }).catch(() => null);
    const resumedCap = await page.evaluate(() => window.__app.perf.state().maxFPS);
    assert(pausedCap === 31 && resumedCap === 64, `pause menu cap ${pausedCap} → ${resumedCap}`);
    await page.evaluate(() => window.__androidPause());
    const paused = await page.evaluate(() => window.__app.renderer.app.ticker.started);
    await page.evaluate(() => window.__androidResume());
    const resumed = await page.evaluate(() => window.__app.renderer.app.ticker.started);
    assert(paused === false && resumed === true, `ticker paused=${paused} resumed=${resumed}`);
    await context.close();
  });

  await R.step("quality 'auto': high on a capable phone, medium on a weak one; an explicit level is used as is", async () => {
    const a = await open(game('variant=russian&mode=pvp&epic=1'), { device: 'capable' });
    const qa = await a.page.evaluate(() => [window.__app.perf.state(), window.__app.renderer.quality, window.__app.settings.quality]);
    assert(qa[0].effective === 'high' && qa[1] === 'high' && qa[2] === 'auto' && qa[0].adaptive, `capable ${JSON.stringify(qa)}`);
    await a.context.close();
    const w = await open(game('variant=russian&mode=pvp&epic=1'), { device: 'weak' });
    const qw = await w.page.evaluate(() => [window.__app.perf.state(), window.__app.renderer.quality, document.getElementById('ui').className]);
    assert(qw[0].effective === 'medium' && qw[1] === 'medium' && /q-medium/.test(qw[2]), `weak ${JSON.stringify(qw)}`);
    await set(w.page, { quality: 'low' });
    const ql = await w.page.evaluate(() => [window.__app.perf.state(), window.__app.renderer.quality]);
    assert(ql[0].effective === 'low' && ql[1] === 'low' && !ql[0].adaptive, `explicit ${JSON.stringify(ql)}`);
    await w.context.close();
  });

  await R.step('adaptive: injected slow frames (busy loop) step high → medium once, toast, remembered on the next launch; never for an explicit level', async () => {
    const { page, context } = await open(game('variant=russian&mode=pvp&epic=1'), { device: 'capable' });
    await waitState(page, "s.phase === 'human'", 120000);
    assert((await page.evaluate(() => window.__app.perf.effective)) === 'high', 'starts high');
    // every rendered frame now costs ≥ 45 ms of main-thread work
    await page.evaluate(() => {
      window.__busy = () => {
        const t = performance.now();
        while (performance.now() - t < 45);
      };
      window.__app.renderer.app.ticker.add(window.__busy);
    });
    const t0 = Date.now();
    await page.waitForFunction(() => window.__app.perf.state().steps.length >= 1, null, { timeout: 120000, polling: 200 });
    const tStep = Date.now() - t0;
    await page.evaluate(() => {
      window.__app.renderer.app.ticker.remove(window.__busy); // (never return the Ticker: not serialisable)
    });
    await sleep(500);
    const st = await page.evaluate(() => ({
      perf: window.__app.perf.state(),
      rq: window.__app.renderer.quality,
      fxq: window.__app.fx && window.__app.fx.quality,
      setting: window.__app.settings.quality,
      cls: document.getElementById('ui').className,
      toasts: Array.from(document.querySelectorAll('#ui [class*="toast"]')).map((n) => n.textContent).join(' | '),
      want: window.__app.text('toast.qualityLowered'),
      saved: localStorage.getItem('epic-checkers.quality-auto'),
    }));
    assert(st.perf.steps.length === 1 && st.perf.steps[0].from === 'high' && st.perf.steps[0].to === 'medium', `one step ${JSON.stringify(st.perf.steps)}`);
    assert(st.perf.steps[0].avgMs > 22, `measured average ${st.perf.steps[0].avgMs}`);
    assert(st.rq === 'medium' && st.fxq === 'medium' && /q-medium/.test(st.cls), `applied ${JSON.stringify(st)}`);
    assert(st.setting === 'auto', 'the setting stays auto');
    assert(st.saved === 'medium', 'remembered');
    assert(st.toasts.includes(st.want), `toast "${st.want}" in "${st.toasts}"`);
    console.log(`  stepped down after ${(tStep / 1000).toFixed(1)} s of 45 ms frames (avg ${st.perf.steps[0].avgMs} ms)`);
    // next launch (the first app instance closed; headless frames stay slow, so it may have
    // stepped down once more meanwhile): starts at the level remembered last
    const saved = await page.evaluate(() => localStorage.getItem('epic-checkers.quality-auto'));
    await page.close();
    const again = await open(game('variant=russian&mode=pvp&epic=1'), { context });
    const eff2 = await again.page.evaluate(() => window.__app.perf.effective);
    assert(['medium', 'low'].includes(saved) && eff2 === saved, `remembered on the next launch: ${eff2} vs saved ${saved}`);
    // the user picks 'high' explicitly: slow frames never change it
    await set(again.page, { quality: 'high' });
    await again.page.evaluate(() => {
      window.__busy = () => {
        const t = performance.now();
        while (performance.now() - t < 45);
      };
      window.__app.renderer.app.ticker.add(window.__busy);
    });
    await sleep(9000);
    const ex = await again.page.evaluate(() => ({ p: window.__app.perf.state(), rq: window.__app.renderer.quality }));
    await again.page.evaluate(() => {
      window.__app.renderer.app.ticker.remove(window.__busy);
    });
    assert(ex.rq === 'high' && ex.p.steps.length === 0 && ex.p.remembered === null, `explicit untouched ${JSON.stringify(ex)}`);
    await context.close();
  });

  await R.step('settings live: the player name reaches the HUD at once and the VS screen of the next game', async () => {
    const { page, context } = await open(game('adaptive=0&variant=russian&mode=ai&color=1&epic=1&fast=1'));
    await waitState(page, "s.phase === 'human'", 120000);
    await set(page, { playerName: 'Макс' });
    await sleep(300);
    const hud = await page.evaluate(() => (document.querySelector('.screen--game .hp--bottom .hp__name') || {}).textContent || '');
    assert(/макс/i.test(hud), `HUD name "${hud}"`);
    assert((await page.evaluate(() => window.__app.controller.players[1].name)) === 'Макс', 'players[human].name');
    // next game with the VS intro: the Director gets the name
    const vsName = await page.evaluate(async () => {
      const d = window.__app.director;
      const orig = d.playGameStart.bind(d);
      let name = null;
      d.playGameStart = (o) => {
        name = o.players[1].name;
        return orig(o);
      };
      const cfg = { ...window.__app.controller.baseCfg, humanColor: 1 };
      window.__app.controller.startGame(cfg, { intro: true });
      for (let i = 0; i < 50 && name == null; i++) await new Promise((r) => setTimeout(r, 100));
      d.playGameStart = orig;
      return name;
    });
    assert(vsName === 'Макс', `VS screen name ${vsName}`);
    await set(page, { playerName: '' });
    await sleep(200);
    assert((await page.evaluate(() => window.__app.controller.players[1].name)) === (await page.evaluate(() => window.__app.text('hud.you'))), 'empty → «Ты»');
    await context.close();
  });

  await R.step('settings live: playerColor recolours the player’s side (pink → opponent cyan), auto → defaults', async () => {
    const { page, context } = await open(game('adaptive=0&variant=russian&mode=ai&color=1&epic=1&fast=1'));
    await waitState(page, "s.phase === 'human'", 120000);
    const hasApi = await page.evaluate(() => typeof window.__app.renderer.setSideColors === 'function' && typeof window.__app.renderer.sideColor === 'function');
    assert(hasApi, 'renderer.setSideColors / sideColor (settings contract)');
    const norm = (v) => (typeof v === 'string' ? parseInt(v.replace('#', ''), 16) : v);
    await set(page, { playerColor: 'pink' });
    const c1 = await page.evaluate(() => [window.__app.renderer.sideColor(1), window.__app.renderer.sideColor(-1)]);
    assert(norm(c1[0]) === 0xff4fd8 && norm(c1[1]) === 0x29e6ff, `pink vs ${JSON.stringify(c1)}`);
    await set(page, { playerColor: 'auto' });
    const c2 = await page.evaluate(() => [window.__app.renderer.sideColor(1), window.__app.renderer.sideColor(-1)]);
    assert(norm(c2[0]) === 0x29e6ff && norm(c2[1]) === 0xff2e63, `defaults ${JSON.stringify(c2)}`);
    await context.close();
  });

  await R.step('fx.shake 0 → the camera never shakes during a capture (control: shake 1 does)', async () => {
    const { page, context } = await open(game(`adaptive=0&variant=russian&mode=pvp&epic=1&pos=${encodeURIComponent(TRIPLE)}`));
    await waitState(page, "s.phase === 'human'", 120000);
    let path = (await legalOf(page)).find((p) => p.length === 4);
    const on = await playAndWatch(page, path);
    assert(on.shake > 0, `control: the camera shakes with fx.shake 1 (${on.shake})`);
    await setFx(page, { shake: 0 });
    await restart(page, TRIPLE);
    path = (await legalOf(page)).find((p) => p.length === 4);
    const off = await playAndWatch(page, path);
    assert(off.shake === 0, `fx.shake 0 but the camera moved by ${off.shake}`);
    await context.close();
  });

  await R.step('fx.flashes off → no impact frame (Pixi overlay, DOM HUD) during a capture (control: on)', async () => {
    const { page, context } = await open(game(`adaptive=0&variant=russian&mode=pvp&epic=1&pos=${encodeURIComponent(TRIPLE)}`));
    await waitState(page, "s.phase === 'human'", 120000);
    let path = (await legalOf(page)).find((p) => p.length === 4);
    const on = await playAndWatch(page, path);
    assert(on.impactPixi > 0 || on.impactHook > 0, `control: impact frames with flashes on ${JSON.stringify(on)}`);
    await setFx(page, { flashes: false });
    await restart(page, TRIPLE);
    path = (await legalOf(page)).find((p) => p.length === 4);
    const off = await playAndWatch(page, path);
    // nothing visible: no Pixi impact frame, no inverted DOM HUD (the Director may still call the
    // impact hook; the bootstrap's hook ignores it while flashes are off)
    assert(off.impactPixi === 0 && off.impactDom === 0, `flashes off: ${JSON.stringify(off)}`);
    console.log(`  impact frames: flashes on → Pixi ${on.impactPixi} frames / DOM ${on.impactDom}; off → 0 / 0 (hook calls ${off.impactHook})`);
    await context.close();
  });

  await R.step('textTime 3 → speech bubbles stay ≥ 3× their base readable time (and ~3× textTime 1)', async () => {
    // a fresh game per value (the Director rate-limits captions within a session), the value set
    // live through the settings event; base = the Director's readable time at textTime 1
    const run = async (tt) => {
      const { page, context } = await open(game(`adaptive=0&variant=russian&mode=pvp&epic=1&pos=${encodeURIComponent(TRIPLE)}`));
      await waitState(page, "s.phase === 'human' && !s.busy", 120000);
      await set(page, { textTime: tt });
      await page.evaluate(() => {
        const d = window.__app.director;
        window.__said = [];
        const say = d._say.bind(d);
        d._say = (color, text, o) => {
          const kind = (o && o.kind) || 'caption';
          window.__said.push({ text, base: d._read(text, kind) / window.__app.settings.textTime });
          return say(color, text, o);
        };
      });
      const path = (await legalOf(page)).find((p) => p.length === 4);
      const w = await playAndWatch(page, path, { forceCaptions: true });
      const said = await page.evaluate(() => window.__said);
      if (process.env.E2E_DEBUG) console.log(`  [dbg] textTime ${tt}: ${JSON.stringify({ w, said })}`);
      await context.close();
      assert(!w.timedOut, 'the caption outlived the watch (machine too slow?)');
      return { on: Math.max(0, ...w.captions), base: said.length ? Math.max(...said.map((x) => x.base)) : 0 };
    };
    const a = await run(1);
    const b = await run(3);
    console.log(`  caption on screen: textTime 1 → ${a.on} ms (base ${Math.round(a.base)}), textTime 3 → ${b.on} ms (base ${Math.round(b.base)}, ×${a.on ? (b.on / a.on).toFixed(2) : '?'})`);
    assert(a.on > 0 && b.on > 0 && b.base > 0, `captions shown ${JSON.stringify({ a, b })}`);
    assert(b.on >= 3 * b.base, `textTime 3: ${b.on} ms on screen < 3 × base ${b.base} ms`);
    assert(b.on >= 2.5 * a.on, `textTime 3 caption ${b.on} ms vs ${a.on} ms at textTime 1`);
  });

  await R.step("haptics: 'off' → no vibration at all, 'light' → short weak pulses, 'strong' → full patterns", async () => {
    const { page, context } = await open(game(`adaptive=0&variant=russian&mode=pvp&epic=1&pos=${encodeURIComponent(SINGLE)}`), { bridge: true });
    await waitState(page, "s.phase === 'human'", 120000);
    const run = async (level) => {
      await set(page, { haptics: level });
      await restart(page, SINGLE);
      await page.evaluate(() => (window.__vib.length = 0));
      const path = (await legalOf(page))[0];
      await page.evaluate((p) => window.__app.playPath(p), path);
      await sleep(300);
      return page.evaluate(() => window.__vib.slice());
    };
    const strong = await run('strong');
    assert(strong.length > 0, 'strong: the capture vibrates');
    const off = await run('off');
    assert(off.length === 0, `off: ${JSON.stringify(off)}`);
    const light = await run('light');
    assert(light.length > 0 && light.every((v) => v.a > 0), `light uses the weak amplitude ${JSON.stringify(light)}`);
    const pulses = light.flatMap((v) => [].concat(JSON.parse(v.s)).filter((x, i) => i % 2 === 0));
    assert(pulses.every((ms) => ms <= 28), `light pulses ≤ 28 ms: ${pulses}`);
    assert((await page.evaluate(() => window.__app.settings.vibration)) === true, 'legacy vibration mirror');
    await context.close();
  });

  await R.step('aiPace: the AI waits ≥ 1.3 s on «slow» and much less on «fast»', async () => {
    const { page, context } = await open(game(`adaptive=0&variant=russian&mode=ai&color=1&level=1&epic=0&pos=${encodeURIComponent(SINGLE)}`));
    await waitState(page, "s.phase === 'human' && !s.busy", 120000);
    const measure = async (pace) => {
      await set(page, { aiPace: pace });
      await restart(page, SINGLE);
      return page.evaluate(async () => {
        const A = window.__app;
        let tThink = 0;
        let tMove = 0;
        const think = A.ai.think.bind(A.ai);
        A.ai.think = (...a) => {
          if (!tThink) tThink = performance.now();
          return think(...a);
        };
        const pm = A.director.playMove.bind(A.director);
        A.director.playMove = (o) => {
          if (!o.moverIsHuman && !tMove) tMove = performance.now();
          return pm(o);
        };
        await A.playPath(A.state().legal[0]);
        for (let i = 0; i < 100 && !tMove; i++) await new Promise((r) => setTimeout(r, 50));
        A.ai.think = think;
        A.director.playMove = pm;
        return Math.round(tMove - tThink);
      });
    };
    const slow = await measure('slow');
    const fast = await measure('fast');
    console.log(`  AI pause: slow ${slow} ms, fast ${fast} ms`);
    assert(slow >= 1300, `slow ${slow}`);
    assert(fast >= 300 && fast < slow - 500, `fast ${fast}`);
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
