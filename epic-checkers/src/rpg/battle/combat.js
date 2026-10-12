// Combat primitives: damage (rules.js DAMAGE + effects.md §9 seals/reactions), healing, shields,
// statuses, seals, energy, KO, awakening, displacement, wards and zones. Every primitive mutates the
// working state `ctx.s` and appends events to `ctx.E.ev`.

import { STATUSES, ELEMENTS, REACTIONS, reactionFor, elementMult, defenseFactor, ENERGY, AWAKEN, BOSS, BATTLE, CLEANSABLE, DISPELLABLE } from '../data/rules.js';
import { unitDef } from './defs.js';
import { nextRand } from './rng.js';
import { stepSq, dist, dirBetween, rowOf, colOf, neighbors, DARK } from './board.js';
import { hasStatus, sealOf, pieceAt, playable, unitById, nextId, homeSquares, nearestEmpty } from './state.js';
import { atkEff, defEff, statValue, critChance, critMult, dmgPct, damageTakenPct, healingReceivedPct, affinity, reactionPct, energyGainPct, overhealToShieldPct, healPct } from './stats.js';
import { fire, fireSide } from './triggers.js';
import { runEffects, subCtx } from './effects.js';
import { displaceImmune } from './movement.js';
import { stageAfterDamage, stageGateFor } from './stage.js';

export function emit(ctx, ev) {
  ctx.E.ev.push(ev);
}

export function unitStats(ctx, u) {
  const st = ctx.s.stats.units;
  if (!st[u.id]) st[u.id] = { dmgDealt: 0, dmgTaken: 0, healed: 0, shielded: 0, kos: 0, reactions: 0, crits: 0, ults: 0, skills: 0, basics: 0, chains: 0, hops: 0, maxChain: 0, awakenings: 0, actions: 0 };
  return st[u.id];
}

export function sideStats(ctx, side) {
  return ctx.s.stats.sides[side];
}

// ------------------------------------------------------------------------------------------ energy

/**
 * Change a unit's energy (0..maxEnergy). Positive gains are blocked for Stunned / Frozen units and,
 * when `generic` (action / hit / reaction / KO rewards), for the caster of the Ultimate being resolved.
 */
export function changeEnergy(ctx, u, amount, reason, generic = true) {
  if (!u || u.isWard || !u.alive || !amount) return 0;
  let a = amount;
  if (a > 0) {
    if (hasStatus(u, 'frozen') || hasStatus(u, 'stun')) return 0;
    if (generic && ctx.E.ultCaster === u.id) return 0;
    a *= 1 + energyGainPct(ctx.s, u);
  }
  const next = Math.max(0, Math.min(u.maxEnergy, Math.round(u.energy + a)));
  const delta = next - u.energy;
  if (!delta) return 0;
  u.energy = next;
  emit(ctx, { type: 'energy', unit: u.id, value: next, max: u.maxEnergy, delta, reason });
  return delta;
}

// ---------------------------------------------------------------------------------------- statuses

function seqOf(ctx) {
  ctx.s.seq += 1;
  return ctx.s.seq;
}

function isFresh(ctx, u) {
  return ctx.s.side === u.side;
}

/** Add a stagger stack to a boss; 3 stacks → Break (rules.js BOSS). */
export function addStagger(ctx, boss, src) {
  let st = hasStatus(boss, 'stagger');
  if (!st) {
    st = { id: 'stagger', turns: null, stacks: 0, source: src ? src.id : null, seq: seqOf(ctx) };
    boss.statuses.push(st);
  }
  st.stacks += BOSS.staggerPerCc;
  emit(ctx, { type: 'status', target: boss.id, status: 'stagger', turns: null, stacks: st.stacks, on: true, source: src ? src.id : null });
  if (st.stacks >= BOSS.breakAt) {
    boss.statuses.splice(boss.statuses.indexOf(st), 1);
    emit(ctx, { type: 'status', target: boss.id, status: 'stagger', turns: null, stacks: 0, on: false });
    addStatus(ctx, src, boss, 'break', { turns: 1, force: true });
  }
}

/**
 * Apply a status (rules.js STATUSES). Re-applying refreshes the duration and keeps the larger value.
 * Bosses turn control into Stagger. Statuses applied during the holder's own turn skip that turn's tick.
 */
export function addStatus(ctx, src, tgt, id, o = {}) {
  if (!tgt || tgt.isWard || !tgt.alive) return false;
  const def = STATUSES[id];
  if (!def) throw new Error(`unknown status: ${id}`);
  if (tgt.boss && !o.force && BOSS.ccImmune.includes(id)) {
    addStagger(ctx, tgt, src);
    return false;
  }
  const turns = o.turns !== undefined ? o.turns : def.turns;
  const value = o.value !== undefined ? o.value : def.value;
  const fresh = isFresh(ctx, tgt);
  let st = hasStatus(tgt, id);
  if (def.stack === 'stacks') {
    const add = o.stacks || 1;
    const max = o.max || def.maxStacks || 99;
    if (st) st.stacks = Math.min(max, (st.stacks || 0) + add);
    else {
      st = { id, turns: null, stacks: Math.min(max, add), source: src ? src.id : null, seq: seqOf(ctx) };
      tgt.statuses.push(st);
    }
  } else if (st) {
    if (turns == null || st.turns == null) st.turns = null;
    else if (turns >= st.turns) {
      st.turns = turns;
      st.fresh = fresh;
    }
    if (value != null) st.value = Math.max(st.value != null ? st.value : 0, value);
    if (src) st.source = src.id;
    st.seq = seqOf(ctx);
  } else {
    st = { id, turns: turns == null ? null : turns, stacks: 1, source: src ? src.id : null, fresh, seq: seqOf(ctx) };
    if (value != null) st.value = value;
    tgt.statuses.push(st);
  }
  emit(ctx, { type: 'status', target: tgt.id, status: id, turns: st.turns, stacks: st.stacks, value: st.value, on: true, source: src ? src.id : null });
  if (src && src.id !== tgt.id && src.side !== tgt.side) {
    const ss = unitStats(ctx, src);
    ss.debuffs = (ss.debuffs || 0) + 1;
  }
  return true;
}

