// Legal options of units: basic attacks, skill / ultimate / quirk picks, moves, jumps, pending choices.
// Shared by applyAction (validation), legalActions, unitActions and the AI.

import { unitDef } from './defs.js';
import { neighbors, dist, dirBetween, stepSq } from './board.js';
import { occupancy, hasStatus, isDisabled, unitById, playable, isEmptySq, pieceAt } from './state.js';
import { basicRange } from './stats.js';
import { enumeratePicks, matchPick, applyTaunt, hiddenFrom, abilityDamages } from './targeting.js';
import { moveOptions, jumpChains, pendingOptions, displaceImmune } from './movement.js';
import { adjacentLanding } from './effects.js';

/** Can the unit start (or continue) an activation now? */
export function canActivate(s, u) {
  if (!u || s.result || !u.alive || u.sq < 0 || u.side !== s.side) return false;
  if (s.act) return s.act.unit === u.id;
  return !isDisabled(u);
}

export function activatableUnits(s) {
  if (s.result) return [];
  if (s.act) {
    const u = unitById(s, s.act.unit);
    return u && u.alive ? [u] : [];
  }
  return s.units.filter((u) => u.alive && u.sq >= 0 && u.side === s.side && !isDisabled(u));
}

/** 'start' | 'moved' | 'pending' | null for a unit. */
export function phaseOf(s, u) {
  if (!canActivate(s, u)) return null;
  if (!s.act) return 'start';
  if (s.act.pending.length) return 'pending';
  if (s.act.acted) return null;
  return s.act.moved ? 'moved' : 'start';
}

function chargedPierce(u) {
  const ch = unitDef(u).rules.chargeStacks;
  if (!ch || !ch.pierceWhenCharged) return false;
  const st = hasStatus(u, 'charge');
  return !!(st && st.stacks > 0);
}

/**
 * Basic attack picks: [{ key, target, recv: [piece], covered, heal?, pointBlank?, dir? }].
 * Rangers shoot the first piece on a diagonal (allies block); a charged Reika pierces the whole ray.
 */
export function basicPicks(s, u) {
  const def = unitDef(u);
  const b = def.basic;
  const range = basicRange(s, u);
  const occ = occupancy(s);
  let picks = [];
  if (b.los === 'adjacent') {
    for (const n of neighbors(u.sq)) {
      const p = occ[n];
      if (p && p.side !== u.side && !hiddenFrom(u, p, 1)) picks.push({ key: `u${n}`, target: n, recv: [p], covered: [n], center: p.id, centerSq: n, first: p });
    }
  } else if (b.los === 'diag') {
    if (chargedPierce(u)) {
      const ab = { target: { shape: 'line', length: range, pierce: true, side: 'enemy' }, effects: [{ op: 'damage' }] };
      for (const p of enumeratePicks(s, u, ab, { occ })) picks.push({ ...p, target: p.first.sq, pierce: true });
    } else {
      for (let d = 0; d < 4; d++) {
        const covered = [];
        for (let k = 1; k <= range; k++) {
          const q = stepSq(u.sq, d, k);
          if (q < 0 || !playable(s, q)) break;
          covered.push(q);
          const p = occ[q];
          if (!p) continue;
          if (hiddenFrom(u, p, k)) continue;
          if (p.side !== u.side) picks.push({ key: `u${q}`, target: q, recv: [p], covered: covered.slice(), pointBlank: k === 1, dir: d, center: p.id, centerSq: q, first: p });
          break;
        }
      }
    }
  } else {
    for (const p of [...s.units, ...s.wards]) {
      if (p.isWard ? false : !p.alive || p.sq < 0) continue;
      if (p.side === u.side) continue;
      const d = dist(u.sq, p.sq);
      if (d > range || hiddenFrom(u, p, d)) continue;
      picks.push({ key: `u${p.sq}`, target: p.sq, recv: [p], covered: [p.sq], center: p.id, centerSq: p.sq, first: p });
    }
  }
  picks = applyTaunt(s, u, picks, true);
  if (b.allyHeal) {
    for (const a of s.units) {
      if (!a.alive || a.sq < 0 || a === u || a.side !== u.side || dist(u.sq, a.sq) > range) continue;
      picks.push({ key: `h${a.sq}`, target: a.sq, recv: [a], covered: [a.sq], heal: true, center: a.id, centerSq: a.sq, first: a });
    }
  }
  return picks;
}

