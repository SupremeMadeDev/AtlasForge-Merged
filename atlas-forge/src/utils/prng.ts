/**
 * Deterministic Mulberry32 PRNG for reproducible continent and city layouts.
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2D(ix: number, iy: number, seed: number): number {
  let h = ix * 374761393 + iy * 668265263 + seed * 1442695041;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * 2D smooth value noise in [0, 1]
 */
export function valueNoise2D(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smoothstep(x - ix);
  const fy = smoothstep(y - iy);

  const v00 = hash2D(ix, iy, seed);
  const v10 = hash2D(ix + 1, iy, seed);
  const v01 = hash2D(ix, iy + 1, seed);
  const v11 = hash2D(ix + 1, iy + 1, seed);

  const nx0 = v00 + (v10 - v00) * fx;
  const nx1 = v01 + (v11 - v01) * fx;
  return nx0 + (nx1 - nx0) * fy;
}

/**
 * Fractal Brownian Motion in [0, 1]
 */
export function fbm2D(x: number, y: number, seed: number, octaves = 4): number {
  let total = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;

  for (let i = 0; i < octaves; i++) {
    total += valueNoise2D(x * frequency, y * frequency, seed + i * 97) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.02;
  }

  return norm > 0 ? total / norm : 0.5;
}
