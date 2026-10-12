// Economy simulation (GDD §13): the one-off crystal ledger, the daily ceiling, simulated players
// going through the whole campaign with the real meta API (pulls earned per chapter, XP pacing),
// and the expected collection after the campaign / after a month. Prints a report table.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ECONOMY, GACHA } from '../../../src/rpg/data/rules.js';
import { STAGES, ACHIEVEMENTS_TOTAL, dailyStatus, createProfile } from '../../../src/rpg/meta/index.js';
import { simulatePlayer, collectionAfter } from './sim.js';

const PULL = GACHA.cost.single;

test('one-off ledger: 3 200 + 3 120 + 1 620 + 2 400 = 10 340 ✦ ≈ 64 pulls; ≤ 260 ✦ per day', () => {
  const start = ECONOMY.start.crystals;
  const firstClears = STAGES.reduce((a, s) => a + s.rewards.firstClear.crystals, 0);
  const chests = STAGES.reduce((a, s) => a + s.rewards.threeStar, 0);
  const total = start + firstClears + chests + ACHIEVEMENTS_TOTAL;
  assert.deepEqual([start, firstClears, chests, ACHIEVEMENTS_TOTAL, total], [3200, 3120, 1620, 2400, 10340]);
  assert.equal(Math.floor(total / PULL), 64);
  assert.equal(start / PULL, GACHA.noviceBanner.pulls, 'start = exactly the novice banner');
  const perChapter = [1, 2, 3].map((ch) =>
    STAGES.filter((s) => s.chapter === ch).reduce((a, s) => a + s.rewards.firstClear.crystals + s.rewards.threeStar, 0),
  );
  assert.deepEqual(perChapter, [1580, 1580, 1580]);
  const st = dailyStatus(createProfile({ seed: 1, now: 0 }), 0);
  assert.equal(st.maxPerDay, 260);
});

test('simulated players: campaign pacing and pulls earned per chapter (report)', () => {
  const N = 40;
  const runs = [];
  for (let i = 0; i < N; i++) runs.push(simulatePlayer(9000 + i));
  const SOURCES = ['start', 'firstClear', 'threeStar', 'achievement', 'dailyFirst', 'task', 'repeat'];
  const avg = (rows, f) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
  const sum = (c) => SOURCES.reduce((a, k) => a + c[k], 0);
  const lines = [];
  lines.push(`Economy simulation: ${N} players, 10 battles/day, real meta API (tests/rpg/meta/sim.js)`);
  lines.push('chapter | day | battles | ✦ earned in chapter (first clears / ★★★ / achievements / daily+tasks+repeat) | pulls in chapter | cumulative pulls (✦/160) | squad lvl | heroes');
  let prev = null;
  const perChapterPulls = [];
  for (let c = 0; c < 3; c++) {
    const rows = runs.map((r) => r.chapters[c]);
    assert.ok(rows.every(Boolean), `every player clears chapter ${c + 1}`);
    const cur = Object.fromEntries(SOURCES.map((k) => [k, avg(rows, (r) => r.crystals[k])]));
    const delta = Object.fromEntries(SOURCES.map((k) => [k, cur[k] - (prev ? prev[k] : 0)]));
    const chapterCrystals = sum(delta) - (prev ? 0 : delta.start);
    const pulls = chapterCrystals / PULL;
    perChapterPulls.push(pulls);
    const daily = delta.dailyFirst + delta.task + delta.repeat;
    lines.push(
      `  ${c + 1}     | ${avg(rows, (r) => r.day).toFixed(1).padStart(4)} | ${avg(rows, (r) => r.battles).toFixed(0).padStart(7)} | ` +
        `${chapterCrystals.toFixed(0).padStart(5)} (${delta.firstClear.toFixed(0)} / ${delta.threeStar.toFixed(0)} / ${delta.achievement.toFixed(0)} / ${daily.toFixed(0)})`.padEnd(40) +
        ` | ${pulls.toFixed(1).padStart(5)} | ${(sum(cur) / PULL).toFixed(1).padStart(5)} | ${avg(rows, (r) => r.avgLevel).toFixed(1)} | ${avg(rows, (r) => r.owned).toFixed(1)}`,
    );
    prev = cur;
  }
  const fin = runs.map((r) => r.final);
  const finTotal = avg(fin, (r) => sum(r.crystals));
  lines.push(
    `after ★★★ cleanup: day ${avg(fin, (r) => r.day).toFixed(1)}, ${avg(fin, (r) => r.battles).toFixed(0)} battles, ` +
      `${finTotal.toFixed(0)} ✦ total = ${(finTotal / PULL).toFixed(1)} pulls (GDD target ≈ 64 + daily), ` +
      `achievements ${avg(fin, (r) => r.crystals.achievement).toFixed(0)} / ${ACHIEVEMENTS_TOTAL} ✦, heroes ${avg(fin, (r) => r.owned).toFixed(1)} / 24`,
  );
  console.log(lines.join('\n'));

  // GDD: chapter 1 → squad ≈ level 10 (cap 10; the boss clear raises the cap and converts full bars → 11)
  assert.ok(Math.abs(avg(runs.map((r) => r.chapters[0]), (r) => r.avgLevel) - 10.5) <= 1);
  // GDD: chapter 2 ≈ 18 from first clears, ≈ 20 with a few replays / scrolls
  const l2 = avg(runs.map((r) => r.chapters[1]), (r) => r.avgLevel);
  assert.ok(l2 >= 17 && l2 <= 21, `chapter 2 level ${l2}`);
  // each chapter pays ≈ 1 580 ✦ one-off (≈ 9.9 pulls) plus achievements and dailies
  for (const p of perChapterPulls) assert.ok(p >= 9.9 && p <= 22, `pulls per chapter ${p}`);
  // the whole campaign incl. ★★★ lands near the GDD's ≈ 64 pulls (+ dailies, − long-term achievements)
  const totalPulls = finTotal / PULL;
  assert.ok(totalPulls >= 58 && totalPulls <= 76, `total pulls ${totalPulls}`);
  assert.ok(fin.every((r) => r.threeStars === 27));
  assert.ok(avg(fin, (r) => r.day) <= 10, 'campaign in a handful of evenings');
  // pulls actually made are 10-pulls from earned crystals only
  for (const r of fin) assert.ok(r.pulls * PULL <= sum(r.crystals));
});

