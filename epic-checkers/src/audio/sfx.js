// Procedural SFX recipes. Every recipe is `(v: Voice) => void`: it builds a small node graph
// on v.ctx starting at v.t, honouring v.i (intensity / size), v.p (pitch multiplier) and v.rnd.
// Recipes never allocate buffers: noise and reverb come from the shared resources.

import { perc, perc2, ahr, rise, swellEnv, sweep, mtof, clamp, Voice } from './core.js';

// ------------------------------------------------------------------------------------------
// building blocks
// ------------------------------------------------------------------------------------------

const nyq = (v) => v.ctx.sampleRate * 0.45;

/** Enveloped oscillator → dest. Skips partials above Nyquist. */
function tone(v, type, f, t, peak, a, d, dest, detune = 0) {
  if (f >= nyq(v) || peak <= 0) return null;
  const o = v.osc(type, f, t, t + a + d + 0.02, detune);
  const g = v.gain(0);
  perc(g.gain, t, peak, a, d);
  o.connect(g).connect(dest || v.out);
  return o;
}

/** Enveloped noise through a list of filters ([type, freq, Q]) → dest. Returns the filters. */
function noiseHit(v, kind, t, peak, a, d, filters, dest) {
  const src = v.noise(kind, t, t + a + d + 0.02);
  const g = v.gain(0);
  perc(g.gain, t, peak, a, d);
  let node = src;
  const fl = [];
  for (const [type, f, Q] of filters) {
    const f1 = v.filter(type, Math.min(f, nyq(v)), Q);
    node.connect(f1);
    node = f1;
    fl.push(f1);
  }
  node.connect(g).connect(dest || v.out);
  return fl;
}

/** Sub-level bus inside a voice with optional reverb send. */
function bus(v, level = 1, hall = 0, room = 0) {
  const b = v.gain(level);
  b.connect(v.out);
  if (hall > 0) v.send(b, hall, 'hall');
  if (room > 0) v.send(b, room, 'room');
  return b;
}

/** Wooden piece clack: contact transient + modal body resonances + board thump. */
function woodClack(v, t, { f = 1, level = 1, body = 1, bright = 1, room = 0.12, dest } = {}) {
  const p = v.p * f * (1 + (v.rnd() - 0.5) * 0.05);
  const mix = v.gain(level);
  mix.connect(dest || v.out);
  if (room > 0) v.send(mix, room, 'room');
  noiseHit(v, 'white', t, 0.4 * bright, 0.0004, 0.012, [['bandpass', 3400 * p, 0.8]], mix);
  const modes = [
    [480, 0.36, 0.07],
    [1050, 0.34, 0.045],
    [1720, 0.2, 0.03],
    [2800, 0.12 * bright, 0.02],
  ];
  for (const [fr, amp, dec] of modes) {
    tone(v, 'sine', fr * p * (1 + (v.rnd() - 0.5) * 0.03), t, amp, 0.0006, dec, mix);
  }
  if (body > 0) {
    const o = v.osc('sine', 170 * p, t, t + 0.13);
    o.frequency.exponentialRampToValueAtTime(92 * p, t + 0.05);
    const g = v.gain(0);
    perc(g.gain, t, 0.32 * body, 0.001, 0.085);
    o.connect(g).connect(mix);
  }
  return mix;
}

/** Soft marimba-like note (fundamental + 3.93× partial). */
function mallet(v, t, f, peak, dec, dest) {
  tone(v, 'sine', f, t, peak, 0.002, dec, dest);
  tone(v, 'sine', f * 3.93, t, peak * 0.2, 0.001, dec * 0.22, dest);
}

/** FM bell / celesta. ratio 4 = celesta-ish (harmonic), 3.5 = bell (inharmonic). */
function bell(v, t, f, peak, dec, { ratio = 4, index = 0.8, dest } = {}) {
  if (f * ratio >= nyq(v)) ratio = 2;
  const end = t + dec + 0.05;
  const car = v.osc('sine', f, t, end);
  const mod = v.osc('sine', f * ratio, t, end);
  const mg = v.gain(0);
  const depth = f * index;
  mg.gain.setValueAtTime(depth, t);
  mg.gain.exponentialRampToValueAtTime(depth * 0.04, t + dec * 0.6);
  mod.connect(mg).connect(car.frequency);
  const g = v.gain(0);
  perc2(g.gain, t, peak, 0.002, dec * 0.12, 0.45, dec * 0.86);
  car.connect(g).connect(dest || v.out);
}

/** Piano-ish pluck: triangle + octave sine, darkening low-pass. */
function pianoNote(v, t, f, peak, dec, dest) {
  const o1 = v.osc('triangle', f, t, t + dec + 0.2);
  const o2 = v.osc('sine', f * 2.003, t, t + dec * 0.4 + 0.1);
  const lp = v.filter('lowpass', Math.min(f * 7, 9000), 0.4);
  sweep(lp.frequency, t, Math.min(f * 7, 9000), t + 0.45, Math.min(f * 2.2, 5000));
  const g = v.gain(0);
  perc2(g.gain, t, peak, 0.004, 0.12, 0.42, dec);
  const g2 = v.gain(0);
  perc(g2.gain, t, peak * 0.22, 0.003, dec * 0.4);
  o1.connect(lp).connect(g).connect(dest || v.out);
  o2.connect(g2).connect(dest || v.out);
}

/** Brass-like note: detuned saws, filter "bwaa" envelope. */
function brassNote(v, t, f, len, peak, dest) {
  const end = t + len + 0.45;
  const lp = v.filter('lowpass', f * 1.2, 1.1);
  lp.frequency.setValueAtTime(Math.min(f * 1.3, nyq(v)), t);
  lp.frequency.exponentialRampToValueAtTime(Math.min(f * 7, 9000), t + 0.06);
  lp.frequency.exponentialRampToValueAtTime(Math.min(f * 3.2, 6000), t + 0.06 + Math.min(len, 0.35));
  for (const det of [-7, 6]) v.osc('sawtooth', f, t, end, det).connect(lp);
  const g = v.gain(0);
  ahr(g.gain, t, peak, 0.025, Math.max(0, len - 0.025), 0.28);
  lp.connect(g).connect(dest || v.out);
}

/** Band-passed noise sweep (whoosh core). */
function whooshCore(v, t, dur, fLo, fHi, peak, o = {}) {
  const p = v.p;
  const n = v.noise(o.kind || 'pink', t, t + dur + 0.03);
  const lo = Math.min(fLo * p, nyq(v));
  const hi = Math.min(fHi * p, nyq(v));
  const bp = v.filter('bandpass', lo, o.q || 1.2);
  const up = dur * (o.peakAt != null ? o.peakAt : 0.55);
  sweep(bp.frequency, t, lo, t + up, hi);
  bp.frequency.exponentialRampToValueAtTime(lo * 1.3, t + dur);
  const g = v.gain(0);
  swellEnv(g.gain, t, peak, up, dur - up);
  let last = v.chain(n, bp, g);
  if (o.pan0 != null) {
    const pn = v.panNode(o.pan0);
    pn.pan.setValueAtTime(o.pan0, t);
    pn.pan.linearRampToValueAtTime(o.pan1, t + dur);
    last.connect(pn);
    last = pn;
  }
  last.connect(o.dest || v.out);
  return last;
}

