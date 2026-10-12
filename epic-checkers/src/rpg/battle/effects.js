// Generic effect interpreter (effects.md §3): runs ability / trigger / zone / ward effect lists.

import { unitDef } from './defs.js';
import { stepSq, dist, neighbors, DIRS } from './board.js';
import { pieceAt, isEmptySq, hasStatus, playable, unitById } from './state.js';
import { checkCond, statValue } from './stats.js';
import { resolveWho, areaReceivers, sortByPick } from './targeting.js';
import { jumpParams, canJumpOver } from './movement.js';
import {
  emit, dealDamage, healUnit, healAmount, giveShield, addStatus, removeStatus, cleanse, dispel, addSeal, changeEnergy, pushUnit, pullUnit,
  swapUnits, relocate, spawnWard, spawnZone, revivable, revivePlace, reviveUnit, awakenUnit, flushKos, queueKo, landed, unitStats,
} from './combat.js';
import { fire } from './triggers.js';

/** Per-ability execution context sharing the engine context E. */
export function subCtx(E, fields) {
  return {
    E,
    s: E.s,
    caster: null,
    kind: 'trigger',
    ability: null,
    abilityId: null,
    pick: null,
    event: null,
    srcKind: null,
    origin: null,
    originSq: null,
    viaWard: false,
    actionBonus: 0,
    hitIds: new Set(),
    lastHit: null,
    lastHitSq: -1,
    koStart: E.koLog.length,
    ...fields,
  };
}

export function koAny(ctx) {
  return ctx.E.koLog.length > ctx.koStart;
}

function condEnv(ctx, target) {
  const s = ctx.s;
  const c = ctx.caster;
  const act = s.act && c && s.act.unit === c.id ? s.act : null;
  return {
    s, self: c, target,
    moved: act ? act.moved : false, movedDist: act ? act.movedDist : 0,
    koAny: koAny(ctx), anyAllyKo: c ? revivable(s, c.side).length > 0 : false,
    crit: ctx.event ? ctx.event.crit : undefined, reaction: ctx.event ? ctx.event.reaction : undefined,
    source: ctx.srcKind, melee: ctx.event ? ctx.event.melee : false,
    fromSq: ctx.origin != null ? ctx.origin : c ? c.sq : -1, originSq: ctx.originSq,
  };
}

/** Run an effect list in order; KOs are removed after each effect (immediately inside jump chains). */
export function runEffects(ctx, effects) {
  if (!effects) return;
  for (const eff of effects) {
    if (ctx.E.result) return;
    runOp(ctx, eff);
    if (!ctx.E.inChain) flushKos(ctx);
  }
}

/** Queue a pending relocation choice for the active unit (free move, mandatory blink, reappear). */
export function enqueuePending(ctx, u, pend) {
  const s = ctx.s;
  if (!s.act || s.act.unit !== u.id || !u.alive) return;
  s.act.pending.push(pend);
}

const UNIT_OPS = new Set(['heal', 'shield', 'status', 'cleanse', 'dispel', 'seal', 'energy', 'cooldown', 'push', 'pull', 'swap']);