export function removeStatus(ctx, u, st, reason = 'expired') {
  const i = u.statuses.indexOf(st);
  if (i < 0) return;
  u.statuses.splice(i, 1);
  emit(ctx, { type: 'status', target: u.id, status: st.id, turns: 0, stacks: 0, on: false, reason });
  if (st.id === 'shield' && u.shield) {
    u.shield = 0;
    emit(ctx, { type: 'shield', target: u.id, amount: 0, value: 0 });
  }
  if (st.id === 'crown') {
    u.awakened = false;
  }
}

/** Remove up to `count` negative statuses, most recent first (optionally only `ids`). */
export function cleanse(ctx, u, count = 1, ids = null) {
  const list = u.statuses.filter((st) => CLEANSABLE.includes(st.id) && (!ids || ids.includes(st.id))).sort((a, b) => b.seq - a.seq);
  const n = count === 'all' ? list.length : Math.min(count, list.length);
  for (let i = 0; i < n; i++) removeStatus(ctx, u, list[i], 'cleansed');
  return n;
}

/** Remove up to `count` positive statuses, most recent first; `steal` copies them to `thief`. */
export function dispel(ctx, u, count = 1, thief = null) {
  const list = u.statuses.filter((st) => DISPELLABLE.includes(st.id)).sort((a, b) => b.seq - a.seq);
  const n = count === 'all' ? list.length : Math.min(count, list.length);
  for (let i = 0; i < n; i++) {
    const st = list[i];
    const shieldValue = st.id === 'shield' ? u.shield : 0;
    removeStatus(ctx, u, st, 'dispelled');
    if (thief && thief.alive) {
      if (st.id === 'shield') giveShield(ctx, thief, thief, shieldValue, st.turns || 2, { noBond: true });
      else addStatus(ctx, thief, thief, st.id, { turns: st.turns, value: st.value });
    }
  }
  return n;
}

// -------------------------------------------------------------------------------------------- seals

export function sealTurns(s, element) {
  const rule = s.stage && s.stage.rule;
  if (rule && rule.id === 'sealDuration' && rule.element === element) return rule.turns;
  return 2;
}

function syncSeal(u) {
  const nat = sealOf(u, 'natural');
  const cel = sealOf(u, 'celestial');
  u.seal = nat ? nat.element : cel ? cel.element : null;
}

/** Apply an element seal without damage (no reaction). Same element refreshes; another replaces. */
export function addSeal(ctx, tgt, element, turns) {
  if (!tgt || tgt.isWard || !tgt.alive) return false;
  const el = ELEMENTS[element];
  if (!el || !el.leavesSeal) return false;
  const dur = turns != null ? turns : sealTurns(ctx.s, element);
  const fresh = isFresh(ctx, tgt);
  const ex = sealOf(tgt, el.slot);
  if (ex) {
    if (ex.element === element) ex.turns = Math.max(ex.turns, dur);
    else {
      ex.element = element;
      ex.turns = dur;
    }
    ex.fresh = fresh;
  } else tgt.seals.push({ element, slot: el.slot, turns: dur, fresh });
  syncSeal(tgt);
  emit(ctx, { type: 'seal', target: tgt.id, element, slot: el.slot, turns: dur, seals: tgt.seals.map((x) => x.element) });
  return true;
}

export function removeSeal(ctx, u, slot, reason = 'expired') {
  const ex = sealOf(u, slot);
  if (!ex) return;
  u.seals.splice(u.seals.indexOf(ex), 1);
  syncSeal(u);
  emit(ctx, { type: 'seal', target: u.id, element: null, slot, removed: ex.element, reason, seals: u.seals.map((x) => x.element) });
}

// ------------------------------------------------------------------------------------ heal / shield

/** Shield: does not stack — the larger value stays. Oracle sources give the target +5 energy. */
export function giveShield(ctx, src, tgt, value, turns = 2, o = {}) {
  if (!tgt || tgt.isWard || !tgt.alive) return 0;
  const v = Math.floor(value);
  if (v <= 0) return 0;
  const st = hasStatus(tgt, 'shield');
  if (st && tgt.shield >= v) {
    if (st.turns != null && turns > st.turns && tgt.shield === v) st.turns = turns;
    bond(ctx, src, tgt, o);
    return 0;
  }
  const gained = v - (st ? tgt.shield : 0);
  tgt.shield = v;
  if (st) {
    st.turns = turns;
    st.value = v;
    st.fresh = isFresh(ctx, tgt);
    st.seq = seqOf(ctx);
  } else tgt.statuses.push({ id: 'shield', turns, stacks: 1, value: v, source: src ? src.id : null, fresh: isFresh(ctx, tgt), seq: seqOf(ctx) });
  emit(ctx, { type: 'shield', target: tgt.id, amount: v, value: v, gained, source: src ? src.id : null, turns });
  if (src) unitStats(ctx, src).shielded += gained;
  bond(ctx, src, tgt, o);
  return gained;
}

function bond(ctx, src, tgt, o) {
  if (!o.noBond && src && !ctx.viaWard && src.role === 'oracle' && src.side === tgt.side) changeEnergy(ctx, tgt, 5, 'bond', false);
}

/** Heal `raw` HP (before Blight); capped at max HP; overheal may become a shield (Lucille). */
export function healUnit(ctx, src, tgt, raw, o = {}) {
  if (!tgt || tgt.isWard || !tgt.alive || !(raw > 0)) return 0;
  const amt = Math.floor(Math.max(0, raw * (1 + healingReceivedPct(ctx.s, tgt))));
  const real = Math.min(Math.max(0, tgt.maxHp - tgt.hp), amt);
  tgt.hp += real;
  if (real > 0 || !o.silent) emit(ctx, { type: 'heal', source: src ? src.id : null, target: tgt.id, amount: real, hp: tgt.hp, reason: o.reason });
  if (src) unitStats(ctx, src).healed += real;
  const over = amt - real;
  if (src && over > 0 && !src.isWard) {
    const pct = overhealToShieldPct(ctx.s, src);
    if (pct > 0) giveShield(ctx, src, tgt, Math.min(over, pct * tgt.maxHp), 2, { noBond: true });
  }
  if (!o.noBond) bond(ctx, src, tgt, o);
  if (src && !o.noTrigger && !ctx.viaWard && src.alive && amt > 0) fire(ctx, src, 'healGiven', { source: src.id, target: tgt.id, amount: real });
  return real;
}

