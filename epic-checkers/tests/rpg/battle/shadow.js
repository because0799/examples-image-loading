// Event-replay model: rebuilds what a renderer / UI can know purely from the event stream (positions,
// HP, shields, energy, skill cooldowns, statuses, seals, wards, zones, turn) and compares it with the
// real battle state. Used by the fuzz tests to prove that "events are consistent with the state".

export class Shadow {
  constructor(state) {
    this.units = {};
    for (const u of state.units) {
      this.units[u.id] = {
        alive: u.alive, sq: u.sq, hp: u.hp, energy: u.energy, shield: u.shield, cd: u.cd.skill,
        statuses: new Set(u.statuses.map((x) => x.id)), seals: u.seals.map((x) => x.element).sort(),
      };
    }
    this.wards = {};
    for (const w of state.wards) this.wards[w.id] = { sq: w.sq, hp: w.hp };
    this.zones = new Set(state.zones.map((z) => z.id));
    this.side = state.side;
    this.round = state.round;
    this.result = state.result ? state.result.winner : null;
  }

  apply(events) {
    for (const e of events) {
      const u = e.unit != null ? this.units[e.unit] : null;
      const t = e.target != null ? this.units[e.target] : null;
      switch (e.type) {
        case 'move':
        case 'jump':
        case 'displace':
          u.sq = e.to;
          break;
        case 'ko':
          Object.assign(u, { alive: false, sq: -1, hp: 0, shield: 0, statuses: new Set(), seals: [] });
          break;
        case 'revive':
          Object.assign(u, { alive: true, sq: e.sq, hp: e.hp, energy: e.energy, shield: 0, cd: 0, statuses: new Set(), seals: [] });
          break;
        case 'damage':
          if (e.ward) {
            if (this.wards[e.target]) this.wards[e.target].hp = e.hp;
          } else {
            t.hp = e.hp;
            t.shield = e.shield;
          }
          break;
        case 'heal':
          t.hp = e.hp;
          break;
        case 'survive':
          u.hp = e.hp;
          break;
        case 'shield':
          t.shield = e.amount;
          if (e.amount > 0) t.statuses.add('shield');
          else t.statuses.delete('shield');
          break;
        case 'energy':
          u.energy = e.value;
          break;
        case 'cooldown':
          if (e.which === 'skill') u.cd = e.value;
          break;
        case 'status':
          if (e.on) t.statuses.add(e.status);
          else {
            t.statuses.delete(e.status);
            if (e.status === 'shield') t.shield = 0;
          }
          break;
        case 'seal':
          t.seals = e.seals.slice().sort();
          break;
        case 'ward':
          if (e.on) this.wards[e.id] = { sq: e.sq, hp: e.hp };
          else delete this.wards[e.id];
          break;
        case 'zone':
          if (e.on) this.zones.add(e.id);
          else this.zones.delete(e.id);
          break;
        case 'turnStart':
          this.side = e.side;
          this.round = e.round;
          break;
        case 'victory':
          this.result = e.winner;
          break;
        default:
          break;
      }
    }
  }

  /** Differences between the replayed model and the real state ([] when consistent). */
  compare(state) {
    const out = [];
    for (const u of state.units) {
      const m = this.units[u.id];
      const chk = (k, a, b) => {
        if (a !== b) out.push(`${u.id}(${u.heroId}).${k}: events ${a} vs state ${b}`);
      };
      chk('alive', m.alive, u.alive);
      chk('sq', m.sq, u.sq);
      chk('hp', m.hp, u.hp);
      if (!u.alive) continue;
      chk('energy', m.energy, u.energy);
      chk('shield', m.shield, u.shield);
      chk('cd', m.cd, u.cd.skill);
      const real = [...new Set(u.statuses.map((x) => x.id))].sort().join(',');
      chk('statuses', [...m.statuses].sort().join(','), real);
      chk('seals', m.seals.join(','), u.seals.map((x) => x.element).sort().join(','));
    }
    const wardIds = state.wards.map((w) => w.id).sort().join(',');
    if (Object.keys(this.wards).sort().join(',') !== wardIds) out.push(`wards: events ${Object.keys(this.wards).sort()} vs state ${wardIds}`);
    for (const w of state.wards) {
      const m = this.wards[w.id];
      if (m && (m.sq !== w.sq || m.hp !== w.hp)) out.push(`ward ${w.id}: events sq ${m.sq} hp ${m.hp} vs state sq ${w.sq} hp ${w.hp}`);
    }
    const zoneIds = state.zones.map((z) => z.id).sort().join(',');
    if ([...this.zones].sort().join(',') !== zoneIds) out.push(`zones: events ${[...this.zones].sort()} vs state ${zoneIds}`);
    if (!state.result) {
      if (this.side !== state.side) out.push(`side: events ${this.side} vs state ${state.side}`);
      if (this.round !== state.round) out.push(`round: events ${this.round} vs state ${state.round}`);
    } else if (this.result !== state.result.winner) out.push(`result: events ${this.result} vs state ${state.result.winner}`);
    return out;
  }
}

/** Structural invariants of a battle state ([] when valid). */
export function invariants(state) {
  const out = [];
  const seen = new Map();
  const isDark = (q) => q >= 0 && q < 64 && (((q >> 3) + (q & 7)) & 1) === 1;
  for (const u of state.units) {
    if (!Number.isFinite(u.hp) || u.hp < 0) out.push(`${u.id} hp ${u.hp}`);
    if (u.hp > u.maxHp) out.push(`${u.id} hp ${u.hp} > max ${u.maxHp}`);
    if (!Number.isFinite(u.energy) || u.energy < 0 || u.energy > u.maxEnergy) out.push(`${u.id} energy ${u.energy}/${u.maxEnergy}`);
    if (!Number.isFinite(u.shield) || u.shield < 0) out.push(`${u.id} shield ${u.shield}`);
    if (u.cd.skill < 0) out.push(`${u.id} cd ${u.cd.skill}`);
    if (u.alive) {
      if (!isDark(u.sq) || state.holes.includes(u.sq)) out.push(`${u.id} on bad square ${u.sq}`);
      if (u.hp <= 0) out.push(`${u.id} alive with hp ${u.hp}`);
      if (seen.has(u.sq)) out.push(`${u.id} shares ${u.sq} with ${seen.get(u.sq)}`);
      seen.set(u.sq, u.id);
      for (const st of u.statuses) if (st.turns != null && !(st.turns >= 0)) out.push(`${u.id} status ${st.id} turns ${st.turns}`);
      if (u.seals.length > 2) out.push(`${u.id} has ${u.seals.length} seals`);
    } else if (u.sq !== -1) out.push(`${u.id} KO'd but on ${u.sq}`);
  }
  for (const w of state.wards) {
    if (!isDark(w.sq)) out.push(`ward ${w.id} on bad square`);
    if (!(w.hp > 0)) out.push(`ward ${w.id} hp ${w.hp}`);
    if (seen.has(w.sq)) out.push(`ward ${w.id} shares ${w.sq} with ${seen.get(w.sq)}`);
    seen.set(w.sq, w.id);
  }
  if (!state.result && ![1, -1].includes(state.side)) out.push(`side ${state.side}`);
  return out;
}
