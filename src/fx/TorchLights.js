import * as THREE from 'three'
import { LIGHTING } from '../config.js'

// Torch lighting (Phase 11), the budget version: a fixed pool of THREE point
// lights is reassigned every frame to the torches nearest the camera. The
// pool never grows or shrinks and unused lights just drop to intensity 0 —
// a constant light count keeps the shader program stable (toggling a light's
// presence would force every material to recompile mid-play).
export class TorchLights {
  constructor(scene, world) {
    this.world = world
    const { poolSize, color, distance, decay } = LIGHTING.torch
    this.pool = []
    for (let i = 0; i < poolSize; i++) {
      const light = new THREE.PointLight(color, 0, distance, decay)
      scene.add(light)
      this.pool.push(light)
    }
  }

  // Number of pool lights currently lighting a torch (test/debug seam).
  get activeCount() {
    return this.pool.filter((l) => l.intensity > 0).length
  }

  update(cameraPos) {
    const { intensity, maxTrackDistance } = LIGHTING.torch
    const maxD2 = maxTrackDistance * maxTrackDistance
    const near = []
    for (const t of this.world.torches.values()) {
      const dx = t.x + 0.5 - cameraPos.x
      const dy = t.y + 0.5 - cameraPos.y
      const dz = t.z + 0.5 - cameraPos.z
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 <= maxD2) near.push({ t, d2 })
    }
    near.sort((a, b) => a.d2 - b.d2)
    this.pool.forEach((light, i) => {
      const entry = near[i]
      if (entry) {
        // Sit the light at the flame (just above the post top) so walls and
        // floor both catch it.
        light.position.set(entry.t.x + 0.5, entry.t.y + 0.75, entry.t.z + 0.5)
        light.intensity = intensity
      } else {
        light.intensity = 0
      }
    })
  }
}
