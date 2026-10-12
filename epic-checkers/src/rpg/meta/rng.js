// Deterministic randomness + hashing for the meta layer (gacha, training rosters, duel coin toss,
// battle seeds). Same generator as the battle engine (mulberry32, GDD §20), so a seed reproduces
// a whole session in Node tests and in the app.
//
//   const rng = createRng(1234);   rng() -> float in [0, 1)   rng.int(n) -> 0..n-1
//   rng.pick(arr)  rng.shuffle(arr) (copy)   rng.state() -> uint32 to persist and resume later
//
// Every function that needs randomness accepts either a seed (number), an rng created here, or any
// `() => float` (injectable RNG for tests).

/** 32-bit FNV-1a hash of a string (checksums, seed derivation). */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mix several values into one uint32 seed (order-sensitive). */
export function mixSeed(...parts) {
  let h = 0x9e3779b9;
  for (const p of parts) {
    const v = typeof p === 'number' && Number.isFinite(p) ? p >>> 0 : fnv1a(String(p));
    h = Math.imul(h ^ v, 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** A fresh, non-deterministic uint32 seed (new profiles only). */
export function randomSeed() {
  try {
    const c = globalThis.crypto;
    if (c && typeof c.getRandomValues === 'function') {
      const a = new Uint32Array(1);
      c.getRandomValues(a);
      return a[0] >>> 0;
    }
  } catch (e) {
    /* fall through */
  }
  return mixSeed(Date.now(), Math.floor(Math.random() * 0x100000000));
}

/** mulberry32 generator with persistable state. */
export function createRng(seed = 0) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return decorate(next, () => a);
}

function decorate(fn, getState) {
  const rng = () => fn();
  rng.int = (n) => Math.floor(fn() * n);
  rng.pick = (arr) => arr[Math.floor(fn() * arr.length)];
  rng.shuffle = (arr) => {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(fn() * (i + 1));
      const t = out[i];
      out[i] = out[j];
      out[j] = t;
    }
    return out;
  };
  rng.state = getState;
  return rng;
}

/**
 * Normalise "something random" into an rng: a seed number, an rng from createRng, or any
 * function returning floats in [0, 1). `fallbackSeed` is used when `source` is null/undefined.
 */
export function toRng(source, fallbackSeed = 0) {
  if (typeof source === 'function') {
    if (typeof source.int === 'function' && typeof source.state === 'function') return source;
    let calls = 0;
    return decorate(() => {
      calls++;
      const v = Number(source());
      return Number.isFinite(v) ? Math.min(Math.max(v, 0), 0.9999999999) : 0;
    }, () => calls >>> 0);
  }
  if (typeof source === 'number' && Number.isFinite(source)) return createRng(source);
  return createRng(fallbackSeed);
}
