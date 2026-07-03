import * as THREE from 'three'
import { COMBAT, PHYSICS, PLAYER } from '../config.js'
import { PhysicsBody } from '../physics/PhysicsBody.js'

// A hostile zombie: a group of box meshes (head/body/arms/legs) that wanders
// until the player comes within aggro range, then chases and melees on a
// cooldown. Locomotion matches the player's (Phase 8): a PhysicsBody drives
// the group position with gravity and AABB block collision, so zombies fall
// off cliffs instead of gliding down them; when a horizontal move is blocked
// while grounded (body.hitWall) they hop a jump, which carries them up
// 1-block steps and keeps straight-line chases working over terrain.
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

export class Zombie {
  #toPlayer = new THREE.Vector3()

  constructor(world, x, z) {
    this.world = world
    this.cfg = COMBAT.mobs.zombie
    this.health = this.cfg.health
    this.knock = new THREE.Vector3() // decaying knockback impulse
    this.wanderDir = null // unit XZ vector, or null while pausing
    this.wanderTimer = 0
    this.attackTimer = 0
    this.flashTimer = 0

    this.materials = {
      skin: new THREE.MeshLambertMaterial({ color: COLORS.skin }),
      shirt: new THREE.MeshLambertMaterial({ color: COLORS.shirt }),
      pants: new THREE.MeshLambertMaterial({ color: COLORS.pants }),
    }
    this.group = this.#buildBody()
    this.group.position.set(x, world.surfaceY(x, z), z)
    // The body drives the group's position directly (feet-origin, like the mesh).
    this.body = new PhysicsBody(world, PHYSICS.mobAABB, this.group.position)
  }

  // Group origin sits at the feet; parts stack up from there. Arms reach
  // forward (+z, the facing direction) in the classic zombie pose.
  #buildBody() {
    const m = this.materials
    const part = (geom, material, x, y, z) => {
      const mesh = new THREE.Mesh(geom, material)
      mesh.position.set(x, y, z)
      mesh.userData.mob = this // attack raycasts map intersections back here
      return mesh
    }
    const group = new THREE.Group()
    group.add(
      part(GEOM.head, m.skin, 0, 1.75, 0),
      part(GEOM.body, m.shirt, 0, 1.125, 0),
      part(GEOM.limb, m.pants, -0.14, 0.375, 0),
      part(GEOM.limb, m.pants, 0.14, 0.375, 0),
      part(GEOM.arm, m.skin, -0.34, 1.38, 0.3),
      part(GEOM.arm, m.skin, 0.34, 1.38, 0.3),
    )
    return group
  }

  // Per-frame AI + movement. `damagePlayer(amount)` is invoked on a landed
  // melee hit; playerPos is the camera (eye) position.
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
        damagePlayer(this.cfg.attackDamage)
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
        this.group.rotation.y = Math.atan2(moveDir.x, moveDir.z)
      }
    }

    // AI intent + decaying knockback become the horizontal velocity; gravity
    // and collision are the body's. hitWall is last step's result, so a
    // blocked chase hops on the following frame — enough to climb a step.
    const body = this.body
    body.velocity.x = (moveDir ? moveDir.x * speed : 0) + this.knock.x
    body.velocity.z = (moveDir ? moveDir.z * speed : 0) + this.knock.z
    this.knock.multiplyScalar(Math.exp(-8 * delta))
    if (moveDir && body.grounded && body.hitWall) {
      body.velocity.y = PHYSICS.jumpVelocity
    }
    body.step(delta)

    if (this.flashTimer > 0) {
      this.flashTimer -= delta
      if (this.flashTimer <= 0) this.#setFlash(false)
    }
  }

  // Take a hit: lose health, flash red, get shoved along `knockDir` (unit XZ).
  // Returns true when the hit was fatal.
  hurt(amount, knockDir) {
    this.health -= amount
    this.knock.addScaledVector(knockDir, COMBAT.attack.knockback)
    this.flashTimer = 0.15
    this.#setFlash(true)
    return this.health <= 0
  }

  #setFlash(on) {
    for (const mat of Object.values(this.materials)) {
      mat.emissive.setHex(on ? 0x8a1a1a : 0x000000)
    }
  }

  dispose() {
    for (const mat of Object.values(this.materials)) mat.dispose()
  }
}
