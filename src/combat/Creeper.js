import * as THREE from 'three'
import { COMBAT } from '../config.js'
import { Mob } from './Mob.js'

// The creeper (Phase 13): approaches in silence, and once inside fuse range
// starts hissing — swelling and flashing white as the fuse burns. If the
// player slips out of range the fuse ticks back down; if it completes, the
// mob sets `exploded` and MobManager detonates it (block carving via
// World.explode, proximity damage, particles, boom) — the flag defers the
// mob-list mutation out of the update callback, per the Phase 4 rule.

const GEOM = {
  head: new THREE.BoxGeometry(0.5, 0.5, 0.5),
  body: new THREE.BoxGeometry(0.5, 0.9, 0.3),
  leg: new THREE.BoxGeometry(0.2, 0.35, 0.25),
}

const COLORS = { skin: 0x55b04a, dark: 0x3d8a35 }
const AABB = { width: 0.6, height: 1.7 }

export class Creeper extends Mob {
  #toPlayer = new THREE.Vector3()

  constructor(world, x, z) {
    super(world, COMBAT.mobs.creeper.health)
    this.cfg = COMBAT.mobs.creeper
    this.wanderDir = null
    this.wanderTimer = 0
    this.fuse = 0 // seconds of fuse burned; explodes at cfg.fuseSeconds
    this.hissing = false
    this.exploded = false // MobManager detonates and removes when set
    this.onHiss = null // callback() — fuse-start sound, wired by MobManager
    this.makeMaterials(COLORS)
    this.attachBody(this.#buildBody(), x, z, AABB)
  }

  #buildBody() {
    const m = this.materials
    const group = new THREE.Group()
    group.add(
      this.part(GEOM.head, m.skin, 0, 1.45, 0),
      this.part(GEOM.body, m.skin, 0, 0.8, 0),
      this.part(GEOM.leg, m.dark, -0.15, 0.175, 0.2),
      this.part(GEOM.leg, m.dark, 0.15, 0.175, 0.2),
      this.part(GEOM.leg, m.dark, -0.15, 0.175, -0.2),
      this.part(GEOM.leg, m.dark, 0.15, 0.175, -0.2),
    )
    return group
  }

  update(delta, playerPos) {
    const pos = this.group.position
    this.#toPlayer.set(playerPos.x - pos.x, 0, playerPos.z - pos.z)
    const dist = this.#toPlayer.length()

    let moveDir = null
    let speed = 0

    if (dist <= this.cfg.fuseRange) {
      // In blast range: stand still and burn the fuse.
      this.group.rotation.y = Math.atan2(this.#toPlayer.x, this.#toPlayer.z)
      if (!this.hissing) {
        this.hissing = true
        this.onHiss?.()
      }
      this.fuse += delta
      if (this.fuse >= this.cfg.fuseSeconds) this.exploded = true
    } else {
      // Out of range: the fuse defuses; chase or wander.
      this.fuse = Math.max(0, this.fuse - delta * 1.5)
      if (this.fuse === 0) this.hissing = false
      if (dist <= this.cfg.aggroRange) {
        moveDir = this.#toPlayer.normalize()
        speed = this.cfg.chaseSpeed
      } else {
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
    }

    this.locomote(delta, moveDir, speed)

    // Fuse tell: swell and flash white, faster as detonation nears. The
    // white pulse shares the emissive channel with the hurt flash — the
    // fuse look wins while burning (being shot mid-fuse still knocks back).
    const f = this.fuse / this.cfg.fuseSeconds
    const pulse = f > 0 ? (Math.sin(this.fuse * 24) * 0.5 + 0.5) * f : 0
    this.group.scale.setScalar(1 + f * 0.25)
    if (this.flashTimer <= 0) {
      const w = Math.floor(pulse * 255)
      for (const mat of Object.values(this.materials)) {
        mat.emissive.setRGB(w / 255, w / 255, w / 255)
      }
    }
  }
}
