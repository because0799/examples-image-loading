// Effective stats and modifiers (effects.md §5): hero mods (passive / quirks / constellations),
// auras (heroes and wards), statuses, the Crown, role traits, boss phases and stage rules.

import { STATUSES, AWAKEN, DAMAGE, ROLES, BOSS } from '../data/rules.js';
import { unitDef } from './defs.js';
import { dist, rowsAdvanced, neighbors } from './board.js';
import { hasStatus, statusValue, pieceAt, isDisabled, unitById } from './state.js';

// Status → stat contributions (rules.js STATUSES[*].effect, value from the instance or the default).
const STATUS_STAT = {
  inspire: 'atkPct',
  weaken: 'atkPct',
  brace: 'defPct',
  brittle: 'defPct',
  mark: 'damageTakenPct',
  break: 'damageTakenPct',
  blight: 'healingReceivedPct',
};
const STATUS_SIGN = { weaken: -1, brittle: -1, blight: -1 };

/**
 * Condition check (effects.md §4). `env` = { self, target, s, moved, movedDist, round, reaction,
 * crit, source, koAny, originSq }. Unknown keys are false (closed vocabulary).
 */
export function checkCond(cond, env) {
  if (!cond) return true;
  for (const key in cond) {
    const v = cond[key];
    const t = env.target;
    switch (key) {
      case 'targetHasSeal':
        if (!t || t.isWard) return false;
        if (v === 'any' ? t.seals.length === 0 : !t.seals.some((x) => x.element === v)) return false;
        break;
      case 'targetHasStatus':
        if (!t || t.isWard) return false;
        if (Array.isArray(v) ? !v.some((id) => hasStatus(t, id)) : !hasStatus(t, v)) return false;
        break;
      case 'targetHpBelow':
        if (!t || !(t.hp / t.maxHp < v)) return false;
        break;
      case 'selfHpBelow':
        if (!env.self || !(env.self.hp / env.self.maxHp < v)) return false;
        break;
      case 'targetIsolated':
        if (!t || isIsolated(env.s, t) !== !!v) return false;
        break;
      case 'distanceAtLeast': {
        const from = env.fromSq != null ? env.fromSq : env.self ? env.self.sq : -1;
        if (!t || from < 0 || t.sq < 0 || dist(from, t.sq) < v) return false;
        break;
      }
      case 'selfMoved':
        if (!!env.moved !== !!v) return false;
        break;
      case 'selfAwakened':
        if (!env.self || !!env.self.awakened !== !!v) return false;
        break;
      case 'ko':
        if (!!env.koAny !== !!v) return false;
        break;
      case 'round':
        if ((env.s.round % 2 === 1 ? 'odd' : 'even') !== v) return false;
        break;
      case 'anyAllyKo':
        if (!!env.anyAllyKo !== !!v) return false;
        break;
      case 'movedAtLeast':
        if (!((env.movedDist || 0) >= v)) return false;
        break;
      case 'crit':
        if (!!env.crit !== !!v) return false;
        break;
      case 'reaction':
        if (Array.isArray(v) ? !v.includes(env.reaction) : env.reaction !== v) return false;
        break;
      case 'source': {
        const src = env.source;
        if (v === 'melee' ? !env.melee : src !== v) return false;
        break;
      }
      default:
        return false;
    }
  }
  return true;
}

/** No ally of the piece is diagonally adjacent to it. */
export function isIsolated(s, t) {
  if (t.sq < 0) return true;
  for (const n of neighbors(t.sq)) {
    const p = pieceAt(s, n);
    if (p && !p.isWard && p !== t && p.side === t.side) return false;
  }
  return true;
}

function modValue(m, unit, env) {
  if (!m.scale) return m.value;
  let units = 0;
  if (m.scale === 'rowsAdvanced') {
    const sq = env.originSq != null && env.originSq >= 0 ? env.originSq : unit.sq;
    units = sq >= 0 ? rowsAdvanced(unit.side, sq) : 0;
  } else if (m.scale.startsWith('stacks:')) {
    const st = hasStatus(unit, m.scale.slice(7));
    units = st ? st.stacks || 0 : 0;
  } else if (m.scale === 'markedEnemies') {
    for (const u of env.s.units) if (u.alive && u.side !== unit.side && hasStatus(u, 'mark')) units++;
  }
  let v = (m.perUnit != null ? m.perUnit : m.value) * units;
  if (m.max != null) v = Math.min(v, m.max);
  return v;
}

/** Sum of a mod stat for a unit: own mods + auras from allies / wards. */
export function sumMod(s, unit, stat, env = {}) {
  const e = env.s && env.self ? env : { ...env, s, self: env.self || unit };
  let total = 0;
  const def = unitDef(unit);
  for (const m of def.mods) {
    if (m.stat !== stat) continue;
    if (m.if && !checkCond(m.if, e)) continue;
    total += modValue(m, unit, e);
  }
  // auras of other heroes (and herself) of the same side
  for (const o of s.units) {
    if (!o.alive || o.side !== unit.side) continue;
    const od = unitDef(o);
    if (!od.auras.length || isDisabled(o)) continue;
    for (const a of od.auras) {
      if (a.side !== 'ally') continue;
      if (unit.sq < 0 || o.sq < 0 || dist(o.sq, unit.sq) > a.range) continue;
      for (const m of a.mods) {
        if (m.stat !== stat) continue;
        if (m.if && !checkCond(m.if, e)) continue;
        total += modValue(m, o, e);
      }
    }
  }
  for (const w of s.wards) {
    if (!w.aura || w.side !== unit.side || unit.sq < 0) continue;
    if (dist(w.sq, unit.sq) > w.aura.range) continue;
    for (const m of w.aura.mods) {
      if (m.stat !== stat) continue;
      if (m.if && !checkCond(m.if, e)) continue;
      total += m.value;
    }
  }
  return total;
}