/** Raw heal amount of an effect (before the receiver's Blight). */
export function healAmount(ctx, src, tgt, eff) {
  const bonus = 1 + healPct(ctx.s, src, { self: src, target: tgt });
  if (eff.pctMaxHp != null) return tgt.maxHp * eff.pctMaxHp * bonus;
  return statValue(ctx.s, src, eff.stat || 'atk', { self: src, target: tgt }) * (eff.mult || 0) * bonus;
}

// ------------------------------------------------------------------------------------------ damage

function amplifyMult(ctx, src, rid) {
  const R = REACTIONS[rid];
  let base = R.mult;
  const rule = ctx.s.stage && ctx.s.stage.rule;
  if (rule && rule.id === 'reactionBoost' && rule.reaction === rid && rule.mult) base = rule.mult;
  return 1 + (base - 1) * reactionScale(ctx, src, rid);
}

export function reactionScale(ctx, src, rid) {
  const env = { self: src, reaction: rid };
  return (1 + affinity(ctx.s, src, env) / 200) * (1 + reactionPct(ctx.s, src, env));
}

function activationOf(ctx, u) {
  const act = ctx.s.act;
  return act && act.unit === u.id ? act : null;
}

/**
 * Deal one damage instance.
 * spec = { mult, stat='atk', element='self'|'none'|id, critBonus, dmgBonus, kind: 'hit'|'reaction'|'true',
 *          flat (true damage amount), melee, source ('basic'|'jump'|'skill'|'ult'|'quirk'|'trigger'|...),
 *          label (event label), pointBlank, noTriggers }
 * Returns { amount, crit, reaction, ko } or null.
 */
export function dealDamage(ctx, src, tgt, spec) {
  const s = ctx.s;
  if (!tgt || (tgt.isWard ? !s.wards.includes(tgt) : !tgt.alive || tgt.sq < 0)) return null;
  const kind = spec.kind || 'hit';
  let element = spec.element == null || spec.element === 'self' ? (src ? src.element : 'none') : spec.element;
  if (kind === 'true') element = spec.element && spec.element !== 'self' ? spec.element : 'none';
  if (tgt.isWard) return damageWard(ctx, src, tgt, spec, element);

  const act = src ? activationOf(ctx, src) : null;
  const env = {
    s, self: src, target: tgt, element,
    moved: act ? act.moved : false, movedDist: act ? act.movedDist : 0,
    originSq: ctx.originSq != null ? ctx.originSq : src ? src.sq : -1, fromSq: src ? src.sq : -1,
  };
  let reaction = null;
  let sealEl = null;
  if (kind === 'hit' && element !== 'none' && ELEMENTS[element] && spec.canReact !== false) {
    const seal = sealOf(tgt, ELEMENTS[element].slot);
    if (seal) {
      reaction = reactionFor(element, seal.element);
      sealEl = seal.element;
    }
  }
  env.reaction = reaction;
  let amount;
  let crit = false;
  if (kind === 'true') {
    amount = Math.max(1, Math.floor(spec.flat != null ? spec.flat : statValue(s, src, spec.stat || 'atk', env) * (spec.mult || 0)));
  } else {
    let base = statValue(s, src, spec.stat || 'atk', env) * (spec.mult || 0);
    base *= defenseFactor(src.level, defEff(s, tgt));
    if (kind === 'hit') {
      base *= elementMult(element, tgt.element);
      if (reaction && REACTIONS[reaction].kind === 'amplify') base *= amplifyMult(ctx, src, reaction);
      const chance = critChance(s, src, env, spec.critBonus || 0) / 100;
      const cm = critMult(s, src, env);
      if (ctx.E.opts.expected) base *= 1 + chance * (cm - 1);
      else if (chance > 0 && nextRand(s) < chance) {
        crit = true;
        base *= cm;
      }
      let bonus = 1 + dmgPct(s, src, env) + (spec.dmgBonus || 0) + (ctx.actionBonus || 0);
      // Steady Aim: +15 % when the Ranger did not move this activation (a jump-strike is movement)
      if (src.role === 'ranger' && act && !act.moved && act.kind !== 'jump' && ctx.kind !== 'trigger' && ctx.kind !== 'ward' && ctx.kind !== 'jump') bonus += 0.15;
      base *= Math.max(0, bonus);
    }
    let taken = 1 + damageTakenPct(s, tgt, env);
    if (hasStatus(tgt, 'frozen')) taken += STATUSES.frozen.effect.nextHitTakenMult - 1;
    amount = Math.max(1, Math.floor(base * Math.max(0, taken)));
  }

  // Vera's Oath (allyHit): part of an enemy hit is redirected to an adjacent ally
  if (src && src.side !== tgt.side && kind !== 'true' && !spec.noRedirect) amount = tryRedirect(ctx, src, tgt, amount);

  // lethal: survive triggers (Stubborn) and the decoy (Dusk Double)
  const hpBefore = tgt.hp;
  const absorbable = Math.min(tgt.shield, amount);
  let survive = null;
  if (amount - absorbable >= tgt.hp) survive = onLethal(ctx, src, tgt, spec);
  if (survive && survive.swapped) {
    // the decoy took the blow: the unit escaped (no damage)
    return { amount: 0, crit, reaction: null, ko: false };
  }
  const absorbed = Math.min(tgt.shield, amount);
  if (absorbed) {
    tgt.shield -= absorbed;
    const sh = hasStatus(tgt, 'shield');
    if (sh) sh.value = tgt.shield;
    if (tgt.shield <= 0 && sh) {
      tgt.statuses.splice(tgt.statuses.indexOf(sh), 1);
      emit(ctx, { type: 'status', target: tgt.id, status: 'shield', turns: 0, stacks: 0, on: false, reason: 'broken' });
    }
  }
  let hpLoss = amount - absorbed;
  tgt.hp -= hpLoss;
  if (survive && tgt.hp < survive.hp) {
    hpLoss -= survive.hp - tgt.hp;
    tgt.hp = survive.hp;
  }
  if (tgt.hp < 0) {
    hpLoss += tgt.hp;
    tgt.hp = 0;
  }
  emit(ctx, {
    type: 'damage', source: src ? src.id : null, target: tgt.id, amount, crit, element, reaction: reaction || undefined,
    absorbed, hp: tgt.hp, shield: tgt.shield, kind: spec.label || kind, ability: ctx.abilityId || undefined,
  });
  if (src) {
    const ss = unitStats(ctx, src);
    if (src.side !== tgt.side) ss.dmgDealt += absorbed + hpLoss;
    if (crit) ss.crits += 1;
  }
  unitStats(ctx, tgt).dmgTaken += absorbed + hpLoss;

  // energy on hit taken (+6, max +12 per enemy turn)
  if (src && src.side !== tgt.side && tgt.hp > 0 && kind !== 'true') {
    const tt = s.tt;
    const got = tt.hitEnergy[tgt.id] || 0;
    const room = ENERGY.hitTakenCapPerTurn - got;
    if (room > 0) {
      changeEnergy(ctx, tgt, Math.min(ENERGY.hitTaken, room), 'hit');
      tt.hitEnergy[tgt.id] = got + Math.min(ENERGY.hitTaken, room);
    }
  }
  // crown loss (startCrowned): damage taken during one enemy turn
  if (s.side !== tgt.side && hpLoss > 0) {
    s.tt.dmgTaken[tgt.id] = (s.tt.dmgTaken[tgt.id] || 0) + hpLoss;
    const sc = unitDef(tgt).rules.startCrowned;
    if (sc && tgt.awakened && s.tt.dmgTaken[tgt.id] >= sc.lossThresholdPct * tgt.maxHp) loseCrown(ctx, tgt);
  }
  // frozen breaks on a hit
  const fr = hasStatus(tgt, 'frozen');
  if (fr && kind !== 'true') removeStatus(ctx, tgt, fr, 'shattered');

  // seal outcome
  if (kind === 'hit' && element !== 'none' && ELEMENTS[element]) {
    if (reaction) resolveReaction(ctx, src, tgt, reaction, element, sealEl);
    else if (tgt.hp > 0 && ELEMENTS[element].leavesSeal && spec.applySeal !== false) addSeal(ctx, tgt, element);
  }

  if (kind === 'hit') {
    if (ctx.hitIds) ctx.hitIds.add(tgt.id);
    ctx.lastHit = tgt.id;
    ctx.lastHitSq = tgt.sq;
  }

  if (kind === 'hit' && src && !spec.noTriggers && src.side !== tgt.side) {
    const evt = { source: src.id, target: tgt.id, crit, reaction, kind: spec.source || ctx.srcKind, melee: !!spec.melee, amount };
    fire(ctx, src, 'hitDealt', evt);
    if (tgt.alive && tgt.hp > 0) {
      fire(ctx, tgt, 'hitTaken', evt);
      if (spec.melee) fire(ctx, tgt, 'meleeHitTaken', evt);
    }
  } else if (kind === 'reaction' && src && src.side !== tgt.side && tgt.hp > 0) {
    fire(ctx, tgt, 'hitTaken', { source: src.id, target: tgt.id, kind: 'reaction', amount });
  }

  if (tgt.hp > 0) {
    afterHpDrop(ctx, tgt, hpBefore);
  } else if (tgt.alive) {
    queueKo(ctx, tgt, src);
  }
  return { amount, crit, reaction, ko: tgt.hp <= 0 };
}

