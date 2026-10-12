// Campaign stage support (GDD §14–§15, rules.js CAMPAIGN): chapter gimmicks (dew, lava + eruptions,
// star gates + collapse), stage rules and boss mechanics.

import { CAMPAIGN, BOSS } from '../data/rules.js';
import { DARK, parseSq, rowOf, colOf, dist, homeRow } from './board.js';
import { nextRand } from './rng.js';
import { pieceAt, playable, isEmptySq, unitById, hasStatus, homeSquares, nearestEmpty } from './state.js';
import {
  emit, spawnZone, removeZone, destroyWard, dealDamage, relocate, addStatus, changeEnergy, spawnWard, flushKos,
} from './combat.js';

const FILE_COLS = { a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7 };

/** Find a stage (and its chapter) in rules.js CAMPAIGN by id. */
export function findStage(id) {
  for (const ch of CAMPAIGN) for (const st of ch.stages) if (st.id === id) return { stage: st, chapter: ch };
  return null;
}

/**
 * Normalize a StageDef (an id, a rules.js CAMPAIGN stage, or meta's stage object with an `id`) into the
 * compact serializable form stored in the battle state. Unknown objects are taken as-is.
 */
export function resolveStage(stage) {
  if (!stage) return null;
  const found = findStage(typeof stage === 'string' ? stage : stage.id);
  const st = { ...(found ? found.stage : {}), ...(typeof stage === 'object' ? stage : {}) };
  const ch = found ? found.chapter : CAMPAIGN.find((c) => c.chapter === st.chapter) || null;
  const g = ch ? ch.gimmick : null;
  const out = {
    id: st.id || null,
    chapter: ch ? ch.chapter : st.chapter || null,
    level: st.level || null,
    boss: !!st.boss,
    bossHero: st.bossHero || null,
    hpMult: st.hpMult || 1,
    miniBoss: st.miniBoss ? { hero: st.miniBoss.hero, hpMult: st.miniBoss.hpMult || 3 } : null,
    elite: st.elite || [],
    rule: st.rule ? { ...st.rule } : null,
    roundLimit: st.roundLimit || (ch ? ch.roundLimit : null),
    threeStarRounds: st.threeStarRounds || (ch ? ch.threeStarRounds : null),
    mechanics: (st.mechanics || []).map((m) => (typeof m === 'string' ? m : m.id)),
    fireRain: null,
    bossRules: st.bossRules ? st.bossRules.map((r) => ({ rule: r.rule, params: { ...r.params } })) : null,
    gimmick: g ? g.id : null,
    dew: null,
    lava: null,
    portals: null,
    collapse: null,
  };
  const fr = (st.mechanics || []).find((m) => m && m.id === 'fireRain');
  if (fr) out.fireRain = { every: fr.every || 3, mult: fr.mult || 1.2 };
  if (g && g.id === 'dew') out.dew = g.squares.map(parseSq);
  if (g && g.id === 'lava') {
    const every = out.rule && out.rule.id === 'eruptionEvery' ? out.rule.rounds : g.eruptionEvery;
    out.lava = { sqs: g.squares.map(parseSq), every, eruptionPct: g.eruptionPctMaxHp, lavaPct: g.lavaPctMaxHp };
  }
  if (g && g.id === 'portals-collapse') {
    out.portals = g.portals.map(([a, b]) => [parseSq(a), parseSq(b)]);
    const shift = st.collapseShift || 0;
    out.collapse = { steps: g.collapse.map((c) => ({ round: c.round + shift, files: c.files || null, ranks: c.ranks || null })), pct: g.collapsePctMaxHp };
  }
  return out;
}

