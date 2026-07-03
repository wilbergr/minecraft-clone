import * as THREE from 'three'
import { LIGHTING, WATER, WORLD } from '../config.js'
import { BLOCKS, BLOCK_AIR, BLOCK_WATER, isSolid } from './blocks.js'

// Sky-light factor [minSkyLight, 1] for an air cell `depth` blocks below its
// column's top solid block (<= 0 means open sky). The Phase 11 budget depth
// lighting: multiplied into vertex colors at mesh time — no light propagation.
export function skyFactor(depth) {
  const { falloffBlocks, minSkyLight } = LIGHTING.depth
  if (depth <= 0) return 1
  return Math.max(minSkyLight, 1 - depth / falloffBlocks)
}

// One face per entry: outward direction, the 4 quad corners (in block-local
// 0..1 coords, wound so triangles (0,1,2)+(2,1,3) face outward), and a baked
// brightness so adjacent faces of a cube stay distinguishable even where the
// scene lights hit them equally.
const FACES = [
  {
    dir: [-1, 0, 0],
    corners: [[0, 1, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1]],
    shade: 0.85,
  },
  {
    dir: [1, 0, 0],
    corners: [[1, 1, 1], [1, 0, 1], [1, 1, 0], [1, 0, 0]],
    shade: 0.85,
  },
  {
    dir: [0, -1, 0],
    corners: [[1, 0, 1], [0, 0, 1], [1, 0, 0], [0, 0, 0]],
    shade: 0.5,
  },
  {
    dir: [0, 1, 0],
    corners: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]],
    shade: 1.0,
  },
  {
    dir: [0, 0, -1],
    corners: [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]],
    shade: 0.75,
  },
  {
    dir: [0, 0, 1],
    corners: [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]],
    shade: 0.75,
  },
]

// A chunkSize x chunkHeight x chunkSize column of blocks with its own mesh.
// Meshing is face-culled: only faces adjacent to air are emitted, so interior
// blocks cost nothing and each chunk is a single draw call.
export class Chunk {
  constructor(world, cx, cz) {
    this.world = world
    this.cx = cx
    this.cz = cz
    this.size = WORLD.chunkSize
    this.height = WORLD.chunkHeight
    this.blocks = new Uint8Array(this.size * this.size * this.height)
    this.mesh = null
    this.waterMesh = null // translucent water pass, a child of `mesh` (Phase 10)
  }

  index(x, y, z) {
    return (x * this.size + z) * this.height + y
  }

  // Local-coordinate accessors. Out-of-range y is air; x/z must be in range.
  getBlock(x, y, z) {
    if (y < 0 || y >= this.height) return BLOCK_AIR
    return this.blocks[this.index(x, y, z)]
  }

  setBlock(x, y, z, id) {
    if (y < 0 || y >= this.height) return
    this.blocks[this.index(x, y, z)] = id
  }

  // Fill block data from the world's deterministic generator (terrain, sea
  // water, then trees), then apply any recorded edits (so player changes
  // survive chunk unload/reload).
  generate(edits) {
    const baseX = this.cx * this.size
    const baseZ = this.cz * this.size
    for (let x = 0; x < this.size; x++) {
      for (let z = 0; z < this.size; z++) {
        const h = this.world.terrainHeight(baseX + x, baseZ + z)
        for (let y = 0; y < h; y++) {
          this.blocks[this.index(x, y, z)] = this.world.terrainBlock(
            baseX + x, y, baseZ + z, h,
          )
        }
        // Sea water (Phase 10): air below the waterline fills with water.
        // Mirrors World.blockAt's unloaded-chunk answer, keeping generation a
        // pure function of (seed, x, y, z) so border meshing stays correct.
        for (let y = h; y <= WATER.level; y++) {
          this.blocks[this.index(x, y, z)] = BLOCK_WATER
        }
      }
    }
    this.#stampTrees(baseX, baseZ)
    if (edits) {
      for (const [idx, id] of edits) this.blocks[idx] = id
    }
  }

