import { NETHER, WORLD } from '../config.js'
import {
  BLOCK_AIR,
  BLOCK_BEDROCK,
  BLOCK_GLOWSTONE,
  BLOCK_LAVA,
  BLOCK_NETHERRACK,
  BLOCK_OBSIDIAN,
  BLOCK_QUARTZ_ORE,
  BLOCK_SOUL_SAND,
  isSolid,
} from './blocks.js'
import { createFBM2D, createValueNoise3D, hash2D, hash3D } from './noise.js'
import { World } from './World.js'

// The Nether: a second World instance overriding only the pure generator
// methods — chunk streaming, meshing, edits, raycasts, physics queries, and
// persistence are all inherited untouched.
//
// The generation contract differs from the overworld's in one load-bearing
// way: `terrainHeight` returns the full chunk height for every column, so
// EVERY in-range cell is answered by `terrainBlock` (the overworld's
// water-fill and tree paths never run). The whole sandwich therefore lives
// in terrainBlock as a pure function of (seed, x, y, z) — bedrock caps,
// solid netherrack shoulders, FBM floor + ceiling relief, a 3D wall field
// re-solidifying the open band into pillars/curtains, lava seas flooding
// open cells at depth (mirroring how overworld lava rides terrainBlock),
// obsidian shells where rock meets a sea, ceiling glowstone clusters (the
// tree-canopy mirror-stamp idea), soul-sand basin patches, and quartz ore.
// Tunables in NETHER.terrain; retune with `node tools/probe-nether.mjs`.
export class NetherWorld extends World {
  // Per-column floor/ceiling memo: terrainBlock is called in y-inner loops
  // (Chunk.generate, topSolidY), so consecutive calls share a column — one
  // cached pair kills ~96 redundant FBM evaluations per column.
  #colKey = null
  #colFloor = 0
  #colCeil = 0

  constructor(scene) {
    super(scene)
    this.hasSky = false // no dawn burn, no DayNight visuals under the roof
    // The generation liquid is lava: terrainBlock does the actual filling
    // (columns generate full-height), but MobManager's wet-column guard and
    // the liquid mesh passes read the fluid identity from here.
    this.fluid = { id: BLOCK_LAVA, level: NETHER.terrain.lava.level }
    // The Nether's own light rig: no sun (nothing drives it — DayNight owns
    // only the overworld's), a warm dim ambient so unlit faces stay readable.
    this.sun.intensity = 0
    this.ambient.intensity = NETHER.lighting.ambientIntensity
    this.ambient.color.setHex(NETHER.lighting.ambientColor)
    const t = NETHER.terrain
    this.floorNoise = createFBM2D(WORLD.seed ^ t.floor.seedSalt, t.floor)
    this.ceilNoise = createFBM2D(WORLD.seed ^ t.ceiling.seedSalt, t.ceiling)
    this.wallNoise = createValueNoise3D(WORLD.seed ^ t.walls.seedSalt)
  }

  // Every column generates full-height: all cells go through terrainBlock.
  terrainHeight() {
    return WORLD.chunkHeight
  }

  // Flat visibility floor (dimension seam): under a solid roof every face is
  // "deep", so the overworld curve would render the whole dimension at the
  // cave minimum. Open-sky tops (the roof itself) stay at 1.
  skyFactor(depth) {
    return depth <= 0 ? 1 : NETHER.lighting.minSkyLight
  }

  // Hostile spawns read this live (MobManager): no sky term, a slightly
  // looser light gate (the visibility floor sits above the overworld gate),
  // and the Nether's own weights/cap — zombified piglins and magma cubes
  // (N5), spawning in the dark at any hour since the sky term is zero.
  get spawnProfile() {
    return {
      weights: NETHER.spawn.weights,
      cap: NETHER.spawn.maxCount,
      nightCap: NETHER.spawn.maxCount,
      maxLight: NETHER.spawn.maxLight,
      skyBrightness: 0,
    }
  }

  // Cavern floor height of the column at (wx, wz) — the top of the solid
  // floor relief (the wall field can still re-solidify cells above it).
  floorHeight(wx, wz) {
    const f = NETHER.terrain.floor
    return Math.round(f.base + this.floorNoise(wx * f.frequency, wz * f.frequency) * f.amplitude)
  }

  // Cavern ceiling height — cells at or above it are solid roof.
  ceilingHeight(wx, wz) {
    const c = NETHER.terrain.ceiling
    return Math.round(c.base + this.ceilNoise(wx * c.frequency, wz * c.frequency) * c.amplitude)
  }

  // Is (wx, wy, wz) open cavern space (before the lava-sea fill)? Pure —
  // the obsidian-shell neighbor test and the mesher's border queries agree.
  openAt(wx, wy, wz) {
    const t = NETHER.terrain
    if (wy <= t.shoulders.floor || wy >= t.shoulders.roof) return false
    if (wy <= this.#floorOf(wx, wz) || wy >= this.#ceilOf(wx, wz)) return false
    return !this.#wallAt(wx, wy, wz)
  }

  // Memoized floor/ceiling for the last-touched column (see #colKey note).
  #floorOf(wx, wz) {
    const key = wx * 65536 + wz
    if (key !== this.#colKey) {
      this.#colKey = key
      this.#colFloor = this.floorHeight(wx, wz)
      this.#colCeil = this.ceilingHeight(wx, wz)
    }
    return this.#colFloor
  }