function damageWard(ctx, src, w, spec, element) {
  const s = ctx.s;
  let amount;
  let crit = false;
  if (spec.kind === 'true') amount = Math.max(1, Math.floor(spec.flat != null ? spec.flat : statValue(s, src, spec.stat || 'atk', {}) * (spec.mult || 0)));
  else {
    let base = statValue(s, src, spec.stat || 'atk', { self: src }) * (spec.mult || 0);
    if (spec.kind !== 'reaction') {
      const chance = critChance(s, src, { self: src, target: w }, spec.critBonus || 0) / 100;
      const cm = critMult(s, src, {});
      if (ctx.E.opts.expected) base *= 1 + chance * (cm - 1);
      else if (chance > 0 && nextRand(s) < chance) {
        crit = true;
        base *= cm;
      }
      base *= Math.max(0, 1 + (spec.dmgBonus || 0) + (ctx.actionBonus || 0));
    }
    amount = Math.max(1, Math.floor(base));
  }
  const real = Math.min(amount, w.hp);
  w.hp -= amount;
  if (w.hp < 0) w.hp = 0;
  emit(ctx, { type: 'damage', source: src ? src.id : null, target: w.id, ward: true, amount, crit, element, absorbed: 0, hp: w.hp, shield: 0, kind: spec.label || spec.kind || 'hit' });
  if (ctx.hitIds) ctx.hitIds.add(w.id);
  ctx.lastHit = w.id;
  ctx.lastHitSq = w.sq;
  if (w.hp <= 0) destroyWard(ctx, w, 'destroyed', src);
  return { amount: real, crit, reaction: null, ko: w.hp <= 0 };
}

function tryRedirect(ctx, src, tgt, amount) {
  const s = ctx.s;
  for (const n of neighbors(tgt.sq)) {
    const a = pieceAt(s, n);
    if (!a || a.isWard || a === tgt || a.side !== tgt.side || !a.alive) continue;
    const def = unitDef(a);
    if (!def.triggers.some((t) => t.on === 'allyHit')) continue;
    ctx.E.redirect = null;
    fire(ctx, a, 'allyHit', { source: src.id, target: tgt.id, amount });
    const pct = ctx.E.redirect;
    ctx.E.redirect = null;
    if (!pct) continue;
    const moved = Math.floor(amount * pct);
    if (moved <= 0) continue;
    const k = defenseFactor(src.level, defEff(s, a)) / Math.max(1e-6, defenseFactor(src.level, defEff(s, tgt)));
    emit(ctx, { type: 'redirect', unit: a.id, from: tgt.id, amount: moved });
    dealDamage(ctx, src, a, { kind: 'true', flat: Math.max(1, Math.floor(moved * k)), label: 'redirect', noRedirect: true });
    return amount - moved;
  }
  return amount;
}

