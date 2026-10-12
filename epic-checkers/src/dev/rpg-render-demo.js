// «Валькирии доски» battle-view lab (owner: render).
//
//   dev/rpg-render-demo/index.html?scene=<scene>&bg=dawn|ash|sky&lang=ru|en&quality=high|medium|low
//        &speed=1|2&flipped=1&panel=0|1&hud=0|1&auto=1&delay=ms
//        settings overrides: &shake=0..1.5&flashes=0&camera=0&slowmo=0&cutins=0&kanji=0&particles=0.25..1.5
//                            &textTime=0.5..4&ult=full|short|first&numbers=0
//   scenes: idle · move · jump · basic · ko · awaken · turn · ward · reaction[&r=<id>] · skill-<element>
//           (flame tide frost storm gale terra radiance umbra) · ult-<heroId> (all 24) · all-skills
//
// A mocked mid-battle state + a small ability → event builder (from heroes.js shapes / effect ops) so
// every skill and every Ultimate gets a plausible event stream in the engine's documented format.
//
// window.__rv (for tools/shot.mjs): ready · run(scene) → Promise · freeze() · advance(ms) (async,
// deterministic 60 fps steps) · reset() · stats() · drawCalls() · view · renderer · fx · scenes

import { Renderer } from '../render/renderer.js';
import { Container, Sprite, Graphics } from 'pixi.js';

window.__PIXI_FOR_DEMO__ = { Container, Sprite, Graphics };
import { FX } from '../fx/fx.js';
import { BattleView } from '../rpg/render/index.js';
import { RPG_ASSETS, setRpgAssetBase } from '../rpg/assets.js';
import { playVoice } from '../rpg/voice.js';
import { HEROES, HERO_BY_ID } from '../rpg/data/heroes.js';
import { statsAt, reactionFor, ELEMENTS, ELEMENT_ORDER } from '../rpg/data/rules.js';

setRpgAssetBase('../');

const params = new URLSearchParams(location.search);
const num = (k, d) => (params.has(k) ? Number(params.get(k)) : d);
const P = {
  scene: params.get('scene') || 'idle',
  bg: params.get('bg') || null,
  lang: params.get('lang') === 'en' ? 'en' : 'ru',
  quality: params.get('quality') || 'high',
  speed: num('speed', 1),
  flipped: params.get('flipped') === '1',
  panel: params.get('panel') ? params.get('panel') !== '0' : !params.get('auto'),
  hud: params.get('hud') !== '0',
  auto: params.get('auto') === '1',
  delay: num('delay', 700),
};

const settings = {
  lang: P.lang,
  textTime: num('textTime', 1.5),
  animSpeed: 1,
  rpgVoice: true,
  voiceVolume: 0.9,
  rpgUltCinematic: params.get('ult') || 'full',
  rpgDamageNumbers: params.get('numbers') !== '0',
  fx: {
    shake: num('shake', 1),
    flashes: params.get('flashes') !== '0',
    camera: params.get('camera') !== '0',
    slowmo: params.get('slowmo') !== '0',
    cutins: params.get('cutins') !== '0',
    kanji: params.get('kanji') !== '0',
    particles: num('particles', 1),
    combo: true,
    auras: true,
    backdrop: params.get('backdrop') !== '0',
  },
};

if (!P.panel) document.body.classList.add('nopanel');
if (!P.hud) document.body.classList.add('nohud');

// ------------------------------------------------------------------------------- squares
const SQ = (name) => (8 - Number(name[1])) * 8 + (name.charCodeAt(0) - 97);
const rowOf = (q) => q >> 3;
const colOf = (q) => q & 7;
const isDark = (q) => q >= 0 && q < 64 && ((rowOf(q) + colOf(q)) & 1) === 1;
const dist = (a, b) => Math.max(Math.abs(rowOf(a) - rowOf(b)), Math.abs(colOf(a) - colOf(b)));
const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const step = (q, d, n = 1) => {
  const r = rowOf(q) + DIRS[d][0] * n;
  const c = colOf(q) + DIRS[d][1] * n;
  return r >= 0 && r < 8 && c >= 0 && c < 8 ? r * 8 + c : -1;
};
const dirTo = (a, b) => {
  const dr = Math.sign(rowOf(b) - rowOf(a));
  const dc = Math.sign(colOf(b) - colOf(a));
  return DIRS.findIndex(([r, c]) => r === dr && c === dc);
};

// ------------------------------------------------------------------------------- mock state
const SLOT = { caster: SQ('d4') };
const ALLY_SQS = ['c3', 'e3', 'b2', 'f2', 'd2'].map(SQ);
const ENEMY_SQS = ['c5', 'e5', 'b6', 'f6', 'd6', 'g7'].map(SQ);
const ENEMY_HEROES = ['kaede', 'koyuki', 'falk', 'zlata', 'lucille', 'mara'];
const ENEMY_SEALS = { c5: 'tide', e5: 'frost', f6: 'storm', d6: 'radiance', b6: 'umbra', g7: 'flame' };
const ALLY_DEFAULT = ['akane', 'vera', 'mizuha', 'maren', 'iskra', 'mashiro'];

function mkUnit(id, heroId, side, sq, o = {}) {
  const h = HERO_BY_ID[heroId];
  const lvl = o.level || 20;
  const st = statsAt(h, lvl);
  const maxEnergy = h.ultimate.cost;
  const maxHp = st.hp;
  return {
    id, heroId, side, sq, alive: true, level: lvl, role: h.role, element: h.element, rarity: h.rarity,
    hp: Math.round(maxHp * (o.hpPct != null ? o.hpPct : 1)), maxHp, atk: st.atk, def: st.def,
    energy: Math.round(maxEnergy * (o.energyPct != null ? o.energyPct : 0.45)), maxEnergy,
    statuses: (o.statuses || []).map((sid) => (typeof sid === 'string' ? { id: sid, turns: 2 } : sid)),
    seals: (o.seals || []).map((el) => ({ element: el, slot: ELEMENTS[el].slot, turns: 2 })),
    shield: o.shield || 0, awakened: !!o.awakened, reflection: !!o.reflection, boss: o.boss || null,
  };
}

