// Compiled hero definitions: heroes.js entry + constellation patches C1..Cn (effects.md §8), with the
// passive / quirk / constellation pieces flattened into lists the engine reads directly:
//   def.triggers  [{ key, on, if, effects, oncePerTurn, maxPerTurn, oncePerBattle }]
//   def.mods      [{ stat, value, if, scale, perUnit, max }]
//   def.auras     [{ range, side, mods }]
//   def.rules     { ruleName: params }       (named rules, effects.md §6)
//   def.quirkActions [{ id, name, desc, target, effects, usesPerBattle, cooldown, rule? }]
// Definitions are memoized per (heroId, constellation, variant) and must be treated as read-only.

import { HERO_BY_ID } from '../data/heroes.js';
import { ROLES } from '../data/rules.js';

const cache = new Map();

const deepCopy = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

/** Fields of a heroes.js entry the engine needs (art, lore, voice... are left out). */
const MECH_FIELDS = ['id', 'name', 'title', 'rarity', 'element', 'role', 'base', 'growth', 'move', 'basic', 'jump', 'skill', 'passive', 'ultimate', 'quirks'];

function splitPath(path) {
  return String(path)
    .split('.')
    .map((k) => (/^\d+$/.test(k) ? Number(k) : k));
}

/** Multiply every `mult` field below `node` (ability effects, nested ward behaviors / zone effects). */
function scaleMults(node, factor) {
  if (Array.isArray(node)) {
    for (const x of node) scaleMults(x, factor);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const k of Object.keys(node)) {
    if (k === 'mult' && typeof node[k] === 'number') node[k] = node[k] * factor;
    else if (node[k] && typeof node[k] === 'object') scaleMults(node[k], factor);
  }
}

function applyPathPatch(def, patch) {
  const keys = splitPath(patch.path);
  // shorthand: 'skill.mult' / 'ultimate.mult' scales every mult inside that ability's effects
  if (keys.length === 2 && keys[1] === 'mult' && (keys[0] === 'skill' || keys[0] === 'ultimate') && patch.mul != null) {
    scaleMults(def[keys[0]].effects, patch.mul);
    return;
  }
  let node = def;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (node[k] == null || typeof node[k] !== 'object') {
      if (patch.set === undefined) throw new Error(`patch path not found: ${patch.path}`);
      node[k] = typeof keys[i + 1] === 'number' ? [] : {};
    }
    node = node[k];
  }
  const leaf = keys[keys.length - 1];
  if (patch.unset) {
    if (Array.isArray(node)) node.splice(leaf, 1);
    else delete node[leaf];
  } else if (patch.set !== undefined) node[leaf] = deepCopy(patch.set);
  else if (patch.add !== undefined) node[leaf] = (node[leaf] || 0) + patch.add;
  else if (patch.mul !== undefined) node[leaf] = (node[leaf] || 0) * patch.mul;
  else throw new Error(`patch without operation: ${JSON.stringify(patch)}`);
}

function appendEffect(def, effect, to) {
  const keys = splitPath(to);
  let node = def;
  for (const k of keys) {
    if (node[k] == null) throw new Error(`effect patch target not found: ${to}`);
    node = node[k];
  }
  if (!Array.isArray(node.effects)) node.effects = [];
  node.effects.push(deepCopy(effect));
}

/** Apply constellation patches (effects.md §8) to a mutable definition copy. */
export function applyPatches(def, patches) {
  for (const p of patches) {
    if (p.path) applyPathPatch(def, p);
    else if (p.mod) def.extraMods.push(deepCopy(p.mod));
    else if (p.trigger) def.extraTriggers.push(deepCopy(p.trigger));
    else if (p.aura) def.extraAuras.push(deepCopy(p.aura));
    else if (p.effect) appendEffect(def, p.effect, p.to);
    else throw new Error(`unknown patch: ${JSON.stringify(p)}`);
  }
  return def;
}

function compile(def) {
  const triggers = [];
  const mods = [];
  const auras = [];
  const rules = {};
  const quirkActions = [];
  const addTriggers = (list, prefix) =>
    (list || []).forEach((t, i) => triggers.push({ ...t, key: `${prefix}${i}` }));
  if (def.passive) {
    addTriggers(def.passive.triggers, 'p.');
    for (const m of def.passive.mods || []) mods.push(m);
    if (def.passive.aura) auras.push(def.passive.aura);
  }
  (def.quirks || []).forEach((q, qi) => {
    addTriggers(q.triggers, `q${qi}.`);
    for (const m of q.mods || []) mods.push(m);
    if (q.aura) auras.push(q.aura);
    for (const r of q.rules || []) {
      rules[r.rule] = { ...(r.params || {}), quirkId: q.id };
      if (r.rule === 'tossAlly') {
        quirkActions.push({
          id: q.id, name: q.name, desc: q.desc, rule: 'tossAlly',
          cooldown: r.params.cooldown || 0, usesPerBattle: null, params: r.params,
          target: { shape: 'single', range: 1, los: 'adjacent', side: 'ally' },
          effects: [],
        });
      }
    }
    if (q.action) quirkActions.push({ id: q.id, name: q.name, desc: q.desc, cooldown: 0, usesPerBattle: null, ...q.action });
  });
  addTriggers(def.extraTriggers, 'x.');
  for (const m of def.extraMods) mods.push(m);
  for (const a of def.extraAuras) auras.push(a);
  def.triggers = triggers;
  def.mods = mods;
  def.auras = auras;
  def.rules = rules;
  def.quirkActions = quirkActions;
  def.roleDef = ROLES[def.role];
  // static mods (no condition / scale) used once at creation
  def.staticHpPct = mods.filter((m) => m.stat === 'hpPct' && !m.if && !m.scale).reduce((a, m) => a + m.value, 0);
  def.ultCostAdd = mods.filter((m) => m.stat === 'ultCost' && !m.if && !m.scale).reduce((a, m) => a + m.value, 0);
  return def;
}

/**
 * Compiled definition of a hero at a constellation level (0..6).
 * `variant` (optional) = { rules: { ruleName: params } } extra/overriding named rules (bosses).
 */
export function heroDef(heroId, constellation = 0, variantKey = '', variant = null) {
  const c = Math.max(0, Math.min(6, constellation | 0));
  const key = `${heroId}|${c}|${variantKey}`;
  let def = cache.get(key);
  if (def) return def;
  const hero = HERO_BY_ID[heroId];
  if (!hero) throw new Error(`Unknown hero: ${heroId}`);
  def = {};
  for (const f of MECH_FIELDS) if (hero[f] !== undefined) def[f] = deepCopy(hero[f]);
  def.extraMods = [];
  def.extraTriggers = [];
  def.extraAuras = [];
  for (const star of hero.constellations || []) if (star.c <= c) applyPatches(def, star.patches);
  compile(def);
  if (variant && variant.rules) {
    for (const [name, params] of Object.entries(variant.rules)) def.rules[name] = { ...(def.rules[name] || {}), ...params };
  }
  cache.set(key, def);
  return def;
}

/** Definition for a battle unit (reads unit.heroId / constellation / variant). */
export function unitDef(unit) {
  return heroDef(unit.heroId, unit.constellation, unit.variant ? unit.variant.key : '', unit.variant);
}