/** Lethal damage incoming: run lethalDamage triggers (survive) and the decoyWard rule. */
function onLethal(ctx, src, tgt, spec) {
  const E = ctx.E;
  E.survive = null;
  fire(ctx, tgt, 'lethalDamage', { source: src ? src.id : null, target: tgt.id, kind: spec.source || ctx.srcKind, melee: !!spec.melee });
  if (E.survive != null) {
    const hp = Math.max(1, E.survive);
    E.survive = null;
    emit(ctx, { type: 'survive', unit: tgt.id, hp, rule: 'survive' });
    return { hp };
  }
  const decoy = unitDef(tgt).rules.decoyWard;
  if (decoy && !tgt.uses.decoy) {
    const w = ctx.s.wards.find((x) => x.special === 'decoy' && x.owner === tgt.id);
    if (w) {
      tgt.uses.decoy = 1;
      const from = tgt.sq;
      const to = w.sq;
      removeWardSilently(ctx, w);
      emit(ctx, { type: 'ward', id: w.id, kind: w.kind, sq: w.sq, owner: w.owner, side: w.side, hp: 0, on: false, reason: 'decoy' });
      tgt.sq = to;
      emit(ctx, { type: 'displace', unit: tgt.id, from, to, kind: 'decoy' });
      tgt.hp = Math.max(1, Math.floor(decoy.reviveHpPct * tgt.maxHp));
      emit(ctx, { type: 'survive', unit: tgt.id, hp: tgt.hp, rule: 'decoyWard' });
      addStatus(ctx, tgt, tgt, 'untargetable', { turns: decoy.veil || 1 });
      return { swapped: true };
    }
  }
  return null;
}

/** Cocoon (Mashiro) / boss thresholds after a unit's HP dropped. */
function afterHpDrop(ctx, tgt, hpBefore) {
  const s = ctx.s;
  for (const m of s.units) {
    if (!m.alive || m.side !== tgt.side || m === tgt) continue;
    const c = unitDef(m).rules.cocoon;
    if (!c || (m.uses.cocoon || 0) >= c.uses) continue;
    if (!(hpBefore / tgt.maxHp >= c.hpBelow && tgt.hp / tgt.maxHp < c.hpBelow)) continue;
    if (dist(m.sq, tgt.sq) > c.range) continue;
    m.uses.cocoon = (m.uses.cocoon || 0) + 1;
    emit(ctx, { type: 'rule', unit: m.id, rule: 'cocoon', target: tgt.id });
    // Veiled through the following enemy turn (2 ticks), Stunned for the next own turn.
    addStatus(ctx, m, tgt, 'untargetable', { turns: 2 });
    addStatus(ctx, m, tgt, 'stun', { turns: 1 });
    break;
  }
  stageAfterDamage(ctx, tgt, hpBefore);
}

// ---------------------------------------------------------------------------------------- reactions

function resolveReaction(ctx, src, tgt, rid, hitEl, sealEl) {
  const s = ctx.s;
  const R = REACTIONS[rid];
  emit(ctx, { type: 'reaction', target: tgt.id, reaction: rid, elements: [hitEl, sealEl], source: src.id });
  if (tgt.alive) removeSeal(ctx, tgt, ELEMENTS[sealEl].slot, 'reaction');
  changeEnergy(ctx, src, ENERGY.reaction, 'reaction');
  unitStats(ctx, src).reactions += 1;
  const sst = sideStats(ctx, src.side);
  sst.reactions[rid] = (sst.reactions[rid] || 0) + 1;
  const scale = reactionScale(ctx, src, rid);
  const enemiesAround = (center, r) => {
    const out = [];
    for (const q of DARK) {
      if (q === center || dist(q, center) > r) continue;
      const p = pieceAt(s, q);
      if (p && p.side !== src.side) out.push(p);
    }
    return out;
  };
  const tgtAlive = () => tgt.alive && tgt.hp > 0;
  const center = tgt.sq;
  switch (rid) {
    case 'detonation': {
      if (tgtAlive()) dealDamage(ctx, src, tgt, { kind: 'reaction', mult: R.coef * scale, element: hitEl, label: 'reaction' });
      for (const p of enemiesAround(center, R.splash.r)) dealDamage(ctx, src, p, { kind: 'reaction', mult: R.splashCoef * scale, element: hitEl, label: 'reaction' });
      if (tgtAlive()) pushUnit(ctx, src, tgt, R.push, src.sq);
      break;
    }
    case 'arc': {
      if (tgtAlive()) dealDamage(ctx, src, tgt, { kind: 'reaction', mult: R.coef * scale, element: hitEl, label: 'reaction' });
      const cands = enemiesAround(center, R.chain.range).filter((p) => !p.isWard && p.alive);
      cands.sort((a, b) => dist(center, a.sq) - dist(center, b.sq) || a.hp / a.maxHp - b.hp / b.maxHp || a.sq - b.sq);
      for (const p of cands.slice(0, R.chain.count)) {
        emit(ctx, { type: 'arc', from: center, to: p.sq, target: p.id });
        dealDamage(ctx, src, p, { kind: 'reaction', mult: R.chain.coef * scale, element: R.chain.applySeal, label: 'reaction' });
        if (p.alive && p.hp > 0 && !sealOf(p, 'natural')) addSeal(ctx, p, R.chain.applySeal);
      }
      break;
    }
    case 'vortex': {
      for (const p of enemiesAround(center, R.spread.r)) {
        dealDamage(ctx, src, p, { kind: 'reaction', mult: R.coef * scale, element: sealEl, label: 'reaction' });
        if (!p.isWard && p.alive && p.hp > 0 && !sealOf(p, 'natural')) addSeal(ctx, p, sealEl);
      }
      if (tgtAlive()) pushUnit(ctx, src, tgt, R.push, src.sq);
      break;
    }
    case 'shackles':
      if (tgtAlive()) addStatus(ctx, src, tgt, R.status.id, { turns: R.status.turns });
      break;
    case 'brittle':
      if (tgtAlive()) for (const st of R.statuses) addStatus(ctx, src, tgt, st.id, { turns: st.turns });
      break;
    case 'facet':
      giveShield(ctx, src, src, R.shield.pctMaxHp * src.maxHp * scale, R.shield.turns, { noBond: true });
      if (tgtAlive()) addStatus(ctx, src, tgt, R.status.id, { turns: R.status.turns });
      break;
    case 'eclipse':
      if (tgtAlive()) addStatus(ctx, src, tgt, R.status.id, { turns: R.status.turns });
      break;
    default:
      break;
  }
  fire(ctx, src, 'reaction', { source: src.id, target: tgt.id, reaction: rid });
  fireSide(ctx, src.side, 'allyReaction', { source: src.id, target: tgt.id, reaction: rid });
}