function mockState(casterId = null) {
  const allies = ALLY_DEFAULT.filter((h) => h !== casterId);
  const caster = casterId || 'akane';
  const units = [];
  units.push(mkUnit('a0', caster, 1, SLOT.caster, { energyPct: 1 }));
  allies.slice(0, 5).forEach((h, i) => {
    const o = {};
    if (i === 0) o.shield = 140;
    if (i === 1) Object.assign(o, { awakened: true, statuses: ['inspire'] });
    if (i === 2) Object.assign(o, { hpPct: 0.55, energyPct: 1 });
    if (i === 3) Object.assign(o, { hpPct: 0.8, statuses: ['regen'] });
    if (i === 4) o.hpPct = 0.42;
    if (i === 1) o.statuses.push('brace');
    units.push(mkUnit(`a${i + 1}`, h, 1, ALLY_SQS[i], o));
  });
  const enemyHeroes = ENEMY_HEROES.map((h) => (h === casterId ? 'shio' : h));
  ENEMY_SQS.forEach((q, i) => {
    const name = Object.keys(ENEMY_SEALS).find((k) => SQ(k) === q);
    const o = { seals: name ? [ENEMY_SEALS[name]] : [], reflection: i % 2 === 0, energyPct: 0.3 + i * 0.1 };
    if (i === 2) o.hpPct = 0.14;
    if (i === 1) o.statuses = ['mark'];
    if (i === 3) o.statuses = ['burn', 'slow'];
    if (i === 0) o.statuses = ['frozen'];
    units.push(mkUnit(`b${i}`, enemyHeroes[i], -1, q, o));
  });
  return { side: 1, round: 5, units, wards: [], zones: [], holes: [], stage: P.bg ? { bg: `bg-${P.bg}` } : { chapter: 1 } };
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const unitAt = (S, q) => S.units.find((u) => u.alive && u.sq === q) || null;
const byId = (S, id) => S.units.find((u) => u.id === id) || S.wards.find((w) => w.id === id) || null;
const empty = (S, q) => isDark(q) && !unitAt(S, q) && !S.wards.some((w) => w.sq === q);

/** Apply an event list to a mock state (enough for the view's final sync). */
function applyMock(S0, events) {
  const S = clone(S0);
  for (const e of events) {
    const u = byId(S, e.unit || e.target);
    switch (e.type) {
      case 'damage':
        if (u) {
          u.hp = e.hp;
          if (e.shield != null) u.shield = e.shield;
        }
        break;
      case 'heal':
        if (u) u.hp = e.hp;
        break;
      case 'shield':
        if (u) u.shield = e.value;
        break;
      case 'energy':
        if (u) u.energy = e.value;
        break;
      case 'status':
        if (u && u.statuses) {
          u.statuses = u.statuses.filter((s) => s.id !== e.status);
          if (e.on) u.statuses.push({ id: e.status, turns: e.turns || 1 });
        }
        break;
      case 'seal':
        if (u) u.seals = (e.seals || []).map((el) => ({ element: el, slot: ELEMENTS[el].slot, turns: 2 }));
        break;
      case 'move':
      case 'displace':
      case 'jump':
        if (u) u.sq = e.to;
        break;
      case 'ko':
        if (u) {
          u.alive = false;
          u.sq = -1;
          u.hp = 0;
        }
        break;
      case 'awaken':
        if (u) u.awakened = true;
        break;
      case 'revive':
        if (u) {
          u.alive = true;
          u.sq = e.sq;
          u.hp = e.hp;
        }
        break;
      case 'ward':
        if (e.on) S.wards.push({ id: e.id, kind: e.kind, sq: e.sq, owner: e.owner, side: e.side, hp: e.hp, maxHp: e.maxHp || e.hp, isWard: true });
        else S.wards = S.wards.filter((w) => w.id !== e.id);
        break;
      case 'zone':
        S.zones = S.zones.filter((z) => z.id !== e.id);
        if (e.on) S.zones.push({ id: e.id, kind: e.kind, sqs: e.sqs, owner: e.owner, side: e.side, turns: e.turns });
        break;
      case 'turnStart':
        S.side = e.side;
        if (e.round) S.round = e.round;
        break;
      default:
        break;
    }
  }
  return S;
}

// ------------------------------------------------------------------------------- ability → events
let seq = 100;
function sealsAfter(u) {
  return (u.seals || []).map((s) => s.element);
}

function hitEvents(S, src, tgt, { mult = 1, element, kind = 'hit', label, forceCrit } = {}) {
  const ev = [];
  const el = element || src.element;
  const crit = forceCrit != null ? forceCrit : kind === 'hit' && Math.random() < 0.22;
  let amount = Math.max(1, Math.round(src.atk * mult * (0.82 + Math.random() * 0.22) * (crit ? 1.5 : 1)));
  let reaction = null;
  let sealEl = null;
  if (kind === 'hit' && !tgt.isWard && ELEMENTS[el]) {
    const seal = (tgt.seals || []).find((s) => s.slot === ELEMENTS[el].slot);
    if (seal) {
      reaction = reactionFor(el, seal.element);
      sealEl = seal.element;
    }
  }
  if (reaction === 'steam') amount = Math.round(amount * 1.5);
  if (reaction === 'eclipse') amount = Math.round(amount * 2);
  const absorbed = Math.min(tgt.shield || 0, amount);
  tgt.shield = (tgt.shield || 0) - absorbed;
  tgt.hp = Math.max(0, tgt.hp - (amount - absorbed));
  ev.push({ type: 'damage', source: src.id, target: tgt.id, amount, crit, element: el, reaction: reaction || undefined, absorbed, hp: tgt.hp, shield: tgt.shield || 0, kind: label || kind, ward: tgt.isWard || undefined });
  if (tgt.isWard) return ev;
  if (tgt.hp > 0) ev.push({ type: 'energy', unit: tgt.id, value: Math.min(tgt.maxEnergy, tgt.energy + 6), max: tgt.maxEnergy, delta: 6, reason: 'hit' });
  if (reaction) {
    ev.push({ type: 'reaction', target: tgt.id, reaction, elements: [el, sealEl], source: src.id });
    tgt.seals = tgt.seals.filter((s) => s.element !== sealEl);
    ev.push({ type: 'seal', target: tgt.id, element: null, slot: ELEMENTS[sealEl].slot, removed: sealEl, reason: 'reaction', seals: sealsAfter(tgt) });
    if (reaction === 'arc') {
      const near = S.units.filter((x) => x.alive && x.side === tgt.side && x !== tgt && dist(x.sq, tgt.sq) <= 2).slice(0, 2);
      for (const n of near) {
        ev.push({ type: 'arc', from: tgt.sq, to: n.sq, target: n.id });
        ev.push(...hitEvents(S, src, n, { mult: 0.5, element: 'storm', kind: 'reaction', label: 'reaction', forceCrit: false }));
      }
    }
    if (reaction === 'shackles' && tgt.hp > 0) ev.push({ type: 'status', target: tgt.id, status: 'frozen', turns: 1, on: true, source: src.id });
    if (reaction === 'brittle' && tgt.hp > 0) ev.push({ type: 'status', target: tgt.id, status: 'brittle', turns: 2, on: true, source: src.id });
    if (reaction === 'eclipse' && tgt.hp > 0) ev.push({ type: 'status', target: tgt.id, status: 'silence', turns: 1, on: true, source: src.id });
    if (reaction === 'facet') ev.push({ type: 'shield', target: src.id, amount: Math.round(src.maxHp * 0.15), value: Math.round(src.maxHp * 0.15), gained: Math.round(src.maxHp * 0.15), source: src.id });
  } else if (tgt.hp > 0 && ELEMENTS[el] && ELEMENTS[el].leavesSeal && kind === 'hit') {
    tgt.seals = (tgt.seals || []).filter((s) => s.slot !== ELEMENTS[el].slot).concat([{ element: el, slot: ELEMENTS[el].slot }]);
    ev.push({ type: 'seal', target: tgt.id, element: el, slot: ELEMENTS[el].slot, turns: 2, seals: sealsAfter(tgt) });
  }
  if (tgt.hp <= 0) {
    tgt.alive = false;
    ev.push({ type: 'ko', unit: tgt.id, sq: tgt.sq, by: src.id });
    tgt.sq = -1;
  }
  return ev;
}

/** Squares covered by an ability shape from the caster (pick = a target square when the player picks). */
function cover(S, caster, shape, pick) {
  const out = [];
  const c = caster.sq;
  switch (shape.shape) {
    case 'self':
      return [c];
    case 'single':
      return pick != null ? [pick] : [];
    case 'line':
    case 'lines': {
      const dirs = shape.shape === 'lines' ? pickDirs(S, caster, shape.dirs || 2) : [pick != null ? dirTo(c, pick) : bestDir(S, caster)];
      for (const d of dirs) {
        if (d < 0) continue;
        for (let k = 1; k <= (shape.length || 3); k++) {
          const q = step(c, d, k);
          if (q < 0) break;
          out.push(q);
          if (!shape.pierce && unitAt(S, q)) break;
        }
      }
      return out;
    }
    case 'diagonals': {
      const center = shape.center === 'target' && pick != null ? pick : c;
      for (let d = 0; d < 4; d++) for (let k = 1; k <= (shape.length || 7); k++) {
        const q = step(center, d, k);
        if (q < 0) break;
        out.push(q);
      }
      return out;
    }
    case 'radius': {
      const center = shape.center === 'caster' || pick == null ? c : pick;
      for (let q = 0; q < 64; q++) if (isDark(q) && dist(q, center) <= shape.r && (shape.includeCenter !== false || q !== center)) out.push(q);
      return out;
    }
    case 'cross': {
      const center = pick != null ? pick : c;
      out.push(center);
      for (let k = 1; k <= (shape.length || 1); k++) {
        for (const [dr, dc] of [[0, 2 * k], [0, -2 * k], [2 * k, 0], [-2 * k, 0]]) {
          const r = rowOf(center) + dr;
          const cc = colOf(center) + dc;
          if (r >= 0 && r < 8 && cc >= 0 && cc < 8) out.push(r * 8 + cc);
        }
      }
      return out;
    }
    case 'row': {
      const r = pick != null ? rowOf(pick) : 2;
      for (let cc = 0; cc < 8; cc++) if (isDark(r * 8 + cc)) out.push(r * 8 + cc);
      return out;
    }
    case 'all':
      return S.units.filter((u) => u.alive).map((u) => u.sq);
    case 'square': {
      const center = pick != null ? pick : c;
      const cands = [];
      for (let q = 0; q < 64; q++) if (empty(S, q) && dist(q, c) <= (shape.range || 1) && q !== c) cands.push(q);
      cands.sort((a, b) => dist(a, center) - dist(b, center));
      return cands.slice(0, shape.count || 1);
    }
    case 'auto':
      return S.units.filter((u) => u.alive && u.side === caster.side).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp).slice(0, shape.count || 1).map((u) => u.sq);
    default:
      return pick != null ? [pick] : [];
  }
}

