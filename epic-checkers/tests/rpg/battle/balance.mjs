#!/usr/bin/env node
// Balance report for «Валькирии доски» (GDD §19.5). Not part of `npm test` (takes minutes).
//
//   node tests/rpg/battle/balance.mjs [--pairs 600] [--mirror 400] [--special 200] [--workers 4] [--difficulty normal] [--json out.json]
//
// Scenarios (AI vs AI, same difficulty on both sides):
//   mirror   — identical random squads (same level, C0), first side alternates: battle length, first-side
//              advantage, round-limit rate (GDD: 14–18 rounds, first side 50–56 %, round limit < 5 %).
//   pairs    — two different random squads (same random level 1–30, C0), each pairing played twice with
//              the sides swapped ("mirrored"): win rate of every hero / rarity / role / element.
//   mythic   — 1 Mythic + 5 Epics vs 6 Epics (GDD: 60–65 %, ≤ 70 %).
//   rare-c4  — 6 Rares at C4 vs 6 Epics at C0 (GDD: 40–50 %).
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../../../', import.meta.url);
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};

async function runGames(jobs, difficulty) {
  const { createBattle, applyAction, battleResult } = await import(new URL('src/rpg/battle/index.js', ROOT));
  const { chooseAction } = await import(new URL('src/rpg/ai/index.js', ROOT));
  const out = [];
  for (const job of jobs) {
    let s = createBattle({ sides: { 1: job.a, [-1]: job.b }, seed: job.seed, mode: 'training', first: job.first });
    let steps = 0;
    let maxMs = 0;
    while (!s.result && steps < 3000) {
      const t = performance.now();
      const a = chooseAction(s, { difficulty, seed: job.seed });
      maxMs = Math.max(maxMs, performance.now() - t);
      s = applyAction(s, a).state;
      steps++;
    }
    const r = battleResult(s);
    out.push({ id: job.id, scenario: job.scenario, a: job.a.map((x) => x.heroId), b: job.b.map((x) => x.heroId), first: job.first, winner: r ? r.winner : 0, reason: r ? r.reason : 'unfinished', rounds: r ? r.rounds : 0, steps, maxMs, kos: r ? [r.stats.sides[1].heroesLost, r.stats.sides[-1].heroesLost] : [0, 0] });
  }
  return out;
}

