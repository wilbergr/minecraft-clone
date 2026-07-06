import * as THREE from 'three'
import { COMBAT, PLAYER } from '../config.js'
import { Mob } from './Mob.js'

// Magma cube (N5, the Nether): a single glowing box that moves ONLY in hops —
// grounded it sits still, then on a timer it launches (velocity.y = cfg.
// hopVelocity) toward the player when one is in aggro range, or in a lazy
// random direction otherwise, steering with cfg.hopSpeed while airborne. The
// hop drive reuses Mob.locomote with hop=false: the timer IS the jump, so the
// hitWall auto-hop must never stack a second launch on top. Contact melee on
// the zombie cooldown pattern; `lavaProof` skips MobManager's lava burn tick
// (it lives in the seas — bait it out or fight it on the shore). Drops
// nothing (the creeper precedent — no magma-cream sink exists yet).

const GEOM = {
  body: new THREE.BoxGeometry(0.9, 0.75, 0.9),
  eye: new THREE.BoxGeometry(0.16, 0.1, 0.06),
}

const COLORS = { rock: 0x53231a, glow: 0xff8a1e }
const AABB = { width: 0.9, height: 0.75 }

export class MagmaCube extends Mob {
  #toPlayer = new THREE.Vector3()

  constructor(world, x, z) {
    super(world, COMBAT.mobs.magmaCube.health)
    this.cfg = COMBAT.mobs.magmaCube
    this.lavaProof = true // the manager's lava tick skips it
    this.hopDir = null // unit XZ launch direction, held through the airtime
    this.hopTimer = this.cfg.idleHopIntervalSeconds * Math.random()
    this.attackTimer = 0
    this.makeMaterials(COLORS)
    this.attachBody(this.#buildBody(), x, z, AABB)
  }

  // One lava-rock cube with two ember eyes so the facing reads.
  #buildBody() {
    const m = this.materials
    const group = new THREE.Group()
    group.add(
      this.part(GEOM.body, m.rock, 0, 0.375, 0),
      this.part(GEOM.eye, m.glow, -0.2, 0.5, 0.46),
      this.part(GEOM.eye, m.glow, 0.2, 0.5, 0.46),
    )
    return group
  }

  update(delta, playerPos, damagePlayer) {
    const pos = this.group.position
    this.#toPlayer.set(playerPos.x - pos.x, 0, playerPos.z - pos.z)
    const dist = this.#toPlayer.length()

    // Contact melee (the zombie pattern): reach + rough height match.
    this.attackTimer -= delta
    const nearPlayerY = Math.abs(pos.y - (playerPos.y - PLAYER.eyeHeight)) < 2.5
    if (dist <= this.cfg.attackRange && nearPlayerY && this.attackTimer <= 0) {
      this.attackTimer = this.cfg.attackCooldownSeconds
      damagePlayer(this.cfg.attackDamage, this)
    }

    // Hop scheduling: only a grounded cube can launch; between hops it sits.
    if (this.body.grounded) {
      this.hopDir = null
      this.hopTimer -= delta
      if (this.hopTimer <= 0) {
        const chasing = dist <= this.cfg.aggroRange
        this.hopTimer =
          (chasing ? this.cfg.hopIntervalSeconds : this.cfg.idleHopIntervalSeconds) *
          (0.75 + Math.random() * 0.5)
        if (chasing) {
          this.hopDir = this.#toPlayer.normalize().clone()
        } else {
          const angle = Math.random() * Math.PI * 2
          this.hopDir = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle))
        }
        this.body.velocity.y = this.cfg.hopVelocity
      }
    }

    // hop=false: the timer is the only jump — a wall mid-flight is a bounce
    // off, not a step to climb.
    this.locomote(delta, this.hopDir, this.hopDir ? this.cfg.hopSpeed : 0, false)

    // Squash-and-stretch: settle flat on the ground, stretch in the air.
    // Scale is anchored at the feet (group origin), so the squash reads as
    // weight, not levitation.
    this.group.scale.y = THREE.MathUtils.damp(
      this.group.scale.y,
      this.body.grounded ? 0.85 : 1.1,
      12,
      delta,
    )
  }
}