  #ceilOf(wx, wz) {
    this.#floorOf(wx, wz)
    return this.#colCeil
  }

  // The 3D wall field: two octaves of value noise, vertically STRETCHED
  // (ySquash < 1) so re-solidified rock reads as pillars and curtains, not
  // the overworld's flattened tunnels.
  #wallAt(wx, wy, wz) {
    const { frequency, ySquash, threshold } = NETHER.terrain.walls
    const fx = wx * frequency
    const fy = wy * frequency * ySquash
    const fz = wz * frequency
    const n =
      0.6 * this.wallNoise(fx, fy, fz) + 0.4 * this.wallNoise(fx * 2, fy * 2, fz * 2)
    return n > threshold
  }

  // Ceiling glowstone clusters: a hash-seeded center column grows a small
  // teardrop — 3 cells hanging under the center's ceiling, 1 under each of
  // the 4 cross neighbors (all anchored to the CENTER column's ceiling, the
  // tree-canopy convention, so the blob stays coherent across relief).
  // Checked before open/solid classification: a blob edge that lands inside
  // ceiling rock simply embeds there, which reads exactly right.
  #glowstoneAt(wx, wy, wz) {
    const g = NETHER.terrain.glowstone
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const r = Math.abs(dx) + Math.abs(dz)
        if (r > 1) continue // center + the 4 cross neighbors
        const cx = wx + dx
        const cz = wz + dz
        if (hash2D(WORLD.seed ^ g.salt, cx, cz) >= g.chance) continue
        const ceil = this.ceilingHeight(cx, cz)
        const depth = r === 0 ? 3 : 1
        if (wy < ceil && wy >= ceil - depth) return true
      }
    }
    return false
  }

  // Generated lava: open cavern space at or below the sea level.
  lavaAt(wx, wy, wz) {
    return wy <= NETHER.terrain.lava.level && this.openAt(wx, wy, wz)
  }

  #lavaAdjacent(wx, wy, wz) {
    return (
      this.lavaAt(wx, wy + 1, wz) ||
      this.lavaAt(wx, wy - 1, wz) ||
      this.lavaAt(wx + 1, wy, wz) ||
      this.lavaAt(wx - 1, wy, wz) ||
      this.lavaAt(wx, wy, wz + 1) ||
      this.lavaAt(wx, wy, wz - 1)
    )
  }

  // The whole sandwich, one pure function. `h`/`biome` params exist for
  // signature compatibility with the base class's callers and are unused.
  terrainBlock(wx, wy, wz) {
    const t = NETHER.terrain
    if (wy < t.bedrock.floor || wy >= t.bedrock.roof) return BLOCK_BEDROCK
    if (this.#glowstoneAt(wx, wy, wz)) return BLOCK_GLOWSTONE
    if (this.openAt(wx, wy, wz)) {
      return wy <= t.lava.level ? BLOCK_LAVA : BLOCK_AIR
    }
    // Solid rock. Quartz first (ores win over the crust, the lava-PR rule).
    const q = t.quartz
    if (wy >= q.minY && wy <= q.maxY && hash3D(WORLD.seed ^ q.salt, wx, wy, wz) < q.chance) {
      return BLOCK_QUARTZ_ORE
    }
    // Obsidian shell where rock touches a lava sea (height-gated off the
    // hot path, the overworld crust rule).
    if (wy <= t.lava.level + 1 && this.#lavaAdjacent(wx, wy, wz)) {
      return BLOCK_OBSIDIAN
    }
    // Soul sand: floor-surface cells in low basins near the seas.
    const floor = this.#floorOf(wx, wz)
    if (
      wy === floor &&
      floor <= t.lava.level + t.soulSand.basinAbove &&
      hash2D(WORLD.seed ^ t.soulSand.salt, wx, wz) < t.soulSand.chance
    ) {
      return BLOCK_SOUL_SAND
    }
    return BLOCK_NETHERRACK
  }

  // No trees, no biomes: the canopy fallback and biome tints never engage.
  treeAt() {
    return null
  }

  biomeAt() {
    return this.biomeBands[1] // static plains profile — tint paths stay inert
  }

  // The walkable answer (load-bearing override): the base class scans
  // top-down and would answer "on the roof". Scan bottom-up above the lava
  // level for the first standable pocket instead — solid floor, two air
  // cells. Mob.attachBody, portal arrivals, and the post-load lava guard all
  // land on a real cavern floor through this.
  surfaceY(x, z) {
    const wx = Math.floor(x)
    const wz = Math.floor(z)
    for (let y = NETHER.terrain.lava.level + 1; y < WORLD.chunkHeight - 1; y++) {
      if (
        isSolid(this.blockAt(wx, y - 1, wz)) &&
        this.blockAt(wx, y, wz) === BLOCK_AIR &&
        this.blockAt(wx, y + 1, wz) === BLOCK_AIR
      ) {
        return y
      }
    }
    // Fully solid column (rare): stand just above the sea level and let the
    // physics self-heal eject work the body free.
    return NETHER.terrain.lava.level + 2
  }
}
