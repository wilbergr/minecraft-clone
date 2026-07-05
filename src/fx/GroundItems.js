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
  // `opts` (drop/throw feature) directs the spawn: { vx, vy, vz } overrides
  // the random pop velocity, `pickupDelay` overrides the global vacuum delay
  // (thrown items need a longer one or they boomerang straight back), and
  // `durability` preserves a dropped tool's remaining uses through re-pickup.
  spawn(x, y, z, itemId, count = 1, opts = {}) {
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
      durability: opts.durability,
      age: 0,
      retryAt: 0, // backoff timestamp after a full-inventory pickup attempt
      pickupDelay: opts.pickupDelay ?? cfg.pickupDelaySeconds,
      landed: false,
      restY: 0,
      vx: opts.vx ?? Math.sin(angle) * cfg.pop.horizontal * pop,
      vz: opts.vz ?? Math.cos(angle) * cfg.pop.horizontal * pop,
      vy: opts.vy ?? cfg.pop.up * (0.7 + Math.random() * 0.3),
    }
    this.items.push(entity)
    this.scene.add(mesh)
    return entity
  }

  // Throw an item in the camera's look direction (Q-drop, backdrop-drop):
  // spawned just below the eye so the cube doesn't clip the view, with
  // enough velocity to clear the magnet radius before the (longer) pickup
  // delay ends — see FEEDBACK.drops.throw.
  throwFrom(camera, itemId, count = 1, durability = undefined) {
    const cfg = FEEDBACK.drops.throw
    const dir = new THREE.Vector3()
    camera.getWorldDirection(dir)
    return this.spawn(
      camera.position.x + dir.x * 0.4,
      camera.position.y - 0.2 + dir.y * 0.4,
      camera.position.z + dir.z * 0.4,
      itemId,
      count,
      {
        vx: dir.x * cfg.speed,
        vy: dir.y * cfg.speed + cfg.up,
        vz: dir.z * cfg.speed,
        pickupDelay: cfg.pickupDelaySeconds,
        durability,
      },
    )
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

      // Vacuum: home on the player's waist once the pop has finished (thrown
      // items carry their own longer delay so they don't boomerang back).
      if (e.age >= e.pickupDelay && e.age >= e.retryAt) {
        const dx = playerPos.x - pos.x
        const dy = playerPos.y - 0.9 - pos.y
        const dz = playerPos.z - pos.z
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (dist <= cfg.collectRadius) {
          const leftover = this.inventory.add(e.itemId, e.count, e.durability)
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
        // Solid cells stop the arc instead of swallowing it: sideways drift
        // stops at walls, and the hop caps at a solid ceiling (mining a block
        // with solid blocks above) — otherwise the drop enters the roof cell
        // and #floorBelow would wedge it on top of the roof.
        e.vy -= cfg.pop.gravity * delta
        const wy = Math.floor(pos.y)
        const nx = pos.x + e.vx * delta
        if (isSolid(this.world.blockAt(Math.floor(nx), wy, Math.floor(pos.z)))) e.vx = 0
        else pos.x = nx
        const nz = pos.z + e.vz * delta
        if (isSolid(this.world.blockAt(Math.floor(pos.x), wy, Math.floor(nz)))) e.vz = 0
        else pos.z = nz
        pos.y += e.vy * delta
        if (e.vy > 0) {
          const roofY = Math.floor(pos.y + cfg.size / 2)
          if (isSolid(this.world.blockAt(Math.floor(pos.x), roofY, Math.floor(pos.z)))) {
            pos.y = roofY - cfg.size / 2
            e.vy = 0
          }
        }
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
  // NOTE: landing DEPENDS on the drop's center sinking fractionally into the
  // floor block on its last fall frame — the scan starts at that (solid)
  // cell, answers its top, and the pos.y <= rest check snaps the drop up.
  // Never "skip" solid cells the drop overlaps, or drops fall through the
  // world; keeping the drop out of solid cells it should NOT sink into
  // (roof above a mined block, walls) is the pop-arc clamps' job in update().
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
