import * as THREE from 'three'
import { COMBAT, PHYSICS } from '../config.js'
import { Health } from './Health.js'
import { Armor } from './Armor.js'
import { MobManager } from './MobManager.js'
import { Projectiles } from './Projectiles.js'

// Ties the combat pieces together: player attacks (hooked into
// BlockInteraction's left click), mob melee → player health, kill drops, and
// the death → respawn cycle. Everything pauses while the pointer is unlocked,
// so menus/inventory freeze combat like a pause screen.
//
// Phase 13 additions all funnel through here too: equipped armor reduces
// incoming combat damage and every combat hit shoves the player
// (hurtPlayer); melee swings landed while falling crit; the bow charges
// while the right button is held (bowHook) and looses arrows through the
// shared Projectiles system — the same system skeleton arrows fly on.
export class Combat {
  #dir = new THREE.Vector3()
  #knock = new THREE.Vector3()

  constructor(camera, world, player, inventory, interaction, scene, fx = {}) {
    this.camera = camera
    this.world = world
    this.player = player
    this.inventory = inventory
    this.fx = fx // Phase 9 feedback hooks (sounds, drops) — all optional
    this.health = new Health()
    this.armor = new Armor(inventory)
    this.mobs = new MobManager(scene, world, fx)
    this.projectiles = new Projectiles(scene, world)
    this.projectiles.mobs = this.mobs
    this.projectiles.player = player
    this.projectiles.onShoot = () => this.fx.sounds?.play('bow')
    this.projectiles.onHitBlock = () => this.fx.sounds?.play('arrowHit')
    // Skeleton arrows land here: armor applies, and the player is shoved
    // along the arrow's flight direction.
    this.projectiles.onHitPlayer = (damage, knockDir) =>
      this.hurtPlayer(damage, knockDir)
    this.mobs.projectiles = this.projectiles
    this.raycaster = new THREE.Raycaster()
    this.raycaster.far = COMBAT.attack.reach
    this.nextAttackAt = 0
    this.bowDraw = null // seconds the bow has been drawn, or null
    this.nextShotAt = 0

    // Left click prefers a mob in reach; BlockInteraction falls back to
    // breaking the targeted block when this returns false.
    interaction.attackHook = () => this.tryAttack()
    // Right click with the bow: 'start' begins the draw, 'release' looses at
    // the held charge, 'tap' (touch ▦) fires a fixed mid charge.
    interaction.bowHook = (phase) => this.#bowInput(phase)

    // Kill drops pop out as ground items (Phase 9); straight to the
    // inventory only when running without the fx layer. Mobs may roll a
    // `dropCount: [min, max]` range (Phase 12 passive mobs) and an
    // `extraDrop` (Phase 13: cow leather); default is 1.
    this.mobs.onMobKilled = (mob) => {
      const p = mob.group.position
      this.#award(p, mob.cfg.drop, mob.cfg.dropCount ?? [1, 1])
      if (mob.cfg.extraDrop) this.#award(p, mob.cfg.extraDrop.id, mob.cfg.extraDrop.count)
    }

    // Fall damage (Phase 8): landings past the grace cost health per block.
    // Deliberately NOT routed through armor — gravity doesn't care.
    player.body.onLand = (blocksFallen) => {
      const over = Math.floor(blocksFallen - PHYSICS.fall.graceBlocks)
      if (over > 0) this.health.damage(over * PHYSICS.fall.damagePerBlock)
    }

    this.health.onDeath = () => this.#die()
  }