function bestDir(S, caster) {
  let best = 0;
  let bestN = -1;
  for (let d = 0; d < 4; d++) {
    let n = 0;
    for (let k = 1; k <= 7; k++) {
      const q = step(caster.sq, d, k);
      if (q < 0) break;
      const u = unitAt(S, q);
      if (u && u.side !== caster.side) n++;
    }
    if (n > bestN) {
      bestN = n;
      best = d;
    }
  }
  return best;
}

function pickDirs(S, caster, n) {
  const scored = [0, 1, 2, 3].map((d) => {
    let s = 0;
    for (let k = 1; k <= 7; k++) {
      const q = step(caster.sq, d, k);
      if (q < 0) break;
      const u = unitAt(S, q);
      if (u) {
        if (u.side !== caster.side) s++;
        break;
      }
    }
    return { d, s };
  });
  return scored.sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.d);
}

function sideOk(caster, u, side) {
  if (!u) return false;
  if (side === 'enemy') return u.side !== caster.side;
  if (side === 'ally') return u.side === caster.side && u !== caster;
  if (side === 'allyOrSelf') return u.side === caster.side;
  return true;
}

/** Events of one ability (skill / ult) cast by `caster` (mutates the working state S). */
function abilityEvents(S, caster, ab, kind, pick) {
  const ev = [];
  const shape = ab.target || { shape: 'self' };
  const covered = cover(S, caster, shape, pick);
  ev.push({ type: 'cast', unit: caster.id, kind, abilityId: ab.id, element: caster.element, target: pick != null ? pick : covered[0], area: covered });
  if (kind === 'ult') {
    ev.push({ type: 'energy', unit: caster.id, value: 0, max: caster.maxEnergy, delta: -caster.energy, reason: 'ult' });
    caster.energy = 0;
  }
  const side = shape.side || 'enemy';
  const inShape = covered.map((q) => unitAt(S, q)).filter(Boolean);
  const kos = [];
  for (const op of ab.effects) {
    const who = op.who || 'targets';
    let recv;
    if (who === 'self') recv = [caster];
    else if (who === 'alliesInShape') recv = inShape.filter((u) => u.side === caster.side && u !== caster);
    else if (who === 'enemiesInShape') recv = inShape.filter((u) => u.side !== caster.side);
    else if (who === 'allAllies') recv = S.units.filter((u) => u.alive && u.side === caster.side);
    else if (who === 'allEnemies') recv = S.units.filter((u) => u.alive && u.side !== caster.side);
    else recv = inShape.filter((u) => sideOk(caster, u, side));
    recv = recv.filter((u) => u.alive);
    switch (op.op) {
      case 'damage':
        for (const r of recv) ev.push(...hitEvents(S, caster, r, { mult: op.mult || 1, element: op.element && op.element !== 'self' ? op.element : caster.element }));
        break;
      case 'trueDamage':
        for (const r of recv) ev.push(...hitEvents(S, caster, r, { mult: op.mult || 1, kind: 'true', label: 'true' }));
        break;
      case 'volley': {
        const tg = recv.filter((u) => u.side !== caster.side);
        for (let i = 0; i < (op.hits || 3) && tg.length; i++) {
          const t = tg[i % tg.length];
          if (!t.alive) continue;
          ev.push(...hitEvents(S, caster, t, { mult: op.mult || 0.6 }));
        }
        break;
      }
      case 'bounce': {
        let prev = recv[0] || inShape.find((u) => u.side !== caster.side);
        const hit = new Set(prev ? [prev.id] : []);
        for (let i = 0; i < (op.count || 2) && prev; i++) {
          const next = S.units.filter((u) => u.alive && u.side !== caster.side && !hit.has(u.id) && dist(u.sq, prev.sq) <= (op.range || 2)).sort((a, b) => dist(a.sq, prev.sq) - dist(b.sq, prev.sq))[0];
          if (!next) break;
          hit.add(next.id);
          ev.push({ type: 'bounce', from: prev.sq, to: next.sq, target: next.id, source: caster.id });
          ev.push(...hitEvents(S, caster, next, { mult: op.mult || 1 }));
          prev = next;
        }
        break;
      }
      case 'heal':
        for (const r of recv.length ? recv : []) {
          const amt = Math.round(op.pctMaxHp ? r.maxHp * op.pctMaxHp : caster.atk * (op.mult || 1));
          r.hp = Math.min(r.maxHp, r.hp + amt);
          ev.push({ type: 'heal', source: caster.id, target: r.id, amount: amt, hp: r.hp });
        }
        break;
      case 'shield':
        for (const r of recv) {
          const v = Math.round(op.pctMaxHp ? r.maxHp * op.pctMaxHp : op.pctCasterMaxHp ? caster.maxHp * op.pctCasterMaxHp : caster.atk * (op.mult || 1));
          r.shield = Math.max(r.shield || 0, v);
          ev.push({ type: 'shield', target: r.id, amount: v, value: r.shield, gained: v, source: caster.id, turns: 2 });
        }
        break;
      case 'status':
        for (const r of recv) if (r.alive) {
          r.statuses = (r.statuses || []).filter((s) => s.id !== op.id).concat([{ id: op.id, turns: op.turns || 1 }]);
          ev.push({ type: 'status', target: r.id, status: op.id, turns: op.turns || 1, on: true, source: caster.id });
        }
        break;
      case 'seal':
        for (const r of recv) {
          r.seals = (r.seals || []).filter((s) => s.slot !== ELEMENTS[op.element].slot).concat([{ element: op.element, slot: ELEMENTS[op.element].slot }]);
          ev.push({ type: 'seal', target: r.id, element: op.element, slot: ELEMENTS[op.element].slot, turns: 2, seals: sealsAfter(r) });
        }
        break;
      case 'energy':
        for (const r of recv) {
          const v = Math.max(0, Math.min(r.maxEnergy, r.energy + (op.amount || 0)));
          ev.push({ type: 'energy', unit: r.id, value: v, max: r.maxEnergy, delta: v - r.energy, reason: op.amount < 0 ? 'drain' : 'effect' });
          r.energy = v;
        }
        break;
      case 'cleanse':
      case 'dispel':
        for (const r of recv) {
          const st = (r.statuses || [])[0];
          if (!st) continue;
          r.statuses = r.statuses.slice(1);
          ev.push({ type: 'status', target: r.id, status: st.id, turns: 0, on: false, reason: op.op });
        }
        break;
      case 'push':
      case 'pull':
        for (const r of recv) {
          if (!r.alive) continue;
          const d = op.op === 'push' ? dirTo(caster.sq, r.sq) : dirTo(r.sq, caster.sq);
          const to = d >= 0 ? step(r.sq, d, 1) : -1;
          if (to >= 0 && empty(S, to)) {
            ev.push({ type: 'displace', unit: r.id, from: r.sq, to, kind: op.op });
            r.sq = to;
          } else {
            ev.push({ type: 'collision', unit: r.id, sq: r.sq });
            ev.push(...hitEvents(S, caster, r, { mult: 0.3, kind: 'true', label: 'collision' }));
          }
        }
        break;
      case 'moveSelf': {
        const line = covered.filter((q) => empty(S, q));
        const to = op.to === 'lineEnd' ? line[line.length - 1] : covered.map((q) => [0, 1, 2, 3].map((d) => step(q, d))).flat().find((q) => q >= 0 && empty(S, q));
        if (to != null && to >= 0) {
          ev.push({ type: 'displace', unit: caster.id, from: caster.sq, to, kind: 'moveSelf' });
          caster.sq = to;
        }
        break;
      }
      case 'zone':
        ev.push({ type: 'zone', id: `z${seq++}`, kind: op.id, sqs: covered.slice(0, 7), owner: caster.id, side: caster.side, turns: op.turns || 2, on: true });
        break;
      case 'ward':
        for (const q of covered) {
          if (!empty(S, q)) continue;
          const hp = Math.round(caster.maxHp * (op.hpPct || 0.2));
          const w = { id: `w${seq++}`, kind: op.id, sq: q, owner: caster.id, side: caster.side, hp, maxHp: hp, isWard: true };
          S.wards.push(w);
          ev.push({ type: 'ward', id: w.id, kind: w.kind, sq: q, owner: caster.id, side: caster.side, hp, maxHp: hp, turns: op.turns || 2, on: true });
        }
        break;
      case 'revive': {
        const dead = S.units.find((u) => !u.alive && u.side === caster.side);
        if (dead) {
          const q = [SQ('a1'), SQ('c1'), SQ('e1'), SQ('g1')].find((x) => empty(S, x));
          dead.alive = true;
          dead.sq = q;
          dead.hp = Math.round(dead.maxHp * (op.hpPct || 0.4));
          ev.push({ type: 'revive', unit: dead.id, sq: q, hp: dead.hp, energy: 0, source: caster.id });
        }
        break;
      }
      case 'execute':
        for (const r of recv) if (r.alive && r.hp <= r.maxHp * (op.hpPct || 0.3)) {
          ev.push({ type: 'execute', unit: r.id, source: caster.id, hp: 0 });
          r.alive = false;
          ev.push({ type: 'ko', unit: r.id, sq: r.sq, by: caster.id });
          kos.push(r);
        }
        break;
      case 'swap': {
        const r = recv[0];
        if (r) {
          ev.push({ type: 'displace', unit: caster.id, from: caster.sq, to: r.sq, kind: 'swap' }, { type: 'displace', unit: r.id, from: r.sq, to: caster.sq, kind: 'swap' });
          [caster.sq, r.sq] = [r.sq, caster.sq];
        }
        break;
      }
      default:
        break;
    }
  }
  if (kind !== 'ult') {
    ev.push({ type: 'energy', unit: caster.id, value: Math.min(caster.maxEnergy, caster.energy + 25), max: caster.maxEnergy, delta: 25, reason: 'action' });
    caster.energy = Math.min(caster.maxEnergy, caster.energy + 25);
  }
  return ev;
}

