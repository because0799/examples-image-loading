// «Валькирии доски» — battle event -> short log lines for the HUD (pure; uses the UI strings).
//
//   describeEvents(events, { state, playerSide = 1 }) -> [{ text, tone, side, key }]
//
// One activation produces a handful of lines, not one per event: the headline (cast / chain / wait),
// then reactions, KOs and awakenings as they happen, and a damage / heal summary at the end.
// tone: 'cast' | 'ult' | 'reaction' | 'ko' | 'awaken' | 'damage' | 'heal' | 'info'.
// side: the acting side (1 | -1) so the HUD can colour the line.

import { REACTIONS, KANJI, getHero, unitById } from './model.js';
import { rt, L, fmt } from './i18n.js';

function unitName(state, unitId, cache) {
  if (unitId == null) return '';
  if (cache && cache[unitId]) return cache[unitId];
  const u = unitById(state, unitId);
  const hero = u ? getHero(u.heroId) : null;
  const name = hero ? L(hero.name) : u && u.name ? L(u.name) : String(unitId);
  if (cache) cache[unitId] = name;
  return name;
}

function isMale(state, unitId) {
  const u = unitById(state, unitId);
  const hero = u ? getHero(u.heroId) : null;
  return !!(hero && hero.gender === 'm');
}

function abilityName(state, unitId, kind, abilityId) {
  const u = unitById(state, unitId);
  const hero = u ? getHero(u.heroId) : null;
  if (!hero) return '';
  if (kind === 'ult' || (hero.ultimate && hero.ultimate.id === abilityId)) return L(hero.ultimate.name);
  if (kind === 'skill' || (hero.skill && hero.skill.id === abilityId)) return L(hero.skill.name);
  return '';
}

function sideOf(state, unitId) {
  const u = unitById(state, unitId);
  return u ? u.side : 0;
}

export function describeEvents(events, { state = null, playerSide = 1 } = {}) {
  const out = [];
  const names = {};
  const dmg = new Map(); // target -> { n, crit, side }
  const heal = new Map();
  let chain = null; // { unit, hops, line } — the headline is updated in place as hops come in
  let actorSide = 0;

  const flushChain = () => {
    chain = null;
  };

  for (const ev of events || []) {
    if (!ev || !ev.type) continue;
    switch (ev.type) {
      case 'cast': {
        flushChain();
        actorSide = sideOf(state, ev.unit) || actorSide;
        if (ev.kind === 'skill' || ev.kind === 'ult') {
          const ability = abilityName(state, ev.unit, ev.kind, ev.abilityId);
          out.push({
            text: rt(ev.kind === 'ult' ? 'battle.log.ult' : 'battle.log.cast', { who: unitName(state, ev.unit, names), ability }),
            tone: ev.kind === 'ult' ? 'ult' : 'cast',
            side: actorSide,
            key: `cast-${ev.unit}`,
          });
        }
        break;
      }
      case 'jump': {
        actorSide = sideOf(state, ev.unit) || actorSide;
        if (chain && chain.unit === ev.unit) chain.hops++;
        else {
          chain = { unit: ev.unit, hops: 1, line: { text: '', tone: 'cast', side: actorSide, key: `jump-${ev.unit}` } };
          out.push(chain.line);
        }
        chain.line.text = rt('battle.log.jump', { who: unitName(state, chain.unit, names), n: chain.hops });
        break;
      }
      case 'damage': {
        if (ev.target == null) break;
        const prev = dmg.get(ev.target) || { n: 0, crit: false };
        prev.n += Math.max(0, Number(ev.amount) || 0);
        prev.crit = prev.crit || !!ev.crit;
        dmg.set(ev.target, prev);
        if (!actorSide && ev.source != null) actorSide = sideOf(state, ev.source);
        break;
      }
      case 'heal': {
        if (ev.target == null) break;
        heal.set(ev.target, (heal.get(ev.target) || 0) + Math.max(0, Number(ev.amount) || 0));
        break;
      }
      case 'reaction': {
        const r = REACTIONS[ev.reaction];
        if (!r) break;
        out.push({
          text: rt('battle.log.reaction', { reaction: L(r.name).toUpperCase() + '!', kanji: r.kanji, target: unitName(state, ev.target, names) }),
          tone: 'reaction',
          side: actorSide,
          key: `reaction-${ev.target}-${r.id}`,
          reaction: r.id,
        });
        break;
      }
      case 'ko': {
        out.push({
          text: rt(isMale(state, ev.unit) ? 'battle.log.koM' : 'battle.log.ko', { kanji: KANJI.ko, target: unitName(state, ev.unit, names) }),
          tone: 'ko',
          side: actorSide || -sideOf(state, ev.unit),
          key: `ko-${ev.unit}`,
        });
        break;
      }
      case 'awaken': {
        out.push({
          text: rt('battle.log.awaken', { kanji: KANJI.awaken, who: unitName(state, ev.unit, names) }),
          tone: 'awaken',
          side: sideOf(state, ev.unit),
          key: `awaken-${ev.unit}`,
        });
        break;
      }
      case 'crownLost':
      case 'revive':
      case 'survive':
      case 'extraActivation': {
        const key = { crownLost: 'crownLost', revive: 'revive', survive: 'survive', extraActivation: 'extra' }[ev.type];
        out.push({ text: rt(`battle.log.${key}`, { who: unitName(state, ev.unit, names) }), tone: ev.type === 'crownLost' ? 'ko' : 'awaken', side: sideOf(state, ev.unit), key: `${ev.type}-${ev.unit}` });
        break;
      }
      case 'wait': {
        flushChain();
        out.push({ text: rt('battle.log.wait', { who: unitName(state, ev.unit, names) }), tone: 'info', side: sideOf(state, ev.unit), key: `wait-${ev.unit}` });
        break;
      }
      default:
        break;
    }
  }

  if (dmg.size) {
    const parts = [];
    for (const [target, d] of dmg) parts.push(`${unitName(state, target, names)} −${fmt(d.n)}${d.crit ? ' ' + rt('battle.log.crit') : ''}`);
    out.push({ text: parts.slice(0, 3).join(' · ') + (parts.length > 3 ? ' …' : ''), tone: 'damage', side: actorSide, key: 'damage' });
  }
  if (heal.size) {
    const parts = [];
    for (const [target, n] of heal) if (n > 0) parts.push(rt('battle.log.heal', { target: unitName(state, target, names), n: fmt(n) }));
    if (parts.length) out.push({ text: parts.slice(0, 3).join(' · ') + (parts.length > 3 ? ' …' : ''), tone: 'heal', side: actorSide, key: 'heal' });
  }
  return out.map((l) => ({ ...l, mine: l.side === playerSide }));
}