if (!isMainThread) {
  runGames(workerData.jobs, workerData.difficulty).then((res) => parentPort.postMessage(res));
} else {
  const { HEROES } = await import(new URL('src/rpg/data/heroes.js', ROOT));
  const { makeRng } = await import(new URL('src/rpg/battle/rng.js', ROOT));
  const pairs = +arg('pairs', 600);
  const mirror = +arg('mirror', 400);
  const special = +arg('special', 200);
  const workers = +arg('workers', Math.min(4, os.cpus().length));
  const difficulty = arg('difficulty', 'normal');
  const jsonOut = arg('json', null);
  const rng = makeRng(arg('seed', 'balance'));
  const ids = HEROES.map((h) => h.id);
  const byRarity = (r) => HEROES.filter((h) => h.rarity === r).map((h) => h.id);
  const pickN = (pool, n) => {
    const a = pool.slice();
    const out = [];
    for (let i = 0; i < n; i++) out.push(a.splice(rng.int(a.length), 1)[0]);
    return out;
  };
  const squad = (list, level, c = 0) => list.map((heroId) => ({ heroId, level, constellation: c }));
  const jobs = [];
  let id = 0;
  for (let i = 0; i < mirror; i++) {
    const lvl = 1 + rng.int(30);
    const t = pickN(ids, 6);
    jobs.push({ id: id++, scenario: 'mirror', a: squad(t, lvl), b: squad(t, lvl), seed: 1000 + i, first: i % 2 ? 1 : -1 });
  }
  for (let i = 0; i < pairs; i++) {
    const lvl = 1 + rng.int(30);
    const ta = pickN(ids, 6);
    const tb = pickN(ids, 6);
    jobs.push({ id: id++, scenario: 'pairs', a: squad(ta, lvl), b: squad(tb, lvl), seed: 5000 + i, first: 1 });
    jobs.push({ id: id++, scenario: 'pairs', a: squad(tb, lvl), b: squad(ta, lvl), seed: 5000 + i, first: 1 });
  }
  for (let i = 0; i < special; i++) {
    const lvl = 10 + rng.int(21);
    const myth = byRarity('mythic')[i % 2];
    const e1 = pickN(byRarity('epic'), 5);
    const e2 = pickN(byRarity('epic'), 6);
    const first = i % 2 ? 1 : -1;
    jobs.push({ id: id++, scenario: 'mythic', a: squad([myth, ...e1], lvl), b: squad(e2, lvl), seed: 9000 + i, first, mythic: myth });
    const rares = pickN(byRarity('rare'), 6);
    const epics = pickN(byRarity('epic'), 6);
    jobs.push({ id: id++, scenario: 'rare-c4', a: squad(rares, lvl, 4), b: squad(epics, lvl, 0), seed: 13000 + i, first });
  }
  const t0 = Date.now();
  const chunks = Array.from({ length: workers }, () => []);
  jobs.forEach((j, i) => chunks[i % workers].push(j));
  const results = (
    await Promise.all(
      chunks.map(
        (c) =>
          new Promise((resolve, reject) => {
            const w = new Worker(fileURLToPath(import.meta.url), { workerData: { jobs: c, difficulty } });
            w.on('message', resolve);
            w.on('error', reject);
          }),
      ),
    )
  ).flat();
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) : '-');
  const lines = [];
  const say = (x = '') => lines.push(x);
  say(`# «Валькирии доски» balance report — ${results.length} battles, AI ${difficulty} vs ${difficulty}, ${secs}s on ${workers} workers`);
  // mirror
  const mir = results.filter((r) => r.scenario === 'mirror');
  const rounds = mir.map((r) => r.rounds).sort((a, b) => a - b);
  const decisive = mir.filter((r) => r.winner !== 0);
  const firstWins = decisive.filter((r) => r.winner === r.first).length;
  say();
  say(`## Mirror (identical squads), n=${mir.length}`);
  say(`rounds: mean ${(rounds.reduce((a, b) => a + b, 0) / rounds.length).toFixed(1)}, median ${rounds[rounds.length >> 1]}, p10 ${rounds[Math.floor(rounds.length * 0.1)]}, p90 ${rounds[Math.floor(rounds.length * 0.9)]}  (GDD 14–18)`);
  say(`first side wins ${pct(firstWins, decisive.length)} % of decisive games (GDD 50–56 %); draws ${pct(mir.length - decisive.length, mir.length)} %`);
  say(`round limit reached: ${pct(mir.filter((r) => r.reason === 'round-limit').length, mir.length)} % (GDD < 5 %)`);
  // pairs: per hero
  const pr = results.filter((r) => r.scenario === 'pairs');
  const stat = {};
  const add = (key, win) => {
    stat[key] = stat[key] || { g: 0, w: 0 };
    stat[key].g++;
    stat[key].w += win;
  };
  const heroInfo = Object.fromEntries(HEROES.map((h) => [h.id, h]));
  for (const r of pr) {
    for (const [team, side] of [[r.a, 1], [r.b, -1]]) {
      const win = r.winner === side ? 1 : r.winner === 0 ? 0.5 : 0;
      for (const h of team) {
        add(`hero:${h}`, win);
        add(`rarity:${heroInfo[h].rarity}`, win);
        add(`role:${heroInfo[h].role}`, win);
        add(`element:${heroInfo[h].element}`, win);
      }
    }
  }
  const prRounds = pr.map((r) => r.rounds);
  say();
  say(`## Random squads, mirrored pairs (sides swapped), n=${pr.length}; mean rounds ${(prRounds.reduce((a, b) => a + b, 0) / prRounds.length).toFixed(1)}, round limit ${pct(pr.filter((r) => r.reason === 'round-limit').length, pr.length)} %`);
  const table = (prefix) => {
    const rows = Object.entries(stat)
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, v]) => [k.slice(prefix.length), v.g, (100 * v.w) / v.g])
      .sort((a, b) => b[2] - a[2]);
    for (const [k, g, w] of rows) say(`  ${k.padEnd(10)} ${w.toFixed(1).padStart(5)} %  (n=${g})${w > 60 ? '  ⚠ HIGH' : w < 40 ? '  ⚠ LOW' : ''}`);
  };
  say('### by rarity');
  table('rarity:');
  say('### by role');
  table('role:');
  say('### by element');
  table('element:');
  say('### by hero (win rate of squads that include the hero)');
  table('hero:');
  // special scenarios
  for (const sc of ['mythic', 'rare-c4']) {
    const rs = results.filter((r) => r.scenario === sc);
    const w = rs.filter((r) => r.winner === 1).length + 0.5 * rs.filter((r) => r.winner === 0).length;
    say();
    say(`## ${sc === 'mythic' ? 'Mythic + 5 Epics vs 6 Epics (GDD 60–65 %, ≤ 70 %)' : '6 Rares C4 vs 6 Epics C0 (GDD 40–50 %)'}: ${pct(w, rs.length)} % (n=${rs.length})`);
    if (sc === 'mythic') {
      for (const m of byRarity('mythic')) {
        const sub = rs.filter((r) => r.a.includes(m));
        const ww = sub.filter((r) => r.winner === 1).length + 0.5 * sub.filter((r) => r.winner === 0).length;
        say(`  ${m}: ${pct(ww, sub.length)} % (n=${sub.length})`);
      }
    }
  }
  const maxMs = Math.max(...results.map((r) => r.maxMs));
  say();
  say(`AI: slowest decision ${maxMs.toFixed(0)} ms; unfinished battles: ${results.filter((r) => r.reason === 'unfinished').length}`);
  console.log(lines.join('\n'));
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ results, stat }, null, 1));
}
