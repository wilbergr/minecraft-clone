import * as THREE from 'three'
import { WORLD } from '../config.js'

// Phase 1: a flat test world — a grid of placeholder ground blocks plus a few
// landmark blocks for depth reference. Later phases replace this with chunked
// terrain (see Chunk.js).
export class World {
  constructor(scene) {
    this.scene = scene
    this.groundY = 0 // top surface of the ground blocks
    this.#buildGround()
    this.#buildLandmarks()
    this.#buildLights()
  }

  // Half-extent of the walkable area, in world units.
  get halfExtent() {
    return (WORLD.size * WORLD.blockSize) / 2 + WORLD.boundsPadding
  }

  #buildGround() {
    const { size, blockSize } = WORLD
    const geometry = new THREE.BoxGeometry(blockSize, blockSize, blockSize)
    const material = new THREE.MeshLambertMaterial()
    const mesh = new THREE.InstancedMesh(geometry, material, size * size)

    const matrix = new THREE.Matrix4()
    const color = new THREE.Color()
    const grassA = new THREE.Color(0x5d9c3f)
    const grassB = new THREE.Color(0x4f8a34)
    const half = (size * blockSize) / 2

    let i = 0
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        matrix.setPosition(
          x * blockSize - half + blockSize / 2,
          this.groundY - blockSize / 2,
          z * blockSize - half + blockSize / 2,
        )
        mesh.setMatrixAt(i, matrix)
        // Checkerboard tint so motion is visible on a flat plane.
        mesh.setColorAt(i, color.copy((x + z) % 2 === 0 ? grassA : grassB))
        i++
      }
    }

    this.scene.add(mesh)
  }

  #buildLandmarks() {
    // A few scattered "stone" blocks so the player has parallax references.
    const geometry = new THREE.BoxGeometry(
      WORLD.blockSize,
      WORLD.blockSize,
      WORLD.blockSize,
    )
    const material = new THREE.MeshLambertMaterial({ color: 0x8a8a8a })
    const positions = [
      [4, 0, -6],
      [-7, 0, 3],
      [10, 0, 8],
      [-12, 0, -10],
      [0, 0, 14],
      [0, 1, 14], // one two-block stack
    ]
    for (const [x, y, z] of positions) {
      const block = new THREE.Mesh(geometry, material)
      block.position.set(
        x + WORLD.blockSize / 2,
        this.groundY + y + WORLD.blockSize / 2,
        z + WORLD.blockSize / 2,
      )
      this.scene.add(block)
    }
  }

  #buildLights() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.6)
    const sun = new THREE.DirectionalLight(0xffffff, 1.2)
    sun.position.set(30, 50, 20)
    this.scene.add(ambient, sun)
  }
}
