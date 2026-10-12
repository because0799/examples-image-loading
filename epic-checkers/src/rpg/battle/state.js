// Battle state: units, wards, zones, lookups, deployment and cloning.
// The state is a plain JSON-serializable object (see index.js for its documented shape).

import { HERO_BY_ID } from '../data/heroes.js';
import { statsAt, ENERGY, STATUSES } from '../data/rules.js';
import { heroDef, unitDef } from './defs.js';
import { DARK, isDark, rowOf, colOf, dist, homeRow, deployRows, parseSq, neighbors } from './board.js';

export const STATE_VERSION = 1;

// ------------------------------------------------------------------------------------------ clone

function deepClone(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    const n = v.length;
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = deepClone(v[i]);
    return out;
  }
  const out = {};
  for (const k in v) out[k] = deepClone(v[k]);
  return out;
}

const cloneMap = (m) => {
  const o = {};
  for (const k in m) o[k] = m[k];
  return o;
};
const cloneObjs = (a) => {
  const n = a.length;
  const o = new Array(n);
  for (let i = 0; i < n; i++) o[i] = { ...a[i] };
  return o;
};

function cloneUnit(u) {
  const c = { ...u };
  c.cd = { skill: u.cd.skill, quirk: cloneMap(u.cd.quirk) };
  c.uses = cloneMap(u.uses);
  c.statuses = cloneObjs(u.statuses);
  c.seals = cloneObjs(u.seals);
  c.trigBattle = cloneMap(u.trigBattle);
  if (u.boss) c.boss = { ...u.boss };
  return c;
}

function cloneSideStats(x) {
  return { ...x, reactions: cloneMap(x.reactions), awakened: x.awakened.slice() };
}

/**
 * Independent copy of a battle state (fast, shape-aware). Immutable parts are shared: `stage`,
 * `startEvents`, `reserved`, ability data referenced by wards / zones (behaviour, aura, effects),
 * unit `variant`, boss `mechanics`, `result` and `warn` entries (always replaced, never mutated).
 */
export function cloneState(s) {
  const c = { ...s };
  c.sideTurns = { ...s.sideTurns };
  c.awakenRows = { ...s.awakenRows };
  c.units = s.units.map(cloneUnit);
  c.wards = s.wards.map((w) => (w.data ? { ...w, data: { ...w.data } } : { ...w }));
  c.zones = s.zones.map((z) => ({ ...z, sqs: z.sqs.slice() }));
  c.holes = s.holes.slice();
  c.warn = { ...s.warn };
  if (s.act) {
    const a = s.act;
    c.act = { ...a, pending: a.pending.slice(), extraQueue: a.extraQueue.slice(), entered: cloneMap(a.entered || {}), gated: cloneMap(a.gated || {}) };
  }
  const t = s.tt;
  c.tt = { ...t, activated: t.activated.slice(), hitEnergy: cloneMap(t.hitEnergy), dmgTaken: cloneMap(t.dmgTaken), trig: cloneMap(t.trig), retreated: cloneMap(t.retreated) };
  const units = {};
  for (const k in s.stats.units) units[k] = { ...s.stats.units[k] };
  c.stats = { units, sides: { 1: cloneSideStats(s.stats.sides[1]), '-1': cloneSideStats(s.stats.sides[-1]) } };
  return c;
}

export { deepClone };

// ---------------------------------------------------------------------------------------- lookups

export function unitById(s, id) {
  const us = s.units;
  for (let i = 0; i < us.length; i++) if (us[i].id === id) return us[i];
  return null;
}

export function wardById(s, id) {
  const ws = s.wards;
  for (let i = 0; i < ws.length; i++) if (ws[i].id === id) return ws[i];
  return null;
}

export function pieceById(s, id) {
  return unitById(s, id) || wardById(s, id);
}

export const isWard = (p) => !!(p && p.isWard);

/** Piece (living unit or ward) standing on sq, or null. */
export function pieceAt(s, sq) {
  if (sq < 0) return null;
  const us = s.units;
  for (let i = 0; i < us.length; i++) if (us[i].alive && us[i].sq === sq) return us[i];
  const ws = s.wards;
  for (let i = 0; i < ws.length; i++) if (ws[i].sq === sq) return ws[i];
  return null;
}

/** Array(64) of pieces for fast repeated queries. */
export function occupancy(s) {
  const occ = new Array(64).fill(null);
  for (const w of s.wards) occ[w.sq] = w;
  for (const u of s.units) if (u.alive && u.sq >= 0) occ[u.sq] = u;
  return occ;
}