// --------------------------------------------------------------------------------------------- KO

export function queueKo(ctx, u, killer) {
  ctx.E.koQueue.push({ id: u.id, killer: killer ? killer.id : null });
}

/** Process queued KOs (units at 0 HP). */
export function flushKos(ctx) {
  const E = ctx.E;
  while (E.koQueue.length) {
    const { id, killer } = E.koQueue.shift();
    const u = unitById(ctx.s, id);
    if (u && u.alive && u.hp <= 0) koUnit(ctx, u, killer ? unitById(ctx.s, killer) : null);
  }
}

export function koUnit(ctx, u, killer) {
  const s = ctx.s;
  const sq = u.sq;
  u.alive = false;
  u.lastSq = sq;
  u.sq = -1;
  u.hp = 0;
  u.statuses = [];
  u.seals = [];
  u.seal = null;
  u.shield = 0;
  u.awakened = false;
  s.koSeq += 1;
  u.koAt = s.koSeq;
  ctx.E.koLog.push(u.id);
  emit(ctx, { type: 'ko', unit: u.id, sq, by: killer ? killer.id : null });
  if (killer && killer.side !== u.side) {
    unitStats(ctx, killer).kos += 1;
    if (killer.alive) {
      changeEnergy(ctx, killer, ENERGY.ko, 'ko');
      fire(ctx, killer, 'kill', { source: killer.id, target: u.id });
    }
  }
  fireSide(ctx, u.side, 'allyKo', { target: u.id, source: killer ? killer.id : null }, u);
  fire(ctx, u, 'selfKo', { target: u.id, source: killer ? killer.id : null }, { allowDead: true });
  const rules = unitDef(u).rules;
  if (rules.eggRevive && !u.uses.egg && sq >= 0 && !pieceAt(s, sq)) {
    u.uses.egg = 1;
    const p = rules.eggRevive;
    const w = spawnWard(ctx, u, sq, { kind: 'phoenix-egg', hp: Math.max(1, Math.floor(p.eggHpPct * u.maxHp)), turns: null, jumpable: true, special: 'egg', data: { hatchIn: p.hatchAfterTurns, hatchHpPct: p.hatchHpPct, hatchEnergy: p.hatchEnergy, blast: p.hatchBlastMult || 0 } });
    u.egg = w.id;
  } else if (rules.candleOnKo && !u.uses.candle && sq >= 0 && !pieceAt(s, sq)) {
    u.uses.candle = 1;
    const p = rules.candleOnKo;
    spawnWard(ctx, u, sq, { kind: 'candle', hp: 1, turns: p.turns, jumpable: true, special: 'candle', data: { healPctMaxHp: p.healPctMaxHp } });
  }
  ctx.E.checkVictory = true;
}

// -------------------------------------------------------------------------------------- awakening

export function awakenUnit(ctx, u, o = {}) {
  if (!u || !u.alive) return false;
  const full = o.full !== false && !u.awakenBonusUsed;
  if (u.awakened && !full) return false;
  const was = u.awakened;
  u.awakened = true;
  const newCrown = !hasStatus(u, 'crown');
  if (newCrown) u.statuses.push({ id: 'crown', turns: null, stacks: 1, source: u.id, seq: seqOf(ctx) });
  emit(ctx, { type: 'awaken', unit: u.id, sq: u.sq, full });
  if (newCrown) emit(ctx, { type: 'status', target: u.id, status: 'crown', turns: null, stacks: 1, on: true, source: u.id });
  if (!was) {
    unitStats(ctx, u).awakenings += 1;
    const ss = sideStats(ctx, u.side);
    if (!ss.awakened.includes(u.id)) ss.awakened.push(u.id);
  }
  if (full) {
    u.awakenBonusUsed = true;
    healUnit(ctx, u, u, AWAKEN.healPctMaxHp * u.maxHp, { noBond: true, noTrigger: true, reason: 'awaken' });
    changeEnergy(ctx, u, AWAKEN.energy, 'awaken', false);
  }
  fire(ctx, u, 'awaken', { source: u.id, target: u.id });
  ctx.E.checkVictory = true;
  return true;
}

export function loseCrown(ctx, u) {
  if (!u.awakened) return;
  u.awakened = false;
  const st = hasStatus(u, 'crown');
  if (st) u.statuses.splice(u.statuses.indexOf(st), 1);
  emit(ctx, { type: 'crownLost', unit: u.id });
  emit(ctx, { type: 'status', target: u.id, status: 'crown', turns: 0, stacks: 0, on: false, reason: 'lost' });
}

/** The unit stands on its enemy's back row (current awakening row). */
export function onAwakenRow(s, u) {
  return u.alive && u.sq >= 0 && rowOf(u.sq) === s.awakenRows[u.side];
}

// ----------------------------------------------------------------------------------- displacement

/**
 * After a piece lands on a square: zone onEnter (once per activation per zone), and for voluntary
 * movement the star gate (chapter 3) and awakening.
 */
export function landed(ctx, u, o = {}) {
  if (!u.alive || u.sq < 0) return;
  zonesOnEnter(ctx, u);
  if (o.voluntary) {
    if (o.endOfMove) {
      const to = stageGateFor(ctx, u);
      if (to >= 0) {
        const from = u.sq;
        u.sq = to;
        emit(ctx, { type: 'displace', unit: u.id, from, to, kind: 'gate' });
        zonesOnEnter(ctx, u);
      }
    }
    if (onAwakenRow(ctx.s, u)) awakenUnit(ctx, u, { full: true });
  }
}