/** A sensible target square for an ability in the mock formation. */
function pickFor(S, caster, ab) {
  const t = ab.target || {};
  const enemies = S.units.filter((u) => u.alive && u.side !== caster.side);
  const allies = S.units.filter((u) => u.alive && u.side === caster.side);
  if (t.side === 'ally' || t.side === 'allyOrSelf') return (allies.find((u) => u !== caster) || caster).sq;
  if (t.shape === 'single' && t.los === 'adjacent') return (enemies.find((u) => dist(u.sq, caster.sq) === 1) || enemies[0]).sq;
  if (t.shape === 'single') return (enemies.find((u) => u.sq === SQ('d6')) || enemies[0]).sq;
  if (t.shape === 'cross') return SQ('d6');
  if (t.shape === 'row') return SQ('d6');
  if (t.shape === 'radius' && t.center !== 'caster') return SQ('e5');
  if (t.shape === 'square') return SQ('d6');
  return null;
}

// ------------------------------------------------------------------------------- scenes
const SKILL_CASTER = { flame: 'akane', tide: 'maren', frost: 'koyuki', storm: 'reika', gale: 'kaede', terra: 'falk', radiance: 'liora', umbra: 'nocturna' };

function sceneUlt(heroId) {
  const S0 = mockState(heroId);
  const S = clone(S0);
  const caster = S.units.find((u) => u.heroId === heroId && u.side === 1);
  if (heroId === 'lucille') {
    const victim = S.units.find((u) => u.id === 'a5');
    victim.alive = false;
    victim.sq = -1;
    victim.hp = 0;
    S0.units.find((u) => u.id === 'a5').alive = false;
    S0.units.find((u) => u.id === 'a5').sq = -1;
  }
  const ab = HERO_BY_ID[heroId].ultimate;
  const events = abilityEvents(S, caster, ab, 'ult', pickFor(S, caster, ab));
  return { start: S0, events };
}