function runOp(ctx, eff) {
  const s = ctx.s;
  const c = ctx.caster;
  switch (eff.op) {
    case 'freeMove': {
      if (eff.if && !checkCond(eff.if, condEnv(ctx, null))) return;
      if (!['basic', 'skill', 'ult', 'quirk', 'jump'].includes(s.act && s.act.kind)) return;
      const pend = eff.glide != null ? { kind: 'freeMove', moveType: 'glide', n: eff.glide, optional: true } : { kind: 'freeMove', moveType: 'step', n: eff.steps || 1, optional: true };
      enqueuePending(ctx, c, pend);
      return;
    }
    case 'extraActivation':
      if (s.act && s.side === c.side && c.alive) {
        s.act.extraQueue.push(c.id);
        emit(ctx, { type: 'extraActivation', unit: c.id });
      }
      return;
    case 'survive':
      ctx.E.survive = eff.hp != null ? eff.hp : 1;
      return;
    case 'redirect':
      ctx.E.redirect = eff.pct;
      return;
    case 'jumpStrike':
      if (ctx.pick && ctx.pick.hops) execChain(ctx, c, ctx.pick.hops, eff);
      return;
    case 'moveSelf':
      if (eff.if && !checkCond(eff.if, condEnv(ctx, null))) return;
      moveSelf(ctx, eff);
      return;
    case 'ward':
      spawnWards(ctx, eff);
      return;
    case 'zone':
      if (ctx.pick) spawnZone(ctx, c, ctx.pick.covered, { kind: eff.id, turns: eff.turns, affects: eff.side || 'enemy', onTurnStart: eff.onTurnStart, onEnter: eff.onEnter });
      return;
    case 'revive': {
      if (eff.if && !checkCond(eff.if, condEnv(ctx, null))) return;
      const cand = revivable(s, c.side)[0];
      if (!cand) return;
      const sq = revivePlace(s, c.side, c.sq);
      if (sq < 0) return;
      reviveUnit(ctx, c, cand, eff.hpPct || 0.4, sq, 'revive');
      return;
    }
    case 'bounce':
      bounce(ctx, eff);
      return;
    case 'volley':
      volley(ctx, eff);
      return;
    case 'awaken':
      if (eff.if && !checkCond(eff.if, condEnv(ctx, null))) return;
      awakenUnit(ctx, c, { full: eff.bonuses !== false });
      return;
    case 'consumeStacks': {
      const st = hasStatus(c, eff.status);
      if (!st) return;
      ctx.actionBonus += (st.stacks || 0) * (eff.dmgBonusPerStack || 0);
      removeStatus(ctx, c, st, 'consumed');
      return;
    }
    default:
      break;
  }
  let recv = eff.area ? areaReceivers(ctx.s, ctx, eff.area) : resolveWho(ctx, eff.who || 'targets', eff);
  if (UNIT_OPS.has(eff.op)) recv = recv.filter((r) => !r.isWard && r.alive);
  if (eff.if) recv = recv.filter((r) => checkCond(eff.if, condEnv(ctx, r)));
  if (!recv.length) return;
  switch (eff.op) {
    case 'damage':
      for (const r of recv) {
        for (let h = 0; h < (eff.hits || 1); h++) {
          dealDamage(ctx, c, r, { mult: eff.mult, stat: eff.stat || 'atk', element: eff.element || 'self', critBonus: eff.critBonus || 0, dmgBonus: eff.dmgBonus || 0, kind: 'hit', source: ctx.srcKind });
        }
      }
      break;
    case 'trueDamage':
      for (const r of recv) dealDamage(ctx, c, r, { kind: 'true', flat: statValue(s, c, eff.stat || 'atk', {}) * (eff.mult || 0), label: 'true' });
      break;
    case 'heal':
      for (const r of recv) healUnit(ctx, c, r, healAmount(ctx, c, r, eff));
      break;
    case 'shield':
      for (const r of recv) {
        let v;
        if (eff.pctMaxHp != null) v = eff.pctMaxHp * r.maxHp;
        else if (eff.pctCasterMaxHp != null) v = eff.pctCasterMaxHp * c.maxHp;
        else v = statValue(s, c, eff.stat || 'atk', {}) * (eff.mult || 0);
        giveShield(ctx, c, r, v, eff.turns != null ? eff.turns : 2);
      }
      break;
    case 'status':
      for (const r of recv) addStatus(ctx, c, r, eff.id, { turns: eff.turns, value: eff.value, stacks: eff.stacks });
      break;
    case 'cleanse':
      for (const r of recv) cleanse(ctx, r, eff.count != null ? eff.count : 1, eff.ids || null);
      break;
    case 'dispel':
      for (const r of recv) dispel(ctx, r, eff.count != null ? eff.count : 1, eff.steal ? c : null);
      break;
    case 'seal':
      for (const r of recv) addSeal(ctx, r, eff.element === 'self' ? c.element : eff.element);
      break;
    case 'energy':
      for (const r of recv) {
        if (eff.amount < 0) {
          const drained = -changeEnergy(ctx, r, eff.amount, eff.stealTo === 'self' ? 'stolen' : 'drain', false);
          if (eff.stealTo === 'self' && drained > 0 && r !== c) changeEnergy(ctx, c, drained, 'steal', false);
        } else changeEnergy(ctx, r, eff.amount, 'effect', false);
      }
      break;
    case 'cooldown':
      for (const r of recv) {
        const which = eff.which || 'skill';
        const before = r.cd[which] || 0;
        const v = Math.max(0, before + (eff.delta || 0));
        if (v !== before) {
          r.cd[which] = v;
          emit(ctx, { type: 'cooldown', unit: r.id, value: v, which });
        }
      }
      break;
    case 'push': {
      const from = eff.from === 'center' && ctx.pick ? ctx.pick.centerSq : ctx.origin != null ? ctx.origin : c.sq;
      const order = recv.slice().sort((a, b) => dist(from, b.sq) - dist(from, a.sq) || a.sq - b.sq);
      for (const r of order) pushUnit(ctx, c, r, eff.dist || 1, from);
      break;
    }
    case 'pull': {
      const to = eff.toward === 'center' && ctx.pick ? ctx.pick.centerSq : c.sq;
      const order = recv.slice().sort((a, b) => dist(to, a.sq) - dist(to, b.sq) || a.sq - b.sq);
      for (const r of order) pullUnit(ctx, c, r, eff.dist || 1, to);
      break;
    }
    case 'swap':
      for (const r of recv) {
        if (r === c) continue;
        swapUnits(ctx, c, r, 'swap', false);
        break;
      }
      break;
    case 'execute':
      for (const r of recv) {
        if (r.isWard || !r.alive || r.hp <= 0) continue;
        if (r.hp > (eff.hpPct || 0) * r.maxHp) continue;
        if (r.boss) {
          dealDamage(ctx, c, r, { mult: 1.0, kind: 'hit', source: ctx.srcKind, label: 'execute' });
        } else {
          emit(ctx, { type: 'execute', unit: r.id, source: c.id, hp: r.hp });
          const st = unitStats(ctx, c);
          st.dmgDealt += r.hp;
          r.hp = 0;
          queueKo(ctx, r, c);
        }
      }
      break;
    default:
      throw new Error(`unknown effect op: ${eff.op}`);
  }
}

