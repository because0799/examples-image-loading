// «Призыв» gacha: exact rates (Markov chain built from rules.js), ≥ 1.2 M simulated pulls (1 M on
// the core roller + 200 k through the full summon() API), pity limits, soft-pity hazard, Mythic
// guarantee, novice banner, duplicates → constellations → Stardust, costs and determinism.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GACHA, RARITIES, legendaryPlusChance } from '../../../src/rpg/data/rules.js';
import { HEROES } from '../../../src/rpg/data/heroes.js';
import {
  createProfile, summon, canSummon, SUMMON_COST, rollRarity, pullChances, emptyPity, pityStatus, createRng,
  HEROES_BY_RARITY, summonCost, bannerFor, sanitizeProfile,
} from '../../../src/rpg/meta/index.js';

const LPLUS = new Set(['legendary', 'mythic']);
const EPLUS = new Set(['epic', 'legendary', 'mythic']);

/** Exact stationary rates of the pity chain, built only from rules.js (independent of gacha.js). */
function exactRates() {
  const E = GACHA.pity.epicPlusEvery;
  const L = GACHA.pity.legendaryPlusHard;
  const S = GACHA.pity.mythicGuaranteeAfter + 1;
  const idx = (e, l, s) => (e * L + l) * S + s;
  const N = E * L * S;
  const epicShare = GACHA.rates.epic / (GACHA.rates.epic + GACHA.rates.rare);
  const step = (pi, acc) => {
    const nx = new Float64Array(N);
    for (let e = 0; e < E; e++) {
      for (let l = 0; l < L; l++) {
        for (let s = 0; s < S; s++) {
          const p = pi[idx(e, l, s)];
          if (!p) continue;
          const pL = legendaryPlusChance(l + 1);
          const pM = s >= GACHA.pity.mythicGuaranteeAfter ? 1 : GACHA.pity.mythicShare;
          nx[idx(0, 0, 0)] += p * pL * pM;
          if (s < S - 1) nx[idx(0, 0, s + 1)] += p * pL * (1 - pM);
          const rest = 1 - pL;
          const pE = rest * epicShare;
          const pR = rest - pE;
          if (acc) {
            acc.mythic += p * pL * pM;
            acc.legendary += p * pL * (1 - pM);
          }
          if (l + 1 < L) {
            nx[idx(0, l + 1, s)] += p * pE;
            if (acc) acc.epic += p * pE;
            if (e + 1 >= E) {
              nx[idx(0, l + 1, s)] += p * pR;
              if (acc) acc.epic += p * pR;
            } else {
              nx[idx(e + 1, l + 1, s)] += p * pR;
              if (acc) acc.rare += p * pR;
            }
          }
        }
      }
    }
    return nx;
  };
  let pi = new Float64Array(N);
  pi[idx(0, 0, 0)] = 1;
  for (let i = 0; i < 3000; i++) pi = step(pi);
  const acc = { mythic: 0, legendary: 0, epic: 0, rare: 0 };
  step(pi, acc);
  return acc;
}

const EXACT = exactRates();

test('exact pity-chain rates match the GDD Monte-Carlo figures (§12)', () => {
  // GDD: Mythic ≈ 1.0 %, Legendary ≈ 2.5 %, Epic ≈ 17.6 %, Rare ≈ 78.9 %; ≈ 29 pulls / L+, ≈ 96 / Mythic
  assert.ok(Math.abs(EXACT.mythic - 0.010) < 0.001, `mythic ${EXACT.mythic}`);
  assert.ok(Math.abs(EXACT.legendary - 0.025) < 0.001, `legendary ${EXACT.legendary}`);
  assert.ok(Math.abs(EXACT.epic - 0.176) < 0.001, `epic ${EXACT.epic}`);
  assert.ok(Math.abs(EXACT.rare - 0.789) < 0.001, `rare ${EXACT.rare}`);
  const perL = 1 / (EXACT.mythic + EXACT.legendary);
  const perM = 1 / EXACT.mythic;
  assert.ok(Math.abs(perL - 29) < 0.6, `pulls per L+ ${perL}`);
  assert.ok(Math.abs(perM - 96) < 1, `pulls per Mythic ${perM}`);
});

