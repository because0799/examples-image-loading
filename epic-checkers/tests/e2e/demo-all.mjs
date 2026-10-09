#!/usr/bin/env node
// AI-vs-AI demo games played to the end for every variant, in classic and in epic (+ giveaway for
// two variants). Each game must reach the game-over overlay with no page errors, no console
// errors, no controller errors and no renderer/state mismatch.
//
//   node tests/e2e/demo-all.mjs [--variants russian,turkish] [--themes classic,epic]
//        [--giveaway russian,turkish] [--concurrency 3] [--skip auto|tap|none] [--speed 2]
//        [--quality low] [--timeout 480]
//
// --skip auto: ?autoskip=1 (every cinematic is skipped as soon as it starts)
// --skip tap : the script taps the board whenever a cinematic is busy (exercises tap-to-skip)
// --skip none: full cinematics (slow in software GL)

import { VARIANTS } from '../../src/engine/index.js';
import { startServer, launchBrowser, newPage, waitApp, appState, sleep, reporter } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const variants = opt('--variants', VARIANTS.map((v) => v.id).join(',')).split(',').filter(Boolean);
const themes = opt('--themes', 'classic,epic').split(',').filter(Boolean);
const giveaway = opt('--giveaway', 'russian,turkish').split(',').filter(Boolean);
const concurrency = Number(opt('--concurrency', '3'));
const skip = opt('--skip', 'auto');
const speed = opt('--speed', '2');
const quality = opt('--quality', 'low');
const timeoutSec = Number(opt('--timeout', '480'));

const jobs = [];
for (const v of variants) for (const th of themes) jobs.push({ variant: v, epic: th === 'epic', giveaway: false });
for (const v of giveaway) if (v !== 'none') jobs.push({ variant: v, epic: true, giveaway: true });

const R = reporter('demo-all');
const srv = await startServer();
const browser = await launchBrowser();

async function runJob(job, idx) {
  const label = `${job.variant} ${job.epic ? 'epic' : 'classic'}${job.giveaway ? ' giveaway' : ''}`;
  await R.step(label, async () => {
    const { context, page, log } = await newPage(browser, { width: 390, height: 844, dpr: 1 });
    try {
      const q = `?debug=1&screen=game&mode=demo&fast=1&speed=${speed}&quality=${quality}&variant=${job.variant}` +
        `&epic=${job.epic ? 1 : 0}&giveaway=${job.giveaway ? 1 : 0}&level=${1 + (idx % 5)}${skip === 'auto' ? '&autoskip=1' : ''}`;
      await page.goto(srv.url(q));
      await waitApp(page);
      const t0 = Date.now();
      let st;
      for (;;) {
        st = await appState(page);
        if (st.phase === 'over' && (await page.locator('.ov--gameover').count())) break;
        if (Date.now() - t0 > timeoutSec * 1000) throw new Error(`timeout at ply ${st.ply} phase ${st.phase}`);
        if (skip === 'tap' && st.busy) {
          const box = await page.evaluate(() => {
            const b = window.__app.renderer.boardCenter;
            const p = window.__app.renderer.worldToScreen(b.x, b.y);
            return p;
          });
          await page.touchscreen.tap(box.x, box.y);
        }
        await sleep(skip === 'tap' ? 250 : 400);
      }
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(`  ${label}: ${JSON.stringify(st.result)} after ${st.ply} plies in ${secs} s; captures W${st.stats.captures[1]} B${st.stats.captures[-1]}, maxCombo ${Math.max(st.stats.maxCombo[1], st.stats.maxCombo[-1])}, kings ${st.stats.kingsMade[1] + st.stats.kingsMade[-1]}`);
      if (!st.result) throw new Error('no result');
      if (st.mismatches) throw new Error(`${st.mismatches} renderer/state mismatches`);
      if (st.errors.length) throw new Error(`controller errors:\n${st.errors.join('\n')}`);
      if (log.errors.length) throw new Error(`page errors:\n${log.errors.join('\n')}`);
      if (log.consoleErrors.length) throw new Error(`console errors:\n${log.consoleErrors.join('\n')}`);
    } finally {
      await context.close();
    }
  });
}

let next = 0;
await Promise.all(
  Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (next < jobs.length) {
      const i = next++;
      await runJob(jobs[i], i);
    }
  }),
);
await browser.close();
await srv.close();
process.exit(R.done() ? 1 : 0);