// ------------------------------------------------------------------------------------ op helpers

function moveSelf(ctx, eff) {
  const s = ctx.s;
  const c = ctx.caster;
  if (!c.alive) return;
  const pick = ctx.pick;
  switch (eff.to) {
    case 'lineEnd': {
      const cov = pick ? pick.covered : [];
      for (let i = cov.length - 1; i >= 0; i--) {
        if (cov[i] === c.sq) break;
        if (isEmptySq(s, cov[i])) {
          relocate(ctx, c, cov[i], 'moveSelf');
          return;
        }
      }
      return;
    }
    case 'adjacentToTarget': {
      const t = pick && (pick.first || (pick.center ? unitById(s, pick.center) : null));
      if (!t || t.sq < 0) return;
      if (dist(t.sq, c.sq) === 1) return;
      const q = adjacentLanding(s, c, t, pick);
      if (q >= 0) relocate(ctx, c, q, 'moveSelf');
      return;
    }
    case 'anyWithin':
      enqueuePending(ctx, c, { kind: 'relocate', range: eff.range || 1, optional: false });
      return;
    case 'square': {
      const q = pick && pick.targets ? pick.targets[0] : -1;
      if (q >= 0 && isEmptySq(s, q)) relocate(ctx, c, q, 'moveSelf');
      return;
    }
    default:
      throw new Error(`unknown moveSelf target: ${eff.to}`);
  }
}

/** Landing square next to a target for moveSelf 'adjacentToTarget' (-1 if none). */
export function adjacentLanding(s, c, t, pick) {
  if (pick && pick.dir != null) {
    const back = stepSq(t.sq, 3 - pick.dir);
    if (back === c.sq) return -1;
    return back >= 0 && isEmptySq(s, back) ? back : -1;
  }
  let best = -1;
  for (const n of neighbors(t.sq)) {
    if (!isEmptySq(s, n)) continue;
    if (best < 0 || dist(n, c.sq) < dist(best, c.sq) || (dist(n, c.sq) === dist(best, c.sq) && n < best)) best = n;
  }
  return best;
}

function spawnWards(ctx, eff) {
  const s = ctx.s;
  const c = ctx.caster;
  const squares = ctx.pick ? ctx.pick.targets || (ctx.pick.target != null ? [ctx.pick.target] : []) : [];
  const springboard = !!unitDef(c).rules.springboardWards;
  for (const sq of squares) {
    if (!isEmptySq(s, sq)) continue;
    const hp = eff.hp != null ? eff.hp : Math.max(1, Math.floor((eff.hpPct || 0.1) * c.maxHp));
    spawnWard(ctx, c, sq, {
      kind: eff.id, hp, turns: eff.turns === undefined ? null : eff.turns, blocks: eff.blocks, jumpable: eff.jumpable,
      behavior: eff.behavior || null, aura: eff.aura || null, springboard,
    });
  }
}

