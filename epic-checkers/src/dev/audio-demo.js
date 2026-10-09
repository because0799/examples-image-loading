// Audio lab: buttons for every SFX / track, intensity + mixer controls, Director-like
// sequences, live meter and an offline test bench (renders everything through
// OfflineAudioContext and shows stats + waveform/spectrogram thumbnails).
//
// Automation hooks (tools/shot.mjs eval):
//   window.__audio                       the live AudioEngine
//   window.__audioTest.sfxTable(opts)    → rows { name, dur, peak, rms, dc, nan, clipped }
//   window.__audioTest.musicTable(opts)  → rows for every track (+ epic at 3 intensities)
//   window.__audioTest.stackTest()       → stats of a dense 24-sound pile-up
//   window.__audioTest.live()            → live engine checks (state, unknown names, voices)

import { AudioEngine } from '../audio/audio.js';
import { SFX_NAMES, CLASSIC_SFX, EPIC_SFX, SFX_META } from '../audio/sfx.js';
import { TRACK_NAMES } from '../audio/music.js';
import { getResources, createMixer } from '../audio/core.js';
import { renderSfx, renderMusic, renderSfxMix, analyze, envelope, spectrogram, bandEnergy, loudness } from '../audio/offline.js';

const $ = (id) => document.getElementById(id);
const audio = new AudioEngine({ sfxVolume: 0.8, musicVolume: 0.6 });
window.__audio = audio;

const params = new URLSearchParams(location.search);

// ------------------------------------------------------------------ controls
function bindRange(id, fn) {
  const el = $(id), out = $(id + 'O');
  const upd = () => {
    out.textContent = el.value;
    fn && fn(Number(el.value));
  };
  el.addEventListener('input', upd);
  upd();
  return () => Number(el.value);
}
const getI = bindRange('intensity');
const getP = bindRange('pitch');
const getPan = bindRange('pan');
const getDelay = bindRange('delay');
bindRange('mint', (v) => audio.setIntensity(v));
const getFade = bindRange('fade');
bindRange('sfxv', (v) => audio.setSfxVolume(v));
bindRange('musv', (v) => audio.setMusicVolume(v));

function btn(parent, label, cls, fn) {
  const b = document.createElement('button');
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener('click', fn);
  $(parent).appendChild(b);
  return b;
}

const status = (s) => ($('status').textContent = s);
$('unlock').addEventListener('click', () => {
  audio.unlock();
  setTimeout(() => status(`AudioContext: ${audio.state} · ${audio.ctx ? audio.ctx.sampleRate + ' Hz' : ''}`), 100);
});

const playSel = (name) => audio.play(name, { intensity: getI(), pitch: getP(), pan: getPan(), delay: getDelay() });
for (const n of CLASSIC_SFX) btn('classic', n, '', () => playSel(n));
for (const n of EPIC_SFX) btn('epic', n, 'epic', () => playSel(n));

// Director-like scenes (timings in ms)
const seq = (steps) => () => {
  audio.unlock();
  for (const [name, delay, opts] of steps) audio.play(name, { delay, ...(opts || {}) });
};
const SEQS = {
  'Ход (epic)': [['dash', 0], ['whoosh', 40, { intensity: 0.6 }], ['impact', 420, { intensity: 0.5 }]],
  'Взятие': [['charge', 0, { intensity: 0.4 }], ['dash', 380], ['slash', 470], ['impact', 560], ['shatter', 580], ['taiko', 600], ['sparkle', 900, { intensity: 0.5 }]],
  'Комбо ×3': [
    ['dash', 0], ['slash', 80], ['bigImpact', 160], ['combo', 200, { pitch: 1 }], ['shatter', 180],
    ['dash', 900], ['slash', 980], ['impact', 1060, { intensity: 1.2 }], ['combo', 1100, { pitch: 1.12, intensity: 1.2 }], ['zap', 1000],
    ['riser', 1500], ['thunder', 2000], ['slash', 3100], ['explosion', 3300, { intensity: 1.6 }], ['boom', 3300], ['combo', 3320, { pitch: 1.26, intensity: 1.6 }], ['gong', 3450],
  ],
  'Пробуждение': [['swell', 0], ['power', 1300], ['gong', 1350], ['sparkle', 1500, { intensity: 1.4 }], ['promote', 1600]],
  'VS-старт': [['menacing', 0], ['heartbeat', 300], ['heartbeat', 1100], ['riser', 600], ['taiko', 2600], ['gong', 2650], ['start', 2700]],
  'K.O. / победа': [['bigImpact', 0, { intensity: 2 }], ['glitch', 0], ['boom', 150], ['gong', 600], ['win', 1300]],
  'Поражение': [['heartbeat', 0], ['heartbeat', 900], ['lose', 1400]],
};
for (const [label, steps] of Object.entries(SEQS)) btn('seqs', label, 'seq', seq(steps));
btn('seqs', 'Стресс ×60', 'seq', () => {
  audio.unlock();
  for (let k = 0; k < 60; k++) {
    const n = SFX_NAMES[Math.floor(Math.random() * SFX_NAMES.length)];
    audio.play(n, { delay: Math.random() * 1500, intensity: Math.random() * 2, pan: Math.random() * 2 - 1 });
  }
  setTimeout(() => status(`active voices: ${audio.activeVoices}`), 800);
});

