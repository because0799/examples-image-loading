#!/usr/bin/env node
// Demo assets for the RPG UI demo (dist/dev/rpg-ui-demo/rpg/**), laid out like the shipped
// RPG_ASSETS (rpg/splash|card|token/<id>.webp, rpg/bg/<bg>.webp, rpg/voice/<hero>-<event>.mp3).
//
//   node src/dev/rpg-ui-demo.prep.mjs        (after: node tools/build-web.mjs --demo rpg-ui-demo)
//
// Uses the shipped files of the assets module (web/static/rpg/**) when they exist; otherwise crops
// stand-ins from the source art (assets/rpg/heroes/*.png) with ffmpeg: card 480×640 (3:4 around the
// focal point), token 256×256 (radius ≈ 0.22 of the height around the face), splash 1280×720.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HEROES } from '../rpg/data/heroes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'dist/dev/rpg-ui-demo/rpg');
const SHIPPED = path.join(ROOT, 'web/static/rpg');
const SRC = path.join(ROOT, 'assets/rpg');
const force = process.argv.includes('--force');

function run(args) {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('close', (code) => resolve(code === 0));
    p.on('error', () => resolve(false));
  });
}

async function pool(jobs, n = 6) {
  let i = 0;
  const workers = Array.from({ length: n }, async () => {
    while (i < jobs.length) {
      const job = jobs[i++];
      await job();
    }
  });
  await Promise.all(workers);
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

if (fs.existsSync(SHIPPED) && fs.readdirSync(SHIPPED).length) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.cpSync(SHIPPED, OUT, { recursive: true });
  console.log(`copied shipped assets ${path.relative(ROOT, SHIPPED)} -> ${path.relative(ROOT, OUT)}`);
}

const jobs = [];
for (const kind of ['card', 'token', 'splash', 'bg', 'voice']) fs.mkdirSync(path.join(OUT, kind), { recursive: true });
for (const h of HEROES) {
  const src = path.join(SRC, 'heroes', `${h.id}.png`);
  if (!fs.existsSync(src)) continue;
  const fx = h.art.focal.x;
  const fy = h.art.focal.y;
  const out = (kind) => path.join(OUT, kind, `${h.id}.webp`);
  const need = (kind) => force || !fs.existsSync(out(kind));
  if (need('splash')) jobs.push(() => run(['-i', src, '-vf', 'scale=1280:720', '-c:v', 'libwebp', '-quality', '78', out('splash')]));
  if (need('card')) {
    const cw = 540;
    const x = Math.round(clamp(fx * 1280 - cw / 2, 0, 1280 - cw));
    jobs.push(() => run(['-i', src, '-vf', `crop=${cw}:720:${x}:0,scale=480:640`, '-c:v', 'libwebp', '-quality', '78', out('card')]));
  }
  if (need('token')) {
    const s = 316;
    const x = Math.round(clamp(fx * 1280 - s / 2, 0, 1280 - s));
    const y = Math.round(clamp(fy * 720 - s / 2, 0, 720 - s));
    jobs.push(() => run(['-i', src, '-vf', `crop=${s}:${s}:${x}:${y},scale=256:256`, '-c:v', 'libwebp', '-quality', '80', out('token')]));
  }
}
for (const bg of ['bg-dawn', 'bg-ash', 'bg-sky']) {
  const src = path.join(SRC, 'bg', `${bg}.png`);
  const out = path.join(OUT, 'bg', `${bg}.webp`);
  if (fs.existsSync(src) && (force || !fs.existsSync(out))) jobs.push(() => run(['-i', src, '-vf', 'scale=1280:720', '-c:v', 'libwebp', '-quality', '72', out]));
}
const keyart = path.join(SRC, 'keyart', 'valkyries-keyart.png');
if (fs.existsSync(keyart) && (force || !fs.existsSync(path.join(OUT, 'keyart.webp')))) {
  jobs.push(() => run(['-i', keyart, '-vf', 'scale=1280:720', '-c:v', 'libwebp', '-quality', '78', path.join(OUT, 'keyart.webp')]));
}
const voiceDir = path.join(SRC, 'voice');
if (fs.existsSync(voiceDir)) {
  for (const f of fs.readdirSync(voiceDir)) if (f.endsWith('.mp3')) fs.copyFileSync(path.join(voiceDir, f), path.join(OUT, 'voice', f));
}

const t0 = Date.now();
await pool(jobs);
console.log(`rpg-ui-demo assets: ${jobs.length} files in ${Date.now() - t0} ms -> ${path.relative(ROOT, OUT)}`);
