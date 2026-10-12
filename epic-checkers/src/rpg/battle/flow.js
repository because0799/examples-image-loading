// Turn structure (GDD §3.2, effects.md §7): battle creation, activations, turn start / end, victory.

import { BATTLE, ENERGY, STATUSES } from '../data/rules.js';
import { unitDef } from './defs.js';
import { seedHash, nextRand } from './rng.js';
import { dist, neighbors, parseSq, rowOf } from './board.js';
import { STATE_VERSION, cloneState, makeUnit, unitById, wardById, pieceAt, hasStatus, isDisabled, autoDeploy, presetSquares, playable, homeSquares, nearestEmpty, totalHpShare, deploySquares } from './state.js';
import { atkEff, skillCooldownAdd, healPct } from './stats.js';
import { moveOptions, pendingOptions, retreatSquare } from './movement.js';
import { emit, changeEnergy, addStatus, removeStatus, removeSeal, healUnit, dealDamage, flushKos, landed, relocate, spawnWard, destroyWard, removeZone, zoneAffects, runZoneEffects, reviveUnit, unitStats, sideStats } from './combat.js';
import { subCtx, runEffects, execChain } from './effects.js';
import { fire, fireSide } from './triggers.js';
import { basicPicks, matchBasic, skillOptions, ultOptions, quirkOptions, jumpOptions, activatableUnits, tossLanding, safestSquare } from './actions.js';
import { resolveStage, bossFor, bossVariant, initialHoles, stageSetup, stageRoundStart, stageTurnStart, stageAfterMove, bossExtraDue } from './stage.js';
import { abilityDamages, matchPick } from './targeting.js';

const ACTION_KINDS = ['basic', 'skill', 'ult', 'quirk', 'jump'];

export class IllegalActionError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'IllegalActionError';
  }
}

function illegal(msg) {
  throw new IllegalActionError(`Illegal action: ${msg}`);
}

/** Engine context for one applyAction call. */
export function newEngine(s, opts = {}) {
  return {
    s, ev: [], opts, koQueue: [], koLog: [], inChain: 0, ultCaster: null, depth: 0, survive: null, redirect: null,
    checkVictory: false, caravanLost: null, result: s.result || null,
  };
}

function emptyStats() {
  const side = () => ({ reactions: {}, ults: 0, skills: 0, kos: 0, awakened: [], maxChain: 0, actions: 0 });
  return { units: {}, sides: { 1: side(), '-1': side() } };
}

// -------------------------------------------------------------------------------------- creation

function validateSquad(squad, side) {
  if (!Array.isArray(squad) || squad.length < 1 || squad.length > 6) throw new Error(`createBattle: side ${side} needs 1..6 heroes`);
}

/**
 * createBattle({ sides: { 1: Squad, [-1]: Squad }, mode, stage, seed, first = 1 | -1 | 'random', roundLimit? })
 * Squad = [{ heroId, level, constellation, sq? (number or 'c3'), boss?, miniBoss?, hpMult?, reflection? }].
 */
