import * as THREE from 'three'
import { PASSIVE_MOBS } from '../config.js'
import { Mob } from './Mob.js'

// Passive farm mobs (Phase 12): pig / cow / sheep. A quadruped — one body
// slab, a head out front, four legs — recolored and scaled per kind
// (PASSIVE_MOBS.kinds), on the shared Mob base (Phase 13): body building,
// hurt/flash/knockback, and locomotion all come from there. They never
// aggro: the AI is the wander branch plus a short panic bolt away from
// whatever just hit them.
//
// The interface matches the hostiles (group / cfg / update / hurt / dispose,
// plus `passive: true`), so MobManager keeps one mob list and Combat's
// attack raycast and kill-drop path work unchanged — cfg.drop /
// cfg.dropCount / cfg.extraDrop yield raw meat (and cow leather).

const GEOM = {
  body: new THREE.BoxGeometry(0.6, 0.5, 0.9),
  head: new THREE.BoxGeometry(0.42, 0.4, 0.35),
  leg: new THREE.BoxGeometry(0.16, 0.45, 0.16),
}

export class PassiveMob extends Mob {
  constructor(world, x, z, kind) {
    super(world, PASSIVE_MOBS.kinds[kind].health)
    this.kind = kind
    this.passive = true
    this.cfg = PASSIVE_MOBS.kinds[kind]
    this.wanderDir = null // unit XZ vector, or null while pausing
    this.wanderTimer = 0
    this.panicTimer = 0
    this.panicDir = new THREE.Vector3()
    this.makeMaterials(this.cfg.colors)
    const { width, height } = PASSIVE_MOBS.aabb
    this.attachBody(this.#buildBody(this.cfg.scale), x, z, {
      width: width * this.cfg.scale,
      height: height * this.cfg.scale,
    })
  }

  // Group origin at the feet, like the hostiles; head faces +z.
  #buildBody(scale) {
    const m = this.materials
    const group = new THREE.Group()
    group.add(
      this.part(GEOM.body, m.body, 0, 0.7, 0),
      this.part(GEOM.head, m.head, 0, 0.85, 0.58),
      this.part(GEOM.leg, m.legs, -0.2, 0.225, 0.32),
      this.part(GEOM.leg, m.legs, 0.2, 0.225, 0.32),
      this.part(GEOM.leg, m.legs, -0.2, 0.225, -0.32),
      this.part(GEOM.leg, m.legs, 0.2, 0.225, -0.32),
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

    this.locomote(delta, moveDir, speed)
  }

  // On top of the shared hit reaction: bolt away from the blow for a while.
  hurt(amount, knockDir) {
    this.panicTimer = PASSIVE_MOBS.panic.seconds
    this.panicDir.set(knockDir.x, 0, knockDir.z).normalize()
    return super.hurt(amount, knockDir)
  }
}
