// Campaign: the 27 stages vs the GDD §14 tables (written out here independently of rules.js),
// chapter backgrounds / gimmicks / limits, linear unlock order, stars, enemy squads (elites,
// mini-bosses, bosses with escorts, mirror, the ladder formation), setups and advice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HERO_BY_ID } from '../../../src/rpg/data/heroes.js';
import {
  STAGES, CHAPTERS, stageById, enemySquad, isUnlocked, nextStage, computeStars, chapterProgress, campaignProgress,
  createProfile, applyBattleResult, campaignSetup, squareIndex, squareName, deploySquares, stageAdvice,
  recommendedPower, setSquad, sanitizeProfile, starConditions, isChapterUnlocked, canAutoBattle,
} from '../../../src/rpg/meta/index.js';

const NOW = Date.UTC(2026, 9, 12, 9, 0, 0);

// GDD §14.1–14.3, transcribed from the document.
const GDD = {
  '1-1': [1, 'easy', 'vera shio mara'],
  '1-2': [2, 'easy', 'maren shio mashiro iskra'],
  '1-3': [3, 'easy', 'torvald falk runa mara'],
  '1-4': [4, 'easy', 'vera torvald falk maren sirin'],
  '1-5': [5, 'normal', 'iskra mara shio runa mashiro'],
  '1-6': [6, 'normal', 'iskra mara shio maren sirin torvald'],
  '1-7': [7, 'normal', 'sirin kaede iskra falk vera mashiro'],
  '1-8': [8, 'normal', 'koyuki kaede shio torvald mashiro iskra'],
  '1-B': [10, 'normal', 'tsubame! kaede:8 sirin:8 vera:8'],
  '2-1': [11, 'normal', 'torvald falk zlata shio maren iskra'],
  '2-2': [12, 'normal', 'torvald akane mara runa mashiro falk'],
  '2-3': [13, 'normal', 'volta iskra karasu shio vera sirin'],
  '2-4': [14, 'normal', 'zlata kaede koyuki maren mashiro runa'],
  '2-5': [15, 'normal', 'karasu mara iskra kaede shio falk'],
  '2-6': [16, 'normal', 'fuyuka* akane koyuki torvald mashiro maren'],
  '2-7': [17, 'normal', 'reika* volta zlata lucille iskra falk'],
  '2-8': [18, 'hard', 'zlata fuyuka* lucille karasu kaede volta'],
  '2-B': [20, 'hard', 'vermilia! akane:18 torvald:18 lucille:18 volta:18'],
  '3-1': [21, 'normal', 'lucille vera kaede sirin koyuki shio'],
  '3-2': [22, 'normal', 'tsubame* iskra karasu mara kaede mashiro'],
  '3-3': [23, 'normal', 'vera vera lucille zlata reika* mizuha'],
  '3-4': [24, 'normal', 'karasu mara mara volta koyuki mizuha'],
  '3-5': [25, 'normal', 'tsubame* reika* volta iskra kaede sirin'],
  '3-6': [26, 'hard', 'fuyuka^3 koyuki mashiro mizuha zlata vera'],
  '3-7': [27, 'hard', 'vermilia^3 akane torvald lucille kaede reika'],
  '3-8': [28, 'hard', 'mirror'],
  // 3-B escorts lowered from the GDD's 28 to 25 in the 1.2.0 boss balance pass (rules.js CAMPAIGN note)
  '3-B': [30, 'hard', 'nocturna! karasu:25 fuyuka:25 lucille:25 reika:25 tsubame:25'],
};
// GDD §15 had HP ×5 / ×5 / ×6; the 1.2.0 balance pass (rules.js CAMPAIGN note) uses these
const BOSS_HP = { '1-B': 3.5, '2-B': 2.5, '3-B': 3.5 };

function win(p, stageId, { lost = 0, rounds = 10 } = {}) {
  return applyBattleResult(p, { stageId, mode: 'campaign', result: { winner: 1, rounds }, stats: { lost }, now: NOW });
}

