// Offline rendering + analysis helpers (tests, demo page, tooling). They build exactly the same
// graph as the live engine (resources, master chain, SFX recipes, TrackPlayer) on an
// OfflineAudioContext, so what is measured here is what the player hears.

import { getResources, createMixer, mulberry32 } from './core.js';
import { SFX_META, DEFAULT_META, hasSfx, startSfx } from './sfx.js';
import { TrackPlayer, TRACKS, hasTrack } from './music.js';

// Chrome's DynamicsCompressor starts with a gain-reduction transient that settles within
// ~0.2 s, so offline renders start the sound after a short pre-roll and crop it away (the live
// engine's compressor has long settled when the first sound plays).
export const PREROLL = 0.25;

function crop(buf, from) {
  const start = Math.floor(from * buf.sampleRate);
  const n = Math.max(1, buf.length - start);
  const out = new AudioBuffer({ length: n, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(start, start + n), c);
  return out;
}

function offlineCtx(channels, seconds, sampleRate) {
  const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!OAC) throw new Error('OfflineAudioContext not available');
  return new OAC(channels, Math.max(1, Math.ceil(seconds * sampleRate)), sampleRate);
}

/**
 * Renders one SFX through the full master chain.
 * @returns {Promise<AudioBuffer>}
 */
export async function renderSfx(name, opts = {}, { sampleRate = 48000, seconds, seed = 1234, raw = false } = {}) {
  if (!hasSfx(name)) throw new Error(`unknown sfx ${name}`);
  const meta = SFX_META[name] || DEFAULT_META;
  const ctx = offlineCtx(2, (seconds || meta.len) + PREROLL, sampleRate);
  const res = getResources(ctx);
  const mix = createMixer(ctx, res, ctx.destination, { bypass: raw });
  startSfx(ctx, res, mix.sfx, name, PREROLL, { rng: mulberry32(seed), ...opts });
  return crop(await ctx.startRendering(), PREROLL);
}

/**
 * Renders several SFX calls into one buffer (to test stacking / limiting).
 * events: [{ name, at /* seconds *\/, ...opts }]
 */
export async function renderSfxMix(events, seconds = 4, { sampleRate = 48000, seed = 99 } = {}) {
  const ctx = offlineCtx(2, seconds + PREROLL, sampleRate);
  const res = getResources(ctx);
  const mix = createMixer(ctx, res);
  const rng = mulberry32(seed);
  for (const e of events) startSfx(ctx, res, mix.sfx, e.name, PREROLL + (e.at || 0), { rng, ...e });
  return crop(await ctx.startRendering(), PREROLL);
}

/**
 * Renders `seconds` of a music track, scheduled in chunks exactly like the live lookahead
 * scheduler. `intensity` may be a number or a function (timeSec) => 0..1.
 */
export async function renderMusic(track, seconds = 8, { intensity = 0.5, sampleRate = 48000, seed = 7, chunk = 0.25, lookahead = 0.35, solo = null } = {}) {
  if (!hasTrack(track)) throw new Error(`unknown track ${track}`);
  const ctx = offlineCtx(2, seconds + PREROLL, sampleRate);
  const res = getResources(ctx);
  const mix = createMixer(ctx, res);
  const intensityAt = typeof intensity === 'function' ? intensity : () => intensity;
  const player = new TrackPlayer(ctx, res, TRACKS[track], mix.music, { intensity: intensityAt(0), seed, solo });
  player.start(PREROLL, TRACKS[track].oneShot ? 0.02 : 0.3);
  player.scheduleUntil(PREROLL + lookahead);
  const n = Math.floor(seconds / chunk);
  for (let k = 1; k < n; k++) {
    const t = PREROLL + k * chunk;
    ctx.suspend(t).then(() => {
      const x = intensityAt(t - PREROLL);
      if (x !== player.intensity) player.setIntensity(x, t);
      player.scheduleUntil(t + lookahead);
      ctx.resume();
    });
  }
  return crop(await ctx.startRendering(), PREROLL);
}

/**
 * Signal statistics: peak, RMS (over the active part), DC offset, NaN count, clipped samples
 * (|x| ≥ 0.99), active region (first/last sample above floorDb).
 */