  #award(p, itemId, [min, max]) {
    if (!itemId) return
    const count = min + Math.floor(Math.random() * (max - min + 1))
    if (count <= 0) return
    if (this.fx.drops) this.fx.drops.spawn(p.x, p.y + 1, p.z, itemId, count)
    else this.inventory.add(itemId, count)
  }

  update(delta) {
    // Dead: the death screen owns the moment. Unlocked: game is "paused".
    if (this.health.isDead || !this.player.isLocked) return
    // Fell out through a mined-open world floor: the void is lethal.
    if (this.player.body.position.y < PHYSICS.voidY) {
      this.health.damage(this.health.max)
      return
    }
    this.health.update(delta)
    this.projectiles.update(delta)
    // Bow charge accumulates while drawing; switching off the bow lets go.
    if (this.bowDraw !== null) {
      if (this.inventory.selectedItem?.tool?.kind === 'bow') this.bowDraw += delta
      else this.bowDraw = null
    }
    this.mobs.update(delta, this.camera.position, (amount, source) => {
      // Melee growl for growling mobs (zombies); explosions bring their own.
      if (source?.growls) this.fx.sounds?.play('zombieAttack')
      this.#knock
        .subVectors(this.camera.position, source?.group.position ?? this.camera.position)
        .setY(0)
      this.hurtPlayer(amount, this.#knock.lengthSq() > 0 ? this.#knock.normalize() : null)
    })
  }

  // Every combat hit on the player lands here (Phase 13): armor reduction,
  // then a shove along `knockDir` (unit XZ, or null for no shove).
  hurtPlayer(amount, knockDir = null) {
    if (this.health.isDead) return
    this.health.damage(this.armor.reduce(amount))
    if (knockDir) {
      const { horizontal, vertical } = COMBAT.playerKnockback
      this.player.applyKnockback(knockDir, horizontal, vertical)
    }
  }

  // Swing at whatever mob the crosshair is on. Returns true when a mob was
  // hit (the click is then spent — no block breaks behind it).
  tryAttack() {
    const now = performance.now() / 1000
    if (now < this.nextAttackAt) return false

    this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera)
    const hit = this.raycaster.intersectObjects(this.mobs.meshes, true)[0]
    if (!hit) return false

    // A wall between the player and the mob blocks the swing (and the click
    // falls through to block breaking, which is what the wall invites).
    this.camera.getWorldDirection(this.#dir)
    if (this.world.raycast(this.camera.position, this.#dir, hit.distance)) {
      return false
    }

    this.nextAttackAt = now + COMBAT.attack.cooldownSeconds
    const knockDir = this.#dir.clone().setY(0).normalize()
    let damage = this.#attackDamage()
    // Jump-attack crit (Phase 13): falling swings hit for half again as
    // much — Phase 8's airborne state, minus swimming (water isn't a leap).
    const body = this.player.body
    if (!body.grounded && !body.inWater && body.velocity.y < 0) {
      damage *= COMBAT.attack.critMultiplier
      const p = hit.point
      this.fx.particles?.burst(p.x, p.y, p.z, 0xffe27a, 10)
    }
    this.fx.sounds?.play('hit')
    this.mobs.hit(hit.object.userData.mob, damage, knockDir)
    this.inventory.damageSelected() // swinging any tool costs a use
    return true
  }

  // Swords scale with tier; other tools beat a fist; anything else is a fist.
  #attackDamage() {
    const tool = this.inventory.selectedItem?.tool
    if (!tool) return COMBAT.attack.handDamage
    if (tool.kind === 'sword') return COMBAT.attack.swordDamage[tool.tier]
    return COMBAT.attack.toolDamage
  }

  // --- Bow (Phase 13) --------------------------------------------------------

  // Input phases from BlockInteraction.bowHook. The draw only accumulates
  // while playing (update() is paused in menus, so charge freezes with it).
  #bowInput(phase) {
    if (phase === 'start') {
      if (this.bowDraw === null) this.bowDraw = 0
    } else if (phase === 'release') {
      if (this.bowDraw === null) return
      const charge = Math.min(1, this.bowDraw / COMBAT.bow.fullChargeSeconds)
      this.bowDraw = null
      if (charge >= COMBAT.bow.minCharge) this.#fireArrow(charge)
    } else if (phase === 'tap') {
      this.#fireArrow(COMBAT.bow.tapCharge)
    }
  }

  // Loose an arrow along the camera at `charge` in (0, 1]. Consumes one
  // arrow item and a bow durability point; silently refuses with an empty
  // quiver.
  #fireArrow(charge) {
    const now = performance.now() / 1000
    if (now < this.nextShotAt || this.health.isDead || !this.player.isLocked) return
    if (!this.inventory.consume('arrow', 1)) return
    this.nextShotAt = now + COMBAT.bow.cooldownSeconds
    const { speed, damage } = COMBAT.bow
    this.camera.getWorldDirection(this.#dir)
    const velocity = this.#dir
      .clone()
      .multiplyScalar(speed.min + (speed.max - speed.min) * charge)
    this.projectiles.spawn(this.camera.position, velocity, {
      fromPlayer: true,
      damage: Math.round(damage.min + (damage.max - damage.min) * charge),
    })
    this.fx.sounds?.play('bow')
    this.fx.viewmodel?.use()
    this.inventory.damageSelected() // the bow wears like any tool
  }

  // Keep-inventory death: items and hotbar survive the respawn (dropping
  // everything is authentic but brutal without ground items to recover).
  // NOTE: the fatal hit arrives from inside mobs.update(), so this must not
  // mutate the mob list — the population is cleared on respawn instead
  // (combat is frozen while dead, so the killers just stand there).
  #die() {
    this.player.unlock() // the death screen (ui/hud.js) takes the pointer
  }

  // Death-screen button lands here: back to the spawn point at full health,
  // with a fresh (empty) mob population instead of the one that just won.
  respawn() {
    this.mobs.clear()
    this.projectiles.clear()
    this.player.respawn()
    this.health.reset()
    this.player.lock()
  }
}