/** Pitch-dropping sine (sub / membrane). */
function drop(v, t, f0, f1, tDrop, peak, a, d, dest, type = 'sine') {
  const o = v.osc(type, f0, t, t + a + d + 0.03);
  o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + tDrop);
  const g = v.gain(0);
  perc(g.gain, t, peak, a, d);
  o.connect(g).connect(dest || v.out);
  return o;
}

/**
 * Saturated pitch-drop "punch": the harmonics of a low drop (300 Hz – 2 kHz) make impacts read on
 * phone speakers that cannot reproduce the sub itself. The envelope is applied after the
 * shaper so the harmonic content stays constant while it decays.
 */
function punch(v, t, f0, f1, tDrop, peak, d, dest, cutoff = 1800) {
  const o = v.osc('sine', f0, t, t + d + 0.03);
  o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + tDrop);
  const sh = v.shaper('drive');
  const lp = v.filter('lowpass', cutoff, 0.7);
  const hp = v.filter('highpass', 170, 0.7);
  const g = v.gain(0);
  perc(g.gain, t, peak, 0.001, d);
  v.chain(o, sh, lp, hp, g, dest || v.out);
}

/** Fighting-game "thwack": band-passed noise burst in the mid range with a very fast decay. */
function thwack(v, t, f, peak, d, dest) {
  // ×3: a band of pink noise has a much lower level than its full-band peak
  noiseHit(v, 'pink', t, peak * 3, 0.0008, d, [['bandpass', f, 0.9]], dest);
}

const m2f = (v, m) => mtof(m) * v.p;

// ------------------------------------------------------------------------------------------
// recipes
// ------------------------------------------------------------------------------------------