export function createBattle(opts = {}) {
  const { sides, mode = 'training', stage = null, seed = 1 } = opts;
  if (!sides) throw new Error('createBattle: sides required');
  const squads = { 1: sides[1] || sides['1'], '-1': sides[-1] || sides['-1'] };
  validateSquad(squads[1], 1);
  validateSquad(squads[-1], -1);
  const st = resolveStage(stage);
  const s = {
    v: STATE_VERSION,
    mode,
    stageId: st ? st.id : null,
    stage: st,
    seed,
    rng: seedHash(seed),
    first: 1,
    side: 1,
    round: 1,
    turn: 0,
    sideTurns: { 1: 0, '-1': 0 },
    roundLimit: opts.roundLimit || (st && st.roundLimit) || BATTLE.roundLimit,
    units: [],
    wards: [],
    zones: [],
    holes: initialHoles(st),
    reserved: st && st.rule && st.rule.id === 'escort' ? [parseSq(st.rule.square)] : [],
    awakenRows: { 1: 0, '-1': 7 },
    act: null,
    result: null,
    stats: emptyStats(),
    seq: 0,
    koSeq: 0,
    warn: { eruption: null, fireRain: null },
    tt: { side: 1, turn: 0, activated: [], hitEnergy: {}, dmgTaken: {}, trig: {}, retreated: {}, bossExtra: false },
    startEvents: [],
  };
  let first = opts.first === -1 || opts.first === '-1' ? -1 : 1;
  if (opts.first === 'random') first = nextRand(s) < 0.5 ? 1 : -1;
  if (st && st.rule && st.rule.id === 'enemyFirst') first = -1;
  s.first = first;
  s.side = first;
  s.tt.side = first;

  for (const side of [1, -1]) {
    const taken = {};
    const list = squads[side];
    const units = list.map((entry, i) => {
      const boss = side === -1 ? bossFor(st, entry, taken) : entry.boss ? bossFor(null, entry, taken) : null;
      const variant = bossVariant(st, entry.heroId, boss);
      const reflection = !!entry.reflection || (side === -1 && mode !== 'duel') || (mode === 'duel' && side === -1 && squads[1].some((e) => e.heroId === entry.heroId));
      return makeUnit(entry, side, i, { boss, hpMult: boss ? boss.hpMult : entry.hpMult, variant, reflection });
    });
    deploySide(s, units, list, side, mode, st);
    s.units.push(...units);
  }

  const E = newEngine(s);
  const ctx = subCtx(E, {});
  emit(ctx, {
    type: 'battleStart', seed, first, mode, stage: st ? st.id : null, roundLimit: s.roundLimit,
    units: s.units.map((u) => ({ id: u.id, heroId: u.heroId, side: u.side, sq: u.sq, level: u.level, constellation: u.constellation, boss: !!u.boss })),
  });
  stageSetup(ctx);
  for (const u of s.units) {
    const rules = unitDef(u).rules;
    if (rules.startCrowned) {
      u.awakened = true;
      u.statuses.push({ id: 'crown', turns: null, stacks: 1, source: u.id, seq: ++s.seq });
      emit(ctx, { type: 'awaken', unit: u.id, sq: u.sq, full: false, start: true });
      emit(ctx, { type: 'status', target: u.id, status: 'crown', turns: null, stacks: 1, on: true, source: u.id });
    }
    if (rules.decoyWard) {
      const p = rules.decoyWard;
      let sq = nearestEmpty(s, u.sq, homeSquares(s, u.side, 1));
      if (sq < 0) sq = nearestEmpty(s, u.sq, homeSquares(s, u.side, 2));
      if (sq < 0) sq = nearestEmpty(s, u.sq, homeSquares(s, u.side, 4));
      if (sq >= 0) spawnWard(ctx, u, sq, { kind: 'dusk-double', hp: Math.max(1, Math.floor(p.hpPct * u.maxHp)), turns: null, jumpable: true, special: 'decoy' });
    }
  }
  fireSide(ctx, 1, 'battleStart', {});
  fireSide(ctx, -1, 'battleStart', {});
  flushKos(ctx);
  beginTurn(ctx);
  if (!s.result && !activatableUnits(s).length) advance(ctx);
  s.startEvents = E.ev;
  return s;
}

function deploySide(s, units, list, side, mode, st) {
  const { front, back } = deploySquares(s, side);
  const legal = new Set([...front, ...back]);
  const taken = new Set();
  // explicit squares
  units.forEach((u, i) => {
    const q = list[i].sq != null ? parseSq(list[i].sq) : -1;
    if (q >= 0 && legal.has(q) && !taken.has(q)) {
      u.sq = q;
      taken.add(q);
    }
  });
  // preset formation (stage rule) for the enemy side
  if (side === -1 && st && st.rule && st.rule.id === 'presetFormation') {
    const preset = presetSquares(st.rule.formation, side) || [];
    let k = 0;
    for (const u of units) {
      if (u.sq >= 0) continue;
      while (k < preset.length && (taken.has(preset[k]) || !playable(s, preset[k]))) k++;
      if (k < preset.length) {
        u.sq = preset[k];
        taken.add(preset[k]);
        k++;
      }
    }
  }
  const rest = units.filter((u) => u.sq < 0);
  if (rest.length) {
    const style = side === -1 && mode !== 'duel' ? 'ai' : 'auto';
    const sqs = autoDeploy(s, rest, side, style, taken);
    rest.forEach((u, i) => {
      u.sq = sqs[i];
    });
  }
  for (const u of units) {
    if (u.sq >= 0) continue;
    // squads larger than the deployment rows: any empty square of the own half
    const half = side === 1 ? [4, 5, 6, 7] : [0, 1, 2, 3];
    const q = homeSquares(s, side, 4).find((x) => half.includes(rowOf(x)) && !taken.has(x));
    if (q === undefined) throw new Error('createBattle: no room to deploy');
    u.sq = q;
    taken.add(q);
  }
}

// ------------------------------------------------------------------------------------- applyAction

/**
 * Apply one step-level action and return { state, events }. The input state is never mutated.
 * opts: { expected: true } — crits use their expected value and the RNG is not consumed (AI / preview);
 *       { autoPending: true } — pending free-move choices are resolved automatically (safest square);
 *       { stopAtActivationEnd: true } — stop before the turn ends (AI simulation).
 */