function zonesOnEnter(ctx, u) {
  const s = ctx.s;
  for (const z of s.zones.slice()) {
    if (!z.onEnter || !z.onEnter.length || !z.sqs.includes(u.sq)) continue;
    if (!zoneAffects(s, z, u)) continue;
    const key = `${u.id}:${z.id}`;
    if (s.act) {
      s.act.entered = s.act.entered || {};
      if (s.act.entered[key]) continue;
      s.act.entered[key] = 1;
    }
    runZoneEffects(ctx, z, u, z.onEnter, 'enter');
  }
}

export function zoneAffects(s, z, u) {
  if (z.affects === 'any' || z.side === 0) return true;
  if (z.affects === 'enemy') return u.side !== z.side;
  if (z.affects === 'ally') return u.side === z.side;
  return true;
}

export function runZoneEffects(ctx, z, u, effects, when) {
  const s = ctx.s;
  const owner = z.owner ? unitById(s, z.owner) : null;
  emit(ctx, { type: 'zoneTrigger', id: z.id, kind: z.kind, unit: u.id, when });
  if (owner) {
    const sub = subCtx(ctx.E, { caster: owner, kind: 'zone', pick: { recv: [u], covered: [u.sq], center: u.id, centerSq: u.sq, first: u }, srcKind: 'zone', viaWard: true, abilityId: z.kind });
    runEffects(sub, effects);
  } else {
    // environment zones (chapter gimmicks): seals, true damage (% max HP)
    for (const eff of effects) {
      if (eff.op === 'seal') addSeal(ctx, u, eff.element);
      else if (eff.op === 'trueDamagePct') dealDamage(ctx, null, u, { kind: 'true', flat: Math.max(1, Math.floor(eff.pct * u.maxHp)), label: eff.label || z.kind, element: eff.element || 'none' });
      else if (eff.op === 'status') addStatus(ctx, null, u, eff.id, { turns: eff.turns });
    }
    flushKos(ctx);
  }
}

/** Collision: 30 % source ATK true damage to the moved unit, half to a blocking piece. */
function collide(ctx, src, u, blocker, at) {
  const amount = Math.max(1, Math.floor(BATTLE.collision.mult * (src ? atkEff(ctx.s, src) : 0)));
  emit(ctx, { type: 'collision', unit: u.id, sq: u.sq, at, blocker: blocker ? blocker.id : null });
  dealDamage(ctx, src, u, { kind: 'true', flat: amount, label: 'collision' });
  if (blocker) dealDamage(ctx, src, blocker, { kind: 'true', flat: Math.max(1, Math.floor(amount * BATTLE.collision.blockerShare)), label: 'collision' });
}

