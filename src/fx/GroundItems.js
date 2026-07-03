import * as THREE from 'three'
import { FEEDBACK } from '../config.js'
import { BLOCKS, isSolid } from '../world/blocks.js'
import { ITEMS } from '../inventory/items.js'

// Ground item drops (Phase 9, audit P7b). Breaking a block or killing a mob
// spawns a small spinning cube that pops out on a short arc, settles on the
// terrain surface, and — after a beat — vacuums into the player's inventory
// once they come within FEEDBACK.drops.magnetRadius.
//
// The pop arc is a self-contained tween (own gravity constant, lands on
// world.surfaceY): deliberately independent of the physics pass, which is
// being built in parallel. Geometry is shared and materials are cached per
// item id; the entity list is capped, despawning the oldest when over.
export class GroundItems {
  constructor(scene, world, inventory, sounds) {
    this.scene = scene
    this.world = world
    this.inventory = inventory
    this.sounds = sounds
    this.items = [] // oldest first
    const { size } = FEEDBACK.drops
    this.geometry = new THREE.BoxGeometry(size, size, size)
    this.materialCache = new Map() // item id -> shared material
  }

  get count() {
    return this.items.length
  }

  // Drop `count` of an item at a world position (block or mob center).
  spawn(x, y, z, itemId, count = 1) {
    const item = ITEMS[itemId]
    if (!item) return null
    const cfg = FEEDBACK.drops
    if (this.items.length >= cfg.maxEntities) this.#remove(0)

    const mesh = new THREE.Mesh(this.geometry, this.#materialFor(item))
    mesh.position.set(x, y, z)
    mesh.rotation.y = Math.random() * Math.PI
    const angle = Math.random() * Math.PI * 2
    const pop = 0.4 + Math.random() * 0.6
    const entity = {
      mesh,
      itemId,
      count,
      age: 0,
      retryAt: 0, // backoff timestamp after a full-inventory pickup attempt
      landed: false,
      restY: 0,
      vx: Math.sin(angle) * cfg.pop.horizontal * pop,
      vz: Math.cos(angle) * cfg.pop.horizontal * pop,
      vy: cfg.pop.up * (0.7 + Math.random() * 0.3),
    }
    this.items.push(entity)
    this.scene.add(mesh)
    return entity
  }

  // playerPos is the camera (eye) position.
  update(delta, playerPos) {
    const cfg = FEEDBACK.drops
    for (let i = this.items.length - 1; i >= 0; i--) {
      const e = this.items[i]
      e.age += delta
      if (e.age > cfg.despawnSeconds) {
        this.#remove(i)
        continue
      }
      const pos = e.mesh.position
      e.mesh.rotation.y += cfg.spinSpeed * delta

      // Vacuum: home on the player's waist once the pop has finished.
      if (e.age >= cfg.pickupDelaySeconds && e.age >= e.retryAt) {
        const dx = playerPos.x - pos.x
        const dy = playerPos.y - 0.9 - pos.y
        const dz = playerPos.z - pos.z
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (dist <= cfg.collectRadius) {
          const leftover = this.inventory.add(e.itemId, e.count)
          if (leftover < e.count) this.sounds?.play('pickup')
          if (leftover === 0) this.#remove(i)
          else {
            // Inventory full: keep the drop and try again in a moment.
            e.count = leftover
            e.retryAt = e.age + cfg.inventoryFullRetrySeconds
          }
          continue
        }
        if (dist <= cfg.magnetRadius) {
          const step = Math.min((cfg.magnetSpeed * delta) / dist, 1)
          pos.x += dx * step
          pos.y += dy * step
          pos.z += dz * step
          e.landed = false // re-settle if the player walks away mid-vacuum
          e.vy = 0
          continue
        }
      }

      if (!e.landed) {
        // Pop arc: tiny self-integrated ballistic hop onto the first solid
        // block below (NOT surfaceY — drops mined inside a tunnel must land
        // on the tunnel floor, not teleport to the terrain roof above).
        e.vy -= cfg.pop.gravity * delta
        pos.x += e.vx * delta
        pos.y += e.vy * delta
        pos.z += e.vz * delta
        const rest = this.#floorBelow(pos) + cfg.size / 2
        if (e.vy < 0 && pos.y <= rest) {
          pos.y = rest
          e.restY = rest
          e.landed = true
        }
      } else {
        pos.y = e.restY + Math.sin(e.age * 3) * 0.04 // idle bob
      }
    }
  }

  // Top of the first solid block at or below the drop (0 = void floor gone;
  // the despawn timer cleans up drops falling in a mined-open column).
  #floorBelow(pos) {
    const wx = Math.floor(pos.x)
    const wz = Math.floor(pos.z)
    for (let by = Math.floor(pos.y); by >= 0; by--) {
      if (isSolid(this.world.blockAt(wx, by, wz))) return by + 1
    }
    return 0
  }

  #materialFor(item) {
    let material = this.materialCache.get(item.id)
    if (!material) {
      const color =
        item.blockId !== undefined
          ? BLOCKS[item.blockId].color.side
          : new THREE.Color(item.tint ?? '#bbbbbb')
      material = new THREE.MeshLambertMaterial({ color })
      this.materialCache.set(item.id, material)
    }
    return material
  }

  #remove(i) {
    this.scene.remove(this.items[i].mesh)
    this.items.splice(i, 1) // geometry/materials are shared — nothing to dispose
  }
}