export function applyAction(state, action, opts = {}) {
  if (!state || state.v !== STATE_VERSION) throw new Error('applyAction: invalid battle state');
  if (state.result) illegal('the battle is over');
  if (!action || typeof action.type !== 'string') illegal('missing action type');
  const s = cloneState(state);
  const E = newEngine(s, opts);
  const ctx = subCtx(E, {});
  doAction(ctx, action);
  return { state: s, events: E.ev };
}

/** Mutating variant used by the AI on its own clones. */
export function applyActionInPlace(s, action, opts = {}) {
  const E = newEngine(s, opts);
  const ctx = subCtx(E, {});
  doAction(ctx, action);
  return E.ev;
}

function doAction(ctx, a) {
  const s = ctx.s;
  if (a.type === 'resign') {
    const side = a.side === -1 || a.side === 1 ? a.side : s.side;
    setResult(ctx, -side, 'resign');
    return;
  }
  if (s.act && s.act.pending.length) {
    const u = unitById(s, s.act.unit);
    if (a.unit != null && a.unit !== u.id) illegal('another unit is resolving a free move');
    if (a.type === 'move') {
      resolvePending(ctx, u, a.to);
      finishActivation(ctx);
      return;
    }
    if (a.type === 'pass') {
      const pend = s.act.pending[0];
      if (!pend.optional && pendingOptions(s, u, pend).length) illegal('this relocation is mandatory');
      s.act.pending.shift();
      emit(ctx, { type: 'pendingSkip', unit: u.id, kind: pend.kind });
      finishActivation(ctx);
      return;
    }
    illegal('a pending relocation must be resolved first');
  }
  switch (a.type) {
    case 'pass':
    case 'wait': {
      if (!s.act) {
        if (a.unit == null) {
          if (activatableUnits(s).length) illegal('pass without a unit is only legal when no hero can act');
          emit(ctx, { type: 'turnSkipped', side: s.side, reason: 'pass' });
          advance(ctx);
          return;
        }
        const u = activatable(ctx, a.unit);
        startActivation(ctx, u, false);
        doWait(ctx, u);
        finishActivation(ctx);
        return;
      }
      const u = unitById(s, s.act.unit);
      if (a.unit != null && a.unit !== u.id) illegal('another unit is active');
      if (s.act.acted) illegal('the activation is already finished');
      if (s.act.moved) {
        s.act.kind = 'move';
        changeEnergy(ctx, u, BATTLE.moveOnlyEnergy, 'move');
        emit(ctx, { type: 'endActivation', unit: u.id, kind: 'move' });
      } else doWait(ctx, u);
      finishActivation(ctx);
      return;
    }
    case 'move': {
      const u = ensureActivation(ctx, a.unit);
      if (s.act.moved || s.act.acted) illegal('already moved');
      execMove(ctx, u, a.to);
      if (!u.alive || s.result) finishActivation(ctx);
      return;
    }
    case 'jump': {
      const u = ensureActivation(ctx, a.unit);
      if (s.act.moved || s.act.acted) illegal('a jump-strike replaces the move and the action');
      const key = (a.path || []).join('.');
      const chain = jumpOptions(s, u).find((c) => c.path.join('.') === key);
      if (!chain) illegal(`no such jump chain ${key}`);
      s.act.kind = 'jump';
      s.act.acted = true;
      const jctx = subCtx(ctx.E, { caster: u, kind: 'jump', srcKind: 'jump', originSq: u.sq, abilityId: 'jump' });
      consumeCharge(jctx, u, true);
      emit(ctx, { type: 'chainStart', unit: u.id, path: chain.path.slice(), element: u.element });
      const res = execChain(jctx, u, chain.hops, null);
      flushKos(ctx);
      if (u.alive && res.hops > 0) {
        let gain = ENERGY.action + ENERGY.extraHop * (res.hops - 1);
        if (u.role === 'blade' && res.hops >= 2) gain += 10;
        changeEnergy(ctx, u, gain, 'action');
      }
      countAction(ctx, u, 'jump');
      finishActivation(ctx);
      return;
    }
    case 'basic':
    case 'skill':
    case 'ult':
    case 'quirk': {
      const u = ensureActivation(ctx, a.unit);
      if (s.act.acted) illegal('already acted');
      if (a.to != null && a.to !== u.sq) {
        if (s.act.moved) illegal('already moved');
        execMove(ctx, u, a.to);
        if (!u.alive || s.result) {
          finishActivation(ctx);
          return;
        }
      }
      execAbility(ctx, u, a);
      finishActivation(ctx);
      return;
    }
    default:
      illegal(`unknown action type ${a.type}`);
  }
}

function activatable(ctx, id) {
  const s = ctx.s;
  const u = unitById(s, id);
  if (!u) illegal(`unknown unit ${id}`);
  if (!u.alive || u.sq < 0) illegal(`${id} is knocked out`);
  if (u.side !== s.side) illegal(`${id} is not on the side to act`);
  if (isDisabled(u)) illegal(`${id} cannot act (stunned / frozen / break)`);
  return u;
}

