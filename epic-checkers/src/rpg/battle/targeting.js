// Target shapes (effects.md §2): enumerate the legal picks of an ability, match an action to a pick,
// and resolve effect receivers (`who`, effects.md §3).

import { unitDef } from './defs.js';
import { DARK, DIRS, stepSq, dist, dirBetween, rowOf, colOf, between, neighbors, sqOf, onBoard } from './board.js';
import { occupancy, playable, hasStatus, unitById, pieceById, pieceAt } from './state.js';
import { jumpChains } from './movement.js';

const DAMAGE_OPS = new Set(['damage', 'trueDamage', 'jumpStrike', 'bounce', 'volley', 'execute']);

/** Does the ability deal damage (top-level effects)? */
export function abilityDamages(ability) {
  return !!(ability && ability.effects && ability.effects.some((e) => DAMAGE_OPS.has(e.op)));
}

export function sideMatch(caster, p, side) {
  switch (side) {
    case 'enemy':
      return p.side !== caster.side;
    case 'ally':
      return p.side === caster.side && p !== caster;
    case 'allyOrSelf':
      return p.side === caster.side;
    default:
      return true;
  }
}

/**
 * Hidden from a picked attack by the caster: Veiled (untargetable) enemies, and rangedVeil units
 * (Koyuki) attacked from `d` ≥ minDistance by single / line attacks. Hidden pieces never block lines.
 */
export function hiddenFrom(caster, p, d, ranged = true) {
  if (p.isWard || p.side === caster.side) return false;
  if (hasStatus(p, 'untargetable')) return true;
  if (ranged) {
    const rv = unitDef(p).rules.rangedVeil;
    if (rv && d >= rv.minDistance) return true;
  }
  return false;
}

function pieces(s) {
  const out = [];
  for (const u of s.units) if (u.alive && u.sq >= 0) out.push(u);
  for (const w of s.wards) out.push(w);
  return out;
}

function eligible(caster, p, side, damaging) {
  if (!sideMatch(caster, p, side)) return false;
  if (p.isWard) return damaging && p.side !== caster.side;
  return true;
}

function radiusSquares(s, center, r, includeCenter) {
  const out = [];
  for (const q of DARK) {
    if (!playable(s, q)) continue;
    const d = dist(q, center);
    if (d > r || (d === 0 && !includeCenter)) continue;
    out.push(q);
  }
  return out;
}

function recvOn(s, caster, covered, side, damaging, occ) {
  const out = [];
  for (const q of covered) {
    const p = occ[q];
    if (p && eligible(caster, p, side, damaging)) out.push(p);
  }
  return out;
}

function lineCover(s, caster, d, length, pierce, side, damaging, occ, ranged = true) {
  const covered = [];
  const recv = [];
  let first = null;
  for (let k = 1; k <= length; k++) {
    const q = stepSq(caster.sq, d, k);
    if (q < 0 || !playable(s, q)) break;
    covered.push(q);
    const p = occ[q];
    if (!p) continue;
    if (hiddenFrom(caster, p, k, ranged)) continue;
    if (pierce) {
      if (eligible(caster, p, side, damaging)) recv.push(p);
      continue;
    }
    if (eligible(caster, p, side, damaging)) {
      recv.push(p);
      first = p;
    }
    break;
  }
  return { covered, recv, first: first || recv[0] || null };
}

function combos(arr, k) {
  const out = [];
  const cur = [];
  const rec = (i) => {
    if (cur.length === k) {
      out.push(cur.slice());
      return;
    }
    for (let j = i; j < arr.length; j++) {
      cur.push(arr[j]);
      rec(j + 1);
      cur.pop();
    }
  };
  rec(0);
  return out;
}

function crossSquares(s, center, length, includeCenter) {
  const out = includeCenter ? [center] : [];
  const r = rowOf(center);
  const c = colOf(center);
  for (let k = 1; k <= length; k++) {
    for (const [dr, dc] of [
      [-2 * k, 0],
      [2 * k, 0],
      [0, -2 * k],
      [0, 2 * k],
    ]) {
      if (!onBoard(r + dr, c + dc)) continue;
      const q = sqOf(r + dr, c + dc);
      if (playable(s, q)) out.push(q);
    }
  }
  return out;
}

