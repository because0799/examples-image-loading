// Audio core: shared DSP resources, master mixer chain, envelope helpers and the per-sound Voice
// builder. Everything here works on any BaseAudioContext (live AudioContext or OfflineAudioContext),
// so SFX / music code can be rendered offline for tests with exactly the same graph.

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const dbToGain = (db) => Math.pow(10, db / 20);
const EPS = 1e-5;

/** Small fast deterministic PRNG (mulberry32). Returns () => [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rnd() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// Shared resources (noise buffers, impulse responses, shaping curves) — built once per context.
// ---------------------------------------------------------------------------------------------

const resourceCache = new WeakMap();

/** Returns the (cached) DSP resources for a context. Heavy work happens once per context. */
export function getResources(ctx) {
  let r = resourceCache.get(ctx);
  if (!r) {
    r = buildResources(ctx);
    resourceCache.set(ctx, r);
  }
  return r;
}

function normalizePeak(d, target) {
  let peak = 0;
  for (let i = 0; i < d.length; i++) {
    const a = Math.abs(d[i]);
    if (a > peak) peak = a;
  }
  if (peak > 0) {
    const k = target / peak;
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
}

function removeDC(d) {
  let s = 0;
  for (let i = 0; i < d.length; i++) s += d[i];
  const m = s / d.length;
  for (let i = 0; i < d.length; i++) d[i] -= m;
}

function makeNoise(ctx, kind, seconds, seed) {
  const sr = ctx.sampleRate;
  const len = Math.floor(seconds * sr);
  const xf = Math.floor(0.03 * sr); // loop-seam crossfade length
  const raw = new Float32Array(len + xf);
  const rnd = mulberry32(seed);
  const n = raw.length;
  if (kind === 'white') {
    for (let i = 0; i < n; i++) raw[i] = rnd() * 2 - 1;
  } else if (kind === 'pink') {
    // Paul Kellet's refined pink noise filter
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = rnd() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    }
  } else if (kind === 'brown') {
    // leaky integrator (red noise) — the leak keeps it from drifting
    let b = 0;
    for (let i = 0; i < n; i++) {
      b = (b + 0.02 * (rnd() * 2 - 1)) / 1.02;
      raw[i] = b;
    }
  } else if (kind === 'crackle') {
    // sparse random impulses with tiny decaying tails: fire, electricity, debris, thunder snaps
    let ring = 0;
    let decay = 0.9;
    for (let i = 0; i < n; i++) {
      if (rnd() < 0.0045) {
        const amp = Math.pow(rnd(), 3) * 0.9 + 0.1 * rnd();
        ring += (rnd() < 0.5 ? -1 : 1) * amp;
        decay = 0.6 + rnd() * 0.33;
      }
      ring *= decay;
      raw[i] = ring;
    }
  }
  // Seamless loop: the head is an equal-power blend of the head and the material that follows
  // the end, so wrapping from d[len-1] (= raw[len-1]) to d[0] (≈ raw[len]) is continuous.
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = raw[i];
  for (let i = 0; i < xf; i++) {
    const w = (i + 0.5) / xf;
    d[i] = raw[i] * Math.sin(w * Math.PI * 0.5) + raw[len + i] * Math.cos(w * Math.PI * 0.5);
  }
  removeDC(d);
  normalizePeak(d, kind === 'white' ? 0.95 : 0.9);
  return buf;
}

/**
 * Generated reverb impulse response: pre-delay, early reflections, exponentially decaying
 * noise tail that gets darker over time (frequency-dependent decay), decorrelated stereo.
 */
