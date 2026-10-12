// Movement (GDD §3.3) and jump-strike chain generation (GDD §3.4, rules.js ROLES / AWAKEN).

import { AWAKEN } from '../data/rules.js';
import { unitDef } from './defs.js';
import { DARK, stepSq, dist, rowOf, rowsAdvanced } from './board.js';
import { occupancy, playable, hasStatus } from './state.js';
import { glideBonus, chainBonus } from './stats.js';

const MAX_CHAINS = 600;

/** Is the piece displacement-immune (Fuyuka's rule, bosses)? */
export function displaceImmune(u) {
  if (!u || u.isWard) return true;
  return !!(u.boss || unitDef(u).rules.displaceImmune);
}

function stepMoves(s, u, occ, steps, add, opts = {}) {
  const def = unitDef(u);
  const forwardOnly = def.rules.forwardOnly && !u.awakened;
  const leapfrog = !opts.noLeap && def.rules.leapfrog;
  const adv = (q) => rowsAdvanced(u.side, q);
  let frontier = [{ sq: u.sq, path: [u.sq], leaps: [] }];
  const visited = new Set([u.sq]);
  for (let n = 0; n < steps; n++) {
    const next = [];
    for (const node of frontier) {
      for (let d = 0; d < 4; d++) {
        const t = stepSq(node.sq, d);
        if (t < 0 || !playable(s, t)) continue;
        if (forwardOnly && adv(t) <= adv(node.sq)) continue;
        const p = occ[t];
        let land = -1;
        let leap = null;
        if (!p || p === u) land = t;
        else if (p.side === u.side && ((leapfrog && !p.isWard) || (p.isWard && p.springboard))) {
          const t2 = stepSq(t, d);
          if (t2 >= 0 && playable(s, t2) && (!occ[t2] || occ[t2] === u) && (!forwardOnly || adv(t2) > adv(node.sq))) {
            land = t2;
            leap = p.isWard ? null : p.id;
          }
        }
        if (land < 0 || visited.has(land)) continue;
        visited.add(land);
        const leaps = leap ? [...node.leaps, leap] : node.leaps;
        const nn = { sq: land, path: [...node.path, land], leaps };
        add(land, nn.path, 'step', leaps);
        next.push(nn);
      }
    }
    frontier = next;
  }
}

function glideMoves(s, u, occ, length, pass, kind, add) {
  for (let d = 0; d < 4; d++) {
    const path = [u.sq];
    for (let k = 1; k <= length; k++) {
      const t = stepSq(u.sq, d, k);
      if (t < 0 || !playable(s, t)) break;
      path.push(t);
      const p = occ[t];
      if (p && p !== u) {
        if (pass && !p.isWard && p.side === u.side) continue;
        break;
      }
      add(t, path.slice(), kind, []);
    }
  }
}

function blinkMoves(s, u, occ, range, add, kind = 'blink') {
  for (const q of DARK) {
    if (q === u.sq || !playable(s, q) || (occ[q] && occ[q] !== u)) continue;
    if (dist(q, u.sq) > range) continue;
    add(q, [u.sq, q], kind, []);
  }
}

/**
 * Move options of a unit at the start of its activation.
 * Returns { moves: [{ to, path, kind: 'step'|'glide'|'blink'|'flight', leaps: [allyId] }], swaps: [{ to, ally }] }.
 */