function diagSquares(s, center, length) {
  const out = [];
  for (let d = 0; d < 4; d++) {
    for (let k = 1; k <= length; k++) {
      const q = stepSq(center, d, k);
      if (q < 0) break;
      if (playable(s, q)) out.push(q);
    }
  }
  return out;
}

function rowCover(s, caster, row, rows) {
  const covered = [];
  let dir = Math.sign(rowOf(caster.sq) - row);
  if (dir === 0) dir = caster.side === 1 ? 1 : -1;
  for (let k = 0; k < rows; k++) {
    const r = row + dir * k;
    if (r < 0 || r > 7) break;
    for (const q of DARK) if (rowOf(q) === r && playable(s, q)) covered.push(q);
  }
  return covered;
}

function autoPick(s, caster, shape, origin) {
  const side = shape.side || 'ally';
  const range = shape.range != null ? shape.range : 99;
  const cands = s.units.filter((u) => u.alive && u.sq >= 0 && sideMatch(caster, u, side) && dist(origin, u.sq) <= range);
  sortByPick(cands, shape.pick || 'nearest', origin);
  return cands.slice(0, shape.count || 1);
}

/** Sort units for auto-pick / receiver selectors (ties: distance, then sq). */
export function sortByPick(arr, pick, origin) {
  const key = (u) => {
    switch (pick) {
      case 'lowestHpPct':
        return u.hp / u.maxHp;
      case 'lowestEnergy':
        return u.energy / Math.max(1, u.maxEnergy);
      case 'highestAtk':
        return -u.atk;
      default:
        return 0;
    }
  };
  arr.sort((a, b) => key(a) - key(b) || dist(origin, a.sq) - dist(origin, b.sq) || a.sq - b.sq);
  return arr;
}

/**
 * Every legal pick of `ability` for `caster` at its current square.
 * pick = { key, target?, targets?, path?, hops?, dir?, center?, centerSq?, covered: [sq], recv: [piece], first? }
 * `opts.pierce` turns non-piercing lines into piercing ones (Reika's Charge).
 */
