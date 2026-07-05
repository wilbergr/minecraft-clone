import * as THREE from 'three'
import { LIGHTING } from '../config.js'

// Lava glow lighting (lava feature) — TorchLights' sibling: a FIXED pool of
// LIGHTING.lava.poolSize point lights reassigned each frame to the exposed
// lava surface cells nearest the camera (each chunk records its cells in
// chunk.lavaSurfaces while building its lava mesh). The pool never grows or
// shrinks — a constant light count keeps the shader program stable (the
// TorchLights rule; toggling a light's presence recompiles every material).
//
// One addition torches don't need: a min-separation rule while picking, so
// one lake's adjacent cells can't eat the whole pool — the lights spread
// across distinct pools instead. update() also tracks the single nearest
// surface cell (this.nearest) for the ambience pops in main.js.
export class LavaLights {
  constructor(scene, world) {
    this.world = world
    const { poolSize, color, distance, decay } = LIGHTING.lava
    this.pool = []
    for (let i = 0; i < poolSize; i++) {
      const light = new THREE.PointLight(color, 0, distance, decay)
      scene.add(light)
      this.pool.push(light)
    }
    this.nearest = null // { cell, d2 } — nearest exposed surface to the camera
  }

  // Number of pool lights currently lighting a surface (test/debug seam).
  get activeCount() {
    return this.pool.filter((l) => l.intensity > 0).length
  }

  update(cameraPos) {
    const { intensity, maxTrackDistance, minSeparation } = LIGHTING.lava
    const maxD2 = maxTrackDistance * maxTrackDistance
    const near = []
    for (const chunk of this.world.chunks.values()) {
      const cells = chunk.lavaSurfaces
      if (!cells || cells.length === 0) continue
      for (const c of cells) {
        const dx = c.x + 0.5 - cameraPos.x
        const dy = c.y + 1 - cameraPos.y
        const dz = c.z + 0.5 - cameraPos.z
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 <= maxD2) near.push({ c, d2 })
      }
    }
    near.sort((a, b) => a.d2 - b.d2)
    this.nearest = near[0] ? { cell: near[0].c, d2: near[0].d2 } : null

    // Greedy nearest-first pick with min-separation between picks.
    const sep2 = minSeparation * minSeparation
    const picked = []
    for (const e of near) {
      if (picked.length >= this.pool.length) break
      const tooClose = picked.some(
        (p) =>
          (p.c.x - e.c.x) ** 2 + (p.c.y - e.c.y) ** 2 + (p.c.z - e.c.z) ** 2 < sep2,
      )
      if (!tooClose) picked.push(e)
    }
    this.pool.forEach((light, i) => {
      const entry = picked[i]
      if (entry) {
        // Sit the light just above the surface so walls and shore catch it.
        light.position.set(entry.c.x + 0.5, entry.c.y + 1.1, entry.c.z + 0.5)
        light.intensity = intensity
      } else {
        light.intensity = 0
      }
    })
  }
}