function makeImpulse(ctx, seconds, rt60, { preDelay = 0.012, bright = 0.15, dark = 0.86, early = 8, seed = 7, width = 1 } = {}) {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(seconds * sr));
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const rnd = mulberry32(seed * 31 + ch * 1013);
    const pre = Math.floor(preDelay * sr);
    const decayPerSample = Math.pow(10, -3 / (rt60 * sr)); // -60 dB after rt60
    let env = 1;
    let lp = 0;
    const fadeIn = Math.floor(0.004 * sr);
    const kEnd = Math.floor(rt60 * 0.7 * sr);
    let kk = bright, k1 = 1 - bright, comp = 1;
    for (let i = pre; i < len; i++) {
      const j = i - pre;
      // damping grows over time (the tail gets darker); updated every 64 samples. `comp`
      // compensates the level lost in the low-pass so the decay stays exponential.
      if ((j & 63) === 0) {
        kk = bright + (dark - bright) * Math.min(1, j / kEnd);
        k1 = 1 - kk;
        comp = Math.sqrt((1 + kk) / (1 - kk));
      }
      lp = lp * kk + (rnd() * 2 - 1) * k1;
      const fi = j < fadeIn ? j / fadeIn : 1;
      d[i] = lp * comp * env * fi * 0.5;
      env *= decayPerSample;
    }
    // early reflections (different per channel → width)
    for (let e = 0; e < early; e++) {
      const tt = preDelay * 0.5 + (0.006 + rnd() * 0.07) * (1 + e * 0.15);
      const idx = Math.floor(tt * sr);
      if (idx < len) d[idx] += (rnd() < 0.5 ? -1 : 1) * (0.9 - e * 0.07) * width;
    }
    // fade the very end to zero
    const fo = Math.min(len, Math.floor(0.05 * sr));
    for (let i = 0; i < fo; i++) d[len - 1 - i] *= i / fo;
  }
  return buf;
}

function makeCurve(n, fn) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    c[i] = fn(x);
  }
  c[(n - 1) >> 1] = 0; // exact zero at the centre → no DC from silence
  return c;
}

/**
 * Noise buffers and impulse responses are built lazily (memoized getters) so creating the context
 * inside the first tap stays cheap; `warmUp()` builds them one per call (the engine spreads the
 * calls over a few timer ticks). Accessing a resource early simply builds it on the spot.
 */