test('collection after the campaign (≈ 64 pulls) and after a month (≈ 110) — GDD §13', () => {
  const N = 1500;
  const at = (pulls) => {
    const rs = [];
    for (let i = 0; i < N; i++) rs.push(collectionAfter(70000 + i, pulls));
    const avg = (f) => rs.reduce((a, r) => a + f(r), 0) / N;
    return {
      lplus: avg((r) => r.legendaryPlus),
      mythicChance: avg((r) => (r.mythic > 0 ? 1 : 0)),
      epics: avg((r) => r.epics),
      rares: avg((r) => r.rares),
      rareC: avg((r) => r.rareAvgC),
      owned: avg((r) => r.owned),
      owned20: avg((r) => (r.owned >= 20 ? 1 : 0)),
    };
  };
  const c64 = at(64);
  const c110 = at(110);
  console.log(
    `collection after 64 pulls: Legendary+ ${c64.lplus.toFixed(2)} (GDD ≈ 2), P(Mythic) ${(c64.mythicChance * 100).toFixed(0)} % (GDD ≈ 35 %), ` +
      `Epics ${c64.epics.toFixed(1)}/8 (GDD 6–7), Rares ${c64.rares.toFixed(1)}/10 at C${c64.rareC.toFixed(1)} (GDD all, ≈ C4)\n` +
      `collection after 110 pulls: ${c110.owned.toFixed(1)}/24 heroes, ${(c110.owned20 * 100).toFixed(0)} % have ≥ 20 (GDD 20–22)`,
  );
  assert.ok(c64.lplus >= 1.7 && c64.lplus <= 2.5);
  assert.ok(c64.mythicChance >= 0.3 && c64.mythicChance <= 0.5);
  assert.ok(c64.epics >= 5.5 && c64.epics <= 7.2);
  assert.ok(c64.rares >= 9.8);
  assert.ok(c64.rareC >= 3.5 && c64.rareC <= 5);
  assert.ok(c110.owned >= 19.5 && c110.owned <= 22.5);
});
