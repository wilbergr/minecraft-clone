import * as THREE from 'three'
import { COMBAT, PASSIVE_MOBS, PHYSICS } from '../config.js'
import { PhysicsBody } from '../physics/PhysicsBody.js'

// Passive farm mobs (Phase 12): pig / cow / sheep. The box-part body pattern
// is generalized from Zombie into a quadruped — one body slab, a head out
// front, four legs — recolored and scaled per kind (PASSIVE_MOBS.kinds).
// They never aggro: the AI is the zombie's wander branch, plus a short panic
// bolt away from whatever just hit them. Locomotion is the shared
// PhysicsBody (gravity, AABB collision, hop-on-hitWall), so they roam
// terrain exactly like zombies do.
//
// The interface matches Zombie (group / cfg / update / hurt / dispose, plus
// `passive: true`), so MobManager keeps one mob list and Combat's attack
// raycast and kill-drop path work unchanged — cfg.drop / cfg.dropCount yield
// the raw meat that the furnace turns into food.

const GEOM = {
  body: new THREE.BoxGeometry(0.6, 0.5, 0.9),
  head: new THREE.BoxGeometry(0.42, 0.4, 0.35),
  leg: new THREE.BoxGeometry(0.16, 0.45, 0.16),
}

export class PassiveMob {
  constructor(world, x, z, kind) {
    this.world = world
    this.kind = kind
    this.passive = true
    this.cfg = PASSIVE_MOBS.kinds[kind]
    this.health = this.cfg.health
    this.knock = new THREE.Vector3() // decaying knockback impulse
    this.wanderDir = null // unit XZ vector, or null while pausing
    this.wanderTimer = 0
    this.panicTimer = 0
    this.panicDir = new THREE.Vector3()
    this.flashTimer = 0

    const c = this.cfg.colors
    this.materials = {
      body: new THREE.MeshLambertMaterial({ color: c.body }),
      head: new THREE.MeshLambertMaterial({ color: c.head }),
      legs: new THREE.MeshLambertMaterial({ color: c.legs }),
    }
    this.group = this.#buildBody(this.cfg.scale)
    this.group.position.set(x, world.surfaceY(x, z), z)
    const { width, height } = PASSIVE_MOBS.aabb
    this.body = new PhysicsBody(
      world,
      { width: width * this.cfg.scale, height: height * this.cfg.scale },
      this.group.position,
    )
  }

  // Group origin at the feet, like Zombie; head faces +z (the walk direction).
  #buildBody(scale) {
    const m = this.materials
    const part = (geom, material, x, y, z) => {
      const mesh = new THREE.Mesh(geom, material)
      mesh.position.set(x, y, z)
      mesh.userData.mob = this // attack raycasts map intersections back here
      return mesh
    }
    const group = new THREE.Group()
    group.add(
      part(GEOM.body, m.body, 0, 0.7, 0),
      part(GEOM.head, m.head, 0, 0.85, 0.58),
      part(GEOM.leg, m.legs, -0.2, 0.225, 0.32),
      part(GEOM.leg, m.legs, 0.2, 0.225, 0.32),
      part(GEOM.leg, m.legs, -0.2, 0.225, -0.32),
      part(GEOM.leg, m.legs, 0.2, 0.225, -0.32),
    )
    group.scale.setScalar(scale)
    return group
  }

  // Wander-only AI (extra args from MobManager's shared call are ignored —
  // passive mobs never touch the player).
  update(delta) {
    this.wanderTimer -= delta
    if (this.wanderTimer <= 0) {
      this.wanderTimer = PASSIVE_MOBS.wanderSeconds * (0.5 + Math.random())
      const angle = Math.random() * Math.PI * 2
      this.wanderDir =
        Math.random() < 0.4
          ? null // graze in place for a while
          : new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle))
    }

    let moveDir = this.wanderDir
    let speed = PASSIVE_MOBS.wanderSpeed
    if (this.panicTimer > 0) {
      this.panicTimer -= delta
      moveDir = this.panicDir
      speed *= PASSIVE_MOBS.panic.speedMultiplier
    }
    if (moveDir) this.group.rotation.y = Math.atan2(moveDir.x, moveDir.z)

    // Same locomotion contract as Zombie: intent + decaying knockback become
    // the horizontal velocity; a blocked grounded move hops the next frame.
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

  // Take a hit: lose health, flash, get shoved, and bolt away from the blow.
  // Returns true when the hit was fatal.
  hurt(amount, knockDir) {
    this.health -= amount
    this.knock.addScaledVector(knockDir, COMBAT.attack.knockback)
    this.panicTimer = PASSIVE_MOBS.panic.seconds
    this.panicDir.set(knockDir.x, 0, knockDir.z).normalize()
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
