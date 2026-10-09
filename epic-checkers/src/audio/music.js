// Generative music: cheap synth instruments + step-sequenced tracks driven by a lookahead
// scheduler. A TrackPlayer works on any BaseAudioContext: the live engine calls
// scheduleUntil(now + lookahead) from a timer, offline tests call it in chunks.
//
// Tracks:
//   menu    — D minor, 80 bpm: choir pad, low drone, distant taiko, bells, wind. Atmospheric.
//   classic — F major, 70 bpm: soft piano with gentle generative arpeggios + melody, warm pad.
//   epic    — E minor, 150 bpm anime battle: taiko, galloping bass, power chords, arps, lead.
//             setIntensity(0..1) fades layers in/out (0 = drums+bass+pad … 1 = everything).
//   victory — one-shot triumphant brass fanfare (E major) that rings out and fades.
//   defeat  — one-shot sad piano/pad stinger (A minor).

import { mtof, perc, perc2, ahr, sweep, clamp, mulberry32, holdAt } from './core.js';

// ------------------------------------------------------------------------------------------
// Player
// ------------------------------------------------------------------------------------------

const FADE_STEPS = 12;

export class TrackPlayer {
  /**
   * @param ctx  BaseAudioContext
   * @param res  shared resources
   * @param def  track definition (TRACKS[name])
   * @param dest { dry, hall } music bus inputs
   */
  constructor(ctx, res, def, dest, { intensity = 0.35, seed, solo = null } = {}) {
    this.ctx = ctx;
    this.res = res;
    this.def = def;
    this.name = def.name;
    this.rng = mulberry32(seed != null ? seed : (Math.random() * 4294967296) >>> 0);
    this.out = this.gain(0);
    this.out.connect(dest.dry);
    this.revOut = this.gain(0);
    this.revOut.connect(dest.hall);
    this.rev = this.gain(def.reverb != null ? def.reverb : 0.3);
    this.rev.connect(this.revOut);
    this.intensity = clamp(intensity, 0, 1);
    this.spb = 60 / def.bpm / 4; // seconds per 16th step
    this.step = 0;
    this.t0 = 0;
    this.next = 0;
    this.started = false;
    this.done = false;
    this.endTime = Infinity;
    this.stopTime = Infinity;
    this.long = []; // long-running sources ({ node, end }) stopped on dispose
    this.nodes = {};
    this.layers = [];
    this.state = {};
    this.solo = solo; // (tests) array of instrument names to render alone
    this.queue = null; // one-shot: deferred instrument calls [time, name, args]
    this.queueHorizon = 0;
    this.level = def.gain != null ? def.gain : 1;
    if (def.setup) def.setup(this);
  }

  // ---- node helpers ------------------------------------------------------------------------
  gain(v = 1) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }
  filter(type, f, Q = 0.707) {
    const n = this.ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = Math.min(f, this.ctx.sampleRate * 0.45);
    n.Q.value = Q;
    return n;
  }
  shaper(name = 'soft') {
    const s = this.ctx.createWaveShaper();
    s.curve = this.res.curve[name];
    s.oversample = 'none';
    return s;
  }
  osc(type, f, t0, t1, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    if (detune) o.detune.setValueAtTime(detune, t0);
    o.start(t0);
    o.stop(t1);
    if (t1 - t0 > 2) this.long.push({ node: o, end: t1 });
    return o;
  }
  noise(kind, t0, t1, rate = 1) {
    const s = this.ctx.createBufferSource();
    const buf = this.res.noise[kind];
    s.buffer = buf;
    s.loop = true;
    if (rate !== 1) s.playbackRate.value = rate;
    s.start(t0, this.rng() * buf.duration * 0.9);
    s.stop(t1);
    if (t1 - t0 > 2) this.long.push({ node: s, end: t1 });
    return s;
  }
  /** Reverb send of `node` with amount. */
  send(node, amt) {
    if (amt > 0) node.connect(this.gain(amt)).connect(this.rev);
    return node;
  }
  /** A layer gain (0 … 1 follows intensity thresholds) connected to the track output. */
  layer(threshold = 0, width = 0.2) {
    const g = this.gain(layerLevel(this.intensity, threshold, width));
    g.connect(this.out);
    const l = { node: g, threshold, width };
    this.layers.push(l);
    return g;
  }
  /** Is layer `i` currently audible (worth scheduling notes for)? */
  on(i) {
    const l = this.layers[i];
    return !!l && layerLevel(this.intensity, l.threshold, l.width) > 0.001;
  }

  // ---- transport ---------------------------------------------------------------------------
  start(t, fadeSec = 0.05) {
    this.t0 = t;
    this.next = t;
    this.step = 0;
    this.started = true;
    for (const p of [this.out.gain, this.revOut.gain]) {
      p.setValueAtTime(0, t);
      for (let k = 1; k <= FADE_STEPS; k++) {
        p.linearRampToValueAtTime(this.level * Math.sin(((k / FADE_STEPS) * Math.PI) / 2), t + (fadeSec * k) / FADE_STEPS);
      }
    }
    if (this.def.oneShot) this.endTime = t + this.def.length;
  }

  /** Equal-power fade-out starting at `t`; the player is finished after stopTime. */
  fadeOut(t, sec) {
    sec = Math.max(0.02, sec);
    for (const p of [this.out.gain, this.revOut.gain]) {
      const v0 = clamp(p.value, 0, 4);
      holdAt(p, t);
      for (let k = 1; k <= FADE_STEPS; k++) {
        p.linearRampToValueAtTime(v0 * Math.cos(((k / FADE_STEPS) * Math.PI) / 2), t + (sec * k) / FADE_STEPS);
      }
    }
    this.stopTime = t + sec;
  }

  setIntensity(x, t = this.ctx.currentTime) {
    this.intensity = clamp(Number(x) || 0, 0, 1);
    for (const l of this.layers) {
      const p = l.node.gain;
      holdAt(p, t);
      p.setTargetAtTime(layerLevel(this.intensity, l.threshold, l.width), t, 0.18);
    }
  }

  /** Schedules all steps whose start time is < tEnd. Steps in the past are skipped (stall). */
  scheduleUntil(tEnd) {
    if (!this.started || this.done) return;
    const now = this.ctx.currentTime;
    if (this.def.oneShot) {
      // The score is written in one go; instrument calls beyond the lookahead horizon are queued
      // and created progressively, so a stinger never builds hundreds of nodes in one frame.
      this.queueHorizon = tEnd;
      if (!this.state.scheduled) {
        this.state.scheduled = true;
        this.queue = [];
        this.def.schedule(this, this.t0);
        this.queue.sort((a, b) => a[0] - b[0]);
      }
      while (this.queue.length && this.queue[0][0] < tEnd && now < this.stopTime) {
        const [, k, args] = this.queue.shift();
        I[k](this, ...args);
      }
      if (now > this.endTime || now > this.stopTime) this.done = true;
      return;
    }
    while (this.next < tEnd && this.next < this.stopTime) {
      if (this.next >= now - 0.005) this.def.step(this, this.step, this.next);
      this.step++;
      this.next = this.t0 + this.step * this.spb;
    }
    if (now > this.stopTime) this.done = true;
    // forget long sources that already ended
    if (this.long.length > 64) this.long = this.long.filter((x) => x.end > now);
  }

  dispose() {
    this.done = true;
    const now = this.ctx.currentTime;
    for (const x of this.long) {
      if (x.end > now) {
        try {
          x.node.stop(now + 0.01);
        } catch (e) {
          /* ignore */
        }
      }
    }
    this.long.length = 0;
    for (const n of [this.out, this.revOut, this.rev]) {
      try {
        n.disconnect();
      } catch (e) {
        /* ignore */
      }
    }
    if (this.def.teardown) this.def.teardown(this);
  }
}