for (const tr of TRACK_NAMES) btn('tracks', tr, 'music', () => {
  audio.unlock();
  audio.music(tr, { fade: getFade() });
});
btn('tracks', 'стоп', 'music', () => audio.music(null, { fade: getFade() }));

const muteB = btn('mixer', 'mute', '', () => {
  audio.setMuted(!audio.muted);
  muteB.classList.toggle('on', audio.muted);
});
btn('mixer', 'duck 60% 1.5s', '', () => audio.duck(0.6, 1500));
btn('mixer', 'pause()', '', () => audio.pause());
btn('mixer', 'resume()', '', () => audio.resume());
btn('mixer', 'stopAll', '', () => audio.stopAll());

// ------------------------------------------------------------------ meter
const meter = $('meter');
const mctx = meter.getContext('2d');
let rmsHold = 0;
function drawMeter() {
  requestAnimationFrame(drawMeter);
  const w = meter.width, h = meter.height;
  mctx.fillStyle = '#000';
  mctx.fillRect(0, 0, w, h);
  const an = audio.getAnalyser();
  if (!an) return;
  const data = new Float32Array(an.fftSize);
  an.getFloatTimeDomainData(data);
  let s = 0, pk = 0;
  mctx.strokeStyle = '#29E6FF';
  mctx.lineWidth = 2;
  mctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = (i / data.length) * w, y = h / 2 - data[i] * h * 0.48;
    if (i) mctx.lineTo(x, y);
    else mctx.moveTo(x, y);
    s += data[i] * data[i];
    pk = Math.max(pk, Math.abs(data[i]));
  }
  mctx.stroke();
  const rms = Math.sqrt(s / data.length);
  rmsHold = Math.max(rms, rmsHold * 0.95);
  mctx.fillStyle = pk > 0.97 ? '#FF2E63' : '#FFD23F';
  mctx.fillRect(0, h - 6, Math.min(1, rmsHold * 2) * w, 6);
  mctx.fillStyle = '#9A92B8';
  mctx.font = '20px Oswald';
  mctx.fillText(`${audio.currentTrack || '—'} · voices ${audio.activeVoices} · peak ${pk.toFixed(2)}`, 8, 22);
}
drawMeter();

// ------------------------------------------------------------------ offline test bench
const fmt = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