export function moveOptions(s, u) {
  const res = { moves: [], swaps: [] };
  if (!u || !u.alive || u.sq < 0 || hasStatus(u, 'root')) return res;
  const def = unitDef(u);
  const rules = def.rules;
  const occ = occupancy(s);
  const found = new Map();
  const add = (to, path, kind, leaps) => {
    if (!found.has(to)) found.set(to, { to, path, kind, leaps });
  };
  if (hasStatus(u, 'slow')) {
    stepMoves(s, u, occ, 1, add);
  } else {
    const pass = !!rules.passThroughAllies;
    if (rules.blinkMove) blinkMoves(s, u, occ, rules.blinkMove.range + (u.awakened ? 1 : 0), add);
    else if (def.move.type === 'blink') blinkMoves(s, u, occ, def.move.range + (u.awakened ? 1 : 0), add);
    else if (def.move.type === 'glide') glideMoves(s, u, occ, def.move.length + glideBonus(s, u), pass, 'glide', add);
    else stepMoves(s, u, occ, def.move.steps || 1, add);
    if (u.awakened && !rules.blinkMove && def.move.type !== 'blink') {
      const len = u.role === 'shadow' ? AWAKEN.moveShadow.length : AWAKEN.move.length;
      glideMoves(s, u, occ, len, pass, 'flight', add);
    }
  }
  res.moves = [...found.values()].sort((a, b) => a.to - b.to);
  const sw = rules.swapMove;
  if (sw && !(sw.usesPerBattle != null && (u.uses.swapMove || 0) >= sw.usesPerBattle)) {
    for (const a of s.units) {
      if (!a.alive || a === u || a.side !== u.side || a.sq < 0) continue;
      if (displaceImmune(a) || dist(a.sq, u.sq) > sw.range) continue;
      res.swaps.push({ to: a.sq, ally: a.id });
    }
    res.swaps.sort((a, b) => a.to - b.to);
  }
  return res;
}

/**
 * Squares for a pending free relocation. pend = { kind:'freeMove', moveType:'glide'|'step', n }
 * | { kind:'blink', range } | { kind:'relocate', range }.
 */
export function pendingOptions(s, u, pend) {
  if (!u || !u.alive || u.sq < 0) return [];
  if (pend.kind !== 'relocate' && hasStatus(u, 'root')) return [];
  const occ = occupancy(s);
  const found = new Map();
  const add = (to, path, kind, leaps) => {
    if (!found.has(to)) found.set(to, { to, path, kind, leaps });
  };
  if (pend.kind === 'blink' || pend.kind === 'relocate') blinkMoves(s, u, occ, pend.range, add, pend.kind === 'blink' ? 'blink' : 'teleport');
  else if (hasStatus(u, 'slow') || pend.moveType === 'step') stepMoves(s, u, occ, pend.moveType === 'step' ? pend.n || 1 : 1, add, { noLeap: true });
  else glideMoves(s, u, occ, pend.n || 1, !!unitDef(u).rules.passThroughAllies, 'glide', add);
  return [...found.values()].sort((a, b) => a.to - b.to);
}

/**
 * Jump-strike parameters of a unit. For a skill jumpStrike pass the op: { mult, chainMax, approachMax,
 * landMax, thenRole }.
 */
export function jumpParams(s, u, op = null) {
  const def = unitDef(u);
  const crown = u.awakened ? AWAKEN.jump.chainBonus : 0;
  let chainMax = op ? (op.chainMax || 1) + crown : def.jump.chainMax + chainBonus(s, u) + crown;
  if (hasStatus(u, 'slow')) chainMax = 1;
  return {
    chainMax,
    roleMult: def.jump.mult,
    comboStep: def.jump.comboStep,
    roleLand: def.jump.landMax,
    skill: op
      ? { mult: op.mult, approachMax: op.approachMax || 1, landMax: op.landMax || 1, thenRole: op.thenRole !== false }
      : null,
    slow: !!hasStatus(u, 'slow'),
  };
}

/** Can `u` jump-strike over piece `p` at the moment? */
export function canJumpOver(s, u, p, awakenedNow) {
  if (p.side === u.side) return false;
  if (p.isWard) return !!p.jumpable;
  if (!p.alive) return false;
  if (hasStatus(p, 'untargetable')) return false;
  const jp = unitDef(p).rules.jumpProof;
  if (jp && !awakenedNow && !(jp.except || []).includes(u.role)) return false;
  return true;
}

