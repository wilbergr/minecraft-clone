import * as THREE from 'three'
import { FEEDBACK } from '../config.js'

// Pooled particle bursts (Phase 9). A single THREE.Points holds every live
// particle — one geometry, one material, one draw call regardless of how many
// bursts are in flight. burst() overwrites the oldest slots ring-buffer
// style; dead particles park far below the world. Built for block-break
// debris but generic: any (position, color, count) works, so later effects
// (splashes, sparks) can reuse it.
export class Particles {
  #color = new THREE.Color()

  constructor(scene) {
    const n = FEEDBACK.particles.poolSize
    this.positions = new Float32Array(n * 3)
    this.colors = new Float32Array(n * 3)
    this.velocities = new Float32Array(n * 3)
    this.life = new Float32Array(n) // seconds remaining; <= 0 = dead
    this.cursor = 0 // next pool slot to hand out
    this.liveCount = 0
    for (let i = 0; i < n; i++) this.positions[i * 3 + 1] = -1000 // parked

    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3))
    this.points = new THREE.Points(
      this.geometry,
      new THREE.PointsMaterial({ size: FEEDBACK.particles.size, vertexColors: true }),
    )
    // Live particles scatter anywhere; skip per-frame bounds maintenance.
    this.points.frustumCulled = false
    scene.add(this.points)
  }

  // Debris burst for breaking block (x, y, z) — tinted from its side color.
  burstBlock(x, y, z, block) {
    const color = block.color?.side ?? 0x888888
    this.burst(x + 0.5, y + 0.5, z + 0.5, color, FEEDBACK.particles.perBreak)
  }

  burst(x, y, z, colorHex, count) {
    const { poolSize, speed, lifetimeSeconds } = FEEDBACK.particles
    for (let k = 0; k < count; k++) {
      const i = this.cursor
      this.cursor = (this.cursor + 1) % poolSize
      if (this.life[i] <= 0) this.liveCount++
      this.life[i] = lifetimeSeconds * (0.6 + Math.random() * 0.4)
      this.positions[i * 3] = x + (Math.random() - 0.5) * 0.5
      this.positions[i * 3 + 1] = y + (Math.random() - 0.5) * 0.5
      this.positions[i * 3 + 2] = z + (Math.random() - 0.5) * 0.5
      // Scatter with an upward bias so debris pops out of the block.
      this.velocities[i * 3] = (Math.random() - 0.5) * speed
      this.velocities[i * 3 + 1] = Math.random() * speed * 0.8
      this.velocities[i * 3 + 2] = (Math.random() - 0.5) * speed
      // Shade variation so the burst reads as chunks, not a flat cloud.
      this.#color.setHex(colorHex).multiplyScalar(0.7 + Math.random() * 0.5)
      this.colors[i * 3] = this.#color.r
      this.colors[i * 3 + 1] = this.#color.g
      this.colors[i * 3 + 2] = this.#color.b
    }
    this.geometry.attributes.color.needsUpdate = true
    this.geometry.attributes.position.needsUpdate = true
  }

  update(delta) {
    if (this.liveCount === 0) return
    const { poolSize, gravity } = FEEDBACK.particles
    for (let i = 0; i < poolSize; i++) {
      if (this.life[i] <= 0) continue
      this.life[i] -= delta
      if (this.life[i] <= 0) {
        this.positions[i * 3 + 1] = -1000
        this.liveCount--
        continue
      }
      this.velocities[i * 3 + 1] -= gravity * delta
      this.positions[i * 3] += this.velocities[i * 3] * delta
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * delta
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * delta
    }
    this.geometry.attributes.position.needsUpdate = true
  }
}
