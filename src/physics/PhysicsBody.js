import * as THREE from 'three'
import { LAVA, PHYSICS, WATER } from '../config.js'
import { BLOCK_LAVA, isLiquid, isSolid } from '../world/blocks.js'

// Axis-aligned bounding-box voxel physics (Phase 8), shared by the player and
// mobs. A body is a width×height×width box whose `position` is the center of
// its feet. Each step() integrates gravity into `velocity`, then sweeps the
// box axis by axis (X, then Z, then Y) against solid blocks via
// world.blockAt() — which answers for unloaded chunks too, so collision never
// depends on what happens to be meshed. A blocked downward move sets
// `grounded`; a blocked horizontal move sets `hitWall` (mobs use it to hop).
//
// Sub-stepping: moves are split so no axis travels more than half a block per
// sweep — the frame delta is clamped at 0.1s and headless/slow clients really
// hit it, so a single terminal-velocity step could otherwise tunnel through
// several blocks.
//
// Owners may hand in the Vector3 the body should drive (a mob passes its
// group.position) or let the body allocate its own.

const EPS = 1e-3 // gap kept between the box and block faces after a clamp
const MAX_SWEEP = 0.4 // max blocks moved per axis per sub-step (< 1 block)

export class PhysicsBody {
  constructor(world, size, position = new THREE.Vector3()) {
    this.world = world
    this.half = size.width / 2
    this.height = size.height
    this.position = position // feet center (owned by the caller if passed in)
    this.velocity = new THREE.Vector3() // world-space, blocks/second
    this.grounded = false
    this.hitWall = false // a horizontal sweep was blocked this step
    this.inWater = false // midsection in ANY liquid (Phase 10) — owners read this
    this.inLava = false // midsection specifically in lava (lava feature)
    this.fallDistance = 0 // blocks descended since last grounded
    this.onLand = null // callback(blocksFallen) — fires on touching down
    // Gravity multiplier (the shared flying-mob/elytra seam): 1 = normal,
    // ~0.1 = a glide's gentle sink, 0 = a floating body that steers all
    // three axes itself (collision sweeps still apply). Owners set it per
    // frame or once; nothing else in the body reads speed intent.
    this.gravityScale = 1
  }

