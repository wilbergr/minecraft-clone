import { GUIDANCE } from '../config.js'

// Wisp trail (guidance layer): faint glowing motes drifting a few blocks
// ahead of the player along the bearing to the current objective — the
// in-world compass. Reads the IDENTICAL target expression the compass HUD
// uses (hunt.activeToken ?? challenge.compassTarget) so the two can never
// disagree, and rides the existing pooled particle system: zero new draw
// calls, zero new materials. Colors are stage-keyed (config palette matches
// the beams/flares, so the color language teaches itself); wisps vanish near
// the target where beams/ghost/flares take over.
//
// Also owns the gold-core shimmer: while the core waits to be right-clicked
// (siege disarmed at stage 2, King summonable at stage 3), the two core
// cells pulse ember sparks — "the interactive thing glows".
export class WispTrail {
  constructor({ hunt, challenge, particles, player, camera }) {
    this.hunt = hunt
    this.challenge = challenge
    this.particles = particles
    this.player = player
    this.camera = camera
    this.cfg = GUIDANCE.wisps
    this.timer = 0
    this.shimmerTimer = 0
    this.stats = { bursts: 0, shimmers: 0 } // headless observability
  }

  #stageColor() {
    const c = this.cfg.colors
    if (this.hunt.activeToken) return c.treasure
    const stage = this.challenge.stage
    if (stage === 0) return c.relics
    if (stage === 1) return c.beacon
    if (stage === 2) return c.siege
    return c.boss
  }

  update(delta) {
    if (!this.player.isLocked) return
    this.#trail(delta)
    this.#coreShimmer(delta)
  }

  #trail(delta) {
    this.timer -= delta
    if (this.timer > 0) return
    this.timer = this.cfg.intervalSeconds
    const target = this.hunt.activeToken ?? this.challenge.compassTarget
    if (!target) return
    const p = this.camera.position
    const dx = target.position.x - p.x
    const dz = target.position.z - p.z
    const dist = Math.hypot(dx, dz)
    if (dist < this.cfg.suppressRadius) return // beams/ghost own close range
    const nx = dx / dist
    const nz = dz / dist
    const color = this.#stageColor()
    const { distances, jitter, dropBelowEye } = this.cfg
    for (const d of distances) {
      this.particles.burst(
        p.x + nx * d + (Math.random() - 0.5) * jitter,
        p.y - dropBelowEye + (Math.random() - 0.5) * jitter * 0.5,
        p.z + nz * d + (Math.random() - 0.5) * jitter,
        color,
        1,
      )
      this.stats.bursts++
    }
  }

  #coreShimmer(delta) {
    const c = this.challenge
    const waiting =
      c.activated &&
      ((c.stage === 2 && !c.siege.armed && !c.siege.active) ||
        (c.stage === 3 && c.bossFight.state === 'idle'))
    if (!waiting) return
    this.shimmerTimer -= delta
    if (this.shimmerTimer > 0) return
    this.shimmerTimer = this.cfg.coreShimmer.intervalSeconds
    const s = c.structure
    for (let dy = 1; dy <= s.cfg.shape.coreHeight; dy++) {
      this.particles.burst(
        s.anchorX + 0.5,
        s.baseY + dy + 0.5,
        s.anchorZ + 0.5,
        this.cfg.coreShimmer.color,
        this.cfg.coreShimmer.count,
      )
    }
    this.stats.shimmers++
  }
}