function ensureActivation(ctx, id) {
  const s = ctx.s;
  if (s.act) {
    if (id != null && s.act.unit !== id) illegal('another unit is active this turn');
    return unitById(s, s.act.unit);
  }
  const u = activatable(ctx, id);
  startActivation(ctx, u, false);
  return u;
}

function startActivation(ctx, u, extra) {
  const s = ctx.s;
  const queue = s.act ? s.act.extraQueue : [];
  s.act = { unit: u.id, startSq: u.sq, moved: false, movedDist: 0, acted: false, kind: null, pending: [], extraQueue: queue, extra: !!extra, entered: {}, gated: {}, afterDone: false, endDone: false };
  if (!s.tt.activated.includes(u.id)) s.tt.activated.push(u.id);
  emit(ctx, { type: 'activate', unit: u.id, extra: !!extra });
}

function doWait(ctx, u) {
  ctx.s.act.kind = 'wait';
  emit(ctx, { type: 'wait', unit: u.id });
  changeEnergy(ctx, u, BATTLE.wait.energy, 'wait');
  addStatus(ctx, u, u, BATTLE.wait.status.id, { turns: BATTLE.wait.status.turns });
}

function execMove(ctx, u, to) {
  const s = ctx.s;
  const mo = moveOptions(s, u);
  const m = mo.moves.find((x) => x.to === to);
  if (m) {
    const from = u.sq;
    u.sq = to;
    emit(ctx, { type: 'move', unit: u.id, from, to, path: m.path.slice(), kind: m.kind });
    const lf = unitDef(u).rules.leapfrog;
    if (lf) for (const id of m.leaps) changeEnergy(ctx, unitById(s, id), lf.energy, 'leapfrog', false);
    s.act.moved = true;
    s.act.movedDist += m.kind === 'blink' ? dist(from, to) : m.path.length - 1;
    stageAfterMove(ctx, u, m.path, m.kind);
    landed(ctx, u, { voluntary: true, endOfMove: true });
    flushKos(ctx);
    checkVictory(ctx);
    return;
  }
  const sw = mo.swaps.find((x) => x.to === to);
  if (!sw) illegal(`${u.id} cannot move to ${to}`);
  const ally = unitById(s, sw.ally);
  const from = u.sq;
  emit(ctx, { type: 'move', unit: u.id, from, to, path: [from, to], kind: 'swap', with: ally.id });
  u.sq = to;
  ally.sq = from;
  emit(ctx, { type: 'displace', unit: ally.id, from: to, to: from, kind: 'swap' });
  u.uses.swapMove = (u.uses.swapMove || 0) + 1;
  s.act.moved = true;
  s.act.movedDist += dist(from, to);
  landed(ctx, u, { voluntary: true, endOfMove: true });
  landed(ctx, ally, { voluntary: true, endOfMove: false });
  flushKos(ctx);
  checkVictory(ctx);
}

function consumeCharge(actx, u, damaging) {
  const ch = unitDef(u).rules.chargeStacks;
  if (!ch || !damaging) return;
  const st = hasStatus(u, 'charge');
  if (!st || !st.stacks) return;
  actx.actionBonus += st.stacks * ch.dmgPerStack;
  emit(actx, { type: 'rule', unit: u.id, rule: 'chargeStacks', stacks: st.stacks });
  removeStatus(actx, u, st, 'consumed');
}