function layerLevel(x, thr, width) {
  if (thr <= 0) return 1;
  const k = clamp((x - thr + width * 0.5) / width, 0, 1);
  return k * k * (3 - 2 * k); // smoothstep
}

// ------------------------------------------------------------------------------------------
// Instruments. (P = TrackPlayer, d = destination node, t = time, m = midi note, vel 0..1)
// ------------------------------------------------------------------------------------------

const I = {
  piano(P, d, t, m, vel, dec = 2.4, rev = 0.25) {
    const f = mtof(m);
    const end = t + dec + 0.25;
    const o1 = P.osc('triangle', f, t, end, (P.rng() - 0.5) * 6);
    const o2 = P.osc('sine', f * 2.003, t, t + dec * 0.45 + 0.1);
    const lp = P.filter('lowpass', Math.min(f * 6, 8000), 0.4);
    sweep(lp.frequency, t, Math.min(f * 7, 9000), t + 0.5, Math.min(f * 2.2, 4500));
    const g = P.gain(0);
    const pk = 0.36 * vel;
    perc2(g.gain, t, pk, 0.004, 0.14, 0.4, dec);
    const g2 = P.gain(0);
    perc(g2.gain, t, pk * 0.2, 0.003, dec * 0.4);
    o1.connect(lp).connect(g).connect(d);
    o2.connect(g2).connect(d);
    P.send(g, rev);
  },

  pad(P, d, t, notes, len, { a = 0.6, r = 1.2, cutoff = 900, level = 0.05, type = 'sawtooth', det = 8, rev = 0.4, q = 0.8 } = {}) {
    const end = t + len + r + 0.1;
    const lp = P.filter('lowpass', cutoff, q);
    const g = P.gain(0);
    ahr(g.gain, t, level, a, Math.max(0, len - a), r);
    // one oscillator per note, alternating detune → chorus-like width at half the CPU
    notes.forEach((m, k) => {
      P.osc(type, mtof(m), t, end, (k % 2 ? det : -det) + (P.rng() - 0.5) * 4).connect(lp);
    });
    if (notes.length <= 2) for (const m of notes) P.osc(type, mtof(m), t, end, det * 0.6).connect(lp);
    lp.connect(g).connect(d);
    P.send(g, rev);
  },

  choir(P, d, t, notes, len, { a = 1.0, r = 1.6, level = 0.045, rev = 0.6 } = {}) {
    // saw stack through two vocal formant band-passes ("aah")
    const end = t + len + r + 0.1;
    const f1 = P.filter('bandpass', 750, 2.5);
    const f2 = P.filter('bandpass', 1150, 3);
    const lp = P.filter('lowpass', 2600, 0.5);
    const g = P.gain(0);
    ahr(g.gain, t, level, a, Math.max(0, len - a), r);
    const sum = P.gain(1);
    for (const m of notes) {
      const f = mtof(m);
      for (const det of [-8, 8]) P.osc('sawtooth', f, t, end, det + (P.rng() - 0.5) * 4).connect(sum);
    }
    sum.connect(f1).connect(lp);
    sum.connect(f2).connect(lp);
    const body = P.gain(0.25);
    sum.connect(body).connect(lp);
    lp.connect(g).connect(d);
    P.send(g, rev);
  },

  drone(P, d, t, notes, len, { a = 2, r = 2, level = 0.07, cutoff = 220 } = {}) {
    const end = t + len + r + 0.1;
    const lp = P.filter('lowpass', cutoff, 1.5);
    lp.frequency.setValueAtTime(cutoff * 0.7, t);
    lp.frequency.linearRampToValueAtTime(cutoff * 1.4, t + len * 0.5);
    lp.frequency.linearRampToValueAtTime(cutoff * 0.8, t + len + r);
    const g = P.gain(0);
    ahr(g.gain, t, level, a, Math.max(0, len - a), r);
    for (const m of notes) {
      P.osc('sawtooth', mtof(m), t, end, -6).connect(lp);
      P.osc('sawtooth', mtof(m), t, end, 5).connect(lp);
    }
    lp.connect(g).connect(d);
    P.send(g, 0.3);
  },

  bass(P, d, t, m, vel, len) {
    const f = mtof(m);
    const end = t + len + 0.12;
    const o = P.osc('sawtooth', f, t, end);
    const o2 = P.osc('square', f * 0.5, t, end);
    const lp = P.filter('lowpass', 400, 3);
    lp.frequency.setValueAtTime(2000 * (0.6 + 0.4 * vel), t);
    lp.frequency.exponentialRampToValueAtTime(420, t + 0.15);
    const g = P.gain(0);
    ahr(g.gain, t, 0.12 * vel, 0.003, Math.max(0, len * 0.55), 0.07);
    const g2 = P.gain(0.5);
    o.connect(lp);
    o2.connect(g2).connect(lp);
    lp.connect(g).connect(d);
  },

  kick(P, d, t, vel) {
    const o = P.osc('sine', 150, t, t + 0.4);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.09);
    const g = P.gain(0);
    perc(g.gain, t, 0.36 * vel, 0.001, 0.32);
    o.connect(g).connect(d);
    const c = P.osc('triangle', 900, t, t + 0.03);
    c.frequency.exponentialRampToValueAtTime(200, t + 0.02);
    const cg = P.gain(0);
    perc(cg.gain, t, 0.08 * vel, 0.0005, 0.02);
    c.connect(cg).connect(d);
  },

  snare(P, d, t, vel, bp = P.nodes.snareBP) {
    const n = P.noise('white', t, t + 0.25);
    const g = P.gain(0);
    perc(g.gain, t, 0.8 * vel, 0.001, 0.17);
    n.connect(g).connect(bp || d);
    const o = P.osc('triangle', 190, t, t + 0.12);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.06);
    const og = P.gain(0);
    perc(og.gain, t, 0.45 * vel, 0.001, 0.08);
    o.connect(og).connect(d);
    P.send(g, 0.15);
  },

  hat(P, d, t, vel, open = false) {
    const dec = open ? 0.28 : 0.045;
    const n = P.noise('white', t, t + dec + 0.03);
    const g = P.gain(0);
    perc(g.gain, t, 0.36 * vel, 0.001, dec);
    n.connect(g).connect(d);
  },

  crash(P, d, t, vel) {
    const n = P.noise('white', t, t + 2.0);
    const hp = P.filter('highpass', 4500, 0.6);
    const g = P.gain(0);
    perc2(g.gain, t, 0.24 * vel, 0.002, 0.15, 0.5, 1.6);
    n.connect(hp).connect(g).connect(d);
    P.send(g, 0.3);
  },

  taiko(P, d, t, vel, pitch = 1, rev = 0.25) {
    const o = P.osc('sine', 92 * pitch, t, t + 0.65);
    o.frequency.exponentialRampToValueAtTime(55 * pitch, t + 0.22);
    const g = P.gain(0);
    perc(g.gain, t, 0.45 * vel, 0.001, 0.55);
    o.connect(g).connect(d);
    // saturated copy of the membrane → harmonics in the 200 Hz – 1.5 kHz range (phone speakers)
    const h = P.osc('sine', 92 * pitch, t, t + 0.3);
    h.frequency.exponentialRampToValueAtTime(55 * pitch, t + 0.22);
    const hs = P.shaper('drive');
    const hlp = P.filter('lowpass', 1400, 0.7);
    const hg = P.gain(0);
    perc(hg.gain, t, 0.24 * vel, 0.001, 0.24);
    h.connect(hs).connect(hlp).connect(hg).connect(d);
    const n = P.noise('pink', t, t + 0.14);
    const ng = P.gain(0);
    perc(ng.gain, t, 0.5 * vel, 0.0008, 0.1);
    n.connect(ng).connect(P.nodes.taikoBP || d);
    P.send(g, rev);
    P.send(hg, rev);
  },

  timp(P, d, t, m, vel, dec = 1.2) {
    const f = mtof(m);
    for (const [r, a, dd] of [[1, 1, 1], [1.5, 0.35, 0.6], [1.98, 0.18, 0.4]]) {
      const o = P.osc('sine', f * r * 1.03, t, t + dec * dd + 0.1);
      o.frequency.exponentialRampToValueAtTime(f * r, t + 0.06);
      const g = P.gain(0);
      perc(g.gain, t, 0.3 * vel * a, 0.002, dec * dd);
      o.connect(g).connect(d);
      P.send(g, 0.25);
    }
    const n = P.noise('brown', t, t + 0.08);
    const ng = P.gain(0);
    perc(ng.gain, t, 0.2 * vel, 0.001, 0.05);
    n.connect(ng).connect(d);
  },

  stab(P, d, t, notes, vel, len) {
    // power chord into the track's distortion bus
    const end = t + len + 0.15;
    const g = P.gain(0);
    ahr(g.gain, t, 0.05 * vel, 0.004, Math.max(0, len - 0.05), 0.09);
    for (const m of notes) P.osc('sawtooth', mtof(m), t, end, (P.rng() - 0.5) * 10).connect(g);
    g.connect(d);
  },

  arp(P, d, t, m, vel, len) {
    const o = P.osc('square', mtof(m), t, t + len * 1.8 + 0.05);
    const g = P.gain(0);
    perc(g.gain, t, 0.1 * vel, 0.002, len * 1.8);
    o.connect(g).connect(d);
  },

  lead(P, d, t, m, vel, len, double = false) {
    const f = mtof(m);
    const end = t + len + 0.25;
    const prev = double ? null : P.state.leadPrev; // portamento from the previous melody note
    const g = P.gain(0);
    ahr(g.gain, t, 0.05 * vel, 0.012, Math.max(0, len - 0.04), 0.16);
    for (const [type, det] of [['sawtooth', -7], ['square', 5]]) {
      const o = P.osc(type, prev && Math.abs(prev - m) <= 7 ? mtof(prev) : f, t, end, det);
      if (prev && Math.abs(prev - m) <= 7) o.frequency.exponentialRampToValueAtTime(f, t + 0.035);
      if (P.nodes.vib) P.nodes.vib.connect(o.detune);
      o.connect(g);
    }
    if (!double) P.state.leadPrev = m;
    g.connect(d);
  },

  bell(P, d, t, m, vel, dec = 2.5, rev = 0.5) {
    const f = mtof(m);
    const end = t + dec + 0.1;
    const car = P.osc('sine', f, t, end);
    const mod = P.osc('sine', f * 3.5, t, end);
    const mg = P.gain(0);
    mg.gain.setValueAtTime(f * 1.1, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.04, t + dec * 0.5);
    mod.connect(mg).connect(car.frequency);
    const g = P.gain(0);
    perc2(g.gain, t, 0.12 * vel, 0.002, dec * 0.1, 0.45, dec * 0.88);
    car.connect(g).connect(d);
    P.send(g, rev);
  },

  pluck(P, d, t, m, vel, dec = 0.9) {
    // harp-like: triangle with fast low-pass decay
    const f = mtof(m);
    const o = P.osc('triangle', f, t, t + dec + 0.05);
    const lp = P.filter('lowpass', f * 5, 0.5);
    sweep(lp.frequency, t, Math.min(f * 8, 9000), t + 0.2, f * 1.5);
    const g = P.gain(0);
    perc(g.gain, t, 0.07 * vel, 0.002, dec);
    o.connect(lp).connect(g).connect(d);
    P.send(g, 0.45);
  },

  brass(P, d, t, m, vel, len, rel = 0.35) {
    const f = mtof(m);
    const end = t + len + rel + 0.1;
    const lp = P.filter('lowpass', f * 1.3, 1.2);
    lp.frequency.setValueAtTime(Math.min(f * 1.3, 9000), t);
    lp.frequency.exponentialRampToValueAtTime(Math.min(f * 7, 9000), t + 0.07);
    lp.frequency.exponentialRampToValueAtTime(Math.min(f * 3.5, 7000), t + 0.07 + Math.min(len, 0.4));
    for (const det of [-7, 7]) {
      const o = P.osc('sawtooth', f, t, end, det + (P.rng() - 0.5) * 4);
      if (len > 1 && P.nodes.vib) P.nodes.vib.connect(o.detune); // vibrato on held notes
      o.connect(lp);
    }
    const g = P.gain(0);
    ahr(g.gain, t, 0.05 * vel, 0.03, Math.max(0, len - 0.03), rel);
    lp.connect(g).connect(d);
    P.send(g, 0.35);
  },

  gust(P, d, t, len, level = 0.03) {
    const n = P.noise('pink', t, t + len + 0.1);
    const bp = P.filter('bandpass', 500, 1.8);
    const f0 = 300 + P.rng() * 300;
    sweep(bp.frequency, t, f0, t + len * 0.6, f0 * (2 + P.rng() * 2));
    bp.frequency.exponentialRampToValueAtTime(f0 * 1.2, t + len);
    const g = P.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + len * 0.5);
    g.gain.linearRampToValueAtTime(0, t + len);
    n.connect(bp).connect(g).connect(d);
    P.send(g, 0.5);
  },
};