  // Stamp every tree whose trunk or canopy reaches into this chunk (canopy
  // radius is 1 block, so tree columns one block outside the border count).
  // Must mirror World's per-block tree query for unloaded chunks.
  #stampTrees(baseX, baseZ) {
    for (let tx = -1; tx <= this.size; tx++) {
      for (let tz = -1; tz <= this.size; tz++) {
        const tree = this.world.treeAt(baseX + tx, baseZ + tz)
        if (!tree) continue
        // Trunk and leaf cap, when the tree column lies inside this chunk.
        if (tx >= 0 && tx < this.size && tz >= 0 && tz < this.size) {
          for (let y = tree.base; y < tree.top; y++) {
            this.blocks[this.index(tx, y, tz)] = 5 // wood
          }
          this.blocks[this.index(tx, tree.top, tz)] = 6 // leaf cap
        }
        // 3x3 canopy around the top two trunk levels — only into air, so it
        // never eats terrain or another tree's trunk.
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dz === 0) continue
            const lx = tx + dx
            const lz = tz + dz
            if (lx < 0 || lx >= this.size || lz < 0 || lz >= this.size) continue
            for (let y = tree.top - 2; y < tree.top; y++) {
              const idx = this.index(lx, y, lz)
              if (this.blocks[idx] === BLOCK_AIR) this.blocks[idx] = 6
            }
          }
        }
      }
    }
  }

  // (Re)build the render mesh from current block data. Neighbor lookups that
  // cross the chunk border go through the world, which answers from the
  // adjacent chunk if loaded or from the deterministic generator if not —
  // border faces are correct without forcing neighbor chunks to exist.
  //
  // Depth lighting (Phase 11): every face color is multiplied by skyFactor()
  // of the air cell the face is exposed to — its depth below that column's
  // top solid block — so cave interiors go dark while open shafts dug from
  // the surface stay lit. Column tops are cached per build (the chunk's own
  // 16x16 plus the 1-block border ring, answered through the world).
  buildMesh(material) {
    const positions = []
    const normals = []
    const colors = []
    const indices = []
    const color = new THREE.Color()
    const baseX = this.cx * this.size
    const baseZ = this.cz * this.size
    const colTops = new Array((this.size + 2) * (this.size + 2))

    for (let x = 0; x < this.size; x++) {
      for (let z = 0; z < this.size; z++) {
        for (let y = 0; y < this.height; y++) {
          const id = this.blocks[this.index(x, y, z)]
          if (id === BLOCK_AIR || id === BLOCK_WATER) continue // water has its own pass
          const block = BLOCKS[id]
          if (block.shape === 'torch') {
            this.#emitTorch(positions, normals, colors, indices, x, y, z, block, color)
            continue
          }

          for (const face of FACES) {
            const [dx, dy, dz] = face.dir
            if (this.#neighborSolid(x + dx, y + dy, z + dz, baseX, baseZ)) {
              continue
            }
            const faceColor =
              dy === 1 ? block.color.top : dy === -1 ? block.color.bottom : block.color.side
            color.set(faceColor).multiplyScalar(face.shade)
            const top = this.#colTop(x + dx, z + dz, baseX, baseZ, colTops)
            color.multiplyScalar(skyFactor(top - (y + dy)))

            const ndx = positions.length / 3
            for (const [ox, oy, oz] of face.corners) {
              positions.push(x + ox, y + oy, z + oz)
              normals.push(dx, dy, dz)
              colors.push(color.r, color.g, color.b)
            }
            indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3)
          }
        }
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geometry.setIndex(indices)

    if (this.mesh) {
      this.mesh.geometry.dispose()
      this.mesh.geometry = geometry
    } else {
      this.mesh = new THREE.Mesh(geometry, material)
      this.mesh.position.set(baseX, 0, baseZ)
    }
    this.#buildWaterMesh(baseX, baseZ)
    return this.mesh
  }

  // y of the highest solid block in the column at local (x, z), cached per
  // mesh build. Columns inside the chunk scan live block data; the 1-block
  // border ring asks the world (loaded neighbor or pure generator).
  #colTop(x, z, baseX, baseZ, cache) {
    const k = (x + 1) * (this.size + 2) + (z + 1)
    let top = cache[k]
    if (top === undefined) {
      if (x >= 0 && x < this.size && z >= 0 && z < this.size) {
        top = -1
        for (let y = this.height - 1; y >= 0; y--) {
          if (isSolid(this.blocks[this.index(x, y, z)])) {
            top = y
            break
          }
        }
      } else {
        top = this.world.topSolidY(baseX + x, baseZ + z)
      }
      cache[k] = top
    }
    return top
  }

  // Torches render as a small post (all 6 faces of a slim box), not a full
  // cube: they don't fill their cell, so neighbor culling doesn't apply, and
  // being `emissive` they skip depth darkening — the torch is the light.
  #emitTorch(positions, normals, colors, indices, x, y, z, block, color) {
    const w = 0.09 // post half-width, blocks
    const h = 0.7 // post height, blocks
    for (const face of FACES) {
      const [dx, dy, dz] = face.dir
      const faceColor =
        dy === 1 ? block.color.top : dy === -1 ? block.color.bottom : block.color.side
      color.set(faceColor).multiplyScalar(face.shade)
      const ndx = positions.length / 3
      for (const [ox, oy, oz] of face.corners) {
        positions.push(
          x + 0.5 + (ox - 0.5) * w * 2,
          y + oy * h,
          z + 0.5 + (oz - 0.5) * w * 2,
        )
        normals.push(dx, dy, dz)
        colors.push(color.r, color.g, color.b)
      }
      indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3)
    }
  }

  // Second render pass (Phase 10): all water faces in one translucent
  // double-sided mesh, parented to the solid mesh so scene add/remove and
  // positioning stay a single-object affair. Water culls only against itself
  // and solids — faces meeting air are drawn (that's the sea surface and any
  // exposed sides), and open-air tops sit WATER.surfaceDrop below the block
  // top so the surface reads as a waterline rather than a full cube.
  #buildWaterMesh(baseX, baseZ) {
    const positions = []
    const normals = []
    const colors = []
    const indices = []
    const color = new THREE.Color()
    const water = BLOCKS[BLOCK_WATER]

    for (let x = 0; x < this.size; x++) {
      for (let z = 0; z < this.size; z++) {
        for (let y = 0; y < this.height; y++) {
          if (this.blocks[this.index(x, y, z)] !== BLOCK_WATER) continue
          const open = // air (not water) directly above: this is a surface block
            this.#neighborId(x, y + 1, z, baseX, baseZ) === BLOCK_AIR
          for (const face of FACES) {
            const [dx, dy, dz] = face.dir
            if (dy === -1) continue // seabed hides water undersides
            const neighbor = this.#neighborId(x + dx, y + dy, z + dz, baseX, baseZ)
            if (neighbor === BLOCK_WATER || isSolid(neighbor)) continue

            const faceColor = dy === 1 ? water.color.top : water.color.side
            color.set(faceColor).multiplyScalar(face.shade)
            const ndx = positions.length / 3
            for (const [ox, oy, oz] of face.corners) {
              const top = oy === 1 && open ? 1 - WATER.surfaceDrop : oy
              positions.push(x + ox, y + top, z + oz)
              normals.push(dx, dy, dz)
              colors.push(color.r, color.g, color.b)
            }
            indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3)
          }
        }
      }
    }

    if (positions.length === 0 && !this.waterMesh) return
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geometry.setIndex(indices)

    if (this.waterMesh) {
      this.waterMesh.geometry.dispose()
      this.waterMesh.geometry = geometry
    } else {
      this.waterMesh = new THREE.Mesh(geometry, this.world.waterMaterial)
      this.mesh.add(this.waterMesh) // local coords match the parent's
    }
  }

  // Neighbor block id for the water pass (the solid pass only needs
  // solidity). Below the world reads as stone so sea bottoms stay closed.
  #neighborId(x, y, z, baseX, baseZ) {
    if (y < 0) return 3
    if (y >= this.height) return BLOCK_AIR
    if (x >= 0 && x < this.size && z >= 0 && z < this.size) {
      return this.blocks[this.index(x, y, z)]
    }
    return this.world.blockAt(baseX + x, y, baseZ + z)
  }

  #neighborSolid(x, y, z, baseX, baseZ) {
    if (y < 0) return true // never draw the underside of the world
    if (y >= this.height) return false
    if (x >= 0 && x < this.size && z >= 0 && z < this.size) {
      return isSolid(this.blocks[this.index(x, y, z)])
    }
    return isSolid(this.world.blockAt(baseX + x, y, baseZ + z))
  }

  dispose() {
    if (this.mesh) {
      this.waterMesh?.geometry.dispose()
      this.waterMesh = null
      this.mesh.geometry.dispose()
      this.mesh = null
    }
  }
}