function lexLess(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

function pushDir(u, fromSq) {
  const d = dirBetween(fromSq, u.sq);
  if (d >= 0) return d;
  // not on a diagonal: toward the receiver's own back row, on the diagonal farther from the source
  const dr = u.side === 1 ? 1 : -1;
  const cands = [0, 1, 2, 3].filter((k) => (k < 2 ? -1 : 1) === dr);
  let best = cands[0];
  let bestKey = null;
  for (const k of cands) {
    const t = stepSq(u.sq, k);
    const far = t < 0 ? -1 : dist(t, fromSq);
    const eu = t < 0 ? -1 : (rowOf(t) - rowOf(fromSq)) ** 2 + (colOf(t) - colOf(fromSq)) ** 2;
    const col = t < 0 ? 99 : colOf(t);
    const key = [-far, -eu, col];
    if (!bestKey || lexLess(key, bestKey)) {
      best = k;
      bestKey = key;
    }
  }
  return best;
}

export function pushUnit(ctx, src, u, n, fromSq) {
  if (!u || u.isWard || !u.alive || u.sq < 0 || fromSq == null || fromSq < 0) return;
  const s = ctx.s;
  if (displaceImmune(u)) {
    if (u.boss) addStagger(ctx, u, src);
    collide(ctx, src, u, null, u.sq);
    return;
  }
  const d = pushDir(u, fromSq);
  const from = u.sq;
  for (let k = 0; k < (n || 1); k++) {
    const next = stepSq(u.sq, d);
    const blocker = next >= 0 && playable(s, next) ? pieceAt(s, next) : null;
    if (next < 0 || !playable(s, next) || blocker) {
      if (u.sq !== from) emit(ctx, { type: 'displace', unit: u.id, from, to: u.sq, kind: 'push' });
      collide(ctx, src, u, blocker, next);
      if (u.alive && u.sq !== from) landed(ctx, u, { voluntary: false });
      return;
    }
    u.sq = next;
  }
  emit(ctx, { type: 'displace', unit: u.id, from, to: u.sq, kind: 'push' });
  landed(ctx, u, { voluntary: false });
}

export function pullUnit(ctx, src, u, n, towardSq) {
  if (!u || u.isWard || !u.alive || u.sq < 0 || towardSq == null || towardSq < 0) return;
  const s = ctx.s;
  if (displaceImmune(u)) {
    if (u.boss) addStagger(ctx, u, src);
    collide(ctx, src, u, null, u.sq);
    return;
  }
  const from = u.sq;
  for (let k = 0; k < (n || 1); k++) {
    if (dist(u.sq, towardSq) <= 1) break;
    let d = dirBetween(u.sq, towardSq);
    if (d < 0) {
      let best = -1;
      let bestKey = null;
      for (let k2 = 0; k2 < 4; k2++) {
        const t = stepSq(u.sq, k2);
        if (t < 0) continue;
        const key = [dist(t, towardSq), (rowOf(t) - rowOf(towardSq)) ** 2 + (colOf(t) - colOf(towardSq)) ** 2, colOf(t)];
        if (!bestKey || lexLess(key, bestKey)) {
          best = k2;
          bestKey = key;
        }
      }
      d = best;
    }
    const next = d >= 0 ? stepSq(u.sq, d) : -1;
    const blocker = next >= 0 && playable(s, next) ? pieceAt(s, next) : null;
    if (next < 0 || !playable(s, next) || blocker) {
      if (u.sq !== from) emit(ctx, { type: 'displace', unit: u.id, from, to: u.sq, kind: 'pull' });
      collide(ctx, src, u, blocker, next);
      if (u.alive && u.sq !== from) landed(ctx, u, { voluntary: false });
      return;
    }
    u.sq = next;
  }
  if (u.sq !== from) {
    emit(ctx, { type: 'displace', unit: u.id, from, to: u.sq, kind: 'pull' });
    landed(ctx, u, { voluntary: false });
  }
}

/** Swap two units' squares (Mara's Trip, swapMove). */
export function swapUnits(ctx, a, b, kind = 'swap', voluntaryB = false) {
  if (!a.alive || !b.alive || b.isWard) return false;
  if (displaceImmune(b) && a.side !== b.side) {
    if (b.boss) addStagger(ctx, b, a);
    return false;
  }
  if (displaceImmune(b)) return false;
  const sa = a.sq;
  const sb = b.sq;
  a.sq = sb;
  b.sq = sa;
  emit(ctx, { type: 'displace', unit: a.id, from: sa, to: sb, kind });
  emit(ctx, { type: 'displace', unit: b.id, from: sb, to: sa, kind });
  landed(ctx, a, { voluntary: true });
  landed(ctx, b, { voluntary: voluntaryB });
  return true;
}

/** Move a unit by an ability (moveSelf / toss / teleport): no provocation. */
export function relocate(ctx, u, to, kind, o = {}) {
  if (!u.alive || to < 0 || to === u.sq) return;
  const from = u.sq;
  u.sq = to;
  emit(ctx, { type: 'displace', unit: u.id, from, to, kind });
  landed(ctx, u, { voluntary: o.voluntary !== false, endOfMove: o.endOfMove !== false });
}

// ------------------------------------------------------------------------------------ wards, zones

export function spawnWard(ctx, owner, sq, spec) {
  const s = ctx.s;
  const id = nextId(s, 'w');
  const ownerSide = spec.side != null ? spec.side : owner ? owner.side : 0;
  const w = {
    id, isWard: true, kind: spec.kind, owner: owner ? owner.id : null, side: ownerSide, sq,
    hp: spec.hp, maxHp: spec.hp, turns: spec.turns == null ? null : spec.turns, fresh: s.side === ownerSide,
    blocks: spec.blocks !== false, jumpable: spec.jumpable !== false,
    behavior: spec.behavior || null, aura: spec.aura || null, special: spec.special || null,
    springboard: !!spec.springboard, data: spec.data || null,
  };
  s.wards.push(w);
  emit(ctx, { type: 'ward', id, kind: w.kind, sq, owner: w.owner, side: w.side, hp: w.hp, maxHp: w.maxHp, turns: w.turns, special: w.special, on: true });
  return w;
}

function removeWardSilently(ctx, w) {
  const i = ctx.s.wards.indexOf(w);
  if (i >= 0) ctx.s.wards.splice(i, 1);
}

export function destroyWard(ctx, w, reason, by) {
  const s = ctx.s;
  if (!s.wards.includes(w)) return;
  removeWardSilently(ctx, w);
  emit(ctx, { type: 'ward', id: w.id, kind: w.kind, sq: w.sq, owner: w.owner, side: w.side, hp: Math.max(0, w.hp), on: false, reason, by: by ? by.id : null });
  if (w.special === 'egg' && reason !== 'hatched') {
    const u = unitById(s, w.owner);
    if (u) {
      u.egg = null;
      u.final = true;
      emit(ctx, { type: 'ko', unit: u.id, sq: w.sq, by: by ? by.id : null, final: true });
      ctx.E.checkVictory = true;
    }
  }
  if (w.special === 'caravan' && reason !== 'expired') {
    ctx.E.caravanLost = w.side;
    ctx.E.checkVictory = true;
  }
}

export function spawnZone(ctx, owner, sqs, spec) {
  const s = ctx.s;
  const side = owner ? owner.side : spec.side != null ? spec.side : 0;
  const existing = spec.stack ? null : s.zones.find((z) => z.kind === spec.kind && z.owner === (owner ? owner.id : null));
  if (existing && owner) {
    existing.sqs = sqs.slice();
    existing.turns = spec.turns;
    existing.fresh = s.side === side;
    emit(ctx, { type: 'zone', id: existing.id, kind: existing.kind, sqs: existing.sqs, owner: existing.owner, side, turns: existing.turns, on: true });
    return existing;
  }
  const z = {
    id: nextId(s, 'z'), kind: spec.kind, owner: owner ? owner.id : null, side, affects: spec.affects || 'enemy',
    sqs: sqs.slice(), turns: spec.turns == null ? null : spec.turns, fresh: s.side === side,
    onTurnStart: spec.onTurnStart || null, onEnter: spec.onEnter || null, visual: spec.visual || undefined,
  };
  s.zones.push(z);
  emit(ctx, { type: 'zone', id: z.id, kind: z.kind, sqs: z.sqs, owner: z.owner, side, turns: z.turns, on: true });
  return z;
}

export function removeZone(ctx, z, reason = 'expired') {
  const i = ctx.s.zones.indexOf(z);
  if (i < 0) return;
  ctx.s.zones.splice(i, 1);
  emit(ctx, { type: 'zone', id: z.id, kind: z.kind, sqs: z.sqs, owner: z.owner, side: z.side, turns: 0, on: false, reason });
}

// ----------------------------------------------------------------------------------------- revive

/** KO'd allies of a side that can still be revived (each once per battle; not eggs or final KOs). */
export function revivable(s, side) {
  return s.units.filter((u) => !u.alive && u.side === side && !u.revived && !u.final && !u.egg && !u.boss).sort((a, b) => b.koAt - a.koAt);
}

export function reviveUnit(ctx, src, u, hpPct, sq, by = 'revive', energy = 0) {
  u.alive = true;
  u.sq = sq;
  u.hp = Math.max(1, Math.floor(hpPct * u.maxHp));
  u.statuses = [];
  u.seals = [];
  u.seal = null;
  u.shield = 0;
  u.energy = Math.max(0, Math.min(u.maxEnergy, energy));
  u.cd.skill = 0;
  if (by === 'revive') u.revived = true;
  u.egg = null;
  emit(ctx, { type: 'revive', unit: u.id, sq, hp: u.hp, energy: u.energy, by, source: src ? src.id : null });
  ctx.E.checkVictory = true;
}

/** Revive placement: empty square of the ally's own back two rows nearest to `near`. */
export function revivePlace(s, side, near) {
  return nearestEmpty(s, near, homeSquares(s, side, 2));
}

