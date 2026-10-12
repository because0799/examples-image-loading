// «Валькирии доски» — how the battle view reads the engine's event log (pure, Node-testable).
//
//   parseBeats(events)        → beats: the units of choreography (turn start ticks, a move, a jump
//                               chain, a cast with all its consequences, turn end, victory, misc)
//   hitGroups(events, caster) → { pre, groups, post }: the consequences of an action split per hit
//                               target, so a VFX can apply "everything that happens to Akane" at the
//                               moment its projectile lands (damage + reaction + seal + KO …)
//   stackNumbers(...)         → floating-number stacking: ≤ 6 visible, series on one target collapse
//                               into a sum after the 3rd hit ("×6 = 2 854"), newer ones push older up
//   VoiceGate                 → skill voice lines at most once per 2 rounds per heroine (GDD §18.6)
//   ultMode(settings)         → 'full' | 'short' | 'first' Ultimate cinematics preference
//
// Event shapes: docs/RPG-ARCHITECTURE.md + src/rpg/battle (damage{source,target,amount,crit,
// element,reaction,absorbed,hp,shield,kind}, jump{unit,from,to,over,victim,hop}, ...). Unknown
// event types are kept and passed through, never dropped.

/** Damage kinds that are consequences of another hit (not a new hit of their own). */
const CHAIN_DAMAGE = new Set(['reaction', 'collision', 'redirect']);

export const isChainDamage = (e) => !!e && e.type === 'damage' && CHAIN_DAMAGE.has(e.kind);

/** The unit an event is "about" (or null). */
export function subjectOf(e) {
  if (!e) return null;
  switch (e.type) {
    case 'damage':
    case 'heal':
    case 'shield':
    case 'status':
    case 'seal':
    case 'reaction':
    case 'arc':
    case 'bounce':
      return e.target != null ? e.target : null;
    case 'energy':
    case 'ko':
    case 'awaken':
    case 'displace':
    case 'revive':
    case 'survive':
    case 'crownLost':
    case 'execute':
    case 'cooldown':
    case 'extraActivation':
    case 'move':
    case 'jump':
    case 'rule':
      return e.unit != null ? e.unit : null;
    case 'redirect':
      return e.from != null ? e.from : null;
    default:
      return null;
  }
}

/** Events that start a new hit group for their subject. */
export function isPrimary(e) {
  if (!e) return false;
  switch (e.type) {
    case 'damage':
      return !isChainDamage(e);
    case 'heal':
    case 'revive':
    case 'execute':
      return true;
    case 'shield':
      return (e.amount || 0) > 0;
    case 'status':
      return !!e.on;
    case 'seal':
      return !!e.element;
    default:
      return false;
  }
}

/**
 * Split an event log into beats:
 *   { type: 'turn', side, round, head, events }   turnStart + its ticks (Burn, Regen, zones, wards)
 *   { type: 'move', unit, head, events }          a move (+ zone triggers, awakening, gates …)
 *   { type: 'jump', unit, events }                a whole jump-strike chain (jump events + hits)
 *   { type: 'cast', kind, unit, head, events }    basic / skill / ult / quirk + consequences
 *   { type: 'end', head, events }                 turnEnd / roundEnd + expiring statuses / seals
 *   { type: 'victory', winner, head, events }
 *   { type: 'misc', events }                      anything before the first starter
 * Jump events of the caster right after a cast (a jumpStrike skill) stay inside the cast beat.
 */
export function parseBeats(events) {
  const beats = [];
  let cur = null;
  const open = (b) => {
    beats.push(b);
    cur = b;
    return b;
  };
  for (const e of events || []) {
    if (!e || typeof e !== 'object') continue;
    switch (e.type) {
      case 'turnStart':
        open({ type: 'turn', side: e.side, round: e.round, head: e, events: [] });
        break;
      case 'move':
        open({ type: 'move', unit: e.unit, head: e, events: [] });
        break;
      case 'cast':
        open({ type: 'cast', kind: e.kind || 'skill', unit: e.unit, head: e, events: [] });
        break;
      case 'jump':
        if (cur && (cur.type === 'jump' || cur.type === 'cast') && cur.unit === e.unit) cur.events.push(e);
        else open({ type: 'jump', unit: e.unit, head: null, events: [e] });
        break;
      case 'turnEnd':
      case 'roundEnd':
        if (cur && cur.type === 'end') cur.events.push(e);
        else open({ type: 'end', head: e, events: [e] });
        break;
      case 'victory':
        open({ type: 'victory', winner: e.winner, head: e, events: [] });
        break;
      default:
        if (!cur || cur.type === 'victory') open({ type: 'misc', head: null, events: [] });
        cur.events.push(e);
    }
  }
  return beats;
}