export function playable(s, sq) {
  return isDark(sq) && (s.holes.length === 0 || !s.holes.includes(sq));
}

export function isEmptySq(s, sq) {
  return playable(s, sq) && !pieceAt(s, sq);
}

export function livingUnits(s, side) {
  const out = [];
  for (const u of s.units) if (u.alive && (side === undefined || u.side === side)) out.push(u);
  return out;
}

export function hasStatus(u, id) {
  const st = u.statuses;
  for (let i = 0; i < st.length; i++) if (st[i].id === id) return st[i];
  return null;
}

export function statusValue(u, id) {
  const st = hasStatus(u, id);
  if (!st) return 0;
  return st.value != null ? st.value : STATUSES[id] && STATUSES[id].value != null ? STATUSES[id].value : 0;
}

export function sealOf(u, slot) {
  for (const x of u.seals) if (x.slot === slot) return x;
  return null;
}

/** Unit cannot be activated (Stun / Frozen / boss Break). */
export function isDisabled(u) {
  return !!(hasStatus(u, 'stun') || hasStatus(u, 'frozen') || hasStatus(u, 'break'));
}

/** Ally adjacent to a piece (excluding itself). */
export function adjacentUnits(s, sq, side) {
  const out = [];
  for (const n of neighbors(sq)) {
    const p = pieceAt(s, n);
    if (p && !p.isWard && (side === undefined || p.side === side)) out.push(p);
  }
  return out;
}

export function nextId(s, prefix) {
  s.seq += 1;
  return `${prefix}${s.seq}`;
}

// ------------------------------------------------------------------------------------------ units

/**
 * Create a unit object for a squad entry.
 * entry = { heroId, level=1, constellation=0, sq?, boss?, miniBoss?, hpMult?, reflection?, variant? }
 */
export function makeUnit(entry, side, index, extra = {}) {
  const hero = HERO_BY_ID[entry.heroId];
  if (!hero) throw new Error(`Unknown hero: ${entry.heroId}`);
  const level = Math.max(1, Math.min(30, Math.floor(entry.level || 1)));
  const constellation = Math.max(0, Math.min(6, Math.floor(entry.constellation || 0)));
  const variant = extra.variant || entry.variant || null;
  const def = heroDef(entry.heroId, constellation, variant ? variant.key : '', variant);
  const st = statsAt(hero, level);
  const hpMult = extra.hpMult || entry.hpMult || 1;
  const maxHp = Math.max(1, Math.floor(Math.floor(st.hp * (1 + def.staticHpPct)) * hpMult));
  const maxEnergy = Math.max(1, Math.round(def.ultimate.cost + def.ultCostAdd));
  return {
    id: `${side === 1 ? 'a' : 'b'}${index}`,
    heroId: entry.heroId,
    side,
    sq: -1,
    alive: true,
    level,
    constellation,
    role: def.role,
    element: def.element,
    rarity: def.rarity,
    hp: maxHp,
    maxHp,
    atk: st.atk,
    def: st.def,
    crit: st.crit,
    aff: st.aff,
    energy: Math.floor(ENERGY.startPct * maxEnergy),
    maxEnergy,
    cd: { skill: 0, quirk: {} },
    uses: {},
    statuses: [],
    seals: [],
    seal: null,
    shield: 0,
    awakened: false,
    awakenBonusUsed: false,
    boss: extra.boss || null,
    variant,
    reflection: !!(extra.reflection || entry.reflection),
    koAt: 0,
    lastSq: -1,
    final: false,
    revived: false,
    egg: null,
    trigBattle: {},
    fullTurns: 0,
  };
}

export { unitDef };

// ------------------------------------------------------------------------------------- deployment

/** Dark squares of a side's two deployment rows: { front: [...], back: [...] } (centre first). */
export function deploySquares(s, side) {
  const [front, back] = deployRows(side);
  const centreFirst = (row) =>
    DARK.filter((q) => rowOf(q) === row && playable(s, q) && !(s.reserved || []).includes(q)).sort(
      (a, b) => Math.abs(colOf(a) - 3.5) - Math.abs(colOf(b) - 3.5) || colOf(a) - colOf(b),
    );
  return { front: centreFirst(front), back: centreFirst(back) };
}

const FRONT_PRIORITY = { guardian: 0, blade: 1, shadow: 2, ranger: 3, mystic: 4, oracle: 5 };