/** Boss / mini-boss descriptor for a squad entry of the enemy side (null when not a boss). */
export function bossFor(stage, entry, taken) {
  if (!stage) {
    if (entry.boss || entry.miniBoss) return { mini: !!entry.miniBoss && !entry.boss, hpMult: entry.hpMult || 1, mechanics: [], phase: 1 };
    return null;
  }
  if ((entry.boss || (stage.boss && stage.bossHero === entry.heroId)) && !taken.boss) {
    taken.boss = true;
    return { mini: false, hpMult: entry.hpMult || stage.hpMult || 1, mechanics: stage.mechanics.slice(), phase: 1 };
  }
  if ((entry.miniBoss || (stage.miniBoss && stage.miniBoss.hero === entry.heroId)) && !taken.mini) {
    taken.mini = true;
    return { mini: true, hpMult: entry.hpMult || (stage.miniBoss ? stage.miniBoss.hpMult : 3), mechanics: [], phase: 1 };
  }
  return null;
}

/** Variant (named-rule overrides) for a boss unit. */
export function bossVariant(stage, heroId, boss) {
  if (!boss || boss.mini) return null;
  const rules = {};
  for (const r of (stage && stage.bossRules) || []) rules[r.rule] = r.params;
  if (boss.mechanics.includes('bossEgg')) rules.eggRevive = { eggHpPct: 0.2, hatchAfterTurns: 2, hatchHpPct: 0.5, hatchEnergy: 'full', hatchBlastMult: 0 };
  if (!Object.keys(rules).length) return null;
  const key = `boss:${stage && stage.id}:${Object.keys(rules).sort().join(',')}`;
  return { key, rules };
}

/** Squares removed before the battle (stage rule removeFiles). */
export function initialHoles(stage) {
  if (!stage || !stage.rule || stage.rule.id !== 'removeFiles') return [];
  const cols = stage.rule.files.map((f) => FILE_COLS[f]);
  return DARK.filter((q) => cols.includes(colOf(q)));
}

/** Battle-start stage objects: environment zones, the caravan. Called by createBattle. */
export function stageSetup(ctx) {
  const s = ctx.s;
  const st = s.stage;
  if (!st) return;
  if (st.dew) spawnZone(ctx, null, st.dew, { kind: 'dew', turns: null, affects: 'any', side: 0, onTurnStart: [{ op: 'seal', element: 'tide' }] });
  if (st.lava) spawnZone(ctx, null, st.lava.sqs, { kind: 'lava', turns: null, affects: 'any', side: 0, onTurnStart: [{ op: 'trueDamagePct', pct: st.lava.lavaPct, label: 'lava' }] });
  if (st.portals) for (const [a, b] of st.portals) spawnZone(ctx, null, [a, b], { kind: 'gate', turns: null, affects: 'any', side: 0 });
  if (st.rule && st.rule.id === 'escort') {
    const sq = parseSq(st.rule.square);
    const total = s.units.filter((u) => u.side === 1).reduce((a, u) => a + u.maxHp, 0);
    spawnWard(ctx, null, sq, { kind: st.rule.ward || 'caravan', hp: Math.max(1, Math.floor(total * st.rule.hpPctSquad)), turns: null, jumpable: true, special: 'caravan', side: 1 });
  }
}