export function analyze(buf, { floorDb = -60 } = {}) {
  const thr = Math.pow(10, floorDb / 20);
  const sr = buf.sampleRate;
  const chans = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
  const len = buf.length;
  let peak = 0, nan = 0, clipped = 0, first = -1, last = -1, maxStep = 0;
  for (const d of chans) {
    let prev = 0;
    for (let i = 0; i < len; i++) {
      const x = d[i];
      if (!Number.isFinite(x)) {
        nan++;
        continue;
      }
      const a = x < 0 ? -x : x;
      if (a > peak) peak = a;
      if (a >= 0.99) clipped++;
      if (a > thr) {
        if (first < 0 || i < first) first = i;
        if (i > last) last = i;
      }
      const st = Math.abs(x - prev);
      if (st > maxStep) maxStep = st;
      prev = x;
    }
  }
  let sumSq = 0, sum = 0, n = 0;
  if (first >= 0) {
    for (const d of chans) {
      for (let i = first; i <= last; i++) {
        const x = d[i];
        if (!Number.isFinite(x)) continue;
        sumSq += x * x;
        sum += x;
        n++;
      }
    }
  }
  const rms = n ? Math.sqrt(sumSq / n) : 0;
  return {
    duration: buf.duration,
    start: first >= 0 ? first / sr : 0,
    end: last >= 0 ? last / sr : 0,
    active: first >= 0 ? (last - first) / sr : 0,
    peak,
    peakDb: 20 * Math.log10(peak || 1e-9),
    rms,
    rmsDb: 20 * Math.log10(rms || 1e-9),
    dc: n ? sum / n : 0,
    nan,
    clipped,
    maxStep,
  };
}

/** Peak level per window (for envelope plots). */
export function envelope(buf, windows = 200) {
  const d0 = buf.getChannelData(0);
  const d1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : d0;
  const out = new Float32Array(windows);
  const step = buf.length / windows;
  for (let w = 0; w < windows; w++) {
    let m = 0;
    const a = Math.floor(w * step), b = Math.min(buf.length, Math.floor((w + 1) * step));
    for (let i = a; i < b; i++) {
      const v = Math.max(Math.abs(d0[i]), Math.abs(d1[i]));
      if (v > m) m = v;
    }
    out[w] = m;
  }
  return out;
}

/**
 * Magnitude spectrogram (dB) of channel 0 — radix-2 FFT, Hann window.
 * @returns {{ frames: Float32Array[], bins: number, hop: number, sampleRate: number }}
 */
export function spectrogram(buf, { size = 1024, hop = 512, maxSeconds = Infinity } = {}) {
  const d = buf.getChannelData(0);
  const n = Math.min(buf.length, Math.floor(maxSeconds * buf.sampleRate));
  const win = new Float32Array(size);
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  const re = new Float32Array(size), im = new Float32Array(size);
  const frames = [];
  for (let off = 0; off + size <= n; off += hop) {
    for (let i = 0; i < size; i++) {
      re[i] = d[off + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    const mag = new Float32Array(size / 2);
    for (let k = 0; k < size / 2; k++) mag[k] = 10 * Math.log10((re[k] * re[k] + im[k] * im[k]) / size + 1e-12);
    frames.push(mag);
  }
  return { frames, bins: size / 2, hop, sampleRate: buf.sampleRate };
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Energy share per frequency band (sub <120, low <500, mid <2k, high <6k, air) of channel 0. */
export function bandEnergy(buf) {
  const sp = spectrogram(buf, { size: 2048, hop: 1024 });
  const edges = [0, 120, 500, 2000, 6000, Infinity];
  const e = [0, 0, 0, 0, 0];
  const hz = sp.sampleRate / 2 / sp.bins;
  for (const f of sp.frames) {
    for (let k = 1; k < f.length; k++) {
      const p = Math.pow(10, f[k] / 10);
      const fr = k * hz;
      for (let b = 0; b < 5; b++) if (fr >= edges[b] && fr < edges[b + 1]) e[b] += p;
    }
  }
  const tot = e.reduce((a, b) => a + b, 0) || 1;
  return e.map((x) => x / tot);
}

/**
 * Perceived-level proxies for short sounds: maximum short-term (50 ms) RMS of the full band
 * (`stDb`) and of a "phone speaker" band (2nd-order high-pass 350 Hz → `phoneDb`).
 */
export function loudness(buf, { win = 0.05, hp = 350 } = {}) {
  const sr = buf.sampleRate;
  const n = buf.length;
  const chans = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
  // RBJ high-pass biquad
  const w0 = (2 * Math.PI * hp) / sr, cs = Math.cos(w0), al = Math.sin(w0) / (2 * 0.707);
  const a0 = 1 + al;
  const b0 = (1 + cs) / 2 / a0, b1 = -(1 + cs) / a0, b2 = (1 + cs) / 2 / a0, a1 = (-2 * cs) / a0, a2 = (1 - al) / a0;
  const W = Math.max(1, Math.floor(win * sr));
  let bestFull = 0, bestPhone = 0;
  const accF = new Float64Array(Math.ceil(n / W) + 1);
  const accP = new Float64Array(Math.ceil(n / W) + 1);
  for (const d of chans) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < n; i++) {
      const x = d[i];
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      const k = (i / W) | 0;
      accF[k] += x * x;
      accP[k] += y * y;
    }
  }
  const norm = W * chans.length;
  for (let k = 0; k < accF.length; k++) {
    if (accF[k] / norm > bestFull) bestFull = accF[k] / norm;
    if (accP[k] / norm > bestPhone) bestPhone = accP[k] / norm;
  }
  return { stDb: 10 * Math.log10(bestFull + 1e-12), phoneDb: 10 * Math.log10(bestPhone + 1e-12) };
}
