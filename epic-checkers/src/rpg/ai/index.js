// «Валькирии доски» — battle AI (GDD §10). Pure and deterministic for a given (state, difficulty, seed).
//
//   chooseAction(state, { difficulty: 'easy'|'normal'|'hard'|'boss', seed }) -> Action
//
// The returned action is legal for applyAction. It is usually a COMPOSITE activation (an act with a
// `to` square: move first, then act) or a jump chain / wait. A "move only" plan returns the move; call
// chooseAction again (the activation is still open) and it decides between acting and passing. Pending
// free moves and extra activations are answered the same way — call it until `state.side` changes.
//
// Levels (rules.js AI.levels):
//   easy   — depth 1, picks randomly among the 5 best, 25 % random legal plan, casts ultimates ASAP
//   normal — depth 1, best plan with ±5 % noise, "smart" ultimates
//   hard   — depth 2: the 12 best plans are answered by the opponent's best greedy reply,
//            value = own − 0.8 × reply; "smart + hold" ultimates
//   boss   — hard with a wider beam (16) and reply weight 0.9 (used for campaign bosses)

import { AI } from '../data/rules.js';
import { cloneState, unitById } from '../battle/state.js';
import { applyActionInPlace } from '../battle/flow.js';
import { moveOptions, pendingOptions } from '../battle/movement.js';
import { actOptions, jumpOptions, activatableUnits, safestSquare } from '../battle/actions.js';
import { makeRng } from '../battle/rng.js';
import { evaluate, threatTo } from './evaluate.js';

export const DIFFICULTIES = ['easy', 'normal', 'hard', 'boss'];

const LEVELS = {
  easy: { ...AI.levels.easy, ult: 'asap' },
  normal: { ...AI.levels.normal },
  hard: { ...AI.levels.hard },
  boss: { ...AI.levels.hard, beam: 16, replyWeight: 0.9 },
};

const SIM = { expected: true, autoPending: true, stopAtActivationEnd: true };
const SQUARE_CAP = 8;

function simulate(base, action) {
  const c = cloneState(base);
  const events = applyActionInPlace(c, action, SIM);
  return { state: c, events };
}

/**
 * Every activation plan of the side to act, simulated and scored.
 * plan = { action, unit, kind, score, kos, affected, healed, teamMissing, after }
 */
export function generatePlans(state, o = {}) {
  const me = state.side;
  const plans = [];
  const dangerW = o.danger;
  const push = (action, unitId, kind, base, simAction = action) => {
    let sim;
    try {
      sim = simulate(base, simAction);
    } catch (e) {
      if (e && e.name === 'IllegalActionError') return;
      throw e;
    }
    const ev = evaluate(state, sim.state, me, { actorId: unitId, kind, events: sim.events }, { danger: dangerW });
    plans.push({ action, unit: unitId, kind, ...ev, after: sim.state });
  };
  const units = activatableUnits(state);
  for (const u of units) {
    const moved = state.act && state.act.unit === u.id && state.act.moved;
    if (!moved) {
      push({ type: 'pass', unit: u.id }, u.id, 'wait', state);
      for (const ch of jumpOptions(state, u)) push({ type: 'jump', unit: u.id, path: ch.path.slice() }, u.id, 'jump', state);
    } else {
      push({ type: 'pass', unit: u.id }, u.id, 'move', state);
    }
    const positions = [{ to: u.sq, base: state }];
    if (!moved) {
      const mo = moveOptions(state, u);
      for (const m of [...mo.moves, ...mo.swaps]) {
        const c = cloneState(state);
        try {
          applyActionInPlace(c, { type: 'move', unit: u.id, to: m.to }, SIM);
        } catch (e) {
          if (e && e.name === 'IllegalActionError') continue;
          throw e;
        }
        positions.push({ to: m.to, base: c });
      }
    }
    for (const pos of positions) {
      const mover = unitById(pos.base, u.id);
      // move only: the activation is still open in pos.base; ending it gives +10 energy
      if (pos.to !== u.sq) push({ type: 'move', unit: u.id, to: pos.to }, u.id, 'move', pos.base, { type: 'pass', unit: u.id });
      if (!mover || !mover.alive || pos.base.result || !pos.base.act || pos.base.act.unit !== u.id) continue;
      for (const act of actOptions(pos.base, mover, { squareCap: SQUARE_CAP })) {
        const full = pos.to !== u.sq ? { ...act, to: pos.to } : act;
        push(full, u.id, act.type, pos.base, act);
      }
    }
  }
  return plans;
}

/** GDD §10.3 "smart" ultimate policy. */
function smartUlt(plan, state) {
  if (plan.kind !== 'ult') return true;
  const u = unitById(state, plan.unit);
  if (plan.kos >= 1 || plan.affected >= 2) return true;
  if (plan.teamMissing > 0 && plan.healed >= 0.3 * plan.teamMissing) return true;
  return u && u.fullTurns >= 2;
}