/** Round start (before the first side's turn start): eruptions, collapse, fire-rain warnings, pawns. */
export function stageRoundStart(ctx) {
  const s = ctx.s;
  const st = s.stage;
  if (!st) return;
  const r = s.round;
  if (st.lava && st.lava.every > 0) {
    const w = s.warn.eruption;
    if (w && w.round === r) {
      const sqs = DARK.filter((q) => rowOf(q) === w.row && playable(s, q));
      emit(ctx, { type: 'eruption', row: w.row, sqs, round: r });
      for (const u of s.units.slice()) {
        if (u.alive && u.sq >= 0 && rowOf(u.sq) === w.row) dealDamage(ctx, null, u, { kind: 'true', flat: Math.max(1, Math.floor(st.lava.eruptionPct * u.maxHp)), label: 'eruption', element: 'flame' });
      }
      s.warn.eruption = null;
      flushKos(ctx);
    }
    if ((r + 1) % st.lava.every === 0) {
      const row = Math.floor(nextRand(s) * 8);
      s.warn.eruption = { row, round: r + 1 };
      emit(ctx, { type: 'warning', kind: 'eruption', row, sqs: DARK.filter((q) => rowOf(q) === row), round: r + 1 });
    }
  }
  if (st.collapse) {
    for (const step of st.collapse.steps) if (step.round === r) collapse(ctx, step);
  }
  if (st.fireRain) {
    const boss = s.units.find((u) => u.alive && u.boss && !u.boss.mini && u.boss.mechanics.includes('fireRain'));
    if (boss && r % st.fireRain.every === 0 && !s.warn.fireRain) {
      const foes = s.units.filter((u) => u.alive && u.sq >= 0 && u.side !== boss.side);
      const centers = [];
      const pool = foes.map((u) => u.sq);
      while (centers.length < 3 && pool.length) centers.push(pool.splice(Math.floor(nextRand(s) * pool.length), 1)[0]);
      while (centers.length < 3) {
        const q = DARK[Math.floor(nextRand(s) * DARK.length)];
        if (playable(s, q) && !centers.includes(q)) centers.push(q);
      }
      const sqs = [];
      for (const c of centers) for (const q of DARK) if (dist(q, c) <= 1 && playable(s, q) && !sqs.includes(q)) sqs.push(q);
      const z = spawnZone(ctx, null, sqs, { kind: 'fire-rain', turns: null, affects: 'any', side: 0, stack: true });
      s.warn.fireRain = { side: boss.side, boss: boss.id, centers, sqs, zone: z.id, armedTurn: s.turn + 1 };
      emit(ctx, { type: 'warning', kind: 'fireRain', centers, sqs, round: r });
    }
  }
}

function collapse(ctx, step) {
  const s = ctx.s;
  const cols = (step.files || []).map((f) => FILE_COLS[f]);
  const rows = (step.ranks || []).map((rk) => 8 - rk);
  const sqs = DARK.filter((q) => (cols.includes(colOf(q)) || rows.includes(rowOf(q))) && !s.holes.includes(q));
  if (!sqs.length) return;
  s.holes.push(...sqs);
  if (rows.includes(0) && s.awakenRows[1] === 0) s.awakenRows[1] = 1;
  if (rows.includes(7) && s.awakenRows[-1] === 7) s.awakenRows[-1] = 6;
  emit(ctx, { type: 'collapse', sqs, round: s.round, awakenRows: { 1: s.awakenRows[1], '-1': s.awakenRows[-1] } });
  for (const w of s.wards.slice()) if (sqs.includes(w.sq)) destroyWard(ctx, w, 'collapse');
  for (const z of s.zones.slice()) {
    if (!z.sqs.some((q) => sqs.includes(q))) continue;
    z.sqs = z.sqs.filter((q) => !sqs.includes(q));
    if (!z.sqs.length) removeZone(ctx, z, 'collapse');
  }
  for (const u of s.units) {
    if (!u.alive || u.sq < 0 || !sqs.includes(u.sq)) continue;
    const to = inwardSquare(s, u.sq);
    if (to >= 0) relocate(ctx, u, to, 'collapse', { voluntary: false });
    dealDamage(ctx, null, u, { kind: 'true', flat: Math.max(1, Math.floor(s.stage.collapse.pct * u.maxHp)), label: 'collapse' });
  }
  flushKos(ctx);
}

function inwardSquare(s, from) {
  let best = -1;
  let bestKey = null;
  for (const q of DARK) {
    if (!isEmptySq(s, q)) continue;
    const key = [dist(q, from), Math.abs(rowOf(q) - 3.5) + Math.abs(colOf(q) - 3.5), q];
    if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) {
      best = q;
      bestKey = key;
    }
  }
  return best;
}

