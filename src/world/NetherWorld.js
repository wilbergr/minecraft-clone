import { NETHER, WORLD } from '../config.js'
import { BLOCK_AIR, BLOCK_LAVA, isSolid } from './blocks.js'
import { World } from './World.js'

// The Nether (dimension N1 skeleton): a second World instance overriding
// only the pure generator methods — chunk streaming, meshing, edits,
// raycasts, physics queries, and persistence are all inherited untouched.
//
// The generation contract differs from the overworld's in one load-bearing
// way: `terrainHeight` returns the full chunk height for every column, so
// EVERY in-range cell is answered by `terrainBlock` (the overworld's
// water-fill and tree paths never run). The whole floor/roof/cavern sandwich
// therefore lives in terrainBlock as a pure function of (seed, x, y, z) —
// including the lava-sea fill, mirroring how overworld lava rides
// World.terrainBlock rather than the two-site water fill.
//
// N1 ships a placeholder slab generator (flat floor, flat roof, an open
// band between) so the dimension plumbing can land and be tested before the
// real cavern generator (N2) replaces it.
export class NetherWorld extends World {
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
  // and the Nether's own weights/cap — EMPTY weights for now (no Nether
  // mobs ship in this arc), which MobManager treats as "spawn nothing".
  get spawnProfile() {
    return {
      weights: NETHER.spawn.weights,
      cap: NETHER.spawn.maxCount,
      nightCap: NETHER.spawn.maxCount,
      maxLight: NETHER.spawn.maxLight,
      skyBrightness: 0,
    }
  }

  // N1 placeholder sandwich: solid slab floor, open band, solid roof slab.
  // Replaced by the real cavern generator in N2.
  terrainBlock(wx, wy, wz) {
    if (wy <= 30 || wy >= 90) return 3 // stone slabs
    return BLOCK_AIR
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
    // Fully solid column (rare): stand on the lava level's ceiling-ish and
    // let the physics self-heal eject handle the overlap.
    return NETHER.terrain.lava.level + 2
  }
}
