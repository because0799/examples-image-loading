// Minimal *validating* WebAudio mock for Node tests. It records the graph and throws on the
// mistakes real browsers reject (or silently mis-render): non-finite values, negative times,
// exponential ramps to/from 0, setTarget with tau ≤ 0, double start, stop before start,
// connecting to something that is not a node/param.

export class AudioParamMock {
  constructor(ctx, name, value) {
    this.ctx = ctx;
    this.name = name;
    this._value = value;
    this.events = [];
    this.inputs = 0;
  }
  get value() {
    return this._value;
  }
  set value(v) {
    this._check(v, 'value');
    this._value = v;
  }
  _check(v, what) {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`${this.name}.${what}: non-finite value ${v}`);
  }
  _checkT(t, what) {
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) throw new RangeError(`${this.name}.${what}: bad time ${t}`);
  }
  _last() {
    return this.events.length ? this.events[this.events.length - 1].v : this._value;
  }
  setValueAtTime(v, t) {
    this._check(v, 'setValueAtTime');
    this._checkT(t, 'setValueAtTime');
    this.events.push({ type: 'set', v, t });
    this.ctx.stats.automation++;
    return this;
  }
  linearRampToValueAtTime(v, t) {
    this._check(v, 'linearRamp');
    this._checkT(t, 'linearRamp');
    this.events.push({ type: 'lin', v, t });
    this.ctx.stats.automation++;
    return this;
  }
  exponentialRampToValueAtTime(v, t) {
    this._check(v, 'expRamp');
    this._checkT(t, 'expRamp');
    if (v === 0) throw new RangeError(`${this.name}: exponential ramp to 0`);
    const prev = this._last();
    if (prev === 0 || Math.sign(prev) !== Math.sign(v)) {
      this.ctx.stats.badExpRamps.push(`${this.name}: exp ramp from ${prev} to ${v}`);
    }
    this.events.push({ type: 'exp', v, t });
    this.ctx.stats.automation++;
    return this;
  }
  setTargetAtTime(v, t, tau) {
    this._check(v, 'setTarget');
    this._checkT(t, 'setTarget');
    if (!(tau > 0)) throw new RangeError(`${this.name}: setTarget tau ${tau}`);
    this.events.push({ type: 'target', v, t });
    this.ctx.stats.automation++;
    return this;
  }
  setValueCurveAtTime(curve, t, d) {
    this._checkT(t, 'setValueCurve');
    if (!(d > 0)) throw new RangeError('curve duration');
    for (const v of curve) this._check(v, 'curve');
    this.events.push({ type: 'curve', v: curve[curve.length - 1], t });
    return this;
  }
  cancelScheduledValues(t) {
    this._checkT(t, 'cancel');
    this.events = this.events.filter((e) => e.t < t);
    return this;
  }
  cancelAndHoldAtTime(t) {
    return this.cancelScheduledValues(t);
  }
}

let nodeIds = 0;

export class AudioNodeMock {
  constructor(ctx, kind) {
    this.ctx = ctx;
    this.kind = kind;
    this.id = ++nodeIds;
    this.outputs = [];
    ctx.stats.nodes++;
    ctx.stats.byKind[kind] = (ctx.stats.byKind[kind] || 0) + 1;
  }
  connect(dest) {
    if (!(dest instanceof AudioNodeMock) && !(dest instanceof AudioParamMock)) throw new TypeError(`${this.kind}.connect: invalid destination`);
    if (dest.ctx !== this.ctx) throw new Error('connect across contexts');
    this.outputs.push(dest);
    if (dest instanceof AudioParamMock) dest.inputs++;
    return dest;
  }
  disconnect() {
    this.outputs.length = 0;
  }
}

export class SourceMock extends AudioNodeMock {
  constructor(ctx, kind) {
    super(ctx, kind);
    this.startTime = null;
    this.stopTime = null;
    ctx.sources.push(this);
  }
  start(t = 0, offset = 0) {
    if (this.startTime !== null) throw new Error('InvalidStateError: start called twice');
    if (!Number.isFinite(t) || t < 0) throw new RangeError(`start: bad time ${t}`);
    if (!Number.isFinite(offset) || offset < 0) throw new RangeError(`start: bad offset ${offset}`);
    this.startTime = t;
  }
  stop(t = 0) {
    if (this.startTime === null) throw new Error('InvalidStateError: stop before start');
    if (!Number.isFinite(t) || t < 0) throw new RangeError(`stop: bad time ${t}`);
    this.stopTime = t;
  }
}

class BufferMock {
  constructor(channels, length, sampleRate) {
    if (!(length > 0) || !(sampleRate > 0)) throw new RangeError('createBuffer');
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this._data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(c) {
    return this._data[c];
  }
}

export class AudioContextMock {
  constructor(opts = {}) {
    this.sampleRate = opts.sampleRate || 48000;
    this.currentTime = 0;
    this.state = opts.state || 'running';
    this.onstatechange = null;
    this.sources = [];
    this.stats = { nodes: 0, automation: 0, buffers: 0, byKind: {}, badExpRamps: [] };
    this.destination = new AudioNodeMock(this, 'destination');
    this.calls = [];
  }
  _setState(s) {
    this.state = s;
    if (this.onstatechange) this.onstatechange();
  }
  resume() {
    this.calls.push('resume');
    this._setState('running');
    return Promise.resolve();
  }
  suspend() {
    this.calls.push('suspend');
    this._setState('suspended');
    return Promise.resolve();
  }
  close() {
    this._setState('closed');
    return Promise.resolve();
  }
  createGain() {
    const n = new AudioNodeMock(this, 'gain');
    n.gain = new AudioParamMock(this, 'gain', 1);
    return n;
  }
  createOscillator() {
    const n = new SourceMock(this, 'osc');
    n.type = 'sine';
    n.frequency = new AudioParamMock(this, 'frequency', 440);
    n.detune = new AudioParamMock(this, 'detune', 0);
    return n;
  }
  createBufferSource() {
    const n = new SourceMock(this, 'bufsrc');
    n.buffer = null;
    n.loop = false;
    n.playbackRate = new AudioParamMock(this, 'playbackRate', 1);
    return n;
  }
  createBiquadFilter() {
    const n = new AudioNodeMock(this, 'biquad');
    n.type = 'lowpass';
    n.frequency = new AudioParamMock(this, 'biquad.frequency', 350);
    n.Q = new AudioParamMock(this, 'Q', 1);
    n.gain = new AudioParamMock(this, 'biquad.gain', 0);
    return n;
  }
  createWaveShaper() {
    const n = new AudioNodeMock(this, 'shaper');
    n.curve = null;
    n.oversample = 'none';
    return n;
  }
  createStereoPanner() {
    const n = new AudioNodeMock(this, 'panner');
    n.pan = new AudioParamMock(this, 'pan', 0);
    return n;
  }
  createConvolver() {
    const n = new AudioNodeMock(this, 'convolver');
    n.buffer = null;
    n.normalize = true;
    return n;
  }
  createDynamicsCompressor() {
    const n = new AudioNodeMock(this, 'compressor');
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new AudioParamMock(this, k, 0);
    return n;
  }
  createDelay(max = 1) {
    const n = new AudioNodeMock(this, 'delay');
    n.delayTime = new AudioParamMock(this, 'delayTime', 0);
    n.maxDelay = max;
    return n;
  }
  createAnalyser() {
    const n = new AudioNodeMock(this, 'analyser');
    n.fftSize = 2048;
    return n;
  }
  createBuffer(ch, len, sr) {
    this.stats.buffers++;
    return new BufferMock(ch, len, sr);
  }
}
