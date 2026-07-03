import { COMBAT } from '../config.js'
import { Zombie } from './Zombie.js'

// Owns the live mob population: periodically tops it up to COMBAT.mobs.maxCount
// by spawning zombies on a ring around the player, updates their AI each
// frame, and removes mobs that die or fall too far behind a travelling player.
//
// Mob state is intentionally not persisted (Phase 5 note): mobs are ambient
// spawns, so a reload simply starts with a fresh population.
export class MobManager {
  constructor(scene, world) {
    this.scene = scene
    this.world = world
    this.mobs = []
    // Full interval before the first spawn — no zombie the instant you click in.
    this.spawnTimer = COMBAT.mobs.spawnIntervalSeconds
    this.onMobKilled = null // callback(mob) — Combat awards the drop
  }

  get count() {
    return this.mobs.length
  }

  // Every mob body part, for attack raycasts.
  get meshes() {
    return this.mobs.map((mob) => mob.group)
  }

  update(delta, playerPos, damagePlayer) {
    this.spawnTimer -= delta
    if (this.spawnTimer <= 0) {
      this.spawnTimer = COMBAT.mobs.spawnIntervalSeconds
      if (this.mobs.length < COMBAT.mobs.maxCount) this.#spawnNear(playerPos)
    }

    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const mob = this.mobs[i]
      mob.update(delta, playerPos, damagePlayer)
      const dx = mob.group.position.x - playerPos.x
      const dz = mob.group.position.z - playerPos.z
      if (dx * dx + dz * dz > COMBAT.mobs.despawnRadius ** 2) this.#remove(i)
    }
  }

  // Spawn one zombie at a random angle on the ring around the player.
  #spawnNear(playerPos) {
    const { spawnRadiusMin, spawnRadiusMax } = COMBAT.mobs
    const angle = Math.random() * Math.PI * 2
    const dist = spawnRadiusMin + Math.random() * (spawnRadiusMax - spawnRadiusMin)
    this.spawnAt(playerPos.x + Math.sin(angle) * dist, playerPos.z + Math.cos(angle) * dist)
  }

  // Direct spawn (also the browser-verification hook: __mc.mobs.spawnAt).
  spawnAt(x, z) {
    const mob = new Zombie(this.world, x, z)
    this.mobs.push(mob)
    this.scene.add(mob.group)
    return mob
  }

  // Apply a player hit; on a kill, remove the mob and report it.
  hit(mob, damage, knockDir) {
    if (!mob.hurt(damage, knockDir)) return
    const i = this.mobs.indexOf(mob)
    if (i === -1) return
    this.#remove(i)
    this.onMobKilled?.(mob)
  }

  clear() {
    while (this.mobs.length) this.#remove(this.mobs.length - 1)
  }

  #remove(i) {
    const mob = this.mobs[i]
    this.scene.remove(mob.group)
    mob.dispose()
    this.mobs.splice(i, 1)
  }
}
