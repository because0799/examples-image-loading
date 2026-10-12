// Trigger dispatch (effects.md §5): passive / quirk / constellation triggers with their limits
// (oncePerTurn, maxPerTurn, oncePerBattle) and conditions.

import { unitDef } from './defs.js';
import { checkCond } from './stats.js';
import { pieceById } from './state.js';
import { runEffects, subCtx } from './effects.js';

const MAX_DEPTH = 8;

/**
 * Fire trigger `on` for `unit`. event = { source, target, crit, reaction, kind, melee, amount }.
 * Effects run with the unit as caster; `who: 'eventSource' | 'eventTarget'` resolve from the event.
 */
export function fire(ctx, unit, on, event = {}, o = {}) {
  if (!unit || unit.isWard) return;
  if (!unit.alive && !o.allowDead) return;
  const E = ctx.E;
  if (E.depth > MAX_DEPTH || E.result) return;
  const def = unitDef(unit);
  if (!def.triggers.length) return;
  const s = ctx.s;
  for (const t of def.triggers) {
    if (t.on !== on) continue;
    if (E.result) return;
    if (t.oncePerBattle && unit.trigBattle[t.key]) continue;
    const k = `${unit.id}:${t.key}`;
    const used = s.tt.trig[k] || 0;
    if (t.oncePerTurn && used >= 1) continue;
    if (t.maxPerTurn != null && used >= t.maxPerTurn) continue;
    const act = s.act && s.act.unit === unit.id ? s.act : null;
    const env = {
      s, self: unit, target: event.target ? pieceById(s, event.target) : null,
      crit: event.crit, reaction: event.reaction, source: event.kind, melee: event.melee,
      moved: act ? act.moved : false, movedDist: act ? act.movedDist : 0, fromSq: unit.sq,
    };
    if (t.if && !checkCond(t.if, env)) continue;
    s.tt.trig[k] = used + 1;
    if (t.oncePerBattle) unit.trigBattle[t.key] = true;
    E.depth++;
    try {
      const sub = subCtx(E, { caster: unit, kind: 'trigger', event, srcKind: event.kind || 'trigger', abilityId: t.key, triggerOn: on });
      runEffects(sub, t.effects);
    } finally {
      E.depth--;
    }
  }
}

/** Fire `on` for every living unit of a side (optionally excluding one). */
export function fireSide(ctx, side, on, event = {}, exclude = null) {
  const list = ctx.s.units.filter((u) => u.alive && u.side === side && u !== exclude);
  for (const u of list) fire(ctx, u, on, event);
}

/** Does the unit have a trigger for `on`? */
export function hasTrigger(unit, on) {
  return unitDef(unit).triggers.some((t) => t.on === on);
}