test('pullChances: base rates, soft pity steps, hard pity, Epic+ guarantee, Mythic guarantee', () => {
  const base = pullChances(emptyPity());
  assert.ok(Math.abs(base.mythic - 0.005) < 1e-12);
  assert.ok(Math.abs(base.legendary - 0.02) < 1e-12);
  assert.ok(Math.abs(base.epic - 0.15) < 1e-12);
  assert.ok(Math.abs(base.rare - 0.825) < 1e-12);
  const at = (k, extra = {}) => pullChances({ ...emptyPity(), sinceLegendaryPlus: k - 1, ...extra });
  // GDD: 46th — 8.5 %, 50th — 32.5 %, 55th — 62.5 %, 59th — 86.5 %, 60th — 100 %
  for (const [k, v] of [[45, 0.025], [46, 0.085], [50, 0.325], [55, 0.625], [59, 0.865], [60, 1]]) {
    assert.ok(Math.abs(at(k).legendaryPlus - v) < 1e-9, `pull ${k}: ${at(k).legendaryPlus}`);
  }
  const forced = at(5, { sinceEpicPlus: 9 });
  assert.equal(forced.rare, 0);
  assert.ok(forced.epicForced);
  const myth = at(5, { legendaryStreak: 4 });
  assert.equal(myth.legendary, 0);
  assert.ok(Math.abs(myth.mythic - 0.025) < 1e-12);
  for (const c of [base, forced, myth, at(52), at(60)]) {
    assert.ok(Math.abs(c.mythic + c.legendary + c.epic + c.rare - 1) < 1e-12);
  }
});

test('1 000 000 core pulls: rates, pity limits and the soft-pity hazard curve', () => {
  const N = 1_000_000;
  const rng = createRng(20261012);
  let pity = emptyPity();
  const count = { mythic: 0, legendary: 0, epic: 0, rare: 0 };
  let sinceE = 0;
  let sinceL = 0;
  let streak = 0;
  let maxE = 0;
  let maxL = 0;
  let maxStreak = 0;
  const reached = new Array(61).fill(0);
  const hit = new Array(61).fill(0);
  let cycles = 0;
  for (let i = 0; i < N; i++) {
    const k = pity.sinceLegendaryPlus + 1;
    reached[k]++;
    const r = rollRarity(pity, rng);
    pity = r.pity;
    count[r.rarity]++;
    sinceE = EPLUS.has(r.rarity) ? 0 : sinceE + 1;
    maxE = Math.max(maxE, sinceE);
    if (LPLUS.has(r.rarity)) {
      hit[k]++;
      cycles++;
      maxL = Math.max(maxL, k);
      streak = r.rarity === 'mythic' ? 0 : streak + 1;
      maxStreak = Math.max(maxStreak, streak);
      sinceL = 0;
    } else sinceL++;
  }
  // pity never exceeded
  assert.ok(maxE <= GACHA.pity.epicPlusEvery - 1, `rare run ${maxE}`);
  assert.ok(maxL <= GACHA.pity.legendaryPlusHard, `L+ gap ${maxL}`);
  assert.equal(hit[60], reached[60], 'every 60th pull is Legendary+');
  assert.ok(maxStreak <= GACHA.pity.mythicGuaranteeAfter, `non-Mythic L+ streak ${maxStreak}`);
  // rates vs exact chain (6σ, generous for the pity correlation)
  for (const r of ['mythic', 'legendary', 'epic', 'rare']) {
    const p = EXACT[r];
    const got = count[r] / N;
    const tol = 6 * Math.sqrt((p * (1 - p)) / N);
    assert.ok(Math.abs(got - p) < tol, `${r}: ${got.toFixed(5)} vs exact ${p.toFixed(5)} ±${tol.toFixed(5)}`);
  }
  // soft pity: base hazard before #46, then +6 %/pull, measured per pull index
  let baseReach = 0;
  let baseHit = 0;
  for (let k = 1; k <= 45; k++) {
    baseReach += reached[k];
    baseHit += hit[k];
  }
  const baseHazard = baseHit / baseReach;
  assert.ok(Math.abs(baseHazard - 0.025) < 0.0015, `base hazard ${baseHazard}`);
  for (let k = 46; k <= 59; k++) {
    const h = hit[k] / reached[k];
    const p = legendaryPlusChance(k);
    const tol = 5 * Math.sqrt((p * (1 - p)) / reached[k]) + 0.002;
    assert.ok(Math.abs(h - p) < tol, `hazard at ${k}: ${h.toFixed(4)} vs ${p} (n=${reached[k]})`);
  }
  const meanGap = N / cycles;
  assert.ok(Math.abs(meanGap - 1 / (EXACT.mythic + EXACT.legendary)) < 0.5, `mean pulls per L+ ${meanGap}`);
});

