#!/usr/bin/env node
// Runs every end-to-end script against the current dist/www build and prints a summary.
//
//   node tests/e2e/run-all.mjs            full suite (demo games for every variant: ~15 min)
//   node tests/e2e/run-all.mjs --quick    flow + pvp + robust + controller QA fixes + settings /
//                                         frame budget + 3 demo games
//
// Build first: node tools/build-web.mjs   (npm run e2e does both). E2E_WWW=<dir> tests another build.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const quick = process.argv.includes('--quick');

const suites = [
  ['flow.mjs', '--epic', '1'],
  ['flow.mjs', '--epic', '0'],
  ['pvp.mjs'],
  ['robust.mjs'],
  ['controller-e2e.mjs'],
  ['settings-e2e.mjs'],
  quick
    ? ['demo-all.mjs', '--variants', 'russian,turkish,international', '--themes', 'epic', '--giveaway', 'none']
    : ['demo-all.mjs'],
];
if (!quick) suites.push(['demo-all.mjs', '--variants', 'russian,turkish', '--themes', 'epic', '--giveaway', 'none', '--skip', 'tap', '--concurrency', '2']);
if (!quick) suites.push(['shots.mjs']);

function run([file, ...args]) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    console.log(`\n=== ${file} ${args.join(' ')}`);
    const p = spawn(process.execPath, [path.join(HERE, file), ...args], { stdio: 'inherit' });
    p.on('exit', (code) => resolve({ name: `${file} ${args.join(' ')}`.trim(), code, s: Math.round((Date.now() - t0) / 1000) }));
  });
}

const results = [];
for (const s of suites) results.push(await run(s));
console.log('\n=== e2e summary');
for (const r of results) console.log(`${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.name}  (${r.s} s)`);
process.exit(results.some((r) => r.code !== 0) ? 1 : 0);
