import * as THREE from 'three'
import { FALLING } from '../config.js'
import { BLOCKS, BLOCK_AIR, isSolid } from '../world/blocks.js'
import { tileTexture } from '../world/atlas.js'

// Falling gravity blocks (sand & gravel — `gravity: true` in blocks.js).
// When a world edit leaves a gravity block unsupported, it converts into a
// falling-block entity: the cell is set to air, a full-size textured cube
// tweens straight down (self-contained integration, GroundItems-style — NOT
// the physics pass), and setBlock() places the block where it lands. Both
// ends are ordinary overlay edits, so generator purity is untouched — and
// generated terrain (beaches, deserts) never falls, because generation never
// fires onEdit.
//
// Cascades are free: converting a block emits its own edit, whose subscriber
// re-checks the cell above, so a whole column collapses bottom-up through
// one entry point. Entities keep the world they were spawned in and parent
// their mesh under world.root, so mid-fall dimension travel just hides them
// while they finish landing as overlay edits.
export class FallingBlocks {
  constructor(drops, sounds) {
    this.drops = drops // landing on a torch/bed spills it as a ground drop
    this.sounds = sounds
    this.blocks = [] // live entities, bottom-of-column first (see tryFall)
    const s = FALLING.size
    this.geometry = new THREE.BoxGeometry(s, s, s)
    this.materialCache = new Map() // block id -> shared material
  }

  get count() {
    return this.blocks.length
  }

  // world.onEdit subscriber body (also called per explosion-carved cell): an
  // edit can unsupport the gravity block above it, or BE a gravity block
  // placed in mid-air (placing sand against a wall side drops it, like MC).
  onEdit(world, x, y, z) {
    this.tryFall(world, x, y + 1, z)
    this.tryFall(world, x, y, z)
  }

  // Convert the block at (x, y, z) into a falling entity when it's gravity-
  // flagged and the cell below isn't solid. Pushed BEFORE the setBlock so a
  // cascading column lands in bottom-first array order — update() iterates
  // forward, so the lowest block always settles first and the ones above
  // stack onto it in the original order.
  tryFall(world, x, y, z) {
    const block = BLOCKS[world.blockAt(x, y, z)]
    if (block?.gravity !== true) return false
    if (isSolid(world.blockAt(x, y - 1, z))) return false
    if (this.blocks.length >= FALLING.maxEntities) this.#settle(this.blocks[0])
    const mesh = new THREE.Mesh(this.geometry, this.#materialFor(block))
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5)
    world.root.add(mesh)
    this.blocks.push({ world, id: block.id, x, z, mesh, vy: 0 })
    world.setBlock(x, y, z, BLOCK_AIR) // re-enters onEdit — cascades upward
    return true
  }

  update(delta) {
    for (let i = 0; i < this.blocks.length; i++) {
      const e = this.blocks[i]
      // maxSpeed keeps travel under 1 block per clamped 0.1s frame — faster
      // would let the center skip a cell and land under a 1-thick floor.
      e.vy = Math.min(e.vy + FALLING.gravity * delta, FALLING.maxSpeed)
      e.mesh.position.y -= e.vy * delta
      const rest = this.#restCell(e)
      if (rest === null) {
        // Mined-open column: nothing below, ever — fall out of the world.
        if (e.mesh.position.y < -2) {
          this.#remove(e)
          i--
        }
        continue
      }
      if (e.mesh.position.y - FALLING.size / 2 <= rest) {
        this.#settle(e)
        i--
      }
    }
  }

  // The cell this entity would occupy if it landed now: one above the first
  // solid cell at or below its center. Liquids aren't solid, so the scan
  // sinks through water/lava to the pool floor and the landing setBlock
  // replaces the liquid cell — consistent with the placement rule and the
  // no-flow simulation. Overshoot into the floor self-corrects: the scan
  // starts inside the solid cell and answers the cell above it.
  #restCell(e) {
    for (let by = Math.floor(e.mesh.position.y); by >= 0; by--) {
      if (isSolid(e.world.blockAt(e.x, by, e.z))) return by + 1
    }
    return null
  }

  // Land: break any non-solid occupant into its drop (torch, bed — the rest
  // cell is theirs when they sit on the floor we found), then place the
  // block. Landing inside the player's cell is safe by construction:
  // PhysicsBody's embedded self-heal lifts the body out on top
  // (PHYSICS.ejectSpeed), so a collapsing column raises the player with it.
  #settle(e) {
    const rest = this.#restCell(e)
    if (rest !== null) {
      const occupant = BLOCKS[e.world.blockAt(e.x, rest, e.z)]
      if (occupant?.targetable === true && occupant.drop) {
        this.drops?.spawn(e.x + 0.5, rest + 0.7, e.z + 0.5, occupant.drop)
      }
      e.world.setBlock(e.x, rest, e.z, e.id)
      this.sounds?.play('place', { material: BLOCKS[e.id].material, gain: 0.6 })
    }
    this.#remove(e)
  }

  #materialFor(block) {
    let material = this.materialCache.get(block.id)
    if (!material) {
      const map = tileTexture(block.tex?.side)
      material = map
        ? new THREE.MeshLambertMaterial({ map })
        : new THREE.MeshLambertMaterial({ color: block.color.side })
      this.materialCache.set(block.id, material)
    }
    return material
  }

  #remove(e) {
    e.mesh.parent?.remove(e.mesh)
    this.blocks.splice(this.blocks.indexOf(e), 1)
  }
}