test('200 000 pulls through summon(): rates, pity, uniform heroes, constellations and Stardust', () => {
  let p = createProfile({ seed: 777, now: 0 });
  p = sanitizeProfile({ ...p, crystals: 1e9 });
  const PULLS = 200_000;
  const counts = { mythic: 0, legendary: 0, epic: 0, rare: 0 };
  const perHero = {};
  let sinceE = 0;
  let sinceL = 0;
  let streak = 0;
  let dust = 0;
  const dupes = {};
  for (const h of HEROES) dupes[h.id] = p.heroes[h.id] ? p.heroes[h.id].copies : 0;
  for (let i = 0; i < PULLS / 10; i++) {
    const r = summon(p, 10, { now: i });
    assert.ok(r.ok);
    for (const x of r.results) {
      counts[x.rarity]++;
      perHero[x.heroId] = (perHero[x.heroId] || 0) + 1;
      assert.equal(x.rarity, HEROES.find((h) => h.id === x.heroId).rarity);
      sinceE = EPLUS.has(x.rarity) ? 0 : sinceE + 1;
      assert.ok(sinceE < 10, 'Epic+ at least every 10');
      if (LPLUS.has(x.rarity)) {
        streak = x.rarity === 'mythic' ? 0 : streak + 1;
        assert.ok(streak <= 4, '5th Legendary+ after 4 Legendaries is Mythic');
        sinceL = 0;
      } else {
        sinceL++;
        assert.ok(sinceL < 60, 'Legendary+ by the 60th');
      }
      dupes[x.heroId]++;
      const copies = dupes[x.heroId];
      assert.equal(x.copies, copies);
      assert.equal(x.isNew, copies === 1);
      assert.equal(x.constellation, Math.min(6, copies - 1));
      if (copies > 7) {
        assert.deepEqual(x.refund, { dust: RARITIES[x.rarity].dupDustAfterC6 });
        dust += x.refund.dust;
      } else assert.equal(x.refund, undefined);
    }
    p = r.profile;
  }
  assert.equal(p.pity.total, PULLS);
  assert.equal(p.history.length, 100);
  assert.equal(p.dust, dust);
  assert.equal(p.stats.summons, PULLS);
  assert.equal(p.crystals, 1e9 - PULLS * 160 + p.stats.crystalsEarned);
  for (const r of Object.keys(counts)) {
    const got = counts[r] / PULLS;
    const tol = 6 * Math.sqrt((EXACT[r] * (1 - EXACT[r])) / PULLS);
    assert.ok(Math.abs(got - EXACT[r]) < tol, `${r}: ${got} vs ${EXACT[r]}`);
  }
  // uniform within rarity
  for (const [rarity, ids] of Object.entries(HEROES_BY_RARITY)) {
    const total = ids.reduce((a, id) => a + (perHero[id] || 0), 0);
    for (const id of ids) {
      const share = perHero[id] / total;
      const exp = 1 / ids.length;
      const tol = 6 * Math.sqrt((exp * (1 - exp)) / total);
      assert.ok(Math.abs(share - exp) < tol, `${id} share ${share} of ${rarity}`);
    }
  }
  for (const e of Object.values(p.heroes)) assert.ok(e.constellation <= 6);
});