export function enumeratePicks(s, caster, ability, opts = {}) {
  const shape = ability.target || { shape: 'self' };
  const damaging = abilityDamages(ability);
  const side = shape.side || 'enemy';
  const occ = opts.occ || occupancy(s);
  const out = [];
  switch (shape.shape) {
    case 'self':
      out.push({ key: 'self', target: caster.sq, covered: [caster.sq], recv: [caster], center: caster.id, centerSq: caster.sq });
      break;
    case 'single': {
      const range = shape.range != null ? shape.range : 1;
      const los = shape.los || 'adjacent';
      for (const p of pieces(s)) {
        if (!eligible(caster, p, side, damaging)) continue;
        if (p === caster && !shape.includeSelf) continue;
        const d = dist(caster.sq, p.sq);
        if (d > range) continue;
        if (los === 'adjacent' && d !== 1 && p !== caster) continue;
        if (los === 'diag' && p !== caster) {
          if (dirBetween(caster.sq, p.sq) < 0) continue;
          const blocked = between(caster.sq, p.sq).some((q) => {
            const b = occ[q];
            return b && !hiddenFrom(caster, b, dist(caster.sq, q));
          });
          if (blocked) continue;
        }
        if (hiddenFrom(caster, p, d)) continue;
        out.push({ key: `u${p.sq}`, target: p.sq, covered: [p.sq], recv: [p], center: p.id, centerSq: p.sq, first: p });
      }
      break;
    }
    case 'line': {
      const pierce = !!shape.pierce || !!opts.pierce;
      for (let d = 0; d < 4; d++) {
        const lc = lineCover(s, caster, d, shape.length || 1, pierce, side, damaging, occ);
        if (!lc.recv.length) continue;
        out.push({ key: `d${d}`, dir: d, target: stepSq(caster.sq, d), covered: lc.covered, recv: lc.recv, first: lc.first, centerSq: lc.first ? lc.first.sq : -1, center: lc.first ? lc.first.id : null });
      }
      break;
    }
    case 'lines': {
      const pierce = !!shape.pierce || !!opts.pierce;
      const valid = [];
      for (let d = 0; d < 4; d++) {
        const lc = lineCover(s, caster, d, shape.length || 1, pierce, side, damaging, occ);
        if (lc.recv.length) valid.push({ d, ...lc });
      }
      const k = Math.min(shape.dirs || 1, valid.length);
      if (k === 0) break;
      for (const combo of combos(valid, k)) {
        const covered = [];
        const recv = [];
        for (const l of combo) {
          for (const q of l.covered) if (!covered.includes(q)) covered.push(q);
          for (const p of l.recv) if (!recv.includes(p)) recv.push(p);
        }
        out.push({ key: `D${combo.map((l) => l.d).join('')}`, dirs: combo.map((l) => l.d), targets: combo.map((l) => stepSq(caster.sq, l.d)), target: stepSq(caster.sq, combo[0].d), covered, recv, first: combo[0].first, lineFirsts: combo.map((l) => l.first) });
      }
      break;
    }
    case 'diagonals': {
      if ((shape.center || 'caster') === 'caster') {
        const covered = diagSquares(s, caster.sq, shape.length || 1);
        out.push({ key: 'diag', target: caster.sq, covered, recv: recvOn(s, caster, covered, side, damaging, occ), centerSq: caster.sq, center: caster.id });
      } else {
        for (const p of pieces(s)) {
          if (!eligible(caster, p, side, damaging) || dist(caster.sq, p.sq) > (shape.range || 1) || hiddenFrom(caster, p, dist(caster.sq, p.sq))) continue;
          const covered = diagSquares(s, p.sq, shape.length || 1);
          out.push({ key: `u${p.sq}`, target: p.sq, covered, recv: recvOn(s, caster, covered, side, damaging, occ), center: p.id, centerSq: p.sq });
        }
      }
      break;
    }
    case 'cross': {
      const range = shape.range != null ? shape.range : 7;
      for (const q of DARK) {
        if (!playable(s, q) || dist(caster.sq, q) > range) continue;
        const covered = crossSquares(s, q, shape.length || 1, shape.includeCenter !== false);
        const recv = recvOn(s, caster, covered, side, damaging, occ);
        if (!recv.length) continue;
        const c = occ[q];
        out.push({ key: `s${q}`, target: q, covered, recv, centerSq: q, center: c && !c.isWard ? c.id : null });
      }
      break;
    }
    case 'radius': {
      const r = shape.r != null ? shape.r : 1;
      const inc = shape.includeCenter !== false;
      const center = shape.center || 'caster';
      if (center === 'caster') {
        const covered = radiusSquares(s, caster.sq, r, inc);
        out.push({ key: 'self', target: caster.sq, covered, recv: recvOn(s, caster, covered, side, damaging, occ), centerSq: caster.sq, center: caster.id });
      } else if (center === 'target') {
        for (const p of pieces(s)) {
          const d = dist(caster.sq, p.sq);
          if (!eligible(caster, p, side, damaging) || d > (shape.range || 1) || hiddenFrom(caster, p, d)) continue;
          const covered = radiusSquares(s, p.sq, r, inc);
          out.push({ key: `u${p.sq}`, target: p.sq, covered, recv: recvOn(s, caster, covered, side, damaging, occ), center: p.id, centerSq: p.sq });
        }
      } else {
        const range = shape.range != null ? shape.range : 1;
        for (const q of DARK) {
          if (!playable(s, q) || dist(caster.sq, q) > range) continue;
          const covered = radiusSquares(s, q, r, inc);
          const recv = recvOn(s, caster, covered, side, damaging, occ);
          if (!recv.length) continue;
          const c = occ[q];
          out.push({ key: `s${q}`, target: q, covered, recv, centerSq: q, center: c && !c.isWard && sideMatch(caster, c, side) ? c.id : null });
        }
      }
      break;
    }
    case 'row': {
      for (let row = 0; row < 8; row++) {
        const hasEnemy = s.units.some((u) => u.alive && u.sq >= 0 && u.side !== caster.side && rowOf(u.sq) === row);
        if (!hasEnemy) continue;
        const covered = rowCover(s, caster, row, shape.rows || 1);
        const recv = recvOn(s, caster, covered, side, damaging, occ);
        if (!recv.length) continue;
        out.push({ key: `r${row}`, row, target: DARK.find((q) => rowOf(q) === row), covered, recv, centerSq: -1, center: null });
      }
      break;
    }
    case 'all': {
      const recv = pieces(s).filter((p) => eligible(caster, p, side, damaging));
      out.push({ key: 'all', target: caster.sq, covered: recv.map((p) => p.sq), recv, centerSq: caster.sq, center: caster.id });
      break;
    }
    case 'auto': {
      const recv = autoPick(s, caster, shape, caster.sq);
      out.push({ key: 'auto', target: caster.sq, covered: recv.map((p) => p.sq), recv, centerSq: caster.sq, center: recv[0] ? recv[0].id : null });
      break;
    }
    case 'square': {
      const range = shape.range != null ? shape.range : 1;
      const cands = DARK.filter((q) => playable(s, q) && !occ[q] && dist(caster.sq, q) <= (shape.adjacentOnly ? 1 : range) && q !== caster.sq);
      const k = Math.min(shape.count || 1, cands.length);
      if (k === 0) break;
      const sets = opts.squareCap && ((k > 1 && cands.length > 6) || cands.length > opts.squareCap) ? null : combos(cands, k);
      if (sets) {
        for (const set of sets) out.push({ key: `q${set.join('.')}`, targets: set, target: set[0], covered: set, recv: [], centerSq: set[0], center: null });
      } else {
        // capped enumeration (AI): best squares by adjacent enemies, then distance
        out.push(...squarePicksGreedy(s, caster, cands, k, occ, opts.squareCap));
      }
      break;
    }
    case 'jump': {
      const op = ability.effects.find((e) => e.op === 'jumpStrike');
      for (const ch of jumpChains(s, caster, op)) {
        const victims = ch.hops.filter((h) => !h.spring).map((h) => pieceById(s, h.victim)).filter(Boolean);
        out.push({ key: `j${ch.path.join('.')}`, path: ch.path, hops: ch.hops, target: ch.path[ch.path.length - 1], covered: ch.hops.map((h) => h.over), recv: victims, first: victims[0] || null, centerSq: victims[0] ? victims[0].sq : -1, center: victims[0] ? victims[0].id : null });
      }
      break;
    }
    default:
      throw new Error(`unknown target shape: ${shape.shape}`);
  }
  return out;
}

