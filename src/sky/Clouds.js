import * as THREE from 'three'
import { DAYNIGHT } from '../config.js'

// Drifting clouds (Phase 10): flat white quads at DAYNIGHT.clouds.height,
// merged into ONE BufferGeometry (a 3x3 repeat of a random tile pattern, so
// the sky is covered well past the fog) — a single draw call, like the
// particle pool. The mesh snaps to the pattern's tile grid around the camera
// (world-stable clouds that always surround the player) and the whole layer
// slides eastward for drift.
export class Clouds {
  constructor(scene) {
    const { count, height, tile, opacity } = DAYNIGHT.clouds
    const positions = []
    const indices = []

    // One tile of random cloud quads, stamped 3x3.
    const quads = []
    for (let i = 0; i < count; i++) {
      quads.push({
        x: Math.random() * tile,
        z: Math.random() * tile,
        w: 12 + Math.random() * 18,
        d: 8 + Math.random() * 14,
      })
    }
    for (let tx = -1; tx <= 1; tx++) {
      for (let tz = -1; tz <= 1; tz++) {
        for (const q of quads) {
          const x = q.x + tx * tile
          const z = q.z + tz * tile
          const ndx = positions.length / 3
          positions.push(
            x, 0, z,
            x + q.w, 0, z,
            x, 0, z + q.d,
            x + q.w, 0, z + q.d,
          )
          indices.push(ndx, ndx + 2, ndx + 1, ndx + 1, ndx + 2, ndx + 3)
        }
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setIndex(indices)

    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity,
        fog: false, // clouds sit past fogFar — fog would erase them
        depthWrite: false,
        side: THREE.DoubleSide, // visible from above too (mountain tops)
      }),
    )
    this.mesh.position.y = height
    this.mesh.frustumCulled = false // spans the whole sky anyway
    this.drift = 0
    scene.add(this.mesh)
  }

  update(delta, cameraPos) {
    const { tile, speed } = DAYNIGHT.clouds
    this.drift = (this.drift + speed * delta) % tile
    // Snap to the tile grid so the repeating pattern stays world-anchored
    // while following the player; drift slides the whole layer east.
    this.mesh.position.x =
      Math.round((cameraPos.x - this.drift) / tile) * tile + this.drift - tile / 2
    this.mesh.position.z = Math.round(cameraPos.z / tile) * tile - tile / 2
  }
}