function execAbility(ctx, u, a) {
  const s = ctx.s;
  const E = ctx.E;
  const def = unitDef(u);
  const kind = a.type;
  let ability = null;
  let pick = null;
  let qa = null;
  if (kind === 'basic') {
    const picks = basicPicks(s, u);
    pick = matchBasic(s, u, picks, a.target);
    if (!pick) illegal(`${u.id} has no basic attack on ${a.target}`);
  } else if (kind === 'skill' || kind === 'ult') {
    const opt = kind === 'skill' ? skillOptions(s, u) : ultOptions(s, u);
    if (!opt.ok) illegal(`${kind} unavailable (${opt.reason})`);
    ability = opt.ability;
    pick = matchPick(s, u, ability, a, opt.picks);
    if (!pick) illegal(`${kind} target not legal`);
  } else {
    const q = quirkOptions(s, u).find((x) => x.id === a.quirk);
    if (!q) illegal(`${u.id} has no quirk action ${a.quirk}`);
    if (!q.ok) illegal(`quirk unavailable (${q.reason})`);
    qa = q.ability;
    ability = qa;
    pick = matchPick(s, u, ability, a, q.picks);
    if (!pick) illegal('quirk target not legal');
  }
  s.act.kind = kind;
  s.act.acted = true;
  const abilityId = kind === 'basic' ? 'basic' : ability.id;
  const actx = subCtx(E, { caster: u, kind, ability, abilityId, pick, srcKind: kind, originSq: u.sq });
  const damaging = kind === 'basic' ? !pick.heal : abilityDamages(ability);
  consumeCharge(actx, u, damaging);
  emit(ctx, {
    type: 'cast', unit: u.id, kind, abilityId, element: u.element, target: pick.target != null ? pick.target : null,
    targets: pick.targets ? pick.targets.slice() : undefined, path: pick.path ? pick.path.slice() : undefined,
    area: pick.covered ? pick.covered.slice() : [], vfx: ability && ability.vfx ? ability.vfx : undefined, heal: pick.heal || undefined,
    quirk: qa ? qa.id : undefined,
  });
  if (kind === 'skill') {
    const cd = Math.max(0, Math.round(ability.cooldown + skillCooldownAdd(s, u)));
    u.cd.skill = cd;
    emit(ctx, { type: 'cooldown', unit: u.id, value: cd, which: 'skill' });
  } else if (kind === 'ult') {
    E.ultCaster = u.id;
    const spent = u.energy;
    u.energy = ENERGY.ultResetsTo;
    emit(ctx, { type: 'energy', unit: u.id, value: u.energy, max: u.maxEnergy, delta: -spent, reason: 'ult' });
  } else if (kind === 'quirk') {
    u.uses[`q:${qa.id}`] = (u.uses[`q:${qa.id}`] || 0) + 1;
    if (qa.cooldown) {
      u.cd.quirk[qa.id] = qa.cooldown;
      emit(ctx, { type: 'cooldown', unit: u.id, value: qa.cooldown, which: qa.id });
    }
  }
  if (kind === 'basic') execBasic(actx, u, pick);
  else if (qa && qa.rule === 'tossAlly') execToss(actx, u, pick, qa.params);
  else runEffects(actx, ability.effects);
  flushKos(ctx);
  if (kind === 'ult') {
    E.ultCaster = null;
    fireSide(ctx, u.side, 'allyUlt', { source: u.id, kind: 'ult' }, u);
    fireSide(ctx, -u.side, 'enemyUlt', { source: u.id, kind: 'ult' });
    flushKos(ctx);
  } else if (u.alive) changeEnergy(ctx, u, ENERGY.action, 'action');
  if (kind === 'skill' || kind === 'ult') {
    const chainHops = actx.chainHops || 0;
    if (chainHops > 1 && u.alive) changeEnergy(ctx, u, ENERGY.extraHop * (chainHops - 1), 'hops');
  }
  countAction(ctx, u, kind);
}

function countAction(ctx, u, kind) {
  const st = unitStats(ctx, u);
  st.actions += 1;
  if (kind === 'ult') st.ults += 1;
  if (kind === 'skill') st.skills += 1;
  if (kind === 'basic') st.basics += 1;
  const ss = sideStats(ctx, u.side);
  ss.actions += 1;
  if (kind === 'ult') ss.ults += 1;
  if (kind === 'skill') ss.skills += 1;
}

function execBasic(ctx, u, pick) {
  const s = ctx.s;
  const b = unitDef(u).basic;
  if (pick.heal) {
    const a = pick.recv[0];
    const amount = atkEff(s, u, { self: u, target: a }) * b.allyHeal.mult * (1 + healPct(s, u, { self: u, target: a }));
    healUnit(ctx, u, a, amount);
    return;
  }
  for (const p of pick.recv) {
    const mult = pick.pointBlank && b.pointBlankMult != null ? b.pointBlankMult : b.mult;
    dealDamage(ctx, u, p, { mult, kind: 'hit', source: 'basic', melee: p.sq >= 0 && dist(u.sq, p.sq) === 1, label: 'basic' });
  }
}

function execToss(ctx, z, pick, params) {
  const s = ctx.s;
  const ally = pick.recv[0];
  const to = tossLanding(s, z, ally, params.range);
  if (to < 0) return;
  relocate(ctx, ally, to, 'toss', { voluntary: true, endOfMove: true });
  changeEnergy(ctx, ally, params.energy || 0, 'toss', false);
}

// ------------------------------------------------------------------------------ pending / finish