function sceneSkill(el) {
  const heroId = SKILL_CASTER[el] || 'akane';
  const S0 = mockState(heroId);
  const S = clone(S0);
  const caster = S.units.find((u) => u.heroId === heroId && u.side === 1);
  const ab = HERO_BY_ID[heroId].skill;
  const events = abilityEvents(S, caster, ab, 'skill', pickFor(S, caster, ab));
  return { start: S0, events };
}

function sceneMove() {
  const S0 = mockState('akane');
  // a Blade's two steps: d4 → e3 → f4 (the ally on e3 steps aside for the demo)
  S0.units = S0.units.filter((u) => u.sq !== SQ('e3'));
  const from = SLOT.caster;
  const to = SQ('f4');
  const events = [
    { type: 'move', unit: 'a0', from, to, path: [from, SQ('e3'), to] },
    { type: 'energy', unit: 'a0', value: 70, max: 70, delta: 10, reason: 'move' },
  ];
  return { start: S0, events };
}

function sceneJump() {
  const S0 = mockState('akane');
  // free the landing squares for a 3-hop Blade chain: d4 → f6 (over e5) → h8? keep: d4 → f6 → d8 (over e7? none)
  S0.units = S0.units.filter((u) => ![SQ('f6'), SQ('g7')].includes(u.sq));
  const e5 = S0.units.find((u) => u.sq === SQ('e5'));
  e5.hp = Math.round(e5.maxHp * 0.3);
  const S = clone(S0);
  const akane = S.units.find((u) => u.id === 'a0');
  akane.energy = 20;
  S0.units.find((u) => u.id === 'a0').energy = 20;
  const events = [];
  // hop 1: d4 → f6 over e5 (frost seal → steam)
  events.push({ type: 'jump', unit: 'a0', from: SQ('d4'), to: SQ('f6'), over: SQ('e5'), victim: e5.id, hop: 1 });
  events.push(...hitEvents(S, akane, S.units.find((u) => u.id === e5.id), { mult: 1.4, forceCrit: false }));
  akane.sq = SQ('f6');
  // hop 2: f6 → d8 over e7? place an enemy on e7
  const e7 = mkUnit('b9', 'karasu', -1, SQ('e7'), { reflection: true, hpPct: 0.9 });
  S0.units.push(clone(e7));
  S.units.push(e7);
  events.push({ type: 'jump', unit: 'a0', from: SQ('f6'), to: SQ('d8'), over: SQ('e7'), victim: 'b9', hop: 2 });
  events.push(...hitEvents(S, akane, e7, { mult: 1.6, forceCrit: true }));
  akane.sq = SQ('d8');
  events.push({ type: 'awaken', unit: 'a0', sq: SQ('d8'), full: true });
  events.push({ type: 'energy', unit: 'a0', value: 70, max: 70, delta: 50, reason: 'awaken' });
  return { start: S0, events };
}