function squarePicksGreedy(s, caster, cands, k, occ, cap) {
  const score = (q) => {
    let n = 0;
    for (const nb of neighbors(q)) {
      const p = occ[nb];
      if (p && !p.isWard && p.side !== caster.side) n += 2;
      if (p && !p.isWard && p.side === caster.side) n += 1;
    }
    return n * 10 - dist(caster.sq, q);
  };
  const ranked = cands.slice().sort((a, b) => score(b) - score(a) || a - b);
  const top = ranked.slice(0, Math.max(k, Math.min(ranked.length, 6)));
  const out = [];
  for (const set of combos(top, k)) {
    out.push({ key: `q${set.join('.')}`, targets: set, target: set[0], covered: set, recv: [], centerSq: set[0], center: null });
    if (out.length >= (cap || 10)) break;
  }
  return out;
}

/** Find the pick an action refers to (null if illegal). */
export function matchPick(s, caster, ability, action, picks) {
  const shape = (ability.target && ability.target.shape) || 'self';
  if (!picks.length) return null;
  switch (shape) {
    case 'self':
    case 'all':
    case 'auto':
      return picks[0];
    case 'diagonals':
    case 'radius':
      if (picks.length === 1 && picks[0].key === (shape === 'diagonals' ? 'diag' : 'self')) return picks[0];
      return picks.find((p) => p.target === action.target) || null;
    case 'single':
    case 'cross':
      return picks.find((p) => p.target === action.target) || null;
    case 'line': {
      const d = dirBetween(caster.sq, action.target);
      return picks.find((p) => p.dir === d) || null;
    }
    case 'lines': {
      const list = action.targets || (action.target != null ? [action.target] : []);
      const ds = [...new Set(list.map((q) => dirBetween(caster.sq, q)))].sort();
      if (ds.some((d) => d < 0)) return null;
      return picks.find((p) => p.dirs.slice().sort().join() === ds.join()) || null;
    }
    case 'row': {
      if (action.target == null || action.target < 0) return null;
      const row = rowOf(action.target);
      return picks.find((p) => p.row === row) || null;
    }
    case 'square': {
      const list = action.targets || (action.target != null ? [action.target] : []);
      const count = ability.target.count || 1;
      const range = ability.target.adjacentOnly ? 1 : ability.target.range != null ? ability.target.range : 1;
      if (!list.length || list.length > count || new Set(list).size !== list.length) return null;
      for (const q of list) if (!(playable(s, q) && !pieceAt(s, q) && dist(caster.sq, q) <= range && q !== caster.sq)) return null;
      return { key: `q${list.join('.')}`, targets: list.slice(), target: list[0], covered: list.slice(), recv: [], centerSq: list[0], center: null };
    }
    case 'jump': {
      const key = (action.path || []).join('.');
      return picks.find((p) => p.path.join('.') === key) || null;
    }
    default:
      return null;
  }
}

