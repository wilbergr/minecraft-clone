import * as THREE from 'three'
import { PLAYER, WORLD } from '../config.js'
import { BLOCKS, BLOCK_AIR } from '../world/blocks.js'

// Aiming at, breaking, and placing blocks. Left click breaks the targeted
// block, right click places the selected block against the targeted face,
// and a wireframe box highlights the current target.
//
// What gets placed comes from the inventory's selected hotbar stack; breaking
// a block adds its drop to the inventory instantly (ground item entities are
// a later phase). Tool/hardness gating is the combat phase's seam: it layers
// onto breakTargeted() using the held item's `tool` data and BLOCKS fields.
export class BlockInteraction {
  #lookDir = new THREE.Vector3()

  constructor(camera, world, player, scene, inventory) {
    this.camera = camera
    this.world = world
    this.player = player
    this.inventory = inventory
    this.target = null

    // Slightly oversized so the outline doesn't z-fight the block faces.
    const box = new THREE.BoxGeometry(1.002, 1.002, 1.002)
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(box),
      new THREE.LineBasicMaterial({ color: 0x111111 }),
    )
    box.dispose()
    this.highlight.visible = false
    scene.add(this.highlight)

    document.addEventListener('mousedown', (e) => {
      if (!this.player.isLocked) return
      if (e.button === 0) this.breakTargeted()
      else if (e.button === 2) this.placeAtTargeted()
    })
    document.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  // Block id the selected hotbar item places, or null (empty hand / tool).
  get selectedBlockId() {
    return this.inventory.selectedItem?.blockId ?? null
  }

  // Re-raycast from the camera and move the highlight. Called every frame.
  update() {
    this.camera.getWorldDirection(this.#lookDir)
    this.target = this.world.raycast(
      this.camera.position,
      this.#lookDir,
      PLAYER.reach,
    )
    if (this.target) {
      this.highlight.position.set(
        this.target.x + 0.5,
        this.target.y + 0.5,
        this.target.z + 0.5,
      )
      this.highlight.visible = true
    } else {
      this.highlight.visible = false
    }
  }

  // Break the currently targeted block and pocket its drop. Instant for now;
  // the combat/tools phase layers hardness and tool-tier gating on top.
  breakTargeted() {
    if (!this.target) return false
    const { x, y, z } = this.target
    const broken = BLOCKS[this.world.blockAt(x, y, z)]
    if (!this.world.setBlock(x, y, z, BLOCK_AIR)) return false
    if (broken.drop) this.inventory.add(broken.drop, 1)
    return true
  }

  // Place the selected block against the targeted face, consuming one item
  // from the active hotbar stack.
  placeAtTargeted() {
    if (!this.target) return false
    const blockId = this.selectedBlockId
    if (blockId === null) return false
    const [nx, ny, nz] = this.target.normal
    const x = this.target.x + nx
    const y = this.target.y + ny
    const z = this.target.z + nz
    if (y < 0 || y >= WORLD.chunkHeight) return false
    if (this.world.blockAt(x, y, z) !== BLOCK_AIR) return false
    if (this.#overlapsPlayer(x, y, z)) return false
    if (!this.world.setBlock(x, y, z, blockId)) return false
    this.inventory.consumeSelected()
    return true
  }

  // Don't place a block into the cells the player's body occupies.
  #overlapsPlayer(x, y, z) {
    const pos = this.camera.position
    if (x !== Math.floor(pos.x) || z !== Math.floor(pos.z)) return false
    const feetY = Math.floor(pos.y - PLAYER.eyeHeight)
    const headY = Math.floor(pos.y)
    return y >= feetY && y <= headY
  }
}