function sceneBasic() {
  const S0 = mockState('akane');
  const S = clone(S0);
  const maren = S.units.find((u) => u.heroId === 'maren');
  const events = [];
  // ranged basic: maren (b4? she stands on f2) → shoots along a diagonal: place her on b4 → c5
  maren.sq = SQ('b4');
  S0.units.find((u) => u.heroId === 'maren').sq = SQ('b4');
  const c5 = S.units.find((u) => u.sq === SQ('c5'));
  events.push({ type: 'cast', unit: maren.id, kind: 'basic', element: 'tide', target: c5.sq });
  events.push(...hitEvents(S, maren, c5, { mult: 0.9 }));
  // melee basic: akane → e5
  const ak = S.units.find((u) => u.id === 'a0');
  const e5 = S.units.find((u) => u.sq === SQ('e5'));
  events.push({ type: 'turnEnd', side: 1 });
  events.push({ type: 'cast', unit: ak.id, kind: 'basic', element: 'flame', target: e5.sq });
  events.push(...hitEvents(S, ak, e5, { mult: 1, forceCrit: true }));
  return { start: S0, events };
}

function sceneKo() {
  const S0 = mockState('akane');
  const S = clone(S0);
  const ak = S.units.find((u) => u.id === 'a0');
  const c5 = S.units.find((u) => u.sq === SQ('c5'));
  c5.hp = 40;
  S0.units.find((u) => u.sq === SQ('c5')).hp = 40;
  const events = [{ type: 'cast', unit: ak.id, kind: 'basic', element: 'flame', target: c5.sq }, ...hitEvents(S, ak, c5, { mult: 1.2, forceCrit: true })];
  return { start: S0, events };
}

function sceneAwaken() {
  const S0 = mockState('akane');
  S0.units = S0.units.filter((u) => u.sq !== SQ('c7') && u.sq !== SQ('b8'));
  const vera = S0.units.find((u) => u.heroId === 'vera');
  vera.awakened = false;
  vera.statuses = [];
  vera.sq = SQ('c7');
  return { start: S0, events: [{ type: 'move', unit: vera.id, from: SQ('c7'), to: SQ('b8'), path: [SQ('c7'), SQ('b8')] }, { type: 'awaken', unit: vera.id, sq: SQ('b8'), full: true }, { type: 'energy', unit: vera.id, value: 60, max: 60, delta: 50, reason: 'awaken' }] };
}

function sceneTurn() {
  const S0 = mockState('akane');
  S0.wards.push({ id: 'w1', kind: 'ball-lightning', sq: SQ('h4'), owner: 'a0', side: 1, hp: 300, maxHp: 300, isWard: true });
  const S = clone(S0);
  const f6 = S.units.find((u) => u.sq === SQ('f6'));
  const d6 = S.units.find((u) => u.sq === SQ('d6'));
  const allyRegen = S.units.find((u) => (u.statuses || []).some((s) => s.id === 'regen'));
  const events = [{ type: 'turnStart', side: -1, round: 6 }];
  f6.hp -= 90;
  events.push({ type: 'damage', source: 'a0', target: f6.id, amount: 90, crit: false, element: 'none', absorbed: 0, hp: f6.hp, shield: 0, kind: 'burn' });
  d6.hp -= 160;
  events.push({ type: 'damage', source: 'w1', target: d6.id, amount: 160, crit: false, element: 'storm', absorbed: 0, hp: d6.hp, shield: 0, kind: 'hit' });
  allyRegen.hp = Math.min(allyRegen.maxHp, allyRegen.hp + 110);
  events.push({ type: 'heal', source: allyRegen.id, target: allyRegen.id, amount: 110, hp: allyRegen.hp, reason: 'regen' });
  return { start: S0, events };
}