/**
 * Split the consequences of an action into per-target hit groups.
 *   pre    — events before the first hit (the caster pays energy, dashes in, wards rise …)
 *   groups — [{ target, events, hit }] in order; a second damaging hit on the same target opens a
 *            new group (multi-hit ultimates), statuses / seals / KOs / pushes of a target join its
 *            latest group, reaction fallout (reaction, arcs, splash damage) joins the group of the
 *            hit that triggered it
 *   post   — caster events after the hits (energy gain, moveSelf to the line end, zones …)
 */
export function hitGroups(events, casterId = null) {
  const pre = [];
  const groups = [];
  const post = [];
  const lastFor = new Map();
  let cur = null;
  const tail = () => (groups.length ? post : pre);
  const openGroup = (target, e) => {
    const g = { target, events: [e], hit: e.type === 'damage' && !isChainDamage(e) };
    groups.push(g);
    if (target != null) lastFor.set(target, g);
    cur = g;
    return g;
  };
  for (const e of events || []) {
    if (!e || typeof e !== 'object') continue;
    const subj = subjectOf(e);
    // reaction fallout follows the hit that caused it
    if (e.type === 'reaction' || e.type === 'arc' || e.type === 'bounce' || isChainDamage(e)) {
      if (e.type === 'bounce') {
        // a bounce announces the next hit of a chain: it opens that target's group
        openGroup(subj, e).hit = false;
        continue;
      }
      if (cur) cur.events.push(e);
      else openGroup(subj, e);
      continue;
    }
    if (isPrimary(e)) {
      const g = subj != null ? lastFor.get(subj) : null;
      const hitting = e.type === 'damage';
      if (g && !(hitting && g.hit)) {
        g.events.push(e);
        if (hitting) {
          g.hit = true;
          cur = g;
        }
      } else openGroup(subj, e);
      continue;
    }
    if (subj != null && subj === casterId) {
      tail().push(e);
      continue;
    }
    if (subj != null) {
      const g = lastFor.get(subj) || cur;
      if (g) g.events.push(e);
      else tail().push(e);
      continue;
    }
    tail().push(e);
  }
  return { pre, groups, post };
}

/** Unit ids hit by an action, in first-hit order (no duplicates). */
export function targetsOf(groups) {
  const out = [];
  for (const g of groups) if (g.target != null && !out.includes(g.target)) out.push(g.target);
  return out;
}

// ------------------------------------------------------------------------------- numbers

/**
 * Floating-number stacking decision (GDD §18.4). `live` = the numbers on screen, each
 * { key (target), sum (bool), hits, total, born }. Returns what to do with a new hit on `key`:
 *   { mode: 'sum', into }      add it to the running sum item `into`
 *   { mode: 'collapse', merge } the hit is the (collapseAfter+1)-th of a series: merge `merge`
 *                               (the target's live single numbers) into a new sum item
 *   { mode: 'new', shift }      a new number; `shift` = the target's live numbers to push up
 * plus `evict`: the oldest items beyond maxVisible (counting the new one).
 */
export function stackNumbers(live, key, { maxVisible = 6, collapseAfter = 3, window = 1600, now = 0, series = true } = {}) {
  const mine = live.filter((n) => n.key === key && !n.dying);
  let res;
  const sum = series ? mine.find((n) => n.sum && now - n.touched <= window) : null;
  if (sum) res = { mode: 'sum', into: sum };
  else {
    const singles = mine.filter((n) => !n.sum && n.series && now - n.born <= window);
    if (series && singles.length >= collapseAfter) res = { mode: 'collapse', merge: singles };
    else res = { mode: 'new', shift: mine };
  }
  const alive = live.filter((n) => !n.dying && !(res.merge && res.merge.includes(n)));
  const count = alive.length + (res.mode === 'sum' ? 0 : 1);
  const over = Math.max(0, count - maxVisible);
  res.evict = alive
    .filter((n) => n !== res.into)
    .sort((a, b) => a.born - b.born)
    .slice(0, over);
  return res;
}

// ------------------------------------------------------------------------------- voice / prefs

/** Skill voice lines: at most once per `gap` rounds per heroine (ultimates always speak). */
export class VoiceGate {
  constructor(gap = 2) {
    this.gap = gap;
    this.last = new Map();
  }
  allow(heroId, event, round) {
    if (event !== 'skill') return true;
    const r = Number(round) || 0;
    const prev = this.last.get(heroId);
    if (prev != null && r - prev < this.gap) return false;
    this.last.set(heroId, r);
    return true;
  }
  reset() {
    this.last.clear();
  }
}

/** settings.rpgUltCinematic: 'full' (default) | 'short' (VFX only) | 'first' (full once per heroine per battle). */
export function ultMode(settings) {
  const v = settings && settings.rpgUltCinematic;
  return v === 'short' || v === 'first' ? v : 'full';
}

/** settings.rpgDamageNumbers (default true): floating numbers on the board. */
export function numbersOn(settings) {
  return !(settings && settings.rpgDamageNumbers === false);
}