test('27 stages: 3 chapters × (8 + boss), linear prev/next chain', () => {
  assert.equal(STAGES.length, 27);
  assert.deepEqual(STAGES.map((s) => s.id), Object.keys(GDD));
  assert.equal(CHAPTERS.length, 3);
  for (const ch of CHAPTERS) {
    assert.equal(ch.stageIds.length, 9);
    assert.equal(ch.bossId, `${ch.chapter}-B`);
  }
  STAGES.forEach((s, i) => {
    assert.equal(s.order, i);
    assert.equal(s.prev, i ? STAGES[i - 1].id : null);
    assert.equal(s.next, i < 26 ? STAGES[i + 1].id : null);
    assert.equal(s.boss, s.id.endsWith('-B'));
  });
});

test('every stage matches the GDD table: level, AI, enemies, elites, mini-bosses, bosses + escorts', () => {
  const p = createProfile({ seed: 1, now: NOW });
  for (const [id, [level, ai, spec]] of Object.entries(GDD)) {
    const s = stageById(id);
    assert.equal(s.level, level, `${id} level`);
    assert.equal(s.ai, ai, `${id} ai`);
    const squad = enemySquad(s, p);
    for (const u of squad) {
      assert.ok(HERO_BY_ID[u.heroId], `${id}: ${u.heroId}`);
      assert.equal(u.reflection, true);
      assert.equal(u.constellation, 0);
    }
    if (spec === 'mirror') {
      assert.deepEqual(squad.map((u) => u.heroId), p.squad);
      assert.ok(squad.every((u) => u.level === level && u.mirror));
      continue;
    }
    const want = spec.split(' ');
    assert.equal(squad.length, want.length, `${id} size`);
    want.forEach((w, i) => {
      const u = squad[i];
      const m = /^([a-z]+)([!*^]?)(?::(\d+)|(\d+))?$/.exec(w);
      assert.equal(u.heroId, m[1], `${id}[${i}]`);
      assert.equal(u.level, m[3] ? Number(m[3]) : level, `${id} ${u.heroId} level`);
      if (m[2] === '!') {
        assert.equal(u.boss, true);
        assert.equal(u.hpMult, BOSS_HP[id]);
      } else assert.equal(u.boss, undefined);
      if (m[2] === '*') assert.equal(u.elite, true, `${id} ${u.heroId} elite`);
      if (m[2] === '^') {
        assert.equal(u.miniBoss, true);
        assert.equal(u.hpMult, Number(m[4]));
      }
    });
    assert.ok(squad.length <= 6);
  }
  assert.equal(enemySquad('3-B')[0].bossRules[0].rule, 'startCrowned');
});

test('chapters: backgrounds, gimmicks, round limits and ★★★ targets (bosses override)', () => {
  const want = [
    ['bg-dawn', 'dew', 25, 14],
    ['bg-ash', 'lava', 28, 16],
    ['bg-sky', 'portals-collapse', 30, 18],
  ];
  for (const s of STAGES) {
    const [bg, gimmick, limit, three] = want[s.chapter - 1];
    assert.equal(s.bg, bg);
    assert.equal(s.gimmick.id, gimmick);
    if (s.boss) {
      assert.equal(s.roundLimit, 30);
      assert.equal(s.threeStarRounds, s.id === '3-B' ? 22 : 20);
    } else {
      assert.equal(s.roundLimit, limit, s.id);
      assert.equal(s.threeStarRounds, three, s.id);
    }
    assert.equal(s.first, s.id === '1-6' ? -1 : 1, `${s.id} first side`);
  }
  assert.deepEqual(stageById('1-1').gimmick.squares, ['c5', 'e5', 'd4', 'f4']);
  assert.equal(stageById('3-B').collapseShift, -2);
  assert.equal(stageById('2-5').rule.id, 'escort');
  assert.equal(starConditions('2-3')[2].stars, 3);
  assert.match(starConditions('2-3')[2].text.ru, /16/);
});