function resolvePending(ctx, u, to) {
  const s = ctx.s;
  const pend = s.act.pending[0];
  const opts = pendingOptions(s, u, pend);
  const m = opts.find((x) => x.to === to);
  if (!m) illegal(`${u.id} cannot relocate to ${to}`);
  s.act.pending.shift();
  const from = u.sq;
  u.sq = to;
  const kind = pend.kind === 'relocate' ? 'teleport' : pend.kind === 'blink' ? 'blink' : m.kind;
  emit(ctx, { type: 'move', unit: u.id, from, to, path: m.path.slice(), kind, free: true, reason: pend.kind });
  stageAfterMove(ctx, u, m.path, m.kind);
  landed(ctx, u, { voluntary: true, endOfMove: true });
  flushKos(ctx);
  checkVictory(ctx);
}

function prunePending(ctx, u) {
  const act = ctx.s.act;
  while (act.pending.length && (!u.alive || !pendingOptions(ctx.s, u, act.pending[0]).length)) act.pending.shift();
}

function autoResolvePending(ctx, u) {
  const s = ctx.s;
  let guard = 0;
  while (s.act.pending.length && guard++ < 8) {
    prunePending(ctx, u);
    if (!s.act.pending.length) break;
    const pend = s.act.pending[0];
    const opts = pendingOptions(s, u, pend).map((m) => m.to);
    const pickSq = safestSquare(s, u, opts, !!pend.optional);
    if (pickSq === u.sq || pickSq < 0) s.act.pending.shift();
    else resolvePending(ctx, u, pickSq);
    if (s.result) return;
  }
}

function finishActivation(ctx) {
  const s = ctx.s;
  const E = ctx.E;
  flushKos(ctx);
  checkVictory(ctx);
  if (s.result) return;
  const act = s.act;
  const u = unitById(s, act.unit);
  if (act.pending.length) {
    prunePending(ctx, u);
    if (act.pending.length) {
      if (E.opts.autoPending) autoResolvePending(ctx, u);
      else {
        announcePending(ctx, u);
        return;
      }
      if (s.result) return;
    }
  }
  if (!act.afterDone) {
    act.afterDone = true;
    // afterAction fires only when the activation included an action (basic / skill / ult / quirk /
    // jump) — a Wait or a move-only activation has no action to follow.
    if (u.alive && ACTION_KINDS.includes(act.kind)) {
      fire(ctx, u, 'afterAction', { source: u.id, kind: act.kind });
      const bl = unitDef(u).rules.blinkAfterAction;
      if (bl && u.alive) act.pending.push({ kind: 'blink', range: bl.range, optional: false });
    }
    flushKos(ctx);
    checkVictory(ctx);
    if (s.result) return;
    if (act.pending.length) {
      prunePending(ctx, u);
      if (act.pending.length) {
        if (E.opts.autoPending) autoResolvePending(ctx, u);
        else {
          announcePending(ctx, u);
          return;
        }
        if (s.result) return;
      }
    }
  }
  if (!act.endDone) {
    act.endDone = true;
    enemyEndsAdjacent(ctx, u);
    flushKos(ctx);
    checkVictory(ctx);
    if (s.result) return;
  }
  emit(ctx, { type: 'activationEnd', unit: u.id, kind: act.kind || 'wait' });
  while (act.extraQueue.length) {
    const x = unitById(s, act.extraQueue.shift());
    if (x && x.alive && x.sq >= 0 && x.side === s.side && !isDisabled(x)) {
      startActivation(ctx, x, true);
      return;
    }
  }
  if (!s.tt.bossExtra) {
    const b = s.units.find((x) => x.alive && x.sq >= 0 && x.side === s.side && x.boss && bossExtraDue(s, x) && !isDisabled(x));
    if (b) {
      s.tt.bossExtra = true;
      emit(ctx, { type: 'extraActivation', unit: b.id, boss: true });
      startActivation(ctx, b, true);
      return;
    }
  }
  if (E.opts.stopAtActivationEnd) {
    act.done = true;
    return;
  }
  advance(ctx);
}

function announcePending(ctx, u) {
  const pend = ctx.s.act.pending[0];
  emit(ctx, { type: 'pending', unit: u.id, kind: pend.kind, optional: !!pend.optional, squares: pendingOptions(ctx.s, u, pend).map((m) => m.to) });
}

function enemyEndsAdjacent(ctx, actor) {
  const s = ctx.s;
  if (!actor || !actor.alive || actor.sq < 0) return;
  for (const n of neighbors(actor.sq)) {
    const p = pieceAt(s, n);
    if (!p || p.isWard || p.side === actor.side || !p.alive) continue;
    fire(ctx, p, 'enemyEndsAdjacent', { source: actor.id, target: p.id });
    flushKos(ctx);
    const rule = unitDef(p).rules.retreatOnAdjacent;
    if (!rule || !p.alive || s.tt.retreated[p.id]) continue;
    if (hasStatus(p, 'root') || hasStatus(p, 'stun') || hasStatus(p, 'frozen')) continue;
    if (!actor.alive || actor.sq < 0) continue;
    const to = retreatSquare(s, p, actor.sq);
    if (to < 0) continue;
    s.tt.retreated[p.id] = 1;
    emit(ctx, { type: 'rule', unit: p.id, rule: 'retreatOnAdjacent' });
    relocate(ctx, p, to, 'retreat', { voluntary: false });
  }
}