  // Advance the body by `delta` seconds. `sneak` slows nothing here (speed is
  // the owner's concern) but enables edge-stop: grounded horizontal moves
  // that would leave the box with no support underneath are cancelled.
  step(delta, { sneak = false } = {}) {
    const pos = this.position

    // Chunk streaming can briefly leave the ground under a just-loaded or
    // just-respawned body ungenerated. blockAt() would still answer
    // correctly, but freezing until the chunk exists (gen queue is nearest
    // first, so ~a frame) means nothing ever moves through unrendered world.
    if (!this.world.chunkReadyAt(pos.x, pos.z)) return

    // Embedded in solid blocks (e.g. a block placed into a mob): rise gently
    // until free instead of wedging the sweeps forever.
    if (this.#collides()) {
      this.velocity.set(0, 0, 0)
      this.fallDistance = 0
      pos.y += PHYSICS.ejectSpeed * delta
      return
    }

    // Submerged (Phase 10): the block at the body's midsection decides.
    // `inWater` means "in any liquid" — every consumer wants that reading
    // for lava too (fall distance cleared, no jump crits, slow mining, no
    // footsteps, swim controls); `inLava` narrows it so damage and the
    // viscous LAVA.physics table key off the liquid's identity. Liquids swap
    // in gentle gravity, a low sink cap, and vertical drag — and clear fall
    // distance, so liquid landings never hurt (in lava the burn is the
    // punishment, not the impact). Swim-up is the owner's input concern
    // (PlayerControls sets velocity.y while Space is held).
    const mid = this.world.blockAt(
      Math.floor(pos.x),
      Math.floor(pos.y + this.height * 0.5),
      Math.floor(pos.z),
    )
    this.inWater = isLiquid(mid)
    this.inLava = mid === BLOCK_LAVA

    // Vertical displacement uses the frame's AVERAGE velocity (exact for
    // constant acceleration) — naive Euler would make jump height shrink
    // with frame time, losing a third of the apex at the clamped 0.1s delta.
    const vy0 = this.velocity.y
    if (this.inWater) {
      const w = this.inLava ? LAVA.physics : WATER.physics
      this.fallDistance = 0
      this.velocity.y = Math.max(vy0 - w.gravity * delta, -w.sinkSpeed)
      this.velocity.y *= Math.exp(-w.drag * delta) // dive momentum bleeds off
    } else {
      this.velocity.y = Math.max(
        vy0 - PHYSICS.gravity * this.gravityScale * delta,
        -PHYSICS.terminalVelocity,
      )
    }
    let vyMove = (vy0 + this.velocity.y) / 2
    this.hitWall = false

    const v = this.velocity
    const maxAxis = Math.max(Math.abs(v.x), Math.abs(vyMove), Math.abs(v.z)) * delta
    const steps = Math.max(1, Math.ceil(maxAxis / MAX_SWEEP))
    const dt = delta / steps
    for (let i = 0; i < steps; i++) {
      // Velocity is re-read each sub-step: a clamp zeroes the axis, so later
      // sub-steps stop pushing into the wall (or floor).
      this.#sweepHorizontal('x', v.x * dt, sneak)
      this.#sweepHorizontal('z', v.z * dt, sneak)
      if (this.#sweepVertical(vyMove * dt)) vyMove = 0
    }
  }

  // Does the box at the current position overlap any solid block?
  #collides() {
    const pos = this.position
    const x0 = Math.floor(pos.x - this.half)
    const x1 = Math.floor(pos.x + this.half)
    const y0 = Math.floor(pos.y)
    const y1 = Math.floor(pos.y + this.height)
    const z0 = Math.floor(pos.z - this.half)
    const z1 = Math.floor(pos.z + this.half)
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          if (isSolid(this.world.blockAt(x, y, z))) return true
        }
      }
    }
    return false
  }

  #sweepHorizontal(axis, amount, sneak) {
    if (amount === 0) return
    const pos = this.position

    // Sneak edge-stop: refuse grounded moves that would leave nothing under
    // the box. Cancelled per axis, so sneaking still slides along the edge.
    if (sneak && this.grounded && !this.#hasSupport(axis, amount)) {
      this.velocity[axis] = 0
      return
    }

    pos[axis] += amount
    if (!this.#collides()) return

    // Blocked. Grounded bodies first try climbing the obstructing layer —
    // its top is at most one block up, so PHYSICS.stepHeight decides.
    if (this.grounded && !sneak) {
      const top = Math.floor(pos.y) + 1 // top of the layer the feet are in
      if (top - pos.y <= PHYSICS.stepHeight + EPS) {
        const savedY = pos.y
        pos.y = top + EPS
        if (!this.#collides()) return // stepped up; the move stands
        pos.y = savedY
      }
    }

    // Clamp flush against the face entered (sub-stepping guarantees the
    // penetration is under a block, so the boundary is a single floor()).
    if (amount > 0) pos[axis] = Math.floor(pos[axis] + this.half) - this.half - EPS
    else pos[axis] = Math.floor(pos[axis] - this.half) + 1 + this.half + EPS
    this.velocity[axis] = 0
    this.hitWall = true
  }

  // Returns true when the move was clamped by a block.
  #sweepVertical(amount) {
    const pos = this.position
    if (amount > 0) {
      this.grounded = false
      pos.y += amount
      if (this.#collides()) {
        pos.y = Math.floor(pos.y + this.height) - this.height - EPS
        this.velocity.y = 0
        return true
      }
    } else if (amount < 0) {
      pos.y += amount
      this.fallDistance -= amount
      if (this.#collides()) {
        const top = Math.floor(pos.y) + 1
        this.fallDistance -= top + EPS - pos.y // don't count the backed-out overshoot
        pos.y = top + EPS
        this.velocity.y = 0
        this.grounded = true
        const fell = this.fallDistance
        this.fallDistance = 0
        if (fell > 0.01) this.onLand?.(fell)
        return true
      }
      this.grounded = false
    }
    return false
  }

  // Would the box, moved by `amount` along `axis`, still have a solid block
  // directly under its feet? (Sneak edge-stop test.)
  #hasSupport(axis, amount) {
    const pos = this.position
    const saved = pos[axis]
    pos[axis] += amount
    const y = Math.floor(pos.y - 0.05) // feet rest EPS above the surface
    const x0 = Math.floor(pos.x - this.half)
    const x1 = Math.floor(pos.x + this.half)
    const z0 = Math.floor(pos.z - this.half)
    const z1 = Math.floor(pos.z + this.half)
    pos[axis] = saved
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        if (isSolid(this.world.blockAt(x, y, z))) return true
      }
    }
    return false
  }
}
