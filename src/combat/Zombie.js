import * as THREE from 'three'
import { COMBAT, PHYSICS, PLAYER } from '../config.js'
import { Mob } from './Mob.js'

// A hostile zombie: a group of box meshes (head/body/arms/legs) that wanders
// until the player comes within aggro range, then chases and melees on a
// cooldown. Body building, hurt/flash/knockback, and locomotion (gravity,
// AABB collision, hop-on-hitWall) live in the shared Mob base (Phase 13).
//
// Geometry is shared across all zombies; materials are cloned per mob so the
// red hurt-flash (emissive) doesn't light up the whole horde. Mob count is
// capped low (COMBAT.mobs.maxCount) because each body part is a draw call.

const GEOM = {
  head: new THREE.BoxGeometry(0.5, 0.5, 0.5),
  body: new THREE.BoxGeometry(0.5, 0.75, 0.25),
  limb: new THREE.BoxGeometry(0.2, 0.75, 0.24),
  arm: new THREE.BoxGeometry(0.18, 0.18, 0.72),
}

const COLORS = { skin: 0x4f8a3d, shirt: 0x2e8a8a, pants: 0x35357a }

export class Zombie extends Mob {
  #toPlayer = new THREE.Vector3()

  constructor(world, x, z) {
    super(world, COMBAT.mobs.zombie.health)
    this.cfg = COMBAT.mobs.zombie
    this.growls = true // Combat plays the attack growl for growling mobs
    this.wanderDir = null // unit XZ vector, or null while pausing
    this.wanderTimer = 0
    this.attackTimer = 0
    this.makeMaterials(COLORS)
    this.attachBody(this.#buildBody(), x, z, PHYSICS.mobAABB)
  }

  // Group origin sits at the feet; parts stack up from there. Arms reach
  // forward (+z, the facing direction) in the classic zombie pose.
  #buildBody() {
    const m = this.materials
    const group = new THREE.Group()
    group.add(
      this.part(GEOM.head, m.skin, 0, 1.75, 0),
      this.part(GEOM.body, m.shirt, 0, 1.125, 0),
      this.part(GEOM.limb, m.pants, -0.14, 0.375, 0),
      this.part(GEOM.limb, m.pants, 0.14, 0.375, 0),
      this.part(GEOM.arm, m.skin, -0.34, 1.38, 0.3),
      this.part(GEOM.arm, m.skin, 0.34, 1.38, 0.3),
    )
    return group
  }

  // Per-frame AI + movement. `damagePlayer(amount, mob)` is invoked on a
  // landed melee hit; playerPos is the camera (eye) position.
  update(delta, playerPos, damagePlayer) {
    const pos = this.group.position
    this.#toPlayer.set(playerPos.x - pos.x, 0, playerPos.z - pos.z)
    const dist = this.#toPlayer.length()

    this.attackTimer -= delta
    let moveDir = null
    let speed = 0

    if (dist <= this.cfg.aggroRange) {
      // Chase: head straight for the player; stop and swing when in reach.
      this.group.rotation.y = Math.atan2(this.#toPlayer.x, this.#toPlayer.z)
      const nearPlayerY = Math.abs(pos.y - (playerPos.y - PLAYER.eyeHeight)) < 2.5
      if (dist > this.cfg.attackRange) {
        moveDir = this.#toPlayer.normalize()
        speed = this.cfg.chaseSpeed
      } else if (nearPlayerY && this.attackTimer <= 0) {
        this.attackTimer = this.cfg.attackCooldownSeconds
        damagePlayer(this.cfg.attackDamage, this)
      }
    } else {
      // Wander: amble in a random direction for a while, sometimes stand still.
      this.wanderTimer -= delta
      if (this.wanderTimer <= 0) {
        this.wanderTimer = this.cfg.wanderSeconds * (0.5 + Math.random())
        const angle = Math.random() * Math.PI * 2
        this.wanderDir =
          Math.random() < 0.3
            ? null
            : new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle))
      }
      if (this.wanderDir) {
        moveDir = this.wanderDir
        speed = this.cfg.wanderSpeed
      }
    }

    this.locomote(delta, moveDir, speed)
  }
}
