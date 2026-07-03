// Vendored seeded noise — no runtime network, no dependency.
// 2D simplex noise (Stefan Gustavson's public-domain algorithm) with a
// mulberry32-seeded permutation table, plus a fractal-Brownian-motion wrapper.

const F2 = 0.5 * (Math.sqrt(3) - 1)
const G2 = (3 - Math.sqrt(3)) / 6

// prettier-ignore
const GRAD2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
]

// Small, fast, deterministic PRNG — good enough for shuffling a perm table.
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Deterministic per-coordinate hashes -> [0, 1). Unlike the noise functions
// these are uncorrelated between neighbors — used for scattering discrete
// features (trees per column, ore per block) as pure functions of position.
export function hash2D(seed, x, z) {
  let h = (seed | 0) ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export function hash3D(seed, x, y, z) {
  return hash2D(seed ^ Math.imul(y | 0, 0x9e3779b1), x, z)
}

// Returns noise2D(x, y) -> [-1, 1], deterministic for a given seed.
export function createNoise2D(seed) {
  const rand = mulberry32(seed)
  const p = Uint8Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = p[i]
    p[i] = p[j]
    p[j] = tmp
  }
  const perm = new Uint8Array(512)
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]

  return function noise2D(xin, yin) {
    // Skew input space to find the containing simplex cell.
    const s = (xin + yin) * F2
    const i = Math.floor(xin + s)
    const j = Math.floor(yin + s)
    const t = (i + j) * G2
    const x0 = xin - (i - t)
    const y0 = yin - (j - t)

    // Which triangle of the cell are we in?
    const i1 = x0 > y0 ? 1 : 0
    const j1 = x0 > y0 ? 0 : 1
    const x1 = x0 - i1 + G2
    const y1 = y0 - j1 + G2
    const x2 = x0 - 1 + 2 * G2
    const y2 = y0 - 1 + 2 * G2

    const ii = i & 255
    const jj = j & 255
    let n = 0

    let t0 = 0.5 - x0 * x0 - y0 * y0
    if (t0 > 0) {
      t0 *= t0
      const g = GRAD2[perm[ii + perm[jj]] & 7]
      n += t0 * t0 * (g[0] * x0 + g[1] * y0)
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1
    if (t1 > 0) {
      t1 *= t1
      const g = GRAD2[perm[ii + i1 + perm[jj + j1]] & 7]
      n += t1 * t1 * (g[0] * x1 + g[1] * y1)
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2
    if (t2 > 0) {
      t2 *= t2
      const g = GRAD2[perm[ii + 1 + perm[jj + 1]] & 7]
      n += t2 * t2 * (g[0] * x2 + g[1] * y2)
    }

    // Scale to [-1, 1].
    return 70 * n
  }
}

// Fractal Brownian motion over 2D simplex: sums `octaves` layers of noise at
// increasing frequency / decreasing amplitude, normalized back to [-1, 1].
export function createFBM2D(seed, { octaves, lacunarity, gain }) {
  const noise = createNoise2D(seed)
  return function fbm2D(x, y) {
    let sum = 0
    let norm = 0
    let amp = 1
    let freq = 1
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x * freq, y * freq)
      norm += amp
      amp *= gain
      freq *= lacunarity
    }
    return sum / norm
  }
}