// solo support for stem tests: an instrument call is skipped unless P.solo includes it
// (and deferral of one-shot score events beyond the scheduler horizon, see scheduleUntil)
for (const k of Object.keys(I)) {
  const f = I[k];
  I[k] = (P, ...a) => {
    if (P.solo && !P.solo.includes(k)) return undefined;
    if (P.queue && a[1] >= P.queueHorizon) {
      P.queue.push([a[1], k, a]);
      return undefined;
    }
    return f(P, ...a);
  };
}

// ------------------------------------------------------------------------------------------
// Track: EPIC — anime battle, E minor, 150 bpm, 8-bar loop
// ------------------------------------------------------------------------------------------

const EPIC_CHORDS = {
  Em: { root: 40, pad: [52, 55, 59, 64], tones: [64, 67, 71, 76, 79], power: [52, 59, 64] },
  C: { root: 36, pad: [48, 55, 60, 64], tones: [60, 64, 67, 72, 76], power: [48, 55, 60] },
  D: { root: 38, pad: [50, 57, 62, 66], tones: [62, 66, 69, 74, 78], power: [50, 57, 62] },
  B: { root: 35, pad: [47, 54, 59, 63], tones: [59, 63, 66, 71, 75], power: [47, 54, 59] },
  Am: { root: 33, pad: [45, 57, 60, 64], tones: [57, 60, 64, 69, 72], power: [45, 52, 57] },
};
const EPIC_PROG = ['Em', 'C', 'D', 'B', 'Em', 'C', 'Am', 'B'];
// taiko: pos → [velocity, pitch]
const EPIC_TAIKO = { 0: [1, 1], 3: [0.32, 1.5], 6: [0.7, 1.2], 8: [0.92, 1], 11: [0.38, 1.5], 12: [0.6, 1.25], 14: [0.5, 1.35] };
const GALLOP = [1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1];
const DRIVE = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0];
const STABS = [[0, 3], [3, 3], [6, 2], [10, 2], [12, 4]];
const ARP_ORDER = [0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 2, 3, 4, 3, 2, 1];
const ARP_ORDER_B = [0, 2, 1, 3, 2, 4, 3, 1, 0, 2, 1, 3, 2, 4, 3, 2];
// lead melody: bar → [[pos, midi, lenSteps], ...] (E minor, heroic)
const EPIC_LEAD = [
  [[0, 64, 4], [4, 67, 2], [6, 71, 4], [10, 69, 2], [12, 67, 2], [14, 66, 2]],
  [[0, 64, 6], [6, 62, 2], [8, 60, 4], [12, 62, 2], [14, 64, 2]],
  [[0, 66, 4], [4, 69, 4], [8, 74, 4], [12, 72, 2], [14, 71, 2]],
  [[0, 71, 8], [8, 69, 2], [10, 67, 2], [12, 66, 2], [14, 63, 2]],
  [[0, 64, 4], [4, 59, 2], [6, 64, 2], [8, 67, 4], [12, 71, 4]],
  [[0, 72, 6], [6, 71, 2], [8, 67, 4], [12, 64, 4]],
  [[0, 69, 4], [4, 72, 4], [8, 76, 4], [12, 74, 2], [14, 72, 2]],
  [[0, 71, 8], [8, 66, 4], [12, 63, 4]],
];