test('stage rewards: first clear 80 ✦ + 1/2/3 scrolls by chapter, bosses 400 ✦ + 3 scrolls, ★★★ 60', () => {
  for (const s of STAGES) {
    const fc = s.rewards.firstClear;
    if (s.boss) assert.deepEqual(fc, { crystals: 400, xpScrolls: 3 });
    else assert.deepEqual(fc, { crystals: 80, xpScrolls: s.chapter });
    assert.equal(s.rewards.threeStar, 60);
    assert.equal(s.rewards.repeat, 10);
  }
  const firstClears = STAGES.reduce((a, s) => a + s.rewards.firstClear.crystals, 0);
  const chests = STAGES.reduce((a, s) => a + s.rewards.threeStar, 0);
  assert.equal(firstClears, 3120);
  assert.equal(chests, 1620);
});

test('unlock order: strictly linear across all 27 stages and chapters', () => {
  let p = createProfile({ seed: 2, now: NOW });
  assert.deepEqual(STAGES.filter((s) => isUnlocked(p, s.id)).map((s) => s.id), ['1-1']);
  assert.equal(isChapterUnlocked(p, 2), false);
  assert.equal(campaignSetup(p, '1-2').error, 'locked');
  assert.equal(campaignSetup(p, 'zz').error, 'stage');
  assert.equal(isUnlocked(p, 'nope'), false);
  for (let i = 0; i < STAGES.length; i++) {
    const s = STAGES[i];
    assert.equal(nextStage(p).id, s.id);
    for (let j = 0; j < STAGES.length; j++) assert.equal(isUnlocked(p, STAGES[j].id), j <= i, `${STAGES[j].id} after ${i}`);
    // a loss does not unlock anything
    const lost = applyBattleResult(p, { stageId: s.id, mode: 'campaign', result: { winner: -1, rounds: 12 }, now: NOW }).profile;
    if (s.next) assert.equal(isUnlocked(lost, s.next), false);
    p = win(p, s.id).profile;
    assert.equal(canAutoBattle(p, s.id), true);
  }
  assert.equal(nextStage(p), null);
  const cp = campaignProgress(p);
  assert.equal(cp.cleared, 27);
  assert.equal(cp.stars, 81);
  assert.equal(cp.threeStarStages, 27);
  assert.deepEqual(chapterProgress(p, 2), { chapter: 2, cleared: 9, total: 9, stars: 27, maxStars: 27, unlocked: true, bossCleared: true, complete: true });
});

test('stars: ★ win · ★★ ≤ 1 KO · ★★★ no KO within the round target; best stars kept', () => {
  assert.equal(computeStars({ won: false, lost: 0, rounds: 3, threeStarRounds: 14 }), 0);
  assert.equal(computeStars({ won: true, lost: 0, rounds: 14, threeStarRounds: 14 }), 3);
  assert.equal(computeStars({ won: true, lost: 0, rounds: 15, threeStarRounds: 14 }), 2);
  assert.equal(computeStars({ won: true, lost: 1, rounds: 5, threeStarRounds: 14 }), 2);
  assert.equal(computeStars({ won: true, lost: 2, rounds: 5, threeStarRounds: 14 }), 1);
  let p = createProfile({ seed: 3, now: NOW });
  let r = win(p, '1-1', { lost: 2 });
  assert.equal(r.rewards.stars, 1);
  r = win(r.profile, '1-1', { lost: 0, rounds: 9 });
  assert.equal(r.rewards.stars, 3);
  r = win(r.profile, '1-1', { lost: 3 });
  assert.equal(r.rewards.stars, 1);
  assert.equal(r.rewards.bestStars, 3);
  assert.equal(r.profile.campaign['1-1'].stars, 3);
  assert.equal(r.profile.campaign['1-1'].clears, 3);
  assert.equal(r.profile.campaign['1-1'].bestRounds, 9);
});

