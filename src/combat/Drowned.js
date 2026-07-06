import * as THREE from 'three'
import { COMBAT, PLAYER } from '../config.js'
import { Zombie } from './Zombie.js'

// The Drowned (deep-water sequel): the aquatic undead that keeps ocean
// nights dangerous. A Zombie variant through the N5 cfg/colors seam — same
// body, waterlogged palette — whose update swaps AI by medium: submerged it
// swims at the player in 3D (horizontal via locomote, vertical by setting
// body.velocity.y before the physics step, exactly the player's held-Space
// swim — PhysicsBody applies water gravity and drag after the owner), on
// land it falls back to the whole Zombie ground AI at a slow shamble
// (cfg.chaseSpeed is deliberately under the zombie's). Melee is a 3D
// distance check — a swimmer attacks from below as well as beside.
//
// Spawning is MobManager's aquatic branch (fluid-covered columns roll
// profile.aquaticWeights); the dawn burn skips submerged mobs, so a drowned
// ignites only once it has left the water.

const COLORS = { skin: 0x3f8f7c, shirt: 0x2a6470, pants: 0x2b4a58 }

export class Drowned extends Zombie {
  #toPlayer3D = new THREE.Vector3()

  constructor(world, x, z) {
    super(world, x, z, COMBAT.mobs.drowned, COLORS, 'drowned')
  }

  update(delta, playerPos, damagePlayer) {
    // Out of the water it is just a slow zombie — ground chase, wander,
    // hop-on-hitWall, the melee Y-band check, all inherited.
    if (!this.body.inWater) {
      super.update(delta, playerPos, damagePlayer)
      return
    }

    const cfg = this.cfg
    const pos = this.group.position
    // Aim at the player's feet (playerPos is the eye) so "level with the
    // player" means bodies aligned, not head-to-feet.
    this.#toPlayer3D.set(
      playerPos.x - pos.x,
      playerPos.y - PLAYER.eyeHeight - pos.y,
      playerPos.z - pos.z,
    )
    const dist = this.#toPlayer3D.length()

    this.attackTimer -= delta
    let moveDir = null
    let speed = 0

    if (dist <= cfg.aggroRange) {
      // Vertical swim: close the height gap proportionally, capped at the
      // swim speed. Set every chase frame (like the player's held key) —
      // the physics step's water gravity/drag run after this, so dy ≈ 0
      // reads as a hover with a faint sink, not a hard lock.
      this.body.velocity.y = THREE.MathUtils.clamp(
        this.#toPlayer3D.y * 2,
        -cfg.verticalSwimSpeed,
        cfg.verticalSwimSpeed,
      )
      if (dist > cfg.attackRange) {
        this.#toPlayer3D.y = 0
        const horiz = this.#toPlayer3D.length()
        if (horiz > 1e-4) {
          moveDir = this.#toPlayer3D.divideScalar(horiz)
          speed = cfg.swimSpeed
        }
      } else {
        this.group.rotation.y = Math.atan2(this.#toPlayer3D.x, this.#toPlayer3D.z)
        if (this.attackTimer <= 0) {
          this.attackTimer = cfg.attackCooldownSeconds
          damagePlayer(cfg.attackDamage, this)
        }
      }
    } else {
      // Idle: amble along the seabed (velocity.y untouched — the gentle
      // water gravity settles it to the floor, MC drowned loiter down there).
      this.wanderTimer -= delta
      if (this.wanderTimer <= 0) {
        this.wanderTimer = cfg.wanderSeconds * (0.5 + Math.random())
        const angle = Math.random() * Math.PI * 2
        this.wanderDir =
          Math.random() < 0.3
            ? null
            : new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle))
      }
      if (this.wanderDir) {
        moveDir = this.wanderDir
        speed = cfg.wanderSpeed
      }
    }

    // Default hop stays on: harmless in open water (never grounded), and on
    // the seabed or shore lip it is how the drowned climbs out after you.
    this.locomote(delta, moveDir, speed)
  }
}