const EPIC = {
  name: 'epic',
  bpm: 150,
  gain: 0.75,
  reverb: 0.22,
  setup(P) {
    const L0 = P.layer(0);
    const L1 = P.layer(0.3);
    const L2 = P.layer(0.55);
    const L3 = P.layer(0.8);
    P.L = [L0, L1, L2, L3];
    P.nodes.taikoBP = P.filter('bandpass', 320, 1.2);
    P.nodes.taikoBP.connect(L0);
    P.nodes.snareBP = P.filter('bandpass', 2600, 0.7);
    P.nodes.snareBP.connect(L1);
    P.nodes.snareBP3 = P.filter('bandpass', 2900, 0.7);
    P.nodes.snareBP3.connect(L3);
    P.nodes.hat2 = P.filter('highpass', 7500, 0.7);
    P.nodes.hat2.connect(L2);
    P.nodes.hat3 = P.filter('highpass', 8500, 0.7);
    P.nodes.hat3.connect(L3);
    // power chord bus: saturate → tame → layer 1
    const drive = P.shaper('drive');
    const lp = P.filter('lowpass', 2800, 0.8);
    const hp = P.filter('highpass', 100, 0.7);
    const pg = P.gain(0.28);
    drive.connect(lp).connect(hp).connect(pg).connect(L1);
    P.send(pg, 0.15);
    P.nodes.power = drive;
    // echo (dotted 8th) for arps and lead
    const echo = P.ctx.createDelay(1.0);
    echo.delayTime.value = P.spb * 3;
    const fb = P.gain(0.3);
    const elp = P.filter('lowpass', 2600, 0.5);
    const eout = P.gain(0.45);
    echo.connect(elp).connect(fb).connect(echo);
    elp.connect(eout).connect(P.out);
    P.nodes.echo = echo;
    P.nodes.echoNodes = [echo, fb, elp, eout];
    // arp + lead buses
    const arpLP = P.filter('lowpass', 2600, 2);
    arpLP.connect(L2);
    const arpEcho = P.gain(0.5);
    arpLP.connect(arpEcho).connect(echo);
    P.nodes.arp = arpLP;
    const leadLP = P.filter('lowpass', 3200, 0.9);
    leadLP.connect(L3);
    const leadEcho = P.gain(0.35);
    leadLP.connect(leadEcho).connect(echo);
    P.send(leadLP, 0.25);
    P.nodes.lead = leadLP;
    // lead vibrato LFO (runs for the life of the track)
    const lfo = P.ctx.createOscillator();
    lfo.frequency.value = 5.6;
    const vib = P.gain(13);
    lfo.connect(vib);
    lfo.start(P.ctx.currentTime);
    P.nodes.lfo = lfo;
    P.nodes.vib = vib;
  },
  teardown(P) {
    try {
      P.nodes.lfo.stop();
    } catch (e) {
      /* ignore */
    }
    for (const n of P.nodes.echoNodes) n.disconnect();
  },
  step(P, s, t) {
    const pos = s % 16;
    const barAbs = Math.floor(s / 16);
    const bar = barAbs % 8;
    const pass = Math.floor(barAbs / 8);
    const ch = EPIC_CHORDS[EPIC_PROG[bar]];
    const spb = P.spb;
    const L = P.L;
    const x = P.intensity;
    const r = P.rng;

    // ---- L0: taiko, bass, pad (always) ----
    const tk = EPIC_TAIKO[pos];
    const tv = 0.55 + 0.35 * x; // drums grow with intensity
    if (bar === 7 && pos >= 8) {
      const k = (pos - 8) / 7;
      I.taiko(P, L[0], t, (0.35 + 0.6 * k) * tv, pos % 2 ? 1.3 : 1.05);
    } else if (tk) {
      I.taiko(P, L[0], t, tk[0] * (0.88 + 0.12 * r()) * tv, tk[1]);
    } else if (r() < 0.12) {
      I.taiko(P, L[0], t, 0.18 * tv, 1.55);
    }
    const pattern = x >= 0.3 ? GALLOP : DRIVE;
    if (pattern[pos]) {
      const up = (pos === 6 || pos === 14) && x >= 0.3 ? 12 : 0;
      I.bass(P, L[0], t, ch.root + up, (pos % 4 === 0 ? 1 : 0.8) * (0.75 + 0.25 * x), spb * (pos === 0 ? 2 : 1));
    }
    if (pos === 0) I.pad(P, L[0], t, ch.pad, spb * 16, { a: 0.12, r: 0.45, cutoff: 1100 + 500 * x, level: 0.026, rev: 0.35 });

    // ---- L1: kick, snare, power chords, crash ----
    if (P.on(1)) {
      if (pos === 0 || pos === 8 || (pos === 10 && bar % 2 === 1) || (pos === 7 && bar % 4 === 3)) I.kick(P, L[1], t, pos === 0 ? 1 : 0.85);
      if (pos === 4 || pos === 12) I.snare(P, L[1], t, 1);
      for (const [sp, len] of STABS) {
        if (sp === pos) I.stab(P, P.nodes.power, t, ch.power, sp === 0 ? 1 : 0.85, spb * len * 0.9);
      }
      if (pos === 0 && (bar === 0 || bar === 4)) I.crash(P, L[1], t, bar === 0 ? 1 : 0.75);
    }

    // ---- L2: arpeggio + 8th hats ----
    if (P.on(2)) {
      const order = pass % 2 ? ARP_ORDER_B : ARP_ORDER;
      I.arp(P, P.nodes.arp, t, ch.tones[order[pos]], pos % 4 === 0 ? 1 : 0.75, spb);
      if (pos % 2 === 0) I.hat(P, P.nodes.hat2, t, pos % 4 === 2 ? 1 : 0.6);
    }

    // ---- L3: 16th hats, lead melody, snare rolls, double kicks ----
    if (P.on(3)) {
      if (pos % 2 === 1) I.hat(P, P.nodes.hat3, t + (r() - 0.5) * 0.004, 0.45 + 0.2 * r(), pos === 15 && bar % 2 === 1);
      for (const [lp, m, len] of EPIC_LEAD[bar]) {
        if (lp !== pos) continue;
        // every other pass the second half is doubled an octave up for a climax
        const climax = pass % 2 === 1 && bar >= 4;
        I.lead(P, P.nodes.lead, t, m, climax ? 0.8 : 1, spb * len * 0.95);
        if (climax) I.lead(P, P.nodes.lead, t, m + 12, 0.45, spb * len * 0.95, true);
      }
      if ((bar === 3 || bar === 7) && pos >= 12) {
        // 32nd-note snare roll, crescendo
        for (let h = 0; h < 2; h++) I.snare(P, L[3], t + h * spb * 0.5, 0.35 + ((pos - 12) * 2 + h) * 0.08, P.nodes.snareBP3);
      }
      if (bar % 2 === 1 && (pos === 14 || pos === 15)) I.kick(P, L[3], t, 0.7);
    }
  },
};

