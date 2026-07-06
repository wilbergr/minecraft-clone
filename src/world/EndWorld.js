import { END, WORLD } from '../config.js'
import { BLOCK_AIR, BLOCK_END_STONE, BLOCK_OBSIDIAN } from './blocks.js'
import { createFBM2D, hash2D } from './noise.js'
import { World } from './World.js'

// The End: the third World instance, overriding only the pure generator
// methods — the NetherWorld contract seam for seam. `terrainHeight` returns
// the full chunk height so the floating island (solid band with air above
// AND below — the overworld height model can't express an underside) lives
// entirely in `terrainBlock` as a pure function of (seed, x, y, z).
//
// The island is a lens: per column, distance from origin against a
// noise-ragged effective radius decides island vs void; inside, a near-flat
// plateau tops it (softening at the rim) and the underside tapers as a
// teardrop. Six obsidian pillars stand on a fixed ring — flat tops, the
// dragon fight's crystal pedestals; their positions and heights are pure
// functions of the seed so the fight runner computes them with no world
// queries (`pillarSpots()`). Nothing else generates: the exit portal, the
// dragon egg, and the arrival platform are all stamped as EDITS at runtime
// (the Trial's "marked, not generated" purity rule).
//
// Falling off the island is lethal through the existing PHYSICS.voidY — the
// underside bottoms out ~44 blocks above the kill line, no bedrock, nothing
// to protect. Tunables in END (src/config.js); retune with
// `node tools/probe-end.mjs`.
export class EndWorld extends World {
  // Per-column memo (the NetherWorld pattern): terrainBlock is called in
  // y-inner loops, so consecutive calls share a column — one cached record
  // kills ~96 redundant noise evaluations per column.
  #colKey = null
  #col = null // { top, bottom, pillarTop } | null (void column)

  constructor(scene) {
    super(scene)
    this.hasSky = false // no dawn burn, no DayNight visual writes
    // Inert fluid (dimension seam): level -1 means the unloaded-chunk fill
    // never triggers and the wet-column spawn guard never rejects.
    this.fluid = { id: BLOCK_AIR, level: -1 }
    // Static void atmosphere + container key prefix (dimension seams read by
    // the controller — src/world/Dimensions.js).
    this.atmosphere = { skyColor: END.skyColor, fog: END.fog }
    this.containerPrefix = 'E|'
    // The End's own light rig: a low cool sun for directional contrast
    // against the black sky, dim lavender ambient.
    this.sun.intensity = END.lighting.sunIntensity
    this.sun.color.setHex(END.lighting.sunColor)
    this.ambient.intensity = END.lighting.ambientIntensity
    this.ambient.color.setHex(END.lighting.ambientColor)
    const i = END.island
    this.edgeNoise = createFBM2D(WORLD.seed ^ i.edgeSalt, { octaves: 2, lacunarity: 2, gain: 0.5 })
    this.topNoise = createFBM2D(WORLD.seed ^ i.topSalt, { octaves: 2, lacunarity: 2, gain: 0.5 })
    this.depthNoise = createFBM2D(WORLD.seed ^ i.depthSalt, { octaves: 2, lacunarity: 2, gain: 0.5 })
    this.pillars = this.#buildPillars()
  }

  // Every column generates full-height: all cells go through terrainBlock.
  terrainHeight() {
    return WORLD.chunkHeight
  }

  // No skyFactor override (unlike the Nether): there is no roof — the island
  // top is depth 0 (full bright) and player-dug overhangs darken naturally
  // on the inherited overworld curve.

  // The End spawns NOTHING ambiently — the dragon and its crystals enter
  // through the fight runner only (MobManager bails on a zero-weight table).
  get spawnProfile() {
    return { weights: {}, cap: 0, nightCap: 0, maxLight: 0, skyBrightness: 0 }
  }

  // The six pillar axes: a seed rotation plus even spacing, heights per-spot
  // hashed. Exposed for the fight runner (crystal pedestal positions) and
  // the probe — pure, no world queries.
  #buildPillars() {
    const p = END.pillars
    const rot = hash2D(WORLD.seed ^ p.heightSalt, 0, 0) * Math.PI * 2
    const pillars = []
    for (let k = 0; k < p.count; k++) {
      const a = rot + (k / p.count) * Math.PI * 2
      const px = Math.round(Math.sin(a) * p.ringRadius)
      const pz = Math.round(Math.cos(a) * p.ringRadius)
      const h = p.minHeight + Math.floor(
        hash2D(WORLD.seed ^ p.heightSalt, px, pz) * (p.maxHeight - p.minHeight + 1),
      )
      pillars.push({ x: px, z: pz, top: END.island.surfaceY + h })
    }
    return pillars
  }

  // Island column at (wx, wz): { top, bottom, pillarTop } or null for void.
  // Memoized for the last-touched column (the NetherWorld pattern).
  #column(wx, wz) {
    const key = wx * 65536 + wz
    if (key === this.#colKey) return this.#col
    this.#colKey = key
    const i = END.island
    const d = Math.hypot(wx, wz)
    const re = i.radius + this.edgeNoise(wx / 24, wz / 24) * i.edgeAmplitude
    if (d >= re) {
      this.#col = null
      return null
    }
    const t = 1 - d / re
    const top = Math.round(
      i.surfaceY + this.topNoise(wx / 18, wz / 18) * i.topAmplitude * Math.min(1, t * 3),
    )
    const depth = Math.round(
      i.maxDepth * Math.pow(t, 1.3) * (0.75 + 0.5 * ((this.depthNoise(wx / 20, wz / 20) + 1) / 2)),
    )
    const bottom = Math.max(i.minBottom, top - Math.max(1, depth))
    // Pillar coverage folded into the column memo: obsidian from the island
    // body up to the pillar's flat top.
    let pillarTop = null
    const r = END.pillars.radius
    for (const p of this.pillars) {
      const dx = wx - p.x
      const dz = wz - p.z
      if (dx * dx + dz * dz < r * r) {
        pillarTop = p.top
        break
      }
    }
    this.#col = { top, bottom, pillarTop }
    return this.#col
  }

  // The whole island, one pure function. `h`/`biome` params exist for
  // signature compatibility with the base class's callers and are unused.
  terrainBlock(wx, wy, wz) {
    const col = this.#column(wx, wz)
    if (!col) return BLOCK_AIR // void column
    if (col.pillarTop !== null && wy >= col.bottom && wy <= col.pillarTop) {
      return BLOCK_OBSIDIAN
    }
    if (wy >= col.bottom && wy <= col.top) return BLOCK_END_STONE
    return BLOCK_AIR
  }

  // No trees, no biomes: the canopy fallback and biome tints never engage.
  treeAt() {
    return null
  }

  biomeAt() {
    return this.biomeBands[1] // static plains profile — tint paths stay inert
  }

  // surfaceY is deliberately NOT overridden: with no roof the base top-down
  // scan answers correctly (island surface, or a pillar top for pillar
  // columns). On a pure void column it returns 0 — every caller in the End
  // (fight-runner spawns, egg/exit-portal placement, portal arrival) uses
  // known island columns.
}