function bounce(ctx, eff) {
  const s = ctx.s;
  const c = ctx.caster;
  let prev = ctx.lastHitSq;
  if (prev == null || prev < 0) return;
  for (let i = 0; i < (eff.count || 1); i++) {
    const from = prev;
    const cands = s.units.filter(
      (u) => u.alive && u.hp > 0 && u.sq >= 0 && u.side !== c.side && !ctx.hitIds.has(u.id) && dist(from, u.sq) <= (eff.range || 2) && !hasStatus(u, 'untargetable'),
    );
    if (!cands.length) break;
    cands.sort((a, b) => dist(from, a.sq) - dist(from, b.sq) || a.hp / a.maxHp - b.hp / b.maxHp || a.sq - b.sq);
    const t = cands[0];
    emit(ctx, { type: 'bounce', from, to: t.sq, target: t.id, source: c.id });
    prev = t.sq;
    dealDamage(ctx, c, t, { mult: eff.mult, kind: 'hit', element: eff.element || 'self', source: ctx.srcKind });
  }
}

function volley(ctx, eff) {
  const c = ctx.caster;
  const list = resolveWho(ctx, eff.who || 'targets', eff).filter((r) => !r.isWard && r.alive);
  if (!list.length) return;
  sortByPick(list, 'lowestHpPct', c.sq);
  const counts = new Map();
  const max = eff.maxPerTarget || 99;
  let left = eff.hits || 1;
  let i = 0;
  let idle = 0;
  while (left > 0 && idle < list.length) {
    const t = list[i % list.length];
    i++;
    if (!t.alive || t.hp <= 0 || (counts.get(t.id) || 0) >= max) {
      idle++;
      continue;
    }
    idle = 0;
    counts.set(t.id, (counts.get(t.id) || 0) + 1);
    left--;
    dealDamage(ctx, c, t, { mult: eff.mult, kind: 'hit', element: eff.element || 'self', source: ctx.srcKind });
  }
}

/**
 * Execute a jump-strike chain (hops from movement.jumpChains). Victims are re-validated at every hop;
 * the chain stops early if the board changed (a decoy swap, a reaction push...).
 * `op` = skill jumpStrike op (first hop uses op.mult), or null for the role jump.
 * Returns { hops, damaging }.
 */
export function execChain(ctx, c, hops, op = null) {
  const s = ctx.s;
  const E = ctx.E;
  const prm = jumpParams(s, c, op);
  let total = 0;
  let n = 0;
  E.inChain++;
  try {
    for (const h of hops) {
      if (!c.alive || E.result || c.sq !== h.from) break;
      const v = pieceAt(s, h.over);
      if (!v || v.id !== h.victim) break;
      if (!playable(s, h.to) || pieceAt(s, h.to)) break;
      if (!h.spring && !canJumpOver(s, c, v, c.awakened)) break;
      c.sq = h.to;
      total++;
      emit(ctx, { type: 'jump', unit: c.id, from: h.from, to: h.to, over: h.over, victim: v.id, hop: total, spring: !!h.spring });
      if (!h.spring) {
        n++;
        const mult = op && n === 1 ? op.mult : prm.roleMult * (1 + prm.comboStep * (n - 1));
        dealDamage(ctx, c, v, { mult, kind: 'hit', melee: true, source: ctx.srcKind || 'jump', label: 'jump' });
        flushKos(ctx);
      }
      landed(ctx, c, { voluntary: true, endOfMove: false });
      fire(ctx, c, 'jumpHop', { source: c.id, target: h.spring ? null : v.id, kind: ctx.srcKind || 'jump', melee: true });
      flushKos(ctx);
    }
  } finally {
    E.inChain--;
  }
  if (c.alive && total > 0) landed(ctx, c, { voluntary: true, endOfMove: true });
  const st = unitStats(ctx, c);
  st.chains += 1;
  st.hops += total;
  st.maxChain = Math.max(st.maxChain, total);
  const ss = s.stats.sides[c.side];
  ss.maxChain = Math.max(ss.maxChain, total);
  ctx.chainHops = total;
  return { hops: total, damaging: n };
}

export { DIRS };