// ------------------------------------------------------------------------------------------
// Track: MENU — D minor, 80 bpm, atmospheric with a hint of epic
// ------------------------------------------------------------------------------------------

const MENU_CHORDS = {
  Dm: { root: 38, pad: [57, 62, 65, 69] },
  Bb: { root: 34, pad: [58, 62, 65, 70] },
  F: { root: 41, pad: [57, 60, 65, 69] },
  C: { root: 36, pad: [55, 60, 64, 67] },
  Gm: { root: 43, pad: [55, 58, 62, 67] },
  A: { root: 45, pad: [57, 61, 64, 69] },
};
const MENU_PROG = ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A'];
const MENU_BELLS = [74, 77, 79, 81, 84, 86];

const MENU = {
  name: 'menu',
  bpm: 80,
  gain: 1.1,
  reverb: 0.5,
  setup(P) {
    P.main = P.gain(1);
    P.main.connect(P.out);
    P.nodes.taikoBP = P.filter('bandpass', 280, 1.2);
    P.nodes.taikoBP.connect(P.main);
    const echo = P.ctx.createDelay(1.5);
    echo.delayTime.value = P.spb * 3;
    const fb = P.gain(0.35);
    const elp = P.filter('lowpass', 3000, 0.5);
    const eout = P.gain(0.5);
    echo.connect(elp).connect(fb).connect(echo);
    elp.connect(eout).connect(P.out);
    P.send(eout, 0.4);
    P.nodes.echo = echo;
    P.nodes.echoNodes = [echo, fb, elp, eout];
    // bells play dry + into the echo
    const bells = P.gain(1);
    bells.connect(P.main);
    bells.connect(P.gain(0.7)).connect(echo);
    P.nodes.bells = bells;
    P.state.bell = 2;
  },
  teardown(P) {
    for (const n of P.nodes.echoNodes) n.disconnect();
  },
  step(P, s, t) {
    const pos = s % 16;
    const barAbs = Math.floor(s / 16);
    const bar = barAbs % 8;
    const pass = Math.floor(barAbs / 8);
    const ch = MENU_CHORDS[MENU_PROG[bar]];
    const spb = P.spb;
    const barLen = spb * 16;
    const r = P.rng;
    const d = P.main;

    if (pos === 0) {
      I.choir(P, d, t, ch.pad, barLen + 0.4, { a: 1.1, r: 1.6, level: 0.03 });
      I.pad(P, d, t, [ch.pad[0] - 12, ch.pad[2] - 12], barLen + 0.4, { a: 0.9, r: 1.4, cutoff: 700, level: 0.03, rev: 0.5 });
      if (bar % 4 === 0) I.drone(P, d, t, [38, 45], barLen * 4, { a: 2.5, r: 2.5, level: 0.05, cutoff: 200 });
      I.taiko(P, d, t, bar % 4 === 0 ? 0.7 : 0.36, 0.9, 0.7);
      if (bar % 2 === 0) I.gust(P, d, t + spb * 4, barLen * 1.4, 0.1);
    }
    // hint of epic: double taiko pickup at the end of each 4-bar phrase
    if ((bar === 3 || bar === 7) && (pos === 10 || pos === 12 || pos === 14)) I.taiko(P, d, t, 0.25 + (pos - 10) * 0.05, 1.15, 0.7);
    // bells: sparse random walk in the D minor pentatonic
    if ((pos === 2 || pos === 6 || pos === 8 || pos === 12) && r() < (pos === 8 ? 0.5 : 0.28)) {
      P.state.bell = clamp(P.state.bell + Math.round((r() - 0.5) * 3), 0, MENU_BELLS.length - 1);
      I.bell(P, P.nodes.bells, t, MENU_BELLS[P.state.bell], 0.75 + 0.25 * r(), 2.8, 0.6);
    }
    // harp arpeggio in the second half of every other pass
    if (pass % 2 === 1 && bar >= 4 && pos % 2 === 0) {
      const tones = [ch.pad[0], ch.pad[1], ch.pad[2], ch.pad[3], ch.pad[2] + 12, ch.pad[3], ch.pad[2], ch.pad[1]];
      I.pluck(P, d, t, tones[pos / 2], 0.6 + 0.2 * r(), 1.2);
    }
  },
};