function allyInDanger(state, me) {
  for (const u of state.units) if (u.alive && u.side === me && threatTo(state, u) >= u.hp + u.shield) return true;
  return false;
}

/** Choose the next action for the side to act. */
export function chooseAction(state, opts = {}) {
  if (!state || state.result) return null;
  const difficulty = LEVELS[opts.difficulty] ? opts.difficulty : 'normal';
  const L = LEVELS[difficulty];
  const rng = makeRng(`${opts.seed != null ? opts.seed : state.seed}:${state.turn}:${state.act ? `${state.act.unit}${state.act.moved ? 1 : 0}${state.act.pending.length}` : '-'}:${difficulty}`);

  // pending relocation: pick the safest square
  if (state.act && state.act.pending.length) {
    const u = unitById(state, state.act.unit);
    const pend = state.act.pending[0];
    const opts2 = pendingOptions(state, u, pend).map((m) => m.to);
    if (!opts2.length) return { type: 'pass', unit: u.id };
    const q = safestSquare(state, u, opts2, !!pend.optional);
    if (q === u.sq || q < 0) return pend.optional ? { type: 'pass', unit: u.id } : { type: 'move', unit: u.id, to: opts2[0] };
    return { type: 'move', unit: u.id, to: q };
  }
  const units = activatableUnits(state);
  if (!units.length) return { type: 'pass' };

  const plans = generatePlans(state, { danger: difficulty === 'hard' || difficulty === 'boss' ? 0.25 : undefined });
  if (!plans.length) return { type: 'pass', unit: units[0].id };

  if (L.ult === 'asap') {
    const ults = plans.filter((p) => p.kind === 'ult');
    if (ults.length) return ults.sort((a, b) => b.score - a.score)[0].action;
  }
  let pool = L.ult === 'asap' ? plans : plans.filter((p) => smartUlt(p, state));
  if (!pool.length) pool = plans;

  if (difficulty === 'easy') {
    if (rng.next() < L.randomActionChance) return pool[rng.int(pool.length)].action;
    const top = pool.slice().sort((a, b) => b.score - a.score).slice(0, L.pickFromTop);
    return top[rng.int(top.length)].action;
  }
  if (difficulty === 'normal') {
    let best = null;
    let bestV = -Infinity;
    for (const p of pool) {
      const v = p.score + Math.abs(p.score) * L.noise * (rng.next() * 2 - 1);
      if (v > bestV) {
        bestV = v;
        best = p;
      }
    }
    return best.action;
  }
  // hard / boss: depth 2
  const sorted = pool.slice().sort((a, b) => b.score - a.score);
  const beam = sorted.slice(0, L.beam || 12);
  let best = beam[0];
  let bestV = -Infinity;
  for (const p of beam) {
    const reply = replyScore(state, p);
    // the reply already measures the exposure: keep only a quarter of the greedy danger penalty,
    // and lean in as the round limit approaches
    const rw = (L.replyWeight || 0.8) * (1 - 0.5 * (p.pressure || 0));
    const v = p.score + 0.75 * (p.dangerPenalty || 0) - rw * reply;
    p.value = v;
    if (v > bestV) {
      bestV = v;
      best = p;
    }
  }
  // smart-hold: keep the ultimate for a better moment when nothing urgent happens
  if (best.kind === 'ult' && best.kos === 0 && best.affected <= 1) {
    const u = unitById(state, best.unit);
    if (u && u.fullTurns < 2 && !allyInDanger(state, state.side)) {
      const alt = beam.filter((p) => p.kind !== 'ult').sort((a, b) => b.value - a.value)[0];
      if (alt && alt.value >= 0.75 * best.value) best = alt;
    }
  }
  return best.action;
}

/** Best greedy score of the opponent after our plan (the plan is played to the end of our turn). */
function replyScore(root, plan) {
  if (plan.after.result) return plan.after.result.winner === root.side ? -1e6 : 1e6;
  let s;
  try {
    s = cloneState(root);
    applyActionInPlace(s, plan.action, { expected: true, autoPending: true });
    if (plan.action.type === 'move' && s.act && s.act.unit === plan.unit) applyActionInPlace(s, { type: 'pass', unit: plan.unit }, { expected: true, autoPending: true });
  } catch (e) {
    if (e && e.name === 'IllegalActionError') return 0;
    throw e;
  }
  if (s.result) return s.result.winner === root.side ? -1e6 : 1e6;
  if (s.side === root.side) return 0; // extra activation still ours
  const replies = generatePlans(s, {});
  let best = 0;
  for (const r of replies) if (r.score > best) best = r.score;
  return best;
}

export { evaluate, threatTo };
