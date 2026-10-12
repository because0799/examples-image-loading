// «Валькирии доски» — battle engine public API (docs/RPG-ARCHITECTURE.md, GDD §3–§10, effects.md).
//
// Pure and deterministic: every random draw (crits, eruption rows, fire-rain circles, coin toss) comes
// from a mulberry32 generator stored in the state (`state.rng`), so a battle replays identically from
// its seed and from any serialized state. Works in Node, the browser and a Web Worker.
//
// ─── Turn structure ───────────────────────────────────────────────────────────────────────────────
// A round = a turn of `state.first` + a turn of the other side. In its turn a side activates exactly ONE
// hero (GDD §3.2). Actions are step-level so the UI can show each step:
//   1. { type: 'move', unit, to }          move (role move / flight / swapMove); the activation stays open
//   2. { type: 'basic', unit, target }      act — or skill / ult / quirk (see below); ends the activation
//      { type: 'pass', unit }              after a move: end without acting (+10 energy, "move only")
//   — or —
//      { type: 'jump', unit, path }        a whole jump-strike chain (replaces move AND action)
//      { type: 'pass', unit }              at activation start: Wait (+10 energy, Brace)
// Composite form: any act may carry `to` (move first, then act) — e.g. the AI's { type:'skill', unit,
// to: 27, target: 36 } is a full activation in one call.
// Act targets: basic { target: sq }; skill / ult { target: sq } for single / line (any square of the
// ray) / cross / radius-around-square / row (any square of the row) shapes, { targets: [sq...] } for
// `lines` and `square` shapes, { path: [sq...] } for the `jump` shape; self-centred shapes need no target.
// Quirk actions (Zlata's toss, Torvald's Handyman): { type: 'quirk', unit, quirk: quirkId, target }.
// After an action some heroes get a PENDING relocation (Tsubame's Tailwind, Mara's Nimble Fingers,
// Iskra's Back Zap, Volta's mandatory blink, Tsubame's ult reappearance): legalActions then returns
// { type: 'move', unit, to } for the allowed squares and, when optional, { type: 'pass', unit }.
// An extra activation (Tsubame's Updraft, boss extra moves) keeps the same side to act with
// `state.act.unit` fixed to that hero. `{ type: 'resign', side }` ends the battle.
// When no hero of the side to act can be activated the engine skips the turn by itself.
//
// ─── State (plain JSON) ───────────────────────────────────────────────────────────────────────────
// { v, mode, stageId, stage, seed, rng, first, side, round, turn, sideTurns, roundLimit,
//   units: [Unit], wards: [Ward], zones: [Zone], holes: [sq], awakenRows: { 1: row, '-1': row },
//   act: null | { unit, moved, movedDist, acted, kind, pending: [...], extra }, result, stats, startEvents }
// Unit: { id ('a0'..'a5' side 1, 'b0'..'b5' side −1), heroId, side, sq (-1 when KO'd), hp, maxHp,
//   atk, def, crit, aff (base stats incl. level and constellation — see unitStats() for effective values),
//   energy, maxEnergy, cd: { skill, quirk: {id: n} }, statuses: [{ id, turns, stacks, value, source }],
//   seal (natural seal element, else celestial, else null), seals: [{ element, slot, turns }], shield,
//   awakened, alive, level, constellation, role, element, rarity, boss: null | {...}, reflection, revived }
// Ward: { id ('w<n>'), isWard: true, kind, owner, side, sq, hp, maxHp, turns, jumpable, special }
// Zone: { id ('z<n>'), kind, owner, side, affects, sqs, turns }
// Events: see ./events.md.

import { cloneState, deepClone, STATE_VERSION, unitById, totalHpShare } from './state.js';
import { createBattle as create, applyAction as apply, applyActionInPlace, IllegalActionError } from './flow.js';
import { legalActions as legal, unitActions as unitActs, activatableUnits, safestSquare } from './actions.js';
import { unitStats as effStats } from './stats.js';
import { heroDef, unitDef } from './defs.js';

export { STATE_VERSION, IllegalActionError, cloneState, applyActionInPlace, heroDef, unitDef, activatableUnits, safestSquare };

/** Create a battle (see flow.js createBattle for the squad format). Initial events: state.startEvents. */
export function createBattle(opts) {
  return create(opts);
}

/** Every legal step-level action of the side to act. */
export function legalActions(state) {
  return legal(state);
}

/** Options of one unit for the HUD (moves, swaps, jumps, basic, skill, ult, quirks, pending, phase). */
export function unitActions(state, unitId) {
  return unitActs(state, unitId);
}

/** Apply an action: returns { state: newState, events }. Throws IllegalActionError on illegal input. */
export function applyAction(state, action, opts) {
  return apply(state, action, opts);
}