// ------------------------------------------------------------------------------------------
// Track: CLASSIC — F major, 70 bpm, calm piano
// ------------------------------------------------------------------------------------------

const CLASSIC_CHORDS = {
  Fmaj7: { bass: 41, rh: [65, 69, 72, 76], pad: [53, 57, 60, 64] },
  Dm7: { bass: 38, rh: [62, 65, 69, 72], pad: [50, 57, 60, 65] },
  Bbmaj7: { bass: 46, rh: [58, 62, 65, 69], pad: [50, 53, 57, 58] },
  Csus: { bass: 48, rh: [60, 65, 67, 72], rh2: [60, 64, 67, 72], pad: [55, 60, 65], pad2: [55, 60, 64] },
  Am7: { bass: 45, rh: [57, 60, 64, 67], pad: [52, 55, 60, 64] },
  Gm7C: { bass: 43, rh: [55, 58, 62, 65], bass2: 48, rh2: [58, 60, 64, 67], pad: [50, 53, 58, 62], pad2: [52, 58, 60, 64] },
};
const CLASSIC_PROG = ['Fmaj7', 'Dm7', 'Bbmaj7', 'Csus', 'Dm7', 'Am7', 'Bbmaj7', 'Gm7C'];
const CLASSIC_MELODY = [72, 74, 77, 79, 81, 84, 86];
const ARP_POS = { 2: 0, 4: 1, 6: 2, 10: 3, 12: 2, 14: 1 };