/**
 * Default formation for heroes without an explicit `sq` (GDD §3.1 / §10):
 *  style 'ai'   — back row first (closes the awakening squares), then the front row; Guardians first
 *                 to the front, then Blades; Oracles behind a Guardian when possible.
 *  style 'auto' — the player's «Авто»: Guardians, Blades and Shadows forward; Rangers, Mystics and
 *                 Oracles back; Oracles behind a Guardian when possible.
 * Returns an array of squares parallel to `units` (-1 for units that could not be placed).
 */
export function autoDeploy(s, units, side, style, taken = new Set()) {
  const { front, back } = deploySquares(s, side);
  const freeFront = front.filter((q) => !taken.has(q));
  const freeBack = back.filter((q) => !taken.has(q));
  const n = units.length;
  const order = units.map((u, i) => i).sort((a, b) => FRONT_PRIORITY[units[a].role] - FRONT_PRIORITY[units[b].role] || a - b);
  let frontCount;
  if (style === 'ai') {
    frontCount = Math.max(0, n - freeBack.length);
  } else {
    const forwardTypes = units.filter((u) => FRONT_PRIORITY[u.role] <= 2).length;
    frontCount = Math.min(freeFront.length, Math.max(forwardTypes, n - freeBack.length));
  }
  frontCount = Math.min(frontCount, freeFront.length);
  const result = new Array(n).fill(-1);
  const frontIdx = order.slice(0, frontCount);
  const backIdx = order.slice(frontCount);
  frontIdx.forEach((ui, k) => {
    result[ui] = freeFront[k];
    taken.add(freeFront[k]);
  });
  // Oracles first, preferring a back square diagonally behind a Guardian.
  const guardSqs = frontIdx.filter((ui) => units[ui].role === 'guardian').map((ui) => result[ui]);
  const backFree = freeBack.slice();
  const takeBack = (pref) => {
    let pick = backFree.find((q) => pref(q));
    if (pick === undefined) pick = backFree[0];
    if (pick === undefined) return -1;
    backFree.splice(backFree.indexOf(pick), 1);
    taken.add(pick);
    return pick;
  };
  const backSorted = backIdx.slice().sort((a, b) => (units[a].role === 'oracle' ? 0 : 1) - (units[b].role === 'oracle' ? 0 : 1) || a - b);
  for (const ui of backSorted) {
    if (units[ui].role === 'oracle' && guardSqs.length) result[ui] = takeBack((q) => guardSqs.some((g) => dist(g, q) === 1));
    else result[ui] = takeBack(() => true);
  }
  // overflow (more units than squares in a row) goes to any remaining deploy square
  for (let i = 0; i < n; i++) {
    if (result[i] >= 0) continue;
    const any = [...front, ...back].find((q) => !taken.has(q));
    if (any !== undefined) {
      result[i] = any;
      taken.add(any);
    }
  }
  return result;
}

/** Preset formations (stage rule presetFormation). Squares in board notation for side −1. */
export const PRESET_FORMATIONS = {
  // Stage 1-3 «Прыжок за прыжком»: three enemies on row 5 (c5, e5, g5) leave d6/f4/h6 open — a
  // Blade arriving on b4 or d4 finds a ready-made chain of up to three hops.
  ladder: ['c5', 'e5', 'g5', 'd8', 'f8', 'b8'],
};

export function presetSquares(name, side) {
  const list = PRESET_FORMATIONS[name];
  if (!list) return null;
  return list.map((n) => {
    const q = parseSq(n);
    return side === 1 ? 63 - q : q; // mirrored for side 1 (never used by the campaign, kept total)
  });
}

/** Nearest empty playable square to `from` among `candidates` (ties: smaller sq). */
export function nearestEmpty(s, from, candidates) {
  let best = -1;
  let bestD = Infinity;
  for (const q of candidates) {
    if (!isEmptySq(s, q)) continue;
    const d = from >= 0 ? dist(from, q) : 0;
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}

/** Squares of the side's back row, then second row, then everything (for wards / revive placement). */
export function homeSquares(s, side, rows = 1) {
  const hr = homeRow(side);
  const out = [];
  for (let k = 0; k < rows; k++) {
    const r = side === 1 ? hr - k : hr + k;
    for (const q of DARK) if (rowOf(q) === r && playable(s, q)) out.push(q);
  }
  return out;
}

export function totalHpShare(s, side) {
  let hp = 0;
  let max = 0;
  for (const u of s.units) {
    if (u.side !== side) continue;
    max += u.maxHp;
    if (u.alive) hp += Math.max(0, u.hp);
  }
  return max > 0 ? hp / max : 0;
}

export { STATUSES };