function buildResources(ctx) {
  const tanhN = (k) => (x) => Math.tanh(k * x) / Math.tanh(k);
  const pending = [];
  const lazy = (obj, key, make) => {
    let value = null;
    Object.defineProperty(obj, key, {
      enumerable: true,
      get() {
        if (!value) value = make();
        return value;
      },
    });
    pending.push(() => obj[key]);
  };
  const noise = {};
  const ir = {};
  lazy(noise, 'white', () => makeNoise(ctx, 'white', 2, 11));
  lazy(ir, 'room', () => makeImpulse(ctx, 0.8, 0.55, { preDelay: 0.006, bright: 0.25, dark: 0.75, early: 12, seed: 9 }));
  lazy(ir, 'hall', () => makeImpulse(ctx, 2.7, 2.4, { preDelay: 0.022, bright: 0.12, dark: 0.9, early: 10, seed: 5 }));
  lazy(noise, 'pink', () => makeNoise(ctx, 'pink', 2, 23));
  lazy(noise, 'brown', () => makeNoise(ctx, 'brown', 2, 37));
  lazy(noise, 'crackle', () => makeNoise(ctx, 'crackle', 2, 41));
  return {
    noise,
    ir,
    /** Builds the next pending resource; returns false when everything is ready. */
    warmUp() {
      const f = pending.shift();
      if (f) f();
      return pending.length > 0;
    },
    curve: {
      soft: makeCurve(2049, tanhN(1.6)),
      drive: makeCurve(2049, tanhN(4)),
      hard: makeCurve(2049, tanhN(12)),
      crush: makeCurve(2049, (x) => Math.round(x * 7) / 7),
      // master safety clipper: input is pre-scaled by 0.5, so x∈[-1,1] represents s∈[-2,2].
      // Linear (exact) up to |s| = 0.8, then a tanh knee that never exceeds 0.99.
      master: makeCurve(4097, (x) => {
        const s = x * 2;
        const a = Math.abs(s);
        if (a <= 0.8) return s;
        return Math.sign(s) * (0.8 + 0.19 * Math.tanh((a - 0.8) / 0.19));
      }),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Master chain
// ---------------------------------------------------------------------------------------------

/**
 * Builds the master chain on `ctx`:
 *
 *   sfx.dry ─ sfxVol ───────────────────────────────┐
 *   sfx.hall ─ sfxHallVol ─┐                         │
 *   music.hall ─ duckH ─ musicHallVol ─ hall conv ─ hallRet ─┤
 *   sfx.room ─ sfxRoomVol ─ room conv ─ roomRet ─────┤
 *   music.dry ─ duck ─ musicVol ──────────────────────┴─ sum ─ HP 20 Hz ─ limiter ─ ×0.5 ─ clipper ─ master ─ out
 *
 * Volume / duck automations are applied to the dry and wet paths together so reverb tails follow
 * the bus volumes. `destination` defaults to ctx.destination. `bypass` (analysis only) skips the
 * high-pass / limiter / clipper to measure the raw mix. `deferReverb` leaves the convolvers
 * empty until `attachReverb()` is called.
 */
export function createMixer(ctx, res = getResources(ctx), destination = ctx.destination, { bypass = false, deferReverb = false } = {}) {
  const G = (v = 1) => {
    const g = ctx.createGain();
    g.gain.value = v;
    return g;
  };
  const sum = G(1);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 22;
  hp.Q.value = 0.6;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -4;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.12;
  const pre = G(0.5);
  const clip = ctx.createWaveShaper();
  clip.curve = res.curve.master;
  clip.oversample = 'none';
  const master = G(1);
  if (bypass) sum.connect(master).connect(destination); // analysis only: no dynamics / clipper
  else sum.connect(hp).connect(limiter).connect(pre).connect(clip).connect(master).connect(destination);

  // reverbs
  const hallConv = ctx.createConvolver();
  const hallRet = G(0.9);
  hallConv.connect(hallRet).connect(sum);
  const roomConv = ctx.createConvolver();
  // impulse responses can be attached later (live engine: after the first tap, off the hot path)
  const attachReverb = () => {
    if (!roomConv.buffer) roomConv.buffer = res.ir.room;
    if (!hallConv.buffer) hallConv.buffer = res.ir.hall;
  };
  if (!deferReverb) attachReverb();
  const roomRet = G(0.8);
  roomConv.connect(roomRet).connect(sum);

  // sfx bus
  const sfxDry = G(1), sfxHall = G(1), sfxRoom = G(1);
  const sfxVol = G(1), sfxHallVol = G(1), sfxRoomVol = G(1);
  sfxDry.connect(sfxVol).connect(sum);
  sfxHall.connect(sfxHallVol).connect(hallConv);
  sfxRoom.connect(sfxRoomVol).connect(roomConv);

  // music bus
  const musicDry = G(1), musicHall = G(1);
  const duck = G(1), duckHall = G(1);
  const musicVol = G(1), musicHallVol = G(1);
  musicDry.connect(duck).connect(musicVol).connect(sum);
  musicHall.connect(duckHall).connect(musicHallVol).connect(hallConv);

  return {
    sfx: { dry: sfxDry, hall: sfxHall, room: sfxRoom },
    music: { dry: musicDry, hall: musicHall },
    sfxParams: [sfxVol.gain, sfxHallVol.gain, sfxRoomVol.gain],
    musicParams: [musicVol.gain, musicHallVol.gain],
    duckParams: [duck.gain, duckHall.gain],
    master,
    limiter,
    output: master,
    attachReverb,
  };
}

/** Smoothly moves a set of AudioParams to `value` (no zipper noise, no clicks). */
export function glide(params, value, t, tau = 0.03) {
  for (const p of params) {
    holdAt(p, t);
    p.setTargetAtTime(value, t, tau);
  }
}

/** Cancels future automation on `p` while holding its current value at `t`. */
export function holdAt(p, t) {
  if (typeof p.cancelAndHoldAtTime === 'function') {
    p.cancelAndHoldAtTime(t);
  } else {
    const v = p.value;
    p.cancelScheduledValues(t);
    p.setValueAtTime(v, t);
  }
}

// ---------------------------------------------------------------------------------------------
// Envelope helpers. All return the time at which the parameter is back at exactly 0.
// Only setValue / linear / exponential ramps are used (never ramps after setTarget), so the
// curves are identical in every browser and nothing clicks.
// ---------------------------------------------------------------------------------------------

/** Percussive: 0 → peak in `a` (linear) → exponential decay to -60 dB over `d` → 0. */
export function perc(param, t, peak, a, d) {
  const p = Math.max(peak, EPS);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(p, t + a);
  param.exponentialRampToValueAtTime(p * 0.001, t + a + d);
  param.linearRampToValueAtTime(0, t + a + d + 0.004);
  return t + a + d + 0.004;
}

/** Two-stage decay (piano / bell like): fast drop to `mid`·peak over d1, then slow decay over d2. */
export function perc2(param, t, peak, a, d1, mid, d2) {
  const p = Math.max(peak, EPS);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(p, t + a);
  param.exponentialRampToValueAtTime(p * Math.max(mid, 0.002), t + a + d1);
  param.exponentialRampToValueAtTime(p * 0.001, t + a + d1 + d2);
  param.linearRampToValueAtTime(0, t + a + d1 + d2 + 0.004);
  return t + a + d1 + d2 + 0.004;
}

/** Attack / hold / exponential release. */
export function ahr(param, t, peak, a, h, r) {
  const p = Math.max(peak, EPS);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(p, t + a);
  if (h > 0) param.setValueAtTime(p, t + a + h);
  param.exponentialRampToValueAtTime(p * 0.001, t + a + h + r);
  param.linearRampToValueAtTime(0, t + a + h + r + 0.004);
  return t + a + h + r + 0.004;
}

/** Crescendo: exponential rise from -50 dB to peak over `dur`, then a quick release `r`. */
export function rise(param, t, peak, dur, r = 0.02) {
  const p = Math.max(peak, EPS);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(p * 0.003, t + 0.01);
  param.exponentialRampToValueAtTime(p, t + dur);
  param.linearRampToValueAtTime(0, t + dur + r);
  return t + dur + r;
}

/** Up-down swell: exponential rise to peak at t + up, exponential fall over `down`. */
export function swellEnv(param, t, peak, up, down) {
  const p = Math.max(peak, EPS);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(p * 0.01, t + 0.01);
  param.exponentialRampToValueAtTime(p, t + up);
  param.exponentialRampToValueAtTime(p * 0.001, t + up + down);
  param.linearRampToValueAtTime(0, t + up + down + 0.004);
  return t + up + down + 0.004;
}

/** Exponential sweep of a frequency-like (strictly positive) param. */
export function sweep(param, t0, v0, t1, v1) {
  param.setValueAtTime(Math.max(v0, EPS), t0);
  param.exponentialRampToValueAtTime(Math.max(v1, EPS), t1);
}

// ---------------------------------------------------------------------------------------------
// Voice — one fire-and-forget sound. Owns its output gain (for stealing), lazy reverb sends,
// tracks all scheduled sources and the end time.
// ---------------------------------------------------------------------------------------------

/** Loudness factor for `intensity` (0 → quiet, 1 → nominal, 2 → bigger). */
export function loudness(i) {
  return i <= 1 ? 0.3 + 0.7 * i : 1 + 0.22 * (i - 1);
}

export class Voice {
  /**
   * @param ctx BaseAudioContext
   * @param res resources from getResources(ctx)
   * @param bus { dry, hall, room } input nodes
   * @param t start time (context seconds)
   * @param opts { intensity, pitch, pan, gain, rng }
   */
  constructor(ctx, res, bus, t, opts = {}) {
    this.ctx = ctx;
    this.res = res;
    this.bus = bus;
    this.t = t;
    const i = Number.isFinite(opts.intensity) ? opts.intensity : 1;
    this.i = clamp(i, 0, 2.5);
    const p = Number.isFinite(opts.pitch) && opts.pitch > 0 ? opts.pitch : 1;
    this.p = clamp(p, 0.25, 4);
    const pan = Number.isFinite(opts.pan) ? clamp(opts.pan, -1, 1) : 0;
    this.pan = pan;
    this.rnd = opts.rng || Math.random;
    this.level = loudness(this.i) * (Number.isFinite(opts.gain) ? opts.gain : 1);
    this.out = ctx.createGain();
    this.out.gain.value = this.level;
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      this.panner = ctx.createStereoPanner();
      this.panner.pan.value = pan;
      this.out.connect(this.panner);
      this.panner.connect(bus.dry);
    } else {
      this.out.connect(bus.dry);
    }
    this._hall = null;
    this._room = null;
    this.sources = [];
    this.srcEnd = t; // last scheduled source stop time
    this.tail = 0; // reverb tail after the last source
    this.killed = false;
  }

  /** Time after which the voice is guaranteed silent (sources + reverb tail). */
  get end() {
    return this.srcEnd + this.tail;
  }

  /** Intensity-derived "size" factor ~0.6 .. 1.4 used to scale tails and layer counts. */
  get size() {
    return 0.6 + 0.4 * Math.min(this.i, 2);
  }

  get hall() {
    if (!this._hall) {
      this._hall = this.gain(this.level);
      this._hall.connect(this.bus.hall);
    }
    return this._hall;
  }

  get room() {
    if (!this._room) {
      this._room = this.gain(this.level);
      this._room.connect(this.bus.room || this.bus.hall);
    }
    return this._room;
  }

  _until(t) {
    if (t > this.srcEnd) this.srcEnd = t;
  }

  gain(v = 1) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  filter(type, freq, Q = 0.707, gainDb = 0) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = Math.min(freq, this.ctx.sampleRate * 0.45);
    f.Q.value = Q;
    if (gainDb) f.gain.value = gainDb;
    return f;
  }

  shaper(name = 'soft', oversample = '2x') {
    const s = this.ctx.createWaveShaper();
    s.curve = this.res.curve[name] || this.res.curve.soft;
    s.oversample = oversample;
    return s;
  }

  panNode(v = 0) {
    const p = this.ctx.createStereoPanner();
    p.pan.value = clamp(v, -1, 1);
    return p;
  }

  /** Oscillator started at t0 and stopped at t1. */
  osc(type, freq, t0, t1, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(freq, EPS), t0);
    if (detune) o.detune.setValueAtTime(detune, t0);
    o.start(t0);
    o.stop(t1);
    this.sources.push(o);
    this._until(t1);
    return o;
  }

  /** Looped noise buffer source (random offset) started at t0, stopped at t1. */
  noise(kind, t0, t1, rate = 1) {
    const src = this.ctx.createBufferSource();
    const buf = this.res.noise[kind] || this.res.noise.white;
    src.buffer = buf;
    src.loop = true;
    if (rate !== 1) src.playbackRate.setValueAtTime(rate, t0);
    src.start(t0, this.rnd() * buf.duration * 0.9);
    src.stop(t1);
    this.sources.push(src);
    this._until(t1);
    return src;
  }

  /** Connects nodes in series and returns the last one. */
  chain(...nodes) {
    for (let k = 0; k < nodes.length - 1; k++) nodes[k].connect(nodes[k + 1]);
    return nodes[nodes.length - 1];
  }

  /** Connects `node` to the voice output (dry). */
  dry(node, amount = 1) {
    if (amount === 1) node.connect(this.out);
    else node.connect(this.gain(amount)).connect(this.out);
    return node;
  }

  /** Sends `node` to the hall/room reverb with the given amount (also extends the voice end). */
  send(node, amount, which = 'hall') {
    if (amount <= 0) return node;
    node.connect(this.gain(amount)).connect(which === 'room' ? this.room : this.hall);
    this.tail = Math.max(this.tail, which === 'room' ? 0.8 : 3.0);
    return node;
  }

  /** Fades the voice out quickly at time `t` and stops its sources (voice stealing). */
  kill(t, fade = 0.03) {
    if (this.killed) return;
    this.killed = true;
    for (const g of [this.out, this._hall, this._room]) {
      if (!g) continue;
      holdAt(g.gain, t);
      g.gain.linearRampToValueAtTime(0, t + fade);
    }
    for (const s of this.sources) {
      try {
        s.stop(t + fade + 0.01);
      } catch (e) {
        /* already stopped */
      }
    }
    this.srcEnd = Math.min(this.srcEnd, t + fade + 0.02);
    this.tail = 0;
  }

  /** Detaches the voice from the mixer (after it ended). */
  disconnect() {
    for (const n of [this.out, this.panner, this._hall, this._room]) {
      if (!n) continue;
      try {
        n.disconnect();
      } catch (e) {
        /* ignore */
      }
    }
    this.sources.length = 0;
  }
}