test('mirror stage copies the current squad with constellations at level 28', () => {
  let p = createProfile({ seed: 4, now: NOW });
  p = sanitizeProfile({ ...p, heroes: { ...p.heroes, akane: { ...p.heroes.akane, constellation: 3, copies: 4 } } });
  p = setSquad(p, ['akane', 'vera', 'iskra']);
  const sq = enemySquad('3-8', p);
  assert.deepEqual(sq.map((u) => [u.heroId, u.level, u.constellation]), [['akane', 28, 3], ['vera', 28, 0], ['iskra', 28, 0]]);
  // without a profile: the starter squad
  assert.equal(enemySquad('3-8').length, 6);
});

test('positions are left to the engine: no sq in enemy squads; 1-3 keeps its presetFormation rule', () => {
  for (const st of STAGES) assert.ok(enemySquad(st, createProfile({ seed: 1, now: NOW })).every((u) => u.sq === undefined), st.id);
  assert.deepEqual(stageById('1-3').rule, { id: 'presetFormation', formation: 'ladder' });
  assert.equal(stageById('1-3').tutorial, 'chains');
});

test('board notation helpers', () => {
  assert.equal(squareIndex('a1'), 56);
  assert.equal(squareIndex('h8'), 7);
  assert.equal(squareIndex('d2'), 51);
  assert.equal(squareIndex('z9'), -1);
  for (let sq = 0; sq < 64; sq++) assert.equal(squareIndex(squareName(sq)), sq);
  assert.deepEqual(deploySquares(1), [49, 51, 53, 55, 56, 58, 60, 62]);
  assert.deepEqual(deploySquares(-1), [1, 3, 5, 7, 8, 10, 12, 14]);
});

test('campaignSetup: squads, AI, first side, seed; recommended power grows with level', () => {
  const p = createProfile({ seed: 5, now: NOW });
  const s = campaignSetup(p, '1-1');
  assert.equal(s.ok, true);
  assert.equal(s.mode, 'campaign');
  assert.equal(s.difficulty, 'easy');
  assert.equal(s.squads[1].length, 6);
  assert.deepEqual(s.squads[1][0], { heroId: 'akane', level: 1, constellation: 0 });
  assert.equal(s.squads[-1].length, 3);
  assert.equal(s.first, 1);
  assert.equal(s.bg, 'bg-dawn');
  assert.equal(campaignSetup(p, '1-1').seed, s.seed, 'deterministic seed');
  assert.notEqual(campaignSetup(p, '1-1', { seed: 7 }).seed, s.seed);
  const amb = campaignSetup(p, '1-6', { ignoreLock: true });
  assert.equal(amb.first, -1);
  let prev = 0;
  for (let l = 1; l <= 30; l++) {
    const r = recommendedPower(l);
    assert.ok(r > prev);
    prev = r;
  }
  assert.equal(stageById('2-1').recommendedPower, recommendedPower(11));
});

test('advice after two losses in a row (GDD §14.4)', () => {
  let p = createProfile({ seed: 6, now: NOW });
  const lose = (q) => applyBattleResult(q, { stageId: '1-1', mode: 'campaign', result: { winner: -1 }, now: NOW }).profile;
  p = lose(p);
  assert.equal(stageAdvice(p, '1-1').show, false);
  p = lose(p);
  const adv = stageAdvice(p, '1-1');
  assert.equal(adv.show, true);
  assert.equal(adv.trainingLevel, 1);
  assert.deepEqual(adv.counterElements, ['radiance', 'umbra']); // Мара (umbra) and Вера (radiance)
  // a draw does not count as a loss; a win resets the streak
  const d = applyBattleResult(p, { stageId: '1-1', mode: 'campaign', result: { winner: 0 }, now: NOW }).profile;
  assert.equal(d.campaign['1-1'].lossStreak, 2);
  assert.equal(win(d, '1-1').profile.campaign['1-1'].lossStreak, 0);
});
