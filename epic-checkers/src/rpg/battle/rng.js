// Deterministic RNG (mulberry32). The generator state lives in the battle state (`state.rng`, uint32)
// so a battle replays identically from its seed and survives serialization.

/** Hash any seed (number or string) to a non-zero uint32. */
export function seedHash(seed) {
  let h = 0x9e3779b9;
  const str = String(seed ?? 0);
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  h ^= h >>> 15;
  return h >>> 0 || 0x1234567;
}

/** Advance `holder.rng` and return a float in [0, 1). */
export function nextRand(holder) {
  holder.rng = (holder.rng + 0x6d2b79f5) >>> 0;
  let t = holder.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Stand-alone generator object (AI noise, tests): { next() -> [0,1) , int(n) }. */
export function makeRng(seed) {
  const holder = { rng: seedHash(seed) };
  return {
    next: () => nextRand(holder),
    int: (n) => Math.floor(nextRand(holder) * n),
    pick: (arr) => arr[Math.floor(nextRand(holder) * arr.length)],
  };
}