const CLASSIC = {
  name: 'classic',
  bpm: 70,
  gain: 1.2,
  reverb: 0.4,
  setup(P) {
    P.main = P.gain(1);
    const lp = P.filter('lowpass', 6000, 0.5); // keep it soft
    P.main.connect(lp).connect(P.out);
    P.state.mel = 2;
  },
  step(P, s, t) {
    const pos = s % 16;
    const barAbs = Math.floor(s / 16);
    const bar = barAbs % 8;
    const pass = Math.floor(barAbs / 8);
    const ch = CLASSIC_CHORDS[CLASSIC_PROG[bar]];
    const second = pos >= 8;
    const rh = second && ch.rh2 ? ch.rh2 : ch.rh;
    const spb = P.spb;
    const r = P.rng;
    const d = P.main;
    const hum = () => (r() - 0.5) * 0.012;

    if (pos === 0) {
      I.piano(P, d, t, ch.bass, 0.75, 3.2, 0.25);
      I.pad(P, d, t, ch.pad, spb * (ch.pad2 ? 8 : 16), { a: 1.0, r: 1.4, cutoff: 750, level: 0.012, type: 'triangle', det: 6, rev: 0.45 });
    }
    if (pos === 8) {
      if (ch.bass2) I.piano(P, d, t, ch.bass2, 0.65, 2.6, 0.25);
      else if ((pass + bar) % 2 === 0) I.piano(P, d, t + hum(), ch.bass + 7, 0.4, 2.2, 0.25);
      if (ch.pad2) I.pad(P, d, t, ch.pad2, spb * 8, { a: 0.6, r: 1.4, cutoff: 750, level: 0.012, type: 'triangle', det: 6, rev: 0.45 });
    }
    // broken-chord arpeggio with gentle random rests
    const ai = ARP_POS[pos];
    if (ai != null && r() < (pass === 0 ? 0.6 : 0.75)) I.piano(P, d, t + hum(), rh[ai], 0.32 + 0.12 * r(), 1.8, 0.3);
    // melody: short generative phrases every other bar (not on the very first pass)
    if (pass > 0 && bar % 2 === (pass % 2) && (pos === 0 || pos === 4 || pos === 6 || pos === 10) && r() < 0.7) {
      P.state.mel = clamp(P.state.mel + Math.round((r() - 0.5) * 3.2), 0, CLASSIC_MELODY.length - 1);
      I.piano(P, d, t + hum(), CLASSIC_MELODY[P.state.mel], 0.45 + 0.1 * r(), 2.2, 0.35);
    }
  },
};

