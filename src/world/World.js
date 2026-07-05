import * as THREE from 'three'
import { LIGHTING, WATER, WORLD } from '../config.js'
import { BLOCKS, BLOCK_AIR, BLOCK_TORCH, BLOCK_WATER, isSolid, isTargetable } from './blocks.js'
import { createFBM2D, createValueNoise3D, hash2D, hash3D } from './noise.js'
import { createAtlasTexture } from './atlas.js'
import { Chunk, skyFactor } from './Chunk.js'

// Chunked procedural voxel world. Chunks within WORLD.renderDistance of the
// player are generated on demand (a few per frame, nearest first) and dropped
// again once the player moves away; player edits are kept in an overlay map so
// they survive unload/reload. Terrain is a deterministic function of
// (WORLD.seed, x, z), so any block can be answered without its chunk existing.
export class World {
  constructor(scene) {
    this.scene = scene
    this.chunks = new Map() // "cx,cz" -> Chunk
    this.edits = new Map() // "cx,cz" -> Map(blockIndex -> blockId)
    // Textured chunks (Phase 13): the procedural atlas is the albedo map and
    // vertexColors stays ON as the tint layer (face shade × Phase 11 depth
    // darkening × biome tint) — the shader multiplies map × vertex color.
    // The texture is null only without a DOM (node generator probes).
    this.atlas = createAtlasTexture()
    this.material = new THREE.MeshLambertMaterial({
      map: this.atlas,
      vertexColors: true,
    })
    // Sea water pass (Phase 10): translucent and double-sided so the surface
    // reads from below too; depthWrite off keeps chunk-to-chunk transparency
    // sorting artifact-free. Chunks build their water mesh with this.
    this.waterMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      transparent: true,
      opacity: WATER.opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    this.fbm = createFBM2D(WORLD.seed, WORLD.terrain)
    // Cave field (Phase 11): two octaves of 3D value noise, seeded off the
    // world seed so caves are as deterministic as the rest of the terrain.
    this.caveNoise = createValueNoise3D(WORLD.seed ^ WORLD.terrain.caves.seedSalt)
    // Biome field (Phase 13): a second, much lower-frequency FBM. Bands get
    // their tints pre-parsed into THREE.Colors once (the mesher multiplies
    // them into vertex colors every face).
    this.biomeNoise = createFBM2D(WORLD.seed ^ WORLD.terrain.biomes.seedSalt, WORLD.terrain.biomes)
    // Continentalness field (deep water): a third low-frequency FBM masks
    // out ocean basins — terrainHeight shelves toward the deep seabed where
    // it exceeds the mask band. Pure like all terrain noise.
    this.oceanNoise = createFBM2D(WORLD.seed ^ WORLD.terrain.ocean.seedSalt, WORLD.terrain.ocean)
    this.biomeBands = WORLD.terrain.biomes.bands.map((band) => ({
      ...band,
      grassColor: new THREE.Color(band.grassTint),
      leafColor: new THREE.Color(band.leafTint),
    }))
    // Placed torches, "x,y,z" -> {x, y, z} — kept in lockstep with the edit
    // overlay (torches only ever come from player edits, never generation)
    // and consumed by TorchLights to position its point-light pool.
    this.torches = new Map()
    this.genQueue = [] // [cx, cz] pairs pending generation, nearest first
    // Edit listeners (King's Trial PR 2 promoted the old single-assignment
    // onEdit callback to a list): SaveManager marks the save dirty, the
    // challenge re-checks the beacon. Subscribe via onEdit(fn).
    this.editListeners = []
    this.#buildLights()
  }

