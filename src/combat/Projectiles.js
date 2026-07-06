import * as THREE from 'three'
import { COMBAT, PHYSICS } from '../config.js'
import { isSolid } from '../world/blocks.js'

// Ballistic arrow projectiles (Phase 13), shared by the player's bow and
// skeletons. An arrow is a point entity integrated with its own (floatier)
// gravity against world.blockAt — the Phase 8 convention: collision answers
// come from the pure block query, never from meshes — sub-stepped so a fast
// arrow can't tunnel through a wall. Hitting a block sticks the arrow in
// place briefly; hitting a body deals damage and reports a knock direction.
//
// Player arrows test against the mob list; mob arrows test against the
// player's AABB and report through onHitPlayer (Combat routes that through
// armor + player knockback). An arrow never hits its own side.

const MAX_STEP = 0.4 // blocks moved per collision test (< 1, matches bodies)

export class Projectiles {
  constructor(scene, world) {
    this.scene = scene
    this.world = world
    this.arrows = []
    this.mobs = null // MobManager — player arrows hit these
    this.player = null // PlayerControls — mob arrows hit its body AABB
    this.onHitPlayer = null // callback(damage, knockDirXZ) — wired by Combat
    this.onHitBlock = null // callback() — impact feedback (sound)
    this.onShoot = null // callback() — bowstring feedback for ANY shot (sound)
    // A thin shaft with a small head; oriented along the velocity each frame.
    this.geometry = new THREE.BoxGeometry(0.05, 0.05, 0.55)
    this.headGeometry = new THREE.BoxGeometry(0.09, 0.09, 0.1)
    this.material = new THREE.MeshLambertMaterial({ color: 0xd8cfa8 })
    this.headMaterial = new THREE.MeshLambertMaterial({ color: 0x8f8f8f })
  }

  get count() {
    return this.arrows.length
  }

  // Loose an arrow. `fromPlayer` decides which side it can hit. `gravity`
  // (the shared flying-mob seam) overrides the global arc per projectile —
  // null keeps the live COMBAT.projectiles.gravity read; 0 flies straight
  // (the dragon fireball / future ghast fireball).
  spawn(origin, velocity, { fromPlayer = false, damage = 2, gravity = null } = {}) {
    if (this.arrows.length >= COMBAT.projectiles.maxCount) this.#remove(0)
    const mesh = new THREE.Mesh(this.geometry, this.material)
    const head = new THREE.Mesh(this.headGeometry, this.headMaterial)
    head.position.z = 0.3
    mesh.add(head)
    mesh.position.copy(origin)
    const arrow = {
      mesh,
      velocity: velocity.clone(),
      fromPlayer,
      damage,
      gravity,
      age: 0,
      stuck: false,
      stuckAge: 0,
    }
    this.#orient(arrow)
    this.arrows.push(arrow)
    this.scene.add(mesh)
    return arrow
  }

  update(delta) {
    const cfg = COMBAT.projectiles
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i]
      a.age += delta
      if (a.age > cfg.lifeSeconds || a.mesh.position.y < PHYSICS.voidY) {
        this.#remove(i)
        continue
      }
      if (a.stuck) {
        a.stuckAge += delta
        if (a.stuckAge > cfg.stickSeconds) this.#remove(i)
        continue
      }

      a.velocity.y -= (a.gravity ?? cfg.gravity) * delta
      const pos = a.mesh.position
      const move = a.velocity.length() * delta
      const steps = Math.max(1, Math.ceil(move / MAX_STEP))
      const dt = delta / steps
      let hit = false
      for (let s = 0; s < steps && !hit; s++) {
        pos.addScaledVector(a.velocity, dt)
        if (isSolid(this.world.blockAt(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)))) {
          // Back out of the block so the fletching stays visible.
          pos.addScaledVector(a.velocity, -dt * 0.5)
          a.stuck = true
          this.onHitBlock?.()
          hit = true
        } else {
          hit = this.#hitBodies(a, i)
        }
      }
      if (!hit) this.#orient(a)
    }
  }

  // Body tests at the arrow's current position. Returns true when the arrow
  // was spent (removed).
  #hitBodies(a, i) {
    const p = a.mesh.position
    if (a.fromPlayer && this.mobs) {
      for (const mob of this.mobs.mobs) {
        const b = mob.body
        const m = mob.group.position
        if (
          Math.abs(p.x - m.x) <= b.half + 0.1 &&
          Math.abs(p.z - m.z) <= b.half + 0.1 &&
          p.y >= m.y &&
          p.y <= m.y + b.height + 0.1
        ) {
          const knock = new THREE.Vector3(a.velocity.x, 0, a.velocity.z).normalize()
          this.mobs.hit(mob, a.damage, knock)
          this.#remove(i)
          return true
        }
      }
    } else if (!a.fromPlayer && this.player) {
      const body = this.player.body
      const feet = body.position
      if (
        Math.abs(p.x - feet.x) <= body.half + 0.15 &&
        Math.abs(p.z - feet.z) <= body.half + 0.15 &&
        p.y >= feet.y - 0.1 &&
        p.y <= feet.y + body.height + 0.15
      ) {
        const knock = new THREE.Vector3(a.velocity.x, 0, a.velocity.z).normalize()
        this.onHitPlayer?.(a.damage, knock)
        this.#remove(i)
        return true
      }
    }
    return false
  }

  #orient(a) {
    const p = a.mesh.position
    a.mesh.lookAt(p.x + a.velocity.x, p.y + a.velocity.y, p.z + a.velocity.z)
  }

  clear() {
    while (this.arrows.length) this.#remove(this.arrows.length - 1)
  }

  #remove(i) {
    this.scene.remove(this.arrows[i].mesh)
    this.arrows.splice(i, 1) // geometry/materials are shared — nothing to dispose
  }
}
