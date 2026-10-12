// Shared helpers for the battle engine tests: build battles, place pieces, act and inspect events.
import { createBattle, applyAction, legalActions, unitActions } from '../../../src/rpg/battle/index.js';
import { parseSq } from '../../../src/rpg/battle/board.js';
import { unitById } from '../../../src/rpg/battle/state.js';

export { createBattle, applyAction, legalActions, unitActions, parseSq };

export const sq = (n) => (typeof n === 'number' ? n : parseSq(n));

/**
 * Build a battle. `a` / `b` are hero ids or squad entries; heroes listed first get ids a0.., b0...
 * Options: level (default 10), seed, first, stage, mode, roundLimit.
 */
export function battle(a, b, o = {}) {
  const entry = (x) => (typeof x === 'string' ? { heroId: x, level: o.level || 10, constellation: o.c || 0 } : { level: o.level || 10, ...x });
  return createBattle({
    sides: { 1: a.map(entry), [-1]: b.map(entry) },
    seed: o.seed != null ? o.seed : 7,
    first: o.first || 1,
    stage: o.stage || null,
    mode: o.mode || 'training',
    roundLimit: o.roundLimit,
  });
}

export const U = (s, id) => unitById(s, id);

/** Place pieces: place(s, { a0: 'd4', b0: 'e5', b1: null }) — null = KO'd and removed. */
export function place(s, map) {
  for (const [id, where] of Object.entries(map)) {
    const u = unitById(s, id);
    if (!u) throw new Error(`no unit ${id}`);
    if (where == null) {
      u.alive = false;
      u.sq = -1;
      u.hp = 0;
      u.final = true;
    } else u.sq = sq(where);
  }
  // remove wards standing where units were placed (decoys etc. stay unless overlapping)
  s.wards = s.wards.filter((w) => !s.units.some((u) => u.alive && u.sq === w.sq));
  return s;
}

/** Put every unit not mentioned far away on its own back row corner squares (keeps sides alive). */
export function only(s, map) {
  const spare = { 1: ['a1', 'c1', 'e1', 'g1', 'b2', 'd2', 'f2', 'h2'].map(sq), '-1': ['h8', 'f8', 'd8', 'b8', 'g7', 'e7', 'c7', 'a7'].map(sq) };
  const used = new Set(Object.values(map).filter((x) => x != null).map(sq));
  for (const u of s.units) {
    if (u.id in map) continue;
    const list = spare[u.side].filter((q) => !used.has(q));
    u.sq = list[0];
    used.add(list[0]);
  }
  s.wards = [];
  return place(s, map);
}

/** Make it `side`'s turn with no open activation. */
export function turn(s, side) {
  s.side = side;
  s.act = null;
  s.tt = { side, turn: s.turn, activated: [], hitEnergy: {}, dmgTaken: {}, trig: {}, retreated: {}, bossExtra: false };
  return s;
}

export function act(s, action, opts) {
  return applyAction(s, action, opts);
}

export const evs = (events, type) => events.filter((e) => e.type === type);
/** Events of the action itself (before the turn ends). */
export function own(events) {
  const i = events.findIndex((e) => e.type === 'turnEnd');
  return i < 0 ? events : events.slice(0, i);
}
/** Damage dealt to `id` by the action itself (excludes next-turn ticks). */
export const dmgTo = (events, id) => own(events).filter((e) => e.type === 'damage' && e.target === id).reduce((a, e) => a + e.amount, 0);
export const statusOn = (s, id, st) => U(s, id).statuses.find((x) => x.id === st) || null;

/** No crits anywhere (exact damage assertions). */
export function noCrits(s) {
  for (const u of s.units) u.crit = -1000;
  return s;
}

export function setSeal(s, id, element) {
  const u = U(s, id);
  const slot = ['radiance', 'umbra'].includes(element) ? 'celestial' : 'natural';
  u.seals = u.seals.filter((x) => x.slot !== slot);
  u.seals.push({ element, slot, turns: 2 });
  u.seal = element;
  return s;
}

export function addStatus(s, id, status, turns = 1, extra = {}) {
  const u = U(s, id);
  u.statuses.push({ id: status, turns, stacks: 1, source: extra.source || null, seq: ++s.seq, ...extra });
  return s;
}

export function moves(s, id) {
  return unitActions(s, id).moves.slice().sort((x, y) => x - y);
}

export const sqs = (...names) => names.map(sq).sort((x, y) => x - y);
