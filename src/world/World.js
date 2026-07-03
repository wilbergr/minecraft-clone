import * as THREE from 'three'
import { WATER, WORLD } from '../config.js'
import { BLOCK_AIR, BLOCK_WATER, isSolid } from './blocks.js'
import { createFBM2D, hash2D, hash3D } from './noise.js'
import { Chunk } from './Chunk.js'

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
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true })
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
    this.genQueue = [] // [cx, cz] pairs pending generation, nearest first
    this.onEdit = null // callback() — set by SaveManager to mark the save dirty
    this.#buildLights()
  }

  #key(cx, cz) {
    return `${cx},${cz}`
  }

  // --- Terrain generator (pure functions of world position) ---------------

  // Surface height (number of solid blocks) of the column at (wx, wz).
  terrainHeight(wx, wz) {
    const { baseHeight, amplitude, frequency } = WORLD.terrain
    const n = this.fbm(wx * frequency, wz * frequency)
    const h = Math.round(baseHeight + n * amplitude)
    return Math.max(2, Math.min(h, WORLD.chunkHeight - 8))
  }

  // Block id at height y of an untouched column with surface height h:
  // grass (or sand near "sea level") on top, dirt below, stone deeper.
  blockForDepth(y, h) {
    if (y >= h) return BLOCK_AIR
    const { dirtDepth, sandLevel } = WORLD.terrain
    const beach = h - 1 <= sandLevel
    if (y === h - 1) return beach ? 4 : 1 // sand : grass
    if (y >= h - 1 - dirtDepth) return beach ? 4 : 2 // sand : dirt
    return 3 // stone
  }

  // Below-surface block including scattered features: the base layering,
  // with deep stone occasionally replaced by iron ore.
  terrainBlock(wx, wy, wz, h) {
    const id = this.blockForDepth(wy, h)
    if (id !== 3) return id
    const { ironOre } = WORLD.terrain
    if (wy <= ironOre.maxY && hash3D(WORLD.seed ^ 0x1e55, wx, wy, wz) < ironOre.chance) {
      return 8 // iron ore
    }
    return id
  }

  // Does a tree stand on the column at (wx, wz)? Trees are a pure function of
  // position (cheap hash first, terrain checks only on a hit): trunk fills
  // y in [base, top), a leaf cap sits at y == top, and a 3x3 canopy wraps the
  // top two trunk levels. Grass columns only — beaches stay bare.
  treeAt(wx, wz) {
    const { trees, sandLevel } = WORLD.terrain
    if (hash2D(WORLD.seed ^ 0x51ab, wx, wz) >= trees.chance) return null
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
    this.onEdit?.()
    return true
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
      if (isSolid(this.blockAt(x, y, z))) return { x, y, z, normal }
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