/** Basic attack pick matching an action target (null if illegal). */
export function matchBasic(s, u, picks, target) {
  let p = picks.find((x) => x.target === target);
  if (p) return p;
  // piercing shots: any square of the chosen ray
  const d = dirBetween(u.sq, target);
  if (d >= 0) p = picks.find((x) => x.pierce && dirBetween(u.sq, x.target) === d);
  return p || null;
}

/** Landing square of a tossed ally (Zlata): farthest empty square within range along the diagonal. */
export function tossLanding(s, z, ally, range) {
  const d = dirBetween(z.sq, ally.sq);
  if (d < 0) return -1;
  let best = -1;
  for (let k = 1; k <= range; k++) {
    const q = stepSq(ally.sq, d, k);
    if (q < 0) break;
    if (isEmptySq(s, q)) best = q;
  }
  return best;
}

/** Picks of an ability (skill / ultimate / quirk action) with taunt and ability-specific filters. */
export function abilityPicks(s, u, ability, o = {}) {
  const damaging = abilityDamages(ability);
  let picks = enumeratePicks(s, u, ability, { pierce: damaging && chargedPierce(u), squareCap: o.squareCap });
  if (ability.effects && ability.effects.some((e) => e.op === 'moveSelf' && e.to === 'adjacentToTarget')) {
    picks = picks.filter((p) => {
      const t = p.first || (p.recv && p.recv[0]);
      return t && (dist(t.sq, u.sq) === 1 || adjacentLanding(s, u, t, p) >= 0);
    });
  }
  if (ability.rule === 'tossAlly') {
    picks = picks.filter((p) => {
      const a = p.recv[0];
      return a && !a.isWard && !displaceImmune(a) && tossLanding(s, u, a, ability.params.range) >= 0;
    });
  }
  return applyTaunt(s, u, picks, damaging);
}

/** { ok, reason, picks, ability } for the skill. */
export function skillOptions(s, u, o = {}) {
  const def = unitDef(u);
  const ability = def.skill;
  if (!ability) return { ok: false, reason: 'none', picks: [], ability: null };
  if ((u.cd.skill || 0) > 0) return { ok: false, reason: 'cooldown', picks: [], ability };
  if (hasStatus(u, 'silence')) return { ok: false, reason: 'silenced', picks: [], ability };
  const picks = abilityPicks(s, u, ability, o);
  return picks.length ? { ok: true, reason: null, picks, ability } : { ok: false, reason: 'no-targets', picks, ability };
}

export function ultOptions(s, u, o = {}) {
  const def = unitDef(u);
  const ability = def.ultimate;
  if (u.energy < u.maxEnergy) return { ok: false, reason: 'energy', picks: [], ability };
  if (hasStatus(u, 'silence')) return { ok: false, reason: 'silenced', picks: [], ability };
  if (isDisabled(u)) return { ok: false, reason: 'stunned', picks: [], ability };
  const picks = abilityPicks(s, u, ability, o);
  return picks.length ? { ok: true, reason: null, picks, ability } : { ok: false, reason: 'no-targets', picks, ability };
}

export function quirkOptions(s, u, o = {}) {
  const out = [];
  for (const qa of unitDef(u).quirkActions) {
    const used = u.uses[`q:${qa.id}`] || 0;
    if (qa.usesPerBattle != null && used >= qa.usesPerBattle) {
      out.push({ id: qa.id, ok: false, reason: 'used', picks: [], ability: qa });
      continue;
    }
    if ((u.cd.quirk[qa.id] || 0) > 0) {
      out.push({ id: qa.id, ok: false, reason: 'cooldown', picks: [], ability: qa });
      continue;
    }
    const picks = abilityPicks(s, u, qa, o);
    out.push({ id: qa.id, ok: picks.length > 0, reason: picks.length ? null : 'no-targets', picks, ability: qa });
  }
  return out;
}

/** Jump chains with the taunt restriction applied. */
export function jumpOptions(s, u) {
  const chains = jumpChains(s, u);
  if (!chains.length) return chains;
  const t = hasStatus(u, 'taunt');
  if (!t || !t.source) return chains;
  const src = unitById(s, t.source);
  if (!src || !src.alive) return chains;
  const withT = chains.filter((c) => c.hops.some((h) => h.victim === src.id));
  return withT.length ? withT : chains;
}

/** Action fields that identify a pick of an ability. */
export function pickFields(ability, pick) {
  const shape = (ability.target && ability.target.shape) || 'self';
  if (shape === 'jump') return { path: pick.path.slice() };
  if (shape === 'lines' || shape === 'square') return { targets: pick.targets.slice() };
  return { target: pick.target };
}