function statusSum(unit, stat) {
  let t = 0;
  for (const st of unit.statuses) {
    if (STATUS_STAT[st.id] !== stat) continue;
    const v = st.value != null ? st.value : STATUSES[st.id].value != null ? STATUSES[st.id].value : st.id === 'break' ? 0.3 : 0;
    t += (STATUS_SIGN[st.id] || 1) * v;
  }
  return t;
}

export function atkPct(s, u, env) {
  return sumMod(s, u, 'atkPct', env) + statusSum(u, 'atkPct') + (u.awakened ? AWAKEN.atkPct : 0);
}

export function defPct(s, u, env) {
  return sumMod(s, u, 'defPct', env) + statusSum(u, 'defPct') + (u.awakened ? AWAKEN.defPct : 0);
}

export function atkEff(s, u, env = {}) {
  return u.atk * Math.max(0, 1 + atkPct(s, u, env));
}

export function defEff(s, u, env = {}) {
  if (u.isWard) return 0;
  return Math.max(0, u.def * (1 + defPct(s, u, env)));
}

export function statValue(s, u, stat, env = {}) {
  if (stat === 'def') return defEff(s, u, env);
  if (stat === 'maxHp') return u.maxHp;
  return atkEff(s, u, env);
}

/** Bonus damage taken by a target (Mark, Break, boss phase, Bulwark −15 %). Frozen is added separately. */
export function damageTakenPct(s, t, env = {}) {
  if (t.isWard) return 0;
  let v = statusSum(t, 'damageTakenPct') + sumMod(s, t, 'damageTakenPct', env);
  if (t.boss && t.boss.phase === 3) v += 0.25;
  if (hasBulwark(s, t)) v += ROLES.guardian.trait.params.damageTakenPct;
  return v;
}

/** A Guardian ally (not Stunned / Frozen) stands diagonally adjacent (Заслон, does not stack). */
export function hasBulwark(s, t) {
  if (t.sq < 0) return false;
  for (const n of neighbors(t.sq)) {
    const p = pieceAt(s, n);
    if (p && !p.isWard && p.side === t.side && p.role === 'guardian' && !isDisabled(p)) return true;
  }
  return false;
}

export function critChance(s, u, env, bonus = 0) {
  let c = u.crit + sumMod(s, u, 'critChance', env) + bonus;
  if (u.role === 'shadow' && env.target && !env.target.isWard && isIsolated(s, env.target)) c += ROLES.shadow.trait.params.critChance;
  return Math.max(0, Math.min(DAMAGE.critCap, c));
}

export function critMult(s, u, env) {
  return DAMAGE.critMult + sumMod(s, u, 'critDmg', env);
}

export function dmgPct(s, u, env) {
  let v = sumMod(s, u, 'dmgPct', env);
  const rule = s.stage && s.stage.rule;
  if (rule && rule.id === 'elementBoost' && env.element === rule.element) v += rule.pct;
  return v;
}

export function healPct(s, u, env) {
  return sumMod(s, u, 'healPct', env);
}

export function healingReceivedPct(s, t) {
  let v = statusSum(t, 'healingReceivedPct');
  // 3-B phase 1 «Вечное затмение»: the player's healing −30 %
  for (const b of s.units) if (b.alive && b.boss && b.boss.mechanics && b.boss.mechanics.includes('phase1') && b.boss.phase === 1 && b.side !== t.side) v -= 0.3;
  return v;
}

export function affinity(s, u, env) {
  return Math.max(0, Math.min(DAMAGE.affCap, u.aff + sumMod(s, u, 'aff', env)));
}

export function reactionPct(s, u, env) {
  let v = sumMod(s, u, 'reactionPct', env);
  if (u.role === 'mystic') v += ROLES.mystic.trait.params.reactionPct;
  const rule = s.stage && s.stage.rule;
  if (rule && rule.id === 'reactionBoost' && rule.reaction === env.reaction && rule.pct) v += rule.pct;
  return v;
}

export function basicRange(s, u) {
  return unitDef(u).basic.range + sumMod(s, u, 'basicRange', {});
}

export function glideBonus(s, u) {
  return sumMod(s, u, 'glideLength', {});
}

export function chainBonus(s, u) {
  return sumMod(s, u, 'chainMax', {});
}

export function energyGainPct(s, u) {
  return sumMod(s, u, 'energyGainPct', {});
}

export function skillCooldownAdd(s, u) {
  return sumMod(s, u, 'skillCooldown', {});
}

export function overhealToShieldPct(s, u) {
  return sumMod(s, u, 'overhealToShieldPct', {});
}

/** Display snapshot for the UI: effective ATK / DEF / crit and the current modifiers. */
export function unitStats(s, id) {
  const u = unitById(s, id);
  if (!u) return null;
  return {
    hp: u.hp,
    maxHp: u.maxHp,
    atk: Math.floor(atkEff(s, u)),
    def: Math.floor(defEff(s, u)),
    crit: critChance(s, u, {}),
    aff: affinity(s, u, {}),
    atkPct: atkPct(s, u, {}),
    defPct: defPct(s, u, {}),
    damageTakenPct: damageTakenPct(s, u, {}),
    shield: u.shield,
    energy: u.energy,
    maxEnergy: u.maxEnergy,
    bulwark: hasBulwark(s, u),
    boss: !!u.boss,
    bossBreakAt: u.boss ? BOSS.breakAt : 0,
  };
}

export { statusValue };