test('novice banner: the first 20 pulls as ×10 always contain a Legendary+', () => {
  let forced = 0;
  const PLAYERS = 3000;
  for (let i = 0; i < PLAYERS; i++) {
    let p = createProfile({ seed: 1000 + i, now: 0 });
    assert.equal(bannerFor(p, 10), 'novice');
    assert.equal(bannerFor(p, 1), 'standard');
    const a = summon(p, 10, { now: 0 });
    const b = summon(a.profile, 10, { now: 0 });
    assert.equal(a.banner, 'novice');
    assert.equal(b.banner, 'novice');
    const all = [...a.results, ...b.results];
    assert.ok(all.some((x) => LPLUS.has(x.rarity)), `player ${i} got no Legendary+`);
    if (all.some((x) => x.guarantee === 'novice')) forced++;
    p = b.profile;
    assert.equal(p.crystals >= 0, true);
    assert.equal(p.pity.novicePulls, 20);
    assert.equal(bannerFor(p, 10), 'standard');
    assert.equal(summon(p, 10, { banner: 'novice' }).error, 'banner');
  }
  // P(no natural L+ in the first 19 novice pulls) ≈ 0.975^19 ≈ 0.62
  const share = forced / PLAYERS;
  assert.ok(share > 0.55 && share < 0.68, `forced share ${share}`);
});

test('costs, tickets, crystals check and failure results', () => {
  assert.equal(SUMMON_COST[1], 160);
  assert.equal(SUMMON_COST[10], 1600);
  const p = createProfile({ seed: 5, now: 0 });
  assert.equal(p.crystals, 3200);
  assert.ok(canSummon(p, 10));
  assert.ok(canSummon(p, 1));
  assert.ok(!canSummon(p, 5));
  assert.equal(summon(p, 3).error, 'count');
  const poor = sanitizeProfile({ ...p, crystals: 159 });
  assert.ok(!canSummon(poor, 1));
  const fail = summon(poor, 1);
  assert.equal(fail.ok, false);
  assert.equal(fail.error, 'crystals');
  assert.equal(fail.profile, poor, 'profile untouched on failure');
  const withTickets = sanitizeProfile({ ...poor, tickets: 3 });
  assert.deepEqual(summonCost(withTickets, 1), { tickets: 1, crystals: 0 });
  assert.deepEqual(summonCost(withTickets, 10), { tickets: 3, crystals: 1120 });
  const r = summon(withTickets, 1, 9);
  assert.ok(r.ok);
  assert.equal(r.profile.tickets, 2);
  assert.equal(r.profile.crystals, 159 + r.profile.stats.crystalsEarned - withTickets.stats.crystalsEarned);
  // single pulls do not consume the novice banner
  const s = summon(p, 1, 1);
  assert.equal(s.banner, 'standard');
  assert.equal(s.profile.pity.novicePulls, 0);
  assert.equal(s.profile.crystals, 3200 - 160 + s.profile.stats.crystalsEarned);
});