// ------------------------------------------------------------------------------------------
// One-shots: VICTORY / DEFEAT
// ------------------------------------------------------------------------------------------

const VICTORY = {
  name: 'victory',
  bpm: 112,
  gain: 0.85,
  reverb: 0.35,
  oneShot: true,
  length: 10.5,
  setup(P) {
    P.main = P.gain(1);
    P.main.connect(P.out);
    P.nodes.taikoBP = P.filter('bandpass', 300, 1.2);
    P.nodes.taikoBP.connect(P.main);
    const lfo = P.ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const vib = P.gain(9);
    lfo.connect(vib);
    lfo.start(P.ctx.currentTime);
    P.nodes.lfo = lfo;
    P.nodes.vib = vib;
  },
  teardown(P) {
    try {
      P.nodes.lfo.stop();
    } catch (e) {
      /* ignore */
    }
  },
  schedule(P, t0) {
    const b = 60 / 112; // beat
    const d = P.main;
    const chord = (t, notes, len, vel = 1, rel = 0.35) => notes.forEach((m) => I.brass(P, d, t, m, vel, len, rel));
    const B = [47, 59, 63, 66, 71];
    const E = [40, 52, 59, 64, 68, 76];
    const C = [36, 48, 55, 60, 67, 76];
    const D = [38, 50, 57, 62, 69, 78];
    const E2 = [40, 52, 59, 64, 71, 80];
    // "ta-ta-ta" pickup on the dominant
    for (let k = 0; k < 3; k++) {
      chord(t0 + (k * b) / 3, B, b / 3 - 0.04, 0.85, 0.12);
      I.timp(P, d, t0 + (k * b) / 3, 35, 0.5 + 0.15 * k, 0.5);
    }
    // TA-DAAA
    const t1 = t0 + b;
    chord(t1, E, b * 2 - 0.05, 1.1);
    I.crash(P, d, t1, 1);
    I.taiko(P, d, t1, 1, 0.95, 0.4);
    I.timp(P, d, t1, 40, 1, 1.4);
    chord(t1 + b * 2, C, b - 0.05, 1);
    I.timp(P, d, t1 + b * 2, 36, 0.7, 0.8);
    chord(t1 + b * 3, D, b - 0.05, 1.05);
    I.timp(P, d, t1 + b * 3, 38, 0.75, 0.8);
    // final chord: long, with a timpani roll and bell sparkle, rings out
    const t2 = t1 + b * 4;
    chord(t2, E2, b * 5, 1.15, 2.6);
    I.crash(P, d, t2, 1);
    I.taiko(P, d, t2, 1, 0.9, 0.5);
    for (let k = 0; k < 14; k++) I.timp(P, d, t2 + b * 2.5 + k * (b / 4), 40, 0.25 + k * 0.035, 0.4);
    I.timp(P, d, t2 + b * 6, 40, 1, 2.2);
    [76, 80, 83, 88, 92, 95].forEach((m, k) => I.bell(P, d, t2 + 0.1 + k * 0.09, m, 0.55, 3.2, 0.6));
    I.pad(P, d, t2, [52, 59, 64, 68], b * 6, { a: 0.4, r: 2.4, cutoff: 1800, level: 0.035, rev: 0.6 });
  },
};

const DEFEAT = {
  name: 'defeat',
  bpm: 60,
  reverb: 0.5,
  oneShot: true,
  length: 11,
  setup(P) {
    P.main = P.gain(1);
    const lp = P.filter('lowpass', 4500, 0.5);
    P.main.connect(lp).connect(P.out);
    P.nodes.taikoBP = P.filter('bandpass', 260, 1.2);
    P.nodes.taikoBP.connect(P.main);
  },
  schedule(P, t0) {
    const d = P.main;
    const b = 0.62;
    // low hit + pads
    I.taiko(P, d, t0, 0.8, 0.8, 0.7);
    I.pad(P, d, t0, [45, 52, 57, 60], b * 4, { a: 0.5, r: 1.5, cutoff: 800, level: 0.027, rev: 0.6 });
    I.drone(P, d, t0, [33, 40], b * 9, { a: 1.2, r: 2.5, level: 0.05, cutoff: 180 });
    I.pad(P, d, t0 + b * 4, [41, 53, 57, 60], b * 2, { a: 0.4, r: 1.2, cutoff: 750, level: 0.026, rev: 0.6 });
    I.pad(P, d, t0 + b * 6, [40, 52, 56, 59], b * 2, { a: 0.3, r: 1.2, cutoff: 700, level: 0.025, rev: 0.6 });
    I.pad(P, d, t0 + b * 8, [33, 45, 52, 57, 60], b * 3, { a: 0.3, r: 2.8, cutoff: 650, level: 0.028, rev: 0.7 });
    // descending piano line E D C B | A … G# | A
    const line = [[0, 76, 0.7], [1, 74, 0.6], [2, 72, 0.6], [3, 71, 0.55], [4, 69, 0.65], [6, 68, 0.5], [8, 69, 0.55]];
    for (const [beat, m, v] of line) I.piano(P, d, t0 + beat * b, m, v, beat === 8 ? 3.5 : 2.2, 0.45);
    for (const [beat, m] of [[0, 57], [4, 53], [6, 52], [8, 45]]) I.piano(P, d, t0 + beat * b, m, 0.45, 2.6, 0.4);
    I.bell(P, d, t0 + b * 8, 81, 0.5, 3.5, 0.7);
  },
};

export const TRACKS = { menu: MENU, classic: CLASSIC, epic: EPIC, victory: VICTORY, defeat: DEFEAT };
export const TRACK_NAMES = Object.keys(TRACKS);

export function hasTrack(name) {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(TRACKS, name);
}