/** Start of a side's turn: fire-rain strike, boss pawns and their energy. */
export function stageTurnStart(ctx, side) {
  const s = ctx.s;
  const fr = s.warn.fireRain;
  if (fr && fr.side === side && s.turn >= fr.armedTurn) {
    const boss = unitById(s, fr.boss);
    s.warn.fireRain = null;
    const z = s.zones.find((x) => x.id === fr.zone);
    if (z) removeZone(ctx, z, 'struck');
    emit(ctx, { type: 'fireRain', centers: fr.centers, sqs: fr.sqs, source: fr.boss });
    if (boss && boss.alive) {
      const victims = s.units.filter((u) => u.alive && u.sq >= 0 && u.side !== boss.side && fr.sqs.includes(u.sq));
      for (const v of victims) dealDamage(ctx, boss, v, { mult: s.stage.fireRain.mult, element: 'flame', kind: 'hit', source: 'boss', label: 'fireRain' });
      flushKos(ctx);
    }
  }
  for (const b of s.units) {
    if (!b.alive || b.side !== side || !b.boss || !b.boss.mechanics.includes('phase2')) continue;
    const pawns = s.wards.filter((w) => w.special === 'pawn' && w.owner === b.id);
    if (pawns.length) changeEnergy(ctx, b, 10 * pawns.length, 'pawns', false);
    if (b.boss.phase === 2 && (b.boss.lastPawnRound == null || s.round - b.boss.lastPawnRound >= 2)) {
      b.boss.lastPawnRound = s.round;
      const cands = homeSquares(s, b.side, 1).filter((q) => isEmptySq(s, q)).sort((a, c) => Math.abs(colOf(a) - 3.5) - Math.abs(colOf(c) - 3.5) || a - c);
      for (const q of cands.slice(0, 2)) spawnWard(ctx, b, q, { kind: 'hollow-pawn', hp: Math.max(1, Math.floor(0.1 * b.maxHp)), turns: null, jumpable: true, special: 'pawn' });
    }
  }
}

/** Boss thresholds after damage: phases (3-B), Gale Escape (1-B). */
export function stageAfterDamage(ctx, u, hpBefore) {
  const b = u.boss;
  if (!b || b.mini || !u.alive) return;
  const pct = u.hp / u.maxHp;
  if (b.mechanics.includes('phase1') || b.mechanics.includes('phase2') || b.mechanics.includes('phase3')) {
    const phase = pct > 0.6 ? 1 : pct > 0.3 ? 2 : 3;
    if (phase > b.phase) {
      b.phase = phase;
      emit(ctx, { type: 'bossPhase', unit: u.id, phase });
    }
  }
  if (b.mechanics.includes('galeEscape') && !b.escaped && pct <= 0.5 && u.hp > 0) {
    b.escaped = true;
    emit(ctx, { type: 'rule', unit: u.id, rule: 'galeEscape' });
    addStatus(ctx, u, u, 'untargetable', { turns: 1, force: true });
    const to = nearestEmpty(ctx.s, u.sq, homeSquares(ctx.s, u.side, 1));
    if (to >= 0) relocate(ctx, u, to, 'teleport', { voluntary: false });
  }
}

/** Star gate destination for a unit that ended its movement on a gate square (-1 if none). */
export function stageGateFor(ctx, u) {
  const s = ctx.s;
  if (!s.stage || !s.stage.portals || !s.act) return -1;
  s.act.gated = s.act.gated || {};
  if (s.act.gated[u.id]) return -1;
  for (const [a, b] of s.stage.portals) {
    const to = u.sq === a ? b : u.sq === b ? a : -1;
    if (to < 0) continue;
    if (!isEmptySq(s, to)) return -1;
    s.act.gated[u.id] = 1;
    return to;
  }
  return -1;
}

/** Feather trail (1-B): squares the boss glides through become feathers for 2 turns. */
export function stageAfterMove(ctx, u, path, kind) {
  if (!u.boss || u.boss.mini || !u.boss.mechanics.includes('featherTrail')) return;
  if (kind !== 'glide' && kind !== 'flight') return;
  const sqs = path.slice(1);
  if (!sqs.length) return;
  spawnZone(ctx, u, sqs, { kind: 'feathers', turns: 2, affects: 'enemy', onEnter: [{ op: 'status', id: 'slow', turns: 1 }], stack: true });
}

/** Does the boss get an extra activation this turn? */
export function bossExtraDue(s, b) {
  if (!b.boss || b.boss.mini || !b.alive) return false;
  if (b.boss.phase === 3 && b.boss.mechanics.includes('phase3')) return true;
  return s.sideTurns[b.side] % BOSS.extraActivationEvery === 0;
}

export { homeRow, hasStatus, pieceAt };