function sceneWard() {
  const S0 = mockState('fuyuka');
  const S = clone(S0);
  const fu = S.units.find((u) => u.heroId === 'fuyuka');
  const events = abilityEvents(S, fu, HERO_BY_ID.fuyuka.skill, 'skill', SQ('d6'));
  const volta = mkUnit('a9', 'volta', 1, SQ('h2'), {});
  S0.units.push(clone(volta));
  S.units.push(volta);
  events.push({ type: 'turnEnd', side: 1 }, ...abilityEvents(S, volta, HERO_BY_ID.volta.skill, 'skill', SQ('h6')));
  return { start: S0, events };
}

const REACTION_PLAN = [
  ['steam', 'akane', 'c5'],
  ['detonation', 'akane', 'f6'],
  ['shackles', 'maren', 'e5'],
  ['arc', 'reika', 'c5'],
  ['brittle', 'koyuki', 'f6'],
  ['vortex', 'kaede', 'c5'],
  ['facet', 'falk', 'e5'],
  ['eclipse', 'nocturna', 'd6'],
];

function sceneReaction(only) {
  const plan = only ? REACTION_PLAN.filter((p) => p[0] === only) : REACTION_PLAN;
  const S0 = mockState('akane');
  for (const [, hero] of plan) {
    if (!S0.units.some((u) => u.heroId === hero && u.side === 1)) {
      const free = ['a3', 'c1', 'e1', 'g1', 'h2', 'a1'].map((n) => SQ(n === 'a3' ? 'a3' : n)).find((q) => !S0.units.some((u) => u.sq === q));
      S0.units.push(mkUnit(`r${hero}`, hero, 1, free, {}));
    }
  }
  const S = clone(S0);
  const events = [];
  for (const [rid, hero, target] of plan) {
    const src = S.units.find((u) => u.heroId === hero && u.side === 1);
    const tgt = S.units.find((u) => u.alive && u.sq === SQ(target)) || S.units.find((u) => u.alive && u.side === -1);
    if (!src || !tgt) continue;
    const R = { steam: ['flame', 'tide'], detonation: ['flame', 'storm'], shackles: ['tide', 'frost'], arc: ['storm', 'tide'], brittle: ['frost', 'storm'], vortex: ['gale', 'flame'], facet: ['terra', 'tide'], eclipse: ['umbra', 'radiance'] }[rid];
    tgt.seals = [{ element: R[1], slot: ELEMENTS[R[1]].slot }];
    tgt.hp = Math.max(tgt.hp, Math.round(tgt.maxHp * 0.9));
    events.push({ type: 'seal', target: tgt.id, element: R[1], slot: ELEMENTS[R[1]].slot, turns: 2, seals: [R[1]] });
    events.push({ type: 'cast', unit: src.id, kind: 'basic', element: R[0], target: tgt.sq });
    events.push(...hitEvents(S, src, tgt, { mult: 0.45, element: R[0], forceCrit: false }));
    events.push({ type: 'turnEnd', side: 1 });
  }
  return { start: S0, events };
}

function sceneIdle() {
  const S0 = mockState('liora');
  S0.zones.push({ id: 'z1', kind: 'phoenix-trail', sqs: [SQ('a5'), SQ('b4')], owner: 'a0', side: 1, turns: 2 });
  S0.wards.push({ id: 'w1', kind: 'ice-wall', sq: SQ('h4'), owner: 'a1', side: 1, hp: 400, maxHp: 400, isWard: true });
  return { start: S0, events: [] };
}

export function buildScene(name) {
  if (name.startsWith('ult-')) return sceneUlt(name.slice(4));
  if (name.startsWith('skill-')) return sceneSkill(name.slice(6));
  switch (name) {
    case 'move':
      return sceneMove();
    case 'jump':
      return sceneJump();
    case 'basic':
      return sceneBasic();
    case 'ko':
      return sceneKo();
    case 'awaken':
      return sceneAwaken();
    case 'turn':
      return sceneTurn();
    case 'ward':
      return sceneWard();
    case 'reaction':
      return sceneReaction(params.get('r'));
    default:
      return sceneIdle();
  }
}

const SCENES = ['idle', 'move', 'jump', 'basic', 'ko', 'awaken', 'turn', 'ward', 'reaction', ...ELEMENT_ORDER.map((e) => `skill-${e}`), ...HEROES.map((h) => `ult-${h.id}`)];

// ------------------------------------------------------------------------------- app
const stage = document.getElementById('stage');
const slot = document.getElementById('board-slot');

function boardRect() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const top = P.hud ? 112 : 16;
  const bottom = P.hud ? 200 : 16;
  const side = Math.min(w - 12, h - top - bottom);
  const x = Math.round((w - side) / 2);
  const y = Math.round(top + (h - top - bottom - side) / 2);
  Object.assign(slot.style, { left: `${x}px`, top: `${y}px`, width: `${side}px`, height: `${side}px` });
  return { x, y, width: side, height: side };
}

const renderer = new Renderer(stage);
let fx = null;
let view = null;
let current = null;
let frozen = false;

async function run(name) {
  const sc = buildScene(name);
  current = { name, ...sc };
  view.setState(sc.start);
  const final = applyMock(sc.start, sc.events);
  await view.play(sc.events, { state: final });
  return true;
}