// ------------------------------------------------------------------------------------- turn flow

/** End the current turn and start the next one (skipping sides that cannot act). */
function advance(ctx) {
  const s = ctx.s;
  for (let guard = 0; guard < 400; guard++) {
    endTurn(ctx);
    if (s.result) return;
    beginTurn(ctx);
    if (s.result) return;
    if (activatableUnits(s).length) return;
    emit(ctx, { type: 'turnSkipped', side: s.side, reason: 'no-activatable' });
  }
  setResult(ctx, 0, 'stalemate');
}

/**
 * Tick durations of statuses / seals / wards / zones at the end of their side's turn. Entries gained
 * during that same turn ("fresh") skip this tick. Returns the entries that expire.
 */
function tickList(list) {
  const out = [];
  for (const x of list) {
    if (x.turns == null) continue;
    if (x.fresh) {
      x.fresh = false;
      continue;
    }
    x.turns -= 1;
    if (x.turns <= 0) out.push(x);
  }
  return out;
}

function endTurn(ctx) {
  const s = ctx.s;
  const side = s.side;
  s.act = null;
  for (const u of s.units) {
    if (!u.alive || u.side !== side) continue;
    for (const st of tickList(u.statuses)) removeStatus(ctx, u, st, 'expired');
    for (const se of tickList(u.seals)) removeSeal(ctx, u, se.slot, 'expired');
  }
  for (const w of tickList(s.wards.filter((x) => x.side === side))) destroyWard(ctx, w, 'expired');
  for (const z of tickList(s.zones.filter((x) => x.side === side && x.owner))) removeZone(ctx, z, 'expired');
  for (const u of s.units.filter((x) => x.alive && x.side === side)) {
    fire(ctx, u, 'turnEnd', { source: u.id });
    if (!s.tt.activated.includes(u.id)) {
      fire(ctx, u, 'turnEndNotActivated', { source: u.id });
      const ch = unitDef(u).rules.chargeStacks;
      if (ch && u.alive) addStatus(ctx, u, u, 'charge', { stacks: 1, max: ch.max });
    }
  }
  flushKos(ctx);
  emit(ctx, { type: 'turnEnd', side });
  checkVictory(ctx);
  if (s.result) return;
  s.side = -side;
  if (s.side === s.first) {
    emit(ctx, { type: 'roundEnd', round: s.round });
    roundEndChecks(ctx);
    if (s.result) return;
    s.round += 1;
  }
}

function roundEndChecks(ctx) {
  const s = ctx.s;
  const rule = s.stage && s.stage.rule;
  if (rule && rule.id === 'escort' && s.round >= rule.surviveRounds) {
    const car = s.wards.find((w) => w.special === 'caravan');
    if (car) {
      setResult(ctx, car.side, 'escort');
      return;
    }
  }
  if (s.round >= s.roundLimit) {
    const a = totalHpShare(s, 1);
    const b = totalHpShare(s, -1);
    if (Math.abs(a - b) <= BATTLE.tieEpsilon) setResult(ctx, 0, 'round-limit');
    else setResult(ctx, a > b ? 1 : -1, 'round-limit');
  }
}