/**
 * Every jump-strike chain available to `u` (each prefix is a separate option — a chain may stop after
 * any hop). Returns [{ path: [start, land1, land2, ...], hops: [{ from, to, over, victim, spring, awaken }] }].
 * Pieces are treated as static during generation (victims keep blocking their squares).
 */
export function jumpChains(s, u, op = null) {
  if (!u || !u.alive || u.sq < 0 || hasStatus(u, 'root')) return [];
  const prm = jumpParams(s, u, op);
  const occ = occupancy(s);
  occ[u.sq] = null;
  const enemyBack = s.awakenRows[u.side];
  const out = [];
  const jumped = new Set();
  const hops = [];
  const dfs = (sq, awakenedNow, chainMax, damaging) => {
    if (out.length >= MAX_CHAINS) return;
    if (hops.length > 0 && damaging > 0) out.push({ path: [hops[0].from, ...hops.map((h) => h.to)], hops: hops.map((h) => ({ ...h })) });
    if (hops.length >= chainMax) return;
    const useSkill = prm.skill && (hops.length === 0 || !prm.skill.thenRole);
    const approach = useSkill ? prm.skill.approachMax : awakenedNow ? AWAKEN.jump.approachMax : 1;
    const land = useSkill ? prm.skill.landMax : awakenedNow ? Math.max(prm.roleLand, AWAKEN.jump.landMax) : prm.roleLand;
    for (let d = 0; d < 4; d++) {
      let victim = null;
      let vk = 0;
      for (let k = 1; k <= approach; k++) {
        const q = stepSq(sq, d, k);
        if (q < 0 || !playable(s, q)) break;
        if (occ[q]) {
          victim = occ[q];
          vk = k;
          break;
        }
      }
      if (!victim || jumped.has(victim.id)) continue;
      let spring = false;
      if (victim.side === u.side) {
        if (!(victim.isWard && victim.springboard && vk === 1)) continue;
        spring = true;
      } else if (!canJumpOver(s, u, victim, awakenedNow)) continue;
      const landMax = spring ? 1 : land;
      for (let j = 1; j <= landMax; j++) {
        const L = stepSq(victim.sq, d, j);
        if (L < 0 || !playable(s, L) || occ[L]) break;
        const awakenHere = !awakenedNow && rowOf(L) === enemyBack;
        const nextAwake = awakenedNow || awakenHere;
        const nextChain = prm.slow ? chainMax : chainMax + (awakenHere ? AWAKEN.jump.chainBonus : 0);
        jumped.add(victim.id);
        hops.push({ from: sq, to: L, over: victim.sq, victim: victim.id, spring, awaken: awakenHere });
        dfs(L, nextAwake, nextChain, damaging + (spring ? 0 : 1));
        hops.pop();
        jumped.delete(victim.id);
      }
    }
  };
  dfs(u.sq, !!u.awakened, prm.chainMax, 0);
  return out;
}

/** Where Reika hops when an enemy ends adjacent (retreatOnAdjacent): -1 if nowhere. */
export function retreatSquare(s, u, enemySq) {
  const occ = occupancy(s);
  let best = -1;
  let bestKey = null;
  for (let d = 0; d < 4; d++) {
    const t = stepSq(u.sq, d);
    if (t < 0 || !playable(s, t) || occ[t]) continue;
    const back = rowsAdvanced(u.side, t) < rowsAdvanced(u.side, u.sq) ? 0 : 1;
    let adjEnemies = 0;
    for (let d2 = 0; d2 < 4; d2++) {
      const n = stepSq(t, d2);
      const p = n >= 0 ? occ[n] : null;
      if (p && p !== u && !p.isWard && p.side !== u.side) adjEnemies++;
    }
    const key = [back, adjEnemies, -dist(t, enemySq), t];
    if (!bestKey || lexLess(key, bestKey)) {
      best = t;
      bestKey = key;
    }
  }
  return best;
}

function lexLess(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

