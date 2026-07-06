import * as THREE from 'three'
import { COMBAT, PHYSICS, PLAYER } from '../config.js'
import { Mob } from './Mob.js'

// The skeleton (Phase 13): a ranged hostile on the shared Mob base. It
// skirmishes — backing off when the player closes in, stepping up when out
// of range — and looses ballistic arrows through the shared Projectiles
// system on a cooldown, but only with a clear line of sight (no shooting
// through walls; blocked skeletons advance instead). Night-gated and
// dawn-burned exactly like zombies (MobManager).

const GEOM = {
  head: new THREE.BoxGeometry(0.5, 0.5, 0.5),
  body: new THREE.BoxGeometry(0.4, 0.75, 0.2),
  limb: new THREE.BoxGeometry(0.14, 0.75, 0.14),
  arm: new THREE.BoxGeometry(0.12, 0.12, 0.6),
}

const COLORS = { bone: 0xd9d9cd, ribs: 0xb8b8aa, dark: 0x8f8f84 }
const EYE_HEIGHT = 1.6 // arrows leave from the skull

export class Skeleton extends Mob {
  #toPlayer = new THREE.Vector3()
  #aim = new THREE.Vector3()

  constructor(world, x, z, projectiles) {
    super(world, COMBAT.mobs.skeleton.health)
    this.cfg = COMBAT.mobs.skeleton
    this.projectiles = projectiles // may be null in bare/test runs — no shots
    this.wanderDir = null
    this.wanderTimer = 0
    this.shootTimer = COMBAT.mobs.skeleton.shootIntervalSeconds * 0.5
    this.makeSkin('skeleton', COLORS)
    this.attachBody(this.#buildBody(), x, z, PHYSICS.mobAABB)
  }

  #buildBody() {
    const group = new THREE.Group()
    if (this.skinDef) {
      // Skull face + rib-shaded torso off the shared skeleton sheet.
      group.add(
        this.skinnedPart('head', 0, 1.75, 0),
        this.skinnedPart('body', 0, 1.125, 0),
        this.skinnedPart('limb', -0.12, 0.375, 0),
        this.skinnedPart('limb', 0.12, 0.375, 0),
        this.skinnedPart('arm', -0.28, 1.38, 0.24),
        this.skinnedPart('arm', 0.28, 1.38, 0.24),
      )
      return group
    }
    const m = this.materials
    group.add(
      this.part(GEOM.head, m.bone, 0, 1.75, 0),
      this.part(GEOM.body, m.ribs, 0, 1.125, 0),
      this.part(GEOM.limb, m.dark, -0.12, 0.375, 0),
      this.part(GEOM.limb, m.dark, 0.12, 0.375, 0),
      this.part(GEOM.arm, m.bone, -0.28, 1.38, 0.24),
      this.part(GEOM.arm, m.bone, 0.28, 1.38, 0.24),
    )
    return group
  }

  update(delta, playerPos, damagePlayer) {
    const pos = this.group.position
    this.#toPlayer.set(playerPos.x - pos.x, 0, playerPos.z - pos.z)
    const dist = this.#toPlayer.length()

    this.shootTimer -= delta
    let moveDir = null
    let speed = 0

    if (dist <= this.cfg.aggroRange) {
      this.group.rotation.y = Math.atan2(this.#toPlayer.x, this.#toPlayer.z)
      const dir = this.#toPlayer.normalize()
      const sees = this.#lineOfSight(playerPos)
      if (dist < this.cfg.minRange) {
        // Too close: back away while keeping the bow trained.
        moveDir = dir.clone().negate()
        speed = this.cfg.speed
      } else if (dist > this.cfg.maxRange || !sees) {
        moveDir = dir
        speed = this.cfg.speed
      }
      if (sees && this.shootTimer <= 0) {
        this.shootTimer = this.cfg.shootIntervalSeconds
        this.#shoot(playerPos)
      }
    } else {
      // Same idle wander as the zombie.
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

  // Can the skull see the player's eyes? A blocked ray means no shot.
  #lineOfSight(playerPos) {
    const origin = this.#aim.set(
      this.group.position.x,
      this.group.position.y + EYE_HEIGHT,
      this.group.position.z,
    )
    const dir = new THREE.Vector3().subVectors(playerPos, origin)
    const dist = dir.length()
    if (dist < 0.001) return true
    dir.divideScalar(dist)
    return this.world.raycast(origin, dir, dist) === null
  }

  // Loose an arrow with a simple ballistic lead: aim at the player and lob
  // upward by half of what gravity will pull over the flight time.
  #shoot(playerPos) {
    if (!this.projectiles) return
    const origin = new THREE.Vector3(
      this.group.position.x,
      this.group.position.y + EYE_HEIGHT,
      this.group.position.z,
    )
    const velocity = new THREE.Vector3().subVectors(playerPos, origin)
    // Aim at the chest, not the eyes — arrows dropping slightly still hit.
    velocity.y -= PLAYER.eyeHeight * 0.4
    const dist = velocity.length()
    velocity.normalize().multiplyScalar(this.cfg.arrowSpeed)
    velocity.y += 0.5 * COMBAT.projectiles.gravity * (dist / this.cfg.arrowSpeed)
    this.projectiles.spawn(origin, velocity, {
      fromPlayer: false,
      damage: this.cfg.arrowDamage,
    })
    this.projectiles.onShoot?.()
  }
}
