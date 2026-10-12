// Greedy evaluation of a simulated activation (GDD §10.2), in "HP points".

import { AI, ROLES, reactionFor, defenseFactor } from '../data/rules.js';
import { unitById, wardById, hasStatus, isDisabled } from '../battle/state.js';
import { unitDef } from '../battle/defs.js';
import { atkEff, defEff } from '../battle/stats.js';
import { dist, rowsAdvanced, dirBetween } from '../battle/board.js';

const W = AI.weights;
const CONTROL = W.control;
const DEBUFF = W.debuff;
const BUFF = { inspire: 0.3, brace: 0.08, regen: 0.6, untargetable: 0.5 };
const MELEE = new Set(['guardian', 'blade', 'shadow']);

export function targetValue(u) {
  let v = ROLES[u.role].ai.targetValue;
  if (u.energy >= u.maxEnergy) v *= W.ultReadyTargetMult;
  return v;
}

function wardValue(w, me) {
  switch (w.special) {
    case 'caravan':
      return 2.5;
    case 'egg':
      return 1.4;
    case 'decoy':
      return 0.9;
    case 'pawn':
      return 0.8;
    case 'candle':
      return 40;
    default:
      return w.kind === 'ball-lightning' ? 40 : 0.12;
  }
}

/** Rough reach (squares) of an enemy's best attack next turn. */
function reachOf(s, e) {
  if (hasStatus(e, 'root')) return attackReach(s, e);
  let mv;
  const def = unitDef(e);
  if (hasStatus(e, 'slow')) mv = 1;
  else if (def.rules.blinkMove) mv = def.rules.blinkMove.range + (e.awakened ? 1 : 0);
  else if (def.move.type === 'glide') mv = def.move.length + (e.heroId === 'iskra' ? 1 : 0);
  else if (def.move.type === 'blink') mv = def.move.range;
  else mv = def.move.steps || 1;
  if (e.awakened) mv = Math.max(mv, e.role === 'shadow' ? 7 : 4);
  return mv + attackReach(s, e);
}

function attackReach(s, e) {
  const def = unitDef(e);
  let r = def.basic.range + (e.heroId === 'reika' ? 1 : 0);
  if (MELEE.has(e.role)) r = 2; // jump-strike lands beyond the victim
  if (e.energy >= e.maxEnergy) r += 3;
  return r;
}

/**
 * Max damage `t` can take next enemy turn (one activation), estimated from the enemies' stats,
 * reach, skill readiness and full energy.
 */
export function threatTo(s, t) {
  if (!t.alive || t.sq < 0 || hasStatus(t, 'untargetable')) return 0;
  let best = 0;
  const tDef = defEff(s, t);
  for (const e of s.units) {
    if (!e.alive || e.sq < 0 || e.side === t.side || isDisabled(e)) continue;
    const d = dist(e.sq, t.sq);
    if (d > reachOf(s, e)) continue;
    let mult = 1.0;
    if (e.role === 'blade') mult = 1.5;
    else if (e.role === 'shadow') mult = 1.3;
    else if (e.role === 'ranger') mult = dirBetween(e.sq, t.sq) >= 0 ? 1.1 : 0.9;
    else if (e.role === 'oracle') mult = 0.6;
    else if (e.role === 'guardian') mult = 0.9;
    if (e.cd.skill === 0 && !hasStatus(e, 'silence')) mult = Math.max(mult, 1.5);
    if (e.energy >= e.maxEnergy && !hasStatus(e, 'silence')) mult = Math.max(mult, 2.2);
    const dmg = atkEff(s, e) * mult * defenseFactor(e.level, tDef);
    if (dmg > best) best = dmg;
  }
  return best;
}

function statusTurns(st) {
  return st.turns == null ? 2 : Math.min(3, st.turns + (st.fresh ? 1 : 0));
}

/**
 * Score of `after` (state after the simulated activation) relative to `root` for side `me`.
 * info = { actorId, kind ('wait'|'move'|'basic'|'skill'|'ult'|'quirk'|'jump'), events }
 * Returns { score, kos, affected, healed, teamMissing }.
 */
