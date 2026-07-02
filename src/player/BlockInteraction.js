import * as THREE from 'three'
import { PLAYER, WORLD } from '../config.js'
import { BLOCKS, BLOCK_AIR, PLACEABLE_BLOCK_IDS } from '../world/blocks.js'

// Aiming at, breaking, and placing blocks. Left click breaks the targeted
// block, right click places the selected block against the targeted face,
// and a wireframe box highlights the current target.
//
// Phase 3 seam: `selectedBlockId` is the single source of what gets placed.
// Today it is driven by hotkeys 1-4 over PLACEABLE_BLOCK_IDS; the inventory/
// hotbar will drive it instead (and breaking will consult block hardness from
// the BLOCKS table before calling breakTargeted()).
export class BlockInteraction {
  #lookDir = new THREE.Vector3()

  constructor(camera, world, player, scene) {
    this.camera = camera
    this.world = world
    this.player = player
    this.target = null
    this.selectedIndex = 0
    this.onSelectionChange = null // callback(blockDef) — HUD hook

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
    document.addEventListener('keydown', (e) => {
      const slot = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code)
      if (slot !== -1 && slot < PLACEABLE_BLOCK_IDS.length) {
        this.selectedIndex = slot
        this.onSelectionChange?.(this.selectedBlock)
      }
    })
  }

  get selectedBlockId() {
    return PLACEABLE_BLOCK_IDS[this.selectedIndex]
  }

  get selectedBlock() {
    return BLOCKS[this.selectedBlockId]
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

  // Break the currently targeted block. Instant in Phase 2; Phase 3+ layers
  // tool/hardness gating and drops on top of this.
  breakTargeted() {
    if (!this.target) return false
    return this.world.setBlock(this.target.x, this.target.y, this.target.z, BLOCK_AIR)
  }

  // Place the selected block against the targeted face.
  placeAtTargeted() {
    if (!this.target) return false
    const [nx, ny, nz] = this.target.normal
    const x = this.target.x + nx
    const y = this.target.y + ny
    const z = this.target.z + nz
    if (y < 0 || y >= WORLD.chunkHeight) return false
    if (this.world.blockAt(x, y, z) !== BLOCK_AIR) return false
    if (this.#overlapsPlayer(x, y, z)) return false
    return this.world.setBlock(x, y, z, this.selectedBlockId)
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
