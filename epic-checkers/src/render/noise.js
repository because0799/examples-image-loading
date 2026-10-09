// Seeded RNG + gradient noise used by the procedural texture generators and the camera shake.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rnd() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GRAD2 = new Float32Array([1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 0, 1, 0, -1]);

/** 2D Perlin-style gradient noise in [-1, 1] (roughly) + fbm/ridged helpers. */
export class Noise2D {
  constructor(seed = 1) {
    const rnd = mulberry32(seed * 9973 + 17);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    // 1D gradients for noise1
    this.g1 = new Float32Array(256);
    for (let i = 0; i < 256; i++) this.g1[i] = rnd() * 2 - 1;
  }

  noise(x, y) {
    const perm = this.perm;
    let xi = Math.floor(x);
    let yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    xi &= 255;
    yi &= 255;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const aa = (perm[xi + perm[yi]] & 7) * 2;
    const ab = (perm[xi + perm[yi + 1]] & 7) * 2;
    const ba = (perm[xi + 1 + perm[yi]] & 7) * 2;
    const bb = (perm[xi + 1 + perm[yi + 1]] & 7) * 2;
    const x1 = GRAD2[aa] * xf + GRAD2[aa + 1] * yf;
    const x2 = GRAD2[ba] * (xf - 1) + GRAD2[ba + 1] * yf;
    const y1 = GRAD2[ab] * xf + GRAD2[ab + 1] * (yf - 1);
    const y2 = GRAD2[bb] * (xf - 1) + GRAD2[bb + 1] * (yf - 1);
    const l1 = x1 + (x2 - x1) * u;
    const l2 = y1 + (y2 - y1) * u;
    return (l1 + (l2 - l1) * v) * 1.4;
  }

  fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise(x, y) * amp;
      norm += amp;
      amp *= gain;
      x = x * lacunarity + 31.7;
      y = y * lacunarity + 17.3;
    }
    return sum / norm;
  }

  ridged(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(this.noise(x, y));
      sum += n * n * amp;
      norm += amp;
      amp *= gain;
      x = x * lacunarity + 13.1;
      y = y * lacunarity + 7.9;
    }
    return sum / norm;
  }

  /** Smooth 1D gradient noise in [-1, 1] (camera shake). */
  noise1(x) {
    const i = Math.floor(x);
    const f = x - i;
    const g0 = this.g1[i & 255];
    const g1 = this.g1[(i + 1) & 255];
    const u = f * f * (3 - 2 * f);
    return (g0 * f * (1 - u) + g1 * (f - 1) * u) * 2.6;
  }
}

export const sharedNoise = new Noise2D(7);
