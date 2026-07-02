import * as THREE from 'three'
import { WORLD } from '../config.js'
import { BLOCKS, BLOCK_AIR, isSolid } from './blocks.js'

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

  // Fill block data from the world's deterministic generator, then apply any
  // recorded edits (so player changes survive chunk unload/reload).
  generate(edits) {
    const baseX = this.cx * this.size
    const baseZ = this.cz * this.size
    for (let x = 0; x < this.size; x++) {
      for (let z = 0; z < this.size; z++) {
        const h = this.world.terrainHeight(baseX + x, baseZ + z)
        for (let y = 0; y < h; y++) {
          this.blocks[this.index(x, y, z)] = this.world.blockForDepth(y, h)
        }
      }
    }
    if (edits) {
      for (const [idx, id] of edits) this.blocks[idx] = id
    }
  }

  // (Re)build the render mesh from current block data. Neighbor lookups that
  // cross the chunk border go through the world, which answers from the
  // adjacent chunk if loaded or from the deterministic generator if not —
  // border faces are correct without forcing neighbor chunks to exist.
  buildMesh(material) {
    const positions = []
    const normals = []
    const colors = []
    const indices = []
    const color = new THREE.Color()
    const baseX = this.cx * this.size
    const baseZ = this.cz * this.size

    for (let x = 0; x < this.size; x++) {
      for (let z = 0; z < this.size; z++) {
        for (let y = 0; y < this.height; y++) {
          const id = this.blocks[this.index(x, y, z)]
          if (id === BLOCK_AIR) continue
          const block = BLOCKS[id]

          for (const face of FACES) {
            const [dx, dy, dz] = face.dir
            if (this.#neighborSolid(x + dx, y + dy, z + dz, baseX, baseZ)) {
              continue
            }
            const faceColor =
              dy === 1 ? block.color.top : dy === -1 ? block.color.bottom : block.color.side
            color.set(faceColor).multiplyScalar(face.shade)

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
    return this.mesh
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
      this.mesh.geometry.dispose()
      this.mesh = null
    }
  }
}