/** Acting options of the active unit at its current square (no movement). */
export function actOptions(s, u, o = {}) {
  const out = [];
  for (const p of basicPicks(s, u)) out.push({ type: 'basic', unit: u.id, target: p.target });
  const sk = skillOptions(s, u, o);
  if (sk.ok) for (const p of sk.picks) out.push({ type: 'skill', unit: u.id, ...pickFields(sk.ability, p) });
  const ul = ultOptions(s, u, o);
  if (ul.ok) for (const p of ul.picks) out.push({ type: 'ult', unit: u.id, ...pickFields(ul.ability, p) });
  for (const q of quirkOptions(s, u, o)) if (q.ok) for (const p of q.picks) out.push({ type: 'quirk', unit: u.id, quirk: q.id, ...pickFields(q.ability, p) });
  return out;
}

/** Every legal step-level action of the side to act (see index.js for the action format). */
export function legalActions(s) {
  if (!s || s.result) return [];
  const out = [];
  if (s.act) {
    const u = unitById(s, s.act.unit);
    if (!u || !u.alive) return [{ type: 'pass' }];
    if (s.act.pending.length) {
      const pend = s.act.pending[0];
      for (const m of pendingOptions(s, u, pend)) out.push({ type: 'move', unit: u.id, to: m.to });
      if (pend.optional || !out.length) out.push({ type: 'pass', unit: u.id });
      return out;
    }
    if (s.act.moved) {
      out.push(...actOptions(s, u));
      out.push({ type: 'pass', unit: u.id });
      return out;
    }
    unitStartOptions(s, u, out);
    return out;
  }
  const units = activatableUnits(s);
  if (!units.length) return [{ type: 'pass' }];
  for (const u of units) unitStartOptions(s, u, out);
  return out;
}

function unitStartOptions(s, u, out) {
  out.push({ type: 'pass', unit: u.id });
  const mo = moveOptions(s, u);
  for (const m of mo.moves) out.push({ type: 'move', unit: u.id, to: m.to });
  for (const m of mo.swaps) out.push({ type: 'move', unit: u.id, to: m.to });
  for (const c of jumpOptions(s, u)) out.push({ type: 'jump', unit: u.id, path: c.path.slice() });
  out.push(...actOptions(s, u));
}

function abilityView(s, u, opt, ability) {
  if (!ability) return { ok: false, reason: 'none', targets: [], pick: 0, area: () => [] };
  const shape = (ability.target && ability.target.shape) || 'self';
  const picks = opt.picks || [];
  const targets = new Set();
  for (const p of picks) {
    if (shape === 'line' || shape === 'lines') p.covered.forEach((q) => targets.add(q));
    else if (shape === 'row') p.covered.forEach((q) => targets.add(q));
    else if (shape === 'square') p.targets.forEach((q) => targets.add(q));
    else if (shape === 'jump') targets.add(p.target);
    else targets.add(p.target);
  }
  const area = (sq) => {
    if (shape === 'square') return sq != null && targets.has(sq) ? [sq] : [];
    let p = null;
    if (shape === 'line' || shape === 'lines') p = picks.find((x) => x.covered.includes(sq));
    else if (shape === 'row') p = picks.find((x) => x.covered.includes(sq));
    else if (shape === 'jump') p = picks.find((x) => x.target === sq);
    else p = picks.find((x) => x.target === sq) || (picks.length === 1 ? picks[0] : null);
    if (!p) return [];
    if (shape === 'lines') {
      const d = dirBetween(u.sq, sq);
      return p.covered.filter((q) => dirBetween(u.sq, q) === d);
    }
    return p.covered.slice();
  };
  const count = shape === 'lines' ? ability.target.dirs || 1 : shape === 'square' ? ability.target.count || 1 : 1;
  return {
    ok: opt.ok,
    reason: opt.reason,
    id: ability.id,
    name: ability.name,
    shape,
    targets: [...targets],
    pick: count,
    paths: shape === 'jump' ? picks.map((p) => p.path.slice()) : undefined,
    area,
    selfCast: ['self', 'all', 'auto'].includes(shape) || ((shape === 'radius' || shape === 'diagonals') && (ability.target.center || 'caster') === 'caster'),
  };
}

/**
 * Everything the UI needs to show for one unit (contract: moves, jumps, basic, skill, ult) plus
 * swaps, paths, quirks, pending choices and the activation phase.
 */