function drawCard(name, buf, st, extra = '') {
  const card = document.createElement('div');
  card.className = 'card';
  const head = document.createElement('div');
  head.className = 'n';
  head.innerHTML = `<b>${name}</b><span>${fmt(st.active, 2)}s · pk ${fmt(st.peak, 2)} · ${fmt(st.rmsDb, 1)}dB${extra}</span>`;
  if (params.get('big')) card.style.gridColumn = 'span 2';
  card.appendChild(head);
  const cv = document.createElement('canvas');
  cv.width = 460;
  cv.height = 180;
  card.appendChild(cv);
  $('viz').appendChild(card);
  const g = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  // spectrogram (log frequency) in the top 120 px
  // crop the time axis to the audible part (+ a little)
  const shown = Math.min(buf.duration, Math.max(0.15, st.end + 0.12));
  const sp = spectrogram(buf, { size: 1024, hop: Math.max(64, Math.round((shown * buf.sampleRate) / W / 2)), maxSeconds: shown + 0.03 });
  const SH = 120;
  const img = g.createImageData(W, SH);
  const fMin = 30, fMax = sp.sampleRate / 2;
  let top = -200;
  for (const fr of sp.frames) for (let k = 0; k < fr.length; k++) if (fr[k] > top) top = fr[k];
  for (let x = 0; x < W; x++) {
    const fr = sp.frames[Math.min(sp.frames.length - 1, Math.floor((x / W) * sp.frames.length))];
    if (!fr) continue;
    for (let y = 0; y < SH; y++) {
      const f = fMin * Math.pow(fMax / fMin, 1 - y / SH);
      const k = Math.min(sp.bins - 1, Math.round((f / fMax) * sp.bins));
      const db = fr[k];
      const v = Math.max(0, Math.min(1, (db - top + 75) / 75));
      const i = (y * W + x) * 4;
      img.data[i] = Math.round(255 * Math.min(1, v * 1.6));
      img.data[i + 1] = Math.round(255 * Math.max(0, v * 1.6 - 0.6));
      img.data[i + 2] = Math.round(255 * Math.max(0, Math.min(1, 0.4 + v - v * v * 1.5)) * v * 2);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // envelope (linear) in the bottom 60 px
  const env = envelope(cropBuffer(buf, shown), W);
  g.fillStyle = '#05030C';
  g.fillRect(0, SH, W, H - SH);
  g.fillStyle = st.peak > 0.99 ? '#FF2E63' : '#29E6FF';
  for (let x = 0; x < W; x++) {
    const hgt = env[x] * (H - SH - 2);
    g.fillRect(x, H - hgt, 1, hgt);
  }
  g.strokeStyle = '#FF2E63';
  g.beginPath();
  g.moveTo(0, H - 0.99 * (H - SH - 2));
  g.lineTo(W, H - 0.99 * (H - SH - 2));
  g.stroke();
}

function cropBuffer(buf, seconds) {
  const n = Math.min(buf.length, Math.max(1, Math.floor(seconds * buf.sampleRate)));
  const out = new AudioBuffer({ length: n, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(0, n), c);
  return out;
}

function renderTable(rows, cols) {
  const t = document.createElement('table');
  t.innerHTML = `<tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>` + rows.map((r) => `<tr>${cols.map((c) => {
    const v = r[c];
    let cls = '';
    if (c === 'peak') cls = v > 0.99 || v < 0.02 ? 'bad' : 'ok';
    if (c === 'nan') cls = v ? 'bad' : 'ok';
    return `<td class="${cls}">${typeof v === 'number' ? fmt(v, c === 'nan' || c === 'clipped' ? 0 : 3) : v}</td>`;
  }).join('')}</tr>`).join('');
  $('report').appendChild(t);
}

async function sfxTable({ draw = true, names = SFX_NAMES, opts = {}, table = true, raw = false } = {}) {
  const rows = [];
  for (const name of names) {
    const t0 = performance.now();
    const buf = await renderSfx(name, opts, { raw });
    const st = analyze(buf);
    const be = bandEnergy(buf);
    const ld = loudness(buf);
    rows.push({
      stDb: +ld.stDb.toFixed(1), phoneDb: +ld.phoneDb.toFixed(1),
      name, dur: +st.active.toFixed(3), peak: +st.peak.toFixed(3), rms: +st.rms.toFixed(4), rmsDb: +st.rmsDb.toFixed(1),
      dc: +st.dc.toFixed(5), nan: st.nan, clipped: st.clipped, maxStep: +st.maxStep.toFixed(3),
      bands: be.map((x) => Math.round(x * 100)).join('/'), ms: Math.round(performance.now() - t0),
    });
    if (draw) drawCard(name, buf, st);
  }
  if (table) renderTable(rows, ['name', 'dur', 'peak', 'rms', 'rmsDb', 'stDb', 'phoneDb', 'dc', 'nan', 'clipped', 'bands']);
  return rows;
}

async function musicTable({ draw = true, seconds = 8 } = {}) {
  const jobs = [
    ['menu', 0.35], ['classic', 0.35], ['epic', 0], ['epic', 0.5], ['epic', 1], ['victory', 0.5], ['defeat', 0.5],
    ['epic', (t) => Math.min(1, t / seconds)],
  ];
  const rows = [];
  for (const [track, intensity] of jobs) {
    const t0 = performance.now();
    const buf = await renderMusic(track, seconds, { intensity });
    const st = analyze(buf);
    const label = `${track}${typeof intensity === 'function' ? ' ramp0→1' : track === 'epic' ? ' @' + intensity : ''}`;
    rows.push({
      name: label, dur: +st.active.toFixed(2), peak: +st.peak.toFixed(3), rms: +st.rms.toFixed(4), rmsDb: +st.rmsDb.toFixed(1),
      dc: +st.dc.toFixed(5), nan: st.nan, clipped: st.clipped, renderMs: Math.round(performance.now() - t0),
    });
    if (draw) drawCard(label, buf, st);
  }
  renderTable(rows, ['name', 'dur', 'peak', 'rms', 'rmsDb', 'dc', 'nan', 'clipped', 'renderMs']);
  return rows;
}

async function stackTest() {
  const ev = [];
  const names = ['bigImpact', 'boom', 'explosion', 'thunder', 'gong', 'slash', 'impact', 'taiko', 'shatter', 'zap', 'combo', 'power'];
  for (let k = 0; k < 24; k++) ev.push({ name: names[k % names.length], at: (k % 6) * 0.05, intensity: 2 });
  const buf = await renderSfxMix(ev, 6);
  const st = analyze(buf);
  drawCard('STACK ×24 @2.0', buf, st);
  return { peak: +st.peak.toFixed(4), rmsDb: +st.rmsDb.toFixed(1), nan: st.nan, clipped: st.clipped };
}

async function live() {
  audio.unlock();
  const t0 = performance.now();
  while (audio.state !== 'running' && performance.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 50));
  const res = { state: audio.state, sampleRate: audio.ctx && audio.ctx.sampleRate };
  let threw = false;
  try {
    audio.play('definitelyNotASound');
    audio.play(undefined);
    audio.play('impact', null);
    audio.play('__proto__');
    audio.play('constructor');
    audio.music('noSuchTrack');
  } catch (e) {
    threw = String(e);
  }
  res.unknownIgnored = threw === false;
  for (const n of SFX_NAMES) audio.play(n, { intensity: 0.5 });
  res.voicesAfterAll = audio.activeVoices;
  for (let k = 0; k < 100; k++) audio.play(SFX_NAMES[k % SFX_NAMES.length], { delay: k * 7 });
  res.voicesCapped = audio.activeVoices;
  audio.music('epic', { fade: 300 });
  audio.setIntensity(1);
  await new Promise((r) => setTimeout(r, 700));
  res.track = audio.currentTrack;
  audio.duck(0.7, 300);
  audio.pause();
  await new Promise((r) => setTimeout(r, 300));
  res.afterPause = audio.state;
  audio.resume();
  await new Promise((r) => setTimeout(r, 300));
  res.afterResume = audio.state;
  audio.music('victory', { fade: 500 });
  await new Promise((r) => setTimeout(r, 400));
  res.track2 = audio.currentTrack;
  audio.setMuted(true);
  await new Promise((r) => setTimeout(r, 300));
  res.mutedState = audio.state;
  audio.setMuted(false);
  await new Promise((r) => setTimeout(r, 300));
  res.unmutedState = audio.state;
  audio.music(null, { fade: 200 });
  return res;
}

const INSTRUMENTS = ['piano', 'pad', 'choir', 'drone', 'bass', 'kick', 'snare', 'hat', 'crash', 'taiko', 'timp', 'stab', 'arp', 'lead', 'bell', 'pluck', 'brass', 'gust'];
/** Renders every instrument of a track alone → RMS / peak per stem (mix balancing). */
async function stems(track = 'epic', intensity = 1, seconds = 8) {
  const rows = [];
  for (const inst of INSTRUMENTS) {
    const buf = await renderMusic(track, seconds, { intensity, solo: [inst] });
    const st = analyze(buf);
    if (st.peak < 1e-4) continue;
    rows.push({ name: inst, peak: +st.peak.toFixed(3), rmsDb: +st.rmsDb.toFixed(1), bands: bandEnergy(buf).map((x) => Math.round(x * 100)).join('/') });
  }
  return rows;
}

/** Master chain transfer: steady sine of amplitude `amp` → output peak / gain. */
async function chainTest(amps = [0.1, 0.25, 0.5, 0.63, 0.8, 1, 1.5, 2, 3], freq = 220) {
  const out = [];
  for (const amp of amps) {
    const ctx = new OfflineAudioContext(2, 48000, 48000);
    const mix = createMixer(ctx, getResources(ctx));
    const o = ctx.createOscillator();
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = amp;
    o.connect(g).connect(mix.sfx.dry);
    o.start(0);
    const buf = await ctx.startRendering();
    const d = buf.getChannelData(0);
    let pk = 0;
    for (let i = 24000; i < 48000; i++) pk = Math.max(pk, Math.abs(d[i]));
    out.push({ amp, out: +pk.toFixed(4), gainDb: +(20 * Math.log10(pk / amp)).toFixed(2) });
  }
  return out;
}

/** Master chain response to a short tone burst (amp, start time, length). */
async function burstTest(cases = [[0.3, 0.01, 0.02], [0.3, 1.0, 0.02], [0.3, 1.0, 0.2], [0.8, 1.0, 0.02], [0.8, 1.0, 0.3], [1.5, 1.0, 0.02]], freq = 2000) {
  const out = [];
  for (const [amp, at, len] of cases) {
    const ctx = new OfflineAudioContext(2, 48000 * 2, 48000);
    const mix = createMixer(ctx, getResources(ctx));
    const o = ctx.createOscillator();
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(amp, at);
    g.gain.setValueAtTime(0, at + len);
    o.connect(g).connect(mix.sfx.dry);
    o.start(0);
    const buf = await ctx.startRendering();
    const d = buf.getChannelData(0);
    let pk = 0;
    for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
    out.push({ amp, at, len, out: +pk.toFixed(4), gainDb: +(20 * Math.log10(pk / amp)).toFixed(2) });
  }
  return out;
}

/** Impulse through the hall / room reverb only (inspect the generated IRs). */
async function irTest(which = 'hall', seconds = 3.5) {
  const ctx = new OfflineAudioContext(2, Math.ceil(48000 * (seconds + 0.25)), 48000);
  const mix = createMixer(ctx, getResources(ctx), ctx.destination, { bypass: true });
  const b = ctx.createBuffer(1, 64, 48000);
  b.getChannelData(0)[0] = 1;
  const src = ctx.createBufferSource();
  src.buffer = b;
  src.connect(mix.sfx[which]);
  src.start(0.25);
  const full = await ctx.startRendering();
  const buf = cropBuffer2(full, 0.25);
  const st = analyze(buf);
  drawCard('IR ' + which, buf, st);
  return { peak: st.peak, end: st.end, rmsDb: st.rmsDb };
}
function cropBuffer2(buf, from) {
  const s0 = Math.floor(from * buf.sampleRate);
  const out = new AudioBuffer({ length: buf.length - s0, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(s0), c);
  return out;
}

window.__audioTest = { _res: getResources, _offline: { renderSfx, renderMusic, renderSfxMix, analyze }, irTest, burstTest, chainTest, sfxTable, musicTable, stackTest, live, stems, SFX_META };
btn('tests', 'SFX → таблица', '', () => sfxTable());
btn('tests', 'Музыка → таблица', '', () => musicTable());
btn('tests', 'Стек ×24', '', () => stackTest());

if (params.get('auto') === 'sfx') sfxTable();
if (params.get('auto') === 'music') musicTable();