function reset() {
  const sc = buildScene(current ? current.name : P.scene);
  view.setState(sc.start);
}

async function advance(ms, stepMs = 1000 / 60, render = true) {
  const t = renderer.app.ticker;
  const n = Math.max(1, Math.round(ms / stepMs));
  for (let i = 0; i < n; i++) {
    renderer._tick({ deltaMS: stepMs });
    // let promise continuations (choreography awaits) run between frames
    for (let j = 0; j < 4; j++) await null;
  }
  if (render) {
    t.update(t.lastTime + stepMs);
    renderer.app.render();
  }
  return view.stats ? view.stats() : true;
}

function drawCalls() {
  const gl = renderer.app.renderer.gl;
  if (!gl) return -1;
  let n = 0;
  const de = gl.drawElements;
  const da = gl.drawArrays;
  gl.drawElements = function (...a) {
    n++;
    return de.apply(this, a);
  };
  gl.drawArrays = function (...a) {
    n++;
    return da.apply(this, a);
  };
  try {
    renderer.app.render();
  } finally {
    gl.drawElements = de;
    gl.drawArrays = da;
  }
  return n;
}

function buildPanel() {
  const panel = document.getElementById('panel');
  for (const s of SCENES) {
    const b = document.createElement('button');
    b.textContent = s;
    b.onclick = () => run(s);
    panel.appendChild(b);
  }
  const sk = document.createElement('button');
  sk.textContent = 'skip';
  sk.onclick = () => view.skip();
  panel.appendChild(sk);
}

(async () => {
  await renderer.init({ quality: P.quality });
  renderer.setTheme('epic');
  fx = new FX({ renderer, quality: P.quality, mode: 'epic' });
  fx.applySettings(settings);
  fx.setLang(P.lang);
  await fx.preload(['覚醒', '撃破', '光', '皇蝕']);
  view = new BattleView({ renderer, fx, audio: null, native: null, settings, assets: RPG_ASSETS, voice: playVoice });
  await view.init();
  view.show();
  view.setSpeed(P.speed);
  view.setFlipped(P.flipped);
  view.setBoardRect(boardRect());
  if (P.bg) view.setBackground(`bg-${P.bg}`);
  window.addEventListener('resize', () => view.setBoardRect(boardRect()));
  view.onTap(({ sq, unitId }) => {
    if (view.busy) view.skip();
    else if (unitId) view.highlight({ selected: unitId, moves: [], targets: [sq] });
  });
  const sc = buildScene(P.scene);
  current = { name: P.scene, ...sc };
  view.setState(sc.start);
  if (P.panel) buildPanel();
  window.__rv = {
    ready: true,
    view,
    renderer,
    fx,
    scenes: SCENES,
    run,
    reset,
    advance,
    drawCalls,
    freeze: () => {
      frozen = true;
      renderer.app.ticker.stop();
      return true;
    },
    unfreeze: () => {
      frozen = false;
      renderer.app.ticker.start();
      return true;
    },
    stats: () => view.stats(),
    /** Run a scene on a frozen clock (60 fps steps) to completion: { scene, ms, ok, errors }. */
    runTimed: async (name, maxMs = 12000) => {
      const errors = [];
      const onErr = (e) => errors.push(String(e && (e.message || e.reason || e)));
      window.addEventListener('error', onErr);
      const origErr = console.error;
      console.error = (...a) => {
        errors.push(a.map((x) => (x && x.stack ? x.stack.split('\n').slice(0, 2).join(' ') : String(x))).join(' '));
        origErr.apply(console, a);
      };
      frozen = true;
      renderer.app.ticker.stop();
      let done = false;
      const p = run(name).then(() => (done = true));
      let ms = 0;
      while (!done && ms < maxMs) {
        await advance(50, 1000 / 60, false);
        ms += 50;
      }
      await p.catch(() => {});
      // let lingering effects end
      await advance(1500, 1000 / 60, false);
      console.error = origErr;
      window.removeEventListener('error', onErr);
      return { scene: name, ms, ok: done, errors: errors.slice(0, 5), stats: view.stats() };
    },
    /** Debug: every icon-atlas frame in a grid (screen space), to review the procedural art. */
    iconSheet: (filter = '') => {
      const { Container, Sprite, Graphics } = window.__PIXI_FOR_DEMO__;
      const root = new Container();
      const bg = new Graphics().rect(0, 0, window.innerWidth, window.innerHeight).fill({ color: 0x202030 });
      root.addChild(bg);
      const names = Object.keys(view.icons.frames).filter((n) => n.includes(filter));
      const cell = 46;
      const cols = Math.floor(window.innerWidth / cell);
      names.forEach((n, i) => {
        const sp = new Sprite(view.icons.frame(n));
        sp.anchor.set(0.5);
        const t = sp.texture.orig;
        const k = Math.min((cell - 6) / t.width, (cell - 6) / t.height);
        sp.scale.set(k);
        sp.position.set((i % cols) * cell + cell / 2, Math.floor(i / cols) * cell + cell / 2 + 4);
        root.addChild(sp);
      });
      renderer.layers.overlay.addChild(root);
      return names.length;
    },
    highlightDemo: () => {
      view.highlight({ selectable: ['a0', 'a1', 'a2'], selected: 'a0', moves: [SQ('a5'), SQ('b4')].filter((q) => !view.occupied(q)), jumps: [[SQ('f6')]], targets: [SQ('c5')], area: [SQ('d6'), SQ('b6'), SQ('f6')] });
      view.preview([{ unitId: 'b1', amount: 642, reaction: 'steam' }, { unitId: 'b2', amount: 300, ko: true }]);
      return true;
    },
    get frozen() {
      return frozen;
    },
  };
  if (P.auto) {
    await new Promise((r) => setTimeout(r, P.delay));
    window.__rv.autoPromise = run(P.scene);
  }
})();