export function unitActions(s, unitId) {
  const u = unitById(s, unitId);
  const empty = { moves: [], swaps: [], paths: {}, jumps: [], basic: [], basicHeal: [], skill: { ok: false, reason: 'unavailable', targets: [], pick: 0, area: () => [] }, ult: { ok: false, reason: 'unavailable', targets: [], pick: 0, area: () => [] }, quirks: [], canWait: false, canEnd: false, pending: null };
  if (!u) return { ...empty, unit: unitId, phase: null, reason: 'unknown' };
  const def = unitDef(u);
  const phase = phaseOf(s, u);
  const res = { ...empty, unit: u.id, phase, reason: null };
  if (!phase) {
    res.reason = !u.alive ? 'ko' : u.side !== s.side ? 'not-your-turn' : s.act && s.act.unit !== u.id ? 'other-active' : isDisabled(u) ? 'disabled' : 'done';
    // still describe the abilities' readiness for the HUD
    res.skill = { ...abilityView(s, u, { ok: false, reason: res.reason, picks: [] }, def.skill), cooldown: u.cd.skill, maxCooldown: def.skill ? def.skill.cooldown : 0 };
    res.ult = { ...abilityView(s, u, { ok: false, reason: u.energy < u.maxEnergy ? 'energy' : res.reason, picks: [] }, def.ultimate), energy: u.energy, cost: u.maxEnergy };
    return res;
  }
  if (phase === 'pending') {
    const pend = s.act.pending[0];
    const opts = pendingOptions(s, u, pend);
    res.pending = { kind: pend.kind, squares: opts.map((m) => m.to), optional: !!pend.optional || !opts.length, paths: Object.fromEntries(opts.map((m) => [m.to, m.path])) };
    return res;
  }
  if (phase === 'start') {
    const mo = moveOptions(s, u);
    res.moves = mo.moves.map((m) => m.to);
    res.swaps = mo.swaps.map((m) => m.to);
    for (const m of mo.moves) res.paths[m.to] = m.path;
    res.jumps = jumpOptions(s, u).map((c) => c.path.slice());
    res.canWait = true;
  } else res.canEnd = true;
  const bp = basicPicks(s, u);
  res.basic = bp.filter((p) => !p.heal).map((p) => p.target);
  res.basicHeal = bp.filter((p) => p.heal).map((p) => p.target);
  res.basicArea = (sq) => {
    const p = bp.find((x) => x.target === sq);
    return p ? p.covered.slice() : [];
  };
  const sk = skillOptions(s, u);
  res.skill = { ...abilityView(s, u, sk, sk.ability), cooldown: u.cd.skill, maxCooldown: def.skill ? def.skill.cooldown : 0 };
  const ul = ultOptions(s, u);
  res.ult = { ...abilityView(s, u, ul, ul.ability), energy: u.energy, cost: u.maxEnergy };
  res.quirks = quirkOptions(s, u).map((q) => ({ ...abilityView(s, u, q, q.ability), uses: u.uses[`q:${q.id}`] || 0, usesPerBattle: q.ability.usesPerBattle, cooldown: u.cd.quirk[q.id] || 0 }));
  return res;
}

/** Heuristic choice for a pending relocation (the AI's / auto-resolve "safest square"). */
export function safestSquare(s, u, squares, includeStay) {
  const enemies = s.units.filter((e) => e.alive && e.sq >= 0 && e.side !== u.side);
  const score = (q) => {
    let threat = 0;
    for (const e of enemies) {
      const d = dist(q, e.sq);
      if (d <= 1) threat += 3;
      else if (d <= 2) threat += 1.5;
      else if (d <= 4 && e.role === 'ranger' && dirBetween(e.sq, q) >= 0) threat += 1;
    }
    let allies = 0;
    for (const n of neighbors(q)) {
      const p = pieceAt(s, n);
      if (p && !p.isWard && p.side === u.side && p !== u) allies++;
    }
    return threat - allies * 0.5;
  };
  let best = includeStay ? u.sq : -1;
  let bestScore = includeStay ? score(u.sq) - 0.01 : Infinity;
  for (const q of squares) {
    const sc = score(q);
    if (sc < bestScore - 1e-9 || (Math.abs(sc - bestScore) < 1e-9 && q < best)) {
      best = q;
      bestScore = sc;
    }
  }
  return best;
}

export { matchPick, pendingOptions, moveOptions };