/**
 * Taunt (rules.js STATUSES.taunt): a taunted attacker must hit the taunter whenever some pick covers it.
 * `picks` are filtered in place semantics (returns the filtered list).
 */
export function applyTaunt(s, caster, picks, isAttack) {
  if (!isAttack || !picks.length) return picks;
  const t = hasStatus(caster, 'taunt');
  if (!t || !t.source) return picks;
  const src = unitById(s, t.source);
  if (!src || !src.alive || src.side === caster.side) return picks;
  const withTaunter = picks.filter((p) => p.recv.includes(src));
  return withTaunter.length ? withTaunter : picks;
}

// ------------------------------------------------------------------------------------- receivers

/** Pieces within `covered` squares currently, filtered by side relation. */
function onCovered(s, ctx, covered, rel) {
  const caster = ctx.caster;
  const out = [];
  for (const q of covered) {
    const p = pieceAt(s, q);
    if (!p) continue;
    if (rel === 'ally' && p.side !== caster.side) continue;
    if (rel === 'enemy' && p.side === caster.side) continue;
    out.push(p);
  }
  return out;
}

/** Evaluate an `area` override (effects.md §3) at effect time. */
export function areaReceivers(s, ctx, area) {
  const caster = ctx.caster;
  const origin = ctx.origin != null ? ctx.origin : caster.sq;
  const side = area.side || 'enemy';
  let covered = [];
  const shape = area.shape;
  if (shape === 'radius') {
    const r = area.r != null ? area.r : 1;
    const inc = area.includeCenter !== false;
    let centers;
    if (area.center === 'chosenSquares') centers = ctx.pick && ctx.pick.targets ? ctx.pick.targets : [];
    else if (area.center === 'target' || area.center === 'square') centers = ctx.pick && ctx.pick.centerSq >= 0 ? [ctx.pick.centerSq] : [];
    else centers = [origin];
    for (const c of centers) for (const q of radiusSquares(s, c, r, inc)) if (!covered.includes(q)) covered.push(q);
  } else if (shape === 'diagonals') {
    covered = diagSquares(s, origin, area.length || 1);
  } else if (shape === 'all') {
    covered = DARK.slice();
  } else if (shape === 'cross') {
    covered = crossSquares(s, ctx.pick ? ctx.pick.centerSq : origin, area.length || 1, area.includeCenter !== false);
  } else {
    covered = ctx.pick ? ctx.pick.covered : [];
  }
  const out = [];
  for (const q of covered) {
    const p = pieceAt(s, q);
    if (p && sideMatch(caster, p, side) && !(p.isWard && side !== 'enemy')) out.push(p);
  }
  return out;
}