function beginTurn(ctx) {
  const s = ctx.s;
  const side = s.side;
  s.turn += 1;
  s.sideTurns[side] += 1;
  s.tt = { side, turn: s.turn, activated: [], hitEnergy: {}, dmgTaken: {}, trig: {}, retreated: {}, bossExtra: false };
  s.act = null;
  if (side === s.first) {
    stageRoundStart(ctx);
    checkVictory(ctx);
    if (s.result) return;
  }
  emit(ctx, { type: 'turnStart', side, round: s.round, turn: s.turn });
  const mine = () => s.units.filter((u) => u.alive && u.side === side);
  for (const u of mine()) {
    if (hasStatus(u, 'stun') || hasStatus(u, 'frozen')) continue;
    if (u.cd.skill > 0) {
      u.cd.skill -= 1;
      emit(ctx, { type: 'cooldown', unit: u.id, value: u.cd.skill, which: 'skill' });
    }
    for (const k of Object.keys(u.cd.quirk)) {
      if (u.cd.quirk[k] > 0) {
        u.cd.quirk[k] -= 1;
        emit(ctx, { type: 'cooldown', unit: u.id, value: u.cd.quirk[k], which: k });
      }
    }
  }
  // eggs hatch
  for (const w of s.wards.filter((x) => x.special === 'egg' && x.side === side)) {
    w.data.hatchIn -= 1;
    if (w.data.hatchIn > 0) continue;
    const u = unitById(s, w.owner);
    destroyWard(ctx, w, 'hatched');
    if (!u) continue;
    reviveUnit(ctx, u, u, w.data.hatchHpPct, w.sq, 'hatch', w.data.hatchEnergy === 'full' ? u.maxEnergy : 0);
    if (w.data.blast > 0) {
      for (const n of neighbors(w.sq)) {
        const p = pieceAt(s, n);
        if (p && p.side !== u.side) dealDamage(ctx, u, p, { mult: w.data.blast, kind: 'hit', source: 'hatch', label: 'hatch' });
      }
    }
    flushKos(ctx);
  }
  // burn / regen ticks
  for (const u of mine()) {
    const burn = hasStatus(u, 'burn');
    if (burn) {
      const src = burn.source ? unitById(s, burn.source) : null;
      const base = src ? (src.alive ? atkEff(s, src, {}) : src.atk) : u.atk;
      dealDamage(ctx, src, u, { kind: 'true', flat: Math.max(1, Math.floor(STATUSES.burn.tick.mult * base)), label: 'burn', element: 'flame' });
    }
    const regen = hasStatus(u, 'regen');
    if (regen && u.alive && u.hp > 0) healUnit(ctx, null, u, (regen.value != null ? regen.value : STATUSES.regen.value) * u.maxHp, { reason: 'regen', noBond: true });
  }
  flushKos(ctx);
  // zones: onTurnStart for this side's units standing on them
  for (const z of s.zones.slice()) {
    if (!z.onTurnStart || !z.onTurnStart.length || !s.zones.includes(z)) continue;
    for (const u of mine()) {
      if (u.sq < 0 || !z.sqs.includes(u.sq) || !zoneAffects(s, z, u)) continue;
      runZoneEffects(ctx, z, u, z.onTurnStart, 'start');
    }
  }
  flushKos(ctx);
  checkVictory(ctx);
  if (s.result) return;
  fireSide(ctx, side, 'turnStart', { side });
  flushKos(ctx);
  // ward behaviours of this side
  for (const w of s.wards.slice()) {
    if (w.side !== side || !s.wards.includes(w)) continue;
    const owner = w.owner ? unitById(s, w.owner) : null;
    if (w.special === 'candle' && owner) {
      for (const n of neighbors(w.sq)) {
        const p = pieceAt(s, n);
        if (p && !p.isWard && p.side === side) healUnit(ctx, owner, p, w.data.healPctMaxHp * p.maxHp, { noBond: true, noTrigger: true, reason: 'candle' });
      }
    }
    if (w.behavior && owner) {
      for (const b of w.behavior) {
        if (b.on !== 'turnStart') continue;
        emit(ctx, { type: 'wardAct', id: w.id, kind: w.kind });
        const wctx = subCtx(ctx.E, { caster: owner, kind: 'ward', origin: w.sq, viaWard: true, srcKind: 'ward', abilityId: w.kind });
        runEffects(wctx, b.effects);
      }
    }
    flushKos(ctx);
  }
  stageTurnStart(ctx, side);
  for (const u of mine()) u.fullTurns = u.energy >= u.maxEnergy ? u.fullTurns + 1 : 0;
  flushKos(ctx);
  checkVictory(ctx);
}

// ---------------------------------------------------------------------------------------- victory

function sideAlive(s, side) {
  return s.units.some((u) => u.side === side && (u.alive || (u.egg && wardById(s, u.egg))));
}

export function checkVictory(ctx) {
  const s = ctx.s;
  if (s.result) return;
  const E = ctx.E;
  if (E.caravanLost != null) {
    setResult(ctx, -E.caravanLost, 'caravan-lost');
    return;
  }
  const a = sideAlive(s, 1);
  const b = sideAlive(s, -1);
  if (!a && !b) setResult(ctx, 0, 'mutual-ko');
  else if (!b) setResult(ctx, 1, 'annihilation');
  else if (!a) setResult(ctx, -1, 'annihilation');
  else {
    const rule = s.stage && s.stage.rule;
    if (rule && rule.id === 'altWinAwaken' && s.stats.sides[1].awakened.length >= rule.count) setResult(ctx, 1, 'awakenings');
  }
}

export function setResult(ctx, winner, reason) {
  const s = ctx.s;
  if (s.result) return;
  s.result = {
    winner,
    reason,
    round: s.round,
    turn: s.turn,
    hpShare: { 1: totalHpShare(s, 1), '-1': totalHpShare(s, -1) },
  };
  s.act = null;
  ctx.E.result = s.result;
  ctx.E.koQueue.length = 0;
  emit(ctx, { type: 'victory', winner, reason, round: s.round });
}