test('determinism: explicit seeds, persisted profile seed, purity', () => {
  const p = createProfile({ seed: 99, now: 0 });
  const frozen = JSON.stringify(p);
  const a = summon(p, 10, 123);
  const b = summon(p, 10, 123);
  assert.deepEqual(a.results, b.results);
  assert.equal(JSON.stringify(p), frozen, 'input profile not mutated');
  // explicit seed does not advance the profile seed; implicit pulls do
  assert.equal(a.profile.seeds.summon, p.seeds.summon);
  const c = summon(p, 10, { now: 0 });
  const d = summon(p, 10, { now: 0 });
  assert.deepEqual(c.results, d.results, 'same profile state → same pulls');
  assert.notEqual(c.profile.seeds.summon, p.seeds.summon);
  const e = summon(c.profile, 10, { now: 0 });
  assert.notDeepEqual(e.results.map((x) => x.heroId), c.results.map((x) => x.heroId));
  // injectable rng: always 0.999 → rares only until the Epic+ pity
  const r = summon(sanitizeProfile({ ...p, crystals: 1e6 }), 10, { rng: () => 0.999, banner: 'standard' });
  assert.deepEqual(r.results.map((x) => x.rarity), ['rare', 'rare', 'rare', 'rare', 'rare', 'rare', 'rare', 'rare', 'rare', 'epic']);
  assert.equal(r.results[9].guarantee, 'epic');
  assert.equal(r.best, 'epic');
});

test('hard pity, Epic+ pity and Mythic guarantee with adversarial RNGs', () => {
  const worst = () => 0.9999999; // never lucky
  let pity = emptyPity();
  const seq = [];
  for (let i = 0; i < 300; i++) {
    const r = rollRarity(pity, worst);
    pity = r.pity;
    seq.push(r);
  }
  const lplus = seq.map((r, i) => (LPLUS.has(r.rarity) ? i + 1 : 0)).filter(Boolean);
  // with an always-unlucky RNG the soft pity still lands at #60 at the latest; here: the first pull
  // index whose chance reaches 1 − 1e-7 is the hard pity
  assert.deepEqual(lplus.slice(0, 5), [60, 120, 180, 240, 300]);
  assert.equal(seq[59].guarantee, 'hard');
  // Mythic share never succeeds with this RNG (0.9999999 ≥ 0.2) → Legendary ×4, then a Mythic
  assert.deepEqual(lplus.map((i) => seq[i - 1].rarity), ['legendary', 'legendary', 'legendary', 'legendary', 'mythic']);
  assert.equal(seq[299].rarity, 'mythic');
  // Epic+ every 10th pull between them
  for (let i = 0; i < 59; i++) assert.equal(seq[i].rarity, (i + 1) % 10 === 0 ? 'epic' : 'rare', `pull ${i + 1}`);
  // soft pity: the 46th pull hits when u < 8.5 %
  const at46 = rollRarity({ ...emptyPity(), sinceLegendaryPlus: 45 }, () => 0.08);
  assert.ok(LPLUS.has(at46.rarity));
  assert.equal(at46.guarantee, 'soft');
  const miss46 = rollRarity({ ...emptyPity(), sinceLegendaryPlus: 45 }, () => 0.09);
  assert.ok(!LPLUS.has(miss46.rarity));
});

test('pityStatus counters for the summon screen', () => {
  const p = createProfile({ seed: 3, now: 0 });
  const st = pityStatus(p);
  assert.equal(st.toEpicPlus, 10);
  assert.equal(st.toLegendaryPlus, 60);
  assert.equal(st.novice.available, true);
  assert.equal(st.novice.remaining, 20);
  const q = sanitizeProfile({ ...p, pity: { ...p.pity, sinceEpicPlus: 3, sinceLegendaryPlus: 45, legendaryStreak: 4 } });
  const s2 = pityStatus(q);
  assert.equal(s2.toEpicPlus, 7);
  assert.equal(s2.toLegendaryPlus, 15);
  assert.equal(s2.inSoftPity, true);
  assert.ok(Math.abs(s2.nextLegendaryPlusChance - 0.085) < 1e-9);
  assert.equal(s2.mythicGuaranteed, true);
});