/**
 * Receivers of an effect (`who`, effects.md §3) — living units and wards; ops filter wards themselves.
 * ctx = { s, caster, pick, event, origin (ward square for ward behaviours) }
 */
export function resolveWho(ctx, who, eff) {
  const s = ctx.s;
  const caster = ctx.caster;
  const origin = ctx.origin != null ? ctx.origin : caster.sq;
  const alive = (p) => p && (p.isWard ? s.wards.includes(p) : p.alive && p.sq >= 0);
  const range = eff && eff.range != null ? eff.range : 99;
  const count = eff && eff.count != null ? eff.count : 1;
  switch (who || 'targets') {
    case 'targets':
      return ctx.pick ? ctx.pick.recv.filter(alive) : [];
    case 'self':
      return caster.alive ? [caster] : [];
    case 'center': {
      if (!ctx.pick || !ctx.pick.center) return [];
      const p = pieceById(s, ctx.pick.center);
      return alive(p) ? [p] : [];
    }
    case 'firstInLine':
      return ctx.pick && alive(ctx.pick.first) ? [ctx.pick.first] : [];
    case 'alliesInShape':
      return ctx.pick ? onCovered(s, ctx, ctx.pick.covered, 'ally') : [];
    case 'enemiesInShape':
      return ctx.pick ? onCovered(s, ctx, ctx.pick.covered, 'enemy') : [];
    case 'allAllies':
      return s.units.filter((u) => u.alive && u.sq >= 0 && u.side === caster.side);
    case 'allEnemies':
      return [...s.units.filter((u) => u.alive && u.sq >= 0 && u.side !== caster.side), ...s.wards.filter((w) => w.side !== caster.side)];
    case 'adjacentAllies':
    case 'adjacentEnemies': {
      const out = [];
      if (origin < 0) return out;
      for (const n of neighbors(origin)) {
        const p = pieceAt(s, n);
        if (!p || p === caster) continue;
        if ((who === 'adjacentAllies') === (p.side === caster.side)) out.push(p);
      }
      return out;
    }
    case 'enemiesAroundCenter': {
      const c = ctx.pick ? ctx.pick.centerSq : -1;
      if (c < 0) return [];
      const out = [];
      for (const n of neighbors(c)) {
        const p = pieceAt(s, n);
        if (p && p.side !== caster.side && (!ctx.pick.center || p.id !== ctx.pick.center)) out.push(p);
      }
      return out;
    }
    case 'lowestHpAlly': {
      const c = s.units.filter((u) => u.alive && u.sq >= 0 && u.side === caster.side && dist(origin, u.sq) <= range);
      return sortByPick(c, 'lowestHpPct', origin).slice(0, count);
    }
    case 'lowestEnergyAlly': {
      const c = s.units.filter((u) => u.alive && u.sq >= 0 && u.side === caster.side && u !== caster && dist(origin, u.sq) <= range && u.energy < u.maxEnergy);
      return sortByPick(c, 'lowestEnergy', origin).slice(0, count);
    }
    case 'nearestEnemy': {
      const c = s.units.filter((u) => u.alive && u.sq >= 0 && u.side !== caster.side && dist(origin, u.sq) <= range && !hasStatus(u, 'untargetable'));
      c.sort((a, b) => dist(origin, a.sq) - dist(origin, b.sq) || a.hp / a.maxHp - b.hp / b.maxHp || a.sq - b.sq);
      return c.slice(0, count);
    }
    case 'eventSource': {
      const p = ctx.event && ctx.event.source ? pieceById(s, ctx.event.source) : null;
      return alive(p) ? [p] : [];
    }
    case 'eventTarget': {
      const p = ctx.event && ctx.event.target ? pieceById(s, ctx.event.target) : null;
      return alive(p) ? [p] : [];
    }
    default:
      throw new Error(`unknown receiver selector: ${who}`);
  }
}

export { DIRS };
