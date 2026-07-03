import * as THREE from 'three'
import { COMBAT, PHYSICS } from '../config.js'
import { Health } from './Health.js'
import { MobManager } from './MobManager.js'

// Ties the combat pieces together: player attacks (hooked into
// BlockInteraction's left click), mob melee → player health, kill drops, and
// the death → respawn cycle. Everything pauses while the pointer is unlocked,
// so menus/inventory freeze combat like a pause screen.
export class Combat {
  #dir = new THREE.Vector3()

  constructor(camera, world, player, inventory, interaction, scene, fx = {}) {
    this.camera = camera
    this.world = world
    this.player = player
    this.inventory = inventory
    this.fx = fx // Phase 9 feedback hooks (sounds, drops) — all optional
    this.health = new Health()
    this.mobs = new MobManager(scene, world, fx)
    this.raycaster = new THREE.Raycaster()
    this.raycaster.far = COMBAT.attack.reach
    this.nextAttackAt = 0

    // Left click prefers a mob in reach; BlockInteraction falls back to
    // breaking the targeted block when this returns false.
    interaction.attackHook = () => this.tryAttack()

    // Kill drops pop out as ground items (Phase 9); straight to the
    // inventory only when running without the fx layer.
    this.mobs.onMobKilled = (mob) => {
      const p = mob.group.position
      if (this.fx.drops) this.fx.drops.spawn(p.x, p.y + 1, p.z, mob.cfg.drop)
      else this.inventory.add(mob.cfg.drop, 1)
    }

    // Fall damage (Phase 8): landings past the grace cost health per block.
    player.body.onLand = (blocksFallen) => {
      const over = Math.floor(blocksFallen - PHYSICS.fall.graceBlocks)
      if (over > 0) this.health.damage(over * PHYSICS.fall.damagePerBlock)
    }

    this.health.onDeath = () => this.#die()
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
    this.mobs.update(delta, this.camera.position, (amount) => {
      this.fx.sounds?.play('zombieAttack')
      this.health.damage(amount)
    })
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
    this.fx.sounds?.play('hit')
    const knockDir = this.#dir.clone().setY(0).normalize()
    this.mobs.hit(hit.object.userData.mob, this.#attackDamage(), knockDir)
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
    this.player.respawn()
    this.health.reset()
    this.player.lock()
  }
}