  #key(cx, cz) {
    return `${cx},${cz}`
  }

  // Subscribe to world edits. Listeners receive the edit's world coords —
  // per block for setBlock, once with the blast center for explode — so
  // subscribers can filter by proximity without walking the overlay.
  onEdit(fn) {
    this.editListeners.push(fn)
  }

  #emitEdit(wx, wy, wz) {
    for (const fn of this.editListeners) fn(wx, wy, wz)
  }

  // --- Terrain generator (pure functions of world position) ---------------

  // Biome of the column at (wx, wz): the first band whose `max` covers the
  // low-frequency biome noise. Pure function of (seed, x, z), like all
  // terrain — the mesher, generator, and unloaded-chunk queries all agree.
  biomeAt(wx, wz) {
    const f = WORLD.terrain.biomes.frequency
    const n = this.biomeNoise(wx * f, wz * f)
    for (const band of this.biomeBands) {
      if (n <= band.max) return band
    }
    return this.biomeBands[this.biomeBands.length - 1]
  }

  // Surface height (number of solid blocks) of the column at (wx, wz).
  // The biome noise scales relief SMOOTHLY from its raw value (desert end
  // flat, snow end mountainous) — using the continuous noise rather than the
  // discrete band means biome borders never step-cliff.
  terrainHeight(wx, wz) {
    const { baseHeight, amplitude, frequency, biomes, ocean } = WORLD.terrain
    const n = this.fbm(wx * frequency, wz * frequency)
    const b = this.biomeNoise(wx * biomes.frequency, wz * biomes.frequency)
    const scale =
      biomes.amplitude.min + (biomes.amplitude.max - biomes.amplitude.min) * (b + 1) / 2
    let h = Math.round(baseHeight + n * amplitude * scale)
    // Ocean basins (deep water): where the continentalness noise exceeds
    // maskStart, depress the surface toward the deep seabed. smoothstep
    // across [maskStart, maskFull] makes shores shelve gently underwater —
    // no cliff at the coastline (the biome-relief continuity rule). Where
    // the mask is zero the height is byte-identical to the pre-ocean
    // generator, so ~86% of the world is untouched.
    const o = this.oceanNoise(wx * ocean.frequency, wz * ocean.frequency)
    if (o > ocean.maskStart) {
      const t = Math.min(1, (o - ocean.maskStart) / (ocean.maskFull - ocean.maskStart))
      const s = t * t * (3 - 2 * t)
      h = Math.round(h + (ocean.floorHeight - h) * s)
    }
    return Math.max(2, Math.min(h, WORLD.chunkHeight - 8))
  }

  // Block id at height y of an untouched column with surface height h:
  // the biome's surface block (grass / sand / snow-over-dirt) on top — sand
  // near "sea level" regardless, so beaches ring the water in every climate —
  // dirt-family below, stone deeper.
  blockForDepth(y, h, biome) {
    if (y >= h) return BLOCK_AIR
    const { dirtDepth, sandLevel } = WORLD.terrain
    const sandy = h - 1 <= sandLevel || biome.surface === 'sand'
    if (y === h - 1) {
      if (sandy) return 4 // sand
      return biome.surface === 'snow' ? 14 : 1 // snow : grass
    }
    if (y >= h - 1 - dirtDepth) return sandy ? 4 : 2 // sand : dirt
    return 3 // stone
  }

  // Is (wx, wy, wz) inside a carved cave? Pure function of (seed, x, y, z) —
  // called for every below-surface block, so both Chunk.generate and the
  // unloaded-chunk blockAt path agree (the purity rule border meshing needs).
  // Sea/beach columns keep their top blocks solid so caves never puncture
  // the seabed (there is no water flow to fill the hole).
  caveAt(wx, wy, wz, h) {
    const { frequency, ySquash, threshold, minY, seabedKeep } = WORLD.terrain.caves
    if (wy < minY) return false
    const keep = h - 1 <= WATER.level + 1 ? seabedKeep : 0
    if (wy >= h - keep) return false
    const fx = wx * frequency
    const fy = wy * frequency * ySquash
    const fz = wz * frequency
    const n =
      0.6 * this.caveNoise(fx, fy, fz) + 0.4 * this.caveNoise(fx * 2, fy * 2, fz * 2)
    return n > threshold
  }

  // Below-surface block including scattered features: cave carving first,
  // then the base layering, with deep stone occasionally replaced by an ore
  // from the depth-banded WORLD.terrain.ores table (first matching band wins).
  // Callers looping a column pass `biome` (one lookup per column instead of
  // per block); single-block queries let it default.
  terrainBlock(wx, wy, wz, h, biome = this.biomeAt(wx, wz)) {
    if (this.caveAt(wx, wy, wz, h)) return BLOCK_AIR
    const id = this.blockForDepth(wy, h, biome)
    if (id !== 3) return id
    for (const ore of WORLD.terrain.ores) {
      if (wy < ore.minY || wy > ore.maxY) continue
      if (hash3D(WORLD.seed ^ ore.salt, wx, wy, wz) < ore.chance) return ore.blockId
    }
    return id
  }

  // Does a tree stand on the column at (wx, wz)? Trees are a pure function of
  // position (cheap hash first, terrain checks only on a hit): trunk fills
  // y in [base, top), a leaf cap sits at y == top, and a 3x3 canopy wraps the
  // top two trunk levels. Tree density is the biome's (forests thick, plains
  // sparse, deserts bare); beaches stay bare in every climate.
  treeAt(wx, wz) {
    const { trees, sandLevel } = WORLD.terrain
    const biome = this.biomeAt(wx, wz)
    if (hash2D(WORLD.seed ^ 0x51ab, wx, wz) >= biome.treeChance) return null
    if (biome.surface === 'sand') return null
    const h = this.terrainHeight(wx, wz)
    if (h - 1 <= sandLevel) return null
    const span = trees.maxTrunk - trees.minTrunk + 1
    const trunk =
      trees.minTrunk + Math.floor(hash2D(WORLD.seed ^ 0x77f3, wx, wz) * span)
    return { base: h, top: h + trunk }
  }

  // Tree block (wood/leaves/air) at an above-surface position. Mirrors the
  // stamping in Chunk.generate for chunks that aren't loaded: the column's
  // own trunk wins, then any canopy from trees within 1 block.
  #treeBlockAt(wx, wy, wz) {
    const self = this.treeAt(wx, wz)
    if (self) {
      if (wy >= self.base && wy < self.top) return 5 // trunk
      if (wy === self.top) return 6 // leaf cap
    }
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue
        const tree = this.treeAt(wx + dx, wz + dz)
        if (tree && wy >= tree.top - 2 && wy < tree.top) return 6 // canopy
      }
    }
    return BLOCK_AIR
  }

  // --- Block access (world coordinates) ------------------------------------

  blockAt(wx, wy, wz) {
    if (wy < 0 || wy >= WORLD.chunkHeight) return BLOCK_AIR
    const cx = Math.floor(wx / WORLD.chunkSize)
    const cz = Math.floor(wz / WORLD.chunkSize)
    const lx = wx - cx * WORLD.chunkSize
    const lz = wz - cz * WORLD.chunkSize
    const chunk = this.chunks.get(this.#key(cx, cz))
    if (chunk) return chunk.getBlock(lx, wy, lz)
    // Chunk not loaded: recorded edit, else the deterministic generator.
    const chunkEdits = this.edits.get(this.#key(cx, cz))
    if (chunkEdits) {
      const idx = (lx * WORLD.chunkSize + lz) * WORLD.chunkHeight + wy
      const edited = chunkEdits.get(idx)
      if (edited !== undefined) return edited
    }
    const h = this.terrainHeight(wx, wz)
    if (wy < h) return this.terrainBlock(wx, wy, wz, h)
    // Sea water fills the air below the waterline (mirrors Chunk.generate,
    // so the answer for an unloaded chunk matches what it would mesh as).
    if (wy <= WATER.level) return BLOCK_WATER
    return this.#treeBlockAt(wx, wy, wz)
  }

  // Set a block and remesh the affected chunk (and neighbors when the block
  // sits on a chunk border, so their culled faces update too). This is the
  // single entry point for all world edits — later phases (inventory,
  // treasure digging) go through here.
  setBlock(wx, wy, wz, id) {
    if (wy < 0 || wy >= WORLD.chunkHeight) return false
    const cx = Math.floor(wx / WORLD.chunkSize)
    const cz = Math.floor(wz / WORLD.chunkSize)
    const lx = wx - cx * WORLD.chunkSize
    const lz = wz - cz * WORLD.chunkSize
    const key = this.#key(cx, cz)

    let chunkEdits = this.edits.get(key)
    if (!chunkEdits) {
      chunkEdits = new Map()
      this.edits.set(key, chunkEdits)
    }
    chunkEdits.set((lx * WORLD.chunkSize + lz) * WORLD.chunkHeight + wy, id)

    // Torch registry (Phase 11): placing a torch lights it, any other write
    // to the cell (breaking it, replacing it) unlights it.
    const torchKey = `${wx},${wy},${wz}`
    if (id === BLOCK_TORCH) this.torches.set(torchKey, { x: wx, y: wy, z: wz })
    else this.torches.delete(torchKey)

    const chunk = this.chunks.get(key)
    if (chunk) {
      chunk.setBlock(lx, wy, lz, id)
      chunk.buildMesh(this.material)
      // Border blocks also change the face culling of the adjacent chunk.
      if (lx === 0) this.#remesh(cx - 1, cz)
      if (lx === WORLD.chunkSize - 1) this.#remesh(cx + 1, cz)
      if (lz === 0) this.#remesh(cx, cz - 1)
      if (lz === WORLD.chunkSize - 1) this.#remesh(cx, cz + 1)
    }
    this.#emitEdit(wx, wy, wz)
    return true
  }

  // Carve a sphere of blocks to air (Phase 13: creeper explosions), batched:
  // every removed block lands in the edit overlay (and loaded chunk data)
  // first, then each affected chunk remeshes ONCE — a blast through setBlock
  // would rebuild the same chunk dozens of times. Water and air are left
  // alone (no flow simulation to fill a carved seabed), y 0 stays solid like
  // the cave floor, `blastResistant` blocks survive, and any torches in the
  // sphere unregister.
  //
  // Returns the carved cells as [{ x, y, z, id }] (id = the block that was
  // there) so callers can notify per-block break handlers — exploded
  // furnaces/chests spill their contents instead of orphaning them (see the
  // blockBreakHandlers wiring in main.js).
  explode(cx, cy, cz, radius) {
    const r2 = radius * radius
    const dirty = new Set() // "cx,cz" chunk keys needing a remesh
    const carved = []
    for (let wx = Math.floor(cx - radius); wx <= Math.floor(cx + radius); wx++) {
      for (let wy = Math.floor(cy - radius); wy <= Math.floor(cy + radius); wy++) {
        for (let wz = Math.floor(cz - radius); wz <= Math.floor(cz + radius); wz++) {
          const dx = wx + 0.5 - cx
          const dy = wy + 0.5 - cy
          const dz = wz + 0.5 - cz
          if (dx * dx + dy * dy + dz * dz > r2) continue
          if (wy < 1 || wy >= WORLD.chunkHeight) continue
          const id = this.blockAt(wx, wy, wz)
          const block = BLOCKS[id]
          if (!block || (!block.solid && !block.targetable)) continue // air/water stay
          if (block.blastResistant) continue // e.g. the King's Cache — unrecoverable if carved
          this.#recordEdit(wx, wy, wz, BLOCK_AIR, dirty)
          carved.push({ x: wx, y: wy, z: wz, id })
        }
      }
    }
    for (const key of dirty) {
      const chunk = this.chunks.get(key)
      if (chunk) chunk.buildMesh(this.material)
    }
    if (dirty.size > 0) this.#emitEdit(Math.floor(cx), Math.floor(cy), Math.floor(cz))
    return carved
  }

  // Shared write path for batched edits: record the overlay entry, keep the
  // torch registry in lockstep, update loaded chunk data, and mark the chunk
  // (plus border neighbors) as needing a remesh — without remeshing yet.
  #recordEdit(wx, wy, wz, id, dirty) {
    const cx = Math.floor(wx / WORLD.chunkSize)
    const cz = Math.floor(wz / WORLD.chunkSize)
    const lx = wx - cx * WORLD.chunkSize
    const lz = wz - cz * WORLD.chunkSize
    const key = this.#key(cx, cz)

    let chunkEdits = this.edits.get(key)
    if (!chunkEdits) {
      chunkEdits = new Map()
      this.edits.set(key, chunkEdits)
    }
    chunkEdits.set((lx * WORLD.chunkSize + lz) * WORLD.chunkHeight + wy, id)

    const torchKey = `${wx},${wy},${wz}`
    if (id === BLOCK_TORCH) this.torches.set(torchKey, { x: wx, y: wy, z: wz })
    else this.torches.delete(torchKey)

    const chunk = this.chunks.get(key)
    if (chunk) {
      chunk.setBlock(lx, wy, lz, id)
      dirty.add(key)
      if (lx === 0) dirty.add(this.#key(cx - 1, cz))
      if (lx === WORLD.chunkSize - 1) dirty.add(this.#key(cx + 1, cz))
      if (lz === 0) dirty.add(this.#key(cx, cz - 1))
      if (lz === WORLD.chunkSize - 1) dirty.add(this.#key(cx, cz + 1))
    }
  }

  // --- Persistence seam (Phase 5) -------------------------------------------
  // Only the edit overlay is saved — terrain regenerates from the seed, so a
  // world of any size costs storage proportional to player changes only.

  serializeEdits() {
    const out = {}
    for (const [key, chunkEdits] of this.edits) out[key] = [...chunkEdits]
    return out // { "cx,cz": [[blockIndex, blockId], ...], ... }
  }

  deserializeEdits(data) {
    this.edits = new Map()
    for (const [key, entries] of Object.entries(data)) {
      if (!Array.isArray(entries)) continue
      this.edits.set(key, new Map(entries))
    }
    this.#rebuildTorches()
  }

  // Recover torch world positions from the loaded edit overlay (torches only
  // exist as edits, so the overlay is the complete source of truth).
  #rebuildTorches() {
    this.torches = new Map()
    const S = WORLD.chunkSize
    const H = WORLD.chunkHeight
    for (const [key, chunkEdits] of this.edits) {
      const [cx, cz] = key.split(',').map(Number)
      for (const [idx, id] of chunkEdits) {
        if (id !== BLOCK_TORCH) continue
        const wy = idx % H
        const lz = Math.floor(idx / H) % S
        const lx = Math.floor(idx / (H * S))
        const wx = cx * S + lx
        const wz = cz * S + lz
        this.torches.set(`${wx},${wy},${wz}`, { x: wx, y: wy, z: wz })
      }
    }
  }

  editCount() {
    let n = 0
    for (const chunkEdits of this.edits.values()) n += chunkEdits.size
    return n
  }

  #remesh(cx, cz) {
    const chunk = this.chunks.get(this.#key(cx, cz))
    if (chunk) chunk.buildMesh(this.material)
  }

  // y of the walkable surface (top solid block + 1) at world (x, z) floats.
  surfaceY(x, z) {
    const wx = Math.floor(x)
    const wz = Math.floor(z)
    for (let y = WORLD.chunkHeight - 1; y >= 0; y--) {
      if (isSolid(this.blockAt(wx, y, wz))) return y + 1
    }
    return 0
  }

  // y of the highest solid block in the column at (wx, wz), or -1 for an
  // all-air column. Feeds depth lighting (Phase 11): a face's brightness is
  // how far its air cell sits below this. Loaded chunks answer from live
  // block data (so digging open a shaft lets the light in on remesh);
  // unloaded neighbors fall back to the pure generator — trees, then the
  // terrain surface walked down past any cave carving.
  topSolidY(wx, wz) {
    const cx = Math.floor(wx / WORLD.chunkSize)
    const cz = Math.floor(wz / WORLD.chunkSize)
    const chunk = this.chunks.get(this.#key(cx, cz))
    if (chunk) {
      const lx = wx - cx * WORLD.chunkSize
      const lz = wz - cz * WORLD.chunkSize
      for (let y = WORLD.chunkHeight - 1; y >= 0; y--) {
        if (isSolid(chunk.getBlock(lx, y, lz))) return y
      }
      return -1
    }
    const h = this.terrainHeight(wx, wz)
    const biome = this.biomeAt(wx, wz)
    // Nothing solid sits above h + maxTrunk (the tallest possible leaf cap);
    // above-surface cells are tree blocks, below-surface the terrain block.
    for (let y = h + WORLD.terrain.trees.maxTrunk; y >= 0; y--) {
      const id =
        y < h ? this.terrainBlock(wx, y, wz, h, biome) : this.#treeBlockAt(wx, y, wz)
      if (isSolid(id)) return y
    }
    return -1
  }

  // Spawn-relevant light level [0, 1] at block (wx, wy, wz): the Phase 11
  // depth sky light (skyFactor of how far the cell sits below its column's
  // top solid block) scaled by the time-of-day `skyBrightness`
  // (daynight.skyBrightness — pass 0 for "no sky contribution"), maxed with
  // the nearest placed torch's falloff. The torch radius reuses
  // LIGHTING.torch.distance so the protective bubble always equals the
  // visibly-lit bubble; like the visual point lights, torch light ignores
  // walls (the Phase 11 budget rule — no flood-fill). Consumed by
  // MobManager's dark-places spawn check.
  lightAt(wx, wy, wz, skyBrightness = 1) {
    const sky = skyFactor(this.topSolidY(wx, wz) - wy) * skyBrightness
    let torch = 0
    const R = LIGHTING.torch.distance
    for (const t of this.torches.values()) {
      const d2 = (t.x - wx) ** 2 + (t.y - wy) ** 2 + (t.z - wz) ** 2
      if (d2 < R * R) torch = Math.max(torch, 1 - Math.sqrt(d2) / R)
    }
    return Math.max(sky, torch)
  }

  // True once the chunk containing world column (x, z) has been generated.
  // Physics gates on this so bodies never move while their ground might not
  // be meshed yet (blockAt would still answer correctly, but landing on
  // invisible terrain reads as a bug). Center column only — a box straddling
  // a border still collides correctly via blockAt's generator fallback.
  chunkReadyAt(x, z) {
    const cx = Math.floor(x / WORLD.chunkSize)
    const cz = Math.floor(z / WORLD.chunkSize)
    return this.chunks.has(this.#key(cx, cz))
  }

  // --- Chunk streaming ------------------------------------------------------

  // Ensure chunks around the player exist (budgeted per frame, nearest
  // first) and unload chunks that fell out of range.
  update(playerPos) {
    const pcx = Math.floor(playerPos.x / WORLD.chunkSize)
    const pcz = Math.floor(playerPos.z / WORLD.chunkSize)
    const rd = WORLD.renderDistance

    // Rebuild the pending queue when the player enters a new chunk.
    if (pcx !== this.lastPcx || pcz !== this.lastPcz) {
      this.lastPcx = pcx
      this.lastPcz = pcz
      this.genQueue = []
      for (let dx = -rd; dx <= rd; dx++) {
        for (let dz = -rd; dz <= rd; dz++) {
          const cx = pcx + dx
          const cz = pcz + dz
          if (!this.chunks.has(this.#key(cx, cz))) this.genQueue.push([cx, cz])
        }
      }
      this.genQueue.sort(
        (a, b) =>
          Math.max(Math.abs(a[0] - pcx), Math.abs(a[1] - pcz)) -
          Math.max(Math.abs(b[0] - pcx), Math.abs(b[1] - pcz)),
      )

      for (const [key, chunk] of this.chunks) {
        const dist = Math.max(Math.abs(chunk.cx - pcx), Math.abs(chunk.cz - pcz))
        if (dist > rd + 1) {
          this.scene.remove(chunk.mesh)
          chunk.dispose()
          this.chunks.delete(key)
        }
      }
    }

    let budget = WORLD.chunkGenBudgetPerFrame
    while (budget > 0 && this.genQueue.length > 0) {
      const [cx, cz] = this.genQueue.shift()
      const key = this.#key(cx, cz)
      if (this.chunks.has(key)) continue
      const chunk = new Chunk(this, cx, cz)
      chunk.generate(this.edits.get(key))
      this.chunks.set(key, chunk)
      this.scene.add(chunk.buildMesh(this.material))
      budget--
    }
  }

  // --- Voxel raycast (Amanatides & Woo grid traversal) ----------------------

  // Walk the block grid along `dir` (normalized) from `origin` up to
  // `maxDist`. Returns { x, y, z, normal: [nx, ny, nz] } for the first solid
  // block hit (normal = the face entered, i.e. where a placed block goes),
  // or null. Pure data traversal — no mesh intersection tests.
  raycast(origin, dir, maxDist) {
    let x = Math.floor(origin.x)
    let y = Math.floor(origin.y)
    let z = Math.floor(origin.z)

    const stepX = dir.x >= 0 ? 1 : -1
    const stepY = dir.y >= 0 ? 1 : -1
    const stepZ = dir.z >= 0 ? 1 : -1

    const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity
    const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity
    const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity

    let tMaxX =
      dir.x !== 0 ? (x + (stepX > 0 ? 1 : 0) - origin.x) / dir.x : Infinity
    let tMaxY =
      dir.y !== 0 ? (y + (stepY > 0 ? 1 : 0) - origin.y) / dir.y : Infinity
    let tMaxZ =
      dir.z !== 0 ? (z + (stepZ > 0 ? 1 : 0) - origin.z) / dir.z : Infinity

    // The origin cell has no entry face, so traversal starts by stepping out
    // of it; the camera being inside a solid block simply yields no target.
    for (;;) {
      let normal
      if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
        if (tMaxX > maxDist) return null
        x += stepX
        tMaxX += tDeltaX
        normal = [-stepX, 0, 0]
      } else if (tMaxY <= tMaxZ) {
        if (tMaxY > maxDist) return null
        y += stepY
        tMaxY += tDeltaY
        normal = [0, -stepY, 0]
      } else {
        if (tMaxZ > maxDist) return null
        z += stepZ
        tMaxZ += tDeltaZ
        normal = [0, 0, -stepZ]
      }
      // Solid blocks plus targetable non-solids (torches) stop the ray, so
      // torches can be aimed at and broken like anything else.
      if (isTargetable(this.blockAt(x, y, z))) return { x, y, z, normal }
    }
  }

  // Informational perf counters (used by verification and debugging).
  stats() {
    let triangles = 0
    for (const chunk of this.chunks.values()) {
      const index = chunk.mesh?.geometry.index
      if (index) triangles += index.count / 3
    }
    return { chunks: this.chunks.size, triangles }
  }

  #buildLights() {
    // Kept as instance fields so the day/night cycle (src/sky/DayNight.js)
    // can animate direction, intensity, and color each frame.
    this.ambient = new THREE.AmbientLight(0xffffff, 0.6)
    this.sun = new THREE.DirectionalLight(0xffffff, 1.2)
    this.sun.position.set(30, 50, 20)
    this.scene.add(this.ambient, this.sun)
  }
}