/** Effective stats of a unit (ATK/DEF with buffs, crown, auras...). */
export function unitStats(state, unitId) {
  return effStats(state, unitId);
}

/**
 * Damage / heal forecast of an action without randomness (crits at their expected value, pending
 * relocations auto-resolved). Returns { targets: { [id]: { damage, heal, shield, ko, reaction, crit } },
 * events, state } or null when the action is illegal.
 */
export function previewAction(state, action) {
  let res;
  try {
    res = apply(state, action, { expected: true, autoPending: true, stopAtActivationEnd: true });
  } catch (e) {
    if (e instanceof IllegalActionError) return null;
    throw e;
  }
  const targets = {};
  const t = (id) => (targets[id] = targets[id] || { damage: 0, heal: 0, shield: 0, ko: false, reaction: null });
  for (const ev of res.events) {
    if (ev.type === 'damage') {
      const x = t(ev.target);
      x.damage += ev.amount;
      if (ev.reaction) x.reaction = ev.reaction;
    } else if (ev.type === 'heal') t(ev.target).heal += ev.amount;
    else if (ev.type === 'shield' && ev.gained) t(ev.target).shield += ev.gained;
    else if (ev.type === 'ko' || ev.type === 'execute') t(ev.unit).ko = true;
    else if (ev.type === 'ward' && !ev.on && ev.reason === 'destroyed') t(ev.id).ko = true;
  }
  return { targets, events: res.events, state: res.state };
}

/** null while the battle runs; else { winner: 1|-1|0, reason, rounds, stats }. */
export function battleResult(state) {
  if (!state || !state.result) return null;
  return { winner: state.result.winner, reason: state.result.reason, rounds: state.result.round, turn: state.result.turn, stats: battleStats(state) };
}

/**
 * Battle statistics (for rewards, stars, achievements and the MVP):
 * { sides: { 1: {...}, '-1': {...} }, units: { [id]: {...} }, mvp: { 1: id, '-1': id } }.
 * Side: heroes, heroesLost, hpShare, reactions { id: n }, reactionsTotal, ults, skills, kos, awakenings,
 * awakened [ids], maxChain, actions. Unit: dmgDealt, dmgTaken, healed, shielded, kos, reactions, crits,
 * ults, skills, basics, chains, hops, maxChain, awakenings, actions, alive, heroId, side.
 */
export function battleStats(state) {
  const sides = {};
  const units = {};
  for (const u of state.units) {
    const st = state.stats.units[u.id] || {};
    units[u.id] = {
      dmgDealt: 0, dmgTaken: 0, healed: 0, shielded: 0, kos: 0, reactions: 0, crits: 0, ults: 0, skills: 0, basics: 0, chains: 0, hops: 0, maxChain: 0, awakenings: 0, actions: 0,
      ...st, heroId: u.heroId, side: u.side, alive: u.alive,
    };
  }
  const mvp = {};
  for (const side of [1, -1]) {
    const ss = state.stats.sides[side];
    const mine = state.units.filter((u) => u.side === side);
    let kos = 0;
    for (const u of mine) kos += units[u.id].kos;
    sides[side] = {
      heroes: mine.length,
      heroesLost: mine.filter((u) => !u.alive).length,
      hpShare: totalHpShare(state, side),
      reactions: { ...ss.reactions },
      reactionsTotal: Object.values(ss.reactions).reduce((a, b) => a + b, 0),
      ults: ss.ults,
      skills: ss.skills,
      kos,
      awakenings: ss.awakened.length,
      awakened: ss.awakened.slice(),
      maxChain: ss.maxChain,
      actions: ss.actions,
    };
    let best = null;
    let bestScore = -1;
    for (const u of mine) {
      const x = units[u.id];
      const score = x.dmgDealt + 0.9 * x.healed + 0.5 * x.shielded + 250 * x.kos + 150 * x.awakenings + 60 * x.reactions;
      if (score > bestScore) {
        bestScore = score;
        best = u.id;
      }
    }
    mvp[side] = best;
  }
  return { sides, units, mvp };
}

/** JSON-safe deep copy of a battle state. */
export function serializeBattle(state) {
  return deepClone(state);
}

/** Restore a battle state from serializeBattle output (object or JSON string). */
export function deserializeBattle(obj) {
  const o = typeof obj === 'string' ? JSON.parse(obj) : obj;
  if (!o || o.v !== STATE_VERSION || !Array.isArray(o.units)) throw new Error('deserializeBattle: unsupported battle state');
  return deepClone(o);
}

/** Convenience: the unit object by id. */
export function getUnit(state, id) {
  return unitById(state, id);
}