export function evaluate(root, after, me, info, weights = {}) {
  // late-game pressure: the closer the round limit, the less the AI cares about exposure
  const pressure = Math.min(1, Math.max(0, (root.round - 0.4 * root.roundLimit) / (0.6 * root.roundLimit)));
  const dangerW = (weights.danger != null ? weights.danger : W.danger) * (1 - 0.7 * pressure);
  if (after.result) {
    const w = after.result.winner;
    return { score: w === me ? 1e6 : w === 0 ? -500 : -1e6, kos: 6, affected: 6, healed: 0, teamMissing: 0 };
  }
  let score = 0;
  let kos = 0;
  let healed = 0;
  let teamMissing = 0;
  const affected = new Set();
  const allyReact = (seal) => {
    const atks = [];
    for (const a of after.units) if (a.alive && a.side === me && reactionFor(a.element, seal)) atks.push(a.atk);
    atks.sort((x, y) => y - x);
    return (atks[0] || 0) + (atks[1] || 0);
  };
  for (const b of root.units) {
    const a = unitById(after, b.id);
    if (b.side !== me) {
      if (!b.alive) continue;
      const val = targetValue(b);
      const hpAfter = a.alive ? a.hp : 0;
      const loss = Math.max(0, b.hp - hpAfter) + Math.max(0, b.shield - (a.alive ? a.shield : 0));
      if (loss > 0) affected.add(b.id);
      score += loss * val * W.damage * (1 + 0.5 * pressure);
      if (!a.alive) {
        kos++;
        let bonus = W.koBonusPctMaxHp * b.maxHp + (b.energy >= b.maxEnergy ? W.koUltReadyBonusPctMaxHp * b.maxHp : 0);
        if (a.egg) bonus *= 0.35;
        score += bonus;
        continue;
      }
      const atk = Math.max(1, b.atk);
      for (const st of a.statuses) {
        const before = hasStatus(b, st.id);
        const gain = before ? Math.max(0, statusTurns(st) - statusTurns(before)) : statusTurns(st);
        if (!gain) continue;
        if (CONTROL[st.id] != null) score += CONTROL[st.id] * atk * gain;
        else if (DEBUFF[st.id] != null) score += DEBUFF[st.id] * atk * gain;
        else if (st.id === 'stagger') score += 0.4 * atk;
        else if (st.id === 'break') score += 1.6 * atk;
        else continue;
        affected.add(b.id);
      }
      for (const st of b.statuses) if (BUFF[st.id] != null && !hasStatus(a, st.id)) score += BUFF[st.id] * atk * 1.5;
      for (const se of a.seals) {
        if (b.seals.some((x) => x.element === se.element)) continue;
        score += W.sealSetup * allyReact(se.element) * 2;
        affected.add(b.id);
      }
      const drained = b.energy - a.energy;
      if (drained > 0) {
        score += drained * 0.75 * (b.energy >= b.maxEnergy ? 1.5 : 1);
        affected.add(b.id);
      }
      if (b.awakened && !a.awakened) score += 0.25 * b.maxHp;
    } else {
      if (b.alive && a.alive) teamMissing += b.maxHp - b.hp;
      if (!b.alive && a.alive) {
        score += 0.6 * a.maxHp + 0.9 * a.hp;
        healed += a.hp;
        continue;
      }
      if (!b.alive) continue;
      if (!a.alive) {
        score -= 0.6 * b.maxHp + b.hp;
        continue;
      }
      const heal = Math.max(0, a.hp - b.hp);
      healed += heal;
      score += heal * W.heal;
      score -= Math.max(0, b.hp - a.hp);
      const shieldGain = Math.max(0, a.shield - b.shield);
      if (shieldGain) {
        healed += shieldGain * 0.5;
        // a shield is worth what it will actually absorb: capped by the expected incoming damage
        const threat = threatTo(after, a);
        const useful = Math.min(shieldGain, 1.2 * threat);
        score += (useful * W.shield + (shieldGain - useful) * 0.1) * (1 - 0.5 * pressure);
      }
      let de = a.energy - b.energy;
      if (b.id === info.actorId && info.kind === 'ult') de = 0;
      if (de > 0) score += de * W.energy;
      if (a.awakened && !b.awakened) score += W.awaken * a.maxHp;
      for (const st of a.statuses) {
        if (BUFF[st.id] == null || hasStatus(b, st.id)) continue;
        score += BUFF[st.id] * (st.id === 'untargetable' || st.id === 'brace' ? a.maxHp * 0.3 : a.atk) * statusTurns(st) * 0.5;
      }
      for (const st of b.statuses) {
        if (hasStatus(a, st.id)) continue;
        if (CONTROL[st.id] != null) score += CONTROL[st.id] * a.atk * 0.8;
        else if (DEBUFF[st.id] != null) score += DEBUFF[st.id] * a.atk;
      }
    }
  }
  for (const w of root.wards) {
    const a = wardById(after, w.id);
    if (w.side !== me) {
      const loss = Math.max(0, w.hp - (a ? a.hp : 0));
      const v = wardValue(w, me);
      if (v > 5) {
        if (!a) score += v;
      } else {
        score += loss * v;
        if (!a) {
          if (w.special === 'egg') score += 0.6 * unitById(root, w.owner).maxHp;
          else if (w.special === 'decoy') score += 0.3 * unitById(root, w.owner).maxHp;
          else if (w.special === 'caravan') score += 1e5;
        }
      }
      if (loss > 0) affected.add(w.id);
    } else if (!a) {
      score -= w.special === 'caravan' ? 1e5 : w.special === 'egg' ? 0.5 * unitById(root, w.owner).maxHp : 20;
    }
  }
  for (const w of after.wards) {
    if (w.side !== me || wardById(root, w.id)) continue;
    const owner = unitById(after, w.owner);
    if (w.kind === 'ball-lightning') score += owner ? owner.atk * 0.8 * 1.2 : 30;
    else if (w.special === 'pawn' || w.special === 'egg' || w.special === 'candle' || w.special === 'decoy') score += 10;
    else score += 0.18 * w.hp + (w.aura ? 25 : 0);
  }
  for (const z of after.zones) {
    if (!z.owner || z.side !== me || root.zones.some((x) => x.id === z.id && x.turns === z.turns && x.sqs.length === z.sqs.length)) continue;
    const owner = unitById(after, z.owner);
    let covered = 0;
    for (const u of after.units) if (u.alive && u.side !== me && z.sqs.includes(u.sq)) covered++;
    score += (owner ? owner.atk : 100) * (covered ? 0.25 + 0.5 * covered : 0.1);
  }
  // positional terms for the activated hero
  const ra = unitById(root, info.actorId);
  const aa = unitById(after, info.actorId);
  if (ra && aa && aa.alive && aa.sq >= 0) {
    if (MELEE.has(aa.role) && !ra.awakened) score += W.advancePerRow * (rowsAdvanced(aa.side, aa.sq) - rowsAdvanced(ra.side, ra.sq));
    const nearest = (s, u) => {
      let m = 99;
      for (const e of s.units) if (e.alive && e.sq >= 0 && e.side !== u.side) m = Math.min(m, dist(e.sq, u.sq));
      return m;
    };
    const want = aa.role === 'ranger' ? 3 : aa.role === 'mystic' || aa.role === 'oracle' ? 2 : 1;
    const nb = nearest(root, ra);
    const na = nearest(after, aa);
    if (nb > want) score += (5 + 15 * pressure) * (Math.min(nb, 9) - Math.max(want, Math.min(na, 9)));
    // Bulwark: a Guardian next to allies protects them (−15 % damage); others like standing next to one
    const adjAllies = (s, u) => after.units.filter((x) => x.alive && x !== u && x.side === u.side && x.sq >= 0 && dist(x.sq, u.sq) === 1);
    if (aa.role === 'guardian') {
      const before = adjAllies(root, ra).length;
      const now = adjAllies(after, aa).length;
      score += 0.15 * 0.5 * aa.atk * 2 * (Math.min(now, 3) - Math.min(before, 3));
    } else {
      const g = (s, u) => s.units.some((x) => x.alive && x !== u && x.side === u.side && x.role === 'guardian' && x.sq >= 0 && u.sq >= 0 && dist(x.sq, u.sq) === 1);
      if (g(after, aa) && !g(root, ra)) score += 0.15 * threatTo(after, aa);
    }
    const threat = threatTo(after, aa);
    score -= dangerW * Math.min(threat, aa.hp + aa.shield);
    if (threat >= aa.hp + aa.shield) score -= 0.25 * aa.maxHp;
    if (aa.role === 'oracle' || aa.role === 'mystic') {
      const near = after.units.some((x) => x.alive && x !== aa && x.side === aa.side && x.sq >= 0 && dist(x.sq, aa.sq) <= 2);
      if (!near) score -= W.isolationPenalty;
    }
  }
  if (after.act && after.act.unit && after.side === me && !after.act.done) score += 120; // extra activation pending
  return { score, kos, affected: affected.size, healed, teamMissing };
}