export const SFX = {
  // ===================================== classic ==========================================

  click(v) {
    const t = v.t, p = v.p;
    tone(v, 'sine', 2100 * p, t, 0.2, 0.0008, 0.03);
    tone(v, 'sine', 3150 * p, t, 0.06, 0.0005, 0.016);
    tone(v, 'triangle', 540 * p, t, 0.09, 0.001, 0.025);
    noiseHit(v, 'white', t, 0.1, 0.0003, 0.007, [['bandpass', 5200 * p, 1.2]]);
  },

  select(v) {
    const t = v.t;
    const b = bus(v, 1, 0, 0.08);
    woodClack(v, t, { f: 1.35, level: 0.3, body: 0.3, bright: 0.6, room: 0, dest: b });
    mallet(v, t + 0.012, m2f(v, 74), 0.15, 0.22, b);
    mallet(v, t + 0.065, m2f(v, 81), 0.13, 0.32, b);
  },

  deselect(v) {
    const t = v.t;
    const b = bus(v, 1, 0, 0.06);
    woodClack(v, t, { f: 1.2, level: 0.18, body: 0, bright: 0.4, room: 0, dest: b });
    const o = v.osc('sine', m2f(v, 81), t, t + 0.3);
    o.frequency.exponentialRampToValueAtTime(m2f(v, 74), t + 0.09);
    const g = v.gain(0);
    perc(g.gain, t, 0.13, 0.003, 0.2);
    o.connect(g).connect(b);
  },

  move(v) {
    const t = v.t, p = v.p;
    woodClack(v, t, { f: 1.6, level: 0.14, body: 0, bright: 0.5, room: 0 });
    const dur = 0.22;
    const n = v.noise('pink', t, t + dur + 0.05);
    const bp = v.filter('bandpass', 800 * p, 1.3);
    sweep(bp.frequency, t, 650 * p, t + dur, 1700 * p);
    const lp = v.filter('lowpass', 3500, 0.5);
    const g = v.gain(0);
    swellEnv(g.gain, t, 0.15, 0.08, dur - 0.08);
    v.chain(n, bp, lp, g, v.out);
  },

  land(v) {
    const t = v.t;
    woodClack(v, t, { level: 0.62, body: 1, room: 0.16 });
    tone(v, 'sine', 70 * v.p, t, 0.18, 0.002, 0.09);
  },

  capture(v) {
    const t = v.t;
    woodClack(v, t, { f: 1.18, level: 0.46, body: 0.5, room: 0.1 });
    whooshCore(v, t + 0.015, 0.26, 600, 2300, 0.12, { q: 1.1 });
    woodClack(v, t + 0.11, { f: 0.94, level: 0.56, body: 0.9, room: 0.15 });
  },

  combo(v) {
    const t = v.t;
    const b = bus(v, 1, 0.22);
    const notes = [72, 76, 79, 84, 88];
    const n = v.i >= 1.3 ? 5 : v.i >= 0.7 ? 4 : 3;
    for (let k = 0; k < n; k++) bell(v, t + k * 0.055, m2f(v, notes[k]), 0.15, 0.45 + 0.12 * k, { dest: b });
    drop(v, t, 320 * v.p, 150 * v.p, 0.06, 0.22, 0.002, 0.09, b, 'triangle');
    noiseHit(v, 'white', t + 0.05, 0.035, 0.03, 0.3, [['highpass', 7500, 0.7]], b);
  },

  promote(v) {
    const t = v.t;
    const b = bus(v, 1, 0.38);
    const notes = [72, 76, 79, 84, 88];
    notes.forEach((m, k) => bell(v, t + k * 0.075, m2f(v, m), 0.16, 1.2 + k * 0.18, { dest: b }));
    // warm chord underneath
    const pad = v.gain(0);
    ahr(pad.gain, t, 0.07, 0.25, 0.4, 0.9);
    pad.connect(b);
    for (const m of [60, 64, 67]) v.osc('triangle', m2f(v, m), t, t + 1.7).connect(pad);
    // shimmer
    const n = v.noise('white', t, t + 1.4);
    const hp = v.filter('highpass', 7000, 0.7);
    const g = v.gain(0);
    swellEnv(g.gain, t, 0.05, 0.3, 1.0);
    v.chain(n, hp, g, b);
  },

  illegal(v) {
    const t = v.t, p = v.p;
    drop(v, t, 165 * p, 88 * p, 0.12, 0.3, 0.002, 0.16);
    const tri = v.osc('triangle', 230 * p, t, t + 0.16);
    tri.frequency.exponentialRampToValueAtTime(150 * p, t + 0.1);
    const lp = v.filter('lowpass', 800, 0.7);
    const g = v.gain(0);
    perc(g.gain, t, 0.32, 0.002, 0.1);
    v.chain(tri, lp, g, v.out);
    thwack(v, t + 0.002, 380 * p, 0.12, 0.05);
    noiseHit(v, 'brown', t, 0.22, 0.002, 0.06, [['lowpass', 500 * p, 0.7]]);
  },

  turn(v) {
    const t = v.t;
    const b = bus(v, 1, 0, 0.12);
    mallet(v, t, m2f(v, 76), 0.12, 0.35, b);
    mallet(v, t + 0.09, m2f(v, 83), 0.1, 0.5, b);
  },

  win(v) {
    const t = v.t;
    const b = bus(v, 0.9, 0.3);
    const st = 0.13;
    const pick = [55, 62, 67, 71]; // G major
    for (let k = 0; k < 3; k++) for (const m of pick) brassNote(v, t + k * st, m2f(v, m), 0.08, 0.075, b);
    const big = t + 3 * st;
    for (const m of [48, 60, 64, 67, 72]) brassNote(v, big, m2f(v, m), 1.05, 0.08, b);
    // timpani
    drop(v, big, m2f(v, 43) * 1.03, m2f(v, 43), 0.08, 0.5, 0.002, 0.9, b);
    drop(v, t, m2f(v, 38) * 1.03, m2f(v, 38), 0.08, 0.3, 0.002, 0.4, b);
    // celesta sparkle
    [84, 88, 91, 96].forEach((m, k) => bell(v, big + 0.12 + k * 0.07, m2f(v, m), 0.07, 0.9, { dest: b }));
  },

  lose(v) {
    const t = v.t;
    const b = bus(v, 1, 0.3);
    const line = [76, 74, 72, 71, 69]; // E D C B A
    line.forEach((m, k) => pianoNote(v, t + k * 0.24, m2f(v, m), 0.17 - k * 0.012, k === 4 ? 2.2 : 0.9, b));
    const pad = v.gain(0);
    ahr(pad.gain, t + 0.96, 0.06, 0.4, 0.5, 1.2);
    pad.connect(b);
    const lp = v.filter('lowpass', 900, 0.5);
    lp.connect(pad);
    for (const m of [45, 57, 60, 64]) v.osc('sawtooth', m2f(v, m), t + 0.96, t + 3.2, (v.rnd() - 0.5) * 10).connect(lp);
  },

  draw(v) {
    const t = v.t;
    const b = bus(v, 1, 0.3);
    for (const m of [60, 65, 67]) pianoNote(v, t, m2f(v, m), 0.1, 0.9, b);
    for (const m of [60, 67, 72]) pianoNote(v, t + 0.38, m2f(v, m), 0.11, 1.6, b);
    bell(v, t + 0.38, m2f(v, 84), 0.05, 1.4, { dest: b });
  },

  start(v) {
    const t = v.t;
    const b = bus(v, 1, 0.3);
    const n = v.noise('white', t, t + 0.4);
    const hp = v.filter('highpass', 4500, 0.7);
    const g = v.gain(0);
    rise(g.gain, t, 0.07, 0.32, 0.03);
    v.chain(n, hp, g, b);
    const h = t + 0.3;
    [72, 76, 79, 86].forEach((m, k) => bell(v, h + k * 0.03, m2f(v, m), 0.12, 1.3, { dest: b }));
    drop(v, h, 120 * v.p, 70 * v.p, 0.1, 0.3, 0.002, 0.25, b);
    woodClack(v, h, { f: 0.9, level: 0.3, body: 0.6, room: 0, dest: b });
  },

  hint(v) {
    const t = v.t;
    const b = bus(v, 1, 0.35);
    [88, 91, 93, 98].forEach((m, k) => bell(v, t + k * 0.065, m2f(v, m), 0.085, 0.6, { dest: b }));
    const n = v.noise('white', t, t + 0.6);
    const hp = v.filter('highpass', 8000, 0.7);
    const g = v.gain(0);
    swellEnv(g.gain, t, 0.03, 0.15, 0.4);
    v.chain(n, hp, g, b);
  },

  undo(v) {
    const t = v.t, p = v.p;
    // reversed swoosh (rising, cut off)
    const n = v.noise('pink', t, t + 0.25);
    const bp = v.filter('bandpass', 1500 * p, 1.4);
    sweep(bp.frequency, t, 2200 * p, t + 0.18, 700 * p);
    const g = v.gain(0);
    rise(g.gain, t, 0.13, 0.18, 0.025);
    v.chain(n, bp, g, v.out);
    // descending blips
    [1320, 990, 660].forEach((f, k) => tone(v, 'sine', f * p, t + 0.03 + k * 0.05, 0.11, 0.002, 0.07));
    woodClack(v, t + 0.19, { f: 1.3, level: 0.18, body: 0.2, room: 0.05 });
  },

  // ====================================== epic ============================================

  whoosh(v) {
    const t = v.t, p = v.p;
    const dur = 0.3 + 0.2 * v.size;
    const b = bus(v, 1, 0.12);
    whooshCore(v, t, dur, 500, 3500, 0.32, { q: 1.6, pan0: -0.6, pan1: 0.6, kind: 'white', dest: b });
    whooshCore(v, t, dur, 250, 900, 0.3, { q: 1.2, pan0: -0.5, pan1: 0.5, kind: 'pink', peakAt: 0.5, dest: b });
    whooshCore(v, t, dur, 1600, 7500, 0.32, { q: 1.0, kind: 'white', peakAt: 0.6, pan0: -0.3, pan1: 0.3, dest: b });
    // doppler-ish body: rises while approaching, falls after passing
    const o = v.osc('sine', 110 * p, t, t + dur + 0.03);
    o.frequency.exponentialRampToValueAtTime(175 * p, t + dur * 0.55);
    o.frequency.exponentialRampToValueAtTime(80 * p, t + dur);
    const g = v.gain(0);
    swellEnv(g.gain, t, 0.14, dur * 0.55, dur * 0.45);
    o.connect(g).connect(b);
  },

  dash(v) {
    const t = v.t, p = v.p;
    const b = bus(v, 1, 0.1);
    noiseHit(v, 'white', t, 0.3, 0.0005, 0.04, [['highpass', 3500 * p, 0.7]], b);
    whooshCore(v, t, 0.2, 900, 6000, 0.6, { q: 1.6, pan0: -0.45, pan1: 0.5, kind: 'white', peakAt: 0.35, dest: b });
    drop(v, t, 220 * p, 55 * p, 0.2, 0.38, 0.002, 0.18, b);
    const z = v.osc('sawtooth', 500 * p, t, t + 0.16);
    z.frequency.exponentialRampToValueAtTime(2400 * p, t + 0.12);
    const bp = v.filter('bandpass', 2000, 2);
    const g = v.gain(0);
    perc(g.gain, t, 0.07, 0.005, 0.11);
    v.chain(z, bp, g, b);
  },

  impact(v) {
    const t = v.t, p = v.p, s = v.size;
    const b = bus(v, 1, 0.18 * s);
    // sub-bass drop
    drop(v, t, 160 * p, 42 * p, 0.18, 0.75, 0.001, 0.5 * s, b);
    // body with harmonics (so it reads on phone speakers)
    const body = v.osc('triangle', 115 * p, t, t + 0.4 * s);
    body.frequency.exponentialRampToValueAtTime(48 * p, t + 0.15);
    const sh = v.shaper('soft');
    const lp = v.filter('lowpass', 1000, 0.7);
    const bg = v.gain(0);
    perc(bg.gain, t, 0.5, 0.001, 0.24 * s);
    v.chain(body, sh, lp, bg, b);
    // transient click
    noiseHit(v, 'white', t, 0.55, 0.0002, 0.012, [['highpass', 2500, 0.7]], b);
    tone(v, 'sine', 2600 * p, t, 0.14, 0.0003, 0.02, b);
    punch(v, t, 120 * p, 50 * p, 0.12, 0.6, 0.22 * s, b, 1400);
    thwack(v, t + 0.003, 700 * p, 0.45, 0.09, b);
    // distorted noise crunch
    const n = v.noise('white', t, t + 0.3 * s + 0.05);
    const nlp = v.filter('lowpass', 4000 * p, 0.8);
    sweep(nlp.frequency, t, 4500 * p, t + 0.18, 700 * p);
    const dist = v.shaper('drive');
    const hp = v.filter('highpass', 150, 0.7);
    const ng = v.gain(0);
    perc(ng.gain, t, 0.36, 0.001, 0.2 * s);
    v.chain(n, nlp, dist, hp, ng, b);
  },

  bigImpact(v) {
    const t = v.t, p = v.p, s = v.size;
    const b = bus(v, 1, 0.38 * s);
    // layered sub drops
    drop(v, t, 140 * p, 32 * p, 0.35, 0.6, 0.001, 1.15 * s, b);
    drop(v, t + 0.018, 95 * p, 38 * p, 0.25, 0.35, 0.002, 0.6 * s, b);
    // body
    const body = v.osc('sawtooth', 90 * p, t, t + 0.9 * s);
    body.frequency.exponentialRampToValueAtTime(40 * p, t + 0.3);
    const blp = v.filter('lowpass', 700, 1.2);
    sweep(blp.frequency, t, 1400, t + 0.5, 250);
    const bsh = v.shaper('drive');
    const bg = v.gain(0);
    perc(bg.gain, t, 0.32, 0.002, 0.6 * s);
    v.chain(body, blp, bsh, bg, b);
    punch(v, t, 105 * p, 40 * p, 0.25, 0.7, 0.5 * s, b, 1400);
    thwack(v, t, 520 * p, 0.65, 0.14, b);
    thwack(v, t + 0.02, 1100 * p, 0.3, 0.07, b);
    // double transient
    noiseHit(v, 'white', t, 0.6, 0.0002, 0.015, [['highpass', 2000, 0.7]], b);
    noiseHit(v, 'white', t + 0.022, 0.35, 0.0002, 0.012, [['highpass', 3000, 0.7]], b);
    // crack
    const cr = v.noise('white', t, t + 0.2);
    const cbp = v.filter('bandpass', 1800 * p, 0.7);
    const csh = v.shaper('hard');
    const cg = v.gain(0);
    perc(cg.gain, t, 0.2, 0.0005, 0.12);
    v.chain(cr, cbp, csh, cg, b);
    // low rumble tail
    const rb = v.noise('brown', t, t + 2.0 * s + 0.1);
    const rlp = v.filter('lowpass', 160, 0.8);
    const rg = v.gain(0);
    ahr(rg.gain, t, 0.4, 0.03, 0.15, 1.7 * s);
    v.chain(rb, rlp, rg, b);
    // metallic ring
    for (const [f, a, d] of [[523, 0.05, 0.7], [1187, 0.035, 0.55], [1840, 0.025, 0.4]]) tone(v, 'sine', f * p, t, a, 0.001, d * s, b);
  },

  boom(v) {
    const t = v.t, p = v.p, s = v.size;
    const b = bus(v, 1, 0.4 * s);
    drop(v, t, 120 * p, 28 * p, 0.7, 0.6, 0.002, 1.9 * s, b);
    const body = v.osc('sawtooth', 70 * p, t, t + 1.3 * s);
    body.frequency.exponentialRampToValueAtTime(34 * p, t + 0.5);
    const lp = v.filter('lowpass', 600, 1);
    const sh = v.shaper('drive');
    const lp2 = v.filter('lowpass', 1400, 0.7);
    const g = v.gain(0);
    perc(g.gain, t, 0.5, 0.003, 1.1 * s);
    v.chain(body, lp, sh, lp2, g, b);
    punch(v, t, 85 * p, 34 * p, 0.45, 0.6, 0.9 * s, b, 1200);
    thwack(v, t, 380 * p, 0.5, 0.2, b);
    noiseHit(v, 'brown', t, 0.6, 0.002, 0.35 * s, [['lowpass', 900, 0.7]], b);
    noiseHit(v, 'white', t, 0.28, 0.0003, 0.02, [['highpass', 1500, 0.7]], b);
  },

  slash(v) {
    const t = v.t, p = v.p, s = v.size;
    const b = bus(v, 1, 0.28);
    whooshCore(v, t, 0.12, 2500, 8000, 0.2, { q: 1.2, kind: 'white', peakAt: 0.7, dest: b });
    const th = t + 0.075;
    // the "shing"
    const n = v.noise('white', th, th + 0.5 * s + 0.05);
    const bp = v.filter('bandpass', 5500 * p, 5);
    sweep(bp.frequency, th, Math.min(4200 * p, nyq(v)), th + 0.06, Math.min(8200 * p, nyq(v)));
    const g = v.gain(0);
    perc(g.gain, th, 0.55, 0.0015, 0.3 * s);
    v.chain(n, bp, g, b);
    // inharmonic blade ring with slight beating
    const f0 = 1650 * p;
    const ring = [[1, 0.15, 1.1], [1.0035, 0.1, 1.0], [1.47, 0.11, 0.85], [2.09, 0.08, 0.65], [2.71, 0.06, 0.5], [3.62, 0.045, 0.35], [4.4, 0.03, 0.25]];
    for (const [r, a, d] of ring) {
      const o = tone(v, 'sine', f0 * r, th, a, 0.001, d * s, b);
      if (o) {
        o.frequency.setValueAtTime(f0 * r * 0.985, th);
        o.frequency.exponentialRampToValueAtTime(f0 * r, th + 0.03);
      }
    }
    noiseHit(v, 'white', th, 0.3, 0.0003, 0.008, [['highpass', 4000, 0.7]], b);
  },

  thunder(v) {
    const t = v.t, p = v.p, s = v.size;
    const dur = 2.4 + 1.2 * s;
    const b = bus(v, 1, 0.4);
    // crack: dense snaps
    const c = v.noise('crackle', t, t + 0.5);
    const chp = v.filter('highpass', 1200 * p, 0.7);
    const csh = v.shaper('drive');
    const cg = v.gain(0);
    perc(cg.gain, t, 0.6, 0.0005, 0.35);
    v.chain(c, chp, csh, cg, b);
    noiseHit(v, 'white', t, 0.55, 0.0003, 0.05, [['highpass', 900, 0.7]], b);
    noiseHit(v, 'white', t + 0.13, 0.25, 0.0005, 0.08, [['highpass', 1400, 0.7]], b);
    // rolling rumble
    const r = v.noise('brown', t, t + dur + 0.4);
    const rlp = v.filter('lowpass', 260 * p, 0.9);
    sweep(rlp.frequency, t, 320 * p, t + dur, 90 * p);
    const roll = v.gain(0.6);
    let tt = t + 0.1;
    roll.gain.setValueAtTime(0.6, t);
    while (tt < t + dur) {
      tt += 0.12 + v.rnd() * 0.3;
      roll.gain.linearRampToValueAtTime(0.35 + v.rnd() * 0.65, tt);
    }
    const rg = v.gain(0);
    ahr(rg.gain, t + 0.02, 0.85, 0.12, 0.3, dur);
    v.chain(r, rlp, roll, rg, b);
    // mid rumble (audible on phones)
    const m = v.noise('pink', t, t + 1.8 * s + 0.4);
    const mlp = v.filter('lowpass', 900, 0.7);
    const mhp = v.filter('highpass', 160, 0.7);
    const mroll = v.gain(1);
    mroll.gain.setValueAtTime(1, t);
    for (let k = 1, tk = t; tk < t + 1.6 * s; k++) {
      tk = t + k * (0.15 + 0.12 * v.rnd());
      mroll.gain.linearRampToValueAtTime(0.4 + 0.6 * v.rnd(), tk);
    }
    const mg = v.gain(0);
    ahr(mg.gain, t, 0.7, 0.04, 0.15, 1.4 * s);
    v.chain(m, mlp, mhp, mroll, mg, b);
  },

  charge(v) {
    const t = v.t, p = v.p;
    const dur = 0.9 + 0.4 * v.size;
    const b = bus(v, 1, 0.2);
    const lp = v.filter('lowpass', 250, 7);
    sweep(lp.frequency, t, 250 * p, t + dur, Math.min(6500 * p, nyq(v)));
    const g = v.gain(0);
    rise(g.gain, t, 0.3, dur, 0.06);
    const lfo = v.osc('sine', 5, t, t + dur + 0.1);
    lfo.frequency.exponentialRampToValueAtTime(17, t + dur);
    const lfoG = v.gain(15);
    lfoG.gain.setValueAtTime(15, t);
    lfoG.gain.linearRampToValueAtTime(60, t + dur);
    lfo.connect(lfoG);
    for (const det of [-12, 12]) {
      const o = v.osc('sawtooth', 90 * p, t, t + dur + 0.1, det);
      o.frequency.exponentialRampToValueAtTime(360 * p, t + dur);
      lfoG.connect(o.detune);
      o.connect(lp);
    }
    lp.connect(g).connect(b);
    const n = v.noise('white', t, t + dur + 0.1);
    const bp = v.filter('bandpass', 1500 * p, 1.5);
    sweep(bp.frequency, t, 1500 * p, t + dur, Math.min(9000 * p, nyq(v)));
    const ng = v.gain(0);
    rise(ng.gain, t, 0.14, dur, 0.06);
    v.chain(n, bp, ng, b);
    const sub = v.osc('sine', 55 * p, t, t + dur + 0.1);
    sub.frequency.exponentialRampToValueAtTime(110 * p, t + dur);
    const sg = v.gain(0);
    rise(sg.gain, t, 0.22, dur, 0.06);
    sub.connect(sg).connect(b);
  },

  riser(v) {
    const t = v.t, p = v.p;
    const dur = 1.4 + 0.6 * v.size;
    const b = bus(v, 1, 0.35);
    const trem = v.gain(0.65);
    const lfo = v.osc('sine', 6, t, t + dur + 0.05);
    lfo.frequency.exponentialRampToValueAtTime(22, t + dur);
    const lfoD = v.gain(0.35);
    lfo.connect(lfoD).connect(trem.gain);
    trem.connect(b);
    const n = v.noise('white', t, t + dur + 0.05);
    const hp = v.filter('highpass', 200, 0.8);
    sweep(hp.frequency, t, 200, t + dur, 7000);
    const ng = v.gain(0);
    rise(ng.gain, t, 0.3, dur, 0.015);
    v.chain(n, hp, ng, trem);
    const lp = v.filter('lowpass', 400, 3);
    sweep(lp.frequency, t, 400, t + dur, Math.min(5000 * p, nyq(v)));
    const tg = v.gain(0);
    rise(tg.gain, t, 0.17, dur, 0.015);
    for (const [f0, det] of [[110, -8], [220, 8], [330, 0]]) {
      const o = v.osc('sawtooth', f0 * p, t, t + dur + 0.05, det);
      o.frequency.exponentialRampToValueAtTime(f0 * 2 * p, t + dur);
      o.connect(lp);
    }
    v.chain(lp, tg, trem);
  },

  swell(v) {
    const t = v.t, p = v.p;
    const dur = 0.9 + 0.5 * v.size;
    const b = bus(v, 1, 0.3);
    const n = v.noise('white', t, t + dur + 0.05);
    const hp = v.filter('highpass', 3000, 0.7);
    const bp = v.filter('bandpass', 8000, 0.5);
    const ng = v.gain(0);
    rise(ng.gain, t, 0.3, dur, 0.02);
    v.chain(n, hp, bp, ng, b);
    const lp = v.filter('lowpass', 300, 1.2);
    sweep(lp.frequency, t, 300, t + dur, 3500);
    const cg = v.gain(0);
    rise(cg.gain, t, 0.12, dur, 0.03);
    for (const m of [52, 59, 64, 67]) for (const det of [-9, 9]) v.osc('sawtooth', m2f(v, m), t, t + dur + 0.06, det).connect(lp);
    v.chain(lp, cg, b);
    const sub = v.osc('sine', 41.2 * p, t, t + dur + 0.06);
    const sg = v.gain(0);
    rise(sg.gain, t, 0.25, dur, 0.03);
    sub.connect(sg).connect(b);
  },

  power(v) {
    const t = v.t, p = v.p, s = v.size;
    const b = bus(v, 1, 0.3);
    drop(v, t, 90 * p, 45 * p, 0.2, 0.5, 0.002, 0.4, b);
    // roar
    const r = v.noise('brown', t, t + 1.2 * s + 0.1);
    const rlp = v.filter('lowpass', 400, 1);
    sweep(rlp.frequency, t, 400, t + 0.3, 1600);
    rlp.frequency.exponentialRampToValueAtTime(500, t + 1.1 * s);
    const rsh = v.shaper('soft');
    const rg = v.gain(0);
    perc(rg.gain, t, 0.38, 0.03, 1.0 * s);
    v.chain(r, rlp, rsh, rg, b);
    // ascending power-up arpeggio (E major)
    [64, 71, 76, 80, 83, 88].forEach((m, k) => {
      const tt = t + k * 0.045;
      const o = v.osc('square', m2f(v, m), tt, tt + 0.3);
      const lp = v.filter('lowpass', 3500, 0.8);
      const g = v.gain(0);
      perc(g.gain, tt, 0.07, 0.003, 0.24);
      v.chain(o, lp, g, b);
    });
    // shimmering power chord
    const clp = v.filter('lowpass', 600, 1.4);
    sweep(clp.frequency, t, 600, t + 0.5, 4000);
    const cg = v.gain(0);
    ahr(cg.gain, t, 0.16, 0.08, 0.3, 0.9 * s);
    const vib = v.osc('sine', 6, t, t + 1.4 * s + 0.1);
    const vibG = v.gain(14);
    vib.connect(vibG);
    for (const m of [52, 59, 64, 71]) {
      const o = v.osc('sawtooth', m2f(v, m), t, t + 1.3 * s + 0.1, (v.rnd() - 0.5) * 12);
      vibG.connect(o.detune);
      o.connect(clp);
    }
    v.chain(clp, cg, b);
    noiseHit(v, 'white', t, 0.07, 0.02, 0.9 * s, [['highpass', 6500, 0.7]], b);
  },

  explosion(v) {
    const t = v.t, p = v.p, s = v.size;
    const b = bus(v, 1, 0.35);
    const n = v.noise('white', t, t + 0.9 * s + 0.05);
    const lp = v.filter('lowpass', 9000, 0.7);
    sweep(lp.frequency, t, Math.min(9000 * p, nyq(v)), t + 0.5 * s, 350 * p);
    const sh = v.shaper('drive');
    const hp = v.filter('highpass', 60, 0.7);
    const g = v.gain(0);
    perc(g.gain, t, 0.62, 0.002, 0.7 * s);
    v.chain(n, lp, sh, hp, g, b);
    drop(v, t, 95 * p, 30 * p, 0.4, 0.95, 0.002, 1.0 * s, b);
    punch(v, t, 120 * p, 45 * p, 0.3, 0.5, 0.45 * s, b, 1500);
    const body = v.osc('triangle', 140 * p, t, t + 0.5);
    body.frequency.exponentialRampToValueAtTime(60 * p, t + 0.2);
    const bsh = v.shaper('soft');
    const bg = v.gain(0);
    perc(bg.gain, t, 0.3, 0.002, 0.35);
    v.chain(body, bsh, bg, b);
    const c = v.noise('crackle', t + 0.03, t + 1.2 * s + 0.2);
    const cbp = v.filter('bandpass', 2200, 0.7);
    const cg = v.gain(0);
    ahr(cg.gain, t + 0.03, 0.55, 0.04, 0.1, 0.9 * s);
    v.chain(c, cbp, cg, b);
    const r = v.noise('brown', t, t + 1.9 * s + 0.2);
    const rlp = v.filter('lowpass', 160, 0.8);
    const rg = v.gain(0);
    ahr(rg.gain, t, 0.5, 0.06, 0.2, 1.6 * s);
    v.chain(r, rlp, rg, b);
  },

  shatter(v) {
    const t = v.t, p = v.p, s = v.size;
    const L = v.panNode(-0.5), R = v.panNode(0.5);
    L.connect(v.out);
    R.connect(v.out);
    v.send(L, 0.3);
    v.send(R, 0.3);
    noiseHit(v, 'white', t, 0.4, 0.0003, 0.03, [['highpass', 2000, 0.7]], L);
    noiseHit(v, 'white', t, 0.3, 0.001, 0.18 * s, [['highpass', 4000, 0.7]], R);
    drop(v, t, 220 * p, 80 * p, 0.1, 0.3, 0.001, 0.12, L);
    const count = Math.round(10 + 9 * Math.min(v.i, 1.6));
    for (let k = 0; k < count; k++) {
      const tt = t + Math.pow(v.rnd(), 2) * 0.45 * s;
      const f = (2500 + v.rnd() * 6500) * p;
      const a = (0.05 + v.rnd() * 0.09) * (1 - (tt - t) * 1.2);
      tone(v, 'sine', f, tt, Math.max(a, 0.02), 0.0005, 0.05 + v.rnd() * 0.3, k % 2 ? L : R);
    }
  },

  gong(v) {
    const t = v.t, p = v.p, s = v.size;
    const f0 = 92 * p;
    const b = bus(v, 1, 0.45);
    // inharmonic partials (low → long, high → short). Upper partials "bloom" after the strike
    // like a real tam-tam, which is what makes the shimmering "bwaaash".
    const partials = [
      [0.5, 0.14, 5.0],
      [1.0, 0.3, 4.8],
      [1.012, 0.18, 4.5],
      [1.51, 0.24, 3.9],
      [1.98, 0.18, 3.2],
      [2.47, 0.16, 2.8],
      [2.94, 0.13, 2.4],
      [3.56, 0.11, 2.0],
      [4.23, 0.09, 1.7],
      [5.11, 0.075, 1.4],
      [6.3, 0.06, 1.2],
      [7.37, 0.05, 1.0],
      [8.71, 0.04, 0.85],
      [10.3, 0.032, 0.7],
      [12.4, 0.025, 0.55],
      [14.9, 0.02, 0.45],
    ];
    for (const [r, a, d] of partials) {
      const f = f0 * r;
      if (f >= nyq(v)) continue;
      const dd = d * s;
      const o = v.osc('sine', f * 0.985, t, t + dd + 0.5);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.3);
      const g = v.gain(0);
      const att = r > 2.4 ? Math.min(0.3, 0.05 + r * 0.02) : 0.004;
      perc2(g.gain, t, a, att, 0.25, 0.6, dd);
      o.connect(g).connect(b);
    }
    const mw = v.noise('pink', t, t + 3.2 * s);
    const mbp = v.filter('bandpass', 1700 * p, 1.4);
    const mwg = v.gain(0);
    swellEnv(mwg.gain, t, 0.05, 0.5, 2.6 * s);
    v.chain(mw, mbp, mwg, b);
    noiseHit(v, 'brown', t, 0.45, 0.002, 0.09, [['lowpass', 400 * p, 0.7]], b);
    noiseHit(v, 'white', t, 0.1, 0.001, 0.05, [['bandpass', 1200 * p, 1]], b);
    const w = v.noise('white', t, t + 3.0 * s);
    const wbp = v.filter('bandpass', 4500 * p, 1.5);
    const wg = v.gain(0);
    swellEnv(wg.gain, t, 0.035, 0.4, 2.4 * s);
    v.chain(w, wbp, wg, b);
  },

  taiko(v) {
    const t = v.t, p = v.p, s = v.size;
    const b = bus(v, 1, 0.14, 0.25);
    drop(v, t, 88 * p, 52 * p, 0.25, 0.6, 0.001, 0.7 * s, b);
    drop(v, t, 140 * p, 90 * p, 0.2, 0.28, 0.001, 0.25, b);
    noiseHit(v, 'white', t, 0.35, 0.0005, 0.03, [['lowpass', 1800, 0.7]], b);
    noiseHit(v, 'pink', t, 0.7, 0.001, 0.16, [['bandpass', 250 * p, 1.5]], b);
    noiseHit(v, 'white', t, 0.9, 0.0008, 0.06, [['bandpass', 750 * p, 1.2]], b);
    punch(v, t, 90 * p, 56 * p, 0.2, 0.55, 0.3 * s, b, 1400);
    const h = v.osc('triangle', 176 * p, t, t + 0.35);
    h.frequency.exponentialRampToValueAtTime(104 * p, t + 0.2);
    const sh = v.shaper('soft');
    const g = v.gain(0);
    perc(g.gain, t, 0.2, 0.001, 0.25);
    v.chain(h, sh, g, b);
  },

  glitch(v) {
    const t = v.t, p = v.p;
    const dur = 0.32 + 0.15 * v.size;
    const o = v.osc('square', 400 * p, t, t + dur + 0.03);
    const crush = v.shaper('crush', 'none');
    const bp = v.filter('bandpass', 1800, 0.8);
    const gate = v.gain(0);
    gate.gain.setValueAtTime(0, t);
    const n = v.noise('white', t, t + dur + 0.03);
    const nhp = v.filter('highpass', 2500, 0.7);
    const ngate = v.gain(0);
    ngate.gain.setValueAtTime(0, t);
    let tt = t;
    while (tt < t + dur) {
      const seg = 0.018 + v.rnd() * 0.035;
      const f = (80 + Math.pow(v.rnd(), 2) * 3200) * p;
      o.frequency.setValueAtTime(Math.min(f, nyq(v)), tt);
      bp.frequency.setValueAtTime(600 + v.rnd() * 4000, tt);
      const lvl = v.rnd() < 0.72 ? 0.12 + v.rnd() * 0.16 : 0;
      gate.gain.linearRampToValueAtTime(lvl, tt + 0.002);
      gate.gain.setValueAtTime(lvl, tt + seg - 0.002);
      const nl = v.rnd() < 0.35 ? 0.06 + v.rnd() * 0.08 : 0;
      ngate.gain.linearRampToValueAtTime(nl, tt + 0.002);
      ngate.gain.setValueAtTime(nl, tt + seg - 0.002);
      tt += seg;
    }
    gate.gain.linearRampToValueAtTime(0, tt + 0.003);
    ngate.gain.linearRampToValueAtTime(0, tt + 0.003);
    v.chain(o, crush, bp, gate, v.out);
    v.chain(n, nhp, ngate, v.out);
    tone(v, 'square', 60 * p, t, 0.1, 0.001, 0.05);
  },

  heartbeat(v) {
    const t = v.t, p = v.p;
    const b = bus(v, 1, 0, 0.1);
    const beat = (tt, amp, fr) => {
      drop(v, tt, 64 * p * fr, 40 * p * fr, 0.09, 0.85 * amp, 0.006, 0.2, b);
      const o = v.osc('triangle', 128 * p * fr, tt, tt + 0.16);
      o.frequency.exponentialRampToValueAtTime(80 * p * fr, tt + 0.08);
      const lp = v.filter('lowpass', 900, 0.7);
      const g = v.gain(0);
      perc(g.gain, tt, 0.6 * amp, 0.005, 0.12);
      v.chain(o, lp, g, b);
      punch(v, tt, 64 * p * fr, 42 * p * fr, 0.09, 0.3 * amp, 0.12, b, 700);
      thwack(v, tt, 420 * p * fr, 0.5 * amp, 0.07, b);
      noiseHit(v, 'brown', tt, 0.35 * amp, 0.004, 0.08, [['lowpass', 220, 0.7]], b);
    };
    beat(t, 1, 1);
    beat(t + 0.24, 0.75, 1.12);
  },

  zap(v) {
    const t = v.t, p = v.p;
    const dur = 0.22 + 0.12 * v.size;
    const b = bus(v, 1, 0.1);
    const o = v.osc('sawtooth', 2200 * p, t, t + dur + 0.03);
    o.frequency.exponentialRampToValueAtTime(140 * p, t + dur);
    const fm = v.osc('square', 73, t, t + dur + 0.03);
    const fmG = v.gain(0);
    fmG.gain.setValueAtTime(900 * p, t);
    fmG.gain.exponentialRampToValueAtTime(60 * p, t + dur);
    fm.connect(fmG).connect(o.frequency);
    const bp = v.filter('bandpass', 2400 * p, 0.9);
    const sh = v.shaper('drive');
    const g = v.gain(0);
    perc(g.gain, t, 0.28, 0.001, dur);
    v.chain(o, bp, sh, g, b);
    const c = v.noise('crackle', t, t + dur * 1.2 + 0.03);
    const chp = v.filter('highpass', 2500, 0.7);
    const cg = v.gain(0);
    perc(cg.gain, t, 0.5, 0.001, dur * 1.2);
    v.chain(c, chp, cg, b);
    tone(v, 'sine', 4200 * p, t, 0.07, 0.0005, 0.06, b);
  },

  sparkle(v) {
    const t = v.t, p = v.p;
    const L = v.panNode(-0.55), R = v.panNode(0.55);
    L.connect(v.out);
    R.connect(v.out);
    v.send(L, 0.35);
    v.send(R, 0.35);
    const scale = [88, 90, 92, 95, 97, 100, 102, 104]; // E major pentatonic, high
    const count = Math.round(6 + 5 * Math.min(v.i, 1.6));
    for (let k = 0; k < count; k++) {
      const tt = t + k * 0.055 + v.rnd() * 0.03;
      const f = mtof(scale[Math.floor(v.rnd() * scale.length)]) * p;
      const a = 0.06 + 0.05 * v.rnd();
      const d = 0.25 + 0.3 * v.rnd();
      const dest = k % 2 ? L : R;
      tone(v, 'sine', f, tt, a, 0.001, d, dest);
      tone(v, 'sine', f * 2.76, tt, a * 0.3, 0.0008, d * 0.4, dest);
    }
    const n = v.noise('white', t, t + 0.7);
    const hp = v.filter('highpass', 8000, 0.7);
    const g = v.gain(0);
    swellEnv(g.gain, t, 0.045, 0.06, 0.5);
    v.chain(n, hp, g, v.out);
  },

  menacing(v) {
    const t = v.t, p = v.p;
    const dur = 2.2 + 0.8 * v.size;
    const b = bus(v, 1, 0.3);
    const lp = v.filter('lowpass', 160 * p, 2.5);
    lp.frequency.setValueAtTime(160 * p, t);
    lp.frequency.exponentialRampToValueAtTime(420 * p, t + dur * 0.6);
    lp.frequency.exponentialRampToValueAtTime(150 * p, t + dur);
    // ゴ ゴ ゴ — rhythmic rumbling pulses
    const pulse = v.gain(0.5);
    pulse.gain.setValueAtTime(0.5, t);
    for (let tt = t; tt < t + dur; tt += 0.27) {
      pulse.gain.linearRampToValueAtTime(1, tt + 0.05);
      pulse.gain.linearRampToValueAtTime(0.45, tt + 0.25);
    }
    const env = v.gain(0);
    ahr(env.gain, t, 0.26, 0.6, Math.max(0, dur - 1.4), 0.8);
    for (const [f, a] of [[41.2, 1], [43.65, 0.8], [58.27, 0.6]]) {
      const o = v.osc('sawtooth', f * p, t, t + dur + 0.1, (v.rnd() - 0.5) * 8);
      const g = v.gain(a);
      o.connect(g).connect(lp);
    }
    v.chain(lp, pulse, env, b);
    // growl in the mid range (phone speakers)
    const gr = v.osc('sawtooth', 82.4 * p, t, t + dur + 0.1);
    gr.frequency.linearRampToValueAtTime(80 * p, t + dur);
    const gbp = v.filter('bandpass', 420 * p, 2.5);
    const gg = v.gain(0);
    ahr(gg.gain, t, 0.95, 0.5, Math.max(0, dur - 1.2), 0.7);
    v.chain(gr, gbp, gg, pulse);
    // rumble
    const r = v.noise('brown', t, t + dur + 0.1);
    const rlp = v.filter('lowpass', 110, 0.8);
    const rg = v.gain(0);
    ahr(rg.gain, t, 0.25, 0.4, Math.max(0, dur - 1.2), 0.8);
    v.chain(r, rlp, rg, b);
    // eerie high whine
    const w = v.osc('sine', 1244 * p, t, t + dur + 0.1);
    const wl = v.osc('sine', 5.5, t, t + dur + 0.1);
    const wd = v.gain(18);
    wl.connect(wd).connect(w.detune);
    const wg = v.gain(0);
    ahr(wg.gain, t, 0.035, 0.9, Math.max(0, dur - 1.6), 0.7);
    v.chain(w, wg, b);
  },
};

/** Ordered list of all SFX names (contract §5 order). */
export const SFX_NAMES = Object.keys(SFX);

export const CLASSIC_SFX = ['click', 'select', 'deselect', 'move', 'land', 'capture', 'combo', 'promote', 'illegal', 'turn', 'win', 'lose', 'draw', 'start', 'hint', 'undo'];
export const EPIC_SFX = SFX_NAMES.filter((n) => !CLASSIC_SFX.includes(n));

/**
 * Per-sound policy: `max` simultaneous instances (oldest is stolen), `gap` = minimum seconds
 * between two starts of the same sound (closer calls are merged), `len` = offline render length,
 * `gain` = output trim (calibrated with the offline bench so the set is loudness-balanced),
 * `vary` = random pitch spread applied by the live engine (non-tonal sounds only).
 */
export const SFX_META = {
  click: { max: 4, gap: 0.03, len: 0.6, gain: 1.3, vary: 0.04 },
  select: { max: 3, gap: 0.04, len: 1.2, gain: 1.15 },
  deselect: { max: 3, gap: 0.04, len: 1.2, gain: 1.0 },
  move: { max: 4, gap: 0.03, len: 1.0, gain: 2.3, vary: 0.06 },
  land: { max: 4, gap: 0.03, len: 1.5, gain: 0.8, vary: 0.05 },
  capture: { max: 4, gap: 0.04, len: 1.8, gain: 1.15, vary: 0.04 },
  combo: { max: 4, gap: 0.04, len: 4.0, gain: 1.3 },
  promote: { max: 2, gap: 0.1, len: 5.0, gain: 1.0 },
  illegal: { max: 2, gap: 0.06, len: 0.8, gain: 0.55, vary: 0.04 },
  turn: { max: 2, gap: 0.08, len: 1.5, gain: 1.15 },
  win: { max: 1, gap: 0.3, len: 5.5, gain: 0.87 },
  lose: { max: 1, gap: 0.3, len: 6.0, gain: 1.8 },
  draw: { max: 1, gap: 0.3, len: 5.0, gain: 1.4 },
  start: { max: 1, gap: 0.2, len: 4.5, gain: 1.3 },
  hint: { max: 2, gap: 0.1, len: 3.5, gain: 1.7 },
  undo: { max: 2, gap: 0.06, len: 1.2, gain: 2.4 },
  whoosh: { max: 4, gap: 0.03, len: 3.8, gain: 1.8, vary: 0.1 },
  dash: { max: 4, gap: 0.03, len: 3.4, gain: 1.1, vary: 0.1 },
  impact: { max: 4, gap: 0.03, len: 3.8, gain: 0.65, vary: 0.06 },
  bigImpact: { max: 3, gap: 0.05, len: 5.5, gain: 0.7, vary: 0.05 },
  slash: { max: 4, gap: 0.03, len: 4.5, gain: 1.25, vary: 0.06 },
  thunder: { max: 2, gap: 0.15, len: 7.5, gain: 1.5, vary: 0.08 },
  charge: { max: 2, gap: 0.1, len: 5.0, gain: 1.0 },
  explosion: { max: 3, gap: 0.05, len: 5.5, gain: 0.4, vary: 0.06 },
  shatter: { max: 3, gap: 0.04, len: 3.8, gain: 1.2, vary: 0.08 },
  gong: { max: 2, gap: 0.2, len: 9.0, gain: 0.7 },
  taiko: { max: 6, gap: 0.03, len: 3.8, gain: 0.7, vary: 0.04 },
  riser: { max: 2, gap: 0.2, len: 5.5, gain: 1.3 },
  swell: { max: 2, gap: 0.2, len: 5.0, gain: 1.0 },
  power: { max: 2, gap: 0.1, len: 5.0, gain: 0.9 },
  glitch: { max: 3, gap: 0.04, len: 1.0, gain: 1.0, vary: 0.15 },
  heartbeat: { max: 2, gap: 0.12, len: 1.4, gain: 0.5, vary: 0.03 },
  zap: { max: 4, gap: 0.03, len: 3.2, gain: 1.4, vary: 0.08 },
  boom: { max: 3, gap: 0.05, len: 6.0, gain: 0.75, vary: 0.05 },
  sparkle: { max: 3, gap: 0.05, len: 4.0, gain: 2.2 },
  menacing: { max: 1, gap: 0.5, len: 7.0, gain: 0.6 },
};
export const DEFAULT_META = { max: 6, gap: 0.03, len: 4 };

/** True if `name` is a known SFX. */
export function hasSfx(name) {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(SFX, name);
}

/**
 * Plays SFX `name` on any context (live or offline) into `busNodes` ({dry, hall, room}) at time
 * `t`. Returns the Voice, or null for unknown names.
 */
export function startSfx(ctx, res, busNodes, name, t, opts = {}) {
  if (!hasSfx(name)) return null;
  const meta = SFX_META[name] || DEFAULT_META;
  const g = (Number.isFinite(opts.gain) ? opts.gain : 1) * (meta.gain || 1);
  const v = new Voice(ctx, res, busNodes, t, { ...opts, gain: g });
  SFX[name](v);
  return v;
}

export { clamp };
